/**
 * LIN-4531 (LIN-4529 P2a): an agent's question is answered or dismissed through one route each, and the asking run is resumed
 * with the question, the option and the words together (lib/question-answers.js). Runs on the real records store, the real
 * dispatch store and the checked records pipeline; the resume is an injected fake that writes a follow-up row the way the
 * factory does, so a retry reads the same marker it would in production.
 *
 * Witnesses (each fails before the change: no question service, no resume composer, no liveness leaf):
 *   - the behaviour table, one test per row: resumable (answer and dismiss), stopped, gone, mid-turn;
 *   - exactly one resume per answer: a second answer is 409 and makes no second follow-up;
 *   - a fault between the decision, the resume and the end, retried, never doubles and never loses the decision;
 *   - two answers, and an answer racing a dismissal, give one 409;
 *   - the resume prompt holds the question, the option and the words verbatim, in that order, with markup and a long sentence;
 *   - liveness lives in its own leaf (lib/run-liveness.js), and the old module re-exports the same values.
 *   - review finding 76818702: liveness and the follow-up target come from the run's lineage tail, not its first row;
 *   - review finding b6e34489: a non-owner's answer to a resumable question is refused before any write.
 *   - LIN-4545: the decision sits `in` the question's task for a resumable, a stopped and a gone run; a gone run's answer is
 *     under "what stands" in the next run's brief on that task; a retry over a decision written with no task moves it onto it.
 * The HTTP side (session auth, `by` from the session, the kickoff witness through the real factory) is in
 * tests/unit/lin-4531-question-answer-routes.test.js.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { createQuestionAnswers } from '../../lib/question-answers.js';
import { REAP_INACTIVITY_MS as LEAF_REAP, resolveDisposition as leafDisposition, runLoopFactsOf } from '../../lib/run-liveness.js';
import { REAP_INACTIVITY_MS, resolveDisposition } from '../../lib/unanswered-decisions.js';
import { questionAnsweredPrompt, questionDismissedPrompt, resumesQuestion, RESUME_ACTION } from '../../lib/prompts/question-resume.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { fixedIdOf } from '../../lib/records/refs.js';
import { composeRunBrief } from '../../lib/records/run-brief.js';
import { ANSWER_ON_TASK_REASON } from '../../lib/question-answers.js';

const URL_KEY = 'lin-4531-workspace';
const NOW = new Date('2026-11-22T12:00:00.000Z');
const DAY = 86400000;
const PERSON = 'person:acct-owner';
const harness = createMangoTmpdir('lin-4531-question-');
let db;
let records;
let dispatch;
let writes;
let enqueueCalls;
let enqueueResult;
let resumeRefusal;
let service;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  dispatch = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
  writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => [] });
  enqueueCalls = [];
  enqueueResult = null; // null: a 200 that writes the follow-up row, as the factory does
  resumeRefusal = null; // null: the owner gate allows the resume (the route's refuseResume)
  service = makeService();
});

/**
 * A follow-up row, as the factory writes one: rooted at the run, and `followUpTo` the row it follows up on (the run's tail, which
 * for a first resume is the run's own row). `followUpTo` defaults to the run, as it does for a first follow-up.
 */
async function writeFollowUp({ runId, prompt, id = `fu-${enqueueCalls.length}`, followUpTo = runId, status = 'queued', feedback = [], dispatchedAt = NOW }) {
  // As the factory writes one (lib/dispatch-factory.js inherits rootItemId from the parent).
  await dispatch.collection.insertOne({ _id: id, urlKey: URL_KEY, followUpTo, rootItemId: runId, prompt, feedback, status, dispatchedAt, target: 'cli', expiresAt: new Date('2099-01-01T00:00:00.000Z') });
  return id;
}

function makeService() {
  return createQuestionAnswers({
    recordsStore: records,
    writes,
    dispatchStore: dispatch,
    now: () => NOW,
    refuseResume: async (args) => (resumeRefusal ? resumeRefusal(args) : null),
    enqueueResume: async (args) => {
      enqueueCalls.push(args);
      if (enqueueResult) return enqueueResult(args);
      // The row takes the id of this call (fu-0 for the first resume), and follows up on the tail the service chose, as the factory does.
      const itemId = await writeFollowUp({ runId: args.runId, followUpTo: args.followUpTo, prompt: args.prompt, id: `fu-${enqueueCalls.length - 1}` });
      return { status: 200, body: { queued: true, itemId } };
    },
  });
}

