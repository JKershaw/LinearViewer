// LIN-3182: the smallest change each trial mode (before and after, alternate weeks, holdout by ticket, shadow mode) can detect on the scorecard, in how many weeks, and what crosses between its arms.
// Usage: node scripts/survey-landing-trials.mjs [--scorecard data/survey/scorecard.json] [--charge data/survey/landing-charge.json] [--runner data/survey-doubling/runner.json] [--out data/survey/landing-trials.json]
// Run survey-scorecard.mjs, survey-doubling-runner.mjs and survey-landing-charge.mjs first. No proxy calls. Detectable change is the
// ratio found at 80% power and a two-sided 5% level, exp(2.8 · sd · √(2/n)), as survey-scorecard.mjs computes it:
//   before/after and alternate weeks compare weekly ratios (n = weeks per arm; sd = sd of the weekly log ratio, as the scorecard prints it);
//   holdout by ticket compares changes inside the same weeks (n = changes per arm; sd = sd of log per-change cost under a charging rule),
//     with the per-change figure inflated by a design effect for changes that share a supervisor (lineage clusters);
//   shadow mode compares decisions, not cost: zero disagreements in n paired decisions bounds the true rate below 3/n (rule of three).
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const card = JSON.parse(readFileSync(arg('--scorecard', 'data/survey/scorecard.json'), 'utf8'));
const charge = JSON.parse(readFileSync(arg('--charge', 'data/survey/landing-charge.json'), 'utf8'));
const runner = JSON.parse(readFileSync(arg('--runner', 'data/survey-doubling/runner.json'), 'utf8'));
const tracker = JSON.parse(readFileSync(arg('--tracker', 'data/survey/reliability-tracker.json'), 'utf8'));
const out = arg('--out', 'data/survey/landing-trials.json');

const mdc = (sd, n) => Math.round(Math.exp(2.8 * sd * Math.sqrt(2 / n)) * 100) / 100;
const WEEKS = [2, 4, 8];

// Weekly series noise (13 Jul – 21 Sep, the scorecard's own window).
const S = card.sens;
const weekly = {
  'correct, complete changes a week': S.good.sdLog,
  'fleet dispatches per correct change': S.dispatchesPerGood.sdLog,
  'working hours per correct change': S.workHPerGood.sdLog,
};
const beforeAfter = Object.fromEntries(Object.entries(weekly).map(([k, sd]) => [k, Object.fromEntries(WEEKS.map((w) => [w, mdc(sd, w)]))]));
// Alternate weeks: 2w calendar weeks give w on and w off, the same arithmetic as w each side, but slow drift cancels.
const alternate = Object.fromEntries(Object.entries(weekly).map(([k, sd]) => [k, Object.fromEntries(WEEKS.map((w) => [2 * w, mdc(sd, w)]))]));

// Correct, complete changes with runner data per week, September and since 13 July.
const timed = card.changes.filter((c) => c.good && c.dispatches != null && c.lastMerge >= '2026-07-13' && c.lastMerge < '2026-09-28');
const perWeek = timed.length / 11;

