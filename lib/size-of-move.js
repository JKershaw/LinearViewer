/**
 * The size of the move (LIN-4346 piece 2, LIN-4368): the one record on a ticket of how big
 * a move the work makes, and why. This module is the ONE place its vocabulary is spelled
 * out. The scoping prompt, the selector's facts line, the proxy guard, the look-first code
 * route and close-out's prune all import from here; none keeps a second spelling.
 *
 * Why it exists. The hand-off scope behind the first week's mistakes said *how* (Finding 9 in
 * docs/papers/harbour/cleaner-than-it-started.md): wording a builder copied, a sweep drawn
 * around a list of names, a description turned into a comment that was not true. So the
 * record says what and why only, and code (checkSizeRecord, run by the proxy) holds that line,
 * not only prompt wording. How big the move is stays a person's call: a ruling, or the
 * workspace's standing policy (`sizePolicy`, lib/workspace-preferences.js).
 *
 * Where it lives. One `## Size of the move` section in the description, outside the
 * `## As asked` block (outsideAsAsked). Never in comments: John's hand-written
 * `## Size of the move (the person's call)` comments are rulings scoping reads, not records,
 * so the parser never looks at comments, and only the exact heading line opens a section.
 * A section runs from its heading line to the next level-1 or level-2 heading, or the end;
 * `###` sub-headings stay inside it.
 *
 * What a record says (RECORD_LINES, LIN-4369 arm 3): four labelled lines and nothing else, so
 * how has nowhere to go (John's structural ruling, decision `lin4346-size-after-arm2`):
 *   **Size:** one of SIZES
 *   **Why:** one sentence, at most WHY_MAX_WORDS words
 *   **Cuts:** none, or each cut to the ask on its own bullet line below it (CUT says how a
 *             cut is quoted and ruled; this module only checks that each bullet holds a
 *             quotation of the ask and little else)
 *   **Decided by:** one of DECIDED_BY, optionally with a few words of who and when
 * Two replay arms with a free-form record (PR #2356) showed the how moving into whatever room
 * the record left: lists and code spans first, then plain-word definitions. The shape is held
 * by code (SIZE_RECORD_SHAPE), not only by prompt wording.
 *
 * What the check refuses (checkSizeRecord), only when a write adds or changes the section,
 * in this order:
 *   - SIZE_RECORD_HOW: a file path, a code span, call syntax, or a numbered step in the
 *     section. A quotation ("…", “…” or a `>` line) that matches the As-asked block word for
 *     word is exempt, so a record can quote a cut whose words hold a code span or a path.
 *   - SIZE_RECORD_POLICY_CUT: the standing policy deciding "wrong work". A policy never
 *     answers a cut; that needs a ruling. (A partial cut is not visible to code; CUT and
 *     review catch those.)
 *   - SIZE_RECORD_SHAPE: any line that is not one of the four, a line missing, repeated or out
 *     of order, a size outside SIZES, a why longer than one sentence or WHY_MAX_WORDS words, a
 *     cut bullet without a quotation of the ask or with more than CUT_MAX_OTHER_WORDS words
 *     beside it, or a decided-by outside DECIDED_BY.
 *   - SIZE_RECORD_DROPPED: a write that drops an existing section rather than replacing it.
 * An unchanged older section never blocks an unrelated write.
 */
import { normalizeEscaping } from './description-edit.js';
import { outsideAsAsked, splitAsAsked } from './as-asked.js';

export const SIZE_OF_MOVE_HEADING = '## Size of the move';

/** The closed list of sizes, smallest first; "wrong work" says the ticket should not be built as asked. */
export const SIZES = Object.freeze([
  'just the task',
  'a small tidy',
  'consolidate the decision this task touches',
  'rebuild the area',
  'wrong work'
]);
export const WRONG_WORK = SIZES[SIZES.length - 1];

/** Who decided: the record's `**Decided by:**` value starts with one of these. */
export const DECIDED_BY = Object.freeze({
  ruling: 'a ruling',
  policy: 'the standing policy',
  pending: 'pending a ruling'
});

