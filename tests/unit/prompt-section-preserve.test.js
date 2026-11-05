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
// The client runs in the shared client world (tests/unit/helpers/client-world.js). A press is `container.click`,
// which needs the control drawn. The Autopilot result is shown by `__autopilot_stepper__`: the `__autopilot__`
// label has no drawn control in production (the Go button starts a run instead of showing a result), and both
// labels take the same autopilot branch (`isAutopilotLabel`). Node identity is checked where the body is replaced.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';

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

// A spy on the `innerHTML` setter of the fake's element class: `onWrite(node)` runs before each assignment to a
// `[data-prompt-body]` node, and the write still lands in the fake tree. Returns the function that restores the setter.
// It is a spy, not a model change: the class's behaviour is untouched while the spy is installed.
function spyOnBodyWrites(anyNode, onWrite) {
  const proto = Object.getPrototypeOf(anyNode);
  const original = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
  Object.defineProperty(proto, 'innerHTML', {
    configurable: true,
    get() { return original.get.call(this); },
    set(value) {
      if (this.hasAttribute('data-prompt-body')) onWrite(this);
      original.set.call(this, value);
    },
  });
  return () => Object.defineProperty(proto, 'innerHTML', original);
}

// `memory` is the record `loadPromptMemory` reads back on mount (a `harbour:prompt-memory:` entry).
function loadPromptSection({ apiResult, proxyAppend, isPinnedToBottom, memory } = {}) {
  const calls = { fetch: [], autopilot: [], api: [], proxyAppend: [], readSSE: [] };
  let fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  const store = new Map();
  if (memory) store.set(`harbour:prompt-memory:ws:${memory.issueId}`, JSON.stringify(memory.record));
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
    api: async (url, opts) => {
      calls.api.push({ url, opts });
      return apiResult ?? { prompt: 'TEMPLATE PROMPT', promptName: 'Template' };
    },
    fetchAutopilotKickoff: async (args) => {
      calls.autopilot.push(args);
      return { prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' };
    },
    ProxyToggle: {
      maybeAppend: async (raw, urlKey, opts) => {
        calls.proxyAppend.push({ raw, urlKey, opts });
        return proxyAppend ? proxyAppend(raw, opts) : raw;
      },
    },
  };
  if (isPinnedToBottom) window.isPinnedToBottom = isPinnedToBottom;
  // The memory reads `window.localStorage` (prompt-section.js loadPromptMemory), so the store is a window stub.
  window.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const world = loadWorld({
    window,
    scripts: ['prompt-section.js'],
    globals: {
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout: () => {},
      fetch: async (url, opts) => {
        calls.fetch.push({ url, opts });
        return fetchImpl(url, opts);
      },
    },
  });
  return {
    PromptSection: world.PromptSection,
    makeContainer: world.makeContainer,
    window: world.window,
    calls,
    setFetchImpl: (fn) => { fetchImpl = fn; },
    streamResponse,
  };
}

function baseOpts(issue, extra = {}) {
  // LIN-3849: `runSetup` (the owner's "set up ›" rung) defaults to the old not-dispatch-enabled state.
  const o = {
    urlKey: 'ws',
    issue,
    hasAI: true,
    dispatchEnabled: false,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: ['implementation'],
    morePromptKeys: [],
    promptMeta: { implementation: 'Implementation' },
    ...extra,
  };
  return { runSetup: !o.dispatchEnabled, ...o };
}

// Let the fire-and-forget fetchPrompt microtasks flush.
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// LIN-3079 — proxyForce-keyed suppression + forced attach
// ---------------------------------------------------------------------------

