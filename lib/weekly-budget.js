/**
 * Windowed API-equivalent spend across dispatch lineages (LIN-2118).
 *
 * This file was the weekly-budget burn gauge. LIN-4129 removed the gauge:
 * nothing read it. What remains is `windowedSpend`, the one live reader of
 * the lineage cost reduce outside the terminal-marked-task card. The workspace
 * KPIs (`lib/workspace-kpi-stats.js`) bucket it per UTC day. The file name is
 * kept because moving the function is a live restructure, not part of the
 * deletion-only tidy.
 */

import { reduceLineageCost } from './terminal-marked-task-cost.js';

function dayKeyOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Per-UTC-day spend of fully-priced lineages whose `earliest` dispatch falls
 * in `[sinceMs, nowMs)`, plus the lineage and priced counts. Every lineage in
 * the window counts (done, in-flight, issue-less alike), but a lineage that is
 * skipped, or only partly priced, adds to `lineageCount` alone, never to
 * `pricedCount` or `byDay`.
 */
export function windowedSpend(lineages, sinceMs, nowMs) {
  let lineageCount = 0;
  let pricedCount = 0;
  const byDay = new Map();

  for (const lineage of lineages.values()) {
    if (lineage.earliest === null || lineage.earliest < sinceMs || lineage.earliest >= nowMs) continue;
    if (lineage.status === 'skipped') continue; // benign: nothing ended (same exclusion as kpi-stats.js)
    lineageCount++;
    const reduced = reduceLineageCost(lineage);
    if (!reduced.priced || !reduced.fullyPriced) continue;
    pricedCount++;
    const key = dayKeyOf(lineage.earliest);
    byDay.set(key, (byDay.get(key) || 0) + reduced.costUsd);
  }

  return { lineageCount, pricedCount, byDay };
}
