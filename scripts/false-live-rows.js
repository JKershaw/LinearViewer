#!/usr/bin/env node
/**
 * False-live-rows instrument (LIN-3365, slice B of LIN-3358). READ-ONLY.
 *
 * Counts the rows the census and the proxy list still read as live (blocked /
 * silent) although their session has moved on or ended, plus the opposite
 * failure (rows the closers closed that should have stayed open). Run it before
 * and after `scripts/lineage-close-backfill-lin3365.js`; both outputs go in the
 * PR. `find` only: there is no `--execute` and nothing here writes.
 *
 * Usage:  node scripts/false-live-rows.js          (same MONGODB_URI / HARBOUR_DATA_DIR as server.js)
 *
 * Definition (the LIN-3358 plan, B section, revisions 2 and 3):
 *   1. a taken `kind:'wake'` row, unstamped, no own terminal, with a later
 *      lineage row that has posted a tagged entry, taken before that post (B(a))
 *   2. an unstamped, un-terminated row TAKEN before a lineage-closing terminal
 *      that was dispatched after its dispatch (B(b))
 *      -- clauses 1 and 2 come from `selectLineageCloses`, the very rule the
 *      closers and the backfill use, so they inherit the take-time and
 *      member-at-time rules and cannot disagree with them.
 *   3. a row `classifyLoop` reads blocked/silent, past TICKET_CLOSED_GRACE_MS,
 *      whose ticket state type is in TERMINAL_TYPES (imported, never re-listed)
 *   4. an open decision (collectUnansweredDecisions already drops read-time
 *      superseded ones) whose ticket type is in TERMINAL_TYPES. NO "a newer
 *      decision supersedes" half (revision 3).
 * Informational, not counted: a non-wake row with a later lineage row, no
 * lineage terminal (the ticket's state is not consulted here).
 * False closes (target 0): `handed-on` with no later tagged lineage row;
 * `lineage-terminal` with no lineage-closing terminal; `ticket-closed` on a
 * ticket that is not terminal now (reported as "non-terminal now (reopened or
 * false close)", unsplit, because Linear clears completedAt on reopen: it only
 * counts toward target 0 once the issue read can show it was never terminal);
 * the same test on decision-withdrawn / self-resolved records written with
 * reason `ticket-closed`.
 *
 * `unknown` (a ticket that could not be read) is NEVER counted as false-live
 * (fail closed) and is the FIRST number in the headline: a run where every
 * ticket read failed reads 0 for clauses 3 and 4 and must not look clean.
 */

import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { execFileSync } from 'node:child_process';
import { DispatchQueueStore } from '../lib/dispatch-store.js';
import { AgentStatusStore } from '../lib/agent-status-store.js';
import { getLoopsForWorkspace } from '../lib/pipeline-loops.js';
import { computeSupersededLoopIds } from '../lib/loop-supersede.js';
import { classifyLoop } from '../lib/observer-sweep.js';
import { DEFAULT_LANE_STALE_MS } from '../lib/live-console.js';
import { collectUnansweredDecisions, answeredDecisionIdsByLineage } from '../lib/unanswered-decisions.js';
import { TERMINAL_TYPES } from '../lib/providers/models.js';
import { READ_HORIZON_MS } from '../lib/read-horizon.js';
import { isLineageClosingTerminal } from '../lib/dispatch-terminal.js';
import { TICKET_CLOSED_GRACE_MS } from '../lib/lineage-closure.js';
import { selectForWorkspace } from './lineage-close-backfill-lin3365.js';

const toMs = (v) => (v == null ? NaN : (v instanceof Date ? v.getTime() : new Date(v).getTime()));

/**
 * Default ticket-state read: the workspace API (`GET /api/proxy/issues/:id`),
 * so the script holds no provider credentials of its own. Any failure -> null
 * (the caller buckets it as `unknown`).
 *
 * @returns {Promise<{stateType: string|null, terminalAtMs: number|null}|null>}
 */
