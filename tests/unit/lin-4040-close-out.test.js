// LIN-4040 close-out — the review ledger's fixes A (the Swipe ladder's "run this step" rung follows the one run offer, and a
// press re-reads it), B (the running line names the first worker's own issue or none) and C (pinned in
// task-page-question.test.js: the task page's pill says "needs you"). Same vm-sandbox house pattern as
// prompt-section-run-quota.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { firstWorkerIdentifier } from '../../lib/task-page-loader.js';
import { runWordsOf } from '../../lib/task-run-facts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

const flush = () => new Promise((r) => setImmediate(r));

const RUN_LIMIT_TITLE = 'daily run limit reached \u00b7 resets at midnight UTC';

// Replace the first <div> carrying the bare attribute `attr`, honouring nested
// <div>s. The setter-only slot write a paint*() helper makes (LIN-3267).
function replaceSlot(html, attr, replacement) {
  const open = new RegExp(`<div\\b[^>]*\\b${attr}\\b[^>]*>`).exec(html);
  if (!open) return html;
  const start = open.index;
  let depth = 1;
  const tagRe = /<div\b|<\/div>/g;
  tagRe.lastIndex = start + open[0].length;
  let t;
  while ((t = tagRe.exec(html))) {
    if (t[0] === '</div>') { depth -= 1; if (depth === 0) return html.slice(0, start) + replacement + html.slice(t.index + 6); }
    else depth += 1;
  }
  return html;
}

// LIN-3267: resolves [data-go-slot] / [data-ladder-slot] and counts whole-
// container innerHTML writes (`_fullRenders`), so a slot repaint can be told
// apart from a full rebuild.
function makeContainer() {
  const container = {
    _html: '',
    _fullRenders: 0,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector(sel) {
      const m = /^\[(data-go-slot|data-ladder-slot)\]$/.exec(sel);
      if (!m || !new RegExp(`\\b${m[1]}\\b`).test(this._html)) return null;
      const self = this;
      return {
        set outerHTML(v) { self._html = replaceSlot(self._html, m[1], v); },
        get outerHTML() { return ''; },
      };
    },
    contains() { return true; },
    _clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this._clickHandler = fn; },
    removeEventListener() {},
    async click(dataset) {
      const btn = { dataset: { ...dataset }, disabled: false, textContent: 'label', classList: { add() {}, remove() {} }, closest: (sel) => (/^button/.test(sel) ? btn : null) };
      await this._clickHandler({ target: btn });
      return btn;
    },
  };
  Object.defineProperty(container, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = v; this._fullRenders += 1; },
  });
  return container;
}

