/**
 * Owner-blind ticket-state read for the unattended ticket-closed sweep
 * (LIN-3366). A small factory so it unit-tests with fakes, mirroring
 * `createGuestTaskAccess` (lib/task-share-access.js).
 *
 * The provider call takes the structured scope (`access.scope ?? access.token`),
 * the same idiom as routes/proxy.js and task-share-access.js: GitHub / Jira
 * providers throw on a bare token, and a throw here reads as `null`, which
 * closes nothing, silently, on every non-Linear workspace.
 */

import { UNSCOPED } from './workspace-token-resolver.js';

/**
 * @param {Object} deps
 * @param {Function} deps.resolveWorkspaceAccess
 * @param {Function} deps.getProviderForWorkspace
 * @param {*} deps.unscoped - the owner-blind account scope sentinel
 * @param {Function} [deps.log]
 * @returns {(urlKey: string, identifier: string, opts?: {source?: string}) => Promise<{issueId: string|null, stateType: string}|null>}
 */
export function createReadTicketState({ resolveWorkspaceAccess, getProviderForWorkspace, unscoped = UNSCOPED, log = (m) => console.error(m) } = {}) {
  return async function readTicketState(urlKey, identifier, { source } = {}) {
    try {
      const access = await resolveWorkspaceAccess(urlKey, unscoped, { source });
      if (!access?.token || access.reason !== 'ok') return null;
      const provider = getProviderForWorkspace({ provider: access.provider });
      if (!provider?.supports?.('fetchIssueContext')) return null;
      const context = await provider.fetchIssueContext(access.scope ?? access.token, identifier);
      const issue = context?.issue || context || {};
      const stateType = issue?.state?.type;
      if (typeof stateType !== 'string' || !stateType) return null;
      return { issueId: issue.id || null, stateType };
    } catch (err) {
      log(`[ticket-closer] ticket read failed for ${urlKey}/${identifier}: ${err?.message || err}`);
      return null;
    }
  };
}
