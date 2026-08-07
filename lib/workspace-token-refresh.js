/**
 * Refresh-on-resolve for the agent/proxy token path (LIN-1373; provider-aware
 * routing added LIN-1499 Phase 1; Linear moved to the durable store LIN-1524).
 *
 * Before LIN-1373, `resolveWorkspaceAccess` (server.js) only ever READ sessions
 * via the pure selector (lib/workspace-token-resolver.js) — a headless proxy
 * token stopped resolving the moment its creating human's access token lapsed,
 * because only human web activity (`ensureValidToken`, server.js) ever refreshed
 * it. This module is the caller-side refresh.
 *
 * Branches by `workspace.provider` (or, for the Linear arm, the durable
 * record's own `provider`), mirroring the arm-for-arm shape at `server.js`'s
 * `ensureValidToken`:
 *
 * - GitHub-family (`github`, `github-projects`) stays exactly as it was:
 *   session/binding-resident, found via the pure sibling selector
 *   `selectExpiredOwnerRow` (untouched — its GitHub-family arm needs no
 *   durable secret, LIN-1523/1524 scope boundary), re-minted from the App JWT
 *   + `installationId` via `remintActiveCredential`, persisted back to the
 *   session row.
 * - Linear (LIN-1524) no longer has a session row to find: `updateWorkspaceTokens`/
 *   `linkProvider` stopped writing `refreshToken` to the session entirely, so
 *   `selectExpiredOwnerRow`'s Linear arm (which requires `ws.refreshToken` on
 *   the row) is now structurally unreachable for it — a byte-identical,
 *   dead-in-practice branch, not a bug (its own A1-A8 tests still exercise the
 *   pure logic against hand-built fixtures that set the field directly). The
 *   REAL Linear arm here is a point-read against the durable store —
 *   `store.get(ownerAccountId, urlKey)` — the durable sibling of that session
 *   scan: same "is there something refreshable for this owner+workspace"
 *   question, asked of the other storage. Reached whenever the row isn't a
 *   GitHub-family one — covering BOTH a `session_expired` Linear row (which
 *   this arm ignores in favor of the durable record, now the sole source of
 *   truth) and `not_connected` (no session row at all, e.g. after logout).
 *   When the owner DOES still have a session row (the `session_expired`
 *   case), the fresh accessToken/tokenExpiresAt are mirrored into it as a
 *   pure cache via the separate pure sibling `selectOwnerSessionRow` (no
 *   refreshability filter — unlike `selectExpiredOwnerRow`, it only answers
 *   "does a row exist to mirror into") — never the refreshToken, and never
 *   required for the refresh itself to succeed.
 *
 * The provider instance is supplied by an INJECTED `resolveProvider`
 * dependency (never imported directly here) so this module keeps its
 * all-IO-injected contract and never couples to the import-order-sensitive
 * provider registry (lib/providers/registry.js).
 *
 * All IO is injected (refreshAccessToken, persistSession, resolveProvider,
 * store) so this is unit-testable with fakes and integration-testable
 * without booting server.js.
 */
import { selectExpiredOwnerRow, selectOwnerSessionRow } from './workspace-token-resolver.js';
import { remintActiveCredential, getWorkspaceCallScope } from './workspace.js';
import { calculateExpiresAt, isDefinitiveRevocation, TokenRefreshError } from './token-refresh.js';

// Per-(ownerAccountId, urlKey) single-flight for the LINEAR refresh + durable
// CAS core, mirroring lib/openrouter-catalog.js's inflight-promise coalescing
// precedent. Concurrent refreshes for the same owner's same workspace — across
// ALL THREE Linear refresh entrants (proactive-human `ensureValidToken`,
// reactive-401-human `handleTokenRefreshAndRetry`, and the headless resolve
// path here), unified in LIN-1546 from the previously headless-only coalescing —
// share one Linear round-trip and one durable write instead of racing to rotate
// the same refresh token (which would strand the loser with a spent,
// already-rotated one and, via LIN-1545's delete-on-EXPIRED guard, delete the
// winner's healthy credential). This closes the SAME-PROCESS race; cross-process
// (cross-dyno) races share no map and are the durable CAS + re-read's job below.
// The entry is removed once the refresh settles — success or failure — so a
// later, independent lapse still triggers its own refresh.
const inflight = new Map(); // `${ownerAccountId}::${urlKey}` -> Promise

