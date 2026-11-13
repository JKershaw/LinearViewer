/**
 * Task page client (LIN-3329, Subtask B of LIN-3324).
 *
 * Keeps an open task page current while the work runs: polls the stored-data
 * state endpoint (`data-state-url` on `<main>`) and repaints the header status,
 * the progress track and the brief/recap panels from the HTML it returns.
 *
 * The poll loop is Live Console's (public/live-console.js): a chained
 * `setTimeout`, an in-flight guard, backoff on failure, paused while the tab is
 * hidden, one catch-up poll when it shows again. Cadence: 10 s while a session
 * is running or queued, 45 s otherwise. A page that loaded `done` never starts
 * polling — the state endpoint can't see the tracker, so it could never repaint
 * a done header truthfully (LIN-3324 Decisions: poll rule).
 *
 * The poll only ever requests the state URL. A second kind of request exists
 * (LIN-4405): the "Sessions on one clock" fragment (`data-timeline-url` on its
 * section), re-read by `createTimelineRefresher` when a poll's `trackHtml`
 * changes or every 60 s while a lane runs, never more than once per 60 s
 * window, and never once the poll stops (hidden tab, 401, revoked link). Done is
 * the one exception: it reads once more, past the window, then stops (`finish`).
 * Owner-only behaviour starts from owner-only DOM hooks: the brief/recap widgets mount from the
 * `task-page-owner-widgets` marker, and the close-out box (public/close-out.js)
 * is its own owner fragment. A guest loads the same scripts and they no-op.
 *
 * Evidence and the description/comments block sit OUTSIDE every poll-repainted
 * mount, so a repaint can never lose or move them. The brief/recap panels are
 * never repainted by a poll (LIN-3975: the state read carries none); the owner's
 * widgets own their refresh, and a guest keeps the page-load panels.
 *
 * The owner's run control (LIN-3975) is the shared PromptSection, mounted here
 * from its `data-run-opts` before any Markdown renders. It owns its own refresh.
 *
 * A repaint never collapses a row the reader opened: an open-set keyed by
 * `data-loop-id` is seeded from the rows rendered open and re-applied after
 * every swap. A row the reader closed stays closed; a new running row opens
 * itself. The run page's script (public/session.js) is not loaded here, so the
 * row toggle is this file's own, delegated from the track mount.
 */
import { fmtDuration, relativeAgo } from '../lib/time-words.js';

var FAST_MS = 10000;
var SLOW_MS = 45000;
var MAX_BACKOFF_MS = 5 * 60 * 1000;
var TICK_MS = 1000;
// LIN-4070: an incomplete reply means the held set is still landing; the next read comes sooner than the usual cadence.
var INCOMPLETE_MS = 1000;
// Fast reads of an incomplete state stop after this many in a row (LIN-4071): the box's own re-read caps at 15 too, so a
// held set that never fills costs a bounded burst, then the normal cadence.
var INCOMPLETE_LIMIT = 15;
var OPEN_CLASS = 'sess-run--expanded';
// LIN-4405: the timeline fragment is read at most once per window, and every window while a lane runs.
var TIMELINE_WINDOW_MS = 60000;

/**
 * The next poll delay, or null for "don't schedule one". Pure.
 *
 * @param {string} status - page status; 'running' polls fast, 'done' never polls
 * @param {boolean} visible - the tab is visible
 * @param {number} failures - consecutive failed polls (backoff)
 * @returns {number|null}
 */
function pollDelay(status, visible, failures) {
  if (!visible || status === 'done') return null;
  var base = status === 'running' ? FAST_MS : SLOW_MS;
  if (!(failures > 0)) return base;
  return Math.min(base * Math.pow(2, failures), MAX_BACKOFF_MS);
}

/** The poll cadence status: any live (running/queued) session polls fast. */
function cadenceStatus(state) {
  if (!state) return 'idle';
  if (state.status === 'done') return 'done';
  return state.live ? 'running' : state.status;
}

/**
 * The poll loop. Every request it makes is `fetchJson(stateUrl)`; the timeline fragment is the page's one other
 * request, and `createTimelineRefresher` makes it, not this loop (LIN-4405).
 *
 * @param {Object} o
 * @param {string} o.stateUrl
 * @param {Function} o.fetchJson - (url) → Promise<state>
 * @param {Function} o.apply - (state) → void
 * @param {Function} o.isVisible - () → boolean
 * @param {{status: string, live: boolean}} o.initial
 * @param {Function} [o.setTimer]
 * @param {Function} [o.clearTimer]
 */
