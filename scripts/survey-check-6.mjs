// LIN-3175: the independent check of why-legs-repeat.md (LIN-3174). Tests the census's kind decoding against the session transcripts'
// own bootstrap headers, recounts the repeats with the headers' kinds, estimates what the decoding does to August (which has no
// transcripts), charges September's dispatches both ways (the session entered, survey-check-4.md's rule, and the log's Issue line,
// the paper's), re-dates which-rules-pay's findings by review round on the corrected timelines, reads the convergence claim by
// size band, and measures what the Done-only population leaves out by month. Offline; no proxy calls.
// Usage: node scripts/survey-check-6.mjs --write-headers [--out data/check6/transcripts-headers.json]
//        node scripts/survey-check-6.mjs [--headers-census data/check6/census-headers.json] [--sd ../simple-dispatcher] [--out data/check6/check.json]
// Also writes data/check6/repeat-items.json (the dispatch ids in repeat legs), which the check's map cross-tab reads.
// --write-headers copies data/survey-doubling/transcripts.json with every fresh leg's kind read from its transcript's `# LIN-n · kind`
// header where no fetched item gives it; the paper's census script is then re-run on that copy (see the check's Method).
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { gitCommits } from './survey-rules-timeline.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const tally = (xs, f) => { const m = {}; for (const x of xs) { const k = f(x); m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const LEGS = ['plan', 'plan-review', 'review', 'close-out'];
const tx = read('data/survey-doubling/transcripts.json');
const runner = read('data/survey-doubling/runner.json');
const headerOf = new Map(); for (const s of tx.sessions) if (s.header && !headerOf.has(s.ws)) headerOf.set(s.ws, s.header);

if (process.argv.includes('--write-headers')) {
  const out = arg('--out', 'data/check6/transcripts-headers.json');
  const items = { ...tx.items }; let added = 0;
  for (const r of runner.rows) if (r.shape === 'fresh' && !items[r.item] && headerOf.has(r.session)) { items[r.item] = { kind: headerOf.get(r.session), from: 'header' }; added++; }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ...tx, items }));
  console.log(`items=${Object.keys(items).length} addedFromHeaders=${added}`);
  process.exit(0);
}

const out = arg('--out', 'data/check6/check.json');
const c1 = read('data/survey-repeats/census.json');
const c2 = read(arg('--headers-census', 'data/check6/census-headers.json'));
const proxy = read('data/survey-repeats/proxy.json');
const git = read('data/survey-doubling/git.json');
const score = new Map(read('data/survey/scorecard.json').changes.map((c) => [c.id, c]));
const wrp = read('docs/papers/harbour/which-rules-pay-codes.json');
const R = (xs) => ({ n: xs.length, repeat: xs.filter((l) => l.repeat).length });
const res = {};

// ---- 1. The decoding against the headers: every decoded leg in the census that has a transcript header.
const decodedWithHeader = c1.legs.filter((l) => l.kindHow === 'decoded' && headerOf.has(l.session));
res.decoding = {
  decodedLegs: c1.legs.filter((l) => l.kindHow === 'decoded').length,
  decodedByMonth: tally(c1.legs.filter((l) => l.kindHow === 'decoded'), (l) => l.at.slice(0, 7)),
  legsFrom29Aug: c1.legs.filter((l) => l.at >= '2026-08-29').length,
  exactFrom29Aug: c1.legs.filter((l) => l.at >= '2026-08-29' && l.kindHow === 'exact').length,
  decodedWithHeader: decodedWithHeader.length,
  confusion: tally(decodedWithHeader, (l) => `${l.kind} -> ${headerOf.get(l.session)}`),
};

// ---- 2. The census recounted with the headers' kinds (September, and 29-31 August), against the paper's.
const cmp = (f) => Object.fromEntries(LEGS.map((k) => [k, { paper: R(c1.legs.filter((l) => l.kind === k && f(l))), headers: R(c2.legs.filter((l) => l.kind === k && f(l))) }]));
res.census = {
  all: { paper: R(c1.legs), headers: R(c2.legs), tickets: [c1.tickets.length, c2.tickets.length] },
  byKind: cmp(() => true), aug: cmp((l) => l.at < '2026-09'), sep: cmp((l) => l.at >= '2026-09'),
};

