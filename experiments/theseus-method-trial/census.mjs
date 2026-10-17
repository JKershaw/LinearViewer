// Rough census of decisions held in several places, at one commit.
//   node census.mjs [commit] [--json] [--top N] [--detector name]
// Production files only. Six parser-based detectors (acorn), each grouping SITES into candidate
// decisions; a group is reported only when it spans >= 2 files.
//   cmp     single comparisons of a subject against a string literal: `x.phase === 'EXECUTING'`,
//           `case 'opencode':`  — keyed by (subject's last name, literal); typeof checks dropped.
//   lit     the same literal compared anywhere, whatever the subject (coarser view of cmp).
//   set     a set of >= 2 string literals restated: array literal, new Set([...]), or an
//           || / && chain of comparisons of ONE subject against literals. Keyed by sorted values.
//   const   numeric constants >= 1000 (after folding literal arithmetic like 30*60*1000) bound to
//           a name / property / default / fallback, and regex literals; keyed by value.
//   record  object literals with >= 4 plain keys built with the same key set.
//   clone   functions (>= 40 AST nodes) and if-statements (>= 30 nodes) whose shape is identical
//           with identifiers and literal values renamed (type-2 clones).
//   marker  text formats two files must agree on: `[word]` feedback prefixes and sentinel words
//           (DONE / FAILED / BLOCKED / PENDING-*) in strings, templates and regexes.
// Ranking: places (files) x change (sum over those files of 90-day non-merge commits ending at the
// commit's own date). The union of distinct commits is also printed.
import { createHash } from 'node:crypto';
import { resolveCommit, show, parse, walk, productionJs, churn } from './lib.mjs';

const args = process.argv.slice(2);
const commit = resolveCommit(args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) || 'HEAD');
const asJson = args.includes('--json');
const topN = Number(args[args.indexOf('--top') + 1]) || 15;
const onlyDet = args.includes('--detector') ? args[args.indexOf('--detector') + 1] : null;

const files = productionJs(commit);
const { perFile: churnPerFile, commitsByFile, since } = churn(commit);
const groups = new Map(); // det|key -> { det, key, sites: [] }
const add = (det, key, file, line, snippet) => {
  const k = det + '|' + key; if (!groups.has(k)) groups.set(k, { det, key, sites: [] });
  groups.get(k).sites.push({ file, line, snippet: (snippet || '').replace(/\s+/g, ' ').slice(0, 110) });
};

const lastName = n => {
  if (!n) return '?';
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'MemberExpression') return n.computed ? (n.property.type === 'Literal' ? String(n.property.value) : '[]') : n.property.name;
  if (n.type === 'ChainExpression') return lastName(n.expression);
  if (n.type === 'CallExpression') return lastName(n.callee) + '()';
  if (n.type === 'LogicalExpression') return lastName(n.left);
  return n.type;
};
const isStr = n => n && n.type === 'Literal' && typeof n.value === 'string';
const fold = n => { // constant-fold numeric literal arithmetic
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'number') return n.value;
  if (n.type === 'BinaryExpression' && ['*', '+', '-', '/'].includes(n.operator)) {
    const a = fold(n.left), b = fold(n.right); if (a == null || b == null) return null;
    return n.operator === '*' ? a * b : n.operator === '+' ? a + b : n.operator === '-' ? a - b : a / b;
  }
  return null;
};
const MARKER_RE = /\[(done|failed|blocked|pending|cancelled|dispatcher|ended[^\]]*|recap[^\]]*|follow-up|heartbeat|usage|decision|withdraw[^\]]*|resumed|stalled|aborted|hold[^\]]*)\]|\b(DONE|FAILED|BLOCKED|PENDING-EXTERNAL|PENDING-INTERNAL|PENDING|AWAITING_[A-Z]+)\b(:?)/g;

function shapeHash(node) {
  const parts = [];
  walk.full(node, n => {
    let t = n.type;
    if (n.operator) t += n.operator;
    if (n.type === 'Literal') t += typeof n.value;
    parts.push(t);
  });
  return { hash: createHash('sha1').update(parts.join(',')).digest('hex').slice(0, 12), size: parts.length };
}

