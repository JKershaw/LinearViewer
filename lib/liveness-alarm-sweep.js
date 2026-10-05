/**
 * Liveness alarm sweep (LIN-3258, M21 option A). The scheduler job body:
 * `createLivenessAlarmSweepRun({deps})` returns the tick closure `server.js`
 * registers as `liveness-alarm-sweep` (10 min / 5 min lease).
 *
 * ONE tick, ONE clock, ONE dispatch read (the lean loops read). Order is
 * fixed and load-bearing:
 *
 *   1. Rule S first. If it is firing, D2 is SKIPPED ENTIRELY — it opens
 *      nothing and clears nothing (a wait cannot resolve while nothing claims
 *      work). An open D2 record simply stays one record.
 *   2. The first tick after S clears also skips D2 — a one-tick recovery
 *      grace, so the post-resume wake flood is not read as lost wakes.
 *   3. Otherwise D2 runs, with `CLEAR_CONFIRM_TICKS` consecutive evaluated
 *      ticks required before a no-longer-detected record clears (a tick
 *      landing inside a runner's ~16 s hourly resume must not flap it).
 *      Structural resolution (a member terminal, or the wait answered) clears
 *      IMMEDIATELY.
 *
 * ALARM ONLY. The deps object is deliberately limited to reads plus the
 * alarm store itself: there is no abort, no re-dispatch and no
 * feedback/message method anywhere in this module. Every injected store is
 * read-only except `alarmStore`.
 */

import { getLoopsForWorkspace } from './pipeline-loops.js';
import { getConsumerLastSeenAt } from './consumer-poll-warning.js';
import { readHorizonStart } from './read-horizon.js';
import {
  LIVENESS_ALARM_RULES,
  livenessAlarmId
} from './liveness-alarm-store.js';
import {
  detectDispatcherSilent,
  detectStoppedOrCircularWait,
  CLEAR_CONFIRM_TICKS
} from './liveness-detectors.js';

const TERMINAL_HISTORY_STATUSES = new Set(['done', 'failed', 'aborted', 'cancelled', 'expired']);

/**
 * Build the `run` callback `Scheduler.register()` arms for the liveness sweep.
 *
 * @param {Object} deps
 * @param {Object} deps.dispatchStore - read-only (`listItems`/`listHistory`/`listObservedWorkspaceKeys`)
 * @param {Object} deps.dispatchTokenStore - consumer-token store, for `getConsumerLastSeenAt`
 * @param {Object} [deps.proxyTokenStore] - `take`-grant proxy tokens joined into poll recency (LIN-3130)
 * @param {Object} deps.agentStatusStore - by-reference passthrough to `getLoopsForWorkspace`
 * @param {import('./liveness-alarm-store.js').LivenessAlarmStore} deps.alarmStore - the ONLY writable store
 * @param {number} deps.intervalMs - the job's registered tick period (ms)
 * @param {Function} [deps.now] - injected clock (epoch ms), for tests
 * @param {Function} [deps.getLoops] - read seam; defaults to `getLoopsForWorkspace`
 * @param {Function} [deps.getLastSeen] - read seam; defaults to `getConsumerLastSeenAt`
 * @returns {() => Promise<void>}
 */
export function createLivenessAlarmSweepRun({
  dispatchStore,
  dispatchTokenStore,
  proxyTokenStore = null,
  agentStatusStore,
  alarmStore,
  intervalMs,
  now = Date.now,
  getLoops = getLoopsForWorkspace,
  getLastSeen = getConsumerLastSeenAt
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('liveness-alarm-sweep: createLivenessAlarmSweepRun requires a positive intervalMs');
  }
  if (!dispatchStore || !alarmStore) {
    throw new Error('liveness-alarm-sweep: dispatchStore and alarmStore are required');
  }

  return async () => {
    const tickNow = now();
    const [observed, withOpenAlarms] = await Promise.all([
      dispatchStore.listObservedWorkspaceKeys().catch(() => []),
      alarmStore.listOpenWorkspaceKeys().catch(() => [])
    ]);
    const roster = [...new Set([...(observed || []), ...(withOpenAlarms || [])])].sort();
    if (!roster.length) return;

    // Sequential, per-workspace fail-soft: one bad workspace must not lose the
    // whole tick's lease, and a later workspace must still be evaluated.
    for (const urlKey of roster) {
      try {
        await sweepOneWorkspace(urlKey, tickNow, {
          dispatchStore,
          dispatchTokenStore,
          proxyTokenStore,
          agentStatusStore,
          alarmStore,
          getLoops,
          getLastSeen
        });
      } catch (err) {
        console.error(`[liveness-alarm-sweep] workspace ${urlKey} failed: ${err.message}`);
      }
    }
  };
}

