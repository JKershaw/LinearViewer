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
    // LIN-2632 beat 2: flight-companion.js now calls
    // window.ChatUI.toolBreadcrumbLabel for its tool breadcrumbs — sourced
    // from the REAL chat.js (loadChatUI(), defined further down this file)
    // rather than a second hand-rolled fake, so a real regression in the
    // shared label helper fails these tests too, not just its own.
    toolBreadcrumbLabel: loadChatUI().toolBreadcrumbLabel,
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
  doc._byId['flight-companion-thread'] = thread;
  doc._byId['flight-companion-chat-empty'] = emptyState;
  doc._byId['flight-companion-checkin'] = checkIn;
  doc._byId['flight-companion-question'] = questionInput;
  doc._byId['flight-companion-send'] = sendBtn;
  doc._byId['flight-companion-start'] = startBtn;
  doc._byId['flight-companion-reorient'] = reorientBtn;
  doc._byId['flight-companion-strip-next'] = stripNextEl;
  doc._byId['flight-companion-strip-tab-total'] = stripTabTotalEl;

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
    doc, thread, emptyState, checkIn, questionInput, sendBtn, startBtn, reorientBtn, stripNextEl, stripTabTotalEl,
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

  test('doneCadenceEffect: a boot always resets, regardless of surface — LIN-2622, "reset on done ONLY"', () => {
    const { exports: m } = loadClient();
    assert.strictEqual(m.doneCadenceEffect('boot', undefined), 'reset');
    assert.strictEqual(m.doneCadenceEffect('boot', true), 'reset');
    assert.strictEqual(m.doneCadenceEffect('boot', false), 'reset');
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
    assert.strictEqual(m.formatTabTotal(1, 0.00042), '1 check-ins · $0.0004 this tab');
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
    assert.strictEqual(m.getTabTotalText(), '1 check-ins · $0.5000 this tab');
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
function loadChatUI() {
  const sandbox = { window: {}, console };
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
