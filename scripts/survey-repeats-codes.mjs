// LIN-3174: merge the two blind readers' codes of the sampled repeat legs, and the adjudication of every field they disagreed on, into docs/papers/harbour/why-legs-repeat-codes.json.
// Usage: node scripts/survey-repeats-codes.mjs [--dir data/survey-repeats] [--out docs/papers/harbour/why-legs-repeat-codes.json]
// Reads the rubric (rubric.md), the sample (sample.json), reader A's codes-A1.json + codes-A2.json, reader B's codes-B1.json +
// codes-B2.json, and adjudication.json ({ "<digest>": { "<field>": "<value>", "why": "..." } }) when present. A field both readers
// coded alike is final as coded; a disagreement takes the adjudicated value, or stays "unresolved" when none was recorded.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-repeats');
const out = arg('--out', 'docs/papers/harbour/why-legs-repeat-codes.json');
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const sample = read('sample.json');
const reader = (a, b) => [...read(a), ...read(b)].map((c) => ({ ...c, digest: String(c.digest).padStart(2, '0') })).sort((x, y) => x.digest.localeCompare(y.digest));
const A = reader('codes-A1.json', 'codes-A2.json'); const B = reader('codes-B1.json', 'codes-B2.json');
const adj = existsSync(join(dir, 'adjudication.json')) ? read('adjudication.json') : {};
const FIELDS = ['reason', 'bought', 'newFinding', 'real'];
const a = new Map(A.map((c) => [c.digest, c])); const b = new Map(B.map((c) => [c.digest, c]));
const final = sample.legs.map((l, i) => {
  const d = String(i + 1).padStart(2, '0'); const x = a.get(d), y = b.get(d);
  const f = { digest: d, issue: l.issue, kind: l.kind, round: l.round, at: l.at, item: l.item.slice(0, 8), repo: l.repo };
  const disagreed = [];
  for (const k of FIELDS) { if (x?.[k] === y?.[k]) f[k] = x[k]; else { disagreed.push(k); f[k] = adj[d]?.[k] ?? 'unresolved'; } }
  if (disagreed.length) { f.disagreed = disagreed; if (adj[d]?.why) f.adjudication = adj[d].why; }
  return f;
});
const codes = {
  ticket: 'LIN-3174', codedAt: new Date().toISOString().slice(0, 10),
  method: `A systematic sample of ${sample.legs.length} of the census's ${sample.repeats} repeat legs: every ${sample.k}th by launch time from the ${sample.start + 1}th (scripts/survey-repeats-sample.mjs). Each was read from a digest (scripts/survey-repeats-digests.mjs) by two readers, A and B, each an in-session subagent of the frontier tier split across two sessions of 32 digests, against the rubric below, fixed before any digest was read. Neither saw the other's codes; B read in reverse order. Disagreements were adjudicated by the author from the digest, with both codes in view; the reason is recorded.`,
  rubric: readFileSync(join(dir, 'rubric.md'), 'utf8'),
  readers: { A, B }, final,
};
writeFileSync(out, JSON.stringify(codes, null, 1) + '\n');
const dis = final.filter((f) => f.disagreed); const unresolved = final.filter((f) => FIELDS.some((k) => f[k] === 'unresolved'));
console.log(`coded=${final.length} A=${A.length} B=${B.length} withDisagreement=${dis.length} unresolved=${unresolved.length}`);
for (const k of FIELDS) console.log(k, 'disagree', final.filter((f) => f.disagreed?.includes(k)).map((f) => `${f.digest}:${a.get(f.digest)?.[k]}/${b.get(f.digest)?.[k]}`).join(' '));
