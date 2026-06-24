/**
 * Suggested Next Run client (experimental, LIN-603).
 *
 * Drives the "suggest the next autopilot run" page: click Generate → POST to the
 * suggest endpoint → render the returned goal options as cards. Each card shows
 * the goal paragraph, its reasoning, and a t-shirt size; the always-present
 * "continue until stopped" option is flagged. Accepting an option hands its goal
 * to the existing dispatch launch path by navigating to the dispatch page with
 * the goal prefilled (?goal=) — no new run mechanism here.
 */
(function () {
  'use strict';

  var data = window.__NEXT_RUN_DATA__ || {};
  var urlKey = data.urlKey || '';

  var generateBtn = document.getElementById('next-run-generate');
  var feedbackEl = document.getElementById('next-run-feedback');
  var optionsEl = document.getElementById('next-run-options');
  var emptyState = document.getElementById('next-run-empty');

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

      var head = document.createElement('div');
      head.className = 'next-run-option-head';
      head.innerHTML =
        '<span class="next-run-size" title="t-shirt size estimate">' + escapeHtml(size) + '</span>' +
        (isOpen ? '<span class="next-run-open-tag">continue until stopped</span>' : '');
      li.appendChild(head);

      var goalEl = document.createElement('p');
      goalEl.className = 'next-run-goal';
      goalEl.textContent = goalText;
      li.appendChild(goalEl);

      if (opt.reasoning) {
        var reasonEl = document.createElement('p');
        reasonEl.className = 'next-run-reasoning';
        reasonEl.textContent = opt.reasoning;
        li.appendChild(reasonEl);
      }

      var actions = document.createElement('div');
      actions.className = 'next-run-option-actions';

      var acceptLink = document.createElement('a');
      acceptLink.className = 'action-btn save next-run-accept';
      acceptLink.href = dispatchUrl(isOpen ? '' : opt.goal);
      acceptLink.textContent = isOpen ? 'start (no goal) →' : 'send to dispatch →';
      actions.appendChild(acceptLink);

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

      li.appendChild(actions);
      optionsEl.appendChild(li);
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
