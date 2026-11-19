/**
 * LIN-4493 (piece 2): the records routes over HTTP, in process. The router (routes/proxy-records.js) is mounted on
 * an Express app behind a stand-in credential middleware that sets the same request fields authenticateProxyToken
 * sets (proxyOrigin, proxyRunRecordId, proxyCreatedBy, proxyWrites, proxyTokenScope). The stage write gate
 * (lib/stage-write-gate.js) is the real one, and the store is the real store on a MangoDB engine.
 *
 * Witnesses (the piece's own list): a stage credential writes, reads and ends through the proxy, filed by its run;
 * a flat body with a named person, a stage, a ticket id and a missing `to` each behave as the API review expects;
 * a `to` Harbour cannot brief is refused naming the names that work; `by` is never read from a body; every stamp
 * may write a finding; a run that ended refuses writes until it is reopened (decision 2c); a run in another
 * lineage is refused; a leftover run in the same lineage writes as `leftover`; a blind read may not read records;
 * a closed ticket is refused; a not-yet-dispatched sibling's task is made; ending an ended record returns it
 * unchanged; the query log records who asked.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createProxyRecordsRoutes } from '../../routes/proxy-records.js';
import { requireWriteScope } from '../../lib/stage-write-gate.js';
import { READ_WRITE } from '../../lib/proxy-scopes.js';
import { askedText } from '../../lib/as-asked.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { createRunRecords } from '../../lib/run-records.js';

const URL_KEY = 'routes-test-workspace';
const harness = createMangoTmpdir('lin-4493-routes-');
let db;
let store;
let server;
let base;
let tokens;
let tickets;
let people;
let calls;

before(() => harness.connect());
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  server = null;
});
after(() => harness.close());

/** The stand-in for authenticateProxyToken: it sets the fields the real one sets, from `tokens[name]`. */
function credential(req, res, next) {
  const name = req.get('x-test-token');
  const t = tokens[name];
  if (!t) return res.status(401).json({ error: 'Invalid, expired, or consumed token' });
  req.proxyUrlKey = URL_KEY;
  req.proxyOrigin = t.origin === undefined ? null : t.origin;
  req.proxyRunRecordId = t.runRecordId ?? null;
  req.proxyCreatedBy = t.createdBy ?? null;
  req.proxyWrites = t.writes ?? null;
  req.proxyTokenScope = t.scope ?? READ_WRITE;
  next();
}

