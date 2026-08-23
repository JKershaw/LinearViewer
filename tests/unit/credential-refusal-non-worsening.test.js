/**
 * LIN-1980 acceptance witness: differential test between BASELINE (today's
 * resolveWorkspaceAccess — no suspect registry) and CANDIDATE (this ticket's
 * "mark suspect, attempt forced refresh, fall through on no replacement").
 *
 * The load-bearing property, pinned mechanically rather than argued (per the
 * LIN-1980 investigation comment): in the NO-REPLACEMENT world, CANDIDATE's
 * served-credential sequence is BYTE-IDENTICAL to BASELINE's — the fix must
 * never turn a served-but-dead credential into a withheld one. The distinct
 * value CANDIDATE adds is recovery WHEN a replacement becomes available,
 * which BASELINE can never do (selection has no liveness signal beyond
 * recorded expiry).
 *
 * `resolveWorkspaceAccess` itself is not import-safe (server.js connects to a
 * real database and starts listening at module load — see
 * tests/unit/workspace-token-refresh-integration.test.js's I5c precedent,
 * which this file follows). Both mirrors below are driven by the REAL
 * `selectOwnerWorkspaceToken`, `refreshOwnerWorkspaceToken`,
 * `createWorkspaceTokenCache`, `createRejectedCredentialRegistry`, and
 * `fingerprintCredential` — only the IO (sessions collection, durable store,
 * refresh HTTP exchange, session persistence) is faked. An anti-drift pin at
 * the bottom greps the real server.js source for the structural markers this
 * mirror assumes, so the mirror cannot silently diverge from production.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { UNSCOPED, selectOwnerWorkspaceToken } from '../../lib/workspace-token-resolver.js';
import { refreshOwnerWorkspaceToken, _resetInflightForTests } from '../../lib/workspace-token-refresh.js';
import { createWorkspaceTokenCache, workspaceTokenCacheKey } from '../../lib/workspace-token-cache.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

const URL_KEY = 'acme-suspect';
const ACCOUNT = 'account-suspect';

function inMemorySessionsCollection(seedDocs) {
  const docs = seedDocs.map(d => ({ ...d }));
  return {
    async find() { return { async toArray() { return docs.map(d => ({ ...d })); } }; },
    async updateOne(query, update) {
      const doc = docs.find(d => d._id === query._id);
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1 };
    },
  };
}

function makePersistSessionRow(collection) {
  return (sid, session) => collection.updateOne({ _id: sid }, { $set: { session } });
}

/** A fixed session row whose credential is LIVE-BY-RECORDED-EXPIRY but dead upstream — the incident's exact state. */
function liveButDeadSessionRow() {
  return {
    _id: 'sid-1',
    session: {
      accountId: ACCOUNT,
      workspaces: [{
        urlKey: URL_KEY,
        provider: 'linear',
        accessToken: 'dead-upstream-token',
        tokenExpiresAt: Date.now() + 24 * 3600 * 1000, // +24h: reads perfectly healthy
      }],
    },
  };
}

// BASELINE mirror: today's resolveWorkspaceAccess, byte-equivalent to
// resolveWorkspaceAccessMirror in workspace-token-refresh-integration.test.js
// (no cache layer needed for this file's scenarios — every BASELINE run goes
// through session-scan, matching the CANDIDATE cache-bypassed comparison
// below).
async function baselineResolve({ collection, urlKey, ownerAccountId }) {
  const sessions = await collection.find().then(c => c.toArray());
  const selected = selectOwnerWorkspaceToken(sessions, urlKey, ownerAccountId);
  return { token: selected.token, reason: selected.token ? 'ok' : selected.reason, provider: selected.provider };
}

