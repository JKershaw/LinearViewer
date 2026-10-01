// LIN-3151: test failures seen inside local Claude Code sessions (Harbour + simple-dispatcher) and what the agent edited next, classified per (session, failing test) episode.
// Usage: node scripts/survey-tests-local.mjs [--projects ~/.claude/projects] [--since 2026-08-01] [--every 1] [--out data/survey-tests/local-failures.json]
// A test run is a Bash tool call running node --test / npm test / npm run test[:unit|:hermetic] / npx playwright test. A failure episode opens at the
// first run where a test fails and closes at the next run covering that test that no longer fails it; the Edit/Write/MultiEdit calls (and sed/perl/
// python in-place edits) in between decide the class. Runs whose command (or the assistant text right before them) deliberately breaks code
// (mutation probes, stash-the-fix, baseline on origin/main) are split out as 'deliberate red'. --every k keeps every k-th session by start time.
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const since = Date.parse(arg('--since', '2000-01-01'));
const every = Number(arg('--every', '1'));
const out = arg('--out', 'data/survey-tests/local-failures.json');

const RUN_RE = /(?:^|[\s;&|(`'"])(node\s+(?:--[\w-]+(?:[= ]\S+)?\s+)*--test\b|npm\s+(?:run\s+)?test(?::unit|:hermetic)?\b|npm\s+t\b|npx\s+playwright\s+test\b|playwright\s+test\b)/;
const MUT_CMD_RE = /\bmutat|\bmutant|MUT\[|MUTATION|\bsed -i|\bperl -[a-z0-9]*i|python3? - <<|python3? <<|open\([^)]*,\s*['"]w['"]\)|git stash|git checkout [^|;&\n]*-- |wt-main|origin\/main|without the fix|\.bak\b|\/tmp\/[\w.-]+\.(?:js|orig)\b/i;
const MUT_TEXT_RE = /\bmutat|\bmutant|revert(?:ing)? the fix|without the fix|prove (?:the |that )?(?:new )?tests? (?:fail|go red|catch|bite)|confirm (?:it|they|the (?:new )?tests?) (?:fails?|go(?:es)? red)|should (?:now )?fail|expect(?:ed)? (?:it |them |this )?to fail|(?:go|goes|see it|watch it) red|red (?:first|phase)|fail(?:s|ing)? first|before the fix|sabotage|break the (?:code|impl)/i;
// An in-command edit counts as a deliberate break only when the command also labels or restores it (M3:, probe, git checkout, .bak …).
const MUT_LABEL_RE = /(?:^|[\s#("'=])(?:M|L|P)\d+[a-z]?\b|probe|mutat|mutant|restor|pristine|\.orig\b|\.bak\b|git checkout|git restore|stash pop|cp [^\n]*\/tmp\/|without the fix|revert/i;
const ENV_RE = /\btimed? ?out\b|timeout|EADDRINUSE|ENOENT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|socket hang up|network|EPERM|EACCES|MongoServerSelectionError|port \d+ (?:is )?(?:already )?in use/i;
const TEST_PATH_RE = /(?:^|[\s/'"=(:])((?:tests\/(?:unit|e2e|visual|integration)|test)\/[\w./@+-]*?\.(?:test|spec)\.[cm]?[jt]s)\b/;
const TEST_PATH_G = new RegExp(TEST_PATH_RE.source, 'g');

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x.type === 'text' ? x.text : '')).join('') : '');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s);
const repoOfTestPath = (p) => (p.startsWith('tests/') ? 'lv' : p.startsWith('test/') ? 'sd' : null);
const repoOfDir = (s) => { const lv = s.lastIndexOf('/LinearViewer'); const sd = Math.max(s.lastIndexOf('/simple-dispatcher/'), s.endsWith('/simple-dispatcher') ? s.length - 18 : -1); return lv < 0 && sd < 0 ? null : lv > sd ? 'lv' : 'sd'; };
const REPO_NAME = { lv: 'LinearViewer', sd: 'simple-dispatcher' };

// ---- file roles --------------------------------------------------------------------------------------------------------
const isScratch = (p) => /^\/(?:private\/)?tmp\/|\/scratchpad\/(?!wt-)|\/\.claude\/(?!skills)|test-results\/|\/data\/|\.log$/.test(p);
const relPath = (p) => { const m = p.match(/(?:\/LinearViewer\/|\/simple-dispatcher\/|\/wt-[\w-]+\/)(?!.*(?:\/LinearViewer\/|\/simple-dispatcher\/))(.*)$/); return m ? m[1] : p.replace(/^.*\/scratchpad\/[^/]+\//, ''); };
const roleOf = (p) => {
  const r = relPath(p);
  if (/(?:^|\/)(?:tests?|__tests__)\//.test(r) || /\.(?:test|spec)\.[cm]?[jt]s$/.test(r)) return 'test';
  if (/\.(?:md|mdx|txt)$/i.test(r) || /(?:^|\/)(?:docs|plans|content)\//.test(r) || /(?:^|\/)\.claude\/skills\//.test(p)) return 'doc';
  if (/(?:^|\/)lib\/prompts\/|prompt-template|prompt-formatters|-template\.js$|kickoff\.js$|(?:^|\/)hooks?\/.*\.(?:sh|txt)$/.test(r)) return 'prompt';
  return 'prod';
};

// ---- literal-only diff -------------------------------------------------------------------------------------------------
// Replace string/template/number/regex literals and comments with placeholders; two fragments that normalise equal differ only in literals.
const normLiterals = (src) => {
  let o = ''; let i = 0; let prev = '';
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      i++; while (i < n && src[i] !== c && !(c !== '`' && src[i] === '\n')) i += src[i] === '\\' ? 2 : 1;
      i++; o += 'S'; prev = 'S'; continue;
    }
    if (c === '/' && (/[(,=:[!&|?{};]/.test(prev) || prev === '' || o.endsWith('return'))) {
      let j = i + 1; let cls = false; let ok = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) { ok = true; break; } j++; }
      if (ok) { j++; while (j < n && /[a-z]/.test(src[j])) j++; i = j; o += 'R'; prev = 'R'; continue; }
    }
    if (/[0-9]/.test(c) && !/[\w$]/.test(src[i - 1] || '')) { while (i < n && /[\w.]/.test(src[i])) i++; o += 'N'; prev = 'N'; continue; }
    if (/\s/.test(c)) { i++; continue; }
    o += c; prev = c; i++;
  }
  return o;
};
const literalOnly = (a, b) => a !== b && normLiterals(a || '') === normLiterals(b || '');

