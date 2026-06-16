// LIN-513: resolveWorkspaceModel is the single model-selection seam every billed
// LLM call site shares. Free-tier requests must NEVER bill an arbitrary
// workspace-preferred model against the operator's shared free-tier key, so the
// clamp lives here: when `forceDefault` (threaded from each caller's already-computed
// `isFreeTier`) is truthy, the function returns DEFAULT_MODEL before any prefs lookup.
// Non-free-tier callers omit the flag and keep honoring the workspace preference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceModel } from '../../lib/workspace-preferences.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';

// A store stub whose getWorkspacePreferences both returns a stored preference AND
// records that it was consulted — so we can assert the clamp short-circuits BEFORE
// the prefs lookup (fails closed), not merely that it returns the default.
function makeStore(modelId) {
  const calls = [];
  return {
    calls,
    getWorkspacePreferences: async (urlKey) => {
      calls.push(urlKey);
      return modelId ? { modelId } : {};
    }
  };
}

test('non-free-tier (forceDefault omitted): honors the stored workspace preference', async () => {
  const store = makeStore('anthropic/claude-opus-4');
  const model = await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store });
  assert.equal(model, 'anthropic/claude-opus-4');
  assert.deepEqual(store.calls, ['acme']); // prefs WERE consulted
});

test('non-free-tier with no stored preference: falls back to DEFAULT_MODEL', async () => {
  const store = makeStore(null);
  const model = await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store });
  assert.equal(model, DEFAULT_MODEL);
});

test('non-free-tier with forceDefault:false is byte-identical to omitting the flag', async () => {
  const store = makeStore('anthropic/claude-opus-4');
  const model = await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store, forceDefault: false });
  assert.equal(model, 'anthropic/claude-opus-4');
  assert.deepEqual(store.calls, ['acme']);
});

test('free-tier (forceDefault:true): clamps to DEFAULT_MODEL even when a non-default preference is stored', async () => {
  const store = makeStore('anthropic/claude-opus-4');
  const model = await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store, forceDefault: true });
  assert.equal(model, DEFAULT_MODEL);
});

test('free-tier clamp fails closed: the prefs lookup is never reached', async () => {
  const store = makeStore('anthropic/claude-opus-4');
  await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store, forceDefault: true });
  assert.deepEqual(store.calls, []); // short-circuited BEFORE consulting workspace prefs
});

test('missing urlKey or store still returns DEFAULT_MODEL (unchanged guard)', async () => {
  assert.equal(await resolveWorkspaceModel({ urlKey: null, workspacePreferencesStore: makeStore('x') }), DEFAULT_MODEL);
  assert.equal(await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: null }), DEFAULT_MODEL);
});
