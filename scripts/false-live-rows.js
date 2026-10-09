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
 * Usage:  node scripts/false-live-rows.js [--ticket-workspace <urlKey>] [--sessions <path/to/sessions.json>]
 *          (same MONGODB_URI / HARBOUR_DATA_DIR as server.js)
 *
 * Ticket reads (clauses 3, 4 and the ticket-closed false closes) go through
 * HARBOUR_LOCAL_BASE, which is ONE workspace's proxy. They are only made for the
 * workspace named by `--ticket-workspace` (or FALSE_LIVE_TICKET_URLKEY); every
 * other workspace's tickets read `unknown`, never another workspace's
 * same-identifier issue. Run once per workspace with that workspace's proxy base.
 * Clauses 3 and 4 take their candidates from the closer's own selector
 * (`prepareCloserCandidates`, lib/ticket-close-closer.js, persist:false so this
 * script writes nothing), so the instrument and the writer cannot disagree.
 * Items a human chose to keep live (a reversed withdrawal, an un-retired scan
 * row) are reported separately as `humanReopened`, not as false-live.
 *
 * Definition (the LIN-3358 plan, B section, revisions 2 and 3):
 *   1. a taken `kind:'wake'` row, unstamped, no own terminal, with a later
 *      lineage row that has posted a tagged entry, taken before that post (B(a))
 *   2. an unstamped, un-terminated row TAKEN before a lineage-closing terminal
 *      that was dispatched after its dispatch (B(b))
 *      -- clauses 1 and 2 come from `selectLineageCloses`, the very rule the
 *      closers and the backfill use, so they inherit the take-time and
 *      member-at-time rules and cannot disagree with them.
 *   3. a row `classifyLoop` reads blocked/silent whose lineage has been quiet
 *      past TICKET_CLOSED_GRACE_MS (a quiet bound on the lineage, not a
 *      ticket-terminal age), whose ticket state type is in TERMINAL_TYPES
 *      (imported, never re-listed). Canceled and duplicate tickets count.
 *   4. an open decision (loop-backed, quiet past the grace; or a scan row)
 *      whose ticket type is in TERMINAL_TYPES. NO "a newer decision
 *      supersedes" half (revision 3).
 * Informational, not counted: a non-wake row with a later lineage row, no
 * lineage terminal (the ticket's state is not consulted here).
 * False closes (target 0): `handed-on` with no later tagged lineage row;
 * `lineage-terminal` with no lineage-closing terminal; `ticket-closed` on a
 * ticket that is not terminal now (reported as "non-terminal now (reopened or
 * false close)", unsplit, because Linear clears completedAt on reopen: it only
 * counts toward target 0 once the issue read can show it was never terminal);
 * the same test on decision-withdrawn records whose reason starts with
 * `ticket-closed` and on scan rows whose outcomeBasisHash is the closer's.
 *
 * Paired measure (LIN-3433, slice I of LIN-3358). c1, c2, c4 and the false-close
 * lines are unchanged:
 *   - c3 with C's row stamp disabled (`clause3NoStamp`) REPLACES c3 in the headline and total
 *     (`clause3`, stamp honoured, stays as a field and an informational line): c3 recomputed after
 *     nulling `bookkeeping` on loops stamped `ticket-closed` (and only those: B's
 *     and the fossil stamps stay), so a pass cannot come from stamping. Read-only.
 *   - posts after the end: feedback entries on a row timestamped after that row's
 *     OWN latest terminal marker (`isLineageClosingTerminal`) or stamp (`bookkeeping.at`),
 *     latest wins (a re-posted [done] after a follow-up is not a writer). Harbour-only. Decision-lifecycle stamps Harbour itself appends
 *     (`isDecisionLifecycleStampEntry`) are not a writer and are not counted.
 *   - runner-side zombies, from the runner's `sessions.json` (`--sessions <path>`
 *     or FALSE_LIVE_SESSIONS_PATH; THIS HOST'S FILE ONLY, runner-kit runners on
 *     other machines are unreadable): (a) active-phase sessions silent past
 *     RUNNER_ACTIVE_BOUND_MS, (b) parked sessions on a terminal ticket.
 *     A missing/unreadable file, or a ticket that cannot be read, is `unknown`,
 *     never 0.
 *   - report-only: parked sessions with no ticket (count and age). No target; it
 *     adds nothing to arm (b).
 *
 * `unknown` (a ticket that could not be read) is NEVER counted as false-live
 * (fail closed) and is the FIRST number in the headline: a run where every
 * ticket read failed reads 0 for clauses 3 and 4 and must not look clean.
 */

