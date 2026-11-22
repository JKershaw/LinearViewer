// Full PR URLs and the trail sort (LIN-3247, P2 of LIN-2949; LIN-4520 retired the comment parsers).
//
// PURE — no I/O, no clock, no store:
//   - full PR URLs (`prUrlsIn`, `prOf`, `PR_URL_RE`) — the one reader of a body's PR URLs;
//   - the trail sort (`byTime`), comments oldest first (provider order is not trusted);
//   - the blind read's PR set (`checkBlindReadPrs`, the write guard's one remaining check): a comment that opens as a
//     blind read names exactly the landing's PRs, no fewer and no extras (LIN-4437, its shape half retired by LIN-4520).
//
// Verdicts, the review's commit and its ledger are records now (lib/records/*). The comment parsers that read them
// (the review ledger, `findSha`, the verdict words, the blind read's shape) are retired here (LIN-4520).

import { BLIND_READ_HEADING } from './prompts/blind-read-words.js';

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

// ─── The blind read's PR set (LIN-4437, the route's check; shape retired by LIN-4520) ─────────

/** The refusal codes the proxy answers a blind read whose PR set is wrong with (documented in lib/proxy-instructions.js). */
export const BLIND_READ_CODES = Object.freeze({
  prsMissing: 'BLIND_READ_PRS_MISSING',
  prsMismatch: 'BLIND_READ_PRS_MISMATCH'
});

/**
 * A blind read's PR set against the task's landing (LIN-4437). PURE. The body is taken to BE a blind read (the write
 * guard decides that from its heading). The read names at least one full PR URL, and, when `landing` is given (an
 * array), exactly the landing's PRs: no fewer and no extras. `landing` null (the records could not be read) skips the
 * set check only; the write guard then holds nothing and logs it.
 *
 * @param {string} body
 * @param {{landing?: string[]|null}} [options]
 * @returns {{ok: true, prs: string[], setChecked: boolean}
 *   | {ok: false, code: string, expected?: string[], got?: string[]}}
 */
export function checkBlindReadPrs(body, { landing = null } = {}) {
  const prs = prUrlsIn(body);
  if (!prs.length) return { ok: false, code: BLIND_READ_CODES.prsMissing };
  const setChecked = Array.isArray(landing);
  if (setChecked) {
    const want = new Set(landing);
    if (prs.length !== want.size || prs.some((u) => !want.has(u))) {
      return { ok: false, code: BLIND_READ_CODES.prsMismatch, expected: [...landing], got: prs };
    }
  }
  return { ok: true, prs, setChecked };
}

/**
 * The 422 message for a blind read whose PR set is refused (LIN-4437), so a reader refused once can fix its comment
 * in one retry.
 * @param {{code: string, expected?: string[], got?: string[]}} check - a failed checkBlindReadPrs result
 * @returns {string}
 */
export function blindReadRefusal(check) {
  const why = {
    [BLIND_READ_CODES.prsMissing]: 'it names no PR by full URL',
    [BLIND_READ_CODES.prsMismatch]: `its full PR URLs must be exactly the landing's: ${(check.expected || []).join(', ') || 'none'} (it names ${(check.got || []).join(', ') || 'none'}); cite any other PR as #N`
  }[check.code] || 'its PR set does not hold';
  return `A comment opening with "${BLIND_READ_HEADING}" is a blind read: it needs the full URL of each PR read, exactly the task's landing. This one is refused: ${why}. Nothing was posted.`;
}
