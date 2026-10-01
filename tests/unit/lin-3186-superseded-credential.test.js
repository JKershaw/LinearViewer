/**
 * LIN-3186 — the dead-provider-credential re-selection loop.
 *
 * The seven planned behaviours, each driven through the REAL modules:
 *   P1  registry supersession history survives `accept()`
 *   P2  adoption writes the credential back and logs `[credential-adopted]`
 *   P3  superseded rows are excluded from selection (with a fallback)
 *   P4  a repeat rejection of a superseded fingerprint is terminal 401
 *   P5  `isDanglingReferent` logs a swallowed auth error and still fails open
 *
 * Run with: node --test tests/unit/lin-3186-superseded-credential.test.js
 *
 * Test-integrity discipline (the acceptance-witness rubric this repo uses):
 * each load-bearing assertion was observed to FAIL against the unfixed code —
 * for the reproduction and wrapper tests, by removing the supersession
 * exclusion and re-running (recorded in the PR body), since the new module
 * cannot even import on `main`. Pins of pre-existing behaviour (P5's fail-open,
 * P6.6's null -> true) were mutation-checked instead.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';
import { selectOwnerWorkspaceToken, UNSCOPED } from '../../lib/workspace-token-resolver.js';
import { selectOwnerWorkspaceTokenExcludingSuperseded } from '../../lib/superseded-selection.js';
import { attemptSuspectCredentialRefresh } from '../../lib/suspect-credential-refresh.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { createWorkspaceTokenCache, workspaceTokenCacheKey } from '../../lib/workspace-token-cache.js';
import { createCredentialTrail } from '../../lib/proxy-credential-trail.js';
import { isDanglingReferent } from '../../lib/dispatch-referent-guard.js';
import { createProxyRoutes } from '../../routes/proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL_KEY = 'acme-3186';
const ACCOUNT = 'acct-3186';

const recordingLifecycleStore = () => ({ events: [], async recordEvent(e) { this.events.push(e); } });

/** Capture console.log/warn output for the duration of `fn`, tagged by channel. */
async function withCapturedConsole(fn) {
  const logs = [];
  const warns = [];
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = (...args) => logs.push(args);
  console.warn = (...args) => warns.push(args);
  try {
    await fn();
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
  return { logs, warns };
}

// ---------------------------------------------------------------------------
// P1 — registry keeps supersession history across accept()
// ---------------------------------------------------------------------------

describe('P1 — supersession history in the registry', () => {
  test('accept(fp, {supersededBy}) records supersession, clears the mark, and leaves scopeAttempts untouched', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.markSuspect('fp-D');
    registry.shouldAttemptRefresh('fp-D', 'acct:ws'); // consume the scope window
    assert.equal(registry.isSuperseded('fp-D'), false);

    registry.accept('fp-D', { supersededBy: 'fp-G', source: 'durable-adopt' });

    assert.equal(registry.isSuspect('fp-D'), false, 'accept still clears the suspect mark');
    assert.equal(registry.isSuperseded('fp-D'), true, 'supersession survives accept');
    assert.deepEqual([...registry.supersededFingerprints()], ['fp-D']);
    // scopeAttempts is deliberately NOT reset by accept() (LIN-1980 review F1).
    assert.equal(registry.shouldAttemptRefresh('fp-D', 'acct:ws'), false, 'the scope cooldown is untouched');
  });

  test('old one-arg accept() records no supersession (backward compatible)', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.accept('fp-a');
    assert.equal(registry.isSuperseded('fp-a'), false);
    assert.equal(registry.rejectionCount('fp-a'), 0);
  });

  test('rejectionCount counts each markSuspect and is independent of the TTL-pruned suspect mark', () => {
    let now = 1000;
    const registry = createRejectedCredentialRegistry({ suspectTtlMs: 10, now: () => now });
    registry.markSuspect('fp-a');
    registry.markSuspect('fp-a');
    assert.equal(registry.rejectionCount('fp-a'), 2);
    now += 1000; // the suspect mark lapses
    assert.equal(registry.isSuspect('fp-a'), false, 'sanity: the TTL-pruned mark lapsed');
    assert.equal(registry.rejectionCount('fp-a'), 2, 'the rejection count is limit-only, never TTL-pruned');
  });

  test('a supersession captures the rejection count at supersession time', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.markSuspect('fp-D');
    registry.markSuspect('fp-D');
    registry.accept('fp-D', { supersededBy: 'fp-G', source: 'durable-adopt' });
    assert.equal(registry.isSuperseded('fp-D'), true);
    assert.equal(registry.rejectionCount('fp-D'), 2);
  });
});

