/**
 * LIN-3126 residual — acceptance witness for the five remaining issue-addressed
 * senders plus the rulings-feed anchor producer.
 *
 * Seed: the same two-repo, connection-backed GitHub workspace the slice-1/2/3
 * witnesses use (repoA active + repoB non-active). The class under test (plan
 * §1 "client hop" + review `59016a77`): every issue-addressed request on these
 * residual paths must carry the issue's `source` + `bindingScope`, or a
 * two-binding connection-backed workspace refuses it with
 * `422 BINDING_REQUIRED`.
 *
 * The five senders the review named:
 *   1. public/observation.js  startDueBulkScan          (LIN-3256)
 *   2. public/common.js       deliverRulingDispatch     (LIN-3310)
 *   3. public/session.js      the run-page Close out press (LIN-3310)
 *   4. public/swipe.js        loadComments              (no ticket)
 *   5. public/observation.js  requestBasisCheck + issueDismissRequest (no ticket)
 *
 * Plus the producer gap: the rulings-feed anchors in lib/unanswered-decisions.js
 * must carry the pair, sourced from the loop's dispatch row
 * (lib/pipeline-loops.js) and the task-decision entry
 * (lib/task-decisions-store.js).
 *
 * Fails before (red) on the unfixed head `9db497f1`:
 *   - pipeline-loops loop shape has no issueSource/issueBindingScope
 *   - unanswered-decisions anchors carry only issueId/issueIdentifier
 *   - task-decisions-store recordScan/toRecord carry no pair
 *   - all five senders build requests with no `source`/`bindingScope`
 *
 * Run with: node --test tests/unit/lin-3126-residual-forwarding.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { collectUnansweredDecisions } from '../../lib/unanswered-decisions.js';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, '../../', rel), 'utf8');

const REPO_A = 'octo/repoA';
const REPO_B = 'octo/repoB';
const SOURCE = 'github';
const PAIR = { source: SOURCE, bindingScope: REPO_B };
const NOW = new Date('2026-08-22T12:00:00.000Z');
const flush = async (times = 12) => { for (let i = 0; i < times; i++) await new Promise(r => setImmediate(r)); };

// ---------------------------------------------------------------------------
// Producer: the anchor pair rides from the loop's dispatch row and the
// task-decision entry up through the rulings feed.
// ---------------------------------------------------------------------------
describe('LIN-3126 residual producer — the anchor pair', () => {
  function liveItem(overrides = {}) {
    return {
      id: 'live-1',
      promptName: 'plan',
      prompt: 'plan prompt text',
      issueId: '11111111-2222-3333-4444-555555555555',
      issueIdentifier: 'GB-1',
      issueTitle: 'Repo B issue',
      issueUrl: 'https://github.com/octo/repoB/issues/1',
      workspace: { urlKey: 'acme' },
      dispatchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      dispatchedBy: 'user-1',
      target: 'cli',
      repo: null,
      ...overrides,
    };
  }

  function storesWith(live = []) {
    return {
      dispatchStore: {
        async listItems() { return live; },
        async listHistory() { return { items: [], total: 0 }; },
      },
      agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
    };
  }

  test('getLoopsForWorkspace carries the row pair onto the loop', async () => {
    const loops = await getLoopsForWorkspace('acme', storesWith([liveItem({ issueSource: SOURCE, issueBindingScope: REPO_B })]));
    assert.equal(loops.length, 1);
    assert.equal(loops[0].issueSource, SOURCE, 'loop carries issueSource');
    assert.equal(loops[0].issueBindingScope, REPO_B, 'loop carries issueBindingScope');
  });

  test('a loop-backed ruling anchor carries the pair (issueSource/issueBindingScope)', () => {
    const loop = {
      loopId: 'loop-1',
      issueId: '11111111-2222-3333-4444-555555555555',
      issueIdentifier: 'GB-1',
      workspaceUrlKey: 'acme',
      target: 'cli',
      followUpTo: null,
      terminalStatus: null,
      terminalCompletedAt: null,
      wakeMarker: null,
      agentState: null,
      decision: { decision_id: 'd-1', question: 'Proceed?' },
      decisionCase: [],
      answeredDecisions: [],
      issueSource: SOURCE,
      issueBindingScope: REPO_B,
    };
    const rows = collectUnansweredDecisions({ loops: [loop] }, { now: NOW });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].anchor.source, SOURCE);
    assert.equal(rows[0].anchor.bindingScope, REPO_B);
  });

  test('a task-decision row anchor carries the pair', () => {
    const entry = {
      id: 'scan_row_1',
      urlKey: 'acme',
      issueId: '11111111-2222-3333-4444-555555555555',
      issueIdentifier: 'GB-1',
      decision: { decision_id: 'd-1', question: 'Proceed?' },
      outcome: null,
      scannedAt: NOW,
      issueSource: SOURCE,
      issueBindingScope: REPO_B,
    };
    const rows = collectUnansweredDecisions({ taskDecisions: [entry] }, { now: NOW });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].anchor.source, SOURCE);
    assert.equal(rows[0].anchor.bindingScope, REPO_B);
  });

  test('TaskDecisionsStore.recordScan stores and exposes the pair', async () => {
    const store = new TaskDecisionsStore({ collection: createMockCollection() });
    const rec = await store.recordScan({
      urlKey: 'acme',
      issueId: '11111111-2222-3333-4444-555555555555',
      issueIdentifier: 'GB-1',
      inputHash: 'deadbeefcafe',
      decision: null,
      issueSource: SOURCE,
      issueBindingScope: REPO_B,
    });
    assert.ok(rec, 'recordScan persisted');
    assert.equal(rec.issueSource, SOURCE);
    assert.equal(rec.issueBindingScope, REPO_B);

    const status = await store.getStatus('acme', '11111111-2222-3333-4444-555555555555');
    assert.equal(status.issueSource, SOURCE, 'the read path exposes the pair too');
    assert.equal(status.issueBindingScope, REPO_B);
  });

  test('unstamped loop/row stay byte-identical: no pair keys at all (no undefined/null)', async () => {
    const loops = await getLoopsForWorkspace('acme', storesWith([liveItem()]));
    assert.ok(!('issueSource' in loops[0]), 'unstamped loop adds no issueSource key');
    assert.ok(!('issueBindingScope' in loops[0]), 'unstamped loop adds no issueBindingScope key');

    const loop = {
      loopId: 'loop-1',
      issueId: '11111111-2222-3333-4444-555555555555',
      issueIdentifier: 'GB-1',
      workspaceUrlKey: 'acme',
      target: 'cli',
      followUpTo: null,
      terminalStatus: null,
      terminalCompletedAt: null,
      wakeMarker: null,
      agentState: null,
      decision: { decision_id: 'd-1', question: 'Proceed?' },
      decisionCase: [],
      answeredDecisions: [],
    };
    const loopAnchor = collectUnansweredDecisions({ loops: [loop] }, { now: NOW })[0].anchor;
    assert.ok(!('source' in loopAnchor), 'unstamped loop anchor adds no source key');
    assert.ok(!('bindingScope' in loopAnchor), 'unstamped loop anchor adds no bindingScope key');

    const taskAnchor = collectUnansweredDecisions({
      taskDecisions: [{ id: 'scan_row_legacy', urlKey: 'acme', issueId: '11111111-2222-3333-4444-555555555555', issueIdentifier: 'GB-1', decision: { decision_id: 'd-1', question: 'P?' }, outcome: null, scannedAt: NOW }],
    }, { now: NOW })[0].anchor;
    assert.ok(!('source' in taskAnchor) && !('bindingScope' in taskAnchor), 'unstamped task anchor adds no pair keys');
  });

  test('a scan row written before the pair existed still reads (no migration)', async () => {
    const collection = createMockCollection();
    const legacyDoc = {
      _id: 'scan_legacy_0001',
      urlKey: 'acme',
      issueId: '11111111-2222-3333-4444-555555555555',
      issueIdentifier: 'GB-1',
      inputHash: 'legacyhash000',
      decision: { decision_id: 'd-legacy', question: 'P?' },
      scannedAt: new Date(NOW),
      seq: 0,
      outcome: null,
      outcomeAt: null,
    };
    await collection.updateOne({ _id: legacyDoc._id, urlKey: 'acme' }, { $set: legacyDoc }, { upsert: true });
    const store = new TaskDecisionsStore({ collection });

    const status = await store.getStatus('acme', '11111111-2222-3333-4444-555555555555');
    assert.ok(status, 'the legacy row is readable');
    assert.ok(!('issueSource' in status) && !('issueBindingScope' in status), 'no keys invented for a legacy row');
  });
});

// ---------------------------------------------------------------------------
// Shared vm sandbox for public/observation.js (DOM-free: load-time needs none,
// call-time needs only document.getElementById/window.api).
// ---------------------------------------------------------------------------
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.dataset = {};
    this._attrs = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  insertAdjacentHTML() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k] ?? null; }
  classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}

function makeObservationSandbox({ api } = {}) {
  const dueList = new FakeElement('ul');
  const sandbox = {
    module: { exports: {} },
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendOptions() {} },
      ScanSection: { postScan: async () => ({ ok: true }) },
      api: api || (async () => ({ comments: [] })),
    },
    document: {
      createElement: (tag) => new FakeElement(tag),
      addEventListener() {},
      getElementById: (id) => (id === 'obs-due-list' ? dueList : null),
    },
    localStorage: { getItem: () => null, setItem() {} },
    escapeHtml: (str) => (str === undefined || str === null ? '' : String(str)),
    relativeTime: (ts) => (ts ? `rel(${ts})` : ''),
    URLSearchParams,
    AbortController,
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  // The REAL common.js first, so observation.js's new senders use the SHARED
  // `window.sourceBindingQuery` builder (as they do on every real page, where
  // common.js is loaded before page scripts). common.js installs its own
  // `window.api`, so the per-test stub is applied AFTER the load.
  vm.runInContext(read('public/common.js'), sandbox, { filename: 'common.js' });
  if (api) sandbox.window.api = api;
  vm.runInContext(read('public/observation.js'), sandbox, { filename: 'observation.js' });
  return { sandbox, dueList };
}

// ---------------------------------------------------------------------------
// Sender 1 — startDueBulkScan (public/observation.js): every per-item POST
// carries the due row's own source + bindingScope.
// ---------------------------------------------------------------------------
describe('LIN-3126 residual sender 1 — startDueBulkScan forwards the pair (LIN-3256)', () => {
  test('each selected due item posts with source + bindingScope', async () => {
    const calls = [];
    const { sandbox } = makeObservationSandbox({ api: async () => ({ comments: [] }) });
    sandbox.window.ScanSection.postScan = async (...args) => { calls.push(args); return { ok: true }; };
    const obs = sandbox.module.exports;

    obs.paintDuePage([
      { issueId: '11111111-2222-3333-4444-555555555555', issueIdentifier: 'GB-1', dueStatus: true, source: SOURCE, bindingScope: REPO_B },
      { issueId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', issueIdentifier: 'GA-1', dueStatus: true, source: SOURCE, bindingScope: REPO_A },
    ], 2, { append: false });

    obs.toggleDueSelection('11111111-2222-3333-4444-555555555555', true);
    obs.startDueBulkScan();
    await flush();

    assert.equal(calls.length, 1, 'exactly one scan fired');
    assert.equal(calls[0][2], SOURCE, 'postScan source argument');
    assert.equal(calls[0][3], REPO_B, 'postScan bindingScope argument');
  });
});

// ---------------------------------------------------------------------------
// Sender 5 — requestBasisCheck + issueDismissRequest (public/observation.js).
// ---------------------------------------------------------------------------
describe('LIN-3126 residual sender 5 — rulings scan reads/dismiss forward the pair', () => {
  test('requestBasisCheck asks /api/scan/:issueId with source + bindingScope', async () => {
    const urls = [];
    const { sandbox } = makeObservationSandbox({ api: async (url) => { urls.push(url); return { basisChanged: false }; } });
    vm.runInContext('currentView = "rulings";', sandbox);
    const { requestBasisCheck } = sandbox.module.exports;

    requestBasisCheck({
      loopId: null,
      taskDecisionId: 'scan_row_pair',
      issueId: '11111111-2222-3333-4444-555555555555',
      workspaceUrlKey: 'acme',
      source: SOURCE,
      bindingScope: REPO_B,
    }, new FakeElement('p'));
    await flush();

    assert.equal(urls.length, 1, 'one basis check fired');
    assert.match(urls[0], /\/api\/scan\/11111111-2222-3333-4444-555555555555\?source=github&bindingScope=octo%2FrepoB$/);
  });

  test('issueDismissRequest (task-bound) posts to /dismiss with source + bindingScope', async () => {
    const urls = [];
    const { sandbox } = makeObservationSandbox({ api: async (url) => { urls.push(url); return {}; } });
    const { issueDismissRequest } = sandbox.module.exports;

    issueDismissRequest({
      loopId: null,
      taskDecisionId: 'scan_row_pair',
      issueId: '11111111-2222-3333-4444-555555555555',
      workspaceUrlKey: 'acme',
      source: SOURCE,
      bindingScope: REPO_B,
    }, 'd-1', null);
    await flush();

    assert.equal(urls.length, 1, 'one dismiss landed');
    assert.match(urls[0], /\/api\/scan\/11111111-2222-3333-4444-555555555555\/dismiss\?source=github&bindingScope=octo%2FrepoB$/);
  });
});

// ---------------------------------------------------------------------------
// Sender 2 — deliverRulingDispatch (public/common.js): BOTH the comment write
// and the fresh-run dispatch carry the pair.
// ---------------------------------------------------------------------------
function makeCommonSandbox({ api, dispatchPrompt } = {}) {
  const fetches = [];
  const sandbox = {
    window: { location: { origin: 'http://test.local' } },
    document: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    console,
    URLSearchParams,
    fetch(url, opts) { fetches.push({ url, opts }); return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) }); },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/common.js'), sandbox, { filename: 'common.js' });
  sandbox.window.api = api || (async () => ({ hydrated: true, state: { type: 'started' } }));
  sandbox.window.dispatchPrompt = dispatchPrompt || (async () => ({ id: 'd-1' }));
  return { window: sandbox.window, fetches };
}

describe('LIN-3126 residual sender 2 — deliverRulingDispatch forwards the pair (LIN-3310)', () => {
  test('the comment write AND the fresh-run dispatch both carry source + bindingScope', async () => {
    const dispatched = [];
    const { window, fetches } = makeCommonSandbox({
      dispatchPrompt: async (opts) => { dispatched.push(opts); return { id: 'd-1' }; },
    });

    await window.ReplyDelivery.deliverRulingDispatch({
      urlKey: 'acme',
      issueId: '11111111-2222-3333-4444-555555555555',
      issueIdentifier: 'GB-1',
      target: 'cli',
      decisionLoopId: 'loop-1',
      decisionId: 'd-1',
      source: SOURCE,
      bindingScope: REPO_B,
      prompt: 'my answer',
      dispatchPrompt: 'composed brief',
    }, {
      onCommentFailed() {}, onPartialFailure() {}, onDispatchOk() {}, onNoLinkedIssue() {},
    });

    assert.equal(fetches.length, 1, 'one comment write');
    assert.match(fetches[0].url, /\/api\/comments\/11111111-2222-3333-4444-555555555555\?source=github&bindingScope=octo%2FrepoB$/);

    assert.equal(dispatched.length, 1, 'one dispatch');
    assert.equal(dispatched[0].issue.source, SOURCE, 'dispatch issue.source');
    assert.equal(dispatched[0].issue.bindingScope, REPO_B, 'dispatch issue.bindingScope');
  });
});

// ---------------------------------------------------------------------------
// Sender 3 — the run-page Close out press (public/session.js): the fresh-run
// dispatch carries the pair read off the run page's own DOM stamps.
// ---------------------------------------------------------------------------
function makeSessionSandbox({ closedOut } = {}) {
  const dispatchCalls = [];
  const closeOutBox = new FakeElement('div');
  closeOutBox._attrs['data-url-key'] = 'acme';
  closeOutBox._attrs['data-issue-identifier'] = 'GB-1';
  // The binding pair lives on the run page's inline reply box (stamped by
  // lib/render-session.js from the loop's dispatch row), NOT on the close-out
  // box — the same source closeOutContext already reads issueId from.
  const replyBox = new FakeElement('div');
  replyBox._attrs['data-url-key'] = 'acme';
  replyBox._attrs['data-issue-id'] = '11111111-2222-3333-4444-555555555555';
  replyBox._attrs['data-issue-identifier'] = 'GB-1';
  replyBox._attrs['data-source'] = SOURCE;
  replyBox._attrs['data-binding-scope'] = REPO_B;

  const sandbox = {
    module: { exports: {} },
    window: {
      addEventListener() {},
      api: async () => ({ prompt: 'close out', promptName: 'close-out', issueTitle: 'Repo B issue' }),
      dispatchPrompt: async (opts) => { dispatchCalls.push(opts); return { id: 'd-1' }; },
      ReplyDelivery: { postComment: async () => ({ ok: true }), errorFromResult: (r) => new Error('x') },
      ChatUI: { appendMessage() {} },
    },
    document: {
      querySelector: (sel) => (sel.includes('run-evidence-closeout') ? closeOutBox : sel.includes('session-inline-reply') ? replyBox : null),
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener() {},
      createElement: (tag) => new FakeElement(tag),
    },
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read('public/session.js'), sandbox, { filename: 'session.js' });
  return { sandbox, dispatchCalls };
}

describe('LIN-3126 residual sender 3 — the Close out press forwards the pair (LIN-3310)', () => {
  test('pressCloseOut dispatches with the run page\'s source + bindingScope', async () => {
    const { sandbox, dispatchCalls } = makeSessionSandbox();
    const { pressCloseOut } = sandbox.module.exports;
    assert.equal(typeof pressCloseOut, 'function', 'session.js exposes the Close out press seam');

    await pressCloseOut(new FakeElement('button'));
    await flush();

    assert.equal(dispatchCalls.length, 1, 'one close-out dispatch');
    assert.equal(dispatchCalls[0].issue.source, SOURCE, 'dispatch issue.source');
    assert.equal(dispatchCalls[0].issue.bindingScope, REPO_B, 'dispatch issue.bindingScope');
  });
});

// ---------------------------------------------------------------------------
// Sender 4 — swipe comments read (public/swipe.js): one-line pair forward.
// ---------------------------------------------------------------------------
describe('LIN-3126 residual sender 4 — swipe loadComments forwards the pair', () => {
  const swipeSrc = read('public/swipe.js');

  function sliceFunction(src, signature) {
    const start = src.indexOf(signature);
    assert.ok(start !== -1, `marker not found: ${signature}`);
    const end = src.indexOf('\n}', start);
    assert.ok(end !== -1, `closing brace not found for ${signature}`);
    return src.slice(start, end + 2);
  }

  function evalFunction(src, signature, name, args) {
    const ctx = {
      window: {},
      document: { addEventListener() {} },
      localStorage: { getItem: () => null, setItem() {} },
      console: { warn() {}, error() {}, log() {} },
      URLSearchParams, encodeURIComponent, setTimeout, clearTimeout,
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    // Load the REAL common.js so `window.sourceBindingQuery` is the shared
    // builder the shipped swipe sender calls.
    vm.runInContext(read('public/common.js'), ctx, { filename: 'common.js' });
    const fn = vm.runInContext(`${sliceFunction(src, signature)};\n${name}`, ctx);
    return fn(...args);
  }

  test('stamped swipe issue joins source + bindingScope to the comments URL', () => {
    assert.equal(
      evalFunction(swipeSrc, 'function swipeCommentsUrl(', 'swipeCommentsUrl', ['/workspace/acme', { id: '1', source: SOURCE, bindingScope: REPO_B }]),
      `/workspace/acme/api/comments/1?source=${SOURCE}&bindingScope=${encodeURIComponent(REPO_B)}`
    );
  });

  test('unstamped swipe issue stays byte-identical (no query)', () => {
    assert.equal(
      evalFunction(swipeSrc, 'function swipeCommentsUrl(', 'swipeCommentsUrl', ['/workspace/acme', { id: '1' }]),
      '/workspace/acme/api/comments/1'
    );
  });
});

// ---------------------------------------------------------------------------
// Session-lane client join (review `5902c5c1`): the run page's inline reply
// reads its own `data-source`/`data-binding-scope` stamps and hands them to
// ReplyDelivery (Send-and-continue) or postComment (Save). Both mutations on
// these reads (session.js:355-356) survived the unit suite before this.
// ---------------------------------------------------------------------------
class ReplyEl {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.innerHTML = '';
    this.disabled = false;
    this.hidden = false;
    this.isConnected = true;
    this._listeners = {};
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  click() { (this._listeners.click || []).forEach((fn) => fn({ preventDefault() {} })); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function makeInlineReplySandbox({ onDeliverReply, onPostComment } = {}) {
  const textarea = new ReplyEl('textarea');
  textarea.value = 'a reply';
  const sendBtn = new ReplyEl('button');
  const saveBtn = new ReplyEl('button');
  const feedback = new ReplyEl('div');
  const thread = new ReplyEl('ul');
  const box = new ReplyEl('div');
  box.dataset = {
    urlKey: 'acme', loopId: 'follow-1', target: 'cli', terminal: 'false', sessionWaiting: 'false',
    issueId: '11111111-2222-3333-4444-555555555555', issueIdentifier: 'GB-1',
    source: SOURCE, bindingScope: REPO_B
  };
  box.querySelector = (sel) => {
    if (sel.includes('reply-input')) return textarea;
    if (sel.includes('sess-reply-send')) return sendBtn;
    if (sel.includes('sess-reply-save')) return saveBtn;
    if (sel.includes('feedback')) return feedback;
    if (sel.includes('thread')) return thread;
    return null;
  };

  const sandbox = {
    module: { exports: {} },
    window: {
      addEventListener() {},
      ChatUI: { appendMessage() {} },
      ReplyDelivery: {
        deliverRulingAnswer(opts, handlers) { onDeliverReply({ opts }); handlers.onDispatchOk(); return Promise.resolve(); },
        postComment(urlKey, issueId, prompt, decision) { onPostComment({ urlKey, issueId, prompt, decision }); return Promise.resolve({ ok: true, status: 201, data: {} }); },
        deliveredEffect(opts) { return opts.effect || 'resume'; }
      }
    },
    document: {
      addEventListener() {},
      querySelectorAll: (sel) => (sel.includes('session-inline-reply') ? [box] : []),
      querySelector: () => null,
      createElement: (tag) => new ReplyEl(tag),
      getElementById: () => null
    },
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read('public/session.js'), sandbox, { filename: 'session.js' });
  return { sandbox, box, sendBtn, saveBtn };
}

describe('LIN-3126 residual session-lane join — the inline reply forwards its stamps', () => {
  test('Send-and-continue hands the box data-source/data-binding-scope to deliverReply', async () => {
    const delivered = [];
    const { sandbox, sendBtn } = makeInlineReplySandbox({ onDeliverReply: (e) => delivered.push(e) });
    sandbox.module.exports.initInlineReplies();
    sendBtn.click();
    await flush();

    assert.equal(delivered.length, 1, 'one reply delivered');
    assert.equal(delivered[0].opts.source, SOURCE, 'deliverReply opts.source');
    assert.equal(delivered[0].opts.bindingScope, REPO_B, 'deliverReply opts.bindingScope');
  });

  test('Save (comment-only) hands the same stamps to postComment', async () => {
    const comments = [];
    const { sandbox, saveBtn } = makeInlineReplySandbox({ onPostComment: (e) => comments.push(e) });
    sandbox.module.exports.initInlineReplies();
    saveBtn.click();
    await flush();

    assert.equal(comments.length, 1, 'one comment written');
    assert.equal(comments[0].decision.source, SOURCE, 'postComment decision.source');
    assert.equal(comments[0].decision.bindingScope, REPO_B, 'postComment decision.bindingScope');
  });
});

// ---------------------------------------------------------------------------
// Pre-PR due rows (review `5902c5c1` "What CI Did Not Prove" item 3): a row
// scanned before this PR stored no pair, so its bulk scan resolves strictly and
// 422s. This drives `startDueBulkScan` itself: the failing row is one item's
// error and the stamped sibling still POSTs — the batch is not aborted. It
// resolves itself once the task is re-scanned from its row (the scan route then
// stores the pair); no migration is needed.
// ---------------------------------------------------------------------------
describe('LIN-3126 residual due rows — an unstamped pre-PR row fails per row, not the batch', () => {
  test('startDueBulkScan still issues the stamped sibling when an unstamped row 422s', async () => {
    const calls = [];
    const { sandbox } = makeObservationSandbox({ api: async () => ({ comments: [] }) });
    sandbox.window.ScanSection.postScan = async (urlKey, identifier, itemSource, itemScope) => {
      calls.push({ identifier, itemSource, itemScope });
      if (identifier === '11111111-2222-3333-4444-555555555555') {
        throw Object.assign(new Error('BINDING_REQUIRED'), { status: 422 });
      }
      return { ok: true };
    };
    const obs = sandbox.module.exports;

    obs.paintDuePage([
      { issueId: '11111111-2222-3333-4444-555555555555', issueIdentifier: 'GB-1', dueStatus: true }, // pre-PR: no pair
      { issueId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', issueIdentifier: 'GA-1', dueStatus: true, source: SOURCE, bindingScope: REPO_A },
    ], 2, { append: false });
    obs.toggleDueSelection('11111111-2222-3333-4444-555555555555', true);
    obs.toggleDueSelection('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', true);

    assert.doesNotThrow(() => obs.startDueBulkScan());
    await flush();

    assert.equal(calls.length, 2, 'both rows POSTed — the 422 row did not abort the batch');
    const failed = calls.find((c) => c.identifier === '11111111-2222-3333-4444-555555555555');
    const ok = calls.find((c) => c.identifier === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.equal(failed.itemSource, undefined, 'the pre-PR row POSTs with no source');
    assert.equal(ok.itemScope, REPO_A, 'the re-scanned sibling carries its pair');
  });
});
