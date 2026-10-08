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

// Locate the element whose opening tag matches `selector` (`[data-attr]` or
// `.class`) in an HTML string, balancing nested same-name tags. Returns the
// span of its inner HTML, or null. Enough DOM for the slot/body writes the
// module makes through `container.querySelector` (N4).
function findElement(html, selector) {
  const attr = selector.match(/^\[([\w-]+)\]$/);
  const cls = selector.match(/^\.([\w-]+)$/);
  if (!attr && !cls) return null;
  const matches = attr
    ? (tag) => new RegExp(`\\s${attr[1]}(?=[\\s=>])`).test(tag)
    : (tag) => new RegExp(`class="(?:[^"]*\\s)?${cls[1]}(?:\\s[^"]*)?"`).test(tag);
  const tagRe = /<([a-z][a-z0-9]*)\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    if (!matches(m[0])) continue;
    const openEnd = m.index + m[0].length;
    const re = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, 'gi');
    re.lastIndex = openEnd;
    let depth = 1;
    let t;
    while ((t = re.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) return { openEnd, closeStart: t.index };
    }
    return null;
  }
  return null;
}

function makeContainer() {
  const container = {
    // Every full render is an `innerHTML` assignment on the container itself;
    // `fullRenders` counts them. Element writes through querySelector splice
    // `_html` directly, so they do NOT count as a full render.
    _html: '',
    fullRenders: 0,
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.fullRenders++; },
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
    querySelector(selector) {
      if (!findElement(container._html, selector)) return null;
      const splice = (value) => {
        const at = findElement(container._html, selector);
        if (!at) return;
        container._html = container._html.slice(0, at.openEnd) + String(value) + container._html.slice(at.closeStart);
      };
      return {
        get innerHTML() {
          const at = findElement(container._html, selector);
          return at ? container._html.slice(at.openEnd, at.closeStart) : '';
        },
        set innerHTML(v) { splice(v); },
        set textContent(v) { splice(v); },
        children: [],
        scrollTop: 0,
        scrollHeight: 0,
      };
    },
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

// A gated ✦ stream (N4/T1): emits the reasoning, then holds until `release()`
// before emitting the prompt, so a test can act while the stream is in flight.
function gatedStream() {
  let release;
  const gate = new Promise((r) => { release = r; });
  return {
    release: () => release(),
    readSSEStream: async (response, onEvent) => {
      onEvent('message', { phase: 'reasoning' });
      onEvent('message', { section: 'reasoning', content: 'STREAMED REASONING' });
      await gate;
      onEvent('message', { phase: 'prompt' });
      onEvent('message', { section: 'prompt', content: 'STREAMED PROMPT' });
    },
  };
}

function promptBody(container) {
  const body = container.querySelector('[data-prompt-body]');
  return body ? body.innerHTML : '';
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
// Addendum 2 — persisted prompt memory. LIN-3341 DELIBERATELY REVERSES the
// autopilot half (FC call bf44d014): an autopilot prompt is a one-shot dispatch,
// so it is neither saved nor hydrated — a restored one brought the mislabelled
// "run this step" rung back after a reload.
// ---------------------------------------------------------------------------

describe('P0 addendum 2 REVERSED by LIN-3341: autopilot prompt memory is not restored', () => {
  test('a persisted Autopilot entry is NOT restored (idle mount) and its stale key is dropped', async () => {
    const ls = makeLocalStorage();
    const issue = { id: 'issue-7', identifier: 'LIN-7' };

    // Session 1: generate an Autopilot prompt. LIN-3341 no longer persists it.
    const first = loadPromptSection({ localStorage: ls });
    const c1 = makeContainer();
    first.PromptSection.init(c1, baseOpts(issue, { proxyEnabled: true }));
    await c1.click({ prompt: '__autopilot__' });
    await flush();
    assert.equal(ls.dump()['harbour:prompt-memory:ws:issue-7'], undefined, 'an autopilot result is never saved');

    // A legacy-style autopilot record already in storage (from before LIN-3341).
    ls.setItem('harbour:prompt-memory:ws:issue-7', JSON.stringify({
      v: 1, label: '__autopilot__', name: 'Autopilot', raw: 'AUTOPILOT PROMPT', kind: 'autopilot', proxyForce: true,
    }));

    // Session 2: a fresh module instance sharing the same storage (a reload).
    const second = loadPromptSection({ localStorage: ls });
    const c2 = makeContainer();
    second.PromptSection.init(c2, baseOpts(issue, { proxyEnabled: true, dispatchEnabled: true }));

    assert.equal(c2.getAttribute('data-phase'), 'idle', 'the autopilot prompt is NOT hydrated');
    assert.doesNotMatch(c2.innerHTML, /AUTOPILOT PROMPT/, 'no remembered autopilot prompt reappears');
    assert.equal(ls.getItem('harbour:prompt-memory:ws:issue-7'), null, 'the stale autopilot record is removed on load');
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

// ---------------------------------------------------------------------------
// P0 re-review round 3 (verdict b5b5843e): N3 is one face of a CLASS — a press
// notice whose truth is not tied to the component's phase transitions. These
// table-driven cases cover every phase × rung/setup-need × dispatch/proxy flag
// combination and the transitions between them. Asserted invariants:
//   * a notice appears ONLY after a press (never on init, incl. memory restore);
//   * a notice never survives a phase transition / a new prompt request;
//   * a notice raised in fresh renders until the next transition (N1);
//   * no setup notice sits beside an ENABLED run-step (the N3 contradiction).
// ---------------------------------------------------------------------------

describe('P0 re-review N3: the setup notice is tied to phase transitions (class closure)', () => {
  const COMBOS = [
    { dispatch: false, proxy: false },
    { dispatch: true, proxy: false },
    { dispatch: false, proxy: true },
    { dispatch: true, proxy: true },
  ];
  const noticeCount = (html) => (html.match(/opened-task-setup-notice/g) || []).length;

  function optsFor(combo, opts = {}) {
    return baseOpts(
      { id: `issue-${combo.dispatch}-${combo.proxy}`, identifier: 'LIN-60' },
      { dispatchEnabled: combo.dispatch, proxyEnabled: combo.proxy, hasAutopilot: combo.proxy, ...opts }
    );
  }

  // The setup rungs currently rendered, with the need each advertises.
  function setupRungs(html) {
    const ladder = (html.split('data-testid="opened-task-ladder"')[1] || '').split('</div>')[0];
    return [...ladder.matchAll(/data-rung="([^"]+)"[^>]*data-action="setup"[^>]*data-setup-needs="([^"]+)"/g)]
      .map((m) => ({ rung: m[1], needs: m[2] }));
  }
  function hasEnabledRunStep(html) {
    return /data-rung="run-step"[^>]*data-action="run-step"/.test(html);
  }

  for (const combo of COMBOS) {
    const label = `dispatch=${combo.dispatch} proxy=${combo.proxy}`;

    test(`[${label}] idle starts clean; each rendered setup rung raises a notice`, async () => {
      const { PromptSection } = loadPromptSection();
      const container = makeContainer();
      PromptSection.init(container, optsFor(combo));

      assert.equal(noticeCount(container.innerHTML), 0, 'init renders no notice');
      const rungs = setupRungs(container.innerHTML);
      assert.ok(rungs.length > 0, 'idle has at least one setup rung');
      for (const rung of rungs) {
        await container.click({ action: 'setup', setupNeeds: rung.needs });
        assert.equal(noticeCount(container.innerHTML), 1, `exactly one notice after pressing ${rung.rung}`);
      }
    });

    test(`[${label}] a notice raised in idle does not survive the template transition into fresh`, async () => {
      const { PromptSection } = loadPromptSection();
      const container = makeContainer();
      PromptSection.init(container, optsFor(combo));

      await container.click({ action: 'setup', setupNeeds: 'prompt' });
      assert.match(container.innerHTML, /generate a prompt first/);

      await container.click({ prompt: 'implementation' });
      await flush();

      assert.equal(container.getAttribute('data-phase'), 'fresh');
      assert.equal(noticeCount(container.innerHTML), 0, 'stale notice cleared on the transition');
      assert.equal(hasEnabledRunStep(container.innerHTML), combo.dispatch, 'no notice beside an enabled run-step');
    });

    test(`[${label}] a fresh setup-rung press shows its notice, and the next request clears it`, async () => {
      const { PromptSection } = loadPromptSection();
      const container = makeContainer();
      PromptSection.init(container, optsFor(combo));
      await container.click({ prompt: 'implementation' });
      await flush();
      assert.equal(container.getAttribute('data-phase'), 'fresh');

      const freshRungs = setupRungs(container.innerHTML);
      if (freshRungs.length > 0) {
        await container.click({ action: 'setup', setupNeeds: freshRungs[0].needs });
        assert.equal(noticeCount(container.innerHTML), 1, 'fresh press shows its notice (N1)');
      }

      await container.click({ prompt: 'implementation' });
      await flush();
      assert.equal(noticeCount(container.innerHTML), 0, 'the next request cleared the notice');
    });

    // N4/T1 (verdict a1f95b25): the streaming sub-state of fresh. No rung that
    // needs a prompt is a set-up rung while one is generating; any set-up rung
    // that remains (dispatch/proxy) raises its notice without touching the
    // streamed body; and the stream-settle transition clears that notice (the
    // S-settle mutant leaves it standing beside the now-landed prompt).
    test(`[${label}] streaming: no prompt-needing set-up rung, a press keeps the streamed body, settle clears the notice`, async () => {
      const stream = gatedStream();
      const { PromptSection } = loadPromptSection({
        readSSEStream: stream.readSSEStream,
        fetchImpl: async () => emptyStreamResponse(),
      });
      const container = makeContainer();
      PromptSection.init(container, optsFor(combo));
      await container.click({ prompt: '__ai__' });
      await flush();

      assert.equal(container.getAttribute('data-phase'), 'fresh');
      assert.ok(container.classList.contains('streaming'), 'the stream is in flight');
      assert.match(promptBody(container), /STREAMED REASONING/);
      assert.equal(container.innerHTML.includes('generate a prompt first'), false, 'never "generate a prompt first" while generating');
      const rungs = setupRungs(container.innerHTML);
      assert.equal(rungs.some((r) => r.needs === 'prompt'), false, 'no prompt-needing set-up rung while streaming');

      for (const rung of rungs) {
        await container.click({ action: 'setup', setupNeeds: rung.needs });
        assert.equal(noticeCount(container.innerHTML), 1, `pressing ${rung.rung} mid-stream shows its notice`);
        assert.match(promptBody(container), /STREAMED REASONING/, `pressing ${rung.rung} keeps the streamed body`);
      }

      stream.release();
      await flush();

      assert.equal(container.classList.contains('streaming'), false, 'the stream settled');
      assert.match(promptBody(container), /STREAMED PROMPT/);
      assert.equal(noticeCount(container.innerHTML), 0, 'the settle transition clears a mid-stream notice (T1)');
      assert.equal(hasEnabledRunStep(container.innerHTML), combo.dispatch, 'run-step is ready once the prompt lands');
    });
  }

  test('a notice raised in idle does not survive the AI-stream transition to fresh', async () => {
    const { PromptSection } = loadPromptSection({
      readSSEStream: async (response, onEvent) => {
        onEvent('message', { section: 'prompt', content: 'STREAMED' });
      },
      fetchImpl: async () => emptyStreamResponse(),
    });
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-stream', identifier: 'LIN-61' }, { dispatchEnabled: true }));

    await container.click({ action: 'setup', setupNeeds: 'prompt' });
    assert.match(container.innerHTML, /generate a prompt first/);

    await container.click({ prompt: '__ai__' });
    await flush();

    assert.equal(container.getAttribute('data-phase'), 'fresh');
    assert.equal(noticeCount(container.innerHTML), 0, 'AI stream transition clears the notice');
  });

  test('a notice raised in idle does not survive the error transition', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-err', identifier: 'LIN-62' }, { dispatchEnabled: true }));

    await container.click({ action: 'setup', setupNeeds: 'prompt' });
    await container.click({ prompt: '__ai__' }); // default fetch returns { ok: false } -> error
    await flush();

    assert.equal(container.getAttribute('data-phase'), 'error');
    assert.equal(noticeCount(container.innerHTML), 0, 'error phase renders no notice');
  });

  test('a remembered prompt restoring into fresh starts with no notice', () => {
    const ls = makeLocalStorage();
    ls.setItem('harbour:prompt-memory:ws:issue-mem', JSON.stringify({
      v: 1, label: '__ai__', name: 'AI Recommendation', raw: 'REMEMBERED', generatedAt: Date.now()
    }));
    const { PromptSection } = loadPromptSection({ localStorage: ls });
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-mem', identifier: 'LIN-63' }, { aiState: 'off' }));

    assert.equal(container.getAttribute('data-phase'), 'fresh');
    assert.equal(noticeCount(container.innerHTML), 0);
  });
});

// ---------------------------------------------------------------------------
// P0 re-review round 4 (verdict a1f95b25) N4: a set-up press updates ONLY the
// notice slot. It never re-renders the component, so it cannot clobber the
// prompt body — above all the streamed body while the ✦ stream is in flight.
// ---------------------------------------------------------------------------

describe('P0 re-review N4: a set-up press updates only the notice slot', () => {
  test('in idle, a set-up press shows its notice without a full render', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-70', identifier: 'LIN-70' }, { dispatchEnabled: true }));
    const renders = container.fullRenders;

    await container.click({ action: 'setup', setupNeeds: 'prompt' });

    assert.match(container.innerHTML, /<div class="opened-task-setup-notice">generate a prompt first<\/div>/);
    assert.equal(container.fullRenders, renders, 'no full render on a set-up press');
  });

  test('in fresh, a set-up press keeps the prompt body and does not re-render', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-71', identifier: 'LIN-71' }));
    await container.click({ prompt: 'implementation' });
    await flush();
    const renders = container.fullRenders;

    await container.click({ action: 'setup', setupNeeds: 'dispatch' });

    assert.match(container.innerHTML, /dispatch runner set up/);
    assert.equal(promptBody(container), 'TEMPLATE PROMPT');
    assert.equal(container.fullRenders, renders, 'no full render on a set-up press');
  });

  test('mid-stream, a set-up press keeps the streamed reasoning and does not re-render', async () => {
    const stream = gatedStream();
    const { PromptSection } = loadPromptSection({
      readSSEStream: stream.readSSEStream,
      fetchImpl: async () => emptyStreamResponse(),
    });
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-72', identifier: 'LIN-72' }, { dispatchEnabled: false }));
    await container.click({ prompt: '__ai__' });
    await flush();
    assert.ok(container.classList.contains('streaming'), 'the stream is in flight');
    const renders = container.fullRenders;

    await container.click({ action: 'setup', setupNeeds: 'dispatch' });

    assert.match(container.innerHTML, /dispatch runner set up/);
    assert.match(promptBody(container), /STREAMED REASONING/, 'the streamed body survives the press');
    assert.equal(container.fullRenders, renders, 'no full render on a set-up press');
    stream.release();
    await flush();
  });

  test('mid-stream, the prompt-needing rungs are inert and say a prompt is generating', async () => {
    const stream = gatedStream();
    const { PromptSection } = loadPromptSection({
      readSSEStream: stream.readSSEStream,
      fetchImpl: async () => emptyStreamResponse(),
    });
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-73', identifier: 'LIN-73' }, { dispatchEnabled: true }));
    await container.click({ prompt: '__ai__' });
    await flush();

    for (const rung of ['copy', 'run-step']) {
      const html = container.innerHTML.match(new RegExp(`<button[^>]*data-rung="${rung}"[^>]*>[\\s\\S]*?</button>`));
      assert.ok(html, `the ${rung} rung stays shown while streaming`);
      assert.match(html[0], / disabled/);
      assert.match(html[0], /generating/);
      assert.equal(/data-action=/.test(html[0]), false, `the ${rung} rung has no action while streaming`);
    }
    stream.release();
    await flush();
  });
});

// ---------------------------------------------------------------------------
// LIN-3211: the run-step rung sends a harness. The rung sits OUTSIDE the
// options panel (its ladder and the panel are siblings in the card), so a
// `btn.closest('.swipe-prompt-options')` lookup finds nothing and HEAD sends
// `harness: null`. The rung must read its own card's panel and use a non-blank
// harness from it, otherwise `claude-code`. The opencode case pins the accepted
// LIN-1094 behaviour change: the panel choice is honoured, not overridden.
// ---------------------------------------------------------------------------

describe('LIN-3211: the run-step rung sends the card panel\'s harness, else claude-code', () => {
  // `panelHarness`: what the card's panel selector holds ('' = the blank "—"
  // option). `panel: false`: no panel rendered in the card at all.
  async function pressRung({ panelHarness = 'claude-code', panel = true } = {}) {
    const { PromptSection, window, calls } = loadPromptSection();
    if (!panel) window.renderDispatchDisclosure = () => '';
    // The card's panel, as the container's scoped lookup returns it. A real
    // readDispatchExecControls reads the harness select inside the element it is
    // given and returns null for anything else (public/common.js:1263).
    window.readDispatchExecControls = (scopeEl) => (scopeEl && scopeEl.isCardPanel
      ? { model: null, harness: panelHarness || null }
      : { model: null, harness: null });
    const container = makeContainer();
    const qs = container.querySelector;
    container.querySelector = (selector) => {
      const el = qs(selector);
      if (el && selector.includes('swipe-prompt-options')) el.isCardPanel = true;
      return el;
    };
    PromptSection.init(container, baseOpts(
      { id: 'issue-3211', identifier: 'LIN-3211', url: 'https://x/3211' },
      { dispatchEnabled: true }
    ));
    await container.click({ prompt: 'implementation' });
    await flush();
    if (panel) assert.ok(container.querySelector('.swipe-prompt-options'), 'precondition: the card renders its panel');
    // The rung is in the ladder, not inside the panel: closest() on the panel
    // class finds nothing, as in the real DOM.
    const btn = {
      dataset: { action: 'run-step', target: 'cli' },
      disabled: false,
      textContent: '',
      closest: (selector) => (selector.includes('swipe-prompt-options') ? null : btn),
    };
    await container._clickHandler({ target: btn });
    await flush();
    assert.equal(calls.dispatch.length, 1, 'the rung dispatched once');
    return calls.dispatch[0];
  }

  test('default panel (claude-code preselected) → claude-code', async () => {
    assert.equal((await pressRung({ panelHarness: 'claude-code' })).harness, 'claude-code');
  });

  test('panel set to opencode → opencode (LIN-1094: the panel choice is honoured)', async () => {
    assert.equal((await pressRung({ panelHarness: 'opencode' })).harness, 'opencode');
  });

  test('panel blank ("—") → claude-code', async () => {
    assert.equal((await pressRung({ panelHarness: '' })).harness, 'claude-code');
  });

  test('no panel in the card → claude-code', async () => {
    assert.equal((await pressRung({ panel: false })).harness, 'claude-code');
  });
});

// =============================================================================
// LIN-2944 P1 F9 / addendum 7: the picker and the primary under flag states.
// Home's inline renderer (renderPromptButtons) is retired; these truth
// conditions now live in the shared component.
// =============================================================================
describe('LIN-2944 P1 F9: the picker and the primary under the flag states', () => {
  test('templates, "more" keys and custom prompts render under "other prompts"', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-pick', identifier: 'LIN-PICK' }, {
      defaultPromptKeys: ['implementation', 'plan'],
      morePromptKeys: ['retro'],
      promptMeta: { implementation: 'Implementation', plan: 'Plan', retro: 'Retro' },
      customPrompts: [{ id: 'c1', name: 'Custom One' }]
    }));

    assert.ok(container.innerHTML.includes('data-testid="other-prompts"'), 'other-prompts group present');
    assert.ok(container.innerHTML.includes('data-prompt="implementation"'), 'default template present');
    assert.ok(container.innerHTML.includes('data-prompt="plan"'), 'second default template present');
    assert.ok(container.innerHTML.includes('data-prompt="__more__"'), 'more toggle present (more key + custom prompt)');

    await container.click({ prompt: '__more__' });
    assert.ok(container.innerHTML.includes('data-prompt="retro"'), 'more-key template revealed');
    assert.ok(container.innerHTML.includes('data-prompt="custom:c1"'), 'custom prompt revealed');
  });

  test('promptButtons=false hides the templates but keeps the ✦ primary (F9)', () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-pb', identifier: 'LIN-PB' }, { promptButtons: false }));
    assert.equal(container.innerHTML.includes('data-testid="other-prompts"'), false, 'templates hidden');
    assert.ok(container.innerHTML.includes('data-testid="opened-task-go"'), '✦ primary still shown');
  });

  test('AI off by choice disables the ✦ next-step with a reason and a click spends nothing (F9)', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-ai', identifier: 'LIN-AI' }, { aiState: 'off', hasAI: false }));

    assert.match(container.innerHTML, /data-testid="opened-task-next-step"[^>]*disabled/, 'next step is disabled');
    assert.match(container.innerHTML, /data-testid="opened-task-primary-reason"[^>]*>AI suggestions are off/, 'plain-words reason shown');

    // A disabled button never fires a click (the browser guarantee); the guard in
    // handleClick is the load-bearing half, so press with a disabled synthetic button.
    const btn = { dataset: { prompt: '__ai__' }, disabled: true, textContent: '', closest: () => btn };
    await container._clickHandler({ target: btn });
    await flush();
    assert.equal(calls.fetch.length, 0, 'no recommend request from a disabled primary');
  });
});

