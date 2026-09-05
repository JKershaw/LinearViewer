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
 *   B. Payload contract — the same fixtures driven through the PRODUCTION
 *      entry point `buildSweepPayload` rather than `classifyLoop` with a
 *      hand-computed set, so successor exclusion, `attention` membership and
 *      `attention` ordering are asserted on the path F3 actually protects
 *      (review ledger items 1, 3, 4).
 *   C. Idempotency — a REAL MangoDB tmpdir (precedent:
 *      tests/unit/observer-state-store.test.js:19-32), never
 *      tests/fixtures/mock-collection.js: its own header confirms it lacks
 *      $setOnInsert, so it cannot exercise ensureSeeded's seed path.
 *   D. Negative capability — a Proxy read-only allowlist over every injected
 *      store, paired with a static import assertion and guardNetwork().
 *   E. Roster derivation.
 *   F. Production wiring — `createObserverSweepRun`, the scheduler `run`
 *      closure lifted out of server.js so the roster read, its fail-soft, the
 *      round-robin and the deps object are reachable at all (close-out ledger
 *      item 6), plus the `deps.now` guard (item 9).
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
import { DEFAULT_LANE_STALE_MS, loopLastActivityMs } from '../../lib/live-console.js';
import {
  classifyLoop,
  buildSweepPayload,
  sweepOneWorkspace,
  resolveRosterFromSessions,
  mergeRosterUnion,
  createObserverSweepRun
} from '../../lib/observer-sweep.js';
import { ObserverStateStore } from '../../lib/observer-state-store.js';
import { ObserverShadowLogStore } from '../../lib/observer-shadow-log.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { isWakeEvent } from '../../lib/dispatch-terminal.js';
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

// ─── B. Payload contract (buildSweepPayload, the production entry point) ───

