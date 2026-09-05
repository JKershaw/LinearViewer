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
  // LIN-2632: an auto-wake tick's "checking in…" placeholder (set at
  // sendTurn's start) snapshots whatever the status line showed before it,
  // so finishTurn can restore that exact prior state if the turn ends
  // without anything more specific to say (see finishTurn below). At most
  // one turn is ever in flight (the `inFlight` guard above), so a single
  // module-level slot is safe — never overwritten mid-turn.
  var checkingInSnapshot = null;
  var CHECKING_IN_TEXT = 'checking in…';

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
      // LIN-2438: sweepLastSeenAt is additive and only ever present when
      // reason === 'sweep-not-seen' — carried through only when the server
      // actually sent it, never as an explicit `undefined` key, so a plain
      // { kind: 'gate-silent', reason } shape is unchanged for every other reason.
      var result = { kind: 'gate-silent', reason: jsonBody.reason };
      if (jsonBody.sweepLastSeenAt) result.sweepLastSeenAt = jsonBody.sweepLastSeenAt;
      return result;
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

  // Sibling to formatCheckIn (LIN-2438). `date` is the sweep's own
  // `sweepLastSeenAt` stamp (when the server sent one), never `new Date()` \u2014
  // the whole point is to name WHEN the sweep was last seen, not when this
  // tick ran. Pure \u2014 the clock is an argument, never read here.
  function formatSweepNotSeen(date) {
    if (!date) return 'sweep not seen recently \u00b7 the periodic scan may be down';
    return 'sweep last seen ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' \u00b7 the periodic scan may be down';
  }

  // Third sibling to formatCheckIn/formatSweepNotSeen (LIN-2487). Keeps
  // formatCheckIn's leading clause and replaces only its second half: the
  // date here is THIS TICK's wall clock, exactly as the ordinary line uses,
  // never the sweep's own stamp — `no-census` means there has never been a
  // scan, so there is no sweep instant to name (that is what distinguishes it
  // from sweep-not-seen). Keeping the tick time matters: without it a page
  // whose auto-wake has stopped, whose tab is hidden, or whose network is
  // dead would render identically to one polling every 30s, forever. Pure,
  // like both siblings.
  function formatNoCensus(date) {
    return 'checked in ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' \u00b7 no fleet scan yet';
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
    checkInEl.classList.remove('fc-checkin--warning');
  }

  // Sibling to updateCheckInStatus (LIN-2438) — the SAME single, replaceable
  // element (never a new node, never showInlineNote's append-a-row shape),
  // carrying the sweep-not-seen warning text plus a class for styling.
  function updateCheckInStatusSweepNotSeen(sweepLastSeenAt) {
    if (!checkInEl) return;
    checkInEl.textContent = formatSweepNotSeen(sweepLastSeenAt ? new Date(sweepLastSeenAt) : null);
    checkInEl.hidden = false;
    checkInEl.classList.add('fc-checkin--warning');
  }

  // Sibling to the two above (LIN-2487) — the SAME single, replaceable element.
  // Deliberately does NOT set `fc-checkin--warning`, and removes it: a
  // workspace with no census yet is most often a brand-new one still waiting
  // for its first sweep, which is not a fault. That wait is longer than one
  // interval — observer-sweep is round-robin, ONE workspace per 60s tick
  // (lib/observer-sweep.js), so a given workspace's first census lands after
  // up to roster-length × 60s. Colouring that red would be noise on every new
  // workspace for minutes.
  //
  // What this line buys is honesty, not volume: the operator is no longer told
  // a scan completed and found nothing. It does NOT make the boot-rejection
  // case loud — a dead sweep still reads in the muted base style. Telling a
  // first-run workspace apart from a dead one needs a persistence signal the
  // client does not have (and note that, for the same round-robin reason,
  // "it persisted across several ticks" is NOT that signal). See the ticket.
  function updateCheckInStatusNoCensus() {
    if (!checkInEl) return;
    checkInEl.textContent = formatNoCensus(new Date());
    checkInEl.hidden = false;
    checkInEl.classList.remove('fc-checkin--warning');
  }

  // LIN-2632: the auto-wake sibling of the typed-turn thinking row below —
  // "it should show when it's loading/thinking" for a silent tick too,
  // without ever painting a bubble (AC1 stays green: this only ever touches
  // the existing #flight-companion-checkin status line). Deliberately NOT a
  // fourth sibling reusing formatCheckIn's "nothing new" claim — that would
  // be a lie the instant a tick DOES surface a real narrated bubble
  // (existing behaviour, unchanged), so this is transient and always
  // superseded or restored by finishTurn, never left as a final claim.
  function updateCheckInStatusChecking() {
    if (!checkInEl) return;
    checkInEl.textContent = CHECKING_IN_TEXT;
    checkInEl.hidden = false;
    checkInEl.classList.remove('fc-checkin--warning');
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
    var li = window.ChatUI.appendNote(thread, message, { liClass: 'fc-inline-note', before: beforeLi });
    setEmptyVisible(false);
    return li;
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

  // Settle a 'call' breadcrumb on its matching 'result' — correlated via the
  // tool event's own `id` (stable across call/result/error for one hop,
  // lib/openrouter.js:1588-1607). Reuses the label already rendered at call
  // time rather than recomputing from the result event, which carries no
  // `arguments` at all — recomputing here would silently drop call-time
  // specifics (e.g. which issueId list_task_sessions was asked for). A
  // result with no matching call (defensive only — the wire always pairs
  // them within one turn) is a no-op.
  function settleToolCall(data, toolLis) {
    var entry = toolLis && data.id ? toolLis[data.id] : null;
    if (!entry) return;
    entry.li.textContent = '↳ ' + entry.label;
  }

  // Mark a 'call' breadcrumb failed on its matching 'error'. Unlike settle,
  // this recomputes the label — from the error event's own name + error
  // message via the shared helper — since that is genuinely new information
  // the call-time label never had.
  function failToolCall(data, toolLis) {
    var entry = toolLis && data.id ? toolLis[data.id] : null;
    if (!entry) return;
    entry.li.textContent = '↳ ' + window.ChatUI.toolBreadcrumbLabel({ phase: 'error', name: data.name, error: data.error });
  }

  function handleToolEvent(data, beforeLi, toolLis) {
    if (data.phase === 'call') {
      // Tool use is invisible on this page even when it happens (the bug
      // this beat fixes) — task-chat.js renders a breadcrumb per tool event
      // via appendToolBreadcrumb (public/task-chat.js) through
      // ChatUI.appendNote (public/chat.js), using labels from the shared
      // window.ChatUI.toolBreadcrumbLabel (lifted off task-chat.js, LIN-2632
      // beat 1). This mirrors that — call renders pending, settled on the
      // matching 'result' below, marked on 'error'.
      var label = window.ChatUI.toolBreadcrumbLabel(data);
      if (!label) return;
      var li = showInlineNote('↳ ' + label + ' …', beforeLi);
      if (toolLis && data.id) toolLis[data.id] = { li: li, label: label };
    } else if (data.phase === 'result') {
      settleToolCall(data, toolLis);
    } else if (data.phase === 'error') {
      failToolCall(data, toolLis);
    } else if (data.phase === 'proposed') {
      renderProposal(data.result, beforeLi);
    } else if (data.phase === 'cap') {
      showInlineNote('Reached the tool-call limit for this turn — answering with what it has.', beforeLi);
    }
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
    // LIN-2632: clear the "checking in…" placeholder on every path out of an
    // auto-wake turn, not just the silent one. Every branch with something
    // more specific to say (a plain/sweep-not-seen/no-census check-in) has
    // already overwritten checkInEl by the time finishTurn runs, so the
    // `=== CHECKING_IN_TEXT` guard is false there and this is a no-op; the
    // branches that say nothing (a real narrated auto-wake bubble, a
    // mid-stream error, a network failure, or a non-'gate-silent' HTTP
    // outcome) restore whatever the line showed before this tick, rather
    // than asserting anything about what actually happened.
    if (checkingInSnapshot && checkInEl && checkInEl.textContent === CHECKING_IN_TEXT) {
      checkInEl.textContent = checkingInSnapshot.text;
      checkInEl.hidden = checkingInSnapshot.hidden;
      checkInEl.classList.toggle('fc-checkin--warning', checkingInSnapshot.warning);
    }
    checkingInSnapshot = null;
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

  // LIN-2632 review F1: every non-SSE exit for a user-initiated turn must
  // settle the eager "thinking…" row the same way a mid-stream error does
  // (drop chat-cursor, mark failed) — otherwise it sits in
  // status-pill--in-progress forever and a retry stacks another one on top.
  // `answerLi` is null on every auto-wake path (ensureAssistantBubble is
  // never called there), so this is a no-op for those regardless of
  // `turnKind` — the guard is belt-and-braces, not load-bearing on its own.
  function settleFailedThinkingRow(answerEl, answerLi, turnKind, message) {
    if (turnKind !== 'user-initiated' || !answerLi) return;
    answerEl.classList.remove('chat-cursor');
    answerEl.textContent = '[error: ' + (message || 'failed') + ']';
    setBubbleState(answerLi, 'failed');
  }

  function handleNonStreamOutcome(classification, turnKind, sentMessage, answerEl, answerLi) {
    var settleMessage = classification.message;
    switch (classification.kind) {
      case 'gate-silent':
        // Auto-wake only — nothing to report; counts as "nothing to report"
        // for backoff. From the reader's side a gate-silent tick IS the
        // companion checking in and finding nothing, so it refreshes the
        // same single status line an empty auto-wake `done` does (LIN-2443
        // plan §2) rather than letting the line go stale while ticks are in
        // fact happening. Still no row is ever appended.
        //
        // LIN-2438: `reason: 'sweep-not-seen'` is the one gate-silent reason
        // that means something OTHER than "checked, nothing new" — the sweep
        // itself hasn't been seen recently, so say that instead. Cadence
        // effect stays 'double' either way: nothing was surfaced by a model
        // (never 'reset'), and a dead sweep can recover (never 'stop' —
        // advanceCadence has no un-stop).
        //
        // LIN-2487: `no-census` is the OTHER reason that does not mean
        // "checked, nothing new" — there is no census document at all, so
        // nothing was checked. LIN-2438 deliberately left this reason
        // un-relabelled inside the gate (it is an honest reason, and the gate
        // tests pin that it is never rewritten), which meant it arrived here
        // and fell through to the ordinary check-in line — reporting a
        // successful quiet scan for a fleet that has never been scanned.
        // Handled here, on the client, exactly as that ticket intended.
        if (classification.reason === 'sweep-not-seen') {
          updateCheckInStatusSweepNotSeen(classification.sweepLastSeenAt);
        } else if (classification.reason === 'no-census') {
          updateCheckInStatusNoCensus();
        } else {
          updateCheckInStatus();
        }
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
        settleMessage = freeTierMessage(classification);
        chatHistory.pop();
        showInlineNote(settleMessage);
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
    settleFailedThinkingRow(answerEl, answerLi, turnKind, settleMessage);
    finishTurn();
  }

  function sendTurn(message, turnKind) {
    inFlight = true;
    setComposerBusy(true);

    var answerEl = null;
    var answerLi = null;
    var answerText = '';
    // Correlates a 'call' breadcrumb to the 'result'/'error' that settles it,
    // keyed by the tool event's own `id` (stable across all three phases for
    // one hop — lib/openrouter.js:1588-1607). Scoped to this turn, matching
    // answerLi/answerText above — a fresh turn gets a fresh map, and real
    // tool-call ids never repeat within one turn.
    var toolBreadcrumbLis = {};

    // AC3 (LIN-2443): the bubble is created on demand rather than at stream
    // open, so a silent or tool-only auto-wake tick never paints an empty
    // row. `chat-cursor` therefore appears with the first token rather than
    // at stream open; the composer is already disabled via setComposerBusy,
    // so a user turn still has feedback during the pre-first-token wait.
    // For a user-initiated turn specifically, this is called EAGERLY below
    // (before the fetch even goes out) rather than waited on — so by the
    // time the first token/tool event actually arrives, this is already a
    // no-op that returns the existing bubble.
    function ensureAssistantBubble() {
      if (!answerEl) {
        answerEl = appendAssistantBubble();
        answerEl.classList.add('chat-cursor');
        answerLi = answerEl.closest('li');
      }
      return answerEl;
    }

    if (turnKind === 'user-initiated') {
      appendUserBubble(message);
      chatHistory.push({ role: 'user', content: message });
      capHistory(chatHistory);
      // LIN-2632: the thinking state — an assistant row immediately, in the
      // in-progress pill state, before any token or tool event. Previously
      // the row only appeared on the first non-empty token, so a multi-hop
      // tool turn (longer since LIN-2617) showed nothing but a disabled
      // composer — John's "it should show when it's loading/thinking".
      // `answerLi` being set now (not null) also means any tool breadcrumb
      // that arrives during a hop inserts BEFORE this row instead of
      // appending after it — the same "you → ↳ tool → the answer" order
      // task-chat.js already has. The placeholder text lives ONLY in the
      // DOM: `answerText` (what chatHistory is built from at 'done') stays
      // '' until a real token arrives, so it can never leak into history —
      // an empty turn's AC2 no-reply sentence below overwrites this SAME
      // element (ensureAssistantBubble is idempotent, so it never creates a
      // second row).
      ensureAssistantBubble();
      answerEl.textContent = 'thinking…';
    } else if (checkInEl) {
      // LIN-2632: "checking in…" — the auto-wake sibling of the thinking
      // row above, shown for the duration of the tick. Snapshotted so
      // finishTurn can restore the prior state if nothing more specific
      // claims the line by the time this turn ends (see finishTurn).
      checkingInSnapshot = {
        text: checkInEl.textContent,
        hidden: checkInEl.hidden,
        warning: checkInEl.classList.contains('fc-checkin--warning'),
      };
      updateCheckInStatusChecking();
    }

    var priorHistory = turnKind === 'user-initiated' ? chatHistory.slice(0, -1) : chatHistory.slice();
    var body = { history: priorHistory };
    if (message) body.message = message;

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
            handleToolEvent(eventData, answerLi, toolBreadcrumbLis);
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
        handleNonStreamOutcome(classification, turnKind, message, answerEl, answerLi);
      });
    }).catch(function () {
      // Network failure (fetch itself rejected).
      var networkMessage = 'Network failure — try again.';
      if (turnKind === 'user-initiated') {
        chatHistory.pop();
        showInlineNote(networkMessage);
        questionInput.value = message;
      } else {
        applyCadenceEffect('double');
      }
      settleFailedThinkingRow(answerEl, answerLi, turnKind, networkMessage);
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
      advanceCadence, classifyTurnResponse, parseProposalResult, formatCheckIn, formatSweepNotSeen,
      formatNoCensus,
      applyCadenceEffect, scheduleAutoWake, autoWakeTick, sendTurn, submitQuestion,
      getCadenceState: function () { return cadence; },
      getChatHistory: function () { return chatHistory; },
      CADENCE_BASE_MS: CADENCE_BASE_MS, CADENCE_CAP_MS: CADENCE_CAP_MS, HISTORY_CAP: HISTORY_CAP,
    };
  }
})();
