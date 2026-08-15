#!/usr/bin/env node
/**
 * scripts/wall-clock-summary.mjs  (LIN-987)
 *
 * "Where does the time (and effort) go?" — a read-only wall-clock summary of
 * autopilot work, built entirely from data the workspace API proxy already
 * exposes. No schema change, no new instrumentation.
 *
 * Three views (analysis lives in lib/wall-clock-summary.js — pure & unit-tested):
 *   1. LIFECYCLE PHASES — before-the-diff / the-diff / after-the-diff / orchestration.
 *   2. EFFORT breakdown — onboarding / active tool-work / waiting (tests·CI·builds
 *      or think-time) / wrap-up. Answers "how much time is spent waiting on things".
 *   3. SESSIONS — steps sharing a `sessionId` are one autopilot run, rolled up.
 *
 * Coverage: the plain dispatch list returns only the ~100 most-recent rows AND
 * projects away `sessionId`. To widen, this fetches every lifecycle status
 * (taken/blocked/done/failed/aborted/queued), unions + dedupes, then fetches each item's
 * DETAIL (which carries `sessionId` + the full heartbeat `feedback[]`). Detail
 * fetches are rate-limited (proxy cap: 60/min) and cached to disk, so the first
 * run pays ~once and re-runs are instant.
 *
 * Data honesty (verified against the live proxy for LIN-987):
 *  - completion time = terminal-marker time (deriveCompletedAt), not `resolvedAt`.
 *  - `waiting` is a LOWER BOUND — a long single tool inside a heartbeat interval
 *    reads as active (heartbeats can't see within an interval). See the lib.
 *  - Worker token/cost is emitted nowhere today, so this is wall-clock only.
 *
 * Usage:
 *   PROXY_TOKEN=xxx node scripts/wall-clock-summary.mjs            # widened, session view
 *   ... --fast          list-only (recent ~100, no detail fetch, no sessions/effort)
 *   ... --json          machine-readable JSON
 *   ... --issue LIN-42  restrict to one issue
 *   ... --no-cache      ignore the on-disk detail cache
 *   ... --cache <dir>   detail-cache directory (default: $TMPDIR/harbour-wallclock-cache)
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  summarizeSteps, groupBySession, median, BUCKET_ORDER,
} from '../lib/wall-clock-summary.js';

const BUCKET_LABEL = {
  before: 'BEFORE the diff  (idea → spec)',
  diff: 'THE diff         (implementation)',
  after: 'AFTER the diff   (confirm & paperwork)',
  orchestration: 'ORCHESTRATION    (autopilot/wake/custom)',
};
// 'blocked' (LIN-2079) is a DERIVED lifecycle status: a row parked on a human
// reports it INSTEAD of 'taken', so it must be fetched explicitly or the corpus
// loses those rows silently — and the header's "every lifecycle status" claim
// above would quietly stop being true. NOTE: it is deliberately NOT added to the
// `terminal` set below — a blocked run is alive, not finished.
const STATUSES = ['taken', 'blocked', 'done', 'failed', 'aborted', 'queued'];

// ─── args ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { base: process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy',
    token: process.env.PROXY_TOKEN || '', json: false, fast: false, issue: null,
    cache: join(tmpdir(), 'harbour-wallclock-cache'), noCache: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--json') a.json = true;
    else if (v === '--fast') a.fast = true;
    else if (v === '--no-cache') a.noCache = true;
    else if (v === '--token') a.token = argv[++i];
    else if (v === '--base') a.base = argv[++i];
    else if (v === '--issue') a.issue = argv[++i];
    else if (v === '--cache') a.cache = argv[++i];
  }
  return a;
}

// ─── format helpers ─────────────────────────────────────────────────────────
function fmtDur(msVal) {
  if (msVal == null) return '   —   ';
  let s = Math.round(msVal / 1000);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── proxy fetch (widen + detail-enrich, cached + rate-limited) ─────────────
async function getJson(url, token, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`proxy ${res.status} on ${url}: ${await res.text()}`);
    return res.json();
  }
  throw new Error(`rate-limited after ${tries} tries: ${url}`);
}

async function enumerateIds({ base, token, issue }) {
  const ids = new Map(); // id → list-row (has kind/dispatchedAt/completedAt/resolvedAt/status)
  if (issue) {
    const body = await getJson(`${base}/dispatch?issueIdentifier=${encodeURIComponent(issue)}&limit=250`, token);
    for (const it of body.items || []) ids.set(it.id, it);
    return ids;
  }
  for (const st of STATUSES) {
    const body = await getJson(`${base}/dispatch?status=${st}&limit=250`, token);
    for (const it of body.items || []) if (!ids.has(it.id)) ids.set(it.id, it);
  }
  return ids;
}

async function enrich(ids, { base, token, cache, noCache }) {
  if (!noCache) mkdirSync(cache, { recursive: true });
  const out = [];
  const list = [...ids.values()];
  let fetched = 0, cached = 0;
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const cacheFile = join(cache, `${row.id}.json`);
    // A terminal item never changes, so its cached detail is reusable; a still-open
    // (taken/queued) item may have grown feedback, so always re-fetch those.
    const terminal = row.completedAt || ['done', 'failed', 'aborted'].includes(row.status);
    let detail = null;
    if (!noCache && terminal && existsSync(cacheFile)) {
      try { detail = JSON.parse(readFileSync(cacheFile, 'utf8')); cached++; } catch { detail = null; }
    }
    if (!detail) {
      detail = await getJson(`${base}/dispatch/${row.id}`, token);
      if (!noCache && terminal) { try { writeFileSync(cacheFile, JSON.stringify(detail)); } catch { /* ignore */ } }
      fetched++;
      await sleep(1100); // stay under the 60/min proxy cap
      if (fetched % 20 === 0) process.stderr.write(`  …enriched ${i + 1}/${list.length}\n`);
    }
    // Merge: list-row timestamps + detail's sessionId/feedback.
    out.push({ ...row, ...detail });
  }
  process.stderr.write(`  enriched ${list.length} steps (${fetched} fetched, ${cached} cached)\n`);
  return out;
}

