// LIN-3176: score the two blind codings of what acted wakes' decisions used (where each fact lived, and how many decisions rested on a held session's memory alone) and of how each supervisor failure on record was recovered; write both codings and their codebooks to the committed held-or-fresh-codes.json.
// Usage: node scripts/survey-held-codes.mjs [--dir data/survey-held] [--write docs/papers/harbour/held-or-fresh-codes.json]
// Run survey-held-sample.mjs first, then have two coders code the cards (codes/coderA-*.json, codes/coderB-*.json) and the failures
// (codes/failures-coderA.json, codes/failures-coderB.json) blind, from codebook.md and failures-codebook.md. With --write and no
// coder files present, it scores the committed file instead, so the figures re-run from git alone. No proxy calls.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-held'); const target = arg('--write', 'docs/papers/harbour/held-or-fresh-codes.json');
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
let data;
const cd = join(dir, 'codes');
if (existsSync(cd) && readdirSync(cd).some((f) => /^coder[AB]-\d+\.json$/.test(f))) {
  const load = (re) => readdirSync(cd).filter((f) => re.test(f)).sort().flatMap((f) => J(join(cd, f)));
  data = {
    about: 'LIN-3176 (held-or-fresh.md). cards: a systematic sample of September wakes into held supervisors that acted (survey-held-sample.mjs), each coded blind by two coders of the frontier tier from codebook; failures: the 25 supervisor failures on record (wake-inventory-failures.json), each ticket read with its comments and coded blind by two coders from failuresCodebook.',
    codebook: readFileSync(join(dir, 'codebook.md'), 'utf8'), failuresCodebook: readFileSync(join(dir, 'failures-codebook.md'), 'utf8'),
    sample: J(join(dir, 'cards', 'index.json')),
    cards: { A: load(/^coderA-\d+\.json$/), B: load(/^coderB-\d+\.json$/) },
    failures: { A: existsSync(join(cd, 'failures-coderA.json')) ? J(join(cd, 'failures-coderA.json')) : [], B: existsSync(join(cd, 'failures-coderB.json')) ? J(join(cd, 'failures-coderB.json')) : [] },
  };
  writeFileSync(target, JSON.stringify(data, null, 1) + '\n');
} else data = J(target);

const kappa = (pairs) => { const n = pairs.length; const po = pairs.filter(([a, b]) => a === b).length / n; const cats = [...new Set(pairs.flat())]; const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0); return { agree: +(100 * po).toFixed(1), kappa: pe === 1 ? 1 : +((po - pe) / (1 - pe)).toFixed(2), n }; };
const count = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const pct = (a, b) => +((100 * a) / b).toFixed(1);
const layerOf = Object.fromEntries(data.sample.cards.map((c) => [c.id, c.layer]));

