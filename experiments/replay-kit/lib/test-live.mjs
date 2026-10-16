// Test tier ("captured from the unit tests, live per side"): run each unit-test
// file that reaches the target, once per side, in a child process (cwd = the
// origin/main snapshot) under test-preload.mjs. Every import of the snapshot's
// target is redirected to a generated shim that re-exports the SIDE's copy
// wrapped by test-record.mjs. The two sides' call records are compared call
// by call (same per-file sequence index) with compare.mjs, and each test's
// TAP ok/not-ok and the file exit code are compared too. Adapted from
// rung5a/replay/lib/test-tier.mjs (which compared two pinned files in place).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { compareObs } from './compare.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FILE_TIMEOUT_MS = 240000;

function childEnv(cfg, recOut, targetUrl, snapshotDir) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS; delete env.NODE_TEST_CONTEXT;
  env.TZ = 'UTC';
  env.REPLAY_CHILD_JSON = JSON.stringify(cfg);
  env.REPLAY_SNAPSHOT_DIR = snapshotDir;
  if (targetUrl) env.REPLAY_TARGET_URL = targetUrl;
  if (recOut) env.REPLAY_REC_OUT = recOut;
  return env;
}

function exportNames(side, snapshotDir) {
  return new Promise((resolve, reject) => {
    const code = `import(${JSON.stringify(side.mainUrl)}).then(m => { process.stdout.write(JSON.stringify(Object.keys(m))); })`;
    const cfg = { roots: [side.workRootUrl], redirect: {}, now: '2026-10-01T12:00:00.000Z', seed: 1 };
    const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(HERE, 'test-preload.mjs')).href, '--input-type=module', '-e', code], { cwd: snapshotDir, env: childEnv(cfg, null, null, snapshotDir), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', (c) => (c === 0 ? resolve(JSON.parse(out)) : reject(new Error(`export scan failed for ${side.label}: ${err.slice(0, 800)}`))));
  });
}

async function writeShim(side, runDir, { snapshotDir, main, factories }) {
  const shimDir = path.join(runDir, `${side.label}-shim`);
  fs.mkdirSync(shimDir, { recursive: true });
  const names = await exportNames(side, snapshotDir);
  const recUrl = pathToFileURL(path.join(HERE, 'test-record.mjs')).href;
  const lines = [`import * as real from ${JSON.stringify(side.mainUrl)};`, `import { wrapExport } from ${JSON.stringify(recUrl)};`];
  for (const n of names) {
    const opts = factories.includes(n) ? ', { factoryMethods: true }' : '';
    lines.push(n === 'default' ? `export default wrapExport('default', real.default${opts});` : `export const ${n} = wrapExport(${JSON.stringify(n)}, real[${JSON.stringify(n)}]${opts});`);
  }
  const shimPath = path.join(shimDir, main.replace(/\.js$/, '.mjs'));
  fs.writeFileSync(shimPath, lines.join('\n') + '\n');
  const targetUrl = pathToFileURL(path.join(snapshotDir, 'lib', main)).href;
  return { [targetUrl]: { url: pathToFileURL(shimPath).href, shimDirUrl: pathToFileURL(shimDir + path.sep).href } };
}

/** TAP → [{ path: 'suite > test', ok, directive, error }] (nested subtests by indentation). */
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

function runFile(file, cfg, recOut, { targetUrl, snapshotDir }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const args = ['--import', pathToFileURL(path.join(HERE, 'test-preload.mjs')).href, '--test-reporter=tap', file];
    const child = spawn(process.execPath, args, { cwd: snapshotDir, env: childEnv(cfg, recOut, targetUrl, snapshotDir), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { if (err.length < 20000) err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), FILE_TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let records = null;
      try { records = JSON.parse(fs.readFileSync(recOut, 'utf8')); } catch { records = null; }
      resolve({ file, code, signal, ms: Math.round(performance.now() - t0), tests: parseTap(out), records, stderrTail: err.slice(-1500) });
    });
  });
}

