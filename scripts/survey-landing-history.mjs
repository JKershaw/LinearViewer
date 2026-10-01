// LIN-3182: checks the hand-coded catalogue of process changes since June against git (both repos), the tracker snapshot and the scorecard's weekly cost per correct change, four weeks either side of each change.
// Usage: node scripts/survey-landing-history.mjs [--catalogue docs/papers/harbour/how-process-changes-land-changes.json] [--sd ../simple-dispatcher]
//   [--scorecard data/survey/scorecard.json] [--tracker data/survey/reliability-tracker.json] [--out data/survey/landing-history.json]
// Reads git (first-parent origin/main of each repo), the git-ignored scorecard snapshot written by scripts/survey-scorecard.mjs and the tracker snapshot
// written by scripts/survey-reliability-tracker.mjs. No proxy calls.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const catPath = arg('--catalogue', 'docs/papers/harbour/how-process-changes-land-changes.json');
const sdDir = arg('--sd', '../simple-dispatcher');
const scorePath = arg('--scorecard', 'data/survey/scorecard.json');
const trackerPath = arg('--tracker', 'data/survey/reliability-tracker.json');
const out = arg('--out', 'data/survey/landing-history.json');

const dirs = { LinearViewer: '.', 'simple-dispatcher': sdDir };
const git = (repo, args) => execFileSync('git', ['-C', dirs[repo], ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const cat = JSON.parse(readFileSync(catPath, 'utf8'));

// First-parent history of origin/main in each repo: sha -> date, and subject for ticket counting.
const fp = {};
for (const repo of Object.keys(dirs)) {
  const rows = git(repo, ['log', 'origin/main', '--first-parent', '--format=%H\t%h\t%ad\t%s%n%b%x1e', '--date=short']).split('\x1e');
  fp[repo] = rows.map((r) => r.trim()).filter(Boolean).map((r) => {
    const [head, ...body] = r.split('\n');
    const [full, short, date, subject] = head.split('\t');
    return { full, short, date, text: [subject, ...body].join('\n') };
  });
}
const head = Object.fromEntries(Object.keys(dirs).map((r) => [r, git(r, ['rev-parse', '--short=8', 'origin/main']).trim()]));

const tracker = existsSync(trackerPath) ? JSON.parse(readFileSync(trackerPath, 'utf8')) : { list: [] };
const ticketState = new Map(tracker.list.map((t) => [t.identifier, t.state?.name || null]));
const OPEN = new Set(['Backlog', 'Todo', 'In Progress']);

const score = JSON.parse(readFileSync(scorePath, 'utf8'));
const weeks = score.rows.filter((r) => r.full && r.fleetDispatches != null && r.good > 0);
const firstCostWeek = weeks[0]?.week;
const monday = (d) => { const t = new Date(`${d}T00:00:00Z`); const k = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - k); return t.toISOString().slice(0, 10); };
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const windowCost = (from, to) => {
  const ws = weeks.filter((w) => w.week >= from && w.week < to);
  if (!ws.length) return null;
  const s = ws.reduce((a, w) => ({ d: a.d + w.fleetDispatches, h: a.h + w.fleetWorkH, g: a.g + w.good }), { d: 0, h: 0, g: 0 });
  return { weeks: ws.length, good: s.g, dispatchesPerGood: +(s.d / s.g).toFixed(1), hoursPerGood: +(s.h / s.g).toFixed(2), provisional: ws.some((w) => !w.mature) };
};

const results = [];
for (const c of cat.changes) {
  // 1. Every listed commit is on first-parent origin/main; report its date.
  const commits = (c.landing.commits || []).map(({ repo, sha }) => {
    const hit = fp[repo].find((x) => x.full.startsWith(sha));
    return { repo, sha, onMain: !!hit, date: hit?.date || null };
  });
  // 2. First-parent commits naming each ticket, per repo, with the PR count (subjects carrying '#n' or 'Merge pull request').
  const named = {};
  for (const repo of Object.keys(dirs)) {
    const re = c.tickets.length ? new RegExp(`\\b(${c.tickets.join('|')})\\b`) : null;
    const hits = re ? fp[repo].filter((x) => re.test(x.text)) : [];
    if (hits.length) {
      const dates = hits.map((h) => h.date).sort();
      named[repo] = { commits: hits.length, prs: hits.filter((h) => /#\d+|Merge pull request|Merge PR/.test(h.text)).length, first: dates[0], last: dates.at(-1) };
    }
  }
  // 3. Residue re-checked at HEAD (grep) or in the tracker snapshot (ticket state).
  const residue = c.finished.residue.map((r) => {
    const o = { kind: r.kind, what: r.what };
    if (r.grep) {
      let present = false;
      try { present = git(r.grep.repo, ['grep', '-E', '-c', r.grep.pattern, 'origin/main', '--', r.grep.path]).trim().length > 0; } catch { present = false; }
      o.atHead = present ? 'present' : 'absent';
    }
    if (r.ticket) { o.ticket = r.ticket; o.state = ticketState.get(r.ticket) || 'not in snapshot'; o.open = OPEN.has(o.state); }
    return o;
  });
  // 4. Fleet cost per correct, complete change four full weeks either side of the landing week.
  const w0 = monday(c.date);
  const before = w0 <= firstCostWeek ? null : windowCost(addDays(w0, -28), w0);
  const after = windowCost(addDays(w0, 7), addDays(w0, 35));
  results.push({
    id: c.id, group: c.group, date: c.date, repos: c.repos, shape: c.landing.shape, spanDays: c.landing.spanDays,
    measuredBefore: c.measuredBefore.value, measuredAfter: c.measuredAfter.value, finished: c.finished.value,
    addsOrRemoves: c.addsOrRemoves, retirementCondition: c.retirementCondition, rollback: c.rollback || null,
    commits, named, residue, cost: { before: before || (w0 <= firstCostWeek ? 'no cost series' : null), after },
  });
}

// Print.
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
console.log(`Catalogue ${catPath}: ${results.length} changes; heads LinearViewer ${head.LinearViewer}, simple-dispatcher ${head['simple-dispatcher']}`);
console.log(`Cost series: fleet dispatches and working hours per correct, complete change, weeks from ${firstCostWeek} (scorecard cut ${score.cut}).\n`);
console.log(`${pad('id', 24)}${pad('date', 11)}${pad('repos', 7)}${pad('shape', 12)}${pad('bef', 8)}${pad('aft', 8)}${pad('finished', 14)}${pad('adds/removes', 15)}${pad('disp/h before', 19)}disp/h after`);
const short = (rs) => rs.map((r) => (r === 'LinearViewer' ? 'LV' : 'SD')).join('+');
const fmt = (x) => (x == null ? '—' : typeof x === 'string' ? x : `${x.dispatchesPerGood}/${x.hoursPerGood}${x.provisional ? '*' : ''}${x.weeks < 4 ? ` (${x.weeks}wk)` : ''}`);
for (const r of results) {
  console.log(`${pad(r.id, 24)}${pad(r.date, 11)}${pad(short(r.repos), 7)}${pad(r.shape, 12)}${pad(r.measuredBefore, 8)}${pad(r.measuredAfter, 8)}${pad(r.finished, 14)}${pad(r.addsOrRemoves, 15)}${pad(fmt(r.cost.before), 19)}${fmt(r.cost.after)}`);
}
console.log('  (* = window includes weeks still inside their 30-day correctness window; (n wk) = fewer than four weeks of cost series in the window)\n');

console.log('Commit checks (listed commits not on first-parent origin/main, or dated differently from the catalogue):');
let bad = 0;
for (const r of results) for (const k of r.commits) {
  if (!k.onMain) { bad++; console.log(`  ${r.id}: ${k.repo} ${k.sha} NOT on first-parent origin/main`); }
}
if (!bad) console.log('  all listed commits are on first-parent origin/main');
console.log('\nFirst-parent commits naming the change\'s tickets (commits / PR-bearing, first..last):');
for (const r of results) {
  const parts = Object.entries(r.named).map(([repo, n]) => `${repo === 'LinearViewer' ? 'LV' : 'SD'} ${n.commits}/${n.prs} ${n.first}..${n.last}`);
  console.log(`  ${pad(r.id, 24)}${parts.join('; ') || '(none: config only)'}`);
}
console.log('\nResidue re-checked:');
for (const r of results) for (const x of r.residue) {
  const where = x.atHead ? `at HEAD: ${x.atHead}` : x.ticket ? `${x.ticket} ${x.state}` : 'not re-checkable';
  console.log(`  ${pad(r.id, 24)}${pad(x.kind, 11)}${pad(where, 26)}${x.what}`);
}

const count = (key, rows = results) => rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] || 0) + 1), a), {});
const byRepo = { LinearViewer: results.filter((r) => r.repos.includes('LinearViewer')), 'simple-dispatcher': results.filter((r) => r.repos.includes('simple-dispatcher')) };
const summary = {
  changes: results.length,
  measuredBefore: count('measuredBefore'), measuredAfter: count('measuredAfter'),
  measuredBoth: results.filter((r) => r.measuredBefore === 'yes' && r.measuredAfter === 'yes').length,
  designedBeforeWithoutAfter: results.filter((r) => r.measuredBefore === 'yes' && r.measuredAfter !== 'yes').length,
  finished: count('finished'), shape: count('shape'), addsOrRemoves: count('addsOrRemoves'),
  withRetirementCondition: results.filter((r) => r.retirementCondition).length,
  withRollbackSwitch: results.filter((r) => r.rollback).length,
  residueItems: results.reduce((a, r) => a + r.residue.length, 0),
  residueOpenOrPresent: results.reduce((a, r) => a + r.residue.filter((x) => x.open || x.atHead === 'present').length, 0),
  byRepo: Object.fromEntries(Object.entries(byRepo).map(([k, rs]) => [k, {
    changes: rs.length, measuredBefore: count('measuredBefore', rs), measuredAfter: count('measuredAfter', rs), finished: count('finished', rs), addsOrRemoves: count('addsOrRemoves', rs),
  }])),
};
console.log('\nSummary (a change touching both repos counts once in the total and once in each repo):');
// Crowding: how many other catalogued changes land within 28 days either side of each one, so a 4-week before/after window
// is shared with them.
const dayMs = 86400000;
const neighbours = results.map((r) => results.filter((o) => o !== r && Math.abs(Date.parse(o.date) - Date.parse(r.date)) <= 28 * dayMs).length);
const sortedN = [...neighbours].sort((a, b) => a - b);
summary.crowding = { medianOtherChangesWithin28Days: sortedN[sortedN.length >> 1], min: sortedN[0], max: sortedN.at(-1), withNoneWithin28Days: neighbours.filter((n) => n === 0).length };
// The prompt-template change log (LIN-1662): how many rows recorded an expected direction before any read.
const logRows = readFileSync('scripts/prompt-template-change-log.md', 'utf8').split('\n').filter((l) => /^\| 20\d\d-/.test(l));
const dir = (l) => { const c = l.split('|').slice(1, -1); return c.at(-1).trim(); };
summary.changeLog = {
  rows: logRows.length,
  direction: logRows.filter((l) => /^\*\*(down|up)/.test(dir(l))).length,
  baseline: logRows.filter((l) => /baseline/.test(dir(l))).length,
  unknown: logRows.filter((l) => /^unknown/.test(dir(l))).length,
  backfilled: logRows.filter((l) => /backfilled/.test(dir(l))).length,
};
console.log(JSON.stringify(summary, null, 2));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ heads: head, catalogue: catPath, scorecardCut: score.cut, summary, results }, null, 2));
console.log(`\nWrote ${out}`);
