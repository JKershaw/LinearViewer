/**
 * LIN-1524 — accepted behaviour: a legacy pre-LIN-1329 session with no
 * `accountId` loses its workspace on next refresh, and that is DECIDED, not
 * overlooked.
 *
 * **This documents a deliberate trade-off, not an outstanding defect.** Read
 * this file's docstring before "fixing" the behaviour it pins — doing so
 * without revisiting the decision below would silently reverse a call the
 * ticket owner already made.
 *
 * ## What happens
 *
 * A session created before 2026-07-15 (LIN-1329, "route all five sign-in
 * paths through the linkIdentity seam") that has no `accountId` — because
 * nothing backfills one onto an already-signed-in session; `establishAccount`
 * only ever fires at fresh sign-in — still carries a real, currently-working
 * `refreshToken` on its session row (pre-cutover `updateWorkspaceTokens` kept
 * rotating and re-persisting it on every successful refresh). Pre-LIN-1524,
 * such a session refreshed successfully forever, because `ensureValidToken`/
 * `handleUnauthorizedError` read that session-side `refreshToken` directly,
 * with no dependency on `accountId`.
 *
 * Post-LIN-1524, Linear's rotating credential lives ONLY in the durable
 * store, keyed on `(accountId, urlKey)`. A session with no `accountId` is a
 * guaranteed durable read-miss, so the NEXT refresh attempt (proactive, via
 * `ensureValidToken`, or reactive, via the 401 retry in
 * `handleUnauthorizedError`) fails and the workspace is removed —
 * `ensureValidToken`'s catch block / `handleWorkspaceRemoval`, same paths a
 * genuine credential failure always took.
 *
 * ## Why this is accepted, not a bug (decision recorded on LIN-1524, 2026-07-21)
 *
 * Options were laid out — (A) accept the bounded regression, (B) add a
 * legacy session-`refreshToken` fallback on durable read-miss, (C) backfill
 * `accountId` inline — and the ticket owner chose **A**, explicit reasoning:
 * this deployment has effectively one user (the owner), whose remedy is a
 * single re-authentication; paying B's architectural cost (reintroducing a
 * *read* of session-side `refreshToken`, in direct tension with this ticket's
 * own "no phantom Linear refreshToken may survive anywhere" line) to protect
 * a population that doesn't exist here is the worse trade.
 *
 * **Self-expiry:** bounded to sessions predating 2026-07-15 that are still
 * within their 30-day rolling TTL (`lib/session-store.js`) — worst case
 * **~2026-08-14**. After that date this population is structurally gone and
 * this file (and the behaviour it documents) can be retired.
 *
 * ## What this file guarantees
 *
 * Fails loudly if the accepted behaviour drifts in EITHER direction:
 * - if a durable record somehow became resolvable for a no-`accountId`
 *   session (it shouldn't — there's no key to resolve it under), or
 * - if `ensureValidToken`/`handleUnauthorizedError` started reading
 *   `workspace.refreshToken` again (that would be option B, landing without
 *   the decision being revisited).
 * Either change should come with an update to this file's docstring and the
 * LIN-1524 comment thread, not a silent pass/fail flip.
 *
 * Run with: node --test tests/unit/lin-1524-legacy-no-accountid-accepted-behaviour.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('LIN-1524 accepted behaviour: legacy no-accountId session loses its workspace on next refresh (decision: option A, 2026-07-21)', () => {
  test('the durable store has nothing resolvable for a no-accountId session, even one carrying a real (pre-cutover-style) refreshToken — this is the accepted trade-off, not a store bug', async () => {
    // Simulates the exact population: a legacy session whose OWN refreshToken
    // is real and would have refreshed successfully pre-cutover, but whose
    // accountId was never backfilled (and never will be — no migration, no
    // backfill-on-activity path).
    const store = new OwnerCredentialStore({
      collection: {
        async findOne() { throw new Error('must not be reached — accountId is falsy, the store fails closed before any query'); },
      },
    });

    const legacyWorkspace = {
      id: 'ws-legacy', urlKey: 'acme-legacy', provider: 'linear',
      accessToken: 'stale-but-was-fine', refreshToken: 'a-real-still-working-refresh-token',
      tokenExpiresAt: Date.now() - 10_000,
    };

    // No accountId at all — the defining property of this population.
    const record = await store.get(undefined, legacyWorkspace.urlKey);

    assert.equal(record, null, 'the durable store has (and can have) nothing for this session — it was never accountId-keyable, by design');
    // The session's own refreshToken is sitting right there, real and
    // working — accepted-behaviour means it is DELIBERATELY never consulted
    // (see the source-text assertions below), not that it doesn't exist.
    assert.equal(legacyWorkspace.refreshToken, 'a-real-still-working-refresh-token', 'a real, usable credential exists and is deliberately not read');
  });

  test('ensureValidToken\'s Linear branch does not read workspace.refreshToken — accepted, per the option-A decision (do not reintroduce this as a "fix" without revisiting LIN-1524)', () => {
    const startIdx = SERVER_SRC.indexOf('async function ensureValidToken(req, res, next) {');
    assert.notEqual(startIdx, -1, 'expected to find ensureValidToken in server.js');
    const endIdx = SERVER_SRC.indexOf('\n// Apply middleware to all routes except auth and logout', startIdx);
    assert.notEqual(endIdx, -1, 'expected to find the end of ensureValidToken');
    const body = SERVER_SRC.slice(startIdx, endIdx);

    assert.doesNotMatch(
      body,
      /refreshAccessToken\(workspace\.refreshToken\)/,
      'ensureValidToken reading workspace.refreshToken again would be option B (a legacy session-refreshToken fallback), ' +
      'which the ticket owner explicitly DECLINED on 2026-07-21 — if this now matches, either that decision was ' +
      'revisited (update this file\'s docstring and the LIN-1524 thread) or the cutover was unintentionally reverted'
    );
  });

  test('handleUnauthorizedError\'s 401 gate does not read workspace.refreshToken — accepted, per the option-A decision (do not reintroduce this as a "fix" without revisiting LIN-1524)', () => {
    const startIdx = SERVER_SRC.indexOf('async function handleUnauthorizedError(workspace, session, teamId, openRouterSource, res) {');
    assert.notEqual(startIdx, -1, 'expected to find handleUnauthorizedError in server.js');
    const endIdx = SERVER_SRC.indexOf('\n/**\n * Home page', startIdx);
    assert.notEqual(endIdx, -1, 'expected to find the end of handleUnauthorizedError (the next route\'s docstring)');
    const body = SERVER_SRC.slice(startIdx, endIdx);

    assert.doesNotMatch(
      body,
      /if \(workspace\.refreshToken\)/,
      'handleUnauthorizedError gating on workspace.refreshToken again would be option B, which the ticket owner ' +
      'explicitly DECLINED on 2026-07-21 — if this now matches, either that decision was revisited (update this ' +
      'file\'s docstring and the LIN-1524 thread) or the cutover was unintentionally reverted'
    );
  });
});
