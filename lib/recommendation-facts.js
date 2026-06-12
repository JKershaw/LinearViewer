/**
 * Recommendation fact assembly (LIN-434) — the deterministic, network-free seam.
 *
 * One module that owns the per-node fact set the recommendation prompts consume, so
 * fact assembly is boring, isolated, and unit-testable instead of scattered inline
 * across the prompt builders. It does NOT touch the network and never calls the LLM;
 * generation (prompt body) and decision (markdown-contract parsing) are the other two
 * seams and stay in lib/openrouter.js.
 *
 * The graph/tree primitives this builds on live in lib/tree.js (frontier ranking,
 * blocker resolution, terminal-state) and were seeded by LIN-433 — they are NOT moved
 * here (no duplicate module move); this module re-exports them so call sites have a
 * single fact-import surface and adds the two previously-scattered, untested pieces:
 *   - extractSessionFit (was private in openrouter.js)
 *   - computeNodeStateCounts (was computed inline inside buildMetaPrompt)
 *
 * The fact set (per the LIN-434 Done-when list):
 *   - terminal-state .............. isTerminalState (re-exported from tree.js)
 *   - open-child count + status ... computeFrontierFacts (re-exported from tree.js)
 *   - frontier ranking ............ selectFocusSubtask (re-exported from tree.js)
 *   - blocker-resolution .......... isBlocked (re-exported from tree.js)
 *   - plan session-fit ............ extractSessionFit (owned here)
 *   - bug-investigation-present ... NOT a deterministic fact (no stable marker exists);
 *                                   stays an inline soft gate on the prompt paths.
 */
import {
  isTerminalState,
  isBlocked,
  selectFocusSubtask,
  computeFrontierFacts
} from './tree.js';

// Single fact-import surface: re-export the tree primitives so consumers import all
// deterministic fact helpers from here rather than reaching into tree.js directly.
export { isTerminalState, isBlocked, selectFocusSubtask, computeFrontierFacts };

/**
 * Extract the plan's committed session-fit answer from an issue description
 * (LIN-433). The plan/meta-prompt mandate the canonical phrases "fits one session"
 * / "needs multiple sessions", so a light, case-insensitive match is deterministic.
 * Returns null (→ "none found") when neither phrase is present — non-authoritative;
 * the model still reads the plan itself.
 *
 * @param {string} [description]
 * @returns {'fits one session'|'needs multiple sessions'|null}
 */
export function extractSessionFit(description) {
  if (!description) return null;
  if (/needs?\s+multiple\s+sessions/i.test(description)) return 'needs multiple sessions';
  if (/fits?\s+(?:in\s+)?one\s+(?:focused\s+)?session/i.test(description)) return 'fits one session';
  return null;
}

/**
 * Deterministic child-state counts for a node's subtasks. Lifted verbatim out of
 * buildMetaPrompt (LIN-434) so the counts are assembled in one pure, testable place.
 *
 * @param {Array} [children] - Array of child issues
 * @returns {{subtaskCount, completedCount, inProgressCount, remainingCount, hasOpenChildren}}
 */
export function computeNodeStateCounts(children = []) {
  const subtaskCount = children.length;
  const completedCount = children.filter(c => isTerminalState(c.state?.type)).length;
  const inProgressCount = children.filter(c => c.state?.type === 'started').length;
  const remainingCount = subtaskCount - completedCount;
  return {
    subtaskCount,
    completedCount,
    inProgressCount,
    remainingCount,
    hasOpenChildren: remainingCount > 0
  };
}

/**
 * Assemble the full per-node fact set the meta-prompt consumes (LIN-434). Pure and
 * network-free: combines the child-state counts, the node's own terminal flag, and
 * the frontier facts (open/blocked counts + next child + plan session-fit). This is
 * the single entry point buildMetaPrompt calls; the values are byte-identical to the
 * inline computation it replaces.
 *
 * sessionFit is attached only when there are children (and therefore frontier facts),
 * matching the prior behavior exactly.
 *
 * @param {Object} issue - The node issue (uses .state.type and .description)
 * @param {Array} [children] - The node's subtasks
 * @returns {{completedCount, inProgressCount, remainingCount, hasOpenChildren, isTerminal, frontierFacts}}
 */
export function assembleNodeFacts(issue, children = []) {
  const counts = computeNodeStateCounts(children);
  const frontierFacts = children.length ? computeFrontierFacts(children) : null;
  if (frontierFacts) frontierFacts.sessionFit = extractSessionFit(issue?.description);
  return {
    completedCount: counts.completedCount,
    inProgressCount: counts.inProgressCount,
    remainingCount: counts.remainingCount,
    hasOpenChildren: counts.hasOpenChildren,
    isTerminal: isTerminalState(issue?.state?.type),
    frontierFacts
  };
}
