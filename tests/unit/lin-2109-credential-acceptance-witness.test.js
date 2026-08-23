/**
 * LIN-2109 — the credential-acceptance witness: the branch LIN-2097 deliberately
 * left open. LIN-2097 freezes `tokenExpiresAt` only when a refresh returns
 * BYTE-IDENTICAL access-token bytes; a credential that mints NEW bytes on every
 * refresh while still being refused by the provider evades that check (new
 * bytes -> new fingerprint -> no rejection history -> expiry extends
 * legitimately, forever). LIN-1983 recorded two real singleton fingerprints
 * that were exchanged, adopted, cached, `accept()`ed, and 401'd immediately.
 *
 * The sound witness (per the ticket): a non-401 provider-lane response
 * carrying `req.resolvedCredentialFingerprint`. Exchange success and adoption
 * are explicitly NOT this signal.
 *
 * Block A: lib/rejected-credentials.js's new witnessAccepted/hasBeenWitnessed
 *          (pure, direct).
 * Block B: routes/proxy.js's logEvent wiring — the positive-half instrumentation
 *          gap this ticket names (route-level, real createProxyRoutes).
 * Block C: lib/workspace-token-refresh.js's doOwnerRefresh/refreshOwnerCredential
 *          — the actual expiry-extension gate, reproducing LIN-1983's exact
 *          shape and proving refreshToken is still persisted either way.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { refreshOwnerCredential, _resetInflightForTests } from '../../lib/workspace-token-refresh.js';

const NOW = Date.now();
const FAR_FUTURE_MS = 10_000_000;
const PAST_MS = -10_000;

// ---------------------------------------------------------------------------
// Block A — lib/rejected-credentials.js
// ---------------------------------------------------------------------------

describe('rejectedCredentialRegistry.witnessAccepted/hasBeenWitnessed (LIN-2109, Block A)', () => {
  test('a witnessed fingerprint reads true; an unwitnessed one reads false', () => {
    const registry = createRejectedCredentialRegistry();
    assert.equal(registry.hasBeenWitnessed('fp-1'), false);
    registry.witnessAccepted('fp-1');
    assert.equal(registry.hasBeenWitnessed('fp-1'), true);
    assert.equal(registry.hasBeenWitnessed('fp-2'), false, 'a DIFFERENT fingerprint is unaffected');
  });

  test('fails open on a null/undefined fingerprint — nothing to key on', () => {
    const registry = createRejectedCredentialRegistry();
    registry.witnessAccepted(null);
    registry.witnessAccepted(undefined);
    assert.equal(registry.hasBeenWitnessed(null), false);
    assert.equal(registry.hasBeenWitnessed(undefined), false);
  });

  test('a witness expires after suspectTtlMs, same discipline as markSuspect', () => {
    let t = 1_000_000;
    const registry = createRejectedCredentialRegistry({ suspectTtlMs: 1000, now: () => t });
    registry.witnessAccepted('fp-1');
    assert.equal(registry.hasBeenWitnessed('fp-1'), true);
    t += 1001;
    assert.equal(registry.hasBeenWitnessed('fp-1'), false, 'stale witness must not count as live acceptance');
  });

  test('witnessAccepted and markSuspect/accept are independent maps — marking suspect does not erase a witness, and vice versa', () => {
    const registry = createRejectedCredentialRegistry();
    registry.witnessAccepted('fp-1');
    registry.markSuspect('fp-1', { reason: 'later-401' });
    assert.equal(registry.hasBeenWitnessed('fp-1'), true, 'a later rejection does not retroactively un-witness an earlier acceptance');
    assert.equal(registry.isSuspect('fp-1'), true);
  });
});

// ---------------------------------------------------------------------------
// Block B — routes/proxy.js's logEvent (the positive-half instrumentation gap)
// ---------------------------------------------------------------------------

function fakeRegistry() {
  const witnessCalls = [];
  const markSuspectCalls = [];
  return {
    witnessCalls, markSuspectCalls,
    markSuspect: (fp, opts) => markSuspectCalls.push({ fp, opts }),
    witnessAccepted: (fp) => witnessCalls.push(fp),
    isSuspect: () => false,
    shouldAttemptRefresh: () => false,
    accept: () => {},
  };
}

function buildApp({ issueDetail, rejectedCredentialRegistry, supports } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 'tok-agent-1', urlKey: 'acme', label: 'autopilot', scope: 'readWrite', createdBy: 'acct-owner' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({
      token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt: Date.now() + 3600_000, credentialFingerprint: fingerprintCredential('linear-tok'),
    }),
    getWorkspaceAccessToken: async () => 'linear-tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: {
      name: 'linear',
      supports: supports ?? (() => true),
      issueDetail: issueDetail ?? (async () => ({ id: 'i1', title: 'ok' })),
      issueWriteGuard: async () => ({ id: 'i1', trashed: false }),
      createComment: async (token, issueId, body) => ({ id: 'c1', body }),
    },
    rejectedCredentialRegistry,
  }));
  return app;
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { Authorization: 'Bearer agent-token', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const ISSUE_UUID = '266f0841-ef9a-40de-a7b4-e18890efbf05';

describe('routes/proxy.js logEvent — the acceptance-witness positive half (LIN-2109, Block B)', () => {
  test('a non-401 provider-lane response witnesses the resolved fingerprint', async () => {
    const registry = fakeRegistry();
    const { status } = await request(buildApp({ rejectedCredentialRegistry: registry }), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 200);
    assert.deepEqual(registry.witnessCalls, [fingerprintCredential('linear-tok')]);
    assert.deepEqual(registry.markSuspectCalls, []);
  });

  test('a 401 never witnesses — it marks suspect instead (the two are mutually exclusive per request)', async () => {
    const registry = fakeRegistry();
    const authErr = () => { const e = new Error('auth'); e.response = { status: 401, errors: [{ extensions: { statusCode: 401 } }] }; throw e; };
    const { status } = await request(buildApp({ issueDetail: authErr, rejectedCredentialRegistry: registry }), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 401);
    assert.deepEqual(registry.witnessCalls, []);
    assert.equal(registry.markSuspectCalls.length, 1);
  });

  test('no rejectedCredentialRegistry injected never throws on the success path either', async () => {
    const { status } = await request(buildApp({ rejectedCredentialRegistry: undefined }), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 200);
  });

  test('an OLDER fake registry with no witnessAccepted method never throws (backward compatible with pre-LIN-2109 test doubles)', async () => {
    const oldStyleRegistry = { markSuspect: () => {}, isSuspect: () => false, shouldAttemptRefresh: () => false, accept: () => {} };
    const { status } = await request(buildApp({ rejectedCredentialRegistry: oldStyleRegistry }), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 200, 'a missing witnessAccepted method must degrade to a no-op, never hang or crash the request');
  });

  // Found by code review: a request that resolves a credential (fingerprint
  // stamped) and THEN fails a purely LOCAL guard — never reaching the
  // provider at all — must not witness. denyIfUnsupported's 422 is one of
  // several such guards (others: a malformed-input 400, a duplicate-dispatch
  // 409) — all fire strictly after resolveProviderAccess and never contact
  // the provider.
  test('a LOCAL guard rejection (422 CAPABILITY_NOT_SUPPORTED) that never reaches the provider does NOT witness, even though a fingerprint was resolved', async () => {
    const registry = fakeRegistry();
    const app = buildApp({ rejectedCredentialRegistry: registry, supports: () => false });
    const { status } = await request(app, '/api/proxy/issues', { method: 'POST', body: { teamId: 'LIN', title: 'x' } });
    assert.equal(status, 422);
    assert.deepEqual(registry.witnessCalls, [], 'denyIfUnsupported never contacted the provider — nothing to witness');
  });

  test('a non-2xx, non-401/503 status in general never witnesses (the gate is 2xx-only, not merely "not 401")', async () => {
    const registry = fakeRegistry();
    const notFound = () => { const e = new Error('gone'); e.response = { status: 404, errors: [{ extensions: { statusCode: 404 } }] }; throw e; };
    const { status } = await request(buildApp({ issueDetail: notFound, rejectedCredentialRegistry: registry }), `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 404);
    assert.deepEqual(registry.witnessCalls, [], '404 IS a genuine provider round trip, but this ticket deliberately narrows to 2xx only — see the inline comment at the call site for why');
  });

  // Found by a SECOND code-review pass: a 2xx that never reached the
  // provider because a CACHE answered it instead. The comment-create dedupe
  // (LIN-399) is the one site of this shape in the file.
  test('a comment-create DEDUPE-CACHE hit (a real 2xx that never calls provider.createComment on the repeat) does NOT witness', async () => {
    const registry = fakeRegistry();
    const app = buildApp({ rejectedCredentialRegistry: registry });
    const body = { body: `unique-dedupe-probe-${Date.now()}-${Math.random()}` };

    const first = await request(app, `/api/proxy/issues/${ISSUE_UUID}/comments`, { method: 'POST', body });
    assert.equal(first.status, 201);
    assert.deepEqual(registry.witnessCalls, [fingerprintCredential('linear-tok')], 'the REAL create witnesses once');

    registry.witnessCalls.length = 0; // isolate round 2
    const second = await request(app, `/api/proxy/issues/${ISSUE_UUID}/comments`, { method: 'POST', body });
    assert.equal(second.status, 200, 'the identical body hits the dedupe cache');
    assert.deepEqual(registry.witnessCalls, [], 'served from cache — provider.createComment was never called again, so nothing to witness');
  });
});

// ---------------------------------------------------------------------------
// Block C — lib/workspace-token-refresh.js's doOwnerRefresh (the actual gate)
// ---------------------------------------------------------------------------

function fakeStore(seed = {}) {
  const records = new Map();
  for (const [key, credential] of Object.entries(seed)) records.set(key, credential);
  return {
    records,
    async get(accountId, urlKey, provider = 'linear') {
      return records.get(`${accountId}::${urlKey}::${provider}`) ?? null;
    },
    async putIfRefreshToken(accountId, urlKey, expected, next) {
      const key = `${accountId}::${urlKey}::${next.provider || 'linear'}`;
      const current = records.get(key);
      if (!current || current.refreshToken !== expected) return false;
      records.set(key, { ...next, pendingSpend: null });
      return true;
    },
    async markSpendIntent(accountId, urlKey, provider) {
      const key = `${accountId}::${urlKey}::${provider || 'linear'}`;
      const current = records.get(key);
      if (!current) return false;
      records.set(key, { ...current, pendingSpend: null });
      return true;
    },
    async clearSpendIntent() { return true; },
  };
}

describe('refreshOwnerCredential / doOwnerRefresh — expiry-extension gating (LIN-2109, Block C — deliberately NOT wired)', () => {
  beforeEach(() => {
    _resetInflightForTests();
  });

  // LIN-2109's own "Remedy shape" proposed consulting the acceptance witness
  // here, before extending a NEW-bytes credential's expiry. That was
  // implemented and then REVERTED after an independent code-review pass
  // traced a severe regression: a witness can only be recorded AFTER a
  // refreshed credential is actually used, but Linear rotates access-token
  // bytes on ORDINARY healthy refreshes too (not only pathological ones —
  // see LIN-2110's own recorded open question on this). Each refresh mints
  // fresh, distinct bytes that get used once and are superseded before their
  // own witness (if any) could ever apply to THAT SAME fingerprint again —
  // so gating here would freeze `tokenExpiresAt` on nearly every ordinary
  // refresh, forcing a fresh OAuth exchange on every subsequent request.
  // These tests pin that `doOwnerRefresh` genuinely was NOT changed —
  // regression insurance against someone re-adding the gate without also
  // solving the "witness arrives after the spend" ordering problem.

  test('new bytes still extend normally — a witness capability existing on the registry does not, by itself, change refresh behaviour', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-OLD', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS } });
    const refreshAccessToken = async () => ({ access_token: 'access-NEW', refresh_token: 'R1', expires_in: 3600 });

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    assert.ok(result.expiresAt > NOW, 'new bytes extend, exactly as LIN-2097 left it — unaffected by whether anything has been witnessed');
    assert.notEqual(result.expiresAt, NOW + PAST_MS);
  });

  test('a repeated new-bytes-every-time churn (the LIN-1983 shape) is UNCHANGED by this ticket — still extends every round, same as before this ticket touched the file', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-v0', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS } });
    let n = 0;
    const refreshAccessToken = async () => { n++; return { access_token: `access-v${n}`, refresh_token: `R${n}`, expires_in: 3600 }; };

    const results = [];
    for (let i = 0; i < 3; i++) {
      _resetInflightForTests();
      results.push(await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store }));
    }

    for (const result of results) {
      assert.notEqual(result, null);
      assert.ok(result.expiresAt > NOW, 'still extends — this ticket did not change this branch\'s behaviour, only added the (currently unconsumed) witness-recording capability');
    }
  });

  test('the byte-IDENTICAL branch (LIN-2097) is untouched', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-SAME', refreshToken: 'R0', tokenExpiresAt: NOW + FAR_FUTURE_MS } });
    const refreshAccessToken = async () => ({ access_token: 'access-SAME', refresh_token: 'R1-rotated', expires_in: 3600 });

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    assert.equal(result.expiresAt, NOW + FAR_FUTURE_MS, 'byte-identical still freezes, exactly as LIN-2097 left it');
  });
});
