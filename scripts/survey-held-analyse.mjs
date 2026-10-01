// LIN-3176: what a held supervisor costs per wake against the context it has accumulated, what a fresh start costs to orient by role, and what John's relay (code for mechanical wakes, a fresh judgement session for the rest) would have cost on September's work, under both wake-charging rules.
// Usage: node scripts/survey-held-analyse.mjs [--in data/survey-held/held.jsonl] [--sd ../simple-dispatcher] [--out data/survey-held/analysis.json] [--codes data/survey-held/codes]
// Run survey-held-extract.mjs first. No proxy calls.
// *Episode*: a delivery into a held supervisor (Runner, leg, stepper, ticket autopilot) after its own task arrived, dated 1–30 September,
// that is not the runner's completion gate or resume handshake, merged with the handshake just before it and the gates, compactions and
// continues after it (survey-wake-analyse.mjs's episode). Its *context at entry* is its first step's whole prompt. It *acted* if its
// outcome is act or dispatch, else it *changed nothing*.
// *Fresh start*: a dispatched session dated 1–30 September, from its task's arrival to its first act or dispatch (its first decision);
// the bootstrap summarise before the task is reported apart.
// *Relay*: a changed-nothing episode costs nothing (code holds it); an acted episode becomes a fresh session of its role: the role's
// fresh-start cost to first decision (plus the bootstrap, unless broker-armed) plus the episode's own steps re-priced at the fresh
// context (the role's median context at first decision, plus a handoff of H tokens, plus what the episode itself added), with the
// handoff written once to the 1-hour cache. Scenarios set the orientation quantile, H, the bootstrap and whether mechanical acted
// episodes (the share the blind coders marked M, if codes exist) also go to code.
// *Per merged change*: tickets whose LIN id names a first-parent merge on origin/main dated 1–30 September in either repo, whose first
// session in the transcripts is on or after 30 August; every session's steps charged to its own ticket, and a supervisor episode either
// to the ticket of the child its wake names (else the item's issue, else the session's) or to the session it entered.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'data/survey-held/analysis.json');
const sdDir = resolve(arg('--sd', '../simple-dispatcher'));
const codesDir = arg('--codes', 'data/survey-held/codes');
const sessions = readFileSync(arg('--in', 'data/survey-held/held.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const FROM = '2026-09-01'; const TO = '2026-10-01';
const SUP = ['Runner', 'leg', 'stepper', 'autopilot'];
const ACTED = new Set(['act', 'dispatch']);
// Step tuple from the extract: [input, cacheRead, write1h, write5m, output, tier, ctx, units, toolClass, msSinceDelivery].
const [I, R, W1, W5, O, T, C, UN] = [0, 1, 2, 3, 4, 5, 6, 7];
const q = (xs, p) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null; };
const med = (xs) => q(xs, 0.5); const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const r0 = (x) => Math.round(x); const r2 = (x) => +(+x).toFixed(2); const pct = (a, b) => (b ? +((100 * a) / b).toFixed(1) : null);
function ols(x, y) { const n = x.length; const mx = sum(x) / n; const my = sum(y) / n; let sxy = 0; let sxx = 0; let syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } const b = sxy / sxx; return { a: my - b * mx, b, r2: (sxy * sxy) / (sxx * syy), n }; }

