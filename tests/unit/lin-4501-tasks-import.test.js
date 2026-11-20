/**
 * LIN-4501: the branch-only pre-deploy tasks import (scripts/records/lin-4501-tasks-import.mjs), on a temporary store.
 * BRANCH-ONLY: deleted with the script, in the same PR, before merge.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { importTasks, tableOf, askedSourceOf } from '../../scripts/records/lin-4501-tasks-import.mjs';
import { askedOf } from '../../lib/asked-of.js';
import { sealAsAsked } from '../../lib/as-asked.js';

const URL_KEY = 'lin-4501-import';
const harness = createMangoTmpdir('lin-4501-import-');
let db;
let store;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
});

const OPEN = { type: 'started', name: 'In Progress' };
const DONE = { type: 'completed', name: 'Done' };
const ticketOf = (identifier, description, { state = OPEN, parent = null } = {}) => {
  const asked = askedOf(description);
  return { identifier, state, trashed: false, parent, asked, askedSource: askedSourceOf(description, asked), descriptionChars: description.length };
};

function planOf() {
  const tickets = {
    'LIN-1': ticketOf('LIN-1', 'Make the seam.\n\n## Implementation Plan\n\nThe plan.'),
    'LIN-2': ticketOf('LIN-2', `${sealAsAsked('The sealed words.')}\n\nBelow the block.`),
    'LIN-3': ticketOf('LIN-3', 'A follow-up under a closed epic.', { parent: 'LIN-4' }),
    'LIN-4': ticketOf('LIN-4', 'The epic.', { state: DONE }),
    'LIN-5': ticketOf('LIN-5', 'Already has its task.')
  };
  return { urlKey: URL_KEY, generatedAt: '2026-11-20T13:30:00.000Z', listed: 9, open: ['LIN-1', 'LIN-2', 'LIN-3', 'LIN-5'], tickets };
}

describe('the pre-deploy tasks import', () => {
  test('askedSourceOf names where the words came from', () => {
    assert.equal(askedSourceOf('Words.', 'Words.'), 'whole');
    assert.equal(askedSourceOf('Words.\n\n## Implementation Plan\n\nplan', 'Words.'), 'before-plan');
    assert.equal(askedSourceOf(sealAsAsked('W.'), 'W.'), 'sealed');
    assert.equal(askedSourceOf('', ''), 'empty');
  });

  test('a dry run plans every open ticket and writes nothing', async () => {
    await store.ensureTask(URL_KEY, { identifier: 'LIN-5', asked: 'Already has its task.', closed: false }, { by: 'review' });
    const before = await db.collection(RECORDS_COLLECTION).countDocuments({});
    const rows = await importTasks({ recordsStore: store, planned: planOf() });
    assert.deepEqual(rows.map((r) => [r.ticket, r.action]), [['LIN-1', 'make'], ['LIN-2', 'make'], ['LIN-3', 'make'], ['LIN-5', 'held']]);
    assert.equal(await db.collection(RECORDS_COLLECTION).countDocuments({}), before, 'a dry run writes no record');
    assert.equal(await db.collection(REFS_COLLECTION).countDocuments({}), 1, 'and claims no ticket');
    assert.match(tableOf(rows), /open tickets: 4; held: 1; to make: 3; refused: 0; asked cut before a plan: 1/);
  });

  test('--apply makes each task with askedOf\'s words; a closed parent\'s task is made and ended; a rerun makes nothing', async () => {
    const rows = await importTasks({ recordsStore: store, planned: planOf(), write: true });
    assert.deepEqual(rows.map((r) => r.action), ['made', 'made', 'made', 'made'], 'every open ticket gets its task (LIN-5 has none in this store)');
    const asked = await store.askedForTickets(URL_KEY, ['LIN-1', 'LIN-2', 'LIN-3', 'LIN-4', 'LIN-5']);
    assert.equal(asked.get('LIN-1'), 'Make the seam.', 'the words before the plan');
    assert.equal(asked.get('LIN-2'), 'The sealed words.', 'the sealed words');
    assert.equal(asked.get('LIN-3'), 'A follow-up under a closed epic.');
    const child = await store.current(URL_KEY, await store.taskForTicket(URL_KEY, 'LIN-3'));
    const epic = await store.current(URL_KEY, child.in);
    assert.equal(epic.fields.ref, 'LIN-4');
    assert.equal(epic.state, 'done', 'the closed epic\'s task is ended as its ticket ended');
    assert.equal(child.by, 'import');
    const again = await importTasks({ recordsStore: store, planned: planOf(), write: true });
    assert.deepEqual(again.map((r) => r.action), ['held', 'held', 'held', 'held']);
  });
});
