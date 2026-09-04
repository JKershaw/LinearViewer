/**
 * LIN-2370 — the two BROWSER copy-prompt blocks and the declared provider identity.
 *
 * LIN-2354 made the server-rendered agent-facing prose provider-neutral but
 * explicitly deferred two client-side copies, which kept emitting
 * "currently backed by Linear" to every workspace:
 *
 *   - public/proxy.js   `buildAgentPrompt` (the Proxy page's copy button)
 *   - public/common.js  `buildBlock`       (the `+proxy` prompt append)
 *
 * Both are AGENT-FACING: a human copies the block and pastes it into a worker,
 * so on a GitHub-, Jira- or Local-backed workspace the first thing that worker
 * read about its own tooling was false.
 *
 * The fix needed a server→client provider channel. Both sites already mint a
 * bootstrap through `POST /workspace/:urlKey/api/proxy/tokens` before composing
 * their block, so the mint response carries the name — no new endpoint and no
 * page-shell data attribute. This file pins BOTH halves of that channel:
 *
 *   Part 1 — the route emits `providerDisplayName`, gated on LIN-2354's
 *            `.declared` discriminator, and never fails a mint to compute it.
 *   Part 2 — the browser builders name a declared provider and OMIT the clause
 *            entirely when it is absent (never "unknown", never Linear).
 *
 * The omit-don't-guess assertions are the load-bearing ones: a hedge or a
 * fallback to Linear reproduces the exact defect LIN-2354/LIN-2370 exist to
 * remove, and neither would be caught by asserting only the declared case.
 *
 * Run with: node --test tests/unit/lin-2370-browser-copy-prompt-provider-identity.test.js
 *
 * NODE_ENV must be set before importing routes/proxy.js — the module-level
 * proxyTokenCreationLimiter (10/15min/IP) is shared across every
 * createProxyRoutes() instance in the process (LIN-2505), and this file makes
 * several route-level mints over real HTTP.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = '/workspace/acme/api/proxy/tokens';

// =============================================================================
// Part 1 — the server half: POST .../api/proxy/tokens carries the declared name
// =============================================================================

// Scaffolding mirrors tests/unit/proxy-token-route-ownerless.test.js: the real
// route factory over the real ProxyTokenStore, so these assertions run the
// actual chain rather than a reimplementation of it.
function inMemoryCollection() {
  const docs = [];
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) {
      return docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v)) || null;
    },
    find(query = {}) {
      const results = docs.filter(d => Object.entries(query).every(([k, v]) => d[k] === v));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(query, update) {
      const doc = docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v));
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne() { return { deletedCount: 0 }; },
    async deleteMany() { return { deletedCount: 0 }; },
  };
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    return { statusCode: res.status, jsonBody: JSON.parse(await res.text()) };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/**
 * Mint through the real route. `resolveWorkspaceAccess` is what decides the
 * DECLARED provider: its `provider` field is the pre-fallback name, which is
 * exactly the discriminator `declaredProviderDisplayName` gates on.
 */
async function mint({ resolveWorkspaceAccess, injectedProvider }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: new ProxyTokenStore({ collection: inMemoryCollection() }),
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'acme' };
      req.session = { accountId: 'account-A', features: { proxy: true } };
      next();
    },
    getWorkspaceAccessToken: () => null,
    resolveWorkspaceAccess,
    ...(injectedProvider ? { provider: injectedProvider } : {}),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {}, freeTierStore: {},
  }));
  return call(app, 'post', TOKENS_PATH, { label: 'prompt-proxy', scope: 'readWrite', bootstrap: true });
}

