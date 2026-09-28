// LIN-2944 Phase 0 — RED-FIRST unit tests for the P0 addenda (1–4), grounded in
// Plan Review Verdict `15237eb1` ("Approve, conditional").
//
// These are the acceptance witnesses for the P0 refactor of
// public/prompt-section.js. They are authored against the UNCHANGED module and
// MUST fail there; the P0 commit that follows makes them green. The captured
// failing output is recorded in the PR description.
//
//   Addendum 1 — thread `source` on the template and Autopilot fetches.
//   Addendum 2 — persist the fields LIN-3079 depends on (proxyForce/kind) and
//                restore them; the appended proxy block is never persisted.
//   Addendum 3 — `idPrefix` option for the dispatch disclosure, default
//                `swipe-<issue.id>` so Swipe output stays byte-identical.
//   Addendum 4 — adopt `window.readSSEStream`; ignore non-object payloads
//                (`[DONE]`), throw on `payload.error`.
//
// Same vm-sandbox house pattern as prompt-section-recommend-url.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    dump() { return Object.fromEntries(map); },
  };
}

function makeContainer() {
  const container = {
    innerHTML: '',
    dataset: {},
    classList: {
      _c: new Set(),
      add(...c) { c.forEach(x => this._c.add(x)); },
      remove(...c) { c.forEach(x => this._c.delete(x)); },
      toggle() {},
      contains(c) { return this._c.has(c); },
    },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] ?? null; },
    querySelector() { return null; },
    contains() { return true; },
    _clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this._clickHandler = fn; },
    removeEventListener() {},
    async click(match) {
      const btn = {
        dataset: { ...match },
        disabled: false,
        textContent: '',
        closest: () => btn,
      };
      await this._clickHandler({ target: btn });
      return btn;
    },
  };
  return container;
}

function loadPromptSection({ localStorage, readSSEStream, fetchImpl } = {}) {
  const calls = {
    fetch: [], autopilot: [], api: [], disclosure: [], readSSE: [], dispatch: [],
  };
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    // Post-P0 the module must call THIS, not its own reader (addendum 4).
    readSSEStream: readSSEStream
      ? async (...args) => { calls.readSSE.push(true); return readSSEStream(...args); }
      : undefined,
  };
  window.api = async (url, opts) => {
    calls.api.push({ url, opts });
    return { prompt: 'TEMPLATE PROMPT', promptName: 'Template' };
  };
  window.fetchAutopilotKickoff = async (args) => {
    calls.autopilot.push(args);
    return { prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' };
  };
  window.ProxyToggle = {
    maybeAppend: async (raw, urlKey, opts) => (opts && opts.force ? `${raw}\n\n## Workspace API access` : raw),
  };
  window.renderDispatchDisclosure = ({ idPrefix } = {}) => {
    calls.disclosure.push(idPrefix);
    return '<div class="swipe-prompt-options"></div>';
  };
  window.readDispatchExecControls = () => ({});
  window.dispatchPrompt = async (args) => { calls.dispatch.push(args); };
  window.isPinnedToBottom = () => false;

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
      if (fetchImpl) return fetchImpl(url, opts);
      return { ok: false, json: async () => ({}) };
    },
  };
  if (localStorage) {
    sandbox.localStorage = localStorage;
    window.localStorage = localStorage;
  }
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { PromptSection: window.PromptSection, window, calls };
}

function baseOpts(issue, extra = {}) {
  return {
    urlKey: 'ws',
    issue,
    hasAI: true,
    hasAutopilot: true,
    dispatchEnabled: false,
    proxyEnabled: false,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: ['implementation'],
    morePromptKeys: [],
    promptMeta: { implementation: 'Implementation' },
    ...extra,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// A Response-like object with an empty (but valid) SSE body, so the baseline's
// own reader still completes rather than throwing on a missing body — keeping
// the addendum-4 reds about the missing readSSEStream adoption, not a harness
// artefact.
function emptyStreamResponse() {
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
            return { done: false, value: new Uint8Array() };
          },
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Addendum 1 — source threading
// ---------------------------------------------------------------------------

describe('P0 addendum 1: source is threaded on the template and Autopilot fetches', () => {
  test('template prompt URL carries ?source=jira when issue.source is set', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'JIRA-1', source: 'jira' }));
    await container.click({ prompt: 'implementation' });
    await flush();

    assert.equal(calls.api.length, 1);
    assert.match(calls.api[0].url, /\?source=jira$/);
  });

  test('template prompt URL has no query when issue.source is absent', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-2', identifier: 'LIN-2' }));
    await container.click({ prompt: 'implementation' });
    await flush();

    assert.equal(calls.api.length, 1);
    assert.equal(calls.api[0].url, '/workspace/ws/api/prompt/issue-2/implementation');
  });

  test('Autopilot kickoff is passed source=jira when issue.source is set', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-3', identifier: 'JIRA-3', source: 'jira' }));
    await container.click({ prompt: '__autopilot__' });
    await flush();

    assert.equal(calls.autopilot.length, 1);
    assert.equal(calls.autopilot[0].source, 'jira');
  });
});

// ---------------------------------------------------------------------------
// Addendum 2 — persisted prompt memory (proxyForce/kind survive; no proxy block)
// ---------------------------------------------------------------------------