/** A dispatch row for an asking run: `feedback` decides its state (blocked, done at a time, or taken with none). */
async function askingRun(id, { feedback = [], status = 'taken', target = 'cli', extra = {} } = {}) {
  await dispatch.collection.insertOne({
    _id: id, urlKey: URL_KEY, prompt: 'work', kind: 'implementation', promptName: null, target,
    issueIdentifier: 'LIN-9', dispatchedAt: new Date(NOW.getTime() - DAY), dispatchedBy: 'acct-owner', followUpTo: null,
    abort: false, cascade: false, sessionId: null, rootItemId: id, runRecordId: id, status, feedback,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'), ...extra,
  });
  return id;
}

/** A question asked by the run, its v1 `run` set to the run's id. */
async function askQuestion({ run, asks = 'Which way?', options = ['left', 'right'], ifUnanswered = 'pick left', inTask = null } = {}) {
  const snap = await writes.add({
    urlKey: URL_KEY, kind: 'question', by: 'implementation', run,
    input: { ...(inTask ? { in: inTask } : {}), asks, options, recommended: options[0], 'if-unanswered': ifUnanswered, to: 'project' },
  });
  assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
  return snap.record.id;
}

const blocked = (t = NOW) => [{ message: '[blocked] waiting on the person', timestamp: t.toISOString() }];
const doneAt = (t) => [{ message: '[done] finished', timestamp: t.toISOString() }];

describe('the behaviour table: resumable', () => {
  test('answer: the decision stands, one follow-up carries the question, the option and the words, the question ends answered', async () => {
    const run = await askingRun('run-a', { feedback: blocked() });
    const q = await askQuestion({ run });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'right', words: 'Go right, and keep the logs.', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.resumed, true);
    assert.equal(enqueueCalls.length, 1);
    assert.equal(enqueueCalls[0].runId, run);
    assert.equal(enqueueCalls[0].target, 'cli');
    const decision = await records.current(URL_KEY, fixedIdOf('decision', q, 'answer'));
    assert.equal(decision.kind, 'decision');
    assert.equal(decision.fields.answer, 'right');
    assert.equal(decision.fields.words, 'Go right, and keep the logs.');
    assert.equal((await records.current(URL_KEY, q)).state, 'answered');
  });

  test('a second answer to the same question is 409 and makes no second follow-up', async () => {
    const run = await askingRun('run-b', { feedback: blocked() });
    const q = await askQuestion({ run });
    await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    const again = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'right', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ruling-settled');
    assert.equal(enqueueCalls.length, 1);
  });

  test('dismiss: the question ends withdrawn with reason "dismissed", and the follow-up says so and quotes if-unanswered', async () => {
    const run = await askingRun('run-c', { feedback: blocked() });
    const q = await askQuestion({ run, ifUnanswered: 'keep the old flag' });
    const out = await service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.resumed, true);
    const ended = await records.current(URL_KEY, q);
    assert.equal(ended.state, 'withdrawn');
    assert.equal(ended.ended.reason, 'dismissed');
    assert.equal(enqueueCalls.length, 1);
    assert.match(enqueueCalls[0].prompt, /^Dismissal of question /m);
    assert.match(enqueueCalls[0].prompt, /keep the old flag/);
    assert.equal(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')), null, 'a dismissal writes no decision');
  });

  test('a run ended inside the 7-day window is resumable, and its resume is forced', async () => {
    const run = await askingRun('run-d', { status: 'done', feedback: doneAt(new Date(NOW.getTime() - DAY)) });
    const q = await askQuestion({ run });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.resumed, true);
    assert.equal(enqueueCalls[0].force, true);
  });
});

