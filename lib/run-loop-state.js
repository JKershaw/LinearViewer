// Is this run or session over? Decided by the dispatch terminal markers
// (lib/dispatch-terminal.js), so it lives with Runs & dispatch rather than in a
// Web route (LIN-3717). Moved byte for byte out of routes/dashboard.js, which
// re-exports `enrichLoop`, `isTerminalLoop` and `sessionIsTerminal` so existing
// importers (server.js, routes/task-chat.js) keep resolving there.
import { deriveTerminalStatus, deriveCompletedAt, isRowClosed, findWakeEvent, isWaitingWakeMarker } from './dispatch-terminal.js';
import { findAnchorLoop } from './session-summary.js';

// A run is summarisable only once it is immutable. agentState is terminal at
// 'complete'/'error'; until then a summary would snapshot a moving target and
// the cache (keyed on the immutable run) would serve stale content.
export const TERMINAL_AGENT_STATES = new Set(['complete', 'error']);

// Map a dispatch terminal-feedback marker → a Loop agentState. `skipped`
// (LIN-946/LIN-951) is terminal-BENIGN → 'complete', NOT 'error': the runner
// refused a cascade abort into a human-continued session, which is an ended run,
// not a failed one. Deliberately distinct from `aborted` (→ 'error') so a skip is
// never rendered as an errored/aborted session.
export const MARKER_TO_AGENT_STATE = { done: 'complete', failed: 'error', aborted: 'error', skipped: 'complete' };

/**
 * Derive the *effective* agent state for a run.
 *
 * The Loop builder (lib/pipeline-loops.js) leaves a taken dispatch as 'running'
 * until a agent 'completed'/'failed' entry decorates it. But the dispatch
 * runner's own terminal signal is a "[done]"/"[failed]"/"[aborted]" feedback
 * marker (lib/dispatch-terminal.js — the same seam the proxy watch endpoint
 * reads). Without folding that in, every marker-but-no-agent run shows
 * "running" forever — the "all sessions appear in progress" report (LIN-509),
 * which also left the summary button permanently disabled. A terminal marker
 * therefore wins over a non-terminal derived state. Read-only; never mutates a
 * stored record, and never downgrades a state the builder already called terminal.
 *
 * @param {Object} loop
 * @returns {string} effective agentState
 */
export function effectiveAgentState(loop) {
  if (!loop) return 'running';
  if (TERMINAL_AGENT_STATES.has(loop.agentState)) return loop.agentState;
  // Prefer the terminal status pipeline-loops pre-derived at build time (present
  // on every reconstructed loop); fall back to scanning raw feedback for loops
  // built elsewhere. The lean feed drops raw feedback[], so this read must not
  // depend on it (LIN-622).
  const marker = loop.terminalStatus !== undefined ? loop.terminalStatus : deriveTerminalStatus(loop.feedback);
  if (marker) return MARKER_TO_AGENT_STATE[marker];
  // LIN-3364: a row closed at the source (bookkeeping stamp) is complete, so the
  // enriched agentState agrees with isTerminalLoop (precedent: skipped -> complete).
  return isRowClosed(loop) ? 'complete' : loop.agentState;
}

// Exported (LIN-2773 Area 4) so routes/proxy-rulings.js can reuse this EXACT
// predicate for `liveDispatchOnAnchor` rather than hand-rolling an
// equivalent — two independently-maintained "is this loop terminal" checks
// is exactly the disagreement class LIN-1728's own module doc (top of
// lib/unanswered-decisions.js) already names as a prior incident.
export function isTerminalLoop(loop) {
  return !!loop && (TERMINAL_AGENT_STATES.has(loop.agentState) || isRowClosed(loop));
}

// Marker-aware terminal check for a raw session loop (loops from
// getSessionsForWorkspace / the read-model are not pre-enriched).
export function loopIsTerminal(loop) {
  return isTerminalLoop(enrichLoop(loop));
}

/**
 * Is the whole session terminal (cacheable / summarisable)? Anchor-loop
 * terminality, with an all-loops-terminal fallback for anchorless/orphan
 * sessions. Module-scoped + exported (LIN-632) so the background summary
 * precompute (server.js → materializer) shares this exact gate instead of
 * forking a second definition that could drift.
 *
 * @param {Object} session - A lean session record (getSessionsForWorkspace shape).
 * @returns {boolean}
 */
export function sessionIsTerminal(session) {
  const anchor = findAnchorLoop(session);
  if (anchor) return loopIsTerminal(anchor);
  const loops = Array.isArray(session?.loops) ? session.loops : [];
  return loops.length > 0 && loops.every(loopIsTerminal);
}

/**
 * Enrich a Loop with its effective (marker-aware) agentState and completion
 * time. Returns a shallow copy; the stored record is never mutated.
 * @param {Object} loop
 * @returns {Object}
 */
// Exported for routes/proxy-rulings.js (LIN-2444): the consumer-API rulings
// read needs loops shaped exactly as the rulings feed shapes them, because
// `resolveDisposition` (lib/unanswered-decisions.js) reads `agentState`. Shared
// by export rather than copied — a second local enrichment would drift from
// this one silently, and the two would then disagree about whether a ruling can
// be replied to.
export function enrichLoop(loop) {
  // Prefer the build-time terminal completion (present on every reconstructed
  // loop); fall back to scanning raw feedback for loops built elsewhere. The
  // lean feed drops raw feedback[], so this must not depend on it (LIN-622).
  const terminalCompletedAt = loop.terminalCompletedAt !== undefined
    ? loop.terminalCompletedAt
    : deriveCompletedAt(loop.feedback);
  return {
    ...loop,
    agentState: effectiveAgentState(loop),
    // LIN-3364: a closed row's completion is the close time, not its resolvedAt.
    completedAt: terminalCompletedAt
      || (isRowClosed(loop) ? (loop.bookkeeping.at || null) : (isTerminalLoop(loop) ? (loop.resolvedAt || null) : null))
  };
}

/**
 * Is a single ENRICHED loop (effectiveAgentState applied) waiting on a human?
 *
 * Two independent runner channels, unioned (LIN-1005 — neither subsumes the
 * other): (a) an agent-status `blocked` entry surfaces as `agentState==='waiting'`
 * (lib/pipeline-loops.js `_deriveAgentState`), and (b) a `[blocked]`
 * *feedback* marker (`WAITING_WAKE_MARKERS`, lib/dispatch-terminal.js; `[pending]`
 * is not a wait, LIN-1025), pre-derived at build time as `wakeMarker` so this read is
 * lean-safe (never touches raw `feedback[]`, which the feed drops). Terminal wins:
 * a run that actually finished (a terminal feedback marker folded in by
 * `effectiveAgentState`, or a native complete/error) is never waiting.
 *
 * @param {Object} loop - enriched loop (post-`enrichLoop`)
 * @returns {boolean}
 */
export function loopIsWaiting(loop) {
  if (!loop || isTerminalLoop(loop)) return false;
  if (loop.agentState === 'waiting') return true;
  // Prefer the build-time `wakeMarker` (present on every reconstructed loop, lean
  // or not); fall back to scanning raw feedback for loops built elsewhere.
  const marker = loop.wakeMarker !== undefined
    ? loop.wakeMarker
    : (findWakeEvent(loop.feedback)?.marker || null);
  return isWaitingWakeMarker(marker);
}
