/**
 * LIN-3846: "use my key when I'm away" can be turned off without disconnecting OpenRouter.
 * On main the only way to clear durable consent was to disconnect, which deleted the key.
 *
 * Run with: node --test tests/unit/openrouter-consent-clear.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { UserPreferencesStore } from '../../lib/user-preferences.js';
import { createOpenRouterAuthRoutes } from '../../routes/openrouter-auth.js';
import { memoryCollection } from './helpers/routing-fakes.js';

const store = () => new UserPreferencesStore({ collection: memoryCollection() });

describe('UserPreferencesStore.clearOpenRouterConsent', () => {
  test('clears the consent and keeps the key and every other preference', async () => {
    const s = store();
    await s.saveUserPreferences('a', { theme: 'dark', openRouterApiKey: 'sk-or-1' });
    await s.setOpenRouterConsent('a');
    assert.ok(await s.getOpenRouterConsent('a'));
    assert.equal(await s.clearOpenRouterConsent('a'), true);
    assert.equal(await s.getOpenRouterConsent('a'), null);
    const prefs = await s.getUserPreferences('a');
    assert.equal(prefs.openRouterApiKey, 'sk-or-1', 'the key stays connected');
    assert.equal(prefs.theme, 'dark');
  });

  test('is idempotent, and refuses an absent account without throwing', async () => {
    const s = store();
    assert.equal(await s.clearOpenRouterConsent('nobody'), true);
    assert.equal(await s.clearOpenRouterConsent('nobody'), true);
    assert.equal(await s.clearOpenRouterConsent(''), false);
  });
});

describe('POST /auth/openrouter/consent/clear', () => {
  async function run({ session, prefs }) {
    const app = express();
    app.use((req, _res, next) => { req.session = session; next(); });
    app.use(createOpenRouterAuthRoutes({ userPreferencesStore: prefs, saveSession: async () => {}, getActiveWorkspace: undefined }));
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/auth/openrouter/consent/clear`, { method: 'POST', redirect: 'manual' });
      return { status: res.status, location: res.headers.get('location'), body: await res.text() };
    } finally { await new Promise((r) => server.close(r)); }
  }
  const workspace = { urlKey: 'acme', id: 'w1', provider: 'linear', name: 'Acme', bindings: [], activeBinding: null };
  const session = (extra = {}) => ({ workspaces: [workspace], activeWorkspace: 'acme', accountId: 'a', ...extra });

  test('clears consent, leaves the key, redirects to Account with the Undo flash', async () => {
    const prefs = store();
    await prefs.saveUserPreferences('a', { openRouterApiKey: 'sk-or-1' });
    await prefs.setOpenRouterConsent('a');
    const res = await run({ session: session(), prefs });
    assert.equal(res.status, 302);
    assert.equal(res.location, '/workspace/acme/settings/account?consent_off=1');
    assert.equal(await prefs.getOpenRouterConsent('a'), null);
    assert.equal(await prefs.getOpenRouterApiKey('a'), 'sk-or-1');
  });

  test('is idempotent', async () => {
    const prefs = store();
    assert.equal((await run({ session: session(), prefs })).status, 302);
  });

  test('no account: 400 and nothing written', async () => {
    const res = await run({ session: session({ accountId: undefined }), prefs: store() });
    assert.equal(res.status, 400);
  });
});