describe('the behaviour table: stopped', () => {
  test('answer: the decision stands, no follow-up, and the answer says the run was not resumed', async () => {
    const run = await askingRun('run-e', { feedback: blocked() });
    await dispatch.collection.insertOne({ _id: 'abort-e', urlKey: URL_KEY, abort: true, abortTo: run, feedback: [{ message: '[aborted] stopped by the person', timestamp: NOW.toISOString() }], status: 'done', feedbackAt: NOW, expiresAt: new Date('2099-01-01T00:00:00.000Z') });
    const q = await askQuestion({ run });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.resumed, false);
    assert.equal(out.body.notResumedBecause, 'stopped');
    assert.match(out.body.note, /was stopped, so it was not resumed/);
    assert.equal(enqueueCalls.length, 0);
    assert.ok(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')));
    assert.equal((await records.current(URL_KEY, q)).state, 'answered');
  });

  test('dismiss: the question is withdrawn and no follow-up is made', async () => {
    const run = await askingRun('run-f', { feedback: blocked() });
    await dispatch.collection.insertOne({ _id: 'abort-f', urlKey: URL_KEY, abort: true, abortTo: run, feedback: [{ message: '[aborted] stopped', timestamp: NOW.toISOString() }], status: 'done', feedbackAt: NOW, expiresAt: new Date('2099-01-01T00:00:00.000Z') });
    const q = await askQuestion({ run });
    const out = await service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200);
    assert.equal(out.body.notResumedBecause, 'stopped');
    assert.equal(enqueueCalls.length, 0);
    assert.equal((await records.current(URL_KEY, q)).state, 'withdrawn');
  });

  test('a follow-up the factory refuses as stopped (a race after the read) is not resumed, and the decision still stands', async () => {
    const run = await askingRun('run-g', { feedback: blocked() });
    const q = await askQuestion({ run });
    enqueueResult = async () => ({ status: 409, body: { error: 'The run was stopped', code: 'RUN_STOPPED', retryable: false } });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'right', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200);
    assert.equal(out.body.resumed, false);
    assert.equal(out.body.notResumedBecause, 'stopped');
    assert.ok(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')));
  });
});

describe('the behaviour table: gone', () => {
  test('answer: the decision stands, no follow-up, and the answer offers the next stage', async () => {
    const run = await askingRun('run-h', { status: 'done', feedback: doneAt(new Date(NOW.getTime() - 8 * DAY)) });
    const q = await askQuestion({ run });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200);
    assert.equal(out.body.resumed, false);
    assert.equal(out.body.notResumedBecause, 'no-session');
    assert.match(out.body.note, /dispatch the next stage/);
    assert.equal(enqueueCalls.length, 0);
  });

  test('a question with no asking run at all is gone: its answer stands and no follow-up is made', async () => {
    const q = await askQuestion({ run: null });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200);
    assert.equal(out.body.resumed, false);
    assert.equal(enqueueCalls.length, 0);
  });

  test('dismiss of a gone run withdraws the question and makes no follow-up', async () => {
    const run = await askingRun('run-i', { status: 'done', feedback: doneAt(new Date(NOW.getTime() - 8 * DAY)) });
    const q = await askQuestion({ run });
    const out = await service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200);
    assert.equal(enqueueCalls.length, 0);
    assert.equal((await records.current(URL_KEY, q)).state, 'withdrawn');
  });
});

describe('the behaviour table: mid-turn and indeterminate', () => {
  test('answer and dismiss are refused 409 while the run is still working, and nothing is written', async () => {
    const run = await askingRun('run-j', { feedback: [], status: 'taken' });
    const q = await askQuestion({ run });
    const answered = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(answered.status, 409);
    assert.equal(answered.body.code, 'not-answerable');
    assert.equal(answered.body.reason, 'mid-turn');
    const dismissed = await service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(dismissed.status, 409);
    assert.equal((await records.current(URL_KEY, q)).state, 'open');
    assert.equal(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')), null);
    assert.equal(enqueueCalls.length, 0);
  });

  test('a queued run (indeterminate) is not answerable either', async () => {
    const run = await askingRun('run-k', { feedback: [], status: 'queued' });
    const q = await askQuestion({ run });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 409);
    assert.equal(out.body.reason, 'indeterminate');
  });
});

