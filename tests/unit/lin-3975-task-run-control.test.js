/**
 * LIN-3975 (PR 1): the task page's run control and its viewers.
 *
 *   - the surface capability table: one row per SURFACES entry, and the rows for home and swipe unchanged;
 *   - the `task` surface (client, vm): the run control with no state block, no repeated running sentence, no
 *     "watch on the task page" link, and the copy-first view with its own "You copied …" line;
 *   - the page (server render): the run control is the owner's only; a member and a guest read the next-step line
 *     in its slot; a finished task has no control; the tracker's state sits outside the repainted status mount;
 *   - the run control's classes are styled by a sheet the task page links, or are hooks (not styled);
 *   - the client mounts the run control before any Markdown render (source order);
 *   - the surface is accepted by the task-mode path and still refused when unknown.
 *
 * Run with: node --test tests/unit/lin-3975-task-run-control.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { SURFACES } from '../../lib/task-mode-store.js';
import { validateTaskModeEvent } from '../../lib/task-mode-store.js';
import { renderTaskPage, renderNextLine } from '../../lib/render-task-page.js';
import { buildPromptOpts } from '../../lib/render-prompt-opts.js';
import { escapeHtml } from '../../lib/utils/html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, '../..', rel), 'utf8');
const SRC = read('public/prompt-section.js');
const flush = () => new Promise((r) => setTimeout(r, 0));
const UUID = '11111111-2222-3333-4444-555555555555';

// ─── the capability table ────────────────────────────────────────────────────

describe('LIN-3975 — the capability table has a row for every surface', () => {
  test('SURFACE_CAPABILITIES keys are exactly the SURFACES vocabulary (a new surface needs a row)', () => {
    const block = /const SURFACE_CAPABILITIES = Object\.freeze\(\{([\s\S]*?)\n {2}\}\);/.exec(SRC)[1];
    const keys = [...block.matchAll(/^ {4}(\w+): /gm)].map((m) => m[1]);
    assert.deepStrictEqual([...keys].sort(), [...SURFACES].sort());
  });

  test('the task row shows the run control and copy-first, with no state block and no watch link', () => {
    const { capabilitiesOf } = load();
    const task = { ...capabilitiesOf('task') };
    assert.equal(task.stateBlock, false);
    assert.equal(task.runControl, true);
    assert.equal(task.copyFirst, true);
    assert.equal(task.watchLink, false, 'the viewer is on the task page already');
    assert.equal(task.runningBody, 'blank', 'the top answer says the running sentence once');
  });

  test('the home row is unchanged: state block, watch link, shared buttons; swipe has none of the run control', () => {
    const { capabilitiesOf } = load();
    const home = { ...capabilitiesOf('home') };
    assert.equal(home.stateBlock, true);
    assert.equal(home.watchLink, true);
    assert.equal(home.sharedButtons, true);
    const swipe = { ...capabilitiesOf('swipe') };
    assert.equal(swipe.runControl, false);
    assert.equal(swipe.stateBlock, false);
    assert.equal(swipe.runningBody, 'header');
    assert.deepStrictEqual({ ...capabilitiesOf('mars') }, swipe, 'an unknown surface reads as swipe');
  });
});

// ─── the client, in a vm ─────────────────────────────────────────────────────

const esc = (s) => escapeHtml(s);

/**
 * The page's stubs. `prompt` answers `/api/prompt/…` (a hang, a failure, or a prompt); `reply` and `rateLimit`
 * drive the streamed reply and the proxy's token-limit notice, so every phase of the component is reachable.
 */
