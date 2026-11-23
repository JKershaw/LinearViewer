#!/usr/bin/env node
/**
 * Ticket-closed historical clear (LIN-3399, slice F of LIN-3358).
 *
 * One-off: closes the blocked/silent rows and ends the open questions that
 * sit on tickets that are ALREADY terminal, from before the source closers
 * (LIN-3365 handover/lineage-terminal, LIN-3366 seams) existed. The retired
 * `ticket-closed-sweep` was the only thing that would have reached them.
 * (LIN-4538: questions are ended `withdrawn`, reason "ticket closed"; the
 * ruling stores are no longer read.)
 *
 * Reuses the closer, no second write path: candidates come from
 * `prepareCloserCandidates`, the ticket is read through the instrument's paced,
 * memoised proxy reader, and the write is `closeTicketRows({candidates, by})`
 * (rows first, then the tickets' open questions). The 30-day
 * horizon is the loop reader's own (`READ_HORIZON_MS`); there is no flag to widen it.
 *
 * NOT a route, NOT autopilot-reachable, no import site in the app.
 *
 * Usage:
 *   node scripts/ticket-closed-clear-lin3399.js --ticket-workspace <urlKey>             # DRY RUN
 *   node scripts/ticket-closed-clear-lin3399.js --ticket-workspace <urlKey> --execute   # writes
 *   ... --by <label>   # actor recorded on each row stamp
 *
 * Ticket reads go through HARBOUR_LOCAL_BASE, which is ONE workspace's proxy, so
 * only `--ticket-workspace` (or FALSE_LIVE_TICKET_URLKEY) is cleared; every other
 * workspace's tickets read `unknown` and nothing is written for them.
 *
 * ORDER (load-bearing): run AFTER `scripts/lineage-close-backfill-lin3365.js
 * --execute`. Run earlier, this would stamp rows `ticket-closed` that belong to
 * a closed lineage (`lineage-terminal` / `handed-on`). `--execute` is therefore
 * REFUSED while the lineage selector still has writable rows. `--execute`
 * against production only on John's recorded yes (the LIN-2633 / LIN-2655 /
 * LIN-3365 gate); an earlier approval is not retroactive authorization.
 */

import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../lib/dispatch-store.js';
import { AgentStatusStore } from '../lib/agent-status-store.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../lib/records-store.js';
import { questionFacts, openQuestionFacts } from '../lib/records/question-facts.js';
import { questionStandingOf } from '../lib/records/question-standing.js';
import { getLoopsForWorkspace } from '../lib/pipeline-loops.js';
import { prepareCloserCandidates, selectTicketCloseWork, closeTicketRows } from '../lib/ticket-close-closer.js';
import { TERMINAL_TYPES } from '../lib/providers/models.js';
import { READ_HORIZON_MS } from '../lib/read-horizon.js';
import { TICKET_CLOSED_GRACE_MS } from '../lib/lineage-closure.js';
import { selectForWorkspace } from './lineage-close-backfill-lin3365.js';
import { defaultReadTicketState, createPacedMemoReader, parseTicketWorkspace, readHeadSha } from './false-live-rows.js';

export const CLEAR_BY_DEFAULT = 'ticket-closed-clear-lin3399';

/** Raised by `--execute` while LIN-3365's backfill has not been run. */
export class LineageBackfillPendingError extends Error {
  constructor(pending) {
    super(`refusing --execute: the lineage selector still has ${pending} writable row(s). Run scripts/lineage-close-backfill-lin3365.js --execute first, or this clear would stamp lineage-closed rows as ticket-closed.`);
    this.name = 'LineageBackfillPendingError';
    this.pending = pending;
  }
}

/** The open questions of one workspace, by ticket (LIN-4538): what closeTicketRows ends on a terminal ticket. */
async function openQuestionsByTicket(recordsStore, urlKey) {
  const byTicket = new Map();
  if (!recordsStore) return byTicket;
  for (const q of openQuestionFacts(await questionFacts(recordsStore, urlKey))) {
    if (!q.ticket) continue;
    byTicket.set(q.ticket, (byTicket.get(q.ticket) || 0) + 1);
  }
  return byTicket;
}

/** What a terminal ticket would have written: its session rows and its open questions. */
const countWork = (work, questions) => work.rows.length + (questions || 0);