// ---- Episodes into held supervisors.
const eps = [];
for (const s of sessions) {
  if (!SUP.includes(s.layer) || s.taskN == null) continue;
  let cur = null; let hs = null;
  for (const x of s.d) {
    if (x.n <= s.taskN || x.at < FROM || x.at >= TO) continue;
    if (x.source === 'resume-handshake') { hs = x; continue; }
    if (['completion-gate', 'compaction', 'noise', 'continue'].includes(x.source)) { if (cur) { cur.st.push(...x.st); if (x.source === 'completion-gate') cur.gates++; } continue; }
    cur = { session: s.id, issue: s.issue, layer: s.layer, source: x.source, wake: x.wake || null, kind: x.kind || null, child: x.child || null, itemIssue: x.itemIssue || null, at: x.at, outcome: x.outcome, handshake: !!hs, gates: 0, st: [...(hs ? hs.st : []), ...x.st] };
    if (hs && ACTED.has(hs.outcome)) cur.outcome = hs.outcome; hs = null;
    eps.push(cur);
  }
}
for (const e of eps) { e.acted = ACTED.has(e.outcome) || e.st.some((x) => ACTED.has(x[8])); e.units = sum(e.st.map((x) => x[UN])); e.ctx0 = e.st[0]?.[C] || 0; e.cold = !!e.st[0] && e.st[0][R] < 0.5 * e.st[0][C]; }
const live = eps.filter((e) => e.st.length && e.ctx0 > 0);

// Part 1: cost per wake against context, by layer; components; total per session against its number of wakes.
const part1 = {};
for (const L of SUP) {
  const xs = live.filter((e) => e.layer === L); if (!xs.length) continue;
  const lin = ols(xs.map((e) => e.ctx0), xs.map((e) => e.units));
  const loglog = ols(xs.map((e) => Math.log(e.ctx0)), xs.map((e) => Math.log(e.units)));
  const steps = xs.flatMap((e) => e.st).filter((x) => x[C] > 0);
  const perStep = ols(steps.map((x) => x[C]), steps.map((x) => x[UN]));
  // Does a wake take more steps as context grows? (the other way cost per wake could grow faster than linear)
  const stepsVsCtx = ols(xs.map((e) => e.ctx0), xs.map((e) => e.st.length));
  const comp = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  for (const x of steps) { comp.input += x[T] * x[I]; comp.cacheRead += x[T] * 0.1 * x[R]; comp.cacheWrite += x[T] * (2 * x[W1] + 1.25 * x[W5]); comp.output += x[T] * 5 * x[O]; }
  const ct = sum(Object.values(comp));
  const bins = []; for (const [lo, hi] of [[0, 100e3], [100e3, 200e3], [200e3, 300e3], [300e3, 400e3], [400e3, 600e3], [600e3, 800e3], [800e3, 1.2e6]]) { const b = xs.filter((e) => e.ctx0 >= lo && e.ctx0 < hi); if (b.length >= 5) bins.push({ ctxK: `${lo / 1e3}-${hi / 1e3}`, n: b.length, medianUnits: r0(med(b.map((e) => e.units))), quietShare: pct(b.filter((e) => !e.acted).length, b.length), medianSteps: med(b.map((e) => e.st.length)) }); }
  // Context growth per wake within a session.
  const bySess = new Map(); for (const e of xs) (bySess.get(e.session) || bySess.set(e.session, []).get(e.session)).push(e);
  const growth = []; const totals = [];
  for (const v of bySess.values()) { v.sort((a, b) => (a.at < b.at ? -1 : 1)); for (let i = 1; i < v.length; i++) growth.push(v[i].ctx0 - v[i - 1].ctx0); if (v.length >= 2) totals.push({ wakes: v.length, units: sum(v.map((e) => e.units)) }); }
  const tot = ols(totals.map((t) => Math.log(t.wakes)), totals.map((t) => Math.log(t.units)));
  part1[L] = {
    episodes: xs.length, sessions: bySess.size, acted: xs.filter((e) => e.acted).length, cold: xs.filter((e) => e.cold).length,
    ctxAtEntry: { p10: q(xs.map((e) => e.ctx0), 0.1), p50: med(xs.map((e) => e.ctx0)), p90: q(xs.map((e) => e.ctx0), 0.9) },
    unitsPerWake: { p25: r0(q(xs.map((e) => e.units), 0.25)), p50: r0(med(xs.map((e) => e.units))), p75: r0(q(xs.map((e) => e.units), 0.75)) },
    fit: { perWakeIntercept: r0(lin.a), perWakeSlope: r2(lin.b), perWakeR2: r2(lin.r2), loglogExponent: r2(loglog.b), perStepIntercept: r0(perStep.a), perStepSlope: +perStep.b.toFixed(3), perStepR2: r2(perStep.r2), stepsPer100kCtx: r2(stepsVsCtx.b * 1e5) },
    components: Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, pct(v, ct)])),
    bins, ctxGrowthPerWake: { p25: r0(q(growth, 0.25)), p50: r0(med(growth)), p75: r0(q(growth, 0.75)) },
    sessionTotalVsWakes: { sessions: totals.length, exponent: r2(tot.b), r2: r2(tot.r2) },
  };
}
// The scatter for the headline chart: every episode's (layer, context at entry, units).
const scatter = live.map((e) => [SUP.indexOf(e.layer), e.ctx0, r0(e.units), e.acted ? 1 : 0]);