beforeEach(async () => {
  db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  tickets = new Map([
    ['LIN-4451', { identifier: 'LIN-4451', title: 'Footer', description: 'Make the footer show runs left.\n\n## As asked\n\nThe person\'s words.\n\n*End of what was asked. Steps write below this line; nothing above it changes.*\n\n## Steps\nbelow', state: { name: 'In Progress', type: 'started' }, parent: null }],
    ['LIN-4452', { identifier: 'LIN-4452', title: 'Sibling', description: 'Not yet dispatched.', state: { name: 'Todo', type: 'unstarted' }, parent: { identifier: 'LIN-4450' } }],
    ['LIN-4450', { identifier: 'LIN-4450', title: 'Parent', description: 'Parent words.', state: { name: 'In Progress', type: 'started' }, parent: null }],
    ['LIN-9', { identifier: 'LIN-9', title: 'Old', description: 'Old.', state: { name: 'Done', type: 'completed' }, parent: null }]
  ]);
  people = [{ accountId: 'acc-john', name: 'John' }];
  calls = { ticketReads: [] };
  const routes = createProxyRecordsRoutes({
    recordsStore: store,
    proxyLimiter: (req, res, next) => next(),
    authenticateProxyToken: credential,
    requireWriteScope,
    logEvent: () => {},
    readTicket: async (_req, ref) => { calls.ticketReads.push(ref); return tickets.get(ref) ?? null; },
    askedText,
    stageKinds: Object.keys(STAGE_KINDS),
    listPeople: async () => people
  });
  const app = express();
  app.use(express.json());
  app.use(routes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  tokens = {
    john: { origin: 'person', createdBy: 'acc-john', writes: null },
    impl: { origin: 'dispatch', runRecordId: 'row-impl', writes: 'implementation' },
    left: { origin: 'dispatch', runRecordId: 'row-left', writes: 'implementation' },
    other: { origin: 'dispatch', runRecordId: 'row-other', writes: 'implementation' },
    blind: { origin: 'dispatch', runRecordId: 'row-blind', writes: 'blind-comment' },
    legacy: { origin: undefined, writes: null },
    dispatchNoRun: { origin: 'dispatch', runRecordId: null, writes: 'implementation' }
  };
  // Three dispatch rows are taken: an implementation run and its leftover in one lineage, and a run elsewhere.
  await store.openRun(URL_KEY, { id: 'row-impl', stage: 'implementation', lineage: 'row-root', at: '2026-11-19T10:00:00.000Z' });
  await store.openRun(URL_KEY, { id: 'row-left', stage: 'leftover', lineage: 'row-root', at: '2026-11-19T10:00:01.000Z' });
  await store.openRun(URL_KEY, { id: 'row-other', stage: 'review', lineage: 'row-elsewhere', at: '2026-11-19T10:00:02.000Z' });
  await store.openRun(URL_KEY, { id: 'row-blind', stage: 'blind-read', lineage: 'row-blind', at: '2026-11-19T10:00:03.000Z' });
});

async function call(method, path, token, body) {
  const headers = { 'x-test-token': token };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const post = (path, token, body) => call('POST', path, token, body);
const get = (path, token) => call('GET', path, token);

describe('a stage credential writes, reads and ends through the proxy, filed by its run', () => {
  test('a finding names its run and is filed as the run\'s stage, not as a person', async () => {
    const r = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'Footer count is off by one.', how: 'run the footer test', run: 'row-impl' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.by, 'implementation');
    assert.equal(r.body.run, 'row-impl');
    assert.equal(r.body.state, 'open');
    assert.equal(r.body.to, 'review');
  });

  test('a write that names no run is refused, naming what to send; the body cannot set by', async () => {
    const r = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'x' });
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, 'run-not-named');
    const byBody = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'x', run: 'row-impl', by: 'John' });
    assert.equal(byBody.status, 422);
    assert.ok(byBody.body.problems.some((p) => p.field === 'by'), JSON.stringify(byBody.body));
  });

  test('a dispatch credential with no run is refused, and never filed as a person', async () => {
    const r = await post('/api/proxy/records', 'dispatchNoRun', { kind: 'finding', to: 'review', says: 'x', run: 'row-impl' });
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, 'no-run');
  });

  test('a legacy credential with no origin predates run identity', async () => {
    const r = await post('/api/proxy/records', 'legacy', { kind: 'finding', to: 'review', says: 'x' });
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, 'predates-run-identity');
  });

  test('a leftover run in the same lineage writes as leftover', async () => {
    const r = await post('/api/proxy/records', 'left', { kind: 'finding', to: 'project', says: 'Found after the build.', run: 'row-left' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.by, 'leftover');
  });

  test('a run in another lineage is refused, and so is a run that was never taken', async () => {
    const other = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'x', run: 'row-other' });
    assert.equal(other.status, 403);
    assert.equal(other.body.reason, 'other-lineage');
    const missing = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'x', run: 'row-nobody' });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.reason, 'run-not-found');
  });

  test('a credential that carries a run cannot write as another run it does not hold (token run must match)', async () => {
    tokens.spoof = { origin: 'dispatch', runRecordId: 'row-nobody', writes: 'implementation' };
    const r = await post('/api/proxy/records', 'spoof', { kind: 'finding', to: 'review', says: 'x', run: 'row-impl' });
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, 'token-run-unknown');
  });

  test('a stage credential reads its record back, revises it, links it and ends it', async () => {
    const made = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'First.', how: 'check it', run: 'row-impl' });
    const id = made.body.id;
    const rev = await post(`/api/proxy/records/${id}/revise`, 'impl', { says: 'Second.', reason: 'sharpened', run: 'row-impl' });
    assert.equal(rev.status, 200, JSON.stringify(rev.body));
    assert.equal(rev.body.v, 2);
    const change = await post('/api/proxy/records', 'impl', { kind: 'change', ref: 'PR 9', head: 'abc', run: 'row-impl' });
    const linked = await post(`/api/proxy/records/${id}/link`, 'impl', { about: change.body.id, run: 'row-impl' });
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    assert.deepEqual(linked.body.links.about, [change.body.id]);
    const ended = await post(`/api/proxy/records/${id}/end`, 'impl', { state: 'done', reason: 'the check passed', run: 'row-impl' });
    assert.equal(ended.status, 200);
    assert.equal(ended.body.state, 'done');
    assert.equal(ended.body.changed, true);
    const again = await post(`/api/proxy/records/${id}/end`, 'impl', { state: 'declined', reason: 'later', run: 'row-impl' });
    assert.equal(again.status, 200);
    assert.equal(again.body.changed, false, 'an ended record returns unchanged');
    assert.equal(again.body.state, 'done');
    const read = await get(`/api/proxy/records/${id}`, 'impl');
    assert.equal(read.status, 200);
    assert.equal(read.body.versions.length, 4);
  });

  test('every stamp may write a finding (recordWrite is allowed to every stamp)', async () => {
    for (const writes of [null, 'work', 'none', 'one-comment', 'blind-comment', 'ticket-fields']) {
      tokens.stamp = { origin: 'dispatch', runRecordId: 'row-impl', writes };
      const r = await post('/api/proxy/records', 'stamp', { kind: 'finding', to: 'review', says: `from ${writes}`, run: 'row-impl' });
      assert.equal(r.status, 201, `${writes}: ${JSON.stringify(r.body)}`);
    }
  });
});