export async function defaultReadTicketState(urlKey, issueIdentifier, { base = process.env.HARBOUR_LOCAL_BASE, fetchImpl = globalThis.fetch } = {}) {
  if (!base || !issueIdentifier || typeof fetchImpl !== 'function') return null;
  try {
    const res = await fetchImpl(`${base}/api/proxy/issues/${encodeURIComponent(issueIdentifier)}`);
    if (!res.ok) return null;
    const issue = await res.json();
    const stateType = issue?.state?.type || null;
    if (!stateType) return null;
    const t = toMs(issue.completedAt || issue.canceledAt);
    return { stateType, terminalAtMs: Number.isFinite(t) ? t : null };
  } catch {
    return null;
  }
}

/** Clause 3/4 over one workspace's loops. Ticket reads are memoised per issue. */
async function ticketClauses({ urlKey, loops, now, readTicket, collectDecisions }) {
  const out = { clause3: [], clause4: [], unknown: new Set(), checked: new Set() };
  const superseded = computeSupersededLoopIds(loops);
  const answeredByLineage = answeredDecisionIdsByLineage(loops);

  const candidates3 = loops.filter(l => ['blocked', 'silent'].includes(
    classifyLoop(l, { superseded, now, staleMs: DEFAULT_LANE_STALE_MS, answeredByLineage })) && l.issueIdentifier);
  const decisions = collectDecisions({ loops }, { now: new Date(now) });
  const candidates4 = decisions.filter(d => d?.anchor?.issueIdentifier);

  const cache = new Map();
  const state = async (issue) => {
    if (!cache.has(issue)) cache.set(issue, await readTicket(urlKey, issue).catch(() => null));
    return cache.get(issue);
  };

  for (const l of candidates3) {
    const st = await state(l.issueIdentifier);
    out.checked.add(l.issueIdentifier);
    if (!st) { out.unknown.add(l.issueIdentifier); continue; }
    if (!TERMINAL_TYPES.includes(st.stateType)) continue;
    // A terminal ticket with no usable timestamp cannot be placed past the grace window: unknown, not a count.
    if (st.terminalAtMs == null) { out.unknown.add(l.issueIdentifier); continue; }
    if (now - st.terminalAtMs > TICKET_CLOSED_GRACE_MS) out.clause3.push({ loopId: l.loopId, issue: l.issueIdentifier });
  }
  for (const d of candidates4) {
    const issue = d.anchor.issueIdentifier;
    const st = await state(issue);
    out.checked.add(issue);
    if (!st) { out.unknown.add(issue); continue; }
    if (TERMINAL_TYPES.includes(st.stateType)) out.clause4.push({ issue, decisionId: d.decision?.id || d.decision?.decisionId || null });
  }
  return out;
}

/** False closes among rows already stamped / decision records already written. */
async function falseCloses({ dispatchStore, urlKey, now, readTicket }) {
  const history = dispatchStore.historyCollection;
  const horizon = new Date(now - READ_HORIZON_MS);
  const stamped = await history.find({ urlKey, 'bookkeeping.reason': { $in: ['handed-on', 'lineage-terminal', 'ticket-closed'] }, dispatchedAt: { $gte: horizon } }).toArray();
  const roots = [...new Set(stamped.map(r => r.rootItemId).filter(Boolean))];
  const lineage = roots.length ? await history.find({ urlKey, rootItemId: { $in: roots } }).toArray() : [];
  const byRoot = new Map();
  for (const r of lineage) { if (!byRoot.has(r.rootItemId)) byRoot.set(r.rootItemId, []); byRoot.get(r.rootItemId).push(r); }

  const found = { 'handed-on': [], 'lineage-terminal': [], 'ticket-closed': [], 'reopened': [], 'unknown': 0 };
  const ticketOutcome = async (issue) => {
    const st = issue ? await readTicket(urlKey, issue).catch(() => null) : null;
    if (!st) { found.unknown += 1; return null; }
    return st;
  };
  for (const r of stamped) {
    const reason = r.bookkeeping.reason;
    const peers = (byRoot.get(r.rootItemId) || []).filter(p => p._id !== r._id);
    const atMs = toMs(r.bookkeeping.at);
    if (reason === 'handed-on') {
      const hasSuccessor = peers.some(p => toMs(p.dispatchedAt) > toMs(r.dispatchedAt) && (p.feedback || []).some(f => f.rootItemId));
      if (!hasSuccessor) found['handed-on'].push(r._id);
    } else if (reason === 'lineage-terminal') {
      const hasTerminal = peers.some(p => (p.feedback || []).some(f => isLineageClosingTerminal(f.message) && toMs(f.timestamp) <= atMs));
      if (!hasTerminal) found['lineage-terminal'].push(r._id);
    } else if (reason === 'ticket-closed') {
      const st = await ticketOutcome(r.issueIdentifier);
      if (st && !TERMINAL_TYPES.includes(st.stateType)) found.reopened.push(r._id);
    }
  }
  // decision-withdrawn / self-resolved records written with reason ticket-closed.
  const withdrawals = await history.find({ urlKey, dispatchedAt: { $gte: horizon }, feedback: { $elemMatch: { kind: { $in: ['decision-withdrawn', 'self-resolved'] } } } }).toArray();
  for (const r of withdrawals) {
    for (const f of r.feedback || []) {
      if (!['decision-withdrawn', 'self-resolved'].includes(f.kind)) continue;
      let reason = f.reason;
      if (!reason) { try { reason = JSON.parse(f.message)?.reason; } catch { /* free text */ } }
      if (reason !== 'ticket-closed') continue;
      const st = await ticketOutcome(r.issueIdentifier);
      if (st && !TERMINAL_TYPES.includes(st.stateType)) found.reopened.push(`${r._id}:${f.kind}`);
    }
  }
  return found;
}

