/**
 * One-shot removal of the two retired derived caches, `brief-cache` and `recap-cache` (LIN-4537), modelled on
 * lib/drop-task-snapshots-collection.js (LIN-4502).
 *
 * LIN-4537 retired the model-written brief and recap: their generation, the routes that served and regenerated them,
 * the task-page, session, swipe and tree panels and the chat tools that read them, and the two stores. What an agent
 * reads is the records brief (lib/records/run-brief.js). The caches held nothing but a model's summary of a ticket,
 * derived and re-derivable, so nothing is kept or imported. The running app opens neither collection any more and
 * `ensureIndexes` has no drop mechanism, so this module ships the one-off, operator-run cleanup: an operator runs
 * `scripts/drop-brief-recap-caches.mjs` once after deploy.
 *
 * Until that run, account erasure keeps covering both collections (lib/account-erasure.js), with the urlkey census and
 * the dry-run duplicates script: their documents still hold a workspace's ticket summaries, so a Full wipe must take
 * them. The two `_COLLECTION` constants below keep the names in the derived collection universe
 * (tests/helpers/collection-names.js) while the data exists. After the run, those rows and this module go together.
 *
 * Idempotent: dropping an absent collection is a no-op, so a repeat run is safe. `dryRun` defaults to true and only
 * reports whether each collection exists and how many records it holds; the caller must pass `dryRun: false` to drop.
 * One collection failing never stops the other: each is reported on its own.
 */

export const BRIEF_CACHE_COLLECTION = 'brief-cache';
export const RECAP_CACHE_COLLECTION = 'recap-cache';
export const RETIRED_CACHE_COLLECTIONS = Object.freeze([BRIEF_CACHE_COLLECTION, RECAP_CACHE_COLLECTION]);
const PREFIX = '[drop-brief-recap-caches]';

/** The names `listCollections` gives, or null when it cannot be read (existence then reads unknown). */
async function collectionNames(db) {
  try {
    const cursor = db.listCollections();
    const listed = cursor && typeof cursor.toArray === 'function' ? await cursor.toArray() : await cursor;
    return (Array.isArray(listed) ? listed : []).map(entry => (typeof entry === 'string' ? entry : entry?.name));
  } catch {
    return null;
  }
}

async function dropOne(db, collection, names, dryRun) {
  const report = { collection, existed: null, records: null, dropped: false, skipped: null };
  try {
    report.existed = Array.isArray(names) ? names.includes(collection) : null;
    try {
      report.records = await db.collection(collection).countDocuments();
    } catch {
      report.records = null;
    }
    if (dryRun) {
      report.skipped = report.existed === false ? 'absent' : null;
    } else {
      await db.collection(collection).drop();
      report.dropped = true;
    }
  } catch {
    // Never the message: it could carry connection details or document contents.
    report.skipped = 'unexpected-error';
  }
  return report;
}

/**
 * @param {Object} options
 * @param {Object} options.db - connected MongoDB/MangoDB handle.
 * @param {boolean} [options.dryRun=true] - report only; set false to drop.
 * @param {Object} [options.logger=console]
 * @returns {Promise<{ mode: 'dry-run'|'drop', collections: Array<{ collection: string, existed: boolean|null, records: number|null, dropped: boolean, skipped: string|null }> }>}
 */
export async function dropBriefRecapCaches({ db, dryRun = true, logger = console } = {}) {
  const mode = dryRun ? 'dry-run' : 'drop';
  const names = await collectionNames(db);
  const collections = [];
  for (const collection of RETIRED_CACHE_COLLECTIONS) {
    collections.push(await dropOne(db, collection, names, dryRun));
  }
  for (const report of collections) {
    try {
      logger.log(
        `${PREFIX} collection=${report.collection} existed=${report.existed ?? 'unknown'}` +
        ` records=${report.records ?? 'unknown'} dropped=${report.dropped} mode=${mode}` +
        ` skipped=${report.skipped ?? 'none'}`
      );
    } catch {
      // A throwing logger must not fail the operator's run.
    }
  }
  return { mode, collections };
}
