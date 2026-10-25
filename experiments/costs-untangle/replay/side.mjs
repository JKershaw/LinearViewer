// One side of the replay, run in its OWN node process (a side never shares a
// module graph with the other side). Usage:
//   TZ=UTC node side.mjs --tree <snapshot dir> --scenarios <file.json> --out <file.json>
// It pins the environment (TZ, scrub incl. WEEKLY_BUDGET_*), installs the
// network guard, loads the tree's modules, then for each recorded scenario
// freezes the clock at the scenario's UTC instant, seeds randomness, and runs
// every surface. Output: { surfaceId: [canonical JSON per scenario] }.
// Coverage is left to V8: the parent sets NODE_V8_COVERAGE for this process.
import fs from 'node:fs';
import path from 'node:path';
import { pinEnv, installNetworkGuard, freezeClock, seedRandom, networkAttempts } from '../../replay-kit/lib/hermetic.mjs';
import { canon } from './canon.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.tree || !args.scenarios || !args.out) {
  console.error('usage: side.mjs --tree <dir> --scenarios <file> --out <file>');
  process.exit(2);
}

pinEnv();
installNetworkGuard();
const { loadTree, SYNC_SURFACES, ASYNC_SURFACES } = await import('./surfaces.mjs');
const mods = await loadTree(path.resolve(args.tree));

const scenarios = JSON.parse(fs.readFileSync(args.scenarios, 'utf8'));
const out = Object.fromEntries([...Object.keys(SYNC_SURFACES), ...Object.keys(ASYNC_SURFACES)].map(id => [id, []]));

for (const sc of scenarios) {
  freezeClock(sc.now);
  seedRandom(sc.seed);
  for (const [id, fn] of Object.entries(SYNC_SURFACES)) {
    out[id].push(runOne(() => fn(mods, sc)));
  }
  for (const [id, fn] of Object.entries(ASYNC_SURFACES)) {
    out[id].push(await runOneAsync(() => fn(mods, sc)));
  }
}

function runOne(f) {
  try {
    return canon(f());
  } catch (err) {
    return canon({ $threw: String(err && err.message ? err.message : err) });
  }
}
async function runOneAsync(f) {
  try {
    return canon(await f());
  } catch (err) {
    return canon({ $threw: String(err && err.message ? err.message : err) });
  }
}

fs.writeFileSync(args.out, JSON.stringify({ tree: path.resolve(args.tree), count: scenarios.length, networkAttempts: networkAttempts.length, out }));
process.exit(0);
