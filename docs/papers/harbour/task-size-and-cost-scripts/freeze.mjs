#!/usr/bin/env node
// freeze.mjs — LIN-4257. Reads the workspace API once and freezes the raw answers
// into a dated evidence folder. Network is used ONLY here; analyse.mjs reads the
// frozen folder alone.
//
// Usage (from the LinearViewer root, with HARBOUR_LOCAL_BASE set):
//   node docs/papers/harbour/task-size-and-cost-scripts/freeze.mjs <out-dir> [--sd <simple-dispatcher path>]
//
// Population: LIN ids named in commits of either repo since WINDOW_START (all refs),
// plus LIN-4170 .. the newest id seen at freeze. Each candidate is checked with
// GET /dispatch?issueIdentifier=; it is kept if any row was dispatched in the window.
// Every response is written raw, with its read time. A response that is not HTTP 200,
// or whose JSON has a top-level "error" key, is retried (429 backs off) and never saved
// as data.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WINDOW_START = '2026-11-04T05:00:00Z';
const LIN_RANGE_FLOOR = 4170;
const PACE_MS = 1100;                  // proxy limit is 60/min; 429s seen in research
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..', '..');

// --pairs: re-read only the natural-experiment tickets, last, into <out-dir>/pairs/ with
// their own manifest. Their states are the read at that time, not the population freeze's.
const PAIR_TICKETS = ['LIN-4253', 'LIN-4251', 'LIN-4252', 'LIN-4246', 'LIN-4255', 'LIN-4254', 'LIN-4247', 'LIN-4201', 'LIN-4226'];
const pairsMode = process.argv.includes('--pairs');
const outArg = process.argv[2];
if (!outArg || outArg.startsWith('--')) { console.error('usage: freeze.mjs <out-dir> [--sd <path>] [--pairs]'); process.exit(2); }
const outDir = pairsMode ? path.join(outArg, 'pairs') : outArg;
const sdArg = process.argv.indexOf('--sd');
const SD_ROOT = sdArg > 0 ? path.resolve(process.argv[sdArg + 1]) : path.resolve(REPO_ROOT, '..', 'simple-dispatcher');
const BASE = process.env.HARBOUR_LOCAL_BASE;
if (!BASE) { console.error('HARBOUR_LOCAL_BASE is not set'); process.exit(2); }
const API = `${BASE}/api/proxy`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

let lastCall = 0;
async function getJson(urlPath) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const wait = PACE_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const readAt = new Date().toISOString();
    const res = await fetch(`${API}${urlPath}`);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* handled below */ }
    if (res.status === 429) { await sleep(2000 * attempt); continue; }
    if (res.status === 200 && body && typeof body === 'object' && !Array.isArray(body) && !('error' in body)) {
      return { status: res.status, readAt, text, body };
    }
    if (res.status === 200 && Array.isArray(body)) return { status: res.status, readAt, text, body };
    await sleep(1000 * attempt);
  }
  throw new Error(`could not read ${urlPath} cleanly after retries`);
}

// ---- population ----
const commitIds = new Set();
const repoHeads = {};
for (const [name, repo] of [['LinearViewer', REPO_ROOT], ['simple-dispatcher', SD_ROOT]]) {
  repoHeads[name] = {
    path: path.relative(REPO_ROOT, repo) || '.',
    head: git(repo, ['rev-parse', 'HEAD']).trim(),
    origin_main: git(repo, ['rev-parse', 'origin/main']).trim(),
    commits_in_window: git(repo, ['log', '--all', `--since=${WINDOW_START}`, '--format=%H']).trim().split('\n').filter(Boolean).length,
  };
  for (const m of git(repo, ['log', '--all', `--since=${WINDOW_START}`, '--format=%s']).matchAll(/\bLIN-(\d+)\b/g)) {
    commitIds.add(Number(m[1]));
  }
}

