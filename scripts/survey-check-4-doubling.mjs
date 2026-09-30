// LIN-3171: the independent check of what-doubled-the-dispatches.md (LIN-3170). One script, several subcommands, all offline.
// Usage: node scripts/survey-check-4-doubling.mjs [verify|missed|cohorts|routes|passage|lineage|rootrule|order|unexplained|testci|all|rekey] [--cut <ISO>] [--rule paper|root] [--state ~/development/simple-dispatcher/state]
// Run first, as the paper's Method says: survey-doubling-runner.mjs, survey-doubling-transcripts.mjs, survey-model-git.mjs --since
// 2026-05-01 --out data/survey-doubling/git.json, and a same-day data/survey/scorecard.json. `missed` also reads model-choice's own
// per-change counts from data/survey-model/analysis.json when present. --cut drops runner items first seen after that instant (the
// runner logs keep growing; the paper's snapshot was taken at 2026-09-30T18:35:38Z). No proxy calls.
// The item classification (kinds, components, passage layer, quiet wakes, changes) is copied from survey-doubling-analyse.mjs, because
// importing that script runs it; `verify` prints the paper's headline figures so the copy can be checked against its report.txt.
// Subcommands:
//   verify       periods, the step, September's steady-base split as the paper prints them
//   missed       the share of each ticket's dispatches that an Issue-line-only count leaves out, by period and by model-choice's own counts
//   cohorts      the fully observed cohorts: sizes, ticket lifetimes, shapes (fresh, warm, cold), lifetime-matched comparisons, log coverage by day
//   routes       how the runner routed follow-ups (SIGNAL warm, RESUME cold by target phase, REJECT) by day window: LIN-1219's and LIN-1260's signatures
//   lineage      follow-ups the paper's rule charges to a change although they entered another ticket's session (from 13 Sep, LIN-2121)
//   rootrule     the paper's series re-counted with one rule for every period: a follow-up counts for the session it entered
//   passage      September's tickets split by whether any dispatch sits in a Runner's or leg's lineage: wakes per worker event on each side
//   order        September's split under other bucket orders
//   unexplained  what the 32% "not in any row" holds: kinds, fresh vs follow-up, beat names, what "kind unread and other" is
//   testci       the test/CI beat regex against a stricter one
//   rekey        (not in `all`) write runner.json re-keyed by the constant rule to --out, for re-running survey-doubling-analyse.mjs on it
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const cmd = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'all';
const cut = arg('--cut', null);
const stateDir = arg('--state', join(homedir(), 'development/simple-dispatcher/state'));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const runner = read('data/survey-doubling/runner.json');
const tx = read('data/survey-doubling/transcripts.json');
const git = read('data/survey-doubling/git.json');
const score = new Map(read('data/survey/scorecard.json').changes.map((c) => [c.id, c]));
const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
const r1 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(1)); const r3 = (x) => (x == null || !isFinite(x) ? null : +x.toFixed(3));
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '–');
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const monday = (iso) => { const d = new Date(iso); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10); };
const show = (label, x) => console.log(label, JSON.stringify(x));
const tally = (xs, f) => { const m = {}; for (const x of xs) { const k = f(x); m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };

// ---- Classification, as survey-doubling-analyse.mjs does it.
const WORK = new Set(['fresh', 'cold', 'warm']);
const allRows = runner.rows.filter((r) => !cut || r.at <= cut);
const items = allRows.filter((r) => WORK.has(r.shape));
const byId = new Map(items.map((r) => [r.item, r]));
const exact = tx.items;
const takesFollowUp = new Set(items.filter((r) => r.shape !== 'fresh').map((r) => r.root));
const LEN = { 3: 'bug', 4: 'plan', 6: 'review', 7: 'blocked', 8: 'research', 9: 'autopilot|close-out', 11: 'plan-review', 14: 'implementation' };
function decode(r) {
  if (r.promptLen == null || r.promptLen > 2000) return null;
  const res = r.promptLen - (r.issueLine ? r.issueLine.length : 0);
  if (!r.issueLine) return res === 385 ? 'other' : null;
  for (const base of [524, 392, 292]) {
    const k = LEN[res - base]; if (!k) continue;
    if (base === 524 && !['plan', 'research', 'implementation'].includes(k)) continue;
    return k === 'autopilot|close-out' ? (takesFollowUp.has(r.item) ? 'autopilot' : 'close-out') : k;
  }
  return null;
}
const PHASES = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out'];
const freshKind = new Map();
for (const r of items) if (r.shape === 'fresh') {
  const e = exact[r.item]?.kind;
  let k = e || decode(r) || (r.harness === 'opencode' ? 'cheap harness, kind unread' : 'kind unread');
  if (k === 'implement') k = 'implementation';
  freshKind.set(r.item, { kind: k, how: e ? 'exact' : decode(r) ? 'decoded' : 'none' });
}
const wsKey = (s) => (s || '').slice(0, 8);
const isRunner = (s) => s.runner && s.header === 'autopilot';
const runnerSessions = new Set(tx.sessions.filter(isRunner).map((s) => wsKey(s.ws)));
const legIssues = new Set(); for (const s of tx.sessions) if (isRunner(s)) for (const x of s.dispatchedIssues) if (x !== s.headerIssue) legIssues.add(x);
const stepperSessions = new Set(tx.sessions.filter((s) => s.stepper).map((s) => wsKey(s.ws)));
const acted = {}; for (const s of tx.sessions) for (const [id, a] of Object.entries(s.acted)) acted[id] = acted[id] || a;
for (const r of items) {
  const root = byId.get(r.root) || r; const rk = freshKind.get(root.item)?.kind || 'kind unread';
  r.rootKind = rk;
  if (r.shape === 'fresh') { r.kind = freshKind.get(r.item).kind; r.kindHow = freshKind.get(r.item).how; r.component = PHASES.includes(r.kind) ? r.kind : r.kind === 'autopilot' ? 'autopilot session' : /unread/.test(r.kind) ? 'fresh, kind unread' : 'other fresh'; }
  else {
    const e = exact[r.item];
    if (e?.kind === 'wake' || (!e && rk === 'autopilot')) r.component = 'wake';
    else if (e ? PHASES.includes(e.kind === 'implement' ? 'implementation' : e.kind) || /^beat/.test(e.promptName || '') : PHASES.includes(rk)) r.component = 'beat into a worker';
    else if (!e && /unread/.test(rk)) r.component = 'follow-up, session kind unread';
    else r.component = 'other follow-up';
    r.kind = e?.kind || null; r.promptName = e?.promptName || null; r.kindHow = e ? 'exact' : 'inferred';
  }
  const ownerSession = root.session8;
  r.passage = runnerSessions.has(ownerSession) ? 'Runner' : (rk === 'autopilot' || r.component === 'autopilot session') && legIssues.has(root.issueLine || r.issue) && r.at >= '2026-09-17' ? 'leg' : null;
  r.stepperSession = stepperSessions.has(ownerSession);
  r.quiet = r.component === 'wake' && r.item in acted ? !acted[r.item] : null;
}
const COMPONENTS = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out', 'autopilot session', 'other fresh', 'fresh, kind unread', 'wake', 'beat into a worker', 'follow-up, session kind unread', 'other follow-up'];
// --rule root re-counts every subcommand with a follow-up charged to the ticket of the session it entered (see `rootrule`).
const RULE = arg('--rule', 'paper');
const ticketOf = (r) => (RULE === 'root' ? (r.shape === 'fresh' ? r.issueLine : byId.get(r.root)?.issueLine || null) : r.issue);
const perIssue = new Map(); for (const r of items) { const t = ticketOf(r); if (t) (perIssue.get(t) || perIssue.set(t, []).get(t)).push(r); }
const gitById = new Map(git.rows.map((g) => [g.id, g]));
const changes = git.rows.filter((g) => g.lastMerge >= '2026-06-01').map((g) => {
  const sc = score.get(g.id); const ds = (perIssue.get(g.id) || []).slice().sort((a, b) => a.at.localeCompare(b.at));
  const comp = {}; for (const c of COMPONENTS) comp[c] = 0; for (const d of ds) comp[d.component]++;
  return { id: g.id, repos: g.repos, week: monday(g.lastMerge), lastMerge: g.lastMerge, prodLines: g.prodLines, docsOnly: g.prodLines === 0, size: g.prodLines === 0 ? '0' : g.prodLines < 50 ? '1-49' : g.prodLines < 300 ? '50-299' : '300+', risk: g.risk, scored: !!sc, good: sc?.good ?? null, n: ds.length, issueLineOnly: ds.filter((d) => d.issueLine === g.id).length, comp, fresh: ds.filter((d) => d.shape === 'fresh').length, warm: ds.filter((d) => d.shape === 'warm').length, cold: ds.filter((d) => d.shape === 'cold').length, ds };
});
const passageEpics = new Set(tx.sessions.filter((s) => isRunner(s) && s.headerIssue).map((s) => s.headerIssue));
const scored = changes.filter((c) => c.scored && c.n > 0 && !passageEpics.has(c.id));
const code = scored.filter((c) => !c.docsOnly);
const PERIODS = [['29 Jun–12 Jul', '2026-06-29', '2026-07-13'], ['13–26 Jul', '2026-07-13', '2026-07-27'], ['27 Jul–31 Aug', '2026-07-27', '2026-08-31'], ['1–13 Sep', '2026-08-31', '2026-09-14'], ['14–28 Sep', '2026-09-14', '2026-09-29']];
const inP = (c, p) => c.week >= p[1] && c.week < p[2];
const goodOf = (cs) => cs.filter((c) => c.good).length;
const perGood = (cs, f) => { const g = goodOf(cs); return g ? r1(sum(cs.map(f)) / g) : null; };

// ---- September's steady-base split, with a configurable bucket order.
const sept = code.filter((c) => c.week >= '2026-08-31' && c.week < '2026-09-29'); const septGood = goodOf(sept);
const TESTCI = /\bCI\b|test|suite|green|red\b|flak|push|PR\b/i;
const TESTCI_STRICT = /\bCI\b|\btests?\b|\btest (suite|run|surface)|\bsuite\b|\bgreen\b|\bred\b|\bflak|\bpush\b|\bPR\b/i;
const septDs = sept.flatMap((c) => c.ds.map((d) => ({ d, c })));
const firstReviewAt = new Map(sept.map((c) => [c.id, c.ds.find((d) => d.component === 'review')?.at]));
const exactBeats = septDs.map((x) => x.d).filter((d) => d.component === 'beat into a worker' && d.promptName);
const exactWakes = septDs.map((x) => x.d).filter((d) => d.component === 'wake' && d.quiet != null && !d.passage);
const quietShare = exactWakes.filter((d) => d.quiet).length / exactWakes.length;
function isRow8(d, c) { const first = firstReviewAt.get(c.id); if (!first) return false; if ((d.component === 'review' || d.component === 'implementation') && d.at > first) return true; return d.shape !== 'fresh' && ['review', 'implementation'].includes(d.rootKind) && d.at > first; }
// Each test returns a bucket name or null; a dispatch goes to the first that matches.
const TESTS = {
  passage: (d) => (d.passage ? '2 passage layer' : null),
  wake: (d) => (d.component === 'wake' ? (d.quiet === true ? '1 quiet wakes' : d.quiet === false ? '3 supervision that acted' : 'wake unread') : null),
  quietAny: (d) => (d.component === 'wake' && d.quiet === true ? '1 quiet wakes' : null),
  autopilot: (d) => (d.component === 'autopilot session' ? '3 supervision that acted' : null),
  row8: (d, c) => (isRow8(d, c) ? '8 review rounds after the first' : null),
  beat: (d, c, re) => (d.component === 'beat into a worker' ? (d.promptName ? (re.test(d.promptName) ? 'test or CI beats' : 'unexplained: other stepper beats') : 'beat unread') : null),
  rest: (d) => (PHASES.includes(d.component) ? 'unexplained: first-round legs' : 'unexplained: kind unread and other'),
};
function split(order, re = TESTCI) {
  const b = {}; const add = (k, v = 1) => (b[k] = (b[k] || 0) + v);
  const testShare = exactBeats.filter((d) => re.test(d.promptName)).length / exactBeats.length;
  for (const { d, c } of septDs) { for (const t of order) { const k = TESTS[t](d, c, re); if (k) { add(k); break; } } }
  if (b['wake unread']) { add('1 quiet wakes', b['wake unread'] * quietShare); add('3 supervision that acted', b['wake unread'] * (1 - quietShare)); delete b['wake unread']; }
  if (b['beat unread']) { add('test or CI beats', b['beat unread'] * testShare); add('unexplained: other stepper beats', b['beat unread'] * (1 - testShare)); delete b['beat unread']; }
  const tot = sum(Object.values(b));
  return Object.fromEntries(Object.entries(b).sort().map(([k, v]) => [k, { perGood: r1(v / septGood), share: r3(v / tot) }]));
}
const PAPER_ORDER = ['passage', 'wake', 'autopilot', 'row8', 'beat', 'rest'];

function verify() {
  console.log('items', items.length, 'code changes', code.length, 'scored', scored.length);
  for (const p of PERIODS) { const cs = code.filter((c) => inP(c, p)); show(p[0], { changes: cs.length, good: goodOf(cs), issueLineOnly: perGood(cs, (c) => c.issueLineOnly), total: perGood(cs, (c) => c.n), fresh: perGood(cs, (c) => c.fresh), followUps: perGood(cs, (c) => c.warm + c.cold), wakes: perGood(cs, (c) => c.comp.wake) }); }
  console.log('September', sept.length, 'changes', septGood, 'good', sum(sept.map((c) => c.n)), 'dispatches; quiet share of non-passage wakes read', r3(quietShare), exactWakes.length);
  for (const [k, v] of Object.entries(split(PAPER_ORDER))) show(' ', { bucket: k, ...v });
}

function missed() {
  console.log('Share of each period\'s dispatches (code changes) whose own log block does not name the ticket:');
  for (const p of PERIODS) { const cs = code.filter((c) => inP(c, p)); const n = sum(cs.map((c) => c.n)); const il = sum(cs.map((c) => c.issueLineOnly)); show(' ', { period: p[0], dispatches: n, namedInOwnBlock: il, missed: pct(n - il, n) }); }
  console.log('Same, by day the dispatch ran (every item, not only code changes):');
  const W = [['1–11 Jul', '2026-07-01', '2026-07-12'], ['12–15 Jul', '2026-07-12', '2026-07-16'], ['16–31 Jul', '2026-07-16', '2026-08-01'], ['Aug', '2026-08-01', '2026-09-01'], ['1–12 Sep', '2026-09-01', '2026-09-13'], ['13–30 Sep', '2026-09-13', '2026-10-01']];
  for (const [l, a, z] of W) { const xs = items.filter((r) => r.at >= a && r.at < z && r.issue); show(' ', { window: l, withTicket: xs.length, ownIssueLine: pct(xs.filter((r) => r.issueLine).length, xs.length) }); }
  const mcPath = 'data/survey-model/analysis.json';
  if (!existsSync(mcPath)) { console.log(' (no data/survey-model/analysis.json: model-choice\'s own per-change counts not compared)'); return; }
  const mc = new Map(read(mcPath).changes.map((c) => [c.id, c]));
  console.log('model-choice\'s own per-change dispatch counts against this paper\'s full count, same changes (code, scored, in both):');
  for (const p of PERIODS) { const cs = code.filter((c) => inP(c, p) && mc.has(c.id)); const a = sum(cs.map((c) => mc.get(c.id).dispatches || 0)); const n = sum(cs.map((c) => c.n)); show(' ', { period: p[0], changes: cs.length, good: goodOf(cs), modelChoicePerGood: perGood(cs, (c) => mc.get(c.id).dispatches || 0), fullPerGood: perGood(cs, (c) => c.n), missed: pct(n - a, n) }); }
}

// ---- Run-log routes: how each follow-up was routed, with the target session's phase.
function routes() {
  const route = new Map();
  for (const f of readdirSync(stateDir).filter((x) => /^dispatcher(\.run-.*)?\.log$/.test(x))) for (const l of readFileSync(join(stateDir, f), 'utf8').split('\n')) {
    const m = l.match(/^\[follow-up\] item ([0-9a-f]{8}) \(followUpTo [^)]+\) → ([A-Z_-]+)(?: \(target [0-9a-f]{8}(?: —| phase=([A-Z_]+)))?/); if (!m || m[2] === 'QUEUED-BUSY') continue;
    if (!route.has(m[1])) route.set(m[1], m[2] + (m[3] ? ` ${m[3]}` : ''));
  }
  const rows = allRows.filter((r) => r.item && route.has(r.item.slice(0, 8)));
  const W = [['1–5 Jul', '2026-07-01', '2026-07-06'], ['10 Jul–11 Jul 21:18 (after LIN-1219, before LIN-1260)', '2026-07-10T14:44', '2026-07-11T20:18'], ['12–15 Jul', '2026-07-12', '2026-07-16'], ['16–26 Jul', '2026-07-16', '2026-07-27'], ['27 Jul–31 Aug', '2026-07-27', '2026-09-01'], ['Sep', '2026-09-01', '2026-10-01']];
  for (const [l, a, z] of W) { const xs = rows.filter((r) => r.at >= a && r.at < z); show(l, { followUps: xs.length, ...tally(xs, (r) => route.get(r.item.slice(0, 8))) }); }
  // What the cold resumes of finished sessions were, once kinds can be read (16 July on): wakes into a finished autopilot, or beats.
  for (const [l, a, z] of W.slice(3)) { const xs = items.filter((r) => r.at >= a && r.at < z && route.get(r.item.slice(0, 8)) === 'RESUME COMPLETED'); show(`  ${l} RESUME COMPLETED by component`, tally(xs, (r) => r.component)); }
  console.log('Log items per day, 25 Jun–17 Jul (all shapes; dated by oplog from 12 Jul, else by position in the log file):');
  show(' ', tally(allRows.filter((r) => r.at >= '2026-06-25' && r.at < '2026-07-18'), (r) => r.at.slice(5, 10)));
}

// ---- Cohorts: tickets whose every dispatch and last merge fall inside one window.
function cohorts() {
  const life = (c) => (Date.parse(c.lastMerge) - Date.parse(c.ds[0].at)) / 864e5;
  const cohort = (a, z) => code.filter((c) => c.ds[0].at >= a && c.ds.at(-1).at < z && new Date(c.lastMerge).toISOString() >= a && new Date(c.lastMerge).toISOString() < z);
  const rej = new Map(); for (const r of allRows) if (r.issue && (r.shape === 'rejected' || r.shape === 'abort')) { const o = rej.get(r.issue) || { rejected: 0, abort: 0 }; o[r.shape]++; rej.set(r.issue, o); }
  const describe = (cs) => ({ changes: cs.length, good: goodOf(cs), perGood: perGood(cs, (c) => c.n), fresh: perGood(cs, (c) => c.fresh), warm: perGood(cs, (c) => c.warm), cold: perGood(cs, (c) => c.cold), rejected: perGood(cs, (c) => rej.get(c.id)?.rejected || 0), aborted: perGood(cs, (c) => rej.get(c.id)?.abort || 0), medLifeDays: r1(median(cs.map(life))), medDispatches: median(cs.map((c) => c.n)) });
  const C = [['1–5 Jul', '2026-07-01', '2026-07-06'], ['12–15 Jul', '2026-07-12', '2026-07-16'], ['16–26 Jul', '2026-07-16', '2026-07-27']];
  for (const [l, a, z] of C) {
    const cs = cohort(a, z); show(l, describe(cs));
    show('   life-days', tally(cs, (c) => (life(c) < 1 ? '<1' : life(c) < 2 ? '1-2' : life(c) < 3 ? '2-3' : '3+')));
    for (const cap of [1, 2]) show(`   lived <${cap}d`, describe(cs.filter((c) => life(c) < cap)));
    show('   by size', Object.fromEntries(['1-49', '50-299', '300+'].map((s) => { const x = cs.filter((c) => c.size === s); return [s, `${perGood(x, (c) => c.n)} (${goodOf(x)})`]; })));
  }
  // What the full periods (not cohorts) show for the same shapes, for scale.
  for (const p of PERIODS.slice(0, 2)) { const cs = code.filter((c) => inP(c, p)); show(p[0], describe(cs)); }
}

// ---- Passage vs not, September.
function passage() {
  const wr = (cs) => { const ds = cs.flatMap((c) => c.ds); const worker = ds.filter((d) => PHASES.includes(d.component) || d.component === 'beat into a worker').length; const w = ds.filter((d) => d.component === 'wake'); return { changes: cs.length, good: goodOf(cs), perGood: perGood(cs, (c) => c.n), freshPerGood: perGood(cs, (c) => c.fresh), wakesPerGood: perGood(cs, (c) => c.comp.wake), workerEvents: worker, wakes: w.length, wakesPerWorkerEvent: r3(w.length / worker), intoPassage: w.filter((d) => d.passage).length, intoStepper: w.filter((d) => d.stepperSession && !d.passage).length, intoOther: w.filter((d) => !d.stepperSession && !d.passage).length, quietShareRead: r3(w.filter((d) => d.quiet).length / w.filter((d) => d.quiet != null).length), wakesExPassagePerWorkerEvent: r3(w.filter((d) => !d.passage).length / worker) }; };
  for (const p of PERIODS.slice(2)) {
    const cs = code.filter((c) => inP(c, p)); const withP = cs.filter((c) => c.ds.some((d) => d.passage)); const withoutP = cs.filter((c) => !c.ds.some((d) => d.passage));
    show(`${p[0]} all`, wr(cs)); show(`${p[0]} with a passage-lineage dispatch`, wr(withP)); show(`${p[0]} without`, wr(withoutP));
    const leg = withoutP.filter((c) => legIssues.has(c.id)); if (leg.length) show(`${p[0]} without, but a Runner dispatched the ticket`, wr(leg));
  }
  // Wakes by merge week inside September, both groups, and the worker-event mix.
  for (const w of ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']) { const cs = code.filter((c) => c.week === w); const nP = cs.filter((c) => !c.ds.some((d) => d.passage)); show(`week ${w}`, { all: wr(cs).wakesPerWorkerEvent, noPassage: wr(nP).wakesPerWorkerEvent, noPassageChanges: nP.length }); }
}

function order() {
  const orders = { paper: PAPER_ORDER, quietFirst: ['quietAny', 'passage', 'wake', 'autopilot', 'row8', 'beat', 'rest'], passageLast: ['wake', 'autopilot', 'row8', 'beat', 'passage', 'rest'], beatsBeforeRow8: ['passage', 'wake', 'autopilot', 'beat', 'row8', 'rest'], row8First: ['row8', 'passage', 'wake', 'autopilot', 'beat', 'rest'] };
  for (const [k, o] of Object.entries(orders)) { console.log(k, o.join(' > ')); for (const [b, v] of Object.entries(split(o))) console.log(`   ${b.padEnd(40)} ${String(v.perGood).padStart(5)} ${(100 * v.share).toFixed(1)}%`); }
  const pw = septDs.map((x) => x.d).filter((d) => d.passage && d.component === 'wake' && d.quiet != null);
  console.log('passage-layer wakes read', pw.length, 'quiet', pct(pw.filter((d) => d.quiet).length, pw.length), '; passage-layer dispatches by component', JSON.stringify(tally(septDs.map((x) => x.d).filter((d) => d.passage), (d) => d.component)));
  const allW = septDs.map((x) => x.d).filter((d) => d.component === 'wake' && d.quiet != null); console.log('all September wakes read', allW.length, 'quiet', pct(allW.filter((d) => d.quiet).length, allW.length));
}

function unexplained() {
  const U = []; for (const { d, c } of septDs) { let k; for (const t of PAPER_ORDER) { k = TESTS[t](d, c, TESTCI); if (k) break; } if (/^unexplained|beat unread/.test(k)) U.push({ d, c, k }); }
  const n = U.length; console.log('unexplained dispatches (before the unread-beat split)', n, 'of', septDs.length, pct(n, septDs.length), 'per good', r1(n / septGood));
  show('by bucket', tally(U, (x) => x.k));
  show('by shape', tally(U, (x) => x.d.shape));
  show('by component', tally(U, (x) => x.d.component));
  show('by exact kind (fresh: its kind; follow-up: the fetched item kind)', tally(U, (x) => (x.d.shape === 'fresh' ? x.d.kind : x.d.kind || `(unread; session ${x.d.rootKind})`)));
  show('fresh legs: first of its kind on the ticket vs a repeat', tally(U.filter((x) => PHASES.includes(x.d.component)), (x) => { const same = x.c.ds.filter((y) => y.component === x.d.component && y.shape === 'fresh'); return `${x.d.component} ${same[0] === x.d ? 'first' : 'repeat'}`; }));
  show('fresh legs by how the kind is known', tally(U.filter((x) => x.d.shape === 'fresh'), (x) => x.d.kindHow));
  const beats = U.filter((x) => x.d.component === 'beat into a worker');
  show('beats: root session kind', tally(beats, (x) => x.d.rootKind));
  show('beats: stepper-numbered ("beat N/M") vs other name vs unread', tally(beats, (x) => (!x.d.promptName ? 'unread' : /^beat \d+\/\d+/.test(x.d.promptName) ? 'beat N/M' : 'other name')));
  const named = beats.filter((x) => x.d.promptName);
  const THEME = [['ground / re-ground / branch', /\b(re-?ground|ground|branch|reconcile|inventory|read the history|confirm)/i], ['plan / strategy / decisions / write plan', /\b(plan|strategy|decision|framing|design|scope|sweep|enumerat)/i], ['implement / build / edit / wire', /\b(implement|build|wire|edit|add|write|move|retire|refactor|thread|port|fix)\b/i], ['verify / review / audit / measure', /\b(verif|review|audit|measure|witness|check|adversarial|validat|experiment|reproduce)/i], ['post / comment / description / handoff', /\b(post|comment|description|hand-?off|summary|ledger|tracker|file)\b/i]];
  show('named beats by first matching theme (keyword read of the beat title)', tally(named, (x) => (TESTCI.test(x.d.promptName) ? 'test/CI (would be row 8 or test/CI; should not be here)' : THEME.find(([, re]) => re.test(x.d.promptName))?.[0] || 'none of these')));
  show('named beats: position', tally(named, (x) => { const m = x.d.promptName.match(/^beat (\d+)\/(\d+)/); return !m ? 'unnumbered' : m[1] === '1' ? 'first beat' : m[1] === m[2] ? 'last beat' : 'middle beat'; }));
  console.log('sample of 25 named beat titles (every k-th, sorted by time):'); const step = Math.max(1, Math.floor(named.length / 25)); named.filter((_, i) => i % step === 0).slice(0, 25).forEach((x) => console.log('   ', x.c.id, x.d.rootKind, '|', x.d.promptName.slice(0, 100)));
  const other = U.filter((x) => x.k === 'unexplained: kind unread and other');
  show('"kind unread and other": component', tally(other, (x) => x.d.component));
  show('"kind unread and other": exact kind where read', tally(other, (x) => x.d.kind || '(none)'));
  show('"kind unread and other": fresh, why unread', tally(other.filter((x) => x.d.shape === 'fresh'), (x) => (x.d.kindHow === 'exact' ? `exact ${x.d.kind}` : x.d.promptLen == null ? 'no promptLen logged' : x.d.promptLen > 2000 ? 'long prompt (bootstrap-free or injected)' : `promptLen ${x.d.promptLen} undecoded`)));
  show('"kind unread and other": harness', tally(other, (x) => x.d.harness || '(none logged)'));
  show('"kind unread and other": follow-up root kind', tally(other.filter((x) => x.d.shape !== 'fresh'), (x) => x.d.rootKind));
  show('"kind unread and other": transcript exists for the item or its session', tally(other, (x) => (x.d.item in exact ? 'item fetched' : tx.sessions.some((s) => wsKey(s.ws) === x.d.session8) ? 'session transcript, item not fetched' : 'no transcript')));
  show('by merge half', tally(U, (x) => (x.c.week < '2026-09-14' ? '1–13 Sep' : '14–28 Sep')));
  show('by passage ticket', tally(U, (x) => (x.c.ds.some((d) => d.passage) ? 'passage ticket' : 'not')));
}

function testci() {
  const loose = exactBeats.filter((d) => TESTCI.test(d.promptName)); const strict = exactBeats.filter((d) => TESTCI_STRICT.test(d.promptName));
  console.log('September code-change beats with a read name', exactBeats.length, '; paper regex', loose.length, pct(loose.length, exactBeats.length), '; stricter word-bounded regex', strict.length, pct(strict.length, exactBeats.length));
  console.log('matched by the paper regex only:'); for (const d of loose.filter((d) => !strict.includes(d)).slice(0, 15)) console.log('   ', d.promptName.slice(0, 110));
  for (const [b, v] of Object.entries(split(PAPER_ORDER, TESTCI_STRICT))) console.log(`   strict: ${b.padEnd(40)} ${v.perGood} ${(100 * v.share).toFixed(1)}%`);
}

// ---- Whose ticket a follow-up counts for. Until 13 September a follow-up almost never had its own Issue line, so it counted for the
// ticket of the session it entered (its root). From 13 September (LIN-2121) a wake carries its own, which can name a different ticket:
// a wake into a supervisor above the ticket (an epic's autopilot, a Runner) then counts for the child change, not for the epic.
function lineage() {
  const rootTicket = (d) => { const root = byId.get(d.root); return root?.issueLine || null; };
  for (const p of PERIODS.slice(2)) {
    const cs = code.filter((c) => inP(c, p)); const ds = cs.flatMap((c) => c.ds.map((d) => ({ d, c })));
    const foreign = ds.filter(({ d, c }) => d.shape !== 'fresh' && d.issueLine === c.id && rootTicket(d) !== c.id);
    const fw = foreign.filter(({ d }) => d.component === 'wake');
    show(p[0], { dispatches: ds.length, good: goodOf(cs), followUpsCountedHereButEnteringAnotherTicketsSession: foreign.length, perGood: r1(foreign.length / goodOf(cs)), wakes: fw.length, wakesPerGood: r1(fw.length / goodOf(cs)), ofWhichPassage: fw.filter(({ d }) => d.passage).length, rootTickets: tally(foreign, ({ d }) => (rootTicket(d) ? (passageEpics.has(rootTicket(d)) ? 'passage epic' : gitById.has(rootTicket(d)) ? 'another merged ticket' : 'a ticket with no merge (epic or open)') : 'root has no Issue line')) });
  }
}

// The paper's series re-counted under one rule for every period: a follow-up counts for the ticket of the session it entered (its root's
// Issue line), which is what the paper's own rule amounted to before 13 September. Fresh sessions count for their own Issue line.
function rootrule() {
  const rootTicket = (d) => (d.shape === 'fresh' ? d.issueLine : byId.get(d.root)?.issueLine || null);
  const per = new Map(); for (const r of items) { const t = rootTicket(r); if (t) (per.get(t) || per.set(t, []).get(t)).push(r); }
  const cs2 = code.map((c) => { const ds = per.get(c.id) || []; const comp = {}; for (const k of COMPONENTS) comp[k] = 0; for (const d of ds) comp[d.component]++; return { ...c, ds, n: ds.length, comp, fresh: ds.filter((d) => d.shape === 'fresh').length }; });
  for (const p of PERIODS) {
    const cs = cs2.filter((c) => inP(c, p)); const ds = cs.flatMap((c) => c.ds); const worker = ds.filter((d) => PHASES.includes(d.component) || d.component === 'beat into a worker').length; const w = ds.filter((d) => d.component === 'wake');
    show(p[0], { good: goodOf(cs), total: perGood(cs, (c) => c.n), fresh: perGood(cs, (c) => c.fresh), followUps: perGood(cs, (c) => c.n - c.fresh), wakes: perGood(cs, (c) => c.comp.wake), wakesPerWorkerEvent: r3(w.length / worker), passageWakes: w.filter((d) => d.passage).length });
  }
  // Fleet view by the week the wake ran: whose session each wake entered. Wakes into sessions of tickets that are not code changes
  // (epics, open or docs tickets, passage epics) are the ones the paper's rule starts charging to child changes from 13 September.
  const codeIds = new Set(code.map((c) => c.id)); const docIds = new Set(scored.filter((c) => c.docsOnly).map((c) => c.id));
  const wk = {}; for (const r of items) if (r.component === 'wake' && r.at >= '2026-07-13') { const w = monday(r.at); const t = rootTicket(r); const k = !t ? 'root has no Issue line' : passageEpics.has(t) ? 'passage epic (Runner)' : codeIds.has(t) ? 'code change' : docIds.has(t) ? 'docs change' : 'other ticket (epic, open, unmerged)'; (wk[w] ||= {})[k] = (wk[w][k] || 0) + 1; }
  for (const [w, v] of Object.entries(wk).sort()) show(`wakes run in week ${w}`, v);
  const sp = cs2.filter((c) => c.week >= '2026-09-14' && c.week < '2026-09-29'); const withP = sp.filter((c) => c.ds.some((d) => d.passage)); const noP = sp.filter((c) => !c.ds.some((d) => d.passage));
  for (const [l, cs] of [['14–28 Sep, passage tickets', withP], ['14–28 Sep, no passage dispatch', noP]]) { const ds = cs.flatMap((c) => c.ds); const worker = ds.filter((d) => PHASES.includes(d.component) || d.component === 'beat into a worker').length; show(l, { changes: cs.length, good: goodOf(cs), total: perGood(cs, (c) => c.n), wakes: perGood(cs, (c) => c.comp.wake), wakesPerWorkerEvent: r3(ds.filter((d) => d.component === 'wake').length / worker) }); }
}

// Writes a copy of runner.json whose `issue` follows the constant rule (a follow-up charged to the session it entered), so the paper's own
// survey-doubling-analyse.mjs can be re-run on it unchanged: copy it over data/survey-doubling/runner.json in a scratch tree and run.
function rekey() {
  const out = arg('--out', 'data/survey-check-4/runner-rootrule.json');
  const all = new Map(runner.rows.map((r) => [r.item, r]));
  const rows = allRows.map((r) => ({ ...r, issue: r.shape === 'fresh' ? r.issue : all.get(r.root)?.issueLine || (all.get(r.root) === r ? r.issue : null) }));
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ ...runner, rows, rekeyed: 'follow-ups charged to the root session\'s ticket' }));
  console.log('wrote', out, rows.length, 'rows;', rows.filter((r, i) => r.issue !== allRows[i].issue).length, 'rows changed ticket');
}

const RUN = { verify, missed, cohorts, routes, passage, lineage, rootrule, order, unexplained, testci };
if (cmd === 'rekey') rekey();
for (const [k, f] of Object.entries(RUN)) if (cmd === 'all' || cmd === k) { console.log(`\n==== ${k}`); f(); }
