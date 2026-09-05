import { getBindingsForWorkspace, getWorkspaceCallScope } from './workspace.js';
import { SENTINEL_EXPIRY_FLOOR_MS } from './credential-diagnostics.js';

// workspace-token-resolver.js: pure selector extracted from server.js's
// resolveWorkspaceAccess (LIN-1366). The proxy previously resolved a workspace's
// Linear access token owner-blind — any session referencing the urlKey could win,
// so one connected user's proxy token could read/write under another user's Linear
// identity. This selector scopes token selection to the owning account
// (req.proxyCreatedBy, threaded in by server.js/routes/proxy.js) and fails closed
// when no token for that owner exists, mirroring this repo's LIN-1352/1353
// lib/openrouter-key-resolver.js precedent for extracting owner-scoped selection
// into a testable pure module.
//
// `sessions` is the raw array from sessionsCollection.find({}).toArray() — each row's
// `.session` is the persisted express-session blob (string or already-parsed object)
// carrying `accountId` and `workspaces[]` ({ urlKey, provider, accessToken,
// tokenExpiresAt }), the same shape resolveWorkspaceAccess has always scanned.
//
// UNSCOPED marks the legacy owner-blind call path (getWorkspaceAccessToken /
// routes/test.js): passing it reproduces byte-identical legacy selection — the
// latest-expiring token among ALL sessions referencing urlKey, no owner filter.
export const UNSCOPED = Symbol('workspace-token-resolver.UNSCOPED');

// Same buffer resolveWorkspaceAccess has always used before this extraction
// (server.js's TOKEN_REFRESH_BUFFER_MS) — duplicated here so this module stays a
// pure function of its three arguments, with no import back into server.js.
// Exported (LIN-2097) so lib/workspace-token-refresh.js's refresh-result
// liveness check uses the SAME threshold every selector here already uses,
// rather than a fourth hand-duplicated copy.
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

function parseSessionData(row) {
  return typeof row.session === 'string' ? JSON.parse(row.session) : row.session;
}

// The provider (e.g. 'linear') is a property of the workspace, not of whichever
// account's token wins selection — resolved owner-blind from ANY session that
// referenced urlKey, even one belonging to a different account or carrying an
// expired token, so the proxy's pre-token capability gate on writes always sees it,
// including on a fail-closed result.
function seenProviderFor(sessions, urlKey) {
  for (const row of sessions) {
    const data = parseSessionData(row);
    const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
    if (ws?.provider) return ws.provider;
  }
  return null;
}

// A GitHub-family binding's `installationId` (the re-mint key) lives on the
// binding's own `credentials`, never mirrored onto the workspace's legacy
// scalar fields (lib/workspace.js's linkProvider only mirrors token/
// refreshToken/tokenExpiresAt). Finds the ACTIVE binding the same way
// remintActiveCredential does — by mirrored token, falling back to the first
// binding for the active provider — and reads its installationId.
function findActiveInstallationId(workspace) {
  const bindings = getBindingsForWorkspace(workspace);
  const active =
    bindings.find(b => b.provider === workspace.provider && b.credentials?.token === workspace.accessToken) ||
    bindings.find(b => b.provider === workspace.provider) ||
    bindings[0];
  return active?.credentials?.installationId;
}

// LIN-1982: a finite, real expiry always outranks a SENTINEL one
// (Number.MAX_SAFE_INTEGER — GitHub-family / Jira Basic bindings with no
// real expiry) in `selectOwnerWorkspaceToken`'s ranking below. Comparing raw
// magnitude let a sentinel mirrored onto this owner's OWN session row (e.g.
// by LIN-1981's `linkProvider` mis-mirror) win selection PERMANENTLY over an
// actively-refreshed Linear token — unbeatable by a token refresh (a fresh
// `now+24h` always loses to a fake "never") and unbeatable by reconnecting
// the workspace. A sentinel still wins when it is the ONLY eligible
// candidate (the ordinary, correct case for a Local/PAT/Basic-only
// workspace) — this only changes the outcome when a genuine finite
// candidate is ALSO in the running for the same (urlKey, ownerAccountId).
function isSentinelExpiry(expiresAt) {
  return expiresAt >= SENTINEL_EXPIRY_FLOOR_MS;
}

