// LIN-3182: accretion — of the process changes merged June–September in both repos, how many added a step, rule or wake and how many removed one (a seeded, stratified, hand-coded sample), and which stated a condition for retiring what they added (a full-population language scan, every hit hand-verified).
// Usage: node scripts/survey-landing-accretion.mjs [--sd ../simple-dispatcher] [--scorecard data/survey/scorecard.json] [--tracker data/survey/reliability-tracker.json]
//        [--codes docs/papers/harbour/how-process-changes-land-accretion.json] [--out data/survey/landing-accretion.json] [--list]
// Population: the scorecard's changes (scripts/survey-scorecard.mjs) whose first-parent merges on origin/main touched process code, a merge mapped to its
// ticket by the first LIN-id in its subject, as the scorecard maps it. Process code is Harbour's 'prompt text' and 'dispatch + fleet' areas
// (scripts/survey-growth-git.mjs) plus the scorecard's reading-load paths; in simple-dispatcher every production .js at the root (not e2e-*), CLAUDE.md, README.md and docs/.
// --list prints the drawn sample with each change's process files, for coding. No proxy calls.
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { GROUPS } from './steady-base-growth.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sdDir = resolve(arg('--sd', '../simple-dispatcher'));
const scorecard = read(arg('--scorecard', 'data/survey/scorecard.json'));
const tracker = read(arg('--tracker', 'data/survey/reliability-tracker.json'));
const codesPath = arg('--codes', 'docs/papers/harbour/how-process-changes-land-accretion.json');
const codes = existsSync(codesPath) ? read(codesPath) : null;
const out = arg('--out', 'data/survey/landing-accretion.json');
const SEED = 3182;
const SAMPLE = 80;
const SD_MIN = 15;

// ---- Process code ------------------------------------------------------------------------------------------------------
const LV_AREAS = [
  /^lib\/(prompts\/|prompt-(templates|template-defs|formatters)\.js$|proxy-(instructions|preamble)\.js$)/,
  /^lib\/(dispatch|autopilot|passage|observation|observer|wake|loop|harbour-spawn|agent-|completion-signals|follow-on|recommend|next-run|runner-kit|periodical|stack|ruling|escalation|budget|halt|pipeline-|plan-review|task-(decisions|snapshot)|unanswered|dismissal|digest-feedback|terminal-marked|effort|transcript-spend|live-console)/,
];
const LV_READING = [...Object.values(GROUPS).flat(), 'lib/prompts/', 'docs/architecture/', 'lib/proxy-preamble.js'];
const isProcess = {
  LinearViewer: (p) => LV_AREAS.some((r) => r.test(p)) || LV_READING.some((q) => (q.endsWith('/') ? p.startsWith(q) : p === q)),
  'simple-dispatcher': (p) => (/^[^/]+\.js$/.test(p) && !/^e2e-/.test(p)) || ['CLAUDE.md', 'README.md'].includes(p) || p.startsWith('docs/'),
};
const DIRS = { LinearViewer: resolve('.'), 'simple-dispatcher': sdDir };
const HEADS = scorecard.heads; // read git at the scorecard's heads, so the population does not move as main does