/**
 * The per-workspace tick body. Exported for the tick-simulator tests.
 *
 * @param {string} urlKey
 * @param {number} now - epoch ms
 * @param {Object} deps
 * @returns {Promise<void>}
 */
export async function sweepOneWorkspace(urlKey, now, deps) {
  const { dispatchStore, dispatchTokenStore, proxyTokenStore, agentStatusStore, alarmStore, getLoops, getLastSeen } = deps;

  const loops = await getLoops(urlKey, { lean: true, dispatchStore, agentStatusStore });
  const liveItems = (loops || [])
    .filter((l) => l.source === 'live' || l.historyStatus === 'taken')
    .map((l) => ({ status: l.source === 'live' ? 'queued' : 'taken', dispatchedAt: l.dispatchedAt }));

  const openAlarms = await alarmStore.list(urlKey, { state: 'open' });
  if (!liveItems.length && !openAlarms.length) return;

  const openS = openAlarms.find((a) => a.rule === LIVENESS_ALARM_RULES.DISPATCHER_SILENT) || null;

  const lastSeenAt = await getLastSeen(dispatchTokenStore, urlKey, proxyTokenStore).catch(() => null);
  const silent = detectDispatcherSilent({ now, lastSeenAt, liveItems });

  if (silent.firing) {
    await alarmStore.open({
      urlKey,
      rule: LIVENESS_ALARM_RULES.DISPATCHER_SILENT,
      shape: null,
      members: [urlKey],
      dispatchIds: [],
      tickets: [...new Set((loops || []).map((l) => l.issueIdentifier).filter(Boolean))],
      startedAt: silent.startedAt,
      firedAt: new Date(now),
      detail: { lastSeenAt: lastSeenAt || null, liveCount: liveItems.length, dilution: 'LIN-2885 A3: token lastUsedAt is bumped by every proxy call, not only polls' }
    });
    // Suppression: D2 is skipped entirely while S fires — opens nothing,
    // clears nothing, so an open D2 record stays one record.
    return;
  }

  // S is not firing. Clear an open S, and skip D2 for this one recovery tick.
  if (openS) {
    await alarmStore.clear(openS._id, { clearedAt: new Date(now) });
    return;
  }

  await sweepD2(urlKey, now, { loops, alarmStore, dispatchStore, openAlarms });
}

/**
 * Rule D2 for one workspace: select waiter lineages from the lean loops,
 * targeted-read their raw rows, detect, and reconcile the alarm store.
 */
