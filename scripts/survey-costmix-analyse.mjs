// LIN-3180: the cost mix — weighted tokens, dispatches and hours by class of change, size band and ticket shape; catches and escapes per class; the effort curve; the Amdahl bound; the fixed cost per ticket; and correct changes per weighted token.
// Usage: node scripts/survey-costmix-analyse.mjs [--out data/survey-costmix/analysis.json]
// Run first: survey-costmix-classes.mjs, survey-costmix-tokens.mjs, survey-doubling-runner.mjs --out data/survey-costmix/dispatch-items.json,
// survey-effort-runner.mjs, survey-reliability-github.mjs, survey-reliability-tracker.mjs (proxy) and survey-scorecard.mjs (correct and
// complete verdicts). Catches are read from the committed codes of which-rules-pay.md and reliability-baseline.md; escapes from the
// committed Bug verdicts. A ticket with no merged change is bucketed as a parent (some ticket names it as parent), no merged change,
// or no ticket. "child named" charges a token or dispatch to the ticket its dispatch item names; "session entered" to the ticket of
// the session it ran in. Intervals are Wilson 95% for rates and percentile bootstrap (2,000 resamples, seeded) for medians and shares.
import { readFileSync, writeFileSync, existsSync } from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const out = arg('--out', 'data/survey-costmix/analysis.json');

const classes = read('data/survey-costmix/classes.json');
const tokens = read('data/survey-costmix/tokens.json');
const items = read('data/survey-costmix/dispatch-items.json').rows;
const runner = Object.fromEntries(read('data/survey-effort/runner.json').rows.map((r) => [r.id, r]));
const tracker = read('data/survey/reliability-tracker.json');
const scorecard = existsSync('data/survey/scorecard.json') ? read('data/survey/scorecard.json') : null;
const wrp = read('docs/papers/harbour/which-rules-pay-codes.json');
const blockers = read('docs/papers/harbour/reliability-baseline-review-blockers.json');
const verdicts = read('docs/papers/harbour/reliability-baseline-defects.json').verdicts;

const CLASSES = ['credentials/auth', 'fleet machinery', 'simple-dispatcher', 'UI', 'other', 'docs/tests only'];
const OVERHEAD = ['parent, no own change', 'no merged change', 'no ticket'];
const BUCKETS = [...CLASSES, ...OVERHEAD];
const BANDS = ['0', '1-49', '50-299', '300+'];

// ---- Helpers ---------------------------------------------------------------------------------------------------------
let seed = 20261001; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const quant = (s, q) => s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
const bootMedian = (xs) => { if (xs.length < 3) return [null, null]; const ms = []; for (let b = 0; b < 2000; b++) { const r = []; for (let i = 0; i < xs.length; i++) r.push(xs[Math.floor(rnd() * xs.length)]); ms.push(median(r)); } ms.sort((a, b) => a - b); return [quant(ms, 0.025), quant(ms, 0.975)]; };
const wilson = (k, n) => { if (!n) return [null, null, null]; const z = 1.96; const p = k / n; const d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d; const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [p, Math.max(0, c - h), Math.min(1, c + h)]; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10); const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const pct = (a, b) => (b ? r1((100 * a) / b) : null);
const M = (x) => (x == null ? null : r1(x / 1e6));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// ---- Tickets: class, shape ---------------------------------------------------------------------------------------------
const change = Object.fromEntries(classes.rows.map((r) => [r.id, r]));
const parentOf = {}; const childrenOf = {}; const exists = new Set();
for (const i of tracker.list) { exists.add(i.identifier); if (i.parent) { parentOf[i.identifier] = i.parent; (childrenOf[i.parent] ||= []).push(i.identifier); } }
const shapeOf = (id) => (childrenOf[id]?.length ? 'parent' : parentOf[id] ? 'child' : 'standalone');
const bucketOf = (id) => (!id || id === '?' ? 'no ticket' : change[id] ? change[id].cls : childrenOf[id]?.length ? 'parent, no own change' : 'no merged change');

