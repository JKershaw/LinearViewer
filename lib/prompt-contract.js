/**
 * The stage contract (LIN-3292/LIN-3296): the exact formats later steps parse,
 * appended by code after a stage's brief on both prompt paths, so no prose — a
 * template's, the meta-prompt writer's, or a future writing layer's — has to
 * remember them. Each line names a reader; a format with no reader stays out.
 *
 *   plan      `## Implementation Plan` — lib/file-pointer.js, lib/follow-on-ratio.js
 *   review    a title naming Review    — run-ledger.js isReviewSummary
 *             head `<sha>`             — run-ledger.js findSha → headMoved
 *   close-out a title starting Close-out — run-ledger.js TITLE_NON_REVIEW keeps
 *             a close-out summary from being read as the latest review
 */

const CONTRACT_LINES = {
  plan: () => [
    'Put the plan in the description under a `## Implementation Plan` heading.'
  ],
  review: (identifier) => [
    `Title the summary comment \`## Review — ${identifier}\`, and name the head you reviewed as head \`<sha>\`.`
  ],
  'close-out': (identifier) => [
    `Title your summary comment \`## Close-out — ${identifier}\`.`
  ]
};

/** The contract section for a template key, or '' for a stage with none. */
export function formatStageContract(templateKey, identifier) {
  const lines = CONTRACT_LINES[templateKey];
  if (!lines) return '';
  return `\n\n## Formats Later Steps Read\n\n${lines(identifier).map(l => `- ${l}`).join('\n')}`;
}
