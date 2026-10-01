// LIN-3182: census of half-finished process items at origin/main in both repos (flags, dual paths, parked experiments, open process follow-ups) with each item's age, cross-checked against the hand-coded docs/papers/harbour/how-process-changes-land-halfdone.json.
// Usage: node scripts/survey-landing-halfdone.mjs [--sd ../simple-dispatcher] [--tracker data/survey/reliability-tracker.json] [--codes docs/papers/harbour/how-process-changes-land-halfdone.json] [--out data/survey/landing-halfdone.json] [--at 2026-10-01] [--write-back]
// --write-back fills each coded item's line, introducing commit, date and age into the codes file. No proxy calls: git and the tracker snapshot only.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { execFileSync } from 'child_process';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const sdPath = opt('--sd', '../simple-dispatcher');
const trackerPath = opt('--tracker', 'data/survey/reliability-tracker.json');
const codesPath = opt('--codes', 'docs/papers/harbour/how-process-changes-land-halfdone.json');
const outPath = opt('--out', 'data/survey/landing-halfdone.json');
const AT = new Date(opt('--at', '2026-10-01') + 'T00:00:00Z');
const writeBack = argv.includes('--write-back');
const REV = 'origin/main';
const CWD = { LinearViewer: '.', 'simple-dispatcher': sdPath };
const git = (repo, args) => execFileSync('git', args, { cwd: CWD[repo], encoding: 'utf8', maxBuffer: 1 << 28 });
const days = (d) => Math.round((AT - new Date(d + 'T00:00:00Z')) / 864e5);

// ---- process code, as the brief defines it
const LV_PROCESS = [
  /^lib\/(prompts\/|prompt-(templates|template-defs|formatters)\.js$|proxy-(instructions|preamble)\.js$)/, // growth-atlas 'prompt text'
  /^lib\/(dispatch|autopilot|passage|observation|observer|wake|loop|harbour-spawn|agent-|completion-signals|follow-on|recommend|next-run|runner-kit|periodical|stack|ruling|escalation|budget|halt|pipeline-|plan-review|task-(decisions|snapshot)|unanswered|dismissal|digest-feedback|terminal-marked|effort|transcript-spend|live-console)/, // 'dispatch + fleet' (includes lib/runner-kit/)
  /^(lib\/prompt-(templates|template-defs|formatters)\.js|lib\/prompts\/|docs\/autopilot-operating-manual\.md|docs\/(worker-lane|passage-runner|passage-planner|runner)-prompt\.md|docs\/architecture\/|CLAUDE\.md|lib\/proxy-(instructions|preamble)\.js)$/, // scorecard PROCESS reading paths
  /^docs\/architecture\//,
];
const SD_PROCESS = [/^(?!e2e-)[^/]+\.js$/, /^(CLAUDE|README)\.md$/, /^docs\//, /^experiments\//, /^scripts\//];
const files = (repo) => git(repo, ['ls-tree', '-r', '--name-only', REV]).trim().split('\n');
const proc = {
  LinearViewer: files('LinearViewer').filter((f) => LV_PROCESS.some((r) => r.test(f))),
  'simple-dispatcher': files('simple-dispatcher').filter((f) => SD_PROCESS.some((r) => r.test(f))),
};
const show = (repo, p) => { try { return git(repo, ['show', `${REV}:${p}`]); } catch { return null; } };
const isCode = (p) => /\.(m?js)$/.test(p);

// ---- age: the first first-parent commit on main that added the token (in that file if it still exists there)
function introduced(repo, token, path) {
  const run = (extra) => git(repo, ['log', REV, '--first-parent', '--diff-merges=first-parent', '-S', token, '--format=%h\t%cs\t%s', '--reverse', ...extra]).trim().split('\n').filter(Boolean)[0];
  const l = (path && run(['--', path])) || run([]);
  if (!l) return null;
  const [sha, date, subject] = l.split('\t');
  return { sha, date, subject: subject.slice(0, 120), ageDays: days(date) };
}

// ---- (a) flag candidates: every env var process code reads, tagged by idiom and by the comment block above it
const ROLLBACK = /\brollback|0 disables|0 DISABLES|disables the|disable[sd]? (it|the [a-z -]+) entirely|pre-LIN-\d+|byte-identical|off-switch|instant.rollback/i;
const flagCands = [];
for (const repo of Object.keys(proc)) {
  for (const p of proc[repo].filter(isCode)) {
    const src = show(repo, p); if (!src) continue;
    const lines = src.split('\n');
    const seen = new Set();
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+))/g)) {
        const name = m[1] || m[2]; if (seen.has(name)) continue; seen.add(name);
        const near = lines.slice(i, i + 4).join('\n');
        const bool = /\^\((0\|false|1\|true)/.test(near) ? (/!\/\^\(0\|false/.test(near) ? 'default-on' : 'default-off') : null;
        let j = i - 1; const block = [];
        while (j >= 0 && i - j < 40 && /^\s*(\/\/|\*|\/\*)/.test(lines[j])) block.unshift(lines[j--]);
        flagCands.push({ repo, name, path: p, line: i + 1, bool, rollback: ROLLBACK.test(block.join('\n') + near) });
      }
    });
  }
}

