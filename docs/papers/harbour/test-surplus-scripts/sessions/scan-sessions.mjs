// LIN-3551: per-session test effort in local Claude Code transcripts (Harbour = LinearViewer vs simple-dispatcher).
// Read-only. Usage: node scan-sessions.mjs [--projects ~/.claude/projects] [--out sessions.json]
// One row per top-level session (main transcript + its subagents/*.jsonl merged).
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const out = arg('--out', 'sessions.json');

// ---- test-run detection (superset of survey-tests-local.mjs RUN_RE: adds npm run test:<anything> and the hermetic wrapper) ----
const RUN_RE = /(?:^|[\s;&|(`'"])(node\s+(?:--[\w-]+(?:[= ]\S+)?\s+)*--test\b|npm\s+(?:run\s+)?test(?::[\w:-]+)?\b|npm\s+t\b|npx\s+playwright\s+test\b|playwright\s+test\b|node\s+scripts\/assert-unit-suite-hermetic\.mjs)/;
const TEST_FILE_G = /(?:^|[\s/'"=(:])((?:tests\/(?:unit|e2e|visual|integration)|test(?:\/system)?|scripts\/eval)\/[\w./@+-]*?\.(?:test|spec)\.[cm]?[jt]s)\b/g;

// ---- path -> {repo, role} --------------------------------------------------------------------------------------------
const WT_RE = /\/((?:lv|sd|[\w]+)?-?wt(?:-[\w.-]+)?|worktrees?\/[\w.-]+)\//; // scratch worktrees: wt, lv-wt, sd-wt, wt-main, worktrees/x
function locate(p) {
  if (!p) return null;
  let repo = null; let rel = null;
  const lvAt = p.lastIndexOf('/LinearViewer/');
  const sdM = [...p.matchAll(/\/simple-dispatcher\//g)].pop(); const sdAt = sdM ? sdM.index : -1;
  if (lvAt >= 0 || sdAt >= 0) {
    if (lvAt > sdAt) { repo = 'lv'; rel = p.slice(lvAt + '/LinearViewer/'.length); } else { repo = 'sd'; rel = p.slice(sdAt + '/simple-dispatcher/'.length); }
    if (/^(?:scratchpad|node_modules|test-results|state|data)\//.test(rel)) return { repo: 'scratch', role: 'scratch', rel };
    // a worktree living inside a checkout's scratchpad was caught above; worktree inside the repo dir
  } else {
    const w = p.match(WT_RE);
    if (w && /^\/(?:private\/)?tmp\/|\/scratchpad\//.test(p)) {
      rel = p.slice(w.index + w[0].length);
      const name = w[1];
      if (/^lv/.test(name)) repo = 'lv'; else if (/^sd/.test(name)) repo = 'sd';
      else if (/^tests\/|^(?:lib|routes|public|content|plans|prototypes)\/|^server\.js$|^playwright/.test(rel)) repo = 'lv';
      else if (/^test\/|^(?:dispatcher|hook|executors|config|clones|admission|harnesses|http|format)\.js$/.test(rel)) repo = 'sd';
      else return { repo: 'wt-unknown', role: 'other', rel };
    } else return { repo: 'scratch', role: 'scratch', rel: p };
  }
  return { repo, role: roleOf(repo, rel), rel };
}
function roleOf(repo, rel) {
  if (/(?:^|\/)(?:tests?|__tests__)\//.test(rel) || /\.(?:test|spec)\.[cm]?[jt]s$/.test(rel)) return 'test';
  if (/\.(?:md|mdx|txt)$/i.test(rel) || /^(?:docs|plans|content)\//.test(rel)) return 'docs';
  if (repo === 'lv') return /^(?:lib|routes|public)\//.test(rel) || rel === 'server.js' ? 'product' : 'other';
  // simple-dispatcher: product code is the top-level *.js modules plus lib/, deploy/, hooks
  return /^[\w.-]+\.(?:m?js|cjs)$/.test(rel) || /^(?:lib|deploy|hooks?)\//.test(rel) ? 'product' : 'other';
}

// Which repo does a Bash command act on? Explicit cd/-C target, else repo names in the command, else test-path layout, else cwd.
function repoOfCmd(cmd, cwd) {
  const cds = [...cmd.matchAll(/(?:\bcd|git\s+-C|--prefix|npm\s+--prefix)\s+("?)([^\s";&|)]+)\1/g)].map((m) => m[2]);
  for (const d of cds.reverse()) { const r = repoOfDir(d); if (r) return r; }
  const lv = /LinearViewer|\blv-wt\b|tests\/(?:unit|e2e|visual)/.test(cmd); const sd = /simple-dispatcher(?!-workspaces)|\bsd-wt\b|(?:^|[\s'"])test\/[\w*]/.test(cmd);
  if (lv && !sd) return 'lv'; if (sd && !lv) return 'sd';
  return repoOfDir(cwd || '') || (lv ? 'lv' : null);
}
function repoOfDir(d) {
  const lv = d.lastIndexOf('LinearViewer'); const m = [...d.matchAll(/simple-dispatcher(?!-workspaces)/g)].pop(); const sd = m ? m.index : -1;
  if (lv >= 0 || sd >= 0) return lv > sd ? 'lv' : 'sd';
  if (/(?:^|\/)lv-wt\b/.test(d)) return 'lv'; if (/(?:^|\/)sd-wt\b/.test(d)) return 'sd';
  return null;
}
function runKind(repo, cmd) {
  const files = [...new Set([...cmd.matchAll(TEST_FILE_G)].map((m) => m[1]))];
  const pw = /playwright\s+test/.test(cmd);
  const npmTest = /npm\s+(?:test|t)\b(?!:)/.test(cmd);
  const npmScript = cmd.match(/npm\s+run\s+(test(?::[\w:-]+)?)/)?.[1] || null;
  const nodeTest = /node\s+(?:--[\w-]+(?:[= ]\S+)?\s+)*--test\b/.test(cmd) || /assert-unit-suite-hermetic/.test(cmd);
  const unitFiles = files.filter((f) => !/\.spec\./.test(f) && !/tests\/(?:e2e|visual)/.test(f));
  const kinds = new Set();
  if (pw) kinds.add('e2e');
  if (npmTest) kinds.add(repo === 'lv' ? 'full' : 'unit-suite');
  if (npmScript === 'test:unit' || npmScript === 'test:hermetic' || npmScript === 'test:hermetic:proxy' || (npmScript === 'test' )) kinds.add('unit-suite');
  else if (npmScript) kinds.add('script:' + npmScript);
  if (nodeTest) {
    // explicit files and no glob → individual file run; a glob/dir (tests/unit/*.test.js, 'test/*.test.js', tests/unit) or no path → whole suite
    const glob = /(?:tests\/unit|test)\/?\*|(?:^|[\s'"])(?:tests\/unit|test)\/?(?=[\s'"]|$)|assert-unit-suite-hermetic/.test(cmd);
    if (glob || unitFiles.length === 0) kinds.add('unit-suite'); else kinds.add('unit-files');
  }
  return { kinds: [...kinds], files, nUnitFiles: unitFiles.length, filter: /--test-name-pattern|\s-g\s|--grep/.test(cmd) };
}

// Heredoc bodies and long quoted payloads (PR bodies, comments, review files) often quote 'npm test' etc.; strip them before detection.
const HEREDOC_RE = /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g;
const stripCmd = (c) => c.replace(HEREDOC_RE, (_m, _q, _t, rest) => '<<H' + rest).replace(/'[^']{150,}'/g, "'<Q>'").replace(/"[^"]{150,}"/g, '"<Q>"');
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.type === 'text' ? x.text : '')).join('') : '');
const nlines = (s) => (s ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0);
const BASH_EDIT_RE = /\bsed -i|\bperl -[a-z0-9]*i|open\([^)]*,\s*['"]w['"]\)|writeFileSync|(?:^|[\s;&|])cat\s*>\s*\S|\btee\s+\S|\bgit apply\b|\bpatch\s+-/;

// ---- collect streams -------------------------------------------------------------------------------------------------
const sessions = new Map();
for (const d of readdirSync(root)) {
  const dir = join(root, d); if (d.startsWith('.') || !statSync(dir).isDirectory()) continue;
  if (!/simple-dispatcher|LinearViewer|harbour/i.test(d)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const id = f.slice(0, -6); const streams = [{ path: join(dir, f), sub: null }];
    const sub = join(dir, id, 'subagents');
    if (existsSync(sub)) for (const s of readdirSync(sub)) if (s.endsWith('.jsonl')) streams.push({ path: join(sub, s), sub: s.slice(0, -6) });
    sessions.set(id, { id, project: d, streams });
  }
}

const rows = [];
let n = 0;
for (const s of sessions.values()) {
  if (++n % 250 === 0) process.stderr.write(`${n}/${sessions.size}\n`);
  const R = {
    session: s.id, project: s.project.replace(/^-Users-work-development-/, ''), dispatched: /simple-dispatcher-workspaces-[0-9a-f]{8}-/.test(s.project),
    subagents: s.streams.length - 1, issue: null, phase: null, firstTs: null, lastTs: null, wallMin: 0, activeMin: 0,
    assistantTurns: 0, outputTokens: 0, bashCalls: 0, bashWaitMin: 0,
    runs: [], // {repo, kinds, nFiles, sec, bg, err}
    edits: {}, // key repo:role -> {calls, writeCalls, editCalls, linesWritten, linesNet, newFiles}
    bashEdits: {}, // repo:role -> calls
    testFiles: {}, // repo -> {new, preexisting}
    testEditCalls: {}, // repo -> {onNewFile, onPreexisting}
    focus: {}, // focusKey -> {turns, outTok}
    refs: { lv: 0, sd: 0 },
  };
  const allTs = [];
  for (const st of s.streams) {
    let raw; try { raw = readFileSync(st.path, 'utf8'); } catch { continue; }
    const pending = new Map(); const msgs = new Map(); let focus = 'none'; const fileFirst = new Map(); // path -> 'new'|'pre'
    for (const line of raw.split('\n')) {
      if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain && !st.sub) continue;
      const ts = e.timestamp ? Date.parse(e.timestamp) : null; if (ts) allTs.push(ts);
      const m = e.message; if (!m) continue;
      if (e.type === 'user' && !st.sub && !R.issue) {
        const t = typeof m.content === 'string' ? m.content : text(m.content);
        const k = t.match(/^#\s*(LIN-\d+)\s*·\s*([\w-]+)/m); if (k) { R.issue = k[1]; R.phase = k[2]; }
      }
      if (!Array.isArray(m.content)) continue;
      if (e.type === 'assistant') {
        if (m.id) { const prev = msgs.get(m.id); const ot = m.usage?.output_tokens || 0; if (!prev) msgs.set(m.id, { focus, ot }); else prev.ot = Math.max(prev.ot, ot); }
        for (const b of m.content) {
          if (b.type !== 'tool_use') continue;
          const inp = b.input || {};
          if (b.name === 'Bash') {
            const fullCmd = inp.command || ''; const cmd = stripCmd(fullCmd); R.bashCalls++;
            const rp = repoOfCmd(cmd, e.cwd); if (rp) R.refs[rp]++;
            const isRun = RUN_RE.test(cmd);
            pending.set(b.id, { kind: 'bash', ts, cmd, repo: rp, isRun, bg: !!inp.run_in_background });
            if (isRun && rp) focus = rp + ':testrun';
            if (!isRun && BASH_EDIT_RE.test(fullCmd)) {
              // targets: sed/perl -i and redirects → paths in the command outside heredoc bodies; python/node writers → paths in the heredoc body too
              const src = /open\([^)]*,\s*['"]w['"]\)|writeFileSync|write_text/.test(fullCmd) ? fullCmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n/, ' ') : cmd;
              const paths = [...new Set([...src.matchAll(/(?:^|[\s'"=(>])([\w./@+-]+\.(?:m?js|cjs|ts|css|html|md|json|sh))\b/g)].map((x) => x[1]))].filter((p) => !/node_modules|package-lock/.test(p));
              const keys = new Set();
              for (const p of paths) {
                let loc = p.startsWith('/') ? locate(p) : null;
                if (!loc || loc.repo === 'scratch') { if (p.startsWith('/') && loc) { keys.add('scratch:scratch'); continue; } const r = rp || repoOfDir(e.cwd || ''); if (!r) continue; loc = { repo: r, role: roleOf(r, p.replace(/^\.\//, '')) }; }
                keys.add(loc.repo + ':' + loc.role);
              }
              for (const k of keys) R.bashEdits[k] = (R.bashEdits[k] || 0) + 1;
            }
          } else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(b.name)) {
            const p = inp.file_path || inp.notebook_path || ''; const loc = locate(p); if (!loc) continue;
            let lw = 0; let ln = 0;
            if (b.name === 'Write') { lw = nlines(inp.content || ''); ln = lw; }
            else if (b.name === 'Edit') { lw = nlines(inp.new_string || ''); ln = lw - nlines(inp.old_string || ''); }
            else if (b.name === 'MultiEdit') for (const x of inp.edits || []) { lw += nlines(x.new_string || ''); ln += nlines(x.new_string || '') - nlines(x.old_string || ''); }
            else { lw = nlines(inp.new_source || ''); ln = lw; }
            pending.set(b.id, { kind: 'edit', tool: b.name, path: p, loc, lw, ln });
            if (loc.repo === 'lv' || loc.repo === 'sd') { R.refs[loc.repo]++; focus = loc.repo + ':' + loc.role; } else focus = loc.repo;
          } else if (['Read', 'Grep', 'Glob'].includes(b.name)) {
            const p = inp.file_path || inp.path || ''; const loc = p ? locate(p) : null;
            if (loc) focus = loc.repo === 'lv' || loc.repo === 'sd' ? loc.repo + ':' + loc.role : loc.repo;
          }
        }
      } else if (e.type === 'user') {
        for (const b of m.content) {
          if (b.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue;
          const u = pending.get(b.tool_use_id); pending.delete(b.tool_use_id);
          const res = text(b.content);
          if (u.kind === 'bash') {
            const sec = u.ts && ts ? (ts - u.ts) / 1000 : 0; R.bashWaitMin += sec / 60;
            if (u.isRun) {
              const rk = runKind(u.repo, u.cmd);
              R.runs.push({ repo: u.repo, kinds: rk.kinds, nFiles: rk.nUnitFiles, filter: rk.filter, sec: Math.round(sec * 10) / 10, bg: u.bg, err: !!b.is_error, sub: !!st.sub });
            }
          } else {
            if (b.is_error || /^<tool_use_error>|Error:|String to replace not found|File has not been read/.test(res.slice(0, 120)) && !/successfully/.test(res.slice(0, 300))) continue; // failed edit
            const key = u.loc.repo === 'lv' || u.loc.repo === 'sd' ? u.loc.repo + ':' + u.loc.role : u.loc.repo + ':' + u.loc.role;
            const E = R.edits[key] || (R.edits[key] = { calls: 0, writeCalls: 0, editCalls: 0, linesWritten: 0, linesNet: 0, writesCreated: 0 });
            E.calls++; E.linesWritten += u.lw; E.linesNet += u.ln;
            if (u.tool === 'Write') E.writeCalls++; else E.editCalls++;
            const created = u.tool === 'Write' && /File created successfully/.test(res);
            if (created) E.writesCreated++;
            if (u.loc.role === 'test' && (u.loc.repo === 'lv' || u.loc.repo === 'sd')) {
              const fk = u.loc.repo + ':' + u.loc.rel; // per-session file key (rel path, so worktree + checkout edits of one file merge)
              if (!fileFirst.has(fk)) fileFirst.set(fk, created ? 'new' : 'pre');
              const T = R.testEditCalls[u.loc.repo] || (R.testEditCalls[u.loc.repo] = { onNewFile: 0, onPreexisting: 0, linesOnNew: 0, linesOnPre: 0 });
              if (fileFirst.get(fk) === 'new') { T.onNewFile++; T.linesOnNew += u.lw; } else { T.onPreexisting++; T.linesOnPre += u.lw; }
            }
          }
        }
      }
    }
    for (const [fk, v] of fileFirst) { const repo = fk.split(':')[0]; const F = R.testFiles[repo] || (R.testFiles[repo] = { new: 0, preexisting: 0, newPaths: [], prePaths: [] }); if (v === 'new') { F.new++; F.newPaths.push(fk.slice(3)); } else { F.preexisting++; F.prePaths.push(fk.slice(3)); } }
    for (const v of msgs.values()) { R.assistantTurns++; R.outputTokens += v.ot; const F = R.focus[v.focus] || (R.focus[v.focus] = { turns: 0, outTok: 0 }); F.turns++; F.outTok += v.ot; }
  }
  if (!allTs.length) continue;
  allTs.sort((a, b) => a - b);
  R.firstTs = new Date(allTs[0]).toISOString(); R.lastTs = new Date(allTs[allTs.length - 1]).toISOString();
  R.wallMin = (allTs[allTs.length - 1] - allTs[0]) / 60000;
  let act = 0; for (let i = 1; i < allTs.length; i++) act += Math.min(allTs[i] - allTs[i - 1], 10 * 60000); R.activeMin = act / 60000; // gaps capped at 10 min
  // primary repo: most successful edit calls, then test runs, then command/edit references
  const ec = (r) => Object.entries(R.edits).filter(([k]) => k.startsWith(r + ':')).reduce((a, [, v]) => a + v.calls, 0);
  const rc = (r) => R.runs.filter((x) => x.repo === r).length;
  const score = (r) => [ec(r), rc(r), R.refs[r]];
  const [a, b] = [score('lv'), score('sd')];
  const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  R.primary = a.every((x) => !x) && b.every((x) => !x) ? 'none' : cmp > 0 ? 'lv' : cmp < 0 ? 'sd' : 'tie';
  R.lvEditCalls = ec('lv'); R.sdEditCalls = ec('sd');
  for (const k of ['wallMin', 'activeMin', 'bashWaitMin']) R[k] = Math.round(R[k] * 100) / 100;
  rows.push(R);
}
rows.sort((x, y) => x.firstTs.localeCompare(y.firstTs));
writeFileSync(out, JSON.stringify(rows, null, 1));
process.stderr.write(`wrote ${rows.length} sessions to ${out}\n`);
