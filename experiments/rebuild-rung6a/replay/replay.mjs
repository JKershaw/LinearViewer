#!/usr/bin/env node
// Behavioural replay for lib/task-page-loader.js (rung 6a). See README.md.
//   node replay.mjs --old pinned/origin-main --new <dirOrFile> [--n 3000] [--seed 1] [--out f] [--coverage]
//        [--jobs 4] [--tiers test,edge,gen] [--only gen:12] [--detail] [--rediscover-tests] [--quiet] [--now ISO]
import path from 'node:path';
import { runReplay } from '../../replay-kit/lib/replay-cli.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
export const cfg = {
  name: 'task-page-loader (rung6a)',
  here,
  main: 'task-page-loader.js',
  sha: '1f8010a09f4fa281fae6e90f0736b152f992f6a0',
  snapshotDir: path.resolve(here, '../../replay-kit/snapshots/1f8010a0'),
  pinnedDir: path.join(here, 'pinned', 'origin-main'),
  targetFile: path.join(here, 'target.mjs'),
  // createTaskPageLoader returns {loadTaskPage, loadTaskState}: the test tier
  // records those method calls as `createTaskPageLoader().loadTaskPage`.
  factories: ['createTaskPageLoader'],
  excludeTests: [],
};
if (import.meta.url === `file://${process.argv[1]}`) await runReplay(cfg);
