// Seams & Tangles measurement: how the areas of the code import each other.
// Usage: node seams.mjs <repoDir> <commit> [areaGuidePath]  → JSON on stdout
// Facts only: links, knots (mutual pairs and groups) and entry files. Judgement is the reviewer's.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { readCommit } from './code-shape-lib.mjs';

const DEFAULT_GUIDE = fileURLToPath(new URL('./areas.json', import.meta.url));

export const inScope = (p) =>
  /\.m?js$/.test(p) && !/\.min\.js$/.test(p) &&
  (p === 'server.js' || /^(lib|routes|public)\//.test(p));

const compileGuide = (areaMap) => areaMap.areas.map((a) => ({ name: a.name, rx: a.match.map((m) => new RegExp(m)) }));
const areaOf = (guide, path) => guide.find((a) => a.rx.some((r) => r.test(path)))?.name ?? null;

const parseSource = (text) => {
  for (const sourceType of ['module', 'script']) {
    try {
      return parse(text, {
        ecmaVersion: 'latest', sourceType, allowHashBang: true,
        allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
      });
    } catch { /* try the next source type */ }
  }
  return null;
};

// Returns the string specifiers a module imports, plus a count of dynamic imports with a non-literal argument.
const extractSpecs = (ast) => {
  const specs = [];
  let nonLiteral = 0;
  for (const node of ast.body) {
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      specs.push(node.source.value);
    }
  }
  simple(ast, {
    ImportExpression(node) {
      if (node.source?.type === 'Literal' && typeof node.source.value === 'string') specs.push(node.source.value);
      else nonLiteral++;
    },
  });
  return { specs, nonLiteral };
};

const sccs = (nodes, adj) => {
  let index = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], out = [];
  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      out.push(comp.sort());
    }
  };
  for (const v of nodes) if (!idx.has(v)) strong(v);
  return out;
};

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// files: { path: sourceText }; areaMap: { areas: [{ name, match: [regex string] }] } (first match wins).
export function measureSeams({ files, areaMap, commit, areaMapSource = null }) {
  const guide = compileGuide(areaMap);
  const paths = Object.keys(files).filter(inScope).sort(byText);
  const known = new Set(paths);
  const fileArea = new Map();
  const unmappedFiles = [];
  for (const p of paths) {
    const a = areaOf(guide, p);
    if (a) fileArea.set(p, a); else unmappedFiles.push(p);
  }

  const parseFailures = [];
  let unresolvedRelativeImports = 0, nonLiteralDynamicImports = 0;
  const edges = new Set(); // "from\0to" distinct file pairs
  for (const p of paths) {
    const ast = parseSource(files[p]);
    if (!ast) { parseFailures.push(p); continue; }
    const { specs, nonLiteral } = extractSpecs(ast);
    nonLiteralDynamicImports += nonLiteral;
    for (const s of specs) {
      if (typeof s !== 'string' || !s.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(p), s));
      if (known.has(target)) edges.add(`${p}\0${target}`); else unresolvedRelativeImports++;
    }
  }

  const stats = new Map();
  const stat = (n) => { if (!stats.has(n)) stats.set(n, { name: n, files: 0, internalImports: 0, entry: new Map() }); return stats.get(n); };
  for (const a of fileArea.values()) stat(a).files++;
  const pairCount = new Map(); // "A\0B" -> count
  const crossingsOf = new Map(); // "A\0B" -> [{from,to}]
  for (const e of [...edges].sort(byText)) {
    const [from, to] = e.split('\0');
    const a = fileArea.get(from), b = fileArea.get(to);
    if (!a || !b) continue;
    if (a === b) { stat(a).internalImports++; continue; }
    const k = `${a}\0${b}`;
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
    if (!crossingsOf.has(k)) crossingsOf.set(k, []);
    crossingsOf.get(k).push({ from, to });
    const ent = stat(b).entry;
    if (!ent.has(to)) ent.set(to, { path: to, areas: new Set(), importers: 0 });
    const rec = ent.get(to);
    rec.areas.add(a); rec.importers++;
  }

  const links = [...pairCount].map(([k, imports]) => { const [from, to] = k.split('\0'); return { from, to, imports }; })
    .sort((x, y) => byText(x.from, y.from) || byText(x.to, y.to));

  const pairs = [];
  for (const l of links) {
    if (l.from >= l.to) continue;
    const back = pairCount.get(`${l.to}\0${l.from}`);
    if (!back) continue;
    pairs.push({
      a: l.from, b: l.to, aToB: l.imports, bToA: back,
      crossings: [...crossingsOf.get(`${l.from}\0${l.to}`), ...crossingsOf.get(`${l.to}\0${l.from}`)],
    });
  }
  const adj = new Map();
  for (const l of links) { if (!adj.has(l.from)) adj.set(l.from, []); adj.get(l.from).push(l.to); }
  const groups = sccs([...stats.keys()].sort(byText), adj).filter((g) => g.length > 1).sort((x, y) => byText(x[0], y[0]));

  const areas = [...stats.values()].sort((x, y) => byText(x.name, y.name)).map((s) => ({
    name: s.name, files: s.files, internalImports: s.internalImports,
    entryFiles: [...s.entry.values()].sort((x, y) => byText(x.path, y.path))
      .map((e) => ({ path: e.path, importedFromAreas: [...e.areas].sort(byText), importers: e.importers })),
  }));

  return {
    commit, areaMapSource,
    scope: { files: paths.length, parseFailures, unresolvedRelativeImports, nonLiteralDynamicImports, unmappedFiles },
    areas, links, knots: { pairs, groups },
  };
}

// --- CLI: reads the tree from the git object store (the kit's readCommit), no checkout ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [repo, commit, guidePath = DEFAULT_GUIDE] = process.argv.slice(2);
  if (!repo || !commit) { console.error('usage: node seams.mjs <repoDir> <commit> [areaGuidePath]'); process.exit(2); }
  const { sha, files } = readCommit(repo, commit, inScope);
  const areaMap = JSON.parse(readFileSync(guidePath, 'utf8'));
  process.stdout.write(JSON.stringify(measureSeams({ files, areaMap, commit: sha, areaMapSource: guidePath }), null, 2) + '\n');
}
