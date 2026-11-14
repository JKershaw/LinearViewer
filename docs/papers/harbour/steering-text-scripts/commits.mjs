// LIN-4478: per first-parent commit, the byte change of each steering layer (new blob size
// minus old blob size, per file), with the commit's subject. Usage:
//   node docs/papers/harbour/steering-text-scripts/commits.mjs [rev=HEAD] > commits.json
import { execFileSync } from 'child_process';
import { layerOf } from './layers.mjs';

const git = (a, input) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 30, input });
const rev = process.argv[2] || 'HEAD';
const commits = git(['log', '--first-parent', '--format=%H%x09%P%x09%cs%x09%s', rev]).trim().split('\n').map((l) => {
  const [sha, parents, day, subject] = l.split('\t');
  return { sha, parent: parents.split(' ')[0] || null, day, subject };
}).filter((c) => c.parent);

const rows = [];
const need = new Set();
for (const c of commits) {
  const raw = git(['diff-tree', '-r', '--no-renames', c.parent, c.sha]).trim();
  const files = [];
  for (const line of raw ? raw.split('\n') : []) {
    const m = line.match(/^:\S+ \S+ (\S+) (\S+) \S+\t(.+)$/);
    if (!m) continue;
    const layer = layerOf(m[3]);
    if (!layer) continue;
    files.push({ path: m[3], layer, a: m[1], b: m[2] });
    need.add(m[1]); need.add(m[2]);
  }
  rows.push({ ...c, files });
}
const zero = '0'.repeat(40);
need.delete(zero);
const size = new Map([[zero, 0]]);
const list = [...need];
for (let i = 0; i < list.length; i += 5000) {
  const out = git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], list.slice(i, i + 5000).join('\n') + '\n');
  for (const l of out.trim().split('\n')) { const [o, s] = l.split(' '); size.set(o, Number(s) || 0); }
}
const result = rows.map((r) => {
  const layers = {};
  for (const f of r.files) {
    const d = size.get(f.b) - size.get(f.a);
    const L = (layers[f.layer] ||= { net: 0, grew: 0, shrank: 0, files: [] });
    L.net += d; if (d > 0) L.grew += d; else L.shrank -= d;
    if (d !== 0) L.files.push([f.path, d]);
  }
  return { sha: r.sha.slice(0, 9), day: r.day, subject: r.subject, layers };
});
console.log(JSON.stringify(result));
