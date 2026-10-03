/**
 * LIN-2944 P3 — proxy default-on (server-side), red-first witnesses.
 *
 * Addendum 15 (verdict `15237eb1`): the durable key is TOP-LEVEL
 * `prefs.proxyDefault` (not `prefs.features.proxyDefault`), rehydrated into
 * `session.proxyDefault` in `applyUserPreferencesToSession` next to `theme`.
 *
 * Addendum 16: renderers emit `data-proxy-active="true"` unless the session value
 * is explicitly `false` — so a fresh session with no key (or a local workspace
 * that never rehydrated) is on. The 4 `bodyAttrs` sites take the session value in
 * their options; `isLanding` pages omit the attribute.
 *
 * Authored against the pre-P3 code: the store has no `proxyDefault` methods, the
 * rehydrate helper does not carry it, and no renderer emits `data-proxy-active`
 * (the attribute is only set client-side by ProxyToggle today).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { UserPreferencesStore, applyUserPreferencesToSession } from '../../lib/user-preferences.js';
import { renderPage } from '../../lib/render.js';
import { renderSwipePage } from '../../lib/render-swipe.js';
import { renderDispatchPage } from '../../lib/render-dispatch.js';
import { renderFlightCompanionPage } from '../../lib/render-flight-companion.js';

// Minimal in-memory mock of the collection surface the store uses
// (findOne / updateOne with $set + $setOnInsert + upsert) — the same shape as
// tests/unit/openrouter-key-persistence.test.js.
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

const ACCOUNT = 'acct-p3-proxy';

describe('LIN-2944 P3 — the durable top-level proxyDefault preference', () => {
  let store;
  beforeEach(() => { store = new UserPreferencesStore({ collection: createMockCollection() }); });

  test('a new account resolves proxyDefault ON', async () => {
    assert.equal(await store.getProxyDefault(ACCOUNT), true, 'default-on for a brand-new account');
  });

  test('an explicit OFF is stored at the TOP level and round-trips read-merge', async () => {
    await store.setProxyDefault(ACCOUNT, false);
    assert.equal(await store.getProxyDefault(ACCOUNT), false, 'explicit off survives');
    // The key is top-level, not nested under features (addendum 15).
    const prefs = await store.getUserPreferences(ACCOUNT);
    assert.equal(prefs.proxyDefault, false, 'stored top-level');
    // A sibling pref written between the two proxy writes must not be clobbered
    // by the read-merge (the theme route's precedent).
    await store.setOpenRouterApiKey(ACCOUNT, 'sk-or-v1-keep');
    await store.setProxyDefault(ACCOUNT, true);
    assert.equal(await store.getProxyDefault(ACCOUNT), true, 'explicit on survives');
    assert.equal(await store.getOpenRouterApiKey(ACCOUNT), 'sk-or-v1-keep', 'sibling prefs survive the merge');
  });
});

describe('LIN-2944 P3 — login rehydrate carries proxyDefault (next to theme)', () => {
  test('a persisted OFF is mirrored into the session', () => {
    const session = {};
    applyUserPreferencesToSession(session, { proxyDefault: false });
    assert.equal(session.proxyDefault, false);
  });

  test('a persisted ON is mirrored into the session', () => {
    const session = {};
    applyUserPreferencesToSession(session, { proxyDefault: true });
    assert.equal(session.proxyDefault, true);
  });

  test('an absent preference (new/legacy user) resolves ON, not undefined', () => {
    const fresh = {};
    applyUserPreferencesToSession(fresh, {});
    assert.equal(fresh.proxyDefault, true, 'new user is proxy-on by default');

    const themeOnly = {};
    applyUserPreferencesToSession(themeOnly, { theme: 'dark' });
    assert.equal(themeOnly.proxyDefault, true, 'a sibling pref does not turn proxy off');
  });

  test('theme is still rehydrated alongside it', () => {
    const session = {};
    applyUserPreferencesToSession(session, { theme: 'dark', proxyDefault: false });
    assert.equal(session.theme, 'dark');
    assert.equal(session.proxyDefault, false);
  });
});

// ---------------------------------------------------------------------------
// bodyAttrs emission — the four render sites
// ---------------------------------------------------------------------------

const WORKSPACE = { urlKey: 'ws', name: 'WS', provider: 'linear' };

function bodyTag(html) {
  const m = html.match(/<body[^>]*>/);
  assert.ok(m, 'page has a <body> tag');
  return m[0];
}

const EMPTY_TREES = { projectTrees: [], inProgressTrees: [], recentActivityTrees: [] };

describe('LIN-2944 P3 — data-proxy-active is emitted from the render bodyAttrs', () => {
  test('Home: unset means ON; explicit false is the only off', () => {
    const unset = renderPage([], [], [], 'Org', { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: { proxy: true } });
    assert.match(bodyTag(unset), /data-proxy-active="true"/, 'a fresh session with no key is on');

    const on = renderPage([], [], [], 'Org', { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: { proxy: true }, proxyDefault: true });
    assert.match(bodyTag(on), /data-proxy-active="true"/);

    const off = renderPage([], [], [], 'Org', { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: { proxy: true }, proxyDefault: false });
    assert.match(bodyTag(off), /data-proxy-active="false"/);
  });

  test('Swipe: unset means ON; explicit false is off', () => {
    const unset = renderSwipePage(EMPTY_TREES, { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: { proxy: true } });
    assert.match(bodyTag(unset), /data-proxy-active="true"/);
    const on = renderSwipePage(EMPTY_TREES, { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: { proxy: true }, proxyDefault: true });
    assert.match(bodyTag(on), /data-proxy-active="true"/);
    const off = renderSwipePage(EMPTY_TREES, { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: { proxy: true }, proxyDefault: false });
    assert.match(bodyTag(off), /data-proxy-active="false"/);
  });

  test('Dispatch and Flight Companion also carry the attribute', () => {
    const dispatch = renderDispatchPage('WS', { urlKey: 'ws', featureFlags: { proxy: true }, proxyDefault: false });
    assert.match(bodyTag(dispatch), /data-proxy-active="false"/);
    const fc = renderFlightCompanionPage({}, { urlKey: 'ws', featureFlags: { proxy: true }, proxyDefault: true });
    assert.match(bodyTag(fc), /data-proxy-active="true"/);
  });

  test('landing pages omit data-proxy-active (same rule as data-proxy-feature)', () => {
    const home = renderPage([], [], [], 'Org', { isLanding: true, proxyDefault: true });
    assert.doesNotMatch(bodyTag(home), /data-proxy-active/);
    const swipe = renderSwipePage(EMPTY_TREES, { isLanding: true, proxyDefault: true });
    assert.doesNotMatch(bodyTag(swipe), /data-proxy-active/);
  });
});
