#!/usr/bin/env node
// freeze.mjs — LIN-4315. Reads the workspace API and git ONCE, and freezes the raw answers
// into a dated evidence folder. analyse.mjs reads that folder alone (no network, no git).
//
// Usage (LinearViewer root, with HARBOUR_LOCAL_BASE set):
//   node docs/papers/harbour/cleaner-than-it-started-scripts/freeze.mjs <out-dir> [--sd <simple-dispatcher path>]
//
// Order (the 50-comment cap means LIN-4150 must be read FIRST, before anything else moves):
//   1. LIN-4150 comments, raw, with read_at; assertions on the 42 blind passes.
//   2. git merge lists for both repos, pinned to the shas below (never origin/main).
//   3. issue/ and cost/ and dispatch/ for every ticket named in those merge subjects, plus parents.
//   4. prompts/ for every custom (after-answer) dispatch since the window start.
// Every response is written raw with its read_at. A non-200 or an {error} body is retried and
// never saved as data; a fetch that cannot be made clean throws.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WINDOW_START = '2026-11-04T00:00:00Z';
export const LV_PIN = '1d10f9b3';   // LinearViewer main at grounded_at
export const SD_PIN = '07c88f7';    // simple-dispatcher main at grounded_at
export const PARENTS = ['LIN-4144', 'LIN-4195', 'LIN-4233', 'LIN-4254', 'LIN-4255', 'LIN-4271'];
// Ledger rows that are not 4 Nov merges: the 3 Nov baseline rows (blind batches A-D), the UI four
// (context rows), and tickets folded into a later merge's subject. LIN-4150 and LIN-4297 are the
// blind-read ticket and a backlog residue; they are frozen as context, not as rows.
export const BASELINE_3NOV = ['LIN-4168', 'LIN-4166', 'LIN-4173', 'LIN-4177'];
export const UI_FOUR = ['LIN-4106', 'LIN-4107', 'LIN-4110', 'LIN-4040'];
export const FOLDED = ['LIN-4142', 'LIN-4114', 'LIN-4188'];
export const CONTEXT = ['LIN-4150', 'LIN-4297'];
const PACE_MS = 1100;               // proxy limit 60/min
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..', '..');

const outDir = process.argv[2];
if (!outDir || outDir.startsWith('--')) { console.error('usage: freeze.mjs <out-dir> [--sd <path>]'); process.exit(2); }
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
    const clean = body && typeof body === 'object' && !('error' in body);
    if (res.status === 200 && clean) return { status: res.status, readAt, text, body };
    await sleep(1000 * attempt);
  }
  throw new Error(`could not read ${urlPath} cleanly after retries`);
}

mkdirSync(outDir, { recursive: true });
for (const d of ['git', 'comments', 'issue', 'cost', 'dispatch', 'prompts']) mkdirSync(path.join(outDir, d), { recursive: true });

const files = [];
const save = (rel, text, readAt, status) => {
  writeFileSync(path.join(outDir, rel), text);
  files.push({ path: rel, bytes: Buffer.byteLength(text), sha256: sha256(text), read_at: readAt, http_status: status });
};
const saveGit = (rel, text) => {
  writeFileSync(path.join(outDir, rel), text);
  files.push({ path: rel, bytes: Buffer.byteLength(text), sha256: sha256(text), read_at: new Date().toISOString(), http_status: 'git' });
};

