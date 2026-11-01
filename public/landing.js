/**
 * Homepage "Get started" copy button (lib/render-landing.js).
 *
 * The button ships `hidden`, so a visitor without JavaScript sees the prompt as
 * plain selectable text and no dead control. Here it is revealed and copies the
 * prompt named by its `data-copy-target`. When the clipboard refuses (an
 * insecure origin, a denied permission), the prompt's text is selected instead,
 * so the visitor can copy it by hand.
 */
(function () {
  function selectText(el) {
    const selection = window.getSelection && window.getSelection();
    if (!selection || !document.createRange) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function flash(btn, text) {
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = text;
    clearTimeout(btn._flashTimer);
    btn._flashTimer = setTimeout(() => { btn.textContent = original; }, 1500);
  }

  function init() {
    document.querySelectorAll('[data-copy-target]').forEach((btn) => {
      const target = document.getElementById(btn.dataset.copyTarget);
      if (!target) return;
      btn.hidden = false;
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(target.textContent);
          flash(btn, 'copied!');
        } catch {
          selectText(target);
          flash(btn, 'press ⌘C / Ctrl+C');
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
