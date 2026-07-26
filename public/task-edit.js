/**
 * Task Edit Page Client (LIN-1565).
 *
 * The page's ONE scoped script: the `form[data-inline-edit]` submit branch lifted
 * out of public/app.js (which delegated over the whole document because the form
 * was injected lazily into a tree row) and re-scoped to this page's single form.
 *
 * The request is byte-identical to the one the inline form sent — same four v1
 * fields, same `PATCH /workspace/:urlKey/api/issues/:issueId`. Only the
 * after-success behaviour differs: the inline form reloaded the tree it lived in,
 * whereas this page navigates back to the dashboard (the tree's collapse state is
 * already persisted in localStorage, so the board comes back in the reader's own
 * shape).
 *
 * Loaded AFTER common.js — window.api IS available. It surfaces errors via toast
 * and throws on non-2xx.
 *
 * Description Write/Preview toggle (LIN-1575): the textarea is the only editor —
 * Preview just renders its current value read-only via window.renderMarkdown
 * (common.js, backed by the vendored marked.min.js + purify.min.js also loaded on
 * this page). Switching tabs never mutates the textarea's value, so submit always
 * reads the raw Markdown the user actually typed, and a missing/failed
 * marked/DOMPurify load degrades renderMarkdown to escaped plain text rather than
 * breaking anything — Write always works even if Preview looks flat.
 */
(function () {
  'use strict';

  var form = document.querySelector('form[data-task-edit]');
  if (!form) return;

  var statusEl = form.querySelector('[data-task-edit-status]');
  var submitBtn = form.querySelector('[type="submit"]');

  // ── Description Write/Preview toggle ──────────────────────────────────────
  (function initDescPreview() {
    var textarea = form.querySelector('[data-testid="task-edit-description"]');
    var preview = form.querySelector('[data-task-edit-preview]');
    var writeTab = form.querySelector('[data-desc-tab="write"]');
    var previewTab = form.querySelector('[data-desc-tab="preview"]');
    if (!textarea || !preview || !writeTab || !previewTab) return;

    function showWrite() {
      preview.hidden = true;
      textarea.hidden = false;
      writeTab.setAttribute('aria-selected', 'true');
      previewTab.setAttribute('aria-selected', 'false');
      textarea.focus();
    }

    function showPreview() {
      var render = typeof window.renderMarkdown === 'function' ? window.renderMarkdown : null;
      preview.innerHTML = render ? render(textarea.value) : window.escapeHtml(textarea.value || '');
      textarea.hidden = true;
      preview.hidden = false;
      previewTab.setAttribute('aria-selected', 'true');
      writeTab.setAttribute('aria-selected', 'false');
    }

    writeTab.addEventListener('click', showWrite);
    previewTab.addEventListener('click', showPreview);
  })();

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  // Read a field by its `name`; forms expose named controls on `.elements`.
  function val(name) {
    var el = form.elements[name];
    return el ? el.value : undefined;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    // Re-entrancy guard: ignore a second submit while one is in flight (the same
    // dataset.busy guard the inline form used).
    if (form.dataset.busy === 'true') return;
    form.dataset.busy = 'true';
    if (submitBtn) submitBtn.disabled = true;

    var urlKey = form.dataset.urlKey;
    var issueId = form.dataset.issueId;

    try {
      setStatus('Saving…');

      // v1 edit body (routes/workspace-api.js PATCH). `description` is the FULL
      // body from the textarea (a full-body replace); `stateId` carries the
      // selected option's value — a state UUID where the provider has one, else
      // the state name, which is exactly what the free-text box sent before.
      var body = {
        title: val('title'),
        description: val('description'),
        stateId: val('stateId'),
        priority: Number(val('priority')),
      };

      await window.api('/workspace/' + encodeURIComponent(urlKey) + '/api/issues/' + encodeURIComponent(issueId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        toastOnError: true,
      });

      // Back to the board, which re-reads through the provider and shows the edit.
      setStatus('Saved. Returning…');
      window.location.href = '/workspace/' + encodeURIComponent(urlKey) + '/';
    } catch (err) {
      // window.api already toasted the message; surface it inline too and
      // re-enable the form for a retry (no hard crash, no lost input).
      setStatus((err && err.message) ? err.message : 'Something went wrong');
      form.dataset.busy = 'false';
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Arm the form. The renderer ships Save DISABLED so the form cannot be
  // natively submitted in the window between its markup being parsed and this
  // end-of-body script running — a submit there would GET
  // `…/edit?title=…&stateId=…` and silently discard the edit. Enabling here, and
  // only here, means the button is live exactly when the handler above is.
  if (submitBtn) submitBtn.disabled = false;
})();