for (const f of files) {
  const src = show(commit, f);
  const ast = parse(src);
  const lines = src.split('\n');
  const snip = n => lines[n.loc.start.line - 1].trim();
  walk.fullAncestor(ast, (n, _s, anc) => {
    // cmp / lit
    if (n.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(n.operator)) {
      const [lit, subj] = isStr(n.right) ? [n.right, n.left] : isStr(n.left) ? [n.left, n.right] : [null, null];
      if (lit && !(subj.type === 'UnaryExpression' && subj.operator === 'typeof')) {
        add('cmp', `${lastName(subj)} == '${lit.value}'`, f, n.loc.start.line, snip(n));
        add('lit', `'${lit.value}'`, f, n.loc.start.line, snip(n));
      }
    }
    if (n.type === 'SwitchStatement') for (const c of n.cases) if (isStr(c.test)) {
      add('cmp', `${lastName(n.discriminant)} == '${c.test.value}'`, f, c.loc.start.line, `case '${c.test.value}' (switch ${lastName(n.discriminant)})`);
      add('lit', `'${c.test.value}'`, f, c.loc.start.line, `case '${c.test.value}'`);
    }
    // set: array literal / new Set
    if (n.type === 'ArrayExpression' && n.elements.length >= 2 && n.elements.every(isStr)) {
      const parent = anc[anc.length - 2];
      if (!(parent && parent.type === 'CallExpression' && parent.callee.name === 'require'))
        add('set', '{' + [...new Set(n.elements.map(e => e.value))].sort().join(', ') + '}', f, n.loc.start.line, snip(n));
    }
    // set: || / && chain of one subject vs literals (only the outermost chain node)
    if (n.type === 'LogicalExpression') {
      const parent = anc[anc.length - 2];
      if (!(parent && parent.type === 'LogicalExpression' && parent.operator === n.operator)) {
        const leaves = []; const collect = x => { if (x.type === 'LogicalExpression' && x.operator === n.operator) { collect(x.left); collect(x.right); } else leaves.push(x); };
        collect(n);
        const cmps = leaves.map(l => (l.type === 'BinaryExpression' && ['===', '!=='].includes(l.operator) && (isStr(l.right) || isStr(l.left)))
          ? { subj: lastName(isStr(l.right) ? l.left : l.right), v: (isStr(l.right) ? l.right : l.left).value } : null).filter(Boolean);
        const bySubj = new Map(); for (const c of cmps) { if (!bySubj.has(c.subj)) bySubj.set(c.subj, new Set()); bySubj.get(c.subj).add(c.v); }
        for (const [s, vs] of bySubj) if (vs.size >= 2) add('set', '{' + [...vs].sort().join(', ') + '}', f, n.loc.start.line, `${s}: ` + snip(n));
      }
    }
    // const: named numeric constants >= 1000 and regex literals
    const parent = anc[anc.length - 2];
    if ((n.type === 'Literal' && typeof n.value === 'number') || n.type === 'BinaryExpression') {
      const v = fold(n);
      const bound = parent && (parent.type === 'VariableDeclarator' || parent.type === 'Property' || parent.type === 'AssignmentPattern' ||
        (parent.type === 'LogicalExpression' && parent.right === n) || (parent.type === 'CallExpression' && parent.callee && /parse(Int|Float)|Number|envInt|envMs|intEnv/.test(lastName(parent.callee))));
      const parentFolds = parent && parent.type === 'BinaryExpression' && fold(parent) != null;
      if (v != null && v >= 1000 && bound && !parentFolds) add('const', String(v), f, n.loc.start.line, snip(n));
    }
    if (n.type === 'Literal' && n.regex) add('const', `/${n.regex.pattern}/${n.regex.flags}`, f, n.loc.start.line, snip(n));
    // record: same key set
    if (n.type === 'ObjectExpression') {
      const keys = n.properties.filter(p => p.type === 'Property' && !p.computed).map(p => p.key.name || p.key.value);
      if (keys.length >= 4 && keys.length === n.properties.length) add('record', '{' + [...keys].sort().join(', ') + '}', f, n.loc.start.line, snip(n));
    }
    // clone
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      const { hash, size } = shapeHash(n.body); if (size >= 40) add('clone', `fn:${hash} (${size} nodes)`, f, n.loc.start.line, snip(n));
    }
    if (n.type === 'IfStatement' && !(parent && parent.type === 'IfStatement' && parent.alternate === n)) {
      const { hash, size } = shapeHash(n); if (size >= 30) add('clone', `if:${hash} (${size} nodes)`, f, n.loc.start.line, snip(n));
    }
    // marker
    const texts = [];
    if (isStr(n)) texts.push(n.value);
    if (n.type === 'TemplateLiteral') texts.push(...n.quasis.map(q => q.value.cooked || ''));
    if (n.type === 'Literal' && n.regex) texts.push(n.regex.pattern.replace(/\\/g, ''));
    for (const t of texts) for (const m of t.matchAll(MARKER_RE)) {
      const key = m[1] ? `[${m[1].replace(/[\d·:].*$/, '').trim()}]` : `${m[2]}${m[3]}`;
      add('marker', key, f, n.loc.start.line, snip(n));
    }
  });
}

const results = [...groups.values()].map(g => {
  const fileSet = [...new Set(g.sites.map(s => s.file))];
  const change = fileSet.reduce((s, f) => s + (churnPerFile.get(f) || 0), 0);
  const union = new Set(fileSet.flatMap(f => [...(commitsByFile.get(f) || [])])).size;
  return { ...g, places: fileSet.length, files: fileSet, siteCount: g.sites.length, change, union, score: fileSet.length * change };
}).filter(g => g.places >= 2).sort((a, b) => b.score - a.score || b.siteCount - a.siteCount);

if (asJson) { console.log(JSON.stringify({ commit, since, results }, null, 2)); process.exit(0); }
console.log(`commit ${commit}  churn window since ${since}  production files ${files.length}`);
const dets = ['cmp', 'set', 'const', 'record', 'clone', 'marker', 'lit'];
for (const d of dets) {
  if (onlyDet && d !== onlyDet) continue;
  const rs = results.filter(r => r.det === d);
  console.log(`\n== ${d}: ${rs.length} groups spanning >= 2 files; top ${topN} by places x change`);
  for (const r of rs.slice(0, topN)) {
    console.log(`  score ${String(r.score).padStart(4)}  places ${r.places} sites ${String(r.siteCount).padStart(3)}  churn-sum ${r.change} union ${r.union}   ${r.key}`);
    console.log(`        ${r.files.join(', ')}`);
  }
}
