// LIN-3175: merge the check's two blind readers' codes of the fresh sample (survey-check-6-sample.mjs) with the checker's
// adjudication, write them to docs/papers/harbour/survey-check-6-codes.json, and set them beside why-legs-repeat.md's 64.
// Usage: node scripts/survey-check-6-codes.mjs [--dir data/check6] [--out docs/papers/harbour/survey-check-6-codes.json]
// Reads <dir>/sample.json, <dir>/codes/A1..A5.json and B1..B5.json (A read 01-80 in order, B in reverse), and <dir>/adjudication.json
// ({ "<digest>": { "<field>": "<value>", "why": "..." } }) when present; the paper's rubric (data/survey-repeats/rubric.md) plus one
// field, `ruling`. Agreement is Cohen's kappa; intervals are Wilson 95%. Offline.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/check6');
const out = arg('--out', 'docs/papers/harbour/survey-check-6-codes.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sample = read(join(dir, 'sample.json'));
const pad = (d) => String(d).padStart(2, '0');
const reader = (r) => [1, 2, 3, 4, 5].flatMap((i) => read(join(dir, 'codes', `${r}${i}.json`))).map((c) => ({ ...c, digest: pad(c.digest) }));
const A = new Map(reader('A').map((c) => [c.digest, c])); const B = new Map(reader('B').map((c) => [c.digest, c]));
const adj = existsSync(join(dir, 'adjudication.json')) ? read(join(dir, 'adjudication.json')) : {};
const FIELDS = ['reason', 'bought', 'newFinding', 'real', 'ruling'];
const LEGS = ['plan', 'plan-review', 'review', 'close-out'];
const tally = (xs, f) => { const m = {}; for (const x of xs) { const k = f(x); m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [+(100 * (c - h)).toFixed(0), +(100 * (c + h)).toFixed(0)]; };
const share = (k, n) => ({ k, n, pct: n ? +(100 * k / n).toFixed(0) : null, ci: wilson(k, n) });

const final = sample.legs.map((l, i) => {
  const d = pad(i + 1); const x = A.get(d), y = B.get(d);
  const f = { digest: d, issue: l.issue, kind: l.kind, kindHow: l.kindHow, round: l.round, at: l.at, item: l.item.slice(0, 8), repo: l.repo };
  const disagreed = [];
  for (const k of FIELDS) { if (x?.[k] === y?.[k]) f[k] = x?.[k] ?? 'missing'; else { disagreed.push(k); f[k] = adj[d]?.[k] ?? 'unresolved'; } }
  if (disagreed.length) { f.disagreed = disagreed; if (adj[d]?.why) f.adjudication = adj[d].why; }
  return f;
});
function kappa(field, filter = () => true) {
  const ds = final.filter(filter).map((c) => c.digest).filter((d) => A.has(d) && B.has(d));
  const cats = [...new Set(ds.flatMap((d) => [A.get(d)[field], B.get(d)[field]]))];
  const n = ds.length; const agree = ds.filter((d) => A.get(d)[field] === B.get(d)[field]).length; const po = agree / n;
  const pe = cats.reduce((a, c) => a + (ds.filter((d) => A.get(d)[field] === c).length / n) * (ds.filter((d) => B.get(d)[field] === c).length / n), 0);
  return { n, agree, kappa: pe === 1 ? 1 : +((po - pe) / (1 - pe)).toFixed(2) };
}
const gate = (c) => ['plan-review', 'review'].includes(c.kind);
const res = { n: final.length, tickets: new Set(final.map((c) => c.issue)).size, byKind: tally(final, (c) => c.kind), byMonth: tally(final, (c) => c.at.slice(0, 7)) };
res.agreement = { reason: kappa('reason'), bought: kappa('bought'), newFinding: kappa('newFinding', gate), real: kappa('real', gate), ruling: kappa('ruling') };
res.unresolved = final.filter((f) => FIELDS.some((k) => f[k] === 'unresolved')).map((f) => f.digest);
res.disagreements = final.filter((f) => f.disagreed).map((f) => `${f.digest} ${f.kind}: ${f.disagreed.map((k) => `${k} ${A.get(f.digest)?.[k]}/${B.get(f.digest)?.[k]}`).join(', ')}`);

const summarise = (cs) => {
  const real = cs.filter((c) => !['other', 'unclear'].includes(c.reason));
  const g = (k) => { const xs = real.filter((c) => c.kind === k); return { n: xs.length, newFinding: xs.filter((c) => c.newFinding === 'yes').length, real: xs.filter((c) => c.real === 'yes').length }; };
  return {
    n: cs.length, reasons: tally(cs, (c) => c.reason), reasonsByKind: Object.fromEntries(LEGS.map((k) => [k, tally(cs.filter((c) => c.kind === k), (c) => c.reason)])),
    realN: real.length, changesRequestedOfReal: share(real.filter((c) => c.reason === 'changes-requested').length, real.length),
    boughtByKind: Object.fromEntries(LEGS.map((k) => [k, tally(real.filter((c) => c.kind === k), (c) => c.bought)])),
    planReview: g('plan-review'), review: g('review'),
    ruling: { round2: share(cs.filter((c) => c.round === 2 && c.ruling === 'yes').length, cs.filter((c) => c.round === 2).length), round3plus: share(cs.filter((c) => c.round >= 3 && c.ruling === 'yes').length, cs.filter((c) => c.round >= 3).length) },
    notRealReviews: tally(cs.filter((c) => c.kind === 'review' && ['other', 'unclear'].includes(c.reason)), (c) => `${c.at.slice(0, 7)} ${c.kindHow}`),
    reviewsByMonth: tally(cs.filter((c) => c.kind === 'review'), (c) => `${c.at.slice(0, 7)} ${['other', 'unclear'].includes(c.reason) ? 'not real' : 'real'}`),
  };
};
res.all = summarise(final);
res.byMonth = Object.fromEntries(['2026-08', '2026-09'].map((m) => [m, summarise(final.filter((c) => c.at.startsWith(m)))]));

// The paper's 64 beside this sample, and the two pooled (144 distinct repeats). The paper's codes have no `ruling` field.
const paper = read('docs/papers/harbour/why-legs-repeat-codes.json').final;
res.paper = summarise(paper.map((c) => ({ ...c, ruling: null })));
res.pooled = summarise([...paper.map((c) => ({ ...c, ruling: null })), ...final]);
delete res.pooled.ruling; delete res.paper.ruling;

// Representativeness: the census's repeats by kind and round within each month, against each sample.
const census = read('data/survey-repeats/census.json').legs.filter((l) => l.repeat);
const mix = (xs) => ({ n: xs.length, kind: Object.fromEntries(LEGS.map((k) => [k, +(xs.filter((x) => x.kind === k).length / xs.length).toFixed(2)])), round3plus: +(xs.filter((x) => x.round >= 3).length / xs.length).toFixed(2) });
res.representativeness = Object.fromEntries(['2026-08', '2026-09'].map((m) => [m, { census: mix(census.filter((l) => l.at.startsWith(m))), paperSample: mix(paper.filter((c) => c.at.startsWith(m))), thisSample: mix(final.filter((c) => c.at.startsWith(m))) }]));

const codes = {
  ticket: 'LIN-3175', checks: 'LIN-3174 (why-legs-repeat.md)', codedAt: new Date().toISOString().slice(0, 10),
  method: `A fresh random sample of ${final.length} of the census's ${sample.repeats} repeat legs, none of the paper's 64: ${final.length / 2} from each month, seeded (${sample.seed}), by scripts/survey-check-6-sample.mjs. Digests by the paper's own scripts/survey-repeats-digests.mjs. Two readers, A (digests in order) and B (in reverse), each split across five in-session subagents of the frontier tier with 16 digests, coded against the paper's rubric unchanged plus one field, ruling. Neither saw the other's codes, the paper or its codes. Disagreements were settled by the checker from the digest, with both codes in view; each reason is recorded.`,
  rulingField: 'ruling: did a ruling, decision, authorisation or redirection by a person or by a coordinator/autopilot acting on an escalation come between the previous leg of this kind and this repeat, and allow or direct this round? A gate verdict alone is not a ruling. yes | no | unclear.',
  readers: { A: [...A.values()], B: [...B.values()] }, final, summary: res,
};
writeFileSync(out, JSON.stringify(codes, null, 1) + '\n');
console.log(JSON.stringify(res, null, 1));
