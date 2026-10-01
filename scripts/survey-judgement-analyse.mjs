// LIN-3177: the census of consequential decisions (types, roles, tiers, classes), each role's cost share around them under both charging rules, the wrong-turn table, and two-reader agreement.
// Usage: node scripts/survey-judgement-analyse.mjs [--codes docs/papers/harbour/where-judgement-happens-codes.json] [--cycles data/survey-judgement/cycles.json] [--sample data/survey-judgement/sample.json] [--out data/survey-judgement/analysis.json]
// Reads reader A's codes for every sampled ticket (the census) and reader B's for the blind sub-sample (agreement only). A cycle is
// "decision" if reader A put a consequential decision in it, "work" if it acted or dispatched without one (doing or checking the
// work, routine approves, routine dispatches), and "bookkeeping" otherwise (bootstrap summaries, gate replies, handshakes, reads and
// re-arms). Cost is weighted units (survey-wake-extract.mjs weights). Each figure is given charged to the session entered and charged
// to the child the log names; pooled across tickets as sampled, and re-weighted to the population by cell (population / drawn).
// Wrong turns coded "other" are split after coding by the reader's own cause and evidence: the recommend engine's misroutes, faults of a
// service or the host (cause infra), and defects found in a plan, ticket or merged change (cause real-fault). With --ci (from
// survey-judgement-ci.mjs) the red CI runs on the sampled tickets' PRs are counted from GitHub as a check on the digests.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const codes = JSON.parse(readFileSync(arg('--codes', 'docs/papers/harbour/where-judgement-happens-codes.json'), 'utf8'));
const cycles = JSON.parse(readFileSync(arg('--cycles', 'data/survey-judgement/cycles.json'), 'utf8'));
const sampleFile = JSON.parse(readFileSync(arg('--sample', 'data/survey-judgement/sample.json'), 'utf8'));
const out = arg('--out', 'data/survey-judgement/analysis.json');
const ciFile = arg('--ci', 'data/survey-judgement/ci.json');

const sample = sampleFile.sample;
const cellOf = Object.fromEntries(sample.map((s) => [s.id, s.cell]));
const repoOf = Object.fromEntries(sample.map((s) => [s.id, s.repos.includes('simple-dispatcher') ? 'SD' : 'LV']));
const wCell = Object.fromEntries(Object.entries(sampleFile.weights).filter(([, v]) => v.planned).map(([k, v]) => [k, v.population / v.planned]));
const w = (t) => wCell[cellOf[t]] || 0;
const A = codes.readerA; const B = codes.readerB;
const by = (xs, f, wt = () => 1) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + wt(x); return m; }, {});
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const SUP = new Set(['Runner', 'leg', 'stepper', 'autopilot', 'wake']);
const roleGroup = (r) => (r === 'custom' || r === 'research' ? 'research/custom' : ['plan', 'plan-review', 'implementation', 'review', 'close-out'].includes(r) || SUP.has(r) ? r : 'other worker');

// ---- 1. The census.
const decisions = Object.values(A).flatMap((t) => t.decisions.map((d) => ({ ...d, ticket: t.ticket })));
const census = {
  tickets: Object.keys(A).length,
  decisions: decisions.length,
  perTicket: Object.fromEntries(Object.values(A).map((t) => [t.ticket, t.decisions.length])),
  byType: by(decisions, (d) => d.type),
  byClass: by(decisions, (d) => d.class),
  byClassWeighted: by(decisions, (d) => d.class, (d) => w(d.ticket)),
  byRole: by(decisions, (d) => d.role),
  byTier: by(decisions, (d) => d.tier),
  byRepo: by(decisions, (d) => repoOf[d.ticket]),
  byRepoClass: by(decisions, (d) => `${repoOf[d.ticket]}|${d.class}`),
  byTypeClass: by(decisions, (d) => `${d.type}|${d.class}`),
  byRoleClass: by(decisions, (d) => `${d.role}|${d.class}`),
  byEffect: by(decisions, (d) => d.effect),
  byEffectClass: by(decisions, (d) => `${d.effect}|${d.class}`),
  basis: by(decisions.flatMap((d) => (d.basis || []).map((b) => ({ b, c: d.class }))), (x) => `${x.b}|${x.c}`),
  byCell: by(decisions, (d) => cellOf[d.ticket]),
  ticketsWithNone: Object.values(A).filter((t) => !t.decisions.length).map((t) => t.ticket),
};

