/**
 * LIN-2237 (Ticket E of the LIN-2231 design) — the L6 verification suite.
 *
 * This file owns the L6 items not already covered by their owning ticket's
 * own test file, plus a coverage map for the ones that are (per this
 * ticket's own AC: "each independently attributable to the ticket (A–D) it
 * verifies" — attribution below is a pointer, not a duplicate):
 *
 *   1. Fork-prevention          → tests/unit/account-identity.test.js
 *                                  ("L6 test 1", Ticket A)
 *   2. Conflict boundary        → tests/unit/account-identity.test.js
 *                                  ("L6 test 2", Ticket A)
 *   3. Merge-then-resolve       → THIS FILE (below) — the one L6 item with
 *                                  no existing home: it needs Ticket A's
 *                                  mergeAccounts (write) AND Ticket B's
 *                                  resolveCanonicalAccountId/chokepoint-order
 *                                  (read) composed together, which neither
 *                                  ticket's own test file does on its own.
 *   4. Durable-record invariant → the MERGE-path half already lives in
 *                                  account-identity.test.js's "confirmed
 *                                  merge" test; the LINK-path half was a real
 *                                  gap, added directly onto "L6 test 1" in
 *                                  the same commit as this file.
 *   5. Mutation-gate coverage   → see the coverage map at the bottom of this
 *                                  file, auditing each Ticket A–D
 *                                  change against its own revert-sensitive
 *                                  test.
 *
 * Run with: node --test tests/unit/lin2231-l6-verification.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { selectOwnerWorkspaceToken } from '../../lib/workspace-token-resolver.js';

const NOW = Date.now();
const FAR_FUTURE_MS = 10_000_000;

describe('LIN-2231 L6 item 3 — merge-then-resolve (Ticket E, composing Ticket A\'s write + Ticket B\'s read)', () => {
  let dbClient, dbDir, counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'l6-merge-resolve-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStores() {
    const db = dbClient.db(`l6_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
      proxyTokenStore: new ProxyTokenStore({ collection: db.collection('proxy-tokens') }),
    };
  }

  test('a proxy token minted BEFORE the merge, createdBy the MERGED (non-canonical) account, resolves — via canonicalize-then-select, the exact sequence resolveWorkspaceAccess (server.js) runs — to the CANONICAL account\'s live session credential, with ZERO mutation of the token\'s own createdBy', async () => {
    const stores = freshStores();
    const canonical = await stores.accountStore.createAccount();
    const merged = await stores.accountStore.createAccount();

    // Minted while `merged` was still its own live account — exactly the
    // shape of every pre-existing dispatch/proxy token the LIN-2231 incident
    // stranded (comment be582d98's L2.3 one-time repair scenario, generalized
    // to the ordinary confirmed-merge path this test drives instead).
    const minted = await stores.proxyTokenStore.createToken('acme', { createdBy: merged._id, kind: 'standard' });

    // The canonical account's own live session for this workspace — what a
    // successful merge is supposed to make the merged token's holder reach.
    const sessions = [{
      _id: 'sid-1',
      session: { accountId: canonical._id, workspaces: [{ urlKey: 'acme', provider: 'linear', accessToken: 'canonical-live-token', tokenExpiresAt: NOW + FAR_FUTURE_MS }] },
    }];

    // Ticket A's write: confirm the merge (canonical absorbs merged).
    const mergeResult = await stores.accountStore.mergeAccounts(canonical._id, merged._id);
    assert.ok(mergeResult.ok);

    // Ticket B's read, composed here in the SAME order server.js's
    // resolveWorkspaceAccess actually runs it (canonicalize BEFORE the
    // selector — see tests/unit/canonical-account-resolution.test.js's own
    // Block B witness for the wiring proof; this test proves the composed
    // BEHAVIOUR that wiring produces, using the token's real createdBy as
    // the caller-supplied ownerAccountId, exactly as
    // routes/proxy.js's authenticateProxyToken threads req.proxyCreatedBy).
    const rawTokenDocBefore = await stores.proxyTokenStore.collection.findOne({ _id: minted.tokenId });
    assert.equal(rawTokenDocBefore.createdBy, merged._id, 'sanity check: the token really was minted under the merged account');

    const canonicalizedOwnerId = await stores.accountStore.resolveCanonicalAccountId(rawTokenDocBefore.createdBy);
    assert.equal(canonicalizedOwnerId, canonical._id, 'the merged token\'s owner resolves through mergedInto to canonical');

    const selected = selectOwnerWorkspaceToken(sessions, 'acme', canonicalizedOwnerId);
    assert.equal(selected.token, 'canonical-live-token', 'reaches the canonical account\'s live credential');
    assert.equal(selected.reason, 'ok');

    // Zero token mutation (L3's audit-trail guarantee): the durable proxy
    // token document's createdBy is STILL the merged account id.
    // Canonicalization is resolution-time only — it never rewrites the mint-
    // time stamp.
    const rawTokenDocAfter = await stores.proxyTokenStore.collection.findOne({ _id: minted.tokenId });
    assert.equal(rawTokenDocAfter.createdBy, merged._id, 'createdBy stays immutable at mint, even after the account it names was merged away');

    // And the session's own credential bytes are untouched — resolution
    // reads, it never writes a session.
    assert.equal(sessions[0].session.workspaces[0].accessToken, 'canonical-live-token');
  });

  test('the SAME merged-token scenario, before the merge exists, fails closed rather than borrowing the canonical account\'s token (the negative control — proves the positive case above is the merge doing the work, not the selector being owner-blind)', async () => {
    const stores = freshStores();
    const canonical = await stores.accountStore.createAccount();
    const merged = await stores.accountStore.createAccount();
    // No mergeAccounts call this time.
    const sessions = [{
      _id: 'sid-1',
      session: { accountId: canonical._id, workspaces: [{ urlKey: 'acme', provider: 'linear', accessToken: 'canonical-live-token', tokenExpiresAt: NOW + FAR_FUTURE_MS }] },
    }];

    const canonicalizedOwnerId = await stores.accountStore.resolveCanonicalAccountId(merged._id);
    assert.equal(canonicalizedOwnerId, merged._id, 'an UNmerged account resolves to itself — nothing to canonicalize yet');

    const selected = selectOwnerWorkspaceToken(sessions, 'acme', canonicalizedOwnerId);
    assert.equal(selected.token, null, 'without a merge, the merged account has no live session of its own, and never borrows the canonical account\'s (LIN-1366 owner isolation)');
    assert.equal(selected.reason, 'not_connected');
  });
});

// ---------------------------------------------------------------------------
// L6 item 5 — mutation-gate coverage map
// ---------------------------------------------------------------------------
//
// Per this ticket's AC: every new/changed function from Tickets A–D needs a
// test that FAILS if the change is reverted, not just a happy-path
// assertion. Audited below — each row names the change, where its
// revert-sensitive test lives, and WHY that test would actually fail (not
// just pass vacuously) if the change were reverted. This is a coverage
// audit, not new test code — duplicating the referenced tests here would
// itself violate the "not vacuous" bar by testing the test, not the code.
//
// Ticket A (LIN-2233):
//   - establishAccount's carried-accountId branch (routes/auth.js mode:'new')
//     → account-identity.test.js "L6 test 1": revert removes the carry, the
//       second front-door login mints a SECOND account instead of linking —
//       `account.identities.length === 2` on ONE account fails.
//   - AccountStore.mergeAccounts
//     → account-identity.test.js's "merge semantics" block: revert removes
//       mergedInto/rebind/identities-untouched — each assertion targets a
//       specific field mergeAccounts itself writes.
//   - amendment A1 (fresh dual-auth) / A2 (session canonicalization)
//     → account-identity.test.js's A1/confirmed-merge tests: revert removes
//       isFreshlyAuthenticated's gate or the post-confirm session.accountId
//       write — both asserted directly.
//   - the one-time repair script's dry-run/--execute gate
//     → tests/unit/repair-account-merge-lin2233.test.js (PR #1185's own
//       suite, pre-existing at HEAD): revert removes the `execute` guard,
//       dry-run-writes-nothing assertion fails.
//
// Ticket B (LIN-2234):
//   - AccountStore.resolveCanonicalAccountId
//     → canonical-account-resolution.test.js Block A: multi-hop/cycle/
//       depth-cap cases fail without the walk-to-fixed-point loop; the
//       null-no-lookup case fails without the early return.
//   - resolveWorkspaceAccess chokepoint wiring (server.js)
//     → canonical-account-resolution.test.js Block B (source-position
//       witness) + THIS FILE's merge-then-resolve test (behavioural):
//       revert the ORDER (canonicalize after the cache key instead of
//       before) and the witness's `resolveIdx < cacheKeyIdx` fails; revert
//       the call entirely and canonical-account-resolution.test.js's Block C
//       (LIN-2271, behavioural vm harness) fails — it drives the real
//       resolveWorkspaceAccess and asserts both the returned token/reason and
//       the owner observed by workspaceTokenCacheKey.
//
// Ticket C (LIN-2235):
//   - spend-intent journal (markSpendIntent/clearSpendIntent/pendingSpend)
//     → credential-durability.test.js Block B: the fault-injection test
//       (AC1) fails without the marker surviving a mid-flight crash; AC1b
//       fails without the grace-window check (would try to replay forever
//       instead of throwing EXPIRED).
//   - mirror-into-every-live-row (selectAllOwnerSessionRows)
//     → credential-durability.test.js Blocks C/D: revert to the single-row
//       selector and the "every row carries the fresh token" assertion
//       fails for the non-latest-expiring row.
//
// Ticket D (LIN-2236):
//   - logEvent's 401→401||503 widening
//     → credential-lifecycle-observability.test.js Block C: the regex
//       witness fails against the un-widened guard.
//   - logCredentialRejection's credentialSource:'none' fix
//     → same file, Block C: fails against the un-fixed `descriptor ?? {}`.
//   - refresh_skip (all 3 branches) / refresh_fail / refresh_success /
//     spend_intent event wiring
//     → same file, Block B: each asserts the SPECIFIC kind/detail a revert
//       of its call site would stop emitting.
//   - credential-invariant-sweep
//     → same file, Block D: the missing/expired/merged-account cases each
//       fail without their corresponding branch in
//       findCredentialInvariantViolations.
