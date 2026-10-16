// Worker: replays a slice of scenarios. For EVERY scenario and side it imports
// a brand-new module instance (`?inst=<side>-<id>`), so module-level state
// (pipeline-loops' warn-once Set, or anything a rebuild adds) starts empty
// for both sides on every scenario.
import { workerData, parentPort } from 'node:worker_threads';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import v8 from 'node:v8';
import { pinEnv, installNetworkGuard, freezeClock, networkAttempts } from './hermetic.mjs';

pinEnv();
installNetworkGuard();
freezeClock(workerData.now);
const here = path.dirname(new URL(import.meta.url).pathname);
register(pathToFileURL(path.join(here, 'hooks.mjs')).href, { data: { roots: workerData.sides.map(s => s.workRootUrl) } });

const { runScenario } = await import('./runner.mjs');
const { compareObs } = await import('./compare.mjs');
const { generate } = await import('./gen.mjs');
const { edgeCases } = await import('./edge.mjs');
const { captureConsole } = await import('./fakes.mjs');
const cov = workerData.coverage ? await import('./coverage.mjs') : null;

const unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(e); });

let testCases = null;
const loadTest = () => {
  if (!testCases) testCases = workerData.capturePath ? v8.deserialize(fs.readFileSync(workerData.capturePath)).scenarios : [];
  return testCases;
};
let edge = null;
const scenarioFor = (it) => {
  if (it.tier === 'gen') return generate(workerData.seed, it.index);
  if (it.tier === 'edge') { edge = edge || edgeCases(); return edge[it.index]; }
  return loadTest()[it.index];
};

if (cov) await cov.startCoverage();
const fileUrls = new Map(workerData.coverageFiles || []);
const accByTier = new Map();
const fold = async (tier) => {
  if (!cov) return;
  if (!accByTier.has(tier)) accByTier.set(tier, new Map());
  await cov.foldSnapshot(accByTier.get(tier), fileUrls);
};

const results = [];
let lastTier = null;
let sinceFold = 0;
for (const it of workerData.items) {
  if (cov && lastTier && lastTier !== it.tier) { await fold(lastTier); sinceFold = 0; }
  lastTier = it.tier;
  const sc = scenarioFor(it);
  const obs = {};
  for (const side of workerData.sides) {
    const rec = { console: [] };
    const restore = captureConsole(rec);
    let mod;
    let importError = null;
    try { mod = await import(`${side.mainUrl}?inst=${side.label}-${encodeURIComponent(sc.id)}`); }
    catch (e) { importError = { name: e.name, message: e.message }; }
    restore();
    if (importError) { obs[side.label] = { importConsole: rec.console, importError, steps: [] }; continue; }
    const o = await runScenario(mod, sc, unhandled);
    o.importConsole = rec.console;
    obs[side.label] = o;
  }
  const [A, B] = workerData.sides.map(s => obs[s.label]);
  const cmp = (A.importError || B.importError)
    ? { diffs: [{ kind: 'import-error', step: -1, fn: '(import)', sig: 'import-error', old: JSON.stringify(A.importError), new: JSON.stringify(B.importError) }], info: [] }
    : compareObs(A, B);
  // Light per-scenario facts for the report's input census.
  const facts = A.steps.map(s => ({ fn: s.fn, mode: s.mode, n: Array.isArray(s.value) ? s.value.length : null, warns: s.console.filter(c => c[0] === 'warn').length, calls: s.calls.length }));
  // Capture fidelity: does the OLD side's replay of a captured test call
  // reproduce what the real call returned inside the test?
  let fidelity = null;
  if (sc.expected && A.steps[0]) {
    const s0 = A.steps[0];
    if (sc.expected.mode !== s0.mode) fidelity = `mode ${sc.expected.mode}→${s0.mode}`;
    else if (sc.expected.error) fidelity = sc.expected.error.name === s0.error?.name && sc.expected.error.message === s0.error?.message ? 'same' : 'error differs';
    else if (sc.expected.value == null) fidelity = 'unchecked';
    else fidelity = sc.expected.value === JSON.stringify(s0.value) ? 'same' : 'value differs';
  }
  results.push({ id: sc.id, tier: sc.tier, family: sc.family || null, site: sc.site || null, diffs: cmp.diffs, info: cmp.info, facts, fidelity });
  if (cov && ++sinceFold >= 60) { await fold(it.tier); sinceFold = 0; }
}
if (cov && lastTier) await fold(lastTier);
parentPort.postMessage({
  results,
  networkAttempts,
  coverage: cov ? [...accByTier].map(([tier, acc]) => [tier, cov.serializeAcc(acc)]) : null,
});
