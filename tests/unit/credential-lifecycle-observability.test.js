/**
 * LIN-2236 (Ticket D of the LIN-2231 design) — observability: the durable
 * credential-lifecycle-events store, its wiring into
 * lib/workspace-token-refresh.js's three refresh_skip branches and the
 * refresh_fail/refresh_success/spend_intent kinds, the 503->rejection-trail
 * widening in routes/proxy.js, and L5.4's startup/periodic invariant sweep.
 *
 * Block A: CredentialLifecycleEventStore (behavioural, real Mango collection).
 * Block B: refresh_skip/refresh_fail/refresh_success wiring in
 *          lib/workspace-token-refresh.js (behavioural, fake store+journal).
 * Block C: routes/proxy.js's logEvent/logCredentialRejection widening
 *          (source-grep witness — same convention as
 *          tests/unit/linear-token-isolation.test.js's Block F; no test in
 *          this repo drives routes/proxy.js's real logEvent behaviourally
 *          without booting the whole app).
 * Block D: credential-invariant-sweep (behavioural: pure classifier +
 *          real-store orchestration).
 * Block E: server.js wiring witnesses (source-grep, same convention as
 *          Block C — server.js is not import-safe in a unit test).
 *
 * Run with: node --test tests/unit/credential-lifecycle-observability.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';
import { CredentialLifecycleEventStore, CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { refreshOwnerCredential, refreshOwnerWorkspaceToken, _resetInflightForTests } from '../../lib/workspace-token-refresh.js';
import { resolveWorkspaceIdMapFromSessions, findCredentialInvariantViolations, runCredentialInvariantSweep } from '../../lib/credential-invariant-sweep.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROXY_SRC = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

const NOW = Date.now();
const FAR_FUTURE_MS = 10_000_000;
const PAST_MS = -10_000;

// ---------------------------------------------------------------------------
// Block A — CredentialLifecycleEventStore (behavioural, real Mango)
// ---------------------------------------------------------------------------

describe('CredentialLifecycleEventStore (LIN-2236, Block A — behavioural)', () => {
  let dbClient, dbDir, counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lifecycle-events-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = dbClient.db(`lifecycle_${counter++}`);
    return new CredentialLifecycleEventStore({ collection: db.collection('credential-lifecycle-events') });
  }

  test('records an event with the given kind/detail, stamping `at` and a UUID `_id`', async () => {
    const store = freshStore();
    const doc = await store.recordEvent({ accountId: 'acct-1', urlKey: 'acme', provider: 'linear', kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SUCCESS, detail: { via: 'rotated' } });
    assert.equal(doc.accountId, 'acct-1');
    assert.equal(doc.kind, 'refresh_success');
    assert.deepEqual(doc.detail, { via: 'rotated' });
    assert.ok(doc.at instanceof Date);
    assert.match(doc._id, /^[0-9a-f-]{36}$/);

    const stored = await store.collection.findOne({ _id: doc._id });
    assert.equal(stored.kind, 'refresh_success');
  });

  test('null accountId/urlKey/provider are stored as explicit null, never omitted or coerced', async () => {
    const store = freshStore();
    const doc = await store.recordEvent({ kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SKIP });
    assert.equal(doc.accountId, null);
    assert.equal(doc.urlKey, null);
    assert.equal(doc.provider, null);
    assert.equal(doc.detail, null);
  });

  test('a write failure is caught, logged, and never thrown — the doc is still returned', async () => {
    const store = new CredentialLifecycleEventStore({ collection: { insertOne: async () => { throw new Error('boom'); } } });
    const originalError = console.error;
    let loggedCount = 0;
    console.error = () => { loggedCount++; };
    try {
      const doc = await store.recordEvent({ kind: 'refresh_fail' });
      assert.equal(doc.kind, 'refresh_fail');
    } finally {
      console.error = originalError;
    }
    assert.equal(loggedCount, 1);
  });

  test('the six L5.1 kinds plus the additive INVARIANT_VIOLATION kind are all present', () => {
    assert.deepEqual(Object.values(CREDENTIAL_LIFECYCLE_EVENT_KINDS).sort(), [
      'credential_invariant_violation', 'merge', 'owner_mismatch_503',
      'refresh_fail', 'refresh_skip', 'refresh_success', 'spend_intent',
    ].sort());
  });
});

// ---------------------------------------------------------------------------
// Block B — refresh_skip/refresh_fail/refresh_success wiring (behavioural)
// ---------------------------------------------------------------------------

function fakeJournalStore(seed) {
  let record = seed;
  return {
    async get() { return record; },
    async putIfRefreshToken(accountId, urlKey, expected, next) {
      if (!record || record.refreshToken !== expected) return false;
      record = { ...next, pendingSpend: null };
      return true;
    },
    async markSpendIntent(accountId, urlKey, provider, spentRefreshToken) {
      if (!record) return false;
      record = { ...record, pendingSpend: { refreshToken: spentRefreshToken, attemptedAt: new Date() } };
      return true;
    },
    async clearSpendIntent() {
      if (!record) return false;
      record = { ...record, pendingSpend: null };
      return true;
    },
  };
}

function recordingLifecycleStore() {
  const events = [];
  return { events, async recordEvent(e) { events.push(e); return e; } };
}

describe('refresh_skip/refresh_fail/refresh_success lifecycle-event wiring (LIN-2236, Block B)', () => {
  beforeEach(() => _resetInflightForTests());

  test('refresh_skip (branch: no-durable-record) fires when nothing is refreshable', async () => {
    const lifecycle = recordingLifecycleStore();
    const store = { async get() { return null; } };
    const result = await refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear', refreshAccessToken: async () => { throw new Error('must not be called'); }, store, lifecycleEventStore: lifecycle });
    assert.equal(result, null);
    assert.equal(lifecycle.events.length, 1);
    assert.equal(lifecycle.events[0].kind, 'refresh_skip');
    assert.equal(lifecycle.events[0].detail.branch, 'no-durable-record');
  });

  test('spend_intent fires before the exchange, and refresh_success (via: rotated) fires on a landed CAS write', async () => {
    const lifecycle = recordingLifecycleStore();
    const store = fakeJournalStore({ provider: 'linear', token: 'T0', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS });
    const result = await refreshOwnerCredential({
      ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear',
      refreshAccessToken: async () => ({ access_token: 'T1', refresh_token: 'R1', expires_in: 3600 }),
      store, lifecycleEventStore: lifecycle,
    });
    assert.equal(result.token, 'T1');
    const kinds = lifecycle.events.map(e => e.kind);
    assert.deepEqual(kinds, ['spend_intent', 'refresh_success']);
    assert.equal(lifecycle.events[1].detail.via, 'rotated');
  });

  test('refresh_fail fires (with the error code as detail.reason) when the exchange itself fails', async () => {
    const lifecycle = recordingLifecycleStore();
    const store = fakeJournalStore({ provider: 'linear', token: 'T0', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS });
    await assert.rejects(() => refreshOwnerCredential({
      ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear',
      refreshAccessToken: async () => { const { TokenRefreshError } = await import('../../lib/token-refresh.js'); throw new TokenRefreshError('boom', 'NETWORK'); },
      store, lifecycleEventStore: lifecycle,
    }));
    const kinds = lifecycle.events.map(e => e.kind);
    assert.deepEqual(kinds, ['spend_intent', 'refresh_fail']);
    assert.equal(lifecycle.events[1].detail.reason, 'NETWORK');
  });

  test('refresh_skip (branch: frozen-expiry-non-live) fires on doRefresh\'s headless boundary check, not inside the shared core', async () => {
    const lifecycle = recordingLifecycleStore();
    const store = fakeJournalStore({ provider: 'linear', token: 'SAME', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS });
    const sessions = [{ _id: 'sid-1', session: { accountId: 'acct-1', workspaces: [{ urlKey: 'acme', provider: 'linear', tokenExpiresAt: NOW + PAST_MS }] } }];
    const result = await refreshOwnerWorkspaceToken({
      sessions, urlKey: 'acme', ownerAccountId: 'acct-1',
      refreshAccessToken: async () => ({ access_token: 'SAME', refresh_token: 'R1', expires_in: -100 }), // byte-identical bytes -> LIN-2097 freeze -> already-past
      persistSession: async () => {},
      store, lifecycleEventStore: lifecycle,
    });
    assert.equal(result, null, 'a frozen, already-past expiry is non-live for the headless caller');
    const skipEvents = lifecycle.events.filter(e => e.kind === 'refresh_skip');
    assert.ok(skipEvents.some(e => e.detail.branch === 'frozen-expiry-non-live'));
  });

  test('lifecycleEventStore is fully optional — omitting it changes nothing about the refresh outcome', async () => {
    const store = fakeJournalStore({ provider: 'linear', token: 'T0', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS });
    const result = await refreshOwnerCredential({
      ownerAccountId: 'acct-1', urlKey: 'acme', provider: 'linear',
      refreshAccessToken: async () => ({ access_token: 'T1', refresh_token: 'R1', expires_in: 3600 }),
      store, // no lifecycleEventStore
    });
    assert.equal(result.token, 'T1');
  });
});

// ---------------------------------------------------------------------------
// Block C — routes/proxy.js's logEvent/logCredentialRejection (witness)
// ---------------------------------------------------------------------------

describe('logEvent/logCredentialRejection widening (LIN-2236, L5.2 — witness, source-grep)', () => {
  test('logEvent treats 401 and 503 identically — both reach logCredentialRejection and markSuspect', () => {
    const start = PROXY_SRC.indexOf('function logEvent(req, endpoint, status, note = null, { skipWitness = false } = {}) {');
    assert.ok(start >= 0);
    const end = PROXY_SRC.indexOf('\n  }', start);
    const body = PROXY_SRC.slice(start, end);
    assert.match(body, /if \(status === 401 \|\| status === 503\)/);
    assert.match(body, /logCredentialRejection\(req, endpoint\)/);
    assert.match(body, /rejectedCredentialRegistry\?\.markSuspect\(/);
  });

  test('logCredentialRejection records credentialSource: \'none\' when no descriptor was ever resolved, rather than silently omitting the field', () => {
    const start = PROXY_SRC.indexOf('function logCredentialRejection(req, endpoint) {');
    assert.ok(start >= 0);
    const end = PROXY_SRC.indexOf('\n  }', start);
    const body = PROXY_SRC.slice(start, end);
    assert.match(body, /\.\.\.\(descriptor \?\? \{ credentialSource: 'none' \}\)/);
  });
});

// ---------------------------------------------------------------------------
// Block D — credential-invariant-sweep (behavioural)
// ---------------------------------------------------------------------------

function sessionRowFor(id, urlKey, provider = 'linear') {
  return { session: { workspaces: [{ id, urlKey, provider }] } };
}

describe('resolveWorkspaceIdMapFromSessions (LIN-2236, Block D — pure)', () => {
  test('maps workspace.id -> {urlKey, provider} from live sessions, first-seen wins, malformed rows skipped', () => {
    const sessions = [
      sessionRowFor('org-1', 'acme', 'linear'),
      { session: 'not valid json{{{' },
      sessionRowFor('org-1', 'acme-stale-dupe', 'linear'), // same id, later row — first-seen wins
    ];
    const map = resolveWorkspaceIdMapFromSessions(sessions);
    assert.deepEqual(map.get('org-1'), { urlKey: 'acme', provider: 'linear' });
    assert.equal(map.size, 1);
  });
});

describe('findCredentialInvariantViolations (LIN-2236, Block D — pure)', () => {
  test('an edge whose canonical account has a live durable credential is OK, not a violation', () => {
    const edges = [{ accountId: 'a1', workspaceId: 'org-1' }];
    const canon = new Map([['a1', 'a1']]);
    const wsMap = new Map([['org-1', { urlKey: 'acme', provider: 'linear' }]]);
    const lookup = () => ({ tokenExpiresAt: NOW + FAR_FUTURE_MS });
    const result = findCredentialInvariantViolations(edges, canon, wsMap, lookup, NOW);
    assert.deepEqual(result.violations, []);
    assert.equal(result.checked, 1);
  });

  test('a missing durable record is a violation with reason "missing"', () => {
    const edges = [{ accountId: 'a1', workspaceId: 'org-1' }];
    const canon = new Map([['a1', 'a1']]);
    const wsMap = new Map([['org-1', { urlKey: 'acme', provider: 'linear' }]]);
    const result = findCredentialInvariantViolations(edges, canon, wsMap, () => null, NOW);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].reason, 'missing');
  });

  test('an expired durable record is a violation with reason "expired"', () => {
    const edges = [{ accountId: 'a1', workspaceId: 'org-1' }];
    const canon = new Map([['a1', 'a1']]);
    const wsMap = new Map([['org-1', { urlKey: 'acme', provider: 'linear' }]]);
    const result = findCredentialInvariantViolations(edges, canon, wsMap, () => ({ tokenExpiresAt: NOW + PAST_MS }), NOW);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].reason, 'expired');
  });

  test('an edge with no matching live session is SKIPPED, not reported as a violation (the documented id/urlKey mapping gap)', () => {
    const edges = [{ accountId: 'a1', workspaceId: 'org-unknown' }];
    const canon = new Map([['a1', 'a1']]);
    const result = findCredentialInvariantViolations(edges, canon, new Map(), () => null, NOW);
    assert.deepEqual(result.violations, []);
    assert.equal(result.skipped, 1);
    assert.equal(result.checked, 0);
  });

  test('a MERGED account\'s edge is checked against its CANONICAL account\'s credential, not the merged id\'s own', () => {
    const edges = [{ accountId: 'merged-id', workspaceId: 'org-1' }];
    const canon = new Map([['merged-id', 'canonical-id']]);
    const wsMap = new Map([['org-1', { urlKey: 'acme', provider: 'linear' }]]);
    let lookedUpWith = null;
    const lookup = (accountId) => { lookedUpWith = accountId; return { tokenExpiresAt: NOW + FAR_FUTURE_MS }; };
    findCredentialInvariantViolations(edges, canon, wsMap, lookup, NOW);
    assert.equal(lookedUpWith, 'canonical-id');
  });
});

describe('runCredentialInvariantSweep (LIN-2236, Block D — orchestration, real Mango stores)', () => {
  let dbClient, dbDir, counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'invariant-sweep-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStores() {
    const db = dbClient.db(`sweep_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
      lifecycleEventStore: new CredentialLifecycleEventStore({ collection: db.collection('credential-lifecycle-events') }),
    };
  }

  test('a live edge with a healthy durable credential produces no violation, no durable log entry', async () => {
    const stores = freshStores();
    const account = await stores.accountStore.createAccount();
    await stores.accountWorkspaceStore.bindAccountToWorkspace(account._id, 'org-1');
    await stores.ownerCredentialStore.put(account._id, 'acme', { provider: 'linear', token: 't', refreshToken: 'r', tokenExpiresAt: NOW + FAR_FUTURE_MS });
    const sessionsCollection = { find: () => ({ toArray: async () => [sessionRowFor('org-1', 'acme', 'linear')] }) };

    const result = await runCredentialInvariantSweep({ ...stores, sessionsCollection, now: NOW });
    assert.deepEqual(result.violations, []);
    const logged = await stores.lifecycleEventStore.collection.find({}).toArray();
    assert.equal(logged.length, 0);
  });

  test('a live edge with NO durable credential produces a violation, durably logged as credential_invariant_violation', async () => {
    const stores = freshStores();
    const account = await stores.accountStore.createAccount();
    await stores.accountWorkspaceStore.bindAccountToWorkspace(account._id, 'org-1');
    const sessionsCollection = { find: () => ({ toArray: async () => [sessionRowFor('org-1', 'acme', 'linear')] }) };

    const result = await runCredentialInvariantSweep({ ...stores, sessionsCollection, now: NOW });
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].reason, 'missing');
    const logged = await stores.lifecycleEventStore.collection.find({}).toArray();
    assert.equal(logged.length, 1);
    assert.equal(logged[0].kind, 'credential_invariant_violation');
    assert.equal(logged[0].urlKey, 'acme');
  });

  test('an edge on a MERGED account resolves through the canonical account\'s own credential — a merge is never itself a violation', async () => {
    const stores = freshStores();
    const canonical = await stores.accountStore.createAccount();
    const merged = await stores.accountStore.createAccount();
    await stores.accountStore.mergeAccounts(canonical._id, merged._id);
    // The edge is still recorded on the MERGED account id (mergeAccounts rebinds
    // accountWorkspaceStore edges onto canonical, so bind there to model the
    // post-merge state realistically).
    await stores.accountWorkspaceStore.bindAccountToWorkspace(canonical._id, 'org-1');
    await stores.ownerCredentialStore.put(canonical._id, 'acme', { provider: 'linear', token: 't', refreshToken: 'r', tokenExpiresAt: NOW + FAR_FUTURE_MS });
    const sessionsCollection = { find: () => ({ toArray: async () => [sessionRowFor('org-1', 'acme', 'linear')] }) };

    const result = await runCredentialInvariantSweep({ ...stores, sessionsCollection, now: NOW });
    assert.deepEqual(result.violations, []);
  });

  test('throws loudly when now is not provided (same discipline as observer-sweep)', async () => {
    const stores = freshStores();
    const sessionsCollection = { find: () => ({ toArray: async () => [] }) };
    await assert.rejects(() => runCredentialInvariantSweep({ ...stores, sessionsCollection, now: undefined }), /now \(epoch ms\) is required/);
  });
});

// ---------------------------------------------------------------------------
// Block E — server.js wiring witnesses (source-grep)
// ---------------------------------------------------------------------------

describe('server.js credential-lifecycle wiring (LIN-2236, Block E — witness, source-grep)', () => {
  test('the two human refresh entrants and the headless refresh-on-resolve call site all thread lifecycleEventStore/credentialLifecycleEventStore through', () => {
    const occurrences = SERVER_SRC.split('lifecycleEventStore:').length - 1;
    assert.ok(occurrences >= 3, `expected at least 3 call sites threading lifecycleEventStore, found ${occurrences}`);
  });

  test('the refresh-on-resolve cooldown-gate SKIP branch (the else of refreshOnResolveGate.shouldAttempt) records a refresh_skip event', () => {
    // Anchored inside resolveWorkspaceAccess specifically (LIN-2110 added a
    // SECOND refreshOnResolveGate.shouldAttempt( call site, in
    // ensureValidToken, which sorts EARLIER in the file — a bare indexOf
    // would silently start matching the wrong site's window instead of
    // failing loud).
    const fnIdx = SERVER_SRC.indexOf('async function resolveWorkspaceAccess(');
    assert.ok(fnIdx >= 0);
    const gateIdx = SERVER_SRC.indexOf('refreshOnResolveGate.shouldAttempt(', fnIdx);
    assert.ok(gateIdx >= 0);
    const window = SERVER_SRC.slice(gateIdx, gateIdx + 2000);
    assert.match(window, /\} else \{/);
    assert.match(window, /CREDENTIAL_LIFECYCLE_EVENT_KINDS\.REFRESH_SKIP/);
    assert.match(window, /branch: 'cooldown-gate'/);
  });

  test('LIN-2110: ensureValidToken\'s OWN refreshOnResolveGate.shouldAttempt( call site (the proactive human-lane arm) also records a refresh_skip event on suppression', () => {
    const fnIdx = SERVER_SRC.indexOf('async function ensureValidToken(');
    assert.ok(fnIdx >= 0);
    const gateIdx = SERVER_SRC.indexOf('refreshOnResolveGate.shouldAttempt(', fnIdx);
    assert.ok(gateIdx >= 0);
    const window = SERVER_SRC.slice(gateIdx, gateIdx + 2000);
    assert.match(window, /CREDENTIAL_LIFECYCLE_EVENT_KINDS\.REFRESH_SKIP/);
    assert.match(window, /branch: 'ensure-valid-token-cooldown-gate'/);
    assert.match(window, /return next\(\)/);
  });

  test('an owner_mismatch classification durably records an owner_mismatch_503 event carrying the same diagnostic the console.warn line already computes', () => {
    const warnIdx = SERVER_SRC.indexOf('console.warn(`[workspace-access] resolution failed`');
    assert.ok(warnIdx >= 0);
    const window = SERVER_SRC.slice(warnIdx, warnIdx + 800);
    assert.match(window, /reason === 'owner_mismatch'/);
    assert.match(window, /CREDENTIAL_LIFECYCLE_EVENT_KINDS\.OWNER_MISMATCH_503/);
    assert.match(window, /detail: diag/);
  });

  test('the credential-invariant sweep is registered with the scheduler, name "credential-invariant-sweep"', () => {
    assert.match(SERVER_SRC, /name: 'credential-invariant-sweep'/);
    assert.match(SERVER_SRC, /createCredentialInvariantSweepRun\(/);
  });
});

// ---------------------------------------------------------------------------
// Block F — deflecting-comment removal (LIN-2236, L5.5 — witness)
// ---------------------------------------------------------------------------

describe('deflecting-comment removal (LIN-2236, L5.5)', () => {
  test('server.js\'s owner_mismatch docstring no longer instructs readers not to assert the fork', () => {
    assert.ok(!SERVER_SRC.includes('do not claim it can'));
    assert.match(SERVER_SRC, /LIN-2231 built the same-human identity concept/);
  });

  test('lib/workspace-token-resolver.js\'s detectOwnerAccountMismatch docstring no longer claims the concept is deliberately unbuilt', async () => {
    const resolverSrc = readFileSync(join(__dirname, '../../lib/workspace-token-resolver.js'), 'utf8');
    assert.ok(!resolverSrc.includes('this ticket deliberately does not build'));
    assert.match(resolverSrc, /LIN-2231 built the same-human identity concept/);
  });
});
