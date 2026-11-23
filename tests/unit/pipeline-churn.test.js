import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTicket, summarizeChurn, ownSegment, workerSpanMs, longestStallMs, taskHead, CAUSES,
} from '../../lib/pipeline-churn.js';
import { verdictFactsFromRecords } from '../../lib/records/verdict-facts.js';

// Rows in the shape GET /dispatch?issueIdentifier= merged with GET /dispatch/{id}
// returns: wakes and customs carry their lineage's feedback, workers their own.
const T0 = Date.parse('2026-10-24T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
let n = 0;
const id = (tag) => `${tag}-${String(++n).padStart(4, '0')}-0000-0000-000000000000`;

function worker(kind, start, end, { marker = 'done', text = 'DONE: finished.', status, extra = [], followUpTo = null } = {}) {
  return {
    id: id(kind), kind, status: status || (marker === 'blocked' ? 'blocked' : marker), followUpTo,
    dispatchedAt: at(start), completedAt: marker === 'blocked' ? null : at(end), closedAt: null,
    feedback: [
      { timestamp: at(start), message: `[started] Running task in linearviewer (claude-code)\nTask: ${kind} — "# ${kind} LIN-1" (100 chars)` },
      ...extra,
      { timestamp: at(end), kind: 'assistant-text', message: text },
      { timestamp: at(end), kind: 'status', message: `[${marker}] ${text}` },
    ],
  };
}
const wake = (start, followUpTo) => ({
  id: id('wake'), kind: 'wake', status: 'done', followUpTo, dispatchedAt: at(start), completedAt: at(999),
  feedback: [{ timestamp: at(start + 0.1), message: '[started] Follow-up delivered to held session x\nTask: Prompt — "A child session reached a terminal outcome — resume your cross-check." (140 chars)' },
    { timestamp: at(start + 0.5), kind: 'status', message: '[pending] Not done — waiting on the next child.' }],
});
const custom = (start, head, { followUpTo = null, status = 'done', end = start + 0.5 } = {}) => ({
  id: id('custom'), kind: 'custom', status, followUpTo, dispatchedAt: at(start), completedAt: at(999),
  feedback: status === 'aborted' ? [{ timestamp: at(end), kind: 'status', message: '[aborted] Cancelled.' }] : [
    { timestamp: at(start + 0.05), message: `[started] Follow-up delivered to held session x\nTask: Prompt — "${head}" (187 chars)` },
    { timestamp: at(end), kind: 'status', message: '[pending] Not done — waiting.' }],
});
const autopilot = () => ({ id: id('autopilot'), kind: 'autopilot', status: 'done', dispatchedAt: at(0), completedAt: at(999),
  feedback: [{ timestamp: at(0.5), kind: 'status', message: '[pending] Not done — dispatched the first step.' }] });

const causesOf = (result) => result.entries.map((e) => `${e.kind}:${e.cause}`);

test('the stage path is seven dispatches, each wake counted under the worker it follows', () => {
  const ap = autopilot();
  const impl = worker('implementation', 1, 10);
  const rev = worker('review', 11, 14, { text: 'DONE: review posted, verdict Approve.' });
  const co = worker('close-out', 15, 20);
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, impl, wake(10, ap.id), rev, wake(14, ap.id), co, wake(20, ap.id)] });
  assert.equal(r.total, 7);
  assert.deepEqual(new Set(r.entries.map((e) => e.cause)), new Set(['stage-path']));
  assert.deepEqual(r.entries.filter((e) => e.kind === 'wake').map((e) => e.ownerId), [impl.id, rev.id, co.id]);
  assert.equal(summarizeChurn([r]).extraOverStagePath, 0);
});

