/**
 * LIN-3833 step 4: the copy-first opened task on Home, for a viewer with no runner.
 *
 * Witnesses: the step comes from the task's status alone (Todo: Plan, Backlog: Scoping, In Progress: the
 * selector writes the next prompt); "✦ Write the prompt" is the only control before a prompt exists; once
 * written, Copy prompt, the bounded box with Rewrite and Download, and the progress-key checkbox; no run,
 * model, cost, stage or session element; the state block shows the task's own sentence and what was last
 * copied, and no stage strip. Swipe keeps its own card. The copy record names its prompt and an unknown
 * kind is dropped; the copy-first card shows once, until dismissed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { TaskModeStore, copyKindOf } from '../../lib/task-mode-store.js';
import { renderPage } from '../../lib/render.js';
import { serverSessions, serverRow } from '../fixtures/task-decision.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeContainer() {
  const container = {
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    contains() { return true; },
    _clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this._clickHandler = fn; },
    removeEventListener() {},
    async click(dataset) {
      const btn = { dataset: { ...dataset }, disabled: false, textContent: '', classList: { add() {}, remove() {} }, closest: (sel) => (/^button/.test(sel) ? btn : null) };
      await this._clickHandler({ target: btn });
      return btn;
    },
  };
  return container;
}

/** A PromptSection sandbox. `stateBody` is what the state endpoint answers (null for no read). */
function load({ stateBody = null } = {}) {
  // LIN-4016: the state body is the server's: its `sessions` carry the decision the browser reads.
  if (stateBody && stateBody.sessions) stateBody = { ...stateBody, sessions: serverSessions(stateBody.sessions) };
  const calls = { api: [] };
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
    api: async (url) => {
      calls.api.push(url);
      if (url.includes('/api/task/')) return stateBody;
      if (url.includes('/api/task-mode/')) return { lastCopy: null };
      return { prompt: 'PLAN PROMPT', promptName: 'Plan' };
    },
    ProxyToggle: { isActive: () => true, setActive() {}, maybeAppend: async (raw) => raw },
    renderDispatchDisclosure: () => '',
    readDispatchExecControls: () => ({}),
    dispatchPrompt: async () => ({}),
    isPinnedToBottom: () => false,
    toast: () => {},
  };
  const sandbox = {
    window, AbortController, URLSearchParams, TextDecoder, TextEncoder, Blob: class {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout, clearTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'prompt-section.js' });
  return { PromptSection: sandbox.window.PromptSection, calls };
}

