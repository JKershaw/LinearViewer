/**
 * The ONE "is there a live run on this anchor issue" predicate (LIN-2773 Area 4). LIN-4114 gives it its own module, not
 * lib/run-loop-state.js: that module's export list is pinned by tests/unit/run-loop-state-replay.test.js, and this
 * predicate only needs `isTerminalLoop` from it. Its consumers, all building it here:
 *   - the rulings feed (routes/dashboard-rulings.js);
 *   - the run page's pinned card and the task page's question card, via `deriveSessionDecisions` (routes/dashboard-session-state.js);
 *   - every ruling-standing reader, through `rulingStandingOf` (lib/unanswered-decisions.js), unconditionally (LIN-4143):
 *     the task page's standing and state, Home's row states and Waiting on you (lib/ruling-standing.js).
 * routes/proxy-rulings.js keeps its own inline copy of the predicate; LIN-4143 leaves it alone.
 *
 * No `agentState === 'running'` conjunct: that would miss `queued` and `waiting`, both live on the anchor. A null
 * identifier is never live (LIN-2934): `null === null` must not fire the predicate.
 */
import { isTerminalLoop } from './run-loop-state.js';

/**
 * @param {Array<Object>} loops - enriched loops (post-`enrichLoop`)
 * @returns {(issueIdentifier: string|null) => boolean}
 */
export function liveOnAnchor(loops) {
  return (issueIdentifier) =>
    issueIdentifier != null &&
    loops.some(l => l.issueIdentifier === issueIdentifier && !isTerminalLoop(l));
}
