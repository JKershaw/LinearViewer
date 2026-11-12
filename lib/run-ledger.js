// Run-ledger reader (LIN-3247, P2 of LIN-2949): the one home of the readers that decide what a
// comment on a run's trail is, and what the trail says.
//
// PURE readers — no I/O, no clock, no store. What it reads:
//   - the latest code review (`isReviewSummary`, `latestReviewComment`) and its display model
//     (`parseRunLedger`, one comment): the verdict (plain Approve vs the conditional form vs a
//     non-approve), the review's CI line verbatim, the comment time and the commit sha it carries,
//     and the `### What CI Did Not Prove` ledger as items each carrying its inside/outside mark,
//     discharge route, discharged-by evidence and any follow-up link. An explicitly empty ledger is
//     a distinct, representable state; a section the parser cannot structure is preserved verbatim
//     as `ledger.raw` and flagged `ledger.unparsed` — never flattened, never dropped;
//   - a close-out's own report (`isCloseOut`, with `firstHeading` and `firstLineOf`; moved here
//     from lib/recommendation-facts.js by LIN-4437, which imports them back);
//   - the blind read (LIN-4437, piece 2 of LIN-4396): which PRs are the current landing
//     (`landingPrUrls`, the one owner of that question), a `## Blind read` comment's shape
//     (`checkBlindRead`, which the proxy holds at write time) and the latest read on record
//     (`parseBlindRead`, `latestBlindRead`, over the whole trail), and what the close-out gate reads
//     of it (`readGateTrail`, LIN-4438).
//
// It imports only import-free leaves (the blind read's and the Surveys' words), so every reader
// of the trail can import it.
//
// This reader does not write and does not change the `### What CI Did Not
// Prove` heading, so `lib/follow-on-ratio.js`'s marker (the same literal) is
// untouched.

import { BLIND_READ_HEADING, BLIND_READ_VERDICT_LABEL, BLIND_READ_VERDICTS } from './prompts/blind-read-words.js';
import { SURVEY_HEADINGS } from './prompts/survey-words.js';

// The heading literal is load-bearing: `lib/follow-on-ratio.js:161` keys its
// review-ledger marker on exactly this string. Read it, never rewrite it.
// Anchored to a line start (R3): a mention of the heading inside prose or
// backticks must not be read as the real ledger, which would capture the
// preceding section's bullets as ledger items.
const LEDGER_HEADING = /^###\s*What CI Did Not Prove\b[^\n]*/im;

// A review summary comment is identified by its TITLE — its first heading line
// — never by a heading that merely appears inside the body (R1'). The title
// names a review when it carries `review`/`re-review` anywhere, but a plan
// review is not the finished-run review this reader targets.
//
// Exclusions are anchored to the START of the title text: a genuine
// `## Close-out`/`## Autopilot` title is skipped, while a review whose title
// mentions a close-out (LIN-2944's round-5, "…conditional on close-out…") is
// kept — the unanchored body match used to drop it (R1).
//
// The body must then carry a verdict word or the line-start ledger heading, so
// a review "fix-up" that merely names a review in its title is not mistaken for
// the review itself.
const TITLE_LINE = /^#{1,6}[ \t]+([^\n]*)/m;
const TITLE_NON_REVIEW = /^(?:close-?out|autopilot)\b/i;
const TITLE_PLAN_REVIEW = /plan[-\s]+review/i;
const TITLE_NAMES_REVIEW = /\breview\b/i;
const VERDICT_WORD = /\b(?:approve[sd]?|request(?:ed)?\s+changes?|needs?\s+discussion)\b/i;

/** The comment's title: the text of its first heading line, or '' when it has none. */
function titleOf(body) {
  const m = body.match(TITLE_LINE);
  return m ? m[1].trim() : '';
}

export function isReviewSummary(body) {
  if (!body) return false;
  const title = titleOf(body);
  if (!title) return false;
  if (TITLE_NON_REVIEW.test(title)) return false;
  if (!TITLE_NAMES_REVIEW.test(title) || TITLE_PLAN_REVIEW.test(title)) return false;
  return VERDICT_WORD.test(body) || LEDGER_HEADING.test(body);
}

