/**
 * LIN-4518 (P5 of LIN-4513, plan-f77d6aea item 1): the record-side standing of a task. It answers, from records alone
 * (the comment trail it replaced was retired by LIN-4520): the review on record and whether a later
 * push has made it stale, the blind read after it, the landing, whether work came after the review, and whether
 * close-out ran after it.
 *
 * Pure over version snapshots (`recordsStore.versionsOf` output), so the caller decides the instant. The gating readers
 * refresh heads first (lib/change-records.js refreshTaskChanges); nothing here writes, and nothing reads a comment.
 *
 * The stale flag is the views' own (lib/records/views.js): a verdict whose `on` version is no longer the target's
 * current fields. A merge ends a change without changing its fields, so it does not make an approval stale; an
 * abandoned change does (staleEnds).
 *
 * Work after review, as plan-f77d6aea states it: the latest review is stale, or a change first written after the review
 * whose PR the review did not hold. Re-stating the reviewed PR is not new work; a new PR is.
 *
 * The stale flag names the PRs it stales (`review.staleUrls`): the change behind each stale `on` link. closeOutDecision
 * (lib/run-closeout-state.js headMovedFor) refuses on a PR that list names, and compares each landing PR with its own
 * judged head (`heads`); `trailOfStanding` carries a single `sha` only for a one-PR review.
 *
 * Not here: plan-review loop facts (lib/records/plan-facts.js), the approval's open findings (lib/close-out-findings.js),
 * look-first and the run evidence box, which read their own inputs.
 */
import { index, staleRefsOf } from './views.js';
import { canonicalChangeRef, changeKeyOf } from './change-ref.js';
import { roundOf, writeTimesOfVersions } from './landing.js';
import { CLOSE_OUT_STAGE, AUDIT_STAGE } from './words.js';
import { splitRef } from './check.js';

/**
 * The standing of a task, read from the store.
 * @param {Object} deps
 * @param {import('../records-store.js').RecordsStore} deps.recordsStore
 * @param {string} deps.urlKey
 * @param {string} deps.taskId
 * @param {{review: string, blindRead: string}} deps.judgements - the verdict judgement words. The caller passes them:
 *   this leaf imports only Platform (lib/records/), so the blind read's word lives in lib/prompts/blind-read-words.js.
 */
export async function readStandingRecords({ recordsStore, urlKey, taskId, judgements }) {
  const scoped = [];
  for (const kind of ['change', 'verdict', 'run']) {
    scoped.push(...await recordsStore.find(urlKey, { kind, inRef: taskId }));
  }
  const ids = [...new Set(scoped.map((s) => s.id))];
  // The verdicts' own versions are needed for the stale check, so read every version of the ids in scope.
  const versions = ids.length ? await recordsStore.versionsOf(urlKey, ids) : [];
  return standingOf({ taskId, versions, judgements });
}

/**
 * The standing of task `taskId`, from the versions of its records.
 * @param {Object} input
 * @param {string} input.taskId
 * @param {object[]} input.versions - every version of the task's changes, verdicts and runs; other kinds are ignored
 * @param {{review: string, blindRead: string}} input.judgements - the judgement words of the review and the blind read
 * @returns {{
 *   review: null | {id, outcome, at, on: string[], sha: string|null, heads: Object<string, string>, stale: boolean,
 *     staleBy: string[], staleUrls: string[], movedUrls: string[]} - `heads` is the head each PR's pinned version holds, by
 *     PR URL; `movedUrls` is the stale PRs whose change is still open (LIN-4521's re-review); `sha` is
 *     the head only when the review judged one PR (null otherwise, so no single head is compared across a landing),
 *   blindRead: null | {id, outcome, at, prs: string[]},
 *   landing: string[],
 *   workAfterReview: boolean,
 *   reviewStale: boolean,
 *   closeOutAfterReview: boolean,
 *   closeOutOnTrail: boolean,
 *   landingHasNotesPr: boolean,
 *   notesPrs: string[],
 *   auditAfterCloseOut: boolean,
 * }}
 */