async function sweepD2(urlKey, now, { loops, alarmStore, dispatchStore, openAlarms }) {
  // N12: keep every lean loop's `loopId` for its lineage, so a wait naming a
  // mid-lineage row id of a non-waiter lineage resolves to that lineage, not
  // only the last (or root) loop.
  const lineageInfo = new Map();
  const latestByLineage = new Map();
  for (const loop of loops || []) {
    const lineageId = loop.lineageId || loop.loopId;
    if (!lineageId) continue;
    let entry = lineageInfo.get(lineageId);
    if (!entry) { entry = { latest: null, loopIds: [] }; lineageInfo.set(lineageId, entry); }
    if (loop.loopId && !entry.loopIds.includes(loop.loopId)) entry.loopIds.push(loop.loopId);
    if (!entry.latest || Date.parse(loop.dispatchedAt) >= Date.parse(entry.latest.dispatchedAt)) entry.latest = loop;
    const prev = latestByLineage.get(lineageId);
    if (!prev || Date.parse(loop.dispatchedAt) >= Date.parse(prev.dispatchedAt)) latestByLineage.set(lineageId, loop);
  }

  const waiters = [];
  for (const [lineageId, loop] of latestByLineage) {
    if (loop.wakeMarker !== 'pending') continue;
    if (loop.terminalStatus) continue;
    if (loop.historyStatus && TERMINAL_HISTORY_STATUSES.has(loop.historyStatus)) continue;
    waiters.push({ lineageId, sessionId: loop.sessionId || null });
  }

  // Read set = current waiters plus every node named on an OPEN D2 record, so
  // an open incident's structural clear is judged from its own stored nodes
  // this tick rather than from whichever walk happens to pass by.
  const openD2 = openAlarms.filter((a) => a.rule === LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT);
  const extraNodes = [];
  const readLineages = new Set(waiters.map((w) => w.lineageId));
  for (const alarm of openD2) {
    for (const id of [...(alarm.members || []), ...(alarm.waiters || []), ...(alarm.leafLineages || [])]) {
      if (!id || id.startsWith('ticket:')) continue;
      extraNodes.push(id);
      readLineages.add(id);
    }
  }

  const rowsByLineage = new Map();
  const since = readHorizonStart(now);
  for (const lineageId of readLineages) {
    const [live, history] = await Promise.all([
      dispatchStore.listItems(urlKey, { rootItemId: lineageId }).catch(() => []),
      dispatchStore.listHistory(urlKey, { rootItemId: lineageId, since }).then((r) => r.items || []).catch(() => [])
    ]);
    const rows = dedupeRows([...(live || []), ...(history || [])]);
    // The root row's own `rootItemId` equals its id, so the root is included
    // by the query; a pre-LIN-1468 row with no rootItemId is folded in by
    // matching the lineage id itself.
    rowsByLineage.set(lineageId, rows);
  }

  const { chains, resolvedMembers } = detectStoppedOrCircularWait({ now, waiters, rowsByLineage, lineageInfo, extraNodes });

  const detected = new Set();
  for (const chain of chains) {
    const id = livenessAlarmId({ rule: LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT, shape: chain.shape, members: chain.members });
    detected.add(id);
    await alarmStore.open({
      urlKey,
      rule: LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT,
      shape: chain.shape,
      members: chain.members,
      waiters: chain.waiters,
      feeders: chain.feeders,
      leafLineages: chain.leafLineages,
      dispatchIds: chain.dispatchIds,
      tickets: chain.tickets,
      startedAt: chain.startedAt,
      firedAt: new Date(now),
      detail: chain.detail
    });
  }

  for (const alarm of openD2) {
    if (detected.has(alarm._id)) continue;
    // Structural resolution clears immediately; a merely-unseen tick needs
    // CLEAR_CONFIRM_TICKS consecutive evaluated misses.
    if (structurallyResolved(alarm, resolvedMembers, rowsByLineage)) {
      await alarmStore.clear(alarm._id, { clearedAt: new Date(now) });
      continue;
    }
    const missed = await alarmStore.markMiss(alarm._id, { at: new Date(now) });
    if (missed && (missed.missCount || 0) >= CLEAR_CONFIRM_TICKS) {
      await alarmStore.clear(alarm._id, { clearedAt: new Date(now) });
    }
  }
}

/**
 * Whether an open D2 record is structurally resolved this tick, judged from
 * its own stored nodes:
 *  - a cycle clears when any SCC member is answered or terminal;
 *  - an orphan clears when every recorded direct waiter is answered or
 *    terminal, or the dead leaf revived (a row dispatched on it after the
 *    incident began). The leaf going terminal is NOT a clear — that is the
 *    lost-wake case the alarm exists to surface.
 */
function structurallyResolved(alarm, resolvedMembers, rowsByLineage) {
  if (alarm.shape === 'cycle') {
    return (alarm.members || []).some((m) => resolvedMembers.has(m));
  }
  const waiters = alarm.waiters || [];
  if (waiters.length && waiters.every((w) => resolvedMembers.has(w))) return true;
  const startedMs = alarm.startedAt ? Date.parse(alarm.startedAt) : NaN;
  if (Number.isFinite(startedMs)) {
    for (const leaf of alarm.leafLineages || []) {
      if (leaf.startsWith('ticket:')) continue;
      const rows = rowsByLineage.get(leaf) || [];
      if (rows.some((r) => Number.isFinite(Date.parse(r.dispatchedAt)) && Date.parse(r.dispatchedAt) > startedMs)) return true;
    }
  }
  return false;
}

/** De-duplicate rows that appear in both the live and history reads. */
function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = row.id || row._id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
