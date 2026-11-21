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
 * Not here (later P5 beats): plan-review loop facts, the approval's open findings, look-first, and the routing and
 * close-out decision that consume this value.
 */
import { index, viewOf } from './views.js';
import { changeKeyOf } from './change-ref.js';
import { landingOf, roundCutOf } from './landing.js';
import { splitRef } from './check.js';

const REVIEW = 'review';
const BLIND_READ = 'blind-read';
const CLOSE_OUT = 'close-out';

/**
 * The standing of a task, read from the store.
 * @param {Object} deps
 * @param {import('../records-store.js').RecordsStore} deps.recordsStore
 * @param {string} deps.urlKey
 * @param {string} deps.taskId
 */
export async function readStandingRecords({ recordsStore, urlKey, taskId }) {
  const scoped = [];
  for (const kind of ['change', 'verdict', 'run']) {
    scoped.push(...await recordsStore.find(urlKey, { kind, inRef: taskId }));
  }
  const ids = [...new Set(scoped.map((s) => s.id))];
  // The verdicts' own versions are needed for the stale check, so read every version of the ids in scope.
  const versions = ids.length ? await recordsStore.versionsOf(urlKey, ids) : [];
  return standingOf({ taskId, versions });
}

/**
 * The standing of task `taskId`, from the versions of its records.
 * @param {Object} input
 * @param {string} input.taskId
 * @param {object[]} input.versions - every version of the task's changes, verdicts and runs; other kinds are ignored
 * @returns {{
 *   review: null | {id: string, outcome: string|null, at: string, on: string[], stale: boolean, staleBy: string[]},
 *   blindRead: null | {id: string, outcome: string|null, at: string},
 *   landing: string[],
 *   workAfterReview: boolean,
 *   reviewStale: boolean,
 *   closeOutAfterReview: boolean,
 * }}
 */
export function standingOf({ taskId, versions }) {
  const idx = index(versions);
  const current = idx.all();
  const { firstAt, endAt } = timesOfVersions(versions);

  const changes = current.filter((s) => s.kind === 'change' && s.in === taskId);
  const changeIds = new Set(changes.map((c) => c.id));
  const verdicts = current.filter((s) => s.kind === 'verdict'
    && (s.in === taskId || (s.links?.on || []).some((ref) => changeIds.has(splitRef(ref).id))));
  const runs = current.filter((s) => s.kind === 'run' && s.in === taskId);

  const judged = (judgement) => verdicts
    .filter((v) => v.fields?.judgement === judgement && firstAt.has(v.id))
    .sort((a, b) => firstAt.get(a.id).localeCompare(firstAt.get(b.id)));
  const reviews = judged(REVIEW);
  const review = reviews.at(-1) ?? null;
  const reviewAt = review ? firstAt.get(review.id) : null;

  const staleBy = review ? (viewOf(review, idx).flags?.stale ?? []) : [];
  const reviewStale = staleBy.length > 0;

  const blindRead = judged(BLIND_READ).filter((b) => reviewAt === null || firstAt.get(b.id) > reviewAt).at(-1) ?? null;

  const closeOuts = runs
    .filter((r) => r.fields?.stage === CLOSE_OUT && r.state === 'done')
    .map((r) => ({ id: r.id, at: endAt.get(r.id) ?? r.at }));
  const cutAt = roundCutOf({ reviewAts: reviews.map((v) => firstAt.get(v.id)), closeOutEnds: closeOuts.map((c) => c.at) });

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
    } : null,
    blindRead: blindRead ? { id: blindRead.id, outcome: blindRead.fields?.outcome ?? null, at: firstAt.get(blindRead.id) } : null,
    landing,
    workAfterReview: reviewStale || newChangeAfterReview,
    reviewStale,
    closeOutAfterReview,
  };
}

/** A verdict's `on` ref as the record stores it: the change id, with its pinned version when one is named. */
function canonicalOn(ref) {
  const { id, v } = splitRef(ref);
  return v === undefined ? id : `${id}@${v}`;
}

/** First-write and end instants by record id, from raw versions (the same reading as landing.js). */
function timesOfVersions(versions) {
  const firstAt = new Map();
  const endAt = new Map();
  for (const v of versions) {
    const seen = firstAt.get(v.id);
    if (seen === undefined || v.at < seen) firstAt.set(v.id, v.at);
    if (v.op === 'end') {
      const ended = endAt.get(v.id);
      if (ended === undefined || v.at < ended) endAt.set(v.id, v.at);
    }
  }
  return { firstAt, endAt };
}