async function doRefresh({ sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession, resolveProvider, store, fetchImpl, now }) {
  const row = selectExpiredOwnerRow(sessions, urlKey, ownerAccountId);

  // GitHub-family: unchanged, session/binding-resident (LIN-1523/1524 scope
  // boundary — no durable secret for this family, so the durable arm below
  // never applies to it).
  if (row && (row.provider === 'github' || row.provider === 'github-projects')) {
    const { sid, session, workspaceIndex } = row;
    const workspace = session.workspaces[workspaceIndex];
    await remintActiveCredential(workspace, resolveProvider(workspace), { fetchImpl, now });
    await persistSession(sid, session);
    // LIN-1891: scope is additive alongside the scalar token/provider return —
    // the structured {token, repo}/{token, scope} call scope this GitHub-family
    // workspace's headless resolution needs, mirroring getWorkspaceCallScope's
    // use on the session lane.
    return { token: workspace.accessToken, expiresAt: workspace.tokenExpiresAt, provider: workspace.provider, scope: getWorkspaceCallScope(workspace) };
  }

  // Linear-durable arm (LIN-1524): the durable record is the ONLY place a
  // rotating Linear credential lives now. `ownerAccountId` is guaranteed
  // non-UNSCOPED by the caller (server.js's resolveWorkspaceAccess), but may
  // still be a falsy real value (e.g. a legacy bootstrap token's
  // `createdBy: null`, LIN-1376) or a legacy pre-LIN-1329 session's missing
  // `session.accountId` never even reaches here in the first place — either
  // way `store.get` fails closed (its own accountId/urlKey guard) rather than
  // throwing, so this returns null exactly like "nothing to refresh" below.
  // LIN-1546: the durable read + Linear round-trip + rotation write is the
  // shared, single-flighted, race-safe core (CAS + re-read) that all three
  // refresh entrants funnel through — see `refreshLinearOwnerCredential`. Null
  // means "nothing refreshable" (no durable record with a refreshToken), which
  // this headless path surfaces exactly as before.
  const refreshed = await refreshLinearOwnerCredential({ ownerAccountId, urlKey, refreshAccessToken, store });
  if (!refreshed) return null;

  // Mirror accessToken/tokenExpiresAt (pure cache, NEVER refreshToken) into
  // the owner's own session row, if one exists — the same mirroring
  // `ensureValidToken` does on its own session-resident path, preserved here
  // even though this refresh was triggered off-session (e.g. a proxy token
  // resolving while the human's browser session sits idle). `sessions` was
  // already loaded by the caller for the (now largely dead-for-Linear)
  // `selectExpiredOwnerRow` scan above, so this reuses it — no extra read.
  // No row exists for a `not_connected` owner (e.g. post-logout): nothing to
  // mirror into, which is fine — the durable record alone is authoritative.
  const ownerRow = selectOwnerSessionRow(sessions, urlKey, ownerAccountId);
  if (ownerRow) {
    const ownerWorkspace = ownerRow.session.workspaces[ownerRow.workspaceIndex];
    ownerWorkspace.accessToken = refreshed.token;
    ownerWorkspace.tokenExpiresAt = refreshed.expiresAt;
    await persistSession(ownerRow.sid, ownerRow.session);
  }

  return { token: refreshed.token, expiresAt: refreshed.expiresAt, provider: refreshed.provider };
}

