// LIN-4505: the Waiting rows' readings, from the two sources that now hold them. The Waiting lists (the Waiting sections
// of the area notes) were retired by the LIN-4495 cutover and imported as records by LIN-4505, so a window's
// endpoints read from:
//   - the committed series (docs/reviews/stability-measures/waiting-series.json): the pre-cutover count at each
//     first-parent commit, read once from git and kept as data. The tool never reads the lists from git any more;
//   - the records store, through the workspace proxy: the open hand-offs (findings and questions) addressed to the
//     project as of the commit's time, for commits from the first imported record on (`records.coveredFrom`).
// A commit neither source covers is `not measured` with its reason, never zero: the gap between the cutover and the
// import is the honest gap. The runner's lists are not read after the Harbour cutover (the LIN-4505 ruling), so the
// runner row reads `not measured` from there on. The rows' shape and their totals are the core's (waitingRows).
import { readFileSync } from 'node:fs';
import { firstLine } from './stability-measures-tracker.mjs';

export const SERIES_URL = new URL('../docs/reviews/stability-measures/waiting-series.json', import.meta.url);
/** The hand-off kinds the records rows count (stability-measures-core.mjs HAND_OFF_KINDS). */
const HAND_OFF_KINDS = Object.freeze(['finding', 'question']);

/** The committed series, read as data. Throws when the file is missing or not the series, so a run cannot quietly read nothing. */
export function loadWaitingSeries(url = SERIES_URL) {
  const series = JSON.parse(readFileSync(url, 'utf8'));
  for (const side of ['harbour', 'runner']) {
    if (!series[side] || typeof series[side].commits !== 'object') throw new Error(`${side} has no commits in ${url.pathname}`);
  }
  if (typeof series.records?.coveredFrom !== 'string') throw new Error(`records.coveredFrom is missing in ${url.pathname}`);
  return series;
}

/**
 * One repository's committed reading at a commit: { count } or { reason }. Keys are the first 12 characters of the sha;
 * a commit the series does not hold is a reason, not a zero.
 * @param {{repo: string, through: string, throughDate?: string, commits: Record<string, number|string>}} side
 */
export function seriesReadingAt(side, sha) {
  const key = String(sha).slice(0, 12);
  if (!Object.prototype.hasOwnProperty.call(side.commits, key)) {
    const bound = side.throughDate ? `up to ${side.throughDate}` : `up to ${side.through.slice(0, 12)}`;
    return { reason: `${key} is not in the committed Waiting series for ${side.repo} (first-parent commits ${bound})` };
  }
  const value = side.commits[key];
  return typeof value === 'number' ? { count: value } : { reason: value };
}

/**
 * The records reading at a time: the open hand-offs to the project as of `asOf`, through the proxy. A failed read is a
 * reason. `client` is the proxy client (createProxyClient): its get never throws.
 * @returns {Promise<{count: number}|{reason: string}>}
 */
export async function recordsReadingAt(client, asOf) {
  const r = await client.get(`/records?to=project&state=open&asOf=${encodeURIComponent(new Date(asOf).toISOString())}`);
  if (!r.ok) return { reason: `records read: ${r.reason}` };
  if (!Array.isArray(r.body?.records)) return { reason: 'records read: the answer has no records list' };
  return { count: r.body.records.filter((x) => HAND_OFF_KINDS.includes(x.kind)).length };
}

/**
 * The Harbour endpoint at one commit: the committed series for a commit it holds (the pre-cutover commits, and the
 * cutover commit itself, which reads its reason); otherwise the records reading, from the first imported record on;
 * otherwise a reason naming the gap.
 * @returns {Promise<{count: number}|{reason: string}>}
 */
export async function harbourEndpointAt({ series, sha, date, client }) {
  const key = String(sha).slice(0, 12);
  if (Object.prototype.hasOwnProperty.call(series.harbour.commits, key)) return seriesReadingAt(series.harbour, sha);
  if (new Date(date) < new Date(series.records.coveredFrom)) {
    return { reason: `no reading at ${key}: it is not in the committed Waiting series (first-parent commits up to the LIN-4495 cutover), and the records that replace the lists start at ${series.records.coveredFrom} (imported records are dated at import)` };
  }
  if (!client) return { reason: 'no --api given: the records reading needs the workspace proxy' };
  return recordsReadingAt(client, date);
}

/**
 * The runner endpoint at one commit: the committed series only, and only for a window endpoint at or before the Harbour
 * cutover. The runner's lists are history: an endpoint dated after the cutover reads a reason, whatever the runner's last
 * commit before it was (the LIN-4505 ruling: `waiting.runner` and `waiting.total` read not measured afterwards).
 * @param {{series: object, sha: string, date?: string}} args - `date` is the window endpoint's commit time (Harbour's)
 */
export function runnerEndpointAt({ series, sha, date = null }) {
  if (date && new Date(date) > new Date(series.runner.throughDate)) {
    return { reason: `the runner's Waiting lists are not read after the Harbour cutover (${series.runner.throughDate}; LIN-4505: kept as history, not measured afterwards)` };
  }
  return seriesReadingAt(series.runner, sha);
}