function load({ opened = null, lastCopy = null, prompt = null, fetch = null, reply = null, rateLimit = false, calls = [] } = {}) {
  const window = {
    escapeHtml: esc,
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async (url, o) => {
      calls.push({ url, method: o && o.method ? o.method : 'GET' });
      if (url.includes('/api/task/')) return opened;
      if (url.includes('/api/task-mode/')) return { lastCopy };
      if (url.includes('/api/dispatch/preview')) return null;
      if (url.includes('/api/dispatch/decision-panel')) return { html: '', words: null, withoutEffort: [] };
      if (url.includes('/api/dispatch/presets')) return { presets: [] };
      if (url.includes('/api/dispatch/quota')) return {};
      if (url.includes('/api/prompt/') && prompt) return prompt();
      return { prompt: 'PROMPT', promptName: 'Plan' };
    },
    readSSEStream: reply || (async () => {}),
    fetchAutopilotKickoff: async () => ({ prompt: 'A', promptName: 'Autopilot', kind: 'autopilot' }),
    dispatchPrompt: async () => ({ success: true, item: { id: 'd-1' } }),
    taskPageHref: () => '/workspace/acme/task/LIN-42',
    ProxyToggle: {
      isActive: () => false, setActive() {}, maybeAppend: async (raw) => raw,
      takeRateLimitNotice: () => rateLimit,
      RATE_LIMIT_SKIP_NOTICE: 'The agent-access link was skipped — the token limit was reached. Try again in a few minutes.',
    },
    readDispatchExecControls: () => ({ model: null, harness: null }),
    renderDispatchDisclosure: () => '',
    isPinnedToBottom: () => false,
    toast() {},
  };
  const sandbox = {
    window, AbortController, URLSearchParams, URL, TextDecoder, TextEncoder, Blob: class {},
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} }, activeElement: null },
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: (fn, ms) => { const t = globalThis.setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; },
    clearTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: fetch || (async () => ({ ok: true, json: async () => ({}) })),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'prompt-section.js' });
  return window.PromptSection;
}

/**
 * A container that keeps its markup, as the component writes it. Three writes reach it: the copy line's slot swap
 * (outerHTML), the setup notice's slot (innerHTML, a press) and the token-limit note's slot (textContent). Each is matched on the component's own slot markup,
 * so nothing else in the page is touched. Its own classes (`classList`) and its click listener are recorded, so a
 * test can press a control the way a reader does.
 */
function makeContainer() {
  let html = '';
  const ownClasses = new Set();
  const listeners = {};
  const LAST_COPY_SLOT = /<div class="opened-task-last-copy-slot" data-last-copy-slot>(?:<div class="opened-task-last-copy"[^>]*>[^<]*<\/div>)?<\/div>/;
  const NOTICE_SLOT = /(<div class="opened-task-notice-slot" data-setup-notice-slot aria-live="polite">)(?:<div class="opened-task-setup-notice">[\s\S]*?<\/div>)?<\/div>/;
  const PROXY_SLOT = /(<div class="opened-task-proxy-limit" data-proxy-limit-slot aria-live="polite">)[^<]*<\/div>/;
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    get html() { return html; },
    classList: {
      add(c) { ownClasses.add(c); },
      remove(c) { ownClasses.delete(c); },
      toggle(c) { if (ownClasses.has(c)) ownClasses.delete(c); else ownClasses.add(c); return ownClasses.has(c); },
      contains(c) { return ownClasses.has(c); },
    },
    ownClasses,
    setAttribute() {},
    querySelector(sel) {
      if (sel === '[data-last-copy-slot]' && LAST_COPY_SLOT.test(html)) {
        return { set outerHTML(v) { html = html.replace(LAST_COPY_SLOT, v); } };
      }
      if (sel === '[data-setup-notice-slot]' && NOTICE_SLOT.test(html)) {
        return { set innerHTML(v) { html = html.replace(NOTICE_SLOT, (_, open) => `${open}${v}</div>`); } };
      }
      if (sel === '[data-proxy-limit-slot]' && PROXY_SLOT.test(html)) {
        return { set textContent(v) { html = html.replace(PROXY_SLOT, (_, open) => `${open}${v}</div>`); } };
      }
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    /** A reader's press on a control with these `data-*` attributes (`dataset` keys, camelCase). */
    press(dataset) {
      const btn = { dataset, disabled: false, textContent: '', classList: { add() {}, remove() {} } };
      // A real element answers getAttribute for its data-* attributes, the way the component reads them.
      btn.getAttribute = (name) => {
        const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return key in dataset ? dataset[key] : null;
      };
      btn.closest = (sel) => (sel.includes('button') ? btn : null);
      for (const fn of listeners.click || []) fn({ target: btn });
    },
    contains() { return true; },
    closest() { return null; },
  };
}

const BASE = {
  urlKey: 'acme',
  issue: { id: UUID, identifier: 'LIN-42', title: 'T', url: '', stateType: 'started' },
  dispatchEnabled: true,
  runSetup: false,
  hasAI: true,
  aiState: 'ready',
  isLocalhost: false,
  promptMeta: { plan: 'Plan', implementation: 'Build', research: 'Research', scoping: 'Scoping', review: 'Review' },
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping'],
};