/**
 * The shared, single-flighted, race-safe LINEAR refresh + durable-rotation core
 * (LIN-1546, S4). ALL THREE Linear refresh entrants — proactive-human
 * `ensureValidToken`, reactive-401-human `handleTokenRefreshAndRetry` (both in
 * server.js), and the headless `doRefresh` above — funnel their Linear rotation
 * through this ONE seam, keyed `${ownerAccountId}::${urlKey}`. That unifies the
 * previously headless-only single-flight so a same-process human×headless
 * collision shares one refresh instead of racing to spend the same token.
 *
 * The coalesced promise owns exactly the shared, idempotent core: (i) the
 * durable read, (ii) the `refreshAccessToken` round-trip, (iii) the durable
 * compare-and-set write (`store.putIfRefreshToken`, keyed on the refreshToken we
 * read), and (iv) the re-read-on-`invalid_grant`/CAS-miss recovery. Per-request
 * work each entrant must NOT share — the human paths' session mirror onto their
 * own `req.session` workspace, the headless path's `selectOwnerSessionRow`
 * mirror — stays OUTSIDE this promise, in the caller, because the three entrants
 * mirror into three different objects (and the headless path may have no session
 * row at all).
 *
 * Return contract:
 * - `null` — no durable Linear record with a refreshToken (nothing to refresh);
 *   the caller keeps its own missing-credential behaviour.
 * - `{ token, expiresAt, refreshToken, provider, scope }` — success, INCLUDING a
 *   race loser that converged on the winner's freshly-rotated durable token
 *   (a *spurious* `EXPIRED` turned into a success by the re-read).
 * - throws `TokenRefreshError('EXPIRED')` — a GENUINE revocation that survived
 *   the re-read (the stored refreshToken is still the spent one nobody rotated),
 *   OR a record that vanished under us; so the human catches' LIN-1545 delete
 *   guard still fires — and fires ONLY — on a genuinely dead credential.
 * - throws any other `TokenRefreshError` (NETWORK/INVALID/UNKNOWN) untouched —
 *   a transient blip is never a race artifact, so it is never re-read, and the
 *   caller's transient-503 branch handles it exactly as before.
 *
 * @param {Object} deps
 * @param {string} deps.ownerAccountId - the owner the durable record is keyed on
 * @param {string} deps.urlKey - workspace url key
 * @param {Function} deps.refreshAccessToken - (refreshToken) => Promise<{access_token, refresh_token, expires_in}>
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} deps.store - the durable owner-credential store (CAS-capable)
 * @returns {Promise<{token: string, expiresAt: number, refreshToken: string, provider: string, scope: string}|null>}
 */
export function refreshLinearOwnerCredential({ ownerAccountId, urlKey, refreshAccessToken, store }) {
  const key = `${ownerAccountId}::${urlKey}`;
  let promise = inflight.get(key);
  if (!promise) {
    promise = doLinearRefresh({ ownerAccountId, urlKey, refreshAccessToken, store });
    inflight.set(key, promise);
    // Two-branch .then (not .finally) so the cleanup itself never produces an
    // unhandled rejection when doLinearRefresh throws — the caller's own
    // await/catch of `promise` (returned below) is what observes the failure.
    promise.then(
      () => { if (inflight.get(key) === promise) inflight.delete(key); },
      () => { if (inflight.get(key) === promise) inflight.delete(key); }
    );
  }
  return promise;
}

async function doLinearRefresh({ ownerAccountId, urlKey, refreshAccessToken, store }) {
  const record = await store.get(ownerAccountId, urlKey);
  if (!record?.refreshToken) return null;

  const attempted = record.refreshToken;
  let tokenData;
  try {
    tokenData = await refreshAccessToken(attempted);
  } catch (err) {
    // Re-read-on-`invalid_grant` (LIN-1546, the actual race fix). A *spurious*
    // `EXPIRED` means THIS entrant lost a rotation race — a concurrent winner
    // already spent `attempted` and rotated the durable record to a fresh
    // token. Only a DEFINITIVE revocation (`invalid_grant` → `EXPIRED`) can be
    // spurious this way; a transient NETWORK/INVALID/UNKNOWN blip is never a
    // race artifact, so re-read ONLY for `EXPIRED` and rethrow everything else
    // untouched (the caller's transient-503 branch is unchanged).
    if (isDefinitiveRevocation(err)) {
      const fresh = await store.get(ownerAccountId, urlKey);
      if (fresh?.refreshToken && fresh.refreshToken !== attempted) {
        return convergeOnStored(fresh);
      }
    }
    // Genuine revocation (nobody rotated — the stored token is still the spent
    // one) or a transient blip: surface it, so the human catches' LIN-1545
    // guard deletes ONLY a genuinely dead credential and 503s a transient.
    throw err;
  }

  const tokenExpiresAt = calculateExpiresAt(tokenData.expires_in);
  // Durable compare-and-set (LIN-1546, S3): write the rotated credential ONLY
  // if the stored refreshToken is still the one we spent. If it changed under
  // us — a concurrent rotation winner, or an OAuth re-login (the fourth writer,
  // out of scope for this seam) replaced the record — DON'T clobber the winner;
  // re-read and converge on whatever is durably stored now.
  const won = await store.putIfRefreshToken(ownerAccountId, urlKey, attempted, {
    provider: record.provider,
    scope: record.scope,
    token: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt
  });
  if (won) {
    return { token: tokenData.access_token, expiresAt: tokenExpiresAt, refreshToken: tokenData.refresh_token, provider: record.provider, scope: record.scope };
  }

  // CAS lost: the durable record changed between our read and our write. Re-read
  // and converge on the stored token (a concurrent rotation winner, or the
  // fourth writer's OAuth re-login, left a live credential to adopt).
  const fresh = await store.get(ownerAccountId, urlKey);
  if (fresh?.refreshToken) {
    return convergeOnStored(fresh);
  }
  // The CAS missed AND the re-read found nothing to converge on — a concurrent
  // disconnect deleted the record, or the store blipped on the write/re-read.
  // Crucially, we know the credential is NOT revoked: we just refreshed it
  // successfully against Linear. So this must NOT surface as `EXPIRED` — that
  // would let the human catches' LIN-1545 delete guard tear down a workspace
  // whose credential is actually alive (the pre-CAS unconditional `put` threw a
  // plain, non-definitive error here, and was correctly treated as such). Fail
  // this one request transiently instead: the credential and workspace survive,
  // and the next request re-reads and either finds the record gone (honest
  // disconnect) or refreshes cleanly.
  throw new TokenRefreshError('Owner credential rotation could not be persisted (record changed or unavailable)', 'UNKNOWN');
}

