/**
 * LIN-4197 beat 3: the transcript corpus in Harbour's replay fixture (tests/fixtures/cost-replay/corpus.js),
 * in its two shapes: the `[usage]` snapshot rows the runner posts today, and the per-request records copied
 * from the runner's request-records.json (simple-dispatcher PR #312, commit 7a2d83c).
 *
 * What this pins, independently of the replay code (harness.js is not imported here):
 *  - each of the seven named cases exists, with the stages the runner recorded, in both shapes;
 *  - every copied record prices alone with computeUsageCostUsd (the LIN-4126 oracle method, harness 'opencode'
 *    so the running-total guard does not apply to a single request), and the sum equals the oracle figure in
 *    the fixture, and that figure is the beat-1 value;
 *  - each snapshot row's tokens are the runner's walkUsage fold of the same transcript: they equal the record
 *    sums, except the subagent stage, where the fold reads the main transcript only (see that test).
 *
 * Run with: node --test tests/unit/cost-lin4197-corpus.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeUsageCostUsd } from '../../lib/model-pricing.js';
import { LIN4197_CASES, buildLin4197Corpus } from '../fixtures/cost-replay/corpus.js';

const TOKEN_KEYS = ['inputTokens', 'outputTokens', 'cacheCreationInputTokens', 'cacheCreation1hInputTokens', 'cacheReadInputTokens'];

// The beat-1 oracle figures (LIN-4197 beat 1 report). The fixture must carry exactly these.
const BEAT1_ORACLE = {
  'haiku-over-100k/final': 0.0255,
  'subagent-shared-message/final': 0.0752,
  'mixed-model/final': 0.31726,
  'synthetic-tail/final': 0.0207,
  'killed-before-stop/final': 0.0381,
  'reap-tail/atStop': 0.0236,
  'reap-tail/atReap': 0.0317,
  'resumed-across-deploy/earlier': 0.02285,
  'resumed-across-deploy/later': 0.03945,
};

// One request priced alone, as the LIN-4126 oracle prices it (see measure.mjs: harness 'opencode').
const priceAlone = (r) => computeUsageCostUsd({
  model: r.model,
  harness: 'opencode',
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  cacheCreationInputTokens: r.cacheCreationInputTokens,
  cacheCreation1hInputTokens: r.cacheCreation1hInputTokens,
  cacheReadInputTokens: r.cacheReadInputTokens,
});

const sumOf = (rows, key) => rows.reduce((n, r) => n + r[key], 0);

describe('LIN-4197 corpus: the seven cases exist in both shapes', () => {
  test('every stage the runner recorded is present, and the figures are the beat-1 oracle', () => {
    assert.deepEqual(Object.keys(LIN4197_CASES).sort(), Object.keys(BEAT1_ORACLE).sort());
    for (const [key, figure] of Object.entries(BEAT1_ORACLE)) {
      assert.equal(LIN4197_CASES[key].oracleUsd, figure, `${key} oracle figure in the fixture`);
    }
  });

  test('buildLin4197Corpus gives one dispatch row per stage, carrying its [usage] snapshot, and its records keyed by that row', () => {
    const { rows, records } = buildLin4197Corpus();
    assert.equal(rows.length, Object.keys(LIN4197_CASES).length);
    for (const row of rows) {
      const key = row._id.replace(/^l4197:/, '');
      const usage = row.feedback.filter((f) => f.kind === 'usage');
      assert.equal(usage.length, 1, `${key} has one [usage] snapshot row`);
      const payload = JSON.parse(usage[0].message.replace(/^\[usage\] /, ''));
      assert.deepEqual(payload, LIN4197_CASES[key].snapshot, `${key} snapshot payload`);
      assert.deepEqual(records[row._id], LIN4197_CASES[key].records, `${key} records keyed by row`);
    }
  });

  test('the snapshot payload has the shape the runner posts (schema 1, claude-code, costUsd null)', () => {
    for (const [key, { snapshot }] of Object.entries(LIN4197_CASES)) {
      assert.equal(snapshot.schema, 1, key);
      assert.equal(snapshot.harness, 'claude-code', key);
      assert.equal(snapshot.costUsd, null, key);
      for (const k of TOKEN_KEYS) assert.equal(typeof snapshot[k], 'number', `${key} ${k}`);
    }
  });
});

describe('LIN-4197 corpus: the copied records sum to the oracle, priced alone, independently of the replay', () => {
  for (const [key, { records, oracleUsd }] of Object.entries(LIN4197_CASES)) {
    test(`${key}: each record prices (none unpriced) and the sum equals ${oracleUsd}`, () => {
      const prices = records.map(priceAlone);
      assert.ok(prices.every((p) => p !== null), `every record is priced: ${JSON.stringify(prices)}`);
      const total = prices.reduce((n, p) => n + p, 0);
      assert.ok(Math.abs(total - oracleUsd) < 1e-9, `${key}: priced sum ${total} vs oracle ${oracleUsd}`);
    });
  }

  test('no record id repeats within a stage (a shared message id is one request)', () => {
    for (const [key, { records }] of Object.entries(LIN4197_CASES)) {
      const ids = records.map((r) => r.requestId);
      assert.equal(new Set(ids).size, ids.length, key);
    }
  });
});

describe('LIN-4197 corpus: each snapshot row is the walkUsage fold of the same transcript', () => {
  test('for every stage except the subagent case, the snapshot tokens equal the record sums', () => {
    for (const [key, { snapshot, records }] of Object.entries(LIN4197_CASES)) {
      if (key.startsWith('subagent-shared-message')) continue;
      for (const k of TOKEN_KEYS) {
        assert.equal(snapshot[k], sumOf(records, k), `${key} ${k}`);
      }
    }
  });

  test('subagent stage: the snapshot reads the MAIN transcript only, so it omits the subagent-only requests', () => {
    const { snapshot, records } = LIN4197_CASES['subagent-shared-message/final'];
    const main = records.filter((r) => r.agent === 'main');
    assert.equal(snapshot.inputTokens, sumOf(main, 'inputTokens'), 'input: main records');
    assert.equal(snapshot.cacheReadInputTokens, sumOf(main, 'cacheReadInputTokens'), 'cache read: main records');
    // The main copy of the shared request carries output 50; the subagent copy (120) is not in the main file.
    assert.equal(snapshot.outputTokens, 660, 'output: 400 + 50 + 210 from the main file alone');
    assert.ok(snapshot.outputTokens < sumOf(records, 'outputTokens'), 'the subagent requests are missing from the snapshot');
  });
});
