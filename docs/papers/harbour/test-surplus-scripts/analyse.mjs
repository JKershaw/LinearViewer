// Smallest sufficient set: greedy set cover of killing test files on one mutant sample, checked on another.
// Usage: node analyse.mjs <select.json[#sample][,more]> <check.json[#sample][,more]> [--level file|test] [--json out.json]
// Committed layout: node analyse.mjs ../test-surplus-mutants.json#A ../test-surplus-mutants.json#B   (COV defaults to ../test-surplus-coverage.json)
// At --level test a killing file counts only its deepest-depth failing tests (the `::depth::` field of a killTests entry), so a
// describe block's own failure does not count beside the test inside it.
import { readFileSync, writeFileSync } from 'fs';

// A killed mutant whose kills all failed to confirm is re-labelled survived.
const here = (p) => new URL(p, import.meta.url);
const confirmed = (m) => m.confirmedFiles || m.killers || m.killFiles;
// `file#A` reads samples.A of the committed layout; a bare file is a flat object or array of mutants.
const load = (ps) => ps.split(',').flatMap((spec) => {
  const [p, sample] = spec.split('#');
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return Object.values(sample ? j.samples[sample] : (j.samples || j));
}).map((m) => (m.outcome === 'killed' && confirmed(m) && !confirmed(m).length ? { ...m, outcome: 'survived' } : m));
const level = process.argv.includes('--level') ? process.argv[process.argv.indexOf('--level') + 1] : 'file';
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const TOTAL_FILES = 804;
// Confirmed kills only (a file that failed again on a second run with the mutant applied); tests are the confirmed failing tests.
const deepest = (tests) => {
  const byFile = new Map();
  for (const t of tests) { const [f, d] = t.split('::'); const b = byFile.get(f) || { d: -1, ts: [] }; if (+d > b.d) { b.d = +d; b.ts = []; } if (+d === b.d) b.ts.push(t); byFile.set(f, b); }
  return [...byFile.values()].flatMap((b) => b.ts);
};
const killers = (m) => (level === 'file' ? confirmed(m) : [...new Set(deepest(m.confirmedTests || m.killTests))]);

function summarise(name, ms) {
  const k = ms.filter((m) => m.outcome === 'killed'), s = ms.filter((m) => m.outcome === 'survived');
  const other = ms.length - k.length - s.length;
  const byKind = {};
  for (const m of ms) { const b = byKind[m.kind] || (byKind[m.kind] = { killed: 0, survived: 0 }); if (m.outcome in b) b[m.outcome]++; }
  const red = k.map((m) => killers(m).length).sort((a, b) => a - b);
  const q = (p) => red[Math.min(red.length - 1, Math.floor(p * red.length))];
  console.log(`${name}: ${ms.length} mutants, ${k.length} killed, ${s.length} survived, ${other} excluded (syntax/not applied); by kind ${JSON.stringify(byKind)}`);
  console.log(`  killers per killed mutant (${level}): min ${red[0]} median ${q(0.5)} p90 ${q(0.9)} max ${red[red.length - 1]}; killed by exactly one: ${red.filter((x) => x === 1).length}`);
  return k;
}

function cover(killed) {
  const left = new Set(killed.map((m) => m.id));
  const by = new Map();
  for (const m of killed) for (const f of killers(m)) { if (!by.has(f)) by.set(f, new Set()); by.get(f).add(m.id); }
  const chosen = [];
  while (left.size) {
    let best = null, bg = 0;
    for (const [f, s] of by) { let g = 0; for (const id of s) if (left.has(id)) g++; if (g > bg || (g === bg && g > 0 && f < best)) { bg = g; best = f; } }
    chosen.push(best); for (const id of by.get(best)) left.delete(id);
  }
  // Prune: drop any chosen file whose mutants are all still covered by the rest.
  for (let i = chosen.length - 1; i >= 0; i--) {
    const rest = new Set(chosen.filter((_, j) => j !== i));
    if (killed.every((m) => killers(m).some((f) => rest.has(f)))) chosen.splice(i, 1);
  }
  return chosen;
}

