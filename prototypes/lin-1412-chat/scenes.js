/**
 * scenes.js — the conversation, the states, and the wiring, shared by BOTH shapes.
 *
 * Shape A (embedded panel) and Shape B (viewport-anchored full page) load this
 * same file and the same `chat-next.js`, so the only variable under test is the
 * layout. If a scene looks different between the two shapes, that difference is
 * the shape — not the content, not the behaviour, not the transport.
 */
(function () {
  'use strict';

  /**
   * @param {Object} sel  element/selector handles for the host page
   * @param {Element} sel.thread
   * @param {Element} sel.composer
   * @param {Element} sel.input
   * @param {Element} sel.send
   * @param {Element} [sel.empty]
   * @returns {Object} the mounted chat handle plus a `run(sceneName)` driver
   */
  function init(sel) {
    var live = null;         // the in-flight stream handle
    var failNext = false;    // armed once by the `error` scene

    function showEmpty(on) { if (sel.empty) sel.empty.hidden = !on; }

    var chat = window.ChatUI.mount(sel.thread, {
      composer: sel.composer,
      submitKey: 'enter',            // §6.2 — the convention the contract recommends for all four
      markdown: true,
      you: 'you',
      onSend: function (text) {
        showEmpty(false);
        return new Promise(function (resolve) {
          var s = chat.beginStream({ who: 'session' });
          var mode = failNext ? 'fail' : (/\blong\b|\bscroll\b/i.test(text) ? 'long' : 'answer');
          failNext = false;
          var run = window.MockAgent.stream({
            mode: mode,
            onToken: function (t) { s.write(t); },
            onDone: function () { live = null; s.done(); resolve(); },
            onError: function (e) {
              live = null;
              // §7.5 — the error lands on the failed turn, which carries the
              // Retry. The stream handle owns the failure (including handing
              // the draft back), so this settles rather than rejects; a
              // rejection here would put a SECOND error on the user's turn.
              s.fail(e.message, function () { chat.setBusy(true); retry(text); });
              resolve();
            }
          });
          live = { abort: run.abort, stream: s, settle: resolve };
        });
      },
      onStop: function () {            // §6.4 — present, so Stop renders
        if (!live) return;
        live.abort();
        live.stream.stopped();
        live.settle();                 // never leave the send promise dangling
        live = null;
      }
    });

    function retry(text) {
      var s = chat.beginStream({ who: 'session' });
      var run = window.MockAgent.stream({
        mode: 'answer',
        onToken: function (t) { s.write(t); },
        onDone: function () { live = null; s.done(); },
        onError: function (e) { live = null; s.fail(e.message, function () { retry(text); }); }
      });
      live = { abort: run.abort, stream: s, settle: function () {} };
    }

    function ask(text) {
      sel.input.value = text;
      sel.input.dispatchEvent(new Event('input'));
      sel.send.click();
    }

    function reset() {
      if (live) { live.abort(); live = null; }
      chat.clear();
      chat.setDisabled(null);
      chat.setBusy(false);
      showEmpty(true);
    }

    var scenes = {
      empty: reset,

      populated: function () {
        reset();
        showEmpty(false);
        chat.append({ who: 'you', self: true, text: 'why is the collective scroll check wrong?', markdown: false });
        chat.append({ who: 'session', whoState: 'in-progress', text: window.MockAgent.ANSWER });
        chat.append({ who: 'session', whoState: 'in-progress', text: 'Want me to write the failing E2E assertion for it first?' });
        chat.append({ who: 'you', self: true, text: 'yes — and keep it thread-scoped', markdown: false });
        // A settled transcript a reader would scroll back through — and the only
        // way a full-page capture shows the code block rather than the tail.
        sel.thread.scrollTop = 0;
      },

      thinking: function () {
        reset();
        showEmpty(false);
        ask('why is the collective scroll check wrong?');
      },

      long: function () {
        reset();
        showEmpty(false);
        ask('stream me a long one so I can scroll up while it runs');
      },

      error: function () {
        reset();
        showEmpty(false);
        failNext = true;
        ask('what broke in run 3?');
      },

      limited: function () {
        reset();
        showEmpty(false);
        chat.append({ who: 'you', self: true, text: 'one more question', markdown: false });
        // §7.6 — say what, and for how long, and keep the draft.
        sel.input.value = 'this draft survives the block';
        sel.input.dispatchEvent(new Event('input'));
        chat.setDisabled('Free-tier limit reached — 20/20 today. Resets at midnight UTC. Your draft is kept.');
      }
    };

    function run(name) { if (scenes[name]) scenes[name](); }

    return { chat: chat, run: run, scenes: scenes };
  }

  window.ChatScenes = { init: init };
})();
