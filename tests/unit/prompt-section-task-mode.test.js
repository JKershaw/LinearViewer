// LIN-2942 — the opened task's ladder records which way the task was taken.
//
// 1. Vocabulary drift pin: the store's RUNGS / NEEDS are exactly the
//    `data-rung` / `data-setup-needs` values renderLadder emits across every
//    ladder state, so neither side can grow a value the other does not know.
// 2. The client hooks in public/prompt-section.js, per the design's rung
//    mapping: copy/download → copy or run-task act:copy; a set-up press →
//    ready:false with its needs, and no dispatch; the run-task press; a dispatch
//    passes entryRung and the client records nothing; a refused act records no
//    act; ✦ "next step" is not a mode event; a failed record never alters the press.
//
// Same vm-sandbox house pattern as prompt-section-p0.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { RUNGS, NEEDS, validateTaskModeEvent } from '../../lib/task-mode-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

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

function loadPromptSection({ copyFails = false, recordFails = false, recordThrowsSync = false } = {}) {
  const calls = { records: [], dispatch: [], fetch: [], autopilotFetch: [] };
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async () => ({ prompt: 'TEMPLATE PROMPT', promptName: 'Template' }),
    fetchAutopilotKickoff: async (args) => { calls.autopilotFetch.push(args); return { prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' }; },
    ProxyToggle: {
      maybeAppend: async (raw) => {
        if (copyFails) throw new Error('a driver copy is refused for a non-owner');
        return raw;
      },
    },
    renderDispatchDisclosure: () => '<div class="swipe-prompt-options"></div>',
    readDispatchExecControls: () => ({}),
    dispatchPrompt: async (args) => { calls.dispatch.push(args); return { item: { id: 'disp-1' } }; },
    isPinnedToBottom: () => false,
    toast: () => {},
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
    fetch: (url, opts) => {
      if (recordThrowsSync && url.endsWith('/api/task-mode')) throw new Error('fetch unavailable');
      return sandboxFetch(url, opts);
    },
  };
  async function sandboxFetch(url, opts) {
    {
      calls.fetch.push({ url, opts });
      if (url.endsWith('/api/task-mode')) {
        calls.records.push({ url, opts, body: JSON.parse(opts.body) });
        if (recordFails) throw new Error('offline');
        return { ok: true, status: 204 };
      }
      return { ok: false, json: async () => ({}) };
    }
  }
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

async function mount(extra, loadOpts) {
  const loaded = loadPromptSection(loadOpts);
  const container = makeContainer();
  loaded.PromptSection.init(container, baseOpts(extra));
  return { ...loaded, container };
}

async function withResult(label, extra, loadOpts) {
  const m = await mount(extra, loadOpts);
  await m.container.click({ prompt: label });
  await flush();
  return m;
}

describe('LIN-2942 vocabulary drift pin', () => {
  test('RUNGS and NEEDS are exactly the data-rung / data-setup-needs values renderLadder emits', async () => {
    const rungs = new Set();
    const needs = new Set();
    const collect = (html) => {
      const ladder = html.match(/<div class="opened-task-ladder"[\s\S]*?<\/div>/);
      if (!ladder) return;
      for (const m of ladder[0].matchAll(/data-rung="([^"]+)"/g)) rungs.add(m[1]);
      for (const m of ladder[0].matchAll(/data-setup-needs="([^"]+)"/g)) needs.add(m[1]);
    };
    for (const dispatchEnabled of [true, false]) {
      for (const proxyEnabled of [true, false]) {
        for (const hasAutopilot of [true, false]) {
          const idle = await mount({ dispatchEnabled, proxyEnabled, hasAutopilot });
          collect(idle.container.innerHTML);
          const fresh = await withResult('implementation', { dispatchEnabled, proxyEnabled, hasAutopilot });
          collect(fresh.container.innerHTML);
        }
      }
    }
    assert.deepEqual([...rungs].sort(), [...RUNGS].sort());
    assert.deepEqual([...needs].sort(), [...NEEDS].sort());
  });
});

describe('LIN-2942 client hooks in PromptSection', () => {
  test('a copy of a template result records copy/copy for the task and surface', async () => {
    const m = await withResult('implementation');
    await m.container.click({ action: 'copy' });
    await flush();
    assert.equal(m.calls.records.length, 1);
    const { url, opts, body } = m.calls.records[0];
    assert.equal(url, '/workspace/ws/api/task-mode');
    assert.equal(opts.method, 'POST');
    assert.equal(opts.keepalive, true);
    assert.deepEqual(body, {
      rung: 'copy', ready: true, needs: null, act: 'copy',
      surface: 'swipe', issueId: 'uuid-42', issueIdentifier: 'LIN-42',
    });
    assert.equal(validateTaskModeEvent({ ...body, accountId: 'a', urlKey: 'ws' }), null);
  });

  test('a download of a template result records copy/copy', async () => {
    const m = await withResult('implementation');
    await m.container.click({ action: 'download' });
    await flush();
    assert.deepEqual(m.calls.records.map(r => `${r.body.rung}/${r.body.act}`), ['copy/copy']);
  });

  for (const label of ['__autopilot__', '__autopilot_stepper__']) {
    test(`the ${label} press records run-task/press, and its copy records run-task/copy`, async () => {
      const m = await withResult(label);
      await m.container.click({ action: 'copy' });
      await flush();
      assert.deepEqual(m.calls.records.map(r => [r.body.rung, r.body.ready, r.body.act]), [
        ['run-task', true, 'press'],
        ['run-task', true, 'copy'],
      ]);
    });
  }

  for (const [rung, needs] of [['copy', 'prompt'], ['run-step', 'dispatch'], ['run-step', 'prompt'], ['run-task', 'proxy']]) {
    test(`a set-up press on ${rung} records ready:false, needs:${needs} and dispatches nothing`, async () => {
      const m = await mount();
      await m.container.click({ action: 'setup', rung, setupNeeds: needs });
      await flush();
      assert.deepEqual(m.calls.records.map(r => r.body), [{
        rung, ready: false, needs, act: 'press', surface: 'swipe', issueId: 'uuid-42', issueIdentifier: 'LIN-42',
      }]);
      assert.equal(m.calls.dispatch.length, 0);
    });
  }

  test('a run-step dispatch passes entryRung run-step and the client records nothing', async () => {
    const m = await withResult('implementation');
    await m.container.click({ action: 'run-step', rung: 'run-step', target: 'cli' });
    await flush();
    assert.equal(m.calls.dispatch.length, 1);
    assert.equal(m.calls.dispatch[0].entryRung, 'run-step');
    assert.equal(m.calls.records.length, 0);
  });

  test('a dispatch from the disclosure carries the result\'s rung: run-task for an autopilot result', async () => {
    const m = await withResult('__autopilot__');
    await m.container.click({ action: 'dispatch', target: 'cli' });
    await flush();
    assert.equal(m.calls.dispatch[0].entryRung, 'run-task');
    assert.deepEqual(m.calls.records.map(r => r.body.act), ['press']);
  });

  test('a refused copy records only the press, never the copy', async () => {
    const m = await withResult('__autopilot__', {}, { copyFails: true });
    await m.container.click({ action: 'copy' });
    await m.container.click({ action: 'download' });
    await flush();
    assert.deepEqual(m.calls.records.map(r => `${r.body.rung}/${r.body.act}`), ['run-task/press']);
  });

  test('✦ next step and a template pick are not mode events', async () => {
    const m = await withResult('implementation');
    await m.container.click({ prompt: '__ai__' });
    await flush();
    assert.equal(m.calls.records.length, 0);
  });

  test('a failed record never alters the press', async () => {
    const m = await withResult('implementation', {}, { recordFails: true });
    const btn = await m.container.click({ action: 'copy' });
    await flush();
    assert.equal(m.calls.records.length, 1);
    assert.equal(btn.textContent, 'copied!');
  });

  test('a fetch that throws synchronously never alters the press', async () => {
    const m = await withResult('implementation', {}, { recordThrowsSync: true });
    const btn = await m.container.click({ action: 'copy' });
    await flush();
    assert.equal(btn.textContent, 'copied!');
  });

  test('without a surface option the event carries surface null', async () => {
    const m = await mount({ surface: undefined });
    await m.container.click({ action: 'setup', rung: 'run-task', setupNeeds: 'proxy' });
    await flush();
    assert.equal(m.calls.records[0].body.surface, null);
  });
});

// LIN-3246 / LIN-2949 P1b: the ladder's own autopilot run ("run the whole task"
// and "Autopilot · stepped") declares the PR boundary on BOTH the kickoff fetch
// and the dispatch. Every other ladder path (run-this-step, copy) sends nothing.
describe('LIN-3246 stopAt — the ladder declares the PR boundary', () => {
  for (const label of ['__autopilot__', '__autopilot_stepper__']) {
    test(`${label}: the kickoff fetch and the dispatch both pass stopAt:'pr'`, async () => {
      const m = await withResult(label);
      assert.equal(m.calls.autopilotFetch.length, 1);
      assert.equal(m.calls.autopilotFetch[0].stopAt, 'pr');
      await m.container.click({ action: 'dispatch', target: 'cli' });
      await flush();
      assert.equal(m.calls.dispatch.length, 1);
      assert.equal(m.calls.dispatch[0].stopAt, 'pr');
      assert.equal(m.calls.dispatch[0].entryRung, 'run-task');
    });
  }

  test('run this step (a template result): no stopAt on the fetch or the dispatch', async () => {
    const m = await withResult('implementation');
    assert.equal(m.calls.autopilotFetch.length, 0, 'a template result never hits the autopilot kickoff');
    await m.container.click({ action: 'run-step', rung: 'run-step', target: 'cli' });
    await flush();
    assert.equal(m.calls.dispatch.length, 1);
    assert.equal(m.calls.dispatch[0].entryRung, 'run-step');
    assert.equal(m.calls.dispatch[0].stopAt, undefined);
  });

  test('copy/download never dispatch, so stopAt never reaches the dispatch seam', async () => {
    for (const label of ['implementation', '__autopilot__']) {
      const m = await withResult(label);
      await m.container.click({ action: 'copy' });
      await m.container.click({ action: 'download' });
      await flush();
      assert.equal(m.calls.dispatch.length, 0, `${label}: copy/download never dispatch`);
    }
  });
});
