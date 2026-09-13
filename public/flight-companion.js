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
  // LIN-2716: sessionStorage (never localStorage) keyed by urlKey — survives
  // the reload/tab-eviction scenario the ticket names (mobile OS tab
  // eviction, a link tap and back) without indefinitely accumulating stale
  // threads across days/devices the way a localStorage key would. Mirrors
  // public/app.js's collapse-state persistence pattern (try/catch around
  // JSON parse/stringify, corrupt data or quota errors fall back to a clean
  // default rather than throwing into the page) but keyed per-workspace,
  // unlike that file's single global STORAGE_KEY — one browser visiting two
  // workspaces must not cross-contaminate their companion threads.
  var SESSION_STORAGE_PREFIX = 'flight-companion-session:';

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
    loadPlaybookEmptyState();
  });

  // LIN-2625: the empty state shows the playbook's open promises before you
  // tap anything. Read-only fetch of the small dedicated endpoint
  // (routes/flight-companion.js) — never a write path from this page. A
  // fetch failure or an absent/blank playbook leaves the server-rendered
  // generic empty-state text untouched (the honest "nothing to show yet"
  // case, not an error state worth surfacing).
  function loadPlaybookEmptyState() {
    var el = document.getElementById('flight-companion-chat-empty');
    if (!el || !urlKey) return;
    window.api('/workspace/' + encodeURIComponent(urlKey) + '/api/flight-companion/playbook', { on401: false })
      .then(function (body) {
        var playbook = body && typeof body.playbook === 'string' ? body.playbook.trim() : '';
        if (playbook) el.textContent = '○ ' + playbook;
      })
      .catch(function () { /* leave the generic empty-state text as-is */ });
  }

  // ─── Chat thread (LIN-2435) ─────────────────────────────────────────────

  var thread = document.getElementById('flight-companion-thread');
  var emptyState = document.getElementById('flight-companion-chat-empty');
  var checkInEl = document.getElementById('flight-companion-checkin');
  var questionInput = document.getElementById('flight-companion-question');
  var sendBtn = document.getElementById('flight-companion-send');
  // LIN-2622: the start button (empty state) and the re-orient affordance.
  // Both are optional-guarded, like checkInEl — LIN-2621 (Backlog at the time
  // of writing) owns the actual status strip; #flight-companion-reorient is a
  // deliberately minimal stand-in living next to the existing check-in line
  // rather than a strip this ticket has no business building. Both drive the
  // SAME boot turn.
  var startBtn = document.getElementById('flight-companion-start');
  var reorientBtn = document.getElementById('flight-companion-reorient');
  // LIN-2621: the status strip's "next check-in due" mount — server-rendered
  // as an em-dash placeholder (lib/render-flight-companion.js's
  // renderStatusStrip), since the wake cadence below is this client's own
  // in-memory countdown with no server-side schedule to render at page-load
  // time. Optional-guarded like every other mount here.
  var nextCheckInEl = document.getElementById('flight-companion-strip-next');
  // LIN-2621 beat 3: the strip's running "this tab so far" total — server-
  // rendered with its true initial value (a fresh tab has spent nothing),
  // unlike the next-check-in placeholder above, whose initial value is
  // genuinely unknown at render time. Updated in place on EVERY `done`
  // frame this tab observes, visible or silent (see sendTurn's 'done'
  // handling below) — the whole point being that a silent tick's cost is
  // otherwise invisible nowhere else on the page.
  var tabTotalEl = document.getElementById('flight-companion-strip-tab-total');
  // LIN-2623 beat 3: the per-turn model picker + its rate-card mount —
  // server-rendered (lib/render-flight-companion.js's renderStatusStrip)
  // with a leading, always-selected-by-default EMPTY-value option ("current
  // default") followed by the curated options `resolveTurnModelOverride`
  // (routes/flight-companion.js) accepts. An empty `.value` means "no
  // override" — never resolved to some other curated id client-side, so an
  // untouched picker cannot silently swap the workspace's real (possibly
  // uncurated) default for a curated stand-in. Optional-guarded like every
  // other strip mount here.
  var modelSelectEl = document.getElementById('flight-companion-model-select');
  var modelPriceEl = document.getElementById('flight-companion-model-price');

  if (!thread || !questionInput || !sendBtn) return;

  var chatHistory = [];
  var inFlight = false;
  var cadence = { delayMs: CADENCE_BASE_MS, stopped: false };
  var timerId = null;
  // LIN-2771: the delay the currently-armed timer was scheduled with. Tracks
  // timerId so the persisted wall-clock anchor (and finishTurn's re-save) can
  // name the ACTUAL armed delay — on the load-time resume path the armed
  // delay is the remaining time, not cadence.delayMs (the backoff length).
  var timerDelayMs = null;
  // LIN-2621 beat 3 called this "per-tab, in-memory only — deliberately not
  // persisted across a reload" — LIN-2716 reverses that: these two now
  // round-trip through saveStoredSession/loadStoredSession (see finishTurn
  // and the rehydrate-on-load block below) alongside chatHistory, since a
  // resumed tab needs its running total to stay honest, not reset to zero.
  var tabCheckInCount = 0;
  var tabTotalCost = 0;
  // LIN-2632: an auto-wake tick's "checking in…" placeholder (set at
  // sendTurn's start) snapshots whatever the status line showed before it,
  // so finishTurn can restore that exact prior state if the turn ends
  // without anything more specific to say (see finishTurn below). At most
  // one turn is ever in flight (the `inFlight` guard above), so a single
  // module-level slot is safe — never overwritten mid-turn.
  var checkingInSnapshot = null;
  var CHECKING_IN_TEXT = 'checking in…';
  // LIN-2718: whether the composer's input held focus at the moment a
  // user-initiated turn began — captured before setComposerBusy(true) runs
  // (disabling the input blurs it, so this must be read first). Read once,
  // in finishTurn, to decide whether that turn's completion may restore
  // focus. Never set for 'boot'/'auto-wake' turns, which never restore focus
  // regardless. Module-level like checkingInSnapshot above, for the same
  // reason: the inFlight guard makes at most one turn's slot live at a time.
  var questionHadFocusAtTurnStart = false;
  // LIN-2717 F5: set immediately around finishTurn's caret-restore
  // `questionInput.focus()` call so the mobile reveal listener below can
  // tell that restore apart from a human tap — both fire the same `focus`
  // event. Cleared right after the call (not in a `finally`, since `.focus()`
  // is synchronous and never throws), so a genuine tap microseconds later
  // is unaffected.
  //
  // CAUTION (LIN-2717 ledger L10): the name reads general, but this is set at
  // exactly ONE call site — finishTurn's restore. Any NEW programmatic
  // `.focus()` on this composer (LIN-1578's shared composer is the obvious
  // candidate) must set it too, or F5 silently returns with nothing going red:
  // the e2e witness only drives the finishTurn path.
  var restoringFocusProgrammatically = false;

  // ─── Pure helpers (exposed via the test seam at the bottom — no DOM) ────

  // LIN-2771: the wall clock the cadence anchor is stamped against. A module
  // function (defaulting to Date.now) rather than a bare Date.now() call at
  // each anchor site, so unit tests can pin the clock deterministically via
  // the exported setNowFn seam below — the anchors and the resume arithmetic
  // are wall-clock, never elapsed-time guesses. formatNextCheckIn keeps its
  // OWN injected nowMs argument, unchanged.
  var nowFn = null;
  function now() {
    return typeof nowFn === 'function' ? nowFn() : Date.now();
  }

  function capHistory(history, cap) {
    cap = cap || HISTORY_CAP;
    if (history.length > cap) history.splice(0, history.length - cap);
    return history;
  }

  // LIN-2716: the session-persistence helper. Keyed by urlKey (never a bare
  // constant — see SESSION_STORAGE_PREFIX's own comment above).
  function sessionStorageKey(urlKeyArg) {
    return SESSION_STORAGE_PREFIX + urlKeyArg;
  }

  function emptyStoredSession() {
    return { history: [], tabCheckInCount: 0, tabTotalCost: 0, selectedModel: null, cadence: null };
  }

  // Never throws into the page: a missing entry, a JSON.parse failure, and
  // well-formed JSON of the wrong shape all degrade to the SAME clean empty
  // session — corrupt/malformed storage is exactly as safe as no storage at
  // all, never a half-restored or crashing page. `history` is re-capped on
  // the way IN too (not just on the way out in saveStoredSession below), so
  // a hand-edited or pre-cap stored blob can never bypass HISTORY_CAP either
  // direction. Deliberately does NOT persist/restore a token or the +proxy
  // block — the stored shape has no field for either, by construction.
  function loadStoredSession(urlKeyArg) {
    try {
      var raw = sessionStorage.getItem(sessionStorageKey(urlKeyArg));
      if (!raw) return emptyStoredSession();
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.history)) return emptyStoredSession();
      var history = parsed.history.filter(function (turn) {
        return turn && typeof turn.role === 'string' && typeof turn.content === 'string';
      });
      capHistory(history);
      var tabCheckInCount = typeof parsed.tabCheckInCount === 'number' && isFinite(parsed.tabCheckInCount) ? parsed.tabCheckInCount : 0;
      var tabTotalCost = typeof parsed.tabTotalCost === 'number' && isFinite(parsed.tabTotalCost) ? parsed.tabTotalCost : 0;
      // LIN-2623 beat 3: the picker's own persisted choice, round-tripped
      // through the SAME sessionStorage blob as history/totals — a non-empty
      // string or nothing at all; anything else (a hand-edited or stale
      // shape) degrades to "no override", same as a fresh session.
      var selectedModel = typeof parsed.selectedModel === 'string' && parsed.selectedModel ? parsed.selectedModel : null;
      // LIN-2771: the wake-cadence record. Validated just like the fields
      // above — a hand-edited or stale shape degrades to `null` (today's
      // "no cadence persistence" behaviour) rather than half-restoring a
      // broken anchor. `delayMs` must be a finite number (the backoff
      // length); `nextFireAt` a finite number (a pending wall-clock anchor)
      // or null (no timer armed). `stoppedReason` is LIN-2771 beat 3 — a
      // non-empty string naming why the cadence stopped, or null/absent when
      // it is not stopped (an old blob without it loads as not-stopped).
      var cadence = null;
      if (parsed.cadence && typeof parsed.cadence === 'object'
        && typeof parsed.cadence.delayMs === 'number' && isFinite(parsed.cadence.delayMs)
        && (parsed.cadence.nextFireAt === null
          || (typeof parsed.cadence.nextFireAt === 'number' && isFinite(parsed.cadence.nextFireAt)))) {
        cadence = {
          delayMs: parsed.cadence.delayMs,
          nextFireAt: parsed.cadence.nextFireAt,
          stoppedReason: typeof parsed.cadence.stoppedReason === 'string' && parsed.cadence.stoppedReason ? parsed.cadence.stoppedReason : null,
        };
      }
      return { history: history, tabCheckInCount: tabCheckInCount, tabTotalCost: tabTotalCost, selectedModel: selectedModel, cadence: cadence };
    } catch (e) {
      return emptyStoredSession();
    }
  }

  // Swallows a throwing storage.setItem (quota exceeded, private-browsing
  // lockdown) — a failed save just means the NEXT reload starts fresh; it
  // must never throw into the turn-completion path that calls this.
  function saveStoredSession(urlKeyArg, session) {
    try {
      var history = capHistory((session.history || []).slice());
      sessionStorage.setItem(sessionStorageKey(urlKeyArg), JSON.stringify({
        history: history,
        tabCheckInCount: session.tabCheckInCount || 0,
        tabTotalCost: session.tabTotalCost || 0,
        selectedModel: session.selectedModel || null,
        // LIN-2771: cadence is part of the same blob. A caller that omits it
        // (every pre-existing call site) writes null, preserving today's
        // shape — the anchor is written by persistCadence, never by accident.
        cadence: session.cadence || null,
      }));
    } catch (e) {
      // Nothing to do — the in-memory state stays authoritative for this tab.
    }
  }

  // LIN-2771: the cadence record as it should be persisted RIGHT NOW — the
  // backoff length plus a wall-clock anchor derived from the ACTUALLY-armed
  // delay (`timerDelayMs`, which on the load-time resume path is the
  // remaining time, not cadence.delayMs). `nextFireAt` is null when no timer
  // is armed (stopped, hidden, or between ticks), which is exactly the
  // "no anchor" case loadStoredSession's resume logic treats as "start as
  // today".
  function currentCadenceRecord() {
    return {
      delayMs: cadence.delayMs,
      nextFireAt: timerId ? now() + timerDelayMs : null,
      // LIN-2771 beat 3: while stopped, the record carries WHY (so a reload
      // can decide whether to re-arm); while running it is null.
      stoppedReason: cadence.stopped ? (cadence.stoppedReason || null) : null,
    };
  }

  // LIN-2771: merge ONLY the cadence record into the stored blob (a
  // load-modify-save, so history/totals already in storage are never
  // clobbered by in-memory state that may be mid-settle — this runs from
  // scheduleAutoWake, which fires during a turn too). Called on every arm so
  // a reload mid-window sees the live anchor.
  function persistCadence() {
    if (!urlKey) return;
    var session = loadStoredSession(urlKey);
    session.cadence = currentCadenceRecord();
    saveStoredSession(urlKey, session);
  }

  // LIN-2771 beat 3: whether a cadence stopped for `stoppedReason` should
  // re-arm on a freshly-rendered page. Pure so the decision is unit-testable.
  // The rule: re-arm when the reason can be shown to no longer hold, or when
  // it cannot be checked at all (the first auto-wake re-detects and re-stops
  // if the condition actually persists — the cheap path). Keep stopped only
  // when the page can still show the reason holds.
  //
  // `aiConfigured` is the page's own `data-fc-ai-configured` value ('true'/
  // 'false'/absent), which the renderer emits from the route's key-resolution
  // — the ONE reason the page can genuinely still show holds (the page
  // renders whether or not AI is configured).
  function shouldReArmOnLoad(stoppedReason, aiConfigured) {
    if (stoppedReason === 'ai-not-configured') {
      // The page can show this still holds: keep stopped only when it
      // explicitly says AI is not configured; anything else (including an
      // absent attribute) means "may have cleared" → re-arm.
      return aiConfigured !== 'false';
    }
    // session-expired and flag-off cannot survive onto a rendered page — a
    // 401 never renders the page, and the page redirects to /settings when
    // the flag is off — so they no longer hold. Any unknown reason cannot be
    // checked; treat it as may-have-cleared too.
    return true;
  }

  // General-purpose helper: removes the stored session outright. LIN-2716
  // originally wired this into reorientClick to give reorient a "clear
  // storage" job on a fresh-start premise; John's ruling (LIN-2770) withdrew
  // that — reorient is not a fresh start, so nothing calls this today (see
  // reorientClick below). Left in place, and still covered by its own unit
  // tests, as the primitive a later deliberate "start a fresh session"
  // affordance would reach for. Swallows a throwing storage.removeItem for
  // the same reason saveStoredSession swallows setItem.
  function clearStoredSession(urlKeyArg) {
    try {
      sessionStorage.removeItem(sessionStorageKey(urlKeyArg));
    } catch (e) {
      // ignore
    }
  }

  function nextCadenceDelay(currentDelayMs) {
    return Math.min(currentDelayMs * 2, CADENCE_CAP_MS);
  }

  // LIN-2621 beat 3: format a USD amount for display. Mirrors lib/render-
  // settings.js's own formatCost (the settings page's AI usage KPI tree) —
  // same house rule (small per-call amounts keep 4 decimals; a larger total
  // rounds to 2) — restated here rather than imported, since this file is a
  // browser IIFE with no module graph to lib/, the same reason every other
  // vocabulary/prefix restatement in this codebase exists.
  function formatCost(cost) {
    var n = (typeof cost === 'number' && isFinite(cost)) ? cost : 0;
    return '$' + n.toFixed(n > 0 && n < 1 ? 4 : 2);
  }

  // A single turn's meta line: tokens and cost, read straight off the final
  // `done` frame's `usage` (lib/openrouter.js's extractUsage shape —
  // `{prompt_tokens, completion_tokens, total_tokens, cost}`). Renders
  // exactly what the frame carries — no hedging, no caveat about a
  // tool-using turn's usage being under-reported today (that gap is
  // lib/openrouter.js's, out of this ticket's scope per beat 1's finding;
  // this plumbing is correct for whatever usage arrives and becomes
  // accurate for free once that lands). Returns '' when there is nothing
  // usable to show, so a turn with no usage at all renders no meta line —
  // never a fabricated "0 tokens · $0.00".
  function formatTurnMeta(usage) {
    if (!usage || typeof usage !== 'object') return '';
    var tokens = null;
    if (typeof usage.total_tokens === 'number' && isFinite(usage.total_tokens)) {
      tokens = usage.total_tokens;
    } else {
      var p = typeof usage.prompt_tokens === 'number' && isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0;
      var c = typeof usage.completion_tokens === 'number' && isFinite(usage.completion_tokens) ? usage.completion_tokens : 0;
      if (p || c) tokens = p + c;
    }
    var hasCost = typeof usage.cost === 'number' && isFinite(usage.cost);
    if (tokens === null && !hasCost) return '';
    var parts = [];
    if (tokens !== null) parts.push(tokens.toLocaleString() + ' tokens');
    if (hasCost) parts.push(formatCost(usage.cost));
    return parts.join(' · ');
  }

  // LIN-2621 beat 4: the strip's running "this tab so far" total. The
  // ticket's own template ("N check-ins · $x this tab") is a format sketch,
  // not a byte-pinned string (unlike the mode line) — pluralised properly
  // (1 check-in, 2 check-ins), everything else unchanged.
  function formatTabTotal(count, cost) {
    return count + (count === 1 ? ' check-in' : ' check-ins') + ' · ' + formatCost(cost) + ' this tab';
  }

  // The reset criterion (ruling 62bb3b4e): a user-initiated `done` always
  // resets, unconditional of `surface` (which never appears on that frame
  // anyway). An auto-wake `done` resets only when the route's gate marked
  // this spend `surface:true`; the narrow `surface:false` seed-turn edge
  // case still renders/records normally but doubles, same as "nothing to
  // report". LIN-2622: a boot `done` resets exactly like a user-initiated
  // one — a boot is exactly as human-initiated as typing, and the ticket's
  // own acceptance is "reset the wake cadence on done ONLY", never on the
  // error/disconnect paths below (see settleFailedThinkingRow's widened
  // guard and every failure branch in handleNonStreamOutcome, none of which
  // apply any cadence effect to a boot turn at all — left exactly where it
  // was, which is what "not on error, not on disconnect" means here).
  function doneCadenceEffect(turnKind, surface) {
    if (turnKind === 'user-initiated' || turnKind === 'boot') return 'reset';
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
  function advanceCadence(state, effect, reason) {
    if (state.stopped) return state;
    if (effect === 'stop') return { delayMs: state.delayMs, stopped: true, stoppedReason: reason || null };
    if (effect === 'reset') return { delayMs: CADENCE_BASE_MS, stopped: false, stoppedReason: null };
    if (effect === 'double') return { delayMs: nextCadenceDelay(state.delayMs), stopped: false, stoppedReason: null };
    return state;
  }

  // LIN-2621: the strip's "next check-in due" text for a countdown of
  // `delayMs` starting now. Injected `nowMs` for deterministic tests — the
  // wall-clock time is a genuine prediction (the client's own cadence timer),
  // never a duration, since that is what the strip's other fields ("last
  // check-in") are already stamped as.
  function formatNextCheckIn(delayMs, nowMs) {
    var due = new Date((typeof nowMs === 'number' ? nowMs : Date.now()) + delayMs);
    return 'next check-in: ' + due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  // LIN-2621 beat 4: `list_pending_decisions`' tool result (lib/chat-tools.js's
  // `projectPendingDecision` shape: `{count, truncated, decisions: [{decisionId,
  // question, options: [{id,label}], recommended, disposition, canReply,
  // loopId, issueIdentifier, ...}]}`), parsed with the SAME defensive posture
  // as parseProposalResult above — a truncated/malformed payload fails
  // JSON.parse or the shape check honestly, never throws uncaught. A row
  // missing `decisionId` or a non-array `options` is dropped rather than
  // rendered half-built; `appendOptions` (public/chat.js) already drops any
  // individual malformed OPTION the same way, one level down.
  function parseDecisionsResult(resultString) {
    try {
      var parsed = JSON.parse(resultString);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.decisions)) return { ok: false };
      var decisions = parsed.decisions.filter(function (d) {
        return d && typeof d.decisionId === 'string' && d.decisionId && Array.isArray(d.options);
      });
      return { ok: true, decisions: decisions };
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

  // LIN-2622: the start button and the re-orient affordance are a
  // complementary pair, never shown together — start makes sense only while
  // there is nothing to re-orient FROM, and once the thread has content a
  // second "start" reads as a lie (nothing about the fleet is starting).
  function setEmptyVisible(visible) {
    if (emptyState) emptyState.classList.toggle('hidden', !visible);
    if (startBtn) startBtn.classList.toggle('hidden', !visible);
    if (reorientBtn) reorientBtn.classList.toggle('hidden', visible);
  }

  // LIN-2718: a dumb toggle only — turn-kind gating lives at each call site
  // (sendTurn locks, finishTurn releases), never here. Only a user-initiated
  // or boot turn may call this with `true`; an auto-wake tick must never
  // reach it at all, in either direction — disabling the focused input is
  // what blurs it and, on mobile, dismisses the keyboard mid-sentence.
  function setComposerBusy(busy) {
    questionInput.disabled = busy;
    sendBtn.disabled = busy;
    if (startBtn) startBtn.disabled = busy;
    if (reorientBtn) reorientBtn.disabled = busy;
  }

  // LIN-2717: auto-grow the composer to its CSS-owned cap (flight-companion.css
  // .fc-composer-input max-height). REV 2 / plan-review finding 1: the guard is
  // case-INSENSITIVE by design. The prototype's verbatim `tagName !== 'TEXTAREA'`
  // is correct in a browser (HTML tagName is always upper-case) but unreachable
  // in the unit seam, whose FakeElement uses the file's lower-case tag
  // convention — so the guard would early-return on every unit call and U9
  // would pass for the wrong reason. Upper-casing costs nothing in production
  // and keeps the seam idiomatic. See tests/unit/flight-companion-client.test.js.
  function resizeComposer() {
    if (!questionInput || String(questionInput.tagName).toUpperCase() !== 'TEXTAREA') return;
    questionInput.style.height = 'auto';
    // `chrome` = border width. With box-sizing: border-box, height:H means
    // border+padding+content = H, but scrollHeight includes padding and
    // EXCLUDES border — writing scrollHeight alone would under-size by the
    // border width and leave a permanent 2px scrollbar. Deriving it from the
    // two live metrics keeps this correct if the border is ever retuned.
    // One imprecision, accepted: while still overflow-y: auto from a prior
    // capped state, `chrome` also absorbs the scrollbar width and over-sizes
    // by ~15px for a single frame; the CSS max-height bounds it either way.
    var chrome = questionInput.offsetHeight - questionInput.clientHeight;
    questionInput.style.height = (questionInput.scrollHeight + chrome) + 'px';
    questionInput.style.overflowY =
      questionInput.scrollHeight > questionInput.clientHeight ? 'auto' : 'hidden';
  }

  // LIN-2717: the single chokepoint for every programmatic `.value` write.
  // Assigning `.value` directly fires no `input` event, so an auto-grow bound
  // only to `input` would leave the box stuck tall after a send-clear and
  // mis-sized after a draft restore. All seven programmatic write sites route
  // through here instead of assigning `.value` directly.
  function setComposerValue(v) { questionInput.value = v; resizeComposer(); }

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

  // LIN-2621 beat 3: the visible turn's own meta line — tokens and cost, read
  // from the final `done` frame's `usage`. Appended as a page-local `.fc-msg-
  // meta` span inside the bubble's own surface (a sibling after the text
  // node), the same namespaced-addition convention `.fc-proposal*`/`.fc-obs-
  // *` already use elsewhere in this file rather than reusing chat.css's
  // `.chat-msg__time` — that class is documented there as specifically for
  // row/log-style layouts (Collective), not the stacked-bubble column this
  // page uses, so repurposing it would be forcing an unrelated house style
  // rather than following one. No new chat.css rule; flight-companion.css
  // owns `.fc-msg-meta` alongside its other `.fc-*` bubble sub-components.
  function appendTurnMeta(answerEl, usage) {
    if (!answerEl || !answerEl.parentNode) return;
    var text = formatTurnMeta(usage);
    if (!text) return;
    var meta = document.createElement('span');
    meta.className = 'fc-msg-meta';
    meta.textContent = text;
    answerEl.parentNode.appendChild(meta);
  }

  function updateTabTotalDisplay() {
    if (!tabTotalEl) return;
    tabTotalEl.textContent = formatTabTotal(tabCheckInCount, tabTotalCost);
  }

  // LIN-2623 beat 3: mirrors lib/render-settings.js's own inline model-select
  // updater byte-for-byte in idiom — the selected <option>'s own `data-
  // pricing` attribute (server-rendered, never fabricated client-side) is
  // the ONLY source for this text, so a model with no known rate renders the
  // SAME `—` fallback the server itself would have rendered for it.
  function updateModelPriceDisplay() {
    if (!modelSelectEl || !modelPriceEl) return;
    var opt = modelSelectEl.options && modelSelectEl.options[modelSelectEl.selectedIndex];
    modelPriceEl.textContent = (opt && opt.getAttribute && opt.getAttribute('data-pricing')) || '—';
  }

  if (modelSelectEl) {
    modelSelectEl.addEventListener('change', function () {
      updateModelPriceDisplay();
      // Persisted immediately (not only at the next finishTurn) so a pick
      // survives a reload even before the human sends anything with it —
      // "the selection persists across a reload" (LIN-2623 beat 3) reads as
      // a property of the CHOICE, not of having already sent a turn with it.
      if (urlKey) {
        saveStoredSession(urlKey, {
          history: chatHistory, tabCheckInCount: tabCheckInCount, tabTotalCost: tabTotalCost,
          selectedModel: modelSelectEl.value,
        });
      }
    });
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
          // LIN-2771 beat 3: this 403 is the flag-off class ("Flight Companion
          // is disabled") — record it so a reload re-arms once the flag is
          // back on, instead of freezing the cadence forever.
          applyCadenceEffect('stop', 'flag-off');
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

  // LIN-2621 beat 4: a waiting-on-you decision, rendered as the SAME option-
  // button row the rulings tab uses (public/chat.js's window.ChatUI.
  // appendOptions — composed here, never forked: no new CSS rule, no copied
  // button markup). `renderDecisions` handles the tool result's `decisions`
  // array; `renderOneDecision` builds one row.
  //
  // A tap answers through `window.ReplyDelivery.postComment` ONLY — never
  // `deliverReply` (which also resumes/dispatches a run for a `resumable`/
  // `gone` disposition on the rulings tab). That is a deliberately NARROWER
  // write surface than rulings has: a human click posting a comment through
  // the existing session-auth reply path is exactly the write posture
  // Flight Companion already has (LIN-2434's approve card), so no new one is
  // introduced; starting/resuming a run from here would be, so it never
  // happens from this control regardless of disposition.
  function renderDecisions(resultString, beforeLi) {
    var parsed = parseDecisionsResult(resultString);
    if (!parsed.ok) {
      showInlineNote('The companion checked pending decisions, but the details were too long to show in full.', beforeLi);
      return;
    }
    // Nothing pending: the model's own prose says so — no dead UI to add.
    parsed.decisions.forEach(function (decision) {
      renderOneDecision(decision, beforeLi);
    });
  }

  function renderOneDecision(decision, beforeLi) {
    var wrap = document.createElement('div');
    wrap.className = 'fc-decision';

    if (decision.question) {
      var q = document.createElement('p');
      q.className = 'fc-decision-question';
      // Model/task-authored text — textContent only.
      q.textContent = decision.question;
      wrap.appendChild(q);
    }

    var feedback = document.createElement('span');
    feedback.className = 'fc-decision-feedback';

    // Reused verbatim: the rulings tab's own option-button row primitive.
    // `disposition` alone decides interactive vs. read-only inside
    // appendOptions via the SAME allow-list `canReplyFor` (lib/unanswered-
    // decisions.js) computes `decision.canReply` from — the two predicates
    // are structurally identical, so they cannot disagree for a row this
    // tool actually produced. `resolved`/`replying` guard against a double
    // tap firing two posts for the same row.
    var resolved = false;
    window.ChatUI.appendOptions(wrap, {
      options: decision.options,
      recommended: decision.recommended,
      disposition: decision.disposition,
      onSelect: function (optionId, optionLabel) {
        // Second, structural guard (mirrors public/observation.js's rulings
        // row handler) — belt-and-braces alongside appendOptions' own
        // disposition-driven readOnly branch, which already omits buttons
        // entirely for a non-interactive disposition.
        if (!decision.canReply || resolved) return;
        resolved = true;
        // `.children` of the shared row rather than querySelectorAll (not
        // part of this codebase's minimal DOM-shim surface, see
        // tests/unit/flight-companion-client.test.js's own header) — every
        // child of `.chat-options-row` is one option button, by
        // appendOptions' own construction (public/chat.js).
        var optionsRow = wrap.querySelector('.chat-options-row');
        var buttons = optionsRow ? Array.prototype.slice.call(optionsRow.children) : [];
        buttons.forEach(function (b) { b.disabled = true; });
        feedback.textContent = 'Replying…';

        // Loop-anchored (resumable/gone): both fields the comment route
        // needs for a best-effort `markDecisionAnswered` stamp are present
        // in this tool's own projection. Task-bound: the tool now projects
        // the raw issue UUID and the scan store's own record id
        // (lib/chat-tools.js's `projectPendingDecision`), so the same
        // best-effort stamp pair reaches `taskDecisionsStore.markOutcome`,
        // mirroring public/observation.js's rulings-tab task-bound branch.
        var extra = decision.loopId
          ? { decisionLoopId: decision.loopId, decisionId: decision.decisionId }
          : { taskDecisionId: decision.taskDecisionId, taskDecisionIssueId: decision.issueId };

        window.ReplyDelivery.postComment(urlKey, decision.issueId || decision.issueIdentifier, optionLabel, extra)
          .then(function (commentResult) {
            if (!commentResult.ok) {
              var status = commentResult.status;
              var message = (commentResult.data && commentResult.data.error) || ('HTTP ' + status);
              if (status >= 400 && status < 500) {
                // Terminal client error — leave the row disabled; retrying
                // the same request would only fail the same way.
                feedback.textContent = message;
              } else {
                // 5xx — retryable.
                resolved = false;
                buttons.forEach(function (b) { b.disabled = false; });
                feedback.textContent = message + ' — try again.';
              }
              return;
            }
            feedback.textContent = 'Replied ✓';
            wrap.classList.add('fc-decision--resolved');
          })
          .catch(function () {
            // Network failure — retryable.
            resolved = false;
            buttons.forEach(function (b) { b.disabled = false; });
            feedback.textContent = 'Network failure — try again.';
          });
      },
    });
    wrap.appendChild(feedback);

    var li = document.createElement('li');
    li.className = 'chat-msg fc-decision-msg';
    li.appendChild(wrap);
    if (beforeLi && beforeLi.parentNode === thread) thread.insertBefore(li, beforeLi);
    else thread.appendChild(li);
    thread.hidden = false;
    thread.scrollTop = thread.scrollHeight;
    setEmptyVisible(false);
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
      // LIN-2621 beat 4: additive to the ordinary breadcrumb settle above —
      // `list_pending_decisions` is a plain read-only tool with no server-
      // side phase relabel (unlike send_follow_up's 'proposed'), so this
      // branches on the tool's own name within 'result' rather than a
      // second phase value.
      if (data.name === 'list_pending_decisions') renderDecisions(data.result, beforeLi);
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
    timerDelayMs = delayMs;
    // LIN-2771: persist the wall-clock anchor at the moment the timer is
    // armed, so a reload mid-window resumes from it rather than restarting
    // the full wait. `delayMs` here is the ACTUAL armed delay (on the
    // load-time resume path that is the remaining time), which is why the
    // record is built from timerDelayMs, not from cadence.delayMs.
    persistCadence();
    // LIN-2621: every place that arms the shared timer is a new "next
    // check-in" prediction — updating it here, in the one place the timer is
    // actually armed, covers every caller (initial load, a cadence effect,
    // the in-flight retry branch, and visibility resume) without repeating
    // the call at each site.
    if (nextCheckInEl) nextCheckInEl.textContent = formatNextCheckIn(delayMs);
  }

  // Apply a cadence effect AND (unless stopped/hidden) reschedule the
  // shared timer using the new delay — this is what makes a user-initiated
  // reset actually move the auto-wake's next firing to send+30s, not just
  // change a value the next tick happens to read later.
  function applyCadenceEffect(effect, reason) {
    cadence = advanceCadence(cadence, effect, reason);
    if (cadence.stopped) {
      if (timerId) { clearTimeout(timerId); timerId = null; timerDelayMs = null; }
      // LIN-2771: no timer is armed — the stored anchor must say so, or a
      // reload would resume a wake the stopped cadence had cancelled. The
      // stop REASON itself is beat 3's half of this ticket; here the record
      // simply drops the anchor so a reload starts as today.
      persistCadence();
      if (nextCheckInEl) nextCheckInEl.textContent = 'next check-in: —';
      return;
    }
    if (document.hidden) {
      // Paused — no eager scheduling while hidden; resumed by
      // visibilitychange below, at the (possibly just-updated) delay.
      if (timerId) { clearTimeout(timerId); timerId = null; timerDelayMs = null; }
      // LIN-2771: hidden means no timer is armed — the anchor is cleared so
      // a reload of a hidden tab starts as today rather than resuming a wait
      // that was never ticking.
      persistCadence();
      if (nextCheckInEl) nextCheckInEl.textContent = 'next check-in: —';
      return;
    }
    scheduleAutoWake(cadence.delayMs);
  }

  function autoWakeTick() {
    timerId = null;
    timerDelayMs = null;
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

  function finishTurn(turnKind) {
    inFlight = false;
    // LIN-2716: persist AFTER every non-boot turn settles — by the time
    // finishTurn runs, chatHistory/tabCheckInCount/tabTotalCost already
    // reflect the turn's final outcome on every exit path (the 'done'
    // handler's push-and-cap, an error/non-stream/network-failure branch's
    // chatHistory.pop(), or an auto-wake silent tick's counter-only bump),
    // so this ONE call site covers all of them — no need to save separately
    // at each mutation site. `turnKind !== 'boot'` is deliberate, not an
    // oversight: a boot's own orientation exchange (whether from the empty-
    // state Start button or from reorient) is never itself written to
    // storage — a human who clicks Start/reorient and reloads before any
    // further turn sees storage as of the last ordinary turn, not the boot
    // narration. This is independent of reorient's own storage handling
    // (see reorientClick below, and LIN-2770/John's ruling that reorient is
    // not a fresh start): the very next ordinary turn still serialises the
    // WHOLE chatHistory, boot exchange included, so the continuing
    // conversation is never lost — only the boot turn's own bubble is
    // absent from storage until a later turn carries it along.
    if (urlKey && turnKind !== 'boot') {
      saveStoredSession(urlKey, {
        history: chatHistory, tabCheckInCount: tabCheckInCount, tabTotalCost: tabTotalCost,
        selectedModel: modelSelectEl ? modelSelectEl.value : null,
        // LIN-2771: carry the current cadence record through this full-blob
        // save so it never silently drops the anchor the last schedule wrote.
        cadence: currentCadenceRecord(),
      });
    }
    // LIN-2718: release the lock only for the turn kinds that took it —
    // an auto-wake tick never called setComposerBusy(true), so it must never
    // call it with `false` either (that would still be touching the
    // composer's disabled state on a background tick, the thing this ticket
    // removes). Restore focus ONLY after a user-initiated turn, and only if
    // the input held it when that turn began — never on boot (a click, not
    // a caret, started it) and never on a wake (this branch is unreachable
    // there in the first place).
    if (turnKind === 'user-initiated' || turnKind === 'boot') {
      setComposerBusy(false);
    }
    if (turnKind === 'user-initiated' && questionHadFocusAtTurnStart) {
      restoringFocusProgrammatically = true;
      questionInput.focus();
      restoringFocusProgrammatically = false;
    }
    questionHadFocusAtTurnStart = false;
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
  // LIN-2622: a boot turn gets the SAME eager bubble (it renders as a
  // user-initiated turn — see sendTurn below), so it needs the same
  // settling on every failure exit; the button must never strand the UI in
  // a permanent in-progress state (LIN-2443's "pill stuck in-progress" is
  // exactly the landed failure shape this guards against).
  function settleFailedThinkingRow(answerEl, answerLi, turnKind, message) {
    if ((turnKind !== 'user-initiated' && turnKind !== 'boot') || !answerLi) return;
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
        //
        // LIN-2622: a BOOT can also land here — its own reservation can lose
        // a race (an overlapping auto-wake) or hit a backend fault, and the
        // route answers that with the SAME plain `{spent:false}` JSON shape.
        // That is not "the companion checked and found nothing" the way an
        // auto-wake's silent tick is — a human just clicked Start and is
        // owed an honest answer, not a silently-refreshed status line — so
        // it is handled first and never falls through to the shared
        // auto-wake branches below.
        if (turnKind === 'boot') {
          chatHistory.pop();
          settleMessage = 'That did not go through — try again in a moment.';
          break;
        }
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
        applyCadenceEffect('stop', 'session-expired');
        if (turnKind === 'user-initiated' || turnKind === 'boot') {
          chatHistory.pop();
          if (turnKind === 'user-initiated') setComposerValue(sentMessage);
        }
        break;
      case 'flag-off':
        showInlineNote(classification.message);
        applyCadenceEffect('stop', 'flag-off');
        if (turnKind === 'user-initiated' || turnKind === 'boot') {
          chatHistory.pop();
          if (turnKind === 'user-initiated') setComposerValue(sentMessage);
        }
        break;
      case 'message-too-long':
        // user-initiated only — structurally unreachable for a boot (the
        // boot route never reads a body message at all, so it validates
        // nothing that could produce this classification).
        chatHistory.pop();
        showInlineNote(classification.message);
        setComposerValue(sentMessage);
        break;
      case 'ai-not-configured':
        showInlineNote(classification.message);
        if (turnKind === 'auto-wake') {
          applyCadenceEffect('stop', 'ai-not-configured');
        } else {
          chatHistory.pop();
          if (turnKind === 'user-initiated') setComposerValue(sentMessage);
        }
        break;
      case 'free-tier-limit':
        // Reachable by both a user-initiated turn and a boot (LIN-2622: a
        // boot charges the free tier and 429s exactly like a typed turn) —
        // the auto-wake equivalent is the silent gate-silent row above, a
        // distinct code path.
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
          if (turnKind === 'user-initiated') setComposerValue(sentMessage);
        }
        break;
    }
    settleFailedThinkingRow(answerEl, answerLi, turnKind, settleMessage);
    finishTurn(turnKind);
  }

  function sendTurn(message, turnKind) {
    inFlight = true;
    // LIN-2718: only a user-initiated or boot turn locks the composer — an
    // auto-wake tick must never disable the input or move focus (that is
    // the root cause this ticket fixes: disabling a focused element blurs
    // it, and on mobile that collapses the keyboard mid-sentence). The
    // `inFlight` guard above stays the sole mutual-exclusion mechanism
    // regardless of turn kind — it is never expressed via `disabled`.
    // Read focus state BEFORE locking (disabling blurs it, so this must
    // run first) — only meaningful for 'user-initiated'; a boot's turn
    // never restores focus on completion either way.
    if (turnKind === 'user-initiated') {
      questionHadFocusAtTurnStart = document.activeElement === questionInput;
    }
    if (turnKind === 'user-initiated' || turnKind === 'boot') {
      setComposerBusy(true);
    }

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
    // at stream open. LIN-2718: the composer is disabled via setComposerBusy
    // ONLY for a user-initiated/boot turn (never for auto-wake, which never
    // touches it), so a user turn still has that feedback during the
    // pre-first-token wait. For a user-initiated turn specifically, this is
    // called EAGERLY below (before the fetch even goes out) rather than
    // waited on — so by the time the first token/tool event actually
    // arrives, this is already a no-op that returns the existing bubble.
    function ensureAssistantBubble() {
      if (!answerEl) {
        answerEl = appendAssistantBubble();
        answerEl.classList.add('chat-cursor');
        answerLi = answerEl.closest('li');
      }
      return answerEl;
    }

    // LIN-2622: a boot renders exactly like a user-initiated turn — the
    // human clicked Start (or re-orient), and deserves to see what they
    // asked for rather than a turn appearing from nowhere — it just posts
    // to a different endpoint below and carries a fixed message rather than
    // whatever the composer held.
    if (turnKind === 'user-initiated' || turnKind === 'boot') {
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

    var priorHistory = (turnKind === 'user-initiated' || turnKind === 'boot') ? chatHistory.slice(0, -1) : chatHistory.slice();
    var body = { history: priorHistory };
    // LIN-2622: a boot never sends `message` — the server hardcodes its own
    // turn content and never reads a client-supplied one for this endpoint
    // (LIN-2432's "never client-asserted" rule, extended here); sending it
    // anyway would suggest the client's text is what the model actually saw.
    if (message && turnKind !== 'boot') body.message = message;
    // LIN-2623 beat 3: the picker's choice rides only a user-initiated turn
    // — never boot (its own endpoint never reads `model` either, matching
    // the "never client-asserted" posture above) and never auto-wake (an
    // unattended tick has no human choice to carry). An empty `.value`
    // (the always-present "current default" option) sends no `model` field
    // at all, so beat 1's `resolveAiOperationModel` decides exactly as it
    // did before this picker existed.
    if (turnKind === 'user-initiated' && modelSelectEl && modelSelectEl.value) {
      body.model = modelSelectEl.value;
    }
    // LIN-2622: a boot posts to its own endpoint, never `/turn` — the turn
    // kind is endpoint-selected, not body-selected, so the client's choice
    // of URL is the ONLY thing that distinguishes a boot from here on.
    var endpoint = turnKind === 'boot' ? 'boot' : 'turn';

    // Raw fetch carve-out: this response may be a Server-Sent Events stream
    // consumed via the reader below; window.api() parses the body as JSON
    // and would break streaming — the non-stream branch reads the body
    // itself instead.
    fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/flight-companion/' + endpoint, {
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
              // Raw Markdown goes into chatHistory FIRST — the render below is
              // display-only and never touches what gets sent back to the
              // model or saved to a transcript (LIN-2670).
              chatHistory.push({ role: 'assistant', content: answerText });
              capHistory(chatHistory);
              // LIN-2670: swap the streamed raw text for rendered Markdown,
              // once, here on the done frame — never per token. Updates
              // answerEl IN PLACE (window.ChatUI.renderMarkdownText assigns
              // innerHTML on the same element, never replacing it), which is
              // load-bearing: appendTurnMeta below appends `.fc-msg-meta` as
              // a SIBLING of answerEl via answerEl.parentNode.appendChild,
              // and early-returns if answerEl.parentNode is gone. Element
              // replacement (rather than an in-place innerHTML write) is the
              // one thing that could trip that guard.
              window.ChatUI.renderMarkdownText(answerEl, answerText);
              setBubbleState(answerLi, 'done');
            } else if (turnKind === 'user-initiated' || turnKind === 'boot') {
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
            // LIN-2621 beat 3: every `done` frame — visible or silent, any
            // turn kind — updates the running "this tab so far" total and
            // check-in count. This is the ONLY other visible effect a silent
            // tick has (AC1/AC2 above are otherwise unchanged): the strip
            // updates, no bubble paints. `answerLi` is non-null exactly when
            // a bubble exists this turn (the two branches above, never AC1's
            // silent one) — that is what gates the per-bubble meta line,
            // independent of the always-on tab-total accumulation.
            tabCheckInCount += 1;
            if (eventData && eventData.usage && typeof eventData.usage.cost === 'number' && isFinite(eventData.usage.cost)) {
              tabTotalCost += eventData.usage.cost;
            }
            updateTabTotalDisplay();
            if (answerLi) appendTurnMeta(answerEl, eventData && eventData.usage);
            // LIN-2622: the cadence resets on `done` ONLY — doneCadenceEffect
            // treats a boot exactly like a user-initiated turn here, and every
            // failure exit below (mid-stream error, non-stream outcome,
            // network failure) leaves the cadence untouched for a boot rather
            // than resetting or doubling it.
            applyCadenceEffect(doneCadenceEffect(turnKind, eventData && eventData.surface));
            finishTurn(turnKind);
          } else if (type === 'error') {
            // A mid-stream error is not the designed silence AC1 covers, so
            // the bubble is created if absent — a failure is never silent.
            var errEl = ensureAssistantBubble();
            errEl.classList.remove('chat-cursor');
            errEl.textContent = answerText + '\n[error: ' + ((eventData && eventData.message) || 'failed') + ']';
            setBubbleState(answerLi, 'failed');
            // LIN-2622: a boot's cadence is left alone on an error, same as
            // user-initiated — "reset on done only" means an error moves it
            // neither way, never a 'double' the way an auto-wake's does.
            if (turnKind === 'user-initiated' || turnKind === 'boot') chatHistory.pop();
            else applyCadenceEffect('double');
            finishTurn(turnKind);
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
      if (turnKind === 'user-initiated' || turnKind === 'boot') {
        chatHistory.pop();
        showInlineNote(networkMessage);
        if (turnKind === 'user-initiated') setComposerValue(message);
      } else {
        applyCadenceEffect('double');
      }
      settleFailedThinkingRow(answerEl, answerLi, turnKind, networkMessage);
      finishTurn(turnKind);
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
    setComposerValue('');
    sendTurn(text, 'user-initiated');
  }

  // LIN-2622: the start button (empty state) and the re-orient affordance
  // both drive the SAME boot turn — a server-composed orient turn, never a
  // client-asserted message. 'Start' is the synthetic display text (see
  // sendTurn's boot branch above); the ACTUAL turn content is hardcoded
  // server-side and never read from the request body either way.
  function startBoot() {
    if (inFlight) return;
    sendTurn('Start', 'boot');
  }

  sendBtn.addEventListener('click', submitQuestion);
  questionInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitQuestion(); }
  });
  // LIN-2717: human typing/paste is the one write `setComposerValue` cannot
  // chokepoint (there is no `.value =` call to intercept) — `input` never
  // fires on an auto-wake path, which is what keeps LIN-2718's turn-kind
  // gate intact.
  questionInput.addEventListener('input', resizeComposer);
  // LIN-2717 finding, not in the plan: focusing a <textarea> reveals it via
  // CENTER alignment in Chromium, unlike <input>'s edge alignment — which
  // this page's phone-shape column (flight-companion.css's 100dvh block)
  // depends on landing the composer flush with the viewport's bottom edge.
  // Re-align on focus so the mobile reachability contract (LIN-2632) holds
  // for a textarea the same way it happened to for the old <input>.
  //
  // LIN-2717 review F1: the phone-shape column this compensates for exists
  // ONLY inside flight-companion.css's `@media (max-width: 600px)` block —
  // outside it, `block: 'end'` is not a minimal scroll (it bottom-aligns
  // even when the composer is already fully visible), so the unconditional
  // listener yanked the whole page to the top on every desktop focus. Gate
  // it to the shape it exists for, on the SAME breakpoint that block uses.
  // LIN-2717 F5: finishTurn's caret-restore `.focus()` fires this same
  // listener, but that focus is programmatic, not a human tap — skip the
  // reveal there so it does not yank the page away from wherever the user
  // scrolled while the turn was in flight. `restoringFocusProgrammatically`
  // is only ever true for the duration of that synchronous `.focus()` call.
  questionInput.addEventListener('focus', function () {
    if (restoringFocusProgrammatically) return;
    if (!window.matchMedia('(max-width: 600px)').matches) return;
    questionInput.scrollIntoView({ block: 'end', inline: 'nearest' });
  });
  // LIN-2770 / John's ruling (relayed 2026-09-11): reorient is NOT a fresh
  // start — LIN-2622's boot turn already carries the prior conversation on
  // the wire, and LIN-2716's original "reorient clears the stored session"
  // job fought that premise: the review found the next ordinary turn simply
  // re-saved the whole pre-reorient chatHistory anyway (LIN-2770 — the clear
  // "un-did itself" one turn later, storage and memory briefly disagreeing
  // and memory always winning). That acceptance bullet is withdrawn by the
  // ruling; persistence now mirrors the existing in-memory session across
  // reorient exactly like it does across any other turn kind, so storage
  // and memory can no longer disagree. A deliberate "start a fresh session"
  // affordance — distinct from this reorientation — is a later ticket, not
  // this one.
  function reorientClick() {
    startBoot();
  }
  if (startBtn) startBtn.addEventListener('click', startBoot);
  if (reorientBtn) reorientBtn.addEventListener('click', reorientClick);
  // Size a browser-restored form value (e.g. bfcache) on first paint.
  resizeComposer();

  // LIN-2716: rehydrate a persisted session before wiring beforeunload/the
  // cadence timer below — restores chatHistory (so the very next turn's
  // body.history is correct even if the human never touches the composer
  // before it), the visible thread (through the SAME render path A1 landed:
  // appendUserBubble / appendAssistantBubble -> window.ChatUI.
  // renderMarkdownText -> setBubbleState(..., 'done') — no second rendering
  // path for restored turns), and the tab cost/counter total. Proposals are
  // NOT part of chatHistory (they arrive as ephemeral tool-call SSE events,
  // never persisted) and so are never reconstructed on reload — the
  // ticket's "read-only unless the approve path can still reach a live
  // proposal id" default resolves to "absent" here, which is trivially safe
  // (nothing stale to approve). A restored assistant turn also renders no
  // per-message cost meta line (LIN-2621 beat 3's `.fc-msg-meta`) — only the
  // running tab total is persisted, not each turn's own usage payload.
  var resumeAnchorMs = null;
  var keepStopped = false;
  if (urlKey) {
    var restoredSession = loadStoredSession(urlKey);
    if (restoredSession.history.length) {
      chatHistory = restoredSession.history;
      restoredSession.history.forEach(function (turn) {
        if (turn.role === 'user') {
          appendUserBubble(turn.content);
        } else if (turn.role === 'assistant') {
          var restoredBody = appendAssistantBubble();
          window.ChatUI.renderMarkdownText(restoredBody, turn.content);
          setBubbleState(restoredBody.closest('li'), 'done');
        }
      });
    }
    tabCheckInCount = restoredSession.tabCheckInCount;
    tabTotalCost = restoredSession.tabTotalCost;
    updateTabTotalDisplay();
    // LIN-2623 beat 3: restore the picker's own choice. A real <select>
    // silently ignores an assigned value that matches none of its options
    // (e.g. a curated id removed from AVAILABLE_MODELS since it was stored),
    // leaving `.value` at `''` — the same safe "no override" state a fresh
    // session starts in, so no extra validation is needed here.
    if (modelSelectEl && restoredSession.selectedModel) {
      modelSelectEl.value = restoredSession.selectedModel;
      updateModelPriceDisplay();
    }
    // LIN-2771: restore the wake cadence from its wall-clock anchor. A stored
    // cadence with a finite nextFireAt means a wake was PENDING when the tab
    // left — restore its backoff length and let the first auto-wake fire at
    // the ORIGINAL anchor (remaining time), not a fresh full wait. A record
    // with nextFireAt: null and no stoppedReason (timer was not armed — just
    // hidden, or an old blob) leaves cadence at today's default. LIN-2771
    // beat 3: a record with nextFireAt: null AND a stoppedReason means the
    // cadence was deliberately stopped — re-arm it (at CADENCE_BASE_MS, the
    // cheap path) unless the page can still show the reason holds.
    if (restoredSession.cadence && typeof restoredSession.cadence.nextFireAt === 'number') {
      cadence = { delayMs: restoredSession.cadence.delayMs, stopped: false, stoppedReason: null };
      resumeAnchorMs = restoredSession.cadence.nextFireAt;
    } else if (restoredSession.cadence && restoredSession.cadence.stoppedReason) {
      // The page's own AI-config attribute (server-rendered) is the one
      // reason signal the page can still show holds; everything else is
      // either provably cleared or uncheckable → re-arm.
      var aiConfigured = page && page.dataset ? page.dataset.fcAiConfigured : undefined;
      if (shouldReArmOnLoad(restoredSession.cadence.stoppedReason, aiConfigured)) {
        cadence = { delayMs: CADENCE_BASE_MS, stopped: false, stoppedReason: null };
      } else {
        cadence = { delayMs: restoredSession.cadence.delayMs, stopped: true, stoppedReason: restoredSession.cadence.stoppedReason };
        keepStopped = true;
      }
    }
  }

  window.addEventListener('beforeunload', function () {
    if (timerId) { clearTimeout(timerId); timerId = null; timerDelayMs = null; }
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  // First attempt at t=30s (deliberately unlike observation.js's free
  // poll — this call is billable, so there is no call at t=0). If the tab
  // starts hidden, onVisibilityChange schedules the first attempt once it
  // becomes visible instead. LIN-2771: with a restored wall-clock anchor the
  // first attempt is at the ORIGINAL fire time's remaining duration
  // (Math.max(0, ...) — an anchor already past fires on the next tick),
  // never a fresh full wait. LIN-2771 beat 3: a cadence kept stopped (the
  // page can still show the stop reason holds) schedules nothing and shows
  // the stopped placeholder, exactly as a live stop does today.
  if (keepStopped) {
    if (nextCheckInEl) nextCheckInEl.textContent = 'next check-in: —';
  } else if (!document.hidden) {
    scheduleAutoWake(resumeAnchorMs !== null ? Math.max(0, resumeAnchorMs - now()) : cadence.delayMs);
  }

  // Test-only seam (inert in the browser, where `module` is undefined):
  // exposes the pure helpers plus the cadence/turn-send entry points so
  // node:vm-sandboxed unit tests can drive real behavior without needing to
  // re-port this logic. Mirrors public/observation.js's own seam.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      capHistory, nextCadenceDelay, doneCadenceEffect, autoWakeErrorCadenceEffect,
      advanceCadence, classifyTurnResponse, parseProposalResult, formatCheckIn, formatSweepNotSeen,
      formatNoCensus, formatNextCheckIn, formatCost, formatTurnMeta, formatTabTotal, parseDecisionsResult,
      applyCadenceEffect, scheduleAutoWake, autoWakeTick, sendTurn, submitQuestion, startBoot,
      resizeComposer,
      shouldReArmOnLoad,
      sessionStorageKey, loadStoredSession, saveStoredSession, clearStoredSession,
      // LIN-2771: the clock seam. Defaults to Date.now; tests pin the wall
      // clock so the anchor math is deterministic. `now()` itself is not
      // exported — tests only ever need to set the clock, never read it.
      setNowFn: function (fn) { nowFn = fn; },
      getCadenceState: function () { return cadence; },
      getChatHistory: function () { return chatHistory; },
      getNextCheckInText: function () { return nextCheckInEl ? nextCheckInEl.textContent : null; },
      getTabTotalText: function () { return tabTotalEl ? tabTotalEl.textContent : null; },
      getTabTotals: function () { return { count: tabCheckInCount, cost: tabTotalCost }; },
      updateModelPriceDisplay: updateModelPriceDisplay,
      getModelPriceText: function () { return modelPriceEl ? modelPriceEl.textContent : null; },
      CADENCE_BASE_MS: CADENCE_BASE_MS, CADENCE_CAP_MS: CADENCE_CAP_MS, HISTORY_CAP: HISTORY_CAP,
    };
  }
})();
