/**
 * lib/ruling-standing.js — the workspace's ruling standing, read one way (LIN-4024).
 *
 * The task page's loader and Home's row states both read it: the badge's own reduction over a set of loops, with
 * the workspace's unanswered task-scan decisions and shelves. One reader, so a row, the count line, a task page
 * and the badge cannot read it differently. No loader import here, so both callers can import it.
 */

import { rulingStandingOf } from './unanswered-decisions.js';

/**
 * The workspace's ruling standing, read the one way every surface reads it (LIN-4024): the badge's own reduction
 * (`rulingStandingOf`) over the given loops, with the workspace's unanswered task-scan decisions and shelves. The
 * task-page loader passes its 30-day window and one task's decisions (`identifier`); Home passes every loop and
 * every decision in the workspace.
 *
 * @param {Object} input
 * @param {string} input.urlKey
 * @param {Array<Object>} input.loops - the loops the reduction reads (already windowed by the caller, if it windows)
 * @param {Date} input.at - the reduction's clock
 * @param {Iterable<string>|null} [input.identifiers] - when set, only these tasks' task-scan decisions count (LIN-4049:
 *   a task's subtree, read once per poll)
 * @param {Object|null} [input.taskDecisionsStore]
 * @param {Object|null} [input.shelvedRulingsStore]
 * @param {Function} input.enrichLoop
 * @returns {Promise<Object>} `rulingStandingOf`'s result
 */
export async function readRulingStanding({ urlKey, loops, at, identifiers = null, taskDecisionsStore = null, shelvedRulingsStore = null, enrichLoop }) {
  const scoped = identifiers ? new Set(identifiers) : null;
  const [taskDecisions, shelvedRulings, newestScanByTask] = await Promise.all([
    taskDecisionsStore ? taskDecisionsStore.listUnansweredForWorkspaces([urlKey]) : [],
    shelvedRulingsStore ? shelvedRulingsStore.listForWorkspaces([urlKey]) : [],
    taskDecisionsStore ? taskDecisionsStore.listNewestScanPerTask([urlKey]) : {},
  ]);
  return rulingStandingOf({
    urlKey,
    loops,
    taskDecisions: scoped ? taskDecisions.filter((entry) => scoped.has(entry.issueIdentifier)) : taskDecisions,
    shelvedRulings,
    newestScanByTask,
  }, { now: at, enrichLoop });
}
