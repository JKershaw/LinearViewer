// Test tier: run the existing unit-test files that reach the targets, once per
// side, in child processes with lib/test-preload.mjs. Each child records every
// call to a target export (lib/test-record.mjs); the two sides' records are
// compared call by call (same per-file sequence index), and each test's
// TAP ok/not-ok is compared too.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO, REPO_LIB, TARGETS } from './sides.mjs';
import { compareObs } from './compare.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PINNED_LIST = path.join(HERE, '..', 'pinned', 'test-files.json');
const FILE_TIMEOUT_MS = 240000;

async function writeShims(side, runDir) {
  const shimDir = path.join(runDir, side.label, 'shim');
  fs.mkdirSync(shimDir, { recursive: true });
  const redirect = {};
  const recUrl = pathToFileURL(path.join(HERE, 'test-record.mjs')).href;
  for (const f of TARGETS) {
    const mod = f === 'dispatch-factory.js' ? 'factory' : 'validation';
    // Export names: parse them from the side module itself (in a throwaway child,
    // so this process's module graph is untouched).
    const names = await exportNames(side, f);
    const lines = [`import * as real from ${JSON.stringify(side.files[f].url)};`, `import { wrapExport } from ${JSON.stringify(recUrl)};`];
    for (const n of names) lines.push(n === 'default' ? `export default wrapExport('${mod}', 'default', real.default);` : `export const ${n} = wrapExport('${mod}', ${JSON.stringify(n)}, real[${JSON.stringify(n)}]);`);
    const shimPath = path.join(shimDir, f.replace(/\.js$/, '.mjs'));
    fs.writeFileSync(shimPath, lines.join('\n') + '\n');
    redirect[pathToFileURL(path.join(REPO_LIB, f)).href] = { url: pathToFileURL(shimPath).href, shimDirUrl: pathToFileURL(shimDir + path.sep).href };
  }
  return redirect;
}

function exportNames(side, f) {
  return new Promise((resolve, reject) => {
    const code = `import(${JSON.stringify(pathToFileURL(path.join(HERE, 'test-preload.mjs')).href)}).then(() => import(${JSON.stringify(side.files[f].url)})).then(m => { process.stdout.write(JSON.stringify(Object.keys(m))); })`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: REPO, env: childEnv(side, { redirect: {} }, null), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', (c) => (c === 0 ? resolve(JSON.parse(out)) : reject(new Error(`export scan failed for ${side.label}/${f}: ${err.slice(0, 500)}`))));
  });
}

function childEnv(side, extra, recOut, { now, seed } = {}) {
  const env = { ...process.env, ...(process.env.__REPLAY_REAL_ENV ? JSON.parse(process.env.__REPLAY_REAL_ENV) : {}) };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  env.TZ = 'UTC';
  env.REPLAY_SIDE_JSON = JSON.stringify({ label: side.label, workLib: side.workLib, workLibUrl: side.workLibUrl, srcLib: side.srcLib, redirect: extra.redirect });
  if (recOut) env.REPLAY_REC_OUT = recOut;
  if (now) env.REPLAY_NOW = now;
  env.REPLAY_SEED = String(seed ?? 1);
  return env;
}

function runFile(file, side, redirect, recOut, opts) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const args = ['--import', pathToFileURL(path.join(HERE, 'test-preload.mjs')).href, '--test-reporter=tap', file];
    const child = spawn(process.execPath, args, { cwd: REPO, env: childEnv(side, { redirect }, recOut, opts), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { if (err.length < 20000) err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), FILE_TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let records = [];
      try { records = JSON.parse(fs.readFileSync(recOut, 'utf8')); } catch { records = null; }
      resolve({ file, code, signal, ms: Math.round(performance.now() - t0), tests: parseTap(out), records, stderrTail: err.slice(-1500) });
    });
  });
}

