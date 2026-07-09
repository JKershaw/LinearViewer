/**
 * LIN-1162 — route-level: the user-facing POST /workspace/:urlKey/api/dispatch
 * now attaches the workspace-API proxy-context block SERVER-SIDE when the client
 * asks (`attachProxy:true`), through the same finalizePrompt→attachProxyContext
 * seam the proxy dispatch routes use (LIN-1155/1157/1139). This closes the gap
 * where the UI dispatch path minted + appended the block in the BROWSER and so
 * could never take the claude-code MCP `bootstrapToken` field path.
 *
 * Key behaviors pinned here:
 *  - harness claude-code -> token travels as the structured `bootstrapToken` field,
 *    stripped from the prompt (no token / no `curl -X POST`).
 *  - harness opencode (explicit non-claude-code) -> historical prose block, token
 *    embedded, `bootstrapToken:null`.
 *  - BLANK harness -> prose (NOT MCP): the session route keeps applyDefaultHarness:false
 *    (LIN-1159 scoped the claude-code interpose to the proxy boundary), so a null
 *    resolved harness does NOT flip to the MCP path here. Load-bearing (LIN-1111 blank
 *    escape hatch).
 *  - attachProxy omitted/false -> no block at all, byte-for-byte the raw prompt.
 *  - attachProxy:true but the mint fails -> 503 and NO item enqueued ("surface, don't
 *    silently drop", LIN-525): the route never ships a bare prompt while the UI shows
 *    +proxy active.
 *  - attachProxy non-boolean -> 400.
 *
 * Mirrors the buildApp/call scaffolding of dispatch-route-defaults.test.js plus an
 * injected proxyTokenStore, and the assertMcp/assertProse shape of
 * proxy-dispatch-bootstrap-token.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';

const MARKER = '## Workspace API access (auto-appended)';
const MINTED = 'bootstrap-xyz';

function buildApp(captured, opts = {}) {
  // Honor an EXPLICIT null (the "store absent" case) — a plain `|| default` would
  // silently swap it back for the working mock and mask the degradation path.
  const proxyTokenStore = 'proxyTokenStore' in opts
    ? opts.proxyTokenStore
    : { createToken: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' }) };
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-07-09T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    // No workspacePreferencesStore -> blank model/harness stay null (the common
    // "user typed nothing extra" case); the UI sends an explicit harness anyway.
    proxyTokenStore
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
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const PATH = '/workspace/acme/api/dispatch';

function assertMcp(item) {
  assert.equal(item.bootstrapToken, MINTED, 'claude-code carries the token as a field');
  assert.ok(item.prompt.includes(MARKER), 'still gets the access block');
  assert.ok(!item.prompt.includes(MINTED), 'token is NOT in the prompt text');
  assert.ok(!item.prompt.includes('curl -X POST'), 'no curl exchange command in the prompt');
}
function assertProse(item) {
  assert.equal(item.bootstrapToken, null, 'no field when the token is in the prose');
  assert.ok(item.prompt.includes(MARKER));
  assert.ok(item.prompt.includes(MINTED), 'token stays embedded in the prose');
  assert.ok(item.prompt.includes('curl -X POST'), 'prose keeps the curl exchange');
}

describe('LIN-1162 — server-side proxy-context attach on UI dispatch', () => {
  test('harness claude-code + attachProxy:true -> MCP token-field path', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertMcp(captured.item);
    assert.equal(captured.item.harness, 'claude-code');
    // The per-issue brief endpoint is threaded from issueIdentifier.
    assert.ok(captured.item.prompt.includes('/api/proxy/brief/LIN-42'));
  });

  test('harness opencode + attachProxy:true -> prose token, no field', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', harness: 'opencode', attachProxy: true
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertProse(captured.item);
    assert.equal(captured.item.harness, 'opencode');
  });

  test('BLANK harness + attachProxy:true -> prose (applyDefaultHarness:false preserved, NOT MCP)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', attachProxy: true
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // Null resolved harness stays null here (no claude-code interpose), so the
    // MCP gate does NOT fire — the block is the historical prose with the token.
    assert.strictEqual(captured.item.harness, null);
    assertProse(captured.item);
  });

  test('attachProxy omitted -> no proxy block, raw prompt unchanged, bootstrapToken null', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', harness: 'claude-code'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.prompt, 'do the thing');
    assert.strictEqual(captured.item.bootstrapToken, null);
    assert.ok(!captured.item.prompt.includes(MARKER));
  });

  test('attachProxy:false -> no proxy block (explicit opt-out)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', harness: 'claude-code', attachProxy: false
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(captured.item.prompt, 'do the thing');
    assert.strictEqual(captured.item.bootstrapToken, null);
  });

  test('attachProxy non-boolean -> 400', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', PATH, {
      prompt: 'do the thing', attachProxy: 'yes'
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /attachProxy must be a boolean/);
    assert.equal(captured.item, undefined, 'nothing enqueued on a bad request');
  });
});

describe('LIN-1162 — surface, don\'t silently drop when the server mint fails', () => {
  test('mint returns no token -> 503 and NO item enqueued', async () => {
    const captured = {};
    const app = buildApp(captured, {
      proxyTokenStore: { createToken: async () => ({ token: null }) }
    });
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.match(res.body.error, /proxy token could not be created/i);
    assert.equal(captured.item, undefined, 'a bare prompt is NOT enqueued on mint failure');
  });

  test('mint throws -> 503 and NO item enqueued', async () => {
    const captured = {};
    const app = buildApp(captured, {
      proxyTokenStore: { createToken: async () => { throw new Error('rate limited'); } }
    });
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(captured.item, undefined, 'a bare prompt is NOT enqueued on mint failure');
  });

  test('proxyTokenStore absent -> attach cannot happen -> 503 (never a silent bare dispatch)', async () => {
    const captured = {};
    const app = buildApp(captured, { proxyTokenStore: null });
    const res = await call(app, 'post', PATH, {
      prompt: 'do the thing', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.equal(captured.item, undefined);
  });
});
