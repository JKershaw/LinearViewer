/**
 * lib/home-row-states.js — the one gather of a task's facts (LIN-4016 decision 7, widened by LIN-4068 D5).
 *
 * Every surface that states a task's state reads it from `gatherTaskStates`, over the same three inputs:
 *  - the workspace's issue set (after the hidden-state drop, before the assignee filter), as one children index at every
 *    depth (`buildSubtreeIndex`), so a parent sees every descendant with its tracker type, whichever view shows it;
 *  - the sessions, windowed to the read horizon HERE, before the build, so a whole-life read and a 30-day read give
 *    the same state (history displays still read the whole life; they do not come through here);
 *  - the ruling standing over those windowed sessions.
 * `lib/task-state.js` still decides; this module only gathers. The gather is pure over already-read inputs.
 *
 * `createHomeRowStates` returns `null` when the stores cannot be read (the row states are then unknown), so every
 * caller falls back to plain rows, as it always has (W7 pins this).
 */

import { buildRowStates } from './task-page-loader.js';
import { withInverseRelations } from './graph-features.js';
import { readRulingStanding } from './ruling-standing.js';
import { buildSubtreeIndex } from './subtree-index.js';
import { inReadWindow } from './read-horizon.js';

/** Group loops by task identifier. */
function byIdentifier(loops) {
  const map = new Map();
  for (const loop of loops || []) {
    if (!loop?.issueIdentifier) continue;
    if (!map.has(loop.issueIdentifier)) map.set(loop.issueIdentifier, []);
    map.get(loop.issueIdentifier).push(loop);
  }
  return map;
}

/**
 * The loops a state is decided from: those inside the read window (LIN-4068 D1). The stores already read the window
 * before the build (`_fetchWorkspaceData` `since`, `_admitRow`); this is the same test applied to the built loops, so
 * a caller that hands in a whole-life read still gets the windowed state.
 */
export const windowedLoops = (loops, at) => (loops || []).filter((loop) => inReadWindow(loop.dispatchedAt, at));

/**
 * The one gather (LIN-4068). Pure over already-read inputs.
 *
 * @param {Object} input
 * @param {Array<Object>} [input.issues] - the workspace's issue set, after the hidden-state drop, before the assignee
 *   filter; indexed here unless `roots` is given
 * @param {Array<{issue: Object, children: Array}>} [input.roots] - a prebuilt index over `issues` (the holder's, or Home's
 *   own, built once per request)
 * @param {Array<Object>} input.loops - any loops; windowed here
 * @param {Object|null} input.ruling - the ruling standing over the windowed loops; null derives it from `loops`
 * @param {Date} input.at
 * @param {boolean} [input.sessionsVisible=true] - false (a copy-first viewer) reads the tracker alone
 * @returns {{states: Map<string, Object>, roots: Array<Object>}} every task's state (`buildRowStates`'s shape, with
 *   `container`, `finished` and `action`), keyed by identifier, and the index it was built over
 */
export function gatherTaskStates({ issues = null, roots = null, loops = [], ruling = null, at, sessionsVisible = true, enrichLoop, deriveSessionWaiting }) {
  const index = roots || withInverseRelations([buildSubtreeIndex(issues || [])])[0];
  const states = buildRowStates({
    roots: index,
    loopsByIdentifier: byIdentifier(windowedLoops(loops, at)),
    enrichLoop, deriveSessionWaiting, now: at, sessionsVisible, ruling,
  });
  return { states, roots: index };
}

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
 * @returns {(args: {urlKey: string, issues: Array, runControls: boolean}) => Promise<{states: Map<string, Object>, rulingCount: number, roots: Array}|null>}
 */
export function createHomeRowStates({
  getLoopsForWorkspace, dispatchStore, agentStatusStore, taskDecisionsStore, shelvedRulingsStore,
  enrichLoop, deriveSessionWaiting, now = () => new Date(), onError = (message) => console.error('Home row states error:', message),
}) {
  return async function homeRowStates({ urlKey, issues, runControls }) {
    try {
      const at = now();
      let loops = [];
      let ruling = null;
      if (runControls) {
        loops = windowedLoops(await getLoopsForWorkspace(urlKey, { dispatchStore, agentStatusStore, lean: true }).catch(() => []), at);
        // LIN-4024: the badge's own reduction over this workspace, so a row, the count line and the badge agree on
        // what is open. Once per request, over the loops the page already holds.
        ruling = await readRulingStanding({ urlKey, loops, at, taskDecisionsStore, shelvedRulingsStore, enrichLoop });
      }
      const { states, roots } = gatherTaskStates({ issues, loops, ruling, at, sessionsVisible: runControls, enrichLoop, deriveSessionWaiting });
      return { states, roots, rulingCount: ruling ? ruling.rows.length : 0 };
    } catch (err) {
      onError(err.message);
      return null;
    }
  };
}
