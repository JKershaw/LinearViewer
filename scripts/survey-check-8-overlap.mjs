// LIN-3184 (survey-check-8): adversarial re-measures of step-overlap.md's load-bearing figures.
// Usage: node scripts/survey-check-8-overlap.mjs [--fresh data/survey-overlap/fresh-codes] [--fresh-index data/survey-overlap/fresh-digests/index.json] [--seed 3184] [--out data/survey-check-8/overlap.json]
// (1) Is 13 tickets enough? A ticket-level bootstrap (2,000 resamples, seeded) of every coded share in step-overlap-codes.json, which is
//     how the paper averages: per ticket over both readers, then over tickets. (2) A fresh blind sample: the census tickets the paper did
//     not code, every 3rd from the second (survey-overlap-digests.mjs --offset 1), coded by two new readers against the paper's rubric
//     unchanged, with the same tallies and kappa; and the two samples pooled. (3) Planned parents' children's planning cost in weighted
//     units (survey-context's snapshot) as well as raw tokens, with and without their research. (4) Ticket-read carry at the measured
//     2.6 bytes a token as well as the paper's 4.
// Needs: docs/papers/harbour/step-overlap-codes.json; data/survey-overlap/{transcripts.json,analysis.json}; data/survey-context/sessions.json.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { stepOfKind } from './survey-overlap-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const freshDir = arg('--fresh', 'data/survey-overlap/fresh-codes');
const freshIndex = arg('--fresh-index', 'data/survey-overlap/fresh-digests/index.json');
const outPath = arg('--out', 'data/survey-check-8/overlap.json');
let seed = +arg('--seed', 3184);
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

