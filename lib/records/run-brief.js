/**
 * LIN-4495 (piece 4 of LIN-4491): the records parts behind today's brief door, for one run.
 *
 * `GET /api/proxy/brief/:id?run=<run id>` returns these parts first, then today's distilled brief unchanged
 * (lib/brief.js and its cache are not touched; design §3, the ticket section is kept until slice 4). This module
 * composes the parts from the store, through its indexed readers only: the task's own records (`inRef`), the records
 * addressed to the task, to the run's stage, to the project (open ones), the stands decisions, and the records of each
 * ancestor task. It never reads the workspace's whole history (the store's `snapshots` and `index` do; this does not),
 * so the cost of a brief read follows the task, not the workspace (LIN-4493 review: the agents' busiest read).
 *
 * Nothing is cached here: an ended record is gone from the next read at once, which is the rule the piece asks for.
 *
 * Pure over an injected store (Records imports only Platform); the caller decides who may read (a blind read may not).
 */
import { buildBrief } from './brief.js';
import { KINDS } from './check.js';
import { MAX_TICKET_DEPTH } from './refs.js';

/**
 * @param {Object} args
 * @param {import('../records-store.js').RecordsStore} args.store
 * @param {string} args.urlKey - the workspace
 * @param {string} args.runId - the run the brief is for (its stage is the reader)
 * @param {string|null} [args.asker] - who asked, for the query log (lib/records-store.js logQuery)
 * @returns {Promise<{problem: string} | {text: string, carries: string[], bytes: number}>}
 */
export async function composeRunBrief({ store, urlKey, runId, asker = null }) {
  const run = await store.run(urlKey, runId);
  if (!run) return { problem: `run '${runId}' is not on record` };
  const taskId = run.in ?? null;
  if (!taskId) return { problem: `run '${runId}' names no task` };
  const actor = run.fields?.stage || run.by;

  // The ancestors' task ids, nearest first: their records are part of what stands about this task.
  const ancestors = [];
  let cur = taskId;
  for (let depth = 0; depth < MAX_TICKET_DEPTH; depth += 1) {
    const { snap } = await store.read(urlKey, cur);
    if (!snap || !snap.in) break;
    ancestors.push(snap.in);
    cur = snap.in;
  }

  const found = [
    ...await store.find(urlKey, { inRef: taskId }),
    ...await store.find(urlKey, { to: taskId }),
    ...await store.find(urlKey, { to: actor }),
    ...await store.find(urlKey, { to: KINDS.addressees.project, state: 'open' }),
    ...await store.find(urlKey, { kind: 'decision', state: 'stands' }),
    ...(await Promise.all(ancestors.map((a) => store.find(urlKey, { inRef: a })))).flat(),
  ];
  const ids = new Set([taskId, runId, ...ancestors, ...found.map((r) => r.id)]);
  const idx = await store.lookup(urlKey, [...ids]);

  const built = buildBrief({ actor, taskId, idx });
  if (built.problem) return { problem: built.problem };
  await store.logQuery(urlKey, { by: asker, cmd: 'brief', taskId, recordId: runId });
  return { text: built.text, carries: built.carries, bytes: built.bytes };
}
