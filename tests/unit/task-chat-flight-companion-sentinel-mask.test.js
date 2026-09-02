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
function extractAppendBubbleSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('  function appendBubble(role, text) {');
  assert.notEqual(start, -1, 'appendBubble found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n  function toolBreadcrumbLabel', start);
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
