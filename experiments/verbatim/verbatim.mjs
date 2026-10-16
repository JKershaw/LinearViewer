// Rebuilt-vs-edited measure: share of NEW non-trivial lines found verbatim in OLD.
// Usage: node verbatim.mjs <repo>   (read-only: uses `git show <sha>:<path>`)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.argv[2] || '/home/user/LinearViewer';
const outDir = dirname(fileURLToPath(import.meta.url));

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

const REBUILDS = [
  { ticket: 'LIN-3556', method: 'informed rewrite', files: ['lib/providers/jira/adf.js'] },
  { ticket: 'LIN-3557', method: 'clean room', files: ['lib/providers/jira/adf.js'] },
  { ticket: 'LIN-3565', method: 'clean room', files: ['lib/providers/jira/adf.js'] },
  { ticket: 'LIN-3566', method: 'design-first', files: ['lib/render-roadmap.js'] },
  { ticket: 'LIN-3569', method: 'design-first', files: ['routes/proxy-reads.js'] },
  { ticket: 'LIN-3573', method: 'design-first', files: ['routes/proxy-writes.js', 'routes/proxy-rulings.js'] },
  { ticket: 'LIN-3578', method: 'design-first', files: ['lib/pipeline-loops.js'] },
  { ticket: 'LIN-3579', method: 'design-first', files: ['lib/render.js', 'lib/render-session.js', 'lib/render-swipe.js', 'lib/render-settings.js'] },
  { ticket: 'LIN-3580', method: 'design-first', files: ['lib/dispatch-factory.js', 'lib/dispatch-validation.js'] },
  { ticket: 'LIN-3590', method: 'design-first', files: ['lib/task-page-loader.js'] },
  { ticket: 'LIN-3592', method: 'design-first', files: ['routes/dispatch.js', 'routes/proxy-dispatch.js', 'routes/proxy-kickoff.js'] },
  { ticket: 'LIN-3591', method: 'design-first', files: ['lib/kpi-stats.js'] },
];

function findCommit(ticket) {
  const out = git('log', 'origin/main', '--format=%H %s', `--grep=${ticket}:`).trim().split('\n').filter(Boolean);
  // the PR merge: subject starts with the ticket and carries a "(#NNNN)" PR number
  const hit = out.find((l) => l.split(' ').slice(1).join(' ').startsWith(ticket) && /\(#\d+\)$/.test(l));
  return hit ? hit.split(' ')[0] : null;
}

function show(sha, path) {
  try { return git('show', `${sha}:${path}`); } catch { return null; }
}

// Strip import / export-from statements (including multi-line ones) before line-splitting.
function stripImports(src) {
  return src
    .replace(/^[ \t]*import\b[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '')
    .replace(/^[ \t]*import\s*['"][^'"\n]+['"][ \t]*;?/gm, '')
    .replace(/^[ \t]*export\s*(\*|\{)[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '');
}

const TRIVIAL = /^[{}\[\]();,\s]*$/;
function nonTrivialLines(src) {
  return stripImports(src).split('\n').map((l) => l.trim())
    .filter((l) => l && !TRIVIAL.test(l) && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : 'n/a');

const rows = [];
for (const r of REBUILDS) {
  const sha = findCommit(r.ticket);
  if (!sha) { rows.push({ ...r, skipped: 'not merged' }); continue; }
  const parent = git('rev-parse', `${sha}^1`).trim();
  // NEW side: listed files + any non-test source files added by the merge
  const added = git('show', '--format=', '--diff-filter=A', '--name-only', sha).trim().split('\n')
    .filter((p) => p && /\.(m?js)$/.test(p) && !p.startsWith('tests/'));
  const newFiles = [...new Set([...r.files, ...added])];

  const oldLines = r.files.flatMap((f) => nonTrivialLines(show(parent, f) || ''));
  const oldPool = new Map();
  for (const l of oldLines) oldPool.set(l, (oldPool.get(l) || 0) + 1);

  let newTotal = 0, matched = 0, longest = 0, longestAt = '';
  for (const f of newFiles) {
    const src = show(sha, f);
    if (src == null) continue;
    let run = 0, runStart = 0, i = 0;
    for (const l of nonTrivialLines(src)) {
      newTotal++; i++;
      const c = oldPool.get(l) || 0;
      if (c > 0) {
        oldPool.set(l, c - 1); matched++;
        if (run === 0) runStart = i;
        run++;
        if (run > longest) { longest = run; longestAt = `${f} (nt-line ${runStart})`; }
      } else run = 0;
    }
  }
  rows.push({
    ...r, sha: sha.slice(0, 8), parent: parent.slice(0, 8), newFiles,
    newTotal, oldTotal: oldLines.length, matched,
    newPct: pct(matched, newTotal), oldPct: pct(matched, oldLines.length), longest, longestAt,
  });
}

const md = [
  '# Rebuilt vs edited: verbatim line carry-over',
  '',
  'OLD = first parent of the squash-merge commit, NEW = the merge commit. Non-trivial = trimmed, non-blank, not only `{}[]();,`, not a comment (`//`, `*`, `/*`), not an import/export-from. Multiset match on identical trimmed strings across the whole file set.',
  '',
  '| Ticket | Method | Merge (OLD→NEW) | NEW nt lines | OLD nt lines | Matched | New verbatim % | Old surviving % | Longest verbatim run | Run location |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((x) => x.skipped
    ? `| ${x.ticket} | ${x.method} | — | — | — | — | skipped (${x.skipped}) | | | |`
    : `| ${x.ticket} | ${x.method} | ${x.parent}→${x.sha} | ${x.newTotal} | ${x.oldTotal} | ${x.matched} | ${x.newPct} | ${x.oldPct} | ${x.longest} | ${x.longestAt} |`),
  '',
  'NEW-side files: ' + rows.filter((x) => !x.skipped).map((x) => `${x.ticket}: ${x.newFiles.join(', ')}`).join('; '),
  '',
];
writeFileSync(join(outDir, 'verbatim.md'), md.join('\n'));
console.log(md.join('\n'));
