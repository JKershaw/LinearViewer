/**
 * LIN-4559: the corpus the behaviour-preservation golden is recorded over (tests/unit/lin-4559-existing-kinds-
 * characterization.test.js). Feedback arrays of the kinds that existed before `agent-text` (and kind-less entries),
 * and every reader LIN-4559 touched, read over each. The golden (tests/fixtures/lin-4559-existing-kinds-golden.json)
 * was recorded by running `readSurfaces` against the readers as they were on main before the change (commit
 * 8a102628f; re-recorded at 69b5c1bbd after LIN-4558 changed parseParkedWait), so the test proves each touched reader answers exactly as it did for every kind that already existed.
 *
 * Pure and deterministic: fixed timestamps, no clock. `readSurfaces` takes the reader modules as an argument, so the
 * same code reads the old tree (recording) and the new one (checking). `messageArg` adapts the three predicates whose
 * signature changed from a message to an entry (`isLineageClosingTerminal`, `isWakeEvent`, and the status-bearing
 * predicate, whose golden key keeps its recorded name `isStatusBearingMessage`).
 */

const T0 = Date.UTC(2026, 10, 1, 9, 0, 0);
const at = (sec) => new Date(T0 + sec * 1000).toISOString();

/** Every kind that existed before LIN-4559, plus a kind-less entry (`null`). */
export const EXISTING_KINDS = Object.freeze([
  null, 'status', 'recap', 'heartbeat', 'evidence', 'assistant-text', 'tool', 'usage', 'resources', 'refusal',
  'decision', 'decision-withdrawn', 'decision-answer', 'decision-withdrawal-reversed'
]);

/** The messages that move a reader: every terminal, wake and resume marker, a park, a report line, a ticket marker. */
export const MESSAGES = Object.freeze([
  '[done] Task completed in 45s',
  '[complete] all green',
  '[failed] tests red',
  '[aborted] stopped by operator',
  '[skipped] human-continued session s1 (EXECUTING)',
  '[blocked] which branch should I use?',
  '[pending] beat 1 done, beats 2-4 remain',
  '[working] Session resumed. Executing follow-up.',
  '[working] 3 tools/20s · Bash×2 Read×1 · alive',
  '[working · verifying] Not done yet — a scheduled wakeup still pending.',
  'DONE: opened https://github.com/o/r/pull/7',
  '[ticket] LIN-9 started',
  'Looked at the footer; https://github.com/o/r/pull/3 is a sibling.',
  '  [DONE] upper-case marker'
]);

const entry = (kind, message, sec, extra = {}) => ({
  message, url: null, urlLabel: null, timestamp: at(sec), ...(kind ? { kind } : {}), ...extra
});

/** Named feedback arrays: one entry of each kind × message, and the sequences the readers' orderings turn on. */
export function corpus() {
  const cases = [];
  for (const kind of EXISTING_KINDS) {
    for (const [i, message] of MESSAGES.entries()) {
      cases.push({ name: `${kind ?? 'kind-less'} :: ${message}`, feedback: [entry(kind, message, 10 + i)] });
    }
  }
  const seq = (name, list) => cases.push({ name, feedback: list.map(([kind, message, extra], i) => entry(kind, message, 100 + i * 10, extra)) });
  seq('run words then done', [['assistant-text', 'Looked at the footer.'], ['assistant-text', 'Built it.'], [null, '[done] Task completed in 60s']]);
  seq('done in an assistant-text entry', [['assistant-text', '[done] the run said so in its own words']]);
  seq('blocked then plain heartbeat', [['status', '[blocked] need input'], ['heartbeat', '[working] 1 tools/5s · alive']]);
  seq('blocked then resume', [['status', '[blocked] need input'], ['status', '[working] Session resumed. Executing follow-up.']]);
  seq('pending then usage', [['status', '[pending] waiting on CI'], ['usage', '[usage] {"schema":1}']]);
  seq('done then blocked (sticky terminal)', [[null, '[done] ok'], ['status', '[blocked] again']]);
  seq('aborted then done', [[null, '[aborted] stopped'], [null, '[done] late']]);
  seq('parked: wait then tool', [['heartbeat', '[working · verifying] Not done yet — a scheduled wakeup still pending.'], ['tool', '[tool] Bash: npm test']]);
  seq('parked: wait then run words', [['heartbeat', '[working · verifying] Not done yet — a scheduled wakeup still pending.'], ['assistant-text', 'Still waiting on CI.']]);
  seq('report line then done with url', [['assistant-text', 'DONE: opened https://github.com/o/r/pull/7'], [null, '[done] Task completed', { url: 'https://github.com/o/r/pull/5' }]]);
  seq('done then a later PR mention', [[null, '[done] Task completed'], ['evidence', '[evidence] https://github.com/o/r/pull/9']]);
  seq('decision case then decision', [['assistant-text', 'Option A is cheaper.'], ['assistant-text', 'Option B is safer.'], ['decision', '[decision] {"decision_id":"d-1","question":"Which?"}']]);
  seq('ticket walk', [['status', '[ticket] LIN-9 started'], ['status', '[ticket] LIN-9 done'], [null, '[done] lane finished']]);
  seq('heartbeats then done', [['heartbeat', '[working] 4 tools/30s · Bash×4 · alive'], ['heartbeat', '[working] 9 tools/60s · Bash×6 Edit×3 · alive'], [null, '[done] Task completed in 90s']]);
  return cases;
}

