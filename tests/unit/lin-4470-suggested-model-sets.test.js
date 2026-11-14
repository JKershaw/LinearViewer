/**
 * LIN-4470 (piece 6 of LIN-4448): the two hand lists of suggested models agree in membership.
 *
 * SUGGESTED_MODEL_IDS (lib/openrouter.js) is the Workspace AI model selector's list and the cold-catalog fallback;
 * DISPATCH_MODEL_SUGGESTIONS (lib/model-routing-harnesses.js) is the dispatch picker's list for OpenCode. Their docstrings
 * call them separate, and their ORDER is each list's own choice (which model a picker offers first), so this test
 * does not compare arrays. It compares sets, because the two lists were extended together (LIN-4358) and a suggestion
 * added to one picker and not the other would be an unrecorded decision: a model is suggested for both or for neither,
 * and a later divergence has to be written here, on purpose. Each id is held to the catalog by catalog-model-facts.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SUGGESTED_MODEL_IDS } from '../../lib/openrouter.js';
import { DISPATCH_MODEL_SUGGESTIONS } from '../../lib/model-routing-harnesses.js';

describe('LIN-4470 — the suggested-model lists agree in membership, not order', () => {
  test('SUGGESTED_MODEL_IDS and DISPATCH_MODEL_SUGGESTIONS hold the same ids', () => {
    assert.deepEqual(
      [...new Set(DISPATCH_MODEL_SUGGESTIONS)].sort(),
      [...new Set(SUGGESTED_MODEL_IDS)].sort(),
      'a model suggested in one picker must be suggested in the other (order may differ)',
    );
  });

  test('neither list repeats an id', () => {
    assert.equal(new Set(SUGGESTED_MODEL_IDS).size, SUGGESTED_MODEL_IDS.length);
    assert.equal(new Set(DISPATCH_MODEL_SUGGESTIONS).size, DISPATCH_MODEL_SUGGESTIONS.length);
  });
});