/** The two lines code reads in a record. */
export const SIZE_LABEL = 'Size';
export const DECIDED_BY_LABEL = 'Decided by';
/** The record's other two lines (LIN-4369 arm 3). */
export const WHY_LABEL = 'Why';
export const CUTS_LABEL = 'Cuts';
/** The Cuts value for a record that cuts nothing. */
export const NO_CUTS = 'none';

/** The why is one sentence of at most this many words. */
export const WHY_MAX_WORDS = 40;
/** Beside its quotation of the ask, a cut bullet carries at most this many words (its ruling). */
export const CUT_MAX_OTHER_WORDS = 15;
/** After its DECIDED_BY value, the decided-by line carries at most this many words (who, when). */
export const DECIDED_BY_MAX_OTHER_WORDS = 8;

/** The record's lines, in order; a record holds these and nothing else. */
export const RECORD_LINES = Object.freeze([SIZE_LABEL, WHY_LABEL, CUTS_LABEL, DECIDED_BY_LABEL]);

/** What each line holds, for the prompt that writes one (rendered by recordShape). */
export const RECORD_PARTS = Object.freeze({
  [SIZE_LABEL]: `one of: ${SIZES.join(' / ')}`,
  [WHY_LABEL]: `one sentence, at most ${WHY_MAX_WORDS} words: what this size delivers and why`,
  [CUTS_LABEL]: `${NO_CUTS}, or each cut to the ask on its own bullet line below`,
  [DECIDED_BY_LABEL]: Object.values(DECIDED_BY).join(' / ')
});

/** The record's shape, one `**Label:** what it holds` line each, in order. */
export function recordShape() {
  return RECORD_LINES.map((label) => `**${label}:** ${RECORD_PARTS[label]}`);
}

/** The standing policy values (`sizePolicy`); `ask` is the default and means no standing policy. */
export const SIZE_POLICIES = Object.freeze(['ask', 'err-larger']);
export const DEFAULT_SIZE_POLICY = 'ask';

