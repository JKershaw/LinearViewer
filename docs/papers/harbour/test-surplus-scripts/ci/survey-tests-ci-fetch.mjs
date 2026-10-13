// LIN-3151: fetch jobs, failing steps and parsed failing tests for every failed CI attempt in the run snapshot, caching one JSON per attempt.
// Usage: node scripts/survey-tests-ci-fetch.mjs [runs=data/survey-tests/ci-runs.json] [--out data/survey-tests/ci-detail] [--concurrency 3] [--sample-cap 250]
// Population: final conclusion failure, plus final success with run_attempt > 1 (earlier attempts checked via the attempts API). Cached attempts are skipped, so re-runs resume.
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const outDir = arg('--out', 'data/survey-tests/ci-detail');
const concurrency = Number(arg('--concurrency', '3'));
const sampleCap = Number(arg('--sample-cap', '250'));
const snapshot = JSON.parse(readFileSync(argv[0] || 'data/survey-tests/ci-runs.json', 'utf8'));
mkdirSync(outDir, { recursive: true });

const gh = async (args) => (await run('gh', args, { encoding: 'utf8', maxBuffer: 1 << 30 })).stdout;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Steps that run tests; anything else failing (install, secret scan, Playwright version check, the aggregator) is infra.
const isTestStep = (step) => /^(Run unit tests|Run E2E tests|Unit tests)/.test(step);

// Split a `gh run view --log-failed` line into job, step and the log text after the timestamp.
function splitLine(l) {
  const [job, step, ...rest] = l.split('\t');
  return { job, step, text: rest.join('\t').replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '') };
}

// Parse node:test TAP (`not ok` + YAML location), node:test spec (`test at file:line` / `✖`) and Playwright's end summary.
function parseFailedLog(raw) {
  const lines = raw.split('\n').map(splitLine);
  const tests = []; const errors = []; const summary = [];
  for (let i = 0; i < lines.length; i++) {
    const { job, step, text } = lines[i];
    const tap = text.match(/^(\s*)not ok \d+ - (.*)$/);
    if (tap) {
      const t = { job, step, runner: 'node:test', title: tap[2].trim(), file: null, suite: false, failureType: null, error: null };
      for (let j = i + 1; j < Math.min(lines.length, i + 60); j++) {
        const y = lines[j].text.trim();
        if (y === '...') break;
        let m;
        if ((m = y.match(/^location: '(.+?):\d+:\d+'$/))) t.file = m[1].replace(/^.*?\/(tests?\/)/, '$1');
        else if (y === "type: 'suite'") t.suite = true;
        else if ((m = y.match(/^failureType: '(.+)'$/))) t.failureType = m[1];
        else if ((m = y.match(/^error: (.+)$/)) && !t.error) {
          t.error = /^\|-?$/.test(m[1]) ? lines.slice(j + 1, j + 4).map((x) => x.text.trim()).join(' ') : m[1];
          t.error = t.error.slice(0, 300);
        }
      }
      if (!t.file && /\.test\.m?js$/.test(t.title)) t.file = t.title.replace(/^.*?\/(tests?\/)/, '$1');
      tests.push(t);
      continue;
    }
    const spec = text.match(/^\s*test at (\S+?):\d+:\d+$/);
    if (spec) {
      const next = lines[i + 1]?.text.match(/^\s*✖ (.*?)(?: \([\d.]+m?s\))?$/);
      tests.push({ job, step, runner: 'node:test', title: next ? next[1] : null, file: spec[1].replace(/^.*?\/(tests?\/)/, '$1'), suite: false });
      continue;
    }
    if (/^\s+\d+ failed$/.test(text)) {
      for (let j = i + 1; j < lines.length; j++) {
        const m = lines[j].text.match(/^\s+(?:\[([^\]]+)\] › )?(\S+?\.spec\.[jt]s):\d+:\d+ › (.+?)\s*$/);
        if (!m) break;
        tests.push({ job, step, runner: 'playwright', project: m[1] || null, file: `tests/e2e/${m[2].replace(/^(tests\/)?e2e\//, '')}`, title: m[3], suite: false });
      }
    }
    if (/##\[error\]|\[hermetic\]|^# (tests|pass|fail|cancelled) \d+|Error: Timed out|exceeded the maximum execution time|npm ERR!/.test(text)) {
      (text.includes('##[error]') ? errors : summary).push(`${job} | ${step} | ${text.slice(0, 300)}`);
    }
  }
  const leaves = tests.filter((t) => !t.suite);
  return { tests: leaves.length ? leaves : tests, errors: errors.slice(0, 20), summary: summary.slice(-20) };
}

async function fetchAttempt(repo, r, attempt) {
  const path = join(outDir, `${repo}-${r.id}-${attempt}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const base = `repos/JKershaw/${repo}/actions/runs/${r.id}`;
  const meta = JSON.parse(await gh(['api', `${base}/attempts/${attempt}`, '--jq', '{conclusion, head_sha, run_started_at, updated_at}']));
  const jobs = JSON.parse(await gh(['api', `${base}/attempts/${attempt}/jobs?per_page=100`, '--jq',
    '[.jobs[] | {name, conclusion, steps: [.steps[] | {name, conclusion}]}]']));
  const out = { repo, runId: r.id, attempt, event: r.event, branch: r.head_branch, headSha: meta.head_sha, createdAt: r.created_at,
    finalConclusion: r.conclusion, finalAttempt: r.run_attempt, conclusion: meta.conclusion, jobs, log: null };
  if (meta.conclusion === 'failure' || meta.conclusion === 'timed_out') {
    try {
      await sleep(500);
      const raw = await gh(['run', 'view', String(r.id), '-R', `JKershaw/${repo}`, '--attempt', String(attempt), '--log-failed']);
      out.log = { available: true, bytes: raw.length, ...parseFailedLog(raw) };
    } catch (e) {
      out.log = { available: false, reason: String(e.stderr || e.message).split('\n')[0].slice(0, 200) };
    }
  }
  writeFileSync(path, JSON.stringify(out, null, 2));
  return out;
}

// Every attempt that did not succeed, for each population run.
const tasks = [];
for (const [repo, { runs }] of Object.entries(snapshot.repos)) {
  let pop = runs.filter((r) => r.conclusion === 'failure' || (r.conclusion === 'success' && r.run_attempt > 1));
  if (pop.length > sampleCap) {
    const k = Math.ceil(pop.length / sampleCap);
    console.log(`${repo}: ${pop.length} population runs > ${sampleCap}; systematic sample every ${k}th by date`);
    pop = pop.filter((_, i) => i % k === 0);
  }
  console.log(`${repo}: ${pop.length} population runs`);
  for (const r of pop) {
    const last = r.conclusion === 'failure' ? r.run_attempt : r.run_attempt - 1;
    for (let a = 1; a <= last; a++) tasks.push([repo, r, a]);
  }
}
let done = 0;
const worker = async () => {
  while (tasks.length) {
    const [repo, r, a] = tasks.shift();
    try { await fetchAttempt(repo, r, a); } catch (e) { console.warn(`${repo} ${r.id}#${a}: ${String(e.message).split('\n')[0]}`); }
    if (++done % 10 === 0) console.log(`${done} attempts fetched`);
  }
};
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`done: ${done} attempts in ${outDir}`);
