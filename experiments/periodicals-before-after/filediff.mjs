import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2, 4).map((p) => JSON.parse(readFileSync(p, 'utf8')));
const focus = process.argv.slice(4);
const E = (x) => new Set(x.links.map((l) => `${l.from} -> ${l.to}`));
const ea = E(a), eb = E(b);
console.log('file edges', ea.size, '->', eb.size, ' file-level 2-way pairs', a.knots.pairs.length, '->', b.knots.pairs.length, ' cycle groups', JSON.stringify(a.knots.groups.map(g=>g.length)), '->', JSON.stringify(b.knots.groups.map(g=>g.length)));
const added = [...eb].filter((e) => !ea.has(e)), removed = [...ea].filter((e) => !eb.has(e));
console.log('\nADDED edges', added.length); added.forEach((e) => console.log('  +', e));
console.log('\nREMOVED edges', removed.length); removed.forEach((e) => console.log('  -', e));
const deg = (S, f) => ({ out: [...S].filter((e) => e.startsWith(f + ' -> ')).length, in: [...S].filter((e) => e.endsWith(' -> ' + f)).length });
console.log('\nFOCUS fan-out/fan-in (files):');
for (const f of focus) { const x = deg(ea, f), y = deg(eb, f); console.log(`  ${f}: out ${x.out}->${y.out}, in ${x.in}->${y.in}`); }
