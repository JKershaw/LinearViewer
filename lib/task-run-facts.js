// Task-keyed run facts (LIN-3340).
//
// The close-out box consumes two run facts from outside the tracker comments:
// `stopAt` (P1a's boundary; `'pr'` gates `ready`) and `variant` (N2's copy
// choice; only a positively-standard run gets the "Harbour stops this run at the PR"
// promise). The run page reads them off the run's own dispatch row
// (`readRunFacts`, routes/dashboard.js), keyed on the run's seed issue, by
// calling `readTaskRunFacts` with `hopVariant: false` (LIN-3725: the run page
// takes `stopAt` through the same hop as the task page, its variant stays the
// seed issue's own kickoff row). The task page is keyed on the TASK, so it needs
// the same facts read per task — including a subtask worked under a parent's
// stop-at run, whose own rows are worker rows that carry neither fact.
//
// The `sessionId` hop is the dispatch guard's own read (LIN-3245,
// `dispatch-factory.js:595-607`): a subtask row's `sessionId` names the parent
// run row, which does carry `stopAt`/`variant`. Reusing that definition keeps
// the check route's Done path and the guard from drifting.
//
// Fail closed: an unknown/missing/non-autopilot kickoff is `'unknown'`, never
// `'standard'`, so N2's promise is shown only when the run is POSITIVELY
// standard (the variant the seam guard actually backs). Any error, or a store
// without `getItemStatus`, degrades to the defaults and skips the hop.

import { listRows, resolveRunVariant } from './run-closeout-state.js';

/** The safe defaults: no stop boundary, unknown variant (promise stays closed). */
export const RUN_FACT_DEFAULTS = Object.freeze({ stopAt: null, variant: 'unknown' });

/**
 * The one "any row declares stopAt 'pr', so the task stops at the PR" rule
 * (LIN-3722). Used by `readTaskRunFacts` below, which the run page's
 * `readRunFacts` (routes/dashboard.js) now calls too (LIN-3725), so both pages
 * take `stopAt` through the same `sessionId` hop and store-method guards.
 * Falsy rows are skipped; any other `stopAt` ('merge', null, undefined) is null.
 *
 * @param {Array<Object|null|undefined>} rows
 * @returns {('pr'|null)}
 */
export function stopAtFromRows(rows) {
  return rows.some(row => row && row.stopAt === 'pr') ? 'pr' : null;
}

// LIN-3812: two scalars (`stopAt`, `variant`) off the task's rows; neither the prompt (8-30 KB), the
// raw feedback nor the digest is read, so none is transferred. An explicit projection also skips the
// store's digest self-heal, which this read has no use for.
const RUN_FACT_PROJECTION = { prompt: 0, feedback: 0, feedbackDigest: 0 };

/**
 * Read a task's run state off its dispatch rows, with the subtask `sessionId` hop (LIN-4104 D4). Never throws.
 *
 * `found` is the review's found/not-found signal (note 3): a run row (the task's own autopilot kickoff, a row that
 * declares a stop, or the hop's parent run row) was read. `runId` names it. A found unbounded run has `stopAt: null`
 * and `found: true`, which is not the same as no row (`found: false`), though both carry the same `stopAt: null`.
 *
 * @param {Object} args
 * @param {Object} args.store - dispatch queue store (`listItems`/`listHistory`,
 *   and `getItemStatus` for the hop)
 * @param {string} args.urlKey
 * @param {string|null} args.issueIdentifier
 * @param {boolean} [args.hopVariant=true] - false: the hop lifts `stopAt` only
 *   and `variant` stays the identifier's own kickoff row (the run page, which
 *   changed `stopAt` only in LIN-3725)
 * @returns {Promise<{found: boolean, runId: (string|null), stopAt: ('pr'|null), variant: ('standard'|'stepper'|'unknown')}>}
 */
