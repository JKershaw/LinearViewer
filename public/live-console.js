/**
 * Live Console client (experimental, LIN-1436).
 *
 * The ambient, lean-back view. Polls the generation-free events endpoint and
 * paints:
 *   - the status banner + tempo sparkline (the system's rhythm, incl. heartbeats),
 *   - the pulse-lane rail (one breathing lane per working agent, ticking its
 *     latest heartbeat — tools/elapsed/breakdown — so long phases still move),
 *   - the activity stream (status steps + [evidence] artifacts, newest-first),
 *   - a "view earlier activity" pager that loads OLDER events below the live feed.
 *
 * Built to be left open all day: a KEYED reconcile (not innerHTML replace) keeps
 * lane pulses breathing continuously; polling is a chained setTimeout with an
 * in-flight guard + exponential backoff; the seen-ids set is bounded to the last
 * poll. Cross-workspace chips filter in place (no refetch). The history region is
 * append-only and never touched by the live reconcile.
 *
 * Pure presentation — no LLM, no writes. Requires common.js (window.api,
 * window.escapeHtml, window.relativeTime). Loaded only on /live-console.
 */
(function () {
  'use strict';

  const data = window.__LIVE_CONSOLE_DATA__ || {};
  const urlKey = data.urlKey || '';
  if (!urlKey) return;
  const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];

  const POLL_MS = 5000;
  const MAX_BACKOFF_MS = 60000;
  const MAX_DOM_EVENTS = 80;   // cap rendered LIVE rows (feed itself is capped server-side)
  const MAX_HISTORY_ROWS = 300; // cap paged-in history rows
  const HISTORY_PAGE = 40;
  const TICK_MS = 30000;       // relative-time refresh cadence
  const TIMELINE_WINDOW_MS = 24 * 60 * 60 * 1000; // full axis bound + "24h" preset target span
  const TIMELINE_PRESET_1H_MS = 60 * 60 * 1000;   // "1h" preset target span ONLY — NOT the
                                                   // interactive zoom floor (that's the lowered
                                                   // window.TIMELINE_MIN_SPAN_MS mirror in
                                                   // common.js, LIN-1928); this local const used
                                                   // to shadow that name and conflate the two.
  const TIMELINE_ROW_HEIGHT = 18;
  const TIMELINE_ROW_GAP = 4;
  const TIMELINE_WHEEL_ZOOM_SPEED = 0.0025;
  const PULSE_WHEEL_ZOOM_SPEED = 0.0025; // same tuning as TIMELINE_WHEEL_ZOOM_SPEED
  const PULSE_RUNG_DEBOUNCE_MS = 200;
  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Kind → glyph (colour lives in live-console.css via [data-kind]).
  const KIND = {
    done:     { glyph: '✓' },
    working:  { glyph: '◐' },
    blocked:  { glyph: '◑' },
    failed:   { glyph: '✗' },
    evidence: { glyph: '↗' },
    info:     { glyph: '·' },
  };

  const els = {
    dot: document.getElementById('live-console-dot'),
    status: document.getElementById('live-console-status'),
    tempo: document.getElementById('live-console-tempo'),
    pulse: document.querySelector('.lc-pulse'),
    pulseSpanText: document.getElementById('live-console-pulse-span-text'),
    // Scoped by data-testid prefix, not the shared `.lc-timeline-preset` class
    // — the pulse strip's preset buttons reuse that class for styling (LIN-1505
    // Phase C), so a bare class selector here would pick up BOTH button groups.
    pulsePresets: Array.from(document.querySelectorAll('[data-testid^="live-console-pulse-preset-"]')),
    chips: document.getElementById('live-console-chips'),
    timelineSection: document.getElementById('live-console-timeline-section'),
    timelineLabelText: document.getElementById('live-console-timeline-label-text'),
    timeline: document.getElementById('live-console-timeline'),
    timelineConnectors: document.getElementById('live-console-timeline-connectors'),
    timelineEmpty: document.getElementById('live-console-timeline-empty'),
    timelinePresets: Array.from(document.querySelectorAll('[data-testid^="live-console-timeline-preset-"]')),
    lanes: document.getElementById('live-console-lanes'),
    lanesEmpty: document.getElementById('live-console-lanes-empty'),
    stream: document.getElementById('live-console-stream'),
    streamEmpty: document.getElementById('live-console-stream-empty'),
    history: document.getElementById('live-console-history'),
    more: document.getElementById('live-console-more'),
    moreBtn: document.getElementById('live-console-more-btn'),
  };

  // ─── State ────────────────────────────────────────────────────────────────
  const hiddenWorkspaces = new Set();   // urlKeys toggled off (chip filter)
  let seenEventIds = new Set();         // ids from the LAST poll (bounded; detects new arrivals)
  const laneNodes = new Map();          // `${ws}::${task}` → <li>
  const eventNodes = new Map();         // live event id → <li>
  const timelineBarNodes = new Map();   // timeline run id → <div class="lc-timeline-bar">
  let lastServerNow = 0;                // last poll's serverNow — the timeline's anchor for "now"
  // LIN-1743 (Phase 2): the timeline's zoom/pan viewport, module-scope and
  // untouched by paintTimeline's poll-driven reconcile — a poll tick mid-gesture
  // must not reset it. `endMs: null` means "live" (tracks lastServerNow every
  // poll); a gesture or a preset sets a concrete spanMs, and re-pins to live
  // only once panned/zoomed back to the right edge. Overwritten once by the
  // first-paint fit latch (LIN-1928, applyFeed/latchTimelineFitWindow) before
  // any bar is ever actually painted — this literal is only the pre-latch
  // placeholder.
  let timelineView = { spanMs: TIMELINE_WINDOW_MS, endMs: null };
  // Which preset (if any) produced the current timelineView — span alone
  // can't tell a `fit` latch clamped to TIMELINE_FIT_MIN_SPAN_MS apart from
  // the `1h` preset, since both are live-anchored spans of the same length
  // (LIN-1928 research finding). 'fit' | '1h' | '24h' | null (custom gesture).
  let timelineActivePreset = null;
  let timelineFitSpanMs = null;         // the fit window's span, latched once (LIN-1928)
  let timelineFitLatched = false;       // first-paint latch guard — never recomputed on a poll
  let timelineFlat = [];                // last { run, rowIndex } list, for viewport-only repaints
  let timelineConnectorEdges = [];      // last { fromId, toId } list (server-packed, LIN-1720)
  let timelineGesture = null;           // active touch gesture: { mode: 'pinch'|'pan', ... }
  // LIN-1505 Phase C: the strip's own zoom state — module-scope and DISTINCT
  // from timelineView/timelineGesture above (never coupled, per decision 3).
  // The strip has no persisted {startMs,endMs} window the way the timeline
  // does: every frame derives [effNow - pulseViewSpanMs, effNow] fresh, so
  // there is no "re-pin to live" step — the right edge is always `now`.
  let pulseViewSpanMs = window.PULSE_SPAN_RUNGS_MS[0];  // continuous, gesture-updated
  let pulseServerSpanMs = pulseViewSpanMs;              // quantised, what was last REQUESTED
  let pulseActivePreset = '3m';                         // '3m'|'15m'|'1h'|'6h'|null (custom gesture)
  let pulseGesture = null;                              // active touch gesture on the strip
  let pulseRungDebounceTimer = null;
  const historyIds = new Set();         // ids paged into the history region
  let lastFeed = null;                  // last successful live feed (for in-place re-filter)
  let liveOldestTs = null;              // oldest ts in the live feed (first history cursor)
  let liveHasMore = false;              // server: more older events exist beyond the live page
  let historyCursor = null;             // ts cursor for the next history page
  let historyExhausted = false;         // a history page reported no more older events
  let historyLoading = false;
  let firstPaint = true;
  let inFlight = false;
  let stopped = false;
  let failures = 0;
  let pollTimer = null;
  let tickTimer = null;

  const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const rel = (iso) => (window.relativeTime ? window.relativeTime(iso) : '');
  const kindOf = (k) => KIND[k] || KIND.info;
  const isVisibleWs = (k) => !hiddenWorkspaces.has(k);
  const obsHref = (wsKey) => `/workspace/${encodeURIComponent(wsKey)}/observation`;

  function nodeFromHtml(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function fmtDuration(s) {
    if (s == null) return '';
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }
  // Escaped HTML for the `.lc-lane-hb` tick — breakdown keys are tool names
  // sourced from the agent's own message text and are not fully trusted, so
  // every dynamic bit goes through `esc` before it becomes markup. When the
  // parsed state is 'idle', the numeric "0 tools" bit is suppressed in favour
  // of Observation's own idle chip (public/observation.js's renderActivityLog,
  // `.obs-act-chip.obs-act-idle`, styled via public/observation.css) — reusing
  // that vocabulary rather than inventing a parallel one.
  function fmtHeartbeat(hb) {
    if (!hb) return '';
    const idle = hb.state === 'idle';
    const bits = [];
    const n = hb.total != null ? hb.total : hb.toolCount;
    if (!idle && n != null) bits.push(`${n} tool${n === 1 ? '' : 's'}`);
    if (hb.elapsedSeconds != null) bits.push(fmtDuration(hb.elapsedSeconds));
    if (!idle && hb.breakdown) {
      const top = Object.keys(hb.breakdown)
        .map(k => [k, hb.breakdown[k]])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${k}×${v}`)
        .join(' ');
      if (top) bits.push(top);
    }
    const text = esc(bits.join(' · '));
    const chip = idle ? '<span class="obs-act-chip obs-act-idle">no tools</span>' : '';
    if (text && chip) return `${text} ${chip}`;
    return text || chip;
  }

  // ─── Skeleton (first-paint) ─────────────────────────────────────────────────
  function renderSkeleton() {
    const rows = (n) => Array.from({ length: n }, () => '<li class="lc-skel" aria-hidden="true"></li>').join('');
    if (els.lanes) els.lanes.innerHTML = rows(2);
    if (els.stream) els.stream.innerHTML = rows(4);
    if (els.lanesEmpty) els.lanesEmpty.hidden = true;
    if (els.streamEmpty) els.streamEmpty.hidden = true;
  }
  function clearSkeleton() {
    if (els.lanes) els.lanes.innerHTML = '';
    if (els.stream) els.stream.innerHTML = '';
    laneNodes.clear();
    eventNodes.clear();
  }

  // ─── Timeline (LIN-1742 Phase 1 static swimlane + LIN-1743 Phase 2 zoom/pan) ─
  // Bars are laid out on the CURRENT VIEW WINDOW (`currentTimelineWindow()` →
  // `start`/`end` epoch ms → left/width percentages), stacked into the rows the
  // SERVER already packed (lib/live-console.js's packTimelineRows) — the client
  // still does no repacking, only re-layout of the same rows against a
  // zoomable/pannable window. Keyed reconcile by run id (same house rule as
  // paintLanes/paintStream, above: nodes updated in place, never
  // innerHTML-replaced, so a hidden bar's node reference — and any in-flight
  // gesture — survives a poll tick).
  function timelineLabel(run) {
    return (run && (run.kind || run.promptName)) || 'run';
  }
  // The visible window: { start, end } epoch ms. `timelineView.endMs === null`
  // means "live" — tracks lastServerNow every call, exactly Phase 1's fixed
  // now-24h..now behaviour. A gesture or preset pins a concrete window instead;
  // paintTimeline (poll-driven) reads this but never writes it, so a poll tick
  // mid-gesture can't reset the viewport.
  function currentTimelineWindow() {
    const now = lastServerNow || Date.now();
    const end = timelineView.endMs != null ? timelineView.endMs : now;
    return { start: end - timelineView.spanMs, end };
  }
  // Exposes the visible window on the viewport element itself — cheap
  // groundwork for LIN-1755's axis ticks (which need exactly these bounds to
  // label the axis) and a stable hook for tests, which otherwise have no way
  // to observe the window once a fresh/near-now bar's true share of it falls
  // under updateTimelineBarNode's MIN_W visibility floor.
  function syncTimelineWindowAttrs() {
    if (!els.timeline) return;
    const { start, end } = currentTimelineWindow();
    els.timeline.dataset.windowStart = String(Math.round(start));
    els.timeline.dataset.windowEnd = String(Math.round(end));
  }
  function timelineBarNode(run) {
    const div = document.createElement('div');
    div.className = 'lc-timeline-bar';
    div.setAttribute('data-testid', 'live-console-timeline-bar');
    // Visible label (ticket identifier + prompt type) — a child span, not just
    // title/aria-label, so the identifier reads at a glance without hovering
    // or a screen reader (in scope per the D3/success-criteria: "labelled with
    // ticket ID and prompt type", not merely accessible-but-invisible).
    // Absolutely positioned to fill the bar and clip its own overflow, so a
    // narrow/zoomed-out bar truncates gracefully instead of spilling text.
    const labelNode = document.createElement('span');
    labelNode.className = 'lc-timeline-bar-label';
    div.appendChild(labelNode);
    updateTimelineBarNode(div, run, 0);
    return div;
  }
  function updateTimelineBarNode(div, run, rowIndex) {
    const now = lastServerNow || Date.now();
    const { start: windowStart, end: windowEnd } = currentTimelineWindow();
    const span = Math.max(1, windowEnd - windowStart);
    const clampedEnd = run.end != null ? run.end : now;
    const pct = (t) => Math.max(0, Math.min(100, ((t - windowStart) / span) * 100));
    // A visible sliver for a near-zero-duration run, but never past the
    // container's right edge — a run ending right at the window's edge
    // (pct(run.start) ≈ 100) must not push left+width over 100% and force a
    // horizontal scrollbar. `startPct` itself is clamped to `100 - MIN_W` (not
    // just `widthPct`'s upper bound) so the floor survives for a run starting
    // at/after that point — otherwise `100 - startPct` degenerates to the run's
    // own duration and the outer `min` always wins, defeating MIN_W for every
    // fresh/still-running run. Relocated to lib/timeline-zoom.js's
    // TIMELINE_BAR_MIN_WIDTH_PCT (LIN-1908 Phase A) — mirrored on `window` in
    // common.js — so lib/live-console.js's TIMELINE_ROW_BUFFER_MS derives from
    // the same value instead of a second, drift-prone copy.
    const MIN_W = window.TIMELINE_BAR_MIN_WIDTH_PCT;
    const startPct = Math.min(pct(run.start), 100 - MIN_W);
    const widthPct = Math.min(Math.max(pct(clampedEnd) - startPct, MIN_W), 100 - startPct);
    div.style.left = `${startPct}%`;
    div.style.width = `${widthPct}%`;
    div.style.top = `${rowIndex * (TIMELINE_ROW_HEIGHT + TIMELINE_ROW_GAP)}px`;
    div.setAttribute('data-kind', run.outcomeKind || 'info');
    div.classList.toggle('lc-timeline-bar--clipped', !!run.clippedStart);
    // F1/F3 (LIN-1744): a stale-tail bar (stillRunning: 'unknown') and a
    // genuinely still-running bar (stillRunning: true) both render
    // data-kind="working" under outcome-based colouring, so colour alone can't
    // tell them apart — the end treatment (live-console.css) carries it
    // instead, keyed off this attribute. Anything else (false, missing,
    // malformed) falls back to 'false' — no special end treatment, never a
    // thrown error on odd input.
    div.setAttribute('data-still-running', run.stillRunning === true ? 'true' : run.stillRunning === 'unknown' ? 'unknown' : 'false');
    div.setAttribute('data-ws', run.workspaceUrlKey || '');
    // F1: a run lying entirely outside the CURRENT VIEW window (zoom introduced
    // sub-windows the server's own 24h-axis clamping doesn't cover) must
    // disappear, not clamp to a phantom sliver at the nearest edge —
    // window-overlap is a real cull, not just the MIN_W visual floor above.
    const inWindow = window.timelineRunOverlapsWindow(run, windowStart, windowEnd, now);
    div.hidden = !isVisibleWs(run.workspaceUrlKey) || !inWindow;
    const label = `${run.issueIdentifier || '?'} — ${timelineLabel(run)}`;
    div.title = label;
    div.setAttribute('aria-label', label);
    if (div.firstElementChild) div.firstElementChild.textContent = label;
  }
  // F1: "is there anything to show" must agree with "is this bar visible" —
  // both the chip filter AND the current view window, computed once here so
  // paintTimeline (new data) and repaintTimelineViewport (viewport-only, e.g.
  // a preset click with no poll in between) can't disagree about the empty
  // state. Zooming into a span with genuinely nothing in it must show the
  // empty state even between polls, not just on the next poll tick.
  function updateTimelineEmptyState() {
    if (!els.timelineEmpty) return;
    const now = lastServerNow || Date.now();
    const { start: windowStart, end: windowEnd } = currentTimelineWindow();
    const visibleCount = timelineFlat.filter(({ run }) =>
      isVisibleWs(run.workspaceUrlKey) && window.timelineRunOverlapsWindow(run, windowStart, windowEnd, now)
    ).length;
    els.timelineEmpty.hidden = visibleCount > 0;
  }

  // Flatten the server-packed { rows: [[run,...],...] } shape into a single
  // { run, rowIndex } list. Shared by paintTimeline and the first-paint fit
  // latch (LIN-1928), which needs the run list before paintTimeline itself
  // has run.
  function flattenTimelineRows(timeline) {
    const rows = Array.isArray(timeline && timeline.rows) ? timeline.rows : [];
    const flat = [];
    rows.forEach((row, rowIndex) => {
      (Array.isArray(row) ? row : []).forEach(run => { if (run) flat.push({ run, rowIndex }); });
    });
    return flat;
  }

  function paintTimeline(timeline) {
    if (!els.timeline) return;
    const rowCount = Array.isArray(timeline && timeline.rows) ? timeline.rows.length : 0;
    const flat = flattenTimelineRows(timeline);
    timelineFlat = flat; // for gesture-driven repaints that touch no new data
    timelineConnectorEdges = Array.isArray(timeline && timeline.connectors) ? timeline.connectors : [];
    syncTimelineWindowAttrs();

    const wanted = new Set(flat.map(f => f.run.id));
    for (const [id, node] of timelineBarNodes) {
      if (!wanted.has(id)) { node.remove(); timelineBarNodes.delete(id); }
    }
    for (const { run, rowIndex } of flat) {
      let node = timelineBarNodes.get(run.id);
      if (!node) { node = timelineBarNode(run); timelineBarNodes.set(run.id, node); els.timeline.appendChild(node); }
      updateTimelineBarNode(node, run, rowIndex);
    }
    const rowsHeightPx = Math.max(rowCount, 1) * (TIMELINE_ROW_HEIGHT + TIMELINE_ROW_GAP);
    els.timeline.style.height = `${rowsHeightPx}px`;
    if (els.timelineConnectors) {
      els.timelineConnectors.setAttribute('viewBox', `0 0 100 ${rowsHeightPx}`);
      // CSS height:100% resolves against .lc-timeline-viewport's clamped
      // max-height (320px), not its scrollHeight — past 14 rows that scales
      // every connector y by 320/rowsHeightPx and detaches lines from their
      // bars (review finding on PR #1043). Pin the real content height here.
      els.timelineConnectors.style.height = `${rowsHeightPx}px`;
    }

    updateTimelineEmptyState();
    paintTimelineConnectors();
  }

  // Run-to-run connector overlay (D3/success-criteria: "swim lines shown
  // where one leads on from the other… some lines connecting them"). Edges
  // are server-packed ({fromId,toId}, lib/live-console.js's packTimelineRows)
  // — the client draws, never recomputes, which runs follow on from which.
  // Reads each endpoint bar's OWN rendered left/width/top (not a re-derived
  // copy of updateTimelineBarNode's pct/MIN_W math) so a connector always
  // touches exactly where its bar was actually drawn, including the MIN_W
  // visibility floor and any window-driven clamping. A full innerHTML rebuild
  // (rather than a keyed reconcile like the bars) is deliberate here: the
  // overlay is aria-hidden, non-interactive, and holds no focus/gesture state
  // an innerHTML replace could destroy — unlike the bars, cheap to rebuild
  // wholesale on every poll and every gesture-driven repaint.
  function paintTimelineConnectors() {
    if (!els.timelineConnectors) return;
    const parts = [];
    for (const edge of timelineConnectorEdges) {
      if (!edge) continue;
      const fromNode = timelineBarNodes.get(edge.fromId);
      const toNode = timelineBarNodes.get(edge.toId);
      if (!fromNode || !toNode || fromNode.hidden || toNode.hidden) continue;
      const x1 = parseFloat(fromNode.style.left) + parseFloat(fromNode.style.width);
      const y1 = parseFloat(fromNode.style.top) + TIMELINE_ROW_HEIGHT / 2;
      const x2 = parseFloat(toNode.style.left);
      const y2 = parseFloat(toNode.style.top) + TIMELINE_ROW_HEIGHT / 2;
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
      const midX = (x1 + x2) / 2;
      parts.push(`<path class="lc-timeline-connector" data-testid="live-console-timeline-connector" d="M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}"/>`);
    }
    els.timelineConnectors.innerHTML = parts.join('');
  }

  // Re-layout the existing bars against the current window WITHOUT touching
  // which runs exist — the pure viewport-only half of a zoom/pan gesture. Data
  // changes (new/removed runs) stay paintTimeline's job, driven by the poll.
  function repaintTimelineViewport() {
    syncTimelineWindowAttrs();
    for (const { run, rowIndex } of timelineFlat) {
      const node = timelineBarNodes.get(run.id);
      if (node) updateTimelineBarNode(node, run, rowIndex);
    }
    updateTimelineEmptyState();
    paintTimelineConnectors();
  }

  // Human-readable span, e.g. "24 hours" / "1 hour" / "47 minutes" / "2h 15m" —
  // shared by the timeline's window label (LIN-1928) and the pulse strip's
  // span label (LIN-1505 Phase C, decision 3: same idiom, don't fork it) so
  // both surfaces phrase "last N minutes/hours" identically.
  function describeSpan(spanMs) {
    const totalMinutes = Math.max(1, Math.round(spanMs / 60000));
    if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
    const totalHours = spanMs / 3600000;
    const roundedHours = Math.round(totalHours);
    if (Math.abs(totalHours - roundedHours) < 0.01) {
      return `${roundedHours} hour${roundedHours === 1 ? '' : 's'}`;
    }
    const wholeHours = Math.floor(totalHours);
    const remMinutes = totalMinutes - wholeHours * 60;
    return `${wholeHours}h ${remMinutes}m`;
  }

  function updateTimelineWindowText() {
    const label = `last ${describeSpan(timelineView.spanMs)}`;
    if (els.timelineSection) {
      els.timelineSection.setAttribute('aria-label', label.charAt(0).toUpperCase() + label.slice(1));
    }
    if (els.timelineLabelText) els.timelineLabelText.textContent = label;
    if (els.timelineEmpty) els.timelineEmpty.textContent = `○ no runs in the ${label}`;
  }

  // Pressed state can't be inferred from span alone (LIN-1928 research
  // finding): a `fit` window clamped to TIMELINE_FIT_MIN_SPAN_MS is
  // byte-identical in span to the `1h` preset, so identity is retained
  // explicitly in `timelineActivePreset` instead of re-derived here.
  function updateTimelinePresetPressed() {
    els.timelinePresets.forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-range') === timelineActivePreset));
    });
    updateTimelineWindowText();
  }

  // Adopt a { startMs, endMs } window computed by computeTimelineZoom/Pan.
  // Re-pins to "live" (endMs: null) once panned/zoomed back to the current
  // right edge, so the view keeps tracking new runs without another gesture —
  // matching the presets, which are always live. A gesture always yields a
  // custom (non-preset) window.
  function applyTimelineWindow({ startMs, endMs }) {
    const now = lastServerNow || Date.now();
    timelineView = {
      spanMs: endMs - startMs,
      endMs: (now - endMs) < 1000 ? null : endMs,
    };
    timelineActivePreset = null;
    updateTimelinePresetPressed();
    repaintTimelineViewport();
  }

  function setTimelinePreset(spanMs, presetName) {
    timelineView = { spanMs, endMs: null };
    timelineActivePreset = presetName || null;
    updateTimelinePresetPressed();
    repaintTimelineViewport();
  }

  // Resolve a preset button's target span. `fit` replays the ONE latched
  // computation from first paint (LIN-1928) rather than recomputing — fit is
  // deliberately a one-shot default, not a live re-fit button. The fallback
  // only matters if a click somehow races the first feed response.
  function presetTargetSpanMs(range) {
    if (range === '1h') return TIMELINE_PRESET_1H_MS;
    if (range === '24h') return TIMELINE_WINDOW_MS;
    if (range === 'fit') return timelineFitSpanMs != null ? timelineFitSpanMs : window.TIMELINE_FIT_MIN_SPAN_MS;
    return TIMELINE_WINDOW_MS;
  }

  // ─── Pulse strip zoom (LIN-1505 Phase C) ────────────────────────────────────
  // Reuses the SAME idiom as the timeline (preset buttons + pinch + ctrl-wheel,
  // same ARIA pattern, same pure computeTimelineZoom math) but is entirely
  // independent STATE — decision 3: two different time windows on one page,
  // deliberately never coupled. Unlike the timeline, the strip never pans and
  // has no persisted window: every frame derives [effNow - pulseViewSpanMs,
  // effNow] fresh (renderPulse's xFor), so there is no "re-pin to live" step.

  function updatePulseSpanText() {
    if (els.pulseSpanText) els.pulseSpanText.textContent = `last ${describeSpan(pulseViewSpanMs)}`;
  }

  function updatePulsePresetPressed() {
    els.pulsePresets.forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-range') === pulseActivePreset));
    });
    updatePulseSpanText();
  }

  // A gesture/preset click changes the CONTINUOUS view span immediately, for a
  // smooth feel (drives xFor/fade/cull every frame); the SERVER span only
  // changes — after a short debounce — when the view span crosses to a new
  // rung, so the wire carries at most four shapes, always. The two are
  // deliberately not synchronised tighter: a gesture mid-zoom shows a smooth
  // span change against slightly stale bucket data until the debounced
  // refetch lands (decision 2, an accepted trade for the smooth feel).
  function requestPulseRefetchIfRungChanged() {
    const rung = window.snapPulseWindowMs(pulseViewSpanMs);
    if (rung === pulseServerSpanMs) return;
    pulseServerSpanMs = rung;
    clearTimeout(pulseRungDebounceTimer);
    pulseRungDebounceTimer = setTimeout(() => {
      // Reuses poll()'s own in-flight guard rather than a second concurrent
      // fetch path — if a regular poll is already in flight when this fires,
      // the rung change rides the NEXT regular tick instead of immediately
      // (acceptable for an ambient view; no second fetch path is added).
      clearTimeout(pollTimer);
      poll();
    }, PULSE_RUNG_DEBOUNCE_MS);
  }

  function setPulsePreset(spanMs, presetName) {
    pulseViewSpanMs = spanMs;
    pulseGesture = null;
    pulseActivePreset = presetName || null;
    // Synchronous repaint regardless of REDUCED_MOTION: under reduced motion
    // there is no rAF loop, so this is the ONLY repaint trigger a click gets
    // — without it a reduced-motion user would see no feedback for up to 5s
    // (the next poll). Under the continuous rAF loop this is a harmless no-op
    // (the next frame repaints anyway).
    renderPulse();
    updatePulsePresetPressed();
    requestPulseRefetchIfRungChanged();
  }

  // Zoom the strip's span. Deliberately does NOT thread a real pinch-midpoint
  // / cursor-X into the focal calculation the way the timeline does — there is
  // nothing to keep visually stationary, since the right edge is pinned to
  // `now` on every frame regardless. Passing `focalX: viewportWidthPx` (ratio
  // 1) is what encodes "no panning, right edge always now" using the SHARED
  // zoom function rather than special-casing around it: with the focal ratio
  // at 1, computeTimelineZoom's own math places the new window's right edge
  // exactly at `now` with zero drift, so no separate re-pin step is needed.
  function applyPulseZoom(deltaZoom, viewportWidthPx) {
    const now = lastServerNow || Date.now();
    const next = window.computeTimelineZoom({
      startMs: now - pulseViewSpanMs,
      endMs: now,
      focalX: viewportWidthPx,
      deltaZoom,
      viewportWidthPx,
      nowMs: now,
      minSpanMs: window.PULSE_SPAN_RUNGS_MS[0],
      maxSpanMs: window.PULSE_SPAN_RUNGS_MS[window.PULSE_SPAN_RUNGS_MS.length - 1],
    });
    pulseViewSpanMs = next.endMs - next.startMs;
    pulseActivePreset = null;
    renderPulse(); // see setPulsePreset's comment — the only repaint trigger under reduced motion
    updatePulsePresetPressed();
    requestPulseRefetchIfRungChanged();
  }

  // Desktop: ctrl/meta+wheel, gated exactly like the timeline's onTimelineWheel
  // so a plain wheel keeps native page scroll. Mobile: two-finger pinch only —
  // deliberately NO one-finger branch (decision 1: `.lc-pulse` keeps its
  // current touch behaviour, a one-finger vertical swipe must still scroll the
  // page — see the CSS `touch-action: pan-y`, the concrete implementation of
  // that decision).
  function onPulseWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel: let the page scroll natively
    e.preventDefault();
    const rect = els.pulse.getBoundingClientRect();
    applyPulseZoom(e.deltaY * PULSE_WHEEL_ZOOM_SPEED, rect.width || els.pulse.clientWidth);
  }
  function onPulseTouchStart(e) {
    if (e.touches.length === 2) {
      const rect = els.pulse.getBoundingClientRect();
      pulseGesture = {
        startDist: touchDistance(e.touches[0], e.touches[1]),
        rectWidth: rect.width || els.pulse.clientWidth,
      };
    } else {
      pulseGesture = null; // one-finger (or more than two): not our gesture, let it scroll
    }
  }
  function onPulseTouchMove(e) {
    if (!pulseGesture || e.touches.length !== 2) return;
    e.preventDefault();
    const dist = touchDistance(e.touches[0], e.touches[1]);
    if (!(pulseGesture.startDist > 0) || !(dist > 0)) return;
    // Fingers spreading (dist grows) → zoom IN (span shrinks); pinching
    // together → zoom OUT — same negated log ratio as the timeline's pinch.
    const deltaZoom = -Math.log(dist / pulseGesture.startDist);
    applyPulseZoom(deltaZoom, pulseGesture.rectWidth);
    pulseGesture.startDist = dist; // continuous: each move zooms from here, not from gesture start
  }
  function onPulseTouchEnd(e) {
    if (e.touches.length < 2) pulseGesture = null;
  }
  function wirePulseGestures() {
    if (!els.pulse) return;
    els.pulse.addEventListener('wheel', onPulseWheel, { passive: false });
    els.pulse.addEventListener('touchstart', onPulseTouchStart, { passive: true });
    els.pulse.addEventListener('touchmove', onPulseTouchMove, { passive: false });
    els.pulse.addEventListener('touchend', onPulseTouchEnd, { passive: true });
    els.pulse.addEventListener('touchcancel', onPulseTouchEnd, { passive: true });
    els.pulsePresets.forEach(btn => {
      btn.addEventListener('click', () => {
        const range = btn.getAttribute('data-range');
        const rungIndex = { '3m': 0, '15m': 1, '1h': 2, '6h': 3 }[range];
        const spanMs = rungIndex != null ? window.PULSE_SPAN_RUNGS_MS[rungIndex] : window.PULSE_SPAN_RUNGS_MS[0];
        setPulsePreset(spanMs, range);
      });
    });
  }

  // First-paint fit latch (LIN-1928): compute the default window ONCE from
  // the first feed response's run list and hold it — a later poll must never
  // recompute or move it out from under the user (only a fresh gesture or
  // preset click changes it after this). Deliberately does not repaint;
  // applyFeed's own paintTimeline(feed.timeline) call right after this does
  // the real paint, keyed off the now-latched timelineView.
  function latchTimelineFitWindow(timeline) {
    const flat = flattenTimelineRows(timeline);
    const fit = window.computeTimelineFit({ runs: flat.map(f => f.run), now: lastServerNow || Date.now() });
    timelineFitSpanMs = fit.endMs - fit.startMs;
    timelineView = { spanMs: timelineFitSpanMs, endMs: null };
    timelineActivePreset = 'fit';
    updateTimelinePresetPressed();
  }

  // ─── Timeline gestures (LIN-1743, Phase 2 of LIN-1720) ──────────────────────
  // Desktop: wheel + ctrl/meta zooms (mirrors public/ship.js:1548-1552's gating
  // — a plain wheel keeps native page scroll), plain mouse drag pans (F2).
  // Mobile: two-finger pinch zooms (focal point = the pinch midpoint),
  // one-finger drag pans; `touch-action: none` on `.lc-timeline-viewport`
  // (public/live-console.css) hands the WHOLE gesture to this hand-rolled
  // code for its entire duration — including the vertical axis, decided once
  // by the browser at touch-start, so no per-move `preventDefault()` choice
  // can hand it back. A one-finger drag therefore locks to its dominant axis
  // (F3) on the first move past a small jitter threshold: horizontal-dominant
  // pans the time window; vertical-dominant hand-rolls a scroll passthrough —
  // first the viewport's own internal `overflow-y:auto` (many stacked session
  // rows, Q4), and only the leftover delta the page itself, so a vertical
  // swipe over the timeline still scrolls the page instead of hitting a dead
  // zone when the viewport has little or no internal overflow to give.
  const TIMELINE_AXIS_LOCK_PX = 6;
  function timelineViewportRect() {
    return els.timeline.getBoundingClientRect();
  }
  function onTimelineWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel: let the page scroll natively
    e.preventDefault();
    const rect = timelineViewportRect();
    const { start, end } = currentTimelineWindow();
    const next = window.computeTimelineZoom({
      startMs: start,
      endMs: end,
      focalX: e.clientX - rect.left,
      deltaZoom: e.deltaY * TIMELINE_WHEEL_ZOOM_SPEED,
      viewportWidthPx: rect.width || els.timeline.clientWidth,
      nowMs: lastServerNow || Date.now(),
    });
    applyTimelineWindow(next);
  }

  // F2: desktop mouse drag-pan — the in-scope requirement Step 7 named but
  // never wired. `mousemove`/`mouseup` listen on `window`, not the viewport,
  // so a drag started inside the timeline keeps panning even if the pointer
  // leaves it mid-drag (same reach as public/ship.js's `wirePan`).
  let timelineMouseDrag = null; // { lastX, rectWidth } while a left-button drag is down
  function onTimelineMouseDown(e) {
    if (e.button !== 0) return;
    const rect = timelineViewportRect();
    timelineMouseDrag = { lastX: e.clientX, rectWidth: rect.width || els.timeline.clientWidth };
    els.timeline.classList.add('lc-timeline-viewport--panning');
  }
  function onTimelineMouseMove(e) {
    if (!timelineMouseDrag) return;
    const x = e.clientX;
    const deltaX = x - timelineMouseDrag.lastX;
    timelineMouseDrag.lastX = x;
    if (!deltaX) return;
    const { start, end } = currentTimelineWindow();
    const next = window.computeTimelinePan({
      startMs: start,
      endMs: end,
      deltaPx: deltaX,
      viewportWidthPx: timelineMouseDrag.rectWidth,
      nowMs: lastServerNow || Date.now(),
    });
    applyTimelineWindow(next);
  }
  function onTimelineMouseUp() {
    if (!timelineMouseDrag) return;
    timelineMouseDrag = null;
    els.timeline.classList.remove('lc-timeline-viewport--panning');
  }

  function touchDistance(t0, t1) {
    return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  }
  function touchMidX(t0, t1, rect) {
    return (t0.clientX + t1.clientX) / 2 - rect.left;
  }
  function onTimelineTouchStart(e) {
    if (e.touches.length === 2) {
      const rect = timelineViewportRect();
      timelineGesture = {
        mode: 'pinch',
        startDist: touchDistance(e.touches[0], e.touches[1]),
        focalX: touchMidX(e.touches[0], e.touches[1], rect),
        rectWidth: rect.width || els.timeline.clientWidth,
        window: currentTimelineWindow(),
      };
    } else if (e.touches.length === 1) {
      const rect = timelineViewportRect();
      timelineGesture = {
        mode: 'pan',
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        lastX: e.touches[0].clientX,
        lastY: e.touches[0].clientY,
        rectWidth: rect.width || els.timeline.clientWidth,
        axis: null, // 'x' | 'y' — locked on the first move past the jitter threshold
      };
    } else {
      timelineGesture = null;
    }
  }
  function onTimelineTouchMove(e) {
    if (!timelineGesture) return;
    const now = lastServerNow || Date.now();
    if (timelineGesture.mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const dist = touchDistance(e.touches[0], e.touches[1]);
      if (!(timelineGesture.startDist > 0) || !(dist > 0)) return;
      // Fingers spreading (dist grows) → zoom IN (span shrinks); pinching
      // together → zoom OUT — hence the negated log ratio.
      const deltaZoom = -Math.log(dist / timelineGesture.startDist);
      const next = window.computeTimelineZoom({
        startMs: timelineGesture.window.start,
        endMs: timelineGesture.window.end,
        focalX: timelineGesture.focalX,
        deltaZoom,
        viewportWidthPx: timelineGesture.rectWidth,
        nowMs: now,
      });
      applyTimelineWindow(next);
    } else if (timelineGesture.mode === 'pan' && e.touches.length === 1) {
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const deltaX = x - timelineGesture.lastX;
      const deltaY = y - timelineGesture.lastY;
      timelineGesture.lastX = x;
      timelineGesture.lastY = y;

      if (!timelineGesture.axis) {
        const totalX = x - timelineGesture.startX;
        const totalY = y - timelineGesture.startY;
        // Below the threshold, direction is noise — wait for more movement
        // before committing to an axis (an early pick would flip randomly).
        if (Math.abs(totalX) < TIMELINE_AXIS_LOCK_PX && Math.abs(totalY) < TIMELINE_AXIS_LOCK_PX) return;
        timelineGesture.axis = Math.abs(totalX) > Math.abs(totalY) ? 'x' : 'y';
      }

      e.preventDefault();
      if (timelineGesture.axis === 'x') {
        if (!deltaX) return;
        const { start, end } = currentTimelineWindow();
        const next = window.computeTimelinePan({
          startMs: start,
          endMs: end,
          deltaPx: deltaX,
          viewportWidthPx: timelineGesture.rectWidth,
          nowMs: now,
        });
        applyTimelineWindow(next);
      } else {
        // Vertical-dominant: touch-action:none already told the browser, at
        // touch-start, not to scroll this element for the WHOLE gesture — a
        // later preventDefault() can't hand that back — so native scroll is
        // never coming and this code must replicate it by hand. Prefer the
        // viewport's own internal scroll; only the delta it can't absorb
        // (scrollTop pinned at an end, or no overflow at all — the common
        // case at under ~15 rows) falls through to the page itself, so a
        // vertical swipe over the timeline never goes dead.
        if (!deltaY) return;
        // Desired change in scroll POSITION (not finger delta): matches the
        // `scrollTop -= deltaY` convention, so the page falls through in the
        // SAME direction the inner viewport would have scrolled had it had
        // room — a swipe must feel identical regardless of which one absorbs it.
        const desired = -deltaY;
        const before = els.timeline.scrollTop;
        els.timeline.scrollTop = before + desired; // browser clamps to [0, scrollHeight - clientHeight]
        const consumed = els.timeline.scrollTop - before;
        const remainder = desired - consumed;
        if (remainder) window.scrollBy(0, remainder);
      }
    }
  }
  function onTimelineTouchEnd(e) {
    if (e.touches.length === 0) {
      timelineGesture = null;
    } else if (e.touches.length === 1 && timelineGesture && timelineGesture.mode === 'pinch') {
      // Dropped from two fingers to one mid-pinch: keep the gesture alive as a
      // pan, re-armed with its own fresh axis lock from this point.
      const rect = timelineViewportRect();
      timelineGesture = {
        mode: 'pan',
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        lastX: e.touches[0].clientX,
        lastY: e.touches[0].clientY,
        rectWidth: rect.width || els.timeline.clientWidth,
        axis: null,
      };
    }
  }
  function wireTimelineGestures() {
    if (!els.timeline) return;
    els.timeline.addEventListener('wheel', onTimelineWheel, { passive: false });
    els.timeline.addEventListener('mousedown', onTimelineMouseDown);
    window.addEventListener('mousemove', onTimelineMouseMove);
    window.addEventListener('mouseup', onTimelineMouseUp);
    els.timeline.addEventListener('touchstart', onTimelineTouchStart, { passive: true });
    els.timeline.addEventListener('touchmove', onTimelineTouchMove, { passive: false });
    els.timeline.addEventListener('touchend', onTimelineTouchEnd, { passive: true });
    els.timeline.addEventListener('touchcancel', onTimelineTouchEnd, { passive: true });
    els.timelinePresets.forEach(btn => {
      btn.addEventListener('click', () => {
        const range = btn.getAttribute('data-range');
        setTimelinePreset(presetTargetSpanMs(range), range);
      });
    });
  }

  // ─── Chips (cross-workspace filter) ─────────────────────────────────────────
  function buildChips() {
    if (!els.chips) return;
    if (workspaces.length < 2) { els.chips.hidden = true; return; }
    els.chips.hidden = false;
    els.chips.innerHTML = workspaces.map(w =>
      `<button type="button" class="lc-chip" data-ws="${esc(w.urlKey)}" aria-pressed="true">
        <span class="lc-chip-dot" aria-hidden="true"></span>${esc(w.name || w.urlKey)}
      </button>`
    ).join('');
    els.chips.querySelectorAll('[data-ws]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-ws');
        if (hiddenWorkspaces.has(k)) hiddenWorkspaces.delete(k); else hiddenWorkspaces.add(k);
        const on = !hiddenWorkspaces.has(k);
        btn.setAttribute('aria-pressed', String(on));
        btn.classList.toggle('lc-chip--off', !on);
        if (lastFeed) applyFeed(lastFeed, false);
        filterHistory();
      });
    });
  }

  // ─── Banner + connection state ──────────────────────────────────────────────
  function paintBanner(summary) {
    const s = summary || { active: 0, done: 0, failed: 0, blocked: 0, total: 0 };
    const bits = [`${s.active} working`];
    if (s.done) bits.push(`${s.done} done`);
    if (s.blocked) bits.push(`${s.blocked} blocked`);
    if (s.failed) bits.push(`${s.failed} failed`);
    if (els.status) els.status.textContent = s.total ? bits.join(' · ') : 'all quiet — nothing in flight right now';

    let health = 'idle';
    if (s.failed) health = 'error';
    else if (s.active) health = 'live';
    else if (s.total) health = 'done';
    if (els.dot) {
      els.dot.setAttribute('data-health', health);
      els.dot.classList.toggle('lc-status-dot--pulse', health === 'live' && !REDUCED_MOTION);
    }
  }
  function paintDisconnected() {
    if (els.dot) {
      els.dot.setAttribute('data-health', 'idle');
      els.dot.classList.remove('lc-status-dot--pulse');
    }
    if (els.status) {
      els.status.textContent = firstPaint ? 'could not reach the feed — retrying…' : 'reconnecting to the feed…';
    }
  }

  // ─── Flowing activity strip ─────────────────────────────────────────────────
  // A full-width band that scrolls right→left in real time: a soft amber
  // heartbeat "hum" area beneath colour-coded event blips that enter at the right
  // (now) and drift left as they age, fading out near the left. Driven by rAF so
  // motion is continuous between the 5s data polls; the hum's vertical scale
  // slow-decays so a given level holds still instead of re-normalizing each poll.
  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  function colorForKind(k) {
    switch (k) {
      case 'done': return cssVar('--green', '#16a34a');
      case 'evidence': return cssVar('--brand', '#0d9488');
      case 'failed': return cssVar('--red', '#cc0000');
      case 'blocked': return cssVar('--slate', '#64748b');
      case 'working': return cssVar('--amber', '#FFB224');
      default: return cssVar('--muted', '#888');
    }
  }

  let pulseData = { buckets: [], load: [], bucketMs: 5000, endTs: 0, serverNow: 0, perf: 0, events: [] };
  let humMax = 1;
  let loadMax = 1;
  let rafId = null;

  function updatePulse(feed) {
    const p = feed.pulse || {};
    const newBucketMs = p.bucketMs || 5000;
    // LIN-1505 Phase C: humMax/loadMax are slow-decay scales — changing
    // bucketMs (i.e. the active span) changes every bucket's magnitude at
    // once, so a zoom step must reset both rather than visibly re-settling
    // over several polls. Keyed off the WIRE-reported bucketMs (not the
    // client's requested rung) so a race where an in-flight old-rung
    // response lands after a rung change still resets correctly against
    // what actually arrived.
    if (newBucketMs !== pulseData.bucketMs) { humMax = 1; loadMax = 1; }
    pulseData.buckets = Array.isArray(p.buckets) ? p.buckets : [];
    pulseData.load = Array.isArray(p.load) ? p.load : [];
    pulseData.bucketMs = newBucketMs;
    pulseData.endTs = p.endTs || feed.serverNow || 0;
    pulseData.serverNow = feed.serverNow || pulseData.endTs || 0;
    pulseData.perf = (window.performance && performance.now) ? performance.now() : 0;
    pulseData.events = (Array.isArray(feed.events) ? feed.events : []).map(e => ({ ts: e.ts, kind: e.kind }));
    const curMax = pulseData.buckets.length ? Math.max.apply(null, pulseData.buckets) : 0;
    humMax = Math.max(curMax, humMax * 0.9, 1); // slow-decay → stable vertical scale
    const curLoadMax = pulseData.load.length ? Math.max.apply(null, pulseData.load) : 0;
    loadMax = Math.max(curLoadMax, loadMax * 0.9, 1); // load's OWN slow-decay scale — independent of humMax
    if (REDUCED_MOTION) renderPulse(); // no rAF; repaint a static snapshot per poll
  }

  function renderPulse() {
    const canvas = els.tempo;
    if (!canvas || !canvas.getContext) return;
    const cssW = canvas.clientWidth || canvas.offsetWidth || 0;
    const cssH = canvas.clientHeight || 46;
    if (cssW <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const wantW = Math.round(cssW * dpr), wantH = Math.round(cssH * dpr);
    if (canvas.width !== wantW) canvas.width = wantW;
    if (canvas.height !== wantH) canvas.height = wantH;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const W = cssW, H = cssH, base = H - 1, humH = H * 0.62;
    const effNow = REDUCED_MOTION
      ? pulseData.serverNow
      : pulseData.serverNow + (((window.performance && performance.now) ? performance.now() : 0) - pulseData.perf);
    if (!effNow) return;
    const xFor = (ts) => W * (1 - (effNow - ts) / pulseViewSpanMs);

    // Heartbeat hum area — height driven ONLY by `buckets` (beat count).
    const b = pulseData.buckets;
    const ld = pulseData.load;
    if (b.length) {
      ctx.beginPath();
      let firstX = null, lastX = null;
      const humPts = [];
      for (let i = 0; i < b.length; i++) {
        const tsCenter = pulseData.endTs - (b.length - 1 - i) * pulseData.bucketMs - pulseData.bucketMs / 2;
        const x = xFor(tsCenter);
        const y = base - (b[i] / humMax) * humH;
        humPts.push({ x, y });
        if (firstX === null) { ctx.moveTo(x, base); ctx.lineTo(x, y); firstX = x; }
        else ctx.lineTo(x, y);
        lastX = x;
      }
      if (firstX !== null) {
        ctx.lineTo(lastX, base);
        ctx.closePath();
        ctx.fillStyle = cssVar('--amber', '#FFB224');
        ctx.globalAlpha = 0.16;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Load overlay — magnitude, nested INSIDE the hum silhouette just drawn:
      // at bucket i its height is `load[i]/loadMax` of THAT bucket's own hum
      // height, never the hum's own y. A beating-but-idle bucket (load≈0)
      // therefore leaves the hum area exactly as drawn above — nothing to undo,
      // nothing to compensate for. loadMax is its own independent, slow-decaying
      // scale (never humMax), so hum and load can never fight over one axis.
      if (firstX !== null) {
        ctx.beginPath();
        let lFirstX = null, lLastX = null;
        for (let i = 0; i < humPts.length; i++) {
          const { x, y } = humPts[i];
          const frac = Math.max(0, Math.min(1, (ld[i] || 0) / loadMax));
          const ly = base - frac * (base - y);
          if (lFirstX === null) { ctx.moveTo(x, base); ctx.lineTo(x, ly); lFirstX = x; }
          else ctx.lineTo(x, ly);
          lLastX = x;
        }
        if (lFirstX !== null) {
          ctx.lineTo(lLastX, base);
          ctx.closePath();
          ctx.fillStyle = cssVar('--amber', '#FFB224');
          ctx.globalAlpha = 0.4;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    // Baseline hairline.
    ctx.strokeStyle = cssVar('--line-soft', 'rgba(0,0,0,0.08)');
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, base + 0.5); ctx.lineTo(W, base + 0.5); ctx.stroke();

    // Event blips: a thin riser + a dot, coloured by kind, fading as they age.
    // Fade start + age cull follow the VIEW span (not a constant) so blips
    // visually spread out (or compress) immediately on a zoom, ahead of the
    // server's blip payload actually changing — the payload cap is unchanged
    // (still the newest-60 events), this only re-scales where they're drawn.
    const fadeStart = pulseViewSpanMs * 0.75;
    const dotY = base - humH * 0.7;
    for (const ev of pulseData.events) {
      const age = effNow - ev.ts;
      if (age < -2000 || age > pulseViewSpanMs) continue;
      let x = xFor(ev.ts);
      if (x > W) x = W;
      const alpha = age > fadeStart ? Math.max(0, 1 - (age - fadeStart) / (pulseViewSpanMs - fadeStart)) : 1;
      const color = colorForKind(ev.kind);
      ctx.globalAlpha = alpha * 0.45;
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, dotY); ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, dotY, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function pulseFrame() {
    if (stopped) return;
    renderPulse();
    rafId = requestAnimationFrame(pulseFrame);
  }
  function startPulse() {
    if (REDUCED_MOTION) { renderPulse(); return; }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(pulseFrame);
  }
  function stopPulse() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // ─── Lanes (keyed reconcile so pulses breathe continuously) ─────────────────

  // LIN-1588: the lane's credential badge. Three states, and `unknown` is the
  // ORDINARY one (~99.86% of dispatches carry no joinable credential identity)
  // — so it is styled as quiet/absent-of-evidence, never as healthy. A lane with
  // no `credential` at all (a status-only fallback lane, which has no session
  // identity to resolve) reads as `unknown` for the same reason.
  const CRED_TEXT = {
    dead: '⚠ credential dead',
    ok: '✓ credential ok',
    unknown: '○ credential unknown',
  };
  const CRED_TITLE = {
    dead: 'This session’s credential is dead: its workspace-scoped calls report token_ownerless while its workspace-free calls still succeed. Re-issue the token.',
    ok: 'No credential-death evidence in the last 15 minutes. Not a verified-healthy check.',
    unknown: 'No recent credential evidence for this session — the ordinary case, not a fault.',
  };
  function credState(lane) {
    const s = lane && lane.credential && lane.credential.state;
    return s === 'dead' || s === 'ok' ? s : 'unknown';
  }

  function laneNode(lane) {
    const shimmer = REDUCED_MOTION ? '' : ' lc-lane--pulse';
    const li = nodeFromHtml(`<li class="lc-lane${shimmer}" data-testid="live-console-lane">
        <span class="lc-lane-bar" aria-hidden="true"></span>
        <a class="lc-lane-task" href="#"></a>
        <span class="lc-lane-mid">
          <span class="lc-lane-action"></span>
          <span class="lc-lane-cred" data-testid="live-console-lane-credential"></span>
          <span class="lc-lane-hb" data-testid="live-console-heartbeat"></span>
          <span class="lc-lane-summary"></span>
        </span>
        <span class="lc-lane-ws"></span>
      </li>`);
    updateLaneNode(li, lane);
    return li;
  }
  function updateLaneNode(li, lane) {
    const task = li.querySelector('.lc-lane-task');
    task.textContent = lane.task || '?';
    task.setAttribute('href', obsHref(lane.workspaceUrlKey));
    task.setAttribute('title', `open ${lane.workspaceName || lane.workspaceUrlKey} in Observation`);
    li.querySelector('.lc-lane-action').textContent = lane.action || 'working';
    // Credential badge — textContent like every sibling field, so a hostile
    // token label could not become markup even if one were shown here (it is
    // deliberately not: the label is display-only and adds nothing to a rail
    // already keyed by workspace+task).
    const cred = li.querySelector('.lc-lane-cred');
    const state = credState(lane);
    cred.textContent = CRED_TEXT[state];
    cred.setAttribute('data-state', state);
    cred.setAttribute('title', CRED_TITLE[state]);
    li.querySelector('.lc-lane-hb').innerHTML = fmtHeartbeat(lane.heartbeat); // live tick — pre-escaped HTML (idle chip)
    const sum = li.querySelector('.lc-lane-summary');
    sum.textContent = lane.summary || '';
    sum.setAttribute('title', lane.summary || '');
    li.querySelector('.lc-lane-ws').textContent = lane.workspaceName || lane.workspaceUrlKey || '';
  }
  function paintLanes(lanes) {
    if (!els.lanes) return;
    const visible = (Array.isArray(lanes) ? lanes : []).filter(l => l.task && isVisibleWs(l.workspaceUrlKey));
    const wanted = new Set(visible.map(l => `${l.workspaceUrlKey}::${l.task}`));
    for (const [key, node] of laneNodes) {
      if (!wanted.has(key)) { node.remove(); laneNodes.delete(key); }
    }
    let prev = null;
    for (const lane of visible) {
      const key = `${lane.workspaceUrlKey}::${lane.task}`;
      let node = laneNodes.get(key);
      if (node) updateLaneNode(node, lane);
      else { node = laneNode(lane); laneNodes.set(key, node); }
      const target = prev ? prev.nextSibling : els.lanes.firstChild;
      if (node !== target) els.lanes.insertBefore(node, target);
      prev = node;
    }
    if (els.lanesEmpty) els.lanesEmpty.hidden = visible.length > 0;
  }

  // ─── Events (immutable; insert new, trim, keep continuity) ──────────────────
  function eventNode(ev, isNew) {
    const k = kindOf(ev.kind);
    const cls = 'lc-event' + (isNew && !REDUCED_MOTION ? ' lc-event--new' : '');
    const taskHtml = ev.task
      ? `<a class="lc-event-task" href="${esc(obsHref(ev.workspaceUrlKey))}" title="open ${esc(ev.workspaceName || ev.workspaceUrlKey)} in Observation">${esc(ev.task)}</a>`
      : '';
    const action = ev.action ? `<span class="lc-event-action">${esc(ev.action)}</span>` : '';
    // Evidence summaries link to the artifact itself; others are plain text.
    const summary = ev.summary
      ? (ev.kind === 'evidence' && ev.url
          ? `<a class="lc-event-summary lc-event-summary-link" href="${esc(ev.url)}" target="_blank" rel="noopener" title="${esc(ev.summary)}">${esc(ev.summary)}</a>`
          : `<span class="lc-event-summary" title="${esc(ev.summary)}">${esc(ev.summary)}</span>`)
      : '';
    const ws = `<span class="lc-event-ws">${esc(ev.workspaceName || ev.workspaceUrlKey || '')}</span>`;
    const when = `<span class="lc-event-time" data-iso="${esc(ev.iso)}">${esc(rel(ev.iso))}</span>`;
    return nodeFromHtml(`<li class="${cls}" data-kind="${esc(ev.kind)}" data-testid="live-console-event">
        <span class="lc-event-glyph" aria-hidden="true">${esc(k.glyph)}</span>
        <span class="lc-event-body">${taskHtml}${action}${summary}</span>
        <span class="lc-event-meta">${ws}${when}</span>
      </li>`);
  }

  function paintStream(events, newIds) {
    if (!els.stream) return;
    const visible = (Array.isArray(events) ? events : [])
      .filter(e => isVisibleWs(e.workspaceUrlKey))
      .slice(0, MAX_DOM_EVENTS);
    const wanted = new Set(visible.map(e => e.id));
    for (const [id, node] of eventNodes) {
      if (!wanted.has(id)) { node.remove(); eventNodes.delete(id); }
    }
    let prev = null;
    for (const ev of visible) {
      let node = eventNodes.get(ev.id);
      if (!node) { node = eventNode(ev, newIds.has(ev.id)); eventNodes.set(ev.id, node); }
      const target = prev ? prev.nextSibling : els.stream.firstChild;
      if (node !== target) els.stream.insertBefore(node, target);
      prev = node;
    }
    if (els.streamEmpty) els.streamEmpty.hidden = visible.length > 0 || eventNodes.size > 0;
  }

  function retickTimes() {
    document.querySelectorAll('.lc-event-time[data-iso]').forEach(el => {
      el.textContent = rel(el.getAttribute('data-iso'));
    });
  }

  // ─── History (view more) ────────────────────────────────────────────────────
  function updateMoreButton() {
    if (!els.more) return;
    // Offer "view earlier" whenever there is anything on screen and we have not
    // paged all the way to the history floor — older events beyond the live
    // window aren't known until we ask, so the affordance stays available.
    const hasAnything = eventNodes.size > 0 || historyIds.size > 0;
    els.more.hidden = !(hasAnything && !historyExhausted);
    if (els.moreBtn) {
      els.moreBtn.disabled = historyLoading;
      els.moreBtn.textContent = historyLoading ? 'loading…' : 'view earlier activity ↓';
    }
  }
  function filterHistory() {
    if (!els.history) return;
    els.history.querySelectorAll('[data-ws]').forEach(li => {
      li.hidden = !isVisibleWs(li.getAttribute('data-ws'));
    });
  }
  function appendHistory(events) {
    if (!els.history) return;
    for (const ev of events) {
      if (historyIds.has(ev.id) || eventNodes.has(ev.id)) continue; // dedup vs history + live
      historyIds.add(ev.id);
      const node = eventNode(ev, false);
      node.classList.add('lc-event--history');
      node.setAttribute('data-ws', ev.workspaceUrlKey || '');
      node.hidden = !isVisibleWs(ev.workspaceUrlKey);
      els.history.appendChild(node);
    }
    // Trim the oldest history rows if the region grows too large.
    while (els.history.children.length > MAX_HISTORY_ROWS) {
      const first = els.history.firstElementChild;
      if (!first) break;
      els.history.removeChild(first);
    }
  }
  async function loadMore() {
    if (historyLoading) return;
    const cursor = historyCursor != null ? historyCursor : liveOldestTs;
    if (cursor == null) return;
    historyLoading = true;
    updateMoreButton();
    try {
      const res = await window.api(
        `/workspace/${encodeURIComponent(urlKey)}/api/live-console/events?before=${encodeURIComponent(cursor)}&limit=${HISTORY_PAGE}`,
        { on401: '/logout' }
      );
      appendHistory(Array.isArray(res.events) ? res.events : []);
      historyCursor = res.oldestTs != null ? res.oldestTs : historyCursor;
      if (!res.hasMore) historyExhausted = true;
    } catch (err) {
      if (els.moreBtn) els.moreBtn.textContent = 'could not load — try again';
    } finally {
      historyLoading = false;
      updateMoreButton();
    }
  }

  // ─── Apply a live feed (shared by poll + chip re-filter) ────────────────────
  function applyFeed(feed, animate) {
    if (firstPaint) { clearSkeleton(); firstPaint = false; }
    const events = Array.isArray(feed.events) ? feed.events : [];
    const newIds = new Set(animate ? events.filter(e => !seenEventIds.has(e.id)).map(e => e.id) : []);
    seenEventIds = new Set(events.map(e => e.id));
    liveOldestTs = feed.oldestTs != null ? feed.oldestTs : liveOldestTs;
    liveHasMore = !!feed.hasMore;
    lastServerNow = feed.serverNow || lastServerNow;
    if (!timelineFitLatched) {
      timelineFitLatched = true;
      latchTimelineFitWindow(feed.timeline);
    }
    paintBanner(feed.summary);
    updatePulse(feed);
    paintLanes(feed.lanes);
    paintStream(events, newIds);
    // isVisibleWs parity with the chip filter, same as paintLanes/paintStream —
    // wired AFTER paintStream so both share one chip-toggle re-filter path.
    paintTimeline(feed.timeline);
    updateMoreButton();
  }

  // ─── Poll loop (chained, in-flight-guarded, backoff) ────────────────────────
  async function poll() {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      // LIN-1505 Phase C: carry the active rung on EVERY poll, not just the
      // triggering one — otherwise the regular 5s cadence would silently
      // revert to the 3-min default after a debounced rung refetch (span is
      // session-only, but that means "survives every poll", not "survives
      // only until the next one").
      const feed = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/live-console/events?pulseSpanMs=${pulseServerSpanMs}`, { on401: '/logout' });
      failures = 0;
      lastFeed = feed;
      applyFeed(feed, true);
    } catch (err) {
      if (err && err.status === 401) return;
      failures += 1;
      paintDisconnected();
    } finally {
      inFlight = false;
      if (!stopped) schedule();
    }
  }
  function schedule() {
    clearTimeout(pollTimer);
    const delay = failures > 0 ? Math.min(POLL_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS) : POLL_MS;
    pollTimer = setTimeout(poll, delay);
  }
  function start() {
    stopped = false;
    poll();
    clearInterval(tickTimer);
    tickTimer = setInterval(retickTimes, TICK_MS);
    startPulse();
  }
  function stop() {
    stopped = true;
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    stopPulse();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  if (els.moreBtn) els.moreBtn.addEventListener('click', loadMore);
  buildChips();
  wireTimelineGestures();
  wirePulseGestures();
  updatePulseSpanText();
  renderSkeleton();
  start();
})();