async function readCandidates({ urlKey, now, dispatchStore, agentStatusStore, recordsStore, readLoops, persist }) {
  const loops = readLoops
    ? await readLoops(urlKey)
    : await getLoopsForWorkspace(urlKey, { lean: true, dispatchStore, agentStatusStore });
  const questionStanding = recordsStore ? await questionStandingOf(recordsStore, urlKey) : new Map();
  const candidates = await prepareCloserCandidates({ loops, questionStanding, now, dispatchStore, persist });
  return { candidates, openQuestions: await openQuestionsByTicket(recordsStore, urlKey) };
}

/**
 * Runs the clear. Exported so tests drive it with injected readers.
 *
 * @param {Object} p
 * @param {(urlKey:string, issue:string)=>Promise<{issueId:string|null, stateType:string}|null>} p.readTicketState
 * @returns {Promise<{report: string, perWorkspace: Array<Object>, execute: boolean, remaining: number|null}>}
 */
export async function runTicketClosedClear({
  dispatchStore,
  agentStatusStore = null,
  recordsStore = null,
  sessionsFeedCache = null,
  readTicketState,
  urlKeys = null,
  now = Date.now(),
  execute = false,
  by = null,
  headSha = null,
  readLoops = null,
  log = () => {}
}) {
  const keys = urlKeys || await dispatchStore.listObservedWorkspaceKeys();
  const actor = by || CLEAR_BY_DEFAULT;
  // One memo for the run: the before-selection, the write and the idempotence re-check share reads.
  const readTicket = createPacedMemoReader(readTicketState, { paceMs: 0 });
  log(`[ticket-clear] ${execute ? 'EXECUTE' : 'DRY RUN'} over ${keys.length} workspace(s)`);

  if (execute) {
    // Precondition for the whole run, checked before the first write.
    let pending = 0;
    for (const urlKey of keys) pending += (await selectForWorkspace({ dispatchStore, urlKey, now })).writable.length;
    if (pending > 0) throw new LineageBackfillPendingError(pending);
  }

  const perWorkspace = [];
  let remaining = execute ? 0 : null;
  for (const urlKey of keys) {
    try {
      const { candidates, openQuestions } = await readCandidates({ urlKey, now, dispatchStore, agentStatusStore, recordsStore, readLoops, persist: execute });
      const tickets = [...new Set([...candidates.rows.map(c => c.issueIdentifier), ...openQuestions.keys()].filter(Boolean))];
      const w = {
        urlKey, readFailed: false, tickets: tickets.length, terminalTickets: 0, unknown: 0, notTerminal: 0,
        rows: 0, questions: 0,
        humanReopened: candidates.settled.length, unverified: candidates.unverified.length,
        closed: { closedRows: 0, withdrawn: 0, failures: 0 }
      };
      const terminal = [];
      for (const issueIdentifier of tickets) {
        const st = await readTicket(urlKey, issueIdentifier).catch(() => null);
        if (!st) { w.unknown += 1; continue; }
        if (!TERMINAL_TYPES.includes(st.stateType)) { w.notTerminal += 1; continue; }
        const ticket = { issueId: st.issueId, identifier: issueIdentifier, stateType: st.stateType };
        const work = selectTicketCloseWork(candidates, ticket);
        const questions = openQuestions.get(issueIdentifier) || 0;
        w.terminalTickets += 1;
        w.rows += work.rows.length;
        w.questions += questions;
        if (countWork(work, questions)) terminal.push(ticket);
      }
      log(`[ticket-clear] ${urlKey}: ${w.rows} row(s), ${w.questions} open question(s) on ${w.terminalTickets} terminal ticket(s); ${w.unknown} unreadable`);

      if (execute) {
        for (const ticket of terminal) {
          const r = await closeTicketRows({ urlKey, ticket, dispatchStore, recordsStore, sessionsFeedCache, agentStatusStore, candidates, now, by: actor, log, info: log });
          for (const k of Object.keys(w.closed)) w.closed[k] += r[k] || 0;
        }
        // Idempotence: re-select; whatever is still selectable on a terminal ticket remains.
        const again = await readCandidates({ urlKey, now, dispatchStore, agentStatusStore, recordsStore, readLoops, persist: false });
        let left = 0;
        for (const ticket of terminal) left += countWork(selectTicketCloseWork(again.candidates, ticket), again.openQuestions.get(ticket.identifier));
        w.remainingAfter = left;
        remaining += left;
      }
      perWorkspace.push(w);
    } catch (err) {
      log(`[ticket-clear] ${urlKey}: READ FAILED (${err?.message || err}) — writing nothing for this workspace`);
      perWorkspace.push({ urlKey, readFailed: true, error: err?.message || String(err) });
    }
  }
  const report = buildReport({ perWorkspace, now, headSha, execute, remaining });
  return { report, perWorkspace, execute, remaining };
}