// =============================================================================
// LIN-836 / LIN-2944 P1 / LIN-3341: the Autopilot proxy gate, re-pinned on the
// shared component. Go is the classic entry now (it dispatches directly); the
// stepper is the "other prompts" sibling.
// =============================================================================
describe('LIN-836 / LIN-2944 P1: the Autopilot proxy gate', () => {
  const issue = { id: 'issue-ap', identifier: 'LIN-AP', title: 'A task', state: { type: 'started' }, labels: { nodes: [] } };
  const mount = (extra) => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts(issue, extra));
    return container;
  };

  test('proxy on ⇒ Go is the enabled run-task entry, plus the stepper sibling', () => {
    const container = mount({ proxyEnabled: true, hasAutopilot: true, dispatchEnabled: true });
    assert.match(container.innerHTML, /data-rung="run-task"[^>]*data-action="go"/, 'Go is the enabled run-task entry');
    assert.match(container.innerHTML, /data-prompt="__autopilot_stepper__"/, 'stepper sibling renders under other prompts');
  });

  test('proxy off ⇒ Go is a set-up entry, no stepper', () => {
    const container = mount({ proxyEnabled: false, hasAutopilot: false });
    assert.match(container.innerHTML, /data-rung="run-task"[^>]*data-action="setup"/, 'Go shows ○ set up');
    assert.equal(container.innerHTML.includes('data-prompt="__autopilot__"'), false, 'no enabled Autopilot entry');
    assert.equal(container.innerHTML.includes('data-prompt="__autopilot_stepper__"'), false, 'no stepper sibling');
  });
});
