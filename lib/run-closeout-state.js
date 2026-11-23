// Close-out state (LIN-3248, P3 of LIN-2949; S14), the one close-out decision (LIN-4460).
//
// PURE: no I/O, no clock, no store. The PR-state read itself lives on the
// existing reader — `readPrStatusFailOpen` in `lib/github-pr-status.js` (F3: no
// new GitHub reader module); this module only folds the reader's results, the
// records trail (lib/task-standing.js trailForTicket) and the ladder's runner-readiness flag.
//
// `closeOutDecision` is the one place that answers every close-out question:
// the box's status and reason, the guard's refusal, whether the owner's check
// may set Done, whether the blind-read gate is waited on, and whether the
// recommendation routes a read, or a re-review of a moved head (LIN-4521). Every surface renders or enforces that answer
// and decides nothing itself. `deriveCloseOutState` is the box model built from
// it (the renderers read that shape); the reasons and their copy live in
// `CLOSE_OUT_REASONS`, in the order the decision checks them.
//
// The passenger rule (LIN-4447, John, 13 Nov: "if I choose to do something,
// Harbour is a passenger"): a landing whose every PR reads merged is followed,
// so the gate stands aside (`followsPerson: 'merged'`). A missing, unreadable or
// unmerged status is "not known merged" and the gate holds. A ticket Done in the
// tracker does NOT stand the enforcement gate aside (a Done ticket beside an
// open, unread landing still refuses Harbour's merge); it loosens only the
// recommendation's read, which is its own answer (`routesRead`).
//
// "Ready" is decided per PR, not per task: a review Approve is on record,
// exactly one open PR, and a runner is set up per the ladder's readiness
// predicate. A merged PR beside an open one is a PARTIAL close. An unreadable PR
// state fails open to UNKNOWN ("not checked"), never to a false ready or a false
// merged. A sole open PR whose head moved since the review approved it is NOT
// ready (`head-moved`, LIN-3418).
//
// Set Done (`setDone`) is the person's act only: `actor: 'person'`, every
// landing PR readable and merged, an approving review. Harbour (`actor:
// 'harbour'`) never sets Done. The R1 relaxation of the gate (a person's merge
// marks Done, lib/prompt-template-defs.js) is bounded here, in one place.

import { isTerminalState } from './providers/state-map.js';
import { prOf } from './run-ledger.js';
import { BLIND_READ_KIND } from './prompts/blind-read-words.js';
import { findingsHold, findingsCopy, findingsCount } from './close-out-findings.js';

/** Two shas are "the same head" if equal or one is an abbreviation of the other. */
export function sameHead(a, b) {
  if (!a || !b) return true;
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  return x === y || x.startsWith(y) || y.startsWith(x);
}

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

/** Who is asking: the signed-in person's own check, or Harbour (the guard, the merge recorder, the box). */
export const CLOSE_OUT_ACTOR = Object.freeze({ PERSON: 'person', HARBOUR: 'harbour' });

/** The copy the page shows for a pressable run. */
export const READY_COPY = '✓ PR ready for close-out';
/** The copy the page shows whenever the run is not yet pressable (never hidden). */
export const SETUP_COPY = '○ set up ›';

/** The copy the box and the refusal give when no blind read on record names the landing (LIN-4438, LIN-4544). */
export const BLIND_READ_MISSING_COPY = 'no blind read on record naming the pull requests';

const NEUTRAL_MERGED = 'the pull request is already merged';

/**
 * The reasons a close-out is not ready, in the order `closeOutDecision` checks them, each with its
 * message copy (`message(ctx)`) and, for the two reasons a press or a dispatch is refused on, the
 * refusal's error text (`refusal`). Frozen: the census (tests/unit/lin-4460-close-out-decision.test.js)
 * fails on any reason spelled outside this module.
 */
