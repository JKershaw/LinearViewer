#!/usr/bin/env node
// Behavioural replay for Harbour's page-renderer cluster:
//   lib/render.js, lib/render-session.js, lib/render-swipe.js, lib/render-settings.js
//
//   node replay.mjs --old <dir|files> --new <dir|files> [--n 3000] [--seed 1] [--out report.json]
//        [--coverage] [--now ISO] [--only render,session,swipe,settings]
//        [--old-lib DIR] [--new-lib DIR] [--prefer-side] [--descriptions file.json]
//        [--recapture] [--no-capture] [--dump ID] [--max-examples 3] [--inventory] [--quiet]
//
// See README.md. Exit: 0 all identical, 1 differences found, 2 tool error.

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import util from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_NOW, pinEnv, installEnvRecorder, setEnvBucket, withEnv, installNetworkGuard, networkAttempts,
  freezeClock, restoreClock, seedMathRandom, restoreMathRandom
} from './lib/hermetic.mjs';
import { prepareSide, importSide, DEFAULT_LIB, REPO, TARGETS } from './lib/load.mjs';
import { SURFACE, MODULE_FILES, surfaceDiff } from './lib/targets.mjs';
import { toTransport, revive } from './lib/encode.mjs';
import { compareHtml, compareData, collapseWs } from './lib/compare.mjs';
import { parseHtml, normalizeTree } from './lib/html.mjs';
import { buildConsumerIndex, makeContract, Inventory } from './lib/contract.mjs';
import { Rng, caseSeed } from './lib/gen-common.mjs';
import { worldTrees } from './lib/gen-world.mjs';
import { renderPageCase, renderDetailsCase, smallRenderCase } from './lib/gen-render.mjs';
import { renderSwipeCase, swipePureCase } from './lib/gen-swipe.mjs';
import { sessionCase } from './lib/gen-session.mjs';
import { settingsCase } from './lib/gen-settings.mjs';
import { capturedInputs, sampleInputs, edgeInputs } from './lib/fixtures.mjs';
import { descriptionInputs } from './lib/descriptions.mjs';
import * as cov from './lib/coverage.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);

function parseArgs(argv) {
  const a = { n: 3000, seed: 1, now: DEFAULT_NOW, coverage: false, maxExamples: 3, quiet: false, recapture: false, capture: true, dump: [], only: null, preferSide: false, inventory: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--old') a.old = v();
    else if (k === '--new') a.new = v();
    else if (k === '--n') a.n = Number(v());
    else if (k === '--seed') a.seed = Number(v());
    else if (k === '--out') a.out = v();
    else if (k === '--now') a.now = v();
    else if (k === '--coverage') a.coverage = true;
    else if (k === '--only') a.only = v().split(',').map(s => s.trim());
    else if (k === '--old-lib') a.oldLib = v();
    else if (k === '--new-lib') a.newLib = v();
    else if (k === '--prefer-side') a.preferSide = true;
    else if (k === '--descriptions') a.descriptions = v();
    else if (k === '--recapture') a.recapture = true;
    else if (k === '--no-capture') a.capture = false;
    else if (k === '--dump') a.dump.push(v());
    else if (k === '--max-examples') a.maxExamples = Number(v());
    else if (k === '--inventory') a.inventory = true;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--work') a.work = v();
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.old || !a.new) throw new Error('usage: node replay.mjs --old <dir|files> --new <dir|files> [--n 3000] [--seed 1] [--out report.json] [--coverage]');
  if (a.only) for (const m of a.only) if (!TARGETS[m]) throw new Error(`--only: unknown module ${m} (render, session, swipe, settings)`);
  if (!Number.isFinite(a.n) || a.n < 0) throw new Error('--n must be a number');
  return a;
}

