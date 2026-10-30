/**
 * LIN-4016 W5 — Claude Code on the web needs Claude Code: the session entrance refuses `web` on a resolved `opencode`.
 *
 * The rule is applied to the RESOLVED harness (after a blank is filled from the workspace defaults), by the one function
 * in lib/dispatch-targets.js that the offered list reads too, so the list and the refusal cannot disagree. A fresh run is
 * refused before anything is minted or enqueued. A follow-up keeps its parent's target and is not refused here (the
 * named gap, pinned so it is deliberate).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { WorkspacePreferencesStore } from '../../lib/workspace-preferences.js';
import { targetRefusalFor, targetsFor } from '../../lib/dispatch-targets.js';

function createMockCollection() {
  const docs = [];
  return {
    async findOne(query) { return docs.find((d) => d._id === query._id) || null; },
    async updateOne(query, update, options = {}) {
      let doc = docs.find((d) => d._id === query._id);
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

function buildApp(captured, { workspacePreferencesStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-10-30T00:00:00.000Z', ...item };
      },
      getItemStatus: async () => null,
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { accountId: 'u1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore,
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const PATH = '/workspace/acme/api/dispatch';

describe('LIN-4016 W5 — the one target rule (lib/dispatch-targets.js)', () => {
  test('web is refused only under opencode, with the reason; claude-code and the rest are not', () => {
    assert.match(targetRefusalFor({ target: 'web', harness: 'opencode' }), /Claude Code on the web needs Claude Code/);
    assert.equal(targetRefusalFor({ target: 'web', harness: 'claude-code' }), null);
    assert.equal(targetRefusalFor({ target: 'web', harness: null }), null, 'a blank harness is not refused by the rule itself');
    assert.equal(targetRefusalFor({ target: 'cli', harness: 'opencode' }), null);
  });

  test('the list a harness offers and the refusal agree: web is not offered under opencode', () => {
    assert.deepEqual(targetsFor('opencode'), ['cli', 'dash', 'local']);
    assert.ok(targetsFor('claude-code').includes('web'));
    for (const target of ['cli', 'web', 'dash', 'local']) {
      assert.equal(targetsFor('opencode').includes(target), targetRefusalFor({ target, harness: 'opencode' }) === null);
    }
  });
});

describe('LIN-4016 W5 — POST /workspace/:urlKey/api/dispatch refuses web under opencode', () => {
  test('an explicit opencode harness with target web is refused with a reason, and nothing is enqueued', async () => {
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: new WorkspacePreferencesStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', target: 'web', harness: 'opencode' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, 'TARGET_HARNESS_REFUSED');
    assert.match(res.body.error, /Claude Code on the web needs Claude Code/);
    assert.equal(captured.item, undefined, 'a refusal enqueues nothing');
  });

  test('a blank harness that resolves to opencode from the workspace default is refused too', async () => {
    const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await store.saveWorkspacePreferences('acme', { dispatchDefaults: { harness: 'opencode' } });
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: store });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', target: 'web' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, 'TARGET_HARNESS_REFUSED');
    assert.equal(captured.item, undefined);
  });

  test('web under claude-code is accepted', async () => {
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: new WorkspacePreferencesStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', PATH, { prompt: 'run me', kind: 'implementation', target: 'web', harness: 'claude-code' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.target, 'web');
  });

  test('a follow-up keeps its parent\'s target and is not refused here (the named gap, pinned)', async () => {
    const captured = {};
    const app = buildApp(captured, { workspacePreferencesStore: new WorkspacePreferencesStore({ collection: createMockCollection() }) });
    const res = await call(app, 'post', PATH, { prompt: 'continue', kind: 'implementation', target: 'web', harness: 'opencode', followUpTo: 'parent-1' });
    assert.notEqual(res.body?.code, 'TARGET_HARNESS_REFUSED', 'a follow-up under opencode is not refused by the entrance rule');
  });
});