// ---- 1. LIN-4150 first: the proxy caps an issue read at 50 comments ----
const l4150 = await getJson('/issues/LIN-4150');
save('comments/LIN-4150.json', l4150.text, l4150.readAt, l4150.status);
const comments = l4150.body.comments?.nodes ?? l4150.body.comments ?? [];
const blind = comments.filter((c) => /^## Blind place scoring/.test(c.body || ''));
const blindLabels = blind.map((c) => c.body.split('\n')[0].replace(/^## Blind place scoring, /, ''));
const hasBatchA = blindLabels.some((l) => /^batch A\b/.test(l));
if (comments.length === 50 && !hasBatchA) throw new Error('LIN-4150 is capped at 50 and batch A is missing: freeze cannot recover it');
if (blind.length !== 42) throw new Error(`expected 42 blind passes on LIN-4150, found ${blind.length}`);
for (const b of ['A', 'B', 'C', 'D']) if (!blindLabels.some((l) => l.startsWith(`batch ${b}`))) throw new Error(`batch ${b} missing`);
process.stderr.write(`LIN-4150: ${comments.length} comments, ${blind.length} blind passes, batch A-D present\n`);

// ---- 2. git: pinned merge lists and the shas they stand on ----
const repos = [['LinearViewer', REPO_ROOT, LV_PIN], ['simple-dispatcher', SD_ROOT, SD_PIN]];
const repoHeads = {};
const subjectIds = new Set();
for (const [name, repo, pin] of repos) {
  const full = git(repo, ['rev-parse', pin]).trim();
  const log = git(repo, ['log', '--first-parent', pin, `--since=${WINDOW_START}`, '--format=%H|%h|%cI|%s']);
  saveGit(`git/merges-${name}.tsv`, ['full_sha\tshort\tcommitted\tsubject', ...log.trim().split('\n').filter(Boolean).map((l) => l.split('|').join('\t'))].join('\n') + '\n');
  for (const line of log.split('\n').filter(Boolean)) {
    for (const m of line.matchAll(/\bLIN-(\d+)\b/g)) subjectIds.add(`LIN-${m[1]}`);
  }
  repoHeads[name] = { path: path.relative(REPO_ROOT, repo) || '.', pinned_sha: full, merges_since_window: log.split('\n').filter(Boolean).length };
}
// The place ledger's ticket ids must all be in merge subjects (checked at the LinearViewer pin).
const ledger = git(REPO_ROOT, ['show', `${LV_PIN}:docs/plans/survey/place-ledger.md`]);
// stored as .snapshot, not .md: the docs anchor resolver (LIN-2896) would scan this frozen notebook copy, which cites CLAUDE.md by line.
saveGit('git/place-ledger.at-pin.snapshot', ledger);
const ledgerIds = new Set([...ledger.matchAll(/\bLIN-(\d+)\b/g)].map((m) => `LIN-${m[1]}`));
const notInMerges = [...ledgerIds].filter((id) => !subjectIds.has(id));  // checked against the 4 Nov subjects below
process.stderr.write(`ledger ids ${ledgerIds.size}; not in merge subjects: ${notInMerges.join(', ') || 'none'}\n`);

// 3 Nov baseline merges (the window before the loop's place view): kept as their own git list.
const baselineLog = git(REPO_ROOT, ['log', '--first-parent', LV_PIN, '--since=2026-11-02T00:00Z', '--until=2026-11-04T00:00Z', '--format=%H|%h|%cI|%s']);
saveGit('git/merges-LinearViewer-2026-11-02-03.tsv', ['full_sha\tshort\tcommitted\tsubject', ...baselineLog.trim().split('\n').filter(Boolean).map((l) => l.split('|').join('\t'))].join('\n') + '\n');
for (const line of baselineLog.split('\n').filter(Boolean)) {
  for (const m of line.matchAll(/\bLIN-(\d+)\b/g)) if (BASELINE_3NOV.includes(`LIN-${m[1]}`)) subjectIds.add(`LIN-${m[1]}`);
}
const extras = [...BASELINE_3NOV, ...UI_FOUR, ...FOLDED, ...CONTEXT];
const population = [...new Set([...subjectIds, ...PARENTS, ...extras])].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
// Every ledger id must be frozen. Only CONTEXT ids may be absent from the merge subjects.
const unexplained = [...ledgerIds].filter((id) => !population.includes(id));
if (unexplained.length) throw new Error(`ledger ids not frozen: ${unexplained.join(', ')}`);
saveGit('git/population.txt', population.join('\n') + '\n');

// ---- 3. per ticket: issue, cost, dispatch history ----
const dispatchRows = {};
for (const id of population) {
  const iss = await getJson(`/issues/${id}`);
  save(`issue/${id}.json`, iss.text, iss.readAt, iss.status);
  const cost = await getJson(`/issues/${id}/cost?perDispatch=true`);
  save(`cost/${id}.json`, cost.text, cost.readAt, cost.status);
  const disp = await getJson(`/dispatch?issueIdentifier=${id}`);
  save(`dispatch/${id}.json`, disp.text, disp.readAt, disp.status);
  dispatchRows[id] = disp.body.items || [];
  process.stderr.write(`${id}: state=${iss.body.state?.name} totalUsd=${cost.body.totalUsd} dispatches=${dispatchRows[id].length}\n`);
}

// ---- 4. after-answer prompts: custom dispatches in the window ----
let promptCount = 0;
for (const id of population) {
  for (const row of dispatchRows[id]) {
    if (row.kind !== 'custom' || !row.dispatchedAt || row.dispatchedAt < WINDOW_START) continue;
    const p = await getJson(`/dispatch/${row.id}/prompt`);
    save(`prompts/${row.id}.json`, p.text, p.readAt, p.status);
    promptCount++;
  }
}
process.stderr.write(`custom prompts frozen: ${promptCount}\n`);

const manifest = {
  ticket: 'LIN-4315',
  window_start: WINDOW_START,
  freeze_finished_at: new Date().toISOString(),
  read_time_note: 'Each file carries its own read_at in this manifest; that is the read time of record.',
  repos: repoHeads,
  population_rule: 'LIN ids named in first-parent merge subjects since the window start, up to each pin, plus PARENTS',
  population: population,
  population_count: population.length,
  parents: PARENTS,
  ledger_ids_not_in_merge_subjects: notInMerges,
  linear_150_comments: { count: comments.length, blind_passes: blind.length, batch_a_to_d_present: true },
  custom_prompts: promptCount,
  files,
};
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.error(`frozen ${population.length} tickets, ${files.length} files into ${outDir}`);
