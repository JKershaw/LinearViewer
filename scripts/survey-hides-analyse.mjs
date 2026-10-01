// LIN-3188: join the what-hides-between-sessions snapshots (register, detectors, runner, periodicals, prompts) into the paper's per-pattern table, detector scores and lead times.
// Usage: node scripts/survey-hides-analyse.mjs [--dir data/survey-hides] [--near]   (--near lists every alarm near each in-window incident on record, for the hand calls in what-hides-between-sessions-detector-eval.json)
// Reads: docs/papers/harbour/what-hides-between-sessions-{register,detector-eval,prompt-rules}.json and, from --dir, register-summary.json,
// detect-sessions.json, detect-runner.json, runner.json, d2-codes.json, d7-codes.json, vigil-codes.json, periodicals.json, sessions.jsonl and
// wake/deliveries.jsonl. Writes <dir>/analysis.json and prints the tables the paper quotes. No proxy calls.
//
// A pattern's monthly rate is September's count from the instrument that measured it (a detector run over the month, or the runner's own
// log); a pattern no instrument measured takes the register's count over June-September divided by four. Time to discovery is the register's
// median hours from onset to filing for the pattern, except P4, whose instances are not incidents: there it is the aggregate's onset (LIN-1357,
// 16 July, a wake for every stepper beat) to the first paper that measured it (what-supervisors-do.md, 30 September). P6 is split: stalls the
// runner's failsafe sees (it fires after 60 minutes of silence, so discovery is 1 h by construction) and stalls of the machinery itself (the
// register's P6 rows). Cost is weighted tokens in September (survey-wake-extract.mjs's weighting) and idle wall-clock where measured.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-hides');
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lines = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const D = 'docs/papers/harbour/what-hides-between-sessions';
const reg = J(`${D}-register.json`).incidents;
const evalD = J(`${D}-detector-eval.json`).detectors;
const rules = J(`${D}-prompt-rules.json`);
const regSum = J(join(dir, 'register-summary.json'));
const ds = J(join(dir, 'detect-sessions.json'));
const dr = J(join(dir, 'detect-runner.json'));
const runner = J(join(dir, 'runner.json'));
const d2 = J(join(dir, 'd2-codes.json'));
const d7 = J(join(dir, 'd7-codes.json'));
const vigil = J(join(dir, 'vigil-codes.json'));
const per = J(join(dir, 'periodicals.json'));
const ms = (s) => { if (!s) return null; let t = s.includes('T') ? s : `${s.slice(0, 10)}T00:00:00Z`; if (/T\d\d:\d\dZ$/.test(t)) t = t.replace('Z', ':00Z'); if (!/Z$|[+-]\d\d:\d\d$/.test(t)) t += 'Z'; return Date.parse(t); };
const H = 3600e3;
const median = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const rows = Object.fromEntries(regSum.rows.map((r) => [r.id, r]));

// ---- --near: every alarm within 2 h before to 24 h after each in-window incident's onset (30 h for a date-only onset).
if (process.argv.includes('--near')) {
  const alarms = [
    ...ds.d1.episodes.filter((e) => e.cls !== 'client').map((e) => ['D1', ms(e.alarmAt), `${e.sig} · ${e.sessions} sessions`]),
    ...d2.codes.map((c) => ['D2', ms(`${c.alarmAt}Z`), `${c.waiter} · ${c.code} · ${c.idleMin} min`]),
    ...dr.d5.hits.map((h) => ['D5', ms(h.at), `${h.parentIssue} · ${h.parentLayer}`]),
    ...dr.d5x.rows.map((r) => ['D5x', ms(r.at), `${r.status} · ${r.line.slice(0, 30)}`]),
    ...ds.d7.pairs.map((p) => ['D7', ms(p.firstAt), `${p.issue} · ${p.kind}`]),
  ];
  for (const i of reg) {
    if (!i.onset || i.onset < '2026-07-12') continue;
    const t = ms(i.onset); const hi = t + (i.onset.includes('T') ? 24 : 30) * H;
    const near = alarms.filter(([, a]) => a >= t - 2 * H && a <= hi);
    console.log(`${i.id} ${i.pattern} ${i.repo} onset ${i.onset} by ${i.detectedBy}: ${i.why}`);
    for (const [d, a, s] of near) console.log(`   ${d} ${new Date(a).toISOString().slice(5, 16)} ${s}`);
  }
  process.exit(0);
}