// LIN-4373: the leftover step follows the build into its own session, once per ticket, by
// design. Without its own branch it read as a follow-up into a worker: a stall recovery.
test('the leftover step is a stage of the path, not a stall recovery, and adds nothing over it', () => {
  const ap = autopilot();
  const impl = worker('implementation', 1, 10);
  const left = worker('leftover', 10.2, 12, { followUpTo: impl.id, text: 'DONE: ### Leftovers: nothing.' });
  const rev = worker('review', 13, 14, { text: 'DONE: review posted, verdict Approve.' });
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, impl, left, wake(12, ap.id), rev] });
  const entry = r.entries.find((e) => e.kind === 'leftover');
  assert.equal(entry.cause, 'stage-path');
  assert.equal(entry.note, 'leftover step');
  assert.equal(summarizeChurn([r]).extraOverStagePath, 0);
});

test('a CI-finished wake is the orchestrator\'s when it lands on the autopilot lineage, a worker\'s when on the worker, CI red when failing', () => {
  const ap = autopilot();
  const impl = worker('implementation', 1, 10);
  const w = wake(10, ap.id);
  const rev = worker('review', 11, 14, { text: 'DONE: verdict Approve.' });
  const rows = [ap, impl, w, rev,
    custom(12, 'CI finished on https://github.com/o/r/pull/1 (head abc1234): passing.', { followUpTo: w.id }),
    custom(13, 'CI finished on https://github.com/o/r/pull/1 (head abc1234): passing.', { followUpTo: impl.id }),
    custom(13.5, 'CI finished on https://github.com/o/r/pull/1 (head def5678): failing.', { followUpTo: impl.id })];
  const r = classifyTicket({ identifier: 'LIN-1', rows });
  assert.deepEqual(r.entries.filter((e) => e.kind === 'custom').map((e) => e.cause), ['ci-wake-orchestrator', 'ci-wake-worker', 'ci-red']);
});

test('a close-out held after its merge is a post-deploy hold; one that says the merge did not land is not', () => {
  const ap = autopilot();
  const held = (start, text) => worker('close-out', start, start + 5, { marker: 'blocked', text });
  const a = classifyTicket({ identifier: 'LIN-1', rows: [ap, worker('implementation', 1, 5),
    held(6, 'BLOCKED: PR 1 is merged and deployed. It stays open because the review\'s post-deploy check needs production access.'),
    worker('close-out', 30, 32)] });
  assert.equal(a.entries[3].cause, 'close-out-held');
  assert.equal(a.entries[3].note, 'held on a post-deploy check');
  const b = classifyTicket({ identifier: 'LIN-1', rows: [ap, worker('implementation', 1, 5),
    held(6, 'BLOCKED: I did not merge #284; the ticket reserves that merge. Post-deploy checks follow.'),
    worker('close-out', 30, 32)] });
  assert.equal(b.entries[3].note, 'held before the merge');
});

test('a close-out re-dispatched after its predecessor merged and then held again reads the latest hold', () => {
  const ap = autopilot();
  const first = worker('close-out', 6, 8, { marker: 'blocked', text: 'BLOCKED: The merge is held: the cache tiers are not supplied.' });
  first.feedback.push(
    { timestamp: at(12), kind: 'status', message: '[working] Session resumed. Executing follow-up...' },
    { timestamp: at(20), kind: 'status', message: '[blocked] PR 1 is merged and deployed; the post-deploy checks need production access.' });
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, worker('implementation', 1, 5), first, wake(20, ap.id), worker('close-out', 30, 32)] });
  assert.equal(r.entries[4].cause, 'close-out-held');
  assert.equal(r.entries[4].note, 'held on a post-deploy check');
  assert.equal(r.entries[3].ownerId, first.id); // the second park's wake is the close-out's
});

