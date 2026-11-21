/**
 * LIN-4501 (P1): the words a task's immutable `asked` takes from a ticket's description. One rule for every task
 * writer. It is injected as `askedText` into the checked write pipeline (lib/records/writes.js) at every place that
 * can make a task: server.js (`ticketWriter`, which the dispatch seat in lib/dispatch-factory.js and the take fallback
 * in lib/run-records.js reach through the `taskForTicketAt` seam), the proxy's first write (routes/proxy.js) and the
 * task page and project page writers (routes/task-records.js, routes/project-page.js).
 *
 * LIN-4527: `asked` is the request as it was filed. The whole description, untrimmed: no plan heading is cut from it
 * (the plan is records; a description's old plan section stays where it is, as display), and the `## As asked` seal
 * (LIN-4502) is no longer read here. A description filed before that seal still carries its block, and the block's
 * words are the words the person filed with it, so they are read whole too. What this does not cover: a task made later
 * for a closed ticket (an ancestor) freezes whatever its description holds then, a step-written plan included. That
 * is accepted (John's ruling on LIN-4522, stated on LIN-4527); no code here handles it.
 */

/**
 * The request as filed, for a new task's `asked`.
 *
 * @param {string|null|undefined} description
 * @returns {string}
 */
export function askedOf(description) {
  return typeof description === 'string' ? description : '';
}