export async function readTaskRunState({ store, urlKey, issueIdentifier, hopVariant = true } = {}) {
  const none = { found: false, runId: null, stopAt: null, variant: 'unknown' };
  if (!store || !urlKey || !issueIdentifier) return { ...none };
  try {
    const rows = [];
    if (typeof store.listItems === 'function') {
      rows.push(...listRows(await Promise.resolve(store.listItems(urlKey, { issueIdentifier, projection: RUN_FACT_PROJECTION })).catch(() => [])));
    }
    if (typeof store.listHistory === 'function') {
      rows.push(...listRows(await Promise.resolve(store.listHistory(urlKey, { issueIdentifier, projection: RUN_FACT_PROJECTION })).catch(() => null)));
    }

    let stopAt = stopAtFromRows(rows);
    const kickoff = rows.find(row => row && row.kind === 'autopilot') || null;
    // The row's own persisted `variant` is the authoritative source (never
    // `promptName` — a real stepper kickoff is named `Autopilot (LIN-NNNN)`).
    let variant = resolveRunVariant(kickoff);
    // Found: the task's own kickoff, else a row that declares the stop (a run row whose kind is not recorded).
    let found = !!kickoff;
    let runId = kickoff ? (kickoff._id ?? kickoff.id ?? null) : null;
    if (!found && stopAt) {
      const declaring = rows.find(row => row && row.stopAt === 'pr');
      found = true;
      runId = declaring ? (declaring._id ?? declaring.id ?? null) : null;
    }

    // The subtask hop: worker rows carry no `stopAt`/`variant`, only a
    // `sessionId` that names the parent run row. Take either fact from it when
    // the identifier's own rows don't carry it. `'unknown'` counts as "not
    // found" (a subtask's own kickoff is not an autopilot run row).
    const needsHop = !found || !stopAt || (hopVariant && variant === 'unknown');
    if (needsHop && typeof store.getItemStatus === 'function') {
      const sessionIds = [...new Set(rows.map(row => row && row.sessionId).filter(Boolean))];
      for (const sessionId of sessionIds) {
        const runRow = await Promise.resolve(store.getItemStatus(urlKey, sessionId)).catch(() => null);
        if (!runRow) continue;
        if (!found) { found = true; runId = sessionId; }
        if (!stopAt && runRow.stopAt === 'pr') stopAt = 'pr';
        if (hopVariant && variant === 'unknown') {
          const parentVariant = resolveRunVariant(runRow);
          if (parentVariant !== 'unknown') variant = parentVariant;
        }
        if (found && stopAt && (!hopVariant || variant !== 'unknown')) break;
      }
    }

    return { found, runId, stopAt, variant };
  } catch (err) {
    console.error('Task run-facts read failed:', err && err.message);
    return { ...none };
  }
}

/**
 * The stored facts the run page and close-out read: `{ stopAt, variant }` (LIN-3340). The found signal is
 * `readTaskRunState`'s; a caller that needs to tell "no run" from "an unbounded run" calls that instead.
 *
 * @returns {Promise<{stopAt: ('pr'|null), variant: ('standard'|'stepper'|'unknown')}>}
 */
export async function readTaskRunFacts(args = {}) {
  const { stopAt, variant } = await readTaskRunState(args);
  return { stopAt, variant };
}

/**
 * The running line's words (LIN-4104 D4, review note 3). A found run reads its bound ("Running to PR" for a stop at the
 * PR, "Running to Done" when unbounded) and, when the first worker is known, what it started with. Only a run row that is
 * not found reads "Harbour is deciding".
 *
 * @param {{found: boolean, stopAt: ('pr'|null), stage?: (string|null), identifier?: (string|null)}} input
 * @returns {string}
 */
export function runWordsOf({ found, stopAt = null, stage = null, identifier = null } = {}) {
  if (!found) return 'Harbour is deciding';
  const bound = stopAt === 'pr' ? 'Running to PR' : 'Running to Done';
  return stage && identifier ? `${bound} · started with ${stage} on ${identifier}` : bound;
}
