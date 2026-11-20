/**
 * LIN-4501 (P1): the words a task's immutable `asked` takes from a ticket's description. One rule for every task
 * writer. It is injected as `askedText` into the checked write pipeline (lib/records/writes.js) at every place that
 * can make a task: server.js (`ticketWriter`, which the dispatch seat in lib/dispatch-factory.js and the take fallback
 * in lib/run-records.js reach through the `taskForTicketAt` seam), the proxy's first write (routes/proxy.js) and the
 * task page and project page writers (routes/task-records.js, routes/project-page.js).
 *
 * LIN-4502 (P2): the `## As asked` seal is retired, so no description gains a block any more. Descriptions filed
 * before P2 still carry one, so this module keeps the ONE legacy reader of that block (`legacyBlock`, private) and
 * the readers that must still tell a sealed description's person-words from its step-written text:
 *   - askedOf         — a new task's `asked`;
 *   - readFact        — code-read lines (plan heading, session fit, `plan-review due:`): outside the block wins;
 *   - outsideAsked    — the step-written text (assembleTrailFacts' plan-below, the size record's region);
 *   - legacyBlockSpan — where the block sits, for the readers that keep it intact (condensePlan, description/below).
 * On a description with no block (every ticket filed from P2 on) each reads the whole description, as an unsealed
 * ticket always did. The block's shape is the brief quote's (lib/brief-quote.js splitQuote reads both), because the
 * seal wrote descriptions in exactly the shape the brief still quotes.
 *
 * Exit condition (when `legacyBlock` and the block branches below can go), both must hold:
 *   1. No reader parses a plan fact or the size record out of a description: P4 (LIN-4504) moves plans and their
 *      routing facts to records (readPlanFacts), so readFact, outsideAsked and legacyBlockSpan lose their callers.
 *   2. No ticket whose description still holds a block is without a task, so askedOf is never asked to read one:
 *      the P1 import gave every open ticket its task; a records count of tickets with a block and no task reads 0.
 * The census (tests/unit/lin-4502-retirement-census.test.js) allows the block reader here, with this condition, and
 * nowhere else outside lib/brief-quote.js. If the brief's quote is ever reworded before this exit, freeze the old
 * spelling here: tickets carry the shape as the seal wrote it (tests/unit/lin-4502-witness.test.js pins a literal).
 */
import { splitQuote } from './brief-quote.js';
import { PLAN_HEADING_ANY } from './plan-heading.js';

/** The legacy block of a description filed before P2, or null. The one reader; see the exit condition above. */
function legacyBlock(description) {
  return splitQuote(description);
}

/**
 * In order:
 *   1. the block's words, when the description holds a legacy block;
 *   2. the text before the first `## Implementation Plan` heading, when it has one (a plan is stage output, not the
 *      person's words, and an immutable `asked` cannot be corrected later);
 *   3. otherwise the whole description.
 * The cut is at a heading only: a phrase such as "fits one session" in the person's own prose is their words.
 *
 * @param {string|null|undefined} description
 * @returns {string}
 */
export function askedOf(description) {
  const parts = legacyBlock(description);
  if (parts) return parts.words;
  const text = description || '';
  const plan = PLAN_HEADING_ANY.exec(text);
  return plan ? text.slice(0, plan.index).replace(/\s+$/, '') : text;
}

// Only null/undefined mean "not found". `false` is an answer (a reader may say a real "no" with it), so a negative
// outside the block must never fall through to the block.
const absent = (value) => value === null || value === undefined;

const outsideOf = (parts, description) => (parts ? parts.before + parts.below : description || '');

/**
 * Read a code-read fact (plan heading, session fit, `plan-review due:`) with the rule "outside the block wins".
 * `read` is the reader's own parser over a piece of text. On a description with a legacy block it runs first over
 * the text outside the block (above it, then below it: both are step-written), and over the block's words only when
 * that found nothing. "Nothing" is null or undefined ONLY: any other value (`false`, `'no'`, `''`) is an answer and
 * wins, so a presence predicate says absent with null (`(t) => re.test(t) || null`), not false. A description with
 * no block reads whole.
 *
 * `after` is step-written text from elsewhere that the reader appends (assembleTrailFacts' plan comment). It is
 * joined after the text outside the block, or after the whole description, so it too wins over the block.
 *
 * @template T
 * @param {string|null|undefined} description
 * @param {(text: string) => T} read
 * @param {{ after?: string }} [options]
 * @returns {T}
 */
export function readFact(description, read, { after } = {}) {
  const withAfter = (text) => (after === undefined ? text : [text, after].join('\n\n'));
  const parts = legacyBlock(description);
  const outside = read(withAfter(outsideOf(parts, description)));
  return parts && absent(outside) ? read(parts.words) : outside;
}

/**
 * The step-written text of a description: the text above a legacy block followed by the text below it, the whole
 * description when it has no block, and '' for null or undefined. readFact reads a fact here first; assembleTrailFacts'
 * plan-below check and the size record's region (lib/size-of-move.js) take the same text from here.
 *
 * @param {string|null|undefined} description
 * @returns {string}
 */
export function outsideAsked(description) {
  return outsideOf(legacyBlock(description), description);
}

/**
 * Where a legacy block sits: `{ start, end }` (the heading line's offset, and the offset just past the end line's
 * content), or null when the description has none. For the readers that keep the block's bytes intact.
 *
 * @param {string|null|undefined} description
 * @returns {{start: number, end: number}|null}
 */
export function legacyBlockSpan(description) {
  const parts = legacyBlock(description);
  return parts ? { start: parts.start, end: parts.end } : null;
}