// ---- 2. Cost by role, under both charging rules.
const decisionCycles = new Set(decisions.filter((d) => /^S\d+\.\d+$/.test(d.cycle)).map((d) => `${d.ticket}|${d.cycle}`));
const bucket = (c) => (decisionCycles.has(`${c.ticket}|${c.cycle}`) ? 'decision' : c.outcome === 'act' || c.outcome === 'dispatch' ? 'work' : 'bookkeeping');
const cost = {};
for (const rule of ['sessionEntered', 'childNamed']) {
  for (const weighting of ['sampled', 'population']) {
    const m = {};
    for (const c of cycles) {
      if (!c[rule] || !A[c.ticket]) continue;
      const r = roleGroup(c.role); const u = c.units * (weighting === 'population' ? w(c.ticket) : 1);
      m[r] ||= { decision: 0, work: 0, bookkeeping: 0 };
      m[r][bucket(c)] += u;
    }
    const tot = Object.values(m).reduce((s, x) => s + x.decision + x.work + x.bookkeeping, 0);
    const all = { decision: 0, work: 0, bookkeeping: 0 };
    for (const x of Object.values(m)) for (const k in all) all[k] += x[k];
    // Groups: the supervisors, the gates (plan-review, review, close-out) and the makers (research, plan, implementation, other).
    const GROUPS = { supervisors: ['autopilot', 'stepper', 'leg', 'Runner', 'wake'], gates: ['plan-review', 'review', 'close-out'], makers: ['research/custom', 'plan', 'implementation', 'other worker'] };
    const groups = Object.fromEntries(Object.entries(GROUPS).map(([g, rs]) => { const x = { decision: 0, work: 0, bookkeeping: 0 }; for (const r of rs) if (m[r]) for (const k in x) x[k] += m[r][k]; const t = x.decision + x.work + x.bookkeeping; return [g, { shareOfTicketCost: pct(t, tot), decision: pct(x.decision, t), work: pct(x.work, t), bookkeeping: pct(x.bookkeeping, t) }]; }));
    cost[`${rule}|${weighting}`] = {
      groups,
      roles: Object.fromEntries(Object.entries(m).map(([r, x]) => { const t = x.decision + x.work + x.bookkeeping; return [r, { shareOfTicketCost: pct(t, tot), decision: pct(x.decision, t), work: pct(x.work, t), bookkeeping: pct(x.bookkeeping, t) }]; })),
      all: { decision: pct(all.decision, tot), work: pct(all.work, tot), bookkeeping: pct(all.bookkeeping, tot) },
    };
  }
}
// Cost per decision class: units in the cycles holding a decision of each class (a cycle with several takes the highest class).
const clsOfCycle = {};
for (const d of decisions) { const k = `${d.ticket}|${d.cycle}`; if (!clsOfCycle[k] || d.class > clsOfCycle[k]) clsOfCycle[k] = d.class; }
const unitsByClass = { a: 0, b: 0, c: 0 }; let unitsAll = 0;
for (const c of cycles) { if (!c.sessionEntered || !A[c.ticket]) continue; unitsAll += c.units; const k = clsOfCycle[`${c.ticket}|${c.cycle}`]; if (k) unitsByClass[k] += c.units; }
cost.byDecisionClass = Object.fromEntries(Object.entries(unitsByClass).map(([k, v]) => [k, pct(v, unitsAll)]));
// Where decisions sit by tier: share of tier units in decision cycles.
const tierUnits = {};
for (const c of cycles) { if (!c.sessionEntered || !A[c.ticket]) continue; const t = c.tier || '?'; tierUnits[t] ||= { all: 0, decision: 0 }; tierUnits[t].all += c.units; if (bucket(c) === 'decision') tierUnits[t].decision += c.units; }
cost.byTier = Object.fromEntries(Object.entries(tierUnits).map(([k, v]) => [k, { share: pct(v.all, unitsAll), decision: pct(v.decision, v.all) }]));

