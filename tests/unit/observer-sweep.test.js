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
import { createHash, randomUUID } from 'node:crypto';
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
  createObserverSweepRun,
  FOSSIL_AGE_MS
} from '../../lib/observer-sweep.js';
import { ObserverStateStore } from '../../lib/observer-state-store.js';
import { computeWouldBeActions, ObserverShadowLogStore } from '../../lib/observer-shadow-log.js';
import { stableStringify } from '../../lib/recap-cache.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { isWakeEvent } from '../../lib/dispatch-terminal.js';
import { isDecisionAnsweredInLineage, answeredDecisionIdsByLineage, isDecisionWithdrawn } from '../../lib/unanswered-decisions.js';
import { guardNetwork } from '../fixtures/network-guard.js';
import { digestFeedback } from '../../lib/digest-feedback.js';
import { projectActiveSession } from '../../lib/chat-tools.js';

const { _buildLoops } = __internal;

const LANE_KEYS = ['working', 'silent', 'blocked', 'terminal', 'queued', 'resolved', 'unknown'];
const NOW = new Date('2026-04-11T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const STALE_MS = DEFAULT_LANE_STALE_MS;

let idCounter = 0;

function historyItem(overrides = {}) {
  const item = {
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
  // LIN-3011: this whole file drives `_buildLoops` directly with `lean: true`
  // (bypassing `_fetchWorkspaceData`/self-heal), so the lean derivation needs
  // a matching digest — computed relative to this file's fixed `NOW_MS`
  // clock (not real execution time), since several tests deliberately place
  // fixture timestamps hours/days from `NOW` to probe retention/staleness.
  // Skipped when the caller explicitly controls `feedbackVersion`/
  // `feedbackDigest` itself.
  if (!('feedbackDigest' in overrides) && !('feedbackVersion' in overrides)) {
    const digest = digestFeedback({ feedback: item.feedback, dispatchedAt: item.dispatchedAt }, { now: NOW_MS });
    digest.version = 0;
    item.feedbackVersion = 0;
    item.feedbackDigest = digest;
  }
  return item;
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

// LIN-2671: the two feedback entries a loop's decision/answer facts derive
// from, built in the REAL wire shapes `_buildLoops` parses (`kind: 'decision'`
// via `parseDecision`; `kind: 'decision-answer'` via `_findDecisionAnswer`) —
// never hand-baked onto a Loop record, so the fixtures exercise the same
// derivation production reads.
function decisionFeedbackEntry(decisionId, timestamp = '2026-04-11T11:06:00.000Z') {
  return {
    kind: 'decision',
    timestamp,
    message: `[decision] ${JSON.stringify({
      decision_id: decisionId,
      question: 'Proceed?',
      options: [{ id: 'a', label: 'Go' }, { id: 'b', label: 'Hold' }]
    })}`
  };
}

function answerFeedbackEntry(decisionId, timestamp = '2026-04-11T11:08:00.000Z') {
  return { kind: 'decision-answer', timestamp, message: JSON.stringify({ decision_id: decisionId }) };
}

// LIN-2891/LIN-3036: the wire shape B's write path posts
// (`{kind: 'decision-withdrawn', message: {decision_id, reason}}`), which
// `_findDecisionWithdrawal` parses into the loop's `withdrawal` fact.
function withdrawalFeedbackEntry(decisionId, reason, timestamp = '2026-04-11T11:08:00.000Z') {
  return { kind: 'decision-withdrawn', timestamp, message: JSON.stringify({ decision_id: decisionId, reason }) };
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
      historyItem({ id: 'h-unknown', issueIdentifier: 'LIN-208' }),
      // LIN-2653 (T13): a bookkeeping-stamped fossil, deliberately ALSO
      // carrying a stale [blocked] marker — the shape half the target
      // population has. It lands `resolved`, so it costs the exhaustiveness
      // and sum-reconciliation assertions below nothing new: no eighth lane
      // key, and `lanes.blocked` stays 2.
      historyItem({
        id: 'h-bookkept', issueIdentifier: 'LIN-209',
        bookkeeping: { at: '2026-04-04T09:00:00.000Z', by: 'operator-1', reason: 'fossil pass' },
        feedback: [{ message: '[blocked] stale, bookkeeping-stamped after', timestamp: '2026-04-11T11:10:00.000Z' }]
      })
    ];
    const liveItems = [liveItem({ id: 'l-queued', issueIdentifier: 'LIN-205' })];
    const agentStatuses = [
      agentStatusEntry({ dispatchId: 'h-blocked-agentstatus', taskIdentifier: 'LIN-204', status: 'blocked', timestamp: '2026-04-11T11:02:00.000Z' }),
      agentStatusEntry({ dispatchId: 'h-unknown', taskIdentifier: 'LIN-208', status: 'completed', timestamp: '2026-04-11T11:02:00.000Z' })
    ];
    const loops = _buildLoops({ historyItems: histItems, liveItems, agentStatusEntries: agentStatuses, now: NOW, lean: true });
    assert.strictEqual(loops.length, 9, 'sanity: one loop per fixture row');

    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    const sum = Object.values(payload.lanes).reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, loops.length, 'F1: lane totals must reconcile against the workspace loop count');
    for (const key of LANE_KEYS) {
      assert.ok(payload.lanes[key] >= 1, `lane "${key}" must be represented in this deliberately mixed fixture`);
    }
    assert.strictEqual(payload.lanes.blocked, 2, 'both blocked channels contributed one row each — the stamped row does NOT make a third');
    assert.strictEqual(payload.lanes.queued, 1);
    assert.strictEqual(payload.lanes.terminal, 1);
    assert.strictEqual(payload.lanes.resolved, 2, 'the operator-cancelled row and the bookkeeping-stamped fossil (LIN-2653) share this lane');
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

  // ── LIN-2653: the fossil-bookkeeping branch (base case, T11, T12) ────────
  //
  // Fixture-driven through `_buildLoops` with a real stamp shape and real
  // marker text, same discipline as the rest of this section. `bookkeeping`
  // rides the Loop record's always-present scalar set
  // (`lib/pipeline-loops.js:763`), so the `lean: true` read this sweep uses
  // carries it — these tests would fail on a lean-conditional threading.
  //
  // Each test pairs the stamped row with an otherwise-IDENTICAL unstamped
  // control, so a green assertion proves the stamp is what moved the lane
  // rather than the fixture landing there anyway.
  const BOOKKEEPING_STAMP = { at: '2026-04-04T09:00:00.000Z', by: 'operator-1', reason: 'fossil pass' };

  test('LIN-2653 base case: a bookkeeping-stamped row that would otherwise read silent lands resolved', () => {
    const stamped = historyItem({
      id: 'h-bk-silent', issueIdentifier: 'LIN-310',
      dispatchedAt: '2026-04-11T10:00:00.000Z', bookkeeping: BOOKKEEPING_STAMP
    });
    const control = historyItem({
      id: 'h-bk-silent-control', issueIdentifier: 'LIN-311',
      dispatchedAt: '2026-04-11T10:00:00.000Z'
    });
    const loops = _buildLoops({ historyItems: [stamped, control], now: NOW, lean: true });
    const superseded = computeSupersededLoopIds(loops);
    const laneOf = (id) => classifyLoop(loops.find((l) => l.loopId === id), { superseded, now: NOW_MS, staleMs: STALE_MS });

    assert.deepStrictEqual(
      loops.find((l) => l.loopId === 'h-bk-silent').bookkeeping, BOOKKEEPING_STAMP,
      'sanity: the stamp survives the lean read onto the Loop record — without this the branch could never fire'
    );
    assert.strictEqual(laneOf('h-bk-silent-control'), 'silent', 'control: the identical UNSTAMPED row reads silent');
    assert.strictEqual(laneOf('h-bk-silent'), 'resolved', 'the stamp alone moves a fossil out of the waiting lanes');
  });

  test('LIN-2653 T11 ordering: a bookkeeping-stamped row carrying a stale [blocked] marker lands resolved, not blocked', () => {
    // The load-bearing direction: `blocked` is roughly half the target
    // population, so a branch placed AFTER blocked would be unreachable for
    // half the rows the fossil pass exists to retire — silently.
    const stamped = historyItem({
      id: 'h-bk-blocked', issueIdentifier: 'LIN-312', bookkeeping: BOOKKEEPING_STAMP,
      feedback: [{ message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' }]
    });
    const control = historyItem({
      id: 'h-bk-blocked-control', issueIdentifier: 'LIN-313',
      feedback: [{ message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' }]
    });
    const loops = _buildLoops({ historyItems: [stamped, control], now: NOW, lean: true });
    const superseded = computeSupersededLoopIds(loops);
    const laneOf = (id) => classifyLoop(loops.find((l) => l.loopId === id), { superseded, now: NOW_MS, staleMs: STALE_MS });

    assert.strictEqual(
      loops.find((l) => l.loopId === 'h-bk-blocked').wakeMarker, 'blocked',
      'sanity: the stamped row really does still carry the stale blocked marker — otherwise this test would pass for the wrong reason'
    );
    assert.strictEqual(laneOf('h-bk-blocked-control'), 'blocked', 'control: the identical UNSTAMPED row reads blocked');
    assert.strictEqual(laneOf('h-bk-blocked'), 'resolved', 'the bookkeeping branch must be checked BEFORE blocked');
  });

  test('LIN-2653 T12 ordering: a bookkeeping-stamped row that also posted [done] lands terminal, not resolved', () => {
    // The other bound: the branch sits AFTER the terminal check, so a row
    // that genuinely finished still reports as finished rather than being
    // relabelled by the operator's stamp.
    const stamped = historyItem({
      id: 'h-bk-done', issueIdentifier: 'LIN-314', bookkeeping: BOOKKEEPING_STAMP,
      feedback: [{ message: '[done] shipped', timestamp: '2026-04-11T11:10:00.000Z' }]
    });
    const loops = _buildLoops({ historyItems: [stamped], now: NOW, lean: true });
    const superseded = computeSupersededLoopIds(loops);

    assert.strictEqual(loops[0].terminalStatus, 'done', 'sanity: the row really is terminal');
    assert.deepStrictEqual(loops[0].bookkeeping, BOOKKEEPING_STAMP, 'sanity: and really is stamped — both signals are present at once');

    const lane = classifyLoop(loops[0], { superseded, now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(lane, 'terminal', 'terminal must be checked before the bookkeeping branch');
  });

  test('LIN-2653 T13: the bookkeeping branch returns an EXISTING lane key — no eighth lane', () => {
    const stamped = historyItem({
      id: 'h-bk-lane', issueIdentifier: 'LIN-315',
      dispatchedAt: '2026-04-11T10:00:00.000Z', bookkeeping: BOOKKEEPING_STAMP
    });
    const loops = _buildLoops({ historyItems: [stamped], now: NOW, lean: true });
    const lane = classifyLoop(loops[0], { superseded: computeSupersededLoopIds(loops), now: NOW_MS, staleMs: STALE_MS });

    assert.ok(LANE_KEYS.includes(lane), 'a stamped row must classify into one of the 7 tallied lanes');
    assert.strictEqual(lane, 'resolved', 'and specifically the existing resolved lane, not a new bookkeeping one');
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

  // ── LIN-2671: an answered decision discharges the blocked lifecycle ───────
  //
  // The independent signal the sweep never consulted before: a loop can carry
  // a `[blocked]` marker AND an answered decision at once — the LIN-2632
  // dispatch `67b7b85a` shape, answered out of band and merged without a
  // follow-up resume. `answeredDecisionId` is derived onto the lean loop the
  // same way `wakeMarker`/`decision` are (LIN-1728), so these fixture-driven
  // tests fail on a lean-conditional threading.
  //
  // The answer's lane is `resolved`, NOT `silent`: both `silent` and `blocked`
  // are attention lanes, so a `silent` lane would keep the row on the
  // waiting-on-a-human list this ticket exists to remove it from.

  test('LIN-2671: a blocked row whose decision has been answered out of band lands resolved', () => {
    const hist = historyItem({
      id: 'h-answered', issueIdentifier: 'LIN-320',
      dispatchedAt: '2026-04-11T11:00:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:05:00.000Z' },
        decisionFeedbackEntry('dec-1'),
        answerFeedbackEntry('dec-1')
      ]
    });
    const loops = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    const loop = loops[0];
    assert.strictEqual(loop.wakeMarker, 'blocked', 'sanity: the blocked marker is really present');
    assert.strictEqual(loop.decision.decision_id, 'dec-1', 'sanity: the decision derives onto the lean loop');
    assert.strictEqual(loop.answeredDecisionId, 'dec-1', 'sanity: the matching answer derives onto the lean loop');

    const lane = classifyLoop(loop, { superseded: computeSupersededLoopIds(loops), now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(lane, 'resolved', 'the human answered — this row is done-with, not waiting on anyone');
    assert.notStrictEqual(lane, 'silent', 'silent is still a waiting-on-a-human lane and would keep the row in attention');
  });

  test('LIN-2671: the same blocked row with a MISMATCHED answeredDecisionId stays blocked', () => {
    const hist = historyItem({
      id: 'h-answered-stale', issueIdentifier: 'LIN-321',
      dispatchedAt: '2026-04-11T11:00:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:05:00.000Z' },
        decisionFeedbackEntry('dec-new'),
        answerFeedbackEntry('dec-old')
      ]
    });
    const loops = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    const loop = loops[0];
    assert.strictEqual(loop.decision.decision_id, 'dec-new', 'sanity: the CURRENT decision is the new, unanswered one');
    assert.strictEqual(loop.answeredDecisionId, 'dec-old', 'sanity: the answer stamp names the OLD decision');

    const lane = classifyLoop(loop, { superseded: computeSupersededLoopIds(loops), now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(lane, 'blocked', 'a stale answer for an older decision must not discharge a newer, unanswered one');
  });

  test('LIN-2671: an answered decision does NOT override supersession — a follow-up still wins', () => {
    const original = historyItem({
      id: 'z1', issueIdentifier: 'LIN-322', dispatchedAt: '2026-04-11T10:00:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T10:05:00.000Z' },
        decisionFeedbackEntry('dec-1', '2026-04-11T10:06:00.000Z'),
        answerFeedbackEntry('dec-1', '2026-04-11T10:08:00.000Z')
      ]
    });
    const followUp = historyItem({
      id: 'z2', issueIdentifier: 'LIN-322', followUpTo: 'z1',
      feedback: [{ message: '[done] resumed and finished', timestamp: '2026-04-11T11:40:00.000Z' }]
    });
    const loops = _buildLoops({ historyItems: [original, followUp], now: NOW, lean: true });
    const loopZ = loops.find((l) => l.loopId === 'z1');
    assert.strictEqual(loopZ.answeredDecisionId, 'dec-1', 'sanity: the row is answered too');
    const superseded = computeSupersededLoopIds(loops);
    assert.ok(superseded.has('z1'), 'sanity: and a follow-up names it');

    const lane = classifyLoop(loopZ, { superseded, now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(
      lane, 'silent',
      'supersession keeps its prior path — an answered decision only clears blocked when nothing supersedes it'
    );
  });
});

describe('LIN-2991: classifyLoop discharges every member of every answered decision group in a lineage, independently', () => {
  test('two distinct decisions in one lineage each discharge on their own — an unanswered sibling decision stays blocked', () => {
    const root = historyItem({
      id: 'lin-root', issueIdentifier: 'LIN-330', dispatchedAt: '2026-04-11T10:00:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T10:05:00.000Z' },
        decisionFeedbackEntry('dec-a', '2026-04-11T10:06:00.000Z')
      ]
    });
    const follow1 = historyItem({
      id: 'lin-follow-1', issueIdentifier: 'LIN-330', rootItemId: 'lin-root', dispatchedAt: '2026-04-11T10:30:00.000Z',
      feedback: [
        answerFeedbackEntry('dec-a', '2026-04-11T10:31:00.000Z'),
        { message: '[blocked] a second question', timestamp: '2026-04-11T10:35:00.000Z' },
        decisionFeedbackEntry('dec-b', '2026-04-11T10:36:00.000Z')
      ]
    });
    const follow2 = historyItem({
      id: 'lin-follow-2', issueIdentifier: 'LIN-330', rootItemId: 'lin-root', dispatchedAt: '2026-04-11T11:00:00.000Z',
      feedback: [
        answerFeedbackEntry('dec-b', '2026-04-11T11:01:00.000Z'),
        { message: '[blocked] a third, still-open question', timestamp: '2026-04-11T11:05:00.000Z' },
        decisionFeedbackEntry('dec-c', '2026-04-11T11:06:00.000Z')
      ]
    });
    const loops = _buildLoops({ historyItems: [root, follow1, follow2], now: NOW, lean: true });
    const rootLoop = loops.find((l) => l.loopId === 'lin-root');
    const followLoop1 = loops.find((l) => l.loopId === 'lin-follow-1');
    const followLoop2 = loops.find((l) => l.loopId === 'lin-follow-2');
    assert.strictEqual(rootLoop.decision.decision_id, 'dec-a', 'sanity');
    assert.strictEqual(followLoop1.decision.decision_id, 'dec-b', 'sanity');
    assert.strictEqual(followLoop2.decision.decision_id, 'dec-c', 'sanity');

    const superseded = computeSupersededLoopIds(loops);
    const answeredByLineage = answeredDecisionIdsByLineage(loops);
    assert.deepStrictEqual(answeredByLineage.get('lin-root'), new Set(['dec-a', 'dec-b']), 'sanity: the union carries exactly the two answered ids, never the still-open dec-c');

    const opts = { superseded, now: NOW_MS, staleMs: STALE_MS, answeredByLineage };
    assert.strictEqual(classifyLoop(rootLoop, opts), 'resolved', 'dec-a, answered on a LATER sibling loop, must discharge the root');
    assert.strictEqual(classifyLoop(followLoop1, opts), 'resolved', 'dec-b, answered on a LATER sibling loop, discharges follow-1 too — the sibling stamp for dec-b does not erase dec-a’s own discharge');
    assert.strictEqual(classifyLoop(followLoop2, opts), 'blocked', 'dec-c is still genuinely unanswered anywhere in the lineage and must stay blocked');
  });

  test('LIN-3022 L1 — buildSweepPayload itself threads answeredByLineage: a root blocked on a decision answered on a SIBLING loop leaves lanes.blocked and attention', () => {
    // The test above hands `classifyLoop` a hand-built map, so it cannot see
    // `buildSweepPayload` stop computing/threading one (review mutation M12
    // stayed green). This drives the production entry point instead.
    const root = historyItem({
      id: 'l1-root', issueIdentifier: 'LIN-340', dispatchedAt: '2026-04-11T11:50:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:51:00.000Z' },
        decisionFeedbackEntry('l1-dec', '2026-04-11T11:52:00.000Z')
      ]
    });
    const sibling = historyItem({
      id: 'l1-sibling', issueIdentifier: 'LIN-340', rootItemId: 'l1-root', dispatchedAt: '2026-04-11T11:54:00.000Z',
      feedback: [
        answerFeedbackEntry('l1-dec', '2026-04-11T11:55:00.000Z'),
        { message: '[done] finished after the answer', timestamp: '2026-04-11T11:56:00.000Z' }
      ]
    });
    const loops = _buildLoops({ historyItems: [root, sibling], now: NOW, lean: true });
    const rootLoop = loops.find((l) => l.loopId === 'l1-root');
    assert.strictEqual(rootLoop.decision.decision_id, 'l1-dec', 'sanity');
    assert.ok(!computeSupersededLoopIds(loops).has('l1-root'), 'sanity: the root is not excluded as superseded, so only the lineage map can discharge it');
    // Control: the root's OWN loop carries no answer, so without the map it
    // reads blocked — the payload assertions below are discriminating.
    assert.strictEqual(
      classifyLoop(rootLoop, { superseded: new Set(), now: NOW_MS, staleMs: STALE_MS }),
      'blocked',
      'control: with no lineage map, the own-loop fallback leaves the root blocked'
    );

    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(payload.lanes.blocked, 0, 'buildSweepPayload must compute and thread the lineage map itself');
    assert.strictEqual(payload.lanes.resolved, 1, 'the root is discharged by its sibling\'s answer stamp');
    assert.ok(!payload.attention.some((row) => row.loopId === 'l1-root'), 'a sibling-answered root must never be surfaced as waiting on a human');
  });
});

describe('observer-sweep: withdrawal discharge (LIN-2891/LIN-3036 Surface 6)', () => {
  // `classifyLoop` is the ONE shared classifier. The three production callers
  // are: `buildSweepPayload` (lib/observer-sweep.js:310, the 60s census — tested
  // below), `projectActiveSession` (lib/chat-tools.js:1115, list_pending_decisions
  // / fleet read — tested below), and the fossil pass
  // (scripts/fossil-pass-lin2633.js:361 — the direct `classifyLoop` calls here,
  // which pass no `answeredByLineage`, exercise exactly that option shape).
  // Withdrawal is read item-scoped from the loop itself, so it needs no map.

  test('a blocked row whose OWN decision is withdrawn lands resolved — not blocked (fossil-pass caller shape: no lineage map)', () => {
    const hist = historyItem({
      id: 'w-blocked', issueIdentifier: 'LIN-350', dispatchedAt: '2026-04-11T11:50:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:51:00.000Z' },
        decisionFeedbackEntry('wdec-1', '2026-04-11T11:52:00.000Z'),
        withdrawalFeedbackEntry('wdec-1', 'the asker retracted it', '2026-04-11T11:53:00.000Z')
      ]
    });
    const loops = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    const loop = loops[0];
    assert.strictEqual(loop.wakeMarker, 'blocked', 'sanity: the blocked marker is really present');
    assert.strictEqual(loop.withdrawal?.decisionId, 'wdec-1', 'sanity: the withdrawal derives onto the lean loop');
    assert.strictEqual(isDecisionWithdrawn(loop), true, 'sanity: the item-scoped predicate reads true on this loop');

    // Control: strip the withdrawal and the same blocked row reads blocked, so
    // the assertion below is discriminating (mutation M1 witnesses this too).
    const preWithdrawal = _buildLoops({
      historyItems: [historyItem({
        id: 'w-blocked', issueIdentifier: 'LIN-350', dispatchedAt: '2026-04-11T11:50:00.000Z',
        feedback: hist.feedback.filter((e) => e.kind !== 'decision-withdrawn')
      })],
      now: NOW, lean: true
    });
    assert.strictEqual(
      classifyLoop(preWithdrawal[0], { superseded: computeSupersededLoopIds(preWithdrawal), now: NOW_MS, staleMs: STALE_MS }),
      'blocked',
      'control: without the withdrawal the row is genuinely blocked'
    );

    const lane = classifyLoop(loop, { superseded: computeSupersededLoopIds(loops), now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(lane, 'resolved', 'a withdrawn decision is done-with, not waiting on anyone');
    assert.notStrictEqual(lane, 'silent', 'silent is still a waiting-on-a-human lane and would keep the row in attention');
  });

  test('item-scoped: a withdrawal on a SIBLING loop does not clear this blocked loop', () => {
    const root = historyItem({
      id: 'w-sib-root', issueIdentifier: 'LIN-351', dispatchedAt: '2026-04-11T11:50:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:51:00.000Z' },
        decisionFeedbackEntry('wdec-shared', '2026-04-11T11:52:00.000Z')
      ]
    });
    // The sibling carries the withdrawal for the SAME decision id, but it is a
    // different loop — the read is per-loop (Choice C), so the root stays blocked.
    const sibling = historyItem({
      id: 'w-sib-other', issueIdentifier: 'LIN-351', rootItemId: 'w-sib-root', dispatchedAt: '2026-04-11T11:54:00.000Z',
      feedback: [withdrawalFeedbackEntry('wdec-shared', 'sibling stamp', '2026-04-11T11:55:00.000Z')]
    });
    const loops = _buildLoops({ historyItems: [root, sibling], now: NOW, lean: true });
    const rootLoop = loops.find((l) => l.loopId === 'w-sib-root');
    const siblingLoop = loops.find((l) => l.loopId === 'w-sib-other');
    assert.strictEqual(isDecisionWithdrawn(rootLoop), false, 'sanity: the root has no withdrawal of its own');
    assert.strictEqual(isDecisionWithdrawn(siblingLoop), false, 'sanity: the sibling has no decision, so its withdrawal can never match one');
    assert.ok(!computeSupersededLoopIds(loops).has('w-sib-root'), 'sanity: the root is not superseded, so only withdrawal could clear it');

    assert.strictEqual(
      classifyLoop(rootLoop, { superseded: computeSupersededLoopIds(loops), now: NOW_MS, staleMs: STALE_MS }),
      'blocked',
      'a withdrawal on a sibling cannot discharge this loop — the predicate reads only the loop\'s own field'
    );
  });

  test('item-scoped: a withdrawal naming a MISMATCHED decision id leaves the blocked loop blocked', () => {
    const hist = historyItem({
      id: 'w-mismatch', issueIdentifier: 'LIN-352', dispatchedAt: '2026-04-11T11:50:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:51:00.000Z' },
        decisionFeedbackEntry('wdec-new', '2026-04-11T11:52:00.000Z'),
        withdrawalFeedbackEntry('wdec-old', 'stale', '2026-04-11T11:53:00.000Z')
      ]
    });
    const loops = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    const loop = loops[0];
    assert.strictEqual(loop.decision.decision_id, 'wdec-new', 'sanity: the CURRENT decision is the new one');
    assert.strictEqual(loop.withdrawal?.decisionId, 'wdec-old', 'sanity: the withdrawal names the OLD decision');
    assert.strictEqual(isDecisionWithdrawn(loop), false);

    assert.strictEqual(
      classifyLoop(loop, { superseded: computeSupersededLoopIds(loops), now: NOW_MS, staleMs: STALE_MS }),
      'blocked',
      'a withdrawal for a different decision id must not discharge a newer, un-withdrawn one'
    );
  });

  test('answered + withdrawn on the same blocked loop still lands resolved (the two discharge signals agree)', () => {
    const hist = historyItem({
      id: 'w-both', issueIdentifier: 'LIN-353', dispatchedAt: '2026-04-11T11:50:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:51:00.000Z' },
        decisionFeedbackEntry('wdec-both', '2026-04-11T11:52:00.000Z'),
        answerFeedbackEntry('wdec-both', '2026-04-11T11:53:00.000Z'),
        withdrawalFeedbackEntry('wdec-both', 'also retracted', '2026-04-11T11:54:00.000Z')
      ]
    });
    const loops = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    const loop = loops[0];
    assert.strictEqual(loop.answeredDecisionId, 'wdec-both', 'sanity: answered too');
    assert.strictEqual(loop.withdrawal?.decisionId, 'wdec-both', 'sanity: and withdrawn too');

    assert.strictEqual(
      classifyLoop(loop, { superseded: computeSupersededLoopIds(loops), now: NOW_MS, staleMs: STALE_MS }),
      'resolved',
      'both independent signals agree on resolved; no special ordering is needed'
    );
  });

  test('caller 1 — buildSweepPayload: a withdrawn blocked row leaves lanes.blocked AND attention, the open row stays', () => {
    const withdrawn = historyItem({
      id: 'w-census', issueIdentifier: 'LIN-354', dispatchedAt: '2026-04-11T11:55:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:56:00.000Z' },
        decisionFeedbackEntry('wdec-census', '2026-04-11T11:57:00.000Z'),
        withdrawalFeedbackEntry('wdec-census', 'retracted', '2026-04-11T11:58:00.000Z')
      ]
    });
    const open = historyItem({
      id: 'w-open', issueIdentifier: 'LIN-355', dispatchedAt: '2026-04-11T11:55:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:56:00.000Z' },
        decisionFeedbackEntry('wdec-open', '2026-04-11T11:57:00.000Z')
      ]
    });
    const loops = _buildLoops({ historyItems: [withdrawn, open], now: NOW, lean: true });

    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(payload.lanes.blocked, 1, 'only the genuinely open decision is still blocked');
    assert.strictEqual(payload.lanes.resolved, 1, 'the withdrawn row is done-with');
    assert.ok(payload.attention.some((row) => row.loopId === 'w-open'), 'an un-withdrawn blocked row is still waiting on a human');
    assert.ok(!payload.attention.some((row) => row.loopId === 'w-census'), 'a withdrawn blocked row must never be surfaced as waiting');
  });

  test('caller 2 — projectActiveSession: a withdrawn blocked session reads lifecycle resolved, waitingOnHuman false', () => {
    const mkSession = (withWithdrawal) => {
      const feedback = [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:56:00.000Z' },
        decisionFeedbackEntry('wdec-session', '2026-04-11T11:57:00.000Z'),
        ...(withWithdrawal ? [withdrawalFeedbackEntry('wdec-session', 'retracted', '2026-04-11T11:58:00.000Z')] : [])
      ];
      const loops = _buildLoops({
        historyItems: [historyItem({ id: 'w-session', issueIdentifier: 'LIN-356', dispatchedAt: '2026-04-11T11:55:00.000Z', feedback })],
        now: NOW, lean: true
      });
      return { sessionId: 'sess-w', seedIssue: 'LIN-356', dispatchedAt: NOW.toISOString(), tasksTouched: [], loops };
    };

    const control = projectActiveSession(mkSession(false), { superseded: new Set(), now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(control.lifecycle, 'blocked', 'control: without the withdrawal the session is waiting on a human');
    assert.strictEqual(control.waitingOnHuman, true, 'control: the open blocked loop keeps the session on the waiting list');

    const row = projectActiveSession(mkSession(true), { superseded: new Set(), now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(row.lifecycle, 'resolved', 'the withdrawn decision is done-with — the fleet read must not show it blocked');
    assert.strictEqual(row.waitingOnHuman, false, 'and it must not count as waiting on a human');
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

  test('LIN-2671 — an answered blocked row leaves lanes.blocked AND attentionKeysFull, so the companion gate reads a genuine delta', () => {
    const answered = historyItem({
      id: 'ans-blocked', issueIdentifier: 'LIN-441', dispatchedAt: '2026-04-11T11:55:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:56:00.000Z' },
        decisionFeedbackEntry('gate-dec', '2026-04-11T11:57:00.000Z'),
        answerFeedbackEntry('gate-dec', '2026-04-11T11:58:00.000Z')
      ]
    });
    const open = historyItem({
      id: 'open-blocked', issueIdentifier: 'LIN-442', dispatchedAt: '2026-04-11T11:55:00.000Z',
      feedback: [
        { message: '[blocked] need a decision', timestamp: '2026-04-11T11:56:00.000Z' },
        decisionFeedbackEntry('open-dec', '2026-04-11T11:57:00.000Z')
      ]
    });
    const loops = _buildLoops({ historyItems: [answered, open], now: NOW, lean: true });

    // Control for the DELTA: before the answer stamp exists, the same row is
    // blocked and IS in attentionKeysFull. A payload assertion alone would be
    // satisfiable by the row simply never having been attention-eligible.
    //
    // LIN-3011: rebuilt via `historyItem(...)` (not a raw `{...answered}`
    // spread) so the auto-attached digest is recomputed from the TRIMMED
    // feedback — a spread would keep `answered`'s ORIGINAL digest, which
    // was computed from feedback that INCLUDES the answer, silently
    // contradicting the "not yet answered" fixture this control needs.
    const preAnswer = _buildLoops({
      historyItems: [
        historyItem({
          id: 'ans-blocked', issueIdentifier: 'LIN-441', dispatchedAt: '2026-04-11T11:55:00.000Z',
          feedback: answered.feedback.filter((e) => e.kind !== 'decision-answer')
        }),
        open
      ],
      now: NOW, lean: true
    });
    const before = buildSweepPayload(preAnswer, { now: NOW_MS, staleMs: STALE_MS });
    assert.ok(
      before.attentionKeysFull.some((tuple) => tuple[0] === 'ans-blocked'),
      'control: before the answer lands, the row IS waiting on a human'
    );

    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(payload.lanes.blocked, 1, 'only the genuinely open decision is still blocked');
    assert.strictEqual(payload.lanes.resolved, 1, 'the answered row is done-with');

    assert.ok(
      payload.attention.some((row) => row.loopId === 'open-blocked'),
      'an unanswered blocked row is still waiting on a human'
    );
    assert.ok(
      !payload.attention.some((row) => row.loopId === 'ans-blocked'),
      'an answered blocked row must never be surfaced as waiting'
    );
    assert.ok(
      !payload.attentionKeysFull.some((tuple) => tuple[0] === 'ans-blocked'),
      'attentionKeysFull membership must reflect the lifecycle transition, or the companion gate sees no delta'
    );
    assert.ok(
      payload.attentionKeysFull.some((tuple) => tuple[0] === 'open-blocked'),
      'the untouched open row stays in the gate key — the delta is the answered row alone'
    );
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

  // ── LIN-2647: the payload's two clock boundaries, on pure clock advances ──
  //
  // The measured LIN-2619 review probe, now pinned — plus its pre-LIN-2619
  // sibling. The idempotency suite's "different times" tick advances 5
  // minutes against ~now-aged activity, deliberately clear of ANY boundary,
  // so nothing before this caught either clock dependence
  // (buildSweepPayload's header names both; each gets its own test here):
  // the lane census's `staleMs` working→silent crossing, and
  // `staleAttentionCount`'s `FOSSIL_AGE_MS` fossil fold.

  // Mirrors the store's own hashState() (lib/observer-state-store.js):
  // sha256 over stableStringify(state). `canonicalizeForHash` is not
  // exported, but it is the identity over this JSON-safe payload (no
  // Maps/Sets/Dates), so this reproduces the hashed shape the dedup gate
  // actually compares.
  const hashOfPayload = (payload) => createHash('sha256').update(stableStringify(payload)).digest('hex');

  test('LIN-2647: a pure clock advance across a row\'s 7-day FOSSIL_AGE_MS boundary moves the payload hash but NOT attentionKeysFull', () => {
    // One blocked row whose last activity sits 2 minutes SHORT of the
    // fossil boundary at tick A. Tick B advances the clock 5 minutes — past
    // the boundary — over an otherwise IDENTICAL fleet: no new dispatch, no
    // new feedback, only `now` moved.
    const sinceMs = NOW_MS - FOSSIL_AGE_MS + 2 * 60 * 1000;
    const rows = [historyItem({
      id: 'bb-boundary', issueIdentifier: 'LIN-521',
      dispatchedAt: new Date(sinceMs).toISOString(),
      feedback: [{ message: '[blocked] nearly fossil', timestamp: new Date(sinceMs).toISOString() }]
    })];
    const loops = _buildLoops({ historyItems: rows, now: NOW, lean: true });

    const payloadA = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(payloadA.attention.length, 1, 'tick A: the row is still fresh — enumerated');
    assert.strictEqual(payloadA.staleAttentionCount, 0, 'tick A: not yet counted as a fossil');
    assert.strictEqual(payloadA.attentionKeysFull.length, 1, 'tick A: the identity key carries the row');

    const payloadB = buildSweepPayload(loops, { now: NOW_MS + 5 * 60 * 1000, staleMs: STALE_MS });
    assert.strictEqual(payloadB.attention.length, 0, 'tick B: the crossed row drops out of the enumerated array');
    assert.strictEqual(payloadB.staleAttentionCount, 1, 'tick B: …and is folded into the fossil count instead');
    assert.strictEqual(payloadB.attentionKeysFull.length, 1, 'tick B: the identity key still carries the row');

    // The FOSSIL clock-dependence is real and load-bearing (one of the two
    // boundaries the corrected header names — see the lane-staleness test
    // below for the other): staleAttentionCount is derived from `now`, so
    // the store's dedup gate MUST see a genuine transition here (documented
    // in buildSweepPayload's own docblock — the header's old
    // "no per-tick-varying value anywhere" claim was false since LIN-2619,
    // and this assertion is what pins the corrected claim). Removing the
    // fossil filter entirely makes this assertion fail (the hash stops
    // moving) — that is the point.
    assert.notStrictEqual(
      hashOfPayload(payloadA), hashOfPayload(payloadB),
      'the payload hash must move when a row crosses the fossil boundary on a pure clock advance'
    );
    // …while the companion gate's own key must not:
    assert.deepStrictEqual(
      payloadB.attentionKeysFull, payloadA.attentionKeysFull,
      'attentionKeysFull is clock-INDEPENDENT — a row ageing from enumerated to counted is not a set-membership change the gate can see'
    );
  });

  test('LIN-2647: a pure clock advance across a row\'s 1h lane-staleness boundary moves the payload hash AND changes attentionKeysFull — the census\'s own, pre-LIN-2619 clock dependence', () => {
    // The sibling of the fossil-boundary test above, pinning the OTHER
    // clock dependence the corrected header names: classifyLoop's
    // `now - loopLastActivityMs(loop) > staleMs` working→silent crossing,
    // which predates LIN-2619 entirely (it is the lane census's own
    // staleness rule, `DEFAULT_LANE_STALE_MS`). A working row —
    // agentState 'running', no terminal marker, no blocked signal — whose
    // last activity sits 59 minutes before tick A crosses the 1h threshold
    // on a 5-minute pure clock advance: identical fleet, only `now` moved.
    //
    // Unlike the fossil crossing, this one is a REAL attention-membership
    // change (a row that stopped being worked and started waiting), so
    // BOTH the hash and attentionKeysFull must move — the companion gate's
    // no-delta fold is scoped to fossil-boundary crossings, and this
    // crossing is exactly the kind of genuine membership change it exists
    // to let through.
    const sinceMs = NOW_MS - 59 * 60 * 1000;
    const rows = [historyItem({
      id: 'lane-staleness-boundary', issueIdentifier: 'LIN-524',
      dispatchedAt: new Date(sinceMs).toISOString(),
      feedback: [] // no blocked signal, no terminal marker — a plain working run
    })];
    const loops = _buildLoops({ historyItems: rows, now: NOW, lean: true });
    const working = loops[0];
    assert.strictEqual(working.agentState, 'running', 'sanity: the row is an active working run (isLoopActive true)');

    const payloadA = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });
    assert.strictEqual(payloadA.lanes.working, 1, 'tick A: 59 minutes old — still freshly active, working');
    assert.strictEqual(payloadA.lanes.silent, 0, 'tick A: not yet silent');
    assert.strictEqual(payloadA.attention.length, 0, 'tick A: working is not an attention lane');
    assert.strictEqual(payloadA.attentionKeysFull.length, 0, 'tick A: no attention-eligible row exists yet');

    const payloadB = buildSweepPayload(loops, { now: NOW_MS + 5 * 60 * 1000, staleMs: STALE_MS });
    assert.strictEqual(payloadB.lanes.working, 0, 'tick B: 64 minutes old — past the 1h threshold, no longer working');
    assert.strictEqual(payloadB.lanes.silent, 1, 'tick B: the row crossed to silent on a pure clock advance');
    assert.strictEqual(payloadB.attention.length, 1, 'tick B: silent is attention-eligible — the row is now waiting');
    assert.strictEqual(payloadB.attentionKeysFull.length, 1, 'tick B: the identity key gained the row');

    assert.notStrictEqual(
      hashOfPayload(payloadA), hashOfPayload(payloadB),
      'the payload hash must move when a row crosses the lane-staleness boundary on a pure clock advance — this dependence predates LIN-2619'
    );
    // The deliberate contrast with the fossil-boundary test above: this
    // crossing is a genuine set-membership change, so attentionKeysFull
    // MUST move too — the gate's no-delta fold is fossil-boundary-scoped,
    // not clock-scoped in general.
    assert.notDeepStrictEqual(
      payloadB.attentionKeysFull, payloadA.attentionKeysFull,
      'a working→silent crossing adds a real member to attentionKeysFull — the gate correctly sees (and may spend on) this crossing; only the fossil boundary is invisible to it'
    );
    assert.deepStrictEqual(
      payloadB.attentionKeysFull,
      [['lane-staleness-boundary', 'silent', 'implementation']],
      'the gained member is the crossed row\'s own identity tuple'
    );
  });

  test('LIN-2647: a fossil blocked row produces NO would-be shadow action — INTENDED (LIN-2619/2647), with a fresh control that still does', () => {
    // The shadow-log consequence of the fossil fold (LIN-2132 consumer,
    // unreviewed for LIN-2619's change): rows at/over fossil age drop out
    // of `attention`, so computeWouldBeActions (lib/observer-shadow-log.js)
    // no longer enumerates a would-be action for them. Recorded here as
    // intended — they are exactly the rows LIN-2619 set out to stop
    // enumerating — and pinned so the behaviour change is held by a test,
    // not by silence.
    const fossilSinceMs = NOW_MS - FOSSIL_AGE_MS - 60 * 1000;
    const rows = [
      historyItem({
        id: 'aa-fossil-shadow', issueIdentifier: 'LIN-522',
        dispatchedAt: new Date(fossilSinceMs).toISOString(),
        feedback: [{ message: '[blocked] already fossil', timestamp: new Date(fossilSinceMs).toISOString() }]
      }),
      historyItem({
        id: 'zz-fresh-shadow', issueIdentifier: 'LIN-523', dispatchedAt: '2026-04-11T11:00:00.000Z',
        feedback: [{ message: '[blocked] fresh', timestamp: '2026-04-11T11:00:00.000Z' }]
      })
    ];
    const loops = _buildLoops({ historyItems: rows, now: NOW, lean: true });
    const payload = buildSweepPayload(loops, { now: NOW_MS, staleMs: STALE_MS });

    assert.strictEqual(payload.attention.length, 1, 'only the fresh row is enumerated');
    assert.strictEqual(payload.staleAttentionCount, 1, 'the fossil row is folded into the count');
    assert.strictEqual(payload.attentionKeysFull.length, 2, 'both rows stay in the identity key — the gate still sees the fossil row');

    const actions = computeWouldBeActions(payload);
    assert.deepStrictEqual(
      actions.map((a) => a.loopId), ['zz-fresh-shadow'],
      'the fossil blocked row produces no would-be action — intended (see computeWouldBeActions\'s own docblock), not a lost write'
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
    // old against a 1h staleness threshold and days short of a 7-day fossil
    // threshold, far from BOTH boundaries and therefore classified
    // identically). Same fleet, later clock, same document: that is the
    // actual contract — no payload field varies per tick while the clock
    // stays clear of the two boundaries buildSweepPayload's header names
    // (the lane-staleness and fossil crossings, each pinned by its own
    // LIN-2647 boundary test above).
    const ADVANCE_MS = 5 * 60 * 1000;
    assert.ok(ADVANCE_MS * 2 < DEFAULT_LANE_STALE_MS, 'sanity: the advance must stay well clear of the staleness boundary');
    await sweepOneWorkspace(urlKey, { ...deps, now: now + ADVANCE_MS });
    const doc3 = await observerStateStore.readCurrent(instanceKey);
    assert.strictEqual(doc3.rev, doc1.rev, 'an ADVANCING clock over identical fleet state must not advance rev while every row stays clear of the lane-staleness and fossil boundaries — a boundary crossing legitimately moves the hash (see the LIN-2647 boundary tests)');
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
  // LIN-2128 ledger item B ("MangoDB's residual double-fire — this sweep's
  // strict idempotency IS the safety net", comment `c42aa096` on LIN-2131)
  // is a claim about WRITES, not reads: on the file-backed MangoDB backend
  // cross-process exclusivity is absent, so this sweep's own effects must be
  // safe under an interleaved duplicate tick — and the item names "outward-
  // facing effect" and "automated intervention" as "nearly the same
  // predicate", routing the detector for BOTH into this same negative test.
  //
  // LIN-3011's self-heal write-back (`historyCollection.updateOne`, guarded
  // `$set` of `feedbackDigest` only, keyed on the row's own `feedbackVersion`)
  // is NEITHER: it is strictly idempotent by construction — the guard means a
  // duplicate/interleaved tick either writes the SAME derived value again or
  // loses the race harmlessly, never diverges — and it never feeds the
  // dispatch pipeline's own decisions (resume/kill/status/abort read nothing
  // from `feedbackDigest`; it is a derived READ-side cache field only). So
  // this describe block's OWN historyCollection Proxy allows `updateOne`
  // (previously blocked-and-silently-swallowed by self-heal's own try/catch,
  // which hid the real write from this test rather than proving it safe) —
  // and each test below asserts every recorded write is EXACTLY that shape:
  // a guarded `$set` of `feedbackDigest` alone, nothing else, no other
  // collection.
  function assertOnlyFeedbackDigestWrites(writeLog) {
    for (const { query, update } of writeLog) {
      assert.deepStrictEqual(Object.keys(update), ['$set'], 'every self-heal write-back is a $set, never $inc/$push/anything else');
      assert.deepStrictEqual(Object.keys(update.$set), ['feedbackDigest'], 'the $set touches ONLY feedbackDigest — never terminal/status/abort/sessionId or any dispatch-pipeline field');
      assert.deepStrictEqual(Object.keys(query).sort(), ['_id', 'feedbackVersion'], 'the write is guarded on {_id, feedbackVersion} — a stale-witness concurrent write loses harmlessly, never diverging');
    }
  }

  function forbiddenProxy(target, allowedMethods, label, writeLog = null) {
    return new Proxy(target, {
      get(obj, prop, receiver) {
        if (typeof prop === 'symbol' || prop === 'then') return Reflect.get(obj, prop, receiver);
        if (allowedMethods.includes(prop)) {
          const value = Reflect.get(obj, prop, receiver);
          return typeof value === 'function' ? value.bind(obj) : value;
        }
        // LIN-3011 (LIN-2996 Phase 3): the lean read's self-heal needs a
        // re-read of `dispatchStore.historyCollection` (find) when a row's
        // feedbackDigest is missing/stale, and a guarded write-back
        // (updateOne) once healed — `_fetchWorkspaceData` reads/writes it
        // directly (lib/pipeline-loops.js `_selfHealLeanHistory`), so it
        // can't go through the `listHistory` allowlist entry above. Granted
        // here as its OWN nested Proxy — narrower than an all-or-nothing
        // property gate — with `updateOne` wrapped to record every call in
        // `writeLog` for `assertOnlyFeedbackDigestWrites` above to verify,
        // rather than silently delegating (per the ledger-item-B reasoning
        // above, this write is deliberately NOT swallowed-and-hidden here).
        if (prop === 'historyCollection') {
          const raw = Reflect.get(obj, prop, receiver);
          if (raw == null) return raw;
          const nested = forbiddenProxy(raw, ['find', 'findOne', 'countDocuments'], `${label}.historyCollection`);
          return new Proxy(nested, {
            get(nObj, nProp, nReceiver) {
              if (nProp === 'updateOne') {
                return async (query, update, opts) => {
                  if (writeLog) writeLog.push({ query, update });
                  return raw.updateOne(query, update, opts);
                };
              }
              return Reflect.get(nObj, nProp, nReceiver);
            }
          });
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

    const writeLog = [];
    const dispatchStore = forbiddenProxy(realDispatchStore, ['listItems', 'listHistory'], 'dispatchStore', writeLog);
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

    // LIN-3011 / LIN-2128 ledger item B: self-heal DID write back (both
    // fixture rows are legacy — `_archiveItem` seeds `feedbackDigest: null`
    // — so the first tick's lean read heals both), and this asserts the
    // write is EXACTLY the safe, idempotent shape ledger item B requires,
    // not merely that it happened.
    assert.ok(writeLog.length > 0, 'sanity: self-heal actually wrote back at least once (both rows start with no digest)');
    assertOnlyFeedbackDigestWrites(writeLog);
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

    const writeLog = [];
    const dispatchStore = forbiddenProxy(realDispatchStore, ['listItems', 'listHistory'], 'dispatchStore', writeLog);
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

    // LIN-3011 / LIN-2128 ledger item B: unlike the sibling test above, this
    // row's digest is ALREADY fresh — `addFeedback` (the real Phase 1 write
    // path) kept it current — so self-heal needs no re-read and issues no
    // write-back at all. Zero writes is the OTHER half of "safe under
    // duplicate ticks": nothing to converge because there was nothing stale.
    assert.deepStrictEqual(writeLog, [], 'the row was already fresh — self-heal must not write back when there is nothing to heal');

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
      ['./live-console.js', './loop-supersede.js', './pipeline-loops.js', './observer-shadow-log.js', './unanswered-decisions.js'].sort(),
      'a new import here (e.g. a direct dispatch-store/agent-status-store import bypassing the injected deps seam, in EITHER statement form) must be caught by this assertion. ' +
      './observer-shadow-log.js (LIN-2132) is the one addition this ticket makes — it is itself pure (no dispatch-store/agent-status-store/linear-provider import; see its own static-import test in observer-shadow-log.test.js) and exports only the pure computeWouldBeActions, never a store instance. ' +
      './unanswered-decisions.js (LIN-2671) is itself pure (imports only ./loop-supersede.js; see unanswered-decisions.js) and exports the ONE answered-decision predicate classifyLoop must reuse rather than fork'
    );
  });

  test('LIN-2671/LIN-2991/LIN-3036 import-by-reference: classifyLoop reuses isDecisionAnsweredInLineage and isDecisionWithdrawn from lib/unanswered-decisions.js, never forks the comparison', () => {
    const modulePath = fileURLToPath(new URL('../../lib/observer-sweep.js', import.meta.url));
    const src = readFileSync(modulePath, 'utf8');
    assert.match(
      src,
      /^import\s*\{\s*isDecisionAnsweredInLineage,\s*answeredDecisionIdsByLineage,\s*isDecisionWithdrawn\s*\}\s*from\s*'\.\/unanswered-decisions\.js';/m,
      'both the answered and the withdrawn predicates must be imported by name from the shared module, not re-derived here'
    );
    assert.ok(
      !/answeredDecisionId\s*===/.test(src),
      'observer-sweep must NOT re-derive the comparison locally — a forked predicate is exactly how the census and the rulings feed disagreed (LIN-2671)'
    );
    assert.ok(
      !/withdrawal\.decisionId\s*===/.test(src),
      'observer-sweep must NOT re-derive the withdrawal comparison locally — it reuses isDecisionWithdrawn by reference (LIN-3036)'
    );
    // The names imported above are the shared module's real exports, not
    // same-named locals; a renamed/re-exported shim would fail here.
    assert.strictEqual(typeof isDecisionAnsweredInLineage, 'function');
    assert.strictEqual(isDecisionAnsweredInLineage({ decision: { decision_id: 'd-1' } }, new Map([['loop-1', new Set(['d-1'])]])), false, 'no lineageId/loopId on this bare fixture — the map lookup misses');
    const map = new Map([['lin-1', new Set(['d-1'])]]);
    assert.strictEqual(isDecisionAnsweredInLineage({ decision: { decision_id: 'd-1' }, lineageId: 'lin-1' }, map), true);
    assert.strictEqual(isDecisionAnsweredInLineage({ decision: { decision_id: 'd-2' }, lineageId: 'lin-1' }, map), false);
    assert.strictEqual(isDecisionAnsweredInLineage({ decision: null, lineageId: 'lin-1' }, map), false);
    assert.strictEqual(isDecisionAnsweredInLineage({ decision: { decision_id: 'd-1' }, lineageId: 'lin-1', answeredDecisions: [{ decisionId: 'd-1' }] }, undefined), true, 'map ABSENT falls back to the loop’s own answered set');
    assert.strictEqual(typeof isDecisionWithdrawn, 'function');
    assert.strictEqual(isDecisionWithdrawn({ decision: { decision_id: 'd-1' }, withdrawal: { decisionId: 'd-1' } }), true);
    assert.strictEqual(isDecisionWithdrawn({ decision: { decision_id: 'd-1' }, withdrawal: { decisionId: 'd-2' } }), false);
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