export function standingOf({ taskId, versions, judgements }) {
  if (!judgements?.review || !judgements?.blindRead) throw new Error('standingOf needs judgements: { review, blindRead }');
  const idx = index(versions);
  const current = idx.all();
  const times = writeTimesOfVersions(versions);
  const { firstAt, firstRun } = times;

  // The task's own records only: readStandingRecords fetches by `in`, so a verdict is on the task by its `in` (its `on`
  // links name the change it judges, and are read for staleness, not for membership).
  const changes = current.filter((s) => s.kind === 'change' && s.in === taskId);
  const verdicts = current.filter((s) => s.kind === 'verdict' && s.in === taskId);
  const runs = current.filter((s) => s.kind === 'run' && s.in === taskId);

  const judged = (judgement) => verdicts
    .filter((v) => v.fields?.judgement === judgement && firstAt.has(v.id))
    .sort((a, b) => firstAt.get(a.id).localeCompare(firstAt.get(b.id)));
  const reviews = judged(judgements.review);
  const review = reviews.at(-1) ?? null;
  const reviewAt = review ? firstAt.get(review.id) : null;

  const staleLinks = review ? staleRefsOf(review, idx) : [];
  const staleBy = staleLinks.map((x) => x.reason);
  const staleUrls = [...new Set(staleLinks.map((x) => changeUrlOf(x.target)).filter(Boolean))];
  // LIN-4521: the stale PRs whose change is still open: what a re-review can judge before a merge. A PR merged after an
  // unreviewed push is stale (the merge revises its head) but not moved, and an abandoned one is neither re-judged.
  const movedUrls = [...new Set(staleLinks.filter((x) => x.target?.state === 'open').map((x) => changeUrlOf(x.target)).filter(Boolean))];
  const reviewStale = staleBy.length > 0;

  const blindRead = judged(judgements.blindRead).filter((b) => reviewAt === null || firstAt.get(b.id) > reviewAt).at(-1) ?? null;
  // The PRs the blind read names: the change behind each `on` link (the exact landing rule, lib/records/landing.js).
  const blindReadPrs = blindRead ? onUrlsOf(blindRead, idx) : [];

  // The round (cut, close-outs, landing) is landing.js's one assembly, the same one readLanding runs (LIN-4518, 398df7e5).
  const { cutAt, closeOuts, landing } = roundOf({
    changes, runs, verdicts, times, words: { review: judgements.review, closeOut: CLOSE_OUT_STAGE },
  });
  // A close-out on this landing: one ended after the round's cut (the latest close-out before the latest review), or any
  // when there is no cut.
  const closeOutOnTrail = closeOuts.some((c) => cutAt === null || c.at > cutAt);

  // A change whose first version an audit run wrote is the audit's notes PR (LIN-4432). Matched by that run, not by who
  // wrote the version: the backstop writes an audit's change under Harbour (lib/change-records.js), so its author is not the audit.
  const auditRuns = runs.filter((r) => r.fields?.stage === AUDIT_STAGE);
  const auditRunIds = new Set(auditRuns.map((r) => r.id));
  const notesChanges = changes.filter((c) => auditRunIds.has(firstRun.get(c.id)));
  const notesPrs = [...new Set(notesChanges.map((c) => changeUrlOf(c)).filter(Boolean))];
  // LIN-4432 on records (`auditAfterCloseOut`): a notes PR's own close-out comes after the audit that wrote it, so it is not
  // the landing's close-out. An audit that started after the landing's close-out means an audit already ran on it.
  // LIN-4520 (fixer finding, lin-4432 reopened ticket): a close-out run carries no PR, so the comment path's "a close-out that
  // cites a notes PR" becomes "the close-out that ended after a notes PR merged": the first close-out run ending at or after
  // each merged notes change's merge is that PR's own close-out, and never the landing's. The landing's close-out is the
  // latest of the rest.
  // Each notes change is anchored at the later of its first write and its merge (when it is merged): its own close-out ends
  // after both.
  const notesAnchors = notesChanges.map((c) => [firstAt.get(c.id), c.state === 'merged' ? (times.endAt.get(c.id) ?? c.at) : null]
    .filter(Boolean).sort().at(-1)).filter(Boolean);
  const notesOwnCloseOuts = new Set(notesAnchors.map((m) => closeOuts.filter((c) => c.at >= m).map((c) => c.at).sort()[0]).filter(Boolean));
  const landingCloseOutAt = latestOf(closeOuts.map((c) => c.at).filter((at) => !notesOwnCloseOuts.has(at)));
  const auditAfterCloseOut = landingCloseOutAt !== null
    && auditRuns.some((r) => (firstAt.get(r.id) ?? '') > landingCloseOutAt);

  let newChangeAfterReview = false;
  let closeOutAfterReview = false;
  if (reviewAt !== null) {
    const reviewedKeys = new Set(changes
      .filter((c) => firstAt.get(c.id) <= reviewAt)
      .map((c) => changeKeyOf(c.fields?.ref))
      .filter(Boolean));
    newChangeAfterReview = changes.some((c) => firstAt.get(c.id) > reviewAt && !reviewedKeys.has(changeKeyOf(c.fields?.ref)));
    closeOutAfterReview = closeOuts.some((c) => c.at > reviewAt);
  }

  // The head each PR the review judged held: the head its pinned change version holds (LIN-4518, the box's commit).
  const judgedPrs = review ? (review.links?.on ?? []).flatMap((ref) => {
    const { id, v } = splitRef(ref);
    const snap = v === undefined ? null : idx.versionOf(id, v);
    const url = changeUrlOf(snap);
    return url && snap.fields?.head ? [{ url, sha: snap.fields.head }] : [];
  }) : [];
  const judgedHeads = Object.fromEntries(judgedPrs.map((j) => [j.url, j.sha]));
  // One head is the review's only when it judged one PR; a landing of two PRs has no single head to compare.
  const judgedSha = judgedPrs.length === 1 ? judgedPrs[0].sha : null;

  return {
    review: review ? {
      id: review.id,
      outcome: review.fields?.outcome ?? null,
      at: reviewAt,
      on: (review.links?.on ?? []).map(canonicalOn),
      sha: judgedSha,
      heads: judgedHeads,
      stale: reviewStale,
      staleBy,
      staleUrls,
      movedUrls,
    } : null,
    blindRead: blindRead ? {
      id: blindRead.id,
      outcome: blindRead.fields?.outcome ?? null,
      at: firstAt.get(blindRead.id),
      prs: blindReadPrs,
    } : null,
    landing,
    landingHasNotesPr: landing.some((url) => notesPrs.includes(url)),
    notesPrs,
    auditAfterCloseOut,
    workAfterReview: reviewStale || newChangeAfterReview,
    reviewStale,
    closeOutAfterReview,
    closeOutOnTrail,
  };
}