// Part 2: fresh starts, from task arrival to first decision, by role; plus the warm/cold first step of every supervisor delivery.
const fresh = {};
for (const s of sessions) {
  if (!s.taskAt || s.taskAt < FROM || s.taskAt >= TO || !s.decisionStep) continue;
  const role = s.layer === 'worker' ? s.kind : s.layer;
  const boot = sum(s.d.filter((x) => x.n < s.taskN).flatMap((x) => x.st.map((y) => y[UN])));
  let u = 0; let ctx = null; let n = 0; let done = false;
  for (const x of s.d) { if (x.n < s.taskN) continue; for (let i = 0; i < x.st.length; i++) { u += x.st[i][UN]; n++; if (x.n === s.decisionStep.n && i === s.decisionStep.idx) { ctx = x.st[i][C]; done = true; break; } } if (done) break; }
  if (!done) continue;
  (fresh[role] ||= []).push({ units: u, boot, ctx, steps: n, minutes: (Date.parse(s.decisionAt) - Date.parse(s.taskAt)) / 60e3, reads: s.orientReads, calls: s.orientCalls, bootstrapped: s.taskN > 0 });
}
const part2 = {};
for (const [role, v] of Object.entries(fresh)) {
  if (v.length < 10) continue;
  const rd = {}; for (const x of v) for (const [k, c] of Object.entries(x.reads)) rd[k] = (rd[k] || 0) + c; const rt = sum(Object.values(rd));
  part2[role] = { sessions: v.length, unitsToDecision: { p25: r0(q(v.map((x) => x.units), 0.25)), p50: r0(med(v.map((x) => x.units))), p75: r0(q(v.map((x) => x.units), 0.75)) }, bootstrapShare: pct(v.filter((x) => x.bootstrapped).length, v.length), bootstrapUnits: r0(med(v.filter((x) => x.bootstrapped).map((x) => x.boot)) || 0), ctxAtDecision: r0(med(v.map((x) => x.ctx))), minutesToDecision: r2(med(v.map((x) => x.minutes))), minutesP75: r2(q(v.map((x) => x.minutes), 0.75)), steps: med(v.map((x) => x.steps)), readCalls: med(v.map((x) => x.calls)), readKChars: r0(med(v.map((x) => sum(Object.values(x.reads)))) / 1e3), readsBySource: Object.fromEntries(Object.entries(rd).sort((a, b) => b[1] - a[1]).map(([k, c]) => [k, pct(c, rt)])) };
}
// Cold resumes (LIN-1219's natural experiment): a held supervisor's delivery whose first step re-writes its context to cache.
const coldResumes = {}; for (const L of SUP) { const xs = eps.filter((e) => e.layer === L && e.cold); if (!xs.length) continue; coldResumes[L] = { n: xs.length, ctxP50: r0(med(xs.map((e) => e.ctx0))), firstStepUnitsP50: r0(med(xs.map((e) => e.st[0][UN]))), episodeUnitsP50: r0(med(xs.map((e) => e.units))), sources: xs.reduce((m, e) => ((m[e.handshake ? 'handshake' : e.source] = (m[e.handshake ? 'handshake' : e.source] || 0) + 1), m), {}) }; }
const firstStep = {};
for (const s of sessions) { if (!SUP.includes(s.layer)) continue; for (const x of s.d) { if (x.at < FROM || x.at >= TO || !x.st.length || x.st[0][C] < 20e3) continue; const f = (firstStep[x.source] ||= { warm: 0, cold: 0, coldUnitsPerCtx: [], warmUnitsPerCtx: [] }); const cold = x.st[0][R] < 0.5 * x.st[0][C]; f[cold ? 'cold' : 'warm']++; f[cold ? 'coldUnitsPerCtx' : 'warmUnitsPerCtx'].push(x.st[0][UN] / x.st[0][C]); } }
for (const f of Object.values(firstStep)) { f.coldUnitsPerCtx = f.coldUnitsPerCtx.length ? r2(med(f.coldUnitsPerCtx)) : null; f.warmUnitsPerCtx = f.warmUnitsPerCtx.length ? +med(f.warmUnitsPerCtx).toFixed(3) : null; }
// Minutes from delivery to first act in held acted episodes (the latency a fresh step would add to).
const heldLatency = {}; for (const L of SUP) { const xs = live.filter((e) => e.layer === L && e.acted).map((e) => e.st.find((x) => ACTED.has(x[8]))?.[9]).filter((x) => x != null); heldLatency[L] = { p50: r2(med(xs) / 60e3), p75: r2(q(xs, 0.75) / 60e3) }; }

