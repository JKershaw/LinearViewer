// Retention core (LIN-3829): which LIN-### refs a rebuild commit drops from its comments.
// Pure: file contents in, data out. Refs come from comments only (acorn onComment, never text search),
// and are pooled per commit, so a ref moved between changed files in the same commit is not a drop.
// A file that fails to parse on either side is left out of both pools and listed under parseFailures:
// counting it would make every ref in a broken head file look dropped, and ignoring it silently hides a drop.
import { parse } from 'acorn';

// LIN-622/623 names two refs; the comma form (LIN-12, 13) is not in scope.
const REF = /\bLIN-\d+(?:\/\d+)*/g;
const expand = (text) => {
  const [first, ...rest] = text.split('/');
  return [first, ...rest.map((n) => `LIN-${n}`)];
};
const byNumber = (a, b) => Number(a.slice(4)) - Number(b.slice(4));

// { refs: Set, commentLines } for a module's comments, or { parseError: true }.
export function commentRefs(src) {
  const comments = [];
  try {
    parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, onComment: comments });
  } catch {
    return { parseError: true };
  }
  const refs = new Set();
  let commentLines = 0;
  for (const c of comments) {
    commentLines += c.value.split('\n').length;
    for (const m of c.value.matchAll(REF)) for (const r of expand(m[0])) refs.add(r);
  }
  return { refs, commentLines };
}

// baseFiles / headFiles: { path: text } for the changed in-scope paths ('' where a side lacks the file).
// headTree: a function returning { path: text } for the unchanged in-scope head files. It is called only
// when something was dropped, because parsing the whole tree is the cost of this check.
export function measureRetention({ baseFiles, headFiles, headTree }) {
  const paths = [...new Set([...Object.keys(baseFiles), ...Object.keys(headFiles)])].sort();
  const parseFailures = [];
  const base = new Map();
  const head = new Map();
  for (const path of paths) {
    const b = commentRefs(baseFiles[path] ?? '');
    const h = commentRefs(headFiles[path] ?? '');
    if (b.parseError) parseFailures.push({ path, side: 'base' });
    if (h.parseError) parseFailures.push({ path, side: 'head' });
    if (b.parseError || h.parseError) continue;
    base.set(path, b);
    head.set(path, h);
  }

  const baseWhere = new Map(); // ref -> the base files that cite it
  for (const [path, { refs }] of base) {
    for (const ref of refs) {
      if (!baseWhere.has(ref)) baseWhere.set(ref, []);
      baseWhere.get(ref).push(path);
    }
  }
  const headRefs = new Set();
  for (const { refs } of head.values()) for (const ref of refs) headRefs.add(ref);

  const dropped = [...baseWhere.keys()].filter((ref) => !headRefs.has(ref)).sort(byNumber)
    .map((ref) => ({ ref, baseFiles: baseWhere.get(ref), citedElsewhereAtHead: [] }));

  if (dropped.length) {
    const changed = new Set(paths);
    const tree = headTree();
    for (const path of Object.keys(tree).sort()) {
      if (changed.has(path)) continue;
      const c = commentRefs(tree[path]);
      if (c.parseError) continue;
      for (const d of dropped) if (c.refs.has(d.ref)) d.citedElsewhereAtHead.push(path);
    }
  }

  const sum = (files, key) => [...files.values()].reduce((n, f) => n + f[key], 0);
  return {
    dropped,
    linRefs: [baseWhere.size, headRefs.size],
    commentLines: [sum(base, 'commentLines'), sum(head, 'commentLines')],
    parseFailures,
  };
}
