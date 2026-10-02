// Close-out state (LIN-3248, P3 of LIN-2949; S14) and the R1 Done predicate.
//
// PURE: no I/O, no clock, no store. The PR-state read itself lives on the
// existing reader — `readPrStatusFailOpen` in `lib/github-pr-status.js` (F3: no
// new GitHub reader module); this module only folds the reader's results, the
// run's latest review verdict and the ladder's runner-readiness flag into the
// close-out box state, and decides whether a self-merge may set the task Done.
//
// "Ready" is decided per PR, not per task: a review Approve is on record,
// exactly one open PR, and a runner is set up per the ladder's readiness
// predicate. A merged PR beside an open one is a PARTIAL close: it records the
// person's merge but leaves the task In Progress ("PR #N merged · 1 more PR
// open"). An unreadable PR state fails open to UNKNOWN ("not checked"), never
// to a false ready or a false merged.
//
// R1: the ticket's sketches mandate "merged by you marks done", relaxing the
// close-out gate (`lib/prompt-template-defs.js:1173,1186`). `closeOutSetsDone`
// names the one relaxation and bounds it with four conditions; when any fails,
// the caller records the merge event but does not set Done.

import { sameHead } from './run-evidence.js';

/** The box states `deriveCloseOutState` can return. */
export const CLOSE_OUT_STATUS = Object.freeze({
  NO_PR: 'no-pr',
  UNKNOWN: 'unknown',
  MULTIPLE_PRS: 'multiple-prs',
  PARTIAL: 'partial',
  MERGED: 'merged',
  CLOSED: 'closed',
  READY: 'ready',
  NOT_READY: 'not-ready',
});

/** The copy the page shows for a pressable run. */
export const READY_COPY = '✓ PR ready for close-out';
/** The copy the page shows whenever the run is not yet pressable (never hidden). */
export const SETUP_COPY = '○ set up ›';

const APPROVED_VERDICTS = new Set(['approve', 'approve-conditional']);

/**
 * Is the latest review verdict one that authorises a close-out? Approve and
 * Approve — conditional only. Pure.
 * @param {Object|null} review - a `parseRunLedger` model (or `{ verdict }`)
 * @returns {boolean}
 */
export function isApprovedReview(review) {
  const verdict = review && typeof review.verdict === 'string' ? review.verdict : null;
  return APPROVED_VERDICTS.has(verdict);
}

function headShaOf(status) {
  if (!status || status.readable !== true) return null;
  return (status.head && status.head.sha) || status.ref || null;
}

/** Fold one PR + its reader result into a per-PR entry. Pure. */
function entryFor(pr, status, review) {
  const readable = !!(status && status.readable === true);
  const merged = readable && status.merged === true;
  const state = readable ? (status.state || null) : null;
  const open = readable && state === 'open' && !merged;
  const headSha = headShaOf(status);
  const headMoved = !!(readable && review && review.sha && headSha && !sameHead(review.sha, headSha));
  return {
    url: pr.url,
    repo: pr.repo,
    number: pr.number,
    corroborated: !!pr.corroborated,
    readable,
    state,
    merged,
    open,
    headSha,
    headMoved,
  };
}

function remainderCopy(openCount) {
  return openCount === 1 ? '1 more PR open' : `${openCount} more PRs open`;
}

/**
 * Derive the close-out box state. Pure.
 *
 * @param {Object} input
 * @param {Array<{url: string, repo: string, number: number, corroborated?: boolean}>} [input.prs]
 *   the run's PR URLs, as `extractPrUrls` returns them.
 * @param {Array<Object|null>} [input.prStatuses] - the `readPrStatusFailOpen`
 *   result for each PR, index-aligned with `prs`.
 * @param {Object|null} [input.review] - the latest `parseRunLedger` model.
 * @param {boolean} [input.runnerReady] - the ladder's readiness predicate.
 * @param {boolean} [input.owner] - the viewer owns the task (guests get no box).
 * @param {('pr'|null)} [input.stopAt] - the run's boundary fact. Close-out is a
 *   stop-at-PR surface only (LIN-3245 note): without `stopAt: 'pr'` the run is
 *   never `ready`, however the PR reads.
 * @param {boolean} [input.byPersonCheck] - the read is the person's own signed-
 *   in `check` route, never a worker token (R1's fourth bound).
 * @returns {Object} the box model
 */