// True if `candidateExpiresAt` should replace the current best
// (`bestExpiry`, `null` meaning "no candidate yet"). Tier 1: any finite
// expiry beats any sentinel, regardless of magnitude (LIN-1982, see above).
// Tier 2: within the same tier (both finite or both sentinel), the larger
// (later-expiring / more-recently-refreshed) one wins — the pre-existing
// rule, preserved.
function isBetterCandidate(candidateExpiresAt, bestExpiry) {
  if (bestExpiry === null) return true;
  const candidateIsSentinel = isSentinelExpiry(candidateExpiresAt);
  const bestIsSentinel = isSentinelExpiry(bestExpiry);
  if (candidateIsSentinel !== bestIsSentinel) return !candidateIsSentinel;
  return candidateExpiresAt > bestExpiry;
}

// selectOwnerWorkspaceToken(sessions, urlKey, ownerAccountId): resolves the
// workspace access token to use for `urlKey`, scoped to `ownerAccountId` unless it
// is the UNSCOPED sentinel. Returns { token, reason, provider, scope } — `scope`
// (LIN-1891) is the winning row's structured provider call scope
// (getWorkspaceCallScope(ws)), additive alongside the scalar `token`: a bare
// token string for linear/local (byte-identical to `token`) or a structured
// `{token, repo}` / `{token, scope}` / `{email, apiToken, site}` object for
// github/github-projects/jira. `token`'s own meaning is unchanged by this.
//
//   ok               → token present (the owner's own best candidate: a real,
//                       finite-expiry token if one is eligible, the
//                       longest-lived among ties otherwise — LIN-1982's
//                       finite-beats-sentinel rule, see isBetterCandidate)
//   session_expired  → the owner (or, when UNSCOPED, any session) referenced this
//                       workspace but every such token is expired — re-auth
//   not_connected    → no matching session references this workspace at all
//   token_ownerless  → an explicit owner was null/empty: the CALLER's token carries
//                       no owner stamp, so it can never resolve (never borrows
//                       another account's token). LIN-1448 — see below
export function selectOwnerWorkspaceToken(sessions, urlKey, ownerAccountId = UNSCOPED) {
  const scoped = ownerAccountId !== UNSCOPED;
  const seenProvider = seenProviderFor(sessions, urlKey);

  // An explicit null/empty owner (e.g. a legacy bootstrap token's createdBy: null)
  // can never match a real accountId. Fail closed here, before any scan for a
  // token, so it can never fall through to owner-blind selection.
  //
  // LIN-1448: this returns its OWN reason rather than `not_connected`. Selection
  // is unchanged — the change is purely diagnostic, and it is load-bearing. The
  // two failures are opposites: `not_connected` is a fact about the WORKSPACE
  // (nobody has connected it) whose remedy is to connect it, while this is a fact
  // about the CALLER'S TOKEN (it was minted without an owner) on a workspace that
  // is very often perfectly healthy. Collapsing them cost ~100 minutes on
  // 2026-07-25 (LIN-1576): owned tokens served 192×200 through the whole window
  // while ownerless ones took 15×503, and four sessions independently read the
  // shared code as "a human must reconnect the workspace" — a remedy that could
  // never have helped, and that the owner acted on twice. `createdBy` presence is
  // a one-field check available at the exact moment of failure; spending a
  // distinct reason on it is the cheapest possible fix for that misdirection.
  if (scoped && !ownerAccountId) {
    return { token: null, reason: 'token_ownerless', provider: seenProvider };
  }

  let bestToken = null;
  let bestExpiry = null;
  let bestProvider = null;
  let bestScope = null;
  let sawMatch = false;

  for (const row of sessions) {
    const data = parseSessionData(row);
    if (scoped && data?.accountId !== ownerAccountId) continue;
    const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
    if (!ws) continue;
    sawMatch = true;
    if (ws.accessToken && ws.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      if (isBetterCandidate(ws.tokenExpiresAt, bestExpiry)) {
        bestToken = ws.accessToken;
        bestExpiry = ws.tokenExpiresAt;
        bestProvider = ws.provider || null;
        bestScope = getWorkspaceCallScope(ws);
      }
    }
  }

  if (bestToken) {
    return { token: bestToken, expiresAt: bestExpiry, reason: 'ok', provider: bestProvider, scope: bestScope };
  }

  return { token: null, reason: sawMatch ? 'session_expired' : 'not_connected', provider: seenProvider };
}