const SHARES = {
  planRestates: ['P', ['RESTATE']], planReverifies: ['P', ['REVERIFY']], planExtendsOrNew: ['P', ['EXTEND', 'NEW']], planContra: ['P', ['CONTRA']],
  reviewChecks: ['V', ['CHECK']], reviewReverifies: ['V', ['REVERIFY']], reviewNew: ['V', ['NEW']], reviewProcess: ['V', ['PROCESS']],
  implRestatesOrReverifies: ['I', ['RESTATE', 'REVERIFY']], implExtendsOrNew: ['I', ['EXTEND', 'NEW']],
  researchUsed: ['R', ['CITED', 'FOLLOWED']], researchCited: ['R', ['CITED']], researchFollowed: ['R', ['FOLLOWED']], researchBackground: ['R', ['BACKGROUND']],
};
function kappa(pairs) {
  const n = pairs.length; if (!n) return null;
  const cats = [...new Set(pairs.flat())]; const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return { n, agree: r3(po), kappa: pe === 1 ? 1 : r3((po - pe) / (1 - pe)) };
}
// Per-ticket share of a family's units coded in `codes`, averaged over the two readers; then the mean over tickets.
const perTicket = (units, fam, codes) => {
  const by = {}; for (const u of units) if (u.A && u.B && u.unit[0] === fam) (by[u.issue] ||= []).push(u);
  return Object.fromEntries(Object.entries(by).map(([t, us]) => [t, (us.filter((u) => codes.includes(u.A)).length + us.filter((u) => codes.includes(u.B)).length) / (2 * us.length)]));
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function summarise(units, boot = 2000) {
  const out = { tickets: new Set(units.map((u) => u.issue)).size, units: units.filter((u) => u.A && u.B).length, kappa: {}, shares: {} };
  for (const f of ['P', 'V', 'I', 'R']) out.kappa[f] = kappa(units.filter((u) => u.A && u.B && u.unit[0] === f).map((u) => [u.A, u.B]));
  for (const [k, [fam, codes]] of Object.entries(SHARES)) {
    const pt = perTicket(units, fam, codes); const ids = Object.keys(pt); const m = mean(ids.map((t) => pt[t]));
    const bs = []; for (let b = 0; b < boot; b++) { const s = ids.map(() => pt[ids[Math.floor(rand() * ids.length)]]); bs.push(mean(s)); }
    bs.sort((x, y) => x - y);
    out.shares[k] = { mean: r3(m), ci95: [r3(bs[Math.floor(0.025 * boot)]), r3(bs[Math.floor(0.975 * boot)])], tickets: ids.length };
  }
  // "Cited one time in nine": cited over used, pooled over both readers' codes.
  const R = units.filter((u) => u.A && u.B && u.unit[0] === 'R'); const used = R.flatMap((u) => [u.A, u.B]).filter((c) => ['CITED', 'FOLLOWED'].includes(c));
  out.citedOfUsed = r3(used.filter((c) => c === 'CITED').length / (used.length || 1));
  return out;
}

// ---- (1) The paper's sample.
const paper = J('docs/papers/harbour/step-overlap-codes.json');
const paperUnits = paper.units.filter((u) => u.digest?.startsWith('O'));
const block1 = summarise(paperUnits);

// ---- (2) The fresh sample, and both pooled.
let block2 = null; let pooled = null;
if (existsSync(freshDir) && existsSync(freshIndex)) {
  const issueOf = Object.fromEntries(J(freshIndex).index.filter((x) => x.units).map((x) => [x.digest, x.issue]));
  const load = (re) => readdirSync(freshDir).filter((f) => re.test(f)).sort().flatMap((f) => J(join(freshDir, f)).digests);
  const a = Object.fromEntries(load(/^A\d*\.json$/).map((d) => [d.digest, d])); const b = Object.fromEntries(load(/^B\d*\.json$/).map((d) => [d.digest, d]));
  const units = [];
  for (const dg of Object.keys(a).filter((k) => b[k]).sort()) for (const field of ['codes', 'use']) {
    const ua = a[dg][field] || {}; const ub = b[dg][field] || {};
    for (const u of Object.keys({ ...ua, ...ub })) units.push({ digest: dg, issue: issueOf[dg], unit: u, A: ua[u] || null, B: ub[u] || null });
  }
  block2 = summarise(units);
  block2.digests = Object.keys(a).filter((k) => b[k]).length; block2.issues = [...new Set(units.map((u) => u.issue))];
  pooled = summarise([...paperUnits, ...units]);
}

// ---- (3) Planned parents' children's planning, in raw tokens (the paper's unit) and weighted units.
const S = J('data/survey-overlap/transcripts.json').sessions; const rows = J('data/survey-overlap/analysis.json').splitCensus.rows;
const U = new Map(J('data/survey-context/sessions.json').sessions.map((s) => [s.ws, s.units]));
const sKind = (s) => stepOfKind(s.tasks[0]?.kind || s.header); const sIssue = (s) => s.tasks[0]?.issue || s.headerIssue;
const kids = new Set(rows.filter((k) => k.parentPlanned).map((k) => k.child));
const totT = S.reduce((a, s) => a + s.tokens, 0); const totU = S.reduce((a, s) => a + (U.get(s.ws) || 0), 0);
const cost = (kinds) => { const ss = S.filter((s) => kids.has(sIssue(s)) && kinds.includes(sKind(s))); return { rawTokensPct: r3(100 * ss.reduce((a, s) => a + s.tokens, 0) / totT), weightedUnitsPct: r3(100 * ss.reduce((a, s) => a + (U.get(s.ws) || 0), 0) / totU) }; };
const block3 = { sessionsMatchedToUnits: S.filter((s) => U.has(s.ws)).length, sessions: S.length, researchPlanPlanReview: cost(['research', 'plan', 'plan-review']), planPlanReviewOnly: cost(['plan', 'plan-review']) };

// ---- (4) Ticket-read carry at the measured bytes-a-token ratio.
const win = S.reduce((a, s) => a + s.window, 0);
const issueCarry = S.reduce((a, s) => a + s.reads.filter((r) => r.endpoint !== 'brief').reduce((b, r) => b + (r.carry || 0), 0), 0);
const briefCarry = S.reduce((a, s) => a + s.reads.filter((r) => r.endpoint === 'brief').reduce((b, r) => b + (r.carry || 0), 0), 0);
const block4 = { at4: { ticketReads: r3(100 * issueCarry / win), briefs: r3(100 * briefCarry / win) }, at2_6: { ticketReads: r3(100 * issueCarry * (4 / 2.6) / win), briefs: r3(100 * briefCarry * (4 / 2.6) / win) } };

const out = { generatedAt: new Date().toISOString(), paperSample: block1, freshSample: block2, pooled, splitCost: block3, ticketReadCarryPct: block4 };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
