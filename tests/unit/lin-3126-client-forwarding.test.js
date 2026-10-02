/**
 * LIN-3240 (LIN-3126 slice 1, §2) — client forwarding + `memoryKey`.
 *
 * public/*.js are plain browser scripts (no module loader), so — following the
 * house patterns in fetch-autopilot-kickoff-url.test.js and
 * prompt-section-recommend-url.test.js — the real shipped source is either
 * sliced by pinned markers or evaluated in a vm sandbox. Nothing is
 * re-implemented here.
 *
 * The rule under test: wherever `?source=` / `source:` is forwarded,
 * `bindingScope` rides with it ONLY when the row carries the stamp, so an
 * unstamped single-binding/legacy request is byte-identical to before.
 *
 * Run with: node --test tests/unit/lin-3126-client-forwarding.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, '../../', rel), 'utf8');

// ---------------------------------------------------------------------------
// prompt-section.js — evaluated in a vm sandbox (memoryKey via getCached, and
// the recommend-stream URL). Mirrors prompt-section-recommend-url.test.js.
// ---------------------------------------------------------------------------
const PROMPT_SECTION_SRC = read('public/prompt-section.js');

function makeContainer() {
  return {
    innerHTML: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() { },
    getAttribute() { return null; },
    querySelector() { return null; },
    contains() { return true; },
    _clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this._clickHandler = fn; },
    removeEventListener() {},
    async clickPrompt(label) {
      const btn = { dataset: { prompt: label }, closest: () => btn };
      await this._clickHandler({ target: btn });
    },
  };
}

function loadPromptSection({ localStorage = null } = {}) {
  const calls = [];
  let fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    localStorage,
  };
  const sandbox = {
    window,
    AbortController,
    URLSearchParams,
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      return fetchImpl(url, opts);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(PROMPT_SECTION_SRC, sandbox);
  return { PromptSection: window.PromptSection, calls, setFetchImpl: (fn) => { fetchImpl = fn; } };
}

function makeStore(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function baseOpts(issue) {
  return {
    urlKey: 'ws', issue, hasAI: true, hasAutopilot: false, dispatchEnabled: false,
    proxyEnabled: false, isLocalhost: false, customPrompts: [],
    defaultPromptKeys: [], morePromptKeys: [], promptMeta: {},
  };
}

describe('LIN-3240 memoryKey (prompt-section)', () => {
  test('an unstamped issue reads the pre-slice literal key `...:<urlKey>:<issueId>`', () => {
    const store = makeStore({
      'harbour:prompt-memory:acme:1': JSON.stringify({ v: 1, label: 'plan', name: 'RepoA Plan', raw: 'a' }),
    });
    const { PromptSection } = loadPromptSection({ localStorage: store });
    const cached = PromptSection.getCached('1', 'acme');
    assert.equal(cached && cached.label, 'plan');
    assert.equal(cached && cached.name, 'RepoA Plan');
    // The stamped key is a DIFFERENT slot — the unstamped record is not reused.
    assert.equal(PromptSection.getCached('1', 'acme', 'octo/repoB'), null);
  });

  test('repoA#1 and repoB#1 get distinct stamped keys, not a shared one', () => {
    const store = makeStore({
      'harbour:prompt-memory:acme:1@octo/repoA': JSON.stringify({ v: 1, label: 'plan', name: 'RepoA Plan', raw: 'a' }),
      'harbour:prompt-memory:acme:1@octo/repoB': JSON.stringify({ v: 1, label: 'plan', name: 'RepoB Plan', raw: 'b' }),
    });
    const { PromptSection } = loadPromptSection({ localStorage: store });
    assert.equal(PromptSection.getCached('1', 'acme', 'octo/repoA').name, 'RepoA Plan');
    assert.equal(PromptSection.getCached('1', 'acme', 'octo/repoB').name, 'RepoB Plan');
    // No stamp → no slot, so a stale shared entry can never be served.
    assert.equal(PromptSection.getCached('1', 'acme'), null);
  });

  test('recommend-stream URL forwards bindingScope beside source only when stamped', async () => {
    const stamped = loadPromptSection();
    PromptSection_init(stamped, { id: 'issue-1', identifier: 'LIN-1', source: 'github', bindingScope: 'octo/repoB' });
    await stamped.container.clickPrompt('__ai__');
    assert.equal(stamped.calls[0].url, '/workspace/ws/api/recommend/issue-1/stream?source=github&bindingScope=octo%2FrepoB');

    const bare = loadPromptSection();
    PromptSection_init(bare, { id: 'issue-2', identifier: 'LIN-2', source: 'github' });
    await bare.container.clickPrompt('__ai__');
    assert.equal(bare.calls[0].url, '/workspace/ws/api/recommend/issue-2/stream?source=github');
  });
});

/** Load a fresh PromptSection with a driven init() and return the container. */
function PromptSection_init(loaded, issue) {
  const container = makeContainer();
  loaded.container = container;
  loaded.PromptSection.init(container, baseOpts(issue));
}

// ---------------------------------------------------------------------------
// URL-builder functions sliced from their real source (house pattern).
// ---------------------------------------------------------------------------
function sliceFunction(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start !== -1, `marker not found: ${signature}`);
  const end = src.indexOf('\n  }', start);
  assert.ok(end !== -1, `closing brace not found for ${signature}`);
  return src.slice(start, end + 4);
}

