// LIN-3239 — the Go ladder shows the caller's own run allowance before Go and
// disables ONLY the run rungs at zero. Copy and ✦ generation stay enabled:
// prompts are unlimited, so the run state never leaks into the prompt controls.
//
// The allowance is read from S1's GET /api/dispatch/quota at load, only when
// the caller marks the workspace free-tier. Same vm-sandbox house pattern as
// prompt-section-task-mode.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

const RUN_LIMIT_TITLE = 'daily run limit reached \u00b7 resets at midnight UTC';

function makeContainer() {
  const container = {
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    contains() { return true; },
    _clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this._clickHandler = fn; },
    removeEventListener() {},
    async click(dataset) {
      const btn = { dataset: { ...dataset }, disabled: false, textContent: '', classList: { add() {}, remove() {} }, closest: () => btn };
      await this._clickHandler({ target: btn });
      return btn;
    },
  };
  return container;
}

function loadPromptSection({ quota } = {}) {
  const calls = { api: [] };
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async (url) => {
      calls.api.push(url);
      if (String(url).endsWith('/api/dispatch/quota')) return quota;
      return { prompt: 'TEMPLATE PROMPT', promptName: 'Template' };
    },
    ProxyToggle: { maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '<div class="swipe-prompt-options"></div>',
    readDispatchExecControls: () => ({}),
    dispatchPrompt: async () => ({ item: { id: 'disp-1' } }),
    isPinnedToBottom: () => false,
    toast: () => {},
    fetchAutopilotKickoff: async () => ({ prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' }),
  };
  const sandbox = {
    window,
    AbortController,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    Blob: class {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: () => 1,
    clearTimeout: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { PromptSection: window.PromptSection, window, calls };
}

const ISSUE = { id: 'uuid-42', identifier: 'LIN-42', title: 'A task' };

function baseOpts(extra = {}) {
  return {
    urlKey: 'ws',
    issue: ISSUE,
    surface: 'swipe',
    hasAI: true,
    aiState: 'ready',
    freeTier: true,
    hasAutopilot: true,
    dispatchEnabled: true,
    proxyEnabled: true,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: ['implementation'],
    morePromptKeys: [],
    promptMeta: { implementation: 'Implementation' },
    ...extra,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

async function mountIdle(extra, loadOpts) {
  const loaded = loadPromptSection(loadOpts);
  const container = makeContainer();
  loaded.PromptSection.init(container, baseOpts(extra));
  await flush();
  await flush();
  return { ...loaded, container };
}

async function mountFresh(extra, loadOpts) {
  const m = await mountIdle(extra, loadOpts);
  await m.container.click({ prompt: 'implementation' });
  await flush();
  await flush();
  return m;
}

function tagFor(html, rung) {
  const m = html.match(new RegExp(`<button[^>]*data-rung="${rung}"[^>]*>`));
  return m ? m[0] : null;
}

const QUOTA_FULL = { limited: true, runsUsed: 3, limit: 10, remaining: 7, resetsAt: '2026-10-03T00:00:00.000Z' };
const QUOTA_ZERO = { limited: true, runsUsed: 10, limit: 10, remaining: 0, resetsAt: '2026-10-03T00:00:00.000Z' };

describe('LIN-3239 — ladder run allowance', () => {
  test('N>0: Go shows "N of <limit> runs left today" and Go + run this step are ready', async () => {
    const m = await mountFresh({}, { quota: QUOTA_FULL });
    const html = m.container.innerHTML;

    assert.match(html, /data-testid="opened-task-run-quota"/, 'the allowance is shown');
    assert.match(html, /data-runs-remaining="7"/, 'remaining comes from the response, never hard-coded');
    assert.match(html, /data-runs-limit="10"/, 'the limit comes from the response');
    assert.match(html, /7 of 10 runs left today/, 'the human-readable allowance');

    assert.match(tagFor(html, 'run-step') || '', /data-action="run-step"/, 'run this step is ready');
    // LIN-3341: Go replaced the run-task rung; it stays a ready run-task entry.
    assert.match(html, /data-rung="run-task"[^>]*data-action="go"/, 'Go is the ready run-task entry');
  });

  test('N=0: only Go and run this step are disabled, with the run-limit reason', async () => {
    const m = await mountFresh({}, { quota: QUOTA_ZERO });
    const html = m.container.innerHTML;

    assert.match(html, /0 of 10 runs left today/);

    const runStep = tagFor(html, 'run-step');
    assert.match(runStep, /disabled/, 'run this step is disabled at zero');
    assert.match(runStep, /daily run limit reached/, 'the reason is the run limit');
    assert.doesNotMatch(runStep, /data-action="run-step"/, 'no ready handler at zero');

    const go = html.match(/<button[^>]*data-testid="opened-task-go"[^>]*>/);
    assert.ok(go, 'Go is rendered');
    assert.match(go[0], /disabled/, 'Go is disabled at zero');
    assert.match(go[0], /daily run limit reached/, 'the reason is the run limit');
    assert.doesNotMatch(go[0], /data-action="go"/, 'no ready handler at zero');
  });

  test('N=0: ✦ next step stays enabled (prompts are unlimited)', async () => {
    const m = await mountIdle({}, { quota: QUOTA_ZERO });
    const goTag = m.container.innerHTML.match(/<button[^>]*data-testid="opened-task-next-step"[^>]*>/);
    assert.ok(goTag, 'the ✦ next step is rendered');
    assert.doesNotMatch(goTag[0], / disabled/, 'the ✦ next step is NOT disabled by the run limit');
  });

  test('N=0: the idle copy rung still asks for a prompt, never the run limit', async () => {
    const m = await mountIdle({}, { quota: QUOTA_ZERO });
    const copy = tagFor(m.container.innerHTML, 'copy');
    assert.ok(copy, 'the idle copy rung is rendered');
    assert.match(copy, /data-setup-needs="prompt"/, 'copy is gated on a prompt, not the run limit');
    assert.doesNotMatch(copy, /daily run limit reached/, 'the run limit never leaks into copy');
  });

  test('unreadable counts (runsUsed null) show no allowance and gate nothing', async () => {
    const m = await mountFresh({}, { quota: { limited: true, runsUsed: null, limit: 10, remaining: 0, resetsAt: null } });
    const html = m.container.innerHTML;
    assert.doesNotMatch(html, /data-testid="opened-task-run-quota"/, 'no fabricated allowance');
    assert.match(tagFor(html, 'run-step') || '', /data-action="run-step"/, 'run this step stays ready');
    assert.match(html, /data-rung="run-task"[^>]*data-action="go"/, 'Go stays ready');
  });

  test('not free tier: no quota read is made and the ladder is unchanged', async () => {
    const m = await mountFresh({ freeTier: false }, { quota: QUOTA_ZERO });
    assert.equal(m.calls.api.some((u) => String(u).endsWith('/api/dispatch/quota')), false, 'no quota read when not free tier');
    assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-run-quota"/);
    assert.match(tagFor(m.container.innerHTML, 'run-step') || '', /data-action="run-step"/);
  });
});
