// LIN-1333: OPENROUTER_FREE_TIER_MODEL lets an operator move the model that
// free-tier requests are clamped to, per environment, without moving DEFAULT_MODEL
// for every workspace that has no stored preference.
//
// resolveFreeTierModel is the pure resolver behind that; the clamp seam itself
// (resolveWorkspaceModel / resolveAiOperationModel) is covered in
// workspace-model-clamp.test.js. The load-bearing property here is FAIL CLOSED:
// free-tier calls bill against the operator's shared OPENROUTER_FREE_TIER_KEY, so an
// uncurated value must degrade to DEFAULT_MODEL rather than reach OpenRouter — the
// env var must not become the one path that bypasses the allowlist (FREE_TIER_MODEL_IDS) that
// resolveRoadmapModelOverride already enforces on the per-request override path.
//
// getFreeTierModelConfigWarning is the counterpart: because the resolver fails
// closed *silently*, a typo would otherwise be invisible to the operator who set it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFreeTierModel, getFreeTierModelConfigWarning, DEFAULT_MODEL, FREE_TIER_MODEL_IDS, SUGGESTED_MODEL_IDS } from '../../lib/openrouter.js';

// A curated non-default id — the whole point of the feature.
const CURATED = FREE_TIER_MODEL_IDS.find(id => id !== DEFAULT_MODEL);

// Set/restore the var around one assertion body. The resolver reads process.env per
// call (rather than at module load) precisely so this works without re-importing.
function withEnv(value, fn) {
  const saved = process.env.OPENROUTER_FREE_TIER_MODEL;
  if (value === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL;
  else process.env.OPENROUTER_FREE_TIER_MODEL = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL;
    else process.env.OPENROUTER_FREE_TIER_MODEL = saved;
  }
}

test('sanity: a curated non-default model exists to point the free tier at', () => {
  assert.ok(CURATED, 'FREE_TIER_MODEL_IDS must allow at least one non-default model');
});

// --- resolveFreeTierModel ---------------------------------------------------

test('unset: falls back to DEFAULT_MODEL (5.4-mini stays the fallback)', () => {
  withEnv(undefined, () => assert.equal(resolveFreeTierModel(), DEFAULT_MODEL));
});

test('valid curated id: honored', () => {
  withEnv(CURATED, () => assert.equal(resolveFreeTierModel(), CURATED));
});

test('every allowlisted id is accepted (the allow-list is FREE_TIER_MODEL_IDS)', () => {
  for (const id of FREE_TIER_MODEL_IDS) {
    withEnv(id, () => assert.equal(resolveFreeTierModel(), id));
  }
});

// LIN-4358: being suggested in a picker is not permission to spend the operator's key. The
// suggestions gained openai/gpt-6.1-sol and anthropic/claude-haiku-5.5; the allowlist did not,
// pending John's free-tier ruling. If this fails because a suggestion was added to the
// allowlist, that is a spending change: it needs the ruling first.
test('a model that is suggested but not allowlisted fails closed (suggesting is not allowing)', () => {
  const suggestedOnly = SUGGESTED_MODEL_IDS.filter(id => !FREE_TIER_MODEL_IDS.includes(id));
  assert.deepEqual(suggestedOnly, ['openai/gpt-6.1-sol', 'anthropic/claude-haiku-5.5']);
  for (const id of suggestedOnly) {
    withEnv(id, () => assert.equal(resolveFreeTierModel(), DEFAULT_MODEL));
  }
});

test('surrounding whitespace is trimmed (a copy-pasted config var still works)', () => {
  withEnv(`  ${CURATED}  `, () => assert.equal(resolveFreeTierModel(), CURATED));
});

test('uncurated id: fails closed to DEFAULT_MODEL, never passed unchecked', () => {
  withEnv('evil/undisclosed-expensive-model', () => assert.equal(resolveFreeTierModel(), DEFAULT_MODEL));
});

test('near-miss / typo id: fails closed rather than fuzzy-matching', () => {
  withEnv('openai/gpt-5.4-min', () => assert.equal(resolveFreeTierModel(), DEFAULT_MODEL));
  withEnv('gpt-5.4-mini', () => assert.equal(resolveFreeTierModel(), DEFAULT_MODEL)); // provider prefix required
});

test('empty / whitespace-only: treated as unset', () => {
  withEnv('', () => assert.equal(resolveFreeTierModel(), DEFAULT_MODEL));
  withEnv('   ', () => assert.equal(resolveFreeTierModel(), DEFAULT_MODEL));
});

// --- getFreeTierModelConfigWarning ------------------------------------------

test('warning: silent when unset, empty, or valid', () => {
  withEnv(undefined, () => assert.equal(getFreeTierModelConfigWarning(), null));
  withEnv('', () => assert.equal(getFreeTierModelConfigWarning(), null));
  withEnv('   ', () => assert.equal(getFreeTierModelConfigWarning(), null));
  withEnv(CURATED, () => assert.equal(getFreeTierModelConfigWarning(), null));
});

test('warning: names the rejected value, the model actually used, and the valid ids', () => {
  withEnv('evil/undisclosed-expensive-model', () => {
    const warning = getFreeTierModelConfigWarning();
    assert.ok(warning, 'an uncurated value must warn');
    assert.match(warning, /evil\/undisclosed-expensive-model/); // what was rejected
    assert.ok(warning.includes(DEFAULT_MODEL));                 // what is used instead
    assert.ok(warning.includes(CURATED));                       // what they could have set
  });
});

test('warning and resolver agree: a warning is emitted exactly when the value is ignored', () => {
  for (const value of [undefined, '', '  ', CURATED, DEFAULT_MODEL, 'evil/nope', 'openai/gpt-5.4-min']) {
    withEnv(value, () => {
      const ignored = resolveFreeTierModel() !== (typeof value === 'string' ? value.trim() : '');
      const warned = getFreeTierModelConfigWarning() !== null;
      // A value is "ignored" when the resolver didn't return it. Unset/empty are
      // ignored but expected, so they must NOT warn — only a non-empty reject does.
      const nonEmpty = typeof value === 'string' && value.trim() !== '';
      assert.equal(warned, ignored && nonEmpty, `mismatch for ${JSON.stringify(value)}`);
    });
  }
});