function createPoller(o) {
  var setTimer = o.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
  var clearTimer = o.clearTimer || function (id) { clearTimeout(id); };
  var current = o.initial || { status: 'idle', live: false };
  var inFlight = false;
  var stopped = false;
  var failures = 0;
  var timer = null;
  // An unsettled page (`o.unsettled`: its first render is provisional, LIN-4071) reads again soon, as an incomplete reply does.
  var incompleteStreak = o.unsettled ? 1 : 0;

  function schedule() {
    clearTimer(timer);
    timer = null;
    if (stopped) return;
    var delay = pollDelay(cadenceStatus(current), o.isVisible(), failures);
    if (delay == null) return;
    if (incompleteStreak > 0 && incompleteStreak <= INCOMPLETE_LIMIT) delay = Math.min(delay, INCOMPLETE_MS);
    timer = setTimer(poll, delay);
  }

  function poll() {
    if (inFlight || stopped) return Promise.resolve();
    inFlight = true;
    return Promise.resolve()
      .then(function () { return o.fetchJson(o.stateUrl); })
      .then(function (state) {
        failures = 0;
        if (state) {
          // A complete reply carries the gathered status (LIN-4071: `done` only when the gather says so). An incomplete
          // reply carries none: keep the last complete one, and read again soon.
          incompleteStreak = state.incomplete ? incompleteStreak + 1 : 0;
          if (!state.incomplete) current = { status: state.status, live: !!state.live };
          o.apply(state);
        }
      }, function (err) {
        if (err && err.status === 401) { stopped = true; return; }
        if (err && err.status === 404 && o.onGone) {
          // A revoked (or never-issued) link on a GUEST page: stop and say so.
          // Owner pages pass no `onGone`, so their 404s fall through and count
          // as poll failures, exactly as they did before this feature.
          stopped = true;
          o.onGone();
          return;
        }
        failures += 1;
      })
      .then(function () {
        inFlight = false;
        schedule();
      });
  }

  function onVisibilityChange(hidden) {
    if (stopped) return;
    if (hidden) { clearTimer(timer); timer = null; return; }
    poll();
  }

  return {
    start: schedule,
    poll: poll,
    onVisibilityChange: onVisibilityChange,
    stop: function () { stopped = true; clearTimer(timer); timer = null; },
    isStopped: function () { return stopped; },
    state: function () { return { current: current, failures: failures, timer: timer, inFlight: inFlight }; }
  };
}

/**
 * The "Sessions on one clock" refresher (LIN-4405). It asks for the fragment when the poll's `trackHtml` changes
 * (`noteTrack`; the first value only seeds it, since the page load drew the same history) and, while the painted
 * timeline has a running lane (`isRunning`), once per window. Every reason is coalesced: at most one fetch per
 * `TIMELINE_WINDOW_MS`, a reason inside the window becomes one trailing fetch at its end, and nothing overlaps.
 * `pause` (hidden tab) and `stop` (401, revoked) clear the timer; `resume` asks once if a lane runs. `finish` (the
 * first done) is the one exception to the window: the poll that says done usually carries the track change of the
 * last session ending, so it reads once now, paints it, then stops, and no lane is left painted running.
 *
 * @param {Object} o
 * @param {string} o.url
 * @param {Function} o.fetchJson - (url) → Promise<{timelineHtml: string}>
 * @param {Function} o.apply - (html) → void
 * @param {Function} o.isRunning - () → boolean, read from the painted timeline
 * @param {Function} [o.now] - () → ms
 * @param {Function} [o.setTimer]
 * @param {Function} [o.clearTimer]
 */
function createTimelineRefresher(o) {
  var setTimer = o.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
  var clearTimer = o.clearTimer || function (id) { clearTimeout(id); };
  var now = o.now || function () { return Date.now(); };
  var lastFetchAt = null;
  var lastTrack = null;
  var seeded = false;
  var inFlight = false;
  var wanted = false;
  var stopped = false;
  var paused = false;
  var finishing = false;
  var finalPending = false;
  var timer = null;

  function arm(delay) {
    clearTimer(timer);
    timer = setTimer(function () { timer = null; fetchNow(); }, Math.max(0, delay));
  }

  function request() {
    if (stopped || paused) return;
    wanted = true;
    if (inFlight || timer !== null) return;
    var wait = lastFetchAt === null ? 0 : lastFetchAt + TIMELINE_WINDOW_MS - now();
    if (wait <= 0) fetchNow(); else arm(wait);
  }

  function fetchNow() {
    if (stopped || paused || inFlight) return Promise.resolve();
    inFlight = true;
    wanted = false;
    lastFetchAt = now();
    return Promise.resolve()
      .then(function () { return o.fetchJson(o.url); })
      .then(function (body) {
        if (!stopped && body && typeof body.timelineHtml === 'string') o.apply(body.timelineHtml);
      }, function (err) {
        // Signed out, or a revoked guest link: stop for good, as the poll does.
        if (err && (err.status === 401 || err.status === 404)) stopped = true;
      })
      .then(function () {
        inFlight = false;
        if (finishing) {
          // A read already in flight when done arrived may predate it: read once more, then stop for good.
          if (finalPending && !stopped) { finalPending = false; return fetchNow(); }
          stopped = true;
          return;
        }
        if (stopped || paused) return;
        if (wanted || o.isRunning()) arm(TIMELINE_WINDOW_MS);
      });
  }

  return {
    noteTrack: function (trackHtml) {
      if (typeof trackHtml !== 'string') return;
      if (!seeded) { seeded = true; lastTrack = trackHtml; return; }
      if (trackHtml === lastTrack) return;
      lastTrack = trackHtml;
      request();
    },
    // The page loaded with a running lane: re-read one window after the load.
    start: function () { if (!stopped && o.isRunning()) { lastFetchAt = now(); arm(TIMELINE_WINDOW_MS); } },
    request: request,
    pause: function () { paused = true; clearTimer(timer); timer = null; },
    resume: function () { if (stopped) return; paused = false; if (o.isRunning()) request(); },
    stop: function () { stopped = true; clearTimer(timer); timer = null; },
    finish: function () {
      if (stopped || finishing) return Promise.resolve();
      finishing = true;
      paused = false;
      clearTimer(timer);
      timer = null;
      if (inFlight) { finalPending = true; return Promise.resolve(); }
      return fetchNow();
    },
    state: function () { return { timer: timer, inFlight: inFlight, stopped: stopped, paused: paused, lastFetchAt: lastFetchAt }; }
  };
}

