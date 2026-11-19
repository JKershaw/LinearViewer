// Run-ledger parsers (LIN-3247, P2 of LIN-2949): what ONE comment on a run's trail says, and the
// readers of full PR URLs.
//
// PURE parsers — no I/O, no clock, no store. What they read:
//   - one review comment's display model (`parseRunLedger`): the verdict (plain Approve vs the
//     conditional form vs a non-approve), the review's CI line verbatim, the comment time and the
//     commit sha it carries, and whether the comment still carries a `### What CI Did Not Prove`
//     section (LIN-4495: the items are records now, so the section's text is kept verbatim as
//     `ledger.raw`, never parsed into items; an explicitly empty section is `ledger.empty`);
//   - a blind read's shape (`checkBlindReadShape`, LIN-4437) and the proxy's refusal copy;
//   - full PR URLs (`prUrlsIn`, `prOf`) and the one trail sort (`byTime`).
//
// What KIND a comment is, and what the trail of them says (the latest review, the landing, the
// latest blind read), is lib/run-trail.js's (LIN-4458): it imports these parsers, and this file
// imports nothing from it, so the two never import each other. It imports only the blind read's
// words (an import-free leaf).
//
// This reader does not write and does not change the `### What CI Did Not
// Prove` heading, so `lib/follow-on-ratio.js`'s marker (the same literal) is
// untouched.

import { BLIND_READ_HEADING, BLIND_READ_VERDICT_LABEL, BLIND_READ_VERDICTS } from './prompts/blind-read-words.js';

// The heading literal is load-bearing: `lib/follow-on-ratio.js:161` keys its
// review-ledger marker on exactly this string. Read it, never rewrite it.
// Anchored to a line start (R3): a mention of the heading inside prose or
// backticks must not be read as the real ledger, which would capture the
// preceding section's bullets as ledger items.
export const LEDGER_HEADING = /^###\s*What CI Did Not Prove\b[^\n]*/im;

const VERDICT_ORDER = [
  ['request-changes', /request changes/i],
  ['needs-discussion', /needs discussion/i],
  ['approve-conditional', /approve[\s\S]*conditional/i],
  ['approve', /\bapprove\b/i],
];

/**
 * @typedef {Object} RunLedger
 * @property {'approve'|'approve-conditional'|'request-changes'|'needs-discussion'|'unknown'} verdict
 * @property {string|null} verdictText  The verdict exactly as the review wrote it.
 * @property {string|null} ciLine       The review's CI line, verbatim, or null.
 * @property {string|null} at           The comment's createdAt, or null.
 * @property {string|null} sha          The commit sha the comment carries, or null.
 * @property {string|null} commentId
 * @property {{ present: boolean, empty: boolean, raw: string|null }} ledger  (LIN-4495: no items; see the header)
 * @property {BlindRead|null} [blindRead] The latest blind read after the review (LIN-4437), attached
 *   by every caller that holds the whole trail (`latestBlindRead`); `parseRunLedger` reads one comment.
 */

