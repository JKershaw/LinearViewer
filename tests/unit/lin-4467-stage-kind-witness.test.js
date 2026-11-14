/**
 * LIN-4467 witness (piece 3 of LIN-4448): one record per stage kind, tables become views.
 *
 * Every stage kind renders the same text, fresh and in a fix round, with real context (a sha256 per render), and every
 * per-kind table serialises to the text the fixture holds (LIN-4470: text, not a hash, so a diff shows what changed). The fixture is captured at HEAD
 * (tests/fixtures/lin-4467-witness.json; see tests/fixtures/lin-4467-witness.js for how it is regenerated).
 * A change to a rendered text or a table is then a visible edit of that fixture, in the PR that makes it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { captureWitness, MODES } from '../fixtures/lin-4467-witness.js';
import { isRequestChangesRound } from '../../lib/prompts/revision-brief.js';

const expected = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/lin-4467-witness.json', import.meta.url)), 'utf8'));
const actual = await captureWitness();

describe('LIN-4467 — the witness context is real: a fix round is a fix round, a fresh start is not', () => {
  test('the fix context reads as a request-changes round; the fresh context does not', () => {
    assert.equal(isRequestChangesRound(MODES.fix.comments), true);
    assert.equal(isRequestChangesRound(MODES.fresh.comments), false);
  });
});

describe('LIN-4467 — every stage kind renders byte-identically, fresh and fix round, with real context', () => {
  for (const key of Object.keys(expected.renders)) {
    test(`${key} renders the witnessed text`, () => {
      assert.deepEqual(actual.renders[key], expected.renders[key], `${key}: the rendered prompt changed`);
    });
  }

  test('the set of rendered kinds is the set witnessed (no kind added or dropped without a witness)', () => {
    assert.deepEqual(Object.keys(actual.renders), Object.keys(expected.renders));
  });
});

describe('LIN-4467 — the per-kind tables serialise to the witnessed content', () => {
  for (const name of Object.keys(expected.tables)) {
    test(`${name} is unchanged`, () => {
      assert.deepEqual(actual.tables[name], expected.tables[name], `${name} changed (the fixture holds its text; see the diff)`);
    });
  }
  test('the stage labels, the step words and the stage contracts are unchanged', () => {
    assert.equal(actual.stageLabels, expected.stageLabels, 'stageLabel() for every kind changed');
    assert.equal(actual.stepWords, expected.stepWords, 'stepKindWord() for every kind changed');
    assert.equal(actual.contracts, expected.contracts, 'formatStageContract() for every kind changed');
  });
  test('the catalog override line is as witnessed', () => {
    assert.equal(actual.overrideLine, expected.overrideLine, 'the VERB OVERRIDE line changed');
  });
});
