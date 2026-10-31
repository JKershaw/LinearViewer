/**
 * LIN-2040 — every proxy error reports the status the provider said.
 *
 * Two defects, one mapper (`graphqlErrorStatus`, routes/proxy.js):
 *  - Jira, GitHub and GitHub Projects throw `err.status`, which the mapper never read,
 *    so their 401/403/404/429 all reached the agent as a bare 500.
 *  - Linear answers "Entity not found" in an HTTP 200 envelope; the mapper saw the 200,
 *    and the `userError` branch made it a 400, where docs/proxy-integration.md promises 404.
 *
 * These tests drive the REAL route handlers through a throwing provider (the
 * ThrowingProvider pattern from proxy-provider-error-attribution.test.js) so the status
 * the agent sees is the one the route sends. Guards pin what the fix must NOT do: a 403 or
 * a rate limit never marks the credential suspect, a Jira/GitHub 5xx never becomes 503, and
 * Linear's 200-envelope 401/403 stay 400.
 *
 * Run with: node --test tests/unit/lin-2040-proxy-error-status.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { upstreamErrorStatus } from '../../lib/proxy-graphql-errors.js';
import { isEntityNotFoundError, isRateLimited } from '../../lib/errors.js';

const JIRA = 'lin2040-jira-stub';
const GITHUB = 'lin2040-github-stub';
const GITHUB_PROJECTS = 'lin2040-github-projects-stub';
const LINEAR = 'lin2040-linear-stub';
const FINGERPRINT = 'fp-lin2040';

/**
 * A real ProviderInterface subclass: the routes under test reach the throwing method
 * only after the capability gate passes, which implementing the method makes true.
 * `error` is what every implemented read/write throws; `issueWriteGuard` deliberately
 * succeeds, so the write route reaches `createComment` and the error is the one under test.
 */
class ThrowingProvider extends ProviderInterface {
  constructor(name, displayName) {
    super();
    this.name = name;
    this._displayName = displayName;
    this.error = new Error('upstream boom');
  }
  get ui() {
    return { ...super.ui, displayName: this._displayName };
  }
  async viewer() { throw this.error; }
  async issueDetail() { throw this.error; }
  async relations() { throw this.error; }
  async fetchProjects() { throw this.error; }
  async issueWriteGuard() { return { id: 'i1', identifier: 'ENG-1', trashed: false }; }
  async createComment() { throw this.error; }
}

/** An error the way the non-Linear clients throw it: a numeric `err.status`. */
function statusError(status, message = `upstream failed with ${status}`) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** An error the way graphql-request throws it: an HTTP error with `err.response`. */
function linearError(httpStatus, errors = []) {
  const err = new Error('linear request failed');
  err.response = { status: httpStatus, errors };
  return err;
}

/**
 * Linear's not-found envelope, hand-shaped: `message` not yet captured verbatim (see the
 * LIN-2040 ledger); `userPresentableMessage` matches the live proxy detail.
 */
function linearNotFoundEnvelope() {
  return linearError(200, [{
    message: 'Entity not found: Issue',
    extensions: { code: 'INVALID_INPUT', type: 'invalid input', userError: true, userPresentableMessage: 'Could not find referenced Issue.' },
  }]);
}

function buildApp(provider, { resolveWorkspaceAccess, rejectedCredentialRegistry } = {}) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: resolveWorkspaceAccess
      || (async () => ({ token: 'ws-token', reason: 'ok', provider: provider.name, credentialFingerprint: FINGERPRINT })),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    rejectedCredentialRegistry,
  }));
  return app;
}

/** A registry that records what the proxy marks suspect (the real one is out of scope here). */
function spyRegistry() {
  const markSuspectCalls = [];
  return {
    markSuspectCalls,
    markSuspect: (fingerprint, opts) => markSuspectCalls.push({ fingerprint, opts }),
    isSuspect: () => false,
    shouldAttemptRefresh: () => false,
    accept: () => {},
  };
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(r => server.close(r));
  }
}

const ISSUE_ID = '00000000-0000-4000-8000-000000000000';

