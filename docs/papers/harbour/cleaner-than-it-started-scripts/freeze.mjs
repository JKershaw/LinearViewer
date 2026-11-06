#!/usr/bin/env node
// freeze.mjs — LIN-4315. Reads the workspace API and git ONCE, and freezes the raw answers
// into a dated evidence folder. analyse.mjs reads that folder alone (no network, no git).
//
// Usage (LinearViewer root, with HARBOUR_LOCAL_BASE set):
//   node docs/papers/harbour/cleaner-than-it-started-scripts/freeze.mjs <out-dir> --inputs <file.json> [--sd <simple-dispatcher path>]
// Every version's pins, ticket lists and expectations come from the inputs file (inputs-v1.json for v1).
// Why v1's inputs live in this folder and not in v1's evidence folder: see inputs.mjs.
//
// Before anything is written, GET /instructions must have the shape the freeze depends on (INSTRUCTIONS_CONTRACT
// below). If it does not, the freeze stops; it never guesses a shape.
//
// Order (the blind ticket is read FIRST, before anything else moves):
//   1. The blind ticket's comments (LIN-4150 for v1), raw, with read_at; assertions on its blind passes.
//   2. git merge lists for both repos, pinned to the shas below (never origin/main). With inputs that name an
//      oct_merges window, the pair-baseline's Oct merge list too, with the files each merge touches.
//   3. issue/ and cost/ and dispatch/ for every ticket named in those merge subjects, plus parents.
//   4. prompts/ for every custom (after-answer) dispatch since the window start.
// Every response is written raw with its read_at. A non-200 or an {error} body is retried and never saved as
// data; a fetch that cannot be made clean throws. A response flagged truncated.comments === true throws: the
// freeze never asserts a count of comments, it reads the proxy's own flag.
// A blind.comment_cutoff in the inputs (v2 only) keeps comments after it in the raw files but leaves them out
// of every count, and the manifest records how many were posted after it.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { takeInputs, need, blindCutoff, postsAfter } from './inputs.mjs';

// The lines of GET /instructions that the freeze relies on: the issue read, its truncation flag, the cost read,
// the dispatch list and the dispatch prompt. The document is text/plain markdown, so "shape" means these
// documented contract lines are present. If the proxy changes them, the freeze stops.
export const INSTRUCTIONS_CONTRACT = [
  'GET https://harbour.cat/api/proxy/issues/{issueId}',
  'top-level "truncated": { "comments": true } object; the key is absent when',
  'GET https://harbour.cat/api/proxy/issues/{identifier}/cost',
  'GET https://harbour.cat/api/proxy/dispatch?issueIdentifier=',
  'GET https://harbour.cat/api/proxy/dispatch/{id}/prompt',
];

export function checkInstructions(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('GET /instructions returned an empty body; the freeze needs the documented API contract and will not guess it');
  }
  const missing = INSTRUCTIONS_CONTRACT.filter((line) => !text.includes(line));
  if (missing.length) {
    throw new Error(`GET /instructions does not have the expected shape: missing ${missing.map((m) => JSON.stringify(m)).join(', ')}. The freeze stops rather than guess.`);
  }
}

