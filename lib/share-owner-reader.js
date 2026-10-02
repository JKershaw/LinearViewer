/**
 * Owner-credential reader for share refreshes (LIN-3243, Session A of LIN-3073).
 *
 * `readOwnerIssues(urlKey, ownerAccountId)` resolves the owner's workspace
 * credential through `resolveWorkspaceAccess` — the hardened path (LIN-1366
 * owner-scoped selection, LIN-1524 durable refresh, LIN-1980 suspect-credential
 * recovery, LIN-2234 canonical accounts, LIN-3124 PR3) — and then reads the
 * workspace's full issue set through the provider. It is deliberately NOT the
 * title resolver: `lib/workspace-title-resolver.js` reads a live session row
 * and skips that hardening (no refresh after logout).
 *
 * Extracted from server.js into a `createX(deps)` factory (the LIN-1329
 * precedent) so its composition is unit-testable with fakes — the route still
 * receives the bound function by injection and imports none of these deps.
 *
 * Contract:
 *   - `resolveWorkspaceAccess` is NEVER called with the UNSCOPED sentinel — the
 *     share always belongs to exactly one owner account (the LIN-1366 hazard);
 *   - a null token returns `{ reason, issues: null }` (a refresh failure);
 *   - the Linear test-token short-circuit returns the mock issue set;
 *   - a provider read returns `{ reason, issues }`, never throwing the caller's
 *     control flow away — a thrown provider error propagates as a refresh
 *     failure at the route (which catches it).
 */

/**
 * @param {Object} deps
 * @param {(urlKey: string, ownerAccountId: string) => Promise<{token?: string, scope?: *, reason?: string, provider?: string}>} deps.resolveWorkspaceAccess
 * @param {(workspace: {provider: string}) => {fetchProjects: Function}} deps.getProviderForWorkspace
 * @param {() => {issues: Object[]}} deps.getTestMockData
 * @returns {(urlKey: string, ownerAccountId: string) => Promise<{reason: string, issues: Object[]|null}>}
 */
export function createReadOwnerIssues({ resolveWorkspaceAccess, getProviderForWorkspace, getTestMockData } = {}) {
  return async function readOwnerIssues(urlKey, ownerAccountId) {
    const { token, scope, reason, provider } = await resolveWorkspaceAccess(urlKey, ownerAccountId);
    if (!token) return { reason, issues: null };
    if (process.env.NODE_ENV === 'test' && token === 'test-token') {
      return { reason, issues: getTestMockData().issues };
    }
    const { issues } = await getProviderForWorkspace({ provider }).fetchProjects(scope ?? token);
    return { reason, issues: issues || [] };
  };
}
