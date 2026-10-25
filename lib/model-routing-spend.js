/**
 * Spend per job, for the Settings › Models page (LIN-3855). Pure: the callers read the rows
 * (dispatch history for agent sessions, the call log for Harbour calls) and pass them in.
 *
 * Both readers keep the rule the rest of the app keeps (lib/task-cost.js, LIN-1086): a run whose
 * price is unknown is UNPRICED, never $0, and a run that posted no [usage] at all is NO-TELEMETRY,
 * never $0 either. So `spendUsd` is the sum of what is priced, and the page states the coverage
 * next to it.
 *
 * Every job in `jobs` appears in the output, with zero runs when it has none. The caller orders
 * them (`byJobSpend`), so an empty job is listed rather than hidden.
 *
 *   { id, runs, priced, unpriced, noTelemetry, spendUsd, typicalUsd, models }
 *
 * `typicalUsd` is the mean of the priced runs (null when none), `models` the distinct models the
 * runs reported, sorted.
 */
import { buildTaskCost } from './task-cost.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The shared shape, from one job's runs. Each run is `{ costUsd, model, telemetry }`. */
function summarise(id, runs) {
  let priced = 0;
  let unpriced = 0;
  let noTelemetry = 0;
  let spendUsd = 0;
  const models = new Set();
  for (const run of runs) {
    if (run.model) models.add(run.model);
    if (finite(run.costUsd)) {
      priced += 1;
      spendUsd += run.costUsd;
    } else if (run.telemetry === false) {
      noTelemetry += 1;
    } else {
      unpriced += 1;
    }
  }
  return {
    id,
    runs: runs.length,
    priced,
    unpriced,
    noTelemetry,
    spendUsd,
    typicalUsd: priced ? spendUsd / priced : null,
    models: [...models].sort()
  };
}

/**
 * Agent-session spend per job, over dispatch rows in the `/dispatch` list shape. The rows are the
 * read's window, so a lineage that straddles the window's start is attributed to its earliest
 * in-window row's kind (buildTaskCost's merge base). Queued and other non-taken rows never ran and
 * are dropped there.
 *
 * `telemetry` on a run is buildTaskCost's flag: false means the run posted no [usage].
 */
export function agentSpendByJob(rows, { jobs }) {
  const { workerSessions } = buildTaskCost({ ownRows: rows || [] });
  return jobs.map((id) => summarise(id, workerSessions.filter((s) => s.kind === id)));
}

/**
 * Harbour-call spend per job, over call-log docs (`{ feature, model, cost }`). A feature is a job
 * id. Every call writes a row, so there is no no-telemetry arm for these: `noTelemetry` is 0.
 */
export function harbourSpendByJob(docs, { jobs }) {
  return jobs.map((id) => {
    const runs = (docs || [])
      .filter((d) => d && d.feature === id)
      .map((d) => ({ costUsd: finite(d.cost) ? d.cost : null, model: d.model || null, telemetry: true }));
    return summarise(id, runs);
  });
}

/**
 * The order the page lists jobs in: by priced spend (largest first), then by runs, then by the
 * registry's order (`registryIndex`, an id → index map). A job with no runs sorts last.
 */
export function byJobSpend(registryIndex) {
  return (a, b) => (b.spendUsd - a.spendUsd)
    || (b.runs - a.runs)
    || ((registryIndex.get(a.id) ?? 0) - (registryIndex.get(b.id) ?? 0));
}