// ---- 1. The mix --------------------------------------------------------------------------------------------------------
const tokBy = (rule) => { const m = Object.fromEntries(BUCKETS.map((b) => [b, 0])); for (const [id, v] of Object.entries(rule === 'child' ? tokens.byChild : tokens.bySession)) m[bucketOf(id)] += v; m['no ticket'] += tokens.fleetUnmapped; return m; };
const tok = { child: tokBy('child'), session: tokBy('session') };
const tokTotal = sum(Object.values(tok.child));
// Of the docs/tests-only spend, the survey papers' share (a change that touched docs/papers/).
const paperTok = sum(Object.entries(tokens.byChild).filter(([id]) => change[id]?.paper && change[id].cls === 'docs/tests only').map(([, v]) => v));

// Dispatches: every claimed item that opened, resumed or signalled a session. child = its own Issue line (else its root's);
// session = the ticket of the item that created the session it ran in.
const sessIssue = {}; for (const r of items) if (r.shape === 'fresh' && r.session) sessIssue[r.session] ??= r.issueLine || r.issue || null;
const disp = {};
for (const r of items) {
  if (!['fresh', 'warm', 'cold'].includes(r.shape)) continue;
  const mo = (r.at || '').slice(0, 7); if (mo !== '2026-08' && mo !== '2026-09') continue;
  const child = r.issueLine || r.issue || null; const sess = (r.session && sessIssue[r.session]) || child;
  const d = (disp[mo] ||= { child: Object.fromEntries(BUCKETS.map((b) => [b, 0])), session: Object.fromEntries(BUCKETS.map((b) => [b, 0])), n: 0 });
  d.child[bucketOf(child)]++; d.session[bucketOf(sess)]++; d.n++;
}
// Hours and change counts: changes merged in the month (hours are each change's whole life, from the runner's oplog).
const cohort = (mo) => classes.rows.filter((r) => r.month === mo);
const hours = {}; const counts = {};
for (const mo of ['2026-08', '2026-09']) {
  hours[mo] = Object.fromEntries(CLASSES.map((c) => [c, sum(cohort(mo).filter((r) => r.cls === c).map((r) => runner[r.id]?.workH || 0))]));
  counts[mo] = Object.fromEntries(CLASSES.map((c) => [c, cohort(mo).filter((r) => r.cls === c).length]));
}
const mixRows = BUCKETS.map((b) => ({
  bucket: b,
  tokSepChild: pct(tok.child[b], tokTotal), tokSepSession: pct(tok.session[b], tokTotal), tokSepM: M(tok.child[b]),
  dispAugChild: pct(disp['2026-08'].child[b], disp['2026-08'].n), dispAugSession: pct(disp['2026-08'].session[b], disp['2026-08'].n),
  dispSepChild: pct(disp['2026-09'].child[b], disp['2026-09'].n), dispSepSession: pct(disp['2026-09'].session[b], disp['2026-09'].n),
  hoursAug: CLASSES.includes(b) ? pct(hours['2026-08'][b], sum(Object.values(hours['2026-08']))) : null,
  hoursSep: CLASSES.includes(b) ? pct(hours['2026-09'][b], sum(Object.values(hours['2026-09']))) : null,
  changesAug: counts['2026-08'][b] ?? null, changesSep: counts['2026-09'][b] ?? null,
}));