// ---- Population: first-parent merges since June, mapped to a ticket, that touched process code ---------------------------
const changeById = new Map(scorecard.changes.map((c) => [c.id, c]));
const touched = new Map(); // id -> { LinearViewer: {shas, files}, 'simple-dispatcher': {...} }
for (const [repo, dir] of Object.entries(DIRS)) {
  const raw = execFileSync('git', ['-C', dir, 'log', HEADS[repo], '--first-parent', '-m', '--since=2026-06-01', '--numstat', '--format=%x00%H%x09%cI%x09%s'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const seen = new Set();
  for (const chunk of raw.split('\x00').filter(Boolean)) {
    const [head, ...lines] = chunk.split('\n').filter(Boolean);
    const [sha, , subject] = head.split('\t');
    if (seen.has(sha)) continue; seen.add(sha);
    const id = (subject.match(/\blin-\d+\b/i) || [])[0]?.toUpperCase();
    if (!id || !changeById.has(id) || changeById.get(id).lastMerge >= '2026-10') continue;
    const files = lines.map((l) => l.split('\t')).filter(([a, , p]) => a !== '-' && p && isProcess[repo](p)).map(([a, d, p]) => ({ p, a: +a, d: +d }));
    if (!files.length) continue;
    const t = touched.get(id) || {}; const r = (t[repo] ||= { shas: [], files: [] });
    r.shas.push(sha.slice(0, 8)); r.files.push(...files); touched.set(id, t);
  }
}
const repoOf = (t) => (t.LinearViewer && t['simple-dispatcher'] ? 'both' : t.LinearViewer ? 'LinearViewer' : 'simple-dispatcher');
const monthOf = (id) => changeById.get(id).lastMerge.slice(0, 7);
const population = [...touched.entries()].map(([id, t]) => ({ id, repo: repoOf(t), month: monthOf(id), touched: t })).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
const months = [...new Set(population.map((p) => p.month))].sort();
const repos = ['LinearViewer', 'simple-dispatcher', 'both'];
const count = (xs, f) => xs.filter(f).length;

// ---- Seeded, stratified sample: strata are repo side (Harbour only; touches simple-dispatcher) x month ----------------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(SEED);
const side = (p) => (p.repo === 'LinearViewer' ? 'LV' : 'SD');
const allocate = (n, groups) => { // largest remainder, proportional to group sizes
  const tot = groups.reduce((a, g) => a + g.size, 0);
  const raw = groups.map((g) => ({ ...g, q: (n * g.size) / tot }));
  raw.forEach((g) => { g.n = Math.floor(g.q); });
  let left = n - raw.reduce((a, g) => a + g.n, 0);
  [...raw].sort((a, b) => (b.q - b.n) - (a.q - a.n) || a.key.localeCompare(b.key)).forEach((g) => { if (left > 0) { g.n++; left--; } });
  return Object.fromEntries(raw.map((g) => [g.key, g.n]));
};
const sdSize = count(population, (p) => side(p) === 'SD');
const sdN = Math.max(SD_MIN, Math.round((SAMPLE * sdSize) / population.length));
const sample = [];
for (const [s, n] of [['LV', SAMPLE - sdN], ['SD', sdN]]) {
  const per = allocate(n, months.map((m) => ({ key: m, size: count(population, (p) => side(p) === s && p.month === m) })));
  for (const m of months) {
    const pool = population.filter((p) => side(p) === s && p.month === m).map((p) => p.id);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (const id of pool.slice(0, per[m])) sample.push({ id, stratum: `${s} ${m}`, weight: count(population, (p) => side(p) === s && p.month === m) / per[m] });
  }
}

if (argv.includes('--list')) {
  for (const s of sample) {
    const p = population.find((x) => x.id === s.id); const t = listTicket(s.id);
    console.log(`\n## ${s.id} [${s.stratum}] ${p.repo} — ${t?.title || '?'}`);
    for (const [repo, r] of Object.entries(p.touched)) console.log(`  ${repo} ${r.shas.join(',')}: ${r.files.map((f) => `${f.p} +${f.a}/-${f.d}`).join('; ')}`);
  }
  process.exit(0);
}
function listTicket(id) { return tracker.list.find((t) => t.identifier === id); }

// ---- Retirement language: every population ticket's description and every process commit message --------------------
// 'expired'/'expiry' are left out: in this codebase they name token, TTL and cache lifetimes. Only 'expire(s) on/after/when/once',
// the form a sunset clause takes, is kept.
const RETIRE = /\b(retire[sd]?|retiring|retirement|sunset|temporar(y|ily)|stop-?gap|interim|remove (it |this |them )?(once|when|after)|delete (it |this )?(once|when|after)|drop (it |this )?(once|when|after)|until [^.\n]{0,80}\bthen\b|expires? (on|after|when|once)|kill[- ]switch|roll ?back after|transitional|phase[- ]out|deprecat(e|ed|ion))\b/gi;
const hits = [];
const snippet = (s, i) => s.slice(Math.max(0, i - 90), i + 110).replace(/\s+/g, ' ').trim();
for (const p of population) {
  const d = listTicket(p.id)?.description || '';
  for (const m of d.matchAll(RETIRE)) hits.push({ key: `${p.id}:desc:${m[0].toLowerCase()}:${m.index}`, id: p.id, source: 'ticket', text: snippet(d, m.index) });
}
for (const [repo, dir] of Object.entries(DIRS)) {
  // Every commit (any parent) since June that names a population ticket and touched process code.
  const raw = execFileSync('git', ['-C', dir, 'log', HEADS[repo], '--since=2026-06-01', '--no-merges', '--name-only', '--format=%x00%H%x1f%B%x1f'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  for (const chunk of raw.split('\x00').filter(Boolean)) {
    const [sha, body, files] = chunk.split('\x1f');
    if (!files.split('\n').some((f) => f && isProcess[repo](f.trim()))) continue;
    const id = (body.match(/\blin-\d+\b/i) || [])[0]?.toUpperCase();
    if (!id || !touched.has(id)) continue;
    for (const m of body.matchAll(RETIRE)) hits.push({ key: `${repo}:${sha.slice(0, 8)}:${m[0].toLowerCase()}:${m.index}`, id, source: `commit ${repo} ${sha.slice(0, 8)}`, text: snippet(body, m.index) });
  }
}

// ---- Tallies ------------------------------------------------------------------------------------------------------------
const wilson = (k, n, z = 1.96) => { if (!n) return [0, 0]; const p = k / n; const den = 1 + z * z / n; const c = (p + z * z / (2 * n)) / den; const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den; return [Math.max(0, c - h), Math.min(1, c + h)]; };
const pct = (x) => `${(100 * x).toFixed(0)}%`;
const result = { seed: SEED, population: { total: population.length, byRepo: {}, byMonth: {} }, sample: sample.map((s) => s.id) };
for (const r of repos) result.population.byRepo[r] = count(population, (p) => p.repo === r);
for (const m of months) result.population.byMonth[m] = Object.fromEntries(repos.map((r) => [r, count(population, (p) => p.repo === r && p.month === m)]));

console.log(`Population: ${population.length} process changes merged ${months[0]}..${months.at(-1)} (scorecard cut ${scorecard.cut}; heads LV ${scorecard.heads.LinearViewer}, SD ${scorecard.heads['simple-dispatcher']}).`);
console.log('month    ' + repos.map((r) => r.padStart(18)).join(''));
for (const m of months) console.log(m + '  ' + repos.map((r) => String(result.population.byMonth[m][r]).padStart(18)).join(''));
console.log(`Sample: ${sample.length} (seed ${SEED}; ${sdN} touching simple-dispatcher, ${SAMPLE - sdN} Harbour only).`);

if (!codes) { console.log('No codes file yet; run with --list to code the sample.'); process.exit(0); }

// Codes must cover exactly the drawn sample.
const coded = new Map(codes.sample.map((c) => [c.id, c]));
const missing = sample.filter((s) => !coded.has(s.id)).map((s) => s.id);
const extra = codes.sample.filter((c) => !sample.some((s) => s.id === c.id)).map((c) => c.id);
if (missing.length || extra.length) { console.error(`Codes do not match the drawn sample. Missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`); process.exit(1); }

const ADDS = new Set(['adds-step', 'adds-rule', 'adds-wake']);
const REMOVES = new Set(['removes-step', 'removes-rule', 'removes-wake']);
const cls = (e) => (e === 'both' ? 'both' : ADDS.has(e) ? 'adds' : REMOVES.has(e) ? 'removes' : 'neither');
const rows = sample.map((s) => ({ ...s, ...coded.get(s.id), cls: cls(coded.get(s.id).effect) }));
const tally = (xs, label) => {
  const n = xs.length; const w = xs.reduce((a, x) => a + x.weight, 0);
  const parts = ['adds', 'removes', 'both', 'neither'].map((c) => {
    const k = count(xs, (x) => x.cls === c); const est = xs.filter((x) => x.cls === c).reduce((a, x) => a + x.weight, 0);
    const [lo, hi] = wilson(k, n);
    return `${c} ${k}/${n} (≈${Math.round(est)} of ${Math.round(w)}, 95% ${Math.round(lo * w)}–${Math.round(hi * w)})`;
  });
  console.log(`  ${label.padEnd(22)} ${parts.join('; ')}`);
  return Object.fromEntries(['adds', 'removes', 'both', 'neither'].map((c) => [c, count(xs, (x) => x.cls === c)]));
};
console.log('\nSample tallies (count in sample; population estimate by stratum weight; Wilson interval scaled to the stratum population):');
result.tallies = { all: tally(rows, 'all') };
for (const s of ['LV', 'SD']) result.tallies[s] = tally(rows.filter((r) => r.stratum.startsWith(s)), s === 'LV' ? 'Harbour only' : 'touches SD');
for (const m of months) result.tallies[m] = tally(rows.filter((r) => r.stratum.endsWith(m)), m);
const addsAny = count(rows, (r) => r.cls === 'adds' || r.cls === 'both'); const remAny = count(rows, (r) => r.cls === 'removes' || r.cls === 'both');
console.log(`  added at least one step, rule or wake: ${addsAny}/${rows.length} (${pct(addsAny / rows.length)}); removed at least one: ${remAny}/${rows.length} (${pct(remAny / rows.length)}); ratio ${(addsAny / Math.max(1, remAny)).toFixed(1)} : 1`);
const byKind = {}; for (const r of rows) byKind[r.effect] = (byKind[r.effect] || 0) + 1;
console.log('  by effect: ' + Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
result.byEffect = byKind;
const withRetire = rows.filter((r) => r.retirementCondition);
console.log(`  sample changes stating a retirement condition: ${withRetire.length}/${rows.length}${withRetire.length ? ' — ' + withRetire.map((r) => `${r.id}: "${r.retirementCondition}"`).join(' | ') : ''}`);

// Retirement scan: every hit must carry a hand verdict.
const verdicts = new Map((codes.retirementScan || []).map((v) => [v.key, v]));
const unverdicted = hits.filter((h) => !verdicts.has(h.key));
if (unverdicted.length) { console.error(`\n${unverdicted.length} retirement-language hits have no verdict:`); for (const h of unverdicted) console.error(JSON.stringify(h)); process.exit(1); }
const real = hits.filter((h) => verdicts.get(h.key).verdict === 'retirement-condition');
const realIds = [...new Set(real.map((h) => h.id))];
console.log(`\nRetirement-language scan over all ${population.length} population tickets and their process commits: ${hits.length} hits; ${real.length} hand-verified as a condition for retiring what the change added, on ${realIds.length} ticket(s)${realIds.length ? ': ' + realIds.join(', ') : ''}.`);
for (const h of real) console.log(`  ${h.id} (${h.source}): "${h.text}"`);
for (const f of codes.retirementFate || []) console.log(`  fate, ${f.id}: ${f.met} — ${f.fate}`);
const otherV = {}; for (const h of hits) { const v = verdicts.get(h.key).verdict; otherV[v] = (otherV[v] || 0) + 1; }
console.log('  verdicts: ' + Object.entries(otherV).map(([k, v]) => `${k} ${v}`).join(', '));
result.retirement = { hits: hits.length, real: real.length, tickets: realIds, verdicts: otherV };

// Cross-check: the scorecard's process-weight census (net reading-load lines per change), by repo side and month.
console.log('\nCross-check, reading-load lines (scorecard processAdd vs processDel, all changes since June):');
const cw = {};
for (const c of scorecard.changes) {
  const m = c.lastMerge.slice(0, 7); const r = c.repos.length > 1 ? 'both' : c.repos[0];
  const k = `${r} ${m}`; const o = (cw[k] ||= { up: 0, down: 0 });
  if (c.processAdd > c.processDel) o.up++; else if (c.processDel > c.processAdd) o.down++;
}
for (const r of repos) console.log(`  ${r.padEnd(18)} ` + months.map((m) => `${m} up ${cw[`${r} ${m}`]?.up || 0} / down ${cw[`${r} ${m}`]?.down || 0}`).join('; '));
const up = Object.values(cw).reduce((a, o) => a + o.up, 0); const down = Object.values(cw).reduce((a, o) => a + o.down, 0);
console.log(`  total: ${up} changes net-added reading-load lines, ${down} net-removed.`);
result.readingLoad = { up, down, byRepoMonth: cw };

// Agreement with the blind second reader (how-process-changes-land-accretion-second.json), on the eight effects and on
// three classes (added something / removed something, including both / neither), as raw agreement and Cohen's kappa.
const secondPath = arg('--second', 'docs/papers/harbour/how-process-changes-land-accretion-second.json');
if (codes && existsSync(secondPath)) {
  const second = new Map(read(secondPath).codes.map((c) => [c.id, c.effect]));
  const three = (e) => (e === 'neither' ? 'neither' : e.startsWith('adds') ? 'adds' : 'removes or both');
  const kappa = (pairs) => {
    const n = pairs.length; const agree = pairs.filter(([a, b]) => a === b).length / n;
    const cats = [...new Set(pairs.flat())];
    const pe = cats.reduce((s, k) => s + (pairs.filter(([a]) => a === k).length / n) * (pairs.filter(([, b]) => b === k).length / n), 0);
    return { n, agree: Math.round(agree * 1000) / 10, kappa: Math.round(((agree - pe) / (1 - pe)) * 100) / 100 };
  };
  const pairs = codes.sample.filter((c) => second.has(c.id)).map((c) => [c.effect, second.get(c.id)]);
  result.agreement = { eight: kappa(pairs), three: kappa(pairs.map(([a, b]) => [three(a), three(b)])),
    disagreements: codes.sample.filter((c) => second.has(c.id) && c.effect !== second.get(c.id)).map((c) => `${c.id}: ${c.effect} / ${second.get(c.id)}`) };
  console.log(`\nBlind second reader: ${pairs.length} coded; eight effects ${result.agreement.eight.agree}% agree, kappa ${result.agreement.eight.kappa}; three classes ${result.agreement.three.agree}%, kappa ${result.agreement.three.kappa}`);
  console.log('  disagreements:', result.agreement.disagreements.join('; '));
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ ...result, rows: rows.map(({ touched, ...r }) => r), hits }, null, 1));
console.log(`\nWrote ${out}`);
