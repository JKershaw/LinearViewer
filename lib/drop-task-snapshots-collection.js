/**
 * One-shot removal of the retired `task-snapshots` collection (LIN-4502), modelled on
 * lib/drop-shares-collection.js (LIN-3325).
 *
 * LIN-4502 retired task snapshots outright (John's ruling, 20 Nov): the capture at
 * the recap/brief read seams, the store, the `/snapshots` routes, the test clear
 * route and the replay and eval readers are gone, and its two index specs are gone
 * from `lib/db-indexes.js`. The persisted records and indexes are NOT dropped by the
 * running app — `ensureIndexes` has no drop mechanism, and dropping stored task
 * history is not routine boot cleanup. Instead this module ships the one-off,
 * operator-run cleanup: an operator runs `scripts/drop-task-snapshots-collection.mjs`
 * once after deploy.
 *
 * Until that run, account erasure keeps covering the collection (lib/account-erasure.js):
 * its documents still hold a workspace's task history, so a Full wipe must take them.
 * `TASK_SNAPSHOTS_COLLECTION` below is what keeps the name in the derived collection
 * universe (tests/helpers/collection-names.js) while the data exists.
 *
 * Idempotent: dropping an absent collection is a no-op, so a repeat run is safe.
 * `dryRun` defaults to true and only reports whether the collection exists and
 * how many records it holds; the caller must pass `dryRun: false` to drop.
 */

export const TASK_SNAPSHOTS_COLLECTION = 'task-snapshots';
const PREFIX = '[drop-task-snapshots]';

/**
 * @param {Object} options
 * @param {Object} options.db - connected MongoDB/MangoDB handle.
 * @param {boolean} [options.dryRun=true] - report only; set false to drop.
 * @param {Object} [options.logger=console]
 * @returns {Promise<{ collection: string, existed: boolean|null, records: number|null, dropped: boolean, mode: 'dry-run'|'drop', skipped: string|null }>}
 */
export async function dropTaskSnapshotsCollection({ db, dryRun = true, logger = console } = {}) {
  const report = {
    collection: TASK_SNAPSHOTS_COLLECTION,
    existed: null,
    records: null,
    dropped: false,
    mode: dryRun ? 'dry-run' : 'drop',
    skipped: null
  };

  try {
    let names = [];
    try {
      const cursor = db.listCollections();
      const listed = cursor && typeof cursor.toArray === 'function' ? await cursor.toArray() : await cursor;
      names = (Array.isArray(listed) ? listed : []).map(entry => (typeof entry === 'string' ? entry : entry?.name));
    } catch {
      // listCollections unavailable — fall through with an unknown existence.
      names = null;
    }
    report.existed = Array.isArray(names) ? names.includes(TASK_SNAPSHOTS_COLLECTION) : null;

    try {
      report.records = await db.collection(TASK_SNAPSHOTS_COLLECTION).countDocuments();
    } catch {
      report.records = null;
    }

    if (dryRun) {
      report.skipped = report.existed === false ? 'absent' : null;
    } else {
      await db.collection(TASK_SNAPSHOTS_COLLECTION).drop();
      report.dropped = true;
    }
  } catch {
    // Never the message: it could carry connection details or document contents.
    report.skipped = 'unexpected-error';
  }

  try {
    logger.log(
      `${PREFIX} collection=${report.collection} existed=${report.existed ?? 'unknown'}` +
      ` records=${report.records ?? 'unknown'} dropped=${report.dropped} mode=${report.mode}` +
      ` skipped=${report.skipped ?? 'none'}`
    );
  } catch {
    // A throwing logger must not fail the operator's run.
  }
  return report;
}
