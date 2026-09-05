/**
 * ChatUI — shared client render helper for the `.chat-*` primitives in
 * chat.css (LIN-1298).
 *
 * The append-bubble / thread-reveal / breadcrumb logic was forked three ways
 * (session.js's appendYouBubble, task-chat.js's appendBubble, collective.js's
 * appendMessages) even after chat.css extracted the shared CSS. This module
 * is the client-side half of that dedupe: pure DOM construction on top of the
 * shared renderStatusPill/renderSurface primitives (public/common.js). It
 * owns no fetch/transport/state and knows nothing about any single surface's
 * data source — each page keeps its own poll/stream/echo logic and calls in
 * here only to build the markup.
 *
 * Per-surface variation (single vs multi-participant, streaming vs static,
 * action-style rows, trailing timestamps) is expressed via options on
 * appendMessage, matching the modifier classes in chat.css — never by
 * forking this file or chat.css itself.
 *
 * Loaded after common.js (renderStatusPill/renderSurface/escapeHtml) and
 * before any page script that calls window.ChatUI.
 */
(function () {
  'use strict';

  function reveal(thread) {
    if (!thread) return;
    thread.hidden = false;
    thread.scrollTop = thread.scrollHeight;
  }

  /**
   * Append one conversational turn to a `.chat-thread` list.
   * @param {Element} thread - the `<ul class="chat-thread">` to append into.
   * @param {Object} opts
   * @param {string} opts.who - speaker label (required).
   * @param {string} [opts.whoState] - status-pill state (e.g. 'in-progress'); a plain tag pill when omitted.
   * @param {string} [opts.whoClass] - extra class(es) for the speaker pill (surface-specific hooks).
   * @param {boolean} [opts.self] - true for the current user's own turn (adds the `chat-msg--you` accent).
   * @param {boolean} [opts.row] - true for a multi-participant/log-style turn (adds `chat-msg--row`; pair with `chat-thread--log` on the thread).
   * @param {boolean} [opts.action] - true for an action-style turn (italicised body, e.g. an IRC `/me`).
   * @param {string} [opts.text] - plain text body (escaped internally). Mutually exclusive with `html`.
   * @param {string} [opts.html] - pre-built body innerHTML (caller-escaped) — e.g. a streaming placeholder.
   * @param {string} [opts.textClass] - extra class(es) for the mutable text node (also how a caller re-finds it for streaming updates).
   * @param {string} [opts.bodyClass] - extra class(es) for the surface wrapper.
   * @param {string} [opts.bodyVariant] - surface variant (e.g. 'inset').
   * @param {string} [opts.bodyAs] - surface tag name (default 'div').
   * @param {string} [opts.time] - optional trailing timestamp text.
   * @param {string} [opts.liClass] - extra class(es) for the `<li>`.
   * @param {string} [opts.testId] - data-testid for the `<li>`.
   * @param {boolean} [opts.reveal] - unhide + scroll the thread after appending (default true; a caller batching several messages before one scroll should pass false).
   * @returns {Element} the appended `<li>`.
   */
  function appendMessage(thread, opts) {
    opts = opts || {};

    var liClasses = ['chat-msg'];
    if (opts.self) liClasses.push('chat-msg--you');
    if (opts.row) liClasses.push('chat-msg--row');
    if (opts.action) liClasses.push('chat-msg--action');
    if (opts.liClass) liClasses.push(opts.liClass);

    var pillOpts = { label: opts.who || '', className: 'chat-msg__who' + (opts.whoClass ? ' ' + opts.whoClass : '') };
    if (opts.whoState) pillOpts.state = opts.whoState;
    else pillOpts.variant = 'tag';
    var whoPill = window.renderStatusPill(pillOpts);

    var textHtml = opts.html != null
      ? opts.html
      : '<span class="chat-msg__text' + (opts.textClass ? ' ' + opts.textClass : '') + '">' + window.escapeHtml(opts.text || '') + '</span>';
    var bodySurface = window.renderSurface({
      body: textHtml,
      variant: opts.bodyVariant,
      as: opts.bodyAs || 'div',
      className: 'chat-msg__body' + (opts.bodyClass ? ' ' + opts.bodyClass : '')
    });

    var timeHtml = opts.time ? '<span class="chat-msg__time">' + window.escapeHtml(opts.time) + '</span>' : '';

    var li = document.createElement('li');
    li.className = liClasses.join(' ');
    if (opts.testId) li.setAttribute('data-testid', opts.testId);
    li.innerHTML = whoPill + bodySurface + timeHtml;
    thread.appendChild(li);

    if (opts.reveal !== false) reveal(thread);
    return li;
  }

  /**
   * Append a non-bubble breadcrumb/note row (e.g. a tool-call log line) —
   * surfaced to the reader but not a conversational turn, so it is never
   * built from appendMessage.
   * @param {Element} thread
   * @param {string} text
   * @param {Object} [opts]
   * @param {string} [opts.liClass]
   * @param {Element} [opts.before] - insert before this element if it is still attached to `thread`; else append.
   * @param {boolean} [opts.reveal] - default true.
   * @returns {Element} the inserted `<li>`.
   */
  function appendNote(thread, text, opts) {
    opts = opts || {};
    var li = document.createElement('li');
    li.className = 'chat-note' + (opts.liClass ? ' ' + opts.liClass : '');
    li.textContent = text;
    if (opts.before && opts.before.parentNode === thread) {
      thread.insertBefore(li, opts.before);
    } else {
      thread.appendChild(li);
    }
    if (opts.reveal !== false) reveal(thread);
    return li;
  }

  // Disposition → caption text (LIN-1728 Phase 4, decision 4/F8). The SAME
  // button-press means two different things depending on the anchor's
  // press-time liveness (`lib/unanswered-decisions.js`'s `resolveDisposition`,
  // resolved server-side and passed straight through, never re-derived here):
  // resumable/gone both admit a reply (a follow-up vs. a fresh run — a
  // different action under the hood, so the caption says so honestly);
  // mid-turn/indeterminate are read-only — no options render, no dispatch is
  // ever attempted for either.
  var DISPOSITION_CAPTIONS = {
    resumable: 'Reply & continue',
    gone: 'Reply & start a run',
    'mid-turn': 'still running — reply disabled',
    indeterminate: 'no action available yet',
    // LIN-2215 F2: a scan-produced decision (LIN-2197 Phase 3) — no dispatch
    // item behind it, so the reply is comment-only (no run started/resumed).
    'task-bound': 'A task raised a decision — reply to resolve it'
  };

  /**
   * Append an option-button row — the LIN-1728 chat primitive for answering a
   * decision. Every option LABEL is agent-authored text (it comes straight off
   * a `kind: 'decision'` feedback payload another session wrote) and is
   * rendered via DOM text (`textContent`), never through `appendMessage`'s
   * `html` sink — that sink is caller-trusted HTML and is unsafe for this
   * source.
   *
   * @param {Element} container - any element to append into (not necessarily a `.chat-thread`).
   * @param {Object} opts
   * @param {Array<{id: string, label: string, cost?: number}>} [opts.options] - decision options.
   * @param {string} [opts.recommended] - the recommended option's `id`, if any.
   * @param {'resumable'|'gone'|'mid-turn'|'indeterminate'|'task-bound'} opts.disposition - press-time disposition (see `lib/unanswered-decisions.js`).
   * @param {function(string, string): void} [opts.onSelect] - called with `(optionId, optionLabel)` on a button press. Never called for a read-only disposition — an ALLOW-list of `resumable`/`gone`/`task-bound` is interactive; every other value, including one not yet in this list, is read-only (LIN-2215 F2) — or when `options` is empty.
   * @returns {Element} the appended `<div class="chat-options">` wrapper.
   */
  function appendOptions(container, opts) {
    opts = opts || {};
    var options = Array.isArray(opts.options) ? opts.options : [];
    var disposition = opts.disposition;
    var onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : function () {};

    var wrap = document.createElement('div');
    wrap.className = 'chat-options';
    wrap.setAttribute('data-disposition', disposition || '');

    var caption = document.createElement('div');
    caption.className = 'chat-options-caption';
    caption.textContent = DISPOSITION_CAPTIONS[disposition] || DISPOSITION_CAPTIONS.indeterminate;
    wrap.appendChild(caption);

    // Read-only dispositions render the caption alone — no buttons, no dispatch
    // ever attempted. LIN-2215 F2: inverted to an ALLOW-list mirroring
    // `canReplyFor`'s own three-way OR (lib/unanswered-decisions.js) — the prior
    // hand-maintained deny-list (`disposition === 'mid-turn' || ... === 'indeterminate'`)
    // agreed with the server predicate only by coincidence and had already
    // drifted once (task-bound rendered as "no action available yet" instead of
    // reply-eligible). An allow-list fails SAFE: an unrecognized future
    // disposition now defaults to read-only, not interactive.
    var readOnly = !(disposition === 'resumable' || disposition === 'gone' || disposition === 'task-bound');
    if (readOnly || !options.length) {
      wrap.classList.add('chat-options--readonly');
      container.appendChild(wrap);
      return wrap;
    }

    var row = document.createElement('div');
    row.className = 'chat-options-row';
    options.forEach(function (opt) {
      if (!opt || typeof opt.id !== 'string' || typeof opt.label !== 'string') return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-option chat-option-btn';
      if (opts.recommended && opt.id === opts.recommended) {
        btn.classList.add('chat-option--recommended');
      }
      // DOM text, never innerHTML — opt.label is agent-authored and must never
      // reach a markup sink (this is the constraint's targeted regression case:
      // a label containing markup must render as literal text, not execute).
      btn.textContent = opt.label;
      btn.addEventListener('click', function () { onSelect(opt.id, opt.label); });
      row.appendChild(btn);
    });
    wrap.appendChild(row);

    container.appendChild(wrap);
    return wrap;
  }

  // Human-readable label for a `tool` SSE breadcrumb (LIN-990). Derived from
  // the streamChatWithTools event shape ({ phase, name, arguments, error }).
  // Returns '' for phases neither current surface names (e.g. 'result') so
  // the caller can skip them.
  //
  // Lifted out of task-chat.js (LIN-2632, per LIN-1578's direction that this
  // shared layer must not be forked) and extended with the Flight Companion
  // tool catalog (get_stack, list_task_sessions, get_session,
  // list_active_sessions, list_pending_decisions) so their generic fallback
  // never prints a bare tool name.
  function toolBreadcrumbLabel(data) {
    if (!data || typeof data !== 'object') return '';
    var name = data.name || 'tool';
    var args = data.arguments || {};
    if (data.phase === 'call') {
      if (name === 'lookup_task' || name === 'get_relations') {
        return args.issueId ? 'looked up ' + args.issueId : name;
      }
      if (name === 'search_tasks') {
        return args.query ? 'searched "' + args.query + '"' : name;
      }
      if (name === 'send_follow_up') {
        // LIN-1073 review: this is the catalog's one WRITE tool — the generic
        // fallback below would hide a real side effect (a queued dispatch
        // follow-up) behind an anonymous tool name, so it must always name the
        // session it targeted and a snippet of what was sent.
        if (!args.sessionId) return name;
        var prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        var snippet = prompt ? ': "' + (prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt) + '"' : '';
        return 'sent a follow-up to session ' + args.sessionId + snippet;
      }
      // Flight Companion catalog (LIN-2632) — same discipline as send_follow_up
      // above: name the specifics available on the call, never just the tool.
      if (name === 'get_stack') {
        return typeof args.limit === 'number'
          ? 'checked the top ' + args.limit + ' tasks on the stack'
          : 'checked the task stack';
      }
      if (name === 'list_task_sessions') {
        return args.issueId ? 'checked sessions for ' + args.issueId : 'checked task sessions';
      }
      if (name === 'get_session') {
        return args.sessionId ? 'checked session ' + args.sessionId : 'checked a session';
      }
      if (name === 'list_active_sessions') {
        return 'checked active sessions';
      }
      if (name === 'list_pending_decisions') {
        return 'checked pending decisions';
      }
      return name;
    }
    if (data.phase === 'error') {
      return name + ' failed: ' + (data.error || 'unknown error');
    }
    if (data.phase === 'cap') {
      return 'reached the tool-lookup limit';
    }
    return '';
  }

  window.ChatUI = {
    appendMessage: appendMessage,
    appendNote: appendNote,
    appendOptions: appendOptions,
    toolBreadcrumbLabel: toolBreadcrumbLabel
  };
})();
