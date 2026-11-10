// Run 11 (LIN-4402) scratch reader: a literal-require graph for simple-dispatcher's
// root-level CommonJS files. Reads committed git objects only (git ls-tree / git show).
// Usage: node require-graph.mjs <repo> <commit> <areas.json>
// Counting rules follow scripts/code-shape/seams.mjs: an unresolved relative literal
// and any non-literal require() are could-not-read counts, never silently dropped.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [repo, commit, registryPath] = process.argv.slice(2);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const areaOf = (file) => {
  for (const a of registry.areas) {
    if (a.match.some((re) => new RegExp(re).test(file))) return a.name;
  }
  return null;
};

const tree = git('ls-tree', '--name-only', commit).split('\n').filter(Boolean);
const files = tree.filter((f) => /^[^/]+\.js$/.test(f)).sort();
const inTree = new Set(tree);

const unmapped = [];
const unresolved = [];
const nonLiteral = [];
const fileEdges = new Map(); // "from>to" -> true
const perFile = {};

for (const f of files) {
  const src = git('show', `${commit}:${f}`);
  const dir = path.posix.dirname(f);
  perFile[f] = { requires: 0, relative: 0 };
  const re = /require\(/g;
  let m;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index + m[0].length);
    const lit = /^\s*(['"])([^'"]+)\1\s*\)/.exec(rest);
    if (!lit) { nonLiteral.push(`${f}:${m.index}`); continue; }
    const spec = lit[2];
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue; // bare package, not a seam
    perFile[f].relative++;
    const base = path.posix.normalize(path.posix.join(dir, spec));
    const cands = [base, `${base}.js`, `${base}/index.js`];
    const hit = cands.find((c) => inTree.has(c) && c.endsWith('.js'));
    if (!hit) { unresolved.push(`${f} -> ${spec}`); continue; }
    if (hit.includes('/')) { unresolved.push(`${f} -> ${spec} (not root-level: ${hit})`); continue; }
    if (hit !== f) fileEdges.set(`${f}>${hit}`, true);
  }
}

// Unmapped: a file in the scope with no area.
for (const f of files) if (!areaOf(f)) unmapped.push(f);

// Area links, counted as distinct file->file edges per directed area pair.
const areaLinks = {};
const crossings = {};
for (const e of fileEdges.keys()) {
  const [from, to] = e.split('>');
  const a = areaOf(from), b = areaOf(to);
  if (!a || !b || a === b) continue;
  const k = `${a} -> ${b}`;
  areaLinks[k] = (areaLinks[k] || 0) + 1;
  (crossings[k] ||= []).push(`${from} -> ${to}`);
}
const pairs = [];
const seen = new Set();
for (const k of Object.keys(areaLinks)) {
  const [a, b] = k.split(' -> ');
  const rev = `${b} -> ${a}`;
  if (seen.has(k) || seen.has(rev)) continue;
  seen.add(k); seen.add(rev);
  if (areaLinks[rev]) pairs.push({ a, b, aToB: areaLinks[k], bToA: areaLinks[rev] });
}

console.log(JSON.stringify({
  commit,
  method: 'literal require() reader, root-level *.js, git objects only (LIN-4402 run 11 scratch)',
  registry: registryPath.split('/').pop(),
  scope: { files: files.length, unmappedFiles: unmapped, unresolvedRelative: unresolved, nonLiteralRequires: nonLiteral },
  fileEdges: fileEdges.size,
  areaLinks,
  reciprocalPairs: pairs,
  crossings,
}, null, 2));
