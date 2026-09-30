// LIN-3152: the throughput scorecard — correct, complete changes per ISO week, per fleet dispatch and per working hour, with cost per correct change, human attention, proportionality, process weight and the noise floor, for LinearViewer (Harbour) and simple-dispatcher.
// Usage: node scripts/survey-scorecard.mjs [--cut 2026-09-30] [--window 30] [--svg docs/papers/harbour/figures/measuring-throughput] [--out data/survey/scorecard.json] [--sd ../simple-dispatcher] [--state ~/development/simple-dispatcher/state]
// Reads the snapshots other survey scripts write, so run those first (all local except the two tracker/GitHub snapshots):
//   node scripts/survey-effort-git.mjs; node scripts/survey-effort-runner.mjs; node scripts/survey-growth-fleet.mjs --json > data/survey/scorecard-fleet.json
//   node scripts/survey-reliability-github.mjs; node scripts/survey-reliability-tracker.mjs   (proxy, ≈4.5 s a call; reuse a same-day copy if one exists)
//   node scripts/survey-effort-fleet.mjs   (local transcripts; weekly tokens, 30-day retention)
// A *change* is a ticket whose LIN-id names a first-parent merge on origin/main since June (survey-effort-git.mjs's rule), dated
// by its last merge. It is *correct* if it reached Done, no escaped Bug names it as the introducer within --window days of that
// merge (reliability-baseline-defects.json), and no later fix commit names it within the window (survey-reliability-git.mjs's
// named fix-follow-up). It is *complete* unless a kind:follow-up ticket, or a routed Bug, names it as origin. Weeks younger than
// the window are provisional. Snapshots go to the git-ignored data/survey/.
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { load as loadReliability, measure as measureReliability } from './survey-reliability-git.mjs';
import { GROUPS } from './steady-base-growth.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const CUT = new Date(arg('--cut', '2026-09-30') + 'T00:00:00Z');
const WINDOW = +arg('--window', 30);
const DAY = 86400000;
const svgDir = arg('--svg', null);
const out = arg('--out', 'data/survey/scorecard.json');
const sdDir = resolve(arg('--sd', '../simple-dispatcher'));
const stateDir = arg('--state', join(homedir(), 'development', 'simple-dispatcher', 'state'));