// ---- (b) dual-path candidates: files whose process code mentions an old path kept beside a new one
const DUAL = /\blegacy\b|deprecated|back-?compat|backwards?[- ]compat|\bshim\b|kept only for|old path|legacy fallback/i;
const dualCands = [];
for (const repo of Object.keys(proc)) for (const p of proc[repo].filter(isCode)) {
  const src = show(repo, p); if (!src) continue;
  const hits = src.split('\n').map((l, i) => (DUAL.test(l) ? i + 1 : 0)).filter(Boolean);
  if (hits.length) dualCands.push({ repo, path: p, hits: hits.length, lines: hits.slice(0, 8) });
}

// ---- (c) parked-experiment candidates
const expCands = [];
for (const f of files('simple-dispatcher')) {
  if (/^experiments\//.test(f)) { const top = f.split('/').slice(0, 2).join('/'); if (!expCands.some((c) => c.path === top)) expCands.push({ repo: 'simple-dispatcher', path: top }); }
  if (/^docs\/[^/]+\.md$/.test(f)) {
    const head = (show('simple-dispatcher', f) || '').split('\n').slice(0, 12).join('\n');
    const m = head.match(/\*\*Status:?\*\*:?\s*([^\n]{0,80})/i);
    if (m && /proposed|research|experiment|design|draft|empirical|superseded/i.test(m[1] + head)) expCands.push({ repo: 'simple-dispatcher', path: f, status: m[1].trim() });
    else if (/superseded|research/i.test(head)) expCands.push({ repo: 'simple-dispatcher', path: f, status: 'header mentions research/superseded' });
  }
}
for (const f of files('LinearViewer')) {
  if (/^(prototypes\/[^/]+|plans\/[^/]+)/.test(f)) { const top = f.split('/').slice(0, 2).join('/'); if (!expCands.some((c) => c.path === top)) expCands.push({ repo: 'LinearViewer', path: top }); }
  if (/^docs\/(reviews\/)?[^/]+\.md$/.test(f) && /proposal|experiment|bake-?off|spike|research|-v2\.md$/i.test(f) && !/^docs\/papers\//.test(f)) expCands.push({ repo: 'LinearViewer', path: f });
}

// ---- TODO/FIXME/XXX naming a ticket, in process code (count only)
const todos = {};
for (const repo of Object.keys(proc)) for (const p of proc[repo].filter(isCode)) {
  const src = show(repo, p) || '';
  todos[repo] = (todos[repo] || 0) + src.split('\n').filter((l) => /\b(TODO|FIXME|XXX)\b/.test(l) && /LIN-\d+/.test(l)).length;
}

// ---- (d) open follow-ups on process work, from the tracker snapshot
const tracker = JSON.parse(readFileSync(trackerPath, 'utf8'));
const PROCESS_FRONTS = ['front:dispatcher-substrate', 'front:prompt-engine', 'front:operating-model', 'front:rulings'];
const anchors = Object.entries(tracker.details).filter(([, v]) => v.createdAt).map(([k, v]) => [+k.slice(4), Date.parse(v.createdAt)]).sort((a, b) => a[0] - b[0]);
function createdOf(id) {
  const det = tracker.details[id]; if (det?.createdAt) return { date: det.createdAt.slice(0, 10), method: 'createdAt' };
  const n = +id.slice(4); let lo = anchors[0], hi = anchors[anchors.length - 1];
  for (let k = 0; k < anchors.length - 1; k++) if (anchors[k][0] <= n && anchors[k + 1][0] >= n) { lo = anchors[k]; hi = anchors[k + 1]; break; }
  if (n > hi[0]) lo = anchors[anchors.length - 2];
  const t = lo[1] + ((n - lo[0]) * (hi[1] - lo[1])) / (hi[0] - lo[0] || 1);
  return { date: new Date(Math.min(t, Date.parse(tracker.fetchedAt))).toISOString().slice(0, 10), method: 'interpolated' };
}
const SD_TEXT = /simple-dispatcher|\bSD\b|\b(hook|reapers|dispatcher|heartbeat|executors|harnesses|config|state-store|phases|oplog|terminal-driver|opencode-[a-z]+)\.js\b/;
const followUps = [];
for (const t of tracker.list) {
  if (!['backlog', 'unstarted', 'started'].includes(t.state.type)) continue;
  const labels = t.labels || [];
  const kind = labels.includes('kind:follow-up') ? 'follow-up' : labels.includes('kind:review-residue') ? 'review-residue' : null;
  if (!kind || !labels.some((l) => PROCESS_FRONTS.includes(l))) continue;
  const named = ((t.description || '').slice(0, 600).match(/\bLIN-\d+\b/g) || []).filter((x) => x !== t.identifier);
  const c = createdOf(t.identifier);
  followUps.push({ class: kind, repo: SD_TEXT.test(t.title + ' ' + (t.description || '').slice(0, 1500)) ? 'simple-dispatcher' : 'LinearViewer',
    ticket: t.identifier, origin: t.parent || named[0] || null, state: t.state.name, fronts: labels.filter((l) => l.startsWith('front:')),
    title: t.title.slice(0, 100), created: c.date, ageMethod: c.method, ageDays: days(c.date) });
}

// ---- the hand codes: locate, date, and cross-check against the candidates
const codes = JSON.parse(readFileSync(codesPath, 'utf8'));
const problems = [];
for (const it of codes.items) {
  const src = show(it.repo, it.path);
  if (src === null && !it.dir) { problems.push(`${it.id}: ${it.repo}:${it.path} missing at HEAD`); continue; }
  if (it.dir) { if (!files(it.repo).some((f) => f.startsWith(it.path + '/') || f === it.path)) problems.push(`${it.id}: ${it.path} missing`); }
  else {
    const ln = src.split('\n').findIndex((l) => l.includes(it.token));
    if (ln < 0) { problems.push(`${it.id}: token '${it.token}' not in ${it.path}`); continue; }
    it.line = ln + 1;
  }
  const intro = introduced(it.repo, it.token || it.path, it.dir || it.tokenAnywhere ? null : it.path)
    || (it.dir ? (() => { const l = git(it.repo, ['log', REV, '--first-parent', '--diff-merges=first-parent', '--format=%h\t%cs\t%s', '--reverse', '--', it.path]).trim().split('\n')[0]; const [sha, date, s] = l.split('\t'); return { sha, date, subject: s.slice(0, 120), ageDays: days(date) }; })() : null);
  if (!intro) { problems.push(`${it.id}: no introducing commit found`); continue; }
  Object.assign(it, { introducedSha: intro.sha, introducedDate: intro.date, introducedSubject: intro.subject, ageDays: intro.ageDays });
}
const covered = (repo, key) => codes.items.some((i) => i.repo === repo && (i.flag === key || (i.alsoFlags || []).includes(key) || i.path === key || (i.alsoPaths || []).includes(key)))
  || (codes.excluded || []).some((e) => e.repo === repo && (e.flag === key || e.path === key || (e.flags || []).includes(key) || (e.paths || []).includes(key)));
const flagTagged = flagCands.filter((f) => f.bool || f.rollback);
const uncovered = [
  ...flagTagged.filter((f) => !covered(f.repo, f.name)).map((f) => `flag ${f.repo}:${f.name} (${f.path}:${f.line}, ${f.bool || ''}${f.rollback ? ' rollback-tagged' : ''})`),
  ...dualCands.filter((d) => !covered(d.repo, d.path)).map((d) => `dual ${d.repo}:${d.path} (${d.hits} hits at ${d.lines.join(',')})`),
  ...expCands.filter((e) => !covered(e.repo, e.path)).map((e) => `experiment ${e.repo}:${e.path} ${e.status || ''}`),
];
const tuning = flagCands.filter((f) => !f.bool && !f.rollback && !covered(f.repo, f.name));

// ---- summary: count and age per class and repo
const all = [...codes.items.filter((i) => i.ageDays != null).map((i) => ({ class: i.class, repo: i.repo, ageDays: i.ageDays })), ...followUps];
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const summary = [];
for (const cls of ['flag', 'dual-path', 'experiment', 'follow-up', 'review-residue']) for (const repo of ['LinearViewer', 'simple-dispatcher', 'both']) {
  const a = all.filter((x) => x.class === cls && (repo === 'both' || x.repo === repo)).map((x) => x.ageDays);
  summary.push({ class: cls, repo, n: a.length, medianAge: med(a), oldest: a.length ? Math.max(...a) : null, over30: a.length ? Math.round((100 * a.filter((x) => x > 30).length) / a.length) : null });
}
const bySub = {};
for (const i of codes.items) { const k = `${i.class}/${i.subtype || '-'}/${i.repo}`; bySub[k] = (bySub[k] || 0) + 1; }

console.log('class\trepo\tn\tmedian age (d)\toldest (d)\t% older than 30 d');
for (const s of summary) console.log([s.class, s.repo, s.n, s.medianAge ?? '-', s.oldest ?? '-', s.over30 ?? '-'].join('\t'));
console.log('\nsubtypes (coded items):'); for (const [k, v] of Object.entries(bySub).sort()) console.log(`  ${k}\t${v}`);
console.log(`\nTODO/FIXME/XXX naming a ticket in process code: LinearViewer ${todos.LinearViewer || 0}, simple-dispatcher ${todos['simple-dispatcher'] || 0}`);
console.log(`tuning knobs (env, no switch or rollback meaning): ${tuning.length} (LinearViewer ${tuning.filter((t) => t.repo === 'LinearViewer').length}, simple-dispatcher ${tuning.filter((t) => t.repo === 'simple-dispatcher').length})`);
console.log(`process files scanned: LinearViewer ${proc.LinearViewer.length}, simple-dispatcher ${proc['simple-dispatcher'].length}; candidates: flags ${flagTagged.length}, dual-path files ${dualCands.length}, experiments ${expCands.length}`);
const fuOrig = followUps.filter((f) => f.origin).length;
console.log(`open process follow-ups: ${followUps.filter((f) => f.class === 'follow-up').length} follow-up + ${followUps.filter((f) => f.class === 'review-residue').length} review-residue; ${fuOrig} name an origin; ages by createdAt ${followUps.filter((f) => f.ageMethod === 'createdAt').length}, interpolated ${followUps.filter((f) => f.ageMethod === 'interpolated').length}`);
if (problems.length) { console.log('\nPROBLEMS:'); problems.forEach((p) => console.log('  ' + p)); }
if (uncovered.length) { console.log('\nUNCOVERED candidates (neither coded nor excluded):'); uncovered.forEach((u) => console.log('  ' + u)); }

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ at: AT.toISOString().slice(0, 10), heads: { LinearViewer: git('LinearViewer', ['rev-parse', '--short=8', REV]).trim(), 'simple-dispatcher': git('simple-dispatcher', ['rev-parse', '--short=8', REV]).trim() },
  summary, bySub, todos, tuning, items: codes.items, followUps, candidates: { flags: flagCands, dual: dualCands, experiments: expCands }, uncovered, problems }, null, 2));
if (writeBack) writeFileSync(codesPath, JSON.stringify(codes, null, 2) + '\n');
