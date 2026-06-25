/**
 * Suggested Next Run client (experimental, LIN-603; LIN-633 UI parity).
 *
 * Drives the "suggest the next autopilot run" page: click Generate → POST to the
 * suggest endpoint → render the returned goal options as Observation-styled cards.
 * Each card shows a t-shirt size chip and a caret-collapsible body holding the goal
 * paragraph, its reasoning, and the accept/copy actions; the always-present
 * "continue until stopped" option is flagged. A single page-level expandable panel
 * shows the exact grounding context the model saw (shared across options, not
 * per-option).
 *
 * Accepting an option (LIN-640): when the proxy feature is on, each card offers an
 * inline `Dispatch ▾` disclosure (parity with the projects/swipe views) that builds
 * the autopilot kickoff via /api/autopilot-prompt and dispatches it in place via
 * window.dispatchPrompt — no navigation. When proxy is off (the kickoff endpoint is
 * proxy-gated), it falls back to the original navigate-to-/dispatch?goal= link. The
 * inline buttons use a next-run-specific `.next-run-dispatch` class, NOT app.js's
 * `.prompt-dispatch` handler — app.js isn't loaded here and that handler reads a
 * `.prompt-text` node these cards don't have.
 *
 * Visual parity with the Observation page is via reused obs-* CSS + a replicated
 * caret/collapse toggle — observation.js is NOT imported (it binds to
 * server-rendered markup; these cards are built dynamically).
 */
