// LIN-3168: count flake-risk markers (fixed sleeps, shared workspace keys, network waits, streams, animation, clocks, count pins, seeding) in every Playwright spec at a commit.
// Usage: node scripts/survey-flakes-spec-source.mjs [--at origin/main] [--out data/survey-flakes/spec-source.json]
// Markers are regex counts over the spec's source text; they say what a spec leans on, not that it is flaky.
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const at = arg('--at', 'origin/main');
const outPath = arg('--out', 'data/survey-flakes/spec-source.json');
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });

export const MARKERS = {
  // A fixed sleep: the test waits a set time rather than for a condition.
  sleep: /\bwaitForTimeout\s*\(|new Promise\(\s*\(?r(?:esolve)?\)?\s*=>\s*setTimeout/g,
  // The Linear test-token session with no urlKey override lands every worker on the one 'test-workspace' partition.
  sharedKey: /createSession\(\s*page\s*(?:,\s*\{(?![^}]*urlKey)[^}]*\})?\s*\)|\/test\/set-session(?![^'"`]*urlKey)|['"`](?:test|local)-workspace['"`]|LOCAL_WORKSPACE_URL_KEY|TEST_WORKSPACE_URL_KEY/g,
  workerKey: /workerUrlKey|workerInfo\.(?:workerIndex|parallelIndex)|testInfo\.(?:workerIndex|parallelIndex)/g,
  network: /page\.route\(|waitForResponse\(|waitForRequest\(|waitForLoadState\(\s*['"]networkidle|request\.(?:get|post|patch|delete)\(/g,
  stream: /EventSource|text\/event-stream|\bSSE\b|stream(?:ing)?\b|\bpoll(?:ing)?\b|setInterval/gi,
  animation: /animation|transition|reducedMotion|prefers-reduced-motion|shimmer|opacity|getComputedStyle|boundingBox\(/g,
  clock: /Date\.now\(|new Date\(|page\.clock|toISOString\(|fake ?timers?/g,
  countPin: /toHaveCount\(\s*\d+|toHaveLength\(\s*\d+|\.length\)\.toBe\(\s*\d+|toBe\(\s*\d{2,}\s*\)/g,
  seed: /seedLocalWorkspace\(|\/test\/(?:seed|set-local-session|reset|set-session)|localSeed/g,
  serial: /describe\.serial|describe\.configure\(\s*\{\s*mode:\s*['"]serial/g,
  longTimeout: /timeout:\s*\d{4,}/g,
};

const files = git(['ls-tree', '-r', '--name-only', at, 'tests/e2e']).trim().split('\n').filter((f) => /\.spec\.[jt]s$/.test(f));
const rows = [];
for (const file of files) {
  const src = git(['show', `${at}:${file}`]);
  const row = { file, lines: src.split('\n').length, tests: (src.match(/^\s*test(?:\.only|\.skip|\.fixme)?\(\s*['"`]/gm) || []).length };
  for (const [k, re] of Object.entries(MARKERS)) row[k] = (src.match(re) || []).length;
  const log = git(['log', '--format=%ad', '--date=short', at, '--', file]).trim().split('\n').filter(Boolean);
  row.born = log[log.length - 1] || null;
  row.commitsSinceJune = log.filter((d) => d >= '2026-06-01').length;
  rows.push(row);
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ at: git(['rev-parse', '--short', at]).trim(), rows }, null, 2));
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`${rows.length} specs, ${sum('tests')} tests at ${at}`);
for (const k of Object.keys(MARKERS)) console.log(`${k}: in ${rows.filter((r) => r[k] > 0).length} specs, ${sum(k)} hits`);
console.log(`wrote ${outPath}`);
