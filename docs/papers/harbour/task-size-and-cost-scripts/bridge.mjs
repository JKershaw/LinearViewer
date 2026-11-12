#!/usr/bin/env node
// bridge.mjs — LIN-4427 (v2). The bridge from version 1's 22 tickets to version 2's reads of the same tickets. It reads
// two frozen evidence folders (v1's analysis.json and both folders' cost/ files) and writes bridge.json beside v2's
// analysis. It is a separate script because it reads two snapshots; analyse.mjs reads one folder only (its contract).
//
// Usage (LinearViewer root):
//   node docs/papers/harbour/task-size-and-cost-scripts/bridge.mjs <v1-evidence-dir> <v2-evidence-dir>
//
// What it separates, per ticket and in total:
//   - the leg moves that do not change a total, read from v2's records: after-answers (v1 inside work, v2 in Survey) and
//     custom-founded lineages (v1's bucketOf put a `custom` lineage whole in keep-alive; v2 puts it in its coded leg, from
//     v2's inputs.json custom_founded_legs). A custom follow-up inside another kind's lineage sits in that lineage's leg
//     in both versions, so it does not move; its dollars are reported (customNonAfterDispatchesUsd) but not as a move;
//   - the total change, split into lineages newly present in v2 (not in v1's cost read) and the change in each lineage
//     that was in both (repricing and any records added to it; the two are not separated, see the per-model table).
// Per-model repricing: for each lineage in both reads whose v2 model is one model, the ratio v2 cost / v1 cost, by model.
// This is an empirical ratio of one lineage across two reads, not a price-list ratio: v1 froze no per-model tokens.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [V1, V2] = [process.argv[2], process.argv[3]];
if (!V1 || !V2) { console.error('usage: bridge.mjs <v1-evidence-dir> <v2-evidence-dir>'); process.exit(2); }
const read = (dir, rel) => JSON.parse(readFileSync(path.join(dir, rel), 'utf8'));
const a1 = read(V1, 'analysis.json');
const a2 = read(V2, 'analysis.json');
const CODING = read(V2, 'inputs.json').custom_founded_legs;
const LEGS = ['floor', 'work', 'keepAlive', 'survey'];
const r4 = (x) => (x === null || x === undefined ? null : Math.round(x * 1e4) / 1e4);
const sum = (xs) => (xs.some((x) => x === null) ? null : xs.reduce((s, x) => s + x, 0));
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const v1Tickets = a1.counts.exact;
const v2Exact = new Set(a2.counts.exact);
const rows = v1Tickets.map((t) => {
  const p1 = a1.perTicket[t], p2 = a2.perTicket[t];
  const c1 = read(V1, `cost/${t}.json`), c2 = read(V2, `cost/${t}.json`);
  const ids1 = new Set(c1.workerSessions.map((w) => w.rootItemId));
  const pairs = c2.workerSessions.filter((w) => ids1.has(w.rootItemId)).map((w2) => ({ w2, w1: c1.workerSessions.find((w) => w.rootItemId === w2.rootItemId) }));
  const newlyPresent = c2.workerSessions.filter((w) => !ids1.has(w.rootItemId));
  return {
    ticket: t,
    inV2Exact: v2Exact.has(t),
    v1: { totalUsd: r4(p1.totalUsd), ...Object.fromEntries(LEGS.map((l) => [l, p1.legs[l === 'keepAlive' ? 'keepAlive' : l]])) },
    v2: { totalUsd: r4(p2.totalUsd), ...Object.fromEntries(LEGS.map((l) => [l, p2.legs[l]])) },
    moves: { afterAnswersUsd: p2.afterAnswerUsd,
      customFoundedOutOfKeepAliveUsd: r4(sum(c2.workerSessions.filter((w) => w.kind === 'custom' && CODING[w.rootItemId] !== 'keepAlive').map((w) => w.costUsd))) },
    customNonAfterDispatchesUsd: p2.customFollowUpUsd,
    totalChange: r4(p2.totalUsd === null || p1.totalUsd === null ? null : p2.totalUsd - p1.totalUsd),
    newlyPresentLineagesUsd: r4(sum(newlyPresent.map((w) => w.costUsd))),
    matchedLineageChange: r4(sum(pairs.map(({ w1, w2 }) => (w1.costUsd === null || w2.costUsd === null ? null : w2.costUsd - w1.costUsd)))),
    ratios: pairs.filter(({ w1, w2 }) => w1.costUsd > 0 && w2.costUsd !== null && w2.model && w2.model !== 'multiple')
      .map(({ w1, w2 }) => ({ rootItemId: w2.rootItemId, model: w2.model, v1: w1.costUsd, v2: w2.costUsd, ratio: r4(w2.costUsd / w1.costUsd) })),
  };
});