export function deriveCloseOutState({
  prs = [],
  prStatuses = [],
  review = null,
  runnerReady = false,
  owner = false,
  stopAt = null,
  byPersonCheck = false,
} = {}) {
  const list = Array.isArray(prs) ? prs : [];
  const entries = list.map((pr, i) => entryFor(pr, prStatuses[i], review));
  const approved = isApprovedReview(review);

  const openEntries = entries.filter(e => e.open);
  const mergedEntries = entries.filter(e => e.merged);
  const unknownEntries = entries.filter(e => !e.readable);

  const counts = {
    openCount: openEntries.length,
    mergedCount: mergedEntries.length,
    unknownCount: unknownEntries.length,
  };

  const base = {
    owner: !!owner,
    prs: entries,
    ...counts,
    headMoved: entries.some(e => e.headMoved),
    stopAt: stopAt || null,
    ready: false,
    pressable: false,
    setDone: false,
    mergedByYou: false,
    readyCopy: null,
    setupCopy: null,
    reason: null,
    review: { verdict: review && review.verdict ? review.verdict : null, approved },
  };

  if (list.length === 0) {
    return {
      ...base,
      status: CLOSE_OUT_STATUS.NO_PR,
      pr: null,
      message: "no pull request found in this task's comments",
    };
  }

  // Fail open: an unreadable PR is never treated as open or merged.
  if (unknownEntries.length > 0) {
    return {
      ...base,
      status: CLOSE_OUT_STATUS.UNKNOWN,
      pr: unknownEntries[0],
      message: 'the pull request could not be read — not checked',
      setupCopy: SETUP_COPY,
      reason: 'pr-unreadable',
    };
  }

  const candidateMerged = mergedEntries[0] || null;

  // A merged PR beside at least one still-open PR: the task stays In Progress.
  if (mergedEntries.length > 0 && openEntries.length > 0) {
    return {
      ...base,
      status: CLOSE_OUT_STATUS.PARTIAL,
      pr: candidateMerged,
      mergedByYou: true,
      message: `PR #${candidateMerged.number} merged · ${remainderCopy(openEntries.length)}`,
    };
  }

  if (mergedEntries.length > 0) {
    const setDone = closeOutSetsDone({
      prStatuses,
      prIndex: entries.indexOf(candidateMerged),
      review,
      byPersonCheck,
    });
    return {
      ...base,
      status: CLOSE_OUT_STATUS.MERGED,
      pr: candidateMerged,
      mergedByYou: true,
      setDone,
      message: `PR #${candidateMerged.number} merged`,
    };
  }

  if (openEntries.length === 0) {
    return {
      ...base,
      status: CLOSE_OUT_STATUS.CLOSED,
      pr: entries[0],
      message: `the pull request is ${entries[0].state || 'not open'}`,
      setupCopy: SETUP_COPY,
      reason: 'pr-not-open',
    };
  }

  // Exactly one open PR is required for ready; more than one is never ready.
  if (openEntries.length > 1) {
    return {
      ...base,
      status: CLOSE_OUT_STATUS.MULTIPLE_PRS,
      pr: null,
      message: `more than one PR open (${openEntries.length}): close each out on GitHub or with run this step`,
      setupCopy: SETUP_COPY,
      reason: 'multiple-open-prs',
    };
  }

  const only = openEntries[0];
  const solePr = list.length === 1;
  const stopAtPr = stopAt === 'pr';

  if (solePr && approved && runnerReady && stopAtPr) {
    return {
      ...base,
      status: CLOSE_OUT_STATUS.READY,
      pr: only,
      ready: true,
      // The press is the owner's; a non-owner viewer never gets a pressable box.
      pressable: !!owner,
      readyCopy: READY_COPY,
    };
  }

  const reason = !stopAtPr
    ? 'not-stop-at-run'
    : (!approved ? 'review-not-approve' : (!runnerReady ? 'runner-not-set-up' : 'multiple-prs'));
  return {
    ...base,
    status: CLOSE_OUT_STATUS.NOT_READY,
    pr: only,
    message: !stopAtPr
      ? 'close-out is only for a run that stops at the PR'
      : (!approved
        ? 'the review has not approved this PR yet'
        : (!runnerReady ? 'no runner is set up for this workspace yet' : 'this task has more than one PR')),
    setupCopy: SETUP_COPY,
    reason,
  };
}

/**
 * R1 Done predicate. Harbour sets the task Done only when ALL hold, else the
 * caller records the merge event and leaves Done alone:
 *
 *   1. the PR is `merged` per `fetchPrStatus` (the reader);
 *   2. the latest review verdict is Approve or Approve — conditional;
 *   3. the run's evidence names no OTHER unmerged PR (the multi-PR rule); and
 *   4. the call is the person's own check, never a worker token.
 *
 * @param {Object} input
 * @param {Array<Object|null>} [input.prStatuses] - index-aligned reader results
 * @param {number} [input.prIndex] - the merged PR's index within `prStatuses`
 * @param {Object|null} [input.review] - the latest review model
 * @param {boolean} [input.byPersonCheck] - the person's own check
 * @returns {boolean}
 */
export function closeOutSetsDone({ prStatuses = [], prIndex = 0, review = null, byPersonCheck = false } = {}) {
  const statuses = Array.isArray(prStatuses) ? prStatuses : [];
  const target = statuses[prIndex];
  if (!target || target.readable !== true || target.merged !== true) return false;
  if (!isApprovedReview(review)) return false;
  const otherUnmerged = statuses.some((status, i) => {
    if (i === prIndex) return false;
    return !(status && status.readable === true && status.merged === true);
  });
  if (otherUnmerged) return false;
  if (byPersonCheck !== true) return false;
  return true;
}
