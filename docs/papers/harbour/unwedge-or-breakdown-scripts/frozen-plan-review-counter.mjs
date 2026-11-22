// The plan-review verdict counter this paper's readings were taken with (LIN-3932), frozen here (LIN-4520).
//
// Harbour's lib/recommendation-facts.js assemblePlanReviewFacts was retired with the comment verdict paths: verdicts are
// records now. The paper's comment readings (census, classify, analyse) still count plan-review verdicts from comments, as
// they did when the numbers were taken, so the rule is kept here and no longer shared with live code. It is the pre-retirement
// rule: a comment is a plan-review verdict when its first heading is the plan-review heading (the contract heading or the
// legacy `plan-review` title), and its verdict word is the one the contract or the legacy heading carries.
//
// Returns the same two fields the paper reads: `verdicts` (count of verdicts in time order) and `count` (Request Changes
// and Needs Discussion since the latest Approve; only an Approve resets it).

// Nothing here is imported from live code (finding-d95fb57b). The person and landed-work text rules below are the
// trail-rules module as it stood at commit 2d0b71414, before LIN-4520 took the verdict-word branch out of
// `reportsLandedWork`, copied with the helpers they need (the PR URL reader, the Harbour summary mark, the Survey and
// blind-read headings, the ruling mark). Do not "fix" them to match live code:
// they are what the paper's numbers were counted with.

const PR_URL_ALL = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g;
const prUrlsIn = (body) => [...new Set(String(body || '').match(PR_URL_ALL) || [])];

const SUMMARY_LEAD = '**Harbour summary** · ';
const BLIND_READ_HEADING = '## Blind read';
const SURVEY_HEADINGS = { 'survey-task': '## Survey open-0', 'survey-place': '## Survey global' };
const AREA_READ_HEADING = '## Area read';
const RULING_MARK = '— Ruling recorded via Harbour';
const REPORT_TAIL = /^(?:$|[:\s])/;

