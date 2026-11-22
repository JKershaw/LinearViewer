/**
 * LIN-4518 (finding-55356e66): the plan-review run of a ticket, folded from records. Pure: it touches no store. The
 * store reads a task's plan-review verdicts and its `to: plan` findings (records-store.js planReviewRunForTicket) and
 * folds them here; the loop bound, ceiling and converging rule (lib/recommendation-facts.js) read the result.
 *
 * A plan review writes, in one run (the plan-review prompt, lib/prompts/stage-kinds.js): one finding `to: plan` per
 * blocking issue, then one verdict `judgement: plan-review` on the plan. Both carry that run's id, so a verdict's
 * blocking count is the number of `to: plan` findings its own run wrote. No count is read from prose.
 *
 * The run is the verdicts since the latest Approve (an Approve resets the loop), each with its outcome words in the
 * comment vocabulary the loop reads ('approve', 'request changes', 'needs discussion') and its blocking count: the
 * findings of its run when it asked for changes, else null. A verdict with no run names no findings, so its count is
 * null ("not stated"), never zero.
 */

/** The judgement a plan review's verdict record carries (lib/records/kinds.json outcome sets). */
export const PLAN_REVIEW_JUDGEMENT = 'plan-review';

/** The addressee a plan review's blocking findings are written to (the plan-review prompt, lib/prompts/stage-kinds.js). */
export const PLAN_FINDING_TO = 'plan';

const byAtThenId = (a, b) => ((a.at || '') < (b.at || '') ? -1 : (a.at || '') > (b.at || '') ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * LIN-4520 (finding-ca44ecba): the landed work on record, from the task's change records. A change is work that landed
 * when its record was first written, so each one is dated by that write (`at`), never by a comment that cites its PR.
 * @param {Array<{at?: string, fields?: {ref?: string}}>} changes - the task's change records, each with the instant its
 *   record was first written in `at`
 * @returns {Array<{url: string, at: string|null}>} oldest first
 */
function landedOf(changes) {
  return changes
    .filter((c) => typeof c?.fields?.ref === 'string' && c.fields.ref)
    .map((c) => ({ url: c.fields.ref, at: c.at || null }))
    .sort((a, b) => ((a.at || '') < (b.at || '') ? -1 : (a.at || '') > (b.at || '') ? 1 : 0));
}

/**
 * @param {Object} input
 * @param {Array<{id?: string, at?: string, run?: string|null, fields?: {judgement?: string, outcome?: string}}>} [input.verdicts]
 *   the current versions of the task's verdicts; only those with judgement `plan-review` count
 * @param {Array<{at?: string, run?: string|null, to?: string}>} [input.findings] the current versions of the task's
 *   findings; only those `to: plan` count
 * @param {Array<{at?: string, fields?: {ref?: string}}>} [input.changes] the task's change records, `at` the instant each
 *   was first written; they become `landed`
 * @returns {{verdicts: number, byKind: Object, latestVerdict: string|null, latestAt: string|null,
 *   run: Array<{verdict: string, blocking: number|null, at: string|null}>, landed: Array<{url: string, at: string|null}>}}
 *   `verdicts` counts every plan-review verdict on record; `run` is the ones since the latest Approve, in time order;
 *   `landed` is the work on record (lib/recommendation-facts.js loopFactsOf reads it for the loop, and the selector's
 *   acted-after fact reads it too)
 */
export function planReviewRunOf({ verdicts = [], findings = [], changes = [] } = {}) {
  const reviews = verdicts
    .filter((v) => v?.fields?.judgement === PLAN_REVIEW_JUDGEMENT)
    .sort(byAtThenId);
  const planFindings = findings.filter((f) => f?.to === PLAN_FINDING_TO);
  const folded = reviews.map((v) => {
    const verdict = String(v.fields.outcome || '').replace(/-/g, ' ');
    const own = v.run ? planFindings.filter((f) => f.run === v.run).length : 0;
    return { id: v.id, verdict, blocking: verdict === 'request changes' && own >= 1 ? own : null, at: v.at || null };
  });
  const lastApprove = folded.map((v) => v.verdict).lastIndexOf('approve');
  const latest = folded[folded.length - 1] || null;
  const byKind = {};
  for (const v of folded) byKind[v.verdict] = (byKind[v.verdict] || 0) + 1;
  return {
    verdicts: folded.length,
    byKind,
    latestVerdict: latest ? latest.verdict : null,
    latestAt: latest ? latest.at : null,
    run: folded.slice(lastApprove + 1).map(({ verdict, blocking, at }) => ({ verdict, blocking, at })),
    landed: landedOf(changes),
  };
}
