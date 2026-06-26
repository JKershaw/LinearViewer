/**
 * Unit tests for per-{user, workspace} team-selection persistence (LIN-727).
 *
 * Run with: node --test tests/unit/team-selection-persistence.test.js
 *
 * Regression coverage for the bug where leaving a workspace and returning lost
 * the selected team: selection was driven only by the `?team=` query param (and
 * a single GLOBAL localStorage key), with no per-workspace durable memory. The
 * fix stores the selection per {user, workspace} in the user-preferences layer
 * and restores it as the default when the URL carries no team.
 *
 * Exercises the real UserPreferencesStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface ($set + $setOnInsert + upsert).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { UserPreferencesStore } from '../../lib/user-preferences.js';

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
    async deleteOne(query) {
      const idx = docs.findIndex(d => d._id === query._id);
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
  };
}

const USER_ID = 'linear-user-abc';
const TEAM_A = '11111111-1111-4111-8111-111111111111';
const TEAM_B = '22222222-2222-4222-8222-222222222222';

describe('UserPreferencesStore team selection persistence (LIN-727)', () => {
  let store;

  beforeEach(() => {
    store = new UserPreferencesStore({ collection: createMockCollection() });
  });

  test('set then get round-trips the remembered team for a workspace', async () => {
    await store.setSelectedTeam(USER_ID, 'acme', TEAM_A);
    assert.strictEqual(await store.getSelectedTeam(USER_ID, 'acme'), TEAM_A);
  });

  test('getSelectedTeam returns null when nothing is stored', async () => {
    assert.strictEqual(await store.getSelectedTeam(USER_ID, 'acme'), null);
  });

  test('getSelectedTeam returns null for a missing userId or workspaceKey', async () => {
    await store.setSelectedTeam(USER_ID, 'acme', TEAM_A);
    assert.strictEqual(await store.getSelectedTeam(undefined, 'acme'), null);
    assert.strictEqual(await store.getSelectedTeam(USER_ID, undefined), null);
  });

  // The core defect: selecting a team in one workspace must not affect another.
  test('selections are independent per workspace', async () => {
    await store.setSelectedTeam(USER_ID, 'acme', TEAM_A);
    await store.setSelectedTeam(USER_ID, 'globex', TEAM_B);

    assert.strictEqual(await store.getSelectedTeam(USER_ID, 'acme'), TEAM_A);
    assert.strictEqual(await store.getSelectedTeam(USER_ID, 'globex'), TEAM_B);

    // Re-selecting in globex leaves acme untouched (the reported "return and lose it" bug).
    await store.setSelectedTeam(USER_ID, 'globex', TEAM_A);
    assert.strictEqual(await store.getSelectedTeam(USER_ID, 'acme'), TEAM_A);
  });

  test('a null teamId clears only that workspace (explicit "all teams")', async () => {
    await store.setSelectedTeam(USER_ID, 'acme', TEAM_A);
    await store.setSelectedTeam(USER_ID, 'globex', TEAM_B);

    await store.setSelectedTeam(USER_ID, 'acme', null);

    assert.strictEqual(await store.getSelectedTeam(USER_ID, 'acme'), null);
    assert.strictEqual(await store.getSelectedTeam(USER_ID, 'globex'), TEAM_B);
  });

  test('setSelectedTeam read-merges, preserving unrelated preferences', async () => {
    await store.saveUserPreferences(USER_ID, {
      features: { collective: true },
      northStarByWorkspace: { acme: 'Ship it' },
      openRouterApiKey: 'sk-or-v1-keep',
    });

    await store.setSelectedTeam(USER_ID, 'acme', TEAM_A);

    const prefs = await store.getUserPreferences(USER_ID);
    assert.strictEqual(prefs.selectedTeamByWorkspace.acme, TEAM_A);
    assert.deepStrictEqual(prefs.features, { collective: true });
    assert.deepStrictEqual(prefs.northStarByWorkspace, { acme: 'Ship it' });
    assert.strictEqual(prefs.openRouterApiKey, 'sk-or-v1-keep');
  });

  test('setSelectedTeam returns false for a missing userId or workspaceKey', async () => {
    assert.strictEqual(await store.setSelectedTeam(undefined, 'acme', TEAM_A), false);
    assert.strictEqual(await store.setSelectedTeam(USER_ID, undefined, TEAM_A), false);
  });
});
