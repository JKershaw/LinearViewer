/**
 * Integration-style witness for LIN-1373's refresh-on-resolve fix.
 *
 * Every other spec in workspace-token-refresh.test.js drives
 * `refreshOwnerWorkspaceToken` with a FAKE `refreshAccessToken` function — a
 * green run there proves the orchestration (selection, persistence, single-
 * flight) but proves nothing about the real Linear OAuth exchange, because
 * the fetch/JSON/rotation code in lib/token-refresh.js is never actually
 * executed. This file closes that gap: it drives the REAL `refreshAccessToken`
 * (lib/token-refresh.js, unstubbed) against a local, controllable token
 * endpoint via its new `tokenUrl` seam (LIN-1373), composed with the real
 * `refreshOwnerWorkspaceToken` + `selectExpiredOwnerRow` +
 * `selectOwnerWorkspaceToken` + `updateWorkspaceTokens`, over a Mongo-shaped
 * in-memory sessions collection using the exact TTL-preserving persist-back
 * server.js's `resolveWorkspaceAccess` uses (`updateOne({_id:sid},
 * {$set:{session}})` — never `MongoSessionStore.set`, which would roll
 * `expires`).
 *
 * `resolveWorkspaceAccess` itself (server.js) is thin glue over these pieces
 * and is not re-imported here — server.js connects to a real database and
 * starts listening at module load, so it is not import-safe in a unit test
 * (the same reason tests/unit/linear-token-isolation.test.js's Block B tests
 * route wiring against a hand-rolled resolver rather than the real one). This
 * file instead proves every piece resolveWorkspaceAccess's session_expired
 * branch calls is real end-to-end; server.js's own few lines of glue are
 * covered by code review + the unchanged existing 11/11
 * linear-token-isolation suite.
 *
 * Run with: node --test tests/unit/workspace-token-refresh-integration.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { selectOwnerWorkspaceToken } from '../../lib/workspace-token-resolver.js';
import { refreshOwnerWorkspaceToken, _resetInflightForTests } from '../../lib/workspace-token-refresh.js';
import { refreshAccessToken, TokenRefreshError } from '../../lib/token-refresh.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';

// A minimal Mongo-shaped in-memory sessions collection, matching the real
// shape sessionsCollection.find({}).toArray() yields (each row: { _id, session,
// expires }) and the exact updateOne call server.js's persistSessionRow makes.
function inMemorySessionsCollection(seedDocs) {
  const docs = seedDocs.map(d => ({ ...d }));
  return {
    async find() { return { async toArray() { return docs.map(d => ({ ...d })); } }; },
    async updateOne(query, update) {
      const doc = docs.find(d => d._id === query._id);
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    _raw() { return docs; },
  };
}

// The TTL-preserving persist-back server.js's resolveWorkspaceAccess uses
// (deliberately not MongoSessionStore.set, which always rewrites `expires`).
function makePersistSessionRow(collection) {
  return (sid, session) => collection.updateOne({ _id: sid }, { $set: { session } });
}

let tokenServer;
let tokenUrl;
let tokenServerBehavior;

beforeEach(async () => {
  _resetInflightForTests();
  process.env.LINEAR_CLIENT_ID = 'test-client-id';
  process.env.LINEAR_CLIENT_SECRET = 'test-client-secret';

  tokenServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => tokenServerBehavior(req, res, body));
  });
  await new Promise(resolve => tokenServer.listen(0, resolve));
  const { port } = tokenServer.address();
  tokenUrl = `http://127.0.0.1:${port}/oauth/token`;
});

afterEach(async () => {
  await new Promise(resolve => tokenServer.close(resolve));
});

describe('LIN-1373 real-refresh integration witness (unstubbed refreshAccessToken)', () => {
  test('I1: expired owner row + valid refreshToken -> real HTTP round-trip refreshes, rotates, persists to the correct session row, and a re-select returns ok', async () => {
    tokenServerBehavior = (req, res, body) => {
      assert.equal(req.method, 'POST');
      assert.ok(body.includes('grant_type=refresh_token'));
      assert.ok(body.includes('refresh_token=real-refresh-token'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        scope: 'read write',
      }));
    };

    const originalExpires = new Date(Date.now() + 30 * 86400 * 1000);
    const collection = inMemorySessionsCollection([
      {
        _id: 'sid-real-1',
        expires: originalExpires,
        session: {
          accountId: 'account-real',
          workspaces: [{
            urlKey: 'acme-real',
            provider: 'linear',
            accessToken: 'stale-access-token',
            refreshToken: 'real-refresh-token',
            tokenExpiresAt: Date.now() - 10_000, // already expired
          }],
        },
      },
    ]);
    const persistSession = makePersistSessionRow(collection);

    // Pre-condition: the pure selector fails closed exactly like production
    // (proving this is a real session_expired case, not a test fixture bug).
    const before = selectOwnerWorkspaceToken(await collection.find().then(c => c.toArray()), 'acme-real', 'account-real');
    assert.equal(before.reason, 'session_expired');

    const sessions = await collection.find().then(c => c.toArray());
    const refreshImpl = (refreshToken) => refreshAccessToken(refreshToken, { tokenUrl });

    const result = await refreshOwnerWorkspaceToken({
      sessions,
      urlKey: 'acme-real',
      ownerAccountId: 'account-real',
      refreshAccessToken: refreshImpl,
      persistSession,
    });

    assert.equal(result.token, 'rotated-access-token');
    assert.equal(result.provider, 'linear');

    // Persisted to the SAME row, rotated refresh_token (not the old one).
    const persistedDoc = collection._raw().find(d => d._id === 'sid-real-1');
    assert.equal(persistedDoc.session.workspaces[0].accessToken, 'rotated-access-token');
    assert.equal(persistedDoc.session.workspaces[0].refreshToken, 'rotated-refresh-token');
    assert.notEqual(persistedDoc.session.workspaces[0].refreshToken, 'real-refresh-token');

    // TTL preserved — the session row's `expires` field is byte-identical to
    // what it was before the refresh-on-resolve persist (the load-bearing
    // LIN-1373 constraint that keeps this inside LIN-1367's (b) envelope).
    assert.equal(persistedDoc.expires, originalExpires);

    // Re-select via the real pure selector now returns ok with the fresh token.
    const after = selectOwnerWorkspaceToken(collection._raw(), 'acme-real', 'account-real');
    assert.equal(after.reason, 'ok');
    assert.equal(after.token, 'rotated-access-token');
  });

  test('I2: Linear rejects the refresh (invalid_grant, real 400 over HTTP) -> real TokenRefreshError(EXPIRED), no persist, selector still session_expired (never a 500, never a fabricated success)', async () => {
    tokenServerBehavior = (req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_grant' }));
    };

    const collection = inMemorySessionsCollection([
      {
        _id: 'sid-real-2',
        expires: new Date(Date.now() + 30 * 86400 * 1000),
        session: {
          accountId: 'account-real-2',
          workspaces: [{
            urlKey: 'acme-real-2',
            provider: 'linear',
            accessToken: 'stale-access-token',
            refreshToken: 'dead-refresh-token',
            tokenExpiresAt: Date.now() - 10_000,
          }],
        },
      },
    ]);
    const persistSession = makePersistSessionRow(collection);
    const sessions = await collection.find().then(c => c.toArray());
    const refreshImpl = (refreshToken) => refreshAccessToken(refreshToken, { tokenUrl });

    await assert.rejects(
      () => refreshOwnerWorkspaceToken({
        sessions,
        urlKey: 'acme-real-2',
        ownerAccountId: 'account-real-2',
        refreshAccessToken: refreshImpl,
        persistSession,
      }),
      (err) => {
        assert.ok(err instanceof TokenRefreshError);
        assert.equal(err.code, 'EXPIRED');
        return true;
      }
    );

    // No persistence happened — the stale row is exactly as it started.
    const doc = collection._raw().find(d => d._id === 'sid-real-2');
    assert.equal(doc.session.workspaces[0].accessToken, 'stale-access-token');

    // Falling through, the real selector still reports session_expired — this
    // is the exact 503 WORKSPACE_SESSION_EXPIRED envelope resolveWorkspaceAccess
    // returns on refresh failure, never a 500.
    const after = selectOwnerWorkspaceToken(collection._raw(), 'acme-real-2', 'account-real-2');
    assert.equal(after.reason, 'session_expired');
    assert.equal(after.token, null);
  });
});

/**
 * LIN-1499 close-out ledger item 2: the plan's verification table assigned
 * "a GitHub row re-mints end-to-end and rotates the scalar mirror" to THIS
 * file, but the composition — the REAL `GitHubProvider.refreshCredential`
 * (lib/providers/github/index.js) driven through the REAL
 * `remintActiveCredential` (lib/workspace.js) via the REAL `doRefresh`
 * (lib/workspace-token-refresh.js) — was never actually exercised as one
 * chain; every existing GitHub case in workspace-token-refresh.test.js drives
 * `doRefresh` with a FAKE provider object instead. This block closes that
 * gap deterministically at the existing injected `fetchImpl`/`now` seams —
 * no live GitHub App, no real network, no waiting for a real installation
 * token to expire. Mirrors the offline pattern already established in
 * tests/unit/github-app-integration.test.js (ephemeral in-test RSA keypair
 * signs the App JWT; `fetchImpl` stubs the install-token HTTP round-trip).
 */
