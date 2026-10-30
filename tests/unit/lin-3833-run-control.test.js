/**
 * LIN-3833 step 5: Home's run control (a viewer who can run). One main action, what it runs on with where
 * each value comes from, the Change panel for this run only, and Undo and Stop after a run.
 *
 * Witnesses: the main button names the step the sessions name (else Run to PR); the Runs-on line reads the
 * server's preview and says where each value came from; the Change panel starts with nothing chosen; "Use
 * for this run" sends the choice to the preview; Run to PR and Run <step> dispatch with that choice (the
 * step's own kind and entry rung); Undo deletes the queued item; Stop is offered only for a target a runner
 * polls, and it aborts that session's own target.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { decisionPanel, routingWords, agentLists, optionWordsOf } from '../../lib/components/decision-panel.js';
import { offeredTargetsFor } from '../../lib/dispatch-targets.js';
import { HARNESSES_WITHOUT_EFFORT } from '../../lib/model-routing.js';
import { escapeHtml } from '../../lib/utils/html.js';
import { serverSessions, serverRow } from '../fixtures/task-decision.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

// A container that records every listener by type, so a test can fire input and change as well as click. It reads its
// own markup back the way applyPanelDraft does: the decision panel by its attribute, its fields by data-testid. A value
// written to a field lives until the markup is replaced, as a control's value does.
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

// The server's panel for the choice it is asked about (routes/dispatch.js decision-panel), built by the same component.
// The lists are the real ones (LIN-3987), so a typed alias is named by its display name, as it is on the server.
const serverPanel = (q) => ({
  kind: 'plan',
  withoutEffort: HARNESSES_WITHOUT_EFFORT,
  words: routingWords({ harness: q.get('harness') || null, model: null, effort: null }),
  // LIN-4016: the target list and the option words, as routes/dispatch.js sends them for the harness the draft names.
  targets: offeredTargetsFor({ harness: q.get('harness') || 'claude-code', localhost: false }),
  optionWords: optionWordsOf(agentLists([])),
  html: decisionPanel({
    testid: 'run-decision-panel',
    fieldAttrs: (field) => `data-testid="run-${field}"`,
    numbers: null,
    harness: { value: q.get('harness'), inForce: q.get('harness') || 'claude-code', follow: 'As Settings \u203a Models sets it', hint: 'Right now: Claude Code' },
    model: { value: q.get('model'), follow: 'As Settings \u203a Models sets it', hint: 'Right now: Claude Code\'s own model', lists: agentLists([]), suggestions: {} },
    effort: { value: q.get('effort'), follow: 'As Settings \u203a Models sets it', hint: 'Right now: none' }
  })
});

// The preview route answers the run's words with its own answer (LIN-3987, routes/dispatch.js): the fake does the same,
// so the Runs-on line is tested against what the server sends, not against a raw value.
const withWords = (preview) => (preview && !preview.words
  ? { ...preview, words: routingWords({ harness: preview.harness, model: preview.model, effort: preview.effort }) }
  : preview);

function load({ opened = null, previewFor = () => null, panelFor = serverPanel, presets = [], kickoff = { prompt: 'AUTOPILOT PROMPT', promptName: 'Autopilot', kind: 'autopilot' }, document = null } = {}) {
  const calls = { api: [], dispatch: [], kickoff: [] };
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async (url, o = {}) => {
      calls.api.push({ url, method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : null });
      if (url.includes('/api/task/')) return opened;
      if (url.includes('/api/task-mode/')) return { lastCopy: null };
      if (url.includes('/api/dispatch/preview')) return withWords(await previewFor(new URL(url, 'http://x').searchParams));
      if (url.includes('/api/dispatch/decision-panel')) return panelFor(new URL(url, 'http://x').searchParams);
      if (url.includes('/api/dispatch/presets')) return { presets };
      if (url.includes('/api/prompt/')) return { prompt: `PROMPT ${decodeURIComponent(url.split('/').pop().split('?')[0])}`, promptName: 'Plan' };
      return { success: true, item: { id: 'd-1' } };
    },
    fetchAutopilotKickoff: async (args) => { calls.kickoff.push(args); return kickoff; },
    taskPageHref: () => '/workspace/acme/task/LIN-42',
    dispatchPrompt: async (args) => { calls.dispatch.push(args); return { success: true, item: { id: 'd-1' } }; },
    ProxyToggle: { isActive: () => true, setActive() {}, maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '',
    readDispatchExecControls: () => ({ model: null, harness: null }),
    isPinnedToBottom: () => false,
    toast: () => {},
  };
  const sandbox = {
    window, AbortController, URLSearchParams, TextDecoder, TextEncoder, Blob: class {}, URL,
    document: document || { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    requestAnimationFrame: (cb) => { cb(); return 1; },
    // The Go poll schedules its own timers; unref them so a finished test does not hold the process open.
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
  defaultPromptKeys: ['look-into', 'research', 'plan', 'implementation'],
  morePromptKeys: ['review', 'scoping'],
  issue: { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', stateType: 'started' },
};

// `offered` is the step the server offers (LIN-3968); `next` is the "comes next" wording. Nothing runs, so they agree.
const PLAN_NEXT = { count: 1, next: { kind: 'plan', label: 'Plan' }, offered: { kind: 'plan', label: 'Plan', why: 'usual', failed: false, reason: 'usually next after Research' }, last: { label: 'Research', state: 'done', at: null }, running: null };

async function mount(over = {}, loadOver = {}, container = null) {
  // LIN-4016: the server's decision for the row and its sessions (the browser reads these, it decides nothing).
  const row = over.row || serverRow({ stateType: (over.issue || HOME.issue).stateType, attention: over.subtaskNeedsYou || null });
  const { subtaskNeedsYou, ...rest } = over;
  const opened = loadOver.opened && { ...loadOver.opened, sessions: serverSessions(loadOver.opened.sessions, { container: row.container }) };
  const env = load({ ...loadOver, opened: opened || loadOver.opened });
  over = { ...rest, row };
  const c = container || makeContainer();
  env.PromptSection.init(c, { ...HOME, ...over });
  await flush();
  return { ...env, c };
}

describe('LIN-3833 — the main action names the step the sessions name', () => {
  test('the sessions name a next step: the main button is Run <step>, and the step line says why', async () => {
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', trackHtml: '', sessions: PLAN_NEXT } });
    assert.match(c.innerHTML, /data-testid="opened-task-go"[^>]*data-action="run-step-next"[^>]*>Run Plan</);
    assert.match(c.innerHTML, /usually next after Research/);
  });

  test('no step named: the main button is Run to PR', async () => {
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', trackHtml: '', sessions: { count: 0, next: null, last: null, running: null } } });
    assert.match(c.innerHTML, /data-testid="opened-task-go"[^>]*data-action="go"[^>]*>Run to PR</);
  });

  test('there is one main action: no ladder, no Dispatch disclosure, no other-prompts list on Home', async () => {
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', trackHtml: '', sessions: PLAN_NEXT } });
    assert.equal(c.innerHTML.includes('opened-task-ladder'), false);
    assert.equal(c.innerHTML.includes('Dispatch ▾'), false);
    assert.equal(c.innerHTML.includes('swipe-prompt-dispatch'), false);
  });
});

describe('LIN-3833 — Runs on says where each value comes from, from the server\'s own preview', () => {
  test('a job row says "set for <step> in Models"; a group row names its group', async () => {
    const preview = (sources, extra = {}) => () => ({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model: 'm-job', harness: 'claude-code', effort: null, sources: { model: 'job', harness: 'group', effort: 'none', ...sources }, ...extra });
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor: preview() });
    await flush();
    assert.match(c.innerHTML, /data-testid="run-on-what">m-job/);
    assert.match(c.innerHTML, /set for Plan in Models/);
    assert.match(c.innerHTML, /from the Plan group in Models/);
  });

  test('a Change panel starts with nothing chosen: the harness follows Settings › Models, and no option is selected', async () => {
    const { c, calls } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT } });
    await c.click({ action: 'change-run' });
    await flush();
    assert.match(c.innerHTML, /data-testid="run-change-panel"/);
    assert.match(c.innerHTML, /<option value=""[^>]*>As Settings \u203a Models sets it<\/option>/, 'the blank option is short, so a 390px select does not clip it');
    assert.match(c.innerHTML, /data-decision-hint="harness">Right now: Claude Code</, 'what the blank resolves to reads on its own line, in words (LIN-3987)');
    assert.equal(/<option value="claude-code" selected>|<option value="opencode" selected>/.test(c.innerHTML), false, 'nothing is pre-selected');
    assert.ok(calls.api.some((a) => a.url.includes('/api/dispatch/decision-panel')), 'the shared panel is read from the server when Change opens');
  });

  test('the panel\'s fields are the server\'s, so Use stays off until the panel has loaded, and says so when it cannot load', async () => {
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, panelFor: () => { throw new Error('down'); } });
    await c.click({ action: 'change-run' });
    await flush();
    assert.match(c.innerHTML, /data-testid="run-panel-failed"/);
    assert.match(c.innerHTML, /data-testid="run-use"[^>]*disabled/);
  });

  test('a repaint of the cached panel keeps the draft: a model typed and a harness picked both survive it (LIN-3962)', async () => {
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT } });
    await c.click({ action: 'change-run' });
    await flush();
    await c.fire('input', { dataset: { testid: 'run-model' }, value: 'x/y' });
    // The harness change repaints the run block from the cached panel, which holds the choice and not the draft.
    await c.fire('change', { dataset: { testid: 'run-harness' }, value: 'opencode' });
    await flush();
    const root = c.querySelector('[data-decision-panel]');
    assert.equal(root.querySelector('[data-testid="run-harness"]').value, 'opencode', 'the picked harness is shown');
    assert.equal(root.querySelector('[data-testid="run-model"]').value, 'x/y', 'the typed model is shown');
  });

  test('the summary says no effort once the draft harness is opencode, which takes none (LIN-3962)', async () => {
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT } });
    await c.click({ action: 'change-run' });
    await flush();
    await c.fire('change', { dataset: { testid: 'run-effort' }, value: 'high' });
    await c.fire('change', { dataset: { testid: 'run-harness' }, value: 'opencode' });
    await flush();
    const summary = /data-testid="run-will-use">([^<]*)</.exec(c.innerHTML)[1];
    assert.match(summary, /opencode/);
    assert.equal(summary.includes('effort'), false, `no effort in: ${summary}`);
  });
});

describe('LIN-3833 — the choice for this run goes through the preview, and the run dispatches with it', () => {
  test('"Use for this run" re-asks the preview with the chosen harness, and the Runs-on line says it was chosen', async () => {
    const seen = [];
    const previewFor = (q) => { seen.push(Object.fromEntries(q)); return { kind: 'plan', stepLabel: 'Plan', group: 'plan', model: 'x', harness: q.get('harness') || 'claude-code', effort: null, sources: { model: 'default', harness: q.get('harness') ? 'explicit' : 'default', effort: 'none' } }; };
    const { c, calls } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor });
    await c.click({ action: 'change-run' });
    await flush();
    await c.fire('change', { dataset: { testid: 'run-harness' }, value: 'opencode' });
    await c.click({ action: 'use-run' });
    await flush();
    assert.equal(seen.at(-1).harness, 'opencode', 'the preview is asked for the chosen harness');
    assert.match(c.innerHTML, /chosen for this run/);
    assert.ok(calls.api.some((a) => a.url.includes('/api/dispatch/preview')));
  });

  test('Run to PR dispatches the autopilot kickoff with the run choice, not a harness forced on the client', async () => {
    const { c, calls } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: { count: 0, next: null, last: null, running: null } } });
    await c.click({ action: 'change-run' });
    await flush();
    await c.fire('change', { dataset: { testid: 'run-model' }, value: 'deepseek-v4-pro' });
    await c.click({ action: 'use-run' });
    await c.click({ action: 'go', rung: 'run-task' });
    await flush();
    await flush();
    assert.equal(calls.dispatch.length, 1);
    const d = calls.dispatch[0];
    assert.equal(d.entryRung, 'run-task');
    assert.equal(d.stopAt, 'pr');
    assert.equal(d.target, 'cli');
    assert.equal(d.model, 'deepseek-v4-pro');
    assert.ok(!d.harness, 'an untouched harness is not sent (dispatchPrompt omits a falsy harness)');
    assert.equal(d.surface, 'home');
  });

  test('Run <step> fetches that step\'s prompt and dispatches it as a run-step of its own kind', async () => {
    const { c, calls } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT } });
    await c.click({ action: 'run-step-next' });
    await flush();
    await flush();
    assert.ok(calls.api.some((a) => a.url.includes('/api/prompt/uuid-42/plan')), 'the step\'s prompt is fetched');
    const d = calls.dispatch.at(-1);
    assert.equal(d.kind, 'plan');
    assert.equal(d.entryRung, 'run-step');
    assert.equal(d.prompt, 'PROMPT plan');
  });
});

// LIN-3969: Reset then "Use for this run" sends two preview reads back to back. When the first (the reset
// choice: no model) answered after the second, the stale answer overwrote the Runs-on line, which then read
// "the default model" for a run that would go out on the chosen model (CI run 40220361851). The preview is
// held until the test releases it, so the answers arrive in the order the test chooses.
describe('LIN-3969 — the Runs-on line shows the answer to the latest preview read, whatever order they arrive in', () => {
  const held = () => {
    const pending = [];
    const previewFor = (q) => new Promise((resolve) => {
      pending.push(() => resolve({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model: q.get('model') || null, harness: 'claude-code', effort: null, sources: { model: q.get('model') ? 'explicit' : 'none', harness: 'fallback', effort: 'none' } }));
    });
    return { pending, previewFor };
  };

  test('Reset, then a chosen model: the reset read answering last does not undo the chosen model', async () => {
    const { pending, previewFor } = held();
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor });
    pending.shift()();
    await flush();
    await c.click({ action: 'change-run' });
    await c.click({ action: 'reset-run' });
    await c.fire('input', { dataset: { testid: 'run-model' }, value: 'chosen-model-x' });
    await c.click({ action: 'use-run' });
    assert.equal(pending.length, 2, 'two preview reads are in flight: the reset one, then the chosen one');
    pending[1]();
    await flush();
    assert.match(c.innerHTML, /data-testid="run-on-what">chosen-model-x</);
    pending[0]();
    await flush();
    assert.match(c.innerHTML, /data-testid="run-on-what">chosen-model-x</, 'the stale reset answer is dropped');
  });

  test('the mount read answering after a chosen model does not undo it', async () => {
    const { pending, previewFor } = held();
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor });
    await c.click({ action: 'change-run' });
    await c.fire('input', { dataset: { testid: 'run-model' }, value: 'chosen-model-x' });
    await c.click({ action: 'use-run' });
    assert.equal(pending.length, 2, 'the mount read and the chosen read are both in flight');
    pending[1]();
    await flush();
    pending[0]();
    await flush();
    assert.match(c.innerHTML, /data-testid="run-on-what">chosen-model-x</);
  });
});

// LIN-3969: a preview or presets answer repaints the run block, which replaces the Change panel's Model input.
// Typing in it then went to a removed input: focus and every later keystroke were lost, and "Use for this run"
// applied a cut-off model or none (the browser repro ran on "chose" for "chosen-model-x"). The repaint keeps the
// focused control: the same control in the new block is focused, with the typed value and the caret.
describe('LIN-3969 — a run-block repaint keeps the control being typed in', () => {
  // A run slot whose repaint is observable: `outerHTML = …` replaces the slot, and the new slot's controls are
  // fresh objects, like a real outerHTML swap.
  function slotContainer(doc) {
    const c = makeContainer();
    const control = (testid) => ({
      dataset: { testid }, type: testid === 'run-model' ? 'text' : undefined, value: '', selectionStart: null, selectionEnd: null, focused: false,
      focus() { this.focused = true; doc.activeElement = this; },
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    });
    let slot = null;
    const newSlot = () => {
      const controls = {};
      const s = {
        controls,
        contains: (el) => Object.values(controls).includes(el),
        querySelector: (sel) => {
          const m = sel.match(/data-testid="([^"]+)"/);
          if (!m) return null;
          return controls[m[1]] || (controls[m[1]] = control(m[1]));
        },
        set outerHTML(html) {
          c.innerHTML = c.innerHTML.replace(/<div class="opened-task-run"[\s\S]*$/, html);
          slot = newSlot();
        },
      };
      return s;
    };
    c.querySelector = (sel) => {
      if (!/data-run-slot/.test(sel)) return null;
      if (!/opened-task-run/.test(c.innerHTML)) return null;
      if (!slot) slot = newSlot();
      const inner = sel.replace(/^\[data-run-slot\]\s*/, '');
      return inner === sel || inner === '' ? slot : slot.querySelector(inner);
    };
    c.slot = () => slot;
    return c;
  }

  test('a preview landing mid-typing leaves the Model input focused, with its value and caret', async () => {
    const pending = [];
    const previewFor = () => new Promise((resolve) => { pending.push(() => resolve({ kind: 'plan', stepLabel: 'Plan', model: null, harness: 'claude-code', effort: null, sources: { model: 'none', harness: 'fallback', effort: 'none' } })); });
    const doc = { activeElement: null, createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
    const c = slotContainer(doc);
    await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor, document: doc }, c);
    pending.shift()();
    await flush();
    await c.click({ action: 'change-run' });
    await flush();
    await c.click({ action: 'reset-run' });
    // The viewer is typing: "chose" so far, caret at the end.
    const input = c.slot().querySelector('[data-testid="run-model"]');
    input.focus();
    input.value = 'chose';
    input.selectionStart = 5;
    input.selectionEnd = 5;
    await c.fire('input', input);
    // The reset preview lands and the run block repaints.
    pending.shift()();
    await flush();
    const again = c.slot().querySelector('[data-testid="run-model"]');
    assert.notEqual(again, input, 'the repaint replaced the input');
    assert.equal(doc.activeElement, again, 'the new Model input has the focus, so the next keystroke lands in it');
    assert.equal(again.value, 'chose');
    assert.deepEqual([again.selectionStart, again.selectionEnd], [5, 5]);
  });
});