// The four routes the witness table runs through: a provider read (viewer), an issue read
// (issueDetail), a compute route (stack), and a write (createComment). Kickoff is covered in
// lin-2363-kickoff-provider-attribution.test.js, which owns that route's harness.
const ROUTES = [
  { family: 'read', method: 'GET', path: '/api/proxy/me' },
  { family: 'read (issue)', method: 'GET', path: `/api/proxy/issues/${ISSUE_ID}` },
  { family: 'compute', method: 'GET', path: '/api/proxy/stack' },
  { family: 'write', method: 'POST', path: `/api/proxy/issues/${ISSUE_ID}/comments`, body: { body: 'hello' } },
];

// ---------------------------------------------------------------------------
// The helper: which shape it read, and which statuses it passes.
// ---------------------------------------------------------------------------
describe('upstreamErrorStatus — which shape it read, and which statuses it passes (LIN-2040)', () => {
  test('a numeric err.status of 401/403/404/429 reads as the status shape', () => {
    for (const status of [401, 403, 404, 429]) {
      assert.deepEqual(upstreamErrorStatus(statusError(status)), { status, shape: 'status' });
    }
  });

  test('any other err.status (5xx, 400, 409, 422) reads as nothing: the mapper keeps it a 500', () => {
    for (const status of [400, 409, 422, 500, 502, 503]) {
      assert.deepEqual(upstreamErrorStatus(statusError(status)), { status: undefined, shape: null }, `status ${status}`);
    }
  });

  test('a graphql-request HTTP error reads as the linear shape, with its HTTP status', () => {
    assert.deepEqual(upstreamErrorStatus(linearError(404, [])), { status: 404, shape: 'linear' });
    assert.deepEqual(upstreamErrorStatus(linearError(403, [])), { status: 403, shape: 'linear' });
  });

  test('a 200 envelope honours statusCode only for 404 and 429 (the statuses that cannot touch a credential)', () => {
    const envelope = (statusCode) => linearError(200, [{ message: 'x', extensions: { statusCode, userError: true } }]);
    assert.deepEqual(upstreamErrorStatus(envelope(404)), { status: 404, shape: 'linear' });
    assert.deepEqual(upstreamErrorStatus(envelope(429)), { status: 429, shape: 'linear' });
    // B1: a 200-envelope 401/403 is not read; it keeps HTTP 200 and falls through to userError → 400.
    assert.deepEqual(upstreamErrorStatus(envelope(401)), { status: 200, shape: 'linear' });
    assert.deepEqual(upstreamErrorStatus(envelope(403)), { status: 200, shape: 'linear' });
  });

  test('with no HTTP status at all, statusCode is read as it always was (no change on that shape)', () => {
    const err = { response: { errors: [{ extensions: { statusCode: 401 } }] } };
    assert.deepEqual(upstreamErrorStatus(err), { status: 401, shape: 'linear' });
  });

  test('a plain error with nothing on it reads as nothing', () => {
    assert.deepEqual(upstreamErrorStatus(new Error('boom')), { status: undefined, shape: null });
  });
});

describe('isEntityNotFoundError and isRateLimited — the shared predicates (LIN-2040)', () => {
  test('isEntityNotFoundError matches Linear\'s "Entity not found" in any errors[] message', () => {
    assert.equal(isEntityNotFoundError(linearNotFoundEnvelope()), true);
    assert.equal(isEntityNotFoundError(linearError(200, [{ message: 'Argument Validation Error' }])), false);
    assert.equal(isEntityNotFoundError(new Error('Entity not found: Issue')), false, 'no GraphQL envelope, no match');
  });

  test('isRateLimited reads the message, not the status', () => {
    assert.equal(isRateLimited(statusError(403, 'API rate limit exceeded for installation')), true);
    assert.equal(isRateLimited(statusError(403, 'Resource not accessible by integration')), false);
  });
});

// ---------------------------------------------------------------------------
// The table: each non-Linear provider × each status × each route family.
// ---------------------------------------------------------------------------
const PROVIDERS = [
  { name: JIRA, displayName: 'Jira' },
  { name: GITHUB, displayName: 'GitHub Issues' },
  { name: GITHUB_PROJECTS, displayName: 'GitHub Projects' },
];
const STATUSES = [401, 403, 404, 429];

