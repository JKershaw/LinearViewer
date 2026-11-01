/**
 * LIN-4042 — Home offers no run on a finished task. The gather decides it: a finished task's action is the no-run decision
 * (`NO_RUN_ACTION`, LIN-4071), on the row record and on `/state`, and the browser paints no run from that decision alone.
 * Unfinished tasks and tasks with open subtasks keep their Run to PR.
 *
 * REWRITTEN (LIN-4070): the Done cases paint the body the real `/state` route returns (tests/fixtures/state-route.js).
 * REWRITTEN (LIN-4071): the browser's guard on the tracker word (`row.finished`) is gone; the stale-body cases now feed the
 * server's no-run decision, and a stale Run to PR body is not a case the browser can see, because the server decides it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { escapeHtml } from '../../lib/utils/html.js';
import { rowRecordOf } from '../../lib/task-board-view.js';
import { NO_RUN_ACTION } from '../../lib/task-state.js';
import { stateBodyOf, stateIssue } from '../fixtures/state-route.js';

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
    listenersFor(type) { return listeners[type] || []; },
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
  // LIN-4104 D2: this file's workspace fills Run to PR (its tests are about that run); the filled rung is pinned in lin-4016.
  filledRung: 'pr',
  urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  stageWords: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping'],
  issue: HOME_ISSUE,
  row: rowRecordOf({ stateType: 'started' }),
};

// The server's decision for a task with nothing running: `action` is what `mainActionOf` chose from /state (tracker-free).
const stateWith = (sessions) => ({
  status: 'idle', live: false, headerHtml: '', stripHtml: '', homeStatusHtml: '',
  sessions: { count: 0, next: null, last: null, offered: null, excluded: [], queued: null, busy: false, action: null, canStop: false, running: null, ...sessions },
});

/** The `/state` body the server sends for a Done task (`LIN-42`) whose last stage failed, with `children` in its held tree. */
function doneBody({ children }) {
  const failed = {
    loopId: 'f1', lineageId: 'f1', issueIdentifier: 'LIN-42', kind: 'implementation', iteration: 1, source: 'history',
    historyStatus: 'resolved', agentState: 'failed', dispatchedAt: '2026-10-30T10:00:00.000Z', takenAt: '2026-10-30T10:01:00.000Z',
    resolvedAt: '2026-10-30T10:02:00.000Z', terminalStatus: 'failed', terminalCompletedAt: '2026-10-30T10:02:00.000Z',
    wakeMarker: 'pending', waitingMessage: null, feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] },
    followUpTo: null, bookkeeping: null,
  };
  return stateBodyOf({ issues: [stateIssue('LIN-42', 'completed'), ...children], loops: [failed], identifier: 'LIN-42' });
}

async function paint(stateBody, opts = {}) {
  const PromptSection = loadClient({ stateBody });
  const c = makeContainer();
  PromptSection.init(c, { ...HOME, ...opts });
  await flush(); await flush(); await flush();
  return c.innerHTML;
}

const RUN_TO_PR = { kind: 'offer', why: 'no stage step is offered, so the run takes it to PR' };
const PLAN_OFFER = { kind: 'plan', label: 'Plan', why: 'usual', failed: false, reason: 'usually next after Research' };
// LIN-4071: a finished task's action is the gatherer's no-run decision (`kind: 'none'`), not a client guard on the tracker word.
const NO_RUN = NO_RUN_ACTION;
const DONE_ROW = () => rowRecordOf({ stateType: 'completed', decided: { action: NO_RUN } });

describe('LIN-4042 — a finished task on Home offers no run', () => {
  test('a Done task paints no Run to PR button, from the body the server really sends (its action is null)', async () => {
    const { body } = await doneBody({ children: [] });
    assert.equal(body.sessions.action.kind, 'none', 'the server decides the no-run action for a finished task (LIN-4042)');
    const html = await paint(body, { row: DONE_ROW() });
    assert.doesNotMatch(html, /Run to PR/, 'a finished task has nothing to run');
    assert.doesNotMatch(html, /data-action="go"/, 'no go button on a finished task');
    assert.doesNotMatch(html, /data-testid="opened-task-runs-on"/, 'no runs-on line, so no Change for a run');
  });

  test('a Done task whose body carries the no-run decision paints no Run to PR button', async () => {
    const html = await paint(stateWith({ action: NO_RUN }), { row: DONE_ROW() });
    assert.doesNotMatch(html, /Run to PR/, 'a finished task has nothing to run');
    assert.doesNotMatch(html, /data-action="go"/, 'no go button on a finished task');
    assert.doesNotMatch(html, /data-testid="opened-task-runs-on"/, 'no runs-on line, so no Change for a run');
  });

  test('a Done task keeps the Another step list, with its steps counted as left out (LIN-3833 ruling f9fa6bd7)', async () => {
    const html = await paint(stateWith({ action: RUN_TO_PR }), { row: DONE_ROW() });
    assert.match(html, /data-testid="run-another"/);
  });

  test('a Done task offers no stage step either, even when a stale step is offered (the no-run decision wins)', async () => {
    const html = await paint(stateWith({ offered: PLAN_OFFER, action: NO_RUN }), { row: DONE_ROW() });
    assert.doesNotMatch(html, /data-action="run-step-next"/);
  });

  test('an unfinished task whose server action is Run to PR keeps its Run to PR button', async () => {
    const html = await paint(stateWith({ action: RUN_TO_PR }), { row: rowRecordOf({ stateType: 'started' }) });
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
  });

  test('a task with open subtasks (a container) keeps its Run to PR button', async () => {
    const html = await paint(stateWith({ action: RUN_TO_PR }), { row: rowRecordOf({ stateType: 'started', container: true }) });
    assert.match(html, /data-action="go"[^>]*>Run to PR</);
  });

  // Close-out of the review ledger (items 1 and 2): the change's own claims, pinned.
  test('a Done task with a running run keeps its running box and Stop (the early return needs !active)', async () => {
    const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-30T10:00:00.000Z', target: 'local' };
    const html = await paint(stateWith({ running, busy: true, action: null, canStop: true }), { row: DONE_ROW() });
    assert.match(html, /data-testid="opened-task-running"/);
    assert.match(html, /data-testid="run-stop"/);
  });

  test('a Done task with a queued run keeps its queued box', async () => {
    const queued = { loopId: 'q-1', kind: 'implementation', label: 'Build', state: 'queued', target: 'cli' };
    const html = await paint(stateWith({ running: queued, queued, busy: true, action: null, canStop: true }), { row: DONE_ROW() });
    assert.match(html, /data-testid="opened-task-queued"/);
  });

  test('a finished container (Done parent with an open subtask) offers no run, from the server body (LIN-4042 review ledger 2)', async () => {
    const { body } = await doneBody({ children: [stateIssue('LIN-43', 'unstarted', { parent: 'LIN-42' })] });
    assert.equal(body.sessions.action.kind, 'none', 'a finished container offers no run on /state');
    const html = await paint(body, { row: DONE_ROW() });
    assert.doesNotMatch(html, /data-action="go"/);
    assert.doesNotMatch(html, /Run to PR/);
  });

  test('a finished container whose body carries the no-run decision paints no run (ledger 2)', async () => {
    const html = await paint(stateWith({ action: NO_RUN }), { row: DONE_ROW() });
    assert.doesNotMatch(html, /data-action="go"/);
    assert.doesNotMatch(html, /Run to PR/);
  });
});

