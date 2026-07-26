/**
 * lib/live-console.js
 *
 * Pure data layer for the Live Console (LIN-1436) — an ambient, generation-free
 * view you leave running to watch the whole swarm work.
 *
 * Two read-only inputs, both already flowing through the system:
 *   - agent-status entries → the discrete step STREAM (research / implementation
 *     / review / close-out, each with a one-line summary).
 *   - lean dispatch loops   → the currently-working LANES, each carrying its
 *     latest HEARTBEAT (`telemetry.metrics[]` — parsed `[working] N tools/Xs`
 *     beats), plus `[evidence]` artifacts (`telemetry.producedArtifacts[]`) which
 *     become linked stream events. Heartbeat timestamps also feed the tempo
 *     sparkline, so the "rhythm" reflects real activity between discrete steps.
 *
 * Output shapes the client renders:
 *   - events  : normalized, newest-first, paginated stream (status + evidence)
 *   - lanes   : working agents (loop-based w/ heartbeat; status-only fallback)
 *   - tempo   : activity-rate buckets for the sparkline (incl. heartbeats)
 *   - summary : fleet totals (active / done / failed / blocked / total)
 *   - hasMore / oldestTs : cursor for "view more" pagination into history
 *
 * Everything is tolerant (never throws on malformed input) and deterministic
 * (`now` injected, never read from the clock) — same discipline as
 * lib/session-telemetry.js.
 */

/** Max length of a rendered event/lane summary. */
export const SUMMARY_MAX = 240;

/** Default events-per-page (the live view's initial page + each "view more"). */
export const DEFAULT_PAGE_SIZE = 60;

/** Default sparkline window: 20 buckets of 1 minute each (last 20 minutes). */
export const DEFAULT_TEMPO_BUCKET_MS = 60 * 1000;
export const DEFAULT_TEMPO_BUCKETS = 20;

/**
 * Flowing-strip "pulse": heartbeat-only density in fine buckets over a short
 * window, used by the client's scrolling activity strip as the ambient "hum"
 * beneath the discrete event blips. Separate from `tempo` (which mixes events +
 * heartbeats) so the strip can render the two signals as distinct layers.
 */
export const DEFAULT_PULSE_WINDOW_MS = 3 * 60 * 1000; // 3 min across the strip
export const DEFAULT_PULSE_BUCKET_MS = 5 * 1000;      // 5s resolution

/**
 * A working lane with no activity within this window is treated as stale and
 * dropped — closing the "session stuck 'running' forever" gap so the live feed
 * only shows what's genuinely moving. Activity = the most recent of the loop's
 * dispatch time, agent-status decoration, or latest heartbeat (or, for a
 * status-only lane, its latest working event).
 */
export const DEFAULT_LANE_STALE_MS = 60 * 60 * 1000; // 1h

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
 * Returns null when the entry is unusable (no parseable timestamp).
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
    url: null,
  };
}

/**
 * Turn each loop's `[evidence]` produced artifacts into linked evidence events —
 * the "something real landed" moments (PRs, commits, screenshots). Deduped per
 * loop by url/label. Skips artifacts with no resolvable timestamp.
 *
 * @param {Array<Object>} loops - lean loops with { telemetry.producedArtifacts[], workspaceUrlKey, ... }
 * @returns {Array<Object>}
 */
