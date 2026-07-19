/**
 * Live Console client (experimental, LIN-1436).
 *
 * The ambient, lean-back view. Polls the generation-free events endpoint and
 * paints three surfaces:
 *   - the status banner + tempo sparkline (the system's rhythm),
 *   - the pulse-lane rail (one breathing lane per currently-working agent),
 *   - the activity stream (newest-first; genuinely-new events animate in).
 *
 * Built to be left open all day: a KEYED reconcile (not innerHTML replace) keeps
 * lane pulses breathing continuously and never wipes a text selection mid-read;
 * polling is a chained setTimeout with an in-flight guard + exponential backoff,
 * so a slow/down server is never hammered and polls never overlap; the
 * seen-ids set is bounded to the last poll. Cross-workspace chips filter the
 * already-merged feed in place (no refetch).
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
  const MAX_DOM_EVENTS = 80;   // cap rendered rows (feed itself is capped server-side)
  const TICK_MS = 30000;       // relative-time refresh cadence
  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Kind → glyph (colour lives in live-console.css via [data-kind]).
  const KIND = {
    done:    { glyph: '✓' },
    working: { glyph: '◐' },
    blocked: { glyph: '◑' },
    failed:  { glyph: '✗' },
    info:    { glyph: '·' },
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
  };

  // ─── State ────────────────────────────────────────────────────────────────
  const hiddenWorkspaces = new Set();   // urlKeys toggled off (chip filter)
  let seenEventIds = new Set();         // ids from the LAST poll (bounded; only to detect new arrivals)
  const laneNodes = new Map();          // `${ws}::${task}` → <li>
  const eventNodes = new Map();         // event id → <li>
  let lastFeed = null;                  // last successful feed (for in-place re-filter)
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
        // Re-render in place from the cached feed — no refetch, no re-animation.
        if (lastFeed) applyFeed(lastFeed, false);
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
      els.status.textContent = firstPaint
        ? 'could not reach the feed — retrying…'
        : 'reconnecting to the feed…';
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
    const cssW = canvas.width;   // attribute px = logical CSS px
    const cssH = canvas.height;
    // Scale the backing store for crisp HiDPI rendering; guard against re-scaling.
    const wantW = Math.round(cssW * dpr);
    const wantH = Math.round(cssH * dpr);
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
        <a class="lc-lane-task" href="${esc(obsHref(lane.workspaceUrlKey))}"></a>
        <span class="lc-lane-action"></span>
        <span class="lc-lane-summary"></span>
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

  // ─── Stream (events are immutable; insert new, trim, keep continuity) ────────
  function eventNode(ev, isNew) {
    const k = kindOf(ev.kind);
    const cls = 'lc-event' + (isNew && !REDUCED_MOTION ? ' lc-event--new' : '');
    const taskHtml = ev.task
      ? `<a class="lc-event-task" href="${esc(obsHref(ev.workspaceUrlKey))}" title="open ${esc(ev.workspaceName || ev.workspaceUrlKey)} in Observation">${esc(ev.task)}</a>`
      : '';
    const action = ev.action ? `<span class="lc-event-action">${esc(ev.action)}</span>` : '';
    const summary = ev.summary ? `<span class="lc-event-summary" title="${esc(ev.summary)}">${esc(ev.summary)}</span>` : '';
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
    if (els.streamEmpty) els.streamEmpty.hidden = visible.length > 0;
  }

  // Re-tick relative times in place (no re-render) so "just now" ages honestly.
  function retickTimes() {
    document.querySelectorAll('.lc-event-time[data-iso]').forEach(el => {
      el.textContent = rel(el.getAttribute('data-iso'));
    });
  }

  // ─── Apply a feed (shared by poll + chip re-filter) ─────────────────────────
  function applyFeed(feed, animate) {
    if (firstPaint) { clearSkeleton(); firstPaint = false; }
    const events = Array.isArray(feed.events) ? feed.events : [];
    const newIds = new Set(animate ? events.filter(e => !seenEventIds.has(e.id)).map(e => e.id) : []);
    seenEventIds = new Set(events.map(e => e.id)); // bounded to this poll
    paintBanner(feed.summary);
    paintTempo(feed.tempo);
    paintLanes(feed.lanes);
    paintStream(events, newIds);
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
      if (err && err.status === 401) return; // window.api already redirected
      failures += 1;
      paintDisconnected();
    } finally {
      inFlight = false;
      if (!stopped) schedule();
    }
  }

  function schedule() {
    clearTimeout(pollTimer);
    const delay = failures > 0
      ? Math.min(POLL_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS)
      : POLL_MS;
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

  // Pause polling while the tab is hidden (an ambient view left open all day
  // shouldn't hammer the server in the background); resume + refresh on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  buildChips();
  renderSkeleton();
  start();
})();
