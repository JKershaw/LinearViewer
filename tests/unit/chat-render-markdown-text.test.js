/**
 * LIN-2670 — unit tests for `window.ChatUI.renderMarkdownText(el, rawText)`
 * (public/chat.js), the shared done-frame Markdown swap helper.
 *
 * public/chat.js is a browser script (not an ES module). It runs through
 * `loadWorld` (tests/unit/helpers/client-world.js) over the shared fake DOM
 * (tests/unit/helpers/fake-dom.js), so `el.innerHTML` is the real serialized
 * markup of the element's children, and the no-op assertions observe the
 * element as a browser would.
 *
 * `window.renderMarkdown` itself is stubbed as a recording function on the
 * world's `window` (real marked/DOMPurify behaviour is covered by
 * tests/unit/common-render-markdown.test.js and the e2e suite) — this file
 * tests the helper's OWN guard/call/sink contract, not renderMarkdown's
 * internals. `DOMPurify` and `marked` are globals, so each test passes only the
 * ones it wants present.
 *
 * Run with: node --test tests/unit/chat-render-markdown-text.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';

/**
 * A chat.js world with the stubs a test chooses. `calls` records each
 * `window.renderMarkdown` invocation's arguments.
 */
function setup({ withRenderMarkdown = true, withDOMPurify = true, withMarked = true } = {}) {
  const calls = [];
  const windowStubs = {};
  if (withRenderMarkdown) {
    windowStubs.renderMarkdown = function (...args) {
      calls.push(args);
      return '<p>RENDERED</p>';
    };
  }
  const globals = {};
  if (withDOMPurify) globals.DOMPurify = { sanitize: (html) => html };
  // The helper guards on the `marked` GLOBAL (LIN-2670 close-out, ledger L2),
  // not on anything reachable through the stubbed `window.renderMarkdown`, so
  // the world has to carry one for the rendering path to be exercised at all.
  // Never actually called here — `window.renderMarkdown` is stubbed above.
  if (withMarked) globals.marked = { parse: () => { throw new Error('marked.parse must not be reached — renderMarkdown is stubbed'); } };
  const world = loadWorld({ window: windowStubs, scripts: ['chat.js'], globals });
  return { world, calls };
}

describe('window.ChatUI.renderMarkdownText (LIN-2670)', () => {
  test('no-op on empty rawText — leaves the element untouched', () => {
    const { world } = setup();
    const el = world.document.createElement('span');
    el.textContent = 'streamed so far';

    world.window.ChatUI.renderMarkdownText(el, '');

    assert.equal(el.innerHTML, 'streamed so far', 'the rendered output is never assigned: the markup is the original text');
    assert.equal(el.children.length, 0, 'no element children are added');
    assert.equal(el.classList.contains('chat-md'), false);
    assert.equal(el.textContent, 'streamed so far', 'the streamed text is left as-is');
  });

  test('no-op when window.renderMarkdown is absent', () => {
    const { world } = setup({ withRenderMarkdown: false });
    const el = world.document.createElement('span');
    el.textContent = 'raw markdown **here**';

    world.window.ChatUI.renderMarkdownText(el, 'raw markdown **here**');

    assert.equal(el.innerHTML, 'raw markdown **here**');
    assert.equal(el.classList.contains('chat-md'), false);
    assert.equal(el.textContent, 'raw markdown **here**');
  });

  test('no-op when DOMPurify is absent, even with renderMarkdown present (the common.js:403 hazard)', () => {
    const { world, calls } = setup({ withDOMPurify: false });
    const el = world.document.createElement('span');
    el.textContent = 'raw markdown **here**';

    world.window.ChatUI.renderMarkdownText(el, 'raw markdown **here**');

    assert.equal(calls.length, 0, 'renderMarkdown must not even be called');
    assert.equal(el.innerHTML, 'raw markdown **here**');
    assert.equal(el.classList.contains('chat-md'), false);
    assert.equal(el.textContent, 'raw markdown **here**');
  });

  // LIN-2670 close-out, ledger L2. NOT a security item: with marked absent
  // `window.renderMarkdown` falls back to `escapeHtml`, whose output still
  // passes through `DOMPurify.sanitize`, and the genuinely dangerous case
  // (DOMPurify missing) is the test above. This pins a *behaviour delta*:
  // without the guard the helper still fired and still added `chat-md`,
  // whose `white-space: normal` collapses the newlines that the plain-text
  // bubble's `pre-wrap` preserves today — leaving a degraded page slightly
  // WORSE than no Markdown support at all. The guard makes that page fall
  // back to exactly today's behaviour instead.
  test('no-op when marked is absent, even with renderMarkdown and DOMPurify present (the degraded-load delta)', () => {
    const { world, calls } = setup({ withMarked: false });
    const el = world.document.createElement('span');
    el.textContent = 'line one\nline two';

    world.window.ChatUI.renderMarkdownText(el, 'line one\nline two');

    assert.equal(calls.length, 0, 'renderMarkdown must not even be called');
    assert.equal(el.innerHTML, 'line one\nline two');
    assert.equal(
      el.classList.contains('chat-md'),
      false,
      'chat-md must not be added — its white-space: normal would collapse newlines that pre-wrap keeps today',
    );
    assert.equal(el.textContent, 'line one\nline two', 'the streamed text is left exactly as-is');
  });

  test('calls window.renderMarkdown with (rawText, { breaks: true }, true) — the finding-1 opt-out', () => {
    const { world, calls } = setup();
    const el = world.document.createElement('span');

    world.window.ChatUI.renderMarkdownText(el, '# hello');

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
    const { world } = setup();
    const el = world.document.createElement('span');

    world.window.ChatUI.renderMarkdownText(el, '# hello');

    assert.equal(el.classList.contains('chat-md'), true);
  });

  test('sink identity: el.innerHTML is exactly renderMarkdown\'s return value', () => {
    const { world } = setup();
    const el = world.document.createElement('span');

    world.window.ChatUI.renderMarkdownText(el, '# hello');

    assert.equal(el.innerHTML, '<p>RENDERED</p>');
  });
});
