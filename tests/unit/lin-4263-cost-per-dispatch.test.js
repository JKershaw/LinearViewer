/**
 * LIN-4263: `/cost` reports each dispatch's own model and tokens inside its lineage.
 *
 * The lineage row stays one row per lineage. The row gains `tokens`, `byModel` (records lineages) and `dispatches`
 * (records lineages, read with `perDispatch`): one entry per true dispatch, folded from the records it owns.
 *
 * Witnesses:
 *  - a Haiku build with an Opus follow-up gives two entries with their own models, tokens and USD, summing to the
 *    lineage's figures, and the lineage's own total is unchanged (the literal sum of the fixture's prices);
 *  - the same when every record is posted under the follow-up's itemId, with the build's `at` before the follow-up
 *    was dispatched (split rule C moves a provably late record back to the build);
 *  - the label guard: an expensive Haiku build and a cheap, LATER Opus follow-up stay labelled Haiku, the lineage's
 *    label being cost-dominant. A regression to the last session's model fails here, where real data cannot (its
 *    follow-up usually dominates);
 *  - snapshot-only, records+snapshots, no-usage and unreadable lineages carry `dispatches: null` (never a guessed
 *    split), and unknown tokens and byModel as null;
 *  - a dispatch that posted no records reads `requests: 0` and null money and tokens, not 0 or [];
 *  - a dispatch the fetch did not return (out of window) is still an entry, with its `followUpTo` from the identity;
 *  - only `perDispatch` builds `dispatches`; every other figure is the same with or without it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readCostOverRecords } from '../../lib/cost-read.js';
import { foldRequestUsage } from '../../lib/request-usage-fold.js';

const NOW = Date.UTC(2026, 10, 5, 12);
const at = hoursAgo => new Date(NOW - hoursAgo * 3600 * 1000).toISOString();

const HAIKU = 'claude-haiku-5-5';
const OPUS = 'claude-opus-5-5';

/** A dispatch row of lineage `anchor`. `followUpTo` marks a follow-up. */
const dispatch = (id, anchor, hoursAgo, extra = {}) => ({
  _id: id, id, rootItemId: anchor, issueIdentifier: 'LIN-4263', kind: 'implementation', status: 'taken',
  dispatchedAt: at(hoursAgo), feedback: [], ...extra,
});
/** A request record as the loader returns it: its posting row's `itemId`, and a native `costUsd` (so the price is exact). */
const request = (anchor, itemId, requestId, hoursAgo, { model = HAIKU, costUsd, inputTokens = 1000, outputTokens = 100, cacheReadInputTokens = 0 } = {}) => ({
  rootItemId: anchor, itemId, requestId, at: at(hoursAgo), updatedAt: at(hoursAgo),
  harness: 'claude-code', model, effort: 'high', inputTokens, outputTokens,
  cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens, costUsd,
});
/** A `[usage]` snapshot entry (the pre-records harness path). */
const snapshot = (hoursAgo, { harness = 'claude-code', model = OPUS, costUsd, inputTokens = 1000 } = {}) => ({
  kind: 'usage', timestamp: at(hoursAgo),
  message: `[usage] ${JSON.stringify({ harness, model, inputTokens, outputTokens: 10, lane: null, costUsd })}`,
});

