/**
 * LIN-3323 acceptance witness — a workspace owner whose login is resolved
 * through a Connection is a VALID login, so a share read must not report it as
 * a failure.
 *
 * The bug: `connectionResolveResult` (lib/connection-access.js) built the
 * Connection route's success answer without `reason: 'ok'`. `resolveWorkspaceAccess`
 * returned that object verbatim, and `createReadOwnerIssues` (the share reader)
 * gates on `outcome.reason === 'ok'` — so the owner's first issue-list share
 * create read as `refresh_error` (`SHARE_SNAPSHOT_UNAVAILABLE`) until a repeat
 * read inside the 30s token cache returned a cached answer that DID carry the
 * reason. Every caller that gates on the reason (issue-list share create and
 * refresh) failed on the first try.
 *
 * This drives the REAL `resolveWorkspaceAccess` body (server.js) + the REAL
 * `createConnectionAccess` arm over real in-process (`@jkershaw/mangodb`) stores,
 * with only the provider's issue read stubbed, and asserts the first read (empty
 * cache — never a cache hit, per the ticket's "avoid test assumptions that only
 * pass via cache") reaches the share and renders as success.
 *
 * It is deliberately NOT built on the run-share feature (LIN-2950, being removed
 * next): the issue-list (collection) share path is the target.
 *
 * Run with: node --test tests/unit/lin-3323-connection-owner-login.test.js
 */
process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import express from 'express';
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
import { createReadOwnerIssues } from '../../lib/share-owner-reader.js';
import { createShareRoutes } from '../../routes/share.js';

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
const CONNECTION_ID = `${ACCT}::linear::${SCOPE}`;
const OWNER_OK = async () => ({ status: 'owner' });
const NOOP_TIMEOUT = (promise) => promise;
const NOOP_LIMITER = (req, res, next) => next();

/** The issues the provider serves — the content a guest must see. */
const ISSUES = [
  { id: 'i-1', identifier: 'LIN-1', title: 'Current content', state: { type: 'started' }, updatedAt: '2026-10-06T00:00:00Z', labels: [{ id: 'l-1', name: 'bug' }] },
];

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

/** A tiny in-memory share store (mirrors tests/unit/share-owner-routes.test.js). */
function makeStore() {
  const byToken = new Map();
  const byId = new Map();
  let seq = 0;
  return {
    async create({ urlKey, workspaceId, ownerAccountId, subject, includeDescriptions = false }) {
      seq += 1;
      const token = 'A'.repeat(42) + String.fromCharCode(64 + seq);
      const tokenHash = `id-${String(seq).padStart(4, '0')}`;
      const record = {
        _id: tokenHash, tokenHash, urlKey, workspaceId, ownerAccountId,
        subject: { type: subject.type || 'collection', kind: subject.kind, id: subject.id },
        includeDescriptions: includeDescriptions === true,
        createdAt: new Date(), revokedAt: null, snapshot: null, snapshotAt: null, lastRefreshAttemptAt: null,
      };
      byToken.set(token, record);
      byId.set(tokenHash, record);
      return { token, record: { ...record } };
    },
    async saveSnapshot(tokenHash, snapshot, { at = new Date() } = {}) {
      const record = byId.get(tokenHash);
      if (!record) return false;
      record.lastRefreshAttemptAt = at;
      if (snapshot != null) { record.snapshot = snapshot; record.snapshotAt = at; }
      return true;
    },
    async getByToken(token) {
      const record = byToken.get(token);
      return record ? { ...record } : null;
    },
  };
}

function buildShareApp({ store, readOwnerIssues }) {
  const app = express();
  app.use(express.json());
  const workspaceFromUrl = (req, res, next) => {
    req.workspace = { id: `uuid-${req.params.urlKey}`, urlKey: req.params.urlKey };
    req.session = { accountId: ACCT };
    next();
  };
  app.use(createShareRoutes({
    shareStore: store,
    readOwnerIssues,
    workspaceOwnerCheck: OWNER_OK,
    workspaceFromUrl,
    getProviderForWorkspace: () => ({ ui: { subtasks: true }, fetchProjects: async () => ({ issues: ISSUES }) }),
    withTimeout: NOOP_TIMEOUT,
    readLimiter: NOOP_LIMITER,
    createLimiter: NOOP_LIMITER,
  }));
  return app;
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* html */ }
    return { status: res.status, text, json, headers: res.headers };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-3323 — a Connection-resolved owner login is valid on the first share read', () => {
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

  test('readOwnerIssues on the FIRST read (empty cache) returns reason "ok" with the issues', async () => {
    const w = await world(client);
    const cache = createWorkspaceTokenCache();
    const resolveWorkspaceAccess = makeResolver(w, cache);
    const readOwnerIssues = createReadOwnerIssues({
      resolveWorkspaceAccess,
      getProviderForWorkspace: () => ({ fetchProjects: async () => ({ issues: ISSUES }) }),
      getTestMockData: () => ({ issues: [] }),
    });

    const result = await readOwnerIssues(URL_KEY, ACCT);

    assert.notEqual(result.reason, 'refresh_error', 'a valid login must not read as a refresh failure');
    assert.equal(result.reason, 'ok');
    assert.deepEqual(result.issues, ISSUES);
  });

  test('a genuine login failure keeps its own reason (never stamped ok)', async () => {
    const w = await failureWorld(client);
    const resolveWorkspaceAccess = makeResolver(w, createWorkspaceTokenCache());

    const out = await resolveWorkspaceAccess(URL_KEY, ACCT);
    assert.equal(out.token, null, 'an expired login resolves no token');
    assert.equal(out.reason, 'session_expired', 'the real failure reason survives the success constructor');

    const readOwnerIssues = createReadOwnerIssues({
      resolveWorkspaceAccess,
      getProviderForWorkspace: () => ({ fetchProjects: async () => ({ issues: ISSUES }) }),
      getTestMockData: () => ({ issues: [] }),
    });
    const result = await readOwnerIssues(URL_KEY, ACCT);
    assert.deepEqual(result, { reason: 'session_expired', issues: null }, 'the share reader reports the failure, not a fabricated success');
  });

  test('the owner creates an issue-list share on the first try, and a signed-out guest opens it', async () => {
    const w = await world(client);
    const resolveWorkspaceAccess = makeResolver(w, createWorkspaceTokenCache());
    const readOwnerIssues = createReadOwnerIssues({
      resolveWorkspaceAccess,
      getProviderForWorkspace: () => ({ fetchProjects: async () => ({ issues: ISSUES }) }),
      getTestMockData: () => ({ issues: [] }),
    });
    const store = makeStore();
    const app = buildShareApp({ store, readOwnerIssues });

    const created = await request(app, `/workspace/${URL_KEY}/shares`, {
      method: 'POST',
      body: { subject: { kind: 'label', id: 'bug' } },
    });
    assert.equal(created.status, 201, `expected a created share, got ${created.status} ${created.text}`);
    assert.ok(created.json?.token, 'a share token is minted');

    // Signed-out guest: no cookie/session is sent.
    const guest = await request(app, `/s/${created.json.token}`);
    assert.equal(guest.status, 200, 'the guest opens the share on the first try');
    assert.match(guest.text, /Current content/, 'the guest sees current content, not an "as of" copy');
  });
});
