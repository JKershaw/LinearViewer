/**
 * LIN-3323 acceptance witness — a workspace owner whose login is resolved
 * through a Connection is a VALID login.
 *
 * The bug: `connectionResolveResult` (lib/connection-access.js) built the
 * Connection route's success answer without `reason: 'ok'`. `resolveWorkspaceAccess`
 * returned that object verbatim, so a caller gating on `outcome.reason === 'ok'`
 * read the owner's valid login as `refresh_error` until a repeat read inside the
 * 30s token cache returned a cached answer that DID carry the reason.
 *
 * This drives the REAL `resolveWorkspaceAccess` body (server.js) + the REAL
 * `createConnectionAccess` arm over real in-process (`@jkershaw/mangodb`)
 * credential stores, with only the provider's issue read stubbed, and asserts
 * the first read (empty cache — never a cache hit, per the ticket's "avoid test
 * assumptions that only pass via cache") carries `reason: 'ok'`.
 *
 * Resolver-level only: the reader/route/guest coverage that once lived here
 * exercised the share feature, which LIN-3325 removed.
 *
 * Run with: node --test tests/unit/lin-3323-connection-owner-login.test.js
 */
process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { convertToConnectionBacked, createConnectionAccess } from '../../lib/connection-credential.js';
import { linkProvider, normalizeProvider } from '../../lib/workspace.js';
import {
  UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken,
  selectOwnerSessionRow, classifyWorkspaceFailure, describeWorkspaceResolution,
} from '../../lib/workspace-token-resolver.js';
import { CREDENTIAL_SOURCES, fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';
import { workspaceTokenCacheKey, workspaceTokenCacheBypasses, createWorkspaceTokenCache } from '../../lib/workspace-token-cache.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';
import { selectOwnerWorkspaceTokenExcludingSuperseded } from '../../lib/superseded-selection.js';

const SERVER_SRC = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
function sliceServerFunction(name) {
  const asyncStart = SERVER_SRC.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : SERVER_SRC.indexOf(`\nfunction ${name}(`) + 1;
  assert.ok(start > 0, `${name} not found`);
  return SERVER_SRC.slice(start, SERVER_SRC.indexOf('\n}', start) + 2);
}

const ACCT = 'acct-3323';
const URL_KEY = 'acme';
const SCOPE = 'org-3323';
const CONNECTION_TOKEN = 'lin_connection_live_3323';
const SESSION_TOKEN = 'lin_session_live_3323';
const CONNECTION_ID = `${ACCT}::linear::${SCOPE}`;

/** A fresh in-process world with ONE live Connection-backed Linear workspace. */
async function world(client) {
  const db = client.db(`l3323_${Math.random().toString(36).slice(2)}`);
  const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
  const ownerCredentialStore = new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
  const live = Date.now() + 3_600_000;
  const session = { accountId: ACCT, workspaces: [{ id: 'ws-1', urlKey: URL_KEY, bindings: [] }] };
  linkProvider(session.workspaces[0], 'linear', SCOPE, { token: CONNECTION_TOKEN, tokenExpiresAt: live });
  const out = await convertToConnectionBacked({
    connectionStore, ownerCredentialStore, session, accountId: ACCT, workspaceId: 'ws-1',
    provider: 'linear', scope: SCOPE, credentials: { token: CONNECTION_TOKEN, tokenExpiresAt: live },
    refreshToken: 'R1', prior: 'none', writesEnabled: true,
  });
  assert.equal(out.connectionBacked, true, 'precondition: the binding is Connection-backed');
  await ownerCredentialStore.putByConnection(CONNECTION_ID, {
    accountId: ACCT, provider: 'linear', scope: SCOPE, token: CONNECTION_TOKEN, refreshToken: 'R2', tokenExpiresAt: live,
  });
  const rows = [{ _id: 'sid-conn', session: structuredClone(session) }];
  return { connectionStore, ownerCredentialStore, rows };
}

/** A world whose only owner session row is EXPIRED (no Connection) — a real login failure. */
async function failureWorld(client) {
  const db = client.db(`l3323f_${Math.random().toString(36).slice(2)}`);
  const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
  const ownerCredentialStore = new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
  const expired = { id: 'ws-1', urlKey: URL_KEY, provider: 'linear', accessToken: 'lin_expired', tokenExpiresAt: Date.now() - 60_000, bindings: [] };
  const rows = [{ _id: 'sid-expired', session: { accountId: ACCT, workspaces: [expired] } }];
  return { connectionStore, ownerCredentialStore, rows };
}

/** A world whose only owner session row is LIVE and NOT Connection-backed — the session-scan route. */
async function sessionWorld(client) {
  const db = client.db(`l3323s_${Math.random().toString(36).slice(2)}`);
  const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
  const ownerCredentialStore = new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
  const live = { id: 'ws-1', urlKey: URL_KEY, provider: 'linear', accessToken: SESSION_TOKEN, tokenExpiresAt: Date.now() + 3_600_000, bindings: [] };
  const rows = [{ _id: 'sid-live', session: { accountId: ACCT, workspaces: [live] } }];
  return { connectionStore, ownerCredentialStore, rows };
}

/** Execute the REAL resolveWorkspaceAccess body with injected collaborators. */
function makeResolver(w, cache) {
  const registry = createRejectedCredentialRegistry();
  const connectionAccess = createConnectionAccess({
    connectionStore: w.connectionStore, ownerCredentialStore: w.ownerCredentialStore,
    refreshConnection: async () => null, selectOwnerSessionRow, normalizeProvider, fingerprintCredential,
    gate: { shouldAttempt: () => false }, bufferMs: TOKEN_REFRESH_BUFFER_MS,
  });
  const lifecycle = { recordEvent: async () => {} };
  const context = vm.createContext({
    UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution,
    CREDENTIAL_SOURCES, fingerprintCredential, CREDENTIAL_LIFECYCLE_EVENT_KINDS, workspaceTokenCacheKey, workspaceTokenCacheBypasses,
    selectOwnerWorkspaceTokenExcludingSuperseded, rejectedCredentialRegistry: registry,
    accountStore: { resolveCanonicalAccountId: async (id) => id },
    sessionsCollection: { find: () => ({ toArray: async () => w.rows }) },
    workspaceTokenCache: cache, ownerCredentialStore: { get: async () => null },
    refreshOnResolveGate: { shouldAttempt: () => false }, credentialLifecycleEventStore: lifecycle,
    attemptSuspectCredentialRefresh: async () => null, connectionAccess, Date,
    console: { log() {}, warn() {}, error() {} }, process: { env: { NODE_ENV: 'prod' } },
  });
  return vm.runInContext(`${sliceServerFunction('resolveWorkspaceAccess')}\nresolveWorkspaceAccess`, context);
}

describe('LIN-3323 — a Connection-resolved owner login is valid on the first read', () => {
  let dir, client;
  before(async () => { dir = mkdtempSync(join(tmpdir(), 'lin3323-')); client = new MangoClient(dir); await client.connect(); });
  after(async () => { await client?.close?.(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  test('the Connection arm result carries reason "ok" (the shared success constructor)', async () => {
    const w = await world(client);
    const fn = makeResolver(w, createWorkspaceTokenCache());
    const out = await fn(URL_KEY, ACCT);
    assert.equal(out.token, CONNECTION_TOKEN, 'the live Connection credential resolves');
    assert.equal(out.reason, 'ok', 'a valid owner login resolved through a Connection reads as valid');
  });

  test('a NON-Connection session-scan success also carries reason "ok" (pins the shared grant)', async () => {
    // The Connection arm stamps `ok` on its own, so the first test would still
    // pass if the resolver's shared `grant` constructor were a no-op. This drives
    // a second success route — a live, non-Connection session row — so a broken
    // `grant` is caught here rather than only incidentally elsewhere.
    const w = await sessionWorld(client);
    const fn = makeResolver(w, createWorkspaceTokenCache());
    const out = await fn(URL_KEY, ACCT);
    assert.equal(out.token, SESSION_TOKEN, 'the live session credential resolves');
    assert.equal(out.reason, 'ok', 'the session-scan success route also reads as a valid login');
  });

  test('a genuine login failure keeps its own reason (never stamped ok)', async () => {
    const w = await failureWorld(client);
    const resolveWorkspaceAccess = makeResolver(w, createWorkspaceTokenCache());

    const out = await resolveWorkspaceAccess(URL_KEY, ACCT);
    assert.equal(out.token, null, 'an expired login resolves no token');
    assert.equal(out.reason, 'session_expired', 'the real failure reason survives the success constructor');
  });
});