// selectExpiredOwnerRow(sessions, urlKey, ownerAccountId): a pure sibling of
// selectOwnerWorkspaceToken, added for LIN-1373's refresh-on-resolve fix.
// selectOwnerWorkspaceToken itself is left byte-identical (its A1-A7 tests stay
// green) — this is a separate read over the same session rows, used by
// lib/workspace-token-refresh.js to find what to refresh, never by the
// resolver's own selection path.
//
// Locates the owner's own row for `urlKey` whose token is expired (or
// expiring within the same TOKEN_REFRESH_BUFFER_MS buffer the selector uses)
// but which is still refreshable. Among the owner's matching rows, picks the
// latest-expiring one (mirroring the live selector's own tie-break) so a
// long-abandoned session doesn't win over a more recently-active one. Returns
// null when there is nothing refreshable: no owner, no session for this
// workspace, only still-live tokens, or an expired token with no way to
// refresh it.
//
// Refreshability is provider-aware (LIN-1499 Phase 1): Linear rows refresh
// via `refreshToken` (a GitHub-family binding never has one by design — see
// lib/providers/github/index.js). GitHub-family rows (`github`,
// `github-projects`) instead re-mint from `installationId`, so THEY are
// refreshable by that field. `installationId` is binding-scoped, not part of
// the legacy scalar mirror (see linkProvider/getBindingsForWorkspace in
// lib/workspace.js), so it is read off the active binding's `credentials`,
// mirroring the same active-binding match `remintActiveCredential` uses. A
// row lacking the field its own provider needs must stay unselectable here —
// returning null, not later throwing — so "nothing to refresh" stays a null
// result for every provider, exactly as it already is for Linear.
//
// ownerAccountId must be a real account id — unlike selectOwnerWorkspaceToken,
// there is no UNSCOPED mode here: refresh-on-resolve only ever acts on behalf
// of a single known owner, never owner-blind.
//
// LIN-2349: ranks via `isBetterCandidate`, like the file's three other ranking
// sites. It was the last one comparing raw `expiry > bestExpiry` magnitudes
// from a `-Infinity` seed, exempted on the recorded ground that its
// refreshability filter excludes sentinels in practice. That argument covered
// only the Linear branch. The GitHub-family branch is a second route INTO the
// compare, not out of it: `isLive` is falsy whenever `accessToken` is absent,
// so such a row clears the liveness gate, and `isRefreshable` then takes
// `isGitHubFamily ? !!findActiveInstallationId(ws) : !!ws.refreshToken` and
// returns true WITHOUT ever consulting `refreshToken`. A sentinel expiry then
// reaches the compare and, at Number.MAX_SAFE_INTEGER, outranks a genuinely
// expired-and-refreshable Linear row — so `doRefresh` would re-mint the GitHub
// credential instead of refreshing the Linear one it was called for.
//
// On reachability, stated precisely, because a too-strong claim here is the
// same failure mode this ticket exists to correct:
//
//   * From Harbour's OWN state transitions, the required state is unreachable.
//     Four of the five writers of a workspace entry's accessToken/expiry move
//     both as a pair from one source in adjacent statements with no await
//     between them, so an empty token with a live expiry cannot be persisted;
//     `linkProvider` is the sole asymmetric writer, and every current caller
//     passes a defined token.
//   * It is NOT unreachable from upstream. `isSentinelExpiry` is a THRESHOLD
//     (>= year 3000), not `Number.MAX_SAFE_INTEGER` equality — a distinction
//     easy to miss, and missing it is what made this look unreachable. The
//     GitHub mint path validates that `expires_at` PARSES but neither that it
//     is plausible nor that `token` is present, so one malformed 2xx mint
//     (`{ expires_at: '9999-01-01T00:00:00Z' }`, no token) produces every
//     condition at once: github provider, empty accessToken, sentinel expiry,
//     surviving installationId.
//
// So this is closed for symmetry AND because a proof of unreachability would
// have been wrong — it would have rested on Harbour's writers while the real
// exposure is an unvalidated upstream response. (The upstream validation gap
// itself is filed separately; it is not this selector's to fix.) After this,
// no ranking site in the file compares raw expiry magnitudes with a sentinel
// in the running.
export function selectExpiredOwnerRow(sessions, urlKey, ownerAccountId) {
  if (!ownerAccountId) return null;

  let best = null;
  // `null` (not -Infinity) is `isBetterCandidate`'s own "no candidate yet"
  // sentinel — the shared helper's contract, not a local convention.
  let bestExpiry = null;

  for (const row of sessions) {
    const data = parseSessionData(row);
    if (data?.accountId !== ownerAccountId) continue;
    const workspaceIndex = data?.workspaces?.findIndex(w => w.urlKey === urlKey) ?? -1;
    if (workspaceIndex < 0) continue;

    const ws = data.workspaces[workspaceIndex];
    const isLive = ws.accessToken && ws.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS;
    if (isLive) continue;

    const isGitHubFamily = ws.provider === 'github' || ws.provider === 'github-projects';
    const isRefreshable = isGitHubFamily ? !!findActiveInstallationId(ws) : !!ws.refreshToken;
    if (!isRefreshable) continue;

    const expiry = ws.tokenExpiresAt || 0;
    if (isBetterCandidate(expiry, bestExpiry)) {
      bestExpiry = expiry;
      // refreshToken is carried for back-compat with the pre-LIN-1499 Linear-only
      // shape (existing callers/tests read row.refreshToken directly) — it is
      // simply undefined on a GitHub-family row, which never has one by design.
      best = { sid: row._id, refreshToken: ws.refreshToken, session: data, workspaceIndex, provider: ws.provider };
    }
  }

  return best;
}

