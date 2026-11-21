/**
 * LIN-4524 (piece A): the per-word mutation proofs for the three retirement censuses (LIN-4495, LIN-4502, LIN-4504).
 *
 * For every word of every census, a planted file under the tests root that holds the word, with no row and not SELF,
 * is a hit that names that file and that word. A row covering exactly that file and that word clears the hit. A row
 * for another file, or for another word, does not. The real tree passes only because each real hit has its row, so
 * these proofs are what make the census catch a new one. The censuses' own planted-file tests are the same seam, run
 * over a few words each; this file runs every word.
 *
 * The samples name the retired words, so this file is SELF: its own word lists are not scanned.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { censusHits, CENSUS_WORDS, SELF } from './helpers/retirement-census.js';

const PLANTED = 'tests/unit/planted-word.test.js';
const OTHER = 'tests/unit/planted-other.test.js';

// The text that holds each word, and only that word. A word not listed here is its own sample (identifiers and
// hyphenated names). Each sample is checked against the word's RegExp before the proof runs, so a sample that drifts
// from its word fails here, not silently.
const SAMPLE = Object.freeze({
  'Retires:': 'Retires: x',
  'RETIRES_*': 'RETIRES_NONE',
  'LEFTOVER_RETIRES_': 'LEFTOVER_RETIRES_X',
  '## Waiting': '## Waiting',
  '.discharged': 'x.discharged',
  'ledgerItems / ledgerOpen': 'ledgerItems',
  '*AsAsked* symbols': 'sealAsAsked',
  'AS_ASKED_*': 'AS_ASKED_IMMUTABLE',
  'the As-asked modules': 'as-asked.js',
  'the [as-asked] log lines': '[as-asked]',
  'the write-below route': 'description/below',
  'Archive & Prune': 'Archive & Prune',
  'task snapshot symbols': 'captureTaskSnapshot',
  'the /snapshots routes': 'issues/LIN-1/snapshots',
  'the task-snapshots collection': 'task-snapshots',
  'the plan heading': 'Implementation Plan',
  'fits one session': 'fits one session',
  'needs multiple sessions': 'needs multiple sessions',
  'plan-review due': 'plan-review due',
  'file-pointer': 'file-pointer',
});

const sampleOf = (word) => SAMPLE[word] ?? word;

describe('LIN-4524 per-word mutation proofs: each census word is caught when unrowed, and cleared only by its own row', () => {
  for (const [census, words] of Object.entries(CENSUS_WORDS)) {
    for (const { word, re } of words) {
      test(`${census} "${word}": planted with no row, the census fails naming it; a row for exactly that file and word clears it`, () => {
        const sample = sampleOf(word);
        assert.match(sample, re, `the sample for "${word}" is a real hit of its own word`);
        const files = { [PLANTED]: sample };

        const unrowed = censusHits(files, words, census, [], SELF);
        assert.deepStrictEqual(unrowed.map((h) => [h.file, h.word]), [[PLANTED, word]], 'unrowed: named by file and word');

        const exact = { kind: 'record', file: PLANTED, words: [word], reason: 'the planted proof row' };
        assert.deepStrictEqual(censusHits(files, words, census, [exact], SELF), [], 'the exact row clears it');

        const otherFile = { ...exact, file: OTHER };
        assert.deepStrictEqual(
          censusHits(files, words, census, [otherFile], SELF).map((h) => [h.file, h.word]),
          [[PLANTED, word]],
          'a row for another file does not clear it',
        );

        const otherWord = words.find((w) => w.word !== word).word;
        const sibling = { ...exact, words: [otherWord] };
        assert.deepStrictEqual(
          censusHits(files, words, census, [sibling], SELF).map((h) => [h.file, h.word]),
          [[PLANTED, word]],
          'a row for another word does not clear it',
        );
      });
    }
  }

  test('a SELF file is skipped whatever it holds: the census\'s own lists are not hits', () => {
    const words = CENSUS_WORDS.LIN_4502;
    const self = { [PLANTED]: 'the census file itself' };
    assert.deepStrictEqual(censusHits({ [PLANTED]: 'sealAsAsked splitQuote' }, words, 'LIN_4502', [], self), []);
  });
});