describe('the API review\'s call shape', () => {
  test('a named person resolves to person:<accountId>', async () => {
    const r = await post('/api/proxy/records', 'john', { kind: 'question', to: 'John', asks: 'Which footer?', options: ['a', 'b'], recommended: 'a' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.to, 'person:acc-john');
  });

  test('a to Harbour cannot brief is refused, and names the names that work', async () => {
    const r = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'nobody', says: 'x', run: 'row-impl' });
    assert.equal(r.status, 422);
    const p = r.body.problems.find((x) => x.field === 'to');
    assert.match(p.message, /'nobody' is not a reader Harbour can brief/);
    assert.ok(p.works.includes('review') && p.works.includes('John') && p.works.includes('project'), JSON.stringify(p.works));
  });

  test('a hand-off with no to is refused, naming the readers that would work', async () => {
    const r = await post('/api/proxy/records', 'impl', { kind: 'finding', says: 'x', run: 'row-impl' });
    assert.equal(r.status, 422);
    assert.equal(r.body.problems[0].field, 'to');
    assert.ok(r.body.problems[0].works.includes('leftover'));
  });

  test('one 422 names every problem at once', async () => {
    const r = await post('/api/proxy/records', 'impl', { kind: 'finding', says: 1, asks: 'x', to: 'nobody', run: 'row-impl' });
    assert.equal(r.status, 422);
    assert.ok(r.body.problems.length >= 3, JSON.stringify(r.body.problems));
  });

  test('a bare id in on is pinned to the current version of the change', async () => {
    const c = await post('/api/proxy/records', 'impl', { kind: 'change', ref: 'PR 9', head: 'abc', run: 'row-impl' });
    const v = await post('/api/proxy/records', 'impl', { kind: 'verdict', judgement: 'review', outcome: 'approve', reasoning: 'fine', on: c.body.id, run: 'row-impl' });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    assert.deepEqual(v.body.links.on, [`${c.body.id}@1`]);
  });

  test('a ticket id names its task: made from the tracker with its words, and a sibling not yet dispatched lands', async () => {
    const r = await post('/api/proxy/records', 'impl', { kind: 'finding', in: 'LIN-4451', to: 'review', says: 'About the ticket.', run: 'row-impl' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const task = await store.taskForTicket(URL_KEY, 'LIN-4451');
    assert.equal(r.body.in, task);
    const taskRec = await store.current(URL_KEY, task);
    assert.equal(taskRec.fields.asked, 'The person\'s words.', 'the ticket\'s asked, from its description (as-asked block)');
    const sib = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'LIN-4452', says: 'Hand-off to a sibling.', run: 'row-impl' });
    assert.equal(sib.status, 201, JSON.stringify(sib.body));
    assert.ok(await store.taskForTicket(URL_KEY, 'LIN-4452'), 'the sibling\'s task was made');
    const parent = await store.taskForTicket(URL_KEY, 'LIN-4450');
    assert.equal((await store.current(URL_KEY, await store.taskForTicket(URL_KEY, 'LIN-4452'))).in, parent, 'the sibling sits in its parent\'s task');
  });

  // Leftovers (LIN-4493): a record id can have a ticket's shape (`finding-12345678` when its hex is all digits,
  // a run id such as `row-12345`). A reference to a record that exists resolves to it, and never reads the tracker.
  test('a reference to an existing record shaped like a ticket id resolves to the record, without a tracker read', async () => {
    await store.openRun(URL_KEY, { id: 'row-12345', stage: 'review', lineage: 'row-12345', at: '2026-11-19T10:00:04.000Z' });
    const r = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'About that run.', about: 'row-12345', run: 'row-impl' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.links.about, ['row-12345']);
    assert.equal(calls.ticketReads.includes('row-12345'), false, 'no tracker read for a record that exists');
  });

  test('a closed ticket is refused with the reason, and no task is made for it', async () => {
    const r = await post('/api/proxy/records', 'impl', { kind: 'finding', in: 'LIN-9', to: 'review', says: 'x', run: 'row-impl' });
    assert.equal(r.status, 422);
    assert.match(r.body.problems[0].message, /LIN-9 is closed \(Done\)/);
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-9'), null);
  });

  test('a ticket the tracker cannot read is named as such', async () => {
    const r = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', in: 'LIN-77777', says: 'x', run: 'row-impl' });
    assert.equal(r.status, 422);
    assert.match(r.body.problems[0].message, /LIN-77777 is not a ticket this workspace can read/);
  });

  test('a record kind a write may not add is refused, and run records are Harbour\'s', async () => {
    const r = await post('/api/proxy/records', 'impl', { kind: 'run', stage: 'review', run: 'row-impl' });
    assert.equal(r.status, 422);
    const rev = await post('/api/proxy/records/row-impl/revise', 'impl', { reason: 'x', stage: 'review', run: 'row-impl' });
    assert.equal(rev.status, 422);
  });
});