/** Informational: a non-wake row with a later lineage row, no lineage-closing terminal. */
function informational(rows, now) {
  const horizonMs = now - READ_HORIZON_MS;
  const byRoot = new Map();
  for (const r of rows) if (r.rootItemId) { if (!byRoot.has(r.rootItemId)) byRoot.set(r.rootItemId, []); byRoot.get(r.rootItemId).push(r); }
  let n = 0;
  for (const group of byRoot.values()) {
    if (group.some(r => (r.feedback || []).some(f => isLineageClosingTerminal(f.message)))) continue;
    for (const r of group) {
      if (r.kind === 'wake' || r.status !== 'taken' || r.bookkeeping || toMs(r.dispatchedAt) < horizonMs) continue;
      if (group.some(p => p._id !== r._id && toMs(p.dispatchedAt) > toMs(r.dispatchedAt))) n += 1;
    }
  }
  return n;
}

/**
 * Runs the instrument. Exported so tests drive it with injected readers.
 *
 * @param {Object} p
 * @param {Object} p.dispatchStore
 * @param {Object} [p.agentStatusStore]
 * @param {(urlKey:string, issue:string)=>Promise<{stateType:string, terminalAtMs:number|null}|null>} [p.readTicketState]
 * @param {(urlKey:string)=>Promise<Array<Object>>} [p.readLoops] - defaults to getLoopsForWorkspace (lean)
 */
export async function runFalseLiveRows({
  dispatchStore,
  agentStatusStore = null,
  urlKeys = null,
  now = Date.now(),
  headSha = null,
  readTicketState = defaultReadTicketState,
  readLoops = null,
  collectDecisions = collectUnansweredDecisions,
  log = () => {}
}) {
  const keys = urlKeys || await dispatchStore.listObservedWorkspaceKeys();
  const loopsOf = readLoops || ((urlKey) => getLoopsForWorkspace(urlKey, { lean: true, dispatchStore, agentStatusStore }));
  const perWorkspace = [];
  for (const urlKey of keys) {
    try {
      const sel = await selectForWorkspace({ dispatchStore, urlKey, now });
      const clause1 = sel.writable.filter(c => c.reason === 'handed-on');
      const clause2 = sel.writable.filter(c => c.reason === 'lineage-terminal');
      const loops = await loopsOf(urlKey);
      const t = await ticketClauses({ urlKey, loops, now, readTicket: readTicketState, collectDecisions });
      const fc = await falseCloses({ dispatchStore, urlKey, now, readTicket: readTicketState });
      perWorkspace.push({
        urlKey, readFailed: false,
        clause1: clause1.length, clause2: clause2.length, clause3: t.clause3.length, clause4: t.clause4.length,
        unknown: t.unknown.size + fc.unknown, ticketsChecked: t.checked.size,
        informational: informational(sel.rows, now), falseCloses: fc
      });
    } catch (err) {
      log(`[false-live-rows] ${urlKey}: READ FAILED (${err?.message || err})`);
      perWorkspace.push({ urlKey, readFailed: true, error: err?.message || String(err) });
    }
  }
  const report = buildReport({ perWorkspace, now, headSha });
  return { report, perWorkspace };
}

