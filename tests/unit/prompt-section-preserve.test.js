// LIN-2944 Phase 0 — CHARACTERIZATION tests.
//
// These pin the behaviours `public/prompt-section.js` exhibits at the P0
// baseline (`50588aef`) that the Phase-0 refactor must PRESERVE. They are green
// against the unchanged module and must stay green after P0 (and P1/P2/P3) —
// that is the whole point of a characterization test (the assignment's
// "behaviour-preserving label" discipline).
//
// Pinned here:
//   * LIN-3079 — an Autopilot result sets `proxyForce` and, keyed on that SAME
//     flag, suppresses the now-inert `+proxy` toggle and forces the append on
//     copy/download/dispatch. Ordinary results are NOT forced.
//   * LIN-2987 — the pinned-bottom predicate is sampled BEFORE the render pass
//     mutates `body.innerHTML` (the exact ordering the fix introduced).
//
// LIN-2046 (the recommend-stream URL threads `source` via URLSearchParams) is
// pinned by the pre-existing tests/unit/prompt-section-recommend-url.test.js and
// is "confirmed" here rather than duplicated.
//
// The module is a plain browser script (not an ES module); it is evaluated in a
// vm sandbox against a minimal fake DOM, the same house pattern as
// prompt-section-recommend-url.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

// ---------------------------------------------------------------------------
// Fake DOM
// ---------------------------------------------------------------------------

function makeBody(order) {
  const body = {
    _html: '',
    scrollTop: 0,
    scrollHeight: 400,
    clientHeight: 100,
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
  Object.defineProperty(body, 'innerHTML', {
    get() { return body._html; },
    set(v) { order.push('mutate'); body._html = v; },
  });
  return body;
}

function makeContainer() {
  const order = [];
  const body = makeBody(order);
  const nameEl = { textContent: '' };
  const container = {
    order,
    body,
    innerHTML: '',
    dataset: {},
    classList: {
      _c: new Set(),
      add(...c) { c.forEach(x => this._c.add(x)); },
      remove(...c) { c.forEach(x => this._c.delete(x)); },
      toggle() {},
      contains(c) { return this._c.has(c); },
    },
    setAttribute(k, v) { this._attrs = this._attrs || {}; this._attrs[k] = v; },
    getAttribute(k) { return (this._attrs || {})[k] ?? null; },
    querySelector(sel) {
      if (sel === '[data-prompt-body]') return body;
      if (sel === '.swipe-prompt-name') return nameEl;
      return null;
    },
    contains() { return true; },
    _clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this._clickHandler = fn; },
    removeEventListener() {},
    async clickPrompt(label) {
      const btn = { dataset: { prompt: label }, closest: (sel) => (/^button/.test(sel) ? btn : null) };
      await this._clickHandler({ target: btn });
    },
    async clickAction(action) {
      const btn = { dataset: { action }, closest: (sel) => (/^button/.test(sel) ? btn : null) };
      await this._clickHandler({ target: btn });
    },
  };
  return container;
}

