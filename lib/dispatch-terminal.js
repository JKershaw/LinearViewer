/**
 * lib/dispatch-terminal.js
 *
 * Terminal-marker detection for dispatch runs (shared seam).
 *
 * The dispatch runner posts completion as a free-form feedback entry prefixed
 * with a marker — e.g. "[done] Task completed in 45s" / "[failed] remote-control
 * never connected" — while the queue's lifecycle status stays 'taken'. Reading
 * that marker is the ONLY reliable signal that a taken dispatch actually
 * finished (a still-running worker and a finished-but-not-foreman-reported
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

export const __internal = { TERMINAL_FEEDBACK_REGEX, TERMINAL_MARKER_TO_STATUS };
