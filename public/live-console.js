/**
 * Live Console client (experimental, LIN-1436).
 *
 * The ambient, lean-back view. Polls the generation-free events endpoint and
 * paints three surfaces:
 *   - the status banner + tempo sparkline (the system's rhythm),
 *   - the pulse-lane rail (one breathing lane per currently-working agent),
 *   - the activity stream (newest-first; genuinely-new events animate in).
 *
 * Pure presentation — no LLM, no writes. Requires common.js (window.api,
 * window.escapeHtml, window.relativeTime). Loaded only on /live-console.
 */
(function () {
  'use strict';

  const data = window.__LIVE_CONSOLE_DATA__ || {};
  const urlKey = data.urlKey || '';
  if (!urlKey) return;

  const POLL_MS = 5000;
  const MAX_DOM_EVENTS = 80; // cap rendered rows; the feed itself is capped server-side
  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Kind → glyph + CSS state key (colour lives in live-console.css via [data-kind]).
  const KIND = {
    done:    { glyph: '✓', label: 'done' },
    working: { glyph: '◐', label: 'working' },
    blocked: { glyph: '◑', label: 'blocked' },
    failed:  { glyph: '✗', label: 'failed' },
    info:    { glyph: '·', label: '' },
  };

  const els = {
    dot: document.getElementById('live-console-dot'),
    status: document.getElementById('live-console-status'),
    tempo: document.getElementById('live-console-tempo'),
    lanes: document.getElementById('live-console-lanes'),
    lanesEmpty: document.getElementById('live-console-lanes-empty'),
    stream: document.getElementById('live-console-stream'),
    streamEmpty: document.getElementById('live-console-stream-empty'),
  };

  const seenEventIds = new Set(); // ids we've already shown (so only NEW ones animate)
  let firstPaint = true;
  let pollTimer = null;

  const esc = (s) => (window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const rel = (iso) => (window.relativeTime ? window.relativeTime(iso) : '');

  function kindOf(k) { return KIND[k] || KIND.info; }

  // ─── Banner + dot ───────────────────────────────────────────────────────────
  function paintBanner(summary) {
    const s = summary || { active: 0, done: 0, failed: 0, blocked: 0, total: 0 };
    const bits = [];
    bits.push(`${s.active} working`);
    if (s.done) bits.push(`${s.done} done`);
    if (s.blocked) bits.push(`${s.blocked} blocked`);
    if (s.failed) bits.push(`${s.failed} failed`);
    if (els.status) els.status.textContent = s.total ? bits.join(' · ') : 'quiet — nothing in flight right now';

    // Dot health: red if anything failed, amber (pulsing) if work is live, else green.
    let health = 'idle';
    if (s.failed) health = 'error';
    else if (s.active) health = 'live';
    else if (s.total) health = 'done';
    if (els.dot) {
      els.dot.setAttribute('data-health', health);
      els.dot.classList.toggle('lc-status-dot--pulse', health === 'live' && !REDUCED_MOTION);
    }
  }

  // ─── Tempo sparkline ──────────────────────────────────────────────────────────
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
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!arr.length) return;

    const max = Math.max(1, ...arr);
    const barW = W / arr.length;
    const amber = cssVar('--amber', '#c58a00');
    const muted = cssVar('--line', '#ccc');
    for (let i = 0; i < arr.length; i++) {
      const h = Math.round((arr[i] / max) * (H - 2));
      const x = Math.round(i * barW);
      const w = Math.max(1, Math.ceil(barW) - 1);
      ctx.fillStyle = arr[i] > 0 ? amber : muted;
      const y = arr[i] > 0 ? (H - h) : (H - 1);
      ctx.fillRect(x, y, w, arr[i] > 0 ? h : 1);
    }
  }

  // ─── Pulse-lane rail ──────────────────────────────────────────────────────────
  function laneHtml(lane) {
    const task = esc(lane.task || '?');
    const ws = esc(lane.workspaceName || lane.workspaceUrlKey || '');
    const action = esc(lane.action || 'working');
    const summary = esc(lane.summary || '');
    const shimmer = REDUCED_MOTION ? '' : ' lc-lane--pulse';
    return `<li class="lc-lane${shimmer}" data-testid="live-console-lane">
        <span class="lc-lane-bar" aria-hidden="true"></span>
        <span class="lc-lane-task">${task}</span>
        <span class="lc-lane-action">${action}</span>
        <span class="lc-lane-summary">${summary}</span>
        <span class="lc-lane-ws">${ws}</span>
      </li>`;
  }

  function paintLanes(lanes) {
    const arr = Array.isArray(lanes) ? lanes : [];
    if (!els.lanes) return;
    els.lanes.innerHTML = arr.map(laneHtml).join('');
    if (els.lanesEmpty) els.lanesEmpty.hidden = arr.length > 0;
  }

  // ─── Activity stream ──────────────────────────────────────────────────────────
  function eventHtml(ev, isNew) {
    const k = kindOf(ev.kind);
    const cls = 'lc-event' + (isNew && !REDUCED_MOTION ? ' lc-event--new' : '');
    const task = ev.task ? `<span class="lc-event-task">${esc(ev.task)}</span>` : '';
    const action = ev.action ? `<span class="lc-event-action">${esc(ev.action)}</span>` : '';
    const summary = ev.summary ? `<span class="lc-event-summary">${esc(ev.summary)}</span>` : '';
    const ws = `<span class="lc-event-ws">${esc(ev.workspaceName || ev.workspaceUrlKey || '')}</span>`;
    const when = `<span class="lc-event-time">${esc(rel(ev.iso))}</span>`;
    return `<li class="${cls}" data-kind="${esc(ev.kind)}" data-testid="live-console-event">
        <span class="lc-event-glyph" aria-hidden="true">${esc(k.glyph)}</span>
        <span class="lc-event-body">${task}${action}${summary}</span>
        <span class="lc-event-meta">${ws}${when}</span>
      </li>`;
  }

  function paintStream(events) {
    const arr = (Array.isArray(events) ? events : []).slice(0, MAX_DOM_EVENTS);
    if (!els.stream) return;
    // On the very first paint, don't animate the backlog — only genuinely-new
    // arrivals on later polls should slide in.
    const html = arr.map(ev => eventHtml(ev, !firstPaint && !seenEventIds.has(ev.id))).join('');
    els.stream.innerHTML = html;
    for (const ev of arr) seenEventIds.add(ev.id);
    if (els.streamEmpty) els.streamEmpty.hidden = arr.length > 0;
  }

  // ─── Poll loop ──────────────────────────────────────────────────────────────
  async function poll() {
    try {
      const feed = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/live-console/events`, { on401: '/logout' });
      paintBanner(feed.summary);
      paintTempo(feed.tempo);
      paintLanes(feed.lanes);
      paintStream(feed.events);
      firstPaint = false;
    } catch (err) {
      if (els.status && firstPaint) els.status.textContent = 'could not reach the feed — retrying…';
    }
  }

  function start() {
    stop();
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }
  function stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // Pause polling while the tab is hidden (an ambient view left open all day
  // shouldn't hammer the server in the background); resume + refresh on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  start();
})();
