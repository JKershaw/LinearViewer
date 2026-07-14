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
//
// LIN-1333: the value the clamp returns is now configurable via a curated
// OPENROUTER_FREE_TIER_MODEL. The precedence above is unchanged — free tier still
// ignores the workspace preference — so with the var unset every assertion below
// holds exactly as written. See the LIN-1333 section at the foot of this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceModel, resolveAiOperationModel, AI_OPERATION_KINDS } from '../../lib/workspace-preferences.js';
import { DEFAULT_MODEL, AVAILABLE_MODELS } from '../../lib/openrouter.js';

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

// =============================================================================
// OPENROUTER_FREE_TIER_MODEL — the clamped-TO value is configurable (LIN-1333)
//
// The clamp's precedence is unchanged; only what it clamps to moves. Two
// properties matter here and are easy to break: the env var must reach BOTH
// resolvers on the free-tier path, and must NOT leak onto any non-free-tier
// path — including the degenerate missing-urlKey/store guard, which shares the
// old `if` with forceDefault but is not free tier.
// =============================================================================

const CURATED = AVAILABLE_MODELS.find(m => m.id !== DEFAULT_MODEL).id;

function withFreeTierModel(value, fn) {
  const saved = process.env.OPENROUTER_FREE_TIER_MODEL;
  if (value === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL;
  else process.env.OPENROUTER_FREE_TIER_MODEL = value;
  return (async () => {
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL;
      else process.env.OPENROUTER_FREE_TIER_MODEL = saved;
    }
  })();
}

test('free-tier clamp honors a curated OPENROUTER_FREE_TIER_MODEL over a stored preference', async () => {
  await withFreeTierModel(CURATED, async () => {
    const store = makeStoreWithModel('openai/gpt-5.5-pro');
    const model = await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store, forceDefault: true });
    assert.equal(model, CURATED);
    assert.deepEqual(store.calls, []); // still fails closed before the prefs lookup
  });
});

test('free-tier clamp honors the env var for every AI operation kind', async () => {
  await withFreeTierModel(CURATED, async () => {
    const store = makeStore({ modelId: 'openai/gpt-5.5', aiModelOverrides: { byKind: { recommend: { model: 'openai/gpt-5.5-pro' } } } });
    for (const opKind of AI_OPERATION_KINDS) {
      assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind, forceDefault: true }), CURATED);
    }
    assert.deepEqual(store.calls, []);
  });
});

test('an uncurated OPENROUTER_FREE_TIER_MODEL is ignored: the clamp stays on DEFAULT_MODEL', async () => {
  await withFreeTierModel('evil/undisclosed-expensive-model', async () => {
    const store = makeStoreWithModel('openai/gpt-5.5');
    assert.equal(await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store, forceDefault: true }), DEFAULT_MODEL);
    assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recommend', forceDefault: true }), DEFAULT_MODEL);
  });
});

test('OPENROUTER_FREE_TIER_MODEL does NOT leak onto the non-free-tier path', async () => {
  await withFreeTierModel(CURATED, async () => {
    const store = makeStoreWithModel('openai/gpt-5.5');
    // Paid/OAuth callers keep honoring the workspace preference.
    assert.equal(await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store }), 'openai/gpt-5.5');
    assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: makeStore({ modelId: 'openai/gpt-5.5' }), opKind: 'recommend' }), 'openai/gpt-5.5');
  });
});

test('OPENROUTER_FREE_TIER_MODEL does NOT leak onto the missing-urlKey/store guard', async () => {
  // That guard shares the original `if` with forceDefault but is NOT free tier —
  // it just cannot resolve a preference, so it must stay on DEFAULT_MODEL.
  await withFreeTierModel(CURATED, async () => {
    assert.equal(await resolveWorkspaceModel({ urlKey: null, workspacePreferencesStore: makeStoreWithModel('x') }), DEFAULT_MODEL);
    assert.equal(await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: null }), DEFAULT_MODEL);
    assert.equal(await resolveAiOperationModel({ urlKey: null, workspacePreferencesStore: makeStore({ modelId: 'x' }), opKind: 'recommend' }), DEFAULT_MODEL);
    assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: null, opKind: 'recommend' }), DEFAULT_MODEL);
  });
});

test('with the env var unset, the clamp is byte-identical to pre-LIN-1333 behavior', async () => {
  await withFreeTierModel(undefined, async () => {
    const store = makeStoreWithModel('openai/gpt-5.5');
    assert.equal(await resolveWorkspaceModel({ urlKey: 'acme', workspacePreferencesStore: store, forceDefault: true }), DEFAULT_MODEL);
    assert.equal(await resolveAiOperationModel({ urlKey: 'acme', workspacePreferencesStore: store, opKind: 'recap', forceDefault: true }), DEFAULT_MODEL);
  });
});
