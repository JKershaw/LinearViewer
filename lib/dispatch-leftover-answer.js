/**
 * The leftover answer's retirement line, labelled `RETIRES_LABEL` (LIN-4414). PURE: no I/O.
 *
 * Every eligible stage build's leftover step (`leftoverPrompt`, `lib/dispatch-leftover.js`)
 * settles one fix-sized waiting entry on its PR branch and names it, so an area's waiting list
 * shrinks through the work instead of being cut to make room. Prompt words do not hold a shape
 * (the LIN-4369 Lesson in the llm-and-prompts area note), so the proxy holds it here, the way
 * `checkSizeRecord` (`lib/size-of-move.js`) holds the size record: `routes/proxy-writes.js`
 * refuses a leftover answer without a valid line with 422 and one of `LEFTOVER_ANSWER_CODES`.
 *
 * What it acts on: the builder's leftover answer only, a comment whose FIRST NON-BLANK LINE,
 * trimmed, is exactly `LEFTOVERS_HEADING`. Review verdicts carry that heading as a subsection
 * further down (LIN-4378, LIN-4393), and they pass untouched, as does any comment that merely
 * mentions the heading or carries a retirement line without opening with the heading.
 *
 * What it requires: exactly one line opening with `RETIRES_LABEL`, in one of three forms:
 *   - an entry: a repo-relative path in backticks, then the settled entry's opening words;
 *   - `RETIRES_NONE.noWaiting`: no area the change touched has a Waiting entry, or no notes;
 *   - `RETIRES_NONE.nothingFixSized`: then the smallest entry in the busiest touched area (its
 *     path in backticks) and why it is larger than a fix.
 *
 * It checks the comment's shape only. Whether the named entry really left the note is review's
 * read of the diff against this comment (`lib/prompt-template-defs.js`). The store is not
 * involved ("the store knows no leftovers", LIN-4383). Spellings come from the leaf
 * `lib/prompts/leftover-words.js` and are never retyped here.
 */
import { LEFTOVERS_HEADING, RETIRES_LABEL, RETIRES_NONE } from './prompts/leftover-words.js';
import { isCitedPath, ANY_EXTENSION } from './prompts/area-note-format.js';

/** The refusal codes the proxy answers with (documented in lib/proxy-instructions.js). */
export const LEFTOVER_ANSWER_CODES = Object.freeze({
  missing: 'LEFTOVER_RETIRES_MISSING',
  shape: 'LEFTOVER_RETIRES_SHAPE'
});

const LABEL_WORD = RETIRES_LABEL.replace(/:$/, '');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A retirement line: the label opens the line, optionally after a list marker and in bold.
const LABEL_LINE = new RegExp(`^(?:[-*+]\\s+)?(?:\\*\\*|__)?${escape(LABEL_WORD)}(?:\\*\\*|__)?:(?:\\*\\*|__)?(.*)$`, 'i');
// A repo-relative path in a backtick span, read by the one predicate (lib/prompts/area-note-format.js, LIN-4470). This
// checker takes ANY extension of one to six characters, not the notes guard's list: a retirement line can name another
// repository's file (.ts, .py, .go), and the guard reads only this repo's notes. The difference is the argument, not a fork.
const isPath = (s) => isCitedPath(s, ANY_EXTENSION);
const LEADING_SPAN = /^`([^`\s]+)`/;
const SPANS = /`([^`\s]+)`/g;
// "A few words": tokens with a letter in them, beyond the path itself.
const MIN_WORDS = 3;
const wordsIn = (text) => text.split(/\s+/).filter((t) => /[A-Za-z]/.test(t)).length;
// After a reason, the line ends or goes on after a separator (so a reason run on into another word is no reason).
const startsWithReason = (rest, reason) => {
  if (rest.slice(0, reason.length).toLowerCase() !== reason.toLowerCase()) return null;
  const after = rest.slice(reason.length);
  return after === '' || /^[\s.,;:()—–-]/.test(after) ? after : null;
};

/** Is this comment body the builder's leftover answer: its first non-blank line is the heading? */
export function isLeftoverAnswer(body) {
  if (typeof body !== 'string') return false;
  const first = body.split('\n').find((line) => line.trim() !== '');
  return first !== undefined && first.trim() === LEFTOVERS_HEADING;
}

/** The retirement lines of a body, outside fenced code blocks, as `{ number, text, rest }` (1-based). */
function retiresLines(body) {
  const found = [];
  let fenced = false;
  body.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    const m = LABEL_LINE.exec(line);
    if (m) found.push({ number: i + 1, text: line, rest: m[1].trim() });
  });
  return found;
}

