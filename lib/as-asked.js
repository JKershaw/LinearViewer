/**
 * The `## As asked` block (LIN-4345, LIN-4351): the description as filed, byte for
 * byte, kept at the top of a ticket so every step reads the person's words directly
 * and no step rewrites them. This module is the ONE place the two marker lines are
 * spelled out; everything else imports them or calls these pure functions.
 *
 * The shape is fixed, because once tickets carry it changing it is expensive:
 *
 *   ## As asked
 *   <blank>
 *   <the description as filed, byte for byte>
 *   <blank>
 *   *End of what was asked. Steps write below this line; nothing above it changes.*
 *
 * The block runs from the first line that is exactly the heading to the first line
 * after it that is exactly the end sentence. Both are compared after
 * normalizeEscaping, because Linear stores markdown punctuation backslash-escaped
 * (`\#\# As asked`); a trailing `\r` is ignored so CRLF bodies match too. A heading
 * with no end line after it is not a block.
 *
 * The words come back as STORED: on Linear they keep their backslash escapes. Only
 * the marker detection and checkAsAsked's comparison are normalised.
 *
 * Who uses what:
 *   - sealAsAsked     — the create lanes and the first-dispatch seal (piece B). The
 *                       caller decides whether to seal; a body that already holds a
 *                       marker line (hasMarkerLine) must not be sealed, or its own
 *                       marker would end the block early.
 *   - splitAsAsked    — the brief composer, first-line readers, condensePlan and
 *                       description/below (pieces A and B).
 *   - checkAsAsked    — the proxy's description-write guard (piece B).
 *   - readFact        — every reader of a code-read line (see prompt-contract.js):
 *                       below the block wins, the block is the fallback, and an
 *                       unsealed ticket reads its whole description as before.
 */
import { normalizeEscaping } from './description-edit.js';

export const AS_ASKED_HEADING = '## As asked';
export const AS_ASKED_END = '*End of what was asked. Steps write below this line; nothing above it changes.*';

/** A line's comparable form: trailing `\r` dropped, backslash escapes removed. */
function markerForm(line) {
  return normalizeEscaping(line.endsWith('\r') ? line.slice(0, -1) : line);
}

/**
 * Seal a body into the fixed block shape. Pure: the body is kept byte for byte, and
 * null/undefined seal as an empty body. Deciding WHETHER to seal is the caller's job.
 *
 * @param {string|null|undefined} body - the description as filed
 * @returns {string}
 */
export function sealAsAsked(body) {
  return `${AS_ASKED_HEADING}\n\n${String(body ?? '')}\n\n${AS_ASKED_END}`;
}

/**
 * Walk the lines of `text` with each line's start offset and its content without
 * the line terminator.
 */
function* linesWithOffsets(text) {
  let start = 0;
  while (start <= text.length) {
    const nl = text.indexOf('\n', start);
    const stop = nl === -1 ? text.length : nl;
    yield { start, stop, line: text.slice(start, stop), next: nl === -1 ? -1 : nl + 1 };
    if (nl === -1) return;
    start = nl + 1;
  }
}

/**
 * Split a description around its block.
 *
 * @param {string|null|undefined} description
 * @returns {null | {
 *   words: string,   // the block's words, as stored, byte for byte
 *   before: string,  // text above the heading line ('' when the block is at the top)
 *   below: string,   // text after the end line, starting with that line's terminator
 *   start: number,   // offset of the heading line
 *   end: number      // offset just past the end line's content (before its terminator)
 * }} null when the description has no block — a distinct result, never an empty split
 */
export function splitAsAsked(description) {
  if (typeof description !== 'string' || !description) return null;
  let heading = null;
  for (const l of linesWithOffsets(description)) {
    if (!heading) {
      if (markerForm(l.line) === AS_ASKED_HEADING) heading = l;
      continue;
    }
    if (markerForm(l.line) !== AS_ASKED_END) continue;
    // The end line's content stops before a `\r` of a CRLF terminator, so `below`
    // starts with the whole terminator.
    const end = l.line.endsWith('\r') ? l.stop - 1 : l.stop;
    return {
      words: wordsBetween(description, heading, l),
      before: description.slice(0, heading.start),
      below: description.slice(end),
      start: heading.start,
      end
    };
  }
  return null;
}

/**
 * The words between the heading line and the end line, with the shape's two blank
 * lines removed: one line break after the heading's own terminator, and the end
 * line's preceding terminator plus one blank line. Lenient towards a block a person
 * edited by hand (missing blank lines), exact for one sealAsAsked wrote.
 */