// ---------------------------------------------------------------------------
// Import-time side-effect probe
// ---------------------------------------------------------------------------
function probe() {
  return {
    globals: new Set(Object.getOwnPropertyNames(globalThis)),
    resources: process.getActiveResourcesInfo().slice(),
    listeners: Object.fromEntries(['exit', 'uncaughtException', 'unhandledRejection', 'SIGTERM', 'SIGINT', 'beforeExit', 'warning'].map(e => [e, process.listenerCount(e)])),
    net: networkAttempts.length
  };
}
function probeDiff(b, a, envReads) {
  const d = {};
  const g = [...a.globals].filter(k => !b.globals.has(k));
  if (g.length) d.newGlobals = g;
  const count = arr => arr.reduce((m, r) => m.set(r, (m.get(r) || 0) + 1), new Map());
  const rb = count(b.resources); const ra = count(a.resources);
  const res = [...ra].filter(([k, n]) => n > (rb.get(k) || 0)).map(([k, n]) => `${k}+${n - (rb.get(k) || 0)}`);
  if (res.length) d.newActiveResources = res;
  const l = Object.entries(a.listeners).filter(([k, n]) => n !== b.listeners[k]).map(([k, n]) => `${k}:${b.listeners[k]}→${n}`);
  if (l.length) d.processListeners = l;
  if (a.net > b.net) d.networkAttempts = networkAttempts.slice(b.net);
  const er = [...envReads].filter(k => k !== 'WATCH_REPORT_DEPENDENCIES').sort(); if (er.length) d.envReadsAtImport = er;
  return d;
}

// ---------------------------------------------------------------------------
// One call on one side
// ---------------------------------------------------------------------------
function callSide(mods, input, payload, seed, getProvider, envSet) {
  const kind = SURFACE[input.module][input.export];
  const mod = mods[input.module];
  const args = revive(v8.deserialize(payload), getProvider);
  if (!mod || !(input.export in mod)) return { threw: true, error: { name: 'MissingExport', message: `${MODULE_FILES[input.module]} has no export ${input.export}` } };
  const fn = mod[input.export];
  if (kind === 'const') return { threw: false, value: toTransport(fn), argsAfter: null };
  if (typeof fn !== 'function') return { threw: true, error: { name: 'NotAFunction', message: `${input.export} is ${typeof fn}` } };
  seedMathRandom(seed);
  const prev = setEnvBucket(envSet);
  try {
    const ret = withEnv(input.env, () => fn(...args));
    let value; let retAlias = -1; let elemAlias = null;
    if (kind === 'html' || kind === 'string') value = ret;
    else {
      retAlias = args.findIndex(x => x !== null && typeof x === 'object' && x === ret);
      if (Array.isArray(ret) && Array.isArray(args[0])) elemAlias = ret.map(x => args[0].indexOf(x));
      value = toTransport(ret);
    }
    return { threw: false, value, retAlias, elemAlias, argsAfter: toTransport(args) };
  } catch (e) {
    return { threw: true, error: { name: e?.name || 'Error', message: String(e?.message ?? e).slice(0, 300), stack: String(e?.stack || '').split('\n').slice(1, 3).join(' | ') }, argsAfter: (() => { try { return toTransport(args); } catch { return null; } })() };
  } finally {
    setEnvBucket(prev);
    restoreMathRandom();
  }
}

