// LIN-513: resolveWorkspaceModel is the single model-selection seam every billed
// LLM call site shares. Free-tier requests must NEVER bill an arbitrary
// workspace-preferred model against the operator's shared free-tier key, so the
// clamp lives here: when `forceDefault` (threaded from each caller's already-computed
// `isFreeTier`) is truthy, the function returns DEFAULT_MODEL before any prefs lookup.
// Non-free-tier callers omit the flag and keep honoring the workspace preference.
//
// LIN-1145: resolveAiOperationModel extends this with per-operation override
// resolution (byKind[opKind].model ?? modelId ?? DEFAULT_MODEL) while preserving
// the same free-tier clamp contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceModel, resolveAiOperationModel, AI_OPERATION_KINDS } from '../../lib/workspace-preferences.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';

// A store stub whose getWorkspacePreferences both returns a stored preference AND
// records that it was consulted — so we can assert the clamp short-circuits BEFORE
// the prefs lookup (fails closed), not merely that it returns the default.
function makeStore(prefs = {}) {
  const calls = [];
  return {
    calls,
    getWorkspacePreferences: async (urlKey) => {
      calls.push(urlKey);
      return prefs;
    }
  };
}

function makeStoreWithModel(modelId) {
  return makeStore(modelId ? { modelId } : {});
}

// =============================================================================
// resolveWorkspaceModel (existing, unchanged)
// =============================================================================

test('non-free-tier (forceDefault omitted): honors the stored workspace preference', async () => {
  const store = makeStoreWithModel('anthropic/claude-opus-4');
  const model = await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store });
  assert.equal(model, 'anthropic/claude-opus-4');
  assert.deepEqual(store.calls, ['acme']); // prefs WERE consulted
});

test('non-free-tier with no stored preference: falls back to DEFAULT_MODEL', async () => {
  const store = makeStoreWithModel(null);
  const model = await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store });
  assert.equal(model, DEFAULT_MODEL);
});

test('non-free-tier with forceDefault:false is byte-identical to omitting the flag', async () => {
  const store = makeStoreWithModel('anthropic/claude-opus-4');
  const model = await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store, forceDefault: false });
  assert.equal(model, 'anthropic/claude-opus-4');
  assert.deepEqual(store.calls, ['acme']);
});

test('free-tier (forceDefault:true): clamps to DEFAULT_MODEL even when a non-default preference is stored', async () => {
  const store = makeStoreWithModel('anthropic/claude-opus-4');
  const model = await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store, forceDefault: true });
  assert.equal(model, DEFAULT_MODEL);
});

test('free-tier clamp fails closed: the prefs lookup is never reached', async () => {
  const store = makeStoreWithModel('anthropic/claude-opus-4');
  await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store, forceDefault: true });
  assert.deepEqual(store.calls, []); // short-circuited BEFORE consulting workspace prefs
});

test('missing urlKey or store still returns DEFAULT_MODEL (unchanged guard)', async () => {
  assert.equal(await resolveWorkspaceModel({ urlKey: null, workspacePreferencesStore: makeStoreWithModel('x') }), DEFAULT_MODEL);
  assert.equal(await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: null }), DEFAULT_MODEL);
});

// =============================================================================
// resolveAiOperationModel (LIN-1145)
// =============================================================================

test('AI_OPERATION_KINDS covers the 6 scoped v1 operations', () => {
  assert.deepEqual(AI_OPERATION_KINDS, ['recommend', 'recap', 'brief', 'run-summary', 'session-summary', 'next-run']);
});

test('resolveAiOperationModel: no overrides → falls back to modelId → DEFAULT_MODEL', async () => {
  const store = makeStore({ modelId: 'openai/gpt-5.5' });
  const model = await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recommend' });
  assert.equal(model, 'openai/gpt-5.5');
});

test('resolveAiOperationModel: per-operation override takes precedence over modelId', async () => {
  const store = makeStore({ modelId: 'openai/gpt-5.4-mini', aiModelOverrides: { byKind: { recommend: { model: 'openai/gpt-5.5' } } } });
  const model = await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recommend' });
  assert.equal(model, 'openai/gpt-5.5');
});

test('resolveAiOperationModel: other operation kind uses modelId when no override set', async () => {
  const store = makeStore({ modelId: 'openai/gpt-5.5', aiModelOverrides: { byKind: { recommend: { model: 'anthropic/claude-opus-4' } } } });
  const model = await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recap' });
  assert.equal(model, 'openai/gpt-5.5');
});

test('resolveAiOperationModel: override=null for one kind does not affect another', async () => {
  const store = makeStore({ modelId: 'openai/gpt-5.5', aiModelOverrides: { byKind: { recommend: { model: 'openai/gpt-5.5-pro' }, recap: { model: null } } } });
  const recModel = await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recap' });
  assert.equal(recModel, 'openai/gpt-5.5');
});

test('resolveAiOperationModel: falls to DEFAULT_MODEL when nothing is stored', async () => {
  const store = makeStore({});
  const model = await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'brief' });
  assert.equal(model, DEFAULT_MODEL);
});

test('resolveAiOperationModel: forceDefault clamps every operation to DEFAULT_MODEL', async () => {
  const store = makeStore({ modelId: 'openai/gpt-5.5', aiModelOverrides: { byKind: { recommend: { model: 'openai/gpt-5.5-pro' } } } });
  const model = await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recommend', forceDefault: true });
  assert.equal(model, DEFAULT_MODEL);
});

test('resolveAiOperationModel: forceDefault short-circuits before prefs lookup', async () => {
  const store = makeStore({ modelId: 'openai/gpt-5.5', aiModelOverrides: { byKind: { recommend: { model: 'openai/gpt-5.5-pro' } } } });
  await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recommend', forceDefault: true });
  assert.deepEqual(store.calls, []);
});

test('resolveAiOperationModel: missing urlKey or store returns DEFAULT_MODEL', async () => {
  assert.equal(await resolveAiOperationModel({ urlKey: null, workspacePreferencesStore: makeStore({ modelId: 'x' }), opKind: 'recommend' }), DEFAULT_MODEL);
  assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: null, opKind: 'recommend' }), DEFAULT_MODEL);
});

test('resolveAiOperationModel: each of the 6 operation kinds resolves independently', async () => {
  const store = makeStore({
    modelId: 'openai/gpt-5.4-mini',
    aiModelOverrides: {
      byKind: {
        recommend: { model: 'openai/gpt-5.5-pro' },
        recap: { model: 'openai/gpt-5.5' }
      }
    }
  });
  assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recommend' }), 'openai/gpt-5.5-pro');
  assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recap' }), 'openai/gpt-5.5');
  assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'brief' }), 'openai/gpt-5.4-mini');
  assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'run-summary' }), 'openai/gpt-5.4-mini');
  assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'session-summary' }), 'openai/gpt-5.4-mini');
  assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'next-run' }), 'openai/gpt-5.4-mini');
});
