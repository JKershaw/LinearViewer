/**
 * LIN-901 — route-level: POST /api/proxy/recommend-and-dispatch subscription is
 * DECLARED on the edge (LIN-900 §6), never reconstructed from `sessionId`. The old
 * LIN-826 `subscribe` default-on-when-sessioned is removed: an undeclared edge is
 * `terminal-only`, whether or not a sessionId is present. An explicit
 * `subscription: 'everything'` is honoured; any non-enum value is a 400.
 *
 * The default lives in the route (subscriptionResolved), not the store, so it must
 * be observed at the dispatch seam. We drive the deterministic verb-override path
 * (kind set → no LLM/OpenRouter), capturing the item handed to addItem.
 *
 * Set NODE_ENV before importing the routes so the test-mode short-circuit
 * (token === 'test-token') and module-level rate-limiter skips apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      // LIN-1175: claude-code (default harness) dispatch now fails closed without a
      // mintable token; give the stub a minting createToken like production.
      createToken: async () => ({ token: "test-bootstrap", kind: "bootstrap", scope: "readWrite" }),
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
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
      }
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

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

describe('LIN-901 — recommend-and-dispatch subscription is declared, not reconstructed (§6)', () => {
  test('a sessioned worker with NO declared subscription defaults to terminal-only', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      sessionId: SESSION_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'verb-override path must dispatch an item');
    assert.equal(captured.item.sessionId, SESSION_ID);
    assert.equal(captured.item.subscription, 'terminal-only', 'sessionId no longer implies a subscription (§6 removes the LIN-826 reconstruction)');
  });

  test('a non-sessioned dispatch with no declared subscription defaults to terminal-only', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'terminal-only');
  });

  test('an explicit subscription:everything is honoured', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      sessionId: SESSION_ID,
      subscription: 'everything'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'everything', 'the declared edge is honoured');
  });

  test('an explicit subscription:terminal-only is honoured', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      subscription: 'terminal-only'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'terminal-only');
  });

  test('rejects an invalid subscription value with 400 (hard enum, no legacy boolean)', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation',
      subscription: 'yes'
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /subscription must be one of/);
  });

  // LIN-1118 — sessionId is an opaque string here too. This route had NO negative
  // sessionId coverage before; without it the relaxation reads as removing the
  // guard rather than replacing it.
  test('a composite sessionId is accepted and forwarded verbatim (LIN-1118)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const composite = 'LIN-1117-autopilot-standalone-2026-07-07';
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', sessionId: composite
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.sessionId, composite);
  });

  test('an existing UUID sessionId is still accepted (pure relaxation)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', sessionId: SESSION_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.sessionId, SESSION_ID);
  });

  test('rejects a malformed sessionId with 400 (LIN-1118)', async () => {
    for (const [sessionId, pattern] of [
      ['', /sessionId must not be empty/],
      ['a'.repeat(129), /sessionId exceeds maximum length of 128/],
      ['a\nb', /sessionId contains invalid characters/],
      ['__meta__', /sessionId must not be a reserved value/],
      [42, /sessionId must be a string/]
    ]) {
      const captured = {};
      const app = buildApp(captured);
      const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
        issueIdentifier: 'TEST-1', kind: 'implementation', sessionId
      });

      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(sessionId)}, got ${res.status}`);
      assert.match(res.body.error, pattern);
      assert.equal(captured.item, undefined, 'nothing is dispatched on a rejected sessionId');
    }
  });

  test('queueIfBusy is forwarded blindly and never defaulted on this path', async () => {
    const captured = {};
    const app = buildApp(captured);

    // Omitted → false (not defaulted true even for a sessioned worker).
    await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', sessionId: SESSION_ID
    });
    assert.equal(captured.item.queueIfBusy, false, 'queueIfBusy is not defaulted on recommend-and-dispatch');

    // Explicit true → forwarded.
    await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', sessionId: SESSION_ID, queueIfBusy: true
    });
    assert.equal(captured.item.queueIfBusy, true, 'explicit queueIfBusy:true is forwarded');
  });
});

// LIN-2075 — `repo` used to collapse non-string / over-length / dangerous-chars
// into a bare 'repo is invalid', the same defect as kickoff's goal/repo (see
// proxy-autopilot-variant.test.js). It now routes through the shared
// validateOpaqueDispatchField helper with reportReceivedLength:true, mirroring
// the model/harness calls a few lines below it in this same handler.
//
// proj-alpha (TEST-1's project) has a project-description `repo=test-repo`
// line, so an explicit caller repo can be distinguished from the derived one
// (LIN-537: explicit wins). proj-beta (TEST-4's project) has no repo= line, so
// it is the fixture for "no repo at all, explicit or derived".
describe('LIN-2075 — recommend-and-dispatch repo validation messages', () => {
  test('a non-string repo is rejected with 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', repo: 42
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /repo must be a string/);
    assert.equal(captured.item, undefined, 'nothing is dispatched on a rejected repo');
  });

  test('an over-length repo is rejected naming the cap and received length', async () => {
    const captured = {};
    const app = buildApp(captured);
    const repo = 'x'.repeat(1001);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', repo
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, 'repo exceeds maximum length of 1000 (got 1001)');
    assert.equal(captured.item, undefined, 'nothing is dispatched on a rejected repo');
  });

  test('a repo with dangerous control characters is rejected with 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', repo: 'my-org/my-repo\x00'
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /repo contains invalid characters/);
    assert.equal(captured.item, undefined, 'nothing is dispatched on a rejected repo');
  });

  test('an explicit repo is accepted and wins over the project-derived repo (LIN-537)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', repo: 'my-org/my-repo'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.repo, 'my-org/my-repo');
  });

  test('repo: null is now accepted as absent (intentional relaxation) and falls back to the project-derived repo', async () => {
    // Previously null fell through to the type check and was rejected; the
    // shared helper treats null the same as omitted/undefined, so resolution
    // continues to resolveDispatchRepo's caller-then-derived precedence
    // (LIN-537), same as an omitted repo below.
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation', repo: null
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.repo, 'test-repo', 'falls back to the project-derived repo, same as omitted');
  });

  test('an omitted repo still behaves as today: falls back to the project-derived repo', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1', kind: 'implementation'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.repo, 'test-repo');
  });

  test('an omitted repo with no project-derived repo either resolves to null', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-4', kind: 'implementation'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(captured.item.repo, null);
  });
});