// ---- Fleet units in September (sessions whose first turn is in September), for shares.
const sessions = lines(join(dir, 'sessions.jsonl'));
const sepUnits = sessions.filter((s) => s.first?.startsWith('2026-09')).reduce((a, s) => a + (s.units || 0), 0);

// ---- Deliveries (survey-wake-extract.mjs's snapshot) for the failsafe's and the floods' token cost.
const deliveries = lines(join(dir, 'wake', 'deliveries.jsonl'));
const sep = (d) => d.at?.startsWith('2026-09');
const refireUnits = deliveries.filter((d) => sep(d) && (d.source === 'failsafe-reconfirm' || d.source === 'silence-refire')).reduce((a, d) => a + d.units, 0);
const bySession = new Map(); for (const d of deliveries) { if (!bySession.has(d.session.slice(0, 8))) bySession.set(d.session.slice(0, 8), []); bySession.get(d.session.slice(0, 8)).push(d); }
const floods = dr.d8.floods.filter((f) => f.perHour > 30);
const floodUnits = floods.filter((f) => f.from.startsWith('2026-09')).reduce((a, f) => { const t = Date.parse(f.from); return a + (bySession.get(f.session.slice(0, 8)) || []).filter((d) => { const x = Date.parse(d.at); return x >= t && x < t + H; }).reduce((b, d) => b + d.units, 0); }, 0);

// ---- D1 September: real episodes (auth, transient) and their retry cost.
const d1Sep = ds.d1.episodes.filter((e) => e.start.startsWith('2026-09'));
const errs = ds.d1.errorsByMonthRepoClass;
const sum = (pred, k) => Object.entries(errs).filter(([key]) => pred(key)).reduce((a, [, v]) => a + v[k], 0);
const p1 = {
  episodes: d1Sep.filter((e) => e.cls !== 'client').length,
  auth: d1Sep.filter((e) => e.cls === 'auth').length,
  errors: { harbour: sum((k) => k.startsWith('2026-09 harbour') && /auth|transient/.test(k), 'errors'), runner: sum((k) => k.startsWith('2026-09 runner') && /auth|transient/.test(k), 'errors') },
  healed: { harbour: sum((k) => k.startsWith('2026-09 harbour') && /auth|transient/.test(k), 'healed'), runner: sum((k) => k.startsWith('2026-09 runner') && /auth|transient/.test(k), 'healed') },
  retryUnits: sum((k) => k.startsWith('2026-09') && /auth|transient/.test(k), 'retryUnits'),
};

// ---- D2 codes in September by what the waiter was really waiting on.
const codeSep = (c) => d2.codes.filter((x) => x.code === c && x.alarmAt.startsWith('2026-09'));
const d2Sep = Object.fromEntries(['cycle', 'lost-wake', 'late-wake', 'child-stalled', 'usage-limit', 'child-background'].map((c) => [c, { n: codeSep(c).length, idleMin: codeSep(c).reduce((a, x) => a + x.idleMin, 0), harbour: codeSep(c).filter((x) => x.repo === 'harbour').length, runner: codeSep(c).filter((x) => x.repo === 'runner').length }]));
const allCycles = d2.codes.filter((x) => x.code === 'cycle');

// ---- Register counts by pattern and month.
const regBy = (p, month) => reg.filter((i) => i.pattern === p && (!month || (i.onset || rows[i.id]?.filed || '').startsWith(month)));
const disc = (p) => regSum.summary[`${p}|all`]?.toDiscoveryHours?.median ?? null;
const repoMix = (p) => { const m = {}; for (const i of regBy(p)) m[i.repo] = (m[i.repo] || 0) + 1; return m; };

