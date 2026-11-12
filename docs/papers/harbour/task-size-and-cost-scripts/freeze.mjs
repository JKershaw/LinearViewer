#!/usr/bin/env node
// freeze.mjs — LIN-4257 (v1), with the LIN-4426 inputs and dispatch attribution. Reads the workspace API once and freezes
// the raw answers into a dated evidence folder. Network is used ONLY here; analyse.mjs reads the frozen folder alone.
//
// Usage (from the LinearViewer root, with HARBOUR_LOCAL_BASE set):
//   node docs/papers/harbour/task-size-and-cost-scripts/freeze.mjs <out-dir> [--sd <simple-dispatcher path>] [--pairs] [--inputs <file.json>]
//
// Inputs (LIN-4426): window, LIN range floor, pair tickets, ticket, attribution and the custom-founded coding all come from
// an inputs file, read through the sibling's takeInputs/need (cleaner-than-it-started-scripts/inputs.mjs, imported, not
// edited). Without --inputs the default is inputs-v1.json beside this script, but only where <out-dir> (and, with --pairs,
// <out-dir>/pairs) holds no inputs.json of its own (dispatch-legs.mjs, takeTaskSizeInputs). The sibling's assertNotTruncated
// is imported from its freeze.mjs; it is the same check on the same proxy field.
//
// Attribution (inputs.attribution):
//   "lineage"  — v1's freeze, unchanged: the prompt of each custom /dispatch row dispatched in the window.
//   "dispatch" — the prompt of every custom dispatch listed in each /cost lineage's dispatches. Each one is checked:
//                a kind the proxy did not send (defaulted to custom) is refused, drifted after-answer wording is refused,
//                a kind missing from BUCKET_OF_KIND is refused, an uncoded custom-founded lineage is refused, and a
//                truncated /dispatch or issue read is refused. A failed prompt read stops the freeze (no partial manifest).
//
// Population: LIN ids named in commits of either repo since window start (all refs), plus LIN-<lin_range_floor> .. the newest
// id seen at freeze. Each candidate is checked with GET /dispatch?issueIdentifier=; it is kept if any row was dispatched in the
// window. Every response is written raw, with its read time. A response that is not HTTP 200, or whose JSON has a top-level
// "error" key, is retried (429 backs off) and never saved as data.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { need } from '../cleaner-than-it-started-scripts/inputs.mjs';
import { assertNotTruncated } from '../cleaner-than-it-started-scripts/freeze.mjs';
import { takeTaskSizeInputs, checkAfterWording, firstLineOf, lineageBucketOf, bucketOfKind, isSurveyKind } from './dispatch-legs.mjs';

const PACE_DEFAULT_MS = 1100;          // proxy limit is 60/min; 429s seen in research
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..', '..');

const outArg = process.argv[2];
if (!outArg || outArg.startsWith('--')) { console.error('usage: freeze.mjs <out-dir> [--sd <path>] [--pairs] [--inputs <file.json>]'); process.exit(2); }
const pairsMode = process.argv.includes('--pairs');
const outDir = pairsMode ? path.join(outArg, 'pairs') : outArg;
const { inputs, inputsPath } = takeTaskSizeInputs(process.argv.slice(2), 'freeze.mjs <out-dir> [--sd <path>] [--pairs]', [outArg, path.join(outArg, 'pairs')]);

const TICKET = need(inputs, 'ticket');
const ATTRIBUTION = need(inputs, 'attribution');
if (ATTRIBUTION !== 'lineage' && ATTRIBUTION !== 'dispatch') throw new Error(`inputs attribution is "${ATTRIBUTION}"; it must be "lineage" or "dispatch"`);
const DISPATCH = ATTRIBUTION === 'dispatch';
const WINDOW_START = need(inputs, 'window_start');
const LIN_RANGE_FLOOR = need(inputs, 'lin_range_floor');
const CODING = need(inputs, 'custom_founded_legs');
// The pair tickets, in the order the pair sets name them (tidy, then its follow-up).
const PAIR_TICKETS = need(inputs, 'pair_sets').flatMap((p) => [p.tidy, p.follow]).filter(Boolean);
// Optional: a test may set it to 0. The live freeze leaves it out, so the proxy pace stays at 1100 ms.
const PACE_MS = inputs.pace_ms ?? PACE_DEFAULT_MS;

