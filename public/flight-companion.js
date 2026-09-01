/**
 * Flight Companion client (experimental, LIN-751 Phase A §A.8).
 *
 * Drives the in-page chat thread: renders through the shared `chat.css`/
 * `window.ChatUI` primitives (chat.js loads before this file — see
 * lib/render-flight-companion.js), streams turns over SSE (the fourth
 * per-page fork of the `readSSEStream` idiom — public/app.js, public/
 * roadmap.js, public/task-chat.js already define it), and runs its OWN
 * client wake cadence (never `public/observation.js`'s `POLL_MS = 5000` —
 * that cadence paints a fast-moving table, this one gates a billable model
 * call). The server's §A.2 gate (`lib/flight-companion-gate.js`) remains
 * the sole spend authority regardless of anything this client sends or
 * withholds — the cadence below can only make the route cheaper or
 * noisier, never bypass it.
 *
 * Conversation history lives here in the browser (`chatHistory`, capped at
 * 40 turns, mirrors public/task-chat.js) and is POSTed as `body.history` on
 * EVERY turn, auto-wake included — the route applies history unconditionally
 * regardless of turn kind, so an auto-wake turn sending `[]` would make the
 * companion forget its own prior narration every tick.
 *
 * Cadence: chained `setTimeout`, base 30s, doubling 30→60→120→180s (capped),
 * visible-tab only (`document.hidden` — never `document.visibilityState`,
 * which nothing in this tree uses). Reset to 30s on ANY completed
 * user-initiated turn, or an auto-wake `done` frame carrying `surface:true`
 * (the route's own gate-computed signal, LIN-2435 Commit 1). Every other
 * outcome on the auto-wake path — a silent gate rejection, `surface:false`,
 * a mid-stream error, a network failure, or a 5xx — doubles. A session
 * expiry (401) or the feature going off (403) stops the cadence entirely,
 * since neither will resolve on a timer. No eager refresh on visibility
 * regain — that would defeat the 30s floor for a billable call.
 *
 * `phase: 'proposed'` tool events render an inline Approve/Dismiss control,
 * built here (never in the shared `public/chat.js` — Task Chat's turns are
 * always user-initiated and never need this). Dismiss is structurally
 * client-only (the router has no dismiss endpoint) — zero `fetch` calls.
 * Approve POSTs to §A.6's `approve-follow-up` route; the proposed prompt
 * text is always rendered via `textContent`, never `html:` — it is
 * model-authored.
 */