function compareResults(input, ro, rn, contract) {
  const kind = SURFACE[input.module][input.export];
  if (ro.threw || rn.threw) {
    const so = ro.threw ? `${ro.error.name}: ${ro.error.message}` : null;
    const sn = rn.threw ? `${rn.error.name}: ${rn.error.message}` : null;
    if (so && sn && so === sn) return { equal: true, kind: 'identical', bothThrew: so };
    const strip = s => s && s.replace(/\d+/g, 'N').slice(0, 140);
    return { equal: false, kind: 'throw', subkind: so && sn ? 'both-differently' : so ? 'old-only' : 'new-only', signature: so && sn ? `THROW both: old ${strip(so)} | new ${strip(sn)}` : so ? `THROW old only: ${strip(so)}` : `THROW new only: ${strip(sn)}`, coarse: 'throw', old: so, new: sn };
  }
  let c;
  if ((kind === 'html' || kind === 'string') && typeof ro.value === 'string' && typeof rn.value === 'string') c = compareHtml(ro.value, rn.value, contract);
  else c = compareData({ value: ro.value, retAlias: ro.retAlias, elemAlias: ro.elemAlias }, { value: rn.value, retAlias: rn.retAlias, elemAlias: rn.elemAlias });
  let mut = null;
  if (ro.argsAfter !== null && rn.argsAfter !== null) {
    const m = compareData(ro.argsAfter, rn.argsAfter);
    if (!m.equal) mut = { ...m, signature: m.signature.replace(/^data \$/, 'args $') };
  }
  if (c.equal && !mut) return c;
  if (c.equal && mut) return { equal: false, kind: 'input-mutation', subkind: mut.subkind, signature: mut.signature, coarse: `input-mutation (${mut.subkind})`, path: mut.path, old: mut.old, new: mut.new };
  if (mut) c.inputMutation = mut.signature;
  return c;
}

// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const log = args.quiet ? () => {} : (...m) => console.log(...m);
  const work = path.resolve(args.work || path.join(HERE, 'work'));
  const oldLib = path.resolve(args.oldLib || DEFAULT_LIB);
  const newLib = path.resolve(args.newLib || DEFAULT_LIB);
  const modules = args.only || Object.keys(TARGETS);

  const envPinned = pinEnv();
  installEnvRecorder();
  installNetworkGuard();
  if (args.coverage) await cov.startCoverage();
  const nowMs = freezeClock(args.now);

  let report;
  try {
    // --- shared deps from main's lib (registration order = lib/providers/index.js) ---
    const L = (f) => import(pathToFileURL(path.join(DEFAULT_LIB, f)).href);
    const registry = await L('providers/index.js');
    const [tree, periodicals, seedMod, features, prompts, openrouter, wsPrefs, graph, swipeRef, runView, landingMod, mock, stateMap] = await Promise.all([
      L('tree.js'), L('periodicals.js'), L('starter-seed.js'), L('feature-defaults.js'), L('prompt-templates.js'), L('openrouter.js'),
      L('workspace-preferences.js'), L('graph-features.js'), L('render-swipe.js'), L('run-view.js'), L('parse-landing.js'), L('sample-data/mock-data.js'), L('providers/state-map.js')
    ]);
    const deps = {
      tree, periodicalNodes: periodicals.buildPeriodicalNodes(), starterSeed: seedMod.starterSeed, FEATURE_KEYS: features.FEATURE_KEYS, FEATURE_DEFAULTS: features.FEATURE_DEFAULTS,
      WORKSPACE_FEATURE_KEYS: features.WORKSPACE_FEATURE_KEYS, promptLabels: prompts.getPromptLabels(), DISPATCH_DEFAULT_KINDS: prompts.DISPATCH_DEFAULT_KINDS,
      AVAILABLE_MODELS: openrouter.AVAILABLE_MODELS, AI_OPERATION_KINDS: wsPrefs.AI_OPERATION_KINDS, computeGraphFeaturesRef: graph.computeGraphFeatures,
      flattenTreesRef: swipeRef.flattenTrees, buildRunView: runView.buildRunView, landing: landingMod.parseLandingPage(path.join(REPO, 'content/landing.md')),
      testMockData: mock.testMockData, testMockTeams: mock.testMockTeams, isHiddenState: stateMap.isHiddenState, worldTrees, evidencePool: []
    };
    const getProvider = registry.getProvider;

    // --- sides -----------------------------------------------------------------
    const prepOld = prepareSide(args.old, { label: 'old', workDir: path.join(work, 'copies'), libDir: oldLib, preferSide: args.preferSide, onlyTargets: modules });
    const prepNew = prepareSide(args.new, { label: 'new', workDir: path.join(work, 'copies'), libDir: newLib, preferSide: args.preferSide, onlyTargets: modules });
    const importEffects = {};
    let envAtImport = new Set(); setEnvBucket(envAtImport);
    let p0 = probe();
    const oldMods = await importSide(prepOld);
    importEffects.old = probeDiff(p0, probe(), envAtImport);
    envAtImport = new Set(); setEnvBucket(envAtImport);
    p0 = probe();
    const newMods = await importSide(prepNew);
    importEffects.new = probeDiff(p0, probe(), envAtImport);
    setEnvBucket(null);
    const surface = surfaceDiff(Object.fromEntries(modules.map(m => [m, oldMods[m]])), Object.fromEntries(modules.map(m => [m, newMods[m]])));

    const contract = makeContract(buildConsumerIndex());
    const inventory = args.inventory ? new Inventory() : null;

    // --- inputs ----------------------------------------------------------------
    let fixtureInputs = [];
    let capture = null;
    let descInfo = null;
    if (args.descriptions) {
      descInfo = descriptionInputs(args.descriptions, deps);
      fixtureInputs = descInfo.inputs;
    } else {
      if (args.capture) {
        const { loadCapture } = await import('./lib/capture.mjs');
        capture = await loadCapture({ workDir: work, now: args.now, recapture: args.recapture, log });
        fixtureInputs.push(...capturedInputs(capture));
      }
      // run-evidence models seen in the captured session calls seed the generator pool
      for (const inp of fixtureInputs) {
        if (inp.module !== 'session' || inp.export !== 'renderSessionPage' || !inp.payload) continue;
        try { const a = v8.deserialize(inp.payload); if (a[0]?.runEvidence) deps.evidencePool.push(a[0].runEvidence); } catch { /* ignore */ }
      }
      fixtureInputs.push(...sampleInputs(deps), ...edgeInputs(nowMs, deps));
    }
    fixtureInputs = fixtureInputs.filter(i => modules.includes(i.module));
    const constInputs = modules.flatMap(m => Object.entries(SURFACE[m]).filter(([, k]) => k === 'const').map(([name]) => ({ id: `const:${m}.${name}`, tier: 'const', module: m, export: name, args: [] })));

    const N = args.descriptions ? 0 : args.n;
    const genPlan = [
      ['render', 'renderPage', renderPageCase, N], ['render', 'renderDetailsContent', renderDetailsCase, N], ['render', 'small', smallRenderCase, Math.max(200, Math.ceil(N / 3))],
      ['swipe', 'renderSwipePage', renderSwipeCase, N], ['swipe', 'pure', swipePureCase, N],
      ['session', 'renderSessionPage', sessionCase, N], ['settings', 'renderSettingsPage', settingsCase, N]
    ].filter(([m]) => modules.includes(m)).map(p => (N === 0 ? [...p.slice(0, 3), 0] : p));

    const totals = { inputs: 0, identical: 0, identicalBothThrew: 0, differing: 0, contractDiffering: 0, throwsOld: 0, throwsNew: 0, byTier: {}, byExport: {}, byKind: {} };
    const groups = new Map(); const coarse = new Map(); const contractGroups = new Map();
    const differing = []; const throws = []; const buildErrors = [];
    const envReads = { old: new Map(), new: new Map() };
    const dumpSet = new Set(args.dump);
    const descResults = descInfo ? [] : null;

    const runOne = (input) => {
      const bt = (totals.byTier[input.tier] ||= { inputs: 0, identical: 0, differing: 0 });
      const be = (totals.byExport[`${input.module}.${input.export}`] ||= { inputs: 0, differing: 0 });
      totals.inputs++; bt.inputs++; be.inputs++;
      if (input.error) { buildErrors.push({ id: input.id, error: input.error }); return; }
      let payload = input.payload;
      if (!payload) {
        try { payload = v8.serialize(toTransport(input.args)); } catch (e) { buildErrors.push({ id: input.id, error: `input not serializable: ${e.message}` }); return; }
      }
      const seed = caseSeed(args.seed, 'render', totals.inputs);
      const eo = new Set(); const en = new Set();
      const ro = callSide(oldMods, input, payload, seed, getProvider, eo);
      const rn = callSide(newMods, input, payload, seed, getProvider, en);
      for (const [side, set] of [['old', eo], ['new', en]]) for (const k of set) { const m = envReads[side]; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(`${input.module}.${input.export}`); }
      if (ro.threw) totals.throwsOld++;
      if (rn.threw) totals.throwsNew++;
      if (ro.threw || rn.threw) throws.push({ id: input.id, old: ro.threw ? `${ro.error.name}: ${ro.error.message}` : null, new: rn.threw ? `${rn.error.name}: ${rn.error.message}` : null, oldAt: ro.error?.stack, newAt: rn.error?.stack });
      if (inventory && !ro.threw && typeof ro.value === 'string' && ro.value.includes('<')) inventory.add(input.module, normalizeTree(parseHtml(ro.value)));
      const c = compareResults(input, ro, rn, contract);
      if (dumpSet.has(input.id)) dump(work, input, payload, getProvider, ro, rn);
      if (descResults) descResults.push({ id: input.id, descIndex: input.descIndex, equal: c.equal, kind: c.kind, signature: c.signature || null, contract: c.contract?.signature || null });
      if (c.equal) { totals.identical++; bt.identical++; if (c.bothThrew) totals.identicalBothThrew++; return; }
      totals.differing++; bt.differing++; be.differing++;
      const kindKey = c.kind === 'structural' || c.kind === 'whitespace-only' ? `${c.kind}:${c.subkind}` : c.kind;
      totals.byKind[kindKey] = (totals.byKind[kindKey] || 0) + 1;
      if (c.contract) {
        totals.contractDiffering++;
        totals.byKind['DOM-CONTRACT'] = (totals.byKind['DOM-CONTRACT'] || 0) + 1;
        const ck = `${input.module}.${input.export} | ${c.contract.signature}`;
        let g = contractGroups.get(ck);
        if (!g) contractGroups.set(ck, g = { severity: 'contract', export: `${input.module}.${input.export}`, signature: c.contract.signature, count: 0, tiers: {}, example: { id: input.id, lost: c.contract.lost, gained: c.contract.gained, htmlKind: kindKey, htmlSignature: c.signature }, examples: [] });
        g.count++; g.tiers[input.tier] = (g.tiers[input.tier] || 0) + 1;
        if (g.examples.length < args.maxExamples) g.examples.push(input.id);
      }
      differing.push({ id: input.id, export: `${input.module}.${input.export}`, kind: kindKey, signature: c.signature, contract: c.contract?.signature || null });
      const gk = `${input.module}.${input.export} | ${kindKey} | ${c.signature}`;
      let g = groups.get(gk);
      if (!g) {
        groups.set(gk, g = { export: `${input.module}.${input.export}`, kind: kindKey, signature: c.signature, count: 0, contractCount: 0, tiers: {}, examples: [], example: exampleOf(input, c) });
      }
      g.count++; if (c.contract) g.contractCount++;
      g.tiers[input.tier] = (g.tiers[input.tier] || 0) + 1;
      if (g.examples.length < args.maxExamples) g.examples.push(input.id);
      const ck = `${input.module}.${input.export} | ${c.coarse || kindKey}`;
      const cg = coarse.get(ck) || { export: `${input.module}.${input.export}`, coarse: c.coarse || kindKey, count: 0, signatures: new Set(), example: input.id };
      cg.count++; cg.signatures.add(c.signature); coarse.set(ck, cg);
    };

    const covUrls = [...prepOld.files, ...prepNew.files].map(f => f.url);
    const covPhases = [];
    const phaseNames = [];
    const snap = async (name) => { if (args.coverage) { covPhases.push(await cov.snapshot(covUrls)); phaseNames.push(name); } };
    for (const inp of constInputs) runOne(inp);
    for (const inp of fixtureInputs.filter(i => i.tier === 'test')) runOne(inp);
    await snap('existing-tests');
    for (const inp of fixtureInputs.filter(i => i.tier !== 'test')) runOne(inp);
    await snap('fixtures');
    let generated = 0;
    for (const [m, name, gen, count] of genPlan) {
      for (let i = 0; i < count; i++) {
        const id = `gen:${m}.${name}:${i}`;
        let inp;
        try { inp = { id, tier: 'gen', ...gen(new Rng(caseSeed(args.seed, `${m}.${name}`, i)), nowMs, deps) }; } catch (e) { inp = { id, tier: 'gen', module: m, export: name, error: `generator threw: ${e.stack}` }; }
        if (process.env.REPLAY_TRACE) process.stderr.write(`${id}\n`);
        runOne(inp);
        generated++;
      }
      log(`  generated ${m}.${name}: ${count}`);
    }
    await snap('generated');
    if (args.coverage) await cov.stopCoverage();

    let coverage = null;
    if (args.coverage) {
      coverage = {};
      for (const [label, prep] of [['old', prepOld], ['new', prepNew]]) {
        coverage[label] = {};
        for (const f of prep.files) {
          const phases = covPhases.map(p => p[f.url]);
          const all = cov.lineCoverage(f.dest, phases);
          coverage[label][f.rel] = {
            source: f.src,
            existingTestsOnly: summarize(cov.lineCoverage(f.dest, phases.slice(0, 1))),
            withFixtures: summarize(cov.lineCoverage(f.dest, phases.slice(0, 2))),
            all: { ...summarize(all), uncoveredLineText: all.uncoveredLines.map(u => `${u.line}: ${u.text}`), unhitBlocks: all.unhitBlocks.map(b => `L${b.line}${b.endLine !== b.line ? '-' + b.endLine : ''}: ${b.code}`) }
          };
        }
      }
    }

    const envReadsOut = Object.fromEntries(['old', 'new'].map(s => [s, Object.fromEntries([...envReads[s]].sort().map(([k, v]) => [k, [...v].sort()]))]));
    const envOnlyOld = Object.keys(envReadsOut.old).filter(k => !(k in envReadsOut.new));
    const envOnlyNew = Object.keys(envReadsOut.new).filter(k => !(k in envReadsOut.old));
    const sideInfo = (p) => ({ spec: p.spec, root: p.root, lib: p.libDir, hash: p.hash, copies: p.outRoot, files: p.files.map(f => ({ rel: f.rel, src: f.src })), resolutions: summarizeResolutions(p.resolutions) });
    report = {
      meta: {
        generatedAt: null, tool: path.join(HERE, 'replay.mjs'), node: process.version,
        old: sideInfo(prepOld), new: sideInfo(prepNew), modules: modules.map(m => MODULE_FILES[m]),
        frozenNow: new Date(nowMs).toISOString(), seed: args.seed, n: args.n, generated, envPinned,
        descriptions: descInfo ? { file: path.resolve(args.descriptions), strings: descInfo.count } : undefined,
        capture: capture ? { head: capture.head, dirty: capture.dirty, files: capture.files.length, filesWithCalls: capture.files.filter(f => f.records.length).length, calls: capture.files.reduce((s, f) => s + f.records.length, 0), nonZeroExit: capture.files.filter(f => f.exit !== 0).map(f => f.file), unfrozen: capture.files.filter(f => !f.frozenClock).map(f => f.file) } : null,
        importSideEffects: importEffects,
        envReadsDuringRender: { onlyOld: envOnlyOld, onlyNew: envOnlyNew, old: envReadsOut.old, new: envReadsOut.new },
        networkAttemptsTotal: networkAttempts.length
      },
      surface,
      totals,
      contractGroups: [...contractGroups.values()].sort((a, b) => b.count - a.count),
      groups: [...groups.values()].sort((a, b) => severity(a.kind) - severity(b.kind) || b.count - a.count),
      coarseGroups: [...coarse.values()].sort((a, b) => b.count - a.count).map(g => ({ ...g, signatures: g.signatures.size })),
      differing,
      throws,
      buildErrors,
      descriptions: descResults,
      inventory: inventory ? inventory.toJSON(contract) : undefined,
      coverage
    };
  } finally {
    restoreClock();
  }
  report.meta.generatedAt = new Date().toISOString();
  report.meta.elapsedMs = Date.now() - t0;
  const outPath = path.resolve(args.out || path.join(work, 'report.json'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, (k, v) => (v instanceof Set ? [...v] : v), 2));
  printSummary(report, outPath, log);
  process.exitCode = report.totals.differing > 0 || report.surface.some(s => s.severity === 'contract') ? 1 : 0;
}

