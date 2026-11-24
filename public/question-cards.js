/**
 * Question-card client (LIN-3252 S2; shared by the session page and the task
 * page, LIN-3499).
 *
 * The pinned reply card's behaviour (Answer), and the
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
  // LIN-4114: `cardCtx` is set only by a pinned card: `{ card, controls }`, where `controls` are every button on the card.
  // While the answer is in flight none of them can start a second one; a failure brings them back; a delivered answer,
  // or one that landed but did not run (partial), keeps them off. The per-run box passes nothing and is unchanged.
  function sendReply(opts, btn, textarea, feedback, thread, cardCtx) {
    var outcome = null;
    function setControls(disabled) {
      if (!cardCtx) return;
      cardCtx.controls.forEach(function (b) { if (b) b.disabled = disabled; });
    }
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
    setControls(true);
    // LIN-4242: the answer is in flight until it settles. The live Waiting section keeps a card that is in flight.
    if (cardCtx) cardCtx.card.dataset.answerInFlight = 'true';
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
      outcome = 'success';
      appendYouBubble(thread, prompt);
      textarea.value = '';
      feedback.textContent = queuedCopy(!opts.issueless);
      btn.textContent = 'queued ✓';
      feedback.className = 'sess-reply-feedback';
      if (cardCtx) announceRulingGone(cardCtx.card, feedback.textContent);
    }

    // Comment-write failure and issueless-dispatch failure are two distinct
    // outcomes in window.ReplyDelivery's API (onCommentFailed/onDispatchFailed
    // — an issueless failure has no comment behind it to have "recorded"), but
    // both wire to this same handler here: today's identical "reply failed:
    // ..." copy, zero user-visible change from before the extraction.
    function onDispatchFailed(e) {
      outcome = 'failed';
      feedback.textContent = 'reply failed: ' + e.message;
      feedback.className = 'sess-reply-feedback error';
      btn.textContent = 'failed';
    }

    function restoreButton() {
      if (cardCtx) {
        // LIN-4242: a partial failure keeps its card (the Retry delivery lives on it), so it stays in flight; any other
        // outcome has settled the answer.
        if (outcome !== 'partial') delete cardCtx.card.dataset.answerInFlight;
        // LIN-4114: only a failure brings the card back. A delivered answer's text stays ("answered ✓"); the card goes.
        if (outcome !== 'failed') return;
        setControls(false);
        setTimeout(function () {
          if (btn.isConnected && btn.textContent === 'failed') btn.textContent = original;
        }, 1800);
        return;
      }
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
      outcome = 'partial';
      var deliveryVerb = 'deliver to the session';
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
          feedback.textContent = queuedCopy(true);
          feedback.className = 'sess-reply-feedback';
          // LIN-4114: a retry that lands delivers the answer, so the card goes like any other delivered answer.
          if (cardCtx) announceRulingGone(cardCtx.card, feedback.textContent);
        }).catch(function (e2) {
          feedback.textContent = 'Still could not ' + deliveryVerb + ': ' + e2.message + '. ';
          feedback.className = 'sess-reply-feedback error';
          feedback.appendChild(retryBtn);
          retryBtn.disabled = false;
        });
      });
      feedback.appendChild(retryBtn);
      // LIN-4114: a partial failure already recorded the answer; the only way forward is "Retry delivery", so the
      // answer buttons stay off here (a second press would write a second comment).
      if (!cardCtx) {
        btn.textContent = original;
        btn.disabled = false;
      }
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
    // LIN-4541: a reply is a comment and a resume, never an answer to a ruling. A question is answered through its own
    // route (public/question-records.js), so the old record and fresh-run effects went with the ruling machinery.
    window.ReplyDelivery.deliverReply(opts, prompt, {
      onCommentFailed: onDispatchFailed,
      onDispatchFailed: onDispatchFailed,
      onPartialFailure: onPartialFailure,
      onDispatchOk: onDispatchOk
    }).then(restoreButton);
  }

  // ── Answered, dismissed: one bubbling event (LIN-4114) ───────────────────────
  // Fired from inside the card when its answer is delivered (an option press, Answer, a successful Retry delivery) or its
  // dismiss succeeds. It bubbles to Home's <main>, where one listener clears every copy of that card (public/app.js).
  // A dismiss fires BEFORE the card leaves the DOM: a detached node does not bubble.
  var RULING_GONE_EVENT = 'harbour:question-answered';
  // Home registers its <main> here at startup (setDeskRoot), so an answer whose card has already left the page still reaches it.
  var deskRoot = null;
  // The key every copy of one question's card shares (LIN-4538): a question record's card by its question id; a waiting run's
  // reply card by its loop. Question cards must not share the loop key: they would all read 'loop:', so a typed answer could be
  // kept on a different question's card.
  function rulingKeyOf(card) {
    var d = card.dataset || {};
    if (d.questionId) return 'question:' + d.questionId;
    return 'loop:' + (d.loopId || '');
  }
  // In the unit suite `CustomEvent` stays absent because announceRulingGone exits without it: the typeof guard below
  // returns before any dispatchEvent, so the unit suite never needs a bubbling event (LIN-4309).
  function announceRulingGone(card, message) {
    if (!card || typeof CustomEvent !== 'function') return;
    // A card still on the page bubbles to <main>. A card that left it (a search cleared while its answer was in flight)
    // cannot bubble, so the desk root takes the event.
    var target = card.isConnected !== false && typeof card.dispatchEvent === 'function' ? card : deskRoot;
    if (!target || typeof target.dispatchEvent !== 'function') return;
    target.dispatchEvent(new CustomEvent(RULING_GONE_EVENT, {
      bubbles: true,
      detail: { key: rulingKeyOf(card), urlKey: (card.dataset && card.dataset.urlKey) || '', message: message || '' }
    }));
  }
  // ── Pinned reply cards (LIN-3252 S2) ────────────────────────────────────
  // One card for a run parked on a bare `[blocked]` with no question record (lib/question-card.js renderBareBlockedCard). Answer
  // goes through the SAME Send-and-continue plumbing as the per-run box: comment write, then the follow-up. A read-only card
  // renders no answer button/textarea, so it is skipped here. (The decision card with its options and dismiss went with the
  // ruling machinery, LIN-4541: a question is a question record's card, public/question-records.js.)

  // `root` scopes the binding (Home binds the card it paints into its state block); a card bound once is skipped, so a
  // repeat call never answers twice.
  function initQuestionCards(root) {
    var cards = (root || document).querySelectorAll('[data-testid="session-question-card"]');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        if (card.dataset.qcardBound) return;
        card.dataset.qcardBound = 'true';
        var btn = card.querySelector('[data-testid="session-question-card-answer"]');
        var textarea = card.querySelector('[data-testid="session-question-card-input"]');
        var feedback = card.querySelector('.sess-qcard-feedback');
        if (!btn || !textarea || !feedback) return; // read-only card
        var thread = card.querySelector('[data-testid="session-question-card-thread"]');
        // LIN-4114: an in-flight answer disables the card's controls (sendReply restores them on a failure only).
        var cardCtx = { card: card, controls: [btn] };
        var issueIdentifier = card.dataset.issueIdentifier || '';
        var opts = {
          urlKey: card.dataset.urlKey,
          followUpTo: card.dataset.loopId,
          target: card.dataset.target === 'web' ? 'web' : 'cli',
          // A paused session forces the resume — same force semantics as the per-run box (LIN-1252).
          force: card.dataset.sessionWaiting === 'true',
          issueId: card.dataset.issueId || issueIdentifier,
          issueIdentifier: issueIdentifier,
          issueless: !issueIdentifier,
          // LIN-3126 residual: the run's source (rendered onto the card by lib/question-card.js), forwarded so the comment
          // write resolves the issue's provider.
          source: card.dataset.source || undefined
        };

        // Answer sends the typed text only. An empty box says so.
        function submit() {
          var typed = (textarea.value || '').trim();
          if (!typed) {
            feedback.textContent = 'enter a reply';
            feedback.className = 'sess-qcard-feedback sess-reply-feedback error';
            return;
          }
          opts.prompt = typed;
          sendReply(opts, btn, textarea, feedback, thread, cardCtx);
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

  var api = { appendYouBubble: appendYouBubble, sendReply: sendReply, initQuestionCards: initQuestionCards, rulingKeyOf: rulingKeyOf, RULING_GONE_EVENT: RULING_GONE_EVENT, setDeskRoot: function (el) { deskRoot = el; } };
  if (typeof window !== 'undefined') window.QuestionCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
