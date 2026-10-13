// Measure one git snapshot: function sizes (acorn AST) and copied code (8-line windows).
// Usage: node measure.mjs <repoDir> <sha> <lv|sd>  → JSON on stdout
import { spawnSync } from 'node:child_process';
import { parse } from 'acorn';
import { ancestor, simple } from 'acorn-walk';
import { posix } from 'node:path';

const [repo, sha, kind] = process.argv.slice(2);
const git = (args, input) => {
  const r = spawnSync('git', ['-C', repo, ...args], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

const inScope = (p) => {
  if (!/\.(m?js)$/.test(p) || /\.min\.js$/.test(p)) return false;
  if (kind === 'lv') {
    return p === 'server.js' || /^lib\//.test(p) || /^routes\//.test(p) || /^public\//.test(p);
  }
  return !p.includes('/') && !/^e2e-/.test(p); // SD: top-level modules, minus e2e probes
};

const tree = git(['ls-tree', '-r', sha]).toString().split('\n').filter(Boolean)
  .map((l) => { const [meta, path] = l.split('\t'); const [, type, obj] = meta.split(' '); return { type, obj, path }; })
  .filter((e) => e.type === 'blob' && inScope(e.path));

// Read all blobs in one cat-file --batch call.
const out = git(['cat-file', '--batch'], tree.map((e) => e.obj).join('\n') + '\n');
const files = [];
let pos = 0;
for (const e of tree) {
  const nl = out.indexOf(10, pos);
  const header = out.subarray(pos, nl).toString();
  const size = Number(header.split(' ')[2]);
  const body = out.subarray(nl + 1, nl + 1 + size).toString('utf8');
  pos = nl + 1 + size + 1;
  files.push({ path: e.path, text: body });
}

const nameOf = (node, anc) => {
  if (node.type === 'FunctionDeclaration' && node.id) return node.id.name;
  const parent = anc[anc.length - 2];
  if (!parent) return '(anonymous)';
  const keyName = (k) => (k && (k.name ?? (typeof k.value === 'string' ? k.value : null))) || '(computed)';
  switch (parent.type) {
    case 'VariableDeclarator': return parent.id?.name || '(anonymous)';
    case 'Property': return keyName(parent.key);
    case 'MethodDefinition': {
      const cls = [...anc].reverse().find((a) => a.type === 'ClassDeclaration' || a.type === 'ClassExpression');
      return `${cls?.id?.name ? cls.id.name + '.' : ''}${keyName(parent.key)}`;
    }
    case 'PropertyDefinition': return keyName(parent.key);
    case 'AssignmentExpression': {
      const l = parent.left;
      if (l.type === 'Identifier') return l.name;
      if (l.type === 'MemberExpression') return `${l.object?.name ? l.object.name + '.' : ''}${keyName(l.property)}`;
      return '(anonymous)';
    }
    case 'CallExpression':
    case 'NewExpression': {
      const c = parent.callee;
      const method = c?.type === 'MemberExpression' ? keyName(c.property) : c?.name;
      const first = parent.arguments?.[0];
      if (/^(get|post|put|patch|delete|all|use)$/i.test(method || '') && first?.type === 'Literal' && typeof first.value === 'string') {
        return `${method.toUpperCase()} ${first.value}`;
      }
      return `${method || 'call'}(callback)`;
    }
    case 'ExportDefaultDeclaration': return 'default';
    default: return '(anonymous)';
  }
};

const functions = [];
const parseErrors = [];
let totalLines = 0;
for (const f of files) {
  totalLines += f.text.split('\n').length;
  let ast = null;
  for (const sourceType of ['module', 'script']) {
    try {
      ast = parse(f.text, {
        ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true,
        allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
      });
      break;
    } catch { /* try the next source type */ }
  }
  if (!ast) { parseErrors.push(f.path); continue; }
  const specs = [];
  for (const node of ast.body) {
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) specs.push(node.source.value);
  }
  simple(ast, { ImportExpression(node) { if (node.source && node.source.type === 'Literal') specs.push(node.source.value); } });
  f.imports = [...new Set(specs.filter((x) => typeof x === 'string' && x.startsWith('.')).map((x) => posix.normalize(posix.join(posix.dirname(f.path), x))))];
  const seen = new Map();
  const childLines = new Map(); // function node -> lines held by its directly nested functions
  const records = [];
  const isFn = (n) => /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
  const visit = (node, _state, anc) => {
    const lines = node.loc.end.line - node.loc.start.line + 1;
    const outer = [...anc].slice(0, -1).reverse().find(isFn);
    if (outer) childLines.set(outer, (childLines.get(outer) || 0) + lines);
    if (lines < 60) return;
    let name = nameOf(node, anc);
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} #${n}`;
    // Containers hold many handlers rather than being one unit: file-wrapper IIFEs,
    // top-level callback wrappers and create…Routes factories.
    const parent = anc[anc.length - 2];
    const iife = parent && parent.type === 'CallExpression' && parent.callee === node;
    const topLevelCallback = !outer && / ?\(callback\)$/.test(name);
    const container = iife || topLevelCallback || /^create\w*Routes$/.test(name);
    records.push({ node, rec: { file: f.path, name, start: node.loc.start.line, lines, container } });
  };
  ancestor(ast, { FunctionDeclaration: visit, FunctionExpression: visit, ArrowFunctionExpression: visit });
  for (const { node, rec } of records) {
    rec.nestedShare = Math.round(100 * Math.min(1, (childLines.get(node) || 0) / rec.lines)) / 100;
    functions.push(rec);
  }
}