test('a resume after an answer is a ruling resume; two rulings open at once share their person-wait', () => {
  const ap = autopilot();
  const impl = worker('implementation', 1, 10, { marker: 'blocked', text: 'BLOCKED: need the rates.' });
  const questions = [
    { id: 'rates-a', asks: 'How?', options: ['Operator pastes the rates'], runId: impl.id, raisedAt: at(10), resolvedAt: at(40), outcome: 'answered' },
    { id: 'rates-b', asks: 'How, again?', options: ['Paste'], runId: ap.id, raisedAt: at(20), resolvedAt: at(41), outcome: 'answered' },
  ];
  const resume = custom(40.1, 'Operator pastes the rates', { followUpTo: impl.id });
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, impl, resume], questions });
  assert.equal(r.entries[2].cause, 'ruling-resume');
  assert.equal(r.entries[2].note, 'rates-a');
  assert.deepEqual(r.rulings.find((x) => x.decisionId === 'rates-b').openAtRaise, ['rates-a']);
  assert.equal(r.personWaitMs, 31 * 60000); // 10→41, not 30 + 21
});

test('a dispatch aborted before work and its abort carrier are one misroute, and the wake goes with them', () => {
  const ap = autopilot();
  const bd = worker('breakdown', 5, 5.4, { marker: 'aborted', status: 'aborted', text: 'aborted' });
  const carrier = custom(5.3, '', { status: 'aborted', end: 5.4 });
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, bd, carrier, wake(5.4, ap.id), worker('implementation', 6, 10)] });
  assert.deepEqual(causesOf(r).slice(1, 4), ['breakdown:aborted-before-work', 'custom:aborted-before-work', 'wake:aborted-before-work']);
});

test('a worker dispatched as a follow-up into another worker is stall recovery, not a fresh stage', () => {
  const ap = autopilot();
  const impl = worker('implementation', 1, 10);
  const probe = worker('implementation', 12, 15, { followUpTo: impl.id });
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, impl, probe] });
  assert.equal(r.entries[2].cause, 'stall-recovery');
  assert.match(r.entries[2].note, /^follow-up into implementation /);
});

test('an implementation re-dispatched after an aborted one is stall recovery, and so is the wake that follows the abort', () => {
  const ap = autopilot();
  const hung = worker('implementation', 1, 62, { marker: 'aborted', status: 'aborted', text: 'aborted' });
  const redo = worker('implementation', 64, 80);
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, hung, wake(62, ap.id), redo] });
  assert.equal(r.entries[1].cause, 'stage-path'); // the first implementation is the stage path's, hung or not
  assert.equal(r.entries[2].cause, 'stall-recovery'); // the wake an aborted stage-path worker sends is the stall's
  assert.equal(r.entries[2].ownerId, hung.id);
  assert.equal(r.entries[3].cause, 'stall-recovery');
  assert.match(r.entries[3].note, /^previous implementation .* aborted$/);
});

test('a second close-out dispatched while the first one\'s turn is still open is a concurrent duplicate', () => {
  const ap = autopilot();
  const first = worker('close-out', 5, 30);
  const second = worker('close-out', 10, 20);
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, worker('implementation', 1, 4), first, second] });
  assert.equal(r.entries[2].cause, 'stage-path');
  assert.equal(r.entries[3].cause, 'concurrent-duplicate');
  assert.match(r.entries[3].note, /still live$/);
});

test('an answer resumed into a close-out while a newer close-out is live runs the stage twice', () => {
  const ap = autopilot();
  const held = worker('close-out', 6, 8, { marker: 'blocked', text: 'BLOCKED: the merge is held on a ruling.' });
  const fresh = worker('close-out', 30, 40);
  const questions = [{ id: 'merge-ok', asks: 'Merge?', options: ['Merge it'], runId: held.id, raisedAt: at(8), resolvedAt: at(34.9), outcome: 'answered' }];
  const resume = custom(35, 'Merge it', { followUpTo: held.id });
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, worker('implementation', 1, 5), held, fresh, resume], questions });
  assert.equal(r.entries[3].cause, 'close-out-held');
  assert.equal(r.entries[4].cause, 'concurrent-duplicate');
  assert.match(r.entries[4].note, /^merge-ok resumed close-out .* while .* was live$/);
});

