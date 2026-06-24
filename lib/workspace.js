/**
 * Multi-workspace session management helpers.
 * Handles workspace CRUD operations within Express sessions.
 */
import { calculateExpiresAt } from './token-refresh.js'

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
 * @property {string} [refreshToken] - OAuth refresh token (absent for PAT)
 * @property {number} tokenExpiresAt - Token expiry timestamp (ms since epoch)
 * @property {boolean} [isPAT] - Whether this workspace uses a personal access token (no refresh)
 * @property {number} addedAt - Timestamp when workspace was added (ms since epoch)
 */

/**
 * Generic provider credential bag carried on a workspace.
 * @typedef {Object} WorkspaceCredentials
 * @property {string} token - Provider access/personal token (new home for legacy `accessToken`).
 * @property {string} [refreshToken] - OAuth refresh token (absent for non-OAuth providers like local/PAT).
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

// Permissive check for Linear issue IDs — accepts UUIDs and identifiers
// (e.g. LIN-123, M5-100, WEB2-7). Linear's API rejects truly bad IDs;
// this just blocks obviously-malformed input from reaching it.
export const ISSUE_ID_REGEX = /^[A-Za-z0-9-]{1,100}$/;

export function isValidIssueId(id) {
  return typeof id === 'string' && ISSUE_ID_REGEX.test(id);
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
    session.workspaces[index] = { ...session.workspaces[index], ...workspace };
  } else {
    // Add new (check limit)
    if (session.workspaces.length >= MAX_WORKSPACES) {
      throw new Error(`Maximum of ${MAX_WORKSPACES} workspaces allowed`);
    }
    session.workspaces.push(workspace);
  }
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
 * @param {Workspace} workspace - Workspace object to update
 * @param {Object} tokenData - Token response from OAuth flow
 * @param {string} tokenData.access_token - New access token
 * @param {string} tokenData.refresh_token - New refresh token
 * @param {number} tokenData.expires_in - Token lifetime in seconds
 */
export function updateWorkspaceTokens(workspace, tokenData) {
  // Legacy top-level fields (back-compat for un-migrated read sites).
  workspace.accessToken = tokenData.access_token;
  workspace.refreshToken = tokenData.refresh_token;
  workspace.tokenExpiresAt = calculateExpiresAt(tokenData.expires_in);
  // Generalized provider-aware shape. Spread any existing credentials so other
  // provider-specific fields survive a token refresh; only the token rotates.
  // LIN-561: preserve an already-set provider (e.g. a non-Linear workspace
  // re-authing) instead of clobbering it to 'linear'; default to Linear only
  // when unset, since the Linear OAuth callback is the sole writer today. The
  // default is an explicit legacy fallback, not a blanket Linear assumption.
  workspace.provider = workspace.provider || 'linear';
  workspace.credentials = { ...workspace.credentials, token: tokenData.access_token };

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
      token: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: workspace.tokenExpiresAt,
    };
  }
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
  const merged = { ...(index >= 0 ? workspace.bindings[index].credentials : {}), ...credentials };
  const binding = { provider, scope, credentials: merged };
  if (index >= 0) workspace.bindings[index] = binding;
  else workspace.bindings.push(binding);

  // Default the active provider when unset (first link wins); never clobber an
  // already-active provider — preserves LIN-561's default-when-unset semantics.
  const isActive = !workspace.provider || workspace.provider === provider;
  workspace.provider = workspace.provider || provider;

  // Back-compat scalar mirror — only for the active binding (see above).
  if (isActive) {
    workspace.credentials = { ...workspace.credentials, token: merged.token };
    workspace.accessToken = merged.token;
    if (merged.refreshToken !== undefined) workspace.refreshToken = merged.refreshToken;
    if (merged.tokenExpiresAt !== undefined) workspace.tokenExpiresAt = merged.tokenExpiresAt;
  }

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
  if (workspace.refreshToken !== undefined) credentials.refreshToken = workspace.refreshToken;
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
    return workspace?.credentials?.token ?? workspace?.accessToken;
  }
  const match = getBindingsForWorkspace(workspace).find(
    b => b.provider === provider && (scope === undefined || b.scope === scope)
  );
  return match?.credentials?.token;
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
