// LIN-3168: fetch job timings and the E2E failure log text for every failed or re-run CI attempt in the run snapshot, one cached JSON per attempt.
// Usage: node scripts/survey-flakes-ci-fetch.mjs [runs=data/survey-flakes/ci-runs.json] [--out data/survey-flakes/detail] [--concurrency 3]
// Population (as survey-tests-ci-fetch.mjs): final conclusion failure, plus final success with run_attempt > 1; every attempt of each. Cached attempts are skipped.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const outDir = arg('--out', 'data/survey-flakes/detail');
const concurrency = Number(arg('--concurrency', '3'));
const snapshot = JSON.parse(readFileSync(argv[0] || 'data/survey-flakes/ci-runs.json', 'utf8'));
mkdirSync(outDir, { recursive: true });

const gh = async (args) => (await run('gh', args, { encoding: 'utf8', maxBuffer: 1 << 30 })).stdout;

// Split a `gh run view --log-failed` line into job, step and the log text after the timestamp.
function splitLine(l) {
  const [job, step, ...rest] = l.split('\t');
  return { job, step, text: rest.join('\t').replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '') };
}

// Playwright's list reporter: per-test failure blocks (`  1) [chromium] › file:line:col › title`), retry markers and the end summary.
export function parsePlaywright(lines) {
  const failures = []; const summary = {}; const flakyListed = []; let cur = null; let section = null;
  for (const { job, text } of lines) {
    let m;
    if ((m = text.match(/^\s+(\d+) (failed|flaky|passed|skipped|did not run|interrupted)\b/))) { summary[m[2]] = Number(m[1]); section = m[2]; continue; }
    if ((section === 'failed' || section === 'flaky') && (m = text.match(/^\s+(?:\[([^\]]+)\] › )?(\S+?\.spec\.[jt]s):(\d+):\d+ › (.+?)\s*$/))) {
      const t = { job, file: `tests/e2e/${m[2].replace(/^(tests\/)?e2e\//, '')}`, line: Number(m[3]), title: m[4] };
      (section === 'failed' ? failures : flakyListed).push(t);
      continue;
    }
    if (section && !/^\s+\S/.test(text)) section = null;
    if ((m = text.match(/^\s+\d+\) (?:\[([^\]]+)\] › )?(\S+?\.spec\.[jt]s):(\d+):\d+ › (.+?)\s*$/))) {
      cur = { job, file: `tests/e2e/${m[2].replace(/^(tests\/)?e2e\//, '')}`, title: m[4].replace(/\s+─+$/, ''), retry: 0, errors: [] };
      failures.__blocks ||= []; failures.__blocks.push(cur);
      continue;
    }
    if (cur && (m = text.match(/Retry #(\d+)/))) { cur.retry = Math.max(cur.retry, Number(m[1])); continue; }
    if (cur && cur.errors.length < 12 && /(Error|Timeout|expect\(|Expected|Received|toHave|toBe|exceeded|waiting for|locator|net::|ECONN|page\.goto|Target .*closed|strict mode)/.test(text)) {
      cur.errors.push(text.trim().slice(0, 240));
    }
  }
  const blocks = failures.__blocks || [];
  delete failures.__blocks;
  return { failures, flakyListed, summary, blocks };
}

async function fetchAttempt(repo, r, attempt) {
  const path = join(outDir, `${repo}-${r.id}-${attempt}.json`);
  if (existsSync(path)) return;
  const base = `repos/JKershaw/${repo}/actions/runs/${r.id}`;
  const meta = JSON.parse(await gh(['api', `${base}/attempts/${attempt}`, '--jq', '{conclusion, head_sha, run_started_at, updated_at}']));
  const jobs = JSON.parse(await gh(['api', `${base}/attempts/${attempt}/jobs?per_page=100`, '--jq',
    '[.jobs[] | {id, name, conclusion, started_at, completed_at, steps: [.steps[] | {name, conclusion, started_at, completed_at}]}]']));
  const out = { repo, runId: r.id, attempt, event: r.event, branch: r.head_branch, prs: r.pull_requests, headSha: meta.head_sha,
    createdAt: r.created_at, startedAt: meta.run_started_at, updatedAt: meta.updated_at,
    finalConclusion: r.conclusion, finalAttempt: r.run_attempt, conclusion: meta.conclusion, jobs, log: null };
  if (meta.conclusion === 'failure' || meta.conclusion === 'timed_out') {
    try {
      const raw = await gh(['run', 'view', String(r.id), '-R', `JKershaw/${repo}`, '--attempt', String(attempt), '--log-failed']);
      const lines = raw.split('\n').map(splitLine);
      const e2e = lines.filter((l) => /^E2E/.test(l.job));
      const pw = parsePlaywright(e2e);
      // Keep the tail of each failing E2E job (the summary and last error blocks) for hand reading.
      const tails = {};
      for (const l of e2e) (tails[l.job] ||= []).push(l.text);
      for (const k of Object.keys(tails)) tails[k] = tails[k].filter((x) => x.trim()).slice(-400).join('\n').slice(-40000);
      out.log = { available: true, bytes: raw.length, playwright: pw, tails,
        otherErrors: lines.filter((l) => !/^E2E/.test(l.job) && /##\[error\]/.test(l.text)).slice(0, 10).map((l) => `${l.job} | ${l.text.slice(0, 240)}`) };
    } catch (e) {
      out.log = { available: false, reason: String(e.stderr || e.message).split('\n')[0].slice(0, 200) };
    }
  }
  writeFileSync(path, JSON.stringify(out, null, 2));
}

const tasks = [];
for (const [repo, { runs }] of Object.entries(snapshot.repos)) {
  const pop = runs.filter((r) => r.conclusion === 'failure' || (r.conclusion === 'success' && r.run_attempt > 1));
  console.log(`${repo}: ${pop.length} population runs`);
  for (const r of pop) for (let a = 1; a <= r.run_attempt; a++) tasks.push([repo, r, a]);
}
let done = 0;
const worker = async () => {
  while (tasks.length) {
    const [repo, r, a] = tasks.shift();
    try { await fetchAttempt(repo, r, a); } catch (e) { console.warn(`${repo} ${r.id}#${a}: ${String(e.message).split('\n')[0]}`); }
    if (++done % 25 === 0) console.log(`${done} attempts`);
  }
};
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`done: ${done} attempts in ${outDir}`);
