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

export const TIMELINE_MIN_SPAN_MS = 5 * 60 * 1000; // 5min — interactive zoom-in floor only
export const TIMELINE_MAX_SPAN_MS = 24 * 60 * 60 * 1000; // 24h
// Separate, LARGER floor for the `fit` default window (computeTimelineFit,
// below) — deliberately not unified with TIMELINE_MIN_SPAN_MS (LIN-1928
// Revision 3). The e2e fixtures seed a dispatch at ~now, so an unclamped fit
// baseline would collapse onto whatever the interactive floor is; sharing the
// lowered 5min floor would make that baseline the zoom floor too, and a
// ctrl+wheel/pinch zoom-in (which also floors at the shared value) could
// never shrink the window further. Keeping this floor at the old 1h value
// also matches product intent: `fit` is a *browse* default (bounded below so
// one very-recent short run doesn't collapse the page to a few minutes on
// load), while the interactive floor is for a user deliberately zooming past
// that.
export const TIMELINE_FIT_MIN_SPAN_MS = 60 * 60 * 1000; // 1h

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

/**
 * Default/"fit" window (LIN-1928, Phase B of LIN-1908): the tightest span
 * that still covers every currently-visible run (plus a small margin),
 * live-anchored at `now` — mirrors `computeFitZoom`'s shape
 * (`ship-layout.js`): pick the tightest bound that fits the content, clamped
 * so it never gets absurdly small or large. Unlike
 * `computeTimelineZoom`/`computeTimelinePan` this is a ONE-SHOT computation
 * (the caller latches the result at first paint and does not call this again
 * on every poll — see `public/live-console.js`), so it takes no focal point
 * or existing window, only the data.
 *
 * Deliberately clamps to `TIMELINE_FIT_MIN_SPAN_MS` (1h), NOT the lowered
 * interactive `TIMELINE_MIN_SPAN_MS` floor — see that constant's comment for
 * why the two must stay separate.
 *
 * @param {Object} opts
 * @param {Array<{start: number, end: (number|null)}>} opts.runs - currently-visible runs
 * @param {number} opts.now - current wall-clock time (epoch ms), the right axis bound
 * @param {number} [opts.minSpanMs=TIMELINE_FIT_MIN_SPAN_MS]
 * @param {number} [opts.maxSpanMs=TIMELINE_MAX_SPAN_MS]
 * @returns {{startMs: number, endMs: number}}
 */
export function computeTimelineFit({
  runs,
  now,
  minSpanMs = TIMELINE_FIT_MIN_SPAN_MS,
  maxSpanMs = TIMELINE_MAX_SPAN_MS,
}) {
  const starts = (Array.isArray(runs) ? runs : [])
    .map(run => run && run.start)
    .filter(start => typeof start === 'number' && Number.isFinite(start));
  const earliestVisibleRunStart = starts.length ? Math.min(...starts) : now;
  const rawSpan = (now - earliestVisibleRunStart) * 1.05;
  const span = Math.max(minSpanMs, Math.min(maxSpanMs, rawSpan));
  return { startMs: now - span, endMs: now };
}
