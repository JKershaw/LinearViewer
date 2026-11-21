/**
 * The served brief's quote of the person's words (LIN-4501), taken from the task's immutable `asked`
 * (lib/records-store.js askedForTickets), never from the ticket description.
 *
 * LIN-4502 (P2): this module is the ONE home of the quote's spellings. The `## As asked` seal that used to write the
 * same shape into descriptions is retired, and its module with it. What survives is the brief's own quote:
 *
 *   ## As asked
 *   <blank>
 *   <the task's asked>
 *   <blank>
 *   *End of what was asked. Steps write below this line; nothing above it changes.*
 *
 * then a parent's words under its own heading and end line. Everything that names the quote (the brief, the stage
 * texts, the proxy instructions, BRIEF_HINT) imports its spellings from here, and never retypes them
 * (tests/unit/as-asked-marker-census.test.js). The brief composers (lib/brief.js, the test-mode mock in
 * lib/workspace-api-mocks.js) and the task page's section parser (lib/task-page-loader.js) use the functions below.
 *
 * `splitQuote` is the quote's one reader, and it has no caller outside this module now (LIN-4527 retired the legacy block
 * reader in lib/asked-of.js). The census (tests/unit/lin-4502-retirement-census.test.js) allows `splitQuote` only here.
 *
 * `attachAsked` is the one step both brief routes run on a fetched context (routes/proxy-compute.js,
 * routes/workspace-api.js): they share one brief cache, and both attach the words after the context is hashed. The
 * words are not part of the cache key (lib/recap-cache.js leaves `asked` out, because it is immutable), so a brief
 * cached before its task existed gains its quote at the next context change.
 */
import { normalizeEscaping } from './description-edit.js';

/** The quote's heading: the label of the brief's part 1. */
export const ASKED_HEADING = '## As asked';
/** The quote's end line. */
export const ASKED_END = '*End of what was asked. Steps write below this line; nothing above it changes.*';
/** `*End of what was asked`: the end line's opening words, shared by its short and parent forms. */
const END_STEM = ASKED_END.slice(0, ASKED_END.indexOf('.'));
/**
 * The end line as prose names it (`"*End of what was asked. …*"`): its first clause and an ellipsis. Not a marker
 * line; nothing matches on it. It is built from ASKED_END so a change to the line reaches the text that names it.
 */
export const ASKED_END_SHORT = `${END_STEM}. …*`;
/** The brief's parent-quote heading and end line (LIN-4353). */
export const ASKED_PARENT_HEADING = `${ASKED_HEADING} on the parent`;
export const ASKED_PARENT_END = `${END_STEM} on the parent.*`;

/**
 * What the served brief opens with, in the words every surface that points an agent at `GET /brief` uses (the proxy
 * preamble, the proxy instructions, the chat `get_brief` tool, the autopilot and Flight Companion kickoffs). It
 * describes composeBrief's output: the task's `asked`, never the description. Each surface keeps only its own framing
 * around it ("it opens with …").
 */
export const BRIEF_HINT = `the person's words under \`${ASKED_HEADING}\`, from the task's record; no step may change them; the rest is the present state`;

/**
 * The words in the quote's shape. Pure: the words are kept byte for byte, and null/undefined quote as empty.
 *
 * @param {string|null|undefined} words
 * @returns {string}
 */
export function quoteAsked(words) {
  return `${ASKED_HEADING}\n\n${String(words ?? '')}\n\n${ASKED_END}`;
}

/** A line's comparable form: trailing `\r` dropped, backslash escapes removed (Linear stores `\#\# As asked`). */
function markerForm(line) {
  return normalizeEscaping(line.endsWith('\r') ? line.slice(0, -1) : line);
}

/** The lines of `text`, each with its start offset and its content without the line terminator. */
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
 * Split a text around its quote: from the first line that is exactly the heading to the first line after it that is
 * exactly the end line, both compared after normalizeEscaping, a trailing `\r` ignored. A heading with no end line
 * after it is not a quote. The words come back as STORED (a Linear body keeps its backslash escapes).
 *
 * @param {string|null|undefined} text
 * @returns {null | {
 *   words: string,   // the quoted words, as stored, byte for byte
 *   before: string,  // text above the heading line ('' when the quote is at the top)
 *   below: string,   // text after the end line, starting with that line's terminator
 *   start: number,   // offset of the heading line
 *   end: number      // offset just past the end line's content (before its terminator)
 * }} null when the text holds no quote: a distinct result, never an empty split
 */