// ---------------------------------------------------------------------------
// P3 — the selection wrapper
// ---------------------------------------------------------------------------

describe('P3 — selectOwnerWorkspaceTokenExcludingSuperseded', () => {
  const now = Date.now();
  const rows = () => ([
    { _id: 'sid-d', session: { accountId: ACCOUNT, workspaces: [
      { urlKey: URL_KEY, provider: 'linear', accessToken: 'dead-D', tokenExpiresAt: now + 7200_000 },
    ] } },
    { _id: 'sid-g', session: { accountId: ACCOUNT, workspaces: [
      { urlKey: URL_KEY, provider: 'linear', accessToken: 'good-G', tokenExpiresAt: now + 3600_000 },
    ] } },
  ]);

  test('superseded + good candidate picks the good one (dead latest-expiry row excluded)', () => {
    const registry = createRejectedCredentialRegistry();
    const fpD = fingerprintCredential('dead-D');
    registry.markSuspect(fpD);
    registry.accept(fpD, { supersededBy: fingerprintCredential('good-G'), source: 'durable-adopt' });
    const selected = selectOwnerWorkspaceTokenExcludingSuperseded(rows(), URL_KEY, ACCOUNT, registry);
    assert.equal(selected.token, 'good-G');
  });

  test('superseded-only candidate FALLS BACK (no latch) — never a workspace-wide refusal', () => {
    const registry = createRejectedCredentialRegistry();
    const fpD = fingerprintCredential('dead-D');
    registry.markSuspect(fpD);
    registry.accept(fpD, { supersededBy: 'fp-G', source: 'durable-adopt' });
    const onlyD = [{ _id: 'sid-d', session: { accountId: ACCOUNT, workspaces: [
      { urlKey: URL_KEY, provider: 'linear', accessToken: 'dead-D', tokenExpiresAt: now + 7200_000 },
    ] } }];
    const selected = selectOwnerWorkspaceTokenExcludingSuperseded(onlyD, URL_KEY, ACCOUNT, registry);
    assert.equal(selected.token, 'dead-D', 'the only remaining credential is served, fail-visible, not withheld');
  });

  test('UNSCOPED delegates untouched', () => {
    const registry = createRejectedCredentialRegistry();
    const fpD = fingerprintCredential('dead-D');
    registry.markSuspect(fpD);
    registry.accept(fpD, { supersededBy: 'fp-G', source: 'durable-adopt' });
    const selected = selectOwnerWorkspaceTokenExcludingSuperseded(rows(), URL_KEY, UNSCOPED, registry);
    // The bare selector, owner-blind, still picks the latest-expiry row (D).
    const bare = selectOwnerWorkspaceToken(rows(), URL_KEY, UNSCOPED);
    assert.equal(selected.token, bare.token);
    assert.equal(selected.token, 'dead-D');
  });

  test('an absent or older fake registry degrades to the unchanged selector', () => {
    const selected = selectOwnerWorkspaceTokenExcludingSuperseded(rows(), URL_KEY, ACCOUNT, {});
    assert.equal(selected.token, 'dead-D');
    const noRegistry = selectOwnerWorkspaceTokenExcludingSuperseded(rows(), URL_KEY, ACCOUNT, undefined);
    assert.equal(noRegistry.token, 'dead-D');
  });

  test('the structural copy never mutates the caller\'s rows', () => {
    const registry = createRejectedCredentialRegistry();
    const fpD = fingerprintCredential('dead-D');
    registry.markSuspect(fpD);
    registry.accept(fpD, { supersededBy: 'fp-G', source: 'durable-adopt' });
    const input = rows();
    selectOwnerWorkspaceTokenExcludingSuperseded(input, URL_KEY, ACCOUNT, registry);
    assert.equal(input[0].session.workspaces[0].accessToken, 'dead-D', 'the original row keeps its token');
  });
});

