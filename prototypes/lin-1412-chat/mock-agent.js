/**
 * mock-agent.js — the fake transport for the LIN-1412 prototypes.
 *
 * Stands in for the four real ones (S1's SSE, S2's queued dispatch, S3's Yap
 * poll, S4's SSE) so the prototype can demonstrate behaviour without a server.
 * Deliberately shaped like the real thing: token-at-a-time delivery, a first-
 * token delay you can see the thinking indicator cover, and an AbortController
 * so Stop has something real to cancel.
 */
(function () {
  'use strict';

  var ANSWER = [
    'Short answer: the check is right, the box it measures is wrong.\n\n',
    '`.collective-transcript` is a `.chat-thread` (`lib/render-collective.js:211`) with ',
    '`--chat-thread-max-height: 60vh` and `overflow-y: auto`, so **the thread is its own ',
    'scroller**. But the at-bottom test reads the window:\n\n',
    '```js\n',
    'const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;  // measures the WINDOW, not the thread — this is the bug\n',
    'if (added > 0 && nearBottom) list.lastElementChild?.scrollIntoView({ block: "end" });         // …so it fires while the reader is scrolled up inside the 60vh box\n',
    '```\n\n',
    'So a reader scrolled up *inside* the transcript, on a page that happens to sit at its ',
    'own bottom, is judged "near bottom" and yanked down.\n\n',
    '### What to change\n\n',
    '- Measure the thread, not the document: `el.scrollHeight - el.scrollTop - el.clientHeight <= 120`.\n',
    '- Fall back to the document only when the thread is not its own scroller.\n',
    '- Re-measure immediately **before** each repaint, and never cache the answer in a flag.\n\n',
    'That last point is the subtle one: a `follow` flag maintained by a scroll listener loses ',
    'a race, because assigning `scrollTop` queues its event for the next frame while a stream ',
    'flush fires on a timer — so the flush reads a stale "still at the bottom" and undoes the ',
    'scroll before the listener ever runs.\n'
  ];

  var LONG = [];
  for (var i = 1; i <= 40; i++) {
    LONG.push('line ' + i + ' — streamed at a steady cadence so you can scroll up while it runs\n');
  }

  /**
   * @param {Object} o
   * @param {Function} o.onToken   called with each chunk
   * @param {Function} o.onDone
   * @param {Function} o.onError
   * @param {string}  [o.mode]     'answer' | 'long' | 'fail'
   * @returns {{abort: Function}}
   */
  function stream(o) {
    var chunks = o.mode === 'long' ? LONG : ANSWER;
    var stopped = false;
    var idx = 0;
    var firstTokenDelay = 700;   // long enough that §7.3's indicator is visible

    var timer = setTimeout(function tick() {
      if (stopped) return;
      if (o.mode === 'fail' && idx === 3) {
        o.onError(new Error('the model returned no content (upstream 502)'));
        return;
      }
      if (idx >= chunks.length) { o.onDone(); return; }
      o.onToken(chunks[idx++]);
      timer = setTimeout(tick, o.mode === 'long' ? 140 : 90);
    }, firstTokenDelay);

    return {
      abort: function () { stopped = true; clearTimeout(timer); }
    };
  }

  /** S2's shape: nothing streams, the send either queues or it does not. */
  function queue(shouldFail) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (shouldFail) reject(new Error('reply failed: dispatch queue unreachable'));
        else resolve({ queued: true });
      }, 900);
    });
  }

  window.MockAgent = { stream: stream, queue: queue, ANSWER: ANSWER.join('') };
})();