import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { execFileSync } from 'node:child_process';
import { DispatchQueueStore } from '../lib/dispatch-store.js';
import { AgentStatusStore } from '../lib/agent-status-store.js';
import { getLoopsForWorkspace } from '../lib/pipeline-loops.js';
import { TaskDecisionsStore } from '../lib/task-decisions-store.js';
import { prepareCloserCandidates, ticketClosedBasisHash, TICKET_CLOSED_REASON } from '../lib/ticket-close-closer.js';
import { isDecisionLifecycleStampEntry } from '../lib/digest-feedback.js';
import { TERMINAL_TYPES } from '../lib/providers/models.js';
import { READ_HORIZON_MS } from '../lib/read-horizon.js';
import { isLineageClosingTerminal } from '../lib/dispatch-terminal.js';
import { TICKET_CLOSED_GRACE_MS } from '../lib/lineage-closure.js';
import { selectForWorkspace } from './lineage-close-backfill-lin3365.js';

const toMs = (v) => (v == null ? NaN : (v instanceof Date ? v.getTime() : new Date(v).getTime()));

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The proxy allows 60 reads/min; one read per 1.1s stays under it. */
export const TICKET_READ_PACE_MS = 1100;
export const TICKET_READ_MAX_RETRIES = 6;
const TICKET_READ_RETRY_BASE_MS = 2000;
const TICKET_READ_RETRY_CAP_MS = 30000;

/**
 * Default ticket-state read: the workspace API (`GET /api/proxy/issues/:id`),
 * so the script holds no provider credentials of its own. Any failure -> null
 * (the caller buckets it as `unknown`).
 *
 * Only a 429 is retried (LIN-3399: unpaced, ~200 of 261 tickets read `unknown`
 * against the proxy's 60/min limit). It waits `Retry-After` when the proxy
 * sends one, else an exponential backoff, up to `maxRetries`; exhausted retries
 * still return null. A 404, any other non-ok status, or a thrown error is NOT
 * retried: those are answers, not rate limits.
 *
 * @returns {Promise<{issueId: string|null, stateType: string}|null>}
 */
export async function defaultReadTicketState(urlKey, issueIdentifier, {
  base = process.env.HARBOUR_LOCAL_BASE,
  fetchImpl = globalThis.fetch,
  ticketUrlKey = process.env.FALSE_LIVE_TICKET_URLKEY,
  sleep = sleepMs,
  maxRetries = TICKET_READ_MAX_RETRIES
} = {}) {
  // The base is one workspace's proxy: a read for any other workspace would
  // return a same-identifier issue from the wrong one (team keys collide).
  if (!ticketUrlKey || urlKey !== ticketUrlKey) return null;
  if (!base || !issueIdentifier || typeof fetchImpl !== 'function') return null;
  try {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetchImpl(`${base}/api/proxy/issues/${encodeURIComponent(issueIdentifier)}`);
      if (res.status === 429) {
        if (attempt >= maxRetries) return null;
        const retryAfterS = Number(res.headers?.get?.('retry-after'));
        const waitMs = Number.isFinite(retryAfterS) && retryAfterS > 0
          ? retryAfterS * 1000
          : TICKET_READ_RETRY_BASE_MS * 2 ** attempt;
        await sleep(Math.min(waitMs, TICKET_READ_RETRY_CAP_MS));
        continue;
      }
      if (!res.ok) return null;
      const issue = await res.json();
      const stateType = issue?.state?.type || null;
      if (!stateType) return null;
      return { issueId: issue.id || null, stateType };
    }
  } catch {
    return null;
  }
}

/**
 * Wraps a ticket reader with a minimum gap between underlying reads and a
 * per-run memo keyed by workspace + identifier, so the clause checks and the
 * false-close checks share one read per ticket. The memo holds the promise,
 * so concurrent callers also share it; an `unknown` (null) is memoised too.
 */