describe('P0 addendum 2: prompt memory persists proxyForce/kind across a reload', () => {
  test('a persisted Autopilot entry is restored with proxyForce/kind and still suppresses +proxy', async () => {
    const ls = makeLocalStorage();
    const issue = { id: 'issue-7', identifier: 'LIN-7' };

    // Session 1: generate an Autopilot prompt (persists).
    const first = loadPromptSection({ localStorage: ls });
    const c1 = makeContainer();
    first.PromptSection.init(c1, baseOpts(issue, { proxyEnabled: true }));
    await c1.click({ prompt: '__autopilot__' });
    await flush();

    // Session 2: a fresh module instance sharing the same storage (a reload).
    const second = loadPromptSection({ localStorage: ls });
    const c2 = makeContainer();
    second.PromptSection.init(c2, baseOpts(issue, { proxyEnabled: true, dispatchEnabled: true }));

    assert.equal(c2.getAttribute('data-phase'), 'fresh');
    assert.match(c2.innerHTML, /AUTOPILOT PROMPT/);
    assert.equal(c2.innerHTML.includes('prompt-proxy-toggle'), false);

    // kind + proxyForce are carried on the record, observed through dispatch.
    await c2.click({ action: 'dispatch', target: 'cli' });
    await flush();
    assert.equal(second.calls.dispatch.length, 1);
    assert.equal(second.calls.dispatch[0].kind, 'autopilot');
    assert.equal(second.calls.dispatch[0].proxyForce, true);
  });

  test('the appended proxy block is never persisted', async () => {
    const ls = makeLocalStorage();
    const issue = { id: 'issue-8', identifier: 'LIN-8' };
    const { PromptSection } = loadPromptSection({ localStorage: ls });
    const container = makeContainer();
    PromptSection.init(container, baseOpts(issue, { proxyEnabled: true }));
    await container.click({ prompt: '__autopilot__' });
    await flush();
    await container.click({ action: 'copy' });
    await flush();

    const persisted = Object.values(ls.dump()).join('\n');
    assert.equal(persisted.includes('## Workspace API access'), false);
  });

  test('a fresh result shows "generated <age> · regenerate"', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-11', identifier: 'LIN-11' }));
    await container.click({ prompt: 'implementation' });
    await flush();

    assert.match(container.innerHTML, /generated/i);
    assert.match(container.innerHTML, /regenerate/i);
  });
});

// ---------------------------------------------------------------------------
// Addendum 3 — idPrefix
// ---------------------------------------------------------------------------

describe('P0 addendum 3: the dispatch disclosure idPrefix is caller-overridable', () => {
  test('two inits for the same issue with different prefixes yield disjoint ids', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const issue = { id: 'issue-1', identifier: 'LIN-1' };

    const a = makeContainer();
    PromptSection.init(a, baseOpts(issue, { dispatchEnabled: true, idPrefix: 'alpha' }));
    await a.click({ prompt: 'implementation' });
    await flush();

    const b = makeContainer();
    PromptSection.init(b, baseOpts(issue, { dispatchEnabled: true, idPrefix: 'beta' }));
    await b.click({ prompt: 'implementation' });
    await flush();

    assert.deepEqual(calls.disclosure, ['alpha', 'beta']);
  });

  test('the default idPrefix stays swipe-<issue.id> (Swipe output byte-identical)', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const issue = { id: 'issue-9', identifier: 'LIN-9' };
    const container = makeContainer();
    PromptSection.init(container, baseOpts(issue, { dispatchEnabled: true }));
    await container.click({ prompt: 'implementation' });
    await flush();

    assert.deepEqual(calls.disclosure, ['swipe-issue-9']);
  });
});

// ---------------------------------------------------------------------------
// Addendum 4 — readSSEStream adoption + handler contract
// ---------------------------------------------------------------------------

function aiOpts(issue) {
  return baseOpts(issue, { hasAI: true });
}

describe('P0 addendum 4: PromptSection adopts window.readSSEStream', () => {
  test('the AI stream is read through window.readSSEStream', async () => {
    const { PromptSection, calls } = loadPromptSection({
      readSSEStream: async () => {},
      fetchImpl: async () => emptyStreamResponse(),
    });
    const container = makeContainer();
    PromptSection.init(container, aiOpts({ id: 'issue-1', identifier: 'LIN-1' }));
    await container.click({ prompt: '__ai__' });
    await flush();

    assert.equal(calls.readSSE.length, 1);
  });

  test('an error frame ends in the error state (LIN-2980 propagation)', async () => {
    const { PromptSection } = loadPromptSection({
      readSSEStream: async (response, onEvent) => {
        onEvent('message', { error: 'upstream boom' });
      },
      fetchImpl: async () => emptyStreamResponse(),
    });
    const container = makeContainer();
    PromptSection.init(container, aiOpts({ id: 'issue-2', identifier: 'LIN-2' }));
    await container.click({ prompt: '__ai__' });
    await flush();

    assert.equal(container.getAttribute('data-phase'), 'error');
    assert.match(container.innerHTML, /upstream boom/);
  });

  test('a non-object [DONE] payload is ignored, and the stream settles fresh', async () => {
    const { PromptSection } = loadPromptSection({
      readSSEStream: async (response, onEvent) => {
        onEvent('message', '[DONE]');
        onEvent('message', { section: 'prompt', content: 'OK PROMPT' });
      },
      fetchImpl: async () => emptyStreamResponse(),
    });
    const container = makeContainer();
    PromptSection.init(container, aiOpts({ id: 'issue-3', identifier: 'LIN-3' }));
    await container.click({ prompt: '__ai__' });
    await flush();

    assert.equal(container.getAttribute('data-phase'), 'fresh');
    assert.match(container.innerHTML, /OK PROMPT/);
  });
});