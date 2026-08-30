/**
 * Unit tests for durable OpenRouter key persistence and re-auth survival (LIN-498).
 *
 * Run with: node --test tests/unit/openrouter-key-persistence.test.js
 *
 * Regression coverage for the bug where a Linear re-auth (session.regenerate())
 * silently dropped the user's OpenRouter connection because the key lived only
 * at the session top level. The fix moves the source of truth to the durable
 * per-user preferences store and rehydrates the session mirror after regenerate.
 *
 * Exercises the real UserPreferencesStore and the pure restore helper against an
 * in-memory mock of the MongoDB/MangoDB collection surface ($set + $setOnInsert
 * + upsert), matching how production rehydration runs.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { UserPreferencesStore, applyUserPreferencesToSession } from '../../lib/user-preferences.js';

// Minimal in-memory mock of the collection surface the store uses
// (findOne / updateOne with $set + $setOnInsert + upsert / deleteOne).
function createMockCollection() {
  const docs = [];
  return {
    _docs: docs,
    async findOne(query) {
      const doc = docs.find(d => d._id === query._id);
      return doc ? { ...doc, preferences: { ...doc.preferences } } : null;
    },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => d._id === query._id);
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { _id: query._id, ...(update.$setOnInsert || {}) };
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => d._id === query._id);
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
  };
}

const USER_ID = 'linear-user-abc';

describe('UserPreferencesStore OpenRouter key persistence', () => {
  let store;

  beforeEach(() => {
    store = new UserPreferencesStore({ collection: createMockCollection() });
  });

  test('set then get round-trips the durable key', async () => {
    await store.setOpenRouterApiKey(USER_ID, 'sk-or-v1-test');
    assert.strictEqual(await store.getOpenRouterApiKey(USER_ID), 'sk-or-v1-test');
  });

  test('getOpenRouterApiKey returns null when no key is stored', async () => {
    assert.strictEqual(await store.getOpenRouterApiKey(USER_ID), null);
  });

  test('getOpenRouterApiKey returns null for a missing linearUserId', async () => {
    assert.strictEqual(await store.getOpenRouterApiKey(undefined), null);
  });

  test('setOpenRouterApiKey read-merges, preserving other preferences', async () => {
    // Seed existing prefs the way features/northStar are stored.
    await store.saveUserPreferences(USER_ID, {
      features: { collective: true },
      northStarByWorkspace: { acme: 'Ship it' },
    });

    await store.setOpenRouterApiKey(USER_ID, 'sk-or-v1-keep');

    const prefs = await store.getUserPreferences(USER_ID);
    assert.strictEqual(prefs.openRouterApiKey, 'sk-or-v1-keep');
    assert.deepStrictEqual(prefs.features, { collective: true });
    assert.deepStrictEqual(prefs.northStarByWorkspace, { acme: 'Ship it' });
  });

  test('clearOpenRouterApiKey removes only the key, leaving other prefs intact', async () => {
    await store.saveUserPreferences(USER_ID, {
      features: { collective: true },
      openRouterApiKey: 'sk-or-v1-drop',
    });

    await store.clearOpenRouterApiKey(USER_ID);

    const prefs = await store.getUserPreferences(USER_ID);
    assert.ok(!('openRouterApiKey' in prefs), 'key field should be removed');
    assert.deepStrictEqual(prefs.features, { collective: true });
    assert.strictEqual(await store.getOpenRouterApiKey(USER_ID), null);
  });

  test('clearOpenRouterApiKey is a no-op when nothing is stored', async () => {
    assert.strictEqual(await store.clearOpenRouterApiKey(USER_ID), true);
    assert.strictEqual(await store.getOpenRouterApiKey(USER_ID), null);
  });

  // Proxy AI path after a later re-auth: the proxy resolves the creator's key
  // straight from durable prefs by linearUserId, with NO live session present.
  test('durable key resolves by linearUserId with no session (proxy path)', async () => {
    await store.setOpenRouterApiKey(USER_ID, 'sk-or-v1-proxy');
    // Simulates getWorkspaceOpenRouterKey's reimplemented lookup.
    const resolved = await store.getOpenRouterApiKey(USER_ID);
    assert.strictEqual(resolved, 'sk-or-v1-proxy');
  });
});

// Durable unattended-use consent (LIN-2412) — mirrors the openRouterApiKey
// round-trip tests above, since the two fields share the same read-merge
// idiom and the same store.
describe('UserPreferencesStore OpenRouter durable consent', () => {
  let store;

  beforeEach(() => {
    store = new UserPreferencesStore({ collection: createMockCollection() });
  });

  test('getOpenRouterConsent returns null when nothing is stored', async () => {
    assert.strictEqual(await store.getOpenRouterConsent(USER_ID), null);
  });

  test('set then get round-trips a non-null ISO timestamp', async () => {
    await store.setOpenRouterConsent(USER_ID);
    const consentedAt = await store.getOpenRouterConsent(USER_ID);
    assert.ok(consentedAt, 'consent timestamp should be truthy');
    assert.ok(!Number.isNaN(Date.parse(consentedAt)), 'consent timestamp should be a valid ISO-8601 string');
  });

  test('setOpenRouterConsent read-merges, preserving other preferences including the key', async () => {
    await store.saveUserPreferences(USER_ID, {
      features: { collective: true },
      openRouterApiKey: 'sk-or-v1-keep',
    });

    await store.setOpenRouterConsent(USER_ID);

    const prefs = await store.getUserPreferences(USER_ID);
    assert.ok(prefs.openRouterDurableConsentAt);
    assert.strictEqual(prefs.openRouterApiKey, 'sk-or-v1-keep');
    assert.deepStrictEqual(prefs.features, { collective: true });
  });

  test('setOpenRouterConsent re-grant refreshes the timestamp (idempotent, not additive)', async () => {
    await store.setOpenRouterConsent(USER_ID);
    const first = await store.getOpenRouterConsent(USER_ID);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.setOpenRouterConsent(USER_ID);
    const second = await store.getOpenRouterConsent(USER_ID);
    assert.notStrictEqual(first, second, 're-granting should refresh the stored timestamp');
  });

  test('clearOpenRouterApiKey ALSO clears consent, in the same write, leaving other prefs intact', async () => {
    await store.saveUserPreferences(USER_ID, {
      features: { collective: true },
      openRouterApiKey: 'sk-or-v1-drop',
      openRouterDurableConsentAt: '2026-08-01T00:00:00.000Z',
    });

    await store.clearOpenRouterApiKey(USER_ID);

    const prefs = await store.getUserPreferences(USER_ID);
    assert.ok(!('openRouterApiKey' in prefs), 'key field should be removed');
    assert.ok(!('openRouterDurableConsentAt' in prefs), 'consent field should be removed alongside the key');
    assert.deepStrictEqual(prefs.features, { collective: true });
    assert.strictEqual(await store.getOpenRouterConsent(USER_ID), null);
  });

  test('clearOpenRouterApiKey clears a lingering consent flag even when no key is present', async () => {
    // Defensive case: consent without a key shouldn't survive a clear either.
    await store.saveUserPreferences(USER_ID, { openRouterDurableConsentAt: '2026-08-01T00:00:00.000Z' });
    await store.clearOpenRouterApiKey(USER_ID);
    assert.strictEqual(await store.getOpenRouterConsent(USER_ID), null);
  });

  test('getOpenRouterConsent/setOpenRouterConsent return falsy/false for a missing accountId', async () => {
    assert.strictEqual(await store.getOpenRouterConsent(undefined), null);
    assert.strictEqual(await store.setOpenRouterConsent(undefined), false);
  });
});

describe('applyUserPreferencesToSession (re-auth rehydration)', () => {
  test('re-auth survival: rehydrates openRouterApiKey into a regenerated session', () => {
    // A fresh, post-regenerate session has none of the durable fields.
    const session = {};
    applyUserPreferencesToSession(session, {
      openRouterApiKey: 'sk-or-v1-survive',
      features: { collective: true },
      northStarByWorkspace: { acme: 'Ship it' },
    });

    assert.strictEqual(session.openRouterApiKey, 'sk-or-v1-survive');
    assert.deepStrictEqual(session.features, { collective: true });
    assert.deepStrictEqual(session.northStarByWorkspace, { acme: 'Ship it' });
  });

  test('leaves the session untouched when no durable key is stored', () => {
    const session = {};
    applyUserPreferencesToSession(session, { features: { collective: true } });
    assert.ok(!('openRouterApiKey' in session), 'no key should be set');
  });

  test('end-to-end: connect → regenerate → rehydrate preserves the connection', async () => {
    const store = new UserPreferencesStore({ collection: createMockCollection() });

    // 1. User connects OpenRouter (openrouter-auth callback writes durably).
    await store.setOpenRouterApiKey(USER_ID, 'sk-or-v1-e2e');

    // 2. Linear re-auth regenerates the session, wiping it.
    const regeneratedSession = {};

    // 3. The auth callback rehydrates from durable prefs.
    const savedPrefs = await store.getUserPreferences(USER_ID);
    applyUserPreferencesToSession(regeneratedSession, savedPrefs);

    // The OpenRouter connection survived the re-auth.
    assert.strictEqual(regeneratedSession.openRouterApiKey, 'sk-or-v1-e2e');
  });

  test('tolerates null session / prefs without throwing', () => {
    assert.doesNotThrow(() => applyUserPreferencesToSession(null, {}));
    assert.doesNotThrow(() => applyUserPreferencesToSession({}, null));
  });
});
