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
 * Mint through the real route. The DECLARED provider is `workspace.provider` —
 * the raw field on the session row `workspaceFromUrl` resolves — so the harness
 * drives it there. `resolveWorkspaceAccess` is deliberately wired to throw: this
 * route must not touch the provider-ACCESS lane at all to name the workspace
 * (see the route comment), so any call would surface here as a failure rather
 * than silently costing an interactive mint a live credential round trip.
 */
async function mint({ provider }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: new ProxyTokenStore({ collection: inMemoryCollection() }),
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'acme', ...(provider === undefined ? {} : { provider }) };
      req.session = { accountId: 'account-A', features: { proxy: true } };
      next();
    },
    getWorkspaceAccessToken: () => null,
    resolveWorkspaceAccess: () => {
      throw new Error('the mint route must not resolve provider ACCESS to name the provider');
    },
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {}, freeTierStore: {},
  }));
  return call(app, 'post', TOKENS_PATH, { label: 'prompt-proxy', scope: 'readWrite', bootstrap: true });
}

describe('LIN-2370 Part 1 — the mint response carries the DECLARED provider name', () => {
  test('a declared non-Linear provider is named', async () => {
    const res = await mint({ provider: 'jira' });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.providerDisplayName, 'Jira');
    // The mint itself is untouched — the channel is additive.
    assert.ok(res.jsonBody.token, 'a token is still minted');
    assert.equal(res.jsonBody.kind, 'bootstrap');
  });

  test('a declared Linear workspace still reads exactly as before', async () => {
    const res = await mint({ provider: 'linear' });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.providerDisplayName, 'Linear');
  });

  test('an UNDECLARED provider yields null — never the Linear fallback (the defect)', async () => {
    // A legacy workspace row with no `provider` field. `getProviderForWorkspace`
    // would apply LEGACY_DEFAULT_PROVIDER and read 'Linear' here — using it
    // instead of the fallback-free `getProvider` IS the bug. The clause must be
    // dropped instead.
    for (const absent of [undefined, null, '']) {
      const res = await mint({ provider: absent });
      assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
      assert.equal(res.jsonBody.providerDisplayName, null,
        `${JSON.stringify(absent)}: an undeclared provider must not resolve to Linear`);
      assert.ok(res.jsonBody.token, 'a token is still minted');
    }
  });

  test('an unknown provider name yields null rather than throwing', async () => {
    const res = await mint({ provider: 'not-a-registered-provider' });

    assert.equal(res.statusCode, 201, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.providerDisplayName, null);
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

/**
 * Drive the REAL public/proxy.js copy button in a vm sandbox and return the
 * prompt it composed.
 *
 * public/proxy.js is a DOM-bound IIFE with no window export, so an earlier draft
 * of this file asserted regexes against its source instead. Review was right that
 * this is coverage-by-appearance — it pins formatting and would pass on a
 * behaviour change the regexes do not happen to spell out. The builder IS
 * reachable: the generate-button handler writes the composed prompt to
 * `promptOutput.textContent`, so a stub document plus a stub `window.api` gets
 * the shipped function's real output. This matters because no e2e touches the
 * Proxy page copy button at all (`grep proxy-generate-btn tests/e2e/` is empty),
 * making this the only coverage standing behind that call site.
 */
async function runCopyButton(providerDisplayName) {
  const el = (extra = {}) => ({
    textContent: '', dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) { this._handlers = this._handlers || {}; this._handlers[type] = fn; },
    querySelector: () => null, closest: () => null,
    ...extra,
  });

  const generateBtn = el();
  const promptOutput = el();
  const tokenList = el({ dataset: { urlKey: 'acme' } });

  const byId = { 'proxy-generate-btn': generateBtn, 'proxy-prompt-output': promptOutput };
  const bySelector = { '.proxy-token-list': tokenList };

  const sandbox = {
    window: {
      location: { origin: 'https://harbour.test' },
      // The mint response is the channel under test.
      api: async () => ({ token: 'BOOTSTRAP', providerDisplayName }),
      relativeTime: () => '',
    },
    document: {
      getElementById: (id) => byId[id] || null,
      querySelector: (sel) => bySelector[sel] || null,
      addEventListener() {},
    },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout, clearTimeout, console,
    escapeHtml: (v) => String(v),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // The IIFE's trailing init (refreshTokenCount / loadCredentialHealth) fires
  // fetches through the same stubbed window.api; nothing there affects the
  // prompt, and any rejection is an unhandled promise, not a load failure.
  vm.runInContext(readFileSync(join(__dirname, '../../public/proxy.js'), 'utf8'),
    sandbox, { filename: 'proxy.js' });

  await generateBtn._handlers.click();
  return promptOutput.textContent;
}

describe('LIN-2370 Part 2b — public/proxy.js buildAgentPrompt (the Proxy page copy button)', () => {
  test('names a declared provider — the shipped builder, actually executed', async () => {
    const out = await runCopyButton('Jira');
    assert.match(out, /^You have access to a workspace API proxy \(source-neutral; currently backed by Jira\)\./);
    // The mint's own token still reaches the copied prompt.
    assert.match(out, /Bearer BOOTSTRAP/);
  });

  test('Linear still reads exactly as before on a Linear-backed workspace', async () => {
    assert.match(await runCopyButton('Linear'),
      /workspace API proxy \(source-neutral; currently backed by Linear\)/);
  });

  test('omits the clause entirely when the provider is unresolved', async () => {
    for (const absent of [null, undefined, '']) {
      const out = await runCopyButton(absent);
      assert.doesNotMatch(out, /currently backed by/,
        `${JSON.stringify(absent)}: no backing-provider claim at all when unresolved`);
      assert.doesNotMatch(out, /Linear/,
        `${JSON.stringify(absent)}: must never fall back to Linear`);
      // Neutral, not hedged — still a complete sentence.
      assert.match(out, /^You have access to a workspace API proxy \(source-neutral\)\. Use it to read/);
    }
  });

  test('no unconditional Linear claim survives anywhere in the file', () => {
    assert.doesNotMatch(readFileSync(join(__dirname, '../../public/proxy.js'), 'utf8'),
      /currently backed by Linear/,
      'the hardcoded claim this ticket exists to remove');
  });
});
