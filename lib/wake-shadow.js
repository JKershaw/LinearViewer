/**
 * lib/wake-shadow.js
 *
 * The SHADOW half of menu M1 (LIN-3257): the record of what the wake-shadow
 * classifier *would* skip, written at the wake-minting seam
 * (`addFeedback`/`_mintWake` in lib/dispatch-store.js) but never read by
 * delivery. No wake is suppressed — this module exists to prove, over real
 * traffic, that suppressing repeat "still waiting" relays would be safe.
 *
 * The pure classification rule lives in lib/dispatch-wake.js (`classifyWake`,
 * `wakeFingerprint`); this module owns the STORAGE only. One additive, optional
 * collection (`wake_shadow`, constructor option `wakeShadowCollection` on
 * DispatchQueueStore, wired in server.js) holds three document kinds:
 *
 *   - verdict  `_id: wake:<wakeRowId>`
 *       `{ urlKey, wakeRowId, edgeId, producingItemId, marker, wouldSkip,
 *          reason, day, at }` — one per minted wake.
 *   - tally    `_id: tally:<urlKey>:<YYYY-MM-DD UTC>`
 *       `{ urlKey, day, minted, wouldSkip, byReason }`, updated by `$inc`
 *       upsert so the per-day counters are race-safe.
 *   - prior    `_id: edge:<urlKey>:<edgeDocId>`
 *       `{ urlKey, edgeId, marker, refs, text, at }` — the last wake minted on
 *       this one-child-to-one-parent edge, read back to decide whether the next
 *       pause is a repeat. Recorded on EVERY minted wake (terminal/blocked
 *       included), so an intervening terminal resets the repeat state and the
 *       next pause reads `first-pause`.
 *
 * Failure isolation: every function here is best-effort at the caller
 * (`addFeedback` wraps the whole call in its own try/catch and only logs), so a
 * shadow write failure can never affect delivery or the `addFeedback` result.
 * The collection is optional: an absent `wakeShadowCollection` is a no-op.
 *
 * Known, accepted residual (documented, not fixed): two simultaneous wakes on
 * one edge can mislabel one shadow verdict because read-prior/write-prior is
 * not atomic. That is acceptable for a shadow whose only job is an approximate
 * tally.
 */
import { classifyWake, wakeFingerprint } from './dispatch-wake.js';

export const WAKE_SHADOW_COLLECTION = 'wake_shadow';
export const WAKE_SHADOW_DEFAULT_DAYS = 7;
export const WAKE_SHADOW_MAX_DAYS = 31;

/**
 * The UTC day bucket (YYYY-MM-DD) a timestamp belongs to. UTC on purpose: the
 * tally is a coarse per-day count and must not drift with the server's local
 * zone or DST.
 *
 * @param {Date|number|string} [date]
 * @returns {string}
 */