/** The refusal codes the proxy answers with (documented in lib/proxy-instructions.js). */
export const SIZE_RECORD_CODES = Object.freeze({
  how: 'SIZE_RECORD_HOW',
  policyCut: 'SIZE_RECORD_POLICY_CUT',
  shape: 'SIZE_RECORD_SHAPE',
  dropped: 'SIZE_RECORD_DROPPED'
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A line's comparable form: trailing `\r` dropped, backslash escapes removed. */
const lineForm = (line) => normalizeEscaping(line.endsWith('\r') ? line.slice(0, -1) : line);
const isSectionEnd = (form) => /^#{1,2}\s/.test(form);

/**
 * Every `## Size of the move` section in `text`, each as its lines in comparable form
 * (heading first). Normally there is one; a second is still a section, so the check reads it.
 *
 * @param {string} text
 * @returns {string[][]}
 */
function sectionsOf(text) {
  const out = [];
  let current = null;
  for (const raw of String(text || '').split('\n')) {
    const form = lineForm(raw);
    if (form.trimEnd() === SIZE_OF_MOVE_HEADING) {
      current = [form.trimEnd()];
      out.push(current);
      continue;
    }
    if (current && isSectionEnd(form)) current = null;
    if (current) current.push(form);
  }
  // A section's trailing blank lines are spacing, not content.
  for (const lines of out) while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop();
  return out;
}

const labelValue = (lines, label) => {
  const re = new RegExp(`^\\s*(?:[-*]\\s+)?\\**${label}:?\\**:?\\s*(.*)$`, 'i');
  for (const line of lines) {
    const m = line.match(re);
    if (m) return m[1].replace(/\*+/g, '').trim();
  }
  return null;
};

const startsWithAny = (value, list) => {
  const v = (value || '').toLowerCase();
  return list.find((w) => v.startsWith(w)) || null;
};

/**
 * The size record on a description, or null when none is recorded. Reads only the text
 * outside the `## As asked` block; comments are never passed here and never read.
 *
 * @param {string|null|undefined} description
 * @returns {null | {
 *   size: string|null,                                   // one of SIZES, or null when the line is missing or names none
 *   decidedBy: 'ruling'|'policy'|'pending'|null,
 *   lines: string[]                                      // the section's lines in comparable form, heading first
 * }}
 */
export function readSizeRecord(description) {
  const [lines] = sectionsOf(outsideAsAsked(description));
  return lines ? recordOf(lines) : null;
}

/** One section's lines read as a record (see readSizeRecord). */
function recordOf(lines) {
  const by = startsWithAny(labelValue(lines, DECIDED_BY_LABEL), Object.values(DECIDED_BY));
  return {
    size: startsWithAny(labelValue(lines, SIZE_LABEL), SIZES),
    decidedBy: by ? Object.keys(DECIDED_BY).find((k) => DECIDED_BY[k] === by) : null,
    lines
  };
}

/**
 * The selector's facts-line value for a record: "not recorded", "pending a ruling", or
 * "chosen <size> (by <who>)".
 *
 * @param {ReturnType<typeof readSizeRecord>} record
 * @returns {string}
 */
export function sizeFact(record) {
  if (!record) return 'not recorded';
  if (record.decidedBy === 'pending') return DECIDED_BY.pending;
  const who = record.decidedBy ? DECIDED_BY[record.decidedBy] : 'no one named';
  return record.size ? `chosen ${record.size} (by ${who})` : `recorded, with no size named (by ${who})`;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const squash = (text) => normalizeEscaping(String(text || '')).replace(/\s+/g, ' ').trim();

// Each "how" pattern, in the order a refusal names them. A pattern returns the token it found.
const PATH_PATTERNS = [
  // dir/file.ext, ./x/y.js, /abs/path.md, with or without a :line suffix
  /(?:^|[\s("'[])((?:\.{1,2}\/|\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z]\w{0,5})\b/,
  // a/b/c (two or more slashes, no extension needed)
  /(?:^|[\s("'[])((?:[\w@.-]+\/){2,}[\w@.-]*)/,
  // a bare file name with a source or doc extension
  /\b([\w-]+\.(?:m?js|cjs|tsx?|jsx|json|md|ya?ml|css|html?|py|sh|sql))\b/
];
// A dotted chain or a camelCase/snake_case name followed directly by "(", or any name followed by "()".
// Prose like "size(s)" or "the task (as asked)" is not call syntax.
const CALL_PATTERN = /(?:^|[^\w$.])((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|[a-z_$][\w$]*[A-Z_][\w$]*)\(|[A-Za-z_$][\w$]*\(\))/;
const NUMBERED_STEP = /^\s*(?:[-*+]\s+)?(\d+[.)])\s+\S/;
const INLINE_STEPS = /(?:^|\s)(1[.)]\s.*\s2[.)])\s/;

function howIn(text) {
  const tick = text.indexOf('`');
  if (tick !== -1) {
    const close = text.indexOf('`', tick + 1);
    return { kind: 'code-span', token: close === -1 ? text.slice(tick) : text.slice(tick, close + 1) };
  }
  for (const re of PATH_PATTERNS) {
    const m = text.match(re);
    if (m) return { kind: 'path', token: m[1] };
  }
  const call = text.match(CALL_PATTERN);
  if (call) return { kind: 'call', token: call[1] };
  const step = text.match(NUMBERED_STEP) || text.match(INLINE_STEPS);
  if (step) return { kind: 'numbered-steps', token: step[1] };
  return null;
}

/**
 * The line with every quotation that matches the ask word for word taken out: a `>` line
 * whose text is in the ask, and any "…" or “…” span whose text is. What is left is checked.
 */
function withoutAskQuotes(line, ask) {
  if (!ask) return line;
  const inAsk = (q) => {
    const t = squash(q);
    return t.length > 0 && ask.includes(t);
  };
  const quoted = line.match(/^\s*>\s?(.*)$/);
  if (quoted && inAsk(quoted[1])) return '';
  return line.replace(/"([^"\n]+)"|“([^”\n]+)”/g, (m, a, b) => (inAsk(a ?? b) ? ' ' : m));
}

const joined = (sections) => sections.map((lines) => lines.map((l) => l.trimEnd()).join('\n')).join('\n\n');

/**
 * Check a description write against the size record rules. `live` is what the provider
 * holds now, `next` what the write would store. Acts only when the write adds or changes a
 * section (or drops one); an unchanged older section never blocks an unrelated write.
 *
 * @param {string|null|undefined} live
 * @param {string|null|undefined} next
 * @returns {{ ok: true } | {
 *   ok: false,
 *   code: string,                                  // one of SIZE_RECORD_CODES
 *   kind?: 'code-span'|'path'|'call'|'numbered-steps',
 *   token?: string,                                // what was found
 *   line?: { number: number, text: string }        // 1-based within the section, heading = 1
 * }}
 */
export function checkSizeRecord(live, next) {
  const before = sectionsOf(outsideAsAsked(live));
  const after = sectionsOf(outsideAsAsked(next));
  if (before.length && !after.length) return { ok: false, code: SIZE_RECORD_CODES.dropped };
  if (!after.length || joined(before) === joined(after)) return { ok: true };

  const parts = splitAsAsked(next);
  const ask = parts ? squash(parts.words) : '';
  for (const lines of after) {
    for (let i = 1; i < lines.length; i++) {
      const found = howIn(withoutAskQuotes(lines[i], ask));
      if (found) return { ok: false, code: SIZE_RECORD_CODES.how, ...found, line: { number: i + 1, text: lines[i] } };
    }
  }
  // Every section, not only the first: a second section must not carry a policy-decided cut past the check.
  for (const lines of after) {
    const record = recordOf(lines);
    if (record.size === WRONG_WORK && record.decidedBy === 'policy') {
      return { ok: false, code: SIZE_RECORD_CODES.policyCut };
    }
  }
  // A cut quotes the ask: the sealed block, or on an unsealed ticket the description outside the record.
  const quotable = ask || squash(outsideSections(next));
  for (const lines of after) {
    const found = shapeProblem(lines, quotable);
    if (found) return { ok: false, code: SIZE_RECORD_CODES.shape, ...found };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The shape (LIN-4369 arm 3)
// ---------------------------------------------------------------------------

/** `text` with every size section taken out. */
function outsideSections(text) {
  const out = [];
  let inside = false;
  for (const raw of String(text || '').split('\n')) {
    const form = lineForm(raw);
    if (form.trimEnd() === SIZE_OF_MOVE_HEADING) { inside = true; continue; }
    if (inside && isSectionEnd(form)) inside = false;
    if (!inside) out.push(form);
  }
  return out.join('\n');
}

const words = (text) => (String(text).match(/\S+/g) || []).length;
const LABEL_LINE = new RegExp(`^\\s*\\**(${RECORD_LINES.join('|')})\\s*\\**\\s*:\\s*\\**\\s*(.*)$`, 'i');
const CUT_BULLET = /^\s*[-*+]\s+(.*)$/;
// A sentence ends at . ! ? or ; followed by more text: the why is one plain sentence.
const SENTENCE_BREAK = /[.!?;]["”')\]]*\s+\S/;
// Abbreviations whose full stop does not end a sentence.
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|cf)\./gi;

/** The label a line opens, in RECORD_LINES' spelling, and its value; null for any other line. */
function labelled(line) {
  const m = line.match(LABEL_LINE);
  if (!m) return null;
  const label = RECORD_LINES.find((l) => l.toLowerCase() === m[1].toLowerCase());
  return { label, value: m[2].replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim() };
}

/** What is wrong with a cut (an inline Cuts value or one bullet), or null. */
function cutProblem(text, quotable) {
  const t = text.trim();
  const quotes = [...t.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g)].map((m) => m[1] ?? m[2]);
  const fromAsk = quotes.filter((q) => { const sq = squash(q); return sq.length > 0 && quotable.includes(sq); });
  if (!fromAsk.length) return 'cut-unquoted';
  const rest = t.replace(/"([^"\n]+)"|“([^”\n]+)”/g, (m, a, b) => (fromAsk.includes(a ?? b) ? ' ' : m));
  return words(rest.replace(/[^\w\s'’]/g, ' ')) > CUT_MAX_OTHER_WORDS ? 'cut-too-long' : null;
}

/**
 * The first way one section's lines break the record's shape, or null. Lines are numbered as
 * checkSizeRecord numbers them (1-based within the section, heading = 1).
 */
function shapeProblem(lines, quotable) {
  const at = (i, problem) => ({ kind: problem, line: { number: i + 1, text: lines[i] } });
  let next = 0;            // index in RECORD_LINES of the line expected next
  let inCuts = false;      // cut bullets are allowed only straight under the Cuts line
  let emptyCuts = -1;      // the index of a Cuts line with no value, until a bullet fills it
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const l = labelled(line);
    if (!l) {
      if (inCuts && CUT_BULLET.test(line)) {
        const problem = cutProblem(line.match(CUT_BULLET)[1], quotable);
        if (problem) return at(i, problem);
        emptyCuts = -1;
        continue;
      }
      return at(i, 'extra-line');
    }
    if (emptyCuts !== -1) return at(emptyCuts, 'cuts-empty');
    const want = RECORD_LINES.indexOf(l.label);
    if (want < next) return at(i, 'repeated-line');
    if (want > next) return { kind: 'missing-line', missing: RECORD_LINES[next], line: { number: i + 1, text: line } };
    next++;
    inCuts = false;
    const value = l.value.replace(/[.\s]+$/, '');
    if (l.label === SIZE_LABEL && !SIZES.includes(value.toLowerCase())) return at(i, 'size');
    if (l.label === WHY_LABEL) {
      if (!value) return at(i, 'why-empty');
      if (words(value) > WHY_MAX_WORDS) return at(i, 'why-too-long');
      if (SENTENCE_BREAK.test(value.replace(ABBREVIATION, ''))) return at(i, 'why-sentences');
    }
    if (l.label === CUTS_LABEL) {
      if (value === '') { inCuts = true; emptyCuts = i; }
      else if (value.toLowerCase() !== NO_CUTS) {
        const problem = cutProblem(l.value, quotable);
        if (problem) return at(i, problem);
        inCuts = true;
      }
    }
    if (l.label === DECIDED_BY_LABEL) {
      const by = startsWithAny(value, Object.values(DECIDED_BY));
      if (!by) return at(i, 'decided-by');
      if (words(value.slice(by.length).replace(/[^\w\s'’:]/g, ' ')) > DECIDED_BY_MAX_OTHER_WORDS) return at(i, 'decided-by-too-long');
    }
  }
  if (emptyCuts !== -1) return at(emptyCuts, 'cuts-empty');
  if (next < RECORD_LINES.length) return { kind: 'missing-line', missing: RECORD_LINES[next], line: { number: lines.length, text: lines[lines.length - 1] } };
  return null;
}

// ---------------------------------------------------------------------------
// The standing policy, as the scoping prompt reads it
// ---------------------------------------------------------------------------

/** The policy's meaning, in John's words of 7 Nov 22:18 (LIN-4346). */
const POLICY_MEANING = {
  'err-larger': 'err larger: take the larger move when the look shows it pays, and when in doubt; it does not mean inflating every ticket, and a small, clear ticket stays just the task'
};

/**
 * The line the scoping prompt carries about the standing policy. `policy` is what
 * loadSizePolicy returns (or undefined on a path that has none): `ask`, a missing policy and
 * an unknown value all read as no standing policy.
 *
 * @param {{ value?: string, setAt?: string|null }|null|undefined} policy
 * @returns {string}
 */
export function formatSizePolicyLine(policy) {
  const meaning = POLICY_MEANING[policy?.value];
  if (!meaning) return '**Standing size policy:** no standing policy; the size of the move is a person\'s ruling.';
  const when = policy.setAt ? ` (set ${String(policy.setAt).slice(0, 10)})` : '';
  return `**Standing size policy:** ${meaning}${when}.`;
}