// selectOwnerSessionRow(sessions, urlKey, ownerAccountId): a pure sibling of
// selectExpiredOwnerRow, added for LIN-1524. Unlike that selector, this one
// applies NO refreshability (or even liveness) filter at all — it exists
// purely to answer "does the owner have ANY session row referencing this
// workspace", live or expired.
//
// Mirroring a fresh accessToken/tokenExpiresAt back into the owner's session
// rows moved to `selectAllOwnerSessionRows` (LIN-2235, see
// lib/workspace-token-refresh.js) — this selector is no longer part of that.
// Its sole production consumer is now `headlessRefreshProvider`
// (lib/workspace-token-refresh.js), which reads the winning row's `provider`
// to choose the durable refresh PARTITION — a decision that affects which
// credential gets refreshed, not merely where a result is cached afterward.
//
// LIN-2278: ranks candidates by a local three-tier rule — finite expiry (2)
// beats sentinel expiry (1, `Number.MAX_SAFE_INTEGER` — GitHub-family/Jira
// Basic/PAT bindings with no real expiry) beats no recorded expiry (0, "no
// information"). A missing `tokenExpiresAt` (undefined/null/0) is
// deliberately NOT promoted above a sentinel — it is honestly less
// information than a sentinel, which at least asserts "no real expiry by
// design". Within a tier, the latest raw expiry wins — the same tie-break
// convention as `selectExpiredOwnerRow`/`selectOwnerWorkspaceToken` — and
// when every candidate ties (e.g. all tier 0), the first one scanned wins.
// The ranking is intentionally local to this function rather than routed
// through the shared `isBetterCandidate`/`isSentinelExpiry` two-tier
// comparator the other selectors below use, and — because there is no
// liveness filter here — it applies to EXPIRED rows too, unlike those
// selectors' finite-beats-sentinel rule, which only ever compares live ones.
//
// Returns null when the owner has no session row for `urlKey` at all (e.g.
// logged out).
function expiryTier(expiresAt) {
  if (!expiresAt) return 0;                    // no usable expiry — "no information"
  return isSentinelExpiry(expiresAt) ? 1 : 2;   // sentinel, then finite
}

