/**
 * LIN-2363 — POST /api/proxy/autopilot/kickoff's 401/503 envelope attributed
 * every upstream failure to Linear.
 *
 * The branch builds its envelope INLINE rather than through `graphqlErrorDetail`,
 * and forwarded `classifyUpstreamError`'s `detail` verbatim — four Linear-hardcoded
 * strings. It is the one `detail` field in routes/proxy.js that LIN-2351 did not
 * reach, and `req.resolvedProvider` (the stamp LIN-2351 added) was already
 * correctly populated on this very request and simply not read.
 *
 * WHY THIS IS TESTED NOW, THOUGH IT IS LATENT. Re-derived at HEAD:
 * `graphqlErrorStatus` reads only `err.response.status` /
 * `err.response.errors[0].extensions.statusCode` (the graphql-request shape),
 * while all three non-Linear clients set `err.status` instead
 * (lib/providers/{github,jira,github-projects}/client.js). So a real GitHub or
 * Jira 401 maps to 500 today and never enters this branch — the misattribution
 * is armed, not firing, and no operator is being misled by it right now.
 *
 * That is precisely why it needs a test. The moment anyone normalises the error
 * shape — the obvious fix, tracked separately — this branch would immediately
 * start telling GitHub and Jira operators that *Linear* rejected their
 * credentials, in the exact field LIN-2351 just cleaned, with nothing to catch
 * it: no test asserted this route's 401/503 body at all, which is why CI was
 * green with the misattribution present.
 *
 * These tests therefore reach the branch the way it WILL be reachable, by
 * throwing the graphql-request-shaped error `graphqlErrorStatus` already
 * understands while the resolved provider is a non-Linear one.
 *
 * BOUNDARY: `code`/`category`/`retryable` are asserted UNCHANGED. The `LINEAR_*`
 * codes are a published, machine-matchable contract (docs/proxy-integration.md);
 * renaming them is a breaking change needing a deprecation path, and stays out of
 * scope — LIN-2351's boundary, held again here.
 *
 * Scaffolding mirrors tests/unit/lin-2260-recommend-dispatch-auth-classification.test.js.
 *
 * Run with: node --test tests/unit/lin-2363-kickoff-provider-attribution.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { classifyUpstreamError } from '../../lib/errors.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const ENDPOINT = '/api/proxy/autopilot/kickoff';

/** The graphql-request-shaped error `graphqlErrorStatus` understands. */
function upstreamError(status) {
  const err = new Error('You need to authenticate to access this operation.');
  err.response = { status, errors: [{ message: 'nope', extensions: { statusCode: status } }] };
  return err;
}

// A credential our bookkeeping believes is LIVE → the transient 503 arm.
// Expiring it instead takes the terminal 401 arm; both run through the same
// `detail`, which is what this ticket is about.
const credential = (provider, { live = true } = {}) => async () => ({
  token: 'live-token', reason: 'ok', provider, source: 'session-scan',
  expiresAt: Date.now() + (live ? 3600_000 : -1000),
  credentialFingerprint: fingerprintCredential('live-token'),
});

/**
 * `provider` is the injected provider instance, so `req.resolvedProvider` is
 * stamped from a real registry-shaped object and `displayName` is what the
 * envelope should name. `throwOn` selects which seam fails: 'context' models a
 * provider rejection on an issue-scoped kickoff (the stamped path), 'dispatch'
 * models a failure on a GOAL-ONLY kickoff, which never calls
 * `resolveProviderAccess` at all and so reaches the branch UNSTAMPED.
 */
function buildApp({ providerName, displayName, live = true, throwOn = 'context' }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: credential(providerName, { live }),
    getWorkspaceAccessToken: async () => 'live-token',
    getWorkspaceOpenRouterKey: async () => null,
    provider: {
      name: providerName,
      ui: { displayName },
      supports: () => true,
      createFields: () => [],
      // The seam the kickoff route reaches upstream through.
      fetchIssueContext: async () => {
        if (throwOn === 'context') throw upstreamError(401);
        return { issue: { id: 'i1', identifier: 'ENG-1', title: 't' }, comments: [], children: [] };
      },
    },
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async () => {
        if (throwOn === 'dispatch') throw upstreamError(401);
        return { id: 'd1' };
      },
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function kickoff(app, body = { issueIdentifier: 'ENG-1' }) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${ENDPOINT}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer agent-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-2363 — the kickoff 401/503 envelope names the backend actually called', () => {
  test('a GitHub-backed workspace is NOT told Linear rejected its credentials', async () => {
    const { status, body } = await kickoff(
      buildApp({ providerName: 'github', displayName: 'GitHub Issues' }));

    assert.ok(status === 401 || status === 503, `expected an auth-shaped status, got ${status}: ${JSON.stringify(body)}`);
    assert.doesNotMatch(body.detail, /Linear/,
      'the whole defect: a GitHub operator told Linear rejected their credentials');
    assert.match(body.detail, /GitHub Issues rejected the request as unauthenticated\./);
  });

  test('a Jira-backed workspace is named too', async () => {
    const { body } = await kickoff(buildApp({ providerName: 'jira', displayName: 'Jira' }));
    assert.match(body.detail, /^Jira rejected the request as unauthenticated\.$/);
  });

  test('a genuinely Linear-backed workspace reads byte-identically to before', async () => {
    const { body } = await kickoff(buildApp({ providerName: 'linear', displayName: 'Linear' }));
    assert.equal(body.detail, 'Linear rejected the request as unauthenticated.');
  });

  test('the machine-matchable contract is untouched (LIN-2351 boundary)', async () => {
    const { status, body } = await kickoff(
      buildApp({ providerName: 'github', displayName: 'GitHub Issues' }));

    // Only the human string moved. Renaming these is a breaking change and is
    // deliberately out of scope for this ticket.
    assert.equal(body.code, 'LINEAR_AUTH');
    assert.equal(body.category, 'auth');
    assert.equal(body.retryable, status === 503);
    assert.equal(body.error, 'Failed to dispatch autopilot kickoff');
  });

  test('the terminal-401 arm carries the same attribution as the transient-503 arm', async () => {
    const { status, body } = await kickoff(
      buildApp({ providerName: 'github', displayName: 'GitHub Issues', live: false }));

    assert.equal(status, 401, JSON.stringify(body));
    assert.equal(body.retryable, false);
    assert.match(body.detail, /GitHub Issues rejected the request/);
  });
});

