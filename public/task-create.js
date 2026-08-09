/**
 * Task Create Page Client (LIN-1973).
 *
 * The page's ONE scoped script — a single form is present at load (rendered
 * server-side from `provider.createFields()`), so this uses `querySelector`
 * rather than the document-wide delegation `public/app.js` needed for the old
 * inline form (which was injected lazily into a tree row).
 *
 * Loaded AFTER common.js — window.api IS available.
 */
(function () {
  'use strict';

  var form = document.querySelector('form[data-task-create]');
  if (!form) return;

  var statusEl = form.querySelector('[data-task-create-status]');
  var submitBtn = form.querySelector('[type="submit"]');

  // ── Linear's team→state circularity ───────────────────────────────────────
  // States are team-scoped; picking a team resubmits the page as a plain GET
  // with `?teamId=`, which re-renders with states scoped to that team. No new
  // browser-facing endpoint — the server does the resolving.
  var teamSelect = form.querySelector('select[name="teamId"]');
  if (teamSelect) {
    teamSelect.addEventListener('change', function () {
      var params = new URLSearchParams(window.location.search);
      if (teamSelect.value) {
        params.set('teamId', teamSelect.value);
      } else {
        params.delete('teamId');
      }
      window.location.search = params.toString();
    });
  }

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

    if (form.dataset.busy === 'true') return;
    form.dataset.busy = 'true';
    if (submitBtn) submitBtn.disabled = true;

    var urlKey = form.dataset.urlKey;

    try {
      setStatus('Creating…');

      // v1 create body (routes/workspace-api.js POST /api/issues). Only include
      // a field when the page actually rendered its control — i.e. the provider
      // both declared it (createFields()) and the field has a value to submit.
      // The route now REJECTS a submitted-but-undeclared stateId/priority with
      // 400, so this must never send a key the rendered form didn't carry.
      var body = { title: val('title') };
      if (form.elements['description'] !== undefined) body.description = val('description');
      if (form.elements['teamId'] !== undefined) body.teamId = val('teamId');
      if (form.elements['projectId'] !== undefined) body.projectId = val('projectId');
      if (form.elements['stateId'] !== undefined) body.stateId = val('stateId');
      if (form.elements['priority'] !== undefined) body.priority = Number(val('priority'));

      await window.api('/workspace/' + encodeURIComponent(urlKey) + '/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        toastOnError: true,
      });

      setStatus('Created. Returning…');
      window.location.href = '/workspace/' + encodeURIComponent(urlKey) + '/';
    } catch (err) {
      setStatus((err && err.message) ? err.message : 'Something went wrong');
      form.dataset.busy = 'false';
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Arm the form last, mirroring task-edit.js: the button ships disabled so a
  // submit landing before this script runs can't fall back to a native GET
  // (which would silently discard the input as a query string).
  if (submitBtn) submitBtn.disabled = false;
})();
