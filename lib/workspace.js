/**
 * Multi-workspace session management helpers.
 * Handles workspace CRUD operations within Express sessions.
 */
import { calculateExpiresAt } from './token-refresh.js'
import { getProvider, getProviderForWorkspace } from './providers/registry.js'

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
 * @param {string} [refreshToken] - the durable rotating credential to persist (absent for a non-refreshable provider, e.g. GitHub-family)
 */
export async function persistOwnerCredential(accountId, workspace, store, refreshToken) {
  const active = workspace.bindings?.find(b => b.provider === workspace.provider);
  await store.put(accountId, workspace.urlKey, {
    provider: workspace.provider,
    scope: active?.scope,
    token: workspace.accessToken,
    refreshToken,
    tokenExpiresAt: workspace.tokenExpiresAt
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
    bindings.find(b => b.provider === workspace.provider && b.credentials?.token === workspace.accessToken) ||
    bindings.find(b => b.provider === workspace.provider) ||
    bindings[0];
  if (!active) {
    throw new Error('remintActiveCredential: workspace has no provider binding to refresh');
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
    return workspace?.credentials?.token ?? workspace?.accessToken;
  }
  const match = getBindingsForWorkspace(workspace).find(
    b => b.provider === provider && (scope === undefined || b.scope === scope)
  );
  return match?.credentials?.token;
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
  const token = binding?.credentials?.token;
  // Ordered first (LIN-1885 research): the guards below are mutually exclusive
  // on `binding.provider`, so placement has no behavioural effect on them, but
  // matches getWorkspaceCallScope's branch order for symmetry.
  if (binding?.provider === 'jira') {
    return { email: binding.credentials?.email, apiToken: token, site: binding.scope };
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
    const bindings = getBindingsForWorkspace(workspace);
    const active =
      bindings.find(b => b.provider === 'jira' && b.credentials?.token === token) ||
      bindings.find(b => b.provider === 'jira');
    return { email: active?.credentials?.email, apiToken: token, site: active?.scope };
  }

  // Only the per-request GitHub providers (and Jira, above) need a scoped
  // credential; every other provider authenticates from the bare token
  // (byte-identical). Missing this branch for github-projects (LIN-560) would
  // silently break active-provider drill-down — fetchIssueFields/next-run/
  // task-chat/workspace-api all read here.
  if (provider !== 'github' && provider !== 'github-projects') return token;
  const bindings = getBindingsForWorkspace(workspace);
  const active =
    bindings.find(b => b.provider === provider && b.credentials?.token === token) ||
    bindings.find(b => b.provider === provider);
  // Issues threads { token, repo }; Projects threads { token, scope } (its
  // `_clientFor` reads the board slug from `scope`).
  return provider === 'github'
    ? { token, repo: active?.scope }
    : { token, scope: active?.scope };
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
  return (workspace?.provider || 'linear') === 'linear';
}

/**
 * Resolve the provider + call scope for a SINGLE issue, given the `source`
 * provenance stamp (LIN-561's `provider.name`) the merged dashboard tree
 * (LIN-544) already carries on every foreign-source row. Sibling of
 * {@link getWorkspaceCallScope}: same one-return-pairs-both-values contract,
 * but resolves the issue's OWN binding instead of always the active one
 * (LIN-1904, the per-binding follow-up to LIN-581/LIN-1903).
 *
 * When `source` is absent or matches no binding, falls back to the
 * workspace's active provider/scope — byte-identical to
 * `{ provider: getProviderForWorkspace(workspace), callScope: getWorkspaceCallScope(workspace) }`
 * for every single-binding workspace.
 *
 * When `source` names a provider with exactly one binding, that binding
 * resolves unambiguously. When it names a provider with MULTIPLE bindings
 * (two GitHub repos, two Jira sites), this prefers the binding whose
 * credential matches the workspace's active mirror — the same
 * active-preference idiom `getWorkspaceCallScope`/`remintActiveCredential`
 * already use (`:578-580`, `:591-593`, `:335-337`) — before falling back to
 * the first match. First-match-only would let a write route
 * (`PATCH /api/issues`) silently target the wrong binding whenever a
 * workspace holds two same-provider bindings; the active-preference fallback
 * closes that for the common case. The genuinely unresolvable residual — a
 * foreign row from the *non-active* binding of a same-provider pair — cannot
 * be disambiguated by a provider-name `source` alone and is out of scope
 * (would need a binding-instance identifier, not introduced here).
 *
 * @param {Workspace} workspace
 * @param {string} [source] - Provider registry `.name` stamped on the issue (`issueSource(issue)`).
 * @returns {{provider: Object, callScope: (string | {token: (string|undefined), repo: (string|undefined)} | {token: (string|undefined), scope: (string|undefined)} | {email: (string|undefined), apiToken: (string|undefined), site: (string|undefined)} | undefined)}}
 */
export function resolveIssueBinding(workspace, source) {
  const matches = typeof source === 'string' && source
    ? getBindingsForWorkspace(workspace).filter(b => b.provider === source)
    : [];
  const token = getWorkspaceToken(workspace);
  const matchedBinding = matches.find(b => b.credentials?.token === token) || matches[0] || null;

  if (matchedBinding) {
    return {
      provider: getProvider(matchedBinding.provider),
      callScope: getBindingCallScope(matchedBinding),
    };
  }
  return {
    provider: getProviderForWorkspace(workspace),
    callScope: getWorkspaceCallScope(workspace),
  };
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