// ---------------------------------------------------------------------------
// P6.1 — reproduction: the dead credential is never re-selected
// ---------------------------------------------------------------------------

describe('P6.1 — reproduction: superseded dead credential is never re-selected after the cache window', () => {
  test('D (dead, latest expiry) is served once, superseded, and never served again', async () => {
    let clock = Date.now();
    const cache = createWorkspaceTokenCache({ ttlMs: 30_000, now: () => clock });
    const registry = createRejectedCredentialRegistry({ now: () => clock });
    const lifecycleEventStore = recordingLifecycleStore();
    const fpD = fingerprintCredential('dead-D');
    const fpG = fingerprintCredential('good-G');
    const durable = { provider: 'linear', token: 'good-G', tokenExpiresAt: clock + 3600_000 };
    const store = { get: async () => durable };
    const persist = async () => {};
    const sessions = [
      { _id: 'sid-d', session: { accountId: ACCOUNT, workspaces: [
        { urlKey: URL_KEY, provider: 'linear', accessToken: 'dead-D', tokenExpiresAt: clock + 7200_000 },
      ] } },
      { _id: 'sid-g', session: { accountId: ACCOUNT, workspaces: [
        { urlKey: URL_KEY, provider: 'linear', accessToken: 'good-G', tokenExpiresAt: clock + 3600_000 },
      ] } },
    ];

    const attempt = ({ fingerprint, provider }) => attemptSuspectCredentialRefresh({
      fingerprint, urlKey: URL_KEY, ownerAccountId: ACCOUNT, provider,
      loadSessions: async () => sessions,
      registry, store, lifecycleEventStore,
      refreshAccessToken: async () => { throw new Error('the exchange must not run'); },
      persistSession: persist,
      resolveProvider: () => ({}),
    });

    // A resolveWorkspaceAccess-shaped flow: cache first, then session scan.
    const serve = async () => {
      const key = workspaceTokenCacheKey(URL_KEY, ACCOUNT);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > clock + 5 * 60 * 1000) {
        const fp = fingerprintCredential(cached.scope ?? cached.token);
        const recovered = await attempt({ fingerprint: fp, provider: cached.provider });
        if (recovered) {
          cache.set(key, { token: recovered.token, expiresAt: recovered.expiresAt, provider: recovered.provider, scope: recovered.scope });
          registry.accept(fp, { supersededBy: recovered.credentialFingerprint, source: recovered.adoptSource });
          return { token: recovered.token, fingerprint: recovered.credentialFingerprint };
        }
        return { token: cached.token, fingerprint: fp };
      }
      const selected = selectOwnerWorkspaceTokenExcludingSuperseded(sessions, URL_KEY, ACCOUNT, registry);
      if (!selected.token) return { token: null, fingerprint: null, reason: selected.reason };
      const fp = fingerprintCredential(selected.scope ?? selected.token);
      const recovered = await attempt({ fingerprint: fp, provider: selected.provider });
      if (recovered) {
        cache.set(key, { token: recovered.token, expiresAt: recovered.expiresAt, provider: recovered.provider, scope: recovered.scope });
        registry.accept(fp, { supersededBy: recovered.credentialFingerprint, source: recovered.adoptSource });
        return { token: recovered.token, fingerprint: recovered.credentialFingerprint };
      }
      cache.set(key, { token: selected.token, expiresAt: selected.expiresAt, provider: selected.provider, scope: selected.scope });
      return { token: selected.token, fingerprint: fp };
    };

    // Request 1: nothing is suspect yet — the latest-expiry dead credential wins.
    const r1 = await serve();
    assert.equal(r1.fingerprint, fpD, 'first resolve selects the latest-expiry dead credential');
    registry.markSuspect(fpD, { reason: 'provider-401', now: clock }); // the provider rejected it

    // Request 2 (still inside the cache window): the cache-hit arm adopts G.
    const r2 = await serve();
    assert.equal(r2.fingerprint, fpG, 'the suspect resolve adopts the differing durable credential');
    assert.equal(registry.isSuperseded(fpD), true, 'the supersession is recorded at the accept() site');

    // Advance past the 30s cache TTL so the next resolve rescans sessions.
    clock += 31_000;

    // Request 3: the dead credential must never come back.
    const r3 = await serve();
    assert.equal(r3.fingerprint, fpG, 'after the cache window the dead credential is never re-selected');
    assert.notEqual(r3.fingerprint, fpD, 'D must never be served again once superseded');
  });
});

