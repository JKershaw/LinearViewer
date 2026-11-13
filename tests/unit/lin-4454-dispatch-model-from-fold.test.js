/**
 * LIN-4454 (piece 3 of LIN-4447): one rule names a dispatch's model, the cost fold's (`foldRequestUsage`,
 * lib/request-usage-fold.js): the priced model with the largest priced cost, else the latest record's model.
 *
 * The Drift case (Drift & Coherence Review, 13 Nov., row 150) as a witness. Each case is ONE dispatch, read through the
 * real `readCost({perDispatch: true})` (with a records loader) into `taskTimeline`, never a hand-built `byModel`.
 * For one dispatch, the lane (the lineage's fold) and its one row (that dispatch's fold) fold the same records, so they
 * must name the same model. This is deliberately NOT "a lane equals every row": in a multi-dispatch lineage the two
 * fold different records and can honestly differ (a cheap follow-up under an expensive build).
 *
 *  - Case 1: model A has $5 priced plus one unpriced request, model B has $1 priced: both name A.
 *  - Case 2: nothing priced: both name the latest model, even when another model has more requests.
 *  - Case 3: nothing priced and the latest record names no model: both read null (no fallback to another model).
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4454-dispatch-model-from-fold.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readCost } from '../../lib/cost-read.js';
import { taskTimeline } from '../../lib/task-timeline.js';
import { loaderOver } from '../fixtures/request-usage-loader.js';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 8, 12);
const atMin = m => new Date(T0 + m * MIN).toISOString();

// A is a model the rate table does not know: a request priced only by its native `costUsd`, and unpriced without one.
const MODEL_A = 'claude-unrated-a';
const MODEL_B = 'claude-haiku-5-5';
const URL_KEY = 'acme';

const row = { _id: 'b1', id: 'b1', rootItemId: 'b1', issueIdentifier: 'LIN-1', kind: 'implementation', status: 'taken', dispatchedAt: atMin(0), feedback: [] };

/** One request record of the one dispatch. `costUsd` undefined leaves it to the rate table (unpriced for A). */
const rec = (requestId, minute, model, costUsd) => ({
  urlKey: URL_KEY, rootItemId: 'b1', itemId: 'b1', requestId, at: atMin(minute), updatedAt: atMin(100),
  harness: 'claude-code', model, effort: 'high', inputTokens: 1000, outputTokens: 100,
  cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0,
  ...(costUsd === undefined ? {} : { costUsd }),
});

/** The one lane and its one dispatch row, read the way the task page reads them. */
async function laneAndRow(records) {
  const read = await readCost({ fetchedRows: [row], requestSource: loaderOver(records), urlKey: URL_KEY, perDispatch: true });
  assert.equal(read.workerSessions.length, 1);
  assert.equal(read.workerSessions[0].dispatches.length, 1, 'the witness is one dispatch: its lane and row fold the same records');
  const tl = taskTimeline({ sessions: read.workerSessions, now: atMin(60), totalUsd: read.totalUsd, pricedUsd: read.pricedUsd });
  assert.equal(tl.lanes.length, 1);
  const [lane] = tl.lanes;
  assert.equal(lane.dispatches.length, 1);
  return { lane, row: lane.dispatches[0] };
}

describe('LIN-4454: a one-dispatch lane and its row name the fold\'s model', () => {
  test('case 1 (the Drift case): A has $5 priced plus one unpriced request, B has $1 priced: both name A', async () => {
    const { lane, row: only } = await laneAndRow([
      rec('a1', 5, MODEL_A, 5),
      rec('a2', 10, MODEL_A),
      rec('b1', 20, MODEL_B, 1),
    ]);
    assert.equal(lane.model, MODEL_A, 'the lane names the cost-dominant priced model');
    assert.equal(only.model, MODEL_A, 'the dispatch row names the same model as its lane');
  });

  test('case 2: nothing priced: both name the latest model, though another has more requests', async () => {
    const { lane, row: only } = await laneAndRow([
      rec('a1', 5, MODEL_A),
      rec('a2', 10, MODEL_A),
      rec('c1', 20, 'claude-unrated-c'),
    ]);
    assert.equal(lane.model, 'claude-unrated-c', 'the lane names the latest model');
    assert.equal(only.model, 'claude-unrated-c', 'the dispatch row names the same model as its lane');
  });

  test('case 3: nothing priced and the latest record names no model: both read null, with no fallback', async () => {
    const { lane, row: only } = await laneAndRow([
      rec('a1', 5, MODEL_A),
      rec('a2', 10, MODEL_A),
      rec('n1', 20, null),
    ]);
    assert.equal(lane.model, null);
    assert.equal(only.model, null, 'the row takes the fold\'s null, not the next model it can find');
  });
});
