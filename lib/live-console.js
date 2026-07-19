/**
 * lib/live-console.js
 *
 * Pure data layer for the Live Console (LIN-1436) — an ambient, generation-free
 * view you leave running to watch the whole swarm work.
 *
 * The spine is the agent-status store: discrete, human-readable step events
 * (research / implementation / review / close-out, each with a one-line summary)
 * that agents already emit as they work. This module is the read-only transform
 * from those raw, workspace-tagged entries into the four shapes the client
 * renders — nothing is invented, nothing is generated (no LLM), nothing throws:
 *
 *   - events  : normalized, newest-first, capped stream (the trickle)
 *   - lanes   : the currently-working agents (one per workspace+task, latest wins)
 *   - tempo   : event-arrival counts bucketed over the recent window (the sparkline)
 *   - summary : fleet totals (active / done / failed / blocked / total)
 *
 * Same tolerant discipline as lib/session-telemetry.js: `now` is injected for
 * determinism (never read from the clock here), and every input is treated as
 * possibly-malformed.
 */

/** Max length of a rendered event summary. */
export const SUMMARY_MAX = 240;

/** Default cap on the number of events returned in one feed. */
export const DEFAULT_MAX_EVENTS = 200;

/** Default sparkline window: 20 buckets of 1 minute each (last 20 minutes). */
export const DEFAULT_TEMPO_BUCKET_MS = 60 * 1000;
export const DEFAULT_TEMPO_BUCKETS = 20;

/**
 * Map a raw agent-status `status` string onto the console's coarse event kind.
 * Tolerant of casing, punctuation, and common synonyms; anything unrecognised
 * is a neutral `info` event rather than a dropped one.
 *
 * @param {string} status
 * @returns {'done'|'working'|'blocked'|'failed'|'info'}
 */
export function statusToKind(status) {
  const s = String(status || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (s === 'completed' || s === 'complete' || s === 'done' || s === 'success' || s === 'succeeded') return 'done';
  if (s === 'in-progress' || s === 'working' || s === 'started' || s === 'running') return 'working';
  if (s === 'blocked' || s === 'pending' || s === 'waiting') return 'blocked';
  if (s === 'failed' || s === 'failure' || s === 'error' || s === 'aborted' || s === 'cancelled' || s === 'canceled') return 'failed';
  return 'info';
}

function _epoch(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Normalize one workspace-tagged agent-status entry into a console event.
 * Returns null when the entry is unusable (no parseable timestamp) — the caller
 * filters nulls out.
 *
 * @param {Object} item - a listStatus item with { workspaceUrlKey, workspaceName } folded in
 * @returns {Object|null}
 */
export function normalizeStatusEvent(item) {
  if (!item || typeof item !== 'object') return null;
  const ts = _epoch(item.timestamp);
  if (ts == null) return null;
  return {
    id: item.id != null ? String(item.id) : `${item.workspaceUrlKey || '?'}:${item.taskIdentifier || '?'}:${ts}`,
    kind: statusToKind(item.status),
    ts,
    iso: new Date(ts).toISOString(),
    workspaceUrlKey: item.workspaceUrlKey || null,
    workspaceName: item.workspaceName || item.workspaceUrlKey || null,
    task: item.taskIdentifier || null,
    action: item.action || null,
    status: item.status || null,
    summary: String(item.summary || '').slice(0, SUMMARY_MAX),
  };
}

/**
 * Currently-working agents: one lane per workspace+task whose MOST RECENT event
 * is a `working` one (a task whose latest event is terminal/done is not a lane).
 * Sorted most-recently-active first.
 *
 * @param {Array<Object>} events - normalized events (any order)
 * @returns {Array<Object>}
 */
export function deriveLanes(events) {
  const latestByKey = new Map();
  for (const ev of events) {
    if (!ev || !ev.task) continue;
    const key = `${ev.workspaceUrlKey}::${ev.task}`;
    const prev = latestByKey.get(key);
    if (!prev || ev.ts > prev.ts) latestByKey.set(key, ev);
  }
  const lanes = [];
  for (const ev of latestByKey.values()) {
    if (ev.kind !== 'working') continue;
    lanes.push({
      workspaceUrlKey: ev.workspaceUrlKey,
      workspaceName: ev.workspaceName,
      task: ev.task,
      action: ev.action,
      summary: ev.summary,
      sinceMs: ev.ts,
    });
  }
  lanes.sort((a, b) => b.sinceMs - a.sinceMs);
  return lanes;
}

/**
 * Event-arrival counts bucketed over the recent window, oldest→newest, for the
 * tempo sparkline. Bucket i covers [now - (buckets-i)*bucketMs, now - (buckets-1-i)*bucketMs).
 * Events older than the window are ignored.
 *
 * @param {Array<Object>} events - normalized events
 * @param {{now: number, bucketMs?: number, buckets?: number}} opts
 * @returns {number[]} length === buckets
 */
export function bucketTempo(events, { now, bucketMs = DEFAULT_TEMPO_BUCKET_MS, buckets = DEFAULT_TEMPO_BUCKETS } = {}) {
  const out = new Array(buckets).fill(0);
  const windowStart = now - buckets * bucketMs;
  for (const ev of events) {
    if (!ev || ev.ts <= windowStart || ev.ts > now) continue;
    // Age in buckets from the newest edge; clamp defensively.
    let idx = buckets - 1 - Math.floor((now - ev.ts) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx > buckets - 1) idx = buckets - 1;
    out[idx] += 1;
  }
  return out;
}

/**
 * Build the whole console feed from a flat array of workspace-tagged status
 * items. Pure and tolerant: a non-array input yields the empty feed.
 *
 * @param {Array<Object>} items
 * @param {Object} [opts]
 * @param {number} opts.now - epoch ms "now" (required for a meaningful tempo)
 * @param {number} [opts.maxEvents=DEFAULT_MAX_EVENTS]
 * @param {number} [opts.tempoBucketMs]
 * @param {number} [opts.tempoBuckets]
 * @returns {{events: Array<Object>, lanes: Array<Object>, tempo: number[], summary: Object}}
 */
export function buildConsoleFeed(items, opts = {}) {
  const {
    now = 0,
    maxEvents = DEFAULT_MAX_EVENTS,
    tempoBucketMs = DEFAULT_TEMPO_BUCKET_MS,
    tempoBuckets = DEFAULT_TEMPO_BUCKETS,
  } = opts;

  const list = Array.isArray(items) ? items : [];
  const events = list.map(normalizeStatusEvent).filter(Boolean);
  events.sort((a, b) => b.ts - a.ts); // newest first

  const lanes = deriveLanes(events);
  const tempo = bucketTempo(events, { now, bucketMs: tempoBucketMs, buckets: tempoBuckets });

  const summary = { active: lanes.length, done: 0, failed: 0, blocked: 0, total: events.length };
  for (const ev of events) {
    if (ev.kind === 'done') summary.done += 1;
    else if (ev.kind === 'failed') summary.failed += 1;
    else if (ev.kind === 'blocked') summary.blocked += 1;
  }

  return { events: events.slice(0, maxEvents), lanes, tempo, summary };
}
