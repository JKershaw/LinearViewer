// Full PR URLs and the trail sort (LIN-3247, P2 of LIN-2949; LIN-4520 retired the comment parsers).
//
// PURE — no I/O, no clock, no store:
//   - full PR URLs (`prUrlsIn`, `prOf`, `PR_URL_RE`) — the one reader of a body's PR URLs;
//   - the trail sort (`byTime`), comments oldest first (provider order is not trusted).
//
// Verdicts, the review's commit and its ledger are records now (lib/records/*). The comment parsers that read them
// (the review ledger, `findSha`, the verdict words, the blind read's shape) are retired here (LIN-4520), and so is the
// blind read's PR-set check (LIN-4543): its landing rule holds on its verdict record.

// ─── Full PR URLs and the trail sort ─────────────────────────────────────────

export const PR_URL_RE = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/;

const PR_URL_ALL = new RegExp(PR_URL_RE.source, 'g');

/**
 * Every distinct full PR URL in a body, in the order they first appear. The one reader of that
 * (LIN-4437): lib/run-evidence.js extractPrUrls reads through it too (LIN-4438).
 */
export function prUrlsIn(body) {
  return [...new Set(String(body || '').match(PR_URL_ALL) || [])];
}

/**
 * A full PR URL (as `prUrlsIn` finds it) as its `owner/name` slug and number. Moved here from
 * lib/run-evidence.js by LIN-4439, beside the one reader of PR URLs, so measure 1
 * (scripts/stability-measures-blind.mjs) reads a URL's PR the same way as the task page.
 * @param {string} url
 * @returns {{repo: string, number: number}}
 */
export function prOf(url) {
  const [owner, name, , number] = url.split('/').slice(3);
  return { repo: `${owner}/${name}`, number: Number(number) };
}

/**
 * Comments with a body, oldest first (provider order is not trusted). The one trail sort; moved from
 * lib/recommendation-facts.js by LIN-4437, its comparator as it was there.
 */
export function byTime(comments) {
  return (Array.isArray(comments) ? [...comments] : [])
    .filter(c => c && typeof c.body === 'string')
    .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
}
