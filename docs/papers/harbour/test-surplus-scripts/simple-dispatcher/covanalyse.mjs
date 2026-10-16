// LIN-3551: coverage-preserving minimal test-file set, and how it fares on the kill matrix (and vice versa).
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { greedy, exact } from './setcover.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = resolve(here, 'sd-wt');
const cov = readdirSync(resolve(here, 'covlines')).map((f) => JSON.parse(readFileSync(resolve(here, 'covlines', f), 'utf8')));
const sets = new Map(cov.map((c) => [c.test, new Set(Object.entries(c.covered).flatMap(([f, ls]) => ls.map((l) => `${f}:${l}`)))]));
const U = new Set([...sets.values()].flatMap((s) => [...s]));
const loc = (set) => set.reduce((a, f) => a + readFileSync(resolve(work, f), 'utf8').split('\n').length, 0);

const g = greedy(sets, U);
const ex = exact(sets, U, { timeLimitMs: 600_000 });
// lines covered by exactly one file
const soleCount = new Map();
for (const e of U) { const c = [...sets.keys()].filter((f) => sets.get(f).has(e)); if (c.length === 1) soleCount.set(c[0], (soleCount.get(c[0]) || 0) + 1); }

// cross-check against the kill matrix
const km = JSON.parse(readFileSync(resolve(here, 'kill-matrix.json'), 'utf8'));
const killed = km.mutants.filter((m) => m.outcome === 'killed');
const missesOf = (set) => killed.filter((m) => !m.killFiles.some((f) => set.includes(f))).map((m) => m.id);
const covSet = ex.best;
const killSet = km.summary.sets.all.example;
const covOf = (set) => new Set(set.flatMap((f) => [...sets.get(f)])).size;

// per-file wall time standalone
const time = Object.fromEntries(cov.map((c) => [c.test, c.wallMs]));
const tSum = (set) => set.reduce((a, f) => a + time[f], 0);
const out = {
  testFilesWithCoverage: cov.length, nonZeroExit: cov.filter((c) => c.status !== 0).map((c) => c.test),
  productionLinesCoveredBySuite: U.size,
  greedySize: g.length, exactSize: ex.size, optimal: ex.optimal, classes: ex.classes, coverageSet: covSet, coverageSetLoc: loc(covSet),
  filesWithSoleLines: soleCount.size, soleLinesByFile: Object.fromEntries([...soleCount].sort((a, b) => b[1] - a[1])),
  coverageSetMissesMutants: { curated: missesOf(covSet).filter((i) => i.startsWith('curated')), fresh: missesOf(covSet).filter((i) => i.startsWith('fresh')), ofKilled: killed.length },
  killSetCoverageShare: covOf(killSet) / U.size,
  standaloneMs: { all: tSum([...sets.keys()]), coverageSet: tSum(covSet), killSetAll: tSum(killSet) },
  slowestFiles: Object.entries(time).sort((a, b) => b[1] - a[1]).slice(0, 8),
};
writeFileSync(resolve(here, 'coverage-set.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, soleLinesByFile: undefined }, null, 1));