function evalFunction(src, signature, name, args) {
  const ctx = { URLSearchParams, encodeURIComponent };
  vm.createContext(ctx);
  const fn = vm.runInContext(`${sliceFunction(src, signature)};\n${name}`, ctx);
  return fn(...args);
}

describe('LIN-3240 brief/recap/scan URL builders', () => {
  const briefSrc = read('public/brief.js');
  const recapSrc = read('public/recap.js');
  const scanSrc = read('public/scan.js');

  test('briefUrl: byte-identical when unstamped, `&bindingScope=` when stamped', () => {
    assert.equal(
      evalFunction(briefSrc, 'function briefUrl(', 'briefUrl', ['ws', 'LIN-1', 'github']),
      '/workspace/ws/api/brief/LIN-1?source=github'
    );
    assert.equal(
      evalFunction(briefSrc, 'function briefUrl(', 'briefUrl', ['ws', 'LIN-1', 'github', 'octo/repoB']),
      '/workspace/ws/api/brief/LIN-1?source=github&bindingScope=octo%2FrepoB'
    );
  });

  test('recapUrl: byte-identical when unstamped, `&bindingScope=` when stamped', () => {
    assert.equal(
      evalFunction(recapSrc, 'function recapUrl(', 'recapUrl', ['ws', 'LIN-1', 'github']),
      '/workspace/ws/api/recap/LIN-1?source=github'
    );
    assert.equal(
      evalFunction(recapSrc, 'function recapUrl(', 'recapUrl', ['ws', 'LIN-1', 'github', 'octo/repoB']),
      '/workspace/ws/api/recap/LIN-1?source=github&bindingScope=octo%2FrepoB'
    );
  });

  test('scanUrl: byte-identical when unstamped, `&bindingScope=` when stamped (suffix stays in the path)', () => {
    assert.equal(
      evalFunction(scanSrc, 'function scanUrl(', 'scanUrl', ['ws', 'LIN-1', 'github', '/dismiss']),
      '/workspace/ws/api/scan/LIN-1/dismiss?source=github'
    );
    assert.equal(
      evalFunction(scanSrc, 'function scanUrl(', 'scanUrl', ['ws', 'LIN-1', 'github', '/dismiss', 'octo/repoB']),
      '/workspace/ws/api/scan/LIN-1/dismiss?source=github&bindingScope=octo%2FrepoB'
    );
  });
});

// ---------------------------------------------------------------------------
// common.js — fetchAutopilotKickoff sliced (house pattern).
// ---------------------------------------------------------------------------
const COMMON_SRC = read('public/common.js');

async function callFetchAutopilotKickoff(opts) {
  const calls = [];
  const startMarker = 'window.fetchAutopilotKickoff = async function fetchAutopilotKickoff(';
  const start = COMMON_SRC.indexOf(startMarker);
  assert.ok(start !== -1, 'fetchAutopilotKickoff marker not found');
  const end = COMMON_SRC.indexOf('\n};', start);
  assert.ok(end !== -1, 'fetchAutopilotKickoff closing marker not found');
  const fnSrc = COMMON_SRC.slice(start, end + 3);
  const context = { URLSearchParams, calls };
  context.window = context;
  context.window.api = async (url, fetchOpts) => { calls.push({ url, fetchOpts }); return { prompt: 'x' }; };
  vm.createContext(context);
  vm.runInContext(`${fnSrc};\nwindow.fetchAutopilotKickoff`, context);
  await context.window.fetchAutopilotKickoff(opts);
  return calls[0].url;
}

describe('LIN-3240 fetchAutopilotKickoff URL', () => {
  test('unstamped source-only URL is byte-identical to pre-slice', async () => {
    assert.equal(
      await callFetchAutopilotKickoff({ urlKey: 'ws', issueId: 'i1', variant: 'stepper', source: 'github' }),
      '/workspace/ws/api/autopilot-prompt/i1?variant=stepper&source=github'
    );
  });

  test('stamped kickoff joins bindingScope after source', async () => {
    assert.equal(
      await callFetchAutopilotKickoff({ urlKey: 'ws', issueId: 'i1', variant: 'stepper', source: 'github', bindingScope: 'octo/repoB' }),
      '/workspace/ws/api/autopilot-prompt/i1?variant=stepper&source=github&bindingScope=octo%2FrepoB'
    );
  });
});

// ---------------------------------------------------------------------------
// lib/render-task-edit.js — the form attribute the client reads.
// ---------------------------------------------------------------------------
import { renderTaskEditPage } from '../../lib/render-task-edit.js';

describe('LIN-3240 render-task-edit form stamp', () => {
  const issue = { id: 'i1', identifier: 'LIN-1', title: 'T', description: 'd', state: { id: 's1', name: 'Todo', type: 'unstarted' } };
  const render = (extra) => renderTaskEditPage({ issue, states: [], urlKey: 'ws', source: 'github', ...extra });

  test('unstamped form carries data-source with no binding attribute', () => {
    const html = render({});
    assert.ok(html.includes('data-source="github"'));
    assert.ok(!html.includes('data-binding-scope'));
  });

  test('stamped form carries data-binding-scope beside data-source', () => {
    const html = render({ bindingScope: 'octo/repoB' });
    assert.ok(html.includes('data-source="github" data-binding-scope="octo/repoB"'));
  });
});
