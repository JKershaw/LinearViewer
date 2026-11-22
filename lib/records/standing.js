/**
 * LIN-4518 (P5 of LIN-4513, plan-f77d6aea item 1): the record-side standing of a task. It answers, from records alone,
 * what the comment path's `readTrail` (lib/run-trail.js) answers from comments: the review on record and whether a later
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
 * The stale flag names the PRs it stales (`review.staleUrls`): the change behind each stale `on` link. Nothing reads it
 * yet: closeOutDecision (lib/run-closeout-state.js) reads no staleUrls today, and will refuse on a PR that list names
 * once the consumers step makes it read them (LIN-4518 step 3). Its own head check compares one `review.sha` against
 * every landing PR, so `trailOfStanding` carries the judged head per PR (`heads`) and a single `sha` only for a
 * one-PR review; the per-PR comparison belongs to that consumer.
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
 *     staleBy: string[], staleUrls: string[]} - `heads` is the head each PR's pinned version holds, by PR URL; `sha` is
 *     the head only when the review judged one PR (null otherwise, so no single head is compared across a landing),
 *   blindRead: null | {id, outcome, at, prs: string[]},
 *   landing: string[],
 *   workAfterReview: boolean,
 *   reviewStale: boolean,
 *   closeOutAfterReview: boolean,
 *   closeOutOnTrail: boolean,
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
  const reviewStale = staleBy.length > 0;

  const blindRead = judged(judgements.blindRead).filter((b) => reviewAt === null || firstAt.get(b.id) > reviewAt).at(-1) ?? null;
  // The PRs the blind read names: the change behind each `on` link (the exact landing rule, lib/records/landing.js).
  const blindReadPrs = blindRead ? onUrlsOf(blindRead, idx) : [];

  // The round (cut, close-outs, landing) is landing.js's one assembly, the same one readLanding runs (LIN-4518, 398df7e5).
  const { cutAt, closeOuts, landing } = roundOf({
    changes, runs, verdicts, times, words: { review: judgements.review, closeOut: CLOSE_OUT_STAGE },
  });
  // A close-out on this landing: one ended after the round's cut (the latest close-out before the latest review), or any
  // when there is no cut. The comment path's `closeOutOnTrail` on records (lib/run-trail.js readTrail).
  const closeOutOnTrail = closeOuts.some((c) => cutAt === null || c.at > cutAt);

  // An audit's notes PR: a change whose first version an audit run wrote (the comment path's first-cited audit PRs, LIN-4432).
  // A change whose first version an audit run wrote is the audit's notes PR (LIN-4432). Matched by that run, not by who
  // wrote the version: the backstop writes an audit's change under Harbour (lib/change-records.js), so its author is not the audit.
  const auditRunIds = new Set(runs.filter((r) => r.fields?.stage === AUDIT_STAGE).map((r) => r.id));
  const notesPrs = [...new Set(changes
    .filter((c) => auditRunIds.has(firstRun.get(c.id)))
    .map((c) => changeUrlOf(c))
    .filter(Boolean))];

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
    workAfterReview: reviewStale || newChangeAfterReview,
    reviewStale,
    closeOutAfterReview,
    closeOutOnTrail,
  };
}

/**
 * The trail closeOutDecision reads, shaped from a standing (lib/run-closeout-state.js): the review (its approval word,
 * its blind read's PRs, its judged heads and its stale PRs), the landing and the work and close-out facts. Pure. This is
 * the records reading of the fields closeOutDecision reads from `readTrail` (lib/run-trail.js); the landing PRs are the
 * same URLs, in the same order.
 *
 * Not carried yet: `auditAfterCloseOut` (readTrail, lib/run-trail.js), which lib/recommendation-facts.js reads. The
 * consumers step (LIN-4518 step 3) carries it or moves that reader; until then this trail does not answer it.
 *
 * Consumers refuse on `staleUrls` and on each PR's head in `heads`, never on `sha` across a landing: `sha` is set only
 * for a one-PR review (see standingOf). closeOutDecision still compares one `review.sha` against every landing PR, so it
 * must not be handed this trail's `sha` for a multi-PR landing until it compares per PR.
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
  } : null;
  return {
    review,
    landing: standing.landing,
    workAfterReview: standing.workAfterReview,
    closeOutAfterReview: standing.closeOutAfterReview,
    closeOutOnTrail: standing.closeOutOnTrail,
    landingHasNotesPr: standing.landingHasNotesPr,
    notesPrs: standing.notesPrs,
  };
}

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
