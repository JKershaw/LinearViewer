/**
 * Flight Companion page (experimental, LIN-922).
 *
 * The kickoff prompt is rendered server-side into #flight-companion-prompt.
 * Copy-to-clipboard is the client's one behaviour, appending the Workspace API
 * access block via the shared `ProxyToggle.maybeAppend` seam (LIN-1764) when
 * +proxy is on, mirroring the dashboard (public/app.js) and swipe
 * (public/prompt-section.js) copy handlers.
 */
(function () {
  'use strict';

  async function copyPrompt() {
    const pre = document.getElementById('flight-companion-prompt');
    const btn = document.getElementById('flight-companion-copy');
    const feedback = document.getElementById('flight-companion-copy-feedback');
    if (!pre || !btn) return;
    const page = document.querySelector('.flight-companion-page');
    const urlKey = page && page.dataset.urlKey;
    let text = pre.textContent || '';
    try {
      // Append the proxy block (if +proxy is on) inside the try so a failed
      // token mint surfaces as "failed" instead of silently copying a bare
      // prompt while the toggle still shows active.
      text = await window.ProxyToggle.maybeAppend(text, urlKey);
      await navigator.clipboard.writeText(text);
      btn.textContent = 'copied ✓';
      if (feedback) feedback.textContent = 'prompt copied to clipboard';
      setTimeout(function () {
        btn.textContent = 'copy prompt';
        if (feedback) feedback.textContent = '';
      }, 1500);
    } catch (error) {
      if (feedback) feedback.textContent = (error && error.message) || 'copy failed — select the text and copy manually';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('flight-companion-copy');
    if (btn) btn.addEventListener('click', copyPrompt);
  });
})();
