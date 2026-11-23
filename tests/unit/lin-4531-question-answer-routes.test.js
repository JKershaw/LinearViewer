/**
 * LIN-4531 (LIN-4529 P2a, review finding 25a1028c): the question routes, through HTTP, over the real records store, the real
 * dispatch store and the real factory. Each answer or dismissal that resumes goes through lib/follow-up-dispatch.js enqueueFollowUp
 * (the owner gate, the credential finalize, createDispatchItem), so the follow-up row checked here is the one production writes.
 *
 * What is pinned, and what it fails without the change:
 *   - signed out is 403 and writes nothing (the session is the person; a body can't name one);
 *   - `by` is read from the session, never the body (the decision is filed under the owner's account);
 *   - an owner's answer to a parked run creates ONE follow-up row, following up on the run, carrying the question, option and words;
 *   - a stopped run's answer creates no row, says it was not resumed, and its decision is in the question's task (LIN-4545);
 *   - a non-owner's answer is refused 422 before anything is written;
 *   - the kickoff witness: a fresh autopilot kickoff starts its own run (`startsRunRow`), it asks a question under that run, and the
 *     answer resumes it with the question, option and words. Without the kickoff's run the question has no run and is never resumed.
 *
 * The routes are session routes (routes/task-records.js is the precedent): no STAGE_WRITE_OPS entry and no census row.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { fixedIdOf } from '../../lib/records/refs.js';
import { resumesQuestion, RESUME_ACTION } from '../../lib/prompts/question-resume.js';
import { createQuestionAnswerRoutes } from '../../routes/question-answers.js';

const URL_KEY = 'lin-4531-routes';
const WS_ID = 'ws-lin-4531';
const OWNER = 'acct-owner';
const DAY = 86400000;
const harness = createMangoTmpdir('lin-4531-routes-');
let db;
let records;
let dispatch;
let writes;
let server;
let base;
let session;

before(() => harness.connect());
after(() => harness.close());

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
});

beforeEach(async () => {
  db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  dispatch = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
  writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => [] });
  session = { accountId: OWNER, workspaces: [] };
  await listen();
});

async function listen() {
  const app = express();
  app.use(express.json());
  const router = createQuestionAnswerRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY, id: WS_ID }; req.session = session; next(); },
    recordsStore: records,
    dispatchQueueStore: dispatch,
    workspacePreferencesStore: null,
    proxyTokenStore: { async createToken() { return { token: 'minted' }; } },
    workspaceOwnerCheck: async ({ accountId }) => ({ status: accountId === OWNER ? 'owner' : 'not-owner' }),
  });
  app.use(router);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function post(path, body = {}) {
  const res = await fetch(`${base}/workspace/${URL_KEY}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const blocked = (t = new Date()) => [{ message: '[blocked] waiting on the person', timestamp: t.toISOString() }];

/** A stage run, as the dispatch factory files one, with its state set by the caller. */
async function askingRun(id, { feedback = [], status = 'taken' } = {}) {
  await dispatch.collection.insertOne({
    _id: id, urlKey: URL_KEY, prompt: 'work', kind: 'implementation', promptName: null, target: 'cli',
    issueIdentifier: 'LIN-9', dispatchedAt: new Date(Date.now() - DAY), dispatchedBy: OWNER, followUpTo: null,
    abort: false, cascade: false, sessionId: null, rootItemId: id, runRecordId: id, status, feedback,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  });
  return id;
}

async function askQuestion({ run, asks = 'Which way?', options = ['left', 'right'], inTask = null }) {
  const snap = await writes.add({ urlKey: URL_KEY, kind: 'question', by: 'implementation', run, input: { ...(inTask ? { in: inTask } : {}), asks, options, recommended: options[0], 'if-unanswered': 'pick left', to: 'project' } });
  assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
  return snap.record.id;
}

/** The follow-up rows of a run, queue and history, as the factory wrote them. */
async function followUpsOf(run) {
  const rows = [...await dispatch.collection.find({ urlKey: URL_KEY }).toArray(), ...await dispatch.historyCollection.find({ urlKey: URL_KEY }).toArray()];
  return rows.filter((r) => r.followUpTo === run);
}

