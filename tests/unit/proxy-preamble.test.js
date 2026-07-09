// Unit tests for attachProxyContext (LIN-1157) — the consolidated
// "mint a single-use bootstrap token, then append the proxy-context block"
// helper extracted from the six inline sites in routes/proxy.js (4) and
// routes/workspace-api.js (2).
//
// These exercise the helper DIRECTLY with a fake proxyTokenStore. That is
// deliberate: the research for LIN-1157 flagged a measurement gap — the two
// recommend-and-dispatch sites (proxy.js #3/#4) had no assertion that the
// preamble is actually appended, so a refactor that dropped the append on those
// paths would still go green. Testing the shared helper closes that gap for all
// six sites at once (they now all route through this one function).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { attachProxyContext } from '../../lib/proxy-preamble.js';
import { BOOTSTRAP_TOKEN_TTL_SECONDS } from '../../lib/proxy-tokens.js';

const MARKER = '## Workspace API access (auto-appended)';
const BASE = 'Do the task.';

// Fake store mirroring proxyTokenStore.createToken's shape: records calls and
// returns a configurable result (or throws).
function fakeStore({ token = 'BOOTSTRAP_TOK', result, throwErr } = {}) {
  const calls = [];
  return {
    calls,
    async createToken(urlKey, options) {
      calls.push({ urlKey, options });
      if (throwErr) throw throwErr;
      if (result !== undefined) return result;
      return { token, scope: options?.scope };
    }
  };
}

describe('attachProxyContext (LIN-1157)', () => {
  test('success: appends the block, embeds the token, and mints with the exact option shape', async () => {
    const store = fakeStore({ token: 'TOK123' });
    const out = await attachProxyContext({
      proxyTokenStore: store,
      urlKey: 'acme',
      baseUrl: 'https://host',
      issueIdentifier: 'LIN-42',
      prompt: BASE,
      label: 'dispatch-bootstrap'
    });

    assert.ok(out.startsWith(BASE), 'base prompt is preserved as the prefix');
    assert.ok(out.includes(MARKER), 'the proxy-context marker is appended');
    assert.ok(out.includes('TOK123'), 'the minted bootstrap token is embedded');

    assert.strictEqual(store.calls.length, 1, 'createToken called exactly once');
    const { urlKey, options } = store.calls[0];
    assert.strictEqual(urlKey, 'acme', 'urlKey forwarded');
    assert.strictEqual(options.kind, 'bootstrap');
    assert.strictEqual(options.scope, 'readWrite');
    assert.strictEqual(options.label, 'dispatch-bootstrap', 'per-site label threaded through');
    assert.strictEqual(options.ttl, BOOTSTRAP_TOKEN_TTL_SECONDS, 'reuses the shared TTL constant, not a hardcode');
  });

  test('label defaults to dispatch-bootstrap when omitted', async () => {
    const store = fakeStore();
    await attachProxyContext({ proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE });
    assert.strictEqual(store.calls[0].options.label, 'dispatch-bootstrap');
  });

  test('per-site label is passed verbatim (characterized by feedback-route tests)', async () => {
    const store = fakeStore();
    await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      prompt: BASE, label: 'feedback-autopilot'
    });
    assert.strictEqual(store.calls[0].options.label, 'feedback-autopilot');
  });

  test('mint returns no token: prompt returned unchanged, no marker', async () => {
    const store = fakeStore({ result: { token: null } });
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      issueIdentifier: 'LIN-42', prompt: BASE
    });
    assert.strictEqual(out, BASE, 'prompt is unchanged');
    assert.ok(!out.includes(MARKER));
    assert.strictEqual(store.calls.length, 1, 'mint was still attempted');
  });

  test('mint throws: prompt unchanged, error swallowed (graceful degradation)', async () => {
    const store = fakeStore({ throwErr: new Error('boom') });
    let out;
    await assert.doesNotReject(async () => {
      out = await attachProxyContext({
        proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
        issueIdentifier: 'LIN-42', prompt: BASE
      });
    });
    assert.strictEqual(out, BASE);
    assert.ok(!out.includes(MARKER));
  });

  test('no proxyTokenStore: prompt unchanged, no mint attempted', async () => {
    const out = await attachProxyContext({
      proxyTokenStore: null, urlKey: 'acme', baseUrl: 'https://host', prompt: BASE
    });
    assert.strictEqual(out, BASE);
    assert.ok(!out.includes(MARKER));
  });

  test('falsy baseUrl: prompt unchanged, no mint attempted', async () => {
    const store = fakeStore();
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: '', prompt: BASE
    });
    assert.strictEqual(out, BASE);
    assert.ok(!out.includes(MARKER));
    assert.strictEqual(store.calls.length, 0, 'no token minted when baseUrl is missing');
  });

  test('issueIdentifier present: block references the per-issue brief endpoint', async () => {
    const store = fakeStore();
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      issueIdentifier: 'LIN-42', prompt: BASE
    });
    assert.ok(out.includes('/api/proxy/brief/LIN-42'), 'per-issue endpoints rendered');
  });

  test('issueIdentifier null: block falls back to generic discovery endpoints', async () => {
    const store = fakeStore();
    const out = await attachProxyContext({
      proxyTokenStore: store, urlKey: 'acme', baseUrl: 'https://host',
      issueIdentifier: null, prompt: BASE
    });
    assert.ok(out.includes(MARKER));
    assert.ok(out.includes('/api/proxy/stack'), 'generic discovery endpoints rendered');
    assert.ok(!out.includes('brief/null'), 'no malformed per-issue endpoint');
  });
});
