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
 * Runs in the shared client world (tests/unit/helpers/client-world.js), with the real dispatch disclosure.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';
import { DISCLOSURE_SCRIPTS, disclosureWindowStubs } from './helpers/real-dispatch-disclosure.js';

// The client world (tests/unit/helpers/client-world.js): the real dispatch disclosure and the component. `makeContainer()`
// makes a container in the world of the most recent `loadPromptSection()`; each test makes its containers straight after
// its own load, so it always reaches its own world.
let currentWorld = null;
function makeContainer() {
  return currentWorld.makeContainer();
}

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    dump() { return Object.fromEntries(map); },
  };
}

function loadPromptSection({ localStorage } = {}) {
  const calls = { dispatch: [], readers: [] };
  const timers = [];
  const storage = localStorage ? { localStorage } : {};
  const world = loadWorld({
    window: { ...disclosureWindowStubs(), ...storage },
    scripts: DISCLOSURE_SCRIPTS,
    timers,
    globals: {
      ...storage,
      // This suite's own default answers `ok: false`, so an unstubbed read takes its error branch. The shared default
      // (`ok: true`) would hide that branch, so it is kept here.
      fetch: async () => ({ ok: false, json: async () => ({}) }),
    },
  });
  const { window } = world;
  window.api = async () => ({ prompt: 'TEMPLATE PROMPT', promptName: 'Template' });
  window.dispatchPrompt = async (args) => { calls.dispatch.push(args); };
  window.ProxyToggle = {
    maybeAppend: async (raw, urlKey, opts) => (opts && opts.force ? `${raw}\n\n## Workspace API access` : raw),
  };
  // The reader is stubbed: production's reads the values of the harness and model `<select>`s, which the fake does not
  // model. The stub records the scope it is handed, so a test can check which element a press passes it.
  window.readDispatchExecControls = (scopeEl) => {
    calls.readers.push(scopeEl);
    return { model: null, harness: null };
  };
  currentWorld = world;
  return { PromptSection: window.PromptSection, window, calls, timers };
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
    // LIN-4040 close-out (review A): the run-step rung is enabled only while the card's offer says `offer`.
    row: { action: { kind: 'offer', container: false, step: null, why: 'the run control offers the three rungs' } },
    ...extra,
  };
  return { runSetup: !o.dispatchEnabled, ...o };
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

async function fresh({ localStorage, dispatchEnabled = true } = {}) {
  const loaded = loadPromptSection({ localStorage });
  const container = makeContainer();
  loaded.PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'LIN-1' }, { dispatchEnabled }));
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
      'Harbour can also run steps for you, on your own machine. <a class="opened-task-runner-link" href="/workspace/ws/runner" data-testid="opened-task-runner-link">Set up a runner \u203A</a>',
    );
  });

  test('the urlKey is encoded into the href', () => {
    const { PromptSection } = loadPromptSection();
    const html = PromptSection.runnerLinkHtml('a"b c');
    assert.ok(html.includes('href="/workspace/a%22b%20c/runner"'));
  });

  for (const dispatchEnabled of [true, false]) {
    {
      test(`the component itself renders no runner link (dispatch ${dispatchEnabled ? 'on' : 'off'}), idle or fresh`, async () => {
        const { PromptSection } = loadPromptSection();
        const container = makeContainer();
        PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'LIN-1' }, { dispatchEnabled }));
        assert.ok(container.innerHTML.includes(LADDER));
        assert.ok(!container.innerHTML.includes(LINK));
        const { container: freshContainer } = await fresh({ dispatchEnabled });
        assert.ok(!freshContainer.innerHTML.includes(LINK));
      });
    }
  }
});

describe('the ○ set up › notices', () => {
  test('dispatch: the old text, plus the link to /runner', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'LIN-1' }, { dispatchEnabled: false }));
    // Named by its rung: a press on the bare action would land on Go's set-up control first, which says something else.
    await container.click({ rung: 'run-step', action: 'setup', setupNeeds: 'dispatch' });
    assert.match(container.innerHTML, /<div class="opened-task-setup-notice">running this step needs the dispatch runner set up <a [^>]*href="\/workspace\/ws\/runner"[^>]*data-testid="opened-task-setup-runner-link"/);
  });

  test('"generate a prompt first" stays byte-identical, with no link', async () => {
    const { PromptSection } = loadPromptSection();
    const container = makeContainer();
    PromptSection.init(container, baseOpts({ id: 'issue-1', identifier: 'LIN-1' }, { dispatchEnabled: true, proxyEnabled: true }));
    await container.click({ rung: 'copy', action: 'setup', setupNeeds: 'prompt' });
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
    await flush(); // the press re-reads the offer before it dispatches (LIN-4040 close-out, review A)
    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.dispatch[0].proxyForce, true);
  });

  test('an unstamped rung\'s dispatch is unchanged: proxyForce false for a template prompt', async () => {
    const { container, calls } = await fresh({ localStorage: makeLocalStorage() });
    await container.click(rungDataset(container.innerHTML, 'run-step'));
    await flush(); // the press re-reads the offer before it dispatches (LIN-4040 close-out, review A)
    assert.equal(calls.dispatch[0].proxyForce, false);
  });

  test('the disclosure\'s dispatch button is unchanged, even where a runner was set up', async () => {
    const { container, calls } = await fresh({ localStorage: marked() });
    const panel = container.querySelector('.swipe-prompt-options');
    assert.ok(panel, 'precondition: the disclosure is drawn');
    await container.click({ action: 'dispatch', target: 'cli' });
    assert.equal(calls.readers.at(-1), panel, 'the press hands the reader the drawn disclosure panel');
    assert.equal(calls.dispatch[0].proxyForce, false);
  });
});