describe('exactly one resume per answer', () => {
  test('a fault after the decision, before the resume: a retry completes the resume once and keeps the first decision', async () => {
    const run = await askingRun('run-l', { feedback: blocked() });
    const q = await askQuestion({ run });
    enqueueResult = async () => { throw new Error('queue down'); };
    await assert.rejects(service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' }), /queue down/);
    assert.equal((await records.current(URL_KEY, q)).state, 'open', 'the question stays open while its resume is missing');
    enqueueResult = null;
    const retry = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.resumed, true);
    assert.equal(enqueueCalls.length, 2, 'one attempt failed, one resume was made');
    assert.equal((await dispatch.followUpPromptsOf(URL_KEY, run)).length, 1, 'exactly one follow-up row exists');
  });

  test('a fault after the resume, before the end: a retry does not resume again', async () => {
    const run = await askingRun('run-m', { feedback: blocked() });
    const q = await askQuestion({ run });
    const realEnd = writes.end;
    writes.end = async () => { throw new Error('store down'); };
    await assert.rejects(service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' }), /store down/);
    writes.end = realEnd;
    assert.equal(enqueueCalls.length, 1);
    const retry = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(enqueueCalls.length, 1, 'the marker on the follow-up row stops a second resume');
    assert.equal((await dispatch.followUpPromptsOf(URL_KEY, run)).length, 1);
    assert.equal((await records.current(URL_KEY, q)).state, 'answered');
  });

  test('a retry with a different answer than the decision already holds is refused 409, never mixed', async () => {
    const run = await askingRun('run-n', { feedback: blocked() });
    const q = await askQuestion({ run });
    const realEnd = writes.end;
    writes.end = async () => { throw new Error('store down'); };
    await assert.rejects(service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' }));
    writes.end = realEnd;
    const other = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'right', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(other.status, 409);
    assert.equal(other.body.code, 'decision-exists');
    assert.equal(enqueueCalls.length, 1);
  });

  test('two answers in flight at once give one 200 and one 409, and one follow-up', async () => {
    const run = await askingRun('run-o', { feedback: blocked() });
    const q = await askQuestion({ run });
    const [a, b] = await Promise.all([
      service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' }),
      service.answer({ urlKey: URL_KEY, questionId: q, option: 'right', by: PERSON, dispatchedBy: 'acct-owner' }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(enqueueCalls.length, 1);
  });

  test('an answer racing a dismissal gives one 409, and at most one follow-up', async () => {
    const run = await askingRun('run-p', { feedback: blocked() });
    const q = await askQuestion({ run });
    const [a, d] = await Promise.all([
      service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' }),
      service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' }),
    ]);
    assert.deepEqual([a.status, d.status].sort(), [200, 409]);
    assert.ok(enqueueCalls.length <= 1);
  });
});

describe('a settled question stays settled across the two actions (review finding af9e77b1)', () => {
  test('a dismissal whose resume was made and whose end failed: an answer is 409, writes no decision, and makes no second resume', async () => {
    const run = await askingRun('run-v1', { feedback: blocked() });
    const q = await askQuestion({ run });
    const realEnd = writes.end;
    writes.end = async () => { throw new Error('store down'); };
    await assert.rejects(service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' }), /store down/);
    writes.end = realEnd;
    assert.equal(enqueueCalls.length, 1, 'the dismissal resumed the run with its fallback');
    assert.equal((await records.current(URL_KEY, q)).state, 'open', 'the question is still open: its end was not made');

    const answer = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'right', words: 'go right', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(answer.status, 409, JSON.stringify(answer.body));
    assert.equal(answer.body.code, 'ruling-settled');
    assert.equal(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')), null, 'no decision was written');
    assert.equal(enqueueCalls.length, 1, 'no second resume: the run was never told the answer');

    const retry = await service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.resumed, true);
    assert.equal(enqueueCalls.length, 1, 'the dismissal retry completes the end and makes no second resume');
    assert.equal((await records.current(URL_KEY, q)).state, 'withdrawn');
  });

  test('an answer whose decision stands but whose resume failed: a dismissal is 409, writes nothing, and the answer retry completes', async () => {
    const run = await askingRun('run-v2', { feedback: blocked() });
    const q = await askQuestion({ run });
    enqueueResult = async () => { throw new Error('queue down'); };
    await assert.rejects(service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' }), /queue down/);
    enqueueResult = null;
    assert.ok(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')), 'the decision stands');

    const dismissed = await service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(dismissed.status, 409, JSON.stringify(dismissed.body));
    assert.equal(dismissed.body.code, 'ruling-settled');
    assert.equal(enqueueCalls.length, 1, 'the dismissal enqueued nothing');
    assert.equal((await records.current(URL_KEY, q)).state, 'open', 'the question is not withdrawn against its own decision');

    const retry = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.resumed, true);
    assert.equal(enqueueCalls.length, 2, 'the failed attempt and the one resume made by the retry');
    assert.equal((await records.current(URL_KEY, q)).state, 'answered');
  });
});

describe('the resume prompt', () => {
  test('holds the question, the option and the words verbatim, in that order, with markup and a long sentence', async () => {
    const run = await askingRun('run-q', { feedback: blocked() });
    const asks = 'Should the `flush()` path <b>retry</b> twice?';
    const words = '  Use **bold** and `code`, and keep <script>x</script> as typed.  A long sentence follows that keeps going so the limit is tested by its length, without a cut anywhere in it, ending here.  ';
    const q = await askQuestion({ run, asks, options: ['yes', 'no'] });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'yes', words, by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const prompt = enqueueCalls[0].prompt;
    assert.ok(prompt.includes(asks), 'the question verbatim');
    assert.ok(prompt.includes(`Option chosen:\nyes`), 'the option verbatim');
    assert.ok(prompt.includes(words), 'the words verbatim, untrimmed');
    const at = [prompt.indexOf(asks), prompt.indexOf('Option chosen:'), prompt.indexOf(words)];
    assert.deepEqual(at, [...at].sort((x, y) => x - y), 'question, option, then words');
  });

  test('a words-only answer omits the option section, and an option-only answer omits the words section', () => {
    const onlyWords = questionAnsweredPrompt({ questionId: 'q1', asks: 'A?', option: null, words: 'just words' });
    assert.doesNotMatch(onlyWords, /Option chosen/);
    assert.match(onlyWords, /The person's own words:\njust words/);
    const onlyOption = questionAnsweredPrompt({ questionId: 'q1', asks: 'A?', option: 'left', words: '   ' });
    assert.match(onlyOption, /Option chosen:\nleft/);
    assert.doesNotMatch(onlyOption, /own words/);
  });

  test('the marker is a whole line: resumesQuestion finds it in its own composer and not in a longer id', () => {
    const answered = questionAnsweredPrompt({ questionId: 'question-abc', asks: 'A?', option: 'x' });
    const dismissed = questionDismissedPrompt({ questionId: 'question-abc', asks: 'A?', ifUnanswered: 'go' });
    assert.equal(resumesQuestion(answered, 'question-abc', RESUME_ACTION.ANSWER), true);
    assert.equal(resumesQuestion(dismissed, 'question-abc', RESUME_ACTION.DISMISSAL), true);
    assert.equal(resumesQuestion(answered, 'question-ab', RESUME_ACTION.ANSWER), false);
    assert.equal(resumesQuestion('some unrelated prompt', 'question-abc', RESUME_ACTION.ANSWER), false);
  });

  test('the marker is per action (review finding af9e77b1): an answer marker is not a dismissal, and the reverse', () => {
    const answered = questionAnsweredPrompt({ questionId: 'question-abc', asks: 'A?', option: 'x' });
    const dismissed = questionDismissedPrompt({ questionId: 'question-abc', asks: 'A?', ifUnanswered: 'go' });
    assert.equal(resumesQuestion(answered, 'question-abc', RESUME_ACTION.DISMISSAL), false);
    assert.equal(resumesQuestion(dismissed, 'question-abc', RESUME_ACTION.ANSWER), false);
    assert.throws(() => resumesQuestion(answered, 'question-abc', 'either'), /unknown action/, 'an unknown action never matches by default');
  });

  test('a dismissal with no if-unanswered text still tells the run what to do', () => {
    const text = questionDismissedPrompt({ questionId: 'q9', asks: 'A?', ifUnanswered: null });
    assert.match(text, /Use your own judgement/);
  });
});

describe('the answer is refused before anything is written when it cannot be read', () => {
  test('an empty answer is 400', async () => {
    const run = await askingRun('run-r', { feedback: blocked() });
    const q = await askQuestion({ run });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: null, words: '   ', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 400);
    assert.equal(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')), null);
  });

  test('an option the question did not offer is 422, naming the options that work', async () => {
    const run = await askingRun('run-s', { feedback: blocked() });
    const q = await askQuestion({ run, options: ['left', 'right'] });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'up', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 422);
    assert.deepEqual(out.body.works, ['left', 'right']);
  });

  test('a record that is not a question is 422, and an unknown id is 404', async () => {
    const finding = await writes.add({ urlKey: URL_KEY, kind: 'finding', by: 'implementation', input: { says: 'x', how: 'y', to: 'project' } });
    const notQuestion = await service.answer({ urlKey: URL_KEY, questionId: finding.record.id, option: 'a', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(notQuestion.status, 422);
    const missing = await service.dismiss({ urlKey: URL_KEY, questionId: 'question-nope', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(missing.status, 404);
  });
});

describe('liveness lives in its own leaf', () => {
  test('the old module re-exports the leaf\'s values, not copies', () => {
    assert.equal(REAP_INACTIVITY_MS, LEAF_REAP);
    assert.equal(resolveDisposition, leafDisposition);
    assert.equal(REAP_INACTIVITY_MS, 7 * DAY);
  });

  test('runLoopFactsOf reads a taken row as running, a blocked row as waiting, and a stamped row as closed', () => {
    assert.equal(runLoopFactsOf({ status: 'taken', feedback: [] }).agentState, 'running');
    assert.equal(runLoopFactsOf({ status: 'queued', feedback: [] }).agentState, null);
    const blockedFacts = runLoopFactsOf({ status: 'taken', feedback: blocked() });
    assert.equal(blockedFacts.wakeMarker, 'blocked');
    assert.equal(leafDisposition(blockedFacts, { now: NOW }), 'resumable');
    assert.equal(leafDisposition(runLoopFactsOf({ status: 'done', bookkeeping: { at: new Date(NOW.getTime() - 8 * DAY), reason: 'operator' }, feedback: [] }), { now: NOW }), 'gone');
  });
});

describe('the lineage tail decides liveness and the follow-up target (review finding 76818702)', () => {
  test('a run resumed once and now mid-turn on its follow-up is 409 for a second question, and no second follow-up is made', async () => {
    const run = await askingRun('run-t1', { feedback: blocked() });
    enqueueResult = async (args) => {
      // The first resume is taken by the runner: the tail is now running.
      const itemId = await writeFollowUp({ runId: args.runId, followUpTo: args.followUpTo, prompt: args.prompt, status: 'taken', feedback: [] });
      return { status: 200, body: { queued: true, itemId } };
    };
    const q1 = await askQuestion({ run, asks: 'First?' });
    const first = await service.answer({ urlKey: URL_KEY, questionId: q1, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const q2 = await askQuestion({ run, asks: 'Second?' });
    const second = await service.answer({ urlKey: URL_KEY, questionId: q2, option: 'right', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.code, 'not-answerable');
    assert.equal(second.body.reason, 'mid-turn');
    assert.equal(enqueueCalls.length, 1, 'the second answer enqueued nothing into the live session');
    assert.equal(await records.current(URL_KEY, fixedIdOf('decision', q2, 'answer')), null, 'and wrote no decision');
    assert.equal((await records.current(URL_KEY, q2)).state, 'open');
  });

  test('a parked follow-up under an old head row is resumable, and its resume goes to that follow-up', async () => {
    const run = await askingRun('run-t2', { status: 'done', feedback: doneAt(new Date(NOW.getTime() - 8 * DAY)) });
    const parked = await writeFollowUp({ runId: run, prompt: 'an earlier turn', id: 'fu-parked', status: 'taken', feedback: blocked(), dispatchedAt: new Date(NOW.getTime() - DAY) });
    const q = await askQuestion({ run });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.resumed, true, 'the head row is eight days old, but the run is parked now');
    assert.equal(enqueueCalls.length, 1);
    assert.equal(enqueueCalls[0].followUpTo, parked, 'the resume follows up on the tail, not the run\'s own row');
    assert.equal(enqueueCalls[0].force, false, 'a parked tail is not forced');
  });

  test('a follow-up cancelled or expired never ran, so it is not the tail', async () => {
    const run = await askingRun('run-t3', { feedback: blocked() });
    await writeFollowUp({ runId: run, prompt: 'never ran', id: 'fu-cancelled', status: 'cancelled', feedback: [], dispatchedAt: new Date(NOW.getTime() + 1000) });
    const q = await askQuestion({ run });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(enqueueCalls[0].followUpTo, run, 'the run\'s own row is the tail');
  });

  test('a retry finds an earlier resume made on a follow-up of a follow-up, and makes no second one', async () => {
    const run = await askingRun('run-t4', { feedback: blocked() });
    const q = await askQuestion({ run });
    const realEnd = writes.end;
    writes.end = async () => { throw new Error('store down'); };
    await assert.rejects(service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' }), /store down/);
    writes.end = realEnd;
    assert.equal(enqueueCalls.length, 1);
    // The resume was made, then the runner's follow-up took it on: the marker sits on a row that follows up on the first follow-up.
    const made = enqueueCalls[0].prompt;
    // fu-0 is the first resume, now done. Its own prompt is replaced, so the marker sits only on the nested row below.
    await dispatch.collection.updateOne({ _id: 'fu-0' }, { $set: { prompt: 'the earlier note', status: 'done', feedback: [{ message: '[done] took the answer', timestamp: NOW.toISOString() }] } });
    await dispatch.collection.insertOne({ _id: 'fu-1', urlKey: URL_KEY, followUpTo: 'fu-0', rootItemId: run, prompt: made, feedback: [], status: 'taken', dispatchedAt: new Date(NOW.getTime() + 1000), target: 'cli', expiresAt: new Date('2099-01-01T00:00:00.000Z') });
    const retry = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.resumed, true);
    assert.equal(enqueueCalls.length, 1, 'the marker on the later row stops a second resume');
  });
});

describe('the owner gate is read before any write (review finding b6e34489)', () => {
  test('a non-owner answer to a resumable question is refused whole: no decision, the question stays open for the owner', async () => {
    const run = await askingRun('run-u1', { feedback: blocked() });
    const q = await askQuestion({ run });
    resumeRefusal = async () => ({ status: 422, body: { error: 'Only the workspace owner can run this', code: 'RUNNER_OWNER_ONLY', category: 'owner', retryable: false } });
    const refused = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', words: 'my words', by: PERSON, dispatchedBy: 'acct-other' });
    assert.equal(refused.status, 422);
    assert.equal(refused.body.code, 'RUNNER_OWNER_ONLY');
    assert.equal(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')), null, 'no decision was written');
    assert.equal((await records.current(URL_KEY, q)).state, 'open', 'the question is still open');
    assert.equal(enqueueCalls.length, 0);

    resumeRefusal = null;
    const owner = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'right', words: 'the owner\'s words', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(owner.status, 200, JSON.stringify(owner.body));
    const decision = await records.current(URL_KEY, fixedIdOf('decision', q, 'answer'));
    assert.equal(decision.fields.answer, 'right', 'the owner\'s own answer is the one recorded');
    assert.equal(decision.fields.words, 'the owner\'s words');
  });

  test('a non-owner dismissal of a resumable question is refused whole too', async () => {
    const run = await askingRun('run-u2', { feedback: blocked() });
    const q = await askQuestion({ run });
    resumeRefusal = async () => ({ status: 422, body: { error: 'Only the workspace owner can run this', code: 'RUNNER_OWNER_ONLY' } });
    const refused = await service.dismiss({ urlKey: URL_KEY, questionId: q, by: PERSON, dispatchedBy: 'acct-other' });
    assert.equal(refused.status, 422);
    assert.equal((await records.current(URL_KEY, q)).state, 'open');
  });

  test('a stopped run is not resumed, so the owner gate does not apply to its answer', async () => {
    const run = await askingRun('run-u3', { feedback: blocked() });
    await dispatch.collection.insertOne({ _id: 'abort-u3', urlKey: URL_KEY, abort: true, abortTo: run, feedback: [{ message: '[aborted] stopped', timestamp: NOW.toISOString() }], status: 'done', feedbackAt: NOW, expiresAt: new Date('2099-01-01T00:00:00.000Z') });
    const q = await askQuestion({ run });
    resumeRefusal = async () => ({ status: 422, body: { error: 'Only the workspace owner can run this', code: 'RUNNER_OWNER_ONLY' } });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-other' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.notResumedBecause, 'stopped');
  });
});

describe('LIN-4545: the answer sits on its question\'s task, whatever the run\'s state', () => {
  /** The task for LIN-9, as a ticket's task is made, and a question asked in it by `run`. */
  async function taskQuestion(run) {
    const task = (await records.ensureTask(URL_KEY, { identifier: 'LIN-9', asked: 'LIN-9 asked', closed: false, closedReason: null }, { by: 'harbour' })).id;
    return { task, q: await askQuestion({ run, inTask: task }) };
  }

  /** The brief's "4 What stands" part, as text. */
  const standsPart = (text) => text.split('## 4 What stands')[1].split('## 5 ')[0];

  test('resumable: the decision is in the question\'s task', async () => {
    const run = await askingRun('run-t1', { feedback: blocked() });
    const { task, q } = await taskQuestion(run);
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', words: 'and say why', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.resumed, true);
    assert.equal((await records.current(URL_KEY, out.body.decisionId)).in, task);
  });

  test('stopped: the decision is in the question\'s task, for the next stage to read', async () => {
    const run = await askingRun('run-t2', { feedback: blocked() });
    await dispatch.collection.insertOne({ _id: 'abort-t2', urlKey: URL_KEY, abort: true, abortTo: run, feedback: [{ message: '[aborted] stopped', timestamp: NOW.toISOString() }], status: 'done', feedbackAt: NOW, expiresAt: new Date('2099-01-01T00:00:00.000Z') });
    const { task, q } = await taskQuestion(run);
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'right', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.body.notResumedBecause, 'stopped');
    assert.equal((await records.current(URL_KEY, out.body.decisionId)).in, task);
  });

  test('gone: the ended run\'s answer is in its task, and the next run\'s brief on that task lists it under what stands', async () => {
    const run = await askingRun('run-t3', { status: 'done', feedback: doneAt(new Date(NOW.getTime() - 8 * DAY)) });
    const { task, q } = await taskQuestion(run);
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', words: 'Keep the old flag too.', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.body.notResumedBecause, 'no-session');
    const decision = await records.current(URL_KEY, out.body.decisionId);
    assert.equal(decision.in, task);
    // The next stage on the task: a fresh run, never resumed, so the brief is the only way the answer reaches it.
    await records.openRun(URL_KEY, { id: 'run-next', stage: 'review', taskId: task, lineage: 'run-next' });
    const brief = await composeRunBrief({ store: records, urlKey: URL_KEY, runId: 'run-next' });
    assert.ok(brief.text, JSON.stringify(brief));
    const stands = standsPart(brief.text);
    assert.match(stands, new RegExp(out.body.decisionId), `the answer is not under what stands:\n${brief.text}`);
    assert.match(stands, /Keep the old flag too\./);
  });

  test('a question with no task gives its decision none: nothing is guessed', async () => {
    const run = await askingRun('run-t4', { status: 'done', feedback: doneAt(new Date(NOW.getTime() - 8 * DAY)) });
    const q = await askQuestion({ run });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal((await records.current(URL_KEY, out.body.decisionId)).in, undefined);
  });

  test('a retry over a decision written before the fix (no task) is the same answer: it moves onto the task as v2, v1 kept', async () => {
    const run = await askingRun('run-t5', { status: 'done', feedback: doneAt(new Date(NOW.getTime() - 8 * DAY)) });
    const { task, q } = await taskQuestion(run);
    const decisionId = fixedIdOf('decision', q, 'answer');
    // The decision as the old route wrote it, before its question ended: no `in`.
    await writes.add({ urlKey: URL_KEY, kind: 'decision', input: { links: { answers: q }, answer: 'left' }, by: PERSON, run: null, fixedId: decisionId });
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const { snap, versions } = await records.read(URL_KEY, decisionId);
    assert.equal(snap.v, 2);
    assert.equal(snap.in, task);
    assert.equal(snap.reason, ANSWER_ON_TASK_REASON);
    assert.equal(snap.fields.answer, 'left');
    assert.equal(versions.find((x) => x.v === 1).in, undefined, 'v1 stays as it was written');
    assert.equal((await records.current(URL_KEY, q)).state, 'answered');
  });

  test('a retry over a decision the fixed route already put on the task adds no version: the has-task guard', async () => {
    const run = await askingRun('run-t6', { status: 'done', feedback: doneAt(new Date(NOW.getTime() - 8 * DAY)) });
    const { task, q } = await taskQuestion(run);
    const decisionId = fixedIdOf('decision', q, 'answer');
    // A partial failure of the fixed route: the decision was written `in` its task, the question not yet ended.
    await writes.add({ urlKey: URL_KEY, kind: 'decision', input: { in: task, links: { answers: q }, answer: 'left' }, by: PERSON, run: null, fixedId: decisionId });
    assert.equal((await records.current(URL_KEY, q)).state, 'open');
    const out = await service.answer({ urlKey: URL_KEY, questionId: q, option: 'left', by: PERSON, dispatchedBy: 'acct-owner' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const { snap } = await records.read(URL_KEY, decisionId);
    assert.equal(snap.v, 1, 'no redundant v2 on a decision already on its task');
    assert.equal(snap.in, task);
    assert.equal((await records.current(URL_KEY, q)).state, 'answered');
  });
});
