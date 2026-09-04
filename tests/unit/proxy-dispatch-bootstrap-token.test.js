/**
 * LIN-1155 / LIN-1159 — route-level: the claude-code harness branch at the
 * proxy.js dispatch seams. For a resolved harness of claude-code the minted
 * bootstrap is carried on the dispatch item as `bootstrapToken` and the prompt
 * text contains NO token / curl exchange; an EXPLICIT non-claude-code harness
 * (e.g. opencode) keeps the token embedded in the prose block with no field set.
 *
 * LIN-1159 flipped the DEFAULT: an absent/null resolved harness is now interposed
 * as claude-code at the proxy dispatch boundary (applyDefaultDispatchHarness), so
 * the common (no-harness) proxy dispatch takes the MCP token-field path rather
 * than the historical prose block. The previous decision-A assertions (null/default
 * -> prose) are therefore now MCP-default assertions.
 *
 * Observed at the addItem seam (the item handed to the store), across the sites
 * that had to hoist their harness resolution above the append: plain
 * POST /dispatch, recommend-and-dispatch (verb-override), and autopilot kickoff.
 * A dedicated exposure test pins that the field never leaks onto the proxy
 * watch/list read endpoints (formatDispatchWatch / the list map are allowlists).
 *
 * Set NODE_ENV before importing routes so the test-mode short-circuit applies.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// LIN-1880: this file opened a live TLS connection to api.linear.app on every
// run. Never restored — the refusal stands for the whole file, which also
// means the dispatch referent guard stays fail-open here. See the fixture.
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const MARKER = '## Workspace API access (auto-appended)';
const MINTED = 'bootstrap-xyz';

// `dispatchDefaults` drives resolveDispatchDefaults; use it to prove the harness
// RESOLVED from workspace defaults (not just the body param) reaches the append
// after the hoist (reorder-correctness).
function buildApp(captured, { workspaceHarnessDefault = null, itemForWatch = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      createToken: async () => ({ token: MINTED, kind: 'bootstrap', scope: 'readWrite' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
      },
      getItemStatus: async () => itemForWatch,
      listItems: async () => (itemForWatch ? [itemForWatch] : []),
      listHistory: async () => ({ items: [], total: 0 })
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {
      getWorkspacePreferences: async () => (workspaceHarnessDefault ? { dispatchDefaults: { harness: workspaceHarnessDefault } } : {})
    },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
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

describe('LIN-1155 — plain POST /api/proxy/dispatch (site 2)', () => {
  test('harness claude-code -> token as field, stripped from prompt', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', issueIdentifier: 'TEST-1', harness: 'claude-code'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertMcp(captured.item);
    assert.equal(captured.item.harness, 'claude-code');
  });

  test('harness opencode -> prose token, no field', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', issueIdentifier: 'TEST-1', harness: 'opencode'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertProse(captured.item);
  });

  test('no harness (null/default) -> MCP token-field path (LIN-1159 default)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', issueIdentifier: 'TEST-1'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // LIN-1159: the common no-harness dispatch now resolves to claude-code, so the
    // token travels as the structured field and the injectable prose is gone.
    assertMcp(captured.item);
    assert.equal(captured.item.harness, 'claude-code', 'default resolved harness is claude-code');
  });

  test('reorder-correctness: no body harness but workspace default claude-code -> MCP branch fires', async () => {
    const captured = {};
    const app = buildApp(captured, { workspaceHarnessDefault: 'claude-code' });
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', issueIdentifier: 'TEST-1'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // Proves the hoisted resolveDispatchDefaults reached the append: resolved
    // harness, not just the request body, drives the gate.
    assertMcp(captured.item);
    assert.equal(captured.item.harness, 'claude-code');
  });
});

describe('LIN-1155 — recommend-and-dispatch verb-override (site 3)', () => {
  test('harness claude-code -> token as field, stripped from prompt', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', harness: 'claude-code'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'verb-override path dispatched an item');
    assertMcp(captured.item);
  });

  test('harness opencode -> prose token, no field', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', harness: 'opencode'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertProse(captured.item);
  });

  test('no harness -> MCP token-field path (LIN-1159 default)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'verb-override path dispatched an item');
    assertMcp(captured.item);
    assert.equal(captured.item.harness, 'claude-code', 'default resolved harness is claude-code');
  });
});

describe('LIN-1155 — autopilot kickoff (site 1)', () => {
  test('harness claude-code -> token as field, stripped from prompt', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/autopilot/kickoff', {
      goal: 'ship it', target: 'cli', harness: 'claude-code'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertMcp(captured.item);
  });

  test('no harness -> MCP token-field path (LIN-1159 default)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), 'post', '/api/proxy/autopilot/kickoff', {
      goal: 'ship it', target: 'cli'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertMcp(captured.item);
    assert.equal(captured.item.harness, 'claude-code', 'default resolved harness is claude-code');
  });
});

describe('LIN-1155 — exposure boundary: bootstrapToken never leaks onto proxy read endpoints', () => {
  const leaky = {
    id: 'disp-1', status: 'queued', promptName: 'Prompt', kind: 'custom',
    issueIdentifier: 'TEST-1', issueUrl: null, target: 'cli',
    bootstrapToken: 'LEAKED_TOKEN', prompt: 'x', feedback: []
  };

  test('GET /api/proxy/dispatch/:id (watch) strips bootstrapToken', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const res = await call(buildApp({}, { itemForWatch: { ...leaky, id } }), 'get', `/api/proxy/dispatch/${id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.bootstrapToken, undefined, 'watch endpoint must not expose the token');
  });

  test('GET /api/proxy/dispatch (list) strips bootstrapToken', async () => {
    const res = await call(buildApp({}, { itemForWatch: leaky }), 'get', '/api/proxy/dispatch');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    for (const item of res.body.items || []) {
      assert.equal(item.bootstrapToken, undefined, 'list endpoint must not expose the token');
    }
  });
});
