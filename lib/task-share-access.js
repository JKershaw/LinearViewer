/**
 * Guest task-page access resolver (LIN-3330, Subtask C of LIN-3324).
 *
 * The public `/t/:token` page reads the owner's task through the EXISTING
 * owner-away credential path — no new credential read is invented. Given a
 * stored share `record`, this resolves the owner's provider access exactly the
 * way `routes/proxy.js` does for an owner-scoped consumer read:
 *
 *   - `resolveWorkspaceAccess(record.urlKey, record.ownerAccountId, {source})`
 *     — the owner is ALWAYS named (never the `UNSCOPED` sentinel), and the
 *     task's own provider kind is forwarded so a non-primary-kind task routes
 *     to its own binding (LIN-3335 R1);
 *   - `provider = getProviderForWorkspace({provider: access.provider})`;
 *   - `callScope = access.scope ?? access.token` (the shape
 *     `lib/share-owner-reader.js` used before `65068a26`).
 *
 * No token → null, and the guest route refuses with the loader's `{unavailable}`
 * (503). There is deliberately NO stored-only fallback (John's ruling).
 *
 * A small factory so it unit-tests with fakes, mirroring
 * `createReadOwnerIssues` (the same extraction precedent).
 */

/**
 * @param {Object} deps
 * @param {(urlKey: string, ownerAccountId: string, opts?: {source?: string|null}) => Promise<{token?: string, scope?: *, provider?: string, reason?: string}>} deps.resolveWorkspaceAccess
 * @param {(workspace: {provider: string}) => Object} deps.getProviderForWorkspace
 * @returns {(record: Object) => Promise<{provider: Object, callScope: *}|null>}
 */
export function createGuestTaskAccess({ resolveWorkspaceAccess, getProviderForWorkspace } = {}) {
  return async function guestTaskAccess(record) {
    if (!record) return null;
    const access = await resolveWorkspaceAccess(record.urlKey, record.ownerAccountId, { source: record.source });
    if (!access || !access.token) return null;
    return {
      provider: getProviderForWorkspace({ provider: access.provider }),
      callScope: access.scope ?? access.token,
    };
  };
}
