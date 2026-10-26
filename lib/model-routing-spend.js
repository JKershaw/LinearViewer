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
 * One job's typical cost on each model it reported (LIN-3962): the same summary as the job's own, grouped by
 * the model each run reported, so a suggested model can show what this job spent when it ran on that model.
 * Each row's `id` is the model. Sorted by model; empty when the job has no runs that reported one.
 */
export function typicalByModel(rows, { job }) {
  const { workerSessions } = buildTaskCost({ ownRows: rows || [] });
  const byModel = new Map();
  for (const run of workerSessions) {
    if (run.kind !== job || !run.model) continue;
    if (!byModel.has(run.model)) byModel.set(run.model, []);
    byModel.get(run.model).push(run);
  }
  return [...byModel.keys()].sort().map((model) => summarise(model, byModel.get(model)));
}

/**
 * The one model a job reported from an alias's family (LIN-3962). `opus` names `claude-opus-5` only when exactly
 * one reported model contains the family token: two of one family, or none, name nothing, so an alias is never
 * given a model it may not have run.
 */
export function reportedModelForFamily(modelRows, family) {
  const matches = modelRows.map((r) => r.id).filter((m) => m.toLowerCase().includes(family));
  return matches.length === 1 ? matches[0] : null;
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

/** The priced spend of a list of job summaries (the sum the section totals and every share divide by). */
export function totalSpend(spends) {
  return (spends || []).reduce((n, s) => n + s.spendUsd, 0);
}

/** One job's share of the whole it belongs to, 0 to 1. Null when it has no priced spend or the whole is zero: never a share of nothing. */
export function shareOf(spend, total) {
  return spend.priced && total > 0 ? spend.spendUsd / total : null;
}

/**
 * Priced spend attributed to each job's EFFECTIVE model (LIN-3952): the model the job would run on today, not the
 * one its runs reported. `spends` is the job summaries (agent and Harbour alike); `effectiveRows` is
 * `effectiveTable(...).jobs`. A job with no effective model has no model to credit, so its spend is left out here
 * rather than credited to a "default". Largest first; empty when no priced spend.
 *
 *   [{ model, spendUsd }]
 */
export function spendByEffectiveModel(spends, effectiveRows) {
  const modelOf = new Map((effectiveRows || []).map((r) => [r.id, r.model || null]));
  const byModel = new Map();
  for (const s of spends || []) {
    const model = modelOf.get(s.id);
    if (!model || !s.priced) continue;
    byModel.set(model, (byModel.get(model) || 0) + s.spendUsd);
  }
  return [...byModel].map(([model, spendUsd]) => ({ model, spendUsd })).sort((a, b) => b.spendUsd - a.spendUsd);
}