describe('a run and its writes (decision 2c)', () => {
  test('a run that ended refuses writes; taking its resume row reopens it; its terminal ends it again', async () => {
    await store.endRun(URL_KEY, 'row-impl', { state: 'done', account: 'Built it.', at: '2026-11-19T10:05:00.000Z' });
    const refused1 = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'x', run: 'row-impl' });
    assert.equal(refused1.status, 403);
    assert.equal(refused1.body.reason, 'run-ended');
    await store.openRun(URL_KEY, { id: 'row-impl', stage: 'implementation', lineage: 'row-root', at: '2026-11-19T10:06:00.000Z' });
    const ok = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'Follow-up finding.', run: 'row-impl' });
    assert.equal(ok.status, 201);
    await store.endRun(URL_KEY, 'row-impl', { state: 'aborted', at: '2026-11-19T10:07:00.000Z' });
    const refused2 = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'x', run: 'row-impl' });
    assert.equal(refused2.status, 403);
    assert.equal(refused2.body.reason, 'run-ended');
  });
});

describe('reads: find, show, get and the query log', () => {
  test('find and show read current versions; a count is available; each read is logged with who asked', async () => {
    const t = await post('/api/proxy/records', 'impl', { kind: 'finding', in: 'LIN-4451', to: 'review', says: 'Find me.', run: 'row-impl' });
    const task = await store.taskForTicket(URL_KEY, 'LIN-4451');
    const found = await get('/api/proxy/records?to=review&state=open', 'john');
    assert.equal(found.status, 200);
    assert.ok(found.body.records.some((r) => r.id === t.body.id));
    const count = await get('/api/proxy/records?to=review&count=1', 'john');
    assert.equal(count.body.count, found.body.records.length);
    const show = await get(`/api/proxy/tasks/${task}/records`, 'impl');
    assert.equal(show.status, 200);
    assert.ok(show.body.records.some((r) => r.id === t.body.id));
    const logged = await db.collection(QUERY_LOG_COLLECTION).find({ urlKey: URL_KEY }).toArray();
    assert.ok(logged.some((row) => row.by === 'person:acc-john' && row.cmd === 'find'));
    assert.ok(logged.some((row) => row.by === 'run:row-impl' && row.cmd === 'show'));
  });

  test('a blind read may not read records, though it may write its one finding', async () => {
    const read = await get('/api/proxy/records?to=review', 'blind');
    assert.equal(read.status, 403);
    assert.match(read.body.error, /blind read may not read records/);
    const write = await post('/api/proxy/records', 'blind', { kind: 'finding', to: 'close-out', says: 'Verdict.', run: 'row-blind' });
    assert.equal(write.status, 201, JSON.stringify(write.body));
  });

  test('a legacy credential reads nothing, and a missing record is 404', async () => {
    assert.equal((await get('/api/proxy/records', 'legacy')).status, 403);
    assert.equal((await get('/api/proxy/records/finding-nothere', 'john')).status, 404);
  });

  test('get with @v returns that version, and asOf reads the record as it stood', async () => {
    const made = await post('/api/proxy/records', 'john', { kind: 'lesson', says: 'First lesson.' });
    await post(`/api/proxy/records/${made.body.id}/revise`, 'john', { says: 'Second lesson.', reason: 'clearer' });
    const v1 = await get(`/api/proxy/records/${made.body.id}@1`, 'john');
    assert.equal(v1.body.fields.says, 'First lesson.');
    const asOf = await get(`/api/proxy/records/${made.body.id}?asOf=2026-11-01T00:00:00.000Z`, 'john');
    assert.equal(asOf.status, 404, 'the record did not exist then');
  });
});

