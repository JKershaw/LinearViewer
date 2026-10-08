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
 * The poll only ever requests the state URL. The one other request this page
 * makes is "ask for an update" (owner only), which POSTs the existing
 * session-only `/api/brief|recap/:issueId` and then polls once.
 *
 * A repaint never collapses a row the reader opened: an open-set keyed by
 * `data-loop-id` is seeded from the rows rendered open and re-applied after
 * every swap. A row the reader closed stays closed; a new running row opens
 * itself. The run page's script (public/session.js) is not loaded here, so the
 * row toggle is this file's own, delegated from the track mount.
 */
(function () {
  'use strict';

  var FAST_MS = 10000;
  var SLOW_MS = 45000;
  var MAX_BACKOFF_MS = 5 * 60 * 1000;
  var TICK_MS = 1000;
  var OPEN_CLASS = 'sess-run--expanded';

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
   * The poll loop. Every request it makes is `fetchJson(stateUrl)`.
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

    function schedule() {
      clearTimer(timer);
      timer = null;
      if (stopped) return;
      var delay = pollDelay(cadenceStatus(current), o.isVisible(), failures);
      if (delay == null) return;
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
            // The state endpoint never reports `done` (it can't see the
            // tracker); keep what the page loaded with otherwise.
            current = { status: state.status, live: !!state.live };
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
      state: function () { return { current: current, failures: failures, timer: timer, inFlight: inFlight }; }
    };
  }

  // ── Open rows across repaints ──────────────────────────────────────────────

  function rowId(row) { return row.getAttribute('data-loop-id') || ''; }

  function setRowOpen(row, open) {
    if (open) row.classList.add(OPEN_CLASS); else row.classList.remove(OPEN_CLASS);
    var head = row.querySelector('.sess-run-head');
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

  function formatElapsed(ms) {
    if (!(ms >= 0)) return null;
    var totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return totalSec + 's';
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    if (m < 60) return s ? m + 'm ' + s + 's' : m + 'm';
    var h = Math.floor(m / 60);
    var rm = m % 60;
    return rm ? h + 'h ' + rm + 'm' : h + 'h';
  }

  function tickClocks(root) {
    var els = root.querySelectorAll('[data-testid="session-run-elapsed"]');
    for (var i = 0; i < els.length; i++) {
      var start = Date.parse(els[i].getAttribute('data-dispatched-at') || '');
      if (isNaN(start)) continue;
      var text = formatElapsed(Date.now() - start);
      if (text) els[i].textContent = 'in progress · ' + text;
    }
  }

  // ── Share controls (LIN-3330, owner only) ───────────────────────────────────

  /** A share's stored timestamps as a short label. */
  function shareWhen(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
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
        var when = doc.createElement('span');
        when.className = 'task-share-when';
        when.textContent = shareWhen(share.createdAt) + (share.revokedAt ? ' · revoked' : '');
        li.appendChild(when);
        if (!share.revokedAt) {
          var revoke = doc.createElement('button');
          revoke.type = 'button';
          revoke.className = 'task-share-revoke';
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
      copy.className = 'task-share-copy';
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
   * Whether a state URL belongs to a guest share page (LIN-3330 review, ledger 2).
   * Only a guest page's state endpoint can 404 because the link was revoked or
   * never issued; an owner page's 404 (e.g. the workspace left the session in
   * another tab) is an ordinary poll failure and must leave the page intact.
   * Pure, so the gate is unit-tested.
   */
  function isGuestStateUrl(stateUrl) {
    return typeof stateUrl === 'string' && /^\/t\//.test(stateUrl);
  }

  function init(doc) {
    var main = doc.querySelector('[data-testid="task-page"][data-state-url]');
    if (!main) return null;
    initShare(doc);
    var answer = doc.querySelector('[data-testid="task-page-answer"]');
    var trackMount = doc.querySelector('[data-testid="task-page-track-mount"]');
    var contextMount = doc.querySelector('[data-testid="task-page-context-mount"]');
    var rows = function () { return trackMount ? trackMount.querySelectorAll('.task-step') : []; };
    var memory = createOpenMemory(rows());

    function toggle(row) {
      var open = !row.classList.contains(OPEN_CLASS);
      setRowOpen(row, open);
      rememberToggle(memory, row, open);
    }

    if (trackMount) {
      trackMount.addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('.task-step') : null;
        if (!row || e.target.closest('a[href], button')) return;
        toggle(row);
      });
      trackMount.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var head = e.target.closest ? e.target.closest('.sess-run-head') : null;
        var row = head && head.closest('.task-step');
        if (!row) return;
        e.preventDefault();
        toggle(row);
      });
    }

    function apply(state) {
      // The evidence needs the tracker, which the state endpoint never reads:
      // carry the page's evidence into whichever row hosts the slot now.
      var oldSlot = trackMount && trackMount.querySelector('[data-evidence-slot]');
      var evidence = oldSlot ? Array.prototype.slice.call(oldSlot.childNodes) : [];
      if (answer && typeof state.headerHtml === 'string') answer.innerHTML = state.headerHtml;
      if (trackMount && typeof state.trackHtml === 'string') trackMount.innerHTML = state.trackHtml;
      if (contextMount && typeof state.contextHtml === 'string') contextMount.innerHTML = state.contextHtml;
      var newSlot = trackMount && trackMount.querySelector('[data-evidence-slot]');
      if (newSlot && !newSlot.childNodes.length) {
        for (var i = 0; i < evidence.length; i++) newSlot.appendChild(evidence[i]);
      }
      applyOpenMemory(rows(), memory);
      main.setAttribute('data-status', state.status);
      main.setAttribute('data-live', state.live ? 'true' : 'false');
      tickClocks(main);
    }

    var initial = { status: main.getAttribute('data-status') || 'idle', live: main.getAttribute('data-live') === 'true' };
    var poller = null;
    if (initial.status !== 'done') {
      poller = createPoller({
        stateUrl: main.getAttribute('data-state-url'),
        fetchJson: function (url) { return window.api(url, { on401: '/logout' }); },
        apply: apply,
        isVisible: function () { return !doc.hidden; },
        initial: initial,
        onGone: isGuestStateUrl(main.getAttribute('data-state-url')) ? function () {
          // A guest link that 404s (revoked, or never issued): the page is gone.
          main.innerHTML = '<p class="task-share-gone" data-testid="task-share-gone">This link is no longer available.</p>';
        } : null
      });
      poller.start();
      doc.addEventListener('visibilitychange', function () { poller.onVisibilityChange(doc.hidden); });
    }

    // "Ask for an update" (owner only): the existing session-only POST, then
    // one poll so the new brief/recap shows. Opening the page never asks.
    doc.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-action="task-ask-update"]') : null;
      if (!btn) return;
      e.preventDefault();
      var note = doc.querySelector('[data-testid="task-page-ask-note"]');
      var kind = btn.getAttribute('data-kind') || 'brief';
      btn.disabled = true;
      if (note) note.textContent = 'asking for an updated ' + kind + '…';
      window.api(btn.getAttribute('data-url'), { method: 'POST', on401: false })
        .then(function () {
          if (note) note.textContent = 'updated ' + kind;
          if (poller) return poller.poll();
          return window.api(main.getAttribute('data-state-url'), { on401: '/logout' }).then(apply);
        }, function (err) {
          if (note) note.textContent = 'could not update the ' + kind + ': ' + ((err && err.message) || 'error');
        })
        .then(function () { btn.disabled = false; });
    });

    tickClocks(main);
    setInterval(function () { tickClocks(main); }, TICK_MS);
    return { poller: poller, memory: memory, apply: apply };
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () { init(document); });
  }

  // Test seam (session.js's own pattern): the pure poll rule, the poll loop and
  // the open-row memory are unit-tested without a browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pollDelay: pollDelay,
      cadenceStatus: cadenceStatus,
      createPoller: createPoller,
      createOpenMemory: createOpenMemory,
      rememberToggle: rememberToggle,
      applyOpenMemory: applyOpenMemory,
      formatElapsed: formatElapsed,
      isGuestStateUrl: isGuestStateUrl,
      FAST_MS: FAST_MS,
      SLOW_MS: SLOW_MS,
      MAX_BACKOFF_MS: MAX_BACKOFF_MS
    };
  }
})();
