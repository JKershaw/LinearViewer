/**
 * Renewal for a SECONDARY (non-active) connection-backed binding (LIN-3774,
 * widened by LIN-3790).
 *
 * A Linear-primary workspace can carry a GitHub binding on a shared installation
 * connection. Installation tokens live ~1h and only the ACTIVE binding was ever
 * re-minted (`ensureValidToken`, `handleUnauthorizedError`), so the secondary's
 * token silently expired an hour after the last GitHub-primary visit and the
 * dashboard 503'd. This module is the one seam that re-mints such a binding:
 * proactively (`ensureFresh`, before it is used) and reactively (`remint`, after
 * a tagged 401). The re-mint itself is `refreshConnectionForWorkspace`, injected
 * — this module mints nothing and never touches an owner token (LIN-3285).
 *
 * Two predicates, because "can this be renewed?" and "is this a secondary, so
 * route around the active ladder and degrade?" are different questions (LIN-3790):
 * - `isSecondaryRenewable`: connection-backed, re-mint kind (`github`,
 *   `github-projects`) OR refresh-token kind (`linear`, `jira`; both go through
 *   `refreshConnectionForWorkspace` -> `runConnectionRefresh`), not the active
 *   binding, and hydrated (LIN-3124 PR3 fails closed on an unauthorized
 *   connection; `refreshConnectionForWorkspace` requires the caller to have
 *   authorized first). Drives `ensureFresh`/`ensureFreshAll`/`remint`.
 * - `isSecondaryBinding`: ANY non-active binding, legacy included. Drives the
 *   dashboard degrade and the handler's "skip the active ladder" decision. A
 *   legacy secondary (no `connectionId`) is never renewed here: that would need a
 *   second, per-binding write-back path; moving legacy bindings onto Connections
 *   is LIN-2150. It is degraded to a source notice instead, and its 401 no longer
 *   spends the active binding's refresh or removes the workspace.
 * Never throws: a failed renewal is logged and reported as `false`, leaving the
 * reactive path and the existing 401 handling to take over.
 */
import { isConnectionBacked, isRemintKind, isRefreshTokenKind } from './connection-binding.js';
import { getBindingCredentials, isActiveBinding, normalizeProvider } from './workspace.js';
import { TOKEN_REFRESH_BUFFER_MS } from './workspace-token-resolver.js';

/**
 * @param {Object} deps
 * @param {function(Object, string, string): Promise<{token: string, expiresAt?: number}|null>} deps.refreshConnectionForWorkspace
 * @param {function(Object, {token: string, expiresAt?: number}): boolean} deps.applyRefreshed - writes the fresh token onto ONE binding (the per-request side-table)
 * @param {function(): number} [deps.now]
 * @param {number} [deps.bufferMs]
 * @param {{error: function}} [deps.logger]
 */
export function createSecondaryBindingRemint({
  refreshConnectionForWorkspace,
  applyRefreshed,
  now = Date.now,
  bufferMs = TOKEN_REFRESH_BUFFER_MS,
  logger = console,
}) {
  // Binding objects this seam has tried to renew. Session binding objects are
  // rebuilt on every request, so this is per-request in effect. It caps a stale
  // token whose renewal keeps failing at 2 attempts per page load: one proactive
  // (`ensureFresh` skips a binding already in the set) and one reactive (`remint`
  // always tries once, then adds).
  const attempted = new WeakSet();

  function isSecondaryRenewable(workspace, binding) {
    return !!binding
      && isConnectionBacked(binding)
      && (isRemintKind(binding.provider) || isRefreshTokenKind(binding.provider))
      && !isActiveBinding(workspace, binding)
      && getBindingCredentials(binding) !== undefined;
  }

  // Any non-active binding. A connection-backed binding reuses `isActiveBinding`.
  // A legacy one must NOT: `isActiveBinding` compares `binding.provider` to the
  // un-normalised `workspace.provider`, so on a legacy workspace with no
  // `provider` its only (linear) binding reads as "not active" and a single-source
  // workspace's real 401 would be swallowed into an empty dashboard. One source
  // per kind (LIN-3334) makes the normalised provider check exact, and it is
  // immune to the `credentials.token` drift LIN-3464 documented.
  function isSecondaryBinding(workspace, binding) {
    if (!binding) return false;
    if (isConnectionBacked(binding)) return !isActiveBinding(workspace, binding);
    return binding.provider !== normalizeProvider(workspace);
  }

  async function mint(workspace, binding, accountId) {
    attempted.add(binding);
    try {
      const refreshed = await refreshConnectionForWorkspace(
        { _id: binding.connectionId, provider: binding.provider },
        accountId,
        workspace.urlKey,
      );
      if (!refreshed?.token) return false;
      return applyRefreshed(binding, refreshed) === true;
    } catch (error) {
      logger.error(`Secondary ${binding.provider} binding renewal failed (workspace ${workspace?.id}):`, error);
      return false;
    }
  }

  /** Proactive: renew when the hydrated expiry is within the buffer. @returns {Promise<boolean>} true when renewed */
  async function ensureFresh(workspace, binding, accountId) {
    if (!isSecondaryRenewable(workspace, binding) || attempted.has(binding)) return false;
    // The hydrated side-table entry, never `binding.tokenExpiresAt` or
    // `binding.credentials.tokenExpiresAt`: sanitizeSessionForPersist drops
    // `credentials` on every persist, so those are always undefined and this
    // arm would silently never fire. Unknown expiry skips; the reactive arm decides.
    const expiry = getBindingCredentials(binding)?.tokenExpiresAt;
    if (typeof expiry !== 'number' || !Number.isFinite(expiry)) return false;
    if (expiry - now() >= bufferMs) return false;
    return mint(workspace, binding, accountId);
  }

  /** Proactive over every secondary binding of the workspace. */
  async function ensureFreshAll(workspace, accountId) {
    for (const binding of workspace?.bindings || []) {
      await ensureFresh(workspace, binding, accountId);
    }
  }

  /** Reactive: renew once regardless of expiry; a no-op (false) for a non-renewable secondary. @returns {Promise<boolean>} */
  async function remint(workspace, binding, accountId) {
    if (!isSecondaryRenewable(workspace, binding)) return false;
    return mint(workspace, binding, accountId);
  }

  /** Resolve a fetchAndPrepareProjects `error.binding` tag to the live SECONDARY binding (renewable or not), or null. */
  function bindingForError(workspace, error) {
    const tag = error?.binding;
    if (!tag) return null;
    const binding = (workspace?.bindings || []).find(b =>
      b && b.provider === tag.provider && b.scope === tag.scope && b.connectionId === tag.connectionId);
    return isSecondaryBinding(workspace, binding) ? binding : null;
  }

  return { isSecondaryBinding, isSecondaryRenewable, ensureFresh, ensureFreshAll, remint, bindingForError };
}
