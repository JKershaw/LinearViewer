// Capture the real arguments the existing unit tests pass to the cluster's
// exports. Every test file whose static import closure reaches one of the four
// modules (directly or through routes/, server.js, lib/) is run in a child
// process under capture-preload.mjs, with the four modules swapped for
// recording shims. Tests run from a scratch tree (tests/ copied, everything
// else symlinked to the repo) so nothing they write lands in the repo.
// Output: work/captured-<now>.v8 (cached; --recapture redoes it).
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SURFACE } from './targets.mjs';
import { REPO, TARGETS } from './load.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);

export function capturePath(workDir, now) { return path.join(workDir, `captured-${now.replace(/[:.]/g, '')}.v8`); }

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
export function testsReachingTargets(repo = REPO) {
  const cache = new Map();
  const deps = (f) => {
    if (cache.has(f)) return cache.get(f);
    let s = '';
    try { s = fs.readFileSync(f, 'utf8'); } catch { cache.set(f, []); return []; }
    const out = [];
    for (const m of s.matchAll(IMPORT_RE)) { const sp = m[1] || m[2]; if (sp && sp.startsWith('.')) out.push(path.resolve(path.dirname(f), sp)); }
    cache.set(f, out);
    return out;
  };
  const targets = new Set(Object.values(TARGETS).map(x => path.join(repo, 'lib', x)));
  const memo = new Map();
  const reaches = (f, stack = new Set()) => {
    if (memo.has(f)) return memo.get(f);
    if (stack.has(f)) return false;
    stack.add(f);
    let r = targets.has(f);
    for (const d of deps(f)) if (!r && reaches(d, stack)) r = true;
    stack.delete(f);
    memo.set(f, r);
    return r;
  };
  return fs.readdirSync(path.join(repo, 'tests/unit')).filter(f => f.endsWith('.test.js')).sort()
    .filter(f => reaches(path.join(repo, 'tests/unit', f))).map(f => `tests/unit/${f}`);
}

function writeShims(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const map = {};
  const rec = pathToFileURL(path.join(here, 'capture-rec.mjs')).href;
  for (const [mod, file] of Object.entries(TARGETS)) {
    const real = pathToFileURL(path.join(REPO, 'lib', file)).href;
    const lines = [`import * as real from '${real}';`, `import { record } from '${rec}';`];
    for (const [name, kind] of Object.entries(SURFACE[mod])) {
      if (kind === 'const') lines.push(`export const ${name} = real.${name};`);
      else lines.push(`export function ${name}(...a) { record('${mod}', '${name}', a); return real.${name}.apply(this, a); }`);
    }
    const shim = path.join(dir, `${mod}.mjs`);
    fs.writeFileSync(shim, lines.join('\n') + '\n');
    map[real] = pathToFileURL(shim).href;
  }
  return map;
}

function buildTree(treeDir) {
  fs.rmSync(treeDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(treeDir, 'tests'), { recursive: true });
  for (const entry of fs.readdirSync(REPO)) {
    if (['tests', 'data', '.git'].includes(entry)) continue;
    fs.symlinkSync(path.join(REPO, entry), path.join(treeDir, entry));
  }
  for (const entry of fs.readdirSync(path.join(REPO, 'tests'))) {
    if (entry === 'e2e') continue;
    fs.cpSync(path.join(REPO, 'tests', entry), path.join(treeDir, 'tests', entry), { recursive: true });
  }
}

function runOne(treeDir, rel, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', path.join(here, 'capture-preload.mjs'), path.join(treeDir, rel)], { cwd: treeDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', d => { if (out.length < 2e6) out += d; });
    child.stderr.on('data', d => { if (err.length < 2e5) err += d; });
    const t = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(t); resolve({ code, signal, out, err }); });
  });
}

export async function runCapture({ workDir, now, log = console.log, jobs = Math.max(2, os.cpus().length), timeoutMs = 120000, only = null }) {
  workDir = path.resolve(workDir);
  const capDir = path.join(workDir, 'capture');
  const treeDir = path.join(capDir, 'tree');
  const outDir = path.join(capDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const map = writeShims(path.join(capDir, 'shims'));
  buildTree(treeDir);
  const files = only || testsReachingTargets();
  const head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--', 'lib', 'routes', 'server.js', 'tests'], { encoding: 'utf8' }).trim();
  log(`capturing from ${files.length} unit-test files (repo HEAD ${head.slice(0, 8)}${dirty ? ', DIRTY' : ''}, ${jobs} jobs)`);
  const results = [];
  let next = 0; let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const rel = files[next++];
      const outFile = path.join(outDir, path.basename(rel) + '.v8');
      let r; let frozen = true;
      for (const freeze of ['1', '0']) {
        fs.rmSync(outFile, { force: true });
        r = await runOne(treeDir, rel, { ...process.env, TZ: 'UTC', REPLAY_NOW: now, REPLAY_FREEZE: freeze, REPLAY_SHIM_MAP: JSON.stringify(map), REPLAY_CAPTURE_OUT: outFile }, timeoutMs);
        frozen = freeze === '1';
        if (fs.existsSync(outFile) && !r.signal) break;
      }
      const records = fs.existsSync(outFile) ? v8.deserialize(fs.readFileSync(outFile)) : [];
      const num = (re) => Number((r.out.match(re) || [])[1] ?? NaN);
      results.push({ file: rel, exit: r.code, signal: r.signal, frozenClock: frozen, testsPass: num(/^(?:ℹ|#) pass (\d+)/m), testsFail: num(/^(?:ℹ|#) fail (\d+)/m), records, stderrTail: r.code ? r.err.slice(-400) : undefined });
      done++;
      if (done % 25 === 0) log(`  ${done}/${files.length} files`);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  results.sort((a, b) => a.file.localeCompare(b.file));
  const all = { now, head, dirty: !!dirty, files: results };
  fs.writeFileSync(capturePath(workDir, now), v8.serialize(all));
  const n = results.reduce((s, f) => s + f.records.length, 0);
  log(`  captured ${n} distinct calls from ${results.filter(f => f.records.length).length} files`);
  return all;
}

export async function loadCapture({ workDir, now, recapture = false, log, jobs }) {
  const p = capturePath(workDir, now);
  if (!recapture && fs.existsSync(p)) return v8.deserialize(fs.readFileSync(p));
  return runCapture({ workDir, now, log, jobs });
}
