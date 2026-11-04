// Scratch comparison for LIN-4231 run 6, beat 2. Reads only the evidence JSON, plus the tool's own guide matcher
// and scope over committed git objects (for catch-all membership, which seams.mjs does not list).
// usage: node compare.mjs <repoDir> <evidenceDir>
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const [repoArg, evArg] = process.argv.slice(2);
const repo = resolve(repoArg); const ev = resolve(evArg);
const lib = await import(join(repo, 'scripts/code-shape/code-shape-lib.mjs'));
const { inScope } = await import(join(repo, 'scripts/code-shape/seams.mjs'));

const CODES = { B: '5334c81a', H: 'd7ceb373' };
const FULL = { B: '5334c81a7207b9f2cc85ca429a2c6b18e1635c0e', H: 'd7ceb373444f9efbc027656132352d247535aa5e' };
const GUIDES = { old: 'old-5334c81a', head: 'head-d7ceb373' };
const combos = [];
for (const c of ['B', 'H']) for (const g of ['old', 'head']) combos.push({ c, g, key: `${CODES[c]}×${g}` });
const J = (f) => JSON.parse(readFileSync(join(ev, f), 'utf8'));
const OTHER = 'Other features', LLM = 'LLM & prompts', RUNS = 'Runs & dispatch';
const short = (n) => n.replace(/ \(.*\)$/, '').replace('Front end: ', '').replace(', accounts & workspaces', '').replace(' & operator tools', '').replace(' & plumbing', '').replace(' & dispatch', '').replace(' & prompts', '').replace(' (pages & workspace API)', '');

const data = {};
for (const x of combos) {
  const s = J(`seams-code-${CODES[x.c]}-guide-${GUIDES[x.g]}.json`);
  const e = J(`edges-code-${CODES[x.c]}-guide-${GUIDES[x.g]}.json`);
  const guide = lib.compileGuide(J(`areas.${GUIDES[x.g]}.json`));
  const { files } = lib.readCommit(repo, FULL[x.c], inScope);
  const areaOf = (p) => guide.find((a) => a.rx.some((r) => r.test(p)))?.name ?? 'UNMAPPED';
  const members = {};
  for (const p of Object.keys(files).sort()) (members[areaOf(p)] ||= []).push(p);
  const directed = {}; for (const l of s.links) directed[`${l.from} → ${l.to}`] = l.imports;
  data[x.key] = { s, e, members, directed, areaOf };
}

const out = [];
const p = (...a) => out.push(a.join(''));
p('# Run 6 beat 2 comparison (scratch, from evidence JSON)\n');
p('## Scope and tool limits (seams.scope)');
p('| combo | files | parseFailures | nonLiteralDynamicImports | unmappedFiles | unresolvedRelativeImports |'); p('|---|---|---|---|---|---|');
for (const x of combos) { const sc = data[x.key].s.scope; p(`| ${x.key} | ${sc.files} | ${sc.parseFailures.length} | ${sc.nonLiteralDynamicImports} | ${sc.unmappedFiles.length} | ${sc.unresolvedRelativeImports} |`); }

p('\n## Headline per combination');
p('| combo | links (sum) | link rows | knot pairs | groups (sizes) | Other files | F1 LLM→Runs / Runs→LLM |'); p('|---|---|---|---|---|---|---|');
for (const x of combos) {
  const d = data[x.key]; const tot = d.s.links.reduce((a, l) => a + l.imports, 0);
  const f1 = d.s.knots.pairs.find((q) => [q.a, q.b].includes(LLM) && [q.a, q.b].includes(RUNS));
  const f1s = f1 ? (f1.a === LLM ? `${f1.aToB}/${f1.bToA}` : `${f1.bToA}/${f1.aToB}`) : 'not a knot';
  const oth = d.s.areas.find((a) => a.name === OTHER)?.files ?? 0;
  p(`| ${x.key} | ${tot} | ${d.s.links.length} | ${d.s.knots.pairs.length} | ${d.s.knots.groups.map((g) => g.length).join(',')} | ${oth} | ${f1s} |`);
}

p('\n## Knot pairs per combination (a→b / b→a)');
const pairKey = (q) => [q.a, q.b].sort().join(' ↔ ');
const allPairs = new Set(); for (const x of combos) for (const q of data[x.key].s.knots.pairs) allPairs.add(pairKey(q));
p(`| pair | ${combos.map((x) => x.key).join(' | ')} |`); p(`|---|${combos.map(() => '---').join('|')}|`);
for (const k of [...allPairs].sort()) {
  const [a, b] = k.split(' ↔ ');
  p(`| ${short(a)} ↔ ${short(b)} | ${combos.map((x) => { const d = data[x.key].directed; const ab = d[`${a} → ${b}`] ?? 0, ba = d[`${b} → ${a}`] ?? 0; const isKnot = data[x.key].s.knots.pairs.some((q) => pairKey(q) === k); return `${ab}/${ba}${isKnot ? '' : ' (no knot)'}`; }).join(' | ')} |`);
}
p('\nKnot groups (members):');
for (const x of combos) p(`- ${x.key}: ${data[x.key].s.knots.groups.map((g) => `[${g.map(short).join(', ')}]`).join(' ')}`);

