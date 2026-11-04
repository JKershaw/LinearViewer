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
import { NO_REQUEST_RECORDS } from '../../lib/request-usage-loader.js';

// LIN-4178: no founder lookup: the fetched rows stand in for it (the pre-LIN-4178 behaviour).

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const KPI_STATS_COLLECTION_NAMES = [
  'sessions', 'userPreferences', 'workspacePreferences', 'customPrompts', 'localIssues',
  'dispatchQueue', 'dispatchHistory', 'dispatchTokens', 'proxyTokens', 'proxyEvents',
  'agentStatus', 'freeTier', 'recapCache', 'briefCache', 'reportHistory', 'kpiDailyRollup'
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
export async function captureKpiReads(collectKpiStats, lineageIdentityOfRows) {
  const reads = {};
  const collections = Object.fromEntries(
    KPI_STATS_COLLECTION_NAMES.map((name) => [name, recordingCollection(name, reads)])
  );
  // LIN-4178: the founder lookup is passed (collectKpiStats needs it), over inert collections: its own
  // read shape is pinned in tests/unit/lineage-identity-read.test.js, and the recording stubs keep one read per
  // collection name, so a second read here would overwrite the captured `dispatchHistory` aggregate.
  const inert = { find: () => ({ toArray: async () => [] }) };
  const lineageIdentity = rows => lineageIdentityOfRows([inert, inert], rows);
  try {
    // LIN-4201 / LIN-4226: the request records likewise (none: the named no-records source), so the collector reaches its reads.
    await collectKpiStats(collections, { lineageIdentity, requestSource: NO_REQUEST_RECORDS, milestoneFunnelDeps: emptyMilestoneFunnelDeps() });
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

/**
 * No-op milestone-funnel deps (LIN-2952). The capture records kpi-stats' OWN
 * reads keyed by collection NAME, so the aggregate must not read through the
 * recording collection handles — a second `dispatchHistory` read would
 * overwrite the `$project`-bearing pipeline this script exists to capture.
 * These stubs return empty and record nothing.
 */
function emptyMilestoneFunnelDeps() {
  const emptyCollection = { find: () => ({ toArray: async () => [] }) };
  const emptyStore = {
    collection: emptyCollection,
    firstPressAt: async () => null,
    countByEntryRung: async () => ({ total: 0, byRung: [], coverage: { surfaces: [] } })
  };
  return {
    taskModeStore: emptyStore,
    accountStore: emptyStore,
    accountWorkspaceStore: emptyStore,
    closeOutEventsStore: emptyStore,
    dispatchQueue: emptyCollection,
    dispatchHistory: emptyCollection
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
  const { lineageIdentityOfRows } = await import(pathToFileURL(join(repoRoot, 'lib', 'dispatch-store.js')));
  const pick = await captureKpiReads(collectKpiStats, lineageIdentityOfRows);
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
