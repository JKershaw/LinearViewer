/**
 * LIN-4545 (LIN-4529 P2c): the one-off backfill that moves the answers already given onto their questions' tasks
 * (scripts/answers-onto-tasks-lin4545.mjs). Real records store on a MangoDB tmpdir, the checked records pipeline.
 *
 * Pinned:
 *   - a dry run writes nothing and names what it would repair;
 *   - execute revises every answering decision with no `in` to its question's task, as v2 with the reason, v1 kept;
 *   - a second run repairs 0 (idempotent), and an execute reports 0 remaining;
 *   - a decision whose question has no task is skipped and counted, never guessed; a decision already on a task, one that
 *     answers nothing, and a non-decision are left alone; every workspace is read, each on its own records.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { fixedIdOf } from '../../lib/records/refs.js';
import { ANSWER_ON_TASK_REASON } from '../../lib/question-answers.js';
import { runAnswersOntoTasks } from '../../scripts/answers-onto-tasks-lin4545.mjs';

const PERSON = 'person:acct-owner';
const harness = createMangoTmpdir('lin-4545-backfill-');
let records;
let writes;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  const db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => [] });
});

async function taskOf(urlKey, ticket) {
  return (await records.ensureTask(urlKey, { identifier: ticket, asked: `${ticket} asked`, closed: false, closedReason: null }, { by: 'harbour' })).id;
}

async function question(urlKey, inTask = null) {
  const out = await writes.add({ urlKey, kind: 'question', by: 'implementation', run: null, input: { ...(inTask ? { in: inTask } : {}), asks: 'Which way?', options: ['left', 'right'], recommended: 'left', 'if-unanswered': 'pick left', to: 'project' } });
  assert.ok(out.record, JSON.stringify(out.problems));
  return out.record.id;
}

/** A decision as the person route wrote it before LIN-4545: `answers` its question, and no `in`. */
async function oldAnswer(urlKey, questionId, fields = { words: 'No figure.' }) {
  const id = fixedIdOf('decision', questionId, 'answer');
  const out = await writes.add({ urlKey, kind: 'decision', input: { links: { answers: questionId }, ...fields }, by: PERSON, run: null, fixedId: id });
  assert.ok(out.record, JSON.stringify(out.problems));
  return id;
}

describe('the answers-onto-tasks backfill (LIN-4545)', () => {
  test('dry run writes nothing; execute moves each answer onto its question\'s task as v2; a second run repairs 0', async () => {
    const taskA = await taskOf('ws-a', 'LIN-1');
    const taskB = await taskOf('ws-b', 'LIN-2');
    const dA = await oldAnswer('ws-a', await question('ws-a', taskA));
    const dB = await oldAnswer('ws-b', await question('ws-b', taskB), { answer: 'right' });

    const dry = await runAnswersOntoTasks({ recordsStore: records, writes });
    assert.deepEqual(dry.wouldRepair.map((r) => [r.urlKey, r.id, r.taskId]), [['ws-a', dA, taskA], ['ws-b', dB, taskB]]);
    assert.equal(dry.repaired.length, 0);
    assert.equal((await records.current('ws-a', dA)).v, 1, 'a dry run writes nothing');
    assert.match(dry.report, /DRY RUN/);

    const run1 = await runAnswersOntoTasks({ recordsStore: records, writes, execute: true });
    assert.equal(run1.repaired.length, 2);
    assert.equal(run1.remaining, 0);
    assert.match(run1.report, /Repaired: 2/);
    for (const [urlKey, id, task] of [['ws-a', dA, taskA], ['ws-b', dB, taskB]]) {
      const { snap, versions } = await records.read(urlKey, id);
      assert.equal(snap.v, 2);
      assert.equal(snap.in, task);
      assert.equal(snap.reason, ANSWER_ON_TASK_REASON);
      assert.equal(snap.by, 'harbour');
      assert.equal(snap.state, 'stands');
      assert.equal(versions.find((x) => x.v === 1).in, undefined, 'v1 stays as it was written');
    }
    assert.equal((await records.current('ws-b', dB)).fields.answer, 'right', 'the answer itself is unchanged');

    const run2 = await runAnswersOntoTasks({ recordsStore: records, writes, execute: true });
    assert.equal(run2.repaired.length, 0, 'a second run repairs 0');
    assert.equal(run2.remaining, 0);
    assert.equal((await records.current('ws-a', dA)).v, 2);
  });

  test('a question with no task is skipped and counted; decisions already placed or answering nothing are left alone', async () => {
    const task = await taskOf('ws-a', 'LIN-1');
    const orphan = await oldAnswer('ws-a', await question('ws-a'));
    const placedQ = await question('ws-a', task);
    const placed = fixedIdOf('decision', placedQ, 'answer');
    await writes.add({ urlKey: 'ws-a', kind: 'decision', input: { in: task, links: { answers: placedQ }, answer: 'left' }, by: PERSON, run: null, fixedId: placed });
    const free = (await writes.add({ urlKey: 'ws-a', kind: 'decision', input: { words: 'A standing call, answering no question.' }, by: PERSON, run: null })).record.id;

    const out = await runAnswersOntoTasks({ recordsStore: records, writes, execute: true });
    assert.equal(out.repaired.length, 0);
    assert.deepEqual(out.skipped.map((r) => [r.id, r.why]), [[orphan, 'question-has-no-task']]);
    assert.equal(out.remaining, 0, 'a skipped decision is not "remaining": no run can place it');
    for (const id of [orphan, placed, free]) assert.equal((await records.current('ws-a', id)).v, 1, `${id} is untouched`);
  });

  test('an ended answering decision is placed too, and stays ended', async () => {
    const task = await taskOf('ws-a', 'LIN-1');
    const d = await oldAnswer('ws-a', await question('ws-a', task));
    await writes.end({ urlKey: 'ws-a', id: d, input: { state: 'withdrawn', reason: 'taken back' }, by: PERSON, run: null });
    const out = await runAnswersOntoTasks({ recordsStore: records, writes, execute: true });
    assert.equal(out.repaired.length, 1);
    const cur = await records.current('ws-a', d);
    assert.equal(cur.in, task);
    assert.ok(cur.ended, 'the end is kept');
  });
});
