// LIN-3151: snapshot every run (all events, final attempt) of each repo's test workflow from GitHub via `gh` into a git-ignored cache.
// Usage: node scripts/survey-tests-ci-runs.mjs [cache=data/survey-tests/ci-runs.json] [--since 2026-06-01] [--until 2026-09-30]
// The runs API returns at most 1,000 rows per filtered query, so runs are paged one calendar month at a time (split in halves if a month hits the cap).
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const since = arg('--since', '2026-06-01');
const until = arg('--until', new Date().toISOString().slice(0, 10));
const cachePath = argv[0] || 'data/survey-tests/ci-runs.json';

// LinearViewer "Tests" (test.yml); simple-dispatcher "CI" (ci.yml, first run 2026-07-25, LIN-1580).
export const REPOS = { LinearViewer: { workflow: 'test.yml' }, 'simple-dispatcher': { workflow: 'ci.yml' } };

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 30 });

function windows(from, to) {
  const out = []; const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  while (d.toISOString().slice(0, 10) <= to) {
    const start = d.toISOString().slice(0, 10);
    const mid = new Date(d.getTime() + 14 * 86400000).toISOString().slice(0, 10);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const end = new Date(d - 86400000).toISOString().slice(0, 10);
    // Half-months keep every window well under the 1,000-row cap.
    out.push([start < from ? from : start, mid], [new Date(new Date(mid).getTime() + 86400000).toISOString().slice(0, 10), end < to ? end : to]);
  }
  return out.filter(([a, b]) => a <= b);
}

const out = { fetchedAt: new Date().toISOString(), since, until, repos: {} };
for (const [repo, { workflow }] of Object.entries(REPOS)) {
  const runs = [];
  for (const [a, b] of windows(since, until)) {
    const lines = gh(['api', '--paginate', `repos/JKershaw/${repo}/actions/workflows/${workflow}/runs?per_page=100&created=${a}..${b}`,
      '--jq', '.workflow_runs[] | {id, event, status, conclusion, created_at, head_branch, head_sha, run_attempt, pull_requests: [.pull_requests[].number]}']).trim();
    const rows = lines ? lines.split('\n').map((l) => JSON.parse(l)) : [];
    if (rows.length >= 1000) console.warn(`${repo} ${a}..${b}: hit the 1,000-row cap`);
    runs.push(...rows);
  }
  const seen = new Set();
  out.repos[repo] = { workflow, runs: runs.filter((r) => !seen.has(r.id) && seen.add(r.id)).sort((x, y) => x.created_at.localeCompare(y.created_at)) };
  console.log(`${repo}: ${out.repos[repo].runs.length} runs`);
}
mkdirSync(dirname(cachePath), { recursive: true });
writeFileSync(cachePath, JSON.stringify(out, null, 2));
console.log(`wrote ${cachePath}`);
