/**
 * The task's recent runs, as the stage selector reads them (LIN-3300).
 *
 * Harbour records every dispatch: its stage (`kind`), when it finished and how it
 * ended. The selector gets the last few as plain facts, so "the plan was revised
 * after the verdict" or "an agent acted since your comment" is visible directly,
 * whatever the ticket's prose says. No runs, no list: the selector then decides from
 * the ticket alone. The same read also gives the code routes every stage run, unsliced: the
 * live-stage wait (LIN-4392) reads which is live, the look-first route (LIN-4370) which steps
 * were attempted.
 */
import { PROMPT_TEMPLATES } from './prompt-templates.js';
import { deriveWireStatus, deriveCompletedAt, harvestAbortedTargets, feedbackWithHarvestedAbort } from './dispatch-terminal.js';
import { toEpochMs } from './utils/time.js';
import { BLIND_READ_KIND } from './prompts/blind-read-words.js';

/** How many runs the selector sees, newest kept. */
export const RECENT_RUNS = 5;

/** The outcome of a taken run that reports blocked. The look-first route reads it too (LIN-4370). */
export const WAITING_ON_A_PERSON = 'waiting on a person';

/** The outcomes of a run still in the store's hands: in the queue, or taken with no terminal marker. */
export const QUEUED = 'queued';
export const RUNNING = 'running';

/**
 * Whether a run fact is live (queued or running). The live-stage wait holds a ticket on one
 * (LIN-4392, lib/recommendation-live-wait.js). Waiting on a person is not live here: it is the
 * look-first route's own off-switch. This reads run facts
 * from one ticket's run read; lib/live-anchor.js liveOnAnchor is the predicate over enriched
 * loops, which this path does not read (a second store read).
 */
export const isLiveRun = (run) => run?.outcome === QUEUED || run?.outcome === RUNNING;

const iso = (t) => (t instanceof Date ? t.toISOString() : t || null);

/**
 * Dispatch rows → run facts, oldest first, every one (LIN-4370: the look-first route reads
 * attempts from this unsliced list; the selector reads recentRuns' slice of it). Only stage
 * runs count: a `custom`, `autopilot`, wake or abort row is not a stage, and a cancelled or
 * expired row never ran. A row still in the queue is `queued`; a taken one is `running`
 * until it posts a terminal marker, or `waiting on a person` while it reports blocked. A run
 * an abort stopped is `aborted`: the marker lands on the abort row, so it is harvested by the
 * abort's `abortTo` link, as every other reader does (LIN-1257). Age alone never ends a run;
 * this reports what the store says. A run with no time sorts last. `dispatchedAt` is when the
 * run was sent, whatever `at` says (for an ended run `at` is when it ended): "a run sent after
 * a person's comment" reads it (LIN-4346 verdict note 3). `id` is the dispatch id, so a live run
 * the live-stage wait holds on can be named and adopted. Facts only: no run's messages.
 * @param {Array<Object>} rows - formatted queue and history rows (lib/dispatch-store.js)
 * @returns {Array<{stage: string, at: string|null, outcome: string, dispatchedAt: string|null, id: string|null}>}
 */
export function stageRuns(rows = []) {
  const aborted = harvestAbortedTargets(rows);
  return rows
    .filter(r => r && PROMPT_TEMPLATES[r.kind] && !r.abort && (r.status === 'pending' || r.status === 'taken' || !r.status))
    .map(r => ({ ...runFact(r, aborted), dispatchedAt: iso(r.dispatchedAt), id: r.id == null ? null : String(r.id) }))
    .sort((a, b) => {
      const x = toEpochMs(a.at) ?? Infinity;
      const y = toEpochMs(b.at) ?? Infinity;
      return x === y ? 0 : x < y ? -1 : 1;
    });
}

