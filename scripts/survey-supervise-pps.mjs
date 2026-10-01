// LIN-3154: draw a fresh sample of supervisor steps with probability proportional to weighted tokens, for a blind recode.
// Usage: node scripts/survey-supervise-pps.mjs [--n 160] [--start 0.37] [--dir data/survey-supervise] [--out data/survey-supervise/pps]
// Systematic PPS over the census ordered by session start then step, skipping the 220 steps what-supervisors-do-codes.json already
// coded (a hit moves to the session's next step). The share of sampled steps coded M then estimates the token-weighted mechanical
// share directly, without rule classes or layer weights. Cards are built exactly as survey-supervise-sample.mjs builds them.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-supervise'); const out = arg('--out', join(dir, 'pps')); const N = +arg('--n', 160); const START = +arg('--start', 0.37);
mkdirSync(out, { recursive: true });
const steps = readFileSync(join(dir, 'steps.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sessions = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'));
const start = Object.fromEntries(sessions.map((s) => [s.id, s.first]));
const prior = new Set(JSON.parse(readFileSync('docs/papers/harbour/what-supervisors-do-codes.json', 'utf8')).codes.map((c) => c.id));
const cl = (x = '') => x.replace(/cd \/\S+ && /g, '').replace(/\/private\/tmp\/claude-503\/\S+?scratchpad/g, '$SP').replace(/"?\$HARBOUR_LOCAL_BASE\/api\/proxy/g, 'P').replace(/[ \t]+/g, ' ');
const idx = new Map(steps.map((s, i) => [s.session + ':' + s.n, i]));
const order = steps.map((s, i) => i).sort((a, b) => { const A = steps[a], B = steps[b]; return start[A.session] < start[B.session] ? -1 : start[A.session] > start[B.session] ? 1 : A.session < B.session ? -1 : A.session > B.session ? 1 : A.n - B.n; });
const total = order.reduce((t, i) => t + steps[i].units, 0); const k = total / N;
let next = START * k, cum = 0; const picked = [];
for (const i of order) { cum += steps[i].units; while (cum >= next && next < total) { picked.push(i); next += k; } }
let dup = 0, replaced = 0; const seen = new Set(); const final = [];
for (let i of picked) { let s = steps[i]; let j = i; // if already in the paper's sample or already picked, move to the next step of the same session
  while ((prior.has(steps[j].session + ':' + steps[j].n) || seen.has(j)) && steps[j + 1] && steps[j + 1].session === s.session) { j++; replaced++; }
  if (seen.has(j) || prior.has(steps[j].session + ':' + steps[j].n)) { dup++; continue; }
  seen.add(j); final.push(j); }
const cards = final.map((j) => { const s = steps[j];
  const before = [steps[j - 2], steps[j - 1]].filter((p) => p && p.session === s.session).map((p) => `  [step ${p.n}] ${p.tools.map((t) => t.name + ': ' + cl(t.input).slice(0, 160)).join(' | ')}${p.text ? ' TEXT: ' + cl(p.text).slice(0, 200) : ''}`).join('\n');
  const trig = [...steps.slice(Math.max(0, j - 12), j + 1)].reverse().find((p) => p.session === s.session && p.trigger)?.trigger;
  return { id: `${s.session}:${s.n}`, layer: s.layer, units: s.units, card: [
    `ID ${s.session}:${s.n}  layer=${s.layer}  issue=${s.issue}  ${s.t}${s.preTask ? '  (before the task prompt arrived)' : ''}`,
    `LAST MESSAGE INTO THE SESSION (may be a few steps back): ${cl(trig || '(none in view)').slice(0, 260)}`,
    `TWO STEPS BEFORE:\n${before || '  (none)'}`,
    `THIS STEP'S TOOL CALLS:\n${s.tools.map((t) => '  ' + t.name + ': ' + cl(t.input).slice(0, 600)).join('\n') || '  (none)'}`,
    `THIS STEP'S TEXT: ${cl(s.text).slice(0, 700) || '(none)'}`,
    `START OF ITS TOOL RESULTS: ${cl(s.results.join(' || ')).slice(0, 300) || '(none)'}${s.errors ? `  [${s.errors} tool error(s)]` : ''}`,
  ].join('\n') }; });
writeFileSync(join(out, 'pps-sample.json'), JSON.stringify(cards, null, 1));
writeFileSync(join(out, 'cards-fwd.txt'), cards.map((c) => c.card).join('\n\n==========\n\n'));
writeFileSync(join(out, 'cards-rev.txt'), [...cards].reverse().map((c) => c.card).join('\n\n==========\n\n'));
const by = {}; for (const c of cards) by[c.layer] = (by[c.layer] || 0) + 1;
console.log({ drawn: picked.length, cards: cards.length, replaced, dropped: dup, byLayer: by, totalUnits: Math.round(total) });
