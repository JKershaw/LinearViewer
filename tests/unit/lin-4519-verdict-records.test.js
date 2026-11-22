/**
 * LIN-4519 (slice 3, P6): verdict facts for the measures, read from records.
 *
 * Witnesses:
 *   - the cutover instant: a work instant before VERDICT_RECORDS_SINCE is not covered, one at or after it is, and an
 *     absent instant or an absent instant of coverage is not covered (never "no verdict");
 *   - the pure fold: a ticket's verdicts come from its task (the task whose ref names it), each with its first write time,
 *     sorted by that time; a ticket with no task is measured with no verdicts; a window is half-open;
 *   - the proxy reader: three list reads, then the first write of each verdict whose current version is later (one read
 *     each), and a failed read makes every ticket not measured with the reason;
 *   - the store read (verdictFactsForTickets): a verdict revised later keeps its first write time, and a ticket with no
 *     claim reads measured with no verdicts.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import {
  VERDICT_RECORDS_SINCE, VERDICT_JUDGEMENTS, verdictCoverageAt, verdictFactsFromRecords, verdictFactsNotMeasured,
  verdictViewOf, verdictsInWindow,
} from '../../lib/records/verdict-facts.js';
import { readVerdictFactsThroughProxy } from '../../scripts/verdict-facts-proxy.mjs';

describe('the cutover instant', () => {
  test('is the P5 writers\' go-live, and covers from that instant on (never before)', () => {
    assert.equal(VERDICT_RECORDS_SINCE, '2026-11-22T04:20:39.504Z', 'the first stage-written verdict record in production, after the P5 go-live');
    assert.equal(verdictCoverageAt('2026-11-22T04:20:39.504Z').covered, true, 'at the instant: covered');
    assert.equal(verdictCoverageAt('2026-11-22T04:20:39.503Z').covered, false, 'a millisecond before: not covered');
    const before = verdictCoverageAt('2026-11-20T23:00:00.000Z');
    assert.equal(before.covered, false);
    assert.match(before.reason, /no verdict records before 2026-11-22 04:20Z/);
  });

  test('an absent instant or an absent cutover is not covered, with a reason, never a value', () => {
    assert.equal(verdictCoverageAt(null).covered, false);
    assert.match(verdictCoverageAt(undefined).reason, /no date/);
    assert.equal(verdictCoverageAt('2026-12-01T00:00:00.000Z', null).covered, false);
    assert.match(verdictCoverageAt('2026-12-01T00:00:00.000Z', null).reason, /verdict import has not applied/);
  });

  test('a not-measured reading is frozen and says why', () => {
    const nm = verdictFactsNotMeasured('db down');
    assert.equal(nm.measured, false);
    assert.equal(nm.reason, 'db down');
    assert.equal(Object.isFrozen(nm), true);
  });
});

describe('the fold: verdicts by ticket, from the task that names it', () => {
  const task = (id, ref) => ({ id, kind: 'task', fields: { ref } });
  const verdict = (id, judgement, outcome, at, extra = {}) => ({ id, kind: 'verdict', v: 1, at, in: 'task-a', state: 'stands', fields: { judgement, outcome }, links: { on: ['change-1@1'] }, ...extra });

  test('a ticket gets its task\'s verdicts with their first write times, earliest first', () => {
    const tasks = [task('task-a', 'LIN-1'), task('task-b', 'LIN-2')];
    const verdicts = [
      verdict('v-late', 'review', 'approve', '2026-11-25T03:00:00.000Z'),
      verdict('v-early', 'plan-review', 'request-changes', '2026-11-24T01:00:00.000Z'),
      verdict('v-other', 'review', 'approve', '2026-11-24T02:00:00.000Z', { in: 'task-b' }),
    ];
    const facts = verdictFactsFromRecords({ tasks, verdicts }, ['LIN-1', 'LIN-2', 'LIN-9']);
    const one = facts.get('LIN-1');
    assert.equal(one.measured, true);
    assert.equal(one.taskId, 'task-a');
    assert.deepEqual(one.verdicts.map((v) => v.id), ['v-early', 'v-late']);
    assert.equal(one.verdicts[0].judgement, 'plan-review');
    assert.equal(one.verdicts[0].outcome, 'request-changes', 'the outcome word as the record holds it');
    assert.deepEqual(one.verdicts[1].on, [{ id: 'change-1', v: 1 }]);
    assert.deepEqual(facts.get('LIN-2').verdicts.map((v) => v.id), ['v-other']);
  });

  test('a ticket with no task is measured with no verdicts, and a first write time wins over the current one', () => {
    const tasks = [task('task-a', 'LIN-1')];
    const verdicts = [verdict('v1', 'review', 'approve', '2026-11-26T00:00:00.000Z')];
    const facts = verdictFactsFromRecords({ tasks, verdicts, firstAt: new Map([['v1', '2026-11-22T00:00:00.000Z']]) }, ['LIN-9', 'LIN-1']);
    assert.deepEqual(facts.get('LIN-9'), { measured: true, taskId: null, verdicts: [] });
    assert.equal(facts.get('LIN-1').verdicts[0].at, '2026-11-22T00:00:00.000Z');
  });

  test('a window is half-open and judged on the judgement asked', () => {
    const views = [
      verdictViewOf(verdict('a', 'review', 'approve', '2026-11-22T00:00:00.000Z'), '2026-11-22T00:00:00.000Z'),
      verdictViewOf(verdict('b', 'plan-review', 'approve', '2026-11-22T00:00:00.000Z'), '2026-11-22T00:00:00.000Z'),
      verdictViewOf(verdict('c', 'review', 'approve', '2026-11-23T00:00:00.000Z'), '2026-11-23T00:00:00.000Z'),
    ];
    const hits = verdictsInWindow(views, { judgement: VERDICT_JUDGEMENTS.review, from: '2026-11-22T00:00:00.000Z', to: '2026-11-23T00:00:00.000Z' });
    assert.deepEqual(hits.map((v) => v.id), ['a'], 'the start is in, the end is out, and the other judgement is not counted');
  });
});

describe('the proxy reader: records through GET /records, first writes only where needed', () => {
  const tasks = [{ id: 'task-a', kind: 'task', v: 1, fields: { ref: 'LIN-1' } }];
  const changes = [{ id: 'change-1', kind: 'change', v: 1, fields: { ref: 'https://github.com/o/r/pull/9' } }];
  const v1 = { id: 'v1', kind: 'verdict', v: 1, at: '2026-11-22T00:00:00.000Z', in: 'task-a', state: 'stands', fields: { judgement: 'review', outcome: 'approve' }, links: {} };
  const v2 = { id: 'v2', kind: 'verdict', v: 2, at: '2026-11-24T00:00:00.000Z', in: 'task-a', state: 'withdrawn', fields: { judgement: 'review', outcome: 'request-changes' }, links: {} };

  function fakeProxy({ failOn = null } = {}) {
    const urls = [];
    const getJson = async (url) => {
      urls.push(url);
      if (failOn && url.includes(failOn)) throw new Error(`proxy 500 on ${url}`);
      if (url.endsWith('/records?kind=task')) return { records: tasks };
      if (url.endsWith('/records?kind=verdict')) return { records: [v1, v2] };
      if (url.endsWith('/records?kind=change')) return { records: changes };
      if (url.endsWith('/records/v2')) return { id: 'v2', versions: [
        { v: 1, at: '2026-11-22T00:00:00.000Z', op: 'add' }, { v: 2, at: '2026-11-24T00:00:00.000Z', op: 'end' },
      ] };
      throw new Error(`unexpected ${url}`);
    };
    return { urls, getJson };
  }

  test('three list reads, one first-write read for the verdict whose current version is not its first, and the change records', async () => {
    const { urls, getJson } = fakeProxy();
    const out = await readVerdictFactsThroughProxy({ base: 'http://proxy', token: 't', getJson, tickets: ['LIN-1', 'LIN-9'] });
    assert.equal(out.reads, 4, 'three lists, then the first write of v2 (v1 is its own first write)');
    assert.deepEqual(urls.filter((u) => u.includes('/records/')), ['http://proxy/records/v2']);
    assert.equal(out.changes.length, 1);
    const one = out.facts.get('LIN-1');
    assert.equal(one.measured, true);
    // v2's first write is its v1 (22 Nov), not its current version (24 Nov): an ended verdict keeps its place in a window.
    assert.deepEqual(one.verdicts.map((v) => [v.id, v.at, v.state]), [['v1', '2026-11-22T00:00:00.000Z', 'stands'], ['v2', '2026-11-22T00:00:00.000Z', 'withdrawn']]);
    assert.deepEqual(out.facts.get('LIN-9'), { measured: true, taskId: null, verdicts: [] });
  });

  test('a failed read makes every ticket not measured with the reason, never "no verdict"', async () => {
    const { getJson } = fakeProxy({ failOn: 'kind=verdict' });
    const out = await readVerdictFactsThroughProxy({ base: 'http://proxy', token: 't', getJson, tickets: ['LIN-1', 'LIN-9'] });
    for (const t of ['LIN-1', 'LIN-9']) {
      assert.equal(out.facts.get(t).measured, false);
      assert.match(out.facts.get(t).reason, /could not be read through the proxy \(proxy 500/);
    }
    assert.deepEqual(out.changes, []);
  });
});

describe('verdictFactsForTickets: one read for many tickets, against the records store', () => {
  const harness = createMangoTmpdir('lin-4519-');
  const URL_KEY = 'lin-4519-workspace';
  let db;
  let store;
  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(async () => {
    db = harness.freshDb();
    await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
    store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  });

  test('a revised verdict keeps its first write time; a withdrawn one shows as withdrawn; a ticket with no claim is measured, empty', async () => {
    const by = { by: 'review' };
    const t = await store.add(URL_KEY, { kind: 'task', state: 'open', fields: { ref: 'LIN-1', asked: 'LIN-1 words' }, links: {} }, { by: 'breakdown' });
    await store.claimTicket(URL_KEY, 'LIN-1', t.id);
    const first = await store.add(URL_KEY, { kind: 'verdict', state: 'stands', in: t.id, fields: { judgement: 'review', outcome: 'request-changes', reasoning: 'r' }, links: {} }, { ...by, at: '2026-11-22T10:00:00.000Z' });
    await store.revise(URL_KEY, first.id, { fields: { outcome: 'approve' } }, { by: 'review', reason: 'fixed', at: '2026-11-22T11:00:00.000Z' });
    const second = await store.add(URL_KEY, { kind: 'verdict', state: 'stands', in: t.id, fields: { judgement: 'blind-read', outcome: 'better', reasoning: 'b' }, links: {} }, { by: 'blind-read', at: '2026-11-22T12:00:00.000Z' });
    await store.end(URL_KEY, second.id, { state: 'withdrawn', reason: 'superseded by a new read' }, { by: 'review', at: '2026-11-22T13:00:00.000Z' });

    const facts = await store.verdictFactsForTickets(URL_KEY, ['LIN-1', 'LIN-404', 'LIN-1']);
    assert.deepEqual([...facts.keys()].sort(), ['LIN-1', 'LIN-404']);
    const one = facts.get('LIN-1');
    assert.equal(one.measured, true);
    assert.equal(one.taskId, t.id);
    const byId = Object.fromEntries(one.verdicts.map((v) => [v.id, v]));
    assert.equal(byId[first.id].at, '2026-11-22T10:00:00.000Z', 'the first write time, not the revision');
    assert.equal(byId[first.id].outcome, 'approve', 'the current words');
    assert.equal(byId[first.id].judgement, 'review');
    assert.equal(byId[second.id].state, 'withdrawn');
    assert.equal(byId[second.id].at, '2026-11-22T12:00:00.000Z');
    assert.deepEqual(facts.get('LIN-404'), { measured: true, taskId: null, verdicts: [] });
  });
});
