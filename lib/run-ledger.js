// Run-ledger reader (LIN-3247, P2 of LIN-2949).
//
// A PURE reader — no I/O, no clock, no store — that turns a run's latest
// review summary comment into the display model the evidence fragments render:
// the verdict (plain Approve vs the conditional form vs a non-approve), the
// review's CI line verbatim, the comment time and the commit sha it carries,
// and the `### What CI Did Not Prove` ledger as items each carrying its
// inside/outside mark, discharge route, discharged-by evidence and any
// follow-up link. An explicitly empty ledger is a distinct, representable
// state; a section the parser cannot structure is preserved verbatim as
// `ledger.raw` and flagged `ledger.unparsed` — never flattened, never dropped.
//
// This reader does not write and does not change the `### What CI Did Not
// Prove` heading, so `lib/follow-on-ratio.js`'s marker (the same literal) is
// untouched.

// The heading literal is load-bearing: `lib/follow-on-ratio.js:161` keys its
// review-ledger marker on exactly this string. Read it, never rewrite it.
const LEDGER_HEADING = /###\s*What CI Did Not Prove\b[^\n]*/i;

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
  return m ? m[1].toLowerCase() : 'unknown';
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

function buildItem({ id, claim, scopeText, discharge, full, raw }) {
  const text = full || '';
  return {
    id: id || extractId(claim) || null,
    claim: cleanClaim(claim || text),
    scope: extractScope(scopeText || text),
    discharge: discharge || extractDischarge(text),
    dischargedBy: extractDischargedBy(text),
    discharged: /\bdischarged\b/i.test(text),
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
 * summary comment" is one carrying the `### What CI Did Not Prove` ledger or an
 * explicit Approve / Request Changes / Needs Discussion verdict — the two
 * template-emitted markers (see `lib/prompt-template-defs.js`). Returns null
 * when the trail holds none.
 *
 * @param {Array<{body?: string, createdAt?: string, id?: string}>} comments
 * @returns {Object|null}
 */
export function latestReviewComment(comments) {
  if (!Array.isArray(comments)) return null;
  const reviews = comments.filter(c => {
    const body = c && typeof c.body === 'string' ? c.body : '';
    return LEDGER_HEADING.test(body)
      || /\b(Approve|Request Changes|Needs Discussion)\b/i.test(body);
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
 * parse it. Returns a `parseRunLedger(null)`-shaped model when none exists.
 *
 * @param {Array<Object>} comments
 * @returns {RunLedger}
 */
export function readRunLedger(comments) {
  return parseRunLedger(latestReviewComment(comments));
}
