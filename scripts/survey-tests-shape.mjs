// LIN-3151: classify every test case in LinearViewer and simple-dispatcher as behavioural, text pin, census/count pin, source scan, e2e/system or other, by assertion shape and what the test reads; join per-test runtime from survey-tests-timing.mjs.
// Usage: node scripts/survey-tests-shape.mjs [--sd ../simple-dispatcher] [--rev origin/main] [--timing data/survey-tests] [--out data/survey-tests/shape.json] [--sample 60 --seed 3151]
// Heuristic, per test body (the lines from one it()/test() call to the next): the first class that fits wins, in the order e2e, census, source scan, text pin, behavioural, other.
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const flag = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const rev = flag('--rev', 'origin/main');
const timingDir = flag('--timing', 'data/survey-tests');
const out = flag('--out', 'data/survey-tests/shape.json');
const REPOS = { lv: '.', sd: flag('--sd', '../simple-dispatcher') };

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 });

// Which files are tests, and which of them are end-to-end or full-system.
const SUITE = {
  lv: { test: /^tests\/(unit|e2e|visual)\/[^/]+\.(test|spec)\.js$/, e2e: /^tests\/(e2e|visual)\// },
  sd: { test: /^test\/(system\/)?[^/]+\.test\.js$/, e2e: /^test\/system\// },
};

// Areas by file-name keyword, first match wins.
const AREAS = {
  lv: [
    ['dispatch & queue', /dispatch|queue|preset|wake|terminal|followup|follow-up/],
    ['fleet loops & observation', /observ|flight|companion|pipeline|loop|autopilot|passage|periodical|stepper|fossil|sweep|digest|escalat|session|run-/],
    ['prompts & instructions', /prompt|template|instruction|preamble|meta|brief|recap|recommend|prose|wording|copy/],
    ['auth, providers & credentials', /auth|credential|token|oauth|github|jira|email|account|connection|provider|linear|lin-1[5-9]\d\d|lin-2[0-4]\d\d/],
    ['UI & pages', /render|page|landing|nav|footer|swim|swipe|roadmap|dashboard|settings|theme|css|style|chat|ship|kpi|archive|markdown|html|component/],
    ['repo meta (docs, census, lint)', /claude-md|docs|census|inventory|lint|hermetic|secret|budget|parity|allow/],
    ['proxy API & workspace', /proxy|api|route|workspace|server|scope|store|issue|tree|project/],
  ],
  sd: [
    ['hook & state machine', /hook|phase|state|substrate|lifecycle|transition|stop/],
    ['harnesses (opencode)', /opencode|harness/],
    ['terminal & launch', /terminal|launch|applescript|iterm|kitty|tmux|window|clone|workspace/],
    ['reapers, halts & heartbeat', /reap|halt|abort|heartbeat|watchdog|stale|dead|pause|breaker/],
    ['queue, admission & pacing', /dispatch|queue|admission|pacing|claim|poll|resource|max-|refire/],
    ['feedback & transcripts', /feedback|transcript|format|refusal|chunk|telemetry|usage|link|marker/],
  ],
};

const TEST_CASE = /^\s*(it|test|t\.test|await\s+t\.test)(\.only|\.skip|\.todo)?\s*\(/;
const ASSERT = /\bassert(\.\w+)?\s*\(|\bexpect\s*\(/g;
const TEXT_ASSERT = /assert\.(match|doesNotMatch)\s*\(|\.includes\s*\(|\.(toContain|toMatch|toHaveText|toContainText)\s*\(|\.(startsWith|endsWith|indexOf)\s*\(/g;
// A total asserted against a number literal: equal(x.length, 7), equal(count, 12), toHaveLength(3).
const COUNT_ASSERT = /assert\.(strict)?(deepStrictEqual|strictEqual|equal)\s*\([^;]*?(\.length|\.size|[cC]ount|[tT]otal|\bn[A-Z]\w*)\b[^;]*?,\s*\d+\s*[,)]|toHaveLength\s*\(\s*\d+|toHaveCount\s*\(\s*\d+/g;
// A census file names itself ("census" is also a product word, so test names are not read); otherwise it is a number literal asserted on the size of an exported inventory (UPPER_CASE) or of a doc.
const CENSUS_NAME = /census|inventory|roster|line budget|byte budget|line cap/i;
const INVENTORY_COUNT = /(assert\.(strict)?(deepStrictEqual|strictEqual|equal)\s*\(\s*(Object\.(keys|values|entries)\(\s*)?[A-Z][A-Z0-9_]{2,}\b[^;]*?\.(length|size)\s*,\s*\d+)|expect\s*\(\s*[A-Z][A-Z0-9_]{2,}\s*\)\.toHaveLength\(\s*\d+/;
// A literal that names production source (read as text) or a doc/prompt (read as text).
const SRC_LIT = /['"`][^'"`]*(\.(m?js|css|html)|\/(lib|routes|public|scripts)\/?|^(lib|routes|public))['"`]|['"`](lib|routes|public|scripts)['"`]|server\.js/;
const DOC_LIT = /['"`][^'"`]*(\.md|\.txt|\.prompt|CLAUDE|prompts?\/|templates?\/|docs\/)[^'"`]*['"`]|['"`](docs|prompts|templates)['"`]/;
const PROMPT_IMPORT = /from\s+['"][^'"]*(prompt|template|instruction|preamble|periodical|runner-kit|close-out|brief|copy)[^'"]*['"]|require\(['"][^'"]*(prompt|template|instruction|preamble|followup|format)[^'"]*['"]\)/;
// What a text assertion is matched against: a prompt or doc, or rendered HTML.
const PROMPT_SUBJECT = /prompt|instruction|template|kickoff|manual|preamble|brief|recap|\bmd\b|markdown|doc|claude|rule|guidance|meta|checklist|kit|tpl|copy|handbook/i;
// Generic names count as prompt text only in a file that imports a prompt producer.
const WEAK_SUBJECT = /body|text|tail|step|section|block|message|msg|note|out/i;
const HTML_SUBJECT = /html|page|dom|\bres\b|response|css|style|\$|stdout|stderr|log|err|url|href/i;
const SUBJECT = /assert\.(?:match|doesNotMatch)\s*\(\s*([\w.$[\]'"()]+)|([\w.$\])]+)\.(?:includes|startsWith|endsWith|indexOf)\s*\(|expect\s*\(\s*([\w.$[\]'"()]+)\s*\)\s*\.(?:not\.)?(?:toContain|toMatch)/g;

function fileContext(text) {
  const srcVars = new Set(), docVars = new Set(), srcFns = new Set(), docFns = new Set();
  // Statements that call readFileSync / readdirSync, joined across line breaks up to the semicolon.
  const stmts = text.split(/;\s*\n/);
  for (const s of stmts) {
    if (!/read(File|dir)Sync/.test(s)) continue;
    const isSrc = SRC_LIT.test(s) && !/\.(json|jsonl|log)['"`]/.test(s);
    const isDoc = !isSrc && DOC_LIT.test(s);
    const v = s.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?[^=]*read(File|dir)Sync/);
    const fn = s.match(/function\s+(\w+)\s*\(|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
    if (fn && !v) { const name = fn[1] || fn[2]; (isDoc ? docFns : srcFns).add(name); continue; }
    if (v && isSrc) srcVars.add(v[1]);
    else if (v && isDoc) docVars.add(v[1]);
  }
  return { srcVars, docVars, srcFns, docFns, promptImport: PROMPT_IMPORT.test(text) };
}

const mentions = (body, names) => [...names].some((n) => new RegExp(`\\b${n}\\b`).test(body));

function classify(repo, file, body, name, ctx) {
  const asserts = (body.match(ASSERT) || []).length;
  const text = (body.match(TEXT_ASSERT) || []).length;
  const count = (body.match(COUNT_ASSERT) || []).length;
  const readsSrc = mentions(body, ctx.srcVars) || /read(File|dir)Sync\([^)]*(lib|routes|public|server\.js|\.m?js['"`])/.test(body)
    || [...ctx.srcFns].some((f) => new RegExp(`\\b${f}\\s*\\(\\s*['"\`][^'"\`]*\\.(m?js|css|html)`).test(body));
  const readsDoc = mentions(body, ctx.docVars) || /readFileSync\([^)]*(\.md|CLAUDE|docs|prompts|templates)/.test(body)
    || [...ctx.docFns].some((f) => new RegExp(`\\b${f}\\s*\\(`).test(body));
  const subjects = [...body.matchAll(SUBJECT)].map((m) => m[1] || m[2] || m[3] || '');
  const promptSubj = subjects.filter((x) => (PROMPT_SUBJECT.test(x) || (ctx.promptImport && WEAK_SUBJECT.test(x))) && !HTML_SUBJECT.test(x)).length;
  const htmlSubj = subjects.filter((x) => HTML_SUBJECT.test(x)).length;
  const textOnly = text > 0 && text >= asserts - 1;
  let cls;
  if (SUITE[repo].e2e.test(file)) cls = 'e2e';
  else if (asserts && (CENSUS_NAME.test(file.split('/').pop()) || INVENTORY_COUNT.test(body) || (count && (readsDoc || readsSrc)))) cls = 'census';
  else if (readsSrc && asserts) cls = 'source scan';
  else if (textOnly && (readsDoc || (promptSubj > 0 && promptSubj * 2 >= subjects.length && !/^render-/.test(file.split('/').pop())))) cls = 'text pin';
  else if (asserts) cls = 'behavioural';
  else cls = 'other';
  // Kept inside behavioural, but flagged: text-only assertions on rendered HTML or output.
  const renderText = cls === 'behavioural' && textOnly && htmlSubj > 0;
  return { cls, asserts, textAsserts: text, countAsserts: count, renderText };
}

function nameOf(line) {
  const m = line.match(/\(\s*(['"`])((?:\\.|(?!\1).)*)\1/);
  return m ? m[2] : null;
}

// The file name decides; failing that, the production modules it imports do.
function area(repo, file, src) {
  const base = file.split('/').pop();
  const imports = [...src.matchAll(/(?:from\s+|require\()['"](\.\.?\/[^'"]+)['"]/g)].map((m) => m[1].split('/').pop()).filter((m) => !/fixture|helper|harness|mock/.test(m)).join(' ');
  return (AREAS[repo].find(([, re]) => re.test(base)) || AREAS[repo].find(([, re]) => re.test(imports)) || ['other'])[0];
}

function loadTiming(repo) {
  const p = resolve(timingDir, `${repo}-perfile.json`);
  if (!existsSync(p)) return new Map();
  return new Map(JSON.parse(readFileSync(p, 'utf8')).rows.map((r) => [r.file, r]));
}

const tests = [], files = [];
for (const [repo, dir] of Object.entries(REPOS)) {
  const timing = loadTiming(repo);
  const paths = git(dir, ['ls-tree', '-r', '--name-only', rev]).split('\n').filter((f) => SUITE[repo].test.test(f));
  for (const file of paths) {
    const src = git(dir, ['show', `${rev}:${file}`]);
    const lines = src.split('\n');
    const ctx = fileContext(src);
    const starts = lines.map((l, i) => (TEST_CASE.test(l) ? i : -1)).filter((i) => i >= 0);
    const t = timing.get(file);
    const byName = new Map();
    for (const e of t?.tests || []) { if (!byName.has(e.name)) byName.set(e.name, []); byName.get(e.name).push(e); }
    const fileTests = [];
    starts.forEach((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
      const body = lines.slice(s, end).join('\n');
      const name = nameOf(lines.slice(s, s + 3).join(' ')) || '';
      const c = classify(repo, file, body, name, ctx);
      const hit = byName.get(name)?.shift();
      fileTests.push({ repo, file, line: s + 1, name, lines: body.split('\n').filter((l) => l.trim()).length, ...c, ms: hit ? hit.ms : null, skipped: /\.(skip|todo)\s*\(/.test(lines[s]) });
    });
    // Time a file spent outside any named test (imports, setup, generated tests) is spread over its tests by line count.
    const named = fileTests.reduce((a, x) => a + (x.ms || 0), 0);
    const rest = t ? Math.max(0, t.wallMs - named) : 0;
    const totalLines = fileTests.reduce((a, x) => a + x.lines, 0) || 1;
    for (const x of fileTests) x.allocMs = (x.ms || 0) + rest * (x.lines / totalLines);
    tests.push(...fileTests);
    files.push({ repo, file, area: area(repo, file, src), lines: lines.filter((l) => l.trim()).length, tests: fileTests.length, wallMs: t?.wallMs ?? null, failedLocally: t?.failed ?? null });
  }
}
for (const x of tests) {
  x.area = files.find((f) => f.repo === x.repo && f.file === x.file).area;
  // The blind hand-coding found 11 of 12 "other" tests (no assert call found) behavioural, so reports fold them in.
  x.rcls = x.cls === 'other' ? 'behavioural' : x.cls;
}

const CLASSES = ['behavioural', 'text pin', 'census', 'source scan', 'e2e', 'other'];
const summary = {};
for (const repo of Object.keys(REPOS)) {
  const ts = tests.filter((x) => x.repo === repo);
  summary[repo] = { byClass: {}, byArea: {} };
  for (const c of CLASSES) {
    const cs = ts.filter((x) => x.rcls === c);
    summary[repo].byClass[c] = { tests: cs.length, lines: cs.reduce((a, x) => a + x.lines, 0), asserts: cs.reduce((a, x) => a + x.asserts, 0), ms: Math.round(cs.reduce((a, x) => a + x.allocMs, 0)) };
  }
  for (const a of [...new Set(ts.map((x) => x.area))]) {
    const as = ts.filter((x) => x.area === a);
    summary[repo].byArea[a] = Object.fromEntries(CLASSES.map((c) => [c, as.filter((x) => x.rcls === c).length]));
    summary[repo].byArea[a].ms = Math.round(as.reduce((s, x) => s + x.allocMs, 0));
  }
}

// A seeded stratified sample for blind hand-coding (a fixed number per class and repo; --sample is the rough total).
let sample = [];
if (process.argv.includes('--sample')) {
  const per = Number(flag('--sample', 60));
  let seed = Number(flag('--seed', 3151));
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const strata = [];
  for (const repo of Object.keys(REPOS)) for (const c of CLASSES) strata.push(tests.filter((x) => x.repo === repo && x.cls === c && x.name));
  const k = Math.max(1, Math.round(per / strata.filter((s) => s.length).length));
  // Behavioural gets three times the draw: it is where a missed pin would hide.
  for (const s of strata) { const pool = [...s]; const n = s[0]?.cls === 'behavioural' ? 3 * k : k; for (let i = 0; i < n && pool.length; i++) sample.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]); }
  sample = sample.map(({ repo, file, line, name, cls }) => ({ repo, file, line, name, cls }));
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ rev, summary, files, tests, sample }, null, 1));
for (const [repo, s] of Object.entries(summary)) {
  console.log(`\n${repo}  class         tests   lines  asserts   time(s, serial)`);
  for (const [c, v] of Object.entries(s.byClass)) console.log(`   ${c.padEnd(13)} ${String(v.tests).padStart(6)} ${String(v.lines).padStart(7)} ${String(v.asserts).padStart(8)} ${(v.ms / 1000).toFixed(1).padStart(9)}`);
}

// --validate <hand-codes.json>: compare the classifier with a blind hand-coding of the drawn sample.
if (process.argv.includes('--validate')) {
  const hand = JSON.parse(readFileSync(flag('--validate'), 'utf8'));
  const key = (x) => `${x.repo}:${x.file}:${x.line}`;
  const byKey = new Map(tests.map((x) => [key(x), x]));
  const pairs = hand.map((h) => [byKey.get(key(h))?.cls, h.handClass]).filter(([c]) => c);
  console.log(`\nvalidation: ${pairs.filter(([c, h]) => c === h).length}/${pairs.length} agree`);
  console.log('classifier → hand:');
  for (const c of CLASSES) {
    const row = pairs.filter(([x]) => x === c);
    if (row.length) console.log(`   ${c.padEnd(12)} n=${String(row.length).padStart(2)}  precision ${(row.filter(([, h]) => h === c).length / row.length).toFixed(2)}  ${CLASSES.map((h) => `${h}:${row.filter(([, y]) => y === h).length}`).filter((s) => !s.endsWith(':0')).join(' ')}`);
  }
}
