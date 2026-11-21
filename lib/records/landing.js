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
 * Pure over snapshots, except readLanding, which takes the records store as an argument, so this leaf imports only
 * ./change-ref.js. Callers key statuses by the URL this returns; repositories compare case-blind (changeKeyOf, LIN-4439).
 */
import { canonicalChangeRef, changeKeyOf } from './change-ref.js';

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
  const { firstAt, endAt } = await writeTimesOf(recordsStore, urlKey, [...changes, ...verdicts].map((s) => s.id), asOf);
  const closeOutEnds = runs.filter((r) => r.fields?.stage === 'close-out' && r.state === 'done').map((r) => r.at);
  const reviewAts = verdicts.filter((v) => v.fields?.judgement === 'review').map((v) => firstAt.get(v.id));
  const cutAt = roundCutOf({ reviewAts, closeOutEnds });
  return landingOf({
    changes: changes.map((c) => ({
      ref: c.fields?.ref,
      state: c.state,
      createdAt: firstAt.get(c.id),
      // The instant of the end, never of the current version: a merged change can still take a link or a revise later, and
      // that must not move its merge past the round cut (LIN-4516 close-out, blind-read finding 9a6a5703).
      mergedAt: c.state === 'merged' ? (endAt.get(c.id) ?? c.at) : null,
    })),
    cutAt,
  });
}

/**
 * When each record came to be (its first write) and when it ended (its `end` version), as of `asOf`.
 * @returns {Promise<{firstAt: Map<string, string>, endAt: Map<string, string>}>}
 */
async function writeTimesOf(recordsStore, urlKey, ids, asOf) {
  const firstAt = new Map();
  const endAt = new Map();
  if (!ids.length) return { firstAt, endAt };
  for (const v of await recordsStore.versionsOf(urlKey, [...new Set(ids)])) {
    if (asOf !== undefined && v.at > asOf) continue;
    const seen = firstAt.get(v.id);
    if (seen === undefined || v.at < seen) firstAt.set(v.id, v.at);
    if (v.op === 'end') {
      const ended = endAt.get(v.id);
      if (ended === undefined || v.at < ended) endAt.set(v.id, v.at);
    }
  }
  return { firstAt, endAt };
}
