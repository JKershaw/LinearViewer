// LIN-3147: CI suite wall-clock per ISO week — median workflow run on pushes to main, and the per-job durations of each week's last green run — from GitHub Actions history via the gh CLI.
// Usage: node scripts/survey-growth-ci.mjs <owner/repo> <workflow-file> [--json]
import { execFileSync } from 'child_process';
import { isoWeek } from './survey-growth-tracker.mjs';

const [repo, workflow] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const gh = (path) => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', path], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mins = (a, b) => (new Date(b) - new Date(a)) / 60000;

// The runs listing stops at 1,000 results, so page it one month at a time.
const months = Array.from({ length: 10 }, (_, i) => { const a = new Date(Date.UTC(2026, i, 1)), b = new Date(Date.UTC(2026, i + 1, 0)); return `${a.toISOString().slice(0, 10)}..${b.toISOString().slice(0, 10)}`; });
const runs = months.flatMap((range) => gh(`repos/${repo}/actions/workflows/${workflow}/runs?branch=main&event=push&per_page=100&created=${range}`))
  .flatMap((p) => p.workflow_runs)
  .filter((r) => r.conclusion === 'success' && r.run_attempt === 1);

const byWeek = {};
for (const r of runs) (byWeek[isoWeek(r.run_started_at)] ||= []).push(r);
const rows = [];
for (const week of Object.keys(byWeek).sort()) {
  const rs = byWeek[week].sort((a, b) => a.run_started_at.localeCompare(b.run_started_at));
  const last = rs.at(-1);
  // Job durations of the week's last green run; the slowest job bounds the suite's wall-clock.
  const jobs = gh(`repos/${repo}/actions/runs/${last.id}/jobs?per_page=100`).flatMap((p) => p.jobs)
    .filter((j) => j.started_at && j.completed_at && j.conclusion === 'success')
    .map((j) => ({
      name: j.name, minutes: +mins(j.started_at, j.completed_at).toFixed(2),
      // One suite pass: the longest step that runs unit tests (LIN-1880 made CI run the unit suite twice from 4 September).
      unitStepMinutes: Math.max(0, ...(j.steps || []).filter((st) => /unit tests|npm test|node --test/i.test(st.name) && st.started_at && st.completed_at).map((st) => +mins(st.started_at, st.completed_at).toFixed(2))) || null,
    }));
  rows.push({
    week, greenRuns: rs.length,
    medianRunMinutes: +median(rs.map((r) => mins(r.run_started_at, r.updated_at))).toFixed(2),
    lastRun: last.id, jobs,
  });
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ repo, workflow, runs: runs.length, rows }));
else {
  console.log(`${repo} ${workflow}: ${runs.length} green first-attempt push runs on main`);
  for (const r of rows) console.log(`${r.week} runs=${String(r.greenRuns).padStart(3)} median=${String(r.medianRunMinutes).padStart(6)}m  ${r.jobs.map((j) => `${j.name}=${j.minutes}`).join(' ')}`);
}
