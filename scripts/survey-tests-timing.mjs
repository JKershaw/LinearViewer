// LIN-3151: per-file unit-suite timing for LinearViewer or simple-dispatcher — each test file run alone under `node --test` with survey-tests-reporter.mjs, so a file's wall-clock includes its imports and setup.
// Usage: node scripts/survey-tests-timing.mjs <lv|sd> [repoPath=.] [--out data/survey-tests/<repo>-perfile.json] [--only <substring>]
// Files run one at a time (no suite concurrency), so the sum is the suite's serial cost, not its 45 s parallel wall-clock.
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const [which = 'lv', repoArg = '.'] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
const flag = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const repo = resolve(repoArg);
const here = dirname(fileURLToPath(import.meta.url));
const reporter = resolve(here, 'survey-tests-reporter.mjs');
const out = resolve(flag('--out', resolve(here, '..', 'data', 'survey-tests', `${which}-perfile.json`)));
const only = flag('--only', '');

// The same file globs and preload each repo's `npm test` uses.
const SUITES = {
  lv: { glob: /^tests\/unit\/[^/]+\.test\.js$/, pre: [] },
  sd: { glob: /^test\/[^/]+\.test\.js$/, pre: ['--require', './test/isolate-local-halt.js'] },
};
const suite = SUITES[which];
const files = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).split('\n')
  .filter((f) => suite.glob.test(f) && f.includes(only));

mkdirSync(dirname(out), { recursive: true });
const tmp = resolve(dirname(out), `.${which}-perfile.jsonl`);
const rows = [];
for (const [i, file] of files.entries()) {
  if (existsSync(tmp)) rmSync(tmp);
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [...suite.pre, '--test', `--test-reporter=${reporter}`, `--test-reporter-destination=${tmp}`, file], { cwd: repo, encoding: 'utf8', timeout: 600_000 });
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const events = existsSync(tmp) ? readFileSync(tmp, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.name !== undefined) : [];
  const tests = events.map((e) => ({ name: e.name, nesting: e.nesting, ms: e.ms, ok: e.ok, skip: e.skip }));
  rows.push({ file, wallMs: Math.round(wallMs), exit: r.status, testMs: Math.round(tests.filter((t) => t.nesting === 0).reduce((s, t) => s + (t.ms || 0), 0)), failed: tests.filter((t) => !t.ok).length, tests });
  if ((i + 1) % 50 === 0) process.stderr.write(`${i + 1}/${files.length}\n`);
}
if (existsSync(tmp)) rmSync(tmp);
writeFileSync(out, JSON.stringify({ repo: which, head: execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), node: process.version, rows }, null, 1));
const total = rows.reduce((s, r) => s + r.wallMs, 0);
console.log(`${which}: ${rows.length} files, serial wall ${(total / 1000).toFixed(0)} s; slowest:`);
for (const r of [...rows].sort((a, b) => b.wallMs - a.wallMs).slice(0, 15)) console.log(`${String(r.wallMs).padStart(7)} ms  ${relative('.', r.file)}`);