(function () {
  'use strict';

  var data = window.__NEXT_RUN_DATA__ || {};
  var urlKey = data.urlKey || '';

  var generateBtn = document.getElementById('next-run-generate');
  var feedbackEl = document.getElementById('next-run-feedback');
  var optionsEl = document.getElementById('next-run-options');
  var emptyState = document.getElementById('next-run-empty');
  var contextSection = document.getElementById('next-run-context-section');
  var contextToggle = document.getElementById('next-run-context-toggle');
  var contextBody = document.getElementById('next-run-context-body');

  if (!generateBtn || !optionsEl) return;

  function setFeedback(text, isError) {
    if (!feedbackEl) return;
    feedbackEl.textContent = text || '';
    feedbackEl.className = 'next-run-feedback' + (isError ? ' error' : '');
  }

  function dispatchUrl(goal) {
    var base = '/workspace/' + encodeURIComponent(urlKey) + '/dispatch';
    return goal ? base + '?goal=' + encodeURIComponent(goal) : base;
  }

  // Caret/collapse toggle — replicated from the Observation page's pattern (no
  // observation.js import). Flips `is-open` on the card and unhides its body.
  function toggleCard(li) {
    var open = !li.classList.contains('is-open');
    li.classList.toggle('is-open', open);
    var head = li.querySelector('.next-run-option-head');
    var body = li.querySelector('.next-run-option-body');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (body) body.hidden = !open;
  }

  // Unique id seed for each card's dispatch panel (aria-controls target).
  var disclosureSeq = 0;

  // Build a `Dispatch ▾` disclosure mirroring the projects-view markup
  // (lib/render.js renderDispatchDisclosure): a `.disclosure-toggle` trigger +
  // a `.prompt-options.hidden` panel of per-target buttons. The shared
  // initDisclosure() (common.js, document-delegated, auto-run on this page)
  // handles open/close; our delegated handler below does the dispatch. The
  // chosen `goal` is stamped on each button as data-goal (empty for the open
  // option) so the delegated handler can read it without per-card closures.
  function buildDispatchDisclosure(goal) {
    var panelId = 'next-run-dispatch-' + (++disclosureSeq);
    var wrap = document.createElement('span');
    wrap.className = 'next-run-dispatch-wrap';

    var targets = [
      { target: 'cli', label: 'cli' },
      { target: 'web', label: 'web' },
      { target: 'dash', label: 'dash' }
    ];
    // harbour (the `local` target) only makes sense on the operator's own box.
    if (data.isLocalhost) targets.push({ target: 'local', label: 'harbour' });

    var safeGoal = escapeHtml(goal || '');
    var btns = targets.map(function (t) {
      return '<button type="button" class="next-run-dispatch dispatch-btn" data-target="' +
        t.target + '" data-goal="' + safeGoal + '">' + escapeHtml(t.label) + '</button>';
    }).join('');

    wrap.innerHTML =
      '<button type="button" class="dispatch-disclosure disclosure-toggle next-run-dispatch-toggle" ' +
      'aria-expanded="false" aria-haspopup="true" aria-controls="' + panelId + '">Dispatch ▾</button>' +
      '<span class="prompt-options hidden" id="' + panelId + '">' + btns + '</span>';
    return wrap;
  }

  // Inline-dispatch a goal: build the autopilot kickoff (proxy-gated endpoint),
  // then dispatch it issue-less and tagged kind=autopilot, with in-place
  // sending…/dispatched!/failed feedback (mirrors app.js's .prompt-dispatch flow).
  function dispatchGoal(btn) {
    var target = btn.getAttribute('data-target') || 'cli';
    var goal = btn.getAttribute('data-goal') || '';
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'sending…';
    var query = goal ? '?goal=' + encodeURIComponent(goal) : '';
    api('/workspace/' + encodeURIComponent(urlKey) + '/api/autopilot-prompt' + query, { on401: false })
      .then(function (kickoff) {
        return dispatchPrompt({
          urlKey: urlKey,
          prompt: kickoff.prompt,
          promptName: kickoff.promptName || 'Autopilot',
          kind: kickoff.kind || 'autopilot',
          issueless: true,
          target: target
        });
      })
      .then(function () {
        btn.textContent = 'dispatched!';
        btn.classList.add('dispatched');
        setTimeout(function () {
          btn.textContent = original;
          btn.classList.remove('dispatched');
          btn.disabled = false;
        }, 1500);
      })
      .catch(function (err) {
        btn.textContent = 'failed';
        setFeedback((err && err.message) ? err.message : 'failed to dispatch', true);
        setTimeout(function () {
          btn.textContent = original;
          btn.disabled = false;
        }, 1500);
      });
  }

  function renderOptions(options) {
    optionsEl.innerHTML = '';
    if (!options || !options.length) {
      if (emptyState) {
        emptyState.textContent = '○ no suggestions returned — try again';
        emptyState.hidden = false;
      }
      return;
    }
    if (emptyState) emptyState.hidden = true;

    options.forEach(function (opt) {
      var li = document.createElement('li');
      li.className = 'next-run-option' + (opt.continueUntilStopped ? ' next-run-option-open' : '');

      var size = String(opt.size || 'M');
      var isOpen = !!opt.continueUntilStopped;
      var goalText = isOpen ? '(no goal — continue until stopped)' : (opt.goal || '');
      var preview = isOpen
        ? 'Continue until stopped'
        : (opt.goal || '').split('\n')[0].slice(0, 120);

      // Head: caret · size chip (obs-chip) · open tag · one-line goal preview.
      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'next-run-option-head';
      head.setAttribute('aria-expanded', 'false');
      head.innerHTML =
        '<span class="obs-session-caret next-run-option-caret" aria-hidden="true">▸</span>' +
        '<span class="obs-chip is-on next-run-size" title="t-shirt size estimate">' + escapeHtml(size) + '</span>' +
        (isOpen ? '<span class="next-run-open-tag">continue until stopped</span>' : '') +
        '<span class="next-run-goal-preview">' + escapeHtml(preview) + '</span>';
      head.addEventListener('click', function () { toggleCard(li); });
      li.appendChild(head);

      // Body (collapsed by default): full goal · reasoning · actions.
      var body = document.createElement('div');
      body.className = 'obs-session-body next-run-option-body';
      body.hidden = true;

      var goalEl = document.createElement('p');
      goalEl.className = 'next-run-goal';
      goalEl.textContent = goalText;
      body.appendChild(goalEl);

      if (opt.reasoning) {
        var reasonEl = document.createElement('p');
        reasonEl.className = 'next-run-reasoning obs-detail-block';
        reasonEl.innerHTML = '<span class="obs-body-lbl">why</span> ' + escapeHtml(opt.reasoning);
        body.appendChild(reasonEl);
      }

      var actions = document.createElement('div');
      actions.className = 'next-run-option-actions';

      if (data.proxyEnabled) {
        // Proxy on: offer inline dispatch options (parity with projects/swipe).
        // The open option dispatches with no goal (an open-ended stack walk).
        actions.appendChild(buildDispatchDisclosure(isOpen ? '' : opt.goal));
      } else {
        // Proxy off: the kickoff endpoint is unavailable, so keep handing the goal
        // to the dispatch page via ?goal= (its proxy-off receiver, unchanged).
        var acceptLink = document.createElement('a');
        acceptLink.className = 'action-btn save next-run-accept';
        acceptLink.href = dispatchUrl(isOpen ? '' : opt.goal);
        acceptLink.textContent = isOpen ? 'start (no goal) →' : 'send to dispatch →';
        actions.appendChild(acceptLink);
      }

      if (!isOpen && opt.goal) {
        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'action-btn next-run-copy';
        copyBtn.textContent = 'copy goal';
        copyBtn.addEventListener('click', function () {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(opt.goal).then(function () {
              copyBtn.textContent = 'copied!';
              setTimeout(function () { copyBtn.textContent = 'copy goal'; }, 1500);
            }).catch(function () {
              copyBtn.textContent = 'failed';
              setTimeout(function () { copyBtn.textContent = 'copy goal'; }, 1500);
            });
          }
        });
        actions.appendChild(copyBtn);
      }

      body.appendChild(actions);
      li.appendChild(body);
      optionsEl.appendChild(li);
    });
  }

  // Single page-level grounding panel: shows the exact context the model saw. It
  // grounds the WHOLE generation, so it is shared (one panel), not per-option.
  function renderContext(context) {
    if (!contextSection || !contextBody || !contextToggle) return;
    if (!context) {
      contextSection.hidden = true;
      return;
    }
    contextBody.textContent = context;
    contextSection.hidden = false;
    // Reset to collapsed on each fresh generation.
    contextToggle.setAttribute('aria-expanded', 'false');
    contextBody.hidden = true;
  }

  // One delegated listener for all inline dispatch buttons across all cards —
  // optionsEl persists across re-generations (renderOptions only clears its
  // innerHTML), so this binds once and survives every fresh option set.
  optionsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.next-run-dispatch');
    if (!btn || btn.disabled) return;
    dispatchGoal(btn);
  });

  if (contextToggle && contextBody) {
    contextToggle.addEventListener('click', function () {
      var open = contextToggle.getAttribute('aria-expanded') !== 'true';
      contextToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      contextBody.hidden = !open;
    });
  }

  function generate() {
    if (generateBtn.disabled) return;
    var original = generateBtn.textContent;
    generateBtn.disabled = true;
    generateBtn.textContent = 'generating…';
    setFeedback('');

    api('/workspace/' + encodeURIComponent(urlKey) + '/api/next-run/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      on401: false
    }).then(function (res) {
      renderOptions(res && res.options);
      renderContext(res && res.context);
      if (res && res.model && res.model !== 'mock') {
        setFeedback('generated with ' + res.model);
      } else {
        setFeedback('');
      }
    }).catch(function (err) {
      var msg = (err && err.message) ? err.message : 'failed to generate suggestions';
      setFeedback(msg, true);
    }).finally(function () {
      generateBtn.disabled = false;
      generateBtn.textContent = original;
    });
  }

  generateBtn.addEventListener('click', generate);
})();
