/**
 * Ticket-closed sweep (LIN-3366). The scheduler job body: the load-bearing
 * path for ticket changes made in the tracker UI (there is no webhook route).
 * The write seams are only the fast path.
 *
 * Per workspace: lean loops once, `prepareCloserCandidates` once, then one
 * provider read per candidate TICKET (never per settled item, never for a
 * reversed/un-retired item: phase one already removed them). Candidate tickets
 * are ordered least-recently-read first (never-read first, then oldest
 * activity) and capped at SWEEP_TICKET_READS_PER_WORKSPACE per tick. Oldest-
 * first would starve the tail: a blocked row on an In Progress ticket is a
 * permanent candidate, so any fixed order starves everything after the cap.
 *
 * Unattended, so it fails closed: a `null` ticket read closes nothing, a
 * verify problem leaves loops held out, and one failed ticket/workspace never
 * stops the others.
 */

import { getLoopsForWorkspace } from './pipeline-loops.js';
import { TERMINAL_TYPES } from './providers/models.js';
import { prepareCloserCandidates, closeTicketRows } from './ticket-close-closer.js';

export const SWEEP_TICKET_READS_PER_WORKSPACE = 20;
const LOG = '[ticket-closer]';

/**
 * @param {Object} deps
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.taskDecisionsStore
 * @param {Object} deps.agentStatusStore
 * @param {Object} [deps.sessionsFeedCache]
 * @param {(urlKey:string, identifier:string, opts:{source?:string})=>Promise<{issueId:string|null, stateType:string}|null>} deps.readTicketState
 * @param {number} deps.intervalMs
 * @param {Function} [deps.now]
 * @returns {() => Promise<Object>}
 */
export function createTicketCloseSweepRun({
  dispatchStore, taskDecisionsStore, agentStatusStore, sessionsFeedCache = null, readTicketState, intervalMs,
  now = Date.now, getLoops = getLoopsForWorkspace, closeRows = closeTicketRows, prepare = prepareCloserCandidates,
  log = (m) => console.error(m)
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('ticket-close-sweep: createTicketCloseSweepRun requires a positive intervalMs');
  }
  if (!dispatchStore || !taskDecisionsStore || typeof readTicketState !== 'function') {
    throw new Error('ticket-close-sweep: dispatchStore, taskDecisionsStore and readTicketState are required');
  }

  const lastReadAt = new Map(); // `${urlKey}::${identifier}` -> epoch ms; resets on boot (restarts the rotation)
  let tickCount = 0;

  return async () => {
    const tickNow = now();
    const tick = tickCount++;
    const totals = { workspaces: 0, ticketsRead: 0, terminal: 0, closedRows: 0, withdrawn: 0, resolved: 0, refused: 0, failures: 0 };
    const observed = await dispatchStore.listObservedWorkspaceKeys().catch(() => []);
    const roster = [...new Set(observed || [])].sort();
    if (!roster.length) return totals;
    const start = tick % roster.length;
    const ordered = [...roster.slice(start), ...roster.slice(0, start)];

    for (const urlKey of ordered) {
      try {
        const r = await sweepOneWorkspace(urlKey, tickNow);
        totals.workspaces += 1;
        for (const k of ['ticketsRead', 'terminal', 'closedRows', 'withdrawn', 'resolved', 'refused', 'failures']) totals[k] += r[k];
      } catch (err) {
        totals.failures += 1;
        log(`${LOG} sweep workspace ${urlKey} failed: ${err?.message || err}`);
      }
    }
    return totals;
  };

  async function sweepOneWorkspace(urlKey, tickNow) {
    const out = { ticketsRead: 0, terminal: 0, closedRows: 0, withdrawn: 0, resolved: 0, refused: 0, failures: 0 };
    const loops = await getLoops(urlKey, { lean: true, dispatchStore, agentStatusStore });
    const [taskDecisions, newestScanByTask] = await Promise.all([
      taskDecisionsStore.listUnansweredForWorkspaces([urlKey]),
      taskDecisionsStore.listNewestScanPerTask([urlKey])
    ]);
    const prepared = await prepare({ loops, taskDecisions, newestScanByTask, now: tickNow, dispatchStore, log });

    // Candidate tickets from phase-one output only. The oldest activity per
    // ticket breaks ties among equally-recently-read tickets.
    const activityOf = new Map(loops.map(l => [l.loopId, Date.parse(l.dispatchedAt) || 0]));
    const tickets = new Map(); // identifier -> {identifier, source, activity}
    const note = (identifier, source, activity) => {
      if (!identifier) return;
      const t = tickets.get(identifier);
      if (!t) tickets.set(identifier, { identifier, source: source || undefined, activity });
      else t.activity = Math.min(t.activity, activity);
    };
    for (const r of prepared.rows) note(r.issueIdentifier, r.issueSource, activityOf.get(r.loopId) || 0);
    for (const d of prepared.loopDecisions) note(d.issueIdentifier, d.issueSource, activityOf.get(d.loopId) || 0);
    for (const s of prepared.scanDecisions) note(s.issueIdentifier, s.issueSource, 0);

    const keyOf = (t) => `${urlKey}::${t.identifier}`;
    const batch = [...tickets.values()]
      .sort((a, b) => {
        const ra = lastReadAt.has(keyOf(a)) ? lastReadAt.get(keyOf(a)) : -1;
        const rb = lastReadAt.has(keyOf(b)) ? lastReadAt.get(keyOf(b)) : -1;
        return (ra - rb) || (a.activity - b.activity) || a.identifier.localeCompare(b.identifier);
      })
      .slice(0, SWEEP_TICKET_READS_PER_WORKSPACE);

    for (const t of batch) {
      let state = null;
      try {
        lastReadAt.set(keyOf(t), tickNow);
        out.ticketsRead += 1;
        state = await readTicketState(urlKey, t.identifier, { source: t.source });
      } catch (err) {
        log(`${LOG} ticket read failure for ${t.identifier}: ${err?.message || err}`);
      }
      if (!state || !state.stateType) continue; // unreadable: close nothing
      if (!TERMINAL_TYPES.includes(state.stateType)) continue;
      out.terminal += 1;
      try {
        const r = await closeRows({
          urlKey,
          ticket: { issueId: state.issueId || null, identifier: t.identifier, stateType: state.stateType },
          dispatchStore, taskDecisionsStore, sessionsFeedCache, agentStatusStore,
          candidates: prepared, now: tickNow
        });
        for (const k of ['closedRows', 'withdrawn', 'resolved', 'refused', 'failures']) out[k] += r?.[k] || 0;
      } catch (err) {
        out.failures += 1;
        log(`${LOG} close failure for ${t.identifier}: ${err?.message || err}`);
      }
    }
    return out;
  }
}
