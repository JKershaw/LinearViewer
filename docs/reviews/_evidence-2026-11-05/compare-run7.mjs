// Comparison for LIN-4249 (seams & tangles run 7), beat 1. Reads only the evidence JSON in this folder,
// plus the tool's own compileGuide / readCommit(inScope) over committed git objects (for catch-all membership
// and file-level placement of the new files, which seams.mjs does not list).
// usage (repo root): node docs/reviews/_evidence-2026-11-05/compare-run7.mjs . docs/reviews/_evidence-2026-11-05 > .../compare-run7.md
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const [repoArg, evArg] = process.argv.slice(2);
const repo = resolve(repoArg); const ev = resolve(evArg);
const lib = await import(join(repo, 'scripts/code-shape/code-shape-lib.mjs'));
const { inScope } = await import(join(repo, 'scripts/code-shape/seams.mjs'));

const FULL = { B: 'd7ceb373444f9efbc027656132352d247535aa5e', H: '2eb73ae07fb7297fc0fa057a6198aa8cbe901558' };
const S8 = { B: 'd7ceb373', H: '2eb73ae0' };
const G = 'head-2eb73ae0';
const J = (f) => JSON.parse(readFileSync(join(ev, f), 'utf8'));
const OTHER = 'Other features', LLM = 'LLM & prompts', RUNS = 'Runs & dispatch';
const short = (n) => n.replace(/ \(.*\)$/, '').replace('Front end: ', '').replace(', accounts & workspaces', '').replace(' & operator tools', '').replace(' & plumbing', '').replace(' & dispatch', '').replace(' & prompts', '').replace(' (pages & workspace API)', '');
const guide = lib.compileGuide(J(`areas.${G}.json`));
const areaOf = (p) => guide.find((a) => a.rx.some((r) => r.test(p)))?.name ?? 'UNMAPPED';

const data = {};
for (const c of ['B', 'H']) {
  const s = J(`seams-code-${S8[c]}-guide-${G}.json`);
  const e = J(`edges-code-${S8[c]}-guide-${G}.json`);
  const cc = J(`cochange-code-${S8[c]}-guide-${G}-days60.json`);
  const { files } = lib.readCommit(repo, FULL[c], inScope);
  const members = {};
  for (const p of Object.keys(files).sort()) (members[areaOf(p)] ||= []).push(p);
  const directed = {}; for (const l of s.links) directed[`${l.from} → ${l.to}`] = l.imports;
  data[c] = { s, e, cc, members, directed, files: new Set(Object.keys(files)) };
}
const B = data.B, H = data.H;
const out = []; const p = (...a) => out.push(a.join(''));
const pairKey = (q) => [q.a, q.b].sort().join(' ↔ ');

p('# Run 7 beat 1 comparison (from evidence JSON; one guide, blob 642e9405, for both commits)\n');
p(`Baseline \`${FULL.B}\` (run 6's measured commit) → measured \`${FULL.H}\` (origin/main).\n`);

p('## Scope and tool limits (seams.scope)');
p('| commit | files | parseFailures | nonLiteralDynamicImports | unmappedFiles | unresolvedRelativeImports |'); p('|---|---|---|---|---|---|');
for (const c of ['B', 'H']) { const sc = data[c].s.scope; p(`| ${S8[c]} | ${sc.files} | ${sc.parseFailures.length} | ${sc.nonLiteralDynamicImports} | ${sc.unmappedFiles.length} | ${sc.unresolvedRelativeImports} |`); }

p('\n## Headline');
p('| commit | cross-area links (sum) | link rows | knot pairs | groups (sizes) | Other files | F1 LLM→Runs / Runs→LLM | lib→routes edges | edge-dump cross-area (witness) |'); p('|---|---|---|---|---|---|---|---|---|');
for (const c of ['B', 'H']) {
  const d = data[c]; const tot = d.s.links.reduce((a, l) => a + l.imports, 0);
  const f1 = d.s.knots.pairs.find((q) => [q.a, q.b].includes(LLM) && [q.a, q.b].includes(RUNS));
  const f1s = f1 ? (f1.a === LLM ? `${f1.aToB}/${f1.bToA}` : `${f1.bToA}/${f1.aToB}`) : 'not a knot';
  const oth = d.s.areas.find((a) => a.name === OTHER)?.files ?? 0;
  const l2r = d.e.edgeList.filter((x) => x.from.startsWith('lib/') && x.to.startsWith('routes/')).length;
  p(`| ${S8[c]} | ${tot} | ${d.s.links.length} | ${d.s.knots.pairs.length} | ${d.s.knots.groups.map((g) => g.length).join(',')} | ${oth} | ${f1s} | ${l2r} | ${d.e.crossAreaEdges} |`);
}