// CANDIDATE mirror: this ticket's design. Deliberately re-implemented rather
// than importing server.js's private `attemptSuspectCredentialRefresh` (not
// exported, and server.js is not import-safe) — the anti-drift pin below is
// what keeps this honest against production.
async function candidateResolve({ collection, urlKey, ownerAccountId, refreshAccessToken, persistSession, store, registry, cache }) {
  const cacheKey = workspaceTokenCacheKey(urlKey, ownerAccountId);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    const cachedFingerprint = fingerprintCredential(cached.token);
    const recovered = await attemptSuspectRefresh({
      fingerprint: cachedFingerprint, urlKey, ownerAccountId, registry, refreshAccessToken, persistSession, store,
      loadSessions: () => collection.find().then(c => c.toArray()),
    });
    if (recovered) {
      cache.set(cacheKey, { token: recovered.token, expiresAt: recovered.expiresAt, provider: recovered.provider });
      registry.accept(cachedFingerprint);
      return { token: recovered.token, reason: 'ok', provider: recovered.provider, credentialFingerprint: recovered.credentialFingerprint };
    }
    return { token: cached.token, reason: 'ok', provider: cached.provider, credentialFingerprint: cachedFingerprint };
  }

  const sessions = await collection.find().then(c => c.toArray());
  const selected = selectOwnerWorkspaceToken(sessions, urlKey, ownerAccountId);
  if (selected.token) {
    const selectedFingerprint = fingerprintCredential(selected.token);
    const recovered = await attemptSuspectRefresh({
      fingerprint: selectedFingerprint, urlKey, ownerAccountId, registry, refreshAccessToken, persistSession, store,
      loadSessions: () => Promise.resolve(sessions),
    });
    if (recovered) {
      cache.set(cacheKey, { token: recovered.token, expiresAt: recovered.expiresAt, provider: recovered.provider });
      registry.accept(selectedFingerprint);
      return { token: recovered.token, reason: 'ok', provider: recovered.provider, credentialFingerprint: recovered.credentialFingerprint };
    }
    cache.set(cacheKey, { token: selected.token, expiresAt: selected.expiresAt, provider: selected.provider });
    return { token: selected.token, reason: 'ok', provider: selected.provider, credentialFingerprint: selectedFingerprint };
  }
  return { token: null, reason: selected.reason, provider: selected.provider, credentialFingerprint: null };
}

async function attemptSuspectRefresh({ fingerprint, urlKey, ownerAccountId, registry, refreshAccessToken, persistSession, store, loadSessions }) {
  if (ownerAccountId === UNSCOPED) return null;
  if (!registry.isSuspect(fingerprint)) return null;
  if (!registry.shouldAttemptRefresh(fingerprint, `${ownerAccountId}:${urlKey}`)) return null;
  try {
    const sessions = await loadSessions();
    const refreshed = await refreshOwnerWorkspaceToken({
      sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession,
      resolveProvider: () => ({}), store,
    });
    if (!refreshed) return null;
    const refreshedFingerprint = fingerprintCredential(refreshed.token);
    if (refreshedFingerprint === fingerprint) return null;
    return { ...refreshed, credentialFingerprint: refreshedFingerprint };
  } catch {
    return null;
  }
}