const stallSep = runner.stalls.byMonth['2026-09'];
// Idle before a fire while EXECUTING (a true execution stall; waits in AWAITING_* include legitimate ones), September.
const execStallHours = runner.stalls.fires.filter((f) => f.ts?.startsWith('2026-09') && f.from === 'EXECUTING').reduce((a, f) => a + (f.silentMs || 0), 0) / H;
const d7True = d7.codes.filter((c) => c.code === 'duplicate');
const d7Units = ds.d7.pairs.filter((p) => d7True.some((c) => c.pair === `${p.first}/${p.second}`)).reduce((a, p) => a + (p.secondUnits || 0), 0);
const p6bSep = regBy('P6', '2026-09');
const idleOf = (xs) => xs.reduce((a, i) => a + (i.idleMinutes || 0), 0) / 60;

const patterns = [
  { id: 'P1', short: 'Healed errors', label: 'Healed or masked errors (auth, retries)', repo: 'harbour', perMonth: p1.episodes, source: 'D1 episodes of an auth or transient error seen by 3+ sessions within an hour, September', discoveryHours: disc('P1'), costUnits: p1.retryUnits, idleHours: null, detector: 'caught', record: regBy('P1').length, recordRepos: repoMix('P1') },
  { id: 'P2', short: 'Circular waits', label: 'Circular or orphaned waits', repo: 'both', perMonth: d2Sep.cycle.n + regBy('P2', '2026-09').length, source: 'D2 cycles in September plus the register\'s September P2 incidents', discoveryHours: disc('P2'), costUnits: null, idleHours: (d2Sep.cycle.idleMin + allCycles.filter((c) => c.alarmAt.startsWith('2026-10')).reduce((a, c) => a + c.idleMin, 0)) / 60 + idleOf(regBy('P2', '2026-09')), detector: 'caught', record: regBy('P2').length, recordRepos: repoMix('P2') },
  { id: 'P3', short: 'Retry-only passes', label: 'Tests that pass only on retry', repo: 'harbour', perMonth: Math.round((2302 * 229) / 288 / 3), source: 'browser-flakes.md v2: 229 of 288 sampled green runs (every 8th of 2,302 since 3 July) hid a retry; a month is a third of that', discoveryHours: disc('P3'), costUnits: null, idleHours: 7.5 / 3, detector: 'cited', record: regBy('P3').length, recordRepos: repoMix('P3') },
  { id: 'P4', short: 'Quiet wakes', label: 'Wakes that change nothing', repo: 'both', perMonth: 3233, source: 'held-or-fresh.md v2: 3,233 quiet deliveries into held supervisors, September, 16.3% of fleet tokens', discoveryHours: (Date.parse('2026-09-30T13:53:27Z') - Date.parse('2026-07-16T00:00:00Z')) / H, costUnits: 0.163 * sepUnits, idleHours: null, detector: 'partly', record: regBy('P4').length, recordRepos: repoMix('P4') },
  { id: 'P5', short: 'Lost wakes', label: 'Lost wakes', repo: 'both', perMonth: d2Sep['lost-wake'].n, source: 'D2 waits coded lost-wake, September (late wakes, 24-50 min, counted apart)', discoveryHours: disc('P5'), costUnits: null, idleHours: d2Sep['lost-wake'].idleMin / 60, detector: 'caught', record: regBy('P5').length, recordRepos: repoMix('P5') },
  { id: 'P6a', short: 'Stalls (failsafe)', label: 'Stalled sessions the failsafe sees', repo: 'runner', perMonth: stallSep.fires, source: "the runner's stall failsafe fires, September (runner.json)", discoveryHours: 1, costUnits: refireUnits, idleHours: execStallHours, detector: 'in-code', record: null },
  { id: 'P6b', short: 'Stalled machinery', label: 'Stalls of the machinery itself', repo: 'runner', perMonth: p6bSep.length, source: "the register's P6 incidents with a September onset", discoveryHours: disc('P6'), costUnits: null, idleHours: idleOf(p6bSep), detector: 'partly', record: regBy('P6').length, recordRepos: repoMix('P6') },
  { id: 'P7', short: 'Duplicated work', label: 'Duplicated work', repo: 'both', perMonth: d7True.length, source: 'D7 pairs read as true duplicates, September', discoveryHours: disc('P7'), costUnits: d7Units, idleHours: null, detector: 'caught', record: regBy('P7').length, recordRepos: repoMix('P7') },
  { id: 'P8', short: 'Wake floods', label: 'Loops and wake floods', repo: 'both', perMonth: floods.filter((f) => f.from.startsWith('2026-09')).length, source: 'D8 hours with more than 30 deliveries into one session, September', discoveryHours: disc('P8'), costUnits: floodUnits, idleHours: null, detector: 'partly', record: regBy('P8').length, recordRepos: repoMix('P8') },
];