const monday = (iso) => { const d = new Date(iso); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10); };
const median = (xs) => { const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
const rank = (xs) => { const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = Array(xs.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const spearman = (a, b) => { if (a.length < 5) return null; const ra = rank(a), rb = rank(b); const ma = mean(ra), mb = mean(rb); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; } return n / Math.sqrt(da * db); };

// ---- Inputs ------------------------------------------------------------------------------------------------------------
const git = read(arg('--git', 'data/survey-effort/git.json'));
const runner = read(arg('--runner', 'data/survey-effort/runner.json'));
const tracker = read(arg('--tracker', 'data/survey/reliability-tracker.json'));
const verdicts = read(arg('--verdicts', 'docs/papers/harbour/reliability-baseline-defects.json')).verdicts;
const fleet = read(arg('--fleet', 'data/survey/scorecard-fleet.json'));
const tokensPath = arg('--tokens', 'data/survey-effort/fleet.json');
const tokens = existsSync(tokensPath) ? read(tokensPath) : null;

const listById = new Map(tracker.list.map((t) => [t.identifier, t]));
const runnerById = new Map(runner.rows.map((r) => [r.id, r]));

// Escaped and routed Bugs that name the ticket that shipped the fault.
const escapesOf = new Map(); const routedOf = new Map();
for (const v of verdicts) {
  if (!v.introducedBy) continue;
  const at = tracker.details[v.identifier]?.createdAt;
  const m = v.verdict === 'escaped' ? escapesOf : v.verdict === 'routed' ? routedOf : null;
  if (!m || !at) continue;
  (m.get(v.introducedBy) || m.set(v.introducedBy, []).get(v.introducedBy)).push({ bug: v.identifier, at, residue: v.residueLabel });
}

// Follow-up filings: a kind:follow-up ticket's origin is its parent, else the first other LIN-id in its opening 600 characters.
const followUpsOf = new Map();
for (const t of tracker.list) {
  if (!(t.labels || []).includes('kind:follow-up')) continue;
  const own = t.identifier;
  const named = ((t.description || '').slice(0, 600).match(/\bLIN-\d+\b/g) || []).filter((x) => x !== own);
  const origin = t.parent || named[0];
  if (origin) (followUpsOf.get(origin) || followUpsOf.set(origin, []).get(origin)).push({ id: own, worked: !['backlog', 'unstarted'].includes(t.state.type) });
}

// Named fix-follow-ups per ticket, from the reliability script (GitHub PR snapshot + both clones' first-parent history).
const namedFix = new Set();
const rel = measureReliability(loadReliability());
for (const repo of Object.keys(rel)) for (const p of rel[repo].prRows) if (p.named && p.ticket) namedFix.add(p.ticket);
const mergedPRs = {}; // naive count: merged PRs per week per repo
const gh = loadReliability().github;
for (const [repo, { prs }] of Object.entries(gh.repos)) for (const p of prs) { const w = monday(p.mergedAt); (mergedPRs[w] ||= { LinearViewer: 0, 'simple-dispatcher': 0 })[repo]++; }

// Process weight: net lines of the text agents are told to read, per ticket, from first-parent diffs (growth-atlas's
// reading-load paths: steady-base's GROUPS plus lib/prompts/ and docs/architecture/ in Harbour; CLAUDE.md, README.md, docs/ in simple-dispatcher).
const PROCESS = {
  LinearViewer: [...Object.values(GROUPS).flat(), 'lib/prompts/', 'docs/architecture/', 'lib/proxy-preamble.js'],
  'simple-dispatcher': ['CLAUDE.md', 'README.md', 'docs/'],
};
const isProcess = (repo, p) => PROCESS[repo].some((q) => (q.endsWith('/') ? p.startsWith(q) : p === q));
const processOf = new Map(); const processWeek = {};
for (const [repo, dir] of [['LinearViewer', resolve('.')], ['simple-dispatcher', sdDir]]) {
  const raw = execFileSync('git', ['-C', dir, 'log', 'origin/main', '--first-parent', '-m', '--since=2026-06-01', '--numstat', '--format=%x00%H%x09%cI%x09%s'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const seen = new Set();
  for (const chunk of raw.split('\x00').filter(Boolean)) {
    const [head, ...lines] = chunk.split('\n').filter(Boolean);
    const [sha, at, subject] = head.split('\t');
    if (seen.has(sha)) continue; seen.add(sha);
    const id = (subject.match(/\blin-\d+\b/i) || [])[0]?.toUpperCase();
    let add = 0, del = 0;
    for (const l of lines) { const [a, d, p] = l.split('\t'); if (a === '-' || !isProcess(repo, p)) continue; add += +a; del += +d; }
    if (!add && !del) continue;
    const w = monday(at); const pw = (processWeek[w] ||= { add: 0, del: 0 }); pw.add += add; pw.del += del;
    if (id) { const r = processOf.get(id) || { add: 0, del: 0 }; r.add += add; r.del += del; processOf.set(id, r); }
  }
}

// Fleet session time per calendar week from the oplog, split by phase class (runner.json has it per ticket; this is all sessions).
const WORK = new Set(['SUMMARIZING', 'RESUMING', 'EXECUTING']); const HUMAN = new Set(['BLOCKED']);
// One phase interval is capped at CAP_H: a session whose record went stale (no removal after a runner restart) would otherwise
// book days of "working" time. The share of time the cap removes is printed.
const CAP_H = +arg('--cap-hours', 2); const capped = { rawH: 0, keptH: 0 };
const fleetTime = {}; const blockedEntries = {};
if (existsSync(join(stateDir, 'oplog.jsonl'))) {
  const sess = new Map();
  for (const line of readFileSync(join(stateDir, 'oplog.jsonl'), 'utf8').split('\n')) {
    if (!line.includes('"phase"') && !line.includes('session_removed')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    let phase = null;
    if (o.event === 'state.session_added') phase = o.fields?.phase;
    else if (o.event === 'state.change' && o.changed?.phase) phase = o.changed.phase[1];
    else if (o.event === 'state.session_removed') phase = 'REMOVED';
    if (!phase || !o.session) continue;
    const t = Date.parse(o.ts); const s = sess.get(o.session);
    if (s?.phase) {
      const w = monday(new Date(s.last).toISOString()); const f = (fleetTime[w] ||= { workH: 0, humanH: 0 });
      const h = (t - s.last) / 36e5; const k = Math.min(h, CAP_H);
      if (WORK.has(s.phase)) { f.workH += k; capped.rawH += h; capped.keptH += k; } else if (HUMAN.has(s.phase)) f.humanH += h;
    }
    if (phase === 'BLOCKED' && s?.phase !== 'BLOCKED') { const w = monday(o.ts); blockedEntries[w] = (blockedEntries[w] || 0) + 1; }
    sess.set(o.session, { phase, last: t });
  }
}

// ---- Per change ----------------------------------------------------------------------------------------------------------
const sizeBin = (p) => (p === 0 ? '0' : p < 50 ? '1-49' : p < 300 ? '50-299' : '300+');
const changes = git.rows.map((r) => {
  const merged = Date.parse(r.lastMerge);
  const within = (xs) => (xs || []).filter((x) => Date.parse(x.at) - merged <= WINDOW * DAY && Date.parse(x.at) - merged >= -2 * DAY);
  const state = listById.get(r.id)?.state?.name || 'unknown';
  const escapes = within(escapesOf.get(r.id));
  const fix = namedFix.has(r.id);
  const followUps = followUpsOf.get(r.id) || [];
  const routed = routedOf.get(r.id) || [];
  const run = runnerById.get(r.id);
  const proc = processOf.get(r.id) || { add: 0, del: 0 };
  const done = state === 'Done';
  const correct = done && !escapes.length && !fix;
  const complete = !followUps.length && !routed.length;
  return {
    id: r.id, repos: r.repos, week: monday(r.lastMerge), lastMerge: r.lastMerge,
    mature: merged <= CUT.getTime() - WINDOW * DAY, state, done,
    prodLines: r.prodLines, testLines: r.testLines, docLines: r.docLines, size: sizeBin(r.prodLines), risk: r.risk,
    escapes: escapes.length, namedFix: fix, followUps: followUps.length, followUpsWorked: followUps.filter((f) => f.worked).length, routed: routed.length,
    correct, complete, good: correct && complete,
    dispatches: run?.dispatches ?? null, workH: run && run.timedSessions ? run.workH : null, humanWaitH: run && run.timedSessions ? run.humanWaitH : null,
    spanH: run?.spanH ?? null, processAdd: proc.add, processDel: proc.del,
  };
});

// Proportionality: a change's dispatches against the median of its size × risk cell over the whole population.
const cell = (c) => `${c.size}|${c.risk}`;
const cellMed = new Map();
for (const k of new Set(changes.map(cell))) cellMed.set(k, median(changes.filter((c) => cell(c) === k && c.dispatches).map((c) => c.dispatches)));
for (const c of changes) c.proportion = c.dispatches && cellMed.get(cell(c)) ? c.dispatches / cellMed.get(cell(c)) : null;

// ---- Weekly table --------------------------------------------------------------------------------------------------------
const weeks = [...new Set(changes.map((c) => c.week))].sort().filter((w) => w >= '2026-06-01');
const lastFull = monday(new Date(CUT.getTime() - 7 * DAY).toISOString());
// survey-effort-fleet.mjs buckets tokens into four weeks from 31 August; its last bucket runs to that script's --until
// (30 Sep 06:50Z, 9.28 days), so it is scaled to seven days.
const lastBucketDays = +arg('--last-bucket-days', 9.28);
const tokenWeek = tokens?.weekly ? Object.fromEntries(Object.entries(tokens.weekly).map(([k, v]) => [monday(new Date(Date.parse(tokens.since) + (+k.slice(1) - 1) * 7 * DAY).toISOString()), Object.values(v).reduce((a, b) => a + b, 0) * (k === 'w4' ? 7 / lastBucketDays : 1)])) : {};
// The runner's census is continuous from the first full week of its oplog (12 July); budget series start there.
const BUDGET_FROM = arg('--budget-from', '2026-07-13');
const fleetWeek = Object.fromEntries(fleet.rows.filter((r) => r.week >= BUDGET_FROM).map((r) => [r.week, r]));
for (const w of Object.keys(fleetTime)) if (w < BUDGET_FROM) delete fleetTime[w];
const rows = weeks.map((w) => {
  const cs = changes.filter((c) => c.week === w);
  const by = (repo) => cs.filter((c) => c.repos.includes(repo));
  const good = cs.filter((c) => c.good); const correct = cs.filter((c) => c.correct);
  const dispatched = cs.filter((c) => c.dispatches != null); const timed = cs.filter((c) => c.workH != null);
  const f = fleetWeek[w]; const ft = fleetTime[w];
  const r = {
    week: w, full: w <= lastFull, mature: cs.every((c) => c.mature),
    merged: cs.length, done: cs.filter((c) => c.done).length, correct: correct.length, good: good.length,
    goodLV: by('LinearViewer').filter((c) => c.good).length, goodSD: by('simple-dispatcher').filter((c) => c.good).length,
    mergedLV: by('LinearViewer').length, mergedSD: by('simple-dispatcher').length,
    escaped: cs.filter((c) => c.escapes).length, namedFix: cs.filter((c) => c.namedFix).length, notDone: cs.filter((c) => !c.done).length,
    followedUp: cs.filter((c) => c.followUps || c.routed).length,
    goodNonDoc: good.filter((c) => c.prodLines + c.testLines > 0).length,
    goodProdLines: good.reduce((a, c) => a + c.prodLines, 0),
    mergedPRs: (mergedPRs[w]?.LinearViewer || 0) + (mergedPRs[w]?.['simple-dispatcher'] || 0),
    fleetDispatches: f ? f.harbour : null,
    fleetWorkH: ft ? +ft.workH.toFixed(1) : null, fleetHumanH: ft ? +ft.humanH.toFixed(1) : null, blockedEntries: blockedEntries[w] || 0,
    ticketDispatches: dispatched.reduce((a, c) => a + c.dispatches, 0), ticketsDispatched: dispatched.length,
    ticketWorkH: +timed.reduce((a, c) => a + c.workH, 0).toFixed(1), ticketsTimed: timed.length,
    medDispatches: median(dispatched.map((c) => c.dispatches)), medWorkH: median(timed.map((c) => c.workH)),
    medSpanH: median(cs.map((c) => c.spanH)),
    parkedShare: timed.length ? timed.filter((c) => c.humanWaitH > 0).length / timed.length : null,
    medProportion: median(cs.map((c) => c.proportion)),
    processNet: (processWeek[w]?.add || 0) - (processWeek[w]?.del || 0), processAdd: processWeek[w]?.add || 0, processDel: processWeek[w]?.del || 0,
    processTicketsUp: cs.filter((c) => c.processAdd > c.processDel).length, processTicketsDown: cs.filter((c) => c.processDel > c.processAdd).length,
    weightedTokensM: tokenWeek[w] ? +(tokenWeek[w] / 1e6).toFixed(0) : null,
  };
  r.dispatchesPerGood = r.fleetDispatches && r.good ? +(r.fleetDispatches / r.good).toFixed(1) : null;
  r.workHPerGood = r.fleetWorkH && r.good ? +(r.fleetWorkH / r.good).toFixed(2) : null;
  r.goodPerDay = +(r.good / 7).toFixed(1);
  r.tokensMPerGood = r.weightedTokensM && r.good ? +(r.weightedTokensM / r.good).toFixed(1) : null;
  return r;
});

// ---- Sensitivity ---------------------------------------------------------------------------------------------------------
// Noise is the spread of log weekly values over the full weeks since the runner census became continuous (from July),
// and the minimum detectable change compares the mean of k weeks after with k weeks before: ratio exp(2.8 · s · √(2/k)),
// i.e. 80% power at a two-sided 5% level, treating weeks as independent (lag-1 autocorrelation is printed so a reader can judge).
function noise(series) {
  const xs = series.filter((x) => x > 0).map(Math.log);
  const s = sd(xs); const dif = xs.slice(1).map((x, i) => x - xs[i]);
  const m = mean(xs); let num = 0, den = 0; for (let i = 0; i < xs.length; i++) { den += (xs[i] - m) ** 2; if (i) num += (xs[i] - m) * (xs[i - 1] - m); }
  const raw = series.filter((x) => x != null);
  return {
    n: xs.length, mean: +mean(raw).toFixed(1), sd: +sd(raw).toFixed(1), cv: +(sd(raw) / mean(raw)).toFixed(2), sdLog: +s.toFixed(3),
    weekToWeekSdLog: +sd(dif).toFixed(3), lag1: +(num / den).toFixed(2),
    mdc: Object.fromEntries([1, 2, 4, 8].map((k) => [k, +Math.exp(2.8 * s * Math.sqrt(2 / k)).toFixed(2)])),
  };
}
const steady = rows.filter((r) => r.full && r.week >= BUDGET_FROM);
// Per-change cost is measured on each change, so its noise is the spread of log cost across changes, and the detectable
// change over k weeks uses the changes those weeks actually hold (the mean of good changes a week in the steady window).
function perChange(key) {
  const xs = changes.filter((c) => c.good && c.week >= BUDGET_FROM && c.week <= steady.at(-1).week && c[key] > 0).map((c) => Math.log(c[key]));
  const s = sd(xs); const perWeek = mean(steady.map((r) => r.good));
  return { n: xs.length, sdLog: +s.toFixed(3), perWeek: +perWeek.toFixed(1), mdc: Object.fromEntries([1, 2, 4, 8].map((k) => [k, +Math.exp(2.8 * s * Math.sqrt(2 / (k * perWeek))).toFixed(2)])) };
}
const sens = {
  weeks: `${steady[0].week}..${steady.at(-1).week}`,
  perChangeDispatches: perChange('dispatches'), perChangeWorkH: perChange('workH'),
  good: noise(steady.map((r) => r.good)),
  merged: noise(steady.map((r) => r.merged)),
  mergedPRs: noise(steady.map((r) => r.mergedPRs)),
  dispatchesPerGood: noise(steady.map((r) => r.dispatchesPerGood)),
  workHPerGood: noise(steady.filter((r) => r.workHPerGood).map((r) => r.workHPerGood)),
};

// ---- Whole-period summaries ------------------------------------------------------------------------------------------------
const pct = (a, b) => (b ? +((100 * a) / b).toFixed(1) : null);
const mature = changes.filter((c) => c.mature);
const summary = {
  changes: changes.length, mature: mature.length,
  byState: changes.reduce((m, c) => ((m[c.state] = (m[c.state] || 0) + 1), m), {}),
  done: pct(changes.filter((c) => c.done).length, changes.length),
  escapedOfMature: pct(mature.filter((c) => c.escapes).length, mature.length),
  namedFixOfMature: pct(mature.filter((c) => c.namedFix).length, mature.length),
  correctOfMature: pct(mature.filter((c) => c.correct).length, mature.length),
  completeOfMature: pct(mature.filter((c) => c.complete).length, mature.length),
  goodOfMature: pct(mature.filter((c) => c.good).length, mature.length),
  followUpWorkedShare: pct(changes.reduce((a, c) => a + c.followUpsWorked, 0), changes.reduce((a, c) => a + c.followUps, 0)),
  docsOnlyOfGood: pct(changes.filter((c) => c.good && c.prodLines + c.testLines === 0).length, changes.filter((c) => c.good).length),
  processUpTickets: changes.filter((c) => c.processAdd > c.processDel).length, processDownTickets: changes.filter((c) => c.processDel > c.processAdd).length,
  processNetSinceJune: Object.values(processWeek).reduce((a, p) => a + p.add - p.del, 0),
  escapeLatencyDays: (() => { const d = []; for (const c of changes) for (const e of escapesOf.get(c.id) || []) d.push((Date.parse(e.at) - Date.parse(c.lastMerge)) / DAY); return { n: d.length, median: +median(d).toFixed(1), within7: pct(d.filter((x) => x <= 7).length, d.length), within30: pct(d.filter((x) => x <= 30).length, d.length) }; })(),
  byRepo: Object.fromEntries(['LinearViewer', 'simple-dispatcher'].map((repo) => { const cs = mature.filter((c) => c.repos.includes(repo)); return [repo, { mature: cs.length, correct: pct(cs.filter((c) => c.correct).length, cs.length), complete: pct(cs.filter((c) => c.complete).length, cs.length), good: pct(cs.filter((c) => c.good).length, cs.length), medDispatches: median(cs.map((c) => c.dispatches)), medWorkH: median(cs.map((c) => c.workH)) }]; })),
  proportionality: Object.fromEntries(['2026-07', '2026-08', '2026-09'].map((m) => { const cs = changes.filter((c) => c.lastMerge.slice(0, 7) === m && c.dispatches); return [m, { n: cs.length, rhoProd: +spearman(cs.map((c) => c.dispatches), cs.map((c) => c.prodLines)).toFixed(2), rhoProdTest: +spearman(cs.map((c) => c.dispatches), cs.map((c) => c.prodLines + c.testLines)).toFixed(2) }]; })),
  highRiskVsRest: (() => { const cs = changes.filter((c) => c.proportion != null && c.lastMerge >= '2026-07'); const f = (r) => median(cs.filter((c) => (r ? c.risk === 'high' : c.risk !== 'high')).map((c) => c.dispatches)); return { high: f(true), rest: f(false) }; })(),
  // Monthly totals, for the "why a count misleads" comparison.
  monthly: Object.fromEntries(['2026-06', '2026-07', '2026-08', '2026-09'].map((m) => { const ws = rows.filter((r) => r.week.slice(0, 7) === m); const s = (k) => ws.reduce((a, r) => a + (r[k] || 0), 0); return [m, { mergedPRs: s('mergedPRs'), merged: s('merged'), good: s('good'), goodNonDoc: s('goodNonDoc'), fleetDispatches: s('fleetDispatches'), fleetWorkH: +s('fleetWorkH').toFixed(0) }]; })),
};

// Four-week blocks over the budget era, for per-budget throughput (the last block is three full weeks).
summary.blocks = [['2026-07-13', '2026-08-03'], ['2026-08-10', '2026-08-31'], ['2026-09-07', '2026-09-21']].map(([a, b]) => {
  const ws = rows.filter((r) => r.week >= a && r.week <= b); const s = (k) => ws.reduce((x, r) => x + (r[k] || 0), 0);
  const good = s('good'), disp = s('fleetDispatches'), h = s('fleetWorkH');
  return { from: a, to: b, weeks: ws.length, mergedPRs: s('mergedPRs'), merged: s('merged'), good, goodPerDay: +(good / (7 * ws.length)).toFixed(1), fleetDispatches: disp, fleetWorkH: +h.toFixed(0),
    goodPer100Dispatches: +((100 * good) / disp).toFixed(2), goodPer10WorkH: +((10 * good) / h).toFixed(2), dispatchesPerGood: +(disp / good).toFixed(1), workHPerGood: +(h / good).toFixed(2),
    medDispatches: median(changes.filter((c) => c.week >= a && c.week <= b).map((c) => c.dispatches)), parked: +(100 * mean(ws.map((r) => r.parkedShare))).toFixed(0), blockedEntries: s('blockedEntries'),
    processAdd: s('processAdd'), processDel: s('processDel') };
});
// Weekly means for June's four full weeks and for the budget era, and the mature population's decomposition.
const wmean = (ws, k) => +(ws.reduce((a, r) => a + (r[k] || 0), 0) / ws.length).toFixed(1);
const june = rows.filter((r) => r.week >= '2026-06-08' && r.week <= '2026-06-29');
summary.weeklyMeans = Object.fromEntries([['june', june], ['sinceBudget', steady]].map(([k, ws]) => [k, { weeks: ws.length, good: wmean(ws, 'good'), merged: wmean(ws, 'merged'), mergedPRs: wmean(ws, 'mergedPRs'), goodLV: wmean(ws, 'goodLV'), goodSD: wmean(ws, 'goodSD'), fleetDispatches: wmean(ws, 'fleetDispatches') }]));
const cnt = (f) => mature.filter(f).length;
summary.matureCounts = { mature: mature.length, notDone: cnt((c) => !c.done), escaped: cnt((c) => c.escapes), namedFix: cnt((c) => c.namedFix), followedUp: cnt((c) => c.followUps), routed: cnt((c) => c.routed), notCorrect: cnt((c) => !c.correct), notComplete: cnt((c) => !c.complete), good: cnt((c) => c.good), goodDocsOnly: cnt((c) => c.good && c.prodLines + c.testLines === 0) };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ cut: CUT.toISOString().slice(0, 10), window: WINDOW, heads: git.heads, summary, sens, rows, changes }, null, 1));

// ---- Print ----------------------------------------------------------------------------------------------------------------
const col = (v, n = 6) => ' ' + String(v ?? '–').padStart(n - 1);
console.log(`cut ${CUT.toISOString().slice(0, 10)}, window ${WINDOW} d, heads ${JSON.stringify(git.heads)}; ${changes.length} changes (${mature.length} mature)`);
console.log('week        full mat | PRs merged done correct good  LV  SD nonDoc | fleetDisp workH disp/good workH/good tokM/good | medDisp medWorkH parked prop | proc+ proc- blocked');
for (const r of rows) console.log(`${r.week} ${r.full ? ' y ' : ' n '} ${r.mature ? ' y ' : ' n '} |${col(r.mergedPRs, 4)}${col(r.merged, 7)}${col(r.done, 5)}${col(r.correct, 8)}${col(r.good, 5)}${col(r.goodLV, 4)}${col(r.goodSD, 4)}${col(r.goodNonDoc, 7)} |${col(r.fleetDispatches, 10)}${col(r.fleetWorkH, 6)}${col(r.dispatchesPerGood, 10)}${col(r.workHPerGood, 11)}${col(r.tokensMPerGood, 9)} |${col(r.medDispatches, 8)}${col(r.medWorkH?.toFixed(2), 9)}${col(r.parkedShare == null ? null : (100 * r.parkedShare).toFixed(0) + '%', 7)}${col(r.medProportion?.toFixed(2), 5)} |${col(r.processAdd, 6)}${col(r.processDel, 6)}${col(r.blockedEntries, 8)}`);
console.log(`\noplog work intervals capped at ${CAP_H} h: kept ${capped.keptH.toFixed(0)} of ${capped.rawH.toFixed(0)} raw hours`);
console.log('\nsummary', JSON.stringify(summary, null, 1));
console.log('\nsensitivity', JSON.stringify(sens, null, 1));

// ---- Figures (hand-written SVG, no dependencies) -------------------------------------------------------------------------------
if (svgDir) {
  mkdirSync(svgDir, { recursive: true });
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', good: '#2563eb', merged: '#bfdbfe', pr: '#9ca3af', disp: '#b45309', hours: '#047857', prov: '#f3f4f6' };
  const shown = rows.filter((r) => r.full);
  const W = 760, L = 58, R = 20, pw = W - L - R, bw = pw / shown.length;
  const x = (i) => L + i * bw;
  const panel = (y0, h, max, ticks, title, body, unit = '') => {
    let s = `<text x="${L}" y="${y0 - 8}" font-size="13" font-weight="600" fill="${C.ink}">${esc(title)}</text>`;
    shown.forEach((r, i) => { if (!r.mature) s += `<rect x="${x(i)}" y="${y0}" width="${bw}" height="${h}" fill="${C.prov}"/>`; });
    for (const t of ticks) { const yy = y0 + h - (t / max) * h; s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${C.grid}"/><text x="${L - 6}" y="${yy + 4}" font-size="11" text-anchor="end" fill="${C.muted}">${t}${unit}</text>`; }
    return s + body((v) => y0 + h - (Math.min(v, max) / max) * h);
  };
  const line = (vals, y, color, dash = '') => { const pts = vals.map((v, i) => (v == null ? null : `${x(i) + bw / 2},${y(v)}`)); let d = '', pen = false; for (const p of pts) { if (!p) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${p} `; pen = true; } return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>` + pts.filter(Boolean).map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="2.5" fill="${color}"/>`).join(''); };
  const xLabels = (y) => shown.map((r, i) => (i % 2 === 0 ? `<text x="${x(i) + bw / 2}" y="${y}" font-size="10" text-anchor="middle" fill="${C.muted}">${r.week.slice(5)}</text>` : '')).join('');
  const maxA = Math.ceil(Math.max(...shown.map((r) => Math.max(r.merged, r.mergedPRs))) / 20) * 20;
  const A = panel(44, 190, maxA, Array.from({ length: maxA / 40 + 1 }, (_, i) => i * 40), 'Changes per week: merged tickets, and the correct, complete ones among them', (y) =>
    shown.map((r, i) => `<rect x="${x(i) + 2}" y="${y(r.merged)}" width="${bw - 4}" height="${y(0) - y(r.merged)}" fill="${C.merged}"/><rect x="${x(i) + 2}" y="${y(r.good)}" width="${bw - 4}" height="${y(0) - y(r.good)}" fill="${C.good}"/>`).join('')
    + line(shown.map((r) => r.mergedPRs), y, C.pr, '4 3'));
  const maxB = 100;
  const B = panel(290, 120, maxB, [0, 25, 50, 75, 100], 'Fleet dispatches per correct, complete change', (y) => line(shown.map((r) => r.dispatchesPerGood), y, C.disp));
  const maxC = 6;
  const Cc = panel(466, 120, maxC, [0, 2, 4, 6], 'Fleet working hours per correct, complete change', (y) => line(shown.map((r) => r.workHPerGood), y, C.hours), ' h');
  const legend = [[C.merged, 'merged tickets'], [C.good, 'correct and complete'], [C.pr, 'merged PRs (naive count)'], [C.prov, `inside the ${WINDOW}-day escape window (provisional)`]]
    .map(([c, t], i) => `<rect x="${L + (i % 2) * 300}" y="${620 + (i >> 1) * 18}" width="12" height="12" fill="${c}" stroke="${C.grid}"/><text x="${L + (i % 2) * 300 + 17}" y="${630 + (i >> 1) * 18}" font-size="11" fill="${C.ink}">${esc(t)}</text>`).join('');
  const svg1 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 666" font-family="Inter, system-ui, sans-serif"><rect width="${W}" height="666" fill="#fff"/>${A}${xLabels(250)}${B}${xLabels(426)}${Cc}${xLabels(602)}${legend}</svg>`;
  writeFileSync(join(svgDir, 'weekly-throughput.svg'), svg1);

  // Minimum detectable change against window length, for the throughput count and the two costs per change.
  const W2 = 720, H2 = 300, L2 = 58, T2 = 40, pw2 = W2 - L2 - 200, ph2 = 200;
  const ks = [1, 2, 4, 8]; const xk = (k) => L2 + (Math.log2(k) / 3) * pw2; const yv = (v) => T2 + ph2 - (Math.log(Math.min(v, 8)) / Math.log(8)) * ph2;
  let s2 = `<rect width="${W2}" height="${H2}" fill="#fff"/><text x="${L2}" y="24" font-size="13" font-weight="600" fill="${C.ink}">Smallest change the scorecard can see (80% power, 5% level)</text>`;
  for (const t of [1, 1.5, 2, 3, 4, 6, 8]) s2 += `<line x1="${L2}" x2="${L2 + pw2}" y1="${yv(t)}" y2="${yv(t)}" stroke="${t === 2 ? C.ink : C.grid}" ${t === 2 ? 'stroke-dasharray="5 3"' : ''}/><text x="${L2 - 6}" y="${yv(t) + 4}" font-size="11" text-anchor="end" fill="${C.muted}">×${t}</text>`;
  for (const k of ks) s2 += `<text x="${xk(k)}" y="${T2 + ph2 + 18}" font-size="11" text-anchor="middle" fill="${C.muted}">${k} wk</text>`;
  s2 += `<text x="${L2 + pw2 / 2}" y="${T2 + ph2 + 36}" font-size="11" text-anchor="middle" fill="${C.muted}">weeks compared on each side of a change</text><text x="${L2 + pw2 + 6}" y="${yv(2) - 5}" font-size="11" fill="${C.ink}">doubling</text>`;
  const series = [['good', C.good, 'correct, complete changes'], ['dispatchesPerGood', C.disp, 'dispatches per change'], ['workHPerGood', C.hours, 'working hours per change']];
  series.forEach(([k, c, t], j) => { s2 += `<path d="${ks.map((kk, i) => `${i ? 'L' : 'M'}${xk(kk)},${yv(sens[k].mdc[kk])}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2"/>` + ks.map((kk) => `<circle cx="${xk(kk)}" cy="${yv(sens[k].mdc[kk])}" r="3" fill="${c}"/>`).join('') + `<rect x="${L2 + pw2 + 16}" y="${T2 + 60 + j * 20}" width="12" height="3" fill="${c}"/><text x="${L2 + pw2 + 32}" y="${T2 + 65 + j * 20}" font-size="11" fill="${C.ink}">${esc(t)}</text>`; });
  writeFileSync(join(svgDir, 'detectable-change.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W2} ${H2}" font-family="Inter, system-ui, sans-serif">${s2}</svg>`);
  console.log(`\nfigures written to ${svgDir}`);
}
