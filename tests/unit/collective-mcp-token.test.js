/**
 * LIN-1173 — Collective fan-out routes token delivery through the shared
 * finalizePrompt → attachProxyContext seam.
 *
 * Follow-up from LIN-1162's class check: the Collective fan-out was the remaining
 * dispatch path that minted a readWrite bootstrap and embedded it INLINE in the
 * participant prompt prose (buildLinearAccessBlock), passing a plain prompt with no
 * finalizePrompt — so a claude-code participant received the injection-prone
 * in-prose token and NO structured `bootstrapToken` field. This pins the fix:
 *
 *   - claude-code participant (resolved harness) → the bootstrap travels out-of-band
 *     as the `bootstrapToken` dispatch-item field and the prompt carries NO token /
 *     curl prose (attachProxyContext, mcp mode);
 *   - every other harness (incl. null default) → the byte-identical bespoke
 *     Linear-access prose block with the token embedded inline, bootstrapToken null;
 *   - fail-closed (LIN-1175): a claude-code participant whose token cannot be minted
 *     is marked ok:false rather than dispatched credential-less.
 *
 * Run with: node --test tests/unit/collective-mcp-token.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCollectiveRoutes } from '../../routes/collective.js';
import { WorkspacePreferencesStore } from '../../lib/workspace-preferences.js';

function createMockCollection() {
  const docs = [];
  return {
    async findOne(query) { return docs.find(d => d._id === query._id) || null; },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => d._id === query._id);
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { _id: query._id, ...(update.$setOnInsert || {}) };
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1 };
    }
  };
}

const WORKSPACES = [
  { urlKey: 'alpha', name: 'Alpha Project' },
  { urlKey: 'bravo', name: 'Bravo Project' },
];

// A proxy-token store that mints a deterministic per-workspace bootstrap so the
// test can assert exactly which token was (or was not) placed where.
function mintingStore(minted) {
  return {
    async createToken(urlKey, opts) {
      minted.push({ urlKey, opts });
      return { token: `boot_${urlKey}` };
    },
  };
}

function buildApp(captured, { workspacePreferencesStore, proxyTokenStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createCollectiveRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.push({ urlKey, item });
        return { _id: `disp-${captured.length}`, ...item };
      },
    },
    proxyTokenStore: proxyTokenStore ?? null,
    yapClient: { baseUrl: 'https://yap.test' },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    workspacePreferencesStore,
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1', features: { collective: true }, workspaces: WORKSPACES };
      next();
    },
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
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
    await new Promise(resolve => server.close(resolve));
  }
}

const START_PATH = '/workspace/alpha/collective/start';

async function prefsWith(defaults) {
  const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
  for (const [urlKey, dispatchDefaults] of Object.entries(defaults)) {
    await store.saveWorkspacePreferences(urlKey, { dispatchDefaults });
  }
  return store;
}

describe('LIN-1173 — Collective fan-out token delivery via attachProxyContext', () => {
  test('claude-code participant: token travels as the bootstrapToken field, NOT in prompt prose', async () => {
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'claude-code' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    const { item } = captured[0];

    // The structured field carries the minted bootstrap...
    assert.equal(item.harness, 'claude-code');
    assert.equal(item.bootstrapToken, 'boot_alpha', 'bootstrap must travel as the structured field');
    // ...and the prompt carries NO token and NO curl-exchange prose.
    assert.ok(!item.prompt.includes('boot_alpha'), 'claude-code prompt must not embed the token');
    assert.ok(!item.prompt.includes('FIRST, exchange your single-use bootstrap token'), 'no bespoke inline exchange prose');
    assert.ok(!item.prompt.includes('curl -X POST -H "Authorization: Bearer'), 'no curl exchange in prompt');
    // The shared MCP access block is what got appended instead.
    assert.ok(item.prompt.includes('Obtain your working token from your configured dispatch MCP tool'), 'MCP access block present');
    // A single-use bootstrap was minted for the participant workspace.
    assert.ok(minted.some(m => m.urlKey === 'alpha' && m.opts.kind === 'bootstrap' && m.opts.scope === 'readWrite'));
  });

  test('non-claude-code participant: byte-identical inline prose block, no bootstrapToken field', async () => {
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'opencode' } });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    const { item } = captured[0];

    assert.equal(item.harness, 'opencode');
    assert.strictEqual(item.bootstrapToken, null, 'prose path carries no structured token field');
    // The bespoke Linear-access block IS present, with the token embedded inline.
    assert.ok(item.prompt.includes('## Workspace API access (auto-appended)'), 'bespoke access block present');
    assert.ok(item.prompt.includes('FIRST, exchange your single-use bootstrap token for a working token:'), 'inline exchange prose present');
    assert.ok(item.prompt.includes('boot_alpha'), 'token embedded inline for a prose harness');
    // NOT the MCP block.
    assert.ok(!item.prompt.includes('Obtain your working token from your configured dispatch MCP tool'), 'no MCP block on the prose path');
  });

  test('claude-code fail-closed: an un-mintable token marks the participant ok:false, never dispatches credential-less', async () => {
    const workspacePreferencesStore = await prefsWith({ alpha: { harness: 'claude-code' } });
    const captured = [];
    // No proxy-token store → attachProxyContext throws in mcp mode (LIN-1175).
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: null });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 0, 'a credential-less claude-code participant must NOT be enqueued');
    assert.equal(res.body.dispatched.length, 1);
    assert.equal(res.body.dispatched[0].ok, false, 'the participant is reported failed');
  });

  test('mixed room: claude-code seat gets the field, opencode seat gets inline prose', async () => {
    const workspacePreferencesStore = await prefsWith({
      alpha: { harness: 'claude-code' },
      bravo: { harness: 'opencode' },
    });
    const minted = [];
    const captured = [];
    const app = buildApp(captured, { workspacePreferencesStore, proxyTokenStore: mintingStore(minted) });

    const res = await call(app, 'post', START_PATH, {
      channel: '#room',
      characters: [{ workspaceUrlKey: 'alpha' }, { workspaceUrlKey: 'bravo' }],
      target: 'cli',
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const byKey = Object.fromEntries(captured.map(c => [c.urlKey, c.item]));

    // alpha (claude-code): field-delivered, no inline token.
    assert.equal(byKey.alpha.bootstrapToken, 'boot_alpha');
    assert.ok(!byKey.alpha.prompt.includes('boot_alpha'));
    // bravo (opencode): inline prose, no field.
    assert.strictEqual(byKey.bravo.bootstrapToken, null);
    assert.ok(byKey.bravo.prompt.includes('boot_bravo'));
  });
});
