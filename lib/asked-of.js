/**
 * LIN-4501 (P1): the words a task's immutable `asked` takes from a ticket's description. One rule for every task
 * writer: the dispatch seat (lib/dispatch-factory.js taskOnDispatch), the take fallback (lib/run-records.js), the
 * proxy's first write (routes/proxy.js) and the import. It is a leaf over the two readers it needs, so the
 * `## As asked` module (lib/as-asked.js) stays pure and the plan heading keeps its one spelling (lib/run-trail.js).
 */
import { splitAsAsked } from './as-asked.js';
import { PLAN_HEADING_ANY } from './run-trail.js';

/**
 * In order:
 *   1. the sealed words, when the description holds a block;
 *   2. the text before the first `## Implementation Plan` heading, when it has one (a plan is stage output, not the
 *      person's words, and an immutable `asked` cannot be corrected later);
 *   3. otherwise the whole description.
 * The cut is at a heading only: a phrase such as "fits one session" in the person's own prose is their words.
 *
 * @param {string|null|undefined} description
 * @returns {string}
 */
export function askedOf(description) {
  const parts = splitAsAsked(description);
  if (parts) return parts.words;
  const text = description || '';
  const plan = PLAN_HEADING_ANY.exec(text);
  return plan ? text.slice(0, plan.index).replace(/\s+$/, '') : text;
}
