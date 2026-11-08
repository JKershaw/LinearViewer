/**
 * LIN-4197 beat 4: the read path's recorded baseline over the transcript corpus, and the mixed-harness control.
 *
 * (1) The sibling goldens (tests/fixtures/cost-replay/goldens-lin4197.json) equal a live recording: the existing
 *     corpus at HEAD, each LIN-4197 stage run on its own through the same runReplay, and the control. The
 *     diff names the path that moved, so a failure reads as a path, not a blob.
 * (2) MIXED-HARNESS CONTROL (review note 9 on LIN-4195, comment eedab867). One lineage holds a claude-code
 *     `[usage]` snapshot (today's shape) AND an opencode delta row, with the claude-code transcript's request
 *     records beside it. The assertions below PIN WHAT THE CURRENT READ PATH DOES with that lineage. Piece 4's
 *     choice (how the two coexist once records exist: records win, or per-harness scoping) must be deliberate,
 *     so changing any assertion in this block is a reviewed change to the cutover, not a test fix.
 *
 * Run with: node --test tests/unit/cost-lin4197-replay.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runReplay } from '../fixtures/cost-replay/harness.js';
import { diffReplay } from '../fixtures/cost-replay/diff.js';
import { recordLin4197 } from '../fixtures/cost-replay/lin4197-replay.js';
import { LIN4197_CASES, LIN4197_MIXED_CONTROL, buildMixedHarnessControl } from '../fixtures/cost-replay/corpus.js';
import { computeUsageCostUsd } from '../../lib/model-pricing.js';
import { seedPinnedCatalog } from './helpers/pinned-catalog.js';

// LIN-4358: rates and names come from the catalog; price from the pinned 8 Nov 2026 snapshot.
seedPinnedCatalog();

const SIBLING = fileURLToPath(new URL('../fixtures/cost-replay/goldens-lin4197.json', import.meta.url));
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`);

// One record priced alone, as the LIN-4126 oracle prices it (harness 'opencode': no running-total guard).
const priceAlone = (r) => computeUsageCostUsd({
  model: r.model,
  harness: 'opencode',
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  cacheCreationInputTokens: r.cacheCreationInputTokens,
  cacheCreation1hInputTokens: r.cacheCreation1hInputTokens,
  cacheReadInputTokens: r.cacheReadInputTokens,
});

const golden = JSON.parse(await readFile(SIBLING, 'utf8'));
const live = await recordLin4197();

describe('LIN-4197 sibling goldens equal a live recording', () => {
  test('the existing corpus at HEAD is recorded and matches the live replay', () => {
    assert.deepEqual(diffReplay(golden.existingCorpusAtHead, live.existingCorpusAtHead), []);
  });

  test('each LIN-4197 stage matches its recorded golden (replay, summary, note and oracle)', () => {
    assert.deepEqual(Object.keys(golden.cases).sort(), Object.keys(live.cases).sort());
    for (const key of Object.keys(live.cases)) {
      assert.deepEqual(diffReplay(golden.cases[key], live.cases[key]), [], `${key}`);
    }
  });

  test('the mixed-harness control matches its recorded golden', () => {
    assert.deepEqual(diffReplay(golden.mixedHarnessControl, live.mixedHarnessControl), []);
  });

  test('LIN-4201: the records-only lineage (change list item (e)) matches its recorded golden, recorded at eb44eff9', () => {
    assert.deepEqual(diffReplay(golden.recordsOnly, live.recordsOnly), []);
  });

  test('every recorded case carries the oracle figure from the fixture', () => {
    for (const key of Object.keys(LIN4197_CASES)) {
      assert.equal(golden.cases[key].oracleUsd, LIN4197_CASES[key].oracleUsd, key);
      assert.equal(golden.cases[key].summary.oracleUsd, LIN4197_CASES[key].oracleUsd, `${key} summary`);
    }
  });
});

describe('LIN-4197 mixed-harness control: the control\'s oracle is the records priced alone plus the native delta', () => {
  test('each control oracle equals its claude-code records priced alone plus the opencode delta', () => {
    const recordsByLineage = {
      'mh-haiku': LIN4197_CASES['haiku-over-100k/final'].records,
      'mh-sonnet': LIN4197_CASES['resumed-across-deploy/later'].records,
    };
    for (const [root, oracle] of Object.entries(LIN4197_MIXED_CONTROL)) {
      const prices = recordsByLineage[root].map(priceAlone);
      assert.ok(prices.every((p) => p !== null), `${root}: every record is priced`);
      const claudeCode = prices.reduce((n, p) => n + p, 0);
      close(claudeCode, oracle.claudeCodeOracleUsd, `${root} claude-code oracle`);
      close(oracle.opencodeUsd + claudeCode, oracle.oracleUsd, `${root} oracle sum`);
    }
  });
});

// LIN-4201: these pins are the BEFORE (the replay with no request records, `recordLin4197()`), kept as they were. The
// after, with records read, is asserted in tests/unit/lin-4201-replay-change-list.test.js (mh-haiku reads its oracle,
// mh-sonnet does not move) and in the last test of this block.
describe('LIN-4197 mixed-harness control: what the read path does WITHOUT request records (the before; pinned)', () => {
  const control = live.mixedHarnessControl.replay;
  const step = (root) => control.S13.steps.find((s) => s.lineageId === root);

  test('mh-sonnet: a Sonnet claude-code snapshot and an opencode delta are both priced and summed, equal to the oracle', () => {
    // The snapshot is a running total with no tier, so its price is linear; the delta counts once. Nothing is
    // dropped and nothing is counted twice: 0.03945 (the snapshot) + 0.25 (the delta) = 0.28945.
    assert.equal(step('mh-sonnet').cost.status, 'priced');
    close(step('mh-sonnet').cost.usd, 0.28945, 'mh-sonnet run page');
    close(step('mh-sonnet').cost.usd, LIN4197_MIXED_CONTROL['mh-sonnet'].oracleUsd, 'mh-sonnet equals its oracle');
  });

  test('mh-haiku: the claude-code side is Haiku over 100k, so the snapshot is unpriced and the WHOLE lineage is withheld, opencode delta included', () => {
    // The claude-code snapshot is a running total past the 100k tier, so it prices to null. The fold then
    // withholds the lineage ("never partial"), so the $0.25 opencode delta is not shown either. The oracle is
    // 0.2755; the read path shows no figure for the lineage.
    assert.equal(step('mh-haiku').cost.status, 'not-reported');
    assert.equal(step('mh-haiku').cost.usd, null);
    // The Harbour workspace totals (S1 for the issue) price nothing for this lineage: pricedUsd 0, totalUsd null,
    // and the unpriced model is named.
    const s1 = control.S1['LIN-6'].body;
    assert.equal(s1.pricedUsd, 0, 'LIN-6 pricedUsd');
    assert.equal(s1.totalUsd, null, 'LIN-6 totalUsd');
    assert.deepEqual(s1.unpriced, ['claude-haiku-5-5'], 'LIN-6 unpriced models');
  });

  test('the Models read (S5) counts both lineages but prices only the Sonnet one: the $0.25 opencode delta of mh-haiku is not in spend', () => {
    const impl = control.S5.jobs.find((j) => j.id === 'implementation');
    assert.equal(impl.runs, 2);
    assert.equal(impl.priced, 1);
    assert.equal(impl.unpriced, 1);
    close(impl.spendUsd, 0.28945, 'Models spend is the Sonnet lineage only');
  });

  test('both lineages are listed as mixed-harness in the window tally', () => {
    assert.deepEqual(control.mixedHarness.lineages, ['mh-haiku', 'mh-sonnet']);
  });

  test('LIN-4201 (the flip piece 0 asked for): the records are read once served, so removing them changes the replay', async () => {
    // Before LIN-4201 no store served request records and this test asserted that removing them changed nothing.
    // The cutover reads them: served (`readRecords`), the control differs from its records-free run, and the
    // records-free run is still exactly the pinned before.
    const withRecords = buildMixedHarnessControl();
    const withoutRecords = { ...withRecords };
    delete withoutRecords.requestRecords;
    assert.ok(withRecords.requestRecords, 'the control carries records');
    assert.deepEqual(await runReplay(withoutRecords), control);
    assert.deepEqual(await runReplay(withoutRecords, { readRecords: true }), control, 'no records to serve: unchanged');
    const read = await runReplay(withRecords, { readRecords: true });
    assert.notDeepEqual(read, control);
    const step = read.S13.steps.find((s) => s.lineageId === 'mh-haiku');
    close(step.cost.usd, LIN4197_MIXED_CONTROL['mh-haiku'].oracleUsd, 'mh-haiku with records read');
  });
});
