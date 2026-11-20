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
 *   - sealAsAsked     — the create lanes and the first-dispatch seal, and the Jira
 *                       region reader (lib/providers/jira/as-asked-region.js). The
 *                       caller decides whether to seal; a body that already holds a
 *                       marker line (hasMarkerLine) must not be sealed, or its own
 *                       marker would end the block early.
 *   - splitAsAsked    — lib/brief-quote.js briefQuoteEnd, lib/asked-of.js askedOf,
 *                       condensePlan, description/below, and the Jira region writer
 *                       (the words it puts in the harbour.asAsked property, LIN-4450).
 *   - AS_ASKED_PARENT_HEADING, AS_ASKED_PARENT_END — the brief's parent-quote lines,
 *                       written and found by lib/brief-quote.js (LIN-4501: the
 *                       brief quotes the task's `asked`, not the description).
 *   - askedText       — the proxy guard's removed message (routes/proxy-writes.js);
 *                       every reader of the ticket's words takes the task's `asked`.
 *   - checkAsAsked    — the proxy's description-write guard.
 *   - AS_ASKED_HEADING, AS_ASKED_END, AS_ASKED_END_SHORT — every agent-facing string in
 *                       lib/ and routes/ that names the markers interpolates these
 *                       (tests/unit/as-asked-marker-census.test.js); comments keep the text.
 *                       The Jira region module derives the ADF node texts from
 *                       the heading and end sentence by parsing them, not retyping.
 *   - BRIEF_HINT      — what the brief opens with, for every surface that points an
 *                       agent at it (see its note; lib/brief-quote.js composeBrief
 *                       writes what it describes).
 *   - outsideAsAsked  — the text above and below the block (the whole text when
 *                       unsealed): readFact's first read, and assembleTrailFacts'
 *                       plan-below check.
 *   - readFact        — every reader of a code-read line (see prompt-contract.js):
 *                       below the block wins, the block is the fallback, and an
 *                       unsealed ticket reads its whole description as before.
 *                       A reader added to prompt-contract.js's reader table goes
 *                       through it too; the table's header points here.
 *
 * When the unsealed branches could go, written once for all three (checkAsAsked's
 * 'none', readFact's unsealed branch, askedText's fallthrough): they stay while any
 * description can be unsealed: every sealForFiling skip (a provider that cannot hold
 * the block, a lossy round trip or a block too large to hold; a body holding a marker line; an empty body), every
 * first-dispatch seal skip, and every ticket filed before the block existed. Today
 * that makes them effectively permanent.
 */
import { normalizeEscaping } from './description-edit.js';

export const AS_ASKED_HEADING = '## As asked';
export const AS_ASKED_END = '*End of what was asked. Steps write below this line; nothing above it changes.*';
/** `*End of what was asked`: the end sentence's opening words, shared by its short and parent forms. */
const END_STEM = AS_ASKED_END.slice(0, AS_ASKED_END.indexOf('.'));
/**
 * The end sentence as prose names it (the proxy instructions' `"*End of what was asked. …*"`):
 * its first clause and an ellipsis. Not a marker line; nothing matches on it. It is built from
 * AS_ASKED_END so a change to the sentence reaches the text that names it.
 */
export const AS_ASKED_END_SHORT = `${END_STEM}. …*`;

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
 * When it could go: 'none' (an edit on an unsealed ticket passes)
 * See "When the unsealed branches could go" in the header: one condition for all three.
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
 * When it could go: the unsealed branch (no block, read the whole description)
 * See "When the unsealed branches could go" in the header: one condition for all three.
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
  const outside = read(withAfter(outsideOf(parts, description)));
  return parts && absent(outside) ? read(parts.words) : outside;
}

const outsideOf = (parts, description) => (parts ? parts.before + parts.below : description || '');

/**
 * The text outside the block, the step-written part of a description: the text
 * above the block followed by the text below it when the description is sealed,
 * the whole description when it is not, and '' for null or undefined. readFact
 * reads a fact here first; a caller that needs the same text (assembleTrailFacts'
 * plan below the block) takes it from here rather than splitting by hand.
 *
 * @param {string|null|undefined} description
 * @returns {string}
 */
export function outsideAsAsked(description) {
  return outsideOf(splitAsAsked(description), description);
}

/**
 * The words a first-line reader should start from: the block's words when the
 * description is sealed (so a headline shows the asker's first line, not
 * `## As asked`), otherwise the description unchanged.
 *
 * When it could go: the fallthrough (no block, return the description)
 * See "When the unsealed branches could go" in the header: one condition for all three.
 *
 * @param {string|null|undefined} description
 * @returns {string|null|undefined}
 */
export function askedText(description) {
  const parts = splitAsAsked(description);
  return parts ? parts.words : description;
}

/**
 * Whether any line of `text` is a marker line (heading or end sentence), raw or
 * escaped. A body that holds one must not be sealed as-is, and a proxy create
 * carrying one is refused.
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

/**
 * What the served brief opens with, in the words every surface that points an agent at
 * `GET /brief` uses (the proxy preamble, the proxy instructions, the chat `get_brief` tool,
 * the autopilot and Flight Companion kickoffs). It describes the output of lib/brief-quote.js composeBrief (the
 * task's `asked`, which is the block's words on a sealed ticket); each surface keeps only its own framing around it
 * ("it opens with …"). Its wording moves with the block's retirement (P2).
 */
export const BRIEF_HINT = `the person's words, quoted from the description's \`${AS_ASKED_HEADING}\` block; no step may change them; the rest is the present state`;

/**
 * The brief's parent-quote heading and end line (LIN-4353). The composer that writes them and the parser that finds
 * where they end live in lib/brief-quote.js (LIN-4501), which takes the words from the task's `asked`.
 */
export const AS_ASKED_PARENT_HEADING = `${AS_ASKED_HEADING} on the parent`;
export const AS_ASKED_PARENT_END = `${END_STEM} on the parent.*`;
