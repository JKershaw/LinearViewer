/**
 * Milestone-funnel readers (LIN-2952): the shared pieces the per-account route
 * and the cross-account aggregate both build on. This file starts with
 * canonicalization; the step readers (login / connected / first Go / PR opened /
 * merge clicked) land with them in the next beat.
 *
 * Canonicalization here is a PRE-RESOLVED map, the same idiom as
 * `lib/credential-invariant-sweep.js:220-224`: resolve every recorded account id
 * once, and let the pure aggregator group on `canonicalByAccountId.get(id) ?? id`.
 * A merge can only ever move a person forward (an id canonical at write time can
 * later be merged away), so the read must fold the group at read time.
 */

/**
 * Resolve every recorded account id to its canonical id, once.
 *
 * Never drops or crashes: `resolveCanonicalAccountId` throws on a corrupt
 * `mergedInto` chain (a cycle, or an over-deep chain), and a throw here falls
 * back to the recorded id for THAT id only — the person under-counts, and no
 * account is ever silently reassigned to another. Falsy ids are skipped.
 *
 * @param {Iterable<string>} accountIds
 * @param {import('./account-store.js').AccountStore} accountStore
 * @returns {Promise<Map<string, string>>} recorded id -> canonical id
 */
export async function buildCanonicalMap(accountIds, accountStore) {
  const map = new Map();
  for (const accountId of new Set(accountIds || [])) {
    if (!accountId) continue;
    try {
      map.set(accountId, await accountStore.resolveCanonicalAccountId(accountId));
    } catch (err) {
      console.error(`[milestone-funnel] canonicalization failed for an account: ${err?.message || err}`);
      map.set(accountId, accountId);
    }
  }
  return map;
}
