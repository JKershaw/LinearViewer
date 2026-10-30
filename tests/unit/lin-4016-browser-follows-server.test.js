/**
 * LIN-4016 W4 — the browser follows the server. The run control reads the decision the server sent (`sessions.action`,
 * `sessions.canStop`, `sessions.queued`, `sessions.busy`, and the row's record) and paints it. Each case feeds a
 * `/state` body whose decision contradicts what the old browser would have inferred from the other fields (an offered
 * step with no action; a running session that cannot be stopped; a finished row with a tracker type the old list did
 * not know; a queued session with no queued decision). If a copy of the rule came back, the contradiction would show.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { escapeHtml } from '../../lib/utils/html.js';
import { rowRecordOf, rowDataByNodeKey } from '../../lib/task-board-view.js';
import { nodeKey } from '../../lib/tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeContainer() {
  const listeners = {};
  let html = '';
  let written = {};
  const markupValue = (testid) => {
    const tag = new RegExp(`<(input|select)\\b[^>]*data-testid="${testid}"[^>]*>`).exec(html);
    if (!tag) return undefined;
    if (tag[1] === 'input') return /\svalue="([^"]*)"/.exec(tag[0])?.[1] ?? '';
    const block = html.slice(tag.index, html.indexOf('</select>', tag.index));
    return /<option value="([^"]*)"[^>]*\sselected/.exec(block)?.[1] ?? '';
  };
  const panelRoot = {
    querySelector(sel) {
      const m = /^\[data-testid="([^"]+)"\]$/.exec(sel);
      if (!m || markupValue(m[1]) === undefined) return null;
      const testid = m[1];
      return {
        get value() { return testid in written ? written[testid] : markupValue(testid); },
        set value(v) { written[testid] = v; }
      };
    }
  };
  // The Change panel's summary is an element the page updates in place when a pick or a typed model changes it (LIN-3992),
  // so it reads and writes its own text in the markup, as a real element's textContent does.
  const summaryNode = {
    get textContent() { return /data-testid="run-will-use">([^<]*)</.exec(html)?.[1] ?? ''; },
    set textContent(v) { html = html.replace(/(data-testid="run-will-use">)[^<]*/, (_, open) => open + escapeHtml(v)); }
  };
  const container = {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; written = {}; },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector(sel) {
      if (sel === '[data-testid="run-will-use"]') return html.includes('data-testid="run-will-use"') ? summaryNode : null;
      return sel === '[data-decision-panel]' && html.includes('data-decision-panel') ? panelRoot : null;
    },
    contains() { return true; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    async click(dataset) {
      const btn = { dataset: { ...dataset }, disabled: false, textContent: '', classList: { add() {}, remove() {} }, closest: (sel) => (/^button/.test(sel) ? btn : null) };
      for (const fn of listeners.click || []) await fn({ target: btn });
      return btn;
    },
    async fire(type, target) {
      const el = { dataset: {}, closest: () => null, ...target };
      for (const fn of listeners[type] || []) await fn({ target: el });
    },
  };
  return container;
}

// The state body, the way /state sends it (routes/task-page.js): the sessions block is the server's, the row record too.
function loadClient({ stateBody, container = false }) {
  const calls = { api: [] };
  const window = {
    escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
    stripCodeBlockWrapper: (x) => x,
    renderMarkdown: (x) => String(x == null ? '' : x),
    api: async (url) => {
      calls.api.push(url);
      if (url.includes('/api/task/')) return stateBody;
      if (url.includes('/api/task-mode/')) return { lastCopy: null };
      if (url.includes('/api/dispatch/preview')) return { kind: 'implementation', harness: 'claude-code', words: {}, sources: {}, group: null, description: '' };
      if (url.includes('/api/dispatch/decision-panel')) return { html: '', words: null, withoutEffort: [], targets: ['cli', 'web'], optionWords: { harness: {}, model: {} } };
      if (url.includes('/api/dispatch/presets')) return { presets: [] };
      return {};
    },
    ProxyToggle: { isActive: () => true, setActive() {}, maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '',
    readDispatchExecControls: () => ({ model: null, harness: null }),
    isPinnedToBottom: () => false,
    taskPageHref: () => '/workspace/acme/task/LIN-42',
    toast: () => {},
  };
  const sandbox = {
    window, AbortController, URLSearchParams, TextDecoder, TextEncoder, Blob: class {}, URL,
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: (fn, ms) => { const t = globalThis.setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; },
    clearTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'prompt-section.js' });
  return { PromptSection: sandbox.window.PromptSection, calls, container };
}

