// LIN-3551: how the minimum kill-preserving set grows with the number of mutants sampled (random subsamples of the 79 killed).
import { readFileSync, writeFileSync } from 'fs';
import { exact } from './setcover.mjs';
const km = JSON.parse(readFileSync(new URL('./kill-matrix.json', import.meta.url)));
const killed = km.mutants.filter((m) => m.outcome === 'killed');
const files = [...new Set(killed.flatMap((m) => m.killFiles))];
const sets = new Map(files.map((f) => [f, new Set(killed.filter((m) => m.killFiles.includes(f)).map((m) => m.id))]));
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const res = [];
for (const m of [10, 20, 30, 40, 50, 60, 70, 79]) {
  const sizes = [];
  for (let t = 0; t < (m === 79 ? 1 : 30); t++) {
    const pool = [...killed]; const sub = []; for (let i = 0; i < m; i++) sub.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0].id);
    sizes.push(exact(sets, new Set(sub), { timeLimitMs: 20_000 }).size);
  }
  res.push({ mutants: m, meanMinSet: sizes.reduce((a, b) => a + b, 0) / sizes.length, min: Math.min(...sizes), max: Math.max(...sizes) });
}
writeFileSync(new URL('./curve.json', import.meta.url), JSON.stringify(res, null, 1));
console.log(res.map((r) => `${r.mutants}: ${r.meanMinSet.toFixed(1)} [${r.min}-${r.max}]`).join('\n'));
