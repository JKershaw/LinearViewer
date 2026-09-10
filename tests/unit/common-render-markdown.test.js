/**
 * LIN-2670 — unit tests for `window.renderMarkdown`'s `keepWholeFence`
 * opt-out (public/common.js), the finding-1 ruling from the plan review.
 *
 * `stripCodeBlockWrapper` unwraps a fence that wraps a string's ENTIRE
 * content before marked ever sees it (LIN-421, for prompt-generation
 * surfaces where the fence is packaging around a document). A chat bubble's
 * contract is the opposite: a whole-answer fence is a deliberate snippet,
 * and stripping it lets marked re-interpret the snippet's own contents as
 * Markdown (a leading `#`, a `**`, ...). The third parameter opts a single
 * call site out of the strip without touching the other seven consumers or
 * the shared sanitisation chain.
 *
 * public/common.js is a browser script (not an ES module), so it's
 * vm-sandboxed with the REAL vendored public/marked.min.js alongside it —
 * this is what lets the assertions below check real `<pre>`/`<code>`/
 * `<strong>` markup rather than a hand-rolled approximation of marked's
 * behaviour. DOMPurify is stubbed as an identity pass-through: real
 * DOMPurify needs an actual `window`/`document` to build its DOM tree
 * (verified empirically — with no such window it exports its un-invoked
 * factory function, not a `.sanitize` method), and sanitisation itself is
 * untouched by this change (same bare `DOMPurify.sanitize(html)` call for
 * every consumer) — that path is exercised for real in the e2e suite via
 * Playwright/Chromium instead.
 *
 * Run with: node --test tests/unit/common-render-markdown.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');
const MARKED_SRC = readFileSync(join(__dirname, '../../public/marked.min.js'), 'utf8');

const WHOLE_FENCE = '```js\nconst a = 1; // # not a heading\n**not bold**\n```';

function makeSandbox() {
  const sandbox = {
    console,
    // Only what common.js's top-level DOMContentLoaded registration needs —
    // nothing under test here fires it.
    document: { addEventListener() {} },
  };
  // `window` aliases the sandbox itself (self-referential), matching this
  // repo's convention for vm-sandboxing common.js (see
  // tests/unit/common-team-filter-nav.test.js) — a real browser has
  // `window === globalThis`.
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // Real vendored marked — see file header for why.
  vm.runInContext(MARKED_SRC, sandbox, { filename: 'marked.min.js' });
  // Identity stub — sanitisation itself is untouched by this change and is
  // covered for real (with real DOMPurify) in the e2e suite.
  sandbox.DOMPurify = { sanitize: (html) => html };
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });
  return sandbox;
}

function counts(html) {
  return {
    pre: (html.match(/<pre[ >]/g) || []).length,
    code: (html.match(/<code[ >]/g) || []).length,
    strong: (html.match(/<strong[ >]/g) || []).length,
  };
}

describe('window.renderMarkdown keepWholeFence opt-out (LIN-2670)', () => {
  test('default (no third argument) still strips a whole-answer fence — pins today\'s behaviour for the other seven consumers', () => {
    const { window } = makeSandbox();
    const html = window.renderMarkdown(WHOLE_FENCE, { breaks: true });
    const c = counts(html);
    assert.equal(c.pre, 0, 'expected the fence to be stripped, leaving no <pre>');
    assert.equal(c.strong, 1, 'expected the stripped inner "**not bold**" to be parsed as markdown');
  });

  test('keepWholeFence=true renders the whole-answer fence as a real code block, with its markdown-looking contents left un-interpreted', () => {
    const { window } = makeSandbox();
    const html = window.renderMarkdown(WHOLE_FENCE, { breaks: true }, true);
    const c = counts(html);
    assert.equal(c.pre, 1, 'expected a real <pre> block');
    assert.equal(c.code, 1, 'expected a real <code> block');
    assert.equal(c.strong, 0, 'expected the "**not bold**" inside the fence to stay un-interpreted');
    assert.match(html, /\*\*not bold\*\*/, 'expected the literal markdown syntax to survive inside the code block');
  });

  test('keepWholeFence does not affect a fence that is NOT the whole answer (unchanged either way)', () => {
    const { window } = makeSandbox();
    const embedded = 'Try this:\n```js\nconst a = 1;\n```\nDone.';
    const withoutFlag = window.renderMarkdown(embedded, { breaks: true });
    const withFlag = window.renderMarkdown(embedded, { breaks: true }, true);
    assert.equal(withFlag, withoutFlag, 'a non-whole-string fence is untouched by stripCodeBlockWrapper either way');
    assert.equal(counts(withoutFlag).pre, 1);
  });

  test('a falsy keepWholeFence (false/undefined/0) preserves today\'s stripping behaviour', () => {
    const { window } = makeSandbox();
    const base = window.renderMarkdown(WHOLE_FENCE, { breaks: true });
    assert.equal(window.renderMarkdown(WHOLE_FENCE, { breaks: true }, false), base);
    assert.equal(window.renderMarkdown(WHOLE_FENCE, { breaks: true }, undefined), base);
  });
});