export function createPacedMemoReader(read, { paceMs = TICKET_READ_PACE_MS, sleep = sleepMs, clock = Date.now } = {}) {
  const memo = new Map();
  let lastAt = -Infinity;
  return (urlKey, issue) => {
    const key = `${urlKey}\u0000${issue}`;
    if (!memo.has(key)) {
      memo.set(key, (async () => {
        // lastAt is the scheduled start of the previous read, so concurrent callers queue.
        const wait = Math.max(0, lastAt + paceMs - clock());
        lastAt = clock() + wait;
        if (wait > 0) await sleep(wait);
        return read(urlKey, issue);
      })());
    }
    return memo.get(key);
  };
}

/**
 * Clause 3/4 over one workspace, from the closer's own selector. Ticket reads
 * are memoised per run (by the caller). `humanReopened` counts settled items on a
 * terminal ticket (a decision, not staleness); `unverified` counts loops whose
 * legacy digest could not be resolved (never counted as false-live).
 */
async function ticketClauses({ urlKey, loops, taskDecisions, newestScanByTask, now, readTicket, dispatchStore }) {
  const out = { clause3: [], clause3NoStamp: [], clause4: [], humanReopened: [], unverified: 0, unknown: new Set(), checked: new Set() };
  const c = await prepareCloserCandidates({ loops, taskDecisions, newestScanByTask, now, dispatchStore, persist: false });
  out.unverified = c.unverified.length;

  // `readTicket` is memoised per run by `runFalseLiveRows`, shared with `falseCloses`.
  const state = (issue) => readTicket(urlKey, issue).catch(() => null);
  // null = unreadable (bucketed unknown), false = readable but not terminal.
  const terminal = async (issue) => {
    const st = await state(issue);
    out.checked.add(issue);
    if (!st) { out.unknown.add(issue); return null; }
    return TERMINAL_TYPES.includes(st.stateType) ? st : false;
  };

  for (const r of c.rows) {
    if (await terminal(r.issueIdentifier)) out.clause3.push({ loopId: r.loopId, issue: r.issueIdentifier });
  }
  // c3 with C's row stamp disabled: same selector over the loops as if no `ticket-closed` stamp existed.
  const cNo = await prepareCloserCandidates({ loops: withoutTicketClosedStamp(loops), taskDecisions, newestScanByTask, now, dispatchStore, persist: false });
  out.clause3NoStamp = [];
  for (const r of cNo.rows) {
    if (await terminal(r.issueIdentifier)) out.clause3NoStamp.push({ loopId: r.loopId, issue: r.issueIdentifier });
  }
  for (const d of c.loopDecisions) {
    if (await terminal(d.issueIdentifier)) out.clause4.push({ issue: d.issueIdentifier, decisionId: d.decisionId });
  }
  for (const s of c.scanDecisions) {
    const st = await terminal(s.issueIdentifier);
    // The scan join is on issueId equality with the ticket that was read.
    if (st && st.issueId && st.issueId === s.issueId) out.clause4.push({ issue: s.issueIdentifier, decisionId: s.id });
  }
  for (const s of c.settled) {
    if (await terminal(s.issueIdentifier)) out.humanReopened.push({ type: s.type, issue: s.issueIdentifier });
  }
  return out;
}