p('\n## Knot pairs (a→b / b→a)');
const allPairs = new Set(); for (const c of ['B', 'H']) for (const q of data[c].s.knots.pairs) allPairs.add(pairKey(q));
p(`| pair | ${S8.B} | ${S8.H} |`); p('|---|---|---|');
for (const k of [...allPairs].sort()) {
  const [a, b] = k.split(' ↔ ');
  p(`| ${short(a)} ↔ ${short(b)} | ${['B', 'H'].map((c) => { const d = data[c].directed; const isKnot = data[c].s.knots.pairs.some((q) => pairKey(q) === k); return `${d[`${a} → ${b}`] ?? 0}/${d[`${b} → ${a}`] ?? 0}${isKnot ? '' : ' (no knot)'}`; }).join(' | ')} |`);
}
p('\nKnot groups:');
for (const c of ['B', 'H']) p(`- ${S8[c]}: ${data[c].s.knots.groups.map((g) => `[${g.map(short).join(', ')}]`).join(' ')}`);

p('\n## Directed area links that differ');
const keys = new Set([...Object.keys(B.directed), ...Object.keys(H.directed)]);
p('| link | d7ceb373 | 2eb73ae0 | Δ |'); p('|---|---|---|---|');
for (const k of [...keys].sort()) { const a = B.directed[k] ?? 0, b = H.directed[k] ?? 0; if (a !== b) p(`| ${k.split(' → ').map(short).join(' → ')} | ${a} | ${b} | ${b - a > 0 ? '+' : ''}${b - a} |`); }

p('\n## Catch-all ("Other features") members');
for (const c of ['B', 'H']) { const m = data[c].members[OTHER] || []; p(`- ${S8[c]} (${m.length}; seams says ${data[c].s.areas.find((a) => a.name === OTHER)?.files}): ${m.map((f) => f.replace('lib/', '')).join(', ')}`); }
{ const a = new Set(B.members[OTHER] || []), b = new Set(H.members[OTHER] || []); p(`- code delta: −[${[...a].filter((f) => !b.has(f)).join(', ')}] +[${[...b].filter((f) => !a.has(f)).join(', ')}]`); }

p('\n## Area file counts, internal imports, entry files');
p('| area | files B | files H | internal B | internal H | entry B | entry H |'); p('|---|---|---|---|---|---|---|');
for (const a of H.s.areas) { const o = B.s.areas.find((x) => x.name === a.name) || {}; p(`| ${short(a.name)} | ${o.files} | ${a.files} | ${o.internalImports} | ${a.internalImports} | ${o.entryFiles?.length} | ${a.entryFiles.length} |`); }
p('\nEntry-file changes per area (path(importers:fromAreas)):');
const ef = (a) => new Map(a.entryFiles.map((f) => [f.path, `${f.importers}:${f.importedFromAreas.map(short).join('+')}`]));
for (const a of H.s.areas) {
  const o = B.s.areas.find((x) => x.name === a.name); const mb = ef(o), mh = ef(a); const ch = [];
  for (const [k, v] of mh) if (!mb.has(k)) ch.push(`+${k}(${v})`); else if (mb.get(k) !== v) ch.push(`~${k}(${mb.get(k)} → ${v})`);
  for (const k of mb.keys()) if (!mh.has(k)) ch.push(`−${k}(${mb.get(k)})`);
  if (ch.length) p(`- **${a.name}**: ${ch.join('; ')}`);
}

p('\n## Files added / removed in scope');
const added = [...H.files].filter((f) => !B.files.has(f)).sort(), removed = [...B.files].filter((f) => !H.files.has(f)).sort();
p(`- added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'}`);
for (const f of added) {
  const imp = H.e.edgeList.filter((x) => x.to === f), out2 = H.e.edgeList.filter((x) => x.from === f);
  p(`- \`${f}\` → area **${areaOf(f)}**. Importers (${imp.length}): ${imp.map((x) => `${x.from} [${short(x.fromArea)}]`).join(', ') || 'none'}. Imports (${out2.length}): ${out2.map((x) => `${x.to} [${short(x.toArea)}]`).join(', ') || 'none'}.`);
}