// ---- 3. Wrong turns.
const wrong = Object.values(A).flatMap((t) => (t.wrongTurns || []).map((x) => ({ ...x, ticket: t.ticket })));
const sub = (x) => (x.type !== 'other' ? x.type : /\bengine\b|recommend/i.test(x.evidence || '') ? 'other: engine misroute' : x.cause === 'infra' ? 'other: service or host fault' : x.cause === 'real-fault' ? 'other: defect in a plan, ticket or change' : `other: ${x.cause}`);
const wrongTurns = {
  total: wrong.length,
  bySubtype: Object.fromEntries(Object.entries(by(wrong, sub)).map(([k, n]) => { const xs = wrong.filter((x) => sub(x) === k); return [k, { n, tickets: new Set(xs.map((x) => x.ticket)).size, multiLayerNeeded: by(xs, (x) => x.multiLayerNeeded), freshSession: by(xs, (x) => x.freshSession), classOfReaction: by(xs, (x) => x.classOfReaction), firstReactor: by(xs, (x) => x.reacted?.[0] || 'none') }]; })),
  multiLayerByClass: by(wrong, (x) => `${x.multiLayerNeeded}|${x.classOfReaction}`),
  multiLayerFresh: by(wrong.filter((x) => x.multiLayerNeeded === 'yes'), (x) => x.freshSession),
  multiLayerJohn: wrong.filter((x) => x.multiLayerNeeded === 'yes' && (x.reacted || []).includes('John')).length,
  tickets: new Set(wrong.map((x) => x.ticket)).size,
  byType: Object.fromEntries(Object.entries(by(wrong, (x) => x.type)).map(([k, n]) => {
    const xs = wrong.filter((x) => x.type === k);
    return [k, { n, tickets: new Set(xs.map((x) => x.ticket)).size, cause: by(xs, (x) => x.cause), firstReactor: by(xs, (x) => x.reacted?.[0] || 'none'), meanModelLayers: Math.round((10 * xs.reduce((s, x) => s + (x.modelLayers || 0), 0)) / n) / 10, multiLayerNeeded: by(xs, (x) => x.multiLayerNeeded), freshSession: by(xs, (x) => x.freshSession), classOfReaction: by(xs, (x) => x.classOfReaction) }];
  })),
  multiLayerNeeded: by(wrong, (x) => x.multiLayerNeeded),
  freshSession: by(wrong, (x) => x.freshSession),
  classOfReaction: by(wrong, (x) => x.classOfReaction),
  modelLayers: by(wrong, (x) => x.modelLayers),
  reactedByRole: by(wrong.flatMap((x) => [...new Set(x.reacted || [])]), (r) => r),
};

// ---- 4. Agreement, on the tickets both readers coded. Decisions match within a ticket on the same cycle and type; failing that, on
// the same cycle; each decision matches at most once.
const pairs = []; let onlyA = 0; let onlyB = 0; const typeAgree = { same: 0, n: 0 };
for (const t of Object.keys(B)) {
  const a = (A[t]?.decisions || []).map((d) => ({ ...d })); const b = B[t].decisions.map((d) => ({ ...d }));
  for (const pass of ['strict', 'cycle']) for (const x of a) {
    if (x.m) continue;
    const y = b.find((y) => !y.m && y.cycle === x.cycle && (pass === 'cycle' || y.type === x.type));
    if (y) { x.m = y.m = true; pairs.push([x, y]); typeAgree.n++; if (x.type === y.type) typeAgree.same++; }
  }
  onlyA += a.filter((x) => !x.m).length; onlyB += b.filter((x) => !x.m).length;
}
const kappa = (ps, f) => {
  const cats = [...new Set(ps.flatMap(([x, y]) => [f(x), f(y)]))]; const n = ps.length; if (!n) return null;
  const po = ps.filter(([x, y]) => f(x) === f(y)).length / n;
  const pe = cats.reduce((s, k) => s + (ps.filter(([x]) => f(x) === k).length / n) * (ps.filter(([, y]) => f(y) === k).length / n), 0);
  return { agree: pct(po * n, n), kappa: pe === 1 ? 1 : Math.round(((po - pe) / (1 - pe)) * 100) / 100, n };
};
const wPairs = [];
for (const t of Object.keys(B)) for (const x of A[t]?.wrongTurns || []) { const y = (B[t].wrongTurns || []).find((y) => !y.m && y.type === x.type && y.cycle === x.cycle); if (y) { y.m = true; wPairs.push([x, y]); } }
const agreement = {
  tickets: Object.keys(B).length,
  decisionsA: pairs.length + onlyA, decisionsB: pairs.length + onlyB, matched: pairs.length, onlyA, onlyB,
  type: typeAgree,
  class: kappa(pairs, (d) => d.class),
  classJudgementVsNot: kappa(pairs, (d) => (d.class === 'c' ? 'c' : 'ab')),
  classBSides: by(pairs, ([x, y]) => `${x.class}${y.class}`),
  wrongTurnsA: Object.keys(B).reduce((s, t) => s + (A[t]?.wrongTurns || []).length, 0), wrongTurnsB: Object.keys(B).reduce((s, t) => s + (B[t].wrongTurns || []).length, 0), wrongTurnsMatched: wPairs.length,
  freshSession: kappa(wPairs, (x) => x.freshSession),
  multiLayerNeeded: kappa(wPairs, (x) => x.multiLayerNeeded),
};
// The class mix if reader B's classes stood on the matched decisions, for the paper's range.
const swapped = { a: 0, b: 0, c: 0 }; for (const [, y] of pairs) swapped[y.class]++;
const orig = { a: 0, b: 0, c: 0 }; for (const [x] of pairs) orig[x.class]++;
agreement.matchedMixA = orig; agreement.matchedMixB = swapped;