// ---------------------------------------------------------------------------
// P2 — write-back + [credential-adopted]
// ---------------------------------------------------------------------------

describe('P2 — adoption writes back and logs [credential-adopted]', () => {
  const now = Date.now();
  const dead = 'dead-3186';
  const good = 'good-3186';

  function sessionsWithConnectionRow() {
    return [
      { _id: 'sid-1', session: { accountId: ACCOUNT, workspaces: [
        { urlKey: URL_KEY, provider: 'linear', accessToken: dead, tokenExpiresAt: now + 7200_000 },
      ] } },
      { _id: 'sid-2', session: { accountId: ACCOUNT, workspaces: [
        { urlKey: URL_KEY, provider: 'linear', accessToken: dead, tokenExpiresAt: now + 7200_000 },
      ] } },
      { _id: 'sid-conn', session: { accountId: ACCOUNT, workspaces: [{
        urlKey: URL_KEY, provider: 'linear', accessToken: 'conn-dead', tokenExpiresAt: now + 7200_000,
        activeBinding: { provider: 'linear', scope: 'org-1' },
        bindings: [{ provider: 'linear', scope: 'org-1', connectionId: `${ACCOUNT}::linear::org-1`, credentials: { token: 'conn-real' } }],
      }] } },
    ];
  }

  const deps = ({ sessions, persistSession, adoptConnectionCredential, ownerHasConnection, refreshConnection }) => ({
    fingerprint: fingerprintCredential(dead),
    urlKey: URL_KEY,
    ownerAccountId: ACCOUNT,
    provider: 'linear',
    loadSessions: async () => sessions,
    registry: (() => { const r = createRejectedCredentialRegistry(); r.markSuspect(fingerprintCredential(dead)); return r; })(),
    store: { get: async () => ({ provider: 'linear', token: good, tokenExpiresAt: now + 3600_000 }) },
    lifecycleEventStore: recordingLifecycleStore(),
    refreshAccessToken: async () => { throw new Error('no exchange'); },
    persistSession,
    resolveProvider: () => ({}),
    ...(adoptConnectionCredential ? { adoptConnectionCredential } : {}),
    ...(ownerHasConnection ? { ownerHasConnection } : {}),
    ...(refreshConnection ? { refreshConnection } : {}),
  });

  test('writes the adopted token into every NON-connection owner row and leaves the connection-backed row untouched', async () => {
    const sessions = sessionsWithConnectionRow();
    const persisted = [];
    const result = await attemptSuspectCredentialRefresh(deps({ sessions, persistSession: async (sid, session) => persisted.push({ sid, token: session.workspaces[0].accessToken }) }));
    assert.equal(result.token, good);
    assert.equal(result.adoptSource, 'durable-adopt');
    assert.deepEqual(persisted, [
      { sid: 'sid-1', token: good },
      { sid: 'sid-2', token: good },
    ], 'the connection-backed row (sid-conn) must not be mirrored');
    assert.equal(sessions[0].session.workspaces[0].accessToken, good);
    assert.equal(sessions[2].session.workspaces[0].accessToken, 'conn-dead', 'connection-backed row untouched');
  });

  test('a persist failure is caught, logged, and the adopted credential is STILL returned', async () => {
    const sessions = sessionsWithConnectionRow();
    const { logs } = await withCapturedConsole(async () => {
      const result = await attemptSuspectCredentialRefresh(deps({ sessions, persistSession: async () => { throw new Error('persist boom'); } }));
      assert.equal(result.token, good, 'strictly non-worsening: the adopted credential is still served');
      assert.equal(result.adoptSource, 'durable-adopt');
    });
    const adopted = logs.filter(args => args[0] === '[credential-adopted]');
    assert.equal(adopted.length, 1);
    const payload = JSON.parse(adopted[0][1]);
    assert.equal(payload.writeBack.ok, false, 'the failed write-back is reported');
  });

  test('connection-adopt arm writes NOTHING into legacy owner rows and reports rows:null', async () => {
    const sessions = [{ _id: 'sid-legacy', session: { accountId: ACCOUNT, workspaces: [
      { urlKey: URL_KEY, provider: 'linear', accessToken: dead, tokenExpiresAt: now + 7200_000 },
    ] } }];
    const persisted = [];
    const connToken = 'conn-new-3186';
    const { logs } = await withCapturedConsole(async () => {
      const result = await attemptSuspectCredentialRefresh(deps({
        sessions,
        persistSession: async (sid, session) => persisted.push({ sid, token: session.workspaces[0].accessToken }),
        adoptConnectionCredential: async () => ({ token: connToken, provider: 'linear', expiresAt: now + 3600_000, credentialFingerprint: fingerprintCredential(connToken) }),
        ownerHasConnection: async () => true,
      }));
      assert.equal(result.token, connToken);
      assert.equal(result.adoptSource, 'connection-adopt');
    });
    assert.deepEqual(persisted, [], 'the Connection credential must NOT be mirrored into legacy session rows (plan rev 2 P2)');
    assert.equal(sessions[0].session.workspaces[0].accessToken, dead, 'the legacy row keeps its original credential');
    const adopted = logs.filter(args => args[0] === '[credential-adopted]');
    assert.equal(adopted.length, 1);
    const payload = JSON.parse(adopted[0][1]);
    assert.equal(payload.source, 'connection-adopt');
    assert.equal(payload.writeBack.rows, null, 'connection-adopt reports rows:null — write-back is not applicable');
  });

  test('exchange arm reports adoptSource:exchange and logs source:exchange (rows:null)', async () => {
    const sessions = [{ _id: 'sid-1', session: { accountId: ACCOUNT, workspaces: [
      { urlKey: URL_KEY, provider: 'linear', accessToken: dead, tokenExpiresAt: now + 7200_000 },
    ] } }];
    const exchangeToken = 'good-exchange-3186';
    const { logs } = await withCapturedConsole(async () => {
      const result = await attemptSuspectCredentialRefresh(deps({
        sessions,
        persistSession: async () => {},
        adoptConnectionCredential: async () => null,
        ownerHasConnection: async () => true,
        refreshConnection: async () => ({ token: exchangeToken, provider: 'linear', expiresAt: now + 3600_000, scope: exchangeToken }),
      }));
      assert.equal(result.token, exchangeToken);
      assert.equal(result.adoptSource, 'exchange');
    });
    const adopted = logs.filter(args => args[0] === '[credential-adopted]');
    assert.equal(adopted.length, 1);
    const payload = JSON.parse(adopted[0][1]);
    assert.equal(payload.source, 'exchange');
    assert.equal(payload.writeBack.rows, null, 'the exchange arm does not mirror again — it writes back inside its own refresh');
  });

  test('[credential-adopted] carries the source and both fingerprints and no token bytes', async () => {
    const sessions = sessionsWithConnectionRow();
    const { logs } = await withCapturedConsole(async () => {
      await attemptSuspectCredentialRefresh(deps({ sessions, persistSession: async () => {} }));
    });
    const adopted = logs.filter(args => args[0] === '[credential-adopted]');
    assert.equal(adopted.length, 1);
    const raw = adopted[0][1];
    const payload = JSON.parse(raw);
    assert.equal(payload.source, 'durable-adopt');
    assert.equal(payload.fromFingerprint, fingerprintCredential(dead));
    assert.equal(payload.toFingerprint, fingerprintCredential(good));
    assert.ok(!raw.includes(dead) && !raw.includes(good), 'no token bytes in the log line');
  });

  test('[credential-rejected] carries rejectionCount and superseded', () => {
    const registry = createRejectedCredentialRegistry();
    const fp = fingerprintCredential(dead);
    registry.markSuspect(fp);
    registry.accept(fp, { supersededBy: fingerprintCredential(good), source: 'durable-adopt' });
    const { logCredentialRejection } = createCredentialTrail({ registry });
    const req = { proxyUrlKey: URL_KEY, proxyCreatedBy: ACCOUNT, resolvedCredentialFingerprint: fp, method: 'GET', proxyTokenId: 't1', proxyTokenLabel: 'l1' };
    let line = null;
    const realWarn = console.warn;
    console.warn = (tag, raw) => { if (tag === '[credential-rejected]') line = raw; };
    try { logCredentialRejection(req, '/issues'); } finally { console.warn = realWarn; }
    const payload = JSON.parse(line);
    assert.equal(payload.rejectionCount, 1, 'count BEFORE this rejection (logEvent calls this before markSuspect)');
    assert.equal(payload.superseded, true);
  });

  test('an older fake registry (no rejectionCount/isSuperseded) degrades to a no-op in the trail, not a throw', () => {
    const { logCredentialRejection } = createCredentialTrail({ registry: { markSuspect() {}, isSuspect: () => false } });
    const req = { proxyUrlKey: URL_KEY, proxyCreatedBy: ACCOUNT, resolvedCredentialFingerprint: 'fp-x', method: 'GET' };
    let line = null;
    const realWarn = console.warn;
    console.warn = (tag, raw) => { if (tag === '[credential-rejected]') line = raw; };
    try { assert.doesNotThrow(() => logCredentialRejection(req, '/issues')); } finally { console.warn = realWarn; }
    const payload = JSON.parse(line);
    assert.equal(payload.rejectionCount, 0);
    assert.equal(payload.superseded, false);
  });
});

