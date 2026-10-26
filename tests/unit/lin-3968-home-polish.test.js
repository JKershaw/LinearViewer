/**
 * LIN-3968: the Home polish on the opened task and the copy-first view. The pieces the other LIN-3968 tests
 * do not reach:
 *   - the stage strip: every stage on one row, one chip each, the offered step marked (server render);
 *   - the row words on every task row, Recent and project rows included (server render);
 *   - the copy-first view names the task a streamed prompt is for, drops the routing breadcrumbs, and shows
 *     the prompt as the text that will be pasted (client, run in a vm like the other PromptSection tests);
 *   - while a stage runs, no other step is offered as an action, and a failed stage is offered again;
 *   - the state block pastes the strip, not the log track; the opened task's buttons carry the house classes.
 *
 * Run with: node --test tests/unit/lin-3968-home-polish.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { buildTaskStages, nextStepOf, buildRowStates } from '../../lib/task-page-loader.js';
import { renderStageStrip } from '../../lib/render-task-page.js';
import { renderPage } from '../../lib/render.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));
const NOW = new Date('2026-10-25T14:00:00.000Z');

// ─── the stage strip ─────────────────────────────────────────────────────────

const sess = (kind, state, over = {}) => ({
  loopId: `${kind}-${state}-${over.n || 0}`, kind, label: kind, state, open: false,
  endedAt: '2026-10-25T13:30:00.000Z', message: null, links: [],
  loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' },
  ...over,
});

/** The strip for a task's sessions, built the way the task page's model builds it. */
function stripOf(sessions, trackerType = 'started') {
  return renderStageStrip({ stages: buildTaskStages(sessions, { trackerType }), nextStep: nextStepOf(sessions, trackerType) }, { now: NOW });
}

/** Each chip as `{name, word, offered}`. */
function chipsOf(html) {
  return [...html.matchAll(/<li class="task-strip-chip"([^>]*)><span class="task-strip-name">([^<]+)<\/span> <span class="task-strip-state">([^<]+)<\/span><\/li>/g)]
    .map(m => ({ name: m[2], word: m[3], offered: /data-offered="true"/.test(m[1]) }));
}

describe('LIN-3968 — the stage strip: one row, one chip per stage', () => {
  test('a failed Review is the offered step, and Close-out follows it as usual', () => {
    const chips = chipsOf(stripOf([sess('plan', 'done'), sess('implementation', 'done'), sess('review', 'failed')]));
    assert.deepEqual(chips.map(c => c.name), ['Plan', 'Build', 'Review', 'Close-out']);
    assert.deepEqual(chips.map(c => c.word), ['done', 'done', 'failed', 'usual']);
    assert.deepEqual(chips.map(c => c.offered), [false, false, true, false]);
  });

  test('while Build runs, its chip says the minutes and no chip is offered', () => {
    const chips = chipsOf(stripOf([sess('plan', 'done'), sess('implementation', 'running', { loop: { takenAt: '2026-10-25T13:54:00.000Z', dispatchedAt: '2026-10-25T13:50:00.000Z' } })]));
    assert.equal(chips.find(c => c.name === 'Build').word, 'running 6m');
    assert.equal(chips.some(c => c.offered), false, 'no step is offered while a stage runs');
  });

  test('a task with no sessions shows the five usual stages, Research first, the first one offered', () => {
    const chips = chipsOf(stripOf([]));
    assert.deepEqual(chips.map(c => c.name), ['Research', 'Plan', 'Build', 'Review', 'Close-out']);
    assert.equal(chips[0].word, 'next', 'the first usual stage is the one offered');
    assert.equal(chips[0].offered, true);
    assert.deepEqual(chips.slice(1).map(c => c.word), ['usual', 'usual', 'usual', 'usual']);
  });

  test('a stage reached more than once is one chip, in the order it was first reached', () => {
    const chips = chipsOf(stripOf([
      sess('plan', 'done', { n: 1 }), sess('implementation', 'done', { n: 1 }), sess('review', 'done', { n: 1 }), sess('implementation', 'done', { n: 2 }),
    ]));
    assert.deepEqual(chips.map(c => c.name), ['Plan', 'Build', 'Review', 'Close-out']);
  });

  test('no stages, no strip', () => {
    assert.equal(renderStageStrip({ stages: [] }, { now: NOW }), '');
  });
});

// ─── the row words on every row ──────────────────────────────────────────────

const loop = (over = {}) => ({
  loopId: 'l1', lineageId: 'l1', issueIdentifier: 'P-1', kind: 'implementation', iteration: 1,
  source: 'history', historyStatus: 'taken', agentState: 'running',
  dispatchedAt: '2026-10-25T13:50:00.000Z', takenAt: '2026-10-25T13:51:00.000Z', resolvedAt: '2026-10-25T13:51:00.000Z',
  terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
  feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
  ...over,
});