const SEVERITY = ['throw', 'structural:element', 'structural:attribute', 'structural:text', 'data', 'input-mutation', 'serialization-only', 'whitespace-only:presence', 'whitespace-only:runs'];
function severity(k) { const i = SEVERITY.indexOf(k); return i < 0 ? 5 : i; }

function exampleOf(input, c) {
  const e = { id: input.id, kind: c.kind, subkind: c.subkind };
  for (const k of ['before', 'after', 'normBefore', 'normAfter', 'first', 'diffs', 'diffCount', 'old', 'new', 'path', 'contract', 'parseWarnings', 'inputMutation']) if (c[k] !== undefined && c[k] !== null) e[k] = c[k];
  return e;
}
function summarize(c) { return { linesTotal: c.linesTotal, linesCovered: c.linesCovered, pct: c.pct, blocksHit: c.blocksHit, blocksTotal: c.blocksTotal, uncoveredLines: c.uncoveredLines.map(u => u.line) }; }
function summarizeResolutions(rs) { const m = {}; for (const r of rs) m[r.via] = (m[r.via] || 0) + 1; return { counts: m, sideFiles: rs.filter(r => r.via !== 'lib').map(r => `${r.from} -> ${r.to} (${r.via})`) }; }

function dump(work, input, payload, getProvider, ro, rn) {
  const dir = path.join(work, 'dump', input.id.replace(/[^a-zA-Z0-9._-]+/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  const args = revive(v8.deserialize(payload), getProvider);
  fs.writeFileSync(path.join(dir, 'input.txt'), util.inspect({ module: input.module, export: input.export, env: input.env, args }, { depth: null, maxArrayLength: null, maxStringLength: null }));
  for (const [k, r] of [['old', ro], ['new', rn]]) {
    if (r.threw) fs.writeFileSync(path.join(dir, `${k}.error.txt`), `${r.error.name}: ${r.error.message}\n${r.error.stack || ''}`);
    else if (typeof r.value === 'string') { fs.writeFileSync(path.join(dir, `${k}.html`), r.value); fs.writeFileSync(path.join(dir, `${k}.collapsed.html`), collapseWs(r.value)); }
    else fs.writeFileSync(path.join(dir, `${k}.txt`), util.inspect(r.value, { depth: null, maxArrayLength: null }));
  }
}

function printSummary(r, outPath, log) {
  const t = r.totals;
  log('');
  log(`render-cluster replay  old=${r.meta.old.spec} (${r.meta.old.hash})  new=${r.meta.new.spec} (${r.meta.new.hash})`);
  log(`clock=${r.meta.frozenNow}  seed=${r.meta.seed}  n=${r.meta.n}  generated=${r.meta.generated}  ${r.meta.elapsedMs} ms`);
  log(`inputs ${t.inputs}  identical ${t.identical}${t.identicalBothThrew ? ` (${t.identicalBothThrew} both threw identically)` : ''}  differing ${t.differing}  DOM-contract ${t.contractDiffering}  throws old ${t.throwsOld} / new ${t.throwsNew}`);
  log('by tier: ' + Object.entries(t.byTier).map(([k, v]) => `${k} ${v.inputs}/${v.differing}`).join(', '));
  if (Object.keys(t.byKind).length) log('by kind: ' + Object.entries(t.byKind).map(([k, v]) => `${k} ${v}`).join(', '));
  if (r.surface.length) log('export surface: ' + r.surface.map(s => `${s.module} ${s.export} ${s.kind}`).join('; '));
  for (const [k, v] of Object.entries(r.meta.importSideEffects)) if (Object.keys(v).length) log(`import side effects (${k}): ${JSON.stringify(v)}`);
  const er = r.meta.envReadsDuringRender;
  if (er.onlyOld.length || er.onlyNew.length) log(`env reads differ: only old ${JSON.stringify(er.onlyOld)} only new ${JSON.stringify(er.onlyNew)}`);
  if (r.meta.networkAttemptsTotal) log(`!! network attempts blocked: ${r.meta.networkAttemptsTotal}`);
  if (r.buildErrors.length) log(`input build errors: ${r.buildErrors.length} (first: ${r.buildErrors[0].id}: ${String(r.buildErrors[0].error).slice(0, 200)})`);
  if (r.contractGroups.length) {
    log(`\n!! ${r.contractGroups.length} DOM-CONTRACT group(s):`);
    for (const g of r.contractGroups.slice(0, 15)) log(`  [${g.count}] ${g.export}  ${g.signature}\n       e.g. ${g.example.id}  lost ${JSON.stringify(g.example.lost.slice(0, 3))} gained ${JSON.stringify(g.example.gained.slice(0, 3))}`);
  }
  if (r.groups.length) {
    log(`\n${r.groups.length} difference group(s) (${r.coarseGroups.length} coarse):`);
    for (const g of r.groups.slice(0, 25)) {
      log(`  [${g.count}${g.contractCount ? `, contract ${g.contractCount}` : ''}] ${g.export}  ${g.kind}  ${g.signature.slice(0, 220)}`);
      log(`       tiers ${JSON.stringify(g.tiers)}  e.g. ${g.example.id}`);
      const e = g.example;
      if (e.before !== undefined) { log(`       old: ${String(e.before).replace(/\n/g, '\\n').slice(0, 160)}`); log(`       new: ${String(e.after).replace(/\n/g, '\\n').slice(0, 160)}`); }
      else if (e.first) log(`       ${e.first.what}  old=${JSON.stringify(e.first.old ?? null)?.slice(0, 120)} new=${JSON.stringify(e.first.new ?? null)?.slice(0, 120)}`);
      else if (e.old !== undefined || e.new !== undefined) log(`       old=${String(e.old).slice(0, 140)} new=${String(e.new).slice(0, 140)}`);
    }
    if (r.groups.length > 25) log(`  ... ${r.groups.length - 25} more in the report`);
  }
  if (r.coverage) {
    for (const [side, files] of Object.entries(r.coverage)) {
      for (const [rel, c] of Object.entries(files)) {
        log(`coverage ${side} ${rel}: lines ${c.all.linesCovered}/${c.all.linesTotal} = ${c.all.pct}%  blocks ${c.all.blocksHit}/${c.all.blocksTotal}  [tests only ${c.existingTestsOnly.pct}%, +fixtures ${c.withFixtures.pct}%]`);
        if (side === 'old' && c.all.uncoveredLineText.length) log('    uncovered: ' + c.all.uncoveredLineText.slice(0, 40).join('\n               '));
      }
    }
  }
  log(`\nreport: ${outPath}`);
}

main().catch(e => { console.error(e?.stack || e); process.exitCode = 2; });
