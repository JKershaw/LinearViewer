/**
 * LIN-2933 committed cross-seam witness (approved plan step 7 — the
 * research's scratch harness, comment `22a3db2b` §2, made permanent).
 *
 * The ticket's research found that NO existing test crosses the real
 * client → route seam for a ruling reply: tests/unit/reply-delivery-
 * contract.test.js exercises the real public/common.js but against a
 * stubbed fetch, and tests/unit/observation-ruling-delivery.test.js
 * exercises the real public/observation.js but with window.ReplyDelivery
 * itself stubbed out. Both individually-real halves can hide a defect at
 * the seam between them — which is exactly what the ticket's own
 * originally-proposed COUNT-keyed witness did (it passed a client-only
 * retry that would have failed 5/5 on the real 2026-09-23 incident; see the
 * research comment for the decisive experiment).
 *
 * This file combines, for real, all three: the real `deliverRulingReply`
 * (public/observation.js), the real `window.ReplyDelivery` IIFE
 * (public/common.js, unstubbed), and a real HTTP round-trip to the real
 * Express comment route (routes/workspace-api.js, mounted via
 * createWorkspaceApiRoutes) — against a CREDENTIAL-KEYED fake Linear
 * provider, not a count-keyed one, per the research's own correction.
 *
 * Uses the `task-bound` disposition (LIN-2215), not `resumable`: it is
 * comment-only (no dispatch item, so no need to also stand up the
 * /api/dispatch route here), and it is one of the four C1 sites this
 * ticket changed the failure message for — so it still exercises the exact
 * channel under test: window.ReplyDelivery.postComment → the comment
 * route's credential recovery → the route's classified error response →
 * observation.js's rulingReplyFailureMessage. The route-level recovery
 * cases (a)-(f) live in tests/unit/comment-write-route.test.js; this file's
 * job is the one cross-seam proof step 7 calls for, not a second copy of
 * that coverage.
 *
 * Two cases, mirroring the research's own decisive experiment (§2):
 *  - credential-keyed recovery → the press lands ("recorded ✓"), buttons
 *    re-enable.
 *  - persistent dead credential → the named LINEAR_AUTH message, the row
 *    is restored (buttons re-enabled), and the comment is never recorded.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_JS_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');
const OBSERVATION_JS_SRC = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');

// ─── Minimal DOM shim (same shape as tests/unit/observation-ruling-delivery.test.js) ───

class FakeClassList {
  constructor(el) { this.el = el; this._set = new Set(); }
  add(...names) { names.forEach(n => this._set.add(n)); this._sync(); }
  remove(...names) { names.forEach(n => this._set.delete(n)); this._sync(); }
  contains(name) { return this._set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this._set.has(name) : force;
    if (on) this._set.add(name); else this._set.delete(name);
    this._sync();
    return on;
  }
  _sync() { this.el._className = Array.from(this._set).join(' '); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this._className = '';
    this._textContent = '';
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.disabled = false;
    this.type = undefined;
    this.classList = new FakeClassList(this);
    this.attrs = {};
    this.parentNode = null;
  }
  get className() { return this._className; }
  set className(v) { this._className = v; this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = v; this.children = []; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); }
  click() { (this.listeners.click || []).forEach(fn => fn({ type: 'click' })); }
  _matches(el, selector) {
    return selector.split(',').some((part) => {
      const trimmed = part.trim();
      return trimmed.startsWith('.') && el.classList.contains(trimmed.slice(1));
    });
  }
  querySelectorAll(selector) {
    const matches = [];
    const walk = (node) => { for (const child of node.children) { if (this._matches(child, selector)) matches.push(child); walk(child); } };
    walk(this);
    return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeLi() {
  const li = new FakeElement('li');
  const approve = new FakeElement('button');
  approve.className = 'chat-option-btn';
  approve.textContent = 'Approve';
  li.appendChild(approve);
  const feedback = new FakeElement('p');
  feedback.className = 'obs-ruling-feedback';
  li.appendChild(feedback);
  return li;
}

// ─── Sandbox: the REAL common.js + the REAL observation.js, sharing one window ───

function makeSandbox(origin) {
  const sandbox = {
    module: { exports: {} },
    confirm: () => true,
    window: {
      _listeners: {},
      addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); },
      matchMedia: () => ({ matches: false }),
      location: { origin },
      ChatUI: { appendOptions() {}, resolveCaption: () => 'no action available yet' },
    },
    document: {
      createElement: (tag) => new FakeElement(tag),
      addEventListener() {},
      getElementById: () => null,
    },
    localStorage: { getItem: () => null, setItem() {} },
    escapeHtml: (str) => (str === undefined || str === null ? '' : String(str)),
    relativeTime: (ts) => (ts ? `stub-relative-time(${ts})` : ''),
    console: { warn() {}, error() {}, log() {} },
    // Relative-URL fetch, real network — window.ReplyDelivery.postComment
    // builds `/workspace/...` paths, and native fetch needs an absolute URL.
    fetch(url, opts) {
      const absolute = typeof url === 'string' && url.startsWith('/') ? origin + url : url;
      return fetch(absolute, opts);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS_SRC, sandbox, { filename: 'common.js' });
  vm.runInContext(OBSERVATION_JS_SRC, sandbox, { filename: 'observation.js' });
  return sandbox;
}

// ─── Credential-keyed fake Linear provider + owner-credential store ───────

function authError() {
  const err = new Error('Authentication required, not authenticated');
  err.status = 401;
  return err;
}

function makeCredentialKeyedProvider(rejectedTokens) {
  const calls = { createComment: [] };
  const provider = {
    name: 'linear',
    ui: { displayName: 'Linear' },
    supports: (cap) => cap === 'createComment',
    async issueWriteGuard() { return { id: 'iss-1', trashed: false, team: { id: 'team-x' } }; },
    async createComment(token, issueId, body) {
      calls.createComment.push(token);
      if (rejectedTokens.includes(token)) throw authError();
      return { success: true, comment: { id: `c-${calls.createComment.length}`, body, createdAt: new Date().toISOString(), user: { name: 'Linear' } } };
    },
  };
  return { provider, calls };
}

function makeOwnerCredentialStore(record) {
  const calls = [];
  return { store: { async get(accountId, urlKey, providerName) { calls.push({ accountId, urlKey, providerName }); return record; } }, calls };
}

async function startApp({ provider, ownerCredentialStore, accessToken }) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());
  const session = { accountId: 'acct-witness', save: (cb) => cb(null) };
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: URL_KEY, provider: 'linear', accessToken };
      req.session = session;
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
    // LIN-2889: stampDecisionAnswers now calls the shared answer() op, not
    // markOutcome() directly — this witness's task stamp must actually land
    // (rather than throwing a logged TypeError) for the recovery-tail
    // fidelity it exists to check.
    taskDecisionsStore: { answer: async () => ({ record: { outcome: 'answered' }, firstStampWins: true, unretried: false }) },
    harbourCommentsStore: null,
    sessionsFeedCache: null,
    ownerCredentialStore,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return server;
}

const URL_KEY = 'the-witness-workspace';
const REJECTED_TOKEN = 'session-token-dead';
const FRESH_TOKEN = 'durable-token-fresh';

function makeRow() {
  return {
    decision: { decision_id: 'd-witness-1' },
    anchor: {
      loopId: null,
      issueId: '11111111-2222-3333-4444-555555555555',
      issueIdentifier: 'LIN-2933-W',
      workspaceUrlKey: URL_KEY,
      target: null,
      followUpTo: null,
      taskDecisionId: 'scan_11111111_aaaaaaaaaaaa',
    },
    disposition: 'task-bound',
  };
}

describe('LIN-2933 cross-seam witness: real deliverRulingReply → real window.ReplyDelivery → real comment route', () => {
  test('credential-keyed recovery: the press lands — "recorded ✓", buttons re-enable, provider called original+retry', async () => {
    const { provider, calls } = makeCredentialKeyedProvider([REJECTED_TOKEN]);
    const { store: ownerCredentialStore } = makeOwnerCredentialStore({ token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear' });
    const server = await startApp({ provider, ownerCredentialStore, accessToken: REJECTED_TOKEN });
    try {
      const { port } = server.address();
      const sandbox = makeSandbox(`http://127.0.0.1:${port}`);
      const { deliverRulingReply } = sandbox.module.exports;
      const li = makeLi();

      // Distinct prompt text from the other case below — the route's dedupe
      // cache is keyed on (urlKey, issueId, body, generation) and is a
      // MODULE-LEVEL cache shared across every test in this process; an
      // identical body would make the second case a cache hit instead of a
      // real write.
      await deliverRulingReply(makeRow(), 'Approve — recovery case', li);

      const feedback = li.querySelector('.obs-ruling-feedback');
      assert.match(feedback.textContent, /recorded ✓/, 'the press lands once the server has adopted a different credential');
      const buttons = li.querySelectorAll('.chat-option-btn');
      buttons.forEach((b) => assert.equal(b.disabled, false, 'buttons re-enable once the ruling settles'));
      assert.deepStrictEqual(calls.createComment, [REJECTED_TOKEN, FRESH_TOKEN], 'the original attempt used the dead session token; the recovered retry used the adopted one');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('persistent dead credential: named LINEAR_AUTH message, row restored, no comment ever recorded', async () => {
    const { provider, calls } = makeCredentialKeyedProvider([REJECTED_TOKEN]);
    const { store: ownerCredentialStore } = makeOwnerCredentialStore({ token: REJECTED_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear' });
    const server = await startApp({ provider, ownerCredentialStore, accessToken: REJECTED_TOKEN });
    try {
      const { port } = server.address();
      const sandbox = makeSandbox(`http://127.0.0.1:${port}`);
      const { deliverRulingReply } = sandbox.module.exports;
      const li = makeLi();

      await deliverRulingReply(makeRow(), 'Approve — persistent-failure case', li);

      const feedback = li.querySelector('.obs-ruling-feedback');
      assert.match(feedback.textContent, /Linear rejected the request as unauthenticated/, 'the named cause reaches the UI, not a bare "Failed to create comment"');
      assert.match(feedback.textContent, /Sign in again and press once more/);
      assert.equal(feedback.classList.contains('obs-ruling-feedback--error'), true);
      const buttons = li.querySelectorAll('.chat-option-btn');
      buttons.forEach((b) => assert.equal(b.disabled, false, 'the row is restored — never left stuck disabled'));
      assert.strictEqual(calls.createComment.length, 1, 'no comment is ever recorded for a press that never succeeded');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