describe('LIN-1499 GitHub composition witness (real refreshCredential + real remintActiveCredential, through doRefresh)', () => {
  const APP_ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
  let savedEnv;

  beforeEach(() => {
    _resetInflightForTests();
    savedEnv = Object.fromEntries(APP_ENV.map(k => [k, process.env[k]]));
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = '123456';
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' });
    process.env.GITHUB_APP_SLUG = 'my-app';
  });

  afterEach(() => {
    for (const k of APP_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  test('I3: an expired GitHub owner row re-mints via the REAL GitHubProvider.refreshCredential composed through doRefresh — scalar mirror rotates, refreshToken stays undefined, no real network call', async () => {
    const now = 1_700_000_000_000; // fixed epoch ms — drives both mintAppJwt's iat and the staleness math below
    const storedExpiry = now - 60 * 60 * 1000; // expired an hour ago
    const freshExpiryIso = new Date(now + 60 * 60 * 1000).toISOString();

    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init?.method });
      return {
        ok: true,
        status: 201,
        statusText: 'Created',
        text: async () => JSON.stringify({ token: 'ghs_fresh_from_real_provider', expires_at: freshExpiryIso }),
      };
    };

    // The real provider, no boot client — the production GitHub App shape.
    // Its refreshCredential is NOT stubbed; only the network boundary
    // (fetchImpl) and the clock (now) are injected.
    const provider = new GitHubProvider();
    const resolveProvider = () => provider;

    const collection = inMemorySessionsCollection([
      {
        _id: 'sid-gh-1',
        expires: new Date(Date.now() + 30 * 86400 * 1000),
        session: {
          accountId: 'account-gh',
          workspaces: [{
            urlKey: 'acme-gh',
            provider: 'github',
            accessToken: 'stale-gh-token',
            tokenExpiresAt: storedExpiry,
            bindings: [{
              provider: 'github',
              scope: 'octocat/repo',
              credentials: { token: 'stale-gh-token', installationId: '987' },
            }],
          }],
        },
      },
    ]);
    const persistSession = makePersistSessionRow(collection);
    const sessions = await collection.find().then(c => c.toArray());
    const refreshAccessTokenImpl = async () => { throw new Error('Linear exchange must not be called for a GitHub row'); };

    const result = await refreshOwnerWorkspaceToken({
      sessions,
      urlKey: 'acme-gh',
      ownerAccountId: 'account-gh',
      refreshAccessToken: refreshAccessTokenImpl,
      persistSession,
      resolveProvider,
      fetchImpl,
      now,
    });

    // The only "network" activity was the injected fetchImpl — proves the
    // real mint path executed (App JWT signed, install-token endpoint hit)
    // without ever reaching a live socket.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/app/installations/987/access_tokens');
    assert.equal(calls[0].method, 'POST');

    assert.equal(result.token, 'ghs_fresh_from_real_provider');
    assert.equal(result.provider, 'github');
    assert.ok(result.expiresAt > storedExpiry, 'tokenExpiresAt advances to a real, strictly-later ms epoch');

    const persistedDoc = collection._raw().find(d => d._id === 'sid-gh-1');
    const persistedWs = persistedDoc.session.workspaces[0];
    assert.equal(persistedWs.accessToken, 'ghs_fresh_from_real_provider', 'scalar mirror rotates');
    assert.equal(persistedWs.refreshToken, undefined, 'GitHub-family must never gain a refreshToken (would corrupt Linear-wire-shaped state)');
    assert.ok(Number.isFinite(persistedWs.tokenExpiresAt) && !Number.isNaN(persistedWs.tokenExpiresAt));
    assert.equal(persistedWs.bindings[0].credentials.installationId, '987', 'installationId survives the linkProvider merge');
  });
});