// Per ticket: decisions by size band and repo, and the CI check.
const per = sample.map((t) => ({ id: t.id, cell: t.cell, band: t.cell.split('|')[0], repo: repoOf[t.id], n: A[t.id]?.decisions.length || 0, c: (A[t.id]?.decisions || []).filter((d) => d.class === 'c').length }));
const median = (xs) => { const v = xs.slice().sort((a, b) => a - b); return v.length ? (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2 : null; };
census.perTicketMedian = median(per.map((x) => x.n));
census.byBand = Object.fromEntries(['0', '1-49', '50-299', '300+'].map((b) => { const xs = per.filter((x) => x.band === b); return [b, { tickets: xs.length, median: median(xs.map((x) => x.n)), total: xs.reduce((s, x) => s + x.n, 0), c: xs.reduce((s, x) => s + x.c, 0) }]; }));
census.byRepoTickets = Object.fromEntries(['LV', 'SD'].map((r) => { const xs = per.filter((x) => x.repo === r); return [r, { tickets: xs.length, median: median(xs.map((x) => x.n)), total: xs.reduce((s, x) => s + x.n, 0) }]; }));
census.weightedPerTicket = Math.round((10 * per.reduce((s, x) => s + x.n * w(x.id), 0)) / per.reduce((s, x) => s + w(x.id), 0)) / 10;
census.highConfidence = by(decisions.filter((d) => d.confidence === 'high'), (d) => d.class);
let ci = null;
if (existsSync(ciFile)) {
  const C = JSON.parse(readFileSync(ciFile, 'utf8')); const prs = Object.values(C).flatMap((t) => t.prs);
  ci = { prs: prs.length, runs: prs.reduce((s, p) => s + p.runs, 0), red: prs.flatMap((p) => p.red.map((r) => ({ pr: p.number, repo: p.repo, ...r }))), ticketsWithRed: Object.entries(C).filter(([, t]) => t.prs.some((p) => p.red.length)).map(([k]) => k), codedRedCi: wrong.filter((x) => x.type === 'red-ci').length };
}
// Wakes on the sampled tickets under both rules, and how many of them sat in a cycle holding a decision.
const wakes = {};
for (const rule of ['sessionEntered', 'childNamed']) {
  const xs = cycles.filter((c) => c[rule] && A[c.ticket] && (c.itemKind === 'wake' || c.source === 'wake-inline'));
  const perT = sample.map((t) => xs.filter((c) => c.ticket === t.id).length);
  wakes[rule] = { total: xs.length, median: median(perT), holdingDecision: xs.filter((c) => bucket(c) === 'decision').length, quiet: xs.filter((c) => bucket(c) === 'bookkeeping').length, unitsShare: pct(xs.reduce((s, c) => s + c.units, 0), cycles.filter((c) => c[rule] && A[c.ticket]).reduce((s, c) => s + c.units, 0)) };
}
const result = { census, cost, wrongTurns, agreement, ci, wakes };
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
