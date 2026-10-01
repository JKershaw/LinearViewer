// LIN-3151: classify every cached failed CI attempt by what made the branch green next (flaky / fault / pin bump / doc-prompt / test updated / infra / unresolved).
// Usage: node scripts/survey-tests-ci-classify.mjs [runs=data/survey-tests/ci-runs.json] [--detail data/survey-tests/ci-detail] [--out data/survey-tests/ci-failures.json] [--lv ../LinearViewer] [--sd ../simple-dispatcher]
// Reads only the caches from survey-tests-ci-runs.mjs and survey-tests-ci-fetch.mjs plus local git (a missing sha is fetched by id; the compare API is the last resort).
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname, normalize } from 'path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const detailDir = arg('--detail', 'data/survey-tests/ci-detail');
const outPath = arg('--out', 'data/survey-tests/ci-failures.json');
const REPO_DIRS = { LinearViewer: arg('--lv', '.'), 'simple-dispatcher': arg('--sd', '../simple-dispatcher') };
const snapshot = JSON.parse(readFileSync(argv[0] || 'data/survey-tests/ci-runs.json', 'utf8'));

// Steps that run tests (same rule as survey-tests-ci-fetch.mjs); anything else failing is infra.
const isTestStep = (step) => /^(Run unit tests|Run E2E tests|Unit tests)/.test(step);