// By size band and by shape, September tokens (child rule) and August + September dispatches (child rule), merged changes plus
// the parents' own spend.
const bandShape = {};
for (const key of ['band', 'shape']) {
  const t = {}; const d = {}; const n = {};
  for (const [id, v] of Object.entries(tokens.byChild)) { const c = change[id]; if (!c && key === 'band') continue; const k = key === 'band' ? c.band : shapeOf(id); t[k] = (t[k] || 0) + v; }
  for (const r of items) { if (!['fresh', 'warm', 'cold'].includes(r.shape)) continue; const mo = (r.at || '').slice(0, 7); if (mo !== '2026-08' && mo !== '2026-09') continue; const id = r.issueLine || r.issue; const c = change[id]; if (!c && key === 'band') continue; if (!id) continue; const k = key === 'band' ? c.band : shapeOf(id); d[k] = (d[k] || 0) + 1; }
  for (const r of classes.rows) if (r.month === '2026-08' || r.month === '2026-09') { const k = key === 'band' ? r.band : shapeOf(r.id); n[k] = (n[k] || 0) + 1; }
  bandShape[key] = { tokShareOfAll: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, pct(v, tokTotal)])), dispatches: d, changesAugSep: n };
}
// Class × shape: September tokens by class for each shape.
const classShape = Object.fromEntries(CLASSES.map((c) => [c, Object.fromEntries(['standalone', 'child', 'parent'].map((s) => [s, M(sum(Object.entries(tokens.byChild).filter(([id]) => change[id]?.cls === c && shapeOf(id) === s).map(([, v]) => v)))]))]));

// ---- September-born changes: every token of the ticket is in the window ------------------------------------------------
// A change is September-born when its first claimed dispatch is on or after 1 Sep, it merged by 30 Sep, and no dispatch for it ran
// on OpenCode (which writes no transcript).
const firstDisp = {}; const ocTicket = new Set(); const dispCount = {};
for (const r of items) { if (!['fresh', 'warm', 'cold'].includes(r.shape)) continue; const id = r.issueLine || r.issue; if (!id) continue; if (!firstDisp[id] || r.at < firstDisp[id]) firstDisp[id] = r.at; if (r.harness === 'opencode') ocTicket.add(id); dispCount[id] = (dispCount[id] || 0) + 1; }
const born = classes.rows.filter((r) => r.month === '2026-09' && firstDisp[r.id] >= '2026-09-01' && !ocTicket.has(r.id) && tokens.byChild[r.id]);
const sc = scorecard ? Object.fromEntries(scorecard.changes.map((c) => [c.id, c])) : {};

