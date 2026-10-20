/**
 * Best-effort write of a workspace's `{id, urlKey, provider}` into the urlKey
 * registry (LIN-3700, step 1 of LIN-3394). Write-only: nothing reads the row
 * back yet, and the caller's bind, session and redirect must never depend on
 * it — every failure (a synchronous throw included) is swallowed and logged.
 *
 * Callers `await` it with no timeout (same exposure as the account-workspace
 * edge write in lib/account-session.js). The store gets ONLY the three named
 * values, never the workspace itself: a workspace carries tokens.
 */
import { normalizeProvider } from './workspace.js';

/**
 * @param {import('./workspace-store.js').WorkspaceStore|undefined} workspaceStore
 * @param {import('./workspace.js').Workspace} workspace - read, never mutated
 * @param {{logger?: {log?: Function}}} [options]
 * @returns {Promise<void>}
 */
export async function recordWorkspace(workspaceStore, workspace, { logger = console } = {}) {
  const log = (line) => { try { logger.log(line) } catch { /* logging must not throw */ } };
  try {
    if (!workspaceStore || typeof workspaceStore.registerWorkspace !== 'function') {
      log('[workspace-registry] skipped: no-store');
      return;
    }
    const result = await workspaceStore.registerWorkspace({
      id: workspace?.id,
      urlKey: workspace?.urlKey,
      provider: normalizeProvider(workspace)
    });
    if (result && result.ok === false) log(`[workspace-registry] skipped: ${result.reason}`);
  } catch (err) {
    // Class only: a store error's message can carry a connection string or a key.
    log(`[workspace-registry] store error: ${err?.constructor?.name || 'Error'}`);
  }
}