// Cards.
const A = Object.fromEntries(data.cards.A.map((c) => [c.card, c])); const B = Object.fromEntries(data.cards.B.map((c) => [c.card, c]));
const ids = Object.keys(A).filter((k) => B[k]).sort();
const out = { cards: ids.length, population: data.sample.population, byLayerPopulation: data.sample.byLayer };
out.mj = { ...kappa(ids.map((k) => [A[k].mj, B[k].mj])), mShareMean: pct(ids.reduce((s, k) => s + (A[k].mj === 'M') + (B[k].mj === 'M'), 0), 2 * ids.length), bothM: ids.filter((k) => A[k].mj === 'M' && B[k].mj === 'M').length, bothJ: ids.filter((k) => A[k].mj === 'J' && B[k].mj === 'J').length };
out.memoryAlone = { ...kappa(ids.map((k) => [!!A[k].memoryAlone, !!B[k].memoryAlone])), A: ids.filter((k) => A[k].memoryAlone).length, B: ids.filter((k) => B[k].memoryAlone).length, both: ids.filter((k) => A[k].memoryAlone && B[k].memoryAlone).length, either: ids.filter((k) => A[k].memoryAlone || B[k].memoryAlone).length, eitherCards: ids.filter((k) => A[k].memoryAlone || B[k].memoryAlone).map((k) => `${k} (${layerOf[k]}): A ${A[k].memoryAlone ? 'yes' : 'no'}, B ${B[k].memoryAlone ? 'yes' : 'no'}; ${(A[k].memoryAlone ? A[k] : B[k]).facts.filter((f) => f.source === 'memory-only').map((f) => f.fact).join(' | ')}`) };
const srcShare = (coder) => { const f = coder.flatMap((c) => c.facts || []); const n = count(f.map((x) => x.source)); return Object.fromEntries(Object.entries(n).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v, f.length)])); };
out.factSources = { A: srcShare(ids.map((k) => A[k])), B: srcShare(ids.map((k) => B[k])) };
const anySrc = (s) => ({ A: ids.filter((k) => (A[k].facts || []).some((f) => f.source === s)).length, B: ids.filter((k) => (B[k].facts || []).some((f) => f.source === s)).length });
out.cardsWithMemoryOnlyFact = anySrc('memory-only'); out.cardsWithMemoryRecordedFact = anySrc('memory-recorded');
const hc = ids.map((k) => ((+A[k].handoffChars || 0) + (+B[k].handoffChars || 0)) / 2).sort((a, b) => a - b);
out.handoffChars = { p50: hc[Math.floor(hc.length / 2)], p75: hc[Math.floor(0.75 * hc.length)], p90: hc[Math.floor(0.9 * hc.length)], max: hc[hc.length - 1], zero: hc.filter((x) => x === 0).length };
out.byLayer = {}; for (const L of ['Runner', 'leg', 'stepper', 'autopilot']) { const ks = ids.filter((k) => layerOf[k] === L); out.byLayer[L] = { cards: ks.length, J: ks.reduce((s, k) => s + (A[k].mj === 'J') + (B[k].mj === 'J'), 0) / 2, memoryAloneEither: ks.filter((k) => A[k].memoryAlone || B[k].memoryAlone).length }; }

// Failures.
const FA = Object.fromEntries(data.failures.A.map((c) => [c.id, c])); const FB = Object.fromEntries(data.failures.B.map((c) => [c.id, c]));
const fids = Object.keys(FA).filter((k) => FB[k]).sort();
if (fids.length) {
  out.failures = {
    n: fids.length,
    recoveryUsed: { A: count(fids.map((k) => FA[k].recoveryUsed)), B: count(fids.map((k) => FB[k].recoveryUsed)), agreement: kappa(fids.map((k) => [FA[k].recoveryUsed, FB[k].recoveryUsed])) },
    relayEffect: { A: count(fids.map((k) => FA[k].relayEffect)), B: count(fids.map((k) => FB[k].relayEffect)), agreement: kappa(fids.map((k) => [FA[k].relayEffect, FB[k].relayEffect])) },
    recoveredBy: { A: count(fids.map((k) => FA[k].recoveredBy)), B: count(fids.map((k) => FB[k].recoveredBy)) },
    detectedBy: { A: count(fids.map((k) => FA[k].detectedBy)), B: count(fids.map((k) => FB[k].detectedBy)) },
    memoryEither: fids.filter((k) => ['memory', 'both'].includes(FA[k].recoveryUsed) || ['memory', 'both'].includes(FB[k].recoveryUsed)).map((k) => `${k}: A ${FA[k].recoveryUsed}, B ${FB[k].recoveryUsed}`),
    worsenedEither: fids.filter((k) => FA[k].relayEffect === 'worsened' || FB[k].relayEffect === 'worsened').map((k) => `${k}: A ${FA[k].relayEffect} (${FA[k].relayWhy}); B ${FB[k].relayEffect} (${FB[k].relayWhy})`),
    avoidedBoth: fids.filter((k) => FA[k].relayEffect === 'avoided' && FB[k].relayEffect === 'avoided'),
  };
}
writeFileSync(join(dir, 'codes-summary.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