// ---- 4. Fixed cost and granularity --------------------------------------------------------------------------------------
// Children share sessions with their parent (a stepper or lane may do a child's work in the parent's session), so the per-change
// floor is read on standalone changes only; families are read whole below.
const bornSA = born.filter((r) => shapeOf(r.id) === 'standalone');
const floorRow = (pop) => (b) => { const xs = pop.filter((r) => r.band === b); const t = xs.map((r) => tokens.byChild[r.id]); const tS = xs.map((r) => tokens.bySession[r.id] || 0); return { band: b, n: xs.length, medTokM: M(median(t)), ciM: bootMedian(t).map(M), medTokSessionM: M(median(tS)), medDisp: median(xs.map((r) => dispCount[r.id] || 0)), medWorkH: r1(median(xs.map((r) => runner[r.id]?.workH ?? null))) }; };
const floorRows = BANDS.map(floorRow(bornSA));
const floorRowsAllShapes = BANDS.map(floorRow(born));
const floorByClass = CLASSES.map((c) => { const xs = bornSA.filter((r) => r.cls === c); const small = xs.filter((r) => r.band === '1-49' || r.band === '0'); return { cls: c, n: xs.length, medTokM: M(median(xs.map((r) => tokens.byChild[r.id]))), nSmall: small.length, medSmallM: M(median(small.map((r) => tokens.byChild[r.id]))), medProd: median(xs.map((r) => r.prodLines)) }; });
// Floor share: what the September-born changes would cost if each cost only the small-change median.
const floor = median(bornSA.filter((r) => r.band === '1-49').map((r) => tokens.byChild[r.id]));
const floorShare = pct(bornSA.length * floor, sum(bornSA.map((r) => tokens.byChild[r.id])));
// A linear fit of tokens on production lines over standalone September-born code changes: the intercept is the fixed part.
const codeSA = bornSA.filter((r) => r.prodLines > 0); const fx = codeSA.map((r) => r.prodLines); const fy = codeSA.map((r) => tokens.byChild[r.id]);
const fmx = sum(fx) / fx.length; const fmy = sum(fy) / fy.length; const fb = sum(fx.map((x, i) => (x - fmx) * (fy[i] - fmy))) / sum(fx.map((x) => (x - fmx) ** 2));
const linFit = { n: codeSA.length, interceptM: M(fmy - fb * fmx), perLineK: r1(fb / 1e3), meanM: M(fmy), meanProd: Math.round(fmx) };
// Splitting: share of changes that are children; for September families (a parent and its merged children), what the parent's
// own spend adds to the children's.
const augSep = classes.rows.filter((r) => r.month === '2026-08' || r.month === '2026-09');
const shapeShare = Object.fromEntries(['standalone', 'child', 'parent'].map((s) => [s, augSep.filter((r) => shapeOf(r.id) === s).length]));
const families = Object.keys(childrenOf).map((p) => {
  const kids = childrenOf[p].filter((k) => change[k] && (change[k].month === '2026-09' || change[k].month === '2026-10') && tokens.byChild[k]);
  if (!kids.length || !tokens.byChild[p] && !tokens.bySession[p]) return null;
  return { parent: p, kids: kids.length, parentChild: tokens.byChild[p] || 0, parentSession: tokens.bySession[p] || 0, kidsChild: sum(kids.map((k) => tokens.byChild[k])), kidsSession: sum(kids.map((k) => tokens.bySession[k] || 0)), kidProd: sum(kids.map((k) => change[k].prodLines)), parentOwnChange: !!change[p] };
}).filter(Boolean);
// What splitting added: a September family (parent first dispatched in September) against the standalone mean of each child's band
// (a mean, because it is summed; costs are right-skewed, so a median would flatter the standalone side).
const saMed = Object.fromEntries(BANDS.map((b) => { const xs = bornSA.filter((r) => r.band === b).map((r) => tokens.byChild[r.id]); return [b, xs.length ? sum(xs) / xs.length : 0]; }));
const sepFam = families.filter((f) => firstDisp[f.parent] >= '2026-09-01');
const famVsSA = { n: sepFam.length, kids: sum(sepFam.map((f) => f.kids)), actualM: M(sum(sepFam.map((f) => f.parentChild + f.kidsChild))), asStandaloneM: M(sum(sepFam.map((f) => sum(childrenOf[f.parent].filter((k) => change[k] && tokens.byChild[k] && (change[k].month === '2026-09' || change[k].month === '2026-10')).map((k) => saMed[change[k].band] || 0))))), parentShare: pct(sum(sepFam.map((f) => f.parentChild)), sum(sepFam.map((f) => f.parentChild + f.kidsChild))) };
const famAdd = { child: pct(sum(families.map((f) => f.parentChild)), sum(families.map((f) => f.kidsChild))), session: pct(sum(families.map((f) => f.parentSession)), sum(families.map((f) => f.kidsSession))) };
// A child against a standalone change of the same band (September-born).
const childVsStandalone = BANDS.map((b) => { const xs = born.filter((r) => r.band === b); const k = xs.filter((r) => shapeOf(r.id) === 'child').map((r) => tokens.byChild[r.id]); const s = xs.filter((r) => shapeOf(r.id) === 'standalone').map((r) => tokens.byChild[r.id]); return { band: b, nChild: k.length, medChildM: M(median(k)), nStandalone: s.length, medStandaloneM: M(median(s)) }; });