const sdArg = process.argv.indexOf('--sd');
const SD_ROOT = sdArg > 0 ? path.resolve(process.argv[sdArg + 1]) : path.resolve(REPO_ROOT, '..', 'simple-dispatcher');
const BASE = process.env.HARBOUR_LOCAL_BASE;
if (!BASE) { console.error('HARBOUR_LOCAL_BASE is not set'); process.exit(2); }
const API = `${BASE}/api/proxy`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

// A list response flagged truncated is not a complete read: stop, do not count (dispatch attribution only).
function assertListNotTruncated(body, label) {
  if (body && typeof body === 'object' && body.truncated === true) {
    throw new Error(`${label} is flagged truncated: the proxy cut its list, so the freeze would be incomplete. The freeze stops; it does not assert a count.`);
  }
}

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

async function main() {
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
    if (DISPATCH) assertListNotTruncated(r.body, `/dispatch?issueIdentifier=${id}`);
    const items = r.body.items || [];
    const inWindow = items.some((i) => i.dispatchedAt && i.dispatchedAt >= WINDOW_START);
    if (!inWindow && !pairsMode) { notInWindow.push(id); continue; }
    save(`dispatch/${id}.json`, r.text, r.readAt, r.status);
    dispatchRowsByTicket.set(id, items);
    population.push(id);
    process.stderr.write(`dispatch ${id}: in window (${items.length} rows)\n`);
  }

  // ---- per population ticket: state, cost, and the custom prompts ----
  const costSummary = {};
  for (const id of population) {
    const iss = await getJson(`/issues/${id}`);
    if (DISPATCH) assertNotTruncated(iss.body, `/issues/${id}`);
    save(`issue/${id}.json`, iss.text, iss.readAt, iss.status);
    const c = await getJson(`/issues/${id}/cost`);
    save(`cost/${id}.json`, c.text, c.readAt, c.status);
    costSummary[id] = { state: iss.body.state?.name ?? null, totalUsd: c.body.totalUsd ?? null, unpriced: c.body.unpriced ?? [], noLineage: c.body.noLineage ?? null };
    if (DISPATCH) {
      await freezeDispatchPrompts(id, c.body, save);
    } else {
      for (const row of dispatchRowsByTicket.get(id)) {
        if (row.kind !== 'custom' || !row.dispatchedAt || row.dispatchedAt < WINDOW_START) continue;
        const p = await getJson(`/dispatch/${row.id}/prompt`);
        const firstLine = String(p.body?.prompt ?? '').split('\n').find((l) => l.trim()) ?? '';
        save(`prompts/${row.id}.json`, p.text, p.readAt, p.status);
        process.stderr.write(`  custom ${row.id} (${id}): ${firstLine.slice(0, 60)}\n`);
      }
    }
    process.stderr.write(`cost ${id}: totalUsd=${c.body.totalUsd} state=${costSummary[id].state}\n`);
  }

  const manifest = {
    ticket: TICKET,
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
    ...(DISPATCH ? { attribution: ATTRIBUTION, inputs: { path: path.relative(REPO_ROOT, inputsPath), sha256: sha256(readFileSync(inputsPath, 'utf8')) } } : {}),
    files: files,
  };
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.error(`frozen ${population.length} tickets into ${outDir}`);
}

// Dispatch attribution: every /cost lineage is checked, and the prompt of every custom dispatch in it is frozen. Each
// refusal throws, so a freeze that cannot classify a dispatch writes no manifest.
async function freezeDispatchPrompts(id, cost, save) {
  for (const w of cost.workerSessions) {
    lineageBucketOf(w, CODING);                       // an uncoded custom-founded lineage, or an unmapped kind, throws
    if (w.dispatches === null) continue;              // a lineage with no split has no dispatch to read; analyse marks it approximate
    for (const d of w.dispatches) {
      if (d.kind !== 'custom') {
        if (!isSurveyKind(d.kind)) bucketOfKind(d.kind);   // a kind missing from BUCKET_OF_KIND throws here, not in analyse
        continue;
      }
      const label = `${d.itemId} (${id})`;
      const p = await getJson(`/dispatch/${d.itemId}/prompt`);
      // The prompt read carries the proxy's own kind. A kind it did not send is defaulted to "custom" in /cost: refuse it.
      if (p.body.kind !== 'custom') {
        throw new Error(`${label}: /cost says kind "custom" but the prompt read says ${JSON.stringify(p.body.kind ?? null)}. A kind the proxy did not send is defaulted to custom; refusing the freeze.`);
      }
      checkAfterWording(firstLineOf(p.body.prompt), label);
      save(`prompts/${d.itemId}.json`, p.text, p.readAt, p.status);
    }
  }
}

await main();
