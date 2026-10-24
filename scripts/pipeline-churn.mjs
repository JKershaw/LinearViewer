#!/usr/bin/env node
/**
 * scripts/pipeline-churn.mjs  (LIN-3891)
 *
 * "Which runs did a ticket need between launch and Done, and which could it
 * skip?" A read-only count of every dispatch on each ticket, each one given
 * the cause the trail shows for it, built from what the workspace API proxy
 * already exposes. All analysis lives in `lib/pipeline-churn.js` (pure,
 * unit-tested); this file only fetches, caches and prints, the same split as
 * `scripts/wall-clock-summary.mjs`.
 *
 * The read, per ticket:
 *   1. `GET /dispatch?issueIdentifier={id}&limit=250`        the rows
 *   2. `GET /dispatch/{rowId}` per row                         feedback, sessionId, followUpTo
 *   3. `GET /dispatch/{rowId}/prompt` per `custom` row whose feedback names no task
 *      (an aborted row never posts `[started]`)                its first line
 *   4. `GET /rulings?issueIdentifier={id}&includeResolved=true` raise/answer times
 * Reads only, rate-limited under the proxy's 60/min cap and cached to disk; a
 * row is cached only once it is terminal or closed.
 *
 * Usage:
 *   PROXY_TOKEN=xxx node scripts/pipeline-churn.mjs --issues LIN-1,LIN-2
 *   There is no "every ticket closed in the last N days" mode on purpose: the
 *   status-filtered dispatch list returns at most 100 rows (on 24 Oct `done`
 *   reached back only to that morning) and `GET /issues` has no completed-since
 *   filter, so such a mode would silently drop tickets. Name the tickets.
 *   ... --json           machine-readable result on stdout
 *   ... --rows           print every row with its cause
 *   ... --base <url>     proxy base (default $PROXY_BASE, else the live instance);
 *                        a local credential broker needs no token
 *   ... --cache <dir>    default $TMPDIR/harbour-pipeline-churn-cache
 *   ... --no-cache
 *
 * NOT registered in package.json and not run by CI: a manual instrument, like
 * its siblings.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyTicket, summarizeChurn, taskHead } from '../lib/pipeline-churn.js';

function parseArgs(argv) {
  const a = { base: process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy',
    token: process.env.PROXY_TOKEN || '', json: false, rows: false, issues: [],
    cache: join(tmpdir(), 'harbour-pipeline-churn-cache'), noCache: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--json') a.json = true;
    else if (v === '--rows') a.rows = true;
    else if (v === '--no-cache') a.noCache = true;
    else if (v === '--token') a.token = argv[++i];
    else if (v === '--base') a.base = argv[++i];
    else if (v === '--cache') a.cache = argv[++i];
    else if (v === '--issues') a.issues = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (v === '--help') { console.log('usage: node scripts/pipeline-churn.mjs --issues LIN-1,LIN-2 [--json] [--rows] [--base url] [--token t] [--cache dir] [--no-cache]'); process.exit(0); }
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeReader({ base, token, cache, noCache }) {
  if (!noCache) mkdirSync(cache, { recursive: true });
  return async function get(path, { cacheKey = null, keep = () => false } = {}) {
    const file = cacheKey && !noCache ? join(cache, `${cacheKey}.json`) : null;
    if (file && existsSync(file)) {
      try { return JSON.parse(readFileSync(file, 'utf8')); } catch { /* re-read */ }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`${base}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
      await sleep(1100); // stay under the 60/min proxy cap
      if (res.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`proxy ${res.status} on ${path}: ${await res.text()}`);
      const body = await res.json();
      if (file && keep(body)) { try { writeFileSync(file, JSON.stringify(body)); } catch { /* ignore */ } }
      return body;
    }
    throw new Error(`rate-limited after 5 tries: ${path}`);
  };
}

const settled = (row) => ['done', 'failed', 'aborted', 'closed'].includes(row?.status);

async function readTicket(get, identifier) {
  const list = await get(`/dispatch?issueIdentifier=${encodeURIComponent(identifier)}&limit=250`);
  const rows = [];
  for (const item of list.items || []) {
    const detail = await get(`/dispatch/${item.id}`, { cacheKey: item.id, keep: () => settled(item) });
    const row = { ...item, ...detail };
    if (row.kind === 'custom' && !taskHead(row)) {
      const p = await get(`/dispatch/${item.id}/prompt`, { cacheKey: `${item.id}.prompt`, keep: () => true });
      row.promptHead = String(p?.prompt || '').split('\n')[0];
    }
    rows.push(row);
  }
  const r = await get(`/rulings?issueIdentifier=${encodeURIComponent(identifier)}&includeResolved=true`);
  return { identifier, rows, rulings: r.rulings || [] };
}

const fmt = (msVal) => {
  if (!msVal) return '0m';
  const m = Math.round(msVal / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

function render(tickets, summary, showRows) {
  const L = [''];
  L.push('  PIPELINE CHURN — dispatches per ticket, by cause   (LIN-3891)');
  L.push('  ' + '═'.repeat(72));
  L.push(`  ${summary.tickets} tickets · ${summary.dispatches} dispatches · ${summary.extraOverStagePath} beyond the stage path (autopilot + implementation + review + close-out, each with its wake)`);
  L.push(`  waiting on a person (union of ruling open intervals): ${fmt(summary.personWaitMs)}`);
  L.push('');
  L.push(`  ${'cause'.padEnd(26)} ${'runs'.padStart(5)} ${'wakes'.padStart(6)} ${'wall'.padStart(8)} ${'stalled'.padStart(8)}  tickets`);
  for (const c of summary.byCause) {
    const t = Object.entries(c.tickets).map(([k, n]) => `${k}${n > 1 ? `×${n}` : ''}`).join(' ');
    L.push(`  ${c.cause.padEnd(26)} ${String(c.dispatches).padStart(5)} ${String(c.wakes).padStart(6)} ${fmt(c.wallMs).padStart(8)} ${fmt(c.stalledMs).padStart(8)}  ${t}`);
  }
  L.push('');
  L.push('  RULINGS');
  for (const r of summary.rulings) {
    L.push(`  ${r.identifier} ${r.decisionId} · raised by ${r.raisedByStage || '?'} · ${r.outcome || 'open'} after ${fmt(r.waitMs)}${r.openAtRaise.length ? ` · raised while ${r.openAtRaise.join(', ')} was open` : ''}`);
  }
  if (showRows) {
    for (const t of tickets) {
      L.push('', `  ${t.identifier} — ${t.total} dispatches`);
      for (const e of t.entries) {
        L.push(`    ${e.dispatchedAt.slice(11, 19)} ${e.kind.padEnd(20)} ${e.cause.padEnd(24)} ${fmt(e.wallMs).padStart(7)}  ${e.note || ''}`);
      }
    }
  }
  L.push('');
  L.push('  wall: a worker\'s dispatch to its end (parked time included); a wake\'s or custom\'s own turn.');
  L.push('  stalled: the longest `[stalled?] no tool activity` stretch inside a row\'s working window.');
  L.push('');
  return L.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.issues.length) {
    console.error('error: pass --issues LIN-1,LIN-2');
    process.exit(2);
  }
  const get = makeReader(args);
  const tickets = [];
  for (const id of args.issues) {
    process.stderr.write(`  reading ${id}…\n`);
    tickets.push(classifyTicket(await readTicket(get, id)));
  }
  const summary = summarizeChurn(tickets);
  if (args.json) console.log(JSON.stringify({ summary, tickets }, null, 2));
  else console.log(render(tickets, summary, args.rows));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
