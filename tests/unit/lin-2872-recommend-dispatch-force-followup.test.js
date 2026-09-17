/**
 * LIN-2872 / LIN-2869 (fused) — POST /api/proxy/recommend-and-dispatch
 * destructured neither `force` (the duplicate-guard operator escape hatch,
 * reachable on the plain POST /dispatch verb but silently dropped here) nor
 * `followUpTo` (the resume-the-prior-session field, same defect class). These
 * route-level tests pin the WIRING: both fields must be forwarded verbatim
 * onto whichever createDispatchItem arm the verb resolves — the deterministic
 * verb-override arm (`kind` set) and the recommendation-derived arm (no
 * `kind`) — and validated with the same rules the main dispatch handlers
 * enforce. The guard's own behavior (force bypasses; a launch-time `[failed]`
 * prior exempts a retry) is pinned at the factory seam in
 * tests/unit/dispatch-factory.test.js.
 *
 * Set NODE_ENV before importing the routes so the test-mode short-circuit
 * (token === 'test-token') and module-level rate-limiter skips apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const PRIOR_ID = '11111111-2222-3333-4444-555555555555';
const FOLLOW_UP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// A store that captures the item handed to addItem. `findRecentFreshDispatch`
// is only installed when a test asks for the duplicate-guard wiring.
function buildApp(captured, { withDuplicatePrior = false } = {}) {
  const store = {
    addItem: async (urlKey, item) => {
      captured.item = item;
      return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
    }
  };
  if (withDuplicatePrior) {
    store.findRecentFreshDispatch = async (urlKey, opts) => ({
      id: PRIOR_ID,
      dispatchedAt: new Date(Date.now() - 60_000)
    });
  }
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({
      token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt: Date.now() + 3600_000
    }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: store,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const opts = { method: 'POST', headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const ENDPOINT = '/api/proxy/recommend-and-dispatch';

describe('LIN-2872 — recommend-and-dispatch forwards force (the duplicate-guard escape hatch)', () => {
  test('force: true is forwarded on the verb-override arm', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', kind: 'implementation', force: true
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.force, true, 'the factory must receive force: true so the guard can honor the hatch');
  });

  test('force: true is forwarded on the recommendation-derived arm', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', force: true
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.force, true, 'the recommendation-derived arm must forward the flag too');
  });

  test('force: false is stored as false (only an explicit boolean true opts out)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', kind: 'implementation', force: false
    });
    assert.equal(res.status, 201);
    assert.strictEqual(captured.item.force, false);
  });

  test('a non-boolean force is rejected with 400', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', kind: 'implementation', force: 'yes'
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /force must be a boolean/);
    assert.equal(captured.item, undefined, 'nothing is dispatched on a rejected force');
  });

  test('force: true bypasses the duplicate guard THROUGH the route (the ticket\'s headline)', async () => {
    // The unforced control is a 409 (the store reports a same-issue+kind prior
    // inside the window); force: true must turn the same request into a 201.
    const captured = {};
    const app = buildApp(captured, { withDuplicatePrior: true });

    const refused = await call(app, ENDPOINT, { issueIdentifier: 'TEST-1', kind: 'implementation' });
    assert.equal(refused.status, 409, `expected the guard to refuse the unforced dispatch: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.code, 'DUPLICATE_DISPATCH');
    assert.equal(refused.body.id, PRIOR_ID);
    assert.equal(captured.item, undefined, 'a refused dispatch must not reach addItem');

    const forced = await call(app, ENDPOINT, { issueIdentifier: 'TEST-1', kind: 'implementation', force: true });
    assert.equal(forced.status, 201, `force must bypass the guard: ${JSON.stringify(forced.body)}`);
    assert.equal(captured.item.force, true);
    assert.equal(captured.item.issueIdentifier, 'TEST-1');
  });
});

describe('LIN-2869 — recommend-and-dispatch forwards followUpTo (resume the prior session)', () => {
  test('followUpTo is forwarded on the verb-override arm', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: FOLLOW_UP_ID
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.followUpTo, FOLLOW_UP_ID, 'the follow-up reference must reach the factory');
  });

  test('followUpTo is forwarded on the recommendation-derived arm', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', followUpTo: FOLLOW_UP_ID
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.followUpTo, FOLLOW_UP_ID, 'the recommendation-derived arm must forward it too');
  });

  test('a malformed followUpTo is rejected with 400', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: 'not-a-uuid'
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /Invalid followUpTo format/);
    assert.equal(captured.item, undefined);
  });

  test('followUpTo on a non-cli/web target is rejected with 400', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: FOLLOW_UP_ID, target: 'dash'
    });
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /followUpTo is only supported for cli\/web targets/);
    assert.equal(captured.item, undefined);
  });

  test('a fused follow-up with no explicit appendProxyContext suppresses the proxy-context prose (LIN-805)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', followUpTo: FOLLOW_UP_ID
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item.prompt, 'the recommendation still produced a body');
    assert.ok(!captured.item.prompt.includes('workspace API proxy'),
      'a warm follow-up already has the proxy context from its first beat — the prose must not be re-appended');
    // LIN-1429: the prose is suppressed, but the default claude-code (MCP)
    // harness still gets a LIVE bootstrap — the original died with the window
    // that held it. Mirrors POST /dispatch's own follow-up branch.
    assert.ok(captured.item.bootstrapToken,
      'a broker-dependent follow-up must still carry a live credential even when the prose is suppressed');
  });

  test('an explicit appendProxyContext:false opts a fused follow-up out of BOTH the prose and the credential (LIN-1429)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', followUpTo: FOLLOW_UP_ID, appendProxyContext: false
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.followUpTo, FOLLOW_UP_ID,
      'the opt-out must not come at the cost of dropping the follow-up itself');
    assert.ok(!captured.item.prompt.includes('workspace API proxy'));
    assert.strictEqual(captured.item.bootstrapToken, null,
      'an explicit opt-out means the caller wants neither the prose nor a fresh credential');
  });

  test('an explicit appendProxyContext:true opts a fused follow-up back into the proxy-context append (LIN-805)', async () => {
    const captured = {};
    const res = await call(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', followUpTo: FOLLOW_UP_ID, appendProxyContext: true
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.followUpTo, FOLLOW_UP_ID,
      'the opt-in must not come at the cost of dropping the follow-up itself');
    assert.ok(captured.item.prompt.includes('workspace API proxy'),
      'an explicit opt-in re-appends the proxy context for a follow-up');
  });

  test('a fused follow-up never consults the duplicate guard (the factory gate exempts followUpTo)', async () => {
    // The store reports a duplicate for every lookup; only the gate's
    // followUpTo exemption can let this land.
    const captured = {};
    const app = buildApp(captured, { withDuplicatePrior: true });
    const res = await call(app, ENDPOINT, {
      issueIdentifier: 'TEST-1', kind: 'implementation', followUpTo: FOLLOW_UP_ID
    });
    assert.equal(res.status, 201, `a follow-up IS the intended second dispatch: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.followUpTo, FOLLOW_UP_ID);
  });
});