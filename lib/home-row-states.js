/**
 * lib/home-row-states.js — Home's row states, assembled once (LIN-4016, decision 7).
 *
 * Home's three routes (the main page, the `/api/home-rows` folds and the post-401 refresh tail) each need the same
 * states for the rows they show: one `buildRowStates` over the In Progress and project trees, and the workspace's
 * ruling standing for the count line and the needs-you rows. This module is that one assembly. Each caller keeps its
 * own view (the trimmed forest, or the paginated rows), which is not the same shape on each route.
 *
 * It returns `null` when the stores cannot be read (the row states are then unknown), so every caller falls back to
 * plain rows, as it always has (W7 pins this).
 */

import { buildRowStates } from './task-page-loader.js';
import { withInverseRelations } from './graph-features.js';
import { readRulingStanding } from './ruling-standing.js';

/**
 * Build the Home row-state assembly over the server's stores.
 *
 * @param {Object} deps
 * @param {Function} deps.getLoopsForWorkspace - `lib/pipeline-loops.js`'s lean workspace read
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.agentStatusStore
 * @param {Object} deps.taskDecisionsStore
 * @param {Object} deps.shelvedRulingsStore
 * @param {Function} deps.enrichLoop
 * @param {Function} deps.deriveSessionWaiting
 * @param {Function} [deps.now] - () → Date
 * @param {Function} [deps.onError] - receives the error message when a store read fails
 * @returns {(args: {urlKey: string, inProgressTrees: Array, recentActivityTrees: Array, projectTrees: Array, runControls: boolean}) => Promise<{states: Map<string, Object>, rulingCount: number}|null>}
 */
export function createHomeRowStates({
  getLoopsForWorkspace, dispatchStore, agentStatusStore, taskDecisionsStore, shelvedRulingsStore,
  enrichLoop, deriveSessionWaiting, now = () => new Date(), onError = (message) => console.error('Home row states error:', message),
}) {
  return async function homeRowStates({ urlKey, inProgressTrees, recentActivityTrees, projectTrees, runControls }) {
    try {
      const rawRoots = (inProgressTrees || []).flatMap(({ roots: trees }) => trees);
      const rawOtherRoots = [
        ...(recentActivityTrees || []).flatMap(({ roots: trees }) => trees),
        ...(projectTrees || []).flatMap(({ incomplete = [], completed = [] }) => [...incomplete, ...completed]),
      ];
      // LIN-4039: the blocked facts the picker reads, from the forward relations of the set Home fetched (one set).
      const [roots, otherRoots] = withInverseRelations([rawRoots, rawOtherRoots]);
      const loopsByIdentifier = new Map();
      let ruling = null;
      if (runControls) {
        const loops = await getLoopsForWorkspace(urlKey, { dispatchStore, agentStatusStore, lean: true }).catch(() => []);
        for (const loop of loops || []) {
          if (!loop?.issueIdentifier) continue;
          if (!loopsByIdentifier.has(loop.issueIdentifier)) loopsByIdentifier.set(loop.issueIdentifier, []);
          loopsByIdentifier.get(loop.issueIdentifier).push(loop);
        }
        // LIN-4024: the badge's own reduction over this workspace, so a row, the count line and the badge agree on
        // what is open. Once per request, over the loops the page already holds.
        ruling = await readRulingStanding({
          urlKey, loops: loops || [], at: now(), taskDecisionsStore, shelvedRulingsStore, enrichLoop,
        });
      }
      const states = buildRowStates({ roots, loopsByIdentifier, enrichLoop, deriveSessionWaiting, now: now(), sessionsVisible: runControls, ruling });
      const otherStates = buildRowStates({ roots: otherRoots, loopsByIdentifier, enrichLoop, deriveSessionWaiting, now: now(), sessionsVisible: runControls, ruling });
      for (const [identifier, state] of otherStates) {
        if (!states.has(identifier)) states.set(identifier, state);
      }
      return { states, rulingCount: ruling ? ruling.rows.length : 0 };
    } catch (err) {
      onError(err.message);
      return null;
    }
  };
}
