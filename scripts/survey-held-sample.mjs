// LIN-3176: draw a systematic sample of September wakes into held supervisors that acted (wrote, pushed, edited or dispatched) and write one card per wake for blind coding of what the decision used and where each fact lived.
// Usage: node scripts/survey-held-sample.mjs [--per-layer 12] [--projects ~/.claude/projects] [--in data/survey-held/held.jsonl] [--out data/survey-held/cards]
// Population: every delivery into a Runner, leg, stepper or ticket autopilot after its own task arrived, dated 1–30 September, that is
// not the runner's completion gate or resume handshake, and whose outcome (survey-held-extract.mjs) is act or dispatch. Sorted by
// layer then time; every k-th from offset floor(k/2), --per-layer per layer. A card holds the delivered text, every step's text, tool
// calls and results until the next delivery that is not a gate, and the transcript's path, so a coder can search what came before.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const per = +arg('--per-layer', 12);
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const out = arg('--out', 'data/survey-held/cards'); mkdirSync(out, { recursive: true });
const sessions = readFileSync(arg('--in', 'data/survey-held/held.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const LAYERS = ['Runner', 'leg', 'stepper', 'autopilot'];
const pop = [];
for (const s of sessions) {
  if (!LAYERS.includes(s.layer) || s.taskN == null) continue;
  for (const x of s.d) if (x.n > s.taskN && x.at >= '2026-09-01' && x.at < '2026-10-01' && !['completion-gate', 'resume-handshake', 'compaction', 'noise', 'continue'].includes(x.source) && (x.outcome === 'act' || x.outcome === 'dispatch')) pop.push({ s, x });
}
const picked = [];
for (const L of LAYERS) {
  const xs = pop.filter((p) => p.s.layer === L).sort((a, b) => (a.x.at < b.x.at ? -1 : 1)); const k = Math.max(1, Math.floor(xs.length / per));
  for (let i = Math.floor(k / 2); i < xs.length && picked.filter((p) => p.s.layer === L).length < per; i += k) picked.push(xs[i]);
}
const clip = (t, n) => (t.length > n ? t.slice(0, n) + ` …[${t.length - n} more chars]` : t);
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b.text || (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((y) => y.text || '').join('') : '')).join('\n') : '');
const index = [];
picked.forEach(({ s, x }, i) => {
  const path = findTranscript(s.id);
  const lines = readFileSync(path, 'utf8').split('\n');
  const body = []; let started = false; let deliveries = 0;
  for (const line of lines) {
    if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    if (!started) { if (e.type === 'user' && e.timestamp === x.at) started = true; else continue; }
    if (e.type === 'user') {
      const c = e.message?.content; const isResult = Array.isArray(c) && c.some((b) => b.type === 'tool_result');
      if (isResult) { body.push('RESULT: ' + clip(textOf(c), 1500)); continue; }
      const t = textOf(c).trim(); if (!t) continue;
      deliveries++;
      if (deliveries > 1 && !/Before this task is marked complete/.test(t)) break;
      body.push((deliveries === 1 ? 'DELIVERED: ' : 'GATE: ') + clip(t, deliveries === 1 ? 4000 : 300));
      continue;
    }
    if (e.type === 'assistant') for (const b of e.message?.content || []) {
      if (b.type === 'text' && b.text?.trim()) body.push('SAID: ' + clip(b.text.trim(), 1500));
      if (b.type === 'tool_use') body.push(`CALL ${b.name}: ` + clip(String(b.input?.command ?? b.input?.prompt ?? b.input?.file_path ?? JSON.stringify(b.input)), 800));
    }
  }
  const id = `card-${String(i + 1).padStart(2, '0')}`;
  writeFileSync(join(out, `${id}.md`), [`# ${id}`, `layer: ${s.layer}; ticket: ${s.issue}; session: ${s.id}; delivered at: ${x.at}; outcome: ${x.outcome}`, `transcript: ${path} (search the lines before ${x.at} for what the session already knew)`, '', ...body].join('\n\n'));
  index.push({ id, layer: s.layer, issue: s.issue, session: s.id, at: x.at, outcome: x.outcome, source: x.source, wake: x.wake || x.kind || null });
});
writeFileSync(join(out, 'index.json'), JSON.stringify({ population: pop.length, byLayer: Object.fromEntries(LAYERS.map((L) => [L, pop.filter((p) => p.s.layer === L).length])), cards: index }, null, 1));
console.log(`population ${pop.length}; cards ${index.length}`, Object.fromEntries(LAYERS.map((L) => [L, pop.filter((p) => p.s.layer === L).length])));

function findTranscript(id) {
  for (const d of readdirSync(root)) { if (!d.startsWith('-Users-work-development-simple-dispatcher-workspaces-')) continue; const p = join(root, d, id + '.jsonl'); if (existsSync(p)) return p; }
  throw new Error('no transcript for ' + id);
}
