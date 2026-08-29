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

  // LIN-2263 (F2): ObserverShadowLogStore#_pruneToCapacity evicts the
  // WORKSPACE's oldest entries once it holds `capacity` of them — so when the
  // entries handed to computeNewHarnessSignal already sit at/past that cap,
  // any loop's own firstDetectedAt may really be "oldest survivor", not true
  // first detection. `truncated` must say so rather than silently trusting
  // detectionLagMs/stillBlockedObservedMs.
  test('truncated is false when entry count is under the given capacity', () => {
    const a = computeWouldBeAction(attentionRow({ since: '2026-08-20T10:00:00.000Z' }));
    const result = computeNewHarnessSignal([{ ...a, recordedAt: new Date('2026-08-20T10:01:00.000Z') }], { capacity: 200 });
    assert.strictEqual(result.truncated, false);
  });

  test('truncated is true when entry count is at/past the given capacity', () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      ...computeWouldBeAction(attentionRow({ loopId: `loop-${i}`, since: '2026-08-20T10:00:00.000Z' })),
      recordedAt: new Date(`2026-08-20T10:0${i}:00.000Z`)
    }));
    const result = computeNewHarnessSignal(entries, { capacity: 3 });
    assert.strictEqual(result.truncated, true, 'entries.length (3) >= capacity (3) — eviction may already be discarding this workspace\'s oldest rows');
  });

  test('truncated stays false (never guessed) when no capacity is given', () => {
    const a = computeWouldBeAction(attentionRow({ since: '2026-08-20T10:00:00.000Z' }));
    const result = computeNewHarnessSignal([{ ...a, recordedAt: new Date('2026-08-20T10:01:00.000Z') }]);
    assert.strictEqual(result.truncated, false);
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

  // LIN-2310: the response entry must carry the positive-allowlist stamp —
  // a bare kindless "a human replied" no longer counts on its own (see the
  // dedicated kindless-entry test below).
  test('a loop with a [blocked] marker followed by a later decision-answer entry: timeToRespondMs is the gap to that entry', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        feedback: [
          { message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' },
          { kind: 'decision-answer', message: 'a human replied', timestamp: '2026-04-11T11:12:30.000Z' },
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
          { kind: 'decision-answer', message: 'nudge', timestamp: '2026-04-11T11:01:00.000Z' },
          { message: '[blocked] second', timestamp: '2026-04-11T11:20:00.000Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const [row] = computeIncumbentSignal(loops).perLoop;
    assert.strictEqual(row.timeToRespondMs, 60_000, 'measured from the FIRST blocked marker to the very next entry');
  });

  // LIN-2310 (decision d): a genuinely kindless entry — pre-LIN-1475 data, or
  // a hand-built fixture — no longer counts as a response under the positive
  // allowlist. Under the old denylist it WOULD have counted (nothing in
  // RUNNER_BOOKKEEPING_KINDS/isRunnerSelfTalkStatus excluded a kindless
  // entry); this is a deliberate, named behavior change, not a bug — do not
  // "fix" this test back to a non-null assertion.
  test('a kindless entry after [blocked] is NOT a response under the positive allowlist: timeToRespondMs stays null', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        status: 'taken',
        feedback: [
          { message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' },
          { message: 'a kindless legacy-shaped entry', timestamp: '2026-04-11T11:12:00.000Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const [row] = computeIncumbentSignal(loops).perLoop;
    assert.strictEqual(row.respondedAt, null, 'a kindless entry carries no decision-answer stamp, so it fails closed as no-response');
    assert.strictEqual(row.timeToRespondMs, null);
    assert.strictEqual(row.resolved, false);
  });

  // LIN-2310 (F3): a genuine, non-blocked wake marker on ANY kind other than
  // decision-answer — including kind: 'status', which used to count under the
  // old isRunnerSelfTalkStatus exclusion (it only excluded self-talk and a
  // repeated [blocked], never a real wake marker like this) — no longer
  // counts as a response either. This is the second, larger behavior change
  // LIN-2310 makes (not just the kindless-row change above): the SAME
  // fixture shape asserted a non-null timeToRespondMs before this fix.
  test('a genuine non-blocked wake marker on kind:status is NOT a response under the positive allowlist: timeToRespondMs stays null', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        status: 'taken',
        feedback: [
          { kind: 'status', message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' },
          { kind: 'status', message: '[done] shipped', timestamp: '2026-04-11T11:15:00.000Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const [row] = computeIncumbentSignal(loops).perLoop;
    assert.strictEqual(row.respondedAt, null, 'a [done] wake marker with no decision-answer stamp is not a counted response under the new rule');
    assert.strictEqual(row.timeToRespondMs, null);
    assert.strictEqual(row.resolved, true, 'deriveLifecycleStatus still sees the real [done] marker — resolved and timeToRespondMs now diverge, the broadened N1 caveat');
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

  // LIN-2263 (F1): realistic stored-entry shape — `[decision] -> [blocked] ->
  // [usage]` — matching hook.js's `blocked` boundary (assistant-text, an
  // optional `betweenTextAndStatus` decision, the `[blocked]` status entry,
  // then the runner's own `postUsageSnapshot` bookkeeping write at the SAME
  // Stop, gated on WORKER_USAGE_RELAY). A real human/observer response
  // arrives much later, as a `decision-answer` entry. The positional
  // `feedback[first.index + 1]` bug reads the `[usage]` row as the response
  // (a sub-second gap); the fix must skip it and land on the real one.
  test('[decision] -> [blocked] -> [usage]: timeToRespondMs skips the runner\'s own [usage] bookkeeping entry (WORKER_USAGE_RELAY on)', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        feedback: [
          { kind: 'assistant-text', message: 'Looking into it now.', timestamp: '2026-04-11T11:09:00.000Z' },
          { kind: 'decision', message: 'DECISION: needs a ruling on scope', timestamp: '2026-04-11T11:09:30.000Z' },
          { kind: 'status', message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' },
          { kind: 'usage', message: '[usage] {"schema":1,"harness":"claude-code","inputTokens":100,"outputTokens":50}', timestamp: '2026-04-11T11:10:00.400Z' },
          { kind: 'decision-answer', message: 'proceed with option B', timestamp: '2026-04-11T12:45:00.000Z' },
          { kind: 'status', message: '[done] shipped', timestamp: '2026-04-11T12:46:00.000Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const result = computeIncumbentSignal(loops);
    assert.strictEqual(result.count, 1);
    const [row] = result.perLoop;
    assert.strictEqual(row.respondedAt, '2026-04-11T12:45:00.000Z', 'must land on the decision-answer, not the [usage] bookkeeping row');
    assert.strictEqual(row.timeToRespondMs, 95 * 60 * 1000, '95 minutes to the real response, not ~400ms to [usage]');
    assert.strictEqual(row.resolved, true);
  });

  test('[decision] -> [blocked] -> (no [usage]): same real response, unaffected by WORKER_USAGE_RELAY being off', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        feedback: [
          { kind: 'assistant-text', message: 'Looking into it now.', timestamp: '2026-04-11T11:09:00.000Z' },
          { kind: 'decision', message: 'DECISION: needs a ruling on scope', timestamp: '2026-04-11T11:09:30.000Z' },
          { kind: 'status', message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' },
          { kind: 'decision-answer', message: 'proceed with option B', timestamp: '2026-04-11T12:45:00.000Z' },
          { kind: 'status', message: '[done] shipped', timestamp: '2026-04-11T12:46:00.000Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const result = computeIncumbentSignal(loops);
    const [row] = result.perLoop;
    assert.strictEqual(row.timeToRespondMs, 95 * 60 * 1000, 'same measurement whether or not the runner relayed [usage]');
  });

  test('a blocked loop whose only later entries are runner bookkeeping ([tool]/[usage]) reports no response yet, not a false sub-second gap', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        status: 'taken',
        feedback: [
          { kind: 'status', message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' },
          { kind: 'tool', message: '(tool-activity) Bash: git status', timestamp: '2026-04-11T11:10:00.200Z' },
          { kind: 'usage', message: '[usage] {"schema":1,"harness":"claude-code","inputTokens":100,"outputTokens":50}', timestamp: '2026-04-11T11:10:00.400Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const [row] = computeIncumbentSignal(loops).perLoop;
    assert.strictEqual(row.respondedAt, null, 'both trailing entries are runner bookkeeping — no real response has landed');
    assert.strictEqual(row.timeToRespondMs, null);
    assert.strictEqual(row.resolved, false);
  });

  // LIN-2263 (F1, review R1 -> re-review R1′): the real, VERBATIM stored
  // sequence for dispatch `001164ac` (same lineage the first review cited
  // as `5ac0084e` — identical `22:56:18.258`/`23:03:27.326` timestamps;
  // entries 75-81 off the workspace proxy). The R1 fix landed with a
  // TRIMMED 4-row fixture (75, 76, 77, 81) that omitted entries 78-80 — the
  // very entries that defeat it: a second [usage] write, a [heartbeat], and
  // finally the agent's own `assistant-text` self-check ANSWER, all still
  // self-activity between the runner's stall-failsafe re-ask and the loop's
  // next genuine [blocked]. Running the R1-only fix against this full array
  // measured `timeToRespondMs: 455768` (7m36s) on entry 80 — nobody
  // external responded; entry 81 just re-declares [blocked] and the loop
  // stayed genuinely blocked. This fixture must not be trimmed again.
  test('[blocked] -> [usage] -> runner self-check ([working · verifying], kind:status) -> [usage] -> [heartbeat] -> agent self-check answer (kind:assistant-text) -> repeated [blocked]: no response measured (verbatim 001164ac)', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        status: 'taken',
        feedback: [
          { kind: 'status', message: "[blocked] LIN-2218's deliverable is merged and CI-green", timestamp: '2026-08-22T22:56:18.258Z' },
          { kind: 'usage', message: '[usage] {"schema":1,"harness":"claude-code","inputTokens":100,"outputTokens":50}', timestamp: '2026-08-22T22:56:18.671Z' },
          { kind: 'status', message: '[working · verifying] Confirming completion — asked the agent to declare DONE or PENDING...', timestamp: '2026-08-22T23:03:27.326Z' },
          { kind: 'usage', message: '[usage] {"schema":1,"harness":"claude-code","inputTokens":120,"outputTokens":60}', timestamp: '2026-08-22T23:03:27.715Z' },
          { kind: 'heartbeat', message: '[working · running] 8 tools in 10m 2s', timestamp: '2026-08-22T23:03:40.844Z' },
          { kind: 'assistant-text', message: 'Re-checked rather than recalled: proxy still 503 WORKSPACE_OWNER_MISMATCH, LIN-2218 is not actually mergeable yet.', timestamp: '2026-08-22T23:03:54.026Z' },
          { kind: 'status', message: "[blocked] LIN-2218's witness is merged but the deliverable PR is not", timestamp: '2026-08-22T23:03:54.364Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const [row] = computeIncumbentSignal(loops).perLoop;
    assert.strictEqual(row.respondedAt, null, 'the self-check, its bookkeeping trailer, the agent\'s own assistant-text answer, and the repeated [blocked] are all self-activity, not a response');
    assert.strictEqual(row.timeToRespondMs, null, 'must not report the agent\'s own ~7m36s self-check answer as a response time (R1′)');
    assert.strictEqual(row.resolved, false, 'the loop is genuinely still blocked, unresolved');
  });

  // LIN-2263 (review R1′): the sharpest live case — the runner's onboarding
  // failsafe re-ask, relayed back to itself as `kind: 'assistant-text'`
  // (dispatch `861aeeb2`/`e431c0e2`, hook.js's `postTurnText`, labelled
  // precisely so a feedback-channel consumer does not mistake prep-phase
  // output for real work). Before this fix this measured `timeToRespondMs:
  // 8468138` (2h21m) — the reaper's own stall/resume backstop interval, not
  // an efficacy measurement.
  test('[blocked] -> runner onboarding failsafe re-ask (kind:assistant-text): no response measured', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        status: 'taken',
        feedback: [
          { kind: 'status', message: '[blocked] waiting on a decision before onboarding can continue', timestamp: '2026-08-22T09:00:00.000Z' },
          { kind: 'assistant-text', message: '[onboarding] Failsafe re-ask — prep step, not task work:\nready', timestamp: '2026-08-22T11:21:18.138Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const [row] = computeIncumbentSignal(loops).perLoop;
    assert.strictEqual(row.respondedAt, null, 'the onboarding failsafe re-ask is the runner relaying its own agent\'s prep output, not an external response');
    assert.strictEqual(row.timeToRespondMs, null, 'must not report the reaper\'s own ~2h21m stall/resume interval as a response time');
    assert.strictEqual(row.resolved, false);
  });

  // LIN-2263 (F1, review R1): the OTHER live self-talk shape — an in-place
  // resume/refire status ("[working] Session resumed…", kind:'status',
  // hook.js's RESUMING branch) — must not be mistaken for a response either,
  // whether or not it is followed by a real one.
  test('[blocked] -> runner resume self-talk ([working] Session resumed, kind:status) -> a real decision-answer: lands on the real response', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        feedback: [
          { kind: 'status', message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' },
          { kind: 'status', message: '[working] Session resumed. Re-confirming completion state...', timestamp: '2026-04-11T11:11:00.000Z' },
          { kind: 'decision-answer', message: 'proceed with option B', timestamp: '2026-04-11T11:30:00.000Z' },
          { kind: 'status', message: '[done] shipped', timestamp: '2026-04-11T11:31:00.000Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const [row] = computeIncumbentSignal(loops).perLoop;
    assert.strictEqual(row.respondedAt, '2026-04-11T11:30:00.000Z', 'must skip the resume self-talk and land on the real decision-answer');
    assert.strictEqual(row.timeToRespondMs, 20 * 60 * 1000);
    assert.strictEqual(row.resolved, true);
  });

  // LIN-2263 (review R2): heartbeat (kind:'heartbeat', reapers.js's
  // runHeartbeats — the single most common kind on live data per the
  // review) and resource sampling (kind:'resources', RESOURCE_RELAY) must
  // be skipped the same structural way as usage/tool, not left to rest on
  // the ACTIVE_PHASES invariant alone.
  test('a blocked loop whose only later entries are [heartbeat]/[resources] bookkeeping reports no response yet', () => {
    const loops = _buildLoops({
      historyItems: [historyItem({
        status: 'taken',
        feedback: [
          { kind: 'status', message: '[blocked] need a decision', timestamp: '2026-04-11T11:10:00.000Z' },
          { kind: 'heartbeat', message: '[working] still going', timestamp: '2026-04-11T11:11:00.000Z' },
          { kind: 'resources', message: '[resources] {"cpu":1,"memMb":200}', timestamp: '2026-04-11T11:12:00.000Z' }
        ]
      })],
      now: NOW, lean: false
    });
    const [row] = computeIncumbentSignal(loops).perLoop;
    assert.strictEqual(row.respondedAt, null, 'heartbeat/resources are runner bookkeeping — no real response has landed');
    assert.strictEqual(row.timeToRespondMs, null);
    assert.strictEqual(row.resolved, false);
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
    // LIN-2263/F2 residue is untouched by this ticket and must still be named.
    assert.ok(bundle.caveats.some((c) => /truncated/i.test(c) && /retention cap/i.test(c)), 'the truncation residue (F2) must be named in the caveat list');
    // LIN-2310: the positive-allowlist rule itself.
    assert.ok(bundle.caveats.some((c) => /decision-answer/i.test(c) && /positive allowlist/i.test(c)), 'the incumbent-arm caveat must state the positive-allowlist rule, not a denylist description');
    // LIN-2310: the near-total-null residue — the honest result, not a regression.
    assert.ok(bundle.caveats.some((c) => /null for nearly every loop/i.test(c) && /followUpTo/i.test(c)), 'the caveat must name the near-universal null result and why (human replies land as a new dispatch row)');
    // LIN-2310 (broadened N1): resolved/timeToRespondMs disagreement is now the common case, not narrow.
    assert.ok(bundle.caveats.some((c) => /diverge for most answered loops/i.test(c)), 'the N1 caveat must be broadened, not left describing only the narrow [skipped] case');
    // LIN-2310 (F6, cross-repo composition): findFirstBlockedMarker's [blocked] population is no longer guaranteed homogeneous.
    assert.ok(bundle.caveats.some((c) => /not guaranteed homogeneous in cause/i.test(c)), 'the cross-repo composition caveat must be present');
    // LIN-2337: stale denylist-era prose (RUNNER_BOOKKEEPING_KINDS / isRunnerSelfTalkStatus,
    // removed in LIN-2310) must not silently reappear in caller-facing caveats[]. Scoped to
    // caveats[] only — the module's own comments legitimately narrate that removed mechanism
    // as history and must not trip this.
    assert.ok(!bundle.caveats.some((c) => /runner-emitted bookkeeping/i.test(c)), 'a caveat must not reintroduce the removed runner-emitted-bookkeeping denylist prose');
    assert.ok(!bundle.caveats.some((c) => /self-talk/i.test(c)), 'a caveat must not reintroduce the removed self-talk denylist prose');
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

  // LIN-2263 (F2, re-review ledger item 3): drive the REAL pruning path —
  // write past a small maxPerWorkspace via recordActions (triggering
  // _pruneToCapacity), then read truncated through collectNewHarnessSignal
  // — rather than only injecting `capacity` at the computeNewHarnessSignal
  // level, which proves the detector's arithmetic but not that eviction
  // actually happened upstream of it.
  test('truncated is true through collectNewHarnessSignal after recordActions actually prunes the workspace past capacity', async () => {
    const db = client.db(`eff_${dbCounter++}`);
    const observerShadowLogStore = new ObserverShadowLogStore({ collection: db.collection('observer-shadow-log'), maxPerWorkspace: 3 });
    const urlKey = `ws-${randomUUID()}`;

    for (let i = 0; i < 5; i++) {
      const action = computeWouldBeAction(attentionRow({ loopId: `loop-${i}`, since: '2026-08-20T10:00:00.000Z' }));
      await observerShadowLogStore.recordActions(urlKey, [action], new Date(`2026-08-20T10:0${i}:00.000Z`));
    }

    const result = await collectNewHarnessSignal(urlKey, { observerShadowLogStore });
    assert.strictEqual(result.count, 3, 'only the newest 3 loops survived _pruneToCapacity');
    assert.strictEqual(result.truncated, true, 'the store actually evicted rows — truncated must be true, not just constructible from an injected capacity');
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

  test('collectNewHarnessSignal, run through a Proxy allowing ONLY listByWorkspace + maxPerWorkspace, makes no other call', async () => {
    const db = client.db(`eff_neg_${dbCounter++}`);
    const realStore = new ObserverShadowLogStore({ collection: db.collection('observer-shadow-log') });
    const urlKey = `ws-${randomUUID()}`;
    await realStore.recordActions(urlKey, [computeWouldBeAction(attentionRow())], new Date('2026-08-20T10:01:00.000Z'));

    // LIN-2263 (F2): collectNewHarnessSignal also reads the store's own
    // maxPerWorkspace (a plain property, not a store call) to thread
    // truncation-awareness into computeNewHarnessSignal — allowed alongside
    // listByWorkspace, still nothing else.
    const observerShadowLogStore = forbiddenProxy(realStore, ['listByWorkspace', 'maxPerWorkspace'], 'observerShadowLogStore');
    const result = await collectNewHarnessSignal(urlKey, { observerShadowLogStore });
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.truncated, false);
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
