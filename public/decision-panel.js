/**
 * The decision panel's client (LIN-3962). The markup is server-rendered (lib/components/decision-panel.js) and is the
 * only authority for the panel's structure; this file never builds it. It only toggles what the server wrote, as a row
 * changes: the suggestions and the search list follow the harness in force, effort is hidden where that harness takes
 * none, a suggestion pick sets the model input, and the suggestion that matches the model input is marked as chosen
 * (aria-pressed, LIN-3987). Where the page asks for it (Models: data-decision-autoswitch), an OpenRouter-only pick
 * switches the harness to OpenCode. Every control is a plain form field, so the page works without it.
 *
 * Loads as a classic script (public/ has no ES modules). window.DecisionPanel.sync(root) re-applies the toggles to a panel
 * a page has just re-rendered, so Home can call it after it repaints its draft.
 */
(function () {
  const field = (root, name) => root.querySelector(`[data-decision-field="${name}"]`);

  /** A hint reads only while its field is blank: a chosen value says for itself what runs. */
  function syncHints(root) {
    root.querySelectorAll('[data-decision-hint]').forEach((hint) => {
      const control = field(root, hint.getAttribute('data-decision-hint'));
      hint.hidden = !!(control && control.value);
    });
  }

  /** The suggestion the model input names is the chosen one; a value no suggestion names marks none (LIN-3987). */
  function markPicks(root) {
    const model = field(root, 'model');
    const value = model ? model.value : '';
    root.querySelectorAll('[data-decision-pick]').forEach((pick) => {
      pick.setAttribute('aria-pressed', pick.getAttribute('data-decision-pick') === value ? 'true' : 'false');
    });
  }

  /** What a typed or picked value changes on the panel: its hints and the chosen suggestion. */
  function refreshFields(root) {
    syncHints(root);
    markPicks(root);
  }

  /** Show what the harness in force needs: its suggestions, its effort, and its search list. */
  function sync(root) {
    const harness = field(root, 'harness');
    const chosen = harness ? harness.value : '';
    const inForce = chosen || root.getAttribute('data-harness-in-force') || '';
    const withoutEffort = (root.getAttribute('data-without-effort') || '').split(' ');

    const effortRow = root.querySelector('[data-decision-effort]');
    if (effortRow) {
      const noEffort = withoutEffort.includes(inForce);
      effortRow.hidden = noEffort;
      const effort = field(root, 'effort');
      if (noEffort && effort && root.hasAttribute('data-decision-clear-effort')) effort.value = '';
    }

    root.querySelectorAll('[data-decision-harness]').forEach((row) => {
      row.hidden = row.getAttribute('data-decision-harness') !== inForce;
    });

    const model = field(root, 'model');
    if (model) {
      const list = root.querySelector(`datalist[data-decision-list="${chosen || 'any'}"]`)
        || root.querySelector('datalist[data-decision-list="any"]');
      if (list) model.setAttribute('list', list.id);
    }
    refreshFields(root);
  }

  // A suggestion's button sets the model input, then tells the page the value changed, as a typed value would.
  document.addEventListener('click', (event) => {
    const pick = event.target.closest && event.target.closest('[data-decision-pick]');
    if (!pick) return;
    const root = pick.closest('[data-decision-panel]');
    const model = root && field(root, 'model');
    if (!model) return;
    model.value = pick.getAttribute('data-decision-pick');
    model.dispatchEvent(new Event('input', { bubbles: true }));
    model.dispatchEvent(new Event('change', { bubbles: true }));
  });

  document.addEventListener('change', (event) => {
    const el = event.target;
    const root = el.closest && el.closest('[data-decision-panel]');
    if (!root) return;
    const which = el.getAttribute('data-decision-field');
    if (which === 'harness') sync(root);
    else if (which) refreshFields(root);
    if (which !== 'model' || !el.value || !root.hasAttribute('data-decision-autoswitch')) return;
    // A model OpenRouter offers but Claude Code does not (only reachable from a row that names no harness) means
    // OpenCode: the harness switches, and effort goes with it. The change event tells the page's own listeners.
    const harness = field(root, 'harness');
    const claudeIds = (root.getAttribute('data-claude-ids') || '').split(' ');
    if (harness && harness.value !== 'opencode' && !claudeIds.includes(el.value)) {
      harness.value = 'opencode';
      harness.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // A typed model changes the hint and the chosen suggestion as it is typed, not only when the field loses focus.
  document.addEventListener('input', (event) => {
    const root = event.target.closest && event.target.closest('[data-decision-panel]');
    if (root && event.target.getAttribute('data-decision-field')) refreshFields(root);
  });

  window.DecisionPanel = { sync };
})();
