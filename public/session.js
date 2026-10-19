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

  // The reply plumbing and the pinned question cards live in
  // public/question-cards.js (LIN-3499), shared with the task page.
  var appendYouBubble = window.QuestionCards.appendYouBubble;
  var sendReply = window.QuestionCards.sendReply;
  var initQuestionCards = window.QuestionCards.initQuestionCards;

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

    window.ReplyDelivery.postComment(opts.urlKey, opts.issueId, prompt, { decisionLoopId: opts.decisionLoopId, decisionId: opts.decisionId, source: opts.source })
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
          if (e.target.closest('button, a[href], textarea, .chat-composer, .sess-inline-reply, .sess-proposals')) return;
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
        // LIN-1728 Phase 2 (Revision 3, F6) / LIN-3037: a decision-lifecycle
        // stamp (decision-answer, decision-withdrawn,
        // decision-withdrawal-reversed) is answer/withdrawal metadata, not a
        // chat turn — it must never render as a bare `{"decision_id":...}`
        // agent bubble (or a withdrawal's raw `reason` text). `entry.kind`
        // rides the encoded JSON per LIN-2184 (lib/render-session.js's
        // encodeFeedbackJSON).
        if (entry.kind === 'decision-answer' || entry.kind === 'decision-withdrawn' || entry.kind === 'decision-withdrawal-reversed') continue;
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
          decisionId: decisionId,
          // LIN-3126 residual: the run page's own source stamp, forwarded so the
          // reply's comment write / resume resolves the issue's provider.
          // Sparse — absent on an unsourced run.
          source: box.dataset.source || undefined
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

  // ── Live clocks (LIN-1163 item 4; LIN-3250 live ticking) ───────────────────
  // The server renders each clock's current value and the timestamps it needs;
  // this re-derives them once a second so an open run's wall clock and waiting
  // clock keep moving without a reload. Per-run in-progress rows keep the
  // original one-line "in progress · Xs" shape.
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

  // Elapsed for one element: a fixed `data-end` is static; an open clock ticks
  // against now. Accepts `data-start` (session wall clock) or the legacy
  // `data-dispatched-at` (per-run in-progress rows).
  function clockElapsed(el) {
    var start = el.dataset.start || el.dataset.dispatchedAt;
    if (!start) return null;
    var startMs = Date.parse(start);
    if (isNaN(startMs)) return null;
    var endMs = el.dataset.end ? Date.parse(el.dataset.end) : NaN;
    var ms = isNaN(endMs) ? Date.now() - startMs : endMs - startMs;
    return formatElapsed(ms);
  }

  function tickClocks() {
    var runEls = document.querySelectorAll('[data-testid="session-run-elapsed"]');
    for (var i = 0; i < runEls.length; i++) {
      var runElapsed = clockElapsed(runEls[i]);
      if (runElapsed) runEls[i].textContent = 'in progress · ' + runElapsed;
    }
    var wallEls = document.querySelectorAll('[data-testid="session-elapsed"]');
    for (var j = 0; j < wallEls.length; j++) {
      var wallElapsed = clockElapsed(wallEls[j]);
      if (wallElapsed) wallEls[j].textContent = wallElapsed;
    }
    var waitEls = document.querySelectorAll('[data-testid="session-waiting-clock"]');
    for (var k = 0; k < waitEls.length; k++) {
      var since = waitEls[k].dataset.since;
      if (!since) continue;
      var sinceMs = Date.parse(since);
      if (isNaN(sinceMs)) continue;
      var waitElapsed = formatElapsed(Date.now() - sinceMs);
      if (waitElapsed) waitEls[k].textContent = 'waiting ' + waitElapsed;
    }
  }

  // ── Run proposals (LIN-3254): Apply / Decline ─────────────────────────────
  // Each pending row posts to the run-proposal endpoint and, on success, swaps
  // its buttons for a quiet one-line state in place. window.api throws on a
  // non-2xx, so a refused/failed apply (which the server reverts to proposed)
  // re-enables the buttons and shows a short error.
  function settleProposal(row, action) {
    var actions = row.querySelector('.sess-proposal-actions');
    if (actions) {
      actions.innerHTML = '<span class="sess-proposal-state" data-testid="session-proposal-state">'
        + (action === 'apply' ? 'applied' : 'declined') + '</span>';
    }
    row.setAttribute('data-proposal-status', action === 'apply' ? 'applied' : 'declined');
  }

  function initProposals() {
    var blocks = document.querySelectorAll('[data-testid="session-proposals"]');
    for (var i = 0; i < blocks.length; i++) {
      (function (block) {
        var urlKey = block.dataset.urlKey || '';
        block.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('button[data-proposal-action]') : null;
          if (!btn) return;
          e.preventDefault();
          var row = btn.closest('[data-testid="session-proposal"]');
          if (!row) return;
          var action = btn.getAttribute('data-proposal-action');
          var runId = row.dataset.runId || '';
          var id = row.dataset.proposalId || '';
          var buttons = row.querySelectorAll('button');
          for (var b = 0; b < buttons.length; b++) buttons[b].disabled = true;
          window.api(
            '/workspace/' + encodeURIComponent(urlKey) + '/api/run/'
              + encodeURIComponent(runId) + '/proposals/' + encodeURIComponent(id) + '/' + action,
            { method: 'POST', body: JSON.stringify({}) }
          ).then(function () {
            settleProposal(row, action);
          }).catch(function (err) {
            for (var b2 = 0; b2 < buttons.length; b2++) buttons[b2].disabled = false;
            var note = row.querySelector('.sess-proposal-error');
            if (!note) {
              note = document.createElement('span');
              note.className = 'sess-proposal-error';
              row.appendChild(note);
            }
            note.textContent = 'could not ' + action + ': ' + ((err && err.message) || 'failed');
          });
        });
      })(blocks[i]);
    }
  }

  // ── Live PR state (LIN-3251, S1b beat 3) ───────────────────────────────────
  // The header's PR line (LIN-3251 beat 2) starts neutral and is filled from the
  // cached `.../pr-state` route. One initial fetch runs on load for EVERY run —
  // live or finished — so a finished run does not sit on the neutral copy; then
  // a 60 s poll runs only while the tab is visible and the run is live. It stops
  // for good once the PR is merged/closed or `data-run-live` is false. A failed
  // request leaves the current line untouched and retries on the next tick.
  var PR_STATE_POLL_MS = 60000;

  // The whole schedule/stop decision, pure and directly testable.
  //   'stop'     — run finished, or the PR is merged/closed: never fetch again
  //   'schedule' — keep the 60 s cadence
  //   'pause'    — tab hidden: hold, and fetch immediately on becoming visible
  function pollAction(runLive, prState, visible) {
    if (!runLive) return 'stop';
    if (prState === 'merged' || prState === 'closed') return 'stop';
    return visible ? 'schedule' : 'pause';
  }

  function prStateVisible() {
    return typeof document.visibilityState === 'undefined' || document.visibilityState === 'visible';
  }

  function initPrState() {
    var el = document.querySelector('[data-testid="session-pr-state"]');
    if (!el) return;
    var line = el.querySelector('[data-testid="session-pr-line"]');
    var url = el.dataset.prStateUrl || '';
    var runLive = el.dataset.runLive === 'true';
    if (!url) return;

    var timer = null;
    var stopped = false;
    var currentState = null;

    function clearTimer() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    }

    function schedule() {
      clearTimer();
      timer = setTimeout(tick, PR_STATE_POLL_MS);
    }

    function apply(payload) {
      if (!payload) return;
      if (payload.state) currentState = payload.state;
      // Prefer the route's `message` — the same copy the server renders — so the
      // line has one source of truth.
      if (line && typeof payload.message === 'string' && payload.message) {
        line.textContent = payload.message;
      }
    }

    function tick() {
      timer = null;
      if (stopped) return;
      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (resp) { return resp && resp.ok ? resp.json() : null; })
        .then(function (payload) { if (payload) apply(payload); })
        .catch(function () { /* leave the line as-is and retry on the next tick */ })
        .then(function () {
          if (stopped) return;
          var action = pollAction(runLive, currentState, prStateVisible());
          if (action === 'stop') { stopped = true; clearTimer(); return; }
          if (action === 'schedule') schedule();
          // 'pause' (hidden): hold with no timer; visibilitychange resumes.
        });
    }

    function onVisibility() {
      if (stopped) return;
      if (prStateVisible()) {
        clearTimer();
        tick(); // fetch once immediately, then resume the cadence
      } else {
        clearTimer(); // pause
      }
    }

    document.addEventListener('visibilitychange', onVisibility);
    tick(); // one initial fetch for every run, live or finished
  }

  // ── Close-out box (LIN-3248, P3 of LIN-2949) ──────────────────────────────
  // Self-merge detection on read + the press, off the box the run-evidence
  // fragment renders. The press reuses the ordinary dispatch path — it fetches
  // the close-out prompt and calls window.dispatchPrompt (no new dispatch
  // route) — then records the press through beat 2's route. Detection calls
  // the check route on load and on tab focus, only while the state is ready.
  //
  // LIN-3385: production callers pass the box and reply box captured by
  // `initCloseOut` before any transcript markdown rendered. The no-argument
  // form (a document lookup by label) is a unit-test seam only; the
  // no-page-wide-label-listener guard rejects any production call of it.
  function closeOutContext(capturedBox, capturedReply) {
    var box = capturedBox || document.querySelector('[data-testid="run-evidence-closeout"]');
    if (!box) return null;
    var reply = capturedBox ? (capturedReply || null) : document.querySelector('[data-testid="session-inline-reply"][data-issue-id]');
    var urlKey = (reply && reply.getAttribute('data-url-key')) || box.getAttribute('data-url-key') || '';
    var issueId = reply ? (reply.getAttribute('data-issue-id') || '') : '';
    var issueIdentifier = (reply && reply.getAttribute('data-issue-identifier'))
      || box.getAttribute('data-issue-identifier') || '';
    // LIN-3126 residual: the issue's own source, read off the run page's own
    // stamp (lib/render-session.js's inline reply box, from the loop's dispatch
    // row) so the close-out dispatch resolves the issue's provider, not the
    // workspace's active one. Absent → undefined, so the dispatch body stays
    // byte-identical (window.dispatchPrompt omits an absent source).
    var source = (reply && reply.getAttribute('data-source')) || box.getAttribute('data-source') || '';
    return { box: box, urlKey: urlKey, issueId: issueId, issueIdentifier: issueIdentifier, source: source };
  }

  // Replace the box's dynamic content with a single line, built via textContent
  // so a server-provided message can never inject markup.
  function paintCloseOut(box, testId, line) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var p = document.createElement('p');
    p.setAttribute('data-testid', testId);
    p.textContent = line;
    box.appendChild(p);
  }

  function applyCloseOutState(box, state) {
    if (!box || !state || !state.status) return;
    if (box.getAttribute('data-state') === state.status) return;
    box.setAttribute('data-state', state.status);
    if (state.status === 'ready') return;
    if (state.status === 'merged' || state.status === 'partial') {
      paintCloseOut(box, 'run-evidence-closeout-neutral', state.message || 'the pull request is already merged');
    } else if (state.status === 'not-ready' || state.status === 'no-pr' || state.status === 'multiple-prs' || state.status === 'closed') {
      paintCloseOut(box, 'run-evidence-closeout-setup', '○ set up ›');
    } else {
      paintCloseOut(box, 'run-evidence-closeout-withheld', state.message || 'the pull request could not be read — not checked');
    }
  }

  // The captured close-out box and reply box (set once by `initCloseOut`).
  var closeOutBox = null;
  var closeOutReply = null;

  function runCloseOutCheck() {
    var ctx = closeOutContext(closeOutBox, closeOutReply);
    if (!ctx || !ctx.urlKey || !ctx.issueIdentifier) return;
    var state = ctx.box.getAttribute('data-state');
    // Stop-at-PR runs only (LIN-3248 review F1): an ordinary run's merged page
    // must not POST check at all (it writes nothing and costs live GitHub reads).
    if (ctx.box.getAttribute('data-stop-at') !== 'pr') return;
    // `ready` catches a merge that happened since load; `merged`/`partial`
    // catch a reload/revisit that already saw the merge server-side — without
    // this the person's self-merge would never be recorded and Done never set
    // (LIN-3248 review B1). The check is idempotent, so a repeat is safe.
    if (state !== 'ready' && state !== 'merged' && state !== 'partial') return;
    window.api(
      '/workspace/' + encodeURIComponent(ctx.urlKey) + '/api/run-evidence/' + encodeURIComponent(ctx.issueIdentifier) + '/check',
      { method: 'POST', body: JSON.stringify({}) }
    ).then(function (result) {
      applyCloseOutState(ctx.box, result && result.state);
    }).catch(function () { /* fail open: the box keeps its last state */ });
  }

  // Debounce tab-return so one return fires one check, not one per focused
  // element (LIN-3248 review N-a).
  var closeOutCheckTimer = null;
  function scheduleCloseOutCheck() {
    if (closeOutCheckTimer) return;
    closeOutCheckTimer = setTimeout(function () {
      closeOutCheckTimer = null;
      runCloseOutCheck();
    }, 300);
  }

  function pressCloseOut(btn) {
    var ctx = closeOutContext(closeOutBox, closeOutReply);
    if (!ctx || !ctx.urlKey || !ctx.issueId || !ctx.issueIdentifier) return;
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'closing out…';
    window.api('/workspace/' + encodeURIComponent(ctx.urlKey) + '/api/prompt/' + encodeURIComponent(ctx.issueId) + '/close-out')
      .then(function (result) {
        return window.dispatchPrompt({
          urlKey: ctx.urlKey,
          prompt: result.prompt,
          promptName: result.promptName || 'close-out',
          kind: 'close-out',
          issue: { id: ctx.issueId, identifier: ctx.issueIdentifier, title: result.issueTitle || '', source: ctx.source },
          entryRung: 'run-step'
        });
      })
      .then(function (dispatch) {
        var dispatchId = (dispatch && dispatch.item && dispatch.item.id)
          || (dispatch && dispatch.id) || null;
        return window.api(
          '/workspace/' + encodeURIComponent(ctx.urlKey) + '/api/run-evidence/' + encodeURIComponent(ctx.issueIdentifier) + '/close-out-press',
          {
            method: 'POST',
            body: JSON.stringify({
              prUrl: ctx.box.getAttribute('data-pr-url') || null,
              headSha: ctx.box.getAttribute('data-head-sha') || null,
              dispatchId: dispatchId
            })
          }
        );
      })
      .then(function () {
        btn.textContent = 'close-out sent ✓';
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = original;
        // LIN-3634: the server refused a press whose PR head moved after the review
        // approved it. Repaint the box from the refusal's state.
        var body = err && err.body;
        if (body && body.code === 'CLOSE_OUT_NOT_READY' && body.state) applyCloseOutState(ctx.box, body.state);
        console.error('Close-out press failed:', err && err.message);
      });
  }

  function initCloseOut() {
    var box = document.querySelector('[data-testid="run-evidence-closeout"]');
    if (!box) return;
    closeOutBox = box;
    closeOutReply = document.querySelector('[data-testid="session-inline-reply"][data-issue-id]');
    // LIN-3385: bind the press on the button Harbour rendered in the captured
    // box, not on the document by label (ticket text could carry the label).
    var pressBtn = box.querySelector('[data-action="closeout-press"]');
    if (pressBtn) {
      pressBtn.addEventListener('click', function (e) {
        e.preventDefault();
        pressCloseOut(pressBtn);
      });
    }
    runCloseOutCheck();
    // Tab return only: `window` focus plus visible `visibilitychange`, debounced
    // (LIN-3248 review N-a) — never the capture-phase document focus that fired
    // on every element.
    window.addEventListener('focus', scheduleCloseOutCheck);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleCloseOutCheck();
    });
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // LIN-3385: every init that looks a Harbour control up by label runs BEFORE
    // `renderRunTranscripts()`, the first place ticket-derived markdown reaches
    // the page. Looked up after, a look-alike in a transcript message could be
    // matched (or matched first). Only `initRunToggles` (UI-only: it expands
    // run rows) stays after, because it needs the rendered transcripts.
    initQuestionCards();
    initInlineReplies();
    initProposals();
    initContextWidgets();
    initPrState();
    initCloseOut();
    // Per-run transcripts must render before toggle init so content is visible.
    renderRunTranscripts();
    initRunToggles();
    tickClocks();
    setInterval(tickClocks, 1000);
  });

  // Test seam (observation.js's own pattern): the pinned card's Answer routing
  // is unit-tested directly, so the effect branch it hands to
  // window.ReplyDelivery is pinned without a full browser DOM.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initQuestionCards: initQuestionCards, initInlineReplies: initInlineReplies, initPrState: initPrState, pollAction: pollAction, pressCloseOut: pressCloseOut, closeOutContext: closeOutContext };
  }
})();