export function selectOwnerSessionRow(sessions, urlKey, ownerAccountId) {
  if (!ownerAccountId) return null;

  let best = null;
  let bestTier = -1;
  let bestExpiry = -Infinity;

  for (const row of sessions) {
    const data = parseSessionData(row);
    if (data?.accountId !== ownerAccountId) continue;
    const workspaceIndex = data?.workspaces?.findIndex(w => w.urlKey === urlKey) ?? -1;
    if (workspaceIndex < 0) continue;

    const ws = data.workspaces[workspaceIndex];
    const expiry = ws.tokenExpiresAt || 0;
    const tier = expiryTier(expiry);
    if (tier > bestTier || (tier === bestTier && expiry > bestExpiry)) {
      bestTier = tier;
      bestExpiry = expiry;
      best = { sid: row._id, session: data, workspaceIndex };
    }
  }

  return best;
}

// selectAllOwnerSessionRows(sessions, urlKey, ownerAccountId): the ALL-rows
// sibling of selectOwnerSessionRow (LIN-2235, L4.2 of the LIN-2231 design).
// Same match criteria (owner-scoped, ANY row referencing urlKey, no
// refreshability/liveness filter — a row's OWN recorded tokenExpiresAt says
// nothing about whether its access-token bytes are still valid, since
// Linear's rotation invalidates every previously-issued access token for the
// grant regardless of what any one mirror's row believes its expiry is), but
// returns every match instead of picking the latest-expiring one. Exists so a
// successful credential rotation can mirror the fresh token into EVERY live
// session row for this (owner, workspace) pair — not just one — closing the
// gap where a second device/browser's stale mirror 401s on next use even
// though ITS row looked unexpired (comment `18f2f69d`'s 173-line transient
// burst on an otherwise-healthy credential). Never used to decide WHETHER to
// refresh, only WHERE to mirror a refresh that already succeeded — this is
// now the ONLY selector used for that (LIN-2278: `selectOwnerSessionRow` no
// longer shares that division of responsibility; it is instead read earlier,
// by `headlessRefreshProvider`, to choose the refresh partition).
export function selectAllOwnerSessionRows(sessions, urlKey, ownerAccountId) {
  if (!ownerAccountId) return [];

  const rows = [];
  for (const row of sessions) {
    const data = parseSessionData(row);
    if (data?.accountId !== ownerAccountId) continue;
    const workspaceIndex = data?.workspaces?.findIndex(w => w.urlKey === urlKey) ?? -1;
    if (workspaceIndex < 0) continue;
    rows.push({ sid: row._id, session: data, workspaceIndex });
  }
  return rows;
}

