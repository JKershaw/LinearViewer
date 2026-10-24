import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTicket, summarizeChurn, ownSegment, workerSpanMs, longestStallMs, taskHead,
} from '../../lib/pipeline-churn.js';

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

test('a plan sent back by plan-review costs a re-plan and a re-review, read structurally when no verdict text is anchored', () => {
  const ap = autopilot();
  const rows = [ap,
    worker('plan', 1, 3), worker('plan-review', 4, 6, { text: 'DONE: posted Request Changes, 2 blocking findings.' }),
    worker('plan', 7, 8), worker('plan-review', 9, 10, { text: 'DONE: plan-review verdict: Approve.' }),
    worker('implementation', 11, 20)];
  const r = classifyTicket({ identifier: 'LIN-1', rows });
  assert.deepEqual(causesOf(r).slice(1, 5), ['plan:first-pass-stage', 'plan-review:first-pass-stage', 'plan:plan-rejected', 'plan-review:plan-rejected']);
  assert.match(r.entries[3].note, /structural/);
  assert.equal(r.entries[5].cause, 'stage-path');
  assert.equal(r.entries[5].afterFirstImplementation, false);
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
  const rulings = [
    { decision: { decision_id: 'rates-a', question: 'How?', options: [{ id: 'p', label: 'Operator pastes the rates' }] },
      anchor: { loopId: impl.id }, stampLoopId: impl.id,
      resolution: { raisedAt: at(10), resolvedAt: at(40), outcome: 'answered' } },
    { decision: { decision_id: 'rates-b', question: 'How, again?', options: [{ id: 'p', label: 'Paste' }] },
      anchor: { loopId: ap.id }, stampLoopId: ap.id,
      resolution: { raisedAt: at(20), resolvedAt: at(41), outcome: 'answered' } },
  ];
  const resume = custom(40.1, 'Operator pastes the rates', { followUpTo: impl.id });
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, impl, resume], rulings });
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

test('implementation after an Approve is a fix round close-out owns; after Request Changes it is review changes', () => {
  const ap = autopilot();
  const approve = classifyTicket({ identifier: 'LIN-1', rows: [ap, worker('implementation', 1, 5),
    worker('review', 6, 8, { text: 'DONE: verdict "Approve — conditional on close-out discharging the ledger".' }),
    worker('implementation', 9, 12)] });
  assert.equal(approve.entries[3].cause, 'fixes-outside-close-out');
  const rc = classifyTicket({ identifier: 'LIN-1', rows: [ap, worker('implementation', 1, 5),
    worker('review', 6, 8, { text: 'DONE: verdict is Request Changes.' }), worker('implementation', 9, 12), worker('review', 13, 15)] });
  assert.deepEqual(causesOf(rc).slice(3), ['implementation:review-changes', 'review:review-changes']);
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
  const rulings = [{ decision: { decision_id: 'merge-ok', question: 'Merge?', options: [{ id: 'y', label: 'Merge it' }] },
    anchor: { loopId: held.id }, stampLoopId: held.id,
    resolution: { raisedAt: at(8), resolvedAt: at(34.9), outcome: 'answered' } }];
  const resume = custom(35, 'Merge it', { followUpTo: held.id });
  const r = classifyTicket({ identifier: 'LIN-1', rows: [ap, worker('implementation', 1, 5), held, fresh, resume], rulings });
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
