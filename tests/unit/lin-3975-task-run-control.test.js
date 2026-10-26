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
import { readFileSync } from 'node:fs';
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

function load({ opened = null, lastCopy = null } = {}) {
  const window = {
    escapeHtml: esc,
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async (url) => {
      if (url.includes('/api/task/')) return opened;
      if (url.includes('/api/task-mode/')) return { lastCopy };
      if (url.includes('/api/dispatch/preview')) return null;
      if (url.includes('/api/dispatch/decision-panel')) return { html: '', words: null, withoutEffort: [] };
      if (url.includes('/api/dispatch/presets')) return { presets: [] };
      if (url.includes('/api/dispatch/quota')) return {};
      return { prompt: 'PROMPT', promptName: 'Plan' };
    },
    fetchAutopilotKickoff: async () => ({ prompt: 'A', promptName: 'Autopilot', kind: 'autopilot' }),
    dispatchPrompt: async () => ({ success: true, item: { id: 'd-1' } }),
    taskPageHref: () => '/workspace/acme/task/LIN-42',
    ProxyToggle: { isActive: () => false, setActive() {}, maybeAppend: async (raw) => raw },
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
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'prompt-section.js' });
  return window.PromptSection;
}

/**
 * A container that keeps its markup, as the component writes it. Its one slot repaint is the copy line's: the
 * component swaps `[data-last-copy-slot]` by outerHTML, so the fake supports exactly that swap, and nothing else.
 */
function makeContainer() {
  let html = '';
  const LAST_COPY_SLOT = /<div class="opened-task-last-copy-slot" data-last-copy-slot>(?:<div class="opened-task-last-copy"[^>]*>[^<]*<\/div>)?<\/div>/;
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    querySelector(sel) {
      if (sel !== '[data-last-copy-slot]' || !LAST_COPY_SLOT.test(html)) return null;
      return { set outerHTML(v) { html = html.replace(LAST_COPY_SLOT, v); } };
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
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

/** Hooks: classes the component draws for JS or tests, styled by no sheet on purpose (one reason each). */
const HOOKS = {
  btn: 'a house button class: styled by common-actions.css, which the task page links; listed for the census only',
  'opened-task-last-copy-slot': 'the repaint target for the copy line (a press or the task-mode read writes into it); no rule of its own',
};

describe('LIN-3975 — the run control\'s classes are styled by the sheets the task page links', () => {
  test('every class the task-surface run control emits is defined by a linked sheet, or is a hook', async () => {
    const linked = ['style.css', 'common-actions.css', 'session.css', 'stage-track.css', 'run-control.css', 'task-page.css'];
    const defined = new Set();
    for (const f of linked) for (const c of classesIn(read(`public/${f}`))) defined.add(c);

    const emitted = new Set();
    const collect = (html) => {
      for (const m of html.matchAll(/class="([^"]*)"/g)) for (const t of m[1].split(/\s+/)) if (t) emitted.add(t);
    };
    collect((await mount('task', {}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT } })).innerHTML);
    collect((await mount('task', {}, { opened: { status: 'running', live: true, headerHtml: '', sessions: RUNNING } })).innerHTML);
    collect((await mount('task', { dispatchEnabled: false }, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT } })).innerHTML);
    collect((await mount('task', { dispatchEnabled: false }, { opened: null, lastCopy: { label: 'Plan', at: new Date().toISOString() } })).innerHTML);

    const prompt = [...emitted].filter((t) => /^(opened-task|swipe-prompt|prompt-section|task-)/.test(t) || t === 'btn' || t === 'btn--primary' || t === 'btn--quiet');
    const unstyled = prompt.filter((t) => !defined.has(t) && !(t in HOOKS) && !t.startsWith('task-'));
    assert.deepStrictEqual(unstyled, [], 'a class the run control emits must be styled by a linked sheet, or listed as a hook with its reason');
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