// Part 3: the relay.
let mShare = null; // share of acted episodes the blind coders both marked M (a mechanical action that code could take)
if (existsSync(codesDir)) {
  const files = readdirSync(codesDir).filter((f) => /^coder[A-Z]-\d+\.json$/.test(f));
  const by = {}; for (const f of files) { const coder = f.match(/coder([A-Z])/)?.[1]; for (const c of JSON.parse(readFileSync(join(codesDir, f), 'utf8'))) (by[c.card] ||= {})[coder] = c; }
  const both = Object.values(by).filter((x) => x.A && x.B); if (both.length) mShare = sum(both.map((x) => (x.A.mj === 'M') + (x.B.mj === 'M'))) / (2 * both.length);
}
const ROLE_OF = { Runner: 'leg', leg: 'leg', stepper: 'stepper', autopilot: 'autopilot' }; // no fresh Runner start in September; a leg is the nearest supervisor role
const orient = (L, p) => { const v = fresh[ROLE_OF[L]].map((x) => x.units); return q(v, p); };
const ctxFresh = (L) => med(fresh[ROLE_OF[L]].map((x) => x.ctx));
const bootU = (L) => med(fresh[ROLE_OF[L]].filter((x) => x.bootstrapped).map((x) => x.boot)) || 0;
// A session's first prompt before it reads anything: system prompt, tools and standing files.
const BASE = med(sessions.filter((s) => s.d[0]?.st[0] && s.d[0].at >= FROM && s.d[0].at < TO).map((s) => s.d[0].st[0][C]));
// Re-price an episode's steps as if each prompt carried `ctx` tokens at entry instead of the held context.
function reprice(e, ctx) {
  const shift = ctx - e.ctx0; let u = 0;
  e.st.forEach((x, i) => { const read = Math.max(0, x[R] + shift); const cold = i === 0 && e.cold; u += x[T] * (x[I] + 5 * x[O] + 0.1 * read + (cold ? 0 : 2 * x[W1] + 1.25 * x[W5])); });
  return u;
}
// Episodes in held order, with the gap since the session's previous episode and previous acted episode, for the cache-expiry penalty.
{ const bySess = new Map(); for (const e of eps) (bySess.get(e.session) || bySess.set(e.session, []).get(e.session)).push(e);
  for (const v of bySess.values()) { v.sort((a, b) => (a.at < b.at ? -1 : 1)); let prev = null; let prevActed = null; for (const e of v) { e.gapAny = prev ? Date.parse(e.at) - Date.parse(prev.at) : null; e.gapActed = prevActed ? Date.parse(e.at) - Date.parse(prevActed.at) : null; prev = e; if (e.acted) prevActed = e; } } }