// ---- output parsing ----------------------------------------------------------------------------------------------------
const cleanName = (s) => s.replace(/\s+\(\d[\d.]*m?s\)\s*(?:#.*)?$/, '').replace(/\s+#\s*(?:TODO|SKIP).*$/, '').trim();
const firstTestPath = (s) => { const m = s && s.match(TEST_PATH_RE); return m ? m[1] : null; };
function parseOutput(raw) {
  const t = stripAnsi(raw);
  const lines = t.split('\n');
  const num = (re) => { let v = null; for (const m of t.matchAll(re)) v = (v || 0) + Number(m[1]); return v; };
  const res = { fail: num(/^\s*ℹ fail (\d+)/gm) ?? num(/^# fail (\d+)/gm), pass: num(/^\s*ℹ pass (\d+)/gm) ?? num(/^# pass (\d+)/gm), failures: [], passed: new Set(), parsed: false };
  const pwFailed = num(/^\s*(\d+) failed\b/gm); const pwPassed = num(/^\s*(\d+) passed\b/gm);
  if (pwFailed != null || pwPassed != null) { res.fail = (res.fail || 0) + (pwFailed || 0); res.pass = (res.pass || 0) + (pwPassed || 0); }
  const add = (f) => { if (!res.failures.some((x) => x.name === f.name && x.file === f.file)) res.failures.push(f); };
  const msgAfter = (i) => lines.slice(i + 1, i + 12).join('\n');
  // node spec reporter: prefer the '✖ failing tests:' section (leaf tests with 'test at file:line').
  const sum = lines.findIndex((l) => /^\s*✖ failing tests:/.test(l));
  let testLines = [];
  lines.forEach((l, i) => { const m = l.match(/^(\s*)([✔✖﹣]) (.+?)\s*$/); if (m && !/failing tests:/.test(m[3])) testLines.push({ i, ind: m[1].length, ok: m[2] === '✔', name: cleanName(m[3]) }); });
  for (const x of testLines) if (x.ok) res.passed.add(x.name);
  if (sum >= 0) {
    let at = null;
    for (let i = sum + 1; i < lines.length; i++) {
      const l = lines[i]; const a = l.match(/^\s*test at (.+?):(\d+):\d+/); if (a) { at = { file: firstTestPath(' ' + a[1]), line: Number(a[2]) }; continue; }
      const m = l.match(/^\s*✖ (.+?)\s*$/); if (m) { add({ name: cleanName(m[1]), file: at?.file || null, line: at?.line || null, msg: msgAfter(i) }); at = null; }
    }
  }
  if (!res.failures.length) {
    const main = testLines.filter((x) => sum < 0 || x.i < sum);
    main.forEach((x, k) => {
      if (x.ok) return;
      const p = main[k - 1]; if (p && p.ind > x.ind) return; // a suite line closing deeper subtests
      const near = lines.slice(x.i + 1, x.i + 25).join('\n'); const f = near.match(/file:\/\/\S*?((?:tests\/(?:unit|e2e|visual)|test)\/[\w./@+-]*?\.(?:test|spec)\.[cm]?[jt]s):(\d+)/);
      add({ name: x.name, file: f ? f[1] : null, line: null, msg: msgAfter(x.i) });
    });
  }
  // TAP
  const tap = []; lines.forEach((l, i) => { const m = l.match(/^(\s*)(not ok|ok) \d+ - (.+?)\s*$/); if (m) tap.push({ i, ind: m[1].length, ok: m[2] === 'ok', name: cleanName(m[3]) }); });
  tap.forEach((x, k) => {
    if (x.ok) { res.passed.add(x.name); return; }
    const p = tap[k - 1]; if (p && p.ind > x.ind) return;
    const block = lines.slice(x.i + 1, x.i + 40).join('\n'); const loc = block.match(/location: '([^']+):(\d+):\d+'/);
    add({ name: x.name, file: loc ? firstTestPath(' ' + loc[1]) : null, line: loc ? Number(loc[2]) : null, msg: block.slice(0, 600) });
  });
  // Playwright: the 'N failed' summary block, else ✘ lines not later ✓.
  const pwLine = (l) => { const m = l.match(/((?:tests\/(?:e2e|visual|unit)|test)\/[\w./@+-]+?\.spec\.[cm]?[jt]s):(\d+):\d+ › (.+?)(?:\s+\(\d[\d.]*m?s\))?(?:\s+─+)?\s*$/); if (!m) return null; const parts = m[3].split(' › '); return { file: m[1], line: Number(m[2]), name: parts[parts.length - 1].replace(/\s+\(retry #\d+\)$/, '').trim(), title: m[3] }; };
  let sect = null; const pwFails = [];
  lines.forEach((l, i) => {
    if (/^\s+\d+ failed\b/.test(l)) { sect = 'failed'; return; }
    if (/^\s+\d+ (?:flaky|skipped|passed|did not run|interrupted)\b/.test(l)) { sect = null; return; }
    if (sect === 'failed') { const x = pwLine(l); if (x) pwFails.push({ ...x, i }); else if (l.trim() && !/^\s{4}/.test(l)) sect = null; }
    const ok = l.match(/^\s*[✓✔]\s+\d*\s*(.*)$/); if (ok) { const x = pwLine(l); if (x) res.passed.add(x.name); }
  });
  if (!pwFails.length) lines.forEach((l, i) => { if (/^\s*[✘×]\s/.test(l)) { const x = pwLine(l); if (x && !res.passed.has(x.name)) pwFails.push({ ...x, i }); } });
  for (const x of pwFails) {
    const at = lines.findIndex((l) => l.includes(`${x.file}:${x.line}`) && /^\s*\d+\) /.test(l));
    add({ name: x.name, title: x.title, file: x.file, line: x.line, msg: at >= 0 ? lines.slice(at + 1, at + 14).join('\n') : '' });
  }
  res.parsed = res.fail != null || res.failures.length > 0 || res.passed.size > 0;
  if (res.failures.length && (res.fail == null || res.fail === 0)) res.fail = res.failures.length;
  return res;
}

// What does a command run? Explicit test files, test dirs/globs, whether it is a whole-suite script, and a name filter.
function runScope(cmd) {
  const files = [...new Set([...cmd.matchAll(TEST_PATH_G)].map((m) => m[1]))];
  const dirs = [...cmd.matchAll(/(?:^|[\s'"])((?:tests\/(?:unit|e2e|visual)|test))\/?(?:\*[\w.*]*)?(?=[\s'"]|$)/g)].map((m) => m[1]);
  const whole = files.length === 0;
  const e2e = /playwright\s+test|npm\s+test\b|npm\s+t\b/.test(cmd);
  const pat = cmd.match(/(?:--test-name-pattern|\s-g|--grep)[= ]\s*(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return { files, dirs, whole, e2e, filter: pat ? (pat[1] || pat[2] || pat[3]) : null };
}
const covers = (scope, repo, f) => {
  if (!f.file) return scope.whole;
  if (scope.files.includes(f.file)) return true;
  if (!scope.whole) return false;
  if (repo && f.repo && repo !== f.repo) return false;
  if (scope.dirs.length) return scope.dirs.some((d) => f.file.startsWith(d + '/'));
  return f.file.startsWith('tests/e2e') || f.file.startsWith('tests/visual') ? scope.e2e : !/playwright/.test(scope.cmd || '') || f.repo === 'sd';
};
const filterAdmits = (flt, name) => { if (!flt) return true; try { return new RegExp(flt).test(name); } catch { return name.includes(flt); } };

// Bash in-place edits: which files, and (for simple sed s///) the before/after text.
function bashEdits(cmd) {
  if (!/\bsed -i|\bperl -[a-z0-9]*i|python3?\b[^\n]*<<|open\([^)]*,\s*['"]w['"]\)|writeFileSync|\bcat\s*>\s*\S|\btee\s+\S|git (?:checkout|restore|apply|stash pop)|\bpatch\b/.test(cmd)) return [];
  const paths = [...new Set([...cmd.matchAll(/(?:^|[\s'"=(])([\w./@+-]+\.(?:m?js|cjs|ts|css|html|md|json|sh|txt))\b/g)].map((m) => m[1]))].filter((p) => !isScratch(p) && !/package-lock|node_modules/.test(p));
  const sed = [];
  for (const m of cmd.matchAll(/\b(?:sed -i(?: '')?|perl -[0-9a-z]*p[0-9a-z]*(?: -e)?)\s+(['"])([^\n]*?)\1/g)) {
    const sc = m[2]; const at = sc.search(/s[/|#,{]/); if (at < 0) continue;
    const dl = sc[at + 1]; const parts = ['']; for (let i = at + 2; i < sc.length && parts.length < 3; i++) { if (sc[i] === '\\') { parts[parts.length - 1] += sc[i] + (sc[i + 1] || ''); i++; } else if (sc[i] === dl) parts.push(''); else parts[parts.length - 1] += sc[i]; }
    if (parts.length >= 2) sed.push({ old: parts[0], new: parts[1] });
  }
  const restore = /git (?:checkout|restore|stash pop)/.test(cmd) && !/sed -i|perl -|python/.test(cmd);
  return paths.map((p) => ({ path: p, role: roleOf(p), via: 'bash', literal: sed.length ? sed.every((s) => literalOnly(s.old, s.new)) : null, restore, pairs: roleOf(p) === 'test' ? (sed.length ? sed : [{ old: '', new: cmd }]) : undefined }));
}

// ---- collect sessions --------------------------------------------------------------------------------------------------
const streams = [];
for (const d of readdirSync(root)) {
  const dir = join(root, d); if (d.startsWith('.') || !statSync(dir).isDirectory()) continue;
  if (!/simple-dispatcher|LinearViewer|harbour/i.test(d)) continue; // other products' sessions (wick, tangle, m14 …)
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = join(dir, f); const st = statSync(p); if (st.mtimeMs < since) continue;
    streams.push({ path: p, project: d, session: f.replace('.jsonl', ''), sub: null, mtime: st.mtimeMs });
    const sub = join(dir, f.replace('.jsonl', ''), 'subagents');
    if (existsSync(sub)) for (const s of readdirSync(sub)) if (s.endsWith('.jsonl')) streams.push({ path: join(sub, s), project: d, session: f.replace('.jsonl', ''), sub: s.replace('.jsonl', ''), mtime: statSync(join(sub, s)).mtimeMs });
  }
}

const pop = { transcripts: streams.length, withTestRuns: 0, sessionsWithTestRuns: new Set(), testRuns: 0, runsByRepo: {}, failingRuns: 0, failingRunsByRepo: {}, failingRunsNamed: 0, deliberateRuns: 0, firstTs: null, lastTs: null, byCommand: {} };
const failingRuns = []; const episodes = [];

function scan(st) {
  let raw; try { raw = readFileSync(st.path, 'utf8'); } catch { return null; }
  if (!RUN_RE.test(raw)) return { runs: 0 };
  const ev = []; const uses = new Map(); const seenUse = new Set(); let lastText = ''; let cwd = null; let t0 = null;
  for (const line of raw.split('\n')) {
    if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain && !st.sub) continue;
    if (e.cwd) cwd = e.cwd; const ts = e.timestamp || null; if (ts && !t0) t0 = ts;
    const m = e.message; if (!m || !Array.isArray(m.content)) continue;
    if (e.type === 'assistant') {
      for (const b of m.content) {
        if (b.type === 'text' || b.type === 'thinking') lastText = (lastText + '\n' + (b.text || b.thinking || '')).slice(-1500);
        if (b.type !== 'tool_use' || seenUse.has(b.id)) continue; seenUse.add(b.id);
        const inp = b.input || {};
        if (b.name === 'Bash') {
          const cmd = inp.command || '';
          if (RUN_RE.test(cmd)) { uses.set(b.id, { cmd, ts, cwd, intent: lastText }); lastText = ''; } else {
            const be = bashEdits(cmd); if (be.length) ev.push({ k: 'edit', ts, edits: be, cmd });
          }
        } else if (b.name === 'Edit' || b.name === 'Write' || b.name === 'MultiEdit' || b.name === 'NotebookEdit') {
          const p = inp.file_path || inp.notebook_path || ''; if (!p || isScratch(p)) continue;
          const pairs = b.name === 'Edit' ? [{ old: inp.old_string, new: inp.new_string }] : b.name === 'MultiEdit' ? (inp.edits || []).map((x) => ({ old: x.old_string, new: x.new_string })) : [{ old: null, new: inp.content ?? inp.new_source ?? '' }];
          ev.push({ k: 'edit', ts, tool: b.name, edits: [{ path: p, role: roleOf(p), via: b.name, literal: pairs.every((x) => x.old != null && literalOnly(x.old, x.new)), pairs }] });
        }
      }
    } else if (e.type === 'user') {
      for (const b of m.content) {
        if (b.type !== 'tool_result' || !uses.has(b.tool_use_id)) continue;
        const u = uses.get(b.tool_use_id); uses.delete(b.tool_use_id);
        const out = text(b.content); const res = parseOutput(out);
        let mc = u.cmd.match(MUT_CMD_RE); if (mc && /sed -i|perl|python|open\(/i.test(mc[0]) && !MUT_LABEL_RE.test(u.cmd)) { mc = null; const be = bashEdits(u.cmd); if (be.length) ev.push({ k: 'edit', ts, edits: be, cmd: u.cmd }); } const mt = u.intent.match(MUT_TEXT_RE); const mo = !mc && stripAnsi(out).match(/\bmutat\w*|\bmutant\b|^[-=#* ]{2,}\s*M\d+[a-z]?\b|\bMUT(?:ANT)?[-_ :[]/im);
        const deliberate = mc ? `cmd: ${mc[0]}` : mo ? `cmd (output): ${mo[0].trim()}` : mt ? `text: ${mt[0]}` : null;
        const dirOf = u.cmd.match(/cd\s+("?)([^\s";&]+)\1/)?.[2] || u.cwd || '';
        if (/\/development\/(?!simple-dispatcher|LinearViewer|harbour)[\w-]+(?:\/|$)/.test(dirOf) && !/scratchpad/.test(dirOf)) continue;
        if (!deliberate) { const be = bashEdits(u.cmd); if (be.length) ev.push({ k: 'edit', ts, edits: be, cmd: u.cmd, inRun: true }); }
        ev.push({ k: 'run', ts: u.ts || ts, cmd: u.cmd, cwd: u.cwd, res, isError: !!b.is_error, deliberate, scope: { ...runScope(u.cmd), cmd: u.cmd }, repo: repoOfDir(u.cmd.match(/cd\s+("?)([^\s";&]+)\1/)?.[2] || '') || repoOfDir(u.cwd || '') || repoOfTestPath(runScope(u.cmd).files[0] || '') });
      }
    }
  }
  return { ev, t0 };
}

// Test sources of the two repos (this checkout and its sibling), to put a file on a failure whose output named only the test.
const srcIndex = [];
for (const [repo, base, dir] of [['lv', arg('--lv', '.'), 'tests'], ['sd', arg('--sd', '../simple-dispatcher'), 'test']]) {
  const walk = (d) => { if (!existsSync(d)) return; for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== 'fixtures') walk(p); } else if (/\.(?:test|spec)\.[cm]?[jt]s$/.test(f.name)) srcIndex.push({ repo, file: relative(base, p), src: readFileSync(p, 'utf8') }); } };
  walk(join(base, dir));
}
const nameKeys = (name) => { const b = name.slice(0, 60); return [...new Set([b, b.replace(/'/g, '\\\''), b.replace(/"/g, '\\"')])]; };
function attribute(f, run, added) {
  const g = { ...f };
  if (!g.file && run.scope.files.length === 1) { g.file = run.scope.files[0]; g.fileFrom = 'command'; }
  if (!g.file) { const keys = nameKeys(g.name); const a = [...added].reverse().find((x) => keys.some((k) => x.new.includes(k))); if (a && firstTestPath(' ' + relPath(a.path))) { g.file = firstTestPath(' ' + relPath(a.path)); g.fileFrom = 'session edit'; } }
  if (!g.file && g.name.length >= 12) {
    const keys = nameKeys(g.name); const repo = run.repo || repoOfTestPath(run.scope.files[0] || '');
    const hits = srcIndex.filter((x) => (!repo || x.repo === repo) && (!run.scope.files.length || run.scope.files.includes(x.file)) && keys.some((k) => x.src.includes(k)));
    if (hits.length === 1) { g.file = hits[0].file; g.fileFrom = 'source lookup'; }
  }
  g.repo = repoOfTestPath(g.file || '') || run.repo || null;
  return g;
}

// Sessions ordered by first timestamp; --every k keeps every k-th session (all its subagent streams with it).
const bySession = new Map(); for (const s of streams) (bySession.get(s.session) || bySession.set(s.session, []).get(s.session)).push(s);
const sessionList = [...bySession.entries()].sort((a, b) => Math.min(...a[1].map((x) => x.mtime)) - Math.min(...b[1].map((x) => x.mtime)));
const kept = sessionList.filter((_, i) => i % every === 0);
let scannedSessions = 0;

for (const [session, sts] of kept) {
  if (++scannedSessions % 100 === 0) process.stderr.write(`${scannedSessions}/${kept.length} sessions\n`);
  for (const st of sts) {
    const r = scan(st); if (!r || !r.ev) continue;
    const runs = r.ev.filter((x) => x.k === 'run'); if (!runs.length) continue;
    pop.withTestRuns++; pop.sessionsWithTestRuns.add(session);
    const label = st.sub ? `${session}/${st.sub}` : session;
    const open = new Map(); // key -> episode
    const doneKeys = new Set();
    const addedNames = []; // test source text written earlier in this stream, for TDD detection
    for (let i = 0; i < r.ev.length; i++) {
      const x = r.ev[i];
      if (x.k === 'edit') {
        for (const ep of open.values()) ep.edits.push(...x.edits.map((ed) => ({ ...ed, ts: x.ts })));
        for (const ed of x.edits) if (ed.role === 'test' && ed.pairs) for (const p of ed.pairs) addedNames.push({ path: ed.path, old: p.old || '', new: p.new || '', ts: x.ts });
        continue;
      }
      pop.testRuns++; const cmdKey = (x.cmd.match(RUN_RE) || [])[1]?.replace(/\s+.*--test/, ' --test').replace(/\s+/g, ' ') || 'other'; pop.byCommand[cmdKey] = (pop.byCommand[cmdKey] || 0) + 1;
      if (x.ts) { if (!pop.firstTs || x.ts < pop.firstTs) pop.firstTs = x.ts; if (!pop.lastTs || x.ts > pop.lastTs) pop.lastTs = x.ts; }
      const fails = x.res.failures.map((f) => attribute(f, x, addedNames));
      const runRepo = fails.find((f) => f.repo)?.repo || x.repo || 'unknown';
      pop.runsByRepo[runRepo] = (pop.runsByRepo[runRepo] || 0) + 1;
      // Close open episodes this run covers and no longer fails.
      for (const [key, ep] of open) {
        if (!x.res.parsed) continue;
        const f = ep.f; if (!covers(x.scope, x.repo || f.repo, f) || !filterAdmits(x.scope.filter, f.name)) continue;
        const stillFails = fails.some((g) => g.name === f.name && (!g.file || !f.file || g.file === f.file));
        const sawPass = x.res.passed.has(f.name) || x.res.fail === 0 || (fails.length > 0 && !stillFails && x.res.fail === fails.length);
        if (stillFails) { ep.failRuns++; ep.lastFailIdx = i; if (x.deliberate) ep.laterDeliberate = true; continue; }
        if (sawPass && !x.deliberate) { ep.closeTs = x.ts; ep.closeCmd = x.cmd; ep.resolved = true; ep.closeIdx = i; finish(ep); open.delete(key); doneKeys.add(key); }
      }
      const failing = x.res.fail > 0 || fails.length > 0;
      if (!failing) continue;
      pop.failingRuns++; pop.failingRunsByRepo[runRepo] = (pop.failingRunsByRepo[runRepo] || 0) + 1; if (fails.length) pop.failingRunsNamed++; if (x.deliberate) pop.deliberateRuns++;
      failingRuns.push({ session: label, project: st.project, ts: x.ts, repo: runRepo, command: clip(x.cmd, 400), deliberate: x.deliberate, failCount: x.res.fail, failures: fails.map((f) => ({ file: f.file, name: f.name })) });
      for (const f of fails) {
        const key = `${x.deliberate ? 'D' : 'G'}|${f.repo}|${f.file}|${f.name}`;
        if (open.has(key)) continue;
        if (doneKeys.has(key)) { const prior = episodes.find((e) => e.key === key && e.session === label); if (prior) prior.refailedAfterPass = (prior.refailedAfterPass || 0) + 1; continue; }
        // A test whose name was added by an earlier Edit/Write in this stream (absent from that edit's old text) is a new test.
        const probe = f.name.slice(0, 60); const bare = probe.replace(/\s*\((?:LIN-\d+[^)]*|[^)]{0,40})\)\s*$/, '').slice(0, 50);
        const added = bare.length >= 8 && addedNames.find((a) => (a.new.includes(bare) && !a.old.includes(bare)) || (a.new.includes(bare.replace(/'/g, '\\\'')) && !a.old.includes(bare.replace(/'/g, '\\\''))));
        open.set(key, { key, session: label, project: st.project, repo: f.repo, file: f.file, name: f.name, title: f.title || null, line: f.line || null, f, firstFailTs: x.ts, firstIdx: i, command: clip(x.cmd, 400), deliberate: x.deliberate, msg: clip((f.msg || '').trim(), 500), failRuns: 1, edits: [], tdd: added ? { path: added.path, ts: added.ts } : null, resolved: false });
      }
    }
    for (const ep of open.values()) finish(ep);
  }
}

function finish(ep) {
  const edits = ep.edits.filter((e) => !e.restore);
  const roles = new Set(edits.map((e) => e.role));
  const testEdits = edits.filter((e) => e.role === 'test');
  const failingFileEdits = testEdits.filter((e) => ep.file && relPath(e.path) === ep.file);
  const envMsg = ENV_RE.test(ep.msg || '');
  let cls; let why;
  if (ep.deliberate?.startsWith('cmd')) { cls = 'deliberate red'; why = `the test command itself breaks code on purpose (${ep.deliberate})`; }
  else if (ep.tdd) { cls = 'new test red (TDD)'; why = `test name added earlier in session in ${relPath(ep.tdd.path)}`; }
  else if (ep.deliberate) { cls = 'deliberate red'; why = `assistant text before the run expects a red (${ep.deliberate})`; }
  else if (ep.resolved && ep.edits.length === 0) { cls = 'environment/flaky'; why = 're-ran without edits and passed'; }
  else if (envMsg && !roles.has('prod')) { cls = 'environment/flaky'; why = 'failure message is timeout/EADDRINUSE/ENOENT/network'; }
  else if (!ep.resolved) { cls = 'unknown'; why = ep.edits.length ? 'never seen passing again in this session (edits followed)' : 'never seen passing again in this session, nothing edited after it (pre-existing / ignored red)'; }
  else if (roles.has('prod')) { cls = 'prod fix'; why = 'edited production code'; }
  else if (testEdits.length && testEdits.every((e) => e.literal === true)) { cls = 'pin/literal update'; why = 'test edits differ only in string/number/regex literals'; }
  else if (testEdits.length) { cls = 'test rewrite'; why = 'edited tests beyond literals'; }
  else if (roles.has('doc') || roles.has('prompt')) { cls = 'doc/prompt edit'; why = 'edited only markdown/prompt text'; }
  else { cls = 'unknown'; why = 'edits not attributable'; }
  // What the agent actually changed next, independent of the red's origin.
  const fixKind = edits.length === 0 ? (ep.resolved ? 'none' : 'none (unresolved)') : roles.has('prod') ? 'prod' : testEdits.length ? (testEdits.every((e) => e.literal === true) ? 'test literals' : 'test') : [...roles].join('+');
  const editedFiles = [...new Map(edits.map((e) => [relPath(e.path), { path: relPath(e.path), role: e.role, literal: e.literal }])).values()].slice(0, 20);
  episodes.push({ session: ep.session, project: ep.project, key: ep.key, repo: ep.repo, repoName: REPO_NAME[ep.repo] || ep.repo, file: ep.file, name: ep.name, title: ep.title, line: ep.line, class: cls, why, fixKind, resolved: ep.resolved, failRuns: ep.failRuns, firstFailTs: ep.firstFailTs, closeTs: ep.closeTs || null, command: ep.command, closeCommand: ep.closeCmd ? clip(ep.closeCmd, 300) : null, msg: ep.msg, deliberateBy: ep.deliberate || null, fileFrom: ep.f.fileFrom || (ep.file ? 'output' : null), editedFiles, failingFileEdited: failingFileEdits.length > 0, tdd: ep.tdd ? relPath(ep.tdd.path) : null });
}

// ---- summarise ---------------------------------------------------------------------------------------------------------
const count = (xs, f) => xs.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
const byClassRepo = {}; for (const e of episodes) { const r = (byClassRepo[e.class] ||= {}); r[e.repo || 'unknown'] = (r[e.repo || 'unknown'] || 0) + 1; r.total = (r.total || 0) + 1; }
const fileAgg = {}; for (const e of episodes) { if (!e.file || e.class === 'deliberate red') continue; const k = `${e.repo}|${e.file}`; const a = (fileAgg[k] ||= { repo: e.repo, file: e.file, episodes: 0, sessions: new Set(), classes: {} }); a.episodes++; a.sessions.add(e.session.split('/')[0]); a.classes[e.class] = (a.classes[e.class] || 0) + 1; }
const topFiles = Object.values(fileAgg).map((a) => ({ ...a, sessions: a.sessions.size })).sort((a, b) => b.sessions - a.sessions || b.episodes - a.episodes).slice(0, 40);
const summary = {
  generatedAt: new Date().toISOString(), projectsRoot: root, sample: every > 1 ? `every ${every}th session by start time` : 'census (no sampling)',
  population: { transcriptsFound: streams.length, sessionsScanned: scannedSessions, streamsWithTestRuns: pop.withTestRuns, sessionsWithTestRuns: pop.sessionsWithTestRuns.size, firstRun: pop.firstTs, lastRun: pop.lastTs, testRuns: pop.testRuns, runsByRepo: pop.runsByRepo, runsWithFailures: pop.failingRuns, failingRunsByRepo: pop.failingRunsByRepo, failingRunsWithNamedTests: pop.failingRunsNamed, deliberateFailingRuns: pop.deliberateRuns, byCommand: pop.byCommand },
  episodes: episodes.length, byClass: count(episodes, (e) => e.class), byClassRepo, byClassSessions: Object.fromEntries(Object.entries(episodes.reduce((m, e) => ((m[e.class] ||= new Set()).add(e.session.split('/')[0]), m), {})).map(([k, v]) => [k, v.size])), unknownWhy: count(episodes.filter((e) => e.class === 'unknown'), (e) => e.why), byClassFixKind: count(episodes, (e) => `${e.class} → ${e.fixKind}`), byFixKind: count(episodes, (e) => e.fixKind), resolved: count(episodes, (e) => String(e.resolved)), episodesWithoutFile: episodes.filter((e) => !e.file).length, topFiles,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ ...summary, episodes: episodes.map(({ key, ...e }) => e), failingRuns }, null, 1));
console.log(JSON.stringify({ ...summary, topFiles: topFiles.slice(0, 15).map((f) => `${f.repo} ${f.file} sessions=${f.sessions} ep=${f.episodes} ${JSON.stringify(f.classes)}`) }, null, 1));