// ── Open rows across repaints ──────────────────────────────────────────────

function rowId(row) { return row.getAttribute('data-loop-id') || ''; }

function setRowOpen(row, open) {
  if (open) row.classList.add(OPEN_CLASS); else row.classList.remove(OPEN_CLASS);
  var head = row.querySelector('.task-stage-head') || row.querySelector('.sess-run-head');
  if (head) head.setAttribute('aria-expanded', String(!!open));
}

/** Seed the memory from the rows as rendered: open rows are remembered open. */
function createOpenMemory(rows) {
  var memory = { open: new Set(), closed: new Set() };
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].classList.contains(OPEN_CLASS)) memory.open.add(rowId(rows[i]));
  }
  return memory;
}

/** The reader toggled a row: remember it. */
function rememberToggle(memory, row, open) {
  var id = rowId(row);
  if (open) { memory.open.add(id); memory.closed.delete(id); } else { memory.closed.add(id); memory.open.delete(id); }
}

/**
 * Re-apply the memory to freshly swapped rows. Remembered open → open,
 * remembered closed → closed, else the server's default — and a row the
 * server opened (a new running/blocked one) is remembered open from now on,
 * so it isn't collapsed when it finishes.
 */
function applyOpenMemory(rows, memory) {
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var id = rowId(row);
    if (memory.open.has(id)) setRowOpen(row, true);
    else if (memory.closed.has(id)) setRowOpen(row, false);
    else if (row.classList.contains(OPEN_CLASS)) { memory.open.add(id); setRowOpen(row, true); }
    else setRowOpen(row, false);
  }
}

// ── Elapsed clocks ─────────────────────────────────────────────────────────

/** Tick every live clock: stage "running Xm" counters and "started X ago" labels. */
function tickClocks(root) {
  var els = root.querySelectorAll('[data-testid="session-run-elapsed"]');
  for (var i = 0; i < els.length; i++) {
    var start = Date.parse(els[i].getAttribute('data-dispatched-at') || '');
    if (isNaN(start)) continue;
    var text = fmtDuration(Date.now() - start);
    if (text) els[i].textContent = 'in progress · ' + text;
  }
  var running = root.querySelectorAll('[data-running-since]');
  for (var j = 0; j < running.length; j++) {
    var since = Date.parse(running[j].getAttribute('data-running-since') || '');
    var span = isNaN(since) ? null : fmtDuration(Date.now() - since);
    if (span) running[j].textContent = 'running ' + span;
  }
  var agos = root.querySelectorAll('[data-started-at]');
  for (var k = 0; k < agos.length; k++) {
    var at = Date.parse(agos[k].getAttribute('data-started-at') || '');
    var ago = isNaN(at) ? null : fmtDuration(Date.now() - at);
    if (ago) agos[k].textContent = 'started ' + ago + ' ago';
  }
}

// ── Check-ins across repaints ──────────────────────────────────────────────

/** Stage ids whose folded check-ins the reader opened (a repaint closes them). */
function openCheckIns(root) {
  var ids = [];
  var open = root.querySelectorAll('.task-stage details.task-checkins[open]');
  for (var i = 0; i < open.length; i++) {
    var row = open[i].closest('.task-stage');
    if (row) ids.push(rowId(row));
  }
  return ids;
}

function restoreCheckIns(root, ids) {
  if (!ids.length) return;
  var rows = root.querySelectorAll('.task-stage');
  for (var i = 0; i < rows.length; i++) {
    if (ids.indexOf(rowId(rows[i])) === -1) continue;
    var d = rows[i].querySelector('details.task-checkins');
    if (d) d.setAttribute('open', '');
  }
}

// ── Share controls (LIN-3330, owner only) ───────────────────────────────────

/**
 * A share's created time as a tap time (LIN-3975): the words, and the exact local time on a tap. The words are
 * the server's relativeAgo (lib/time-words.js, LIN-4472), so the same moment reads the same on both sides.
 */
function shareTime(doc, value, now) {
  var when = doc.createElement('time');
  when.className = 'task-share-when task-time';
  when.setAttribute('datetime', value);
  when.setAttribute('data-local-time', 'tap');
  when.textContent = relativeAgo(value, now) || '';
  return when;
}

/** The absolute URL a created share's path points at, as shown once. */
function absoluteUrl(path) {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin + path;
  }
  return path;
}

async function copyText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

/**
 * Wire the owner share controls. Guests have no share slot, so this finds
 * nothing there. The server rendered only the mount points and URLs; the list
 * and the one-time URL box are built here.
 */