const PLAN_NEXT = {
  count: 1,
  next: { kind: 'plan', label: 'Plan' },
  offered: { kind: 'plan', label: 'Plan', why: 'usual', failed: false },
  last: { label: 'Research', state: 'done', at: null },
  running: null,
  excluded: [],
};
const RUNNING = {
  ...PLAN_NEXT,
  offered: null,
  running: { loopId: 'l1', kind: 'plan', label: 'Plan', state: 'running', since: null, target: 'cli' },
};

async function mount(surface, over = {}, loadOver = {}) {
  const PS = load(loadOver);
  const c = makeContainer();
  PS.init(c, { ...BASE, surface, ...over });
  await flush();
  await flush();
  return c;
}

describe('LIN-3975 — the task surface shows the run control, not the state block', () => {
  test('with a next step: the main action is Run <step>, and there is no state block', async () => {
    const c = await mount('task', {}, { opened: { status: 'idle', live: false, headerHtml: '<p class="task-status">HEADER</p>', sessions: PLAN_NEXT } });
    assert.match(c.innerHTML, /data-testid="opened-task-go"[^>]*data-action="run-step-next"[^>]*>Run Plan</);
    assert.equal(c.innerHTML.includes('data-state-slot'), false, 'no state block on the task surface');
    assert.equal(c.innerHTML.includes('HEADER'), false, 'the top answer already carries the task sentence');
  });

  test('while a stage runs: the running line has no watch link and no repeated sentence', async () => {
    const c = await mount('task', {}, { opened: { status: 'running', live: true, headerHtml: '<p class="task-status">RUNNING SENTENCE</p>', sessions: RUNNING } });
    assert.match(c.innerHTML, /data-testid="opened-task-started"/);
    assert.equal(c.innerHTML.includes('opened-task-started-link'), false, 'no watch link on the task page itself');
    assert.equal(c.innerHTML.includes('RUNNING SENTENCE'), false, 'the running sentence is the top answer\'s, not repeated');
  });

  test('the same running state on Home keeps its watch link', async () => {
    const c = await mount('home', {}, { opened: { status: 'running', live: true, headerHtml: '<p>RUN</p>', sessions: RUNNING } });
    assert.match(c.innerHTML, /data-testid="opened-task-started-link"/);
  });

  test('copy-first (no runner): the copy view carries the last-copy line in its own slot', async () => {
    const lastCopy = { label: 'Plan', kind: 'plan', at: new Date().toISOString() };
    const c = await mount('task', { dispatchEnabled: false }, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, lastCopy });
    assert.match(c.innerHTML, /data-testid="opened-task-write"/, 'the copy-first view writes the prompt');
    assert.match(c.innerHTML, /data-last-copy-slot/);
    assert.match(c.innerHTML, /You copied the Plan prompt/, 'the last copy is read back in the view itself');
    assert.equal(c.innerHTML.includes('data-state-slot'), false);
  });

  test('swipe keeps its own card: no run control, no task-surface markup', async () => {
    const c = await mount('swipe', {}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT } });
    assert.equal(c.innerHTML.includes('opened-task-go--main'), false);
    assert.equal(c.innerHTML.includes('data-state-slot'), false);
  });
});

// ─── the page: owner, member, guest, finished ────────────────────────────────

const PROMPT_OPTS = buildPromptOpts({ openRouterSource: 'env', featureFlags: { runControls: true }, isLocalhost: false });
const PAGE = { deployInfo: {}, featureFlags: {}, workspaces: [] };

/** A small task model, of the shape `buildTaskPageModel` returns (the fields the page renders). */
function model(over = {}) {
  return {
    identifier: 'LIN-50',
    title: 'Build the task page',
    issueId: UUID,
    tracker: { state: { name: 'In Progress', type: 'started' }, url: null, parent: null, subtasks: [], blockedBy: [] },
    status: 'idle',
    sentence: 'Nothing has run yet.',
    sentenceAt: null,
    readyHeader: null,
    live: false,
    finished: false,
    question: null,
    sessions: [],
    guesses: ['plan'],
    nextStep: { kind: 'plan', label: 'Plan', why: 'usual', failed: false },
    stages: [],
    summary: null,
    brief: null,
    recap: null,
    contextMiss: null,
    evidence: null,
    description: null,
    comments: [],
    details: null,
    ...over,
  };
}

