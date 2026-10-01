/**
 * LIN-3098 S4 — the runner entry points on the opened-task ladder
 * (public/prompt-section.js), and N3's scoped proxyForce.
 *
 *   - "run on my machine ›" (S4b): the shared markup (runnerLinkHtml), which
 *     the card renders; the ladder itself no longer carries it in any state;
 *   - the dispatch and proxy "○ set up ›" notices keep their text and gain the
 *     same link; "generate a prompt first" stays byte-identical;
 *   - N3: the enabled run-step rung carries data-proxy-force="runner" only
 *     when proxy is on AND this browser set up a runner here (the
 *     `harbour-runner:<urlKey>` localStorage marker), and only that rung's
 *     dispatch then forces proxy access. The disclosure's dispatch buttons,
 *     the +proxy toggle and every other caller are unchanged.
 *
 * Same vm-sandbox house pattern (and harness) as prompt-section-p0.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

// ---------------------------------------------------------------------------
// harness (copied from prompt-section-p0.test.js; a .test.js file can't be
// imported without re-registering its tests)
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

const LADDER = 'data-testid="opened-task-ladder"';
const LINK = 'data-testid="opened-task-runner-link"';

// The enabled rung's data-* attributes, as the browser would hand them to the
// click handler (dataset keys camelCased).
function rungDataset(html, rung) {
  const m = html.match(new RegExp(`<button[^>]*data-rung="${rung}"[^>]*>`));
  assert.ok(m, `no ${rung} rung rendered`);
  const ds = {};
  for (const [, k, v] of m[0].matchAll(/data-([\w-]+)="([^"]*)"/g)) {
    ds[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return ds;
}

async function fresh({ localStorage, proxyEnabled = true, dispatchEnabled = true } = {}) {
  const loaded = loadPromptSection({ localStorage });
  const container = makeContainer();
  loaded.PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'LIN-1' }, { proxyEnabled, dispatchEnabled }));
  await container.click({ prompt: 'implementation' });
  await flush();
  return { ...loaded, container };
}

// LIN-3098 S4b moved the link OFF the ladder and onto the card that opens the
// task (public/swipe.js renders runnerLinkHtml under the title), shown in every
// flag state. The ladder therefore no longer carries it in any state: one link
// per card, never a duplicate when Prompts is opened. The surface tests are in
// runner-link-surfaces.test.js.
describe('"run on my machine ›": the shared markup, and no longer beside the ladder', () => {
  test('runnerLinkHtml links to /runner with the shared class and testid', () => {
    const { PromptSection } = loadPromptSection();
    assert.equal(
      PromptSection.runnerLinkHtml('ws'),
      '<a class="opened-task-runner-link" href="/workspace/ws/runner" data-testid="opened-task-runner-link">run on my machine \u203A</a>',
    );
  });

  test('the urlKey is encoded into the href', () => {
    const { PromptSection } = loadPromptSection();
    const html = PromptSection.runnerLinkHtml('a"b c');
    assert.ok(html.includes('href="/workspace/a%22b%20c/runner"'));
  });

  for (const proxyEnabled of [true, false]) {
    for (const dispatchEnabled of [true, false]) {
      test(`the component itself renders no runner link (proxy ${proxyEnabled ? 'on' : 'off'}, dispatch ${dispatchEnabled ? 'on' : 'off'}), idle or fresh`, async () => {
        const { PromptSection } = loadPromptSection();
        const container = makeContainer();
        PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'LIN-1' }, { proxyEnabled, dispatchEnabled }));
        assert.ok(container.innerHTML.includes(LADDER));
        assert.ok(!container.innerHTML.includes(LINK));
        const { container: freshContainer } = await fresh({ proxyEnabled, dispatchEnabled });
        assert.ok(!freshContainer.innerHTML.includes(LINK));
      });
    }
  }
});

describe('the ○ set up › notices', () => {
  test('dispatch: the old text, plus the link to /runner', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'LIN-1' }, { proxyEnabled: true, dispatchEnabled: false }));
    await container.click({ action: 'setup', setupNeeds: 'dispatch' });
    assert.match(container.innerHTML, /<div class="opened-task-setup-notice">running this step needs the dispatch runner set up <a [^>]*href="\/workspace\/ws\/runner"[^>]*data-testid="opened-task-setup-runner-link"/);
  });

  test('proxy: the old text, plus the link (shown even with proxy off: /runner explains the flag)', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'LIN-1' }, { proxyEnabled: false }));
    await container.click({ action: 'setup', setupNeeds: 'proxy' });
    assert.match(container.innerHTML, /<div class="opened-task-setup-notice">running the whole task needs the proxy set up <a [^>]*href="\/workspace\/ws\/runner"/);
  });

  test('"generate a prompt first" stays byte-identical, with no link', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'LIN-1' }, { dispatchEnabled: true, proxyEnabled: true }));
    await container.click({ action: 'setup', setupNeeds: 'prompt' });
    assert.match(container.innerHTML, /<div class="opened-task-setup-notice">generate a prompt first<\/div>/);
  });
});

describe('N3: proxyForce only on the run-step rung, only where a runner was set up', () => {
  const marked = () => { const ls = makeLocalStorage(); ls.setItem('harbour-runner:ws', '1'); return ls; };

  test('marker + proxy on: the enabled run-step rung carries data-proxy-force="runner"', async () => {
    const { container } = await fresh({ localStorage: marked() });
    assert.equal(rungDataset(container.innerHTML, 'run-step').proxyForce, 'runner');
  });

  test('no marker: no stamp', async () => {
    const { container } = await fresh({ localStorage: makeLocalStorage() });
    assert.equal(rungDataset(container.innerHTML, 'run-step').proxyForce, undefined);
  });

  test('marker but proxy off: no stamp', async () => {
    const { container } = await fresh({ localStorage: marked(), proxyEnabled: false });
    assert.equal(rungDataset(container.innerHTML, 'run-step').proxyForce, undefined);
  });

  test('a marker for another workspace does not count', async () => {
    const ls = makeLocalStorage();
    ls.setItem('harbour-runner:other', '1');
    const { container } = await fresh({ localStorage: ls });
    assert.equal(rungDataset(container.innerHTML, 'run-step').proxyForce, undefined);
  });

  test('a throwing localStorage is treated as no marker', async () => {
    const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
    const { container } = await fresh({ localStorage: throwing });
    assert.equal(rungDataset(container.innerHTML, 'run-step').proxyForce, undefined);
  });

  test('the stamped rung\'s dispatch carries proxyForce: true', async () => {
    const { container, calls } = await fresh({ localStorage: marked() });
    await container.click(rungDataset(container.innerHTML, 'run-step'));
    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.dispatch[0].proxyForce, true);
  });

  test('an unstamped rung\'s dispatch is unchanged: proxyForce false for a template prompt', async () => {
    const { container, calls } = await fresh({ localStorage: makeLocalStorage() });
    await container.click(rungDataset(container.innerHTML, 'run-step'));
    assert.equal(calls.dispatch[0].proxyForce, false);
  });

  test('the disclosure\'s dispatch button is unchanged, even where a runner was set up', async () => {
    const { container, calls } = await fresh({ localStorage: marked() });
    await container.click({ action: 'dispatch', target: 'cli' });
    assert.equal(calls.dispatch[0].proxyForce, false);
  });
});