describe('observer-sweep: payload contract (LIN-2131)', () => {
  // Every test here drives `buildSweepPayload` rather than `classifyLoop` with
  // a hand-computed `superseded` set. That distinction is the whole point:
  // review ledger item 1 established empirically that replacing
  // `computeSupersededLoopIds(loops)` with `new Set()` inside
  // `buildSweepPayload` survived the entire suite, because the only exclusion
  // coverage called `classifyLoop` directly and so never exercised the
  // production path F3 exists to protect.

  test('ledger 1 — buildSweepPayload itself applies successor exclusion: a blocked row with a CROSS-ISSUE follow-up leaves lanes.blocked and attention', () => {
    // Fresh dispatch (5 min before NOW) so that, once excluded from blocked,
    // the row falls to `working` rather than `silent` — `silent` is itself an
    // attention lane, which would leave the row listed and mask the exclusion.
    const original = historyItem({
      id: 'x2', issueIdentifier: 'LIN-411', dispatchedAt: '2026-04-11T11:55:00.000Z',
      feedback: [{ message: '[blocked] need a decision', timestamp: '2026-04-11T11:56:00.000Z' }]
    });
    const followUp = historyItem({
      id: 'y2', issueIdentifier: 'LIN-412', followUpTo: 'x2',
      feedback: [{ message: '[done] resumed and finished', timestamp: '2026-04-11T11:58:00.000Z' }]
    });
    const loops = _buildLoops({ historyItems: [original, followUp], now: NOW, lean: true });
    const loopX = loops.find((l) => l.loopId === 'x2');
    assert.ok(loopX, 'sanity: x2 must be present in the workspace-wide read');

    // Control: absent exclusion this row IS blocked, so the assertions below
    // are discriminating rather than vacuously true of the fixture.
    assert.strictEqual(
      classifyLoop(loopX, { superseded: new Set(), now: NOW_MS, staleMs: STALE_MS }),
      'blocked',
      'control: with no exclusion applied, x2 reads blocked'
    );

    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(payload.lanes.blocked, 0, 'buildSweepPayload must compute and apply the exclusion itself, not merely accept one');
    assert.strictEqual(payload.lanes.working, 1, 'excluded from blocked, x2 falls through to its own (fresh) activity signal');
    assert.strictEqual(payload.lanes.terminal, 1, 'the [done] follow-up y2');
    assert.ok(!payload.attention.some((row) => row.loopId === 'x2'), 'an answered row must never be surfaced as waiting on a human');
    assert.deepStrictEqual(payload.attention, [], 'nothing in this fixture is waiting on anyone');
  });

  test('ledger 4 — successor exclusion covers the AGENT-STATUS channel too: an agentState "waiting" row with a dispatched successor is excluded', () => {
    // The sibling of the test above on the other blocked channel (plan step 5
    // named this case explicitly). The union runs first and exclusion once
    // after it, so this is right by construction — but only an assertion makes
    // that structural claim a checked one.
    const original = historyItem({ id: 'a1', issueIdentifier: 'LIN-421' }); // no feedback at all
    const followUp = historyItem({
      id: 'b1', issueIdentifier: 'LIN-422', followUpTo: 'a1',
      feedback: [{ message: '[done] resumed and finished', timestamp: '2026-04-11T11:30:00.000Z' }]
    });
    const agentStatuses = [
      agentStatusEntry({ dispatchId: 'a1', taskIdentifier: 'LIN-421', status: 'blocked', timestamp: '2026-04-11T11:02:00.000Z' })
    ];
    const loops = _buildLoops({ historyItems: [original, followUp], agentStatusEntries: agentStatuses, now: NOW, lean: true });
    const loopA = loops.find((l) => l.loopId === 'a1');
    assert.strictEqual(loopA.wakeMarker, null, 'no feedback marker was ever posted — the agent-status channel alone carries the signal');
    assert.strictEqual(loopA.agentState, 'waiting');
    assert.strictEqual(
      classifyLoop(loopA, { superseded: new Set(), now: NOW_MS, staleMs: STALE_MS }),
      'blocked',
      'control: with no exclusion applied, the agent-status-blocked row reads blocked'
    );

    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(payload.lanes.blocked, 0, 'exclusion must apply to the agent-status channel exactly as it does to the feedback-marker one');
    assert.strictEqual(payload.lanes.unknown, 1, 'an excluded waiting row is not active (agentState "waiting"), so it falls to unknown');
    assert.ok(!payload.attention.some((row) => row.loopId === 'a1'), 'an answered row must never be surfaced as waiting on a human');
  });

  test('ledger 3 — attention is deterministically sorted, from a fixture whose insertion order is NOT already sorted (LIN-2619: by recency, not loopId — attentionKeysFull stays loopId-sorted)', () => {
    const rows = [
      historyItem({
        id: 'zz-blocked', issueIdentifier: 'LIN-431', dispatchedAt: '2026-04-11T11:50:00.000Z',
        feedback: [{ message: '[blocked] one', timestamp: '2026-04-11T11:51:00.000Z' }]
      }),
      historyItem({
        id: 'aa-blocked', issueIdentifier: 'LIN-432', dispatchedAt: '2026-04-11T11:40:00.000Z',
        feedback: [{ message: '[blocked] two', timestamp: '2026-04-11T11:41:00.000Z' }]
      }),
      historyItem({
        id: 'mm-blocked', issueIdentifier: 'LIN-433', dispatchedAt: '2026-04-11T11:45:00.000Z',
        feedback: [{ message: '[blocked] three', timestamp: '2026-04-11T11:46:00.000Z' }]
      })
    ];
    const loops = _buildLoops({ historyItems: rows, now: NOW, lean: true });
    const readOrder = loops.map((l) => l.loopId);
    const alphabeticalOrder = [...readOrder].sort();
    // Load-bearing guard: the original coverage passed with the sort line
    // deleted precisely because its fixture arrived pre-sorted. If a future
    // change to _buildLoops' ordering makes this fixture sorted too, this
    // assertion fails loudly instead of quietly re-opening the hole.
    assert.notDeepStrictEqual(readOrder, alphabeticalOrder, 'fixture must reach buildSweepPayload UNSORTED, or it cannot detect a missing sort');

    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(payload.attention.length, 3, 'all three blocked rows are waiting on a human');
    // LIN-2619: attention now ranks by recency of `since` (most-recent first),
    // NOT by loopId — zz-blocked (11:50) is the most recently transitioned,
    // aa-blocked (11:40) the least, deliberately the REVERSE of the
    // alphabetical order asserted here before this ticket.
    assert.deepStrictEqual(
      payload.attention.map((r) => r.loopId),
      ['zz-blocked', 'mm-blocked', 'aa-blocked'],
      'sorted by recency of `since`, most-recently-transitioned first'
    );
    assert.deepStrictEqual(
      payload.attention,
      [...payload.attention].sort((a, b) => (a.since > b.since ? -1 : a.since < b.since ? 1 : (a.loopId < b.loopId ? -1 : 1))),
      'attention must equal its own sorted-by-recency copy — stableStringify preserves array order, so an unsorted array hashes differently tick to tick'
    );
    // attentionKeysFull is a SEPARATE, additive key (LIN-2619 open question
    // (c)) with its own independent contract: sorted by loopId, unaffected by
    // the recency ranking above.
    assert.deepStrictEqual(
      payload.attentionKeysFull.map((tuple) => tuple[0]),
      alphabeticalOrder,
      'attentionKeysFull sorts by loopId, independent of attention\'s recency order'
    );
  });
});

// ─── G. Freshness ranking & fossil collapse (LIN-2619, beat 2) ────────────