// ---- 2. Catches and escapes per class -------------------------------------------------------------------------------------
const catchRows = CLASSES.map((c) => {
  const coded = wrp.tickets.filter((t) => (change[t.id]?.cls || 'no merged change') === c);
  const faults = sum(coded.map((t) => t.consequences.filter((x) => x.realFault).length));
  const prodFindings = sum(coded.map((t) => t.consequences.filter((x) => x.effect === 'prod').length));
  const withFault = coded.filter((t) => t.consequences.some((x) => x.realFault)).length;
  const tk = sum(coded.map((t) => tokens.byChild[t.id] || 0));
  const bl = blockers.tickets.filter((t) => (change[t.identifier]?.cls) === c);
  return { cls: c, coded: coded.length, realFaults: faults, ticketsWithFault: withFault, prodFindings, faultsPerTicket: r3(faults / (coded.length || 1)), tokensM: M(tk), faultsPer1BUnits: tk ? r1(faults / (tk / 1e9)) : null, blockerTickets: bl.length, bugBlockers: sum(bl.map((t) => t.blockers.filter((x) => x.class === 'bug').length)) };
});
// The same by size band, with the review and plan-review legs' own spend (session-entered, by the leg's kind) on the coded tickets.
const gateUnits = (id) => { const k = tokens.kindByTicket[id] || {}; return (k.review || 0) + (k['plan-review'] || 0); };
const catchByBand = BANDS.map((b) => { const coded = wrp.tickets.filter((t) => change[t.id]?.band === b); const f = sum(coded.map((t) => t.consequences.filter((x) => x.realFault).length)); return { band: b, coded: coded.length, realFaults: f, ticketsWithFault: coded.filter((t) => t.consequences.some((x) => x.realFault)).length, gateM: M(sum(coded.map((t) => gateUnits(t.id)))), tokensM: M(sum(coded.map((t) => tokens.byChild[t.id] || 0))) }; });
for (const r of catchRows) { const coded = wrp.tickets.filter((t) => change[t.id]?.cls === r.cls); r.gateM = M(sum(coded.map((t) => gateUnits(t.id)))); r.faultsPer100MGate = r.gateM ? r1(r.realFaults / (r.gateM / 100)) : null; }
const codedUnclassed = wrp.tickets.filter((t) => !change[t.id]).map((t) => t.id);
// Escapes: escaped Bugs naming an introducer, by the introducer's class, against changes merged June–August (mature at the 30 Sep cut).
const mature = classes.rows.filter((r) => r.month >= '2026-06' && r.month <= '2026-08');
const escRows = CLASSES.map((c) => {
  const pop = mature.filter((r) => r.cls === c); const ids = new Set(pop.map((r) => r.id));
  const named = verdicts.filter((v) => v.verdict === 'escaped' && v.introducedBy && ids.has(v.introducedBy));
  const introducers = new Set(named.map((v) => v.introducedBy));
  const s = pop.map((r) => sc[r.id]).filter(Boolean); const notCorrect = s.filter((x) => !x.correct).length; const notComplete = s.filter((x) => !x.complete).length;
  const [p, lo, hi] = wilson(introducers.size, pop.length); const [p2, lo2, hi2] = wilson(notCorrect, s.length);
  return { cls: c, changes: pop.length, escapedBugs: named.length, changesWithEscape: introducers.size, rate: r3(p), lo: r3(lo), hi: r3(hi), scored: s.length, notCorrect, notCorrectRate: r3(p2), ncLo: r3(lo2), ncHi: r3(hi2), notComplete };
});

