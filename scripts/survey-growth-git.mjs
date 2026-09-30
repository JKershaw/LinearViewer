// LIN-3147: weekly code, test and agent-reading series for LinearViewer (Harbour) or simple-dispatcher, at the last first-parent commit of each ISO week, from git history alone.
// Usage: node scripts/survey-growth-git.mjs <lv|sd> [repoPath=.] [rev=origin/main] [--json]
import { execFileSync } from 'child_process';
import { GROUPS } from './steady-base-growth.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [which, repo = '.', rev = 'origin/main'] = args;
const git = (a, input) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 30, input, stdio: ['pipe', 'pipe', 'ignore'] });

// Production areas, first match wins. Prompt-bearing code is its own area in Harbour: it is what agents read.
const LV = {
  isProd: (p) => /\.(js|mjs)$/.test(p) && (p === 'server.js' || /^(lib|routes)\//.test(p) || (/^public\//.test(p) && !/vendor|\.min\./.test(p))),
  isTest: (p) => /^tests\/.*\.(js|mjs)$/.test(p) && !/^tests\/fixtures\//.test(p),
  areas: [
    ['prompt text', /^lib\/(prompts\/|prompt-(templates|template-defs|formatters)\.js$|proxy-(instructions|preamble)\.js$)/],
    ['UI (public, components)', /^(public\/|lib\/components\/)/],
    ['routes + server', /^(routes\/|server\.js$)/],
    ['tracker providers', /^lib\/(providers\/|linear|github|jira|local-store)/],
    ['dispatch + fleet', /^lib\/(dispatch|autopilot|passage|observation|observer|wake|loop|harbour-spawn|agent-|completion-signals|follow-on|recommend|next-run|runner-kit|periodical|stack|ruling|escalation|budget|halt|pipeline-|plan-review|task-(decisions|snapshot)|unanswered|dismissal|digest-feedback|terminal-marked|effort|transcript-spend|live-console)/],
    ['proxy', /^lib\/proxy-/],
    ['accounts + credentials', /^lib\/(account|connection|credential|email|auth|session|token|oauth|free-tier|github-install|owner-credential|workspace|user-pref|secret-scan|audit)/],
    ['views + rendering', /^lib\/(render|tree|swim|ship-|roadmap|kpi|north-star|view)/],
    ['chat + LLM calls', /^lib\/(chat-|openrouter|flight-companion|llm-|model-pricing|collective|brief|context-graph)/],
    ['other lib', /^lib\//],
  ],
};
const SD = {
  isProd: (p) => /^[^/]+\.js$/.test(p) && !/^e2e-/.test(p),
  isTest: (p) => /^test\/.*\.(js|mjs)$/.test(p) && !/fixtures?\//.test(p),
  areas: [
    ['hook + state', /^(hook|phases|state-store|oplog|heartbeat|reapers|transcript|halt|abort|refusal|subscription)\.js$/],
    ['launch + harnesses', /^(terminal-driver|harnesses|opencode-|executors|clones|targets|launch-|resources|resource-metrics|chunk)/],
    ['poll + dispatch', /^(dispatcher|queue|admission|pacing|followup|feedback|http|net-util|links|format|config|load-env)\.js$/],
    ['other', /./],
  ],
};
const R = which === 'sd' ? SD : LV;

// What agents are told to read. Harbour's groups come from steady-base-growth.mjs, extended.
const READING = which === 'sd' ? {
  'CLAUDE.md': ['CLAUDE.md'],
  'docs/': ['docs/'],
  'README.md': ['README.md'],
} : {
  ...GROUPS,
  'docs/architecture/': ['docs/architecture/'],
  'proxy preamble': ['lib/proxy-preamble.js'],
  'other lib/prompts': ['lib/prompts/'],
};

const COMMENT = /^\s*(\/\/|\/\*|\*)/;
const TEST_CASE = /^\s*(it|test|t\.test)(\.only|\.skip|\.todo)?\s*\(/;
// A text pin asserts that a string is present in, or absent from, some text.
const TEXT_PIN = /assert\.(match|doesNotMatch)\s*\(|\.includes\s*\(/g;
const ENDPOINT = /\b(app|router|r)\.(get|post|put|patch|delete)\s*\(\s*['"`]/g;

function weekEnds() {
  const seen = new Map();
  for (const l of git(['log', '--first-parent', '--format=%H %cs', rev]).trim().split('\n')) {
    const [sha, day] = l.split(' ');
    const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const wk = d.toISOString().slice(0, 10);
    if (!seen.has(wk)) seen.set(wk, sha); // newest first → the week's last commit
  }
  return [...seen.entries()].reverse();
}

function readBlobs(sha, paths) {
  if (!paths.length) return [];
  const buf = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: paths.map((p) => `${sha}:${p}`).join('\n') + '\n', maxBuffer: 1 << 30 });
  const out = []; let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(10, i); const size = Number(buf.slice(i, nl).toString().split(' ')[2]);
    if (!Number.isFinite(size)) { i = nl + 1; out.push(''); continue; }
    out.push(buf.slice(nl + 1, nl + 1 + size).toString('utf8')); i = nl + 1 + size + 1;
  }
  return out;
}

// Merged PRs and commits per week, on the first-parent line.
function activity() {
  const out = {};
  for (const l of git(['log', '--first-parent', '--format=%cs %p|%s', rev]).trim().split('\n')) {
    const [head, subject] = l.split('|');
    const [day, ...parents] = head.split(' ');
    const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const wk = d.toISOString().slice(0, 10);
    const r = (out[wk] ||= { commits: 0, mergedPRs: 0 });
    r.commits++;
    if (parents.length > 1 || /\(#\d+\)$/.test(subject)) r.mergedPRs++;
  }
  return out;
}

const act = activity();
const rows = [];
for (const [week, sha] of weekEnds()) {
  const sizes = new Map(git(['ls-tree', '-r', '-l', sha]).trim().split('\n').map((l) => { const [meta, path] = l.split('\t'); return [path, Number(meta.trim().split(/\s+/)[3]) || 0]; }));
  const files = [...sizes.keys()];
  const prod = files.filter(R.isProd), tests = files.filter(R.isTest);
  const r = { week, sha: sha.slice(0, 8), ...(act[week] || { commits: 0, mergedPRs: 0 }), areas: {}, prodLines: 0, prodCommentLines: 0, testLines: 0, testFiles: tests.length, testCases: 0, textPins: 0, endpoints: 0, reading: {} };
  const blobs = readBlobs(sha, prod);
  prod.forEach((p, i) => {
    const area = R.areas.find(([, re]) => re.test(p))[0];
    const a = (r.areas[area] ||= { lines: 0, comments: 0 });
    for (const line of blobs[i].split('\n')) {
      if (!line.trim()) continue;
      a.lines++; r.prodLines++;
      if (COMMENT.test(line)) { a.comments++; r.prodCommentLines++; }
    }
    if (/^(routes\/|server\.js$|http\.js$)/.test(p)) r.endpoints += (blobs[i].match(ENDPOINT) || []).length;
  });
  for (const text of readBlobs(sha, tests)) {
    for (const line of text.split('\n')) { if (!line.trim()) continue; r.testLines++; if (TEST_CASE.test(line)) r.testCases++; }
    r.textPins += (text.match(TEXT_PIN) || []).length;
  }
  for (const [g, ps] of Object.entries(READING)) {
    // A trailing slash is a directory (markdown only); a prefix already counted by another group is skipped.
    const claimed = new Set(Object.entries(READING).filter(([k]) => k !== g).flatMap(([, v]) => v.filter((x) => !x.endsWith('/'))));
    r.reading[g] = files.filter((f) => ps.some((p) => (p.endsWith('/') ? f.startsWith(p) && (/\.md$/.test(f) || p.startsWith('lib/')) && !claimed.has(f) : f === p))).reduce((s, f) => s + sizes.get(f), 0);
  }
  r.readingBytes = Object.values(r.reading).reduce((s, b) => s + b, 0);
  rows.push(r);
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ repo: which, rev, head: git(['rev-parse', '--short=8', rev]).trim(), rows }));
else {
  console.log('week        sha      commits PRs  prodLines comment% testLines tests  pins endpoints readingKB');
  for (const r of rows) console.log(`${r.week} ${r.sha} ${String(r.commits).padStart(7)} ${String(r.mergedPRs).padStart(3)} ${String(r.prodLines).padStart(10)} ${(100 * r.prodCommentLines / Math.max(1, r.prodLines)).toFixed(1).padStart(8)} ${String(r.testLines).padStart(9)} ${String(r.testCases).padStart(5)} ${String(r.textPins).padStart(5)} ${String(r.endpoints).padStart(9)} ${(r.readingBytes / 1024).toFixed(0).padStart(9)}`);
}
