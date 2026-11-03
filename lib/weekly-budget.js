/**
 * Windowed API-equivalent spend across dispatch lineages (LIN-2118).
 *
 * This file was the weekly-budget burn gauge. LIN-4129 removed the gauge:
 * nothing read it. What remains is `windowedSpend`, the one live reader of
 * lineage spend by day, outside the terminal-marked-task card. The workspace
 * KPIs (`lib/workspace-kpi-stats.js`) bucket it per UTC day. The file name is
 * kept because moving the function is a live restructure, not part of the
 * deletion-only tidy.
 *
 * LIN-4178: the figure comes from the one cost read (`lineageFigure` in lib/cost-read.js); this file
 * holds only the window and the day bucket.
 */

import { lineageFigure } from './cost-read.js';
import { toEpochMs } from './utils/time.js';

function dayKeyOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Per-UTC-day spend of fully-priced lineages whose `start` (the earliest fetched member's
 * dispatch) falls in `[sinceMs, nowMs)`, plus the lineage and priced counts.
 *
 * `lineages` is `lineageRecords` output (lib/cost-read.js), with `status` set from the outcomes. Every
 * lineage in the window counts (done, in-flight, issue-less alike), except that a skipped lineage is not
 * counted at all. One that is not fully priced (partly priced, unreadable, or incomplete) adds to
 * `lineageCount` alone, never to `pricedCount` or `byDay`. `startedDays` names every day with a counted
 * lineage, and `byDay` a key only for a day with a priced one: a started day with no priced lineage has no
 * figure (the caller shows it as not priced), never $0.
 */
export function windowedSpend(lineages, sinceMs, nowMs) {
  let lineageCount = 0;
  let pricedCount = 0;
  const byDay = new Map();
  const startedDays = new Set();

  for (const lineage of lineages) {
    const start = lineage.members[0] ? toEpochMs(lineage.members[0].dispatchedAt) : null;
    if (start === null || start < sinceMs || start >= nowMs) continue;
    if (lineage.status === 'skipped') continue; // benign: nothing ended (same exclusion as kpi-stats.js)
    lineageCount++;
    const key = dayKeyOf(start);
    startedDays.add(key);
    const figure = lineageFigure(lineage);
    if (!figure.fullyPriced) continue;
    pricedCount++;
    byDay.set(key, (byDay.get(key) || 0) + figure.costUsd);
  }

  return { lineageCount, pricedCount, byDay, startedDays };
}