// ---------------------------------------------------------------------------
// P4 — classifier: superseded is terminal 401
// ---------------------------------------------------------------------------

function linearAuthError() {
  const err = new Error('You need to authenticate to access this operation.');
  err.response = { status: 401, errors: [{ message: 'nope', extensions: { statusCode: 401 } }] };
  return err;
}

function buildDataRouteApp({ rejectedCredentialRegistry, credentialFingerprint, expiresAt } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 'tok-1', urlKey: URL_KEY, label: 'agent', scope: 'readWrite', createdBy: ACCOUNT }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({
      token: 'linear-tok', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt, credentialFingerprint,
    }),
    getWorkspaceAccessToken: async () => 'linear-tok',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: { name: 'linear', supports: () => true, issueDetail: async () => { throw linearAuthError(); } },
    rejectedCredentialRegistry,
  }));
  return app;
}

async function request(app, path) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { Authorization: 'Bearer agent-token' } });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const ISSUE_UUID = '266f0841-ef9a-40de-a7b4-e18890efbf05';

describe('P4 — a repeat rejection of a superseded fingerprint is terminal (401)', () => {
  test('superseded fingerprint, still believed-live -> 401, not the retryable 503; [credential-rejected] marks superseded:true', async () => {
    const registry = createRejectedCredentialRegistry();
    const fp = fingerprintCredential('linear-tok');
    registry.markSuspect(fp);
    registry.accept(fp, { supersededBy: fingerprintCredential('replacement'), source: 'durable-adopt' });
    const app = buildDataRouteApp({ rejectedCredentialRegistry: registry, credentialFingerprint: fp, expiresAt: Date.now() + 3600_000 });
    // Capture console.warn around the REAL route: the trail line proves
    // routes/proxy.js passed the registry to createCredentialTrail (review
    // mutation I — omitting it leaves the whole suite green without this).
    const { warns } = await withCapturedConsole(async () => {
      const { status } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
      assert.equal(status, 401, 'a known-superseded credential is dead, not a rotation race');
    });
    const line = warns.find(args => args[0] === '[credential-rejected]');
    assert.ok(line, 'the proxy must emit the [credential-rejected] trail line for this 401');
    const payload = JSON.parse(line[1]);
    assert.equal(payload.superseded, true, 'the registry must be wired into createCredentialTrail so the trail marks the fingerprint superseded');
  });

  test('an unsuperseded believed-live credential still says transient (503) on its first rejection — LIN-2216 pins stay green', async () => {
    const registry = createRejectedCredentialRegistry();
    const app = buildDataRouteApp({ rejectedCredentialRegistry: registry, credentialFingerprint: fingerprintCredential('linear-tok'), expiresAt: Date.now() + 3600_000 });
    const { status } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 503);
  });

  test('an older fake registry without isSuperseded degrades to a no-op (still transient, no throw)', async () => {
    const oldStyle = { markSuspect: () => {}, isSuspect: () => false, shouldAttemptRefresh: () => false, accept: () => {} };
    const app = buildDataRouteApp({ rejectedCredentialRegistry: oldStyle, credentialFingerprint: fingerprintCredential('linear-tok'), expiresAt: Date.now() + 3600_000 });
    const { status } = await request(app, `/api/proxy/issues/${ISSUE_UUID}`);
    assert.equal(status, 503);
  });
});

