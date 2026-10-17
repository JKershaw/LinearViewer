import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
const sum = (x) => ({
  commit: x.commit.slice(0, 8), files: x.scope.files, parseFailures: x.scope.parseFailures.length,
  unresolved: x.scope.unresolvedRelativeImports, nonLiteral: x.scope.nonLiteralDynamicImports, unmapped: x.scope.unmappedFiles.length,
  linkRows: x.links.length, crossImports: x.links.reduce((s, l) => s + l.imports, 0),
  pairs: x.knots.pairs.length, groups: x.knots.groups.map((g) => g.length),
  internal: x.areas.reduce((s, ar) => s + ar.internalImports, 0),
  entryFiles: x.areas.reduce((s, ar) => s + ar.entryFiles.length, 0),
});
console.log(JSON.stringify([sum(a), sum(b)]));
console.log('unmapped/unresolved detail', JSON.stringify(b.scope.unmappedFiles), JSON.stringify(b.scope.parseFailures));
const lk = (x) => new Map(x.links.map((l) => [`${l.from} -> ${l.to}`, l.imports]));
const la = lk(a), lb = lk(b);
console.log('\nLINKS changed:');
for (const k of new Set([...la.keys(), ...lb.keys()])) if (la.get(k) !== lb.get(k)) console.log(`  ${k}: ${la.get(k) ?? 0} -> ${lb.get(k) ?? 0}`);
const pk = (x) => new Map(x.knots.pairs.map((p) => [`${p.a} <-> ${p.b}`, `${p.aToB}/${p.bToA}`]));
const pa = pk(a), pb = pk(b);
console.log('\nPAIRS changed:');
for (const k of new Set([...pa.keys(), ...pb.keys()])) if (pa.get(k) !== pb.get(k)) console.log(`  ${k}: ${pa.get(k) ?? '-'} -> ${pb.get(k) ?? '-'}`);
console.log('\nGROUPS a', JSON.stringify(a.knots.groups)); console.log('GROUPS b', JSON.stringify(b.knots.groups));
console.log('\nAREAS:');
const am = new Map(a.areas.map((x) => [x.name, x]));
for (const y of b.areas) { const x = am.get(y.name) || { files: 0, internalImports: 0, entryFiles: [] };
  console.log(`  ${y.name}: files ${x.files}->${y.files}, internal ${x.internalImports}->${y.internalImports}, entryFiles ${x.entryFiles.length}->${y.entryFiles.length}`);
  const ea = new Map(x.entryFiles.map((e) => [e.path, e])), eb = new Map(y.entryFiles.map((e) => [e.path, e]));
  for (const p of new Set([...ea.keys(), ...eb.keys()])) { const u = ea.get(p), v = eb.get(p);
    const s = (e) => e ? `${e.importers}[${e.importedFromAreas.join('; ')}]` : '-';
    if (s(u) !== s(v)) console.log(`      ${p}: ${s(u)} -> ${s(v)}`); }
}
// crossing-level detail: file pairs added/removed
const cr = (x) => { const s = new Set(); for (const p of x.knots.pairs) for (const c of p.crossings) s.add(`${c.from} -> ${c.to}`); return s; };