// A response whose comment list the proxy cut is not a complete read: stop, do not count.
export function assertNotTruncated(body, label) {
  if (body && typeof body === 'object' && body.truncated && body.truncated.comments === true) {
    throw new Error(`${label} is flagged truncated.comments === true: the proxy cut its comment list, so the freeze would be incomplete. The freeze stops; it does not assert a count.`);
  }
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..', '..');

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { inputs: I, positional } = takeInputs(process.argv.slice(2), 'freeze.mjs <out-dir> [--sd <path>]');
  const TICKET = need(I, 'ticket');
  const WINDOW_START = need(I, 'window_start');
  const LV_PIN = need(I, 'lv_pin');   // LinearViewer main at grounded_at
  const SD_PIN = need(I, 'sd_pin');   // simple-dispatcher main at grounded_at
  const PARENTS = need(I, 'parents');
  const BLIND = need(I, 'blind');     // { ticket, expected_passes, expected_batches, sessions, ... }
  // Ledger rows that are not in the window's merges: the 3 Nov baseline rows (blind batches A-D), the UI four
  // (context rows), and tickets folded into a later merge's subject. The blind ticket and a backlog residue
  // are frozen as context, not as rows.
  const BASELINE_3NOV = need(I, 'baseline_3nov_ids');
  const BASELINE_3NOV_WINDOW = need(I, 'baseline_3nov_window');
  const BASELINE_3NOV_FILE = need(I, 'baseline_3nov_file');
  const UI_FOUR = need(I, 'ui_four');
  const FOLDED = need(I, 'folded');
  const CONTEXT = need(I, 'context');
  const PACE_MS = I.pace_ms ?? 1100;  // proxy limit 60/min; an inputs file may name a different pace (tests do)
  const cutoffMs = blindCutoff(I);
  // Pair-baseline inputs (LIN-4334, v2). Absent for v1, so v1's freeze reads none of them.
  const PAIR = I.pair_baseline ?? null;
  const PAIR_TICKETS = I.pair_baseline_tickets ?? [];

  const outDir = positional[0];
  if (!outDir || outDir.startsWith('--')) { console.error('usage: freeze.mjs <out-dir> --inputs <file.json> [--sd <path>]'); process.exit(2); }
  const sdArg = positional.indexOf('--sd');
  const SD_ROOT = sdArg > 0 ? path.resolve(positional[sdArg + 1]) : path.resolve(REPO_ROOT, '..', 'simple-dispatcher');
  const BASE = process.env.HARBOUR_LOCAL_BASE;
  if (!BASE) { console.error('HARBOUR_LOCAL_BASE is not set'); process.exit(2); }
  const API = `${BASE}/api/proxy`;

  // ---- 0. the API contract the freeze reads: checked before anything is written ----
  const instructions = await fetch(`${API}/instructions`);
  const instructionsText = await instructions.text();
  if (instructions.status !== 200) throw new Error(`GET /instructions returned ${instructions.status}; the freeze stops rather than guess the API`);
  checkInstructions(instructionsText);

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
      if (res.status === 200 && clean) {
        assertNotTruncated(body, urlPath);
        return { status: res.status, readAt, text, body };
      }
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

  // ---- 1. the blind ticket first: its comment list is the one the proxy cuts ----
  const l4150 = await getJson(`/issues/${BLIND.ticket}`);
  save(`comments/${BLIND.ticket}.json`, l4150.text, l4150.readAt, l4150.status);
  const comments = l4150.body.comments?.nodes ?? l4150.body.comments ?? [];
  const blind = comments.filter((c) => /^## Blind place scoring/.test(c.body || ''));
  const counted = blind.filter((c) => !postsAfter(c.createdAt, cutoffMs));   // comments after a cutoff are not counted
  const countedLabels = counted.map((c) => c.body.split('\n')[0].replace(/^## Blind place scoring, /, ''));
  if (counted.length !== BLIND.expected_passes) {
    throw new Error(`expected ${BLIND.expected_passes} blind passes on ${BLIND.ticket}${cutoffMs !== null ? ' up to the cutoff' : ''}, found ${counted.length}`);
  }
  for (const b of BLIND.expected_batches) if (!countedLabels.some((l) => l.startsWith(`batch ${b}`))) throw new Error(`batch ${b} missing`);
  process.stderr.write(`${BLIND.ticket}: ${comments.length} comments, ${blind.length} blind passes, ${counted.length} counted, batches ${BLIND.expected_batches.join('-')} present\n`);

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
  const baselineLog = git(REPO_ROOT, ['log', '--first-parent', LV_PIN, `--since=${BASELINE_3NOV_WINDOW.since}`, `--until=${BASELINE_3NOV_WINDOW.until}`, '--format=%H|%h|%cI|%s']);
  saveGit(BASELINE_3NOV_FILE, ['full_sha\tshort\tcommitted\tsubject', ...baselineLog.trim().split('\n').filter(Boolean).map((l) => l.split('|').join('\t'))].join('\n') + '\n');
  for (const line of baselineLog.split('\n').filter(Boolean)) {
    for (const m of line.matchAll(/\bLIN-(\d+)\b/g)) if (BASELINE_3NOV.includes(`LIN-${m[1]}`)) subjectIds.add(`LIN-${m[1]}`);
  }

  // The pair-baseline's Oct merge list (LIN-4333 v2): written only when the inputs name one. Each merge carries
  // the files it touches, frozen as a list, so analysis never needs git. code-blind reads it only when named too.
  if (I.oct_merges) {
    const o = need(I, 'oct_merges');   // { since, until, file }
    const shas = git(REPO_ROOT, ['log', '--first-parent', LV_PIN, `--since=${o.since}`, `--until=${o.until}`, '--format=%H%x09%h%x09%cI%x09%s'])
      .trim().split('\n').filter(Boolean);
    const rows = shas.map((line) => {
      const [full, short, committed, ...subject] = line.split('\t');
      const touched = git(REPO_ROOT, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', full])
        .trim().split('\n').filter(Boolean).join(',');
      return [full, short, committed, subject.join('\t'), touched].join('\t');
    });
    saveGit(o.file, ['full_sha\tshort\tcommitted\tsubject\tfiles', ...rows].join('\n') + '\n');
  }
  // The pair rule's own text (LIN-4334 v2): the log at the pin, and the two branch-only commits that fixed the rule
  // and its result, frozen as text because they are not on main. Read only when the inputs name a pair_baseline.
  if (PAIR) {
    saveGit('git/log.at-pin.snapshot', git(REPO_ROOT, ['show', `${LV_PIN}:docs/plans/survey/log.md`]));
    for (const sha of PAIR.rule_commits) {
      const full = git(REPO_ROOT, ['rev-parse', sha]).trim();
      const patch = git(REPO_ROOT, ['show', '--format=%H%n%cI%n%s', '--patch', full]);
      saveGit(`git/pair-rule-${full.slice(0, 8)}.patch`, patch);
    }
  }

  const extras = [...BASELINE_3NOV, ...UI_FOUR, ...FOLDED, ...CONTEXT, ...PAIR_TICKETS];
  const population = [...new Set([...subjectIds, ...PARENTS, ...extras])].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  // Every ledger id must be frozen. Only CONTEXT ids may be absent from the merge subjects.
  const unexplained = [...ledgerIds].filter((id) => !population.includes(id));
  if (unexplained.length) throw new Error(`ledger ids not frozen: ${unexplained.join(', ')}`);
  saveGit('git/population.txt', population.join('\n') + '\n');

  // ---- 3. per ticket: issue, cost, dispatch history ----
  const dispatchRows = {};
  // LIN-4334 decision: the pair-baseline tickets are read for their issue only. Their cost and dispatch history
  // are not frozen, because the pair claim uses only the merges and the passes.
  const issueOnly = new Set(PAIR_TICKETS.filter((id) => !subjectIds.has(id)));
  for (const id of population) {
    const iss = await getJson(`/issues/${id}`);
    save(`issue/${id}.json`, iss.text, iss.readAt, iss.status);
    if (issueOnly.has(id)) {
      dispatchRows[id] = [];
      process.stderr.write(`${id}: state=${iss.body.state?.name} (pair-baseline ticket: issue only)\n`);
      continue;
    }
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

  const linear150 = { count: comments.length, blind_passes: blind.length, batch_a_to_d_present: true };
  if (cutoffMs !== null) {
    linear150.after_cutoff = {
      cutoff: BLIND.comment_cutoff,
      comments: comments.filter((c) => postsAfter(c.createdAt, cutoffMs)).length,
      blind_passes: blind.length - counted.length,
    };
  }
  const manifest = {
    ticket: TICKET,
    window_start: WINDOW_START,
    freeze_finished_at: new Date().toISOString(),
    read_time_note: 'Each file carries its own read_at in this manifest; that is the read time of record.',
    repos: repoHeads,
    population_rule: 'LIN ids named in first-parent merge subjects since the window start, up to each pin, plus PARENTS',
    population: population,
    population_count: population.length,
    parents: PARENTS,
    ledger_ids_not_in_merge_subjects: notInMerges,
    linear_150_comments: linear150,
    custom_prompts: promptCount,
    files,
  };
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.error(`frozen ${population.length} tickets, ${files.length} files into ${outDir}`);
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
