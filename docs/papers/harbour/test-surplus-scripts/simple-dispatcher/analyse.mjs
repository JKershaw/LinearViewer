// LIN-3551: kill matrix -> minimal test-file sets, cross-validated between curated and fresh samples.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { greedy, exact } from './setcover.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = resolve(here, 'sd-wt');
const rows = readFileSync(resolve(here, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const testFiles = readdirSync(resolve(work, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`).sort();
const loc = Object.fromEntries(testFiles.map((f) => [f, readFileSync(resolve(work, f), 'utf8').split('\n').length]));
const totalLoc = Object.values(loc).reduce((a, b) => a + b, 0);
const locOf = (set) => set.reduce((a, f) => a + loc[f], 0);

const sets = new Map(testFiles.map((f) => [f, new Set()]));
for (const r of rows) for (const f of r.killFiles || []) sets.get(f).add(r.id);
const killed = (sample) => new Set(rows.filter((r) => r.sample === sample && r.outcome === 'killed').map((r) => r.id));
const U = { curated: killed('curated'), fresh: killed('fresh') };
U.all = new Set([...U.curated, ...U.fresh]);
const covers = (set, u) => [...u].filter((e) => set.some((f) => sets.get(f).has(e)));
const misses = (set, u) => [...u].filter((e) => !set.some((f) => sets.get(f).has(e)));

const out = { testFiles: testFiles.length, totalTestLoc: totalLoc, outcomes: {}, sets: {} };
for (const s of ['curated', 'fresh']) {
  const rs = rows.filter((r) => r.sample === s);
  out.outcomes[s] = Object.fromEntries([...new Set(rs.map((r) => r.outcome))].map((o) => [o, rs.filter((r) => r.outcome === o).length]));
}
const killingFiles = testFiles.filter((f) => sets.get(f).size);
out.filesKillingAnything = killingFiles.length;
out.soleKillerFiles = {};
for (const e of U.all) { const c = testFiles.filter((f) => sets.get(f).has(e)); if (c.length === 1) (out.soleKillerFiles[c[0]] ||= []).push(e); }
out.killersPerMutant = Object.fromEntries([...U.all].map((e) => [e, testFiles.filter((f) => sets.get(f).has(e)).length]));

for (const [train, test] of [['curated', 'fresh'], ['fresh', 'curated'], ['all', null]]) {
  const g = greedy(sets, U[train]);
  const proof = exact(sets, U[train], { timeLimitMs: 300_000 });
  const ex = exact(sets, U[train], { enumerateAll: true, timeLimitMs: 300_000, maxSolutions: 5000 });
  if (ex.size !== proof.size) throw new Error('enumeration disagrees with proof');
  const entry = { universe: U[train].size, greedy: g, greedySize: g.length, exactSize: proof.size, optimal: proof.optimal, nOptimalSolutions: ex.solutions.length, enumerationCapped: ex.capped || !ex.optimal, classes: ex.classes, example: ex.best, exampleLoc: locOf(ex.best) };
  entry.locRangeOverOptimal = [Math.min(...ex.solutions.map(locOf)), Math.max(...ex.solutions.map(locOf))];
  if (test) {
    const missCounts = ex.solutions.map((sol) => misses(sol, U[test]).length);
    entry.heldOut = {
      sample: test, universe: U[test].size,
      greedyMisses: misses(g, U[test]),
      optimalMissRange: [Math.min(...missCounts), Math.max(...missCounts)],
      optimalMissMean: missCounts.reduce((a, b) => a + b, 0) / missCounts.length,
      exampleMisses: misses(ex.best, U[test]),
    };
    // files you would need to add to the train-chosen (greedy) set to recover the held-out sample
    const extra = new Map([...sets.entries()].map(([f, s]) => [f, new Set([...s].filter((e) => entry.heldOut.greedyMisses.includes(e)))]));
    entry.heldOut.greedyRepairFiles = greedy(extra, new Set(entry.heldOut.greedyMisses));
  }
  out.sets[train] = entry;
}

// random baseline: random k-file subsets (k = optimal size on all), share of U.all killed
let seed = 3551; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const k = out.sets.all.exactSize; const fr = [];
for (let t = 0; t < 2000; t++) { const pool = [...testFiles]; const pick = []; for (let i = 0; i < k; i++) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]); fr.push(covers(pick, U.all).length / U.all.size); }
fr.sort((a, b) => a - b);
out.randomBaseline = { k, meanShareKilled: fr.reduce((a, b) => a + b, 0) / fr.length, p5: fr[100], p95: fr[1900] };

const matrix = rows.map((r) => ({ id: r.id, sample: r.sample, file: r.file, line: r.line, name: r.name, before: r.before, after: r.after, killer: r.killer, outcome: r.outcome, killFiles: r.killFiles || [], killers: r.killers || [] }));
const base = JSON.parse(readFileSync(resolve(here, 'baseline-runs.json'), 'utf8'));
writeFileSync(resolve(here, 'kill-matrix.json'), JSON.stringify({ repo: 'simple-dispatcher', head: '0d54b97', suite: 'node --require ./test/isolate-local-halt.js --test test/*.test.js', baselineRuns: base, summary: out, mutants: matrix }, null, 1));
console.log(JSON.stringify(out, null, 1));
