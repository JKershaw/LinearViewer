// Generic replay driver (one per target: the target's replay.mjs calls
// `runReplay(cfg)`). Lays out the old/new sides, runs the test tier (live,
// per side, in child processes) and the in-process edge/gen tiers (worker
// threads, fresh module instance per scenario per side), aggregates diffs
// into groups, the per-side findings (privacy), the export-surface diff, and
// optional V8 coverage of each side's files. From rung5d/replay/replay.mjs.
//
//   node replay.mjs --old <dir|file> --new <dir|file> [--n 3000] [--seed 1] [--out f]
//        [--coverage] [--jobs 4] [--tiers test,edge,gen] [--only gen:12] [--detail]
//        [--rediscover-tests] [--quiet] [--now ISO]
// Exit: 0 identical, 1 differences (or export-surface diff, or a new-side
// finding such as a privacy leak), 2 tool failure.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { layoutSide } from './sides.mjs';
import { DEFAULT_NOW } from './hermetic.mjs';

const KIT = path.dirname(new URL(import.meta.url).pathname);

export function parseArgs(argv, cfg) {
  const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i === -1 ? def : argv[i + 1]; };
  const has = (name) => argv.includes(`--${name}`);
  return {
    old: flag('old', cfg.pinnedDir),
    new: flag('new', null),
    n: Number(flag('n', '3000')),
    seed: Number(flag('seed', '1')),
    out: flag('out', path.join(cfg.here, 'work', 'report.json')),
    coverage: has('coverage'),
    jobs: Number(flag('jobs', String(Math.min(4, os.cpus().length)))),
    tiers: flag('tiers', 'test,edge,gen').split(','),
    only: flag('only', null),
    detail: has('detail'),
    rediscover: has('rediscover-tests'),
    quiet: has('quiet'),
    now: flag('now', cfg.defaultNow || DEFAULT_NOW),
  };
}