/** The form a retirement line's value takes, or the kind of shape fault it has. */
function formOf(rest) {
  if (/^none\b/i.test(rest)) {
    if (startsWithReason(rest, RETIRES_NONE.noWaiting) !== null) return { form: 'no-waiting' };
    const after = startsWithReason(rest, RETIRES_NONE.nothingFixSized);
    if (after === null) return { kind: 'unknown-reason' };
    const paths = [...after.matchAll(SPANS)].map((m) => m[1]).filter(isPath);
    if (!paths.length) return { kind: 'fix-sized-no-entry' };
    if (wordsIn(after.replace(SPANS, ' ')) < MIN_WORDS) return { kind: 'fix-sized-no-reason' };
    return { form: 'nothing-fix-sized', path: paths[0] };
  }
  const lead = LEADING_SPAN.exec(rest);
  if (!lead || !isPath(lead[1])) return { kind: 'no-path' };
  if (wordsIn(rest.slice(lead[0].length)) < MIN_WORDS) return { kind: 'no-words' };
  return { form: 'entry', path: lead[1] };
}

/**
 * Check a comment body.
 *
 * @param {string} body
 * @returns {{ ok: true, applies: false }
 *   | { ok: true, applies: true, form: 'entry'|'no-waiting'|'nothing-fix-sized', path?: string, line: {number: number, text: string} }
 *   | { ok: false, code: string, kind?: string, line?: {number: number, text: string} }}
 */
export function checkLeftoverAnswer(body) {
  if (!isLeftoverAnswer(body)) return { ok: true, applies: false };
  const lines = retiresLines(body);
  if (!lines.length) return { ok: false, code: LEFTOVER_ANSWER_CODES.missing };
  const at = (l) => ({ number: l.number, text: l.text });
  if (lines.length > 1) return { ok: false, code: LEFTOVER_ANSWER_CODES.shape, kind: 'repeated', line: at(lines[1]) };
  const shape = formOf(lines[0].rest);
  if (shape.kind) return { ok: false, code: LEFTOVER_ANSWER_CODES.shape, kind: shape.kind, line: at(lines[0]) };
  return { ok: true, applies: true, ...shape, line: at(lines[0]) };
}

/**
 * One literal example line per valid form, built from the leaf's words, so a builder refused
 * once can fix its answer in a single retry (as `recordShape()` does for the size record).
 * `tests/unit/dispatch-leftover-answer.test.js` checks each one passes.
 */
export function retiresExamples() {
  return [
    `${RETIRES_LABEL} \`lib/your-file.js\`: the opening words of the waiting entry you settled and removed`,
    `${RETIRES_LABEL} ${RETIRES_NONE.noWaiting} (no area the change touched has a Waiting entry, or the repo has no area notes)`,
    `${RETIRES_LABEL} ${RETIRES_NONE.nothingFixSized}: the smallest is \`lib/your-file.js\`: its opening words, larger than a fix because it moves a shared contract`
  ];
}

const SHAPE_WORDS = {
  repeated: 'has more than one such line',
  'no-path': 'does not start with the settled entry\'s file as a repo-relative path in backticks',
  'no-words': 'names a path but not the settled entry\'s opening words',
  'unknown-reason': `gives a reason outside the list ("${RETIRES_NONE.noWaiting}" or "${RETIRES_NONE.nothingFixSized}")`,
  'fix-sized-no-entry': 'says nothing is fix-sized without naming the smallest entry\'s file in backticks',
  'fix-sized-no-reason': 'names the smallest entry without saying why it is larger than a fix'
};

/**
 * The refusal message for a failed check: why the comment was checked (its opening line), what is
 * wrong, and one literal example of each valid form.
 *
 * @param {{ code: string, kind?: string, line?: {number: number} }} check - a failed checkLeftoverAnswer result
 * @returns {string}
 */
export function leftoverAnswerRefusal(check) {
  const lead = `A comment that opens with the line "${LEFTOVERS_HEADING}" is the builder's leftover answer, and it names the waiting entry the build settled on exactly one line starting "${RETIRES_LABEL}"`;
  const fault = check.code === LEFTOVER_ANSWER_CODES.missing
    ? 'this one has no such line'
    : `its line ${check.line?.number} ${SHAPE_WORDS[check.kind] ?? 'is not in one of the forms'}`;
  return `${lead}: ${fault}. Use one of these forms: ${retiresExamples().join(' | ')}. A comment that is not a leftover answer (a review verdict, say) must not open with that heading.`;
}
