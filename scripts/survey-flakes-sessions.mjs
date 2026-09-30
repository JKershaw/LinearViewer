// LIN-3168: from local Claude Code session transcripts, what red browser (Playwright E2E shard) CI costs inside agent sessions, per (session, PR/run) episode.
// Usage: node scripts/survey-flakes-sessions.mjs [--projects ~/.claude/projects] [--ci data/survey-flakes/ci-runs.json] [--detail data/survey-flakes/detail] [--out data/survey-flakes/sessions.json] [--diag-turns 10]
// Scope: main-thread entries (isSidechain skipped) of ~/.claude/projects/*simple-dispatcher-workspaces*/*.jsonl — LinearViewer and simple-dispatcher legs.
// Observation: a tool_result of a Bash command that queries CI (gh pr checks, gh run view/watch/list, gh pr view --json statusCheckRollup,
// gh api/curl …/check-runs|actions/runs, or a later Read/cat of a background or redirected output file of one). Job lines are parsed from the
// tab, symbol (X/✓/*), jq and JSON shapes those print; log lines (`job\tstep\t<timestamp>`) never count as status. A run-level success with no
// job lines (gh run view --json conclusion, gh run watch, gh run list) counts as all four shards green for that run. Prompt text, docs, PR
// bodies and CLAUDE.md that mention "E2E shard" are never observations.
// Episode: opens at the first observation of a target (PR number, run id, head sha or head branch — any shared id matches) with an E2E shard
// failing; later red observations of it fold in (repeated polling is one episode). It closes at the next observation of that target with no
// E2E shard failing or pending and every previously failing shard (or all four) passing; else it runs to the session's end.
// Code edit: Edit/Write/MultiEdit/NotebookEdit, or a sed -i/perl -i/python/heredoc/tee/redirect write, to a path inside a repo clone (not docs,
// not scratch). Only edits that could be in the green commit count toward the class: none when the green is the same run id as a red one
// (a re-run of the same commit), else those before the last push to the episode's branch.
// Class (mechanical):
//   deliberate-red        the red was provoked on purpose (mutation/probe branch, or the assistant said it expected a red just before) — excluded;
//   unresolved            no green seen for the target before the session ended;
//   edited-spec / -prod / -both   shipped code edits to tests only (tests/**, *.spec|test.js, playwright.config.*) / to non-test code only / both;
//   rerun-only            green on the same run id (a re-run), and no diagnosis signal;
//   diagnosed-then-rerun  green on the same run id, with a diagnosis signal: read the CI log, ran Playwright locally, downloaded
//                         artifacts/traces, or spent > --diag-turns assistant turns between red and green;
//   no-edit-new-run       green on a different run with no shipped code edit (rebase, docs-only commit, someone else's push);
//   no-edit-green-unattributed   green seen without a run id, and neither the CI snapshot nor the session's pushes/re-runs say which run.
// editedButFlake ('diagnosed as real when it was a flake'): the session edited code/spec for it, yet (a) the green came from a re-run of the
// unedited commit while it had edited an E2E spec/the failing spec or called the failure real, or (b) the CI snapshot shows a red run's head
// sha concluded success (a later attempt or another run on that sha), or (c) its own text after the first such edit calls the E2E failure a
// flake/pre-existing/unrelated/timing issue. editedButFlakeStrict also needs the failing spec itself edited, or the first judgement 'real'.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const ciPath = arg('--ci', 'data/survey-flakes/ci-runs.json');
const detailDir = arg('--detail', 'data/survey-flakes/detail');
const out = arg('--out', 'data/survey-flakes/sessions.json');
const DIAG_TURNS = Number(arg('--diag-turns', '10'));
const GAP_CAP_MIN = 15; // active minutes: gaps between transcript entries capped at this

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x.type === 'text' ? x.text : '')).join('') : '');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\[[0-9;]*m/g, '');
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s);
const minutes = (a, b) => (a && b ? +((Date.parse(b) - Date.parse(a)) / 60000).toFixed(1) : null);
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const sum = (a) => +a.reduce((x, y) => x + (y || 0), 0).toFixed(1);

// ---- CI snapshot (optional join) ---------------------------------------------------------------------------------------
const ciRuns = new Map(); const runsBySha = new Map();
if (existsSync(ciPath)) {
  const snap = JSON.parse(readFileSync(ciPath, 'utf8'));
  for (const [repo, v] of Object.entries(snap.repos || {})) for (const r of v.runs || []) {
    const x = { repo, id: r.id, sha: r.head_sha, branch: r.head_branch, event: r.event, conclusion: r.conclusion, attempts: r.run_attempt, createdAt: r.created_at, prs: (r.pull_requests || []).map((p) => p.number ?? p) };
    ciRuns.set(String(r.id), x); (runsBySha.get(r.head_sha) || runsBySha.set(r.head_sha, []).get(r.head_sha)).push(x);
  }
}
const shaRuns = (sha) => { if (!sha) return []; if (runsBySha.has(sha)) return runsBySha.get(sha); if (sha.length < 7) return []; for (const [k, v] of runsBySha) if (k.startsWith(sha)) return v; return []; };
// Failing Playwright tests per red attempt, from survey-flakes-ci-fetch.mjs's cached per-attempt files.
const ciFailures = (runId) => {
  const res = []; const ci = ciRuns.get(String(runId)); if (!ci) return res;
  for (let a = 1; a <= (ci.attempts || 1); a++) {
    const p = join(detailDir, `${ci.repo}-${runId}-${a}.json`); if (!existsSync(p)) continue;
    try { const d = JSON.parse(readFileSync(p, 'utf8')); for (const f of d.log?.playwright?.failures || []) res.push({ attempt: a, job: f.job, file: f.file, title: f.title }); } catch { /* unreadable cache file */ }
  }
  return res;
};

// ---- command classification --------------------------------------------------------------------------------------------
const isCiCmd = (c) => /\bgh\s+pr\s+checks\b|\bgh\s+run\s+(?:view|watch|list)\b|'gh',\s*'(?:run|pr)'/.test(c)
  || (/\bgh\s+pr\s+view\b/.test(c) && /statusCheckRollup/.test(c))
  || (/\bgh\s+api\b|'gh',\s*'api'|api\.github\.com/.test(c) && /check-runs|check-suites|actions\/runs|actions\/jobs|statusCheckRollup|\/status\b/.test(c));
