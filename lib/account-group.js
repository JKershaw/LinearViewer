/**
 * Account merge groups.
 *
 * The session account's merge group is its canonical account plus every account
 * merged into it, and the id as written in the session. Reads that must span a
 * person's identities (task-mode, run counts) use this so merging accounts cannot
 * double an allowance.
 *
 * Extracted from routes/task-mode.js (LIN-2942) for reuse by run-count
 * attribution (LIN-3238 / LIN-2955 Q2).
 */

/**
 * Resolve the merge group for an account.
 *
 * PROVISIONAL: when canonicalization fails (a corrupt mergedInto chain), the
 * read narrows to the session's own account rather than guessing at a group — it
 * can under-report, never show another account's rows.
 *
 * @param {Object} accountStore - Account store exposing resolveCanonicalAccountId/listMergedAccounts
 * @param {string} accountId - The account id as written in the session
 * @returns {Promise<string[]>}
 */
export async function resolveAccountGroup(accountStore, accountId) {
  if (!accountStore) return [accountId];
  try {
    const canonicalId = await accountStore.resolveCanonicalAccountId(accountId);
    const merged = await accountStore.listMergedAccounts(canonicalId);
    return [...new Set([canonicalId, ...merged.map(account => account._id), accountId])];
  } catch (err) {
    console.error('Error resolving account merge group:', err.message);
    return [accountId];
  }
}
