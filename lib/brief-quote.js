/**
 * LIN-4501 (P1): the served brief's quote of the person's words, taken from the task's immutable `asked`
 * (lib/records-store.js askedForTickets), never from the ticket description. Moved here from lib/as-asked.js, which
 * P2 deletes, so the brief composers (lib/brief.js, the test-mode mock in lib/workspace-api-mocks.js) and the task
 * page's section parsers (lib/task-page-loader.js) do not import it. The quote keeps its shape: the words under the
 * `## As asked` heading and end line (the spellings stay lib/as-asked.js's until P2 changes them in one place), then
 * a parent's words under its own heading.
 *
 * `attachAsked` is the one step both brief routes run on a fetched context (routes/proxy-compute.js,
 * routes/workspace-api.js): they share one brief cache, and both attach the words after the context is hashed. The
 * words are not part of the cache key (lib/recap-cache.js leaves `asked` out, because it is immutable), so a brief
 * cached before its task existed gains its quote at the next context change.
 */
import { sealAsAsked, splitAsAsked, AS_ASKED_PARENT_HEADING, AS_ASKED_PARENT_END } from './as-asked.js';

/**
 * The served brief: the task's `asked`, quoted in the block's sealed shape, then the parent task's `asked` under the
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
  const quotes = [asked ? sealAsAsked(asked) : '', parentQuote(parent)].filter(Boolean);
  return quotes.length ? `${quotes.join('\n\n')}\n\n${modelBrief}` : modelBrief;
}

/** The parent ticket and its task's `asked` from a context (attachAsked), for composeBrief; null with no parent. */
export function parentWordsOf(context) {
  return context?.parent ? { identifier: context.parent.identifier, asked: context.asked?.parent ?? null } : null;
}

/** The parent's words in the brief's parent-quote shape, or '' with none. */
function parentQuote(parent) {
  if (!parent?.asked) return '';
  return `${AS_ASKED_PARENT_HEADING}${parent.identifier ? `, ${parent.identifier}` : ''}\n\n${parent.asked}\n\n${AS_ASKED_PARENT_END}`;
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
  const parts = splitAsAsked(brief);
  let end = parts && parts.start === 0 ? parts.end : 0;
  const lead = brief.slice(end).match(/^\s*/)[0].length;
  if (brief.startsWith(AS_ASKED_PARENT_HEADING, end + lead)) {
    const close = brief.indexOf(`\n${AS_ASKED_PARENT_END}`, end + lead);
    if (close !== -1) end = close + 1 + AS_ASKED_PARENT_END.length;
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
