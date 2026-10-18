// Same-origin replacements for the inline `on*=` handlers the app CSP forbids
// (LIN-3420). Each listener is bound to its own element, never to `document`.
(function () {
  document.querySelectorAll('select[data-autosubmit]').forEach(function (select) {
    select.addEventListener('change', function () {
      if (select.form) select.form.submit();
    });
  });

  // One click, one POST: a second submit while the first is in flight would
  // carry the already-spent confirm nonce (LIN-1892 beat-1 note).
  document.querySelectorAll('form[data-submit-once]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      var button = form.querySelector('button[type=submit]');
      if (button.disabled) {
        event.preventDefault();
        return;
      }
      button.disabled = true;
    });
  });
})();
