/**
 * LIN-805 — route-level: POST /api/proxy/dispatch must NOT re-append the
 * proxy-context block by default when `followUpTo` is set.
 *
 * A follow-up beat resumes a warm session that already received the
 * "Workspace API access" block on its FIRST beat, so re-appending it on every
 * later beat is redundant and risks confusing the worker. The suppression lives
 * in the route (it adjusts the append default based on followUpTo), so it must
 * be observed at the dispatch seam by inspecting the prompt handed to addItem.
 *
 * Set NODE_ENV before importing the routes so the test-mode short-circuit
 * (token === 'test-token') and module-level rate-limiter skips apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

// The marker line emitted by buildProxyContextPreamble (lib/proxy-preamble.js).
const PROXY_CONTEXT_MARKER = '## Workspace API access (auto-appended)';

function buildApp(captured, { createToken, getItemStatus } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      }),
      // LIN-376: the dispatch path mints a single-use bootstrap to embed in the
      // preamble instead of replaying the caller's token. LIN-1429: capture the
      // mint options (urlKey, createdBy, label, …) so route-level tests can
      // observe threading, and accept an override so fail-closed tests can
      // simulate a mint failure without touching the default behaviour.
      createToken: createToken || (async (urlKey, options) => {
        captured.mintCalls = captured.mintCalls || [];
        captured.mintCalls.push({ urlKey, options });
        return { token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' };
      })
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
      // Omitted by default (matching every other test in this file, which must
      // stay structurally immune to anchor-based harness inheritance): the
      // factory only looks up an anchor when this method exists at all
      // (dispatch-factory.js:105). Tests exercising inheritance (LIN-1431)
      // pass it in explicitly.
      ...(getItemStatus ? { getItemStatus } : {})
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
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
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const FOLLOW_UP_ID = '11111111-2222-3333-4444-555555555555';

function hasProxyContext(prompt) {
  return typeof prompt === 'string' && prompt.includes(PROXY_CONTEXT_MARKER);
}

describe('LIN-805 — proxy-context append on follow-up dispatches', () => {
  test('a fresh dispatch (no followUpTo) appends the proxy-context block by default', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing',
      issueIdentifier: 'TEST-1'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(hasProxyContext(captured.item.prompt),
      'fresh dispatch must keep the default-ON proxy-context append');
  });

  test('a follow-up dispatch (followUpTo set) does NOT append the proxy-context block by default', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: FOLLOW_UP_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.followUpTo, FOLLOW_UP_ID, 'followUpTo is forwarded');
    assert.ok(!hasProxyContext(captured.item.prompt),
      'a warm-session follow-up must NOT re-append the proxy-context block');
    assert.equal(captured.item.prompt, 'next beat',
      'the follow-up prompt is forwarded verbatim with nothing appended');
  });

  test('LIN-1429 (cell #7, THE FIX): a claude-code follow-up still mints a live credential even though prose stays suppressed', async () => {
    const captured = {};
    const app = buildApp(captured);
    // No `harness` supplied: workspacePreferencesStore.getWorkspacePreferences
    // resolves to {}, so LIN-1159's applyDefaultDispatchHarness interposes
    // claude-code — this is the common, majority-path dispatch.
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: FOLLOW_UP_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(!hasProxyContext(captured.item.prompt),
      'prose stays suppressed on a warm follow-up (LIN-805, unchanged)');
    assert.equal(captured.item.prompt, 'next beat',
      'the prompt is forwarded verbatim — provisioning never touches it');
    // Assert the EXACT token, not truthiness: branch 2 either returns a token
    // or throws (LIN-1175), so a null/undefined here would be a silent
    // contract violation that assert.ok(defined) would let through.
    assert.equal(captured.item.bootstrapToken, 'bootstrap-xyz',
      'a broker-dependent follow-up must still receive a LIVE credential — this is the bug LIN-1429 fixes');
  });

  test('an explicit appendProxyContext:true forces the block back on for a follow-up', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: FOLLOW_UP_ID,
      appendProxyContext: true
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(hasProxyContext(captured.item.prompt),
      'an explicit appendProxyContext:true opts a follow-up back in');
    // Cell #9: branch 1 (attachProxyContext) mints once internally; branch 2 is
    // an `else if` and must never double-mint on this opt-in path.
    assert.equal(captured.item.bootstrapToken, 'bootstrap-xyz',
      'the append branch already carries the token out-of-band for claude-code — no double-mint');
  });

  test('the existing opt-out (appendProxyContext:false) still suppresses on a fresh dispatch', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'self-contained prompt',
      issueIdentifier: 'TEST-1',
      appendProxyContext: false
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(!hasProxyContext(captured.item.prompt),
      'appendProxyContext:false still opts a fresh dispatch out');
    // Cell #5, the near-drift the plan calls out: an explicit opt-out must land
    // on branch 3 (neither append nor mint), never branch 2.
    assert.equal(captured.item.bootstrapToken, null,
      'an explicit opt-out means "I don\'t want proxy context" — it must not mint a credential either');
  });

  test('LIN-1429 (cell #8): a non-claude-code follow-up mints nothing and does not throw', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      harness: 'opencode',
      followUpTo: FOLLOW_UP_ID
    });

    // The 201 (not 503) is what distinguishes "no mint attempted" from
    // "fail-closed threw and got mapped to a transient 503".
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(!hasProxyContext(captured.item.prompt), 'prose stays suppressed');
    assert.equal(captured.item.bootstrapToken, null,
      'a prose-path token has no channel to reach the worker — minting one would be an unreferenceable credential');
  });

  test('LIN-1429 (cell #11): a follow-up opt-out on a claude-code harness still mints nothing', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: FOLLOW_UP_ID,
      appendProxyContext: false
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(!hasProxyContext(captured.item.prompt), 'no prose');
    assert.equal(captured.item.bootstrapToken, null,
      'explicitOptOut is the caller\'s own instruction — distinct from the follow-up default, and it must suppress the mint too');
  });
});

describe('LIN-1429 — claude-code follow-up fails CLOSED when provisioning cannot mint (LIN-1175)', () => {
  test('mint throws: dispatch is refused with 503, nothing is enqueued', async () => {
    const captured = {};
    const app = buildApp(captured, {
      createToken: async () => { throw new Error('token store unavailable'); }
    });
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: FOLLOW_UP_ID
    });

    assert.equal(res.status, 503, `expected 503, got ${res.status}: ${JSON.stringify(res.body)}`);
    // The actual LIN-1175 property: the item never reaches addItem. A bare 503
    // check would not prove that — the dispatch must be refused BEFORE enqueue,
    // never launch a credential-less session.
    assert.equal(captured.item, undefined, 'no item was ever enqueued');
  });

  test('mint returns no token: dispatch is refused with 503, nothing is enqueued', async () => {
    const captured = {};
    const app = buildApp(captured, {
      createToken: async () => ({ token: null })
    });
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: FOLLOW_UP_ID
    });

    assert.equal(res.status, 503, `expected 503, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item, undefined, 'no item was ever enqueued');
  });
});

describe('LIN-1431 (S3 §1 ruling) — harness inheritance reaches this route too', () => {
  test('a follow-up onto an opencode anchor stays opencode, not interposed to claude-code', async () => {
    const captured = {};
    let getItemStatusCalls = 0;
    const app = buildApp(captured, {
      getItemStatus: async (_urlKey, id) => {
        getItemStatusCalls++;
        return id === FOLLOW_UP_ID ? { harness: 'opencode' } : null;
      }
    });
    // No explicit harness, no preset: this route's applyDefaultHarness
    // defaults to true (unchanged), so absent inheritance the LIN-1159
    // interpose would silently re-harness the resume to claude-code (the bug
    // this ruling accepts fixing, per the plan's §1). With inheritance, the
    // anchor's own harness wins before the interpose ever runs.
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: FOLLOW_UP_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(getItemStatusCalls > 0, 'the anchor must actually be consulted, not just structurally reachable');
    assert.equal(captured.item.harness, 'opencode', 'the resume stays on the harness of the session it resumes');
    assert.ok(!hasProxyContext(captured.item.prompt), 'opencode takes the prose branch, not MCP');
    assert.equal(captured.item.bootstrapToken, null, 'opencode is not claude-code — no credential is minted for it');
  });
});