p('\n## Catch-all ("Other features") members, by the tool\'s compileGuide first-match over readCommit(inScope)');
for (const x of combos) { const m = data[x.key].members[OTHER] || []; const tool = data[x.key].s.areas.find((a) => a.name === OTHER)?.files; p(`- ${x.key} (${m.length}; seams says ${tool}): ${m.map((f) => f.replace('lib/', '')).join(', ')}`); }
const diffM = (k1, k2) => { const a = new Set(data[k1].members[OTHER] || []), b = new Set(data[k2].members[OTHER] || []); return `−[${[...a].filter((f) => !b.has(f)).join(', ')}] +[${[...b].filter((f) => !a.has(f)).join(', ')}]`; };
p(`- code, old guide (5334c81a→d7ceb373): ${diffM('5334c81a×old', 'd7ceb373×old')}`);
p(`- code, HEAD guide (5334c81a→d7ceb373): ${diffM('5334c81a×head', 'd7ceb373×head')}`);
p(`- placement at 5334c81a (old→head): ${diffM('5334c81a×old', '5334c81a×head')}`);
p(`- placement at d7ceb373 (old→head): ${diffM('d7ceb373×old', 'd7ceb373×head')}`);
p(`- headline (5334c81a×old = run 5 → d7ceb373×head): ${diffM('5334c81a×old', 'd7ceb373×head')}`);

p('\n## Area file counts per combination');
const areaNames = data['d7ceb373×head'].s.areas.map((a) => a.name);
p(`| area | ${combos.map((x) => x.key).join(' | ')} |`); p(`|---|${combos.map(() => '---').join('|')}|`);
for (const n of areaNames) p(`| ${short(n)} | ${combos.map((x) => data[x.key].s.areas.find((a) => a.name === n)?.files ?? '-').join(' | ')} |`);

p('\n## Entry files per area (seams.areas[].entryFiles), d7ceb373 × HEAD guide; changes vs other combos noted');
const efKey = (a) => a.entryFiles.map((f) => `${f.path}(${f.importers}:${f.importedFromAreas.map(short).join('+')})`);
for (const a of data['d7ceb373×head'].s.areas) {
  p(`- **${a.name}** (${a.files} files, ${a.internalImports} internal imports, ${a.entryFiles.length} entry files): ${efKey(a).join('; ')}`);
  for (const x of combos.filter((y) => y.key !== 'd7ceb373×head')) {
    const o = data[x.key].s.areas.find((b) => b.name === a.name); if (!o) { p(`  - vs ${x.key}: area absent`); continue; }
    const A = new Set(efKey(a)), O = new Set(efKey(o));
    const rem = [...O].filter((v) => !A.has(v)), add = [...A].filter((v) => !O.has(v));
    if (rem.length || add.length) p(`  - vs ${x.key}: only there: ${rem.join('; ') || '—'} | only at d7ceb373×head: ${add.join('; ') || '—'}`);
  }
}

p('\n## Importers by area for named files (from edge dumps; "in" counts importer files)');
const TARGETS = ['lib/cost-read.js', 'lib/request-usage-loader.js', 'lib/request-usage-store.js', 'lib/usage-snapshot-intake.js', 'lib/proxy-preamble.js', 'lib/tree.js', 'lib/run-controls.js', 'lib/task-page-loader.js', 'lib/request-usage-fold.js', 'lib/request-usage-vocabulary.js', 'lib/request-usage-intake.js', 'lib/workspace-kpis-cache.js', 'lib/cost-format.js'];
for (const t of TARGETS) {
  p(`- \`${t}\``);
  for (const x of combos) {
    const d = data[x.key]; const own = d.areaOf(t);
    const ins = d.e.edgeList.filter((e) => e.to === t); const outs = d.e.edgeList.filter((e) => e.from === t);
    if (!ins.length && !outs.length && !d.members[own]?.includes(t)) { p(`  - ${x.key}: absent`); continue; }
    const by = {}; for (const e of ins) by[e.fromArea] = (by[e.fromArea] || 0) + 1;
    const cross = ins.filter((e) => e.fromArea !== own);
    const xo = outs.filter((e) => e.toArea !== own);
    p(`  - ${x.key}: area=${short(own)}; in ${ins.length} (cross ${cross.length} from ${new Set(cross.map((e) => e.fromArea)).size} areas) {${Object.entries(by).map(([k, v]) => `${short(k)}:${v}`).join(', ')}}; out ${outs.length} (cross ${xo.length}: ${xo.map((e) => `${e.to.replace('lib/', '')}[${short(e.toArea)}]`).join(', ') || '—'})`);
  }
  const H = data['d7ceb373×head']; p(`  - importers at d7ceb373: ${H.e.edgeList.filter((e) => e.to === t).map((e) => e.from).join(', ') || '—'}`);
}