const LIST_ITEM_START = /^(?:[-*+]\s+|\d+[.)]\s+)/;
const VERDICT_ORDER = [
  ['request-changes', /request changes/i],
  ['needs-discussion', /needs discussion/i],
  ['approve-conditional', /approve[\s\S]*conditional/i],
  ['approve', /\bapprove\b/i],
];

/**
 * @typedef {Object} LedgerItem
 * @property {string|null} id          An item label (L1, D2, F16, R-L1, #1) or null.
 * @property {string} claim            The item's claim, verbatim minus the list/table scaffolding.
 * @property {'inside'|'outside'|'unknown'} scope  The inside/outside mark.
 * @property {string|null} discharge   The discharge route as written, or null.
 * @property {string|null} dischargedBy  The named evidence/actor that discharges it, or null.
 * @property {boolean} discharged      Whether the item reads as already discharged.
 * @property {string|null} followUp    A follow-up link/ticket named for the item, or null.
 * @property {string} raw              The verbatim item block (table row or list item), markers kept.
 */

/**
 * @typedef {Object} RunLedger
 * @property {'approve'|'approve-conditional'|'request-changes'|'needs-discussion'|'unknown'} verdict
 * @property {string|null} verdictText  The verdict exactly as the review wrote it.
 * @property {string|null} ciLine       The review's CI line, verbatim, or null.
 * @property {string|null} at           The comment's createdAt, or null.
 * @property {string|null} sha          The commit sha the comment carries, or null.
 * @property {string|null} commentId
 * @property {{ present: boolean, empty: boolean, unparsed: boolean, items: LedgerItem[], raw: string|null }} ledger
 * @property {BlindRead|null} [blindRead] The latest blind read after the review (LIN-4437), attached
 *   by every caller that holds the whole trail (`latestBlindRead`); `parseRunLedger` reads one comment.
 */

function trimToNull(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  return t ? t : null;
}

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

function extractId(text) {
  if (!text) return null;
  const t = text.replace(/[*`#]/g, '').trim();
  const m = t.match(/^(?:#\s*)?([A-Za-z][\w-]*\d|\d+)\b/);
  return m ? m[1] : null;
}

function cleanIdCell(text) {
  if (!text) return null;
  const cleaned = text.replace(/[*`]/g, '').replace(/\s*\/\s*/g, '/').trim();
  return cleaned || null;
}

function extractScope(text) {
  if (!text) return 'unknown';
  const m = text.match(/\b(inside|outside)\b/i);
  if (m) return m[1].toLowerCase();
  // Table scope cells commonly abbreviate the mark as `In` / `Out`, often with
  // a class suffix (`Out (P1b)`). Match the whole cell, so a stray "in"/"out"
  // inside a claim is never read as the mark (R2).
  const cell = text.trim().match(/^(in|out)\b(?:\s*\([^)]*\))?$/i);
  if (cell) return cell[1].toLowerCase() === 'in' ? 'inside' : 'outside';
  return 'unknown';
}

function cleanClaim(text) {
  if (!text) return '';
  return text
    .replace(/[*`]/g, '')
    .replace(/^(?:#\s*)?([A-Za-z][\w-]*\d|\d+)[.:\-–—]?\s+/, '')
    .trim();
}

const DISCHARGE_RE = /discharg(?:ed|es|e|ing)\s*(?:by|at|route|:)?\s*\**\s*([\s\S]*)$/i;

function extractDischarge(text) {
  if (!text) return null;
  const m = DISCHARGE_RE.exec(text);
  if (!m) return null;
  return trimToNull(m[1].replace(/^[:*]\s*/, ''));
}

function extractDischargedBy(text) {
  if (!text) return null;
  const m = text.match(/\*\*Discharged:?\*\*\s*([^;\n]+)/i)
    || text.match(/discharg(?:ed|es|e)?\s+by\s+([^.;\n]+)/i)
    || text.match(/discharge(?:d)?\s+(?:at|route:?)\s+([^.;\n]+)/i);
  if (m) return m[1].replace(/[*`]/g, '').trim();
  if (/explicit human acceptance/i.test(text)) return 'human acceptance';
  return null;
}

