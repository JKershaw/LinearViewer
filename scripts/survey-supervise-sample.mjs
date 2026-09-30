// LIN-3150: draw the systematic sample of supervisor steps that two coders hand-code blind (class, and mechanical or judgement), as readable cards.
// Usage: node scripts/survey-supervise-sample.mjs [--per 50] [--wake 20] [--dir data/survey-supervise]
// Per layer, steps are ordered by session start then step number and every k-th is taken from a fixed offset (k = floor(n / per), offset floor(k/2)).
// Each card shows what woke the step, the two steps before it, its tool calls, its text and the start of its tool results. No rule class is shown.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const per = +arg('--per', 50); const perWake = +arg('--wake', 20); const dir = arg('--dir', 'data/survey-supervise');
const steps = readFileSync(join(dir, 'steps.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sessions = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'));
const start = Object.fromEntries(sessions.map((s) => [s.id, s.first]));
const cl = (x = '') => x.replace(/cd \/\S+ && /g, '').replace(/\/private\/tmp\/claude-503\/\S+?scratchpad/g, '$SP').replace(/"?\$HARBOUR_LOCAL_BASE\/api\/proxy/g, 'P').replace(/[ \t]+/g, ' ');
const idx = new Map(steps.map((s, i) => [s.session + ':' + s.n, i]));

const cards = [];
for (const [layer, n] of [['Runner', per], ['leg', per], ['stepper', per], ['autopilot', per], ['wake', perWake]]) {
  const pool = steps.filter((s) => s.layer === layer).sort((a, b) => (start[a.session] < start[b.session] ? -1 : start[a.session] > start[b.session] ? 1 : a.n - b.n));
  const k = Math.max(1, Math.floor(pool.length / n));
  for (let i = Math.floor(k / 2); i < pool.length && cards.filter((c) => c.layer === layer).length < n; i += k) {
    const s = pool[i]; const j = idx.get(s.session + ':' + s.n);
    const before = [steps[j - 2], steps[j - 1]].filter((p) => p && p.session === s.session).map((p) => `  [step ${p.n}] ${p.tools.map((t) => t.name + ': ' + cl(t.input).slice(0, 160)).join(' | ')}${p.text ? ' TEXT: ' + cl(p.text).slice(0, 200) : ''}`).join('\n');
    const trig = [...steps.slice(Math.max(0, j - 12), j + 1)].reverse().find((p) => p.session === s.session && p.trigger)?.trigger;
    cards.push({ id: `${s.session}:${s.n}`, layer, card: [
      `ID ${s.session}:${s.n}  layer=${layer}  issue=${s.issue}  ${s.t}${s.preTask ? '  (before the task prompt arrived)' : ''}`,
      `LAST MESSAGE INTO THE SESSION (may be a few steps back): ${cl(trig || '(none in view)').slice(0, 260)}`,
      `TWO STEPS BEFORE:\n${before || '  (none)'}`,
      `THIS STEP'S TOOL CALLS:\n${s.tools.map((t) => '  ' + t.name + ': ' + cl(t.input).slice(0, 600)).join('\n') || '  (none)'}`,
      `THIS STEP'S TEXT: ${cl(s.text).slice(0, 700) || '(none)'}`,
      `START OF ITS TOOL RESULTS: ${cl(s.results.join(' || ')).slice(0, 300) || '(none)'}${s.errors ? `  [${s.errors} tool error(s)]` : ''}`,
    ].join('\n') });
  }
}
writeFileSync(join(dir, 'sample.json'), JSON.stringify(cards, null, 1));
const half = Math.ceil(cards.length / 2);
for (const [h, part] of [['a', cards.slice(0, half)], ['b', cards.slice(half)]]) writeFileSync(join(dir, `cards-${h}.txt`), part.map((c) => c.card).join('\n\n==========\n\n'));
console.log(`sample ${cards.length} steps:`, Object.fromEntries(['Runner', 'leg', 'stepper', 'autopilot', 'wake'].map((l) => [l, cards.filter((c) => c.layer === l).length])));
