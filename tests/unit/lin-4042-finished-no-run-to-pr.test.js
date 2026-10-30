/**
 * LIN-4042 — Home offers no run on a finished task. The server's `sessions.actions` (`actionsOf`, LIN-4049) reads /state, which never
 * reads the tracker, so for a Done task it still says Run to PR. The row record's `finished` is the signal Home has, and the
 * run control must read it: a finished task shows no run (no Run to PR, no step, no runs-on, no Go). Unfinished tasks and
 * tasks with open subtasks keep their Run to PR. The first case fails before the fix (Run to PR was painted for a finished row).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { escapeHtml } from '../../lib/utils/html.js';
import { rowRecordOf } from '../../lib/task-board-view.js';

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
  const summaryNode = {
    get textContent() { return /data-testid="run-will-use">([^<]*)</.exec(html)?.[1] ?? ''; },
    set textContent(v) { html = html.replace(/(data-testid="run-will-use">)[^<]*/, (_, open) => open + escapeHtml(v)); }
  };
  return {
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
    async fire(type, target) {
      const el = { dataset: {}, closest: () => null, ...target };
      for (const fn of listeners[type] || []) await fn({ target: el });
    },
  };
}

// The state body, the way /state sends it (routes/task-page.js): the sessions block is the server's, tracker-free.
function loadClient({ stateBody }) {
  const window = {
    escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
    stripCodeBlockWrapper: (x) => x,
    renderMarkdown: (x) => String(x == null ? '' : x),
    api: async (url) => {
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
  return sandbox.window.PromptSection;
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

// The server's decision for a task with nothing running: `actions` is what `actionsOf` chose from /state (tracker-free).
const stateWith = (sessions) => ({
  status: 'idle', live: false, headerHtml: '', stripHtml: '', homeStatusHtml: '',
  sessions: { count: 0, next: null, last: null, offered: null, excluded: [], queued: null, busy: false, actions: [], canStop: false, running: null, ...sessions },
});

async function paint(stateBody, opts = {}) {
  const PromptSection = loadClient({ stateBody });
  const c = makeContainer();
  PromptSection.init(c, { ...HOME, ...opts });
  await flush(); await flush(); await flush();
  return c.innerHTML;
}

const RUN_TO_PR = { kind: 'run-to-pr', why: 'no stage step is offered, so the run takes it to PR' };
const PLAN_OFFER = { kind: 'plan', label: 'Plan', why: 'usual', failed: false, reason: 'usually next after Research' };
const DONE_ROW = () => rowRecordOf({ stateType: 'completed' });

describe('LIN-4042 — a finished task on Home offers no run', () => {
  test('a Done task whose server says finished and offers no actions paints no Run to PR button', async () => {
    const html = await paint(stateWith({ finished: true, actions: [] }), { row: DONE_ROW() });
    assert.doesNotMatch(html, /Run to PR/, 'a finished task has nothing to run');
    assert.doesNotMatch(html, /data-action="go"/, 'no go button on a finished task');
    assert.doesNotMatch(html, /data-testid="opened-task-runs-on"/, 'no runs-on line, so no Change for a run');
  });

  // LIN-4049: the browser no longer patches a run from the row record. The server decides `actions` and `finished`.
  test('a Done row does not hide a run the server offers: the browser follows /state, not row.finished', async () => {
    const html = await paint(stateWith({ finished: false, actions: [RUN_TO_PR] }), { row: DONE_ROW() });
    assert.match(html, /Run to PR/, 'the server offered a run, so the browser paints it');
  });

  test('a Done task keeps the Another step list, with its steps counted as left out (LIN-3833 ruling f9fa6bd7)', async () => {
    const html = await paint(stateWith({ finished: true, actions: [] }), { row: DONE_ROW() });
    assert.match(html, /data-testid="run-another"/);
  });

  test('a Done task offers no stage step either (the step case stays a guard)', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, finished: true, actions: [] }), { row: DONE_ROW() });
    assert.doesNotMatch(html, /data-action="run-step-next"/);
  });

  test('an unfinished task whose server action is Run to PR keeps its Run to PR button', async () => {
    const html = await paint(stateWith({ actions: [RUN_TO_PR] }), { row: rowRecordOf({ stateType: 'started' }) });
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
  });

  test('a task with open subtasks (a container) keeps its Run to PR button', async () => {
    const html = await paint(stateWith({ actions: [RUN_TO_PR] }), { row: rowRecordOf({ stateType: 'started', container: true }) });
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
  });

  // Close-out of the review ledger (items 1 and 2): the change's own claims, pinned.
  test('a Done task with a running run keeps its running box and Stop (the early return needs !active)', async () => {
    const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-30T10:00:00.000Z', target: 'local' };
    const html = await paint(stateWith({ running, busy: true, finished: true, actions: [], canStop: true }), { row: DONE_ROW() });
    assert.match(html, /data-testid="opened-task-running"/);
    assert.match(html, /data-testid="run-stop"/);
  });

  test('a Done task with a queued run keeps its queued box', async () => {
    const queued = { loopId: 'q-1', kind: 'implementation', label: 'Build', state: 'queued', target: 'cli' };
    const html = await paint(stateWith({ running: queued, queued, busy: true, finished: true, actions: [], canStop: true }), { row: DONE_ROW() });
    assert.match(html, /data-testid="opened-task-queued"/);
  });

  test('a finished container (Done parent with an open subtask) offers no run: a recorded choice (LIN-4042 review ledger 2)', async () => {
    const html = await paint(stateWith({ finished: true, actions: [] }), { row: rowRecordOf({ stateType: 'completed', container: true }) });
    assert.doesNotMatch(html, /data-action="go"/);
    assert.doesNotMatch(html, /Run to PR/);
  });
});
