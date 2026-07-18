/**
 * Session Page Client (LIN-1004/LIN-1133/LIN-1309/LIN-1163).
 *
 * JS-enhanced session page: per-run expandable transcripts rendered as shared
 * chat bubbles (LIN-1309) with client-side markdown rendering, per-run inline
 * reply boxes scoped to each run's loopId (the ONE reply surface — the
 * page-level global box was removed in LIN-1163), and BriefSection/RecapSection
 * widget init on context panels.
 *
 * Loaded AFTER common.js, chat.js, marked.min.js, purify.min.js, brief.js,
 * recap.js — window.ChatUI, window.renderMarkdown, window.BriefSection,
 * window.RecapSection ARE available. Inline replies use the same raw-fetch
 * dispatch as the original global reply box (window.dispatchPrompt does not
 * support followUpTo).
 */
(function () {
  'use strict';

  // ── Conversational "you" echo (LIN-1298) ─────────────────────────────────
  // The shared ChatUI helper (public/chat.js) builds the "you" turn so the
  // reply reads as a chat message, not a vanished textarea. UI-only — the real
  // agent continuation still arrives on reload (the note says so).
  function appendYouBubble(thread, text) {
    if (!thread || typeof window.ChatUI === 'undefined') return;
    window.ChatUI.appendMessage(thread, { who: 'you', self: true, text: text, testId: 'session-reply-you' });
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

  // ── Per-run expand/collapse toggle (LIN-1133; LIN-1163 whole-card click) ───
  // Clicking anywhere on the card toggles it (mirrors the Observation-page
  // model, observation.js's makeSessionCard), not just the head — but a click
  // on an interactive descendant (reply textarea/send button, transcript link)
  // must not collapse the card out from under the user. The head stays the
  // keyboard affordance (role="button", tabindex, Enter/Space) and owns
  // aria-expanded.
  function toggleRun(run, head) {
    var expanded = run.classList.toggle('sess-run--expanded');
    head.setAttribute('aria-expanded', String(expanded));
  }

  function initRunToggles() {
    var runs = document.querySelectorAll('.sess-run');
    for (var i = 0; i < runs.length; i++) {
      (function (run) {
        var head = run.querySelector('[data-testid="session-run-toggle"]');
        if (!head) return;
        run.addEventListener('click', function (e) {
          if (e.target.closest('button, a[href], textarea, .chat-composer, .sess-inline-reply')) return;
          toggleRun(run, head);
        });
        head.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleRun(run, head);
          }
        });
      })(runs[i]);
    }
  }

  // ── Per-run transcript rendering (LIN-1133; LIN-1309 shared chat bubbles) ──
  // Each transcript is a `.chat-thread` (see lib/render-session.js); one
  // `.chat-msg` bubble per feedback entry, built via the shared ChatUI helper
  // (public/chat.js) — same conversational idiom as Task Chat. The markdown
  // render (marked + DOMPurify, with the escapeHtml fallback) and the evidence
  // link both stay INSIDE the bubble body, fed from the escaped `data-feedback`
  // JSON — that embed is still the one XSS boundary; nothing here moves to
  // server-rendered message HTML.
  function renderRunTranscripts() {
    var threads = document.querySelectorAll('[data-testid="session-run-transcript"]');
    for (var i = 0; i < threads.length; i++) {
      var thread = threads[i];
      var data = thread.dataset.feedback;
      if (!data) continue;
      var entries;
      try { entries = JSON.parse(data); } catch (e) { continue; }
      if (!entries || !entries.length || typeof window.ChatUI === 'undefined') continue;

      for (var j = 0; j < entries.length; j++) {
        var entry = entries[j];
        var messageHtml = typeof window.renderMarkdown === 'function'
          ? window.renderMarkdown(entry.message || '', { breaks: true })
          : window.escapeHtml(entry.message || '');
        var link = entry.url
          ? ' <a class="sess-tx-link" data-testid="session-transcript-link" href="' + window.escapeHtml(entry.url) + '" target="_blank" rel="noopener noreferrer">' + window.escapeHtml(entry.urlLabel || entry.url) + '</a>'
          : '';
        // LIN-1163 item 6: a [blocked]/[pending] entry (flagged server-side,
        // lib/render-session.js's encodeFeedbackJSON) gets the opt-in
        // .chat-msg--blocked highlight — additive, no other chat.css consumer
        // ever emits this class.
        var liClass = 'sess-run-tx-entry' + (entry.blocked ? ' chat-msg--blocked' : '');
        window.ChatUI.appendMessage(thread, {
          who: 'agent',
          whoState: 'in-progress',
          html: '<span class="sess-tx-msg markdown-content">' + messageHtml + '</span>' + link,
          time: entry.timestamp ? String(entry.timestamp) : undefined,
          liClass: liClass,
          testId: 'session-transcript-entry',
          reveal: false
        });
      }
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

  // ── In-progress elapsed time (LIN-1163 item 4) ─────────────────────────────
  // A non-terminal run/session renders a static "in progress" placeholder
  // server-side (lib/render-session.js); this fills in the elapsed time since
  // dispatchedAt, computed client-side (one-time, on load — matches the
  // ticket's "elapsed time can be derived client-side" assumption; it does not
  // live-tick).
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

  function fillElapsedTimes() {
    var els = document.querySelectorAll('[data-testid="session-run-elapsed"], [data-testid="session-elapsed"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var dispatchedAt = el.dataset.dispatchedAt;
      if (!dispatchedAt) continue;
      var dispatchedMs = Date.parse(dispatchedAt);
      if (isNaN(dispatchedMs)) continue;
      var elapsed = formatElapsed(Date.now() - dispatchedMs);
      if (elapsed) el.textContent = 'in progress · ' + elapsed;
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Per-run transcripts must render before toggle init so content is visible.
    renderRunTranscripts();
    initRunToggles();
    initInlineReplies();
    initContextWidgets();
    fillElapsedTimes();
  });
})();
