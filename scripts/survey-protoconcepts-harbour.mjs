// LIN-3187: what a Harbour research paper and a Harbour code change cost per ticket in September, both charging rules, from the cost-mix census snapshots.
// Usage: node scripts/survey-protoconcepts-harbour.mjs [--tokens data/survey-protoconcepts/tokens.json] [--dollars data/survey-protoconcepts/dollars.json] [--classes data/survey-protoconcepts/classes.json] [--out data/survey-protoconcepts/harbour.json]
// Inputs are made by the cost-mix scripts, unchanged, with no proxy calls:
//   node scripts/survey-costmix-tokens.mjs --since 2026-09-01 --until 2026-10-01T10:00:00Z --out data/survey-protoconcepts/tokens.json
//   node scripts/survey-protoconcepts-dollars.mjs   (the same census priced in dollars by Lighthouse's price table)
//   node scripts/survey-costmix-classes.mjs --since 2026-08-01 --sd ../simple-dispatcher --out data/survey-protoconcepts/classes.json
// Populations, fixed before any cost was read:
//   lean paper     — a ticket whose merge touched docs/papers/, classed docs/tests only, worked in at most two sessions, every one a
//                    custom, research or wake launch (one bounded session, as this wave's papers are);
//   check          — a lean paper ticket that is one of the checks in the checks file;
//   pipeline paper — the same, but worked through three or more sessions (research, plan, review, close-out legs);
//   code change    — a ticket whose last merge fell 1–30 September and that changed production lines outside docs/tests.
// Checks: docs/papers/harbour/prototype-concepts-checks.json codes what each independent check found in the paper it checked;
// a checked paper's cost adds its share of its check's session (the check's cost over the papers it checked).
// Weighted tokens are survey-costmix-tokens.mjs's (frontier-input-token equivalents at list-price ratios). A ticket's cost is
// given by the session entered and by the child the log names. Wall-clock is first to last assistant message across its sessions.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const tok = JSON.parse(readFileSync(arg('--tokens', 'data/survey-protoconcepts/tokens.json'), 'utf8'));
const usd = JSON.parse(readFileSync(arg('--dollars', 'data/survey-protoconcepts/dollars.json'), 'utf8'));
const cls = JSON.parse(readFileSync(arg('--classes', 'data/survey-protoconcepts/classes.json'), 'utf8')).rows;
const out = arg('--out', 'data/survey-protoconcepts/harbour.json');
const checks = JSON.parse(readFileSync(arg('--checks', 'docs/papers/harbour/prototype-concepts-checks.json'), 'utf8')).pairs;

const sessionsBy = {};
for (const s of tok.sessionRows) (sessionsBy[s.issue] ||= []).push(s);
const CHECK_TICKETS = new Set(checks.map((c) => c.checkTicket).filter(Boolean));
const LEAN_KINDS = new Set(['custom', 'research', 'wake']);
const PASSAGE = new Set(['LIN-3099']); // the V1 passage's own ticket: a Runner, not a paper

const q = (xs, p) => { const a = [...xs].sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * p; const lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); };
const summary = (rows) => ({
  n: rows.length,
  enteredM: { p25: q(rows.map((r) => r.enteredM), 0.25), median: q(rows.map((r) => r.enteredM), 0.5), p75: q(rows.map((r) => r.enteredM), 0.75), total: rows.reduce((a, r) => a + r.enteredM, 0) },
  childM: { p25: q(rows.map((r) => r.childM), 0.25), median: q(rows.map((r) => r.childM), 0.5), p75: q(rows.map((r) => r.childM), 0.75), total: rows.reduce((a, r) => a + r.childM, 0) },
  usdEntered: { p25: q(rows.map((r) => r.usdEntered), 0.25), median: q(rows.map((r) => r.usdEntered), 0.5), p75: q(rows.map((r) => r.usdEntered), 0.75), total: rows.reduce((a, r) => a + r.usdEntered, 0) },
  usdChild: { p25: q(rows.map((r) => r.usdChild), 0.25), median: q(rows.map((r) => r.usdChild), 0.5), p75: q(rows.map((r) => r.usdChild), 0.75) },
  sessions: { median: q(rows.map((r) => r.sessions), 0.5), p75: q(rows.map((r) => r.sessions), 0.75) },
  spanH: { median: q(rows.map((r) => r.spanH), 0.5), p75: q(rows.map((r) => r.spanH), 0.75) },
});

const rows = [];
for (const r of cls) {
  if (PASSAGE.has(r.id)) continue;
  const ss = sessionsBy[r.id] || [];
  const enteredM = (tok.bySession[r.id] || 0) / 1e6; const childM = (tok.byChild[r.id] || 0) / 1e6;
  if (!enteredM && !childM) continue; // worked before the census window, or on another machine
  const kinds = [...new Set(ss.map((s) => s.kind))];
  const first = Math.min(...ss.map((s) => s.first)); const last = Math.max(...ss.map((s) => s.last));
  const spanH = ss.length ? (last - first) / 3.6e6 : 0;
  let pop = null;
  if (r.paper && r.cls === 'docs/tests only') pop = ss.length <= 2 && kinds.every((k) => LEAN_KINDS.has(k)) ? (CHECK_TICKETS.has(r.id) ? 'check' : 'lean paper') : ss.length >= 3 ? 'pipeline paper' : null;
  else if (r.cls !== 'docs/tests only' && r.prodLines > 0 && r.lastMerge >= '2026-09-01' && r.lastMerge < '2026-10-01') pop = 'code change';
  if (!pop) continue;
  // A change in both repos is classed by its LinearViewer paths, so it counts as LinearViewer's.
  rows.push({ id: r.id, pop, repo: r.cls === 'simple-dispatcher' ? 'simple-dispatcher' : 'LinearViewer', cls: r.cls, band: r.band, prodLines: r.prodLines, sessions: ss.length, kinds, enteredM: +enteredM.toFixed(2), childM: +childM.toFixed(2), usdEntered: +(usd.bySession[r.id] || 0).toFixed(2), usdChild: +(usd.byChild[r.id] || 0).toFixed(2), spanH: +spanH.toFixed(2) });
}