function extractFollowUp(text) {
  if (!text) return null;
  const m = text.match(/follow[- ]?up[^.\n]*?(LIN-\d+|#\d+|https?:\/\/\S+)/i)
    || text.match(/(?:blocked by|routed to|carried (?:to|into))\s+(?:the\s+)?(LIN-\d+|#\d+|https?:\/\/\S+)/i);
  if (!m) return null;
  return m[1].replace(/[),.;]+$/, '');
}

// "discharged" reads as a result only when it is not a route or a negation
// (LIN-3296). Review states how each OPEN item "can be discharged", and a bare
// infinitive "be/get discharged" only ever follows a modal or "to" — a route,
// never a result — while "not / n't / never (yet/been) discharged" and
// "un-discharged" say the opposite. Strip them, then any "discharged" left is a
// stated result.
const NOT_A_DISCHARGE = /\b(?:be|get)\s+(?:\w+ly\s+)?discharged\b|(?:\bnot|n['’]t|\bnever)\s+(?:yet\s+)?(?:been\s+)?discharged\b|\bun-discharged\b/gi;

function readsDischarged(text) {
  return /\bdischarged\b/i.test(text.replace(NOT_A_DISCHARGE, ''));
}

function buildItem({ id, claim, scopeText, discharge, full, raw }) {
  const text = full || '';
  const discharged = readsDischarged(text);
  return {
    id: id || extractId(claim) || null,
    claim: cleanClaim(claim || text),
    scope: extractScope(scopeText || text),
    discharge: discharge || extractDischarge(text),
    // Evidence only for a stated result: a route's "can be discharged by X" is
    // the plan for an open item, and the evidence page would show it as settled.
    dischargedBy: discharged ? extractDischargedBy(text.replace(NOT_A_DISCHARGE, '')) : null,
    discharged,
    followUp: extractFollowUp(text),
    raw: raw || text,
  };
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{2,}:?$/.test(cell));
}

function headerKind(header) {
  const n = (header || '').toLowerCase().replace(/[^a-z#]/g, '');
  if (n === '#' || n === 'id' || n === 'no') return 'id';
  if (n.includes('discharge') || n.includes('status')) return 'discharge';
  if (n.includes('inout') || n.includes('inside') || n.includes('scope') || n.includes('bounded') || n.includes('class')) return 'scope';
  if (n.includes('claim') || n.includes('item') || n.includes('finding')) return 'claim';
  return null;
}

function parseTableItems(text) {
  const lines = text.split('\n').filter(line => /^\s*\|/.test(line));
  if (lines.length < 2) return [];
  const header = splitRow(lines[0]);
  let separator = -1;
  for (let i = 1; i < lines.length; i++) {
    if (isSeparator(splitRow(lines[i]))) { separator = i; break; }
  }
  const rows = separator === -1 ? lines.slice(1) : lines.slice(separator + 1);
  const kinds = header.map(headerKind);
  const items = [];
  for (const row of rows) {
    const cells = splitRow(row);
    if (!cells.some(cell => cell)) continue;
    const full = cells.join(' · ');
    const pick = kind => {
      const i = kinds.indexOf(kind);
      return i >= 0 && cells[i] !== undefined ? cells[i] : '';
    };
    const idCell = pick('id');
    const claimCell = pick('claim');
    let claim = claimCell;
    if (!claim) {
      const candidates = cells
        .map((cell, i) => ({ cell, i }))
        .filter(({ cell, i }) => cell && !['id', 'scope', 'discharge'].includes(kinds[i]));
      candidates.sort((a, b) => b.cell.length - a.cell.length);
      claim = candidates[0]?.cell || '';
    }
    items.push(buildItem({
      id: cleanIdCell(idCell),
      claim,
      scopeText: pick('scope') || full,
      discharge: trimToNull(pick('discharge')),
      full,
      raw: row,
    }));
  }
  return items;
}

function parseListItems(text) {
  const items = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (LIST_ITEM_START.test(line)) {
      if (current) items.push(current);
      current = [line.replace(LIST_ITEM_START, '')];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) items.push(current);
  return items
    .map(block => {
      const raw = block.join('\n').trim();
      return buildItem({ claim: raw.replace(/\n\s*/g, ' '), full: raw.replace(/\n\s*/g, ' '), raw });
    })
    .filter(item => item.claim);
}

function parseItems(text) {
  if (/^\s*\|/m.test(text)) {
    const tableItems = parseTableItems(text);
    if (tableItems.length) return tableItems;
  }
  return parseListItems(text);
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
 * Pick the latest review summary comment from a run's comment list. A "review
 * summary comment" is identified by its TITLE — the first heading line — which
 * must name a review (`review`/`re-review` anywhere, but not a plan review) and
 * whose body must carry a verdict word or the line-start ledger heading.
 * Close-out/autopilot comments are skipped by their title, anchored to the
 * start of the title text, so a review that merely mentions a close-out is not
 * dropped (R1'). Returns null when the trail holds none.
 *
 * @param {Array<{body?: string, createdAt?: string, id?: string}>} comments
 * @returns {Object|null}
 */
export function latestReviewComment(comments) {
  if (!Array.isArray(comments)) return null;
  const reviews = comments.filter(c => {
    const body = c && typeof c.body === 'string' ? c.body : '';
    return isReviewSummary(body);
  });
  if (!reviews.length) return null;
  return reviews.reduce((latest, c) => {
    const a = Date.parse(c?.createdAt || '');
    const b = Date.parse(latest?.createdAt || '');
    if (Number.isNaN(a)) return latest;
    if (Number.isNaN(b)) return c;
    return a >= b ? c : latest;
  });
}

/**
 * Parse one review summary comment into the run-evidence display model.
 * Pure. Tolerant: the ledger is parsed when it is a markdown table or a
 * list; otherwise its text is preserved on `ledger.raw` with `ledger.unparsed`.
 *
 * @param {{body?: string, createdAt?: string, id?: string}|null} comment
 * @returns {RunLedger}
 */
export function parseRunLedger(comment) {
  const body = comment && typeof comment.body === 'string' ? comment.body : '';
  const section = findLedgerSection(body);
  const verdictText = findVerdictText(body);

  const ledger = { present: section.present, empty: false, unparsed: false, items: [], raw: null };
  if (section.present) {
    ledger.raw = section.text || null;
    if (!section.text) {
      ledger.empty = true;
    } else {
      const items = parseItems(section.text);
      if (items.length) {
        ledger.items = items;
      } else if (isEmptyStatement(section.text)) {
        ledger.empty = true;
      } else {
        ledger.unparsed = true;
      }
    }
  }

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

/**
 * Convenience: pick the latest review summary comment from a comment list and
 * parse it. Returns a `parseRunLedger(null)`-shaped model when none exists. It carries no
 * `blindRead` (LIN-4438): its one caller reads the verdict only; the readers that gate on the
 * read attach it themselves (readGateTrail below, for the close-out gate; assembleTrailFacts).
 *
 * @param {Array<Object>} comments
 * @returns {RunLedger}
 */
export function readRunLedger(comments) {
  return parseRunLedger(latestReviewComment(comments));
}

export const PR_URL_RE = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/;

/**
 * The PR the latest review was written about (LIN-3309): the URL named in that
 * review's OWN body, plus its title line, or null when there is no review. The
 * caller uses the URL when present; when the review names only a bare `#1610`, it
 * quotes the title rather than guessing a PR from the other comments.
 *
 * @param {Array<{body?: string, createdAt?: string, id?: string}>} comments
 * @returns {{url: string|null, title: string}|null}
 */
export function latestReviewRef(comments) {
  const review = latestReviewComment(comments);
  if (!review) return null;
  const body = typeof review.body === 'string' ? review.body : '';
  const urlMatch = body.match(PR_URL_RE);
  const titleMatch = body.match(TITLE_LINE);
  return { url: urlMatch ? urlMatch[0] : null, title: titleMatch ? titleMatch[1].trim() : '' };
}

// ─── Comment openings (LIN-4437: moved from lib/recommendation-facts.js) ──────

/** The comment's first non-blank line, trimmed. */
const firstLine = (body) => (String(body || '').split('\n').find(l => l.trim()) || '').trim();

/** A comment's first non-blank line, with leading markdown stripped (one helper with firstLine, LIN-4438). */
export const firstLineOf = (body) => firstLine(body).replace(/^[#>*_\s]+/, '');

/** The heading TEXT of a comment's first heading line (anywhere in it), or '' when it has none. */
export function firstHeading(body) {
  const m = (body || '').match(/^#{1,6}[ \t]+([^\n]*)/m);
  return m ? m[1].trim() : '';
}

/** A close-out's own report: a close-out heading, or a first line that opens with "Close-out". */
export function isCloseOut(body) {
  return /\bclose-?out\b/i.test(firstHeading(body)) || /^close-?out\b/i.test(firstLineOf(body));
}

/**
 * Whether a comment opens with `heading`, matched exactly: its first non-blank line is the
 * heading, then the end of the line or a `:` tail. A longer heading (`## Blind read pilot`) is
 * another heading, and a comment that mentions the heading further down never opens with it
 * (lesson LIN-4414: a check on comment bodies keys on the opening line).
 */
export function opensWithHeading(body, heading) {
  const line = firstLine(body);
  return line.startsWith(heading) && /^(?:$|:)/.test(line.slice(heading.length));
}

/**
 * Whether a comment is a Survey's own report (LIN-4370): it opens with that Survey's heading, then
 * the end of the line, a `:` or a space. `kind` omitted: either Survey. lib/recommendation-look-first.js
 * `isSurveyComment` reads through this.
 */
export function isSurveyReport(body, kind = null) {
  const kinds = kind ? [kind] : Object.keys(SURVEY_HEADINGS);
  const line = firstLine(body);
  return kinds.some((k) => {
    const heading = SURVEY_HEADINGS[k];
    return !!heading && line.startsWith(heading) && /^(?:$|[:\s])/.test(line.slice(heading.length));
  });
}

// ─── The blind read (LIN-4437, piece 2 of LIN-4396) ──────────────────────────

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

/** Whether a comment is a blind read: it opens with `## Blind read` (exactly; see opensWithHeading). */
export function isBlindRead(body) {
  return opensWithHeading(body, BLIND_READ_HEADING);
}

/**
 * The PRs of the current landing (LIN-4396's "which landing is current", one owner). Every
 * consumer imports it: the blind-read prompt and the proxy's shape check today, the route,
 * both readiness lanes and measure 1 in pieces 3 and 4. Never narrowed in a caller.
 *
 * 1. The anchor is the latest close-out report (`isCloseOut`, and not itself a review) that
 *    comes before the latest code review. With no review, or no such close-out, it is the start
 *    of the trail.
 * 2. The landing is every full PR URL carried by any comment after the anchor, in the order they
 *    first appear: the review, implementation summaries, link comments and close-out reports
 *    alike. A close-out after the latest review is an attempt on this landing, never a new one,
 *    so it never resets scope.
 *
 * Two kinds of comment never carry the landing, so their URLs are not counted (the LIN-4396
 * builder note 1 decision, LIN-4437): a blind read (it names the landing; counting it would let
 * a read of an older PR make that PR current), and a Survey report (a forecast written before
 * work starts, which may cite earlier PRs by full URL). Not narrowed by repository: no caller
 * holds the task's repository, and an earlier PR of the same repository is the common stray
 * URL. A research note, plan or person's comment before the review that cites another PR by
 * full URL still joins a first landing; that residual is the shared-trail row piece 3 adds.
 *
 * @param {Array<{body?: string, createdAt?: string}>} comments
 * @returns {string[]}
 */
export function landingPrUrls(comments) {
  const sorted = byTime(comments);
  const review = latestReviewComment(sorted);
  let anchor = -1;
  if (review) {
    const at = sorted.indexOf(review);
    for (let i = 0; i < at; i++) {
      if (isCloseOut(sorted[i].body) && !isReviewSummary(sorted[i].body)) anchor = i;
    }
  }
  const urls = [];
  for (const c of sorted.slice(anchor + 1)) {
    if (isBlindRead(c.body) || isSurveyReport(c.body)) continue;
    for (const url of prUrlsIn(c.body)) if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

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
 * Check a comment body's blind-read shape (LIN-4437). PURE. It acts only on a blind read (a body
 * that opens with the heading); every other comment, a review verdict that mentions the heading
 * further down included, passes untouched (`applies: false`). A read needs:
 *   - exactly one verdict line, its first word one of the three words, then a reason;
 *   - at least one full PR URL, and, when `landing` is given, exactly the landing's PRs: no fewer
 *     and no extras. `landing` null (the trail could not be read) skips only that set check.
 *
 * @param {string} body
 * @param {{landing?: string[]|null}} [options]
 * @returns {{ok: true, applies: false}
 *   | {ok: true, applies: true, verdict: string, reason: string, prs: string[], setChecked: boolean}
 *   | {ok: false, code: string, line?: {number: number, text: string}, expected?: string[], got?: string[]}}
 */
export function checkBlindRead(body, { landing = null } = {}) {
  if (!isBlindRead(body)) return { ok: true, applies: false };
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

/**
 * One comment as a blind read, or null when it is not one or its shape does not hold (no landing
 * set check: the read is judged as it stands on the trail).
 * @param {{body?: string, createdAt?: string, id?: string, commentId?: string}|null} comment
 * @returns {BlindRead|null}
 */
export function parseBlindRead(comment) {
  const body = comment && typeof comment.body === 'string' ? comment.body : '';
  const check = checkBlindRead(body);
  if (!check.ok || !check.applies) return null;
  return {
    verdict: check.verdict,
    reason: check.reason,
    prs: check.prs,
    at: comment.createdAt || null,
    commentId: comment.id || comment.commentId || null
  };
}

/**
 * The latest blind read on record, read over the whole trail (LIN-4396 builder note 4): the newest
 * well-formed read posted after `reviewComment`, or anywhere on the trail when there is no review.
 * @param {Array<Object>} comments
 * @param {Object|null} [reviewComment] - the latest review comment (latestReviewComment), or null
 * @returns {BlindRead|null}
 */
export function latestBlindRead(comments, reviewComment = null) {
  const sorted = byTime(comments);
  const from = reviewComment ? sorted.indexOf(reviewComment) : -1;
  const reviewAt = reviewComment ? Date.parse(reviewComment.createdAt || '') : NaN;
  for (let i = sorted.length - 1; i > from; i--) {
    const c = sorted[i];
    // A review passed in from another list (not this array's object) is placed by its time.
    if (from === -1 && reviewComment && !(Date.parse(c.createdAt || '') > reviewAt)) continue;
    const read = parseBlindRead(c);
    if (read) return read;
  }
  return null;
}

/**
 * What the trail says about the gate (LIN-4438), read once from comments already in hand: the
 * latest review's ledger carrying the latest blind read after it (null when no review is on
 * record, LIN-3497: readRunLedger would parse "no comment" into a non-null 'unknown'), and the
 * current landing's PRs. lib/close-out-readiness.js reads it for the stop-at chain and the ladder
 * lane, so both read one way.
 * @param {Array<Object>} comments
 * @returns {{ledger: Object|null, landingPrs: string[]}}
 */
export function readGateTrail(comments) {
  const reviewComment = latestReviewComment(comments);
  const ledger = reviewComment ? { ...parseRunLedger(reviewComment), blindRead: latestBlindRead(comments, reviewComment) } : null;
  return { ledger, landingPrs: landingPrUrls(comments) };
}
