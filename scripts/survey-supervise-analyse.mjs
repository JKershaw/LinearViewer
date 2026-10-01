// LIN-3150: every number in what-supervisors-do.md — the census by class and layer, coding consistency, the mechanical/judgement split of tokens and time, and no-action wakes.
// Usage: node scripts/survey-supervise-analyse.mjs [--dir data/survey-supervise] [--codes docs/papers/harbour/what-supervisors-do-codes.json]
// Inputs come from survey-supervise-extract.mjs, -classify.mjs and -failures.mjs; writes <dir>/analysis.json for survey-supervise-render.mjs.
// Mechanical share of a class = unit-weighted share of its sampled steps both hand coders marked M (a split verdict counts half).
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PRIORITY } from './survey-supervise-classify.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-supervise'); const codesPath = arg('--codes', 'docs/papers/harbour/what-supervisors-do-codes.json');
const jl = (f) => readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const coded = jl('coded.jsonl'); const steps = jl('steps.jsonl');
const sessions = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'));
const codes = JSON.parse(readFileSync(codesPath, 'utf8')).codes;
const pct = (x) => +(100 * x).toFixed(1); const h = (ms) => +(ms / 36e5).toFixed(1);
const LAYERS = ['Runner', 'leg', 'stepper', 'autopilot', 'wake'];
const out = {};

// 1. Census by class and layer.
const U = coded.reduce((a, x) => a + x.units, 0); const A = coded.reduce((a, x) => a + x.genMs + x.toolMs, 0);
const cls = {}; for (const x of coded) { const b = (cls[x.cls] ||= { steps: 0, units: 0, activeMs: 0, blockMs: 0, parkedMs: 0 }); b.steps++; b.units += x.units; b.activeMs += x.genMs + x.toolMs; b.blockMs += x.blockMs; b.parkedMs += x.parkedAfterMs; }
const layer = {}; for (const x of coded) { const b = (layer[x.layer] ||= { steps: 0, units: 0, activeMs: 0, parkedMs: 0, by: {} }); b.steps++; b.units += x.units; b.activeMs += x.genMs + x.toolMs; b.parkedMs += x.parkedAfterMs + x.blockMs; b.by[x.cls] = (b.by[x.cls] || 0) + x.units; }
out.census = { sessions: sessions.length, steps: coded.length, units: U, activeHours: h(A), subagentUnitShare: pct(sessions.reduce((a, s) => a + s.subagentUnits, 0) / (U + sessions.reduce((a, s) => a + s.subagentUnits, 0))), sessionsByLayer: Object.fromEntries(LAYERS.map((l) => [l, sessions.filter((s) => s.layer === l).length])) };
out.byLayer = Object.fromEntries(LAYERS.map((l) => [l, { steps: layer[l].steps, unitShare: pct(layer[l].units / U), activeHours: h(layer[l].activeMs), heldHours: h(layer[l].parkedMs), unitsPerStepK: Math.round(layer[l].units / layer[l].steps / 1e3), classShare: Object.fromEntries(Object.entries(layer[l].by).map(([c, u]) => [c, pct(u / layer[l].units)])) }]));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const unitsByCls = {}; for (const x of coded) (unitsByCls[x.cls] ||= []).push(x.units);