// ---- 3. August has no transcripts. A structural flag, tested on September's decoded legs whose header is known: a decoded
// review or close-out launched before the ticket's first implementation leg (or on a ticket with none).
const firstImpl = (c) => new Map(c.tickets.map((t) => [t.issue, t.timeline.find(([, k]) => k === 'implementation')?.[0] || null]));
const fi1 = firstImpl(c1);
const flagged = (l) => { const f = fi1.get(l.issue); return !f || l.at < f; };
const nLegsOfKind = new Map(c1.tickets.map((t) => [t.issue, t.rounds]));
const est = {};
for (const k of ['review', 'close-out']) {
  const test = decodedWithHeader.filter((l) => l.kind === k);
  const wrong = (l) => headerOf.get(l.session) !== k;
  const tp = test.filter((l) => flagged(l) && wrong(l)).length, fp = test.filter((l) => flagged(l) && !wrong(l)).length;
  const fn = test.filter((l) => !flagged(l) && wrong(l)).length, tn = test.filter((l) => !flagged(l) && !wrong(l)).length;
  const ppv = tp / (tp + fp || 1), missRate = fn / (fn + tn || 1);
  const aug = c1.legs.filter((l) => l.kind === k && l.kindHow === 'decoded' && l.at < '2026-08-29');
  // A misdecoded leg on a ticket with two or more legs of the kind inflates the repeats by one; alone, it only adds a first leg.
  const onMulti = (l) => (nLegsOfKind.get(l.issue)?.[k] || 0) >= 2;
  const augF = aug.filter(flagged), augU = aug.filter((l) => !flagged(l));
  const wrongSep = test.filter(wrong);
  est[k] = {
    september: { tested: test.length, wrong: wrongSep.length, wrongKinds: tally(wrongSep, (l) => headerOf.get(l.session)), tp, fp, fn, tn, ppv: +ppv.toFixed(2), missRate: +missRate.toFixed(3), wrongOnMulti: wrongSep.filter(onMulti).length },
    augustDecoded: aug.length, augustFlagged: augF.length,
    augustMisdecodedEst: +(augF.length * ppv + augU.length * missRate).toFixed(0),
    augustRepeatInflationEst: +(augF.filter(onMulti).length * ppv + augU.filter(onMulti).length * missRate).toFixed(0),
    // the ceiling the paper's Limits gives: half of August's review repeats
  };
}
// The September rate applied flat to August's decoded legs, for comparison with the flag-based estimate.
for (const k of ['review', 'close-out']) { const s = est[k].september; est[k].augustMisdecodedAtSeptRate = Math.round(est[k].augustDecoded * s.wrong / s.tested); }
res.augustEstimate = est;