const HOUR = 3600e3;
// Modes for an acted episode: 'fresh' (today's fresh-start orientation plus a handoff), 'lean' (a fresh session that reads only the
// handoff: BASE + H), 'held' (stays in the held session; if quiet wakes no longer arrive and the last acted wake was over an hour ago
// while some wake came within the hour, the first step re-writes the whole context to cache, as a cold resume does).
function relayCost(e, sc) {
  const mode = sc.layers?.[e.layer] || sc.acted;
  if (!e.acted) return mode === 'keep' ? e.units : 0;
  if (mode === 'keep') return e.units;
  if (mode === 'held') { const ttl = sc.ttl || HOUR; let u = e.units; if (!e.cold && e.gapActed != null && e.gapActed > ttl && e.gapAny <= ttl) u += e.st[0][T] * e.ctx0 * (2 - 0.1); return u; }
  if (mode === 'lean') return 2 * (BASE + sc.handoff) * e.st[0][T] + reprice(e, BASE + sc.handoff);
  return orient(e.layer, sc.orientQ) + (sc.bootstrap ? bootU(e.layer) : 0) + 2 * sc.handoff + reprice(e, ctxFresh(e.layer) + sc.handoff);
}
const SCEN = {
  central: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: true, mToCode: false },
  dear: { acted: 'fresh', orientQ: 0.75, handoff: 50e3, bootstrap: true, mToCode: false },
  cheap: { acted: 'fresh', orientQ: 0.25, handoff: 5e3, bootstrap: false, mToCode: true },
  leanCentral: { acted: 'lean', handoff: 20e3, mToCode: false },
  leanDear: { acted: 'lean', handoff: 60e3, mToCode: false },
  leanCheap: { acted: 'lean', handoff: 10e3, mToCode: true },
  hybrid: { acted: 'held', mToCode: false },
  hybridCheap: { acted: 'held', mToCode: true },
  hybridDear: { acted: 'held', mToCode: false, ttl: 5 * 60e3 }, // as if the cache lived five minutes, not an hour
  split: { acted: 'fresh', orientQ: 0.5, handoff: 20e3, bootstrap: true, mToCode: false, layers: { leg: 'held', stepper: 'held' } },
};
const fleetUnits = sum(sessions.flatMap((s) => s.d.filter((x) => x.at >= FROM && x.at < TO).flatMap((x) => x.st.map((y) => y[UN]))));
const heldUnits = sum(eps.map((e) => e.units));
const part3 = { fleetUnitsM: r2(fleetUnits / 1e6), heldEpisodeUnitsM: r2(heldUnits / 1e6), heldShareOfFleet: pct(heldUnits, fleetUnits), baseCtx: BASE, mShareOfActed: mShare == null ? null : r2(mShare), scenarios: {} };
// Mechanical acted episodes go to code in the *Cheap scenarios: their cost is scaled by the coders' J share.
const relayOf = (e, sc) => { const c = relayCost(e, sc); return sc.mToCode && mShare != null && e.acted ? c * (1 - mShare) : c; };
for (const [k, sc] of Object.entries(SCEN)) {
  const byL = {}; for (const L of SUP) { const xs = eps.filter((e) => e.layer === L); const t = sum(xs.map((e) => e.units)); const r = sum(xs.map((e) => relayOf(e, sc))); byL[L] = { todayM: r2(t / 1e6), relayM: r2(r / 1e6), change: pct(r - t, t) }; }
  const t = heldUnits; const r = sum(eps.map((e) => relayOf(e, sc)));
  part3.scenarios[k] = { ...sc, heldTodayM: r2(t / 1e6), heldRelayM: r2(r / 1e6), heldChange: pct(r - t, t), fleetChange: pct(r - t, fleetUnits), byLayer: byL };
}
part3.hybridColdPenalties = eps.filter((e) => e.acted && !e.cold && e.gapActed != null && e.gapActed > HOUR && e.gapAny <= HOUR).length;
// Sensitivity to handoff size, for the relay with today's orientation and for the lean relay.
part3.handoffSensitivity = [0, 5e3, 10e3, 20e3, 50e3, 100e3, 200e3].map((h) => { const f = sum(eps.map((e) => relayOf(e, { ...SCEN.central, handoff: h }))); const l = sum(eps.map((e) => relayOf(e, { ...SCEN.leanCentral, handoff: h }))); return { handoffK: h / 1e3, freshFleetChange: pct(f - heldUnits, fleetUnits), leanFleetChange: pct(l - heldUnits, fleetUnits) }; });
// Break-even: the handoff at which each relay costs what holding does.
for (const [name, sc] of [['fresh', SCEN.central], ['lean', SCEN.leanCentral]]) { let lo = 0; let hi = 2e6; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; const r = sum(eps.map((e) => relayOf(e, { ...sc, handoff: mid }))); if (r < heldUnits) lo = mid; else hi = mid; } (part3.breakEvenHandoffK ||= {})[name] = r0(lo / 1e3); }
// The acted episodes alone: what a fresh judgement step costs against the held wake it replaces.
{ const a = eps.filter((e) => e.acted); part3.actedEpisodes = { n: a.length, heldM: r2(sum(a.map((e) => e.units)) / 1e6), freshCentralM: r2(sum(a.map((e) => relayCost(e, SCEN.central))) / 1e6), leanCentralM: r2(sum(a.map((e) => relayCost(e, SCEN.leanCentral))) / 1e6), orientShareOfFresh: pct(sum(a.map((e) => orient(e.layer, 0.5) + bootU(e.layer))), sum(a.map((e) => relayCost(e, SCEN.central)))) }; const qn = eps.filter((e) => !e.acted); part3.quietEpisodes = { n: qn.length, heldM: r2(sum(qn.map((e) => e.units)) / 1e6), shareOfFleet: pct(sum(qn.map((e) => e.units)), fleetUnits) }; }

