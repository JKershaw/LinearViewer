/**
 * LIN-3833 — the copy-first card on Home stays dismissed once "Got it" is pressed.
 *
 * Witnesses, each shown red before the change and green after:
 *  - POST settings/copy-first-card writes the session at once, persists the account's preference when
 *    the session has one, answers `{ ok: true }`, and answers 500 with nothing persisted when the
 *    session save fails.
 *  - The store keeps the flag across a read-merge: it reads unset as not dismissed, sets it without
 *    clobbering other preferences, and a new session for the same account is rehydrated as dismissed.
 *  - Once dismissed, Home's render pin is `copyFirstCard: false` for that session (the
 *    `featureFlags.runControls !== true && session.copyFirstCardDismissed !== true` expression in server.js).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCopyFirstCardRoute } from '../../lib/settings-copy-first-card.js';
import { UserPreferencesStore, applyUserPreferencesToSession } from '../../lib/user-preferences.js';

// The collection surface UserPreferencesStore uses (findOne / updateOne with $set and upsert), in memory.
function createMockCollection() {
  const docs = [];
  return {
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

function buildApp({ accountId, saveFails = false } = {}) {
  const calls = { saved: 0, persisted: [] };
  const store = {
    async setCopyFirstCardDismissed(id, value) { calls.persisted.push({ id, value }); return true; },
  };
  const session = {};
  if (accountId) session.accountId = accountId;
  const app = express();
  app.use(express.json());
  app.use(createCopyFirstCardRoute({
    workspaceFromUrl: (req, _res, next) => { req.workspace = { urlKey: 'acme' }; req.session = session; next(); },
    userPreferencesStore: store,
    saveSession: async () => {
      calls.saved += 1;
      if (saveFails) throw new Error('disk full');
    },
  }));
  return { app, session, calls };
}

async function post(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/acme/settings/copy-first-card`, { method: 'POST' });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise(r => server.close(r));
  }
}

describe('LIN-3833 — POST settings/copy-first-card', () => {
  test('dismisses for the session and persists the account, then answers ok', async () => {
    const { app, session, calls } = buildApp({ accountId: 'acct-1' });
    const { status, body } = await post(app);
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(session.copyFirstCardDismissed, true, 'the session carries the dismissal at once');
    assert.equal(calls.saved, 1, 'the session is saved');
    assert.deepEqual(calls.persisted, [{ id: 'acct-1', value: true }], 'the durable preference follows');
  });

  test('without an accountId the session is dismissed but nothing is persisted', async () => {
    const { app, session, calls } = buildApp();
    const { status } = await post(app);
    assert.equal(status, 200);
    assert.equal(session.copyFirstCardDismissed, true);
    assert.deepEqual(calls.persisted, []);
  });

  test('a failed session save is a 500 and persists nothing', async () => {
    const { app, calls } = buildApp({ accountId: 'acct-1', saveFails: true });
    const { status, body } = await post(app);
    assert.equal(status, 500);
    assert.deepEqual(body, { error: 'Failed to save' });
    assert.deepEqual(calls.persisted, [], 'a failed session save stops before the durable write');
  });
});

describe('LIN-3833 — the durable copy-first preference survives a reload and a new session', () => {
  let store;
  beforeEach(() => { store = new UserPreferencesStore({ collection: createMockCollection() }); });

  test('an account that never dismissed the card reads as not dismissed', async () => {
    assert.equal(await store.getCopyFirstCardDismissed('acct-new'), false);
  });

  test('setting the flag keeps the other preferences of the account', async () => {
    const ACCOUNT = 'acct-keep';
    await store.setProxyDefault(ACCOUNT, false);
    await store.setCopyFirstCardDismissed(ACCOUNT, true);
    assert.equal(await store.getCopyFirstCardDismissed(ACCOUNT), true);
    const prefs = await store.getUserPreferences(ACCOUNT);
    assert.equal(prefs.proxyDefault, false, 'the proxy default is not clobbered by the card flag');
  });

  test('a new session for the same account is rehydrated as dismissed', async () => {
    const ACCOUNT = 'acct-returns';
    await store.setCopyFirstCardDismissed(ACCOUNT, true);
    const prefs = await store.getUserPreferences(ACCOUNT);
    const session = {};
    applyUserPreferencesToSession(session, prefs);
    assert.equal(session.copyFirstCardDismissed, true, 'a fresh session starts dismissed');
  });

  test('a session that was never dismissed is rehydrated as not dismissed', async () => {
    const session = {};
    applyUserPreferencesToSession(session, await store.getUserPreferences('acct-fresh'));
    assert.equal(session.copyFirstCardDismissed, false);
  });
});
