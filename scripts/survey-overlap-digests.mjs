// LIN-3179: write the blind coders' reading digests: per sub-sampled census ticket, each step's first-round text cut into numbered units; per coded real review fault or real plan-review find, the finding beside the research and plan written before it.
// Usage: node scripts/survey-overlap-digests.mjs [--every 3] [--offset 0] [--cap 12] [--out data/survey-overlap/digests]
// The sub-sample is every 3rd census ticket by number, from the first, fixed before any digest was read. Units are survey-overlap-lib.mjs's
// (paragraphs and list items of 8+ content words); an artefact with more than --cap units shows every k-th, from the first, so each reader codes
// the same units. A step's first round is the comments of its first session on the ticket (by transcript), else its first comment by heading.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { attribute, units, splitDescription } from './survey-overlap-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const every = +arg('--every', 3); const offset = +arg('--offset', 0); const cap = +arg('--cap', 12); // --offset 1 gave survey-check-8's fresh sample (LIN-3184)
const outDir = arg('--out', 'data/survey-overlap/digests');
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sessions = J('data/survey-overlap/transcripts.json').sessions;
const D = J('data/survey-overlap/proxy.json').details;
const sel = J('data/survey-overlap/select.json');
const num = (id) => +id.split('-')[1];
mkdirSync(outDir, { recursive: true });

const post = new Map(); // commentId -> {kind, session}
for (const s of sessions) for (const p of s.posts) if (p.commentId) post.set(p.commentId, { kind: p.kind || s.tasks[0]?.kind || s.header, session: s.file });
const labelled = (id) => (D[id]?.comments || []).map((c) => ({ ...c, ...attribute(c, post.get(c.id)?.kind), session: post.get(c.id)?.session || null }));
const firstRound = (cs, step) => { const xs = cs.filter((c) => c.step === step); if (!xs.length) return []; const s0 = xs[0].session; return s0 ? xs.filter((c) => c.session === s0) : [xs[0]]; };
const pick = (us) => { if (us.length <= cap) return us.map((u, i) => [i, u]); const k = Math.ceil(us.length / cap); return us.map((u, i) => [i, u]).filter(([i]) => i % k === 0); };
const block = (tag, cs, descPart) => {
  if (descPart && descPart.trim()) cs = [{ createdAt: 'description section (as it stands now)', body: descPart }, ...cs];
  if (!cs.length) return { text: `(no ${tag} text on this ticket)`, units: [] };
  const body = cs.map((c) => `[${c.createdAt}]\n${c.body}`).join('\n\n---\n\n');
  const us = pick(units(cs.map((c) => c.body).join('\n\n'))).map(([i, u], j) => ({ id: `${tag}${j + 1}`, unit: i, text: u }));
  return { text: body, units: us };
};

// ---- Overlap and use digests.
const sub = [...sel.census].sort((a, b) => num(a) - num(b)).filter((_, i) => i % every === offset).filter((id) => D[id]);
const index = [];
sub.forEach((id, n) => {
  const cs = labelled(id); const d = D[id];
  const parts = splitDescription(d.description);
  const R = block('R', firstRound(cs, 'research'), parts.research); const P = block('P', firstRound(cs, 'plan'), parts.plan); const V = block('V', firstRound(cs, 'plan-review'));
  const I = block('I', cs.filter((c) => c.step === 'implementation'));
  const md = [`# Digest O${String(n + 1).padStart(2, '0')} — ${id}: ${d.title}`, '', '## Ticket description as filed (the sections no step heading claims; later steps may have edited it)', '', parts.description.slice(0, 12000),
    '', '## Research (its description section, then its first-round comments)', '', R.text, '', '## Plan (its description section, which is the latest revision, then the first plan session\'s comments)', '', P.text, '', '## Plan review (first round)', '', V.text, '', '## Implementation (the implementer\'s comments)', '', I.text,
    '', '## Units to code', '', ...[['R', R], ['P', P], ['V', V], ['I', I]].flatMap(([t, b]) => [`### ${t} units`, ...b.units.map((u) => `- **${u.id}**: ${u.text.slice(0, 700)}`), ''])].join('\n');
  writeFileSync(join(outDir, `O${String(n + 1).padStart(2, '0')}.md`), md);
  index.push({ digest: `O${String(n + 1).padStart(2, '0')}`, issue: id, units: { R: R.units.length, P: P.units.length, V: V.units.length, I: I.units.length } });
});