describe('LIN-1980 non-worsening acceptance witness', () => {
  test('NO REPLACEMENT world: CANDIDATE\'s served-credential sequence is byte-identical to BASELINE across 12 requests, even after every rejection marks the credential suspect', async () => {
    const collection = inMemorySessionsCollection([liveButDeadSessionRow()]);
    const store = { async get() { return null; }, async putIfRefreshToken() { return false; } }; // nothing refreshable
    const refreshAccessToken = async () => { throw new Error('should never be called — no durable record'); };
    const persistSession = makePersistSessionRow(collection);
    const registry = createRejectedCredentialRegistry();
    const cache = createWorkspaceTokenCache();

    const baselineServed = [];
    const candidateServed = [];
    const deadFingerprint = fingerprintCredential('dead-upstream-token');

    for (let i = 0; i < 12; i++) {
      const b = await baselineResolve({ collection, urlKey: URL_KEY, ownerAccountId: ACCOUNT });
      baselineServed.push(b.token);

      const c = await candidateResolve({ collection, urlKey: URL_KEY, ownerAccountId: ACCOUNT, refreshAccessToken, persistSession, store, registry, cache });
      candidateServed.push(c.token);
      // Every request in this simulation is treated as a rejected 401 (mirrors
      // logEvent's wiring) — matches the incident's every-request-fails shape.
      registry.markSuspect(c.credentialFingerprint ?? deadFingerprint, { reason: 'provider-401' });
    }

    assert.deepEqual(candidateServed, baselineServed, 'served token sequence must be byte-identical to baseline when nothing is refreshable');
    assert.ok(candidateServed.every(t => t === 'dead-upstream-token'), 'the dead credential keeps being served — never withheld, never a 503');
  });

  test('REFRESH EXCHANGE THROWS world (the CI condition that broke PR #1099): still byte-identical to baseline, never a latch', async () => {
    const collection = inMemorySessionsCollection([liveButDeadSessionRow()]);
    const store = {
      async get() { return { provider: 'linear', token: 'dead-upstream-token', refreshToken: 'spent-refresh-token', tokenExpiresAt: Date.now() - 1000 }; },
      async putIfRefreshToken() { return false; },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    const refreshAccessToken = async () => { throw new Error('TokenRefreshError: Missing LINEAR_CLIENT_ID or LINEAR_CLIENT_SECRET environment variables'); };
    const persistSession = makePersistSessionRow(collection);
    const registry = createRejectedCredentialRegistry();
    const cache = createWorkspaceTokenCache();

    const baselineServed = [];
    const candidateServed = [];

    for (let i = 0; i < 6; i++) {
      const b = await baselineResolve({ collection, urlKey: URL_KEY, ownerAccountId: ACCOUNT });
      baselineServed.push(b.token);
      const c = await candidateResolve({ collection, urlKey: URL_KEY, ownerAccountId: ACCOUNT, refreshAccessToken, persistSession, store, registry, cache });
      candidateServed.push(c.token);
      registry.markSuspect(fingerprintCredential('dead-upstream-token'), { reason: 'provider-401' });
    }

    assert.deepEqual(candidateServed, baselineServed);
    assert.ok(candidateServed.every(t => t === 'dead-upstream-token'));
  });

  test('REPLACEMENT APPEARS world: CANDIDATE recovers to the fresh credential; BASELINE keeps serving the dead one forever', async () => {
    // Two INDEPENDENT session collections, seeded identically, so CANDIDATE's
    // own refresh round-trip (which mirrors the refreshed token back into
    // whatever session row it's given, exactly like production) cannot leak
    // into BASELINE's world and produce a false "baseline recovered too".
    // BASELINE genuinely has no path to the durable store at all — this
    // isolation just keeps the test honest about that.
    const candidateCollection = inMemorySessionsCollection([liveButDeadSessionRow()]);
    const baselineCollection = inMemorySessionsCollection([liveButDeadSessionRow()]);
    let durableRecord = null; // nothing refreshable at first
    const store = {
      async get() { return durableRecord; },
      async putIfRefreshToken(accountId, urlKey, expected, next) {
        if (!durableRecord || durableRecord.refreshToken !== expected) return false;
        durableRecord = { ...durableRecord, ...next };
        return true;
      },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    const refreshAccessToken = async (refreshToken) => {
      if (refreshToken !== 'fresh-refresh-token') throw new Error('no live durable record yet');
      return { access_token: 'fresh-replacement-token', refresh_token: 'rotated-fresh-refresh-token', expires_in: 3600 };
    };
    const persistSession = makePersistSessionRow(candidateCollection);
    // Injectable clock: the per-fingerprint cooldown (60s default) must not
    // suppress the recovery attempt in the SECOND phase below just because
    // real wall-clock time between test iterations is sub-millisecond.
    let now = 1_000;
    const registry = createRejectedCredentialRegistry({ now: () => now });
    const cache = createWorkspaceTokenCache({ now: () => now });

    const candidateServed = [];
    const baselineServed = [];
    for (let i = 0; i < 3; i++) {
      baselineServed.push((await baselineResolve({ collection: baselineCollection, urlKey: URL_KEY, ownerAccountId: ACCOUNT })).token);
      const c = await candidateResolve({ collection: candidateCollection, urlKey: URL_KEY, ownerAccountId: ACCOUNT, refreshAccessToken, persistSession, store, registry, cache });
      candidateServed.push(c.token);
      registry.markSuspect(fingerprintCredential('dead-upstream-token'), { reason: 'provider-401' });
      now += 1_000;
    }
    assert.ok(candidateServed.every(t => t === 'dead-upstream-token'), 'no replacement yet — both serve the dead credential');

    // A replacement becomes available (e.g. the owner re-linked), and enough
    // time has passed for the cooldown from the first (failed) attempt above
    // to clear — a real deployment would see this too, since the cooldown is
    // only ever meant to cap same-instant concurrent/rapid resolves.
    durableRecord = { provider: 'linear', token: 'dead-upstream-token', refreshToken: 'fresh-refresh-token', tokenExpiresAt: Date.now() - 1000 };
    now += 61_000;

    for (let i = 0; i < 3; i++) {
      baselineServed.push((await baselineResolve({ collection: baselineCollection, urlKey: URL_KEY, ownerAccountId: ACCOUNT })).token);
      const c = await candidateResolve({ collection: candidateCollection, urlKey: URL_KEY, ownerAccountId: ACCOUNT, refreshAccessToken, persistSession, store, registry, cache });
      candidateServed.push(c.token);
    }

    assert.equal(candidateServed[candidateServed.length - 1], 'fresh-replacement-token', 'CANDIDATE adopts the replacement');
    assert.equal(baselineServed[baselineServed.length - 1], 'dead-upstream-token', 'BASELINE has no liveness signal beyond recorded expiry and never recovers — this is the gap LIN-1980 closes');
  });

  test('COOLDOWN world: an attempt cooldown caps refresh attempts without changing the served outcome', async () => {
    const collection = inMemorySessionsCollection([liveButDeadSessionRow()]);
    let attemptCount = 0;
    const store = { async get() { return null; }, async putIfRefreshToken() { return false; } };
    const refreshAccessToken = async () => { attemptCount++; throw new Error('still dead'); };
    const persistSession = makePersistSessionRow(collection);
    const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000 });
    const cache = createWorkspaceTokenCache();

    const served = [];
    for (let i = 0; i < 9; i++) {
      const c = await candidateResolve({ collection, urlKey: URL_KEY, ownerAccountId: ACCOUNT, refreshAccessToken, persistSession, store, registry, cache });
      served.push(c.token);
      registry.markSuspect(fingerprintCredential('dead-upstream-token'), { reason: 'provider-401' });
    }

    assert.ok(served.every(t => t === 'dead-upstream-token'), 'served outcome unaffected by the cooldown');
    // store.get is never reached without a refreshToken present (store.get
    // returns null in this world), so refreshAccessToken itself is never
    // called at all — the cooldown assertion that matters here is on the
    // registry's own gate, exercised directly in rejected-credentials.test.js.
    // This test's job is only the served-outcome half of the guarantee.
    assert.equal(attemptCount, 0);
  });

  test('GITHUB-FAMILY world: the forced-refresh attempt is a structural no-op, and the served outcome stays byte-identical to baseline (LIN-1991 scope boundary, non-worsening even so)', async () => {
    // selectExpiredOwnerRow (which the github-family re-mint arm is gated
    // behind) only ever matches a row that is NOT live by recorded expiry —
    // and this ticket's whole trigger condition is a row that IS live by
    // recorded expiry. So for a github-family row the durable/session arms
    // inside refreshOwnerWorkspaceToken both return null, unconditionally,
    // regardless of what the fake store/refresh functions below would do —
    // proven by never configuring them to succeed and asserting no crash and
    // no served-outcome change.
    const collection = inMemorySessionsCollection([{
      _id: 'sid-gh',
      session: {
        accountId: ACCOUNT,
        workspaces: [{ urlKey: URL_KEY, provider: 'github', accessToken: 'dead-github-token', tokenExpiresAt: Date.now() + 24 * 3600 * 1000 }],
      },
    }]);
    const store = { async get() { return null; }, async putIfRefreshToken() { return false; } };
    const refreshAccessToken = async () => { throw new Error('linear-only exchange; github family never reaches this'); };
    const persistSession = makePersistSessionRow(collection);
    const registry = createRejectedCredentialRegistry();
    const cache = createWorkspaceTokenCache();

    const served = [];
    for (let i = 0; i < 3; i++) {
      const b = await baselineResolve({ collection, urlKey: URL_KEY, ownerAccountId: ACCOUNT });
      const c = await candidateResolve({ collection, urlKey: URL_KEY, ownerAccountId: ACCOUNT, refreshAccessToken, persistSession, store, registry, cache });
      assert.equal(c.token, b.token, 'candidate and baseline agree on every request');
      served.push(c.token);
      registry.markSuspect(fingerprintCredential('dead-github-token'), { reason: 'provider-401' });
    }
    assert.ok(served.every(t => t === 'dead-github-token'));
  });

  test('REPLACEMENT ADOPTED BUT STILL REJECTED world: refresh attempts stay bounded across N requests, not one OAuth rotation per request (LIN-1980 review F1)', async () => {
    // The reviewed flaw: the per-fingerprint cooldown alone does not bound
    // attempts once a replacement is adopted. `accept()` deletes the
    // superseded fingerprint's cooldown entry, so a freshly-marked
    // replacement fingerprint starts with `lastAttemptAt: null` — and if the
    // provider keeps rejecting the credential for a reason a refresh cannot
    // fix (a routine 403 collapsed to 401 against a healthy-but-scope-limited
    // credential, not a freshness problem), every refresh succeeds at
    // minting a NEW token/fingerprint that is immediately rejected again,
    // re-arming the per-fingerprint gate on every single request. The
    // reviewer's own harness measured 29 OAuth rotations across 30 requests
    // against this PR's real modules before the fix below.
    const collection = inMemorySessionsCollection([liveButDeadSessionRow()]);
    let durableRecord = { provider: 'linear', token: 'dead-upstream-token', refreshToken: 'refresh-0', tokenExpiresAt: Date.now() - 1000 };
    const store = {
      async get() { return durableRecord; },
      async putIfRefreshToken(accountId, urlKey, expected, next) {
        if (!durableRecord || durableRecord.refreshToken !== expected) return false;
        durableRecord = { ...durableRecord, ...next };
        return true;
      },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    let rotation = 0;
    let refreshAttempts = 0;
    const refreshAccessToken = async () => {
      // Every call SUCCEEDS — a genuine OAuth rotation, exactly like a real
      // refresh token that still works — but the newly-minted token is
      // STILL rejected upstream, because the rejection was never about
      // freshness in the first place.
      refreshAttempts++;
      rotation++;
      return { access_token: `rotated-token-${rotation}`, refresh_token: `rotated-refresh-${rotation}`, expires_in: 3600 };
    };
    const persistSession = makePersistSessionRow(collection);
    let now = 1_000;
    const registry = createRejectedCredentialRegistry({ now: () => now });
    const cache = createWorkspaceTokenCache({ now: () => now });

    const served = [];
    for (let i = 0; i < 30; i++) {
      const c = await candidateResolve({ collection, urlKey: URL_KEY, ownerAccountId: ACCOUNT, refreshAccessToken, persistSession, store, registry, cache });
      served.push(c.token);
      // Every request in this simulation is rejected again — the population
      // this ticket's own risk argument targets (see the review comment).
      registry.markSuspect(c.credentialFingerprint, { reason: 'provider-401' });
      now += 100; // rapid resolves, well within the default 60s cooldown window
    }

    assert.ok(refreshAttempts <= 1, `refresh (OAuth rotation) attempts must stay bounded to ~1 per cooldown window across fingerprint churn, got ${refreshAttempts} across ${served.length} requests`);
    assert.equal(served[0], 'dead-upstream-token', 'first request is unrefreshed — nothing was suspect yet');
    assert.ok(served.slice(1).every(t => t === served[1]), 'once the single bounded attempt lands, the SAME resulting credential is re-served — no further rotation this window');
  });
});

// --- Anti-drift pin: the mirror above must not silently diverge from server.js ---

function extractResolveWorkspaceAccessBody(src) {
  const start = src.indexOf('async function resolveWorkspaceAccess');
  assert.ok(start >= 0, 'async function resolveWorkspaceAccess not found in server.js');
  const end = src.indexOf('\n}', start);
  assert.ok(end >= 0, "could not find resolveWorkspaceAccess's top-level closing brace");
  return src.slice(start, end + 2);
}

function extractAttemptSuspectCredentialRefreshBody(src) {
  const start = src.indexOf('async function attemptSuspectCredentialRefresh');
  assert.ok(start >= 0, 'async function attemptSuspectCredentialRefresh not found in server.js');
  const end = src.indexOf('\n}', start);
  assert.ok(end >= 0, "could not find attemptSuspectCredentialRefresh's top-level closing brace");
  return src.slice(start, end + 2);
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('LIN-1980 anti-drift pin (production source, not the mirror)', () => {
  test('resolveWorkspaceAccess computes credentialFingerprint on every credential-bearing return path, including the NODE_ENV=test short-circuit', () => {
    const flat = stripComments(extractResolveWorkspaceAccessBody(SERVER_SRC)).replace(/\s+/g, ' ');
    assert.match(flat, /credentialFingerprint:\s*fingerprintCredential\('test-token'\)/, 'the test-mode short-circuit must be included in the fingerprint enumeration (plan-review round 2, F2)');
    assert.match(flat, /credentialFingerprint:\s*cachedFingerprint/, 'the cache-hit path must stamp a fingerprint');
    assert.match(flat, /credentialFingerprint:\s*selectedFingerprint/, 'the session-scan path must stamp a fingerprint');
  });

  test('the cache-hit path calls attemptSuspectCredentialRefresh — plan-review round 2\'s "cache-hit path must get the same suspect check as session-scan" edge', () => {
    const flat = stripComments(extractResolveWorkspaceAccessBody(SERVER_SRC)).replace(/\s+/g, ' ');
    const cacheHitIdx = flat.indexOf('workspaceTokenCache.get(cacheKey)');
    const sessionScanIdx = flat.indexOf('selectOwnerWorkspaceToken(sessions');
    assert.ok(cacheHitIdx >= 0 && sessionScanIdx > cacheHitIdx, 'expected cache-hit block to textually precede the session-scan block');
    const cacheHitBlock = flat.slice(cacheHitIdx, sessionScanIdx);
    assert.match(cacheHitBlock, /attemptSuspectCredentialRefresh\(/, 'the cache-hit branch must attempt suspect-credential recovery, not just the session-scan branch');
  });

  test('attemptSuspectCredentialRefresh excludes UNSCOPED callers and never marks anything unselectable', () => {
    const flat = stripComments(extractAttemptSuspectCredentialRefreshBody(SERVER_SRC)).replace(/\s+/g, ' ');
    assert.match(flat, /ownerAccountId === UNSCOPED/, 'must preserve the owner-blind exclusion');
    assert.match(flat, /rejectedCredentialRegistry\.isSuspect\(/);
    assert.match(flat, /rejectedCredentialRegistry\.shouldAttemptRefresh\(/);
    assert.doesNotMatch(flat, /isSuspended/, 'this design must never reintroduce PR #1099\'s unselectable-credential predicate');
  });

  test('a same-fingerprint or null refresh result falls through untouched — never withholds the originally-selected credential', () => {
    const flat = stripComments(extractAttemptSuspectCredentialRefreshBody(SERVER_SRC)).replace(/\s+/g, ' ');
    assert.match(flat, /if \(!refreshed\) return null/);
    assert.match(flat, /refreshedFingerprint === fingerprint\) return null/);
  });

  test('shouldAttemptRefresh is called with a (ownerAccountId, urlKey) scope key — review F1: bounds attempts across fingerprint churn, not just per-fingerprint', () => {
    const flat = stripComments(extractAttemptSuspectCredentialRefreshBody(SERVER_SRC)).replace(/\s+/g, ' ');
    assert.match(flat, /shouldAttemptRefresh\(fingerprint,\s*`\$\{ownerAccountId\}:\$\{urlKey\}`\)/, 'a bare shouldAttemptRefresh(fingerprint) reintroduces the unbounded-rotation flaw F1 found');
  });

  test('selectOwnerWorkspaceToken (the selector) is untouched by this ticket — no isSuspended parameter, matching the accepted design', () => {
    const resolverSrc = readFileSync(join(__dirname, '../../lib/workspace-token-resolver.js'), 'utf8');
    const start = resolverSrc.indexOf('export function selectOwnerWorkspaceToken');
    const end = resolverSrc.indexOf('\n}', start);
    const body = resolverSrc.slice(start, end + 2);
    assert.doesNotMatch(body, /isSuspended/, 'selection must stay byte-identical — suspicion is consulted only in resolveWorkspaceAccess, never in the selector');
  });
});