// ---- 4. September's dispatches per correct change, charged two ways. The paper's population (survey-repeats-census.mjs): code
// changes merged in the weeks of 31 Aug to 21 Sep, correct by the scorecard, not a passage epic, with production lines.
const WORK = new Set(['fresh', 'cold', 'warm']);
const items = runner.rows.filter((r) => WORK.has(r.shape) && r.at <= c1.cut);
const byId = new Map(items.map((r) => [r.item, r]));
const monday = (iso) => { const d = new Date(iso); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10); };
const passageEpics = new Set(tx.sessions.filter((s) => s.runner && s.header === 'autopilot' && s.headerIssue).map((s) => s.headerIssue));
const entered = (r) => (r.shape === 'fresh' ? r.issueLine : byId.get(r.root)?.issueLine) || null;
// A dispatch's leg is its root's fresh session, numbered among every fresh leg of its kind on the ticket its Issue line names, Done
// or not, as the census numbers them; kinds are the census's decoding, or the headers' where given.
const LEN = { 3: 'bug', 4: 'plan', 6: 'review', 7: 'blocked', 8: 'research', 9: 'autopilot|close-out', 11: 'plan-review', 14: 'implementation' };
const takesFollowUp = new Set(items.filter((r) => r.shape !== 'fresh').map((r) => r.root));
function decode(r) {
  if (r.promptLen == null || r.promptLen > 2000) return null;
  const rest = r.promptLen - (r.issueLine ? r.issueLine.length : 0);
  if (!r.issueLine) return rest === 385 ? 'other' : null;
  for (const base of [524, 392, 292]) { const k = LEN[rest - base]; if (!k) continue; if (base === 524 && !['plan', 'research', 'implementation'].includes(k)) continue; return k === 'autopilot|close-out' ? (takesFollowUp.has(r.item) ? 'autopilot' : 'close-out') : k; }
  return null;
}
function ordinals(useHeaders) {
  const byT = new Map();
  for (const r of items) if (r.shape === 'fresh' && r.issueLine) {
    let k = tx.items[r.item]?.kind || (useHeaders && headerOf.get(r.session)) || decode(r); if (k === 'implement') k = 'implementation';
    (byT.get(r.issueLine) || byT.set(r.issueLine, []).get(r.issueLine)).push({ r, k });
  }
  const ord = new Map();
  for (const [, ls] of byT) { const o = {}; for (const { r, k } of ls.sort((a, b) => a.r.at.localeCompare(b.r.at))) { o[k] = (o[k] || 0) + 1; ord.set(r.item, { kind: k, round: o[k] }); } }
  return ord;
}
function costSplit(useHeaders, charge) {
  const per = new Map(); for (const r of items) { const t = charge(r); if (t) (per.get(t) || per.set(t, []).get(t)).push(r); }
  const ord = ordinals(useHeaders);
  const legOf = (d) => ord.get(d.shape === 'fresh' ? d.item : d.root);
  const sept = git.rows.filter((g) => g.lastMerge >= '2026-06-01').map((g) => ({ g, week: monday(g.lastMerge), ds: per.get(g.id) || [], sc: score.get(g.id) }))
    .filter((c) => c.sc && c.ds.length && !passageEpics.has(c.g.id) && c.g.prodLines > 0 && c.week >= '2026-08-31' && c.week < '2026-09-29');
  const good = sept.filter((c) => c.sc.good).length; const ds = sept.flatMap((c) => c.ds);
  const rep = ds.filter((d) => { const o = legOf(d); return o && LEGS.includes(o.kind) && o.round > 1; });
  const foreign = rep.filter((d) => charge(byId.get(d.shape === 'fresh' ? d.item : d.root) || d) !== charge(d));
  return { changes: sept.length, good, dispatches: ds.length, perGood: +(ds.length / good).toFixed(1), repeatDispatches: rep.length, repeatPerGood: +(rep.length / good).toFixed(2), share: +(rep.length / ds.length).toFixed(3), byKind: tally(rep, (d) => legOf(d).kind), fresh: rep.filter((d) => d.shape === 'fresh').length, chargedAwayFromTheirLeg: foreign.length };
}
// The dispatch ids in repeat legs (a repeat fresh leg and every follow-up rooted in one), for the map cross-tab below.
{ const ordP = ordinals(false), ordH = ordinals(true); const inRep = (ord) => items.filter((d) => { const o = ord.get(d.shape === 'fresh' ? d.item : d.root); return o && LEGS.includes(o.kind) && o.round > 1; }).map((d) => d.item);
  mkdirSync('data/check6', { recursive: true }); writeFileSync('data/check6/repeat-items.json', JSON.stringify({ paper: inRep(ordP), headers: inRep(ordH) })); }
res.cost = {
  logLine: { paperKinds: costSplit(false, (r) => r.issue), headerKinds: costSplit(true, (r) => r.issue) },
  sessionEntered: { paperKinds: costSplit(false, entered), headerKinds: costSplit(true, entered) },
};

