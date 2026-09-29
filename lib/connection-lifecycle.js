/**
 * Connection credential lifecycle (LIN-3124 PR2, S6 / D4 / D10 / D18).
 *
 * The one place connection-backed credentials and connection rows are released.
 * Every legacy delete arm is untouched: these functions no-op for a workspace
 * with no connection-backed binding, so a legacy workspace's unlink, removal,
 * definitive revocation and account merge remain byte-identical.
 *
 * Gates (D4):
 *   - definitive revocation (a genuinely dead credential) → the connection and
 *     its owner record are deleted outright (`mode: 'revoke'`);
 *   - unlink of one binding / whole-workspace removal → last-referent only:
 *     remove the referent, then delete the connection only when no referent is
 *     left (`mode: 'unlink' | 'remove'`);
 *   - GitHub-family connections are never deleted (referents are add-only and
 *     advisory, D13) — the wired callers only enumerate refresh-token kinds;
 *   - `handleWorkspaceRemoval(deleteDurable=false)` (a transient remint blip)
 *     takes no durable action at all, so it never reaches this module.
 *
 * The connection id is read off the binding objects the caller already holds
 * (`binding.connectionId`), so no `ConnectionStore` read is needed here and
 * `server.js` never has to contain a `readConnection*` identifier.
 *
 * All stores are injected; this module imports no store INSTANCE and never
 * throws.
 */
import { CONNECTION_ORIGIN } from './connection-store.js';
import { isConnectionBacked, isRefreshTokenKind } from './connection-binding.js';

/** Referent shape on `connections.referents` (D10). */
function referentFor(workspace, binding) {
  return { urlKey: workspace.urlKey, provider: binding.provider, scope: binding.scope };
}

function connectionBackedBindings(workspace, provider, scope) {
  if (!workspace || !Array.isArray(workspace.bindings)) return [];
  return workspace.bindings.filter(b =>
    isConnectionBacked(b) &&
    // D13: GitHub-family connections are retained; only refresh-token kinds are
    // ever released (referents are add-only and advisory for the remint kinds).
    isRefreshTokenKind(b.provider) &&
    (provider === undefined || b.provider === provider) &&
    (scope === undefined || b.scope === scope)
  );
}

/**
 * Best-effort release of a connection-keyed owner record orphaned when a
 * conversion's `link()` definitely failed (D18 step-2 fallback). Never throws;
 * an unfreed record is inert (nothing references its connectionId).
 *
 * @param {Object} deps
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} [deps.ownerCredentialStore]
 * @param {string} deps.connectionId
 * @returns {Promise<boolean>}
 */
export async function releaseOrphanOwnerRecord({ ownerCredentialStore, connectionId }) {
  if (!ownerCredentialStore || !connectionId) return false;
  try {
    return await ownerCredentialStore.deleteByConnection(connectionId);
  } catch (err) {
    console.error('[connection-lifecycle] releaseOrphanOwnerRecord failed:', err);
    return false;
  }
}

/**
 * Release the connection-backed credentials touched by a lifecycle site.
 *
 * @param {Object} deps
 * @param {import('./connection-store.js').ConnectionStore} [deps.connectionStore]
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} [deps.ownerCredentialStore]
 * @param {Object} deps.workspace - the session workspace being unlinked/removed (carries `bindings[].connectionId`)
 * @param {string} [deps.provider] - restrict to one provider (definitive revocation, unlink)
 * @param {string} [deps.scope] - restrict to one binding (unlink)
 * @param {'revoke'|'unlink'|'remove'} deps.mode
 * @returns {Promise<{released: number, referents: Array}>} the removed referents, for cache-eviction fan-out
 */
export async function releaseConnectionCredential({ connectionStore, ownerCredentialStore, workspace, provider, scope, mode }) {
  const empty = { released: 0, referents: [] };
  if (!connectionStore || !workspace) return empty;
  const bindings = connectionBackedBindings(workspace, provider, scope);
  if (bindings.length === 0) return empty; // legacy-only workspace: no durable action

  const referents = [];
  let released = 0;
  for (const binding of bindings) {
    const connectionId = binding.connectionId;
    try {
      if (mode === 'revoke') {
        const removed = await connectionStore.deleteConnection(connectionId);
        await ownerCredentialStore?.deleteByConnection(connectionId);
        if (Array.isArray(removed) && removed.length) referents.push(...removed);
        else referents.push(referentFor(workspace, binding));
        released += 1;
        continue;
      }
      // unlink / remove: last-referent only.
      const referent = referentFor(workspace, binding);
      await connectionStore.removeReferent(connectionId, referent);
      const deleted = await connectionStore.deleteIfUnreferenced(connectionId);
      if (deleted) {
        await ownerCredentialStore?.deleteByConnection(connectionId);
        referents.push(referent);
        released += 1;
      }
    } catch (err) {
      console.error('[connection-lifecycle] releaseConnectionCredential failed:', err);
    }
  }
  return { released, referents };
}

/**
 * Account-merge orphan cleanup (D4/D10). Deletes only `origin:'connection'`
 * rows under the MERGED account's `_id` prefix that have no referents left; a
 * row with referents stays and keeps resolving (no re-home), and a
 * LIN-3127-born row (no `origin`) is never deleted. The connection-keyed owner
 * record of each row that was genuinely deleted is released too.
 *
 * @param {Object} deps
 * @param {import('./connection-store.js').ConnectionStore} [deps.connectionStore]
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} [deps.ownerCredentialStore]
 * @param {string} deps.mergedAccountId
 * @returns {Promise<number>} the number of connection rows deleted
 */
export async function onAccountMerged({ connectionStore, ownerCredentialStore, mergedAccountId }) {
  if (!connectionStore || !mergedAccountId) return 0;
  try {
    const before = await connectionStore.readConnectionsByAccountPrefix(mergedAccountId);
    const candidates = before.filter(row =>
      row.origin === CONNECTION_ORIGIN &&
      Array.isArray(row.referents) && row.referents.length === 0
    );
    if (candidates.length === 0) return 0;

    const deletedCount = await connectionStore.deleteEmptyByAccountPrefix(mergedAccountId);

    if (ownerCredentialStore) {
      const after = await connectionStore.readConnectionsByAccountPrefix(mergedAccountId);
      const remaining = new Set(after.map(row => row._id));
      for (const row of candidates) {
        // Only rows that actually went away lose their owner record — a
        // concurrent link keeps the row (and its credential).
        if (!remaining.has(row._id)) await ownerCredentialStore.deleteByConnection(row._id);
      }
    }
    return deletedCount;
  } catch (err) {
    console.error('[connection-lifecycle] onAccountMerged failed:', err);
    return 0;
  }
}
