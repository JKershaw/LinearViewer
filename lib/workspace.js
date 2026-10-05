/**
 * Multi-workspace session management helpers.
 * Handles workspace CRUD operations within Express sessions.
 */
import { calculateExpiresAt } from './token-refresh.js'
import { getProvider, getProviderForWorkspace } from './providers/registry.js'
// LIN-3124 PR3 (D1/D15): the store-free per-request credential side-table. This
// module is a D6(c) protected module, so it may import `connection-binding.js`
// (which imports none of the three connection modules) but never the seam/store/
// lifecycle. The side-table is written only by `lib/connection-credential.js`;
// here it is read-only, and a connection-backed binding with no hydrated entry
// fails closed.
import { isConnectionBacked, readBindingCredential, readWorkspaceCredential, activeBindingIsConnectionBacked, activeConnectionBackedBinding } from './connection-binding.js'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Workspace object stored in session
 * @typedef {Object} Workspace
 * @property {string} id - Workspace/organization ID (UUID)
 * @property {string} name - Workspace display name
 * @property {string} urlKey - Workspace URL key (used in Linear URLs)
 * @property {string} [provider] - Active/primary credential provider identifier (e.g. 'linear'). Absent on legacy workspaces; back-compat default is `'linear'`.
 * @property {ProviderBinding[]} [bindings] - Provider bindings attached to this workspace, each keyed by `(provider, scope)` with its own credentials (LIN-562). Absent on legacy workspaces — {@link getBindingsForWorkspace} synthesizes one for them.
 * @property {WorkspaceCredentials} [credentials] - Back-compat scalar mirror of the active binding's credentials. New home for the token; absent on legacy workspaces.
 * @property {string} [accessToken] - Legacy top-level OAuth/personal access token. Superseded by `credentials.token`; read via {@link getWorkspaceToken} for back-compat.
 * @property {string} [refreshToken] - Dead as of LIN-1524: never written by this module for any provider. Linear's rotating credential lives ONLY in the owner-credential store (`lib/owner-credential-store.js`, keyed by `(accountId, urlKey)`); GitHub-family never had one (see `installationId` on the binding instead). Field kept in the typedef only because a genuinely legacy pre-cutover session row could still carry a stale value until it expires.
 * @property {number} tokenExpiresAt - Token expiry timestamp (ms since epoch)
 * @property {boolean} [isPAT] - Whether this workspace uses a personal access token (no refresh)
 * @property {number} addedAt - Timestamp when workspace was added (ms since epoch)
 */

/**
 * Generic provider credential bag carried on a workspace.
 * @typedef {Object} WorkspaceCredentials
 * @property {string} token - Provider access/personal token (new home for legacy `accessToken`).
 * @property {string} [refreshToken] - Dead as of LIN-1524 for Linear (durable-store-only now, see `lib/owner-credential-store.js`); never present for non-OAuth providers like local/PAT or GitHub-family (which re-mints via `installationId` instead).
 * @property {number} [tokenExpiresAt] - Token expiry timestamp (ms since epoch).
 */

/**
 * A single provider binding attached to a workspace (LIN-562).
 *
 * Bindings are keyed by `(provider, scope)` — NOT provider alone — so one
 * account can yield multiple bindings (e.g. a GitHub issues binding scoped to
 * `owner/repo` plus a GitHub Projects binding scoped to `org/projectNumber`).
 * Credentials live INSIDE each binding so there is a single source of truth.
 * A legacy workspace maps to exactly one binding.
 *
 * @typedef {Object} ProviderBinding
 * @property {string} provider - Provider identifier (e.g. 'linear', 'local', 'github').
 * @property {string} scope - Provider-specific scope: Linear = org id, local = urlKey (store partition); GitHub deferred to LIN-541/560.
 * @property {WorkspaceCredentials} credentials - The binding's own credentials (single source of truth).
 */

/**
 * Express session with workspace data
 * @typedef {Object} WorkspaceSession
 * @property {Workspace[]} [workspaces] - Array of connected workspaces
 * @property {string} [activeWorkspaceId] - ID of currently active workspace
 * @property {function(function(Error=): void): void} save - Save session to store
 */

// =============================================================================
// Constants
// =============================================================================

