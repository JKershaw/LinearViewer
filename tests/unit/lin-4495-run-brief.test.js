/**
 * LIN-4495 (piece 4): a run's records brief (lib/records/run-brief.js composeRunBrief), on a real store. Since LIN-4536 it
 * is the whole of `GET /api/proxy/brief/:id` for the run's own credential, with no `?run=`. The findings a stage is addressed by are in its brief in full; an ended finding is gone from the next read
 * at once (no cache is involved); a run with no task, or an unknown run, says so instead of guessing.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4495-run-brief.test.js
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { composeRunBrief } from '../../lib/records/run-brief.js';

const URL_KEY = 'run-brief-workspace';
const T0 = '2026-11-19T10:00:00.000Z';
const at = (minute) => new Date(Date.UTC(2026, 10, 19, 10, minute)).toISOString();
const TICKET = { identifier: 'LIN-9101', title: 'A task', closed: false };

const harness = createMangoTmpdir('lin-4495-run-brief-');
let db;
let store;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({
    records: db.collection(RECORDS_COLLECTION),
    refs: db.collection(REFS_COLLECTION),
    queryLog: db.collection(QUERY_LOG_COLLECTION),
    now: () => new Date(T0),
  });
});

describe('the run brief: the records parts for one run', () => {
  test('a finding to close-out on the task is in the brief in full; ending it removes it from the next read', async () => {
    const task = await store.ensureTask(URL_KEY, TICKET, { by: 'Harbour', at: at(1) });
    const run = await store.openRun(URL_KEY, { id: 'run-close-1', stage: 'close-out', taskId: task.id, lineage: task.id, at: at(2) });
    assert.ok(run, 'the run is open');
    const finding = await store.add(URL_KEY, {
      kind: 'finding', state: 'open', fields: { says: 'The footer count is off by one.', how: 'open the session page and count the rows' }, links: {}, in: task.id, to: 'close-out',
    }, { by: 'review', run: null, at: at(3) });

    const before = await composeRunBrief({ store, urlKey: URL_KEY, runId: 'run-close-1', asker: 'run:run-close-1' });
    assert.equal(before.problem, undefined, JSON.stringify(before));
    assert.match(before.text, new RegExp(finding.id), 'the finding is in the brief');
    assert.match(before.text, /The footer count is off by one\./, 'in full, with its words');
    assert.ok(before.carries.includes(finding.id));

    await store.end(URL_KEY, finding.id, { state: 'done', reason: 'fixed' }, { by: 'close-out', at: at(9) });
    const after = await composeRunBrief({ store, urlKey: URL_KEY, runId: 'run-close-1' });
    assert.doesNotMatch(after.text, new RegExp(finding.id), 'an ended finding is gone at once');
  });

  test('a finding to project is in the brief\'s project count, not its addressed part', async () => {
    const task = await store.ensureTask(URL_KEY, TICKET, { by: 'Harbour', at: at(1) });
    await store.openRun(URL_KEY, { id: 'run-close-2', stage: 'close-out', taskId: task.id, lineage: task.id, at: at(2) });
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'A backlog item.' }, links: {}, in: task.id, to: 'project' }, { by: 'review', run: null, at: at(3) });
    const r = await composeRunBrief({ store, urlKey: URL_KEY, runId: 'run-close-2' });
    assert.match(r.text, /1 open addressed to project/);
  });

  test('a run that names no task, or is not on record, says so (never a guessed brief)', async () => {
    const none = await composeRunBrief({ store, urlKey: URL_KEY, runId: 'run-missing' });
    assert.match(none.problem, /is not on record/);
  });

  test('the query is logged with who asked (decision 8)', async () => {
    const task = await store.ensureTask(URL_KEY, TICKET, { by: 'Harbour', at: at(1) });
    await store.openRun(URL_KEY, { id: 'run-close-3', stage: 'close-out', taskId: task.id, lineage: task.id, at: at(2) });
    await composeRunBrief({ store, urlKey: URL_KEY, runId: 'run-close-3', asker: 'run:run-close-3' });
    const logged = await db.collection(QUERY_LOG_COLLECTION).find({ urlKey: URL_KEY, cmd: 'brief' }).toArray();
    assert.equal(logged.length, 1);
    assert.equal(logged[0].by, 'run:run-close-3');
    assert.equal(logged[0].taskId, task.id);
  });
});
