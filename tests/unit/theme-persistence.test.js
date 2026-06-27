/**
 * Unit tests for the persisted global theme preference (LIN-756).
 *
 * Run with: node --test tests/unit/theme-persistence.test.js
 *
 * Covers the durable half of the theme toggle: UserPreferencesStore.get/setTheme
 * (validation, round-trip, read-merge) and the session rehydration seam
 * applyUserPreferencesToSession. The client-side bootstrap + localStorage path is
 * covered by the page.js + Playwright tests.
 *
 * Exercises the real UserPreferencesStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface ($set + $setOnInsert + upsert).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  UserPreferencesStore,
  applyUserPreferencesToSession,
  VALID_THEMES,
} from '../../lib/user-preferences.js';

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

describe('UserPreferencesStore theme persistence (LIN-756)', () => {
  let store;

  beforeEach(() => {
    store = new UserPreferencesStore({ collection: createMockCollection() });
  });

  test('VALID_THEMES is exactly light/dark/amber', () => {
    assert.deepStrictEqual([...VALID_THEMES], ['light', 'dark', 'amber']);
  });

  test('set then get round-trips each valid theme', async () => {
    for (const theme of VALID_THEMES) {
      assert.strictEqual(await store.setTheme(USER_ID, theme), true);
      assert.strictEqual(await store.getTheme(USER_ID), theme);
    }
  });

  test('getTheme returns null when nothing is stored', async () => {
    assert.strictEqual(await store.getTheme(USER_ID), null);
  });

  test('getTheme returns null for a missing userId', async () => {
    await store.setTheme(USER_ID, 'dark');
    assert.strictEqual(await store.getTheme(undefined), null);
  });

  test('setTheme rejects an invalid theme without writing', async () => {
    assert.strictEqual(await store.setTheme(USER_ID, 'neon'), false);
    assert.strictEqual(await store.getTheme(USER_ID), null);
  });

  test('getTheme ignores a corrupted stored value', async () => {
    await store.saveUserPreferences(USER_ID, { theme: 'bogus' });
    assert.strictEqual(await store.getTheme(USER_ID), null);
  });

  test('setTheme returns false for a missing userId', async () => {
    assert.strictEqual(await store.setTheme(undefined, 'dark'), false);
  });

  test('setTheme read-merges, preserving unrelated preferences', async () => {
    await store.saveUserPreferences(USER_ID, {
      features: { collective: true },
      openRouterApiKey: 'sk-or-v1-keep',
    });

    await store.setTheme(USER_ID, 'amber');

    const prefs = await store.getUserPreferences(USER_ID);
    assert.strictEqual(prefs.theme, 'amber');
    assert.deepStrictEqual(prefs.features, { collective: true });
    assert.strictEqual(prefs.openRouterApiKey, 'sk-or-v1-keep');
  });
});

describe('applyUserPreferencesToSession — theme rehydration (LIN-756)', () => {
  test('rehydrates a valid theme onto the session', () => {
    const session = {};
    applyUserPreferencesToSession(session, { theme: 'dark' });
    assert.strictEqual(session.theme, 'dark');
  });

  test('ignores an invalid theme (no session.theme set)', () => {
    const session = {};
    applyUserPreferencesToSession(session, { theme: 'neon' });
    assert.strictEqual(session.theme, undefined);
  });

  test('leaves theme unset when prefs carry none', () => {
    const session = {};
    applyUserPreferencesToSession(session, { features: { ship: true } });
    assert.strictEqual(session.theme, undefined);
  });
});