const LOG_RE = /\bgh\s+run\s+view\b[^\n;|&]*--log(?:-failed)?\b|\bgh\s+api\b[^\n;|&]*\/logs\b|actions\/jobs\/\d+\/logs/;
const ARTIFACT_RE = /\bgh\s+run\s+download\b|playwright\s+show-(?:trace|report)|trace\.zip|\/artifacts\b/;
const LOCAL_PW_RE = /(?:^|[\s;&|(])(?:npx\s+)?playwright\s+test\b|\bnpm\s+(?:run\s+)?test(?!:)\b|\bnpm\s+t\b|\bnpm\s+run\s+test:e2e\b/;
const RERUN_RE = /\bgh\s+run\s+rerun\b|\bgh\s+api\b[^\n]*\/rerun(?:-failed-jobs)?\b/;
const COMMIT_RE = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/;
const PUSH_RE = /\bgit\s+(?:-C\s+\S+\s+)?push\b/;
const MERGE_RE = /\bgh\s+pr\s+merge\b/;
const prsIn = (c) => [...new Set([...c.matchAll(/\bgh\s+pr\s+(?:checks|view|merge)\s+(?:-R\s+\S+\s+|--repo\s+\S+\s+)?#?(\d{2,5})\b|\/pulls?\/(\d{2,5})\b|\bPR=(\d{2,5})\b/g)].map((m) => m[1] || m[2] || m[3]))];
const runsIn = (c) => [...new Set([...c.matchAll(/\bgh\s+run\s+(?:view|watch|rerun|download)\s+(?:-R\s+\S+\s+|--repo\s+\S+\s+)?(\d{8,})\b|actions\/runs\/(\d{8,})\b|\bRUN=(\d{8,})\b/g)].map((m) => m[1] || m[2] || m[3]))];
const shaIn = (c) => (c.match(/commits\/([0-9a-f]{40})\b|--commit[= ]"?([0-9a-f]{7,40})\b|\bSHA=['"]?([0-9a-f]{40})\b/) || []).slice(1).find(Boolean) || null;
// The red was provoked on purpose: a mutation/probe branch, or the last 3 assistant turns before it said CI/E2E was expected to fail.
// (Mutation witnesses are house style in local test runs, so the word alone is not enough; it must be about the CI run.)
const DELIBERATE_BRANCH_RE = /mutation|mutant|probe|sabotage|red-?first/i;
const DELIBERATE_TEXT_RE = /(?:expect|should|want|confirm|prove|watch)\w*[^.\n]{0,60}\b(?:CI|E2E|shard|job|the run)\b[^.\n]{0,40}\b(?:fail|go red|goes red|turn red|catch)|\b(?:CI|E2E|shard)\b[^.\n]{0,40}\b(?:should|expected to|must|will) (?:now )?(?:fail|go red)|deliberately (?:break|fail|red)\w*[^.\n]{0,40}\b(?:CI|E2E|shard)/i;

// ---- file roles for edits ----------------------------------------------------------------------------------------------
const inRepo = (p) => /\/(?:LinearViewer|simple-dispatcher|wt-[\w-]+)\//.test(p);
const isScratch = (p) => /^\/(?:private\/)?tmp\/|\/scratchpad\/(?!wt-)|\/\.claude\/|test-results\/|playwright-report\/|\/data\/|node_modules\/|\.log$/.test(p);
const relPath = (p) => { const m = p.match(/(?:\/LinearViewer\/|\/simple-dispatcher\/|\/wt-[\w-]+\/)(?!.*(?:\/LinearViewer\/|\/simple-dispatcher\/))(.*)$/); return m ? m[1] : p.replace(/^\.\//, ''); };
const REPO_REL = /^(?:\.\/)?(?:lib|routes|public|tests?|scripts|docs|views|bin|src|plans|prompts|\.github)\/|^(?:\.\/)?[\w.-]+\.(?:m?js|cjs|md|json)$/;
const roleOf = (p) => {
  const r = relPath(p);
  if (/(?:^|\/)tests\/e2e\/|playwright\.config\./.test(r)) return 'e2e';
  if (/(?:^|\/)(?:tests?|__tests__)\//.test(r) || /\.(?:test|spec)\.[cm]?[jt]s$/.test(r)) return 'test';
  if (/\.(?:md|mdx|txt)$/i.test(r) || /(?:^|\/)(?:docs|plans)\//.test(r)) return 'doc';
  if (/(?:^|\/)\.github\//.test(r)) return 'ci';
  return 'prod';
};
const SPEC_SIDE = new Set(['e2e', 'test']); const PROD_SIDE = new Set(['prod', 'ci']);
// Targets of in-command writes only (not every path a command mentions): sed/perl -i file args, redirects, tee, python open(…,'w').
function bashEdits(cmd) {
  const t = [];
  for (const m of cmd.matchAll(/\b(?:sed\s+-i(?:\s*'')?|perl\s+-[a-z0-9]*i[a-z0-9]*(?:\s+-e)?)\s+(?:(['"])[\s\S]*?\1|\S+)((?:\s+[\w./@+-]+)+)/g)) t.push(...m[2].trim().split(/\s+/));
  for (const m of cmd.matchAll(/(?:^|[^>2&])>{1,2}\s*("?)([\w./@+-]+)\1/g)) t.push(m[2]);
  for (const m of cmd.matchAll(/\btee\s+(?:-a\s+)?("?)([\w./@+-]+)\1/g)) t.push(m[2]);
  for (const m of cmd.matchAll(/open\(\s*['"]([^'"]+)['"]\s*,\s*['"][wa]|writeFileSync\(\s*['"]([^'"]+)['"]/g)) t.push(m[1] || m[2]);
  return [...new Set(t)].filter((p) => !/^\/dev\//.test(p) && !isScratch(p) && (inRepo(p) || REPO_REL.test(p)) && /\.[a-z]{1,5}$/i.test(p) && !/package-lock/.test(p));
}

// ---- CI status parsing -------------------------------------------------------------------------------------------------
const JOB_G = /E2E shard \d\/\d|[Uu]nit tests|Secret scan \(source\)|CI success/g;
const JOB_EXACT = /^(?:E2E shard \d\/\d|[Uu]nit tests|Secret scan \(source\)|CI success)$/;
const normStatus = (w) => {
  if (!w) return null; const s = w.toLowerCase();
  if (/^(?:fail|failed|failure|failing|timed_out|startup_failure|action_required)$/.test(s)) return 'fail';
  if (/^(?:pass|passed|success|successful)$/.test(s)) return 'pass';
  if (/^(?:pending|in_progress|queued|waiting|requested|expected)$/.test(s)) return 'pending';
  if (/^(?:cancelled|canceled|cancel|skipping|skipped|neutral|stale)$/.test(s)) return 'other';
  return null;
};
const STATUS_WORD = /\b(fail(?:ed|ure|ing)?|pass(?:ed)?|success(?:ful)?|pending|in_progress|queued|waiting|requested|cancell?ed|cancel|skipp(?:ing|ed)|neutral|timed_out|startup_failure|action_required)\b/i;
const isLogLine = (l) => /UNKNOWN STEP|\t\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z|^\s*\d+:\S*E2E shard \d\/\d\t/.test(l);
function parseStatuses(raw) {
  const items = [];
  let t = stripAnsi(raw).replace(/"steps"\s*:\s*\[[\s\S]*?\]\s*,?/g, '');
  // Flat JSON objects (gh --json, gh api check-runs, jq -c): conclusion/c/bucket/state, else status.
  t = t.replace(/\{[^{}]*\}/g, (o) => {
    const nm = o.match(/"(?:name|n|context)"\s*:\s*"([^"]+)"/); if (!nm || !JOB_EXACT.test(nm[1])) return o;
    const c = o.match(/"(?:conclusion|c|bucket|state)"\s*:\s*(?:"([A-Za-z_]*)"|null)/); const s = o.match(/"(?:status|s)"\s*:\s*"([A-Za-z_]+)"/);
    const u = o.match(/actions\/runs\/(\d+)(?:\/job\/(\d+))?/);
    const st = normStatus(c?.[1]) || (s && normStatus(s[1]) === 'pending' ? 'pending' : null);
    if (st) items.push({ job: nm[1], status: st, runId: u?.[1] || null, jobId: u?.[2] || null, pr: null });
    return ' ';
  });
  let curPr = null;
  for (const line of t.split('\n')) {
    const hdr = line.match(/(?:^|\s|=)(?:PR\s*#?|#)(\d{3,5})\b|^=+\s*(\d{3,5})\s*=+/); if (hdr) curPr = hdr[1] || hdr[2];
    if (isLogLine(line) || /"\w+"\s*:/.test(line) || line.length > 400) continue;
    const occ = [...line.matchAll(JOB_G)]; if (!occ.length) continue;
    occ.forEach((m, k) => {
      const unit = occ.length === 1 ? line : line.slice(m.index, k + 1 < occ.length ? occ[k + 1].index : line.length);
      const rest = unit.replace(m[0], ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\.github#\d+/g, ' ');
      if (/^\s*:\s*$/.test(rest) || /Process completed with exit code/.test(unit)) return;
      const w = rest.match(STATUS_WORD);
      let st = w ? normStatus(w[1]) : null;
      if (!st && occ.length === 1) st = /^\s*(?:X|✗|✘|❌)\s/.test(line) ? 'fail' : /^\s*(?:✓|✔|✅)/.test(line) ? 'pass' : /^\s*\*\s/.test(line) ? 'pending' : null;
      if (!st) return;
      const u = unit.match(/actions\/runs\/(\d+)(?:\/job\/(\d+))?/); const id = unit.match(/\(ID (\d+)\)/);
      items.push({ job: m[0], status: st, runId: u?.[1] || null, jobId: u?.[2] || id?.[1] || null, pr: curPr });
    });
  }
  return items;
}
// Run-level conclusions that name no job: gh run list rows, gh run view/watch of one run. Returns [{runId, status}].
function runLevel(raw, cmd) {
  const res = []; const t = stripAnsi(raw);
  for (const l of t.split('\n')) { const m = l.match(/^(completed|in_progress|queued)\t(\w*)\t.*\t(\d{9,})\t/); if (m) res.push({ runId: m[3], status: m[1] === 'completed' ? normStatus(m[2]) : 'pending' }); }
  const one = runsIn(cmd);
  if (one.length === 1 && /\bgh\s+run\s+(?:view|watch)\b/.test(cmd) && !LOG_RE.test(cmd) && !/E2E shard \d\/\d|[Uu]nit tests/.test(t)) {
    const c = t.match(/"conclusion"\s*:\s*"(\w+)"/) || t.match(/completed with '(\w+)'/) || t.match(/^\s*([✓X])\s+\S+\s+Tests\s+·\s+\d+/m);
    if (c) res.push({ runId: one[0], status: c[1] === '✓' ? 'pass' : c[1] === 'X' ? 'fail' : normStatus(c[1]) });
  }
  return res.filter((x) => x.status);
}
// Playwright results in CI log text: failures (✘ lines, numbered failure blocks, the 'N failed' list) minus tests that later passed or sit in 'N flaky'.
const SPEC_LINE = /(?:\[\w+\]\s+›\s+|\s|^)((?:tests\/)?(?:e2e\/)?[\w./-]+\.spec\.[jt]s):(\d+):\d+\s+›\s+(.+?)(?:\s+\(retry #\d+\))?(?:\s+\(\d[\d.]*m?s\))?\s*(?:─+)?\s*$/;
function specResults(raw) {
  const failed = new Map(); const flaky = new Map(); const passed = new Set(); let sect = null;
  for (let l of stripAnsi(raw).split('\n')) {
    l = l.replace(/^\d+[:-](?=\S)/, '').replace(/^[^\t\n]*\t[^\t\n]*\t\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '');
    const sm = l.match(/^\s*\d+ (failed|flaky|passed|skipped|did not run|interrupted)\b/); if (sm) { sect = sm[1]; continue; }
    const m = l.match(SPEC_LINE);
    if (!m) { if (sect && l.trim() && !/^\s{2,}/.test(l)) sect = null; continue; }
    const file = `tests/e2e/${m[1].replace(/^(?:tests\/)?(?:e2e\/)?/, '')}`; const title = m[3].split(' › ').pop().trim(); const k = `${file}|${title}`; const x = { file, line: Number(m[2]), title };
    if (sect === 'failed') failed.set(k, x); else if (sect === 'flaky') flaky.set(k, x);
    else if (/^\s*(?:✓|✔)/.test(l)) passed.add(k);
    else if (/^\s*(?:✘|×|✗)/.test(l) || /^\s*\d+\)\s/.test(l)) failed.set(k, x);
  }
  for (const k of [...failed.keys()]) if (flaky.has(k) || passed.has(k)) { if (!flaky.has(k)) flaky.set(k, failed.get(k)); failed.delete(k); }
  return { failed: [...failed.values()], flaky: [...flaky.values()] };
}

// ---- judgement text ----------------------------------------------------------------------------------------------------
const TOPIC_RE = /\be2e\b|shard|playwright|\.spec\b|\bspec\b|browser test/i;
const REAL_RE = /\bnot (?:a |an )?(?:flake|flaky|flakiness)|isn'?t (?:a )?flak|flak\w*[^.]{0,40}\b(?:is|was) wrong|\b(?:ruled out|rejected)\b[^.]{0,30}flak|flak\w*[^.]{0,30}\b(?:ruled out|rejected)|\breal (?:failure|bug|regression|break)|\bgenuine|\blegit(?:imate)? (?:failure|regression)|(?:my|our|this) (?:change|diff|pr|edit)s? (?:broke|caused|introduced)|caused by (?:my|our|this|the) (?:change|diff|pr|edit)|\bregression (?:from|introduced)|\bdeterministic/i;
const FLAKE_RE = /\bflak(?:e|y|iness|ed)\b|\bintermittent|\btransient|timing[- ](?:sensitive|dependent|issue|flake|related)|\bpre-?existing (?:failure|flak\w*|issue|problem|red|breakage)|(?:failure|red|flake) (?:is|was) pre-?existing|(?:fails?|red) on main too|\bunrelated\b[^!?\n]{0,40}(?:spec|test|assertion|failure|flak|shard|E2E|change|diff|PR)|not (?:caused by|related to) (?:my|our|this)|\bknown (?:flak|issue|failure)|\binfra(?:structure)? (?:issue|flake|problem|hiccup)|\brunner (?:issue|hiccup)/i;
const HEDGE_RE = /before assum|assum\w* (?:it'?s|this is)|\bwhether\b|\bif (?:it'?s|this is|that'?s)\b|could be|might be|may be|would be|\bpossibly\b|rule out|\?\s*$/i;
// First sentence that judges the E2E failure; the quote is a <=200-char window around the judging phrase.
function judge(s) {
  const blockTopic = TOPIC_RE.test(s);
  for (const sent of s.split(/(?<=[.!?])\s+|\n+/)) {
    if (!TOPIC_RE.test(sent) && !(blockTopic && /\b(?:CI|checks?|red|fail\w*|flak\w*|rerun|re-run)\b/i.test(sent))) continue;
    // A 'real' phrase in a contrast or hedge ("flaky rather than caused by this change", "a real failure would be surprising") is not a verdict.
    let r = sent.match(REAL_RE); if (r && !/^not|^isn|^flak/i.test(r[0]) && (HEDGE_RE.test(sent) || /(?:rather than|instead of|\bor|\bnot|n't|than|whether)\s+(?:\w+\s+){0,2}$/i.test(sent.slice(0, r.index)))) r = null;
    // '1 flaky' is a Playwright count; 'not a flake' / 'hoping for a flake' negate the flake reading.
    const bare = sent.replace(/\b\d+ flaky\b/gi, ''); let f = !r && !HEDGE_RE.test(sent) && bare.match(FLAKE_RE);
    if (f && /\b(?:not|n't|no|never|hoping for|rather than|instead of|assum\w*|before)\b[^.]{0,25}$/i.test(bare.slice(0, f.index))) f = null;
    const hit = r || f; if (!hit) continue;
    const at = Math.max(0, Math.min(hit.index - 90, sent.length - 200));
    return { kind: r ? 'real' : 'flake', quote: (at > 0 ? '…' : '') + clip(sent.slice(at).trim(), 200) };
  }
  return null;
}

// ---- collect transcripts -----------------------------------------------------------------------------------------------
const files = [];
for (const d of readdirSync(root)) {
  if (!d.includes('simple-dispatcher-workspaces')) continue;
  const dir = join(root, d); let fs; try { if (!statSync(dir).isDirectory()) continue; fs = readdirSync(dir); } catch { continue; }
  for (const f of fs) if (f.endsWith('.jsonl')) files.push({ path: join(dir, f), project: d, session: f.replace('.jsonl', '') });
}

const pop = { transcripts: files.length, firstTs: null, lastTs: null, sessionsByRepo: {}, lookedAtCi: 0, sawRedCi: 0, sawRedE2E: 0, sawRedUnit: 0, sawRedE2EByRepo: {}, sawRedE2ENonDeliberate: 0, reranAnything: 0 };
const episodes = [];
const CI_HINT = /gh pr checks|gh run |'gh', *'|statusCheckRollup|check-runs|actions\/runs/;

let n = 0;
for (const f of files) {
  if (++n % 250 === 0) process.stderr.write(`${n}/${files.length}\n`);
  let raw; try { raw = readFileSync(f.path, 'utf8'); } catch { continue; }
  const t0 = raw.match(/"timestamp":"([^"]+)"/)?.[1]; const t1 = [...raw.slice(-50000).matchAll(/"timestamp":"([^"]+)"/g)].pop()?.[1];
  if (t0 && (!pop.firstTs || t0 < pop.firstTs)) pop.firstTs = t0; if (t1 && (!pop.lastTs || t1 > pop.lastTs)) pop.lastTs = t1;
  // Workspace repo: the clone the session's cwd sat in most (the workspace root holds both clones).
  const lvCwd = (raw.match(/"cwd":"[^"]*\/LinearViewer(?:\/[^"]*)?"/g) || []).length; const sdCwd = (raw.match(/"cwd":"[^"]*\/simple-dispatcher(?:\/[^"]*)?"/g) || []).length;
  const repo = lvCwd > sdCwd ? 'LinearViewer' : sdCwd > lvCwd ? 'simple-dispatcher' : 'workspace-root';
  pop.sessionsByRepo[repo] = (pop.sessionsByRepo[repo] || 0) + 1;
  if (!CI_HINT.test(raw)) continue; // cheap prefilter: no CI query string anywhere, nothing to parse

  const S = { looked: false, redAny: false, redE2E: false, redUnit: false, reran: false, ownPrs: new Set(), pushedBranches: new Set(), pushedShas: new Set(), runToPr: new Map(), branchToPr: new Map() };
  const uses = new Map(); const bgFiles = new Map(); const seenMsg = new Set(); const pushEvs = new Map();
  const open = []; const closed = []; const closedGreenRuns = new Set();
  let turn = 0; let lastTs = null; let prevTs = null; let active = 0; let workspace = null; const recentTurns = []; let turnFlags = null;

  const obsTarget = (o) => {
    const ci = o.runId ? ciRuns.get(o.runId) : null; const bySha = !ci && o.sha ? shaRuns(o.sha) : [];
    o.branch = ci?.branch || bySha.find((x) => x.repo === 'LinearViewer')?.branch || null; o.sha = o.sha || ci?.sha || null;
    if (!o.pr && o.runId && S.runToPr.has(o.runId)) o.pr = S.runToPr.get(o.runId);
    if (!o.pr && o.branch && S.branchToPr.has(o.branch)) o.pr = S.branchToPr.get(o.branch);
    if (!o.pr && ci?.prs?.length === 1) o.pr = String(ci.prs[0]);
    if (o.pr && o.runId) S.runToPr.set(o.runId, o.pr); if (o.pr && o.branch && o.branch !== 'main') S.branchToPr.set(o.branch, o.pr);
  };
  const matches = (ep, o) => (o.pr && ep.prs.has(o.pr)) || (o.runId && ep.runs.has(o.runId)) || (o.sha && ep.shas.has(o.sha)) || (o.branch && o.branch !== 'main' && ep.branches.has(o.branch))
    || (!o.pr && !o.runId && !o.branch && !o.sha && !ep.prs.size && !ep.runs.size && !ep.branches.size);
  const addEv = (kind, x, runIds) => {
    let targets = open;
    if (runIds?.length) { const hit = open.filter((ep) => runIds.some((r) => ep.runs.has(r))); if (hit.length) targets = hit; }
    const ev = { kind, turn, ts: lastTs, ...x }; for (const ep of targets) ep.ev.push(ev); if (turnFlags && kind !== 'commit' && kind !== 'merge' && (kind !== 'edit' || x.paths.some((p) => p.role === 'e2e'))) turnFlags.ci = true;
    return ev;
  };
  const addIds = (ep, g) => { if (g.pr) ep.prs.add(g.pr); if (g.runId) ep.runs.add(g.runId); if (g.branch && g.branch !== 'main') ep.branches.add(g.branch); if (g.sha) ep.shas.add(g.sha); if (g.branch === 'main') ep.onMain = true; };
  const lastStateOf = (items, shard, runId) => { let st = null; for (const i of items) if (i.job === `E2E shard ${shard}` && (!runId || !i.runId || i.runId === runId) && i.status !== 'pending') st = i.status; return st; };
  const evidenceLines = (s) => stripAnsi(s).split('\n').filter((l) => /E2E shard \d\/\d/.test(l) && !isLogLine(l)).slice(0, 6).join(' | ');

  function observe(items, runs, cmd, ts, outText, via) {
    S.looked = true; if (turnFlags) turnFlags.ci = true;
    if (items.some((i) => i.status === 'fail') || runs.some((r) => r.status === 'fail')) S.redAny = true;
    if (items.some((i) => /^[Uu]nit tests$/.test(i.job) && i.status === 'fail')) S.redUnit = true;
    const cmdPrs = prsIn(cmd); const cmdRuns = runsIn(cmd); const sha = shaIn(cmd) || (outText.match(/"(?:headSha|head_sha|headRefOid)"\s*:\s*"([0-9a-f]{40})"/) || outText.match(/headRefOid:\s*([0-9a-f]{40})/) || [])[1] || null;
    const outRuns = [...new Set(items.map((i) => i.runId).filter(Boolean))];
    // One observation per run id (or PR, when the output names no run).
    const groups = new Map();
    const group = (runId, pr) => { const key = runId ? `r${runId}` : pr ? `p${pr}` : 'x'; return groups.get(key) || groups.set(key, { runId, pr, sha: cmdRuns.length <= 1 && outRuns.length <= 1 ? sha : null, e2e: { fail: new Set(), pass: new Set(), pending: new Set() }, unitFail: false, runLevel: null }).get(key); };
    for (const i of items) {
      const runId = i.runId || (cmdRuns.length === 1 ? cmdRuns[0] : outRuns.length === 1 ? outRuns[0] : null);
      const pr = i.pr && cmdPrs.includes(i.pr) ? i.pr : cmdPrs.length === 1 ? cmdPrs[0] : i.pr || null;
      const g = group(runId, pr); if (!g.pr && pr) g.pr = pr;
      if (/^E2E shard/.test(i.job)) { const shard = i.job.slice(10); if (i.status === 'fail') g.e2e.fail.add(shard); else if (i.status === 'pass') g.e2e.pass.add(shard); else if (i.status === 'pending') g.e2e.pending.add(shard); }
      if (/^[Uu]nit tests$/.test(i.job) && i.status === 'fail') g.unitFail = true;
    }
    // A run-level success with no job lines for that run stands for four green shards.
    for (const r of runs) if (!groups.has(`r${r.runId}`)) { const g = group(r.runId, cmdPrs.length === 1 ? cmdPrs[0] : null); g.runLevel = r.status; if (r.status === 'pass') for (const s of ['1/4', '2/4', '3/4', '4/4']) g.e2e.pass.add(s); }
    for (const g of groups.values()) {
      // A job listed twice in one output (a --watch stream) keeps its last state.
      for (const s of g.e2e.pass) if (g.e2e.fail.has(s) && lastStateOf(items, s, g.runId) === 'pass') g.e2e.fail.delete(s);
      for (const s of g.e2e.fail) { g.e2e.pass.delete(s); g.e2e.pending.delete(s); }
      obsTarget(g);
      const eps = open.filter((ep) => matches(ep, g));
      if (g.e2e.fail.size) {
        S.redE2E = true;
        if (eps.length) {
          for (const ep of eps) { addIds(ep, g); ep.redObs++; for (const s of g.e2e.fail) ep.failedShards.add(s); if (g.unitFail) ep.unitAlsoRed = true; if (g.runId && !ep.redRuns.includes(g.runId)) ep.redRuns.push(g.runId); }
        } else if (!(g.runId && closedGreenRuns.has(g.runId))) {
          const dm = (g.branch || '').match(DELIBERATE_BRANCH_RE) || recentTurns.join('\n').match(DELIBERATE_TEXT_RE);
          const ep = { session: f.session, project: f.project, workspace, repo, firstRedTs: ts, firstRedTurn: turn, firstRedActive: active, via, prs: new Set(), runs: new Set(), branches: new Set(), shas: new Set(), redRuns: g.runId ? [g.runId] : [], failedShards: new Set(g.e2e.fail), unitAlsoRed: g.unitFail, redObs: 1, ev: [], specs: new Map(), flakySpecs: new Map(), ciTurns: 0, onMain: false, deliberate: dm ? clip(dm[0], 60) : null, redCommand: clip(cmd, 300), redEvidence: clip(evidenceLines(outText), 400) };
          addIds(ep, g); open.push(ep);
        }
      } else if (eps.length && !g.e2e.pending.size && g.e2e.pass.size) {
        for (const ep of eps) {
          addIds(ep, g);
          if (![...ep.failedShards].every((s) => g.e2e.pass.has(s)) && g.e2e.pass.size < 4) continue;
          Object.assign(ep, { closeTs: ts, closeTurn: turn, closeActive: active, closeRun: g.runId, closeSha: g.sha, closeRunLevel: !!g.runLevel, closeCommand: clip(cmd, 300) });
          open.splice(open.indexOf(ep), 1); closed.push(ep); for (const r of ep.redRuns) closedGreenRuns.add(r);
        }
      }
    }
  }

  function handleOutput(cmd, outText, ts, via) {
    const isCi = via !== 'cmd' || isCiCmd(cmd);
    const isLog = LOG_RE.test(cmd) || via === 'log-file';
    if (isCi) { const items = parseStatuses(outText); const runs = runLevel(outText, cmd); if (items.length || runs.length) observe(items, runs, cmd, ts, outText, via); else S.looked = true; }
    if ((isCi || isLog) && open.length) {
      const sp = specResults(outText); const runIds = runsIn(cmd);
      for (const ep of open) if (!runIds.length || runIds.some((r) => ep.runs.has(r))) {
        for (const x of sp.failed) ep.specs.set(`${x.file}|${x.title}`, x);
        for (const x of sp.flaky) ep.flakySpecs.set(`${x.file}|${x.title}`, x);
      }
    }
  }

  for (const line of raw.split('\n')) {
    if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    if (e.timestamp) { if (prevTs) active += Math.min(GAP_CAP_MIN, Math.max(0, (Date.parse(e.timestamp) - Date.parse(prevTs)) / 60000)); prevTs = e.timestamp; lastTs = e.timestamp; }
    if (e.cwd && !workspace) workspace = e.cwd;
    const m = e.message; if (!m || !Array.isArray(m.content)) continue;
    if (e.type === 'assistant') {
      if (m.id && !seenMsg.has(m.id)) {
        // An episode's ciTurns: assistant turns that queried CI, read logs, re-ran, ran Playwright, edited an E2E spec or talked about the E2E red.
        if (turnFlags?.ci) for (const ep of open) ep.ciTurns++;
        seenMsg.add(m.id); turn++; turnFlags = { ci: false }; recentTurns.push(''); if (recentTurns.length > 3) recentTurns.shift();
      }
      for (const b of m.content) {
        if (b.type === 'text' && b.text) {
          if (recentTurns.length) recentTurns[recentTurns.length - 1] += '\n' + b.text;
          if (open.length) {
            if (TOPIC_RE.test(b.text)) turnFlags.ci = true;
            const j = judge(b.text);
            if (j) for (const ep of open) {
              if (!ep.judgement) ep.judgement = { ...j, turnOffset: turn - ep.firstRedTurn, minutesAfterRed: minutes(ep.firstRedTs, lastTs) };
              if (j.kind === 'flake') (ep.flakeTexts ||= []).push({ quote: j.quote, turn });
            }
          }
        }
        if (b.type !== 'tool_use') continue;
        const inp = b.input || {}; uses.set(b.id, b);
        if (b.name === 'Bash') {
          const cmd = inp.command || '';
          if (RERUN_RE.test(cmd)) { S.reran = true; addEv('rerun', { cmd: clip(cmd, 200), failedOnly: /--failed|rerun-failed-jobs/.test(cmd), runIds: runsIn(cmd) }, runsIn(cmd)); }
          if (LOG_RE.test(cmd)) addEv('log', { cmd: clip(cmd, 200) }, runsIn(cmd));
          if (ARTIFACT_RE.test(cmd)) addEv('artifact', { cmd: clip(cmd, 200) }, runsIn(cmd));
          if (LOCAL_PW_RE.test(cmd)) uses.set(b.id, { ...b, pwEv: addEv('localPw', { cmd: clip(cmd, 200) }) });
          if (COMMIT_RE.test(cmd)) { if (recentTurns.length) recentTurns[recentTurns.length - 1] += '\n' + cmd; addEv('commit', { cmd: clip(cmd, 160), empty: /--allow-empty/.test(cmd) }); }
          if (PUSH_RE.test(cmd)) {
            const br = cmd.match(/\bgit\s+(?:-C\s+\S+\s+)?push\b(?:\s+-{1,2}[\w-]+(?:=\S+)?)*\s+origin\s+\+?(?:HEAD:)?(?:refs\/heads\/)?([\w./-]*[A-Za-z][\w./-]*)/);
            const branch = br && br[1] !== 'HEAD' ? br[1] : null; if (branch) S.pushedBranches.add(branch);
            pushEvs.set(b.id, addEv('push', { cmd: clip(cmd, 160), branch }));
          }
          const nb = cmd.match(/\bgit\s+(?:checkout|switch)\s+(?:-b|-c|-B)\s+([\w./-]+)/); if (nb) S.pushedBranches.add(nb[1]);
          if (MERGE_RE.test(cmd)) addEv('merge', { cmd: clip(cmd, 160) });
          const be = bashEdits(cmd); if (be.length) addEv('edit', { via: 'bash', paths: be.map((p) => ({ path: relPath(p), role: roleOf(p) })), code: be.some((p) => roleOf(p) !== 'doc') });
        } else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(b.name)) {
          const p = inp.file_path || inp.notebook_path || ''; if (!p || isScratch(p) || !inRepo(p)) continue;
          addEv('edit', { via: b.name, paths: [{ path: relPath(p), role: roleOf(p) }], code: roleOf(p) !== 'doc' });
        }
      }
    } else if (e.type === 'user') {
      for (const b of m.content) {
        if (b.type !== 'tool_result') continue;
        const u = uses.get(b.tool_use_id); if (!u) continue;
        const outText = text(b.content); const inp = u.input || {};
        if (u.name === 'Bash') {
          const cmd = inp.command || '';
          const bg = outText.match(/Command running in background with ID: (\w+)\. Output is being written to: (\S+?\.output)/);
          const redirect = [...cmd.matchAll(/>\s*("?)(\/[^\s;&|"]+)\1/g)].map((x) => x[2]);
          if (isCiCmd(cmd) || LOG_RE.test(cmd)) {
            const kind = isCiCmd(cmd) && !LOG_RE.test(cmd) ? 'ci-file' : 'log-file';
            if (bg) { bgFiles.set(bg[2], { cmd, kind }); bgFiles.set(bg[1], { cmd, kind }); }
            for (const r of redirect) bgFiles.set(r, { cmd, kind });
          }
          if (/gh\s+pr\s+create/.test(cmd)) for (const x of outText.matchAll(/\/pull\/(\d+)/g)) S.ownPrs.add(x[1]);
          if (PUSH_RE.test(cmd)) {
            for (const x of outText.matchAll(/(?:([0-9a-f]{7,40})\.\.\.?([0-9a-f]{7,40})|\[new branch\])\s+(\S+)\s+->\s+(\S+)/g)) { if (x[2]) S.pushedShas.add(x[2]); if (!/^origin\//.test(x[4])) { S.pushedBranches.add(x[4]); const pe = pushEvs.get(b.tool_use_id); if (pe && !pe.branch) pe.branch = x[4]; } }
            const pe = pushEvs.get(b.tool_use_id); if (pe && /\[rejected\]|error: failed to push/.test(outText)) pe.failed = true;
          }
          if (u.pwEv) u.pwEv.failed = /\b\d+ failed\b/.test(stripAnsi(outText));
          if (bg) continue;
          // A cat/tail/grep of a file a CI command wrote earlier is that command's output.
          const src = [...bgFiles.entries()].find(([p]) => cmd.includes(p) && !/\bgh\s/.test(cmd));
          if (src) handleOutput(src[1].cmd, outText, e.timestamp, src[1].kind);
          else handleOutput(cmd, outText, e.timestamp, 'cmd');
        } else if (u.name === 'Read' || u.name === 'TaskOutput' || u.name === 'BashOutput') {
          const src = bgFiles.get(inp.file_path || inp.task_id || inp.bash_id || ''); if (src) handleOutput(src.cmd, outText, e.timestamp, src.kind);
        }
      }
    }
  }
  if (turnFlags?.ci) for (const ep of open) ep.ciTurns++;

  const eps = [...closed, ...open].map((ep) => finish(ep, S, lastTs, turn, active));
  episodes.push(...eps);
  if (S.looked) pop.lookedAtCi++; if (S.redAny || S.redE2E) pop.sawRedCi++; if (S.redUnit) pop.sawRedUnit++; if (S.reran) pop.reranAnything++;
  if (S.redE2E) { pop.sawRedE2E++; pop.sawRedE2EByRepo[repo] = (pop.sawRedE2EByRepo[repo] || 0) + 1; if (eps.some((e) => e.class !== 'deliberate-red')) pop.sawRedE2ENonDeliberate++; }
}

function finish(ep, S, endTs, lastTurn, endActive) {
  const resolved = ep.closeTs != null;
  const stopTs = resolved ? ep.closeTs : endTs; const stopTurn = resolved ? ep.closeTurn : lastTurn;
  const ev = ep.ev.filter((x) => !resolved || x.turn <= ep.closeTurn);
  const edits = ev.filter((x) => x.kind === 'edit'); const codeEdits = edits.filter((x) => x.code);
  const reruns = ev.filter((x) => x.kind === 'rerun').map((x) => ({ turnOffset: x.turn - ep.firstRedTurn, failedOnly: x.failedOnly, runIds: x.runIds, clean: !ev.some((y) => ((y.kind === 'edit' && y.code) || y.kind === 'commit') && y.turn <= x.turn), cmd: x.cmd }));
  const commits = ev.filter((x) => x.kind === 'commit');
  const pushes = ev.filter((x) => x.kind === 'push' && !x.failed && (!x.branch || !ep.branches.size || ep.branches.has(x.branch)));
  const logs = ev.filter((x) => x.kind === 'log').length; const artifacts = ev.filter((x) => x.kind === 'artifact').length; const localPw = ev.filter((x) => x.kind === 'localPw');
  const turns = stopTurn - ep.firstRedTurn; const mins = minutes(ep.firstRedTs, stopTs); const activeMins = +(((resolved ? ep.closeActive : endActive) - ep.firstRedActive)).toFixed(1);
  let greenVia = null;
  if (resolved) {
    if (ep.closeRun) greenVia = ep.redRuns.includes(ep.closeRun) ? (reruns.length ? 'same-run (session rerun)' : 'same-run (rerun outside session)') : 'new-run';
    else {
      // No run id on the green observation: ask the CI snapshot (red run later succeeded on a re-run, or a newer run on the branch
      // succeeded before the green was seen), then the session's own pushes/re-runs.
      const red = ciRuns.get(ep.redRuns[ep.redRuns.length - 1]);
      const newer = red && [...ciRuns.values()].some((x) => x.branch === red.branch && x.id > red.id && x.conclusion === 'success' && x.createdAt <= ep.closeTs);
      if (ep.closeSha && red?.sha && !red.sha.startsWith(ep.closeSha) && !ep.closeSha.startsWith(red.sha)) greenVia = 'new-run (inferred: different sha)';
      else if (red && red.conclusion === 'success' && red.attempts > 1 && !newer) greenVia = reruns.length ? 'same-run (session rerun, inferred from CI)' : 'same-run (rerun outside session, inferred from CI)';
      else if (newer) greenVia = 'new-run (inferred from CI)';
      else if (pushes.length) greenVia = 'new-run (inferred: session pushed)';
      else if (reruns.length) greenVia = 'same-run (session rerun, inferred)';
      else greenVia = 'unattributed';
    }
  }
  const sameRun = greenVia?.startsWith('same-run');
  // Edits that could be in the green commit: none on a same-run green; else those before the last push to this branch.
  const lastPush = pushes.length ? pushes[pushes.length - 1].turn : -1;
  const shipped = !resolved ? codeEdits : sameRun ? [] : codeEdits.filter((x) => x.turn <= lastPush);
  const pathsOf = (xs) => { const mp = new Map(); for (const x of xs) for (const p of x.paths) mp.set(p.path, p.role); return mp; };
  const allPaths = pathsOf(edits); const shippedPaths = pathsOf(shipped);
  const byRole = {}; for (const r of allPaths.values()) byRole[r] = (byRole[r] || 0) + 1;
  const spec = [...shippedPaths.values()].some((r) => SPEC_SIDE.has(r)); const prod = [...shippedPaths.values()].some((r) => PROD_SIDE.has(r));
  const diagSignals = [logs && 'read-ci-log', localPw.length && 'ran-playwright-locally', artifacts && 'downloaded-artifacts', turns > DIAG_TURNS && `>${DIAG_TURNS}-turns`].filter(Boolean);
  let cls;
  if (ep.deliberate) cls = 'deliberate-red';
  else if (!resolved) cls = 'unresolved';
  else if (spec && prod) cls = 'edited-both';
  else if (spec) cls = 'edited-spec';
  else if (prod) cls = 'edited-prod';
  else if (greenVia === 'unattributed') cls = 'no-edit-green-unattributed';
  else if (!sameRun) cls = 'no-edit-new-run';
  else cls = diagSignals.length ? 'diagnosed-then-rerun' : 'rerun-only';
  // CI snapshot join: head sha / branch of each red run, and whether that sha ever concluded success.
  const ci = ep.redRuns.map((r) => ciRuns.get(r)).filter(Boolean);
  for (const c of ci) { ep.shas.add(c.sha); if (c.branch && c.branch !== 'main') ep.branches.add(c.branch); if (c.branch === 'main') ep.onMain = true; }
  const shaPassed = ci.filter((c) => (c.conclusion === 'success' && c.attempts > 1) || (runsBySha.get(c.sha) || []).some((x) => x.conclusion === 'success'));
  const ciSpecs = ep.redRuns.flatMap((r) => ciFailures(r).map((x) => ({ ...x, runId: r })));
  const sessionSpecs = [...ep.specs.values()];
  const failingFiles = new Set([...sessionSpecs, ...ciSpecs].map((x) => x.file));
  const failingSpecEdited = [...allPaths.keys()].some((p) => failingFiles.has(p));
  const e2eEdited = [...allPaths.values()].some((r) => r === 'e2e');
  const firstEdit = (shipped.length ? shipped : codeEdits)[0];
  const laterFlake = firstEdit ? (ep.flakeTexts || []).find((x) => x.turn > firstEdit.turn && (!resolved || x.turn <= ep.closeTurn + 5)) : null;
  const why = [];
  if (cls !== 'deliberate-red') {
    if (sameRun && codeEdits.length && (e2eEdited || failingSpecEdited || ep.judgement?.kind === 'real')) why.push('edited spec/called it real, then a re-run of the unedited commit went green');
    if ((shipped.length || (!resolved && (e2eEdited || failingSpecEdited || ep.judgement?.kind === 'real'))) && shaPassed.length) why.push(`CI: red sha ${shaPassed.map((c) => c.sha.slice(0, 8)).join(',')} concluded success`);
    if ((shipped.length || !resolved) && laterFlake && codeEdits.length) why.push('own later text calls it a flake');
  }
  const own = [...ep.prs].some((p) => S.ownPrs.has(p)) || [...ep.branches].some((b) => S.pushedBranches.has(b)) || [...ep.shas].some((s) => [...S.pushedShas].some((p) => s.startsWith(p)))
    ? true : ep.onMain ? null : (ep.branches.size || ep.prs.size) ? false : null;
  return {
    session: ep.session, workspace: ep.workspace, repo: ep.repo, own, onMain: ep.onMain, deliberate: ep.deliberate, firstRedTs: ep.firstRedTs, closeTs: ep.closeTs || null, sessionEndTs: endTs,
    prs: [...ep.prs], runIds: [...new Set([...ep.redRuns, ...ep.runs])], redRunIds: ep.redRuns, greenRunId: ep.closeRun || null, headShas: [...ep.shas], branches: [...ep.branches],
    failedShards: [...ep.failedShards].sort(), unitAlsoRed: ep.unitAlsoRed, redObservations: ep.redObs, observedVia: ep.via,
    class: cls, resolved, greenVia, greenRunLevelOnly: !!ep.closeRunLevel, diagnosisSignals: diagSignals,
    reruns: reruns.length, rerunsClean: reruns.filter((r) => r.clean).length, rerunDetail: reruns,
    ranPlaywrightLocally: localPw.length, localPlaywrightFailed: localPw.filter((x) => x.failed).length, readCiLog: logs, downloadedArtifacts: artifacts,
    edits: { tools: edits.length, codeTools: codeEdits.length, shippedCodeTools: shipped.length, filesByRole: byRole, files: [...allPaths.entries()].slice(0, 25).map(([p, r]) => `${r}:${p}`) },
    commits: commits.length, emptyCommits: commits.filter((c) => c.empty).length, pushes: pushes.length, mergedWhileRed: ev.some((x) => x.kind === 'merge'),
    turns, ciTurns: ep.ciTurns, minutes: mins, activeMinutes: activeMins,
    judgement: ep.judgement || null, laterFlakeText: laterFlake ? { quote: laterFlake.quote, turnOffset: laterFlake.turn - ep.firstRedTurn } : null, firstCodeEditTurnOffset: codeEdits[0] ? codeEdits[0].turn - ep.firstRedTurn : null,
    failingSpecs: sessionSpecs.slice(0, 12), flakySpecsInLog: [...ep.flakySpecs.values()].slice(0, 8), ciFailingSpecs: ciSpecs.slice(0, 12), failingSpecEdited,
    ciRedRuns: ci.map((c) => ({ runId: c.id, sha: c.sha, branch: c.branch, event: c.event, finalConclusion: c.conclusion, attempts: c.attempts })),
    editedButFlake: why.length > 0, editedButFlakeWhy: why, editedButFlakeStrict: why.length > 0 && (failingSpecEdited || ep.judgement?.kind === 'real'),
    evidence: { redCommand: ep.redCommand, redLines: ep.redEvidence, closeCommand: ep.closeCommand || null },
  };
}

// ---- summarise ---------------------------------------------------------------------------------------------------------
const CLASSES = ['rerun-only', 'diagnosed-then-rerun', 'no-edit-new-run', 'no-edit-green-unattributed', 'edited-spec', 'edited-prod', 'edited-both', 'unresolved', 'deliberate-red'];
const table = (eps) => Object.fromEntries(CLASSES.map((c) => {
  const xs = eps.filter((e) => e.class === c);
  return [c, { episodes: xs.length, sessions: new Set(xs.map((e) => e.session)).size, reruns: sum(xs.map((e) => e.reruns)), turns: sum(xs.map((e) => e.turns)), ciTurns: sum(xs.map((e) => e.ciTurns)), minutes: sum(xs.map((e) => e.minutes)), activeMinutes: sum(xs.map((e) => e.activeMinutes)), medianTurns: median(xs.map((e) => e.turns)), medianCiTurns: median(xs.map((e) => e.ciTurns)), medianMinutes: median(xs.map((e) => e.minutes)), medianActiveMinutes: median(xs.map((e) => e.activeMinutes)), readLog: xs.filter((e) => e.readCiLog).length, ranLocal: xs.filter((e) => e.ranPlaywrightLocally).length, flakeJudgement: xs.filter((e) => e.judgement?.kind === 'flake').length, realJudgement: xs.filter((e) => e.judgement?.kind === 'real').length }];
}).filter(([, v]) => v.episodes));
const specAgg = {};
for (const e of episodes) {
  if (e.class === 'deliberate-red') continue;
  const specs = e.failingSpecs.length ? e.failingSpecs : e.ciFailingSpecs;
  for (const file of new Set(specs.map((x) => x.file))) { const a = (specAgg[file] ||= { file, episodes: 0, sessions: new Set(), fromSessionLog: 0, titles: new Set() }); a.episodes++; a.sessions.add(e.session); if (e.failingSpecs.length) a.fromSessionLog++; for (const x of specs) if (x.file === file) a.titles.add(x.title); }
}
const topSpecs = Object.values(specAgg).map((a) => ({ ...a, sessions: a.sessions.size, titles: [...a.titles].slice(0, 5) })).sort((a, b) => b.episodes - a.episodes || b.sessions - a.sessions).slice(0, 25);
const real = episodes.filter((e) => e.class !== 'deliberate-red');
const own = real.filter((e) => e.own === true);
const flagged = real.filter((e) => e.editedButFlake);
const summary = {
  generatedAt: new Date().toISOString(), projectsRoot: root, ciSnapshot: existsSync(ciPath) ? ciPath : null, diagTurns: DIAG_TURNS, gapCapMinutes: GAP_CAP_MIN,
  population: { ...pop, sessionsWithE2EEpisodes: new Set(episodes.map((e) => e.session)).size },
  episodes: episodes.length, deliberate: episodes.length - real.length, episodesOwn: own.length, episodesOnMain: real.filter((e) => e.onMain).length, episodesOthersPr: real.filter((e) => e.own === false).length,
  byClass: table(episodes), byClassOwn: table(own),
  greenVia: real.reduce((a, e) => ((a[e.greenVia || 'none'] = (a[e.greenVia || 'none'] || 0) + 1), a), {}),
  editedButFlake: { loose: flagged.length, strict: flagged.filter((e) => e.editedButFlakeStrict).length, episodesWithCodeEdits: real.filter((e) => e.edits.codeTools).length, why: flagged.reduce((a, e) => { for (const w of e.editedButFlakeWhy) { const k = w.replace(/ [0-9a-f,]{8,}/, ''); a[k] = (a[k] || 0) + 1; } return a; }, {}) },
  judgements: real.reduce((a, e) => ((a[e.judgement?.kind || 'none'] = (a[e.judgement?.kind || 'none'] || 0) + 1), a), {}),
  topSpecs,
  joinKeys: { prs: [...new Set(episodes.flatMap((e) => e.prs))].sort(), runIds: [...new Set(episodes.flatMap((e) => e.runIds))].sort(), headShas: [...new Set(episodes.flatMap((e) => e.headShas))].sort() },
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ ...summary, episodes }, null, 1));

const p = summary.population;
console.log(`sessions scanned=${p.transcripts} (${Object.entries(p.sessionsByRepo).map(([k, v]) => `${k} ${v}`).join(', ')}), transcripts ${p.firstTs?.slice(0, 10)} … ${p.lastTs?.slice(0, 10)}`);
console.log(`looked at CI=${p.lookedAtCi}  saw red CI=${p.sawRedCi}  saw red E2E=${p.sawRedE2E} (${Object.entries(p.sawRedE2EByRepo).map(([k, v]) => `${k} ${v}`).join(', ')}; not deliberate ${p.sawRedE2ENonDeliberate})  saw red unit=${p.sawRedUnit}  ran gh run rerun=${p.reranAnything}`);
console.log(`E2E episodes=${episodes.length} (deliberate ${summary.deliberate}; own ${own.length}, on main ${summary.episodesOnMain}, others' PRs ${summary.episodesOthersPr}) in ${p.sessionsWithE2EEpisodes} sessions; green via ${JSON.stringify(summary.greenVia)}`);
console.log(['class', 'ep', 'sess', 'reruns', 'turns', 'ciTurns', 'min', 'activeMin', 'medTurns', 'medActiveMin', 'readLog', 'ranLocal', 'saysFlake', 'saysReal'].join('\t'));
for (const [c, r] of Object.entries(summary.byClass)) console.log([c, r.episodes, r.sessions, r.reruns, r.turns, r.ciTurns, r.minutes, r.activeMinutes, r.medianTurns, r.medianActiveMinutes, r.readLog, r.ranLocal, r.flakeJudgement, r.realJudgement].join('\t'));
console.log(`editedButFlake: ${flagged.length} loose / ${summary.editedButFlake.strict} strict of ${summary.editedButFlake.episodesWithCodeEdits} episodes with code edits ${JSON.stringify(summary.editedButFlake.why)}`);
for (const e of flagged.slice(0, 8)) console.log(`  ${e.session.slice(0, 8)} ${e.firstRedTs?.slice(0, 10)} PR ${e.prs.join(',') || '?'} ${e.class} shards ${e.failedShards.join(',')} spec ${(e.failingSpecs[0] || e.ciFailingSpecs[0])?.file || '?'} — ${e.editedButFlakeWhy.join('; ')} — "${clip(e.laterFlakeText?.quote || e.judgement?.quote || '', 120)}"`);
console.log('top failing specs (episodes, sessions):');
for (const s of topSpecs.slice(0, 10)) console.log(`  ${s.file}\t${s.episodes}\t${s.sessions}\t${s.titles[0] || ''}`);
console.log(`join keys: ${summary.joinKeys.prs.length} PRs, ${summary.joinKeys.runIds.length} run ids, ${summary.joinKeys.headShas.length} head shas → ${out}`);
