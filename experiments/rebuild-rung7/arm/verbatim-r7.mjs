// Verbatim share for rung 7, definitions as S/verbatim/verbatim.mjs plus variants.
import { readFileSync, writeFileSync } from 'node:fs';
const [oldF, newRouter, newHelper, outF] = process.argv.slice(2);
function stripImports(src) {
  return src
    .replace(/^[ \t]*import\b[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '')
    .replace(/^[ \t]*import\s*['"][^'"\n]+['"][ \t]*;?/gm, '')
    .replace(/^[ \t]*export\s*(\*|\{)[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '');
}
const TRIVIAL = /^[{}\[\]();,\s]*$/;
function nt(src, { imports = false, semi = false } = {}) {
  let s = imports ? src : stripImports(src);
  return s.split('\n').map(l => l.trim())
    .filter(l => l && !TRIVIAL.test(l) && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .map(l => semi ? l.replace(/;$/, '') : l);
}
function measure(oldLines, newFiles) {
  const pool = new Map(); for (const l of oldLines) pool.set(l, (pool.get(l) || 0) + 1);
  const set = new Set(oldLines);
  let total = 0, multi = 0, member = 0, longest = 0, longestAt = '', in10 = 0;
  const runs = [];
  for (const [name, lines] of newFiles) {
    let run = 0, start = 0, mrun = 0;
    const flags = lines.map(l => set.has(l));
    lines.forEach((l, i) => {
      total++;
      if (flags[i]) member++;
      const c = pool.get(l) || 0;
      if (c > 0) { pool.set(l, c - 1); multi++; if (run === 0) start = i + 1; run++; if (run > longest) { longest = run; longestAt = `${name} nt-line ${start}`; } } else run = 0;
    });
    // runs of 10+ consecutive membership-matched lines
    let r = 0; for (let i = 0; i <= flags.length; i++) { if (i < flags.length && flags[i]) r++; else { if (r >= 10) { in10 += r; runs.push([name, i - r + 1, r]); } r = 0; } }
  }
  const pct = (a) => (100 * a / total).toFixed(1) + '%';
  return { total, oldTotal: oldLines.length, multiset: multi, multisetPct: pct(multi), membership: member, membershipPct: pct(member), longestMultisetRun: longest, longestAt, linesInRuns10: in10, runs10: runs.length, top5Runs: runs.sort((a, b) => b[2] - a[2]).slice(0, 5) };
}
const O = readFileSync(oldF, 'utf8'), R = readFileSync(newRouter, 'utf8'), H = readFileSync(newHelper, 'utf8');
const out = {};
for (const [label, opt] of [['canonical (imports stripped, as S/verbatim)', {}], ['imports kept', { imports: true }], ['imports stripped, trailing ; ignored', { semi: true }]]) {
  out[label] = {
    routerPlusHelper: measure(nt(O, opt), [['routes/workspace-api.js', nt(R, opt)], ['lib/workspace-api-mocks.js', nt(H, opt)]]),
    routerAlone: measure(nt(O, opt), [['routes/workspace-api.js', nt(R, opt)]]),
  };
}
// semicolon census
const semiOld = O.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
out.semicolonCensus = { oldLinesEndingSemicolon: semiOld.filter(l => l.endsWith(';')).length, oldNonCommentLines: semiOld.length };
writeFileSync(outF, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
