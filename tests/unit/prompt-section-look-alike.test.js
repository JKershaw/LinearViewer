// LIN-3401 — the opened-task component answers only controls Harbour made.
//
// The prompt body and the reasoning are rendered markdown (ticket-derived) and
// sit inside the same container as the real buttons, which keeps `data-action`
// and `data-prompt`. A button in those sinks must do nothing, and the +proxy
// toggle is bound to itself after every paint rather than by a delegated listener.
//
// The client runs in the shared client world (tests/unit/helpers/client-world.js). A real control is pressed with
// `container.click`, which needs it drawn. A look-alike is a button the markdown put in the sink; it is pressed by its
// own node, as a browser's click targets the node under the pointer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';

// Press a specific drawn node, as a browser click does: the container's click listeners get that node as the target.
async function pressNode(container, node) {
  for (const fn of container.listenersOf('click')) await fn({ target: node });
}

// `promptMarkup` is what the template fetch returns as the prompt text: the rendered markdown sink carries it.
function load({ promptMarkup = 'TEMPLATE PROMPT' } = {}) {
  const bound = [];
  const calls = [];
  const world = loadWorld({
    window: {
      escapeHtml: (s) => (s == null ? '' : String(s)),
      stripCodeBlockWrapper: (s) => s,
      renderMarkdown: (s) => String(s == null ? '' : s),
      api: async (...a) => { calls.push(['window.api', ...a]); return { prompt: promptMarkup, promptName: 'Template' }; },
      ProxyToggle: { bind: (b) => bound.push(b), maybeAppend: async (t) => t },
    },
    scripts: ['prompt-section.js'],
    globals: {
      fetch: async (...a) => { calls.push(['fetch', ...a]); return { ok: false, json: async () => ({}) }; },
      setTimeout: () => 1,
      clearTimeout: () => {},
    },
  });
  return { PromptSection: world.PromptSection, makeContainer: world.makeContainer, bound, calls };
}

const opts = {
  urlKey: 'ws', issue: { id: 'i1', identifier: 'LIN-1', title: 't' }, hasAI: true,
  dispatchEnabled: false, runSetup: true, isLocalhost: false, customPrompts: [],
  defaultPromptKeys: ['implementation'], morePromptKeys: [], promptMeta: { implementation: 'Implementation' },
};

const flush = () => new Promise((r) => setImmediate(r));

describe('PromptSection: look-alike controls in rendered markdown (LIN-3401)', () => {
  test('a real setup button acts; the same button inside a markdown sink does nothing', async () => {
    const { PromptSection, makeContainer } = load({
      promptMarkup: '<button data-action="setup" data-setup-needs="dispatch">set up</button>',
    });
    const real = makeContainer();
    PromptSection.init(real, opts);
    await real.click({ action: 'setup', setupNeeds: 'dispatch' });
    assert.ok(real.querySelector('[data-setup-notice-slot]').innerHTML.length > 0, 'the real control answered');

    const fake = makeContainer();
    PromptSection.init(fake, opts);
    await fake.click({ prompt: 'implementation' });
    await flush();
    const lookalike = fake.querySelector('[data-prompt-body] button[data-action="setup"]');
    assert.ok(lookalike, 'the look-alike is drawn in the markdown sink');
    await pressNode(fake, lookalike);
    assert.strictEqual(fake.querySelector('[data-setup-notice-slot]').innerHTML, '', 'the look-alike in the sink did nothing');
  });

  test('a look-alike prompt-fetch button in a sink starts no request', async () => {
    const { PromptSection, makeContainer, calls } = load({
      promptMarkup: '<button data-prompt="__autopilot__">run the whole task</button>',
    });
    const c = makeContainer();
    PromptSection.init(c, opts);
    await c.click({ prompt: 'implementation' });
    await flush();
    calls.length = 0;
    const lookalike = c.querySelector('[data-prompt-body] button[data-prompt="__autopilot__"]');
    assert.ok(lookalike, 'the look-alike is drawn in the markdown sink');
    await pressNode(c, lookalike);
    assert.deepStrictEqual(calls, [], 'the look-alike made no fetch / window.api call');
    assert.ok(!c.innerHTML.includes('generating'), 'did not enter the generating state');

    // Positive control: the same press outside a sink does reach the network
    // (the task-mode record), so the empty list above is not a vacuous pass.
    await c.click({ action: 'change' });
    await c.click({ prompt: '__autopilot_stepper__' });
    await flush();
    assert.ok(
      calls.some((c0) => c0[0] === 'fetch' && /\/api\/task-mode$/.test(String(c0[1]))),
      'a real press records task-mode via fetch'
    );
  });

  test('every paint binds the +proxy toggle through the header template chain only', async () => {
    // The markdown puts a +proxy look-alike in the sink, so an unscoped selector would bind it too.
    const { PromptSection, makeContainer, bound } = load({
      promptMarkup: '<button class="prompt-proxy-toggle">+proxy</button>',
    });
    const c = makeContainer();
    PromptSection.init(c, opts);
    await c.click({ prompt: 'implementation' });
    await flush();
    assert.ok(c.querySelector('[data-prompt-body] .prompt-proxy-toggle'), 'the look-alike toggle is drawn in the markdown sink');
    const toggle = c.querySelector(':scope > .swipe-prompt-header > .swipe-prompt-actions > .prompt-proxy-toggle');
    assert.ok(toggle, 'the header toggle is drawn');
    assert.ok(bound.length > 0 && bound.every((b) => b === toggle), 'bound only the header toggle, every time');
  });
});
