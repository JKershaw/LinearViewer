// The judge's own three checks, plus the non-vacuity floors. Run AFTER the
// judge is built and BEFORE it judges a change:
//   node experiments/costs-untangle/replay/selfcheck.mjs --old <sha> --new <sha> [--n 2000] [--seeds 7,11] [--out <file>]
//   1. identity: old against old on each seed → 0 differences
//   2. planted faults: every reachable mutant, applied to a copy of the NEW tree,
//      must be caught at exactly the surfaces its `expect` names
//   3. non-vacuity: each surface has a floor of priced, non-null figures, so a
//      run where everything collapses to zero/null cannot pass as "identical"
// Exit 0 only if all three hold (coverage is judged in coverage.mjs, reported here).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, resolveSha, snapshotOf, scenariosFor, runSide, compareSides, WORK } from './replay.mjs';
import { MUTANTS } from './mutants.mjs';
import { SURFACE_IDS } from './surfaces.mjs';
import { coverageReport } from './coverage.mjs';

const args = parseArgs(process.argv.slice(2));
const seeds = String(args.seeds || '7,11').split(',').map(Number);
const n = args.n || 2000;

const oldSha = resolveSha(args.old);
const newSha = resolveSha(args.new);
const oldTree = snapshotOf(oldSha);
const newTree = snapshotOf(newSha);

function sideOut(tree, scenariosFile, label) {
  return runSide({ tree, scenariosFile, label, coverageDir: path.join(WORK, `cov-${label}`) });
}

// ── 1. identity ────────────────────────────────────────────────────────────
const identity = [];
for (const seed of seeds) {
  const scenarios = scenariosFor({ seed, n });
  const file = path.join(WORK, `scenarios-${seed}-${n}.json`);
  fs.writeFileSync(file, JSON.stringify(scenarios));
  const a = sideOut(oldTree, file, `id-a-${seed}`);
  const b = sideOut(oldTree, file, `id-b-${seed}`);
  const rep = compareSides(a, b, scenarios);
  identity.push({ seed, scenarios: scenarios.length, differing: rep.differing });
}
const identityOk = identity.every(x => x.differing === 0);

// ── 3. non-vacuity (judged on the old side, seed 7) ───────────────────────
const seed0 = seeds[0];
const scen0 = scenariosFor({ seed: seed0, n });
const file0 = path.join(WORK, `scenarios-${seed0}-${n}.json`);
const oldOut = sideOut(oldTree, file0, 'floor-old');
const parsed = id => oldOut.out[id].map(s => JSON.parse(s));
// A floor is a share of scenarios in which the surface produced a real figure
// (priced, non-null), so it means the same at any --n.
const total = scen0.length;
const perScenario = (id, pred) => parsed(id).filter(pred).length;
const floors = {
  rate: { figure: 'scenarios with a resolved rate row', n: perScenario('rate', rows => rows.some(x => x.rate !== null)), min: 0.5 },
  usage: { figure: 'scenarios with a priced usage', n: perScenario('usage', u => u.priced.some(x => x !== null)), min: 0.5 },
  lineage: { figure: 'scenarios with a lineage carrying usage', n: perScenario('lineage', ls => ls.some(x => x.rowUsage.length > 0)), min: 0.5 },
  termMarked: { figure: 'scenarios with a priced terminal-marked cost', n: perScenario('termMarked', x => x.costUsd !== null), min: 0.1 },
  gauge: { figure: 'scenarios with a percent consumed', n: perScenario('gauge', x => x.percentConsumed !== null), min: 0.1 },
  taskCost: { figure: 'scenarios with a fully priced ticket total', n: perScenario('taskCost', ts => ts.some(t => t.cost.totalUsd !== null)), min: 0.05 },
  callLog: { figure: 'scenarios with a summarised call cost above zero', n: perScenario('callLog', x => x.summarize.totalCost > 0), min: 0.2 },
};
for (const f of Object.values(floors)) { f.of = total; f.need = Math.ceil(f.min * total); f.ok = f.n >= f.need; }
const floorsOk = Object.values(floors).every(f => f.ok);

// ── 2. planted faults ──────────────────────────────────────────────────────
const mutantsReachable = MUTANTS.filter(m => m.reach === 'v1');
const scenarioFile = file0;
const mutantResults = [];
for (const m of mutantsReachable) {
  const dir = path.join(WORK, 'mut', m.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync('cp', ['-R', newTree, dir]);
  const target = path.join(dir, m.file);
  const src = fs.readFileSync(target, 'utf8');
  const hits = src.split(m.old).length - 1;
  if (hits !== 1) {
    mutantResults.push({ id: m.id, error: `old text occurs ${hits} times in ${m.file} (need exactly 1)` });
    continue;
  }
  fs.writeFileSync(target, src.replace(m.old, m.new));
  const mutOut = sideOut(dir, scenarioFile, `mut-${m.id}`);
  const rep = compareSides(oldOut, mutOut, scen0);
  const caughtAt = SURFACE_IDS.filter(id => rep.surfaces[id].differing > 0).sort();
  const expected = [...m.expect].sort();
  const same = caughtAt.length === expected.length && caughtAt.every((s, i) => s === expected[i]);
  mutantResults.push({
    id: m.id, decision: m.decision, site: m.site, expected, caughtAt,
    verdict: caughtAt.length === 0 ? 'NOT CAUGHT' : same ? 'as expected' : 'DIFFERENT SURFACES',
    examples: caughtAt.slice(0, 1).map(id => rep.surfaces[id].examples[0]),
  });
}
const mutantsOk = mutantResults.every(r => !r.error && r.verdict === 'as expected');

const cov = coverageReport({ dir: path.join(WORK, 'cov-floor-old') });
const summary = {
  old: oldSha.slice(0, 12), new: newSha.slice(0, 12), n, seeds,
  identity, identityOk,
  floors, floorsOk,
  mutants: { total: MUTANTS.length, reachable: mutantsReachable.length, notRun: MUTANTS.filter(m => m.reach !== 'v1').map(m => ({ id: m.id, why: m.why })), results: mutantResults, ok: mutantsOk },
  coverage: cov,
};
if (args.out) fs.writeFileSync(args.out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ identityOk, floorsOk, mutantsOk, identity, floors: Object.fromEntries(Object.entries(floors).map(([k, v]) => [k, `${v.n}/${v.of} (need ${v.need})`])), mutantVerdicts: mutantResults.map(r => `${r.id}: ${r.error || r.verdict} ${r.error ? '' : JSON.stringify(r.caughtAt)}`), coverage: cov.summary }, null, 2));
process.exit(identityOk && floorsOk && mutantsOk ? 0 : 1);
