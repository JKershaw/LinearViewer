// Run each sampled mutant against the unit-test files that could see it, record killing files and tests.
// Candidate files = files whose coverage includes the mutated line ∪ files whose source names the mutated file's basename
//                 ∪ files that scan production directories. --full runs every file instead (to validate the selection).
// Usage: node mutate.mjs <worktree> <cov.json> <sample.json> <out.json> [--full] [--only id,id]
import { spawnSync, spawn, execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { resolve, basename, join } from 'path';

const [work, covPath, samplePath, out] = process.argv.slice(2, 6).map((p) => resolve(p));
const full = process.argv.includes('--full');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > 0 ? new Set(process.argv[onlyIdx + 1].split(',')) : null;
const reporter = resolve(work, 'scripts/survey-tests-reporter.mjs');
const cov = JSON.parse(readFileSync(covPath, 'utf8'));
const testFiles = Object.keys(cov);
const text = Object.fromEntries(testFiles.map((f) => [f, readFileSync(resolve(work, f), 'utf8')]));
const scanners = testFiles.filter((f) => /readdirSync|globSync|git ls-files|walk\(/.test(text[f]));
const sample = JSON.parse(readFileSync(samplePath, 'utf8')).filter((m) => !only || only.has(m.id));
const prior = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
const confirm = process.argv.includes('--confirm');

function candidates(m) {
  if (full) return testFiles;
  const base = basename(m.file);
  const s = new Set(scanners);
  for (const f of testFiles) {
    if ((cov[f].cov[m.file] || []).includes(m.line)) s.add(f);
    else if (text[f].includes(base)) s.add(f);
  }
  return [...s].sort();
}

// One node --test process per candidate file, 8 at a time, each in its own process group with a 90 s budget.
// A file that hangs past its budget counts as a kill (CI would time out on it).
async function runOne(f, k) {
  const dest = resolve(work, '..', `.mut-${process.pid}-${k}.jsonl`);
  if (existsSync(dest)) rmSync(dest);
  const timedOut = await new Promise((res) => {
    const p = spawn(process.execPath, ['--test', '--test-force-exit', '--test-timeout=30000', `--test-reporter=${reporter}`, `--test-reporter-destination=${dest}`, f],
      { cwd: work, env: { ...process.env, HARBOUR_LOCAL_BASE: '' }, stdio: 'ignore', detached: true });
    let to = false;
    const t = setTimeout(() => { to = true; try { process.kill(-p.pid, 'SIGKILL'); } catch {} }, 90_000);
    p.on('exit', () => { clearTimeout(t); res(to); });
  });
  const rows = existsSync(dest) ? readFileSync(dest, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : [];
  const failed = rows.filter((x) => x.name !== undefined && !x.ok && !x.skip && !x.todo).map((x) => `${f}::${x.nesting}::${x.name}`);
  if (timedOut) failed.push(`${f}::-1::TIMEOUT`);
  return { f, failed, timedOut };
}
async function run(files) {
  const t0 = Date.now();
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: 8 }, async (_, k) => { while (i < files.length) { const f = files[i++]; out.push(await runOne(f, k)); } }));
  const killFiles = out.filter((o) => o.failed.length).map((o) => o.f).sort();
  return { ms: Date.now() - t0, killFiles, killTests: out.flatMap((o) => o.failed), timedOutFiles: out.filter((o) => o.timedOut).map((o) => o.f) };
}

let n = 0;
for (const m of sample) {
  n++;
  if (confirm) {
    const r0 = prior[m.id];
    if (!r0 || r0.outcome !== 'killed' || r0.confirmedFiles) continue;
    const path = resolve(work, m.file); const orig = readFileSync(path, 'utf8'); const lines = orig.split('\n');
    const mutated = [...lines];
    mutated[m.line - 1] = m.kind === 'logic' ? lines[m.line - 1].replace(m.before, m.after) : m.kind === 'hist' ? m.afterRaw : '';
    writeFileSync(path, mutated.join('\n'));
    try { const r = await run(r0.killFiles); r0.confirmedFiles = r.killFiles; r0.confirmedTests = r.killTests; } finally { writeFileSync(path, orig); }
    process.stderr.write(`confirm ${n}/${sample.length} ${m.id} ${r0.killFiles.length} -> ${r0.confirmedFiles.length}\n`);
    if (n % 10 === 0) writeFileSync(out, JSON.stringify(prior));
    continue;
  }
  if (prior[m.id] && prior[m.id].full === full) continue;
  const path = resolve(work, m.file);
  const orig = readFileSync(path, 'utf8');
  const lines = orig.split('\n');
  if (lines[m.line - 1].trim() !== m.before) { prior[m.id] = { ...m, outcome: 'not applied' }; continue; }
  const mutated = [...lines];
  mutated[m.line - 1] = m.kind === 'logic' ? lines[m.line - 1].replace(m.before, m.after) : m.kind === 'hist' ? m.afterRaw : '';
  writeFileSync(path, mutated.join('\n'));
  let res;
  try {
    const chk = /\.m?js$/.test(path) ? spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' }) : { status: 0 };
    if (chk.status !== 0) { prior[m.id] = { ...m, outcome: 'syntax error' }; continue; }
    const files = candidates(m);
    res = await run(files);
    prior[m.id] = { ...m, full, candidates: files.length, outcome: res.killFiles.length ? 'killed' : 'survived', ...res };
  } finally { writeFileSync(path, orig); }
  process.stderr.write(`${n}/${sample.length} ${m.id} ${m.file}:${m.line} ${m.kind} cand=${prior[m.id].candidates} ${prior[m.id].outcome} files=${res?.killFiles.length} ${res?.ms}ms\n`);
  if (n % 5 === 0) writeFileSync(out, JSON.stringify(prior));
}
writeFileSync(out, JSON.stringify(prior));
const vals = Object.values(prior);
console.log('done', vals.length, 'killed', vals.filter((v) => v.outcome === 'killed').length, 'survived', vals.filter((v) => v.outcome === 'survived').length);
