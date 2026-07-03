// LIN-512: resolveProxyLLM is the single key-resolution seam the six proxy LLM
// endpoints share. It decides which OpenRouter key a generation uses and whether
// the request is a free-tier request (which drives both the 503 gate widening and
// the tryUse metering). These tests pin the three-way precedence: session OAuth
// key > server env key > free-tier key, and that free tier engages ONLY when it is
// the sole configured key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProxyLLM } from '../../routes/proxy.js';

// Snapshot + restore the two env keys around each scenario so tests don't leak.
function withEnv({ envKey, freeKey }, fn) {
  const prevEnv = process.env.OPENROUTER_API_KEY;
  const prevFree = process.env.OPENROUTER_FREE_TIER_KEY;
  if (envKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = envKey;
  if (freeKey === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY;
  else process.env.OPENROUTER_FREE_TIER_KEY = freeKey;
  try {
    fn();
  } finally {
    if (prevEnv === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevEnv;
    if (prevFree === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY;
    else process.env.OPENROUTER_FREE_TIER_KEY = prevFree;
  }
}

test('session OAuth key wins — never free tier, even when free-tier key is set', () => {
  withEnv({ envKey: undefined, freeKey: 'free_xxx' }, () => {
    assert.deepEqual(resolveProxyLLM('sess_abc'), { apiKey: 'sess_abc', isFreeTier: false });
  });
  // and even when the env key is also present
  withEnv({ envKey: 'env_yyy', freeKey: 'free_xxx' }, () => {
    assert.deepEqual(resolveProxyLLM('sess_abc'), { apiKey: 'sess_abc', isFreeTier: false });
  });
});

test('env-key path: apiKey is the trimmed paid env key (not free tier)', () => {
  // LIN-961: resolveProxyLLM now returns getPaidEnvKey() explicitly on the env
  // path (previously left undefined and relied on a downstream fallback). For a
  // clean key the value is identical, and `options.apiKey || getPaidEnvKey()` in
  // openrouter.js resolves to the same key either way — but returning it here
  // means a blank/whitespace value can never be forwarded as a bogus auth header.
  withEnv({ envKey: 'env_yyy', freeKey: undefined }, () => {
    assert.deepEqual(resolveProxyLLM(null), { apiKey: 'env_yyy', isFreeTier: false });
  });
  // env key present AND free key present → env still wins, free tier stays off
  withEnv({ envKey: 'env_yyy', freeKey: 'free_xxx' }, () => {
    assert.deepEqual(resolveProxyLLM(null), { apiKey: 'env_yyy', isFreeTier: false });
  });
});

test('LIN-961: empty/whitespace env key is treated as unset (falls to free tier, never forwarded)', () => {
  // Empty string: the reported symptom — !'' is truthy so the OLD bare check fell
  // to free tier here too, BUT the apiKey chain used to pass '' through; now the
  // trimmed read makes both the classification and the key unambiguous.
  withEnv({ envKey: '', freeKey: 'free_xxx' }, () => {
    assert.deepEqual(resolveProxyLLM(null), { apiKey: 'free_xxx', isFreeTier: true });
  });
  // Whitespace-only: the OLD bare check ( !'  ' === false ) classified this as a
  // paid env key and forwarded '  ' to OpenRouter → a confusing 401. Now it is
  // unset → clean free-tier fallback.
  withEnv({ envKey: '   ', freeKey: 'free_xxx' }, () => {
    assert.deepEqual(resolveProxyLLM(null), { apiKey: 'free_xxx', isFreeTier: true });
  });
  // Whitespace-only with no free key: unset → no key, not free tier (gate 503s),
  // and critically the whitespace is NOT returned as apiKey.
  withEnv({ envKey: '   ', freeKey: undefined }, () => {
    assert.deepEqual(resolveProxyLLM(null), { apiKey: undefined, isFreeTier: false });
  });
});

test('free-tier-only deployment: no session, no env, only free key → uses free key + isFreeTier', () => {
  withEnv({ envKey: undefined, freeKey: 'free_xxx' }, () => {
    assert.deepEqual(resolveProxyLLM(null), { apiKey: 'free_xxx', isFreeTier: true });
    // undefined sessionApiKey (e.g. getWorkspaceOpenRouterKey resolved nothing) behaves the same
    assert.deepEqual(resolveProxyLLM(undefined), { apiKey: 'free_xxx', isFreeTier: true });
  });
});

test('nothing configured: no key, not free tier (gate will still 503)', () => {
  withEnv({ envKey: undefined, freeKey: undefined }, () => {
    assert.deepEqual(resolveProxyLLM(null), { apiKey: undefined, isFreeTier: false });
  });
});