const node = (identifier) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, state: { name: 'In Progress', type: 'started' } },
  children: [], depth: 0,
});

describe('LIN-3968 — a row says its state wherever it sits, not only In Progress', () => {
  test('a project row with a running stage carries its words', () => {
    const roots = [node('P-1')];
    const rowStates = buildRowStates({
      roots, loopsByIdentifier: new Map([['P-1', [loop()]]]), enrichLoop, deriveSessionWaiting, now: NOW,
    });
    const html = renderPage([{ project: { id: 'proj-1', name: 'Alpha', content: null }, incomplete: roots, completed: [], completedCount: 0 }], [], [], 'Test', {
      urlKey: 'acme', workspace: { urlKey: 'acme', provider: 'linear' }, rowStates,
    });
    assert.match(html, /data-testid="issue-row-state">Build running · \d+m</, 'the project row says what runs');
  });
});

// ─── the opened task on Home (client) ────────────────────────────────────────

/** A click target that runs the click listeners, as the PromptSection tests do. */
function makeContainer() {
  const listeners = {};
  return {
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    contains() { return true; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    async click(dataset) {
      const btn = { dataset: { ...dataset }, disabled: false, textContent: '', classList: { add() {}, remove() {} }, closest: (sel) => (/^button/.test(sel) ? btn : null) };
      for (const fn of listeners.click || []) await fn({ target: btn });
      return btn;
    },
  };
}

/** A PromptSection sandbox. `events` is the SSE stream the recommend route answers with. */
function load({ stateBody = null, events = [] } = {}) {
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async (url) => {
      if (url.includes('/api/task/')) return stateBody;
      if (url.includes('/api/task-mode/')) return { lastCopy: null };
      return { prompt: 'PLAN PROMPT', promptName: 'Plan' };
    },
    readSSEStream: async (response, onEvent) => { for (const [type, payload] of response.events) await onEvent(type, payload); },
    ProxyToggle: { isActive: () => true, setActive() {}, maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '',
    readDispatchExecControls: () => ({}),
    dispatchPrompt: async () => ({ success: true, item: { id: 'd-1' } }),
    taskPageHref: () => '/workspace/acme/task/LIN-42',
    isPinnedToBottom: () => false,
    toast: () => {},
  };
  const sandbox = {
    window, AbortController, URLSearchParams, TextDecoder, TextEncoder, Blob: class {}, URL,
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: (fn, ms) => { const t = globalThis.setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; },
    clearTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, events, json: async () => ({}) }),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'prompt-section.js' });
  return { PromptSection: sandbox.window.PromptSection };
}

const COPY_FIRST = {
  urlKey: 'acme', surface: 'home', dispatchEnabled: false, runSetup: false, hasAI: true, aiState: 'ok',
  promptMeta: { plan: 'Plan', scoping: 'Scoping', implementation: 'Implementation' },
  issue: { id: 'uuid-42', identifier: 'LIN-42', title: 'Parent work', url: '', stateType: 'started' },
};

