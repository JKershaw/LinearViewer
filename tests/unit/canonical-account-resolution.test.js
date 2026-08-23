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
import { MangoClient } from '@jkershaw/mangodb';
import { AccountStore } from '../../lib/account-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

// ---------------------------------------------------------------------------
// Block A — AccountStore.resolveCanonicalAccountId (behavioural)
// ---------------------------------------------------------------------------

describe('AccountStore.resolveCanonicalAccountId (LIN-2234, Block A — behavioural)', () => {
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
});