// selectOwnerWorkspaceRow(sessions, urlKey, ownerAccountId): a pure sibling of
// selectExpiredOwnerRow/selectOwnerSessionRow, added for LIN-1986. Unlike
// selectOwnerWorkspaceToken there is no UNSCOPED mode — title resolution (its
// sole consumer, resolveWorkspaceForTitles) has no legitimate owner-blind
// caller. Returns the winning **workspace row** itself, not a wrapper: the
// consumer feeds it straight into fetchWorkspaceIssues(workspace), which needs
// the whole row (accessToken + provider + whatever getWorkspaceCallScope
// reads), not a bare token string.
//
// Selection mirrors selectOwnerWorkspaceToken's scoped branch exactly: live
// (accessToken present, tokenExpiresAt beyond TOKEN_REFRESH_BUFFER_MS),
// owner-scoped, and — LIN-2275 — the SAME LIN-1982 finite-beats-sentinel
// ranking (isBetterCandidate/isSentinelExpiry) selectOwnerWorkspaceToken
// already uses. An earlier version of this comment claimed the sentinel
// hazard was "already owned by LIN-1982"; that was wrong — LIN-1982 only
// touched selectOwnerWorkspaceToken, never this selector, so the raw
// `tokenExpiresAt > bestExpiry` tie-break stayed live here even after
// LIN-1982 landed. It mattered more here than it first looked: this
// selector's consumer (resolveWorkspaceForTitles) is not a diagnostic — the
// winning row is fed straight into fetchWorkspaceIssues(workspace), a real
// provider call, so a mis-mirrored sentinel winning selection could pick the
// wrong provider/credential for that call, permanently, by the exact
// mechanism LIN-1982 fixed. No provider comparison: an earlier draft's
// provider-matching branch was deleted rather than repaired (LIN-1986
// plan-review F1), and that removal stands — only the expiry ranking changes
// here.
export function selectOwnerWorkspaceRow(sessions, urlKey, ownerAccountId) {
  if (!ownerAccountId) return null;

  let best = null;
  let bestExpiry = null;

  for (const row of sessions) {
    const data = parseSessionData(row);
    if (data?.accountId !== ownerAccountId) continue;
    const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
    if (!ws) continue;
    if (ws.accessToken && ws.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      if (isBetterCandidate(ws.tokenExpiresAt, bestExpiry)) {
        best = ws;
        bestExpiry = ws.tokenExpiresAt;
      }
    }
  }

  return best;
}

// detectOwnerAccountMismatch(sessions, urlKey, ownerAccountId): a pure sibling
// of selectOwnerWorkspaceToken, added for LIN-1413. Fires when the owner's own
// token has no live row for this workspace AND some DIFFERENT account does.
// Returns a verdict only — never a token, never the other account's id — so
// this changes how a resolution failure is *described*, never who gets a
// credential (LIN-1366 fail-closed is untouched).
//
// Re-review finding (LIN-1413): this predicate is a SIGNAL, not a proof of
// account fork. It fires identically for two distinct situations the
// available session data cannot tell apart: (a) the owner account genuinely
// no longer holds the workspace (re-auth cannot fix it), and (b) the owner's
// own token merely lapsed (LIN-1373's ordinary case) while a different,
// legitimate account on the same workspace happens to be live (re-auth CAN
// fix it). This function is a pure scan over `sessions` and does not consult
// account identity at all, so it cannot distinguish them by construction —
// accountWorkspaceStore's bindings are additive/never-revoked (lib/account-
// session.js's bindAccountToWorkspace call, with no unbind caller anywhere)
// so they cannot serve as that signal either.
//
// LIN-2231 built the same-human identity concept this whole family was
// missing — merge-on-proof account unification (lib/account-store.js's
// mergeAccounts) and canonical token-authority resolution
// (resolveCanonicalAccountId, wired into server.js's resolveWorkspaceAccess
// as the single chokepoint before this detector's own callers ever run) —
// closing the accountId-FORK root cause this reason's ambiguity traces back
// to. It does not, and was never meant to, resolve THIS predicate's own
// session-level signal into a proof; that ambiguity stays real for the (a)
// vs (b) case above, which is a live-colleague/liveness question, not an
// identity-fork one. Callers of this function's verdict must not claim more
// certainty than that — see lib/errors.js's owner_mismatch detail.
//
// Returns false for a null/empty ownerAccountId (LIN-1376's case; must stay
// not_connected) and for UNSCOPED (owner-blind callers have no owner to
// mismatch against).
export function detectOwnerAccountMismatch(sessions, urlKey, ownerAccountId) {
  if (!ownerAccountId || ownerAccountId === UNSCOPED) return false;

  let ownerLive = false;
  let otherAccountLive = false;

  for (const row of sessions) {
    const data = parseSessionData(row);
    const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
    if (!ws) continue;
    const isLive = ws.accessToken && ws.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS;
    if (!isLive) continue;
    if (data?.accountId === ownerAccountId) {
      ownerLive = true;
    } else {
      otherAccountLive = true;
    }
  }

  return !ownerLive && otherAccountLive;
}

