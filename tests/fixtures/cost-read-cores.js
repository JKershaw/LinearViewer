/**
 * Synchronous adapters over the cost read's pure cores (LIN-4226).
 *
 * The read entries (readCost, lineageRecords, buildRunView, the terminal-cost helpers) load their request records
 * through a source, so they are async. Most of these tests pin FIGURES over records the test already holds, so they
 * call the pure cores (`*OverRecords`) with those records, synchronously, exactly as the old `withDefaults` wrappers
 * did. The assertions are unchanged; only the call shape is.
 *
 * "No records" is named, never a silent default: a test that means it passes NO_RECORDS_ON_PURPOSE. Production code
 * has no such default (lib/request-usage-loader.js NO_REQUEST_RECORDS is the named source the async entries take).
 */
import { readCostOverRecords, lineageRecordsOverRecords, lineageFigureOf as lineageFigureOf__core } from '../../lib/cost-read.js';
import { renderSessionPage as renderSessionPage__core } from '../../lib/render-session.js';
import { buildRunViewOverRecords } from '../../lib/run-view.js';
import { groupDispatchLineages } from '../../lib/dispatch-lineage.js';
import { computeTerminalMarkedTaskCost as computeTerminalMarkedTaskCost__core, terminalMarkedTaskCostDetail as terminalMarkedTaskCostDetail__core } from '../../lib/terminal-marked-task-cost.js';
import { agentSpendByJob as agentSpendByJob__core, typicalByModel as typicalByModel__core } from '../../lib/model-routing-spend.js';

/** The records of "no request records on purpose" for the synchronous cores (a named constant, not an inline []). */
export const NO_RECORDS_ON_PURPOSE = Object.freeze([]);

/** The cost read over rows (the figures `readCost` gives), with the records the test holds. */
export function readCostOf({ requestRows = NO_RECORDS_ON_PURPOSE, ...params } = {}) {
  return readCostOverRecords(params, requestRows);
}

/** The lineage records `lineageRecords` gives, with the records the test holds. */
export function lineageRecordsOf({ requestRows = NO_RECORDS_ON_PURPOSE, ...params } = {}) {
  return lineageRecordsOverRecords(params, requestRows);
}

/** The run view `buildRunView` gives, with the records the test holds. */
export function buildRunViewOf(session = {}, { now, requestRows = NO_RECORDS_ON_PURPOSE } = {}) {
  return buildRunViewOverRecords(session, { now, records: requestRows });
}

/** The lineage records a terminal-cost helper takes (`costLineages`), built from the rows the test holds. */
function costLineagesOf(rows, { identityRows = [], requestRows = NO_RECORDS_ON_PURPOSE } = {}) {
  return lineageRecordsOverRecords({ fetchedRows: rows, identityRows, outcomes: groupDispatchLineages(rows) }, requestRows);
}

/** `computeTerminalMarkedTaskCost` over rows the test holds. */
export function terminalMarkedTaskCostOf(rows, now, options = {}) {
  return computeTerminalMarkedTaskCost__core(rows, now, { costLineages: costLineagesOf(rows, options) });
}

/** `terminalMarkedTaskCostDetail` over rows the test holds. */
export function terminalMarkedTaskCostDetailOf(rows, now, options = {}) {
  return terminalMarkedTaskCostDetail__core(rows, now, { costLineages: costLineagesOf(rows, options) });
}

/** The read's `workerSessions` over rows the test holds (what the Models page carries). */
export function workerSessionsOf(rows, { identityRows = [], requestRows = NO_RECORDS_ON_PURPOSE } = {}) {
  return readCostOverRecords({ fetchedRows: rows || [], identityRows: identityRows || [] }, requestRows).workerSessions;
}

/** `agentSpendByJob` over rows the test holds: the spend readers take the read's workerSessions. */
export function agentSpendByJobOf(rows, { jobs, identityRows, requestRows } = {}) {
  return agentSpendByJob__core(workerSessionsOf(rows, { identityRows, requestRows }), { jobs });
}

/** `typicalByModel` over rows the test holds: the spend readers take the read's workerSessions. */
export function typicalByModelOf(rows, { job, identityRows, requestRows } = {}) {
  return typicalByModel__core(workerSessionsOf(rows, { identityRows, requestRows }), { job });
}

/** `lineageFigureOf` over one lineage's rows, with that lineage's records (the figure is synchronous in production too). */
export function lineageFigureOfOf(rows, { requestRows = NO_RECORDS_ON_PURPOSE } = {}) {
  return lineageFigureOf__core(rows, { records: requestRows });
}

/**
 * `renderSessionPage` with the run view the route would pass (LIN-4226: the page never builds the view itself). The
 * view is built through the pure core from the session and the records the test holds; a page with `runView` given
 * uses that view, and a 404 page (no session) needs none.
 */
export function renderSessionPageOf(data = {}, options = {}) {
  const { requestRows = NO_RECORDS_ON_PURPOSE, ...rest } = options;
  const runView = data.runView ?? (data.session ? buildRunViewOverRecords(data.session, { now: options.now, records: requestRows }) : null);
  return renderSessionPage__core({ ...data, runView }, rest);
}
