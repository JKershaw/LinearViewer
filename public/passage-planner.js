/**
 * Passage Planner page (experimental, LIN-1849).
 *
 * The kickoff prompt is rendered server-side into #passage-planner-prompt.
 * Copy-to-clipboard is the client's one behaviour. Unlike Flight Companion,
 * this prompt REQUIRES the proxy access block — there is no user-facing
 * +proxy toggle — so the copy handler always force-appends the access block
 * via the shared `ProxyToggle.maybeAppend` seam (LIN-1764) with
 * `{ force: true }` (LIN-3849: the per-user proxy switch and its
 * availability attribute are gone). On any thrown error, surface it
 * in the feedback span and leave the clipboard untouched.
 */
(function () {
  'use strict';

  async function copyPrompt() {
    const pre = document.getElementById('passage-planner-prompt');
    const btn = document.getElementById('passage-planner-copy');
    const feedback = document.getElementById('passage-planner-copy-feedback');
    if (!pre || !btn) return;
    const page = document.querySelector('.passage-planner-page');
    const urlKey = page && page.dataset.urlKey;
    let text = pre.textContent || '';
    try {
      // Forced append: the planner prompt requires the access block, so this
      // bypasses the client toggle rather than relying on a +proxy toggle
      // that this page doesn't render.
      text = await window.ProxyToggle.maybeAppend(text, urlKey, { force: true });
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
    const btn = document.getElementById('passage-planner-copy');
    if (btn) btn.addEventListener('click', copyPrompt);
  });
})();
