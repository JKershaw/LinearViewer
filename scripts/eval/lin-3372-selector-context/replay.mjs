// node replay.mjs <variantName> [K] [ids]  — variants defined in VARIANTS
import { bundleAt, selectorArgs, promptOf, route, pool } from './harness.mjs';
import { POINTS } from './points.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
export const VARIANTS = {
  base: {},
  descNone: { descMode: 'none' },
  descHead4k: { descMode: 'head:4000' },
  descCrop6k: { descMode: 'crop:6000' },
  descTail6k: { descMode: 'tail:6000' },
  comments0: { viewComments: 0 },
  comments1: { viewComments: 1 },
  noFacts: { noFacts: true },
  noRuns: { noRuns: true },
  leafFacts: { leafFacts: true },
  noDescend: { noDescend: true },
  noDescendLeafFacts: { noDescend: true, leafFacts: true },
};
const [variant = 'base', Karg = '6', only = ''] = process.argv.slice(2);
const K = +Karg;
const pts = POINTS.filter(p => !only || only.split(',').includes(p.id));
mkdirSync('runs', { recursive: true });
const jobs = [];
for (const p of pts) {
  const { issue, context } = await bundleAt(p.issue, p.at, p.states);
  const prompt = promptOf(selectorArgs(issue, context, VARIANTS[variant]));
  for (let k = 0; k < K; k++) jobs.push({ p, prompt, k });
}
const res = await pool(jobs, 8, async (j) => ({ id: j.p.id, k: j.k, chars: j.prompt.length, ...(await route(j.prompt)) }));
const file = `runs/${variant}.json`;
const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
writeFileSync(file, JSON.stringify([...prev, ...res], null, 1));
let cost = 0, right = 0;
for (const p of pts) {
  const rs = res.filter(r => r.id === p.id);
  const ok = rs.filter(r => p.gold.includes(r.action) && (!p.deferTo || r.deferTo === p.deferTo)).length;
  right += ok; cost += rs.reduce((n, r) => n + r.cost, 0);
  const dist = {}; for (const r of rs) { const key = r.action + (r.deferTo ? `>${r.deferTo}` : ''); dist[key] = (dist[key] || 0) + 1; }
  console.log(`${p.id.padEnd(4)} ${p.issue} gold=${p.gold.join('|').padEnd(14)} seen=${p.seen.padEnd(26)} ${ok}/${rs.length}  ${JSON.stringify(dist)}`);
}
console.log(`variant=${variant} right ${right}/${res.length}  cost $${cost.toFixed(3)}`);
