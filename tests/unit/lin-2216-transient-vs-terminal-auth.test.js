/**
 * LIN-2216 — three related fixes for the "credential faults are
 * indistinguishable from each other and from real failures" complaint:
 *
 * Block A: lib/workspace-token-cache.js's `get()` is now bounded by the
 *          cached TOKEN's own remaining validity, not only by `ttlMs` — the
 *          confirmed root cause of the time-clustered 401 bursts (a cache
 *          entry outliving the token it holds, e.g. after a rotation
 *          elsewhere, until it aged out on TTL alone).
 * Block B: routes/proxy.js's `graphqlErrorStatus` reclassifies a data-route
 *          401 to a retryable 503 when this router's own bookkeeping
 *          believed the credential was still live when Linear rejected it
 *          (the exact signature Block A's bug produced) — a genuinely dead
 *          credential (our own records already agree) still 401s.
 * Block C: POST /api/proxy/autopilot/kickoff gets a dedicated branch ahead
 *          of the generic 500 for the same upstream-auth shape, reusing
 *          Block B's classification and lib/errors.js's existing
 *          `classifyUpstreamError` vocabulary (LINEAR_AUTH) for the code.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceTokenCache } from '../../lib/workspace-token-cache.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { createRejectedCredentialRegistry, DEFAULT_SUSPECT_TTL_MS, BYTE_IDENTICAL_ESCALATION_THRESHOLD } from '../../lib/rejected-credentials.js';

// ---------------------------------------------------------------------------
// Block A — lib/workspace-token-cache.js
// ---------------------------------------------------------------------------

describe('createWorkspaceTokenCache — bounded by the cached token\'s own validity (LIN-2216, Block A)', () => {
  test('a cache entry outlives the TOKEN\'S OWN expiresAt even though ttlMs has not elapsed — the confirmed defect', () => {
    let t = 1_000_000;
    const cache = createWorkspaceTokenCache({ ttlMs: 30_000, now: () => t });
    // The token expires in 5s — far inside the 30s TTL window.
    cache.set('acme::*', { token: 'live-tok', expiresAt: t + 5000, provider: 'linear' });

    t += 3000;
    assert.ok(cache.get('acme::*'), 'still within both the token\'s own validity and the TTL — a hit');

    t += 3000; // t is now 6s past cachedAt — the TOKEN expired 1s ago, TTL has 24s left
    assert.equal(cache.get('acme::*'), undefined, 'the TOKEN itself has expired — must miss even though ttlMs has 24s left');
  });

  test('a re-fetched value after the bounded miss is served normally (self-healing, not permanently broken)', () => {
    let t = 1_000_000;
    const cache = createWorkspaceTokenCache({ ttlMs: 30_000, now: () => t });
    cache.set('acme::*', { token: 'stale-tok', expiresAt: t + 1000 });
    t += 2000;
    assert.equal(cache.get('acme::*'), undefined);

    cache.set('acme::*', { token: 'fresh-tok', expiresAt: t + 3600_000 });
    assert.deepEqual(cache.get('acme::*'), { token: 'fresh-tok', expiresAt: t + 3600_000 });
  });

  test('a never-expiring credential (MAX_SAFE_INTEGER sentinel) is unaffected — still bounded by ttlMs only', () => {
    let t = 1_000_000;
    const cache = createWorkspaceTokenCache({ ttlMs: 30_000, now: () => t });
    cache.set('acme::*', { token: 'local-tok', expiresAt: Number.MAX_SAFE_INTEGER });
    t += 29_000;
    assert.ok(cache.get('acme::*'), 'still within ttlMs, and MAX_SAFE_INTEGER never triggers the new bound');
    t += 2000; // now past ttlMs
    assert.equal(cache.get('acme::*'), undefined, 'ttlMs itself still applies normally');
  });

  test('a cached value with no expiresAt at all (or non-finite) is unaffected — nothing to bound', () => {
    let t = 1_000_000;
    const cache = createWorkspaceTokenCache({ ttlMs: 30_000, now: () => t });
    cache.set('acme::*', { token: 'shapeless-tok' });
    t += 29_000;
    assert.ok(cache.get('acme::*'));
  });

  test('a token expiring EXACTLY at ttlMs is bounded by whichever elapses first (they agree here)', () => {
    let t = 1_000_000;
    const cache = createWorkspaceTokenCache({ ttlMs: 10_000, now: () => t });
    cache.set('acme::*', { token: 'tok', expiresAt: t + 10_000 });
    t += 10_000;
    assert.equal(cache.get('acme::*'), undefined, 'both bounds hit at the same instant — still a miss, not an off-by-one hit');
  });
});

// ---------------------------------------------------------------------------
// Block B — routes/proxy.js's graphqlErrorStatus (data routes)
// ---------------------------------------------------------------------------

function linearAuthError() {
  const err = new Error('You need to authenticate to access this operation.');
  err.response = {
    status: 401,
    errors: [{ message: 'You need to authenticate to access this operation.', extensions: { statusCode: 401, userError: true } }],
  };
  return err;
}

function buildDataRouteApp({ resolveWorkspaceAccess, issueDetail, rejectedCredentialRegistry } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 'tok-1', urlKey: 'acme', label: 'autopilot', scope: 'readWrite', createdBy: 'acct-owner' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: resolveWorkspaceAccess ?? (async () => ({
      token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('linear-tok'),
    })),
    getWorkspaceAccessToken: async () => 'linear-tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: { name: 'linear', supports: () => true, issueDetail: issueDetail ?? (async () => { throw linearAuthError(); }) },
    rejectedCredentialRegistry,
  }));
  return app;
}

async function request(app, path) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { Authorization: 'Bearer agent-token' } });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const ISSUE_UUID = '266f0841-ef9a-40de-a7b4-e18890efbf05';

describe('graphqlErrorStatus — transient (503) vs terminal (401) upstream auth failure (LIN-2216, Block B)', () => {
  test('a credential that LOOKS live in our own records, rejected by Linear anyway, surfaces as a retryable 503 — not the terminal 401 relayed verbatim before this fix', async () => {
    const { status, body } = await request(buildDataRouteApp(), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 503);
    assert.equal(body.error, 'Failed to fetch issue');
  });

  test('a credential our OWN records already believe is dead/expired stays a terminal 401', async () => {
    const app = buildDataRouteApp({
      resolveWorkspaceAccess: async () => ({
        token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
        expiresAt: Date.now() - 1000, credentialFingerprint: fingerprintCredential('linear-tok'),
      }),
    });
    const { status } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 401, 'our own bookkeeping already agreed this credential looked dead — no transient signature to find');
  });

  test('a credential with no recorded expiry at all (sentinel/absent) stays a terminal 401 — nothing to prove transience', async () => {
    const app = buildDataRouteApp({
      resolveWorkspaceAccess: async () => ({
        token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
        expiresAt: undefined, credentialFingerprint: fingerprintCredential('linear-tok'),
      }),
    });
    const { status } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 401);
  });

  test('a 404 (genuinely not found, not an auth shape) is completely unaffected by this classification', async () => {
    const notFound = () => { const e = new Error('gone'); e.response = { status: 404, errors: [{ extensions: { statusCode: 404 } }] }; throw e; };
    const { status } = await request(buildDataRouteApp({ issueDetail: notFound }), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 404);
  });

  test('a successful request is completely unaffected', async () => {
    const ok = async () => ({ id: 'i1', identifier: 'LIN-1', title: 'ok', state: { name: 'Todo', type: 'unstarted' } });
    const { status } = await request(buildDataRouteApp({ issueDetail: ok }), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 200);
  });

  // Found by code review: a genuinely revoked-but-not-yet-expired credential
  // (the user disconnected the workspace mid-token-life) would otherwise
  // classify as transient FOREVER — our own recorded expiresAt never learns
  // about the revocation. Bounded by: a SECOND rejection of the SAME
  // fingerprint (now marked suspect by the first) escalates to terminal,
  // even though our bookkeeping still says "should be live".
  test('a SECOND rejection of the SAME still-looks-live fingerprint escalates to terminal (401) — the first is a one-off grace, not indefinite retry', async () => {
    const registry = createRejectedCredentialRegistry();
    const app = buildDataRouteApp({ rejectedCredentialRegistry: registry });

    const first = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(first.status, 503, 'first rejection: no prior history against this fingerprint — transient grace');

    const second = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(second.status, 401, 'second rejection: this fingerprint is now marked suspect from the first — no longer explainable as a one-off race, escalate');
  });

  // LIN-2327 — read-half pin: registry state → real classifier → real route.
  // Scope split, stated explicitly so it is not mistaken for end-to-end
  // proof: this pins the READ half only — that a rejectedCredentialRegistry
  // whose byte-identical counter is already past threshold makes
  // isTransientProviderAuthFailure return false (terminal 401) through the
  // real HTTP route, and that this holds across a genuine suspect-TTL
  // boundary. It cannot exercise the WRITE half — recordByteIdenticalRejection
  // is called from server.js's attemptSuspectCredentialRefresh, which sits
  // outside createProxyRoutes entirely (buildDataRouteApp stubs
  // resolveWorkspaceAccess directly, and server.js is not import-safe —
  // app.listen executes at module scope). The write half is covered by
  // tests/unit/credential-refusal-non-worsening.test.js's source-text/mirror
  // anti-drift pins instead — the established pattern this repo uses for
  // server.js-only code no unit test can import.
  test('a fingerprint past the byte-identical threshold stays terminal (401) even after its suspect mark genuinely lapses across the suspect-TTL boundary', async () => {
    // Seeded from the REAL clock, not this file's usual synthetic idiom.
    // routes/proxy.js:1170 always stamps a suspect mark with the real wall
    // clock (`now: Date.now()`) regardless of what clock the registry itself
    // was constructed with, while isSuspect (:1319) is called with no `at`
    // argument and therefore reads whatever clock the registry uses. A
    // synthetic low seed (e.g. 1_000_000) can never exceed a
    // real-Date.now()-stamped markedAt by suspectTtlMs, so advancing such a
    // clock could never genuinely lapse the suspect mark — the TTL boundary
    // this test exists to cross would never be crossed. Seeding from
    // Date.now() is the only construction under which advancing `t` past
    // DEFAULT_SUSPECT_TTL_MS genuinely lapses the mark.
    let t = Date.now();
    const registry = createRejectedCredentialRegistry({ now: () => t });
    const fingerprint = fingerprintCredential('linear-tok');

    // Prime the registry directly — this harness cannot reach the write site
    // (server.js's attemptSuspectCredentialRefresh) that would normally
    // produce this state.
    for (let i = 0; i < BYTE_IDENTICAL_ESCALATION_THRESHOLD; i++) registry.recordByteIdenticalRejection(fingerprint);
    registry.markSuspect(fingerprint, { reason: 'primed-for-test', now: t });
    assert.equal(registry.isSuspect(fingerprint), true, 'sanity: the priming mark must be live before driving any request');

    const app = buildDataRouteApp({ rejectedCredentialRegistry: registry });

    // (a) Within the suspect-TTL window: terminal 401 while isSuspect is
    // still true — explainable by either clause at this point, but must not
    // regress to the pre-fix 503.
    const within = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(within.status, 401, 'primed past-threshold fingerprint, still within its suspect-TTL window, must classify terminal');
    assert.equal(registry.isSuspect(fingerprint), true, 'still within the 10-minute suspect window');

    // (b) Advance the registry's OWN clock past the suspect TTL and prove
    // the boundary was genuinely crossed — not merely assumed. Re-anchored
    // from a FRESH Date.now() read rather than `t + DEFAULT_SUSPECT_TTL_MS`:
    // request (a) above drove a real 401 response, which re-marks the
    // fingerprint via routes/proxy.js:1170's OWN `now: Date.now()` call —
    // the real wall clock, independent of this registry's injected clock —
    // at whatever instant that request actually ran, slightly after our
    // original seed. Advancing from a fresh real-time read (plus a safety
    // margin) guarantees `t` lands past that re-mark too, not just past the
    // priming mark.
    t = Date.now() + DEFAULT_SUSPECT_TTL_MS + 1000;
    assert.equal(registry.isSuspect(fingerprint), false, 'the suspect mark must have genuinely lapsed once its TTL has elapsed on the registry\'s own clock');

    // (c) A further rejection against the SAME fingerprint after the
    // boundary must still return 401 — proving the byte-identical counter,
    // not the (now-lapsed) suspect mark, is what keeps this classification
    // terminal. This is the entire point of the fix: without it, the
    // classifier's only remaining escalation path (the pre-existing isSuspect
    // clause) would have nothing left to say and this would regress to 503.
    const pastBoundary = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(pastBoundary.status, 401, 'the byte-identical-rejection counter must keep this fingerprint terminal even after its suspect mark has lapsed');
  });

  test('a genuinely different fingerprint carries none of another fingerprint\'s past-threshold history — reset-on-replacement half, proved against the real registry/classifier/route', async () => {
    const registry = createRejectedCredentialRegistry();
    const staleFingerprint = fingerprintCredential('linear-tok');
    registry.recordByteIdenticalRejection(staleFingerprint);
    registry.recordByteIdenticalRejection(staleFingerprint);
    registry.markSuspect(staleFingerprint, { reason: 'unrelated-prior-history', now: Date.now() });

    const app = buildDataRouteApp({
      rejectedCredentialRegistry: registry,
      resolveWorkspaceAccess: async () => ({
        token: 'different-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
        expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('different-tok'),
      }),
    });

    const { status } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 503, 'a genuinely different fingerprint carries no suspect mark and no byte-identical count of its own — first rejection is still a transient grace');
  });

  test('the transient classification is per-REQUEST (req.resolvedCredentialExpiresAt), not read from the shared, racy credentialResolutions trail', async () => {
    // Two DIFFERENT owners on the SAME workspace resolve to DIFFERENT
    // credentials with different believed expiries. If the classification
    // read a shared per-(urlKey,ownerAccountId)-pair map instead of this
    // request's own stamp, one request's resolution could leak into the
    // other's classification. Both requests here share urlKey but use
    // DISTINCT createdBy (via distinct tokens), so a shared-map read keyed
    // loosely would be exposed; a per-request stamp cannot leak by
    // construction regardless of key derivation, which is the actual
    // property this test pins.
    let call = 0;
    const app = buildDataRouteApp({
      resolveWorkspaceAccess: async () => {
        call++;
        // First resolution looks DEAD, second looks LIVE — if either
        // request read a stale/foreign snapshot it would get the WRONG
        // answer for its own request.
        return call === 1
          ? { token: 'tok-dead', reason: 'ok', provider: 'linear', source: 'session-scan', expiresAt: Date.now() - 1000, credentialFingerprint: fingerprintCredential('tok-dead') }
          : { token: 'tok-live', reason: 'ok', provider: 'linear', source: 'session-scan', expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('tok-live') };
      },
    });

    const first = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(first.status, 401, 'this request\'s OWN resolution looked dead');

    const second = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(second.status, 503, 'this request\'s OWN resolution looked live — unaffected by the prior request\'s classification');
  });

  test('graphqlErrorExtra: the auth-shaped 503 body carries a machine-matchable code/category/retryable, reusing classifyUpstreamError\'s existing LINEAR_AUTH vocabulary', async () => {
    const { status, body } = await request(buildDataRouteApp(), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 503);
    assert.equal(body.code, 'LINEAR_AUTH');
    assert.equal(body.category, 'auth');
    assert.equal(body.retryable, true);
  });

  test('graphqlErrorExtra: the terminal 401 body carries the same code but retryable:false', async () => {
    const app = buildDataRouteApp({
      resolveWorkspaceAccess: async () => ({
        token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
        expiresAt: Date.now() - 1000, credentialFingerprint: fingerprintCredential('linear-tok'),
      }),
    });
    const { body } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(body.code, 'LINEAR_AUTH');
    assert.equal(body.retryable, false);
  });

  test('graphqlErrorExtra: a 404 carries no code/category/retryable at all — untouched, byte-identical to before this ticket', async () => {
    const notFound = () => { const e = new Error('gone'); e.response = { status: 404, errors: [{ extensions: { statusCode: 404 } }] }; throw e; };
    const { body } = await request(buildDataRouteApp({ issueDetail: notFound }), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(body.code, undefined);
    assert.equal(body.category, undefined);
    assert.equal(body.retryable, undefined);
  });
});

// ---------------------------------------------------------------------------
// Block C — POST /api/proxy/autopilot/kickoff's dedicated auth branch
// ---------------------------------------------------------------------------

function buildKickoffApp({ resolveWorkspaceAccess, fetchIssueContext } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 'tok-1', urlKey: 'acme', label: 'autopilot', scope: 'readWrite', createdBy: 'acct-owner' }),
      createToken: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: resolveWorkspaceAccess ?? (async () => ({
      token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('linear-tok'),
    })),
    getWorkspaceAccessToken: async () => 'linear-tok',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    dispatchPresetsStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: {
      name: 'linear',
      supports: () => true,
      fetchIssueContext: fetchIssueContext ?? (async () => { throw linearAuthError(); }),
    },
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

const KICKOFF = '/api/proxy/autopilot/kickoff';

describe('POST /api/proxy/autopilot/kickoff — dedicated upstream-auth branch ahead of the generic 500 (LIN-2216, Block C)', () => {
  test('an issue-scoped kickoff whose context fetch hits a LIVE-looking-but-rejected credential returns a machine-matchable 503, never the old bare 500', async () => {
    const { status, body } = await post(buildKickoffApp(), KICKOFF, { issueIdentifier: 'LIN-9999', target: 'cli' });
    assert.equal(status, 503);
    assert.equal(body.code, 'LINEAR_AUTH');
    assert.equal(body.category, 'auth');
    assert.equal(body.retryable, true);
    assert.ok(body.error);
  });

  test('an issue-scoped kickoff whose context fetch hits a credential our own records already believe is dead returns a terminal 401 with the same code', async () => {
    const app = buildKickoffApp({
      resolveWorkspaceAccess: async () => ({
        token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
        expiresAt: Date.now() - 1000, credentialFingerprint: fingerprintCredential('linear-tok'),
      }),
    });
    const { status, body } = await post(app, KICKOFF, { issueIdentifier: 'LIN-9999', target: 'cli' });
    assert.equal(status, 401);
    assert.equal(body.code, 'LINEAR_AUTH');
    assert.equal(body.retryable, false);
  });

  test('a genuinely-not-found issue is unaffected — still the pre-existing 404, never routed through the new auth branch', async () => {
    const notFound = async () => { throw new Error('Issue not found'); };
    const { status } = await post(buildKickoffApp({ fetchIssueContext: notFound }), KICKOFF, { issueIdentifier: 'LIN-9999', target: 'cli' });
    assert.equal(status, 404);
  });

  test('a genuinely unexpected error (not auth-shaped) still falls to the untouched generic 500', async () => {
    const boom = async () => { throw new Error('boom, totally unrelated'); };
    const { status, body } = await post(buildKickoffApp({ fetchIssueContext: boom }), KICKOFF, { issueIdentifier: 'LIN-9999', target: 'cli' });
    assert.equal(status, 500);
    assert.equal(body.error, 'Failed to dispatch autopilot kickoff');
    assert.equal(body.code, undefined, 'the generic 500 carries no code — only the new dedicated branch does');
  });
});