p('\n## Decomposition: placement (same code, guide old→head) vs code (same guide, 5334c81a→d7ceb373)');
const tot = (k) => data[k].s.links.reduce((a, l) => a + l.imports, 0);
const f1 = (k) => { const d = data[k].directed; return [d[`${LLM} → ${RUNS}`] ?? 0, d[`${RUNS} → ${LLM}`] ?? 0]; };
const oth = (k) => data[k].s.areas.find((a) => a.name === OTHER)?.files ?? 0;
const sq = (fn, label) => {
  const bo = fn('5334c81a×old'), bh = fn('5334c81a×head'), ho = fn('d7ceb373×old'), hh = fn('d7ceb373×head');
  const sub = (a, b) => Array.isArray(a) ? a.map((v, i) => v - b[i]).join('/') : a - b;
  p(`- **${label}**: 5334c81a×old ${bo} · 5334c81a×head ${bh} · d7ceb373×old ${ho} · d7ceb373×head ${hh}`);
  p(`  - placement at 5334c81a: ${sub(bh, bo)}; placement at d7ceb373: ${sub(hh, ho)}`);
  p(`  - code under old guide: ${sub(ho, bo)}; code under HEAD guide (the series): ${sub(hh, bh)}`);
  p(`  - run 5 figure → run 6 HEAD (d7ceb373×head − 5334c81a×old): ${sub(hh, bo)} = placement@5334c81a ${sub(bh, bo)} + code@HEAD guide ${sub(hh, bh)}; interaction (code@head − code@old) = ${Array.isArray(bo) ? sub(sub(hh, bh).split('/').map(Number), sub(ho, bo).split('/').map(Number)) : (hh - bh) - (ho - bo)}`);
};
sq(tot, 'cross-area links'); sq(f1, 'F1 LLM→Runs/Runs→LLM'); sq(oth, 'Other features files');

p('\n## Directed area links that differ between any two combinations');
const allL = new Set(); for (const x of combos) for (const k of Object.keys(data[x.key].directed)) allL.add(k);
p(`| link | ${combos.map((x) => x.key).join(' | ')} | place@B | place@H | code@old | code@head |`); p(`|---|${combos.map(() => '---').join('|')}|---|---|---|---|`);
for (const k of [...allL].sort()) {
  const v = combos.map((x) => data[x.key].directed[k] ?? 0);
  if (new Set(v).size === 1) continue;
  const [bo, bh, ho, hh] = v; const sg = (n) => (n > 0 ? `+${n}` : `${n}`);
  p(`| ${k.split(' → ').map(short).join(' → ')} | ${v.join(' | ')} | ${sg(bh - bo)} | ${sg(hh - ho)} | ${sg(ho - bo)} | ${sg(hh - bh)} |`);
}

p('\n## File-level cross-area edges added/removed by code (HEAD guide, 5334c81a→d7ceb373)');
const ek = (e) => `${e.from} → ${e.to}`;
const eB = data['5334c81a×head'].e.edgeList, eH = data['d7ceb373×head'].e.edgeList;
const sB = new Set(eB.map(ek)), sH = new Set(eH.map(ek));
const fmt = (e) => `${e.from} [${short(e.fromArea)}] → ${e.to} [${short(e.toArea)}]${e.fromArea === e.toArea ? ' (intra)' : ''}`;
p('Added:'); for (const e of eH.filter((e) => !sB.has(ek(e)))) p(`- + ${fmt(e)}`);
p('Removed:'); for (const e of eB.filter((e) => !sH.has(ek(e)))) p(`- − ${fmt(e)}`);
p('\nSame for the old guide (labels differ; edge set is the same):');
const oB = data['5334c81a×old'].e.edgeList, oH = data['d7ceb373×old'].e.edgeList; const soB = new Set(oB.map(ek)), soH = new Set(oH.map(ek));
p(`- added ${oH.filter((e) => !soB.has(ek(e))).length} (cross ${oH.filter((e) => !soB.has(ek(e)) && e.fromArea !== e.toArea).length}), removed ${oB.filter((e) => !soH.has(ek(e))).length} (cross ${oB.filter((e) => !soH.has(ek(e)) && e.fromArea !== e.toArea).length})`);
p(`- HEAD guide: added ${eH.filter((e) => !sB.has(ek(e))).length} (cross ${eH.filter((e) => !sB.has(ek(e)) && e.fromArea !== e.toArea).length}), removed ${eB.filter((e) => !sH.has(ek(e))).length} (cross ${eB.filter((e) => !sH.has(ek(e)) && e.fromArea !== e.toArea).length})`);