describe('wakes and follow-ups are filed under the run they resume (decision 2c; LIN-4493 gap 3)', () => {
  const at = '2026-11-19T10:10:00.000Z';
  const doneEntry = { kind: 'done', message: '[done] Task completed' };

  test('a wake writes under the run it wakes: refused while that run has ended, and taking the wake reopens it', async () => {
    await store.endRun(URL_KEY, 'row-impl', { state: 'done', at });
    const refused = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'x', run: 'row-impl' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.reason, 'run-ended');
    const seam = createRunRecords({ recordsStore: store, now: () => new Date(at) });
    const wake = { _id: 'row-wake', urlKey: URL_KEY, kind: 'wake', runRecordId: 'row-impl', rootItemId: 'row-wake-root' };
    await seam.onTaken(wake);
    const ok = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'Woken finding.', how: 'check', run: 'row-impl' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.by, 'implementation');
    assert.equal(ok.body.run, 'row-impl');
    await seam.onFeedback(wake, doneEntry, [doneEntry]);
    const after = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'x', run: 'row-impl' });
    assert.equal(after.status, 403);
    assert.equal(after.body.reason, 'run-ended', 'the wake\'s own terminal ends the run again');
  });

  test('a stage-kind follow-up writes under its own new run, never under the finished build\'s run', async () => {
    await store.endRun(URL_KEY, 'row-impl', { state: 'done', at });
    const seam = createRunRecords({ recordsStore: store, now: () => new Date(at) });
    await seam.onTaken({ _id: 'row-follow', urlKey: URL_KEY, kind: 'implementation', runRecordId: 'row-follow', rootItemId: 'row-root' });
    tokens.follow = { origin: 'dispatch', runRecordId: 'row-follow', writes: 'implementation' };
    const own = await post('/api/proxy/records', 'follow', { kind: 'finding', to: 'review', says: 'Follow-up finding.', how: 'check', run: 'row-follow' });
    assert.equal(own.status, 201, JSON.stringify(own.body));
    assert.equal(own.body.run, 'row-follow');
    const build = await post('/api/proxy/records', 'follow', { kind: 'finding', to: 'review', says: 'x', run: 'row-impl' });
    assert.equal(build.status, 403);
    assert.equal(build.body.reason, 'run-ended');
  });

  test('a kind-less custom resume reopens the build\'s run through the seam, and its write is filed under that run', async () => {
    await store.endRun(URL_KEY, 'row-impl', { state: 'done', at });
    const seam = createRunRecords({ recordsStore: store, now: () => new Date(at) });
    await seam.onTaken({ _id: 'row-resume', urlKey: URL_KEY, kind: null, runRecordId: 'row-impl', rootItemId: 'row-root' });
    const ok = await post('/api/proxy/records', 'impl', { kind: 'finding', to: 'review', says: 'Resumed finding.', how: 'check', run: 'row-impl' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.by, 'implementation');
  });

  test('a wake credential naming a run in another lineage is refused', async () => {
    tokens.wakeElsewhere = { origin: 'dispatch', runRecordId: 'row-other', writes: 'implementation' };
    const r = await post('/api/proxy/records', 'wakeElsewhere', { kind: 'finding', to: 'review', says: 'x', run: 'row-impl' });
    assert.equal(r.status, 403);
    assert.equal(r.body.reason, 'other-lineage');
  });
});

