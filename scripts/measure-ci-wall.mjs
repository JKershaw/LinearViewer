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
 * TEST-WAIT METHOD (LIN-4441 ruling: a new, written method, applied to BOTH windows so the two numbers are comparable by
 * construction). It is NOT a reproduction of the original 28% / 10–13% figures and must not be reported as one. This
 * script does not compute it; it is the procedure whoever runs the re-measure follows, so it is repeatable:
 *   Windows.     Baseline: 2026-11-07 to 2026-11-12 (UTC, by each task's first dispatch time), the original ticket's window.
 *                Fresh: the first tasks whose first dispatch is after the LIN-4441 merge and deploy (use the same length of
 *                window, or at least 30 tasks). Report the two side by side with their task and dispatch counts.
 *   Selection.   A task is a ticket with at least one implementation, leftover or close-out dispatch whose first dispatch
 *                falls in the window and whose PR touches code (not a docs-only notes PR). Take every such task: no sampling.
 *   Inputs.      Main-thread entries (isSidechain skipped) of the local Claude Code session transcripts,
 *                the .jsonl files under each ~/.claude/projects folder whose name contains simple-dispatcher-workspaces, one transcript per dispatch, the same input
 *                `scripts/survey-flakes-sessions.mjs` reads; the task is the ticket id in the dispatch prompt; PR runs come
 *                from `gh run list --workflow test.yml`. The transcripts are the one input that is not committed.
 *   Worker time. Active minutes per dispatch: the gaps between consecutive transcript entries, each capped at 15 minutes
 *                (`GAP_CAP_MIN` in `survey-flakes-sessions.mjs`). Task worker time is the sum over its dispatches.
 *   CI wait.     Active time between a push (git push, or a gh pr create/edit) and the first later observation that the
 *                run for that push has finished, using the CI-observation recogniser in `survey-flakes-sessions.mjs`.
 *                A CI wait is one such push-to-result span; CI waits per task counts them.
 *   Local full.  Active time of a Bash call that runs the whole unit suite: `npm run test:unit`, `npm test`,
 *                `npm run test:hermetic*`, or `scripts/run-unit-tests.mjs` with no file arguments. A run with file
 *                arguments is a targeted run and is not counted here.
 *   Shares.      Waiting on CI % = sum of CI-wait time / sum of worker time; Local full-suite % = sum of local-full time /
 *                sum of worker time, both over the tasks selected. Report CI waits per task (median) beside them.
 *   Attribution. A span belongs to the dispatch whose transcript contains it. A wait that straddles two dispatches is
 *                split at the dispatch boundary. A deliberate red (a provoked failure, as in survey-flakes-sessions) is
 *                excluded from CI wait and counted in neither share.
 *   If the original author supplies the 7–12 Nov method, it replaces this one and both windows are recomputed with it.
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
