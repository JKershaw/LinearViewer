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

  window.ChatUI = { appendMessage: appendMessage, appendNote: appendNote };
})();