function initShare(doc) {
  var slot = doc.querySelector('[data-testid="task-page-share-slot"][data-shares-url]');
  if (!slot) return null;
  var createUrl = slot.getAttribute('data-create-url');
  var sharesUrl = slot.getAttribute('data-shares-url');
  // Revoke lives under the same base; drop the `?source=` the base carries.
  var base = (sharesUrl || '').split('?')[0];
  var list = slot.querySelector('[data-testid="task-share-list"]');
  var newBox = slot.querySelector('[data-testid="task-share-new"]');
  var note = slot.querySelector('[data-testid="task-share-note"]');
  var button = slot.querySelector('[data-testid="task-share-create"]');

  function say(message) { if (note) note.textContent = message || ''; }

  function renderList(shares) {
    if (!list) return;
    list.innerHTML = '';
    (shares || []).forEach(function (share) {
      var li = doc.createElement('li');
      li.className = 'task-share-row';
      li.setAttribute('data-testid', 'task-share-row');
      li.setAttribute('data-share-id', share.id);
      li.setAttribute('data-revoked', share.revokedAt ? 'true' : 'false');
      var when = shareTime(doc, share.createdAt);
      li.appendChild(when);
      if (share.revokedAt) li.appendChild(doc.createTextNode(' · revoked'));
      if (window.initLocalTimes) window.initLocalTimes(li);
      if (!share.revokedAt) {
        var revoke = doc.createElement('button');
        revoke.type = 'button';
        revoke.className = 'btn btn--quiet task-share-revoke';
        revoke.setAttribute('data-action', 'task-share-revoke');
        revoke.setAttribute('data-testid', 'task-share-revoke');
        revoke.textContent = 'Revoke';
        revoke.addEventListener('click', function () {
          revoke.disabled = true;
          window.api(base + '/' + encodeURIComponent(share.id) + '/revoke', { method: 'POST', on401: false })
            .then(function () { say('revoked'); return loadList(); },
              function (err) { say('could not revoke: ' + ((err && err.message) || 'error')); revoke.disabled = false; });
        });
        li.appendChild(revoke);
      }
      list.appendChild(li);
    });
  }

  function loadList() {
    return window.api(sharesUrl, { on401: false }).then(function (body) {
      renderList(body && body.shares);
    }, function (err) {
      say('could not load links: ' + ((err && err.message) || 'error'));
    });
  }

  function showNew(path) {
    if (!newBox) return;
    var url = absoluteUrl(path);
    newBox.innerHTML = '';
    newBox.hidden = false;
    var label = doc.createElement('span');
    label.className = 'task-share-new-label';
    label.textContent = 'Link created — copy it now, it is shown once:';
    var input = doc.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.className = 'task-share-url';
    input.setAttribute('data-testid', 'task-share-url');
    input.value = url;
    var copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn--quiet task-share-copy';
    copy.setAttribute('data-testid', 'task-share-copy');
    copy.textContent = 'Copy';
    copy.addEventListener('click', function () {
      copyText(url).then(function (ok) { say(ok ? 'copied' : 'select and copy the link'); });
    });
    newBox.appendChild(label);
    newBox.appendChild(input);
    newBox.appendChild(copy);
  }

  if (button) {
    button.addEventListener('click', function () {
      button.disabled = true;
      say('creating…');
      var body = {};
      var stateUrl = null;
      var main = doc.querySelector('[data-testid="task-page"][data-state-url]');
      if (main) {
        stateUrl = main.getAttribute('data-state-url');
        if (main.getAttribute('data-source')) body.source = main.getAttribute('data-source');
      }
      var m = stateUrl && /[?&]issueId=([^&]+)/.exec(stateUrl);
      if (m) body.issueId = decodeURIComponent(m[1]);
      window.api(createUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), on401: false })
        .then(function (created) { say(''); showNew(created.path); return loadList(); },
          function (err) { say('could not create a link: ' + ((err && err.message) || 'error')); })
        .then(function () { button.disabled = false; });
    });
  }

  loadList();
  return { loadList: loadList, renderList: renderList };
}

// ── Page wiring ────────────────────────────────────────────────────────────

/**
 * Upgrade `[data-md]` bodies (description, comments) to sanitized markdown,
 * from the escaped text the server rendered. Idempotent enough for our use
 * (the block is never repainted, so it runs once). A missing renderMarkdown
 * leaves the escaped text.
 */
function enhanceMarkdown(root) {
  if (!root || typeof window.renderMarkdown !== 'function') return;
  var nodes = root.querySelectorAll('[data-md]');
  for (var i = 0; i < nodes.length; i++) {
    var text = nodes[i].textContent;
    if (text) nodes[i].innerHTML = window.renderMarkdown(text);
  }
}

/**
 * Upgrade the brief's server-rendered `<pre class="sess-ctx-body">` to
 * markdown (a guest, or an owner whose widget libs failed to load). Replaces
 * the `<pre>` with a div, so a second call is a no-op.
 */