// ---- 5. which-rules-pay's review findings by round, on three timelines: the paper's, the headers', and the headers' with review
// legs before the ticket's first implementation leg left out (a review of nothing yet built is not a code-review round).
function wrpRounds(census, dropPreImpl) {
  const tm = new Map(census.tickets.map((t) => [t.issue, t])); const out = { first: [], later: [] };
  for (const t of wrp.tickets) {
    const d = proxy.details[t.id]; const ct = tm.get(t.id); if (!d || !ct) continue;
    const sorted = d.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const impl = ct.timeline.find(([, k]) => k === 'implementation')?.[0];
    const reviews = ct.timeline.filter(([at, k]) => k === 'review' && (!dropPreImpl || (impl && at >= impl))).map(([at]) => at);
    for (const c of t.consequences || []) {
      if (c.leg !== 'review') continue; const at = sorted[c.comment]?.createdAt; if (!at) continue;
      const round = Math.max(1, reviews.filter((x) => x <= at).length); out[round === 1 ? 'first' : 'later'].push({ ...c, id: t.id });
    }
  }
  const eff = (cs) => ({ n: cs.length, tickets: new Set(cs.map((c) => c.id)).size, prod: cs.filter((c) => c.effect === 'prod').length, realFault: cs.filter((c) => c.realFault).length, realFaultTickets: tally(cs.filter((c) => c.realFault), (c) => c.id) });
  return { first: eff(out.first), later: eff(out.later) };
}
res.wrpByRound = { paper: wrpRounds(c1, false), headers: wrpRounds(c2, false), headersPostImpl: wrpRounds(c2, true) };

// ---- 5b. A ticket can ship in several PRs, and the first review of its second PR is then a "repeat" of the ticket's review.
// Merges of a PR naming the ticket, from origin/main in both repos; a round counted from the last such merge before it.
const commits = [...gitCommits('LinearViewer', resolve('.')), ...gitCommits('simple-dispatcher', resolve(arg('--sd', '../simple-dispatcher')))];
const mergesOf = new Map();
for (const c of commits) if (c.mergeAt && c.pr) for (const id of c.ids) { const m = mergesOf.get(id) || mergesOf.set(id, new Map()).get(id); m.set(`${c.repo}#${c.pr}`, c.mergeAt); }
const mergeTimes = (id) => [...(mergesOf.get(id)?.values() || [])].sort();
function wrpRoundsByPr(census) {
  const tm = new Map(census.tickets.map((t) => [t.issue, t])); const out = { first: [], later: [] };
  for (const t of wrp.tickets) {
    const d = proxy.details[t.id]; const ct = tm.get(t.id); if (!d || !ct) continue;
    const sorted = d.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)); const ms = mergeTimes(t.id);
    const reviews = ct.timeline.filter(([, k]) => k === 'review').map(([at]) => at);
    for (const c of t.consequences || []) {
      if (c.leg !== 'review') continue; const at = sorted[c.comment]?.createdAt; if (!at) continue;
      const since = ms.filter((m) => m < at).at(-1) || '';
      const round = Math.max(1, reviews.filter((x) => x <= at && x > since).length); out[round === 1 ? 'first' : 'later'].push({ ...c, id: t.id });
    }
  }
  const eff = (cs) => ({ n: cs.length, tickets: new Set(cs.map((c) => c.id)).size, prod: cs.filter((c) => c.effect === 'prod').length, prodTickets: new Set(cs.filter((c) => c.effect === 'prod').map((c) => c.id)).size, realFault: cs.filter((c) => c.realFault).length, realFaultTickets: tally(cs.filter((c) => c.realFault), (c) => c.id) });
  return { first: eff(out.first), later: eff(out.later) };
}
res.wrpByRound.headersByPr = wrpRoundsByPr(c2);
// Census repeats with a merge of the ticket's PR between the previous leg of the kind and this one: the next phase, not a send-back.
const afterMerge = (l) => mergeTimes(l.issue).some((m) => m > l.prevAt && m < l.at);
res.nextPhase = Object.fromEntries(LEGS.map((k) => { const rs = c2.legs.filter((l) => l.kind === k && l.repeat); const nx = rs.filter(afterMerge); return [k, { repeats: rs.length, afterAMerge: nx.length, byMonth: tally(nx, (l) => l.at.slice(0, 7)) }]; }));
res.nextPhase.all = { repeats: c2.legs.filter((l) => l.repeat).length, afterAMerge: c2.legs.filter((l) => l.repeat && afterMerge(l)).length };
res.wrpTicketMonths = tally(wrp.tickets.map((t) => c1.tickets.find((x) => x.issue === t.id)).filter(Boolean), (t) => t.timeline.at(-1)[0].slice(0, 7));