export function normalizeEvidenceEvents(loops) {
  if (!Array.isArray(loops)) return [];
  const out = [];
  const seen = new Set();
  for (const lp of loops) {
    const arts = lp && lp.telemetry && Array.isArray(lp.telemetry.producedArtifacts) ? lp.telemetry.producedArtifacts : null;
    if (!arts) continue;
    for (const a of arts) {
      const ts = _epoch(a && a.timestamp) ?? _epoch(lp.agentTimestamp) ?? _epoch(lp.dispatchedAt);
      if (ts == null) continue;
      const url = a && a.url ? String(a.url) : '';
      const key = `${lp.loopId || '?'}:${url || (a && a.label) || ts}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `ev:${key}`,
        kind: 'evidence',
        ts,
        iso: new Date(ts).toISOString(),
        workspaceUrlKey: lp.workspaceUrlKey || null,
        workspaceName: lp.workspaceName || lp.workspaceUrlKey || null,
        task: lp.issueIdentifier || null,
        action: 'evidence',
        status: null,
        summary: String((a && a.label) || url || 'produced an artifact').slice(0, SUMMARY_MAX),
        url: url || null,
      });
    }
  }
  return out;
}

/**
 * Whether a loop is a currently-working agent (a "lane"). Running only — a
 * terminal marker or a done/error/queued/waiting state disqualifies it.
 *
 * @param {Object} loop
 * @returns {boolean}
 */
export function isLoopActive(loop) {
  if (!loop || typeof loop !== 'object') return false;
  if (loop.terminalStatus) return false; // build-time terminal fact wins over a stale agentState
  return loop.agentState === 'running';
}

/**
 * The latest heartbeat metric for a loop (the live tick), or null.
 *
 * @param {Object} loop
 * @returns {{toolCount: number|null, elapsedSeconds: number|null, breakdown: Object|null, total: number|null}|null}
 */
export function latestHeartbeat(loop) {
  const ms = loop && loop.telemetry && Array.isArray(loop.telemetry.metrics) ? loop.telemetry.metrics : null;
  if (!ms || !ms.length) return null;
  const m = ms[ms.length - 1];
  if (!m) return null;
  return {
    toolCount: m.toolCount != null ? m.toolCount : null,
    elapsedSeconds: m.elapsedSeconds != null ? m.elapsedSeconds : null,
    breakdown: m.breakdown || null,
    total: m.total != null ? m.total : null,
  };
}

/**
 * The credential state a lane shows, resolved from an INJECTED tokenId → verdict
 * index (LIN-1588 / S-3). This module is pure, network-free and `now`-injected,
 * so it never performs the read itself: the route calls Beat 1's
 * `ProxyEventStore.listCredentialHealth` (LIN-1586) and folds its `tokens[]` into
 * the map handed in here. The RULE lives in `credentialVerdict`
 * (lib/proxy-events.js) and is never restated — this only maps its output onto
 * the three display states.
 *
 * Resolution order, and why `unknown` is not a failure mode:
 *   - no token on the loop → `unknown`. Per LIN-1585 this is the ORDINARY case
 *     (~99.86% of dispatches have no joinable agent-status row), not an edge one.
 *   - token absent from the map → `unknown`. No recent events means no evidence,
 *     and absence of evidence must never read as `ok`. The credential window
 *     (15 min) is deliberately shorter than the lane feed's (24h), so a genuinely
 *     old lane resolves here; do NOT widen the window to "fix" that.
 *   - `credential_dead` → `dead`; anything else the predicate returns → `ok`.
 *
 * `label` is `agentTokenLabel`, carried for DISPLAY ONLY. Labels are shared
 * across concurrent sessions (every dispatch mints `dispatch-bootstrap`) and
 * historical rows keep an `exchanged` snapshot, so the population is mixed:
 * never key, group, join or match on it. The lane key is unchanged.
 *
 * @param {Object} loop
 * @param {Object<string, string>} credentialByToken - tokenId → verdict
 * @returns {{state: 'dead'|'ok'|'unknown', label: string|null}}
 */
function resolveLaneCredential(loop, credentialByToken) {
  const tokenId = loop && loop.agentTokenId != null ? loop.agentTokenId : null;
  const label = loop && loop.agentTokenLabel != null ? loop.agentTokenLabel : null;
  if (tokenId == null) return { state: 'unknown', label };
  const verdict = credentialByToken ? credentialByToken[tokenId] : undefined;
  if (verdict == null) return { state: 'unknown', label };
  return { state: verdict === 'credential_dead' ? 'dead' : 'ok', label };
}

/**
 * Working lanes derived from running loops, each carrying its latest heartbeat.
 * Sorted most-recently-active first.
 *
 * @param {Array<Object>} loops
 * @param {Object} [options]
 * @param {Object<string, string>} [options.credentialByToken={}] - Injected
 *   tokenId → verdict index (LIN-1588). Omitted ⇒ every lane resolves `unknown`.
 * @returns {Array<Object>}
 */
export function deriveLoopLanes(loops, { credentialByToken = {} } = {}) {
  if (!Array.isArray(loops)) return [];
  const lanes = [];
  for (const lp of loops) {
    if (!isLoopActive(lp) || !lp.issueIdentifier) continue;
    const dispatchedMs = _epoch(lp.dispatchedAt);
    const agentMs = _epoch(lp.agentTimestamp);
    const beats = lp.telemetry && Array.isArray(lp.telemetry.metrics) ? lp.telemetry.metrics : [];
    const lastBeatMs = beats.length ? _epoch(beats[beats.length - 1] && beats[beats.length - 1].timestamp) : null;
    // LIN-1477: fold in the lineage heartbeat (lib/pipeline-loops.js) so a lane
    // survives the 1h staleness filter below while its lineage is beating on a
    // follow-up run, even if THIS loop's own last beat predates that. Additive
    // max, never a replacement for the loop's own activity signals.
    const lineageMs = Number.isFinite(lp.lineageLastActivityMs) ? lp.lineageLastActivityMs : null;
    const lastActivityMs = Math.max(dispatchedMs || 0, agentMs || 0, lastBeatMs || 0, lineageMs || 0);
    lanes.push({
      workspaceUrlKey: lp.workspaceUrlKey || null,
      workspaceName: lp.workspaceName || lp.workspaceUrlKey || null,
      task: lp.issueIdentifier,
      action: lp.agentAction || lp.stage || 'working',
      summary: String(lp.agentSummary || '').slice(0, SUMMARY_MAX),
      sinceMs: dispatchedMs ?? agentMs ?? 0,
      lastActivityMs,
      heartbeat: latestHeartbeat(lp),
      credential: resolveLaneCredential(lp, credentialByToken),
    });
  }
  lanes.sort((a, b) => b.sinceMs - a.sinceMs);
  return lanes;
}

/**
 * Working lanes from the agent-status stream: one per workspace+task whose MOST
 * RECENT event is a `working` one. The fallback for a working task with no live
 * loop (e.g. older data). Sorted most-recently-active first.
 *
 * @param {Array<Object>} events - normalized status events (any order)
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
      // LIN-1588: a status-stream fallback lane has no loop behind it and so no
      // token to ask about. It says `unknown` explicitly rather than omitting the
      // field, so a lane can never reach the client with credential state absent
      // and be defaulted to healthy by a reader.
      credential: { state: 'unknown', label: null },
    });
  }
  lanes.sort((a, b) => b.sinceMs - a.sinceMs);
  return lanes;
}

/**
 * Merge loop-based lanes (rich, with heartbeats) with status-based lanes,
 * loop wins on a shared workspace+task key. Sorted most-recently-active first.
 */
function mergeLanes(loopLanes, statusLanes) {
  const byKey = new Map();
  for (const l of loopLanes) byKey.set(`${l.workspaceUrlKey}::${l.task}`, l);
  for (const l of statusLanes) {
    const key = `${l.workspaceUrlKey}::${l.task}`;
    if (!byKey.has(key)) byKey.set(key, l);
  }
  return Array.from(byKey.values()).sort((a, b) => b.sinceMs - a.sinceMs);
}

/**
 * Event-arrival counts bucketed over the recent window, oldest→newest, for the
 * tempo sparkline. Bucket boundaries are upper-inclusive: an event exactly on a
 * boundary falls into the older adjacent bucket (a one-bar cosmetic shift at
 * exact-millisecond timestamps only). `ev.ts === now` lands in the newest
 * bucket; events at/older than the window start, or in the future, are ignored.
 *
 * @param {Array<{ts:number}>} ticks - anything with a numeric `ts` (events + heartbeats)
 * @param {{now: number, bucketMs?: number, buckets?: number}} opts
 * @returns {number[]} length === buckets
 */
export function bucketTempo(ticks, { now, bucketMs = DEFAULT_TEMPO_BUCKET_MS, buckets = DEFAULT_TEMPO_BUCKETS } = {}) {
  const out = new Array(buckets).fill(0);
  const windowStart = now - buckets * bucketMs;
  for (const t of ticks) {
    if (!t || t.ts <= windowStart || t.ts > now) continue;
    let idx = buckets - 1 - Math.floor((now - t.ts) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx > buckets - 1) idx = buckets - 1;
    out[idx] += 1;
  }
  return out;
}

/**
 * Heartbeat-only density over a short, fine-grained window for the flowing
 * activity strip. Returns absolute-time anchors ({ endTs, bucketMs }) so the
 * client can map each bucket to an x-position and scroll it in real time.
 * Heartbeats only — discrete events are drawn as blips from `events`.
 *
 * @param {Array<Object>} loops - lean loops with telemetry.metrics[]
 * @param {{now: number, windowMs?: number, bucketMs?: number}} opts
 * @returns {{bucketMs: number, endTs: number, buckets: number[]}}
 */
export function buildPulse(loops, { now, windowMs = DEFAULT_PULSE_WINDOW_MS, bucketMs = DEFAULT_PULSE_BUCKET_MS } = {}) {
  const count = Math.max(1, Math.round(windowMs / bucketMs));
  const buckets = new Array(count).fill(0);
  const start = now - count * bucketMs;
  for (const lp of Array.isArray(loops) ? loops : []) {
    const ms = lp && lp.telemetry && Array.isArray(lp.telemetry.metrics) ? lp.telemetry.metrics : null;
    if (!ms) continue;
    for (const m of ms) {
      const t = _epoch(m && m.timestamp);
      if (t == null || t <= start || t > now) continue;
      let idx = count - 1 - Math.floor((now - t) / bucketMs);
      if (idx < 0) idx = 0;
      if (idx > count - 1) idx = count - 1;
      buckets[idx] += 1;
    }
  }
  return { bucketMs, endTs: now, buckets };
}

/**
 * Slice a newest-first event list into a page, optionally starting strictly
 * older than a `before` cursor (the previous page's oldest ts). Powers the
 * "view more" affordance.
 *
 * @param {Array<Object>} events - newest-first
 * @param {{before?: number|null, pageSize?: number}} opts
 * @returns {{page: Array<Object>, hasMore: boolean, oldestTs: number|null}}
 */
export function pageEvents(events, { before = null, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const pool = before != null ? events.filter(e => e.ts < before) : events;
  const page = pool.slice(0, pageSize);
  const hasMore = pool.length > page.length;
  const oldestTs = page.length ? page[page.length - 1].ts : null;
  return { page, hasMore, oldestTs };
}

/**
 * Build the whole console feed. Pure and tolerant.
 *
 * @param {Array<Object>|{statusItems: Array<Object>, loops: Array<Object>}} input
 *   Either a bare status-item array (back-compat; no loops) or `{ statusItems, loops }`.
 * @param {Object} [opts]
 * @param {number} opts.now - epoch ms "now" (required for a meaningful tempo)
 * @param {number} [opts.pageSize=DEFAULT_PAGE_SIZE] - events per page (alias: maxEvents)
 * @param {number|null} [opts.before=null] - cursor: only events strictly older than this
 * @param {number} [opts.tempoBucketMs]
 * @param {number} [opts.tempoBuckets]
 * @param {boolean} [opts.sourceHasMore=false] - LIN-1494: the caller's stores
 *   truncated their reads (per-workspace row cap), so older rows exist beyond
 *   the pool this feed was built from. ORed into `hasMore` — deriving it from
 *   the already-truncated pool alone is what dead-ended "view earlier
 *   activity" while older events still existed. Only honest when the caller's
 *   cursor can genuinely advance past the cap (the store's `until` pushdown);
 *   without that, hasMore=true loops on empty pages.
 * @param {number|null} [opts.sourceTotal=null] - LIN-1494: the stores' exact
 *   pre-slice status-entry count (Σ per-workspace `total`). When supplied,
 *   `summary.total` = sourceTotal + the evidence events materialised here;
 *   omitted, it falls back to the pool length (back-compat, incl. the
 *   bare-array input form).
 * @param {Object<string, string>} [opts.credentialByToken={}] - LIN-1588: an
 *   INJECTED tokenId → verdict index (Beat 1's `listCredentialHealth` output,
 *   folded by the route). This module performs no read of its own — passing
 *   nothing is valid and resolves every lane to `unknown`.
 * @returns {{events, lanes, tempo, summary, hasMore, oldestTs}}
 */
export function buildConsoleFeed(input, opts = {}) {
  const {
    now = 0,
    before = null,
    tempoBucketMs = DEFAULT_TEMPO_BUCKET_MS,
    tempoBuckets = DEFAULT_TEMPO_BUCKETS,
    laneStaleMs = DEFAULT_LANE_STALE_MS,
    sourceHasMore = false,
    sourceTotal = null,
    credentialByToken = {},
  } = opts;
  const pageSize = opts.pageSize != null ? opts.pageSize : (opts.maxEvents != null ? opts.maxEvents : DEFAULT_PAGE_SIZE);

  let statusItems = [];
  let loops = [];
  if (Array.isArray(input)) {
    statusItems = input;
  } else if (input && typeof input === 'object') {
    statusItems = Array.isArray(input.statusItems) ? input.statusItems : [];
    loops = Array.isArray(input.loops) ? input.loops : [];
  }

  const statusEvents = statusItems.map(normalizeStatusEvent).filter(Boolean);
  const evidenceEvents = normalizeEvidenceEvents(loops);
  const allEvents = [...statusEvents, ...evidenceEvents].sort((a, b) => b.ts - a.ts);

  let lanes = mergeLanes(deriveLoopLanes(loops, { credentialByToken }), deriveLanes(statusEvents));
  // Drop stale lanes — a session stuck 'running' with no recent activity falls
  // off the feed once it crosses the staleness window (gap fix). Only applied
  // when a real `now` is supplied, so a lane's freshness can be judged.
  if (now) {
    lanes = lanes.filter(l => {
      const last = l.lastActivityMs != null ? l.lastActivityMs : l.sinceMs;
      return last != null && (now - last) <= laneStaleMs;
    });
  }

  // Tempo reflects ALL activity — discrete events AND heartbeat beats — so the
  // sparkline keeps moving during long phases between status steps.
  const ticks = allEvents.slice();
  for (const lp of loops) {
    const ms = lp && lp.telemetry && Array.isArray(lp.telemetry.metrics) ? lp.telemetry.metrics : null;
    if (!ms) continue;
    for (const m of ms) {
      const t = _epoch(m && m.timestamp);
      if (t != null) ticks.push({ ts: t });
    }
  }
  const tempo = bucketTempo(ticks, { now, bucketMs: tempoBucketMs, buckets: tempoBuckets });

  // LIN-1494 accepted + disclosed limitation: only the scalar `total` can be
  // corrected from the stores' pre-slice counts. The `done`/`failed`/`blocked`
  // kind counts, `tempo`, and `pulse` bucket shapes would need the dropped
  // rows themselves to reconstruct, so they remain pool-based (a recent-window
  // signal, not an all-time census).
  const summary = {
    active: lanes.length, done: 0, failed: 0, blocked: 0,
    total: sourceTotal != null ? sourceTotal + evidenceEvents.length : allEvents.length,
  };
  for (const ev of allEvents) {
    if (ev.kind === 'done') summary.done += 1;
    else if (ev.kind === 'failed') summary.failed += 1;
    else if (ev.kind === 'blocked') summary.blocked += 1;
  }

  const pulse = buildPulse(loops, { now });

  const { page, hasMore, oldestTs } = pageEvents(allEvents, { before, pageSize });
  return { events: page, lanes, tempo, pulse, summary, hasMore: hasMore || sourceHasMore, oldestTs, serverNow: now };
}