function enhanceContextMarkdown(mount) {
  if (!mount || typeof window.renderMarkdown !== 'function') return;
  var pres = mount.querySelectorAll('pre.sess-ctx-body');
  for (var i = 0; i < pres.length; i++) {
    var pre = pres[i];
    if (!pre.parentNode) continue;
    var div = document.createElement('div');
    div.className = 'sess-ctx-body sess-ctx-md';
    div.innerHTML = window.renderMarkdown(pre.textContent);
    pre.parentNode.replaceChild(div, pre);
  }
}

/**
 * Mount the owner's live brief/recap widgets from the owner marker, threading
 * the task's `source` (from `<main data-source>`) so their GET/POST resolve
 * THIS issue's provider (G1). Returns whether anything mounted — the caller
 * then never repaints the context mount.
 */
function mountWidgets(doc, main) {
  var marker = doc.querySelector('[data-testid="task-page-owner-widgets"]');
  if (!marker) return false;
  var source = main.getAttribute('data-source') || undefined;
  var fallbackUrlKey = main.getAttribute('data-url-key') || '';
  var fallbackIdentifier = main.getAttribute('data-identifier') || '';
  var mounted = false;
  function mount(selector, lib) {
    if (!lib || typeof lib.init !== 'function') return;
    var panels = doc.querySelectorAll(selector);
    for (var i = 0; i < panels.length; i++) {
      var el = panels[i];
      lib.init(el, {
        urlKey: (el.dataset && el.dataset.urlKey) || fallbackUrlKey,
        identifier: (el.dataset && el.dataset.identifier) || fallbackIdentifier,
        source: source,
      });
      mounted = true;
    }
  }
  mount('.sess-ctx-panel.brief-section', window.BriefSection);
  mount('.sess-ctx-panel.recap-section', window.RecapSection);
  return mounted;
}

/**
 * Whether a state URL belongs to a guest share page (LIN-3330 review, ledger 2).
 * Only a guest page's state endpoint can 404 because the link was revoked or
 * never issued; an owner page's 404 (e.g. the workspace left the session in
 * another tab) is an ordinary poll failure and must leave the page intact.
 * Pure, so the gate is unit-tested.
 */
function isGuestStateUrl(stateUrl) {
  return typeof stateUrl === 'string' && /^\/t\//.test(stateUrl);
}

/**
 * The one place that decides what a state-poll 404 means (LIN-3447). A guest
 * page (`/t/:token`) whose link was revoked, or never issued, is gone: the
 * handler replaces <main> with the notice. An owner page gets `null`, so its
 * 404 stays an ordinary poll failure (the poller only stops on a 404 when it
 * was handed an `onGone`). `init()` passes the result straight to the poller.
 */
function goneHandlerFor(stateUrl, main) {
  if (!isGuestStateUrl(stateUrl)) return null;
  return function () {
    main.innerHTML = '<p class="task-share-gone" data-testid="task-share-gone">This link is no longer available.</p>';
  };
}

/**
 * Whether an idle or failed poll paints the server-rendered ready header (`<main
 * data-ready-header>`, LIN-3448). The state endpoint is stored-data only, so
 * it can never report "ready"; while the page is merge-ready and the poll
 * finds nothing running, the authoritative answer is the ready sentence, not
 * whatever header happens to be painted. A polled running/waiting overrides.
 * A failed poll (LIN-3991) keeps the ready header too: the poll's status is the
 * gathered state's, and a failed stage reads failed on the load as on the poll
 * (LIN-4071). Pure.
 */
function paintsReadyHeader(mergeReadyAttr, stateStatus) {
  return mergeReadyAttr === 'true' && (stateStatus === 'idle' || stateStatus === 'failed');
}

/**
 * The run control's options, from the owner's `data-run-opts` (LIN-3975). Null when absent or not JSON, so a
 * page that carries no run control mounts none. Pure.
 */
