#!/usr/bin/env node
// Behavioural replay: lib/dispatch-factory.js + lib/dispatch-validation.js.
//   node replay.mjs --old <dir> --new <dir> [--n 3000] [--seed 1] [--out report.json] [--coverage]
//                   [--tiers test,edge,gen-v,gen-vx,gen-f] [--only <inputId>] [--jobs 4] [--quiet]
//                   [--rediscover-tests] [--test-files a.test.js,b.test.js] [--now ISO]
// Exit: 0 = no behavioural difference, 1 = at least one difference, 2 = tool failure.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pinEnv, installNetworkGuard, freezeClock, installSeededRandom, networkAttempts, DEFAULT_NOW } from './lib/hermetic.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i === -1 ? dflt : argv[i + 1]; };
const flag = (name) => argv.includes(`--${name}`);

async function main() {
  const oldArg = opt('old'); const newArg = opt('new');
  if (!oldArg || !newArg) throw new Error('usage: node replay.mjs --old <dir> --new <dir> [--n 3000] [--seed 1] [--out report.json] [--coverage]');
  const N = Number(opt('n', 3000));
  const SEED = Number(opt('seed', 1));
  const NOW = opt('now', DEFAULT_NOW);
  const OUT = path.resolve(opt('out', path.join(HERE, 'work', 'report.json')));
  const TIERS = new Set(opt('tiers', 'test,edge,gen-v,gen-vx,gen-f').split(','));
  const ONLY = opt('only', null);
  const JOBS = Number(opt('jobs', 4));
  const quiet = flag('quiet');
  const wantCoverage = flag('coverage');
  const log = (...a) => { if (!quiet) console.error(...a); };

  const env = pinEnv();
  installNetworkGuard({ allowLoopback: false });
  freezeClock(NOW);
  installSeededRandom(SEED);

  const runDir = path.join(HERE, 'work', `run-${process.pid}`);
  fs.mkdirSync(runDir, { recursive: true });
  const { prepareSide, registerHooks, importSide, resolutions, REPO_LIB } = await import('./lib/sides.mjs');
  const sides = { old: prepareSide('old', oldArg, runDir), new: prepareSide('new', newArg, runDir) };
  registerHooks([sides.old, sides.new]);

  const cov = wantCoverage ? await import('./lib/coverage.mjs') : null;
  if (cov) await cov.startCoverage();

  const { createTaskDoneCache } = await import(`file://${REPO_LIB}/task-done-cache.js`);
  const { clearPrFilesCache } = await import(`file://${REPO_LIB}/github-pr-files.js`);
  const mods = {};
  const census = {};
  for (const s of ['old', 'new']) {
    const r = await importSide(sides[s]);
    mods[s] = { factory: r.factory, validation: r.validation };
    census[s] = { ...r.census, resolutions: resolutions.filter(x => x.side === s).map(x => `${x.specifier} -> ${x.via}${x.via === 'side-copied' ? ' ' + x.url : ''}`) };
  }
  const { runInput } = await import('./lib/run.mjs');
  const { compareObs, group } = await import('./lib/compare.mjs');
  const { ser, canon, firstDiff } = await import('./lib/observe.mjs');
  const gv = await import('./lib/gen-validation.mjs');
  const gf = await import('./lib/gen-factory.mjs');

  // ── exports diff ──────────────────────────────────────────────────────────
  const exportsDiff = [];
  const exportsInfo = [];
  for (const m of ['factory', 'validation']) {
    const a = mods.old[m]; const b = mods.new[m];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b)) { exportsDiff.push({ module: m, export: k, kind: 'removed' }); continue; }
      if (!(k in a)) { exportsDiff.push({ module: m, export: k, kind: 'added' }); continue; }
      const ta = typeof a[k]; const tb = typeof b[k];
      if (ta !== tb) { exportsDiff.push({ module: m, export: k, kind: 'type', old: ta, new: tb }); continue; }
      if (ta === 'function') {
        if (a[k].length !== b[k].length) exportsInfo.push({ module: m, export: k, kind: 'arity', old: a[k].length, new: b[k].length });
        if ((a[k].constructor?.name) !== (b[k].constructor?.name)) exportsDiff.push({ module: m, export: k, kind: 'function-kind', old: a[k].constructor?.name, new: b[k].constructor?.name });
        continue;
      }
      const sa = ser(a[k]); const sb = ser(b[k]);
      if (canon(sa) !== canon(sb)) exportsDiff.push({ module: m, export: k, kind: 'value', ...firstDiff(sa, sb, k) });
      if (Object.isFrozen(a[k]) !== Object.isFrozen(b[k])) exportsDiff.push({ module: m, export: k, kind: 'frozen', old: Object.isFrozen(a[k]), new: Object.isFrozen(b[k]) });
    }
  }

  // ── inputs ────────────────────────────────────────────────────────────────
  const inputs = [];
  const seedOf = (id) => crypto.createHash('sha256').update(`${SEED}|${id}`).digest().readUInt32LE(0);
  if (TIERS.has('edge')) {
    const seenNames = new Map();
    for (const e of [...gv.validationEdges(), ...gf.factoryEdges()]) {
      const c = (seenNames.get(e.name) || 0) + 1;
      seenNames.set(e.name, c);
      inputs.push({ id: `edge:${e.name}${c > 1 ? '#' + c : ''}`, tier: 'edge', ...e });
    }
  }
  if (TIERS.has('gen-v')) for (let i = 0; i < N; i++) inputs.push({ id: `gen-v:${i}`, tier: 'gen-v', ...gv.genPayloadInput(SEED, i) });
  if (TIERS.has('gen-vx')) for (let i = 0; i < Math.ceil(N / 2); i++) inputs.push({ id: `gen-vx:${i}`, tier: 'gen-vx', ...gv.genSmallInput(SEED, i) });
  if (TIERS.has('gen-f')) for (let i = 0; i < N; i++) inputs.push({ id: `gen-f:${i}`, tier: 'gen-f', ...gf.genFactoryInput(SEED, i) });
  const ids = new Set();
  for (const inp of inputs) { if (ids.has(inp.id)) throw new Error(`duplicate input id ${inp.id}`); ids.add(inp.id); inp.seed = seedOf(inp.id); }
  const selected = ONLY ? inputs.filter(x => x.id === ONLY) : inputs;
  if (ONLY && !selected.length) throw new Error(`--only ${ONLY}: no such input`);

  const support = { createTaskDoneCache, clearPrFilesCache, strCache: new Map(), baseEnv: { ...process.env } };
  const entries = []; const infoEntries = [];
  const byTier = {};
  const floor = {}; // old-side outcome histogram per export
  const differingIds = [];
  let covSnap = { old: [], new: [] };
  const t0 = process.hrtime.bigint();
  let onlyDetail = null;
  for (let k = 0; k < selected.length; k++) {
    const inp = selected[k];
    const tier = byTier[inp.tier] ||= { inputs: 0, differing: 0, calls: 0 };
    tier.inputs++;
    const o = await runInput(mods.old, inp, support);
    const n = await runInput(mods.new, inp, support);
    tier.calls += o.length;
    for (const c of o) {
      const f = floor[c.fn] ||= {};
      const key = c.outcome?.type === 'throw'
        ? `throw ${c.outcome.error?.name ?? ''}: ${String(c.outcome.error?.message ?? brief(c.outcome.error)).replace(/\d+/g, 'N').slice(0, 90)}`
        : c.outcome?.type === 'return'
          ? `return ${summarize(c.outcome.value)}`
          : `${c.outcome?.type}`;
      f[key] = (f[key] || 0) + 1;
    }
    const { diffs, info } = compareObs(o, n);
    if (diffs.length) { tier.differing++; differingIds.push(inp.id); }
    for (const d of diffs) entries.push({ inputId: inp.id, tier: inp.tier, diff: d });
    for (const d of info) infoEntries.push({ inputId: inp.id, tier: inp.tier, diff: d });
    if (ONLY) onlyDetail = { input: inp, old: o, new: n, diffs, info };
    if (!quiet && k % 1000 === 999) log(`  ${k + 1}/${selected.length} inputs`);
  }
  const elapsedMs = Number((process.hrtime.bigint() - t0) / 1000000n);
  if (cov) {
    const snap = await cov.snapshot([sides.old.files['dispatch-factory.js'].url, sides.old.files['dispatch-validation.js'].url, sides.new.files['dispatch-factory.js'].url, sides.new.files['dispatch-validation.js'].url]);
    covSnap = snap;
  }

  // ── test tier (child processes per side) ──────────────────────────────────
  let testTier = null;
  if (TIERS.has('test') && !ONLY) {
    const { runTestTier } = await import('./lib/test-tier.mjs');
    testTier = await runTestTier({ sides: { old: sides.old, new: sides.new }, runDir, jobs: JOBS, now: NOW, seed: SEED, rediscover: flag('rediscover-tests'), log, files: opt('test-files', null)?.split(',') ?? null });
    for (const e of testTier.entries) entries.push(e);
    for (const e of testTier.infoEntries) infoEntries.push(e);
    byTier.test = testTier.byTier;
  }

  // ── coverage ──────────────────────────────────────────────────────────────
  let coverage = null;
  if (cov) {
    coverage = {};
    for (const s of ['old', 'new']) {
      coverage[s] = {};
      for (const f of ['dispatch-factory.js', 'dispatch-validation.js']) {
        const url = sides[s].files[f].url;
        coverage[s][f] = cov.lineCoverage(sides[s].files[f].dest, [covSnap[url] || []]);
      }
    }
    await cov.stopCoverage();
  }

  const inputById = new Map(inputs.map(x => [x.id, x]));
  const groups = group(entries, { exampleOf: (e) => inputById.has(e.inputId) ? trimSpec(inputById.get(e.inputId)) : undefined });
  const infoGroups = group(infoEntries);
  const differing = Object.values(byTier).reduce((s, t) => s + (t.differing || 0), 0) + (exportsDiff.length ? 1 : 0);
  const report = {
    tool: 'rung5a dispatch replay',
    args: { old: path.resolve(oldArg), new: path.resolve(newArg), n: N, seed: SEED, now: NOW, tiers: [...TIERS], only: ONLY },
    sides: Object.fromEntries(Object.entries(sides).map(([k, s]) => [k, { srcLib: s.srcLib, files: Object.fromEntries(Object.entries(s.files).map(([f, x]) => [f, { src: x.src, sha: x.sha }])) }])),
    hermetic: { env, now: NOW, networkAttempts: networkAttempts.length, networkSample: networkAttempts.slice(0, 5) },
    importCensus: census,
    totals: { inputs: selected.length + (testTier?.byTier?.inputs || 0), differing, byTier, elapsedMs, exportsDiff: exportsDiff.length, infoOnly: infoEntries.length },
    exportsDiff, exportsInfo,
    groups,
    infoGroups: infoGroups.slice(0, 40),
    differingInputs: differingIds.slice(0, 500),
    floor,
    testTier: testTier ? testTier.summary : null,
    coverage,
    ...(onlyDetail ? { onlyDetail } : {})
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  fs.rmSync(runDir, { recursive: true, force: true });

  if (!quiet) {
    console.log(`inputs ${report.totals.inputs}  differing ${differing}  groups ${groups.length}  info(key-order) ${infoEntries.length}  exportsDiff ${exportsDiff.length}  (${(elapsedMs / 1000).toFixed(1)}s in-process)`);
    for (const [t, v] of Object.entries(byTier)) console.log(`  ${t.padEnd(7)} inputs ${v.inputs}  calls ${v.calls ?? '-'}  differing ${v.differing}`);
    for (const g of groups.slice(0, 25)) console.log(`  [${g.count}] ${g.sig}\n        e.g. ${g.example.input}: ${String(g.example.old).slice(0, 110)}  =>  ${String(g.example.new).slice(0, 110)}`);
    if (coverage) for (const f of ['dispatch-factory.js', 'dispatch-validation.js']) console.log(`  coverage old ${f}: ${coverage.old[f].linesCovered}/${coverage.old[f].linesTotal} lines (${coverage.old[f].pct}%), blocks ${coverage.old[f].blocksHit}/${coverage.old[f].blocksTotal}`);
    console.log(`report: ${OUT}`);
  }
  return differing ? 1 : 0;
}

function brief(x) { const s = JSON.stringify(x); return s && s.length > 80 ? s.slice(0, 77) + '...' : s; }
function summarize(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)?.slice(0, 60);
  if (v.$ === 'obj') return `{${Object.keys(v.o).slice(0, 4).join(',')}${Object.keys(v.o).length > 4 ? ',…' : ''}}`;
  return v.$ || 'json';
}
function trimSpec(inp) {
  const s = JSON.stringify({ calls: inp.calls, env: inp.env, shared: inp.shared, meta: inp.meta });
  return s.length > 1500 ? s.slice(0, 1500) + '…' : JSON.parse(s);
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error('replay failed:', err?.stack || err); process.exitCode = 2; });
