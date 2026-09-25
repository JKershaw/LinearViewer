#!/usr/bin/env node
/**
 * scripts/lin3014/capture-kpis.mjs (LIN-3014)
 *
 * Records the EXACT read shapes `collectKpiStats` (lib/kpi-stats.js) issues,
 * by calling the real function against recording stub collections — no DB,
 * no writes, and no re-typed approximation of the pipelines that could drift
 * from the app. `measure.template.js`'s `/kpis` measurements read the
 * `dispatchHistory`/`proxyEvents`/`reportHistory` pipelines straight out of
 * this file's output.
 *
 * Unlike the research-scratch version (comment `299efc16`), this resolves
 * the app's `lib/` directory from its own location (`import.meta.url`)
 * instead of a hard-coded absolute path, so it works from any checkout.
 *
 * Usage: node scripts/lin3014/capture-kpis.mjs <out/kpis-reads.ejson>
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { EJSON } from 'bson';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const KPI_STATS_COLLECTION_NAMES = [
  'sessions', 'userPreferences', 'workspacePreferences', 'customPrompts', 'localIssues',
  'dispatchQueue', 'dispatchHistory', 'dispatchTokens', 'proxyTokens', 'proxyEvents',
  'agentStatus', 'freeTier', 'recapCache', 'briefCache', 'reportHistory'
];

/** A stub collection that records the one call collectKpiStats makes to it, never touching a DB. */
function recordingCollection(name, reads) {
  return {
    aggregate(pipeline) {
      reads[name] = { op: 'aggregate', pipeline };
      return { toArray: async () => [] };
    },
    find(filter = {}, projection) {
      reads[name] = { op: 'find', filter, projection: projection ?? null };
      return { toArray: async () => [] };
    },
    countDocuments: async () => 0
  };
}

/**
 * @param {Function} collectKpiStats - lib/kpi-stats.js's real export
 * @returns {Object} the captured {op, pipeline|filter/projection} per collection name
 */
export async function captureKpiReads(collectKpiStats) {
  const reads = {};
  const collections = Object.fromEntries(
    KPI_STATS_COLLECTION_NAMES.map((name) => [name, recordingCollection(name, reads)])
  );
  try {
    await collectKpiStats(collections);
  } catch {
    // Expected: the recording stubs return empty arrays/0, which downstream
    // aggregation/derivation code may not tolerate. Only the READ SHAPES
    // (captured above, before any of that runs) matter here.
  }
  return {
    dispatchHistory: reads.dispatchHistory,
    proxyEvents: reads.proxyEvents,
    reportHistory: reads.reportHistory
  };
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error('usage: node scripts/lin3014/capture-kpis.mjs <out/kpis-reads.ejson>');
    process.exitCode = 1;
    return;
  }
  const { collectKpiStats } = await import(pathToFileURL(join(repoRoot, 'lib', 'kpi-stats.js')));
  const pick = await captureKpiReads(collectKpiStats);
  for (const [name, read] of Object.entries(pick)) {
    const shape = read?.op === 'aggregate' ? `${read.pipeline.length} stage(s): ${Object.keys(read.pipeline[0] || {})}` : JSON.stringify(read);
    console.log(name, read?.op, shape);
  }
  writeFileSync(outPath, EJSON.stringify(pick, { relaxed: false }));
  console.log(`wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
