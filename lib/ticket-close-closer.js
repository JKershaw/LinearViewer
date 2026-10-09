/**
 * Ticket-closed closer (LIN-3366, slice C of LIN-3358).
 *
 * When a ticket reaches a terminal state (`TERMINAL_TYPES`: completed,
 * canceled, duplicate), the rows and decision records that belong to it stop
 * reading as live work. A and B stamp rows at session-level events; this is the
 * one slice that reacts to the TICKET ending.
 *
 * Shape: a pure two-phase selector plus one closer.
 *   - Phase one `closerCandidates` needs no ticket state: it applies every
 *     ineligibility that does not depend on the ticket (classification, quiet
 *     bound, human reversals, unknown legacy digests) so a settled item never
 *     costs a provider read.
 *   - `prepareCloserCandidates` resolves legacy-digest `unknown` loops from RAW
 *     feedback before any write (fail closed).
 *   - Phase two `selectTicketCloseWork` joins on the ticket that was read.
 *   - `closeTicketRows` writes: close rows FIRST, then withdraw decisions
 *     (a withdrawal appends feedback stamped now, which `closeIssueRows`
 *     would read as activity newer than `quietSince`).
 *
 * Reversal is terminal. `withdrawalReversed` on a loop is three-state: `true`,
 * `false`, or `undefined` (a pre-ship digest that lacks the key). Absent is NOT
 * false: an unknown loop is held out of every write until raw feedback says
 * which it is. `isFreshDigest` is deliberately untouched.
 */

import { classifyLoop } from './observer-sweep.js';
import { DEFAULT_LANE_STALE_MS, loopLastActivityMs } from './live-console.js';
import { computeSupersededLoopIds } from './loop-supersede.js';
import { collectUnansweredDecisions, answeredDecisionIdsByLineage } from './unanswered-decisions.js';
import { TERMINAL_TYPES } from './providers/models.js';
import { TICKET_CLOSED_GRACE_MS } from './lineage-closure.js';
import { redigestHistoryRows, getLoopsForWorkspace } from './pipeline-loops.js';
import { createHash } from 'node:crypto';

export const TICKET_CLOSED_REASON = 'ticket-closed';
/** Max raw re-reads per `prepareCloserCandidates` call; the rest converge on later ticks. */
export const LEGACY_VERIFY_CAP = 200;

const LOG = '[ticket-closer]';

/**
 * Whether a loop's current decision was reversed by a human.
 * `'reversed'` (`true`), `'clear'` (`false`, or no current decision) or
 * `'unknown'` (key absent on a loop that HAS a current decision).
 */
export function reversalState(loop) {
  if (!loop?.decision?.decision_id) return 'clear';
  if (loop.withdrawalReversed === true) return 'reversed';
  if (loop.withdrawalReversed === false) return 'clear';
  return 'unknown';
}

/**
 * A settled item is one a human chose to keep live: a loop whose current
 * decision's withdrawal was reversed, or a scan row carrying `ticketClosedAt`
 * (stamped by the closer, then un-retired by `reverseOutcome`).
 */
export function isSettledForCloser(item) {
  if (item?.ticketClosedAt != null) return true;
  return reversalState(item) === 'reversed';
}

/**
 * Phase one: pure, no I/O, no ticket state.
 *
 * @returns {{rows: Array, loopDecisions: Array, scanDecisions: Array,
 *   settled: Array, unverified: string[]}}
 */
