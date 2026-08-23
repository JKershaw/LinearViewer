/**
 * Unit tests for LIN-1353 S6/S7/S5: saved chats, custom-prompt recents/
 * favourites, and the north-star write-through all work for a session that
 * carries `accountId` but NO `linearUserId` — the real shape a GitHub App or
 * local-provider session has in production (LIN-1329's establishAccount never
 * sets `linearUserId` for those two providers; only Linear OAuth/PAT do).
 *
 * Before LIN-1353 these surfaces gated on `req.session.linearUserId`, so a
 * GitHub/local user was silently locked out (saved chats: 401; recents/
 * favourites: 401; north star durable write: silently skipped, best-effort).
 *
 * Run with: node --test tests/unit/nonlinear-account-access.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createTaskChatRoutes } from '../../routes/task-chat.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { UserPreferencesStore } from '../../lib/user-preferences.js';

// Descends into mounted sub-routers (e.g. workspace-api.js's roadmap group,
// LIN-2246) so a route split into a sibling module is still found by path.
function findRouteLayer(router, method, path) {
  for (const l of router.stack) {
    if (l.route?.path === path && l.route.methods[method]) return l;
    if (l.name === 'router' && l.handle?.stack) {
      const nested = findRouteLayer(l.handle, method, path);
      if (nested) return nested;
    }
  }
  return null;
}

function getHandler(router, method, path) {
  const layer = findRouteLayer(router, method, path);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
}

// A session shaped exactly like a real GitHub/local sign-in: accountId set via
// establishAccount, linearUserId never set (production never sets it for these
// two providers — confirmed in the LIN-1353 recon, zero production sites do).
function nonLinearSession(overrides = {}) {
  return { accountId: 'account-nonlinear-1', features: { taskChat: true, roadmap: true }, ...overrides };
}

function freshPrefsStore() {
  // Minimal in-memory mock collection — same shape used by
  // tests/unit/openrouter-key-persistence.test.js.
  const docs = [];
  return new UserPreferencesStore({
    collection: {
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
    },
  });
}

describe('Saved chats work for a GitHub/local session (accountId, no linearUserId) — LIN-1353 S6', () => {
  test('list/create/get/delete all succeed keyed on accountId', async () => {
    const savedChatStore = {
      _chats: new Map(),
      async list(urlKey, accountId) {
        return [...this._chats.values()].filter(c => c.urlKey === urlKey && c.accountId === accountId);
      },
      async create(urlKey, accountId, { taskIdentifier, transcript }) {
        const chat = { id: 'chat-1', urlKey, accountId, taskIdentifier, transcript, title: 'Saved chat' };
        this._chats.set(chat.id, chat);
        return chat;
      },
      async get(urlKey, accountId, id) {
        const chat = this._chats.get(id);
        return (chat && chat.urlKey === urlKey && chat.accountId === accountId) ? chat : null;
      },
      async delete(urlKey, accountId, id) {
        const chat = this._chats.get(id);
        if (!chat || chat.urlKey !== urlKey || chat.accountId !== accountId) return false;
        this._chats.delete(id);
        return true;
      },
    };
    const router = createTaskChatRoutes({ workspaceFromUrl: (req, res, next) => next(), savedChatStore });
    const session = nonLinearSession();
    const workspace = { urlKey: 'acme' };

    const createRes = makeRes();
    await getHandler(router, 'post', '/workspace/:urlKey/api/task-chat/saved')(
      { session, workspace, body: { taskIdentifier: 'LIN-1', transcript: [{ role: 'user', content: 'hi' }] } },
      createRes
    );
    assert.strictEqual(createRes.statusCode, 201);
    const chatId = createRes.jsonBody.chat.id;

    const listRes = makeRes();
    await getHandler(router, 'get', '/workspace/:urlKey/api/task-chat/saved')({ session, workspace }, listRes);
    assert.strictEqual(listRes.jsonBody.chats.length, 1);

    const getRes = makeRes();
    await getHandler(router, 'get', '/workspace/:urlKey/api/task-chat/saved/:id')(
      { session, workspace, params: { id: chatId } }, getRes
    );
    assert.strictEqual(getRes.statusCode, 200);

    const deleteRes = makeRes();
    await getHandler(router, 'delete', '/workspace/:urlKey/api/task-chat/saved/:id')(
      { session, workspace, params: { id: chatId } }, deleteRes
    );
    assert.deepStrictEqual(deleteRes.jsonBody, { ok: true });
  });
});

describe('Custom-prompt recents/favourites work for a GitHub/local session — LIN-1353 S7', () => {
  function router(userPreferencesStore) {
    return createDispatchRoutes({
      dispatchQueueStore: {}, dispatchTokenStore: {}, workspaceFromUrl: (req, res, next) => next(),
      userPreferencesStore, harbourFeedbackTokenStore: {}, workspacePreferencesStore: {}, proxyTokenStore: {},
    });
  }

  test('recent prompts: POST then GET round-trips for accountId with no linearUserId', async () => {
    const userPreferencesStore = freshPrefsStore();
    const r = router(userPreferencesStore);
    const session = nonLinearSession();
    const workspace = { urlKey: 'acme' };

    const postRes = makeRes();
    await getHandler(r, 'post', '/workspace/:urlKey/api/dispatch/recent-prompts')(
      { session, workspace, body: { prompt: 'ship the roadmap' } }, postRes
    );
    assert.deepStrictEqual(postRes.jsonBody, { success: true });

    const getRes = makeRes();
    await getHandler(r, 'get', '/workspace/:urlKey/api/dispatch/recent-prompts')({ session, workspace }, getRes);
    assert.deepStrictEqual(getRes.jsonBody, { prompts: ['ship the roadmap'] });
  });

  test('recent prompts: 401s a session with NO accountId at all (still requires SOME identity)', async () => {
    const r = router(freshPrefsStore());
    const res = makeRes();
    await getHandler(r, 'get', '/workspace/:urlKey/api/dispatch/recent-prompts')(
      { session: { features: {} }, workspace: { urlKey: 'acme' } }, res
    );
    assert.strictEqual(res.statusCode, 401);
  });

  test('favourite prompts: add → list → remove round-trips for accountId with no linearUserId', async () => {
    const userPreferencesStore = freshPrefsStore();
    const r = router(userPreferencesStore);
    const session = nonLinearSession();
    const workspace = { urlKey: 'acme' };

    const addRes = makeRes();
    await getHandler(r, 'post', '/workspace/:urlKey/api/dispatch/favorite-prompts')(
      { session, workspace, body: { prompt: 'audit the queue' } }, addRes
    );
    assert.deepStrictEqual(addRes.jsonBody, { success: true, prompts: ['audit the queue'] });

    const listRes = makeRes();
    await getHandler(r, 'get', '/workspace/:urlKey/api/dispatch/favorite-prompts')({ session, workspace }, listRes);
    assert.deepStrictEqual(listRes.jsonBody, { prompts: ['audit the queue'] });

    const removeRes = makeRes();
    await getHandler(r, 'delete', '/workspace/:urlKey/api/dispatch/favorite-prompts')(
      { session, workspace, body: { prompt: 'audit the queue' } }, removeRes
    );
    assert.deepStrictEqual(removeRes.jsonBody, { success: true, prompts: [] });
  });
});

describe('North-star durable write-through works for a GitHub/local session — LIN-1353 S5', () => {
  test('PUT north-star persists durably (not just to session) for accountId with no linearUserId', async () => {
    const userPreferencesStore = freshPrefsStore();
    const router = createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(), freeTierStore: {}, getOpenRouterSource: () => null,
      userPreferencesStore, workspacePreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {},
      briefCacheStore: {}, reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {},
      promptTraceStore: {}, proxyTokenStore: {},
    });
    const handler = getHandler(router, 'put', '/workspace/:urlKey/api/roadmap/north-star');
    const session = nonLinearSession();
    const workspace = { urlKey: 'acme' };
    const res = makeRes();

    await handler({ session, workspace, body: { northStar: 'Ship the roadmap view' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(session.northStarByWorkspace.acme, 'Ship the roadmap view', 'session write (always happens)');
    // The durable write-through — this is the part that was silently skipped
    // pre-LIN-1353 for a session with no linearUserId.
    const durable = await userPreferencesStore.getUserPreferences(session.accountId);
    assert.strictEqual(durable.northStarByWorkspace?.acme, 'Ship the roadmap view', 'durable write-through succeeded');
  });
});