export function buildReport({ perWorkspace, now, headSha }) {
  const ok = perWorkspace.filter(w => !w.readFailed);
  const failed = perWorkspace.filter(w => w.readFailed);
  const sum = (f) => ok.reduce((n, w) => n + f(w), 0);
  const fc = (k) => sum(w => w.falseCloses[k].length);
  const falseCloseTotal = fc('handed-on') + fc('lineage-terminal') + fc('ticket-closed');
  const total = sum(w => w.clause1 + w.clause2 + w.clause3 + w.clause4);

  const L = [];
  // Headline: unknown FIRST, so an all-unreadable run cannot pass for a clean zero.
  L.push(`# False live rows — unknown: ${sum(w => w.unknown)} | false-live: ${total} (c1 ${sum(w => w.clause1)}, c2 ${sum(w => w.clause2)}, c3 ${sum(w => w.clause3)}, c4 ${sum(w => w.clause4)}) | false closes: ${falseCloseTotal}`);
  L.push('');
  L.push(`Run at: ${new Date(now).toISOString()}`);
  L.push(`HEAD: ${headSha || '(unknown — not a git checkout)'}`);
  L.push(`Workspaces read: ${ok.length}${failed.length ? ` (${failed.length} FAILED: ${failed.map(w => w.urlKey).join(', ')})` : ''}`);
  L.push(`Horizon: dispatchedAt >= ${new Date(now - READ_HORIZON_MS).toISOString()} (READ_HORIZON_MS); ticket grace ${TICKET_CLOSED_GRACE_MS / 60000}m (provisional)`);
  L.push('');
  L.push(`unknown (ticket unreadable; never counted as false-live): ${sum(w => w.unknown)}  [tickets checked: ${sum(w => w.ticketsChecked)}]`);
  L.push('');
  L.push('Clauses (target 0):');
  L.push(`  1 wake row, a later lineage row has posted (B(a))         ${String(sum(w => w.clause1)).padStart(5)}`);
  L.push(`  2 un-terminated row taken before a lineage terminal (B(b)) ${String(sum(w => w.clause2)).padStart(5)}`);
  L.push(`  3 blocked/silent row on a terminal ticket past grace      ${String(sum(w => w.clause3)).padStart(5)}`);
  L.push(`  4 open decision on a terminal ticket                      ${String(sum(w => w.clause4)).padStart(5)}`);
  L.push('');
  L.push('By workspace (c1 c2 c3 c4 unknown):');
  for (const w of ok) L.push(`  ${w.urlKey.padEnd(28)} ${w.clause1} ${w.clause2} ${w.clause3} ${w.clause4} ${w.unknown}`);
  L.push('');
  L.push(`Informational (not counted): non-wake row with a later lineage row, no lineage terminal: ${sum(w => w.informational)}`);
  L.push('');
  L.push('False closes (target 0):');
  L.push(`  handed-on with no later tagged lineage row     ${fc('handed-on')}`);
  L.push(`  lineage-terminal with no lineage terminal      ${fc('lineage-terminal')}`);
  L.push(`  ticket-closed / withdrawal on a non-terminal ticket now (reopened or false close; unsplit, not counted toward 0 until shown never terminal): ${fc('reopened')}`);
  return L.join('\n');
}

export function readHeadSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data');
  await dbClient.connect();
  const db = dbClient.db('linear-viewer');
  try {
    const dispatchStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
    const agentStatusStore = new AgentStatusStore({ collection: db.collection('foreman-status') });
    const { report } = await runFalseLiveRows({ dispatchStore, agentStatusStore, headSha: readHeadSha(), log: (m) => console.error(m) });
    console.log(report);
  } finally {
    if (dbClient.close) await dbClient.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[false-live-rows] failed:', err);
    process.exitCode = 1;
  });
}
