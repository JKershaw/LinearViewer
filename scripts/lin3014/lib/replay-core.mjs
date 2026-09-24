/**
 * scripts/lin3014/lib/replay-core.mjs (LIN-3014)
 *
 * Pure helpers for the local replay copy ruling `16c2be3e` authorized: "A
 * local replay copy of a production window (excluding `prompt`) is allowed,
 * loaded into a throwaway local `mongod`. The copy must be deleted
 * afterwards, and the deletion recorded on this ticket with the path and the
 * command."
 *
 * `replay.mjs` (the CLI entry) wires these to a real Mongo connection;
 * nothing here opens one, so it's unit-testable without a `mongod`.
 */

/** The one field the replay copy must never carry (ruling `16c2be3e`). */
export function replayProjection() {
  return { prompt: 0 };
}

/**
 * The window query for the replay copy: same shape as the app's own lean
 * read (`urlKey` + a `dispatchedAt` lower bound), so the copy's row set
 * matches what the equivalence sample needs to reconstruct loops/sessions
 * for.
 *
 * @param {Object} opts
 * @param {string} opts.urlKey
 * @param {number} opts.sinceMs - epoch ms lower bound for `dispatchedAt`
 */
export function replayWindowQuery({ urlKey, sinceMs }) {
  if (!urlKey) throw new Error('replayWindowQuery: urlKey is required');
  if (!Number.isFinite(sinceMs)) throw new Error('replayWindowQuery: sinceMs must be a finite number');
  return { urlKey, dispatchedAt: { $gte: new Date(sinceMs) } };
}

/**
 * A structured, loggable record of the mandatory delete step — this is what
 * gets posted on the ticket ("the deletion recorded on this ticket with the
 * path and the command"), never left implicit.
 *
 * @param {Object} opts
 * @param {string} opts.dbPath - the throwaway local mongod's dbpath
 * @param {string} opts.collectionName
 * @param {number} opts.rowsDeleted
 * @param {string} opts.command - the exact command run to delete it
 * @param {Date} [opts.deletedAt]
 */
export function buildDeletionRecord({ dbPath, collectionName, rowsDeleted, command, deletedAt = new Date() }) {
  if (!dbPath) throw new Error('buildDeletionRecord: dbPath is required');
  if (!command) throw new Error('buildDeletionRecord: command is required');
  return {
    event: 'lin3014-replay-deleted',
    dbPath,
    collectionName,
    rowsDeleted,
    command,
    deletedAt: deletedAt.toISOString()
  };
}