// Copied code: normalised 8-line windows that occur more than once.
const W = 8;
const norm = files.map((f) => f.text.split('\n')
  .map((l) => l.trim().replace(/\s+/g, ' '))
  .filter((l) => l && !/^(\/\/|\/\*|\*)/.test(l) && /[A-Za-z0-9]/.test(l)));
const occ = new Map();
norm.forEach((lines, fi) => {
  for (let i = 0; i + W <= lines.length; i++) {
    const key = lines.slice(i, i + W).join('\n');
    const list = occ.get(key);
    if (list) list.push([fi, i]); else occ.set(key, [[fi, i]]);
  }
});
const marked = norm.map((l) => new Uint8Array(l.length));
const pairShared = new Map();
for (const list of occ.values()) {
  if (list.length < 2) continue;
  for (const [fi, i] of list) for (let k = i; k < i + W; k++) marked[fi][k] = 1;
  const fis = [...new Set(list.map(([fi]) => fi))].sort((a, b) => a - b);
  for (let a = 0; a < fis.length; a++) for (let b = a + 1; b < fis.length; b++) {
    const key = `${fis[a]}|${fis[b]}`;
    pairShared.set(key, (pairShared.get(key) || 0) + 1);
  }
}
const normLines = norm.reduce((s, l) => s + l.length, 0);
const dupLines = marked.reduce((s, m) => s + m.reduce((a, b) => a + b, 0), 0);
const pairs = [...pairShared.values()].filter((v) => v >= 5).length;

const big = (min) => functions.filter((f) => f.lines >= min && !f.container);
const known = new Set(files.map((f) => f.path));
const perFile = files.map((f, fi) => {
  const giants = functions.filter((g) => g.file === f.path && g.lines >= 200 && !g.container);
  return {
    path: f.path, lines: f.text.split('\n').length, normLines: norm[fi].length,
    dupLines: marked[fi].reduce((a, b) => a + b, 0), giants: giants.length,
    giantLines: giants.reduce((a, g) => a + g.lines, 0),
    imports: (f.imports || []).filter((p) => known.has(p)),
  };
});
process.stdout.write(JSON.stringify({
  sha, kind, files: files.length, totalLines, parseErrors,
  fn200: big(200).length, fn400: big(400).length,
  linesIn200: big(200).reduce((s, f) => s + f.lines, 0),
  normLines, dupLines, dupPairs: pairs,
  functions: functions.filter((f) => f.lines >= 150), perFile,
}));