// ---------------------------------------------------------------------------
// P5 — isDanglingReferent logs a swallowed auth error, still fails open
// ---------------------------------------------------------------------------

function authError() {
  const err = new Error('bad credential');
  err.response = { status: 401 };
  return err;
}

describe('P5 — isDanglingReferent auth-swallow logging', () => {
  test('an auth error logs one [dispatch-referent-auth-swallowed] line AND returns false', async () => {
    let warned = 0;
    const { warns } = await withCapturedConsole(async () => {
      const result = await isDanglingReferent({
        provider: { name: 'linear', issueWriteGuard: async () => { throw authError(); } },
        token: 'dead-token',
        issueIdentifier: 'LIN-9999',
      });
      assert.equal(result, false, 'fail-open: an auth failure is never a refusal');
    });
    const line = warns.filter(args => args[0] === '[dispatch-referent-auth-swallowed]');
    assert.equal(line.length, 1);
    assert.equal(line[0][1].provider, 'linear');
    assert.equal(line[0][1].issueIdentifier, 'LIN-9999');
    assert.equal(line[0][1].credentialFingerprint, fingerprintCredential('dead-token'));
    assert.ok(!JSON.stringify(line[0][1]).includes('dead-token'), 'digest only, never token bytes');
  });

  test('a non-auth error returns false with NO auth log', async () => {
    const { warns } = await withCapturedConsole(async () => {
      const result = await isDanglingReferent({
        provider: { name: 'linear', issueWriteGuard: async () => { const e = new Error('boom'); e.response = { status: 500 }; throw e; } },
        token: 'tok',
        issueIdentifier: 'LIN-9999',
      });
      assert.equal(result, false);
    });
    assert.equal(warns.filter(args => args[0] === '[dispatch-referent-auth-swallowed]').length, 0);
  });

  test('a null referent still returns true (unchanged definitive refusal)', async () => {
    const result = await isDanglingReferent({
      provider: { name: 'linear', issueWriteGuard: async () => null },
      token: 'tok',
      issueIdentifier: 'LIN-9999',
    });
    assert.equal(result, true);
  });

  test('a logging failure never escapes — the function still returns false', async () => {
    const result = await isDanglingReferent({
      // `provider.name` is read at the capability check (outside the log
      // try/catch), so the throw is planted in the credential instead: a Proxy
      // that throws when `fingerprintCredential` reads its secret. The inner
      // try/catch must swallow it and still fail open.
      provider: { name: 'linear', issueWriteGuard: async () => { throw authError(); } },
      token: new Proxy({}, { get() { throw new Error('fingerprint boom'); } }),
      issueIdentifier: 'LIN-9999',
    });
    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// P6.7 — the one-call wrapper shape constraint
// ---------------------------------------------------------------------------

describe('P6.7 — lib/superseded-selection.js contains exactly one selectOwnerWorkspaceToken( call', () => {
  test('source-text pin: exactly one call, so off-session-readers stays at 7', () => {
    const src = readFileSync(join(__dirname, '../../lib/superseded-selection.js'), 'utf8');
    const calls = src.match(/selectOwnerWorkspaceToken\(/g) || [];
    assert.equal(calls.length, 1, `expected exactly one selectOwnerWorkspaceToken( call, found ${calls.length}`);
  });
});