describe('LIN-3079 characterization: Autopilot result forces proxy, ordinary does not', () => {
  test('Autopilot result suppresses the +proxy toggle even when proxyEnabled is true', async () => {
    const { PromptSection, makeContainer } = loadPromptSection();
    const container = makeContainer();
    const issue = { id: 'issue-1', identifier: 'LIN-1' };

    PromptSection.init(container, baseOpts(issue));
    await container.click({ prompt: '__autopilot_stepper__' });
    await flush();

    assert.match(container.querySelector('[data-prompt-body]').textContent, /AUTOPILOT PROMPT/);
    assert.equal(container.querySelector('.prompt-proxy-toggle'), null, 'no +proxy toggle is drawn');
  });

  test('ordinary (template) result keeps the +proxy toggle', async () => {
    const { PromptSection, makeContainer } = loadPromptSection();
    const container = makeContainer();
    const issue = { id: 'issue-2', identifier: 'LIN-2' };

    PromptSection.init(container, baseOpts(issue));
    await container.click({ prompt: 'implementation' });
    await flush();

    assert.match(container.querySelector('[data-prompt-body]').textContent, /TEMPLATE PROMPT/);
    assert.ok(container.querySelector('.prompt-proxy-toggle'), 'the +proxy toggle is drawn');
  });

  test('copy forces the append for an Autopilot result and not for an ordinary one', async () => {
    const { PromptSection, makeContainer, calls } = loadPromptSection();
    const issue = { id: 'issue-3', identifier: 'LIN-3' };

    // Autopilot → force:true
    const c1 = makeContainer();
    PromptSection.init(c1, baseOpts(issue));
    await c1.click({ prompt: '__autopilot_stepper__' });
    await flush();
    await c1.click({ action: 'copy' });
    await flush();
    assert.equal(calls.proxyAppend.length, 1);
    assert.equal(calls.proxyAppend[0].opts.force, true);

    // Ordinary → force:false
    const { PromptSection: PS2, makeContainer: makeContainer2, calls: calls2 } = loadPromptSection();
    const c2 = makeContainer2();
    PS2.init(c2, baseOpts({ id: 'issue-4', identifier: 'LIN-4' }));
    await c2.click({ prompt: 'implementation' });
    await flush();
    await c2.click({ action: 'copy' });
    await flush();
    assert.equal(calls2.proxyAppend.length, 1);
    assert.equal(calls2.proxyAppend[0].opts.force, false);
  });

  test('the suppression is keyed on proxyForce, not on kind/label (LIN-3079 review N1)', async () => {
    // An entry whose label is not autopilot but carries proxyForce must still be
    // suppressed; the lazy integration of the two flags is the fault LIN-3079
    // closed. The entry here is a restored prompt memory: its label is an ordinary
    // template, its kind is not autopilot (so the memory is not dropped), and only
    // `proxyForce` marks it. Without the flag, the same record keeps the toggle.
    const issue = { id: 'issue-5', identifier: 'LIN-5' };
    const memoryFor = (proxyForce) => ({
      issueId: issue.id,
      record: { v: 1, label: 'implementation', name: 'Implementation', raw: 'MEMORY PROMPT', kind: 'implementation', proxyForce, generatedAt: Date.now() },
    });

    const forced = loadPromptSection({ memory: memoryFor(true) });
    const cForced = forced.makeContainer();
    forced.PromptSection.init(cForced, baseOpts(issue));
    await flush();
    assert.match(cForced.querySelector('[data-prompt-body]').textContent, /MEMORY PROMPT/);
    assert.equal(cForced.querySelector('.prompt-proxy-toggle'), null, 'proxyForce alone suppresses the toggle');

    const plain = loadPromptSection({ memory: memoryFor(false) });
    const cPlain = plain.makeContainer();
    plain.PromptSection.init(cPlain, baseOpts(issue));
    await flush();
    assert.match(cPlain.querySelector('[data-prompt-body]').textContent, /MEMORY PROMPT/);
    assert.ok(cPlain.querySelector('.prompt-proxy-toggle'), 'the same entry without proxyForce keeps the toggle');

    // And an autopilot result suppresses it, then switching back to an ordinary prompt restores it.
    const { PromptSection, makeContainer } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-6', identifier: 'LIN-6' }));
    await container.click({ prompt: '__autopilot_stepper__' });
    await flush();
    assert.equal(container.querySelector('.prompt-proxy-toggle'), null);

    // Return to the picker and pick an ordinary prompt: the toggle is restored
    // because the forced result is no longer the active one.
    await container.click({ action: 'change' });
    await container.click({ prompt: 'implementation' });
    await flush();
    assert.ok(container.querySelector('.prompt-proxy-toggle'), 'the toggle is restored');
  });
});

// ---------------------------------------------------------------------------
// LIN-2987 — pinned-bottom sampled before the mutation
// ---------------------------------------------------------------------------

describe('LIN-2987 characterization: pinned-bottom is sampled before body mutation', () => {
  test('in a streaming render pass, isPinnedToBottom runs before body.innerHTML is assigned', async () => {
    const order = [];
    const { PromptSection, setFetchImpl, streamResponse, makeContainer } = loadPromptSection({
      isPinnedToBottom: () => { order.push('pin'); return true; },
    });
    const issue = { id: 'issue-9', identifier: 'LIN-9' };
    const container = makeContainer();

    // A well-formed SSE body both the hand-rolled reader (baseline) and the
    // shared readSSEStream (post-P0) parse identically.
    const frames = `data: ${JSON.stringify({ section: 'prompt', content: 'Hello stream' })}\n\n`;
    // The body node the pass writes to is the one it reads at the start of the pass, which a repaint can replace, so the
    // scroll values are set on that node at its first write (below), not earlier. They are plain expandos: the pinned
    // check is stubbed, so nothing here is layout; a pinned pass writes scrollTop from scrollHeight and nothing reads them.
    let writtenBody = null;
    setFetchImpl(async () => streamResponse(frames));

    PromptSection.init(container, baseOpts(issue));
    const restore = spyOnBodyWrites(container, (node) => {
      order.push('mutate');
      if (writtenBody) return;
      writtenBody = node;
      node.scrollHeight = 400;
      node.scrollTop = 0;
      node.clientHeight = 100;
    });
    try {
      await container.click({ prompt: '__ai__' });
      await flush();
    } finally {
      restore();
    }

    const pinAt = order.indexOf('pin');
    const mutateAt = order.indexOf('mutate');
    assert.notEqual(pinAt, -1, `expected isPinnedToBottom to be called; order=${order}`);
    assert.notEqual(mutateAt, -1, `expected body.innerHTML to be assigned; order=${order}`);
    assert.ok(pinAt < mutateAt, `pin must precede mutate; order=${order}`);
    assert.ok(writtenBody, 'the stream wrote the prompt body');
    assert.equal(writtenBody.scrollTop, 400, 'a pinned pass follows the expando to the bottom');
  });
});