/** Shape a freshly re-read durable record as a successful refresh result. */
function convergeOnStored(record) {
  return { token: record.token, expiresAt: record.tokenExpiresAt, refreshToken: record.refreshToken, provider: record.provider, scope: record.scope };
}

/**
 * Refresh the owner's expired-or-disconnected credential — routed by provider
 * (see module docstring): GitHub-family from the session row, Linear from the
 * durable store. Returns `null` when there is nothing refreshable — no
 * GitHub-family session row AND no durable Linear record with a
 * `refreshToken` — so the caller should keep its existing failure result.
 * Throws (never persists) when a refresh was attempted but failed — a
 * `TokenRefreshError` from `refreshAccessToken`, a mint failure from
 * `resolveProvider(...).refreshCredential`, a `persistSession` failure, or a
 * `store.put` failure — so the caller falls through to the existing 503
 * rather than surfacing a 500 or caching a stale token.
 *
 * @param {Object} deps
 * @param {Array} deps.sessions - raw session rows (sessionsCollection.find({}).toArray()); GitHub-family arm only
 * @param {string} deps.urlKey - workspace url key being resolved
 * @param {string} deps.ownerAccountId - the proxy token's owning account (never UNSCOPED)
 * @param {Function} deps.refreshAccessToken - (refreshToken) => Promise<{access_token, refresh_token, expires_in}>; Linear arm only
 * @param {Function} deps.persistSession - (sid, session) => Promise<void>; must NOT roll the session's TTL (see server.js's persistSessionRow); GitHub-family arm only
 * @param {Function} deps.resolveProvider - (workspace) => Provider; resolves the provider instance for the GitHub-family minting arm (e.g. getProviderForWorkspace). Injected, never imported, so this module stays IO-free and decoupled from the import-order-sensitive provider registry.
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} deps.store - LIN-1524: the durable owner-credential store — Linear's sole rotating-credential home, read AND written here (point-read + point-write, keyed on `(ownerAccountId, urlKey)`).
 * @param {Function} [deps.fetchImpl] - test seam forwarded to the provider's refreshCredential (deterministic network stub)
 * @param {number} [deps.now] - test seam forwarded to the provider's refreshCredential (deterministic clock, epoch ms)
 * @returns {Promise<{token: string, expiresAt: number, provider: string}|null>}
 */
export async function refreshOwnerWorkspaceToken({ sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession, resolveProvider, store, fetchImpl, now }) {
  // LIN-1546: single-flight coalescing moved DOWN into the shared Linear seam
  // (`refreshLinearOwnerCredential`, invoked from doRefresh's Linear arm) so the
  // two human entrants can share it too — coalescing here as well would
  // double-register on the same `${ownerAccountId}::${urlKey}` key and DEADLOCK
  // (the inner seam would await this outer promise, which is awaiting it). The
  // GitHub-family re-mint arm is idempotent (re-minted from installationId, no
  // spent-token hazard), so it does not need coalescing to be correct; this is
  // an accepted, low-risk behaviour change (previously the whole resolve was
  // coalesced, now only the Linear rotation core is).
  return doRefresh({ sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession, resolveProvider, store, fetchImpl, now });
}

/** Test-only: clear in-flight single-flight state between specs. */
export function _resetInflightForTests() {
  inflight.clear();
}
