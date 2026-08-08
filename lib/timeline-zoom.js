/**
 * Pure zoom/pan math for the Live Console timeline (LIN-1743, Phase 2 of
 * LIN-1720). Mirrors `computeFitZoom`'s pure-function shape (`ship-layout.js`)
 * and Ship's focal-point contract (`public/ship.js`'s `setZoom`): the instant
 * under the cursor/pinch centre stays stationary across a zoom. Mirrored on
 * `window` in `public/common.js`, same pattern as `computeFitZoom`.
 *
 * The visible window is represented as `{ startMs, endMs }` rather than a bare
 * scale factor, because pan moves both edges together and both functions need
 * to clamp against the SAME fixed `[nowMs - maxSpanMs, nowMs]` axis bounds —
 * the bounds the 1h/24h presets pick a span within. Re-layout only: neither
 * function touches bar height or label size, just the time window.
 */

export const TIMELINE_MIN_SPAN_MS = 60 * 60 * 1000; // 1h
export const TIMELINE_MAX_SPAN_MS = 24 * 60 * 60 * 1000; // 24h

// Bar-width visibility floor, as a percent of the current view window
// (relocated from public/live-console.js's local `MIN_W`, LIN-1908 Phase A) —
// mirrored on `window` in public/common.js so lib/live-console.js's
// TIMELINE_ROW_BUFFER_MS and public/live-console.js's bar-geometry clamp read
// the same value.
export const TIMELINE_BAR_MIN_WIDTH_PCT = 0.6;

function clampWindow(startMs, endMs, nowMs, maxSpanMs) {
  const span = endMs - startMs;
  const boundEnd = nowMs;
  const boundStart = nowMs - maxSpanMs;
  let s = startMs;
  let e = endMs;
  if (e > boundEnd) { e = boundEnd; s = e - span; }
  if (s < boundStart) { s = boundStart; e = s + span; }
  return { startMs: s, endMs: e };
}

/**
 * Zoom the window around a focal point, keeping the instant at `focalX`
 * stationary. `deltaZoom` is a log-space delta (`newSpan = span * exp(deltaZoom)`),
 * same sign convention as a wheel `deltaY` — positive zooms OUT (grows the
 * span), negative zooms IN — so callers can pass a scaled `deltaY`/pinch delta
 * straight through without pre-exponentiating it.
 *
 * @param {Object} opts
 * @param {number} opts.startMs         current window start (epoch ms)
 * @param {number} opts.endMs           current window end (epoch ms)
 * @param {number} opts.focalX          cursor/pinch-centre X, viewport-relative px
 * @param {number} opts.deltaZoom       log-space zoom delta
 * @param {number} opts.viewportWidthPx
 * @param {number} opts.nowMs           current wall-clock time (epoch ms) — the right axis bound
 * @param {number} [opts.minSpanMs=TIMELINE_MIN_SPAN_MS]
 * @param {number} [opts.maxSpanMs=TIMELINE_MAX_SPAN_MS]
 * @returns {{startMs: number, endMs: number}}
 */
export function computeTimelineZoom({
  startMs,
  endMs,
  focalX,
  deltaZoom,
  viewportWidthPx,
  nowMs,
  minSpanMs = TIMELINE_MIN_SPAN_MS,
  maxSpanMs = TIMELINE_MAX_SPAN_MS,
}) {
  if (!(viewportWidthPx > 0) || !(endMs > startMs)) return { startMs, endMs };
  const span = endMs - startMs;
  const factor = Math.exp(deltaZoom);
  const newSpan = Math.max(minSpanMs, Math.min(maxSpanMs, span * factor));
  const ratio = Math.max(0, Math.min(1, focalX / viewportWidthPx));
  const focalMs = startMs + ratio * span;
  const newStart = focalMs - ratio * newSpan;
  const newEnd = newStart + newSpan;
  return clampWindow(newStart, newEnd, nowMs, maxSpanMs);
}

/**
 * Pan the window by `deltaPx` (positive = drag right = reveal earlier time),
 * preserving the current span, clamped to the same axis bounds `computeTimelineZoom`
 * uses.
 *
 * @param {Object} opts
 * @param {number} opts.startMs
 * @param {number} opts.endMs
 * @param {number} opts.deltaPx
 * @param {number} opts.viewportWidthPx
 * @param {number} opts.nowMs
 * @param {number} [opts.maxSpanMs=TIMELINE_MAX_SPAN_MS]
 * @returns {{startMs: number, endMs: number}}
 */
export function computeTimelinePan({
  startMs,
  endMs,
  deltaPx,
  viewportWidthPx,
  nowMs,
  maxSpanMs = TIMELINE_MAX_SPAN_MS,
}) {
  if (!(viewportWidthPx > 0) || !(endMs > startMs)) return { startMs, endMs };
  const span = endMs - startMs;
  const deltaMs = (deltaPx / viewportWidthPx) * span;
  const newStart = startMs - deltaMs;
  const newEnd = endMs - deltaMs;
  return clampWindow(newStart, newEnd, nowMs, maxSpanMs);
}

/**
 * Does a timeline run overlap a view window? Shared by the client's bar
 * culling and its empty-state count (public/live-console.js) so "is this bar
 * visible" and "is there anything in the window" can never disagree — the
 * F1 gap (LIN-1743 review): zoom introduced sub-windows narrower than the
 * server's 24h axis, and nothing culled a run lying entirely outside one, so
 * it rendered as a phantom sliver pinned to the nearest edge instead of
 * disappearing. `run.end == null` means still-running (open-ended), so it
 * overlaps whenever it started before the window closes.
 *
 * @param {{start: number, end: (number|null)}} run
 * @param {number} windowStart
 * @param {number} windowEnd
 * @param {number} nowMs - resolves an open-ended run's effective end
 * @returns {boolean}
 */
export function timelineRunOverlapsWindow(run, windowStart, windowEnd, nowMs) {
  if (!run || run.start == null) return false;
  const end = run.end != null ? run.end : nowMs;
  return run.start < windowEnd && end > windowStart;
}
