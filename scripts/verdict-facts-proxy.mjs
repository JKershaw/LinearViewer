/**
 * LIN-4519: the verdict facts of many tickets, read through the proxy for the operator scripts (the round-trip readers,
 * the stability measures). Reads: `GET /records?kind=task`, `?kind=verdict` and `?kind=change`, then the first write time
 * of each verdict whose current version is not its first (`GET /records/<id>`, its `versions`). Folded by the pure fold in
 * lib/records/verdict-facts.js. A failed read makes every ticket "not measured" with the reason, never "no verdict"
 * (reports Lesson, docs/areas/reports-and-operator-tools.md).
 */
import { verdictFactsFromRecords, verdictFactsNotMeasured } from '../lib/records/verdict-facts.js';

/**
 * @param {{base: string, token: string, getJson: (url: string, token: string) => Promise<object>, tickets: string[]}} opts
 * @returns {Promise<{facts: Map<string, object>, changes: object[], reads: number}>} identifier → verdict facts; the change
 *   records read (for a reader that maps a verdict's change to its PR); the number of proxy reads made
 */
export async function readVerdictFactsThroughProxy({ base, token, getJson, tickets }) {
  let reads = 0;
  const list = async (query) => { reads++; return (await getJson(`${base}/records?${query}`, token))?.records; };
  try {
    const [tasks, verdicts, changes] = await Promise.all([list('kind=task'), list('kind=verdict'), list('kind=change')]);
    if (![tasks, verdicts, changes].every(Array.isArray)) throw new Error('a records read gave no list');
    const firstAt = new Map();
    for (const v of verdicts) {
      if (v.v === 1) { firstAt.set(v.id, v.at); continue; }
      reads++;
      const full = await getJson(`${base}/records/${encodeURIComponent(v.id)}`, token);
      const first = Array.isArray(full?.versions) ? full.versions.find((x) => x.v === 1) ?? full.versions[0] : null;
      if (!first?.at) throw new Error(`verdict ${v.id} has no first write time`);
      firstAt.set(v.id, first.at);
    }
    return { facts: verdictFactsFromRecords({ tasks, verdicts, firstAt }, tickets), changes, reads };
  } catch (err) {
    const facts = verdictFactsNotMeasured(`the records could not be read through the proxy (${err?.message || 'unavailable'})`);
    return { facts: new Map(tickets.map((t) => [t, facts])), changes: [], reads };
  }
}
