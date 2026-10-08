// node corpus-ablate.mjs <K> <variant...> — the 92-fixture routing corpus with selector ablations, graded by the eval's own gold
import { selectorArgs, promptOf, route, pool } from './harness.mjs';
import { VARIANTS } from './variants.mjs';
import { writeFileSync, mkdirSync } from 'fs';
const LV = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const { loadCases, applyOverrides, gradeAnswer } = await import(`${LV}/scripts/eval/jev-routing-eval.mjs`);
const { reviewLoopExhausted, selectFocusSubtask, isTerminalState } = await import(`${LV}/lib/recommendation-facts.js`);
const [Karg, ...variants] = process.argv.slice(2);
const cases = loadCases(); applyOverrides(cases);
mkdirSync('corpus', { recursive: true });
const jobs = [];
for (const c of cases) {
  const b = c.bundle;
  const context = { parent: b.parent, siblings: b.siblings || [], siblingsTotal: b.siblingsTotal || 0, project: b.project, children: b.children || [], comments: b.comments || [], focusedChild: b.focusedChild || null, runs: b.runHistory?.runs || [] };
  const coded = reviewLoopExhausted(b.issue, context.comments);
  const deferEligible = (context.children || []).some(ch => !isTerminalState(ch.state?.type));
  for (const v of variants) {
    const prompt = promptOf(selectorArgs(b.issue, context, VARIANTS[v]));
    for (let k = 0; k < +Karg; k++) jobs.push({ c, v, k, prompt, coded, deferEligible });
  }
}
const res = await pool(jobs, 10, async (j) => {
  const r = j.coded ? { action: 'blocked', cost: 0, code: true } : await route(j.prompt);
  return { id: j.c.id, v: j.v, k: j.k, action: r.action, hit: gradeAnswer(j.c, r.action, j.deferEligible).hit, cost: r.cost || 0, chars: j.prompt.length };
});
writeFileSync(`corpus/${variants.join('+')}-K${Karg}-${Date.now()}.json`, JSON.stringify(res));
for (const v of variants) {
  const rs = res.filter(r => r.v === v);
  const hits = rs.filter(r => r.hit).length;
  const chars = rs.reduce((n, r) => n + r.chars, 0) / rs.length;
  console.log(`${v.padEnd(14)} ${hits}/${rs.length} (${(hits / rs.length * 100).toFixed(1)}%)  mean chars ${Math.round(chars)}  cost $${rs.reduce((n, r) => n + r.cost, 0).toFixed(2)}`);
}
