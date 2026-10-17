#!/usr/bin/env node
// Behavioural replay for lib/pipeline-loops.js: run identical scenarios
// through an OLD and a NEW version and report every outsider-visible
// difference. See README.md.
//
//   node replay.mjs --old pinned/origin-main --new <dirOrFile> [--n 3000] [--seed 1]
//        [--out report.json] [--coverage] [--jobs 4] [--tiers test,edge,gen]
//        [--only <id>] [--recapture] [--quiet] [--now ISO]
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { layoutSide } from './lib/prepare.mjs';
import { DEFAULT_NOW } from './lib/hermetic.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i === -1 ? def : argv[i + 1]; };
const has = (name) => argv.includes(`--${name}`);
const opts = {
  old: flag('old', path.join(HERE, 'pinned/origin-main')),
  new: flag('new', null),
  n: Number(flag('n', '3000')),
  seed: Number(flag('seed', '1')),
  out: flag('out', path.join(HERE, 'work', 'report.json')),
  coverage: has('coverage'),
  jobs: Number(flag('jobs', String(Math.min(4, os.cpus().length)))),
  tiers: flag('tiers', 'test,edge,gen').split(','),
  only: flag('only', null),
  recapture: has('recapture'),
  quiet: has('quiet'),
  now: flag('now', DEFAULT_NOW),
};
const log = (...a) => { if (!opts.quiet) console.error(...a); };

