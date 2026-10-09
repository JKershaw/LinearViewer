// LIN-3401 — the opened-task component answers only controls Harbour made.
//
// The prompt body and the reasoning are rendered markdown (ticket-derived) and
// sit inside the same container as the real buttons, which keeps `data-action`
// and `data-prompt`. A button in those sinks must do nothing, and the +proxy
// toggle is bound to itself after every paint rather than by a delegated listener.
//
// Evaluated in a vm sandbox against a minimal fake DOM (house pattern, see
// prompt-section-preserve.test.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

function load() {
  const bound = [];
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async () => ({}),
    ProxyToggle: { bind: (b) => bound.push(b), maybeAppend: async (t) => t },
  };
  const sandbox = {
    window, AbortController, URLSearchParams, TextDecoder, TextEncoder,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: () => 1, clearTimeout: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { PromptSection: window.PromptSection, bound };
}

function makeContainer() {
  const slot = { innerHTML: '' };
  const realToggle = { id: 'real' };
  const container = {
    innerHTML: '', dataset: {}, slot, realToggle, queries: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    querySelector(sel) { return sel === '[data-setup-notice-slot]' ? slot : null; },
    querySelectorAll(sel) { this.queries.push(sel); return [realToggle]; },
    contains() { return true; },
    addEventListener(type, fn) { if (type === 'click') this._click = fn; },
    removeEventListener() {},
    // A press on a button; `inSink` makes it a descendant of a markdown sink.
    async press(dataset, inSink) {
      const btn = {
        dataset,
        closest: (sel) => (/^button/.test(sel) ? btn : (inSink && /data-prompt-body/.test(sel) ? {} : null)),
      };
      await this._click({ target: btn });
    },
  };
  return container;
}

const opts = {
  urlKey: 'ws', issue: { id: 'i1', identifier: 'LIN-1', title: 't' }, hasAI: true,
  dispatchEnabled: false, proxyEnabled: true, isLocalhost: false, customPrompts: [],
  defaultPromptKeys: ['implementation'], morePromptKeys: [], promptMeta: { implementation: 'Implementation' },
};

describe('PromptSection: look-alike controls in rendered markdown (LIN-3401)', () => {
  test('a real setup button acts; the same button inside a markdown sink does nothing', async () => {
    const { PromptSection } = load();
    const real = makeContainer();
    PromptSection.init(real, opts);
    await real.press({ action: 'setup', setupNeeds: 'dispatch' }, false);
    assert.ok(real.slot.innerHTML.length > 0, 'the real control answered');

    const fake = makeContainer();
    PromptSection.init(fake, opts);
    await fake.press({ action: 'setup', setupNeeds: 'dispatch' }, true);
    assert.strictEqual(fake.slot.innerHTML, '', 'the look-alike in the sink did nothing');
  });

  test('a look-alike prompt-fetch button in a sink starts no request', async () => {
    const { PromptSection } = load();
    const c = makeContainer();
    PromptSection.init(c, opts);
    await c.press({ prompt: '__autopilot__' }, true);
    assert.ok(!c.innerHTML.includes('generating'), 'did not enter the generating state');
  });

  test('every paint binds the +proxy toggle through the header template chain only', () => {
    const { PromptSection, bound } = load();
    const c = makeContainer();
    PromptSection.init(c, opts);
    assert.ok(c.queries.includes(':scope > .swipe-prompt-header > .swipe-prompt-actions > .prompt-proxy-toggle'));
    assert.deepStrictEqual(bound, [c.realToggle]);
  });
});
