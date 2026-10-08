// LV=<worktree> FIX=a,b node fixreplay.mjs <label> <K> [ids] — the library's own buildSelectorArgs (production path)
import { bundleAt, buildSelectorArgs, promptOf, route, pool } from './harness.mjs';
import { POINTS } from './points.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
const [label = 'fix', Karg = '6', only = ''] = process.argv.slice(2);
const pts = POINTS.filter(p => !only || only.split(',').includes(p.id));
mkdirSync('runs', { recursive: true });
const jobs = [];
for (const p of pts) {
  const { issue, context } = await bundleAt(p.issue, p.at, p.states);
  const prompt = promptOf(buildSelectorArgs(issue, context, {}, null));
  for (let k = 0; k < +Karg; k++) jobs.push({ p, prompt, k });
}
const res = await pool(jobs, 8, async (j) => ({ id: j.p.id, k: j.k, chars: j.prompt.length, ...(await route(j.prompt)) }));
const file = `runs/fix-${label}.json`;
const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
writeFileSync(file, JSON.stringify([...prev, ...res], null, 1));
let cost = 0, right = 0, n = 0;
for (const p of pts) {
  const rs = res.filter(r => r.id === p.id);
  const ok = rs.filter(r => p.gold.includes(r.action) && (!p.deferTo || r.deferTo === p.deferTo)).length;
  if (!p.hop) { right += ok; n += rs.length; }
  cost += rs.reduce((x, r) => x + r.cost, 0);
  const dist = {}; for (const r of rs) { const key = r.action + (r.deferTo ? `>${r.deferTo}` : ''); dist[key] = (dist[key] || 0) + 1; }
  console.log(`${p.id.padEnd(4)} ${p.issue} gold=${p.gold.join('|').padEnd(14)} ${ok}/${rs.length}  ${JSON.stringify(dist)}`);
}
console.log(`label=${label} FIX=${process.env.FIX || ''} right ${right}/${n} (non-hop)  cost $${cost.toFixed(3)}`);
