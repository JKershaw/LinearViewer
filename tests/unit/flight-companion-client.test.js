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
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
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
  dispatch(type) { (this._listeners[type] || []).forEach(fn => fn()); }
  focus() {}
}

function makeDocument({ hiddenInitial = false } = {}) {
  const byId = {};
  const listeners = {};
  let page = null;
  const doc = {
    get hidden() { return doc._hidden; },
    set hidden(v) { doc._hidden = v; },
    _hidden: hiddenInitial,
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

function makeChatUI() {
  const calls = { appendMessage: [], appendNote: [] };
  return {
    calls,
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

function loadClient({ hiddenInitial = false, fetchImpl, apiImpl } = {}) {
  const doc = makeDocument({ hiddenInitial });
  const page = new FakeElement('main');
  page.dataset.urlKey = 'acme';
  doc._setPage(page);

  const thread = new FakeElement('ul');
  const emptyState = new FakeElement('p');
  const checkIn = new FakeElement('p');
  checkIn.hidden = true;
  const questionInput = new FakeElement('input');
  const sendBtn = new FakeElement('button');
  doc._byId['flight-companion-thread'] = thread;
  doc._byId['flight-companion-chat-empty'] = emptyState;
  doc._byId['flight-companion-checkin'] = checkIn;
  doc._byId['flight-companion-question'] = questionInput;
  doc._byId['flight-companion-send'] = sendBtn;

  const chatUI = makeChatUI();
  const fetchSpy = makeFetchSpy(fetchImpl || (() => jsonResponse(200, { turnKind: 'auto-wake', spent: false, reason: 'no-census' })));
  const apiSpy = makeApiSpy(apiImpl || (async () => { throw Object.assign(new Error('unexpected api call'), { status: 500 }); }));

  const windowShim = {
    ChatUI: chatUI,
    api: apiSpy,
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
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_SRC, sandbox, { filename: 'flight-companion.js' });

  return {
    exports: sandbox.module.exports,
    doc, thread, emptyState, checkIn, questionInput, sendBtn,
    chatUICalls: chatUI.calls,
    fetchCalls: fetchSpy.calls,
    apiCalls: apiSpy.calls,
    windowShim,
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

  test('advanceCadence: double/reset/stop reducer, and stopped is a true terminal state', () => {
    const { exports: m } = loadClient();
    let s = { delayMs: 30000, stopped: false };
    s = m.advanceCadence(s, 'double');
    looseDeepEqual(s, { delayMs: 60000, stopped: false });
    s = m.advanceCadence(s, 'double');
    looseDeepEqual(s, { delayMs: 120000, stopped: false });
    s = m.advanceCadence(s, 'double');
    looseDeepEqual(s, { delayMs: 180000, stopped: false });
    s = m.advanceCadence(s, 'double');
    looseDeepEqual(s, { delayMs: 180000, stopped: false }, 'capped');
    s = m.advanceCadence(s, 'reset');
    looseDeepEqual(s, { delayMs: 30000, stopped: false });
    s = m.advanceCadence(s, 'stop');
    looseDeepEqual(s, { delayMs: 30000, stopped: true });
    // Terminal: nothing un-stops it.
    looseDeepEqual(m.advanceCadence(s, 'reset'), { delayMs: 30000, stopped: true });
    looseDeepEqual(m.advanceCadence(s, 'double'), { delayMs: 30000, stopped: true });
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

  test('AC3: an auto-wake tick emitting only tool call/result frames appends ZERO rows', async () => {
    const { exports: m, thread, chatUICalls } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'call', id: '1', name: 'get_stack' }),
        sseFrame('tool', { phase: 'result', id: '1', name: 'get_stack', result: '{}' }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(thread.children.length, 0, 'a tool-only tick must not paint an empty bubble');
    assert.strictEqual(chatUICalls.appendMessage.length, 0, 'no bubble may be created for a tool-only turn');
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

  test('call/result(non-proposed)/error phases render no UI', async () => {
    const { exports: m, chatUICalls } = loadClient({
      fetchImpl: () => sseResponse([
        sseFrame('tool', { phase: 'call', id: '1', name: 'get_stack' }),
        sseFrame('tool', { phase: 'result', id: '1', name: 'get_stack', result: '{}' }),
        sseFrame('tool', { phase: 'error', id: '2', name: 'get_session', error: 'boom' }),
        sseFrame('done', { surface: true }),
      ]),
    });
    m.autoWakeTick();
    await flush();
    assert.strictEqual(chatUICalls.appendNote.length, 0);
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
