/**
 * LIN-4404 (part 1 of LIN-4395): the per-task read for the session timeline.
 *
 * Witnesses:
 *  - each dispatch's `firstRequestAt` / `lastRequestAt` is the min/max `at` of the records split rule C gives it: a
 *    late-posted record's time counts toward the dispatch it moves to, and a dispatch with no records reads null;
 *  - `readCost`'s `foundedElsewhere` opt-in reports a lineage founded on another issue that has a fetched member tagged
 *    with this one, with `countedUnder` and `taggedItemIds`. Its cost is never in `pricedUsd`/`totalUsd`, and every
 *    own figure is byte-identical with and without the flag;
 *  - the window guard still applies when `windowStart` is passed;
 *  - `readTaskCost` is callable with no app-call summary, reads with no `since`, returns `lineagesTruncated` from
 *    `lineageTotal > lineageLimit`, keeps each lineage's own `incomplete`, and passes the opt-in through;
 *  - the task-life rule: `taskLifeStart()` is the epoch as a fresh `Date`, and `listInHorizon` with no `since` still
 *    bounds to 30 days.
 *
 * Run with: node --test tests/unit/lin-4404-task-life-cost-read.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readCostOverRecords } from '../../lib/cost-read.js';
import { readTaskCost, LINEAGE_QUERY_LIMIT } from '../../lib/task-cost-read.js';
import { LINEAGE_QUERY_LIMIT as ROUTE_LINEAGE_QUERY_LIMIT } from '../../routes/proxy.js';
import { taskLifeStart, TASK_LIFE_SCOPE, TASK_LIFE_HORIZON, READ_HORIZON_MS } from '../../lib/read-horizon.js';
import { LlmCallLogStore } from '../../lib/llm-call-log.js';
import { NO_REQUEST_RECORDS, loaderOver } from '../fixtures/request-usage-loader.js';
import { stubLineageIdentity } from '../fixtures/lineage-identity.js';

const NOW = Date.UTC(2026, 10, 5, 12);
const at = minutesAgo => new Date(NOW - minutesAgo * 60 * 1000).toISOString();
const HAIKU = 'claude-haiku-5-5';

const dispatch = (id, anchor, minutesAgo, extra = {}) => ({
  _id: id, id, rootItemId: anchor, issueIdentifier: 'LIN-1', kind: 'implementation', status: 'taken',
  dispatchedAt: at(minutesAgo), feedback: [], ...extra,
});
const request = (anchor, itemId, requestId, minutesAgo, { costUsd = 0.1 } = {}) => ({
  rootItemId: anchor, itemId, requestId, at: minutesAgo === null ? null : at(minutesAgo), updatedAt: at(0),
  harness: 'claude-code', model: HAIKU, effort: 'high', inputTokens: 1000, outputTokens: 100,
  cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0, costUsd,
});
const sessionOf = (result, anchor) => result.workerSessions.find(s => s.rootItemId === anchor);

describe('LIN-4404: per-dispatch working spans follow split rule C', () => {
  test('each dispatch reads the min and max `at` of the records it owns', () => {
    const rows = [dispatch('b1', 'b1', 60), dispatch('f1', 'b1', 20, { followUpTo: 'b1', kind: 'leftover' })];
    const requests = [
      request('b1', 'b1', 'q2', 50),
      request('b1', 'b1', 'q1', 58),
      request('b1', 'b1', 'q3', 40),
      request('b1', 'f1', 'o1', 15),
      request('b1', 'f1', 'o2', 5),
    ];
    const [build, follow] = sessionOf(readCostOverRecords({ fetchedRows: rows, perDispatch: true }, requests), 'b1').dispatches;
    assert.equal(build.firstRequestAt, at(58));
    assert.equal(build.lastRequestAt, at(40));
    assert.equal(follow.firstRequestAt, at(15));
    assert.equal(follow.lastRequestAt, at(5));
  });

  test('a late-posted record counts toward the dispatch it moves to, not the row it was posted under', () => {
    const rows = [dispatch('b1', 'b1', 60), dispatch('f1', 'b1', 20, { followUpTo: 'b1' })];
    // Every record posted under f1; the two made before f1 existed move back to b1 (split rule C).
    const requests = [
      request('b1', 'f1', 'q1', 55),
      request('b1', 'f1', 'q2', 30),
      request('b1', 'f1', 'o1', 10),
    ];
    const [build, follow] = sessionOf(readCostOverRecords({ fetchedRows: rows, perDispatch: true }, requests), 'b1').dispatches;
    assert.equal(build.requests, 2);
    assert.equal(build.firstRequestAt, at(55));
    assert.equal(build.lastRequestAt, at(30));
    assert.equal(follow.requests, 1);
    assert.equal(follow.firstRequestAt, at(10));
    assert.equal(follow.lastRequestAt, at(10));
  });

  test('a dispatch with no records, and one whose records have no time, read null', () => {
    const rows = [dispatch('b1', 'b1', 60), dispatch('w1', 'b1', 30, { kind: 'wake' }), dispatch('w2', 'b1', 10, { kind: 'wake' })];
    const requests = [request('b1', 'b1', 'q1', 50), request('b1', 'w2', 'u1', null)];
    const [build, quiet, untimed] = sessionOf(readCostOverRecords({ fetchedRows: rows, perDispatch: true }, requests), 'b1').dispatches;
    assert.equal(build.firstRequestAt, at(50));
    assert.equal(quiet.requests, 0);
    assert.equal(quiet.firstRequestAt, null);
    assert.equal(quiet.lastRequestAt, null);
    assert.equal(untimed.requests, 1, 'the untimed record is owned (and priced) by its posting row');
    assert.equal(untimed.firstRequestAt, null);
    assert.equal(untimed.lastRequestAt, null);
  });

  test('the span keys are additive: placed last in each entry, after costUsd', () => {
    const rows = [dispatch('b1', 'b1', 60)];
    const [entry] = sessionOf(readCostOverRecords({ fetchedRows: rows, perDispatch: true }, [request('b1', 'b1', 'q1', 50)]), 'b1').dispatches;
    assert.deepEqual(Object.keys(entry), ['itemId', 'kind', 'dispatchedAt', 'followUpTo', 'byModel', 'requests', 'tokens', 'costUsd', 'firstRequestAt', 'lastRequestAt']);
  });
});

describe('LIN-4404: the foundedElsewhere opt-in', () => {
  // LIN-1 founds `own`. A parent autopilot `P` is founded on LIN-9; its wakes W1, W2 were caused by LIN-1's sessions
  // and carry LIN-1 (lib/dispatch-wake.js), its wake W3 carries another child. `Q` is founded on LIN-9 with no LIN-1
  // member: it was fetched (by an anchor) but has nothing to do with LIN-1 and is never reported.
  function fixture() {
    const own = dispatch('own', 'own', 120);
    const parent = dispatch('P', 'P', 300, { issueIdentifier: 'LIN-9', kind: 'autopilot' });
    const w1 = dispatch('W1', 'P', 100, { kind: 'wake' });
    const w2 = dispatch('W2', 'P', 50, { kind: 'wake' });
    const w3 = dispatch('W3', 'P', 40, { issueIdentifier: 'LIN-7', kind: 'wake' });
    const other = dispatch('Q', 'Q', 200, { issueIdentifier: 'LIN-9' });
    const requests = [
      request('own', 'own', 'a1', 110, { costUsd: 2 }),
      request('P', 'P', 'p1', 290, { costUsd: 5 }),
      request('P', 'W1', 'p2', 95, { costUsd: 1 }),
      request('P', 'W2', 'p3', 45, { costUsd: 1 }),
      request('P', 'W3', 'p4', 35, { costUsd: 1 }),
      request('Q', 'Q', 'q1', 190, { costUsd: 9 }),
    ];
    return { rows: [parent, w1, w2, w3, other, own], requests };
  }
  const params = (extra = {}) => ({ ...fixture(), issueIdentifier: 'LIN-1', perDispatch: true, ...extra });
  const read = (extra) => { const { rows, requests, ...rest } = params(extra); return readCostOverRecords({ fetchedRows: rows, ...rest }, requests); };

  test('own figures are byte-identical with and without the flag; without it the key is absent', () => {
    const without = read();
    const { foundedElsewhere, ...withOwn } = read({ foundedElsewhere: true });
    assert.ok(Array.isArray(foundedElsewhere));
    assert.equal('foundedElsewhere' in without, false);
    assert.equal(JSON.stringify(withOwn), JSON.stringify(without));
  });

  test('the foreign lineage is reported with countedUnder and the itemIds tagged with this issue, and is not in pricedUsd', () => {
    const result = read({ foundedElsewhere: true });
    assert.deepEqual(result.workerSessions.map(s => s.rootItemId), ['own']);
    assert.equal(result.pricedUsd, 2);
    assert.equal(result.totalUsd, 2);

    assert.equal(result.foundedElsewhere.length, 1, 'Q has no LIN-1 member and is not reported');
    const [lane] = result.foundedElsewhere;
    assert.equal(lane.rootItemId, 'P');
    assert.equal(lane.kind, 'autopilot');
    assert.equal(lane.countedUnder, 'LIN-9');
    assert.deepEqual(lane.taggedItemIds, ['W1', 'W2']);
    assert.equal(lane.costUsd, 8, 'the lineage cost, counted under its founder');
    assert.deepEqual(lane.dispatches.map(d => d.itemId), ['P', 'W1', 'W2', 'W3']);
    // Summarised by the same branches: the same row keys as an own session, then the two foreign keys.
    assert.deepEqual(Object.keys(lane), [...Object.keys(result.workerSessions[0]), 'countedUnder', 'taggedItemIds']);
  });

  test('a lineage whose founder names no issue reads countedUnder null', () => {
    const root = dispatch('P', 'P', 300, { issueIdentifier: null, kind: 'autopilot' });
    const wake = dispatch('W', 'P', 100, { kind: 'wake' });
    const result = readCostOverRecords({ fetchedRows: [root, wake], issueIdentifier: 'LIN-1', foundedElsewhere: true }, []);
    assert.equal(result.noLineage, true);
    assert.equal(result.foundedElsewhere[0].countedUnder, null);
    assert.deepEqual(result.foundedElsewhere[0].taggedItemIds, ['W']);
  });

  test('without an issueIdentifier the opt-in has nothing to compare against and adds no key', () => {
    const { rows, requests } = fixture();
    const result = readCostOverRecords({ fetchedRows: rows, foundedElsewhere: true }, requests);
    assert.equal('foundedElsewhere' in result, false);
  });

  test('the window guard still applies when windowStart is passed, to both lists', () => {
    const result = read({ foundedElsewhere: true, windowStart: new Date(NOW - 30 * 60 * 1000) });
    // Every LIN-1 own member is 120 min old and the parent's latest member 40 min: all outside a 30-minute window.
    assert.deepEqual(result.workerSessions, []);
    assert.deepEqual(result.foundedElsewhere, []);
  });
});

describe('LIN-4404: readTaskCost', () => {
  const LIMIT = 3;
  function store({ history, total }) {
    const calls = [];
    return {
      calls,
      listItems: async () => [],
      listHistory: async (urlKey, opts = {}) => {
        calls.push(opts);
        if (opts.rootItemId?.$in) {
          const items = history.filter(r => opts.rootItemId.$in.includes(r.rootItemId));
          return { items: items.slice(0, opts.limit), total: total ?? items.length };
        }
        const items = history.filter(r => r.issueIdentifier === opts.issueIdentifier);
        return { items, total: items.length };
      },
      lineageIdentityRows: stubLineageIdentity(() => history),
    };
  }

  test('callable with no app-call summary; reads with no since; not truncated under the cap', async () => {
    const history = [dispatch('b1', 'b1', 60)];
    const s = store({ history });
    const result = await readTaskCost({ dispatchQueueStore: s, requestUsageLoader: loaderOver([request('b1', 'b1', 'q1', 50, { costUsd: 0.4 })]), lineageLimit: LIMIT }, { urlKey: 'acme', identifier: 'LIN-1' });
    assert.equal(result.lineagesTruncated, false);
    assert.deepEqual(result.appCalls, { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] });
    assert.equal(result.totalUsd, 0.4);
    assert.equal(sessionOf(result, 'b1').dispatches[0].firstRequestAt, at(50));
    for (const call of s.calls) assert.equal(call.since, undefined, 'identity-bounded: no time bound');
    assert.equal('foundedElsewhere' in result, false);
  });

  test('lineageTotal over the cap returns lineagesTruncated, and the lineage that lost a member keeps its own incomplete', async () => {
    // A no-usage lineage whose founder the capped sibling read drops: the narrow rule marks it incomplete.
    const history = [dispatch('f1', 'b1', 10, { followUpTo: 'b1' }), dispatch('b1', 'b1', 60)];
    const s = store({ history: [history[0]], total: LIMIT + 1 });
    s.lineageIdentityRows = stubLineageIdentity(() => history);
    const warn = console.warn;
    const warned = [];
    console.warn = (msg) => warned.push(msg);
    try {
      const result = await readTaskCost({ dispatchQueueStore: s, requestUsageLoader: NO_REQUEST_RECORDS, lineageLimit: LIMIT }, { urlKey: 'acme', identifier: 'LIN-1' });
      assert.equal(result.lineagesTruncated, true);
      assert.equal(sessionOf(result, 'b1').incomplete, true);
      assert.equal(result.totalUsd, null, 'never a partial as a total');
    } finally {
      console.warn = warn;
    }
    assert.equal(warned.length, 1);
    assert.match(warned[0], /exceeded LINEAGE_QUERY_LIMIT \(3\)/);
  });

  test('passes the foundedElsewhere opt-in through to the one read', async () => {
    const history = [dispatch('P', 'P', 300, { issueIdentifier: 'LIN-9', kind: 'autopilot' }), dispatch('W1', 'P', 100, { kind: 'wake' })];
    const result = await readTaskCost({ dispatchQueueStore: store({ history }), requestUsageLoader: NO_REQUEST_RECORDS, lineageLimit: LIMIT }, { urlKey: 'acme', identifier: 'LIN-1', foundedElsewhere: true });
    assert.equal(result.noLineage, true);
    assert.deepEqual(result.foundedElsewhere.map(l => [l.rootItemId, l.countedUnder, l.taggedItemIds]), [['P', 'LIN-9', ['W1']]]);
  });

  test('the cap defaults to LINEAGE_QUERY_LIMIT, the cap this read owns', async () => {
    const s = store({ history: [dispatch('b1', 'b1', 60)] });
    await readTaskCost({ dispatchQueueStore: s, requestUsageLoader: NO_REQUEST_RECORDS }, { urlKey: 'acme', identifier: 'LIN-1' });
    assert.equal(s.calls.find(c => c.rootItemId).limit, LINEAGE_QUERY_LIMIT);
    assert.equal(LINEAGE_QUERY_LIMIT, ROUTE_LINEAGE_QUERY_LIMIT, 'routes/proxy.js re-exports the same cap');
  });

  test('refuses a missing store, a bad cap or a missing loader rather than reading something else', async () => {
    const s = store({ history: [] });
    await assert.rejects(readTaskCost({ requestUsageLoader: NO_REQUEST_RECORDS, lineageLimit: 3 }, { urlKey: 'acme', identifier: 'LIN-1' }), /dispatchQueueStore/);
    await assert.rejects(readTaskCost({ dispatchQueueStore: s, requestUsageLoader: NO_REQUEST_RECORDS, lineageLimit: 0 }, { urlKey: 'acme', identifier: 'LIN-1' }), /lineageLimit/);
    await assert.rejects(readTaskCost({ dispatchQueueStore: s, lineageLimit: 3 }, { urlKey: 'acme', identifier: 'LIN-1' }));
  });
});

describe('LIN-4404: the task-life rule beside the 30-day reporting window', () => {
  test('taskLifeStart is the epoch, as a new Date each call', () => {
    const a = taskLifeStart();
    const b = taskLifeStart();
    assert.ok(a instanceof Date);
    assert.equal(a.getTime(), 0);
    assert.notEqual(a, b);
    assert.equal(TASK_LIFE_SCOPE, 'task-life');
    assert.equal(TASK_LIFE_HORIZON, 'all');
  });

  test('listInHorizon with no since still bounds to the 30-day window', async () => {
    let query = null;
    const store = new LlmCallLogStore({ collection: { find(q) { query = q; return { toArray: async () => [] }; } } });
    await store.listInHorizon('acme', { issueIdentifier: 'LIN-1' });
    assert.ok(query.timestamp.$gte instanceof Date);
    const ageMs = Date.now() - query.timestamp.$gte.getTime();
    assert.ok(Math.abs(ageMs - READ_HORIZON_MS) < 5000, `expected ~30 days, got ${ageMs / 86400000} days`);
  });
});
