/**
 * The ONE "is there a live run on this anchor issue" predicate (LIN-2773 Area 4). LIN-4114 gives it its own module, not
 * lib/run-loop-state.js: that module's export list is pinned by tests/unit/run-loop-state-replay.test.js, and this
 * predicate only needs `isTerminalLoop` from it. Its consumers are the live views (the session state, the live wait, the
 * timeline zoom and the live console). The rulings feed, the task page's standing and Home's rows no longer read it: they
 * read question records (lib/ruling-standing.js, LIN-4538; the old ruling predicate retired, LIN-4541).
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
