/**
 * The stage contract (LIN-3292): the exact formats later steps parse, appended
 * by code after a stage's body (finishStagePrompt), so no template prose repeats
 * them and each is said once. Each line names a reader; a format with no reader
 * stays out. Readers use as-asked.js readFact: below the block wins. The lines are each kind's
 * `contract` on its record (lib/prompts/stage-kinds.js, LIN-4467).
 *
 *   (sealed)       `## As asked` block       brief.js, the proxy guard, description/below
 *   plan           `## Implementation Plan`  file-pointer.js, follow-on-ratio.js
 *                  session-fit phrase        recommendation-facts.js extractSessionFit
 *                  `plan-review due: yes`    plan-review-round-trips.js planReviewDueOf
 *   plan-review    `### Plan Review Verdict` + a verdict word beside "Verdict"
 *                                            plan-review-round-trips.js extractVerdict
 *                  `Blocking findings: <n>`  recommendation-facts.js assemblePlanReviewFacts
 *   implementation the PR's full URL         run-evidence.js extractPrUrls
 *   review         title, head sha, CI line, ledger, verdict   run-ledger.js
 *   close-out      title starting Close-out  run-ledger.js TITLE_NON_REVIEW;
 *                  the description literals above survive the prune
 *
 * A read-only tracker takes no writes, so it gets no contract.
 */
import { STAGE_KINDS } from './prompts/stage-kinds.js';

/**
 * The contract section for a template key, or '' for a stage with none.
 * @param {string} templateKey - PROMPT_TEMPLATES key
 * @param {string} identifier - The task's identifier
 * @param {{write?: boolean}} [caps] - Resolved prompt capabilities; no writes, no contract
 */
export function formatStageContract(templateKey, identifier, { write = true } = {}) {
  const lines = Object.hasOwn(STAGE_KINDS, templateKey) ? STAGE_KINDS[templateKey].contract : null;
  if (!lines || !write) return '';
  return `\n\n## Formats Later Steps Read\n\n${lines(identifier).map(l => `- ${l}`).join('\n')}`;
}
