// LIN-3177: every CI run on the sampled tickets' merged PRs (both repos), read from GitHub, to count red CI independently of what the digests show.
// Usage: node scripts/survey-judgement-ci.mjs [--sample data/survey-judgement/sample.json] [--out data/survey-judgement/ci.json]
// A ticket's PRs are the merged PRs whose head branch or title names it (else whose body does), in JKershaw/LinearViewer and
// JKershaw/simple-dispatcher. For each PR head branch, every workflow run is listed. A red run is one that concluded failure. It is
// "re-run green" when a later run on the same commit passed (a flake, or an outage), "fixed by a commit" when the next green run is on
// a later commit, and "never green" otherwise. A re-run's earlier attempts are read too, since a re-run replaces the run's conclusion. Uses the gh CLI (GitHub's API, not the workspace proxy).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const sample = JSON.parse(readFileSync(arg('--sample', 'data/survey-judgement/sample.json'), 'utf8')).sample;
const out = arg('--out', 'data/survey-judgement/ci.json');
const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 }));
const REPOS = { LinearViewer: 'JKershaw/LinearViewer', 'simple-dispatcher': 'JKershaw/simple-dispatcher' };

const result = {};
for (const t of sample) {
  const re = new RegExp(`\\b${t.id}\\b`, 'i');
  result[t.id] = { repos: t.repos, prs: [] };
  for (const repoName of t.repos) {
    const repo = REPOS[repoName];
    const prs = gh(['pr', 'list', '-R', repo, '--state', 'merged', '--search', t.id, '--limit', '30', '--json', 'number,title,headRefName,body,mergedAt']);
    let mine = prs.filter((p) => re.test(p.headRefName) || re.test(p.title));
    if (!mine.length) mine = prs.filter((p) => re.test((p.body || '').slice(0, 600)));
    for (const p of mine) {
      const runs = gh(['api', `repos/${repo}/actions/runs?branch=${encodeURIComponent(p.headRefName)}&per_page=100`]).workflow_runs
        .filter((r) => r.event === 'pull_request' || r.event === 'push')
        .flatMap((r) => {
          // A re-run replaces its run's conclusion; earlier attempts are read one by one so a red first attempt is not lost.
          const base = { name: r.name, sha: r.head_sha.slice(0, 8), id: r.id };
          const earlier = [];
          for (let a = 1; a < r.run_attempt; a++) { const x = gh(['api', `repos/${repo}/actions/runs/${r.id}/attempts/${a}`]); earlier.push({ ...base, conclusion: x.conclusion, at: x.run_started_at || x.created_at, attempt: a }); }
          return [...earlier, { ...base, conclusion: r.conclusion, at: r.run_started_at || r.created_at, attempt: r.run_attempt }];
        })
        .sort((a, b) => a.at.localeCompare(b.at) || a.attempt - b.attempt);
      const shas = [...new Set(runs.map((r) => r.sha))];
      const red = runs.filter((r) => r.conclusion === 'failure').map((r) => {
        const laterSame = runs.find((x) => x.sha === r.sha && (x.at > r.at || x.attempt > r.attempt) && x.name === r.name && x.conclusion === 'success');
        const laterGreen = runs.find((x) => x.at > r.at && x.name === r.name && x.conclusion === 'success');
        return { ...r, outcome: laterSame ? 're-run green' : laterGreen ? 'fixed by a commit' : 'never green' };
      });
      result[t.id].prs.push({ repo: repoName, number: p.number, branch: p.headRefName, mergedAt: p.mergedAt, runs: runs.length, commitsRun: shas.length, red });
    }
  }
  const reds = result[t.id].prs.flatMap((p) => p.red);
  console.log(t.id, `prs=${result[t.id].prs.length}`, `red=${reds.length}`, reds.map((r) => `${r.name}:${r.outcome}`).join('; '));
}
writeFileSync(out, JSON.stringify(result, null, 1));
