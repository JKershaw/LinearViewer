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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { selectOwnerWorkspaceToken, classifyWorkspaceFailure, UNSCOPED } from '../../lib/workspace-token-resolver.js';
import { refreshOwnerWorkspaceToken, _resetInflightForTests } from '../../lib/workspace-token-refresh.js';
import { refreshAccessToken, TokenRefreshError } from '../../lib/token-refresh.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

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
  await new Promise(resolve => tokenServer.listen(0, '127.0.0.1', resolve));
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
            // LIN-1524: no refreshToken on the session row anymore — it lives
            // only in the durable store (`store.get` below).
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
    const storeCalls = [];
    // LIN-1524: the durable record is what actually carries the refresh token now.
    const durableRecords = new Map([
      ['account-real::acme-real', { provider: 'linear', scope: 'acme-real', token: 'stale-access-token', refreshToken: 'real-refresh-token', tokenExpiresAt: Date.now() - 10_000 }],
    ]);
    const store = {
      async get(accountId, urlKey) { return durableRecords.get(`${accountId}::${urlKey}`) ?? null; },
      async put(accountId, urlKey, credential) {
        storeCalls.push({ accountId, urlKey, credential });
        durableRecords.set(`${accountId}::${urlKey}`, credential);
      },
      // LIN-1546: optimistic CAS — writes only if the stored refreshToken still
      // matches the witness (it does here; no concurrent rotation in this test).
      async putIfRefreshToken(accountId, urlKey, expected, next) {
        const key = `${accountId}::${urlKey}`;
        const current = durableRecords.get(key);
        if (!current || current.refreshToken !== expected) return false;
        storeCalls.push({ accountId, urlKey, credential: next });
        durableRecords.set(key, next);
        return true;
      },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };

    const result = await refreshOwnerWorkspaceToken({
      sessions,
      urlKey: 'acme-real',
      ownerAccountId: 'account-real',
      refreshAccessToken: refreshImpl,
      persistSession,
      store,
    });

    assert.equal(result.token, 'rotated-access-token');
    assert.equal(result.provider, 'linear');

    // LIN-1524: the durable write landed once, with the rotated (not the
    // old) refreshToken, for the correct owner/workspace pair.
    assert.equal(storeCalls.length, 1);
    assert.equal(storeCalls[0].accountId, 'account-real');
    assert.equal(storeCalls[0].urlKey, 'acme-real');
    assert.equal(storeCalls[0].credential.refreshToken, 'rotated-refresh-token');

    // The session row is mirrored (accessToken only — refreshToken lives ONLY
    // in the durable store now, never written back to the session).
    const persistedDoc = collection._raw().find(d => d._id === 'sid-real-1');
    assert.equal(persistedDoc.session.workspaces[0].accessToken, 'rotated-access-token');
    assert.equal(persistedDoc.session.workspaces[0].refreshToken, undefined);

    // TTL preserved — the session row's `expires` field is byte-identical to
    // what it was before the refresh-on-resolve persist (the load-bearing
    // LIN-1373 constraint that keeps this inside LIN-1367's (b) envelope).
    assert.equal(persistedDoc.expires, originalExpires);

    // Re-select via the real pure selector now returns ok with the fresh token
    // (accessToken mirror is what makes this resolve — the durable record
    // itself is never consulted by this selector).
    const after = selectOwnerWorkspaceToken(collection._raw(), 'acme-real', 'account-real');
    assert.equal(after.reason, 'ok');
    assert.equal(after.token, 'rotated-access-token');

    // And the durable record itself now holds the rotated refresh token.
    const durableAfter = await store.get('account-real', 'acme-real');
    assert.equal(durableAfter.refreshToken, 'rotated-refresh-token');
    assert.notEqual(durableAfter.refreshToken, 'real-refresh-token');
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
            // LIN-1524: no refreshToken on the session row — durable-store-only.
            tokenExpiresAt: Date.now() - 10_000,
          }],
        },
      },
    ]);
    const persistSession = makePersistSessionRow(collection);
    const sessions = await collection.find().then(c => c.toArray());
    const refreshImpl = (refreshToken) => refreshAccessToken(refreshToken, { tokenUrl });
    const store = {
      async get() { return { provider: 'linear', scope: 'acme-real-2', token: 'stale-access-token', refreshToken: 'dead-refresh-token', tokenExpiresAt: Date.now() - 10_000 }; },
      async put() { throw new Error('must not be called — the refresh failed'); },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };

    await assert.rejects(
      () => refreshOwnerWorkspaceToken({
        sessions,
        urlKey: 'acme-real-2',
        ownerAccountId: 'account-real-2',
        refreshAccessToken: refreshImpl,
        persistSession,
        store,
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
    // LIN-1524 close-out replacement assertion (D5-style), applied here at the
    // COMPOSITION level with the real provider: the original assertion below
    // ("refreshToken stays undefined") is a vacuity trap post-cutover, since
    // NOTHING writes refreshToken to the session for anyone anymore — it would
    // pass even if this composition accidentally started creating a durable
    // Linear record for a GitHub-family workspace. The real proof is against
    // the durable store directly: it must never be touched.
    const storeCalls = [];
    const store = {
      async get() { return null; },
      async put(...args) { storeCalls.push(args); },
    };

    const result = await refreshOwnerWorkspaceToken({
      sessions,
      urlKey: 'acme-gh',
      ownerAccountId: 'account-gh',
      refreshAccessToken: refreshAccessTokenImpl,
      persistSession,
      resolveProvider,
      store,
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

    // The actual replacement assertion: the durable store — Linear-only by
    // design — was never touched by this GitHub-family composition.
    assert.equal(storeCalls.length, 0, 'store.put must never be called for a GitHub-family re-mint, even at the real-provider composition level');
  });
});

describe('LIN-1524 durable-only real-refresh witness (logged-out owner, unstubbed refreshAccessToken)', () => {
  test('I4 (LIN-1524\'s end-to-end deliverable): real HTTP Linear refresh sourced from a durable record with NO session row present at all', async () => {
    // The integration-level counterpart of the unit suite's B9b: a proxy token
    // resolving a workspace whose owner has fully logged out — zero session
    // rows for this account, anywhere, in the whole collection — still
    // refreshes successfully, using the REAL (unstubbed) refreshAccessToken
    // over real HTTP, sourced entirely from the durable record. Before
    // LIN-1524 this was structurally impossible: refresh-on-resolve only ever
    // read sessions, so a logged-out owner's proxy token was permanently dead
    // the moment the session row disappeared. This is the phase's actual
    // deliverable, proven at the same fidelity (real HTTP, real token
    // exchange) as I1/I2.
    tokenServerBehavior = (req, res, body) => {
      assert.equal(req.method, 'POST');
      assert.ok(body.includes('grant_type=refresh_token'));
      assert.ok(body.includes('refresh_token=durable-only-refresh-token'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: 'rotated-from-durable-only',
        refresh_token: 'rotated-refresh-durable-only',
        expires_in: 3600,
        scope: 'read write',
      }));
    };

    // No session rows at all — the collection is entirely empty. There is
    // nothing for selectExpiredOwnerRow (or its sibling selectOwnerSessionRow)
    // to find, by construction.
    const collection = inMemorySessionsCollection([]);
    const persistSession = makePersistSessionRow(collection);
    const refreshImpl = (refreshToken) => refreshAccessToken(refreshToken, { tokenUrl });

    const durableRecords = new Map([
      ['account-loggedout::acme-loggedout', { provider: 'linear', scope: 'acme-loggedout', token: 'stale-pre-logout-token', refreshToken: 'durable-only-refresh-token', tokenExpiresAt: Date.now() - 10_000 }],
    ]);
    const storeCalls = [];
    const store = {
      async get(accountId, urlKey) { return durableRecords.get(`${accountId}::${urlKey}`) ?? null; },
      async put(accountId, urlKey, credential) { storeCalls.push({ accountId, urlKey, credential }); durableRecords.set(`${accountId}::${urlKey}`, credential); },
      // LIN-1546: optimistic CAS — the durable write the seam actually uses now.
      async putIfRefreshToken(accountId, urlKey, expected, next) {
        const key = `${accountId}::${urlKey}`;
        const current = durableRecords.get(key);
        if (!current || current.refreshToken !== expected) return false;
        storeCalls.push({ accountId, urlKey, credential: next });
        durableRecords.set(key, next);
        return true;
      },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };

    const result = await refreshOwnerWorkspaceToken({
      sessions: await collection.find().then(c => c.toArray()),
      urlKey: 'acme-loggedout',
      ownerAccountId: 'account-loggedout',
      refreshAccessToken: refreshImpl,
      persistSession,
      store,
    });

    assert.equal(result.token, 'rotated-from-durable-only');
    assert.equal(result.provider, 'linear');
    assert.ok(result.expiresAt > Date.now());

    // The durable record was rotated — real refresh_token, real rotation.
    assert.equal(storeCalls.length, 1);
    assert.equal(storeCalls[0].credential.refreshToken, 'rotated-refresh-durable-only');
    assert.notEqual(storeCalls[0].credential.refreshToken, 'durable-only-refresh-token');

    // No session row existed anywhere — nothing was (or could be) mirrored
    // into one. The collection stays empty; this is not an error case, it's
    // the correct behaviour for a logged-out owner.
    assert.equal(collection._raw().length, 0);
  });
});