function runOptsOf(root) {
  var raw = root ? root.getAttribute('data-run-opts') : null;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/**
 * The owner's staged-proposals URL (LIN-3975), from the state URL the page polls: the same task and query, on the
 * `proposals` read. Pure.
 */
function proposalsUrlOf(stateUrl) {
  return String(stateUrl || '').replace(/\/state(?=\?|$)/, '/proposals');
}

/**
 * Repaint the answer header from the state endpoint (LIN-3373). That read has
 * no tracker, so it can't verify a summary and its header carries none: the
 * load-time summary paragraph is carried across rather than deleted by the
 * repaint. A header that does carry one replaces it.
 */
function repaintHeader(answer, html) {
  var summaryNode = answer.querySelector('[data-testid="task-page-summary"]');
  answer.innerHTML = html;
  if (summaryNode && !answer.querySelector('[data-testid="task-page-summary"]')) {
    var status = answer.querySelector('[data-testid="task-page-status"]');
    (status || answer).appendChild(summaryNode);
  }
  // LIN-3991: the exact time beside a state sentence is local, so repainted HTML is localised again.
  if (typeof window.initLocalTimes === 'function') window.initLocalTimes(answer);
}

function init(doc) {
  var main = doc.querySelector('[data-testid="task-page"][data-state-url]');
  if (!main) return null;
  initShare(doc);
  // LIN-3975: "Read all of it" opens a cut description. Wired here, before the first Markdown render (LIN-3385),
  // so ticket text can never be the control; a delegated listener, so no re-render needs a new one.
  // Found as the section's own child, so a copy of the control inside the description text is never this one.
  var readAll = doc.querySelector('[data-testid="task-page-description"] > [data-testid="task-page-description-more"]');
  if (readAll) {
    readAll.addEventListener('click', function () {
      var body = readAll.parentNode.querySelector(':scope > .task-md--cut');
      if (body) body.classList.remove('task-md--cut');
      readAll.setAttribute('aria-expanded', 'true');
      readAll.hidden = true;
    });
  }
  // LIN-3975 (finding 1): with neither brief nor recap, the owner's quiet line offers to write each. A press mounts
  // that one widget into the quiet section and starts its generate (the widget's own refresh, one press). The
  // empty-state placeholder widgets are never mounted; the offer is removed once pressed.
  // Both are captured here, before any Markdown renders, and the handler uses the captured references only.
  var writeOffers = doc.querySelector('[data-testid="task-page-context-offers"]');
  var quietContext = doc.querySelector('[data-testid="task-page-context-quiet"]');
  if (writeOffers && quietContext) {
    writeOffers.addEventListener('click', function (e) {
      var button = e.target ? e.target.closest('[data-write-kind]') : null;
      if (!button || !writeOffers.contains(button)) return;
      var kind = button.getAttribute('data-write-kind');
      var widget = kind === 'brief' ? window.BriefSection : window.RecapSection;
      if (!widget || typeof widget.refresh !== 'function') return;
      var offer = button.parentNode;
      if (offer && offer.parentNode) offer.parentNode.removeChild(offer);
      if (!writeOffers.querySelector('[data-write-kind]')) writeOffers.parentNode.removeChild(writeOffers);
      var panel = doc.createElement('div');
      panel.className = 'sess-ctx-panel ' + (kind === 'brief' ? 'brief-section' : 'recap-section');
      panel.setAttribute('data-testid', 'session-' + kind);
      quietContext.appendChild(panel);
      widget.refresh(panel, main.getAttribute('data-url-key') || '', main.getAttribute('data-identifier') || '', main.getAttribute('data-source') || undefined);
    });
  }
  // LIN-3975: the owner's task-chat fold, mounted before the first Markdown render (LIN-3385). It is a direct child of
  // the page (so a copy in ticket text is never it), and the page's own options ride on it.
  var chatFold = doc.querySelector('[data-testid="task-page"] > [data-testid="task-page-chat-fold"]');
  if (chatFold && window.TaskChat && typeof window.TaskChat.init === 'function') {
    var foldOpts = {};
    try { foldOpts = JSON.parse(chatFold.getAttribute('data-task-chat-opts') || '{}'); } catch (e) { foldOpts = {}; }
    // The hook is read by TaskChat at init; refreshProposals is hoisted, and reads the run control only when a turn proposes.
    foldOpts.onProposed = refreshProposals;
    window.TaskChat.init(chatFold, foldOpts);
  }
  // The status mount is what the poll repaints; the stage track beside it (`task-page-track-mount`) is the page-load read's (LIN-3975).
  var answer = doc.querySelector('[data-testid="task-page-answer-status"]');
  var trackMount = doc.querySelector('[data-testid="task-page-track-mount"]');
  var contextMount = doc.querySelector('[data-testid="task-page-context-mount"]');
  var rows = function () { return trackMount ? trackMount.querySelectorAll('.task-step') : []; };
  var memory = createOpenMemory(rows());
  // LIN-4405: "Sessions on one clock", a direct child of the page (so a copy in ticket text is never it), captured here
  // before any Markdown renders.
  var timelineSection = doc.querySelector('[data-testid="task-page"] > [data-testid="task-timeline"][data-timeline-url]');
  var timelineMount = timelineSection ? timelineSection.querySelector(':scope > [data-testid="task-timeline-mount"]') : null;

  // LIN-3385: wire every Harbour control BEFORE the first markdown render
  // (`enhanceContextMarkdown` below is the first). Ticket-derived markdown
  // keeps `data-*`/`id`/`class`, so a control looked up after it lands could
  // resolve to look-alike ticket text. The close-out box is captured here and
  // its press button is bound directly (close-out.js is idempotent per box).
  // LIN-3499: the owner's question card (the shared public/question-cards.js)
  // is captured here too. It sits outside `task-page-answer`, so no poll
  // repaints it.
  if (window.QuestionCards && typeof window.QuestionCards.initQuestionCards === 'function') window.QuestionCards.initQuestionCards();
  var questionCard = doc.querySelector('[data-testid="task-page-question"]');
  var isOwnerPage = !!doc.querySelector('[data-testid="task-page-owner-widgets"]');
  var closeOutBox = window.CloseOut && typeof window.CloseOut.init === 'function' ? window.CloseOut.init(doc) : null;
  // LIN-3975: the owner's run control (the shared PromptSection, surface `task`) is wired here too, before the
  // first Markdown render below, so a look-alike control in ticket text cannot be the one found. A guest or a
  // member has no run-control root, so nothing mounts.
  var runRoot = doc.querySelector('[data-testid="task-page-run-control"]');
  var runOpts = runOptsOf(runRoot);
  var runControl = null;
  if (runRoot && runOpts && window.PromptSection && typeof window.PromptSection.init === 'function') {
    runControl = window.PromptSection.init(runRoot, runOpts);
  }

  // LIN-3975 (finding 1): a fold turn that proposes a follow-up stages it in the run control at once. The owner's
  // staged list is re-read (owner-only) and handed to the run control's own repaint; nothing is re-rendered here.
  // Reached only from the fold's `proposed` frame, so it is never called on a page with no chat.
  function refreshProposals() {
    if (!runControl || typeof runControl.setProposals !== 'function') return;
    window.api(proposalsUrlOf(main.getAttribute('data-state-url') || ''), { on401: '/logout' })
      .then(function (body) { runControl.setProposals((body && body.proposals) || []); })
      .catch(function (err) {
        if (typeof window.toast === 'function') window.toast('Could not load the staged proposal: ' + ((err && err.message) || 'failed'), { type: 'error' });
      });
  }

  // Owner's live widgets (if the libs loaded). Once mounted, the context
  // mount is never repainted; the widgets own their refresh.
  var widgetsMounted = mountWidgets(doc, main);
  if (!widgetsMounted && contextMount) enhanceContextMarkdown(contextMount);
  enhanceMarkdown(doc);

  function toggle(row) {
    var open = !row.classList.contains(OPEN_CLASS);
    setRowOpen(row, open);
    rememberToggle(memory, row, open);
  }

  if (trackMount) {
    // The stage head is a real button, so Enter/Space arrive as a click too.
    // Links and the check-ins disclosure inside an opened stage are theirs.
    trackMount.addEventListener('click', function (e) {
      var head = e.target.closest('.task-stage-head');
      var row = head && head.closest('.task-step');
      if (!row) return;
      toggle(row);
    });
  }

  // The close-out box lives outside every repainted mount, so only the
  // merge-ready attribute needs to track it: a check (or a poll) that moves
  // the box off `ready` clears the flag, and the ready header is no longer
  // painted.
  function syncMergeReady() {
    var box = closeOutBox;
    if (box && box.getAttribute('data-state') !== 'ready') main.setAttribute('data-merge-ready', 'false');
  }

  // The last polled status, seeded from the load. A running -> idle edge is a
  // session end: one close-out check then (never per poll), so a close-out
  // that merged and set Done reloads the page via `doneNow` without waiting
  // for a tab focus. `runCheck` owns the eligibility gate.
  var lastPolled = main.getAttribute('data-status') || 'idle';

  // LIN-3499 / LIN-4038: the question card shows exactly while the server says
  // the owner is being asked, which is `state.questionHtml` (non-empty) — not
  // the pill's status, which a shelved or bare-blocked wait also carries. A poll
  // that says no question (answered, shelved, or the run moved on) removes the
  // card. A poll that says a question while the card is missing reloads the page
  // once, since the card is server-rendered for the owner and the poll does not
  // paint it. Both are captured at init, before any markdown renders (LIN-3385).
  // The owner-widgets marker is the owner signal — no second owner check.
  function syncQuestion(state) {
    var asked = typeof state.questionHtml === 'string' && state.questionHtml !== '';
    if (questionCard && !asked) {
      if (questionCard.parentNode) questionCard.parentNode.removeChild(questionCard);
      questionCard = null;
    } else if (!questionCard && asked && isOwnerPage) {
      var win = doc.defaultView;
      if (win && win.location && typeof win.location.reload === 'function') win.location.reload();
    }
  }

  // The track is history (the task's own whole-life read), so it repaints whether or not the state is complete.
  function repaintTrack(state) {
    if (trackMount && typeof state.trackHtml === 'string') {
      var checkIns = openCheckIns(trackMount);
      trackMount.innerHTML = state.trackHtml;
      // A repainted track carries its own tap times (LIN-3975): bind them as the page does on load.
      if (typeof window.initLocalTimes === 'function') window.initLocalTimes(trackMount);
      restoreCheckIns(trackMount, checkIns);
    }
  }

  // LIN-4405: the timeline section repaints from its own fragment (built by the server, positions included). An
  // opened lane stays open across a repaint, keyed by its `data-lane-id`. The section was captured before any
  // Markdown rendered (LIN-3385).
  var timeline = null;
  if (timelineSection && timelineMount) {
    timeline = createTimelineRefresher({
      url: timelineSection.getAttribute('data-timeline-url'),
      fetchJson: function (url) { return window.api(url, { on401: false }); },
      isRunning: function () { return !!timelineMount.querySelector('[data-testid="task-timeline-lane"][data-state="running"]'); },
      apply: function (html) {
        var opened = [];
        var lanes = timelineMount.querySelectorAll('[data-testid="task-timeline-lane"]');
        for (var i = 0; i < lanes.length; i++) {
          var details = lanes[i].querySelector('details');
          if (details && details.open) opened.push(lanes[i].getAttribute('data-lane-id'));
        }
        timelineMount.innerHTML = html;
        if (typeof window.initLocalTimes === 'function') window.initLocalTimes(timelineMount);
        var fresh = timelineMount.querySelectorAll('[data-testid="task-timeline-lane"]');
        for (var j = 0; j < fresh.length; j++) {
          if (opened.indexOf(fresh[j].getAttribute('data-lane-id')) === -1) continue;
          var open = fresh[j].querySelector('details');
          if (open) open.open = true;
        }
      }
    });
  }

  function apply(state) {
    // LIN-4405: a changed track (a session started, ended or moved on) asks for the timeline; the refresher coalesces.
    if (timeline) {
      // The first done reads the last change once, past the window, then stops (`finish`).
      if (state.status === 'done') timeline.finish();
      else timeline.noteTrack(state.trackHtml);
    }
    // LIN-4070: an incomplete read carries no state (the server is still gathering it). The page keeps what it painted,
    // the poll goes on, and the next complete reply replaces it.
    if (state.incomplete) {
      repaintTrack(state);
      return;
    }
    // Read the box first: a check may have moved it off `ready` since the
    // last poll, and then the ready header must not be painted.
    syncMergeReady();
    var readyHtml = paintsReadyHeader(main.getAttribute('data-merge-ready'), state.status) ? main.getAttribute('data-ready-header') : null;
    var headerHtml = typeof readyHtml === 'string' && readyHtml ? readyHtml : state.headerHtml;
    if (answer && typeof headerHtml === 'string') repaintHeader(answer, headerHtml);
    var painted = answer ? answer.querySelector('[data-testid="task-page-status"]') : null;
    var paintedStatus = painted ? painted.getAttribute('data-status') : null;
    repaintTrack(state);
    applyOpenMemory(rows(), memory);
    main.setAttribute('data-status', readyHtml ? (paintedStatus || 'waiting') : state.status);
    main.setAttribute('data-live', state.live ? 'true' : 'false');
    syncQuestion(state);
    tickClocks(main);
    // A run that ends failed still re-checks the close-out box (LIN-3991: failed is an idle-like end).
    if (lastPolled === 'running' && (state.status === 'idle' || state.status === 'failed') && closeOutBox && window.CloseOut && typeof window.CloseOut.runCheck === 'function') {
      // The check may move the box off `ready` without Done (so no reload):
      // then the ready header just painted is stale, and the polled one is
      // repainted unless a newer poll has already applied.
      var polled = state;
      Promise.resolve(window.CloseOut.runCheck(closeOutBox, doc)).then(function () {
        if (lastPolled !== polled.status) return;
        syncMergeReady();
        if (main.getAttribute('data-merge-ready') !== 'true' && answer && typeof polled.headerHtml === 'string') {
          repaintHeader(answer, polled.headerHtml);
          main.setAttribute('data-status', polled.status);
        }
      });
    }
    lastPolled = state.status;
  }

  var initial = { status: main.getAttribute('data-status') || 'idle', live: main.getAttribute('data-live') === 'true' };
  // LIN-4071: an unsettled page (provisional first render) reads again soon; its painted status is never `done` (the
  // server sends the gathered word only), so only a complete `done` stops the poll.
  var unsettled = main.getAttribute('data-settled') === 'false';
  var poller = null;
  if (initial.status !== 'done') {
    poller = createPoller({
      stateUrl: main.getAttribute('data-state-url'),
      fetchJson: function (url) { return window.api(url, { on401: '/logout' }); },
      apply: apply,
      isVisible: function () { return !doc.hidden; },
      initial: initial,
      unsettled: unsettled,
      onGone: goneHandlerFor(main.getAttribute('data-state-url'), main)
    });
    poller.start();
    if (timeline) timeline.start();
    doc.addEventListener('visibilitychange', function () {
      poller.onVisibilityChange(doc.hidden);
      // LIN-4405: the timeline timer stops with the poll: paused while the tab is hidden, and for good once the poll
      // has stopped (a 401 or a revoked link).
      if (!timeline) return;
      if (poller.isStopped()) timeline.stop();
      else if (doc.hidden) timeline.pause();
      else timeline.resume();
    });
  } else if (timeline) {
    // A page that loaded done never polls, so its timeline is never re-read.
    timeline.stop();
  }

  tickClocks(main);
  setInterval(function () { tickClocks(main); }, TICK_MS);
  return { poller: poller, memory: memory, apply: apply, timeline: timeline };
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', function () { init(document); });
}

// Named exports: the pure poll rule, the poll loop, the open-row memory and the render helpers the suites test. The page
// itself starts from the DOMContentLoaded listener above; the module writes no global (it reads some, behind guards) (LIN-4472).
export {
  pollDelay,
  cadenceStatus,
  createPoller,
  createTimelineRefresher,
  TIMELINE_WINDOW_MS,
  createOpenMemory,
  rememberToggle,
  applyOpenMemory,
  tickClocks,
  openCheckIns,
  restoreCheckIns,
  shareTime,
  repaintHeader,
  isGuestStateUrl,
  goneHandlerFor,
  paintsReadyHeader,
  runOptsOf,
  proposalsUrlOf,
  enhanceMarkdown,
  enhanceContextMarkdown,
  mountWidgets,
  FAST_MS,
  SLOW_MS,
  MAX_BACKOFF_MS
};
