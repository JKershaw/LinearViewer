/**
 * LIN-4049 (plan B2a): a run press re-reads /state and stops when the server offers nothing.
 *
 * The box is decided by the mount read and the poll, either of which can be stale when the person presses: a subtask
 * may have started a run, been queued or asked for you since. So both run presses in the opened task (Run to PR, the
 * Go button, and Run <step>) read /state again on the poll's own URL, with the same subtree hint, and dispatch only
 * when the fresh read still offers a run. A refused press paints the fresh read, so the box shows why.
 *
 * Witnesses, each with a control where the fresh read still offers the run and the press does dispatch:
 *   - Run to PR: a fresh read offering nothing means no kickoff and no dispatch;
 *   - Run <step>: a fresh read offering nothing means no prompt fetch and no dispatch;
 *   - the press read goes to the same URL as the mount read, so it carries the same hint.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { escapeHtml } from '../../lib/utils/html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeContainer() {
  const listeners = {};
  let html = '';
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; },
    contains() { return true; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    async click(dataset) {
      const btn = { dataset: { ...dataset }, disabled: false, textContent: '', classList: { add() {}, remove() {} }, closest: (sel) => (/^button/.test(sel) ? btn : null) };
      for (const fn of listeners.click || []) await fn({ target: btn });
    },
  };
}

/** Load the real component. `/state` answers from `states` in order (the last one repeats); every call is recorded. */
function load(states) {
  const calls = { state: [], prompt: [], kickoff: [], dispatch: [] };
  const window = {
    escapeHtml: (x) => (x == null ? '' : escapeHtml(String(x))),
    stripCodeBlockWrapper: (x) => x,
    renderMarkdown: (x) => String(x == null ? '' : x),
    api: async (url) => {
      if (url.includes('/api/task/')) {
        calls.state.push(url);
        return states[Math.min(calls.state.length - 1, states.length - 1)];
      }
      if (url.includes('/api/prompt/')) { calls.prompt.push(url); return { prompt: 'PROMPT', promptName: 'Plan' }; }
      if (url.includes('/api/task-mode/')) return { lastCopy: null };
      if (url.includes('/api/dispatch/preview')) return { kind: 'plan', harness: 'claude-code', words: {}, sources: {}, group: null, description: '' };
      if (url.includes('/api/dispatch/decision-panel')) return { html: '', words: null, withoutEffort: [], targets: ['cli', 'web'], optionWords: { harness: {}, model: {} } };
      if (url.includes('/api/dispatch/presets')) return { presets: [] };
      return { success: true };
    },
    fetchAutopilotKickoff: async (args) => { calls.kickoff.push(args); return { prompt: 'AUTOPILOT', promptName: 'Autopilot', kind: 'autopilot' }; },
    dispatchPrompt: async (args) => { calls.dispatch.push(args); return { success: true, item: { id: 'd-1' } }; },
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
  return { PromptSection: sandbox.window.PromptSection, calls };
}

const HOME = {
  urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'], morePromptKeys: ['review', 'scoping'],
  issue: { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', source: 'linear', stateType: 'started' },
};
const HINT = { edges: [['LIN-42', 'LIN-43', 'unstarted']], incomplete: false };
const ROW = { container: true, finished: false, attention: null, subtree: HINT };
const LEAF_ROW = { container: false, finished: false, attention: null, subtree: null };

const sessions = (over) => ({ count: 0, next: null, last: null, offered: null, excluded: [], queued: null, busy: false, actions: [], canStop: false, running: null, finished: false, note: null, ...over });
const stateWith = (over) => ({ status: 'idle', live: false, headerHtml: '', trackHtml: '', stripHtml: '', homeStatusHtml: '', sessions: sessions(over) });

const RUN_TO_PR = { kind: 'run-to-pr', why: 'a container runs to PR, the autopilot works through its subtasks' };
const PLAN = { kind: 'plan', label: 'Plan', why: 'usual', failed: false, reason: 'usually next after Research' };

// The box as the mount read leaves it, and as the press read finds it once a subtask has started.
const OFFERS_RUN_TO_PR = stateWith({ actions: [RUN_TO_PR] });
const OFFERS_PLAN = stateWith({ offered: PLAN, next: { kind: 'plan', label: 'Plan' }, actions: [{ kind: 'step', step: PLAN, why: PLAN.reason }] });
const SUBTASK_STARTED = stateWith({ busy: true, actions: [] });

async function mount(states, row) {
  const env = load(states);
  const c = makeContainer();
  env.PromptSection.init(c, { ...HOME, row });
  for (let i = 0; i < 3; i += 1) await flush();
  return { ...env, c };
}

describe('LIN-4049 (B2a) — Run to PR re-reads /state at the press', () => {
  test('a subtask started since the box was read: no kickoff, no dispatch, and the box shows the fresh read', async () => {
    const { c, calls } = await mount([OFFERS_RUN_TO_PR, SUBTASK_STARTED], ROW);
    assert.match(c.innerHTML, /data-action="go"/, 'the mount read offered Run to PR');
    await c.click({ action: 'go', rung: 'run-task' });
    for (let i = 0; i < 3; i += 1) await flush();
    assert.equal(calls.state.length, 2, 'the press read /state again');
    assert.equal(calls.kickoff.length, 0, 'no kickoff');
    assert.equal(calls.dispatch.length, 0, 'no dispatch');
    assert.doesNotMatch(c.innerHTML, /data-action="go"/, 'the box no longer offers the run');
  });

  test('control: the fresh read still offers Run to PR, so the press dispatches', async () => {
    const { c, calls } = await mount([OFFERS_RUN_TO_PR, OFFERS_RUN_TO_PR], ROW);
    await c.click({ action: 'go', rung: 'run-task' });
    for (let i = 0; i < 3; i += 1) await flush();
    assert.equal(calls.kickoff.length, 1);
    assert.equal(calls.dispatch.length, 1);
  });

  test('the press read is the mount read\'s own URL, so it carries the same subtree hint', async () => {
    const { c, calls } = await mount([OFFERS_RUN_TO_PR, SUBTASK_STARTED], ROW);
    await c.click({ action: 'go', rung: 'run-task' });
    for (let i = 0; i < 3; i += 1) await flush();
    assert.equal(calls.state[1], calls.state[0]);
    assert.match(calls.state[1], /[?&]subtree=/);
  });
});

describe('LIN-4049 (B2a) — Run <step> re-reads /state at the press', () => {
  test('a subtask started since the box was read: no prompt fetch, no dispatch', async () => {
    const { c, calls } = await mount([OFFERS_PLAN, SUBTASK_STARTED], LEAF_ROW);
    assert.match(c.innerHTML, /data-action="run-step-next"/, 'the mount read offered the step');
    await c.click({ action: 'run-step-next' });
    for (let i = 0; i < 3; i += 1) await flush();
    assert.equal(calls.state.length, 2, 'the press read /state again');
    assert.equal(calls.prompt.length, 0, 'no prompt fetch');
    assert.equal(calls.dispatch.length, 0, 'no dispatch');
  });

  test('control: the fresh read still offers the step, so the press dispatches it', async () => {
    const { c, calls } = await mount([OFFERS_PLAN, OFFERS_PLAN], LEAF_ROW);
    await c.click({ action: 'run-step-next' });
    for (let i = 0; i < 3; i += 1) await flush();
    assert.equal(calls.prompt.length, 1);
    assert.equal(calls.dispatch.length, 1);
  });
});
