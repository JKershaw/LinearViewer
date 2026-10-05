// PR-state header copy (LIN-3251, S1b of LIN-2948).
//
// One pure function so the server-rendered line (beat 2) and the client poll
// (beat 3) cannot drift. The input is the `GET .../pr-state` route's own shape
// (`{ state, number, checks }`); the words follow the plan's approved forms.
//
// The one rule the copy must never break (C1): "nothing has been merged" is only
// ever said after a read that saw an OPEN pull request. Without such a read the
// copy reports the record ("No pull request yet.") or withholds ("state not
// reported") — it never infers a merge.

const CHECK_COPY = { passing: 'passing', failing: 'failing', running: 'running' };

/**
 * @param {{state?: string, number?: number|null, checks?: string|null}} prState
 * @returns {string}
 */
export function prStateCopy(prState) {
  const state = prState && prState.state;
  const number = prState && prState.number != null ? prState.number : null;
  const pr = number == null ? null : `PR #${number}`;
  switch (state) {
    case 'open': {
      const checks = prState.checks && CHECK_COPY[prState.checks];
      const tail = checks ? `: checks ${checks}` : '';
      return pr
        ? `Nothing has been merged. ${pr} is open${tail}.`
        : `Nothing has been merged. The pull request is open${tail}.`;
    }
    case 'merged':
      return pr ? `${pr} was merged.` : 'The pull request was merged.';
    case 'closed':
      return pr ? `${pr} was closed without merging.` : 'The pull request was closed.';
    case 'none':
      return 'No pull request yet.';
    default:
      return pr ? `${pr}: state not reported.` : 'Pull request state not reported.';
  }
}