// 2. Coding consistency: coder 1 vs coder 2, and the census rules vs the coders where they agree.
const kappa = (pairs) => { const n = pairs.length; const po = pairs.filter(([a, b]) => a === b).length / n; const ca = {}, cb = {}; for (const [a, b] of pairs) { ca[a] = (ca[a] || 0) + 1; cb[b] = (cb[b] || 0) + 1; } const pe = Object.keys({ ...ca, ...cb }).reduce((s, k) => s + ((ca[k] || 0) / n) * ((cb[k] || 0) / n), 0); return { n, agree: pct(po), kappa: +((po - pe) / (1 - pe)).toFixed(2) }; };
const ruleOf = new Map(coded.map((x) => [x.session + ':' + x.n, x]));
const both = codes.filter((c) => c.coder1.cls === c.coder2.cls);
const conf = {}; for (const c of both) { const r = ruleOf.get(c.id).cls; if (r !== c.coder1.cls) { const k = `${r}→${c.coder1.cls}`; conf[k] = (conf[k] || 0) + 1; } }
out.consistency = {
  classCoder1VsCoder2: kappa(codes.map((c) => [c.coder1.cls, c.coder2.cls])),
  mjCoder1VsCoder2: kappa(codes.map((c) => [c.coder1.mj, c.coder2.mj])),
  classRulesVsCoders: kappa(both.map((c) => [ruleOf.get(c.id).cls, c.coder1.cls])),
  topRuleDisagreements: Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 6),
};

// 3. Mechanical share per class (by census class, so it can be applied to the census) and directly from the stratified sample.
const mScore = (c) => (c.coder1.mj === 'M') / 2 + (c.coder2.mj === 'M') / 2;
const perCls = {}; for (const c of codes) { const r = ruleOf.get(c.id); const b = (perCls[r.cls] ||= { n: 0, u: 0, mu: 0, mN: 0 }); b.n++; b.u += r.units; b.mu += r.units * mScore(c); b.mN += mScore(c); }
const pooled = Object.values(perCls).reduce((a, b) => ({ u: a.u + b.u, mu: a.mu + b.mu }), { u: 0, mu: 0 });
const mShare = (k) => (perCls[k] && perCls[k].n >= 5 ? perCls[k].mu / perCls[k].u : pooled.mu / pooled.u);
out.classes = PRIORITY.filter((k) => cls[k]).map((k) => ({ cls: k, steps: cls[k].steps, unitShare: pct(cls[k].units / U), activeShare: pct(cls[k].activeMs / A), activeHours: h(cls[k].activeMs), blockHours: h(cls[k].blockMs), medianUnitsK: Math.round(med(unitsByCls[k]) / 1e3), sampled: perCls[k]?.n || 0, mechanicalShare: pct(mShare(k)), mechanicalUnitShare: pct(mShare(k) * cls[k].units / U), judgementUnitShare: pct((1 - mShare(k)) * cls[k].units / U) })).sort((a, b) => b.unitShare - a.unitShare);
const mechU = out.classes.reduce((a, c) => a + c.mechanicalUnitShare, 0);
const mechA = PRIORITY.filter((k) => cls[k]).reduce((a, k) => a + mShare(k) * cls[k].activeMs, 0) / A;
// Direct estimate: weight each sampled step by its layer's units over the sampled units of that layer.
const sw = {}; for (const c of codes) { const r = ruleOf.get(c.id); (sw[c.layer] ||= { u: 0, mu: 0, a: 0, ma: 0 }); sw[c.layer].u += r.units; sw[c.layer].mu += r.units * mScore(c); }
const direct = LAYERS.reduce((a, l) => a + (layer[l].units / U) * (sw[l].mu / sw[l].u), 0);
out.mechanical = { unitShareViaClasses: pct(mechU / 100), activeShareViaClasses: pct(mechA), unitShareDirectSample: pct(direct), byLayerDirect: Object.fromEntries(LAYERS.map((l) => [l, pct(sw[l].mu / sw[l].u)])) };
// Hand-coded class mix of the sample, unit-weighted within layer and scaled to the census.
const hand = {}; for (const c of codes) { const r = ruleOf.get(c.id); const w = (layer[c.layer].units / U) / sw[c.layer].u; for (const cd of [c.coder1, c.coder2]) { const b = (hand[cd.cls] ||= { u: 0, mu: 0 }); b.u += w * r.units / 2; b.mu += w * r.units / 2 * (cd.mj === 'M'); } }
out.handMix = Object.entries(hand).map(([k, b]) => ({ cls: k, unitShare: pct(b.u), mechanicalOfClass: pct(b.mu / b.u) })).sort((a, b) => b.unitShare - a.unitShare);
out.judgementExamples = codes.filter((c) => c.coder1.mj === 'J' && c.coder2.mj === 'J').slice(0, 12).map((c) => ({ id: c.id, cls: c.coder1.cls, note: c.coder1.note }));
out.mixedExamples = codes.filter((c) => c.coder1.cls === c.coder2.cls && ruleOf.get(c.id).cls === c.coder1.cls && ['dispatch', 'judge', 'restate', 'read'].includes(c.coder1.cls)).map((c) => ({ id: c.id, cls: c.coder1.cls, mj: c.coder1.mj + c.coder2.mj, note: c.coder1.note })).slice(0, 40);

