// Shape measure for one commit.  node shape.mjs [commit] [--json] [--top N]
// DEFINITIONS (written down, as the essay asks):
//  - function: every FunctionDeclaration / FunctionExpression / ArrowFunctionExpression (methods
//    included). Decisions are attributed to the INNERMOST enclosing function; nested functions are
//    their own entries. Top-level code is a pseudo-function '<module>'.
//  - decision point (= cyclomatic complexity - 1): IfStatement, ConditionalExpression (?:),
//    ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement,
//    SwitchCase with a test (not `default`), CatchClause, LogicalExpression (&&, ||, ??),
//    AssignmentExpression with &&= ||= ??=.  NOT counted: optional chaining (?.), default
//    parameters, try/finally.  (ESLint's `complexity` rule differs on ?. and default params.)
//  - code line: a line holding at least one token (comments and blank lines excluded); a token
//    spanning lines (template literal) counts every line it spans.
//  - name: declaration id, else variable / property / assignment target, else <anon>@line.
import { resolveCommit, show, parse, walk, productionJs } from './lib.mjs';

const args = process.argv.slice(2);
const commit = resolveCommit(args.find(a => !a.startsWith('--')) || 'HEAD');
const asJson = args.includes('--json');
const topN = Number((args[args.indexOf('--top') + 1]) || 25) || 25;
const only = args.includes('--files') ? args[args.indexOf('--files') + 1].split(',') : null;

const DECISION = new Set(['IfStatement', 'ConditionalExpression', 'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'CatchClause', 'LogicalExpression']);
const isFn = n => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';

export function measureSource(src, file) {
  const tokenLines = new Set();
  const ast = parse(src, undefined, t => { for (let l = t.loc.start.line; l <= t.loc.end.line; l++) tokenLines.add(l); });
  const fns = [{ name: '<module>', file, start: 1, end: src.split('\n').length, dp: 0, node: ast }];
  const nameOf = (n, parent) => {
    if (n.id && n.id.name) return n.id.name;
    if (!parent) return `<anon>@${n.loc.start.line}`;
    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
    if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key)
      return parent.key.name || parent.key.value || `<computed>@${n.loc.start.line}`;
    if (parent.type === 'AssignmentExpression') { const l = parent.left; return l.type === 'MemberExpression' ? (l.property.name || '<member>') : (l.name || '<assign>'); }
    if (parent.type === 'AssignmentPattern' && parent.left.type === 'Identifier') return parent.left.name;
    return `<anon>@${n.loc.start.line}`;
  };
  // pass 1: register every function (acorn-walk's full walk is post-order)
  const byNode = new Map();
  walk.fullAncestor(ast, (n, _st, anc) => {
    if (!isFn(n)) return;
    const parent = anc[anc.length - 2];
    const rec = { name: nameOf(n, parent), file, start: n.loc.start.line, end: n.loc.end.line, dp: 0, node: n };
    fns.push(rec); byNode.set(n, rec);
  });
  // pass 2: attribute each decision to its innermost enclosing function
  walk.fullAncestor(ast, (n, _st, anc) => {
    if (isFn(n)) return;
    let counts = DECISION.has(n.type) ? 1 : 0;
    if (n.type === 'SwitchCase' && n.test) counts = 1;
    if (n.type === 'AssignmentExpression' && ['&&=', '||=', '??='].includes(n.operator)) counts = 1;
    if (!counts) return;
    let owner = null;
    for (let i = anc.length - 2; i >= 0; i--) if (isFn(anc[i])) { owner = anc[i]; break; }
    const rec = owner ? byNode.get(owner) : fns[0];
    rec.dp += counts;
  });
  // code lines per function: lines in its span minus lines owned by nested functions
  const fnList = fns.slice(1).sort((a, b) => a.node.start - b.node.start);
  for (const f of fns) {
    const own = new Set();
    for (let l = f.start; l <= f.end; l++) if (tokenLines.has(l)) own.add(l);
    f.spanLines = own.size;
    delete f.node;
  }
  return { file, codeLines: tokenLines.size, functions: fns, fnCount: fnList.length };
}

const files = only || productionJs(commit);
const results = files.map(f => measureSource(show(commit, f), f));
const all = results.flatMap(r => r.functions.map(fn => ({ ...fn })));
const real = all.filter(f => f.name !== '<module>');
const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
const perFile = results.map(r => {
  const fs = r.functions.filter(f => f.name !== '<module>');
  const worst = fs.reduce((w, f) => (f.dp > (w ? w.dp : -1) ? f : w), null);
  return { file: r.file, codeLines: r.codeLines, functions: fs.length, totalDp: sum(r.functions, 'dp'), over10: fs.filter(f => f.dp > 10).length,
    over50: fs.filter(f => f.dp >= 50).length, worst: worst ? `${worst.name}@${worst.start} (${worst.dp})` : '-', worstDp: worst ? worst.dp : 0, moduleDp: r.functions[0].dp };
}).sort((a, b) => b.worstDp - a.worstDp);
const totals = { commit, files: results.length, codeLines: sum(results, 'codeLines'), functions: real.length, decisionPoints: sum(all, 'dp'),
  over10: real.filter(f => f.dp > 10).length, over50: real.filter(f => f.dp >= 50).length };
if (asJson) { console.log(JSON.stringify({ totals, perFile, functions: real.sort((a, b) => b.dp - a.dp) }, null, 2)); process.exit(0); }

console.log(`commit ${commit}`);
console.log(`production files ${totals.files}, code lines ${totals.codeLines}, functions ${totals.functions}, decision points ${totals.decisionPoints}, functions >10: ${totals.over10}, functions >=50: ${totals.over50}`);
console.log('\nPer file (sorted by worst function):');
console.log('file'.padEnd(28) + 'code'.padStart(6) + 'fns'.padStart(5) + 'DP'.padStart(6) + '>10'.padStart(5) + '>=50'.padStart(5) + '  worst function (DP)');
for (const p of perFile) console.log(p.file.padEnd(28) + String(p.codeLines).padStart(6) + String(p.functions).padStart(5) + String(p.totalDp).padStart(6) + String(p.over10).padStart(5) + String(p.over50).padStart(5) + '  ' + p.worst);
console.log(`\nTop ${topN} functions by decision points:`);
for (const f of real.sort((a, b) => b.dp - a.dp).slice(0, topN)) console.log(`  ${String(f.dp).padStart(4)}  ${f.file}:${f.start}-${f.end}  ${f.name}  (${f.spanLines} code lines incl. nested)`);