export function buildReport({ perWorkspace, now, headSha, execute, remaining }) {
  const ok = perWorkspace.filter(w => !w.readFailed);
  const failed = perWorkspace.filter(w => w.readFailed);
  const sum = (f) => ok.reduce((n, w) => n + f(w), 0);
  const L = [];
  L.push(`# Ticket-closed clear — ${execute ? 'EXECUTE' : 'DRY RUN'} (LIN-3399)`);
  L.push('');
  L.push(`Run at: ${new Date(now).toISOString()}`);
  L.push(`HEAD: ${headSha || '(unknown — not a git checkout)'}`);
  L.push(`Horizon: the loop reader's ${READ_HORIZON_MS / 86400000}d (READ_HORIZON_MS); quiet grace ${TICKET_CLOSED_GRACE_MS / 60000}m`);
  L.push(`Workspaces read: ${ok.length}${failed.length ? ` (${failed.length} FAILED: ${failed.map(w => w.urlKey).join(', ')} — wrote nothing)` : ''}`);
  L.push(`Candidate tickets: ${sum(w => w.tickets)}  (unreadable: ${sum(w => w.unknown)} — never cleared; not terminal: ${sum(w => w.notTerminal)}; terminal: ${sum(w => w.terminalTickets)})`);
  L.push('');
  L.push(`## ${execute ? 'Selected' : 'Would clear'}`);
  L.push(`  blocked/silent rows (clause 3)        ${String(sum(w => w.rows)).padStart(5)}`);
  L.push(`  open questions (ended withdrawn)      ${String(sum(w => w.questions)).padStart(5)}`);
  L.push('');
  L.push('## Would NOT clear (explain each remainder)');
  L.push(`  unreadable ticket                     ${String(sum(w => w.unknown)).padStart(5)}   fail closed; re-run the paced reader`);
  L.push(`  human-reopened                        ${String(sum(w => w.humanReopened)).padStart(5)}   a reversed ruling: a decision, not staleness`);
  L.push(`  unverified legacy digest              ${String(sum(w => w.unverified)).padStart(5)}   held out until raw feedback resolves it`);
  L.push('');
  L.push('By workspace (rows, open questions, unknown):');
  for (const w of ok) L.push(`  ${w.urlKey.padEnd(28)} ${w.rows} ${w.questions} ${w.unknown}`);
  if (execute) {
    const c = (k) => sum(w => w.closed[k]);
    L.push('');
    L.push(`## Written: ${c('closedRows')} row(s) stamped, ${c('withdrawn')} question(s) ended withdrawn`);
    L.push(`Failures: ${c('failures')}`);
    L.push('');
    L.push(`## Idempotence check: ${remaining} still selectable after the run${remaining === 0 ? ' (ok)' : ' — NOT 0: rows changed since select (write-filter refusal) or a write failed; bucket each before relying on this'}`);
  } else {
    L.push('');
    L.push('Dry run — nothing was written. Re-run with --execute (only after LIN-3365\'s backfill has executed, and on John\'s recorded yes) to write.');
  }
  return L.join('\n');
}

async function main() {
  const execute = process.argv.includes('--execute');
  const byIndex = process.argv.indexOf('--by');
  const by = byIndex !== -1 ? (process.argv[byIndex + 1] || null) : null;
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
    const recordsStore = new RecordsStore({
      records: db.collection(RECORDS_COLLECTION),
      refs: db.collection(REFS_COLLECTION),
      queryLog: db.collection(QUERY_LOG_COLLECTION)
    });
    const { report } = await runTicketClosedClear({
      dispatchStore, agentStatusStore, recordsStore, execute, by, headSha: readHeadSha(),
      // Only the proxied workspace is readable; paced (1.1s) with 429 retries.
      urlKeys: ticketUrlKey ? [ticketUrlKey] : null,
      readTicketState: createPacedMemoReader((k, issue) => defaultReadTicketState(k, issue, { ticketUrlKey })),
      log: (m) => console.error(m)
    });
    console.log(report);
  } finally {
    if (dbClient.close) await dbClient.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[ticket-clear] failed:', err);
    process.exitCode = 1;
  });
}