// ---- Detector scores against the record, plus alarms tied to no incident on record.
const near = (t, xs) => xs.some((h) => t >= h - H && t <= h + 12 * H);
const detectors = evalD.map((d) => {
  const hitsAt = [...d.calls, ...(d.alsoHit || [])].filter((c) => c.verdict === 'hit' || c.alarmAt).filter((c) => c.verdict !== 'miss').map((c) => ms(c.alarmAt));
  const o = { id: d.id, label: d.label, repo: d.repo, patterns: d.patterns, window: d.window, hits: d.calls.filter((c) => c.verdict === 'hit').length, misses: d.calls.filter((c) => c.verdict === 'miss').length };
  if (d.id === 'D1') { const real = ds.d1.episodes.filter((e) => e.cls !== 'client'); o.alarms = ds.d1.episodes.length; o.unrecorded = real.filter((e) => !near(ms(e.alarmAt), hitsAt)).length; o.falseAlarms = ds.d1.episodes.filter((e) => e.cls === 'client').length; }
  if (d.id === 'D1f') { o.alarms = 0; o.unrecorded = 0; o.falseAlarms = 0; o.misses = reg.filter((i) => i.pattern === 'P1' && i.onset && i.onset >= d.window[0]).length; }
  if (d.id === 'D2') { const real = d2.codes.filter((c) => c.code !== 'child-background'); o.alarms = d2.codes.length; o.unrecorded = real.filter((c) => !near(ms(`${c.alarmAt}Z`), hitsAt)).length; o.falseAlarms = d2.codes.length - real.length; }
  if (d.id === 'D5') { o.alarms = dr.d5.hits.length; o.unrecorded = dr.d5.hits.filter((h) => !near(ms(h.at), hitsAt)).length; o.falseAlarms = 0; }
  if (d.id === 'D5x') { o.alarms = dr.d5x.rows.length; o.unrecorded = dr.d5x.rows.filter((r) => !near(ms(r.at), hitsAt)).length; o.falseAlarms = 0; o.loggedAsPosted = dr.d5x.rows.filter((r) => r.doneLoggedAnyway).length; }
  if (d.id === 'D7') { o.alarms = d7.codes.length; o.unrecorded = d7True.length; o.falseAlarms = d7.codes.length - d7True.length; o.guardRefused = 13; }
  // Lead: hours from the detector's alarm to the record's discovery (filing), where both are known.
  o.leads = d.calls.filter((c) => c.verdict === 'hit').map((c) => { const r = rows[c.id]; const found = c.id === 'WAIT-2026-10-01' ? ms('2026-10-01T09:10Z') : ms(r?.filed); return { id: c.id, alarmAt: c.alarmAt, discovered: found ? new Date(found).toISOString() : null, leadHours: found ? (found - ms(c.alarmAt)) / H : null, by: r?.detectedBy ?? null }; });
  return o;
});
const leads = detectors.flatMap((d) => d.leads);

