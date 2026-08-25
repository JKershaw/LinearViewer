/**
 * LIN-2234 (Ticket B of the LIN-2231 design) — canonical-account resolution.
 *
 * Covers `AccountStore.resolveCanonicalAccountId` (behavioural, real Mango
 * collection) and the `resolveWorkspaceAccess` chokepoint wiring in
 * server.js (source-grep witness, same convention
 * tests/unit/linear-token-isolation.test.js's Block F uses — no test in this
 * repo drives server.js's real resolveWorkspaceAccess behaviourally; every
 * caller injects a stub for it).
 *
 * Run with: node --test tests/unit/canonical-account-resolution.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MangoClient } from '@jkershaw/mangodb';
import { AccountStore } from '../../lib/account-store.js';
import { UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution } from '../../lib/workspace-token-resolver.js';
import { CREDENTIAL_SOURCES, fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';
import { workspaceTokenCacheKey as realWorkspaceTokenCacheKey } from '../../lib/workspace-token-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

// ---------------------------------------------------------------------------
// Shared fixture (hoisted for LIN-2271, plan-review F1): Block A's local
// Mango AccountStore fixture and its lifecycle, promoted to module scope so
// Block C and the mutation-check block below can also call freshStore() —
// this is an in-file hoist, not a new shared abstraction: no second fixture
// exists anywhere, and nothing outside this file imports it.
// ---------------------------------------------------------------------------
let dbClient, dbDir, counter = 0;

before(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'canonical-resolution-'));
  dbClient = new MangoClient(dbDir);
  await dbClient.connect();
});

after(async () => {
  if (dbClient?.close) await dbClient.close();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

function freshStore() {
  const db = dbClient.db(`canon_${counter++}`);
  return new AccountStore({ collection: db.collection('accounts') });
}

// ---------------------------------------------------------------------------
// Block A — AccountStore.resolveCanonicalAccountId (behavioural)
// ---------------------------------------------------------------------------

describe('AccountStore.resolveCanonicalAccountId (LIN-2234, Block A — behavioural)', () => {
  test('null/falsy accountId -> null immediately, no lookup performed', async () => {
    const store = freshStore();
    // A collection whose findOne throws proves "no lookup" — any call at all
    // would fail this test, not just return the wrong value.
    store.collection = { findOne: () => { throw new Error('must not be called'); } };
    assert.equal(await store.resolveCanonicalAccountId(null), null);
    assert.equal(await store.resolveCanonicalAccountId(undefined), null);
    assert.equal(await store.resolveCanonicalAccountId(''), null);
  });

  test('a non-merged account resolves to itself', async () => {
    const store = freshStore();
    const account = await store.createAccount();
    assert.equal(await store.resolveCanonicalAccountId(account._id), account._id);
  });

  test('an unknown accountId (no document at all) resolves to itself, not an error', async () => {
    const store = freshStore();
    assert.equal(await store.resolveCanonicalAccountId('does-not-exist'), 'does-not-exist');
  });

  test('a single-hop merged account resolves to its canonical account', async () => {
    const store = freshStore();
    const canonical = await store.createAccount();
    const merged = await store.createAccount();
    const result = await store.mergeAccounts(canonical._id, merged._id);
    assert.ok(result.ok);
    assert.equal(await store.resolveCanonicalAccountId(merged._id), canonical._id);
    // The canonical side is untouched — still resolves to itself.
    assert.equal(await store.resolveCanonicalAccountId(canonical._id), canonical._id);
  });

  test('a multi-hop chain (X merged into Y, Y later merged into Z) resolves to the fixed point Z', async () => {
    const store = freshStore();
    const x = await store.createAccount();
    const y = await store.createAccount();
    const z = await store.createAccount();
    assert.ok((await store.mergeAccounts(y._id, x._id)).ok);
    assert.ok((await store.mergeAccounts(z._id, y._id)).ok);

    assert.equal(await store.resolveCanonicalAccountId(x._id), z._id, 'X resolves through Y to the final canonical Z');
    assert.equal(await store.resolveCanonicalAccountId(y._id), z._id);
    assert.equal(await store.resolveCanonicalAccountId(z._id), z._id);
  });

  test('a corrupt cycle (data written directly, bypassing mergeAccounts) fails loud instead of hanging', async () => {
    const store = freshStore();
    const a = await store.createAccount();
    const b = await store.createAccount();
    // mergeAccounts itself can never produce this (it refuses to merge INTO
    // an already-merged account) — this manufactures the "corrupt data"
    // scenario the depth cap exists for.
    await store.collection.updateOne({ _id: a._id }, { $set: { mergedInto: b._id } });
    await store.collection.updateOne({ _id: b._id }, { $set: { mergedInto: a._id } });

    await assert.rejects(
      () => store.resolveCanonicalAccountId(a._id),
      /cycle detected/,
      'a 2-node cycle must be caught by the visited-set check, not merely time out on maxDepth'
    );
  });

  test('a chain longer than maxDepth throws rather than looping forever', async () => {
    const store = freshStore();
    // 10 accounts chained A0 -> A1 -> ... -> A9, each merged into the next —
    // one more hop than the default maxDepth of 8.
    const accounts = [];
    for (let i = 0; i < 10; i++) accounts.push(await store.createAccount());
    for (let i = 0; i < 9; i++) {
      assert.ok((await store.mergeAccounts(accounts[i + 1]._id, accounts[i]._id)).ok);
    }
    await assert.rejects(
      () => store.resolveCanonicalAccountId(accounts[0]._id),
      /exceeded maxDepth/
    );
    // A caller-supplied maxDepth large enough to cover the chain succeeds.
    assert.equal(await store.resolveCanonicalAccountId(accounts[0]._id, 20), accounts[9]._id);
  });
});

// ---------------------------------------------------------------------------
// Block B — resolveWorkspaceAccess chokepoint wiring (source-grep witness)
// ---------------------------------------------------------------------------

function extractResolveWorkspaceAccessBody(src) {
  const start = src.indexOf('async function resolveWorkspaceAccess');
  assert.ok(start >= 0, 'async function resolveWorkspaceAccess not found in server.js');
  const end = src.indexOf('\n}', start);
  assert.ok(end >= 0, "could not find resolveWorkspaceAccess's top-level closing brace");
  return src.slice(start, end + 2);
}

describe('resolveWorkspaceAccess canonicalization wiring (LIN-2234, Block B — witness, source-grep)', () => {
  test('resolveCanonicalAccountId is called BEFORE the cache key is computed', () => {
    const body = extractResolveWorkspaceAccessBody(SERVER_SRC);
    const resolveIdx = body.indexOf('accountStore.resolveCanonicalAccountId(');
    const cacheKeyIdx = body.indexOf('workspaceTokenCacheKey(');
    assert.ok(resolveIdx >= 0, 'accountStore.resolveCanonicalAccountId( is not called inside resolveWorkspaceAccess');
    assert.ok(cacheKeyIdx >= 0, 'sanity check failed: workspaceTokenCacheKey( is not called inside resolveWorkspaceAccess');
    assert.ok(
      resolveIdx < cacheKeyIdx,
      'canonicalization must run before the cache key is derived, so the cache (and every consumer downstream of the cache key) is keyed by the canonical id'
    );
  });

  test('UNSCOPED bypasses canonicalization entirely — the call is textually guarded on `!== UNSCOPED`', () => {
    const body = extractResolveWorkspaceAccessBody(SERVER_SRC);
    const resolveIdx = body.indexOf('accountStore.resolveCanonicalAccountId(');
    assert.ok(resolveIdx >= 0);
    const nearIfLine = body.slice(0, resolveIdx).split('\n').reverse().find(l => l.trim().startsWith('if ('));
    assert.ok(nearIfLine, 'expected an `if (...)` guarding the resolveCanonicalAccountId( call');
    assert.match(
      nearIfLine,
      /ownerAccountId !== UNSCOPED/,
      'the canonicalization call must be gated on a real (non-UNSCOPED) owner — UNSCOPED must never be handed to AccountStore or resolved into a real account id (constraint 11)'
    );
  });

  test('canonicalization precedes every named downstream chokepoint consumer', () => {
    const body = extractResolveWorkspaceAccessBody(SERVER_SRC);
    const resolveIdx = body.indexOf('accountStore.resolveCanonicalAccountId(');
    assert.ok(resolveIdx >= 0);
    for (const marker of ['workspaceTokenCacheKey(', 'selectOwnerWorkspaceToken(', 'ownerCredentialStore.get(', 'classifyWorkspaceFailure(', 'refreshOwnerWorkspaceToken(']) {
      const idx = body.indexOf(marker);
      assert.ok(idx >= 0, `sanity check failed: ${marker} not found inside resolveWorkspaceAccess`);
      assert.ok(resolveIdx < idx, `resolveCanonicalAccountId must precede ${marker} — every downstream consumer must inherit the canonical id`);
    }
  });

  test('a canonical-resolution failure is reported as store_unreachable, never thrown past the function', () => {
    const body = extractResolveWorkspaceAccessBody(SERVER_SRC);
    const resolveIdx = body.indexOf('accountStore.resolveCanonicalAccountId(');
    assert.ok(resolveIdx >= 0);
    const after = body.slice(resolveIdx, resolveIdx + 400);
    assert.match(after, /catch \(err\)/, 'the resolveCanonicalAccountId call must be wrapped so a store failure (e.g. corrupt-cycle throw) does not become an unhandled rejection');
    assert.match(after, /store_unreachable/, 'a canonical-resolution failure must fall back to the same store_unreachable reason the session lookup below uses');
  });

  test('the canonicalized result is ASSIGNED BACK to ownerAccountId — not merely called and discarded', () => {
    const body = extractResolveWorkspaceAccessBody(SERVER_SRC);
    assert.match(
      body,
      /ownerAccountId\s*=\s*await\s+accountStore\.resolveCanonicalAccountId\(/,
      'the call\'s result must be assigned back to ownerAccountId — a substring match on the call name alone (as the other four tests in this block use) cannot see whether the result is bound to anything'
    );
  });
});

// ---------------------------------------------------------------------------
// Block C — resolveWorkspaceAccess canonicalization (LIN-2271, behavioural,
// vm-executed). server.js is not import-safe in a unit test (Mongo connect +
// app.listen() at module load), so this slices the real function body via
// extractResolveWorkspaceAccessBody above and executes it in a node:vm
// context, injecting the REAL collaborators (workspaceTokenCacheKey,
// selectOwnerWorkspaceToken, classifyWorkspaceFailure,
// describeWorkspaceResolution, fingerprintCredential, CREDENTIAL_SOURCES,
// CREDENTIAL_LIFECYCLE_EVENT_KINDS, UNSCOPED) and faking only the I/O
// boundaries (sessionsCollection, workspaceTokenCache, ownerCredentialStore,
// refreshOnResolveGate, credentialLifecycleEventStore,
// attemptSuspectCredentialRefresh).
// ---------------------------------------------------------------------------

async function runResolveWorkspaceAccess({ urlKey, ownerAccountId, sessions, accountStore, source = SERVER_SRC, cacheKeyCalls = [] }) {
  const context = vm.createContext({
    UNSCOPED, TOKEN_REFRESH_BUFFER_MS,
    selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution,
    CREDENTIAL_SOURCES, fingerprintCredential, CREDENTIAL_LIFECYCLE_EVENT_KINDS,
    accountStore,
    workspaceTokenCacheKey: (urlKey, ownerAccountId) => {
      cacheKeyCalls.push(ownerAccountId);
      return realWorkspaceTokenCacheKey(urlKey, ownerAccountId);
    },
    sessionsCollection: { find: () => ({ toArray: async () => sessions }) },
    workspaceTokenCache: { get: () => undefined, set: () => true },
    ownerCredentialStore: { get: async () => null },
    refreshOnResolveGate: { shouldAttempt: () => false },
    credentialLifecycleEventStore: { recordEvent: async () => {} },
    attemptSuspectCredentialRefresh: async () => null,
    console: { log() {}, warn() {}, error() {} },
    process: { env: {} },
  });
  const script = extractResolveWorkspaceAccessBody(source) + '\nresolveWorkspaceAccess';
  const fn = vm.runInContext(script, context);
  return fn(urlKey, ownerAccountId);
}

describe('resolveWorkspaceAccess canonicalization (LIN-2271, Block C — behavioural, vm-executed)', () => {
  test('AC1 (production shape): a real merge + a live session owned by canonical + caller passes the MERGED id -> resolves to canonical\'s token, and workspaceTokenCacheKey observes the CANONICAL owner', async () => {
    const store = freshStore();
    const canonical = await store.createAccount();
    const merged = await store.createAccount();
    assert.ok((await store.mergeAccounts(canonical._id, merged._id)).ok);

    const sessions = [{ _id: 'sid-1', session: { accountId: canonical._id, workspaces: [
      { urlKey: 'acme', provider: 'linear', accessToken: 'canonical-live-token', tokenExpiresAt: Date.now() + 10_000_000 }
    ] } }];
    const cacheKeyCalls = [];

    const result = await runResolveWorkspaceAccess({ urlKey: 'acme', ownerAccountId: merged._id, sessions, accountStore: store, cacheKeyCalls });

    assert.equal(result.token, 'canonical-live-token');
    assert.equal(result.reason, 'ok');
    assert.equal(cacheKeyCalls[0], canonical._id, 'the cache key must be derived from the CANONICAL id, not the merged id the caller passed in — this is the property the ticket exists to pin');
  });

  test('UNSCOPED bypasses canonicalization entirely — the store is never reached, not merely never asserted (behavioural upgrade of constraint 11)', async () => {
    const throwingStore = { resolveCanonicalAccountId: () => { throw new Error('must not be called for UNSCOPED'); } };
    const sessions = [{ _id: 'sid-1', session: { accountId: 'acct-x', workspaces: [
      { urlKey: 'acme', provider: 'linear', accessToken: 'some-token', tokenExpiresAt: Date.now() + 10_000_000 }
    ] } }];
    const result = await runResolveWorkspaceAccess({ urlKey: 'acme', ownerAccountId: UNSCOPED, sessions, accountStore: throwingStore });
    assert.equal(result.reason, 'ok', 'the call must complete without the throwing store ever being invoked');
  });
});

// ---------------------------------------------------------------------------
// LIN-2271 mutation-check: the chokepoint assertions above must actually
// catch their own removal. Mirrors lin-1885's convention — each mutation
// builds an in-memory mutated copy of SERVER_SRC and feeds it through the
// harness's `source` override; the on-disk server.js is never touched.
//
// Reproduced 2026-08-24 at a954dc0c:
//   sed -i '' '2012s/ownerAccountId = await accountStore/await accountStore/' server.js
//   node --test tests/unit/*.test.js -> 8119/8119 green. Restored via `git checkout -- server.js`.
// ---------------------------------------------------------------------------

function mutateServerSrc(mutator) {
  const body = extractResolveWorkspaceAccessBody(SERVER_SRC);
  const mutatedBody = mutator(body);
  assert.notEqual(mutatedBody, body, 'the mutation must actually change resolveWorkspaceAccess\'s body');
  const mutatedSource = SERVER_SRC.replace(body, mutatedBody);
  assert.notEqual(mutatedSource, SERVER_SRC, 'the mutated source must differ from SERVER_SRC — guards a rename/refactor that misses the target failing loudly instead of silently mutating nothing');
  return mutatedSource;
}

const GUARD_BLOCK = `  if (ownerAccountId !== UNSCOPED) {
    try {
      ownerAccountId = await accountStore.resolveCanonicalAccountId(ownerAccountId);
    } catch (err) {
      console.error(\`[workspace-access] canonical account resolution failed for \${urlKey}:\`, err);
      return { token: null, reason: 'store_unreachable', provider: null, credentialFingerprint: null };
    }
  }`;

describe('LIN-2271 mutation-check: the chokepoint assertions above must actually catch their own removal', () => {
  test('M1 (required) — drop the `ownerAccountId = ` assignment: Block C AC1 goes red', async () => {
    const mutated = mutateServerSrc(body => body.replace(
      'ownerAccountId = await accountStore.resolveCanonicalAccountId(ownerAccountId);',
      'await accountStore.resolveCanonicalAccountId(ownerAccountId);'
    ));
    const store = freshStore();
    const canonical = await store.createAccount();
    const merged = await store.createAccount();
    assert.ok((await store.mergeAccounts(canonical._id, merged._id)).ok);
    const sessions = [{ _id: 'sid-1', session: { accountId: canonical._id, workspaces: [
      { urlKey: 'acme', provider: 'linear', accessToken: 'canonical-live-token', tokenExpiresAt: Date.now() + 10_000_000 }
    ] } }];
    const result = await runResolveWorkspaceAccess({ urlKey: 'acme', ownerAccountId: merged._id, sessions, accountStore: store, source: mutated });
    assert.deepEqual({ token: result.token, reason: result.reason }, { token: null, reason: 'owner_mismatch' });
  });

  test('M2 (recommended) — delete the whole guard block: Block C AC1 goes red', async () => {
    const mutated = mutateServerSrc(body => body.replace(GUARD_BLOCK, ''));
    const store = freshStore();
    const canonical = await store.createAccount();
    const merged = await store.createAccount();
    assert.ok((await store.mergeAccounts(canonical._id, merged._id)).ok);
    const sessions = [{ _id: 'sid-1', session: { accountId: canonical._id, workspaces: [
      { urlKey: 'acme', provider: 'linear', accessToken: 'canonical-live-token', tokenExpiresAt: Date.now() + 10_000_000 }
    ] } }];
    const result = await runResolveWorkspaceAccess({ urlKey: 'acme', ownerAccountId: merged._id, sessions, accountStore: store, source: mutated });
    assert.deepEqual({ token: result.token, reason: result.reason }, { token: null, reason: 'owner_mismatch' });
  });

  test('M3 (recommended) — canonicalize AFTER the cache key is derived: return value stays green, but workspaceTokenCacheKey observes the MERGED (stale) owner', async () => {
    const mutated = mutateServerSrc(body => {
      const withoutGuard = body.replace(GUARD_BLOCK, '');
      return withoutGuard.replace(
        'const cacheKey = workspaceTokenCacheKey(urlKey, ownerAccountId);',
        `const cacheKey = workspaceTokenCacheKey(urlKey, ownerAccountId);\n${GUARD_BLOCK}`
      );
    });
    const store = freshStore();
    const canonical = await store.createAccount();
    const merged = await store.createAccount();
    assert.ok((await store.mergeAccounts(canonical._id, merged._id)).ok);
    const sessions = [{ _id: 'sid-1', session: { accountId: canonical._id, workspaces: [
      { urlKey: 'acme', provider: 'linear', accessToken: 'canonical-live-token', tokenExpiresAt: Date.now() + 10_000_000 }
    ] } }];
    const cacheKeyCalls = [];
    const result = await runResolveWorkspaceAccess({ urlKey: 'acme', ownerAccountId: merged._id, sessions, accountStore: store, source: mutated, cacheKeyCalls });
    assert.equal(result.reason, 'ok', 'sanity: the return value alone does NOT catch reordering — this is why Block B\'s text-order witness must stay');
    assert.equal(cacheKeyCalls[0], merged._id, 'workspaceTokenCacheKey must be shown observing the STALE (merged) owner under this mutation — the cache key is now derived before canonicalization runs, so it is keyed by the id the caller passed in, not the canonical id; this is exactly what a return-value-only assertion cannot see');
  });
});
