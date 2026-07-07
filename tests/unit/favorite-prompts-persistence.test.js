/**
 * Unit tests for durable favourite-custom-prompts persistence (LIN-1011).
 *
 * Run with: node --test tests/unit/favorite-prompts-persistence.test.js
 *
 * Favourites are a user-curated list on top of the rolling, capped
 * `recentCustomPrompts` window: a starred prompt survives the recents roll-off
 * instead of disappearing. Stored per {user, workspace} under a new sibling key
 * `favoriteCustomPrompts`, mirroring `recentCustomPrompts` /
 * `selectedTeamByWorkspace`. Exercises the real UserPreferencesStore against an
 * in-memory mock of the MongoDB/MangoDB collection surface.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { UserPreferencesStore, MAX_FAVORITE_PROMPTS } from '../../lib/user-preferences.js';

// Minimal in-memory mock of the collection surface the store uses.
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
  };
}

const USER_ID = 'linear-user-abc';
const WS = 'acme';

describe('UserPreferencesStore favourite prompts (LIN-1011)', () => {
  let store;

  beforeEach(() => {
    store = new UserPreferencesStore({ collection: createMockCollection() });
  });

  test('getFavoritePrompts returns empty array when nothing is stored', async () => {
    assert.deepStrictEqual(await store.getFavoritePrompts(USER_ID, WS), []);
  });

  test('add then get round-trips the favourite for a workspace', async () => {
    await store.addFavoritePrompt(USER_ID, WS, 'Review the auth module');
    assert.deepStrictEqual(await store.getFavoritePrompts(USER_ID, WS), ['Review the auth module']);
  });

  test('favourites are deduplicated and most-recent-first', async () => {
    await store.addFavoritePrompt(USER_ID, WS, 'First');
    await store.addFavoritePrompt(USER_ID, WS, 'Second');
    await store.addFavoritePrompt(USER_ID, WS, 'First'); // move to top
    assert.deepStrictEqual(await store.getFavoritePrompts(USER_ID, WS), ['First', 'Second']);
  });

  test('remove filters the exact string out (un-star)', async () => {
    await store.addFavoritePrompt(USER_ID, WS, 'Keep');
    await store.addFavoritePrompt(USER_ID, WS, 'Drop');
    const after = await store.removeFavoritePrompt(USER_ID, WS, 'Drop');
    assert.deepStrictEqual(after, ['Keep']);
    assert.deepStrictEqual(await store.getFavoritePrompts(USER_ID, WS), ['Keep']);
  });

  test('cap at MAX_FAVORITE_PROMPTS drops the oldest, never errors', async () => {
    for (let i = 1; i <= MAX_FAVORITE_PROMPTS + 3; i++) {
      await store.addFavoritePrompt(USER_ID, WS, `Prompt ${i}`);
    }
    const list = await store.getFavoritePrompts(USER_ID, WS);
    assert.strictEqual(list.length, MAX_FAVORITE_PROMPTS);
    assert.strictEqual(list[0], `Prompt ${MAX_FAVORITE_PROMPTS + 3}`); // newest first
    assert.strictEqual(list[list.length - 1], 'Prompt 4'); // oldest survivor
  });

  test('favourites are partitioned per workspace', async () => {
    await store.addFavoritePrompt(USER_ID, 'ws-a', 'A only');
    await store.addFavoritePrompt(USER_ID, 'ws-b', 'B only');
    assert.deepStrictEqual(await store.getFavoritePrompts(USER_ID, 'ws-a'), ['A only']);
    assert.deepStrictEqual(await store.getFavoritePrompts(USER_ID, 'ws-b'), ['B only']);
  });

  test('a favourite survives the recents cap (the core requirement)', async () => {
    // Favourite an early prompt, then push more recents than the recents cap.
    await store.addFavoritePrompt(USER_ID, WS, 'My go-to prompt');
    // Simulate recents churn on the sibling key by writing lots of recents.
    for (let i = 0; i < 20; i++) {
      const prefs = await store.getUserPreferences(USER_ID);
      const rec = prefs.recentCustomPrompts || {};
      const list = [`recent ${i}`, ...(rec[WS] || [])].slice(0, 10);
      await store.saveUserPreferences(USER_ID, { ...prefs, recentCustomPrompts: { ...rec, [WS]: list } });
    }
    // The favourite is untouched by recents churn.
    assert.deepStrictEqual(await store.getFavoritePrompts(USER_ID, WS), ['My go-to prompt']);
  });

  test('writes read-merge: favourites do not clobber sibling preferences', async () => {
    await store.setSelectedTeam(USER_ID, WS, '11111111-1111-4111-8111-111111111111');
    await store.addFavoritePrompt(USER_ID, WS, 'Fav');
    const prefs = await store.getUserPreferences(USER_ID);
    assert.strictEqual(prefs.selectedTeamByWorkspace[WS], '11111111-1111-4111-8111-111111111111');
    assert.deepStrictEqual(prefs.favoriteCustomPrompts[WS], ['Fav']);
    // And removing a favourite leaves the team intact too.
    await store.removeFavoritePrompt(USER_ID, WS, 'Fav');
    const prefs2 = await store.getUserPreferences(USER_ID);
    assert.strictEqual(prefs2.selectedTeamByWorkspace[WS], '11111111-1111-4111-8111-111111111111');
  });

  test('missing userId or workspaceKey is a no-op / empty', async () => {
    assert.deepStrictEqual(await store.getFavoritePrompts(undefined, WS), []);
    assert.deepStrictEqual(await store.getFavoritePrompts(USER_ID, undefined), []);
    assert.deepStrictEqual(await store.addFavoritePrompt(undefined, WS, 'x'), []);
    assert.deepStrictEqual(await store.removeFavoritePrompt(USER_ID, undefined, 'x'), []);
  });
});
