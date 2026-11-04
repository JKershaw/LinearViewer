/**
 * lib/usage-snapshot-intake.js — the counter for legacy `[usage]` snapshot posts (LIN-4203, LIN-4195 piece 6, D8).
 *
 * The runner stopped posting `kind:'usage'` snapshots in piece 6. An OLD runner still might, so the feedback intake
 * keeps ACCEPTING them (D8: no rejection, no translation) and counts each one here: one document per workspace per
 * UTC day. "No producer posts [usage] snapshots" is then a query on this collection, not a prod-access hunt.
 *
 * Document: _id `${urlKey}:${YYYY-MM-DD}`, { urlKey, day, count, lastAt }. It holds counts only, never a message.
 * Best-effort by contract: the caller awaits this inside its own try/catch, after the feedback write has landed, so a
 * counter fault can never change the feedback result.
 */

export const USAGE_SNAPSHOT_INTAKE_COLLECTION = 'usage-snapshot-intake';

/** The UTC day a post counts under, as YYYY-MM-DD. */
export function usageSnapshotDayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Count one legacy usage-snapshot post. A no-op without a collection or a workspace key, so a store built without the
 * counter behaves exactly as before.
 *
 * @param {{ updateOne: Function }|null} collection
 * @param {{ urlKey: string, now?: number }} args
 */
export async function countUsageSnapshotPost(collection, { urlKey, now = Date.now() } = {}) {
  if (!collection || !urlKey) return;
  const day = usageSnapshotDayKey(now);
  await collection.updateOne(
    { _id: `${urlKey}:${day}` },
    { $inc: { count: 1 }, $set: { urlKey, day, lastAt: new Date(now) } },
    { upsert: true }
  );
}
