/**
 * lib/linear.js — thin re-export shim (LIN-330).
 *
 * The Linear GraphQL client boundary and the 9 dashboard read fetchers now live
 * in the Linear provider (lib/providers/linear/index.js); the canonical-state
 * helpers `isBlocked` / `selectFocusSubtask` now live with the tree helpers
 * (lib/tree.js). This module re-exports the fetchers so every existing consumer
 * keeps importing from `lib/linear.js` and behaves identically — zero behavior
 * change. DO NOT DELETE: routes/proxy.js (and others) still import from here;
 * they are re-pointed at the provider directly by LIN-306/LIN-331.
 *
 * Importing this module pulls in the Linear provider, which self-registers with
 * the provider registry as a load-time side effect (see lib/providers/registry.js).
 */
export {
  fetchTeams,
  fetchOrganization,
  fetchViewer,
  fetchProjectsList,
  fetchProjects,
  fetchIssueContext,
  fetchIssueComments,
  fetchFocusedChild,
  fetchRecommendationContext,
} from './providers/linear/index.js'