const HOME_ISSUE = { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', source: 'linear', stateType: 'started' };
const HOME = {
  urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping'],
  issue: HOME_ISSUE,
  row: rowRecordOf({ stateType: 'started' }),
};

// A state body whose sessions say what the server decided: `running`, `queued`, `busy`, `action`, `canStop` as given.
const stateWith = (sessions) => ({
  status: 'idle', live: false, headerHtml: '', stripHtml: '', homeStatusHtml: '',
  sessions: { count: 1, next: null, last: null, offered: null, excluded: [], queued: null, busy: false, action: null, canStop: false, running: null, ...sessions },
});

async function paint(stateBody, opts = {}) {
  const { PromptSection } = loadClient({ stateBody, container: !!opts.row?.container });
  const c = makeContainer();
  PromptSection.init(c, { ...HOME, ...opts });
  await flush(); await flush(); await flush();
  return c.innerHTML;
}

const PLAN_OFFER = { kind: 'plan', label: 'Plan', why: 'usual', failed: false, reason: 'usually next after Research' };

describe('LIN-4016 W4 — the run control paints the server\'s decision', () => {
  test('an offered step with action null (busy on the server): no step button and no Run to PR, whatever the offer says', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: null, busy: true }));
    assert.doesNotMatch(html, /data-action="run-step-next"/, 'busy offers no step button');
    assert.doesNotMatch(html, /Run to PR/, 'busy offers no Run to PR');
  });

  test('the server\'s step action is the main button, even with no offer field', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: { kind: 'step', step: PLAN_OFFER, why: PLAN_OFFER.reason } }));
    assert.match(html, /data-action="run-step-next"[^>]*>Run Plan</);
  });

  test('a container: the server\'s run-to-pr action is Run to PR and no stage step, even when an offer is set', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: { kind: 'run-to-pr', why: 'a container runs to PR' } }), { row: rowRecordOf({ stateType: 'started', container: true }) });
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
    assert.doesNotMatch(html, /run-step-next/);
  });

  test('a running session whose canStop is false has no Stop, whatever its target', async () => {
    const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-30T10:00:00.000Z', target: 'cli' };
    const html = await paint(stateWith({ running, busy: true, action: null, canStop: false }));
    assert.doesNotMatch(html, /data-testid="run-stop"/, 'the server says this run cannot be stopped from here');
  });

  test('a running session whose canStop is true has Stop', async () => {
    const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-30T10:00:00.000Z', target: 'local' };
    const html = await paint(stateWith({ running, busy: true, action: null, canStop: true }));
    assert.match(html, /data-testid="run-stop"/);
  });

  test('a queued run (the server\'s queued) reads queued with Undo, and never as running', async () => {
    const queued = { loopId: 'q-1', kind: 'implementation', label: 'Build', state: 'queued', target: 'cli' };
    const html = await paint(stateWith({ running: queued, queued, busy: true, action: null, canStop: true }));
    assert.match(html, /data-testid="opened-task-queued"/);
    assert.doesNotMatch(html, /data-testid="opened-task-running"/);
  });

  test('the row record is the one lookup: every Home row carries it, keyed by node key', () => {
    const node = (identifier, children = []) => ({ issue: { id: `id-${identifier}`, identifier, title: identifier, source: 'linear', state: { name: 'started', type: 'started' } }, children });
    const parent = node('LIN-P', [node('LIN-C')]);
    const byKey = rowDataByNodeKey({ urlKey: 'acme', inProgressTrees: [{ roots: [parent] }], rowStates: new Map() });
    assert.equal(byKey[nodeKey(parent.issue)].container, true);
    assert.equal(Object.keys(byKey).length, 2, 'a record for every row, leaves included');
  });
});
