/**
 * LIN-3962: the decision panel client keeps each blank field's hint in step with its field (public/decision-panel.js).
 * A hint reads only while its field is blank; a chosen value or a typed model hides it, clearing it brings it back.
 *
 * Run with: node --test tests/unit/decision-panel-client-hints.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../../public/decision-panel.js', import.meta.url), 'utf8');

function panelWith(values) {
  const controls = {};
  const hints = [];
  for (const [name, value] of Object.entries(values)) {
    controls[name] = { value, getAttribute: (a) => (a === 'data-decision-field' ? name : null), setAttribute() {} };
    hints.push({ hidden: false, getAttribute: (a) => (a === 'data-decision-hint' ? name : null) });
  }
  const root = {
    getAttribute: () => null,
    hasAttribute: () => false,
    querySelector: (sel) => {
      const m = /data-decision-field="(\w+)"/.exec(sel);
      return m ? controls[m[1]] || null : null;
    },
    querySelectorAll: (sel) => (sel === '[data-decision-hint]' ? hints : [])
  };
  return { root, controls, hints };
}

function load() {
  const listeners = {};
  const window = {};
  vm.runInNewContext(SRC, { window, Event: class {}, document: { addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } } });
  return { window, listeners };
}

test('sync hides the hint of a field that has a value and shows the hint of one that is blank', () => {
  const { window } = load();
  const { root, hints } = panelWith({ harness: 'opencode', model: '', effort: '' });
  window.DecisionPanel.sync(root);
  assert.deepEqual(hints.map((h) => h.hidden), [true, false, false]);
});

test('typing a model hides its hint as it is typed, and clearing it brings the hint back', () => {
  const { listeners } = load();
  const { root, controls, hints } = panelWith({ model: '' });
  const target = { ...controls.model, closest: () => root };
  controls.model.value = 'openai/gpt-5.5';
  listeners.input.forEach((fn) => fn({ target: Object.assign(target, { value: controls.model.value }) }));
  assert.equal(hints[0].hidden, true);
  controls.model.value = '';
  listeners.input.forEach((fn) => fn({ target }));
  assert.equal(hints[0].hidden, false);
});
