// LIN-3156: merge the in-session readers' consequence batches (data/survey/coding/codes-batch*.json) into the committed docs/papers/harbour/which-rules-pay-codes.json, validating every rule id, effect and ticket against the census and the population.
// Usage: node scripts/survey-rules-codes.mjs [timeline=data/survey/rules-timeline.json] [--coding data/survey/coding]
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { DISTINCT } from './survey-rules-census.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const dir = opt('--coding', 'data/survey/coding');
const tl = JSON.parse(readFileSync(argv[0] || 'data/survey/rules-timeline.json', 'utf8'));
const RULES = new Set([...DISTINCT.map((d) => d.id), 'general-judgement']);
const EFFECTS = new Set(['prod', 'tests', 'docs-wording', 'tooling', 'follow-up', 'nothing']);

const byId = new Map();
for (const f of readdirSync(dir).filter((f) => /^codes-batch\d+\.json$/.test(f)).sort()) {
  for (const t of JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).tickets) {
    for (const k of t.consequences) {
      k.rules = (k.rules || []).map((r) => (r === 'general' ? 'general-judgement' : r));
      if (!k.rules.length) throw new Error(`${t.id}: consequence with no rule`);
      for (const r of k.rules) if (!RULES.has(r)) throw new Error(`${t.id}: unknown rule ${r}`);
      if (!EFFECTS.has(k.effect)) throw new Error(`${t.id}: unknown effect ${k.effect}`);
      k.realFault = k.effect === 'prod' && !!k.realFault; // a real fault is fixed in production code by definition
    }
    byId.set(t.id, { id: t.id, consequences: t.consequences, unattributed: t.unattributed || [], note: t.note || null });
  }
}
const active = tl.population.filter((t) => t.active).map((t) => t.id);
const missing = active.filter((id) => !byId.has(id));
if (missing.length) throw new Error(`active population tickets not coded: ${missing.join(', ')}`);
const tickets = active.map((id) => byId.get(id));
const rubric = readFileSync(`${dir}/RUBRIC.md`, 'utf8');
writeFileSync('docs/papers/harbour/which-rules-pay-codes.json', `${JSON.stringify({
  ticket: 'LIN-3156', codedAt: '2026-09-30',
  population: `The ${active.length} of the last ${tl.population.length} Done tickets that went through code review (scripts/survey-rules-timeline.mjs) with a commit authored after the first review, a send-back verdict or a close-out hold. The other ${tl.population.length - active.length} are coded "changed nothing downstream" by the script without reading.`,
  method: 'Each ticket\'s digest (every review, close-out and implementation comment from the first code review on, interleaved with every commit naming the ticket in either repo) read by one of ten in-session subagents of the frontier tier, one batch each, against the rubric below, fixed before reading; the Clarifications were added after the first four batches and applied to them by the author. Not second-read.',
  rubric, tickets,
}, null, 1)}\n`);
console.log(`wrote ${tickets.length} tickets, ${tickets.reduce((s, t) => s + t.consequences.length, 0)} consequences`);
