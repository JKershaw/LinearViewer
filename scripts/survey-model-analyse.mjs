// LIN-3165: who did the work at which tier over time, cost per correct change by implementer tier, and each change's afterlife (whole-life cost) for LinearViewer and simple-dispatcher.
// Usage: node scripts/survey-model-analyse.mjs [--out data/survey-model/analysis.json] [--cut 2026-09-30]
// Run first: survey-model-git.mjs, survey-model-runner.mjs, survey-model-cost-fetch.mjs (proxy), and survey-scorecard.mjs's inputs
// (its data/survey/scorecard.json gives each change's correct/complete verdict; reuse a same-day copy).
// Implementer tier: the tier of the change's implementation sessions in its cost lineage where one exists, else the tier most of its
// commits' Co-Authored-By trailers name (survey-model-git.mjs). Own cost: the change's own dispatches (runner logs), working hours
// (oplog; from 12 July) and API-equivalent USD (lineage; unpriced sessions imputed at their tier's median $/hour, opencode rows
// scaled by 1/0.55 for /cost's ~45% under-report). Rework, attributed back to the change that caused it: the fixing ticket's own
// cost for an escaped Bug naming it as introducer and for a later fix commit whose ticket names it (the named floor); plus later
// fix-worded commits on its production files within 30 days, each fix's cost shared equally among the changes it could belong to
// (the same-file ceiling). Follow-up filings are carried scope, counted beside rework, never inside it.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const out = arg('--out', 'data/survey-model/analysis.json');
const CUT = Date.parse(arg('--cut', '2026-09-30') + 'T00:00:00Z');
const DAY = 86400000;
const monday = (iso) => { const d = new Date(iso); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10); };
const median = (xs) => { const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
const r2 = (x) => (x == null ? null : +x.toFixed(2));
export const tierOfModel = (m) => (!m ? null : /opus|fable/i.test(m) ? 'frontier' : /sonnet/i.test(m) ? 'mid' : 'cheap');
const TIERS = ['frontier', 'mid', 'cheap'];

const git = read('data/survey-model/git.json');
const runner = read('data/survey-model/runner.json');
const cost = existsSync('data/survey-model/cost.json') ? read('data/survey-model/cost.json').rows : {};
const score = new Map(read('data/survey/scorecard.json').changes.map((c) => [c.id, c]));
const tracker = read('data/survey/reliability-tracker.json');
const verdicts = read('docs/papers/harbour/reliability-baseline-defects.json').verdicts;
const listById = new Map(tracker.list.map((t) => [t.identifier, t]));

// ---- Ticket creation dates: detail rows carry createdAt; others are interpolated by ticket number (numbers are issued in order).
const known = Object.entries(tracker.details).map(([id, d]) => [+id.slice(4), Date.parse(d.createdAt)]).filter((x) => x[1]).sort((a, b) => a[0] - b[0]);
const createdAt = (id) => {
  if (tracker.details[id]?.createdAt) return Date.parse(tracker.details[id].createdAt);
  const n = +id.slice(4); let lo = known[0], hi = known.at(-1);
  for (const k of known) { if (k[0] <= n) lo = k; if (k[0] >= n) { hi = k; break; } }
  return hi[0] === lo[0] ? lo[1] : lo[1] + ((n - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]);
};

// ---- Runner: per-ticket dispatches and hours, split by tier; weekly fleet dispatches and hours by tier.
const own = new Map(); const fleetWeek = {};
for (const d of runner.rows) {
  const w = monday(d.at); const f = (fleetWeek[w] ||= { dispatches: {}, hours: {} });
  f.dispatches[d.tier] = (f.dispatches[d.tier] || 0) + 1; f.hours[d.tier] = (f.hours[d.tier] || 0) + (d.workH || 0);
  if (!d.issue) continue;
  const o = own.get(d.issue) || { dispatches: 0, workH: 0, timed: 0, byTier: {} };
  o.dispatches++; if (d.workH != null) { o.workH += d.workH; o.timed++; }
  const t = (o.byTier[d.tier] ||= { dispatches: 0, workH: 0 }); t.dispatches++; t.workH += d.workH || 0;
  own.set(d.issue, o);
}

// ---- Lineage cost: per session USD (imputed where unpriced), role × tier.
const opencodeScale = 1 / 0.55;
const rate = {}; // tier -> median $/h over priced sessions with a duration
for (const t of TIERS) rate[t] = median(Object.values(cost).flatMap((r) => (r.workerSessions || []).filter((s) => tierOfModel(s.model) === t && s.costUsd != null && s.durationMs > 60000).map((s) => (s.costUsd * (s.harness === 'opencode' ? opencodeScale : 1)) / (s.durationMs / 36e5))));
const lineage = new Map(); const roleWeek = {};
for (const [id, r] of Object.entries(cost)) {
  if (r.error || r.noLineage) continue;
  const sessions = (r.workerSessions || []).map((s) => {
    const tier = tierOfModel(s.model);
    let usd = s.costUsd != null ? s.costUsd * (s.harness === 'opencode' ? opencodeScale : 1) : null; let imputed = false;
    if (usd == null && s.durationMs && tier && rate[tier] != null) { usd = rate[tier] * (s.durationMs / 36e5); imputed = true; }
    return { kind: s.kind, tier, harness: s.harness, effort: s.effort, usd, imputed, hours: s.durationMs ? s.durationMs / 36e5 : null, at: s.dispatchedAt };
  });
  for (const s of sessions) { const w = monday(s.at); const k = (roleWeek[w] ||= {}); const key = `${s.kind}|${s.tier || 'unknown'}`; k[key] = (k[key] || 0) + 1; }
  sessions.sort((a, b) => a.at.localeCompare(b.at));
  const impl = sessions.filter((s) => s.kind === 'implementation' && s.tier);
  const implTiers = [...new Set(impl.map((s) => s.tier))];
  const implTier = impl.length ? TIERS.map((t) => [t, impl.filter((s) => s.tier === t).length]).sort((a, b) => b[1] - a[1])[0][0] : null;
  // Orchestrator lineages (autopilot, wake, blocked) span many tickets and /cost reports them under each, so a ticket-scoped figure leaves them out.
  const scoped = sessions.filter((s) => !['autopilot', 'wake', 'blocked'].includes(s.kind));
  lineage.set(id, { sessions, usd: sum(sessions.map((s) => s.usd)), usdScoped: sum(scoped.map((s) => s.usd)), usdScopedPriced: sum(scoped.filter((s) => !s.imputed).map((s) => s.usd)), usdMissing: sessions.filter((s) => s.usd == null).length, imputedShare: sum(sessions.filter((s) => s.imputed).map((s) => s.usd)) / (sum(sessions.map((s) => s.usd)) || 1), implTier, implTiers, reviews: sessions.filter((s) => s.kind === 'review').length, switched: implTiers.length > 1 });
}

// ---- Changes.
const changes = git.rows.filter((r) => r.lastMerge >= '2026-06-01').map((r) => {
  const sc = score.get(r.id); const o = own.get(r.id); const l = lineage.get(r.id);
  const implementer = l?.implTier || (r.writerTier === 'unattributed' ? null : r.writerTier);
  return {
    id: r.id, repos: r.repos, repo: r.repos.includes('simple-dispatcher') && !r.repos.includes('LinearViewer') ? 'simple-dispatcher' : r.repos.length > 1 ? 'both' : 'LinearViewer',
    week: monday(r.lastMerge), merged: Date.parse(r.lastMerge), mature: Date.parse(r.lastMerge) <= CUT - 30 * DAY,
    implementer, implementerFrom: l?.implTier ? 'lineage' : implementer ? 'trailer' : null, writerTier: r.writerTier, lineageTier: l?.implTier || null, switched: l?.switched || false,
    prodLines: r.prodLines, size: r.prodLines === 0 ? '0' : r.prodLines < 50 ? '1-49' : r.prodLines < 300 ? '50-299' : '300+', area: r.area, risk: r.risk, relanded: r.relanded,
    scored: !!sc, done: sc?.done ?? null, correct: sc?.correct ?? null, complete: sc?.complete ?? null, good: sc?.good ?? null, escapes: sc?.escapes ?? 0, namedFix: sc?.namedFix ?? false, followUps: sc?.followUps ?? 0,
    dispatches: o?.dispatches ?? null, workH: o && o.timed ? o.workH : null, usd: l ? l.usd : null, usdScoped: l ? l.usdScoped : null, usdScopedPriced: l ? l.usdScopedPriced : null, usdMissing: l?.usdMissing ?? null, reviews: l?.reviews ?? null,
    laterFixes: r.laterFixes,
  };
});
const byId = new Map(changes.map((c) => [c.id, c]));

// ---- Afterlife events: [{ origin, fixer, kind, day, cost:{workH, usd, dispatches}, share }]
const fixCost = (fid) => { const f = byId.get(fid); const o = own.get(fid); const l = lineage.get(fid); return { workH: o && o.timed ? o.workH : 0, dispatches: o?.dispatches || 0, usd: l ? l.usdScoped : 0, known: !!(o && o.timed) }; };
const events = [];
// Escaped Bugs naming an introducer: cost is the Bug ticket's own; day is when it was filed.
for (const v of verdicts) {
  if (v.verdict !== 'escaped' || !v.introducedBy || !byId.has(v.introducedBy)) continue;
  const o = byId.get(v.introducedBy);
  events.push({ origin: o.id, fixer: v.identifier, kind: 'escaped bug', day: (createdAt(v.identifier) - o.merged) / DAY, share: 1, cost: fixCost(v.identifier) });
}
// Later fix commits on the change's production files. Named when the fixing ticket's title, description or commit names the origin.
const claimants = new Map(); // fixer sha -> number of changes it could belong to
for (const c of changes) for (const f of c.laterFixes) claimants.set(f.sha, (claimants.get(f.sha) || 0) + 1);
const bugFixers = new Set(events.map((e) => `${e.origin}|${e.fixer}`));
for (const c of changes) {
  const seen = new Set();
  for (const f of c.laterFixes) {
    if (!f.id || seen.has(f.id) || bugFixers.has(`${c.id}|${f.id}`)) continue; seen.add(f.id);
    const t = listById.get(f.id); const text = `${t?.title || ''} ${(t?.description || '').slice(0, 4000)}`;
    const named = new RegExp(`\\b${c.id}\\b`).test(text);
    events.push({ origin: c.id, fixer: f.id, kind: named ? 'named fix' : 'same-file fix', day: f.days, share: named ? 1 : 1 / claimants.get(f.sha), cost: fixCost(f.id) });
  }
}
// Follow-up filings (carried scope): kind:follow-up tickets whose parent or first named ticket is the change.
for (const t of tracker.list) {
  if (!(t.labels || []).includes('kind:follow-up')) continue;
  const named = ((t.description || '').slice(0, 600).match(/\bLIN-\d+\b/g) || []).filter((x) => x !== t.identifier);
  const origin = t.parent || named[0]; const o = byId.get(origin);
  if (!o) continue;
  events.push({ origin, fixer: t.identifier, kind: 'follow-up', day: (createdAt(t.identifier) - o.merged) / DAY, share: 1, cost: fixCost(t.identifier), worked: !['backlog', 'unstarted', 'canceled'].includes(t.state?.type) });
}
const eventsOf = new Map(); for (const e of events) (eventsOf.get(e.origin) || eventsOf.set(e.origin, []).get(e.origin)).push(e);
const REWORK_FLOOR = new Set(['escaped bug', 'named fix']); const REWORK_CEIL = new Set(['escaped bug', 'named fix', 'same-file fix']);
for (const c of changes) {
  const es = (eventsOf.get(c.id) || []).filter((e) => e.day >= -2 && e.day <= 60);
  const tot = (set, k, maxDay = 30) => sum(es.filter((e) => set.has(e.kind) && e.day <= maxDay).map((e) => e.cost[k] * e.share));
  c.afterlife = {
    escapedBugs: es.filter((e) => e.kind === 'escaped bug' && e.day <= 30).length, namedFixes: es.filter((e) => e.kind === 'named fix' && e.day <= 30).length,
    sameFileFixes: es.filter((e) => e.kind === 'same-file fix' && e.day <= 30).length, followUps: es.filter((e) => e.kind === 'follow-up' && e.day <= 30).length,
    reworkFloorH: tot(REWORK_FLOOR, 'workH'), reworkCeilH: tot(REWORK_CEIL, 'workH'), reworkFloorUsd: tot(REWORK_FLOOR, 'usd'), reworkCeilUsd: tot(REWORK_CEIL, 'usd'),
    reworkFloorDispatches: tot(REWORK_FLOOR, 'dispatches'), reworkCeilDispatches: tot(REWORK_CEIL, 'dispatches'), carriedScopeH: tot(new Set(['follow-up']), 'workH'),
  };
  c.events = es.map((e) => ({ kind: e.kind, fixer: e.fixer, day: +e.day.toFixed(1), share: +e.share.toFixed(3), workH: r2(e.cost.workH * e.share), usd: r2(e.cost.usd * e.share) }));
}

// ---- Cost per correct change, by implementer tier and period; plus size × area standardisation.
const PERIODS = [['default era', '2026-06-01', '2026-07-13'], ['chosen tier', '2026-07-13', '2026-08-31'], ['September (provisional)', '2026-08-31', '2026-10-01']];
const inP = (c, [, a, z]) => c.week >= a && c.week < z;
function costTable(cs) {
  const good = cs.filter((c) => c.good).length; const timed = cs.filter((c) => c.workH != null); const priced = cs.filter((c) => c.usd != null);
  const perGood = (xs, k) => { const g = xs.filter((c) => c.good).length; return g ? sum(xs.map((c) => c[k])) / g : null; };
  const wl = (xs, k, rk) => { const g = xs.filter((c) => c.good).length; return g ? (sum(xs.map((c) => c[k])) + sum(xs.map((c) => c.afterlife[rk]))) / g : null; };
  return {
    n: cs.length, good, goodShare: cs.length ? good / cs.length : null, correctShare: cs.length ? cs.filter((c) => c.correct).length / cs.length : null,
    escapedShare: cs.length ? cs.filter((c) => c.escapes).length / cs.length : null, escaped: cs.filter((c) => c.escapes).length,
    medProd: median(cs.map((c) => c.prodLines)),
    dispatchesPerGood: perGood(cs.filter((c) => c.dispatches != null), 'dispatches'), medDispatches: median(cs.map((c) => c.dispatches)),
    timed: timed.length, workHPerGood: perGood(timed, 'workH'), medWorkH: median(timed.map((c) => c.workH)),
    wholeLifeFloorH: wl(timed, 'workH', 'reworkFloorH'), wholeLifeCeilH: wl(timed, 'workH', 'reworkCeilH'),
    reworkFloorHPerChange: timed.length ? sum(timed.map((c) => c.afterlife.reworkFloorH)) / timed.length : null, reworkCeilHPerChange: timed.length ? sum(timed.map((c) => c.afterlife.reworkCeilH)) / timed.length : null,
    priced: priced.length, usdPerGood: perGood(priced, 'usd'), wholeLifeFloorUsd: wl(priced, 'usd', 'reworkFloorUsd'), wholeLifeCeilUsd: wl(priced, 'usd', 'reworkCeilUsd'), medUsd: median(priced.map((c) => c.usd)),
    followUpShare: cs.length ? cs.filter((c) => c.afterlife.followUps).length / cs.length : null, relandedShare: cs.length ? cs.filter((c) => c.relanded).length / cs.length : null,
    medReviews: median(cs.map((c) => c.reviews)), extraReviewShare: cs.filter((c) => c.reviews != null).length ? cs.filter((c) => c.reviews > 1).length / cs.filter((c) => c.reviews != null).length : null,
  };
}
const scored = changes.filter((c) => c.scored && c.prodLines > 0); // code changes only: docs-only papers are not implementation work
const byTierPeriod = {};
for (const p of PERIODS) for (const t of [...TIERS, null]) byTierPeriod[`${p[0]}|${t || 'unattributed'}`] = costTable(scored.filter((c) => inP(c, p) && c.implementer === t));
const byRepo = {};
for (const repo of ['LinearViewer', 'simple-dispatcher']) for (const t of TIERS) byRepo[`${repo}|${t}`] = costTable(scored.filter((c) => inP(c, PERIODS[1]) && c.implementer === t && c.repos.includes(repo)));

// Standardised: within the chosen-tier period, frontier vs mid over size × area cells both tiers reach, weighted by the pooled mix.
function standardise(cs, a, b, metric) {
  const cell = (c) => `${c.size}|${c.area}`; const cells = {};
  for (const c of cs) { const k = cell(c); (cells[k] ||= { [a]: [], [b]: [] }); if (c.implementer === a || c.implementer === b) cells[k][c.implementer].push(c); }
  let wA = 0, wB = 0, W = 0, n = 0;
  for (const [k, v] of Object.entries(cells)) { if (!v[a].length || !v[b].length) continue; const w = v[a].length + v[b].length; const ma = metric(v[a]), mb = metric(v[b]); if (ma == null || mb == null) continue; wA += w * ma; wB += w * mb; W += w; n++; }
  return W ? { [a]: wA / W, [b]: wB / W, cells: n, weight: W } : null;
}
const chosen = scored.filter((c) => inP(c, PERIODS[1]));
const share = (k) => (xs) => (xs.length ? xs.filter((c) => c[k]).length / xs.length : null);
const meanOf = (k) => (xs) => { const ys = xs.map((c) => (typeof k === 'function' ? k(c) : c[k])).filter((x) => x != null); return ys.length ? sum(ys) / ys.length : null; };
const standardised = {
  goodShare: standardise(chosen, 'frontier', 'mid', share('good')),
  escapedShare: standardise(chosen, 'frontier', 'mid', (xs) => (xs.length ? xs.filter((c) => c.escapes).length / xs.length : null)),
  workH: standardise(chosen.filter((c) => c.workH != null), 'frontier', 'mid', meanOf('workH')),
  wholeLifeCeilH: standardise(chosen.filter((c) => c.workH != null), 'frontier', 'mid', meanOf((c) => c.workH + c.afterlife.reworkCeilH)),
  dispatches: standardise(chosen.filter((c) => c.dispatches != null), 'frontier', 'mid', meanOf('dispatches')),
};

// ---- The 12 July step: code changes merged in the two weeks either side (implementation moved frontier → mid; review, plan, research stayed frontier).
const step = {};
for (const [name, a, z] of [['before (29 Jun–12 Jul)', '2026-06-29', '2026-07-13'], ['after (13–26 Jul)', '2026-07-13', '2026-07-27']]) {
  const cs = scored.filter((c) => c.week >= a && c.week < z); const weeks = 2;
  step[name] = { ...costTable(cs), perWeek: cs.length / weeks, goodPerWeek: cs.filter((c) => c.good).length / weeks, byImplementer: Object.fromEntries([...TIERS, null].map((t) => [t || 'unattributed', cs.filter((c) => c.implementer === t).length])), sizeMix: Object.fromEntries(['1-49', '50-299', '300+'].map((s) => [s, cs.filter((c) => c.size === s).length])), perImplementer: Object.fromEntries([...TIERS, null].map((t) => { const x = costTable(cs.filter((c) => c.implementer === t)); return [t || 'unattributed', { perWeek: x.n / weeks, goodPerWeek: x.good / weeks, dispatchesPerGood: r2(x.dispatchesPerGood), goodShare: r2(x.goodShare), escaped: x.escaped }]; })), uiShare: cs.filter((c) => c.area === 'UI').length / (cs.length || 1) };
}

// ---- Mid-ticket tier switches: changes whose implementation ran at more than one tier.
const switches = changes.filter((c) => c.switched).map((c) => ({ id: c.id, tiers: lineage.get(c.id).implTiers, sessions: lineage.get(c.id).sessions.filter((s) => s.kind === 'implementation').map((s) => `${s.at.slice(0, 10)} ${s.tier}${s.harness === 'opencode' ? ' (opencode)' : ''}`), good: c.good, escapes: c.escapes, mature: c.mature }));

// ---- Afterlife curve: cumulative rework hours per change by days since merge, by implementer tier (mature chosen-tier changes).
const curve = {};
for (const t of TIERS) {
  const cs = chosen.filter((c) => c.implementer === t && c.workH != null && c.merged <= CUT - 60 * DAY);
  curve[t] = { n: cs.length, floor: [], ceil: [] };
  for (let d = 0; d <= 60; d += 2) {
    const at = (set) => sum(cs.flatMap((c) => c.events.filter((e) => set.has(e.kind) && e.day <= d).map((e) => e.workH))) / (cs.length || 1);
    curve[t].floor.push([d, r2(at(REWORK_FLOOR))]); curve[t].ceil.push([d, r2(at(REWORK_CEIL))]);
  }
}
const tail = {}; // share of 60-day rework hours landing by day 7, 14, 30
for (const t of TIERS) { const c = curve[t].ceil; const end = c.at(-1)[1] || 1; tail[t] = Object.fromEntries([7, 14, 30].map((d) => [d, r2(c.find(([x]) => x >= d)[1] / end)])); }

// ---- Weekly series for the charts.
const commitWeek = git.commitWeek; // commits a week by trailer tier, per repo, since January
const weekly = [...new Set(scored.map((c) => c.week))].sort().map((w) => {
  const cs = scored.filter((c) => c.week === w); const row = { week: w, mature: cs.every((c) => c.mature) };
  for (const t of TIERS) { const x = cs.filter((c) => c.implementer === t); const g = x.filter((c) => c.good).length; const timed = x.filter((c) => c.workH != null);
    row[t] = { n: x.length, good: g, wholeLifeCeilHPerGood: g && timed.length ? (sum(timed.map((c) => c.workH + c.afterlife.reworkCeilH)) / timed.filter((c) => c.good).length || null) : null, ownHPerGood: g && timed.length ? sum(timed.map((c) => c.workH)) / (timed.filter((c) => c.good).length || 1) : null, dispatchesPerGood: g ? sum(x.map((c) => c.dispatches)) / g : null }; }
  return row;
});

const result = { generatedAt: new Date().toISOString(), heads: git.heads, rate, periods: PERIODS, coverage: { changes: changes.length, codeChanges: scored.length, lineage: changes.filter((c) => c.lineageTier).length, trailerOnly: changes.filter((c) => c.implementerFrom === 'trailer').length, unattributed: changes.filter((c) => !c.implementer).length, lineageTrailerAgree: changes.filter((c) => c.lineageTier && c.writerTier !== 'unattributed').map((c) => c.lineageTier === c.writerTier) },
  byTierPeriod, byRepo, standardised, step, switches, curve, tail, weekly, commitWeek, fleetWeek, roleWeek, changes };
result.coverage.lineageTrailerAgree = { both: result.coverage.lineageTrailerAgree.length, agree: result.coverage.lineageTrailerAgree.filter(Boolean).length };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));