// detectOwnerSignedOut(sessions, ownerAccountId): a pure sibling of
// detectOwnerAccountMismatch, added for LIN-1506. Fires when the owner
// account has no session row AT ALL — not scoped to any one workspace. This
// is deliberately 2-arg (Q1): "this account has no session anywhere" is a
// workspace-independent fact, unlike detectOwnerAccountMismatch/
// selectExpiredOwnerRow/selectOwnerWorkspaceToken, which genuinely need
// urlKey because they select a per-workspace token. An unused urlKey
// parameter here would invite the naive predicate "no row for this owner
// referencing this urlKey", which also matches a signed-in owner who simply
// never connected THIS workspace — reintroducing the dishonesty (telling a
// signed-in user to sign in) this ticket exists to remove.
//
// Returns a verdict only — never a token — mirroring detectOwnerAccountMismatch's
// contract: this changes how a resolution failure is described, never who
// gets a credential.
//
// Returns false for a null/empty ownerAccountId and for UNSCOPED
// (owner-blind callers have no single owner to check).
export function detectOwnerSignedOut(sessions, ownerAccountId) {
  if (!ownerAccountId || ownerAccountId === UNSCOPED) return false;

  for (const row of sessions) {
    const data = parseSessionData(row);
    if (data?.accountId === ownerAccountId) return false;
  }

  return true;
}

// classifyWorkspaceFailure({ sessions, urlKey, ownerAccountId, selectedReason }):
// pure reclassification step for LIN-1506, extracted from server.js's
// resolveWorkspaceAccess (the BLOCKING-1 refactor — server.js has zero
// exports, so nothing could reach this logic from a test before this move).
// Takes the selector's already-computed `selectedReason` (from
// selectOwnerWorkspaceToken, after refresh-on-resolve has had its chance) and
// upgrades it to a more honest reason when a pure sibling detector's verdict
// justifies it. Never touches token/provider — callers keep assembling those
// themselves from `selected`.
//
// Ordering is load-bearing and intentionally NOT symmetric:
//   1. owner_mismatch (detectOwnerAccountMismatch) is checked FIRST and wins
//      any overlap. It requires a live session for this owner (elsewhere) to
//      even be reachable via selectedReason, and its remedy (re-auth may or
//      may not help) is a strictly stronger signal than "no row at all".
//   2. owner_signed_out (detectOwnerSignedOut) only reclassifies the
//      `not_connected` case — the one where the owner has no session row for
//      THIS workspace. It is workspace-independent, so it is gated on
//      `selectedReason === 'not_connected'` here (rather than inside the
//      detector) to keep the detector itself a simple, reusable "is this
//      account signed in anywhere" predicate.
// Any other selectedReason (ok, session_expired, store_unreachable) passes
// through unchanged.
export function classifyWorkspaceFailure({ sessions, urlKey, ownerAccountId, selectedReason }) {
  if (ownerAccountId !== UNSCOPED && detectOwnerAccountMismatch(sessions, urlKey, ownerAccountId)) {
    return 'owner_mismatch';
  }

  if (selectedReason === 'not_connected' && detectOwnerSignedOut(sessions, ownerAccountId)) {
    return 'owner_signed_out';
  }

  return selectedReason;
}