function homeOpts(over = {}) {
  const issue = over.issue || { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', stateType: 'unstarted' };
  return {
    urlKey: 'acme', surface: 'home', dispatchEnabled: false, runSetup: false, hasAI: true, aiState: 'ok',
    promptMeta: { plan: 'Plan', scoping: 'Scoping', implementation: 'Implementation' },
    issue,
    // LIN-4016: the row's decision record, as the server stamps it (the copy-first step and tracker word come from it).
    row: serverRow({ stateType: issue.stateType }),
    ...over,
  };
}

describe('LIN-3833 — the copy-first step comes from the task\'s status alone', () => {
  for (const [stateType, label, text] of [
    ['unstarted', 'plan', 'the first step for a task in Todo'],
    ['backlog', 'scoping', 'the first step for a task in Backlog'],
    ['started', '__ai__', 'Generate the next prompt for this task'],
  ]) {
    test(`${stateType} → "Write the prompt" for ${label}`, async () => {
      const { PromptSection } = load();
      const c = makeContainer();
      PromptSection.init(c, homeOpts({ issue: { id: 'uuid-42', identifier: 'LIN-42', title: 'T', url: '', stateType } }));
      await flush();
      assert.match(c.innerHTML, new RegExp(`data-testid="opened-task-write"[^>]*data-prompt="${label.replace('_', '_')}"`));
      assert.match(c.innerHTML, new RegExp(text));
    });
  }

  test('no run, model, cost, stage or session element is rendered to a copy-first viewer', async () => {
    const { PromptSection } = load({ stateBody: { live: false, status: 'idle', headerHtml: '<p class="task-sentence">No sessions yet.</p>', trackHtml: '<div class="task-track">stages</div>', sessions: { count: 0, last: null, running: null } } });
    const c = makeContainer();
    PromptSection.init(c, homeOpts());
    await flush();
    for (const absent of ['opened-task-go', 'swipe-prompt-dispatch', 'opened-task-run-quota', 'task-track', 'opened-task-all', 'data-action="go"']) {
      assert.equal(c.innerHTML.includes(absent), false, `${absent} is not rendered`);
    }
  });
});

describe('LIN-3833 — once written, the prompt is copied, bounded and keyed', () => {
  test('a written prompt shows Copy, the bounded box with Rewrite and Download, and the progress-key checkbox', async () => {
    const { PromptSection } = load();
    const c = makeContainer();
    PromptSection.init(c, homeOpts());
    await flush();
    await c.click({ prompt: 'plan' });
    await flush();
    assert.match(c.innerHTML, /data-testid="opened-task-copy"[^>]*data-action="copy"/);
    // LIN-3968: the prompt is the text that will be pasted: plain text in the bounded box, not rendered markdown.
    assert.match(c.innerHTML, /class="opened-task-box"><div class="opened-task-text" data-prompt-body>PLAN PROMPT/);
    assert.match(c.innerHTML, /class="btn opened-task-regenerate" data-prompt="plan">Rewrite/);
    assert.match(c.innerHTML, /data-action="download"[^>]*>Download/);
    assert.match(c.innerHTML, /data-testid="opened-task-progress-key"[^>]*checked/, 'the key follows the account default (on)');
    assert.match(c.innerHTML, /Copy it, then paste it into Claude Code, Codex or any coding agent\./);
  });

  test('Rewrite and Download sit outside the markdown sink, so a look-alike in the prompt body is never bound', async () => {
    const { PromptSection } = load();
    const c = makeContainer();
    PromptSection.init(c, homeOpts());
    await flush();
    await c.click({ prompt: 'plan' });
    await flush();
    const sinkStart = c.innerHTML.indexOf('data-prompt-body');
    const sinkEnd = c.innerHTML.indexOf('</div></div>', sinkStart);
    const inside = c.innerHTML.slice(sinkStart, sinkEnd);
    assert.equal(/data-action=|data-prompt=/.test(inside), false, 'no control inside the bounded prompt box');
  });
});

describe('LIN-3833 — the state block: the task\'s own sentence, and what was last copied', () => {
  test('a copy-first state block says the tracker word and what was copied, with no session words (LIN-4010)', async () => {
    const { PromptSection } = load({ stateBody: { live: false, status: 'idle', headerHtml: '<p class="task-sentence">No sessions yet.</p>', trackHtml: '<div class="task-track">stages</div>', sessions: { count: 0, last: null, running: null } } });
    const c = makeContainer();
    PromptSection.init(c, homeOpts());
    await flush();
    assert.match(c.innerHTML, /data-testid="opened-task-copy-state">Todo · No prompt copied from here yet\.</, 'the tracker word, then the copy line');
    assert.equal(c.innerHTML.includes('task-track'), false, 'no stage strip');
    assert.equal(/idle|No sessions yet/.test(c.innerHTML), false, 'a new user never sees "idle" or "No sessions yet"');
  });

  test('Swipe keeps its own card: no state block, no copy-first view', async () => {
    const { PromptSection, calls } = load({ stateBody: { live: false, status: 'idle', headerHtml: '<p class="task-sentence">Nothing yet.</p>', sessions: { count: 0, last: null, running: null } } });
    const c = makeContainer();
    PromptSection.init(c, homeOpts({ surface: 'swipe' }));
    await flush();
    assert.equal(c.innerHTML.includes('opened-task-state'), false);
    assert.equal(c.innerHTML.includes('opened-task-write'), false);
    assert.equal(calls.api.some((u) => u.includes('/api/task-mode/')), false, 'Swipe reads no task-mode record for this view');
  });
});

describe('LIN-3833 — the copy record names its prompt', () => {
  test('a known kind is kept, an unknown one is dropped to null (the copy still counts)', () => {
    assert.equal(copyKindOf('plan'), 'plan');
    assert.equal(copyKindOf('implementation'), 'implementation');
    assert.equal(copyKindOf('nope'), null);
    assert.equal(copyKindOf(undefined), null);
  });

  test('the store writes kind on a copy and never on a dispatch', async () => {
    const stored = [];
    const store = new TaskModeStore({ collection: { insertOne: async (doc) => { stored.push(doc); } } });
    const base = { accountId: 'acct-1', urlKey: 'ws', issueId: null, issueIdentifier: 'LIN-42', rung: 'copy', ready: true, needs: null, surface: 'home' };
    await store.record({ ...base, act: 'copy', kind: 'plan' });
    await store.record({ ...base, act: 'copy', kind: 'nope' });
    await store.record({ ...base, rung: 'run-step', act: 'press', ready: true, kind: 'plan' });
    assert.deepEqual(stored.map((d) => d.kind), ['plan', null, null]);
  });
});

describe('LIN-3833 — the copy-first card on Home', () => {
  const fixture = (over = {}) => renderPage([], [], [], 'Test', { urlKey: 'acme', workspace: { urlKey: 'acme', provider: 'linear' }, ...over });

  test('shown once, in the onboarding slot, with "Got it"', () => {
    const html = fixture({ copyFirstCard: true });
    assert.match(html, /class="home-onboarding-hint home-copy-first-card" data-testid="home-copy-first-card"/);
    assert.match(html, /<button class="btn home-copy-first-dismiss" type="button" data-testid="home-copy-first-dismiss"><span class="btn__label">Got it<\/span><\/button>/);
  });

  test('the "Got it" button is the shared Button piece, never a browser-default button', () => {
    // The visual judge flagged the raw <button> (grey bevel, system font, no padding). The shared
    // `.btn` family carries its own look, so the card adds no styling of its own.
    const html = fixture({ copyFirstCard: true });
    const buttons = html.match(/<button[^>]*home-copy-first-dismiss[^>]*>/g) || [];
    assert.equal(buttons.length, 1);
    assert.match(buttons[0], /class="btn /);
  });

  test('gone once dismissed, and never shown to a run-controls viewer (the caller passes false)', () => {
    assert.equal(/home-copy-first-card/.test(fixture({ copyFirstCard: false })), false);
  });
});