export const CLOSE_OUT_REASONS = Object.freeze([
  Object.freeze({ reason: 'blind-read-missing', message: () => BLIND_READ_MISSING_COPY, refusal: 'No blind read on record naming the pull requests' }),
  Object.freeze({ reason: 'pr-unreadable', message: ({ multi }) => (multi ? 'the remaining pull requests could not be read — not checked' : 'the pull request could not be read — not checked') }),
  Object.freeze({ reason: 'pr-not-open', message: ({ state }) => `the pull request is ${state || 'not open'}` }),
  Object.freeze({ reason: 'multiple-prs', message: ({ count }) => `more than one PR open (${count}): close each out on GitHub or with run this step` }),
  Object.freeze({ reason: 'head-moved', message: () => 'the pull request changed since the review approved it', refusal: 'The pull request changed since the review approved it' }),
  // LIN-4495: an open finding to close-out on this task (or a reading that is not measured) holds readiness, Done and
  // the merge. It refuses no dispatch: close-out is the stage that ends those findings, so it is always admitted.
  Object.freeze({ reason: 'open-findings', message: ({ findings }) => findingsCopy(findings) }),
  Object.freeze({ reason: 'not-stop-at-run', message: () => 'close-out is only for a run that stops at the PR' }),
  Object.freeze({ reason: 'review-not-approve', message: () => 'the review has not approved this PR yet' }),
  Object.freeze({ reason: 'runner-not-set-up', message: () => 'no runner is set up for this workspace yet' }),
]);

const REASON_BY_ID = new Map(CLOSE_OUT_REASONS.map(r => [r.reason, r]));

/** The reason ids, by name, for a reader that branches on one (the task page's line); the copy is `CLOSE_OUT_REASONS`'s. */
export const CLOSE_OUT_REASON = Object.freeze(Object.fromEntries(CLOSE_OUT_REASONS.map(r => [r.reason.toUpperCase().replace(/-/g, '_'), r.reason])));

function reasonCopy(reason, ctx = {}) {
  return REASON_BY_ID.get(reason).message(ctx);
}

/**
 * The error text a refused close-out carries (the 409 body), or null for a reason that refuses nothing.
 * @param {string|null} reason
 * @returns {string|null}
 */
export function closeOutRefusalCopy(reason) {
  return (reason && REASON_BY_ID.get(reason)?.refusal) || null;
}

/**
 * Is the latest review verdict one that authorises a close-out? An approve on record. A records approve carries its
 * conditions as open findings to close-out, so there is no conditional verdict (the comment parse that produced one is
 * retired, LIN-4520; finding-ba76decd). Pure.
 * @param {Object|null} review - the records trail's review (or `{ verdict }`)
 * @returns {boolean}
 */
export function isApprovedReview(review) {
  const verdict = review && typeof review.verdict === 'string' ? review.verdict : null;
  return verdict === 'approve';
}

/**
 * Normalize a dispatch-store list result to an array. `listItems` returns an array, but `listHistory`
 * returns `{ items, total }` — and a finished run's row lives only in history, so calling `.some` on the
 * raw `{ items }` result throws (LIN-3248 review F3). Shared by the check route and the session page.
 *
 * @param {Array|{items?: Array}|null|undefined} result
 * @returns {Array}
 */