export async function runReplay(cfg, argv = process.argv.slice(2)) {
  const opts = parseArgs(argv, cfg);
  const log = (...a) => { if (!opts.quiet) console.error(...a); };
  try {
    if (!opts.new) throw new Error('--new <dirOrFile> is required (use --new <pinned dir> for an identity run)');
    const workDir = path.join(cfg.here, 'work', `run-${process.pid}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    const repoLib = path.join(cfg.snapshotDir, 'lib');
    const sides = [layoutSide('old', opts.old, workDir, { main: cfg.main, repoLib }), layoutSide('new', opts.new, workDir, { main: cfg.main, repoLib })];
    for (const s of sides) log(`${s.label}: ${s.main} (${s.files.length} side file(s): ${s.files.map(f => path.basename(f.src)).join(', ')})`);
    const targetUrl = pathToFileURL(cfg.targetFile).href;
    const target = await import(targetUrl);
    const t0 = Date.now();
    const results = [];
    let testSummary = null;

    // Test tier: live per side.
    if (opts.tiers.includes('test') && !opts.only) {
      const { runTestTier } = await import('./test-live.mjs');
      const tt = await runTestTier({ sides, runDir: workDir, jobs: opts.jobs, now: opts.now, seed: opts.seed, rediscover: opts.rediscover, log,
        cfg: { snapshotDir: cfg.snapshotDir, main: cfg.main, factories: cfg.factories || [], targetUrl, testFilesPath: path.join(cfg.here, 'pinned', 'test-files.json'), excludeTests: cfg.excludeTests || [] } });
      results.push(...tt.items);
      testSummary = tt.summary;
      log(`  test tier: ${tt.items.filter(i => !i.fileLevel).length} calls from ${tt.summary.files} files (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }

    // In-process tiers.
    const items = [];
    if (opts.tiers.includes('edge')) target.edgeCases().forEach((_, i) => items.push({ tier: 'edge', index: i }));
    if (opts.tiers.includes('gen')) for (let i = 0; i < opts.n; i++) items.push({ tier: 'gen', index: i });
    let selected = items;
    if (opts.only) {
      const [t, idx] = opts.only.split(':');
      selected = items.filter(it => it.tier === t && String(it.index) === idx);
      if (!selected.length && t === 'gen') selected = [{ tier: 'gen', index: Number(idx) }];
    }
    const coverageFiles = sides.flatMap(s => s.files.map(f => [f.url, fs.readFileSync(f.dest, 'utf8').length]));
    const jobs = Math.max(1, Math.min(opts.jobs, Math.ceil(selected.length / 50)));
    const CHUNK = cfg.chunk || 250;
    const chunks = [];
    for (let i = 0; i < selected.length; i += CHUNK) chunks.push(selected.slice(i, i + CHUNK));
    const covAcc = new Map();
    const netAttempts = [];
    let done = 0;
    const { mergeAcc, deserializeAcc, lineCoverage } = await import('./coverage.mjs');
    const runChunk = (chunk) => new Promise((resolve, reject) => {
      const w = new Worker(path.join(KIT, 'worker.mjs'), {
        workerData: { targetUrl, sides: sides.map(s => ({ label: s.label, mainUrl: s.mainUrl, workRootUrl: s.workRootUrl })), items: chunk, seed: opts.seed, now: opts.now, coverage: opts.coverage, coverageFiles, detail: opts.detail },
        resourceLimits: { maxOldGenerationSizeMb: 3072 },
        env: { ...process.env, TZ: 'UTC' },
        stdout: true, stderr: true,
      });
      let errText = '';
      w.stderr.on('data', d => { errText += d; });
      w.stdout.on('data', d => { errText += d; });
      w.on('message', (m) => {
        results.push(...m.results);
        netAttempts.push(...m.networkAttempts);
        if (m.coverage) for (const [tier, acc] of m.coverage) {
          if (!covAcc.has(tier)) covAcc.set(tier, new Map());
          mergeAcc(covAcc.get(tier), deserializeAcc(acc));
        }
        done += chunk.length;
        log(`  ${done}/${selected.length} in-process scenarios (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      });
      w.on('error', (e) => reject(new Error(`worker failed: ${e.stack}\n${errText.slice(-3000)}`)));
      w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exit ${code}\n${errText.slice(-3000)}`))));
    });
    const queue = [...chunks];
    await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await runChunk(queue.shift()); }));

    // Aggregate.
    const order = { test: 0, edge: 1, gen: 2 };
    const num = (id) => Number(String(id).split(/[:#]/).pop()) || 0;
    results.sort((a, b) => (order[a.tier] - order[b.tier]) || String(a.family || '').localeCompare(String(b.family || '')) || (num(a.id) - num(b.id)) || a.id.localeCompare(b.id));
    const counted = results.filter(r => !r.fileLevel);
    const byTier = {}; const byFamily = {};
    const groups = new Map(); const infoGroups = new Map();
    const fnCensus = {};
    const findingGroups = { old: new Map(), new: new Map() };
    for (const r of results) {
      if (!r.fileLevel) {
        const t = (byTier[r.tier] ||= { inputs: 0, differing: 0 });
        t.inputs++; if (r.diffs.length) t.differing++;
        const fam = `${r.tier}:${r.family || '-'}`;
        const f = (byFamily[fam] ||= { inputs: 0, differing: 0 });
        f.inputs++; if (r.diffs.length) f.differing++;
        for (const s of r.facts) {
          const c = (fnCensus[s.fn] ||= { calls: 0, modes: {} });
          c.calls++; c.modes[s.mode] = (c.modes[s.mode] || 0) + 1;
        }
      } else if (r.diffs.length) (byTier.testFiles ||= { differing: 0 }).differing++;
      const seen = new Set();
      for (const d of r.diffs) {
        if (seen.has(d.sig)) continue; seen.add(d.sig);
        const g = groups.get(d.sig) || { signature: d.sig, kind: d.kind, inputs: 0, byTier: {}, example: { input: r.id, site: r.site || null, ...d } };
        g.inputs++; g.byTier[r.tier] = (g.byTier[r.tier] || 0) + 1;
        groups.set(d.sig, g);
      }
      const seenI = new Set();
      for (const d of r.info) {
        if (seenI.has(d.sig)) continue; seenI.add(d.sig);
        const g = infoGroups.get(d.sig) || { signature: d.sig, kind: d.kind, inputs: 0, example: { input: r.id, ...d } };
        g.inputs++; infoGroups.set(d.sig, g);
      }
      for (const side of ['old', 'new']) {
        const seenF = new Set();
        for (const f of (r.findings?.[side] || [])) {
          if (seenF.has(f.sig)) continue; seenF.add(f.sig);
          const g = findingGroups[side].get(f.sig) || { signature: f.sig, kind: f.kind, inputs: 0, byTier: {}, example: { input: r.id, ...f } };
          g.inputs++; g.byTier[r.tier] = (g.byTier[r.tier] || 0) + 1;
          findingGroups[side].set(f.sig, g);
        }
      }
    }
    const SEVERITY = cfg.topKinds || ['privacy-leak'];
    const rank = (g) => (SEVERITY.includes(g.kind) ? 0 : 1);
    const kinds = {};
    for (const g of groups.values()) kinds[g.kind] = (kinds[g.kind] || 0) + g.inputs;
    const findingsOut = Object.fromEntries(['old', 'new'].map(side => [side, {
      inputs: results.filter(r => (r.findings?.[side] || []).length).length,
      groups: [...findingGroups[side].values()].sort((a, b) => b.inputs - a.inputs),
    }]));
    const exportsDiff = await describeSides(sides, cfg);
    const report = {
      tool: `${cfg.name} behavioural replay`,
      snapshot: { sha: cfg.sha, dir: cfg.snapshotDir },
      old: { spec: sides[0].spec, files: sides[0].files.map(f => ({ src: f.src, sha: f.sha })) },
      new: { spec: sides[1].spec, files: sides[1].files.map(f => ({ src: f.src, sha: f.sha })), rewrites: sides[1].rewrites },
      options: { n: opts.n, seed: opts.seed, now: opts.now, tiers: opts.tiers, only: opts.only },
      totals: { inputs: counted.length, differing: counted.filter(r => r.diffs.length).length + (byTier.testFiles?.differing || 0), withInfoOnly: counted.filter(r => !r.diffs.length && r.info.length).length, byTier, kinds, seconds: +((Date.now() - t0) / 1000).toFixed(1) },
      findings: findingsOut,
      byFamily,
      testTier: testSummary,
      groups: [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.inputs - a.inputs),
      infoGroups: [...infoGroups.values()].sort((a, b) => b.inputs - a.inputs),
      exportsDiff,
      fnCensus,
      networkAttempts: netAttempts,
      differing: results.filter(r => r.diffs.length).slice(0, 300).map(r => ({ id: r.id, family: r.family, site: r.site || null, kinds: [...new Set(r.diffs.map(d => d.kind))] })),
    };
    if (opts.detail) report.detail = results.filter(r => r.detail).slice(0, 5).map(r => r.detail);
    if (opts.coverage) {
      report.coverage = {};
      const all = new Map();
      for (const acc of covAcc.values()) mergeAcc(all, acc);
      for (const s of sides) {
        for (const f of s.files) {
          const key = `${s.label}:${path.basename(f.src)}`;
          const per = {};
          for (const [tier, acc] of covAcc) { const c = lineCoverage(f.dest, acc.get(f.url)); per[tier] = { pct: c.pct, linesCovered: c.linesCovered, linesTotal: c.linesTotal }; }
          report.coverage[key] = { all: lineCoverage(f.dest, all.get(f.url)), byTier: per };
        }
      }
    }
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
    fs.rmSync(workDir, { recursive: true, force: true });
    const T = report.totals;
    log(`inputs ${T.inputs} (${Object.entries(T.byTier).filter(([k]) => k !== 'testFiles').map(([k, v]) => `${k} ${v.inputs}`).join(', ')}), differing ${T.differing}, info-only ${T.withInfoOnly}, groups ${report.groups.length}, exports diff ${exportsDiff.differences.length}, network attempts ${netAttempts.length}, ${T.seconds}s`);
    for (const side of ['old', 'new']) if (findingsOut[side].inputs) log(`  !! ${side} side findings on ${findingsOut[side].inputs} inputs: ${findingsOut[side].groups.slice(0, 4).map(g => `${g.inputs}× ${g.signature}`).join(' | ')}`);
    for (const g of report.groups.slice(0, 15)) log(`  ${String(g.inputs).padStart(5)}  ${g.signature}`);
    if (report.coverage) for (const [k, c] of Object.entries(report.coverage)) log(`  coverage ${k}: ${c.all.linesCovered}/${c.all.linesTotal} lines (${c.all.pct}%), blocks ${c.all.blocksHit}/${c.all.blocksTotal}`);
    log(`report: ${path.resolve(opts.out)}`);
    process.exitCode = T.differing || exportsDiff.differences.length || findingsOut.new.inputs ? 1 : 0;
    return report;
  } catch (e) {
    console.error(e.stack || e);
    process.exitCode = 2;
    return null;
  }
}

async function describeSides(sides, cfg) {
  // In a worker so this process never imports side code with a live clock.
  const code = `
    import { workerData, parentPort } from 'node:worker_threads';
    import { register } from 'node:module';
    const h = await import(${JSON.stringify(pathToFileURL(path.join(KIT, 'hermetic.mjs')).href)});
    h.pinEnv(); h.installNetworkGuard(); h.freezeClock();
    register(${JSON.stringify(pathToFileURL(path.join(KIT, 'hooks.mjs')).href)}, { data: { roots: workerData.roots } });
    const { describeExports } = await import(${JSON.stringify(pathToFileURL(path.join(KIT, 'runner.mjs')).href)});
    const out = {};
    for (const s of workerData.sides) out[s.label] = describeExports(await import(s.mainUrl + '?inst=exports-' + s.label));
    parentPort.postMessage(out);`;
  const out = await new Promise((resolve, reject) => {
    const w = new Worker(code, { eval: true, workerData: { sides: sides.map(s => ({ label: s.label, mainUrl: s.mainUrl })), roots: sides.map(s => s.workRootUrl) }, env: { ...process.env, TZ: 'UTC' } });
    w.on('message', resolve); w.on('error', reject);
  });
  const keys = [...new Set([...Object.keys(out.old), ...Object.keys(out.new)])].sort();
  const differences = keys.filter(k => out.old[k] !== out.new[k]).map(k => ({ name: k, old: out.old[k] ?? '(absent)', new: out.new[k] ?? '(absent)' }));
  void cfg;
  return { old: out.old, differences };
}
