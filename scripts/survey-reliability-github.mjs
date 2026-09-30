// LIN-3149: snapshot both repos' merged PRs and every push-to-main CI run (final attempt) from GitHub via the `gh` CLI into a git-ignored cache.
// Usage: node scripts/survey-reliability-github.mjs [cache=data/survey/reliability-github.json] [--since 2026-01-01] [--until 2026-09-30]
// The runs API returns at most 1,000 rows per filtered query, so runs are paged one calendar month at a time.
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const since = arg('--since', '2026-01-01');
const until = arg('--until', '2026-09-30');
const cachePath = argv[0] || 'data/survey/reliability-github.json';

// The CI workflow on main for each repo: LinearViewer "Tests" (since 2026-01-05), simple-dispatcher "CI" (since 2026-07-25, LIN-1580).
export const REPOS = { LinearViewer: { workflow: 'test.yml' }, 'simple-dispatcher': { workflow: 'ci.yml' } };

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 30 });

function months(from, to) {
  const out = []; const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  while (d.toISOString().slice(0, 10) <= to) {
    const start = d.toISOString().slice(0, 10);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const end = new Date(d - 86400000).toISOString().slice(0, 10);
    out.push([start, end < to ? end : to]);
  }
  return out;
}

const out = { fetchedAt: new Date().toISOString(), since, until, repos: {} };
for (const [repo, { workflow }] of Object.entries(REPOS)) {
  const prs = JSON.parse(gh(['pr', 'list', '-R', `JKershaw/${repo}`, '--state', 'merged', '--limit', '5000',
    '--json', 'number,mergedAt,createdAt,title,headRefName,mergeCommit,additions,deletions,changedFiles']))
    .map((p) => ({ ...p, mergeCommit: p.mergeCommit?.oid || null }));
  const runs = [];
  for (const [a, b] of months(since, until)) {
    const lines = gh(['api', '--paginate', `repos/JKershaw/${repo}/actions/workflows/${workflow}/runs?branch=main&event=push&per_page=100&created=${a}..${b}`,
      '--jq', '.workflow_runs[] | {id, conclusion, created_at, head_sha, run_attempt}']).trim();
    if (lines) runs.push(...lines.split('\n').map((l) => JSON.parse(l)));
  }
  out.repos[repo] = { prs, runs };
  process.stderr.write(`${repo}: ${prs.length} merged PRs, ${runs.length} main CI runs\n`);
}
mkdirSync(dirname(cachePath), { recursive: true });
writeFileSync(cachePath, JSON.stringify(out));