// ---------------------------------------------------------------------------
// LIN-1544 durable-credential resolve witness (guards LIN-1524; the I5 sibling
// of I4): lifts I4's logged-out durable refresh up to the FULL
// resolveWorkspaceAccess envelope — proving `reason: 'ok'` is what an owner's
// headless proxy token gets AFTER logout, minted from the durable credential.
// ---------------------------------------------------------------------------

// The in-test mirror of server.js's `resolveWorkspaceAccess` refresh-on-resolve
// composition (server.js:1318-1363). server.js itself is not import-safe (it
// connects to a real DB and listens at module load — see this file's header),
// so — exactly as I1–I4 reconstruct the persist/TTL composition rather than
// importing the function — this reconstructs the selector → owner-guard →
// refresh → classify pipeline from the SAME real lib pieces the server wires,
// over the SAME real HTTP token seam. The Block-F source-grep below pins this
// mirror to production so the two cannot silently drift. The cache and the
// GitHub-only `resolveProvider`/`persistSession` mirror legs are not exercised
// by a logged-out Linear owner (empty sessions, durable-only) and are omitted
// for the same reason I4 omits them.
async function resolveWorkspaceAccessMirror({ collection, urlKey, ownerAccountId, refreshAccessToken, persistSession, store }) {
  const sessions = await collection.find().then(c => c.toArray());
  const selected = selectOwnerWorkspaceToken(sessions, urlKey, ownerAccountId);

  if (selected.token) {
    return { token: selected.token, reason: 'ok', provider: selected.provider };
  }

  // Refresh-on-resolve, owner-scoped (never UNSCOPED) — server.js:1345-1363.
  if (!selected.token && ownerAccountId !== UNSCOPED) {
    try {
      const refreshed = await refreshOwnerWorkspaceToken({
        sessions,
        urlKey,
        ownerAccountId,
        refreshAccessToken,
        persistSession,
        store,
      });
      if (refreshed) {
        return { token: refreshed.token, reason: 'ok', provider: refreshed.provider };
      }
    } catch {
      // Fall through to classification — never a 500, never cached.
    }
  }

  const reason = classifyWorkspaceFailure({ sessions, urlKey, ownerAccountId, selectedReason: selected.reason });
  return { token: selected.token, reason, provider: selected.provider };
}