(function () {
  'use strict';

  var CADENCE_BASE_MS = 30000;
  var CADENCE_CAP_MS = 180000;
  var HISTORY_CAP = 40;

  var page = document.querySelector('.flight-companion-page');
  var urlKey = (page && page.dataset.urlKey) || '';

  // ─── Existing behaviour (LIN-1764), unchanged ──────────────────────────────

  async function copyPrompt() {
    var pre = document.getElementById('flight-companion-prompt');
    var btn = document.getElementById('flight-companion-copy');
    var feedback = document.getElementById('flight-companion-copy-feedback');
    if (!pre || !btn) return;
    var text = pre.textContent || '';
    try {
      text = await window.ProxyToggle.maybeAppend(text, urlKey);
      await navigator.clipboard.writeText(text);
      btn.textContent = 'copied ✓';
      if (feedback) feedback.textContent = 'prompt copied to clipboard';
      setTimeout(function () {
        btn.textContent = 'copy prompt';
        if (feedback) feedback.textContent = '';
      }, 1500);
    } catch (error) {
      if (feedback) feedback.textContent = (error && error.message) || 'copy failed — select the text and copy manually';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('flight-companion-copy');
    if (btn) btn.addEventListener('click', copyPrompt);
  });

  // ─── Chat thread (LIN-2435) ─────────────────────────────────────────────

  var thread = document.getElementById('flight-companion-thread');
  var emptyState = document.getElementById('flight-companion-chat-empty');
  var checkInEl = document.getElementById('flight-companion-checkin');
  var questionInput = document.getElementById('flight-companion-question');
  var sendBtn = document.getElementById('flight-companion-send');

  if (!thread || !questionInput || !sendBtn) return;

  var chatHistory = [];
  var inFlight = false;
  var cadence = { delayMs: CADENCE_BASE_MS, stopped: false };
  var timerId = null;

  // ─── Pure helpers (exposed via the test seam at the bottom — no DOM) ────

  function capHistory(history, cap) {
    cap = cap || HISTORY_CAP;
    if (history.length > cap) history.splice(0, history.length - cap);
    return history;
  }

  function nextCadenceDelay(currentDelayMs) {
    return Math.min(currentDelayMs * 2, CADENCE_CAP_MS);
  }

  // The reset criterion (ruling 62bb3b4e): a user-initiated `done` always
  // resets, unconditional of `surface` (which never appears on that frame
  // anyway). An auto-wake `done` resets only when the route's gate marked
  // this spend `surface:true`; the narrow `surface:false` seed-turn edge
  // case still renders/records normally but doubles, same as "nothing to
  // report".
  function doneCadenceEffect(turnKind, surface) {
    if (turnKind === 'user-initiated') return 'reset';
    return surface === true ? 'reset' : 'double';
  }

  // What an auto-wake tick's cadence should do on a non-'sse' classification.
  // Only reachable auto-wake kinds: 'gate-silent', 'session-expired',
  // 'flag-off', 'ai-not-configured', 'server-error', 'sse-error',
  // 'network-error' — 'message-too-long'/'free-tier-limit' cannot occur on
  // auto-wake (the route never reads a client-asserted turn kind, and
  // auto-wake never carries user text or hits the user-only 429 branch).
  function autoWakeErrorCadenceEffect(kind) {
    if (kind === 'session-expired' || kind === 'flag-off' || kind === 'ai-not-configured') return 'stop';
    return 'double';
  }

  // The pure cadence reducer: `state` in, an `effect` in
  // ('reset'|'double'|'stop'|'none'), a new `state` out. Once stopped, every
  // further effect is a no-op — there is no un-stopping short of a reload.
  function advanceCadence(state, effect) {
    if (state.stopped) return state;
    if (effect === 'stop') return { delayMs: state.delayMs, stopped: true };
    if (effect === 'reset') return { delayMs: CADENCE_BASE_MS, stopped: false };
    if (effect === 'double') return { delayMs: nextCadenceDelay(state.delayMs), stopped: false };
    return state;
  }

  // A `phase: 'proposed'` tool result is a stringified, possibly-truncated
  // JSON payload (lib/openrouter.js's truncateToolResult) — parsed
  // defensively. A truncation marker (`\n… [truncated N chars]`) fails
  // JSON.parse honestly rather than throwing uncaught.
  function parseProposalResult(resultString) {
    try {
      var parsed = JSON.parse(resultString);
      if (parsed && typeof parsed === 'object' && typeof parsed.sessionId === 'string' && typeof parsed.prompt === 'string') {
        return { ok: true, proposal: parsed };
      }
      return { ok: false };
    } catch (e) {
      return { ok: false };
    }
  }

  // Full response-classification (F4 + the binding F6 additions). Operates
  // on already-extracted pieces, never a live Response — pure and
  // test-drivable. `isEventStream` MUST come from the response's own
  // Content-Type, never inferred from a JSON-parse failure: the
  // workspaceFromUrl middleware's 404 is text/html on an /api path, and a
  // non-OK body must never be assumed JSON.
  function classifyTurnResponse(params) {
    var ok = params.ok, status = params.status, isEventStream = params.isEventStream, jsonBody = params.jsonBody;
    if (ok && isEventStream) return { kind: 'sse' };
    if (ok && jsonBody && jsonBody.spent === false) {
      return { kind: 'gate-silent', reason: jsonBody.reason };
    }
    if (status === 401) {
      return { kind: 'session-expired', message: 'Your session expired — reload to sign in again.' };
    }
    if (status === 403) {
      return { kind: 'flag-off', message: (jsonBody && jsonBody.error) || 'Flight Companion is disabled.' };
    }
    if (status === 400) {
      return { kind: 'message-too-long', message: (jsonBody && jsonBody.error) || 'Message was rejected.' };
    }
    if (status === 503) {
      return { kind: 'ai-not-configured', message: (jsonBody && jsonBody.error) || 'AI is not configured.' };
    }
    if (status === 429) {
      return { kind: 'free-tier-limit', message: (jsonBody && jsonBody.error) || 'Free tier limit reached.', freeTier: jsonBody && jsonBody.freeTier };
    }
    // 500, or any other non-OK / non-JSON response (e.g. the middleware's
    // HTML 404) — a generic, transient-assumed error.
    return { kind: 'server-error', message: 'Something went wrong (status ' + status + ').' };
  }

  // The check-in status line's text (LIN-2443 AC1). Pure — the clock is an
  // argument, never read here — so it sits on the test seam with the other
  // pure helpers.
  function formatCheckIn(date) {
    return 'checked in ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' \u00b7 nothing new';
  }

  // ─── DOM-touching glue ───────────────────────────────────────────────────

  function setEmptyVisible(visible) {
    if (emptyState) emptyState.classList.toggle('hidden', !visible);
  }

  function setComposerBusy(busy) {
    questionInput.disabled = busy;
    sendBtn.disabled = busy;
  }

  // AC4 (LIN-2443): ChatUI.appendMessage bakes the speaker pill into
  // innerHTML and returns only the <li>, so there is no mutation API — but
  // every state this needs already exists in the shared vocabulary
  // (status-pill--done/--failed, public/style.css). Page-local on purpose:
  // adding a setter to window.ChatUI would tax its four other consumers
  // (session.js, task-chat.js, collective.js, observation.js) for a need
  // only this page has today. Glyphs mirror STATUS_PILL_GLYPHS
  // (public/common.js) — NOT a chat.css/chat.js fork.
  var PILL_GLYPHS = { done: '\u2713', failed: '\u2715' };

  function setBubbleState(li, state) {
    if (!li) return;
    var pill = li.querySelector('.chat-msg__who');
    if (!pill) return;
    pill.classList.remove('status-pill--in-progress');
    pill.classList.add('status-pill--' + state);
    var char = pill.querySelector('.status-pill__char');
    if (char) char.textContent = PILL_GLYPHS[state] || '';
  }

  // AC1 (LIN-2443): ONE node, overwritten in place — non-stacking is
  // structural here, not a convention: this only ever assigns textContent
  // and never appendChild's a row.
  function updateCheckInStatus() {
    if (!checkInEl) return;
    checkInEl.textContent = formatCheckIn(new Date());
    checkInEl.hidden = false;
  }

  function appendAssistantBubble() {
    var li = window.ChatUI.appendMessage(thread, {
      who: 'companion', whoState: 'in-progress', whoClass: 'fc-msg-who',
      text: '', textClass: 'fc-msg-body', bodyClass: 'fc-msg-surface', liClass: 'fc-msg',
    });
    setEmptyVisible(false);
    return li.querySelector('.fc-msg-body');
  }

  function appendUserBubble(text) {
    window.ChatUI.appendMessage(thread, {
      who: 'you', self: true, text: text, textClass: 'fc-msg-body', bodyClass: 'fc-msg-surface', liClass: 'fc-msg',
    });
    setEmptyVisible(false);
  }

  function showInlineNote(message, beforeLi) {
    window.ChatUI.appendNote(thread, message, { liClass: 'fc-inline-note', before: beforeLi });
    setEmptyVisible(false);
  }

  function freeTierMessage(classification) {
    var ft = classification.freeTier;
    var base = classification.message || 'Free tier limit reached.';
    if (ft && typeof ft.remaining === 'number' && typeof ft.limit === 'number') {
      return base + ' (' + ft.remaining + '/' + ft.limit + ' remaining' + (ft.resetsAt ? ', resets ' + ft.resetsAt : '') + ')';
    }
    return base;
  }

  // ─── Proposal control (§A.4 `phase: 'proposed'`) ───────────────────────

  function renderProposal(resultString, beforeLi) {
    var parsed = parseProposalResult(resultString);
    if (!parsed.ok) {
      showInlineNote('The companion proposed a follow-up, but its details were too long to show in full — dismissed automatically.', beforeLi);
      return;
    }
    var proposal = parsed.proposal;

    var wrap = document.createElement('div');
    wrap.className = 'fc-proposal';

    var promptEl = document.createElement('p');
    promptEl.className = 'fc-proposal-text';
    // Model-authored text — textContent only, never an html: sink.
    promptEl.textContent = proposal.prompt;

    var actions = document.createElement('div');
    actions.className = 'fc-proposal-actions';

    var approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'fc-proposal-approve action-btn save';
    approveBtn.textContent = 'Approve';

    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'fc-proposal-dismiss action-btn';
    dismissBtn.textContent = 'Dismiss';

    var feedback = document.createElement('span');
    feedback.className = 'fc-proposal-feedback';

    actions.appendChild(approveBtn);
    actions.appendChild(dismissBtn);
    wrap.appendChild(promptEl);
    wrap.appendChild(actions);
    wrap.appendChild(feedback);

    var li = document.createElement('li');
    li.className = 'chat-msg fc-proposal-msg';
    li.appendChild(wrap);
    if (beforeLi && beforeLi.parentNode === thread) thread.insertBefore(li, beforeLi);
    else thread.appendChild(li);
    thread.hidden = false;
    thread.scrollTop = thread.scrollHeight;
    setEmptyVisible(false);

    function setResolved(text) {
      wrap.classList.add('fc-proposal--resolved');
      approveBtn.disabled = true;
      dismissBtn.disabled = true;
      feedback.textContent = text || '';
    }

    // Dismiss: purely client-side. Nothing was ever enqueued at propose
    // time, so there is structurally nothing to call — zero fetch calls.
    dismissBtn.addEventListener('click', function () {
      setResolved('Dismissed.');
    });

    approveBtn.addEventListener('click', function () {
      approveBtn.disabled = true;
      dismissBtn.disabled = true;
      feedback.textContent = 'Approving…';
      window.api('/workspace/' + encodeURIComponent(urlKey) + '/api/flight-companion/approve-follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: proposal.sessionId, prompt: proposal.prompt }),
        on401: false,
      }).then(function (body) {
        setResolved('Approved — queued for ' + ((body && body.target) || 'dispatch') + '.');
      }).catch(function (err) {
        var status = err && err.status;
        if (status === 404 || status === 422) {
          // Terminal — the session/derivation is no longer valid. Drop the
          // control rather than offer a retry that can only fail again.
          setResolved((err && err.message) || 'This proposal can no longer be approved.');
        } else if (status === 401) {
          setResolved('Your session expired — reload to sign in again.');
        } else if (status === 400) {
          setResolved((err && err.message) || 'That approval was rejected.');
        } else if (status === 403) {
          setResolved((err && err.message) || 'Flight Companion is disabled.');
          applyCadenceEffect('stop');
        } else {
          // 429/500, or a network failure — restore the control so the
          // human can retry (disable-then-restore idiom).
          approveBtn.disabled = false;
          dismissBtn.disabled = false;
          feedback.textContent = (err && err.message) || 'Approval failed — try again.';
        }
      });
    });
  }

  // ─── Tool-wire phase handling (F5: all five phases explicit) ───────────

  function handleToolEvent(data, beforeLi) {
    if (data.phase === 'proposed') {
      renderProposal(data.result, beforeLi);
    } else if (data.phase === 'cap') {
      showInlineNote('Reached the tool-call limit for this turn — answering with what it has.', beforeLi);
    }
    // 'call' / 'result' (non-proposed) / 'error' → no UI, mirrors
    // task-chat.js's own silent handling of these phases.
  }

  // ─── Cadence scheduling ──────────────────────────────────────────────────

  function scheduleAutoWake(delayMs) {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(autoWakeTick, delayMs);
  }

  // Apply a cadence effect AND (unless stopped/hidden) reschedule the
  // shared timer using the new delay — this is what makes a user-initiated
  // reset actually move the auto-wake's next firing to send+30s, not just
  // change a value the next tick happens to read later.
  function applyCadenceEffect(effect) {
    cadence = advanceCadence(cadence, effect);
    if (cadence.stopped) {
      if (timerId) { clearTimeout(timerId); timerId = null; }
      return;
    }
    if (document.hidden) {
      // Paused — no eager scheduling while hidden; resumed by
      // visibilitychange below, at the (possibly just-updated) delay.
      if (timerId) { clearTimeout(timerId); timerId = null; }
      return;
    }
    scheduleAutoWake(cadence.delayMs);
  }

  function autoWakeTick() {
    timerId = null;
    if (cadence.stopped) return;
    if (document.hidden) return; // paused; visibilitychange resumes it
    if (inFlight) {
      // A send is already in flight (user or auto-wake) — retry after the
      // same interval rather than stacking a second concurrent call.
      scheduleAutoWake(cadence.delayMs);
      return;
    }
    sendTurn(null, 'auto-wake');
  }

  function onVisibilityChange() {
    // Deliberately no eager refresh on regaining visibility — that would
    // defeat the 30s floor for a billable call. Just resume the paused
    // countdown at its current delay.
    if (!document.hidden && !timerId && !cadence.stopped && !inFlight) {
      scheduleAutoWake(cadence.delayMs);
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ─── Turn send/receive ───────────────────────────────────────────────────

  function finishTurn() {
    inFlight = false;
    setComposerBusy(false);
    // A hidden→visible transition mid-turn leaves onVisibilityChange's
    // `!inFlight` bail a no-op and the pending timer already consumed
    // (autoWakeTick nulled timerId before bailing on document.hidden) — so a
    // user-initiated failure branch here (which applies no cadence effect of
    // its own) would otherwise leave the cadence neither stopped nor
    // scheduled. Reschedule unconditionally on completion, same as
    // live-console.js's `finally` idiom, guarded so it never doubles up on
    // an effect applyCadenceEffect already scheduled above.
    if (!cadence.stopped && !document.hidden && !timerId) {
      scheduleAutoWake(cadence.delayMs);
    }
  }

  function handleNonStreamOutcome(classification, turnKind, sentMessage) {
    switch (classification.kind) {
      case 'gate-silent':
        // Auto-wake only — nothing to report; counts as "nothing to report"
        // for backoff. From the reader's side a gate-silent tick IS the
        // companion checking in and finding nothing, so it refreshes the
        // same single status line an empty auto-wake `done` does (LIN-2443
        // plan §2) rather than letting the line go stale while ticks are in
        // fact happening. Still no row is ever appended.
        updateCheckInStatus();
        applyCadenceEffect('double');
        break;
      case 'session-expired':
        showInlineNote(classification.message);
        applyCadenceEffect('stop');
        if (turnKind === 'user-initiated') {
          chatHistory.pop();
          questionInput.value = sentMessage;
        }
        break;
      case 'flag-off':
        showInlineNote(classification.message);
        applyCadenceEffect('stop');
        if (turnKind === 'user-initiated') {
          chatHistory.pop();
          questionInput.value = sentMessage;
        }
        break;
      case 'message-too-long':
        // user-initiated only (cannot occur on auto-wake). Composer text
        // is preserved for editing; no auto-retry.
        chatHistory.pop();
        showInlineNote(classification.message);
        questionInput.value = sentMessage;
        break;
      case 'ai-not-configured':
        showInlineNote(classification.message);
        if (turnKind === 'auto-wake') {
          applyCadenceEffect('stop');
        } else {
          chatHistory.pop();
          questionInput.value = sentMessage;
        }
        break;
      case 'free-tier-limit':
        // user-initiated only — the auto-wake equivalent is the silent
        // gate-silent row above, a distinct code path.
        chatHistory.pop();
        showInlineNote(freeTierMessage(classification));
        break;
      case 'server-error':
      default:
        showInlineNote(classification.message);
        if (turnKind === 'auto-wake') {
          applyCadenceEffect('double');
        } else {
          chatHistory.pop();
          questionInput.value = sentMessage;
        }
        break;
    }
    finishTurn();
  }

  function sendTurn(message, turnKind) {
    inFlight = true;
    setComposerBusy(true);

    if (turnKind === 'user-initiated') {
      appendUserBubble(message);
      chatHistory.push({ role: 'user', content: message });
      capHistory(chatHistory);
    }

    var priorHistory = turnKind === 'user-initiated' ? chatHistory.slice(0, -1) : chatHistory.slice();
    var body = { history: priorHistory };
    if (message) body.message = message;

    var answerEl = null;
    var answerLi = null;
    var answerText = '';

    // AC3 (LIN-2443): the bubble is created on demand rather than at stream
    // open, so a silent or tool-only auto-wake tick never paints an empty
    // row. `chat-cursor` therefore appears with the first token rather than
    // at stream open; the composer is already disabled via setComposerBusy,
    // so a user turn still has feedback during the pre-first-token wait.
    function ensureAssistantBubble() {
      if (!answerEl) {
        answerEl = appendAssistantBubble();
        answerEl.classList.add('chat-cursor');
        answerLi = answerEl.closest('li');
      }
      return answerEl;
    }

    // Raw fetch carve-out: this response may be a Server-Sent Events stream
    // consumed via the reader below; window.api() parses the body as JSON
    // and would break streaming — the non-stream branch reads the body
    // itself instead.
    fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/flight-companion/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify(body),
    }).then(function (response) {
      var contentType = response.headers.get('content-type') || '';
      var isEventStream = contentType.indexOf('text/event-stream') === 0;

      if (response.ok && isEventStream) {
        return readSSEStream(response, function (type, eventData) {
          if (type === 'tool') {
            // Deliberately NOT a bubble-creation trigger — `proposed`
            // included (LIN-2443 plan §10). Treating a bare call/result as
            // one would re-create the empty bubble AC1/AC3 exist to remove
            // on a tool-only tick. `beforeLi` may now be null; renderProposal
            // (:269-270) and ChatUI.appendNote (chat.js:106) both already
            // append at thread level in that case, so the Approve/Dismiss
            // card renders identically — just appended rather than inserted.
            handleToolEvent(eventData, answerLi);
          } else if (type === 'token' || type === 'message') {
            var chunk = typeof eventData === 'object' ? (eventData.token || eventData.text || '') : eventData;
            // First NON-EMPTY chunk creates the bubble — text is the only
            // thing that ever goes inside one.
            if (chunk) {
              ensureAssistantBubble();
              answerText += chunk;
              answerEl.textContent = answerText;
              thread.scrollTop = thread.scrollHeight;
            }
          } else if (type === 'done') {
            // The empty-done guard (task-chat.js's own pattern) is unchanged:
            // never push an empty assistant turn into history — a text-free
            // entry would be forwarded to the model on every subsequent
            // turn. Only the DOM effect of the empty case moves, and it now
            // diverges by turn kind (AC1 vs AC2).
            if (answerText) {
              answerEl.classList.remove('chat-cursor');
              chatHistory.push({ role: 'assistant', content: answerText });
              capHistory(chatHistory);
              setBubbleState(answerLi, 'done');
            } else if (turnKind === 'user-initiated') {
              // AC2: the human asked and deserves a row. Display-only — this
              // sentence is NEVER pushed to chatHistory (that is exactly what
              // the guard above exists to prevent).
              var replyEl = ensureAssistantBubble();
              replyEl.classList.remove('chat-cursor');
              replyEl.textContent = 'no reply \u2014 nothing to add';
              setBubbleState(answerLi, 'done');
            } else {
              // AC1: a silent auto-wake tick. No bubble was ever created and
              // none is created now — only the one status line updates.
              updateCheckInStatus();
            }
            applyCadenceEffect(doneCadenceEffect(turnKind, eventData && eventData.surface));
            finishTurn();
          } else if (type === 'error') {
            // A mid-stream error is not the designed silence AC1 covers, so
            // the bubble is created if absent — a failure is never silent.
            var errEl = ensureAssistantBubble();
            errEl.classList.remove('chat-cursor');
            errEl.textContent = answerText + '\n[error: ' + ((eventData && eventData.message) || 'failed') + ']';
            setBubbleState(answerLi, 'failed');
            if (turnKind === 'user-initiated') chatHistory.pop();
            else applyCadenceEffect('double');
            finishTurn();
          }
        });
      }

      // Non-stream branch: a gate JSON response, or an error status. Never
      // assume a non-OK body is JSON — the middleware's 404 is text/html on
      // an /api path (mirrors task-chat.js's own response.json().catch()).
      return response.json().catch(function () { return null; }).then(function (jsonBody) {
        var classification = classifyTurnResponse({ ok: response.ok, status: response.status, isEventStream: isEventStream, jsonBody: jsonBody });
        handleNonStreamOutcome(classification, turnKind, message);
      });
    }).catch(function () {
      // Network failure (fetch itself rejected).
      if (turnKind === 'user-initiated') {
        chatHistory.pop();
        showInlineNote('Network failure — try again.');
        questionInput.value = message;
      } else {
        applyCadenceEffect('double');
      }
      finishTurn();
    });
  }

  function readSSEStream(response, onEvent) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return;
        buffer += decoder.decode(result.value, { stream: true });
        var parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i];
          if (!part.trim()) continue;
          var type = 'message';
          var eventData = '';
          var lines = part.split('\n');
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j];
            if (line.indexOf('event: ') === 0) type = line.slice(7);
            else if (line.indexOf('data: ') === 0) eventData = line.slice(6);
          }
          if (eventData) {
            try { onEvent(type, JSON.parse(eventData)); }
            catch (e) { onEvent(type, eventData); }
          }
        }
        return pump();
      });
    }
    return pump();
  }

  function submitQuestion() {
    var text = (questionInput.value || '').trim();
    if (!text || inFlight) return;
    questionInput.value = '';
    sendTurn(text, 'user-initiated');
  }

  sendBtn.addEventListener('click', submitQuestion);
  questionInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitQuestion(); }
  });

  window.addEventListener('beforeunload', function () {
    if (timerId) { clearTimeout(timerId); timerId = null; }
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  // First attempt at t=30s (deliberately unlike observation.js's free
  // poll — this call is billable, so there is no call at t=0). If the tab
  // starts hidden, onVisibilityChange schedules the first attempt once it
  // becomes visible instead.
  if (!document.hidden) scheduleAutoWake(cadence.delayMs);

  // Test-only seam (inert in the browser, where `module` is undefined):
  // exposes the pure helpers plus the cadence/turn-send entry points so
  // node:vm-sandboxed unit tests can drive real behavior without needing to
  // re-port this logic. Mirrors public/observation.js's own seam.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      capHistory, nextCadenceDelay, doneCadenceEffect, autoWakeErrorCadenceEffect,
      advanceCadence, classifyTurnResponse, parseProposalResult, formatCheckIn,
      applyCadenceEffect, scheduleAutoWake, autoWakeTick, sendTurn, submitQuestion,
      getCadenceState: function () { return cadence; },
      getChatHistory: function () { return chatHistory; },
      CADENCE_BASE_MS: CADENCE_BASE_MS, CADENCE_CAP_MS: CADENCE_CAP_MS, HISTORY_CAP: HISTORY_CAP,
    };
  }
})();
