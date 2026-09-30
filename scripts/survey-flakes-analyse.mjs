// LIN-3168: join the E2E CI failure caches into a per-failure census (class, spec, shard, same-commit re-run, PR-diff plausibility), rank specs, and total their cost.
// Usage: node scripts/survey-flakes-analyse.mjs [--dir data/survey-flakes] [--json] [--sample-blind 32 --seed 3168]
// Reads ci-runs.json, detail/, ci-classified.json (survey-tests-ci-classify.mjs run over detail/), green/, spec-source.json and sessions.json when present; writes analysis.json.
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const dir = arg('--dir', 'data/survey-flakes');
const blindN = Number(arg('--sample-blind', '0'));
const seed = Number(arg('--seed', '3168'));
const asJson = argv.includes('--json');
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const readDir = (d) => (existsSync(join(dir, d)) ? readdirSync(join(dir, d)).filter((f) => f.endsWith('.json')).map((f) => read(join(d, f))) : []);
const git = (args) => { try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const mins = (a, b) => (new Date(b) - new Date(a)) / 60000;

const runs = read('ci-runs.json').repos;
const detail = readDir('detail');
const classified = read('ci-classified.json').rows;
const green = readDir('green');
const specSource = existsSync(join(dir, 'spec-source.json')) ? read('spec-source.json').rows : [];
const sessions = existsSync(join(dir, 'sessions.json')) ? read('sessions.json') : null;

const key = (repo, runId, attempt) => `${repo}:${runId}:${attempt}`;
const detailBy = new Map(detail.map((d) => [key(d.repo, d.runId, d.attempt), d]));
const lvRuns = runs.LinearViewer.runs;
const runById = new Map(lvRuns.map((r) => [r.id, r]));

// Infra signatures in an E2E job's log: the server or browser never came up, or the runner lost the job.
const INFRA_RE = /config\.webServer|browserType\.launch|Executable doesn't exist|ENOSPC|No space left|runner has received a shutdown|lost communication|The operation was canceled|Playwright version mismatch|EADDRINUSE|npm ERR!/;
// A count pin: the failing assertion compares an integer count (toHaveCount / toHaveLength / "all N ..." titles).

// The PR's own diff at the failing sha: from the first commit on main's first-parent chain reached by walking the branch's
// first parents (merge-base would return the sha itself once the branch has merged). Push: the commit's first-parent diff.
const mainChain = new Set((git(['rev-list', '--first-parent', 'origin/main']) || '').trim().split('\n'));
const diffCache = new Map();
function ownDiff(event, sha) {
  if (diffCache.has(sha)) return diffCache.get(sha);
  if (git(['cat-file', '-e', `${sha}^{commit}`]) === null) git(['fetch', '-q', 'origin', sha]);
  let base = null;
  if (event === 'push') base = `${sha}^1`;
  else {
    let cur = sha;
    for (let n = 0; n < 400 && cur; n++) {
      if (mainChain.has(cur) && cur !== sha) { base = cur; break; }
      const p = git(['rev-parse', `${cur}^1`]); cur = p ? p.trim() : null;
      if (cur && mainChain.has(cur)) { base = cur; break; }
    }
  }
  const files = base ? git(['diff', '--name-only', base, sha]) : null;
  const out = files === null ? null : files.trim().split('\n').filter(Boolean);
  diffCache.set(sha, out);
  return out;
}

// Could the diff plausibly have caused a failure in these specs? direct > name > prod > none.
const STOP = new Set(['spec', 'page', 'test', 'tests', 'local', 'proxy', 'the']);
function plausibility(files, specs) {
  if (!files) return 'unknown';
  if (!specs.length) return files.some(isProd) ? 'prod (spec unknown)' : 'none';
  const specSet = new Set(specs);
  if (files.some((f) => specSet.has(f) || /^tests\/(fixtures|helpers)|^routes\/test\.js$|playwright\.config/.test(f))) return 'direct';
  const tokens = specs.flatMap((s) => s.replace(/^tests\/e2e\//, '').replace(/\.spec\.[jt]s$/, '').split('-')).filter((t) => t.length >= 4 && !STOP.has(t));
  const prod = files.filter(isProd);
  if (prod.some((f) => tokens.some((t) => f.toLowerCase().includes(t)))) return 'name';
  if (prod.length) return 'prod';
  return 'none';
}
function isProd(f) {
  return !/(^|\/)tests?\//.test(f) && !/^(docs|plans|content|scripts|prototypes|experiments|\.github)\//.test(f) && !/\.(md|txt)$/.test(f) && !/package(-lock)?\.json$/.test(f);
}

// One row per failed LinearViewer attempt with a failing E2E shard.
const census = [];
for (const c of classified.filter((r) => r.repo === 'LinearViewer')) {
  const d = detailBy.get(key(c.repo, c.runId, c.attempt));
  if (!d) continue;
  const e2eJobs = d.jobs.filter((j) => /^E2E/.test(j.name) && ['failure', 'timed_out'].includes(j.conclusion));
  if (!e2eJobs.length) continue;
  const pw = d.log?.playwright;
  const failures = pw ? pw.failures.filter((f) => /^E2E/.test(f.job)) : [];
  const specs = [...new Set(failures.map((f) => f.file))];
  const errs = pw ? pw.blocks.flatMap((b) => b.errors.map(strip)) : [];
  const tails = d.log?.tails ? Object.values(d.log.tails).join('\n') : '';
  const failedSteps = e2eJobs.flatMap((j) => j.steps.filter((s) => ['failure', 'timed_out', 'cancelled'].includes(s.conclusion)).map((s) => s.name));
  const r = runById.get(d.runId);
  // Same sha green anywhere later (a re-run attempt, or another run of the same commit).
  const sameShaGreen = lvRuns.some((x) => x.head_sha === d.headSha && x.conclusion === 'success' && (x.id !== d.runId || x.run_attempt > d.attempt));
  const rerun = d.attempt < d.finalAttempt;
  const next = rerun ? detailBy.get(key(c.repo, c.runId, c.attempt + 1)) : null;
  const files = ownDiff(d.event, d.headSha);
  const plaus = plausibility(files, specs);
  // A count pin: an integer total (expected 2 to 99, so not an HTTP status; or an "all N" title) that the next green changed by editing the test, or main bumped.
  const expN = errs.map((e) => e.match(/^Expected(?: length)?: (\d+)$/)).filter(Boolean).map((m) => Number(m[1]));
  const countPin = failures.length > 0 && (expN.some((n) => n >= 2 && n < 100) || failures.some((f) => /\ball \d+ /.test(f.title)))
    && ['pin bump', 'test updated', 'doc/prompt', 'merge-main only'].includes(c.resolution);
  let cls; let basis = null;
  const infraLog = INFRA_RE.test(tails) && !failures.length;
  if (c.class === 'infra' || infraLog || !failedSteps.some((s) => /^Run E2E tests/.test(s))) cls = 'environment';
  else if (c.resolution === 'flaky' || c.resolution === 'no-change') { cls = 'flake'; basis = c.resolution === 'flaky' ? 'same commit passed later' : 'empty re-trigger passed'; }
  else if (countPin) cls = 'count pin';
  else if (c.resolution === 'pin bump' && !failures.length) { cls = 'unverified'; basis = 'literal-only test edit, failing test unknown'; }
  else if (d.event === 'push') {
    // On main the "fix" is just the next merge: call it a real fault only if that merge touched the failing spec or its surface.
    const fixFiles = (c.evidence?.files || []).map((f) => f.file);
    const touched = specs.length ? plausibility(fixFiles, specs) : 'unknown';
    cls = !specs.length ? 'unverified' : ['direct', 'name'].includes(touched) ? 'real fault' : 'flake';
    basis = 'main: next merge ' + (['direct', 'name'].includes(touched) ? 'touched the spec surface' : 'did not touch the spec surface');
  } else if (['fault', 'test updated', 'pin bump', 'doc/prompt', 'config/tooling'].includes(c.resolution)) cls = 'real fault';
  else if (c.resolution === 'merge-main only') cls = 'main moved';
  else cls = 'unresolved';
  census.push({
    runId: d.runId, attempt: d.attempt, event: d.event, branch: d.branch, prs: d.prs || r?.pull_requests || [], sha: d.headSha.slice(0, 10), date: d.createdAt,
    shards: e2eJobs.map((j) => j.name.replace('E2E shard ', '')), log: !!pw, specs, tests: failures.map((f) => `${f.file.replace('tests/e2e/', '')} › ${f.title}`),
    nFailed: pw?.summary?.failed ?? null, errors: [...new Set(errs.filter((e) => /^(Error|Expected|Received|Timeout|TimeoutError)/.test(e)))].slice(0, 4),
    resolution: c.resolution, basis, rerun, sameShaGreen, plausibility: plaus, countPin, class: cls,
    minutes: d.startedAt && d.updatedAt ? mins(d.startedAt, d.updatedAt) : null,
    e2eJobMinutes: d.jobs.filter((j) => /^E2E/.test(j.name) && j.started_at && j.completed_at).reduce((s, j) => s + mins(j.started_at, j.completed_at), 0),
    // For a re-run: how long the next attempt ran, and how long the red sat before someone re-ran it.
    rerunMinutes: next?.startedAt && next?.updatedAt ? mins(next.startedAt, next.updatedAt) : null,
    reactionMinutes: next?.startedAt && d.updatedAt ? mins(d.updatedAt, next.startedAt) : null,
    fix: c.evidence?.fixShas || null, diffFiles: (files || []).slice(0, 15), fixFiles: (c.evidence?.files || []).map((f) => f.file).slice(0, 15),
  });
}

const tally = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const month = (x) => x.date.slice(0, 7);
const pr = census.filter((x) => x.event === 'pull_request');

// Per-spec ranking over attempts with a readable log. A multi-spec attempt counts once for each spec it names.
const bySpec = new Map();
for (const x of census) for (const s of x.specs) {
  const e = bySpec.get(s) || { spec: s.replace('tests/e2e/', ''), attempts: 0, flake: 0, 'real fault': 0, 'count pin': 0, environment: 0, other: 0, first: x.date, last: x.date, months: {}, tests: new Set(), flakeMinutes: 0, reruns: 0 };
  e.attempts++; e[['flake', 'real fault', 'count pin', 'environment'].includes(x.class) ? x.class : 'other']++;
  if (x.date < e.first) e.first = x.date; if (x.date > e.last) e.last = x.date;
  if (x.class === 'flake') { e.months[month(x)] = (e.months[month(x)] || 0) + 1; e.flakeMinutes += (x.minutes || 0) + (x.rerunMinutes || 0); if (x.rerun) e.reruns++; }
  for (const t of x.tests) if (t.startsWith(e.spec)) e.tests.add(t.slice(e.spec.length + 3));
  bySpec.set(s, e);
}
// In-job retries seen in the green-run sample.
const greenFlaky = {}; const greenByMonth = {}; const livebarByHalf = {}; let greenRuns = 0; let greenWithFlaky = 0; let greenFlakyTests = 0; let greenLogs = 0;
for (const g of green) {
  const e2e = g.jobs.filter((j) => /^E2E/.test(j.name));
  if (!e2e.length || e2e.some((j) => j.log === false)) continue;
  greenRuns++; greenLogs += e2e.length;
  const fl = e2e.flatMap((j) => j.flaky || []);
  if (fl.length) greenWithFlaky++;
  const gm = (greenByMonth[g.createdAt.slice(0, 7)] ||= { runs: 0, withFlaky: 0, flakyTests: 0, withoutLivebar: 0 });
  gm.runs++; if (fl.length) gm.withFlaky++; gm.flakyTests += fl.length;
  // The one near-constant retry (observation's reduced-motion livebar) left out, to show the rest.
  if (fl.some((f) => !/reduced motion renders the livebar/.test(f.title))) gm.withoutLivebar++;
  const half = `${g.createdAt.slice(0, 7)}-${Number(g.createdAt.slice(8, 10)) <= 15 ? 'a' : 'b'}`;
  const lh = (livebarByHalf[half] ||= { runs: 0, livebar: 0 }); lh.runs++; if (fl.some((f) => /reduced motion renders the livebar/.test(f.title))) lh.livebar++;
  greenFlakyTests += fl.length;
  for (const f of fl) greenFlaky[f.file.replace('tests/e2e/', '')] = (greenFlaky[f.file.replace('tests/e2e/', '')] || 0) + 1;
}
for (const [s, n] of Object.entries(greenFlaky)) { const e = bySpec.get(`tests/e2e/${s}`); if (e) e.greenRetries = n; }
const src = new Map(specSource.map((r) => [r.file.replace('tests/e2e/', ''), r]));
const ranked = [...bySpec.values()].map((e) => ({ ...e, tests: [...e.tests], greenRetries: greenFlaky[e.spec] || 0, source: src.get(e.spec) || null }))
  .sort((a, b) => b.flake - a.flake || b.attempts - a.attempts);
// Specs that only ever flake inside a green run (retried away) never reach the census; list them too.
const greenOnly = Object.entries(greenFlaky).filter(([s]) => !bySpec.has(`tests/e2e/${s}`)).sort((a, b) => b[1] - a[1]);

// Cost: red PR runs, re-run attempts, wall-clock, E2E job-minutes.
const runsWith = (xs) => new Set(xs.map((x) => x.runId)).size;
const flakes = census.filter((x) => x.class === 'flake');
const cost = {
  redPrAttempts: tally(pr, (x) => x.class), redPrRuns: Object.fromEntries(Object.entries(tally(pr, (x) => x.class)).map(([k]) => [k, runsWith(pr.filter((x) => x.class === k))])),
  flakeRerunAttempts: flakes.filter((x) => x.rerun).length,
  flakeNewPushes: flakes.filter((x) => !x.rerun).length,
  flakeFailedAttemptMinutes: flakes.reduce((s, x) => s + (x.minutes || 0), 0),
  flakeE2eJobMinutes: flakes.reduce((s, x) => s + x.e2eJobMinutes, 0),
  flakeRerunMinutes: flakes.reduce((s, x) => s + (x.rerunMinutes || 0), 0),
  flakeReactionMedian: median(flakes.map((x) => x.reactionMinutes).filter((v) => v != null)),
  flakeReactionSum: flakes.reduce((s, x) => s + (x.reactionMinutes || 0), 0),
  medianAttemptMinutes: median(census.map((x) => x.minutes).filter((v) => v != null)),
  allRerunAttemptsLV: lvRuns.reduce((s, r) => s + r.run_attempt - 1, 0),
};
function median(xs) { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }

// Masking: a real fault landing on a spec already known to flake (a flake earlier in the window), and flakes on diffs that touched the spec's own surface.
const firstFlake = {};
for (const x of [...census].sort((a, b) => a.date.localeCompare(b.date))) if (x.class === 'flake') for (const s of x.specs) firstFlake[s] ||= x.date;
const maskingCandidates = census.filter((x) => x.class === 'real fault' && x.specs.some((s) => firstFlake[s] && firstFlake[s] < x.date))
  .map((x) => ({ runId: x.runId, date: x.date, event: x.event, prs: x.prs, specs: x.specs, resolution: x.resolution, plausibility: x.plausibility, errors: x.errors.slice(0, 2) }));
const flakeOnOwnSurface = flakes.filter((x) => ['direct', 'name'].includes(x.plausibility))
  .map((x) => ({ runId: x.runId, date: x.date, prs: x.prs, specs: x.specs, plausibility: x.plausibility, errors: x.errors.slice(0, 2) }));
// Push-to-main E2E reds with a real-fault class: did the merged PR's own runs flake on the same spec and get re-run to green?
const pushFaults = census.filter((x) => x.event === 'push' && x.specs.length).map((x) => {
  const subj = git(['log', '-1', '--format=%s', x.sha]) || '';
  const n = Number((subj.match(/#(\d+)/) || [])[1]) || null;
  const prRows = n ? census.filter((y) => y.prs.includes(n)) : [];
  return { runId: x.runId, date: x.date, sha: x.sha, class: x.class, pr: n, specs: x.specs, prRedOnSameSpec: prRows.filter((y) => y.specs.some((sp) => x.specs.includes(sp))).length, prRedAttempts: prRows.map((y) => ({ runId: y.runId, class: y.class, specs: y.specs })) };
});

// Blind second-coding sample: every k-th census row with a readable log, shuffled; the class is withheld.
let blind = null;
if (blindN) {
  const pool = census.filter((x) => x.log || x.class === 'environment');
  const k = Math.max(1, Math.floor(pool.length / blindN));
  console.log(`blind pool ${pool.length}, every ${k}th`);
  let s = seed; const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  blind = pool.filter((_, i) => i % k === 0).slice(0, blindN).map((x) => ({ id: `${x.runId}-${x.attempt}`, event: x.event, date: x.date.slice(0, 10), shards: x.shards, tests: x.tests.slice(0, 6), nFailed: x.nFailed, errors: x.errors,
    sameCommitPassedLater: x.sameShaGreen, rerunOfSameRun: x.rerun, ownDiffFiles: x.diffFiles, nextGreenChangedFiles: x.resolution === 'flaky' ? 'nothing (same commit)' : x.fixFiles }))
    .sort(() => rand() - 0.5);
  writeFileSync(join(dir, 'blind-sample.json'), JSON.stringify(blind, null, 2));
}

const out = { generatedAt: new Date().toISOString(), census, ranked, greenOnly, green: { runs: greenRuns, jobs: greenLogs, withFlaky: greenWithFlaky, flakyTests: greenFlakyTests, bySpec: greenFlaky, byMonth: greenByMonth },
  cost, maskingCandidates, flakeOnOwnSurface, pushFaults, sessions: sessions ? sessions.summary || null : null };
writeFileSync(join(dir, 'analysis.json'), JSON.stringify(out, null, 2));
if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

// Blind agreement, when the second coder's file is present.
if (existsSync(join(dir, 'blind-codes.json'))) {
  const codes = read('blind-codes.json'); const byId = new Map(census.map((x) => [`${x.runId}-${x.attempt}`, x.class]));
  const pairs = codes.map((c) => [byId.get(c.id), c.class]).filter(([a]) => a);
  const agree = pairs.filter(([a, b]) => a === b).length;
  console.log(`\nblind second coding: ${agree}/${pairs.length} agree`, tally(pairs.filter(([a, b]) => a !== b), ([a, b]) => `${a} -> ${b}`));
}

console.log(`E2E-failing attempts (LinearViewer, since ${read('ci-runs.json').since}): ${census.length} in ${runsWith(census)} runs; log readable ${census.filter((x) => x.log).length}`);
console.log('class', tally(census, (x) => x.class));
console.log('class (pull_request)', tally(pr, (x) => x.class), '(push)', tally(census.filter((x) => x.event === 'push'), (x) => x.class));
console.log('month x class', tally(census, (x) => `${month(x)} ${x.class}`));
// Workers went from 1 to 2 on 24 June (LIN-629, playwright.config.js); split June there.
const period = (t) => (t < '2026-06-24' ? '2026-06 (1-23, 1 worker)' : t < '2026-07-01' ? '2026-06 (24-30, 2 workers)' : t.slice(0, 7));
const runsPer = tally(lvRuns, (r) => period(r.created_at));
const flakesPer = tally(flakes, (x) => period(x.date));
console.log('flakes per 100 runs', Object.fromEntries(Object.keys(runsPer).sort().map((p) => [p, `${flakesPer[p] || 0} in ${runsPer[p]} runs = ${(100 * (flakesPer[p] || 0) / runsPer[p]).toFixed(1)}`])));
console.log('shard x class', tally(census.flatMap((x) => x.shards.map((s) => ({ s, c: x.class }))), (y) => `${y.s} ${y.c}`));
console.log('flake basis', tally(flakes, (x) => `${x.basis} / ${x.rerun ? 'rerun' : 'new run'}`));
console.log('plausibility x class', tally(census, (x) => `${x.class}: ${x.plausibility}`));
console.log('flake failed-test count', tally(flakes.filter((x) => x.log), (x) => (x.nFailed > 5 ? '>5' : x.nFailed)));
console.log('\nranked specs (flake, real fault, count pin, env; green-run retries in sample)');
for (const e of ranked.slice(0, 20)) console.log(`${e.spec.padEnd(42)} att ${e.attempts} flake ${e.flake} fault ${e['real fault']} pin ${e['count pin']} env ${e.environment} other ${e.other} | ${e.first.slice(0, 10)}..${e.last.slice(0, 10)} ${JSON.stringify(e.months)} green ${e.greenRetries} | flake wall ${Math.round(e.flakeMinutes)}m`);
console.log('\ngreen-run sample:', out.green.runs, 'runs,', out.green.withFlaky, 'with >=1 retried-away flaky test,', out.green.flakyTests, 'flaky tests'); console.log('green-only flaky specs', greenOnly.slice(0, 12)); console.log('green by month', greenByMonth); console.log('livebar retried, by half-month', Object.fromEntries(Object.entries(livebarByHalf).sort().map(([k, v]) => [k, `${v.livebar}/${v.runs} = ${Math.round(100 * v.livebar / v.runs)}%`])));
console.log('\ncost', cost);
console.log('\nmasking candidates', maskingCandidates.length, maskingCandidates.map((m) => `${m.date.slice(0, 10)} ${m.runId} ${m.specs.join(',')} ${m.resolution} ${m.plausibility}`));
console.log('flakes on the diff\'s own surface', flakeOnOwnSurface.length, flakeOnOwnSurface.map((m) => `${m.date.slice(0, 10)} ${m.runId} ${m.specs.join(',')} ${m.plausibility}`));
console.log('push E2E reds with a known spec', pushFaults.length, 'whose merged PR had a red attempt on the same spec:', pushFaults.filter((p) => p.prRedOnSameSpec).length, pushFaults.map((p) => `${p.date.slice(0, 10)} ${p.class} PR#${p.pr} ${p.specs.map((x) => x.replace('tests/e2e/', '')).join(',')} prRedSameSpec=${p.prRedOnSameSpec}`));
console.log('count pins', census.filter((x) => x.class === 'count pin').map((x) => `${x.date.slice(0, 10)} ${x.tests[0]?.slice(0, 90)} | ${x.errors.slice(1, 3).join(' ')}`));
console.log('flakes on own surface by event', tally(flakeOnOwnSurface, (x) => census.find((y) => y.runId === x.runId)?.event), 'distinct specs', [...new Set(flakeOnOwnSurface.flatMap((x) => x.specs))]);
if (blind) console.log(`\nwrote blind-sample.json (${blind.length})`);
