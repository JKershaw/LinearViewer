#!/usr/bin/env node
// Behavioural replay for Harbour's lib/render-roadmap.js.
//
//   node replay.mjs <oldRendererFile> <newRendererFile> [--n 3000] [--seed 1]
//        [--out report.json] [--now ISO] [--coverage] [--norm collapse|between-tags]
//        [--old-lib DIR] [--new-lib DIR] [--model-lib DIR] [--recapture]
//        [--dump ID] [--max-examples 5] [--quiet]
//
// See README.md. Exit code: 0 all identical, 1 differences found, 2 tool error.

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import util from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_NOW, pinEnv, installNetworkGuard, networkAttempts, freezeClock, restoreClock,
  seedMathRandom, restoreMathRandom
} from './lib/hermetic.mjs';
import { prepareRenderer, importRenderer, DEFAULT_LIB } from './lib/load.mjs';
import { loadCapture } from './lib/capture.mjs';
import { capturedInputs, mockDataInputs, edgeInputs } from './lib/fixtures.mjs';
import { Rng, caseSeed, makeGenA, makeGenB, targetedCases } from './lib/generate.mjs';
import { normalizeHtml, comparePair } from './lib/compare.mjs';
import * as cov from './lib/coverage.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);

function parseArgs(argv) {
  const a = { n: 3000, seed: 1, out: null, now: DEFAULT_NOW, coverage: false, norm: 'collapse', maxExamples: 5, quiet: false, recapture: false, dump: [] };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--n') a.n = Number(v());
    else if (k === '--seed') a.seed = Number(v());
    else if (k === '--out') a.out = v();
    else if (k === '--now') a.now = v();
    else if (k === '--coverage') a.coverage = true;
    else if (k === '--norm') a.norm = v();
    else if (k === '--old-lib') a.oldLib = v();
    else if (k === '--new-lib') a.newLib = v();
    else if (k === '--model-lib') a.modelLib = v();
    else if (k === '--recapture') a.recapture = true;
    else if (k === '--dump') a.dump.push(v());
    else if (k === '--max-examples') a.maxExamples = Number(v());
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--work') a.work = v();
    else if (k.startsWith('--')) throw new Error(`unknown flag ${k}`);
    else pos.push(k);
  }
  if (pos.length !== 2) throw new Error('usage: node replay.mjs <oldRendererFile> <newRendererFile> [--n 3000] [--seed 1] [--out report.json]');
  [a.oldFile, a.newFile] = pos;
  if (!['collapse', 'between-tags'].includes(a.norm)) throw new Error('--norm must be collapse or between-tags');
  return a;
}

function sideEffectProbe() {
  return {
    globals: new Set(Object.getOwnPropertyNames(globalThis)),
    resources: process.getActiveResourcesInfo().slice(),
    listeners: Object.fromEntries(['exit', 'uncaughtException', 'unhandledRejection', 'SIGTERM', 'SIGINT', 'beforeExit', 'warning'].map(e => [e, process.listenerCount(e)])),
    env: JSON.stringify(process.env),
    net: networkAttempts.length
  };
}
function sideEffectDiff(before, after) {
  const d = {};
  const g = [...after.globals].filter(k => !before.globals.has(k));
  if (g.length) d.newGlobals = g;
  const count = arr => arr.reduce((m, r) => m.set(r, (m.get(r) || 0) + 1), new Map());
  const rb = count(before.resources); const ra = count(after.resources);
  const res = [...ra].filter(([k, n]) => n > (rb.get(k) || 0)).map(([k, n]) => `${k}+${n - (rb.get(k) || 0)}`);
  if (res.length) d.newActiveResources = res;
  const l = Object.entries(after.listeners).filter(([k, n]) => n !== before.listeners[k]).map(([k, n]) => `${k}:${before.listeners[k]}→${n}`);
  if (l.length) d.processListeners = l;
  if (before.env !== after.env) d.envChanged = true;
  if (after.net > before.net) d.networkAttempts = networkAttempts.slice(before.net);
  return d;
}

