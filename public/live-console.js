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

  // ─── Tempo sparkline (DPR-aware) ────────────────────────────────────────────
  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  function paintTempo(tempo) {
    const canvas = els.tempo;
    if (!canvas || !canvas.getContext) return;
    const arr = Array.isArray(tempo) ? tempo : [];
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = parseInt(canvas.getAttribute('width'), 10) || 160;
    const cssH = parseInt(canvas.getAttribute('height'), 10) || 28;
    const wantW = Math.round(cssW * dpr), wantH = Math.round(cssH * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      canvas.width = wantW;
      canvas.height = wantH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!arr.length) return;
    const max = Math.max(1, ...arr);
    const barW = cssW / arr.length;
    const amber = cssVar('--amber', '#c58a00');
    const muted = cssVar('--line', '#ccc');
    for (let i = 0; i < arr.length; i++) {
      const active = arr[i] > 0;
      const h = active ? Math.max(1, Math.round((arr[i] / max) * (cssH - 2))) : 1;
      const x = Math.round(i * barW);
      const w = Math.max(1, Math.ceil(barW) - 1);
      ctx.fillStyle = active ? amber : muted;
      ctx.fillRect(x, cssH - h, w, h);
    }
  }

  // ─── Lanes (keyed reconcile so pulses breathe continuously) ─────────────────
  function laneNode(lane) {
    const shimmer = REDUCED_MOTION ? '' : ' lc-lane--pulse';
    const li = nodeFromHtml(`<li class="lc-lane${shimmer}" data-testid="live-console-lane">
        <span class="lc-lane-bar" aria-hidden="true"></span>
        <a class="lc-lane-task" href="#"></a>
        <span class="lc-lane-mid">
          <span class="lc-lane-action"></span>
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
    paintBanner(feed.summary);
    paintTempo(feed.tempo);
    paintLanes(feed.lanes);
    paintStream(events, newIds);
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
  }
  function stop() {
    stopped = true;
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
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