const RUN = {
  urlKey: 'acme', surface: 'home', dispatchEnabled: true, runSetup: false, hasAI: true, aiState: 'ok', isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping'],
  issue: { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', stateType: 'started' },
};

describe('LIN-3968 — copy-first: the streamed prompt says which task it is for, as plain text', () => {
  test('a prompt written for a subtask names it and its parent, drops the routing breadcrumbs, and is pasted as text', async () => {
    const events = [
      ['phase', { phase: 'reasoning' }],
      ['delta', { section: 'reasoning', content: 'LIN-42 is split.\n\n↳ LIN-42 is a container → routing to LIN-43\n\n' }],
      ['phase', { phase: 'prompt' }],
      ['delta', { section: 'prompt', content: 'Build the child.\n\n- step one' }],
      ['done', { truncated: false, identifier: 'LIN-43', title: 'Child work', deferredVia: ['LIN-42'] }],
    ];
    const { PromptSection } = load({ events });
    const c = makeContainer();
    PromptSection.init(c, COPY_FIRST);
    await flush();
    await c.click({ prompt: '__ai__' });
    await flush();
    await flush();
    assert.match(c.innerHTML, /data-testid="opened-task-target">This prompt is for LIN-43 Child work, a subtask of LIN-42\. LIN-42’s work is split into subtasks, so Harbour wrote the prompt for the one to do next\./);
    assert.doesNotMatch(c.innerHTML, /routing to|↳/, 'the breadcrumbs are not shown');
    assert.match(c.innerHTML, /<div class="opened-task-text" data-prompt-body>Build the child\.\n\n- step one<\/div>/, 'the prompt is the text that will be pasted');
    assert.doesNotMatch(c.innerHTML, /<li>|<ul>/, 'no markdown list is rendered');
  });

  test('a prompt for the opened task itself names no other task', async () => {
    const events = [
      ['phase', { phase: 'prompt' }],
      ['delta', { section: 'prompt', content: 'Do it.' }],
      ['done', { truncated: false, identifier: 'LIN-42', title: 'Parent work', deferredVia: [] }],
    ];
    const { PromptSection } = load({ events });
    const c = makeContainer();
    PromptSection.init(c, COPY_FIRST);
    await flush();
    await c.click({ prompt: '__ai__' });
    await flush();
    await flush();
    assert.doesNotMatch(c.innerHTML, /opened-task-target/);
  });

  test('the copy and the box controls carry the house button classes', async () => {
    const events = [['phase', { phase: 'prompt' }], ['delta', { section: 'prompt', content: 'Do it.' }], ['done', { truncated: false, identifier: 'LIN-42', deferredVia: [] }]];
    const { PromptSection } = load({ events });
    const c = makeContainer();
    PromptSection.init(c, COPY_FIRST);
    await flush();
    await c.click({ prompt: '__ai__' });
    await flush();
    await flush();
    assert.match(c.innerHTML, /class="btn btn--primary opened-task-copy" data-testid="opened-task-copy"/);
    assert.match(c.innerHTML, /class="btn opened-task-download"/);
    assert.match(c.innerHTML, /class="btn opened-task-regenerate"/);
  });
});

describe('LIN-3968 — run control: one step at a time, a failed stage offered again', () => {
  const state = (sessions) => ({ status: 'idle', live: false, headerHtml: '', stripHtml: '', sessions: { count: 1, last: null, running: null, next: null, offered: null, ...sessions } });

  test('while a stage runs, no other step is offered as an action', async () => {
    const busy = state({
      count: 2, next: { kind: 'review', label: 'Review' }, offered: null,
      last: { label: 'Build', state: 'running', at: null },
      running: { loopId: 'l1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-25T13:54:00.000Z', target: 'cli' },
    });
    const { PromptSection } = load({ stateBody: busy });
    const c = makeContainer();
    PromptSection.init(c, RUN);
    await flush();
    await flush();
    assert.doesNotMatch(c.innerHTML, /Run to PR/, 'the whole-task action is not offered while a stage runs');
    assert.doesNotMatch(c.innerHTML, /data-action="run-step-next"/, 'no next step is run');
    assert.doesNotMatch(c.innerHTML, /data-testid="run-ask-harbour"/, 'the step line offers no prompt action');
    assert.match(c.innerHTML, /Build running/, 'the after-run line still says what runs');
  });

  test('a failed Review is offered again, and says why', async () => {
    const failed = state({
      count: 2, next: { kind: 'close-out', label: 'Close-out' },
      offered: { kind: 'review', label: 'Review', why: 'again', failed: true },
      last: { label: 'Review', state: 'failed', at: null },
    });
    const { PromptSection } = load({ stateBody: failed });
    const c = makeContainer();
    PromptSection.init(c, RUN);
    await flush();
    await flush();
    assert.match(c.innerHTML, /data-action="run-step-next"[^>]*>Run Review</);
    assert.doesNotMatch(c.innerHTML, />Run Close-out</, 'not the stage after it');
    assert.match(c.innerHTML, /failed last time, so it runs again/);
  });

  test('a cancelled Review is offered again, and says why without calling it a failure', async () => {
    const undone = state({
      count: 3, next: { kind: 'review', label: 'Review' },
      offered: { kind: 'review', label: 'Review', why: 'again', failed: false },
      last: { label: 'Review', state: 'cancelled', at: null },
    });
    const { PromptSection } = load({ stateBody: undone });
    const c = makeContainer();
    PromptSection.init(c, RUN);
    await flush();
    await flush();
    assert.match(c.innerHTML, /data-action="run-step-next"[^>]*>Run Review</);
    assert.match(c.innerHTML, /cancelled last time, so it is offered again/);
    assert.doesNotMatch(c.innerHTML, /usually next after Review/, 'not "next after" itself');
    assert.doesNotMatch(c.innerHTML, /failed last time/);
  });

  test('the state block pastes the one-row strip, not the log track', async () => {
    const withStrip = state({});
    withStrip.headerHtml = '<p class="task-sentence">Idle</p>';
    withStrip.stripHtml = '<ol class="task-strip" data-testid="task-page-strip"></ol>';
    withStrip.trackHtml = '<ol data-testid="TRACK-IS-NOT-SHOWN"></ol>';
    const { PromptSection } = load({ stateBody: withStrip });
    const c = makeContainer();
    PromptSection.init(c, RUN);
    await flush();
    await flush();
    assert.match(c.innerHTML, /data-testid="task-page-strip"/);
    assert.doesNotMatch(c.innerHTML, /TRACK-IS-NOT-SHOWN/);
  });
});
