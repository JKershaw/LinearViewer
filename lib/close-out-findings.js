// The close-out gate's one reading of open findings (LIN-4495, piece 4 of LIN-4491).
//
// A hand-off to close-out is a records finding: `kind: 'finding'`, `to: 'close-out'`, `in` the task it
// belongs to, open until close-out ends it (lib/records/kinds.json). This module is the one place that
// reads them for the gate. Every surface (the decision, the merge recorder, the evidence, the task page, the
// selector) takes the reading as a value; none looks a ticket up on its own.
//
// Three states, and only one of them is "none open":
//   - `read`: the store answered. `count` is the open findings to close-out on this task (0 = none open).
//   - `legacy`: the task's latest review still carries its `### What CI Did Not Prove` items as comment text
//     (written before the cutover), with no finding records to match them. Those items are not measured
//     here, so the gate holds rather than reading them as zero. `count` is what the store does hold.
//   - `not-read`: the store was missing or the read failed. Never a zero.
//
// PURE for the consumers: `findingsRead`/`findingsNotRead`/`findingsLegacy` build the value, `findingsHold`
// and `findingsCount` read it. `readOpenFindings` is the one async reader; it takes the records store as an
// argument (it imports only the close-out line's one spelling, an import-free leaf), so the caller decides which store
// and urlKey it is.
import { CLOSE_OUT_LINE } from './prompts/handoff-words.js';

/** The addressee every review, blind-read, leftover and close-out finding that the gate counts names. */
export const CLOSE_OUT_FINDINGS_TO = 'close-out';

export const FINDINGS_STATE = Object.freeze({ READ: 'read', LEGACY: 'legacy', NOT_READ: 'not-read' });

/** @returns {{state: 'read', count: number, ids: string[]}} */
export function findingsRead(ids = []) {
  return { state: FINDINGS_STATE.READ, count: ids.length, ids: [...ids] };
}

/** @returns {{state: 'legacy', count: number, ids: string[]}} */
export function findingsLegacy(ids = []) {
  return { state: FINDINGS_STATE.LEGACY, count: ids.length, ids: [...ids] };
}

/** @returns {{state: 'not-read', count: null, ids: [], why: string}} */
export function findingsNotRead(why = 'not read') {
  return { state: FINDINGS_STATE.NOT_READ, count: null, ids: [], why };
}

/** A reading that is a fixed "none open": the default for a task with no finding and no legacy ledger. */
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
 * Is the latest review's ledger a pre-cutover one that still carries items as text? Pure over a review model
 * (lib/run-trail.js readTrail's `review`, which is parseRunLedger's shape): the section is present and not
 * stated empty.
 */
export function legacyLedgerOf(review) {
  const ledger = review && review.ledger;
  return !!(ledger && ledger.present && !ledger.empty);
}

/**
 * The one async reader: the open findings to close-out on the task `ticket` belongs to.
 * @param {Object} args
 * @param {Object|null} args.store - a RecordsStore (lib/records-store.js), or null when there is none
 * @param {string} args.urlKey - the workspace
 * @param {string} args.ticket - the ticket identifier (LIN-n)
 * @param {boolean} [args.legacyLedger] - legacyLedgerOf(review)
 * @returns {Promise<{state: string, count: number|null, ids: string[], why?: string}>}
 */
export async function readOpenFindings({ store, urlKey, ticket, legacyLedger = false }) {
  if (!store || !urlKey) return findingsNotRead('no records store');
  try {
    const taskId = await store.taskForTicket(urlKey, ticket);
    const open = taskId
      ? await store.find(urlKey, { kind: 'finding', state: 'open', to: CLOSE_OUT_FINDINGS_TO, inRef: taskId })
      : [];
    const ids = open.map(r => r.id);
    return legacyLedger ? findingsLegacy(ids) : findingsRead(ids);
  } catch (err) {
    return findingsNotRead(err?.message || 'read failed');
  }
}

/** The copy a surface shows for a reading, in one place (the task page, the evidence, the selector's words). */
export function findingsCopy(reading) {
  if (!reading || reading.state === FINDINGS_STATE.NOT_READ) return 'open findings not read — not checked';
  if (reading.state === FINDINGS_STATE.LEGACY) {
    return reading.count
      ? `${reading.count} open to close-out, and the review's ledger items predate records — not measured`
      : 'the review\'s ledger items predate records — not measured';
  }
  if (reading.count === 0) return CLOSE_OUT_LINE;
  return reading.count === 1 ? '1 open finding to close-out' : `${reading.count} open findings to close-out`;
}
