// The judge's CLI: replays one scenario set through two commits' trees and
// diffs every surface's canonical output.
//   node experiments/costs-untangle/replay/replay.mjs --old <sha> --new <sha> [--seed 7] [--n 2000] [--out <dir>]
// Each commit is a git archive snapshot (replay/work/<sha12>/, gitignored);
// each side runs in its own node process under TZ=UTC with V8 coverage on.
// Exit: 0 = every surface identical; 1 = some surface differs; 2 = tool failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO, ensureSnapshot } from '../../replay-kit/lib/sides.mjs';
import { buildScenarios } from './gen.mjs';
import { edgeScenarios } from './edge.mjs';
import { SURFACE_IDS } from './surfaces.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
// Snapshots and mutant trees are kept OUTSIDE the checkout: the repo's own tests
// walk every source file under the repo root, and a mutant copy of docs/ would be
// judged as if it were real documentation.
export const WORK = process.env.COSTS_REPLAY_WORK || path.join(os.tmpdir(), 'costs-untangle-replay');

export function parseArgs(argv) {
  const out = { seed: 7, n: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    out[k.slice(2)] = argv[++i];
  }
  out.seed = Number(out.seed);
  out.n = Number(out.n);
  return out;
}

export function resolveSha(ref) {
  return execFileSync('git', ['-C', REPO, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
}

/** A commit's snapshot tree (git archive of what the surfaces import), shared by every run at that sha. */
export function snapshotOf(sha) {
  return ensureSnapshot({ sha, dir: path.join(WORK, sha.slice(0, 12)), paths: ['lib', 'routes', 'server.js', 'package.json', 'content', 'docs'] });
}

export function scenariosFor({ seed, n }) {
  return [...buildScenarios({ seed, n }), ...edgeScenarios()];
}

/** Run one side (one node process) and return its parsed output. */
export function runSide({ tree, scenariosFile, label, coverageDir }) {
  const outFile = path.join(WORK, `out-${label}.json`);
  fs.rmSync(coverageDir, { recursive: true, force: true }); // a stale process's coverage would count as this run's
  fs.mkdirSync(coverageDir, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(HERE, 'side.mjs'), '--tree', tree, '--scenarios', scenariosFile, '--out', outFile], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC', NODE_V8_COVERAGE: coverageDir },
    encoding: 'utf8', maxBuffer: 256 << 20,
  });
  if (r.status !== 0) throw new Error(`side ${label} failed (exit ${r.status}): ${(r.stderr || '').slice(-2000)}`);
  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  // A transport failure is no evidence about the code: the run is a tool failure, not a difference.
  if (out.transportErrors) throw new Error(`side ${label}: ${out.transportErrors} transport failure(s), e.g. ${out.transportSample[0]}`);
  return out;
}

/** Compare two sides' outputs surface by surface, scenario by scenario. */
export function compareSides(oldOut, newOut, scenarios) {
  const report = { surfaces: {}, differing: 0 };
  for (const id of SURFACE_IDS) {
    const a = oldOut.out[id] || [];
    const b = newOut.out[id] || [];
    const diffs = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) diffs.push({ index: i, scenario: scenarios[i]?.id, old: (a[i] || '').slice(0, 400), new: (b[i] || '').slice(0, 400) });
    }
    report.surfaces[id] = { scenarios: a.length, differing: diffs.length, examples: diffs.slice(0, 3) };
    report.differing += diffs.length;
  }
  return report;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.old || !args.new) {
    console.error('usage: replay.mjs --old <sha> --new <sha> [--seed N] [--n N]');
    process.exit(2);
  }
  fs.mkdirSync(WORK, { recursive: true });
  const oldSha = resolveSha(args.old);
  const newSha = resolveSha(args.new);
  const oldTree = snapshotOf(oldSha);
  const newTree = snapshotOf(newSha);
  const scenarios = scenariosFor(args);
  const scenariosFile = path.join(WORK, `scenarios-${args.seed}-${args.n}.json`);
  fs.writeFileSync(scenariosFile, JSON.stringify(scenarios));
  const oldOut = runSide({ tree: oldTree, scenariosFile, label: 'old', coverageDir: path.join(WORK, 'cov-old') });
  const newOut = runSide({ tree: newTree, scenariosFile, label: 'new', coverageDir: path.join(WORK, 'cov-new') });
  const report = compareSides(oldOut, newOut, scenarios);
  report.old = oldSha.slice(0, 12);
  report.new = newSha.slice(0, 12);
  report.seed = args.seed;
  report.n = args.n;
  report.scenarios = scenarios.length;
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ old: report.old, new: report.new, seed: report.seed, scenarios: report.scenarios, differing: report.differing, perSurface: Object.fromEntries(Object.entries(report.surfaces).map(([k, v]) => [k, v.differing])) }, null, 2));
  process.exit(report.differing === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`replay: tool failure: ${err.message}`);
    process.exit(2);
  }
}