// ---- Value digests: one per ticket, listing its coded real faults or real plan-review finds, with the research and plan written before the first.
const rules = J('docs/papers/harbour/which-rules-pay-codes.json').tickets.filter((t) => t.consequences.some((c) => c.realFault));
const legs = [...J('docs/papers/harbour/why-legs-repeat-codes.json').final.map((r) => ({ ...r, src: 'why-legs-repeat' })), ...J('docs/papers/harbour/survey-check-6-codes.json').final.map((r) => ({ ...r, src: 'survey-check-6' }))].filter((r) => r.kind === 'plan-review' && r.real === 'yes');
let v = 0;
const valueDigest = (id, findings, cutoff) => {
  const d = D[id]; if (!d) return;
  const cs = labelled(id).filter((c) => !cutoff || c.createdAt < cutoff);
  const R = cs.filter((c) => c.step === 'research'); const P = cs.filter((c) => c.step === 'plan');
  v++; const tag = `V${String(v).padStart(2, '0')}`;
  const parts = splitDescription(d.description);
  const md = [`# Digest ${tag} — ${id}: ${d.title}`, '', '## Findings to code', '', ...findings.map((f) => `- **${f.id}**: ${f.text}`), '', '## Ticket description as filed (the sections no step heading claims)', '', parts.description.slice(0, 10000),
    '', '## Research and plan sections of the description, AS THEY STAND NOW', '', 'These may have been rewritten after the finding. Do not count text that reads as a response to it (a revision note, "addresses F2", a fix described after the fact); say in `quoteSource` whether your quote is from here (`description-now`) or from a comment below (`comment`).', '', parts.research.slice(0, 8000), '', parts.plan.slice(0, 10000),
    '', `## Research written before the finding (${R.length} comment(s))`, '', R.map((c) => `[${c.createdAt}]\n${c.body}`).join('\n\n---\n\n') || '(none)', '', `## Plan written before the finding (${P.length} comment(s))`, '', P.map((c) => `[${c.createdAt}]\n${c.body}`).join('\n\n---\n\n') || '(none)'].join('\n');
  writeFileSync(join(outDir, `${tag}.md`), md);
  index.push({ digest: tag, issue: id, findings: findings.map((f) => f.id), research: R.length, plan: P.length });
};
for (const t of rules) {
  const cs = D[t.id]?.comments || [];
  const fs = t.consequences.map((c, i) => ({ ...c, i })).filter((c) => c.realFault).map((c) => ({ id: `${t.id}#f${c.i}`, text: `${c.finding} (raised in comment ${c.comment}, ${c.leg})`, at: cs[c.comment]?.createdAt }));
  valueDigest(t.id, fs, fs.map((f) => f.at).filter(Boolean).sort()[0] || null);
}
for (const [id, rs] of Object.entries(legs.reduce((m, r) => ((m[r.issue] ||= []).push(r), m), {}))) {
  // The plan-review comment the repeat leg wrote: the first comment headed as a plan-review after the leg's launch.
  const cs = labelled(id); const fs = [];
  for (const r of rs) { const c = cs.find((x) => x.step === 'plan-review' && x.createdAt > r.at); fs.push({ id: `${id}@${r.at.slice(0, 16)}`, text: c ? `The plan-review round launched ${r.at} (${r.src}, digest ${r.digest}) raised something real and new. Its comment [${c.createdAt}]:\n\n${c.body.slice(0, 6000)}` : `The plan-review round launched ${r.at} (comment not found)`, at: c?.createdAt || r.at }); }
  valueDigest(id, fs, fs.map((f) => f.at).sort()[0]);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ every, offset, cap, index }, null, 1));
console.log(`overlap digests ${sub.length} (units ${index.filter((x) => x.units).reduce((a, x) => a + x.units.R + x.units.P + x.units.V + x.units.I, 0)}); value digests ${v}`);
