/**
 * One-off operator step for LIN-3618: expire the ownerless dispatch-token rows.
 *
 * Until LIN-3618 nothing set `expiresAt`, so every dispatch token was permanent,
 * and the pre-LIN-1397 rows have no owner (`createdBy` null, absent or ''; the
 * same test as `hasOwner` in lib/dispatch-tokens.js). John ruled on 19 Oct that
 * they may expire. This sets `expiresAt` to now on the ownerless rows that are
 * not already expired, and writes nothing else. Owned rows are never touched
 * (their owner re-mints them and gets the 90-day lifetime), and no row is ever
 * deleted: dispatch-token rows are urlKey holder evidence (LIN-3381/3382).
 *
 * Read-only by default (`dryRun`). Two refusals, both writing nothing:
 * - `recent-use`: an ownerless row was used within the last 30 days, so it may
 *   be a live dispatcher's token. A dispatcher that polls with an expired token
 *   gets a plain 401 and keeps polling (LIN-3695 / LIN-3699), so the fix for a
 *   refusal is to move that workspace to an owned token, then run again.
 * - `mangodb-no-data-dir`: the local file backend was picked without an
 *   explicit HARBOUR_DATA_DIR, which is what an empty MONGODB_URI looks like; a
 *   "success" there would say nothing about production.
 *
 * Reads an inclusion projection only (`_id, urlKey, createdBy, lastUsedAt,
 * expiresAt`): never the token hash, the label or the owning account id, and
 * `createdBy` is printed as yes/no. A repeat run changes nothing.
 */

export const DB_NAME = 'linear-viewer';
export const COLLECTION_NAME = 'dispatch-tokens';
export const RECENT_USE_DAYS = 30;
const RECENT_MS = RECENT_USE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Same test as `hasOwner` in lib/dispatch-tokens.js, kept in step with the write
 * filter below (null, '' and absent are all ownerless).
 */
const isOwnerless = (row) => !row.createdBy;

// MangoDB and real Mongo disagree on `null` vs missing unless both are spelled out.
const OWNERLESS_FILTER = {
  $or: [{ createdBy: null }, { createdBy: '' }, { createdBy: { $exists: false } }]
};
const NOT_EXPIRED_FILTER = (now) => ({
  $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }]
});

const id8 = (row) => String(row._id).slice(0, 8);

function classify(row, nowMs) {
  const expires = row.expiresAt ? new Date(row.expiresAt).getTime() : null;
  const status = expires === null ? 'never' : expires > nowMs ? 'active' : 'expired';
  // Fail closed: a lastUsedAt that does not parse counts as recent.
  let recent = false;
  if (row.lastUsedAt) {
    const used = new Date(row.lastUsedAt).getTime();
    recent = Number.isNaN(used) || nowMs - used < RECENT_MS;
  }
  return { ownerless: isOwnerless(row), status, recent };
}

const iso = (v, none) => {
  if (!v) return none;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? 'invalid' : t.toISOString();
};

/**
 * @param {Object} options
 * @param {Object} options.collection - the `dispatch-tokens` collection.
 * @param {'mongodb'|'mangodb'} options.backend - printed on the first line.
 * @param {boolean} [options.dataDirExplicit=false] - HARBOUR_DATA_DIR was set explicitly.
 * @param {Date} [options.now]
 * @param {boolean} [options.dryRun=true]
 * @param {Object} [options.logger=console]
 * @returns {Promise<{ mode: 'dry-run'|'execute', counts: Object, wouldExpire: string[], expired: string[], refused: (null|'recent-use'|'mangodb-no-data-dir'), recentIds: string[] }>}
 */
export async function expireOwnerlessDispatchTokens({
  collection,
  backend,
  dataDirExplicit = false,
  now = new Date(),
  dryRun = true,
  logger = console
} = {}) {
  const out = (line) => { try { logger.log(line); } catch { /* a throwing logger must not fail the run */ } };
  const nowMs = now.getTime();

  out(`backend=${backend} db=${DB_NAME} collection=${COLLECTION_NAME}`);

  const rows = await collection
    .find({}, { projection: { _id: 1, urlKey: 1, createdBy: 1, lastUsedAt: 1, expiresAt: 1 } })
    .toArray();

  const counts = { total: rows.length, ownerless: 0, ownerlessActive: 0, ownerlessRecent: 0, owned: 0 };
  const targets = [];
  const recentIds = [];
  for (const row of rows) {
    const c = classify(row, nowMs);
    out(
      `urlKey=${row.urlKey} owner=${c.ownerless ? 'no' : 'yes'} lastUsedAt=${iso(row.lastUsedAt, 'never')}` +
      ` expiresAt=${iso(row.expiresAt, 'none')} status=${c.status} recent=${c.recent ? 'yes' : 'no'} id=${id8(row)}`
    );
    if (!c.ownerless) { counts.owned += 1; continue; }
    counts.ownerless += 1;
    if (c.status !== 'expired') { counts.ownerlessActive += 1; targets.push(row); }
    if (c.recent) { counts.ownerlessRecent += 1; recentIds.push(id8(row)); }
  }
  out(
    `total=${counts.total} ownerless=${counts.ownerless} ownerless-active=${counts.ownerlessActive}` +
    ` ownerless-recent=${counts.ownerlessRecent} owned=${counts.owned}`
  );

  const report = {
    mode: dryRun ? 'dry-run' : 'execute',
    counts,
    wouldExpire: targets.map(id8),
    expired: [],
    refused: null,
    recentIds
  };
  if (dryRun) return report;

  if (backend === 'mangodb' && !dataDirExplicit) {
    report.refused = 'mangodb-no-data-dir';
    out('refused: the mangodb backend needs HARBOUR_DATA_DIR set explicitly (is MONGODB_URI empty?). Nothing written.');
    return report;
  }
  if (recentIds.length > 0) {
    report.refused = 'recent-use';
    out(
      `refused: ownerless token(s) used within the last ${RECENT_USE_DAYS} days may be live: ${recentIds.join(' ')}. ` +
      'Nothing written. Move that workspace to an owned token, then run again.'
    );
    return report;
  }

  // Every planned change is printed before the first write.
  for (const row of targets) out(`would expire ${row.urlKey} ${id8(row)}`);
  for (const row of targets) {
    // Re-check ownerless and not-expired in the write itself: a row that gained
    // an owner, or expired, since the listing is skipped (matchedCount 0).
    const result = await collection.updateOne(
      { _id: row._id, $and: [OWNERLESS_FILTER, NOT_EXPIRED_FILTER(now)] },
      { $set: { expiresAt: now } }
    );
    if (result?.matchedCount > 0) {
      report.expired.push(id8(row));
      out(`expired ${row.urlKey} ${id8(row)}`);
    }
  }
  out(`expired=${report.expired.length} of ${targets.length} planned`);
  return report;
}
