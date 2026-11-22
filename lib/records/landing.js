/**
 * LIN-4516 (plan-4761b4db note 3): the ONE landing function. A task's landing is the set of PRs the next review and
 * the next blind read must judge, and that close-out must see merged: the task's open changes, plus those ended `merged`
 * in the current round. It is read here, and only here. The blind-read rule (lib/change-records.js blindReadSetProblems)
 * and P5's closeOutWaitsOn both take it, so the two cannot disagree about which PRs are the landing.
 *
 * The round is cut at the end of the latest close-out run that ended before the latest review verdict (`roundCutOf`). This
 * is the record-side form of the comment path's anchor, "the latest close-out before the latest review" (lib/run-trail.js,
 * LIN-4396). A close-out after the latest review is an attempt on the same landing, so it does not move the cut. A change
 * merged at the cut was merged by the close-out the cut closes, so only a merge strictly after the cut is in the next round.
 * With no review, or no close-out before one, there is no cut and every merged change of the task counts.
 *
 * Open changes are in whatever the round: a PR a close-out left open is still a PR the next review must judge. The comment
 * path's landing is the PRs cited after its anchor; the two differ there, and the golden replay
 * (tests/unit/lin-4516-landing-replay.test.js) names each difference.
 *
 * `roundOf` is the one assembly of a round's inputs (LIN-4518, finding 398df7e5): the close-out ends, the review instants
 * and the changes' merge instants, each read from the records' write versions. readLanding (the store) and standingOf
 * (lib/records/standing.js, from snapshots) both call it, so the two cannot take the round cut from different instants.
 *
 * Pure over snapshots, except readLanding, which takes the records store as an argument, so this leaf imports only
 * ./change-ref.js and ./words.js. Callers key statuses by the URL this returns; repositories compare case-blind (changeKeyOf, LIN-4439).
 */
import { canonicalChangeRef, changeKeyOf } from './change-ref.js';
import { REVIEW_JUDGEMENT, CLOSE_OUT_STAGE } from './words.js';

/** The latest of some ISO instants, or null for none. */
const latestOf = (instants) => instants.reduce((a, b) => (a === null || b > a ? b : a), null);

/**
 * The round's cut: the end of the latest close-out run that ended before the latest review verdict.
 * @param {{reviewAts: string[], closeOutEnds: string[]}} times - the first write of each review verdict, and each ended
 *   close-out run's end, as ISO instants
 * @returns {string|null} the cut, or null when there is no review or no close-out before one (the round is the whole trail)
 */
export function roundCutOf({ reviewAts, closeOutEnds }) {
  const lastReview = latestOf(reviewAts);
  if (lastReview === null) return null;
  return latestOf(closeOutEnds.filter((at) => at < lastReview));
}

/**
 * The landing of a task, from its changes (pure).
 * @param {{ref: string, state: string, createdAt: string, mergedAt?: string|null}[]} changes - each change's ref (its PR
 *   URL), its state (open, merged or abandoned), when it was first written, and when it merged
 * @param {string|null} cutAt - roundCutOf's cut
 * @returns {string[]} the landing's PR URLs, oldest first (closeOutDecision reads the order); one per repository and number
 */