/** TAP → [{ path: 'suite > test', ok, todo, skip, error }] (nested subtests by indentation). */
export function parseTap(out) {
  const res = [];
  const stack = [];
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^(\s*)# Subtest: (.*)$/);
    if (m) { const lvl = m[1].length / 4; stack.length = lvl; stack[lvl] = m[2]; continue; }
    const t = l.match(/^(\s*)(not ok|ok) \d+ - (.*?)(\s+#\s*(SKIP|TODO).*)?$/);
    if (t) {
      const lvl = t[1].length / 4;
      const name = [...stack.slice(0, lvl), t[3]].join(' > ');
      let error = null;
      if (t[2] === 'not ok') {
        for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
          const em = lines[j].match(/^\s*error:\s*(.*)$/);
          if (em) { error = em[1].slice(0, 300); break; }
          if (/^\s*(not ok|ok) \d+/.test(lines[j])) break;
        }
      }
      res.push({ path: name, ok: t[2] === 'ok', directive: t[5] || null, error });
      stack.length = lvl;
    }
  }
  return res;
}

async function pool(items, jobs, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Static candidates: unit test files whose import graph (regex scan) reaches a target. */
export function staticCandidates() {
  const testsDir = path.join(REPO, 'tests', 'unit');
  const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
  const graph = new Map();
  const scan = (abs) => {
    if (graph.has(abs)) return;
    let src = '';
    try { src = fs.readFileSync(abs, 'utf8'); } catch { graph.set(abs, []); return; }
    const deps = [];
    for (const m of src.matchAll(IMPORT_RE)) {
      let p = path.resolve(path.dirname(abs), m[2]);
      if (!fs.existsSync(p) && fs.existsSync(p + '.js')) p += '.js';
      if (fs.existsSync(p) && fs.statSync(p).isFile()) deps.push(p);
    }
    graph.set(abs, deps);
    for (const d of deps) scan(d);
  };
  const targets = new Set(TARGETS.map(f => path.join(REPO_LIB, f)));
  const reaches = new Map();
  const reach = (abs, stack = new Set()) => {
    if (targets.has(abs)) return true;
    if (reaches.has(abs)) return reaches.get(abs);
    if (stack.has(abs)) return false;
    stack.add(abs);
    const r = (graph.get(abs) || []).some(d => reach(d, stack));
    stack.delete(abs);
    reaches.set(abs, r);
    return r;
  };
  const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js')).map(f => path.join(testsDir, f)).sort();
  for (const f of files) scan(f);
  return files.filter(f => reach(f)).map(f => path.relative(REPO, f));
}

export async function runTestTier({ sides, runDir, jobs = 4, now, seed = 1, rediscover = false, log = () => {}, files: forced = null }) {
  const recDir = path.join(runDir, 'records');
  fs.mkdirSync(recDir, { recursive: true });
  const redirects = { old: await writeShims(sides.old, runDir), new: await writeShims(sides.new, runDir) };
  let files = forced;
  let discovery = null;
  if (!files && !rediscover && fs.existsSync(PINNED_LIST)) files = JSON.parse(fs.readFileSync(PINNED_LIST, 'utf8')).files;
  if (!files) {
    const cand = staticCandidates();
    log(`test tier: discovering among ${cand.length} statically-reaching test files (old side only)`);
    const runs = await pool(cand, jobs, (f, i) => runFile(f, sides.old, redirects.old, path.join(recDir, `disc-${i}.json`), { now, seed }));
    files = runs.filter(r => r.records && r.records.length > 0).map(r => r.file);
    discovery = { candidates: cand.length, withCalls: files.length, calls: Object.fromEntries(runs.filter(r => r.records?.length).map(r => [r.file, r.records.length])), failingOnOld: runs.filter(r => r.tests.some(t => !t.ok)).map(r => r.file) };
    fs.writeFileSync(PINNED_LIST, JSON.stringify({ note: 'Unit test files that call a target export (discovered with the pinned old side). Regenerate with --rediscover-tests.', discoveredAt: new Date().toISOString(), ...discovery, files }, null, 1));
  }
  log(`test tier: ${files.length} test files x 2 sides (jobs ${jobs})`);
  const results = await pool(files, jobs, async (f, i) => {
    const o = await runFile(f, sides.old, redirects.old, path.join(recDir, `old-${i}.json`), { now, seed });
    const n = await runFile(f, sides.new, redirects.new, path.join(recDir, `new-${i}.json`), { now, seed });
    return { file: f, old: o, new: n };
  });

  const entries = []; const infoEntries = [];
  const byTier = { inputs: 0, differing: 0, calls: 0, files: files.length, testsOld: 0, testsFailingOld: 0 };
  const perFile = [];
  for (const r of results) {
    const id = `test:${path.basename(r.file)}`;
    const fileDiffs = [];
    const or = r.old.records || []; const nr = r.new.records || [];
    byTier.calls += or.length;
    byTier.inputs += or.length;
    if (r.old.records === null || r.new.records === null) fileDiffs.push({ kind: 'test-records-missing', sig: 'test records missing (child crashed?)', old: r.old.records === null ? 'missing' : or.length, new: r.new.records === null ? 'missing' : nr.length });
    const n = Math.max(or.length, nr.length);
    let differingCalls = 0;
    for (let k = 0; k < n; k++) {
      const a = or[k]; const b = nr[k];
      const callDiffs = [];
      if (!a || !b) callDiffs.push({ kind: 'test-call-count', sig: 'test call-count', old: or.length, new: nr.length });
      else {
        if (a.fn !== b.fn || a.caller !== b.caller) callDiffs.push({ kind: 'test-call-sequence', sig: 'test call-sequence', old: `${a.fn} @ ${a.caller}`, new: `${b.fn} @ ${b.caller}` });
        const { diffs, info } = compareObs([a], [b]);
        callDiffs.push(...diffs.map(d => ({ ...d, sig: `test ${d.sig}` })));
        if (a.fn === b.fn) {
          const { canon, firstDiff } = await import('./observe.mjs');
          if (canon(a.args) !== canon(b.args)) callDiffs.push({ kind: 'test-args', sig: `test ${a.fn} args (upstream divergence)`, ...firstDiff(a.args, b.args, '$args') });
        }
        for (const x of info) infoEntries.push({ inputId: `${id}#${k}`, tier: 'test', diff: { ...x, sig: `test ${x.sig}` } });
      }
      if (callDiffs.length) differingCalls++;
      for (const d of callDiffs) { entries.push({ inputId: `${id}#${k}@${a?.caller ?? b?.caller}`, tier: 'test', diff: d }); fileDiffs.push(d); }
      if (!a || !b) break;
    }
    byTier.differing += differingCalls;
    // Per-test TAP outcomes.
    const ot = new Map(r.old.tests.map(t => [t.path, t])); const nt = new Map(r.new.tests.map(t => [t.path, t]));
    byTier.testsOld += r.old.tests.length;
    byTier.testsFailingOld += r.old.tests.filter(t => !t.ok).length;
    for (const k of new Set([...ot.keys(), ...nt.keys()])) {
      const a = ot.get(k); const b = nt.get(k);
      if (!a || !b || a.ok !== b.ok) {
        const d = { kind: 'test-outcome', sig: `test-outcome ${!a ? 'added' : !b ? 'missing' : a.ok ? 'pass->fail' : 'fail->pass'}`, path: k, old: a ? (a.ok ? 'ok' : `not ok: ${a.error}`) : '(absent)', new: b ? (b.ok ? 'ok' : `not ok: ${b.error}`) : '(absent)' };
        entries.push({ inputId: `${id} > ${k}`, tier: 'test', diff: d });
        fileDiffs.push(d);
      }
    }
    if ((r.old.code === 0) !== (r.new.code === 0)) {
      const d = { kind: 'test-file-exit', sig: 'test-file exit code', old: `${r.old.code}${r.old.signal ? ' ' + r.old.signal : ''}`, new: `${r.new.code}${r.new.signal ? ' ' + r.new.signal : ''}`, newStderr: r.new.stderrTail.slice(-400) };
      entries.push({ inputId: id, tier: 'test', diff: d });
      fileDiffs.push(d);
    }
    perFile.push({ file: r.file, calls: { old: or.length, new: nr.length }, tests: { old: r.old.tests.length, oldFailing: r.old.tests.filter(t => !t.ok).length, new: r.new.tests.length, newFailing: r.new.tests.filter(t => !t.ok).length }, exit: { old: r.old.code, new: r.new.code }, ms: { old: r.old.ms, new: r.new.ms }, diffs: fileDiffs.length, oldFailures: r.old.tests.filter(t => !t.ok).slice(0, 5).map(t => `${t.path}: ${t.error}`) });
  }
  const byFn = {};
  for (const r of results) for (const c of r.old.records || []) byFn[c.fn] = (byFn[c.fn] || 0) + 1;
  return { entries, infoEntries, byTier, summary: { files: files.length, discovery, callsByExport: byFn, perFile } };
}
