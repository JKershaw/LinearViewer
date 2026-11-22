/**
 * LIN-4519 (slice 3, P6 of LIN-4513): a ticket's verdict facts, folded from records for the measures. Pure: it touches
 * no store. The measures used to read verdicts out of ticket comments (the review, plan-review and blind-read comments,
 * lib/run-trail.js extractVerdict and parseBlindRead). From P6 they read verdict records (kind `verdict`, `judgement`
 * one of plan-review, review or blind-read, `on` the plan or change version the judge read). P7 (LIN-4520) retires the
 * comment readers; the history they produced is committed (docs/reviews/slice-3-readings/).
 *
 * The cutover instant is when the stages began writing verdicts as records: the production go-live of the P5 step 2
 * writers (#2491, d9c0e9eba, 22 Nov 04:20:39.504Z). Until then a verdict lived only in a comment, even where the one-off
 * verdict import (the one-off script, removed by LIN-4520; applied on 21 Nov 08:06Z) had also written a record for
 * an open task: the stages' blind reads and reviews between the import and that go-live exist only as comments, so the
 * import is not the instant that covers them. A metric over earlier work reads "not measured", never 0 and never a
 * value guessed from a comment (reports Lesson, docs/areas/reports-and-operator-tools.md; LIN-4420). The go-live instant
 * is read from the deploy log (`railway logs` for harbour-cat: "Harbour running at http://localhost:8080").
 *
 * A view of one verdict: { id, judgement, outcome, at, state, in, on: [{ id, v }] }. `at` is when the verdict was first
 * written (its first version), not its current version's time, so an ended verdict keeps its place in a window.
 */
import { splitRef } from './check.js';
import { REVIEW_JUDGEMENT } from './words.js';
import { PLAN_REVIEW_JUDGEMENT } from './plan-review-run.js';

/**
 * The judgement words a verdict record carries (its `fields.judgement`) for the gates this layer reads. The blind read's
 * word lives in lib/prompts/blind-read-words.js (BLIND_READ_KIND), the one home for it; this leaf does not type it.
 */
export const VERDICT_JUDGEMENTS = Object.freeze({ planReview: PLAN_REVIEW_JUDGEMENT, review: REVIEW_JUDGEMENT });

/**
 * The instant verdict records began to cover the workspace's verdicts: 2026-11-22 04:20:39.504Z, the production go-live of
 * #2491 (d9c0e9eba), the first build whose stages wrote verdict records. Read from harbour-cat's deploy log for that
 * deployment (8c9182ee: "Harbour running at http://localhost:8080" at 04:20:39.504Z). The first stage-written verdict in
 * production is 08:03:13Z, after it; none was written between 04:14 and 08:03. `null` means nothing is covered.
 */
export const VERDICT_RECORDS_SINCE = '2026-11-22T04:20:39.504Z';

/**
 * Whether work at `at` (an ISO instant) is covered by verdict records.
 * @param {string|null|undefined} at
 * @param {string|null} [since]
 * @returns {{covered: boolean, reason: string|null}}
 */
export function verdictCoverageAt(at, since = VERDICT_RECORDS_SINCE) {
  if (!since) return { covered: false, reason: 'no verdict records yet (the verdict import has not applied)' };
  const t = Date.parse(at || '');
  if (!Number.isFinite(t)) return { covered: false, reason: 'no date to place it against the verdict records' };
  return t >= Date.parse(since) ? { covered: true, reason: null } : { covered: false, reason: `no verdict records before ${since.slice(0, 16).replace('T', ' ')}Z` };
}

/** Verdict facts that could not be read: never "no verdict". */
export function verdictFactsNotMeasured(reason) {
  return Object.freeze({ measured: false, reason: String(reason || 'not read') });
}

/**
 * One verdict record as a view.
 * @param {object} rec - a verdict record (current version: `id`, `v`, `at`, `in`, `state`, `links.on`, `fields`)
 * @param {string|null} firstAt - when the record was first written (its first version's `at`), or null if unknown
 */
export function verdictViewOf(rec, firstAt = null) {
  const on = [].concat(rec?.links?.on || []).filter((r) => typeof r === 'string' && r).map((r) => {
    const { id, v } = splitRef(r);
    return { id, v: Number.isInteger(v) ? v : null };
  });
  return {
    id: rec.id,
    judgement: rec.fields?.judgement ?? null,
    outcome: rec.fields?.outcome ?? null,
    at: firstAt || rec.at || null,
    state: rec.state ?? null,
    in: rec.in ?? null,
    on,
  };
}

/**
 * The verdicts of many tickets from records read whole (`GET /records?kind=task` and `?kind=verdict`, and each verdict's
 * first write time). A ticket's task is the task whose `ref` names it; a verdict belongs to the ticket whose task it is
 * `in`. A ticket with no task has no verdicts, which is measured, not unknown: the caller decides what that means.
 * @param {{tasks?: object[], verdicts?: object[], firstAt?: Map<string, string>|Object<string, string>}} records
 * @param {string[]} tickets
 * @returns {Map<string, {measured: true, taskId: string|null, verdicts: object[]}>}
 */
export function verdictFactsFromRecords({ tasks = [], verdicts = [], firstAt = new Map() } = {}, tickets = []) {
  const firstOf = firstAt instanceof Map ? (id) => firstAt.get(id) ?? null : (id) => firstAt[id] ?? null;
  const taskOfTicket = new Map(tasks.filter((t) => t.kind === 'task' && typeof t.fields?.ref === 'string').map((t) => [t.fields.ref, t]));
  const byTask = new Map();
  for (const v of verdicts) {
    if (v.kind !== 'verdict' || !v.in) continue;
    if (!byTask.has(v.in)) byTask.set(v.in, []);
    byTask.get(v.in).push(verdictViewOf(v, firstOf(v.id)));
  }
  const out = new Map();
  for (const ticket of tickets) {
    const task = taskOfTicket.get(ticket) || null;
    const list = task ? (byTask.get(task.id) || []) : [];
    list.sort((a, b) => (a.at || '') < (b.at || '') ? -1 : (a.at || '') > (b.at || '') ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.set(ticket, { measured: true, taskId: task ? task.id : null, verdicts: list });
  }
  return out;
}

/**
 * The verdicts of one judgement that were written inside `[from, to)` (ISO instants; `to` null means unbounded). A verdict
 * ended superseded still counts: it was written then, and a later verdict took over. A withdrawn verdict does not: it was
 * withdrawn as never having judged anything (its PR closed unmerged, say), so churn and the blind read read it as no
 * verdict, as round trips already do (plan-review-round-trips recordVerdictOf).
 * @param {object[]} views - verdict views (verdictViewOf)
 * @param {{judgement: string, from?: string|null, to?: string|null}} q
 */
export function verdictsInWindow(views, { judgement, from = null, to = null }) {
  const f = from ? Date.parse(from) : -Infinity;
  const t = to ? Date.parse(to) : Infinity;
  return views.filter((v) => {
    if (v.judgement !== judgement || !v.at || v.state === 'withdrawn') return false;
    const at = Date.parse(v.at);
    return at >= f && at < t;
  });
}
