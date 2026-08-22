/**
 * LIN-1728 Phase 4 — unit tests for `window.ChatUI.appendOptions`
 * (public/chat.js), the option-button chat primitive.
 *
 * chat.js is a browser script (not an ES module) with no DOM dependency at
 * load time, so we vm-sandbox the REAL source (following the in-tree pattern
 * in tests/unit/reply-delivery-contract.test.js / observation-render.test.js)
 * against a minimal hand-rolled DOM shim — just enough of `document`/Element
 * for appendOptions' own usage (createElement, classList, textContent,
 * setAttribute/dataset, appendChild, addEventListener/click).
 *
 * The targeted regression this file exists for (LIN-1728 constraint: "Build
 * option-button labels as DOM text, not raw HTML; the chat HTML sink is
 * unsafe for agent-authored strings"): a decision option's `label` is
 * agent-authored (it comes straight off another session's `kind: 'decision'`
 * feedback payload) and MUST render as literal text even when it contains
 * markup — never interpreted as HTML.
 *
 * Run with: node --test tests/unit/chat-append-options.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT_JS_SRC = readFileSync(join(__dirname, '../../public/chat.js'), 'utf8');

// ─── Minimal DOM shim ───────────────────────────────────────────────────────
// Deliberately hand-rolled rather than pulling in jsdom (not a project
// dependency) — appendOptions' own DOM surface is small: createElement,
// classList add/toggle/contains, textContent, setAttribute/dataset,
// appendChild, addEventListener. No innerHTML support on purpose: a test
// that tried to read a label back out of `innerHTML` would itself be
// interpreting it as markup, defeating the point of the regression guard.

class FakeClassList {
  constructor(el) { this.el = el; this._set = new Set(); }
  add(...names) { names.forEach(n => this._set.add(n)); this._sync(); }
  remove(...names) { names.forEach(n => this._set.delete(n)); this._sync(); }
  contains(name) { return this._set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this._set.has(name) : force;
    if (on) this._set.add(name); else this._set.delete(name);
    this._sync();
    return on;
  }
  _sync() { this.el._className = Array.from(this._set).join(' '); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this._className = '';
    this._textContent = '';
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.disabled = false;
    this.type = undefined;
    this.classList = new FakeClassList(this);
  }
  get className() { return this._className; }
  set className(v) {
    this._className = v;
    this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = v; this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = value;
    }
  }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }
  click() { (this.listeners.click || []).forEach(fn => fn({ type: 'click' })); }
  querySelectorAll(selector) {
    // Only the exact selectors appendOptions'/callers' own tests need.
    const matches = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (selector === '.chat-option-btn' && child.classList.contains('chat-option-btn')) matches.push(child);
        if (selector === '.chat-options' && child.classList.contains('chat-options')) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
}

function makeDocument() {
  return { createElement: (tag) => new FakeElement(tag) };
}

function makeSandbox() {
  const sandbox = {
    window: {},
    document: makeDocument(),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CHAT_JS_SRC, sandbox, { filename: 'chat.js' });
  return sandbox;
}

describe('window.ChatUI.appendOptions (LIN-1728 Phase 4)', () => {
  test('renders one button per option as DOM text, never interpreting a markup-bearing label as HTML', () => {
    const { window, document } = makeSandbox();
    const container = document.createElement('div');
    const maliciousLabel = '<img src=x onerror="window.__pwned = true">';

    window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: maliciousLabel }],
      disposition: 'resumable',
      onSelect: () => {}
    });

    const btn = container.querySelectorAll('.chat-option-btn')[0];
    assert.ok(btn, 'expected a rendered option button');
    // The label reaches the button as literal text — textContent, not innerHTML —
    // so it can never execute or be re-interpreted as markup by a later read.
    assert.equal(btn.textContent, maliciousLabel);
    assert.equal(window.__pwned, undefined, 'the label must never execute as markup');
  });

  test('marks the recommended option and fires onSelect with (id, label) on click', () => {
    const { document, window } = makeSandbox();
    const container = document.createElement('div');
    let selected = null;

    window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }, { id: 'b', label: 'Reject' }],
      recommended: 'a',
      disposition: 'resumable',
      onSelect: (id, label) => { selected = { id, label }; }
    });

    const buttons = container.querySelectorAll('.chat-option-btn');
    assert.equal(buttons.length, 2);
    assert.ok(buttons[0].classList.contains('chat-option--recommended'));
    assert.ok(!buttons[1].classList.contains('chat-option--recommended'));

    buttons[1].click();
    assert.deepEqual(selected, { id: 'b', label: 'Reject' });
  });

  test('resumable disposition captions "Reply & continue"', () => {
    const { document, window } = makeSandbox();
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'resumable',
      onSelect: () => {}
    });
    assert.equal(wrap.children[0].textContent, 'Reply & continue');
  });

  test('gone disposition captions "Reply & start a run" — labelled honestly as a different action', () => {
    const { document, window } = makeSandbox();
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'gone',
      onSelect: () => {}
    });
    assert.equal(wrap.children[0].textContent, 'Reply & start a run');
  });

  for (const disposition of ['mid-turn', 'indeterminate']) {
    test(`${disposition} is read-only — no buttons render, onSelect is never called`, () => {
      const { document, window } = makeSandbox();
      const container = document.createElement('div');
      let called = false;

      const wrap = window.ChatUI.appendOptions(container, {
        options: [{ id: 'a', label: 'Approve' }],
        disposition,
        onSelect: () => { called = true; }
      });

      assert.ok(wrap.classList.contains('chat-options--readonly'));
      assert.equal(container.querySelectorAll('.chat-option-btn').length, 0);
      assert.equal(called, false);
    });
  }

  test('task-bound disposition (LIN-2215 F2) captions distinctly and is reply-eligible, not read-only', () => {
    const { document, window } = makeSandbox();
    const container = document.createElement('div');
    let called = false;
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'task-bound',
      onSelect: () => { called = true; }
    });
    assert.equal(wrap.children[0].textContent, 'A task raised a decision — reply to resolve it');
    assert.notEqual(wrap.children[0].textContent, 'no action available yet', 'must not fall back to the indeterminate caption (the pre-fix regression)');
    assert.ok(!wrap.classList.contains('chat-options--readonly'));
    assert.equal(container.querySelectorAll('.chat-option-btn').length, 1);

    container.querySelectorAll('.chat-option-btn')[0].click();
    assert.equal(called, true);
  });

  test('an unrecognized disposition falls back to the indeterminate caption AND is read-only (fail-safe allow-list, LIN-2215 F2)', () => {
    const { document, window } = makeSandbox();
    const container = document.createElement('div');
    let called = false;
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'some-future-disposition',
      onSelect: () => { called = true; }
    });
    assert.equal(wrap.children[0].textContent, 'no action available yet');
    assert.ok(wrap.classList.contains('chat-options--readonly'));
    assert.equal(container.querySelectorAll('.chat-option-btn').length, 0);
    assert.equal(called, false);
  });

  test('no options and a repliable disposition still renders read-only (no dispatch attempted with nothing to press)', () => {
    const { document, window } = makeSandbox();
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [],
      disposition: 'resumable',
      onSelect: () => {}
    });
    assert.equal(container.querySelectorAll('.chat-option-btn').length, 0);
    assert.ok(wrap.classList.contains('chat-options--readonly'));
  });
});