describe('LIN-3833 — Undo and Stop after a run', () => {
  test('a queued run offers Undo, which deletes that queued item', async () => {
    const { c, calls } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT } });
    await c.click({ action: 'run-step-next' });
    await flush();
    await flush();
    assert.match(c.innerHTML, /data-testid="opened-task-queued"/);
    await c.click({ action: 'undo-run' });
    await flush();
    const del = calls.api.find((a) => a.method === 'DELETE');
    assert.ok(del, 'a DELETE is sent');
    assert.equal(del.url, '/workspace/acme/api/dispatch/d-1');
  });

  test('Stop is offered only for a target a runner polls: a local session shows no Stop', async () => {
    const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-25T10:00:00.000Z', target: 'local' };
    const { c } = await mount({}, { opened: { status: 'running', live: true, headerHtml: '', sessions: { count: 1, next: { kind: 'review', label: 'Review' }, last: null, running } } });
    assert.match(c.innerHTML, /data-testid="opened-task-running"/);
    assert.equal(c.innerHTML.includes('data-testid="run-stop"'), false);
  });

  test('a cli session shows Stop, which asks in place and then aborts that session on its own target', async () => {
    const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-25T10:00:00.000Z', target: 'cli' };
    const { c, calls } = await mount({}, { opened: { status: 'running', live: true, headerHtml: '', sessions: { count: 1, next: null, last: null, running } } });
    assert.match(c.innerHTML, /data-testid="run-stop"/);
    await c.click({ action: 'stop-run' });
    assert.match(c.innerHTML, /Stop this run\? The session is cancelled/);
    await c.click({ action: 'stop-run-confirm' });
    await flush();
    const abort = calls.api.find((a) => a.method === 'POST' && a.url.endsWith('/api/dispatch'));
    assert.ok(abort, 'an abort is posted');
    assert.equal(abort.body.abort, true);
    assert.equal(abort.body.abortTo, 'loop-1');
    assert.equal(abort.body.target, 'cli');
    assert.equal(abort.body.cascade, true);
  });
});

