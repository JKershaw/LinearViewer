// LIN-3174: why planning, review and close-out legs repeat and what the repeats buy — the census by kind, week and repo, the coded sample's reasons and purchases with double-coding agreement, review findings by round from which-rules-pay's codes, convergence by ticket traits, and the repeats' cost.
// Usage: node scripts/survey-repeats-analyse.mjs [--out data/survey-repeats/analysis.json]
// Run first: survey-repeats-census.mjs, survey-repeats-sample.mjs, survey-repeats-fetch.mjs --detail … --every 3. Reads the committed
// codes (docs/papers/harbour/why-legs-repeat-codes.json) and which-rules-pay-codes.json. No proxy calls.
// Intervals are Wilson 95%. Agreement is Cohen's kappa over the sampled repeats both readers coded. A which-rules-pay finding's review
// round is the number of review legs launched on the ticket by the time its comment was posted (at least 1). Plan length is the first
// plan comment's words, on the tickets whose comments were fetched.
import { readFileSync, writeFileSync } from 'fs';
import { legOf } from './survey-rules-timeline.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'data/survey-repeats/analysis.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const census = read('data/survey-repeats/census.json');
const proxy = read('data/survey-repeats/proxy.json');
const codes = read(arg('--codes', 'docs/papers/harbour/why-legs-repeat-codes.json'));
const wrp = read('docs/papers/harbour/which-rules-pay-codes.json');
const LEGS = ['plan', 'plan-review', 'review', 'close-out'];
const tally = (xs, f) => { const m = {}; for (const x of xs) { const k = f(x); m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [+(100 * (c - h)).toFixed(0), +(100 * (c + h)).toFixed(0)]; };
const share = (k, n) => ({ k, n, pct: n ? +(100 * k / n).toFixed(0) : null, ci: wilson(k, n) });
const R = (xs) => ({ n: xs.length, first: xs.filter((l) => !l.repeat).length, repeat: xs.filter((l) => l.repeat).length });
const res = {};

// ---- 1. Census.
const { legs, tickets } = census;
res.census = { legs: R(legs), tickets: tickets.length, byKind: Object.fromEntries(LEGS.map((k) => [k, R(legs.filter((l) => l.kind === k))])) };
res.census.byRepo = Object.fromEntries(['LinearViewer', 'simple-dispatcher', 'both', 'no merge'].map((r) => [r, { ...R(legs.filter((l) => l.repo === r)), tickets: tickets.filter((t) => t.repo === r).length }]));
res.census.byMonth = Object.fromEntries(['2026-08', '2026-09'].map((m) => [m, Object.fromEntries(LEGS.map((k) => [k, R(legs.filter((l) => l.kind === k && l.at.startsWith(m)))]))]));
res.census.byHow = Object.fromEntries(['exact', 'decoded'].map((h) => [h, Object.fromEntries(LEGS.map((k) => [k, R(legs.filter((l) => l.kind === k && l.kindHow === h))]))]));
const weeks = [...new Set(legs.map((l) => l.week))].sort();
res.census.weekly = weeks.map((w) => { const ls = legs.filter((l) => l.week === w); const tk = new Set(ls.map((l) => l.issue)).size; return { week: w, tickets: tk, ...Object.fromEntries(LEGS.map((k) => [k, R(ls.filter((l) => l.kind === k))])) }; });
res.census.repeatsPerTicket = tally(tickets, (t) => LEGS.reduce((a, k) => a + Math.max(0, t.rounds[k] - 1), 0));
res.census.ticketsWithRepeat = tickets.filter((t) => LEGS.some((k) => t.rounds[k] > 1)).length;
res.census.roundsDist = Object.fromEntries(LEGS.map((k) => [k, tally(tickets.filter((t) => t.rounds[k] > 0), (t) => (t.rounds[k] >= 3 ? '3+' : String(t.rounds[k])))]));
res.census.repeatsShareTop = (() => { const per = tickets.map((t) => LEGS.reduce((a, k) => a + Math.max(0, t.rounds[k] - 1), 0)).sort((a, b) => b - a); const tot = per.reduce((a, b) => a + b, 0); const top = per.slice(0, Math.round(tickets.length / 10)).reduce((a, b) => a + b, 0); return { topDecileTickets: Math.round(tickets.length / 10), share: +(top / tot).toFixed(2) }; })();
// Repeats that ran in the same hour as the previous leg of their kind: overlaps and quick relaunches.
res.census.gapHours = Object.fromEntries(LEGS.map((k) => { const g = legs.filter((l) => l.kind === k && l.repeat && l.prevAt).map((l) => (new Date(l.at) - new Date(l.prevAt)) / 36e5); return [k, { median: +median(g).toFixed(1), underOneHour: g.filter((x) => x < 1).length, underTenMin: g.filter((x) => x < 1 / 6).length, n: g.length }]; }));

// A decoded six-letter leg can be custom, triage or design rather than review (12% of September's exact six-letter launches), so a
// review "repeat" whose every earlier review leg launched before the ticket's first implementation leg may be a first review.
const tl = new Map(tickets.map((t) => [t.issue, t.timeline]));
const suspect = legs.filter((l) => l.kind === 'review' && l.repeat).filter((l) => { const t = tl.get(l.issue); const impl = t.find(([, k]) => k === 'implementation')?.[0]; const earlier = t.filter(([at, k]) => k === 'review' && at < l.at); return earlier.length && (!impl || earlier.every(([at]) => at < impl)); });
res.census.reviewRepeatsBeforeAnyImplementation = { n: suspect.length, of: legs.filter((l) => l.kind === 'review' && l.repeat).length, byMonth: tally(suspect, (l) => l.at.slice(0, 7)) };

// ---- 2 and 3. The coded sample.
const final = codes.final; const A = new Map(codes.readers.A.map((c) => [c.digest, c])); const Bm = new Map(codes.readers.B.map((c) => [c.digest, c]));
function kappa(field, filter = () => true) {
  const ds = final.filter(filter).map((c) => c.digest).filter((d) => A.has(d) && Bm.has(d));
  const cats = [...new Set(ds.flatMap((d) => [A.get(d)[field], Bm.get(d)[field]]))];
  const n = ds.length; const agree = ds.filter((d) => A.get(d)[field] === Bm.get(d)[field]).length; const po = agree / n;
  const pe = cats.reduce((a, c) => a + (ds.filter((d) => A.get(d)[field] === c).length / n) * (ds.filter((d) => Bm.get(d)[field] === c).length / n), 0);
  return { n, agree, pctAgree: +(100 * po).toFixed(0), kappa: +((po - pe) / (1 - pe)).toFixed(2) };
}
res.agreement = { reason: kappa('reason'), bought: kappa('bought'), newFinding: kappa('newFinding', (c) => ['plan-review', 'review'].includes(c.kind)) };
res.sample = { n: final.length, tickets: new Set(final.map((c) => c.issue)).size, byKind: tally(final, (c) => c.kind) };
res.reasons = Object.fromEntries(Object.entries(tally(final, (c) => c.reason)).map(([k, v]) => [k, share(v, final.length)]));
res.reasonsByKind = Object.fromEntries(LEGS.map((k) => { const cs = final.filter((c) => c.kind === k); return [k, tally(cs, (c) => c.reason)]; }));
res.reasonsByMonth = Object.fromEntries(['2026-08', '2026-09'].map((m) => [m, tally(final.filter((c) => c.at.startsWith(m)), (c) => c.reason)]));
res.bought = Object.fromEntries(Object.entries(tally(final, (c) => c.bought)).map(([k, v]) => [k, share(v, final.length)]));
res.boughtByKind = Object.fromEntries(LEGS.map((k) => [k, tally(final.filter((c) => c.kind === k), (c) => c.bought)]));
res.boughtByReason = Object.fromEntries(Object.keys(res.reasons).map((r) => [r, tally(final.filter((c) => c.reason === r), (c) => c.bought)]));
res.boughtByRound = Object.fromEntries(['2', '3+'].map((r) => [r, tally(final.filter((c) => (r === '2' ? c.round === 2 : c.round >= 3)), (c) => c.bought)]));
// A crude reading of the readers' own notes: a repeat whose note (either reader) names a person's or a coordinator's ruling.
const RULING = /John|human|operator|ruling|ruled|coordinator/i;
const ruled = (c) => RULING.test(`${A.get(c.digest)?.note} ${Bm.get(c.digest)?.note}`);
res.rulingNamed = { round2: share(final.filter((c) => c.round === 2 && ruled(c)).length, final.filter((c) => c.round === 2).length), round3plus: share(final.filter((c) => c.round >= 3 && ruled(c)).length, final.filter((c) => c.round >= 3).length) };
const gates = final.filter((c) => ['plan-review', 'review'].includes(c.kind));
res.newFindings = Object.fromEntries(['plan-review', 'review'].map((k) => { const cs = gates.filter((c) => c.kind === k); const nf = cs.filter((c) => c.newFinding === 'yes'); return [k, { n: cs.length, newFinding: share(nf.length, cs.length), real: share(nf.filter((c) => c.real === 'yes').length, cs.length), realOfNew: share(nf.filter((c) => c.real === 'yes').length, nf.length) }]; }));

// The same, over the repeats that are real (a reason other than "other": not a misread kind or a new phase).
const real = final.filter((c) => c.reason !== 'other');
res.real = { n: real.length, changesRequested: share(real.filter((c) => c.reason === 'changes-requested').length, real.length), bought: Object.fromEntries(Object.entries(tally(real, (c) => c.bought)).map(([k, v]) => [k, share(v, real.length)])), boughtByKind: Object.fromEntries(LEGS.map((k) => [k, tally(real.filter((c) => c.kind === k), (c) => c.bought)])), review: (() => { const cs = real.filter((c) => c.kind === 'review'); return { n: cs.length, newFinding: cs.filter((c) => c.newFinding === 'yes').length, real: cs.filter((c) => c.real === 'yes').length }; })() };

// ---- 3b. which-rules-pay's coded review findings, by the review round that raised them.
const tmap = new Map(tickets.map((t) => [t.issue, t]));
const byRound = { first: [], later: [] }; let dated = 0, undated = 0;
for (const t of wrp.tickets) {
  const d = proxy.details[t.id]; const ct = tmap.get(t.id);
  if (!d || !ct) { undated += (t.consequences || []).length; continue; }
  const sorted = d.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reviews = ct.timeline.filter(([, k]) => k === 'review').map(([at]) => at);
  for (const c of t.consequences || []) {
    if (c.leg !== 'review') continue;
    const at = sorted[c.comment]?.createdAt; if (!at) { undated++; continue; }
    dated++; const round = Math.max(1, reviews.filter((x) => x <= at).length);
    byRound[round === 1 ? 'first' : 'later'].push({ ...c, id: t.id, round });
  }
}
const eff = (cs) => ({ n: cs.length, tickets: new Set(cs.map((c) => c.id)).size, effect: tally(cs, (c) => c.effect), prod: share(cs.filter((c) => c.effect === 'prod').length, cs.length), realFault: cs.filter((c) => c.realFault).length });
res.wrpByRound = { dated, undated, first: eff(byRound.first), later: eff(byRound.later), wrpTickets: wrp.tickets.length, inCensus: wrp.tickets.filter((t) => tmap.has(t.id)).length, withDetail: wrp.tickets.filter((t) => proxy.details[t.id]).length };

// ---- 4. Convergence: rounds of each gate per ticket, against size, area, repo, tier and plan length.
// Plan length is the first comment whose heading reads as a plan: later revisions grow with the rounds, so the first is the one that went in.
const planWords = (id) => { const d = proxy.details[id]; if (!d) return null; const p = d.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).find((c) => legOf(c.body) === 'plan'); return p ? p.body.split(/\s+/).length : null; };
const band = (t) => (t.prodLines == null ? 'no merge' : t.prodLines === 0 ? '0' : t.prodLines < 50 ? '1-49' : t.prodLines < 300 ? '50-299' : '300+');
const grp = (t, k) => (t.rounds[k] >= 3 ? '3+' : String(t.rounds[k]));
res.convergence = Object.fromEntries(['plan-review', 'review'].map((k) => {
  const ts = tickets.filter((t) => t.rounds[k] > 0);
  const by = (f) => Object.fromEntries([...new Set(ts.map(f))].sort().map((v) => { const xs = ts.filter((t) => f(t) === v); return [v, { n: xs.length, one: xs.filter((t) => t.rounds[k] === 1).length, threePlus: xs.filter((t) => t.rounds[k] >= 3).length, meanRounds: +(xs.reduce((a, t) => a + t.rounds[k], 0) / xs.length).toFixed(2) }]; }));
  const withPlan = ts.map((t) => ({ t, w: planWords(t.issue) })).filter((x) => x.w != null);
  return [k, {
    n: ts.length, dist: tally(ts, (t) => grp(t, k)),
    bySize: by(band), byRepo: by((t) => t.repo), byArea: by((t) => t.area || 'none'), byWriterTier: by((t) => t.writerTier || 'none'), byImplTier: by((t) => t.implTier || 'none'),
    byMonth: by((t) => t.firstLeg.slice(0, 7)),
    medianProdLines: Object.fromEntries(['1', '2', '3+'].map((g) => [g, median(ts.filter((t) => grp(t, k) === g).map((t) => t.prodLines))])),
    planWords: { n: withPlan.length, ...Object.fromEntries(['1', '2', '3+'].map((g) => [g, { n: withPlan.filter((x) => grp(x.t, k) === g).length, median: median(withPlan.filter((x) => grp(x.t, k) === g).map((x) => x.w)) }])) },
    planRoundsMean: Object.fromEntries(['1', '2', '3+'].map((g) => { const xs = ts.filter((t) => grp(t, k) === g); return [g, +(xs.reduce((a, t) => a + t.rounds.plan, 0) / xs.length).toFixed(2)]; })),
  }];
}));

