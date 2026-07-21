/**
 * LIN-1524 beat 3 corrective — regression pin, NOT a fix.
 *
 * Beat 3's report claimed a legacy pre-LIN-1329 session with no `accountId`
 * degrades on durable read-miss to "exactly today's pre-cutover failure mode
 * when refreshAccessToken(undefined) would have thrown." That claim is WRONG,
 * verified against the actual pre-cutover code (server.js at commit
 * d83992b1, before beat 3's changes):
 *
 *   - `ensureValidToken`'s Linear branch was
 *     `refreshAccessToken(workspace.refreshToken)` — read directly off the
 *     SESSION, with no dependency on `accountId` at all.
 *   - `handleUnauthorizedError`'s 401 gate was `if (workspace.refreshToken)`
 *     — same thing, provider-blind but accountId-blind too.
 *   - `updateWorkspaceTokens` (pre-beat-3) rotated and re-persisted
 *     `workspace.refreshToken` on every successful refresh, so a pre-LIN-1329
 *     session that has been in continuous use has a REAL, CURRENTLY-WORKING
 *     refresh token sitting on its session row right now — not `undefined`.
 *   - Nothing backfills `accountId` onto an already-signed-in session:
 *     `establishAccount` is only ever called at fresh sign-in (OAuth
 *     callback, PAT auto-login, GitHub/GitHub Projects callbacks, local
 *     create) — grepped every call site, none fire on ordinary page
 *     navigation for an existing session. No migration script touches the
 *     sessions collection either (LIN-1329's own commit only changes
 *     route/session-establishment code).
 *
 * So: pre-cutover, this exact session refreshes SUCCESSFULLY (it has a real
 * refreshToken; accountId is irrelevant to that path). Post-cutover (beat 3),
 * `ensureValidToken`/`handleUnauthorizedError` consult ONLY the durable store,
 * keyed on `accountId` — which this session doesn't have — so the durable
 * lookup misses and the workspace gets DELETED where it would previously have
 * just refreshed. This is a real, live (not hypothetical) regression, bounded
 * to sessions created before 2026-07-15 that are still active within their
 * 30-day rolling TTL (worst case ~2026-08-14), affecting BOTH the proactive
 * refresh path and the 401-retry path.
 *
 * This file does NOT fix that — the remedy is a genuine trade-off (a bounded
 * legacy session-refreshToken fallback vs. accepting the bounded regression)
 * that needs a human decision, not a unilateral pick. See the LIN-1524
 * comment thread (beat 3 corrective, 2026-07-21) for the options laid out.
 * This file exists so the gap is pinned, discoverable, and cannot silently
 * regress further (or get silently "fixed" one way) without that decision
 * being revisited.
 *
 * Run with: node --test tests/unit/lin-1524-legacy-no-accountid-regression.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('LIN-1524 beat 3 corrective: legacy no-accountId session regression (pinned, unresolved)', () => {
  test('the durable store genuinely cannot resolve a credential for a session with no accountId, even one carrying a real (pre-cutover-style) refreshToken', async () => {
    // Simulates the exact population: a legacy session whose OWN refreshToken
    // is real and would work if used directly (pre-cutover behaviour), but
    // whose accountId was never backfilled.
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

    assert.equal(record, null, 'the durable store has (and can have) nothing for this session — it was never accountId-keyable');
    // The session's own refreshToken, which pre-cutover code read directly
    // and would have refreshed successfully with, is sitting right there —
    // but LIN-1524's new ensureValidToken/handleUnauthorizedError code never
    // looks at workspace.refreshToken at all anymore (see the source-text
    // assertions below), so this real credential goes unused and the
    // workspace is deleted instead of refreshed.
    assert.equal(legacyWorkspace.refreshToken, 'a-real-still-working-refresh-token', 'a real, usable credential exists and is being ignored');
  });

  test('ensureValidToken\'s Linear branch no longer reads workspace.refreshToken anywhere (confirms the regression is structural, not incidental)', () => {
    const startIdx = SERVER_SRC.indexOf('async function ensureValidToken(req, res, next) {');
    assert.notEqual(startIdx, -1, 'expected to find ensureValidToken in server.js');
    const endIdx = SERVER_SRC.indexOf('\n// Apply middleware to all routes except auth and logout', startIdx);
    assert.notEqual(endIdx, -1, 'expected to find the end of ensureValidToken');
    const body = SERVER_SRC.slice(startIdx, endIdx);

    assert.doesNotMatch(
      body,
      /refreshAccessToken\(workspace\.refreshToken\)/,
      'ensureValidToken must not read workspace.refreshToken directly (LIN-1524 moved this to the durable store) — ' +
      'if this now matches, either the regression this file pins has been fixed (update/remove this test and the ' +
      'LIN-1524 comment thread) or something reverted the cutover unintentionally'
    );
  });

  test('handleUnauthorizedError\'s 401 gate no longer reads workspace.refreshToken anywhere (confirms the regression is structural, not incidental)', () => {
    const startIdx = SERVER_SRC.indexOf('async function handleUnauthorizedError(workspace, session, teamId, openRouterSource, res) {');
    assert.notEqual(startIdx, -1, 'expected to find handleUnauthorizedError in server.js');
    const endIdx = SERVER_SRC.indexOf('\n/**\n * Home page', startIdx);
    assert.notEqual(endIdx, -1, 'expected to find the end of handleUnauthorizedError (the next route\'s docstring)');
    const body = SERVER_SRC.slice(startIdx, endIdx);

    assert.doesNotMatch(
      body,
      /if \(workspace\.refreshToken\)/,
      'handleUnauthorizedError must not gate on workspace.refreshToken directly anymore (LIN-1524 re-pointed at the durable record) — ' +
      'if this now matches, either the regression this file pins has been fixed (update/remove this test and the ' +
      'LIN-1524 comment thread) or something reverted the cutover unintentionally'
    );
  });
});
