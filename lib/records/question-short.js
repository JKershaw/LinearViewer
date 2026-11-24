/**
 * LIN-4550 (LIN-4546 piece 2/7): a question's one-line question, `short`, the sentence every card leads with.
 *
 * A question written since LIN-4550 carries `short` (lib/records/kinds.json; over KINDS.limits.question.short the write is
 * refused, never cut, lib/records/check.js). A question asked before has only `asks`, so its lead is derived here, once, on the
 * server: the one reader of open questions (lib/open-questions.js openQuestionsFor) puts it on every row, so every surface and
 * JSON feed gets the same words and no browser copy of this rule exists.
 *
 * The rule (LIN-4546's research checked it on all nine real asks; tests/fixtures/lin-4550-real-asks.json keeps them): the first
 * sentence of `asks` that ends in "?", else its first sentence, trimmed and on one line.
 *
 *   - A sentence ends at ".", "?" or "!" (any closing quote or bracket after it kept) followed by a space or the end. So a dot or a
 *     "?" inside a URL (`https://x.com/a.b?c=1`) ends nothing; "e.g.", "i.e." and their kin (ABBREVIATIONS) end nothing either.
 *   - A blank line, a list item or a heading starts a new block, and a sentence never runs across blocks; the markers ("- ", "1. ",
 *     "## ") are dropped, so a list's "1." is not read as a sentence.
 *   - Empty, blank or non-text `asks` gives "" (never a throw); no sentence end gives the whole text.
 *   - Over the cap, the derived lead first drops its parenthetical asides ("( ... )"), which keeps the question whole in the
 *     one real ask that needs it; still over, it is cut at the last word that fits and ends in "…", within the cap. One token
 *     longer than the cap (a long URL) is cut hard. A derived lead is display text, so shortening it cuts nothing stored.
 */
import { KINDS } from './check.js';

/** The most characters a question's `short` holds: written, refused over it; derived, kept within it. */
export const QUESTION_SHORT_MAX = KINDS.limits.question.short;

/** Words ending in "." that do not end a sentence (lower-cased, with their dots). "etc." is not here: it often does. */
const ABBREVIATIONS = new Set(['e.g.', 'i.e.', 'cf.', 'vs.', 'viz.', 'approx.', 'incl.', 'resp.', 'a.k.a.']);
const LINE_MARKER = /^(?:[-*+•]|\d+[.)]|#{1,6})\s+/;
const SENTENCE_END = /[.?!]+["'”’)\]]*(?=\s|$)/g;
const ENDS_IN_QUESTION = /\?["'”’)\]]*$/;
const ELLIPSIS = '…';

/** The ask's blocks: paragraphs, list items and headings, each joined onto one line, markers dropped. */
function blocksOf(text) {
  const blocks = [];
  let current = [];
  const flush = () => { if (current.length) blocks.push(current.join(' ')); current = []; };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const marker = LINE_MARKER.exec(line);
    if (marker) { flush(); current.push(line.slice(marker[0].length)); } else current.push(line);
  }
  flush();
  return blocks;
}

/** One block's sentences, in order. */
function sentencesOf(block) {
  const out = [];
  let start = 0;
  for (const match of block.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (match[0].startsWith('.')) {
      const word = block.slice(block.lastIndexOf(' ', match.index) + 1, match.index + 1).replace(/^[("'“‘[]+/, '').toLowerCase();
      if (ABBREVIATIONS.has(word)) continue;
    }
    const sentence = block.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
  }
  const rest = block.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** `text` within the cap: as it is, else without its asides, else cut at a word with an ellipsis. */
function withinCap(text, max = QUESTION_SHORT_MAX) {
  if (text.length <= max) return text;
  let bare = text;
  for (let before = ''; before !== bare;) { before = bare; bare = bare.replace(/\s*\([^()]*\)/g, ''); }
  bare = bare.replace(/\s+([,;:.?!])/g, '$1').replace(/\s+/g, ' ').trim();
  if (bare && bare.length <= max) return bare;
  const room = max - ELLIPSIS.length;
  const head = text.slice(0, room + 1);
  const space = head.lastIndexOf(' ');
  const kept = (space > room / 2 ? head.slice(0, space) : text.slice(0, room)).replace(/[\s,;:–—-]+$/, '');
  return kept + ELLIPSIS;
}

/**
 * The lead derived from a question's `asks` (see the header). Pure.
 * @param {unknown} asks
 * @returns {string} "" when there is no text
 */
export function deriveQuestionShort(asks) {
  if (typeof asks !== 'string' || !asks.trim()) return '';
  const sentences = blocksOf(asks).flatMap(sentencesOf);
  const lead = sentences.find((s) => ENDS_IN_QUESTION.test(s)) ?? sentences[0] ?? '';
  return withinCap(lead.replace(/\s+/g, ' ').trim());
}

/**
 * A question's one-line question: its written `short` when it has one, else the lead derived from `asks`.
 * @param {{short?: unknown, asks?: unknown}|null|undefined} fields - the question record's fields
 * @returns {string}
 */
export function questionShortOf(fields) {
  const written = fields?.short;
  if (typeof written === 'string' && written.trim()) return written.trim();
  return deriveQuestionShort(fields?.asks);
}
