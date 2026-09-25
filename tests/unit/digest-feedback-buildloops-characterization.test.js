/**
 * Characterization guard for LIN-3008 (LIN-2996 Phase 0).
 *
 * Pins `_buildLoops`'s CURRENT non-lean, per-row output for a representative
 * "kitchen sink" fixture (heartbeat, evidence, decision + decisionCase, an
 * answered decision, a ticket marker, usage, resources, and a `[done]`
 * terminal) — byte-identical, via `assert.deepStrictEqual` with no JSON
 * normalization. This test depends ONLY on `lib/pipeline-loops.js`'s existing
 * `__internal._buildLoops` export, so it is GREEN today, before
 * `digestFeedback`/`formatFeedbackEntries` exist. It must STAY green after
 * beat 3 re-points `_buildLoops` at the shared digest derivations — that is
 * the scope item "non-lean `_buildLoops` output stays byte-identical"
 * (LIN-3008 ticket §6). A diff here after beat 3 means the refactor changed
 * observable behaviour, not just where the derivation runs.
 *
 * The expected object below is the REAL output of `_buildLoops` captured
 * against HEAD `36425161` on this fixture (see the beat-2 report for the
 * capture transcript) — not hand-computed, so it can't encode a wrong
 * assumption about today's behaviour.
 *
 * LIN-3011 (LIN-2996 Phase 3, beat 4) update: two INTENTIONAL, approved
 * changes to the golden value since capture, both required by this ticket's
 * plan, not accidental drift —
 *   1. every loop (lean AND non-lean) now carries a top-level `toolPeak`
 *      field (`null` on non-lean, where `routes/dashboard.js`'s own
 *      `peakToolCount(metrics)` over the always-full non-lean metrics list
 *      stays the source of truth).
 *   2. the LEAN case now derives from a `feedbackDigest` attached to the
 *      fixture (computed here via `digestFeedback`, the same per-row
 *      derivation this file's non-lean path already uses), not from raw
 *      `feedback` directly — the lean read excludes `feedback` entirely in
 *      production, so a lean build with no digest now correctly derives
 *      nothing, which would make the ORIGINAL "same input, lean:true...
 *      keeps every derived fact identical" premise false by design. The
 *      fixture is updated so the test proves the CURRENT version of that
 *      same invariant: lean and non-lean stay identical, now via the digest.
 *
 * LIN-3022 (LIN-2991 Surface 2, §1) update: the golden loop now also carries
 * `answeredDecisions` (the set-derived sibling of `answeredDecisionId`), so
 * both this and the lean-derived variant below gained that field.
 *
 * LIN-2891 (LIN-3034) update: the golden loop now also carries `withdrawal`
 * (item-scoped decision-withdrawal, derived by `_findDecisionWithdrawal` in
 * lib/digest-feedback.js). Purely additive — the fixture has no
 * `decision-withdrawn` entry, so `null` is the correct derived value for both
 * the non-lean and lean-derived variants; no existing assertion loosens.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { __internal } from '../../lib/pipeline-loops.js';
import { digestFeedback } from '../../lib/digest-feedback.js';

const { _buildLoops } = __internal;

const T0 = '2026-01-01T10:00:00.000Z';
const at = (offsetSec) => new Date(new Date(T0).getTime() + offsetSec * 1000).toISOString();

function goldenFeedback() {
  return [
    { kind: 'heartbeat', message: '[working] 6 tools/32s · alive', timestamp: at(10) },
    { kind: 'evidence', message: '[evidence] design doc · https://example.com/doc · 3 mentions', timestamp: at(20), url: 'https://example.com/doc', urlLabel: 'design doc' },
    { kind: 'assistant-text', message: 'Investigated the approach.', timestamp: at(30) },
    { kind: 'assistant-text', message: 'Found two viable options.', timestamp: at(31) },
    { kind: 'decision', message: '[decision] ' + JSON.stringify({ decision_id: 'd-1', question: 'Proceed?', options: [{ id: 'yes', label: 'Proceed' }, { id: 'no', label: 'Hold' }], recommended: 'yes' }), timestamp: at(32) },
    { kind: 'decision-answer', message: JSON.stringify({ decision_id: 'd-1' }), timestamp: at(40) },
    { kind: 'ticket', message: '[ticket] LIN-920 started', timestamp: at(45) },
    { kind: 'usage', message: '[usage] ' + JSON.stringify({ schema: 1, harness: 'claude-code', model: 'claude-opus-4-8', inputTokens: 100, outputTokens: 200, costUsd: null }), timestamp: at(50) },
    { kind: 'resources', message: '[resources] ' + JSON.stringify({ peakRssBytes: 536870912 }), timestamp: at(55) },
    { kind: 'status', message: '[done] Task completed in 60s', timestamp: at(60) }
  ];
}

function goldenHistoryItem() {
  return {
    id: 'h-golden-1',
    issueIdentifier: 'LIN-9001',
    dispatchedAt: T0,
    resolvedAt: at(65),
    status: 'done',
    feedback: goldenFeedback(),
    kind: 'implementation',
    sessionId: null,
    sessionGroupId: null,
    followUpTo: null,
    promptName: 'implementation',
    prompt: 'do the thing',
    issueId: 'issue-1',
    issueTitle: 'Some issue',
    issueUrl: null,
    dispatchedBy: 'tester',
    target: 'cli',
    repo: 'LinearViewer',
    bookkeeping: null,
    rootItemId: null,
    abort: false,
    abortTo: null
  };
}

// Captured verbatim from `_buildLoops({ historyItems: [goldenHistoryItem()], lean: false, now: at(120) })`
// at branch `lin-3008-digest-feedback`, base SHA `36425161`.
const EXPECTED_GOLDEN_LOOP = {
  loopId: 'h-golden-1',
  issueIdentifier: 'LIN-9001',
  issueId: 'issue-1',
  issueTitle: 'Some issue',
  issueUrl: null,
  iteration: 1,
  kind: 'implementation',
  sessionId: null,
  sessionGroupId: null,
  followUpTo: null,
  // LIN-2934: budget bounds carried through per-loop, null on a non-autopilot
  // worker row (as here).
  maxTasks: null,
  maxSessionsPerTask: null,
  promptName: 'implementation',
  promptText: 'do the thing',
  dispatchedAt: '2026-01-01T10:00:00.000Z',
  takenAt: '2026-01-01T10:01:05.000Z',
  resolvedAt: '2026-01-01T10:01:05.000Z',
  dispatchedBy: 'tester',
  target: 'cli',
  repo: 'LinearViewer',
  feedback: goldenFeedback(),
  terminalStatus: 'done',
  terminalCompletedAt: '2026-01-01T10:01:00.000Z',
  wakeMarker: 'done',
  waitingMessage: null,
  decision: {
    decision_id: 'd-1',
    question: 'Proceed?',
    options: [
      { id: 'yes', label: 'Proceed' },
      { id: 'no', label: 'Hold' }
    ],
    recommended: 'yes'
  },
  decisionCase: ['Investigated the approach.', 'Found two viable options.'],
  answeredDecisionId: 'd-1',
  answeredDecisions: [
    { decisionId: 'd-1', raisedAt: at(32), resolvedAt: at(40), outcome: 'answered' }
  ],
  withdrawal: null,
  source: 'history',
  historyStatus: 'done',
  bookkeeping: null,
  agentAction: null,
  agentStatus: null,
  agentSummary: null,
  agentTimestamp: null,
  agentTokenId: null,
  agentTokenLabel: null,
  agentState: 'running',
  stage: 'implementation',
  telemetry: {
    runtime: {
      ms: 60000,
      dispatchedAt: '2026-01-01T10:00:00.000Z',
      completedAt: '2026-01-01T10:01:00.000Z',
      crossCheck: { seconds: 60, ms: 60000, raw: '60s' }
    },
    metrics: [
      {
        toolCount: 6,
        elapsedSeconds: 32,
        breakdown: null,
        total: null,
        state: null,
        timestamp: '2026-01-01T10:00:10.000Z',
        raw: '[working] 6 tools/32s · alive'
      }
    ],
    producedArtifacts: [
      { url: 'https://example.com/doc', label: 'design doc', mentions: 3, timestamp: '2026-01-01T10:00:20.000Z' }
    ],
    usage: {
      harness: 'claude-code',
      model: 'claude-opus-4-8',
      inputTokens: 100,
      outputTokens: 200,
      lane: null,
      costUsd: 0.0055
    },
    resources: { peakRssBytes: 536870912 },
    ticketWalk: [
      { identifier: 'LIN-920', state: 'started', outcomeLine: null, timestamp: '2026-01-01T10:00:45.000Z' }
    ]
  },
  // LIN-3011 beat 4: every loop now carries a top-level `toolPeak` — `null`
  // on non-lean, where `routes/dashboard.js`'s `peakToolCount(metrics)` over
  // the always-full metrics list stays the source of truth.
  toolPeak: null,
  lineageId: 'h-golden-1',
  lineageMetrics: [
    {
      toolCount: 6,
      elapsedSeconds: 32,
      breakdown: null,
      total: null,
      state: null,
      timestamp: '2026-01-01T10:00:10.000Z',
      raw: '[working] 6 tools/32s · alive'
    }
  ],
  lineageLastActivityMs: new Date('2026-01-01T10:00:10.000Z').getTime()
};

describe('LIN-3008 characterization guard: non-lean _buildLoops stays byte-identical', () => {
  test('kitchen-sink fixture: full per-row output matches the captured golden snapshot exactly', () => {
    const now = new Date(at(120));
    const result = _buildLoops({ liveItems: [], historyItems: [goldenHistoryItem()], agentStatusEntries: [], now, lean: false });
    assert.equal(result.length, 1);
    assert.deepStrictEqual(result[0], EXPECTED_GOLDEN_LOOP,
      'non-lean _buildLoops output must stay byte-identical once it is re-pointed at the shared digest derivations (beat 3)');
  });

  test('lean fixture: same input plus a matching feedbackDigest, lean:true drops promptText and raw feedback, but keeps every derived fact identical (LIN-3011: now via the digest)', () => {
    const now = new Date(at(120));
    // LIN-3011: the lean build derives from feedbackDigest, not raw feedback
    // — attach one consistent with this fixture's own feedback (the SAME
    // per-row derivation the non-lean path above already exercises).
    const leanItem = goldenHistoryItem();
    leanItem.feedbackVersion = 0;
    leanItem.feedbackDigest = digestFeedback(leanItem, { now: now.getTime() });
    leanItem.feedbackDigest.version = 0;
    const result = _buildLoops({ liveItems: [], historyItems: [leanItem], agentStatusEntries: [], now, lean: true });
    const { promptText, feedback, ...leanExpected } = EXPECTED_GOLDEN_LOOP;
    // The digest's own toolPeak (an always-full-window peak over ALL
    // heartbeats, independent of retention) — 6, the fixture's one heartbeat.
    leanExpected.toolPeak = 6;
    const { promptText: _p, feedback: _f, ...leanActual } = result[0];
    assert.deepStrictEqual(leanActual, leanExpected,
      'every derived fact (terminal/wake/decision/telemetry/lineage) must be identical between lean and non-lean, only promptText/feedback/toolPeak differ');
    assert.deepStrictEqual(result[0].feedback, []);
    assert.equal('promptText' in result[0], false);
  });
});