/** False closes among rows already stamped / decision records already written. */
async function falseCloses({ dispatchStore, taskDecisionsStore, urlKey, now, readTicket }) {
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
  // decision-withdrawn records written with a `ticket-closed` reason (prefix, not equality).
  const withdrawals = await history.find({ urlKey, dispatchedAt: { $gte: horizon }, feedback: { $elemMatch: { kind: 'decision-withdrawn' } } }).toArray();
  for (const r of withdrawals) {
    for (const f of r.feedback || []) {
      if (f.kind !== 'decision-withdrawn') continue;
      let reason = f.reason;
      if (!reason) { try { reason = JSON.parse(f.message)?.reason; } catch { /* free text */ } }
      if (typeof reason !== 'string' || !reason.startsWith('ticket-closed')) continue;
      const st = await ticketOutcome(r.issueIdentifier);
      if (st && !TERMINAL_TYPES.includes(st.stateType)) found.reopened.push(`${r._id}:${f.kind}`);
    }
  }
  // Scan rows the closer self-resolved: a basis hash equal to the closer's for ANY terminal type.
  if (taskDecisionsStore?.collection) {
    const scans = await taskDecisionsStore.collection.find({ urlKey, outcome: 'self-resolved' }).toArray();
    for (const r of scans) {
      const closerWritten = TERMINAL_TYPES.some(t => r.outcomeBasisHash === ticketClosedBasisHash(r.issueId, t));
      if (!closerWritten) continue;
      const st = await ticketOutcome(r.issueIdentifier);
      if (st && !TERMINAL_TYPES.includes(st.stateType)) found.reopened.push(`${r._id}:self-resolved`);
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
 * How long an active-phase (RESUMING / EXECUTING) runner session may go without
 * activity before it counts as a zombie. Same value and meaning as simple-dispatcher's
 * STALL_FAILSAFE_MS (config.js:50, `parseInt(process.env.STALL_FAILSAFE_MS, 10) || 3600000`,
 * SD 954a164): "non-terminal + silent this long -> re-fire the sentinel over resume
 * (-> FAILED if that yields nothing)". A session still active past it is one SD's own
 * failsafe should already have ended. Tunable: FALSE_LIVE_ACTIVE_BOUND_MS.
 */
export const RUNNER_ACTIVE_BOUND_MS = parseInt(process.env.FALSE_LIVE_ACTIVE_BOUND_MS, 10) || 3600000;
// SD phases.js: ACTIVE_PHASES = RESUMING, EXECUTING. BLOCKED, AWAITING_EXTERNAL and
// AWAITING_FOLLOWUP are neither active nor terminal (the parked phases).
const RUNNER_ACTIVE_PHASES = new Set(['RESUMING', 'EXECUTING']);
const RUNNER_PARKED_PHASES = new Set(['BLOCKED', 'AWAITING_EXTERNAL', 'AWAITING_FOLLOWUP']);

/**
 * Reads the runner's `sessions.json` (`{ sessions: { <id>: {phase, updatedAt,
 * heartbeat, itemMetadata:{issueIdentifier, workspaceKey}} } }`). Read-only.
 * @returns {{ok: true, sessions: Array<Object>}|{ok: false, reason: string}}
 */
export function readRunnerSessions(path, { readFile = readFileSync } = {}) {
  if (!path) return { ok: false, reason: 'no --sessions path given' };
  try {
    const parsed = JSON.parse(readFile(path, 'utf8'));
    const map = parsed?.sessions;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return { ok: false, reason: 'no `sessions` object in file' };
    return { ok: true, sessions: Object.entries(map).map(([id, v]) => ({ id, ...v })) };
  } catch (err) {
    return { ok: false, reason: err?.code || err?.message || String(err) };
  }
}

/**
 * Runner-side zombies and the report-only ticketless-parked line, from one
 * `sessions.json` read joined to ticket state. A session whose ticket cannot be
 * read counts as `unknown` and is never counted as a zombie (fail closed).
 */
export async function runnerMeasure({ read, now, readTicket, boundMs = RUNNER_ACTIVE_BOUND_MS }) {
  if (!read?.ok) return { read: false, reason: read?.reason || 'not read', activeZombies: 0, parkedOnTerminal: 0, activeOnTerminalTicket: 0, unknown: 0, ticketlessParked: { count: 0, oldestAgeMs: null }, sessions: 0 };
  const out = { read: true, sessions: read.sessions.length, activeZombies: 0, activeOnTerminalTicket: 0, parkedOnTerminal: 0, unknown: 0, ticketlessParked: { count: 0, oldestAgeMs: null } };
  const ticketOf = async (sess) => {
    const issue = sess.itemMetadata?.issueIdentifier;
    if (!issue) return { none: true };
    const st = await readTicket(sess.itemMetadata?.workspaceKey, issue).catch(() => null);
    return st ? { st } : { unknown: true };
  };
  for (const sess of read.sessions) {
    const ageMs = now - Math.max(Number(sess.updatedAt) || 0, Number(sess.heartbeat?.lastActivityAt) || 0);
    if (RUNNER_ACTIVE_PHASES.has(sess.phase)) {
      if (ageMs <= boundMs) continue;
      out.activeZombies += 1; // counted whatever the ticket says: a ticketless orchestrator is a zombie too
      const t = await ticketOf(sess);
      if (t.st && TERMINAL_TYPES.includes(t.st.stateType)) out.activeOnTerminalTicket += 1;
      continue;
    }
    if (!RUNNER_PARKED_PHASES.has(sess.phase)) continue;
    const t = await ticketOf(sess);
    if (t.none) {
      out.ticketlessParked.count += 1;
      out.ticketlessParked.oldestAgeMs = Math.max(out.ticketlessParked.oldestAgeMs ?? 0, ageMs);
    } else if (t.unknown) out.unknown += 1;
    else if (TERMINAL_TYPES.includes(t.st.stateType)) out.parkedOnTerminal += 1;
  }
  return out;
}

/**
 * Feedback entries timestamped after a row's own terminal marker or stamp.
 * @returns {{rows: string[], entries: number}}
 */
export function postsAfterEnd(rows) {
  const hit = [];
  let entries = 0;
  for (const r of rows) {
    const fb = r.feedback || [];
    const ends = fb.filter(f => isLineageClosingTerminal(f.message)).map(f => toMs(f.timestamp));
    if (r.bookkeeping?.at) ends.push(toMs(r.bookkeeping.at));
    // The LATEST end, not the first: a held session that is followed up posts [done] again, and
    // that is a session ending twice, not a zombie. Production (30 d, linearviewer): the earliest-end
    // reading flagged 517 rows, 507 of them repeat [done]s; the latest-end reading flags 13, the
    // runner-still-writing shape (mostly [stalled?]) this measure exists to find.
    const endAt = Math.max(...ends.filter(Number.isFinite));
    if (!Number.isFinite(endAt) || endAt === -Infinity) continue;
    const after = fb.filter(f => !isDecisionLifecycleStampEntry(f) && toMs(f.timestamp) > endAt);
    if (after.length) { hit.push(r._id); entries += after.length; }
  }
  return { rows: hit, entries };
}

/** Read-only view of the loops as if C's row stamp had never been written. */
export function withoutTicketClosedStamp(loops) {
  return loops.map(l => (l?.bookkeeping?.reason === TICKET_CLOSED_REASON ? { ...l, bookkeeping: null } : l));
}

/**
 * Runs the instrument. Exported so tests drive it with injected readers.
 *
 * @param {Object} p
 * @param {Object} p.dispatchStore
 * @param {Object} [p.agentStatusStore]
 * @param {(urlKey:string, issue:string)=>Promise<{issueId:string|null, stateType:string}|null>} [p.readTicketState]
 * @param {Object} [p.taskDecisionsStore] - for scan decisions (clause 4) and the scan-row false-close check
 * @param {(urlKey:string)=>Promise<Array<Object>>} [p.readLoops] - defaults to getLoopsForWorkspace (lean)
 */
export async function runFalseLiveRows({
  dispatchStore,
  agentStatusStore = null,
  taskDecisionsStore = null,
  urlKeys = null,
  now = Date.now(),
  headSha = null,
  readTicketState = defaultReadTicketState,
  readLoops = null,
  sessionsPath = null,
  readSessions = readRunnerSessions,
  log = () => {}
}) {
  // One memo for the whole run, shared by the clause checks and the false-close checks.
  const readTicketMemo = createPacedMemoReader(readTicketState, { paceMs: 0 });
  const keys = urlKeys || await dispatchStore.listObservedWorkspaceKeys();
  const loopsOf = readLoops || ((urlKey) => getLoopsForWorkspace(urlKey, { lean: true, dispatchStore, agentStatusStore }));
  const perWorkspace = [];
  for (const urlKey of keys) {
    try {
      const sel = await selectForWorkspace({ dispatchStore, urlKey, now });
      const clause1 = sel.writable.filter(c => c.reason === 'handed-on');
      const clause2 = sel.writable.filter(c => c.reason === 'lineage-terminal');
      const loops = await loopsOf(urlKey);
      const [taskDecisions, newestScanByTask] = taskDecisionsStore
        ? await Promise.all([taskDecisionsStore.listUnansweredForWorkspaces([urlKey]), taskDecisionsStore.listNewestScanPerTask([urlKey])])
        : [[], {}];
      const t = await ticketClauses({ urlKey, loops, taskDecisions, newestScanByTask, now, readTicket: readTicketMemo, dispatchStore });
      const fc = await falseCloses({ dispatchStore, taskDecisionsStore, urlKey, now, readTicket: readTicketMemo });
      const pae = postsAfterEnd(await dispatchStore.historyCollection.find(
        { urlKey, dispatchedAt: { $gte: new Date(now - READ_HORIZON_MS) } },
        { projection: { feedback: 1, bookkeeping: 1 } }).toArray());
      perWorkspace.push({
        urlKey, readFailed: false,
        clause1: clause1.length, clause2: clause2.length, clause3: t.clause3.length, clause4: t.clause4.length,
        clause3NoStamp: t.clause3NoStamp.length, postsAfterEnd: pae,
        unknown: t.unknown.size + fc.unknown, ticketsChecked: t.checked.size,
        humanReopened: t.humanReopened.length, unverified: t.unverified,
        informational: informational(sel.rows, now), falseCloses: fc
      });
    } catch (err) {
      log(`[false-live-rows] ${urlKey}: READ FAILED (${err?.message || err})`);
      perWorkspace.push({ urlKey, readFailed: true, error: err?.message || String(err) });
    }
  }
  // One runner read for the whole run (sessions.json is per host, not per workspace).
  const runner = await runnerMeasure({ read: readSessions(sessionsPath), now, readTicket: readTicketMemo });
  const report = buildReport({ perWorkspace, now, headSha, runner });
  return { report, perWorkspace, runner };
}

export function buildReport({ perWorkspace, now, headSha, runner = null }) {
  const ok = perWorkspace.filter(w => !w.readFailed);
  const failed = perWorkspace.filter(w => w.readFailed);
  const sum = (f) => ok.reduce((n, w) => n + f(w), 0);
  const fc = (k) => sum(w => w.falseCloses[k].length);
  const falseCloseTotal = fc('handed-on') + fc('lineage-terminal') + fc('ticket-closed');
  // c3 is the stamp-disabled reading (LIN-3433; plan I and research §5: c3 is recomputed with C's row stamp
  // disabled). `clause3` (stamp honoured) is kept as a field and a detail line so the writer/measurer tie
  // (closeTicketRows takes it to 0) stays visible until J deletes the writer; it is not counted.
  const total = sum(w => w.clause1 + w.clause2 + w.clause3NoStamp + w.clause4);

  const L = [];
  // Headline: unknown FIRST, so an all-unreadable run cannot pass for a clean zero.
  L.push(`# False live rows — unknown: ${sum(w => w.unknown)} | false-live: ${total} (c1 ${sum(w => w.clause1)}, c2 ${sum(w => w.clause2)}, c3 ${sum(w => w.clause3NoStamp)}, c4 ${sum(w => w.clause4)}) | false closes: ${falseCloseTotal}`);
  if (runner) {
    L.push(`Paired measure (target 0 each) — runner unknown: ${runner.read ? runner.unknown : 'sessions.json not read'} | runner active zombies: ${runner.read ? runner.activeZombies : 'unknown'} | parked on terminal tickets: ${runner.read ? runner.parkedOnTerminal : 'unknown'} | posts after the end: ${sum(w => w.postsAfterEnd.rows.length)} rows`);
  }
  L.push('');
  L.push(`Run at: ${new Date(now).toISOString()}`);
  L.push(`HEAD: ${headSha || '(unknown — not a git checkout)'}`);
  L.push(`Ticket reads: paced ${TICKET_READ_PACE_MS}ms, up to ${TICKET_READ_MAX_RETRIES} retries on 429 (LIN-3399; runs before this were unpaced)`);
  L.push(`Workspaces read: ${ok.length}${failed.length ? ` (${failed.length} FAILED: ${failed.map(w => w.urlKey).join(', ')})` : ''}`);
  L.push(`Horizon: dispatchedAt >= ${new Date(now - READ_HORIZON_MS).toISOString()} (READ_HORIZON_MS); ticket grace ${TICKET_CLOSED_GRACE_MS / 60000}m`);
  L.push('');
  L.push(`unknown (ticket unreadable; never counted as false-live): ${sum(w => w.unknown)}  [tickets checked: ${sum(w => w.ticketsChecked)}]`);
  L.push('  includes: tickets of any workspace other than --ticket-workspace');
  L.push('');
  L.push('Clauses (target 0):');
  L.push(`  1 wake row, a later lineage row has posted (B(a))         ${String(sum(w => w.clause1)).padStart(5)}`);
  L.push(`  2 un-terminated row taken before a lineage terminal (B(b)) ${String(sum(w => w.clause2)).padStart(5)}`);
  L.push(`  3 blocked/silent row on a terminal ticket past grace, C's stamp disabled ${String(sum(w => w.clause3NoStamp)).padStart(5)}`);
  L.push(`  4 open decision on a terminal ticket                      ${String(sum(w => w.clause4)).padStart(5)}`);
  L.push('');
  L.push(`Human-reopened (a reversed ruling / un-retired scan row on a terminal ticket; a decision, not staleness, not counted): ${sum(w => w.humanReopened)}`);
  L.push(`Unverified (legacy digest not resolvable from raw feedback; held out, not counted): ${sum(w => w.unverified)}`);
  L.push('');
  if (runner) {
    const h = (ms) => (ms == null ? 'n/a' : `${Math.round(ms / 3600000)}h`);
    L.push('Paired measure (LIN-3433; target 0 each):');
    L.push(`  5 feedback posted after a row's own terminal/stamp        ${String(sum(w => w.postsAfterEnd.rows.length)).padStart(5)}   [${sum(w => w.postsAfterEnd.entries)} entries]`);
    if (runner.read) {
      L.push(`  6 runner: active-phase sessions silent > ${Math.round(RUNNER_ACTIVE_BOUND_MS / 60000)}m           ${String(runner.activeZombies).padStart(5)}   [${runner.activeOnTerminalTicket} on a terminal ticket]`);
      L.push(`  7 runner: parked sessions on a terminal ticket            ${String(runner.parkedOnTerminal).padStart(5)}`);
      L.push(`  runner sessions read: ${runner.sessions}; ticket unreadable (unknown, not counted): ${runner.unknown}`);
      L.push(`  Report-only, no target, not in 7: parked sessions with no ticket: ${runner.ticketlessParked.count} (oldest ${h(runner.ticketlessParked.oldestAgeMs)})`);
    } else {
      L.push(`  6, 7 runner: UNKNOWN — sessions.json not read (${runner.reason}); this is not a zero`);
    }
    L.push('  Runner scope: only THIS host\'s sessions.json is read; runner-kit runners on other machines are not visible.');
    L.push('');
  }
  L.push(`  (informational, not counted: line 3 with C's row stamp honoured, as before LIN-3433: ${sum(w => w.clause3)})`);
  L.push('');
  L.push('By workspace (c1 c2 c3 c4 unknown; c3 = stamp disabled):');
  for (const w of ok) L.push(`  ${w.urlKey.padEnd(28)} ${w.clause1} ${w.clause2} ${w.clause3NoStamp} ${w.clause4} ${w.unknown}`);
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

export function parseSessionsPath(argv) {
  const i = argv.indexOf('--sessions');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

export function parseTicketWorkspace(argv) {
  const i = argv.indexOf('--ticket-workspace');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

async function main() {
  const ticketUrlKey = parseTicketWorkspace(process.argv) || process.env.FALSE_LIVE_TICKET_URLKEY || null;
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
    const taskDecisionsStore = new TaskDecisionsStore({ collection: db.collection('task-decisions') });
    const { report } = await runFalseLiveRows({
      dispatchStore,
      agentStatusStore,
      taskDecisionsStore,
      headSha: readHeadSha(),
      sessionsPath: parseSessionsPath(process.argv) || process.env.FALSE_LIVE_SESSIONS_PATH || null,
      readTicketState: createPacedMemoReader((k, issue) => defaultReadTicketState(k, issue, { ticketUrlKey })),
      log: (m) => console.error(m) });
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
