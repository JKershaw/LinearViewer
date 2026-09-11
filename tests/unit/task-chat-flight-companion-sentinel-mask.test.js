/**
 * LIN-2437 (A.11) — Flight Companion sessions save transcripts through Task
 * Chat's existing saved-chat CRUD endpoint under the sentinel task identifier
 * 'flight-companion' (not a real task id). The sentinel is never rewritten in
 * storage (lib/saved-chat-store.js is untouched); it must instead be masked
 * at render time on every user-visible surface in public/task-chat.js that
 * echoes a saved chat's task identifier, via the ONE shared
 * `maskFlightCompanionSentinel` helper. The four surfaces: the saved-row meta
 * chip, the saved-row title (including its "Chat about …" auto-derived
 * fallback — deriveTitle() in lib/saved-chat-store.js falls back to that when
 * an assistant-only companion transcript has no user turn to title itself
 * from), the active label shown when a saved companion chat is resumed, and
 * the speaker pill on every assistant bubble the resume replay renders
 * (review finding 1 — the loudest of the four, since an assistant-only
 * transcript repeats it once per stored turn).
 *
 * task-chat.js is a browser script (IIFE, not a module), so — following the
 * targeted-extraction technique in tests/unit/dispatch-feedback-entries.test.js
 * and the hand-rolled-DOM-shim technique in
 * tests/unit/chat-append-options.test.js — this vm-sandboxes real source
 * slices rather than reimplementing the logic.
 *
 * Run with: node --test tests/unit/task-chat-flight-companion-sentinel-mask.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_CHAT_JS_SRC = readFileSync(join(__dirname, '../../public/task-chat.js'), 'utf8');

function extractMaskFnSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('var FLIGHT_COMPANION_SENTINEL');
  assert.notEqual(start, -1, 'FLIGHT_COMPANION_SENTINEL found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n  function updateSaveVisibility', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

function extractRenderSavedRowsSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('var FLIGHT_COMPANION_SENTINEL');
  assert.notEqual(start, -1, 'FLIGHT_COMPANION_SENTINEL found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n  function loadSavedList', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

// `appendBubble` is declared ABOVE the mask helper in the file, so its slice is
// taken separately and run into the same context after the mask slice — the
// real file relies on hoisting for the same call, which a single contiguous
// slice could not reproduce.
//
// LIN-2445 widened the signature to `(role, text, state)` and added
// `setBubbleState` + `PILL_GLYPHS` between this function and the next one.
// That is deliberate: they are the pill's write path either side of the
// turn, and keeping them in one slice is what lets the tests below drive
// both. LIN-2632 lifted `toolBreadcrumbLabel` (the function that used to
// follow) into the shared window.ChatUI, so the end marker is now the next
// remaining top-level function, `appendToolBreadcrumb`.
function extractAppendBubbleSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('  function appendBubble(role, text, state) {');
  assert.notEqual(start, -1, 'appendBubble found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n  function appendToolBreadcrumb', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

// ─── Minimal DOM shim (renderSavedRows only needs this much) ────────────────
class FakeClassList {
  constructor(el) { this.el = el; this._set = new Set(); }
  toggle(name, force) {
    const on = force === undefined ? !this._set.has(name) : force;
    if (on) this._set.add(name); else this._set.delete(name);
    return on;
  }
  contains(name) { return this._set.has(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.attributes = {};
    this._innerHTML = '';
    this.children = [];
    this.classList = new FakeClassList(this);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; if (v === '') this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
}

// Sandbox for appendBubble: captures the opts handed to the shared ChatUI
// helper, which is where the speaker-pill label (`who`) is decided.
function makeBubbleSandbox(activeTask) {
  const captured = [];
  const sandbox = {
    activeTask,
    transcript: new FakeElement('ol'),
    setEmptyVisible: () => {},
    window: {
      ChatUI: {
        appendMessage: (_transcript, opts) => {
          captured.push(opts);
          return { querySelector: () => new FakeElement('span') };
        },
      },
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(extractMaskFnSrc(), sandbox, { filename: 'task-chat.js-mask-slice' });
  vm.runInContext(extractAppendBubbleSrc(), sandbox, { filename: 'task-chat.js-append-bubble-slice' });
  return { sandbox, captured };
}

// A bubble <li> shaped the way ChatUI.appendMessage renders one, just deep
// enough for setBubbleState (LIN-2445): the `.chat-msg__who` pill it looks up,
// carrying the `.status-pill__char` glyph node it rewrites. Kept separate from
// FakeElement above, whose FakeClassList models only toggle/contains — this
// path needs real add/remove.
function makePillLi() {
  const classes = new Set(['status-pill', 'chat-msg__who', 'status-pill--in-progress']);
  const char = { textContent: '◐' };
  const pill = {
    classList: {
      add: (...n) => n.forEach(c => classes.add(c)),
      remove: (...n) => n.forEach(c => classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    querySelector: (sel) => (sel === '.status-pill__char' ? char : null),
  };
  const li = { querySelector: (sel) => (sel === '.chat-msg__who' ? pill : null) };
  return { li, pill, char };
}

function makeSandbox(src) {
  const savedList = new FakeElement('ul');
  const savedEmpty = new FakeElement('div');
  const sandbox = {
    document: { createElement: (tag) => new FakeElement(tag) },
    window: { escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') },
    savedList,
    savedEmpty,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'task-chat.js-saved-rows-slice' });
  return sandbox;
}

describe('maskFlightCompanionSentinel (LIN-2437 A.11)', () => {
  test('masks the bare sentinel to a readable label', () => {
    const sandbox = makeSandbox(extractMaskFnSrc());
    assert.equal(sandbox.maskFlightCompanionSentinel('flight-companion'), 'Flight Companion');
  });

  test('masks the sentinel inside the auto-derived title fallback (the assistant-only-transcript leak)', () => {
    const sandbox = makeSandbox(extractMaskFnSrc());
    assert.equal(
      sandbox.maskFlightCompanionSentinel('Chat about flight-companion'),
      'Chat about Flight Companion'
    );
  });

  test('leaves a real task identifier untouched', () => {
    const sandbox = makeSandbox(extractMaskFnSrc());
    assert.equal(sandbox.maskFlightCompanionSentinel('TEST-1'), 'TEST-1');
  });

  test('leaves a user-authored title untouched, even one that never mentions the sentinel', () => {
    const sandbox = makeSandbox(extractMaskFnSrc());
    assert.equal(sandbox.maskFlightCompanionSentinel('Where do you stand?'), 'Where do you stand?');
  });

  test('is a defensive no-op on a non-string', () => {
    const sandbox = makeSandbox(extractMaskFnSrc());
    assert.equal(sandbox.maskFlightCompanionSentinel(undefined), undefined);
    assert.equal(sandbox.maskFlightCompanionSentinel(''), '');
  });
});

describe('renderSavedRows (LIN-2437 A.11) — saved-row meta + title surfaces', () => {
  test('a companion save (sentinel taskIdentifier, fallback title) renders both readable, never the raw sentinel', () => {
    const sandbox = makeSandbox(extractRenderSavedRowsSrc());
    sandbox.renderSavedRows([
      { id: 'c1', taskIdentifier: 'flight-companion', title: 'Chat about flight-companion', turnCount: 1 }
    ]);

    assert.equal(sandbox.savedList.children.length, 1);
    const html = sandbox.savedList.children[0].innerHTML;
    assert.ok(html.includes('Flight Companion'), 'expected the readable label in the rendered row');
    assert.ok(!html.includes('flight-companion'), 'the raw sentinel must never reach the rendered row');
  });

  test('an ordinary task-chat save is unaffected', () => {
    const sandbox = makeSandbox(extractRenderSavedRowsSrc());
    sandbox.renderSavedRows([
      { id: 'c2', taskIdentifier: 'TEST-1', title: 'Where do you stand?', turnCount: 2 }
    ]);

    const html = sandbox.savedList.children[0].innerHTML;
    assert.ok(html.includes('TEST-1'));
    assert.ok(html.includes('Where do you stand?'));
  });
});

describe('appendBubble (LIN-2437 A.11 review finding 1) — assistant bubble speaker pill', () => {
  test('a resumed companion chat renders the readable label on the speaker pill, not the raw sentinel', () => {
    // openSavedChat sets activeTask to the raw sentinel and THEN replays every
    // stored turn through appendBubble — so on an assistant-only companion
    // transcript this pill is the loudest surface, repeated once per bubble.
    const { sandbox, captured } = makeBubbleSandbox('flight-companion');
    sandbox.appendBubble('assistant', 'Standing by.');

    assert.equal(captured.length, 1);
    assert.equal(captured[0].who, 'Flight Companion');
    assert.ok(!String(captured[0].who).includes('flight-companion'), 'the raw sentinel must never reach the speaker pill');
  });

  test('an ordinary task chat still names the task on the pill', () => {
    const { sandbox, captured } = makeBubbleSandbox('TEST-1');
    sandbox.appendBubble('assistant', 'Here is where I stand.');
    assert.equal(captured[0].who, 'TEST-1');
  });

  test("the user's own turn is unaffected, and an empty activeTask still falls back to 'task'", () => {
    const { sandbox, captured } = makeBubbleSandbox('flight-companion');
    sandbox.appendBubble('user', 'hello');
    assert.equal(captured[0].who, 'you');

    const empty = makeBubbleSandbox('');
    empty.sandbox.appendBubble('assistant', 'hi');
    assert.equal(empty.captured[0].who, 'task', 'the || fallback must survive the mask being applied first');
  });
});

// LIN-2445 — the pill's two write paths, at the unit level. The end-to-end
// witnesses are in tests/e2e/task-chat.spec.js; these pin the mechanism
// directly so a regression names the function rather than a rendered class.
// LIN-2483/LIN-2634 — openSavedChat's empty-field fix: resuming a companion
// sentinel chat must never seed the raw sentinel into idInput.value (which
// isValidIssueId would pass, so send() would post it as an issue id and
// 404). activeTask keeps the sentinel either way, so the label/pill/save
// path (which all read activeTask, not idInput.value) are unaffected.
function extractOpenSavedChatSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('  function openSavedChat(id) {');
  assert.notEqual(start, -1, 'openSavedChat found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n  function deleteSavedChat', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

function makeOpenSavedChatSandbox({ apiResponse, apiRejects = false } = {}) {
  const appendBubbleCalls = [];
  const toasts = [];
  const sandbox = {
    urlKey: 'acme',
    activeTask: '',
    chatHistory: [],
    idInput: { value: '' },
    questionInput: { focus: () => {} },
    transcript: new FakeElement('ol'),
    activeLabel: { textContent: '' },
    resetBtn: { classList: { remove: () => {} } },
    setEmptyVisible: () => {},
    updateSaveVisibility: () => {},
    appendBubble: (role, text, state) => {
      appendBubbleCalls.push({ role, text, state });
      return { classList: { add: () => {} } };
    },
    window: {
      api: () => (apiRejects ? Promise.reject(new Error('fail')) : Promise.resolve(apiResponse)),
      ChatUI: { renderMarkdownText: () => {} },
      toast: (msg, opts) => { toasts.push({ msg, opts }); },
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(extractMaskFnSrc(), sandbox, { filename: 'task-chat.js-mask-slice' });
  vm.runInContext(extractOpenSavedChatSrc(), sandbox, { filename: 'task-chat.js-open-saved-chat-slice' });
  return { sandbox, appendBubbleCalls, toasts };
}

// One microtask-chain flush past window.api()'s .then/.catch — a Node
// setImmediate (macrotask) runs strictly after every pending microtask, so
// this is enough regardless of how many .then hops the resolved chain has.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('openSavedChat (LIN-2483/LIN-2634) — resume never seeds the raw sentinel into idInput', () => {
  test('a companion sentinel chat resumes with idInput EMPTY, while activeTask keeps the sentinel and the label reads the masked name', async () => {
    const { sandbox } = makeOpenSavedChatSandbox({
      apiResponse: { chat: { taskIdentifier: 'flight-companion', transcript: [{ role: 'assistant', content: 'Standing by.' }] } },
    });
    sandbox.openSavedChat('c1');
    await flush();

    assert.equal(sandbox.idInput.value, '', 'idInput must be left empty, never the raw sentinel');
    assert.equal(sandbox.activeTask, 'flight-companion', 'activeTask must still carry the sentinel — the save path reads this');
    assert.equal(sandbox.activeLabel.textContent, 'talking to Flight Companion');
  });

  test('an ordinary saved task chat still seeds idInput with the real identifier', async () => {
    const { sandbox } = makeOpenSavedChatSandbox({
      apiResponse: { chat: { taskIdentifier: 'TEST-1', transcript: [{ role: 'user', content: 'hi' }] } },
    });
    sandbox.openSavedChat('c2');
    await flush();

    assert.equal(sandbox.idInput.value, 'TEST-1');
    assert.equal(sandbox.activeTask, 'TEST-1');
    assert.equal(sandbox.activeLabel.textContent, 'talking to TEST-1');
  });
});

// LIN-2483/LIN-2634 — send()'s label-rebuild mask, on the whole-function
// slice + stubbed global fetch technique (correction 2): the harness parses
// whole top-level statements between markers, so a partial-body slice up to
// the label assignment (stopping short of the raw fetch call, the original
// plan's technique) cannot parse. The label assignment runs synchronously
// BEFORE the fetch call, so a fetch that never settles is sufficient — no
// downstream SSE/tool-breadcrumb machinery needs to exist in the sandbox.
function extractSendSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('  function send() {');
  assert.notEqual(start, -1, 'send found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n  sendBtn.addEventListener', start);
  assert.notEqual(end, -1, 'the whole send() function body must be captured before the next top-level statement');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

function makeSendSandbox({ idValue, activeTask }) {
  const appendBubbleCalls = [];
  const sandbox = {
    streaming: false,
    idInput: { value: idValue, focus: () => {} },
    questionInput: { value: 'a question', focus: () => {} },
    activeTask,
    chatHistory: [],
    transcript: new FakeElement('ol'),
    activeLabel: { textContent: '' },
    resetBtn: { classList: { remove: () => {} } },
    prefillTask: '',
    prefillSource: '',
    urlKey: 'acme',
    appendBubble: (role, text) => {
      appendBubbleCalls.push({ role, text });
      return { classList: { add: () => {} }, closest: () => ({}) };
    },
    updateSaveVisibility: () => {},
    setBusy: () => {},
    // A real, never-settling native Promise — send()'s .then()/.catch() chain
    // registers callbacks that simply never run, so nothing downstream of the
    // synchronous label assignment (readSSEStream, tool breadcrumbs, done/
    // error handling) needs to exist in this sandbox.
    fetch: () => new Promise(() => {}),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(extractMaskFnSrc(), sandbox, { filename: 'task-chat.js-mask-slice' });
  vm.runInContext(extractSendSrc(), sandbox, { filename: 'task-chat.js-send-slice' });
  return { sandbox, appendBubbleCalls };
}

describe('send() (LIN-2483/LIN-2634) — the label rebuild never re-exposes the raw sentinel', () => {
  test('re-editing the id field back to the raw sentinel masks the label on the very next send', () => {
    const { sandbox } = makeSendSandbox({ idValue: 'flight-companion', activeTask: '' });
    sandbox.send();

    assert.equal(sandbox.activeLabel.textContent, 'talking to Flight Companion');
    assert.ok(!sandbox.activeLabel.textContent.includes('flight-companion'), 'the raw sentinel must never reach the label');
  });

  test('an ordinary task id leaves the mask a no-op', () => {
    const { sandbox } = makeSendSandbox({ idValue: 'TEST-1', activeTask: '' });
    sandbox.send();

    assert.equal(sandbox.activeLabel.textContent, 'talking to TEST-1');
  });

  test('switching FROM the companion chat to a real task id does not rebuild the label a second time with stale masking', () => {
    // activeTask already equals taskId (both real), so the switching branch
    // — and therefore the label rebuild — does not run at all here; this
    // pins that the mask fix didn't accidentally make the branch run always.
    const { sandbox } = makeSendSandbox({ idValue: 'TEST-1', activeTask: 'TEST-1' });
    sandbox.send();

    assert.equal(sandbox.activeLabel.textContent, '', 'no switch happened, so the label is untouched by this send()');
  });
});

describe('appendBubble / setBubbleState (LIN-2445) — the assistant pill settles', () => {
  test('a live assistant turn still OPENS in-progress', () => {
    const { sandbox, captured } = makeBubbleSandbox('TEST-1');
    sandbox.appendBubble('assistant', '');
    assert.equal(captured[0].whoState, 'in-progress');
  });

  test('an already-complete turn opens SETTLED — the saved-chat replay path', () => {
    // openSavedChat replays stored turns, every one of which finished before it
    // was persisted. There is no completion moment to hook, so the state is
    // passed at append time instead of swapped afterwards.
    const { sandbox, captured } = makeBubbleSandbox('TEST-1');
    sandbox.appendBubble('assistant', 'a stored answer', 'done');
    assert.equal(captured[0].whoState, 'done');
  });

  test("the user's turn takes no status state, with or without an explicit one", () => {
    const { sandbox, captured } = makeBubbleSandbox('TEST-1');
    sandbox.appendBubble('user', 'a question', 'done');
    assert.equal(captured[0].whoState, undefined, 'the user pill stays a neutral tag chip');
  });

  test('setBubbleState swaps in-progress for the terminal state AND its glyph', () => {
    const { sandbox } = makeBubbleSandbox('TEST-1');
    const { li, pill, char } = makePillLi();

    sandbox.setBubbleState(li, 'done');

    assert.ok(!pill.classList.contains('status-pill--in-progress'), 'the amber state must not persist');
    assert.ok(pill.classList.contains('status-pill--done'));
    // The glyph moves with the class — a swapped class over a stale ◐ would
    // read as done in CSS while still showing the in-progress character.
    assert.equal(char.textContent, '✓');
  });

  test('setBubbleState reaches the failed state too', () => {
    const { sandbox } = makeBubbleSandbox('TEST-1');
    const { li, pill, char } = makePillLi();

    sandbox.setBubbleState(li, 'failed');

    assert.ok(!pill.classList.contains('status-pill--in-progress'));
    assert.ok(pill.classList.contains('status-pill--failed'));
    assert.equal(char.textContent, '✕');
  });

  test('setBubbleState is a defensive no-op on a missing li or a bubble with no pill', () => {
    const { sandbox } = makeBubbleSandbox('TEST-1');
    assert.doesNotThrow(() => sandbox.setBubbleState(null, 'done'));
    assert.doesNotThrow(() => sandbox.setBubbleState({ querySelector: () => null }, 'done'));
  });
});