export function landingOf({ changes, cutAt }) {
  const byKey = new Map();
  for (const c of changes) {
    const url = canonicalChangeRef(c.ref);
    const key = changeKeyOf(c.ref);
    if (!url || !key) continue;
    const inRound = c.state === 'open'
      || (c.state === 'merged' && (cutAt === null || (c.mergedAt != null && c.mergedAt > cutAt)));
    if (!inRound) continue;
    const seen = byKey.get(key);
    if (!seen || c.createdAt < seen.createdAt) byKey.set(key, { url, createdAt: c.createdAt });
  }
  return [...byKey.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .map((x) => x.url);
}

/**
 * When each record came to be (its first write), when it ended (its `end` version) and which run wrote its first version,
 * by record id, from raw versions. The one reading of the write times: the landing and the standing both take it here.
 * @param {object[]} versions - every version of the records in question (`recordsStore.versionsOf` output)
 * @param {string} [asOf] - an ISO instant: versions written after it are not read
 * @returns {{firstAt: Map<string, string>, endAt: Map<string, string>, firstRun: Map<string, string|null>}}
 */
export function writeTimesOfVersions(versions, asOf = undefined) {
  const firstAt = new Map();
  const endAt = new Map();
  const firstRun = new Map();
  for (const v of versions) {
    if (asOf !== undefined && v.at > asOf) continue;
    const seen = firstAt.get(v.id);
    if (seen === undefined || v.at < seen) { firstAt.set(v.id, v.at); firstRun.set(v.id, v.run ?? null); }
    if (v.op === 'end') {
      const ended = endAt.get(v.id);
      if (ended === undefined || v.at < ended) endAt.set(v.id, v.at);
    }
  }
  return { firstAt, endAt, firstRun };
}

/**
 * The round of a task, assembled from its current records and their write times (pure). Both readers call it, so the
 * close-out ends, the review instants and the merge instants come from one place.
 * @param {Object} input
 * @param {object[]} input.changes - the task's current change snapshots
 * @param {object[]} input.runs - the task's current run snapshots (close-out runs are read here)
 * @param {object[]} input.verdicts - the task's current verdict snapshots (review verdicts are read here)
 * @param {{firstAt: Map<string,string>, endAt: Map<string,string>}} input.times - writeTimesOfVersions' output
 * @param {{review: string, closeOut: string}} input.words - the records words the round reads: the review judgement and
 *   the close-out stage (lib/records/words.js; standingOf passes its judgements.review, which is the same word)
 * @returns {{cutAt: string|null, closeOuts: {id: string, at: string}[], landing: string[]}} the cut; the ended close-out
 *   runs with their end instants (`at`, the end, never a later version's); and the landing (landingOf)
 */
export function roundOf({ changes, runs, verdicts, times, words }) {
  const { firstAt, endAt } = times;
  const closeOuts = runs
    .filter((r) => r.fields?.stage === words.closeOut && r.state === 'done')
    .map((r) => ({ id: r.id, at: endAt.get(r.id) ?? r.at }));
  const reviewAts = verdicts
    .filter((v) => v.fields?.judgement === words.review && firstAt.has(v.id))
    .map((v) => firstAt.get(v.id));
  const cutAt = roundCutOf({ reviewAts, closeOutEnds: closeOuts.map((c) => c.at) });
  const landing = landingOf({
    changes: changes.map((c) => ({
      ref: c.fields?.ref,
      state: c.state,
      createdAt: firstAt.get(c.id),
      // The end's instant, never the current version's: a merged change can still take a link or a revise later, and that
      // must not move its merge past the round cut (LIN-4516 close-out, blind-read finding 9a6a5703).
      mergedAt: c.state === 'merged' ? (endAt.get(c.id) ?? c.at) : null,
    })),
    cutAt,
  });
  return { cutAt, closeOuts, landing };
}

/**
 * The landing of a task as the store holds it, optionally as of an instant. The one reader.
 * @param {Object} deps
 * @param {import('../records-store.js').RecordsStore} deps.recordsStore - passed in: this leaf imports no store
 * @param {string} deps.urlKey - the workspace
 * @param {string} deps.taskId - the task whose landing it is
 * @param {string} [deps.asOf] - an ISO instant: the store as it stood then (the golden replay reads each instant so)
 * @returns {Promise<string[]>} the landing's PR URLs, oldest first
 */
export async function readLanding({ recordsStore, urlKey, taskId, asOf = undefined }) {
  const changes = await recordsStore.find(urlKey, { kind: 'change', inRef: taskId, asOf });
  const runs = await recordsStore.find(urlKey, { kind: 'run', inRef: taskId, asOf });
  const verdicts = await recordsStore.find(urlKey, { kind: 'verdict', inRef: taskId, asOf });
  // Every record the round reads needs its versions: a close-out run's end instant is one of them (roundOf).
  const ids = [...new Set([...changes, ...runs, ...verdicts].map((s) => s.id))];
  const versions = ids.length ? await recordsStore.versionsOf(urlKey, ids) : [];
  const times = writeTimesOfVersions(versions, asOf);
  return roundOf({ changes, runs, verdicts, times, words: { review: REVIEW_JUDGEMENT, closeOut: CLOSE_OUT_STAGE } }).landing;
}
