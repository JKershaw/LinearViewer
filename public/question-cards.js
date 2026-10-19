/**
 * Question-card client (LIN-3252 S2; shared by the session page and the task
 * page, LIN-3499).
 *
 * The pinned question card's behaviour: Answer, option choice, dismiss, and the
 * Send-and-continue reply plumbing (`sendReply`) the session page's per-run
 * reply boxes also use. Paired with lib/question-card.js (the markup).
 *
 * Loaded AFTER common.js and chat.js — window.ReplyDelivery and window.ChatUI
 * ARE available. Exposes window.QuestionCards; the pages call
 * `initQuestionCards()` once at DOMContentLoaded.
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
          // LIN-3126 residual: the ruling anchor's source (rendered onto the
          // card by lib/render-session.js), forwarded to the shared answer
          // helper so its comment write / dispatch resolves the issue's provider.
          source: card.dataset.source || undefined
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

  var api = { appendYouBubble: appendYouBubble, sendReply: sendReply, dismissQuestionCard: dismissQuestionCard, initQuestionCards: initQuestionCards };
  if (typeof window !== 'undefined') window.QuestionCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
