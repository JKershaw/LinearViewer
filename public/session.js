/**
 * Session Page Client (LIN-1004 / LIN-1133).
 *
 * The session page is a JS-enhanced snapshot (LIN-1003 original, LIN-1133
 * extended). This is its scoped client script handling:
 *   1. Per-run expand/collapse toggle on run cards.
 *   2. Per-run transcript client-side markdown rendering from embedded
 *      `data-feedback` JSON (replaces server-rendered escaped-text fallback).
 *   3. Per-run inline reply boxes — each scoped to `loop.loopId` as
 *      `followUpTo` so replies resume that specific run.
 *   4. BriefSection / RecapSection widget initialisation for context panels.
 *   5. Global bottom-of-page reply box (kept as fallback, LIN-1004).
 *
 * Loaded AFTER marked.min.js, purify.min.js, common.js, brief.js, recap.js.
 */
(function () {
  'use strict';

  // ── Expand / collapse toggle ──────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-session-run-toggle]');
    if (!toggle) return;
    var runCard = toggle.closest('.sess-run--expandable');
    if (!runCard) return;
    var isExpanded = runCard.classList.contains('sess-run--expanded');
    if (isExpanded) {
      runCard.classList.remove('sess-run--expanded');
      toggle.setAttribute('aria-expanded', 'false');
    } else {
      runCard.classList.add('sess-run--expanded');
      toggle.setAttribute('aria-expanded', 'true');
    }
  });

  // ── Per-run transcript rendering ──────────────────────────────────────────
  // Each `.sess-run-tx` carries `data-feedback` (JSON-encoded feedback[]).
  // Replace the server-rendered `.sess-run-tx-fallback` escaped-text list with
  // client-side markdown-rendered entries.

  var txContainers = document.querySelectorAll('[data-session-run-tx]');
  txContainers.forEach(function (container) {
    var raw = container.getAttribute('data-feedback');
    if (!raw) return;

    var entries;
    try {
      entries = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!entries || !entries.length) return;

    var fallback = container.querySelector('.sess-run-tx-fallback');
    if (fallback) fallback.remove();

    var fragments = entries.map(function (entry) {
      var timeHtml = entry.timestamp
        ? '<span class="sess-tx-time" data-testid="session-transcript-time">' + window.escapeHtml(String(entry.timestamp)) + '</span>'
        : '';
      var msgHtml = '<span class="sess-tx-msg">' + window.renderMarkdown(entry.message || '', { breaks: true }) + '</span>';
      var linkHtml = entry.url
        ? ' <a class="sess-tx-link" data-testid="session-transcript-link" href="' + window.escapeHtml(entry.url) + '" target="_blank" rel="noopener noreferrer">' + window.escapeHtml(entry.urlLabel || entry.url) + '</a>'
        : '';
      return '<li class="sess-run-tx-entry sess-tx-entry" data-testid="session-transcript-entry">' +
        timeHtml +
        msgHtml +
        linkHtml +
        '</li>';
    });

    var list = document.createElement('ul');
    list.className = 'sess-tx-list';
    list.innerHTML = fragments.join('');
    container.appendChild(list);
  });

  // ── Per-run inline reply boxes ────────────────────────────────────────────
  // Each `.sess-inline-reply` carries `data-loop-id`, `data-target`, and
  // `data-terminal`. followUpTo = loop.loopId (per-run scoping), unlike the
  // global reply which maps to session.sessionId.

  var inlineReplyBoxes = document.querySelectorAll('[data-session-inline-reply]');
  inlineReplyBoxes.forEach(function (box) {
    var textarea = box.querySelector('.sess-inline-reply-input');
    var btn = box.querySelector('.sess-reply-send');
    var feedback = box.querySelector('.sess-inline-reply-feedback');
    if (!textarea || !btn) return;

    var urlKey = box.dataset.urlKey;
    var loopId = box.dataset.loopId;
    var target = box.dataset.target === 'web' ? 'web' : 'cli';
    var terminal = box.dataset.terminal === 'true';
    var original = btn.textContent;

    function setFeedback(msg, isError) {
      if (!feedback) return;
      feedback.textContent = msg;
      feedback.className = 'sess-inline-reply-feedback' + (isError ? ' error' : '');
    }

    function send() {
      var prompt = (textarea.value || '').trim();
      if (!prompt) {
        setFeedback('enter a reply', true);
        return;
      }
      btn.disabled = true;
      btn.textContent = 'sending…';
      setFeedback('', false);

      var body = { prompt: prompt, followUpTo: loopId, target: target };
      if (terminal) body.force = true;

      fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      })
        .then(function (resp) {
          if (resp.ok) return resp.json().catch(function () { return {}; });
          return resp.json().catch(function () { return {}; }).then(function (data) {
            throw new Error((data && data.error) || ('HTTP ' + resp.status));
          });
        })
        .then(function () {
          textarea.value = '';
          setFeedback(
            terminal
              ? 'reply queued — if the session has ended you\'ll see "no live session to resume" in the transcript on reload'
              : 'reply queued — reload to see the session continue',
            false
          );
          btn.textContent = 'queued ✓';
        })
        .catch(function (e) {
          setFeedback('reply failed: ' + e.message, true);
          btn.textContent = 'failed';
        })
        .then(function () {
          setTimeout(function () {
            if (btn.isConnected) {
              btn.textContent = original;
              btn.disabled = false;
            }
          }, 1800);
        });
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      send();
    });

    textarea.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
  });

  // ── Global reply box (fallback, LIN-1004) ─────────────────────────────────

  (function () {
    var box = document.querySelector('[data-session-reply]');
    if (!box) return;

    var textarea = box.querySelector('.sess-reply-input');
    var btn = box.querySelector('.sess-reply-send');
    var feedback = box.querySelector('.sess-reply-feedback');
    if (!textarea || !btn) return;

    var urlKey = box.dataset.urlKey;
    var sessionId = box.dataset.sessionId;
    var target = box.dataset.target === 'web' ? 'web' : 'cli';
    var terminal = box.dataset.sessionTerminal === 'true';
    var original = btn.textContent;

    function setFeedback(msg, isError) {
      if (!feedback) return;
      feedback.textContent = msg;
      feedback.className = 'sess-reply-feedback' + (isError ? ' error' : '');
    }

    function send() {
      var prompt = (textarea.value || '').trim();
      if (!prompt) {
        setFeedback('enter a reply', true);
        return;
      }
      btn.disabled = true;
      btn.textContent = 'sending…';
      setFeedback('', false);

      var body = { prompt: prompt, followUpTo: sessionId, target: target };
      if (terminal) body.force = true;

      fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      })
        .then(function (resp) {
          if (resp.ok) return resp.json().catch(function () { return {}; });
          return resp.json().catch(function () { return {}; }).then(function (data) {
            throw new Error((data && data.error) || ('HTTP ' + resp.status));
          });
        })
        .then(function () {
          textarea.value = '';
          setFeedback(
            terminal
              ? 'reply queued — if the session has ended you\'ll see "no live session to resume" in the transcript on reload'
              : 'reply queued — reload to see the session continue',
            false
          );
          btn.textContent = 'queued ✓';
        })
        .catch(function (e) {
          setFeedback('reply failed: ' + e.message, true);
          btn.textContent = 'failed';
        })
        .then(function () {
          setTimeout(function () {
            if (btn.isConnected) {
              btn.textContent = original;
              btn.disabled = false;
            }
          }, 1800);
        });
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      send();
    });

    textarea.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
  })();

  // ── Brief / Recap widget initialisation (LIN-1133) ────────────────────────

  var briefContainers = document.querySelectorAll('[data-session-brief]');
  briefContainers.forEach(function (container) {
    var urlKey = container.getAttribute('data-url-key');
    var identifier = container.getAttribute('data-identifier');
    if (!urlKey || !identifier) return;
    if (typeof window.BriefSection === 'undefined') return;
    window.BriefSection.init(container, { urlKey: urlKey, identifier: identifier });
  });

  var recapContainers = document.querySelectorAll('[data-session-recap]');
  recapContainers.forEach(function (container) {
    var urlKey = container.getAttribute('data-url-key');
    var identifier = container.getAttribute('data-identifier');
    if (!urlKey || !identifier) return;
    if (typeof window.RecapSection === 'undefined') return;
    window.RecapSection.init(container, { urlKey: urlKey, identifier: identifier });
  });

})();
