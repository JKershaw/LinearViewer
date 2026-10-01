// LIN-3189: runs the tests that shipped with each original change, and the tests of each known escape's named fix, against the replay's final tree, with the same files run on the original commit (and the fix commit) as baselines.
// Usage: node scripts/survey-replay-tests.mjs --root <replay worktree dir> [--selection data/survey-replay/selection.json] [--sd ../simple-dispatcher] [--only LIN-n,...] [--out data/survey-replay/tests.json]
// Each run happens in a throwaway detached worktree, so neither the replay nor either clone is touched: the target tree is checked out,
// the test files are copied in from the commit that shipped them (git checkout <sha> -- <files>), and each file runs alone under
// node --test with a 180 s cap. Unit tests only: tests/e2e, tests/visual and Playwright specs are listed but never run. The fix
// commits are the pre-registration's (FIXES). Results are pass/fail counts and failing test names per file, plus the first lines of
// each failure, for the hand coding of interface against behaviour failures. No proxy calls.
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = resolve(arg('--root', ''));
const sel = JSON.parse(readFileSync(arg('--selection', 'data/survey-replay/selection.json'), 'utf8'));
const repoDir = { LinearViewer: resolve('.'), 'simple-dispatcher': resolve(arg('--sd', '../simple-dispatcher')) };
const only = arg('--only') ? new Set(arg('--only').split(',')) : null;
const out = arg('--out', 'data/survey-replay/tests.json');
const FIXES = { 'LIN-2123': '99c604b4', 'LIN-2252': '740bded7', 'LIN-2355': 'f66c82ec', 'LIN-2414': '2ef854b' }; // LIN-2980's fix (LIN-2983) never merged

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const isUnit = (p) => /(^|\/)tests?\//.test(p) && /\.test\.m?js$/.test(p) && !/(^|\/)(e2e|visual)\//.test(p);
const testFilesOf = (repo, from, to) => git(repo, ['diff', '--name-only', '--diff-filter=AM', from, to]).trim().split('\n').filter((p) => p && /(^|\/)tests?\//.test(p));

let n = 0;
function scratch(repo, sha) {
  const w = join(root, `_t${process.pid}-${n++}`);
  git(repo, ['worktree', 'add', '--detach', '--quiet', w, sha]);
  if (existsSync(join(repo, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(w, 'node_modules'));
  return w;
}
const drop = (repo, w) => git(repo, ['worktree', 'remove', '--force', w]);

function runFile(w, file) {
  const pre = existsSync(join(w, 'test/isolate-local-halt.js')) ? ['--require', './test/isolate-local-halt.js'] : [];
  const r = spawnSync(process.execPath, [...pre, '--test', '--test-reporter=tap', file], { cwd: w, encoding: 'utf8', timeout: 180_000, env: { ...process.env, OPENROUTER_API_KEY: '', HARBOUR_LOCAL_BASE: '' } });
  const o = `${r.stdout || ''}${r.stderr || ''}`;
  const num = (k) => +(o.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1] ?? NaN);
  const failing = [...o.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1]).filter((t) => !/\.test\.m?js$/.test(t));
  const firstErr = [...o.matchAll(/^\s+(error|message): (.+)$/gm)].slice(0, 4).map((m) => m[2].slice(0, 200));
  return { file, pass: num('pass'), fail: num('fail'), timedOut: r.error?.code === 'ETIMEDOUT', failing: failing.slice(0, 12), firstErr };
}

// Run `files` (taken from commit `from`) on tree `sha`.
function runOn(repo, sha, from, files) {
  const unit = files.filter(isUnit);
  if (!unit.length) return { tree: sha.slice(0, 8), from: from.slice(0, 8), files: [], skipped: files.filter((f) => !isUnit(f)) };
  const w = scratch(repo, sha);
  try {
    git(w, ['checkout', from, '--', ...unit]);
    return { tree: sha.slice(0, 8), from: from.slice(0, 8), files: unit.map((f) => runFile(w, f)), skipped: files.filter((f) => !isUnit(f)) };
  } finally { drop(repo, w); }
}

const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { rows: [] };
const rows = new Map(prev.rows.map((r) => [r.id, r]));
for (const s of sel.selected) {
  if (only && !only.has(s.id)) continue;
  const repo = repoDir[s.repo], M = s.merge.sha, P = s.merge.parent;
  const replay = git(join(root, s.id), ['rev-parse', 'HEAD']).trim();
  const shipped = testFilesOf(repo, P, M);
  const row = { id: s.id, repo: s.repo, replayHead: replay.slice(0, 8), shippedTests: shipped,
    shippedOnOriginal: runOn(repo, M, M, shipped), shippedOnReplay: runOn(repo, replay, M, shipped) };
  const F = FIXES[s.id];
  if (F) {
    const Fp = git(repo, ['rev-parse', `${F}^1`]).trim();
    const fixTests = testFilesOf(repo, Fp, F);
    row.fix = { sha: F, tests: fixTests, onOriginal: runOn(repo, M, F, fixTests), onFix: runOn(repo, F, F, fixTests), onReplay: runOn(repo, replay, F, fixTests) };
  }
  rows.set(s.id, row);
  const sum = (x) => x.files.reduce((a, f) => [a[0] + (f.pass || 0), a[1] + (f.fail || 0)], [0, 0]).join('/');
  console.log(`${s.id}\tshipped on original ${sum(row.shippedOnOriginal)}\ton replay ${sum(row.shippedOnReplay)}` + (row.fix ? `\tfix tests: original ${sum(row.fix.onOriginal)} fix ${sum(row.fix.onFix)} replay ${sum(row.fix.onReplay)}` : ''));
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), note: 'pass/fail per file; counts are node --test summary lines', rows: [...rows.values()] }, null, 1));