const escByBand = BANDS.map((b) => { const pop = mature.filter((r) => r.band === b); const ids = new Set(pop.map((r) => r.id)); const k = new Set(verdicts.filter((v) => v.verdict === 'escaped' && v.introducedBy && ids.has(v.introducedBy)).map((v) => v.introducedBy)).size; const [p, lo, hi] = wilson(k, pop.length); return { band: b, changes: pop.length, changesWithEscape: k, rate: r3(p), lo: r3(lo), hi: r3(hi) }; });
// The curve: within each class, mature changes split into terciles of work hours for their size (the residual of log hours on
// log production lines across all mature changes), against the share that were not correct and the share with a named escape.
const mat = mature.filter((r) => runner[r.id]?.workH > 0 && sc[r.id]);
const xs = mat.map((r) => Math.log(r.prodLines + 1)); const ys = mat.map((r) => Math.log(runner[r.id].workH));
const mx = sum(xs) / xs.length; const my = sum(ys) / ys.length;
const slope = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / sum(xs.map((x) => (x - mx) ** 2)); const icpt = my - slope * mx;
const resid = Object.fromEntries(mat.map((r, i) => [r.id, ys[i] - (icpt + slope * xs[i])]));
const escapedIntroducers = new Set(verdicts.filter((v) => v.verdict === 'escaped' && v.introducedBy).map((v) => v.introducedBy));
const curve = [...CLASSES, 'all'].map((c) => {
  const pop = mat.filter((r) => c === 'all' || r.cls === c).sort((a, b) => resid[a.id] - resid[b.id]);
  const n = pop.length; const cut = [0, Math.round(n / 3), Math.round((2 * n) / 3), n];
  return { cls: c, n, terciles: [0, 1, 2].map((k) => { const g = pop.slice(cut[k], cut[k + 1]); const nc = g.filter((r) => !sc[r.id].correct).length; const es = g.filter((r) => escapedIntroducers.has(r.id)).length; const [p, lo, hi] = wilson(nc, g.length); const [pe, le, he] = wilson(es, g.length); return { n: g.length, medWorkH: r1(median(g.map((r) => runner[r.id].workH))), medProd: median(g.map((r) => r.prodLines)), notCorrect: nc, rate: r3(p), lo: r3(lo), hi: r3(hi), escaped: es, escRate: r3(pe), escLo: r3(le), escHi: r3(he) }; }) };
});

// ---- 3. The bound ------------------------------------------------------------------------------------------------------------
// Amdahl: if a set of buckets keeps its cost and the rest falls by a factor f, correct work per budget rises by 1 / (held + rest/f),
// assuming the same correct output. Shares from September tokens under each charging rule.
const share = (rule) => Object.fromEntries(BUCKETS.map((b) => [b, tok[rule][b] / tokTotal]));
const FACTORS = [1, 1.5, 2, 3, 4, 5, 7, 10, 20, 50, Infinity];
const SCEN = {
  'everything cuts': [],
  'credentials/auth held': ['credentials/auth'],
  'credentials + fleet held': ['credentials/auth', 'fleet machinery'],
  'only docs/tests and UI cut': [...BUCKETS.filter((b) => b !== 'docs/tests only' && b !== 'UI')],
  'changes cut, overhead held': OVERHEAD,
};
const bound = Object.fromEntries(['child', 'session'].map((rule) => { const s = share(rule); return [rule, Object.fromEntries(Object.entries(SCEN).map(([k, held]) => { const h = sum(held.map((b) => s[b])); return [k, { held: r3(h), multiples: FACTORS.map((f) => (f === Infinity ? (h ? r1(1 / h) : null) : r1(1 / (h + (1 - h) / f)))) }]; }))]; }));

// Groups for the Options' arithmetic: September tokens (child rule) by credentials, size band of other changes, and overhead.
const groupOf = (id) => { const b = bucketOf(id); if (OVERHEAD.includes(b)) return b === 'parent, no own change' ? 'parents' : 'no change'; if (b === 'credentials/auth') return 'credentials'; if (change[id].paper && b === 'docs/tests only') return 'papers'; return change[id].band === '300+' ? '300+' : change[id].band === '50-299' ? '50-299' : '0-49'; };
const GROUPS = ['credentials', '300+', '50-299', '0-49', 'papers', 'parents', 'no change'];
const gTok = Object.fromEntries(GROUPS.map((g) => [g, 0])); for (const [id, v] of Object.entries(tokens.byChild)) gTok[groupOf(id)] += v; gTok['no change'] += tokens.fleetUnmapped;
const gShare = Object.fromEntries(GROUPS.map((g) => [g, r3(gTok[g] / tokTotal)]));
const multiple = (f) => r1(1 / sum(GROUPS.map((g) => gTok[g] / tokTotal / (f[g] || 1))));
const scenarios = [
  ['light lane for small changes (0–49 lines, not credentials or papers) at a third', { '0-49': 3 }],
  ['as above, and parents cost half', { '0-49': 3, parents: 2 }],
  ['everything but credentials and 300+ halves', { '0-49': 2, '50-299': 2, papers: 2, parents: 2, 'no change': 2 }],
  ['fixed part halves everywhere (about half of each change)', Object.fromEntries(GROUPS.map((g) => [g, 1 / (0.5 + 0.5 / 2)]))],
  ['credentials held; all else at a third', { '300+': 3, '50-299': 3, '0-49': 3, papers: 3, parents: 3, 'no change': 3 }],
  ['credentials held; all else at a tenth', { '300+': 10, '50-299': 10, '0-49': 10, papers: 10, parents: 10, 'no change': 10 }],
].map(([k, f]) => ({ scenario: k, multiple: multiple(f) }));

