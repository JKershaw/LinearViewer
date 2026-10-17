// Worker: replays a slice of in-process scenarios (edge / gen tiers). For
// EVERY scenario and side it imports a brand-new module instance
// (`?inst=<side>-<id>`), so module-level state starts empty for both sides.
// From rung5d/replay/lib/worker.mjs, with the target's generators / world /
// inspect hooks loaded from the target module (workerData.targetUrl).
import { workerData, parentPort } from 'node:worker_threads';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { pinEnv, installNetworkGuard, freezeClock, networkAttempts, installSeededUUID } from './hermetic.mjs';

pinEnv();
installNetworkGuard();
freezeClock(workerData.now);
installSeededUUID();
const here = path.dirname(new URL(import.meta.url).pathname);
register(pathToFileURL(path.join(here, 'hooks.mjs')).href, { data: { roots: workerData.sides.map(s => s.workRootUrl) } });

const target = await import(workerData.targetUrl);
const { runScenario } = await import('./runner.mjs');
const { compareObs } = await import('./compare.mjs');
const { captureConsole } = await import('./runner.mjs');
const cov = workerData.coverage ? await import('./coverage.mjs') : null;

const unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(e); });

let edge = null;
const scenarioFor = (it) => {
  if (it.tier === 'edge') { edge = edge || target.edgeCases(); return edge[it.index]; }
  return target.generate(workerData.seed, it.index);
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
    const o = await runScenario(mod, sc, unhandled, target);
    o.importConsole = rec.console;
    obs[side.label] = o;
  }
  const [A, B] = workerData.sides.map(s => obs[s.label]);
  const cmp = (A.importError || B.importError)
    ? { diffs: [{ kind: 'import-error', step: -1, fn: '(import)', sig: 'import-error', old: JSON.stringify(A.importError), new: JSON.stringify(B.importError) }], info: [] }
    : compareObs(A, B);
  const facts = A.steps.map(s => ({ fn: s.fn, mode: s.mode, calls: s.calls.length, warns: s.console.length }));
  const findings = Object.fromEntries(workerData.sides.map(s => [s.label, (obs[s.label].steps || []).flatMap((st, i) => (st.findings || []).map(f => ({ step: i, fn: st.fn, ...f })))]));
  const r = { id: sc.id, tier: sc.tier, family: sc.family || null, diffs: cmp.diffs, info: cmp.info, facts, findings };
  if (workerData.detail) r.detail = { scenario: sc, old: A, new: B };
  results.push(r);
  if (cov && ++sinceFold >= 60) { await fold(it.tier); sinceFold = 0; }
}
if (cov && lastTier) await fold(lastTier);
parentPort.postMessage({
  results,
  networkAttempts,
  coverage: cov ? [...accByTier].map(([tier, acc]) => [tier, cov.serializeAcc(acc)]) : null,
});
