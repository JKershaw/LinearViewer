/**
 * LIN-4515 (P2): the change ref, one rule. A change's `ref` is the PR's full URL; a ref that names a PR with prose after
 * it (walk 8: `https://github.com/o/r/pull/2447 (branch feat/…)`) is normalised to that URL at write, and the change's
 * key (what a landing comparison and the backstop's derived id read) is the lower-cased `owner/repo#number`, so the
 * repository compares case-blind, as GitHub does (LIN-4439). Pure: no store, no network.
 *
 * INERT SEAM (beat 2, witnesses first): these return their input unchanged, so the witnesses that use them fail on the
 * behaviour, not on a missing module. The real rule replaces them in beat 3.
 */

/** @returns {{url: string, repo: string, number: number}|null} the PR a ref names, or null when it names none. */
export function prRefOf(ref) {
  return null;
}

/** @returns {string|null} the bare PR URL a ref names (`https://github.com/<owner>/<repo>/pull/<n>`), or null. */
export function canonicalChangeRef(ref) {
  return ref;
}

/** @returns {string|null} the case-blind key of a ref (`owner/repo#n`, lower-case), or null when it names no PR. */
export function changeKeyOf(ref) {
  return ref;
}