function loadPromptSection({ quota, dispatch, stateReply } = {}) {
  const calls = { api: [], dispatch: [], order: [] };
  const timers = [];
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async (url) => {
      calls.api.push(url);
      if (String(url).endsWith('/api/dispatch/quota')) {
        calls.order.push('quota');
        // LIN-3267: a function yields the allowance at each read.
        return typeof quota === 'function' ? quota() : quota;
      }
      if (/\/api\/task\/[^/]+\/state/.test(String(url))) {
        calls.order.push('state');
        return typeof stateReply === 'function' ? stateReply() : stateReply;
      }
      return { prompt: 'TEMPLATE PROMPT', promptName: 'Template' };
    },
    ProxyToggle: { maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '<div class="swipe-prompt-options"></div>',
    readDispatchExecControls: () => ({}),
    dispatchPrompt: async (args) => {
      calls.dispatch.push(args);
      calls.order.push('dispatch');
      if (dispatch) return dispatch(args);
      return { item: { id: 'disp-1' } };
    },
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
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout: () => {},
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  // Fire every pending timer once (the 2s button-restore), then let reads settle.
  async function runTimers() {
    const due = timers.splice(0);
    for (const t of due) t.fn();
    await flush();
    await flush();
  }
  return { PromptSection: window.PromptSection, window, calls, timers, runTimers };
}

const ISSUE = { id: 'uuid-42', identifier: 'LIN-42', title: 'A task' };
const OFFER = { kind: 'offer', container: false, step: null, why: 'the run control offers the three rungs' };
const BUSY = { kind: 'busy', identifier: 'LIN-43', words: null, why: 'a run is in flight on this task or a subtask, so none is offered' };
const ANSWER_FIRST = { kind: 'answer-first', identifiers: ['LIN-42'], why: 'a question needs you before a run is offered' };
const NONE = { kind: 'none', why: 'the task is finished, so no run is offered' };

function baseOpts(extra = {}) {
  // LIN-3849: `runSetup` (the owner's "set up ›" rung) defaults to the old not-dispatch-enabled state.
  const o = {
    urlKey: 'ws',
    issue: ISSUE,
    surface: 'swipe',
    hasAI: true,
    aiState: 'ready',
    freeTier: true,
    dispatchEnabled: true,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: ['implementation'],
    morePromptKeys: [],
    promptMeta: { implementation: 'Implementation' },
    // LIN-4040 close-out (review A): the run-step rung is enabled only while the card's offer says `offer`.
    row: { action: { kind: 'offer', container: false, step: null, why: 'the run control offers the three rungs' } },
    row: { action: OFFER },
    ...extra,
  };
  return { runSetup: !o.dispatchEnabled, ...o };
}

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

const runStepTag = (html) => tagFor(html, 'run-step');

describe('LIN-4040 close-out A — the ladder\'s "run this step" rung follows the one offer', () => {
  test('an offer draws the rung enabled', async () => {
    const m = await mountFresh({ row: { action: OFFER } }, { quota: QUOTA_FULL });
    assert.match(runStepTag(m.container.innerHTML) || '', /data-action="run-step"/);
    assert.doesNotMatch(runStepTag(m.container.innerHTML) || '', /disabled/);
  });

  for (const [name, action, why] of [['busy', BUSY, BUSY.why], ['answer-first', ANSWER_FIRST, ANSWER_FIRST.why], ['none (finished)', NONE, NONE.why]]) {
    test(`${name}: the rung is drawn disabled with the offer's reason, and carries no run action`, async () => {
      const m = await mountFresh({ row: { action } }, { quota: QUOTA_FULL });
      const tag = runStepTag(m.container.innerHTML) || '';
      assert.match(tag, /disabled/);
      assert.doesNotMatch(tag, /data-action="run-step"/);
      assert.ok(tag.includes(`title="${why}"`), 'the title is the offer\'s own reason');
    });
  }

  test('no offer known (neither the state nor the row carries one): no run is offered', async () => {
    const m = await mountFresh({ row: null }, { quota: QUOTA_FULL });
    const tag = runStepTag(m.container.innerHTML) || '';
    assert.match(tag, /disabled/);
    assert.doesNotMatch(tag, /data-action="run-step"/);
  });

  test('the state read wins over the row: a busy state read redraws an offered card\'s rung disabled', async () => {
    const m = await mountFresh({ row: { action: OFFER } }, { quota: QUOTA_FULL, stateReply: { sessions: { action: BUSY, busy: true, count: 1 } } });
    await flush();
    const tag = runStepTag(m.container.innerHTML) || '';
    assert.match(tag, /disabled/);
    assert.doesNotMatch(tag, /data-action="run-step"/);
  });

  test('stale press: drawn as an offer, but a run started since — the press re-reads, refuses, and dispatches nothing', async () => {
    let reply = { sessions: { action: OFFER, busy: false, count: 0 } };
    const m = await mountFresh({ row: { action: OFFER } }, { quota: QUOTA_FULL, stateReply: () => reply });
    assert.match(runStepTag(m.container.innerHTML) || '', /data-action="run-step"/, 'enabled on the first read');
    // A run starts after the card was drawn; the next state read says so.
    reply = { sessions: { action: BUSY, busy: true, count: 1 } };
    await m.container.click({ action: 'run-step', target: 'cli' });
    await flush();
    assert.equal(m.calls.dispatch.length, 0, 'nothing is sent');
    assert.match(m.container.innerHTML, /A run started on this task while you were choosing, so nothing was started\./);
  });

  test('a press that is still an offer on the re-read dispatches once, as a run-step', async () => {
    const m = await mountFresh({ row: { action: OFFER } }, { quota: QUOTA_FULL, stateReply: { sessions: { action: OFFER, busy: false, count: 0 } } });
    await m.container.click({ action: 'run-step', target: 'cli' });
    await flush();
    assert.equal(m.calls.dispatch.length, 1);
    assert.equal(m.calls.dispatch[0].entryRung, 'run-step');
  });
});

describe('LIN-4040 close-out B — the running line names the first worker\'s own issue, or none', () => {
  test('this task\'s own worker is named', () => {
    assert.equal(firstWorkerIdentifier({ loop: { issueIdentifier: 'LIN-4011' } }, 'LIN-4011'), 'LIN-4011');
    assert.equal(firstWorkerIdentifier({ loop: { issueIdentifier: 'lin-4011' } }, 'LIN-4011'), 'lin-4011');
  });
  test('a subtask\'s worker under a container is not named as the container', () => {
    assert.equal(firstWorkerIdentifier({ loop: { issueIdentifier: 'LIN-4012' } }, 'LIN-4011'), null);
    assert.equal(runWordsOf({ found: true, stopAt: null, stage: 'Research', identifier: firstWorkerIdentifier({ loop: { issueIdentifier: 'LIN-4012' } }, 'LIN-4011') }), 'Running to Done');
    assert.equal(runWordsOf({ found: true, stopAt: 'pr', stage: 'Research', identifier: firstWorkerIdentifier({ loop: { issueIdentifier: 'LIN-4012' } }, 'LIN-4011') }), 'Running to PR');
  });
  test('a worker that does not say its issue drops the clause', () => {
    for (const first of [null, undefined, {}, { loop: null }, { loop: {} }, { loop: { issueIdentifier: '' } }, { loop: { issueIdentifier: null } }]) {
      assert.equal(firstWorkerIdentifier(first, 'LIN-4011'), null);
    }
    assert.equal(firstWorkerIdentifier({ loop: { issueIdentifier: 'LIN-4011' } }, null), null);
  });
});
