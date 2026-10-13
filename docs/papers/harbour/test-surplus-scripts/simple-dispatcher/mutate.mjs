// LIN-3551: adapted from LinearViewer/scripts/survey-tests-mutate.mjs (sd mode).
// Runs simple-dispatcher's curated mutants + a fresh deterministic operator-flip sample against the unit suite,
// one mutant at a time, in a scratch worktree; appends one JSON line per mutant to results.jsonl (resumable).
// Usage: node mutate.mjs --work <worktree> [--dry] [--baseline-runs 3]
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const flag = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const work = resolve(flag('--work', resolve(here, 'sd-wt')));
const reporter = resolve(here, 'reporter.mjs');
const outJsonl = resolve(here, 'results.jsonl');
const FRESH_MODULES = ['reapers.js', 'dispatcher.js', 'hook.js', 'opencode-runner.js', 'terminal-driver.js', 'config.js'];
const PER_MODULE = 7;

function runSuite(tag) {
  const dest = resolve(here, `.run-${tag}.jsonl`);
  if (existsSync(dest)) rmSync(dest);
  const files = execFileSync('bash', ['-c', 'ls test/*.test.js'], { cwd: work, encoding: 'utf8' }).trim().split('\n');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--require', './test/isolate-local-halt.js', '--test', `--test-reporter=${reporter}`, `--test-reporter-destination=${dest}`, ...files],
    { cwd: work, encoding: 'utf8', timeout: 600_000, env: { ...process.env, HARBOUR_LOCAL_BASE: '' } });
  const rows = existsSync(dest) ? readFileSync(dest, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const fails = new Set(rows.filter((x) => x.name !== undefined && !x.ok).map((x) => `${(x.file || '?').replace(work + '/', '')}::${x.nesting}::${x.name}`));
  return { fails, wallMs: Date.now() - t0, nTests: rows.filter((x) => x.name !== undefined).length, timedOut: r.error?.code === 'ETIMEDOUT' };
}

const OPERATORS = [
  [/ === /, ' !== '], [/ !== /, ' === '], [/ >= /, ' > '], [/ <= /, ' < '], [/ > /, ' >= '], [/ < /, ' <= '],
  [/ && /, ' || '], [/ \|\| /, ' && '], [/return true;/, 'return false;'], [/return false;/, 'return true;'],
  [/\?\? /, '|| '],
];

function freshMutants() {
  const out = [];
  for (const mod of FRESH_MODULES) {
    const lines = readFileSync(resolve(work, mod), 'utf8').split('\n');
    const logic = [];
    let inTemplate = false;
    lines.forEach((line, i) => {
      const code = line.trim();
      const ticks = (line.match(/(?<!\\)`/g) || []).length;
      const wasTemplate = inTemplate;
      if (ticks % 2) inTemplate = !inTemplate;
      if (!code || /^(\/\/|\*|\/\*)/.test(code)) return;
      if (wasTemplate) return;
      for (const [re, rep] of OPERATORS) if (re.test(line) && !/import |require\(/.test(line)) { logic.push({ i, re, rep }); break; }
    });
    const pick = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, k) => arr[Math.floor((k + 0.5) * arr.length / n)]));
    for (const m of pick(logic, PER_MODULE)) {
      const before = lines[m.i];
      out.push({ id: `fresh:${mod}:${m.i + 1}`, sample: 'fresh', file: mod, line: m.i + 1, before: before.trim(), after: before.replace(m.re, m.rep).trim(), candidates: logic.length });
    }
  }
  return out;
}

function curatedMutants() {
  const src = readFileSync(resolve(work, 'test/system/mutation/run-mutations.js'), 'utf8');
  const arr = src.slice(src.indexOf('const MUTANTS = [') + 'const MUTANTS = '.length, src.indexOf('\n];', src.indexOf('const MUTANTS = [')) + 2);
  const list = new Function('HARBOUR', `return ${arr};`)('HARBOUR');
  return list.map((m, k) => ({ id: `curated:${k}`, sample: 'curated', name: m.name, file: m.file, dir: m.dir, killer: m.killer, find: m.find, replace: m.replace }));
}

const mutants = [...curatedMutants(), ...freshMutants()];
if (process.argv.includes('--dry')) { for (const m of mutants) console.log(m.id, m.dir || '', m.name || `${m.before}  →  ${m.after}`); process.exit(0); }

// Baseline: several runs to catch flaky tests; union of failures is excluded from attribution.
const nBase = Number(flag('--baseline-runs', 3));
const baseRuns = [];
for (let k = 0; k < nBase; k++) { const b = runSuite('base'); baseRuns.push({ fails: [...b.fails], wallMs: b.wallMs, nTests: b.nTests }); process.stderr.write(`baseline ${k}: ${b.fails.size} failing, ${b.wallMs}ms\n`); }
writeFileSync(resolve(here, 'baseline-runs.json'), JSON.stringify(baseRuns, null, 1));
const baseline = new Set(baseRuns.flatMap((b) => b.fails));

const done = new Set(existsSync(outJsonl) ? readFileSync(outJsonl, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
for (const [n, m] of mutants.entries()) {
  if (done.has(m.id)) continue;
  const rec = { ...m, find: undefined, replace: undefined };
  if (m.dir === 'HARBOUR') { appendFileSync(outJsonl, JSON.stringify({ ...rec, outcome: 'skipped (HARBOUR)' }) + '\n'); continue; }
  const path = resolve(work, m.file);
  const orig = readFileSync(path, 'utf8');
  let mutated;
  if (m.sample === 'curated') {
    if (!orig.includes(m.find)) { appendFileSync(outJsonl, JSON.stringify({ ...rec, outcome: 'not applied' }) + '\n'); continue; }
    mutated = orig.replace(m.find, m.replace);
  } else {
    const lines = orig.split('\n');
    if (lines[m.line - 1].trim() !== m.before) throw new Error(`fresh anchor moved: ${m.id}`);
    lines[m.line - 1] = lines[m.line - 1].replace(m.before, m.after);
    mutated = lines.join('\n');
  }
  // Syntax check of the mutated module (a mutant that does not parse is reported, not run).
  writeFileSync(path, mutated);
  let r;
  try {
    const syn = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (syn.status !== 0) { appendFileSync(outJsonl, JSON.stringify({ ...rec, outcome: 'syntax error' }) + '\n'); continue; }
    r = runSuite('mut');
  } finally { writeFileSync(path, orig); }
  const killers = [...r.fails].filter((k) => !baseline.has(k));
  const killFiles = [...new Set(killers.map((k) => k.split('::')[0]))].sort();
  appendFileSync(outJsonl, JSON.stringify({ ...rec, outcome: killers.length ? 'killed' : 'survived', killFiles, killers, wallMs: r.wallMs, nTests: r.nTests, timedOut: r.timedOut }) + '\n');
  process.stderr.write(`${n + 1}/${mutants.length} ${m.id} ${killers.length ? `killed by ${killFiles.length} files` : 'SURVIVED'} (${r.wallMs}ms)\n`);
}
const st = execFileSync('git', ['status', '--porcelain'], { cwd: work, encoding: 'utf8' });
if (st.trim()) process.stderr.write(`WARNING worktree dirty:\n${st}`);