test('a stall counts only inside the working window, and a parked worker\'s span keeps its wait', () => {
  const stalled = worker('close-out', 0, 70, { extra: [
    { timestamp: at(64), kind: 'heartbeat', message: '[stalled?] no tool activity for 61m 57s in EXECUTING (last tool: Bash)' }] });
  assert.equal(longestStallMs(stalled, ownSegment(stalled).endMs), (61 * 60 + 57) * 1000);
  // a stretch that began before the row's dispatch is the lineage's park, not this row's stall
  const resumed = { ...stalled, dispatchedAt: at(40) };
  assert.equal(longestStallMs(resumed, ownSegment(resumed).endMs), 0);
  const parked = worker('implementation', 0, 5, { marker: 'pending', text: 'PENDING-EXTERNAL: waiting on CI.' });
  parked.completedAt = at(120);
  assert.equal(ownSegment(parked).wallMs, 5 * 60000);
  assert.equal(workerSpanMs(parked), 120 * 60000);
});

test('taskHead prefers the prompt line the script read for a row that never posted [started]', () => {
  assert.equal(taskHead({ promptHead: 'Operator note: merged', feedback: [] }), 'Operator note: merged');
  assert.equal(taskHead(custom(1, 'CI finished on x (head a): passing.')), 'CI finished on x (head a): passing.');
});