/** One stage row's run fact: its stage, the time its outcome is dated by, and the outcome. */
function runFact(r, aborted) {
  if (r.status === 'pending') return { stage: r.kind, at: iso(r.dispatchedAt), outcome: QUEUED };
  const feedback = feedbackWithHarvestedAbort(r.feedback, aborted.get(String(r.id)));
  const status = deriveWireStatus({ feedback, bookkeeping: r.bookkeeping });
  if (status === 'blocked') return { stage: r.kind, at: iso(feedback.at(-1)?.timestamp), outcome: WAITING_ON_A_PERSON };
  // A stamped row has no terminal marker, so its end time is the stamp's (LIN-3364): a null time would sort it newest.
  if (status === 'closed') return { stage: r.kind, at: iso(r.bookkeeping?.at), outcome: 'closed' };
  if (status) return { stage: r.kind, at: deriveCompletedAt(feedback), outcome: status };
  return { stage: r.kind, at: iso(r.dispatchedAt), outcome: RUNNING };
}

/**
 * The selector's runs: the newest `limit` of stageRuns, each as `{stage, at, outcome}` (the
 * selector's lines read nothing else, so its prompt bytes do not depend on `dispatchedAt`).
 * @param {Array<Object>} rows - formatted queue and history rows (lib/dispatch-store.js)
 * @param {number} [limit]
 * @returns {Array<{stage: string, at: string|null, outcome: string}>}
 */
export function recentRuns(rows = [], limit = RECENT_RUNS) {
  return selectorSlice(stageRuns(rows), limit);
}

/**
 * The selector's slice of the run facts. A `blind-read` run is left out, before the newest `limit`
 * are kept (LIN-4437): the selector never sends one, so a line about it can only mislead the
 * person-comment rule ("unless a later dispatched run"), which would read a read as an agent
 * acting on the person's comment. Both callers (recentRuns, loadRecentRuns) slice here; `allRuns`
 * stays unsliced, so the live-stage wait still sees a live read.
 */
const selectorSlice = (runs, limit = RECENT_RUNS) => runs
  .filter(({ stage }) => stage !== BLIND_READ_KIND)
  .slice(-limit)
  .map(({ stage, at, outcome }) => ({ stage, at, outcome }));

/** The history rows one read asks for: 20 dispatch rows, counted before non-stage rows are dropped. */
export const HISTORY_ROWS = 4 * RECENT_RUNS;

/**
 * Read an issue's runs from the dispatch store, live rows and finished ones, in ONE read
 * (LIN-4370): `runs`, the selector's slice (recentRuns), and `allRuns`, every stage run the
 * read returned (stageRuns), for the live-stage wait (LIN-4392) and the look-first route's
 * attempts. The history read is up to
 * HISTORY_ROWS dispatch rows before autopilot, custom, wake and abort rows are filtered out,
 * plus every live row. Never throws. A missing store or a failed read is no runs for the
 * selector and `allRuns: null`, "attempts unknown", so the live-stage wait and the look-first
 * route stand aside rather than hold a ticket or re-send a step they cannot see.
 * @returns {Promise<{runs: ReturnType<typeof recentRuns>, allRuns: ReturnType<typeof stageRuns>|null}>}
 */
export async function loadRecentRuns(store, urlKey, issueIdentifier) {
  if (!store || !urlKey || !issueIdentifier) return { runs: [], allRuns: null };
  try {
    // In parallel; a synchronous throw becomes a rejection, so neither read is left unhandled.
    const read = (fn) => Promise.resolve().then(fn);
    const [live, history] = await Promise.all([
      read(() => store.listItems(urlKey, { issueIdentifier, projection: { prompt: 0 } })),
      read(() => store.listHistory(urlKey, { issueIdentifier, limit: HISTORY_ROWS, projection: { prompt: 0 } }))
    ]);
    const allRuns = stageRuns([...(live || []).map(r => ({ ...r, status: 'pending' })), ...(history?.items || [])]);
    return { runs: selectorSlice(allRuns), allRuns };
  } catch {
    return { runs: [], allRuns: null };
  }
}

/**
 * The selector's run lines, or '' when there are none.
 * @param {ReturnType<typeof recentRuns>} [runs]
 * @returns {string}
 */
export function formatRecentRuns(runs) {
  if (!runs?.length) return '';
  const when = (at) => (at ? String(at).slice(0, 16).replace('T', ' ') : 'undated');
  return [`- Recent runs on this task, from Harbour's dispatch record (oldest first):`,
    ...runs.map(r => `  - ${r.stage}: ${r.outcome}${isLiveRun(r) ? ', started' : ','} ${when(r.at)}`)
  ].join('\n');
}