async function main() {
  if (!opts.new) throw new Error('--new <dirOrFile> is required (use --new pinned/origin-main for an identity run)');
  if (process.env.TZ !== 'UTC') log('note: TZ is not UTC in the parent; workers pin TZ=UTC themselves');
  const workDir = path.join(HERE, 'work', `run-${process.pid}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  const sides = [layoutSide('old', opts.old, workDir), layoutSide('new', opts.new, workDir)];
  for (const s of sides) log(`${s.label}: ${s.main} (${s.files.length} side file(s): ${s.files.map(f => path.basename(f.src)).join(', ')})`);

  // Inputs.
  const items = [];
  let capture = null;
  const capturePath = path.join(HERE, 'work', `captured-${opts.now.replace(/[:.]/g, '')}.v8`);
  if (opts.tiers.includes('test')) {
    const { loadCapture } = await import('./lib/capture.mjs');
    capture = await loadCapture({ capturePath, now: opts.now, recapture: opts.recapture, log });
    capture.scenarios.forEach((_, i) => items.push({ tier: 'test', index: i }));
  }
  if (opts.tiers.includes('edge')) {
    const { edgeCases } = await import('./lib/edge.mjs');
    edgeCases().forEach((_, i) => items.push({ tier: 'edge', index: i }));
  }
  if (opts.tiers.includes('gen')) for (let i = 0; i < opts.n; i++) items.push({ tier: 'gen', index: i });
  let selected = items;
  if (opts.only) {
    const [t, idx] = opts.only.split(':');
    selected = items.filter(it => it.tier === t && String(it.index) === idx);
    if (!selected.length && t === 'gen') selected = [{ tier: 'gen', index: Number(idx) }];
  }

  const coverageFiles = sides.flatMap(s => s.files.map(f => [f.url, fs.readFileSync(f.dest, 'utf8').length]));
  const jobs = Math.max(1, Math.min(opts.jobs, Math.ceil(selected.length / 50)));
  const CHUNK = 220; // fresh module instances per worker stay bounded
  const chunks = [];
  for (let i = 0; i < selected.length; i += CHUNK) chunks.push(selected.slice(i, i + CHUNK));
  const t0 = Date.now();
  const results = [];
  const covAcc = new Map();
  const netAttempts = [];
  let done = 0;
  const { mergeAcc, deserializeAcc, lineCoverage } = await import('./lib/coverage.mjs');
  const runChunk = (chunk) => new Promise((resolve, reject) => {
    const w = new Worker(path.join(HERE, 'lib', 'worker.mjs'), {
      workerData: { sides: sides.map(s => ({ label: s.label, mainUrl: s.mainUrl, workRootUrl: s.workRootUrl })), items: chunk, seed: opts.seed, now: opts.now, coverage: opts.coverage, coverageFiles, capturePath: capture ? capturePath : null },
      resourceLimits: { maxOldGenerationSizeMb: 2048 },
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
      log(`  ${done}/${selected.length} scenarios (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    });
    w.on('error', (e) => reject(new Error(`worker failed: ${e.stack}\n${errText.slice(-3000)}`)));
    w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exit ${code}\n${errText.slice(-3000)}`))));
  });
  const queue = [...chunks];
  await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await runChunk(queue.shift()); }));

  // Aggregate.
  const order = { test: 0, edge: 1, gen: 2 };
  results.sort((a, b) => (order[a.tier] - order[b.tier]) || (Number(a.id.split(':').pop()) - Number(b.id.split(':').pop())) || a.id.localeCompare(b.id));
  const byTier = {};
  const byFamily = {};
  const groups = new Map();
  const infoGroups = new Map();
  const fnCensus = {};
  for (const r of results) {
    const t = (byTier[r.tier] ||= { inputs: 0, differing: 0, steps: 0 });
    t.inputs++; t.steps += r.facts.length;
    if (r.diffs.length) t.differing++;
    const fam = r.family || r.tier;
    const f = (byFamily[fam] ||= { inputs: 0, differing: 0 });
    f.inputs++; if (r.diffs.length) f.differing++;
    for (const s of r.facts) {
      const c = (fnCensus[s.fn] ||= { calls: 0, modes: {}, nonEmptyArrays: 0, warnings: 0 });
      c.calls++; c.modes[s.mode] = (c.modes[s.mode] || 0) + 1; if (s.n) c.nonEmptyArrays++; c.warnings += s.warns;
    }
    const seen = new Set();
    for (const d of r.diffs) {
      if (seen.has(d.sig)) continue; seen.add(d.sig);
      const g = groups.get(d.sig) || { signature: d.sig, kind: d.kind, inputs: 0, byTier: {}, example: { input: r.id, site: r.site, ...d } };
      g.inputs++; g.byTier[r.tier] = (g.byTier[r.tier] || 0) + 1;
      groups.set(d.sig, g);
    }
    const seenI = new Set();
    for (const d of r.info) {
      if (seenI.has(d.sig)) continue; seenI.add(d.sig);
      const g = infoGroups.get(d.sig) || { signature: d.sig, kind: d.kind, inputs: 0, example: { input: r.id, ...d } };
      g.inputs++; infoGroups.set(d.sig, g);
    }
  }
  const fidelity = {};
  const fidelityExamples = [];
  for (const r of results) if (r.fidelity) { fidelity[r.fidelity] = (fidelity[r.fidelity] || 0) + 1; if (r.fidelity !== 'same' && fidelityExamples.length < 20) fidelityExamples.push({ id: r.id, site: r.site, fidelity: r.fidelity }); }
  const kinds = {};
  for (const g of groups.values()) kinds[g.kind] = (kinds[g.kind] || 0) + g.inputs;
  const report = {
    tool: 'pipeline-loops behavioural replay (rung5d)',
    old: { spec: sides[0].spec, files: sides[0].files.map(f => ({ src: f.src, sha: f.sha })) },
    new: { spec: sides[1].spec, files: sides[1].files.map(f => ({ src: f.src, sha: f.sha })), rewrites: sides[1].rewrites },
    options: { n: opts.n, seed: opts.seed, now: opts.now, tiers: opts.tiers, only: opts.only },
    totals: { inputs: results.length, differing: results.filter(r => r.diffs.length).length, withInfoOnly: results.filter(r => !r.diffs.length && r.info.length).length, byTier, kinds, seconds: +((Date.now() - t0) / 1000).toFixed(1) },
    byFamily,
    capture: capture ? { ...capture.summary, fidelity, fidelityExamples } : null,
    groups: [...groups.values()].sort((a, b) => b.inputs - a.inputs),
    infoGroups: [...infoGroups.values()].sort((a, b) => b.inputs - a.inputs),
    exportsDiff: null,
    fnCensus,
    networkAttempts: netAttempts,
    differing: results.filter(r => r.diffs.length).slice(0, 300).map(r => ({ id: r.id, family: r.family, site: r.site, kinds: [...new Set(r.diffs.map(d => d.kind))] })),
  };
  // Export surface diff (names, kinds, arity, constants, re-export identity).
  const { describe } = await import('./lib/exports.mjs');
  report.exportsDiff = await describe(sides);
  if (opts.coverage) {
    report.coverage = {};
    for (const s of sides) {
      for (const f of s.files) {
        const key = `${s.label}:${path.basename(f.src)}`;
        const all = new Map();
        for (const acc of covAcc.values()) mergeAcc(all, acc);
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
  log(`inputs ${T.inputs} (${Object.entries(T.byTier).map(([k, v]) => `${k} ${v.inputs}`).join(', ')}), differing ${T.differing}, info-only ${T.withInfoOnly}, groups ${report.groups.length}, exports diff ${report.exportsDiff.differences.length}, network attempts ${netAttempts.length}, ${T.seconds}s`);
  for (const g of report.groups.slice(0, 15)) log(`  ${String(g.inputs).padStart(5)}  ${g.signature}`);
  if (report.coverage) for (const [k, c] of Object.entries(report.coverage)) log(`  coverage ${k}: ${c.all.linesCovered}/${c.all.linesTotal} lines (${c.all.pct}%), blocks ${c.all.blocksHit}/${c.all.blocksTotal}`);
  log(`report: ${path.resolve(opts.out)}`);
  process.exitCode = T.differing || report.exportsDiff.differences.length ? 1 : 0;
}

main().catch((e) => { console.error(e.stack || e); process.exitCode = 2; });