// ---- 5. Cost.
const s = census.septSplit;
const septLegs = legs.filter((l) => l.at >= '2026-09-01' && l.tokens != null);
res.cost = { ...s, legTokens: { repeat: septLegs.filter((l) => l.repeat).reduce((a, l) => a + l.tokens, 0), first: septLegs.filter((l) => !l.repeat).reduce((a, l) => a + l.tokens, 0) }, medianTokensPerLeg: Object.fromEntries(LEGS.map((k) => [k, { first: median(septLegs.filter((l) => l.kind === k && !l.repeat).map((l) => l.tokens)), repeat: median(septLegs.filter((l) => l.kind === k && l.repeat).map((l) => l.tokens)) }])), medianHoursPerLeg: Object.fromEntries(LEGS.map((k) => [k, { first: +(median(septLegs.filter((l) => l.kind === k && !l.repeat).map((l) => l.hours)) || 0).toFixed(2), repeat: +(median(septLegs.filter((l) => l.kind === k && l.repeat).map((l) => l.hours)) || 0).toFixed(2) }])) };
// The sample's reasons carried to September's repeat dispatches per correct change (a sampled share times the census count).
res.cost.byReasonPerGood = Object.fromEntries(Object.entries(res.reasons).map(([k, v]) => [k, +(s.repeatPerGood * v.k / v.n).toFixed(2)]));

writeFileSync(out, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
