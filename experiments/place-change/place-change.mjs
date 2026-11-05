// Per-task place change: the area map at a task's base vs its merge. Reports, never gates.
// usage: node place-change.mjs <repoDir> <base> <head> <areasGuide>
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [repo, base, head, guide] = process.argv.slice(2);
const tool = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/code-shape/seams.mjs');
const run = c => JSON.parse(execFileSync('node', [tool, repo, c, guide], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
const a = run(base), b = run(head);
const catchAll = j => j.areas.at(-1).name;
const areaOf = (j, f) => { for (const ar of j.areas) if (ar.entryFiles.some(e => e.path === f)) return ar.name; return null; };
const sum = j => j.links.reduce((s, l) => s + l.imports, 0);
const pk = p => `${p.a} <-> ${p.b}`;
const pa = new Map(a.knots.pairs.map(p => [pk(p), p])), pb = new Map(b.knots.pairs.map(p => [pk(p), p]));
const added = execFileSync('git', ['-C', repo, 'diff', '--diff-filter=A', '--name-only', base, head, '--', 'lib', 'routes', 'public', 'server.js']).toString().trim().split('\n').filter(Boolean);
const guideJ = JSON.parse(execFileSync('cat', [guide]).toString());
const homeOf = f => { for (const ar of guideJ.areas.slice(0, -1)) if (ar.match.some(m => new RegExp(m).test(f))) return ar.name; return null; };
const out = {
  crossAreaImports: [sum(a), sum(b)],
  twoWayPairs: [a.knots.pairs.length, b.knots.pairs.length],
  knotGroup: [a.knots.groups.map(g => (g.areas || g).length), b.knots.groups.map(g => (g.areas || g).length)],
  newPairs: [...pb.keys()].filter(k => !pa.has(k)),
  closedPairs: [...pa.keys()].filter(k => !pb.has(k)),
  grownPairs: [...pb.entries()].filter(([k, p]) => pa.has(k) && p.aToB + p.bToA > pa.get(k).aToB + pa.get(k).bToA).map(([k, p]) => `${k} ${pa.get(k).aToB}/${pa.get(k).bToA} -> ${p.aToB}/${p.bToA}`),
  shrunkPairs: [...pb.entries()].filter(([k, p]) => pa.has(k) && p.aToB + p.bToA < pa.get(k).aToB + pa.get(k).bToA).map(([k, p]) => `${k} ${pa.get(k).aToB}/${pa.get(k).bToA} -> ${p.aToB}/${p.bToA}`),
  newFilesWithoutHome: added.filter(f => /\.js$/.test(f) && !homeOf(f)),
  newFilesWithHome: added.filter(f => /\.js$/.test(f) && homeOf(f)).map(f => `${f} (${homeOf(f)})`),
};
console.log(JSON.stringify(out, null, 1));