// describeWorkspaceResolution(sessions, urlKey, ownerAccountId): a pure,
// SECRET-SAFE diagnostic summary of a workspace-access resolution, added so
// resolveWorkspaceAccess can log WHY a lookup failed. It exists because the
// bare `not_connected` reason is genuinely ambiguous — two different failures
// produce the identical code and, until now, the identical (silent) outcome:
//
//   (1) a null/empty owner — a proxy token minted without `createdBy` (the
//       LIN-1376 / LIN-1429 regression class). `ownerAccountId: '<null>'`,
//       `ownerSessionRowCount: 0`.
//   (2) an owner who IS signed in but has no session referencing THIS
//       workspace — e.g. their live session is on a different device/workspace
//       while another account holds this one (the multi-device fork).
//       `ownerSessionRowCount > 0`, `ownerHasRowForWorkspace: false`,
//       `otherAccountLiveForWorkspace: true`.
//
// The summary carries ONLY non-sensitive facts. It NEVER includes any other
// account's id or any accessToken bytes — matching the same privacy boundary
// lib/errors.js's owner_mismatch path enforces on the wire (only the caller's
// OWN owner id and public workspace slugs appear, both of which the existing
// owner_mismatch server-log at server.js already emits). `otherAccountLive*`
// is a bare boolean by design, never the other account's id.
//
// Pure over its three arguments (Date.now() aside, same as the selectors here)
// — no fs/network/session mutation. Never used to decide selection, only to
// DESCRIBE a resolution that already happened.
export function describeWorkspaceResolution(sessions, urlKey, ownerAccountId) {
  const scoped = ownerAccountId !== UNSCOPED;
  const hasOwner = scoped && !!ownerAccountId;

  let ownerSessionRowCount = 0;
  const ownerReferencedUrlKeys = new Set();
  let ownerHasRowForWorkspace = false;
  let ownerNearestExpiryForWorkspace = null;
  let otherAccountLiveForWorkspace = false;

  for (const row of sessions) {
    const data = parseSessionData(row);
    const isOwnerRow = hasOwner && data?.accountId === ownerAccountId;

    if (isOwnerRow) {
      ownerSessionRowCount += 1;
      for (const w of data?.workspaces || []) {
        if (w?.urlKey) ownerReferencedUrlKeys.add(w.urlKey);
      }
    }

    const ws = data?.workspaces?.find(w => w?.urlKey === urlKey);
    if (!ws) continue;

    const isLive = ws.accessToken && ws.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS;

    if (isOwnerRow) {
      ownerHasRowForWorkspace = true;
      if (typeof ws.tokenExpiresAt === 'number' &&
          (ownerNearestExpiryForWorkspace === null || ws.tokenExpiresAt > ownerNearestExpiryForWorkspace)) {
        ownerNearestExpiryForWorkspace = ws.tokenExpiresAt;
      }
    } else if (isLive && hasOwner) {
      // A live row on THIS workspace belonging to some other account — the
      // multi-device / account-fork signal. A bare boolean, never the id.
      otherAccountLiveForWorkspace = true;
    }
  }

  return {
    urlKey,
    ownerAccountId: hasOwner ? ownerAccountId : (scoped ? '<null>' : '<unscoped>'),
    scoped,
    ownerSessionRowCount,
    ownerReferencedUrlKeys: [...ownerReferencedUrlKeys],
    ownerHasRowForWorkspace,
    ownerNearestExpiryForWorkspace,
    otherAccountLiveForWorkspace
  };
}