// ---- 5. A measure native to the budget ----------------------------------------------------------------------------------------
const sepChanges = classes.rows.filter((r) => r.month === '2026-09');
const good = (id) => sc[id]?.correct && sc[id]?.complete;
const native = {
  fleetUnitsSepM: M(tokTotal), sepChanges: sepChanges.length, sepGood: sepChanges.filter((r) => good(r.id)).length,
  unitsPerGoodM: r1(tokTotal / 1e6 / (sepChanges.filter((r) => good(r.id)).length || 1)),
  goodPer1BUnits: r1(sepChanges.filter((r) => good(r.id)).length / (tokTotal / 1e9)),
  // Per class as a flow: the class's September units (child rule) over its September merges that are correct and complete
  // (provisional: the 30-day window is not over). Spend on parents and on no merged change is left out of every class.
  perClass: CLASSES.map((c) => { const xs = sepChanges.filter((r) => r.cls === c); const g = xs.filter((r) => good(r.id)).length; const t = tok.child[c]; return { cls: c, merged: xs.length, good: g, tokensM: M(t), goodPer1BUnits: t ? r1(g / (t / 1e9)) : null, unitsPerGoodM: g ? r1(t / 1e6 / g) : null }; }),
  classesOnly: (() => { const t = sum(CLASSES.map((c) => tok.child[c])); const g = sepChanges.filter((r) => good(r.id)).length; return { tokensM: M(t), good: g, unitsPerGoodM: g ? r1(t / 1e6 / g) : null }; })(),
  bornAll: { n: born.length, good: born.filter((r) => good(r.id)).length, tokensM: M(sum(born.map((r) => tokens.byChild[r.id]))), shareOfFleet: pct(sum(born.map((r) => tokens.byChild[r.id])), tokTotal) },
  // The meter: LIN-2087's one calibration (lib/weekly-budget.js): 27 points of the weekly window against $1,070.58 at the then
  // pricing table, which LIN-2113 found understated the day by 18.2%. Units are $5 per million.
  allowanceUnitsM: [r1(1070.58 / 5 / 27 * 100), r1((1070.58 / (1 - 0.182)) / 5 / 27 * 100)],
  fleetUnitsPerWeekM: r1(tokTotal / 1e6 / 30 * 7), otherProjectsShare: pct(tokens.otherUnits, tokTotal + tokens.otherUnits),
};

const analysis = { paperTokShare: pct(paperTok, tokTotal), generatedAt: new Date().toISOString(), heads: classes.heads, scorecardCut: scorecard?.cut || null, tokTotalM: M(tokTotal), fleetUnmappedM: M(tokens.fleetUnmapped), dispatchesAug: disp['2026-08'].n, dispatchesSep: disp['2026-09'].n, mixRows, bandShape, classShape, floorRows, floorByClass, floorShare, shapeShare, families: { n: families.length, add: famAdd, kids: sum(families.map((f) => f.kids)), famVsSA }, floorRowsAllShapes, linFit, bornStandalone: bornSA.length, childVsStandalone, catchRows, catchByBand, codedUnclassed, escRows, escByBand, curve, curveFit: { slope: r3(slope), n: mat.length }, bound, gShare, scenarios, factors: FACTORS.map(String), native, born: born.length };
writeFileSync(out, JSON.stringify(analysis, null, 1));

