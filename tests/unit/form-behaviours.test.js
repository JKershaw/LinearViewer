/**
 * LIN-3420 — behaviour of public/form-behaviours.js, the same-origin
 * replacement for the inline `onsubmit` / `onchange` handlers the app CSP
 * blocks. Runs the real script against a minimal DOM stub; no browser.
 *
 * Run with: node --test tests/unit/form-behaviours.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = readFileSync(new URL('../../public/form-behaviours.js', import.meta.url), 'utf8');

function el(extra = {}) {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { listeners[type] = fn; },
    fire(type, event = {}) { listeners[type](event); },
    ...extra,
  };
}

function run({ forms = [], selects = [] }) {
  const document = {
    querySelectorAll: sel => (sel === 'form[data-submit-once]' ? forms : sel === 'select[data-autosubmit]' ? selects : []),
  };
  vm.runInNewContext(SCRIPT, { document });
}

describe('form[data-submit-once]', () => {
  test('first submit disables the button; a second is prevented', () => {
    const button = { disabled: false };
    const form = el({ querySelector: sel => (sel === 'button[type=submit]' ? button : null) });
    run({ forms: [form] });

    let prevented = 0;
    form.fire('submit', { preventDefault() { prevented++; } });
    assert.equal(button.disabled, true, 'button disabled after the first submit');
    assert.equal(prevented, 0, 'first submit goes through');

    form.fire('submit', { preventDefault() { prevented++; } });
    assert.equal(prevented, 1, 'second submit before navigation is preventDefaulted');
  });
});

describe('select[data-autosubmit]', () => {
  test('change submits the owning form', () => {
    let submitted = 0;
    const select = el({ form: { submit() { submitted++; } } });
    run({ selects: [select] });
    select.fire('change');
    assert.equal(submitted, 1);
  });

  test('a select with no form is a no-op', () => {
    const select = el({ form: null });
    run({ selects: [select] });
    assert.doesNotThrow(() => select.fire('change'));
  });
});