// Characterization (LIN-4519 P6): the readings that do not depend on verdicts. Captured from the code before the
// verdict-record change; a row's cause, note, walls and the summary's shape must stay exactly these.
test('characterization: the verdict-free readings keep their causes, notes, walls and summary shape', () => {
  const ap = autopilot();
  const survey = worker('survey-task', 0.5, 2);
  const plan = worker('plan', 3, 5);
  const pr = worker('plan-review', 6, 7, { text: 'DONE: verdict Approve.' });
  const impl = worker('implementation', 8, 12);
  const wk1 = wake(12, ap.id);
  const rev = worker('review', 13, 15, { text: 'DONE: verdict Approve.' });
  const blind = worker('blind-read', 15.5, 16, { text: 'DONE: Verdict: better.' });
  const wk2 = wake(15, ap.id);
  const heldCo = worker('close-out', 17, 20, { marker: 'blocked', text: 'BLOCKED: PR 1 is merged and deployed; post-deploy checks need production access.' });
  const co = worker('close-out', 30, 32);
  const ci = custom(33, 'CI finished on https://github.com/o/r/pull/1 (head abc1234): failing.', { followUpTo: co.id });
  const leftover = worker('leftover', 12.2, 13, { followUpTo: impl.id, text: 'DONE: ### Leftovers: nothing.' });
  const bd = worker('breakdown', 40, 40.2, { marker: 'aborted', status: 'aborted', text: 'aborted' });
  const carrier = custom(40.1, '', { status: 'aborted', end: 40.2 });
  const op = custom(50, 'Operator note: check the deploy', {});
  const rows = [ap, survey, plan, pr, impl, wk1, leftover, rev, blind, wk2, heldCo, co, ci, bd, carrier, op];
  const named = (s) => {
    let out = s;
    for (const r of rows) if (out) out = out.replace(new RegExp(`${r.id.slice(0, 8)}(?=[\\s:]|$)`, "g"), `<${r.kind}>`);
    return out;
  };
  const result = classifyTicket({ identifier: 'LIN-1', rows });
  const entries = result.entries.map((e) => ({
    kind: e.kind, cause: e.cause, note: named(e.note), wallMs: e.wallMs, stalledMs: e.stalledMs,
    owner: rows.find((r) => r.id === e.ownerId)?.kind ?? null, afterFirstImplementation: e.afterFirstImplementation,
  }));
  assert.deepEqual(entries, [
  { kind: 'autopilot', cause: 'stage-path', note: null, wallMs: 30000, stalledMs: 0, owner: null, afterFirstImplementation: false },
  { kind: 'survey-task', cause: 'first-pass-stage', note: null, wallMs: 90000, stalledMs: 0, owner: null, afterFirstImplementation: false },
  { kind: 'plan', cause: 'first-pass-stage', note: null, wallMs: 120000, stalledMs: 0, owner: null, afterFirstImplementation: false },
  { kind: 'plan-review', cause: 'first-pass-stage', note: null, wallMs: 60000, stalledMs: 0, owner: null, afterFirstImplementation: false },
  { kind: 'implementation', cause: 'stage-path', note: null, wallMs: 240000, stalledMs: 0, owner: null, afterFirstImplementation: false },
  { kind: 'wake', cause: 'stage-path', note: 'wake after implementation <implementation>', wallMs: 30000, stalledMs: 0, owner: 'implementation', afterFirstImplementation: true },
  { kind: 'leftover', cause: 'stage-path', note: '<leftover> step', wallMs: 48000, stalledMs: 0, owner: null, afterFirstImplementation: true },
  { kind: 'review', cause: 'stage-path', note: null, wallMs: 120000, stalledMs: 0, owner: null, afterFirstImplementation: true },
  { kind: 'wake', cause: 'stage-path', note: 'wake after review <review>', wallMs: 30000, stalledMs: 0, owner: 'review', afterFirstImplementation: true },
  { kind: 'blind-read', cause: 'stage-path', note: 'blind read', wallMs: 30000, stalledMs: 0, owner: null, afterFirstImplementation: true },
  { kind: 'close-out', cause: 'stage-path', note: null, wallMs: 180000, stalledMs: 0, owner: null, afterFirstImplementation: true },
  { kind: 'close-out', cause: 'close-out-held', note: 'held on a post-deploy check', wallMs: 120000, stalledMs: 0, owner: null, afterFirstImplementation: true },
  { kind: 'custom', cause: 'ci-red', note: 'CI failing on https://github.com/o/r/pull/1', wallMs: 30000, stalledMs: 0, owner: null, afterFirstImplementation: true },
  { kind: 'breakdown', cause: 'aborted-before-work', note: 'breakdown aborted after 12s', wallMs: 12000, stalledMs: 0, owner: null, afterFirstImplementation: true },
  { kind: 'custom', cause: 'aborted-before-work', note: 'abort of breakdown <breakdown>', wallMs: 6000, stalledMs: 0, owner: 'breakdown', afterFirstImplementation: true },
  { kind: 'custom', cause: 'operator-follow-up', note: 'Operator note: check the deploy', wallMs: 30000, stalledMs: 0, owner: null, afterFirstImplementation: true },
  ]);
  const summary = summarizeChurn([result]);
  assert.deepEqual(Object.keys(summary), ['tickets', 'dispatches', 'extraOverStagePath', 'byCause', 'rulings', 'personWaitMs']);
  assert.deepEqual(summary.byCause.map((c) => [c.cause, c.dispatches, c.wakes, c.wallMs, c.stalledMs, c.tickets]), [
    ['stage-path', 8, 2, 708000, 0, { 'LIN-1': 8 }],
    ['first-pass-stage', 3, 0, 270000, 0, { 'LIN-1': 3 }],
    ['aborted-before-work', 2, 0, 18000, 0, { 'LIN-1': 2 }],
    ['close-out-held', 1, 0, 120000, 0, { 'LIN-1': 1 }],
    ['ci-red', 1, 0, 30000, 0, { 'LIN-1': 1 }],
    ['operator-follow-up', 1, 0, 30000, 0, { 'LIN-1': 1 }],
  ]);
});

// LIN-4519 P6: a verdict-dependent reading comes from the verdict records of the row's window. The rows here are
// shifted past the cutover (VERDICT_RECORDS_SINCE, 2026-11-22 04:20Z) unless a test says otherwise.
const LATE_MS = Date.parse('2026-11-22T10:00:00.000Z') - T0;
const shiftIso = (iso) => (iso ? new Date(Date.parse(iso) + LATE_MS).toISOString() : iso);
const late = (row) => ({ ...row, dispatchedAt: shiftIso(row.dispatchedAt), completedAt: shiftIso(row.completedAt), closedAt: shiftIso(row.closedAt),
  feedback: (row.feedback || []).map((f) => ({ ...f, timestamp: shiftIso(f.timestamp) })) });
