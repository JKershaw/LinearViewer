// Scratch import walker (walker K re-implementation): static import / export-from over
// server.js, lib/, routes/ at a commit, read from git blobs, parsed with the repo's acorn.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const [repo, sha, scopeArg] = process.argv.slice(2);
const req = createRequire(path.resolve(repo, 'package.json'));
const acorn = req('acorn');
const walk = (() => { try { return req('acorn-walk'); } catch { return null; } })();
const SCOPE = new RegExp(scopeArg || '^(server\\.js$|(lib|routes)/.*\\.[cm]?js$)');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { maxBuffer: 1 << 28 }).toString();
const files = git('ls-tree', '-r', '--name-only', sha).split('\n').filter(f => SCOPE.test(f));
const set = new Set(files);
const show = f => git('show', `${sha}:${f}`);
function resolve(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const c of [base, base + '.js', base + '.mjs', base + '.cjs', base + '/index.js']) if (set.has(c)) return c;
  return null;
}
const stat = new Set(), dyn = new Set(); let parseFail = [];
for (const f of files) {
  let ast;
  try { ast = acorn.parse(show(f), { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowAwaitOutsideFunction: true }); }
  catch (e) { parseFail.push(f); continue; }
  for (const n of ast.body) {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) {
      const t = resolve(f, n.source.value); if (t) stat.add(f + '\u0000' + t);
    }
  }
  // dynamic import('literal') anywhere
  (function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'ImportExpression' && node.source.type === 'Literal' && typeof node.source.value === 'string') {
      const t = resolve(f, node.source.value); if (t) dyn.add(f + '\u0000' + t);
    }
    for (const k in node) { const v = node[k]; if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === 'string') visit(v); }
  })(ast);
}
// Tarjan on static edges
const adj = new Map(files.map(f => [f, []]));
for (const e of stat) { const [a, b] = e.split('\u0000'); adj.get(a).push(b); }
let idx = 0; const st = [], on = new Set(), I = new Map(), low = new Map(), sccs = [];
function sc(v) { I.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
  for (const w of adj.get(v)) { if (!I.has(w)) { sc(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), I.get(w))); }
  if (low.get(v) === I.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) sccs.push(c.sort()); } }
for (const f of files) if (!I.has(f)) sc(f);
const isLib = f => f.startsWith('lib/'), isUp = t => t.startsWith('routes/') || t === 'server.js';
const pairs = s => [...s].map(e => e.split('\u0000'));
const out = {
  sha, scope: SCOPE.source, nodes: files.length, staticEdges: stat.size, dynamicEdges: dyn.size,
  sccs: sccs.map(c => ({ size: c.length, members: c })),
  upward: { static: pairs(stat).filter(([a, b]) => isLib(a) && isUp(b)).length, dynamic: pairs(dyn).filter(([a, b]) => isLib(a) && isUp(b)).length },
  routeToRoute: pairs(stat).filter(([a, b]) => a.startsWith('routes/') && b.startsWith('routes/')).length,
  parseFail, edges: [...stat].sort().map(e => e.replace('\u0000', ' -> ')), dynamic: [...dyn].sort().map(e => e.replace('\u0000', ' -> ')),
};
console.log(JSON.stringify(out, null, 1));
console.error(`${sha.slice(0, 8)}: ${out.nodes} nodes, ${out.staticEdges} static, ${out.dynamicEdges} dynamic, SCCs ${out.sccs.map(s => s.size).join('+') || 0}, upward ${out.upward.static}/${out.upward.dynamic}, route->route ${out.routeToRoute}, parseFail ${parseFail.length}`);
