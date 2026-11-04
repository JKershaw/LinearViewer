/**
 * LIN-4201 (piece 4 of LIN-4195): the replay diff equals the change list, exactly.
 *
 * The before is tests/fixtures/cost-replay/goldens-lin4197.json (the read path with no request records; never
 * goldens.json). The after is the same replay with each corpus's request records served through the loader. The
 * differing paths (to 1e-9) must be exactly tests/fixtures/cost-replay/lin4201-change-list.json: an extra path is a
 * defect, and a listed path that stops differing is a reverted fix (the rebuild-1 lesson: a list that only allows
 * differences passes a reverted fix).
 *
 * Mixed-harness control (review note 9): asserted DIRECTLY, not left to the per-harness rule alone. mh-haiku must read
 * its oracle (Haiku records + the opencode delta), and mh-sonnet must not move at all.
 *
 * Run with: node --test tests/unit/lin-4201-replay-change-list.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { diffReplay } from '../fixtures/cost-replay/diff.js';
import { recordLin4197 } from '../fixtures/cost-replay/lin4197-replay.js';
import { LIN4197_CASES, LIN4197_MIXED_CONTROL, LIN4201_RECORDS_ONLY } from '../fixtures/cost-replay/corpus.js';

const read = async (name) => JSON.parse(await readFile(fileURLToPath(new URL(`../fixtures/cost-replay/${name}`, import.meta.url)), 'utf8'));
const { header: _header, ...before } = await read('goldens-lin4197.json');
const CHANGE_LIST = await read('lin4201-change-list.json');
const withheld = await recordLin4197();
const after = await recordLin4197({ readRecords: true });
const TOLERANCE = 1e-9;
const close = (a, b, message) => assert.ok(Math.abs(a - b) <= TOLERANCE, `${message}: ${a} vs ${b}`);

const diffPaths = diffReplay(before, after, { tolerance: TOLERANCE });
const listed = Object.values(CHANGE_LIST.items).flatMap(item => item.paths);

describe('the before: with no request records the replay is exactly the baseline', () => {
  test('every section of goldens-lin4197.json, exactly (snapshot-only reads are unchanged)', () => {
    assert.deepEqual(diffReplay(before, withheld), []);
  });
});

describe('the after: the replay diff equals the change list', () => {
  test('no path differs that the change list does not name', () => {
    const extra = diffPaths.filter(path => !listed.includes(path));
    assert.deepEqual(extra, []);
  });

  test('every path the change list names still differs (a reverted fix fails here)', () => {
    const missing = listed.filter(path => !diffPaths.includes(path));
    assert.deepEqual(missing, []);
  });

  test('each item (a) to (e) is seen to differ', () => {
    for (const [item, { paths }] of Object.entries(CHANGE_LIST.items)) assert.ok(paths.length > 0, `item (${item}) lists paths`);
  });

  test('(a) Haiku over 100k is priced on every lineage surface: S1, S5, S6, S8, S9, S10, S11, S12, S13', () => {
    const surfaces = new Set(CHANGE_LIST.items.a.paths.map(path => path.match(/\.(S\d+)\./)?.[1]).filter(Boolean));
    for (const surface of ['S1', 'S5', 'S6', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13']) assert.ok(surfaces.has(surface), `(a) on ${surface}`);
  });
});

describe('the figures each item moves to are the oracle\'s, not the code\'s own', () => {
  const caseUsd = (key) => after.cases[key].summary.readRunPageUsd;
  for (const key of ['haiku-over-100k/final', 'mixed-model/final', 'subagent-shared-message/final', 'synthetic-tail/final']) {
    test(`${key}: the run page reads the oracle ${LIN4197_CASES[key].oracleUsd}`, () => {
      close(caseUsd(key), LIN4197_CASES[key].oracleUsd, key);
      close(after.cases[key].summary.readModelsSpendUsd, LIN4197_CASES[key].oracleUsd, `${key} Models`);
    });
  }

  test('(b) the mixed-model label is the cost-dominant model', () => {
    const groups = after.cases['mixed-model/final'].replay.S6.implementation.map(group => group.id);
    assert.deepEqual(groups, ['claude-opus-5']);
  });

  test('(e) the records-only lineage reads its oracle on the run page and the issue route', () => {
    close(after.recordsOnly.summary.readRunPageUsd, LIN4201_RECORDS_ONLY.oracleUsd, 'run page');
    close(after.recordsOnly.replay.S1['LIN-42'].body.totalUsd, LIN4201_RECORDS_ONLY.oracleUsd, 'S1');
    assert.equal(after.recordsOnly.replay.S1['LIN-42'].body.noTelemetryCount, 0);
  });

  test('(e) review note 1: a record lineage is known-harness and not delta-summed on /kpis', () => {
    assert.equal(before.recordsOnly.replay.S11.unknownHarnessShare, 1);
    assert.equal(after.recordsOnly.replay.S11.unknownHarnessShare, 0);
    assert.equal(after.recordsOnly.replay.S11.opencodeSummedShare, 0);
  });
});

describe('controls: asserted unchanged', () => {
  test('the existing corpus (snapshot-only lineages, no records) does not move at all', () => {
    assert.deepEqual(diffReplay(before.existingCorpusAtHead, after.existingCorpusAtHead), []);
  });

  test('S2, S3, S4 and S7 (Harbour calls) do not move in any section', () => {
    assert.deepEqual(diffPaths.filter(path => /(^|\.)S(2|3|4|7)\./.test(path)), []);
  });

  for (const key of ['killed-before-stop/final', 'reap-tail/atStop', 'reap-tail/atReap', 'resumed-across-deploy/earlier', 'resumed-across-deploy/later']) {
    test(`single-model, tier-free, subagent-free stage ${key}: unchanged to 1e-9`, () => {
      assert.deepEqual(diffReplay(before.cases[key], after.cases[key], { tolerance: TOLERANCE }), []);
      close(after.cases[key].summary.readRunPageUsd, before.cases[key].summary.readRunPageUsd, key);
    });
  }

  test('(f) resumed across the deploy: the records read equals the oracle and counts the work once', () => {
    const key = 'resumed-across-deploy/later';
    const usd = after.cases[key].summary.readRunPageUsd;
    close(usd, LIN4197_CASES[key].oracleUsd, '(f)');
    assert.ok(usd < 1.5 * LIN4197_CASES[key].oracleUsd, `(f) is not the records plus the snapshot: ${usd}`);
  });

  test('mixed-harness control, asserted directly: mh-haiku reads its oracle, mh-sonnet does not move', () => {
    const lineages = after.mixedHarnessControl.lineages;
    close(lineages['mh-haiku'].readRunPageUsd, LIN4197_MIXED_CONTROL['mh-haiku'].oracleUsd, 'mh-haiku');
    close(lineages['mh-sonnet'].readRunPageUsd, LIN4197_MIXED_CONTROL['mh-sonnet'].oracleUsd, 'mh-sonnet');
    const sonnetPaths = diffPaths.filter(path => path.includes('mh-sonnet') || path.includes('LIN-7'));
    assert.deepEqual(sonnetPaths, []);
    // The harness disclosure shares do not move for the control: both lineages still sum an opencode delta.
    const s11 = (side) => side.mixedHarnessControl.replay.S11;
    assert.equal(s11(after).opencodeSummedShare, s11(before).opencodeSummedShare);
    assert.equal(s11(after).unknownHarnessShare, s11(before).unknownHarnessShare);
  });
});
