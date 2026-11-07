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
 *   - sealAsAsked     — the create lanes and the first-dispatch seal. The
 *                       caller decides whether to seal; a body that already holds a
 *                       marker line (hasMarkerLine) must not be sealed, or its own
 *                       marker would end the block early.
 *   - splitAsAsked    — composeBrief and briefQuoteEnd below, condensePlan and
 *                       description/below.
 *   - composeBrief    — the served brief: the block's words, then a parent's block
 *                       words under its own heading, quoted ahead of the model's
 *                       sections (lib/brief.js generateBrief, the test-mode mock
 *                       brief in lib/workspace-api-mocks.js).
 *   - briefQuoteEnd   — where those quotes end (lib/task-page-loader.js's section
 *                       parsers).
 *   - askedText       — first-line readers (toStackHeadline, the mock brief, the
 *                       proxy guard's removed message).
 *   - checkAsAsked    — the proxy's description-write guard.
 *   - AS_ASKED_HEADING, AS_ASKED_END, AS_ASKED_END_SHORT — every agent-facing string in
 *                       lib/ and routes/ that names the markers interpolates these
 *                       (tests/unit/as-asked-marker-census.test.js); comments keep the text.
 *   - BRIEF_HINT      — what the brief opens with, for every surface that points an
 *                       agent at it (see its note beside composeBrief).
 *   - outsideAsAsked  — the text above and below the block (the whole text when
 *                       unsealed): readFact's first read, and assembleTrailFacts'
 *                       plan-below check.
 *   - readFact        — every reader of a code-read line (see prompt-contract.js):
 *                       below the block wins, the block is the fallback, and an
 *                       unsealed ticket reads its whole description as before.
 *                       A reader added to prompt-contract.js's reader table goes
 *                       through it too; the table's header points here.
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
 * stays while any description can be unsealed: every sealForFiling skip (a provider
 * that cannot hold the block, Jira today; a body holding a marker line; an empty body),
 * every first-dispatch seal skip, and every ticket filed before the block existed.
 * Today that makes it effectively permanent.
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
 * stays while any description can be unsealed: every sealForFiling skip (a provider
 * that cannot hold the block, Jira today; a body holding a marker line; an empty body),
 * every first-dispatch seal skip, and every ticket filed before the block existed.
 * Today that makes it effectively permanent.
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
 * stays while any description can be unsealed: every sealForFiling skip (a provider
 * that cannot hold the block, Jira today; a body holding a marker line; an empty body),
 * every first-dispatch seal skip, and every ticket filed before the block existed.
 * Today that makes it effectively permanent.
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
 * the autopilot and Flight Companion kickoffs). It describes composeBrief's output, so it
 * lives beside it; each surface keeps only its own framing around it ("it opens with …").
 */
export const BRIEF_HINT = `the person's words, quoted from the description's \`${AS_ASKED_HEADING}\` block; no step may change them; the rest is the present state`;

/**
 * The served brief: the `## As asked` block's words, quoted byte for byte as stored
 * (Linear's backslash escapes kept) in the block's sealed shape, then the model's (or
 * the mock's) four sections. An unsealed description, or an empty model brief (nothing
 * usable — no quote-only brief is cached), returns `modelBrief` unchanged.
 *
 * A subtask whose parent carries a block also gets the parent's words, byte for byte,
 * after its own quote, under the parent's own heading and end line (John's whose-words
 * ruling on LIN-4345, 7 Nov: a breakdown child's block holds the agent's slice of the
 * plan; the person's words are on the parent). Every subtask is covered: breakdown
 * children carry no durable marker, and the quote is labelled as the parent's.
 *
 * @param {string|null|undefined} description - the issue description
 * @param {string} modelBrief - the four sections
 * @param {{identifier?: string, description?: string}|null} [parent] - the parent issue, if any
 * @returns {string}
 */
export function composeBrief(description, modelBrief, parent = null) {
  if (!modelBrief) return modelBrief;
  const own = splitAsAsked(description);
  const quotes = [own ? sealAsAsked(own.words) : '', parentQuote(parent)].filter(Boolean);
  return quotes.length ? `${quotes.join('\n\n')}\n\n${modelBrief}` : modelBrief;
}

const PARENT_HEADING = `${AS_ASKED_HEADING} on the parent`;
const PARENT_END = `${END_STEM} on the parent.*`;

/** The parent's block words in the brief's parent-quote shape, or '' with no block. */
function parentQuote(parent) {
  const parts = splitAsAsked(parent?.description);
  if (!parts) return '';
  return `${PARENT_HEADING}${parent.identifier ? `, ${parent.identifier}` : ''}\n\n${parts.words}\n\n${PARENT_END}`;
}

/**
 * Where a composed brief's quotes end: the offset just past the last end line (the
 * task's own quote, then the parent's), or 0 when the brief opens with neither.
 * Parsers of the model's sections start here.
 *
 * @param {string|null|undefined} brief
 * @returns {number}
 */
export function briefQuoteEnd(brief) {
  if (typeof brief !== 'string') return 0;
  const parts = splitAsAsked(brief);
  let end = parts && parts.start === 0 ? parts.end : 0;
  const lead = brief.slice(end).match(/^\s*/)[0].length;
  if (brief.startsWith(PARENT_HEADING, end + lead)) {
    const close = brief.indexOf(`\n${PARENT_END}`, end + lead);
    if (close !== -1) end = close + 1 + PARENT_END.length;
  }
  return end;
}