const firstLine = (body) => (String(body || '').split('\n').find((l) => l.trim()) || '').trim();
const firstLineOf = (body) => firstLine(body).replace(/^[#>*_\s]+/, '');
const firstHeading = (body) => {
  const m = (body || '').match(/^#{1,6}[ \t]+([^\n]*)/m);
  return m ? m[1].trim() : '';
};
const bodyOf = (comment) => (typeof comment === 'string' ? comment : (comment && typeof comment.body === 'string' ? comment.body : ''));

function opensWithHeading(body, heading, tail = /^(?:$|:)/) {
  const line = firstLine(body);
  return line.startsWith(heading) && tail.test(line.slice(heading.length));
}

const isHarbourSummary = (comment) => firstLine(bodyOf(comment)).startsWith(SUMMARY_LEAD);

const TITLE_NON_REVIEW = /^(?:close-?out|autopilot)\b/i;
const TITLE_PLAN_REVIEW = /plan[-\s]+review/i;
const TITLE_NAMES_REVIEW = /\breview\b/i;
const VERDICT_WORD = /\b(?:approve[sd]?|request(?:ed)?\s+changes?|needs?\s+discussion)\b/i;
const LEDGER_HEADING = /^###\s*What CI Did Not Prove\b[^\n]*/im;

function opensAsReview(body) {
  const title = firstHeading(body);
  if (!title || TITLE_NON_REVIEW.test(title)) return false;
  if (!TITLE_NAMES_REVIEW.test(title) || TITLE_PLAN_REVIEW.test(title)) return false;
  return VERDICT_WORD.test(body) || LEDGER_HEADING.test(body);
}

const AGENT_NOTE_OPENING = /^(?:autopilot\b|plan\s+(?:posted|revis\w*)\b|revision\s+\d+\s*[—–-]\s*addresses plan-review)/i;
const opensAsAgentNote = (body) => AGENT_NOTE_OPENING.test(firstLineOf(body));
const opensAsPlanReview = (body) => PLAN_REVIEW_HEADINGS.some((re) => re.test(firstHeading(body)));
const opensAsCloseOut = (body) => /\bclose-?out\b/i.test(firstHeading(body)) || /^close-?out\b/i.test(firstLineOf(body));
const opensAsSurveyOrAreaRead = (body) => opensWithHeading(body, SURVEY_HEADINGS['survey-task'], REPORT_TAIL)
  || opensWithHeading(body, SURVEY_HEADINGS['survey-place'], REPORT_TAIL)
  || opensWithHeading(body, AREA_READ_HEADING, REPORT_TAIL);
const opensAsBlindRead = (body) => opensWithHeading(body, BLIND_READ_HEADING) && !isHarbourSummary(body) && !opensAsCloseOut(body) && !opensAsReview(body);

function isRuling(comment) {
  const text = bodyOf(comment).trimEnd();
  return text.endsWith(RULING_MARK) && !opensAsAgentNote(text);
}

/** Pre-retirement: a review-titled comment carrying a verdict word reports landed work (the branch LIN-4520 removed). */
function reportsLandedWork(comment) {
  const body = bodyOf(comment);
  if (isHarbourSummary(body)) return false;
  if (opensAsReview(body)) return true;
  if (opensAsCloseOut(body)) return prUrlsIn(body).length > 0;
  if (opensAsBlindRead(body) || opensAsSurveyOrAreaRead(body) || opensAsAgentNote(body)) return false;
  return prUrlsIn(body).length > 0;
}

function isPersonComment(comment) {
  const body = bodyOf(comment);
  if (isHarbourSummary(body)) return false;
  if (isRuling(body)) return true;
  if (/^#{1,6}[ \t]/.test(firstLine(body))) return false;
  if (opensAsAgentNote(body) || opensAsPlanReview(body) || opensAsCloseOut(body) || opensAsReview(body)) return false;
  return !reportsLandedWork(body);
}

const VERDICT_TOKEN = /\b(approve|request changes|needs discussion)\b/i;
// The reviewer's own count: `Blocking findings: <n>` on its own line (the pre-retirement reader's rule).
const BLOCKING_FINDINGS_RE = /^[^\w\n]*Blocking findings[^\w\n]*(\d+)/im;
const VERDICT_WORD_RE = /\b(approve[sd]?|request(?:ed)?\s+changes?|needs?\s+discussion)\b/i;
const PLAN_REVIEW_HEADINGS = [/^Plan Review Verdict\b/i, /^plan[-\s]+review\b/i];

function firstHeadingOf(body) {
  const m = String(body || '').match(/^#{1,6}[ \t]+([^\n]*)/m);
  return m ? m[1].trim() : '';
}

/** The verdict word of a body, as the pre-retirement extractVerdict read it: a token near each `verdict`, in order. */
function extractVerdict(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const m of text.matchAll(/verdict/gi)) {
    const start = m.index;
    const end = start + m[0].length;
    const window = text.slice(Math.max(0, start - 80), end + 120);
    const token = VERDICT_TOKEN.exec(window);
    if (token) return token[1].toLowerCase().replace(/\s+/g, ' ').trim();
  }
  return null;
}

function normalize(token) {
  if (!token) return null;
  const t = String(token).toLowerCase();
  if (/approve/.test(t)) return 'approve';
  if (/request\s+changes?/.test(t)) return 'request changes';
  if (/needs?\s+discussion/.test(t)) return 'needs discussion';
  return null;
}

/** The verdict a comment carries, or null when it is not a plan-review verdict. */
export function planReviewVerdictOfBody(body) {
  const heading = firstHeadingOf(body);
  if (!PLAN_REVIEW_HEADINGS.some((re) => re.test(heading))) return null;
  const firstLine = (String(body || '').split('\n').find((l) => l.trim()) || '').trim();
  return normalize(extractVerdict(body)) || normalize((firstLine.match(VERDICT_WORD_RE) || [])[0]);
}

/**
 * @param {Array<{body?: string, createdAt?: string}>} comments
 * @returns {{verdicts: number, count: number, latestVerdict: string|null, run: Array<{verdict: string, blocking: number|null}>,
 *   personSince: boolean, landed: string|null}}
 */
export function countPlanReviewVerdicts(comments = []) {
  const sorted = [...comments].filter((c) => c && typeof c.body === 'string')
    .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
  const verdicts = [];
  sorted.forEach((c, index) => {
    const verdict = planReviewVerdictOfBody(c.body);
    if (!verdict) return;
    const n = Number((String(c.body).match(BLOCKING_FINDINGS_RE) || [])[1]);
    const blocking = verdict === 'request changes' && Number.isInteger(n) && n >= 1 ? n : null;
    verdicts.push({ verdict, index, blocking });
  });
  const verdictWords = verdicts.map((v) => v.verdict);
  const lastApprove = verdictWords.lastIndexOf('approve');
  const latest = verdicts[verdicts.length - 1] || null;
  const since = latest ? sorted.slice(latest.index + 1) : [];
  const landedComment = since.find((c) => reportsLandedWork(c.body));
  return {
    verdicts: verdicts.length,
    count: verdicts.length - 1 - lastApprove,
    latestVerdict: latest ? latest.verdict : null,
    run: verdicts.slice(lastApprove + 1).map((v) => ({ verdict: v.verdict, blocking: v.blocking })),
    personSince: since.some((c) => isPersonComment(c.body)),
    landed: landedComment ? (prUrlsIn(landedComment.body)[0] || 'a code review') : null,
  };
}