const sel = summarise('select', load(process.argv[2]));
const chk = summarise('check', load(process.argv[3]));
const S = cover(sel);
const Sset = new Set(S);
const missed = chk.filter((m) => !killers(m).some((f) => Sset.has(f)));
console.log(`\nset chosen on select: ${S.length} ${level}s (${level === 'file' ? ((100 * S.length) / TOTAL_FILES).toFixed(1) + '% of ' + TOTAL_FILES + ' files' : ''})`);
console.log(`check: kept set kills ${chk.length - missed.length}/${chk.length} of what the whole suite kills (${((100 * (chk.length - missed.length)) / chk.length).toFixed(1)}%)`);
for (const m of missed) console.log(`  MISSED ${m.id} ${m.kind} ${m.file}:${m.line} [${m.before.slice(0, 70)}] killers=${killers(m).join(' ')}`);

// Holdout protection as a function of how many files are kept, in greedy order on select.
const order = [];
{ const left = new Set(sel.map((m) => m.id)); const by = new Map();
  for (const m of sel) for (const f of killers(m)) { if (!by.has(f)) by.set(f, new Set()); by.get(f).add(m.id); }
  while (left.size) { let best = null, bg = 0; for (const [f, s] of by) { let g = 0; for (const id of s) if (left.has(id)) g++; if (g > bg) { bg = g; best = f; } } order.push(best); for (const id of by.get(best)) left.delete(id); } }
const curve = [];
for (const k of [1, 5, 10, 20, 40, 60, 80, 100, 120, 160, 200, order.length]) {
  if (k > order.length) continue;
  const keep = new Set(order.slice(0, k));
  const sk = sel.filter((m) => killers(m).some((f) => keep.has(f))).length;
  const ck = chk.filter((m) => killers(m).some((f) => keep.has(f))).length;
  curve.push({ k, selPct: +(100 * sk / sel.length).toFixed(1), chkPct: +(100 * ck / chk.length).toFixed(1) });
}
console.log('\nkept (greedy order) → % of select kills, % of check kills'); for (const c of curve) console.log(`  ${c.k}\t${c.selPct}\t${c.chkPct}`);

// Files that are ever a sole killer, in each sample, and their overlap (Chapman estimate of files that are the sole killer of some fault).
const sole = (ks) => new Set(ks.filter((m) => killers(m).length === 1).map((m) => killers(m)[0]));
const a = sole(sel), b = sole(chk); const both = [...a].filter((f) => b.has(f)).length;
console.log(`\nsole killers: select ${a.size}, check ${b.size}, both ${both}; Chapman estimate ${((a.size + 1) * (b.size + 1) / (both + 1) - 1).toFixed(1)}`);
const allKillers = new Set([...sel, ...chk].flatMap(killers));
console.log(`distinct ${level}s that kill anything across both samples: ${allKillers.size}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ level, set: S, missed: missed.map((m) => m.id), curve, soleSelect: [...a], soleCheck: [...b], order }, null, 1));

// Saturation: greedy+pruned set size on random subsamples of the pooled killed mutants (mean of 20 draws per size).
{
  const pool = [...sel, ...chk];
  let st = 3551; const rnd = () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const sat = [];
  for (const n of [25, 50, 100, 150, 200, 250, 300, pool.length]) {
    if (n > pool.length) continue;
    const sizes = Array.from({ length: n === pool.length ? 1 : 20 }, () => cover(shuffle(pool).slice(0, n)).length);
    sat.push({ n, files: +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1) });
  }
  console.log('\nsaturation (killed mutants → files in greedy+pruned cover):', sat.map((s) => `${s.n}:${s.files}`).join('  '));
  const S2 = cover(pool);
  const allFiles = [...new Set(pool.flatMap(killers))];
  const testFiles = JSON.parse(readFileSync(process.env.COV || here('../test-surplus-coverage.json'), 'utf8'));
  const universe = Object.keys(testFiles.files || testFiles);
  const trials = Array.from({ length: 200 }, () => { const keep = new Set(shuffle(universe).slice(0, S2.length)); return pool.filter((m) => killers(m).some((f) => keep.has(f))).length / pool.length; }).sort((a, b) => a - b);
  console.log(`pooled cover: ${S2.length} ${level}s; a random ${S2.length}-file set kills ${(100 * trials[100]).toFixed(1)}% median (5th-95th ${(100 * trials[10]).toFixed(1)}-${(100 * trials[190]).toFixed(1)}%) of the pooled kills; distinct killers ${allFiles.length}`);
  if (jsonOut) { const j = JSON.parse(readFileSync(jsonOut, 'utf8')); j.saturation = sat; j.pooledSet = S2; writeFileSync(jsonOut, JSON.stringify(j, null, 1)); }
}
