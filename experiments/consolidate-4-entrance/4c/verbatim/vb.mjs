// The verbatim share by experiments/verbatim/verbatim.mjs's rule (trimmed non-trivial lines; blanks,
// bracket-only lines, comments and imports excluded; multiset match), for any OLD sha, NEW sha and
// file sets, raw and with trailing semicolons normalised (a line's one trailing `;` dropped on both
// sides before matching). Read-only: git show.
//   node vb.mjs <repo> <oldSha> <newSha> --old f1,f2 --new f1,f2[,helper]
import { execFileSync } from 'node:child_process';
const [repo, oldSha, newSha] = process.argv.slice(2);
const list = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1].split(',') : []; };
const show = (sha, p) => { try { return execFileSync('git', ['-C', repo, 'show', `${sha}:${p}`], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return ''; } };
function stripImports(src) {
  return src
    .replace(/^[ \t]*import\b[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '')
    .replace(/^[ \t]*import\s*['"][^'"\n]+['"][ \t]*;?/gm, '')
    .replace(/^[ \t]*export\s*(\*|\{)[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '');
}
const TRIVIAL = /^[{}\[\]();,\s]*$/;
const nt = (src) => stripImports(src).split('\n').map((l) => l.trim())
  .filter((l) => l && !TRIVIAL.test(l) && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
function share(norm) {
  const f = norm ? (l) => l.replace(/;$/, '') : (l) => l;
  const pool = new Map();
  let oldTotal = 0;
  for (const p of list('--old')) for (const l of nt(show(oldSha, p))) { pool.set(f(l), (pool.get(f(l)) || 0) + 1); oldTotal++; }
  let n = 0, m = 0, run = 0, longest = 0;
  for (const p of list('--new')) for (const l0 of nt(show(newSha, p))) { const l = f(l0); n++; const c = pool.get(l) || 0; if (c > 0) { pool.set(l, c - 1); m++; run++; longest = Math.max(longest, run); } else run = 0; }
  return { newLines: n, oldLines: oldTotal, matched: m, pct: (100 * m / n).toFixed(1) + '%', longestRun: longest };
}
console.log(JSON.stringify({ old: oldSha, new: newSha, raw: share(false), semicolonsNormalised: share(true) }));
