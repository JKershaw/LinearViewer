// Same measure as S/verbatim/verbatim.mjs, LIN-3591 only (that script has no single-ticket mode).
import { execFileSync } from 'node:child_process';
const git = (...a) => execFileSync('git', ['-C', '/home/user/LinearViewer', ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const stripImports = (src) => src.replace(/^[ \t]*import\b[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '').replace(/^[ \t]*import\s*['"][^'"\n]+['"][ \t]*;?/gm, '').replace(/^[ \t]*export\s*(\*|\{)[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '');
const TRIVIAL = /^[{}\[\]();,\s]*$/;
const nt = (src) => stripImports(src).split('\n').map(l => l.trim()).filter(l => l && !TRIVIAL.test(l) && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
const sha = '91fca7dd', parent = git('rev-parse', `${sha}^1`).trim().slice(0, 8);
const oldL = nt(git('show', `${parent}:lib/kpi-stats.js`)), newL = nt(git('show', `${sha}:lib/kpi-stats.js`));
const pool = new Map(); for (const l of oldL) pool.set(l, (pool.get(l) || 0) + 1);
let matched = 0, run = 0, start = 0, longest = 0, at = 0, runs = []; 
newL.forEach((l, i) => { const c = pool.get(l) || 0; if (c > 0) { pool.set(l, c - 1); matched++; if (!run) start = i + 1; run++; if (run > longest) { longest = run; at = start; } } else { if (run >= 5) runs.push([start, run]); run = 0; } });
const added = git('show', '--format=', '--diff-filter=A', '--name-only', sha).trim().split('\n').filter(p => p && /\.m?js$/.test(p) && !p.startsWith('tests/'));
console.log(JSON.stringify({ parent, sha, addedNonTest: added, newNt: newL.length, oldNt: oldL.length, matched, newPct: (100 * matched / newL.length).toFixed(1), oldPct: (100 * matched / oldL.length).toFixed(1), longest, at, runsGE5: runs }));
console.log('--- longest run:'); console.log(newL.slice(at - 1, at - 1 + longest).join('\n'));
