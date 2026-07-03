/**
 * Flight Companion page (experimental, LIN-922).
 *
 * The page is a static stub: the kickoff prompt is rendered server-side into
 * #flight-companion-prompt. The only behaviour is a copy-to-clipboard button,
 * mirroring the Collective prompt-preview copy pattern.
 */
(function () {
  'use strict';

  function copyPrompt() {
    const pre = document.getElementById('flight-companion-prompt');
    const btn = document.getElementById('flight-companion-copy');
    const feedback = document.getElementById('flight-companion-copy-feedback');
    if (!pre || !btn) return;
    const text = pre.textContent || '';
    navigator.clipboard.writeText(text).then(function () {
      btn.textContent = 'copied ✓';
      if (feedback) feedback.textContent = 'prompt copied to clipboard';
      setTimeout(function () {
        btn.textContent = 'copy prompt';
        if (feedback) feedback.textContent = '';
      }, 1500);
    }).catch(function () {
      if (feedback) feedback.textContent = 'copy failed — select the text and copy manually';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('flight-companion-copy');
    if (btn) btn.addEventListener('click', copyPrompt);
  });
})();
