/**
 * The fix-round brief (LIN-3309).
 *
 * When the latest review on a task requested changes, the implementation brief
 * must continue the SAME PR and answer the findings — not hand out a fresh-start
 * "Open a PR" workflow (the LIN-3304 slip). Code decides by reading the review
 * verdict with the one review reader (`lib/run-ledger.js`), so the section reaches
 * every implementation-prompt path (routed, pinned, fixed) through the template.
 *
 * The text lives here, outside the frozen `lib/prompt-template-defs.js`, so the
 * byte freeze is paid only by the small call site that imports it.
 */
import { readRunLedger, latestReviewRef } from '../run-ledger.js';

/** True when the latest review verdict on the trail is Request Changes. */
export function isRequestChangesRound(comments) {
  return readRunLedger(comments).verdict === 'request-changes';
}

/**
 * The implementation workflow, with steps 3 and 7 switched for a fix round. The
 * fresh-start text is byte-identical to the template's previous literal.
 *
 * @param {Object} issue - Uses identifier
 * @param {boolean} fixRound - True when the latest review requested changes
 * @returns {string}
 */
export function buildImplementationWorkflow(issue, fixRound) {
  const branch = fixRound
    ? '**Branch**: Continue the existing branch and PR the review names — do not create a new branch'
    : `**Branch**: Work on a feature branch (e.g. \`feat/${issue.identifier.toLowerCase()}-short-description\`) — never commit straight to main`;
  const push = fixRound
    ? '**to the same branch**'
    : 'the branch';
  const pr = fixRound
    ? '**Update the PR**: Push the fixes to the existing PR and answer each finding in your summary comment — do not open a new PR'
    : `**Open a PR**: Open a pull request targeting main and referencing ${issue.identifier} — the PR is this step's deliverable, the evidence the work landed`;
  return `## Workflow

1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear${fixRound ? ', including the review comment with its findings' : ''}
3. ${branch}
4. **Implement**: ${fixRound ? 'Address every finding below' : 'Complete the goal below'}
5. **Test**: Run tests to verify ${fixRound ? 'the fixes' : 'implementation'}
6. **Commit & push**: Commit with a message referencing ${issue.identifier}${fixRound ? ' and the finding' : ''}, then push ${push}
7. ${pr}
8. **Confirm CI (or its substitute)**: see "Establish CI (or Its Substitute)" below. If CI exists and is red, fix the failures and push again until it is green. This step is done only when the PR is open AND (CI is green, or CI-absence plus the substitute run is recorded) — if neither can be achieved, say so explicitly with the reason rather than reporting success. (Merging is NOT yours: the merge happens after review approves, performed by the orchestrator or a human.)
9. **Update Linear**: Add a summary comment in Linear with the PR link`;
}

/**
 * The "Revising After a Review" section: the fix round's process, owned by code.
 * Returns '' when the latest verdict is not Request Changes, so the fresh-start
 * brief is unchanged.
 *
 * @param {Array} comments - The task's comments
 * @param {boolean} fixRound - Result of isRequestChangesRound
 * @returns {string}
 */
export function buildRevisionSection(comments, fixRound) {
  if (!fixRound) return '';
  const ref = latestReviewRef(comments);
  const where = ref?.url
    ? `the PR the review names — \`${ref.url}\` — and its branch`
    : 'the PR the review names';
  const quoted = ref?.title ? ` (review: \`${ref.title}\`)` : '';
  return `### Revising After a Review

The latest review verdict is **Request Changes**${quoted}, so this pass is a revision, not a fresh start. Continue ${where}: commit the fixes, push to that existing PR, and open NO new PR. Work through the review's findings and either fix each one or answer it explicitly with your reasoning — an unanswered finding reads as an overlooked one. Map each finding to its fix in your summary comment, and do not re-implement what already landed.`;
}