describe('LIN-3833 — a subtask that needs you is named on any opened Home task, with an Open link', () => {
  const WAITING = { identifier: 'LIN-22', title: 'Waiting child', href: '/workspace/acme/task/LIN-22?source=linear' };
  const OPENED = { status: 'idle', live: false, headerHtml: '', trackHtml: '', sessions: PLAN_NEXT };

  test('the line names the subtask and its Open button links to its task page', async () => {
    const { c } = await mount({ subtaskNeedsYou: WAITING }, { opened: OPENED });
    assert.match(c.innerHTML, /data-testid="opened-task-needs-you"[^>]*>A subtask needs you: <span[^>]*>LIN-22 Waiting child<\/span>/);
    assert.match(c.innerHTML, /data-testid="opened-task-needs-you-open"[^>]*href="\/workspace\/acme\/task\/LIN-22\?source=linear"/);
  });

  test('no subtask needing you: no line', async () => {
    const { c } = await mount({ subtaskNeedsYou: null }, { opened: OPENED });
    assert.equal(c.innerHTML.includes('opened-task-needs-you'), false);
  });
});

describe('LIN-3833 — "Another step" leaves out only what the task cannot take (ruling f9fa6bd7, option c)', () => {
  // Retro is in the more list so the excluded step is counted, as Home's prompt options carry it.
  const LIST = { morePromptKeys: ['review', 'scoping', 'retro'], promptMeta: { ...HOME.promptMeta, retro: 'Retro' } };
  // A task after Plan, Build and Review (the review asked for changes). `ahead` and `usual` are the stage-order
  // fields this PR removed from the summary; they are set here on purpose, so the rule is seen to ignore them.
  const REVIEWED = {
    count: 3, next: { kind: 'close-out', label: 'Close-out' }, offered: { kind: 'close-out', label: 'Close-out', why: 'usual', failed: false }, last: { label: 'Review', state: 'done', at: null }, running: null,
    excluded: ['retro'], ahead: ['close-out'], usual: ['research', 'plan', 'implementation', 'review', 'close-out'],
  };
  const open = async (c) => {
    await c.click({ action: 'run-another' });
    await c.click({ action: 'run-more' });
  };

  test('after a Review session, Build and Review stay on the list; only retro is left out and counted', async () => {
    const { c } = await mount(LIST, { opened: { status: 'idle', live: false, headerHtml: '', trackHtml: '', sessions: REVIEWED } });
    await open(c);
    assert.match(c.innerHTML, /data-kind="implementation"/);
    assert.match(c.innerHTML, /data-kind="review"/);
    assert.match(c.innerHTML, /data-kind="research"/);
    assert.equal(c.innerHTML.includes('data-kind="retro"'), false);
    assert.match(c.innerHTML, /data-testid="run-another-left-out"[^>]*>1 step left out: it does not fit this task's state\./);
  });

  test('a finished task lists no step; every step is left out and counted', async () => {
    const issue = { ...HOME.issue, stateType: 'completed' };
    const { c } = await mount({ ...LIST, issue }, { opened: { status: 'idle', live: false, headerHtml: '', trackHtml: '', sessions: { ...REVIEWED, finished: true, actions: [] } } });
    await open(c);
    assert.equal(c.innerHTML.includes('data-testid="run-another-item"'), false);
    assert.match(c.innerHTML, /7 steps left out: they do not fit this task's state\./);
  });
});

describe('LIN-3991 — a running task says its state once in the opened task', () => {
  const running = { loopId: 'loop-1', kind: 'implementation', label: 'Build', state: 'running', since: '2026-10-25T10:00:00.000Z', target: 'cli' };
  const SENTENCE = '<p class="task-sentence" data-testid="task-page-sentence">Build running for 1h.</p>';

  test('the state block says it, and neither the run control nor its Go slot repeats it', async () => {
    const { c } = await mount({}, { opened: { status: 'running', live: true, homeStatusHtml: SENTENCE, sessions: { count: 1, next: { kind: 'review', label: 'Review' }, last: null, running } } });
    assert.equal(c.innerHTML.split('Build running for 1h.').length - 1, 1, 'the sentence appears once');
  });

  test('the running box says the state once: Running now, the step, Stop and Next; it does not repeat the state sentence', async () => {
    const { c } = await mount({}, { opened: { status: 'running', live: true, homeStatusHtml: SENTENCE, sessions: { count: 1, next: { kind: 'review', label: 'Review' }, last: null, running } } });
    // The box's own markup nests, so read from its opening tag to the end of its Next line.
    const start = c.innerHTML.indexOf('data-testid="opened-task-running"');
    const line = c.innerHTML.slice(start, c.innerHTML.indexOf('</p></div>', start) + '</p></div>'.length);
    assert.match(line, /Next: Review, once Build finishes/);
    assert.match(line, /data-testid="run-stop"/);
    assert.equal((line.match(/Running now/g) || []).length, 1, 'the state is named once, in the head');
    assert.doesNotMatch(line, /Build running/, 'the box does not repeat the state sentence');
  });
});

// LIN-3987: Home's controls are real buttons with a shared class, a chosen choice is marked, a choice the harness cannot
// run is not kept, and the words name what runs. The button tags are read from the markup the run block paints.
describe('LIN-3987 — Home\'s run controls are shared buttons, marked when chosen, and say their words', () => {
  const RUN_ACTIONS = ['change-run', 'ask-harbour', 'run-target', 'run-preset', 'use-run', 'reset-run', 'close-change', 'see-prompt', 'run-another', 'run-pick', 'run-more', 'stop-run', 'stop-run-confirm', 'stop-run-cancel', 'undo-run', 'run-step-next', 'run-step', 'go', 'setup'];
  const SHARED = /class="[^"]*\bbtn(?:--[a-z]+)?\b/;
  // The button's own opening tag, found by its test id (its attributes come in any order).
  const tagOf = (html, testid) => new RegExp(`<button\\b[^>]*data-testid="${testid}"[^>]*>`).exec(html)[0];
  const runButtons = (html) => [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0])
    .filter((tag) => /data-testid="(run-[a-z-]+|opened-task-go)"/.test(tag) || RUN_ACTIONS.some((a) => tag.includes(`data-action="${a}"`)));

  test('every button in the run block, with the Change panel open, carries a shared button class', async () => {
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor: () => ({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model: null, harness: 'claude-code', effort: null, sources: {} }) });
    await c.click({ action: 'change-run' });
    await flush();
    await c.click({ action: 'run-another' });
    await flush();
    const tags = runButtons(c.innerHTML);
    assert.ok(tags.length >= 8, `the run block has its buttons (${tags.length})`);
    for (const tag of tags) assert.match(tag, SHARED, `shared class on ${tag}`);
  });

  test('a quiet button is used on its own, not with .btn: .btn:hover would paint a fill over its label (decision 6)', async () => {
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor: () => ({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model: null, harness: 'claude-code', effort: null, sources: {} }) });
    await c.click({ action: 'change-run' });
    await flush();
    await c.click({ action: 'run-another' });
    await flush();
    const tags = runButtons(c.innerHTML);
    const classesOf = (tag) => (/class="([^"]*)"/.exec(tag)?.[1] || '').split(/\s+/);
    const quiet = tags.filter((tag) => classesOf(tag).includes('btn--quiet'));
    assert.ok(quiet.length >= 3, `the run block has quiet buttons (${quiet.length})`);
    for (const tag of quiet) assert.equal(classesOf(tag).includes('btn'), false, `quiet alone: ${tag}`);
  });

  test('a chosen Runs-on target is marked aria-pressed, and is not marked by bold or underline', async () => {
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor: () => ({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model: null, harness: 'claude-code', effort: null, sources: {} }) });
    await c.click({ action: 'change-run' });
    await flush();
    await c.click({ action: 'run-target', target: 'web' });
    await flush();
    assert.equal(tagOf(c.innerHTML, 'run-target-web').includes('aria-pressed="true"'), true);
    assert.equal(tagOf(c.innerHTML, 'run-target-cli').includes('aria-pressed="false"'), true);
  });

  test('with opencode chosen, Claude Code on the web is not offered and says why; a web draft falls back to the runner', async () => {
    const { c, calls } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: { count: 0, next: null, last: null, running: null } }, previewFor: () => ({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model: null, harness: 'claude-code', effort: null, sources: {} }) });
    await c.click({ action: 'change-run' });
    await flush();
    await c.click({ action: 'run-target', target: 'web' });
    await c.fire('change', { dataset: { testid: 'run-harness' }, value: 'opencode' });
    await flush();
    assert.doesNotMatch(c.innerHTML, /data-testid="run-target-web"/, 'no web choice under opencode');
    assert.match(c.innerHTML, /data-testid="run-web-unavailable"[^>]*>Claude Code on the web needs Claude Code, so it is not offered with opencode through OpenRouter\./);
    assert.equal(tagOf(c.innerHTML, 'run-target-cli').includes('aria-pressed="true"'), true, 'the draft falls back to the runner');
    await c.click({ action: 'use-run' });
    await c.click({ action: 'go', rung: 'run-task' });
    await flush();
    await flush();
    assert.equal(calls.dispatch.length, 1);
    assert.equal(calls.dispatch[0].target, 'cli', 'the run goes to the runner, never to a web target the harness cannot run');
  });

  test('the Runs-on line, the heading and the summary name models and harnesses in words, never a raw id or alias', async () => {
    const previewFor = (q) => ({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model: q.get('model') || null, harness: q.get('harness') || 'claude-code', effort: null, sources: {}, words: routingWords({ harness: q.get('harness') || 'claude-code', model: q.get('model') || null, effort: null }) });
    const { c } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor });
    await c.click({ action: 'change-run' });
    await flush();
    // The model field repaints nothing as it is typed (LIN-3969, so the caret stays); a target choice repaints the block.
    await c.fire('change', { dataset: { testid: 'run-model' }, value: 'sonnet' });
    await c.click({ action: 'run-target', target: 'cli' });
    await flush();
    const runsOn = /data-testid="run-on-what">([^<]*)</.exec(c.innerHTML)[1];
    const summary = /data-testid="run-will-use">([^<]*)</.exec(c.innerHTML)[1];
    const heading = /opened-task-change-head">([^<]*)</.exec(c.innerHTML)[1];
    assert.match(summary, /^This run will use Claude Sonnet 5\.5 · Claude Code/, summary);
    assert.match(heading, /^This run only · default: Claude Code(?:&#039;|')s own model/, heading);
    for (const text of [runsOn, summary, heading]) assert.doesNotMatch(text, /\bclaude-code\b|\bsonnet\b|\bnone\b|from Models/, text);
  });
});


