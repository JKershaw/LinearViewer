/**
 * LIN-4468: the write allowance a token minted for a dispatch row carries. It is the row's stage
 * (its kind's `writes`, lib/prompt-templates.js) and the one ticket the row works on. A kind with no
 * template is `custom`, read as `work`, as the preamble reads it. A row that does not exist names
 * no stage, so its mint is stage-less and unstamped, as it was before LIN-4468 (LIN-3135 R2). A
 * read fault is not a missing row: the caller refuses the mint rather than mint it unstamped.
 *
 * Kept apart from lib/proxy-preamble.js and lib/wake-credential.js so that each caller reads the
 * same stamp. The store is passed in and only `getItemStatus` is used (the read the route layer
 * already makes); nothing here writes.
 */
import { stageWrites } from './prompt-templates.js';
import { WRITES, isRestrictedStamp } from './stage-writes.js';

/**
 * The stamp for a row already read.
 * @param {Object|null} row - the dispatch row (`kind`, `issueIdentifier`), or null when absent
 * @returns {{writes: string|null, writesTarget: string|null}} `null` writes for an absent row (unstamped)
 */
export function stampFromRow(row) {
  if (!row) return { writes: null, writesTarget: null };
  return { writes: stageWrites(row.kind) ?? WRITES.WORK, writesTarget: row.issueIdentifier || null };
}

/**
 * The stamp for the row `itemId`, read through the store. A read fault propagates: the caller
 * refuses the mint rather than minting a token it cannot stamp.
 * @param {{getItemStatus: Function}} store
 * @param {string} urlKey
 * @param {string} itemId
 * @returns {Promise<{writes: string|null, writesTarget: string|null}>}
 */
export async function stampForItem(store, urlKey, itemId) {
  return stampFromRow(await store.getItemStatus(urlKey, itemId));
}

/**
 * The stamp for a follow-up: its own kind's `writes`, and, when that is restricted, the parent
 * row's ticket (a follow-up works the parent's ticket). An unrestricted follow-up reads no row.
 * @param {{getItemStatus: Function}} store
 * @param {string} urlKey
 * @param {string} followUpTo - the parent row's id
 * @param {string|undefined} kind - the follow-up's own kind (undefined: `custom`, `work`)
 * @returns {Promise<{writes: string, writesTarget: string|null}>}
 */
export async function stampForFollowUp(store, urlKey, followUpTo, kind) {
  const writes = stageWrites(kind) ?? WRITES.WORK;
  if (!isRestrictedStamp(writes)) return { writes, writesTarget: null };
  const parent = await store.getItemStatus(urlKey, followUpTo);
  return { writes, writesTarget: parent?.issueIdentifier || null };
}