describe('observer-sweep: freshness ranking & fossil collapse (LIN-2619)', () => {
  test('a row transitioned an hour ago ranks above a non-fossil row 3 days silent, and a genuinely fossil row (29 days) is counted, not enumerated', () => {
    // A 29-day-old row also exceeds FOSSIL_AGE_MS (7 days) — there is no way
    // to observe "ranks above" for a row that old without it ALSO being
    // fossil-excluded, so this one fixture proves both contracts together:
    // ranking among the survivors, and correct fossil exclusion of the row
    // that can't survive to be ranked at all.
    const rows = [
      historyItem({
        // Alphabetically LAST but the most recent — proves the surviving
        // order comes from recency, not loopId (a loopId-ascending sort of
        // the two survivors would read ['mm-medium', 'zz-fresh'], the reverse).
        id: 'zz-fresh', issueIdentifier: 'LIN-501', dispatchedAt: '2026-04-11T11:00:00.000Z', // 1h ago
        feedback: [{ message: '[blocked] recent', timestamp: '2026-04-11T11:00:00.000Z' }]
      }),
      historyItem({
        id: 'mm-medium', issueIdentifier: 'LIN-502', dispatchedAt: '2026-04-08T12:00:00.000Z', // 3 days ago
        feedback: [{ message: '[blocked] a few days', timestamp: '2026-04-08T12:00:00.000Z' }]
      }),
      historyItem({
        id: 'aa-fossil', issueIdentifier: 'LIN-503', dispatchedAt: '2026-03-13T12:00:00.000Z', // 29 days ago
        feedback: [{ message: '[blocked] ancient', timestamp: '2026-03-13T12:00:00.000Z' }]
      })
    ];
    const loops = _buildLoops({ historyItems: rows, now: NOW, lean: true });
    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });

    assert.deepStrictEqual(
      payload.attention.map((r) => r.loopId),
      ['zz-fresh', 'mm-medium'],
      'the fossil row is excluded from the enumerated array; the two survivors rank most-recent-first, NOT alphabetically'
    );
    assert.strictEqual(payload.staleAttentionCount, 1, 'exactly the one 29-day-old row is counted as a fossil');
    assert.strictEqual(payload.staleAttentionThresholdMs, 7 * 24 * 60 * 60 * 1000, 'threshold mirrors FOSSIL_AGE_MS verbatim');
    assert.strictEqual(payload.truncated, false, 'truncated reflects only ATTENTION_CAP truncation of the FRESH population — 2 rows never trips a 25 cap');
    assert.deepStrictEqual(
      payload.attentionKeysFull.map((tuple) => tuple[0]).sort(),
      ['zz-fresh', 'mm-medium', 'aa-fossil'].sort(),
      'attentionKeysFull carries the fossil row too — untouched by the fossil filter'
    );
  });

  test('two rows with the IDENTICAL `since` timestamp tie-break deterministically by loopId, never by insertion/engine order', () => {
    const rows = [
      // Inserted zz before aa — insertion order already disagrees with the
      // expected loopId tie-break order, so a sort that silently falls back
      // to "leave ties as found" would pass this fixture by accident only if
      // insertion order happened to already be ascending; it is not.
      historyItem({
        id: 'zz-tie', issueIdentifier: 'LIN-511', dispatchedAt: '2026-04-11T11:30:00.000Z',
        feedback: [{ message: '[blocked] tie one', timestamp: '2026-04-11T11:30:00.000Z' }]
      }),
      historyItem({
        id: 'aa-tie', issueIdentifier: 'LIN-512', dispatchedAt: '2026-04-11T11:30:00.000Z',
        feedback: [{ message: '[blocked] tie two', timestamp: '2026-04-11T11:30:00.000Z' }]
      })
    ];
    const loops = _buildLoops({ historyItems: rows, now: NOW, lean: true });
    assert.strictEqual(loops.find((l) => l.loopId === 'zz-tie') && loopLastActivityMs(loops.find((l) => l.loopId === 'zz-tie')), loopLastActivityMs(loops.find((l) => l.loopId === 'aa-tie')), 'sanity: both rows must carry the exact same since timestamp for this to be a real tie');

    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    assert.deepStrictEqual(
      payload.attention.map((r) => r.loopId),
      ['aa-tie', 'zz-tie'],
      'equal timestamps must tie-break ascending by loopId, deterministically, regardless of insertion order'
    );
  });

  test('a blocked row with loopLastActivityMs === 0 (epoch, the beat-1 finding) never crashes, is treated as maximally stale, and still appears in attentionKeysFull', () => {
    // Unreachable via _buildLoops (Note 1, top of file): `_buildLoops` skips
    // any row whose `dispatchedAt` fails to parse, so every loop THAT PATH can
    // ever produce already carries a non-zero `loopLastActivityMs`. A `blocked`
    // row can still reach this shape in principle (classifyLoop's `blocked`
    // branch never checks `loopLastActivityMs` at all, unlike `silent`), so this
    // is a hand-built loop object bypassing `_buildLoops` — the only way to
    // fixture the case buildSweepPayload's new ranking/fossil logic must not
    // crash on.
    const handBuiltZero = {
      loopId: 'hand-blocked-zero',
      issueIdentifier: 'LIN-599',
      stage: 'implementation',
      terminalStatus: null,
      wakeMarker: 'blocked',
      agentState: null,
      historyStatus: null,
      source: 'history',
      dispatchedAt: null,
      agentTimestamp: null,
      telemetry: null,
      lineageLastActivityMs: null
    };
    const freshRow = historyItem({
      id: 'fresh-control', issueIdentifier: 'LIN-598', dispatchedAt: '2026-04-11T11:00:00.000Z',
      feedback: [{ message: '[blocked] recent', timestamp: '2026-04-11T11:00:00.000Z' }]
    });
    const loops = [..._buildLoops({ historyItems: [freshRow], now: NOW, lean: true }), handBuiltZero];

    let payload;
    assert.doesNotThrow(() => { payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS }); }, 'an epoch-zero since must never crash the sweep');

    assert.strictEqual(payload.lanes.blocked, 2, 'both rows classify blocked');
    assert.ok(!payload.attention.some((r) => r.loopId === 'hand-blocked-zero'), 'epoch-zero is maximally stale — always past FOSSIL_AGE_MS, never enumerated as fresh');
    assert.strictEqual(payload.staleAttentionCount, 1, 'the epoch-zero row is folded into the fossil count');
    assert.ok(
      payload.attentionKeysFull.some((tuple) => tuple[0] === 'hand-blocked-zero' && tuple[1] === 'blocked' && tuple[2] === 'implementation'),
      'attentionKeysFull still carries its identity tuple, untouched by the fossil filter'
    );
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

  test('firing the sweep repeatedly over identical input converges — same rev, no ledger growth, attention self-sorted, including a tick taken at a LATER clock', async () => {
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
    // sort attention itself. LIN-2619: the sort key is now recency of `since`
    // (most-recently-transitioned first, loopId tie-break), not loopId alone —
    // asserted via self-consistency (mirrors the payload-contract "ledger 3"
    // test) rather than a hardcoded relative order, since these two rows'
    // real `since` timestamps come from real, close-together `new Date()`
    // calls and are not deterministically orderable by loopId alone.
    assert.deepStrictEqual(
      doc1.state.attention,
      [...doc1.state.attention].sort((a, b) => (a.since > b.since ? -1 : a.since < b.since ? 1 : (a.loopId < b.loopId ? -1 : 1))),
      'attention must equal its own sorted-by-recency copy'
    );

    await sweepOneWorkspace(urlKey, deps);
    const doc2 = await observerStateStore.readCurrent(instanceKey);
    assert.strictEqual(doc2.rev, doc1.rev, 'a duplicate tick over identical input must not advance rev');
    assert.strictEqual(doc2.ledger.length, doc1.ledger.length, 'a duplicate tick must not grow the ledger');
    assert.deepStrictEqual(doc2.state, doc1.state, 'the stored document must be byte-identical across duplicate ticks');

    // Ledger item 2: the two ticks above share one `now`, so they cannot see a
    // payload field derived from the CLOCK rather than from the fleet — adding
    // `sweptAt: new Date(now).toISOString()` to buildSweepPayload's return
    // survived them. Fire a third tick with the clock advanced by ADVANCE_MS
    // (5 min — the fixture's activity is ~`now`, so every row stays ~5 min
    // old against a 1h staleness threshold, far from the boundary and
    // therefore classified identically). Same fleet, later clock, same
    // document: that is the actual no-per-tick-varying-field contract.
    const ADVANCE_MS = 5 * 60 * 1000;
    assert.ok(ADVANCE_MS * 2 < DEFAULT_LANE_STALE_MS, 'sanity: the advance must stay well clear of the staleness boundary');
    await sweepOneWorkspace(urlKey, { ...deps, now: now + ADVANCE_MS });
    const doc3 = await observerStateStore.readCurrent(instanceKey);
    assert.strictEqual(doc3.rev, doc1.rev, 'an ADVANCING clock over identical fleet state must not advance rev — no payload field may vary per tick');
    assert.strictEqual(doc3.ledger.length, doc1.ledger.length, 'a later-clock tick must not grow the ledger');
    assert.deepStrictEqual(doc3.state, doc1.state, 'the stored document must be byte-identical across ticks taken at DIFFERENT times');
  });

  test('LIN-2619: stateHash (via the real ObserverStateStore advance()/stableStringify path) is unchanged for an unchanged census, with the new staleAttentionCount/staleAttentionThresholdMs/attentionKeysFull fields present', async () => {
    const { dispatchStore, agentStatusStore, observerStateStore } = freshStores();
    const urlKey = `ws-fossil-hash-${randomUUID()}`;

    const item = await dispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-7', promptName: 'implementation' });
    const taken = await dispatchStore.takeItem(item._id, urlKey, 'consumer-1');
    await agentStatusStore.recordStatus({ urlKey, taskIdentifier: 'LIN-7', action: 'implementation', status: 'blocked', summary: 'blocked', dispatchId: taken.id, timestamp: new Date() });

    const now = Date.now();
    const deps = { dispatchStore, agentStatusStore, observerStateStore, now };
    const instanceKey = `sweep:v1:${urlKey}`;

    await sweepOneWorkspace(urlKey, deps);
    const doc1 = await observerStateStore.readCurrent(instanceKey);
    assert.strictEqual(doc1.rev, 2, 'seed (rev 1) then one genuine advance (rev 2)');
    assert.strictEqual(doc1.state.staleAttentionCount, 0, 'a freshly-blocked row is not a fossil');
    assert.strictEqual(doc1.state.staleAttentionThresholdMs, 7 * 24 * 60 * 60 * 1000);
    assert.strictEqual(doc1.state.attentionKeysFull.length, 1);

    await sweepOneWorkspace(urlKey, deps);
    const doc2 = await observerStateStore.readCurrent(instanceKey);
    assert.strictEqual(doc2.rev, doc1.rev, 'an unchanged census (same fleet, identical new fields too) must not advance rev — the LIN-2129 duplicate-tick gate still works');
    assert.deepStrictEqual(doc2.state, doc1.state, 'the stored document, including the three new LIN-2619 fields, must be byte-identical across duplicate ticks');
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

  // ─── Sweep-liveness heartbeat (LIN-2438) ───────────────────────────────
  //
  // The write-site measurement pin: a stale-lastSeenAt gate test can read
  // green while the write side never actually refreshes the stamp on a real
  // sweep run. These tests are what make that measurement valid.

  test('LIN-2438 T10: a DUPLICATE tick (byte-identical census, advance() no-op) still refreshes the sweep instance\'s lastSeenAt', async () => {
    const { dispatchStore, agentStatusStore, observerStateStore } = freshStores();
    const urlKey = `ws-heartbeat-${randomUUID()}`;
    await dispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'implementation' });

    const now = Date.now();
    const deps = { dispatchStore, agentStatusStore, observerStateStore, now };
    const instanceKey = `sweep:v1:${urlKey}`;

    await sweepOneWorkspace(urlKey, deps);
    const doc1 = await observerStateStore.readCurrent(instanceKey);
    assert.ok(doc1, 'first sweep must seed and advance to a real document');

    // Force lastSeenAt far into the past so a subsequent refresh is
    // unambiguous — real-clock resolution alone could hide a same-tick
    // no-op (precedent: tests/unit/observer-state-store.test.js:544/726).
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await observerStateStore.collection.updateOne({ _id: instanceKey }, { $set: { lastSeenAt: longAgo } });

    // Second tick over the IDENTICAL fleet — advance()'s duplicate-tick
    // branch makes no write at all, so only the heartbeat can move lastSeenAt.
    await sweepOneWorkspace(urlKey, deps);
    const doc2 = await observerStateStore.readCurrent(instanceKey);
    assert.strictEqual(doc2.rev, doc1.rev, 'sanity: this must actually be a duplicate no-op, not a genuine transition');
    assert.ok(doc2.lastSeenAt.getTime() > longAgo.getTime(), 'a duplicate tick must still refresh lastSeenAt via the heartbeat');
  });

  test('LIN-2438 T11: the heartbeat leaves rev, state, stateHash, updatedAt and ledger untouched', async () => {
    const { dispatchStore, agentStatusStore, observerStateStore } = freshStores();
    const urlKey = `ws-heartbeat-inert-${randomUUID()}`;
    await dispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'implementation' });

    const now = Date.now();
    const deps = { dispatchStore, agentStatusStore, observerStateStore, now };
    const instanceKey = `sweep:v1:${urlKey}`;

    await sweepOneWorkspace(urlKey, deps);
    const doc1 = await observerStateStore.readCurrent(instanceKey);

    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await observerStateStore.collection.updateOne({ _id: instanceKey }, { $set: { lastSeenAt: longAgo } });

    await sweepOneWorkspace(urlKey, deps);
    const doc2 = await observerStateStore.readCurrent(instanceKey);

    assert.strictEqual(doc2.rev, doc1.rev, 'rev must be untouched by the heartbeat');
    assert.deepStrictEqual(doc2.state, doc1.state, 'state must be untouched by the heartbeat');
    assert.strictEqual(doc2.stateHash, doc1.stateHash, 'stateHash must be untouched by the heartbeat');
    assert.strictEqual(doc2.updatedAt.getTime(), doc1.updatedAt.getTime(), 'updatedAt (last-CHANGED) must be untouched by the heartbeat');
    assert.deepStrictEqual(doc2.ledger, doc1.ledger, 'the ledger must be untouched by the heartbeat');
    assert.ok(doc2.lastSeenAt.getTime() > longAgo.getTime(), 'sanity: the heartbeat must have actually fired');
  });

  test('LIN-2438 T12: a tick that throws before advance() (rejecting getLoopsForWorkspace) writes no heartbeat', async () => {
    const { dispatchStore, agentStatusStore, observerStateStore } = freshStores();
    const urlKey = `ws-heartbeat-throw-${randomUUID()}`;
    await dispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'implementation' });

    const now = Date.now();
    const deps = { dispatchStore, agentStatusStore, observerStateStore, now };
    const instanceKey = `sweep:v1:${urlKey}`;

    // Seed the instance with a normal, successful tick first.
    await sweepOneWorkspace(urlKey, deps);

    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await observerStateStore.collection.updateOne({ _id: instanceKey }, { $set: { lastSeenAt: longAgo } });

    const brokenDispatchStore = {
      listItems: () => { throw new Error('boom: dispatch read failed'); },
      listHistory: async () => []
    };
    await assert.rejects(
      () => sweepOneWorkspace(urlKey, { dispatchStore: brokenDispatchStore, agentStatusStore, observerStateStore, now }),
      /boom: dispatch read failed/
    );

    const doc = await observerStateStore.readCurrent(instanceKey);
    assert.strictEqual(doc.lastSeenAt.getTime(), longAgo.getTime(), 'a tick that throws before advance() must not heartbeat — it must not look alive');
  });

  test('LIN-2438 T13: advance() === false (lost race) and === null (backend error) each write no heartbeat', async () => {
    const { dispatchStore, agentStatusStore } = freshStores();
    const urlKey = `ws-heartbeat-noadvance-${randomUUID()}`;

    for (const advanceResult of [false, null]) {
      const calls = [];
      const observerStateStore = {
        readCurrent: async () => { calls.push('readCurrent'); return { rev: 1 }; },
        ensureSeeded: async () => { calls.push('ensureSeeded'); return { rev: 1 }; },
        advance: async () => { calls.push('advance'); return advanceResult; }
      };
      await sweepOneWorkspace(urlKey, { dispatchStore, agentStatusStore, observerStateStore, now: Date.now() });
      assert.deepStrictEqual(calls, ['readCurrent', 'advance'], `advance() === ${advanceResult} must not be followed by a heartbeat ensureSeeded call`);
    }
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

  test('LIN-2132: sweepOneWorkspace, given deps.observerShadowLogStore, writes ONLY to that store — dispatch/agent-status stay untouched, and the logged entry matches the real wake-marker vocabulary', async () => {
    const db = client.db(`neg_shadow_${dbCounter++}`);
    const dispatchQueueCollection = db.collection('dispatch-queue');
    const dispatchHistoryCollection = db.collection('dispatch-history');
    const agentStatusCollection = db.collection('foreman-status');
    const shadowLogCollection = db.collection('observer-shadow-log');

    const realDispatchStore = new DispatchQueueStore({ collection: dispatchQueueCollection, historyCollection: dispatchHistoryCollection, ttl: 86400 });
    const realAgentStatusStore = new AgentStatusStore({ collection: agentStatusCollection });
    const realObserverStateStore = new ObserverStateStore({ collection: db.collection('observer-state') });
    const realShadowLogStore = new ObserverShadowLogStore({ collection: shadowLogCollection });

    const urlKey = `ws-shadow-${randomUUID()}`;
    // Setup, through the REAL (unguarded) store — same posture as the sibling
    // test's realAgentStatusStore.recordStatus setup call above: mint a
    // genuinely `blocked` loop so there is an attention row for the shadow
    // log to compute something from.
    const item = await realDispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-9', promptName: 'implementation' });
    const taken = await realDispatchStore.takeItem(item._id, urlKey, 'consumer-1');
    await realDispatchStore.addFeedback(taken.id, urlKey, { message: '[blocked] need a decision' }, 'consumer-1');

    const countsBefore = {
      queue: (await dispatchQueueCollection.find({ urlKey }).toArray()).length,
      history: (await dispatchHistoryCollection.find({ urlKey }).toArray()).length,
      status: (await agentStatusCollection.find({ urlKey }).toArray()).length
    };

    const dispatchStore = forbiddenProxy(realDispatchStore, ['listItems', 'listHistory'], 'dispatchStore');
    const agentStatusStore = forbiddenProxy(realAgentStatusStore, ['listStatus'], 'agentStatusStore');
    const observerStateStore = forbiddenProxy(realObserverStateStore, ['readCurrent', 'ensureSeeded', 'advance'], 'observerStateStore');
    // Unlike the three stores above, recordActions IS an allowed call here —
    // it is this ticket's own store, never the live pipeline.
    const observerShadowLogStore = forbiddenProxy(realShadowLogStore, ['recordActions'], 'observerShadowLogStore');

    const net = guardNetwork();
    const now = Date.now();
    await sweepOneWorkspace(urlKey, { dispatchStore, agentStatusStore, observerStateStore, observerShadowLogStore, now });
    assert.strictEqual(net.attempts.length, 0, 'this tier makes no /api/proxy call and no model call');
    net.restore();

    const countsAfter = {
      queue: (await dispatchQueueCollection.find({ urlKey }).toArray()).length,
      history: (await dispatchHistoryCollection.find({ urlKey }).toArray()).length,
      status: (await agentStatusCollection.find({ urlKey }).toArray()).length
    };
    assert.deepStrictEqual(countsAfter, countsBefore, 'no dispatch write and no agent-status write occurred — the shadow log write must not touch the live pipeline');

    const { items } = await realShadowLogStore.listByWorkspace(urlKey);
    assert.strictEqual(items.length, 1, 'exactly one shadow entry logged for the one blocked attention row');
    const [entry] = items;
    assert.strictEqual(entry.lane, 'blocked');
    assert.strictEqual(entry.wouldBeMarker, 'blocked');
    assert.ok(
      isWakeEvent(entry.wouldBeFeedback.message),
      'the logged would-be feedback message must be recognized by the SAME parser real dispatch feedback uses (lib/dispatch-terminal.js isWakeEvent), not merely similarly shaped'
    );
    assert.ok(entry.wouldBeComment?.body?.includes('[blocked]'), 'the logged would-be Linear comment carries the same marker vocabulary');
  });

  test('static import assertion: lib/observer-sweep.js imports only pure, read-only modules — including SIDE-EFFECT-ONLY imports', () => {
    // Honest limitation (stated, not hidden): this only sees calls reachable
    // through the injected dispatchStore/agentStatusStore/observerStateStore
    // seams above, plus what the module itself statically imports. It does
    // NOT cover a dynamic `await import(...)`, which neither this assertion
    // nor the Proxy allowlist above can see. That blind spot is disclosed and
    // remains open.
    //
    // Ledger item 5: a bare `import './dispatch-store.js';` — a side-effect-only
    // import, with no `from` clause — WAS a second, undisclosed evasion: the
    // earlier `from`-anchored pattern simply did not match it, so such an
    // import passed the whole suite. The `from` clause is now optional, so both
    // statement forms are collected.
    const modulePath = fileURLToPath(new URL('../../lib/observer-sweep.js', import.meta.url));
    const src = readFileSync(modulePath, 'utf8');
    const specifiers = [...src.matchAll(/^import\s+(?:[^;]*?from\s+)?['"](.+?)['"]\s*;?\s*$/gm)].map((m) => m[1]);
    assert.deepStrictEqual(
      specifiers.sort(),
      ['./live-console.js', './loop-supersede.js', './pipeline-loops.js', './observer-shadow-log.js'].sort(),
      'a new import here (e.g. a direct dispatch-store/agent-status-store import bypassing the injected deps seam, in EITHER statement form) must be caught by this assertion. ' +
      './observer-shadow-log.js (LIN-2132) is the one addition this ticket makes — it is itself pure (no dispatch-store/agent-status-store/linear-provider import; see its own static-import test in observer-shadow-log.test.js) and exports only the pure computeWouldBeActions, never a store instance'
    );
  });
});

// ─── F. Production wiring — the scheduler `run` closure ────────────────────

describe('observer-sweep: createObserverSweepRun — the production tick closure (LIN-2131 close-out, ledger item 6)', () => {
  // This closure previously lived inline in server.js's scheduler.register(...)
  // call and had NO coverage of any kind: the sessionsCollection read, its
  // fail-soft, resolveRosterFromSessions, the round-robin index and the deps
  // object were all unreachable, so a green suite was compatible with the
  // production wiring never producing a correct sweep. Extracted, it is a
  // plain function these tests can drive.
  const INTERVAL_MS = 60_000;

  function sessionsCollectionOf(rows) {
    return { find: () => ({ toArray: async () => rows }) };
  }
  function failingSessionsCollection(err = new Error('backend down')) {
    return { find: () => ({ toArray: () => Promise.reject(err) }) };
  }
  // Default dispatch-store stub used by every pre-LIN-2146 test below —
  // shared by reference (never re-typed) so the exact-deps assertion further
  // down can deepStrictEqual against the SAME object, function identity
  // included, rather than a hand-retyped literal with its own new arrow
  // function (assert.deepStrictEqual compares functions by reference).
  const DISPATCH_STORE_STUB = { id: 'dispatchStore', listObservedWorkspaceKeys: async () => [] };
  const AGENT_STATUS_STORE_STUB = { id: 'agentStatusStore' };
  const OBSERVER_STATE_STORE_STUB = { id: 'observerStateStore' };
  function dispatchStoreOf(urlKeys) {
    return { id: 'dispatchStore', listObservedWorkspaceKeys: async () => urlKeys };
  }
  function failingDispatchStore(err = new Error('dispatch-store backend down')) {
    return { id: 'dispatchStore', listObservedWorkspaceKeys: () => Promise.reject(err) };
  }
  function recordingRun(sessionsCollection, { now, intervalMs = INTERVAL_MS, dispatchStore = DISPATCH_STORE_STUB } = {}) {
    const calls = [];
    const run = createObserverSweepRun({
      sessionsCollection,
      dispatchStore,
      agentStatusStore: AGENT_STATUS_STORE_STUB,
      observerStateStore: OBSERVER_STATE_STORE_STUB,
      intervalMs,
      now,
      sweep: async (urlKey, deps) => { calls.push({ urlKey, deps }); }
    });
    return { run, calls };
  }

  const threeWorkspaces = [
    { session: JSON.stringify({ workspaces: [{ urlKey: 'ws-c' }, { urlKey: 'ws-a' }] }) },
    { session: JSON.stringify({ workspaces: [{ urlKey: 'ws-b' }] }) }
  ];

  test('round-robin: one workspace per tick, walking the SORTED roster as the clock advances', async () => {
    const selected = [];
    for (let tick = 0; tick < 6; tick++) {
      const now = tick * INTERVAL_MS;
      const { run, calls } = recordingRun(sessionsCollectionOf(threeWorkspaces), { now: () => now });
      await run();
      assert.strictEqual(calls.length, 1, 'exactly one workspace is swept per tick');
      selected.push(calls[0].urlKey);
    }
    // Roster is sorted (resolveRosterFromSessions), so the walk is stable
    // against find({}) scan-order noise rather than merely "some rotation".
    assert.deepStrictEqual(selected, ['ws-a', 'ws-b', 'ws-c', 'ws-a', 'ws-b', 'ws-c']);
  });

  test('two ticks landing inside ONE interval select the same workspace — the property the store dedup depends on', async () => {
    const base = 7 * INTERVAL_MS;
    const early = recordingRun(sessionsCollectionOf(threeWorkspaces), { now: () => base + 1 });
    const late = recordingRun(sessionsCollectionOf(threeWorkspaces), { now: () => base + INTERVAL_MS - 1 });
    await early.run();
    await late.run();
    assert.strictEqual(
      early.calls[0].urlKey,
      late.calls[0].urlKey,
      'the index must be derived from the SAME intervalMs the job is registered with, or two ticks in one interval would sweep different workspaces and each write a genuine transition'
    );
  });

  test('the tick threads ONE clock value into both the selection and the sweep deps', async () => {
    const now = 12 * INTERVAL_MS + 4321;
    const { run, calls } = recordingRun(sessionsCollectionOf(threeWorkspaces), { now: () => now });
    await run();
    assert.deepStrictEqual(calls[0].deps, {
      dispatchStore: DISPATCH_STORE_STUB,
      agentStatusStore: AGENT_STATUS_STORE_STUB,
      observerStateStore: OBSERVER_STATE_STORE_STUB,
      now
    }, 'the deps object handed to sweepOneWorkspace is exactly the three injected stores plus the tick clock');
  });

  test('fail-soft: a rejecting roster read skips the tick — never a thrown job failure, never a sweep on a blank roster', async () => {
    const { run, calls } = recordingRun(failingSessionsCollection(), { now: () => 0 });
    await assert.doesNotReject(run, 'a roster read failure must not surface as a failed scheduler job');
    assert.strictEqual(calls.length, 0, 'no workspace may be swept when the roster read failed');
  });

  test('an empty roster (no sessions, or sessions carrying no workspaces) sweeps nothing and does not divide by zero', async () => {
    for (const rows of [[], [{ session: JSON.stringify({ workspaces: [] }) }], [{ session: '{not valid json' }]]) {
      const { run, calls } = recordingRun(sessionsCollectionOf(rows), { now: () => 5 * INTERVAL_MS });
      await assert.doesNotReject(run);
      assert.strictEqual(calls.length, 0);
    }
  });

  // ─── LIN-2146: dispatch-observed roster population ───────────────────────

  test('LIN-2146: a dispatch-only workspace (no browser session at all) IS swept — the population-gap regression test', async () => {
    const { run, calls } = recordingRun(sessionsCollectionOf([]), {
      now: () => 0,
      dispatchStore: dispatchStoreOf(['ws-dispatch-only'])
    });
    await run();
    assert.strictEqual(calls.length, 1, 'a workspace with dispatch rows and no session must enter the roster');
    assert.strictEqual(calls[0].urlKey, 'ws-dispatch-only');
  });

  test('LIN-2146: a dispatch-store read failure still sweeps the session-derived half of the roster (independent fail-soft)', async () => {
    const { run, calls } = recordingRun(sessionsCollectionOf(threeWorkspaces), {
      now: () => 0,
      dispatchStore: failingDispatchStore()
    });
    await assert.doesNotReject(run, 'a dispatch-store roster fault must not surface as a failed scheduler job');
    assert.strictEqual(calls.length, 1, 'the session-derived half must still be swept');
    assert.strictEqual(calls[0].urlKey, 'ws-a', 'sorted session roster, unaffected by the dispatch-store fault');
  });

  test('LIN-2146: a sessionsCollection read failure still sweeps the dispatch-derived half of the roster (independent fail-soft, the other direction)', async () => {
    const { run, calls } = recordingRun(failingSessionsCollection(), {
      now: () => 0,
      dispatchStore: dispatchStoreOf(['ws-dispatch-only'])
    });
    await assert.doesNotReject(run, 'a session roster fault must not surface as a failed scheduler job');
    assert.strictEqual(calls.length, 1, 'the dispatch-derived half must still be swept');
    assert.strictEqual(calls[0].urlKey, 'ws-dispatch-only');
  });

  test('LIN-2146: a workspace present in BOTH sources is deduped to one sweep, not two', async () => {
    const { run, calls } = recordingRun(sessionsCollectionOf(threeWorkspaces), {
      now: () => 0,
      dispatchStore: dispatchStoreOf(['ws-a', 'ws-dispatch-only'])
    });
    await run();
    assert.strictEqual(calls.length, 1, 'exactly one workspace is still swept per tick');
    // Union is ['ws-a','ws-b','ws-c','ws-dispatch-only'] sorted; index 0 at tick 0 is 'ws-a',
    // proving the overlap collapsed to one entry rather than the roster growing to 5.
    assert.strictEqual(calls[0].urlKey, 'ws-a');
  });

  test('a misconfigured intervalMs is refused at construction, not silently turned into a NaN index', () => {
    for (const bad of [0, -1, undefined, NaN, '60000']) {
      assert.throws(
        () => createObserverSweepRun({ sessionsCollection: sessionsCollectionOf([]), intervalMs: bad }),
        /positive intervalMs/
      );
    }
  });

  test('ledger 9 — sweepOneWorkspace REFUSES a missing/non-finite deps.now instead of silently classifying every active loop unknown', async () => {
    const storeCalls = [];
    const observerStateStore = {
      readCurrent: async () => { storeCalls.push('readCurrent'); return null; },
      ensureSeeded: async () => { storeCalls.push('ensureSeeded'); return { rev: 1 }; },
      advance: async () => { storeCalls.push('advance'); return true; }
    };
    for (const bad of [undefined, null, NaN, '1700000000000']) {
      await assert.rejects(
        () => sweepOneWorkspace('ws', { dispatchStore: {}, agentStatusStore: {}, observerStateStore, now: bad }),
        /deps\.now \(epoch ms\) is required/,
        `deps.now = ${String(bad)} must throw`
      );
    }
    // The guard runs BEFORE any I/O, so a bad call writes nothing at all —
    // the point is not merely to fail, it is to never persist a wrong
    // diagnosis as if it were a real observation.
    assert.deepStrictEqual(storeCalls, [], 'no read, no seed and above all no advance may happen on a refused tick');
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

describe('observer-sweep: mergeRosterUnion (LIN-2146)', () => {
  test('dedupes and sorts across both sources', () => {
    assert.deepStrictEqual(
      mergeRosterUnion(['ws-c', 'ws-a'], ['ws-b', 'ws-a']),
      ['ws-a', 'ws-b', 'ws-c']
    );
  });

  test('a workspace present in BOTH sources appears exactly once', () => {
    assert.deepStrictEqual(mergeRosterUnion(['ws-shared'], ['ws-shared']), ['ws-shared']);
  });

  test('tolerates [] / undefined on either side', () => {
    assert.deepStrictEqual(mergeRosterUnion([], ['ws-a']), ['ws-a']);
    assert.deepStrictEqual(mergeRosterUnion(['ws-a'], []), ['ws-a']);
    assert.deepStrictEqual(mergeRosterUnion(undefined, ['ws-a']), ['ws-a']);
    assert.deepStrictEqual(mergeRosterUnion(['ws-a'], undefined), ['ws-a']);
    assert.deepStrictEqual(mergeRosterUnion(undefined, undefined), []);
  });

  test('session-only and dispatch-only inputs are both real contributions, not one masking the other', () => {
    assert.deepStrictEqual(mergeRosterUnion(['ws-session-only'], []), ['ws-session-only']);
    assert.deepStrictEqual(mergeRosterUnion([], ['ws-dispatch-only']), ['ws-dispatch-only']);
  });
});
