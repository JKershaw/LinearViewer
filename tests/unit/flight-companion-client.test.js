/**
 * Unit tests for public/flight-companion.js (LIN-2435 Commit 3).
 *
 * public/flight-companion.js is a browser script (not an ES module) with
 * real DOM/fetch/timer dependencies at call time but none at load time — so
 * it is vm-sandboxed (mirrors tests/unit/observation-ruling-delivery.test.js)
 * with a hand-rolled DOM shim just deep enough for this file's own usage
 * (getElementById/querySelector/createElement/classList/dataset/
 * addEventListener), plus a fake `window.ChatUI`/`window.api` and a
 * test-controlled `fetch`. The module.exports test seam at the bottom of
 * flight-companion.js exposes the pure cadence/classification/history
 * helpers plus the cadence-scheduler and turn-send entry points, so cadence
 * behavior is driven through REAL timers via `t.mock.timers` rather than
 * re-derived by inspection.
 *
 * Run with: node --test tests/unit/flight-companion-client.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deepEqual as looseDeepEqual } from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = readFileSync(join(__dirname, '../../public/flight-companion.js'), 'utf8');
// LIN-2632: the shared window.ChatUI.toolBreadcrumbLabel implementation the
// Flight Companion breadcrumb rendering will call — loaded from its real
// home (public/chat.js, lifted off task-chat.js per LIN-1578) rather than
// re-declared here, so a drift between the two can't hide from this suite.
const CHAT_JS_SRC = readFileSync(join(__dirname, '../../public/chat.js'), 'utf8');
// Comments legitimately name the very things a constraint check forbids
// (explaining why NOT to use them) — strip block/line comments before
// grepping for CODE, so a doc comment's own prose can't trip a "must not
// appear" assertion.
const CLIENT_CODE_ONLY = CLIENT_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// ─── Minimal DOM shim ───────────────────────────────────────────────────────

class FakeClassList {
  constructor() { this._set = new Set(); }
  add(...names) { names.forEach(n => n && this._set.add(n)); }
  remove(...names) { names.forEach(n => this._set.delete(n)); }
  toggle(name, force) {
    const on = force === undefined ? !this._set.has(name) : force;
    if (on) this._set.add(name); else this._set.delete(name);
    return on;
  }
  contains(name) { return this._set.has(name); }
}

function findByClass(el, cls) {
  for (const child of el.children) {
    if (child.classList && child.classList.contains(cls)) return child;
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return null;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this._listeners = {};
    this.classList = new FakeClassList();
    this._text = '';
    // LIN-2670 finding 3/5: a plain write-recorder, not a parser — stores
    // the assigned string verbatim so tests can check SINK IDENTITY (did
    // renderMarkdownText's output land here?) without reading content back
    // out of markup, the same distinction tests/unit/chat-append-options.test.js
    // draws for its own deliberate omission of innerHTML.
    this._innerHTML = null;
    this.value = '';
    // LIN-2718: `disabled` is a getter/setter (not a plain field) so tests can
    // observe EVERY write, not just the current value — the busy-by-turn-kind
    // split is a claim about writes that never happen (auto-wake), which a
    // bare value read can't distinguish from "happened to end up false".
    // `_ownerDocument`/focus()'s blur-on-disable mirror real browser behavior
    // (disabling the focused element blurs it) so a regression that captures
    // "did the input have focus" AFTER locking the composer, instead of
    // before, fails this fake the same way it would fail in a real browser.
    this._disabled = false;
    this._disabledWriteCount = 0;
    this._focusCallCount = 0;
    this._ownerDocument = null;
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
  }
  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = v;
    this._disabledWriteCount += 1;
    if (v && this._ownerDocument && this._ownerDocument.activeElement === this) {
      this._ownerDocument.activeElement = null;
    }
  }
  focus() {
    this._focusCallCount += 1;
    if (this._ownerDocument) this._ownerDocument.activeElement = this;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; }
  get className() { return Array.from(this.classList._set).join(' '); }
  set className(v) {
    this.classList = new FakeClassList();
    String(v || '').split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, ref) {
    const idx = this.children.indexOf(ref);
    child.parentNode = this;
    if (idx === -1) this.children.push(child); else this.children.splice(idx, 0, child);
    return child;
  }
  querySelector(sel) {
    if (typeof sel === 'string' && sel.startsWith('.')) return findByClass(this, sel.slice(1));
    return null;
  }
  closest(tag) {
    let node = this;
    while (node) {
      if (node.tagName && node.tagName.toLowerCase() === String(tag).toLowerCase()) return node;
      node = node.parentNode;
    }
    return null;
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(f => f !== fn);
  }
  // LIN-2621 beat 4: needed once the REAL public/chat.js's appendOptions
  // runs against this shim (`wrap.setAttribute('data-disposition', ...)`).
  setAttribute(name, value) { (this._attrs = this._attrs || {})[name] = String(value); }
  getAttribute(name) { return (this._attrs && this._attrs[name]) ?? null; }
  // LIN-2717 S4-a: `evt` is optional and backward-compatible — every
  // pre-existing `.dispatch(type)` caller in this file passes the type only,
  // and their handlers already receive `undefined` today. Without this,
  // `:1305`'s `e.key` throws and the key contract is untestable at all.
  dispatch(type, evt) { (this._listeners[type] || []).forEach(fn => fn(evt)); }
  // LIN-2717 S4-c: opt-in fake layout for the composer only. resizeComposer's
  // whole job is WRITE-then-READ-BACK, which a static fake cannot represent
  // — a frozen clientHeight would make the overflow branch compare a stale
  // value and bake a wrong expectation into the test. This models exactly
  // one browser behavior: writing style.height reflows client/offsetHeight,
  // clamped by the CSS min-height/max-height. NaN is propagated, never
  // repaired — a 'NaNpx' write must stay visible to the assertions. `min`
  // defaults to 35.2 (2.2rem at a 16px root — the stylesheet's real resting
  // floor, not the plan's earlier "36" rounding) and `max` to 136 (8.5rem).
  _useLayout({ content = 0, min = 35.2, max = 136, border = 2 } = {}) {
    const self = this;
    let box = Math.min(Math.max(content, min), max); // content-box px
    this._heightWrites = [];
    this.setContent = px => { content = px; }; // "the user typed N px of text"
    Object.defineProperties(this, {
      clientHeight: { get: () => box, configurable: true },
      offsetHeight: { get: () => box + border, configurable: true },
      scrollHeight: { get: () => Math.max(content, box), configurable: true },
    });
    this.style = {
      overflowY: '',
      get height() { return self._heightWrites[self._heightWrites.length - 1] ?? ''; },
      set height(v) {
        self._heightWrites.push(v);
        const px = v === 'auto' ? content : parseFloat(v) - border; // box-sizing: border-box
        box = Math.min(Math.max(px, min), max); // NaN stays NaN
      },
    };
  }
}

function makeDocument({ hiddenInitial = false } = {}) {
  const byId = {};
  const listeners = {};
  let page = null;
  const doc = {
    get hidden() { return doc._hidden; },
    set hidden(v) { doc._hidden = v; },
    _hidden: hiddenInitial,
    // LIN-2718: real document.activeElement, read by sendTurn (captured
    // BEFORE the composer lock, so a regression that reads it after would
    // see it already cleared by the disabled-setter's blur simulation
    // above) and written by FakeElement#focus().
    get activeElement() { return doc._activeElement || null; },
    set activeElement(v) { doc._activeElement = v; },
    _activeElement: null,
    getElementById(id) { return byId[id] || null; },
    querySelector(sel) { return sel === '.flight-companion-page' ? page : null; },
    createElement(tag) { return new FakeElement(tag); },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter(f => f !== fn);
    },
    dispatch(type) { (listeners[type] || []).forEach(fn => fn()); },
    _listenerCount(type) { return (listeners[type] || []).length; },
    _byId: byId,
    _setPage(el) { page = el; },
  };
  return doc;
}

function makeChatUI(doc) {
  const calls = { appendMessage: [], appendNote: [] };
  // LIN-2621 beat 4: sourcing appendOptions from the SAME real chat.js load
  // as toolBreadcrumbLabel below — genuine reuse evidence, not a second
  // hand-rolled option-row fake. Requires `doc` (the caller's own FakeElement
  // document) since, unlike toolBreadcrumbLabel, appendOptions does real
  // `document.createElement`/`setAttribute` work.
  const realChatUI = loadChatUI(doc);
  return {
    calls,
    // LIN-2632 beat 2: flight-companion.js now calls
    // window.ChatUI.toolBreadcrumbLabel for its tool breadcrumbs — sourced
    // from the REAL chat.js (loadChatUI(), defined further down this file)
    // rather than a second hand-rolled fake, so a real regression in the
    // shared label helper fails these tests too, not just its own.
    toolBreadcrumbLabel: realChatUI.toolBreadcrumbLabel,
    appendOptions: realChatUI.appendOptions,
    // LIN-2670: same reuse-evidence pattern as the two lines above — sourced
    // from the REAL chat.js rather than a second hand-rolled fake, so a real
    // regression in the shared helper fails these tests too.
    renderMarkdownText: realChatUI.renderMarkdownText,
    appendMessage(thread, opts) {
      calls.appendMessage.push(opts);
      const li = new FakeElement('li');
      li.className = 'chat-msg' + (opts.liClass ? ' ' + opts.liClass : '');
      // The speaker pill (LIN-2443 AC4). Mirrors what public/chat.js:62-65,82
      // actually bakes into the <li> via window.renderStatusPill: a
      // .chat-msg__who pill carrying a .status-pill--<state> class and a
      // .status-pill__char glyph node. Without this the shim emitted a body
      // span only, and the pill transition was untestable here.
      const who = new FakeElement('span');
      who.className = 'status-pill '
        + (opts.whoState ? 'status-pill--' + opts.whoState : 'status-pill--tag')
        + ' chat-msg__who' + (opts.whoClass ? ' ' + opts.whoClass : '');
      const charEl = new FakeElement('span');
      charEl.className = 'status-pill__char';
      charEl.textContent = opts.whoState === 'in-progress' ? '\u25d0' : '';
      who.appendChild(charEl);
      const labelEl = new FakeElement('span');
      labelEl.className = 'status-pill__label';
      labelEl.textContent = opts.who || '';
      who.appendChild(labelEl);
      li.appendChild(who);
      const body = new FakeElement('span');
      body.className = 'chat-msg__body' + (opts.textClass ? ' ' + opts.textClass : '');
      body.textContent = opts.text || '';
      li.appendChild(body);
      thread.appendChild(li);
      thread.hidden = false;
      return li;
    },
    appendNote(thread, text, opts) {
      opts = opts || {};
      calls.appendNote.push({ text, opts });
      const li = new FakeElement('li');
      li.className = 'chat-note' + (opts.liClass ? ' ' + opts.liClass : '');
      li.textContent = text;
      if (opts.before && opts.before.parentNode === thread) thread.insertBefore(li, opts.before);
      else thread.appendChild(li);
      thread.hidden = false;
      return li;
    },
  };
}

function makeApiSpy(impl) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return impl(url, opts);
  };
  fn.calls = calls;
  return fn;
}

// LIN-2621 beat 4: a fake window.ReplyDelivery.postComment — the ONLY
// ReplyDelivery method a decision-button tap is allowed to reach (never
// deliverReply, which also dispatches/resumes a run). Real signature:
// `postComment(urlKey, issueId, prompt, decision)` -> `{ok, status, data}`,
// never rejecting on a non-2xx (mirrors public/common.js).
function makeReplyDeliverySpy(impl) {
  const calls = [];
  const postComment = (urlKey, issueId, prompt, decision) => {
    calls.push({ urlKey, issueId, prompt, decision });
    return Promise.resolve().then(() => impl(urlKey, issueId, prompt, decision));
  };
  postComment.calls = calls;
  return postComment;
}

// LIN-2716: a minimal Web Storage fake (sessionStorage's real interface is
// getItem/setItem/removeItem over string keys/values — no iteration/length
// this module's helper needs). `initial` seeds raw string entries, exactly
// as a real browser would already hold them across a reload — the shape a
// corrupt-storage test needs to construct directly, bypassing setItem.
function makeFakeStorage(initial = {}) {
  const data = Object.assign({}, initial);
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    _data: data,
  };
}

function makeFetchSpy(responder) {
  const calls = [];
  const fn = (url, opts) => {
    calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
    // Always return a real Promise — a synchronous responder result (a
    // plain response object) is wrapped; a responder that itself returns a
    // (possibly rejected) Promise is adopted as-is.
    return Promise.resolve().then(() => responder(url, opts));
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(body),
  };
}

function htmlResponse(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html' : null) },
    json: () => Promise.reject(new Error('not json')),
  };
}

function sseFrame(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(frames) {
  const bytes = new TextEncoder().encode(frames.join(''));
  let sent = false;
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader() {
        return {
          read() {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: bytes });
          },
        };
      },
    },
  };
}

function loadClient({ hiddenInitial = false, fetchImpl, apiImpl, postCommentImpl, storageImpl, pageDataset } = {}) {
  const doc = makeDocument({ hiddenInitial });
  const page = new FakeElement('main');
  page.dataset.urlKey = 'acme';
  // LIN-2771 beat 3: the real renderer emits `data-fc-ai-configured` on the
  // page element (lib/render-flight-companion.js); tests seed it here so the
  // client's load-time per-reason decision reads a page the same way it would
  // in a browser.
  if (pageDataset) Object.assign(page.dataset, pageDataset);
  doc._setPage(page);

  const thread = new FakeElement('ul');
  const emptyState = new FakeElement('p');
  const checkIn = new FakeElement('p');
  checkIn.hidden = true;
  // LIN-2717 S4-b: 'textarea', keeping the file's lower-case tag convention
  // ('button', 'li', 'span', 'ul', 'p', 'main' — closest() at :131 lower-
  // cases before comparing, confirming the convention is intentional).
  // Pairs with resizeComposer's case-insensitive guard: 'textarea' !==
  // 'TEXTAREA', so changing the fake alone would not make the guard
  // reachable — production stays honest in a browser, the seam stays
  // idiomatic, and the guard is genuinely traversed.
  const questionInput = new FakeElement('textarea');
  const sendBtn = new FakeElement('button');
  // LIN-2622: the start button and the re-orient affordance — mirrors the
  // real render (lib/render-flight-companion.js): reorient starts with the
  // 'hidden' CLASS applied (the complementary-pair convention setEmptyVisible
  // relies on), start does not.
  const startBtn = new FakeElement('button');
  const reorientBtn = new FakeElement('button');
  reorientBtn.classList.add('hidden');
  // LIN-2621: the status strip's "next check-in due" mount — mirrors the
  // real render's server-rendered em-dash placeholder.
  const stripNextEl = new FakeElement('span');
  stripNextEl.textContent = 'next check-in: —';
  // LIN-2621 beat 3: the strip's running "this tab so far" total — mirrors
  // the real render's server-rendered TRUE initial value (a fresh tab has
  // spent nothing).
  const stripTabTotalEl = new FakeElement('span');
  stripTabTotalEl.textContent = '0 check-ins · $0.00 this tab';
  // LIN-2623 beat 3: the model picker + its rate-card mount. `.value`
  // mirrors a real <select>'s reported value — this fake does not model
  // `<option>`/`selectedIndex` (unneeded here: every test in this file
  // drives the picker by writing `.value` directly, the same way a real
  // <select>'s value changes when an option is picked; `.options` stays
  // undefined, so `updateModelPriceDisplay`'s real-DOM `data-pricing` read
  // safely no-ops — that live-DOM behavior is covered by
  // tests/unit/render-flight-companion.test.js's markup assertions and
  // tests/e2e/flight-companion.spec.js's real-browser round trip instead).
  const modelSelectEl = new FakeElement('select');
  modelSelectEl.value = '';
  const modelPriceEl = new FakeElement('span');
  modelPriceEl.textContent = '—';
  doc._byId['flight-companion-thread'] = thread;
  doc._byId['flight-companion-chat-empty'] = emptyState;
  doc._byId['flight-companion-checkin'] = checkIn;
  doc._byId['flight-companion-question'] = questionInput;
  doc._byId['flight-companion-send'] = sendBtn;
  doc._byId['flight-companion-start'] = startBtn;
  doc._byId['flight-companion-reorient'] = reorientBtn;
  doc._byId['flight-companion-strip-next'] = stripNextEl;
  doc._byId['flight-companion-strip-tab-total'] = stripTabTotalEl;
  doc._byId['flight-companion-model-select'] = modelSelectEl;
  doc._byId['flight-companion-model-price'] = modelPriceEl;
  // LIN-2718: only the composer's own input is ever focused/blurred by this
  // module — wiring the owner document lets FakeElement#focus() and the
  // `disabled` setter's blur-on-disable simulate real activeElement changes.
  questionInput._ownerDocument = doc;
  // LIN-2717 S4-c: every test runs against a live, correctly-resting
  // composer — a crash or NaN regression in resizeComposer then fails the
  // whole suite, not just the new tests below. Resize-specific tests call
  // questionInput.setContent(px) to stage a scenario.
  questionInput._useLayout({ content: 0 });

  const chatUI = makeChatUI(doc);
  const fetchSpy = makeFetchSpy(fetchImpl || (() => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' })));
  const apiSpy = makeApiSpy(apiImpl || (async () => { throw Object.assign(new Error('unexpected api call'), { status: 500 }); }));
  const postCommentSpy = makeReplyDeliverySpy(postCommentImpl || (() => ({ ok: true, status: 200, data: {} })));
  // LIN-2716: sessionStorage is a vm-global here (bare `sessionStorage.*`
  // references in the client script resolve against the sandbox object
  // itself, same as `document`/`window`/`fetch` above), never routed through
  // `window.sessionStorage` — mirrors how a real browser exposes it.
  const storage = storageImpl || makeFakeStorage();

  const windowShim = {
    ChatUI: chatUI,
    api: apiSpy,
    ReplyDelivery: { postComment: postCommentSpy },
    _listeners: {},
    addEventListener(type, fn) { (windowShim._listeners[type] = windowShim._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      if (!windowShim._listeners[type]) return;
      windowShim._listeners[type] = windowShim._listeners[type].filter(f => f !== fn);
    },
    dispatch(type) { (windowShim._listeners[type] || []).forEach(fn => fn()); },
  };

  const sandbox = {
    document: doc,
    window: windowShim,
    module: { exports: {} },
    console,
    // `.unref()` so a real (unmocked) auto-scheduled timer — the module
    // schedules one unconditionally at load whenever `document.hidden` is
    // false — never keeps the test process alive after the test itself has
    // finished. Mock-timer Timeout objects (t.mock.timers) may not expose
    // `.unref`, hence the guard.
    setTimeout: (...args) => {
      const id = setTimeout(...args);
      if (id && typeof id.unref === 'function') id.unref();
      return id;
    },
    clearTimeout: (...args) => clearTimeout(...args),
    fetch: fetchSpy,
    TextDecoder,
    navigator: { clipboard: { writeText: async () => {} } },
    sessionStorage: storage,
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_SRC, sandbox, { filename: 'flight-companion.js' });

  return {
    exports: sandbox.module.exports,
    doc, thread, emptyState, checkIn, questionInput, sendBtn, startBtn, reorientBtn, stripNextEl, stripTabTotalEl,
    chatUICalls: chatUI.calls,
    fetchCalls: fetchSpy.calls,
    apiCalls: apiSpy.calls,
    replyDeliveryCalls: postCommentSpy.calls,
    windowShim,
    storage,
  };
}

async function flush(n = 8) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// ─── Pure helpers ────────────────────────────────────────────────────────

describe('flight-companion.js — pure helpers (no DOM/timers)', () => {
  test('capHistory keeps only the most recent `cap` entries', () => {
    const { exports: m } = loadClient();
    const history = [];
    for (let i = 0; i < 45; i++) { history.push({ role: 'user', content: String(i) }); m.capHistory(history); }
    assert.strictEqual(history.length, 40);
    assert.strictEqual(history[0].content, '5');
    assert.strictEqual(history[39].content, '44');
  });

  test('nextCadenceDelay doubles then caps at 180s', () => {
    const { exports: m } = loadClient();
    assert.strictEqual(m.nextCadenceDelay(30000), 60000);
    assert.strictEqual(m.nextCadenceDelay(60000), 120000);
    assert.strictEqual(m.nextCadenceDelay(120000), 180000);
    assert.strictEqual(m.nextCadenceDelay(180000), 180000, 'must not exceed the 180s cap');
  });

  test('doneCadenceEffect: user-initiated always resets, regardless of surface', () => {
    const { exports: m } = loadClient();
    assert.strictEqual(m.doneCadenceEffect('user-initiated', undefined), 'reset');
    assert.strictEqual(m.doneCadenceEffect('user-initiated', true), 'reset');
    assert.strictEqual(m.doneCadenceEffect('user-initiated', false), 'reset');
  });

  test('doneCadenceEffect: auto-wake resets only on surface:true, doubles on surface:false', () => {
    const { exports: m } = loadClient();
    assert.strictEqual(m.doneCadenceEffect('auto-wake', true), 'reset');
    assert.strictEqual(m.doneCadenceEffect('auto-wake', false), 'double');
  });

  test('doneCadenceEffect: a boot always resets, regardless of surface — LIN-2622, "reset on done ONLY"', () => {
    const { exports: m } = loadClient();
    assert.strictEqual(m.doneCadenceEffect('boot', undefined), 'reset');
    assert.strictEqual(m.doneCadenceEffect('boot', true), 'reset');
    assert.strictEqual(m.doneCadenceEffect('boot', false), 'reset');
  });

  test('advanceCadence: double/reset/stop reducer, and stopped is a true terminal state', () => {
    const { exports: m } = loadClient();
    // LIN-2771 beat 3: the reducer also carries `stoppedReason` — null while
    // running, the reason while stopped (null when 'stop' is applied with no
    // reason).
    let s = { delayMs: 30000, stopped: false };
    s = m.advanceCadence(s, 'double');
    looseDeepEqual(s, { delayMs: 60000, stopped: false, stoppedReason: null });
    s = m.advanceCadence(s, 'double');
    looseDeepEqual(s, { delayMs: 120000, stopped: false, stoppedReason: null });
    s = m.advanceCadence(s, 'double');
    looseDeepEqual(s, { delayMs: 180000, stopped: false, stoppedReason: null });
    s = m.advanceCadence(s, 'double');
    looseDeepEqual(s, { delayMs: 180000, stopped: false, stoppedReason: null }, 'capped');
    s = m.advanceCadence(s, 'reset');
    looseDeepEqual(s, { delayMs: 30000, stopped: false, stoppedReason: null });
    s = m.advanceCadence(s, 'stop');
    looseDeepEqual(s, { delayMs: 30000, stopped: true, stoppedReason: null });
    // A reason is threaded through from the stop site (from a fresh,
    // non-stopped state — reset is a no-op once stopped, so it cannot be
    // used to un-stop and re-stop here).
    looseDeepEqual(m.advanceCadence({ delayMs: 30000, stopped: false }, 'stop', 'session-expired'),
      { delayMs: 30000, stopped: true, stoppedReason: 'session-expired' });
    // Terminal: nothing un-stops it.
    looseDeepEqual(m.advanceCadence(s, 'reset'), { delayMs: 30000, stopped: true, stoppedReason: null });
    looseDeepEqual(m.advanceCadence(s, 'double'), { delayMs: 30000, stopped: true, stoppedReason: null });
  });

  test('autoWakeErrorCadenceEffect: session-expired/flag-off/ai-not-configured stop; everything else doubles', () => {
    const { exports: m } = loadClient();
    assert.strictEqual(m.autoWakeErrorCadenceEffect('session-expired'), 'stop');
    assert.strictEqual(m.autoWakeErrorCadenceEffect('flag-off'), 'stop');
    assert.strictEqual(m.autoWakeErrorCadenceEffect('ai-not-configured'), 'stop');
    assert.strictEqual(m.autoWakeErrorCadenceEffect('gate-silent'), 'double');
    assert.strictEqual(m.autoWakeErrorCadenceEffect('server-error'), 'double');
    assert.strictEqual(m.autoWakeErrorCadenceEffect('network-error'), 'double');
    assert.strictEqual(m.autoWakeErrorCadenceEffect('sse-error'), 'double');
  });

  test('classifyTurnResponse: the full response matrix, F4 + F6', () => {
    const { exports: m } = loadClient();
    looseDeepEqual(m.classifyTurnResponse({ ok: true, status: 200, isEventStream: true, jsonBody: null }), { kind: 'sse' });
    looseDeepEqual(
      m.classifyTurnResponse({ ok: true, status: 200, isEventStream: false, jsonBody: { turnKind: 'auto-wake', spent: false, reason: 'floor' } }),
      { kind: 'gate-silent', reason: 'floor' }
    );
    // F6: middleware 401 (session expiry) — must be recognized without assuming the body is well-formed JSON.
    assert.strictEqual(m.classifyTurnResponse({ ok: false, status: 401, isEventStream: false, jsonBody: { error: 'Not authenticated' } }).kind, 'session-expired');
    assert.strictEqual(m.classifyTurnResponse({ ok: false, status: 403, isEventStream: false, jsonBody: { error: 'Flight Companion feature is not enabled' } }).kind, 'flag-off');
    assert.strictEqual(m.classifyTurnResponse({ ok: false, status: 400, isEventStream: false, jsonBody: { error: 'message must be 2000 characters or fewer' } }).kind, 'message-too-long');
    assert.strictEqual(m.classifyTurnResponse({ ok: false, status: 503, isEventStream: false, jsonBody: { error: 'AI is not configured.' } }).kind, 'ai-not-configured');
    const freeTier = m.classifyTurnResponse({ ok: false, status: 429, isEventStream: false, jsonBody: { error: 'Free tier limit reached', freeTier: { remaining: 0, limit: 10, resetsAt: 'x' } } });
    assert.strictEqual(freeTier.kind, 'free-tier-limit');
    looseDeepEqual(freeTier.freeTier, { remaining: 0, limit: 10, resetsAt: 'x' });
    // F6: a 500, and a non-OK/non-JSON body (the middleware's HTML 404), must
    // both classify as a generic server-error — never assumed JSON.
    assert.strictEqual(m.classifyTurnResponse({ ok: false, status: 500, isEventStream: false, jsonBody: { error: 'Internal server error' } }).kind, 'server-error');
    assert.strictEqual(m.classifyTurnResponse({ ok: false, status: 404, isEventStream: false, jsonBody: null }).kind, 'server-error');
  });

  test('LIN-2438 T16: classifyTurnResponse carries reason "sweep-not-seen" through as gate-silent, with sweepLastSeenAt attached', () => {
    const { exports: m } = loadClient();
    looseDeepEqual(
      m.classifyTurnResponse({
        ok: true, status: 200, isEventStream: false,
        jsonBody: { turnKind: 'auto-wake', spent: false, reason: 'sweep-not-seen', sweepLastSeenAt: '2026-09-02T20:00:00.000Z' }
      }),
      { kind: 'gate-silent', reason: 'sweep-not-seen', sweepLastSeenAt: '2026-09-02T20:00:00.000Z' }
    );
    // Every other reason must keep the exact pre-LIN-2438 shape — no
    // sweepLastSeenAt key at all, not even set to undefined.
    const ordinary = m.classifyTurnResponse({ ok: true, status: 200, isEventStream: false, jsonBody: { turnKind: 'auto-wake', spent: false, reason: 'hash-identical' } });
    assert.deepStrictEqual(Object.keys(ordinary).sort(), ['kind', 'reason']);
  });

  test('parseProposalResult: valid shape parses; a truncated/malformed payload fails safely, never throws', () => {
    const { exports: m } = loadClient();
    const ok = m.parseProposalResult(JSON.stringify({ proposed: true, sessionId: 'sess-1', prompt: 'go' }));
    looseDeepEqual(ok, { ok: true, proposal: { proposed: true, sessionId: 'sess-1', prompt: 'go' } });

    const truncated = 'x'.repeat(50) + '\n… [truncated 4000 chars]';
    looseDeepEqual(m.parseProposalResult(truncated), { ok: false });

    // Valid JSON, wrong shape (missing sessionId/prompt).
    looseDeepEqual(m.parseProposalResult(JSON.stringify({ ok: true, itemId: 'x' })), { ok: false });
  });

  // LIN-2621 beat 3
  test('formatCost: small amounts keep 4 decimals, larger totals round to 2 (mirrors lib/render-settings.js\'s own formatCost)', () => {
    const { exports: m } = loadClient();
    assert.strictEqual(m.formatCost(0.00042), '$0.0004');
    assert.strictEqual(m.formatCost(0.5), '$0.5000');
    assert.strictEqual(m.formatCost(1), '$1.00');
    assert.strictEqual(m.formatCost(12.3), '$12.30');
    assert.strictEqual(m.formatCost(0), '$0.00');
    assert.strictEqual(m.formatCost(undefined), '$0.00', 'a non-numeric input degrades to $0.00, never NaN');
    assert.strictEqual(m.formatCost(NaN), '$0.00');
  });

  test('formatTurnMeta: tokens + cost, reading exactly what the usage payload carries', () => {
    const { exports: m } = loadClient();
    assert.strictEqual(
      m.formatTurnMeta({ prompt_tokens: 100, completion_tokens: 47, total_tokens: 147, cost: 0.00042 }),
      '147 tokens · $0.0004'
    );
    // No total_tokens: falls back to prompt+completion.
    assert.strictEqual(m.formatTurnMeta({ prompt_tokens: 10, completion_tokens: 5, cost: 1 }), '15 tokens · $1.00');
    // Cost only, no token fields at all.
    assert.strictEqual(m.formatTurnMeta({ cost: 0.02 }), '$0.0200');
    // Tokens only, no cost.
    assert.strictEqual(m.formatTurnMeta({ total_tokens: 50 }), '50 tokens');
    // Nothing usable at all — never a fabricated "0 tokens · $0.00".
    assert.strictEqual(m.formatTurnMeta({}), '');
    assert.strictEqual(m.formatTurnMeta(null), '');
    assert.strictEqual(m.formatTurnMeta(undefined), '');
  });

  test('formatTabTotal: the ticket\'s own literal template, applied as-is', () => {
    const { exports: m } = loadClient();
    assert.strictEqual(m.formatTabTotal(0, 0), '0 check-ins · $0.00 this tab');
    assert.strictEqual(m.formatTabTotal(1, 0.00042), '1 check-in · $0.0004 this tab');
    assert.strictEqual(m.formatTabTotal(5, 1.2), '5 check-ins · $1.20 this tab');
  });
});

// ─── Source-text pins (constraints that are cheap to grep and load-bearing) ─

describe('flight-companion.js — source-text constraints', () => {
  test('the SSE reader uses raw fetch, never window.api() — window.api() parses JSON and would break streaming', () => {
    const start = CLIENT_CODE_ONLY.indexOf('function sendTurn(');
    const end = CLIENT_CODE_ONLY.indexOf('function readSSEStream(', start);
    assert.ok(start > -1 && end > start, 'expected to find sendTurn\'s own body');
    const body = CLIENT_CODE_ONLY.slice(start, end);
    assert.match(body, /fetch\(/);
    assert.doesNotMatch(body, /window\.api\(/);
  });

  test('proposal prompt text is rendered via textContent only, never an html: sink', () => {
    assert.match(CLIENT_SRC, /promptEl\.textContent\s*=\s*proposal\.prompt/);
    assert.doesNotMatch(CLIENT_SRC, /innerHTML\s*=[^;]*proposal\.prompt/);
    assert.doesNotMatch(CLIENT_SRC, /html:\s*proposal\.prompt/);
  });

  test('no /api/dashboard/* polling from any companion client path', () => {
    assert.doesNotMatch(CLIENT_SRC, /(fetch|axios|http|url|path)\s*\(\s*[`'"][^`'"]*\/api\/dashboard/i);
    assert.doesNotMatch(CLIENT_SRC, /[`'"]\/api\/dashboard\/[a-z-]+[`'"]/);
  });

  test('visibility gating uses document.hidden, never document.visibilityState', () => {
    assert.match(CLIENT_CODE_ONLY, /document\.hidden/);
    assert.doesNotMatch(CLIENT_CODE_ONLY, /document\.visibilityState/);
  });

  test('dismiss is structurally client-only — no fetch/api call anywhere near the dismiss handler', () => {
    const start = CLIENT_SRC.indexOf("dismissBtn.addEventListener('click'");
    const end = CLIENT_SRC.indexOf('});', start);
    const body = CLIENT_SRC.slice(start, end);
    assert.doesNotMatch(body, /fetch\(|window\.api\(/);
  });
});

// ─── Cadence scheduling (real timers, mocked) ───────────────────────────────

describe('flight-companion.js — cadence: base interval, doubling, cap, reset, visibility floor', () => {
  test('base interval: no call before 30s, one call at 30s', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { exports: m, fetchCalls } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    t.mock.timers.tick(29999);
    assert.strictEqual(fetchCalls.length, 0);
    t.mock.timers.tick(1);
    assert.strictEqual(fetchCalls.length, 1);
  });

  test('doubling: three consecutive "nothing to report" outcomes double the delay 30→60→120→180(capped)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { exports: m, fetchCalls } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'floor' }),
    });
    t.mock.timers.tick(30000);
    await flush();
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(m.getCadenceState().delayMs, 60000);

    t.mock.timers.tick(60000);
    await flush();
    assert.strictEqual(fetchCalls.length, 2);
    assert.strictEqual(m.getCadenceState().delayMs, 120000);

    t.mock.timers.tick(120000);
    await flush();
    assert.strictEqual(fetchCalls.length, 3);
    assert.strictEqual(m.getCadenceState().delayMs, 180000, 'capped at 180s, not 240s');
  });

  test('180s cap: a long virtual run never schedules a gap longer than 180s', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { exports: m, fetchCalls } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'floor' }),
    });
    for (let i = 0; i < 6; i++) {
      t.mock.timers.tick(m.getCadenceState().delayMs);
      await flush();
    }
    assert.strictEqual(m.getCadenceState().delayMs, 180000);
    assert.ok(fetchCalls.length >= 5);
  });

  test('reset on user turn: saturate the backoff, then a completed user send resets the NEXT auto-wake firing to send+30s', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let respondUserWithDone = false;
    const { exports: m, fetchCalls, questionInput } = loadClient({
      fetchImpl: (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.message) { respondUserWithDone = true; return sseResponse([sseFrame('done', {})]); }
        return jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'floor' });
      },
    });
    // Saturate to 180s.
    for (let i = 0; i < 4; i++) { t.mock.timers.tick(m.getCadenceState().delayMs); await flush(); }
    assert.strictEqual(m.getCadenceState().delayMs, 180000);
    const callsBeforeSend = fetchCalls.length;

    questionInput.value = 'status please';
    m.submitQuestion();
    await flush();
    assert.ok(respondUserWithDone);
    assert.strictEqual(m.getCadenceState().delayMs, 30000, 'a completed user turn resets to the 30s base');

    // The pending auto-wake timer must now fire at send+30s, not the old
    // (much longer) previously-scheduled delay.
    t.mock.timers.tick(29999);
    assert.strictEqual(fetchCalls.length, callsBeforeSend + 1, 'still just the user turn — no auto-wake yet');
    t.mock.timers.tick(1);
    assert.strictEqual(fetchCalls.length, callsBeforeSend + 2, 'auto-wake fires exactly at send+30s');
  });

  test('reset on surfaced result: surface:true resets to 30s; surface:false renders/records but keeps doubling', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { exports: m, fetchCalls } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'hi' }), sseFrame('done', { surface: false })]),
    });
    t.mock.timers.tick(30000);
    await flush();
    assert.strictEqual(m.getCadenceState().delayMs, 60000, 'surface:false must still double');
    assert.strictEqual(fetchCalls.length, 1);

    const { exports: m2, fetchCalls: fetchCalls2 } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'hi' }), sseFrame('done', { surface: true })]),
    });
    t.mock.timers.tick(30000);
    await flush();
    assert.strictEqual(m2.getCadenceState().delayMs, 30000, 'surface:true must reset to the 30s base');
  });

  test('30s floor: a burst of resets never schedules two auto-wake calls less than 30s apart', (t) => {
    const { exports: m } = loadClient();
    let s = { delayMs: 30000, stopped: false };
    for (let i = 0; i < 10; i++) {
      s = m.advanceCadence(s, i % 2 === 0 ? 'reset' : 'double');
      assert.ok(s.delayMs >= 30000);
    }
  });

  test('hidden→visible mid-floor: no call fires while hidden, and regaining visibility does not fire an eager call', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { exports: m, fetchCalls, doc } = loadClient({ hiddenInitial: false });
    // Go hidden before the first scheduled tick fires.
    doc.hidden = true;
    doc.dispatch('visibilitychange');
    t.mock.timers.tick(30000);
    await flush();
    assert.strictEqual(fetchCalls.length, 0, 'no call may fire while hidden');

    doc.hidden = false;
    doc.dispatch('visibilitychange');
    await flush();
    assert.strictEqual(fetchCalls.length, 0, 'regaining visibility must not fire an EAGER call');

    t.mock.timers.tick(29999);
    assert.strictEqual(fetchCalls.length, 0);
    t.mock.timers.tick(1);
    assert.strictEqual(fetchCalls.length, 1, 'the resumed countdown fires at its own full delay, not immediately');
  });
});

describe('flight-companion.js — LIN-2621: the strip\'s "next check-in due" mount', () => {
  test('formatNextCheckIn renders the wall-clock time the countdown ENDS at, not a duration', () => {
    const { exports: m } = loadClient({});
    const now = new Date('2026-09-05T12:00:00.000Z').getTime();
    const got = m.formatNextCheckIn(90000, now);
    const expectedDue = new Date(now + 90000);
    const expected = 'next check-in: ' + expectedDue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    assert.strictEqual(got, expected);
  });

  test('the mount updates as soon as the module arms its first countdown (tab visible at load)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { stripNextEl } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    assert.match(stripNextEl.textContent, /^next check-in: (?!—)/, 'expected a real predicted time, not the server-rendered placeholder');
  });

  test('the mount stays at the placeholder while the tab starts hidden — nothing is scheduled yet', () => {
    const { stripNextEl } = loadClient({ hiddenInitial: true });
    assert.strictEqual(stripNextEl.textContent, 'next check-in: —');
  });

  test('the mount reads the placeholder again once the cadence stops (e.g. a session expiry)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { exports: m, stripNextEl } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    assert.doesNotMatch(stripNextEl.textContent, /—$/);
    m.applyCadenceEffect('stop');
    assert.strictEqual(stripNextEl.textContent, 'next check-in: —');
  });

  test('a doubling effect re-arms the timer, which re-runs the SAME display-update wiring scheduleAutoWake owns', async (t) => {
    // Not a display-string assertion (formatNextCheckIn's minute-granularity
    // display can genuinely coincide for two predictions seconds apart — real
    // wall-clock `Date.now()` under mock timers, not a virtual clock — so
    // this asserts on the value the wiring actually depends on: the cadence
    // delay driving the NEXT scheduleAutoWake call, already exercised end to
    // end by the 'doubling' test above. This test only pins that the mount
    // is still non-placeholder immediately after a reschedule.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { exports: m, stripNextEl } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'floor' }),
    });
    t.mock.timers.tick(30000); // fires the base-interval tick, which doubles the cadence and reschedules
    await flush();
    assert.strictEqual(m.getCadenceState().delayMs, 60000);
    assert.match(stripNextEl.textContent, /^next check-in: (?!—)/);
  });
});

describe('flight-companion.js — single-flight guard (client overlap)', () => {
  test('a hanging auto-wake fetch blocks further auto-wake calls across several intervals; resolving lets the next one through one interval later', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let resolveFetch;
    let callCount = 0;
    const { exports: m, fetchCalls } = loadClient({
      fetchImpl: () => {
        callCount += 1;
        if (callCount === 1) return new Promise((resolve) => { resolveFetch = resolve; });
        return jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'floor' });
      },
    });
    t.mock.timers.tick(30000);
    await flush();
    assert.strictEqual(fetchCalls.length, 1);

    // Advance 2-3 more intervals while the first call is still hanging.
    t.mock.timers.tick(30000);
    await flush();
    t.mock.timers.tick(30000);
    await flush();
    t.mock.timers.tick(30000);
    await flush();
    assert.strictEqual(fetchCalls.length, 1, 'no second request while the first is still in flight');

    resolveFetch(jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }));
    await flush();
    // The next call is scheduled one interval later, not immediately.
    assert.strictEqual(fetchCalls.length, 1);
    t.mock.timers.tick(m.getCadenceState().delayMs);
    await flush();
    assert.strictEqual(fetchCalls.length, 2);
  });

  test('a user send during an in-flight auto-wake is blocked (composer disabled) until it resolves', async () => {
    let resolveFetch;
    const { exports: m, fetchCalls, questionInput, sendBtn } = loadClient({
      fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
    });
    questionInput.value = 'hello';
    m.submitQuestion();
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(sendBtn.disabled, true, 'composer must be disabled while a turn is in flight');
    await flush(); // let the fetch spy's deferred responder assign resolveFetch

    questionInput.value = 'a second message';
    m.submitQuestion();
    assert.strictEqual(fetchCalls.length, 1, 'a second submit while inFlight must be a no-op');

    resolveFetch(sseResponse([sseFrame('done', {})]));
    await flush();
    assert.strictEqual(sendBtn.disabled, false);
  });

  test('N1: a pending auto-wake timer firing while a user turn is in flight makes no overlapping request', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let resolveUserFetch;
    const { exports: m, fetchCalls, questionInput } = loadClient({
      fetchImpl: (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.message) return new Promise((resolve) => { resolveUserFetch = resolve; });
        return jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' });
      },
    });

    // User sends at t=10s, well before the initial auto-wake timer (scheduled
    // for t=30s at load) is due.
    t.mock.timers.tick(10000);
    await flush();
    questionInput.value = 'status please';
    m.submitQuestion();
    assert.strictEqual(fetchCalls.length, 1, 'the user turn is the only call so far');

    // Advance to t=30s: the pending auto-wake timer fires while the user
    // turn is still in flight. The `inFlight` guard in autoWakeTick must
    // retry later rather than stacking a second concurrent request — the
    // case the single-flight guard actually protects (deleting it, M9 in
    // the LIN-2435 review, left the pre-existing overlap test green because
    // no second timer exists while a call is in flight under this chained-
    // timeout design; this is the witness that was missing).
    t.mock.timers.tick(20000);
    await flush();
    assert.strictEqual(fetchCalls.length, 1, 'no overlapping auto-wake request while the user turn is in flight');

    resolveUserFetch(sseResponse([sseFrame('done', {})]));
    await flush();
  });
});

describe('flight-companion.js — LIN-2718: composer busy/focus split by turn kind', () => {
  test('a user-initiated turn locks the composer while streaming, and releases it on completion', async () => {
    let resolveFetch;
    const { exports: m, questionInput, sendBtn, startBtn, reorientBtn } = loadClient({
      fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
    });
    questionInput.value = 'hello';
    m.submitQuestion();
    assert.strictEqual(questionInput.disabled, true, 'the composer locks synchronously, before the fetch even resolves');
    assert.strictEqual(sendBtn.disabled, true);
    assert.strictEqual(startBtn.disabled, true);
    assert.strictEqual(reorientBtn.disabled, true);
    await flush(); // let the fetch spy's deferred responder assign resolveFetch

    resolveFetch(sseResponse([sseFrame('done', {})]));
    await flush();
    assert.strictEqual(questionInput.disabled, false, 'released once the user turn completes');
    assert.strictEqual(sendBtn.disabled, false);
  });

  test('a boot turn locks and releases the composer, but never restores focus on completion', async () => {
    const { exports: m, doc, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    doc.activeElement = questionInput;
    m.startBoot();
    assert.strictEqual(questionInput.disabled, true, 'a boot turn locks the composer, same as a user-initiated one');
    await flush();
    assert.strictEqual(questionInput.disabled, false, 'released once the boot turn completes');
    assert.strictEqual(questionInput._focusCallCount, 0, 'a boot never restores focus, even though the input held it at turn start');
  });

  test('an auto-wake turn never touches the composer\'s disabled state, on a clean silent done', async () => {
    const { exports: m, questionInput, sendBtn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    assert.strictEqual(questionInput.disabled, false, 'no lock on the way in');
    assert.strictEqual(questionInput._disabledWriteCount, 0, 'no write to .disabled at all — not true, not even a no-op false');
    await flush();
    assert.strictEqual(questionInput.disabled, false, 'no lock on the way out either');
    assert.strictEqual(questionInput._disabledWriteCount, 0);
    assert.strictEqual(sendBtn._disabledWriteCount, 0, 'the same holds for every element setComposerBusy would otherwise touch');
  });

  test('an auto-wake turn never touches the composer\'s disabled state on a mid-stream SSE error', async () => {
    const { exports: m, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('error', { message: 'boom' })]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(questionInput._disabledWriteCount, 0);
    assert.strictEqual(questionInput.disabled, false);
  });

  test('an auto-wake turn never touches the composer\'s disabled state on a network failure', async () => {
    const { exports: m, questionInput } = loadClient({
      fetchImpl: () => Promise.reject(new Error('network down')),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(questionInput._disabledWriteCount, 0);
    assert.strictEqual(questionInput.disabled, false);
  });

  test('focus is restored after a user-initiated turn when the input held focus at turn start', async () => {
    const { exports: m, doc, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    doc.activeElement = questionInput;
    questionInput.value = 'hello';
    m.submitQuestion();
    await flush();
    assert.strictEqual(doc.activeElement, questionInput, 'focus restored: the input had it when the turn began');
    assert.strictEqual(questionInput._focusCallCount, 1);
  });

  test('focus is NOT restored after a user-initiated turn when the input did not hold focus at turn start', async () => {
    const { exports: m, doc, questionInput, sendBtn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    doc.activeElement = sendBtn; // something else had focus (e.g. the Send button, on click)
    questionInput.value = 'hello';
    m.submitQuestion();
    await flush();
    assert.strictEqual(questionInput._focusCallCount, 0, 'must not steal focus onto the input if it did not already have it');
  });

  test('the inFlight guard still rejects a second concurrent turn during an in-flight auto-wake tick, even though the composer is left enabled', async () => {
    let resolveFetch;
    const { exports: m, fetchCalls, questionInput } = loadClient({
      fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
    });
    m.autoWakeTick();
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(questionInput.disabled, false, 'exclusion must not be expressed by disabling the input');

    questionInput.value = 'a message typed during the tick';
    m.submitQuestion();
    assert.strictEqual(fetchCalls.length, 1, 'inFlight rejects the concurrent user submit before it ever reaches fetch');

    await flush(); // let the fetch spy's deferred responder assign resolveFetch
    resolveFetch(sseResponse([sseFrame('done', {})]));
    await flush();
  });
});

describe('flight-companion.js — cadence resiliency across a hidden/visible transition mid-turn (LIN-2435 review B1)', () => {
  test('a user-initiated failure that spans a hidden→visible transition mid-turn does not stall the cadence', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let rejectUserFetch;
    const { exports: m, fetchCalls, questionInput, doc } = loadClient({
      fetchImpl: (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.message) return new Promise((_resolve, reject) => { rejectUserFetch = reject; });
        return jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' });
      },
    });

    // A user turn goes in flight (the pending auto-wake timer, scheduled at
    // load for t=30s, is still armed).
    questionInput.value = 'status please';
    m.submitQuestion();
    await flush();
    assert.strictEqual(fetchCalls.length, 1);

    // The tab goes hidden, then the pending auto-wake timer fires while
    // hidden — autoWakeTick nulls timerId and bails on document.hidden
    // before ever reaching the inFlight check.
    doc.hidden = true;
    doc.dispatch('visibilitychange');
    t.mock.timers.tick(30000);
    await flush();
    assert.strictEqual(fetchCalls.length, 1, 'the hidden auto-wake tick must not fire a request');

    // The tab regains visibility while the user turn is STILL in flight —
    // onVisibilityChange's `!inFlight` clause bails, so nothing reschedules
    // here either.
    doc.hidden = false;
    doc.dispatch('visibilitychange');
    await flush();

    // The user turn now fails on a plain user-initiated failure branch
    // (network failure here; any of network/500/mid-stream-error/400/429
    // reach the same no-cadence-effect finishTurn() path).
    rejectUserFetch(new Error('network down'));
    await flush();
    assert.strictEqual(m.getCadenceState().stopped, false, 'a user-turn failure must not stop the cadence');

    // Without a reschedule here the companion would never check in again
    // short of a reload — assert the cadence actually resumes at its
    // current delay (30s; no cadence effect was ever applied on this path).
    t.mock.timers.tick(29999);
    assert.strictEqual(fetchCalls.length, 1, 'auto-wake not due yet');
    t.mock.timers.tick(1);
    await flush();
    assert.strictEqual(fetchCalls.length, 2, 'auto-wake resumes once the stalled sequence completes');
  });
});

// ─── History ─────────────────────────────────────────────────────────────

describe('flight-companion.js — conversation history', () => {
  test('body.history is sent on every turn, including auto-wake, and is non-empty once a prior turn exists', async () => {
    const { exports: m, fetchCalls } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'ok' }), sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    assert.ok(Array.isArray(fetchCalls[0].body.history));
    assert.strictEqual(fetchCalls[0].body.history.length, 0);

    m.autoWakeTick();
    await flush();
    assert.ok(fetchCalls[1].body.history.length > 0, 'the second turn must carry the first turn\'s own history');
  });

  test('an auto-wake done pushes only an assistant entry — no synthetic user entry', async () => {
    const { exports: m } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'all quiet' }), sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    looseDeepEqual(m.getChatHistory(), [{ role: 'assistant', content: 'all quiet' }]);
  });

  test('a user-initiated turn pushes both a user entry and an assistant entry, in order', async () => {
    const { exports: m, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'ack' }), sseFrame('done', {})]),
    });
    questionInput.value = 'status please';
    m.submitQuestion();
    await flush();
    looseDeepEqual(m.getChatHistory(), [
      { role: 'user', content: 'status please' },
      { role: 'assistant', content: 'ack' },
    ]);
  });

  test('the empty-done guard: an empty answer is never pushed to history (task-chat.js\'s own pattern)', async () => {
    // The history claim is unchanged. Its DOM witness moved to the AC1/AC2
    // divergence pair below (auto-wake -> zero rows; user-initiated ->
    // exactly one row), which is strictly stronger than the `/no response/`
    // assertion it replaces — that literal is deliberately deleted by
    // LIN-2443 AC1/AC2.
    const { exports: m } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    looseDeepEqual(m.getChatHistory(), []);
  });

  test('history cap: pushing 45 turns worth never exceeds 40 entries', () => {
    const { exports: m } = loadClient();
    const history = m.getChatHistory();
    for (let i = 0; i < 45; i++) { history.push({ role: 'assistant', content: String(i) }); m.capHistory(history); }
    assert.strictEqual(history.length, 40);
  });
});

// ─── Stream render lifecycle (LIN-2443) ─────────────────────────────────

describe('flight-companion.js — LIN-2443 stream render lifecycle', () => {
  test('AC1: a silent auto-wake done appends ZERO rows, leaves history empty, and shows the check-in line', async () => {
    const { exports: m, thread, checkIn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(thread.children.length, 0, 'a silent tick must never paint a row');
    looseDeepEqual(m.getChatHistory(), []);
    assert.strictEqual(checkIn.hidden, false, 'the check-in line must be revealed');
    assert.match(checkIn.textContent, /^checked in .+ \u00b7 nothing new$/);
  });

  test('AC2: an empty USER-initiated done appends exactly one assistant row with an honest no-reply sentence, still not in history', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    questionInput.value = 'anything to report?';
    m.submitQuestion();
    await flush();
    // one user bubble + one assistant bubble
    assert.strictEqual(thread.children.length, 2, 'the human asked and deserves exactly one answer row');
    const answerLi = thread.children[1];
    assert.strictEqual(answerLi.querySelector('.fc-msg-body').textContent, 'no reply \u2014 nothing to add');
    assert.doesNotMatch(answerLi.querySelector('.fc-msg-body').textContent, /no response/, 'the bracket-code literal is deleted');
    looseDeepEqual(m.getChatHistory(), [{ role: 'user', content: 'anything to report?' }],
      'the display-only no-reply sentence must never be pushed to history');
  });

  // LIN-2632 beat 2 narrows this: AC3's real invariant is "no empty assistant
  // BUBBLE for a tool-only tick" — it predates tool breadcrumbs existing at
  // all, back when 'call'/'result' rendered nothing whatsoever. Now that they
  // render a breadcrumb note (the fix for "it doesn't appear to use tools?"),
  // the thread is no longer empty on a tool-only tick, but it still must
  // never contain an assistant bubble (chat-msg / ChatUI.appendMessage).
  test('AC3: an auto-wake tick emitting only tool call/result frames appends breadcrumbs but never an assistant bubble', async () => {
    const { exports: m, thread, chatUICalls } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'call', id: '1', name: 'get_stack' }),
        sseFrame('tool', { phase: 'result', id: '1', name: 'get_stack', result: '{}' }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(chatUICalls.appendMessage.length, 0, 'no bubble may be created for a tool-only turn');
    assert.strictEqual(chatUICalls.appendNote.length, 1, 'the call breadcrumb renders (settled by the result, not a second note)');
    assert.ok(thread.children.every(li => !li.className.includes('chat-msg')), 'every row is a note, never a bubble');
  });

  test('AC3 preservation: a `proposed` event on a text-free turn still renders a wired Approve/Dismiss card (null-beforeLi fallback)', async () => {
    const proposal = { proposed: true, sessionId: 'sess-1', prompt: 'go do the thing' };
    const { exports: m, thread, apiCalls } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { id: 'c1', name: 'send_follow_up', phase: 'proposed', result: JSON.stringify(proposal) }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(thread.children.length, 1, 'the card is appended at thread level, with no bubble beside it');
    const wrap = thread.children[0].querySelector('.fc-proposal');
    assert.ok(wrap, 'expected the proposal control to render');
    assert.strictEqual(wrap.querySelector('.fc-proposal-text').textContent, 'go do the thing');
    wrap.querySelector('.fc-proposal-dismiss').dispatch('click');
    assert.strictEqual(apiCalls.length, 0);
    assert.ok(wrap.classList.contains('fc-proposal--resolved'), 'Approve/Dismiss must still be wired');
  });

  test('AC4: the pill leaves in-progress on done (\u2713) and on error (\u2715)', async () => {
    const done = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'all quiet' }), sseFrame('done', { surface: true })]),
    });
    done.exports.autoWakeTick();
    await flush();
    let pill = done.thread.children[0].querySelector('.chat-msg__who');
    assert.ok(!pill.classList.contains('status-pill--in-progress'), 'the amber in-progress state must not persist');
    assert.ok(pill.classList.contains('status-pill--done'));
    assert.strictEqual(pill.querySelector('.status-pill__char').textContent, '\u2713');

    const failed = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'partial' }), sseFrame('error', { message: 'boom' })]),
    });
    failed.exports.autoWakeTick();
    await flush();
    pill = failed.thread.children[0].querySelector('.chat-msg__who');
    assert.ok(!pill.classList.contains('status-pill--in-progress'));
    assert.ok(pill.classList.contains('status-pill--failed'));
    assert.strictEqual(pill.querySelector('.status-pill__char').textContent, '\u2715');
  });

  test('AC4: an error on a text-free turn still creates a bubble — a failure is never silent', async () => {
    const { thread, exports: m } = loadClient({ fetchImpl: () => sseResponse([sseFrame('error', { message: 'boom' })]) });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(thread.children.length, 1, 'an error frame must surface a row even with no text');
    assert.match(thread.children[0].querySelector('.fc-msg-body').textContent, /\[error: boom\]/);
  });

  test('AC1 non-stacking: two consecutive silent ticks update the SAME status node and still append no rows', async () => {
    const { exports: m, thread, checkIn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    const firstNode = checkIn;
    const firstText = checkIn.textContent;
    assert.ok(firstText.length > 0);

    m.autoWakeTick();
    await flush();
    assert.strictEqual(checkIn, firstNode, 'the status line must be one node, overwritten — never a second row');
    assert.strictEqual(checkIn.children.length, 0, 'the status line is textContent-only; nothing is ever appended to it');
    assert.match(checkIn.textContent, /nothing new$/);
    assert.strictEqual(thread.children.length, 0, 'consecutive silent ticks never append rows');
  });

  test('a gate-silent tick also refreshes the check-in line (and still appends no row)', async () => {
    const { exports: m, thread, checkIn, chatUICalls } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'hash-identical' }),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(checkIn.hidden, false);
    assert.match(checkIn.textContent, /nothing new$/);
    assert.strictEqual(thread.children.length, 0);
    assert.strictEqual(chatUICalls.appendNote.length, 0, 'gate-silent stays silent in the thread');
  });

  test('formatCheckIn is pure — same clock in, exact string out', () => {
    const { exports: m } = loadClient();
    const at = new Date('2026-09-01T22:03:00Z');
    const expected = 'checked in ' + at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' \u00b7 nothing new';
    assert.strictEqual(m.formatCheckIn(at), expected);
    assert.strictEqual(m.formatCheckIn(at), m.formatCheckIn(at), 'pure: repeated calls agree');
  });

  test('a streamed answer still paints, records history and keeps the cursor discipline (the non-empty path is unchanged)', async () => {
    const { exports: m, thread } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('token', { token: 'all ' }),
        sseFrame('token', { token: 'quiet' }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(thread.children.length, 1);
    const body = thread.children[0].querySelector('.fc-msg-body');
    assert.strictEqual(body.textContent, 'all quiet');
    assert.ok(!body.classList.contains('chat-cursor'), 'the streaming cursor is cleared on done');
    looseDeepEqual(m.getChatHistory(), [{ role: 'assistant', content: 'all quiet' }]);
  });
});

describe('flight-companion.js — LIN-2621 beat 3: per-turn cost + the running "this tab so far" total', () => {
  test('a visible (user-initiated) turn with usage on done renders its own meta line inside the bubble', async () => {
    const usage = { prompt_tokens: 100, completion_tokens: 47, total_tokens: 147, cost: 0.00042 };
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'hi' }), sseFrame('done', { usage })]),
    });
    questionInput.value = 'are you there?';
    m.submitQuestion();
    await flush();

    // user bubble + assistant bubble
    assert.strictEqual(thread.children.length, 2);
    const answerLi = thread.children[1];
    const meta = answerLi.querySelector('.fc-msg-meta');
    assert.ok(meta, 'expected a .fc-msg-meta node inside the answer bubble');
    assert.strictEqual(meta.textContent, '147 tokens · $0.0004');
  });

  test('a visible turn with NO usage on done renders no meta line at all', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'hi' }), sseFrame('done', {})]),
    });
    questionInput.value = 'are you there?';
    m.submitQuestion();
    await flush();
    const answerLi = thread.children[1];
    assert.strictEqual(answerLi.querySelector('.fc-msg-meta'), null);
  });

  // AC2's own empty-reply bubble is still a visible turn — it gets a meta
  // line too, same as any other bubble-bearing done (answerLi is set either
  // way; the gate is bubble existence, not answerText).
  test('AC2\'s empty-reply bubble also renders a meta line when usage is present', async () => {
    const usage = { total_tokens: 12, cost: 0.0001 };
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { usage })]),
    });
    questionInput.value = 'anything to report?';
    m.submitQuestion();
    await flush();
    const answerLi = thread.children[1];
    assert.strictEqual(answerLi.querySelector('.fc-msg-body').textContent, 'no reply — nothing to add');
    assert.strictEqual(answerLi.querySelector('.fc-msg-meta').textContent, '12 tokens · $0.0001');
  });

  test('AC1 unchanged: a silent auto-wake tick with usage paints no bubble and no meta line — the running total is the ONLY other effect', async () => {
    const usage = { total_tokens: 210, cost: 0.0009 };
    const { exports: m, thread, checkIn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { usage })]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(thread.children.length, 0, 'a silent tick must never paint a row (AC1)');
    assert.match(checkIn.textContent, /nothing new$/, 'AC1\'s own check-in line is unaffected');
    looseDeepEqual(m.getTabTotals(), { count: 1, cost: 0.0009 });
  });

  test('the running total sums EVERY done frame — visible and silent, any turn kind — and the check-in count matches', async () => {
    const { exports: m, questionInput } = loadClient({
      fetchImpl: (url, opts) => {
        const body = JSON.parse(opts.body);
        return body.message
          ? sseResponse([sseFrame('done', { usage: { total_tokens: 10, cost: 0.001 } })])
          : sseResponse([sseFrame('done', { usage: { total_tokens: 20, cost: 0.002 } })]);
      },
    });
    looseDeepEqual(m.getTabTotals(), { count: 0, cost: 0 }, 'a fresh tab starts at zero');

    // A silent auto-wake tick.
    m.autoWakeTick();
    await flush();
    looseDeepEqual(m.getTabTotals(), { count: 1, cost: 0.002 });

    // A visible, user-initiated turn.
    questionInput.value = 'hi';
    m.submitQuestion();
    await flush();
    looseDeepEqual(m.getTabTotals(), { count: 2, cost: 0.003 });
  });

  test('a done frame with no usage still counts as a check-in (cost contribution is zero)', async () => {
    const { exports: m } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    m.autoWakeTick();
    await flush();
    looseDeepEqual(m.getTabTotals(), { count: 1, cost: 0 });
  });

  test('a gate-silent (non-stream) refusal — no model call at all — does NOT count as a check-in', async () => {
    const { exports: m } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    m.autoWakeTick();
    await flush();
    looseDeepEqual(m.getTabTotals(), { count: 0, cost: 0 }, 'nothing was spent, so nothing is counted');
  });

  test('the strip\'s tab-total mount renders the formatted running total in place', async () => {
    const { exports: m } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { usage: { total_tokens: 5, cost: 0.5 } })]),
    });
    assert.strictEqual(m.getTabTotalText(), '0 check-ins · $0.00 this tab');
    m.autoWakeTick();
    await flush();
    assert.strictEqual(m.getTabTotalText(), '1 check-in · $0.5000 this tab');
  });
});

describe('flight-companion.js — LIN-2670: done-frame Markdown swap, in place', () => {
  test('renders Markdown IN PLACE — the same element/li instance before and after the done frame — and the .fc-msg-meta line survives it', async () => {
    const usage = { total_tokens: 5, cost: 0.001 };
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: '**hi**' }), sseFrame('done', { usage })]),
    });
    questionInput.value = 'hello';
    m.submitQuestion();

    // ensureAssistantBubble() runs synchronously, before the fetch even goes
    // out (public/flight-companion.js's own comment on sendTurn) — so the
    // bubble already exists here, before any SSE frame has been processed.
    const answerLiBeforeDone = thread.children[1];
    const answerElBeforeDone = answerLiBeforeDone.querySelector('.fc-msg-body');
    assert.ok(answerElBeforeDone, 'expected the assistant bubble to exist eagerly');

    await flush();

    const answerLiAfterDone = thread.children[1];
    const answerElAfterDone = answerLiAfterDone.querySelector('.fc-msg-body');
    // Finding 3's crisp proof of "in place": the identical object, not a
    // same-shaped replacement.
    assert.strictEqual(answerElAfterDone, answerElBeforeDone, 'the SAME element must be updated in place — never replaced');
    assert.strictEqual(answerLiAfterDone, answerLiBeforeDone, 'the surrounding <li> is untouched too');

    // The finding-1 opt-out (keepWholeFence=true) and the shared class.
    assert.ok(answerElAfterDone.classList.contains('chat-md'));
    assert.strictEqual(answerElAfterDone.innerHTML, '<p data-rendered="true">**hi**</p>');

    // Meta survival (finding 3): appendTurnMeta early-returns on
    // !answerEl.parentNode and appends .fc-msg-meta as a SIBLING — in-place
    // update leaves parentNode untouched, so it must still be there.
    const meta = answerLiAfterDone.querySelector('.fc-msg-meta');
    assert.ok(meta, 'expected the .fc-msg-meta line to survive the in-place swap');
    assert.strictEqual(meta.textContent, '5 tokens · $0.0010');

    // Raw Markdown — not the rendered HTML — is what reaches chatHistory.
    // looseDeepEqual (not assert.deepEqual/strict): getChatHistory() returns
    // objects built inside the vm sandbox, a distinct realm whose Object
    // prototype differs from this file's — strict deepEqual would fail on
    // that alone even when every own property matches (same reasoning as
    // this file's other chatHistory assertions above).
    looseDeepEqual(m.getChatHistory(), [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '**hi**' },
    ]);
  });

  test('the mid-stream error path keeps textContent and never gains chat-md', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: '**partial**' }), sseFrame('error', { message: 'boom' })]),
    });
    questionInput.value = 'hello';
    m.submitQuestion();
    await flush();

    const answerEl = thread.children[1].querySelector('.fc-msg-body');
    assert.strictEqual(answerEl.textContent, '**partial**\n[error: boom]');
    assert.strictEqual(answerEl.innerHTML, null, 'the error path must never assign innerHTML');
    assert.ok(!answerEl.classList.contains('chat-md'));
  });

  test('AC2\'s "no reply" empty-answer path keeps textContent and never gains chat-md', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    questionInput.value = 'anything to report?';
    m.submitQuestion();
    await flush();

    const answerEl = thread.children[1].querySelector('.fc-msg-body');
    assert.strictEqual(answerEl.textContent, 'no reply — nothing to add');
    assert.strictEqual(answerEl.innerHTML, null, 'the no-reply path must never assign innerHTML');
    assert.ok(!answerEl.classList.contains('chat-md'));
  });
});

// ─── The thinking state + "checking in…" status line (LIN-2632 beat 3) ─────

describe('flight-companion.js — the thinking state (typed turns) and "checking in…" (auto-wake)', () => {
  test('a typed turn shows the thinking row immediately, in-progress, before any network response', () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => new Promise(() => {}), // never resolves — this checks the pre-response state only
    });
    questionInput.value = 'status please';
    m.submitQuestion();
    // Synchronous — no flush(). sendTurn creates the row before the fetch
    // even goes out, so this must already be true.
    assert.strictEqual(thread.children.length, 2, 'user bubble + the immediate assistant thinking row');
    const answerLi = thread.children[1];
    assert.strictEqual(answerLi.querySelector('.fc-msg-body').textContent, 'thinking…');
    const pill = answerLi.querySelector('.chat-msg__who');
    assert.ok(pill.classList.contains('status-pill--in-progress'), 'the pill starts in-progress, same as the existing vocabulary');
  });

  test('the first token replaces the thinking placeholder outright — never concatenated after it', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'ack' }), sseFrame('done', {})]),
    });
    questionInput.value = 'status please';
    m.submitQuestion();
    assert.strictEqual(thread.children[1].querySelector('.fc-msg-body').textContent, 'thinking…', 'pre-token state');
    await flush();
    assert.strictEqual(thread.children.length, 2, 'still exactly one assistant row — ensureAssistantBubble is idempotent');
    assert.strictEqual(thread.children[1].querySelector('.fc-msg-body').textContent, 'ack', 'fully replaced, not "thinking…ack"');
  });

  test('a tool breadcrumb during a hop inserts BEFORE the thinking row, not after it', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'call', id: '1', name: 'get_stack', arguments: {} }),
        sseFrame('token', { token: 'done hop' }),
        sseFrame('done', {}),
      ]),
    });
    questionInput.value = 'status please';
    m.submitQuestion();
    await flush();
    // you -> breadcrumb -> assistant row, in that order.
    assert.strictEqual(thread.children.length, 3);
    assert.ok(thread.children[1].className.includes('fc-inline-note'), 'the breadcrumb lands between the user turn and the answer');
    assert.strictEqual(thread.children[2].querySelector('.fc-msg-body').textContent, 'done hop');
  });

  test('the thinking placeholder never leaks into history — even mid-turn, before any token arrives', () => {
    const { exports: m, questionInput } = loadClient({ fetchImpl: () => new Promise(() => {}) });
    questionInput.value = 'anything?';
    m.submitQuestion();
    looseDeepEqual(m.getChatHistory(), [{ role: 'user', content: 'anything?' }],
      'only the user turn is recorded; the thinking placeholder is display-only');
  });

  test('an empty typed turn still leaves nothing in history, with the thinking row settling into the honest no-reply sentence (AC2 unchanged)', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    questionInput.value = 'anything to report?';
    m.submitQuestion();
    await flush();
    assert.strictEqual(thread.children.length, 2, 'no second row — the thinking row settles in place');
    assert.strictEqual(thread.children[1].querySelector('.fc-msg-body').textContent, 'no reply — nothing to add');
    looseDeepEqual(m.getChatHistory(), [{ role: 'user', content: 'anything to report?' }]);
  });

  // ─── LIN-2632 review F1: settle the eager thinking row on every non-SSE
  // failure exit ────────────────────────────────────────────────────────────
  //
  // `ensureAssistantBubble()` runs EAGERLY for a user-initiated turn (above),
  // before the fetch even goes out. Every in-stream exit (`done`, the empty
  // no-reply case, a mid-stream `error` frame) already settles that row. The
  // independent review on PR #1401 found two exits that leave the stream
  // entirely without ever touching it: `handleNonStreamOutcome` (a gate JSON
  // response, or any non-OK/non-stream HTTP status) and the outer network-
  // failure `.catch`. Both left the row's pill permanently
  // `status-pill--in-progress` with `thinking…` as its final text, and a
  // retry stacked a second one on top rather than replacing the first.

  test('LIN-2632 review F1: a user-initiated turn that fails outside the SSE stream (e.g. a 500 non-JSON response) settles the thinking row to failed, never left stuck in-progress', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => htmlResponse(500),
    });
    questionInput.value = 'what is in flight?';
    m.submitQuestion();
    // Pre-fix (observed red): the assistant row's pill stayed
    // status-pill--in-progress and its text stayed 'thinking…' forever —
    // this is the exact regression the independent review reproduced.
    await flush();
    assert.strictEqual(thread.children.length, 3, 'user bubble + the settled assistant row + the inline failure note');
    const answerLi = thread.children[1];
    const pill = answerLi.querySelector('.chat-msg__who');
    assert.ok(pill.classList.contains('status-pill--failed'), 'the pill must settle to failed, not stay stuck in-progress');
    assert.ok(!pill.classList.contains('status-pill--in-progress'), 'in-progress must be cleared on this exit too');
    assert.notStrictEqual(answerLi.querySelector('.fc-msg-body').textContent, 'thinking…', 'the placeholder text must not survive the failure');
    looseDeepEqual(m.getChatHistory(), [], 'the unanswered turn is dropped from history, same as every other failure path');
  });

  test('LIN-2632 review F1: a network failure (fetch rejects) on a user-initiated turn also settles the thinking row to failed', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => Promise.reject(new Error('network down')),
    });
    questionInput.value = 'what is in flight?';
    m.submitQuestion();
    await flush();
    const answerLi = thread.children[1];
    const pill = answerLi.querySelector('.chat-msg__who');
    assert.ok(pill.classList.contains('status-pill--failed'), 'the pill must settle to failed on a network rejection too');
    assert.ok(!pill.classList.contains('status-pill--in-progress'));
    assert.notStrictEqual(answerLi.querySelector('.fc-msg-body').textContent, 'thinking…');
  });

  test('LIN-2632 review F1: repeated failed turns never leave more than one settled row each — no permanently in-progress rows accumulate across retries', async () => {
    const { exports: m, thread, questionInput } = loadClient({
      fetchImpl: () => htmlResponse(500),
    });
    questionInput.value = 'first attempt';
    m.submitQuestion();
    await flush();
    questionInput.value = 'retry';
    m.submitQuestion();
    await flush();

    const stillInProgress = thread.children.filter((li) => {
      const pill = li.querySelector && li.querySelector('.chat-msg__who');
      return pill && pill.classList.contains('status-pill--in-progress');
    });
    assert.strictEqual(stillInProgress.length, 0, 'no row may still read in-progress/"thinking…" after two failed retries');
  });

  test('LIN-2632 review F1: an auto-wake tick that fails outside the SSE stream still creates no assistant bubble (F1\'s fix is user-initiated only, since ensureAssistantBubble is never called on auto-wake)', async () => {
    const { exports: m, thread, chatUICalls } = loadClient({
      fetchImpl: () => htmlResponse(500),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(chatUICalls.appendMessage.length, 0, 'no assistant bubble is ever created for an auto-wake tick, failed or not');
    assert.strictEqual(thread.children.length, 1, 'only the pre-existing inline failure note — no settled/pending row alongside it');
  });

  test('a silent auto-wake tick still paints no bubble (AC1 unchanged by the thinking-state work)', async () => {
    const { exports: m, thread, chatUICalls } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(chatUICalls.appendMessage.length, 0, 'no assistant bubble is ever created for a silent auto-wake tick');
    assert.strictEqual(thread.children.length, 0);
  });

  test('"checking in…" appears on the status line immediately on an auto-wake tick, before the network round-trip resolves, and clears on done', async () => {
    const { exports: m, checkIn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    // Synchronous — no flush(). Shown before the fetch promise even settles.
    assert.strictEqual(checkIn.hidden, false);
    assert.strictEqual(checkIn.textContent, 'checking in…');
    await flush();
    assert.notStrictEqual(checkIn.textContent, 'checking in…', 'cleared once the tick resolves (AC2 of this beat)');
    assert.match(checkIn.textContent, /^checked in .+ · nothing new$/, 'AC1: settles into the ordinary check-in line');
  });

  test('"checking in…" also clears on a gate-silent (non-stream) auto-wake outcome', async () => {
    const { exports: m, checkIn } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'hash-identical' }),
    });
    m.autoWakeTick();
    assert.strictEqual(checkIn.textContent, 'checking in…');
    await flush();
    assert.match(checkIn.textContent, /^checked in .+ · nothing new$/);
  });

  test('an auto-wake tick that surfaces a real narrated bubble still clears "checking in…" — restored to its prior state, never left stuck', async () => {
    const { exports: m, checkIn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'heads up' }), sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    assert.strictEqual(checkIn.textContent, 'checking in…');
    await flush();
    // This tick never claims anything about "nothing new" (something DID
    // happen — a narrated bubble) — it restores the line to whatever it
    // held before this tick started, which for a fresh page is hidden/empty.
    assert.notStrictEqual(checkIn.textContent, 'checking in…');
    assert.strictEqual(checkIn.hidden, true, 'restored to its pre-tick (never-yet-shown) state');
    assert.strictEqual(checkIn.textContent, '');
  });

  test('"checking in…" also clears (restored) on a mid-stream auto-wake error', async () => {
    const { exports: m, checkIn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('error', { message: 'boom' })]),
    });
    m.autoWakeTick();
    assert.strictEqual(checkIn.textContent, 'checking in…');
    await flush();
    assert.notStrictEqual(checkIn.textContent, 'checking in…');
  });
});

// ─── Tool-wire phases + proposal control ────────────────────────────────

describe('flight-companion.js — tool-wire phases (F5) + the proposal control', () => {
  test('phase: "cap" renders exactly one note, does not throw, and is never mistaken for a proposal', async () => {
    const { exports: m, chatUICalls } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'cap', iteration: 4, maxIterations: 4 }),
        sseFrame('done', { surface: true }),
      ]),
    });
    await assert.doesNotReject(async () => { m.autoWakeTick(); await flush(); });
    const capNotes = chatUICalls.appendNote.filter(c => /tool-call limit/.test(c.text));
    assert.strictEqual(capNotes.length, 1);
  });

  // LIN-2632 beat 2: 'call'/'result'/'error' used to render nothing at all
  // (the bug — "it doesn't appear to use tools?"). Now 'call' renders a
  // pending breadcrumb via the shared window.ChatUI.toolBreadcrumbLabel,
  // 'result' settles it, and 'error' marks it — correlated by the tool
  // event's own `id`.
  test('"call" renders a pending breadcrumb using the shared label helper', async () => {
    const { exports: m, chatUICalls, thread } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'call', id: '1', name: 'get_stack', arguments: {} }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(chatUICalls.appendNote.length, 1);
    assert.equal(chatUICalls.appendNote[0].text, '↳ checked the task stack …');
    const li = thread.children.find(l => l.textContent.includes('checked the task stack'));
    assert.ok(li, 'expected the pending breadcrumb in the thread');
  });

  test('"result" settles the matching "call" breadcrumb in place (no new note), dropping the pending ellipsis', async () => {
    const { exports: m, chatUICalls, thread } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'call', id: '1', name: 'list_task_sessions', arguments: { issueId: 'LIN-9' } }),
        sseFrame('tool', { phase: 'result', id: '1', name: 'list_task_sessions', result: '[]' }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();
    // Settling mutates the existing note in place — it must not append a
    // second one.
    assert.strictEqual(chatUICalls.appendNote.length, 1);
    const li = thread.children.find(l => l.className.includes('fc-inline-note'));
    assert.equal(li.textContent, '↳ checked sessions for LIN-9', 'settled text keeps the call-time specifics and drops the ellipsis');
  });

  test('"error" marks the matching "call" breadcrumb failed, recomputed from the error event', async () => {
    const { exports: m, chatUICalls, thread } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'call', id: '2', name: 'get_session', arguments: { sessionId: 'abc' } }),
        sseFrame('tool', { phase: 'error', id: '2', name: 'get_session', error: 'boom' }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(chatUICalls.appendNote.length, 1);
    const li = thread.children.find(l => l.className.includes('fc-inline-note'));
    assert.equal(li.textContent, '↳ get_session failed: boom');
  });

  test('a result/error with no matching call id is a defensive no-op (never throws, no orphan note)', async () => {
    const { exports: m, chatUICalls } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'result', id: 'orphan', name: 'get_stack', result: '{}' }),
        sseFrame('tool', { phase: 'error', id: 'orphan-2', name: 'get_stack', error: 'x' }),
        sseFrame('done', { surface: true }),
      ]),
    });
    await assert.doesNotReject(async () => { m.autoWakeTick(); await flush(); });
    assert.strictEqual(chatUICalls.appendNote.length, 0);
  });

  test('two concurrent tool calls in one turn settle independently, correlated by id', async () => {
    const { chatUICalls, thread, exports: m } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'call', id: 'a', name: 'get_stack', arguments: {} }),
        sseFrame('tool', { phase: 'call', id: 'b', name: 'get_session', arguments: { sessionId: 'xyz' } }),
        sseFrame('tool', { phase: 'result', id: 'a', name: 'get_stack', result: '{}' }),
        sseFrame('tool', { phase: 'error', id: 'b', name: 'get_session', error: 'timeout' }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(chatUICalls.appendNote.length, 2, 'each call gets exactly one note, settling mutates in place');
    const notes = thread.children.filter(l => l.className.includes('fc-inline-note')).map(l => l.textContent);
    assert.ok(notes.includes('↳ checked the task stack'), 'the "a" breadcrumb settled');
    assert.ok(notes.includes('↳ get_session failed: timeout'), 'the "b" breadcrumb failed independently');
  });

  test('a valid proposal renders Approve/Dismiss; Dismiss is zero-fetch and terminal', async () => {
    const proposal = { proposed: true, sessionId: 'sess-1', prompt: 'go do the thing' };
    const { exports: m, thread, apiCalls } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { id: 'c1', name: 'send_follow_up', phase: 'proposed', result: JSON.stringify(proposal) }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();

    const proposalLi = thread.children.find(li => li.querySelector('.fc-proposal'));
    assert.ok(proposalLi, 'expected a rendered proposal control');
    const wrap = proposalLi.querySelector('.fc-proposal');
    const promptEl = wrap.querySelector('.fc-proposal-text');
    assert.strictEqual(promptEl.textContent, 'go do the thing');
    const dismissBtn = wrap.querySelector('.fc-proposal-dismiss');
    dismissBtn.dispatch('click');
    assert.strictEqual(apiCalls.length, 0, 'dismiss must never call the approve-follow-up endpoint');
    assert.ok(wrap.classList.contains('fc-proposal--resolved'));
  });

  test('Approve: 200 confirms and never re-enables; 404/422 is terminal; 429/500 restores for retry; 403 also stops the cadence', async () => {
    const proposal = { proposed: true, sessionId: 'sess-1', prompt: 'go' };
    function loadWithApprove(apiImpl) {
      return loadClient({
        fetchImpl: () => sseResponse([
          sseFrame('tool', { id: 'c1', name: 'send_follow_up', phase: 'proposed', result: JSON.stringify(proposal) }),
          sseFrame('done', { surface: true }),
        ]),
        apiImpl,
      });
    }
    function approveButton(env) {
      const li = env.thread.children.find(l => l.querySelector('.fc-proposal'));
      return li.querySelector('.fc-proposal').querySelector('.fc-proposal-approve');
    }

    // 200
    let env = loadWithApprove(async () => ({ queued: true, target: 'cli' }));
    env.exports.autoWakeTick();
    await flush();
    let btn = approveButton(env);
    btn.dispatch('click');
    await flush();
    assert.strictEqual(btn.disabled, true);
    assert.match(btn.parentNode.parentNode.querySelector('.fc-proposal-feedback').textContent, /Approved/);

    // 404 terminal
    env = loadWithApprove(async () => { throw Object.assign(new Error('Session x not found'), { status: 404 }); });
    env.exports.autoWakeTick();
    await flush();
    btn = approveButton(env);
    btn.dispatch('click');
    await flush();
    assert.strictEqual(btn.disabled, true, '404 must not offer a retry');

    // 429 restores
    env = loadWithApprove(async () => { throw Object.assign(new Error('Too many'), { status: 429 }); });
    env.exports.autoWakeTick();
    await flush();
    btn = approveButton(env);
    btn.dispatch('click');
    await flush();
    assert.strictEqual(btn.disabled, false, '429 must restore the control for retry');

    // 500 restores
    env = loadWithApprove(async () => { throw Object.assign(new Error('boom'), { status: 500 }); });
    env.exports.autoWakeTick();
    await flush();
    btn = approveButton(env);
    btn.dispatch('click');
    await flush();
    assert.strictEqual(btn.disabled, false, '500 must restore the control for retry');

    // 403 also stops the cadence
    env = loadWithApprove(async () => { throw Object.assign(new Error('Flight Companion feature is not enabled'), { status: 403 }); });
    env.exports.autoWakeTick();
    await flush();
    btn = approveButton(env);
    btn.dispatch('click');
    await flush();
    assert.strictEqual(env.exports.getCadenceState().stopped, true);
  });

  test('a truncated/unparseable proposal payload falls back to a dismiss-only note, never throws', async () => {
    const truncated = '{"proposed":true,"sessionId":"s1","prompt":"' + 'x'.repeat(20) + '\n… [truncated 4000 chars]';
    const { exports: m, chatUICalls } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { id: 'c1', name: 'send_follow_up', phase: 'proposed', result: truncated }),
        sseFrame('done', { surface: true }),
      ]),
    });
    await assert.doesNotReject(async () => { m.autoWakeTick(); await flush(); });
    assert.ok(chatUICalls.appendNote.some(c => /too long to show/.test(c.text)));
  });
});

// LIN-2621 beat 4: decisions as option buttons, reusing public/chat.js's
// window.ChatUI.appendOptions (the rulings tab's own primitive) and
// window.ReplyDelivery.postComment ONLY (never deliverReply, which also
// dispatches/resumes a run for a resumable/gone row on the rulings tab —
// deliberately narrower here, see renderOneDecision's own comment).
describe('flight-companion.js — LIN-2621 beat 4: decisions as option buttons', () => {
  // Matches lib/chat-tools.js's projectPendingDecision shape exactly —
  // including `issueId`/`taskDecisionId` (LIN-2704), additive to
  // `issueIdentifier`. `taskDecisionId: null` is the loop-anchored default
  // (a loop anchor carries no `taskDecisionId` field at all,
  // lib/unanswered-decisions.js's loop branch, so the real projection's
  // `truncateText(undefined, ...)` resolves to `null`); a task-bound
  // override sets both `issueId` (the raw UUID) and `taskDecisionId` (the
  // scan store's own row id).
  function decision(overrides) {
    return Object.assign({
      decisionId: 'dec-1',
      issueIdentifier: 'LIN-100',
      issueId: 'uuid-100',
      taskDecisionId: null,
      loopId: 'loop-1',
      sessionId: 'sess-1',
      question: 'Should we ship it?',
      options: [{ id: 'yes', label: 'Ship it' }, { id: 'no', label: 'Hold' }],
      optionsTotal: 2,
      recommended: 'yes',
      since: '2026-09-05T00:00:00.000Z',
      disposition: 'resumable',
      canReply: true,
      shelvedLapseCount: 0,
    }, overrides || {});
  }

  function decisionsResult(decisions) {
    return JSON.stringify({ count: decisions.length, truncated: false, decisions });
  }

  function decisionToolFrame(decisions) {
    return sseFrame('tool', { phase: 'result', id: 't1', name: 'list_pending_decisions', result: decisionsResult(decisions) });
  }

  test('parseDecisionsResult: valid shape, malformed JSON, non-array decisions, and per-row shape filtering', () => {
    const { exports: m } = loadClient();
    const d = decision();
    looseDeepEqual(m.parseDecisionsResult(decisionsResult([d])), { ok: true, decisions: [d] });
    assert.strictEqual(m.parseDecisionsResult('not json').ok, false);
    assert.strictEqual(m.parseDecisionsResult('{}').ok, false, 'decisions must be an array');
    assert.strictEqual(m.parseDecisionsResult(JSON.stringify({ decisions: 'x' })).ok, false);
    // A truncation marker (lib/openrouter.js's truncateToolResult shape) fails
    // JSON.parse honestly, mirroring parseProposalResult's own contract.
    assert.strictEqual(m.parseDecisionsResult(decisionsResult([d]).slice(0, 20) + '\n… [truncated 400 chars]').ok, false);
    // A row missing decisionId or options is dropped, not thrown on.
    const parsed = m.parseDecisionsResult(decisionsResult([d, { question: 'no id' }, { decisionId: 'x', options: 'not-array' }]));
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.decisions.length, 1);
  });

  test('renders the question and one option button per option, with the recommended star on the recommended one', async () => {
    const d = decision();
    const { exports: m, thread } = loadClient({ fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]) });
    m.autoWakeTick();
    await flush();

    const decisionLi = thread.children.find(li => li.querySelector('.fc-decision'));
    assert.ok(decisionLi, 'expected a rendered decision card');
    const wrap = decisionLi.querySelector('.fc-decision');
    assert.strictEqual(wrap.querySelector('.fc-decision-question').textContent, 'Should we ship it?');
    const row = wrap.querySelector('.chat-options-row');
    assert.strictEqual(row.children.length, 2, 'one button per option');
    assert.strictEqual(row.children[0].textContent, 'Ship it');
    assert.ok(row.children[0].classList.contains('chat-option--recommended'), 'the recommended option carries the star class');
    assert.ok(!row.children[1].classList.contains('chat-option--recommended'));
  });

  test('a read-only disposition (mid-turn) renders the caption only — no buttons, matching appendOptions\' own allow-list', async () => {
    const d = decision({ disposition: 'mid-turn', canReply: false });
    const { exports: m, thread } = loadClient({ fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]) });
    m.autoWakeTick();
    await flush();
    const wrap = thread.children.find(li => li.querySelector('.fc-decision')).querySelector('.fc-decision');
    assert.ok(wrap.querySelector('.chat-options--readonly'), 'read-only wrapper class present');
    assert.strictEqual(wrap.querySelector('.chat-options-row'), null, 'no button row at all');
  });

  test('multiple decisions in one result each render their own card', async () => {
    const d1 = decision({ decisionId: 'dec-1', question: 'First?' });
    const d2 = decision({ decisionId: 'dec-2', question: 'Second?' });
    const { exports: m, thread } = loadClient({ fetchImpl: () => sseResponse([decisionToolFrame([d1, d2]), sseFrame('done', { surface: true })]) });
    m.autoWakeTick();
    await flush();
    const cards = thread.children.filter(li => li.querySelector('.fc-decision'));
    assert.strictEqual(cards.length, 2);
    assert.strictEqual(cards[0].querySelector('.fc-decision-question').textContent, 'First?');
    assert.strictEqual(cards[1].querySelector('.fc-decision-question').textContent, 'Second?');
  });

  test('a malformed/truncated tool result shows an inline note and renders no decision card, without throwing', async () => {
    const { exports: m, thread, chatUICalls } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'result', id: 't1', name: 'list_pending_decisions', result: '{"decisions": [' }),
        sseFrame('done', { surface: true }),
      ]),
    });
    await assert.doesNotReject(async () => { m.autoWakeTick(); await flush(); });
    assert.strictEqual(thread.children.find(li => li.querySelector('.fc-decision')), undefined);
    assert.ok(chatUICalls.appendNote.some(c => /too long to show/.test(c.text)));
  });

  test('a tap on a loop-anchored (resumable) decision posts through window.ReplyDelivery.postComment ONLY, with decisionLoopId + decisionId, to the raw issueId target', async () => {
    const d = decision({ disposition: 'resumable', loopId: 'loop-7', decisionId: 'dec-7', issueId: 'uuid-77', issueIdentifier: 'LIN-77' });
    const { exports: m, thread, replyDeliveryCalls, apiCalls } = loadClient({
      fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    const wrap = thread.children.find(li => li.querySelector('.fc-decision')).querySelector('.fc-decision');
    const shipBtn = wrap.querySelector('.chat-options-row').children[0];
    shipBtn.dispatch('click');
    await flush();
    assert.strictEqual(replyDeliveryCalls.length, 1);
    // looseDeepEqual: the `decision` object is constructed INSIDE the vm
    // sandbox, so it carries a different (but structurally identical)
    // Object.prototype than this file's own literal — same cross-realm
    // reason beat 3's getTabTotals() assertions use looseDeepEqual.
    // LIN-2704: the comment target now prefers the raw `issueId` (with an
    // `issueIdentifier` fallback), mirroring public/observation.js's
    // rulings-tab precedence, now that the projection carries it for every
    // row — never just the task-bound ones.
    looseDeepEqual(replyDeliveryCalls[0], {
      urlKey: 'acme', issueId: 'uuid-77', prompt: 'Ship it',
      decision: { decisionLoopId: 'loop-7', decisionId: 'dec-7' },
    });
    assert.strictEqual(apiCalls.length, 0, 'never window.api — postComment is a raw fetch of its own');
  });

  // LIN-2704: the LIN-2621 beat-6 read-only mitigation (a fabricated
  // 'task-bound-unlinked' disposition that deliberately fell outside
  // appendOptions' resumable/gone/task-bound allow-list, forcing a
  // loopId-less row read-only) is reverted. `lib/chat-tools.js`'s
  // `projectPendingDecision` now projects the raw issue UUID and the scan
  // store's own record id from the anchor, so a task-bound tap can carry the
  // SAME best-effort stamp pair a loop-anchored tap always could — the real
  // `'task-bound'` disposition reaches appendOptions' own (unchanged) allow-
  // list, which is what makes the row interactive again.
  test('a task-bound decision renders interactive — appendOptions\' real allow-list, not a fabricated disposition — and a tap posts the stamp pair to the raw issueId target', async () => {
    const d = decision({
      disposition: 'task-bound', loopId: null, decisionId: 'scan_abc123',
      issueId: 'uuid-9', issueIdentifier: 'LIN-9', taskDecisionId: 'scan_abc123',
    });
    const { exports: m, thread, replyDeliveryCalls, apiCalls } = loadClient({
      fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    const wrap = thread.children.find(li => li.querySelector('.fc-decision')).querySelector('.fc-decision');
    assert.strictEqual(wrap.querySelector('.chat-options--readonly'), null, 'interactive, not read-only');
    const row = wrap.querySelector('.chat-options-row');
    assert.ok(row, 'a button row is rendered — appendOptions\' own allow-list includes task-bound');
    row.children[0].dispatch('click'); // "Ship it"
    await flush();
    assert.strictEqual(replyDeliveryCalls.length, 1);
    // looseDeepEqual: cross-realm object, see the loop-anchored test above.
    looseDeepEqual(replyDeliveryCalls[0], {
      urlKey: 'acme', issueId: 'uuid-9', prompt: 'Ship it',
      decision: { taskDecisionId: 'scan_abc123', taskDecisionIssueId: 'uuid-9' },
    });
    assert.strictEqual(apiCalls.length, 0, 'never window.api — postComment is a raw fetch of its own');
  });

  test('the loop-bound and task-bound reply lanes do not cross-contaminate — each tap carries only its own stamp pair', async () => {
    const loopBound = decision({
      disposition: 'resumable', loopId: 'loop-9', decisionId: 'dec-9',
      issueId: 'uuid-9-loop', issueIdentifier: 'LIN-9',
    });
    const taskBound = decision({
      disposition: 'task-bound', loopId: null, decisionId: 'scan-9',
      issueId: 'uuid-9-task', issueIdentifier: 'LIN-19', taskDecisionId: 'scan-9',
    });
    const { exports: m, thread, replyDeliveryCalls } = loadClient({
      fetchImpl: () => sseResponse([decisionToolFrame([loopBound, taskBound]), sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    const cards = thread.children.filter(li => li.querySelector('.fc-decision')).map(li => li.querySelector('.fc-decision'));
    assert.strictEqual(cards.length, 2);

    cards[0].querySelector('.chat-options-row').children[1].dispatch('click'); // loop-bound "Hold"
    cards[1].querySelector('.chat-options-row').children[0].dispatch('click'); // task-bound "Ship it"
    await flush();

    assert.strictEqual(replyDeliveryCalls.length, 2);
    const loopCall = replyDeliveryCalls.find(c => c.issueId === 'uuid-9-loop');
    const taskCall = replyDeliveryCalls.find(c => c.issueId === 'uuid-9-task');
    looseDeepEqual(loopCall.decision, { decisionLoopId: 'loop-9', decisionId: 'dec-9' });
    assert.strictEqual('taskDecisionId' in loopCall.decision, false, 'the loop-bound tap never carries the task pair');
    looseDeepEqual(taskCall.decision, { taskDecisionId: 'scan-9', taskDecisionIssueId: 'uuid-9-task' });
    assert.strictEqual('decisionLoopId' in taskCall.decision, false, 'the task-bound tap never carries the loop pair');
  });

  test('the row settles visibly on a successful reply: buttons disabled, feedback shown, card marked resolved', async () => {
    const d = decision();
    const { exports: m, thread } = loadClient({
      fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]),
      postCommentImpl: () => ({ ok: true, status: 200, data: {} }),
    });
    m.autoWakeTick();
    await flush();
    const wrap = thread.children.find(li => li.querySelector('.fc-decision')).querySelector('.fc-decision');
    const buttons = wrap.querySelector('.chat-options-row').children;
    buttons[0].dispatch('click');
    await flush();
    assert.ok(buttons[0].disabled && buttons[1].disabled, 'both options disable together, not just the tapped one');
    assert.ok(wrap.classList.contains('fc-decision--resolved'));
    assert.match(wrap.querySelector('.fc-decision-feedback').textContent, /Replied/);
  });

  test('a double tap never posts twice — the second click on an already-disabled/resolved row is a no-op', async () => {
    const d = decision();
    const { exports: m, thread, replyDeliveryCalls } = loadClient({
      fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    const wrap = thread.children.find(li => li.querySelector('.fc-decision')).querySelector('.fc-decision');
    const btn = wrap.querySelector('.chat-options-row').children[0];
    btn.dispatch('click');
    btn.dispatch('click'); // synchronous second tap, before the first fetch resolves
    await flush();
    assert.strictEqual(replyDeliveryCalls.length, 1, 'the resolved-guard blocks re-entry even before the button\'s own disabled state can');
  });

  test('canReply: false is respected even on an (in practice unreachable) interactive-looking disposition — the onSelect guard is a real second gate, not decorative', async () => {
    const d = decision({ disposition: 'resumable', canReply: false });
    const { exports: m, thread, replyDeliveryCalls } = loadClient({
      fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]),
    });
    m.autoWakeTick();
    await flush();
    const wrap = thread.children.find(li => li.querySelector('.fc-decision')).querySelector('.fc-decision');
    wrap.querySelector('.chat-options-row').children[0].dispatch('click');
    await flush();
    assert.strictEqual(replyDeliveryCalls.length, 0);
  });

  test('a failed reply (4xx) is handled honestly, never silently swallowed, and stays disabled (retrying would fail the same way)', async () => {
    const d = decision();
    const { exports: m, thread } = loadClient({
      fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]),
      postCommentImpl: () => ({ ok: false, status: 422, data: { error: 'decision already answered' } }),
    });
    m.autoWakeTick();
    await flush();
    const wrap = thread.children.find(li => li.querySelector('.fc-decision')).querySelector('.fc-decision');
    const buttons = wrap.querySelector('.chat-options-row').children;
    buttons[0].dispatch('click');
    await flush();
    assert.strictEqual(wrap.querySelector('.fc-decision-feedback').textContent, 'decision already answered');
    assert.ok(buttons[0].disabled, 'a 4xx is terminal — left disabled rather than inviting an identical retry');
  });

  test('a failed reply (5xx) re-enables the row for retry', async () => {
    const d = decision();
    const { exports: m, thread } = loadClient({
      fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]),
      postCommentImpl: () => ({ ok: false, status: 500, data: {} }),
    });
    m.autoWakeTick();
    await flush();
    const wrap = thread.children.find(li => li.querySelector('.fc-decision')).querySelector('.fc-decision');
    const buttons = wrap.querySelector('.chat-options-row').children;
    buttons[0].dispatch('click');
    await flush();
    assert.ok(!buttons[0].disabled, 'a 5xx is retryable — restored, matching renderProposal\'s own disable-then-restore idiom');
    assert.match(wrap.querySelector('.fc-decision-feedback').textContent, /try again/);
  });

  test('a network failure (postComment rejects) re-enables the row for retry with an honest message', async () => {
    const d = decision();
    const { exports: m, thread } = loadClient({
      fetchImpl: () => sseResponse([decisionToolFrame([d]), sseFrame('done', { surface: true })]),
      postCommentImpl: () => { throw new Error('offline'); },
    });
    m.autoWakeTick();
    await flush();
    const wrap = thread.children.find(li => li.querySelector('.fc-decision')).querySelector('.fc-decision');
    const buttons = wrap.querySelector('.chat-options-row').children;
    buttons[0].dispatch('click');
    await flush();
    assert.ok(!buttons[0].disabled);
    assert.match(wrap.querySelector('.fc-decision-feedback').textContent, /Network failure — try again/);
  });
});

// ─── Full response matrix (F4 + F6) ─────────────────────────────────────

describe('flight-companion.js — response matrix outcomes end-to-end', () => {
  test('gate-silent (200 spent:false): silent, no DOM note, doubles', async () => {
    const { exports: m, chatUICalls, fetchCalls } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'hash-identical' }),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(chatUICalls.appendNote.length, 0);
    assert.strictEqual(m.getCadenceState().delayMs, 60000);
  });

  test('LIN-2438 T17: gate-silent + sweep-not-seen updates the single status line with the not-seen text, doubles the cadence, and appends no row', async () => {
    const seenAt = '2026-09-02T20:00:00.000Z';
    const { exports: m, thread, checkIn, chatUICalls } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'sweep-not-seen', sweepLastSeenAt: seenAt }),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(checkIn.hidden, false);
    assert.strictEqual(checkIn.textContent, m.formatSweepNotSeen(new Date(seenAt)));
    assert.strictEqual(checkIn.classList.contains('fc-checkin--warning'), true, 'the warning styling class must be applied');
    assert.strictEqual(thread.children.length, 0, 'no row is ever appended to the thread');
    assert.strictEqual(chatUICalls.appendNote.length, 0);
    assert.strictEqual(m.getCadenceState().delayMs, 60000, 'doubles from the 30s base, same as any other gate-silent tick');
    assert.strictEqual(m.getCadenceState().stopped, false, 'never stops for this reason — a dead sweep can recover');
  });

  test('LIN-2438 T18: gate-silent with any other reason still only refreshes the ordinary check-in line (LIN-2443 AC1 unchanged), no warning class', async () => {
    const { exports: m, thread, checkIn, chatUICalls } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'floor' }),
    });
    m.autoWakeTick();
    await flush();
    assert.match(checkIn.textContent, /nothing new$/);
    assert.strictEqual(checkIn.classList.contains('fc-checkin--warning'), false);
    assert.strictEqual(thread.children.length, 0);
    assert.strictEqual(chatUICalls.appendNote.length, 0);
    assert.strictEqual(m.getCadenceState().delayMs, 60000);
  });

  // ─── LIN-2487: the no-census path, the OTHER gate-silent reason that does
  // not mean "checked, nothing new" ───────────────────────────────────────────
  //
  // LIN-2438 relabels hash-identical/no-delta to sweep-not-seen when the sweep
  // is stale, but deliberately leaves `no-census` alone — it is an honest
  // reason, and flight-companion-gate.test.js pins that it is never rewritten.
  // The consequence was that it arrived at the client with no branch of its own
  // and fell through to "checked in HH:MM · nothing new": a successful quiet
  // scan reported for a fleet that has never been scanned at all. Narrow, since
  // it needs no prior census (a brand-new workspace, or a deployment where
  // observer-sweep's register() rejected at boot — census documents survive
  // restarts), and precisely the silence LIN-2438 exists to break.

  test('LIN-2487: gate-silent + no-census says so, instead of claiming a quiet scan', async () => {
    const { exports: m, thread, checkIn, chatUICalls } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(checkIn.hidden, false);
    assert.match(checkIn.textContent, /^checked in .+ \u00b7 no fleet scan yet$/);
    assert.doesNotMatch(checkIn.textContent, /nothing new/, 'the whole defect: this line must not claim a scan happened');
    assert.strictEqual(thread.children.length, 0, 'no row is ever appended to the thread');
    assert.strictEqual(chatUICalls.appendNote.length, 0);
    assert.strictEqual(m.getCadenceState().delayMs, 60000, 'doubles from the 30s base, same as any other gate-silent tick');
    assert.strictEqual(m.getCadenceState().stopped, false, 'never stops — a census can appear on the next sweep');
  });

  test('LIN-2487: no-census carries no warning class, and clears a stale one', async () => {
    // Deliberately not styled as a warning: the common case is a brand-new
    // workspace still waiting for its first sweep, which is not a fault — and
    // that wait runs to roster-length × 60s, since observer-sweep is
    // round-robin one workspace per tick, not 60s flat. Clearing a leftover
    // class matters because the previous tick may have been sweep-not-seen.
    const { exports: m, checkIn } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    checkIn.classList.add('fc-checkin--warning');
    m.autoWakeTick();
    await flush();
    assert.strictEqual(checkIn.classList.contains('fc-checkin--warning'), false);
  });

  test('LIN-2487: formatNoCensus reports THIS tick\'s time, not the sweep\'s — there is no sweep instant to name', () => {
    const { exports: m } = loadClient({ fetchImpl: () => jsonResponse(200, {}) });
    const line = m.formatNoCensus(new Date('2026-09-05T09:00:00.000Z'));
    assert.match(line, /no fleet scan yet$/, 'the state being reported');
    assert.match(line, /^checked in /, 'and the ordinary line\'s leading clause, so a stopped/hidden/offline page is still distinguishable from a ticking one');
    // The clock is an argument, never read inside — same purity contract as
    // its two siblings, which is what puts it on the test seam at all.
    assert.notStrictEqual(line, m.formatNoCensus(new Date('2026-09-05T11:00:00.000Z')));
  });

  test('LIN-2487: the three gate-silent lines are mutually distinct', () => {
    // The regression this guards: a future edit that collapses two of these
    // onto the same wording would silently restore the ambiguity the branch
    // exists to remove, while every assertion above still passed.
    const { exports: m } = loadClient({ fetchImpl: () => jsonResponse(200, {}) });
    const lines = [
      m.formatCheckIn(new Date('2026-09-05T09:00:00.000Z')),
      m.formatSweepNotSeen(new Date('2026-09-05T08:00:00.000Z')),
      m.formatNoCensus(new Date('2026-09-05T09:00:00.000Z')),
    ];
    assert.strictEqual(new Set(lines).size, 3, `expected three distinct check-in lines, got ${JSON.stringify(lines)}`);
  });

  test('an ordinary check-in clears a previously-set sweep-not-seen warning class (the line settles)', async () => {
    const { exports: m, checkIn } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'hash-identical' }),
    });
    checkIn.classList.add('fc-checkin--warning'); // simulate a prior sweep-not-seen tick's leftover state
    m.autoWakeTick();
    await flush();
    assert.strictEqual(checkIn.classList.contains('fc-checkin--warning'), false, 'an ordinary check-in must clear the warning class');
  });

  test('403 flag-off: EITHER path stops the cadence entirely and shows a note', async () => {
    const auto = loadClient({ fetchImpl: () => jsonResponse(403, { error: 'Flight Companion feature is not enabled' }) });
    auto.exports.autoWakeTick();
    await flush();
    assert.strictEqual(auto.exports.getCadenceState().stopped, true);
    assert.ok(auto.chatUICalls.appendNote.some(c => /not enabled/.test(c.text)));

    const user = loadClient({ fetchImpl: () => jsonResponse(403, { error: 'Flight Companion feature is not enabled' }) });
    user.questionInput.value = 'hi';
    user.exports.submitQuestion();
    await flush();
    assert.strictEqual(user.exports.getCadenceState().stopped, true);
  });

  test('F6: 401 (middleware session expiry) stops the cadence and shows a re-auth note', async () => {
    const { exports: m, chatUICalls } = loadClient({ fetchImpl: () => jsonResponse(401, { error: 'Not authenticated' }) });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(m.getCadenceState().stopped, true);
    assert.ok(chatUICalls.appendNote.some(c => /session expired/.test(c.text)));
  });

  test('503 ai-not-configured: auto-wake stops; a user-initiated turn does not touch the cadence', async () => {
    const auto = loadClient({ fetchImpl: () => jsonResponse(503, { error: 'AI is not configured.' }) });
    auto.exports.autoWakeTick();
    await flush();
    assert.strictEqual(auto.exports.getCadenceState().stopped, true);

    const user = loadClient({ fetchImpl: () => jsonResponse(503, { error: 'AI is not configured.' }) });
    user.questionInput.value = 'hi';
    user.exports.submitQuestion();
    await flush();
    assert.strictEqual(user.exports.getCadenceState().stopped, false, 'a user-triggered 503 must not itself stop the auto-wake cadence');
    assert.strictEqual(user.sendBtn.disabled, false, 'composer must be re-enabled, no auto-retry');
  });

  test('F6: 500 / a non-JSON, non-OK response doubles the auto-wake cadence (transient, may resolve) and never assumes the body is JSON', async () => {
    const { exports: m } = loadClient({ fetchImpl: () => htmlResponse(404) });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(m.getCadenceState().delayMs, 60000);
    assert.strictEqual(m.getCadenceState().stopped, false);
  });

  test('429 free-tier limit is reachable only on a user-initiated turn; composer re-enabled, no auto-retry, no cadence effect', async () => {
    const { exports: m, chatUICalls, sendBtn, questionInput } = loadClient({
      fetchImpl: () => jsonResponse(429, { error: 'Free tier limit reached', freeTier: { remaining: 0, limit: 10, resetsAt: 'soon' } }),
    });
    questionInput.value = 'status please';
    m.submitQuestion();
    await flush();
    assert.ok(chatUICalls.appendNote.some(c => /Free tier limit reached/.test(c.text) && /remaining/.test(c.text)));
    assert.strictEqual(sendBtn.disabled, false);
    assert.strictEqual(m.getCadenceState().delayMs, 30000);
  });

  test('400 message-too-long is user-initiated only; composer text is preserved for editing, no auto-retry', async () => {
    const { exports: m, questionInput } = loadClient({
      fetchImpl: () => jsonResponse(400, { error: 'message must be 2000 characters or fewer' }),
    });
    questionInput.value = 'x'.repeat(2001);
    m.submitQuestion();
    await flush();
    assert.strictEqual(questionInput.value, 'x'.repeat(2001), 'the composer text must be restored, not lost');
  });

  test('a mid-stream SSE error frame: auto-wake doubles; user-initiated drops the unanswered turn from history and re-enables the composer', async () => {
    const auto = loadClient({ fetchImpl: () => sseResponse([sseFrame('error', { message: 'boom' })]) });
    auto.exports.autoWakeTick();
    await flush();
    assert.strictEqual(auto.exports.getCadenceState().delayMs, 60000);

    const user = loadClient({ fetchImpl: () => sseResponse([sseFrame('error', { message: 'boom' })]) });
    user.questionInput.value = 'hi';
    user.exports.submitQuestion();
    await flush();
    looseDeepEqual(user.exports.getChatHistory(), [], 'the unanswered user turn must be dropped, not left dangling');
    assert.strictEqual(user.sendBtn.disabled, false);
  });

  test('a network failure (fetch rejects): auto-wake doubles; user-initiated shows a note and restores composer text', async () => {
    const auto = loadClient({ fetchImpl: () => Promise.reject(new Error('network down')) });
    auto.exports.autoWakeTick();
    await flush();
    assert.strictEqual(auto.exports.getCadenceState().delayMs, 60000);

    const user = loadClient({ fetchImpl: () => Promise.reject(new Error('network down')) });
    user.questionInput.value = 'status please';
    user.exports.submitQuestion();
    await flush();
    assert.strictEqual(user.questionInput.value, 'status please');
    looseDeepEqual(user.exports.getChatHistory(), []);
  });
});

// ─── Shared tool-label helper (LIN-2632) ────────────────────────────────────
//
// toolBreadcrumbLabel used to be a task-chat.js-local function; it is lifted
// into window.ChatUI (public/chat.js) here so Flight Companion's breadcrumb
// rendering (a later beat) and Task Chat share one implementation, per
// LIN-1578's direction that this shared layer must not be forked. chat.js
// has no document/window dependency at load time (only inside appendMessage/
// appendNote, neither of which these tests call), so a bare `{ window: {} }`
// sandbox is enough to load it and read off the attached ChatUI.
// `doc`, when given, is the SAME FakeElement-based document shim the calling
// test's own thread lives in — needed once a caller wants a real, callable
// `appendOptions` (LIN-2621 beat 4), which does real `document.createElement`
// work internally. Omitted, as every pre-existing caller does (this file's
// own toolBreadcrumbLabel suite below), the sandbox carries no `document` at
// all — fine for the string-only helpers that never touch the DOM.
function loadChatUI(doc) {
  const sandbox = { window: {}, console };
  if (doc) sandbox.document = doc;
  // LIN-2670: a stub renderMarkdown + DOMPurify + marked so a REAL chat.js
  // renderMarkdownText, sourced below by makeChatUI for the Flight
  // Companion client tests, actually runs rather than silently no-op'ing on
  // one of its own missing-global guards — each of which has its own
  // dedicated coverage in tests/unit/chat-render-markdown-text.test.js.
  sandbox.window.renderMarkdown = function (text, opts, keepWholeFence) {
    return '<p data-rendered="' + String(!!keepWholeFence) + '">' + text + '</p>';
  };
  sandbox.DOMPurify = { sanitize: (html) => html };
  // The marked guard (close-out ledger L2) reads the GLOBAL, not anything
  // reachable through the stubbed renderMarkdown above, so the sandbox has
  // to carry one. Never called — renderMarkdown is stubbed.
  sandbox.marked = { parse: () => { throw new Error('marked.parse must not be reached — renderMarkdown is stubbed'); } };
  vm.createContext(sandbox);
  vm.runInContext(CHAT_JS_SRC, sandbox, { filename: 'chat.js' });
  return sandbox.window.ChatUI;
}

describe('window.ChatUI.toolBreadcrumbLabel (LIN-2632) — lifted from task-chat.js, extended for Flight Companion', () => {
  test('is exposed on the shared ChatUI surface', () => {
    const ChatUI = loadChatUI();
    assert.strictEqual(typeof ChatUI.toolBreadcrumbLabel, 'function');
  });

  // Pre-fix (acceptance-witness): before this beat's chat.js edit, ChatUI has
  // no toolBreadcrumbLabel at all, so `ChatUI.toolBreadcrumbLabel(...)` throws
  // a TypeError — every assertion below was observed to fail that way against
  // unfixed public/chat.js (a pre-fix "red" is impossible in the normal
  // fail-differently sense since the function is simply absent; this is the
  // mutation-equivalent: delete the export and the whole suite throws instead
  // of asserting).

  test('get_stack: names the count when a limit was requested', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'get_stack', arguments: { limit: 5 } }),
      'checked the top 5 tasks on the stack'
    );
  });

  test('get_stack: falls back to a plain description with no limit argument', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'get_stack', arguments: {} }),
      'checked the task stack'
    );
  });

  test('list_task_sessions: names the task when an issueId was requested', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'list_task_sessions', arguments: { issueId: 'LIN-123' } }),
      'checked sessions for LIN-123'
    );
  });

  test('list_task_sessions: falls back to a plain description with no issueId', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'list_task_sessions', arguments: {} }),
      'checked task sessions'
    );
  });

  test('get_session: names the session when a sessionId was requested', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'get_session', arguments: { sessionId: 'abc-123' } }),
      'checked session abc-123'
    );
  });

  test('get_session: falls back to a plain description with no sessionId', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'get_session', arguments: {} }),
      'checked a session'
    );
  });

  test('list_active_sessions never prints the bare tool name', () => {
    const ChatUI = loadChatUI();
    const label = ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'list_active_sessions', arguments: {} });
    assert.equal(label, 'checked active sessions');
    assert.notEqual(label, 'list_active_sessions');
  });

  test('list_pending_decisions never prints the bare tool name', () => {
    const ChatUI = loadChatUI();
    const label = ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'list_pending_decisions', arguments: {} });
    assert.equal(label, 'checked pending decisions');
    assert.notEqual(label, 'list_pending_decisions');
  });

  test('every companion catalog tool name resolves to a non-empty, non-bare label on call', () => {
    const ChatUI = loadChatUI();
    const COMPANION_TOOLS = ['get_stack', 'list_task_sessions', 'get_session', 'list_active_sessions', 'list_pending_decisions'];
    for (const name of COMPANION_TOOLS) {
      const label = ChatUI.toolBreadcrumbLabel({ phase: 'call', name, arguments: {} });
      assert.ok(label, `${name} must produce a non-empty label`);
      assert.notEqual(label, name, `${name} must not fall through to the bare-name fallback`);
    }
  });

  test('error phase still names the tool for a companion tool, matching the pre-existing Task Chat shape', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'error', name: 'get_stack', error: 'timeout' }),
      'get_stack failed: timeout'
    );
  });

  // The existing Task Chat labels (LIN-990/LIN-1073) must still resolve
  // byte-for-byte after the lift.
  test('lookup_task/get_relations: unchanged from task-chat.js', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'lookup_task', arguments: { issueId: 'LIN-9' } }),
      'looked up LIN-9'
    );
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'get_relations', arguments: {} }),
      'get_relations'
    );
  });

  test('search_tasks: unchanged from task-chat.js', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'search_tasks', arguments: { query: 'billing' } }),
      'searched "billing"'
    );
  });

  test('send_follow_up: unchanged from task-chat.js, including the write-tool snippet', () => {
    const ChatUI = loadChatUI();
    assert.equal(
      ChatUI.toolBreadcrumbLabel({
        phase: 'call', name: 'send_follow_up', arguments: { sessionId: 'sess-1', prompt: 'keep going' }
      }),
      'sent a follow-up to session sess-1: "keep going"'
    );
    assert.equal(
      ChatUI.toolBreadcrumbLabel({ phase: 'call', name: 'send_follow_up', arguments: {} }),
      'send_follow_up'
    );
  });

  test('cap and unrecognized phases: unchanged from task-chat.js', () => {
    const ChatUI = loadChatUI();
    assert.equal(ChatUI.toolBreadcrumbLabel({ phase: 'cap', name: 'get_stack' }), 'reached the tool-lookup limit');
    assert.equal(ChatUI.toolBreadcrumbLabel({ phase: 'result', name: 'get_stack' }), '');
    assert.equal(ChatUI.toolBreadcrumbLabel(null), '');
  });
});

// ─── LIN-2622: the boot turn — start button / re-orient affordance ─────────

describe('flight-companion.js — LIN-2622 boot: endpoint, rendering, and the start/reorient pair', () => {
  test('startBoot() posts to the boot endpoint, never /turn', async () => {
    const { exports: m, fetchCalls } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    m.startBoot();
    await flush();
    assert.strictEqual(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/api\/flight-companion\/boot$/);
    assert.doesNotMatch(fetchCalls[0].url, /\/api\/flight-companion\/turn$/);
  });

  test('a boot never sends a client-asserted message — only history', async () => {
    const { exports: m, fetchCalls } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    m.startBoot();
    await flush();
    assert.strictEqual(fetchCalls[0].body.message, undefined, 'the server hardcodes its own turn content — the client must not assert one');
    assert.deepStrictEqual(fetchCalls[0].body.history, []);
  });

  test('renders as a user-initiated turn: a synthetic "Start" user bubble, then a thinking placeholder, before any network response', () => {
    const { exports: m, thread } = loadClient({
      fetchImpl: () => new Promise(() => {}), // never resolves — pre-response state only
    });
    m.startBoot();
    assert.strictEqual(thread.children.length, 2, 'a user bubble and a thinking assistant bubble, exactly like a typed turn');
    assert.strictEqual(thread.children[0].querySelector('.fc-msg-body').textContent, 'Start');
    assert.strictEqual(thread.children[1].querySelector('.fc-msg-body').textContent, 'thinking…');
  });

  test('a successful boot pushes a real {role:"user", content:"Start"} entry into history, matching what the server actually turned', async () => {
    const { exports: m } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('token', { token: 'orient ready' }), sseFrame('done', {})]),
    });
    m.startBoot();
    await flush();
    looseDeepEqual(m.getChatHistory(), [
      { role: 'user', content: 'Start' },
      { role: 'assistant', content: 'orient ready' },
    ]);
  });

  test('the cadence resets on a boot\'s `done` — same as a typed turn', async () => {
    const { exports: m } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    m.getCadenceState().delayMs = 120000; // simulate several prior doublings
    m.startBoot();
    await flush();
    assert.strictEqual(m.getCadenceState().delayMs, 30000, 'a boot done must reset to the base delay');
  });

  test('the cadence is left UNTOUCHED by a mid-stream boot error — not reset, not doubled', async () => {
    const { exports: m } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('error', { message: 'boom' })]),
    });
    m.getCadenceState().delayMs = 120000;
    m.startBoot();
    await flush();
    assert.strictEqual(m.getCadenceState().delayMs, 120000, 'an error must move the cadence neither way for a boot');
  });

  test('the cadence is left UNTOUCHED by a boot network failure — not reset, not doubled', async () => {
    const { exports: m } = loadClient({
      fetchImpl: () => Promise.reject(new Error('network down')),
    });
    m.getCadenceState().delayMs = 120000;
    m.startBoot();
    await flush();
    assert.strictEqual(m.getCadenceState().delayMs, 120000);
  });

  test('a mid-stream boot error settles the thinking row to failed and drops the turn from history — the button must not strand the UI in-progress', async () => {
    const { exports: m, thread } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('error', { message: 'boom' })]),
    });
    m.startBoot();
    await flush();
    const pill = thread.children[1].querySelector('.chat-msg__who');
    assert.ok(pill.classList.contains('status-pill--failed'), 'the pill must leave in-progress, never strand there');
    assert.match(thread.children[1].querySelector('.fc-msg-body').textContent, /\[error: boom\]/);
    looseDeepEqual(m.getChatHistory(), [], 'the failed turn must not remain in history');
  });

  test('a boot that loses the reservation race (gate-silent, spent:false) settles the bubble failed with an honest message, pops history, and leaves the cadence untouched', async () => {
    const { exports: m, thread } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'boot', spent: false, reason: 'lost-race' }),
    });
    m.getCadenceState().delayMs = 60000;
    m.startBoot();
    await flush();
    looseDeepEqual(m.getChatHistory(), [], 'the optimistic "Start" entry must be popped — this turn never actually happened');
    const pill = thread.children[1].querySelector('.chat-msg__who');
    assert.ok(pill.classList.contains('status-pill--failed'), 'the eager thinking bubble must be settled, not left in-progress');
    assert.match(thread.children[1].querySelector('.fc-msg-body').textContent, /try again/i);
    assert.strictEqual(m.getCadenceState().delayMs, 60000, 'a lost race is not "done" and must not move the cadence');
  });

  test('a boot 429 (free tier spent) settles the bubble failed with the free-tier message and pops history — same shape as a typed turn\'s 429', async () => {
    const { exports: m, thread } = loadClient({
      fetchImpl: () => jsonResponse(429, {
        error: 'Free tier limit reached',
        freeTier: { used: true, remaining: 0, limit: 10, resetsAt: '2026-09-01T00:00:00.000Z' },
      }),
    });
    m.startBoot();
    await flush();
    looseDeepEqual(m.getChatHistory(), []);
    assert.match(thread.children[1].querySelector('.fc-msg-body').textContent, /Free tier limit reached/);
  });

  test('the start button and the re-orient affordance are a complementary pair, never shown together', async () => {
    const { exports: m, startBtn, reorientBtn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    // Initial state (mirrors the real render): start visible, reorient hidden.
    assert.strictEqual(startBtn.classList.contains('hidden'), false);
    assert.strictEqual(reorientBtn.classList.contains('hidden'), true);

    m.startBoot();
    await flush();
    // Once the thread has content, the pair flips.
    assert.strictEqual(startBtn.classList.contains('hidden'), true, 'start must hide once the empty state is gone');
    assert.strictEqual(reorientBtn.classList.contains('hidden'), false, 'reorient must appear once there is something to re-orient from');
  });

  test('both the start button and the re-orient button drive the exact same boot turn', async () => {
    const { exports: m, fetchCalls, reorientBtn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    reorientBtn.dispatch('click');
    await flush();
    assert.strictEqual(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/api\/flight-companion\/boot$/);
  });

  test('the start/reorient buttons are disabled while a turn is in flight, and re-enabled after', async () => {
    const { exports: m, startBtn, reorientBtn } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    m.startBoot();
    assert.strictEqual(startBtn.disabled, true);
    assert.strictEqual(reorientBtn.disabled, true);
    await flush();
    assert.strictEqual(startBtn.disabled, false);
    assert.strictEqual(reorientBtn.disabled, false);
  });

  test('reuses the existing SSE reader unchanged: the SAME event frame set (token/tool/done/error) is understood on the boot endpoint', async () => {
    const { exports: m, thread } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'call', id: 't1', name: 'get_stack' }),
        sseFrame('tool', { phase: 'result', id: 't1', name: 'get_stack', result: '{}' }),
        sseFrame('token', { token: 'orienting' }),
        sseFrame('done', {}),
      ]),
    });
    m.startBoot();
    await flush();
    // A breadcrumb note plus the user bubble plus the assistant bubble — the
    // reader classified every frame type correctly with no boot-specific
    // branch of its own.
    assert.ok(thread.children.some((li) => li.className.includes('fc-inline-note')), 'the tool breadcrumb must render');
    const bubbles = thread.children.filter((li) => li.className.includes('fc-msg'));
    assert.strictEqual(bubbles.length, 2);
    assert.strictEqual(bubbles[1].querySelector('.fc-msg-body').textContent, 'orienting');
  });
});

// ─── LIN-2717: composer key handler (U6) ───────────────────────────────────
//
// Not in the original plan's ledger (L4 of the review): three E2E tests
// (tests/e2e/flight-companion.spec.js, real `keydown` via Playwright's
// keyboard) already cover Enter-sends / Shift+Enter-newlines and go red
// when the markup reverts to <input> — the review accepted that as
// substantive coverage. Added alongside the F1 fix since the seam
// (FakeElement#dispatch's optional `evt` param, S4-a) was already staged
// for exactly this and the cost is low.

describe('flight-companion.js — LIN-2717: composer key handler (U6)', () => {
  test('Enter without Shift prevents the default newline and submits', () => {
    const { questionInput, fetchCalls } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    questionInput.value = 'hello';
    let prevented = 0;
    questionInput.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault: () => { prevented += 1; } });
    assert.strictEqual(prevented, 1);
    assert.strictEqual(fetchCalls.length, 1, 'submitQuestion ran');
  });

  test('Shift+Enter does not submit, and leaves the newline to the browser default', () => {
    const { questionInput, fetchCalls } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    questionInput.value = 'hello';
    let prevented = 0;
    questionInput.dispatch('keydown', { key: 'Enter', shiftKey: true, preventDefault: () => { prevented += 1; } });
    assert.strictEqual(prevented, 0);
    assert.strictEqual(fetchCalls.length, 0);
  });

  test('a non-Enter key never submits', () => {
    const { questionInput, fetchCalls } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    questionInput.value = 'hello';
    questionInput.dispatch('keydown', { key: 'a', shiftKey: false, preventDefault: () => { throw new Error('must not be called'); } });
    assert.strictEqual(fetchCalls.length, 0);
  });
});

// ─── LIN-2717: composer auto-grow (S4 unit witnesses) ──────────────────────
//
// U7/U8/U9 below are exact-value assertions, not "a write happened" checks —
// a 'NaNpx' write (the value the seam would produce with no offsetHeight/
// clientHeight at all) fails every one of them. The fake's `_useLayout`
// model uses `min: 35.2` (2.2rem at a 16px root — the stylesheet's real
// resting floor; the plan's earlier "36" was a rounding error the approving
// review flagged) and `max: 136` (8.5rem). Only the content=0 row is
// sensitive to that correction — 48 and 200 both clamp past either min, so
// their numbers are unaffected.

describe('flight-companion.js — LIN-2717: composer auto-grow (S4 unit witnesses)', () => {
  test('U7 — resize after submitQuestion() clears the composer', async () => {
    const { exports: m, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    // loadClient's own init-time resizeComposer() call (production :1348 —
    // sizing a browser-restored value on first paint) already wrote once,
    // against content=0; clear it so this test's own writes are what's
    // being asserted.
    questionInput._heightWrites = [];
    // Pre-state: a grown, two-row box (via the real input-event path, not a
    // direct resizeComposer() call — this also proves the listener is wired).
    questionInput.setContent(48);
    questionInput.value = 'hello';
    questionInput.dispatch('input');
    assert.deepStrictEqual(questionInput._heightWrites, ['auto', '50px'], 'pre-state: grown to two rows');

    // setContent mutates the fake's layout model, not `.value` — there is no
    // point to interject between the clear and the resize submitQuestion()
    // performs synchronously (:1321's setComposerValue('')), so the box being
    // cleared is staged before the call, not after.
    questionInput.setContent(0);
    m.submitQuestion();
    await flush();

    assert.deepStrictEqual(
      questionInput._heightWrites.slice(-2),
      ['auto', '37.2px'],
      'the cleared-box row: content=0 clamps to the 35.2px resting floor, +2px border chrome',
    );
    assert.strictEqual(questionInput.style.overflowY, 'hidden');
  });

  test('U8 — resize after a server-error draft restore, while the composer is still disabled', async () => {
    const { exports: m, questionInput } = loadClient({
      fetchImpl: () => jsonResponse(500, { error: 'boom' }),
    });
    questionInput.setContent(48);

    // Record `disabled` at the instant of every height write — the only way
    // to pin "the restore happens before finishTurn releases the lock"
    // (:1050) as a fact about ORDER, not merely about the end state (which
    // is `disabled === false` either way, once the turn settles).
    const disabledAtWrite = [];
    const push = questionInput._heightWrites.push.bind(questionInput._heightWrites);
    questionInput._heightWrites.push = (v) => { disabledAtWrite.push(questionInput.disabled); return push(v); };

    questionInput.value = 'status please';
    m.submitQuestion();
    await flush();

    assert.strictEqual(questionInput._heightWrites.at(-1), '50px', 'the restored two-row draft');
    assert.strictEqual(questionInput.style.overflowY, 'hidden');
    assert.strictEqual(disabledAtWrite.at(-1), true, 'the restore write lands while the composer is still locked');
    assert.strictEqual(questionInput.disabled, false, 'and finishTurn releases it immediately after');
  });

  test('U9 — an auto-wake turn writes no height, provably (positive control closes the vacuum)', async () => {
    const { exports: m, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', { surface: true })]),
    });
    // loadClient's own init-time resizeComposer() call already wrote once,
    // against content=0; clear it so the positive control below is checked
    // against a clean slate.
    questionInput._heightWrites = [];
    questionInput.setContent(48);

    // Positive control, same fixture, same element, BEFORE the recorders are
    // reset: proves the tag guard is traversed, the `input` listener is
    // bound, the layout model is live, and the arithmetic is right — so a
    // silent `_heightWrites` below can only mean the turn-kind structure,
    // not a broken seam passing vacuously (rev 1's own failure mode, per the
    // approving plan-review). If S2's guard ever regresses to the case-
    // sensitive `!== 'TEXTAREA'`, THIS line fails first.
    questionInput.dispatch('input');
    assert.deepStrictEqual(questionInput._heightWrites, ['auto', '50px']);

    questionInput._heightWrites = [];
    questionInput.style.overflowY = '';

    m.autoWakeTick();
    await flush();

    assert.strictEqual(questionInput._heightWrites.length, 0, 'no auto-wake path assigns .value or fires input');
    assert.strictEqual(questionInput.style.overflowY, '');
    assert.strictEqual(questionInput._disabledWriteCount, 0);
  });
});

// ─── Per-turn model picker (LIN-2623 beat 3) ───────────────────────────────
//
// The picker's OWN markup/rate-card/data-pricing behavior is pure server-
// rendered HTML, already covered by tests/unit/render-flight-companion.test.js;
// a live browser's real <select>/<option> reflection of that markup is
// covered by tests/e2e/flight-companion.spec.js. This block covers the two
// things that are genuinely CLIENT logic: what `sendTurn` puts in the turn
// request body, and how the choice round-trips through LIN-2716's own
// sessionStorage persistence — the same seam chatHistory/tabTotals already
// use, extended (see the describe block below this one) rather than forked.
describe('flight-companion.js — LIN-2623 beat 3: per-turn model picker sends the choice', () => {
  test('mandated red-first sibling: an untouched picker (empty value, "current default") sends NO model field', async () => {
    const { exports: m, fetchCalls, questionInput } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    questionInput.value = 'status please';
    m.submitQuestion();
    await flush();
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(fetchCalls[0].body, 'model'), false,
      'a picker left on "current default" must not send a model field at all — beat 1\'s resolveAiOperationModel decides');
  });

  test('picking a curated model sends it as `model` on the turn request', async () => {
    const { exports: m, fetchCalls, questionInput, doc } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    doc._byId['flight-companion-model-select'].value = 'anthropic/claude-opus-5';
    questionInput.value = 'status please';
    m.submitQuestion();
    await flush();
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].body.model, 'anthropic/claude-opus-5');
  });

  test('the picker never rides an auto-wake tick — no human choice to carry on an unattended tick', async () => {
    const { exports: m, fetchCalls, doc } = loadClient({
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    doc._byId['flight-companion-model-select'].value = 'anthropic/claude-opus-5';
    m.autoWakeTick();
    await flush();
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(fetchCalls[0].body, 'model'), false);
  });

  test('the picker never rides a boot turn — boot hardcodes its own turn content and reads no body field', async () => {
    const { exports: m, fetchCalls, doc } = loadClient({
      fetchImpl: () => sseResponse([sseFrame('done', {})]),
    });
    doc._byId['flight-companion-model-select'].value = 'anthropic/claude-opus-5';
    m.startBoot();
    await flush();
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].url, '/workspace/acme/api/flight-companion/boot');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(fetchCalls[0].body, 'model'), false);
  });

  test('a change on the picker updates the rate-card mount via the exported updateModelPriceDisplay', () => {
    const { exports: m, doc } = loadClient();
    const select = doc._byId['flight-companion-model-select'];
    // This fake models `.value` only (see its own construction comment) —
    // `.options`/`selectedIndex` are real-DOM-only, so the real data-pricing
    // read safely falls through to the honest '—' fallback here; the REAL
    // attribute read is covered by render-flight-companion.test.js (markup)
    // and the e2e round trip (a real <select>).
    select.value = 'anthropic/claude-opus-5';
    select.dispatch('change');
    assert.strictEqual(m.getModelPriceText(), '—');
  });

  test('a change on the picker persists the choice immediately — before any turn is sent', () => {
    const storage = makeFakeStorage();
    const { doc } = loadClient({ storageImpl: storage });
    doc._byId['flight-companion-model-select'].value = 'anthropic/claude-opus-5';
    doc._byId['flight-companion-model-select'].dispatch('change');
    const raw = storage.getItem('flight-companion-session:acme');
    assert.ok(raw, 'expected a write to sessionStorage on change, not just at turn completion');
    assert.strictEqual(JSON.parse(raw).selectedModel, 'anthropic/claude-opus-5');
  });

  test('the selection persists across a reload: a fresh loadClient() restores it from storage into the picker', async () => {
    const storage = makeFakeStorage();
    const first = loadClient({ storageImpl: storage, fetchImpl: () => sseResponse([sseFrame('done', {})]) });
    first.doc._byId['flight-companion-model-select'].value = 'anthropic/claude-opus-5';
    first.doc._byId['flight-companion-model-select'].dispatch('change');

    // A fresh loadClient() call is a fresh page load (a new vm context, a
    // new picker element defaulted back to '') — sharing only `storage`,
    // exactly mirroring a real reload.
    const second = loadClient({ storageImpl: storage, fetchImpl: () => sseResponse([sseFrame('done', {})]) });
    assert.strictEqual(second.doc._byId['flight-companion-model-select'].value, 'anthropic/claude-opus-5',
      'the reloaded page must restore the picker to the previously-chosen model, not the empty "current default"');

    // And the restored choice is honored on the very next send, with no
    // further interaction needed.
    second.doc._byId['flight-companion-question'].value = 'still there?';
    second.exports.submitQuestion();
    await flush();
    assert.strictEqual(second.fetchCalls[second.fetchCalls.length - 1].body.model, 'anthropic/claude-opus-5');
  });
});

// ─── Session persistence helper (LIN-2716) ─────────────────────────────────
//
// Before this landed, a page reload lost `chatHistory` entirely — it lived
// only in the module-level array, never written to sessionStorage (see the
// ticket's Observed section). These tests PIN THE SHAPE of the persistence
// helper, exposed on the module's own test seam:
//   - `sessionStorageKey(urlKey)` -> the storage key for that workspace
//   - `loadStoredSession(urlKey)` -> `{history, tabCheckInCount, tabTotalCost,
//     selectedModel}` (the last joined the shape in LIN-2623 beat 3 — the
//     model picker's own choice, `null` meaning "no override"), always this
//     shape, NEVER throws — a missing entry, malformed JSON, or well-formed
//     JSON of the wrong shape all degrade to the same clean empty session
//     `{history: [], tabCheckInCount: 0, tabTotalCost: 0, selectedModel: null}`
//   - `saveStoredSession(urlKey, session)` -> writes it back, capping
//     `history` via the pre-existing `capHistory`/`HISTORY_CAP` so a
//     hand-edited or pre-cap stored blob can never bypass the 40-turn bound
//     on the way out OR the way back in
//   - `clearStoredSession(urlKey)` -> removes the entry. NOT wired to
//     reorient any more (LIN-2770/John's ruling withdrew that job — reorient
//     is not a fresh start) — kept as the primitive a later "start a fresh
//     session" affordance would use; still exercised directly below
//
// Keyed by `urlKey` — never a single global key, unlike public/app.js's
// collapse-state `STORAGE_KEY` — since one browser visiting two workspaces
// must not cross-contaminate their companion threads. Storage is
// `sessionStorage`, not `localStorage`: it survives the reload/tab-eviction
// scenario the ticket names (LIN-751's mobile-reload complaint) without
// accumulating stale threads indefinitely across days/devices the way a
// `localStorage` key would. This is a beat-2 design call, not settled by the
// ticket text — flagged in the beat-2 evidence comment on LIN-2716 for
// review, not silently assumed.
//
// These four names did not exist on the module when this block was written
// (beat 2) — every test here failed with "m.<name> is not a function"
// against the unfixed code; that red-first evidence is posted as a comment
// on LIN-2716 (title: "Beat 2/5 — red-first evidence"). Beat 3 added the
// production implementation these tests now exercise for real.
describe('flight-companion.js — session persistence helper (LIN-2716)', () => {
  const STORAGE_KEY = 'flight-companion-session:acme';
  // LIN-2623 beat 3: `selectedModel` joined the persisted shape (the model
  // picker's own choice — null means "no override"), round-tripped through
  // the SAME blob as history/totals. LIN-2771: `cadence` joined it too — the
  // wake-cadence record, null when no anchor is persisted (a fresh session,
  // an old blob, or a timer that is not armed).
  const EMPTY_SESSION = { history: [], tabCheckInCount: 0, tabTotalCost: 0, selectedModel: null, cadence: null };

  test('round-trip: a saved session reloads with the same thread and the same history the next turn would carry', () => {
    const { exports: m } = loadClient();
    const session = {
      history: [
        { role: 'user', content: 'are you there?' },
        { role: 'assistant', content: 'yes' },
      ],
      tabCheckInCount: 1,
      tabTotalCost: 0.0042,
      selectedModel: 'anthropic/claude-opus-5',
      cadence: null,
    };
    m.saveStoredSession('acme', session);
    // looseDeepEqual (node:assert's non-strict deepEqual), not
    // assert.deepStrictEqual, throughout this describe block — the vm
    // sandbox is a separate realm, so an object literal built inside it
    // carries that realm's own Object.prototype and fails a strict deep
    // comparison against a plain object built in this file, on prototype
    // identity alone, even with byte-identical own properties. The rest of
    // this file's own pure-helper tests hit the exact same seam (see
    // `looseDeepEqual` in the imports at the top and its use throughout).
    looseDeepEqual(m.loadStoredSession('acme'), session);
  });

  test('cap: the existing 40-turn bound still holds across a save/restore', () => {
    const { exports: m } = loadClient();
    const history = [];
    for (let i = 0; i < 45; i++) history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: String(i) });
    m.saveStoredSession('acme', { history, tabCheckInCount: 0, tabTotalCost: 0 });
    const loaded = m.loadStoredSession('acme');
    assert.strictEqual(loaded.history.length, m.HISTORY_CAP, 'must not exceed HISTORY_CAP');
    assert.strictEqual(loaded.history[0].content, '5', 'oldest entries are dropped, not newest');
    assert.strictEqual(loaded.history[loaded.history.length - 1].content, '44');
  });

  test('corrupt storage -> empty: malformed JSON yields a clean empty session and never throws into the page', () => {
    const storage = makeFakeStorage({ [STORAGE_KEY]: '{not json' });
    const { exports: m } = loadClient({ storageImpl: storage });
    // loadClient arms the load-time timer, which (LIN-2771) persists a
    // cadence record and thereby heals the corrupt blob into a valid one —
    // so re-corrupt the entry to test loadStoredSession's PURE degradation,
    // independent of that side effect.
    storage.setItem(STORAGE_KEY, '{not json');
    let loaded;
    assert.doesNotThrow(() => { loaded = m.loadStoredSession('acme'); });
    looseDeepEqual(loaded, EMPTY_SESSION);
  });

  test('corrupt storage -> empty: well-formed JSON of the wrong shape also yields a clean empty session', () => {
    const storage = makeFakeStorage({ [STORAGE_KEY]: JSON.stringify([1, 2, 3]) });
    const { exports: m } = loadClient({ storageImpl: storage });
    storage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    looseDeepEqual(m.loadStoredSession('acme'), EMPTY_SESSION);
  });

  test('no stored entry yields the same clean empty session, never throws', () => {
    const { exports: m, storage } = loadClient();
    // Same re-seed rationale as the two corrupt tests above: drop the entry
    // the load-time schedule wrote so loadStoredSession's missing-entry
    // degradation is what is actually asserted.
    storage.removeItem(STORAGE_KEY);
    let loaded;
    assert.doesNotThrow(() => { loaded = m.loadStoredSession('acme'); });
    looseDeepEqual(loaded, EMPTY_SESSION);
  });

  test('keyed by urlKey: two workspaces in the same browser do not cross-contaminate', () => {
    const { exports: m } = loadClient();
    m.saveStoredSession('acme', { history: [{ role: 'user', content: 'acme q' }], tabCheckInCount: 0, tabTotalCost: 0 });
    m.saveStoredSession('other', { history: [{ role: 'user', content: 'other q' }], tabCheckInCount: 0, tabTotalCost: 0 });
    assert.strictEqual(m.loadStoredSession('acme').history[0].content, 'acme q');
    assert.strictEqual(m.loadStoredSession('other').history[0].content, 'other q');
  });

  test('clearStoredSession removes the entry — a subsequent load returns the clean empty session', () => {
    const storage = makeFakeStorage();
    const { exports: m } = loadClient({ storageImpl: storage });
    m.saveStoredSession('acme', { history: [{ role: 'user', content: 'hi' }], tabCheckInCount: 1, tabTotalCost: 0.01 });
    assert.notStrictEqual(storage.getItem(STORAGE_KEY), null, 'sanity: something was actually written');
    m.clearStoredSession('acme');
    assert.strictEqual(storage.getItem(STORAGE_KEY), null);
    looseDeepEqual(m.loadStoredSession('acme'), EMPTY_SESSION);
  });

  test('saveStoredSession never throws when the underlying storage.setItem throws (quota/private-browsing)', () => {
    const storage = makeFakeStorage();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const { exports: m } = loadClient({ storageImpl: storage });
    assert.doesNotThrow(() => m.saveStoredSession('acme', { history: [], tabCheckInCount: 0, tabTotalCost: 0 }));
  });

  test('clearStoredSession never throws when the underlying storage.removeItem throws', () => {
    const storage = makeFakeStorage();
    storage.removeItem = () => { throw new Error('boom'); };
    const { exports: m } = loadClient({ storageImpl: storage });
    assert.doesNotThrow(() => m.clearStoredSession('acme'));
  });

  // LIN-2770 / John's ruling: reorient is NOT a fresh start, so it must no
  // longer clear the stored session — the withdrawn behaviour this
  // regression guards against. Checked synchronously, right after the click
  // and before the async boot turn resolves, so this is a direct test of
  // reorientClick's own wiring, not of anything a later turn re-saves.
  test('reorientClick preserves the stored session — reorient is not a fresh start (LIN-2770)', () => {
    const storage = makeFakeStorage();
    const { reorientBtn } = loadClient({
      storageImpl: storage,
      fetchImpl: () => new Promise(() => {}), // never resolves — pre-response state only
    });
    storage.setItem('flight-companion-session:acme', JSON.stringify({
      history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
      tabCheckInCount: 1,
      tabTotalCost: 0.01,
    }));
    reorientBtn.dispatch('click');
    assert.notStrictEqual(
      storage.getItem('flight-companion-session:acme'),
      null,
      'reorient must not clear the stored session'
    );
  });
});

describe('flight-companion.js — LIN-2771: cadence resumes against a wall-clock anchor', () => {
  const STORAGE_KEY = 'flight-companion-session:acme';

  test('resume: a reload 55s into a 60s window fires ~5s later, not a fresh 60s', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    // The anchor is stamped relative to the REAL clock (a genuine reload's
    // stored anchor was written by the tab's own Date.now), so the load-time
    // resume arithmetic sees a consistent clock on both sides — the seam's
    // setNowFn cannot reach the resume decision, which runs DURING load,
    // before loadClient returns.
    const storage = makeFakeStorage({
      [STORAGE_KEY]: JSON.stringify({
        history: [],
        tabCheckInCount: 1,
        tabTotalCost: 0.0,
        selectedModel: null,
        // A 60s backoff step whose next fire is ~5s from the reload moment.
        cadence: { delayMs: 60000, nextFireAt: Date.now() + 5000 },
      }),
    });
    const { exports: m, fetchCalls } = loadClient({
      storageImpl: storage,
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    assert.strictEqual(m.getCadenceState().delayMs, 60000, 'the stored delay is restored, not the base 30s');
    // ~5s remaining, not a fresh wait: well before the base 30s (let alone
    // 60s) the reload would otherwise wait, the resumed wake has fired.
    t.mock.timers.tick(4500);
    assert.strictEqual(fetchCalls.length, 0, 'no auto-wake before the resumed remaining time elapses');
    t.mock.timers.tick(1000);
    await flush();
    assert.strictEqual(fetchCalls.length, 1, 'fires ~5s into the reload against the wall-clock anchor, not a fresh 60s');
  });

  test('resume: a blob with no stored anchor keeps today\'s behaviour — first fire at the base 30s', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const storage = makeFakeStorage({
      [STORAGE_KEY]: JSON.stringify({
        history: [],
        tabCheckInCount: 2,
        tabTotalCost: 0.01,
        selectedModel: null,
      }),
    });
    const { exports: m, fetchCalls } = loadClient({
      storageImpl: storage,
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    assert.strictEqual(m.getCadenceState().delayMs, m.CADENCE_BASE_MS, 'no anchor means the base delay applies');
    t.mock.timers.tick(29999);
    assert.strictEqual(fetchCalls.length, 0);
    t.mock.timers.tick(1);
    await flush();
    assert.strictEqual(fetchCalls.length, 1, 'still fires at 30s — no anchor means the base cadence applies');
    assert.strictEqual(m.getTabTotals().count, 2, 'existing persisted fields still restore');
    assert.strictEqual(m.getTabTotals().cost, 0.01);
  });

  test('persisted blob carries cadence.delayMs + cadence.nextFireAt right after a schedule arms the timer', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const NOW = 1_700_000_000_000;
    const { exports: m, storage } = loadClient();
    m.setNowFn(() => NOW);
    // Drive the exported schedule entry point DIRECTLY (no turn, no finishTurn
    // save) so this pins the "persist on EVERY schedule" half of LIN-2771 in
    // isolation — the anchor must land the moment the timer is armed, not only
    // once a turn later settles.
    m.scheduleAutoWake(60000);
    const blob = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.ok(blob.cadence, 'the stored blob carries a cadence record after a schedule');
    assert.strictEqual(blob.cadence.delayMs, m.CADENCE_BASE_MS, 'the record names the cadence backoff length');
    assert.strictEqual(blob.cadence.nextFireAt, NOW + 60000, 'the anchor is wall-clock: now() + the ARMED delay, not cadence.delayMs');
  });
});

describe('flight-companion.js — LIN-2771 beat 3: persisted stop reason decides re-arm on reload', () => {
  const STORAGE_KEY = 'flight-companion-session:acme';

  test('re-arm: stored stoppedReason session-expired re-arms on a normal load (page loaded = session valid)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const storage = makeFakeStorage({
      [STORAGE_KEY]: JSON.stringify({
        history: [],
        tabCheckInCount: 0,
        tabTotalCost: 0,
        selectedModel: null,
        cadence: { delayMs: 60000, nextFireAt: null, stoppedReason: 'session-expired' },
      }),
    });
    const { exports: m, fetchCalls } = loadClient({
      storageImpl: storage,
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    assert.strictEqual(m.getCadenceState().stopped, false, 'session-expired cannot hold on a rendered page');
    assert.strictEqual(m.getCadenceState().delayMs, m.CADENCE_BASE_MS, 're-arms at the base delay, not the stored backoff');
    t.mock.timers.tick(29999);
    assert.strictEqual(fetchCalls.length, 0);
    t.mock.timers.tick(1);
    await flush();
    assert.strictEqual(fetchCalls.length, 1, 're-armed: first wake fires at the base 30s');
  });

  test('keep stopped: stored stoppedReason ai-not-configured with the page showing AI unconfigured does NOT re-arm', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const storage = makeFakeStorage({
      [STORAGE_KEY]: JSON.stringify({
        history: [],
        tabCheckInCount: 0,
        tabTotalCost: 0,
        selectedModel: null,
        cadence: { delayMs: 60000, nextFireAt: null, stoppedReason: 'ai-not-configured' },
      }),
    });
    const { exports: m, fetchCalls } = loadClient({
      storageImpl: storage,
      pageDataset: { fcAiConfigured: 'false' },
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    assert.strictEqual(m.getCadenceState().stopped, true, 'a reason the page can still show holds keeps the cadence stopped');
    assert.strictEqual(m.getNextCheckInText(), 'next check-in: —');
    t.mock.timers.tick(120000);
    await flush();
    assert.strictEqual(fetchCalls.length, 0, 'no auto-wake while kept stopped');
  });

  test('live stop: a session-expired turn writes the reason into storage and clears nextFireAt', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { exports: m, storage } = loadClient({
      fetchImpl: () => jsonResponse(401, {}),
    });
    t.mock.timers.tick(30000);
    await flush();
    assert.strictEqual(m.getCadenceState().stopped, true, 'a 401 session-expired turn stops the cadence');
    const blob = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.strictEqual(blob.cadence.stoppedReason, 'session-expired', 'the stop reason is persisted');
    assert.strictEqual(blob.cadence.nextFireAt, null, 'nextFireAt stays null while stopped');
  });

  test('legacy: an old blob with cadence but no stoppedReason loads as not-stopped', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const storage = makeFakeStorage({
      [STORAGE_KEY]: JSON.stringify({
        history: [],
        tabCheckInCount: 0,
        tabTotalCost: 0,
        selectedModel: null,
        cadence: { delayMs: 60000, nextFireAt: null },
      }),
    });
    const { exports: m, fetchCalls } = loadClient({
      storageImpl: storage,
      fetchImpl: () => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' }),
    });
    assert.strictEqual(m.getCadenceState().stopped, false, 'no stoppedReason means not stopped');
    t.mock.timers.tick(29999);
    assert.strictEqual(fetchCalls.length, 0);
    t.mock.timers.tick(1);
    await flush();
    assert.strictEqual(fetchCalls.length, 1, 'no anchor + no reason = today\'s fresh base start');
  });
});
// ─── Proposal persistence + rehydration (LIN-2772) ─────────────────────────
//
// LIN-2716 persisted only {role, content} turns; proposals arrived as
// ephemeral `phase: 'proposed'` SSE tool events and never entered the stored
// record, so a proposal on screen when the page reloaded rendered as nothing
// after it. These tests pin the widened record shape — a proposal is an entry
// kind alongside {role, content}, storing {sessionId, prompt} — and the
// rehydrate behaviour: a restored proposal re-renders READ-ONLY (the live
// proposal id is unreachable after a reload), never as an interactive card.
describe('flight-companion.js — proposal persistence + read-only rehydrate (LIN-2772)', () => {
  const proposalFrame = (proposal) => (
    sseFrame('tool', { phase: 'proposed', id: 't1', name: 'send_follow_up', result: JSON.stringify(proposal) })
  );
  const PROPOSAL = { proposed: true, sessionId: 'sess-1', prompt: 'approve me?' };

  test('a live proposal enters chatHistory as {kind, sessionId, prompt} and round-trips through storage', async () => {
    const storage = makeFakeStorage();
    const { exports: m, questionInput } = loadClient({
      storageImpl: storage,
      fetchImpl: () => sseResponse([
        proposalFrame(PROPOSAL),
        sseFrame('done', {}),
      ]),
    });
    questionInput.value = 'is there a proposal?';
    m.submitQuestion();
    await flush();

    looseDeepEqual(m.getChatHistory(), [
      { role: 'user', content: 'is there a proposal?' },
      { kind: 'proposal', sessionId: 'sess-1', prompt: 'approve me?' },
    ]);

    // The persistence is what makes the reload case work: the proposal turn
    // is in the SAME stored session the next page load rehydrates from.
    // (LIN-2771: the blob also carries a cadence record with a wall-clock
    // anchor, so the whole-object equality below is asserted field-by-field
    // rather than as one literal — the anchor is not deterministic.)
    const stored = m.loadStoredSession('acme');
    looseDeepEqual(stored.history, [
      { role: 'user', content: 'is there a proposal?' },
      { kind: 'proposal', sessionId: 'sess-1', prompt: 'approve me?' },
    ]);
    assert.strictEqual(stored.tabCheckInCount, 1);
    assert.strictEqual(stored.tabTotalCost, 0);
    assert.strictEqual(stored.selectedModel, null);
    assert.strictEqual(stored.cadence.stoppedReason, null, 'the cadence record is present but not stopped');
  });

  test('a persisted proposal survives the loadStoredSession filter and rehydrates as a read-only card', () => {
    const storage = makeFakeStorage({
      'flight-companion-session:acme': JSON.stringify({
        history: [
          { role: 'user', content: 'is there a proposal?' },
          { kind: 'proposal', sessionId: 'sess-1', prompt: 'approve me?' },
          { role: 'assistant', content: 'ack' },
        ],
        tabCheckInCount: 1,
        tabTotalCost: 0.0042,
        selectedModel: null,
      }),
    });
    const { exports: m, thread } = loadClient({ storageImpl: storage });

    const proposal = findByClass(thread, 'fc-proposal');
    assert.notStrictEqual(proposal, null, 'the restored proposal card re-renders after a reload');
    // Read-only from birth: the resolved class hides the action row (CSS
    // .fc-proposal--resolved .fc-proposal-actions { display: none }) — no
    // reachable approve control after a reload.
    assert.ok(proposal.classList.contains('fc-proposal--resolved'), 'restored proposals must be resolved/read-only');
    assert.strictEqual(findByClass(proposal, 'fc-proposal-text')._text, 'approve me?', 'the prompt text is preserved');
    assert.strictEqual(findByClass(proposal, 'fc-proposal-approve').disabled, true, 'approve is unreachable after a reload');
    assert.strictEqual(findByClass(proposal, 'fc-proposal-dismiss').disabled, true, 'dismiss is unreachable too — not merely hidden');
    assert.match(findByClass(proposal, 'fc-proposal-feedback')._text, /no longer actionable/);

    // The rehydrate render must NOT re-push the restored proposal into
    // chatHistory — the entry is already there from storage, so a second
    // push would duplicate it and double-render on the NEXT reload.
    assert.strictEqual(m.getChatHistory().length, 3, 'restored history keeps exactly the three stored turns');
  });

  test('a malformed proposal entry is dropped by the load filter like any other malformed turn', () => {
    const storage = makeFakeStorage({
      'flight-companion-session:acme': JSON.stringify({
        history: [
          { role: 'user', content: 'hi' },
          { kind: 'proposal', sessionId: 'sess-1' }, // missing prompt
          { kind: 'proposal', prompt: 'orphan' }, // missing sessionId
          { kind: 'proposal', sessionId: 'sess-2', prompt: 'valid' },
        ],
        tabCheckInCount: 0,
        tabTotalCost: 0,
      }),
    });
    const { exports: m, thread } = loadClient({ storageImpl: storage });
    assert.strictEqual(findByClass(thread, 'fc-proposal').classList.contains('fc-proposal--resolved'), true, 'only the well-formed proposal renders');
    looseDeepEqual(m.getChatHistory(), [
      { role: 'user', content: 'hi' },
      { kind: 'proposal', sessionId: 'sess-2', prompt: 'valid' },
    ]);
  });

  // The one error path interaction LIN-2772 introduces: a proposal rendered
  // mid-stream now rides chatHistory ABOVE the turn's user message, so the
  // error paths' plain `pop()` would remove the proposal and STRAND the
  // unanswered user message in history — forwarded to the model on the very
  // next turn. The rollback must clear both.
  test('a failed turn rolls back both the rendered proposal and the unanswered user message', async () => {
    const { exports: m, questionInput } = loadClient({
      fetchImpl: () => sseResponse([
        proposalFrame(PROPOSAL),
        sseFrame('error', { message: 'boom' }),
      ]),
    });
    questionInput.value = 'is there a proposal?';
    m.submitQuestion();
    await flush();
    looseDeepEqual(m.getChatHistory(), []);
  });

  // The NETWORK-FAILURE face of the same rollback (`public/flight-companion.js:1506`,
  // the fetch-rejection `.catch`) — implemented by the fix but, per the Opus shadow
  // review on PR #1487, unpinned: only the mid-stream `error` frame face above was
  // covered. This drives that exit as a genuine mid-stream transport drop: the fetch
  // delivers the `proposed` tool frame and THEN rejects on the next read, so the
  // proposal is already in chatHistory when the connection dies — the exact scenario
  // the :1506 comment names. A bare `fetchImpl: () => Promise.reject(...)` cannot
  // witness this (with no proposal ever rendered, a plain `pop()` would behave
  // identically to the rollback, so the mutation check would not go red); the
  // proposal must be rendered first.
  test('a network failure mid-stream rolls back the rendered proposal and the unanswered user message from chatHistory and the stored session', async () => {
    const storage = makeFakeStorage();
    const { exports: m, questionInput } = loadClient({
      storageImpl: storage,
      fetchImpl: () => ({
        ok: true,
        status: 200,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
        body: {
          getReader() {
            let reads = 0;
            return {
              read() {
                reads += 1;
                if (reads === 1) {
                  return Promise.resolve({ done: false, value: new TextEncoder().encode(proposalFrame(PROPOSAL)) });
                }
                return Promise.reject(new Error('connection reset'));
              },
            };
          },
        },
      }),
    });
    questionInput.value = 'is there a proposal?';
    m.submitQuestion();
    await flush();

    // The network-failure exit must clear BOTH the rendered proposal and the
    // unanswered user message — from memory AND from the stored session the next
    // page load would rehydrate from. (LIN-2771: the cadence record rides the
    // same blob with a nondeterministic wall-clock anchor, so the stored-session
    // claim is asserted field-by-field, including that the cadence is not
    // stopped.)
    looseDeepEqual(m.getChatHistory(), []);
    const stored = m.loadStoredSession('acme');
    looseDeepEqual(stored.history, []);
    assert.strictEqual(stored.tabCheckInCount, 0);
    assert.strictEqual(stored.tabTotalCost, 0);
    assert.strictEqual(stored.selectedModel, null);
    assert.strictEqual(stored.cadence.stoppedReason, null);
  });
});
