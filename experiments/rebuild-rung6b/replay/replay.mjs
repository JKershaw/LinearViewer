#!/usr/bin/env node
// Behavioural replay for lib/kpi-stats.js (rung 6b). See README.md.
//   node replay.mjs --old pinned/origin-main --new <dirOrFile> [--n 3000] [--seed 1] [--out f] [--coverage]
//        [--jobs 4] [--tiers test,edge,gen] [--only gen:12] [--detail] [--rediscover-tests] [--quiet] [--now ISO]
import path from 'node:path';
import { runReplay } from '../../replay-kit/lib/replay-cli.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
export const cfg = {
  name: 'kpi-stats (rung6b)',
  here,
  main: 'kpi-stats.js',
  sha: '1f8010a09f4fa281fae6e90f0736b152f992f6a0',
  snapshotDir: path.resolve(here, '../../replay-kit/snapshots/1f8010a0'),
  pinnedDir: path.join(here, 'pinned', 'origin-main'),
  targetFile: path.join(here, 'target.mjs'),
  factories: [],
  // mongo-smoke needs a real mongod (skips offline); lifetime-retention reads the file as text.
  excludeTests: ['mongo-smoke.test.js'],
  topKinds: ['privacy-leak'],
};
if (import.meta.url === `file://${process.argv[1]}`) await runReplay(cfg);