// LIN-4071 review ledger (M10, M5): the step guard now reads the gatherer's `action` (`container`, `kind: 'none'`), not the
// retired row fields, so the new consumer needs its own witness. A step is "chosen for this run" by picking one in
// Another step (`run-pick`); a container or a finished task must still offer no stage step for it.
describe('LIN-4071 — runStepOfState offers no stage step for a container or a finished task, whatever step was chosen', () => {
  const CONTAINER_ACTION = { kind: 'offer', why: 'a container runs to PR', container: true };

  async function paintAndPick(stateBody, opts) {
    const PromptSection = loadClient({ stateBody });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, ...opts });
    await flush(); await flush(); await flush();
    const btn = { dataset: { action: 'run-pick', kind: 'plan', label: 'Plan' }, disabled: false, textContent: '', classList: { add() {}, remove() {} }, closest: (sel) => (/^button/.test(sel) ? btn : null) };
    for (const fn of c.listenersFor('click')) await fn({ target: btn });
    await flush(); await flush(); await flush();
    return c.innerHTML;
  }

  test('control: a leaf whose action is Run to PR does take the chosen step (the pick reaches the step line and Go)', async () => {
    const html = await paintAndPick(stateWith({ action: RUN_TO_PR }), { row: rowRecordOf({ stateType: 'started' }) });
    assert.match(html, /opened-task-step-name[^>]*>Plan</, 'the chosen stage step is the step line');
    assert.match(html, /data-action="run-step-next"[^>]*>Run Plan</, 'and Go runs it');
  });

  test('a container (action.container) with a step chosen for this run paints no stage step; Go runs Run to PR', async () => {
    const html = await paintAndPick(stateWith({ action: CONTAINER_ACTION, offered: PLAN_OFFER }), { row: { ...rowRecordOf({ stateType: 'started' }), action: CONTAINER_ACTION } });
    assert.doesNotMatch(html, /opened-task-step-name[^>]*>Plan</, 'no stage step line for a container');
    assert.doesNotMatch(html, /data-action="run-step-next"/, 'Go is not the stage step');
    assert.match(html, /data-action="go"[^>]*>Run to PR</, 'Go runs Run to PR');
  });

  test('a finished task (action.kind none) with a step chosen paints no stage step line and no Go', async () => {
    const html = await paintAndPick(stateWith({ action: NO_RUN, offered: PLAN_OFFER }), { row: DONE_ROW() });
    assert.doesNotMatch(html, /data-testid="opened-task-step"/, 'the step line is empty');
    assert.doesNotMatch(html, /data-action="run-step-next"/);
    assert.doesNotMatch(html, /data-action="go"/);
  });

  // M5: on the task page the run slot has no early return for a finished task (that one is Home's), so the `kind: 'none'`
  // check in `runStepOfState` is what keeps a chosen step from becoming a "Run Plan" button on a finished task.
  test('task page: a finished task (action.kind none) with a step chosen offers no stage step and no Go', async () => {
    const html = await paintAndPick(stateWith({ action: NO_RUN, offered: PLAN_OFFER }), { surface: 'task', row: DONE_ROW() });
    assert.doesNotMatch(html, /data-action="run-step-next"/, 'no Run Plan on a finished task');
    assert.doesNotMatch(html, /data-action="go"/);
    assert.doesNotMatch(html, /opened-task-step-name[^>]*>Plan</, 'the chosen step is not the step line');
  });

  test('before the first /state reply, a container row record alone offers no stage step', async () => {
    const PromptSection = loadClient({ stateBody: new Promise(() => {}) });
    const c = makeContainer();
    PromptSection.init(c, { ...HOME, row: { ...rowRecordOf({ stateType: 'started' }), action: CONTAINER_ACTION } });
    await flush();
    assert.doesNotMatch(c.innerHTML, /data-action="run-step-next"/);
  });
});