// ---- Report.
const f = (x, d = 1) => (x == null ? '—' : typeof x === 'number' ? x.toFixed(d) : x);
console.log('coverage', result.coverage, 'imputation $/h by tier', Object.fromEntries(Object.entries(rate).map(([k, v]) => [k, f(v, 2)])));
console.log('\nperiod | implementer | n | good% | correct% | escaped (n) | medProd | disp/good | timed | ownH/good | wholeLife H/good floor–ceil | rework H/change floor–ceil | priced | $/good | wholeLife $/good floor–ceil | followUp% | relanded% | medReviews | >1 review%');
for (const [k, v] of Object.entries(byTierPeriod)) if (v.n) console.log(k.replace('|', ' | '), '|', v.n, '|', f(v.goodShare * 100, 0), '|', f(v.correctShare * 100, 0), '|', f(v.escapedShare * 100), `(${v.escaped})`, '|', v.medProd, '|', f(v.dispatchesPerGood), '|', v.timed, '|', f(v.workHPerGood, 2), '|', f(v.wholeLifeFloorH, 2), '–', f(v.wholeLifeCeilH, 2), '|', f(v.reworkFloorHPerChange, 2), '–', f(v.reworkCeilHPerChange, 2), '|', v.priced, '|', f(v.usdPerGood, 2), '|', f(v.wholeLifeFloorUsd, 2), '–', f(v.wholeLifeCeilUsd, 2), '|', f(v.followUpShare * 100, 0), '|', f(v.relandedShare * 100, 0), '|', f(v.medReviews, 0), '|', f(v.extraReviewShare == null ? null : v.extraReviewShare * 100, 0));
console.log('\nchosen-tier period by repo:'); for (const [k, v] of Object.entries(byRepo)) if (v.n) console.log(k, 'n', v.n, 'good%', f(v.goodShare * 100, 0), 'escaped', v.escaped, 'ownH/good', f(v.workHPerGood, 2), 'wholeLifeCeilH/good', f(v.wholeLifeCeilH, 2), '$/good', f(v.usdPerGood, 2));
console.log('\nstandardised (size × area, chosen-tier period):', JSON.stringify(standardised, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
console.log('\n12 July step:'); for (const [k, v] of Object.entries(step)) console.log(k, 'perWeek', f(v.perWeek), 'goodPerWeek', f(v.goodPerWeek), 'good%', f(v.goodShare * 100, 0), 'escaped', v.escaped, 'disp/good', f(v.dispatchesPerGood), 'ownH/good', f(v.workHPerGood, 2), 'timed', v.timed, 'implementer', JSON.stringify(v.byImplementer), 'size', JSON.stringify(v.sizeMix), 'UI', f(v.uiShare * 100, 0) + '%', 'medProd', v.medProd, '\n   by implementer', JSON.stringify(v.perImplementer));
console.log('\nmid-ticket switches:', switches.length); for (const s of switches) console.log(' ', s.id, s.tiers.join('→'), 'good', s.good, 'esc', s.escapes, s.mature ? '' : '(provisional)', '|', s.sessions.join('; '));
console.log('\nafterlife curve n:', Object.fromEntries(TIERS.map((t) => [t, curve[t].n])), 'day60 floor/ceil H:', Object.fromEntries(TIERS.map((t) => [t, `${curve[t].floor.at(-1)[1]}/${curve[t].ceil.at(-1)[1]}`])), 'share landed by day 7/14/30:', JSON.stringify(tail));

// ---- Supporting tables: afterlife events by kind, mix by tier, fleet hours by tier, role × tier from lineage.
console.log('\nchosen-tier code changes, afterlife within 30 days, by implementer tier (events per 100 changes):');
for (const t of [...TIERS, null]) {
  const cs = chosen.filter((c) => c.implementer === t); if (!cs.length) continue;
  const per = (k) => f((sum(cs.map((c) => c.afterlife[k])) / cs.length) * 100, 0);
  const mix = (k, vals) => vals.map((v) => `${v} ${f((cs.filter((c) => c[k] === v).length / cs.length) * 100, 0)}%`).join(', ');
  console.log(' ', t || 'unattributed', 'n', cs.length, '| escaped bugs', per('escapedBugs'), '| named fixes', per('namedFixes'), '| same-file fixes', per('sameFileFixes'), '| follow-ups', per('followUps'), '| relanded', f((cs.filter((c) => c.relanded).length / cs.length) * 100, 0),
    '| size:', mix('size', ['1-49', '50-299', '300+']), '| area:', mix('area', ['UI', 'lib', 'routes', 'prompts', 'runner', 'other']), '| high risk', f((cs.filter((c) => c.risk === 'high').length / cs.length) * 100, 0) + '%');
}
const hoursIn = (a, z) => { const h = {}; for (const [w, v] of Object.entries(fleetWeek)) if (w >= a && w < z) for (const [t, x] of Object.entries(v.hours)) h[t] = (h[t] || 0) + x; const tot = sum(Object.values(h)); return Object.fromEntries(Object.entries(h).map(([t, x]) => [t, `${f(x, 0)} h (${f((x / tot) * 100, 0)}%)`])); };
console.log('\nfleet working hours by session tier:', 'chosen-tier period', JSON.stringify(hoursIn('2026-07-13', '2026-08-31')), '| September', JSON.stringify(hoursIn('2026-08-31', '2026-10-01')));
const roles = {}; for (const l of lineage.values()) for (const s of l.sessions) { const r = (roles[s.kind] ||= { frontier: 0, mid: 0, cheap: 0, unknown: 0 }); r[s.tier || 'unknown']++; }
console.log('\nlineage sessions by role × tier (changes merged since 20 July that have a lineage):'); for (const [k, v] of Object.entries(roles).sort((a, b) => sum(Object.values(b[1])) - sum(Object.values(a[1])))) console.log(' ', k.padEnd(15), JSON.stringify(v));
const byMonthRole = {}; for (const l of lineage.values()) for (const s of l.sessions) { if (!['implementation', 'review', 'plan', 'close-out', 'research', 'autopilot', 'plan-review'].includes(s.kind)) continue; const m = s.at.slice(0, 7); const r = ((byMonthRole[m] ||= {})[s.kind] ||= { frontier: 0, mid: 0, cheap: 0 }); if (s.tier) r[s.tier]++; }
console.log('\nrole × tier by month of dispatch:'); for (const [m, v] of Object.entries(byMonthRole).sort()) console.log(' ', m, Object.entries(v).map(([k, x]) => `${k} ${x.frontier}/${x.mid}/${x.cheap}`).join(' · '), '(frontier/mid/cheap)');
const usdRoles = {}; for (const l of lineage.values()) for (const s of l.sessions) if (s.usd != null) { const k = `${s.kind}|${s.tier}`; usdRoles[k] = (usdRoles[k] || 0) + s.usd; }
const usdTot = sum(Object.values(usdRoles)); console.log('\nlineage USD by role|tier (share of all):', Object.entries(usdRoles).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${f((v / usdTot) * 100, 0)}%`).join(', '), '| imputed share', f((sum([...lineage.values()].flatMap((l) => l.sessions.filter((s) => s.imputed).map((s) => s.usd))) / usdTot) * 100, 0) + '%');

console.log('\nSeptember, ticket-scoped lineage USD (no autopilot/wake/blocked sessions) by implementer tier:');
for (const t of TIERS) { const cs = scored.filter((c) => inP(c, PERIODS[2]) && c.implementer === t && c.usdScoped != null); const g = cs.filter((c) => c.good).length; const tot = sum(cs.map((c) => c.usdScoped)); const pr = sum(cs.map((c) => c.usdScopedPriced));
  console.log(' ', t, 'priced changes', cs.length, 'correct', g, '$/correct change', f(g ? tot / g : null, 2), 'median $/change', f(median(cs.map((c) => c.usdScoped)), 2), 'priced (not imputed) share', f((pr / (tot || 1)) * 100, 0) + '%', '| rework $ per change (ceiling)', f(sum(cs.map((c) => c.afterlife.reworkCeilUsd)) / (cs.length || 1), 2)); }
