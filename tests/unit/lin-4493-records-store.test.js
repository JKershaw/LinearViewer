/**
 * LIN-4493 (piece 2): the records store on a real MangoDB engine (tests/fixtures/mango-tmpdir.js).
 *
 * Witnesses: versions are kept and the current one is the highest; a write of a version another writer
 * already made collides (RecordsVersionConflict); ending an ended record returns it unchanged; a ticket is
 * made into one task however many references race; a closed ticket is refused with its reason; a parent
 * ticket's task is made above a child's; a run opens, ends and reopens with every version kept; the query
 * log expires through cleanupQueryLog, with no TTL index.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import {
  RecordsStore,
  RecordsVersionConflict,
  RecordsNotFound,
  QUERY_LOG_RETENTION_MS,
  RECORDS_COLLECTION,
  REFS_COLLECTION,
  QUERY_LOG_COLLECTION,
  PLANNED_TASK
} from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';

const URL_KEY = 'records-test-workspace';
const T0 = '2026-11-19T10:00:00.000Z';
const at = (minute) => new Date(Date.UTC(2026, 10, 19, 10, minute)).toISOString();

const harness = createMangoTmpdir('lin-4493-records-');
let db;
let store;
let records;
let refs;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  records = db.collection(RECORDS_COLLECTION);
  refs = db.collection(REFS_COLLECTION);
  // The unique version key lib/db-indexes.js declares (boot tier); built here so the store runs against it.
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({
    records,
    refs: db.collection(REFS_COLLECTION),
    queryLog: db.collection(QUERY_LOG_COLLECTION),
    now: () => new Date(T0)
  });
});

const shape = (kind, fields = {}, extra = {}) => ({ kind, state: kind === 'plan' ? 'kept' : 'open', fields, links: {}, ...extra });

describe('records store: versions', () => {
  test('add writes version 1 with a store-generated id of its kind, starting in its start state', async () => {
    const r = await store.add(URL_KEY, shape('finding', { says: 'Footer count is off.' }, { to: 'review' }), { by: 'implementation', at: at(1) });
    assert.match(r.id, /^finding-[0-9a-f]{8}$/);
    assert.equal(r.v, 1);
    assert.equal(r.state, 'open');
    assert.equal(r.to, 'review');
    assert.equal(r.by, 'implementation');
  });

  test('revise keeps every version; the current one is the highest, and asOf reads an earlier one', async () => {
    const plan = await store.add(URL_KEY, shape('plan', { says: 'First.' }), { by: 'design', at: at(1) });
    await store.revise(URL_KEY, plan.id, { fields: { says: 'Second.' }, links: {} }, { by: 'design', at: at(2), reason: 'sharpened' });
    const now = await store.current(URL_KEY, plan.id);
    assert.equal(now.v, 2);
    assert.equal(now.fields.says, 'Second.');
    assert.equal(now.reason, 'sharpened');
    const before = await store.currentAt(URL_KEY, plan.id, at(1));
    assert.equal(before.v, 1);
    assert.equal(before.fields.says, 'First.');
    assert.equal((await store.snapshots(URL_KEY)).filter((s) => s.id === plan.id).length, 2);
  });

  test('a revise with null removes the field; asked is never changed here (the check refuses it first)', async () => {
    const r = await store.add(URL_KEY, shape('finding', { says: 'x', how: 'run it' }, { to: 'review' }), { by: 'review', at: at(1) });
    const next = await store.revise(URL_KEY, r.id, { fields: { how: null }, links: {} }, { by: 'review', at: at(2), reason: 'no how' });
    assert.equal('how' in next.fields, false);
    assert.equal(next.fields.says, 'x');
  });

  test('two writers of the same version: the second collides and is told so, not forked', async () => {
    const r = await store.add(URL_KEY, shape('lesson', { says: 'One.' }), { by: 'close-out', at: at(1) });
    const results = await Promise.allSettled([
      store.revise(URL_KEY, r.id, { fields: { says: 'A.' }, links: {} }, { by: 'close-out', at: at(2), reason: 'a' }),
      store.revise(URL_KEY, r.id, { fields: { says: 'B.' }, links: {} }, { by: 'close-out', at: at(3), reason: 'b' })
    ]);
    const conflicts = results.filter((x) => x.status === 'rejected');
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(conflicts.length, 1);
    assert.ok(conflicts[0].reason instanceof RecordsVersionConflict);
    assert.equal((await store.snapshots(URL_KEY)).filter((s) => s.id === r.id).length, 2);
  });

  test('a write to a record that does not exist is refused by name', async () => {
    await assert.rejects(() => store.revise(URL_KEY, 'finding-nope', { fields: {}, links: {} }, { by: 'x', reason: 'r' }), RecordsNotFound);
  });
});

describe('records store: ends and links', () => {
  test('ending a record writes its end with a reason; ending it again returns it unchanged', async () => {
    const f = await store.add(URL_KEY, shape('finding', { says: 'x' }, { to: 'close-out' }), { by: 'review', at: at(1) });
    const first = await store.end(URL_KEY, f.id, { state: 'done', reason: 'settled by the commit' }, { by: 'close-out', at: at(2) });
    assert.equal(first.changed, true);
    assert.equal(first.record.state, 'done');
    assert.deepEqual(first.record.ended, { reason: 'settled by the commit' });
    const again = await store.end(URL_KEY, f.id, { state: 'declined', reason: 'later' }, { by: 'close-out', at: at(3) });
    assert.equal(again.changed, false);
    assert.equal(again.record.v, 2);
    assert.equal(again.record.state, 'done');
  });

  test('a takeover end keeps the record it names', async () => {
    const f = await store.add(URL_KEY, shape('finding', { says: 'x' }, { to: 'project' }), { by: 'review', at: at(1) });
    const g = await store.add(URL_KEY, shape('finding', { says: 'y' }, { to: 'project' }), { by: 'review', at: at(2) });
    const { record } = await store.end(URL_KEY, f.id, { state: 'handed-on', reason: 'moved', into: g.id }, { by: 'person', at: at(3) });
    assert.equal(record.ended.into, g.id);
  });

  test('links: a list type adds, a single-id type replaces, and each is a new version', async () => {
    const c = await store.add(URL_KEY, shape('change', { ref: 'PR 9', head: 'abc' }), { by: 'implementation', at: at(1) });
    const f = await store.add(URL_KEY, shape('finding', { says: 'x' }, { to: 'review' }), { by: 'review', at: at(2) });
    await store.link(URL_KEY, f.id, { about: [c.id] }, { by: 'review', at: at(3) });
    const next = await store.link(URL_KEY, f.id, { about: [c.id, 'other'] }, { by: 'review', at: at(4) });
    assert.deepEqual(next.links.about, [c.id, 'other']);
    assert.equal(next.v, 3);
  });
});

describe('records store: tickets become tasks, once', () => {
  const ticket = (identifier, extra = {}) => ({ identifier, asked: `Words for ${identifier}.`, closed: false, ...extra });

  test('a ticket with no task gets one, with its words as asked and its ref', async () => {
    const r = await store.ensureTask(URL_KEY, ticket('LIN-4451'), { by: 'Harbour', at: at(1) });
    assert.match(r.id, /^task-/);
    const task = await store.current(URL_KEY, r.id);
    assert.equal(task.kind, 'task');
    assert.equal(task.state, 'open');
    assert.equal(task.fields.ref, 'LIN-4451');
    assert.equal(task.fields.asked, 'Words for LIN-4451.');
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-4451'), r.id);
  });

  test('concurrent references to one new ticket make one task', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => store.ensureTask(URL_KEY, ticket('LIN-7000'), { by: 'Harbour', at: at(1) })));
    const ids = new Set(results.map((r) => r.id));
    assert.equal(ids.size, 1);
    const tasks = (await store.snapshots(URL_KEY)).filter((s) => s.kind === 'task' && s.fields.ref === 'LIN-7000');
    assert.equal(tasks.length, 1);
  });

  test('a closed ticket is refused with the reason and no task is made', async () => {
    const r = await store.ensureTask(URL_KEY, ticket('LIN-8', { closed: true, closedReason: 'Done' }), { by: 'Harbour', at: at(1) });
    assert.match(r.problem, /LIN-8 is closed \(Done\)/);
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-8'), null);
  });

  test('a child ticket\'s task sits in its parent\'s task, made up the tree', async () => {
    const child = ticket('LIN-5', { parent: ticket('LIN-4') });
    const r = await store.ensureTask(URL_KEY, child, { by: 'Harbour', at: at(1) });
    const parentId = await store.taskForTicket(URL_KEY, 'LIN-4');
    assert.ok(parentId, 'the parent task was made');
    assert.equal((await store.current(URL_KEY, r.id)).in, parentId);
  });

  // LIN-4501 (John's ruling, 20 Nov): a closed parent no longer refuses the child. Its task is made first, ended as its
  // ticket ended, and the child's task is linked in it. The closed ticket a write names is still refused (above).
  test('a closed parent gets its task made and ended, and the child is linked in it', async () => {
    const child = ticket('LIN-11', { parent: ticket('LIN-10', { closed: true, closedReason: 'Canceled', closedEnd: 'declined' }) });
    const r = await store.ensureTask(URL_KEY, child, { by: 'Harbour', at: at(1) });
    assert.ok(r.id, `the child gets its task (${r.problem || ''})`);
    const parent = await store.current(URL_KEY, (await store.current(URL_KEY, r.id)).in);
    assert.equal(parent.fields.ref, 'LIN-10');
    assert.equal(parent.state, 'declined');
  });
});

describe('records store: run records', () => {
  test('a run opens with its id and lineage, ends on its terminal, and keeps its account', async () => {
    const run = await store.openRun(URL_KEY, { id: 'row-abc', stage: 'implementation', taskId: 'task-1', lineage: 'row-root', at: at(1) });
    assert.equal(run.kind, 'run');
    assert.equal(run.state, 'open');
    assert.equal(run.by, 'implementation');
    assert.equal(run.lineage, 'row-root');
    const ended = await store.endRun(URL_KEY, 'row-abc', { state: 'done', account: 'Built it.', at: at(2) });
    assert.equal(ended.state, 'done');
    assert.equal(ended.fields.account, 'Built it.');
    const again = await store.endRun(URL_KEY, 'row-abc', { state: 'failed', at: at(3) });
    assert.equal(again.state, 'done', 'an ended run is returned unchanged');
  });

  test('a resume taken into a finished run reopens it as a new version, and its terminal ends it again', async () => {
    await store.openRun(URL_KEY, { id: 'row-r', stage: 'implementation', lineage: 'row-r', at: at(1) });
    await store.endRun(URL_KEY, 'row-r', { state: 'done', at: at(2) });
    const reopened = await store.openRun(URL_KEY, { id: 'row-r', stage: 'implementation', lineage: 'row-r', at: at(3) });
    assert.equal(reopened.state, 'open');
    assert.equal(reopened.v, 3);
    assert.equal(reopened.op, 'reopen');
    await store.endRun(URL_KEY, 'row-r', { state: 'aborted', at: at(4) });
    const versions = (await store.snapshots(URL_KEY)).filter((s) => s.id === 'row-r').map((s) => s.state);
    assert.deepEqual(versions, ['open', 'done', 'open', 'aborted']);
  });

  test('opening an open run returns it; a run id nobody opened is absent', async () => {
    const a = await store.openRun(URL_KEY, { id: 'row-x', stage: 'review', lineage: 'row-x', at: at(1) });
    const b = await store.openRun(URL_KEY, { id: 'row-x', stage: 'review', lineage: 'row-x', at: at(2) });
    assert.equal(b.v, a.v);
    assert.equal(await store.run(URL_KEY, 'row-nobody'), null);
  });
});

describe('records store: query log', () => {
  test('a query is logged with who asked, and expires through cleanupQueryLog (no TTL index)', async () => {
    const log = db.collection(QUERY_LOG_COLLECTION);
    const now = new Date(T0);
    await store.logQuery(URL_KEY, { by: 'run:row-1', cmd: 'find', taskId: 'task-1' }, now);
    const row = await log.findOne({ urlKey: URL_KEY });
    assert.equal(row.by, 'run:row-1');
    assert.equal(row.expiresAt.getTime(), now.getTime() + QUERY_LOG_RETENTION_MS);
    assert.equal(await store.cleanupQueryLog(new Date(now.getTime() + 1000)), 0, 'within retention, nothing goes');
    assert.equal(await store.cleanupQueryLog(new Date(now.getTime() + QUERY_LOG_RETENTION_MS + 1)), 1, 'past retention, it goes');
  });

  test('the spec declares no TTL index for the log', () => {
    const logSpecs = INDEX_SPECS.filter((s) => s.collection === QUERY_LOG_COLLECTION);
    assert.ok(logSpecs.length > 0);
    for (const s of logSpecs) assert.equal(s.options.expireAfterSeconds, undefined);
  });
});

describe('records store: reads by the indexed fields reduce to the current version', () => {
  test('find matches a record on its current version only, and asOf reads the version that stood then', async () => {
    const made = await store.add(URL_KEY, shape('finding', { says: 'Open for now.' }, { to: 'review' }), { by: 'implementation', at: at(1) });
    const before = at(2);
    await store.end(URL_KEY, made.id, { state: 'done', reason: 'fixed' }, { by: 'review', at: at(3) });
    const openNow = await store.find(URL_KEY, { state: 'open' });
    assert.equal(openNow.some((r) => r.id === made.id), false, 'an old open version does not match a read of open records');
    const doneNow = await store.find(URL_KEY, { state: 'done' });
    assert.deepEqual(doneNow.map((r) => r.id), [made.id]);
    const openThen = await store.find(URL_KEY, { state: 'open', asOf: before });
    assert.deepEqual(openThen.map((r) => r.id), [made.id], 'as it stood at the earlier time it was open');
  });

  test('find by addressee and by task reads the indexed fields; the project backlog is the records with no task', async () => {
    const task = await store.ensureTask(URL_KEY, { identifier: 'LIN-7', asked: 'Ask.', closed: false }, { by: 'implementation', at: at(1) });
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'In the task.' }, links: {}, in: task.id, to: 'review' }, { by: 'implementation', at: at(2) });
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'Backlog.' }, links: {}, to: 'project' }, { by: 'implementation', at: at(3) });
    assert.equal((await store.find(URL_KEY, { inRef: task.id })).length, 1);
    assert.equal((await store.find(URL_KEY, { inRef: null, kind: 'finding' })).length, 1, 'the one with no task');
    assert.equal((await store.find(URL_KEY, { to: 'project' })).length, 1);
  });

  test('a dry-run ensureTask writes nothing: no claim and no task, and the planned id is answered', async () => {
    const info = { identifier: 'LIN-8', asked: 'Ask.', closed: false };
    const planned = await store.ensureTask(URL_KEY, info, { by: 'implementation', at: at(1), dryRun: true });
    assert.equal(planned.id, PLANNED_TASK);
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-8'), null);
    assert.equal(await refs.countDocuments({ urlKey: URL_KEY, ticket: 'LIN-8' }), 0);
    assert.equal(await records.countDocuments({ urlKey: URL_KEY, kind: 'task' }), 0);
    const made = await store.ensureTask(URL_KEY, info, { by: 'implementation', at: at(2) });
    assert.notEqual(made.id, PLANNED_TASK);
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-8'), made.id);
  });
});
