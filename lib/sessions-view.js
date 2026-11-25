/**
 * lib/sessions-view.js
 *
 * Pure helpers that adapt pipeline Loop records (lib/pipeline-loops.js) into the
 * lean shape the Swipe "Dispatched Sessions" accordion consumes.
 *
 * Two responsibilities, both side-effect-free and store-agnostic:
 *   - `buildSessionCounts(loops)` — per-issue counts, baked into the Swipe page
 *     at render time so each card header can show `Dispatched Sessions [N]`
 *     without a per-card fetch.
 *   - `toSessionView(loop)` — trims a Loop down to what the accordion body needs,
 *     dropping the (potentially large) prompt text and pipeline-only fields.
 *
 * LIN-2205 (LIN-1728 F6 follow-up): `toSessionView` drops `kind` from its
 * `feedback[]` projection entirely, so a client-side filter can't distinguish
 * a decision-lifecycle stamp from a real feedback line — the exclusion must
 * happen HERE, server-side, before the projection strips the one field that
 * would let it.
 */
import { maskFeedbackFields } from './dispatch-feedback-masking.js';
import { isDecisionLifecycleStampEntry } from './pipeline-loops.js';

/**
 * Count loops per `issueIdentifier`.
 *
 * Returns a plain object (JSON-friendly, cheap to look up in the renderer).
 * Loops without an identifier are skipped — every real dispatch carries one,
 * so this only guards against malformed records.
 *
 * @param {Array<Object>} loops - Loop records from getLoopsForWorkspace
 * @returns {Object<string, number>} identifier → count
 */
export function buildSessionCounts(loops) {
  const counts = {};
  if (!Array.isArray(loops)) return counts;
  for (const loop of loops) {
    if (!loop || !loop.issueIdentifier) continue;
    counts[loop.issueIdentifier] = (counts[loop.issueIdentifier] || 0) + 1;
  }
  return counts;
}

/**
 * Project a single Loop into the Sessions-accordion view shape.
 *
 * Intentionally omits `promptText` (large, unused by the section) and the
 * pipeline-only derivations (agentAction/agentStatus/agentTimestamp,
 * issueId/Title/Url) to keep the payload small.
 *
 * @param {Object} loop - a Loop record
 * @returns {Object} trimmed session view
 */
export function toSessionView(loop) {
  if (!loop) return null;
  return {
    loopId: loop.loopId,
    iteration: loop.iteration,
    promptName: loop.promptName || null,
    stage: loop.stage || null,
    agentState: loop.agentState || null,
    dispatchedAt: loop.dispatchedAt || null,
    resolvedAt: loop.resolvedAt || null,
    target: loop.target || null,
    source: loop.source || null,
    historyStatus: loop.historyStatus || null,
    agentSummary: loop.agentSummary || null,
    feedback: Array.isArray(loop.feedback)
      ? loop.feedback
          .filter(f => !isDecisionLifecycleStampEntry(f))
          .map(f => ({
            // LIN-4560: masked at read with piece A's masker, as the run page, Dispatch history and the proxy read are,
            // so a row stored before intake masking (LIN-4556) shows masked in the fold too. A clean line is unchanged.
            message: f && typeof f.message === 'string' ? maskFeedbackFields({ message: f.message }).message : '',
            timestamp: f && f.timestamp ? f.timestamp : null,
            // LIN-4560 (finding-6ea68b77): the child agent an `agent-text` entry names, sparse as on every other read,
            // so the fold groups a child's words under its agent rather than listing them as the run's own lines.
            ...(f && f.agent ? { agent: String(f.agent) } : {})
          }))
      : []
  };
}