// 4. Wake cycles: from a wake to the next wake. A no-action cycle changes nothing: only reads, polls, re-arms and restatements.
const cycles = []; let cur = null;
steps.forEach((s, i) => {
  const isWake = /Your task \(dispatch item [0-9a-f-]+\) is ready|resumed to handle a follow-up|child session reached a terminal outcome|<task-notification>/.test(s.trigger);
  if (!cur || cur.session !== s.session || isWake) { if (cur) cycles.push(cur); cur = isWake ? { session: s.session, layer: s.layer, classes: new Set(), units: 0, steps: 0 } : null; }
  if (cur) { cur.classes.add(coded[i].cls); cur.units += s.units; cur.steps++; }
});
if (cur) cycles.push(cur);
const QUIET = new Set(['read', 'poll', 'rearm', 'restate', 'orient']);
const quiet = cycles.filter((c) => [...c.classes].every((k) => QUIET.has(k)));
out.wakes = { cycles: cycles.length, noAction: quiet.length, noActionShare: pct(quiet.length / cycles.length), noActionUnitShareOfSupervision: pct(quiet.reduce((a, c) => a + c.units, 0) / U), medianStepsNoAction: med(quiet.map((c) => c.steps)), medianUnitsNoActionK: Math.round(med(quiet.map((c) => c.units)) / 1e3), byLayer: Object.fromEntries(LAYERS.map((l) => { const all = cycles.filter((c) => c.layer === l); const q = all.filter((c) => quiet.includes(c)); return [l, { cycles: all.length, noActionShare: all.length ? pct(q.length / all.length) : 0 }]; })) };

// 5. A step's price is the context it re-reads: gate replies early vs late in the long sessions.
const gate = coded.filter((x) => x.cls === 'rearm'); const bySess = {}; for (const x of gate) (bySess[x.session] ||= []).push(x.units);
const long = Object.entries(bySess).filter(([, a]) => a.length >= 20);
out.contextGrowth = { sessions: long.length, firstTenthMedianK: Math.round(med(long.flatMap(([, a]) => a.slice(0, Math.ceil(a.length / 10)))) / 1e3), lastTenthMedianK: Math.round(med(long.flatMap(([, a]) => a.slice(-Math.ceil(a.length / 10)))) / 1e3), outputShareOfUnits: null };
out.failureSignals = JSON.parse(readFileSync(join(dir, 'failure-signals.json'), 'utf8'));
const F = JSON.parse(readFileSync(codesPath.replace('-codes.json', '-failures.json'), 'utf8')).failures;
const tally = (k) => F.reduce((a, f) => ({ ...a, [f[k]]: (a[f[k]] || 0) + 1 }), {});
out.failures = { tickets: F.length, byType: tally('type'), byLocus: tally('locus'), byAction: tally('action'), sampleFlags: codes.filter((c) => c.coder1.fail || c.coder2.fail).length, sampleFlagSessions: [...new Set(codes.filter((c) => c.coder1.fail || c.coder2.fail).map((c) => c.id.split(':')[0]))] };
const tierU = {}; for (const s of steps) tierU[s.model] = (tierU[s.model] || 0) + s.units;
out.tiers = Object.fromEntries(Object.entries(tierU).map(([k, u]) => [k, pct(u / U)]));
writeFileSync(join(dir, 'analysis.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
