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

// ---------------------------------------------------------------------------
// P0 review fix-up (verdict d4b4adf7): F1 dead controls, F2 regenerate gate,
// and ledger 7 (a throwing storage). Each assertion was observed failing against
// the unfixed behaviour (stashed prompt-section.js) or an equivalent mutation,
// per the fix-up discipline; excerpts are recorded in the fix-up report.
// ---------------------------------------------------------------------------

describe('P0 fix-up F1: the ladder rungs act, and the Edit slot is not dead', () => {
  test('the enabled run-step rung dispatches the current prompt to cli', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts(
      { id: 'issue-20', identifier: 'LIN-20', url: 'https://x/20' },
      { dispatchEnabled: true }
    ));
    // Generate a prompt first (the rung only acts on an existing prompt).
    await container.click({ prompt: 'implementation' });
    await flush();
    await container.click({ action: 'run-step', target: 'cli' });
    await flush();

    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.dispatch[0].target, 'cli');
    assert.equal(calls.dispatch[0].prompt, 'TEMPLATE PROMPT');
    assert.equal(calls.dispatch[0].issue.identifier, 'LIN-20');
  });

  test('an idle run-step rung says it needs a prompt and dispatches nothing', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-21', identifier: 'LIN-21' }, { dispatchEnabled: true }));

    await container.click({ action: 'setup', setupNeeds: 'prompt' });
    await flush();

    assert.equal(calls.dispatch.length, 0);
    assert.match(container.innerHTML, /generate a prompt first/);
  });

  test('the idle copy rung is shown disabled with a reason (no silent no-op)', () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-22', identifier: 'LIN-22' }));

    assert.match(container.innerHTML, /data-rung="copy"/);
    assert.match(container.innerHTML, /data-setup-needs="prompt"/);
  });

  test('the fresh ladder does not duplicate the action cluster copy', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-23', identifier: 'LIN-23' }));
    await container.click({ prompt: 'implementation' });
    await flush();

    const ladder = container.innerHTML.split('data-testid="opened-task-ladder"')[1] || '';
    assert.equal(ladder.includes('data-rung="copy"'), false);
    // The cluster copy is still there.
    assert.match(container.innerHTML, /class="swipe-prompt-copy"/);
  });

  test('the Swipe Edit slot is hidden unless a caller supplies editUrl', () => {
    const { PromptSection } = loadPromptSection();
    const plain = makeContainer();
    PromptSection.init(plain, baseOpts({ id: 'issue-24', identifier: 'LIN-24' }));
    assert.equal(plain.innerHTML.includes('swipe-prompt-edit'), false);

    const wired = makeContainer();
    PromptSection.init(wired, baseOpts({ id: 'issue-25', identifier: 'LIN-25' }, { editUrl: 'https://x/25' }));
    assert.match(wired.innerHTML, /class="swipe-prompt-edit"/);
  });
});

describe('P0 fix-up F2: regenerate obeys the same gate as the primary', () => {
  function seededAiMemory(issueId) {
    const ls = makeLocalStorage();
    ls.setItem(`harbour:prompt-memory:ws:${issueId}`, JSON.stringify({
      v: 1, label: '__ai__', name: 'AI Recommendation', raw: 'AI PROMPT',
      reasoning: 'because', generatedAt: Date.now()
    }));
    return ls;
  }

  for (const [name, opts] of [
    ['AI off by choice', { aiState: 'off' }],
    ['unconfigured', { aiState: 'unconfigured' }],
  ]) {
    test(`a remembered AI prompt disables regenerate when ${name}`, () => {
      const ls = seededAiMemory('issue-30');
      const { PromptSection } = loadPromptSection({ localStorage: ls });
      const container = makeContainer();
      PromptSection.init(container, baseOpts({ id: 'issue-30', identifier: 'LIN-30' }, opts));

      assert.equal(container.getAttribute('data-phase'), 'fresh');
      assert.match(container.innerHTML, /<button class="opened-task-regenerate" data-prompt="__ai__" disabled/);
    });
  }

  test('a non-AI remembered prompt keeps regenerate enabled', () => {
    const ls = makeLocalStorage();
    ls.setItem('harbour:prompt-memory:ws:issue-31', JSON.stringify({
      v: 1, label: 'implementation', name: 'Implementation', raw: 'TEMPLATE', generatedAt: Date.now()
    }));
    const { PromptSection } = loadPromptSection({ localStorage: ls });
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-31', identifier: 'LIN-31' }, { aiState: 'off' }));

    assert.equal(container.getAttribute('data-phase'), 'fresh');
    assert.equal(/<button class="opened-task-regenerate"[^>]* disabled/.test(container.innerHTML), false);
  });
});

