/**
 * lib/home-row-states.js — the one gather of a task's facts (LIN-4016 decision 7, widened by LIN-4068).
 *
 * Every surface that states a task's state (Home's rows, the opened box and the task page through `/state`, the share
 * page) reads it from `gatherTaskStates`, over the same three inputs:
 *  - the workspace's issue set (after the hidden-state drop, before the assignee filter), as one children index at every
 *    depth (`buildSubtreeIndex`), so a parent sees every descendant with its tracker type, whichever view shows it;
 *  - the sessions, windowed to the read horizon HERE, so a whole-life read and a 30-day read give the same state
 *    (history displays still read the whole life; they do not come through here);
 *  - the ruling standing over those windowed sessions.
 * `lib/task-state.js` still decides; this module only gathers.
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

/** Find a node by identifier in an index (depth-first). */
export function findSubtree(roots, identifier) {
  const stack = [...(roots || [])];
  while (stack.length) {
    const node = stack.pop();
    if (node.issue.identifier === identifier) return node;
    stack.push(...node.children);
  }
  return null;
}

/** Every identifier in a subtree, root first. */
export function subtreeIdentifiers(node) {
  const out = [];
  const visit = (n) => { out.push(n.issue.identifier); n.children.forEach(visit); };
  if (node) visit(node);
  return out;
}

/** The loops a state is decided from: those inside the read window (LIN-4068 D1). */
export const windowedLoops = (loops, at) => (loops || []).filter((loop) => inReadWindow(loop.dispatchedAt, at));

/**
 * The one gather (LIN-4068). Pure over already-read inputs.
 *
 * @param {Object} input
 * @param {Array<Object>} input.issues - the workspace's issue set, after the hidden-state drop, before the assignee filter
 * @param {Array<Object>} input.loops - any loops (whole-life or windowed); windowed here
 * @param {Object|null} input.ruling - the ruling standing over the windowed loops
 * @param {Date} input.at
 * @param {boolean} [input.sessionsVisible=true]
 * @param {string|null} [input.rootIdentifier] - gather only this task's subtree (`/state`); null for every task
 * @param {Array<Object>|null} [input.roots] - a prebuilt index over `issues` (Home builds it once per request)
 * @returns {{states: Map<string, Object>, roots: Array<Object>, node: Object|null}}
 */
export function gatherTaskStates({ issues, loops, ruling, at, sessionsVisible = true, rootIdentifier = null, roots = null, enrichLoop, deriveSessionWaiting }) {
  const index = roots || withInverseRelations([buildSubtreeIndex(issues || [])])[0];
  const node = rootIdentifier ? findSubtree(index, rootIdentifier) : null;
  const states = buildRowStates({
    roots: rootIdentifier ? (node ? [node] : []) : index,
    loopsByIdentifier: byIdentifier(windowedLoops(loops, at)),
    enrichLoop, deriveSessionWaiting, now: at, sessionsVisible, ruling,
  });
  return { states, roots: index, node };
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
 * @returns {(args: {urlKey: string, issues: Array, runControls: boolean}) => Promise<{states: Map<string, Object>, rulingCount: number}|null>}
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
      const { states } = gatherTaskStates({ issues, loops, ruling, at, sessionsVisible: runControls, enrichLoop, deriveSessionWaiting });
      return { states, rulingCount: ruling ? ruling.rows.length : 0 };
    } catch (err) {
      onError(err.message);
      return null;
    }
  };
}

/**
 * One task's state for `/state`, the task page and the share page (LIN-4068): the same gather as Home, over the same
 * issue set (the server-side workspace memo, never a client hint), with the subtree's sessions read in one batched read.
 *
 * @param {Object} deps
 * @param {Function} deps.getIssueSet - ({urlKey, workspace}) → Promise<issues> (the workspace memo Home writes)
 * @param {Function} deps.getLoopsForIssues - (urlKey, identifiers, {dispatchStore, agentStatusStore}) → Promise<loops>,
 *   one batched, windowed read
 * @returns {(args: {urlKey: string, identifier: string, ownLoops?: Array}) => Promise<{taskState: Object, container: boolean, trackerType: string|null, found: boolean}>}
 */
export function createTaskStateGather({
  getIssueSet, getLoopsForIssues, dispatchStore, agentStatusStore, taskDecisionsStore = null, shelvedRulingsStore = null,
  enrichLoop, deriveSessionWaiting, now = () => new Date(),
}) {
  return async function gatherTaskState({ urlKey, workspace = null, identifier, ownLoops = null }) {
    const at = now();
    const issues = await getIssueSet({ urlKey, workspace });
    const roots = withInverseRelations([buildSubtreeIndex(issues || [])])[0];
    const node = findSubtree(roots, identifier);
    const ids = node ? subtreeIdentifiers(node) : [identifier];
    // The task's own whole-life loops are already read for its history; the rest of the subtree is one batched read.
    const descendantIds = ownLoops ? ids.filter((id) => id !== identifier) : ids;
    const read = descendantIds.length
      ? await getLoopsForIssues(urlKey, descendantIds, { dispatchStore, agentStatusStore })
      : [];
    const loops = windowedLoops([...(ownLoops || []), ...read], at);
    const ruling = await readRulingStanding({ urlKey, loops, at, taskDecisionsStore, shelvedRulingsStore, enrichLoop });
    const { states } = gatherTaskStates({ issues, loops, ruling, at, roots, rootIdentifier: identifier, enrichLoop, deriveSessionWaiting });
    const state = states.get(identifier) || null;
    return {
      found: !!node,
      taskState: state,
      container: state ? state.container : false,
      trackerType: node?.issue?.state?.type ?? null,
      ruling,
    };
  };
}
