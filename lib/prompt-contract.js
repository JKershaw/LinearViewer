/**
 * The stage contract (LIN-3292): the exact formats later steps parse, appended
 * by code after a stage's body (finishStagePrompt), so no template prose has to
 * remember them. Each
 * line names a reader; a format with no reader stays out. A template body that
 * asked for one of these formats no longer does, so it is said once.
 *
 *   plan           `## Implementation Plan`  file-pointer.js, follow-on-ratio.js
 *                  session-fit phrase        recommendation-facts.js extractSessionFit
 *                  `plan-review due: yes`    plan-review-round-trips.js GATE_DUE_MARKER
 *   plan-review    `### Plan Review Verdict` + a verdict word beside "Verdict"
 *                                            plan-review-round-trips.js extractVerdict
 *   implementation the PR's full URL         run-evidence.js extractPrUrls
 *   review         title, head sha, CI line, ledger, verdict   run-ledger.js
 *   close-out      title starting Close-out  run-ledger.js TITLE_NON_REVIEW;
 *                  the description literals above survive the prune
 *
 * A read-only tracker takes no writes, so it gets no contract.
 */

const CONTRACT_LINES = {
  plan: () => [
    'Put the plan in the description under a `## Implementation Plan` heading.',
    'State session fit there as exactly `fits one session` or `needs multiple sessions`, and use neither phrase elsewhere.',
    'Add one line: `plan-review due: yes` or `plan-review due: no`.'
  ],
  'plan-review': () => [
    'Post one comment that starts with `### Plan Review Verdict`, then `**Verdict:**` and one of Approve, Request Changes or Needs Discussion with a one-line reason, then the findings.'
  ],
  implementation: (identifier) => [
    `Put the PR's full URL (\`https://github.com/<owner>/<repo>/pull/<n>\`) in your summary comment on ${identifier}. One PR carries this task.`
  ],
  review: (identifier) => [
    `Title the summary comment \`## Review — ${identifier}\`, and name the head you reviewed as head \`<sha>\`.`,
    'State CI on one line starting `CI:` (green, red, or absent plus the substitute run).',
    'Put the ledger under `### What CI Did Not Prove`, one list item per claim, each saying inside or outside. Write "discharged" only for an item already settled. If nothing is left, write `CI covers the deliverable; ledger empty`.',
    'End with `### Verdict` and one of: `Approve`, `Approve — conditional on close-out discharging the ledger`, `Request Changes`, `Needs Discussion`.'
  ],
  'close-out': (identifier) => [
    `Title your summary comment \`## Close-out — ${identifier}\`.`,
    'When you prune the description, keep word for word any `Implementation Plan` heading, the session-fit phrase (`fits one session` / `needs multiple sessions`) and any `plan-review due:` line: code reads them there.'
  ]
};

/**
 * The contract section for a template key, or '' for a stage with none.
 * @param {string} templateKey - PROMPT_TEMPLATES key
 * @param {string} identifier - The task's identifier
 * @param {{write?: boolean}} [caps] - Resolved prompt capabilities; no writes, no contract
 */
export function formatStageContract(templateKey, identifier, { write = true } = {}) {
  const lines = Object.hasOwn(CONTRACT_LINES, templateKey) ? CONTRACT_LINES[templateKey] : null;
  if (!lines || !write) return '';
  return `\n\n## Formats Later Steps Read\n\n${lines(identifier).map(l => `- ${l}`).join('\n')}`;
}
