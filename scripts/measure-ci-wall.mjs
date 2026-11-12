#!/usr/bin/env node
/**
 * CI wall-time measure for test.yml (LIN-4441, step 5 of the plan).
 *
 * WHAT IT MEASURES: the wall time of successful `test.yml` runs on main over a window (updatedAt − createdAt), as a median
 * and a mean, plus the run count. This is the CI side of the ticket's first Done-when bullet ("a PR's CI wall time drops
 * below ~8.5 min median"). It reads GitHub through `gh run list`, and nothing else.
 *
 * Beside `ciRow` in `scripts/stability-measures-core.mjs`, the landing-window CI row, whose median and rounding it
 * reuses. The two differ on purpose: that row times updatedAt − startedAt for runs whose head is a window landing; this
 * one times updatedAt − createdAt (queue included, as the LIN-4441 plan asks) for every successful main run in a window.
 *
 * WHAT IT CANNOT MEASURE, AND WHY: the ticket's 28% (worker time waiting on CI) and 10–13% (local full-suite runs) shares,
 * and CI waits per task. Those need worker-session timings across dispatches, and the 7–12 Nov baseline (38 tasks,
 * 333 dispatches) was produced from inputs that are NOT in this repository. `scripts/survey-tests-*.mjs` measures per-file
 * timing and failure classes, not worker time, so it does not reproduce the figures. No committed script can reproduce
 * the baseline; the method has to come from whoever ran that analysis. This script does not approximate those shares.
 *
 * Usage: node scripts/measure-ci-wall.mjs [--since YYYY-MM-DD] [--limit N]
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mean, median, round } from './stability-measures-core.mjs';

export const WORKFLOW = 'test.yml';

// Pure: runs as returned by `gh run list --json databaseId,createdAt,updatedAt,conclusion,headBranch,event`.
export function summariseWall(runs, { since = null } = {}) {
  const wall = runs
    .filter((r) => r.conclusion === 'success' && r.headBranch === 'main')
    .filter((r) => !since || r.createdAt >= since)
    .map((r) => (Date.parse(r.updatedAt) - Date.parse(r.createdAt)) / 60000)
    .filter((m) => Number.isFinite(m) && m > 0);
  if (!wall.length) return { runs: 0, medianMin: null, meanMin: null };
  return { runs: wall.length, medianMin: round(median(wall), 2), meanMin: round(mean(wall), 2) };
}

function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const since = arg('--since', null);
  const limit = arg('--limit', '200');
  const raw = execFileSync('gh', ['run', 'list', '--workflow', WORKFLOW, '--branch', 'main', '--limit', limit,
    '--json', 'databaseId,createdAt,updatedAt,conclusion,headBranch,event'], { encoding: 'utf8' });
  console.log(JSON.stringify(summariseWall(JSON.parse(raw), { since: since ? `${since}T00:00:00Z` : null })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
