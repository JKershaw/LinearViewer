/**
 * LIN-4515 (P2): the change records a PR gets, written and refreshed in one place.
 *
 * - `backstopChangeFor`: a done implementation or audit run that reported a PR and has no change for it gets one, under
 *   that run. The check is by ref within the task (a stage's own change has a store-generated id, so the two writers
 *   agree on the ref, not the id); the id it writes under is `fixedIdOf('change', taskId, key)`, so a retry hits the
 *   store's version index and writes nothing new.
 * - `refreshTaskChanges`: the one validity read. For each open change of a task it reads the PR through the injected
 *   reader (keyed by PR URL), revises `head` when the PR's head moved, ends the change `merged` (through the one merge
 *   function, with the head at merge, never the merge commit) or `abandoned` when the PR closed unmerged, and leaves
 *   the change alone when the PR cannot be read (fail open, as close-out does).
 *
 * Writes go through the checked pipeline (lib/records/writes.js), never the store's add, revise or end (records area
 * note). The PR reader is injected: lib/records/ imports only Platform, so this module lives beside it, not in it.
 *
 * INERT SEAM (beat 2, witnesses first): these do nothing, so the witnesses fail on the behaviour. The real logic
 * replaces them in beat 3.
 */

/**
 * @returns {Promise<null>} the change written or found, once the real backstop is in.
 */
export async function backstopChangeFor({ urlKey, taskId, runId, prUrl, writes, recordsStore, readPrStatus }) {
  return null;
}

/**
 * @returns {Promise<Array>} one answer per open change of the task, once the real refresh is in.
 */
export async function refreshTaskChanges({ urlKey, taskId, writes, recordsStore, readPrStatus, by = 'harbour' }) {
  return [];
}
