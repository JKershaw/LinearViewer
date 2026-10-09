// Task-keyed run facts (LIN-3340).
//
// The close-out box consumes two run facts from outside the tracker comments:
// `stopAt` (P1a's boundary; `'pr'` gates `ready`) and `variant` (N2's copy
// choice; only a positively-standard run gets the "Harbour stops this run at the PR"
// promise). The run page reads them off the run's own dispatch row
// (`readRunFacts`, routes/dashboard.js) because it is keyed on the run's seed
// issue. The task page is keyed on the TASK, so it needs the same facts read
// per task — including a subtask worked under a parent's stop-at run, whose own
// rows are worker rows that carry neither fact.
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
 * Read a task's run facts off its dispatch rows, with the subtask `sessionId`
 * hop. Never throws.
 *
 * @param {Object} args
 * @param {Object} args.store - dispatch queue store (`listItems`/`listHistory`,
 *   and `getItemStatus` for the hop)
 * @param {string} args.urlKey
 * @param {string|null} args.issueIdentifier
 * @returns {Promise<{stopAt: ('pr'|null), variant: ('standard'|'stepper'|'unknown')}>}
 */
export async function readTaskRunFacts({ store, urlKey, issueIdentifier } = {}) {
  if (!store || !urlKey || !issueIdentifier) return { ...RUN_FACT_DEFAULTS };
  try {
    const rows = [];
    if (typeof store.listItems === 'function') {
      rows.push(...listRows(await Promise.resolve(store.listItems(urlKey, { issueIdentifier })).catch(() => [])));
    }
    if (typeof store.listHistory === 'function') {
      rows.push(...listRows(await Promise.resolve(store.listHistory(urlKey, { issueIdentifier })).catch(() => null)));
    }

    let stopAt = rows.some(row => row && row.stopAt === 'pr') ? 'pr' : null;
    const kickoff = rows.find(row => row && row.kind === 'autopilot') || null;
    let variant = resolveRunVariant(kickoff);

    // The subtask hop: worker rows carry no `stopAt`/`variant`, only a
    // `sessionId` that names the parent run row. Take either fact from it when
    // the identifier's own rows don't carry it. `'unknown'` counts as "not
    // found" (a subtask's own kickoff is not an autopilot run row).
    const needsHop = !stopAt || variant === 'unknown';
    if (needsHop && typeof store.getItemStatus === 'function') {
      const sessionIds = [...new Set(rows.map(row => row && row.sessionId).filter(Boolean))];
      for (const sessionId of sessionIds) {
        const runRow = await Promise.resolve(store.getItemStatus(urlKey, sessionId)).catch(() => null);
        if (!runRow) continue;
        if (!stopAt && runRow.stopAt === 'pr') stopAt = 'pr';
        if (variant === 'unknown') {
          const hopVariant = resolveRunVariant(runRow);
          if (hopVariant !== 'unknown') variant = hopVariant;
        }
        if (stopAt && variant !== 'unknown') break;
      }
    }

    return { stopAt, variant };
  } catch (err) {
    console.error('Task run-facts read failed:', err && err.message);
    return { ...RUN_FACT_DEFAULTS };
  }
}
