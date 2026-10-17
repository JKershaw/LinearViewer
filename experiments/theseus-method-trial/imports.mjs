// Import map + knots for one commit.  node imports.mjs [commit] [--json]
// Edge = one require('./x') / import call site (top-level OR lazy inside a function; both are
// real dependencies). Re-exports via require count the same. Dynamic paths are listed, not resolved.
import path from 'node:path';
import { resolveCommit, listFiles, show, areaOf, PRODUCTION, parse, walk } from './lib.mjs';

const commit = resolveCommit(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'HEAD');
const asJson = process.argv.includes('--json');
const files = listFiles(commit);
const fileSet = new Set(files);
const jsFiles = files.filter(p => /\.(c|m)?js$/.test(p));

function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null; // package / builtin
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const c of [base, base + '.js', base + '.json', base + '.cjs', base + '.mjs', base + '/index.js']) if (fileSet.has(c)) return c;
  return 'UNRESOLVED:' + base;
}

const edges = []; const unmapped = new Set(); const dynamic = []; const parseErrors = [];
for (const f of jsFiles) {
  let ast; const src = show(commit, f);
  try { ast = parse(src); } catch (e) { parseErrors.push(`${f}: ${e.message}`); continue; }
  const lazyRanges = [];
  walk.full(ast, n => { if (/Function/.test(n.type)) lazyRanges.push([n.start, n.end]); });
  const record = (spec, node, kind) => {
    const to = resolveSpec(f, spec); if (!to) return;
    const lazy = lazyRanges.some(([s, e]) => node.start > s && node.end <= e);
    edges.push({ from: f, to, line: node.loc.start.line, kind, lazy });
  };
  walk.full(ast, n => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require') {
      const a = n.arguments[0];
      if (a && a.type === 'Literal' && typeof a.value === 'string') record(a.value, n, 'require');
      else if (a) dynamic.push(`${f}:${n.loc.start.line}`);
    }
    if (n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') {
      if (n.source) record(n.source.value, n, 'import');
    }
    if (n.type === 'ImportExpression' && n.source.type === 'Literal') record(n.source.value, n, 'dynamic-import');
  });
}

// Area edges
const pair = new Map(); // "A->B" -> [edges]
for (const e of edges) {
  const a = areaOf(e.from), b = areaOf(e.to.replace(/^UNRESOLVED:/, ''));
  if (!a) unmapped.add(e.from); if (!b) unmapped.add(e.to);
  if (!a || !b || a === b) continue;
  const k = `${a}->${b}`; if (!pair.has(k)) pair.set(k, []); pair.get(k).push(e);
}
const knots = [];
for (const k of pair.keys()) {
  const [a, b] = k.split('->'); if (a > b) continue;
  if (pair.has(`${b}->${a}`)) knots.push({ a, b, ab: pair.get(k), ba: pair.get(`${b}->${a}`) });
}
for (const k of pair.keys()) { const [a, b] = k.split('->'); if (a > b && pair.has(`${b}->${a}`) && !knots.find(x => x.a === b && x.b === a)) knots.push({ a: b, b: a, ab: pair.get(`${b}->${a}`), ba: pair.get(k) }); }

// Tangled groups: strongly connected components of the area graph (Tarjan), size >= 2.
function scc(nodes, adj) {
  let i = 0; const idx = new Map(), low = new Map(), st = [], on = new Set(), out = [];
  const go = v => { idx.set(v, i); low.set(v, i); i++; st.push(v); on.add(v);
    for (const w of adj.get(v) || []) { if (!idx.has(w)) { go(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w))); }
    if (low.get(v) === idx.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); out.push(c); } };
  for (const v of nodes) if (!idx.has(v)) go(v);
  return out.filter(c => c.length > 1);
}
const areaAdj = new Map();
for (const k of pair.keys()) { const [a, b] = k.split('->'); if (!areaAdj.has(a)) areaAdj.set(a, new Set()); areaAdj.get(a).add(b); }
const groups = scc([...new Set([...pair.keys()].flatMap(k => k.split('->')))], areaAdj);

// File-level cycles too (a knot inside one area is invisible at area level).
const fileAdj = new Map();
for (const e of edges) { if (!fileAdj.has(e.from)) fileAdj.set(e.from, new Set()); fileAdj.get(e.from).add(e.to); }
const fileCycles = scc([...new Set(edges.flatMap(e => [e.from, e.to]))], fileAdj);

const prodKnots = knots.filter(k => PRODUCTION.has(k.a) && PRODUCTION.has(k.b));
const summary = {
  commit, files: jsFiles.length, edges: edges.length, areaPairs: pair.size,
  knots: knots.map(k => `${k.a}<->${k.b} (${k.ab.length}/${k.ba.length})`),
  productionKnots: prodKnots.length, groups, fileCycles, unmapped: [...unmapped], dynamic, parseErrors,
};
if (asJson) { console.log(JSON.stringify({ summary, pairs: Object.fromEntries([...pair].map(([k, v]) => [k, v.length])), knots }, null, 2)); process.exit(0); }

console.log(`commit ${commit}`);
console.log(`js files ${jsFiles.length}, local import sites ${edges.length} (lazy: ${edges.filter(e => e.lazy).length}), area pairs with edges ${pair.size}`);
console.log(`unmapped: ${[...unmapped].join(', ') || 'none'}; dynamic requires: ${dynamic.join(', ') || 'none'}; parse errors: ${parseErrors.length}`);
console.log('\nProduction area matrix (row imports column; count of import sites):');
const prod = [...PRODUCTION];
console.log('from\\to'.padEnd(11) + prod.map(p => p.slice(0, 6).padStart(7)).join(''));
for (const a of prod) console.log(a.padEnd(11) + prod.map(b => { const v = (pair.get(`${a}->${b}`) || []).length; return (a === b ? '.' : v ? String(v) : '').padStart(7); }).join(''));
console.log(`\nKNOTS (two-way area pairs), all areas: ${knots.length}; production only: ${prodKnots.length}`);
for (const k of knots) {
  console.log(`\n  ${k.a} <-> ${k.b}   ${k.a}->${k.b}: ${k.ab.length} site(s), ${k.b}->${k.a}: ${k.ba.length} site(s)`);
  for (const e of [...k.ab, ...k.ba]) console.log(`     ${e.from}:${e.line} -> ${e.to}${e.lazy ? '  (lazy)' : ''}`);
}
console.log(`\nTangled groups (SCCs of the area graph): ${groups.map(g => '{' + g.sort().join(', ') + '}').join('  ') || 'none'}`);
console.log(`File-level cycles: ${fileCycles.map(g => '{' + g.sort().join(', ') + '}').join('  ') || 'none'}`);
