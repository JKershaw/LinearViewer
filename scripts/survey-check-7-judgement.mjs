// LIN-3183: survey-check-7.md's fresh blind double-coding of where-judgement-happens.md. Two new coders (C, D) coded a systematic
// sample of the tickets reader B did not code, blind to each other and to reader A, from the same codebook and digests. This scores
// every pair (C–D, A–C, A–D) with survey-judgement-analyse.mjs's matching rule: decisions match within a ticket on the same cycle and
// type, failing that on the same cycle, each at most once; wrong turns match on the same cycle and type.
// Usage: node scripts/survey-check-7-judgement.mjs [--codes docs/papers/harbour/where-judgement-happens-codes.json] [--check docs/papers/harbour/survey-check-7-codes.json] [--c data/survey-judgement/codes-C] [--d data/survey-judgement/codes-D] [--sample data/survey-judgement/check7-sample.json] [--cycles data/survey-judgement/cycles.json] [--judgement-sample data/survey-judgement/sample.json]
// With the coder directories present it writes both codings to --check; otherwise it scores --check, so the figures re-run from git
// alone. No proxy calls.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const A = J(arg('--codes', 'docs/papers/harbour/where-judgement-happens-codes.json')).readerA;
const target = arg('--check', 'docs/papers/harbour/survey-check-7-codes.json');
const cDir = arg('--c', 'data/survey-judgement/codes-C'); const dDir = arg('--d', 'data/survey-judgement/codes-D');
let data;
if (existsSync(cDir) && existsSync(dDir)) {
  const load = (dir) => Object.fromEntries(readdirSync(dir).filter((f) => /^LIN-\d+\.json$/.test(f)).sort().map((f) => { const x = J(join(dir, f)); return [x.ticket, x]; }));
  const sample = J(arg('--sample', 'data/survey-judgement/check7-sample.json'));
  data = { about: 'LIN-3183 (survey-check-7.md). A fresh blind double-coding of where-judgement-happens.md: coders C and D (frontier tier, each split across three in-session agents, D reading in reverse order) coded every third of the 26 sampled tickets reader B did not code, from scripts/survey-judgement-codebook.md and the digests survey-judgement-digests.mjs rebuilt on 1 October, blind to reader A and to each other.', sample, coderC: load(cDir), coderD: load(dDir) };
  writeFileSync(target, JSON.stringify(data, null, 1) + '\n');
} else data = J(target);
const tickets = data.sample.tickets.filter((t) => data.coderC[t] && data.coderD[t]);

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const kappa = (ps, f) => {
  const n = ps.length; if (!n) return null; const cats = [...new Set(ps.flatMap(([x, y]) => [f(x), f(y)]))];
  const po = ps.filter(([x, y]) => f(x) === f(y)).length / n;
  const pe = cats.reduce((s, k) => s + (ps.filter(([x]) => f(x) === k).length / n) * (ps.filter(([, y]) => f(y) === k).length / n), 0);
  return { agree: pct(po * n, n), kappa: pe === 1 ? 1 : Math.round(((po - pe) / (1 - pe)) * 100) / 100, n };
};
const mix = (ds) => ds.reduce((m, d) => ((m[d.class] = (m[d.class] || 0) + 1), m), { a: 0, b: 0, c: 0 });
function score(X, Y) {
  const pairs = []; let onlyX = 0; let onlyY = 0; let sameType = 0; const wPairs = []; let wX = 0; let wY = 0;
  for (const t of tickets) {
    const a = (X[t]?.decisions || []).map((d) => ({ ...d })); const b = (Y[t]?.decisions || []).map((d) => ({ ...d }));
    for (const pass of ['strict', 'cycle']) for (const x of a) {
      if (x.m) continue;
      const y = b.find((y) => !y.m && y.cycle === x.cycle && (pass === 'cycle' || y.type === x.type));
      if (y) { x.m = y.m = true; pairs.push([x, y]); if (x.type === y.type) sameType++; }
    }
    onlyX += a.filter((x) => !x.m).length; onlyY += b.filter((x) => !x.m).length;
    const wa = X[t]?.wrongTurns || []; const wb = (Y[t]?.wrongTurns || []).map((w) => ({ ...w })); wX += wa.length; wY += wb.length;
    for (const x of wa) { const y = wb.find((y) => !y.m && y.type === x.type && y.cycle === x.cycle); if (y) { y.m = true; wPairs.push([x, y]); } }
  }
  return {
    decisionsX: pairs.length + onlyX, decisionsY: pairs.length + onlyY, matched: pairs.length, sameType,
    class: kappa(pairs, (d) => d.class), contextVsRest: kappa(pairs, (d) => (d.class === 'c' ? 'c' : 'ab')),
    sides: pairs.reduce((m, [x, y]) => ((m[x.class + y.class] = (m[x.class + y.class] || 0) + 1), m), {}),
    mixX: mix(tickets.flatMap((t) => X[t]?.decisions || [])), mixY: mix(tickets.flatMap((t) => Y[t]?.decisions || [])),
    wrongTurnsX: wX, wrongTurnsY: wY, wrongTurnsMatched: wPairs.length,
    freshSession: kappa(wPairs, (w) => w.freshSession), multiLayerNeeded: kappa(wPairs, (w) => w.multiLayerNeeded),
    freshYesShare: { X: pct(tickets.flatMap((t) => X[t]?.wrongTurns || []).filter((w) => w.freshSession === 'yes').length, wX), Y: pct(tickets.flatMap((t) => Y[t]?.wrongTurns || []).filter((w) => w.freshSession === 'yes').length, wY) },
    multiLayerYesShare: { X: pct(tickets.flatMap((t) => X[t]?.wrongTurns || []).filter((w) => w.multiLayerNeeded === 'yes').length, wX), Y: pct(tickets.flatMap((t) => Y[t]?.wrongTurns || []).filter((w) => w.multiLayerNeeded === 'yes').length, wY) },
  };
}
// Who decides, by group, per coder (the paper's "judgement concentrates at the gates" claim, re-read).
const GROUP = (r) => (['plan-review', 'review', 'close-out'].includes(r) ? 'gates' : ['Runner', 'leg', 'stepper', 'autopilot', 'wake'].includes(r) ? 'supervisors' : ['research', 'plan', 'implementation', 'other-worker'].includes(r) ? 'makers' : r === 'John' ? 'John' : 'other');
const groups = (X) => { const m = {}; for (const t of tickets) for (const d of X[t]?.decisions || []) { const g = GROUP(d.role); m[g] ||= { n: 0, c: 0 }; m[g].n++; if (d.class === 'c') m[g].c++; } return m; };
const out = { tickets, CD: score(data.coderC, data.coderD), AC: score(A, data.coderC), AD: score(A, data.coderD), groups: { A: groups(A), C: groups(data.coderC), D: groups(data.coderD) } };
// With the cycle table (survey-judgement-digests.mjs), the cost side: each reader's share of the nine tickets' cost in cycles holding a
// decision (charged to the session entered, as the paper's class split), and option 1's size split into what wake filtering reaches
// (quiet wake cycles, the completion gates that follow them, and their resume handshakes) against the rest of the supervisors'
// bookkeeping (gates after working turns, launches, handshakes), under both charging rules, sampled and re-weighted to the population.
const cyclesFile = arg('--cycles', 'data/survey-judgement/cycles.json');
if (existsSync(cyclesFile)) {
  const cycles = J(cyclesFile); const T = new Set(tickets); const SUP = new Set(['autopilot', 'stepper', 'leg', 'Runner']);
  const placed = (X, ts) => { const m = {}; for (const t of ts) for (const d of X[t]?.decisions || []) if (/^S\d+\.\d+$/.test(d.cycle)) { const k = `${t}|${d.cycle}`; if (!m[k] || d.class > m[k]) m[k] = d.class; } return m; };
  out.costOnNine = {};
  for (const [name, X] of [['A', A], ['C', data.coderC], ['D', data.coderD]]) {
    const cls = placed(X, T); const xs = cycles.filter((c) => c.sessionEntered && T.has(c.ticket)); const tot = xs.reduce((s, c) => s + c.units, 0);
    const u = { a: 0, b: 0, c: 0 }; let sup = 0; let supD = 0;
    for (const c of xs) { const z = cls[`${c.ticket}|${c.cycle}`]; if (z) u[z] += c.units; if (SUP.has(c.role)) { sup += c.units; if (z) supD += c.units; } }
    out.costOnNine[name] = { decisionCycles: pct(u.a + u.b + u.c, tot), a: pct(u.a, tot), b: pct(u.b, tot), c: pct(u.c, tot), supervisorsInDecisionCycles: pct(supD, sup) };
  }
  const sample = J(arg('--judgement-sample', 'data/survey-judgement/sample.json'));
  const cellOf = Object.fromEntries(sample.sample.map((x) => [x.id, x.cell]));
  const wCell = Object.fromEntries(Object.entries(sample.weights).filter(([, v]) => v.planned).map(([k, v]) => [k, v.population / v.planned]));
  const cls = placed(A, Object.keys(A));
  const bucket = (c) => (cls[`${c.ticket}|${c.cycle}`] ? 'decision' : c.outcome === 'act' || c.outcome === 'dispatch' ? 'work' : 'bookkeeping');
  out.option1 = {};
  for (const rule of ['sessionEntered', 'childNamed']) for (const weighting of ['sampled', 'population']) {
    const W = (c) => c.units * (weighting === 'population' ? wCell[cellOf[c.ticket]] || 0 : 1);
    const xs = cycles.filter((c) => c[rule] && A[c.ticket]); const tot = xs.reduce((s, c) => s + W(c), 0);
    const bySess = {}; for (const c of xs) (bySess[`${c.ticket}|${c.session}`] ||= []).push(c);
    let quietWake = 0; let gateAfterQuiet = 0; let handshakeBeforeQuiet = 0; let supBookkeeping = 0;
    for (const v of Object.values(bySess)) {
      v.sort((a, b) => (a.at < b.at ? -1 : 1)); let lastQuiet = false;
      v.forEach((c, i) => {
        if (!SUP.has(c.role)) return;
        if (bucket(c) === 'bookkeeping') supBookkeeping += W(c);
        if (c.source === 'completion-gate') { if (lastQuiet) gateAfterQuiet += W(c); return; }
        const wake = c.itemKind === 'wake' || c.source === 'wake-inline'; lastQuiet = wake && bucket(c) === 'bookkeeping';
        if (lastQuiet) { quietWake += W(c); if (v[i - 1]?.source === 'resume-handshake') handshakeBeforeQuiet += W(v[i - 1]); }
      });
    }
    out.option1[`${rule}|${weighting}`] = { supervisorsBookkeeping: pct(supBookkeeping, tot), quietWakes: pct(quietWake, tot), gatesAfterQuietWakes: pct(gateAfterQuiet, tot), handshakesBeforeQuietWakes: pct(handshakeBeforeQuiet, tot), wakeFilterReaches: pct(quietWake + gateAfterQuiet + handshakeBeforeQuiet, tot) };
  }
}
console.log(JSON.stringify(out, null, 1));