// Extracts the body of `async function resolveWorkspaceAccess` from server.js
// (the exact idiom + rationale as linear-token-isolation.test.js's Block F):
// from the function keyword to the next TOP-LEVEL `\n}`. Relies on the repo's
// consistent 2-space indentation (CLAUDE.md) — every inner brace is
// space-prefixed, so only the function's own closing brace matches "\n}".
function extractResolveWorkspaceAccessBody(src) {
  const start = src.indexOf('async function resolveWorkspaceAccess');
  assert.ok(start >= 0, 'async function resolveWorkspaceAccess not found in server.js');
  const end = src.indexOf('\n}', start);
  assert.ok(end >= 0, "could not find resolveWorkspaceAccess's top-level closing brace");
  return src.slice(start, end + 2);
}

// LIN-1547 (review finding F1): strip JS comments before grepping the body.
// resolveWorkspaceAccess *mentions* `ownerAccountId !== UNSCOPED` in a comment
// that textually precedes the real guard, so a comment-keeping grep can bind
// `guardIdx` to the comment — deleting the real guard line while leaving the
// comment would still pass. This removes block + line comments first so I5c
// greps only executable code. Safe for this body specifically: it contains no
// `//` or `/*` sequence inside a string literal (the URL-in-a-string pitfall),
// so there is nothing for the naive stripper to over-eat.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

