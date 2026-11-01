/**
 * LIN-4070 — a held task-facts set for the readers under test.
 *
 * `/state`, the task page and the guest share page read the workspace's issue set through the holder (lib/task-facts-holder.js),
 * never through a fetch. A test builds the holder it needs with `heldTaskFacts`, which writes one COMPLETE set through the
 * real write gate, and hands the loader the same two things server.js does: the holder's READ side and the one gatherer
 * (lib/home-row-states.js). Nothing here starts a refresh; a test that needs a refresh drives `createTaskFactsRefresh` itself.
 */

import { createTaskFactsHolder } from '../../lib/task-facts-holder.js';
import { gatherTaskStates } from '../../lib/home-row-states.js';

/**
 * A holder holding one complete set of `issues` (tracker issues: `{id, identifier, title, state: {type}, parent?}`) for
 * `urlKey`, written at `now` (a Date). The holder's clock then reads `readAt` (default: `now`), so a test can hold a set
 * that is already old. The read answers complete until five minutes have passed.
 *
 * @param {{urlKey?: string, issues: Array<Object>, now: Date, readAt?: Date}} args
 * @returns {{read: Function, write: Function, ageOf: Function, invalidate: Function}}
 */
export function heldTaskFacts({ urlKey = 'acme', issues, now, readAt = now }) {
  let clock = now.getTime();
  const holder = createTaskFactsHolder({ now: () => clock });
  const { written, refusal } = holder.write(urlKey, { stateIssues: issues });
  if (!written) throw new Error(`held task facts refused: ${refusal}`);
  clock = readAt.getTime();
  return holder;
}

/**
 * The loader's dependencies for a held set: the holder's read side and the one gatherer, as server.js passes them.
 * @param {{read: Function}} holder
 * @returns {{taskFacts: {read: Function}, gatherTaskStates: Function}}
 */
export function heldLoaderDeps(holder) {
  return { taskFacts: { read: holder.read }, gatherTaskStates };
}