const git = (repo, args, opts = {}) => execFileSync('git', ['-C', REPO_DIRS[repo], ...args], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'], ...opts });
const tryGit = (repo, args) => { try { return git(repo, args); } catch { return null; } };

const haveSha = new Map();
function ensureSha(repo, sha) {
  const k = `${repo}:${sha}`;
  if (!haveSha.has(k)) {
    let ok = tryGit(repo, ['cat-file', '-e', `${sha}^{commit}`]) !== null;
    if (!ok) { tryGit(repo, ['fetch', '-q', 'origin', sha]); ok = tryGit(repo, ['cat-file', '-e', `${sha}^{commit}`]) !== null; }
    haveSha.set(k, ok);
  }
  return haveSha.get(k);
}

// File kinds. Prompt sources are .js in LinearViewer but are prose, so they count with docs.
export function fileKind(repo, f) {
  // routes/test.js is LinearViewer's E2E-only fixture route (mounted only under NODE_ENV=test), so it is test support.
  if (/(^|\/)tests?\//.test(f) || /\.(test|spec)\.m?js$/.test(f) || (repo === 'LinearViewer' && f === 'routes/test.js')) return 'test';
  if (/^\.github\//.test(f)) return 'ci';
  if (/(^|\/)package(-lock)?\.json$/.test(f)) return 'deps';
  if (/\.(md|txt)$/.test(f) || /^(docs|plans|content)\//.test(f)) return 'doc';
  if (repo === 'LinearViewer' && /^lib\/(prompts\/|prompt-templates?\.js|prompt-template-defs\.js)/.test(f)) return 'prompt';
  if (/^(scripts|prototypes|experiments|deploy)\//.test(f) || /^[^/]+\.(sh|mjs)$/.test(f) || /\.config\.js$/.test(f)) return 'tooling';
  if (/\.(png|jpe?g|svg|woff2?|json)$/.test(f) && /^docs\//.test(f)) return 'doc';
  return 'prod';
}

// Main's first-parent chain: a branch's own commits are those reached walking first parents from its head before hitting this chain.
const mainChain = {};
for (const repo of Object.keys(REPO_DIRS)) mainChain[repo] = new Set(git(repo, ['rev-list', '--first-parent', 'origin/main']).trim().split('\n'));

function ownCommits(repo, head) {
  const out = []; let merges = 0; let sha = head;
  for (let n = 0; n < 400 && sha && !mainChain[repo].has(sha); n++) {
    const [h, parents, date, subject] = git(repo, ['log', '-1', '--format=%H%x09%P%x09%aI%x09%s', sha]).trim().split('\t');
    const ps = parents.split(' ').filter(Boolean);
    if (ps.length > 1) merges++; else out.push({ sha: h, key: `${date} ${subject}` });
    sha = ps[0];
  }
  return { commits: out, merges };
}

function numstat(repo, args) {
  const txt = git(repo, ['diff', '--numstat', '--no-renames', ...args]).trim();
  return txt ? txt.split('\n').map((l) => { const [a, d, f] = l.split('\t'); return { file: f, add: Number(a) || 0, del: Number(d) || 0 }; }) : [];
}

// Files changed by the fix: for push-to-main, A..B on main; for a branch, the branch's own non-merge commits new since A (rebases matched by author date + subject).
function fixDiff(repo, event, a, b) {
  if (!ensureSha(repo, a) || !ensureSha(repo, b)) {
    const files = JSON.parse(execFileSync('gh', ['api', `repos/JKershaw/${repo}/compare/${a}...${b}`, '--jq', '[.files[] | {file: .filename, add: .additions, del: .deletions}]'], { encoding: 'utf8' }));
    return { method: 'compare-api', files, commits: null, mergedMain: null };
  }
  if (event === 'push') return { method: 'git-diff', files: numstat(repo, [a, b]), commits: git(repo, ['rev-list', '--count', `${a}..${b}`]).trim() * 1, mergedMain: false };
  const ownA = ownCommits(repo, a); const ownB = ownCommits(repo, b);
  const seen = new Set(ownA.commits.flatMap((c) => [c.sha, c.key]));
  const fresh = ownB.commits.filter((c) => !seen.has(c.sha) && !seen.has(c.key));
  const agg = new Map();
  for (const c of fresh) for (const r of numstat(repo, [`${c.sha}^`, c.sha])) {
    const p = agg.get(r.file) || { file: r.file, add: 0, del: 0 }; p.add += r.add; p.del += r.del; agg.set(r.file, p);
  }
  return { method: 'own-commits', files: [...agg.values()], commits: fresh.length, mergedMain: ownB.merges > ownA.merges, fixShas: fresh.map((c) => c.sha.slice(0, 10)) };
}

// Literal-only edit: removed and added lines are the same multiset once string/number/regex literals are masked.
const norm = (l) => l.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, 'S')
  .replace(/(?<![\w)\]])\/(?![/*])(?:[^/\\\n]|\\.)+\/[dgimsuy]*/g, 'R').replace(/\b\d+(\.\d+)?\b/g, 'N').replace(/\s+/g, ' ').trim();
function literalOnly(repo, a, b, file) {
  const d = tryGit(repo, ['diff', '-U0', a, b, '--', file]);
  if (!d) return null;
  const rem = []; const add = [];
  for (const l of d.split('\n')) {
    if (/^(---|\+\+\+) /.test(l)) continue;
    if (l.startsWith('-')) rem.push(norm(l.slice(1))); else if (l.startsWith('+')) add.push(norm(l.slice(1)));
  }
  const clean = (xs) => xs.filter((x) => x && !/^\/\//.test(x)).sort().join('\n');
  return rem.length + add.length > 0 && clean(rem) === clean(add);
}

// Relative imports of a test file at sha (direct only).
function importsOf(repo, sha, file) {
  const src = tryGit(repo, ['show', `${sha}:${file}`]);
  if (!src) return [];
  const specs = [...src.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);
  return specs.map((s) => normalize(join(dirname(file), s)).replace(/(\.m?js)?$/, (x) => x || '.js'));
}

const runsByRepo = Object.fromEntries(Object.entries(snapshot.repos).map(([r, v]) => [r, v.runs]));
const attempts = readdirSync(detailDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(detailDir, f), 'utf8')))
  .filter((d) => d.conclusion !== 'success').sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.attempt - y.attempt);

const rows = [];
for (const d of attempts) {
  const { repo } = d;
  const failingJobs = d.jobs.filter((j) => ['failure', 'timed_out', 'cancelled'].includes(j.conclusion) && j.name !== 'CI success');
  const failingSteps = failingJobs.flatMap((j) => j.steps.filter((s) => ['failure', 'timed_out', 'cancelled'].includes(s.conclusion)).map((s) => `${j.name} / ${s.name}`));
  const testStepFailed = failingSteps.some((s) => isTestStep(s.split(' / ')[1]));
  const tests = d.log?.tests || [];
  const testFiles = [...new Set(tests.map((t) => t.file).filter(Boolean))];
  const row = {
    repo, runId: d.runId, attempt: d.attempt, event: d.event, branch: d.branch, headSha: d.headSha, date: d.createdAt,
    conclusion: d.conclusion, failingJobs: failingJobs.map((j) => `${j.name}:${j.conclusion}`), failingSteps,
    logAvailable: d.log ? d.log.available : null, testFiles,
    tests: tests.slice(0, 25).map((t) => ({ file: t.file, title: t.title, failureType: t.failureType, error: t.error, project: t.project })),
    testsTruncated: tests.length > 25 ? tests.length : undefined,
    logErrors: d.log?.errors?.filter((e) => !e.startsWith('CI success')).slice(0, 5),
  };
  // Resolution: the next green run of the workflow on the same branch (and event), or a later green attempt of the same run.
  let green = null;
  if (d.finalConclusion === 'success') green = { runId: d.runId, sha: d.headSha, date: d.createdAt, via: `attempt ${d.finalAttempt}` };
  else {
    const nx = runsByRepo[repo].find((r) => r.head_branch === d.branch && r.event === d.event && r.created_at > d.createdAt && r.conclusion === 'success');
    if (nx) green = { runId: nx.id, sha: nx.head_sha, date: nx.created_at, via: 'next green run' };
  }
  row.green = green;
  let cls; let fix = null;
  if (!green) cls = 'unresolved';
  else if (green.sha === d.headSha) cls = 'flaky';
  else {
    fix = fixDiff(repo, d.event, d.headSha, green.sha);
    fix.kinds = {};
    for (const f of fix.files) { f.kind = fileKind(repo, f.file); fix.kinds[f.kind] = (fix.kinds[f.kind] || 0) + 1; }
    const k = fix.kinds;
    const changedTests = fix.files.filter((f) => f.kind === 'test').map((f) => f.file);
    const failingChanged = testFiles.filter((f) => changedTests.includes(f));
    fix.failingTestFilesChanged = failingChanged;
    const litTargets = failingChanged.length ? failingChanged : (testFiles.length ? [] : changedTests);
    fix.literalOnly = litTargets.length ? litTargets.every((f) => literalOnly(repo, d.headSha, green.sha, f)) : null;
    const prodFiles = fix.files.filter((f) => f.kind === 'prod').map((f) => f.file);
    const imported = new Set(testFiles.flatMap((f) => importsOf(repo, green.sha, f)));
    fix.prodInFailingTestImports = prodFiles.filter((f) => imported.has(f));
    if (k.prod) cls = 'fault';
    else if ((k.doc || k.prompt) && (!k.test || fix.literalOnly === true)) cls = 'doc/prompt';
    else if (k.test) cls = fix.literalOnly === true ? 'pin bump' : 'test updated';
    else if (k.ci || k.deps || k.tooling) cls = 'config/tooling';
    // No own file changes: the branch only merged/rebased onto main, or pushed an empty commit to re-trigger CI.
    else cls = (fix.mergedMain || fix.commits === 0) ? 'merge-main only' : 'no-change';
    fix.files = fix.files.slice(0, 60);
  }
  row.resolution = cls;
  // Non-test failures are infra whatever fixed them; the resolution is kept for re-cutting.
  row.class = (!testStepFailed || d.conclusion === 'cancelled' || d.conclusion === 'timed_out') ? 'infra' : cls;
  row.evidence = fix ? { from: d.headSha, to: green.sha, ...fix } : (green ? { from: d.headSha, to: green.sha, sameSha: true } : null);
  rows.push(row);
}
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), since: snapshot.since, until: snapshot.until, rows }, null, 2));

// Console summary.
const tally = (xs, key) => xs.reduce((m, x) => { const k = key(x); m[k] = (m[k] || 0) + 1; return m; }, {});
for (const repo of Object.keys(REPO_DIRS)) {
  const rs = rows.filter((r) => r.repo === repo);
  console.log(`\n== ${repo}: ${rs.length} failed attempts; logs available ${rs.filter((r) => r.logAvailable).length}`);
  console.log('class', tally(rs, (r) => r.class));
  console.log('class x event', tally(rs, (r) => `${r.event}:${r.class}`));
  console.log('month x class', tally(rs, (r) => `${r.date.slice(0, 7)}:${r.class}`));
  const files = {};
  for (const r of rs) for (const f of r.testFiles) (files[f] ||= []).push(r.class);
  console.log('top failing files', Object.entries(files).sort((a, b) => b[1].length - a[1].length).slice(0, 15).map(([f, cs]) => `${f} ${cs.length} ${JSON.stringify(tally(cs, (c) => c))}`));
}
console.log(`\nwrote ${outPath} (${rows.length} rows)`);