describe('LIN-2370 Part 1 — the mint response carries the DECLARED provider name', () => {
  test('a declared non-Linear provider is named', async () => {
    const res = await mint({
      resolveWorkspaceAccess: async () => ({ token: 'tok', provider: 'github', reason: 'ok' }),
      injectedProvider: { name: 'github', ui: { displayName: 'GitHub Issues' } },
    });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.providerDisplayName, 'GitHub Issues');
    // The mint itself is untouched — the channel is additive.
    assert.ok(res.jsonBody.token, 'a token is still minted');
    assert.equal(res.jsonBody.kind, 'bootstrap');
  });

  test('an UNDECLARED provider yields null — never the Linear fallback (the defect)', async () => {
    // A workspace with no `provider` field. `getProviderForWorkspace` applies
    // LEGACY_DEFAULT_PROVIDER, so `.displayName` reads 'Linear' here — reading
    // it instead of `.declared` is precisely the bug. `.declared` is null, so
    // the clause must be dropped.
    const res = await mint({
      resolveWorkspaceAccess: async () => ({ token: 'tok', provider: null, reason: 'ok' }),
    });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.providerDisplayName, null,
      'an undeclared provider must not resolve to Linear via the legacy fallback');
    assert.ok(res.jsonBody.token, 'a token is still minted');
  });

  test('a failing provider resolve degrades to null and NEVER fails the mint', async () => {
    // Resolution is this route's first provider IO. A token the caller can no
    // longer obtain would be far worse than an unnamed provider, so any throw
    // must degrade to the omitted clause.
    const res = await mint({
      resolveWorkspaceAccess: async () => { throw new Error('upstream down'); },
    });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.providerDisplayName, null);
    assert.ok(res.jsonBody.token, 'the mint survives a provider-resolution failure');
  });
});

// =============================================================================
// Part 2 — the browser half: both builders name it, or omit the clause
// =============================================================================

const CLAUSE = /currently backed by/;

/**
 * vm-sandbox the REAL public/common.js (the seam tests/unit/reply-delivery-contract.js
 * established) so `window.ProxyToggle.buildBlock` is the shipped function, not a
 * reimplementation of it. `document` is only the bare stub common.js's top-level
 * auto-init needs to register its DOMContentLoaded listener at load time.
 */
function loadProxyToggle() {
  const sandbox = {
    window: { location: { origin: 'http://test.local' } },
    document: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    console,
    fetch() { throw new Error('fetch should not be called'); },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(__dirname, '../../public/common.js'), 'utf8'),
    sandbox, { filename: 'common.js' });
  return sandbox.window.ProxyToggle;
}

describe('LIN-2370 Part 2a — public/common.js buildBlock (the +proxy append)', () => {
  test('names a declared provider', () => {
    const out = loadProxyToggle().buildBlock('BOOTSTRAP', 'Jira');
    assert.match(out, /\(source-neutral; currently backed by Jira\)/);
  });

  test('omits the clause entirely when the provider is unresolved', () => {
    const toggle = loadProxyToggle();
    for (const absent of [null, undefined, '']) {
      const out = toggle.buildBlock('BOOTSTRAP', absent);
      assert.doesNotMatch(out, CLAUSE,
        `${JSON.stringify(absent)}: no backing-provider claim at all when unresolved`);
      assert.doesNotMatch(out, /Linear/,
        `${JSON.stringify(absent)}: must never fall back to Linear`);
      // Neutral, not hedged — the block still reads as a complete sentence.
      assert.match(out, /workspace API proxy \(source-neutral\)\. Use it/);
    }
  });

  test('the block is otherwise unchanged — still carries the token and the marker', () => {
    const out = loadProxyToggle().buildBlock('BOOTSTRAP', 'Linear');
    assert.match(out, /## Workspace API access/);
    assert.match(out, /BOOTSTRAP/);
    assert.match(out, /\(source-neutral; currently backed by Linear\)/,
      'a genuinely Linear-backed workspace still reads exactly as before');
  });
});

describe('LIN-2370 Part 2b — public/proxy.js buildAgentPrompt (the Proxy page copy button)', () => {
  // public/proxy.js is a DOM-bound IIFE that returns early without its page
  // elements, so its builder is not reachable through a window export. Pin the
  // shipped source directly: the clause must be conditional on the parameter,
  // and the Linear literal must be gone.
  const SRC = readFileSync(join(__dirname, '../../public/proxy.js'), 'utf8');

  test('buildAgentPrompt takes the declared provider name as a parameter', () => {
    assert.match(SRC, /function buildAgentPrompt\(token, scope, providerDisplayName\)/);
  });

  test('the clause is conditional, and omitted rather than hedged when absent', () => {
    assert.match(SRC, /const backing = providerDisplayName \? `; currently backed by \$\{providerDisplayName\}` : '';/);
    assert.match(SRC, /workspace API proxy \(source-neutral\$\{backing\}\)/);
  });

  test('no unconditional Linear claim survives anywhere in the file', () => {
    assert.doesNotMatch(SRC, /currently backed by Linear/,
      'the hardcoded claim this ticket exists to remove');
  });

  test('the call site threads the name from the mint response', () => {
    assert.match(SRC, /buildAgentPrompt\(token, scope, data\.providerDisplayName \|\| null\)/);
  });
});
