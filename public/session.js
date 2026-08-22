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
 * dispatch as the original global reply box.
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

  // ── Save (comment-only) ───────────────────────────────────────────────────
  function sendSave(opts, btn, textarea, feedback, thread) {
    var prompt = (textarea.value || '').trim();
    if (!prompt) {
      feedback.textContent = 'enter a reply';
      feedback.className = 'sess-reply-feedback error';
      return;
    }
    // LIN-2154 OQ5: a comment-only save against a session-level waiting signal
    // can quietly leave the session parked with no delivered answer — session
    // granularity, not per-run (see renderInlineReplyBox's own note).
    if (opts.sessionWaiting) {
      var proceed = window.confirm('This session has a reply still waiting — save this comment without continuing?');
      if (!proceed) return;
    }
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'saving…';
    feedback.textContent = '';
    feedback.className = 'sess-reply-feedback';

    window.ReplyDelivery.postComment(opts.urlKey, opts.issueId, prompt, { decisionLoopId: opts.decisionLoopId, decisionId: opts.decisionId })
      .then(function (result) {
        if (!result.ok) throw window.ReplyDelivery.errorFromResult(result);
        appendYouBubble(thread, prompt);
        textarea.value = '';
        feedback.textContent = 'recorded on the task';
        feedback.className = 'sess-reply-feedback';
        btn.textContent = 'saved ✓';
      })
      .catch(function (e) {
        feedback.textContent = 'save failed: ' + e.message;
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

  // ── Save and continue (comment write, then the existing dispatch follow-up) ──
  // The comment-first/dispatch-second ordering, the {ok,status,data} raw-fetch
  // contract, and the partial-failure/retry-only-dispatch guard now live in
  // window.ReplyDelivery (LIN-2200, public/common.js) — this function supplies
  // only the DOM/copy/echo for the reply box:
  //   1. comment write fails            -> show the error; dispatch never attempted
  //   2. comment ok, dispatch fails     -> "recorded, could not deliver" + retry-delivery
  //   3. comment ok, dispatch enqueues  -> today's queued copy + recorded confirmation
  // An issueless run (opts.issueless) skips the comment call entirely and keeps
  // the pre-existing dispatch-only behavior byte-for-byte.
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
    feedback.innerHTML = '';
    feedback.className = 'sess-reply-feedback';

    function queuedCopy(recorded) {
      var base = opts.force
        ? 'reply queued — if the session has ended you\'ll see "no live session to resume" in the transcript on reload'
        : 'reply queued — reload to see the session continue';
      return recorded ? base + ' Recorded on the task.' : base;
    }

    function onDispatchOk() {
      appendYouBubble(thread, prompt);
      textarea.value = '';
      feedback.textContent = queuedCopy(!opts.issueless);
      feedback.className = 'sess-reply-feedback';
      btn.textContent = 'queued ✓';
    }

    // Comment-write failure and issueless-dispatch failure are two distinct
    // outcomes in window.ReplyDelivery's API (onCommentFailed/onDispatchFailed
    // — an issueless failure has no comment behind it to have "recorded"), but
    // both wire to this same handler here: today's identical "reply failed:
    // ..." copy, zero user-visible change from before the extraction.
    function onDispatchFailed(e) {
      feedback.textContent = 'reply failed: ' + e.message;
      feedback.className = 'sess-reply-feedback error';
      btn.textContent = 'failed';
    }

    function restoreButton() {
      setTimeout(function () {
        if (btn.isConnected) {
          btn.textContent = original;
          btn.disabled = false;
        }
      }, 1800);
    }

    // Comment already recorded, but the dispatch enqueue failed synchronously
    // (400/409/429/503 -- dispatchQueueLimiter is live, so a retry burst can
    // legitimately hit 429): surface a structural partial failure with a
    // retry affordance that re-fires ONLY the dispatch call -- the comment is
    // never resent (harmless via dedupe if it were). `retryDispatch` is
    // window.ReplyDelivery's own closure over this same opts/prompt — not a
    // caller-side reimplementation of postDispatch.
    function onPartialFailure(dispatchErr, retryDispatch) {
      appendYouBubble(thread, prompt);
      textarea.value = '';
      feedback.textContent = 'Recorded on the task. Could not deliver to the session: ' + dispatchErr.message + '. ';
      feedback.className = 'sess-reply-feedback error';
      var retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'sess-reply-retry-delivery';
      retryBtn.textContent = 'Retry delivery';
      retryBtn.addEventListener('click', function () {
        retryBtn.disabled = true;
        feedback.textContent = 'retrying delivery…';
        feedback.className = 'sess-reply-feedback';
        retryDispatch().then(function () {
          feedback.textContent = queuedCopy(true);
          feedback.className = 'sess-reply-feedback';
        }).catch(function (e2) {
          feedback.textContent = 'Still could not deliver: ' + e2.message + '. ';
          feedback.className = 'sess-reply-feedback error';
          feedback.appendChild(retryBtn);
          retryBtn.disabled = false;
        });
      });
      feedback.appendChild(retryBtn);
      btn.textContent = original;
      btn.disabled = false;
    }

    // Raw fetch (not window.dispatchPrompt) is deliberate: window.api throws
    // on a non-2xx response and structurally cannot yield the {ok,status,data}
    // shape this chain depends on; the payload's minimalism
    // ({prompt,followUpTo,target[,force]}, no issue fields, no attachProxy) is
    // a server-side input the dispatch factory/bootstrap-provisioning
    // contracts key on (LIN-1292, LIN-1431); and dispatchPrompt hard-requires
    // issue.id+issue.identifier (this box only ever carries one) and fires
    // window.updateQueueBadge, a UI side effect this reply flow must not own.
    // Full reasoning: the banner note on window.ReplyDelivery (common.js).
    window.ReplyDelivery.deliverReply(opts, prompt, {
      onCommentFailed: onDispatchFailed,
      onDispatchFailed: onDispatchFailed,
      onPartialFailure: onPartialFailure,
      onDispatchOk: onDispatchOk
    }).then(restoreButton);
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
        // LIN-1728 Phase 2 (Revision 3, F6): a `decision-answer` stamp is
        // answer metadata, not a chat turn — it must never render as a bare
        // `{"decision_id":...}` agent bubble. `entry.kind` rides the encoded
        // JSON per LIN-2184 (lib/render-session.js's encodeFeedbackJSON).
        if (entry.kind === 'decision-answer') continue;
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
        var saveBtn = box.querySelector('.sess-reply-save');
        var feedback = box.querySelector('.sess-reply-feedback');
        var thread = box.querySelector('[data-testid="session-inline-reply-thread"]');
        if (!textarea || !btn) return;

        // LIN-2154: issueless gate, keyed on data-issue-identifier (matching
        // renderRun's own "(no task)" definition, lib/render-session.js) — an
        // issueless run has nothing to durably record a comment against. Save
        // is hidden; Save-and-continue (the `btn` below) degrades to the
        // pre-existing dispatch-only behavior. The write target prefers the
        // real issueId when the loop carries one, falling back to the human
        // identifier (both accepted by the comment route's isValidIssueId).
        var issueIdentifier = box.dataset.issueIdentifier || '';
        var issueless = !issueIdentifier;
        var issueId = box.dataset.issueId || issueIdentifier;
        // LIN-1728 Phase 2: present only when the run carries an unanswered
        // decision (lib/render-session.js's renderInlineReplyBox omits the
        // attribute otherwise). The decision-bearing loop IS this reply box's
        // own loop, so decisionLoopId reuses data-loop-id rather than a
        // separate attribute.
        var decisionId = box.dataset.decisionId || null;

        var opts = {
          urlKey: box.dataset.urlKey,
          followUpTo: box.dataset.loopId,
          target: box.dataset.target === 'web' ? 'web' : 'cli',
          // Force when this run is terminal OR the session is paused-on-human/waiting
          // (LIN-1252). `data-terminal` is the run's own status; `data-session-waiting`
          // is the session-level waiting signal (keyed session-wide, not per-run).
          force: box.dataset.terminal === 'true' || box.dataset.sessionWaiting === 'true',
          sessionWaiting: box.dataset.sessionWaiting === 'true',
          issueId: issueId,
          issueless: issueless,
          decisionLoopId: decisionId ? box.dataset.loopId : null,
          decisionId: decisionId
        };

        if (saveBtn) {
          if (issueless) {
            saveBtn.hidden = true;
          } else {
            saveBtn.addEventListener('click', function (e) {
              e.preventDefault();
              sendSave(opts, saveBtn, textarea, feedback, thread);
            });
          }
        }

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