describe('the answer and dismiss routes', () => {
  test('signed out is 403, and nothing is written', async () => {
    const run = await askingRun('run-r1', { feedback: blocked() });
    const q = await askQuestion({ run });
    session = {};
    const out = await post(`/questions/${q}/answer`, { option: 'left' });
    assert.equal(out.status, 403);
    assert.equal(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')), null);
    assert.equal((await followUpsOf(run)).length, 0);
  });

  test('an owner\'s answer to a parked run files the decision under the session account, and makes one follow-up carrying the words', async () => {
    const run = await askingRun('run-r2', { feedback: blocked() });
    const q = await askQuestion({ run });
    const out = await post(`/questions/${q}/answer`, { option: 'right', words: 'Go right, keep the logs.', by: 'person:someone-else' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.resumed, true);
    const decision = await records.current(URL_KEY, fixedIdOf('decision', q, 'answer'));
    assert.equal(decision.by, `person:${OWNER}`, 'the session is the person; the body names no one');
    assert.equal(decision.fields.answer, 'right');
    const follow = await followUpsOf(run);
    assert.equal(follow.length, 1, 'one follow-up');
    assert.equal(follow[0].followUpTo, run);
    assert.ok(resumesQuestion(follow[0].prompt, q, RESUME_ACTION.ANSWER));
    assert.ok(follow[0].prompt.includes('Option chosen:\nright'));
    assert.ok(follow[0].prompt.includes('Go right, keep the logs.'));
  });

  test('a stopped run\'s answer makes no follow-up, says it was not resumed, and sits on the question\'s task (LIN-4545)', async () => {
    const run = await askingRun('run-r3', { feedback: blocked() });
    await dispatch.collection.insertOne({ _id: 'abort-r3', urlKey: URL_KEY, abort: true, abortTo: run, feedback: [{ message: '[aborted] stopped', timestamp: new Date().toISOString() }], status: 'done', feedbackAt: new Date(), expiresAt: new Date('2099-01-01T00:00:00.000Z') });
    const task = (await records.ensureTask(URL_KEY, { identifier: 'LIN-9', asked: 'LIN-9 asked', closed: false, closedReason: null }, { by: 'harbour' })).id;
    const q = await askQuestion({ run, inTask: task });
    const out = await post(`/questions/${q}/answer`, { option: 'left' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.notResumedBecause, 'stopped');
    assert.equal((await followUpsOf(run)).length, 0);
    assert.equal((await records.current(URL_KEY, fixedIdOf('decision', q, 'answer'))).in, task, 'the next stage reads it on the task');
  });

  test('a non-owner\'s answer is refused 422 before anything is written, and the question stays open for the owner', async () => {
    const run = await askingRun('run-r4', { feedback: blocked() });
    const q = await askQuestion({ run });
    session = { accountId: 'acct-member', workspaces: [] };
    const out = await post(`/questions/${q}/answer`, { option: 'left' });
    assert.equal(out.status, 422);
    assert.equal(out.body.code, 'RUNNER_OWNER_ONLY');
    assert.equal(await records.current(URL_KEY, fixedIdOf('decision', q, 'answer')), null);
    assert.equal((await records.current(URL_KEY, q)).state, 'open');
    assert.equal((await followUpsOf(run)).length, 0);
  });

  test('a dismissal makes one follow-up that says the question was dismissed, and withdraws it', async () => {
    const run = await askingRun('run-r5', { feedback: blocked() });
    const q = await askQuestion({ run });
    const out = await post(`/questions/${q}/dismiss`, {});
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.resumed, true);
    const follow = await followUpsOf(run);
    assert.equal(follow.length, 1);
    assert.match(follow[0].prompt, /^Dismissal of question /m);
    assert.equal((await records.current(URL_KEY, q)).state, 'withdrawn');
  });
});

describe('the kickoff witness: a fresh autopilot kickoff asks, is answered, and resumes with all three', () => {
  test('the kickoff starts its own run, its question is filed under it, and the answer resumes that run with question, option and words', async () => {
    // A fresh kickoff row, through the real factory: it starts a run, so its run is its own id.
    const kickoff = await createDispatchItem({
      store: dispatch,
      urlKey: URL_KEY,
      kind: 'autopilot',
      prompt: 'Coordinate the epic.',
      applyDefaultHarness: false,
      fields: { promptName: 'autopilot', issueIdentifier: 'LIN-9', target: 'cli' },
      finalizePrompt: async () => ({ prompt: 'Coordinate the epic.' }),
    });
    assert.equal(kickoff.runRecordId, kickoff._id, 'a fresh kickoff is a run');
    const stored = await dispatch.collection.findOne({ _id: kickoff._id });
    assert.equal(stored.runRecordId, kickoff._id);

    // The coordinator is running, then parks on a question filed under its run.
    await dispatch.collection.updateOne({ _id: kickoff._id }, { $set: { status: 'taken', feedback: blocked() } });
    const q = await askQuestion({ run: kickoff._id, asks: 'Split the epic now?', options: ['split', 'keep'] });

    const out = await post(`/questions/${q}/answer`, { option: 'keep', words: 'Keep it whole; the parts share one schema.' });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.resumed, true, 'the kickoff run is resumed');
    const follow = await followUpsOf(kickoff._id);
    assert.equal(follow.length, 1, 'one follow-up, to the kickoff run');
    assert.equal(follow[0].followUpTo, kickoff._id);
    assert.ok(resumesQuestion(follow[0].prompt, q, RESUME_ACTION.ANSWER), 'the resume carries the question');
    assert.ok(follow[0].prompt.includes('Split the epic now?'));
    assert.ok(follow[0].prompt.includes('Option chosen:\nkeep'));
    assert.ok(follow[0].prompt.includes('Keep it whole; the parts share one schema.'));
  });

  test('a kickoff\'s follow-up starts no run of its own: it belongs to the run it resumes', async () => {
    const kickoff = await createDispatchItem({
      store: dispatch, urlKey: URL_KEY, kind: 'autopilot', prompt: 'Coordinate.', applyDefaultHarness: false,
      fields: { promptName: 'autopilot', issueIdentifier: 'LIN-9', target: 'cli' }, finalizePrompt: async () => ({ prompt: 'Coordinate.' }),
    });
    await dispatch.collection.updateOne({ _id: kickoff._id }, { $set: { status: 'taken', feedback: blocked() } });
    const q = await askQuestion({ run: kickoff._id });
    assert.equal((await post(`/questions/${q}/answer`, { words: 'carry on' })).status, 200);
    const [follow] = await followUpsOf(kickoff._id);
    assert.equal(follow.runRecordId, kickoff._id, 'the follow-up is filed under the kickoff\'s run');
  });
});