describe('a refused write makes no task (LIN-4493 gap 5)', () => {
  test('a 422 naming in: LIN-4452 leaves the ticket with no task, and the body\'s problems are all named', async () => {
    const r = await post('/api/proxy/records', 'john', { kind: 'finding', to: 'review', says: 'x', bogus: 'nope', in: 'LIN-4452' });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.ok(r.body.problems.some((p) => p.field === 'bogus'));
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-4452'), null, 'the refused write made no task for LIN-4452');
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-4450'), null, 'nor for its parent');
    const tasks = await db.collection(RECORDS_COLLECTION).countDocuments({ urlKey: URL_KEY, kind: 'task' });
    assert.equal(tasks, 0);
  });

  test('a clean write that names the same ticket makes its task, parent first', async () => {
    const r = await post('/api/proxy/records', 'john', { kind: 'finding', to: 'review', says: 'x', in: 'LIN-4452' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const task = await store.taskForTicket(URL_KEY, 'LIN-4452');
    assert.ok(task, 'the ticket\'s task was made');
    assert.equal(r.body.in, task);
    assert.ok(await store.taskForTicket(URL_KEY, 'LIN-4450'), 'the parent task was made above it');
  });
});

describe('reads and writes touch only the records they name (LIN-4493 gap 4)', () => {
  /** A store collection whose find() counts the documents it returns: the reads a request makes. */
  function countingReads(collection, counter) {
    return new Proxy(collection, {
      get(target, prop) {
        if (prop === 'find') {
          return (...args) => {
            const cursor = target.find(...args);
            const toArray = cursor.toArray.bind(cursor);
            cursor.toArray = async () => { const docs = await toArray(); counter.docs += docs.length; return docs; };
            return cursor;
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  test('with 2,000 unrelated versions in the workspace, writes and filtered reads read a handful of documents', async () => {
    const seed = [];
    for (let i = 0; i < 2000; i++) {
      seed.push({ _id: `${URL_KEY}::lesson-u${i}::1`, urlKey: URL_KEY, id: `lesson-u${i}`, v: 1, op: 'add', kind: 'lesson', state: 'open', to: 'someone-else', at: '2026-11-01T00:00:00.000Z', by: 'implementation', links: {}, fields: { says: `unrelated ${i}` } });
    }
    for (let i = 0; i < seed.length; i += 500) await db.collection(RECORDS_COLLECTION).insertMany(seed.slice(i, i + 500));
    const counter = { docs: 0 };
    store.records = countingReads(store.records, counter);
    const measure = async (label, fn) => {
      const before = counter.docs;
      const out = await fn();
      const read = counter.docs - before;
      assert.ok(read < 50, `${label} read ${read} documents`);
      return out;
    };
    const made = await measure('add', () => post('/api/proxy/records', 'john', { kind: 'finding', to: 'review', says: 'Mine.', how: 'check' }));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const revised = await measure('revise', () => post(`/api/proxy/records/${made.body.id}/revise`, 'john', { says: 'Mine, revised.', reason: 'sharper' }));
    assert.equal(revised.status, 200, JSON.stringify(revised.body));
    const found = await measure('find by kind and addressee', () => get('/api/proxy/records?kind=finding&to=review', 'john'));
    assert.equal(found.body.records.length, 1);
    const count = await measure('find count by addressee', () => get('/api/proxy/records?to=review&count=1', 'john'));
    assert.equal(count.body.count, 1);
    assert.ok(counter.docs < 2000, `the whole test read ${counter.docs} documents, not the workspace's 2,000+`);
  });
});

describe('a record id is never read as a ticket (a flake found by repeat runs: an all-digit hex suffix)', () => {
  test('a record whose id reads like a ticket (kind-12345678) can be linked to: it is a record, not a ticket', async () => {
    const id = 'change-44394596';
    await db.collection(RECORDS_COLLECTION).insertOne({ _id: `${URL_KEY}::${id}::1`, urlKey: URL_KEY, id, v: 1, op: 'add', kind: 'change', state: 'open', at: '2026-11-19T10:00:00.000Z', by: 'implementation', links: {}, fields: { ref: 'PR 9', head: 'abc' } });
    const made = await post('/api/proxy/records', 'john', { kind: 'finding', to: 'review', says: 'About it.', how: 'check', about: id });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual(made.body.links.about, [id]);
    assert.deepEqual(calls.ticketReads, [], 'no tracker read for a record id');
  });
});
