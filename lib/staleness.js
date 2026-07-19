/**
 * lib/staleness.js
 *
 * Single source of truth for run/session "staleness" — recognizing a run that is
 * stuck non-terminal but has gone quiet (a worker that died without emitting a
 * terminal marker). Shared by the Observation feed (`routes/dashboard.js`) and
 * the Live Console (`lib/live-console.js`) so the two surfaces agree on the
 * definition and threshold instead of each carrying its own (LIN-1445).
 *
 * Pure, read-only projection: nothing is mutated, so a later heartbeat (which
 * advances lastActivity) un-stales a run on the very next read. This is distinct
 * from *archive recency* (how much history a feed keeps in its Active view),
 * which is a separate, longer window owned by each feed.
 */

/**
 * A NON-TERMINAL run/session with no activity for longer than this is stale.
 * "Activity" spans dispatch, agent-status decoration, AND heartbeats (see
 * `loopLastActivityMs`), so a busy run that heartbeats without posting a status
 * update is never wrongly flagged.
 */
export const STALE_AFTER_MS = 60 * 60 * 1000; // 1h

function _epoch(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * The most recent activity signal for a loop, in epoch ms — the max of its
 * dispatch time, its latest agent-status decoration, and its latest heartbeat
 * (`telemetry.metrics[]`). Returns 0 when nothing parses.
 *
 * @param {Object} loop
 * @returns {number}
 */
export function loopLastActivityMs(loop) {
  if (!loop || typeof loop !== 'object') return 0;
  const dispatched = _epoch(loop.dispatchedAt);
  const agent = _epoch(loop.agentTimestamp);
  const beats = loop.telemetry && Array.isArray(loop.telemetry.metrics) ? loop.telemetry.metrics : [];
  const lastBeat = beats.length ? _epoch(beats[beats.length - 1] && beats[beats.length - 1].timestamp) : null;
  return Math.max(dispatched || 0, agent || 0, lastBeat || 0);
}

/**
 * Whether a last-activity instant is stale relative to `now`. A zero/unknown
 * activity is NOT stale (staleness is about "was active, went quiet", not
 * "never seen").
 *
 * @param {number} lastActivityMs
 * @param {number} now - epoch ms
 * @param {number} [thresholdMs=STALE_AFTER_MS]
 * @returns {boolean}
 */
export function isStale(lastActivityMs, now, thresholdMs = STALE_AFTER_MS) {
  return lastActivityMs != null && lastActivityMs > 0 && (now - lastActivityMs) > thresholdMs;
}