/**
 * The trail closeOutDecision reads, shaped from a standing (lib/run-closeout-state.js): the review (its approval word,
 * its blind read's PRs, its judged heads and its stale PRs), the landing and the work and close-out facts. Pure. This is
 * the one trail closeOutDecision reads (LIN-4520 retired the comment trail); the landing PRs are full URLs, oldest first.
 *
 * The trail carries `auditAfterCloseOut` (LIN-4432).
 *
 * closeOutDecision (lib/run-closeout-state.js) judges each PR of a landing against its own entry in `heads` and against
 * `staleUrls`, so a multi-PR landing is compared PR by PR. `sha` is set only for a one-PR review (see standingOf), and
 * closeOutDecision reads it only when a review carries no `heads`, so it is never compared across a landing.
 * @param {ReturnType<typeof standingOf>} standing
 */
export function trailOfStanding(standing) {
  const review = standing.review ? {
    // A records `approve` is an approval; its conditions are open findings to close-out, not another verdict.
    verdict: standing.review.outcome,
    at: standing.review.at,
    sha: standing.review.sha,
    heads: standing.review.heads,
    commentId: standing.review.id,
    blindRead: standing.blindRead ? { prs: standing.blindRead.prs, verdict: standing.blindRead.outcome, at: standing.blindRead.at, commentId: standing.blindRead.id } : null,
    staleUrls: standing.review.staleUrls,
    movedUrls: standing.review.movedUrls,
  } : null;
  return {
    review,
    landing: standing.landing,
    workAfterReview: standing.workAfterReview,
    closeOutAfterReview: standing.closeOutAfterReview,
    closeOutOnTrail: standing.closeOutOnTrail,
    landingHasNotesPr: standing.landingHasNotesPr,
    notesPrs: standing.notesPrs,
    auditAfterCloseOut: standing.auditAfterCloseOut,
  };
}

/** The latest of some ISO instants, or null for none. */
const latestOf = (instants) => instants.reduce((a, b) => (a === null || b > a ? b : a), null);

/** The bare PR URL of a change record (its `ref`), or null. */
function changeUrlOf(snap) {
  return snap?.kind === 'change' ? canonicalChangeRef(snap.fields?.ref) : null;
}

/** The PR URLs a verdict's `on` links name: each change behind a link, at the version the link pins (or current). */
function onUrlsOf(verdict, idx) {
  const urls = [];
  for (const ref of verdict.links?.on ?? []) {
    const { id, v } = splitRef(ref);
    const snap = v === undefined ? idx.at(id) : idx.versionOf(id, v);
    const url = changeUrlOf(snap ?? idx.at(id));
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** A verdict's `on` ref as the record stores it: the change id, with its pinned version when one is named. */
function canonicalOn(ref) {
  const { id, v } = splitRef(ref);
  return v === undefined ? id : `${id}@${v}`;
}