async function pool(items, jobs, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Unit-test files whose static import graph (regex scan) reaches lib/<main> in the snapshot. */
export function staticCandidates(snapshotDir, main) {
  const testsDir = path.join(snapshotDir, 'tests', 'unit');
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
  const targetFile = path.join(snapshotDir, 'lib', main);
  const memo = new Map();
  const reach = (abs, stack = new Set()) => {
    if (abs === targetFile) return true;
    if (memo.has(abs)) return memo.get(abs);
    if (stack.has(abs)) return false;
    stack.add(abs);
    const r = (graph.get(abs) || []).some(d => reach(d, stack));
    stack.delete(abs);
    memo.set(abs, r);
    return r;
  };
  const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.js')).map(f => path.join(testsDir, f)).sort();
  for (const f of files) scan(f);
  return files.filter(f => reach(f)).map(f => path.relative(snapshotDir, f));
}

export async function runTestTier({ sides, runDir, cfg, jobs = 4, now, seed = 1, rediscover = false, log = () => {} }) {
  const { snapshotDir, main, factories = [], targetUrl, testFilesPath, excludeTests = [] } = cfg;
  fs.mkdirSync(path.join(runDir, 'records'), { recursive: true });
  const redirects = {};
  for (const s of sides) redirects[s.label] = await writeShim(s, runDir, { snapshotDir, main, factories });
  const childCfg = (s) => ({ roots: [s.workRootUrl], redirect: redirects[s.label], now, seed });
  let files = null;
  let discovery = null;
  if (!rediscover && fs.existsSync(testFilesPath)) files = JSON.parse(fs.readFileSync(testFilesPath, 'utf8')).files;
  if (!files) {
    const cand = staticCandidates(snapshotDir, main).filter(f => !excludeTests.includes(path.basename(f)));
    log(`test tier: discovering among ${cand.length} statically-reaching test files (old side only)`);
    const runs = await pool(cand, jobs, (f, i) => runFile(f, childCfg(sides[0]), path.join(runDir, 'records', `disc-${i}.json`), { targetUrl, snapshotDir }));
    files = runs.filter(r => r.records && r.records.length > 0).map(r => r.file);
    discovery = { candidates: cand.length, withCalls: files.length, calls: Object.fromEntries(runs.filter(r => r.records?.length).map(r => [r.file, r.records.length])), failingOnOld: runs.filter(r => r.tests.some(t => !t.ok)).map(r => r.file) };
    fs.mkdirSync(path.dirname(testFilesPath), { recursive: true });
    fs.writeFileSync(testFilesPath, JSON.stringify({ note: 'Unit-test files that call a target export (discovered with the pinned old side). Regenerate with --rediscover-tests.', ...discovery, files }, null, 1));
  }
  log(`test tier: ${files.length} test files x 2 sides (jobs ${jobs})`);
  const results = await pool(files, jobs, async (f, i) => {
    const o = await runFile(f, childCfg(sides[0]), path.join(runDir, 'records', `old-${i}.json`), { targetUrl, snapshotDir });
    const n = await runFile(f, childCfg(sides[1]), path.join(runDir, 'records', `new-${i}.json`), { targetUrl, snapshotDir });
    return { file: f, old: o, new: n };
  });

  const items = [];
  const perFile = [];
  const byFn = {};
  for (const r of results) {
    const base = `test:${path.basename(r.file)}`;
    const or = r.old.records || []; const nr = r.new.records || [];
    for (const c of or) byFn[c.fn] = (byFn[c.fn] || 0) + 1;
    const fileDiffs = [];
    if (r.old.records === null || r.new.records === null) fileDiffs.push({ kind: 'test-records-missing', sig: 'test-records-missing', old: r.old.records === null ? 'missing' : or.length, new: r.new.records === null ? 'missing' : nr.length });
    const n = Math.max(or.length, nr.length);
    for (let k = 0; k < n; k++) {
      const a = or[k]; const b = nr[k];
      const diffs = []; let info = [];
      if (!a || !b) diffs.push({ kind: 'test-call-count', sig: 'test-call-count', old: or.length, new: nr.length });
      else {
        if (a.fn !== b.fn || a.caller !== b.caller) diffs.push({ kind: 'test-call-sequence', sig: 'test-call-sequence', old: `${a.fn} @ ${a.caller}`, new: `${b.fn} @ ${b.caller}` });
        const c = compareObs({ importConsole: [], steps: [a] }, { importConsole: [], steps: [b] });
        diffs.push(...c.diffs); info = c.info;
      }
      const findings = { old: a?.findings || [], new: b?.findings || [] };
      items.push({ id: `${base}#${k}`, tier: 'test', family: path.basename(r.file), site: a?.caller ?? b?.caller, diffs, info, facts: a ? [{ fn: a.fn, mode: a.mode, calls: a.calls.length }] : [], findings: { old: findings.old.map(f => ({ step: 0, fn: a?.fn, ...f })), new: findings.new.map(f => ({ step: 0, fn: b?.fn, ...f })) } });
      if (!a || !b) break;
    }
    const ot = new Map(r.old.tests.map(t => [t.path, t])); const nt = new Map(r.new.tests.map(t => [t.path, t]));
    for (const k of new Set([...ot.keys(), ...nt.keys()])) {
      const a = ot.get(k); const b = nt.get(k);
      if (!a || !b || a.ok !== b.ok) fileDiffs.push({ kind: 'test-outcome', sig: `test-outcome ${!a ? 'added' : !b ? 'missing' : a.ok ? 'pass->fail' : 'fail->pass'}`, path: k, old: a ? (a.ok ? 'ok' : `not ok: ${a.error}`) : '(absent)', new: b ? (b.ok ? 'ok' : `not ok: ${b.error}`) : '(absent)' });
    }
    if ((r.old.code === 0) !== (r.new.code === 0)) fileDiffs.push({ kind: 'test-file-exit', sig: 'test-file-exit', old: `${r.old.code}${r.old.signal ? ' ' + r.old.signal : ''}`, new: `${r.new.code}${r.new.signal ? ' ' + r.new.signal : ''}`, newStderr: r.new.stderrTail.slice(-400) });
    if (fileDiffs.length) items.push({ id: `${base}#file`, tier: 'test', family: path.basename(r.file), site: r.file, diffs: fileDiffs, info: [], facts: [], findings: { old: [], new: [] }, fileLevel: true });
    perFile.push({ file: r.file, calls: { old: or.length, new: nr.length }, tests: { old: r.old.tests.length, oldFailing: r.old.tests.filter(t => !t.ok).length, new: r.new.tests.length, newFailing: r.new.tests.filter(t => !t.ok).length }, exit: { old: r.old.code, new: r.new.code }, ms: { old: r.old.ms, new: r.new.ms }, oldFailures: r.old.tests.filter(t => !t.ok).slice(0, 5).map(t => `${t.path}: ${t.error}`) });
  }
  return { items, summary: { files: files.length, discovery, callsByExport: byFn, perFile } };
}
