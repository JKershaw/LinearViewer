// LIN-3191 (survey-check-11): re-derives this check's own tables from session transcripts.
//   1. The randomised frontier-tier re-judgement of LIN-3189's 13 pairs: reads each "[check11 LIN-n rejudge]" reader's last
//      JUDGEMENT line, maps it through the A/B key in survey-check-11-codes.json, and compares it with LIN-3189's first blind read.
//   2. The hindsight-free replays: lean weighted tokens per ticket for "[check11-hfree LIN-n role]" roles against LIN-3189's
//      "[replay LIN-n role]" roles, weighted exactly as survey-replay-cost.mjs weights them, and each hindsight-free blind verdict.
// Usage: node scripts/survey-check-11.mjs --subagents <this check's subagents dir> --orig-subagents <LIN-3189's subagents dir>
// Read-only. No proxy calls.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const mine = arg('--subagents'), orig = arg('--orig-subagents');
if (!mine || !orig) throw new Error('--subagents and --orig-subagents are required');
const codes = JSON.parse(readFileSync(new URL('../docs/papers/harbour/survey-check-11-codes.json', import.meta.url), 'utf8'));

// survey-costmix-tokens.mjs's weights: frontier-input equivalents; frontier ×1, mid ×0.6, cheap ×0.2.
const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const unitsOf = (u, m) => { const w = tier(m); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return w * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };

function agents(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const u = lines.find((o) => o.type === 'user'); if (!u) continue;
    const c = typeof u.message.content === 'string' ? u.message.content : u.message.content.map((x) => x.text || '').join(' ');
    const m = c.match(/^\[(check11|check11-hfree|replay) (LIN-\d+) ([a-z0-9-]+)\]/); if (!m) continue;
    const msgs = new Map(); let text = '';
    for (const o of lines) if (o.type === 'assistant' && o.message?.id) {
      if (o.message.usage) msgs.set(o.message.id, unitsOf(o.message.usage, o.message.model));
      for (const x of o.message.content || []) if (x.type === 'text') text = x.text;
    }
    const j = [...text.matchAll(/JUDGEMENT: (A BETTER|B BETTER|EQUIVALENT)/g)].pop()?.[1] ?? null;
    out.push({ run: m[1], id: m[2], role: m[3], units: [...msgs.values()].reduce((a, b) => a + b, 0), turns: msgs.size, judgement: j, t0: lines.find((o) => o.timestamp)?.timestamp });
  }
  return out;
}
const asReplay = (j, origIs) => (j === 'EQUIVALENT' ? 'equivalent' : j == null ? null : (j[0] === origIs ? 'worse' : 'better'));
const A = [...agents(mine), ...agents(orig)];

console.log('## Re-judgement (randomised A/B, frontier tier) against LIN-3189\'s first blind read');
let agree = 0, n = 0;
for (const [id, k] of Object.entries(codes.rejudge.key)) {
  // the last completed reader for the ticket (a stopped reader leaves no JUDGEMENT line)
  const mineR = A.filter((a) => a.run === 'check11' && a.id === id && a.role === 'rejudge' && a.judgement).sort((x, y) => (x.t0 < y.t0 ? -1 : 1)).pop();
  const first = A.filter((a) => a.run === 'replay' && a.id === id && a.role === 'blind' && a.judgement).sort((x, y) => (x.t0 < y.t0 ? -1 : 1)).pop();
  const origFirst = Number(id.slice(4)) % 2 ? 'A' : 'B';
  const now = asReplay(mineR?.judgement, k.origNow), then = asReplay(first?.judgement, origFirst);
  if (now && then) { n++; if (now === then) agree++; }
  console.log(`${id}  original was ${k.origNow}  re-judged ${now ?? '–'}  LIN-3189 ${then ?? '–'}${now && then && now !== then ? '  (moved)' : ''}`);
}
console.log(`agree ${agree} of ${n}`);

console.log('\n## Hindsight-free replays: lean weighted tokens (implementer + reviewer + close-out) against LIN-3189\'s replay');
for (const [id, h] of Object.entries(codes.hindsightFree.tickets)) {
  const sum = (run) => A.filter((a) => a.run === run && a.id === id && ['implementer', 'reviewer', 'close-out'].includes(a.role)).reduce((s, a) => ({ u: s.u + a.units, t: s.t + a.turns }), { u: 0, t: 0 });
  const hf = sum('check11-hfree'), rp = sum('replay');
  const blind = A.filter((a) => a.run === 'check11-hfree' && a.id === id && a.role === 'blind' && a.judgement).pop();
  console.log(`${id}  replay ${Math.round(rp.u / 1000)}k (${rp.t} turns)  hindsight-free ${Math.round(hf.u / 1000)}k (${hf.t} turns)  ×${(hf.u / rp.u).toFixed(2)}  blind: ${asReplay(blind?.judgement, h.blindOrigIs) ?? '–'}`);
}