const allRatios = rows.flatMap((r) => r.ratios);
const byModel = Object.fromEntries([...new Set(allRatios.map((x) => x.model))].sort().map((m) => {
  const xs = allRatios.filter((x) => x.model === m).map((x) => x.ratio);
  return [m, { lineages: xs.length, medianRatio: r4(median(xs)), minRatio: r4(Math.min(...xs)), maxRatio: r4(Math.max(...xs)) }];
}));
const totals = {
  tickets: rows.length,
  v1TotalUsd: r4(sum(rows.map((r) => r.v1.totalUsd))),
  v2TotalUsd: r4(sum(rows.map((r) => r.v2.totalUsd))),
  totalChange: r4(sum(rows.map((r) => r.totalChange))),
  newlyPresentLineagesUsd: r4(sum(rows.map((r) => r.newlyPresentLineagesUsd))),
  matchedLineageChange: r4(sum(rows.map((r) => r.matchedLineageChange))),
  afterAnswersUsd: r4(sum(rows.map((r) => r.moves.afterAnswersUsd))),
  customFoundedOutOfKeepAliveUsd: r4(sum(rows.map((r) => r.moves.customFoundedOutOfKeepAliveUsd))),
  customNonAfterDispatchesUsd: r4(sum(rows.map((r) => r.customNonAfterDispatchesUsd))),
  legChange: Object.fromEntries(LEGS.map((l) => [l, r4(sum(rows.map((r) => (r.v2[l] === null || r.v1[l] === null ? null : r.v2[l] - r.v1[l]))))])),
  v2ExactAmongV1: rows.filter((r) => r.inV2Exact).length,
  note: 'The total change is not split by price list: v1 froze no per-model tokens. The per-model ratios are one lineage across two reads (they include any records added to it).',
};
const out = { v1: { dir: V1, ticket: a1.ticket, freezeFinishedAt: read(V1, 'manifest.json').freeze_finished_at },
  v2: { dir: V2, freezeFinishedAt: a2.v2.freezeFinishedAt }, totals, byModel, rows };
writeFileSync(path.join(V2, 'bridge.json'), JSON.stringify(out, null, 2) + '\n');

console.log(`bridge: ${rows.length} v1 exact tickets; v2 exact among them: ${totals.v2ExactAmongV1}`);
console.log(`total USD v1 ${totals.v1TotalUsd} → v2 ${totals.v2TotalUsd} (change ${totals.totalChange}): newly present lineages ${totals.newlyPresentLineagesUsd}, matched lineages ${totals.matchedLineageChange}`);
console.log(`moved legs (do not change totals): after-answers ${totals.afterAnswersUsd} (work → Survey), custom-founded lineages ${totals.customFoundedOutOfKeepAliveUsd} (keep-alive → coded leg)`);
console.log(`custom dispatches that are not after-answers (not a move): ${totals.customNonAfterDispatchesUsd}`);
console.log(`leg change v2−v1: ${JSON.stringify(totals.legChange)}`);
console.log(`per-model lineage ratio v2/v1: ${JSON.stringify(byModel)}`);
