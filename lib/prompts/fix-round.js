/**
 * The fix round (LIN-3309), read from records (LIN-4520: the comment reader is retired).
 *
 * When the latest review on a task requested changes, the implementation prompt must continue the SAME PR and answer the
 * findings, not hand out a fresh-start "Open a PR" workflow (the LIN-3304 slip). Code decides it from the review verdict
 * on record (`reviewRoundOf`), so the workflow reaches every implementation-prompt path (routed, pinned, fixed) through
 * the template. The separate "Revising After a Review" brief is retired (LIN-4520, finding-a610ceb9): its reasoning
 * reaches the stage through the brief's "what stands" part (lib/records/brief.js), where the open change and the open
 * findings to implementation sit; the workflow below says the same things in its own steps.
 *
 * The text lives here, outside the frozen `lib/prompt-template-defs.js`, so the byte freeze is paid only by the small call
 * site that imports it.
 */

/**
 * The fix round, read from the ticket's records trail: `fixRound` when the latest review's verdict on record is
 * request-changes. Null when the trail was not read: the workflow then stays the fresh-start one.
 * @param {Object|null} trail - the records trail (lib/task-standing.js trailForTicket)
 * @returns {{fixRound: boolean}|null}
 */
export function reviewRoundOf(trail) {
  if (!trail) return null;
  return { fixRound: trail.review?.verdict === 'request-changes' };
}

/** True when the latest review on record requested changes (`reviewRoundOf`). */
export function isRequestChangesRound(reviewRound) {
  return reviewRound?.fixRound === true;
}

/**
 * The implementation workflow, with steps 2 to 7 switched for a fix round. The fresh-start text is byte-identical to the
 * template's previous literal. The template keeps two empty entries after it where the retired revision section stood
 * (lib/prompt-template-defs.js), so the fresh-start prompt is byte-identical (LIN-4520).
 *
 * @param {Object} issue - Uses identifier
 * @param {boolean} fixRound - True when the latest review requested changes
 * @returns {string}
 */
export function buildImplementationWorkflow(issue, fixRound) {
  const branch = fixRound
    ? '**Branch**: Continue the existing branch and the PR the task\'s change record names — do not create a new branch'
    : `**Branch**: Work on a feature branch (e.g. \`feat/${issue.identifier.toLowerCase()}-short-description\`) — never commit straight to main`;
  const push = fixRound
    ? '**to the same branch**'
    : 'the branch';
  const pr = fixRound
    ? '**Update the PR**: Push the fixes to the existing PR and answer each finding in your summary comment — do not open a new PR'
    : `**Open a PR**: Open a pull request targeting main and referencing ${issue.identifier} — the PR is this step's deliverable, the evidence the work landed`;
  const implement = fixRound
    ? 'Address every open finding to implementation on this task: fix each one, or answer it explicitly with your reasoning (an unanswered finding reads as an overlooked one), and map each to its fix in your summary comment. Do not re-implement what already landed.'
    : 'Complete the goal below';
  return `## Workflow

1. **Start**: Set ${issue.identifier} status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for ${issue.identifier} in Linear${fixRound ? ', including the open findings to implementation on this task (in the brief\'s "what stands" part)' : ''}
3. ${branch}
4. **Implement**: ${implement}
5. **Test**: Run the tests that bear on ${fixRound ? 'the fixes' : 'the change'}, as set out under "Test Before Pushing" below
6. **Commit & push**: Commit with a message referencing ${issue.identifier}${fixRound ? ' and the finding' : ''}, then push ${push}
7. ${pr}
8. **Confirm CI (or its substitute)**: see "Establish CI (or Its Substitute)" below. If CI exists and is red, fix the failures and push again until it is green. This step is done only when the PR is open AND (CI is green, or CI-absence plus the substitute run is recorded) — if neither can be achieved, say so explicitly with the reason rather than reporting success. (Merging is NOT yours: the merge happens after review approves, performed by the orchestrator or a human.)
9. **Update Linear**: Add a summary comment in Linear with the PR link`;
}
