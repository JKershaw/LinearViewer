/**
 * Session Page Client (LIN-1004, Phase 2 of LIN-950).
 *
 * The session page is otherwise a no-client-JS snapshot (LIN-1003). This is its
 * ONE scoped interaction: the human follow-up reply box. It POSTs a plain
 * follow-up to the existing dispatch API — the SAME call the agent-to-agent wake
 * path makes (`lib/dispatch-wake.js`), but ADDITIVE: a plain follow-up (no
 * `kind:'wake'`, no `sessionId`), so it can never collide with the wake
 * loop-guard.
 *
 * `force` is conditional on the session's OWN terminal state (LIN-1004 research
 * resolves the open question — it is a busy-guard bypass, NOT a "finalized"
 * switch):
 *   - waiting / non-terminal session → omit `force` (warm, just parked-waiting;
 *     a plain follow-up resumes it, and asserting the process is dead would be a
 *     lie).
 *   - finalized / terminal session   → `force:true` (bypass the busy-guard if a
 *     warm process lingers; harmless if already reaped — the runner still returns
 *     `[failed] no live session to resume`, which we surface honestly).
 *
 * Deliberately self-contained (raw `fetch`, no common.js/app.js dependency) to
 * keep the snapshot page's single script tiny.
 */
(function () {
  var box = document.querySelector('[data-testid="session-reply"]');
  if (!box) return;

  var textarea = box.querySelector('.sess-reply-input');
  var btn = box.querySelector('.sess-reply-send');
  var feedback = box.querySelector('.sess-reply-feedback');
  if (!textarea || !btn) return;

  var urlKey = box.dataset.urlKey;
  var sessionId = box.dataset.sessionId;
  // Never send dash/local — the server rejects a followUpTo on those anyway.
  var target = box.dataset.target === 'web' ? 'web' : 'cli';
  var terminal = box.dataset.sessionTerminal === 'true';

  function setFeedback(msg, isError) {
    if (!feedback) return;
    feedback.textContent = msg;
    feedback.className = 'sess-reply-feedback' + (isError ? ' error' : '');
  }

  function send() {
    var prompt = (textarea.value || '').trim();
    if (!prompt) {
      setFeedback('enter a reply', true);
      return;
    }
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'sending…';
    setFeedback('', false);

    // Plain human follow-up. `followUpTo` IS the session's own root dispatch id
    // (a UUID). `force` ONLY when the session is terminal — see the file header.
    var body = { prompt: prompt, followUpTo: sessionId, target: target };
    if (terminal) body.force = true;

    fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    })
      .then(function (resp) {
        if (resp.ok) return resp.json().catch(function () { return {}; });
        return resp.json().catch(function () { return {}; }).then(function (data) {
          throw new Error((data && data.error) || ('HTTP ' + resp.status));
        });
      })
      .then(function () {
        textarea.value = '';
        // Honesty: the reply is QUEUED, not delivered. A terminal session may be
        // gone; the runner reports `[failed] no live session to resume`, which
        // shows on the next page load / in the transcript.
        setFeedback(
          terminal
            ? 'reply queued — if the session has ended you’ll see “no live session to resume” in the transcript on reload'
            : 'reply queued — reload to see the session continue',
          false
        );
        btn.textContent = 'queued ✓';
      })
      .catch(function (e) {
        setFeedback('reply failed: ' + e.message, true);
        btn.textContent = 'failed';
      })
      .then(function () {
        setTimeout(function () {
          if (btn.isConnected) {
            btn.textContent = original;
            btn.disabled = false;
          }
        }, 1800);
      });
  }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    send();
  });

  // Cmd/Ctrl+Enter submits, matching common textarea affordances.
  textarea.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });
})();