// Per merged change, both charging rules.
const merged = new Map(); // ticket -> repo set
for (const [repo, dir] of [['LV', '.'], ['SD', sdDir]]) {
  const log = execFileSync('git', ['-C', dir, 'log', 'origin/main', '--first-parent', '--since', '2026-09-01T00:00:00Z', '--until', '2026-09-30T23:59:59Z', '--format=%s%x1f%b%x1e'], { encoding: 'utf8' });
  for (const c of log.split('\x1e')) for (const id of new Set((c.match(/lin-\d+/gi) || []).map((x) => x.toUpperCase()))) (merged.get(id) || merged.set(id, new Set()).get(id)).add(repo);
}
const firstSeen = new Map(); for (const s of sessions) if (s.issue && s.first) firstSeen.set(s.issue, firstSeen.has(s.issue) && firstSeen.get(s.issue) < s.first ? firstSeen.get(s.issue) : s.first);
const cohort = [...merged.keys()].filter((id) => firstSeen.has(id) && firstSeen.get(id) >= '2026-08-30' && !['LIN-3099', 'LIN-2888'].includes(id));
const inCohort = new Set(cohort);
const perTicket = (rule, sc) => {
  const m = new Map(); const add = (id, k, v) => { if (!inCohort.has(id)) return; const t = m.get(id) || m.set(id, { today: 0, relay: 0, todayDisp: 0, relayDisp: 0 }).get(id); t[k] += v; };
  const epKey = new Set(eps.map((e) => e.session + e.at));
  for (const s of sessions) {
    // Everything that is not a held-supervisor episode is unchanged by the relay, charged to the session's ticket.
    for (const x of s.d) { if (x.at < FROM || x.at >= TO) continue; if (SUP.includes(s.layer) && s.taskN != null && x.n > s.taskN) continue; const u = sum(x.st.map((y) => y[UN])); add(s.issue, 'today', u); add(s.issue, 'relay', u); }
    if (s.taskAt >= FROM && s.taskAt < TO) { add(s.issue, 'todayDisp', 1); add(s.issue, 'relayDisp', 1); }
  }
  for (const e of eps) { const id = rule === 'child' ? (e.child || e.itemIssue || e.issue) : e.issue; add(id, 'today', e.units); add(id, 'relay', relayOf(e, sc)); add(id, 'todayDisp', 1); if (e.acted) add(id, 'relayDisp', 1); }
  return m;
};
part3.perMergedChange = {};
for (const rule of ['child', 'session']) for (const [k, sc] of Object.entries(SCEN)) {
  const m = perTicket(rule, sc); const rows = [...m.entries()];
  for (const repo of ['LV', 'SD', 'all']) {
    const rs = rows.filter(([id]) => repo === 'all' || merged.get(id).has(repo)); if (!rs.length) continue;
    const t = rs.map(([, v]) => v.today); const r = rs.map(([, v]) => v.relay);
    (part3.perMergedChange[rule] ||= {})[`${k}:${repo}`] = { changes: rs.length, meanTodayM: r2(sum(t) / rs.length / 1e6), meanRelayM: r2(sum(r) / rs.length / 1e6), ratio: r2(sum(r) / sum(t)), medianTodayM: r2(med(t) / 1e6), medianRelayM: r2(med(r) / 1e6), dispatchesToday: r2(sum(rs.map(([, v]) => v.todayDisp)) / rs.length), dispatchesRelay: r2(sum(rs.map(([, v]) => v.relayDisp)) / rs.length) };
  }
}
part3.cohort = { merged: merged.size, inCohort: cohort.length, LV: cohort.filter((id) => merged.get(id).has('LV')).length, SD: cohort.filter((id) => merged.get(id).has('SD')).length };

