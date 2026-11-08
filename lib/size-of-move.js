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
 * What a record says (RECORD_PARTS): the chosen size in plain words and why; the sizes
 * weighed, as one-line bullets on what each buys this task; the extra and when it may stop,
 * if larger; its cuts to the ask, or none (CUT says how a cut is quoted and ruled, so this
 * list does not restate it); open questions, or none; who decided. Two of those are lines
 * code reads: `**Size:** <one of SIZES>` and `**Decided by:** <one of DECIDED_BY>`.
 *
 * What the check refuses (checkSizeRecord), only when a write adds or changes the section:
 *   - SIZE_RECORD_HOW: a file path, a code span, call syntax, or a numbered step in the
 *     section. A quotation ("…", “…” or a `>` line) that matches the As-asked block word for
 *     word is exempt, so a record can quote a cut whose words hold a code span or a path.
 *   - SIZE_RECORD_POLICY_CUT: the standing policy deciding "wrong work". A policy never
 *     answers a cut; that needs a ruling. (A partial cut is not visible to code; CUT and
 *     review catch those.)
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

/** What a record says, in order, for the prompt that writes one. */
export const RECORD_PARTS = Object.freeze([
  'the chosen size in plain words, and why',
  'the sizes weighed, as one-line bullets on what each buys this task',
  'the extra, and when it may stop, if larger than the task',
  'its cuts to the ask, or none',
  'open questions, or none',
  'who decided'
]);

/** The standing policy values (`sizePolicy`); `ask` is the default and means no standing policy. */
export const SIZE_POLICIES = Object.freeze(['ask', 'err-larger']);
export const DEFAULT_SIZE_POLICY = 'ask';

/** The refusal codes the proxy answers with (documented in lib/proxy-instructions.js). */
export const SIZE_RECORD_CODES = Object.freeze({
  how: 'SIZE_RECORD_HOW',
  policyCut: 'SIZE_RECORD_POLICY_CUT',
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
  return { ok: true };
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
