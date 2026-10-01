// LIN-3151: join the test-estate datasets — shape and timing, CI failures, local session failures, mutants and friction — by test class, print the paper's numbers and write data/survey-tests/analysis.json.
// Usage: node scripts/survey-tests-analyse.mjs [--dir data/survey-tests]   (run survey-tests-shape, -timing, -ci-*, -local, -mutate and -friction-* first)
// A failing or killing test joins to its class by (repo, file, name); a name the classifier did not see takes its file's commonest class; an e2e spec is e2e.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-tests');
const load = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null);
const CLASSES = ['behavioural', 'text pin', 'census', 'source scan', 'e2e'];
const REPO = { LinearViewer: 'lv', 'simple-dispatcher': 'sd', lv: 'lv', sd: 'sd' };

const shape = load('shape.json');
const byName = new Map(), byFile = new Map();
for (const t of shape.tests) {
  byName.set(`${t.repo}:${t.file}:${t.name}`, t.rcls);
  const c = byFile.get(`${t.repo}:${t.file}`) || {}; c[t.rcls] = (c[t.rcls] || 0) + 1; byFile.set(`${t.repo}:${t.file}`, c);
}
function classOf(repo, file, name) {
  const rel = file.replace(/^.*?\/(tests?\/)/, '$1');
  if (/^tests\/(e2e|visual)\/|^test\/system\//.test(rel)) return 'e2e';
  const hit = byName.get(`${repo}:${rel}:${name}`);
  if (hit) return hit;
  const counts = byFile.get(`${repo}:${rel}`);
  return counts ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : 'unknown';
}
const tally = () => Object.fromEntries([...CLASSES, 'unknown'].map((c) => [c, {}]));
const bump = (t, c, k, n = 1) => { t[c][k] = (t[c][k] || 0) + n; };

const A = { shape: shape.summary, validation: null };

// Timing: serial per-file wall-clock, how much of it is test work, and where it concentrates.
A.timing = {};
for (const repo of ['lv', 'sd']) {
  const rows = load(`${repo}-perfile.json`).rows;
  const wall = rows.reduce((s, r) => s + r.wallMs, 0), work = rows.reduce((s, r) => s + r.testMs, 0);
  const sorted = [...rows].sort((a, b) => b.wallMs - a.wallMs);
  const share = (n) => Math.round((100 * sorted.slice(0, n).reduce((s, r) => s + r.wallMs, 0)) / wall);
  const idle = rows.filter((r) => r.wallMs > 20_000 && r.testMs < 1_000);
  A.timing[repo] = {
    files: rows.length, serialS: Math.round(wall / 1000), testWorkS: Math.round(work / 1000), top5: share(5), top10: share(10), top20: share(20),
    idleFiles: idle.map((r) => ({ file: r.file, wallMs: r.wallMs, testMs: r.testMs })), idleS: Math.round(idle.reduce((s, r) => s + r.wallMs - r.testMs, 0) / 1000),
    slowest: sorted.slice(0, 20).map((r) => ({ file: r.file, wallMs: r.wallMs, testMs: r.testMs, classes: byFile.get(`${repo}:${r.file}`) || {} })),
  };
}

// CI: each failed attempt counted once per class among its failing tests; attempts with no test names (expired logs, non-test steps) by job.
const ci = load('ci-failures.json');
A.ci = { pr: tally(), push: tally(), attempts: { pr: 0, push: 0 }, byRepo: {} };
for (const r of ci.rows) {
  const ev = r.event === 'pull_request' ? 'pr' : 'push';
  const repo = REPO[r.repo];
  A.ci.attempts[ev]++;
  A.ci.byRepo[repo] = A.ci.byRepo[repo] || {}; A.ci.byRepo[repo][r.class] = (A.ci.byRepo[repo][r.class] || 0) + 1;
  let classes = [...new Set(r.tests.map((t) => classOf(repo, t.file, t.title)))];
  if (!classes.length) classes = [r.failingJobs.some((j) => /E2E/.test(j)) ? 'e2e' : 'unknown'];
  for (const c of classes) bump(A.ci[ev], c, r.class);
}

// Local sessions: failure episodes inside agent sessions before any push.
const local = load('local-failures.json');
if (local) {
  A.local = { episodes: tally(), byRepo: {} };
  for (const e of local.episodes || local.rows || local) {
    const repo = REPO[e.repo] || e.repo;
    bump(A.local.episodes, classOf(repo, e.file || '', e.name || e.test || ''), e.class);
    A.local.byRepo[repo] = A.local.byRepo[repo] || {}; A.local.byRepo[repo][e.class] = (A.local.byRepo[repo][e.class] || 0) + 1;
  }
}

// Mutants: which classes kill each mutant, and which mutants only one class kills.
A.mutants = {};
// lv-prose is the prose-only draw (survey-tests-mutate.mjs --prose-only), kept apart from the mixed lv draw.
for (const key of ['lv', 'lv-prose', 'sd']) {
  const repo = key.slice(0, 2);
  const m = load(`mutants-${key}.json`);
  if (!m) continue;
  // A failing test's enclosing describe() fails with it; per file, only the deepest failures are the killers.
  const leaves = (killers) => {
    const parsed = killers.map((k) => { const [file, nesting, name] = k.split('::'); return { file, nesting: Number(nesting), name }; });
    const deepest = {}; for (const k of parsed) deepest[k.file] = Math.max(deepest[k.file] ?? -1, k.nesting);
    return parsed.filter((k) => k.nesting === deepest[k.file]);
  };
  const rows = m.results.filter((r) => r.outcome !== 'not applied').map((r) => {
    const classes = [...new Set(leaves(r.killers || []).map((k) => classOf(repo, k.file, k.name)))];
    return { file: r.file, line: r.line, name: r.name, kind: r.kind, before: r.before, after: r.after, killed: r.outcome === 'killed', killerFiles: [...new Set((r.killers || []).map((k) => k.split('::')[0]))].length, classes };
  });
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, { kills: rows.filter((r) => r.classes.includes(c)).length, only: rows.filter((r) => r.classes.length === 1 && r.classes[0] === c).length }]));
  const byKind = {};
  for (const r of rows) { const k = (byKind[r.kind] ||= { n: 0, killed: 0, byClass: {} }); k.n++; if (r.killed) k.killed++; for (const c of r.classes) k.byClass[c] = (k.byClass[c] || 0) + 1; }
  A.mutants[key] = { applied: rows.length, notApplied: m.results.length - rows.length, killed: rows.filter((r) => r.killed).length, byClass, byKind, rows };
}

