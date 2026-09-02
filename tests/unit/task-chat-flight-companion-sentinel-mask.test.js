/**
 * LIN-2437 (A.11) — Flight Companion sessions save transcripts through Task
 * Chat's existing saved-chat CRUD endpoint under the sentinel task identifier
 * 'flight-companion' (not a real task id). The sentinel is never rewritten in
 * storage (lib/saved-chat-store.js is untouched); it must instead be masked
 * at render time on every user-visible surface in public/task-chat.js that
 * echoes a saved chat's task identifier, via the ONE shared
 * `maskFlightCompanionSentinel` helper: the saved-row meta chip, the
 * saved-row title (including its "Chat about …" auto-derived fallback —
 * deriveTitle() in lib/saved-chat-store.js falls back to that when an
 * assistant-only companion transcript has no user turn to title itself
 * from), and the active label shown when a saved companion chat is resumed.
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
