/**
 * Real instances of every per-key holder, built from the same factories server.js uses, for the LIN-4168 tests.
 *
 * `buildKeyStateInstances` returns the object `registerKeyStateHolders` takes. `buildRegistry` runs that registration on a
 * fresh registry, so a test checks the registration that ships, not a copy of it. The one difference from server.js is
 * that the dispatch guard's done cache is a fresh instance here, not the module singleton, so the test does not load the
 * whole dispatch factory. The registration treats both the same.
 */

import { createTaskFactsHolder, createTaskFactsRefresh } from '../../lib/task-facts-holder.js';
import { createWorkspaceIssuesMemo } from '../../lib/workspace-issues-memo.js';
import { createSessionsFeedCache } from '../../lib/sessions-feed-cache.js';
import { createTaskDoneCache } from '../../lib/task-done-cache.js';
import { createWorkspaceTokenCache } from '../../lib/workspace-token-cache.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';
import { createRefreshOnResolveGate } from '../../lib/refresh-on-resolve-gate.js';
import { createKeyState } from '../../lib/key-state.js';
import { registerKeyStateHolders } from '../../lib/key-state-holders.js';

/**
 * @param {Object} [opts]
 * @param {Function} [opts.fetchAndPrepareProjects] - the refresh's fetch; defaults to an empty complete set
 * @param {Function} [opts.now] - injectable clock for the holders that take one
 */
export function buildKeyStateInstances({ fetchAndPrepareProjects = async () => ({ stateIssues: [] }), now = () => Date.now() } = {}) {
  const holder = createTaskFactsHolder({ now });
  const refresh = createTaskFactsRefresh({ holder, fetchAndPrepareProjects, now, onError: () => {} });
  return {
    taskFacts: { holder, refresh },
    workspaceIssuesMemo: createWorkspaceIssuesMemo({ now }),
    sessionsFeedCache: createSessionsFeedCache({ now }),
    taskDoneCaches: { dashboard: createTaskDoneCache({ now }), dispatchGuard: createTaskDoneCache({ now }) },
    workspaceTokenCache: createWorkspaceTokenCache({ now }),
    rejectedCredentialRegistry: createRejectedCredentialRegistry({ now }),
    refreshOnResolveGate: createRefreshOnResolveGate({ now }),
  };
}

/**
 * A key-state registry with every holder and exception registered from `instances`.
 * @param {Object} instances - from buildKeyStateInstances
 */
export function buildRegistry(instances) {
  const keyState = createKeyState({ onRefillError: () => {} });
  registerKeyStateHolders(keyState, instances);
  return keyState;
}
