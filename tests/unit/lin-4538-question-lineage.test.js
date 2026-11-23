/**
 * LIN-4538 (LIN-4529 P7a), finding-e035f93b: a question's standing is keyed by the asking run's LINEAGE, not its run id.
 *
 * A leftover, or a stage dispatched as a follow-up, is its own run inside the stage's lineage (lib/run-identity.js
 * runRecordIdFor), while its loop is grouped under the stage's root row (`lineageId`). Keyed by run id, an answered
 * leftover's question missed its loop: the observer sweep kept the row `blocked`, and Home never marked the loop waiting
 * while its question was open. These witnesses use the real records store (run records carry the lineage) and the
 * readers' own functions.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { questionFacts } from '../../lib/records/question-facts.js';
import { questionStandingOf, QUESTION_WAITING, QUESTION_SETTLED } from '../../lib/records/question-standing.js';
import { rulingStandingFromQuestions, readRulingStanding } from '../../lib/ruling-standing.js';
import { classifyLoop } from '../../lib/observer-sweep.js';

const URL_KEY = 'lin-4538-lineage-workspace';
const OWNER = 'person:acct-owner';
const STAGE_ROOT = 'row-stage';
const LEFTOVER_RUN = 'row-leftover';
const harness = createMangoTmpdir('lin-4538-lineage-');
let records;
let writes;
let taskCounter = 0;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  const db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => [{ accountId: 'acct-owner', name: 'Owner' }] });
});

/** A leftover run (its own run id) inside the stage's lineage, and a question it asks. */
async function leftoverAsks({ ticket = 'LIN-70' } = {}) {
  taskCounter += 1;
  const made = await records.ensureTask(URL_KEY, { identifier: ticket, title: ticket }, { by: 'implementation' });
  assert.ok(made.id, `task refused: ${JSON.stringify(made)}`);
  await records.openRun(URL_KEY, { id: LEFTOVER_RUN, stage: 'implementation', taskId: made.id, lineage: STAGE_ROOT });
  const asked = await writes.add({
    urlKey: URL_KEY, kind: 'question', by: 'implementation', run: LEFTOVER_RUN,
    input: { asks: `Which way? ${taskCounter}`, options: ['left', 'right'], recommended: 'left', 'if-unanswered': 'pick left', to: OWNER, in: ticket },
  });
  assert.ok(asked.record, `question refused: ${JSON.stringify(asked.problems)}`);
  return asked.record.id;
}

const blockedLoop = { loopId: STAGE_ROOT, lineageId: STAGE_ROOT, issueIdentifier: 'LIN-70', source: 'history', agentState: 'waiting' };

describe('a leftover run\'s question stands on the stage lineage it is grouped under', () => {
  test('the fact carries the run record\'s lineage, and the run id when no run record names one', async () => {
    const id = await leftoverAsks();
    const rows = await questionFacts(records, URL_KEY);
    const row = rows.find((r) => r.questionId === id);
    assert.equal(row.runId, LEFTOVER_RUN);
    assert.equal(row.lineage, STAGE_ROOT);

    const orphan = await writes.add({
      urlKey: URL_KEY, kind: 'question', by: 'implementation', run: 'run-without-record',
      input: { asks: 'Orphan?', options: ['a', 'b'], recommended: 'a', 'if-unanswered': 'a', to: OWNER, in: 'LIN-70' },
    });
    const orphanRow = (await questionFacts(records, URL_KEY)).find((r) => r.questionId === orphan.record.id);
    assert.equal(orphanRow.lineage, 'run-without-record');
  });

  test('answered: the sweep discharges the stage row; open: the loop is waiting', async () => {
    const id = await leftoverAsks();

    const open = await questionStandingOf(records, URL_KEY);
    assert.equal(open.get(STAGE_ROOT), QUESTION_WAITING);
    const waiting = await readRulingStanding({ urlKey: URL_KEY, loops: [blockedLoop], recordsStore: records });
    assert.ok(waiting.openLoopIds.has(STAGE_ROOT), 'the stage loop is waiting while its leftover\'s question is open');
    assert.equal(waiting.rows.length, 1);

    await records.end(URL_KEY, id, { state: 'withdrawn', reason: 'dismissed' }, { by: OWNER });
    const settled = await questionStandingOf(records, URL_KEY);
    assert.equal(settled.get(STAGE_ROOT), QUESTION_SETTLED);
    const lane = classifyLoop(blockedLoop, { superseded: new Set(), now: Date.now(), staleMs: 60_000, questionStanding: settled });
    assert.equal(lane, 'resolved', 'an answered leftover question no longer keeps the stage row blocked');
    const stillBlocked = classifyLoop(blockedLoop, { superseded: new Set(), now: Date.now(), staleMs: 60_000, questionStanding: open });
    assert.equal(stillBlocked, 'blocked');
  });

  test('pure: a fact with a lineage is read by it, and one without falls back to its run id', () => {
    const facts = [{ runId: LEFTOVER_RUN, lineage: STAGE_ROOT, state: 'open' }, { runId: 'plain', state: 'open' }];
    const { openLoopIds } = rulingStandingFromQuestions({
      loops: [{ loopId: 'a', lineageId: STAGE_ROOT }, { loopId: 'plain' }, { loopId: 'other', lineageId: LEFTOVER_RUN }],
      facts: facts.map((f) => ({ ...f, questionId: 'q', to: OWNER, ticket: 'LIN-70', raisedAt: null })),
    });
    assert.deepEqual([...openLoopIds].sort(), ['a', 'plain']);
  });
});
