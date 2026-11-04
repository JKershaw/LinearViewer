import { USAGE_TOKEN_FIELDS } from './request-usage-vocabulary.js';

/**
 * How a lineage's rows add up (LIN-4134 for one row, LIN-4136 for a lineage). Every place that
 * combines a lineage's rows into one tokens/cost figure takes `foldLineageUsage` below.
 *
 * A row's usage is its LAST `kind: 'usage'` entry; if that entry does not parse, the row is
 * unreadable (see `readUsageEntry` / `readRowUsage` in session-telemetry.js). That entry is a
 * running total (a cumulative snapshot a later row replaces) unless its REPORTED harness is
 * `opencode`, a per-run delta that adds. Unknown or absent counts as a running total. The requested
 * `harness` is never read: a null request falls back to the workspace default, and a resume keeps
 * its original harness. Imports only the shared vocabulary (lib/request-usage-vocabulary.js).
 */

export function lastUsageEntry(feedback) {
  if (!Array.isArray(feedback)) return null;
  let last = null;
  for (const entry of feedback) if (entry?.kind === 'usage') last = entry;
  return last;
}

/**
 * Whether a parsed usage is a running total. A null usage (none, or unparseable) is one too.
 * LEGACY (LIN-4203 / LIN-4195 D8): reads OLD snapshot rows only. The runner stopped posting [usage] snapshots
 * in piece 6, so this is kept for old rows, with no translation and no backfill. A lineage with request records
 * never reaches it (the cutover, lib/cost-read.js). Delete 30 days after LIN-4203 deploys (not before 2026-12-04).
 */
export function isRunningTotal(usage) {
  return usage?.harness !== 'opencode';
}

/**
 * The five token counts a usage carries; `foldLineageUsage` sums each of them, and so does the record fold
 * (lib/request-usage-fold.js), through `sumTokens`, so the two folds total tokens the same way.
 */
const TOKEN_FIELDS = USAGE_TOKEN_FIELDS;

export function sumTokens(usages) {
  const total = {};
  for (const field of TOKEN_FIELDS) total[field] = usages.reduce((sum, u) => sum + (u[field] ?? 0), 0);
  return total;
}

/**
 * The one way a lineage's rows add up (LIN-4136). `rows` are the lineage's row usage states in
 * dispatch order, each `{ state: 'absent' | 'unreadable' | 'present', usage }` as `readRowUsage`
 * returns it.
 *
 * - An absent row (no usage posted) is skipped.
 * - A readable running total replaces the running total before it.
 * - A readable delta (a per-run figure, `opencode`) adds to the sum.
 * - An unreadable row is a running total of unknown value: a later readable running total
 *   supersedes it, but a later delta does not clear it.
 *
 * The COUNTED rows are the last running total plus every delta, wherever the delta sits. Tokens
 * and cost are both summed over exactly those rows, so they always describe the same rows. A
 * mixed lineage is additive: a claude-code snapshot covers only its own transcript, so it never
 * contains another harness's spend.
 *
 * `completeness` is one of:
 *  - `no-usage`: no row posted usage (absent rows only). Tokens and cost are null.
 *  - `unreadable`: a counted row did not parse. A partial total would pass for the whole, so
 *    tokens and cost are null.
 *  - `unpriced`: every counted row was read, but one has no price. Tokens are summed; cost is null.
 *  - `complete`: every counted row was read and priced. Tokens and cost are both summed.
 * `unreadable` takes precedence over `unpriced`.
 *
 * @param {Array<{state: 'absent'|'unreadable'|'present', usage: Object|null}>} rows
 * @returns {{
 *   completeness: 'no-usage'|'unreadable'|'unpriced'|'complete',
 *   tokens: Object|null,
 *   costUsd: number|null,
 *   unpricedModels: string[],
 *   lastIndex: number|null,
 *   last: Object|null
 * }} `lastIndex` is the position in `rows` of the last counted row, which carries the labels
 *   (harness, model, effort) and names the row the figure is shown on. `last` is that row's usage,
 *   null when it is unreadable.
 */
/**
 * The rows a lineage's snapshot fold counts (LIN-4136): the running total in force (the last running total, readable
 * or not; an unreadable row is a running total of unknown value) and every readable delta. The ONE statement of the
 * snapshot/delta partition: `foldLineageUsage` below and the narrow rule (lib/cost-read.js `missingCanChangeFigure`)
 * both read it, so neither restates it (LIN-4201).
 *
 * @param {Array<{state: 'absent'|'unreadable'|'present', usage: Object|null}>} rows
 * @returns {{snapshot: {row: Object, index: number}|null, deltas: Array<{row: Object, index: number}>}}
 */
/** LEGACY (LIN-4203 / LIN-4195 D8): the snapshot fold. It reads OLD snapshot rows only. The runner stopped posting [usage] snapshots
 * in piece 6, so this is kept for old rows, with no translation and no backfill. A lineage with request records
 * never reaches it (the cutover, lib/cost-read.js). Delete 30 days after LIN-4203 deploys (not before 2026-12-04). */
export function countedRowsOf(rows) {
  let snapshot = null;
  const deltas = [];
  rows.forEach((row, index) => {
    if (row.state === 'absent') return;
    if (row.state === 'present' && !isRunningTotal(row.usage)) deltas.push({ row, index });
    else snapshot = { row, index };
  });
  return { snapshot, deltas };
}

export function foldLineageUsage(rows) {
  const { snapshot, deltas } = countedRowsOf(rows);
  const counted = [snapshot, ...deltas].filter(Boolean).sort((a, b) => a.index - b.index);
  if (counted.length === 0) {
    return { completeness: 'no-usage', tokens: null, costUsd: null, unpricedModels: [], lastIndex: null, last: null };
  }

  const readable = counted.filter(({ row }) => row.state === 'present').map(({ row }) => row.usage);
  const unpriced = readable.filter(usage => typeof usage.costUsd !== 'number');
  const unpricedModels = [...new Set(unpriced.map(usage => usage.model || 'unknown'))];
  const lastCounted = counted[counted.length - 1];

  let completeness;
  if (counted.some(({ row }) => row.state === 'unreadable')) completeness = 'unreadable';
  else if (unpriced.length > 0) completeness = 'unpriced';
  else completeness = 'complete';

  return {
    completeness,
    tokens: completeness === 'unreadable' ? null : sumTokens(readable),
    costUsd: completeness === 'complete' ? readable.reduce((sum, usage) => sum + usage.costUsd, 0) : null,
    unpricedModels,
    lastIndex: lastCounted.index,
    last: lastCounted.row.state === 'present' ? lastCounted.row.usage : null,
  };
}
