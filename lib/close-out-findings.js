// The close-out gate's one reading of open findings (LIN-4495, piece 4 of LIN-4491).
//
// A hand-off to close-out is a records finding: `kind: 'finding'`, `to: 'close-out'`, `in` the task it
// belongs to, open until close-out ends it (lib/records/kinds.json). This module is the one place that
// reads them for the gate. Every surface (the decision, the merge recorder, the evidence, the task page, the
// selector) takes the reading as a value; none looks a ticket up on its own.
//
// Two states, and only one of them is "none open":
//   - `read`: the store answered. `count` is the open findings to close-out on this task (0 = none open).
//   - `not-read`: the store was missing, the read failed, or the ticket has no task record yet (the store
//     cannot tell "never had a task" from "the lookup missed it", so neither is shown as zero). Never a zero.
//
// PURE for the consumers: `findingsRead`/`findingsNotRead` build the value, `findingsHold` and `findingsCount`
// read it. `readOpenFindings` is the one async reader; it takes the records store as an argument (it imports
// only the close-out line's one spelling, an import-free leaf), so the caller decides which store and urlKey it is.
import { CLOSE_OUT_LINE } from './prompts/handoff-words.js';

/** The addressee every review, blind-read, leftover and close-out finding that the gate counts names. */
export const CLOSE_OUT_FINDINGS_TO = 'close-out';

export const FINDINGS_STATE = Object.freeze({ READ: 'read', NOT_READ: 'not-read' });

/** @returns {{state: 'read', count: number, ids: string[]}} */
export function findingsRead(ids = []) {
  return { state: FINDINGS_STATE.READ, count: ids.length, ids: [...ids] };
}

/** @returns {{state: 'not-read', count: null, ids: [], why: string}} */
export function findingsNotRead(why = 'not read') {
  return { state: FINDINGS_STATE.NOT_READ, count: null, ids: [], why };
}

/**
 * A fixed "none open" reading. No production path uses it (a production reading is always taken from the store);
 * it is the tests' and seams' shared way to say "the store answered, nothing is open".
 */
export const FINDINGS_NONE = Object.freeze(findingsRead([]));

/** Does this reading hold the gate? Anything but a read with zero open findings does. */
export function findingsHold(reading) {
  if (!reading || reading.state !== FINDINGS_STATE.READ) return true;
  return reading.count > 0;
}

/** The open count, or null when it is not measured. A consumer shows null as "not measured", never as 0. */
export function findingsCount(reading) {
  if (!reading || reading.state === FINDINGS_STATE.NOT_READ) return null;
  return reading.count;
}

/**
 * The one async reader: the open findings to close-out on the task `ticket` belongs to.
 * @param {Object} args
 * @param {Object|null} args.store - a RecordsStore (lib/records-store.js), or null when there is none
 * @param {string} args.urlKey - the workspace
 * @param {string} args.ticket - the ticket identifier (LIN-n)
 * @returns {Promise<{state: string, count: number|null, ids: string[], why?: string}>}
 */
export async function readOpenFindings({ store, urlKey, ticket }) {
  if (!store || !urlKey) return findingsNotRead('no records store');
  try {
    const taskId = await store.taskForTicket(urlKey, ticket);
    // No task record: not read, never "none open" (LIN-4527). Every dispatch makes the task first (LIN-4501).
    if (!taskId) return findingsNotRead('no task record for the ticket');
    const open = await store.find(urlKey, { kind: 'finding', state: 'open', to: CLOSE_OUT_FINDINGS_TO, inRef: taskId });
    return findingsRead(open.map(r => r.id));
  } catch (err) {
    return findingsNotRead(err?.message || 'read failed');
  }
}

/** The copy a surface shows for a reading, in one place (the task page, the evidence, the selector's words). */
export function findingsCopy(reading) {
  if (!reading || reading.state === FINDINGS_STATE.NOT_READ) return 'open findings not read — not checked';
  if (reading.count === 0) return CLOSE_OUT_LINE;
  return reading.count === 1 ? '1 open finding to close-out' : `${reading.count} open findings to close-out`;
}