export const MAX_WORKSPACES = 10;
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Permissive check for issue IDs — accepts UUIDs and identifiers (e.g. LIN-123, M5-100,
// WEB2-7), plus GitHub's own `#`-prefixed rendering (e.g. #55). The optional leading `#` is
// deliberately accepted here rather than stripped by a route-level normalizer (LIN-2361):
// every Harbour surface renders a GitHub issue as `#55`, so a worker that copies what it's
// shown must have that exact string accepted end to end, including the echo back in a
// response — a normalizer that strips `#` in place would destroy that echo. `#` is
// structurally exclusive to GitHub's own rendering convention (Linear/Jira identifiers never
// carry one), so widening here is safe for every provider. GitHub's own provider is
// responsible for stripping the `#` at the point it builds a REST URL — see
// `lib/providers/github/index.js`'s `stripHashPrefix`. Linear's API rejects truly bad IDs;
// this just blocks obviously-malformed input from reaching it.
export const ISSUE_ID_REGEX = /^#?[A-Za-z0-9-]{1,100}$/;

export function isValidIssueId(id) {
  return typeof id === 'string' && ISSUE_ID_REGEX.test(id);
}

// =============================================================================
// Team-ref membership (LIN-2025)
// =============================================================================
//
// Replaces the historical `UUID_REGEX.test(<team ref>)` format gates (which
// silently dropped any real, non-UUID team ref — e.g. a future Jira team key
// once LIN-2018 remaps Jira team ids to real project keys) with a membership
// check against the workspace's actual, already-fetched team list.
//
// Two helpers, deliberately split (John's ruling on LIN-2025, 2026-08-10):
//   - `matchTeamId` (graceful) — page/dashboard/roadmap selectors. A stale or
//     unmatched selection drops to unscoped (renders the full board), an
//     improvement over an empty one.
//   - `requireTeamMembership` (strict) — the three agent-facing proxy reads
//     (`GET /api/proxy/issues|labels|cycles`). An autonomous caller cannot
//     detect a silently dropped filter, so a well-formed-but-unmatched team id
//     must fail loud rather than widen to the whole workspace (same failure
//     class as LIN-2006's silent truncation).
//
// Both preserve the F1 teamless-provider passthrough: several providers
// (Local, GitHub, GitHub Projects) have no concept of teams and their
// `fetchTeams()` always returns `[]`. An empty team list therefore passes the
// raw value straight through unvalidated rather than treating "no match" as
// an error — that keeps each provider's own downstream handling of teamId
// (e.g. LocalProvider.issues() returning no results for any truthy teamId)
// as the source of truth, instead of this check turning a teamless workspace
// into a hard failure.
//
// Jira is deliberately NOT in that list (LIN-2033 F2): LIN-2018 gave it real
// teams (`fetchTeams()` → the tenant's projects), so a Jira workspace now
// takes the strict `requireTeamMembership` branch below like any other
// team-having provider — a well-formed-but-unmatched Jira team id fails loud
// rather than silently passing through. That is the intended behaviour, not
// a gap: the passthrough above exists for providers with no teams at all,
// and Jira is no longer one of them.

/**
 * Resolve a raw team ref against an already-fetched team list, gracefully.
 * @param {Array<{id}>} teams - the workspace's teams (already fetched)
 * @param {string|null} rawTeamId
 * @returns {string|null} the matched team id, the raw value unchanged (empty
 *   team list), or null (non-empty list, no match)
 */
export function matchTeamId(teams, rawTeamId) {
  if (!rawTeamId) return null;
  if (!teams || teams.length === 0) return rawTeamId;
  const match = teams.find(t => String(t.id) === String(rawTeamId));
  return match ? match.id : null;
}

/**
 * A well-formed team ref that does not match any team in this workspace's
 * already-fetched team list (never thrown for an empty/teamless list — see
 * `requireTeamMembership`'s passthrough).
 *
 * `truncated` (LIN-2033 A2) discloses whether the team list this refusal was
 * checked against was itself capped (e.g. Jira's 500-project `fetchTeams()`
 * cap, LIN-2033 F1) — a capped list is a fundamentally different refusal from
 * a genuinely absent team: the id may be real, just beyond where the provider
 * stopped looking. Callers must not report the two the same way.
 */
export class TeamNotFoundError extends Error {
  constructor(teamId, truncated = false) {
    super(`No team matches id '${teamId}' in this workspace`);
    this.name = 'TeamNotFoundError';
    this.teamId = teamId;
    this.truncated = truncated;
  }
}

/**
 * Resolve a raw team ref against an already-fetched team list, strictly:
 * fails loud on a well-formed-but-unmatched id instead of silently widening
 * to the whole workspace. Preserves the same teamless-provider passthrough as
 * `matchTeamId` — an empty team list can never produce a `TeamNotFoundError`.
 * @param {Array<{id}>} teams - the workspace's teams (already fetched); a
 *   `truncated` flag stamped on the array (LIN-2033 F1) rides into the thrown
 *   error so the refusal can disclose it
 * @param {string|null} rawTeamId
 * @returns {string|null} the matched team id, or the raw value unchanged
 *   (empty team list)
 * @throws {TeamNotFoundError} non-empty team list, no match
 */
export function requireTeamMembership(teams, rawTeamId) {
  if (!rawTeamId) return null;
  if (!teams || teams.length === 0) return rawTeamId;
  const match = teams.find(t => String(t.id) === String(rawTeamId));
  if (!match) throw new TeamNotFoundError(rawTeamId, !!teams.truncated);
  return match.id;
}

// Generous upper bound for any provider's team ref — a Linear UUID is 36 chars,
// a Jira project key (LIN-2018) a handful. Nothing legitimate approaches this.
export const MAX_TEAM_REF_LENGTH = 100;

/**
 * Is this raw team ref safe to store as a remembered selection (LIN-727)?
 *
 * Dropping the read-side format gate (LIN-2025 F4) deliberately removed
 * write-time *validation* — a stale or unmatched ref self-corrects through the
 * membership check on every later read, and paying a fetch to validate a write
 * was rejected. A type + length cap is a different thing: it is free, and
 * without it the write site persists whatever the query string carried, of any
 * size and any type (`?team=a&team=b` arrives as an Array), where the old UUID
 * gate could only ever store a UUID or null.
 *
 * @param {*} value - the raw ref about to be persisted (null = clear selection)
 * @returns {boolean}
 */
export function isPersistableTeamRef(value) {
  if (value === null) return true;
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEAM_REF_LENGTH;
}

// =============================================================================
// Session Helpers
// =============================================================================

/**
 * Get the active workspace from session.
 * If activeWorkspaceId is out of sync, syncs to first workspace.
 * @param {WorkspaceSession} session - Express session object
 * @returns {Workspace|null} Active workspace or null if not authenticated
 */
export function getActiveWorkspace(session) {
  if (!session.workspaces?.length) return null;
  const active = session.workspaces.find(w => w.id === session.activeWorkspaceId);
  if (!active) {
    // Sync activeWorkspaceId if it's out of sync
    session.activeWorkspaceId = session.workspaces[0].id;
    return session.workspaces[0];
  }
  return active;
}

/**
 * Add or update a workspace in session.
 * Updates existing workspace if same org ID, otherwise adds new.
 * @param {WorkspaceSession} session - Express session object
 * @param {Workspace} workspace - Workspace object to add/update
 * @throws {Error} If MAX_WORKSPACES limit reached
 */
export function upsertWorkspace(session, workspace) {
  session.workspaces = session.workspaces || [];
  const index = session.workspaces.findIndex(w => w.id === workspace.id);
  if (index >= 0) {
    // Update existing (re-auth for same workspace)
    const existing = session.workspaces[index];
    // LIN-3124 PR3 keystone (D2a): the incoming object replaces `bindings`
    // wholesale, so a re-auth of the same id would drop a connection-backed
    // binding (and could clobber it with a legacy one at the same key). Merge
    // preserving the connection-backed set; the identity function on a
    // legacy-only container.
    const merged = { ...existing, ...workspace };
    // LIN-3124 PR3 review blocker 5: an incoming container that carries a
    // scalar mirror but no D2 marker (a legacy re-login) makes the mirror the
    // active credential — a stale marker from `existing` must not survive it.
    if (!('activeBinding' in workspace) && workspace.accessToken !== undefined) delete merged.activeBinding;
    if (Array.isArray(workspace.bindings)) {
      merged.bindings = mergeBindingsPreservingConnectionBacked(existing.bindings, workspace.bindings);
    }
    session.workspaces[index] = merged;
  } else {
    // Add new (check limit)
    if (session.workspaces.length >= MAX_WORKSPACES) {
      throw new Error(`Maximum of ${MAX_WORKSPACES} workspaces allowed`);
    }
    session.workspaces.push(workspace);
  }
}

/**
 * LIN-3124 PR3 (D2a): merge an incoming `bindings` array into an existing one so
 * a re-auth never drops or downgrades a connection-backed binding.
 *
 * - An incoming legacy binding at a `(provider, scope)` key already held by a
 *   connection-backed existing binding is replaced by the connection-backed one
 *   (connection-backed wins).
 * - An existing connection-backed binding absent from the incoming set is kept.
 * - With no connection-backed bindings on either side this returns the incoming
 *   array unchanged (identity — legacy byte-identical).
 *
 * @param {ProviderBinding[]} [existingBindings]
 * @param {ProviderBinding[]} incomingBindings
 * @returns {ProviderBinding[]}
 */
function mergeBindingsPreservingConnectionBacked(existingBindings, incomingBindings) {
  const existingConnectionBacked = new Map(
    (existingBindings || []).filter(isConnectionBacked).map(b => [`${b.provider}::${b.scope}`, b])
  );
  if (existingConnectionBacked.size === 0) return incomingBindings;
  const merged = incomingBindings.map(b => {
    const key = `${b.provider}::${b.scope}`;
    const kept = existingConnectionBacked.get(key);
    if (kept && !isConnectionBacked(b)) {
      existingConnectionBacked.delete(key);
      return kept;
    }
    existingConnectionBacked.delete(key);
    return b;
  });
  for (const kept of existingConnectionBacked.values()) merged.push(kept);
  return merged;
}

/**
 * Remove a workspace from session.
 * Updates activeWorkspaceId if removed workspace was active.
 * @param {WorkspaceSession} session - Express session object
 * @param {string} workspaceId - ID of workspace to remove
 * @returns {number} Number of remaining workspaces
 */
export function removeWorkspace(session, workspaceId) {
  session.workspaces = session.workspaces?.filter(w => w.id !== workspaceId) || [];

  // If removed workspace was active, switch to first remaining
  if (session.activeWorkspaceId === workspaceId) {
    session.activeWorkspaceId = session.workspaces[0]?.id || null;
  }

  return session.workspaces.length;
}

/**
 * Promisified session save.
 * @param {WorkspaceSession} session - Express session object
 * @returns {Promise<void>}
 */
export function saveSession(session) {
  return new Promise((resolve, reject) => {
    session.save(err => err ? reject(err) : resolve())
  })
}

/**
 * Update workspace with new OAuth token data.
 * Mutates the workspace object directly.
 *
 * Writes the generalized provider-aware shape (S2/LIN-334): `provider` plus a
 * `credentials` bag carrying the token. The legacy top-level `accessToken` is
 * still written alongside it for back-compat — read sites migrate from
 * `workspace.accessToken` to {@link getWorkspaceToken} incrementally (S3+), so
 * dropping it here would break the ~29 readers that still access it directly.
 *
 * LIN-1524 (Session 2 cutover): `tokenData.refresh_token` is deliberately
 * NEVER written here — to `workspace.refreshToken`, `workspace.credentials`,
 * or the active binding's `credentials.refreshToken`. The refresh token is
 * durable-store-only now (see {@link persistOwnerCredential}); `accessToken`/
 * `tokenExpiresAt` stay the only session-side mirror, as a pure cache.
 *
 * @param {Workspace} workspace - Workspace object to update
 * @param {Object} tokenData - Token response from OAuth flow
 * @param {string} tokenData.access_token - New access token
 * @param {string} tokenData.refresh_token - New refresh token (durable-store-only; see above)
 * @param {number} tokenData.expires_in - Token lifetime in seconds
 */
export function updateWorkspaceTokens(workspace, tokenData) {
  applyAccessTokenToWorkspace(workspace, tokenData.access_token, calculateExpiresAt(tokenData.expires_in));
}

/**
 * Mirror an already-resolved access token + ABSOLUTE expiry (ms epoch) onto the
 * session-side workspace object — the session-cache half {@link updateWorkspaceTokens}
 * performs, factored out so the human refresh paths (LIN-1546) can reuse it
 * OUTSIDE the shared single-flight refresh seam. The seam owns the network
 * refresh + durable CAS write and returns an absolute `expiresAt` (ms), which a
 * race loser converging on the winner's already-stored token cannot losslessly
 * re-express as an `expires_in` (seconds) — so this takes the absolute value
 * directly, and {@link updateWorkspaceTokens} stays the `expires_in` façade over
 * it for the OAuth-login/mutator callers. Behaviour is byte-identical to the
 * body updateWorkspaceTokens used to inline (proven by its unchanged unit tests).
 *
 * As with updateWorkspaceTokens, `refreshToken` is NEVER written here — it is
 * durable-store-only (LIN-1524); this touches only `accessToken`,
 * `tokenExpiresAt`, the `credentials` bag, and the active binding.
 *
 * @param {Workspace} workspace - Workspace object to mutate in place
 * @param {string} accessToken - the fresh access token
 * @param {number} tokenExpiresAt - absolute expiry, ms epoch (already computed)
 */
export function applyAccessTokenToWorkspace(workspace, accessToken, tokenExpiresAt) {
  // LIN-3124 PR3 keystone (D2a): never mirror a credential onto a connection-
  // backed active binding — its credential lives in the Connection, and a
  // session copy must not be written. Secret-safe: logs shape only, no token.
  // The legacy path (no marker) is byte-identical.
  if (activeBindingIsConnectionBacked(workspace)) {
    console.warn('[workspace] applyAccessTokenToWorkspace: refusing to mirror a credential onto a connection-backed active binding');
    return;
  }
  // Legacy top-level fields (back-compat for un-migrated read sites).
  workspace.accessToken = accessToken;
  workspace.tokenExpiresAt = tokenExpiresAt;
  // Generalized provider-aware shape. Spread any existing credentials so other
  // provider-specific fields survive a token refresh; only the token rotates.
  // LIN-561: preserve an already-set provider (e.g. a non-Linear workspace
  // re-authing) instead of clobbering it to 'linear'; default to Linear only
  // when unset, since the Linear OAuth callback is the sole writer today. The
  // default is an explicit legacy fallback, not a blanket Linear assumption.
  workspace.provider = workspace.provider || 'linear';
  workspace.credentials = { ...workspace.credentials, token: accessToken };

  // LIN-562: rotate the matching binding's credentials in lockstep with the
  // scalar mirror. updateWorkspaceTokens is the shared credential writer for
  // BOTH OAuth login and the refresh middleware (server.js), so a refreshed
  // token must land inside bindings[] too — otherwise a binding-aware reader
  // (LIN-544 fan-out) would see a stale token after refresh. We only rotate an
  // EXISTING binding for the active provider; we never synthesize one here, so
  // legacy un-migrated workspaces (no bindings[]) stay byte-identical and rely
  // on getBindingsForWorkspace synthesizing on read.
  const active = workspace.bindings?.find(b => b.provider === workspace.provider);
  if (active) {
    active.credentials = {
      ...active.credentials,
      token: accessToken,
      tokenExpiresAt,
    };
  }
}

/**
 * Writes the durable half of the LIN-1523 dual-write: extracts the current
 * credential off an already-mutated `workspace` (scalar mirror + active
 * binding) and persists it via `store.put`, keyed on `accountId` +
 * `workspace.urlKey`. Called from the OAuth acquisition sites
 * (`routes/auth.js`), which reach it directly since `workspace` there is
 * already fully populated by `linkProvider` — there is no
 * `updateWorkspaceTokens` call to wrap. (The Linear refresh/rotation path
 * persists separately, via the durable store's compare-and-set write in
 * `refreshLinearOwnerCredential` — `lib/workspace-token-refresh.js` — not
 * through this function.)
 *
 * LIN-1524: `refreshToken` is taken as an explicit parameter, never read off
 * `workspace` — `updateWorkspaceTokens`/`linkProvider` no longer put it there
 * (durable-store-only now), so reading `workspace.refreshToken` here would
 * always persist `undefined`, silently discarding every rotation.
 *
 * @param {string} accountId - identity the durable record is keyed on
 * @param {import('./workspace.js').Workspace} workspace - already-mutated workspace to read the (non-refresh-token) credential off
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} store
 * LIN-1887: `provider` is an explicit parameter, defaulting to the workspace's
 * ACTIVE provider (so every pre-existing caller is byte-identical). It must be
 * passed for an ADD-SOURCE link, where the newly-linked binding is deliberately
 * NOT the active one: `linkProvider` only defaults `workspace.provider` when it
 * is unset, so a Jira link onto a Linear workspace leaves `workspace.provider`
 * as `'linear'`. Reading it here would then write Jira's rotating refresh token
 * into Linear's durable partition under Linear's label — which is F1 verbatim,
 * simply relocated from the store's key to this function's argument.
 *
 * LIN-1887 close-out: that explicit-provider arm has no PRODUCTION caller yet —
 * both live callers are Linear's (`routes/auth.js`), and Jira's OAuth callback
 * writes durable-first via `store.put` because it runs before its binding
 * exists (see the comment at that call site). The parameter is kept, and tested,
 * because it is the seam a non-active-binding caller must use; do not read its
 * absence from production as evidence it is unused API to be pruned.
 *
 * @param {string} [refreshToken] - the durable rotating credential to persist (absent for a non-refreshable provider, e.g. GitHub-family)
 * @param {string} [provider] - which binding's credential this is; defaults to the active provider
 */
export async function persistOwnerCredential(accountId, workspace, store, refreshToken, provider = workspace.provider) {
  const active = workspace.bindings?.find(b => b.provider === provider);
  await store.put(accountId, workspace.urlKey, {
    provider,
    scope: active?.scope,
    // For the ACTIVE provider these two are the scalar mirror, so this is
    // byte-identical to reading `workspace.accessToken`/`tokenExpiresAt`
    // directly (linkProvider writes both from the same binding). For a
    // non-active binding the mirror belongs to someone else, so the binding is
    // the only correct source.
    token: active?.credentials?.token ?? workspace.accessToken,
    refreshToken,
    tokenExpiresAt: active?.credentials?.tokenExpiresAt ?? workspace.tokenExpiresAt
  });
}

/**
 * Attach a provider source to a workspace — the single operation every flow
 * (OAuth login, PAT auto-login, local create, future add-source) converges on
 * so they structurally cannot diverge (LIN-562, the keystone).
 *
 * Upserts the `(provider, scope)` binding (credentials nested inside it — the
 * single source of truth), defaults the workspace's active `provider` when
 * unset, and — for the ACTIVE provider only — writes the legacy scalar mirror
 * (`accessToken`, `credentials.token`, `refreshToken`, `tokenExpiresAt`) so the
 * ~26 `accessToken` + ~31 single-arg `getWorkspaceToken` readers stay green
 * untouched. A second, non-active binding never clobbers the primary's scalar
 * mirror, keeping `getWorkspaceToken(workspace)` (no-arg) byte-identical.
 *
 * OAuth is just ONE credential-acquisition strategy: callers pass already-
 * acquired credentials, so a synchronous non-OAuth provider (local: token ===
 * partition, no refresh, MAX expiry) links through the exact same path.
 *
 * @param {Workspace} workspace - The provider-independent container to attach to.
 * @param {string} provider - Provider identifier (e.g. 'linear', 'local').
 * @param {string} scope - Provider-specific scope (Linear = org id, local = urlKey).
 * @param {WorkspaceCredentials} credentials - Acquired credentials for this binding.
 * @returns {Workspace} The mutated workspace (for chaining).
 */
export function linkProvider(workspace, provider, scope, credentials = {}) {
  workspace.bindings = workspace.bindings || [];
  const index = workspace.bindings.findIndex(b => b.provider === provider && b.scope === scope);
  // LIN-3124 PR3 keystone (D2a): a connection-backed binding is owned by the
  // converter — it carries `{provider, scope, connectionId}` and NO credentials,
  // and its credential lives in the Connection. Re-linking over it must not
  // write a credential bag or a scalar mirror (the converter is the only
  // credential writer for such bindings). A legacy re-link is byte-identical.
  if (index >= 0 && isConnectionBacked(workspace.bindings[index])) {
    return workspace;
  }
  const merged = { ...(index >= 0 ? workspace.bindings[index].credentials : {}), ...credentials };
  const binding = { provider, scope, credentials: merged };
  if (index >= 0) workspace.bindings[index] = binding;
  else workspace.bindings.push(binding);

  // Default the active provider when unset (first link wins); never clobber an
  // already-active provider — preserves LIN-561's default-when-unset semantics.
  const isActive = !workspace.provider || workspace.provider === provider;
  workspace.provider = workspace.provider || provider;

  // Back-compat scalar mirror — only for the active binding (see above).
  // LIN-1524: refreshToken is deliberately never mirrored onto the scalar
  // workspace object here (Linear's OAuth callback, the one caller that ever
  // passed one, now keeps it out of `credentials` entirely — see
  // routes/auth.js — so `merged.refreshToken` is never set going forward for
  // Linear; this stays a plain pass-through, not provider-aware, so a future
  // provider's binding-only fields are never silently promoted to the scalar
  // mirror by this function without an explicit caller decision).
  if (isActive) {
    // LIN-3124 PR3 (D2): a legacy binding taking the scalar mirror is the
    // active one now, so a D2 marker left by an earlier connection-backed
    // binding must not keep pointing elsewhere (the persist sanitizer would
    // otherwise strip this mirror). Absent on legacy-only data: identity.
    delete workspace.activeBinding;
    workspace.credentials = { ...workspace.credentials, token: merged.token };
    workspace.accessToken = merged.token;
    if (merged.tokenExpiresAt !== undefined) workspace.tokenExpiresAt = merged.tokenExpiresAt;
  }

  return workspace;
}

/**
 * Re-mint the active binding's credential via a provider that MINTS rather than
 * exchanges (LIN-712). The token-refresh middleware (server.js `ensureValidToken`)
 * routes a GitHub workspace here instead of Linear's `refresh_token` exchange:
 * GitHub App installation tokens carry no refresh token and must be re-minted
 * from the App JWT + `installationId`. Linear keeps its own path, byte-identical —
 * it is never routed through here.
 *
 * Finds the ACTIVE binding (the one mirrored into the scalar fields — matched by
 * the mirrored token, falling back to the first binding for the active provider)
 * and folds the provider's credentials patch back through {@link linkProvider} —
 * the same keystone seam the auth callback uses — so the binding AND the legacy
 * scalar mirror (`accessToken`/`tokenExpiresAt`) rotate in lockstep. Binding-only
 * fields like `installationId` survive because linkProvider merges the patch over
 * the existing credentials. Parity with the Linear path: only the ACTIVE token is
 * refreshed, not every binding.
 *
 * @param {Workspace} workspace - The active workspace whose token is stale.
 * @param {{refreshCredential: Function}} provider - The resolved provider instance.
 * @param {{fetchImpl?: Function, now?: number}} [opts] - Test seams forwarded to
 *   `provider.refreshCredential` (deterministic fetch/clock injection). Absent in
 *   production, so this is a pure passthrough — no behaviour change when omitted.
 * @returns {Promise<Workspace>} The mutated workspace (for chaining).
 */
export async function remintActiveCredential(workspace, provider, opts = {}) {
  const bindings = getBindingsForWorkspace(workspace);
  const active =
    bindings.find(b => isActiveBinding(workspace, b)) ||
    bindings.find(b => b.provider === workspace.provider) ||
    bindings[0];
  if (!active) {
    throw new Error('remintActiveCredential: workspace has no provider binding to refresh');
  }
  // LIN-3124 PR3 keystone (D2a): a connection-backed binding re-mints through
  // `refreshConnection` (lib/connection-credential.js), not here. Refuse rather
  // than write a provider patch into a binding that carries no credentials.
  if (isConnectionBacked(active)) {
    throw new Error('remintActiveCredential: refusing to re-mint a connection-backed binding (use refreshConnection)');
  }
  const refreshed = await provider.refreshCredential(active, opts);
  return linkProvider(workspace, active.provider, active.scope, refreshed);
}

/**
 * Detach a single provider binding from a workspace — the inverse of
 * {@link linkProvider} (LIN-634). The only per-binding remover: `removeWorkspace`
 * deletes the WHOLE workspace, which the settings provider-management surface must
 * never do when removing one source.
 *
 * Removes the binding matching `(provider, scope)` (a no-op if none matches) and,
 * when the removed binding was the ACTIVE provider, re-points `workspace.provider`
 * and rewrites the legacy scalar mirror (`accessToken`/`credentials`/`refreshToken`/
 * `tokenExpiresAt`) from the first remaining binding — mirroring how
 * `removeWorkspace` repoints `activeWorkspaceId`. This keeps the invariant that the
 * scalar mirror always reflects a real binding, so single-arg `getWorkspaceToken(ws)`
 * and the ~26 `accessToken` readers stay correct. When no binding remains, the
 * active pointer and scalar mirror are cleared. Never deletes the workspace and
 * never touches non-matching bindings.
 *
 * @param {Workspace} workspace - The workspace to detach the binding from.
 * @param {string} provider - Provider identifier of the binding to remove.
 * @param {string} scope - Scope of the binding to remove (bindings are keyed by `(provider, scope)`).
 * @returns {Workspace} The mutated workspace (for chaining).
 */
export function unlinkProvider(workspace, provider, scope) {
  if (!workspace) return workspace;

  // Materialize bindings for legacy workspaces (token only in the scalar mirror,
  // no explicit bindings[]) so a SYNTHESIZED binding can be removed too —
  // getBindingsForWorkspace is the single source of truth the rest of the code
  // already treats as real, so the remove action must agree with what was rendered.
  const bindings = workspace.bindings?.length ? workspace.bindings : getBindingsForWorkspace(workspace);
  const index = bindings.findIndex(b => b.provider === provider && b.scope === scope);
  if (index < 0) return workspace; // unknown (provider, scope) — no-op

  const removed = bindings[index];
  // Assign the explicit, filtered array (materializes bindings[] for legacy).
  workspace.bindings = bindings.filter((_, i) => i !== index);

  // Only the active-provider pointer + scalar mirror need repointing. Removing a
  // non-active binding leaves the primary's mirror untouched.
  if (workspace.provider === removed.provider) {
    const next = workspace.bindings[0];
    if (next) {
      mirrorActiveBinding(workspace, next);
    } else {
      // No bindings remain — clear the active pointer and the scalar mirror.
      delete workspace.provider;
      delete workspace.credentials;
      delete workspace.accessToken;
      delete workspace.refreshToken;
      delete workspace.tokenExpiresAt;
      delete workspace.activeBinding;
    }
  }

  return workspace;
}

/**
 * Point the active provider at an existing binding: set `workspace.provider` and
 * rewrite the legacy scalar credential mirror (`accessToken`/`credentials`/
 * `refreshToken`/`tokenExpiresAt`) from that binding, atomically. The shared
 * re-point primitive behind both {@link unlinkProvider}'s re-point and
 * {@link setActiveProvider} — the pointer and the mirror must always move
 * together, or readers (`getProviderForWorkspace`) and single-arg
 * `getWorkspaceToken(ws)` desync.
 *
 * @param {Workspace} workspace - The workspace whose active state to repoint.
 * @param {ProviderBinding} binding - The binding to make active.
 */
function mirrorActiveBinding(workspace, binding) {
  workspace.provider = binding.provider;
  // LIN-3124 PR3 (D2): a connection-backed active binding is identified by the
  // marker, never by a mirrored credential. Point the marker and strip the
  // scalar mirror instead of copying a (nonexistent) credential. A legacy
  // binding keeps today's scalar-mirror copy, byte-identically.
  if (isConnectionBacked(binding)) {
    workspace.activeBinding = { provider: binding.provider, scope: binding.scope };
    delete workspace.credentials;
    delete workspace.accessToken;
    delete workspace.tokenExpiresAt;
    delete workspace.refreshToken;
    return;
  }
  delete workspace.activeBinding;
  workspace.credentials = { ...binding.credentials };
  workspace.accessToken = binding.credentials?.token;
  // LIN-1524: refreshToken is deliberately never re-pointed onto the scalar
  // mirror here — it never lands in binding.credentials for Linear in the
  // first place (linkProvider no longer mirrors it), so there is nothing to
  // re-point; a stray legacy binding carrying one is not propagated either.
  workspace.tokenExpiresAt = binding.credentials?.tokenExpiresAt;
}

/**
 * Switch a workspace's ACTIVE provider to an existing `(provider, scope)` binding
 * (LIN-717). The coexistence fix: `linkProvider` already appends a second binding
 * (e.g. GitHub onto a Linear workspace) without clobbering the prior one, but every
 * view renders only the single active provider via `getProviderForWorkspace` and
 * nothing could re-point it — so the appended binding was unreachable. This is the
 * missing writer.
 *
 * Finds the binding keyed by `(provider, scope)` and re-points the active pointer
 * AND the scalar credential mirror to it via {@link mirrorActiveBinding}, atomically
 * (the same invariant `linkProvider`/`unlinkProvider` maintain). No-op when no such
 * binding exists; idempotent when the binding is already active. Never changes the
 * set of bindings — this is a pointer move, not a persistence/schema change.
 *
 * @param {Workspace} workspace - The workspace to switch.
 * @param {string} provider - Provider identifier of the binding to activate.
 * @param {string} scope - Scope of the binding to activate (bindings are keyed by `(provider, scope)`).
 * @returns {Workspace} The mutated workspace (for chaining).
 */
export function setActiveProvider(workspace, provider, scope) {
  if (!workspace) return workspace;
  const bindings = getBindingsForWorkspace(workspace);
  const binding = bindings.find(b => b.provider === provider && b.scope === scope);
  if (!binding) return workspace; // unknown (provider, scope) — no-op
  mirrorActiveBinding(workspace, binding);
  return workspace;
}

/**
 * Return a workspace's provider bindings, synthesizing a single legacy binding
 * for un-migrated workspaces so callers (LIN-544's fan-out) iterate one uniform
 * shape with NO data migration (LIN-562).
 *
 * A workspace that has been through {@link linkProvider} carries explicit
 * `bindings[]`. A legacy workspace (token in `accessToken`/`credentials` only)
 * is mapped on read to one binding: `{ provider: workspace.provider || 'linear',
 * scope, credentials }`, where scope is the urlKey for local (its store
 * partition) and the workspace id otherwise (Linear's id IS the org id).
 *
 * @param {Workspace} [workspace]
 * @returns {ProviderBinding[]} Bindings (never null; empty array for null input).
 */
export function getBindingsForWorkspace(workspace) {
  if (!workspace) return [];
  if (workspace.bindings?.length) return workspace.bindings;

  const provider = workspace.provider || 'linear';
  const scope = provider === 'local' ? workspace.urlKey : workspace.id;
  const credentials = { token: getWorkspaceToken(workspace) };
  // LIN-1524: no refreshToken synthesis — workspace.refreshToken no longer
  // exists for Linear (durable-store-only now), so synthesizing it here would
  // resurrect a phantom field on every legacy-shaped read.
  if (workspace.tokenExpiresAt !== undefined) credentials.tokenExpiresAt = workspace.tokenExpiresAt;
  return [{ provider, scope, credentials }];
}

/**
 * Read a workspace's credential token (dual-read, back-compat).
 *
 * Returns the new `credentials.token` when present, falling back to the legacy
 * top-level `accessToken`. This is the single seam that writers (S2) and the
 * ~29 existing `workspace.accessToken` read sites converge on, so reader sites
 * can migrate from `workspace.accessToken` to `getWorkspaceToken(workspace)`
 * incrementally rather than big-bang. New `credentials.token` wins over legacy
 * `accessToken` when both are present.
 *
 * LIN-562 widened this to optionally select a specific binding's token by
 * `(provider, scope)`. The no-arg form is unchanged and byte-identical — it
 * returns the active workspace's scalar mirror — so every existing single-arg
 * reader keeps working. With `provider` (and optionally `scope`), it reads the
 * matching binding from {@link getBindingsForWorkspace} (synthesized for legacy
 * workspaces), enabling per-source token lookup for the fan-out (LIN-544).
 *
 * @param {Workspace} [workspace] - Workspace object (may be null/undefined)
 * @param {string} [provider] - Select the binding for this provider instead of the active scalar mirror.
 * @param {string} [scope] - Further narrow to this binding scope (requires `provider`).
 * @returns {string|undefined} Credential token, or undefined if none present
 */
export function getWorkspaceToken(workspace, provider, scope) {
  if (provider === undefined) {
    // LIN-3124 PR3 (D1): a connection-backed active workspace never carries a
    // scalar mirror after the cutover — its credential lives in the per-request
    // side-table (hydrated by lib/connection-credential.js). Consult it first;
    // a legacy workspace has no entry and evaluates the verbatim legacy
    // expression, so this is byte-identical for every legacy shape.
    const hydrated = readWorkspaceCredential(workspace);
    if (hydrated) return hydrated.token;
    // Fail closed (D1, T18): an UNHYDRATED connection-backed active binding
    // never falls back to a scalar mirror — a stray one is a decoy, not its
    // credential. No marker on legacy data, so this is the identity there.
    if (activeBindingIsConnectionBacked(workspace)) return undefined;
    return workspace?.credentials?.token ?? workspace?.accessToken;
  }
  const match = getBindingsForWorkspace(workspace).find(
    b => b.provider === provider && (scope === undefined || b.scope === scope)
  );
  return getBindingCredentials(match)?.token;
}

/**
 * The raw scalar-mirror token — `workspace.accessToken`, with NO credential
 * preference. This is the "E2" precedence, deliberately distinct from
 * {@link getWorkspaceToken}'s "E1" (`credentials?.token ?? accessToken`, which
 * prefers `credentials`).
 *
 * LIN-3124 PR1 (S0): the three read sites that need the raw mirror rather than
 * the credential — the audit egress and image-relay header in
 * `routes/workspace-api.js`, and the proactive-refresh expiry check in
 * `server.js` — converge here. The two shapes genuinely diverge after the
 * headless mirror (`lib/workspace-token-refresh.js` refreshes `accessToken` /
 * `tokenExpiresAt` but leaves `credentials.token` stale), which is why E1 must
 * not be reused for these reads. E2 is behaviour-preserving here.
 *
 * @param {Workspace} [workspace] - Workspace object (may be null/undefined)
 * @returns {string|undefined} The raw `accessToken` mirror, or undefined
 */
export function getWorkspaceMirrorToken(workspace) {
  // LIN-3124 PR3 review blocker 1: a connection-backed active binding has no
  // scalar mirror — its credential is the hydrated side-table entry (undefined,
  // i.e. fail closed, when unhydrated). Legacy stays the raw E2 read.
  if (activeBindingIsConnectionBacked(workspace)) return readWorkspaceCredential(workspace)?.token;
  return workspace?.accessToken;
}

/**
 * The raw scalar-mirror expiry — `workspace.tokenExpiresAt`. The expiry-shaped
 * sibling of {@link getWorkspaceMirrorToken}; see it for why this is E2 and not
 * the credential-derived token. LIN-3124 PR1 (S0) conversion target for the
 * `needsTokenRefresh` check in `ensureValidToken` (`server.js`).
 *
 * @param {Workspace} [workspace] - Workspace object (may be null/undefined)
 * @returns {number|undefined} The raw `tokenExpiresAt` mirror, or undefined
 */
export function getWorkspaceTokenExpiry(workspace) {
  // LIN-3124 PR3 review blocker 1: see getWorkspaceMirrorToken.
  if (activeBindingIsConnectionBacked(workspace)) return readWorkspaceCredential(workspace)?.tokenExpiresAt;
  return workspace?.tokenExpiresAt;
}

/**
 * The credential bag for one BINDING (LIN-3124 PR3, D15).
 *
 * A connection-backed binding (`typeof connectionId === 'string'`) carries NO
 * `credentials` of its own after the write cutover — its credential lives in
 * the per-request side-table, written by hydration / the converter
 * (`lib/connection-credential.js`). This returns the hydrated bag, or
 * `undefined` when unhydrated (fail closed — never a stale session copy).
 *
 * For a legacy binding (no `connectionId`) it returns `binding.credentials`
 * unchanged — the SAME object — so every legacy read is byte-identical.
 *
 * @param {ProviderBinding} [binding]
 * @returns {WorkspaceCredentials|undefined}
 */
export function getBindingCredentials(binding) {
  if (!binding) return undefined;
  if (isConnectionBacked(binding)) return readBindingCredential(binding);
  return binding.credentials;
}

/**
 * The first positional argument a provider's read/write methods expect for a
 * single BINDING (LIN-713). Most providers authenticate from the bare credential
 * token, so this returns the token unchanged and the Linear/local read seam stays
 * byte-identical. A GitHub App binding authenticates per-request from its
 * installation token and needs the repo per call, so the argument is a
 * `{ token, repo }` credential built from the binding's own `credentials.token`
 * (the installation token) + `scope` (the `owner/name` repo). See the
 * GitHubProvider `_clientFor` scope contract.
 *
 * A Jira binding (LIN-1885) is a THIRD instance of this same category —
 * "authenticates per-request from a structured credential" — not a new one:
 * Basic auth needs `{email, apiToken, site}`, which a bare token string cannot
 * carry. `binding.credentials` stays the single source of truth (email/token
 * live there; `site` is the binding's own `scope`, mirroring how a GitHub
 * binding's `scope` is its repo) — both scope functions remain pure
 * projections of it, no second credential representation.
 *
 * @param {ProviderBinding} [binding]
 * @returns {string | {token: (string|undefined), repo: (string|undefined)} | {email: (string|undefined), apiToken: (string|undefined), site: (string|undefined)} | undefined}
 */
export function getBindingCallScope(binding) {
  // LIN-3124 PR3 (D15): read through the binding accessor so a connection-backed
  // binding's credential (side-table) is served too; legacy returns the same
  // `binding.credentials` object, so every projection below is byte-identical.
  const creds = getBindingCredentials(binding);
  const token = creds?.token;
  // Ordered first (LIN-1885 research): the guards below are mutually exclusive
  // on `binding.provider`, so placement has no behavioural effect on them, but
  // matches getWorkspaceCallScope's branch order for symmetry.
  if (binding?.provider === 'jira') {
    // LIN-1887 Step 6: a Jira binding now has TWO credential shapes, so this
    // BRANCHES on the explicit `authType` discriminator rather than switching
    // wholesale — the Phase 1 Basic projection below is byte-identical to HEAD,
    // which matters because that binding was validated in production on
    // 2026-08-07 and is still live. An OAuth binding is addressed by `cloudId`
    // through the API gateway; its `scope` stays the human-facing site URL so the
    // `${site}/browse/${key}` deep links keep working.
    if (creds?.authType === 'oauth') {
      return { authType: 'oauth', accessToken: token, cloudId: creds?.cloudId, site: binding.scope };
    }
    return { email: creds?.email, apiToken: token, site: binding.scope };
  }
  if (binding?.provider === 'github') {
    return { token, repo: binding.scope };
  }
  // A GitHub Projects v2 binding (LIN-560) authenticates per-request the same way
  // but carries its board slug under `scope` (the provider's `_clientFor` reads
  // `{ token, scope }`), not `repo`. Distinct key so the two GitHub providers
  // never confuse a board scope for a repo slug.
  if (binding?.provider === 'github-projects') {
    return { token, scope: binding.scope };
  }
  return token;
}

/** Internal marker: the active binding could not be resolved without guessing. */
const AMBIGUOUS = Symbol('ambiguous-binding');

/**
 * The call scope returned when a workspace's active binding cannot be resolved
 * without guessing (LIN-1887 Step 6 / F3.3).
 *
 * NOT `undefined`, and not the first binding's scope. Every provider's
 * `_clientFor` rejects this shape explicitly and loudly, which is the whole
 * point: dropping the scope silently would be swallowed by the github family's
 * `repo ?? null` / `board ?? null` defaults and turn a wrong-repo call into a
 * scope-less one, and falling back to `undefined` would route into the
 * boot-configured client with a misleading "client not configured" message.
 */
export const AMBIGUOUS_CALL_SCOPE = Object.freeze({ ambiguousCallScope: true });

/**
 * Which of a workspace's bindings for `provider` is the ACTIVE one — the binding
 * the scalar credential mirror was written from?
 *
 * The mirrored token is the only identity a workspace records: `linkProvider`
 * (`:290-291`) and `mirrorActiveBinding` (`:414-423`) write `provider`,
 * `credentials`, `accessToken` and `tokenExpiresAt`, and NO scope marker. So the
 * match is on `credentials.token === token`, exactly as before.
 *
 * What changed (LIN-1887 F3.3) is the MISS. The old fallback took the first
 * binding for that provider, which — with two bindings and a mirror matching
 * neither (a rotated token not yet written back to any binding) — pairs site A's
 * scope with site B's token, i.e. authenticates against the wrong tenant or
 * repo. With ONE binding the fallback is unambiguous and stays exactly as it
 * was; with more than one it now REFUSES rather than guesses.
 *
 * Refusing rather than resolving is deliberate. Resolving would mean persisting
 * an active-binding identity on the workspace, which means mutating
 * `linkProvider`/`mirrorActiveBinding` — the keystone every provider flows
 * through — and that is a bigger change than this finding warrants. It is
 * recorded as a named follow-up rather than smuggled in here.
 *
 * @returns {ProviderBinding|typeof AMBIGUOUS|undefined}
 */
function selectActiveBinding(workspace, provider, token) {
  const bindings = getBindingsForWorkspace(workspace).filter(b => b.provider === provider);
  // D2 selection order: legacy mirror match (token equality), then the D2 marker
  // (connection-backed), then the unique binding for the provider, else refuse.
  const matched = bindings.find(b => getBindingCredentials(b)?.token === token);
  if (matched) return matched;
  const marker = workspace?.activeBinding;
  if (marker && marker.provider === provider) {
    const marked = bindings.find(b => b.scope === marker.scope);
    if (marked) return marked;
  }
  if (bindings.length === 1) return bindings[0];
  if (bindings.length > 1) return AMBIGUOUS;
  return undefined;
}

/**
 * D2 (LIN-3124 PR3): is `binding` the ACTIVE binding of `workspace`?
 *
 * The single identity predicate the 5 token-equality sites converge on. Legacy
 * (no `connectionId`): the verbatim expression — the binding's credential token
 * equals the workspace's scalar mirror and the provider matches. Connection-
 * backed: the session-resident `workspace.activeBinding = {provider, scope}`
 * marker is authoritative (a connection-backed binding carries no token to
 * compare).
 *
 * @param {Workspace} workspace
 * @param {ProviderBinding} binding
 * @returns {boolean}
 */
export function isActiveBinding(workspace, binding) {
  if (!workspace || !binding) return false;
  if (binding.provider !== workspace.provider) return false;
  if (isConnectionBacked(binding)) {
    const marker = workspace.activeBinding;
    return !!(marker && marker.provider === binding.provider && marker.scope === binding.scope);
  }
  return getBindingCredentials(binding)?.token === workspace.accessToken;
}

/**
 * {@link getBindingCallScope} for a workspace's ACTIVE binding — the read-scope
 * argument for the single-provider call sites that fetch through
 * `getProviderForWorkspace(workspace)` (dashboard issue load, roadmap, dispatch
 * repo selector). Byte-identical to `getWorkspaceToken(workspace)` for every
 * non-GitHub workspace; for GitHub it pairs the active installation token with
 * the active binding's repo scope so the request-time client can authenticate.
 *
 * @param {Workspace} [workspace]
 * @returns {string | {token: (string|undefined), repo: (string|undefined)} | {email: (string|undefined), apiToken: (string|undefined), site: (string|undefined)} | undefined}
 */
export function getWorkspaceCallScope(workspace) {
  const token = getWorkspaceToken(workspace);
  const provider = workspace?.provider;

  // Jira (LIN-1885): Basic auth needs {email, apiToken, site} — the bare token
  // cannot carry it. A THIRD instance of "authenticates per-request from a
  // structured credential" (alongside github/github-projects below), not a new
  // category — see getBindingCallScope. Ordered BEFORE the github-family guard
  // per the LIN-1885 research: the guards are mutually exclusive on `provider`
  // so this has no behavioural effect on the github-family branch, but avoids
  // ever widening a future slice keyed on that guard's boundary.
  if (provider === 'jira') {
    const active = selectActiveBinding(workspace, 'jira', token);
    if (active === AMBIGUOUS) return AMBIGUOUS_CALL_SCOPE;
    const activeCreds = getBindingCredentials(active);
    if (activeCreds?.authType === 'oauth') {
      return { authType: 'oauth', accessToken: token, cloudId: activeCreds?.cloudId, site: active.scope };
    }
    return { email: activeCreds?.email, apiToken: token, site: active?.scope };
  }

  // Only the per-request GitHub providers (and Jira, above) need a scoped
  // credential; every other provider authenticates from the bare token
  // (byte-identical). Missing this branch for github-projects (LIN-560) would
  // silently break active-provider drill-down — fetchIssueFields/next-run/
  // task-chat/workspace-api all read here.
  if (provider !== 'github' && provider !== 'github-projects') return token;
  const active = selectActiveBinding(workspace, provider, token);
  if (active === AMBIGUOUS) return AMBIGUOUS_CALL_SCOPE;
  // Issues threads { token, repo }; Projects threads { token, scope } (its
  // `_clientFor` reads the board slug from `scope`).
  return provider === 'github'
    ? { token, repo: active?.scope }
    : { token, scope: active?.scope };
}

/**
 * The back-compat provider NAME normalization, as a value rather than a
 * predicate (LIN-1887 G2).
 *
 * A legacy pre-binding workspace carries no `provider` at all, and the whole
 * codebase reads that absence as `'linear'` — at
 * {@link applyAccessTokenToWorkspace} (`:203`), in `getBindingsForWorkspace`'s
 * synthesis (`:471`), and in {@link isActiveProviderLinear} below. LIN-1887
 * needs the same rule to produce a KEY (the refresh-strategy table lookup and
 * the durable credential store's partition), not a boolean, and a table keyed
 * on the raw `workspace.provider` with an `undefined` entry is exactly the
 * one-character mutation that silently breaks every legacy workspace.
 *
 * Split in two so both shapes share one rule: this takes a bare name (what the
 * store has — it holds a `provider` field, not a workspace), and
 * {@link normalizeProvider} takes a workspace.
 *
 * @param {string} [provider] - a provider name, possibly absent (legacy)
 * @returns {string} the normalized provider name
 */
export function normalizeProviderName(provider) {
  return provider || 'linear';
}

/**
 * {@link normalizeProviderName} for a workspace — `(workspace?.provider || 'linear')`.
 *
 * The reusable artefact behind {@link isActiveProviderLinear}, which is a
 * predicate and therefore cannot key anything. Re-expressed through this so the
 * two can never drift, which means `isActiveProviderLinear`'s existing legacy
 * positive controls (`tests/unit/audit-route-provider-guard.test.js`,
 * `tests/unit/image-proxy.test.js`) cover this too.
 *
 * @param {Workspace} [workspace]
 * @returns {string} the workspace's active provider name, defaulted for legacy
 */
export function normalizeProvider(workspace) {
  return normalizeProviderName(workspace?.provider);
}

/**
 * Is the workspace's ACTIVE binding Linear? (LIN-1899)
 *
 * The guard predicate for the Linear-SPECIFIC consumers that read the
 * provider-agnostic scalar mirror `workspace.accessToken` (written for every
 * provider by `linkProvider` at `:303` and `mirrorActiveBinding` at `:417`) and
 * hand it to a statically Linear-bound egress. Without it, a Jira-active
 * workspace sends its raw Jira API token to `api.linear.app` — credential
 * disclosure to an unrelated third party, which is the defect LIN-1899 fixes.
 *
 * Deliberately `linear`-ONLY, never `linear` OR `local` — the rule settled by
 * LIN-1891 and shipped inline at `routes/proxy.js:2477`. A local workspace's
 * "credential" is its urlKey (`routes/workspace.js:96-97`), meaningless to
 * Linear, so sending it is itself a (low-value) cross-provider egress.
 *
 * Written as `(provider || 'linear') === 'linear'` rather than
 * `provider === 'linear'` precisely so a LEGACY providerless workspace still
 * counts as Linear, mirroring the normalization at
 * {@link applyAccessTokenToWorkspace} (`:203`) and `getBindingsForWorkspace`'s
 * synthesis. Dropping that fallback would silently strip the Authorization
 * header from every pre-binding workspace; the legacy positive controls in
 * `tests/unit/audit-route-provider-guard.test.js` and
 * `tests/unit/image-proxy.test.js` exist to catch exactly that mutation.
 *
 * This answers "is the ACTIVE binding Linear?" — a WORKSPACE-level question.
 * Do NOT use it on a per-issue path; that axis is {@link resolveIssueBinding}
 * (LIN-1904), which resolves the issue's OWN binding, not the active one.
 *
 * @param {Workspace} [workspace]
 * @returns {boolean} true when the active binding is Linear (including legacy providerless)
 */
export function isActiveProviderLinear(workspace) {
  return normalizeProvider(workspace) === 'linear';
}

/**
 * The maximum length accepted for a binding-selector field (`source` /
 * `bindingScope`). A longer value is a malformed selector, refused as
 * `UNKNOWN_BINDING` rather than scanned against the workspace (LIN-3240).
 */
const MAX_BINDING_SELECTOR_LENGTH = 200;

/**
 * LIN-3241 (F): the three resolver intents the proxy seam declares. A missing or
 * unrecognised intent fails closed as `ISSUE` — a route that forgets to declare
 * cannot silently guess on an issue read.
 */
export const BINDING_INTENT = Object.freeze({ ISSUE: 'ISSUE', CREATE: 'CREATE', WORKSPACE: 'WORKSPACE' });

/**
 * Normalize the two selector shapes the resolvers accept: a bare `source`
 * string (the pre-existing caller convention) or an object
 * `{source, bindingScope}`. Never mutates the input.
 *
 * @param {string|{source?: string, bindingScope?: string}|null|undefined} selector
 * @returns {{source: *, bindingScope: *}}
 */
function normalizeBindingSelector(selector) {
  if (typeof selector === 'string') return { source: selector, bindingScope: undefined };
  if (selector && typeof selector === 'object') {
    return { source: selector.source, bindingScope: selector.bindingScope };
  }
  return { source: undefined, bindingScope: undefined };
}

/** The scopes bound to `provider` on this workspace (the refusal's `bindings` list). */
function bindingScopesFor(workspace, provider) {
  return getBindingsForWorkspace(workspace)
    .filter(b => b.provider === provider)
    .map(b => b.scope);
}

/**
 * True when the workspace carries any connection-backed binding (the v1
 * fresh-account shape). A legacy connection-less workspace is false, which is
 * what keeps its resolution byte-identical to the pre-LIN-3240 behaviour.
 */
function workspaceHasConnectionBackedBinding(workspace) {
  return getBindingsForWorkspace(workspace).some(isConnectionBacked) || !!activeConnectionBackedBinding(workspace);
}

/**
 * The success half of the resolver contract. The pair is exactly
 * `{provider, callScope}` — the same shape `resolveIssueBinding` returned before
 * LIN-3240, so single-binding and legacy callers stay byte-identical. Callers
 * that need the binding object itself use {@link findBindingBySelector}.
 */
function resolvedBindingResult(binding) {
  return {
    provider: getProvider(binding.provider),
    callScope: getBindingCallScope(binding),
  };
}

/** The refusal half: one shape, translated to HTTP by {@link bindingRefusalResponse}. */
function bindingRefusal(code, provider, bindings) {
  return { error: { code, provider: provider ?? null, bindings: bindings ?? [] } };
}

/**
 * Find the exact `(provider, scope)` binding a selector names, with NO store
 * access (LIN-3240, parent LIN-3126 §1). This is the shared selection rule the
 * strict and default resolvers below both consume.
 *
 * Matching is case-sensitive and trimmed on both fields, capped at
 * {@link MAX_BINDING_SELECTOR_LENGTH} characters, and string-typed only: an
 * array or object (or a blank field) is a malformed selector and refuses as
 * `UNKNOWN_BINDING`. A valid selector with no matching binding refuses the same
 * way — never the active binding, never `matches[0]`.
 *
 * @param {Workspace} workspace
 * @param {{source?: string, bindingScope?: string}|string} selector
 * @returns {{binding: Object}|{error: {code: string, provider: (string|null), bindings: string[]}}}
 */
export function findBindingBySelector(workspace, selector) {
  const { source, bindingScope } = normalizeBindingSelector(selector);
  const provider = typeof source === 'string' ? source.trim() : null;
  const scope = typeof bindingScope === 'string' ? bindingScope.trim() : null;

  if (
    typeof source !== 'string' || typeof bindingScope !== 'string' ||
    !provider || !scope ||
    provider.length > MAX_BINDING_SELECTOR_LENGTH ||
    scope.length > MAX_BINDING_SELECTOR_LENGTH
  ) {
    return {
      error: {
        code: 'UNKNOWN_BINDING',
        provider,
        bindings: provider ? bindingScopesFor(workspace, provider) : [],
      },
    };
  }

  const binding = getBindingsForWorkspace(workspace).find(
    b => b.provider === provider && b.scope === scope
  );
  if (!binding) {
    return { error: { code: 'UNKNOWN_BINDING', provider, bindings: bindingScopesFor(workspace, provider) } };
  }
  return { binding };
}

/**
 * Resolve the provider + call scope for a SINGLE issue, given the issue's own
 * binding selector. STRICT (LIN-3240, parent LIN-3126 §1): for an
 * issue-addressed caller the issue's own `(provider, scope)` binding is the
 * only correct answer, so a same-provider pair that cannot be disambiguated
 * refuses (`BINDING_REQUIRED`) rather than falling back to the active binding
 * or `matches[0]`.
 *
 * Selector shapes: `{source, bindingScope}` (preferred, the issue row's own
 * stamps) or a bare `source` string (the existing caller convention). The
 * `bindingScope` is selection-only — it selects the binding, and the call scope
 * always comes from {@link getBindingCallScope} of that hydrated binding, so it
 * can never become a credential.
 *
 * The §1 table:
 *   - `source` + `bindingScope`: the exact match; no match → `UNKNOWN_BINDING`.
 *   - `source` only, one binding for that provider: that binding (byte-identical
 *     to today).
 *   - `source` only, >1 bindings for a connection-backed provider:
 *     `BINDING_REQUIRED`. Legacy connection-less workspaces keep today's
 *     active-preference (`matches.find(token) || matches[0]`) exactly.
 *   - neither, single-binding or legacy: the active pair, as today.
 *   - neither, multi-binding connection-backed with >1 bindings for the active
 *     provider: `BINDING_REQUIRED`; otherwise the active pair.
 *   - an unmatched `source` falls through to the active pair (unchanged).
 *
 * @param {Workspace} workspace
 * @param {string|{source?: string, bindingScope?: string}|null} [selector]
 * @returns {{provider: Object, callScope: *}|{error: {code: string, provider: (string|null), bindings: string[]}}}
 */
/**
 * The selection half of {@link resolveIssueBinding}, returning the BINDING
 * object itself (LIN-3241 (E)) so the connection-first arm can read its
 * `connectionId` and scope without re-deriving the selection rule.
 *
 * @returns {{binding: Object}|{fallthrough: true}|{error: {code: string, provider: (string|null), bindings: string[]}}}
 */
export function selectIssueBinding(workspace, selector) {
  const { source, bindingScope } = normalizeBindingSelector(selector);

  // §1 row 1: both fields present → the exact `(provider, scope)` match, or a refusal.
  if (bindingScope !== undefined && bindingScope !== null) {
    const found = findBindingBySelector(workspace, { source, bindingScope });
    if (found.error) return found;
    return { binding: found.binding };
  }

  if (source !== undefined && source !== null) {
    const matches = typeof source === 'string'
      ? getBindingsForWorkspace(workspace).filter(b => b.provider === source)
      : [];

    // §1 row 2: exactly one binding for the provider — unambiguous.
    if (matches.length === 1) return { binding: matches[0] };

    // §1 row 3: >1 bindings. Connection-backed refuses; legacy keeps today's
    // active-preference expression byte-for-byte.
    if (matches.length > 1) {
      if (matches.some(isConnectionBacked)) {
        return bindingRefusal('BINDING_REQUIRED', source, matches.map(b => b.scope));
      }
      const token = getWorkspaceToken(workspace);
      const matched = matches.find(b => getBindingCredentials(b)?.token === token) || matches[0];
      return { binding: matched };
    }
    // Zero matches: fall through to the workspace-level pair (unchanged).
  }

  // §1 rows 4/5: neither. On a multi-binding connection-backed workspace whose
  // ACTIVE provider has more than one binding, refuse rather than guess.
  if (workspaceHasConnectionBackedBinding(workspace)) {
    const activeProvider = normalizeProviderName(workspace?.provider);
    const activeMatches = getBindingsForWorkspace(workspace).filter(b => b.provider === activeProvider);
    if (activeMatches.some(isConnectionBacked) && activeMatches.length > 1) {
      return bindingRefusal('BINDING_REQUIRED', activeProvider, activeMatches.map(b => b.scope));
    }
  }
  return { fallthrough: true };
}

export function resolveIssueBinding(workspace, selector) {
  const selection = selectIssueBinding(workspace, selector);
  if (selection.error) return selection;
  if (selection.binding) return resolvedBindingResult(selection.binding);
  return {
    provider: getProviderForWorkspace(workspace),
    callScope: getWorkspaceCallScope(workspace),
  };
}

/**
 * The explicit DEFAULT binding for a workspace-level or creation caller
 * (LIN-3240, parent LIN-3126 §1/§2). Unlike {@link resolveIssueBinding} this
 * NEVER refuses for ambiguity:
 *
 *   - no selector: the LIN-3124 active marker's binding
 *     ({@link activeConnectionBackedBinding}); for a legacy or marker-less
 *     workspace, today's `getProviderForWorkspace` + `getWorkspaceCallScope`
 *     pair.
 *   - `source` + `bindingScope`: honoured only when it validates through
 *     {@link findBindingBySelector} (so writing to a non-default binding is an
 *     explicit, validated pair; an unknown one refuses `UNKNOWN_BINDING`, never
 *     a silent default pick).
 *   - `source` only (review F8 / autopilot ruling): that provider's sole binding
 *     when it has exactly one; otherwise the default binding (never an ambiguity
 *     refusal); a provider with no binding refuses `UNKNOWN_BINDING`.
 *
 * @param {Workspace} workspace
 * @param {string|{source?: string, bindingScope?: string}|null} [selector]
 * @returns {{provider: Object, callScope: *}|{error: {code: string, provider: (string|null), bindings: string[]}}}
 */
/**
 * The selection half of {@link resolveDefaultBinding}, returning the BINDING
 * object itself (LIN-3241 (E)) so the connection-first arm can read its
 * `connectionId` and scope.
 *
 * @returns {{binding: Object}|{fallthrough: true}|{error: {code: string, provider: (string|null), bindings: string[]}}}
 */
export function selectDefaultBinding(workspace, selector) {
  const { source, bindingScope } = normalizeBindingSelector(selector);

  // Both fields present: the explicit, validated `(provider, scope)` pair. An
  // unknown one refuses `UNKNOWN_BINDING`, never a silent default pick.
  if (bindingScope !== undefined && bindingScope !== null) {
    const found = findBindingBySelector(workspace, { source, bindingScope });
    if (found.error) return found;
    return { binding: found.binding };
  }

  // LIN-3240 (review F8 / autopilot ruling): a `source`-only selector is a
  // legitimate creation/scan-due hint and must NOT newly 422 a single-binding
  // workspace (byte-identity) nor refuse for ambiguity:
  //   - exactly one binding for the provider → that binding;
  //   - more than one → fall through to the explicit default below (today's
  //     ignore-the-hint behaviour; a default pick is never an ambiguity error);
  //   - no binding for the provider → `UNKNOWN_BINDING` (a genuinely invalid
  //     target).
  if (source !== undefined && source !== null) {
    const matches = typeof source === 'string'
      ? getBindingsForWorkspace(workspace).filter(b => b.provider === source)
      : [];
    if (matches.length === 1) return { binding: matches[0] };
    if (matches.length === 0) {
      return bindingRefusal('UNKNOWN_BINDING', typeof source === 'string' ? source : null, []);
    }
  }

  const active = activeConnectionBackedBinding(workspace);
  if (active) return { binding: active };
  return { fallthrough: true };
}

export function resolveDefaultBinding(workspace, selector) {
  const selection = selectDefaultBinding(workspace, selector);
  if (selection.error) return selection;
  if (selection.binding) return resolvedBindingResult(selection.binding);
  return {
    provider: getProviderForWorkspace(workspace),
    callScope: getWorkspaceCallScope(workspace),
  };
}

/**
 * Translate a resolver refusal into the single HTTP shape the ticket specifies:
 * `422 {code:'BINDING_REQUIRED'|'UNKNOWN_BINDING', provider, bindings:[scopes]}`.
 * Callers keep their ordinary success destructure; only the refusal branch
 * routes through here (LIN-3240, parent LIN-3126 §1).
 *
 * @param {{error?: {code: string, provider?: (string|null), bindings?: string[]}, code?: string, provider?: (string|null), bindings?: string[]}} result
 * @returns {{status: number, body: {code: string, provider: (string|null), bindings: string[]}}}
 */
export function bindingRefusalResponse(result) {
  const error = result?.error || result || {};
  return {
    status: 422,
    body: {
      code: error.code ?? 'BINDING_REQUIRED',
      provider: error.provider ?? null,
      bindings: Array.isArray(error.bindings) ? error.bindings : [],
    },
  };
}

/**
 * The persisted dispatch-row selector fields for an issue-addressed request that
 * supplied a COMPLETE `(source, bindingScope)` pair (LIN-3242 / LIN-3126 §4).
 *
 * The proxy seam's `findBindingBySelector` matches the TRIMMED pair, so this
 * returns exactly those trimmed strings — never the raw padded body values the
 * enqueue lanes used to store. A lone `source` is a selection hint, not a
 * persisted pair (the session lane keeps it as a hint only), and a non-string or
 * blank field is never written. Returns an empty object when nothing should be
 * stamped, so a caller spreads it into `fields` and an unstamped row adds no key
 * (the S0 sparse contract).
 *
 * Validation is the seam's: the caller gates on the issue being named and
 * passes the `selectedBinding` the ISSUE-arm resolution reported (the binding
 * `findBindingBySelector` selected for this pair — an unknown pair refused before
 * any row is written). The pair is stamped ONLY when it equals that binding's
 * `(provider, scope)`. With no `selectedBinding` — selection never ran, e.g. the
 * owner has no session row (LIN-3241 F1's headless path, review R3) — nothing is
 * stamped, so an unvalidated pair can never reach a row. It never carries a
 * credential — selection-only provenance (B1 / LIN-2473).
 *
 * @param {*} issueSource
 * @param {*} issueBindingScope
 * @param {{provider: string, scope: string}|null|undefined} selectedBinding
 * @returns {{issueSource: string, issueBindingScope: string}|{}}
 */
export function dispatchBindingPairFields(issueSource, issueBindingScope, selectedBinding) {
  if (typeof issueSource !== 'string' || typeof issueBindingScope !== 'string') return {};
  const source = issueSource.trim();
  const scope = issueBindingScope.trim();
  if (!source || !scope) return {};
  if (!selectedBinding || selectedBinding.provider !== source || selectedBinding.scope !== scope) return {};
  return { issueSource: source, issueBindingScope: scope };
}

// =============================================================================
// URL Key Helpers
// =============================================================================

/**
 * Valid urlKey pattern: alphanumeric and hyphens, 1-50 chars.
 * Matches Linear's workspace URL key format.
 */
export const URL_KEY_REGEX = /^[a-z0-9-]{1,50}$/i;

/**
 * Find a workspace in session by its urlKey.
 * @param {WorkspaceSession} session - Express session object
 * @param {string} urlKey - Workspace URL key to find
 * @returns {Workspace|null} Matching workspace or null
 */
export function getWorkspaceByUrlKey(session, urlKey) {
  if (!session.workspaces?.length || !urlKey) return null;
  return session.workspaces.find(w => w.urlKey === urlKey) || null;
}

/**
 * Validate that a urlKey matches expected format.
 * @param {string} urlKey - URL key to validate
 * @returns {boolean} True if valid format
 */
export function validateWorkspaceUrlKey(urlKey) {
  if (typeof urlKey !== 'string') return false;
  return URL_KEY_REGEX.test(urlKey);
}
