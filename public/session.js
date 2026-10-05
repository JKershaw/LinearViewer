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
    // The pinned question card supplies its own prompt (a choice's label or the
    // typed "own answer"); the per-run reply box reads the textarea. Same flow.
    var prompt = (typeof opts.prompt === 'string' && opts.prompt ? opts.prompt : (textarea.value || '')).trim();
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

    function onDispatchOk(note) {
      appendYouBubble(thread, prompt);
      textarea.value = '';
      // The success copy matches what actually happened (LIN-3252 F1): a
      // resume queues a follow-up, a `record` effect only records, and a
      // `dispatch` effect starts a fresh run. A dispatch whose press-time
      // anchor check downgraded it to record (G1) arrives with a note — say so
      // rather than claiming a run started.
      //
      // H1: read the DELIVERED effect, not the declared one. `deliverRulingAnswer`
      // rewrites a declared `resume` on a reaped loop (G3) to a fresh run, so a
      // card that branched on `opts.effect` would claim "queued" while a run
      // actually started.
      var effect = window.ReplyDelivery.deliveredEffect(opts);
      if (effect === 'record') {
        feedback.textContent = 'recorded on the task';
        btn.textContent = 'answered ✓';
      } else if (effect === 'dispatch' && !note) {
        feedback.textContent = 'started a new run';
        btn.textContent = 'started ✓';
      } else if (effect === 'dispatch') {
        feedback.textContent = 'recorded on the task — ' + note;
        btn.textContent = 'answered ✓';
      } else {
        feedback.textContent = queuedCopy(!opts.issueless);
        btn.textContent = 'queued ✓';
      }
      feedback.className = 'sess-reply-feedback';
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
      var delivered = window.ReplyDelivery.deliveredEffect(opts);
      var deliveryVerb = delivered === 'dispatch' ? 'start a run' : 'deliver to the session';
      appendYouBubble(thread, prompt);
      textarea.value = '';
      feedback.textContent = 'Recorded on the task. Could not ' + deliveryVerb + ': ' + dispatchErr.message + '. ';
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
          feedback.textContent = delivered === 'dispatch' ? 'started a new run' : queuedCopy(true);
          feedback.className = 'sess-reply-feedback';
        }).catch(function (e2) {
          feedback.textContent = 'Still could not ' + deliveryVerb + ': ' + e2.message + '. ';
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
    //
    // LIN-3252 F1: the answer is delivered by its resolved `effect` through
    // the ONE shared helper both this card and the Rulings tab use — resume
    // (comment + follow-up), record (comment only, honoring record_on), or
    // dispatch (comment then a fresh run). Never a card-local parallel path.
    opts.prompt = prompt;
    window.ReplyDelivery.deliverRulingAnswer(opts, {
      onCommentFailed: onDispatchFailed,
      onDispatchFailed: onDispatchFailed,
      onNoTarget: function () {
        feedback.textContent = 'cannot record a reply: no linked issue';
        feedback.className = 'sess-reply-feedback error';
        btn.textContent = 'failed';
      },
      onNoLinkedIssue: function () {
        feedback.textContent = 'cannot start a fresh run: no linked issue';
        feedback.className = 'sess-reply-feedback error';
        btn.textContent = 'failed';
      },
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
          // LIN-3126 residual: the run page's own binding stamps (LIN-3240),
          // forwarded so the reply's comment write / resume resolves the issue's
          // binding. Sparse — absent on an unstamped run.
          source: box.dataset.source || undefined,
          bindingScope: box.dataset.bindingScope || undefined
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

  // ── Pinned question cards (LIN-3252 S2) ────────────────────────────────────
  // One card per unanswered decision (plus a bare-BLOCKED card). Answer goes
  // through the SAME Send-and-continue plumbing as the per-run box — comment
  // write then the existing dispatch follow-up — with the decision ids and the
  // chosen option forwarded through window.ReplyDelivery. A read-only card
  // renders no answer button/textarea, so it is skipped here.
  // The follow-up text a dismiss sends to a still-waiting run (S2.5). It carries
  // NO decision ids — the comment route would otherwise stamp it `answered`.
  var DISMISS_PROMPT = 'not worth asking: proceed on your best judgment';
  // window.ReplyDelivery.deliverReply requires all four handlers; a dismiss
  // removes its own card, so the follow-up's outcome is UI-silent.
  var DISMISS_NOOP_HANDLERS = {
    onCommentFailed: function () {},
    onDispatchFailed: function () {},
    onPartialFailure: function () {},
    onDispatchOk: function () {}
  };

  // Dismiss a decision card: stamp via the existing dashboard route, then apply
  // condition C2 (the follow-up is sent only for a `resumable` decision, from
  // window.ReplyDelivery). Remove the card on success; it never comes back.
  function dismissQuestionCard(card, dismissBtn, answerBtn, feedback) {
    var urlKey = card.dataset.urlKey;
    if (dismissBtn) dismissBtn.disabled = true;
    if (answerBtn) answerBtn.disabled = true;
    if (feedback) { feedback.textContent = 'dismissing…'; feedback.className = 'sess-qcard-feedback sess-reply-feedback'; }

    window.ReplyDelivery.dismissRuling({
      urlKey: urlKey,
      stampLoopId: card.dataset.stampLoopId,
      decisionId: card.dataset.decisionId,
      followUpTo: card.dataset.loopId,
      target: card.dataset.target === 'web' ? 'web' : 'cli',
      issueId: card.dataset.issueId || card.dataset.issueIdentifier || '',
      disposition: card.dataset.disposition,
      source: card.dataset.source || undefined,
      bindingScope: card.dataset.bindingScope || undefined,
      prompt: DISMISS_PROMPT
    }, DISMISS_NOOP_HANDLERS).then(function () {
      if (card.parentNode) card.parentNode.removeChild(card);
    }).catch(function (e) {
      if (dismissBtn) dismissBtn.disabled = false;
      if (answerBtn) answerBtn.disabled = false;
      if (feedback) {
        feedback.textContent = 'dismiss failed: ' + e.message;
        feedback.className = 'sess-qcard-feedback sess-reply-feedback error';
      }
    });
  }

  function initQuestionCards() {
    var cards = document.querySelectorAll('[data-testid="session-question-card"]');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var btn = card.querySelector('[data-testid="session-question-card-answer"]');
        var textarea = card.querySelector('[data-testid="session-question-card-input"]');
        var feedback = card.querySelector('.sess-qcard-feedback');
        var dismissBtn = card.querySelector('[data-testid="session-question-card-dismiss"]');
        if (!btn || !textarea || !feedback) return; // read-only card
        if (dismissBtn) {
          dismissBtn.addEventListener('click', function (e) {
            e.preventDefault();
            dismissQuestionCard(card, dismissBtn, btn, feedback);
          });
        }
        var thread = card.querySelector('[data-testid="session-question-card-thread"]');
        var issueIdentifier = card.dataset.issueIdentifier || '';
        var decisionId = card.dataset.decisionId || null;
        // LIN-3252 F1: the row's resolved effect, emitted server-side
        // (lib/render-session.js) exactly as the Rulings tab's row carries it.
        var effect = card.dataset.effect || 'resume';

        var opts = {
          urlKey: card.dataset.urlKey,
          followUpTo: card.dataset.loopId,
          target: card.dataset.target === 'web' ? 'web' : 'cli',
          // Force for a resumable decision (blocked-live or freshly terminal) or
          // a paused session — same force semantics as the per-run box (LIN-1252).
          force: card.dataset.disposition === 'resumable' || card.dataset.sessionWaiting === 'true',
          effect: effect,
          disposition: card.dataset.disposition || '',
          recordOn: card.dataset.recordOn || null,
          sessionWaiting: card.dataset.sessionWaiting === 'true',
          issueId: card.dataset.issueId || issueIdentifier,
          issueIdentifier: issueIdentifier,
          issueless: !issueIdentifier,
          decisionLoopId: decisionId ? card.dataset.stampLoopId : null,
          decisionId: decisionId,
          // LIN-3126 residual: the ruling anchor's binding pair (rendered onto
          // the card by lib/render-session.js), forwarded to the shared answer
          // helper so its comment write / dispatch resolves the issue's binding.
          source: card.dataset.source || undefined,
          bindingScope: card.dataset.bindingScope || undefined
        };

        // The agent brief a `dispatch` answer needs is composed from what the
        // card already renders (question + "why" chunks) through the SAME
        // shared composer the Rulings tab uses — never a card-local copy. Built
        // for every answer; the shared path ignores it on a resume/record.
        function composeDispatch(prompt) {
          var questionEl = card.querySelector('[data-testid="session-question-card-question"]');
          var chunkEls = card.querySelectorAll('[data-testid="session-question-card-why-chunk"]');
          var chunks = [];
          for (var k = 0; k < chunkEls.length; k++) chunks.push(chunkEls[k].textContent || '');
          var row = { decision: { question: questionEl ? (questionEl.textContent || '') : '' }, decisionCase: chunks };
          return window.ReplyDelivery.composeDispatchPrompt(row, prompt);
        }

        function submit() {
          var chosen = card.querySelector('.sess-qcard-option-input:checked');
          var typed = (textarea.value || '').trim();
          var prompt = typed || (chosen ? chosen.value : '');
          if (!prompt) {
            feedback.textContent = 'enter a reply';
            feedback.className = 'sess-qcard-feedback sess-reply-feedback error';
            return;
          }
          opts.optionId = chosen ? (chosen.dataset.optionId || null) : null;
          opts.prompt = prompt;
          opts.dispatchPrompt = composeDispatch(prompt);
          sendReply(opts, btn, textarea, feedback, thread);
        }

        btn.addEventListener('click', function (e) { e.preventDefault(); submit(); });
        textarea.addEventListener('keydown', function (e) {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        });
      })(cards[i]);
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
  function closeOutContext() {
    var box = document.querySelector('[data-testid="run-evidence-closeout"]');
    if (!box) return null;
    var reply = document.querySelector('[data-testid="session-inline-reply"][data-issue-id]');
    var urlKey = (reply && reply.getAttribute('data-url-key')) || box.getAttribute('data-url-key') || '';
    var issueId = reply ? (reply.getAttribute('data-issue-id') || '') : '';
    var issueIdentifier = (reply && reply.getAttribute('data-issue-identifier'))
      || box.getAttribute('data-issue-identifier') || '';
    // LIN-3126 residual: the issue's own binding pair, read off the run page's
    // own stamps (lib/render-session.js's inline reply box, from the loop's
    // dispatch row) so the close-out dispatch resolves the issue's binding, not
    // the workspace's active one. Absent → undefined, so the dispatch body
    // stays byte-identical (window.dispatchPrompt omits an absent pair).
    var source = (reply && reply.getAttribute('data-source')) || box.getAttribute('data-source') || '';
    var bindingScope = (reply && reply.getAttribute('data-binding-scope')) || box.getAttribute('data-binding-scope') || '';
    return { box: box, urlKey: urlKey, issueId: issueId, issueIdentifier: issueIdentifier, source: source, bindingScope: bindingScope };
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
    var prevYou = box.getAttribute('data-merged-by-you') === 'true';
    var nextYou = !!state.mergedByYou;
    // Repaint when the state or the "by you" claim changes (F1: a close-out
    // merge found on check replaces the server-rendered "merged by you").
    if (box.getAttribute('data-state') === state.status && prevYou === nextYou) return;
    box.setAttribute('data-state', state.status);
    box.setAttribute('data-merged-by-you', nextYou ? 'true' : 'false');
    if (state.status === 'ready') return;
    if (state.status === 'merged' || state.status === 'partial') {
      if (nextYou) {
        paintCloseOut(box, 'run-evidence-closeout-merged', '✓ merged by you' + (state.message ? ' · ' + state.message : ''));
      } else {
        paintCloseOut(box, 'run-evidence-closeout-neutral', state.message || 'the pull request is already merged');
      }
    } else if (state.status === 'not-ready' || state.status === 'no-pr' || state.status === 'multiple-prs' || state.status === 'closed') {
      paintCloseOut(box, 'run-evidence-closeout-setup', '○ set up ›');
    } else {
      paintCloseOut(box, 'run-evidence-closeout-withheld', state.message || 'the pull request could not be read — not checked');
    }
  }

  function runCloseOutCheck() {
    var ctx = closeOutContext();
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
    var ctx = closeOutContext();
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
          issue: { id: ctx.issueId, identifier: ctx.issueIdentifier, title: result.issueTitle || '', source: ctx.source, bindingScope: ctx.bindingScope },
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
        console.error('Close-out press failed:', err && err.message);
      });
  }

  function initCloseOut() {
    if (!document.querySelector('[data-testid="run-evidence-closeout"]')) return;
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-action="closeout-press"]') : null;
      if (!btn) return;
      e.preventDefault();
      pressCloseOut(btn);
    });
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
    // Per-run transcripts must render before toggle init so content is visible.
    renderRunTranscripts();
    initRunToggles();
    initQuestionCards();
    initInlineReplies();
    initProposals();
    initContextWidgets();
    initPrState();
    initCloseOut();
    tickClocks();
    setInterval(tickClocks, 1000);
  });

  // Test seam (observation.js's own pattern): the pinned card's Answer routing
  // is unit-tested directly, so the effect branch it hands to
  // window.ReplyDelivery is pinned without a full browser DOM.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initQuestionCards: initQuestionCards, initPrState: initPrState, pollAction: pollAction, pressCloseOut: pressCloseOut, closeOutContext: closeOutContext };
  }
})();
