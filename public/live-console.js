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
  const PULSE_WINDOW_MS = 3 * 60 * 1000; // time span the flowing strip covers (right=now)
  const TIMELINE_WINDOW_MS = 24 * 60 * 60 * 1000; // fixed, non-zoomed 24h axis (Phase 1)
  const TIMELINE_ROW_HEIGHT = 18;
  const TIMELINE_ROW_GAP = 4;
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
    chips: document.getElementById('live-console-chips'),
    timeline: document.getElementById('live-console-timeline'),
    timelineEmpty: document.getElementById('live-console-timeline-empty'),
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
  function fmtHeartbeat(hb) {
    if (!hb) return '';
    const bits = [];
    const n = hb.total != null ? hb.total : hb.toolCount;
    if (n != null) bits.push(`${n} tool${n === 1 ? '' : 's'}`);
    if (hb.elapsedSeconds != null) bits.push(fmtDuration(hb.elapsedSeconds));
    if (hb.breakdown) {
      const top = Object.keys(hb.breakdown)
        .map(k => [k, hb.breakdown[k]])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${k}×${v}`)
        .join(' ');
      if (top) bits.push(top);
    }
    return bits.join(' · ');
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

  // ─── Timeline (LIN-1742, Phase 1: static, non-zoomable last-24h swimlane) ──
  // Bars are laid out on a fixed 24h axis (`start`/`end` epoch ms → left/width
  // percentages), stacked into the rows the SERVER already packed
  // (lib/live-console.js's packTimelineRows) — this phase does no client-side
  // repacking. Keyed reconcile by run id (same house rule as paintLanes/
  // paintStream, above: nodes updated in place, never innerHTML-replaced, so a
  // hidden bar's node reference survives a poll tick).
  function timelineLabel(run) {
    return (run && (run.kind || run.promptName)) || 'run';
  }
  function timelineBarNode(run) {
    const div = document.createElement('div');
    div.className = 'lc-timeline-bar';
    div.setAttribute('data-testid', 'live-console-timeline-bar');
    updateTimelineBarNode(div, run, 0);
    return div;
  }
  function updateTimelineBarNode(div, run, rowIndex) {
    const now = lastServerNow || Date.now();
    const windowStart = now - TIMELINE_WINDOW_MS;
    const clampedEnd = run.end != null ? run.end : now;
    const pct = (t) => Math.max(0, Math.min(100, ((t - windowStart) / TIMELINE_WINDOW_MS) * 100));
    const startPct = pct(run.start);
    // A visible sliver for a near-zero-duration run, but never past the
    // container's right edge — a run ending right at "now" (startPct ≈ 100)
    // must not push left+width over 100% and force a horizontal scrollbar.
    const widthPct = Math.min(Math.max(pct(clampedEnd) - startPct, 0.6), 100 - startPct);
    div.style.left = `${startPct}%`;
    div.style.width = `${widthPct}%`;
    div.style.top = `${rowIndex * (TIMELINE_ROW_HEIGHT + TIMELINE_ROW_GAP)}px`;
    div.setAttribute('data-kind', run.outcomeKind || 'info');
    div.classList.toggle('lc-timeline-bar--clipped', !!run.clippedStart);
    div.setAttribute('data-ws', run.workspaceUrlKey || '');
    div.hidden = !isVisibleWs(run.workspaceUrlKey);
    const label = `${run.issueIdentifier || '?'} — ${timelineLabel(run)}`;
    div.title = label;
    div.setAttribute('aria-label', label);
  }
  function paintTimeline(timeline) {
    if (!els.timeline) return;
    const rows = Array.isArray(timeline && timeline.rows) ? timeline.rows : [];
    const flat = [];
    rows.forEach((row, rowIndex) => {
      (Array.isArray(row) ? row : []).forEach(run => { if (run) flat.push({ run, rowIndex }); });
    });

    const wanted = new Set(flat.map(f => f.run.id));
    for (const [id, node] of timelineBarNodes) {
      if (!wanted.has(id)) { node.remove(); timelineBarNodes.delete(id); }
    }
    for (const { run, rowIndex } of flat) {
      let node = timelineBarNodes.get(run.id);
      if (!node) { node = timelineBarNode(run); timelineBarNodes.set(run.id, node); els.timeline.appendChild(node); }
      updateTimelineBarNode(node, run, rowIndex);
    }
    els.timeline.style.height = `${Math.max(rows.length, 1) * (TIMELINE_ROW_HEIGHT + TIMELINE_ROW_GAP)}px`;

    const visibleCount = flat.filter(f => isVisibleWs(f.run.workspaceUrlKey)).length;
    if (els.timelineEmpty) els.timelineEmpty.hidden = visibleCount > 0;
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

  let pulseData = { buckets: [], bucketMs: 5000, endTs: 0, serverNow: 0, perf: 0, events: [] };
  let humMax = 1;
  let rafId = null;

  function updatePulse(feed) {
    const p = feed.pulse || {};
    pulseData.buckets = Array.isArray(p.buckets) ? p.buckets : [];
    pulseData.bucketMs = p.bucketMs || 5000;
    pulseData.endTs = p.endTs || feed.serverNow || 0;
    pulseData.serverNow = feed.serverNow || pulseData.endTs || 0;
    pulseData.perf = (window.performance && performance.now) ? performance.now() : 0;
    pulseData.events = (Array.isArray(feed.events) ? feed.events : []).map(e => ({ ts: e.ts, kind: e.kind }));
    const curMax = pulseData.buckets.length ? Math.max.apply(null, pulseData.buckets) : 0;
    humMax = Math.max(curMax, humMax * 0.9, 1); // slow-decay → stable vertical scale
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
    const xFor = (ts) => W * (1 - (effNow - ts) / PULSE_WINDOW_MS);

    // Heartbeat hum area.
    const b = pulseData.buckets;
    if (b.length) {
      ctx.beginPath();
      let firstX = null, lastX = null;
      for (let i = 0; i < b.length; i++) {
        const tsCenter = pulseData.endTs - (b.length - 1 - i) * pulseData.bucketMs + pulseData.bucketMs / 2;
        const x = xFor(tsCenter);
        const y = base - (b[i] / humMax) * humH;
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
    }

    // Baseline hairline.
    ctx.strokeStyle = cssVar('--line-soft', 'rgba(0,0,0,0.08)');
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, base + 0.5); ctx.lineTo(W, base + 0.5); ctx.stroke();

    // Event blips: a thin riser + a dot, coloured by kind, fading as they age.
    const fadeStart = PULSE_WINDOW_MS * 0.75;
    const dotY = base - humH * 0.7;
    for (const ev of pulseData.events) {
      const age = effNow - ev.ts;
      if (age < -2000 || age > PULSE_WINDOW_MS) continue;
      let x = xFor(ev.ts);
      if (x > W) x = W;
      const alpha = age > fadeStart ? Math.max(0, 1 - (age - fadeStart) / (PULSE_WINDOW_MS - fadeStart)) : 1;
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
    li.querySelector('.lc-lane-hb').textContent = fmtHeartbeat(lane.heartbeat); // live tick
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
      const feed = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/live-console/events`, { on401: '/logout' });
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
  renderSkeleton();
  start();
})();