// Straddling: a change whose runner span crosses a switch boundary sees both arms. For spans under a week, the chance a weekly
// boundary falls inside it is span/168 h.
const spans = card.changes.filter((c) => c.good && c.spanH != null).map((c) => c.spanH);
const straddleWeekly = spans.reduce((s, h) => s + Math.min(h, 168) / 168, 0) / spans.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Lineage clusters: correct, complete changes grouped by the top of their tracker parent chain (an epic or passage holds its
// children). The design effect 1 + (m − 1)·ρ uses the change-weighted mean cluster size m = Σn²/Σn and an assumed within-cluster
// correlation ρ (0.1 and 0.3 bracket it; it is not measured here).
const parentOf = new Map(tracker.list.filter((t) => t.parent).map((t) => [t.identifier, t.parent]));
const topOf = (id) => { let x = id; const seen = new Set(); while (parentOf.has(x) && !seen.has(x)) { seen.add(x); x = parentOf.get(x); } return x; };
const clusters = new Map();
for (const c of timed) { const t = topOf(c.id); clusters.set(t, (clusters.get(t) || 0) + 1); }
const sizes = [...clusters.values()];
const m = sizes.reduce((a, n) => a + n * n, 0) / sizes.reduce((a, n) => a + n, 0);
const deff = (rho) => 1 + (m - 1) * rho;
const late = charge.table.find((r) => r.block === '13 – 30 Sep' && r.repo === 'both');
const mid = charge.table.find((r) => r.block === '10 Aug – 12 Sep' && r.repo === 'both');
const holdout = {};
for (const [label, row] of [['10 Aug – 12 Sep', mid], ['13 – 30 Sep', late]]) {
  holdout[label] = {};
  for (const rule of ['child', 'session', 'lineage']) {
    const sd = row[rule].sdLog;
    holdout[label][rule] = Object.fromEntries(WEEKS.map((w) => {
      const nArm = (perWeek * w) / 2;
      return [w, { plain: mdc(sd, nArm), rho01: mdc(sd, nArm / deff(0.1)), rho03: mdc(sd, nArm / deff(0.3)) }];
    }));
  }
}
// Hours per change, per change (the scorecard's own sd of log working hours).
const hoursHoldout = Object.fromEntries(WEEKS.map((w) => [w, mdc(S.perChangeWorkH.sdLog, (perWeek * w) / 2)]));

// Shadow mode: paired decisions available per week on the wake path (follow-ups delivered), September.
const sepFollow = runner.rows.filter((r) => (r.shape === 'warm' || r.shape === 'cold') && r.at >= '2026-09-01' && r.at < '2026-09-29').length / 4;
const shadow = { followUpsPerWeek: Math.round(sepFollow), ruleOfThree: Object.fromEntries([100, 300, 1000, 3000].map((n) => [n, `${Math.round((3 / n) * 1000) / 10}%`])) };

const result = {
  generatedAt: new Date().toISOString(), perWeekTimedChanges: Math.round(perWeek * 10) / 10,
  weeklySd: weekly, clusters: { n: sizes.length, inClustersOfTwoOrMore: sizes.filter((n) => n > 1).reduce((a, n) => a + n, 0), weightedMeanSize: Math.round(m * 10) / 10, largest: Math.max(...sizes) }, beforeAfter, alternate, holdout, hoursHoldout,
  straddle: { changesWithSpan: spans.length, medianSpanH: Math.round(median(spans) * 10) / 10, overOneDay: Math.round((100 * spans.filter((h) => h > 24).length) / spans.length), overOneWeek: Math.round((1000 * spans.filter((h) => h > 168).length) / spans.length) / 10, weeklySwitchStraddle: Math.round(straddleWeekly * 1000) / 10 },
  shadow,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));

console.log(`timed correct, complete changes a week (13 Jul – 27 Sep): ${result.perWeekTimedChanges}`);
console.log('\nBefore and after: detectable ratio with w weeks each side');
for (const [k, v] of Object.entries(beforeAfter)) console.log(`  ${k.padEnd(38)} ${WEEKS.map((w) => `${w} wk ×${v[w]}`).join('  ')}`);
console.log('Alternate weeks: detectable ratio over 2w calendar weeks (w on, w off)');
for (const [k, v] of Object.entries(alternate)) console.log(`  ${k.padEnd(38)} ${WEEKS.map((w) => `${2 * w} wk ×${v[2 * w]}`).join('  ')}`);
console.log(`Lineage clusters among ${timed.length} timed changes: ${sizes.length} clusters, ${result.clusters.inClustersOfTwoOrMore} changes share one, change-weighted mean size ${result.clusters.weightedMeanSize}, largest ${result.clusters.largest}`);
console.log('Holdout by ticket: detectable ratio in dispatches per correct change, by charging rule (plain / clustered ρ=0.1 / ρ=0.3)');
for (const [b, rules] of Object.entries(holdout)) for (const [rule, v] of Object.entries(rules)) console.log(`  sd from ${b.padEnd(16)} ${rule.padEnd(8)} ${WEEKS.map((w) => `${w} wk ×${v[w].plain}/${v[w].rho01}/${v[w].rho03}`).join('  ')}`);
console.log(`  working hours per change (rule-free; sdLog ${S.perChangeWorkH.sdLog}) ${WEEKS.map((w) => `${w} wk ×${hoursHoldout[w]}`).join('  ')}`);
console.log(`\nSpans: ${result.straddle.changesWithSpan} changes with a runner span; median ${result.straddle.medianSpanH} h; ${result.straddle.overOneDay}% over a day; ${result.straddle.overOneWeek}% over a week; a weekly switch splits ${result.straddle.weeklySwitchStraddle}% of changes`);
console.log(`Shadow mode: ${shadow.followUpsPerWeek} follow-ups delivered a week in September; zero disagreements in n bounds the rate below`, shadow.ruleOfThree);
