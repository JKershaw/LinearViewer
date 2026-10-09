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

  function reveal(thread, opts) {
    if (!thread) return;
    opts = opts || {};
    thread.hidden = false;
    if (opts.force || opts.wasPinned) {
      thread.scrollTop = thread.scrollHeight;
    }
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

    var doReveal = opts.reveal !== false;
    var wasPinned = doReveal ? window.isPinnedToBottom(thread) : false;
    thread.appendChild(li);
    if (doReveal) reveal(thread, { wasPinned: wasPinned, force: !!opts.self });
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
    var doReveal = opts.reveal !== false;
    var wasPinned = doReveal ? window.isPinnedToBottom(thread) : false;
    if (opts.before && opts.before.parentNode === thread) {
      thread.insertBefore(li, opts.before);
    } else {
      thread.appendChild(li);
    }
    if (doReveal) reveal(thread, { wasPinned: wasPinned, force: !!opts.self });
    return li;
  }

  // ─── Scannable-thread helpers (LIN-3361) ───────────────────────────────────
  // Additive: appendNote / renderMarkdownText are untouched, and Task Chat
  // (which calls them) keeps its bare note rendering until it opts in here.
  // Nothing below names a Flight-Companion-only class — surfaces pass their
  // own wording in via opts.

  var TOOL_RESULT_CLIP = 1500;
  var FOLD_MIN_TAIL_CHARS = 280;
  var IDENTIFIER_SHAPE = /^[A-Z][A-Z0-9]*-\d+$/;
  var IDENTIFIER_KEYS = { issueIdentifier: true, identifier: true, issueId: true };
  var LINK_SKIP_TAGS = { A: true, CODE: true, PRE: true, SUMMARY: true, BUTTON: true };

  function childList(el) {
    return Array.prototype.slice.call(el.children || []);
  }

  function hasClass(el, cls) {
    return !!(el && el.classList && el.classList.contains(cls));
  }

  function clipText(text, max) {
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  function prettyResult(text) {
    // Pretty-print only a complete JSON result; a server-clipped one (it ends
    // in `… [truncated N chars]`) does not parse and is shown as sent.
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch (e) {
      return text;
    }
  }

  function toolGroupOf(li) {
    var ul = li.parentNode;
    if (!ul || !hasClass(ul, 'chat-tool-group-list')) return null;
    var details = ul.parentNode;
    return details ? details.parentNode : null;
  }

  function refreshToolGroup(groupLi) {
    if (!groupLi) return;
    var details = groupLi.children[0];
    var summary = details.children[0];
    var rows = childList(details.children[1]);
    var pending = rows.some(function (r) { return r.dataset.pending === '1'; });
    var failed = rows.some(function (r) { return r.dataset.error === '1'; });
    summary.textContent = 'checked ' + rows.length + ' things' + (pending ? ' …' : '');
    if (failed) groupLi.dataset.hasError = '1'; else delete groupLi.dataset.hasError;
  }

  /**
   * Append an expandable tool row: a closed `<details>` whose summary is the
   * label and whose body is the call arguments + the (clipped) result. Never a
   * bubble — no speaker chrome. A row inserted directly after another tool row
   * or group joins it in one `checked N things` group; grouping is DOM
   * adjacency only, so any other `li` between two rows breaks the run.
   * @param {Element} thread
   * @param {Object} opts
   * @param {string} opts.label
   * @param {*} [opts.args] - rendered as indented JSON in the body.
   * @param {Element} [opts.before] - insert before this element if still attached to `thread`; else append.
   * @param {boolean} [opts.reveal] - default true.
   * @returns {{li: Element, settle: function(string): void, fail: function(string): void}}
   */
  function appendToolRow(thread, opts) {
    opts = opts || {};
    var label = opts.label || '';
    var li = document.createElement('li');
    li.className = 'chat-tool-row';
    li.dataset.pending = '1';
    var details = document.createElement('details');
    var summary = document.createElement('summary');
    summary.textContent = '↳ ' + label + ' …';
    details.appendChild(summary);
    var body = document.createElement('div');
    body.className = 'chat-tool-body';
    if (opts.args !== undefined && opts.args !== null) {
      var argsPre = document.createElement('pre');
      argsPre.className = 'chat-tool-args';
      argsPre.textContent = typeof opts.args === 'string' ? opts.args : JSON.stringify(opts.args, null, 2);
      body.appendChild(argsPre);
    }
    var resultPre = document.createElement('pre');
    resultPre.className = 'chat-tool-result';
    resultPre.hidden = true;
    body.appendChild(resultPre);
    details.appendChild(body);
    li.appendChild(details);

    var doReveal = opts.reveal !== false;
    var wasPinned = doReveal ? window.isPinnedToBottom(thread) : false;
    var attachedBefore = opts.before && opts.before.parentNode === thread ? opts.before : null;
    var siblings = childList(thread);
    var prev = attachedBefore
      ? siblings[siblings.indexOf(attachedBefore) - 1]
      : siblings[siblings.length - 1];
    if (hasClass(prev, 'chat-tool-group')) {
      prev.children[0].children[1].appendChild(li);
      refreshToolGroup(prev);
    } else if (hasClass(prev, 'chat-tool-row')) {
      var group = document.createElement('li');
      group.className = 'chat-tool-group';
      var gDetails = document.createElement('details');
      var gSummary = document.createElement('summary');
      var list = document.createElement('ul');
      list.className = 'chat-tool-group-list';
      gDetails.appendChild(gSummary);
      gDetails.appendChild(list);
      group.appendChild(gDetails);
      thread.insertBefore(group, prev);
      list.appendChild(prev);
      list.appendChild(li);
      refreshToolGroup(group);
    } else if (attachedBefore) {
      thread.insertBefore(li, attachedBefore);
    } else {
      thread.appendChild(li);
    }
    if (doReveal) reveal(thread, { wasPinned: wasPinned });

    function settleWith(fn) {
      var pinned = doReveal ? window.isPinnedToBottom(thread) : false;
      fn();
      delete li.dataset.pending;
      refreshToolGroup(toolGroupOf(li));
      if (doReveal) reveal(thread, { wasPinned: pinned });
    }
    return {
      li: li,
      settle: function (resultText) {
        settleWith(function () {
          summary.textContent = '↳ ' + label;
          if (typeof resultText === 'string' && resultText) {
            resultPre.textContent = clipText(prettyResult(resultText), TOOL_RESULT_CLIP);
            resultPre.hidden = false;
          }
        });
      },
      fail: function (failLabel) {
        settleWith(function () {
          summary.textContent = '↳ ' + (failLabel || label);
          li.dataset.error = '1';
        });
      }
    };
  }

  /**
   * Pure: pick the fold anchor from plain node descriptions
   * (`{ tag, strongOnly }` — `strongOnly` is the text of a `<p>` whose only
   * content is one `<strong>`, or of the leading `<strong>` of a list's first
   * item, else null). The first `h1-h6`/`hr` wins; only
   * with none of those does the bold-label fallback apply, matched exactly
   * against `headings`. -1 when there is no anchor.
   */
  // "1. The big thread:" and "the big thread" are the same label.
  function normalizeLabel(text) {
    return String(text).trim().replace(/^\d+[.)]\s*/, '').replace(/[\s:.\u2014-]+$/, '').toLowerCase();
  }

  function chooseFoldAnchor(descs, headings) {
    var i;
    for (i = 0; i < descs.length; i++) {
      if (/^(H[1-6]|HR)$/.test(descs[i].tag)) return i;
    }
    var known = (headings || []).map(normalizeLabel);
    for (i = 0; i < descs.length; i++) {
      var s = descs[i].strongOnly;
      if (s && known.indexOf(normalizeLabel(s)) !== -1) return i;
    }
    return -1;
  }

  /**
   * Move the anchor and everything after it into a closed
   * `<details class="chat-fold">` appended to `el`, keeping the opening block
   * visible. Moves the existing nodes (no innerHTML, no re-sanitising).
   * Returns false and does nothing when there is no anchor, nothing before it,
   * or the tail is short (< ~280 chars) — a short answer must not hide behind a
   * click.
   * @param {Element} el
   * @param {Object} [opts]
   * @param {string} [opts.summary] - summary text, default 'more'.
   * @param {string[]} [opts.headings] - bold-label fallback anchors.
   * @returns {boolean}
   */
  function foldAfterAnchor(el, opts) {
    opts = opts || {};
    var kids = childList(el);
    var descs = kids.map(function (k) {
      var strongOnly = null;
      if (k.tagName === 'P' && k.children && k.children.length === 1 && k.children[0].tagName === 'STRONG'
        && (k.textContent || '').trim() === (k.children[0].textContent || '').trim()) {
        strongOnly = k.children[0].textContent || '';
      } else if ((k.tagName === 'OL' || k.tagName === 'UL') && k.children && k.children[0]
        && k.children[0].children && k.children[0].children[0]
        && k.children[0].children[0].tagName === 'STRONG'
        && (k.children[0].textContent || '').indexOf(k.children[0].children[0].textContent || '') === 0) {
        // The brief asks for the body as a numbered list of bold labels
        // ("1. **The big thread** — …"), which markdown renders as <ol><li>
        // <strong>…; the label leads the first item.
        strongOnly = k.children[0].children[0].textContent || '';
      }
      return { tag: k.tagName, strongOnly: strongOnly };
    });
    var at = chooseFoldAnchor(descs, opts.headings);
    if (at <= 0) return false;
    var tail = kids.slice(at);
    var tailChars = tail.reduce(function (n, k) { return n + (k.textContent || '').length; }, 0);
    if (tailChars < FOLD_MIN_TAIL_CHARS) return false;
    var details = document.createElement('details');
    details.className = 'chat-fold';
    var summary = document.createElement('summary');
    summary.textContent = opts.summary || 'more';
    details.appendChild(summary);
    tail.forEach(function (k) { details.appendChild(k); });
    el.appendChild(details);
    return true;
  }

  /**
   * Pure: split `text` on whole-token occurrences of the KNOWN identifiers in
   * `known` (a Set or array) — it searches for those strings, never for a
   * pattern. Longest first, with a boundary check so `LIN-33` never matches
   * inside `LIN-3361`. Returns `[{ text, id? }]`; `id` is set on link segments.
   */
  function splitByKnownIdentifiers(text, known) {
    var ids = Array.from(known || []).filter(function (s) { return typeof s === 'string' && s; });
    if (!ids.length || !text) return [{ text: text }];
    ids.sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp('(' + ids.map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'g');
    var word = /[A-Za-z0-9_-]/;
    var out = [];
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      var start = m.index;
      var end = start + m[0].length;
      if ((start > 0 && word.test(text.charAt(start - 1))) || (end < text.length && word.test(text.charAt(end)))) {
        re.lastIndex = start + 1;
        continue;
      }
      if (start > last) out.push({ text: text.slice(last, start) });
      out.push({ text: m[0], id: m[0] });
      last = end;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  /**
   * Replace known identifiers in the text nodes under `root` with task links.
   * Skips text already inside a / code / pre / summary / button, so a re-run
   * is idempotent. DOM construction only — never innerHTML.
   * @returns {number} links made
   */
  function linkifyIdentifiers(root, seen, hrefFor) {
    if (!root || !seen || !(seen.size || seen.length) || typeof hrefFor !== 'function') return 0;
    var walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    var made = 0;
    nodes.forEach(function (node) {
      for (var p = node.parentNode; p && p !== root.parentNode; p = p.parentNode) {
        if (LINK_SKIP_TAGS[p.tagName]) return;
      }
      var segs = splitByKnownIdentifiers(node.nodeValue, seen);
      if (!segs.some(function (s) { return s.id; })) return;
      var frag = document.createDocumentFragment();
      segs.forEach(function (s) {
        var href = s.id ? hrefFor(s.id) : '';
        if (!href) {
          frag.appendChild(document.createTextNode(s.text));
          return;
        }
        var a = document.createElement('a');
        a.className = 'chat-task-link';
        a.setAttribute('href', href);
        a.setAttribute('data-testid', 'chat-task-link');
        a.textContent = s.text;
        frag.appendChild(a);
        made++;
      });
      node.parentNode.replaceChild(frag, node);
    });
    return made;
  }

  /**
   * Pure: add the identifiers found in already-structured values to `into`.
   * Only the values of the keys issueIdentifier / identifier / issueId that
   * match the identifier shape — a filter on structured fields, not a finder.
   * @returns {Set|Array} `into`
   */
  function collectIdentifiers(value, into) {
    function add(id) {
      if (Array.isArray(into)) { if (into.indexOf(id) === -1) into.push(id); } else into.add(id);
    }
    (function walk(v, depth) {
      if (!v || typeof v !== 'object' || depth > 8) return;
      if (Array.isArray(v)) { v.forEach(function (x) { walk(x, depth + 1); }); return; }
      Object.keys(v).forEach(function (k) {
        var x = v[k];
        if (IDENTIFIER_KEYS[k] && typeof x === 'string' && IDENTIFIER_SHAPE.test(x)) add(x);
        else walk(x, depth + 1);
      });
    })(value, 0);
    return into;
  }

  /**
   * Like collectIdentifiers over a JSON string. A result the server clipped
   * does not parse; fall back to a scan anchored on the same structured keys
   * (`"identifier": "…"`), still never a bare pattern over prose.
   */
  function collectIdentifiersFromText(raw, into) {
    if (typeof raw !== 'string' || !raw) return into;
    try {
      return collectIdentifiers(JSON.parse(raw), into);
    } catch (e) {
      var re = /"(issueIdentifier|identifier)"\s*:\s*"([^"]+)"/g;
      var m;
      while ((m = re.exec(raw)) !== null) collectIdentifiers({ identifier: m[2] }, into);
      return into;
    }
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

  // Effect → caption text (LIN-2775 Area 5). A SEPARATE namespace from
  // DISPOSITION_CAPTIONS above, not three entries merged into it — `effect`
  // (lib/unanswered-decisions.js's `resolveEffect`) answers "what happens
  // once a reply is delivered", a different question from `disposition`'s
  // "whether/how a reply can be delivered" (LIN-2215 F2 rewrote the
  // neighbouring readOnly check to keep exactly these two namespaces apart;
  // collapsing them back into one table here would reintroduce that shape).
  // Provisional labels — final vocabulary lands via LIN-2757.
  var EFFECT_CAPTIONS = {
    resume: 'Answer & resume',
    dispatch: 'Answer & start a run',
    record: 'Record answer'
  };

  // The allow-list `canReplyFor` (lib/unanswered-decisions.js) mirrors:
  // resumable/gone/task-bound are interactive, everything else — including a
  // disposition not yet in this list — is read-only. Shared by the caption
  // lookup and the options-render gate below so the two can never drift
  // apart from each other.
  function isReadOnlyDisposition(disposition) {
    return !(disposition === 'resumable' || disposition === 'gone' || disposition === 'task-bound');
  }

  // Effect-first, disposition as fallback — but ONLY on a row that can
  // actually act. `resolveEffect` still resolves a non-null `effect` on a
  // read-only mid-turn/indeterminate row (a live run on the row's own,
  // necessarily non-terminal, loop self-matches the anchor and forces
  // `record` before that function's read-only-null branch ever fires — see
  // the S1 handover on LIN-2775), so an ungated `EFFECT_CAPTIONS[effect] ||
  // ...` lookup would print "Record answer" on a row with no buttons at all,
  // regressing the honesty property LIN-2215 F2 established. Gating on
  // `isReadOnlyDisposition` here — the SAME predicate the options-render gate
  // uses — keeps that property: a row that cannot act never claims an
  // effect. Exposed on window.ChatUI (below) so a caller updating a caption
  // in place after the fact (e.g. observation.js's override flip control)
  // reuses this exact logic rather than re-deriving it.
  function resolveCaption(disposition, effect) {
    return (!isReadOnlyDisposition(disposition) && EFFECT_CAPTIONS[effect])
      || DISPOSITION_CAPTIONS[disposition]
      || DISPOSITION_CAPTIONS.indeterminate;
  }

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
   * @param {string} [opts.recommendedLabel] - opt-in marker text (e.g. "agent recommends") rendered
   *   next to the recommended option's button, as a DOM text node (never innerHTML), matching the
   *   `opt.label` discipline below. Omitted by default so existing callers (Flight Companion's
   *   `.fc-decision` cards) render byte-identically to today — this is additive, never a rename of
   *   the existing `.chat-option--recommended` CSS star.
   * @param {'resumable'|'gone'|'mid-turn'|'indeterminate'|'task-bound'} opts.disposition - press-time disposition (see `lib/unanswered-decisions.js`).
   * @param {'resume'|'dispatch'|'record'|null} [opts.effect] - press-time resolved effect (`lib/unanswered-decisions.js`'s `resolveEffect`), used effect-first for the caption on a row that can act; ignored (never claimed) on a read-only disposition (LIN-2775 Area 5).
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
    caption.textContent = resolveCaption(disposition, opts.effect);
    wrap.appendChild(caption);

    // Read-only dispositions render the caption alone — no buttons, no dispatch
    // ever attempted. LIN-2215 F2: inverted to an ALLOW-list mirroring
    // `canReplyFor`'s own three-way OR (lib/unanswered-decisions.js) — the prior
    // hand-maintained deny-list (`disposition === 'mid-turn' || ... === 'indeterminate'`)
    // agreed with the server predicate only by coincidence and had already
    // drifted once (task-bound rendered as "no action available yet" instead of
    // reply-eligible). An allow-list fails SAFE: an unrecognized future
    // disposition now defaults to read-only, not interactive.
    var readOnly = isReadOnlyDisposition(disposition);
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
      // Set BEFORE the recommended-marker span below: `textContent =` clears
      // any existing children, so appending the marker first would be wiped.
      btn.textContent = opt.label;
      if (opts.recommended && opt.id === opts.recommended && opts.recommendedLabel) {
        // DOM text node, never innerHTML — same discipline as opt.label
        // above. Opt-in only: omitting opts.recommendedLabel (the default)
        // adds no DOM here, which is the whole guarantee that Flight
        // Companion's `.fc-decision` cards (public/flight-companion.js's
        // renderOneDecision, which never sets this option) stay byte-
        // identical to today.
        var marker = document.createElement('span');
        marker.className = 'chat-option-recommended-label';
        marker.textContent = opts.recommendedLabel;
        btn.appendChild(marker);
      }
      btn.addEventListener('click', function () { onSelect(opt.id, opt.label); });
      row.appendChild(btn);
    });
    wrap.appendChild(row);

    container.appendChild(wrap);
    return wrap;
  }

  /**
   * Swap a chat text element's raw streamed Markdown for rendered, sanitized
   * HTML (LIN-2670) — called once, on the `done` frame, never per token. The
   * element is updated IN PLACE (`el.innerHTML = …`); it is never detached,
   * replaced or re-created, which is load-bearing for Flight Companion's
   * per-turn `.fc-msg-meta` line (appended as a sibling via
   * `el.parentNode.appendChild(...)` — a replaced element would drop
   * `parentNode` and silently lose that append).
   *
   * No-ops — leaving today's plain-text rendering untouched — unless `el`
   * and `rawText` are both present AND `window.renderMarkdown` is a function
   * AND `DOMPurify` is available AND `marked` is available. The DOMPurify
   * guard is stronger than the `render-session.js` precedent this mirrors:
   * `window.renderMarkdown` returns escaped plain text when DOMPurify is
   * missing (common.js, LIN-3385), so this guard keeps the chat bubble on its
   * plain-text rendering rather than showing escaped markdown source.
   *
   * The `marked` guard (LIN-2670 close-out, ledger L2) is a behaviour
   * guard, not a security one — with marked absent `window.renderMarkdown`
   * falls back to `escapeHtml`, which DOMPurify still sanitizes. Without it
   * a degraded load (DOMPurify present, marked missing) still acquired
   * `chat-md`, whose `white-space: normal` collapses the newlines the
   * plain-text bubble's `pre-wrap` preserves — leaving such a page slightly
   * WORSE off than no Markdown support at all. Guarded, it falls back to
   * exactly today's behaviour instead.
   *
   * Passes `keepWholeFence = true` to `window.renderMarkdown`: a chat
   * bubble's whole answer being a single fenced snippet is deliberate (the
   * command, the config, the diff the user asked for), not packaging around
   * a document, so it must render as a real code block rather than have its
   * contents re-interpreted as Markdown (see common.js's `keepWholeFence`
   * docblock).
   *
   * @param {Element} el - the mutable text element (e.g. a caller's `textClass` span).
   * @param {string} rawText - the raw Markdown source (e.g. the accumulated streamed answer).
   */
  function renderMarkdownText(el, rawText) {
    if (!el || !rawText) return;
    if (typeof window.renderMarkdown !== 'function') return;
    if (typeof DOMPurify === 'undefined') return;
    if (typeof marked === 'undefined') return;
    el.classList.add('chat-md');
    el.innerHTML = window.renderMarkdown(rawText, { breaks: true }, true);
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
        // fallback below would hide a real side effect behind an anonymous
        // tool name, so it always names the session it targeted and a snippet
        // of the prompt. LIN-3254: the wording must stay NEUTRAL ("follow-up
        // to session X") because a run-scoped turn only PROPOSES — nothing has
        // been sent at call time. The verdict belongs on the settled frame: the
        // 'proposed' phase below for a proposal; the route's own 'queued'
        // result for an executed follow-up.
        if (!args.sessionId) return name;
        var prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        var snippet = prompt ? ': "' + (prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt) + '"' : '';
        return 'follow-up to session ' + args.sessionId + snippet;
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
    if (data.phase === 'proposed') {
      // LIN-3254: a run-scoped turn proposes instead of acting — say so, never
      // reuse the 'call' frame's "sent a follow-up" wording (nothing was sent).
      return name === 'send_follow_up' ? 'proposed a follow-up' : name + ' proposed';
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
    appendToolRow: appendToolRow,
    foldAfterAnchor: foldAfterAnchor,
    chooseFoldAnchor: chooseFoldAnchor,
    linkifyIdentifiers: linkifyIdentifiers,
    splitByKnownIdentifiers: splitByKnownIdentifiers,
    collectIdentifiers: collectIdentifiers,
    collectIdentifiersFromText: collectIdentifiersFromText,
    isPinnedToBottom: window.isPinnedToBottom,
    resolveCaption: resolveCaption,
    renderMarkdownText: renderMarkdownText,
    toolBreadcrumbLabel: toolBreadcrumbLabel
  };
})();