describe('LIN-1544 durable-credential resolve witness (logout -> headless resolve reason:ok, guards LIN-1524)', () => {
  beforeEach(() => { _resetInflightForTests(); });

  // Owner-scoped throughout: a single account, one workspace, one durable
  // record. No second account is ever seeded, so a green run cannot come from
  // borrowing another owner's credential (preserves LIN-1366 isolation).
  const ACCOUNT = 'account-lin1544';
  const URL_KEY = 'acme-lin1544';
  const DURABLE_KEY = `${ACCOUNT}::${URL_KEY}`;

  test('I5: owner logs out (live session row removed, durable record preserved) -> resolve returns reason:ok, token minted FROM the durable credential over real HTTP', async () => {
    tokenServerBehavior = (req, res, body) => {
      assert.equal(req.method, 'POST');
      assert.ok(body.includes('grant_type=refresh_token'));
      assert.ok(body.includes('refresh_token=durable-lin1544-refresh-token'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: 'rotated-lin1544-access-token',
        refresh_token: 'rotated-lin1544-refresh-token',
        expires_in: 3600,
        scope: 'read write',
      }));
    };

    // Logout = the live session row is gone. Empty collection: nothing for the
    // pure selector to find — exactly the post-logout state, durable-only.
    const collection = inMemorySessionsCollection([]);
    const persistSession = makePersistSessionRow(collection);
    const refreshImpl = (refreshToken) => refreshAccessToken(refreshToken, { tokenUrl });

    // The durable owner-credentials record SURVIVES logout (mirrors
    // routes/auth.js logout keeping the credential — logout = zero durable
    // deletes). Seeded with a stale/expired access token + a valid refresh
    // token, keyed `${accountId}::${urlKey}` per OwnerCredentialStore.
    const durableRecords = new Map([
      [DURABLE_KEY, { provider: 'linear', scope: URL_KEY, token: 'stale-pre-logout-token', refreshToken: 'durable-lin1544-refresh-token', tokenExpiresAt: Date.now() - 10_000 }],
    ]);
    const storeCalls = [];
    const store = {
      async get(accountId, urlKey) { return durableRecords.get(`${accountId}::${urlKey}`) ?? null; },
      async put(accountId, urlKey, credential) { storeCalls.push({ accountId, urlKey, credential }); durableRecords.set(`${accountId}::${urlKey}`, credential); },
      // LIN-1546: optimistic CAS — the durable write the seam actually uses now.
      async putIfRefreshToken(accountId, urlKey, expected, next) {
        const key = `${accountId}::${urlKey}`;
        const current = durableRecords.get(key);
        if (!current || current.refreshToken !== expected) return false;
        storeCalls.push({ accountId, urlKey, credential: next });
        durableRecords.set(key, next);
        return true;
      },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };

    // Pre-condition: with the live session row gone, the pure selector fails
    // closed with `not_connected` — proving the token below is produced by the
    // durable refresh path, NOT by session selection (a real logged-out case,
    // not a fixture that still has a resolvable session row).
    const preSelect = selectOwnerWorkspaceToken(await collection.find().then(c => c.toArray()), URL_KEY, ACCOUNT);
    assert.equal(preSelect.reason, 'not_connected');
    assert.equal(preSelect.token, null);

    const result = await resolveWorkspaceAccessMirror({
      collection,
      urlKey: URL_KEY,
      ownerAccountId: ACCOUNT,
      refreshAccessToken: refreshImpl,
      persistSession,
      store,
    });

    // The deliverable: a logged-out owner's headless resolve returns reason:ok.
    assert.equal(result.reason, 'ok');
    assert.equal(result.token, 'rotated-lin1544-access-token');
    assert.equal(result.provider, 'linear');

    // Evidence the DURABLE-CREDENTIAL refresh path is what produced the token:
    // the durable record was read AND rotated once, for the correct owner pair,
    // with the freshly-rotated (not the seeded) refresh token.
    assert.equal(storeCalls.length, 1);
    assert.equal(storeCalls[0].accountId, ACCOUNT);
    assert.equal(storeCalls[0].urlKey, URL_KEY);
    assert.equal(storeCalls[0].credential.refreshToken, 'rotated-lin1544-refresh-token');
    assert.notEqual(storeCalls[0].credential.refreshToken, 'durable-lin1544-refresh-token');

    // The durable record survived logout and now holds the rotated credential.
    const durableAfter = await store.get(ACCOUNT, URL_KEY);
    assert.equal(durableAfter.refreshToken, 'rotated-lin1544-refresh-token');

    // No session row existed to mirror into — the collection stays empty. The
    // durable record alone carried the owner's authority across logout.
    assert.equal(collection._raw().length, 0);
  });

  test('I5b (failing-first twin, permanent): the IDENTICAL logged-out resolve with NO durable record returns reason:owner_signed_out, not ok — so I5\'s pass is load-bearing on the durable-credential path', async () => {
    // Same logged-out shape as I5 (empty sessions, same owner/workspace), but
    // the durable record is ABSENT. This is what I5 would degrade to if the
    // durable-credential path were removed — the exact regression LIN-1524
    // closed and this witness guards. Encoded permanently (not a momentary
    // toggle) so the contrast is a standing part of the suite, and it needs no
    // runtime/source change to demonstrate the red.
    const collection = inMemorySessionsCollection([]);
    const persistSession = makePersistSessionRow(collection);
    const refreshImpl = (refreshToken) => refreshAccessToken(refreshToken, { tokenUrl });

    const store = {
      async get() { return null; }, // no durable record for this owner
      async put() { throw new Error('put must not be called — there is no durable record to rotate'); },
    };

    const result = await resolveWorkspaceAccessMirror({
      collection,
      urlKey: URL_KEY,
      ownerAccountId: ACCOUNT,
      refreshAccessToken: refreshImpl,
      persistSession,
      store,
    });

    // Without the durable credential, the logged-out owner falls straight to
    // the honest failure classification — owner_signed_out (not_connected +
    // no session row anywhere) — NEVER reason:ok.
    assert.notEqual(result.reason, 'ok');
    assert.equal(result.reason, 'owner_signed_out');
    assert.equal(result.token, null);
  });

  test('I5c (Block-F anti-drift): the REAL server.js resolveWorkspaceAccess returns reason:ok inside the `if (refreshed)` block, gated behind the `ownerAccountId !== UNSCOPED` refresh guard', () => {
    // Pins the in-test mirror above to production without importing the
    // not-import-safe server.js. Whitespace-tolerant (normalises runs of
    // whitespace to a single space) so it survives reflow/reformatting and
    // pins BEHAVIOUR — the ordering of guard -> refresh -> ok-return — not an
    // exact source string. Comments are stripped FIRST (LIN-1547 F1) so no
    // grep below can bind to prose that merely mentions the code it checks.
    const flat = stripComments(extractResolveWorkspaceAccessBody(SERVER_SRC)).replace(/\s+/g, ' ');

    // LIN-1547 (F1): assert the guard as a REAL `if (... ownerAccountId !== UNSCOPED)`
    // statement, not just any occurrence of the text. With comments stripped this
    // is doubly safe: the only remaining occurrence is the executable guard, and
    // this regex additionally requires it be inside an `if (...)` head. Deleting
    // the real guard line now fails here even if a comment mentioning it survived.
    assert.match(
      flat,
      /if \([^)]*ownerAccountId !== UNSCOPED[^)]*\)/,
      'resolveWorkspaceAccess must gate refresh-on-resolve behind a real `if (... ownerAccountId !== UNSCOPED)` statement (not merely mention it in a comment)'
    );

    const guardIdx = flat.indexOf('ownerAccountId !== UNSCOPED');
    const refreshIdx = flat.indexOf('refreshOwnerWorkspaceToken(');
    const ifRefreshedIdx = flat.indexOf('if (refreshed)');
    const okReturnIdx = flat.indexOf("reason: 'ok'", ifRefreshedIdx);
    const classifyIdx = flat.indexOf('classifyWorkspaceFailure(', ifRefreshedIdx);

    // Refresh-on-resolve is owner-scoped: the UNSCOPED guard textually precedes
    // the refresh call (an UNSCOPED caller never reaches the durable store).
    assert.ok(guardIdx >= 0, 'the `ownerAccountId !== UNSCOPED` refresh guard is missing from resolveWorkspaceAccess');
    assert.ok(refreshIdx > guardIdx, 'refreshOwnerWorkspaceToken must be called under the `ownerAccountId !== UNSCOPED` guard');

    // The ok-envelope is gated on a SUCCESSFUL durable refresh, and is emitted
    // BEFORE the classify fallthrough — i.e. a fresh durable-minted token wins.
    assert.ok(ifRefreshedIdx > refreshIdx, 'the ok-envelope must sit inside the `if (refreshed)` success block');
    assert.ok(okReturnIdx >= 0, "resolveWorkspaceAccess must return reason: 'ok' inside the `if (refreshed)` block");
    assert.ok(classifyIdx === -1 || okReturnIdx < classifyIdx, "the `if (refreshed)` reason: 'ok' return must precede the classifyWorkspaceFailure fallthrough");

    // LIN-1547 (ledger item 2): pin the DURABLE-STORE WIRING ARGS the production
    // refresh call passes, not just the guard->refresh->ok ORDERING above. The
    // ordering grep would stay green if a future edit dropped or swapped the
    // durable `store` (or the `persistSession`/`resolveProvider` legs) — the
    // sharpest residual drift risk. Scope the search to the call's argument
    // region (between the call site and the `if (refreshed)` that follows it) so
    // an unrelated later mention cannot satisfy it.
    const callArgs = flat.slice(refreshIdx, ifRefreshedIdx);
    assert.ok(
      callArgs.includes('store: ownerCredentialStore'),
      'refreshOwnerWorkspaceToken must be wired with the durable `store: ownerCredentialStore` arg (dropping it would silently disable durable refresh while keeping this witness green)'
    );
    assert.ok(
      callArgs.includes('persistSession: persistSessionRow'),
      'refreshOwnerWorkspaceToken must be wired with `persistSession: persistSessionRow`'
    );
    assert.ok(
      callArgs.includes('resolveProvider: getProviderForWorkspace'),
      'refreshOwnerWorkspaceToken must be wired with `resolveProvider: getProviderForWorkspace`'
    );
  });
});