// ─── render ─────────────────────────────────────────────────────────────────
function renderPhases(L, s) {
  const total = BUCKET_ORDER.reduce((a, b) => a + (s.byBucket[b]?.wallMs || 0), 0);
  L.push('  LIFECYCLE PHASES — active wall-clock by phase');
  L.push('  ' + '─'.repeat(68));
  L.push(`  ${pad('phase', 42)} ${lpad('steps', 6)} ${lpad('active', 9)} ${lpad('share', 8)}`);
  for (const b of BUCKET_ORDER) {
    const B = s.byBucket[b]; if (!B) continue;
    L.push(`  ${pad(BUCKET_LABEL[b], 42)} ${lpad(B.steps, 6)} ${lpad(fmtDur(B.wallMs), 9)} ${lpad(pct(B.wallMs, total), 8)}`);
  }
  const work = ['before', 'diff', 'after'].reduce((a, b) => a + (s.byBucket[b]?.wallMs || 0), 0);
  L.push('  ' + '─'.repeat(68));
  L.push(`  of task work (excl. orchestration): before ${pct(s.byBucket.before?.wallMs || 0, work)}` +
    `  ·  diff ${pct(s.byBucket.diff?.wallMs || 0, work)}  ·  after ${pct(s.byBucket.after?.wallMs || 0, work)}`);
  L.push('  (orchestration wall-clock OVERLAPS its workers — a live orchestrator/wake step');
  L.push('   watches while workers run — so its share is concurrency, not additive cost.)');
  L.push('');
}

function renderEffort(L, s) {
  const e = s.workerEffort; // worker steps only — orchestrator watch-idle excluded
  const known = e.onboardingMs + e.activeMs + e.waitingMs + e.wrapupMs;
  L.push('  EFFORT INSIDE WORKER STEPS — where the time goes  (heartbeat-decomposed)');
  L.push('  ' + '─'.repeat(68));
  const rows = [
    ['active tool-work', e.activeMs],
    ['post-heartbeat tail (finalize·CI-wait·quiet)', e.wrapupMs],
    ['onboarding / prep (project summary)', e.onboardingMs],
    ['idle gaps (0 tools mid-run)', e.waitingMs],
  ];
  L.push(`  ${pad('class', 46)} ${lpad('time', 9)} ${lpad('share', 8)}`);
  for (const [label, ms] of rows)
    L.push(`  ${pad(label, 46)} ${lpad(fmtDur(ms), 9)} ${lpad(pct(ms, known), 8)}`);
  L.push('  ' + '─'.repeat(68));
  L.push(`  from ${s.workerDecomposed} worker steps with heartbeats  ·  ${s.ciTouchSteps} steps touch CI/tests`);
  L.push(`  orchestration watch-idle (excluded above): ${fmtDur(s.orchEffort.wrapupMs + s.orchEffort.waitingMs)}` +
    ` across ${fmtDur(s.orchEffort.activeMs)} active — a wake/orchestrator step is alive`);
  L.push('  watching, overlapping its workers, so its "tail" is not task finalization.');
  L.push('  CAVEAT: true test/CI-wait is NOT cleanly separable — a long `npm test` is one');
  L.push('  completed Bash tool (counts as active); CI-polling lands in the tail. Isolating');
  L.push('  it needs per-tool duration emission (same instrumentation gap as tokens).');
  L.push('');
}

