/*
 * Copy button for the landing's agent prompt (LIN-4085).
 *
 * Static and loaded from `/`, so the page's CSP (`script-src 'self'`) allows it
 * with no hash. It adds one button in front of the prompt `<pre>`; without JS the
 * button never exists and the prompt stays selectable text. It deliberately has
 * its own selectors: app.js also runs on `/` and binds `.prompt-copy`, which mints
 * a token, so this block must not carry those classes.
 */
(function () {
  'use strict';

  var section = document.querySelector('[data-agent-prompt]');
  if (!section) return;
  var pre = section.querySelector('pre');
  if (!pre) return;

  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'lx-agent__copy';
  button.setAttribute('data-testid', 'landing-agent-prompt-copy');
  button.textContent = 'Copy prompt';
  pre.parentNode.insertBefore(button, pre);

  // Fallback for browsers without the async clipboard API (or where it refuses):
  // select the prompt so the person can copy it with the keyboard.
  function selectAndCopy(el) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand('copy');
    } catch (err) {
      return false;
    }
  }

  function copy(el) {
    var text = el.textContent || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return selectAndCopy(el); }
      );
    }
    return Promise.resolve(selectAndCopy(el));
  }

  button.addEventListener('click', function () {
    copy(pre).then(function (ok) {
      button.textContent = ok ? 'Copied' : 'Selected: press Ctrl/Cmd+C';
      window.setTimeout(function () { button.textContent = 'Copy prompt'; }, 2500);
    });
  });
})();