function wordsBetween(text, heading, endLine) {
  if (heading.next === -1 || endLine.start <= heading.next) return '';
  let words = text.slice(heading.next, endLine.start);
  if (words.startsWith('\n')) words = words.slice(1);
  else if (words.startsWith('\r\n')) words = words.slice(2);
  if (words.endsWith('\n\n')) words = words.slice(0, -2);
  else if (words.endsWith('\r\n\r\n')) words = words.slice(0, -4);
  else if (words.endsWith('\r\n')) words = words.slice(0, -2);
  else if (words.endsWith('\n')) words = words.slice(0, -1);
  return words;
}

/** Normalised block words as lines, for comparison: escapes removed, CRLF as LF. */
function comparableLines(words) {
  return normalizeEscaping(words).replace(/\r\n/g, '\n').split('\n');
}

/**
 * Check that an edit kept the block. Both sides are compared normalised — never
 * against a stored copy — so a provider whose round trip re-escapes the text is not
 * refused for it.
 *
 * kind:
 *   'kept'    — both sealed, same words                       (ok)
 *   'none'    — neither has a block                           (ok)
 *   'changed' — both sealed, words differ; `line` names the first difference
 *               ({ number (1-based within the words), expected, actual|null })
 *   'removed' — the live description has a block, the new one does not
 *   'added'   — the new description has a block the live one does not (forged)
 *
 * @param {string|null|undefined} liveDescription - what the provider holds now
 * @param {string|null|undefined} newDescription  - what the edit would write
 * @returns {{ ok: boolean, kind: 'kept'|'none'|'changed'|'removed'|'added',
 *             line?: { number: number, expected: string|null, actual: string|null } }}
 */
export function checkAsAsked(liveDescription, newDescription) {
  const live = splitAsAsked(liveDescription);
  const next = splitAsAsked(newDescription);
  if (!live && !next) return { ok: true, kind: 'none' };
  if (!live) return { ok: false, kind: 'added' };
  if (!next) return { ok: false, kind: 'removed' };
  const a = comparableLines(live.words);
  const b = comparableLines(next.words);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return {
      ok: false,
      kind: 'changed',
      line: { number: i + 1, expected: a[i] ?? null, actual: b[i] ?? null }
    };
  }
  return { ok: true, kind: 'kept' };
}

// Only null/undefined mean "not found". `false` is an answer (a reader may say a
// real "no" with it), so a negative below the block must never fall through to it.
const absent = (value) => value === null || value === undefined;

/**
 * Read a code-read fact (plan heading, session fit, `plan-review due:`) with the
 * rule "below the block wins". `read` is the reader's own parser over a piece of
 * text. On a sealed ticket it runs first over the text outside the block (text
 * above it, then text below it — both are step-written), and over the block's words
 * only when that found nothing. "Nothing" is null or undefined ONLY: a reader returns
 * one of those when its line is absent, and any other value — `false`, `'no'`, `''`
 * — is an answer and wins. A presence predicate therefore says absent with null
 * (`(t) => re.test(t) || null`), not false. An unsealed ticket reads its whole
 * description, exactly as before.
 *
 * `after` is step-written text from elsewhere that the reader used to append to the
 * description (assembleTrailFacts' plan comment). It is joined after the text
 * outside the block — or after the whole description when unsealed, exactly as the
 * caller joined it before — so it too wins over the block.
 *
 * @template T
 * @param {string|null|undefined} description
 * @param {(text: string) => T} read
 * @param {{ after?: string }} [options]
 * @returns {T}
 */
export function readFact(description, read, { after } = {}) {
  const withAfter = (text) => (after === undefined ? text : [text, after].join('\n\n'));
  const parts = splitAsAsked(description);
  if (!parts) return read(withAfter(description || ''));
  const outside = read(withAfter(parts.before + parts.below));
  return absent(outside) ? read(parts.words) : outside;
}

/**
 * Whether any line of `text` is a marker line (heading or end sentence), raw or
 * escaped. A body that holds one must not be sealed as-is, and a proxy create
 * carrying one is refused (piece B).
 *
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function hasMarkerLine(text) {
  if (typeof text !== 'string' || !text) return false;
  for (const { line } of linesWithOffsets(text)) {
    const form = markerForm(line);
    if (form === AS_ASKED_HEADING || form === AS_ASKED_END) return true;
  }
  return false;
}