// Part 5 (transcript side): when the runner re-asks a session (failsafe re-confirm, silence re-fire), does it answer from the record or from memory?
const recov = {};
for (const s of sessions) for (const x of s.d) {
  if (!['failsafe-reconfirm', 'silence-refire'].includes(x.source) || x.at < FROM || x.at >= TO) continue;
  const role = SUP.includes(s.layer) ? 'supervisor' : 'worker'; const k = `${x.source}:${role}`;
  const f = (recov[k] ||= { n: 0, readFirst: 0, noTool: 0, acted: 0, cold: 0 }); f.n++;
  const firstTool = x.st.find((y) => y[8] !== 'none'); if (!firstTool) f.noTool++; else if (firstTool[8] === 'read') f.readFirst++;
  if (ACTED.has(x.outcome)) f.acted++; if (x.st[0] && x.st[0][R] < 0.5 * x.st[0][C]) f.cold++;
}

// What the cold resumes cost in all, against the same role started fresh (to first decision, with the bootstrap) at that moment.
{ const xs = eps.filter((e) => e.cold); const first = sum(xs.map((e) => e.st[0][UN])); const freshAlt = sum(xs.map((e) => orient(e.layer, 0.5) + bootU(e.layer))); coldResumes.all = { n: xs.length, firstStepM: r2(first / 1e6), episodesM: r2(sum(xs.map((e) => e.units)) / 1e6), freshInsteadM: r2(freshAlt / 1e6), firstStepShareOfFleet: pct(first, fleetUnits), coldUnitsPerCtx: firstStep['resume-handshake'].coldUnitsPerCtx, breakEvenCtx: Object.fromEntries(SUP.map((L) => [L, r0((orient(L, 0.5) + bootU(L)) / firstStep['resume-handshake'].coldUnitsPerCtx)])) }; }
const result = { window: [FROM, TO], episodes: eps.length, part1, scatter, part2, coldResumes, firstStep, heldLatency, part3, recoveries: recov };
writeFileSync(out, JSON.stringify(result));
const show = { ...result }; delete show.scatter;
console.log(JSON.stringify(show, null, 1));