function page(m, viewer, promptOpts = null) {
  return renderTaskPage(m, {
    viewer,
    urlKey: 'acme',
    binding: { source: 'linear' },
    stateUrl: `/workspace/acme/api/task/LIN-50/state?issueId=${UUID}`,
    now: new Date('2026-10-26T12:00:00.000Z'),
    pageOptions: PAGE,
    promptOpts,
  });
}

/** The run control's options, as the page carries them in `data-run-opts` (entities decoded). */
function runOptsOf(html) {
  const raw = /data-testid="task-page-run-control" data-run-opts="([^"]*)"/.exec(html);
  if (!raw) return null;
  const decoded = raw[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(decoded);
}

describe('LIN-3975 — the run control is the owner\'s; everyone else reads the next step', () => {
  test('the owner with an unfinished task gets the run control, carrying the task-surface options', () => {
    const html = page(model(), 'owner', PROMPT_OPTS);
    const opts = runOptsOf(html);
    assert.ok(opts, 'the run control carries its options');
    assert.equal(opts.surface, 'task');
    assert.equal(opts.urlKey, 'acme');
    assert.equal(opts.issue.identifier, 'LIN-50');
    assert.equal(opts.issue.source, 'linear');
    assert.equal(opts.dispatchEnabled, true, 'a runner is set up, so the run control is the shared panel');
    assert.doesNotMatch(html, /task-page-next"/, 'the owner reads the run control, not the next-step line');
  });

  test('the owner with no runner gets the copy-first control and the runner link beside it', () => {
    const html = page(model(), 'owner', buildPromptOpts({ openRouterSource: 'env', featureFlags: {}, isLocalhost: false }));
    assert.equal(runOptsOf(html).dispatchEnabled, false);
    assert.match(html, /data-testid="task-page-runner-line"/);
    assert.match(html, /href="\/workspace\/acme\/runner"/);
  });

  test('a member reads the page with no run control, no owner control, and the next step in the slot', () => {
    const html = page(model(), 'member');
    assert.doesNotMatch(html, /task-page-run-control|task-page-owner-widgets|task-page-share-slot/);
    assert.match(html, /<p class="task-next" data-testid="task-page-next">Plan comes next\.<\/p>/);
  });

  test('a guest reads the same as a member: no control, the next step', () => {
    const html = page(model(), 'guest');
    assert.doesNotMatch(html, /task-page-run-control|task-page-owner-widgets/);
    assert.match(html, /data-testid="task-page-next"/);
  });

  test('a finished task has no run control for the owner, and the next-step line says it is finished', () => {
    const html = page(model({ finished: true, nextStep: null, status: 'done' }), 'owner', PROMPT_OPTS);
    assert.doesNotMatch(html, /task-page-run-control/);
    assert.match(html, /Nothing comes next: this task is finished\./);
  });

  test('the tracker\'s state sits before the status mount the poll repaints, never inside it', () => {
    const html = page(model(), 'owner', PROMPT_OPTS);
    const tracker = html.indexOf('data-testid="task-page-tracker-state"');
    const mountAt = html.indexOf('data-testid="task-page-answer-status"');
    const statusAt = html.indexOf('data-testid="task-page-status"');
    assert.ok(tracker > 0 && mountAt > tracker && statusAt > mountAt);
    assert.match(html, /Tracker: In Progress/);
  });

  test('the answer says which state is Harbour\'s: the pill is labelled Harbour, inside the repainted status', () => {
    const html = page(model(), 'owner', PROMPT_OPTS);
    const label = html.indexOf('data-testid="task-page-harbour-label"');
    const pill = html.indexOf('data-testid="task-page-status-pill"');
    const statusAt = html.indexOf('data-testid="task-page-status"');
    assert.ok(label > statusAt && pill > label, 'the Harbour label sits in the status mount, before the pill');
    assert.match(html, /task-page-harbour-label">Harbour:<\/span>/);
  });
});

describe('LIN-3975 — the next-step line says what the page offers, in plain words', () => {
  test('each state of the next step has its sentence', () => {
    assert.match(renderNextLine(model()), />Plan comes next\.</);
    assert.match(renderNextLine(model({ nextStep: { kind: 'implementation', label: 'Build', why: 'again', failed: false } })), />Build was cancelled, so it comes next again\.</);
    assert.match(renderNextLine(model({ nextStep: { kind: 'review', label: 'Review', why: 'again', failed: true } })), />Review failed, so it comes next, to run again\.</);
    assert.match(renderNextLine(model({ nextStep: null, status: 'waiting' })), />Nothing comes next until the question above is answered\./);
    assert.match(renderNextLine(model({ nextStep: null, status: 'running' })), />A step is running, so nothing else is offered yet\./);
    assert.match(renderNextLine(model({ finished: true, nextStep: null })), />Nothing comes next: this task is finished\./);
  });
});

// ─── the stylesheet bound ────────────────────────────────────────────────────

/** The class names a stylesheet defines (every `.name` token outside comments). */
function classesIn(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set([...bare.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
}

/** The linked sheets: the classes the task page's stylesheets define. */
const TASK_SHEETS = ['style.css', 'common-actions.css', 'session.css', 'stage-track.css', 'run-control.css', 'task-page.css'];
const IDENT = /^[A-Za-z][\w-]*$/;

/**
 * Hooks: classes the component draws for JS, tests or a repaint, and that no sheet defines on purpose. Each entry
 * says why it has no rule. The witness below checks that every one is defined nowhere, so a rule added later
 * moves the entry out of this list in the same change.
 */
const HOOK = Object.freeze({
  'autopilot-btn': 'test/JS hook on the Autopilot prompt button; the swipe-prompt-btn base rule draws it',
  'opened-task-all': 'test/JS hook on the "All N" button; the .btn base class draws it',
  'opened-task-another-item': 'test/JS hook on a run-another item; the .btn base class draws it',
  'opened-task-another-more': 'test/JS hook on the "Show N more" button; the .btn--quiet base class draws it',
  'opened-task-choice': 'test/JS hook on a target choice; the .btn base class draws it',
  'opened-task-download': 'test/JS hook on the download button; the .btn base class draws it',
  'opened-task-go--limited': 'modifier on the Go button when the run limit is reached; the .opened-task-go rule draws it',
  'opened-task-go--setup': 'modifier on the Go button when the runner is not set up; the .opened-task-go rule draws it',
  'opened-task-last-copy-slot': 'repaint slot for the copy line (outerHTML swap); no rule of its own',
  'opened-task-notice-slot': 'repaint slot for the setup notice (innerHTML write); no rule of its own',
  'opened-task-proxy-limit': 'repaint slot for the token-limit note (textContent write); no rule of its own',
  'opened-task-left-out': 'the "N steps left out" note in the run-another list; a plain paragraph by design',
  'opened-task-needs-you': 'the subtask line in the state block, which the task surface does not draw',
  'opened-task-needs-you-name': 'the subtask name span in the state block, which the task surface does not draw',
  'opened-task-needs-you-open': 'the subtask link in the state block, which the task surface does not draw; a .btn--quiet',
  'opened-task-preset': 'test/JS hook on a preset button; the .btn base class draws it',
  'opened-task-runs-on-what': 'a plain text span inside the "Runs on" sentence; it reads as text by design',
  'opened-task-settings-link': 'a plain link inside the "Runs on" sentence; it inherits the sentence style',
  'opened-task-source': 'a plain text span inside the "Runs on" sentence; it reads as text by design',
  'opened-task-use': 'test/JS hook on the "Use for this run" button; the .btn--primary base class draws it',
  'opened-task-proposal-apply': 'test/JS hook on the Apply button of a staged chat proposal; the .btn--primary base class draws it',
  'opened-task-proposal-decline': 'test/JS hook on the Decline button of a staged chat proposal; the .btn--quiet base class draws it',
  'swipe-reasoning': 'Swipe\'s hook on the reasoning toggle; the task surface styles the same block by opened-task-reasoning',
});

/**
 * Swipe-only classes: defined by swipe.css and drawn by Swipe's own card, never by the task surface. The witness
 * below checks two things: each is defined by swipe.css and not by a task sheet, and no task-surface phase emits one.
 */
const SWIPE_ONLY = Object.freeze({
  'swipe-prompt-btn': 'the prompt-button row Swipe draws (renderPromptButtons); the task surface has no such row',
  'swipe-prompt-btn-more': 'the "more" button of Swipe\'s prompt-button row',
  'swipe-prompt-buttons': 'the prompt-button row Swipe draws (renderPromptButtons)',
  'custom-prompt-btn': 'a custom prompt in Swipe\'s prompt-button row',
  'swipe-prompt-copy': 'Swipe\'s action cluster (renderActionCluster): copy, download and edit',
  'swipe-prompt-download': 'Swipe\'s action cluster (renderActionCluster): copy, download and edit',
  'swipe-prompt-edit': 'Swipe\'s action cluster (renderActionCluster): copy, download and edit',
  'copied': 'the copied state of Swipe\'s copy button (swipe-prompt-copy.copied)',
  'opened-task-proxy': 'the +proxy disclosure in Swipe\'s action cluster',
  'opened-task-proxy-faq': 'the +proxy disclosure in Swipe\'s action cluster',
  'opened-task-proxy-label': 'the +proxy disclosure in Swipe\'s action cluster',
});

/** Every class token the component's source can write: `class="…"` attributes and classList calls. */
function classTokensOfSource(src) {
  const tokens = new Set();
  for (const m of src.matchAll(/class="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) if (IDENT.test(t)) tokens.add(t);
  for (const m of src.matchAll(/classList\.(?:add|toggle|remove)\('([^']+)'/g)) tokens.add(m[1]);
  return tokens;
}

/** The class tokens a rendered page (or a container's own classes) carries. */
function classTokensOfMarkup(html, own = new Set()) {
  const tokens = new Set(own);
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
  return tokens;
}

/**
 * Each phase, reached the way a reader reaches it: a render, a press, or a stubbed reply. `marker` is what the
 * phase must show, so a driver that did not reach its state fails here instead of passing vacuously.
 */
async function everyPhase() {
  const hangs = () => new Promise(() => {});
  const fails = async () => { throw new Error('boom'); };
  const prompt = async () => ({ prompt: 'PROMPT', promptName: 'Plan' });
  const reply = async (_resp, onEvent) => { onEvent('done', {}); };
  const phases = [];
  const run = async (name, marker, surface, over, loadOver, presses = []) => {
    const PS = load(loadOver);
    const c = makeContainer();
    PS.init(c, { ...BASE, surface, ...over });
    await flush();
    await flush();
    for (const dataset of presses) {
      c.press(dataset);
      await flush();
      await flush();
    }
    phases.push({ name, marker, html: c.html, own: c.ownClasses });
  };
  const idle = { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT };
  const copyFirst = { dispatchEnabled: false };
  await run('run idle', /data-testid="opened-task-go"/, 'task', {}, { opened: idle });
  await run('run running', /data-testid="opened-task-started"/, 'task', {}, { opened: { status: 'running', live: true, headerHtml: '', sessions: RUNNING } });
  await run('run generating', /generating…/, 'task', {}, { opened: idle, prompt: hangs }, [{ prompt: 'plan' }]);
  await run('run error', /prompt · error/, 'task', {}, { opened: idle, prompt: fails }, [{ prompt: 'plan' }]);
  await run('run fresh', /data-prompt-body/, 'task', {}, { opened: idle, prompt: prompt }, [{ prompt: 'plan' }]);
  await run('run change open', /data-testid="run-change"|opened-task-change-panel/, 'task', {}, { opened: idle }, [{ action: 'change-run' }]);
  // Not a phase: the setup notice has no press on the task surface. A runner-less owner gets the copy-first view,
  // whose only control is "Write the prompt", and the run control's Go setup button is drawn only when the run
  // control is off. The notice's slot is still emitted by the fresh copy-first phase below.
  await run('copy-first idle', /data-testid="opened-task-write"/, 'task', copyFirst, { opened: idle });
  await run('copy-first generating', /generating…/, 'task', copyFirst, { opened: idle, prompt: hangs }, [{ prompt: 'plan' }]);
  await run('copy-first error', /prompt · error/, 'task', copyFirst, { opened: idle, prompt: fails }, [{ prompt: 'plan' }]);
  await run('copy-first fresh', /data-prompt-body/, 'task', copyFirst, { opened: idle, prompt: prompt }, [{ prompt: 'plan' }]);
  await run('copy-first after a copy', /You copied the Plan prompt/, 'task', copyFirst, { opened: idle, lastCopy: { label: 'Plan', kind: 'plan', at: new Date().toISOString() } });
  await run('prompt warning', /swipe-prompt-warning/, 'task', {}, { opened: idle, reply, fetch: async () => ({ ok: true }) }, [{ prompt: '__ai__' }]);
  await run('proxy limit', /opened-task-proxy-limit[^>]*>The agent-access link was skipped/, 'task', copyFirst, { opened: idle, prompt: prompt, rateLimit: true }, [{ prompt: 'plan' }, { action: 'copy' }]);
  await run('swipe card', /swipe-prompt-buttons|swipe-prompt-header/, 'swipe', {}, { opened: idle });
  return phases;
}

describe('LIN-3975 — the run control\'s classes are styled by the sheets the task page links', () => {
  test('static: every class token the component can write is styled by a linked sheet, a swipe-only rule, or a hook', () => {
    const src = read('public/prompt-section.js');
    const linked = new Set(TASK_SHEETS.flatMap((f) => [...classesIn(read(`public/${f}`))]));
    const swipe = classesIn(read('public/swipe.css'));
    const everywhere = new Set(readdirSync(join(__dirname, '../../public')).filter((f) => f.endsWith('.css')).flatMap((f) => [...classesIn(read(`public/${f}`))]));
    const unclassified = [...classTokensOfSource(src)].filter((t) => !linked.has(t) && !(t in SWIPE_ONLY) && !(t in HOOK));
    assert.deepStrictEqual(unclassified, [], 'a class the component writes must be styled by a linked sheet, or listed with a reason');
    for (const t of Object.keys(SWIPE_ONLY)) {
      assert.ok(swipe.has(t), `${t} is styled by swipe.css`);
      assert.equal(linked.has(t), false, `${t} is not styled by a task sheet`);
    }
    for (const t of Object.keys(HOOK)) assert.equal(everywhere.has(t), false, `${t} is defined by no sheet, as its entry says`);
  });

  test('dynamic: every phase is reached, and every class a phase emits is styled by a linked sheet or is a hook', async () => {
    const linked = new Set(TASK_SHEETS.flatMap((f) => [...classesIn(read(`public/${f}`))]));
    const phases = await everyPhase();
    for (const ph of phases) assert.match(ph.html, ph.marker, `the "${ph.name}" phase is reached`);
    const emittedBy = new Map();
    for (const ph of phases.filter((p) => p.name !== 'swipe card')) {
      for (const t of classTokensOfMarkup(ph.html, ph.own)) {
        if (!emittedBy.has(t)) emittedBy.set(t, []);
        emittedBy.get(t).push(ph.name);
      }
    }
    const unstyled = [...emittedBy.keys()].filter((t) => !linked.has(t) && !(t in HOOK));
    assert.deepStrictEqual(unstyled.map((t) => `${t} (${emittedBy.get(t)[0]})`), [], 'a class emitted on the task surface is styled by a linked sheet, or is a hook');
  });

  test('dynamic: no task-surface phase emits a swipe-only class (the claim is checked, not a comment)', async () => {
    const phases = await everyPhase();
    const leaked = [];
    for (const ph of phases.filter((p) => p.name !== 'swipe card')) {
      for (const t of classTokensOfMarkup(ph.html, ph.own)) if (t in SWIPE_ONLY) leaked.push(`${t} (${ph.name})`);
    }
    assert.deepStrictEqual(leaked, []);
    // Control: Swipe's own card does emit the swipe-only classes, so the check above can fail.
    const swipeCard = phases.find((p) => p.name === 'swipe card');
    assert.ok(classTokensOfMarkup(swipeCard.html).has('swipe-prompt-buttons'), 'the control phase emits a swipe-only class');
  });

  test('run-control.css holds the component\'s moved rules, and swipe.css no longer defines them', () => {
    const moved = classesIn(read('public/run-control.css'));
    assert.ok(moved.has('opened-task-go') && moved.has('opened-task-ladder') && moved.has('swipe-prompt-header'));
    const swipe = classesIn(read('public/swipe.css'));
    for (const c of ['opened-task-go', 'opened-task-ladder', 'opened-task-reasoning', 'swipe-prompt-warning']) {
      assert.equal(swipe.has(c), false, `${c} now lives in run-control.css`);
    }
    assert.ok(swipe.has('opened-task-proxy'), 'the proxy disclosure stays with Swipe\'s own action cluster');
  });
});
// ─── the client's wiring order ───────────────────────────────────────────────

describe('LIN-3975 — a staged chat proposal is applied or declined from the run control', () => {
  const PROPOSAL = { id: 'prop-1', runId: 'run-9', reason: 'Please post a status update.' };

  async function mountWithProposal(calls) {
    const PS = load({ opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, calls });
    const c = makeContainer();
    PS.init(c, { ...BASE, surface: 'task', proposals: [PROPOSAL] });
    await flush();
    await flush();
    return c;
  }

  test('the proposal is listed with its reason, and Apply and Decline sit beside it', async () => {
    const c = await mountWithProposal([]);
    assert.match(c.innerHTML, /data-testid="opened-task-proposals"/);
    assert.match(c.innerHTML, /Proposed in chat: Please post a status update\./);
    assert.match(c.innerHTML, /data-action="apply-proposal" data-proposal-id="prop-1" data-run-id="run-9"[^>]*>Apply</);
    assert.match(c.innerHTML, /data-action="decline-proposal" data-proposal-id="prop-1" data-run-id="run-9"[^>]*>Decline</);
    assert.match(c.innerHTML, /Change does not apply to it/, 'the run control says what Apply does');
  });

  test('Apply posts to the run page\'s apply endpoint, then settles the row to one quiet word', async () => {
    const calls = [];
    const c = await mountWithProposal(calls);
    c.press({ action: 'apply-proposal', proposalId: 'prop-1', runId: 'run-9' });
    await flush();
    await flush();
    const post = calls.find(call => /\/proposals\/prop-1\/apply$/.test(call.url));
    assert.ok(post, 'the apply endpoint is called');
    assert.equal(post.method, 'POST');
    assert.match(post.url, /\/api\/run\/run-9\/proposals\/prop-1\/apply$/);
    assert.match(c.innerHTML, /data-testid="opened-task-proposal-state">applied</, 'settled in place');
    assert.doesNotMatch(c.innerHTML, /data-action="apply-proposal"/, 'no Apply once applied');
  });

  test('Decline posts to the decline endpoint and never to apply', async () => {
    const calls = [];
    const c = await mountWithProposal(calls);
    c.press({ action: 'decline-proposal', proposalId: 'prop-1', runId: 'run-9' });
    await flush();
    await flush();
    assert.ok(calls.some(call => /\/proposals\/prop-1\/decline$/.test(call.url)));
    assert.ok(!calls.some(call => /\/apply$/.test(call.url)));
    assert.match(c.innerHTML, /data-testid="opened-task-proposal-state">declined</);
  });
});

describe('LIN-3975 — the run control is wired before the first Markdown render', () => {
  test('public/task-page.js init: PromptSection.init on the run control precedes every Markdown render', () => {
    const src = read('public/task-page.js');
    const start = src.indexOf('  function init(doc) {');
    const end = src.indexOf('    function toggle(row) {');
    assert.ok(start > 0 && end > start, 'init is found');
    const init = src.slice(start, end);
    const mount = init.indexOf('window.PromptSection.init(runRoot, runOpts)');
    const markdown = init.search(/enhanceContextMarkdown\(|enhanceMarkdown\(/);
    assert.ok(mount > 0, 'the run control is mounted in init');
    assert.ok(markdown > mount, 'the first Markdown render comes after the run control is wired');
  });

  test('the page scripts load prompt-section.js and decision-panel.js for both viewers (the head stays byte-identical)', () => {
    const html = page(model(), 'guest');
    assert.match(html, /<script src="\/prompt-section\.js"/);
    assert.match(html, /<script src="\/decision-panel\.js"/);
    assert.match(html, /<link rel="stylesheet" href="\/run-control\.css">/);
  });
});

// ─── the task-mode path ──────────────────────────────────────────────────────

describe('LIN-3975 — the task surface is accepted by the task-mode path, an unknown one still refused', () => {
  const event = (over = {}) => ({ accountId: 'acct-1', urlKey: 'ws', issueId: 'uuid-42', issueIdentifier: 'LIN-42', rung: 'copy', ready: true, needs: null, act: 'copy', dispatchId: null, surface: 'task', ...over });

  test('surface task is valid; mars is refused', () => {
    assert.equal(validateTaskModeEvent(event()), null);
    assert.match(validateTaskModeEvent(event({ surface: 'mars' })), /surface must be one of swipe, home, task/);
  });
});
