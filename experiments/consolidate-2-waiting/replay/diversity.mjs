// Diagnostic: per caller, how many generated inputs throw and how many distinct outputs they give (old tree).
process.env.TZ = 'UTC'; process.env.NODE_ENV = 'test';
import { resolve } from 'node:path'; import { pathToFileURL } from 'node:url';
import { toTagged, fromTagged, canon } from './codec.mjs';
import { CALLERS, rngFor } from './callers.mjs';
const dir = process.argv[2]; const N = Number(process.argv[3] || 3000);
console.error = console.warn = console.log.bind(console, '');
for (const c of CALLERS) {
  const m = await import(pathToFileURL(resolve(dir, c.file)).href);
  const fn = c.path.reduce((o, k) => o[k], m);
  let thr = 0; const outs = new Map();
  for (let i = 0; i < N; i++) {
    const args = fromTagged(toTagged(c.gen(rngFor('1', c.id, i))));
    try { const v = canon(fn(...args)); const key = v.length > 200 ? v.slice(0, 80) + '#' + v.length : v; outs.set(key, (outs.get(key) || 0) + 1); } catch (e) { thr++; outs.set('THROW ' + e.message.slice(0, 60), (outs.get('THROW ' + e.message.slice(0, 60)) || 0) + 1); }
  }
  const top = [...outs].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${n}× ${k.slice(0, 70)}`);
  process.stdout.write(`${c.id}: throws ${thr}, distinct ${outs.size}\n   ${top.join('\n   ')}\n`);
}
process.exit(0);