export function closerCandidates({ loops = [], taskDecisions = [], newestScanByTask = {}, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const quietBefore = nowMs - TICKET_CLOSED_GRACE_MS;
  const superseded = computeSupersededLoopIds(loops);
  const answeredByLineage = answeredDecisionIdsByLineage(loops);
  const byLoopId = new Map(loops.map(l => [l.loopId, l]));

  const rows = [];
  const loopDecisions = [];
  const scanDecisions = [];
  const settled = [];
  const unverified = new Set();

  // Rows: the reader's own blocked/silent classification is the trigger.
  for (const loop of loops) {
    if (!loop?.issueIdentifier) continue;
    if (loop.source !== 'history') continue;
    const lane = classifyLoop(loop, { superseded, now: nowMs, staleMs: DEFAULT_LANE_STALE_MS, answeredByLineage });
    if (lane !== 'blocked' && lane !== 'silent') continue;
    if (loopLastActivityMs(loop) > quietBefore) continue;
    const state = reversalState(loop);
    if (state === 'reversed') { settled.push({ type: 'row', loopId: loop.loopId, issueIdentifier: loop.issueIdentifier }); continue; }
    if (state === 'unknown') { unverified.add(loop.loopId); continue; }
    rows.push({ loopId: loop.loopId, issueIdentifier: loop.issueIdentifier, issueId: loop.issueId || null, issueSource: loop.issueSource ?? null });
  }

  // Loop-backed decisions. No shelvedRulings: an actively shelved ruling on a
  // closed ticket is withdrawn too.
  const loopHalf = collectUnansweredDecisions({ loops, taskDecisions: [], newestScanByTask }, { now: new Date(nowMs) });
  for (const d of loopHalf) {
    const loopId = d.stampLoopId;
    if (!loopId) continue;
    const content = byLoopId.get(loopId);
    const identifier = d.anchor?.issueIdentifier;
    if (!content || !identifier || !d.decision?.decision_id) continue;
    if (loopLastActivityMs(content) > quietBefore) continue; // the lineage must be quiet
    const state = reversalState(content);
    if (state === 'reversed') { settled.push({ type: 'loopDecision', loopId, decisionId: d.decision.decision_id, issueIdentifier: identifier }); continue; }
    if (state === 'unknown') { unverified.add(loopId); continue; }
    loopDecisions.push({ loopId, decisionId: d.decision.decision_id, issueIdentifier: identifier, issueId: d.anchor.issueId || null, issueSource: d.anchor.source ?? null });
  }

  // Scan decisions: no lineage, only the terminal ticket.
  const scanById = new Map((taskDecisions || []).filter(Boolean).map(t => [t.id, t]));
  const taskHalf = collectUnansweredDecisions({ loops: [], taskDecisions, newestScanByTask }, { now: new Date(nowMs) });
  for (const d of taskHalf) {
    const id = d.anchor?.taskDecisionId;
    if (!id) continue;
    const scan = scanById.get(id);
    if (isSettledForCloser({ ticketClosedAt: scan?.ticketClosedAt ?? null })) {
      settled.push({ type: 'scanDecision', id, issueIdentifier: d.anchor.issueIdentifier });
      continue;
    }
    scanDecisions.push({
      id,
      urlKey: d.anchor.workspaceUrlKey || null,
      issueId: d.anchor.issueId || null,
      issueIdentifier: d.anchor.issueIdentifier || null,
      issueSource: d.anchor.source ?? null
    });
  }

  return { rows, loopDecisions, scanDecisions, settled, unverified: [...unverified] };
}

/**
 * Phase one plus legacy-digest verification. Loops whose digest predates
 * `withdrawalReversed` are re-derived from RAW feedback and re-run through
 * phase one; a verification failure leaves them in `unverified` (nothing is
 * written for them this tick).
 *
 * @param {Object} p
 * @param {Object} p.dispatchStore - needs `historyCollection`
 * @param {boolean} [p.persist=true] - write the healed digest back (the instrument passes false)
 * @returns {Promise<ReturnType<typeof closerCandidates> & {loops: Array}>}
 */
export async function prepareCloserCandidates({
  loops = [], taskDecisions = [], newestScanByTask = {}, now, dispatchStore, persist = true,
  redigest = redigestHistoryRows, log = (m) => console.error(m)
} = {}) {
  let candidates = closerCandidates({ loops, taskDecisions, newestScanByTask, now });
  if (candidates.unverified.length === 0) return { ...candidates, loops };

  const ids = candidates.unverified.slice(0, LEGACY_VERIFY_CAP);
  let healed = null;
  try {
    if (!dispatchStore?.historyCollection) throw new Error('no historyCollection to verify against');
    healed = await redigest(ids, dispatchStore, { persist });
  } catch (err) {
    log(`${LOG} verify failure: ${err?.message || err}`);
    return { ...candidates, loops };
  }
  const missed = ids.filter(id => !healed.has(id));
  if (missed.length) log(`${LOG} verify failure: ${missed.length} row(s) missing on raw re-read (${missed.slice(0, 5).join(', ')})`);

  const patched = loops.map((l) => {
    const h = healed.get(l.loopId);
    if (!h || typeof h.feedbackDigest?.withdrawalReversed !== 'boolean') return l;
    return { ...l, withdrawalReversed: h.feedbackDigest.withdrawalReversed };
  });
  candidates = closerCandidates({ loops: patched, taskDecisions, newestScanByTask, now });
  return { ...candidates, loops: patched };
}

/**
 * Phase two: join the prepared candidates on the ticket that was read.
 * Loops join on identifier; scan rows on `issueId` equality (a mismatched row
 * is never selected, counted in `skipped.issueIdMismatch`).
 *
 * @param {Object} candidates
 * @param {{issueId?: string|null, identifier: string, stateType: string}} ticket
 */
export function selectTicketCloseWork(candidates, ticket) {
  const out = { rows: [], loopDecisions: [], scanDecisions: [], skipped: { issueIdMismatch: 0 } };
  if (!ticket?.identifier || !TERMINAL_TYPES.includes(ticket.stateType)) return out;
  out.rows = candidates.rows.filter(r => r.issueIdentifier === ticket.identifier);
  out.loopDecisions = candidates.loopDecisions.filter(d => d.issueIdentifier === ticket.identifier);
  for (const s of candidates.scanDecisions) {
    if (s.issueIdentifier !== ticket.identifier) continue;
    if (!ticket.issueId || s.issueId !== ticket.issueId) { out.skipped.issueIdMismatch += 1; continue; }
    out.scanDecisions.push(s);
  }
  return out;
}

/**
 * The ticket (id, identifier, state type) from a provider write payload, which
 * may be the issue or `{success, issue}`. The state type is taken from the
 * WRITTEN issue, never inferred from the request's symbolic `stateId`; when the
 * payload lacks it, `readBack` is called once. Returns `null` when unresolved.
 */
export async function ticketFromWrite(written, { readBack } = {}) {
  const unwrap = (v) => (v && typeof v === 'object' && v.issue && typeof v.issue === 'object' ? v.issue : v);
  const pick = (issue) => {
    const stateType = issue?.state?.type;
    if (typeof stateType !== 'string' || !stateType || !issue?.identifier) return null;
    return { issueId: issue.id || null, identifier: issue.identifier, stateType };
  };
  const direct = pick(unwrap(written));
  if (direct) return direct;
  if (typeof readBack !== 'function') return null;
  try {
    const read = await readBack();
    return pick(unwrap(read?.issue ? read.issue : read));
  } catch (err) {
    console.error(`${LOG} read-back failure: ${err?.message || err}`);
    return null;
  }
}

export const ticketClosedBasisHash = (issueId, stateType) =>
  createHash('sha256').update(`ticket-closed:${issueId}:${stateType}`).digest('hex');

const dateLabel = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * Write the close for one resolved terminal ticket. Does no provider IO: the
 * caller established terminality. Every error is caught and logged.
 *
 * @param {Object} p
 * @param {string} p.urlKey
 * @param {{issueId: string|null, identifier: string, stateType: string}} p.ticket
 * @param {Object} p.dispatchStore
 * @param {Object} [p.taskDecisionsStore]
 * @param {Object} [p.sessionsFeedCache]
 * @param {Object} [p.agentStatusStore] - for the lean loops read when `candidates` is absent
 * @param {Object} [p.candidates] - already prepared (the one-off clear passes its own)
 * @param {number} [p.now]
 * @param {string} [p.by='ticket-closer'] - actor recorded on each row stamp (the one-off clear passes its own)
 * @returns {Promise<{closedRows: number, withdrawn: number, resolved: number, refused: number, skipped: Object, failures: number}>}
 */
export async function closeTicketRows({
  urlKey, ticket, dispatchStore, taskDecisionsStore = null, sessionsFeedCache = null, agentStatusStore = null,
  candidates = null, now = Date.now(), by = 'ticket-closer', log = (m) => console.error(m), info = (m) => console.log(m),
  getLoops = getLoopsForWorkspace, redigest
} = {}) {
  const result = { closedRows: 0, withdrawn: 0, resolved: 0, refused: 0, skipped: { issueIdMismatch: 0 }, failures: 0 };
  try {
    if (!urlKey || !ticket?.identifier || !TERMINAL_TYPES.includes(ticket.stateType) || !dispatchStore) return result;

    let prepared = candidates;
    if (!prepared) {
      const loops = await getLoops(urlKey, { lean: true, dispatchStore, agentStatusStore });
      const [taskDecisions, newestScanByTask] = taskDecisionsStore
        ? await Promise.all([taskDecisionsStore.listUnansweredForWorkspaces([urlKey]), taskDecisionsStore.listNewestScanPerTask([urlKey])])
        : [[], {}];
      prepared = await prepareCloserCandidates({ loops, taskDecisions, newestScanByTask, now, dispatchStore, log, ...(redigest ? { redigest } : {}) });
    }

    const work = selectTicketCloseWork(prepared, ticket);
    result.skipped = work.skipped;
    const reason = `${TICKET_CLOSED_REASON}: ${ticket.identifier} reached ${ticket.stateType}`;
    let cacheDirty = false;

    // 1. Close rows FIRST — a withdrawal appends feedback stamped now, which
    // closeIssueRows' quiet bound would read as activity and refuse.
    if (work.rows.length) {
      try {
        const r = await dispatchStore.closeIssueRows(urlKey, ticket.identifier, {
          ids: work.rows.map(x => x.loopId),
          quietSince: new Date(now - TICKET_CLOSED_GRACE_MS),
          reason: TICKET_CLOSED_REASON,
          by
        });
        if (!r?.ok) { result.failures += 1; log(`${LOG} failure: closeIssueRows not ok for ${ticket.identifier}`); }
        else result.closedRows = r.closedIds.length;
      } catch (err) {
        result.failures += 1;
        log(`${LOG} failure: closeIssueRows threw for ${ticket.identifier}: ${err?.message || err}`);
      }
    }

    // 2. Withdraw loop-backed decisions (direct history write, not addFeedback).
    for (const d of work.loopDecisions) {
      try {
        const r = await dispatchStore.markDecisionWithdrawn(d.loopId, urlKey, d.decisionId, reason);
        if (r === null || r === undefined) { result.failures += 1; log(`${LOG} failure: markDecisionWithdrawn returned null for ${d.loopId}/${d.decisionId}`); }
        else if (r.refused) { result.refused += 1; info(`${LOG} refused (${r.refused}) withdrawing ${d.loopId}/${d.decisionId}`); }
        else { result.withdrawn += 1; cacheDirty = true; }
      } catch (err) {
        result.failures += 1;
        log(`${LOG} failure: markDecisionWithdrawn threw for ${d.loopId}: ${err?.message || err}`);
      }
    }

    // 3. Retire scan decisions (reversible self-resolve, marked ticketClosed).
    if (taskDecisionsStore) {
      for (const s of work.scanDecisions) {
        try {
          const r = await taskDecisionsStore.markOutcome({
            urlKey,
            issueId: s.issueId,
            id: s.id,
            outcome: 'self-resolved',
            outcomeReason: `Ticket ${ticket.identifier} reached ${ticket.stateType} on ${dateLabel(now)}`,
            outcomeBasisHash: ticketClosedBasisHash(s.issueId, ticket.stateType),
            ticketClosed: true
          });
          if (!r) { result.failures += 1; log(`${LOG} failure: markOutcome returned null for ${s.id}`); }
          else if (r.firstStampWins === false) { result.refused += 1; info(`${LOG} refused (already-stamped) scan ${s.id}`); }
          else { result.resolved += 1; cacheDirty = true; }
        } catch (err) {
          result.failures += 1;
          log(`${LOG} failure: markOutcome threw for ${s.id}: ${err?.message || err}`);
        }
      }
    }

    if (cacheDirty) {
      try { sessionsFeedCache?.clear?.(urlKey); } catch (err) { log(`${LOG} failure: cache clear threw: ${err?.message || err}`); }
    }
  } catch (err) {
    result.failures += 1;
    log(`${LOG} failure: ${err?.message || err}`);
  }
  return result;
}

/**
 * Build the `onTicketWrite` dep the write seams call (fire-and-forget by the
 * caller). Resolves the ticket from the written payload (one read-back at most),
 * and closes only when its state is terminal.
 */
export function createOnTicketWrite({ dispatchStore, taskDecisionsStore, sessionsFeedCache, agentStatusStore, now = Date.now, closeRows = closeTicketRows } = {}) {
  return async function onTicketWrite({ urlKey, written = null, readBack } = {}) {
    const ticket = await ticketFromWrite(written, { readBack });
    if (!ticket || !TERMINAL_TYPES.includes(ticket.stateType)) return null;
    return closeRows({ urlKey, ticket, dispatchStore, taskDecisionsStore, sessionsFeedCache, agentStatusStore, now: now() });
  };
}
