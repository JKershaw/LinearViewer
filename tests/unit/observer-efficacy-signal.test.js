/**
 * Unit tests for lib/observer-efficacy-signal.js (LIN-2133, P1-6 of the
 * LIN-2114 observer-harness epic).
 *
 * Run with: node --test tests/unit/observer-efficacy-signal.test.js
 *
 * Coverage:
 *   A. computeNewHarnessSignal — pure, from shadow-log-shaped entries.
 *   B. computeIncumbentSignal — pure, from real (non-lean) Loop fixtures
 *      built the same way tests/unit/observer-sweep.test.js does (via
 *      __internal._buildLoops), never hand-built Loop literals.
 *   C. compareArms — bundling, not scoring.
 *   D. Orchestration (collectNewHarnessSignal/collectIncumbentSignal) — a
 *      real MangoDB tmpdir, precedent: tests/unit/observer-sweep.test.js's
 *      idempotency tier, plus guardNetwork() proving no external call.
 *   E. Static import assertion.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';

import { __internal } from '../../lib/pipeline-loops.js';
import {
  computeNewHarnessSignal,
  computeIncumbentSignal,
  compareArms,
  collectNewHarnessSignal,
  collectIncumbentSignal
} from '../../lib/observer-efficacy-signal.js';
import { ObserverShadowLogStore, computeWouldBeAction } from '../../lib/observer-shadow-log.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { guardNetwork } from '../fixtures/network-guard.js';

const { _buildLoops } = __internal;

function attentionRow(overrides = {}) {
  return { loopId: 'loop-1', issue: 'LIN-42', lane: 'blocked', stage: 'implementation', since: '2026-08-20T10:00:00.000Z', ...overrides };
}

// ─── A. computeNewHarnessSignal ─────────────────────────────────────────────

describe('observer-efficacy-signal: computeNewHarnessSignal (LIN-2133)', () => {
  test('one loop, one shadow entry: detectionLagMs is recordedAt - diagnosis.since; stillBlockedObservedMs is 0 with relayCount 1', () => {
    const action = computeWouldBeAction(attentionRow({ since: '2026-08-20T10:00:00.000Z' }));
    const entry = { ...action, recordedAt: new Date('2026-08-20T10:01:30.000Z') };
    const result = computeNewHarnessSignal([entry]);
    assert.strictEqual(result.count, 1);
    const [row] = result.perLoop;
    assert.strictEqual(row.detectionLagMs, 90_000);
    assert.strictEqual(row.stillBlockedObservedMs, 0);
    assert.strictEqual(row.relayCount, 1);
    assert.strictEqual(row.resolved, undefined, 'the new-harness arm must never carry a fabricated resolved/outcome field');
  });

  test('one loop, multiple ticks: groups by loopId, sorts by recordedAt, spans first-to-last', () => {
    const base = computeWouldBeAction(attentionRow({ since: '2026-08-20T10:00:00.000Z' }));
    const entries = [
      { ...base, recordedAt: new Date('2026-08-20T10:03:00.000Z') }, // out of order on purpose
      { ...base, recordedAt: new Date('2026-08-20T10:01:00.000Z') },
      { ...base, recordedAt: new Date('2026-08-20T10:02:00.000Z') }
    ];
    const result = computeNewHarnessSignal(entries);
    assert.strictEqual(result.count, 1);
    const [row] = result.perLoop;
    assert.strictEqual(row.relayCount, 3);
    assert.strictEqual(row.firstDetectedAt.getTime?.() ?? new Date(row.firstDetectedAt).getTime(), new Date('2026-08-20T10:01:00.000Z').getTime());
    assert.strictEqual(row.detectionLagMs, 60_000);
    assert.strictEqual(row.stillBlockedObservedMs, 120_000);
  });

  test('two distinct loops are reported separately, never merged', () => {
    const a = computeWouldBeAction(attentionRow({ loopId: 'loop-a', issue: 'LIN-1' }));
    const b = computeWouldBeAction(attentionRow({ loopId: 'loop-b', issue: 'LIN-2' }));
    const result = computeNewHarnessSignal([
      { ...a, recordedAt: new Date('2026-08-20T10:00:00.000Z') },
      { ...b, recordedAt: new Date('2026-08-20T10:00:00.000Z') }
    ]);
    assert.strictEqual(result.count, 2);
    assert.deepStrictEqual(result.perLoop.map((r) => r.loopId).sort(), ['loop-a', 'loop-b']);
  });

  test('summary aggregates avg/median across loops, excluding unmeasurable rows without throwing', () => {
    const a = computeWouldBeAction(attentionRow({ loopId: 'a', since: '2026-08-20T10:00:00.000Z' }));
    const b = computeWouldBeAction(attentionRow({ loopId: 'b', since: '2026-08-20T10:00:00.000Z' }));
    const c = { ...computeWouldBeAction(attentionRow({ loopId: 'c' })), diagnosis: { lane: 'blocked', stage: null, since: null } };
    const result = computeNewHarnessSignal([
      { ...a, recordedAt: new Date('2026-08-20T10:01:00.000Z') }, // lag 60s
      { ...b, recordedAt: new Date('2026-08-20T10:02:00.000Z') }, // lag 120s
      { ...c, recordedAt: new Date('2026-08-20T10:03:00.000Z') }  // unmeasurable (no since)
    ]);
    assert.strictEqual(result.summary.detectionLag.n, 3);
    assert.strictEqual(result.summary.detectionLag.withMeasurement, 2);
    assert.strictEqual(result.summary.detectionLag.avgMs, 90_000);
    assert.strictEqual(result.summary.detectionLag.medianMs, 90_000);
  });

  test('empty/absent input yields an empty, never-thrown result', () => {
    assert.deepStrictEqual(computeNewHarnessSignal([]).perLoop, []);
    assert.deepStrictEqual(computeNewHarnessSignal(null).perLoop, []);
    assert.strictEqual(computeNewHarnessSignal([{ loopId: null }]).count, 0, 'an entry with no loopId is skipped, not crashed on');
  });
});

// ─── B. computeIncumbentSignal ──────────────────────────────────────────────

describe('observer-efficacy-signal: computeIncumbentSignal (LIN-2133)', () => {
  let idCounter = 0;
  function historyItem(overrides = {}) {
    return {
      id: `h-${idCounter++}`,
      promptName: 'implementation',
      prompt: 'p',
      issueId: 'uuid-1',
      issueIdentifier: 'LIN-100',
      issueTitle: 'Issue',
      issueUrl: 'https://linear.app/x/issue/LIN-100',
      workspace: { urlKey: 'ws' },
      dispatchedAt: '2026-04-11T11:00:00.000Z',
      dispatchedBy: 'user-1',
      target: 'cli',
      repo: null,
      status: 'taken',
      resolvedAt: '2026-04-11T11:05:00.000Z',
      takenByTokenLabel: 'consumer-1',
      feedback: [],
      ...overrides
    };
  }
  const NOW = new Date('2026-04-11T12:00:00.000Z');

  test('a loop with a [blocked] marker followed by a later entry: timeToRespondMs is the gap to the NEXT feedback entry', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        feedback: [
          { message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' },
          { message: 'a human replied', timestamp: '2026-04-11T11:12:30.000Z' },
          { message: '[done] shipped', timestamp: '2026-04-11T11:15:00.000Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const result = computeIncumbentSignal(loops);
    assert.strictEqual(result.count, 1);
    const [row] = result.perLoop;
    assert.strictEqual(row.timeToRespondMs, 150_000);
    assert.strictEqual(row.resolved, true, 'the loop is now [done] — no longer blocked');
  });

  test('a loop whose [blocked] marker is the LAST feedback entry: no response yet, still blocked', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        status: 'taken',
        feedback: [{ message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' }]
      })],
      now: NOW, lean: false
    });
    const result = computeIncumbentSignal(loops);
    assert.strictEqual(result.count, 1);
    const [row] = result.perLoop;
    assert.strictEqual(row.respondedAt, null);
    assert.strictEqual(row.timeToRespondMs, null);
    assert.strictEqual(row.resolved, false);
  });

  test('a loop with no [blocked] marker anywhere contributes nothing — there is no wake event to measure from', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({ feedback: [{ message: '[done] shipped', timestamp: '2026-04-11T11:10:00.000Z' }] })],
      now: NOW, lean: false
    });
    assert.strictEqual(computeIncumbentSignal(loops).count, 0);
  });

  test('only the FIRST [blocked] marker is used, even if the loop went blocked more than once', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        feedback: [
          { message: '[blocked] first', timestamp: '2026-04-11T11:00:00.000Z' },
          { message: 'nudge', timestamp: '2026-04-11T11:01:00.000Z' },
          { message: '[blocked] second', timestamp: '2026-04-11T11:20:00.000Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const [row] = computeIncumbentSignal(loops).perLoop;
    assert.strictEqual(row.timeToRespondMs, 60_000, 'measured from the FIRST blocked marker to the very next entry');
  });

  test('summary.timeToRespond.resolvedRate reflects the fraction of blocked loops that are no longer blocked', () => {
    const loops = _buildLoops({
      historyItems: [
        historyItem({ id: 'h-a', issueIdentifier: 'LIN-1', feedback: [{ message: '[blocked] x', timestamp: '2026-04-11T11:00:00.000Z' }, { message: '[done] y', timestamp: '2026-04-11T11:05:00.000Z' }] }),
        historyItem({ id: 'h-b', issueIdentifier: 'LIN-2', feedback: [{ message: '[blocked] x', timestamp: '2026-04-11T11:00:00.000Z' }] })
      ],
      now: NOW, lean: false
    });
    const result = computeIncumbentSignal(loops);
    assert.strictEqual(result.summary.timeToRespond.resolvedCount, 1);
    assert.strictEqual(result.summary.timeToRespond.resolvedRate, 0.5);
  });

  test('empty/absent loops yields an empty, never-thrown result', () => {
    assert.deepStrictEqual(computeIncumbentSignal([]).perLoop, []);
    assert.deepStrictEqual(computeIncumbentSignal(null).perLoop, []);
  });
});

// ─── C. compareArms ──────────────────────────────────────────────────────────

describe('observer-efficacy-signal: compareArms', () => {
  test('bundles both arms side by side with their caveats — never a single diffed score', () => {
    const newHarness = computeNewHarnessSignal([]);
    const incumbent = computeIncumbentSignal([]);
    const bundle = compareArms(newHarness, incumbent);
    assert.strictEqual(bundle.newHarness, newHarness);
    assert.strictEqual(bundle.incumbent, incumbent);
    assert.ok(bundle.caveats.length >= 3);
    assert.ok(bundle.caveats.some((c) => /lower-bound/i.test(c)));
    assert.ok(bundle.caveats.some((c) => /must not be diffed/i.test(c)));
  });
});

// ─── D. Orchestration (real MangoDB, read-only) ────────────────────────────

describe('observer-efficacy-signal: collectNewHarnessSignal / collectIncumbentSignal (real MangoDB, LIN-2133)', () => {
  let dbDir, client, dbCounter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'observer-efficacy-signal-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  test('collectNewHarnessSignal reads ONLY ObserverShadowLogStore#listByWorkspace, makes no network call', async () => {
    const db = client.db(`eff_${dbCounter++}`);
    const observerShadowLogStore = new ObserverShadowLogStore({ collection: db.collection('observer-shadow-log') });
    const urlKey = `ws-${randomUUID()}`;
    await observerShadowLogStore.recordActions(urlKey, [computeWouldBeAction(attentionRow())], new Date('2026-08-20T10:01:00.000Z'));

    const net = guardNetwork();
    const result = await collectNewHarnessSignal(urlKey, { observerShadowLogStore });
    assert.strictEqual(net.attempts.length, 0);
    net.restore();

    assert.strictEqual(result.count, 1);
  });

  test('collectIncumbentSignal reads real dispatch/agent-status stores with full feedback, makes no network call', async () => {
    const db = client.db(`eff_${dbCounter++}`);
    const dispatchStore = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history'), ttl: 86400 });
    const agentStatusStore = new AgentStatusStore({ collection: db.collection('foreman-status') });
    const urlKey = `ws-${randomUUID()}`;

    const item = await dispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-9', promptName: 'implementation' });
    const taken = await dispatchStore.takeItem(item._id, urlKey, 'consumer-1');
    await dispatchStore.addFeedback(taken.id, urlKey, { message: '[blocked] need a decision' }, 'consumer-1');
    await dispatchStore.addFeedback(taken.id, urlKey, { message: '[done] shipped' }, 'consumer-1');

    const net = guardNetwork();
    const result = await collectIncumbentSignal(urlKey, { dispatchStore, agentStatusStore });
    assert.strictEqual(net.attempts.length, 0);
    net.restore();

    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.perLoop[0].resolved, true);
  });

  function forbiddenProxy(target, allowedMethods, label) {
    return new Proxy(target, {
      get(obj, prop, receiver) {
        if (typeof prop === 'symbol' || prop === 'then') return Reflect.get(obj, prop, receiver);
        if (allowedMethods.includes(prop)) {
          const value = Reflect.get(obj, prop, receiver);
          return typeof value === 'function' ? value.bind(obj) : value;
        }
        throw new Error(`forbidden intervention path: ${label}.${String(prop)}`);
      }
    });
  }

  test('collectNewHarnessSignal, run through a Proxy allowing ONLY listByWorkspace, makes no other call', async () => {
    const db = client.db(`eff_neg_${dbCounter++}`);
    const realStore = new ObserverShadowLogStore({ collection: db.collection('observer-shadow-log') });
    const urlKey = `ws-${randomUUID()}`;
    await realStore.recordActions(urlKey, [computeWouldBeAction(attentionRow())], new Date('2026-08-20T10:01:00.000Z'));

    const observerShadowLogStore = forbiddenProxy(realStore, ['listByWorkspace'], 'observerShadowLogStore');
    const result = await collectNewHarnessSignal(urlKey, { observerShadowLogStore });
    assert.strictEqual(result.count, 1);
  });

  test('collectIncumbentSignal, run through Proxies allowing only read methods, makes no write call on either store', async () => {
    const db = client.db(`eff_neg_${dbCounter++}`);
    const realDispatchStore = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history'), ttl: 86400 });
    const realAgentStatusStore = new AgentStatusStore({ collection: db.collection('foreman-status') });
    const urlKey = `ws-${randomUUID()}`;

    const item = await realDispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-9', promptName: 'implementation' });
    const taken = await realDispatchStore.takeItem(item._id, urlKey, 'consumer-1');
    await realDispatchStore.addFeedback(taken.id, urlKey, { message: '[blocked] need a decision' }, 'consumer-1');

    // getLoopsForWorkspace's own read surface: listItems/listHistory on
    // dispatch, listStatus on agent-status (same allowlist observer-sweep's
    // own negative test uses).
    const dispatchStore = forbiddenProxy(realDispatchStore, ['listItems', 'listHistory'], 'dispatchStore');
    const agentStatusStore = forbiddenProxy(realAgentStatusStore, ['listStatus'], 'agentStatusStore');

    const result = await collectIncumbentSignal(urlKey, { dispatchStore, agentStatusStore });
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.perLoop[0].resolved, false);
  });
});

// ─── E. Static import assertion ─────────────────────────────────────────────

describe('observer-efficacy-signal: static import assertion', () => {
  test('lib/observer-efficacy-signal.js imports only pure/read modules — no agent-status-store/linear-provider/openrouter import', () => {
    const modulePath = fileURLToPath(new URL('../../lib/observer-efficacy-signal.js', import.meta.url));
    const src = readFileSync(modulePath, 'utf8');
    const specifiers = [...src.matchAll(/^import\s+(?:[^;]*?from\s+)?['"](.+?)['"]\s*;?\s*$/gm)].map((m) => m[1]);
    assert.deepStrictEqual(
      specifiers.sort(),
      ['./pipeline-loops.js', './dispatch-terminal.js'].sort(),
      'a new import here (e.g. a direct store import bypassing the injected deps seam, or any write-capable/network module) must be caught by this assertion'
    );
  });
});
