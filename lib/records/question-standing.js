/**
 * LIN-4538 (LIN-4529 plan P7a): whether a run is waiting on a question, read from question records.
 *
 * The lane logic (lib/observer-sweep.js classifyLoop) needs one fact per lineage: a blocked row is still waiting on a
 * person when its lineage has an OPEN question, is discharged when its questions have all ended (answered, dismissed,
 * closed with its ticket), and is waiting on nothing it asked when it has no question at all (it parked without asking).
 *
 * A lineage's id is its root row's id (`rootItemId ?? loopId`, lib/pipeline-loops.js), and a question's `run` is the id of
 * the run it was asked under, which is the root row of the lineage (lib/run-identity.js: a follow-up belongs to the run it
 * resumes). So the key is the same on both sides.
 */
import { questionFacts } from './question-facts.js';

/** A lineage with an open question. */
export const QUESTION_WAITING = 'waiting';
/** A lineage whose questions have all ended, with at least one ended. */
export const QUESTION_SETTLED = 'settled';

/**
 * One standing per run id. Waiting wins: a run with any open question is waiting, whatever else it asked.
 * @param {Array<{runId: string|null, state: string}>} facts - questionFacts' rows
 * @returns {Map<string, 'waiting'|'settled'>}
 */
export function questionStandingByRun(facts) {
  const standing = new Map();
  for (const f of facts || []) {
    if (!f?.runId) continue;
    if (f.state === 'open') standing.set(f.runId, QUESTION_WAITING);
    else if (!standing.has(f.runId)) standing.set(f.runId, QUESTION_SETTLED);
  }
  return standing;
}

/**
 * The standing map for one workspace, read from its question records (one questionFacts read).
 * @param {import('../records-store.js').RecordsStore} recordsStore
 * @param {string} urlKey
 * @returns {Promise<Map<string, 'waiting'|'settled'>>}
 */
export async function questionStandingOf(recordsStore, urlKey) {
  return questionStandingByRun(await questionFacts(recordsStore, urlKey));
}
