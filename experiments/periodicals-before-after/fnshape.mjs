import { spawnSync } from 'node:child_process';
import { analyse } from '/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad/wt-branch/experiments/rebuild-exp1/kit/lib/shape-core.mjs';
const [repo, commit, ...focus] = process.argv.slice(2);
const git = (args, input) => { const r = spawnSync('git', ['-C', repo, ...args], { input, maxBuffer: 1 << 30 }); if (r.status) throw new Error(r.stderr.toString()); return r.stdout; };
const inScope = (p) => /\.m?js$/.test(p) && !/\.min\.js$/.test(p) && (p === 'server.js' || /^(lib|routes)\//.test(p));
const tree = git(['ls-tree', '-r', commit]).toString().split('\n').filter(Boolean).map((l) => { const [m, path] = l.split('\t'); const [, type, obj] = m.split(' '); return { type, obj, path }; }).filter((e) => e.type === 'blob' && inScope(e.path));
const out = git(['cat-file', '--batch'], tree.map((e) => e.obj).join('\n') + '\n');
let pos = 0; const files = {};
for (const e of tree) { const nl = out.indexOf(10, pos); const size = Number(out.subarray(pos, nl).toString().split(' ')[2]); files[e.path] = out.subarray(nl + 1, nl + 1 + size).toString('utf8'); pos = nl + 1 + size + 1; }
const fails = []; const fns = []; const per = {}; let code = 0, cyc = 0;
for (const [p, src] of Object.entries(files)) {
  let r; try { r = analyse(src); } catch (e) { fails.push(p); continue; }
  code += r.lines.code; cyc += r.cyclomatic.total;
  const f = r.perFunction.filter((u) => u.kind !== 'module');
  for (const u of f) fns.push({ file: p, name: u.name, span: u.spanLines, code: u.codeLines, cyc: u.cyclomatic, nest: u.maxNesting, top: !u.enclosing });
  per[p] = { code: r.lines.code, fns: f.length, longestSpan: r.functions.longestBySpan, maxCyc: r.cyclomatic.max, maxNest: r.maxNesting, cycTotal: r.cyclomatic.total, over10: r.cyclomatic.unitsOver10.length,
    top: f.filter((u) => !u.enclosing).length, topOver100: f.filter((u) => !u.enclosing && u.spanLines >= 100).length };
}
const c = (pred) => fns.filter(pred).length;
const summary = { commit, files: Object.keys(files).length, parseFailures: fails, codeLines: code, functions: fns.length, cyclomaticTotal: cyc,
  fnSpanGE50: c((f) => f.span >= 50), fnSpanGE100: c((f) => f.span >= 100), fnSpanGE200: c((f) => f.span >= 200), fnSpanGE500: c((f) => f.span >= 500),
  topLevelSpanGE100: c((f) => f.top && f.span >= 100), topLevelSpanGE200: c((f) => f.top && f.span >= 200),
  cycOver10: c((f) => f.cyc > 10), cycGE50: c((f) => f.cyc >= 50), cycGE100: c((f) => f.cyc >= 100), nestGE5: c((f) => f.nest >= 5), nestGE7: c((f) => f.nest >= 7),
  longest15: fns.filter((f) => f.top).sort((a, b) => b.span - a.span).slice(0, 15).map((f) => `${f.file}:${f.name} span ${f.span} cyc ${f.cyc} nest ${f.nest}`),
  mostComplex10: [...fns].sort((a, b) => b.cyc - a.cyc).slice(0, 10).map((f) => `${f.file}:${f.name} cyc ${f.cyc} span ${f.span}`),
  focus: Object.fromEntries(focus.map((p) => [p, per[p] ?? null])) };
process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
