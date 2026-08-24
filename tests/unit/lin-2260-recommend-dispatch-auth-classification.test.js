/**
 * LIN-2260 — POST /api/proxy/recommend-and-dispatch collapsed a retryable
 * upstream Linear auth failure into an opaque, non-classified 500
 * `{"error":"Failed to dispatch prompt"}`. GET /issues/:id (and, since
 * LIN-2216, POST /api/proxy/autopilot/kickoff) already relay the same
 * upstream shape honestly as `503 / code: LINEAR_AUTH / category: auth /
 * retryable: true` (or a terminal `401` when our own bookkeeping already
 * believed the credential was dead). This closes the same gap on
 * recommend-and-dispatch's THREE catch sites — the verb-override arm, the
 * LLM-driven arm, and the outer catch-all — reusing the existing
 * `graphqlErrorStatus()` / `graphqlErrorDetail()` / `graphqlErrorExtra()`
 * classifiers rather than inventing a new shape (mirrors
 * tests/unit/lin-2216-transient-vs-terminal-auth.test.js's Block C).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

function linearAuthError() {
  const err = new Error('You need to authenticate to access this operation.');
  err.response = {
    status: 401,
    errors: [{ message: 'You need to authenticate to access this operation.', extensions: { statusCode: 401, userError: true } }],
  };
  return err;
}

const LIVE_CREDENTIAL = async () => ({
  token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan',
  expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('test-token'),
});
const DEAD_CREDENTIAL = async () => ({
  token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan',
  expiresAt: Date.now() - 1000, credentialFingerprint: fingerprintCredential('test-token'),
});

function buildApp({ resolveWorkspaceAccess = LIVE_CREDENTIAL, addItem } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess,
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { addItem },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function post(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer agent-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => null);
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const ENDPOINT = '/api/proxy/recommend-and-dispatch';

describe('LIN-2260 — recommend-and-dispatch: LLM-driven arm (no `kind`) upstream-auth classification', () => {
  test('a live-looking credential rejected by the dispatch-creation step surfaces a retryable 503/LINEAR_AUTH, never the old bare 500', async () => {
    const { status, body } = await post(
      buildApp({ resolveWorkspaceAccess: LIVE_CREDENTIAL, addItem: async () => { throw linearAuthError(); } }),
      ENDPOINT,
      { issueIdentifier: 'TEST-1' }
    );
    assert.equal(status, 503, `expected 503, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.error, 'Failed to dispatch prompt');
    assert.equal(body.code, 'LINEAR_AUTH');
    assert.equal(body.category, 'auth');
    assert.equal(body.retryable, true);
    assert.ok(body.detail, 'a safe, Linear-authored detail is surfaced');
  });

  test('a credential our own bookkeeping already believed was dead stays a terminal 401 with the same code', async () => {
    const { status, body } = await post(
      buildApp({ resolveWorkspaceAccess: DEAD_CREDENTIAL, addItem: async () => { throw linearAuthError(); } }),
      ENDPOINT,
      { issueIdentifier: 'TEST-1' }
    );
    assert.equal(status, 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.code, 'LINEAR_AUTH');
    assert.equal(body.retryable, false);
  });

  test('duplicate-dispatch refusal (LIN-1656) is unaffected — still a plain 409, never routed through the new auth classification', async () => {
    const dup = new Error('A dispatch for this task was already queued moments ago');
    dup.duplicateDispatch = { id: 'dup-1', retryAfter: 5 };
    const { status, body } = await post(
      buildApp({ addItem: async () => { throw dup; } }),
      ENDPOINT,
      { issueIdentifier: 'TEST-1' }
    );
    assert.equal(status, 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.id, 'dup-1');
    assert.equal(body.code, undefined, 'the duplicate-dispatch 409 carries no LINEAR_AUTH-shaped code');
  });

  test('the missing-bootstrap-token refusal (LIN-1175) is unaffected — still 503 with its own message, not reclassified with a LINEAR_AUTH code', async () => {
    const attachFailed = new Error('token mint failed');
    attachFailed.proxyAttachFailed = true;
    const { status, body } = await post(
      buildApp({ addItem: async () => { throw attachFailed; } }),
      ENDPOINT,
      { issueIdentifier: 'TEST-1' }
    );
    assert.equal(status, 503, `expected 503, got ${status}: ${JSON.stringify(body)}`);
    assert.match(body.error, /LIN-1175/);
    assert.equal(body.code, undefined, 'the token-attach 503 keeps its own message, not the LINEAR_AUTH envelope');
  });

  test('a genuinely unexpected, non-auth-shaped error still falls to the untouched generic 500', async () => {
    const { status, body } = await post(
      buildApp({ addItem: async () => { throw new Error('boom, totally unrelated'); } }),
      ENDPOINT,
      { issueIdentifier: 'TEST-1' }
    );
    assert.equal(status, 500, `expected 500, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.error, 'Failed to dispatch prompt');
    assert.equal(body.code, undefined, 'a genuinely internal failure carries no code — only the classified branch does');
  });
});

describe('LIN-2260 — recommend-and-dispatch: verb-override arm (`kind` set) upstream-auth classification', () => {
  test('a live-looking credential rejected by the dispatch-creation step surfaces a retryable 503/LINEAR_AUTH', async () => {
    const { status, body } = await post(
      buildApp({ resolveWorkspaceAccess: LIVE_CREDENTIAL, addItem: async () => { throw linearAuthError(); } }),
      ENDPOINT,
      { issueIdentifier: 'TEST-1', kind: 'implementation' }
    );
    assert.equal(status, 503, `expected 503, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.code, 'LINEAR_AUTH');
    assert.equal(body.category, 'auth');
    assert.equal(body.retryable, true);
  });

  test('a genuinely unexpected, non-auth-shaped error still falls to the untouched generic 500', async () => {
    const { status, body } = await post(
      buildApp({ addItem: async () => { throw new Error('boom, totally unrelated'); } }),
      ENDPOINT,
      { issueIdentifier: 'TEST-1', kind: 'implementation' }
    );
    assert.equal(status, 500, `expected 500, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.code, undefined);
  });
});

describe('LIN-2260 — recommend-and-dispatch: outer catch-all upstream-auth classification', () => {
  test('an upstream auth failure thrown while resolving provider access (before either arm) is classified, not swallowed into a bare 500', async () => {
    const { status, body } = await post(
      buildApp({ resolveWorkspaceAccess: async () => { throw linearAuthError(); } }),
      ENDPOINT,
      { issueIdentifier: 'TEST-1' }
    );
    // No req.resolvedCredentialExpiresAt was ever stamped (resolution threw before
    // returning), so this cannot look "live" — the terminal 401 branch, same as
    // Block B's "no recorded expiry" case.
    assert.equal(status, 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.code, 'LINEAR_AUTH');
    assert.equal(body.category, 'auth');
    assert.equal(body.retryable, false);
  });
});
