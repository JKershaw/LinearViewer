/**
 * The brief `GET /api/proxy/brief/:id` answers (LIN-4495 built the parts behind `?run=`; LIN-4536 made them the whole
 * brief, read for the credential's own run, with no `?run=` and nothing written by a model).
 *
 * composeRunBrief is a run's brief on its own task, read as its stage. composeTaskBrief is any task's brief read as a
 * named reader: a person (`person:<accountId>`), the coordinator, or a run's stage reading another task than its own.
 * Both gather the records through the store's indexed readers only: the task's own records (`inRef`), the records
 * addressed to the task, to the reader, to the project (open ones), the stands decisions, and the records of each
 * ancestor task. Neither reads the workspace's whole history (the store's `snapshots` and `index` do; this does not),
 * so the cost of a brief read follows the task, not the workspace (LIN-4493 review: the agents' busiest read).
 *
 * Nothing is cached here: an ended record is gone from the next read at once.
 *
 * Every read is logged (decision 8). Only a run's brief on its own task logs under the run (`recordId`): the person
 * findings it carried are ended when that run ends (LIN-4535, `carriedOfRun`). A brief read as anyone else, or by a run
 * on another task, carries nothing for a run to end.
 *
 * Pure over an injected store (Records imports only Platform); the caller decides who may read (a blind read may not).
 */
import { buildBrief } from './brief.js';
import { KINDS } from './check.js';
import { MAX_TICKET_DEPTH } from './refs.js';

/** A run's reader: its stage, else its writer. */
export const readerOfRun = (run) => run.fields?.stage || run.by;

/**
 * @param {Object} args
 * @param {import('../records-store.js').RecordsStore} args.store
 * @param {string} args.urlKey - the workspace
 * @param {string} args.taskId - the task the brief is for
 * @param {string} args.actor - the reader: a stage kind, the coordinator, or `person:<accountId>`
 * @param {string|null} [args.asker] - who asked, for the query log (lib/records-store.js logQuery)
 * @param {string|null} [args.runId] - the run whose own brief this is: its carried ids are logged under it
 * @returns {Promise<{problem: string} | {task: string, actor: string, text: string, carries: string[], bytes: number}>}
 */
export async function composeTaskBrief({ store, urlKey, taskId, actor, asker = null, runId = null }) {
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
  const ids = new Set([taskId, ...(runId ? [runId] : []), ...ancestors, ...found.map((r) => r.id)]);
  const idx = await store.lookup(urlKey, [...ids]);

  const built = buildBrief({ actor, taskId, idx });
  if (built.problem) return { problem: built.problem };
  // LIN-4535: a run's own brief logs its carried ids with the run, so the run's end ends the person findings it carried (the ender).
  await store.logQuery(urlKey, { by: asker, cmd: 'brief', taskId, recordId: runId, carries: built.carries });
  return { task: taskId, actor, text: built.text, carries: built.carries, bytes: built.bytes };
}

/**
 * A run's brief on its own task, read as its stage.
 * @param {Object} args
 * @param {import('../records-store.js').RecordsStore} args.store
 * @param {string} args.urlKey - the workspace
 * @param {string} args.runId - the run the brief is for (its stage is the reader)
 * @param {string|null} [args.asker] - who asked, for the query log (lib/records-store.js logQuery)
 * @returns {Promise<{problem: string} | {task: string, actor: string, text: string, carries: string[], bytes: number}>}
 */
export async function composeRunBrief({ store, urlKey, runId, asker = null }) {
  const run = await store.run(urlKey, runId);
  if (!run) return { problem: `run '${runId}' is not on record` };
  if (!run.in) return { problem: `run '${runId}' names no task` };
  return composeTaskBrief({ store, urlKey, taskId: run.in, actor: readerOfRun(run), asker, runId });
}