for (const { name, displayName } of PROVIDERS) {
  for (const upstream of STATUSES) {
    for (const route of ROUTES) {
      test(`${displayName} ${upstream} (err.status) reaches the agent as ${upstream} on a ${route.family} route`, async () => {
        const provider = new ThrowingProvider(name, displayName);
        provider.error = statusError(upstream);
        const registry = spyRegistry();
        const { status, body } = await call(buildApp(provider, { rejectedCredentialRegistry: registry }), route.method, route.path, route.body);
        assert.equal(status, upstream, JSON.stringify(body));
        assert.doesNotMatch(body.detail ?? '', /Linear/, 'detail names the provider, never Linear');
        // Suspect-marking only on the 401: one missing permission, a missing entity and a
        // rate limit never mark the credential.
        assert.equal(registry.markSuspectCalls.length, upstream === 401 ? 1 : 0, 'suspect-marking');
      });
    }
  }
}

// ---------------------------------------------------------------------------
// GitHub's rate limit arrives as a 403. The message is the only thing that says so.
// ---------------------------------------------------------------------------
describe('GitHub 403 — a rate limit is 429, a missing permission is 403 (LIN-2040)', () => {
  test('"API rate limit exceeded" → 429, not suspect', async () => {
    const provider = new ThrowingProvider(GITHUB, 'GitHub Issues');
    provider.error = statusError(403, 'You have exceeded a secondary rate limit: API rate limit exceeded for installation');
    const registry = spyRegistry();
    const { status } = await call(buildApp(provider, { rejectedCredentialRegistry: registry }), 'GET', '/api/proxy/me');
    assert.equal(status, 429);
    assert.equal(registry.markSuspectCalls.length, 0);
  });

  test('"Resource not accessible by integration" → 403, not suspect', async () => {
    const provider = new ThrowingProvider(GITHUB, 'GitHub Issues');
    provider.error = statusError(403, 'Resource not accessible by integration');
    const registry = spyRegistry();
    const { status } = await call(buildApp(provider, { rejectedCredentialRegistry: registry }), 'GET', '/api/proxy/me');
    assert.equal(status, 403);
    assert.equal(registry.markSuspectCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Guards: the things the suspect-marking exists to stop must still not happen.
// ---------------------------------------------------------------------------
describe('guards — a non-auth upstream status never becomes a 503/401 or marks the credential (LIN-2040)', () => {
  for (const upstream of [400, 409, 422, 500, 502, 503]) {
    test(`Jira ${upstream} (err.status) stays 500 and does not mark the credential suspect`, async () => {
      const provider = new ThrowingProvider(JIRA, 'Jira');
      provider.error = statusError(upstream);
      const registry = spyRegistry();
      const { status } = await call(buildApp(provider, { rejectedCredentialRegistry: registry }), 'GET', '/api/proxy/me');
      assert.equal(status, 500);
      assert.equal(registry.markSuspectCalls.length, 0);
    });
  }

  test('a GitHub 401 on a binding with a live expiry is the retryable 503 (the existing App-token grace, one rule for both shapes)', async () => {
    const provider = new ThrowingProvider(GITHUB, 'GitHub Issues');
    provider.error = statusError(401);
    const liveExpiry = Date.now() + 3600_000;
    const { status, body } = await call(buildApp(provider, {
      resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok', provider: GITHUB, expiresAt: liveExpiry, credentialFingerprint: FINGERPRINT }),
    }), 'GET', '/api/proxy/me');
    assert.equal(status, 503, JSON.stringify(body));
    assert.equal(body.retryable, true);
  });

  test('a GitHub 401 on a binding with no expiry (a PAT) is a terminal 401', async () => {
    const provider = new ThrowingProvider(GITHUB, 'GitHub Issues');
    provider.error = statusError(401);
    const { status, body } = await call(buildApp(provider), 'GET', '/api/proxy/me');
    assert.equal(status, 401, JSON.stringify(body));
    assert.equal(body.retryable, false);
  });

  test('a Jira 401 on an API-token binding (the never-expires sentinel expiry) is a terminal 401, not the 503 grace', async () => {
    const provider = new ThrowingProvider(JIRA, 'Jira');
    provider.error = statusError(401);
    const { status, body } = await call(buildApp(provider, {
      resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok', provider: JIRA, expiresAt: Number.MAX_SAFE_INTEGER, credentialFingerprint: FINGERPRINT }),
    }), 'GET', '/api/proxy/me');
    assert.equal(status, 401, JSON.stringify(body));
    assert.equal(body.retryable, false);
  });

  test('Linear 200 envelope { statusCode: 403, userError: true } stays 400 and does not mark the credential', async () => {
    const provider = new ThrowingProvider(LINEAR, 'Linear');
    provider.error = linearError(200, [{ message: 'You do not have access to this team', extensions: { statusCode: 403, userError: true } }]);
    const registry = spyRegistry();
    const { status } = await call(buildApp(provider, { rejectedCredentialRegistry: registry }), 'GET', `/api/proxy/issues/${ISSUE_ID}`);
    assert.equal(status, 400);
    assert.equal(registry.markSuspectCalls.length, 0);
  });

  test('Linear 200 envelope { statusCode: 401, userError: true } stays 400 and does not mark the credential', async () => {
    const provider = new ThrowingProvider(LINEAR, 'Linear');
    provider.error = linearError(200, [{ message: 'You need to authenticate to access this operation.', extensions: { statusCode: 401, userError: true } }]);
    const registry = spyRegistry();
    const { status } = await call(buildApp(provider, { rejectedCredentialRegistry: registry }), 'GET', `/api/proxy/issues/${ISSUE_ID}`);
    assert.equal(status, 400);
    assert.equal(registry.markSuspectCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Linear: the (hand-shaped) not-found envelope, and the 200-envelope statuses.
// ---------------------------------------------------------------------------
describe('Linear — a not-found in a 200 envelope is 404; the other envelope statuses map as before (LIN-2040)', () => {
  const NOT_FOUND_ROUTES = [
    { family: 'issue read', method: 'GET', path: `/api/proxy/issues/${ISSUE_ID}` },
    { family: 'issue read by identifier', method: 'GET', path: '/api/proxy/issues/ENG-999999' },
    { family: 'relations read', method: 'GET', path: `/api/proxy/issues/${ISSUE_ID}/relations` },
    { family: 'write', method: 'POST', path: `/api/proxy/issues/${ISSUE_ID}/comments`, body: { body: 'hello' } },
  ];
  for (const route of NOT_FOUND_ROUTES) {
    test(`the Entity-not-found envelope → 404 with the user-presentable detail on a ${route.family} route`, async () => {
      const provider = new ThrowingProvider(LINEAR, 'Linear');
      provider.error = linearNotFoundEnvelope();
      const { status, body } = await call(buildApp(provider), route.method, route.path, route.body);
      assert.equal(status, 404, JSON.stringify(body));
      assert.equal(body.detail, 'Could not find referenced Issue.');
    });
  }

  test('a 200 envelope statusCode 429 → 429', async () => {
    const provider = new ThrowingProvider(LINEAR, 'Linear');
    provider.error = linearError(200, [{ message: 'Ratelimit exceeded', extensions: { statusCode: 429, userError: true } }]);
    const { status } = await call(buildApp(provider), 'GET', `/api/proxy/issues/${ISSUE_ID}/relations`);
    assert.equal(status, 429);
  });

  test('a 200 envelope statusCode 404 → 404', async () => {
    const provider = new ThrowingProvider(LINEAR, 'Linear');
    provider.error = linearError(200, [{ message: 'Not here', extensions: { statusCode: 404 } }]);
    const { status } = await call(buildApp(provider), 'GET', `/api/proxy/issues/${ISSUE_ID}/relations`);
    assert.equal(status, 404);
  });

  test('a 200 envelope with userError and no not-found message stays a 400', async () => {
    const provider = new ThrowingProvider(LINEAR, 'Linear');
    provider.error = linearError(200, [{ message: 'after is not a valid pagination cursor', extensions: { userError: true } }]);
    const { status } = await call(buildApp(provider), 'GET', `/api/proxy/issues/${ISSUE_ID}/relations`);
    assert.equal(status, 400);
  });
});