export function splitQuote(text) {
  if (typeof text !== 'string' || !text) return null;
  let heading = null;
  for (const l of linesWithOffsets(text)) {
    if (!heading) {
      if (markerForm(l.line) === ASKED_HEADING) heading = l;
      continue;
    }
    if (markerForm(l.line) !== ASKED_END) continue;
    // The end line's content stops before a `\r` of a CRLF terminator, so `below` starts with the whole terminator.
    const end = l.line.endsWith('\r') ? l.stop - 1 : l.stop;
    return { words: wordsBetween(text, heading, l), before: text.slice(0, heading.start), below: text.slice(end), start: heading.start, end };
  }
  return null;
}

/**
 * The words between the heading line and the end line, with the shape's two blank lines removed: one line break
 * after the heading's own terminator, and the end line's preceding terminator plus one blank line. Lenient towards a
 * block a person edited by hand (missing blank lines), exact for one quoteAsked wrote.
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

/**
 * The served brief: the task's `asked`, quoted in the quote's shape, then the parent task's `asked` under the
 * parent heading, then the model's (or the mock's) four sections. No words, or an empty model brief (nothing usable:
 * no quote-only brief is cached), returns `modelBrief` unchanged.
 *
 * A subtask's own words may be an agent's slice of a parent's plan (John's whose-words ruling on LIN-4345, 7 Nov), so
 * the parent's words follow, labelled as the parent's.
 *
 * @param {string|null|undefined} asked - the task's `asked`
 * @param {string} modelBrief - the four sections
 * @param {{identifier?: string, asked?: string|null}|null} [parent] - the parent ticket and its task's `asked`
 * @returns {string}
 */
export function composeBrief(asked, modelBrief, parent = null) {
  if (!modelBrief) return modelBrief;
  const quotes = [asked ? quoteAsked(asked) : '', parentQuote(parent)].filter(Boolean);
  return quotes.length ? `${quotes.join('\n\n')}\n\n${modelBrief}` : modelBrief;
}

/** The parent ticket and its task's `asked` from a context (attachAsked), for composeBrief; null with no parent. */
export function parentWordsOf(context) {
  return context?.parent ? { identifier: context.parent.identifier, asked: context.asked?.parent ?? null } : null;
}

/** The parent's words in the brief's parent-quote shape, or '' with none. */
function parentQuote(parent) {
  if (!parent?.asked) return '';
  return `${ASKED_PARENT_HEADING}${parent.identifier ? `, ${parent.identifier}` : ''}\n\n${parent.asked}\n\n${ASKED_PARENT_END}`;
}

/**
 * Where a composed brief's quotes end: the offset just past the last end line (the task's own quote, then the
 * parent's), or 0 when the brief opens with neither. Parsers of the model's sections start here.
 *
 * @param {string|null|undefined} brief
 * @returns {number}
 */
export function briefQuoteEnd(brief) {
  if (typeof brief !== 'string') return 0;
  const parts = splitQuote(brief);
  let end = parts && parts.start === 0 ? parts.end : 0;
  const lead = brief.slice(end).match(/^\s*/)[0].length;
  if (brief.startsWith(ASKED_PARENT_HEADING, end + lead)) {
    const close = brief.indexOf(`\n${ASKED_PARENT_END}`, end + lead);
    if (close !== -1) end = close + 1 + ASKED_PARENT_END.length;
  }
  return end;
}

/**
 * Put the person's words on a fetched brief context: `context.asked = {self, parent}`, each the ticket's task's
 * `asked` or null (no task yet, or no records store). The words feed the quote (composeBrief); they do not key the
 * brief cache (lib/recap-cache.js hashContext runs before this step and leaves `asked` out). A records fault is logged and reads as no words, so a brief is
 * still served, without the quote, never with the description in its place.
 *
 * @param {object} context - the provider's recommendation context (`issue`, `parent`, …); mutated and returned
 * @param {{recordsStore?: object|null, urlKey: string}} deps
 * @returns {Promise<object>}
 */
export async function attachAsked(context, { recordsStore = null, urlKey }) {
  if (!context || typeof context !== 'object') return context;
  const self = context.issue?.identifier || null;
  const parent = context.parent?.identifier || null;
  let words = new Map();
  if (recordsStore && typeof recordsStore.askedForTickets === 'function' && self) {
    try {
      words = await recordsStore.askedForTickets(urlKey, [self, parent].filter(Boolean));
    } catch (err) {
      console.error(`[brief] the task's asked could not be read (${urlKey} ${self}): ${err?.message || err}`);
    }
  }
  context.asked = { self: (self && words.get(self)) ?? null, parent: (parent && words.get(parent)) ?? null };
  return context;
}
