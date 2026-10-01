// LIN-3177: merge both readers' per-ticket codes into the committed codes file, checking every field against the codebook's vocabulary.
// Usage: node scripts/survey-judgement-codes.mjs [--a data/survey-judgement/codes-A] [--b data/survey-judgement/codes-B] [--sample data/survey-judgement/sample.json] [--out docs/papers/harbour/where-judgement-happens-codes.json]
// Reader A coded every sampled ticket; reader B coded a systematic sub-sample of ten (every third-or-fourth of the drawn order),
// blind to A and in reverse order. The codebook is scripts/survey-judgement-codebook.md. An unknown value is reported, not fixed.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const sample = JSON.parse(readFileSync(arg('--sample', 'data/survey-judgement/sample.json'), 'utf8'));
const out = arg('--out', 'docs/papers/harbour/where-judgement-happens-codes.json');
const V = {
  type: ['SB', 'CE', 'SC', 'ES', 'RU', 'RS', 'RP', 'RT', 'MG'],
  role: ['Runner', 'leg', 'stepper', 'autopilot', 'wake', 'research', 'plan', 'plan-review', 'implementation', 'review', 'close-out', 'other-worker', 'John', 'engine', 'code'],
  tier: ['frontier', 'mid', 'cheap', 'human', 'code'],
  effect: ['what-shipped', 'scope', 'sequence', 'timing-only', 'none-in-the-end'],
  class: ['a', 'b', 'c'],
  wtype: ['red-ci', 'conflict', 'stuck', 'bad-report', 'lost-wake', 'failed-session', 'other'],
  cause: ['flake', 'real-fault', 'infra', 'unknown'],
  yn: ['yes', 'no', 'unclear'],
};
const problems = []; const normalised = [];
const read = (dir) => {
  const r = {};
  if (!existsSync(dir)) return r;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const t = j.ticket || f.replace('.json', '');
    // A worker kind the codebook's role list lacks (design, breakdown, blocked, triage) is an other-worker; counted, not dropped.
    for (const d of j.decisions || []) if (!V.role.includes(d.role) && /^(design|breakdown|blocked|triage|bug|custom|spike|scoping)$/.test(d.role)) { normalised.push(`${t} ${d.cycle} ${d.role}`); d.role = 'other-worker'; }
    for (const d of j.decisions || []) for (const [k, list] of [['type', V.type], ['role', V.role], ['tier', V.tier], ['effect', V.effect], ['class', V.class]]) if (!list.includes(d[k])) problems.push(`${dir} ${t} decision ${d.cycle} ${k}=${d[k]}`);
    for (const w of j.wrongTurns || []) {
      if (!V.wtype.includes(w.type)) problems.push(`${dir} ${t} wrongTurn ${w.cycle} type=${w.type}`);
      if (!V.cause.includes(w.cause)) problems.push(`${dir} ${t} wrongTurn ${w.cycle} cause=${w.cause}`);
      if (!V.yn.includes(w.freshSession)) problems.push(`${dir} ${t} wrongTurn ${w.cycle} freshSession=${w.freshSession}`);
    }
    r[t] = { ticket: t, decisions: j.decisions || [], wrongTurns: j.wrongTurns || [], notes: j.notes || '' };
  }
  return r;
};
const readerA = read(arg('--a', 'data/survey-judgement/codes-A'));
const readerB = read(arg('--b', 'data/survey-judgement/codes-B'));
const missing = sample.sample.map((s) => s.id).filter((id) => !readerA[id]);
writeFileSync(out, JSON.stringify({
  about: 'LIN-3177 where-judgement-happens: consequential decisions and wrong turns on 36 sampled September changes. Codebook: scripts/survey-judgement-codebook.md. readerA coded all; readerB coded ten blind, in reverse order.',
  sample: sample.sample.map(({ id, cell, repos, prodLines, testLines, risk, area }) => ({ id, cell, repos, prodLines, testLines, risk, area })),
  weights: sample.weights, replaced: sample.replaced,
  readerA, readerB,
}, null, 1) + '\n');
console.log({ readerA: Object.keys(readerA).length, readerB: Object.keys(readerB).length, missing, problems, normalised });