describe('LIN-2363 — the unstamped path degrades to neutral AT THE ROUTE', () => {
  test('a goal-only kickoff, which never resolves a provider, is not told Linear', async () => {
    // Found by review: `resolveProviderAccess` is called only inside
    // `if (issueIdentifier)`, so a GOAL-ONLY kickoff reaches this catch with
    // `req.resolvedProvider` unstamped. Without a route-level case here,
    // dropping the `?? null` would let JS default-param semantics silently
    // restore 'Linear' and NOTHING in the suite would fail — every other
    // route-level test has a stamped provider.
    const { status, body } = await kickoff(
      buildApp({ providerName: 'github', displayName: 'GitHub Issues', throwOn: 'dispatch' }),
      { goal: 'ship the thing' }
    );

    assert.ok(status === 401 || status === 503, `expected an auth-shaped status, got ${status}: ${JSON.stringify(body)}`);
    assert.doesNotMatch(body.detail, /Linear/,
      'an unattributable failure must never be blamed on Linear');
    assert.match(body.detail, /^The upstream provider rejected the request as unauthenticated\.$/);
    // The machine contract is unchanged on this arm too.
    assert.equal(body.code, 'LINEAR_AUTH');
  });
});

describe('LIN-2363 — classifyUpstreamError: attribution without a resolved provider', () => {
  // The route passes `req.resolvedProvider?.displayName ?? null`, so an
  // unresolved provider must degrade to neutral wording — never a guessed
  // "Linear". Asserted on the classifier directly because reaching the route's
  // branch REQUIRES a resolved credential, so the null case is not reachable
  // through it; this is the guard for a future caller that can produce it.
  const neutral = (err) => classifyUpstreamError(err, null).detail;

  test('null degrades to provider-neutral wording on every arm', () => {
    assert.match(neutral(upstreamError(401)), /^The upstream provider rejected the request as unauthenticated\.$/);
    assert.match(neutral(upstreamError(429)), /^The upstream provider rate-limited the request/);
    assert.match(neutral(upstreamError(503)), /^The upstream provider returned a 503 server error\.$/);

    const netErr = new Error('fetch failed');
    assert.match(neutral(netErr), /^The connection to the upstream provider closed before a response arrived/);

    for (const e of [upstreamError(401), upstreamError(429), upstreamError(503), netErr]) {
      assert.doesNotMatch(neutral(e), /Linear/, 'an unattributable failure must never be blamed on Linear');
    }
  });

  test('the no-argument call stays byte-identical for every existing caller', () => {
    // lib/render-pages.js's session-authed HTML lane is explicitly unowned by
    // this ticket and must not shift. These are the exact pre-change strings.
    assert.equal(classifyUpstreamError(upstreamError(401)).detail,
      'Linear rejected the request as unauthenticated.');
    assert.equal(classifyUpstreamError(upstreamError(429)).detail,
      'Linear rate-limited the request; it should recover shortly.');
    assert.equal(classifyUpstreamError(upstreamError(503)).detail,
      'Linear returned a 503 server error.');
    assert.equal(classifyUpstreamError(new Error('fetch failed')).detail,
      'The connection to Linear closed before a response arrived — usually transient.');
    // The internal arm names no provider at all, before and after.
    assert.equal(classifyUpstreamError(new Error('boom')).detail,
      'An unexpected error occurred while preparing the page.');
  });

  test('a named provider is threaded through every arm', () => {
    const named = (err) => classifyUpstreamError(err, 'Jira').detail;
    assert.equal(named(upstreamError(401)), 'Jira rejected the request as unauthenticated.');
    assert.equal(named(upstreamError(429)), 'Jira rate-limited the request; it should recover shortly.');
    assert.equal(named(upstreamError(500)), 'Jira returned a 500 server error.');
    assert.equal(named(new Error('fetch failed')),
      'The connection to Jira closed before a response arrived — usually transient.');
  });
});
