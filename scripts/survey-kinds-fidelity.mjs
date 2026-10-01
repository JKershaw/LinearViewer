// LIN-3207: what the recommender's written prompt keeps, drops and adds against the handwritten template of the same kind, by size and by the template's own headings and gate markers, from the survey-kinds transcript snapshot.
// Usage: node scripts/survey-kinds-fidelity.mjs [--dir data/survey-kinds] [--kinds plan,plan-review,implementation,review,close-out,research]
// Sample: every September item a transcript fetched whose enqueue was a recommend-and-dispatch, split by the response's
// "override" flag. An override item's body is the handwritten template's generate() output (routes/proxy-dispatch.js); a
// recommender item's body is the one the meta-prompt call wrote, plus the grounding sections appended after it. A template
// heading is a "## " or "### " line present in at least 80% of that kind's override items; a heading's text after a colon or
// an issue id is cut so per-ticket titles compare. Markers are the gate phrases the decision tree routes on. No proxy calls.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-kinds');
const kinds = arg('--kinds', 'plan,plan-review,implementation,review,close-out,research').split(',');
const T = JSON.parse(readFileSync(join(dir, 'transcripts.json'), 'utf8'));
const MARKERS = { 'Session fit': /Session[- ]fit/i, verdict: /Request Changes|\bApprove\b/, regression: /regression/i, mutation: /mutant|mutation/i, 're-ground': /re-?ground/i, 'Plan Review Verdict': /Plan Review Verdict/i, 'What CI Did Not Prove': /What CI Did Not Prove/i,
  ledger: /\bledger\b/i, 'Principle 0': /Principle 0/i, 'Scale to the task': /Scale to (the )?task/i, 'completion signal': /\[(done|failed|blocked)\]/i,
  'acceptance / success criteria': /success criteria|acceptance criteria/i, 'git log / prior work': /git log/i };
const norm = (h) => h.replace(/^#+\s*/, '').replace(/[A-Z]+-\d+.*$/, '').replace(/:.*$/, '').replace(/[*`]/g, '').trim().toLowerCase();
const heads = (p) => new Set((p.match(/^#{2,3} .+$/gm) || []).map(norm).filter(Boolean));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

const rows = [];
for (const e of T.enqueues) {
  if (!e.ok || e.error || e.ep !== 'recommend-and-dispatch' || e.at < '2026-09-01') continue;
  const f = T.items[e.id]; if (!f?.prompt) continue;
  rows.push({ kind: e.kind, arm: e.override ? 'template' : 'written', prompt: f.prompt, issue: e.issue });
}
const out = {};
for (const k of kinds) {
  const tpl = rows.filter((r) => r.kind === k && r.arm === 'template'); const wr = rows.filter((r) => r.kind === k && r.arm === 'written');
  if (!tpl.length || !wr.length) { out[k] = { template: tpl.length, written: wr.length }; continue; }
  const count = new Map(); for (const r of tpl) for (const h of heads(r.prompt)) count.set(h, (count.get(h) || 0) + 1);
  const tplHeads = [...count].filter(([, n]) => n >= 0.8 * tpl.length).map(([h]) => h);
  const keep = tplHeads.map((h) => [h, wr.filter((r) => heads(r.prompt).has(h)).length / wr.length]);
  const addCount = new Map(); for (const r of wr) for (const h of heads(r.prompt)) if (!tplHeads.includes(h)) addCount.set(h, (addCount.get(h) || 0) + 1);
  const added = [...addCount].filter(([, n]) => n >= 0.5 * wr.length).map(([h, n]) => [h, n / wr.length]);
  const markers = Object.fromEntries(Object.entries(MARKERS).map(([m, re]) => [m, { template: tpl.filter((r) => re.test(r.prompt)).length / tpl.length, written: wr.filter((r) => re.test(r.prompt)).length / wr.length }]));
  out[k] = { template: tpl.length, written: wr.length, medChars: { template: med(tpl.map((r) => r.prompt.length)), written: med(wr.map((r) => r.prompt.length)) },
    templateHeadings: tplHeads.length, keptShare: keep.reduce((s, [, x]) => s + x, 0) / (keep.length || 1), dropped: keep.filter(([, x]) => x < 0.5).map(([h, x]) => `${h} (${Math.round(x * 100)}%)`),
    added: added.map(([h, x]) => `${h} (${Math.round(x * 100)}%)`), markers };
}
writeFileSync(join(dir, 'fidelity.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) {
  console.log(`\n${k}: template n=${v.template}, written n=${v.written}` + (v.medChars ? `, median chars ${v.medChars.template} vs ${v.medChars.written}; template headings ${v.templateHeadings}, mean kept ${(v.keptShare * 100).toFixed(0)}%` : ''));
  if (!v.medChars) continue;
  console.log('  dropped (<50% of written):', v.dropped.join('; '));
  console.log('  added (≥50% of written):', v.added.join('; '));
  console.log('  markers template→written:', Object.entries(v.markers).map(([m, x]) => `${m} ${Math.round(x.template * 100)}→${Math.round(x.written * 100)}%`).join('; '));
}