const newestSeen = await getJson('/dispatch');          // newest rows (no filter)
const dispatchMax = Math.max(0, ...newestSeen.body.items.map((i) => Number((i.issueIdentifier || '').replace('LIN-', '')) || 0));
const top = Math.max(0, ...commitIds, dispatchMax);
const candidates = new Set();
for (const n of commitIds) candidates.add(n);
for (let n = LIN_RANGE_FLOOR; n <= top; n++) candidates.add(n);
const candidateList = pairsMode ? PAIR_TICKETS : [...candidates].sort((a, b) => a - b).map((n) => `LIN-${n}`);

mkdirSync(path.join(outDir, 'dispatch'), { recursive: true });
mkdirSync(path.join(outDir, 'cost'), { recursive: true });
mkdirSync(path.join(outDir, 'issue'), { recursive: true });
mkdirSync(path.join(outDir, 'prompts'), { recursive: true });

const files = [];
const save = (rel, text, readAt, status) => {
  writeFileSync(path.join(outDir, rel), text);
  files.push({ path: rel, bytes: Buffer.byteLength(text), sha256: sha256(text), read_at: readAt, http_status: status });
};

// ---- per candidate: dispatch history, keep the window population ----
const population = [];
const notInWindow = [];
const dispatchRowsByTicket = new Map();
for (const id of candidateList) {
  const r = await getJson(`/dispatch?issueIdentifier=${id}`);
  const items = r.body.items || [];
  const inWindow = items.some((i) => i.dispatchedAt && i.dispatchedAt >= WINDOW_START);
  if (!inWindow && !pairsMode) { notInWindow.push(id); continue; }
  save(`dispatch/${id}.json`, r.text, r.readAt, r.status);
  dispatchRowsByTicket.set(id, items);
  population.push(id);
  process.stderr.write(`dispatch ${id}: in window (${items.length} rows)\n`);
}

// ---- per population ticket: state, cost, and custom follow-up prompt first lines ----
const costSummary = {};
for (const id of population) {
  const iss = await getJson(`/issues/${id}`);
  save(`issue/${id}.json`, iss.text, iss.readAt, iss.status);
  const c = await getJson(`/issues/${id}/cost`);
  save(`cost/${id}.json`, c.text, c.readAt, c.status);
  costSummary[id] = { state: iss.body.state?.name ?? null, totalUsd: c.body.totalUsd ?? null, unpriced: c.body.unpriced ?? [], noLineage: c.body.noLineage ?? null };
  for (const row of dispatchRowsByTicket.get(id)) {
    if (row.kind !== 'custom' || !row.dispatchedAt || row.dispatchedAt < WINDOW_START) continue;
    const p = await getJson(`/dispatch/${row.id}/prompt`);
    const firstLine = String(p.body?.prompt ?? '').split('\n').find((l) => l.trim()) ?? '';
    save(`prompts/${row.id}.json`, p.text, p.readAt, p.status);
    process.stderr.write(`  custom ${row.id} (${id}): ${firstLine.slice(0, 60)}\n`);
  }
  process.stderr.write(`cost ${id}: totalUsd=${c.body.totalUsd} state=${costSummary[id].state}\n`);
}

const manifest = {
  ticket: 'LIN-4257',
  mode: pairsMode ? 'pairs (natural-experiment re-read, last)' : 'population',
  window_start: WINDOW_START,
  freeze_finished_at: new Date().toISOString(),
  read_time_note: 'Each file carries its own read_at; that is the read time of record.',
  repos: repoHeads,
  candidate_rule: `commit ids (--all, since window start) union LIN-${LIN_RANGE_FLOOR}..newest seen (${top})`,
  candidates: candidateList.length,
  population: population,
  population_count: population.length,
  not_in_window: notInWindow.length,
  dispatch_list_cap_note: 'GET /dispatch returns the newest rows only; used for the newest-id bound, not for enumeration',
  states_at_freeze: costSummary,
  files: files,
};
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.error(`frozen ${population.length} tickets into ${outDir}`);
