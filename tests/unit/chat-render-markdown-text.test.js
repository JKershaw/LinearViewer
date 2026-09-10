/**
 * LIN-2670 — unit tests for `window.ChatUI.renderMarkdownText(el, rawText)`
 * (public/chat.js), the shared done-frame Markdown swap helper.
 *
 * public/chat.js is a browser script (not an ES module) with no DOM
 * dependency at load time, so we vm-sandbox the REAL source (same pattern as
 * tests/unit/chat-append-options.test.js) against a minimal hand-rolled DOM
 * shim.
 *
 * Shim extension, and why the sibling rule doesn't apply here: the shim in
 * chat-append-options.test.js deliberately omits `innerHTML` — "a test that
 * tried to read a label back out of innerHTML would itself be interpreting
 * it as markup, defeating the point of the regression guard" (that file's
 * own header). This file's `FakeElement` adds `innerHTML` as a plain
 * write-recorder: a field that stores the assigned string VERBATIM and
 * parses nothing. The assertions below check sink IDENTITY (did the exact
 * string `window.renderMarkdown` returned land in `el.innerHTML`?), never
 * content extracted back out of markup — a different question from the one
 * chat-append-options.test.js's omission guards against, so the two files'
 * shims are allowed to diverge. tests/unit/chat-append-options.test.js is
 * not touched.
 *
 * `window.renderMarkdown` itself is stubbed as a recording function on the
 * sandbox `window` (real marked/DOMPurify behaviour is covered by
 * tests/unit/common-render-markdown.test.js and the e2e suite) — this file
 * tests the helper's OWN guard/call/sink contract, not renderMarkdown's
 * internals.
 *
 * Run with: node --test tests/unit/chat-render-markdown-text.test.js
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
class FakeClassList {
  constructor(el) { this.el = el; this._set = new Set(); }
  add(...names) { names.forEach(n => this._set.add(n)); }
  remove(...names) { names.forEach(n => this._set.delete(n)); }
  contains(name) { return this._set.has(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.classList = new FakeClassList(this);
    this._textContent = '';
    // Plain write-recorder — see file header. Stores the assigned string
    // verbatim; never parsed, never queried as markup.
    this._innerHTML = null;
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = v == null ? '' : String(v); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; }
}

function makeSandbox({ withRenderMarkdown = true, withDOMPurify = true } = {}) {
  const calls = [];
  const sandbox = {
    window: {},
    document: { createElement: (tag) => new FakeElement(tag) },
    console,
  };
  if (withDOMPurify) sandbox.DOMPurify = { sanitize: (html) => html };
  vm.createContext(sandbox);
  vm.runInContext(CHAT_JS_SRC, sandbox, { filename: 'chat.js' });
  if (withRenderMarkdown) {
    sandbox.window.renderMarkdown = function (...args) {
      calls.push(args);
      return '<p>RENDERED</p>';
    };
  }
  return { sandbox, calls };
}

describe('window.ChatUI.renderMarkdownText (LIN-2670)', () => {
  test('no-op on empty rawText — leaves the element untouched', () => {
    const { sandbox } = makeSandbox();
    const el = new FakeElement('span');
    el.textContent = 'streamed so far';

    sandbox.window.ChatUI.renderMarkdownText(el, '');

    assert.equal(el.innerHTML, null, 'innerHTML must never be assigned');
    assert.equal(el.classList.contains('chat-md'), false);
    assert.equal(el.textContent, 'streamed so far', 'the streamed text is left as-is');
  });

  test('no-op when window.renderMarkdown is absent', () => {
    const { sandbox } = makeSandbox({ withRenderMarkdown: false });
    const el = new FakeElement('span');
    el.textContent = 'raw markdown **here**';

    sandbox.window.ChatUI.renderMarkdownText(el, 'raw markdown **here**');

    assert.equal(el.innerHTML, null);
    assert.equal(el.classList.contains('chat-md'), false);
    assert.equal(el.textContent, 'raw markdown **here**');
  });

  test('no-op when DOMPurify is absent, even with renderMarkdown present (the common.js:403 hazard)', () => {
    const { sandbox, calls } = makeSandbox({ withDOMPurify: false });
    const el = new FakeElement('span');
    el.textContent = 'raw markdown **here**';

    sandbox.window.ChatUI.renderMarkdownText(el, 'raw markdown **here**');

    assert.equal(calls.length, 0, 'renderMarkdown must not even be called');
    assert.equal(el.innerHTML, null);
    assert.equal(el.classList.contains('chat-md'), false);
    assert.equal(el.textContent, 'raw markdown **here**');
  });

  test('calls window.renderMarkdown with (rawText, { breaks: true }, true) — the finding-1 opt-out', () => {
    const { sandbox, calls } = makeSandbox();
    const el = new FakeElement('span');

    sandbox.window.ChatUI.renderMarkdownText(el, '# hello');

    assert.equal(calls.length, 1);
    // Field-by-field, not assert.deepEqual: the vm sandbox is a distinct
    // realm, so an object literal built inside it has a different
    // Object.prototype than one built here, and strict deepEqual treats
    // that as unequal even when every own property matches.
    const [text, opts, keepWholeFence] = calls[0];
    assert.equal(text, '# hello');
    assert.equal(opts.breaks, true);
    assert.equal(Object.keys(opts).length, 1);
    assert.equal(keepWholeFence, true, 'the finding-1 opt-out must be passed as the truthy third argument');
  });

  test('adds the chat-md class', () => {
    const { sandbox } = makeSandbox();
    const el = new FakeElement('span');

    sandbox.window.ChatUI.renderMarkdownText(el, '# hello');

    assert.equal(el.classList.contains('chat-md'), true);
  });

  test('sink identity: el.innerHTML is exactly renderMarkdown\'s return value', () => {
    const { sandbox } = makeSandbox();
    const el = new FakeElement('span');

    sandbox.window.ChatUI.renderMarkdownText(el, '# hello');

    assert.equal(el.innerHTML, '<p>RENDERED</p>');
  });
});