function renderSessions(L, sessions) {
  const real = sessions.filter((x) => !x.solo || x.steps > 1);
  L.push(`  SESSIONS — autopilot runs grouped by sessionId  (${sessions.length} groups, ${real.length} multi-step)`);
  L.push('  ' + '─'.repeat(68));
  L.push(`  ${pad('session', 10)} ${lpad('steps', 5)} ${lpad('active', 8)} ${lpad('calendar', 9)} ${lpad('wait', 7)}  tasks / phases`);
  for (const s of sessions.slice(0, 15)) {
    const label = s.solo ? 'solo' : s.sessionId.slice(0, 8);
    const phases = Object.entries(s.kinds).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(' ');
    const tasks = s.tasks.length ? s.tasks.join(',') : '—';
    L.push(`  ${pad(label, 10)} ${lpad(s.steps, 5)} ${lpad(fmtDur(s.activeWallMs), 8)} ${lpad(fmtDur(s.calendarMs), 9)} ${lpad(fmtDur(s.effort.waitingMs), 7)}  ${tasks}  [${phases}]`);
  }
  L.push('');
  L.push('  (active = Σ step wall-clock; calendar = first dispatch → last completion;');
  L.push('   wait = Σ 0-tool heartbeat stretches in the run. active>calendar ⇒ concurrent workers.)');
  L.push('');
}

function render(s, sessions, meta) {
  const L = [];
  L.push('');
  L.push('  WALL-CLOCK & EFFORT SUMMARY — where does the time go?   (LIN-987)');
  L.push('  ' + '═'.repeat(68));
  L.push(`  ${s.steps} dispatch steps` + (meta.mode ? ` [${meta.mode}]` : '') +
    `   ·   ${s.openCount} still open`);
  if (s.span.min) L.push(`  span: ${s.span.min.slice(0, 16).replace('T', ' ')} → ${s.span.max.slice(0, 16).replace('T', ' ')} UTC`);
  L.push(`  total active wall-clock: ${fmtDur(s.totalActiveWall)}`);
  L.push('');
  renderPhases(L, s);
  if (!meta.fast) renderEffort(L, s);
  if (sessions) renderSessions(L, sessions);
  const qwMed = median(s.queueWaits);
  L.push('  QUEUE WAIT (dispatch → take)');
  L.push('  ' + '─'.repeat(68));
  L.push(`  median ${fmtDur(qwMed)} · max ${fmtDur(s.queueWaits.length ? Math.max(...s.queueWaits) : null)} · n=${s.queueWaits.length}`);
  L.push('');
  L.push('  NOTE: wall-clock only — worker token/cost is emitted nowhere today.');
  L.push('  `waiting` is a lower bound (long tools inside an active interval hide). See LIN-987.');
  L.push('');
  return L.join('\n');
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token) {
    console.error('error: set PROXY_TOKEN env var or pass --token <proxy token>');
    process.exit(2);
  }

  let items, mode;
  if (args.fast) {
    const url = new URL(`${args.base}/dispatch`);
    url.searchParams.set('limit', '100');
    if (args.issue) url.searchParams.set('issueIdentifier', args.issue);
    const body = await getJson(url.toString(), args.token);
    items = body.items || [];
    mode = 'fast: recent ~100, no detail';
  } else {
    process.stderr.write('enumerating dispatch ids across all statuses…\n');
    const ids = await enumerateIds(args);
    process.stderr.write(`  ${ids.size} unique steps; enriching with detail (sessionId + heartbeats)…\n`);
    items = await enrich(ids, args);
    mode = `widened: ${items.length} steps across all statuses`;
  }

  const summary = summarizeSteps(items);
  const sessions = args.fast ? null : groupBySession(items);

  if (args.json) {
    console.log(JSON.stringify({
      meta: { mode, steps: summary.steps, openCount: summary.openCount, span: summary.span },
      byBucket: summary.byBucket, byKind: summary.byKind,
      effort: summary.effort, workerEffort: summary.workerEffort, orchEffort: summary.orchEffort,
      queueWaitMedianMs: median(summary.queueWaits), totalActiveWallMs: summary.totalActiveWall,
      sessions: sessions?.map((s) => ({ sessionId: s.sessionId, solo: s.solo, steps: s.steps,
        tasks: s.tasks, kinds: s.kinds, activeWallMs: s.activeWallMs, calendarMs: s.calendarMs,
        waitingMs: s.effort.waitingMs, ciTouchSteps: s.ciTouchSteps })),
    }, null, 2));
  } else {
    console.log(render(summary, sessions, { fast: args.fast, mode }));
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
