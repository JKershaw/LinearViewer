/**
 * LIN-4515 (P2): the change ref, one rule. A change's `ref` is the PR's full URL; a ref that names a PR with prose after
 * it (walk 8: `https://github.com/o/r/pull/2447 (branch feat/…)`) is normalised to that URL at write, and the change's
 * key (what a landing comparison and the backstop's derived id read) is the lower-cased `owner/repo#number`, so the
 * repository compares case-blind, as GitHub does (LIN-4439). Pure: no store, no network.
 */

// A PR URL, and not a longer path segment after its number (`/pull/12x`). The owner and repository are GitHub's own
// characters; the first URL in the ref is the PR the ref names.
const PR_URL_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?![\w-])/;

/** @returns {{url: string, repo: string, number: number}|null} the PR a ref names, or null when it names none. */
export function prRefOf(ref) {
  if (typeof ref !== 'string') return null;
  const m = ref.match(PR_URL_RE);
  if (!m) return null;
  const [, owner, repo, digits] = m;
  const number = Number(digits);
  return { url: `https://github.com/${owner}/${repo}/pull/${number}`, repo: `${owner}/${repo}`, number };
}

/**
 * Whether two heads name the same commit (LIN-4518 step 3). A head is a full sha, or the abbreviation a verdict pinned (the
 * review prompt names the first nine characters): an abbreviation of at least seven characters is the same commit as the
 * full sha it begins. Without this, the refresh that stores GitHub's full head would revise an approval's abbreviated head
 * and stale it on the spot.
 * @returns {boolean} false when either head is missing
 */
export function sameCommit(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 7 && long.startsWith(short);
}

/** @returns {string|null} the bare PR URL a ref names (`https://github.com/<owner>/<repo>/pull/<n>`), or null. */
export function canonicalChangeRef(ref) {
  return prRefOf(ref)?.url ?? null;
}

/** @returns {string|null} the case-blind key of a ref (`owner/repo#n`, lower-case), or null when it names no PR. */
export function changeKeyOf(ref) {
  const pr = prRefOf(ref);
  return pr ? `${pr.repo}#${pr.number}`.toLowerCase() : null;
}
