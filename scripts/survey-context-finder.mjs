// LIN-3178: backtest four deterministic starting-context finders (paths named in the plan, import-graph neighbours, grep of named symbols, recent co-change history) against the files implementation sessions actually edited and read.
// Usage: node scripts/survey-context-finder.mjs [--in data/survey-context/sessions.json] [--sd ../simple-dispatcher] [--out data/survey-context/finder.json] [--every 1]
// Sample: every implementation session in the extractor's snapshot that edited a repo file, from 31 August (--every n takes every nth).
// The finder's input is what the session was handed: its first dispatched prompt and its first read of its own ticket (description
// and comments as the proxy returned them). Everything runs against origin/main as it stood when the session started, so a finder sees
// only what existed then. Edited = files the session (or its subagents) wrote in the repo; used = edited or read. Recall is over files
// that existed at the base (new files cannot be found); precision is over the finder's output against used. No proxy calls.
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { posix } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const input = arg('--in', 'data/survey-context/sessions.json');
const DIRS = { LinearViewer: '.', 'simple-dispatcher': arg('--sd', '../simple-dispatcher') };
const outPath = arg('--out', 'data/survey-context/finder.json');
const every = Number(arg('--every', '1'));
const since = Date.parse('2026-08-31');

const git = (repo, args) => { try { return execFileSync('git', ['-C', DIRS[repo], ...args], { encoding: 'utf8', maxBuffer: 256e6, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return e.stdout || ''; } };
const cache = new Map();
const memo = (k, f) => (cache.has(k) ? cache.get(k) : (cache.set(k, f()), cache.get(k)));
const baseAt = (repo, t) => memo(`base|${repo}|${t}`, () => git(repo, ['rev-list', '-1', `--before=${new Date(t).toISOString()}`, 'origin/main']).trim());
const filesAt = (repo, base) => memo(`files|${repo}|${base}`, () => new Set(git(repo, ['ls-tree', '-r', '--name-only', base]).split('\n').filter((f) => f && !f.startsWith('node_modules/'))));
const CODE = /\.(m?js|cjs|ts|css|html|json|sh|md|ya?ml)$/;

// M1: paths the plan names, exactly or by a unique basename.
function namedPaths(text, files) {
  const out = new Set(); const byBase = new Map();
  for (const f of files) { const b = posix.basename(f); (byBase.get(b) || byBase.set(b, []).get(b)).push(f); }
  for (const m of text.matchAll(/[\w./@-]*[\w-]+\.(?:m?js|cjs|ts|css|html|json|sh|md|ya?ml)\b/g)) {
    let p = m[0].replace(/^\.\//, '').replace(/^(LinearViewer|simple-dispatcher)\//, '');
    if (files.has(p)) { out.add(p); continue; }
    const tail = [...files].find((f) => p.includes('/') && f.endsWith('/' + p)); if (tail) { out.add(tail); continue; }
    const b = byBase.get(posix.basename(p)); if (b && b.length === 1) out.add(b[0]);
  }
  return out;
}
// M2: one hop of the import graph, both directions, at the base.
const IMPORT_RE = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
function resolveSpec(fromFile, spec, files) {
  const p = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  for (const c of [p, `${p}.js`, `${p}.mjs`, `${p}/index.js`]) if (files.has(c)) return c;
  return null;
}
function importsOf(repo, base, f, files) {
  return memo(`imp|${repo}|${base}|${f}`, () => { if (!/\.m?js$/.test(f)) return []; const src = git(repo, ['show', `${base}:${f}`]); const o = []; for (const m of src.matchAll(IMPORT_RE)) { const r = resolveSpec(f, m[1], files); if (r) o.push(r); } return o; });
}
function importers(repo, base, f, files) {
  return memo(`rev|${repo}|${base}|${f}`, () => {
    const stem = posix.basename(f).replace(/\.m?js$/, '');
    const hits = git(repo, ['grep', '-l', '-E', `['"][./]+[^'"]*${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.m?js)?['"]`, base, '--', '*.js', '*.mjs']).split('\n').filter(Boolean).map((x) => x.slice(base.length + 1));
    return hits.filter((h) => importsOf(repo, base, h, files).includes(f));
  });
}
// M3: symbols the plan names in backticks or as calls, grepped at the base; a symbol in more than 20 files is too common to use.
function symbols(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`\n]{3,80})`/g)) for (const w of m[1].match(/[A-Za-z_$][\w$]{3,}/g) || []) if (/[a-z][A-Z]|_|^[A-Z][A-Z0-9_]{3,}$|^[a-z]+[A-Z]/.test(w)) out.add(w);
  for (const m of text.matchAll(/\b([a-z][a-zA-Z0-9]{3,}[A-Z][a-zA-Z0-9]*)\s*\(/g)) out.add(m[1]);
  return out;
}
function grepSymbols(repo, base, syms, files) {
  const out = new Set();
  for (const s of syms) {
    const hits = memo(`g|${repo}|${base}|${s}`, () => git(repo, ['grep', '-l', '-w', '-F', s, base, '--', '*.js', '*.mjs', '*.css', '*.html', ':!node_modules']).split('\n').filter(Boolean).map((x) => x.slice(base.length + 1)));
    if (hits.length && hits.length <= 20) for (const h of hits) if (files.has(h)) out.add(h);
  }
  return out;
}
// M4: files changed with a named path at least three times in that path's last 20 commits before the base (--full-diff, so the
// commits' other files are listed too).
function coChanged(repo, base, named) {
  const count = new Map();
  for (const f of named) {
    const log = memo(`log|${repo}|${base}|${f}`, () => git(repo, ['log', '-n', '20', '--full-diff', '--format=@%H', '--name-only', base, '--', f]));
    const seen = new Set();
    for (const block of log.split('@').filter(Boolean)) for (const g of block.split('\n').slice(1).filter(Boolean)) { if (g === f) continue; const k = `${block.slice(0, 40)}|${g}`; if (seen.has(k)) continue; seen.add(k); count.set(g, (count.get(g) || 0) + 1); }
  }
  return new Set([...count.entries()].filter(([, n]) => n >= 3).map(([g]) => g));
}

const unescape = (t) => (t || '').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t');
const { sessions } = JSON.parse(readFileSync(input, 'utf8'));
const sample = sessions.filter((s) => s.kind === 'implementation' && s.first >= since && s.edits.length).sort((a, b) => a.first - b.first).filter((_, i) => i % every === 0);
const rows = [];
for (const s of sample) {
  const votes = {}; for (const e of s.edits) { const r = e.key.split(':')[0]; votes[r] = (votes[r] || 0) + 1; }
  const repo = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  const base = baseAt(repo, s.first); if (!base) continue;
  const files = filesAt(repo, base);
  const rel = (k) => k.slice(repo.length + 1);
  const edited = new Set(s.edits.filter((e) => e.key.startsWith(repo + ':')).map((e) => rel(e.key)).filter((f) => CODE.test(f)));
  const read = new Set(s.reads.filter((r) => r.key?.startsWith(repo + ':') && r.via !== 'auto-loaded').map((r) => rel(r.key)).filter((f) => files.has(f)));
  const editedExisting = new Set([...edited].filter((f) => files.has(f)));
  const used = new Set([...editedExisting, ...read]);
  const text = unescape(s.promptText) + '\n' + unescape(s.ticketText);
  const m1 = namedPaths(text, files);
  const m2 = new Set(); for (const f of m1) { for (const x of importsOf(repo, base, f, files)) m2.add(x); for (const x of importers(repo, base, f, files)) m2.add(x); }
  const m3 = grepSymbols(repo, base, symbols(text), files);
  const m4 = coChanged(repo, base, m1);
  const fwd = new Set(); for (const f of m1) for (const x of importsOf(repo, base, f, files)) if (!m1.has(x)) fwd.add(x);
  const methods = { 'named paths': m1, 'import neighbours': new Set([...m2].filter((x) => !m1.has(x))), 'imports only (forward)': fwd, 'symbol grep': m3, 'co-change history': m4 };
  const union = new Set([...m1, ...m2, ...m3, ...m4]);
  const score = (set) => ({ n: set.size, hitEdited: [...set].filter((f) => editedExisting.has(f)).length, hitUsed: [...set].filter((f) => used.has(f)).length });
  rows.push({ file: s.file.slice(0, 8), issue: s.headerIssue, repo, base: base.slice(0, 10), edited: edited.size, editedExisting: editedExisting.size, read: read.size, used: used.size,
    methods: Object.fromEntries(Object.entries(methods).map(([k, v]) => [k, score(v)])), m1m2: score(new Set([...m1, ...m2])), union: score(union),
    missedEdited: [...editedExisting].filter((f) => !union.has(f)).slice(0, 12) });
  process.stderr.write('.');
}
process.stderr.write('\n');

const r1 = (x) => (x == null ? null : +x.toFixed(1));
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function summary(rs, pick) {
  const E = rs.reduce((a, r) => a + r.editedExisting, 0); const U = rs.reduce((a, r) => a + r.used, 0);
  const n = rs.reduce((a, r) => a + pick(r).n, 0); const he = rs.reduce((a, r) => a + pick(r).hitEdited, 0); const hu = rs.reduce((a, r) => a + pick(r).hitUsed, 0);
  const withE = rs.filter((r) => r.editedExisting);
  return { sessions: rs.length, suggested: n, medianSuggested: median(rs.map((r) => pick(r).n)), recallEdited: r1(100 * he / E), recallUsed: r1(100 * hu / U), precisionUsed: n ? r1(100 * hu / n) : null, precisionEdited: n ? r1(100 * he / n) : null,
    medianSessionRecallEdited: r1(median(withE.map((r) => 100 * pick(r).hitEdited / r.editedExisting))), allEditedFound: withE.filter((r) => pick(r).hitEdited === r.editedExisting).length, withEdited: withE.length };
}
const out = { generatedAt: new Date().toISOString(), sample: rows.length, newFileShare: r1(100 * (1 - rows.reduce((a, r) => a + r.editedExisting, 0) / rows.reduce((a, r) => a + r.edited, 0))), medianEdited: median(rows.map((r) => r.editedExisting)), medianRead: median(rows.map((r) => r.read)), byRepo: Object.fromEntries(['LinearViewer', 'simple-dispatcher'].map((k) => [k, rows.filter((r) => r.repo === k).length])), results: {} };
for (const [k, pick] of [...['named paths', 'import neighbours', 'imports only (forward)', 'symbol grep', 'co-change history'].map((m) => [m, (r) => r.methods[m]]), ['named paths + imports', (r) => r.m1m2], ['all four', (r) => r.union]]) {
  out.results[k] = { all: summary(rows, pick), LinearViewer: summary(rows.filter((r) => r.repo === 'LinearViewer'), pick), 'simple-dispatcher': summary(rows.filter((r) => r.repo === 'simple-dispatcher'), pick) };
}
out.rows = rows;
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`sample ${rows.length} implementation sessions`, out.byRepo, `new files ${out.newFileShare}% of edited; median edited (existing) ${out.medianEdited}, median read ${out.medianRead}`);
console.log(['method', 'repo', 'suggested(med)', 'recall edited %', 'recall used %', 'precision used %', 'precision edited %', 'median session recall', 'all edited found'].join('\t'));
for (const [k, v] of Object.entries(out.results)) for (const [repo, x] of Object.entries(v)) console.log([k, repo, x.medianSuggested, x.recallEdited, x.recallUsed, x.precisionUsed, x.precisionEdited, x.medianSessionRecallEdited, `${x.allEditedFound}/${x.withEdited}`].join('\t'));