// ---- Who found the incidents on record, and the periodicals' and prompts' share.
const discoverers = {}; for (const i of reg) discoverers[i.detectedBy] = (discoverers[i.detectedBy] || 0) + 1;
const crossSession = reg.filter((i) => i.crossSession).length;
const rulesBy = {}; for (const r of rules.rules || []) { const k = r.pattern; rulesBy[k] ??= { n: 0, bytes: 0, roles: {} }; rulesBy[k].n++; rulesBy[k].bytes += r.bytes || 0; rulesBy[k].roles[r.role] = (rulesBy[k].roles[r.role] || 0) + 1; }

const out = {
  window: { register: 'LIN-300 onward (about 1 June) to 1 October', transcripts: [ds.window.first, ds.window.last], oplog: runner.window },
  sepUnits, p1, d2Sep, patterns, detectors,
  leads: { list: leads, medianHours: median(leads.map((l) => l.leadHours)), positive: leads.filter((l) => l.leadHours > 0.25).length, n: leads.length },
  register: { incidents: reg.length, crossSession, discoverers, toDiscoveryMedianHours: regSum.summary['all|all']?.toDiscoveryHours?.median, toFixMedianHours: regSum.summary['all|all']?.toFixHours?.median },
  stalls: runner.stalls.byMonth, census: runner.census.byMonth,
  periodicals: { reports: per.reports.length, runTickets: per.runTickets.length, followUps: per.followUps.length, readings: per.readings.map((r) => ({ id: r.id, role: r.role, patterns: r.patterns })), batchUnits: per.cost.stage1Units + per.cost.stage2Units, batchShareOfSeptember: (per.cost.stage1Units + per.cost.stage2Units) / sepUnits },
  prompts: { rules: (rules.rules || []).length, byPattern: rulesBy },
  vigilance: { population: vigil.population, sample: vigil.sample, summary: vigil.summary },
  costs: { refireUnits, floodUnits, d7Units, retryUnits: p1.retryUnits },
};
writeFileSync(join(dir, 'analysis.json'), JSON.stringify(out, null, 1));

const pct = (u) => `${((100 * u) / sepUnits).toFixed(2)}%`;
console.log(`September fleet: ${(sepUnits / 1e6).toFixed(0)}M weighted units`);
console.log('\npattern | a month | to discovery (h) | Sep units | idle h | detector | on record');
for (const p of patterns) console.log(`${p.id} ${p.short} | ${p.perMonth} | ${p.discoveryHours?.toFixed(1)} | ${p.costUnits ? `${(p.costUnits / 1e6).toFixed(1)}M (${pct(p.costUnits)})` : 'n/a'} | ${p.idleHours?.toFixed(1) ?? 'n/a'} | ${p.detector} | ${p.record ?? '-'} ${JSON.stringify(p.recordRepos || {})}`);
console.log('\ndetector | window | hits | misses | alarms | unrecorded | false');
for (const d of detectors) console.log(`${d.id} ${d.label} | ${d.window.join('..')} | ${d.hits} | ${d.misses} | ${d.alarms} | ${d.unrecorded} | ${d.falseAlarms}`);
console.log('\nleads (alarm to discovery):'); for (const l of leads) console.log(`  ${l.id} ${l.alarmAt} -> ${l.discovered} (${l.by}) ${l.leadHours?.toFixed(1)} h`);
console.log(`median lead ${out.leads.medianHours?.toFixed(1)} h; ${out.leads.positive} of ${out.leads.n} ahead by more than 15 min`);
console.log('\nP1', JSON.stringify(p1)); console.log('D2 September', JSON.stringify(d2Sep));
console.log('discoverers', JSON.stringify(discoverers), 'crossSession', crossSession, 'of', reg.length);
console.log('periodicals', JSON.stringify(out.periodicals));
console.log('prompts', JSON.stringify(out.prompts));
console.log('costs', JSON.stringify(out.costs));
