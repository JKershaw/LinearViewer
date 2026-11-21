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
 * The stale flag names the PRs it stales (`review.staleUrls`): the change behind each stale `on` link. closeOutDecision
 * (lib/run-closeout-state.js) reads that list in place of the comment path's head comparison (`headMoved`, retired by
 * LIN-4518). `trailOfStanding` shapes this value as the trail the decision reads.
 *
 * Not here (later P5 beats): plan-review loop facts, the approval's open findings, look-first, and the run evidence box.
 */
import { index, viewOf, staleRefsOf } from './views.js';
import { canonicalChangeRef, changeKeyOf } from './change-ref.js';
import { landingOf, roundCutOf } from './landing.js';
import { splitRef } from './check.js';

/** The stage kind a close-out run is filed under: a records word, read here. */
const CLOSE_OUT = 'close-out';
/** The stage kind an audit runs under (lib/prompts/stage-kinds.js). A change it wrote is the audit's notes PR (LIN-4432). */
const AUDIT = 'retrospective-audit';

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
 *   review: null | {id, outcome, at, on: string[], stale: boolean, staleBy: string[], staleUrls: string[]},
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
  const { firstAt, endAt, firstBy } = timesOfVersions(versions);

  const changes = current.filter((s) => s.kind === 'change' && s.in === taskId);
  const changeIds = new Set(changes.map((c) => c.id));
  const verdicts = current.filter((s) => s.kind === 'verdict'
    && (s.in === taskId || (s.links?.on || []).some((ref) => changeIds.has(splitRef(ref).id))));
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
  const closeOuts = runs
    .filter((r) => r.fields?.stage === CLOSE_OUT && r.state === 'done')
    .map((r) => ({ id: r.id, at: endAt.get(r.id) ?? r.at }));

  const cutAt = roundCutOf({ reviewAts: reviews.map((v) => firstAt.get(v.id)), closeOutEnds: closeOuts.map((c) => c.at) });
  // A close-out on this landing: one ended after the round's cut (the latest close-out before the latest review), or any
  // when there is no cut. The comment path's `closeOutOnTrail` on records (lib/run-trail.js readTrail).
  const closeOutOnTrail = closeOuts.some((c) => cutAt === null || c.at > cutAt);

  // An audit's notes PR: a change the audit stage wrote, first (the comment path's first-cited audit PRs, LIN-4432).
  const notesPrs = [...new Set(changes
    .filter((c) => firstBy.get(c.id) === AUDIT)
    .map((c) => changeUrlOf(c))
    .filter(Boolean))];

  const landing = landingOf({
    changes: changes.map((c) => ({
      ref: c.fields?.ref,
      state: c.state,
      createdAt: firstAt.get(c.id),
      // The end's instant, never the current version's (as landing.js reads it).
      mergedAt: c.state === 'merged' ? (endAt.get(c.id) ?? c.at) : null,
    })),
    cutAt,
  });

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

  return {
    review: review ? {
      id: review.id,
      outcome: review.fields?.outcome ?? null,
      at: reviewAt,
      on: (review.links?.on ?? []).map(canonicalOn),
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
 * its blind read's PRs and its stale PRs), the landing and the work and close-out facts. Pure. This is the records
 * reading of what `readTrail` answers from comments; the landing PRs are the same URLs, in the same order.
 * @param {ReturnType<typeof standingOf>} standing
 */
export function trailOfStanding(standing) {
  const review = standing.review ? {
    // A records `approve` is an approval; its conditions are open findings to close-out, not another verdict.
    verdict: standing.review.outcome,
    at: standing.review.at,
    blindRead: standing.blindRead ? { prs: standing.blindRead.prs } : null,
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

/** First-write and end instants, and the writer of the first version, by record id, from raw versions (landing.js's reading). */
function timesOfVersions(versions) {
  const firstAt = new Map();
  const endAt = new Map();
  const firstBy = new Map();
  for (const v of versions) {
    const seen = firstAt.get(v.id);
    if (seen === undefined || v.at < seen) { firstAt.set(v.id, v.at); firstBy.set(v.id, v.by); }
    if (v.op === 'end') {
      const ended = endAt.get(v.id);
      if (ended === undefined || v.at < ended) endAt.set(v.id, v.at);
    }
  }
  return { firstAt, endAt, firstBy };
}
