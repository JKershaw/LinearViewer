/**
 * chat-next.js — the PROPOSED shared chat BEHAVIOUR layer (LIN-1412, design beat 2).
 *
 * This is a design prototype, not production code. It is the reference
 * implementation of the target contract in `plans/lin-1412-design-notes.md`:
 * the layer owns everything between the user's keystroke and the DOM; the
 * surface owns everything between the DOM and the network.
 *
 * It is written as an ADDITIVE extension of the real `public/chat.js`, which is
 * loaded first and still owns markup construction (appendMessage/appendNote on
 * top of renderStatusPill/renderSurface). Nothing here replaces those; a surface
 * that never calls `ChatUI.mount()` keeps today's behaviour exactly. That is
 * what makes the real change landable in stages across three live surfaces.
 *
 * ONE DELIBERATE DIVERGENCE from how this would actually land: the §9 at-bottom
 * test belongs INSIDE `public/chat.js`'s `reveal()` (chat.js:25-29), the single
 * function every shared consumer calls on every append. A prototype must not
 * touch production files, so instead every append here passes `reveal: false`
 * and the scroll decision is made in `follow()` below. The logic is identical;
 * only its home differs. In the real change, `reveal()` gains the test and
 * un-mounted callers benefit too.
 */
(function () {
  'use strict';

  if (!window.ChatUI) throw new Error('chat-next.js must load after public/chat.js');

  var AT_BOTTOM_PX = 120;      // §9 tolerance — the value S3 already chose
  var STREAM_FLUSH_MS = 80;    // §7.4/§8: re-render on a throttle, never per token

  // ── §9 scroll policy ──────────────────────────────────────────────────────

  /**
   * C1 (the beat-1 correction): a `.chat-thread` with its own max-height and
   * `overflow-y: auto` (public/chat.css:49-50) IS its own scroller, so the
   * at-bottom test must measure the THREAD. Collective measures the window
   * (public/collective.js:249-252), which is why a user scrolled up inside a
   * 60vh transcript can still be yanked to the bottom while the page happens
   * to sit at its own end. A thread that is not its own scroller falls back to
   * the document, which is the case that citation was actually written for.
   */
  function scrollerFor(thread) {
    var oy = window.getComputedStyle(thread).overflowY;
    if (oy === 'auto' || oy === 'scroll') return thread;
    return document.scrollingElement || document.documentElement;
  }

  function isAtBottom(thread) {
    var el = scrollerFor(thread);
    return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
  }

  /** §9.5 — smooth only for user-initiated jumps; instant for programmatic appends. */
  function toBottom(thread, smooth) {
    var el = scrollerFor(thread);
    if (smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  // ── §4 code blocks ────────────────────────────────────────────────────────

  function copyText(text, btn) {
    var done = function () {
      var was = btn.textContent;
      btn.textContent = 'copied';
      setTimeout(function () { if (btn.isConnected) btn.textContent = was; }, 1200);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    else done();
  }

  /**
   * §4.3/§4.4 — give every fenced block a language label, a copy button and its
   * own horizontal scroll. Runs once, when a message settles (never mid-stream),
   * so nothing already rendered is re-animated.
   */
  function enhanceCodeBlocks(root) {
    var pres = root.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i];
      if (pre.closest('.chat-code')) continue;
      var code = pre.querySelector('code');
      var lang = '';
      if (code) {
        var m = (code.className || '').match(/language-([\w+-]+)/);
        if (m) lang = m[1];
      }
      var wrap = document.createElement('div');
      wrap.className = 'chat-code';
      var head = document.createElement('div');
      head.className = 'chat-code__head';
      var label = document.createElement('span');
      label.className = 'chat-code__lang';
      label.textContent = lang || 'text';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-code__copy';
      btn.textContent = 'copy';
      (function (pre, btn) {
        btn.addEventListener('click', function () { copyText(pre.textContent, btn); });
      })(pre, btn);
      head.appendChild(label);
      head.appendChild(btn);
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(head);
      wrap.appendChild(pre);
    }
  }

  function renderBody(el, text, markdown) {
    if (markdown && typeof window.renderMarkdown === 'function') {
      el.innerHTML = window.renderMarkdown(text, { breaks: true });
    } else {
      el.textContent = text;
    }
  }

  // ── mount ─────────────────────────────────────────────────────────────────

  /**
   * @param {Element} thread  a `<ul class="chat-thread">`
   * @param {Object} opts
   * @param {Element} [opts.composer]   the `.chat-composer` — omit for a read-only transcript
   * @param {string}  [opts.submitKey]  'enter' (default) | 'mod-enter'
   * @param {boolean} [opts.markdown]   default true; pass false for `--row`/log threads
   * @param {Function} [opts.onSend]    (text, turn) → Promise; the surface owns transport
   * @param {Function} [opts.onStop]    present → a Stop control exists; absent → it never renders
   * @param {Function} [opts.onRetry]   (text, turn) → Promise; defaults to onSend
   * @param {string}  [opts.you]        label for the human's turns (default 'you')
   */
  function mount(thread, opts) {
    opts = opts || {};
    var markdown = opts.markdown !== false;
    var youLabel = opts.you || 'you';

    // §11 — the transcript is a log, and arrivals are announced politely.
    thread.setAttribute('role', 'log');
    thread.setAttribute('aria-live', 'polite');
    thread.setAttribute('aria-relevant', 'additions');

    // The jump-to-latest control needs a positioned frame around the thread.
    // In the real change the renderer emits this; here we create it so the
    // prototype stays out of production markup.
    var frame = thread.parentNode;
    if (!frame.classList.contains('chat-thread-frame')) {
      frame = document.createElement('div');
      frame.className = 'chat-thread-frame';
      thread.parentNode.insertBefore(frame, thread);
      frame.appendChild(thread);
    }

    var jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'chat-jump';
    jump.hidden = true;
    jump.setAttribute('data-testid', 'chat-jump-latest');
    frame.appendChild(jump);

    var status = document.createElement('span');
    status.className = 'chat-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    frame.appendChild(status);

    // Two things §9 gets wrong if you implement it the obvious way, both found
    // by driving this prototype (verify.mjs):
    //
    // 1. §9.3 says "pinned only if they were at the bottom when it started". A
    //    latch set once satisfies that sentence and still yanks a reader who
    //    scrolls up MID-stream — which §9.1 calls the cardinal sin and §1 ranks
    //    above it. So the decision is re-made per flush, not latched.
    // 2. It must be MEASURED, never cached. A `follow` flag maintained by a
    //    scroll listener loses a race: assigning `scrollTop` queues its scroll
    //    event for the next frame, so an 80ms stream flush can fire first, see
    //    a stale "still at the bottom", scroll back down, and the reader's
    //    scroll is undone before the listener ever runs. This cost me a green
    //    screenshot and a red assertion on the same code.
    //
    // Hence: measure `isAtBottom()` immediately BEFORE each DOM mutation (the
    // order matters too — new content moves the bottom), and act after.
    var state = { busy: false, unseen: 0, streamUnseen: false, lastWho: null, draft: '', disabled: false, forceFollow: false };

    /**
     * §9.2 — the count is of MESSAGES, never of render flushes. A single
     * streaming reply is one pending thing however many times it repaints, so
     * it gets its own flag and its own wording; counting flushes would tell a
     * reader "10 new messages" when one answer is being typed.
     */
    function renderJump() {
      var n = state.unseen;
      if (n > 0) {
        jump.textContent = n === 1 ? '↓ 1 new message' : '↓ ' + n + ' new messages';
      } else if (state.streamUnseen) {
        jump.textContent = '↓ new reply below';
      }
      jump.hidden = !(n > 0 || state.streamUnseen);
    }
    function setUnseen(n) { state.unseen = n; if (n === 0) state.streamUnseen = false; renderJump(); }

    /** The whole of §9.1, in one place. */
    function follow(wasAtBottom) {
      if (wasAtBottom) { toBottom(thread, false); setUnseen(0); }
      else setUnseen(state.unseen + 1);
    }

    jump.addEventListener('click', function () {
      toBottom(thread, true);          // §9.5 user-initiated → smooth
      setUnseen(0);
      if (input) input.focus();
    });

    // The listener only clears the badge when the reader gets back to the
    // bottom under their own steam. It is deliberately NOT the source of truth
    // for the scroll decision — see the note on `state` above.
    scrollerFor(thread).addEventListener('scroll', function () {
      if (isAtBottom(thread)) setUnseen(0);
    });

    // ── message construction ────────────────────────────────────────────────

    function append(o) {
      var atBottom = state.forceFollow || isAtBottom(thread);
      state.forceFollow = false;
      // §4.5 — identity once per group. A no-op on strictly alternating
      // transcripts (S1/S4), which is why no surface has to configure it.
      var stacked = state.lastWho === o.who;
      var li = window.ChatUI.appendMessage(thread, {
        who: o.who,
        whoState: o.whoState,
        self: !!o.self,
        html: '<span class="chat-msg__text' + (markdown ? ' chat-md' : '') + '"></span>',
        time: o.time,
        liClass: (o.liClass || '') + (stacked ? ' chat-msg--stacked' : ''),
        testId: o.testId,
        reveal: false                    // see the header note: the scroll decision is ours
      });
      state.lastWho = o.who;
      var body = li.querySelector('.chat-msg__text');
      renderBody(body, o.text || '', markdown && o.markdown !== false);
      if (o.settled !== false) enhanceCodeBlocks(li);
      addActions(li, body);
      follow(atBottom);
      return { li: li, body: body };
    }

    /** §4.6 — quiet at rest, present on hover/focus. */
    function addActions(li, body) {
      var bar = document.createElement('div');
      bar.className = 'chat-msg__actions';
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'chat-msg__action';
      copy.textContent = 'copy';
      copy.addEventListener('click', function () { copyText(body.textContent, copy); });
      bar.appendChild(copy);
      li.appendChild(bar);
    }

    /** §7.5 — the error belongs to the failed turn, and carries its own Retry. */
    function failTurn(entry, message, retry) {
      entry.li.classList.add('chat-msg--failed');
      var old = entry.li.querySelector('.chat-msg__error');
      if (old) old.remove();
      var row = document.createElement('div');
      row.className = 'chat-msg__error';
      var txt = document.createElement('span');
      txt.textContent = message;
      row.appendChild(txt);
      if (retry) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-msg__retry';
        btn.textContent = 'Retry';         // §12 — the name survives the flow
        btn.addEventListener('click', function () {
          row.remove();
          entry.li.classList.remove('chat-msg--failed');
          retry();
        });
        row.appendChild(btn);
      }
      entry.li.appendChild(row);
      status.textContent = message;
    }

    // ── §6 composer ─────────────────────────────────────────────────────────

    var composer = opts.composer || null;
    var input = composer ? composer.querySelector('textarea, input') : null;
    var sendBtn = composer ? composer.querySelector('[data-chat-send]') : null;
    var notice = null;

    function autoGrow() {
      if (!input || input.tagName !== 'TEXTAREA') return;
      input.style.height = 'auto';
      var max = Math.min(window.innerHeight * 0.4, 8 * 24);
      input.style.height = Math.min(input.scrollHeight, max) + 'px';
      input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
    }

    function syncSend() {
      if (!sendBtn) return;
      if (state.busy && opts.onStop) {
        sendBtn.textContent = 'Stop';       // §6.4
        sendBtn.disabled = false;
        sendBtn.dataset.mode = 'stop';
      } else {
        sendBtn.textContent = opts.sendLabel || 'Send';
        sendBtn.dataset.mode = 'send';
        // §6.3 — the disabled state is RENDERED, not just enforced at click.
        sendBtn.disabled = state.disabled || state.busy || !(input && input.value.trim());
      }
    }

    function setBusy(busy) {
      state.busy = busy;
      // §6.5 — the composer is NEVER disabled during generation. Only the
      // control changes. This is the fix for task-chat.js:249-254, which
      // disables the input for the whole response and is the real reason
      // focus cannot return.
      syncSend();
    }

    function setDisabled(reason) {
      state.disabled = !!reason;
      if (!composer) return;
      if (!notice) {
        notice = document.createElement('p');
        notice.className = 'chat-notice';
        composer.parentNode.insertBefore(notice, composer);
      }
      notice.textContent = reason || '';
      notice.hidden = !reason;
      if (input) input.disabled = !!reason;   // §7.6 — blocked, and it says why
      syncSend();
    }

    /**
     * §6.6 — the draft comes back on ANY failure, whether the surface rejected
     * its own promise (S2/S3's shape) or the stream failed mid-flight (S1/S4's
     * shape). It does not come back over something the user has started typing.
     */
    function restoreDraft() {
      if (input && !input.value && state.draft) { input.value = state.draft; autoGrow(); syncSend(); }
    }

    function submit() {
      if (!input || state.busy || state.disabled) return;
      var text = input.value.trim();
      if (!text) return;

      // Sending is an explicit act of joining the live end of the conversation,
      // so this one append overrides the measurement.
      state.forceFollow = true;
      state.draft = input.value;      // §6.6 — retained, not discarded
      input.value = '';
      autoGrow();

      var turn = append({ who: youLabel, self: true, text: text, markdown: false, testId: 'chat-you' });
      input.focus();                  // §6.5 — focus returns immediately
      setBusy(true);
      status.textContent = 'sending';

      var run = function () {
        var p;
        try { p = (opts.onSend || function () {})(text, turn); }
        catch (e) { p = Promise.reject(e); }
        Promise.resolve(p).then(function () {
          state.draft = '';
          setBusy(false);
        }, function (err) {
          setBusy(false);
          // §6.6 — the draft comes back, unless the user has started a new one.
          restoreDraft();
          failTurn(turn, (err && err.message) || 'send failed', run);
          syncSend();
        });
      };
      run();
      syncSend();
    }

    if (input) {
      input.addEventListener('input', function () { autoGrow(); syncSend(); });
      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var mod = e.metaKey || e.ctrlKey;
        var wants = opts.submitKey === 'mod-enter' ? mod : (!e.shiftKey && !mod);
        if (wants) { e.preventDefault(); submit(); }   // §6.2
      });
      autoGrow();
    }
    if (sendBtn) {
      sendBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (sendBtn.dataset.mode === 'stop') { if (opts.onStop) opts.onStop(); return; }
        submit();
      });
    }
    syncSend();

    // ── public handle ───────────────────────────────────────────────────────

    var api = {
      thread: thread,
      isAtBottom: function () { return isAtBottom(thread); },
      append: append,
      note: function (text) {
        var atBottom = isAtBottom(thread);
        var li = window.ChatUI.appendNote(thread, text, { reveal: false });
        follow(atBottom);
        return li;
      },

      /** §7.4 — a streaming message handle. */
      beginStream: function (o) {
        o = o || {};
        // §9.3 — no latch. Each flush measures for itself (see the note on
        // `state` above), so the stream follows while the reader is at the
        // bottom and releases the instant they scroll away. Nothing re-pins.
        var entry = append({ who: o.who || 'agent', whoState: 'in-progress', text: '', settled: false, testId: 'chat-agent' });
        entry.body.classList.add('chat-cursor');   // §7.3 — indicator is synchronous
        status.textContent = 'responding';
        var buf = '';
        var dirty = false;
        var timer = setInterval(function () {
          if (!dirty) return;
          dirty = false;
          var wasAtBottom = isAtBottom(thread);   // measured BEFORE the mutation
          renderBody(entry.body, buf, markdown);
          if (wasAtBottom) toBottom(thread, false);
          else { state.streamUnseen = true; renderJump(); }
        }, STREAM_FLUSH_MS);

        function finish() { clearInterval(timer); entry.body.classList.remove('chat-cursor'); }

        return {
          li: entry.li,
          write: function (chunk) { buf += chunk; dirty = true; },
          done: function () {
            finish();
            var wasAtBottom = isAtBottom(thread);
            renderBody(entry.body, buf || '[no response]', markdown);
            enhanceCodeBlocks(entry.li);
            if (wasAtBottom) toBottom(thread, false);
            status.textContent = 'response complete';
            setBusy(false);
          },
          fail: function (message, retry) {
            finish();
            renderBody(entry.body, buf, markdown);
            failTurn(entry, message, retry);
            restoreDraft();
            setBusy(false);
          },
          stopped: function () {
            // Stopping is deliberate: the message WAS sent, so the draft stays
            // cleared. Only a failure hands it back.
            finish();
            renderBody(entry.body, buf, markdown);
            enhanceCodeBlocks(entry.li);
            api.note('↳ stopped by you');
            status.textContent = 'stopped';
            setBusy(false);
          }
        };
      },

      setBusy: setBusy,
      setDisabled: setDisabled,
      clear: function () { thread.innerHTML = ''; state.lastWho = null; setUnseen(0); },
      focus: function () { if (input) input.focus(); },
      draft: function () { return input ? input.value : ''; }
    };

    return api;
  }

  window.ChatUI.mount = mount;
})();