const vAt = (min) => shiftIso(at(min));
/** The verdict facts of LIN-1 from records: [judgement, outcome, first-write instant] per verdict. */
const factsOf = (verdicts = []) => verdictFactsFromRecords({
  tasks: [{ id: 'task-1', kind: 'task', fields: { ref: 'LIN-1' } }],
  verdicts: verdicts.map(([judgement, outcome, when], i) => ({ id: `verdict-${i}`, kind: 'verdict', in: 'task-1', at: when, state: 'stands', fields: { judgement, outcome } })),
}, ['LIN-1']).get('LIN-1');

test('implementation after a review that asked for changes reads the review record, not the review text', () => {
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8, { text: 'DONE: verdict Approve.' }), worker('implementation', 9, 12)].map(late);
  const r = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf([['review', 'request-changes', vAt(7)]]) });
  assert.equal(r.entries[3].cause, 'review-changes');
  assert.equal(r.entries[3].note, `review ${r.entries[2].id.slice(0, 8)}: request-changes`);
});

test('implementation after a review whose record approves is a fix round close-out owns, whatever the text says', () => {
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8, { text: 'DONE: verdict Request Changes.' }), worker('implementation', 9, 12)].map(late);
  const r = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf([['review', 'approve', vAt(7)]]) });
  assert.equal(r.entries[3].cause, 'fixes-outside-close-out');
});

test('before the cutover a review verdict is not measured, with the reason, and the comment text is not read', () => {
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8, { text: 'DONE: verdict Request Changes.' }), worker('implementation', 9, 12)];
  const r = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf() });
  assert.equal(r.entries[3].cause, 'not-measured');
  assert.match(r.entries[3].note, /^review .*: not measured \(no verdict records before 2026-11-22 04:20Z\)$/);
  const s = summarizeChurn([r]);
  assert.equal(s.extraOverStagePath, 1); // not-measured is still a dispatch beyond the stage path
  assert.equal(s.byCause.find((c) => c.cause === 'not-measured').label, CAUSES['not-measured'].label);
});

test('a withdrawn approve in the review window is no verdict: the implementation row reads not-measured, not fixes-outside-close-out', () => {
  // finding-1d1d6d74: round trips leaves a withdrawn verdict out, and churn must too (verdictsInWindow).
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8, { text: 'DONE: verdict Approve.' }), worker('implementation', 9, 12)].map(late);
  const withdrawn = verdictFactsFromRecords({
    tasks: [{ id: 'task-1', kind: 'task', fields: { ref: 'LIN-1' } }],
    verdicts: [{ id: 'verdict-w', kind: 'verdict', in: 'task-1', at: vAt(7), state: 'withdrawn', fields: { judgement: 'review', outcome: 'approve' } }],
  }, ['LIN-1']).get('LIN-1');
  const r = classifyTicket({ identifier: 'LIN-1', rows, verdicts: withdrawn });
  assert.equal(r.entries[3].cause, 'not-measured');
  assert.notEqual(r.entries[3].cause, 'fixes-outside-close-out');
});

test('a post-cutover review with no verdict record in its window is not measured, not repeat-stage', () => {
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8), worker('implementation', 9, 12)].map(late);
  const r = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf() });
  assert.equal(r.entries[3].cause, 'not-measured');
  assert.match(r.entries[3].note, /no review verdict record written in its window/);
});

test('a verdict written outside the review\'s window is not that review\'s', () => {
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8), worker('implementation', 9, 12)].map(late);
  const r = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf([['review', 'request-changes', vAt(20)]]) });
  assert.equal(r.entries[3].cause, 'not-measured');
});

test('a verdict of another judgement in the window does not stand for the review', () => {
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8), worker('implementation', 9, 12)].map(late);
  const r = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf([['blind-read', 'worse', vAt(7)]]) });
  assert.equal(r.entries[3].cause, 'not-measured');
});