// Friction, as survey-tests-friction-*.mjs summarised it.
const fr = load('friction.json');
if (fr) A.friction = { summary: fr.summary, tickets: { population: fr.tickets.population, counts: fr.tickets.counts } };

writeFileSync(join(dir, 'analysis.json'), JSON.stringify(A, null, 1));

const pct = (a, b) => `${Math.round((100 * a) / b)}%`;
for (const repo of ['lv', 'sd']) {
  const t = A.timing[repo];
  console.log(`\n[${repo}] timing: ${t.files} files, ${t.serialS} s serial, ${t.testWorkS} s inside tests (${pct(t.testWorkS, t.serialS)}); top 5 files ${t.top5}%, top 10 ${t.top10}%, top 20 ${t.top20}%; ${t.idleFiles.length} files idle ${t.idleS} s after their tests`);
  for (const [c, v] of Object.entries(A.shape[repo].byClass)) if (v.tests) console.log(`  ${c.padEnd(12)} ${String(v.tests).padStart(6)} tests ${String(v.lines).padStart(7)} lines ${String(v.asserts).padStart(6)} asserts ${(v.ms / 1000).toFixed(1).padStart(6)} s`);
}
for (const ev of ['pr', 'push']) {
  console.log(`\nCI failed attempts on ${ev} (${A.ci.attempts[ev]}), by failing test class × cause:`);
  for (const [c, v] of Object.entries(A.ci[ev])) if (Object.keys(v).length) console.log(`  ${c.padEnd(12)} ${JSON.stringify(v)}`);
}
console.log('\nCI by repo:', JSON.stringify(A.ci.byRepo));
if (A.local) {
  console.log('\nLocal failure episodes by class × cause:');
  for (const [c, v] of Object.entries(A.local.episodes)) if (Object.keys(v).length) console.log(`  ${c.padEnd(12)} ${JSON.stringify(v)}`);
  console.log('by repo:', JSON.stringify(A.local.byRepo));
}
for (const [repo, m] of Object.entries(A.mutants)) {
  console.log(`\n[${repo}] mutants: ${m.killed}/${m.applied} killed by the unit suite (${m.notApplied} no longer apply)`);
  console.log('  by kind:', JSON.stringify(m.byKind));
  console.log('  by class (kills / only killer):', JSON.stringify(m.byClass));
}