// ---- 6. Convergence: where the three-or-more-round tickets sit by size, the bands the paper's table leaves out included.
const band = (t) => (t.prodLines == null ? 'no merge' : t.prodLines === 0 ? '0' : t.prodLines < 50 ? '1-49' : t.prodLines < 300 ? '50-299' : '300+');
res.convergence = Object.fromEntries(['plan-review', 'review'].map((k) => {
  const ts = c1.tickets.filter((t) => t.rounds[k] > 0); const three = ts.filter((t) => t.rounds[k] >= 3);
  return [k, { tickets: ts.length, threePlus: three.length, threePlusByBand: tally(three, band), allByBand: tally(ts, band), threePlusUnder300: three.filter((t) => !['300+'].includes(band(t))).length, medianProdThreePlus: median(three.map((t) => t.prodLines)), medianProdAll: median(ts.map((t) => t.prodLines)) }];
}));
// The same on the headers' census.
res.convergenceHeaders = Object.fromEntries(['plan-review', 'review'].map((k) => { const ts = c2.tickets.filter((t) => t.rounds[k] > 0); return [k, { tickets: ts.length, dist: tally(ts, (t) => (t.rounds[k] >= 3 ? '3+' : String(t.rounds[k]))), byMonth: Object.fromEntries(['2026-08', '2026-09'].map((m) => { const xs = ts.filter((t) => t.firstLeg.startsWith(m)); return [m, { n: xs.length, threePlus: xs.filter((t) => t.rounds[k] >= 3).length }]; })) }]; }));

// ---- 7. What the Done-only population leaves out: fresh legs of the four kinds (paper's kinds) on tickets not Done now, by month.
const state = new Map(proxy.list.map((t) => [t.identifier, t.state]));
const allLegs = c1.legs.map((l) => l.item); const inCensus = new Set(allLegs);
const kindOf = new Map(); for (const l of c1.legs) kindOf.set(l.item, l.kind);
const exact = tx.items;
const freshLegs = items.filter((r) => r.shape === 'fresh' && r.issueLine && r.at >= c1.since && exact[r.item] && LEGS.includes(exact[r.item].kind === 'implement' ? 'implementation' : exact[r.item].kind));
res.notDone = { exactLegsSince29Aug: freshLegs.length, byState: tally(freshLegs, (r) => (state.get(r.issueLine) || 'not listed')), inCensus: freshLegs.filter((r) => inCensus.has(r.item)).length };
// Repeat share among the exact legs on tickets not Done, over every leg of the ticket (any date, exact kinds only).
const perT = new Map(); for (const r of items.filter((x) => x.shape === 'fresh' && x.issueLine && exact[x.item])) (perT.get(r.issueLine) || perT.set(r.issueLine, []).get(r.issueLine)).push(r);
let nd = 0, ndRep = 0;
for (const r of freshLegs) { if (state.get(r.issueLine) === 'Done') continue; const k = exact[r.item].kind; const earlier = perT.get(r.issueLine).filter((x) => exact[x.item].kind === k && x.at < r.at).length; nd++; if (earlier) ndRep++; }
res.notDone.repeatShareNotDone = { legs: nd, repeats: ndRep };

// ---- 8. The ruling count: the notes the keyword match hit, for reading.
const codes = read('docs/papers/harbour/why-legs-repeat-codes.json');
const A = new Map(codes.readers.A.map((c) => [c.digest, c])); const B = new Map(codes.readers.B.map((c) => [c.digest, c]));
const RULING = /John|human|operator|ruling|ruled|coordinator/i;
res.rulingNotes = codes.final.filter((f) => f.round >= 3).map((f) => ({ digest: f.digest, issue: f.issue, kind: f.kind, round: f.round, hit: RULING.test(`${A.get(f.digest)?.note} ${B.get(f.digest)?.note}`), A: A.get(f.digest)?.note, B: B.get(f.digest)?.note }));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(res, null, 1));
const { rulingNotes, ...shown } = res;
console.log(JSON.stringify(shown, null, 1));