export function wakeShadowDay(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function wakeShadowVerdictId(wakeRowId) {
  return `wake:${wakeRowId}`;
}

export function wakeShadowTallyId(urlKey, day) {
  return `tally:${urlKey}:${day}`;
}

export function wakeShadowPriorId(urlKey, edgeId) {
  return `edge:${urlKey}:${edgeId}`;
}

/**
 * Read the prior fingerprint recorded for an edge, or null. Never throws to the
 * caller in a way that would matter (the caller catches), but keeps a read
 * error distinguishable from a real "no prior" miss by rethrowing — the caller
 * treats both as "no prior" only if it chooses to.
 *
 * @param {Object|null} collection
 * @param {string} urlKey
 * @param {string|null} edgeId
 * @returns {Promise<{marker: string, refs: string[], text: string, at: any}|null>}
 */
export async function readWakePrior(collection, urlKey, edgeId) {
  if (!collection || !urlKey || !edgeId) return null;
  const doc = await collection.findOne({ _id: wakeShadowPriorId(urlKey, edgeId) });
  if (!doc) return null;
  return {
    marker: doc.marker || null,
    refs: Array.isArray(doc.refs) ? doc.refs : [],
    text: typeof doc.text === 'string' ? doc.text : '',
    at: doc.at || null
  };
}

/**
 * Record one minted wake: classify it against the edge's prior fingerprint,
 * write the verdict, bump the per-day tally, then update the edge's prior to
 * this wake. Returns the verdict (`{ wouldSkip, reason }`) or null when the
 * collection is absent.
 *
 * @param {Object|null} collection - the `wake_shadow` collection (optional)
 * @param {Object} args
 * @param {string} args.urlKey
 * @param {string} args.wakeRowId - the minted `kind:'wake'` dispatch row id
 * @param {string|null} [args.edgeId] - the edge-bearing root doc id
 * @param {string|null} [args.producingItemId] - the feedback-receiving item id
 * @param {string} args.marker - the wake marker
 * @param {boolean} [args.personOriginated=false]
 * @param {string} [args.message=''] - the wake feedback line
 * @param {Date} [args.now=new Date()]
 * @returns {Promise<{wouldSkip: boolean, reason: string}|null>}
 */
export async function recordWakeShadow(collection, {
  urlKey,
  wakeRowId,
  edgeId = null,
  producingItemId = null,
  marker,
  personOriginated = false,
  message = '',
  now = new Date()
} = {}) {
  if (!collection || !urlKey || !wakeRowId) return null;

  const prior = await readWakePrior(collection, urlKey, edgeId);
  const verdict = classifyWake({ marker, personOriginated, message, prior });
  const day = wakeShadowDay(now);
  const { refs, text } = wakeFingerprint(message);

  await collection.updateOne(
    { _id: wakeShadowVerdictId(wakeRowId) },
    {
      $set: {
        kind: 'verdict',
        urlKey,
        wakeRowId,
        edgeId: edgeId || null,
        producingItemId: producingItemId || null,
        marker,
        wouldSkip: verdict.wouldSkip,
        reason: verdict.reason,
        day,
        at: now
      }
    },
    { upsert: true }
  );

  await collection.updateOne(
    { _id: wakeShadowTallyId(urlKey, day) },
    {
      $set: { kind: 'tally', urlKey, day },
      $inc: {
        minted: 1,
        wouldSkip: verdict.wouldSkip ? 1 : 0,
        [`byReason.${verdict.reason}`]: 1
      }
    },
    { upsert: true }
  );

  if (edgeId) {
    await collection.updateOne(
      { _id: wakeShadowPriorId(urlKey, edgeId) },
      { $set: { kind: 'prior', urlKey, edgeId, marker, refs, text, at: now } },
      { upsert: true }
    );
  }

  return verdict;
}

const EMPTY_TALLY = () => ({
  days: [],
  totals: { minted: 0, wouldSkip: 0, share: 0, byReason: {} }
});

/**
 * Read the per-day tally over the last `days` UTC days (inclusive of today),
 * newest day last. Returns an empty, well-formed summary when the collection is
 * absent or empty (the no-op degrade). Read-only; never writes.
 *
 * @param {Object|null} collection
 * @param {string} urlKey
 * @param {Object} [options]
 * @param {number} [options.days=7]
 * @param {Date} [options.now=new Date()]
 * @returns {Promise<{days: Array, totals: Object}>}
 */
export async function readWakeShadowTally(collection, urlKey, { days = WAKE_SHADOW_DEFAULT_DAYS, now = new Date() } = {}) {
  const summary = EMPTY_TALLY();
  if (!collection || !urlKey) return summary;

  const clamped = Math.max(1, Math.min(WAKE_SHADOW_MAX_DAYS, Math.floor(Number(days)) || WAKE_SHADOW_DEFAULT_DAYS));
  const toDay = wakeShadowDay(now);
  const fromDay = wakeShadowDay(new Date(new Date(now).getTime() - (clamped - 1) * 86400000));

  const docs = await collection
    .find({ urlKey, kind: 'tally', day: { $gte: fromDay, $lte: toDay } })
    .sort({ day: 1 })
    .toArray();

  const totals = { minted: 0, wouldSkip: 0, byReason: {} };
  for (const doc of docs) {
    const byReason = (doc.byReason && typeof doc.byReason === 'object') ? doc.byReason : {};
    summary.days.push({
      day: doc.day,
      minted: doc.minted || 0,
      wouldSkip: doc.wouldSkip || 0,
      byReason
    });
    totals.minted += doc.minted || 0;
    totals.wouldSkip += doc.wouldSkip || 0;
    for (const [reason, count] of Object.entries(byReason)) {
      totals.byReason[reason] = (totals.byReason[reason] || 0) + (count || 0);
    }
  }
  totals.share = totals.minted > 0 ? totals.wouldSkip / totals.minted : 0;
  summary.totals = totals;
  return summary;
}
