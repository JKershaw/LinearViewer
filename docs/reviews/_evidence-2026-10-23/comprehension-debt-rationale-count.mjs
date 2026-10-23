#!/usr/bin/env node
// Rationale counter for the LIN-3825 comprehension-debt review (evidence, not a gate; not wired into CI).
// For each rebuild commit, compares comments in the changed JS files at <sha>^ vs <sha>:
//   comment lines (lines spanned by acorn comments) and the set of LIN-### refs, pooled per commit
//   so a ref moved between files in the same commit is not counted as dropped.
// Usage: node comprehension-debt-rationale-count.mjs <sha>[ <sha>...]   (run from a LinearViewer checkout)
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const show = (rev, f) => { try { return execFileSync('git', ['show', `${rev}:${f}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
// A dropped ref is still cited at HEAD if the ref text occurs anywhere in lib/ routes/ public/ (word-bounded).
const citedAtHead = r => { try { execFileSync('git', ['grep', '-qwE', r, 'HEAD', '--', 'lib', 'routes', 'public'], { stdio: 'ignore' }); return true; } catch { return false; } };

function scan(src) {
  if (src == null) return { lines: 0, refs: new Set() };
  const comments = [];
  try {
    parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, onComment: comments });
  } catch { return { lines: 0, refs: new Set(), parseError: true }; }
  let lines = 0; const refs = new Set();
  for (const c of comments) {
    lines += c.value.split('\n').length;
    for (const m of c.value.matchAll(/LIN-\d+/g)) refs.add(m[0]);
  }
  return { lines, refs };
}

for (const sha of process.argv.slice(2)) {
  const files = git('diff', '--name-only', '--diff-filter=AMDR', `${sha}^`, sha)
    .split('\n').filter(f => /^(lib|routes)\/.*\.js$/.test(f) || /^lib\/.*\.mjs$/.test(f));
  let before = 0, after = 0; const rb = new Set(), ra = new Set(); let perr = 0;
  for (const f of files) {
    const b = scan(show(`${sha}^`, f)), a = scan(show(sha, f));
    before += b.lines; after += a.lines; b.refs.forEach(r => rb.add(r)); a.refs.forEach(r => ra.add(r));
    if (a.parseError || b.parseError) perr++;
  }
  const dropped = [...rb].filter(r => !ra.has(r)).sort();
  console.log(JSON.stringify({ sha: sha.slice(0, 8), subject: git('log', '-1', '--format=%s', sha).trim().slice(0, 90),
    files: files.length, parseErrors: perr, commentLines: [before, after], linRefs: [rb.size, ra.size], dropped,
    droppedNotCitedAtHead: dropped.filter(r => !citedAtHead(r)) }));
}
