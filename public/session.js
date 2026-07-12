/**
 * Session Page Client (LIN-1004/LIN-1133).
 *
 * JS-enhanced session page: per-run expandable transcripts with client-side
 * markdown rendering, per-run inline reply boxes scoped to each run's loopId,
 * BriefSection/RecapSection widget init on context panels, and the preserved
 * global reply box fallback.
 *
 * Loaded AFTER common.js, marked.min.js, purify.min.js, brief.js, recap.js —
 * window.renderMarkdown, window.BriefSection, window.RecapSection ARE available.
 * Inline replies use the same raw-fetch dispatch as the global reply box
 * (window.dispatchPrompt does not support followUpTo).
 */
(function () {
  'use strict';

  // ── Conversational "you" echo (LIN-1298) ─────────────────────────────────
  // Mirror the Task Chat idiom (public/task-chat.js appendBubble): compose the
  // shared renderStatusPill + renderSurface primitives into a "you" turn so the
  // reply reads as a chat message, not a vanished textarea. UI-only — the real
  // agent continuation still arrives on reload (the note says so).
  function appendYouBubble(thread, text) {
    if (!thread || typeof window.renderStatusPill !== 'function' || typeof window.renderSurface !== 'function') return;
    var whoPill = window.renderStatusPill({ label: 'you', variant: 'tag', className: 'chat-msg__who' });
    var bodySurface = window.renderSurface({
      body: '<span class="chat-msg__text">' + window.escapeHtml(text) + '</span>',
      className: 'chat-msg__body'
    });
    var li = document.createElement('li');
    li.className = 'chat-msg chat-msg--you';
    li.setAttribute('data-testid', 'session-reply-you');
    li.innerHTML = whoPill + bodySurface;
    thread.appendChild(li);
    thread.hidden = false;
    thread.scrollTop = thread.scrollHeight;
  }

  // ── Shared reply helper (raw fetch, same pattern as the original global box) ──
  function sendReply(opts, btn, textarea, feedback, thread) {
    var prompt = (textarea.value || '').trim();
    if (!prompt) {
      feedback.textContent = 'enter a reply';
      feedback.className = 'sess-reply-feedback error';
      return;
    }
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'sending…';
    feedback.textContent = '';
    feedback.className = 'sess-reply-feedback';

    var body = { prompt: prompt, followUpTo: opts.followUpTo, target: opts.target };
    if (opts.force) body.force = true;

    fetch('/workspace/' + encodeURIComponent(opts.urlKey) + '/api/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    })
      .then(function (resp) {
        if (resp.ok) return resp.json().catch(function () { return {}; });
        return resp.json().catch(function () { return {}; }).then(function (d) {
          throw new Error((d && d.error) || ('HTTP ' + resp.status));
        });
      })
      .then(function () {
        appendYouBubble(thread, prompt);
        textarea.value = '';
        feedback.textContent = opts.force
          ? 'reply queued — if the session has ended you\'ll see "no live session to resume" in the transcript on reload'
          : 'reply queued — reload to see the session continue';
        feedback.className = 'sess-reply-feedback';
        btn.textContent = 'queued \u2713';
      })
      .catch(function (e) {
        feedback.textContent = 'reply failed: ' + e.message;
        feedback.className = 'sess-reply-feedback error';
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

  // ── Per-run expand/collapse toggle (LIN-1133) ──────────────────────────────
  function initRunToggles() {
    var toggles = document.querySelectorAll('[data-testid="session-run-toggle"]');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].addEventListener('click', function () {
        var run = this.closest('.sess-run');
        if (!run) return;
        var expanded = run.classList.toggle('sess-run--expanded');
        this.setAttribute('aria-expanded', String(expanded));
      });
      toggles[i].addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.click();
        }
      });
    }
  }

  // ── Per-run transcript markdown rendering (LIN-1133) ───────────────────────
  function renderRunTranscripts() {
    var containers = document.querySelectorAll('[data-testid="session-run-transcript"]');
    for (var i = 0; i < containers.length; i++) {
      var container = containers[i];
      var data = container.dataset.feedback;
      if (!data) continue;
      var entries;
      try { entries = JSON.parse(data); } catch (e) { continue; }
      if (!entries || !entries.length) continue;

      var list = container.querySelector('.sess-run-tx-list');
      if (!list) continue;

      var html = '';
      for (var j = 0; j < entries.length; j++) {
        var entry = entries[j];
        var messageHtml = typeof window.renderMarkdown === 'function'
          ? window.renderMarkdown(entry.message || '', { breaks: true })
          : window.escapeHtml(entry.message || '');
        var time = entry.timestamp
          ? '<span class="sess-tx-time" data-testid="session-transcript-time">' + window.escapeHtml(String(entry.timestamp)) + '</span>'
          : '';
        var link = entry.url
          ? ' <a class="sess-tx-link" data-testid="session-transcript-link" href="' + window.escapeHtml(entry.url) + '" target="_blank" rel="noopener noreferrer">' + window.escapeHtml(entry.urlLabel || entry.url) + '</a>'
          : '';
        html += '<li class="sess-run-tx-entry" data-testid="session-transcript-entry">' +
          time +
          '<span class="sess-tx-msg markdown-content">' + messageHtml + '</span>' +
          link +
          '</li>';
      }
      list.innerHTML = html;
    }
  }

  // ── Per-run inline reply boxes (LIN-1133; LIN-1298 echo thread) ───────────
  function initInlineReplies() {
    var boxes = document.querySelectorAll('[data-testid="session-inline-reply"]');
    for (var i = 0; i < boxes.length; i++) {
      // Per-box closure so each handler binds its OWN elements (no fragile
      // parentNode walking) and its own echo thread (LIN-1298).
      (function (box) {
        var textarea = box.querySelector('.sess-inline-reply-input');
        var btn = box.querySelector('.sess-reply-send');
        var feedback = box.querySelector('.sess-reply-feedback');
        var thread = box.querySelector('[data-testid="session-inline-reply-thread"]');
        if (!textarea || !btn) return;

        var opts = {
          urlKey: box.dataset.urlKey,
          followUpTo: box.dataset.loopId,
          target: box.dataset.target === 'web' ? 'web' : 'cli',
          // Force when this run is terminal OR the session is paused-on-human/waiting
          // (LIN-1252). `data-terminal` is the run's own status; `data-session-waiting`
          // is the session-level waiting signal (keyed session-wide, not per-run).
          force: box.dataset.terminal === 'true' || box.dataset.sessionWaiting === 'true'
        };

        btn.addEventListener('click', function (e) {
          e.preventDefault();
          sendReply(opts, btn, textarea, feedback, thread);
        });
        textarea.addEventListener('keydown', function (e) {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            sendReply(opts, btn, textarea, feedback, thread);
          }
        });
      })(boxes[i]);
    }
  }

  // ── BriefSection / RecapSection widget init (LIN-1133) ────────────────────
  function initContextWidgets() {
    var briefs = document.querySelectorAll('.sess-ctx-panel.brief-section');
    var recaps = document.querySelectorAll('.sess-ctx-panel.recap-section');
    if (typeof window.BriefSection === 'object' && typeof window.BriefSection.init === 'function') {
      for (var i = 0; i < briefs.length; i++) {
        var el = briefs[i];
        var opts = { urlKey: el.dataset.urlKey, identifier: el.dataset.identifier };
        if (opts.urlKey && opts.identifier) {
          window.BriefSection.init(el, opts);
        }
      }
    }
    if (typeof window.RecapSection === 'object' && typeof window.RecapSection.init === 'function') {
      for (var i = 0; i < recaps.length; i++) {
        var el2 = recaps[i];
        var opts2 = { urlKey: el2.dataset.urlKey, identifier: el2.dataset.identifier };
        if (opts2.urlKey && opts2.identifier) {
          window.RecapSection.init(el2, opts2);
        }
      }
    }
  }

  // ── Global reply box (preserved from LIN-1004) ────────────────────────────
  function initGlobalReply() {
    var box = document.querySelector('[data-testid="session-reply"]');
    if (!box) return;

    var textarea = box.querySelector('.sess-reply-input');
    var btn = box.querySelector('.sess-reply-send');
    var feedback = box.querySelector('.sess-reply-feedback');
    var thread = box.querySelector('[data-testid="session-reply-thread"]');
    if (!textarea || !btn) return;

    var urlKey = box.dataset.urlKey;
    var sessionId = box.dataset.sessionId;
    var target = box.dataset.target === 'web' ? 'web' : 'cli';
    // Force a resume for a finalized session OR a paused-on-human/waiting one
    // (LIN-1252): both are "not a live writer", so kill-first is safe and needed
    // for the reply to land. A genuinely warm/EXECUTING session is neither.
    var force = box.dataset.sessionTerminal === 'true' || box.dataset.sessionWaiting === 'true';
    var opts = { urlKey: urlKey, followUpTo: sessionId, target: target, force: force };

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      sendReply(opts, btn, textarea, feedback, thread);
    });

    textarea.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        sendReply(opts, btn, textarea, feedback, thread);
      }
    });
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Per-run transcripts must render before toggle init so content is visible.
    renderRunTranscripts();
    initRunToggles();
    initInlineReplies();
    initContextWidgets();
    initGlobalReply();
  });
})();
