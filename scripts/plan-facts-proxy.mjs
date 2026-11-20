/**
 * LIN-4504: the plan facts of many tickets, read through the proxy for the operator scripts
 * (scripts/follow-on-ratio.mjs, scripts/plan-review-round-trips.mjs). Three reads, whatever the count:
 * `GET /records?kind=task`, `?kind=plan` and `?kind=finding&to=plan-review`, folded by the same pure fold the store
 * uses (lib/records/plan-facts.js planFactsFromRecords). A failed read makes every ticket "not measured" with the
 * reason, never "no plan" (reports Lesson, docs/areas/reports-and-operator-tools.md).
 */
import { planFactsFromRecords, planFactsNotMeasured } from '../lib/records/plan-facts.js';

/**
 * @param {{base: string, token: string, getJson: (url: string, token: string) => Promise<object>, tickets: string[]}} opts
 * @returns {Promise<Map<string, object>>} identifier → plan facts
 */
export async function readPlanFactsThroughProxy({ base, token, getJson, tickets }) {
  const list = async (query) => (await getJson(`${base}/records?${query}`, token))?.records;
  try {
    const [tasks, plans, findings] = await Promise.all([list('kind=task'), list('kind=plan'), list('kind=finding&to=plan-review')]);
    if (![tasks, plans, findings].every(Array.isArray)) throw new Error('a records read gave no list');
    return planFactsFromRecords({ tasks, plans, findings }, tickets);
  } catch (err) {
    const facts = planFactsNotMeasured(`the records could not be read through the proxy (${err?.message || 'unavailable'})`);
    return new Map(tickets.map((t) => [t, facts]));
  }
}