// ---- Print -----------------------------------------------------------------------------------------------------------------
const T = (rows, cols) => { console.log(cols.join('\t')); for (const r of rows) console.log(cols.map((c) => (Array.isArray(r[c]) ? r[c].join('–') : r[c])).join('\t')); console.log(); };
console.log(`survey papers ${pct(paperTok, tokTotal)}% of September units`);
console.log(`September fleet units ${M(tokTotal)}M (no-ticket ${M(tokens.fleetUnmapped)}M); dispatches Aug ${disp['2026-08'].n}, Sep ${disp['2026-09'].n}; scorecard ${scorecard ? 'cut ' + (scorecard.cut || '?') : 'MISSING'}\n`);
T(mixRows, ['bucket', 'tokSepChild', 'tokSepSession', 'tokSepM', 'dispAugChild', 'dispAugSession', 'dispSepChild', 'dispSepSession', 'hoursAug', 'hoursSep', 'changesAug', 'changesSep']);
console.log('band/shape', JSON.stringify(bandShape), '\nclass×shape (M, child rule)', JSON.stringify(classShape), '\n');
T(floorRows, ['band', 'n', 'medTokM', 'ciM', 'medTokSessionM', 'medDisp', 'medWorkH']);
T(floorRowsAllShapes, ['band', 'n', 'medTokM', 'ciM', 'medTokSessionM', 'medDisp', 'medWorkH']);
console.log('linear fit (standalone code changes)', JSON.stringify(linFit), 'families vs standalone', JSON.stringify(famVsSA));
T(floorByClass, ['cls', 'n', 'medTokM', 'nSmall', 'medSmallM', 'medProd']);
console.log(`floor share ${floorShare}% of September-born tokens; shapes Aug–Sep ${JSON.stringify(shapeShare)}; families ${families.length}, parent adds ${JSON.stringify(famAdd)}% to its children\n`);
T(childVsStandalone, ['band', 'nChild', 'medChildM', 'nStandalone', 'medStandaloneM']);
T(catchRows, ['cls', 'coded', 'realFaults', 'ticketsWithFault', 'prodFindings', 'faultsPerTicket', 'tokensM', 'faultsPer1BUnits', 'gateM', 'faultsPer100MGate', 'blockerTickets', 'bugBlockers']);
T(catchByBand, ['band', 'coded', 'realFaults', 'ticketsWithFault', 'gateM', 'tokensM']);
console.log('coded but no merged change:', codedUnclassed.join(' '), '\n');
T(escRows, ['cls', 'changes', 'escapedBugs', 'changesWithEscape', 'rate', 'lo', 'hi', 'scored', 'notCorrect', 'notCorrectRate', 'ncLo', 'ncHi', 'notComplete']);
T(escByBand, ['band', 'changes', 'changesWithEscape', 'rate', 'lo', 'hi']);
for (const c of curve) console.log(c.cls.padEnd(18), c.n, c.terciles.map((t) => `[${t.medWorkH}h ${t.medProd}l nc ${t.notCorrect}/${t.n} ${t.rate} (${t.lo}–${t.hi}) esc ${t.escaped}]`).join(' '));
console.log(`fit slope ${r3(slope)} over ${mat.length}\n`);
for (const [rule, b] of Object.entries(bound)) for (const [k, v] of Object.entries(b)) console.log(rule.padEnd(8), k.padEnd(28), 'held', v.held, v.multiples.join(' '));
console.log('groups', JSON.stringify(gShare)); for (const x of scenarios) console.log(x.multiple + '×', x.scenario);
console.log('\nnative', JSON.stringify(native, null, 1));