export function listRows(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

/**
 * The authoritative run variant, read off the row's persisted `variant` field (LIN-3248 N2 fix). NOT
 * sniffed from `promptName`. Fail CLOSED — unknown, missing or a non-autopilot row is `unknown`, never
 * `standard`, so the "Harbour stops this run at the PR" promise is shown only when the run is POSITIVELY
 * known to be standard.
 *
 * @param {{variant?: string}|null} row - a dispatch row
 * @returns {'standard'|'stepper'|'unknown'}
 */
export function resolveRunVariant(row) {
  const variant = row && row.variant;
  if (variant === 'stepper') return 'stepper';
  if (variant === 'standard') return 'standard';
  return 'unknown';
}

/**
 * What close-out waits on, or null (LIN-4438): `'blind-read'` only when the latest review approves
 * (isApprovedReview), the landing has a PR, and some landing PR is not named by `review.blindRead`, the
 * latest read on record (LIN-4544: it stands across re-reviews; a PR that joins the landing is not named by it). The rule lives here and nowhere else: `closeOutDecision` asks it, and
 * so does nothing outside this module. The value is the stage kind close-out waits on, the same concept
 * as the kind, so it is BLIND_READ_KIND (lib/prompts/blind-read-words.js), not a second spelling of it.
 *
 * `landingPrs` is required (the trail's `landing`, from records): a caller that forgets it throws rather than
 * reading as "no PR, nothing to wait on".
 *
 * @param {Object|null} review - a review model carrying `verdict` and `blindRead` ({ prs } | null)
 * @param {string[]} landingPrs - the current landing's full PR URLs
 * @returns {'blind-read'|null}
 */
export function closeOutWaitsOn(review, landingPrs) {
  if (!Array.isArray(landingPrs)) throw new TypeError('closeOutWaitsOn: landingPrs (the trail\'s landing) is required');
  if (!isApprovedReview(review) || landingPrs.length === 0) return null;
  const named = new Set((review.blindRead && review.blindRead.prs) || []);
  return landingPrs.some(url => !named.has(url)) ? BLIND_READ_KIND : null;
}

function headShaOf(status) {
  if (!status || status.readable !== true) return null;
  return (status.head && status.head.sha) || status.ref || null;
}

/**
 * The PR statuses, as every caller hands them over (LIN-4458): a Map from a PR's full URL to its
 * reader result. Never a list lined up by position: the landing (oldest first) and the cited URLs
 * (newest first) order PRs differently, so an index taken from one points at the wrong PR in the
 * other. An array is refused loudly rather than read by position.
 */
function statusesByUrl(prStatuses, who) {
  if (prStatuses == null) return new Map();
  if (!(prStatuses instanceof Map)) throw new TypeError(`${who}: prStatuses is a Map from PR URL to its status (LIN-4458), not a list`);
  return prStatuses;
}

/**
 * Whether a PR's live head has left the head the review judged it at (LIN-4518 step 3). A records review carries `heads`
 * (the head each PR's pinned version holds) and `staleUrls` (the PRs a later revise staled), so each PR of a landing is
 * judged on its own: a PR the review did not judge at all has moved too. A review with no `heads` judged no head, so it
 * has moved (LIN-4520: the comment baseline that compared one `sha` is retired; standingOf always sets `heads`).
 * Exported: the evidence box's "Now" row reads this same rule (lib/run-evidence.js buildNow).
 * @param {string} url - the PR's URL
 * @param {string|null} headSha - the PR's live head
 * @param {{heads?: Object<string, string>, staleUrls?: string[]}} review - the records review's trail fields
 * @returns {boolean}
 */
export function headMovedFor(url, headSha, review) {
  if (!review.heads || typeof review.heads !== 'object') return true;
  if (Array.isArray(review.staleUrls) && review.staleUrls.includes(url)) return true;
  const judged = review.heads[url];
  return !judged || !headSha || !sameHead(judged, headSha);
}

/** Fold one PR + its reader result into a per-PR entry. Pure. */
function entryFor(pr, status, review) {
  const readable = !!(status && status.readable === true);
  const merged = readable && status.merged === true;
  const state = readable ? (status.state || null) : null;
  const open = readable && state === 'open' && !merged;
  const headSha = headShaOf(status);
  const headMoved = !!(readable && review && headMovedFor(pr.url, headSha, review));
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
 * The close-out decision (LIN-4460). Pure. Every surface calls it; none re-derives an answer.
 *
 * Enforcement (`status`, `reason`, `refuses`, `setDone`, `waitsOn`) reads the trail's landing and review
 * and the PR statuses only, never the ticket's state and never `workAfterReview`. Advice (`routesRead`, and `routesReview`
 * with the `movedPrs` it re-reviews, LIN-4521)
 * reads the trail and the ticket's state, and is the one answer the recommendation reads. `followsPerson`
 * is the passenger fact both read: 'merged' (the landing is positively merged: the gate stands aside),
 * 'done' (advice only: a Done ticket with no close-out on its landing and no audit notes PR), or null.
 *
 * @param {Object} input
 * @param {Object} input.trail - the trail's fields this reads (trailForTicket, lib/task-standing.js): `review` (with `blindRead`),
 *   `landing` (required), and for advice `workAfterReview`, `closeOutOnTrail`, `landingHasNotesPr`.
 * @param {Map<string, Object>} [input.prStatuses] - reader results keyed by PR URL; a PR with no entry is unread.
 * @param {('pr'|null)} [input.stopAt] - the run's boundary; close-out is a stop-at-PR surface only.
 * @param {boolean} [input.runnerReady] - the ladder's readiness predicate.
 * @param {('person'|'harbour')} [input.actor] - who asks; only `setDone` reads it.
 * @param {string|null} [input.ticketState] - the ticket's state type; advice only.
 * @param {Object} input.openFindings - REQUIRED: the task's open findings to close-out, read once by the caller
 *   (lib/close-out-findings.js). A not-read reading holds the close; none is never read as zero.
 * @returns {{
 *   status: string, reason: string|null, message: string|null, pr: Object|null,
 *   refuses: ('blind-read-missing'|'head-moved'|null), setDone: boolean, waitsOn: ('blind-read'|null),
 *   routesRead: boolean, routesReview: boolean, movedPrs: string[], followsPerson: ('merged'|'done'|null), entries: Object[],
 *   headMoved: boolean
 * }}
 */
export function closeOutDecision({ trail, prStatuses = null, stopAt = null, runnerReady = false, actor = CLOSE_OUT_ACTOR.HARBOUR, ticketState = null, openFindings } = {}) {
  if (!trail || !Array.isArray(trail.landing)) throw new TypeError('closeOutDecision: trail.landing (the landing PR URLs) is required');
  if (!openFindings || typeof openFindings !== 'object') throw new TypeError('closeOutDecision: openFindings (the reading from lib/close-out-findings.js readOpenFindings) is required');
  const findingsHeld = findingsHold(openFindings);
  if (actor !== CLOSE_OUT_ACTOR.PERSON && actor !== CLOSE_OUT_ACTOR.HARBOUR) throw new TypeError(`closeOutDecision: actor is 'person' or 'harbour', not ${actor}`);
  const landing = trail.landing;
  const review = trail.review || null;
  const statuses = statusesByUrl(prStatuses, 'closeOutDecision');
  const approved = isApprovedReview(review);

  const entries = landing.map(url => entryFor({ url, ...prOf(url), corroborated: false }, statuses.get(url), review));
  const openEntries = entries.filter(e => e.open);
  const mergedEntries = entries.filter(e => e.merged);
  const unknownEntries = entries.filter(e => !e.readable);
  const allMerged = entries.length > 0 && mergedEntries.length === entries.length;
  const headMoved = entries.some(e => e.headMoved);
  const candidateMerged = mergedEntries[0] || null;

  // Enforcement: the passenger rule's stand-aside, and the gate it stands aside from.
  const followsPerson = allMerged ? 'merged' : null;
  const waitsOn = allMerged ? null : closeOutWaitsOn(review, landing);

  // Advice: the recommendation's read. No PR statuses here, so `followsPerson: 'merged'` never applies.
  const completed = ticketState === 'completed';
  const closedOnTrail = trail.closeOutOnTrail === true;
  const notesPr = trail.landingHasNotesPr === true;
  const doneWithoutHarbour = completed && !closedOnTrail && !notesPr;
  const adviceWaits = closeOutWaitsOn(review, landing) === BLIND_READ_KIND;
  // The ticket guards both advice answers share (LIN-4521, finding-3d0569b8): a Canceled or Duplicate ticket stands aside, and
  // so does a Done one, unless its landing is an audit's notes PR that has no close-out on the trail yet.
  const ticketAllows = !(isTerminalState(ticketState) && !completed) && !(completed && (closedOnTrail || !notesPr));
  const routesRead = !!review && trail.workAfterReview !== true && adviceWaits && ticketAllows;
  // LIN-4521: the re-review. An approval no longer covers a landing PR whose open change moved since it was judged (the
  // records' `movedUrls`; a merged PR is stale but not moved). The ticket guards are routesRead's, one predicate
  // (`ticketAllows`).
  const movedPrs = approved ? landing.filter((url) => (review.movedUrls ?? []).includes(url)) : [];
  const routesReview = movedPrs.length > 0 && ticketAllows;

  const stopAtPr = stopAt === 'pr';
  const gated = stopAtPr && waitsOn === BLIND_READ_KIND;
  // LIN-4495: open findings to close-out hold Done too, even on a merged landing.
  const setDone = actor === CLOSE_OUT_ACTOR.PERSON && approved && allMerged && !findingsHeld;
  const mergedCopy = () => (stopAtPr ? `PR #${candidateMerged.number} merged` : NEUTRAL_MERGED);

  const at = (status, pr, reason = null, ctx = {}, message = null) => ({
    status, pr, reason, message: reason ? reasonCopy(reason, ctx) : message,
  });

  // LIN-4518 step 3 (LIN-4469 flaw 1): on records a stale approval refuses on any open PR that moved, the multi-PR branch
  // too. The comment baseline keeps its one-head reading (perPrReview is false there).
  const perPrReview = !!(review && review.heads && typeof review.heads === 'object');
  const perPrMoved = perPrReview && stopAtPr && approved && runnerReady && openEntries.some((e) => e.headMoved);

  let out;
  if (entries.length === 0) {
    out = at(CLOSE_OUT_STATUS.NO_PR, null, null, {}, "no pull request found on this task's records");
  } else if (entries.length > 1) {
    // Multi-PR: a task is never a single-PR close-out. A known partial merge is named.
    if (mergedEntries.length > 0 && openEntries.length > 0) {
      out = at(CLOSE_OUT_STATUS.PARTIAL, candidateMerged, null, {}, `PR #${candidateMerged.number} merged · ${remainderCopy(openEntries.length)}`);
    } else if (allMerged) {
      out = at(CLOSE_OUT_STATUS.MERGED, candidateMerged, null, {}, mergedCopy());
    } else if (mergedEntries.length > 0) {
      // A merged PR beside remaining PRs: unreadable remainders fail open; a readable closed one is named.
      if (unknownEntries.length > 0) {
        out = at(CLOSE_OUT_STATUS.UNKNOWN, candidateMerged, 'pr-unreadable', { multi: true }, null);
      } else {
        out = at(CLOSE_OUT_STATUS.PARTIAL, candidateMerged, null, {}, `PR #${candidateMerged.number} merged · ${entries.length - mergedEntries.length} more PR not merged`);
      }
    } else if (gated) {
      out = at(CLOSE_OUT_STATUS.NOT_READY, null, 'blind-read-missing');
    } else if (perPrMoved) {
      // A moved open PR of an open multi-PR landing: named as the head that moved, the same reason the single-PR branch gives.
      out = at(CLOSE_OUT_STATUS.NOT_READY, openEntries.find((e) => e.headMoved), 'head-moved');
    } else {
      out = at(CLOSE_OUT_STATUS.MULTIPLE_PRS, null, 'multiple-prs', { count: entries.length });
    }
  } else {
    // One PR: a merge already made is read first, so the gate never hides it.
    const only = entries[0];
    if (mergedEntries.length > 0) {
      out = at(CLOSE_OUT_STATUS.MERGED, candidateMerged, null, {}, mergedCopy());
    } else if (gated) {
      out = at(CLOSE_OUT_STATUS.NOT_READY, only, 'blind-read-missing');
    } else if (unknownEntries.length > 0) {
      out = at(CLOSE_OUT_STATUS.UNKNOWN, only, 'pr-unreadable', { multi: false });
    } else if (openEntries.length === 0) {
      out = at(CLOSE_OUT_STATUS.CLOSED, only, 'pr-not-open', { state: only.state });
    } else if (stopAtPr && approved && runnerReady && only.headMoved) {
      out = at(CLOSE_OUT_STATUS.NOT_READY, only, 'head-moved');
    } else if (stopAtPr && approved && runnerReady && findingsHeld) {
      out = at(CLOSE_OUT_STATUS.NOT_READY, only, 'open-findings', { findings: openFindings });
    } else if (stopAtPr && approved && runnerReady) {
      out = at(CLOSE_OUT_STATUS.READY, only, null, {}, null);
    } else {
      const reason = !stopAtPr ? 'not-stop-at-run' : (!approved ? 'review-not-approve' : 'runner-not-set-up');
      out = at(CLOSE_OUT_STATUS.NOT_READY, only, reason);
    }
  }

  // The refusal of a dispatch: the gate (either lane, whatever the box shows) or a head that moved (both actors).
  // LIN-4495: open findings to close-out do NOT refuse. They hold readiness and Done (`status`, `setDone`), and
  // close-out is the stage that ends them, so the guard and the press must admit it.
  const refuses = waitsOn === BLIND_READ_KIND ? 'blind-read-missing'
    : (out.reason === 'head-moved' || perPrMoved ? 'head-moved' : null);

  return {
    status: out.status,
    reason: out.reason,
    message: out.message,
    pr: out.pr,
    refuses,
    setDone,
    waitsOn,
    routesRead,
    routesReview,
    movedPrs: routesReview ? movedPrs : [],
    followsPerson: followsPerson || (doneWithoutHarbour ? 'done' : null),
    entries,
    headMoved,
  };
}

/**
 * The one `blind-read-missing` state (LIN-4438): the box model `from` with the gate's reason over it.
 * `from` is `deriveCloseOutState`'s model, so every lane's refusal carries one shape. Ready, pressable
 * and set-Done are reset, since a refused close-out sets nothing.
 *
 * @param {Object} from - a close-out box model
 * @param {Object|null} [pr] - the PR entry the state names, if any
 * @returns {Object} the box model
 */
export function blindReadMissingState(from, pr = null) {
  return {
    ...from,
    status: CLOSE_OUT_STATUS.NOT_READY,
    pr,
    ready: false,
    pressable: false,
    setDone: false,
    readyCopy: null,
    message: BLIND_READ_MISSING_COPY,
    setupCopy: SETUP_COPY,
    reason: 'blind-read-missing',
    refuses: 'blind-read-missing',
  };
}

/**
 * The close-out box model (LIN-3248), built from `closeOutDecision`. Pure. The renderers read this
 * shape (`status`, `reason`, `setDone`, `pr`, `ready`, `pressable`, the copies).
 *
 * @param {Object} input
 * @param {Array<{url: string, corroborated?: boolean}>} [input.prs] - the landing's PR refs, for their
 *   `corroborated` marks; the PRs read are the landing (`landingPrs`).
 * @param {Map<string, Object>} [input.prStatuses] - reader results keyed by PR URL.
 * @param {string[]} input.landingPrs - REQUIRED: the current landing's PR URLs (the trail's `landing`).
 * @param {Object|null} [input.review] - the latest review model (the trail's `review`).
 * @param {boolean} [input.runnerReady]
 * @param {boolean} [input.owner] - the viewer owns the task (guests get no box).
 * @param {('pr'|null)} [input.stopAt]
 * @param {('standard'|'stepper'|'unknown'|null)} [input.variant] - fail closed: missing is not standard.
 * @param {('person'|'harbour')} [input.actor] - who reads the box; only `setDone` depends on it.
 * @param {Object} input.openFindings - REQUIRED: the open-findings reading (lib/close-out-findings.js).
 * @returns {Object} the box model
 */
export function deriveCloseOutState({
  prs = [],
  prStatuses = null,
  landingPrs,
  review = null,
  runnerReady = false,
  owner = false,
  stopAt = null,
  variant = null,
  actor = CLOSE_OUT_ACTOR.HARBOUR,
  openFindings,
} = {}) {
  if (!Array.isArray(landingPrs)) throw new TypeError('deriveCloseOutState: landingPrs (the trail\'s landing) is required');
  const decision = closeOutDecision({ trail: { review, landing: landingPrs }, prStatuses, stopAt, runnerReady, actor, openFindings });
  const corroborated = new Map((Array.isArray(prs) ? prs : []).map(p => [p.url, !!p.corroborated]));
  const withMark = (entry) => (entry ? { ...entry, corroborated: corroborated.get(entry.url) ?? false } : null);
  const entries = decision.entries.map(withMark);
  const approved = isApprovedReview(review);
  const ready = decision.status === CLOSE_OUT_STATUS.READY;
  const quiet = [CLOSE_OUT_STATUS.NO_PR, CLOSE_OUT_STATUS.MERGED, CLOSE_OUT_STATUS.PARTIAL, CLOSE_OUT_STATUS.READY];

  return {
    owner: !!owner,
    prs: entries,
    openCount: entries.filter(e => e.open).length,
    mergedCount: entries.filter(e => e.merged).length,
    unknownCount: entries.filter(e => !e.readable).length,
    headMoved: decision.headMoved,
    stopAt: stopAt || null,
    variant: variant === 'stepper' ? 'stepper' : (variant === 'standard' ? 'standard' : 'unknown'),
    status: decision.status,
    pr: withMark(decision.pr),
    message: decision.message,
    reason: decision.reason,
    ready,
    pressable: ready && !!owner,
    readyCopy: ready ? READY_COPY : null,
    setupCopy: quiet.includes(decision.status) ? null : SETUP_COPY,
    setDone: decision.setDone,
    refuses: decision.refuses,
    waitsOn: decision.waitsOn,
    followsPerson: decision.followsPerson,
    review: { verdict: review && review.verdict ? review.verdict : null, approved },
    // LIN-4495: the open findings to close-out, as read. `openFindings` is null when it is not measured, never 0.
    openFindings: openFindings || null,
    openFindingsCount: findingsCount(openFindings),
  };
}