/** The `### What CI Did Not Prove` section body, stopping before the verdict or the next heading. */
function findLedgerSection(body) {
  const m = LEDGER_HEADING.exec(body);
  if (!m) return { present: false, text: '' };
  const rest = body.slice(m.index + m[0].length);
  const stop = rest.search(/\n#{1,3}\s+(?!what ci did not prove)|\n\*\*Verdict|\n###\s*Verdict/i);
  const text = stop === -1 ? rest : rest.slice(0, stop);
  return { present: true, text: text.trim() };
}

/** An explicit "nothing here" statement, not merely a short section. */
function isEmptyStatement(text) {
  return /^\s*\(?\s*none\b/i.test(text)
    || /\bledger\s+(?:is\s+)?empty\b/i.test(text)
    || /\bno\s+(?:unproven|unresolved|open|items?)\b/i.test(text)
    || /CI covers the deliverable/i.test(text);
}

function findVerdictText(body) {
  let m = body.match(/\*\*Verdict:\s*([\s\S]*?)\*\*/i);
  if (m) return m[1].trim();
  m = body.match(/\bVerdict:?\s*\*\*([\s\S]*?)\*\*/i);
  if (m) return m[1].trim();
  m = body.match(/###\s*Verdict\s*\n+\s*([^\n]+)/i);
  if (m) return m[1].replace(/[*`]/g, '').trim();
  m = body.match(/\bVerdict:\s*([^\n*]+)/i);
  if (m) return m[1].trim();
  return null;
}

function classifyVerdict(verdictText) {
  if (!verdictText) return 'unknown';
  for (const [kind, pattern] of VERDICT_ORDER) {
    if (pattern.test(verdictText)) return kind;
  }
  return 'unknown';
}

/** The review's own CI line, verbatim, or null when the comment carries none. */
function findCiLine(body) {
  for (const line of body.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (/^#/.test(line)) continue;
    if (/Verdict/i.test(line)) continue;
    if (/\bCI\b/.test(line) && /\b(green|red|success|fail|failed|passed|absent|run|checked|headSha|\d+\/\d+)\b/i.test(line)) {
      return line;
    }
  }
  return null;
}

/** The commit sha the comment carries (preferring a head/at-labelled one), or null. */
function findSha(body) {
  const patterns = [
    /head(?:Sha)?[^\n`]{0,40}?`([0-9a-f]{7,40})`/i,
    /(?:at|@)\s+`([0-9a-f]{7,40})`/i,
    /`([0-9a-f]{7,40})`/,
    /\b([0-9a-f]{7,40})\b/,
  ];
  for (const pattern of patterns) {
    const m = body.match(pattern);
    if (m) return m[1];
  }
  return null;
}

/**
 * Parse one review summary comment into the run-evidence display model. Pure. LIN-4495: the ledger's items are
 * records (lib/close-out-findings.js reads them), so this reads only whether the section is present and whether it is
 * stated empty; its text is kept verbatim on `ledger.raw`. A section that is present and not stated empty is a
 * pre-cutover ledger, which the close-out gate holds as not measured.
 *
 * @param {{body?: string, createdAt?: string, id?: string}|null} comment
 * @returns {RunLedger}
 */
export function parseRunLedger(comment) {
  const body = comment && typeof comment.body === 'string' ? comment.body : '';
  const section = findLedgerSection(body);
  const verdictText = findVerdictText(body);
  const ledger = {
    present: section.present,
    empty: section.present && (!section.text || isEmptyStatement(section.text)),
    raw: section.present ? (section.text || null) : null,
  };

  return {
    verdict: classifyVerdict(verdictText),
    verdictText,
    ciLine: findCiLine(body),
    at: comment && comment.createdAt ? comment.createdAt : null,
    sha: findSha(body),
    commentId: comment && comment.id ? comment.id : null,
    ledger,
  };
}

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

// ─── The blind read's shape (LIN-4437, piece 2 of LIN-4396) ──────────────────

/** The refusal codes the proxy answers a malformed blind read with (documented in lib/proxy-instructions.js). */
export const BLIND_READ_CODES = Object.freeze({
  verdictMissing: 'BLIND_READ_VERDICT_MISSING',
  verdictRepeated: 'BLIND_READ_VERDICT_REPEATED',
  verdictWord: 'BLIND_READ_VERDICT_WORD',
  reasonMissing: 'BLIND_READ_REASON_MISSING',
  prsMissing: 'BLIND_READ_PRS_MISSING',
  prsMismatch: 'BLIND_READ_PRS_MISMATCH'
});

const LABEL_WORD = BLIND_READ_VERDICT_LABEL.replace(/:$/, '');
// A verdict line: the label opens the line, optionally in bold.
const VERDICT_LINE = new RegExp(`^(?:\\*\\*|__)?${LABEL_WORD}(?:\\*\\*|__)?:(?:\\*\\*|__)?(.*)$`, 'i');
// "A reason": at least this many words with a letter in them after the verdict word.
const MIN_REASON_WORDS = 3;

/** The verdict lines of a body, outside fenced code blocks, as `{ number, text, rest }` (1-based). */
function verdictLines(body) {
  const found = [];
  let fenced = false;
  String(body).split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    const m = VERDICT_LINE.exec(line);
    if (m) found.push({ number: i + 1, text: line, rest: m[1].trim() });
  });
  return found;
}

/** A verdict line's value: its word (lower case, markup stripped) and the reason after it. */
function verdictOf(rest) {
  const m = /^[\s*_`]*([A-Za-z-]+)[\s*_`]*(.*)$/s.exec(rest);
  if (!m) return { word: '', reason: '' };
  return { word: m[1].toLowerCase(), reason: m[2].replace(/^[\s.,;:—–-]+/, '').trim() };
}

const wordsIn = (text) => text.split(/\s+/).filter((t) => /[A-Za-z]/.test(t)).length;

/**
 * A blind read's shape (LIN-4437). PURE. The body is taken to BE a blind read: whether it is one is
 * lib/run-trail.js `checkBlindRead`'s question, which answers `applies: false` for every other
 * comment and asks this for a read. A read needs:
 *   - exactly one verdict line, its first word one of the three words, then a reason;
 *   - at least one full PR URL, and, when `landing` is given, exactly the landing's PRs: no fewer
 *     and no extras. `landing` null (the trail could not be read) skips only that set check.
 *
 * @param {string} body
 * @param {{landing?: string[]|null}} [options]
 * @returns {{ok: true, applies: true, verdict: string, reason: string, prs: string[], setChecked: boolean}
 *   | {ok: false, code: string, line?: {number: number, text: string}, expected?: string[], got?: string[]}}
 */
export function checkBlindReadShape(body, { landing = null } = {}) {
  const lines = verdictLines(body);
  if (!lines.length) return { ok: false, code: BLIND_READ_CODES.verdictMissing };
  const at = (l) => ({ number: l.number, text: l.text });
  if (lines.length > 1) return { ok: false, code: BLIND_READ_CODES.verdictRepeated, line: at(lines[1]) };
  const { word, reason } = verdictOf(lines[0].rest);
  if (!BLIND_READ_VERDICTS.includes(word)) return { ok: false, code: BLIND_READ_CODES.verdictWord, line: at(lines[0]) };
  if (wordsIn(reason) < MIN_REASON_WORDS) return { ok: false, code: BLIND_READ_CODES.reasonMissing, line: at(lines[0]) };
  const prs = prUrlsIn(body);
  if (!prs.length) return { ok: false, code: BLIND_READ_CODES.prsMissing };
  const setChecked = Array.isArray(landing);
  if (setChecked) {
    const want = new Set(landing);
    if (prs.length !== want.size || prs.some((u) => !want.has(u))) {
      return { ok: false, code: BLIND_READ_CODES.prsMismatch, expected: [...landing], got: prs };
    }
  }
  return { ok: true, applies: true, verdict: word, reason, prs, setChecked };
}

/**
 * The 422 message for a refused blind read (LIN-4437), so a reader refused once can fix its comment
 * in one retry. Words from the leaf, never retyped.
 * @param {{code: string, expected?: string[], got?: string[]}} check - a failed checkBlindRead result
 * @returns {string}
 */
export function blindReadRefusal(check) {
  const shape = `A comment opening with "${BLIND_READ_HEADING}" is a blind read: it needs exactly one line starting "${BLIND_READ_VERDICT_LABEL}", then one of ${BLIND_READ_VERDICTS.join(', ')} and a reason naming what the change made better and worse, and the full URL of each PR read`;
  const why = {
    [BLIND_READ_CODES.verdictMissing]: `no "${BLIND_READ_VERDICT_LABEL}" line`,
    [BLIND_READ_CODES.verdictRepeated]: `more than one "${BLIND_READ_VERDICT_LABEL}" line`,
    [BLIND_READ_CODES.verdictWord]: `the verdict word is not one of ${BLIND_READ_VERDICTS.join(', ')} (there is no fourth)`,
    [BLIND_READ_CODES.reasonMissing]: 'the verdict has no reason after its word',
    [BLIND_READ_CODES.prsMissing]: 'it names no PR by full URL',
    [BLIND_READ_CODES.prsMismatch]: `its full PR URLs must be exactly the landing's: ${(check.expected || []).join(', ') || 'none'} (it names ${(check.got || []).join(', ') || 'none'}); cite any other PR as #N`
  }[check.code] || 'its shape does not hold';
  return `${shape}. This one is refused: ${why}. Nothing was posted.`;
}

/**
 * @typedef {Object} BlindRead
 * @property {'better'|'same'|'worse'} verdict
 * @property {string} reason
 * @property {string[]} prs        The full PR URLs the read names.
 * @property {string|null} at       The comment's createdAt.
 * @property {string|null} commentId
 */