const pops = ['lean paper', 'check', 'pipeline paper', 'code change'];
const result = { generatedAt: new Date().toISOString(), census: { since: tok.since, until: tok.until, fleetUnitsM: +(tok.fleetUnits / 1e6).toFixed(1) }, populations: {}, codeByBand: {}, codeByRepo: {}, rows };
for (const p of pops) result.populations[p] = summary(rows.filter((r) => r.pop === p));
for (const b of [...new Set(rows.filter((r) => r.pop === 'code change').map((r) => r.band))]) result.codeByBand[b] = summary(rows.filter((r) => r.pop === 'code change' && r.band === b));
for (const rp of ['LinearViewer', 'simple-dispatcher']) result.codeByRepo[rp] = summary(rows.filter((r) => r.pop === 'code change' && r.repo === rp));
// What the checks found, and what a paper costs with its share of its check.
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
const perCheck = {}; for (const c of checks) perCheck[c.check] = (perCheck[c.check] || 0) + 1;
const checked = checks.map((c) => {
  const p = byId[c.paperTicket]; const k = byId[c.checkTicket];
  return { paper: c.paper, kind: c.kind, answer: c.answer, loadBearingOverturned: c.loadBearingOverturned, figuresChanged: c.figuresChanged,
    paperUsd: p?.usdEntered ?? null, checkShareUsd: k ? +(k.usdEntered / perCheck[c.check]).toFixed(2) : null };
});
const priced = checked.filter((c) => c.paperUsd != null && c.checkShareUsd != null);
result.checks = {
  n: checked.length, papers: checked.filter((c) => c.kind === 'paper').length,
  answers: checked.reduce((m, c) => ((m[c.answer] = (m[c.answer] || 0) + 1), m), {}),
  withLoadBearingCorrection: checked.filter((c) => c.loadBearingOverturned > 0).length,
  loadBearingTotal: checked.reduce((a, c) => a + c.loadBearingOverturned, 0),
  figuresChangedMedian: q(checked.filter((c) => c.figuresChanged != null).map((c) => c.figuresChanged), 0.5),
  priced: priced.length, paperUsdMedian: q(priced.map((c) => c.paperUsd), 0.5), checkShareUsdMedian: q(priced.map((c) => c.checkShareUsd), 0.5),
  paperWithCheckUsd: { p25: q(priced.map((c) => c.paperUsd + c.checkShareUsd), 0.25), median: q(priced.map((c) => c.paperUsd + c.checkShareUsd), 0.5), p75: q(priced.map((c) => c.paperUsd + c.checkShareUsd), 0.75) },
  checkShareOfTotal: q(priced.map((c) => c.checkShareUsd / (c.paperUsd + c.checkShareUsd)), 0.5),
  rows: checked,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));
const f = (x) => (x == null ? '-' : x.toFixed(1));
for (const p of pops) { const s = result.populations[p]; console.log(`${p.padEnd(15)} n=${String(s.n).padStart(3)}  entered median ${f(s.enteredM.median)}M (IQR ${f(s.enteredM.p25)}–${f(s.enteredM.p75)})  child median ${f(s.childM.median)}M (IQR ${f(s.childM.p25)}–${f(s.childM.p75)})  $ entered median ${f(s.usdEntered.median)} (IQR ${f(s.usdEntered.p25)}–${f(s.usdEntered.p75)}) child ${f(s.usdChild.median)}  sessions median ${f(s.sessions.median)}  span median ${f(s.spanH.median)}h`); }
const k = result.checks; console.log(`checks: ${k.n} documents (${k.papers} papers); answers ${JSON.stringify(k.answers)}; ${k.withLoadBearingCorrection} with a load-bearing correction (${k.loadBearingTotal} in all); figures changed median ${k.figuresChangedMedian}; priced ${k.priced}: paper $${f(k.paperUsdMedian)} + check share $${f(k.checkShareUsdMedian)}, together median $${f(k.paperWithCheckUsd.median)} (IQR ${f(k.paperWithCheckUsd.p25)}–${f(k.paperWithCheckUsd.p75)}), check ${Math.round(100 * k.checkShareOfTotal)}% of it`);
for (const [b, s] of [...Object.entries(result.codeByBand), ...Object.entries(result.codeByRepo)]) console.log(`  code ${b.padEnd(8)} n=${String(s.n).padStart(3)}  entered median ${f(s.enteredM.median)}M  child median ${f(s.childM.median)}M`);