p('\n## Placement: file-level edges whose cross/intra status changes with the guide, at d7ceb373');
const mapH = new Map(eH.map((e) => [ek(e), e])); const eHo = data['d7ceb373×old'].e.edgeList;
for (const e of eHo) { const h = mapH.get(ek(e)); if (e.fromArea !== h.fromArea || e.toArea !== h.toArea) p(`- ${e.from} → ${e.to}: old [${short(e.fromArea)}→${short(e.toArea)}] head [${short(h.fromArea)}→${short(h.toArea)}]`); }

// Cochange
p('\n## Change coupling (cochange --days 60)');
const RUN5 = { 'browser code + server-rendered pages': 142, 'Runs + Web routes': 111, 'browser code + Web routes': 107, 'Agent API + Runs': 101, 'server-rendered pages + Web routes': 99, 'Web routes + Wiring': 95, 'server-rendered pages + Runs': 92, 'browser code + Runs': 87, 'LLM + Runs': 85, 'LLM + Web routes': 82 };
const cc = {}; for (const x of combos) cc[x.key] = J(`cochange-code-${CODES[x.c]}-guide-${GUIDES[x.g]}-days60.json`);
p('| combo | windowStart | windowEnd | changes | 2+ areas | pairs | unmapped | shallow |'); p('|---|---|---|---|---|---|---|---|');
for (const x of combos) { const c = cc[x.key]; p(`| ${x.key} | ${c.windowStart} | ${c.windowEnd} | ${c.changes} | ${c.changesTouchingMultipleAreas} | ${c.pairs.length} | ${c.unmappedFiles} | ${c.shallow} |`); }
const pk = (pr) => pr.areas.map(short).sort().join(' + ');
const ccMap = {}; for (const x of combos) { ccMap[x.key] = {}; for (const pr of cc[x.key].pairs) ccMap[x.key][pk(pr)] = pr.changes; }
const top = Object.entries(ccMap['d7ceb373×head']).sort((a, b) => b[1] - a[1]).slice(0, 14);
p(`\n| pair | ${combos.map((x) => x.key).join(' | ')} | run 5 §6 | import link at d7ceb373×head? |`); p(`|---|${combos.map(() => '---').join('|')}|---|---|`);
const linkAt = (k, pair) => { const [a, b] = pair.split(' + '); return Object.keys(data[k].directed).some((l) => { const [f, t] = l.split(' → ').map(short); return (f === a && t === b) || (f === b && t === a); }); };
for (const [k] of top) { const r5 = Object.entries(RUN5).find(([n]) => n.split(' + ').sort().join(' + ') === k)?.[1] ?? '—'; p(`| ${k} | ${combos.map((x) => ccMap[x.key][k] ?? 0).join(' | ')} | ${r5} | ${linkAt('d7ceb373×head', k) ? 'yes' : 'no'} |`); }
p('\nPairs whose count differs between guides at the same commit:');
for (const c of ['5334c81a', 'd7ceb373']) { const o = ccMap[`${c}×old`], h = ccMap[`${c}×head`]; const ks = new Set([...Object.keys(o), ...Object.keys(h)]); const d = [...ks].filter((k) => o[k] !== h[k]).map((k) => `${k} ${o[k] ?? 0}→${h[k] ?? 0}`); p(`- ${c}: ${d.join('; ') || 'none'}`); }
p('\nBiggest code movers (HEAD guide, 5334c81a→d7ceb373):');
{ const o = ccMap['5334c81a×head'], h = ccMap['d7ceb373×head']; const ks = new Set([...Object.keys(o), ...Object.keys(h)]); const d = [...ks].map((k) => [k, (h[k] ?? 0) - (o[k] ?? 0)]).filter(([, v]) => v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); p(d.slice(0, 15).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join('; ')); }
p('\nNo-link pairs (cochange pair with no import link either way) per combo:');
for (const x of combos) { const nl = Object.keys(ccMap[x.key]).filter((k) => !linkAt(x.key, k)); p(`- ${x.key}: ${nl.length} of ${Object.keys(ccMap[x.key]).length}: ${nl.join('; ')}`); }

console.log(out.join('\n'));