const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} != ${expected}`);
const sessionOf = (result, anchor) => result.workerSessions.find(s => s.rootItemId === anchor);
const perDispatch = (params, records) => readCostOverRecords({ perDispatch: true, ...params }, records);

/**
 * The shared fixture: a Haiku build (b1, 5h ago) with three priced Haiku requests, and an Opus follow-up (f1, 2h ago,
 * `followUpTo: b1`) with one priced Opus request, posted under its own row. Priced: build 0.6 + 0.2 + 0.2 = 1.0,
 * follow-up 0.5, lineage 1.5.
 */
function buildAndFollowUp() {
  const build = dispatch('b1', 'b1', 5, { kind: 'implementation' });
  const followUp = dispatch('f1', 'b1', 2, { kind: 'custom', followUpTo: 'b1' });
  const requests = [
    request('b1', 'b1', 'q1', 4.5, { costUsd: 0.6, inputTokens: 3000, outputTokens: 300 }),
    request('b1', 'b1', 'q2', 4, { costUsd: 0.2, inputTokens: 1000, outputTokens: 100 }),
    request('b1', 'b1', 'q3', 3, { costUsd: 0.2, inputTokens: 1000, outputTokens: 100 }),
    request('b1', 'f1', 'o1', 1, { model: OPUS, costUsd: 0.5, inputTokens: 2000, outputTokens: 50 }),
  ];
  return { rows: [build, followUp], requests, build, followUp };
}

describe('LIN-4263: a Haiku build with an Opus follow-up is two dispatches, each with its own model', () => {
  test('records posted under their own rows: two entries with their own models, tokens and USD', () => {
    const { rows, requests } = buildAndFollowUp();
    const session = sessionOf(perDispatch({ fetchedRows: rows }, requests), 'b1');
    assert.equal(session.dispatches.length, 2);
    const [build, follow] = session.dispatches;

    assert.equal(build.itemId, 'b1');
    assert.equal(build.kind, 'implementation');
    assert.equal(build.followUpTo, null);
    assert.equal(build.requests, 3);
    assert.deepEqual(build.byModel.map(m => m.model), [HAIKU]);
    close(build.costUsd, 1.0, 'build USD');
    assert.equal(build.tokens.inputTokens, 5000);
    assert.equal(build.tokens.outputTokens, 500);

    assert.equal(follow.itemId, 'f1');
    assert.equal(follow.kind, 'custom');
    assert.equal(follow.followUpTo, 'b1');
    assert.equal(follow.requests, 1);
    assert.deepEqual(follow.byModel.map(m => m.model), [OPUS]);
    close(follow.costUsd, 0.5, 'follow-up USD');
    assert.equal(follow.tokens.inputTokens, 2000);
  });

  test('the entries sum to the lineage: requests, every token field and USD (the total is unchanged)', () => {
    const { rows, requests } = buildAndFollowUp();
    const result = perDispatch({ fetchedRows: rows }, requests);
    const session = sessionOf(result, 'b1');
    // The lineage's own total is the literal sum of its prices, as before LIN-4263.
    close(session.costUsd, 1.5, 'lineage USD');
    close(result.pricedUsd, 1.5, 'pricedUsd');
    close(result.totalUsd, 1.5, 'totalUsd');
    close(session.dispatches.reduce((sum, d) => sum + d.costUsd, 0), session.costUsd, 'USD partition');
    assert.equal(session.dispatches.reduce((sum, d) => sum + d.requests, 0), session.byModel.reduce((sum, m) => sum + m.requests, 0));
    for (const field of Object.keys(session.tokens)) {
      assert.equal(session.dispatches.reduce((sum, d) => sum + d.tokens[field], 0), session.tokens[field], `tokens.${field}`);
    }
  });

  test('the lineage row keeps one row per lineage, with its tokens and byModel beside the figure', () => {
    const { rows, requests } = buildAndFollowUp();
    const session = sessionOf(perDispatch({ fetchedRows: rows }, requests), 'b1');
    assert.deepEqual(session.byModel.map(m => m.model).sort(), [HAIKU, OPUS].sort());
    for (const model of session.byModel) assert.ok(Object.keys(model).sort().join() === 'costUsd,model,requests,tokens', 'the wire shape of a byModel row');
    assert.equal(session.byModel.reduce((sum, m) => sum + m.tokens.inputTokens, 0), session.tokens.inputTokens);
  });
});

describe('LIN-4263: split rule C, a record posted late under a later row goes back to the dispatch that made it', () => {
  test('every record under the follow-up\'s itemId, the build\'s records made before the follow-up: the same two entries', () => {
    const { rows, requests } = buildAndFollowUp();
    // Posted late: the build's three Haiku requests were first seen (and so posted) under the follow-up's itemId.
    const late = requests.map(r => (r.model === HAIKU ? { ...r, itemId: 'f1' } : r));
    const result = perDispatch({ fetchedRows: rows }, late);
    const session = sessionOf(result, 'b1');
    const [build, follow] = session.dispatches;
    assert.equal(build.itemId, 'b1');
    assert.equal(build.requests, 3, 'the build keeps its three requests');
    assert.deepEqual(build.byModel.map(m => m.model), [HAIKU]);
    assert.equal(follow.itemId, 'f1');
    assert.equal(follow.requests, 1);
    assert.deepEqual(follow.byModel.map(m => m.model), [OPUS]);
    close(session.costUsd, 1.5, 'the lineage total is unchanged by where a record is posted');
  });

  test('a record posted under a row it was made before does not move when no member was dispatched by then', () => {
    // The request predates even the build's dispatch: no member qualifies, so it stays on its posting row.
    const build = dispatch('b1', 'b1', 5);
    const requests = [request('b1', 'b1', 'early', 6, { costUsd: 0.3 })];
    const session = sessionOf(perDispatch({ fetchedRows: [build] }, requests), 'b1');
    assert.equal(session.dispatches.length, 1);
    assert.equal(session.dispatches[0].requests, 1);
    close(session.dispatches[0].costUsd, 0.3);
  });
});

describe('LIN-4263: the label guard. A follow-up that is cheaper than its build never renames the lineage', () => {
  // The crafted case the real data cannot give: the BUILD is cost-dominant (an expensive Haiku build), and the Opus
  // follow-up is cheap and the LATEST record. A label that follows the last session says Opus; the true label is Haiku.
  test('an expensive Haiku build and a cheap, later Opus follow-up: the lineage stays labelled Haiku', () => {
    const build = dispatch('b1', 'b1', 5);
    const follow = dispatch('f1', 'b1', 2, { kind: 'custom', followUpTo: 'b1' });
    const requests = [
      request('b1', 'b1', 'h1', 4, { costUsd: 4 }),
      request('b1', 'b1', 'h2', 3, { costUsd: 3 }),
      request('b1', 'f1', 'o1', 1, { model: OPUS, costUsd: 0.05 }),
    ];
    const result = perDispatch({ fetchedRows: [build, follow] }, requests);
    const session = sessionOf(result, 'b1');
    assert.equal(session.model, HAIKU, 'the lineage label is the cost-dominant model, not the last session\'s');
    assert.equal(session.effort, 'high', 'effort is the latest record\'s');
    const [buildEntry, followEntry] = session.dispatches;
    assert.equal(buildEntry.byModel[0].model, HAIKU);
    assert.equal(followEntry.byModel[0].model, OPUS, 'the follow-up keeps its own model in its own entry');
  });
});

describe('LIN-4263: lineages that cannot be split carry dispatches: null, never a guessed split', () => {
  test('a snapshot-only lineage: dispatches and byModel are null, the tokens are the snapshot total', () => {
    const rows = [
      dispatch('s1', 's1', 6, { feedback: [snapshot(6, { costUsd: 0.4 })] }),
      dispatch('s2', 's1', 3, { feedback: [snapshot(3, { costUsd: 0.9 })] }),
    ];
    const session = sessionOf(perDispatch({ fetchedRows: rows }, []), 's1');
    close(session.costUsd, 0.9);
    assert.equal(session.dispatches, null);
    assert.equal(session.byModel, null);
    assert.equal(session.tokens.inputTokens, 1000, 'the cumulative snapshot total, not a split');
  });

  test('a records+snapshots lineage (an opencode delta beside records): dispatches and byModel are null', () => {
    const rows = [
      dispatch('r1', 'r1', 5, { feedback: [snapshot(5, { harness: 'opencode', model: 'openrouter/qwen-3', costUsd: 0.2 })] }),
    ];
    const requests = [request('r1', 'r1', 'c1', 4, { costUsd: 0.3 })];
    const session = sessionOf(perDispatch({ fetchedRows: rows }, requests), 'r1');
    assert.equal(session.dispatches, null);
    assert.equal(session.byModel, null);
    assert.notEqual(session.tokens, null, 'the records+snapshots total is still a figure');
  });

  test('a no-usage lineage emits the new keys as null', () => {
    const rows = [dispatch('n1', 'n1', 5)];
    const session = sessionOf(perDispatch({ fetchedRows: rows }, []), 'n1');
    assert.equal(session.telemetry, false, 'no telemetry: the read knows it; the route strips the flag from the wire');
    assert.equal(session.costUsd, null);
    assert.equal(session.tokens, null);
    assert.equal(session.byModel, null);
    assert.equal(session.dispatches, null);
  });

  test('an unreadable lineage emits the new keys as null', () => {
    const rows = [dispatch('u1', 'u1', 5, { feedback: [{ kind: 'usage', timestamp: at(4), message: '[usage] {not json' }] })];
    const session = sessionOf(perDispatch({ fetchedRows: rows }, []), 'u1');
    assert.equal(session.costUsd, null);
    assert.equal(session.tokens, null);
    assert.equal(session.byModel, null);
    assert.equal(session.dispatches, null);
  });
});

describe('LIN-4263: a dispatch with no records, and a dispatch the fetch did not return', () => {
  test('a follow-up that posted no records reads requests 0, and null money, tokens and byModel', () => {
    const build = dispatch('b1', 'b1', 5);
    const follow = dispatch('f1', 'b1', 2, { kind: 'custom', followUpTo: 'b1' });
    const requests = [request('b1', 'b1', 'q1', 4, { costUsd: 0.7 })];
    const session = sessionOf(perDispatch({ fetchedRows: [build, follow] }, requests), 'b1');
    const followEntry = session.dispatches[1];
    assert.equal(followEntry.itemId, 'f1');
    assert.equal(followEntry.requests, 0);
    assert.equal(followEntry.costUsd, null);
    assert.equal(followEntry.tokens, null);
    assert.equal(followEntry.byModel, null);
    assert.equal(followEntry.followUpTo, 'b1');
    close(session.dispatches[0].costUsd, 0.7);
  });

  test('a true member the fetch did not return is still an entry, with the followUpTo its identity row carries', () => {
    const build = dispatch('b1', 'b1', 5);
    // The follow-up is out of the fetch but is a true member (identity), and its records are the lineage's.
    const identity = [
      { _id: 'b1', rootItemId: 'b1', status: 'taken', kind: 'implementation', issueIdentifier: 'LIN-4263', dispatchedAt: at(5) },
      { _id: 'f1', rootItemId: 'b1', status: 'taken', kind: 'custom', issueIdentifier: 'LIN-4263', dispatchedAt: at(2), followUpTo: 'b1' },
    ];
    const requests = [
      request('b1', 'b1', 'q1', 4, { costUsd: 0.6 }),
      request('b1', 'f1', 'o1', 1, { model: OPUS, costUsd: 0.5 }),
    ];
    const session = sessionOf(perDispatch({ fetchedRows: [build], identityRows: identity }, requests), 'b1');
    assert.equal(session.dispatches.length, 2);
    const followEntry = session.dispatches.find(d => d.itemId === 'f1');
    assert.equal(followEntry.followUpTo, 'b1');
    assert.equal(followEntry.requests, 1);
    close(followEntry.costUsd, 0.5);
    close(session.costUsd, 1.1, 'the lineage total includes the out-of-window follow-up\'s records');
  });
});

describe('LIN-4263: only the /cost read builds dispatches, and the other figures do not depend on it', () => {
  test('without perDispatch, dispatches is null and every other figure is identical', () => {
    const { rows, requests } = buildAndFollowUp();
    const withSplit = perDispatch({ fetchedRows: rows }, requests);
    const withoutSplit = readCostOverRecords({ fetchedRows: rows }, requests);
    assert.equal(sessionOf(withoutSplit, 'b1').dispatches, null);
    assert.deepEqual(
      withoutSplit.workerSessions.map(({ dispatches, ...rest }) => rest),
      withSplit.workerSessions.map(({ dispatches, ...rest }) => rest),
    );
    assert.equal(withoutSplit.pricedUsd, withSplit.pricedUsd);
    assert.equal(withoutSplit.totalUsd, withSplit.totalUsd);
  });

  test('the additive keys sit after durationMs, so the wire order of the existing keys is unchanged', () => {
    const { rows, requests } = buildAndFollowUp();
    const keys = Object.keys(sessionOf(perDispatch({ fetchedRows: rows }, requests), 'b1'));
    const at2 = keys.indexOf('durationMs');
    assert.deepEqual(keys.slice(0, at2 + 1), ['rootItemId', 'kind', 'dispatchedAt', 'harness', 'model', 'effort', 'costUsd', 'durationMs']);
    assert.deepEqual(keys.slice(at2 + 1, at2 + 4), ['tokens', 'byModel', 'dispatches']);
  });
});

describe('LIN-4263: the fold gives each model its own tokens', () => {
  test('byModel tokens sum to the fold\'s tokens, per model', () => {
    const records = [
      { rootItemId: 'x', itemId: 'x', requestId: 'a', at: at(3), updatedAt: at(3), harness: 'claude-code', model: HAIKU, effort: 'high', inputTokens: 100, outputTokens: 10, costUsd: 0.1 },
      { rootItemId: 'x', itemId: 'x', requestId: 'b', at: at(2), updatedAt: at(2), harness: 'claude-code', model: OPUS, effort: 'high', inputTokens: 300, outputTokens: 30, costUsd: 0.3 },
      { rootItemId: 'x', itemId: 'x', requestId: 'c', at: at(1), updatedAt: at(1), harness: 'claude-code', model: HAIKU, effort: 'high', inputTokens: 200, outputTokens: 20, costUsd: 0.2 },
    ];
    const fold = foldRequestUsage(records);
    const haiku = fold.byModel.find(m => m.model === HAIKU);
    const opus = fold.byModel.find(m => m.model === OPUS);
    assert.equal(haiku.tokens.inputTokens, 300);
    assert.equal(opus.tokens.inputTokens, 300);
    assert.equal(haiku.tokens.inputTokens + opus.tokens.inputTokens, fold.tokens.inputTokens);
    assert.equal(haiku.tokens.outputTokens + opus.tokens.outputTokens, fold.tokens.outputTokens);
  });
});
