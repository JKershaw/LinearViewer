#!/usr/bin/env node
// Coherence census for the paper "Does a codebase built by agents lose coherence as it grows?"
// Reproducible from git history alone (plus jscpd@4.0.5 via npx for the clone census).
//
// Usage (run from a LinearViewer checkout with origin/main fetched):
//   node coherence-census.mjs snapshots [rev]                 # month-end first-parent commits
//   node coherence-census.mjs clones <sha> [--out dir]        # jscpd clone census of production code at a snapshot
//   node coherence-census.mjs admissions <sha>                # self-admitted mirrors + sync-pinning tests at a snapshot
//   node coherence-census.mjs mirrored [rev] [--json]         # per merged PR: production files that received the same added lines
//   node coherence-census.mjs coupling <sha> --since D --until D   # co-change pairs with no import edge, over a window
//   node coherence-census.mjs prs [rev] --json                # per merged PR: ticket, files, lines, commits, span
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve as presolve } from 'path';

const repo = process.env.REPO || '.';
const git = (a, input) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 30, input, stdio: ['pipe', 'pipe', 'ignore'] });
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

// Production code, as steady-base-code.mjs and survey-growth-git.mjs define it.
export const isProd = (p) => /\.(js|mjs)$/.test(p) && (p === 'server.js' || /^(lib|routes)\//.test(p) || (/^public\//.test(p) && !/vendor|\.min\./.test(p)));
export const isTest = (p) => /^tests\/.*\.(js|mjs)$/.test(p) && !/^tests\/fixtures\//.test(p);
// Areas, first match wins (survey-growth-git.mjs, LIN-3147).
export const AREAS = [
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
];
export const areaOf = (p) => (AREAS.find(([, re]) => re.test(p)) || ['other'])[0];

function monthEnds(rev = 'origin/main') {
  const seen = new Map();
  for (const l of git(['log', '--first-parent', '--format=%H %cs', rev]).trim().split('\n')) {
    const [sha, day] = l.split(' ');
    const m = day.slice(0, 7);
    if (!seen.has(m)) seen.set(m, { sha, day });
  }
  return [...seen.entries()].reverse().map(([month, v]) => ({ month, ...v }));
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
const lsProd = (sha) => git(['ls-tree', '-r', '--name-only', sha]).trim().split('\n').filter(isProd);
const lsTests = (sha) => git(['ls-tree', '-r', '--name-only', sha]).trim().split('\n').filter(isTest);

// ---------- snapshots ----------
if (cmd === 'snapshots') {
  const rows = monthEnds(args[1] || 'origin/main');
  console.log(JSON.stringify(rows, null, 1));
}

// ---------- clones (jscpd) ----------
if (cmd === 'clones') {
  const sha = args[1];
  const outDir = flag('--out', join(tmpdir(), 'coherence-clones'));
  mkdirSync(outDir, { recursive: true });
  const tree = mkdtempSync(join(tmpdir(), 'snap-'));
  const files = lsProd(sha);
  // Materialise only the production files at this snapshot.
  const texts = readBlobs(sha, files);
  files.forEach((p, i) => { mkdirSync(join(tree, dirname(p)), { recursive: true }); writeFileSync(join(tree, p), texts[i]); });
  const minTokens = flag('--min-tokens', '50');
  const report = join(outDir, sha.slice(0, 8));
  mkdirSync(report, { recursive: true });
  try {
    execFileSync('npx', ['--yes', 'jscpd@4.0.5', '--min-tokens', minTokens, '--min-lines', '5', '--format', 'javascript', '--reporters', 'json', '--output', report, '--silent', '--absolute', tree], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) { /* jscpd exits non-zero when a threshold is set; none is, so this is a real error */ console.error('jscpd failed', e.message); }
  const j = JSON.parse(readFileSync(join(report, 'jscpd-report.json'), 'utf8'));
  const rel = (f) => f.replace(tree + '/', '');
  const pairs = j.duplicates.map((d) => {
    const a = rel(d.firstFile.name), b = rel(d.secondFile.name);
    return { a, b, aArea: areaOf(a), bArea: areaOf(b), lines: d.lines, tokens: d.tokens, aStart: d.firstFile.start, bStart: d.secondFile.start, sameFile: a === b, crossArea: areaOf(a) !== areaOf(b), fragment: (d.fragment || '').slice(0, 400) };
  });
  const total = j.statistics.total;
  const byArea = {};
  for (const p of pairs) for (const f of new Set([p.a, p.b])) { const ar = areaOf(f); byArea[ar] = (byArea[ar] || 0) + 1; }
  const out = { sha, files: files.length, totalLines: total.lines, duplicatedLines: total.duplicatedLines, percentage: total.percentage, clones: total.clones, pairs: pairs.length, crossFilePairs: pairs.filter((p) => !p.sameFile).length, crossAreaPairs: pairs.filter((p) => p.crossArea).length, byArea, pairList: pairs };
  writeFileSync(join(report, 'summary.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ...out, pairList: undefined }));
}

// ---------- admissions: self-admitted mirrors and sync-pinning tests ----------
// A comment that says a second site deliberately restates another one.
// Strong admissions only: the comment names a second site that holds the same rule or fact, or says the two must be kept the same.
// "mirrors the X pattern / precedent / idiom" (an analogy) is deliberately NOT matched.
const FILE = String.raw`[\x60'"]?(?:lib|public|routes|server\.js|tests|scripts)[\w./-]*`;
export const ADMIT = new RegExp(String.raw`(` +
  String.raw`\bmirror(?:s|ed)?\s+(?:of|in|into|from)\s+${FILE}` + '|' +
  String.raw`\bmirrored\s+(?:in|by|into|from)\s+${FILE}` + '|' +
  String.raw`\b(?:is|as)\s+(?:a\s+)?mirror\s+of\b` + '|' +
  String.raw`\b(?:keep|keeps|kept|stay|stays|staying|remain|remains|held|hold)\s+(?:this\s+|these\s+|it\s+|them\s+|both\s+|the\s+two\s+)?in\s+(?:lock-?step|sync)\b` + '|' +
  String.raw`\bin\s+lock-?step\s+with\b` + '|' +
  String.raw`\bmust\s+(?:stay|remain|be\s+kept|match|agree|be)\s+(?:identical|byte-identical|in\s+sync|the\s+same|consistent\s+with|aligned\s+with)\b` + '|' +
  String.raw`\b(?:same|identical|exact\s+same)\s+(?:logic|rule|rules|predicate|regex|regexp|pattern|list|set|check|ordering|order|algorithm|heuristic|constant|threshold|mapping|table|shape)\s+(?:as|in|used\s+in|used\s+by|that|from)\s+(?:the\s+)?${FILE}` + '|' +
  String.raw`\bduplicat(?:e|ed|es|ion)\s+(?:of|from|in)\s+${FILE}` + '|' +
  String.raw`\bcopied\s+(?:from|verbatim)\b` + '|' +
  String.raw`\bcopy\s+of\s+${FILE}` + '|' +
  String.raw`\b(?:verbatim|exact|exactly)\s+(?:copy|mirror|restatement|twin|port)\b` + '|' +
  String.raw`\b(?:client|server|browser)-side\s+(?:copy|twin|mirror|port|version|equivalent)\s+of\b` + '|' +
  String.raw`\bport\s+of\s+${FILE}` + '|' +
  String.raw`\bparity\s+with\s+${FILE}` + '|' +
  String.raw`\bsingle\s+source\s+of\s+truth\b` + '|' +
  String.raw`\bdrift\s+guard\b` + '|' +
  String.raw`\b(?:two|three|four|five|both)\s+(?:copies|places|definitions|implementations|sites)\b` + '|' +
  String.raw`\b(?:both|each|every)\s+(?:copy|copies|site|sites|place|places|path|paths|implementation|implementations)\s+(?:must|has\s+to|have\s+to|need|needs)\b` + '|' +
  String.raw`\bre-?implement(?:s|ed|ation|ing)?\s+(?:here|locally|client-side|server-side|inline|in\s+${FILE})` + '|' +
  String.raw`\brestated\s+(?:in|from|at)\s+${FILE}` + '|' +
  String.raw`\bchange\s+(?:both|them\s+together|in\s+both\s+places)\b` + '|' +
  String.raw`\bupdate\s+both\b` +
  ')', 'i');
const SYNC_TEST = /parity|drift|census|mirror|single-source|one-path|in-sync|inventory|allow-?list|guard/i;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

if (cmd === 'admissions') {
  const sha = args[1];
  const files = lsProd(sha);
  const texts = readBlobs(sha, files);
  const hits = [];
  files.forEach((p, i) => {
    const lines = texts[i].split('\n');
    lines.forEach((line, n) => { if (COMMENT.test(line) && ADMIT.test(line)) hits.push({ file: p, line: n + 1, area: areaOf(p), text: line.trim().slice(0, 200) }); });
  });
  const tests = lsTests(sha).filter((p) => SYNC_TEST.test(p.split('/').pop()));
  const byArea = {}; for (const h of hits) byArea[h.area] = (byArea[h.area] || 0) + 1;
  const prodLines = texts.reduce((s, t) => s + t.split('\n').filter((l) => l.trim()).length, 0);
  const out = { sha, prodFiles: files.length, prodLines, admissions: hits.length, admissionFiles: new Set(hits.map((h) => h.file)).size, byArea, syncTests: tests.length, syncTestFiles: tests, hits };
  console.log(JSON.stringify(has('--brief') ? { ...out, hits: undefined, syncTestFiles: undefined } : out));
}

// ---------- merged PRs ----------
export function mergedPrs(rev = 'origin/main') {
  const rows = [];
  for (const l of git(['log', '--first-parent', '--format=%H|%cs|%P|%s', rev]).trim().split('\n')) {
    const [sha, day, parents, subject] = l.split('|');
    const m = subject.match(/Merge pull request #(\d+) from \S+\/(\S+)/) || subject.match(/\(#(\d+)\)$/);
    if (!m) continue;
    const branch = m[2] || '';
    const t = (subject + ' ' + branch).match(/\b[Ll][Ii][Nn]-?(\d{2,4})\b/);
    rows.push({ sha, day, pr: Number(m[1]), ticket: t ? `LIN-${t[1]}` : null, subject, branch, parents: parents.split(' ') });
  }
  return rows.reverse();
}

function prDiffFiles(r) {
  // For a merge commit, the PR's change is first-parent..merge; for a squash, parent..commit.
  const base = r.parents[0];
  const numstat = git(['diff', '--numstat', base, r.sha]).trim();
  const files = [];
  for (const l of numstat ? numstat.split('\n') : []) {
    const [a, d, p] = l.split('\t'); if (!p) continue;
    files.push({ path: p, added: a === '-' ? 0 : Number(a), deleted: d === '-' ? 0 : Number(d) });
  }
  return files;
}

if (cmd === 'prs') {
  const rows = mergedPrs(args[1] && !args[1].startsWith('--') ? args[1] : 'origin/main');
  const out = [];
  for (const r of rows) {
    const files = prDiffFiles(r);
    const prod = files.filter((f) => isProd(f.path)), tests = files.filter((f) => isTest(f.path));
    let commits = 1, firstDay = r.day;
    if (r.parents.length > 1) {
      const log = git(['log', '--format=%cs', `${r.parents[0]}..${r.parents[1]}`]).trim();
      const days = log ? log.split('\n') : [];
      commits = days.length; firstDay = days[days.length - 1] || r.day;
    }
    out.push({ pr: r.pr, sha: r.sha.slice(0, 8), day: r.day, ticket: r.ticket, commits, firstDay, prodFiles: prod.map((f) => f.path), prodAdded: prod.reduce((s, f) => s + f.added, 0), prodDeleted: prod.reduce((s, f) => s + f.deleted, 0), testFiles: tests.length, testAdded: tests.reduce((s, f) => s + f.added, 0), testDeleted: tests.reduce((s, f) => s + f.deleted, 0), otherFiles: files.length - prod.length - tests.length, areas: [...new Set(prod.map((f) => areaOf(f.path)))] });
  }
  console.log(JSON.stringify(out));
}

// ---------- mirrored changes: the same added lines landing in two production files in one PR ----------
const TRIVIAL = /^\s*(\}|\{|\)|\]|\);|\},|\]\)|\}\);|return;?|break;|continue;|else\s*\{|try\s*\{|\} else \{|\} catch \(\w*\) \{|\} finally \{|export default|'use strict';)\s*$/;
const NOISE = /^\s*(import |export \{|const \{[^}]*\} = require|require\(|\/\/|\/\*|\*)/;
export function significant(line) {
  const t = line.trim();
  if (t.length < 30) return false;
  if (TRIVIAL.test(t) || NOISE.test(t)) return false;
  return true;
}
const norm = (l) => l.replace(/\s+/g, ' ').trim();

if (cmd === 'mirrored') {
  const rev = args[1] && !args[1].startsWith('--') ? args[1] : 'origin/main';
  const K = Number(flag('--k', '3'));
  const rows = mergedPrs(rev);
  const out = [];
  for (const r of rows) {
    const base = r.parents[0];
    const diff = git(['diff', '--unified=0', '--no-color', base, r.sha, '--', 'server.js', 'lib', 'routes', 'public']);
    const added = new Map(); let cur = null;
    for (const l of diff.split('\n')) {
      if (l.startsWith('+++ ')) { const p = l.slice(6); cur = isProd(p) ? p : null; continue; }
      if (!cur || !l.startsWith('+') || l.startsWith('+++')) continue;
      const body = l.slice(1);
      if (!significant(body)) continue;
      if (!added.has(cur)) added.set(cur, new Set());
      added.get(cur).add(norm(body));
    }
    const files = [...added.keys()];
    const pairs = [];
    for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
      const A = added.get(files[i]), B = added.get(files[j]);
      const shared = [...A].filter((x) => B.has(x));
      if (shared.length >= K) pairs.push({ a: files[i], b: files[j], shared: shared.length, sample: shared.slice(0, 3) });
    }
    if (pairs.length) out.push({ pr: r.pr, day: r.day, ticket: r.ticket, sha: r.sha.slice(0, 8), filesWithAdds: files.length, pairs });
  }
  if (has('--json')) console.log(JSON.stringify({ k: K, prs: rows.length, mirrored: out }));
  else {
    const byMonth = {};
    for (const r of rows) { const m = r.day.slice(0, 7); byMonth[m] ||= { prs: 0, mirrored: 0, pairs: 0 }; byMonth[m].prs++; }
    for (const o of out) { const m = o.day.slice(0, 7); byMonth[m].mirrored++; byMonth[m].pairs += o.pairs.length; }
    for (const [m, v] of Object.entries(byMonth)) console.log(m, v.prs, v.mirrored, (100 * v.mirrored / v.prs).toFixed(1) + '%', v.pairs);
  }
}

// ---------- coupling: co-changed production files with no import edge ----------
function importGraph(sha) {
  const files = lsProd(sha); const set = new Set(files);
  const texts = readBlobs(sha, files);
  const edges = new Map();
  files.forEach((p, i) => {
    const deps = new Set();
    const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
    let m; while ((m = re.exec(texts[i]))) {
      let target = presolve('/', dirname(p), m[1]).slice(1);
      if (!set.has(target)) { if (set.has(target + '.js')) target = target + '.js'; else if (set.has(target + '/index.js')) target = target + '/index.js'; else continue; }
      deps.add(target);
    }
    edges.set(p, deps);
  });
  return edges;
}

if (cmd === 'coupling') {
  const sha = args[1];
  const since = flag('--since'), until = flag('--until');
  const minCo = Number(flag('--min', '3'));
  const edges = importGraph(sha);
  const linked = (a, b) => (edges.get(a)?.has(b)) || (edges.get(b)?.has(a));
  const rows = mergedPrs('origin/main').filter((r) => r.day >= since && r.day <= until);
  const co = new Map(); const touch = new Map();
  for (const r of rows) {
    const prod = [...new Set(prDiffFiles(r).map((f) => f.path).filter(isProd))];
    if (prod.length > 25) continue; // sweeping refactors and renames would couple everything
    for (const p of prod) touch.set(p, (touch.get(p) || 0) + 1);
    for (let i = 0; i < prod.length; i++) for (let j = i + 1; j < prod.length; j++) {
      const k = [prod[i], prod[j]].sort().join('|'); co.set(k, (co.get(k) || 0) + 1);
    }
  }
  const pairs = [...co.entries()].filter(([, n]) => n >= minCo).map(([k, n]) => { const [a, b] = k.split('|'); return { a, b, co: n, touchA: touch.get(a), touchB: touch.get(b), linked: linked(a, b), aArea: areaOf(a), bArea: areaOf(b), bothLib: !/^public\//.test(a) && !/^public\//.test(b) }; });
  const hidden = pairs.filter((p) => !p.linked);
  const out = { sha, since, until, prs: rows.length, pairs: pairs.length, hidden: hidden.length, hiddenBothLib: hidden.filter((p) => p.bothLib).length, hiddenCrossArea: hidden.filter((p) => p.aArea !== p.bArea).length, list: has('--json') ? pairs.sort((x, y) => y.co - x.co) : undefined };
  console.log(JSON.stringify(out));
}
