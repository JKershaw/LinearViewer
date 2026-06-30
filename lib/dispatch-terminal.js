/**
 * lib/dispatch-terminal.js
 *
 * Terminal-marker detection for dispatch runs (shared seam).
 *
 * The dispatch runner posts completion as a free-form feedback entry prefixed
 * with a marker — e.g. "[done] Task completed in 45s" / "[failed] remote-control
 * never connected" — while the queue's lifecycle status stays 'taken'. Reading
 * that marker is the ONLY reliable signal that a taken dispatch actually
 * finished (a still-running worker and a finished-but-not-agent-reported
 * worker both look like 'taken' otherwise). See LIN-400.
 *
 * This was first solved inside the proxy watch/list endpoints (routes/proxy.js);
 * it now lives here so the dashboard's Loop feed (LIN-509) derives the same
 * terminal truth from the same regex instead of growing a divergent copy.
 * Derivation is read-only — the stored lifecycle status is never mutated.
 */

const TERMINAL_FEEDBACK_REGEX = /^\s*\[(done|complete|failed|aborted)\]/i;
const TERMINAL_MARKER_TO_STATUS = { done: 'done', complete: 'done', failed: 'failed', aborted: 'aborted' };

/**
 * Wake events (LIN-826/LIN-843) — the markers that, when a *subscribed* child
 * reaches them, wake its parent with a follow-up. This is a deliberate SUPERSET
 * of the terminal markers: it additionally counts `[blocked]` (a blocked child
 * must wake its parent so it can react — not only a clean done) and `[pending]`
 * (LIN-843: a child that has *paused* at a holdable boundary — e.g. a stepper
 * beat reporting "my part's done, the task isn't" — must wake its parent so the
 * orchestrator can advance the next beat rather than long-poll for the boundary).
 *
 * It is kept SEPARATE from TERMINAL_FEEDBACK_REGEX on purpose. The terminal
 * regex feeds completion-time, session-telemetry, KPI accounting, and the
 * dashboard Loop feed, where counting `[blocked]`/`[pending]` as a *completion*
 * would corrupt those semantics — `[pending]` in particular is explicitly a
 * pause, NOT a finish (LIN-843). The split keeps the blast radius of the
 * `[blocked]`/`[pending]` recognition at zero on existing consumers — this
 * predicate is consumed ONLY by the up-chain wake auto-enqueue. Both are
 * forward-compatible: each only bites once the runner actually emits that marker
 * (the SD `[pending]` marker is the LIN-842 half).
 */
const WAKE_FEEDBACK_REGEX = /^\s*\[(done|complete|failed|aborted|blocked|pending)\]/i;

/**
 * Scan feedback entries for a terminal marker and return the LAST one found
 * (the runner posts the terminal event last) as {entry, status}, or null.
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{entry: object, status: ('done'|'failed'|'aborted')}|null}
 */
export function findTerminalFeedback(feedback) {
  if (!Array.isArray(feedback)) return null;
  for (let i = feedback.length - 1; i >= 0; i--) {
    const match = TERMINAL_FEEDBACK_REGEX.exec(feedback[i]?.message || '');
    if (match) {
      return { entry: feedback[i], status: TERMINAL_MARKER_TO_STATUS[match[1].toLowerCase()] };
    }
  }
  return null;
}

/**
 * The terminal status derived from the feedback markers, or null if none.
 *
 * @param {Array<{message?: string}>} feedback
 * @returns {('done'|'failed'|'aborted')|null}
 */
export function deriveTerminalStatus(feedback) {
  return findTerminalFeedback(feedback)?.status || null;
}

/**
 * The truthful task-completion time: the timestamp of the terminal feedback
 * entry, or null until that marker exists. Distinct from `resolvedAt`, which
 * marks take/archive time (lands seconds after enqueue regardless of how long
 * the work runs) and must not be read as completion (LIN-400).
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {string|null}
 */
export function deriveCompletedAt(feedback) {
  return findTerminalFeedback(feedback)?.entry?.timestamp || null;
}

/**
 * Whether a single feedback message is a wake event (LIN-826/LIN-843) — a
 * `[done]`, `[complete]`, `[failed]`, `[aborted]`, `[blocked]`, or `[pending]`
 * prefix. Pure; the marker must be a leading prefix (a mid-sentence mention does
 * not count), matching the terminal-marker contract.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isWakeEvent(message) {
  return WAKE_FEEDBACK_REGEX.test(message || '');
}

/**
 * Scan feedback entries for a wake marker and return the LAST one found
 * (the runner posts the terminal/wake event last) as {entry, marker}, or null.
 * The wake superset includes `[blocked]` and `[pending]`; unlike
 * findTerminalFeedback there is no status mapping — a wake event is an event, not
 * a completion verdict (a `[pending]` marker is a pause, never a finish).
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{entry: object, marker: string}|null}
 */
export function findWakeEvent(feedback) {
  if (!Array.isArray(feedback)) return null;
  for (let i = feedback.length - 1; i >= 0; i--) {
    const match = WAKE_FEEDBACK_REGEX.exec(feedback[i]?.message || '');
    if (match) {
      return { entry: feedback[i], marker: match[1].toLowerCase() };
    }
  }
  return null;
}

export const __internal = { TERMINAL_FEEDBACK_REGEX, TERMINAL_MARKER_TO_STATUS, WAKE_FEEDBACK_REGEX };
