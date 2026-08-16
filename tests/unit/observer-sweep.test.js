/**
 * Unit tests for lib/observer-sweep.js (LIN-2131, P1-3 of the LIN-2114
 * observer-harness epic).
 *
 * Run with: node --test tests/unit/observer-sweep.test.js
 *
 * Coverage:
 *   A. Classification — fixture-driven via __internal._buildLoops with real
 *      marker text (precedent: tests/unit/pipeline-loops.test.js:816), never
 *      hand-built Loop literals.
 *   C. Idempotency — a REAL MangoDB tmpdir (precedent:
 *      tests/unit/observer-state-store.test.js:19-32), never
 *      tests/fixtures/mock-collection.js: its own header confirms it lacks
 *      $setOnInsert, so it cannot exercise ensureSeeded's seed path.
 *   D. Negative capability — a Proxy read-only allowlist over every injected
 *      store, paired with a static import assertion and guardNetwork().
 *   E. Roster derivation.
 *
 * Note 1 (plan-review, non-blocking): `loopLastActivityMs(loop) === 0` is
 * unreachable through this sweep's own read path — `_buildLoops` skips any
 * row whose `dispatchedAt` fails to parse (lib/pipeline-loops.js:250-254
 * live, :271-275 history), so every loop this sweep can ever see carries a
 * non-zero `dispatchedAt`. classifyLoop's zero-activity branch is kept as
 * declared-defensive (see its own comment in lib/observer-sweep.js) rather
 * than tested here — a hand-built loop literal is exactly the fixture style
 * this file's classification section avoids, and there is no real path that
 * reaches this branch to fixture through `_buildLoops` instead.
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
import { computeSupersededLoopIds } from '../../lib/loop-supersede.js';
import { DEFAULT_LANE_STALE_MS } from '../../lib/live-console.js';
import {
  classifyLoop,
  buildSweepPayload,
  sweepOneWorkspace,
  resolveRosterFromSessions
} from '../../lib/observer-sweep.js';
import { ObserverStateStore } from '../../lib/observer-state-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { guardNetwork } from '../fixtures/network-guard.js';

const { _buildLoops } = __internal;

const LANE_KEYS = ['working', 'silent', 'blocked', 'terminal', 'queued', 'resolved', 'unknown'];
const NOW = new Date('2026-04-11T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const STALE_MS = DEFAULT_LANE_STALE_MS;

let idCounter = 0;

function historyItem(overrides = {}) {
  return {
    id: `hist-${idCounter++}`,
    promptName: 'implementation',
    prompt: 'implementation prompt text',
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

function liveItem(overrides = {}) {
  return {
    id: `live-${idCounter++}`,
    promptName: 'plan',
    prompt: 'plan prompt text',
    issueId: 'uuid-2',
    issueIdentifier: 'LIN-200',
    issueTitle: 'Issue',
    issueUrl: 'https://linear.app/x/issue/LIN-200',
    workspace: { urlKey: 'ws' },
    dispatchedAt: '2026-04-11T11:00:00.000Z',
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    expiresAt: '2026-04-12T11:00:00.000Z',
    ...overrides
  };
}

function agentStatusEntry(overrides = {}) {
  return {
    id: `fmn-${idCounter++}`,
    taskIdentifier: 'LIN-100',
    action: 'implementation',
    status: 'completed',
    summary: 'Done.',
    timestamp: '2026-04-11T11:02:00.000Z',
    ...overrides
  };
}

// ─── A. Classification ────────────────────────────────────────────────────

describe('observer-sweep: classification (LIN-2131)', () => {
  test('F1 — lane totals reconcile by construction: sum(lanes) === loops.length across a mixed 7-lane fixture', () => {
    const histItems = [
      historyItem({
        id: 'h-terminal', issueIdentifier: 'LIN-201',
        feedback: [{ message: '[done] shipped', timestamp: '2026-04-11T11:10:00.000Z' }]
      }),
      historyItem({
        id: 'h-resolved', issueIdentifier: 'LIN-202', status: 'cancelled',
        feedback: [{ message: '[blocked] stale, operator cancelled after', timestamp: '2026-04-11T11:10:00.000Z' }]
      }),
      historyItem({
        id: 'h-blocked-feedback', issueIdentifier: 'LIN-203',
        feedback: [{ message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' }]
      }),
      historyItem({ id: 'h-blocked-agentstatus', issueIdentifier: 'LIN-204' }),
      historyItem({ id: 'h-working', issueIdentifier: 'LIN-206', dispatchedAt: '2026-04-11T11:55:00.000Z' }),
      historyItem({ id: 'h-silent', issueIdentifier: 'LIN-207', dispatchedAt: '2026-04-11T10:00:00.000Z' }),
      historyItem({ id: 'h-unknown', issueIdentifier: 'LIN-208' })
    ];
    const liveItems = [liveItem({ id: 'l-queued', issueIdentifier: 'LIN-205' })];
    const agentStatuses = [
      agentStatusEntry({ dispatchId: 'h-blocked-agentstatus', taskIdentifier: 'LIN-204', status: 'blocked', timestamp: '2026-04-11T11:02:00.000Z' }),
      agentStatusEntry({ dispatchId: 'h-unknown', taskIdentifier: 'LIN-208', status: 'completed', timestamp: '2026-04-11T11:02:00.000Z' })
    ];
    const loops = _buildLoops({ historyItems: histItems, liveItems, agentStatusEntries: agentStatuses, now: NOW, lean: true });
    assert.strictEqual(loops.length, 8, 'sanity: one loop per fixture row');

    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    const sum = Object.values(payload.lanes).reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, loops.length, 'F1: lane totals must reconcile against the workspace loop count');
    for (const key of LANE_KEYS) {
      assert.ok(payload.lanes[key] >= 1, `lane "${key}" must be represented in this deliberately mixed fixture`);
    }
    assert.strictEqual(payload.lanes.blocked, 2, 'both blocked channels contributed one row each');
    assert.strictEqual(payload.lanes.queued, 1);
    assert.strictEqual(payload.lanes.terminal, 1);
    assert.strictEqual(payload.lanes.resolved, 1);
  });

  test('F2 — agent-status blocked with no [blocked] feedback marker lands blocked, not unknown (the row plan-review traced)', () => {
    const hist = historyItem({ id: 'h-f2', issueIdentifier: 'LIN-302' }); // no feedback at all
    const agentStatuses = [
      agentStatusEntry({ dispatchId: 'h-f2', taskIdentifier: 'LIN-302', status: 'blocked', timestamp: '2026-04-11T11:02:00.000Z' })
    ];
    const loops = _buildLoops({ historyItems: [hist], agentStatusEntries: agentStatuses, now: NOW, lean: true });
    assert.strictEqual(loops[0].wakeMarker, null, 'no feedback marker was ever posted');
    assert.strictEqual(loops[0].agentState, 'waiting', 'the agent-status channel alone carries the signal');

    const superseded = computeSupersededLoopIds(loops);
    const lane = classifyLoop(loops[0], { superseded, now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(lane, 'blocked', 'pre-fix this row fell to the final otherwise branch and vanished into unknown');
  });

  test('[pending] is never treated as blocked/waiting — WAITING_WAKE_MARKERS is {blocked} only', () => {
    const hist = historyItem({
      id: 'h-pending', issueIdentifier: 'LIN-301', dispatchedAt: '2026-04-11T11:55:00.000Z',
      feedback: [{ message: '[pending] beat done, orchestrator handoff', timestamp: '2026-04-11T11:56:00.000Z' }]
    });
    const loops = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    const superseded = computeSupersededLoopIds(loops);
    const lane = classifyLoop(loops[0], { superseded, now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(lane, 'working', 'a fresh, non-terminal run with only a [pending] marker must never read as blocked');
  });

  test('ordering: an operator-cancelled row carrying a stale [blocked] marker lands resolved, not blocked', () => {
    const hist = historyItem({
      id: 'h-cancelled-blocked', issueIdentifier: 'LIN-309', status: 'cancelled',
      feedback: [{ message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' }]
    });
    const loops = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    const superseded = computeSupersededLoopIds(loops);
    const lane = classifyLoop(loops[0], { superseded, now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(lane, 'resolved', 'resolved must be checked before blocked — an operator close-out wins over a stale wake marker');
  });

  test('blocked is never folded into terminal, and dead is never a reachable classification', () => {
    const hist = historyItem({
      id: 'h-neverdead', issueIdentifier: 'LIN-303',
      feedback: [{ message: '[blocked] waiting', timestamp: '2026-04-11T11:10:00.000Z' }]
    });
    const loops = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    const superseded = computeSupersededLoopIds(loops);
    const lane = classifyLoop(loops[0], { superseded, now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(lane, 'blocked');
    assert.notStrictEqual(lane, 'terminal', 'blocked must never be folded into terminal');
    assert.ok(LANE_KEYS.includes(lane), 'every classification must be one of the 7 known lanes');
    assert.ok(!LANE_KEYS.includes('dead'), 'dead is not a lane this classifier can ever emit (LIN-1952 unresolved)');
  });

  test('successor exclusion via computeSupersededLoopIds — a CROSS-ISSUE followUpTo excludes a blocked row', () => {
    const original = historyItem({
      id: 'x1', issueIdentifier: 'LIN-401', dispatchedAt: '2026-04-11T10:00:00.000Z',
      feedback: [{ message: '[blocked] need a decision', timestamp: '2026-04-11T10:05:00.000Z' }]
    });
    const followUp = historyItem({
      id: 'y1', issueIdentifier: 'LIN-402', followUpTo: 'x1',
      feedback: [{ message: '[done] resumed and finished', timestamp: '2026-04-11T11:30:00.000Z' }]
    });
    // A workspace-wide read merges both issues into one array — only reachable
    // via getLoopsForWorkspace, never getLoopsForIssue (which would only ever
    // see one of the two issues and so could never compute this exclusion).
    const loops = _buildLoops({ historyItems: [original, followUp], now: NOW, lean: true });
    const loopX = loops.find((l) => l.loopId === 'x1');
    assert.ok(loopX, 'sanity: x1 must be present in the workspace-wide read');

    const withoutExclusion = classifyLoop(loopX, { superseded: new Set(), now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(withoutExclusion, 'blocked', 'control: absent any exclusion, a stale [blocked] row reads blocked');

    const superseded = computeSupersededLoopIds(loops);
    assert.ok(superseded.has('x1'), 'y1 (a DIFFERENT issue) names x1 via followUpTo — invisible to an issue-scoped read');

    const withExclusion = classifyLoop(loopX, { superseded, now: NOW_MS, staleMs: STALE_MS });
    assert.notStrictEqual(withExclusion, 'blocked', 'x1 has been answered by a cross-issue follow-up — must not read as forever-blocked');
    assert.strictEqual(withExclusion, 'silent', 'excluded from blocked, x1 falls through to its own (stale) activity signal');
  });
});

// ─── C. Idempotency (real MangoDB tmpdir) ─────────────────────────────────

describe('observer-sweep: idempotency (real MangoDB tmpdir, LIN-2131 / LIN-2128 ledger item B)', () => {
  let dbDir;
  let client;
  let dbCounter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'observer-sweep-idem-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStores() {
    const db = client.db(`osw_${dbCounter++}`);
    const dispatchStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
      ttl: 24 * 60 * 60
    });
    const agentStatusStore = new AgentStatusStore({ collection: db.collection('foreman-status') });
    const observerStateStore = new ObserverStateStore({ collection: db.collection('observer-state') });
    return { dispatchStore, agentStatusStore, observerStateStore };
  }

  test('firing the sweep twice over identical input converges — same rev, no ledger growth, attention self-sorted', async () => {
    const { dispatchStore, agentStatusStore, observerStateStore } = freshStores();
    const urlKey = `ws-idem-${randomUUID()}`;

    // One still-queued row, plus two agent-status-blocked rows (F2 path) so
    // attention carries >= 2 entries — enough to meaningfully assert sorting.
    await dispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'implementation' });
    const queuedA = await dispatchStore.addItem(urlKey, { prompt: 'pa', issueIdentifier: 'LIN-2', promptName: 'implementation' });
    const archivedA = await dispatchStore.takeItem(queuedA._id, urlKey, 'consumer-1');
    const queuedB = await dispatchStore.addItem(urlKey, { prompt: 'pb', issueIdentifier: 'LIN-3', promptName: 'implementation' });
    const archivedB = await dispatchStore.takeItem(queuedB._id, urlKey, 'consumer-1');
    await agentStatusStore.recordStatus({ urlKey, taskIdentifier: 'LIN-2', action: 'implementation', status: 'blocked', summary: 'blocked A', dispatchId: archivedA.id, timestamp: new Date() });
    await agentStatusStore.recordStatus({ urlKey, taskIdentifier: 'LIN-3', action: 'implementation', status: 'blocked', summary: 'blocked B', dispatchId: archivedB.id, timestamp: new Date() });

    const now = Date.now();
    const deps = { dispatchStore, agentStatusStore, observerStateStore, now };
    const instanceKey = `sweep:v1:${urlKey}`;

    await sweepOneWorkspace(urlKey, deps);
    const doc1 = await observerStateStore.readCurrent(instanceKey);
    assert.ok(doc1, 'first sweep must seed and advance to a real document');
    assert.strictEqual(doc1.rev, 2, 'seed (rev 1) then exactly one genuine advance (rev 2)');
    assert.strictEqual(doc1.ledger.length, 1);
    assert.strictEqual(doc1.state.lanes.queued, 1);
    assert.strictEqual(doc1.state.lanes.blocked, 2);
    assert.strictEqual(doc1.state.attention.length, 2);
    // stableStringify sorts object keys but preserves array order, and
    // canonicalizeForHash maps arrays without sorting either — the sweep must
    // sort attention itself.
    const [first, second] = doc1.state.attention;
    assert.ok(first.loopId < second.loopId, 'attention must be sorted ascending by loopId');

    await sweepOneWorkspace(urlKey, deps);
    const doc2 = await observerStateStore.readCurrent(instanceKey);
    assert.strictEqual(doc2.rev, doc1.rev, 'a duplicate tick over identical input must not advance rev');
    assert.strictEqual(doc2.ledger.length, doc1.ledger.length, 'a duplicate tick must not grow the ledger');
    assert.deepStrictEqual(doc2.state, doc1.state, 'the stored document must be byte-identical across duplicate ticks');
  });

  test('interleaved/duplicate ticks (MangoDB gives no cross-process exclusivity — the sweep is the safety net)', async () => {
    const { dispatchStore, agentStatusStore, observerStateStore } = freshStores();
    const urlKey = `ws-interleaved-${randomUUID()}`;
    await dispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-9', promptName: 'implementation' });

    const now = Date.now();
    const deps = { dispatchStore, agentStatusStore, observerStateStore, now };
    const instanceKey = `sweep:v1:${urlKey}`;

    await Promise.all([sweepOneWorkspace(urlKey, deps), sweepOneWorkspace(urlKey, deps)]);

    const doc = await observerStateStore.readCurrent(instanceKey);
    assert.ok(doc, 'exactly one document must exist for this instance');
    assert.strictEqual(doc.rev, 2, 'two concurrent identical-payload ticks converge to ONE genuine advance, never two');
    assert.strictEqual(doc.ledger.length, 1, 'a genuine collision produces a lost update, never a duplicate ledger row');
  });

  test('mutant control: a payload carrying a per-tick-varying field breaks idempotency (proves the assertions above are discriminating)', async () => {
    const { observerStateStore } = freshStores();
    const instanceKey = `sweep:v1:mutant-${randomUUID()}`;
    const seeded = await observerStateStore.ensureSeeded(instanceKey, { v: 1, seeded: true });

    const baseLanes = { working: 1, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 };
    const mutantA = { v: 1, lanes: baseLanes, attention: [], truncated: false, sweptAt: new Date(Date.now()).toISOString() };
    const r1 = await observerStateStore.advance(instanceKey, seeded.rev, mutantA, { reason: 'sweep' });
    assert.strictEqual(r1, true);
    const after1 = await observerStateStore.readCurrent(instanceKey);

    const mutantB = { ...mutantA, sweptAt: new Date(Date.now() + 1000).toISOString() };
    const r2 = await observerStateStore.advance(instanceKey, after1.rev, mutantB, { reason: 'sweep' });
    assert.strictEqual(r2, true, 'a differing sweptAt hashes differently, so the CAS sees a genuine transition every tick');
    const after2 = await observerStateStore.readCurrent(instanceKey);
    assert.notStrictEqual(after2.rev, after1.rev, 'the mutant keeps advancing on every tick — exactly the regression the real payload contract avoids by carrying no such field');
  });
});

// ─── D. Negative capability ────────────────────────────────────────────────

describe('observer-sweep: negative capability — no automated-intervention path is reachable (hard invariant; LIN-2128 ledger item B)', () => {
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

  let dbDir;
  let client;
  let dbCounter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'observer-sweep-negative-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  test('the allowlist fails loudly, naming the exact forbidden method — not merely absent or silently no-op', () => {
    const db = client.db(`neg_probe_${dbCounter++}`);
    const realStore = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
    const guarded = forbiddenProxy(realStore, ['listItems', 'listHistory'], 'dispatchStore');
    assert.throws(
      () => guarded.addItem('ws', { prompt: 'x' }),
      /forbidden intervention path: dispatchStore\.addItem/,
      'a future write call must fail by naming it, so a regression cannot pass silently'
    );
    assert.throws(() => guarded.takeItem('some-id'), /forbidden intervention path: dispatchStore\.takeItem/);
  });

  test('sweepOneWorkspace, run entirely through a read-only-allowlisted Proxy over every store, makes no forbidden call and no dispatch/agent-status write', async () => {
    const db = client.db(`neg_${dbCounter++}`);
    const dispatchQueueCollection = db.collection('dispatch-queue');
    const dispatchHistoryCollection = db.collection('dispatch-history');
    const agentStatusCollection = db.collection('foreman-status');

    const realDispatchStore = new DispatchQueueStore({ collection: dispatchQueueCollection, historyCollection: dispatchHistoryCollection, ttl: 86400 });
    const realAgentStatusStore = new AgentStatusStore({ collection: agentStatusCollection });
    const realObserverStateStore = new ObserverStateStore({ collection: db.collection('observer-state') });

    const urlKey = `ws-negative-${randomUUID()}`;
    // Seed real fleet data through the REAL (unguarded) stores — setup, not
    // part of the sweep under test.
    await realDispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'implementation' });
    const taken = await realDispatchStore.addItem(urlKey, { prompt: 'p2', issueIdentifier: 'LIN-2', promptName: 'implementation' });
    const archived = await realDispatchStore.takeItem(taken._id, urlKey, 'consumer-1');
    await realAgentStatusStore.recordStatus({ urlKey, taskIdentifier: 'LIN-2', action: 'implementation', status: 'blocked', summary: 'blocked', dispatchId: archived.id, timestamp: new Date() });

    const countsBefore = {
      queue: (await dispatchQueueCollection.find({ urlKey }).toArray()).length,
      history: (await dispatchHistoryCollection.find({ urlKey }).toArray()).length,
      status: (await agentStatusCollection.find({ urlKey }).toArray()).length
    };

    const dispatchStore = forbiddenProxy(realDispatchStore, ['listItems', 'listHistory'], 'dispatchStore');
    const agentStatusStore = forbiddenProxy(realAgentStatusStore, ['listStatus'], 'agentStatusStore');
    const observerStateStore = forbiddenProxy(realObserverStateStore, ['readCurrent', 'ensureSeeded', 'advance'], 'observerStateStore');

    const net = guardNetwork();
    const now = Date.now();
    const deps = { dispatchStore, agentStatusStore, observerStateStore, now };

    // Run twice — also re-proves idempotency under this exact capability
    // boundary, discharging LIN-2128 ledger item B: a harness that only sees
    // calls through these injected seams.
    await sweepOneWorkspace(urlKey, deps);
    await sweepOneWorkspace(urlKey, deps);

    assert.strictEqual(net.attempts.length, 0, 'this tier makes no /api/proxy call and no model call');
    net.restore();

    const doc = await realObserverStateStore.readCurrent(`sweep:v1:${urlKey}`);
    assert.ok(doc, 'the guarded sweep must still have produced a real document');
    assert.strictEqual(doc.ledger.length, 1, 'two identical ticks through the guard converge — no forbidden call, no duplicate transition');

    const countsAfter = {
      queue: (await dispatchQueueCollection.find({ urlKey }).toArray()).length,
      history: (await dispatchHistoryCollection.find({ urlKey }).toArray()).length,
      status: (await agentStatusCollection.find({ urlKey }).toArray()).length
    };
    assert.deepStrictEqual(countsAfter, countsBefore, 'no dispatch write and no agent-status write occurred during the guarded sweep');
  });

  test('static import assertion: lib/observer-sweep.js imports only pure, read-only modules', () => {
    // Honest limitation (stated, not hidden): this only sees calls reachable
    // through the injected dispatchStore/agentStatusStore/observerStateStore
    // seams above, plus what the module itself statically imports. It does
    // NOT cover a dynamic `await import(...)`, which neither this assertion
    // nor the Proxy allowlist above can see.
    const modulePath = fileURLToPath(new URL('../../lib/observer-sweep.js', import.meta.url));
    const src = readFileSync(modulePath, 'utf8');
    const specifiers = [...src.matchAll(/^import\s+[^;]*?from\s+['"](.+?)['"]\s*;?\s*$/gm)].map((m) => m[1]);
    assert.deepStrictEqual(
      specifiers.sort(),
      ['./live-console.js', './loop-supersede.js', './pipeline-loops.js'].sort(),
      'a new import here (e.g. a direct dispatch-store/agent-status-store import bypassing the injected deps seam) must be caught by this assertion'
    );
  });
});

// ─── E. Roster derivation ───────────────────────────────────────────────────

describe('observer-sweep: resolveRosterFromSessions (LIN-2131)', () => {
  test('dedupes across rows and sorts; string and pre-parsed session shapes both supported', () => {
    const sessions = [
      { session: JSON.stringify({ workspaces: [{ urlKey: 'ws-b' }, { urlKey: 'ws-a' }] }) },
      { session: { workspaces: [{ urlKey: 'ws-a' }] } }
    ];
    assert.deepStrictEqual(resolveRosterFromSessions(sessions), ['ws-a', 'ws-b']);
  });

  test('minor 1: an unparseable session string is skipped, not thrown, and LATER rows still contribute', () => {
    const sessions = [
      { session: '{not valid json' },
      { session: JSON.stringify({ workspaces: [{ urlKey: 'ws-later' }] }) }
    ];
    assert.doesNotThrow(() => resolveRosterFromSessions(sessions));
    assert.deepStrictEqual(resolveRosterFromSessions(sessions), ['ws-later']);
  });

  test('a missing or malformed workspaces value is skipped, not thrown', () => {
    const sessions = [
      { session: JSON.stringify({}) },
      { session: JSON.stringify({ workspaces: 'not-an-array' }) },
      { session: JSON.stringify({ workspaces: null }) },
      { session: JSON.stringify({ workspaces: [{ notUrlKey: 'x' }] }) },
      { session: JSON.stringify({ workspaces: [{ urlKey: 'ws-good' }] }) }
    ];
    assert.deepStrictEqual(resolveRosterFromSessions(sessions), ['ws-good']);
  });

  test('an empty roster (empty or missing sessions) returns [], not an error', () => {
    assert.deepStrictEqual(resolveRosterFromSessions([]), []);
    assert.deepStrictEqual(resolveRosterFromSessions(undefined), []);
  });
});