test('two review verdicts in one window: the later one is the review\'s outcome', () => {
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8), worker('implementation', 9, 12)].map(late);
  const r = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf([['review', 'request-changes', vAt(7)], ['review', 'approve', vAt(7.5)]]) });
  assert.equal(r.entries[3].cause, 'fixes-outside-close-out');
});

test('no verdict records read at all is not measured, never "no verdict"', () => {
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8, { text: 'DONE: verdict Request Changes.' }), worker('implementation', 9, 12)].map(late);
  const r = classifyTicket({ identifier: 'LIN-1', rows });
  assert.equal(r.entries[3].cause, 'not-measured');
  assert.match(r.entries[3].note, /the verdict records were not read/);
});

test('a re-review follows the verdict of the review before it: request changes is review changes, approve is a repeat', () => {
  const ap = autopilot();
  const rows = [ap, worker('implementation', 1, 5), worker('review', 6, 8), worker('implementation', 9, 12), worker('review', 13, 15)].map(late);
  const asked = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf([['review', 'request-changes', vAt(7)]]) });
  assert.equal(asked.entries[4].cause, 'review-changes');
  const approved = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf([['review', 'approve', vAt(7)]]) });
  assert.equal(approved.entries[4].cause, 'repeat-stage');
});

test('a plan sent back by plan-review reads the plan-review record: request changes re-plans, approve does not', () => {
  const ap = autopilot();
  const rows = [ap, worker('plan', 1, 3), worker('plan-review', 4, 6), worker('plan', 7, 8), worker('plan-review', 9, 10), worker('implementation', 11, 20)].map(late);
  const asked = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf([['plan-review', 'request-changes', vAt(5)], ['plan-review', 'approve', vAt(10)]]) });
  assert.deepEqual(causesOf(asked).slice(1, 6), ['plan:first-pass-stage', 'plan-review:first-pass-stage', 'plan:plan-rejected', 'plan-review:plan-rejected', 'implementation:stage-path']);
  assert.equal(asked.entries[3].note, `plan-review ${asked.entries[2].id.slice(0, 8)}: request-changes`);
  const approved = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf([['plan-review', 'approve', vAt(5)], ['plan-review', 'approve', vAt(10)]]) });
  assert.equal(approved.entries[3].cause, 'repeat-stage');
});

test('a re-plan before the cutover is not measured, with the reason', () => {
  const ap = autopilot();
  const rows = [ap, worker('plan', 1, 3), worker('plan-review', 4, 6, { text: 'DONE: verdict Request Changes.' }), worker('plan', 7, 8)];
  const r = classifyTicket({ identifier: 'LIN-1', rows, verdicts: factsOf() });
  assert.equal(r.entries[3].cause, 'not-measured');
  assert.match(r.entries[3].note, /no verdict records before 2026-11-22 04:20Z/);
});

// LIN-4544: a blind read is one per change, so a second read on the ticket is a repeat even after a re-review, and a
// retrospective audit (its notes PR is a new landing with its own read) starts the count again.
test('a second blind read after a re-review is a repeat-stage; the audit\'s notes PR read is a stage path again', () => {
  const ap = autopilot();
  const rows = [
    ap, worker('implementation', 1, 5), worker('review', 6, 8, { text: 'DONE: verdict Approve.' }),
    worker('blind-read', 9, 10, { text: 'DONE: Verdict: same.' }), worker('review', 11, 13, { text: 'DONE: verdict Approve.' }),
    worker('blind-read', 14, 15, { text: 'DONE: Verdict: same.' }), worker('retrospective-audit', 16, 18),
    worker('blind-read', 19, 20, { text: 'DONE: Verdict: same.' }),
  ].map(late);
  const r = classifyTicket({ identifier: 'LIN-1', rows });
  assert.equal(r.entries[3].cause, 'stage-path', 'the first read of the change');
  assert.equal(r.entries[5].cause, 'repeat-stage', 'a second read after a re-review is the repeat, not a path stage');
  assert.equal(r.entries[6].cause, 'audit');
  assert.equal(r.entries[7].cause, 'stage-path', 'the audit\'s notes PR is a new landing: its read is the path');
});
