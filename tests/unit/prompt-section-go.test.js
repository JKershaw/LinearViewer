// LIN-3341 — "Go is one press".
//
// One press on the opened task starts the autopilot run: it fetches the
// kickoff (stopAt=pr) and dispatches it through the shared assemblers, then
// shows the task page's own started/running sentence. A reopened task reads the
// stored task-state endpoint once on mount, so a run already in progress shows
// the running/waiting line instead of a pressable Go (`live || waiting`).
//
// The sandbox is the same vm house pattern as prompt-section-run-quota.test.js,
// with a tiny DOM shim that understands the one targeted write Go makes
// (`[data-go-slot]`), plus a manual timer queue so the poll is observable.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

// Replace the element carrying `data-go-slot` (a <div>) in a flat HTML string,
// honouring nested <div>s. Setter-only: this is the one write Go makes.
function replaceGoSlot(html, replacement) {
  const open = /<div\b[^>]*\bdata-go-slot\b[^>]*>/.exec(html);
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

function makeContainer() {
  const container = {
    _html: '',
    _fullRenders: 0,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    contains() { return true; },
    _clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this._clickHandler = fn; },
    removeEventListener() {},
    querySelector(sel) {
      const self = this;
      if (sel === '[data-go-slot]') {
        return {
          set outerHTML(v) { self._html = replaceGoSlot(self._html, v); },
          get outerHTML() { return ''; },
        };
      }
      if (sel === '[data-go-notice-slot]') {
        return {
          set innerHTML(v) { self._html = self._html.replace(/(data-go-notice-slot[^>]*>)[\s\S]*?(<\/div>)/, `$1${v}$2`); },
          get innerHTML() { return ''; },
        };
      }
      if (sel === '[data-setup-notice-slot]') {
        return {
          set innerHTML(v) { self._html = self._html.replace(/(data-setup-notice-slot[^>]*>)[\s\S]*?(<\/div>)/, `$1${v}$2`); },
          get innerHTML() { return ''; },
        };
      }
      if (sel === '.swipe-prompt-options') return null;
      return null;
    },
    async click(dataset) {
      const btn = { dataset: { ...dataset }, disabled: false, textContent: '', classList: { add() {}, remove() {} }, closest: () => btn };
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

function loadPromptSection(overrides = {}) {
  const calls = { api: [], dispatch: [], kickoff: [], records: [], fetch: [] };
  const timers = [];
  let timerSeq = 1;

  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    taskPageHref: ({ urlKey, identifier } = {}) => (urlKey && identifier ? `/workspace/${urlKey}/task/${identifier}` : ''),
    readDispatchExecControls: overrides.readDispatchExecControls || (() => ({ model: null, harness: null })),
    renderDispatchDisclosure: () => '<div class="swipe-prompt-options"></div>',
    ProxyToggle: { maybeAppend: async (raw) => raw },
    isPinnedToBottom: () => false,
    toast: () => {},
    readSSEStream: overrides.readSSEStream,
  };
  window.api = async (url, opts) => {
    calls.api.push(url);
    if (String(url).includes('/api/dispatch/quota')) return overrides.quota || null;
    if (String(url).includes('/api/task/')) {
      if (overrides.stateApi) return overrides.stateApi(url, opts);
      return {};
    }
    if (overrides.templateApi) return overrides.templateApi(url, opts);
    return { prompt: 'TEMPLATE PROMPT', promptName: 'Template' };
  };
  window.fetchAutopilotKickoff = async (args) => {
    calls.kickoff.push(args);
    if (overrides.kickoff) return overrides.kickoff(args);
    return { prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' };
  };
  window.dispatchPrompt = async (args) => {
    calls.dispatch.push(args);
    if (overrides.dispatch) return overrides.dispatch(args);
    return { item: { id: 'disp-1' } };
  };

  const sandbox = {
    window,
    AbortController,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: (fn, delay) => { const id = timerSeq++; timers.push({ id, fn, delay, cancelled: false }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cancelled = true; },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async (url, opts) => {
      calls.fetch.push({ url, opts });
      if (String(url).includes('/api/task-mode')) { calls.records.push({ url, opts }); return { ok: true, json: async () => ({}) }; }
      if (String(url).includes('/stream')) return { ok: true };
      if (overrides.streamFetch) return overrides.streamFetch(url, opts);
      return { ok: false, status: 500, json: async () => ({}) };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  const flush = () => new Promise((r) => setImmediate(r));
  async function runTimers() {
    const due = timers.filter((t) => !t.cancelled);
    for (const t of timers) t.cancelled = true;
    for (const t of due) t.fn();
    await flush();
    await flush();
  }
  return { PromptSection: window.PromptSection, window, calls, timers, flush, runTimers };
}

const ISSUE = { id: 'uuid-42', identifier: 'LIN-42', title: 'A task', source: 'linear' };

function baseOpts(extra = {}) {
  return {
    urlKey: 'ws',
    issue: ISSUE,
    surface: 'swipe',
    hasAI: true,
    aiState: 'ready',
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

async function mount(overrides = {}, extra = {}, loadOverrides = {}) {
  const h = loadPromptSection({ ...overrides, ...loadOverrides });
  const container = makeContainer();
  h.PromptSection.init(container, baseOpts(extra));
  await h.flush();
  await h.flush();
  return { ...h, container };
}

describe('LIN-3341 — Go is one press', () => {
  test('one press: one kickoff (stopAt=pr) and one dispatch with the full payload', async () => {
    const m = await mount();
    assert.match(m.container.innerHTML, /data-rung="run-task"[^>]*data-action="go"/, 'Go is ready');
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.flush();

    assert.equal(m.calls.kickoff.length, 1, 'exactly one kickoff fetch');
    assert.equal(m.calls.kickoff[0].stopAt, 'pr', 'the kickoff is bounded to the PR');
    assert.equal(m.calls.dispatch.length, 1, 'exactly one dispatch POST');
    const d = m.calls.dispatch[0];
    assert.equal(d.kind, 'autopilot');
    assert.equal(d.entryRung, 'run-task');
    assert.equal(d.stopAt, 'pr');
    assert.equal(d.variant, 'standard');
    assert.equal(d.proxyForce, true);
    assert.equal(d.target, 'cli');
    assert.equal(d.surface, 'swipe');
    assert.equal(d.harness, 'claude-code', 'a blank panel harness falls back to claude-code');
    assert.match(m.container.innerHTML, /data-testid="opened-task-started"/, 'the started line is shown');
    assert.match(m.container.innerHTML, /href="\/workspace\/ws\/task\/LIN-42"[^>]*data-testid="opened-task-started-link"/, 'with a task-page link');
  });

  test('a double press makes one dispatch', async () => {
    const m = await mount();
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    assert.equal(m.calls.dispatch.length, 1, 'the second press is ignored');
  });

  test('a non-blank panel harness is sent, never null', async () => {
    const m = await mount({}, {}, { readDispatchExecControls: () => ({ model: 'openai/gpt-5.4-mini', harness: 'opencode' }) });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    assert.equal(m.calls.dispatch[0].harness, 'opencode');
    assert.equal(m.calls.dispatch[0].model, 'openai/gpt-5.4-mini');
  });

  test('Go is present in idle, generating, fresh and error', async () => {
    // idle
    const idle = await mount();
    assert.match(idle.container.innerHTML, /data-testid="opened-task-go"/);

    // generating: click ✦ next step with a stream that never settles. The click
    // handler reaches fetchPrompt's first await synchronously, so the phase is
    // already `generating` when it returns.
    const genH = loadPromptSection({ readSSEStream: () => new Promise(() => {}) });
    const genC = makeContainer();
    genH.PromptSection.init(genC, baseOpts());
    await genC.click({ prompt: '__ai__' });
    assert.match(genC.innerHTML, /data-testid="opened-task-go"/, 'Go shows while generating');

    // fresh: a template result
    const fresh = await mount();
    await fresh.container.click({ prompt: 'implementation' });
    await fresh.flush();
    assert.match(fresh.container.innerHTML, /data-testid="opened-task-go"/, 'Go shows in fresh');

    // error: the template fetch throws
    const err = await mount({}, {}, { templateApi: async () => { throw new Error('boom'); } });
    await err.container.click({ prompt: 'implementation' });
    await err.flush();
    assert.match(err.container.innerHTML, /recap-error/, 'error phase rendered');
    assert.match(err.container.innerHTML, /data-testid="opened-task-go"/, 'Go shows in error');
  });

  test('a Go press during the ✦ stream does not rebuild the prompt body (N4)', async () => {
    const m = await mount({}, {}, { readSSEStream: () => new Promise(() => {}) });
    await m.container.click({ prompt: '__ai__' });
    await m.flush();
    const before = m.container.innerHTML;
    const rendersBefore = m.container._fullRenders;
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    assert.equal(m.container._fullRenders, rendersBefore, 'no full container render on the Go press');
    // Everything outside the Go slot is byte-identical — above all the streamed
    // [data-prompt-body], which a full render would have rebuilt (N4).
    assert.equal(replaceGoSlot(m.container.innerHTML, ''), replaceGoSlot(before, ''), 'only the Go slot changed');
  });

  test('the started line takes the task-state header sentence and stops polling when not live', async () => {
    const queue = [
      { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No sessions yet.</p></div>' }, // mount read
      { live: true, status: 'running', headerHtml: '<div class="task-status"><p class="task-sentence">Autopilot running since 12:00.</p></div>' }, // first poll
      { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No session running.</p></div>' } // second poll
    ];
    const m = await mount({}, {}, { stateApi: async () => queue.shift() || { live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No session running.</p></div>' } });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    await m.runTimers(); // first poll
    assert.match(m.container.innerHTML, /Autopilot running since 12:00\./, 'the state header sentence is painted');
    assert.match(m.container.innerHTML, /data-go-status="running"/, 'status is running');
    await m.runTimers(); // second poll says idle
    assert.match(m.container.innerHTML, /No session running\./);
    const active = m.timers.filter((t) => !t.cancelled).length;
    assert.equal(active, 0, 'polling stops once the run is not live');
  });

  test('a 201 no-runner warning adds our plain-words line with the runner link', async () => {
    const m = await mount({ dispatch: async () => ({ item: { id: 'd' }, warning: 'no consumer' }) });
    await m.container.click({ action: 'go', rung: 'run-task' });
    await m.flush();
    assert.match(m.container.innerHTML, /Nothing is listening for this run yet\./);
    assert.match(m.container.innerHTML, /href="\/workspace\/ws\/runner"/);
  });

  test('refusals branch on err.body.code', async () => {
    const dup = await mount({ dispatch: async () => { const e = new Error('dup'); e.status = 409; e.body = { code: 'DUPLICATE_DISPATCH' }; throw e; } });
    await dup.container.click({ action: 'go', rung: 'run-task' });
    await dup.flush();
    assert.match(dup.container.innerHTML, /Already running/);
    assert.match(dup.container.innerHTML, /data-testid="opened-task-go"/, 'Go returns to ready');

    const limited = await mount({ dispatch: async () => { const e = new Error('429'); e.status = 429; e.body = { code: 'RUN_LIMIT_REACHED' }; throw e; } });
    await limited.container.click({ action: 'go', rung: 'run-task' });
    await limited.flush();
    assert.match(limited.container.innerHTML, /used today\u2019s runs/);

    // A code-less 503 (proxyAttachFailed) must NOT read as the run limit.
    const nolimit = await mount({ dispatch: async () => { const e = new Error('503'); e.status = 503; e.body = {}; throw e; } });
    await nolimit.container.click({ action: 'go', rung: 'run-task' });
    await nolimit.flush();
    assert.doesNotMatch(nolimit.container.innerHTML, /used today\u2019s runs/);
    assert.match(nolimit.container.innerHTML, /Couldn\u2019t start the run/);

    // RUN_LIMIT_UNVERIFIED (a 503 WITH a code) also gets the generic line.
    const unverified = await mount({ dispatch: async () => { const e = new Error('503'); e.status = 503; e.body = { code: 'RUN_LIMIT_UNVERIFIED' }; throw e; } });
    await unverified.container.click({ action: 'go', rung: 'run-task' });
    await unverified.flush();
    assert.doesNotMatch(unverified.container.innerHTML, /used today\u2019s runs/);
    assert.match(unverified.container.innerHTML, /Couldn\u2019t start the run/);
  });

  test('a not-set-up Go press records intent and dispatches nothing', async () => {
    const m = await mount({}, { dispatchEnabled: false });
    assert.match(m.container.innerHTML, /data-rung="run-task"[^>]*data-action="setup"/, 'Go shows ○ set up');
    await m.container.click({ action: 'setup', setupNeeds: 'dispatch', rung: 'run-task' });
    await m.flush();
    assert.match(m.container.innerHTML, /Go needs the dispatch runner set up/, 'the notice names Go, not the run-step rung');
    assert.doesNotMatch(m.container.innerHTML, /running this step needs the dispatch runner set up/);
    assert.equal(m.calls.dispatch.length, 0, 'nothing dispatched');
    assert.equal(m.calls.kickoff.length, 0, 'no kickoff');
    assert.equal(m.calls.records.length, 1, 'the press is recorded');
    assert.equal(m.calls.records[0].opts.body.includes('"rung":"run-task"'), true);
    assert.equal(m.calls.records[0].opts.body.includes('"ready":false'), true);
  });

  test('a run-limited Go is disabled while ✦ next step stays enabled', async () => {
    const m = await mount({}, { freeTier: true }, { quota: { limited: true, runsUsed: 10, limit: 10, remaining: 0 } });
    await m.flush();
    const go = m.container.innerHTML.match(/<button[^>]*data-testid="opened-task-go"[^>]*>/);
    assert.ok(go);
    assert.match(go[0], /disabled/);
    assert.match(go[0], /daily run limit reached/);
    const next = m.container.innerHTML.match(/<button[^>]*data-testid="opened-task-next-step"[^>]*>/);
    assert.ok(next);
    assert.doesNotMatch(next[0], / disabled/);
  });

  describe('mount-time live check', () => {
    test('live:true shows the running line and no Go, with zero dispatch POSTs', async () => {
      const m = await mount({}, {}, { stateApi: async () => ({ live: true, status: 'running', headerHtml: '<div class="task-status"><p class="task-sentence">Autopilot queued, waiting for a worker.</p></div>' }) });
      assert.match(m.container.innerHTML, /data-testid="opened-task-started"/);
      assert.match(m.container.innerHTML, /Autopilot queued, waiting for a worker\./);
      assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-go"/);
      assert.equal(m.calls.dispatch.length, 0);
    });

    test('live:false leaves Go ready', async () => {
      const m = await mount({}, {}, { stateApi: async () => ({ live: false, status: 'idle', headerHtml: '<div class="task-status"><p class="task-sentence">No sessions yet.</p></div>' }) });
      assert.match(m.container.innerHTML, /data-rung="run-task"[^>]*data-action="go"/);
      assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-started"/);
    });

    test('a failed read leaves Go ready', async () => {
      const m = await mount({}, {}, { stateApi: async () => { throw new Error('offline'); } });
      assert.match(m.container.innerHTML, /data-rung="run-task"[^>]*data-action="go"/);
    });

    test('waiting (live:false, status:waiting) counts as in progress — no Go, zero POSTs (round-3 1A)', async () => {
      const m = await mount({}, {}, { stateApi: async () => ({ live: false, status: 'waiting', headerHtml: '<div class="task-status"><p class="task-sentence">Waiting for your answer.</p></div>' }) });
      assert.doesNotMatch(m.container.innerHTML, /data-testid="opened-task-go"/, 'Go is suppressed while waiting');
      assert.match(m.container.innerHTML, /Waiting for your answer\./);
      assert.equal(m.calls.dispatch.length, 0);
    });

    test('no read when Go is not set up, when urlKey/identifier is missing, or when window.api is absent', async () => {
      const notReady = await mount({}, { dispatchEnabled: false });
      assert.equal(notReady.calls.api.some((u) => String(u).includes('/api/task/')), false);

      const noKey = loadPromptSection();
      noKey.window.PromptSection.init(makeContainer(), baseOpts({ urlKey: '' }));
      await noKey.flush();
      assert.equal(noKey.calls.api.some((u) => String(u).includes('/api/task/')), false, 'no urlKey → no read');

      const noIdent = loadPromptSection();
      noIdent.window.PromptSection.init(makeContainer(), baseOpts({ issue: { id: 'uuid-42' } }));
      await noIdent.flush();
      assert.equal(noIdent.calls.api.some((u) => String(u).includes('/api/task/')), false, 'no identifier → no read');

      const noApi = loadPromptSection();
      delete noApi.window.api;
      const c = makeContainer();
      noApi.window.PromptSection.init(c, baseOpts());
      await noApi.flush();
      assert.match(c.innerHTML, /data-rung="run-task"[^>]*data-action="go"/, 'Go still renders without window.api');
    });

    test('a result landing after destroy is a no-op', async () => {
      let resolveState;
      const deferred = new Promise((r) => { resolveState = r; });
      const h = loadPromptSection({ stateApi: () => deferred });
      const c = makeContainer();
      const ret = h.window.PromptSection.init(c, baseOpts());
      ret.destroy();
      resolveState({ live: true, status: 'running', headerHtml: '<div>x</div>' });
      await h.flush();
      assert.doesNotMatch(c.innerHTML, /data-testid="opened-task-started"/, 'the post-destroy read does not paint');
      assert.match(c.innerHTML, /data-rung="run-task"[^>]*data-action="go"/, 'the pre-destroy render is untouched');
    });

    test('a press while the read is in flight waits, then dispatches when the read is not live', async () => {
      let resolveState;
      const deferred = new Promise((r) => { resolveState = r; });
      const m = await mount({}, {}, { stateApi: () => deferred });
      await m.container.click({ action: 'go', rung: 'run-task' });
      assert.equal(m.calls.dispatch.length, 0, 'dispatch waits for the read');
      resolveState({ live: false, status: 'idle', headerHtml: '<div>x</div>' });
      await m.flush();
      await m.flush();
      await m.flush();
      assert.equal(m.calls.dispatch.length, 1, 'the press proceeds once the read says not-live');
    });

    test('a press while the read is in flight paints the running line and starts the poll when live (round-3 1B)', async () => {
      let resolveState;
      const deferred = new Promise((r) => { resolveState = r; });
      const m = await mount({}, {}, { stateApi: () => deferred });
      await m.container.click({ action: 'go', rung: 'run-task' });
      resolveState({ live: true, status: 'running', headerHtml: '<div class="task-status"><p class="task-sentence">Autopilot running since 09:00.</p></div>' });
      await m.flush();
      await m.flush();
      await m.flush();
      assert.equal(m.calls.dispatch.length, 0, 'no second run is started');
      assert.match(m.container.innerHTML, /Autopilot running since 09:00\./, 'the running line is painted, not stuck on starting');
      assert.equal(m.timers.filter((t) => !t.cancelled).length, 1, 'the poll is running');
    });
  });
});