function render(mod, payload, seed) {
  const { data, options, argc } = v8.deserialize(payload); // fresh copy per version
  seedMathRandom(seed);
  try {
    const html = argc === 1 || (argc === undefined && options === undefined)
      ? mod.renderRoadmapPage(data)
      : mod.renderRoadmapPage(data, options);
    if (typeof html !== 'string') return { threw: true, error: { name: 'NonStringResult', message: `returned ${typeof html}` } };
    return { threw: false, html };
  } catch (e) {
    return { threw: true, error: { name: e?.name || 'Error', message: String(e?.message ?? e), stack: String(e?.stack || '').split('\n').slice(0, 3).join(' | ') } };
  } finally {
    restoreMathRandom();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const log = args.quiet ? () => {} : (...m) => console.log(...m);
  const work = path.resolve(args.work || path.join(HERE, 'work'));
  const oldLib = path.resolve(args.oldLib || DEFAULT_LIB);
  const newLib = path.resolve(args.newLib || DEFAULT_LIB);
  const modelLib = path.resolve(args.modelLib || DEFAULT_LIB);

  const envPinned = pinEnv();
  installNetworkGuard();
  if (args.coverage) await cov.startCoverage();
  const nowMs = freezeClock(args.now);

  let report;
  try {
    // --- renderer copies + import-time side effects --------------------------
    const prepOld = prepareRenderer(args.oldFile, { label: 'old', workDir: path.join(work, 'copies'), libDir: oldLib });
    const prepNew = prepareRenderer(args.newFile, { label: 'new', workDir: path.join(work, 'copies'), libDir: newLib });
    const p0 = sideEffectProbe();
    const oldMod = await importRenderer(prepOld);
    const p1 = sideEffectProbe();
    const newMod = await importRenderer(prepNew);
    const p2 = sideEffectProbe();
    const importSideEffects = { old: sideEffectDiff(p0, p1), new: sideEffectDiff(p1, p2) };

    // --- shared deps (imported under the frozen clock: mock-data computes
    //     its daysAgo() dates at module evaluation) -------------------------
    const L = (lib, f) => import(pathToFileURL(path.join(lib, f)).href);
    const [{ buildRoadmapModel }, { AVAILABLE_MODELS }, { FEATURE_DEFAULTS, FEATURE_KEYS }, { testMockData, testMockTeams }] = await Promise.all([
      L(modelLib, 'roadmap.js'), L(DEFAULT_LIB, 'openrouter.js'), L(DEFAULT_LIB, 'feature-defaults.js'), L(DEFAULT_LIB, 'sample-data/mock-data.js')
    ]);
    const deps = { buildRoadmapModel, AVAILABLE_MODELS, FEATURE_DEFAULTS, FEATURE_KEYS, testMockData, testMockTeams };

    // --- inputs ---------------------------------------------------------------
    const capture = loadCapture({ workDir: work, now: args.now, lib: DEFAULT_LIB, recapture: args.recapture, log });
    const fixtureInputs = [
      ...capturedInputs(capture),
      ...mockDataInputs(deps),
      ...edgeInputs(),
      ...targetedCases(nowMs, deps).map(c => ({ ...c, tier: 'target' }))
    ];
    const nA = Math.ceil(args.n * 0.6);
    const nB = args.n - nA;

    const results = { inputs: 0, identical: 0, identicalBothThrew: 0, differing: 0, throwsOld: 0, throwsNew: 0, byTier: {} };
    const groups = new Map();
    const coarse = new Map();
    const differing = [];
    const throws = [];
    const dumpSet = new Set(args.dump);

    const runOne = (input) => {
      const tier = input.tier;
      const bt = (results.byTier[tier] ||= { inputs: 0, identical: 0, differing: 0 });
      results.inputs++; bt.inputs++;
      if (input.error) { throws.push({ id: input.id, buildError: input.error }); return; }
      const payload = v8.serialize({ data: input.data, options: input.options, argc: input.argc });
      const seed = caseSeed(args.seed, 'render', results.inputs);
      const ro = render(oldMod, payload, seed);
      const rn = render(newMod, payload, seed);
      if (ro.threw) results.throwsOld++;
      if (rn.threw) results.throwsNew++;
      if (ro.threw || rn.threw) throws.push({ id: input.id, old: ro.threw ? `${ro.error.name}: ${ro.error.message}` : null, new: rn.threw ? `${rn.error.name}: ${rn.error.message}` : null, oldStack: ro.error?.stack, newStack: rn.error?.stack });
      const c = comparePair(ro, rn, args.norm);
      if (dumpSet.has(input.id)) dump(work, input, ro, rn, args.norm);
      if (c.equal) { results.identical++; bt.identical++; if (c.bothThrew) results.identicalBothThrew++; return; }
      results.differing++; bt.differing++;
      differing.push({ id: input.id, signature: c.signature, kind: c.kind, jsonSignature: c.json?.signature ?? null, meta: input.meta });
      const ck = c.coarseSignature || c.signature;
      const cg = coarse.get(ck) || { coarseSignature: ck, count: 0, signatures: new Set(), example: input.id };
      cg.count++; cg.signatures.add(c.signature); coarse.set(ck, cg);
      let g = groups.get(c.signature);
      if (!g) {
        g = { signature: c.signature, count: 0, tiers: {}, examples: [], example: { id: input.id, kind: c.kind, html: c.html, json: c.json, throw: c.kind === 'throw' ? { old: c.old, new: c.new } : undefined } };
        groups.set(c.signature, g);
      }
      g.count++;
      g.tiers[tier] = (g.tiers[tier] || 0) + 1;
      if (g.examples.length < args.maxExamples) g.examples.push(input.id);
    };

    const genErr = (id, tier, e) => ({ id, tier, error: `generator/model threw: ${e.message}` });
    const covUrls = [prepOld.url, prepNew.url];
    const covPhases = [];
    for (const inp of fixtureInputs.filter(i => i.tier === 'test' || i.tier === 'mock')) runOne(inp);
    if (args.coverage) covPhases.push(await cov.snapshot(covUrls));
    for (const inp of fixtureInputs.filter(i => i.tier !== 'test' && i.tier !== 'mock')) runOne(inp);
    if (args.coverage) covPhases.push(await cov.snapshot(covUrls));
    for (let i = 0; i < nA; i++) {
      const id = `gen-a:${i}`;
      let inp;
      try { inp = { id, tier: 'gen-a', ...makeGenA(new Rng(caseSeed(args.seed, 'a', i)), nowMs, deps) }; } catch (e) { inp = genErr(id, 'gen-a', e); }
      runOne(inp);
    }
    for (let i = 0; i < nB; i++) {
      const id = `gen-b:${i}`;
      let inp;
      try { inp = { id, tier: 'gen-b', ...makeGenB(new Rng(caseSeed(args.seed, 'b', i)), nowMs, deps) }; } catch (e) { inp = genErr(id, 'gen-b', e); }
      runOne(inp);
    }
    if (args.coverage) { covPhases.push(await cov.snapshot(covUrls)); await cov.stopCoverage(); }

    let coverage = null;
    if (args.coverage) {
      coverage = {};
      for (const [label, prep] of [['old', prepOld], ['new', prepNew]]) {
        coverage[label] = {
          file: prep.src,
          copy: prep.dest,
          existingTestsAndMockOnly: summarizeCov(cov.lineCoverage(prep.dest, [covPhases[0][prep.url]])),
          fixturesOnly: summarizeCov(cov.lineCoverage(prep.dest, [covPhases[0][prep.url], covPhases[1][prep.url]])),
          all: cov.lineCoverage(prep.dest, covPhases.map(p => p[prep.url]))
        };
      }
    }

    const groupList = [...groups.values()].sort((a, b) => b.count - a.count);
    report = {
      meta: {
        generatedAt: null, // filled after the clock is restored
        tool: path.join(HERE, 'replay.mjs'),
        node: process.version,
        old: { file: prepOld.src, copy: prepOld.dest, sha: prepOld.hash, lib: prepOld.libDir, rewrittenImports: prepOld.rewritten.length },
        new: { file: prepNew.src, copy: prepNew.dest, sha: prepNew.hash, lib: prepNew.libDir, rewrittenImports: prepNew.rewritten.length },
        modelLib, frozenNow: new Date(nowMs).toISOString(), seed: args.seed, n: args.n, genA: nA, genB: nB,
        normalisation: args.norm, envPinned,
        capture: { pin: capture.pin, files: capture.files.map(f => ({ file: f.file, calls: f.records.length, testsPass: f.testsPass, testsFail: f.testsFail, exit: f.exit })) },
        importSideEffects,
        importSideEffectNotes: [
          'lib/providers/*/index.js call registerProvider() at import (navbar reads the registry); the copies import the same absolute modules, so both versions share one registry instance unless --old-lib/--new-lib differ.',
          'lib/sample-data/mock-data.js computes its daysAgo() dates at module evaluation, so it is imported only after the clock is frozen.',
          'lib/components/page.js / openrouter.js / navbar.js have no timers or sockets at import (probe above); the network tripwire counts any attempt.'
        ],
        networkAttemptsTotal: networkAttempts.length
      },
      totals: results,
      groups: groupList,
      coarseGroups: [...coarse.values()].sort((a, b) => b.count - a.count).map(g => ({ ...g, signatures: g.signatures.size })),
      differing,
      throws,
      coverage
    };
  } finally {
    restoreClock();
  }
  report.meta.generatedAt = new Date().toISOString();
  report.meta.elapsedMs = Date.now() - t0;

  const outPath = path.resolve(args.out || path.join(work, 'report.json'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  printSummary(report, outPath, log);
  process.exitCode = report.totals.differing > 0 ? 1 : 0;
}

function summarizeCov(c) { return { linesTotal: c.linesTotal, linesCovered: c.linesCovered, pct: c.pct, blocksHit: c.blocksHit, blocksTotal: c.blocksTotal, uncoveredLines: c.uncoveredLines.map(u => u.line), unhitBlocks: c.unhitBlocks.map(b => `L${b.line}: ${b.code}`) }; }

function dump(work, input, ro, rn, norm) {
  const dir = path.join(work, 'dump', input.id.replace(/[^a-zA-Z0-9._-]+/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'input.txt'), util.inspect({ data: input.data, options: input.options, argc: input.argc }, { depth: null, maxArrayLength: null, maxStringLength: null }));
  for (const [k, r] of [['old', ro], ['new', rn]]) {
    if (r.threw) fs.writeFileSync(path.join(dir, `${k}.error.txt`), `${r.error.name}: ${r.error.message}\n${r.error.stack || ''}`);
    else { fs.writeFileSync(path.join(dir, `${k}.html`), r.html); fs.writeFileSync(path.join(dir, `${k}.norm.html`), normalizeHtml(r.html, norm)); }
  }
}

function printSummary(r, outPath, log) {
  const t = r.totals;
  log('');
  log(`roadmap replay  old=${r.meta.old.file} (${r.meta.old.sha})  new=${r.meta.new.file} (${r.meta.new.sha})`);
  log(`clock=${r.meta.frozenNow}  seed=${r.meta.seed}  n=${r.meta.n}  norm=${r.meta.normalisation}  ${r.meta.elapsedMs} ms`);
  log(`inputs ${t.inputs}  identical ${t.identical}${t.identicalBothThrew ? ` (${t.identicalBothThrew} both threw identically)` : ''}  differing ${t.differing}  throws old ${t.throwsOld} / new ${t.throwsNew}`);
  log('by tier: ' + Object.entries(t.byTier).map(([k, v]) => `${k} ${v.inputs}/${v.differing} diff`).join(', '));
  for (const [k, v] of Object.entries(r.meta.importSideEffects)) if (Object.keys(v).length) log(`import side effects (${k}): ${JSON.stringify(v)}`);
  if (r.meta.networkAttemptsTotal) log(`!! network attempts blocked: ${r.meta.networkAttemptsTotal}`);
  if (r.groups.length) {
    log(`\n${r.groups.length} difference group(s) (${r.coarseGroups.length} by old-side context only):`);
    for (const g of r.groups.slice(0, 25)) {
      log(`  [${g.count}] ${g.signature}`);
      log(`       tiers ${JSON.stringify(g.tiers)}  e.g. ${g.example.id}`);
      if (g.example.html) {
        log(`       old: ${g.example.html.before.replace(/\n/g, '\\n')}`);
        log(`       new: ${g.example.html.after.replace(/\n/g, '\\n')}`);
      }
      if (g.example.json) log(`       json: ${g.example.json.signature}  old=${g.example.json.old} new=${g.example.json.new}`);
      if (g.example.throw) log(`       throw: old=${g.example.throw.old} new=${g.example.throw.new}`);
    }
    if (r.groups.length > 25) log(`  ... ${r.groups.length - 25} more in the report`);
  }
  if (r.coverage) {
    for (const [k, c] of Object.entries(r.coverage)) {
      log(`\ncoverage (${k} copy): lines ${c.all.linesCovered}/${c.all.linesTotal} = ${c.all.pct}%  blocks ${c.all.blocksHit}/${c.all.blocksTotal}  [existing tests+mock only: ${c.existingTestsAndMockOnly.pct}% lines, ${c.existingTestsAndMockOnly.blocksHit} blocks; all fixtures: ${c.fixturesOnly.pct}%]`);
      if (c.all.uncoveredLines.length) log('  uncovered lines: ' + c.all.uncoveredLines.map(u => `${u.line}: ${u.text}`).join('\n                   '));
      if (c.all.unhitBlocks.length) log('  never-executed blocks: ' + c.all.unhitBlocks.map(b => `L${b.line}${b.endLine !== b.line ? '-' + b.endLine : ''}: ${b.code}`).join('\n                         '));
    }
  }
  log(`\nreport: ${outPath}`);
}

main().catch(e => { console.error(e?.stack || e); process.exitCode = 2; });