describe('P0 fix-up ledger 7: a throwing localStorage is recovered from gracefully', () => {
  test('init, generate and persist survive getItem/setItem throwing', async () => {
    const throwing = {
      getItem() { throw new Error('storage denied'); },
      setItem() { throw new Error('quota exceeded'); },
      removeItem() { throw new Error('storage denied'); },
    };
    const { PromptSection } = loadPromptSection({ localStorage: throwing });
    const container = makeContainer();

    PromptSection.init(container, baseOpts({ id: 'issue-40', identifier: 'LIN-40' }));
    assert.equal(container.getAttribute('data-phase'), 'idle');

    await container.click({ prompt: 'implementation' });
    await flush();

    assert.equal(container.getAttribute('data-phase'), 'fresh');
    assert.match(container.innerHTML, /TEMPLATE PROMPT/);
  });
});
// ---------------------------------------------------------------------------
// P0 re-review fix-up (verdict fdbefe3d): N1 (a set-up rung in fresh must say
// what it needs) and N2 (the rendered idle run-step stays a set-up rung when
// dispatch is enabled — kills mutant R7). Each observed red first (stashed
// prompt-section.js for N1; the R7 mutation for N2), then restored.
// ---------------------------------------------------------------------------

describe('P0 re-review N1: the set-up notice renders in the fresh state too', () => {
  test('pressing a set-up rung after a prompt lands shows the notice in fresh', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts(
      { id: 'issue-27', identifier: 'LIN-27' },
      { dispatchEnabled: false, proxyEnabled: false }
    ));

    await container.click({ prompt: 'implementation' });
    await flush();
    assert.equal(container.getAttribute('data-phase'), 'fresh');
    assert.equal(/opened-task-setup-notice/.test(container.innerHTML), false);

    await container.click({ action: 'setup', setupNeeds: 'dispatch' });
    await flush();

    assert.equal(container.getAttribute('data-phase'), 'fresh');
    assert.match(container.innerHTML, /opened-task-setup-notice/);
    assert.match(container.innerHTML, /dispatch runner set up/);
  });

  test('a remembered prompt restored into fresh says what a set-up rung needs', async () => {
    const ls = makeLocalStorage();
    ls.setItem('harbour:prompt-memory:ws:issue-28', JSON.stringify({
      v: 1, label: 'implementation', name: 'Implementation', raw: 'REMEMBERED', generatedAt: Date.now()
    }));
    const { PromptSection } = loadPromptSection({ localStorage: ls });
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-28', identifier: 'LIN-28' }, { dispatchEnabled: false, proxyEnabled: false }));

    assert.equal(container.getAttribute('data-phase'), 'fresh');
    // Drive the shared handler the same way the delegated click does.
    await container.click({ action: 'setup', setupNeeds: 'proxy' });
    assert.match(container.innerHTML, /opened-task-setup-notice/);
    assert.match(container.innerHTML, /proxy set up/);
  });
});

describe('P0 re-review N2: the rendered idle run-step stays a set-up rung (R7)', () => {
  test('with dispatch enabled, the rendered idle run-step carries data-action="setup"', () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-29', identifier: 'LIN-29' }, { dispatchEnabled: true }));

    const rung = container.innerHTML.match(/<button[^>]*data-rung="run-step"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(rung, 'the run-step rung is rendered');
    assert.match(rung[0], /data-action="setup"/);
    assert.match(rung[0], /set up/);
    assert.equal(/data-action="run-step"/.test(rung[0]), false);
  });
});
