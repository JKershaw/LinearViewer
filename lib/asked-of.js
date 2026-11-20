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
 *   - askedOf              — a new task's `asked`;
 *   - outsideAsked         — the step-written text (the size record's region);
 *   - descriptionWithoutPlan — the description the brief's kept ticket section and the selector's view show: the old plan
 *     section is left out above and below the block, never inside it (LIN-4499 close-out).
 * LIN-4504 retired legacyBlockSpan with its one reader (the selector's plan condensing) and the selector's plan-below
 * read: plan facts are records (lib/records/plan-facts.js).
 * On a description with no block (every ticket filed from P2 on) each reads the whole description, as an unsealed
 * ticket always did. The block's shape is the brief quote's (lib/brief-quote.js splitQuote reads both), because the
 * seal wrote descriptions in exactly the shape the brief still quotes.
 *
 * Exit condition (when `legacyBlock` and the block branches below can go), all must hold:
 *   1. No reader parses a plan fact or the size record out of a description. P4 (LIN-4504) moved plans and their
 *      routing facts to records and retired the fact reader with its last caller; outsideAsked stays for the size record.
 *   2. No ticket whose description still holds a block is without a task, so askedOf is never asked to read one:
 *      the P1 import gave every open ticket its task; a records count of tickets with a block and no task reads 0.
 *   3. No description that still holds a block is shown in the brief's kept section or the selector's view
 *      (descriptionWithoutPlan): without the block branch it would cut a plan heading inside the person's words again.
 * The census (tests/unit/lin-4502-retirement-census.test.js) allows the block reader here, with this condition, and
 * nowhere else outside lib/brief-quote.js. If the brief's quote is ever reworded before this exit, freeze the old
 * spelling here: tickets carry the shape as the seal wrote it (tests/unit/lin-4502-witness.test.js pins a literal).
 */
import { splitQuote, ASKED_END } from './brief-quote.js';
import { textBeforePlan, textWithoutPlan } from './legacy-plan-text.js';

/**
 * The end line as Jira's codec gives it back: the seal wrote it in `*…*` emphasis, and a Jira description reads back
 * through adfToMarkdown (lib/providers/jira/adf.js), which renders that italic as `_…_`. Built from ASKED_END so it
 * follows the quote's spelling.
 */
const JIRA_END = `_${ASKED_END.slice(1, -1)}_`;

/**
 * The legacy block of a description filed before P2, or null. The one reader; see the exit condition above. A Jira
 * ticket's end line is read in its `_…_` form too: it is put back to `*…*` first, one character for one, so every
 * offset splitQuote reports is still the description's own.
 */
function legacyBlock(description) {
  if (typeof description !== 'string' || !description.includes(JIRA_END)) return splitQuote(description);
  const lines = description.split('\n').map((line) => {
    const crlf = line.endsWith('\r');
    return (crlf ? line.slice(0, -1) : line) === JIRA_END ? `*${JIRA_END.slice(1, -1)}*${crlf ? '\r' : ''}` : line;
  });
  return splitQuote(lines.join('\n'));
}

/**
 * In order:
 *   1. the block's words, when the description holds a legacy block;
 *   2. the text before the first plan heading (lib/legacy-plan-text.js), when it has one (a plan is stage output, not the
 *      person's words, and an immutable `asked` cannot be corrected later);
 *   3. otherwise the whole description.
 * The cut is at a heading only: a session-fit phrase in the person's own prose is their words.
 *
 * @param {string|null|undefined} description
 * @returns {string}
 */
export function askedOf(description) {
  const parts = legacyBlock(description);
  if (parts) return parts.words;
  // LIN-4504: the plan heading has one spelling, lib/legacy-plan-text.js (recognition only; it returns text).
  return textBeforePlan(description || '');
}

const outsideOf = (parts, description) => (parts ? parts.before + parts.below : description || '');

/**
 * The step-written text of a description: the text above a legacy block followed by the text below it, the whole
 * description when it has no block, and '' for null or undefined. The size record's region (lib/size-of-move.js) takes
 * its text from here.
 *
 * @param {string|null|undefined} description
 * @returns {string}
 */
export function outsideAsked(description) {
  return outsideOf(legacyBlock(description), description);
}

/**
 * LIN-4499 close-out: the description for the brief's kept ticket section and the selector's view, with the legacy plan
 * section left out. A description filed before P2 may hold a sealed `## As asked` block, and the person's words inside
 * it may themselves hold a heading that looks like a plan's (a person pasting their own idea under one): those words and the block's end
 * line are kept byte for byte. The skip applies only to the text above and below the block, where a step-written plan
 * section lives. With no block it is textWithoutPlan on the whole description. It goes through `legacyBlock`, so the
 * one reader of the block (and the Jira end-line reading) stays here and legacy-plan-text.js stays a leaf.
 *
 * @param {string|null|undefined} description
 * @returns {string}
 */
export function descriptionWithoutPlan(description) {
  const parts = legacyBlock(description);
  if (!parts) return textWithoutPlan(description);
  const block = description.slice(parts.start, parts.end);
  // The whitespace between the block and the text beside it is kept as written; only a cut section's own text goes.
  const above = /\s*$/.exec(parts.before)[0];
  const aboveText = textWithoutPlan(parts.before.slice(0, parts.before.length - above.length));
  const below = /^\s*/.exec(parts.below)[0];
  const belowText = textWithoutPlan(parts.below.slice(below.length));
  return `${aboveText ? aboveText + above : ''}${block}${belowText ? below + belowText : ''}`;
}