p('\n## File-level cross-area edges added / removed by code');
const ek = (x) => `${x.from} → ${x.to}`;
const cb = new Map(B.e.edgeList.filter((x) => x.fromArea !== x.toArea).map((x) => [ek(x), x]));
const ch2 = new Map(H.e.edgeList.filter((x) => x.fromArea !== x.toArea).map((x) => [ek(x), x]));
const addE = [...ch2.keys()].filter((k) => !cb.has(k)).sort(), remE = [...cb.keys()].filter((k) => !ch2.has(k)).sort();
p(`Added (${addE.length}):`); for (const k of addE) { const x = ch2.get(k); p(`- ${k}  [${short(x.fromArea)} → ${short(x.toArea)}]`); }
p(`\nRemoved (${remE.length}):`); for (const k of remE) { const x = cb.get(k); p(`- ${k}  [${short(x.fromArea)} → ${short(x.toArea)}]`); }
const ib = new Set(B.e.edgeList.filter((x) => x.fromArea === x.toArea).map(ek)), ih = new Set(H.e.edgeList.filter((x) => x.fromArea === x.toArea).map(ek));
p(`\nIntra-area edges: ${ib.size} → ${ih.size} (added ${[...ih].filter((k) => !ib.has(k)).length}, removed ${[...ib].filter((k) => !ih.has(k)).length}).`);
p(`- added: ${[...ih].filter((k) => !ib.has(k)).sort().join('; ') || 'none'}`);
p(`- removed: ${[...ib].filter((k) => !ih.has(k)).sort().join('; ') || 'none'}`);

p('\n## Change coupling (cochange --days 60, same guide)');
p('| commit | window | changes | touching 2+ areas | pairs | unmapped | shallow |'); p('|---|---|---|---|---|---|---|');
for (const c of ['B', 'H']) { const x = data[c].cc; p(`| ${S8[c]} | ${x.windowStart} → ${x.windowEnd} | ${x.changes} | ${x.changesTouchingMultipleAreas} | ${x.pairs.length} | ${x.unmappedFiles} | ${x.shallow} |`); }
{
  const s0 = Math.max(Date.parse(B.cc.windowStart), Date.parse(H.cc.windowStart)), s1 = Math.min(Date.parse(B.cc.windowEnd), Date.parse(H.cc.windowEnd));
  const days = (s1 - s0) / 86400000; p(`\nShared window: ${days.toFixed(3)} of 60 days (${(100 * days / 60).toFixed(2)}%).`);
}
const ccMap = (x) => new Map(x.pairs.map((q) => [q.areas.join(' + '), q.changes]));
const mb = ccMap(B.cc), mh = ccMap(H.cc);
const linked = (s, a, b) => (s.directed[`${a} → ${b}`] ?? 0) + (s.directed[`${b} → ${a}`] ?? 0) > 0;
p('\nTop 15 pairs at 2eb73ae0 (with d7ceb373, Δ, import link at 2eb73ae0):');
p('| pair | 2eb73ae0 | d7ceb373 | Δ | import link? |'); p('|---|---|---|---|---|');
for (const q of H.cc.pairs.slice(0, 15)) { const k = q.areas.join(' + '); const o = mb.get(k) ?? 0; p(`| ${q.areas.map(short).join(' + ')} | ${q.changes} | ${o} | ${q.changes - o > 0 ? '+' : ''}${q.changes - o} | ${linked(H, ...q.areas) ? 'yes' : 'no'} |`); }
p('\nAll pairs whose count moved:');
for (const k of new Set([...mb.keys(), ...mh.keys()])) { const a = mb.get(k) ?? 0, b = mh.get(k) ?? 0; if (a !== b) p(`- ${k.split(' + ').map(short).join(' + ')}: ${a} → ${b}`); }
const nolink = (s, x) => x.pairs.filter((q) => !linked(s, ...q.areas));
p(`\nNo-link pairs: d7ceb373 ${nolink(B, B.cc).length} of ${B.cc.pairs.length}; 2eb73ae0 ${nolink(H, H.cc).length} of ${H.cc.pairs.length}.`);
p(`- at 2eb73ae0: ${nolink(H, H.cc).map((q) => `${q.areas.map(short).join(' + ')} (${q.changes})`).join('; ')}`);
process.stdout.write(out.join('\n') + '\n');