// LIN-3987 review, finding 1: a harness picked on the draft re-reads the server's panel, so the words for a blank model
// and effort follow the harness the draft names, and go back to Settings' words when the harness is blank again.
describe('LIN-3987 review — a harness picked on the draft re-reads the panel, so its words follow it', () => {
  test('picking opencode names its default model in the summary; a blank harness names Claude Code\'s own again', async () => {
    const { c, calls } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor: () => ({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model: null, harness: 'claude-code', effort: null, sources: {} }) });
    await c.click({ action: 'change-run' });
    await flush();
    const summary = () => /data-testid="run-will-use">([^<]*)</.exec(c.innerHTML)[1];
    assert.match(summary(), /^This run will use Claude Code(?:&#039;|')s own model/, summary());

    await c.fire('change', { dataset: { testid: 'run-harness' }, value: 'opencode' });
    await flush();
    assert.ok(calls.api.some((a) => a.url.includes('/api/dispatch/decision-panel') && a.url.includes('harness=opencode')), 'the panel is read again for the harness the draft chose');
    assert.match(summary(), /^This run will use opencode(?:&#039;|')s default model/, summary());
    assert.doesNotMatch(summary(), /Claude Code(?:&#039;|')s own model/, summary());

    await c.fire('change', { dataset: { testid: 'run-harness' }, value: '' });
    await flush();
    assert.match(summary(), /^This run will use Claude Code(?:&#039;|')s own model/, summary());
  });

  // Reads overlap and can answer in either order: only the latest paints (runPanelSeq in fetchRunPanel).
  test('an older read that answers last does not paint over the latest answer\'s words', async () => {
    const held = [];
    let gate = false;
    const panelFor = (q) => (gate
      ? new Promise((resolve) => { held.push(() => resolve(serverPanel(q))); })
      : serverPanel(q));
    const { c } = await mount({}, { panelFor, opened: { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT }, previewFor: () => ({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model: null, harness: 'claude-code', effort: null, sources: {} }) });
    await c.click({ action: 'change-run' });
    await flush();
    const summary = () => /data-testid="run-will-use">([^<]*)</.exec(c.innerHTML)[1];
    assert.match(summary(), /^This run will use Claude Code(?:&#039;|')s own model/, summary());

    gate = true;
    await c.fire('change', { dataset: { testid: 'run-harness' }, value: 'opencode' });
    await c.fire('change', { dataset: { testid: 'run-harness' }, value: '' });
    await flush();
    assert.equal(held.length, 2, 'both reads are in flight');

    held[1]();
    await flush();
    held[0]();
    await flush();
    assert.match(summary(), /^This run will use Claude Code(?:&#039;|')s own model/, 'the first read answered last and did not paint');
    assert.doesNotMatch(summary(), /opencode/, summary());
  });
});

// LIN-3992: a pick (or a typed model) sets the draft's model, and the summary names it at once. The summary is updated
// in place, not by a repaint: a repaint per keystroke would close the datalist and reset the caret (LIN-3969).
describe('LIN-3992 — the summary names the model the draft holds, without a repaint', () => {
  const summary = (c) => /data-testid="run-will-use">([^<]*)</.exec(c.innerHTML)[1];
  const runsOn = (c) => /data-testid="opened-task-runs-on">([\s\S]*?)<\/div>/.exec(c.innerHTML)[1].replace(/<button[\s\S]*?<\/button>/, '').replace(/<[^>]+>/g, '').trim();
  const panelOpen = { status: 'idle', live: false, headerHtml: '', sessions: PLAN_NEXT };

  test('a suggestion picked names its display name in the summary at once', async () => {
    const { c } = await mount({}, { opened: panelOpen });
    await c.click({ action: 'change-run' });
    await flush();
    assert.match(summary(c), /^This run will use Claude Code(?:&#039;|')s own model/, summary(c));
    // A pick sets the model field to the alias, then dispatches input and change (public/decision-panel.js).
    await c.fire('input', { dataset: { testid: 'run-model' }, value: 'opus' });
    await c.fire('change', { dataset: { testid: 'run-model' }, value: 'opus' });
    assert.match(summary(c), /^This run will use Claude Opus 5\.5 · Claude Code · /, summary(c));
  });

  test('a typed model no option names is shown as typed, and a cleared model goes back to the default words', async () => {
    const { c } = await mount({}, { opened: panelOpen });
    await c.click({ action: 'change-run' });
    await flush();
    await c.fire('input', { dataset: { testid: 'run-model' }, value: 'x/y' });
    assert.match(summary(c), /^This run will use x\/y · Claude Code · /, summary(c));
    await c.fire('input', { dataset: { testid: 'run-model' }, value: '' });
    assert.match(summary(c), /^This run will use Claude Code(?:&#039;|')s own model/, summary(c));
  });

  // Witness that "Use for this run" sends the picked id. It passes once the pick path sets the model, so it is checked
  // by breaking that line (draft.model = null) and watching it fail; see the PR.
  test('"Use for this run" sends the picked model: the preview is asked for it, and Run to PR dispatches it', async () => {
    const { c, calls } = await mount({}, { opened: { status: 'idle', live: false, headerHtml: '', sessions: { count: 0, next: null, last: null, running: null } } });
    await c.click({ action: 'change-run' });
    await flush();
    await c.fire('input', { dataset: { testid: 'run-model' }, value: 'opus' });
    await c.fire('change', { dataset: { testid: 'run-model' }, value: 'opus' });
    await c.click({ action: 'use-run' });
    await flush();
    assert.ok(calls.api.some((a) => a.url.includes('/api/dispatch/preview') && a.url.includes('model=opus')), 'the preview is asked for model=opus');
    await c.click({ action: 'go', rung: 'run-task' });
    await flush();
    await flush();
    assert.equal(calls.dispatch.at(-1).model, 'opus');
  });

  const fallback = (sources = { model: 'fallback', harness: 'fallback', effort: 'none' }, model = null) => () => ({ kind: 'plan', stepLabel: 'Plan', group: 'plan', model, harness: 'claude-code', effort: null, sources, words: routingWords({ harness: 'claude-code', model, effort: null }) });

  test('Runs on names Claude Code once when the model is Claude Code\'s own, and says the runner', async () => {
    const { c } = await mount({}, { opened: panelOpen, previewFor: fallback() });
    await flush();
    assert.equal(runsOn(c).match(/Claude Code/g)?.length, 1, runsOn(c));
    assert.match(runsOn(c), /^Runs on Claude Code(?:&#039;|')s own model · your runner/, runsOn(c));
  });

  test('Runs on names Claude Code once when the target is Claude Code on the web and the model is its own', async () => {
    const { c } = await mount({}, { opened: panelOpen, previewFor: fallback() });
    await c.click({ action: 'change-run' });
    await flush();
    await c.click({ action: 'run-target', target: 'web' });
    await c.click({ action: 'use-run' });
    await flush();
    assert.equal(runsOn(c).match(/Claude Code/g)?.length, 1, runsOn(c));
    assert.match(runsOn(c), /on the web/, runsOn(c));
  });

  test('Runs on keeps where the harness came from when the model is named', async () => {
    const { c } = await mount({}, { opened: panelOpen, previewFor: fallback({ model: 'explicit', harness: 'fallback', effort: 'none' }, 'sonnet') });
    await flush();
    assert.match(runsOn(c), /^Runs on Claude Sonnet 5\.5 · your runner — chosen for this run, Claude Code, the default$/, runsOn(c));
  });
});