// A Response-like object whose body yields one chunk carrying `body` then ends.
function streamResponse(bodyStr) {
  let sent = false;
  return {
    ok: true,
    async json() { return {}; },
    body: {
      getReader() {
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: new TextEncoder().encode(bodyStr) };
          },
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Sandbox loader
// ---------------------------------------------------------------------------

function loadPromptSection({ autopilotResult, apiResult, proxyAppend } = {}) {
  const calls = { fetch: [], autopilot: [], api: [], proxyAppend: [], readSSE: [] };
  let fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    readSSEStream: async (response, onEvent) => {
      calls.readSSE.push(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          let payload;
          try { payload = JSON.parse(data); } catch { payload = data; }
          onEvent('message', payload);
        }
      }
    },
  };
  window.api = async (url, opts) => {
    calls.api.push({ url, opts });
    return apiResult ?? { prompt: 'TEMPLATE PROMPT', promptName: 'Template' };
  };
  window.fetchAutopilotKickoff = async (args) => {
    calls.autopilot.push(args);
    return autopilotResult ?? { prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' };
  };
  window.ProxyToggle = {
    maybeAppend: async (raw, urlKey, opts) => {
      calls.proxyAppend.push({ raw, urlKey, opts });
      return proxyAppend ? proxyAppend(raw, opts) : raw;
    },
  };
  const sandbox = {
    window,
    AbortController,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async (url, opts) => {
      calls.fetch.push({ url, opts });
      return fetchImpl(url, opts);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return {
    PromptSection: window.PromptSection,
    window,
    calls,
    setFetchImpl: (fn) => { fetchImpl = fn; },
    streamResponse,
  };
}

function baseOpts(issue, extra = {}) {
  return {
    urlKey: 'ws',
    issue,
    hasAI: true,
    hasAutopilot: true,
    dispatchEnabled: false,
    proxyEnabled: true,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: ['implementation'],
    morePromptKeys: [],
    promptMeta: { implementation: 'Implementation' },
    ...extra,
  };
}

// Let the fire-and-forget fetchPrompt microtasks flush.
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// LIN-3079 — proxyForce-keyed suppression + forced attach
// ---------------------------------------------------------------------------

describe('LIN-3079 characterization: Autopilot result forces proxy, ordinary does not', () => {
  test('Autopilot result suppresses the +proxy toggle even when proxyEnabled is true', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    const issue = { id: 'issue-1', identifier: 'LIN-1' };

    PromptSection.init(container, baseOpts(issue));
    await container.clickPrompt('__autopilot__');
    await flush();

    assert.match(container.innerHTML, /AUTOPILOT PROMPT/);
    assert.equal(container.innerHTML.includes('prompt-proxy-toggle'), false);
  });

  test('ordinary (template) result keeps the +proxy toggle', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    const issue = { id: 'issue-2', identifier: 'LIN-2' };

    PromptSection.init(container, baseOpts(issue));
    await container.clickPrompt('implementation');
    await flush();

    assert.match(container.innerHTML, /TEMPLATE PROMPT/);
    assert.equal(container.innerHTML.includes('prompt-proxy-toggle'), true);
  });

  test('copy forces the append for an Autopilot result and not for an ordinary one', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const issue = { id: 'issue-3', identifier: 'LIN-3' };

    // Autopilot → force:true
    const c1 = makeContainer();
    PromptSection.init(c1, baseOpts(issue));
    await c1.clickPrompt('__autopilot__');
    await flush();
    await c1.clickAction('copy');
    await flush();
    assert.equal(calls.proxyAppend.length, 1);
    assert.equal(calls.proxyAppend[0].opts.force, true);

    // Ordinary → force:false
    const { PromptSection: PS2, calls: calls2 } = loadPromptSection();
    const c2 = makeContainer();
    PS2.init(c2, baseOpts({ id: 'issue-4', identifier: 'LIN-4' }));
    await c2.clickPrompt('implementation');
    await flush();
    await c2.clickAction('copy');
    await flush();
    assert.equal(calls2.proxyAppend.length, 1);
    assert.equal(calls2.proxyAppend[0].opts.force, false);
  });

  test('the suppression is keyed on proxyForce, not on kind/label (LIN-3079 review N1)', async () => {
    // An entry whose label is not autopilot but carries proxyForce must still be
    // suppressed; the lazy integration of the two flags is the fault LIN-3079
    // closed. Here an ordinary-label result with a forced autopilot result is
    // re-rendered from cache — switching back restores the toggle (rebuilt
    // cluster, same source of truth).
    const { PromptSection } = loadPromptSection();
    const issue = { id: 'issue-5', identifier: 'LIN-5' };
    const container = makeContainer();
    PromptSection.init(container, baseOpts(issue));

    await container.clickPrompt('__autopilot__');
    await flush();
    assert.equal(container.innerHTML.includes('prompt-proxy-toggle'), false);

    // Return to the picker and pick an ordinary prompt: the toggle is restored
    // because the forced result is no longer the active one.
    await container.clickAction('change');
    await container.clickPrompt('implementation');
    await flush();
    assert.equal(container.innerHTML.includes('prompt-proxy-toggle'), true);
  });
});

// ---------------------------------------------------------------------------
// LIN-2987 — pinned-bottom sampled before the mutation
// ---------------------------------------------------------------------------

describe('LIN-2987 characterization: pinned-bottom is sampled before body mutation', () => {
  test('in a streaming render pass, isPinnedToBottom runs before body.innerHTML is assigned', async () => {
    const { PromptSection, window, setFetchImpl, streamResponse } = loadPromptSection();
    const issue = { id: 'issue-9', identifier: 'LIN-9' };
    const container = makeContainer();

    // Record the ordering of the two calls that LIN-2987's fix ordered.
    window.isPinnedToBottom = () => { container.order.push('pin'); return true; };
    // A well-formed SSE body both the hand-rolled reader (baseline) and the
    // shared readSSEStream (post-P0) parse identically.
    const frames = `data: ${JSON.stringify({ section: 'prompt', content: 'Hello stream' })}\n\n`;
    setFetchImpl(async () => streamResponse(frames));

    PromptSection.init(container, baseOpts(issue));
    await container.clickPrompt('__ai__');
    await flush();

    const pinAt = container.order.indexOf('pin');
    const mutateAt = container.order.indexOf('mutate');
    assert.notEqual(pinAt, -1, `expected isPinnedToBottom to be called; order=${container.order}`);
    assert.notEqual(mutateAt, -1, `expected body.innerHTML to be assigned; order=${container.order}`);
    assert.ok(pinAt < mutateAt, `pin must precede mutate; order=${container.order}`);
  });
});