// LIN-3183: survey-check-7.md's adversarial re-pricing of held-or-fresh.md's relay. Rebuilds the paper's episodes, fresh starts and
// scenarios exactly as survey-held-analyse.mjs does, then varies one assumption at a time: the mechanical share applied per role
// (the coders sampled roles equally, so a flat 32% over-weights the Runner and autopilot), mechanical acted wakes sent to code in the
// central case too, the relay without the bootstrap summarise (broker-armed launches already skip it), the orientation's own decision
// step counted once, and a hybrid whose code routes by delivery class (which it can see) rather than by outcome (which it cannot).
// Usage: node scripts/survey-check-7-held.mjs [--in data/survey-held/held.jsonl] [--codes docs/papers/harbour/held-or-fresh-codes.json] [--out data/survey-held/check-7.json]
// Run survey-held-extract.mjs first. No proxy calls.
import { readFileSync, writeFileSync } from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const sessions = readFileSync(arg('--in', 'data/survey-held/held.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const codes = JSON.parse(readFileSync(arg('--codes', 'docs/papers/harbour/held-or-fresh-codes.json'), 'utf8'));
const FROM = '2026-09-01'; const TO = '2026-10-01';
const SUP = ['Runner', 'leg', 'stepper', 'autopilot'];
const ACTED = new Set(['act', 'dispatch']);
const [I, R, W1, W5, O, T, C, UN] = [0, 1, 2, 3, 4, 5, 6, 7];
const q = (xs, p) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null; };
const med = (xs) => q(xs, 0.5); const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (a, b) => +((100 * a) / b).toFixed(1);

// ---- Episodes, as survey-held-analyse.mjs.
const eps = [];
for (const s of sessions) {
  if (!SUP.includes(s.layer) || s.taskN == null) continue;
  let cur = null; let hs = null;
  for (const x of s.d) {
    if (x.n <= s.taskN || x.at < FROM || x.at >= TO) continue;
    if (x.source === 'resume-handshake') { hs = x; continue; }
    if (['completion-gate', 'compaction', 'noise', 'continue'].includes(x.source)) { if (cur) cur.st.push(...x.st); continue; }
    cur = { session: s.id, layer: s.layer, source: x.source, wake: x.wake || null, at: x.at, outcome: x.outcome, st: [...(hs ? hs.st : []), ...x.st] };
    if (hs && ACTED.has(hs.outcome)) cur.outcome = hs.outcome; hs = null;
    eps.push(cur);
  }
}
for (const e of eps) { e.acted = ACTED.has(e.outcome) || e.st.some((x) => ACTED.has(x[8])); e.units = sum(e.st.map((x) => x[UN])); e.ctx0 = e.st[0]?.[C] || 0; e.cold = !!e.st[0] && e.st[0][R] < 0.5 * e.st[0][C]; }
{ const bySess = new Map(); for (const e of eps) (bySess.get(e.session) || bySess.set(e.session, []).get(e.session)).push(e);
  for (const v of bySess.values()) { v.sort((a, b) => (a.at < b.at ? -1 : 1)); for (let i = 0; i < v.length; i++) v[i].prevs = v.slice(0, i); } }

// ---- Fresh starts, as survey-held-analyse.mjs, keeping the decision step's own cost apart.
const fresh = {};
for (const s of sessions) {
  if (!s.taskAt || s.taskAt < FROM || s.taskAt >= TO || !s.decisionStep) continue;
  const role = s.layer === 'worker' ? s.kind : s.layer;
  const boot = sum(s.d.filter((x) => x.n < s.taskN).flatMap((x) => x.st.map((y) => y[UN])));
  let u = 0; let ctx = null; let last = 0; let done = false;
  for (const x of s.d) { if (x.n < s.taskN) continue; for (let i = 0; i < x.st.length; i++) { u += x.st[i][UN]; if (x.n === s.decisionStep.n && i === s.decisionStep.idx) { ctx = x.st[i][C]; last = x.st[i][UN]; done = true; break; } } if (done) break; }
  if (done) (fresh[role] ||= []).push({ units: u, last, boot, ctx, bootstrapped: s.taskN > 0 });
}
const ROLE_OF = { Runner: 'leg', leg: 'leg', stepper: 'stepper', autopilot: 'autopilot' };
const orient = (L, p, once) => q(fresh[ROLE_OF[L]].map((x) => x.units - (once ? x.last : 0)), p);
const ctxFresh = (L) => med(fresh[ROLE_OF[L]].map((x) => x.ctx));
const bootU = (L) => med(fresh[ROLE_OF[L]].filter((x) => x.bootstrapped).map((x) => x.boot)) || 0;
const BASE = med(sessions.filter((s) => s.d[0]?.st[0] && s.d[0].at >= FROM && s.d[0].at < TO).map((s) => s.d[0].st[0][C]));
function reprice(e, ctx) { const shift = ctx - e.ctx0; let u = 0; e.st.forEach((x, i) => { const read = Math.max(0, x[R] + shift); const cold = i === 0 && e.cold; u += x[T] * (x[I] + 5 * x[O] + 0.1 * read + (cold ? 0 : 2 * x[W1] + 1.25 * x[W5])); }); return u; }
const HOUR = 3600e3;

// ---- The coders' mechanical share: flat (the paper) and per role (each role's share applied to its own acted wakes).
const ca = Object.fromEntries(codes.cards.A.map((c) => [c.card, c])); const cb = Object.fromEntries(codes.cards.B.map((c) => [c.card, c]));
const layerOf = Object.fromEntries(codes.sample.cards.map((c) => [c.id, c.layer]));
const ids = Object.keys(ca).filter((k) => cb[k]);
const mFlat = sum(ids.map((k) => (ca[k].mj === 'M') + (cb[k].mj === 'M'))) / (2 * ids.length);
const mRole = Object.fromEntries(SUP.map((L) => { const ks = ids.filter((k) => layerOf[k] === L); return [L, sum(ks.map((k) => (ca[k].mj === 'M') + (cb[k].mj === 'M'))) / (2 * ks.length)]; }));

// ---- Scenarios. `route` decides which wakes code takes: 'outcome' (the paper: every wake that changed nothing) or 'class' (only what
// code can see before the wake is read: pause wakes, failsafe re-confirms, silence re-fires, and every delivery into the Runner).
// A class-routed wake that acted is still delivered to the model and kept at its held cost (code passes it on), which is optimistic.
// 'row1' is the class route without the Runner (the anchor's map row 1); 'row2' is the Runner alone (row 2).
const byClass = (e) => e.wake === 'pause' || ['failsafe-reconfirm', 'silence-refire'].includes(e.source);
const routed = (e, sc) => (sc.route === 'class' ? byClass(e) || e.layer === 'Runner' : sc.route === 'row1' ? byClass(e) && e.layer !== 'Runner' : sc.route === 'row2' ? e.layer === 'Runner' : !e.acted);
const kept = (e, sc) => !routed(e, sc) || (sc.route && e.acted);
function cost(e, sc) {
  if (routed(e, sc) && !(sc.route && e.acted)) return 0;
  if (!e.st.length) return 0;
  const m = sc.m === 'role' ? mRole[e.layer] : sc.m === 'flat' ? mFlat : 0;
  let c;
  if (sc.acted === 'held') {
    c = e.units;
    // The paper's cache penalty, generalised: the wake pays a cold re-write when no kept wake came within the hour before it but some
    // wake (now gone) did, so today's cache was warm only because of the removed wakes. As the paper, a wake with no earlier kept
    // wake in its session pays nothing.
    const ttl = sc.ttl || HOUR; const t = Date.parse(e.at);
    const keptEver = e.prevs.some((p) => kept(p, sc));
    const keptRecent = e.prevs.some((p) => kept(p, sc) && t - Date.parse(p.at) <= ttl);
    const anyRecent = e.prevs.some((p) => t - Date.parse(p.at) <= ttl);
    if (!e.cold && keptEver && anyRecent && !keptRecent) c += e.st[0][T] * e.ctx0 * (2 - 0.1);
  } else if (sc.acted === 'lean') c = 2 * (BASE + sc.handoff) * e.st[0][T] + reprice(e, BASE + sc.handoff);
  else c = orient(e.layer, sc.orientQ, sc.once) + (sc.bootstrap ? bootU(e.layer) : 0) + 2 * sc.handoff + reprice(e, ctxFresh(e.layer) + sc.handoff);
  return e.acted ? c * (1 - m) : c;
}
const fleet = sum(sessions.flatMap((s) => s.d.filter((x) => x.at >= FROM && x.at < TO).flatMap((x) => x.st.map((y) => y[UN]))));
const held = sum(eps.map((e) => e.units));
const SC = {
  // The paper's own scenarios, reproduced (outcome routing).
  central: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: true },
  dear: { acted: 'fresh', orientQ: 0.75, handoff: 50e3, bootstrap: true },
  cheapFlat: { acted: 'fresh', orientQ: 0.25, handoff: 5e3, bootstrap: false, m: 'flat' },
  leanCentral: { acted: 'lean', handoff: 20e3 },
  leanCheapFlat: { acted: 'lean', handoff: 10e3, m: 'flat' },
  hybrid: { acted: 'held' },
  hybridCheapFlat: { acted: 'held', m: 'flat' },
  hybridDear: { acted: 'held', ttl: 5 * 60e3 },
  // One assumption varied at a time.
  cheapRole: { acted: 'fresh', orientQ: 0.25, handoff: 5e3, bootstrap: false, m: 'role' },
  leanCheapRole: { acted: 'lean', handoff: 10e3, m: 'role' },
  hybridCheapRole: { acted: 'held', m: 'role' },
  centralMRole: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: true, m: 'role' },
  centralNoBoot: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: false },
  centralOnce: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: true, once: true },
  centralNoBootOnceMRole: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: false, once: true, m: 'role' },
  hybridByClass: { acted: 'held', route: 'class' },
  hybridByClassDear: { acted: 'held', route: 'class', ttl: 5 * 60e3 },
  leanByClass: { acted: 'lean', handoff: 20e3, route: 'class' },
  centralByClass: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: true, route: 'class' },
  centralNoBootOnce: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: false, once: true },
  // The same variations with the decision step counted once (version 2's orientation).
  centralOnceMRole: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: true, once: true, m: 'role' },
  centralOnceByClass: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: true, once: true, route: 'class' },
  hybridRow1: { acted: 'held', route: 'row1' },
  hybridRow2: { acted: 'held', route: 'row2' },
};
const out = { fleetM: +(fleet / 1e6).toFixed(1), heldM: +(held / 1e6).toFixed(1), episodes: eps.length, baseCtx: BASE, mFlat: +mFlat.toFixed(3), mRole: Object.fromEntries(Object.entries(mRole).map(([k, v]) => [k, +v.toFixed(3)])), scenarios: {} };
// The mechanical share as the population of acted wakes, and of their cost, would carry it.
{ const a = eps.filter((e) => e.acted); out.mPopulation = { byWakes: +(sum(a.map((e) => mRole[e.layer])) / a.length).toFixed(3), byHeldCost: +(sum(a.map((e) => mRole[e.layer] * e.units)) / sum(a.map((e) => e.units))).toFixed(3) }; }
for (const [k, sc] of Object.entries(SC)) {
  const r = sum(eps.map((e) => cost(e, sc)));
  out.scenarios[k] = { fleetChange: pct(r - held, fleet), perCorrectChangeM: +(13.3 * (1 + (r - held) / fleet)).toFixed(1), byLayer: Object.fromEntries(SUP.map((L) => { const xs = eps.filter((e) => e.layer === L); const t = sum(xs.map((e) => e.units)); return [L, pct(sum(xs.map((e) => cost(e, sc))) - t, t)]; })) };
}
// What code can route by class, and what it would hold back that acted.
{ const cls = eps.filter((e) => routed(e, { route: 'class' })); out.byClass = { wakes: cls.length, quiet: cls.filter((e) => !e.acted).length, acted: cls.filter((e) => e.acted).length, quietShareOfFleet: pct(sum(cls.filter((e) => !e.acted).map((e) => e.units)), fleet), quietOutsideClassShareOfFleet: pct(sum(eps.filter((e) => !e.acted && !routed(e, { route: 'class' })).map((e) => e.units)), fleet) }; }
// Overlap of option C with A: cold resumes that changed nothing go to code under A anyway.
{ const cold = eps.filter((e) => e.cold); const coldQuiet = cold.filter((e) => !e.acted); out.coldResumes = { n: cold.length, quiet: coldQuiet.length, firstStepM: +(sum(cold.map((e) => e.st[0][UN])) / 1e6).toFixed(1), quietFirstStepM: +(sum(coldQuiet.map((e) => e.st[0][UN])) / 1e6).toFixed(1), freshInsteadActedM: +(sum(cold.filter((e) => e.acted).map((e) => orient(e.layer, 0.5) + bootU(e.layer))) / 1e6).toFixed(1), freshInsteadActedOnceM: +(sum(cold.filter((e) => e.acted).map((e) => orient(e.layer, 0.5, true) + bootU(e.layer))) / 1e6).toFixed(1), actedFirstStepM: +(sum(cold.filter((e) => e.acted).map((e) => e.st[0][UN])) / 1e6).toFixed(1) }; }
out.orientation = Object.fromEntries(['leg', 'stepper', 'autopilot'].map((L) => [L, { toDecisionK: Math.round(orient(L, 0.5) / 1e3), beforeDecisionK: Math.round(orient(L, 0.5, true) / 1e3), bootstrapK: Math.round(bootU(L) / 1e3) }]));
writeFileSync(arg('--out', 'data/survey-held/check-7.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