const idx = (feedback, e) => (e ? feedback.indexOf(e) : null);

/**
 * Every touched reader's answer for one feedback array, as plain JSON.
 *
 * @param {Array<Object>} feedback
 * @param {Object} m - the reader modules: { terminal, telemetry, digest, wake, churn, closure, runView, efficacy }
 * @param {(entry: Object) => any} messageArg - what the entry predicates take (the message before, the entry after)
 */
export function readSurfaces(feedback, m, messageArg) {
  const t = m.terminal;
  const terminal = t.findTerminalFeedback(feedback);
  const wake = t.findWakeEvent(feedback);
  const park = t.derivePendingPark(feedback);
  const row = { _id: 'P', rootItemId: 'P', kind: 'implementation', status: 'taken', dispatchedAt: at(0), resolvedAt: at(1), followUpTo: null, bookkeeping: null, feedback: feedback.map((f) => ({ ...f, rootItemId: 'P' })) };
  const beat = { _id: 'beat', rootItemId: 'P', kind: 'implementation', status: 'taken', dispatchedAt: at(2), resolvedAt: at(3), followUpTo: 'P', bookkeeping: null, feedback: [] };
  const rawDoc = { _id: 'P', dispatchedAt: new Date(at(0)), feedback: feedback.map((f) => ({ ...f, timestamp: new Date(f.timestamp) })) };
  const digest = m.digest.digestFeedback(rawDoc, { now: T0 + 3600 * 1000 });
  const loop = { loopId: 'P', feedback };
  return {
    findTerminalFeedback: terminal ? { index: idx(feedback, terminal.entry), status: terminal.status } : null,
    deriveTerminalStatus: t.deriveTerminalStatus(feedback),
    hasTerminalMarker: ['done', 'failed', 'aborted', 'skipped'].map((s) => t.hasTerminalMarker(feedback, s)),
    deriveLifecycleStatus: t.deriveLifecycleStatus(feedback),
    deriveBlockedStatus: t.deriveBlockedStatus(feedback),
    derivePendingPark: idx(feedback, park),
    deriveCompletedAt: t.deriveCompletedAt(feedback),
    deriveWireStatus: t.deriveWireStatus({ feedback, bookkeeping: null }),
    deriveWireTerminal: t.deriveWireTerminal({ feedback, bookkeeping: null }),
    findWakeEvent: wake ? { index: idx(feedback, wake.entry), marker: wake.marker } : null,
    isLineageClosingTerminal: feedback.map((e) => t.isLineageClosingTerminal(messageArg(e))),
    isWakeEvent: feedback.map((e) => t.isWakeEvent(messageArg(e))),
    isStatusBearingMessage: feedback.map((e) => t.isStatusBearingEntry(messageArg(e))),
    parseParkedWait: m.telemetry.parseParkedWait(feedback),
    buildRunTelemetry: m.telemetry.buildRunTelemetry({ dispatchedAt: at(0), feedback }),
    correlateDecisionCase: m.digest.correlateDecisionCase(feedback, feedback.length),
    loopFacingFacts: (({ terminal: tt, wake: w, decisionCase }) => ({ terminal: tt ? idx(feedback, tt.entry) : null, wake: w, decisionCase }))(m.digest.deriveLoopFacingFacts(feedback, at(0))),
    digestKpi: { kpiTerminalEntry: digest.kpiTerminalEntry, kpiTicketMarkerEntries: digest.kpiTicketMarkerEntries, kpiEvidenceCount: digest.kpiEvidenceCount },
    prUrlOfFeedback: m.wake.prUrlOfFeedback(feedback),
    terminalPrUrlOfFeedback: m.wake.terminalPrUrlOfFeedback(feedback),
    terminalReportedPrUrlOfFeedback: m.wake.terminalReportedPrUrlOfFeedback(feedback),
    ownSegment: m.churn.ownSegment(row),
    markerEntries: m.churn.markerEntries(row),
    selectLineageCloses: (({ closes, skippedIds }) => ({
      closes: closes.map((c) => [c.id, c.reason, c.ownTerminalNow]),
      skipped: Object.entries(skippedIds).filter(([, ids]) => ids.length)
    }))(m.closure.selectLineageCloses([row, beat])),
    runIsWaiting: m.runView.runIsWaiting(loop),
    incumbentSignal: m.efficacy.computeIncumbentSignal([{ ...loop, issueIdentifier: 'LIN-1', dispatchedAt: at(0) }]).perLoop
  };
}

/** The readers' answers as JSON (Dates as ISO strings), so a recorded golden and a fresh read compare byte for byte. */
export const asJson = (value) => JSON.parse(JSON.stringify(value));
