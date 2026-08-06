/**
 * Public Templates page (LIN-1889).
 *
 * Copy-to-clipboard is the page's one behaviour. The shared card markup
 * (lib/render-prompts.js's renderTemplateCard, also used by the authenticated
 * /prompts page) carries no copy control of its own, so this script injects
 * one button per card client-side rather than changing the shared markup.
 * No proxy/token machinery — the content is fully public and static, unlike
 * the authenticated page's `.prompt-copy` handler (public/app.js).
 */
(function () {
  'use strict';

  function addCopyButtons() {
    document.querySelectorAll('.prompt-card').forEach(function (card) {
      if (card.querySelector('.template-copy-btn')) return;
      var pre = card.querySelector('.prompt-text');
      if (!pre) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'template-copy-btn';
      btn.textContent = 'copy';
      btn.addEventListener('click', function () {
        copyTemplate(pre, btn);
      });

      var details = card.querySelector('.prompt-details');
      (details || card).insertAdjacentElement('afterend', btn);
    });
  }

  async function copyTemplate(pre, btn) {
    try {
      await navigator.clipboard.writeText(pre.textContent || '');
      btn.textContent = 'copied ✓';
    } catch (error) {
      btn.textContent = 'copy failed';
    }
    setTimeout(function () {
      btn.textContent = 'copy';
    }, 1500);
  }

  document.addEventListener('DOMContentLoaded', addCopyButtons);
})();
