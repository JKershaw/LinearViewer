// LIN-3168: systematic sample of GREEN LinearViewer CI runs, reading each E2E shard's log for tests Playwright marked flaky (failed, then passed on an in-job retry).
// Usage: node scripts/survey-flakes-green-sample.mjs [runs=data/survey-flakes/ci-runs.json] [--since 2026-07-03] [--every 8] [--out data/survey-flakes/green] [--concurrency 3]
// Only green runs whose logs are still retained (about 90 days) are readable, so --since defaults to the retention horizon. Cached runs are skipped.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const since = arg('--since', '2026-07-03');
const every = Number(arg('--every', '8'));
const outDir = arg('--out', 'data/survey-flakes/green');
const concurrency = Number(arg('--concurrency', '3'));
const snapshot = JSON.parse(readFileSync(argv[0] || 'data/survey-flakes/ci-runs.json', 'utf8'));
mkdirSync(outDir, { recursive: true });

const gh = async (args) => (await run('gh', args, { encoding: 'utf8', maxBuffer: 1 << 30 })).stdout;

// The list reporter's end summary: "  N flaky" followed by one indented "[project] › file:line:col › title" line per flaky test.
export function parseSummary(raw) {
  const lines = raw.split('\n').map((l) => l.replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ''));
  const counts = {}; const flaky = []; let section = null;
  for (const text of lines) {
    let m;
    if ((m = text.match(/^\s+(\d+) (failed|flaky|passed|skipped|did not run|interrupted)\b/))) { counts[m[2]] = Number(m[1]); section = m[2]; continue; }
    if (section === 'flaky' && (m = text.match(/^\s+(?:\[([^\]]+)\] › )?(\S+?\.spec\.[jt]s):(\d+):\d+ › (.+?)\s*$/))) {
      flaky.push({ file: `tests/e2e/${m[2].replace(/^(tests\/)?e2e\//, '')}`, title: m[4] });
      continue;
    }
    if (section && !/^\s+\S/.test(text)) section = null;
  }
  return { counts, flaky };
}

const pop = snapshot.repos.LinearViewer.runs.filter((r) => r.conclusion === 'success' && r.created_at >= since);
const sample = pop.filter((_, i) => i % every === 0);
console.log(`green runs since ${since}: ${pop.length}; sampling every ${every}th: ${sample.length}`);

async function fetchRun(r) {
  const path = join(outDir, `${r.id}.json`);
  if (existsSync(path)) return;
  // The final (green) attempt's jobs.
  const jobs = JSON.parse(await gh(['api', `repos/JKershaw/LinearViewer/actions/runs/${r.id}/attempts/${r.run_attempt}/jobs?per_page=100`, '--jq',
    '[.jobs[] | {id, name, conclusion, started_at, completed_at}]']));
  const out = { runId: r.id, event: r.event, branch: r.head_branch, headSha: r.head_sha, createdAt: r.created_at, attempt: r.run_attempt, jobs: [] };
  for (const j of jobs) {
    const row = { name: j.name, conclusion: j.conclusion, seconds: (new Date(j.completed_at) - new Date(j.started_at)) / 1000 };
    if (/^E2E/.test(j.name)) {
      try { Object.assign(row, parseSummary(await gh(['api', `repos/JKershaw/LinearViewer/actions/jobs/${j.id}/logs`])), { log: true }); } catch (e) { row.log = false; row.reason = String(e.message).split('\n')[0].slice(0, 160); }
    }
    out.jobs.push(row);
  }
  writeFileSync(path, JSON.stringify(out, null, 2));
}

const tasks = [...sample]; let done = 0;
const worker = async () => {
  while (tasks.length) {
    const r = tasks.shift();
    try { await fetchRun(r); } catch (e) { console.warn(`${r.id}: ${String(e.message).split('\n')[0]}`); }
    if (++done % 20 === 0) console.log(`${done} runs`);
  }
};
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`done: ${done} runs in ${outDir}`);
