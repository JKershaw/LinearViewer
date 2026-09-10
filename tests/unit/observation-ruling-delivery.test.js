/**
 * LIN-1728 review (`2d47a7c8`) — unit tests for `deliverRulingReply`'s
 * `gone`-disposition path (public/observation.js).
 *
 * F1 — a cross-workspace ruling must write its comment/stamp/dispatch
 * against `anchor.workspaceUrlKey` (the ruling's own workspace), never the
 * page's own workspace. Pinned directly here (not just via the e2e
 * two-workspace test) because this is the exact seam that regresses if
 * someone re-derives `urlKey` from `observationData` instead of `anchor`.
 *
 * F2 — the `gone` branch must preserve the SAME comment-first, dispatch-only
 * retry-delivery invariant the `resumable` branch already has: the comment
 * (already carrying the answer stamp) can succeed while the fresh run fails
 * to start, and that must surface as a durable "recorded, could not start a
 * run" partial failure with a retry affordance that never re-posts the
 * comment — not the bare "reply failed" the pre-fix code gave every gone
 * failure indiscriminately. The review's own note: there is no fixture path
 * in the e2e harness for a terminal, past-the-reap-window loop (that would
 * need a backdating test endpoint that does not exist), so this exercises
 * the press handler directly against a hand-rolled DOM shim instead —
 * mirroring the in-tree pattern in tests/unit/reply-delivery-contract.test.js
 * and tests/unit/chat-append-options.test.js.
 *
 * F4 — a `resumable` ruling with no issue anchor must degrade to the
 * existing issueless delivery path (public/session.js's own precedent:
 * `issueless = !issueIdentifier`, with the id actually used falling back to
 * `issueIdentifier` when there is no separate provider `issueId`) rather
 * than attempting an invalid `/api/comments/null` write. This is unit-only,
 * not e2e, because `lib/pipeline-loops.js`'s own reconstruction guard drops
 * ANY dispatch item with no `issueIdentifier` before it ever reaches
 * `getLoopsForWorkspace` — a truly issueless loop can never be seeded
 * through the live dispatch pipeline the e2e suite drives, only constructed
 * directly here. (This also caught a real regression during development:
 * gating `issueless` on `anchor.issueId` instead of `anchor.issueIdentifier`
 * broke every ordinary resumable ruling, since `anchor.issueId` is null for
 * essentially all of them in this codebase's current reconstruction — only
 * `issueIdentifier` is guaranteed present.)
 *
 * observation.js is a browser script (not an ES module) with real DOM/fetch
 * dependencies at call time but none at *load* time (its two
 * addEventListener calls only run inside `init()`, which this test never
 * calls) — so it is vm-sandboxed the same way tests/unit/observation-
 * render.test.js already does, with `module.exports` extended (see the
 * bottom of public/observation.js) to expose `deliverRulingReply` plus the
 * `rulingsPending`/`preservedRulingRows` state it reads/writes.
 *
 * Run with: node --test tests/unit/observation-ruling-delivery.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBSERVATION_JS_SRC = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');

// ─── Minimal DOM shim ───────────────────────────────────────────────────────
// Just enough of `document`/Element for deliverRulingReply's own usage:
// querySelector/querySelectorAll (class selectors only), createElement,
// classList, textContent, addEventListener/click, disabled.

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
  }
  get className() { return this._className; }
  set className(v) {
    this._className = v;
    this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = v; this.children = []; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }
  click() { (this.listeners.click || []).forEach(fn => fn({ type: 'click' })); }
  _matches(el, selector) {
    // rulingRowControls(li) queries a COMMA-separated list of class
    // selectors (real querySelectorAll supports that natively) — split and
    // match any part, each still a bare `.class` selector.
    return selector.split(',').some((part) => {
      const trimmed = part.trim();
      return trimmed.startsWith('.') && el.classList.contains(trimmed.slice(1));
    });
  }
  querySelectorAll(selector) {
    const matches = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (this._matches(child, selector)) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function makeLi({ withFeedback = true } = {}) {
  const li = new FakeElement('li');
  const approve = new FakeElement('button');
  approve.className = 'chat-option-btn';
  approve.textContent = 'Approve';
  li.appendChild(approve);
  if (withFeedback) {
    const feedback = new FakeElement('p');
    feedback.className = 'obs-ruling-feedback';
    li.appendChild(feedback);
  }
  return li;
}

// `elements` seeds document.getElementById (default: none, so it answers null
// exactly as before — the delivery tests below never touch the document). The
// ChatUI stub is likewise inert for those: only renderRulingRow calls
// appendOptions, and only the LIN-2293 render test reaches it.
//
// LIN-2444 Phase 3: `api` stubs `window.api`, the fetch wrapper
// issueDismissRequest/keepRulingRow call directly (not via
// window.ReplyDelivery). Defaults to a rejecting stub so a test that forgets
// to pass one fails loudly instead of hitting a real TypeError deep in a
// promise chain — `observationData` stays null in every sandbox (it is
// never set here), so `pollRulings()`/`refreshBadge()` no-op safely off
// `observationData?.urlKey` being undefined, needing no stub of their own.
function makeSandbox({ postComment, dispatchPrompt, deliverReply, api, elements = {}, confirm: confirmImpl } = {}) {
  const sandbox = {
    module: { exports: {} },
    // observation.js calls the bare global `confirm(...)` (LIN-511's
    // ratified destructive-action primitive — public/scan.js's own
    // RETIRE_CONFIRM_TEXT precedent), not `window.confirm` — the vm
    // sandbox's free-variable lookup resolves that against the CONTEXT
    // object itself (tests/unit/scan-retire-ui.test.js's same note), so
    // `confirm` is stubbed at the top level, a sibling of `window`. Defaults
    // to accepting, since most tests here aren't exercising the gate itself.
    confirm: confirmImpl || (() => true),
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendOptions() {} },
      ReplyDelivery: {
        postComment,
        deliverReply,
        errorFromResult: (r) => new Error((r.data && r.data.error) || `HTTP ${r.status}`)
      },
      dispatchPrompt,
      api: api || (async () => { throw new Error('window.api not stubbed for this test'); })
    },
    document: {
      createElement: (tag) => new FakeElement(tag),
      addEventListener() {},
      getElementById: (id) => elements[id] || null
    },
    // Browser globals common.js installs and observation.js references bare.
    // Same faithful-copy/stub pattern tests/unit/observation-render.test.js
    // already uses; only renderRulingRow reaches them from this file.
    escapeHtml: (str) => (str === undefined || str === null ? '' : String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;')),
    relativeTime: (ts) => (ts ? `stub-relative-time(${ts})` : ''),
    console: { warn() {}, error() {}, log() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(OBSERVATION_JS_SRC, sandbox, { filename: 'observation.js' });
  return sandbox;
}

const ANCHOR = {
  loopId: 'loop-gone-1',
  issueId: 'issue-1',
  issueIdentifier: 'LIN-1728-G',
  workspaceUrlKey: 'the-ruling-workspace',
  target: 'cli'
};

function makeRow({ decision, anchor, ...rest } = {}) {
  return {
    decision: decision || { decision_id: 'd-gone-1' },
    anchor: { ...ANCHOR, ...(anchor || {}) },
    disposition: 'gone',
    ...rest
  };
}

describe('deliverRulingReply — gone disposition (LIN-1728 review F1/F2)', () => {
  test('F1: the comment write targets anchor.workspaceUrlKey, never a page urlKey', async () => {
    let capturedUrlKey = null;
    const { module } = makeSandbox({
      postComment: async (urlKey) => { capturedUrlKey = urlKey; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => ({ id: 'dispatched-1' })
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeRow(), 'Approve', li);
    // Flush the postComment/dispatchPrompt microtask chain.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(capturedUrlKey, 'the-ruling-workspace');
  });

  test('F1: the fresh dispatch also targets anchor.workspaceUrlKey', async () => {
    let capturedOpts = null;
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async (opts) => { capturedOpts = opts; return { id: 'dispatched-1' }; }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeRow(), 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(capturedOpts, 'expected dispatchPrompt to be called');
    assert.equal(capturedOpts.urlKey, 'the-ruling-workspace');
    assert.equal(capturedOpts.issue.id, 'issue-1');
    assert.equal(capturedOpts.issue.identifier, 'LIN-1728-G');
  });

  test('F2: comment succeeds, the fresh run fails to start — a durable partial-failure surfaces with a retry affordance, the comment is never reposted', async () => {
    let commentCalls = 0;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async () => { commentCalls += 1; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => {
        dispatchCalls += 1;
        if (dispatchCalls === 1) throw new Error('queue temporarily unavailable');
        return { id: 'dispatched-1' };
      }
    });
    const { deliverRulingReply, rulingsPending, preservedRulingRows, rulingKey } = module.exports;
    const li = makeLi();
    const row = makeRow();
    const key = rulingKey('the-ruling-workspace', 'd-gone-1');

    deliverRulingReply(row, 'Approve', li);
    assert.ok(rulingsPending.has(key), 'expected the decision to be marked pending immediately');

    // Flush postComment -> dispatchPrompt (rejects) -> onPartialFailure.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(commentCalls, 1, 'the comment must be posted exactly once');
    assert.equal(dispatchCalls, 1);
    // Partial failure restores the pending guard (matches the resumable
    // branch's existing behaviour) but the row is now tracked for reuse.
    assert.ok(!rulingsPending.has(key));
    assert.ok(preservedRulingRows.has(key), 'expected the row to be preserved across the next poll(s)');

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.ok(feedback, 'expected a feedback element');
    assert.match(feedback.textContent, /Recorded\. Could not start a run/, 'must say the answer was RECORDED, not "reply failed" — the durable half already succeeded');
    assert.ok(feedback.classList.contains('obs-ruling-feedback--error'));

    const retryBtn = feedback.children.find(c => c.classList.contains('obs-ruling-retry-delivery'));
    assert.ok(retryBtn, 'expected a Retry delivery affordance');
    assert.equal(retryBtn.textContent, 'Retry delivery');

    // Press retry: only the dispatch call may re-fire, never the comment.
    retryBtn.click();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(commentCalls, 1, 'the comment must NEVER be reposted by a delivery retry');
    assert.equal(dispatchCalls, 2, 'the retry must re-fire the dispatch call');
    assert.ok(!preservedRulingRows.has(key), 'the preserved row is released once the retry succeeds');
    assert.match(feedback.textContent, /recorded ✓/);
  });

  test('the comment itself failing is a plain failure — no dispatch attempted, no partial-failure retry affordance', async () => {
    let commentCalls = 0;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async () => { commentCalls += 1; return { ok: false, status: 502, data: { error: 'upstream write rejected' } }; },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; }
    });
    const { deliverRulingReply, rulingsPending, preservedRulingRows, rulingKey } = module.exports;
    const li = makeLi();
    const key = rulingKey('the-ruling-workspace', 'd-gone-2');

    deliverRulingReply(makeRow({ decision: { decision_id: 'd-gone-2' } }), 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(commentCalls, 1);
    assert.equal(dispatchCalls, 0, 'a failed comment write must never attempt the dispatch');
    assert.ok(!rulingsPending.has(key));
    assert.ok(!preservedRulingRows.has(key), 'a plain (non-partial) failure must not be treated as durably recorded');

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /reply failed/);
    assert.doesNotMatch(feedback.textContent, /Recorded/, 'the answer was never durably recorded here — must not claim otherwise');
  });

  test('G1: an anchor with an issueIdentifier but no raw issueId is answerable — the identifier is used for both the comment write and the fresh dispatch', async () => {
    // This is the ORDINARY gone-ruling case in this codebase today: every
    // recommend-and-dispatch loop writes issueId: null (routes/proxy.js),
    // so anchor.issueId is null for essentially all of them — only
    // anchor.issueIdentifier is guaranteed present. Gating on the raw id
    // alone (the pre-fix code) stranded every such ruling as "no linked
    // issue" even though the row displays its identifier. Mirrors the
    // resumable branch's own F4 fallback (`issueId || issueIdentifier`).
    let capturedCommentIssueId = null;
    let capturedDispatchOpts = null;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId) => { capturedCommentIssueId = issueId; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async (opts) => { capturedDispatchOpts = opts; return { id: 'dispatched-1' }; }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeRow({ anchor: { issueId: null, issueIdentifier: 'LIN-1728-G' }, decision: { decision_id: 'd-gone-4' } }), 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(capturedCommentIssueId, 'LIN-1728-G', 'the comment write must fall back to the identifier when the raw issueId is absent');
    assert.ok(capturedDispatchOpts, 'expected dispatchPrompt to be called — this ruling must not be rejected as having no linked issue');
    assert.equal(capturedDispatchOpts.issue.id, 'LIN-1728-G');
    assert.equal(capturedDispatchOpts.issue.identifier, 'LIN-1728-G');

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /recorded ✓/);
  });

  test('a gone ruling with no linked issue refuses cleanly rather than posting to /api/comments/null', async () => {
    let postCommentCalled = false;
    const { module } = makeSandbox({
      postComment: async () => { postCommentCalled = true; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => ({ id: 'dispatched-1' })
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeRow({ anchor: { ...ANCHOR, issueId: null, issueIdentifier: null }, decision: { decision_id: 'd-gone-3' } }), 'Approve', li);
    await new Promise((r) => setImmediate(r));

    assert.equal(postCommentCalled, false);
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /no linked issue/);
  });
});

function makeResumableRow({ decision, anchor, ...rest } = {}) {
  return {
    decision: decision || { decision_id: 'd-resumable-1' },
    anchor: { ...ANCHOR, ...(anchor || {}) },
    disposition: 'resumable',
    ...rest
  };
}

describe('deliverRulingReply — resumable disposition (LIN-1728 review F1/F4)', () => {
  test('F1: deliverReply is called with anchor.workspaceUrlKey, never a page urlKey', async () => {
    let capturedOpts = null;
    const { module } = makeSandbox({
      deliverReply: (opts, prompt, handlers) => { capturedOpts = opts; handlers.onDispatchOk(); }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeResumableRow(), 'Approve', li);

    assert.ok(capturedOpts, 'expected deliverReply to be called');
    assert.equal(capturedOpts.urlKey, 'the-ruling-workspace');
  });

  test('F4: an anchor with an issueIdentifier but no raw issueId is NOT issueless — the identifier is used as the write target', async () => {
    // This is the ORDINARY case in this codebase today: lib/pipeline-loops.js
    // requires issueIdentifier for a loop to reconstruct at all, but the raw
    // provider issueId is frequently absent. Mirrors public/session.js's own
    // `issueId = box.dataset.issueId || issueIdentifier` fallback exactly.
    let capturedOpts = null;
    const { module } = makeSandbox({
      deliverReply: (opts, prompt, handlers) => { capturedOpts = opts; handlers.onDispatchOk(); }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeResumableRow({ anchor: { issueId: null, issueIdentifier: 'LIN-1728-R' } }), 'Approve', li);

    assert.equal(capturedOpts.issueless, false);
    assert.equal(capturedOpts.issueId, 'LIN-1728-R');
  });

  test('F4: a truly issueless anchor (no issueId AND no issueIdentifier) degrades to the issueless path', async () => {
    let capturedOpts = null;
    const { module } = makeSandbox({
      deliverReply: (opts, prompt, handlers) => { capturedOpts = opts; handlers.onDispatchOk(); }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeResumableRow({ anchor: { issueId: null, issueIdentifier: null } }), 'Approve', li);

    assert.equal(capturedOpts.issueless, true);
    assert.ok(!capturedOpts.issueId, 'no id should be threaded through for a true issueless reply');
  });

  test('a normal anchor carrying both issueId and issueIdentifier prefers the real issueId', async () => {
    let capturedOpts = null;
    const { module } = makeSandbox({
      deliverReply: (opts, prompt, handlers) => { capturedOpts = opts; handlers.onDispatchOk(); }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeResumableRow({ anchor: { issueId: 'real-issue-id', issueIdentifier: 'LIN-1728-R' } }), 'Approve', li);

    assert.equal(capturedOpts.issueless, false);
    assert.equal(capturedOpts.issueId, 'real-issue-id');
  });
});

// LIN-2215 F1 — the task-bound disposition (LIN-2197 Phase 3): a scan-produced
// decision has NO dispatch item behind it, so `anchor.loopId` is always null by
// design — the whole point of this fix is that the function must still reach
// its branching logic (not exit silently on the missing loopId) and must
// never call dispatchPrompt/deliverReply (comment-only, no run to start/resume).
const TASK_BOUND_ANCHOR = {
  loopId: null,
  issueId: '11111111-2222-3333-4444-555555555555',
  issueIdentifier: 'LIN-2215-T',
  workspaceUrlKey: 'the-ruling-workspace',
  target: null,
  followUpTo: null,
  taskDecisionId: 'scan_11111111_aaaaaaaaaaaa'
};

function makeTaskBoundRow({ decision, anchor, ...rest } = {}) {
  return {
    decision: decision || { decision_id: 'd-task-1' },
    anchor: { ...TASK_BOUND_ANCHOR, ...(anchor || {}) },
    disposition: 'task-bound',
    ...rest
  };
}

describe('deliverRulingReply — task-bound disposition (LIN-2215 F1)', () => {
  test('a null decisionLoopId no longer trips the early-return guard — postComment is actually attempted', async () => {
    let postCommentCalled = false;
    const { module } = makeSandbox({
      postComment: async () => { postCommentCalled = true; return { ok: true, status: 201, data: {} }; }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeTaskBoundRow(), 'Approve', li);
    await new Promise((r) => setImmediate(r));

    assert.equal(postCommentCalled, true, 'the pre-fix guard required decisionLoopId and returned silently for every task-bound row');
  });

  test('success: postComment carries {taskDecisionId, taskDecisionIssueId}, no dispatch is ever attempted, and the row clears', async () => {
    let capturedArgs = null;
    let dispatchCalls = 0;
    let deliverReplyCalls = 0;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId, prompt, decision) => { capturedArgs = { urlKey, issueId, prompt, decision }; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      deliverReply: () => { deliverReplyCalls += 1; }
    });
    const { deliverRulingReply, rulingsPending, rulingKey } = module.exports;
    const li = makeLi();
    const key = rulingKey('the-ruling-workspace', 'd-task-1');

    deliverRulingReply(makeTaskBoundRow(), 'Approve', li);
    assert.ok(rulingsPending.has(key), 'expected the decision to be marked pending immediately');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(capturedArgs, 'expected postComment to be called');
    assert.equal(capturedArgs.urlKey, 'the-ruling-workspace');
    assert.equal(capturedArgs.issueId, '11111111-2222-3333-4444-555555555555');
    assert.equal(capturedArgs.prompt, 'Approve');
    // taskDecisionIssueId must be the canonical UUID (anchor.issueId) — the
    // field TaskDecisionsStore.markOutcome guards on with its own UUID check —
    // never anchor.issueIdentifier. (Field-by-field, not deepEqual — the
    // decision object crosses the vm sandbox boundary, so it is structurally
    // but not reference-equal to a same-realm object literal.)
    assert.equal(capturedArgs.decision.taskDecisionId, 'scan_11111111_aaaaaaaaaaaa');
    assert.equal(capturedArgs.decision.taskDecisionIssueId, '11111111-2222-3333-4444-555555555555');

    assert.equal(dispatchCalls, 0, 'a task-bound reply is comment-only — no run to start or resume');
    assert.equal(deliverReplyCalls, 0, 'must not route through the follow-up/dispatch delivery path either');
    assert.ok(!rulingsPending.has(key));

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /recorded ✓/);
  });

  test('failure: the comment write rejecting surfaces a visible error and re-enables the buttons — never a silent no-op', async () => {
    const { module } = makeSandbox({
      postComment: async () => ({ ok: false, status: 502, data: { error: 'upstream write rejected' } })
    });
    const { deliverRulingReply, rulingsPending, rulingKey } = module.exports;
    const li = makeLi();
    const key = rulingKey('the-ruling-workspace', 'd-task-2');

    deliverRulingReply(makeTaskBoundRow({ decision: { decision_id: 'd-task-2' } }), 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(!rulingsPending.has(key), 'the pending guard must be released on failure');
    const buttons = li.querySelectorAll('.chat-option-btn');
    buttons.forEach((b) => assert.equal(b.disabled, false, 'buttons must be re-enabled on failure'));

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /reply failed/);
  });

  test('a network-layer rejection (postComment itself throws) is caught the same way as a non-ok result', async () => {
    const { module } = makeSandbox({
      postComment: async () => { throw new Error('network offline'); }
    });
    const { deliverRulingReply, rulingsPending, rulingKey } = module.exports;
    const li = makeLi();
    const key = rulingKey('the-ruling-workspace', 'd-task-3');

    deliverRulingReply(makeTaskBoundRow({ decision: { decision_id: 'd-task-3' } }), 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(!rulingsPending.has(key));
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /reply failed: network offline/);
  });
});

// LIN-2293 — `decision_id` is short free text an agent invents (not a UUID),
// and the rulings feed is cross-workspace by construction, so two DIFFERENT
// workspaces' rows can legitimately share one. Pre-fix, `rulingsPending` (and
// `preservedRulingRows`) keyed on that bare `decision_id` alone, so a press on
// one workspace's row marked BOTH rows pending — a same-key press on the
// other workspace's row would then hit the "already pending" guard and
// return silently, with no comment, no dispatch, no feedback, exactly the
// symptom the ticket describes ("acting on one disables/re-renders both").
describe('deliverRulingReply — cross-workspace decision_id collision (LIN-2293)', () => {
  test('two rows sharing decision_id in different workspaces are independently pending and independently deliverable', async () => {
    let commentCallsA = 0;
    let commentCallsB = 0;
    let dispatchCallsA = 0;
    let dispatchCallsB = 0;
    const { module } = makeSandbox({
      postComment: async (urlKey) => {
        if (urlKey === 'workspace-a') commentCallsA += 1; else commentCallsB += 1;
        return { ok: true, status: 201, data: {} };
      },
      dispatchPrompt: async (opts) => {
        if (opts.urlKey === 'workspace-a') dispatchCallsA += 1; else dispatchCallsB += 1;
        return { id: 'dispatched-1' };
      }
    });
    const { deliverRulingReply, rulingsPending, rulingKey } = module.exports;

    const liA = makeLi();
    const liB = makeLi();
    const rowA = makeRow({ anchor: { workspaceUrlKey: 'workspace-a' }, decision: { decision_id: 'shared-decision' } });
    const rowB = makeRow({ anchor: { workspaceUrlKey: 'workspace-b' }, decision: { decision_id: 'shared-decision' } });
    const keyA = rulingKey('workspace-a', 'shared-decision');
    const keyB = rulingKey('workspace-b', 'shared-decision');

    deliverRulingReply(rowA, 'Approve', liA);
    assert.ok(rulingsPending.has(keyA), 'workspace A row must be marked pending');
    assert.ok(!rulingsPending.has(keyB), 'a press on workspace A must not also mark workspace B pending merely for sharing decision_id');

    // Press B's row while A is still mid-flight. Pre-fix, the shared bare
    // decision_id would trip the "already pending" guard here and this call
    // would return silently — no comment, no dispatch, buttons left enabled.
    deliverRulingReply(rowB, 'Approve', liB);
    assert.ok(rulingsPending.has(keyB), 'workspace B row must be independently answerable while workspace A is still mid-flight');

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(commentCallsA, 1, 'workspace A reply must be delivered');
    assert.equal(commentCallsB, 1, 'workspace B reply must be delivered — not silently dropped by the cross-workspace collision');
    assert.equal(dispatchCallsA, 1);
    assert.equal(dispatchCallsB, 1);
    assert.ok(!rulingsPending.has(keyA));
    assert.ok(!rulingsPending.has(keyB));
  });
});

// LIN-2293 review (F1) — the ticket's symptom has two halves: "acting on one
// DISABLES and RE-RENDERS both". The describe above pins the disables half
// (rulingsPending, via deliverRulingReply). This one pins the re-renders
// half, which lives entirely in renderRulings' reuse lookup against
// renderedRulingRows and had no guard at any level: the review's M2 mutation
// reverted that lookup to bare decision_id keys and all 8375 tests stayed
// green, so green CI could not distinguish the fixed render path from the
// broken one. These assertions fail under exactly that mutation.
describe('renderRulings — cross-workspace decision_id reuse (LIN-2293 review F1)', () => {
  function makeRenderSandbox() {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p');
    empty.hidden = false;
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => ({ id: 'd' }),
      elements: { 'obs-rulings': list, 'obs-rulings-empty': empty }
    });
    return { module, list, empty };
  }

  test('two rows sharing decision_id in different workspaces get independent <li> nodes', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings, renderedRulingRows, rulingKey } = module.exports;

    const rowA = makeRow({ anchor: { workspaceUrlKey: 'workspace-a' }, decision: { decision_id: 'shared-decision' } });
    const rowB = makeRow({ anchor: { workspaceUrlKey: 'workspace-b' }, decision: { decision_id: 'shared-decision' } });
    const keyA = rulingKey('workspace-a', 'shared-decision');
    const keyB = rulingKey('workspace-b', 'shared-decision');

    renderRulings([rowA, rowB]);

    // Pre-fix (bare decision_id) both rows collapse onto one map entry, so
    // renderedRulingRows holds a single node and the second row's render
    // clobbers the first's bookkeeping.
    assert.equal(renderedRulingRows.size, 2, 'each workspace must keep its own renderedRulingRows entry');
    assert.ok(renderedRulingRows.has(keyA) && renderedRulingRows.has(keyB));
    assert.notEqual(
      renderedRulingRows.get(keyA), renderedRulingRows.get(keyB),
      'rows from different workspaces must not share one <li> merely for sharing decision_id'
    );
    assert.equal(list.children.length, 2, 'both rows must be attached');
    assert.notEqual(list.children[0], list.children[1], 'the two attached nodes must be distinct');
  });

  test('a pending row is reused without the other workspace’s row reusing it too', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings, renderedRulingRows, rulingsPending, rulingKey } = module.exports;

    const rowA = makeRow({ anchor: { workspaceUrlKey: 'workspace-a' }, decision: { decision_id: 'shared-decision' } });
    const rowB = makeRow({ anchor: { workspaceUrlKey: 'workspace-b' }, decision: { decision_id: 'shared-decision' } });
    const keyA = rulingKey('workspace-a', 'shared-decision');
    const keyB = rulingKey('workspace-b', 'shared-decision');

    renderRulings([rowA, rowB]);
    const firstA = renderedRulingRows.get(keyA);
    const firstB = renderedRulingRows.get(keyB);

    // Workspace A's row goes mid-flight; the next poll repaints. A's node must
    // be REUSED (its buttons are disabled and its in-flight handler is bound
    // to that node), while B's must be rebuilt fresh — pre-fix the shared bare
    // key made B reuse A's node, which is the "re-renders both" symptom.
    rulingsPending.add(keyA);
    renderRulings([rowA, rowB]);

    assert.equal(renderedRulingRows.get(keyA), firstA, 'the pending workspace-A row must be reused across the repaint');
    assert.notEqual(renderedRulingRows.get(keyB), firstA, 'workspace B must not reuse workspace A’s pending node');
    assert.notEqual(renderedRulingRows.get(keyB), firstB, 'workspace B is not pending, so it is rebuilt fresh');
    assert.equal(list.children.length, 2);
    assert.notEqual(list.children[0], list.children[1]);

    rulingsPending.delete(keyA);
  });
});

// ─── Suggestion banner (LIN-2444 Phase 2) ────────────────────────────────────
//
// Render-only: a proposed-dismissal suggestion attaches as a sibling of
// .obs-ruling-cost, above the canReply branch entirely, so it must appear on
// BOTH a repliable and a mid-turn (non-canReply) row. `suggestedDismissal:
// null` (the server's shape for both "never suggested" and "withdrawn") must
// render exactly as today — no banner, no empty container.
describe('renderRulingRow — suggestion banner (LIN-2444 Phase 2)', () => {
  function makeRenderSandbox() {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p');
    empty.hidden = false;
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => ({ id: 'd' }),
      elements: { 'obs-rulings': list, 'obs-rulings-empty': empty }
    });
    return { module, list, empty };
  }

  const SUGGESTION = {
    reason: 'the task shipped in LIN-9999',
    suggestedBy: 'lane-e',
    suggestedAt: '2026-09-05T00:00:00.000Z'
  };

  test('a standing suggestion renders the banner with reason + suggestedBy + a formatted suggestedAt', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings } = module.exports;

    renderRulings([makeRow({ suggestedDismissal: SUGGESTION })]);

    const li = list.children[0];
    const banner = li.querySelector('.obs-ruling-suggestion');
    assert.ok(banner, 'expected a .obs-ruling-suggestion banner');
    const reasonEl = banner.querySelector('.obs-ruling-suggestion-reason');
    const metaEl = banner.querySelector('.obs-ruling-suggestion-meta');
    assert.equal(reasonEl.textContent, SUGGESTION.reason);
    assert.match(metaEl.textContent, /lane-e/);
    assert.match(metaEl.textContent, /stub-relative-time\(2026-09-05T00:00:00\.000Z\)/, 'suggestedAt is run through relativeTime, not printed raw');
  });

  test('the banner renders on a non-canReply (mid-turn) row too', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings } = module.exports;

    renderRulings([makeRow({ suggestedDismissal: SUGGESTION, canReply: false })]);

    const li = list.children[0];
    assert.ok(li.querySelector('.obs-ruling-suggestion'), 'the banner must not be gated on canReply');
  });

  test('the banner renders on a canReply row too', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings } = module.exports;

    renderRulings([makeRow({ suggestedDismissal: SUGGESTION, canReply: true })]);

    const li = list.children[0];
    assert.ok(li.querySelector('.obs-ruling-suggestion'));
  });

  test('suggestedDismissal: null renders no banner at all — no empty container either', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings } = module.exports;

    renderRulings([makeRow({ suggestedDismissal: null })]);

    const li = list.children[0];
    assert.equal(li.querySelector('.obs-ruling-suggestion'), null);
  });

  test('a row with no suggestedDismissal field at all (undefined) also renders no banner', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings } = module.exports;

    renderRulings([makeRow()]);

    const li = list.children[0];
    assert.equal(li.querySelector('.obs-ruling-suggestion'), null);
  });

  test('the reason text is rendered via textContent, never raw HTML interpolation', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings } = module.exports;

    const hostileReason = '<img src=x onerror="alert(1)"> & "quoted" <b>bold</b>';
    renderRulings([makeRow({ suggestedDismissal: { ...SUGGESTION, reason: hostileReason } })]);

    const li = list.children[0];
    const reasonEl = li.querySelector('.obs-ruling-suggestion-reason');
    // textContent stores the literal string verbatim and never parses it into
    // child nodes — the FakeElement shim's textContent setter clears
    // `children`, so any markup-interpolation bug (e.g. innerHTML +=) would
    // instead leave child nodes behind.
    assert.equal(reasonEl.textContent, hostileReason);
    assert.equal(reasonEl.children.length, 0);
  });
});

// ─── Agree / Keep (LIN-2444 Phase 3+4) ───────────────────────────────────────
//
// Agree runs the EXISTING session-auth dismiss (issueDismissRequest, shared
// with the Dismiss button) — no new dismiss path. Keep calls the beat-1
// withdraw route and must never touch a dismiss endpoint at all.
describe('agreeRulingRow / keepRulingRow (LIN-2444 Phase 3)', () => {
  const SUGGESTION = { reason: 'shipped', suggestedBy: 'lane-e', suggestedAt: '2026-09-05T00:00:00.000Z' };

  test('Agree on a loop-backed row posts to the rulings dismiss route with the right body, targeting anchor.workspaceUrlKey', async () => {
    let captured = null;
    const { module } = makeSandbox({
      api: async (url, opts) => { captured = { url, opts }; return { success: true }; }
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();

    agreeRulingRow(makeRow(), li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(captured, 'expected window.api to be called');
    assert.equal(captured.url, '/workspace/the-ruling-workspace/api/dashboard/rulings/dismiss');
    assert.equal(captured.opts.method, 'POST');
    assert.deepEqual(JSON.parse(captured.opts.body), { decisionLoopId: 'loop-gone-1', decisionId: 'd-gone-1' });
  });

  test('Agree on a task-bound row posts to the scan dismiss route with {id: taskDecisionId}', async () => {
    let captured = null;
    const { module } = makeSandbox({
      api: async (url, opts) => { captured = { url, opts }; return { success: true }; }
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    const taskBoundRow = makeRow({
      anchor: { loopId: null, taskDecisionId: 'td-1' },
      disposition: 'task-bound'
    });

    agreeRulingRow(taskBoundRow, li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(captured, 'expected window.api to be called');
    assert.equal(captured.url, '/workspace/the-ruling-workspace/api/scan/issue-1/dismiss');
    assert.deepEqual(JSON.parse(captured.opts.body), { id: 'td-1' });
  });

  test('Agree targets anchor.workspaceUrlKey, never a page urlKey', async () => {
    let capturedUrl = null;
    const { module } = makeSandbox({
      api: async (url) => { capturedUrl = url; return { success: true }; }
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    const row = makeRow({ anchor: { workspaceUrlKey: 'some-other-workspace' } });

    agreeRulingRow(row, li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(capturedUrl.startsWith('/workspace/some-other-workspace/'), `expected the anchor's own workspace in the URL, got ${capturedUrl}`);
  });

  test('Agree issues no proxy-prefixed request', async () => {
    let capturedUrl = null;
    const { module } = makeSandbox({
      api: async (url) => { capturedUrl = url; return { success: true }; }
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();

    agreeRulingRow(makeRow(), li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(capturedUrl, 'expected a request to have been made');
    assert.ok(!capturedUrl.includes('/api/proxy'), `expected no proxy-prefixed request, got ${capturedUrl}`);
  });

  test('a successful Agree writes "agreed" feedback and clears its pending state (no dangling pending state)', async () => {
    const { module } = makeSandbox({ api: async () => ({ success: true }) });
    const { agreeRulingRow, rulingsPending, rulingKey } = module.exports;
    const li = makeLi();
    const row = makeRow();

    await agreeRulingRow(row, li);

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.equal(feedback.textContent, 'agreed');
    assert.equal(feedback.classList.contains('obs-ruling-feedback--error'), false);
    assert.equal(rulingsPending.has(rulingKey('the-ruling-workspace', 'd-gone-1')), false);
  });

  test('a failed Agree surfaces an error and re-enables the row for retry', async () => {
    const { module } = makeSandbox({ api: async () => { throw new Error('boom'); } });
    const { agreeRulingRow, rulingsPending, rulingKey } = module.exports;
    const li = makeLi();
    const row = makeRow();

    await agreeRulingRow(row, li);

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /agree failed/);
    assert.equal(feedback.classList.contains('obs-ruling-feedback--error'), true);
    assert.equal(rulingsPending.has(rulingKey('the-ruling-workspace', 'd-gone-1')), false, 'must not be stranded pending after a failure');
  });

  // Review F2 — Phase 5's plan wording says verbatim "on success the Agree
  // path marks the key in a small rulingsSettled Set". Only bulkAgreeRow did;
  // agreeRulingRow (the ticket's headline, one-click verb) did not. Pinned
  // directly against the seam the fix reads/writes, not just its downstream
  // effect on a repaint.
  test('a successful single-click Agree marks the key rulingsSettled (review F2)', async () => {
    const { module } = makeSandbox({ api: async () => ({ success: true }) });
    const { agreeRulingRow, rulingsSettled, rulingKey } = module.exports;
    const li = makeLi();
    const row = makeRow();
    const key = rulingKey('the-ruling-workspace', 'd-gone-1');

    await agreeRulingRow(row, li);

    assert.ok(rulingsSettled.has(key), 'a succeeded single-click Agree must mark its key settled, exactly as bulkAgreeRow does');
  });

  // Review F2, end to end — reproduces the reviewer's own DOM-probe scenario:
  // Agree succeeds, a poll lands (the stale loop-backed cache still serves
  // the same suggested row), and the repainted row must come back REUSED
  // with its controls still disabled rather than rebuilt fully re-armed —
  // closing the exact double-POST hole the plan review already closed for
  // bulk, now on the single-click path an operator actually uses.
  test('a repaint after a successful Agree reuses the row with controls disabled, not rebuilt re-armed (review F2)', async () => {
    const { module, list } = (() => {
      const l = new FakeElement('ul');
      const e = new FakeElement('p'); e.hidden = false;
      const { module: m } = makeSandbox({
        api: async () => ({ success: true }),
        elements: { 'obs-rulings': l, 'obs-rulings-empty': e }
      });
      return { module: m, list: l };
    })();
    const { renderRulings, agreeRulingRow, rulingKey } = module.exports;
    const suggestedRow = makeRow({ suggestedDismissal: SUGGESTION });

    renderRulings([suggestedRow]);
    const li = list.children[0];
    await agreeRulingRow(makeRow({ suggestedDismissal: SUGGESTION }), li);

    // The stale loop-backed cache still serves the same suggested row.
    renderRulings([suggestedRow]);
    const repaintedLi = list.children[0];

    assert.equal(repaintedLi, li, 'a settled row must be REUSED, not rebuilt, across the repaint');
    const agreeBtn = repaintedLi.querySelector('.obs-ruling-agree');
    const keepBtn = repaintedLi.querySelector('.obs-ruling-keep');
    assert.ok(agreeBtn && keepBtn, 'expected the row to still carry its Agree/Keep controls');
    assert.equal(agreeBtn.disabled, true, 'Agree must still be disabled on the reused row');
    assert.equal(keepBtn.disabled, true, 'Keep must still be disabled on the reused row');
  });

  // A second press on the (still-disabled, but still clickable in a hostile
  // test) row must not re-POST — this is the guard itself, independent of
  // whatever the DOM's `disabled` attribute would have prevented in a real
  // browser.
  test('a second Agree press on an already-settled key sends no request (review F2)', async () => {
    let apiCalls = 0;
    const { module } = makeSandbox({ api: async () => { apiCalls++; return { success: true }; } });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    const row = makeRow();

    await agreeRulingRow(row, li);
    assert.equal(apiCalls, 1);

    await agreeRulingRow(row, li);
    assert.equal(apiCalls, 1, 'a second Agree on an already-settled key must not re-POST a second decision-answer');
  });

  test('Keep posts to the keep route with {decisionId}, never a dismiss endpoint', async () => {
    let captured = null;
    const { module } = makeSandbox({
      api: async (url, opts) => { captured = { url, opts }; return { success: true, suggestion: { withdrawn: true } }; }
    });
    const { keepRulingRow } = module.exports;
    const li = makeLi();

    keepRulingRow(makeRow({ suggestedDismissal: SUGGESTION }), li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(captured, 'expected window.api to be called');
    assert.equal(captured.url, '/workspace/the-ruling-workspace/api/dashboard/rulings/keep');
    assert.equal(captured.opts.method, 'POST');
    assert.deepEqual(JSON.parse(captured.opts.body), { decisionId: 'd-gone-1' });

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.equal(feedback.textContent, 'kept');
    assert.equal(feedback.classList.contains('obs-ruling-feedback--error'), false, 'a successful Keep is not an error state');
  });

  test('Keep\'s 404 (no matching suggestion) is handled benignly — not surfaced as an error', async () => {
    const { module } = makeSandbox({
      api: async () => { const err = new Error('No matching suggestion to keep'); err.status = 404; throw err; }
    });
    const { keepRulingRow } = module.exports;
    const li = makeLi();

    keepRulingRow(makeRow({ suggestedDismissal: SUGGESTION }), li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.equal(feedback.textContent, 'already withdrawn');
    assert.equal(feedback.classList.contains('obs-ruling-feedback--error'), false, 'a 404 on Keep is the benign already-withdrawn case, not an alarm');
  });

  test('a non-404 Keep failure IS surfaced as an error', async () => {
    const { module } = makeSandbox({
      api: async () => { const err = new Error('store down'); err.status = 500; throw err; }
    });
    const { keepRulingRow } = module.exports;
    const li = makeLi();

    keepRulingRow(makeRow({ suggestedDismissal: SUGGESTION }), li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /keep failed/);
    assert.equal(feedback.classList.contains('obs-ruling-feedback--error'), true);
  });
});

// ─── Widened control-disable set (LIN-2444 Phase 4) ──────────────────────────
//
// rulingRowControls must cover .obs-ruling-agree/.obs-ruling-keep too, or an
// in-flight Agree/Keep leaves the OTHER controls on the row double-firable.
// Driven through the real render + click path (not the bare handler) so the
// assertion is against the actual DOM the plan says is load-bearing.
describe('rulingRowControls widened for Agree/Keep (LIN-2444 Phase 4)', () => {
  function makeRenderSandbox(api) {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p');
    empty.hidden = false;
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => ({ id: 'd' }),
      api,
      elements: { 'obs-rulings': list, 'obs-rulings-empty': empty }
    });
    return { module, list, empty };
  }

  test('pressing Agree disables every control on the row, including Agree and Keep themselves', async () => {
    let resolveApi;
    const pending = new Promise((resolve) => { resolveApi = resolve; });
    const { module, list } = makeRenderSandbox(async () => pending);
    const { renderRulings } = module.exports;

    const row = makeRow({ suggestedDismissal: { reason: 'x', suggestedBy: 'y', suggestedAt: '2026-09-05T00:00:00.000Z' } });
    renderRulings([row]);
    const li = list.children[0];
    const agreeBtn = li.querySelector('.obs-ruling-agree');
    const keepBtn = li.querySelector('.obs-ruling-keep');
    const dismissBtn = li.querySelector('.obs-ruling-dismiss');
    const shelveBtn = li.querySelector('.obs-ruling-shelve');
    assert.ok(agreeBtn && keepBtn, 'Agree/Keep must render on a suggested row');

    agreeBtn.click();

    assert.equal(agreeBtn.disabled, true, 'Agree itself must disable while its own request is in flight');
    assert.equal(keepBtn.disabled, true, 'Keep must be disabled too — the double-fire hole this phase closes');
    assert.equal(dismissBtn.disabled, true);
    assert.equal(shelveBtn.disabled, true);

    resolveApi({ success: true });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Review F2: a SUCCESSFUL Agree marks the row rulingsSettled and stays
    // disabled (reused, not rebuilt re-armed, by the next repaint) — it no
    // longer re-enables on success the way a failure still does.
    assert.equal(agreeBtn.disabled, true, 'a succeeded Agree must stay disabled, not re-arm (review F2)');
    assert.equal(keepBtn.disabled, true);
  });

  test('pressing Keep disables every control on the row, including Agree and Keep themselves', async () => {
    let resolveApi;
    const pending = new Promise((resolve) => { resolveApi = resolve; });
    const { module, list } = makeRenderSandbox(async () => pending);
    const { renderRulings } = module.exports;

    const row = makeRow({ suggestedDismissal: { reason: 'x', suggestedBy: 'y', suggestedAt: '2026-09-05T00:00:00.000Z' } });
    renderRulings([row]);
    const li = list.children[0];
    const agreeBtn = li.querySelector('.obs-ruling-agree');
    const keepBtn = li.querySelector('.obs-ruling-keep');

    keepBtn.click();

    assert.equal(agreeBtn.disabled, true);
    assert.equal(keepBtn.disabled, true);

    resolveApi({ success: true, suggestion: { withdrawn: true } });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(agreeBtn.disabled, false);
    assert.equal(keepBtn.disabled, false);
  });

  test('Agree/Keep render only when row.suggestedDismissal is set — absent otherwise', () => {
    const { module, list } = makeRenderSandbox(async () => ({ success: true }));
    const { renderRulings } = module.exports;

    renderRulings([makeRow({ suggestedDismissal: null })]);
    const li = list.children[0];
    assert.equal(li.querySelector('.obs-ruling-agree'), null);
    assert.equal(li.querySelector('.obs-ruling-keep'), null);
  });
});

// ─── Bulk-agree (LIN-2444 Phase 5) ───────────────────────────────────────────
//
// Selection is a module Set keyed rulingKey(urlKey, decisionId) — never a
// bare issueId or checkbox DOM state, since renderRulings can rebuild the
// <li> on every poll (the comment atop public/observation.js). Bulk-agree
// drives the SAME issueDismissRequest core Agree/Dismiss already share,
// sequentially, gated by a native confirm(). A succeeded key is deleted
// from the selection Set at the moment of success and marked settled, so
// the row stays REUSED with its controls disabled for as long as the stale
// feed cache keeps serving it — the plan-review finding: without this, a
// second bulk-agree inside that window would re-POST a duplicate
// decision-answer (markDecisionAnswered's unconditional $push has no
// idempotence guard on the loop-backed branch).
describe('bulk-agree selection + execution (LIN-2444 Phase 5)', () => {
  function makeBulkSandbox({ api, confirm } = {}) {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p');
    empty.hidden = false;
    const bar = new FakeElement('div');
    const selectAll = new FakeElement('input');
    const countEl = new FakeElement('span');
    const agreeBtn = new FakeElement('button');
    const sandbox = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => ({ id: 'd' }),
      api,
      confirm,
      elements: {
        'obs-rulings': list,
        'obs-rulings-empty': empty,
        'obs-ruling-bulk-bar': bar,
        'obs-ruling-select-all': selectAll,
        'obs-ruling-selected-count': countEl,
        'obs-ruling-agree-selected': agreeBtn
      }
    });
    return { sandbox, module: sandbox.module, list, bar, selectAll, countEl, agreeBtn };
  }

  const SUGGESTION = { reason: 'shipped', suggestedBy: 'lane-e', suggestedAt: '2026-09-05T00:00:00.000Z' };

  function suggestedRow(overrides = {}) {
    return makeRow({ suggestedDismissal: SUGGESTION, ...overrides });
  }

  test('a checkbox renders only on a suggested row', () => {
    const { module, list } = makeBulkSandbox();
    const { renderRulings } = module.exports;

    renderRulings([makeRow({ suggestedDismissal: null })]);
    const li = list.children[0];
    assert.equal(li.querySelector('.obs-ruling-select'), null);
  });

  test('selection survives a repaint — the checkbox reflects rulingsSelected, never its own prior DOM state', () => {
    const { module, list } = makeBulkSandbox();
    const { renderRulings, toggleRulingSelection, rulingKey } = module.exports;
    const key = rulingKey('the-ruling-workspace', 'd-gone-1');

    renderRulings([suggestedRow()]);
    const firstLi = list.children[0];
    toggleRulingSelection(key, true);

    // Simulate the next 5s poll landing with the SAME row — an ordinary
    // repaint (not pending/settled/preserved), so the <li> is REBUILT.
    renderRulings([suggestedRow()]);
    const secondLi = list.children[0];

    assert.notEqual(secondLi, firstLi, 'an ordinary repaint rebuilds the row fresh');
    const checkbox = secondLi.querySelector('.obs-ruling-select');
    assert.ok(checkbox, 'expected a selection checkbox on a suggested row');
    assert.equal(checkbox.checked, true, 'the rebuilt checkbox must restore checked state from rulingsSelected, not default to unchecked');
  });

  test('setAllRulingsSelected selects only currently-rendered suggested rows', () => {
    const { module } = makeBulkSandbox();
    const { renderRulings, setAllRulingsSelected, rulingsSelected, rulingKey } = module.exports;

    const suggested = suggestedRow({ decision: { decision_id: 'd-suggested' } });
    const plain = makeRow({ suggestedDismissal: null, decision: { decision_id: 'd-plain' } });
    renderRulings([suggested, plain]);

    setAllRulingsSelected(true);

    assert.ok(rulingsSelected.has(rulingKey('the-ruling-workspace', 'd-suggested')));
    assert.equal(rulingsSelected.has(rulingKey('the-ruling-workspace', 'd-plain')), false, 'a row with no suggestion must never be selectable');
    assert.equal(rulingsSelected.size, 1);
  });

  test('bulk-agree acts only on selected suggested rows — an unselected suggested row is left untouched', async () => {
    const calls = [];
    const { module } = makeBulkSandbox({ api: async (url, opts) => { calls.push(JSON.parse(opts.body).decisionId); return { success: true }; } });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    const rowA = suggestedRow({ decision: { decision_id: 'd-a' } });
    const rowB = suggestedRow({ decision: { decision_id: 'd-b' } });
    renderRulings([rowA, rowB]);
    toggleRulingSelection(rulingKey('the-ruling-workspace', 'd-a'), true);

    await bulkAgreeSelected();

    assert.deepEqual(calls, ['d-a'], 'only the selected row must be agreed');
  });

  test('the confirm() gate is honoured — cancelling sends no request and leaves the selection untouched', async () => {
    let apiCalled = false;
    const confirmCalls = [];
    const { module } = makeBulkSandbox({
      api: async () => { apiCalled = true; return { success: true }; },
      confirm: (msg) => { confirmCalls.push(msg); return false; }
    });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingsSelected, rulingKey } = module.exports;
    const key = rulingKey('the-ruling-workspace', 'd-gone-1');

    renderRulings([suggestedRow()]);
    toggleRulingSelection(key, true);

    await bulkAgreeSelected();

    assert.equal(apiCalled, false, 'declining the confirm() dialog must send no request');
    assert.equal(confirmCalls.length, 1);
    assert.match(confirmCalls[0], /1 selected suggestion/);
    assert.ok(rulingsSelected.has(key), 'the selection must survive a decline');
  });

  test('an empty selection is a no-op — no confirm(), no request', async () => {
    let confirmCalled = false;
    let apiCalled = false;
    const { module } = makeBulkSandbox({
      api: async () => { apiCalled = true; return { success: true }; },
      confirm: () => { confirmCalled = true; return true; }
    });
    const { bulkAgreeSelected } = module.exports;

    await bulkAgreeSelected();

    assert.equal(confirmCalled, false);
    assert.equal(apiCalled, false);
  });

  test('a succeeded key is deleted from the selection Set at the moment of success', async () => {
    const { module } = makeBulkSandbox({ api: async () => ({ success: true }) });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingsSelected, rulingsSettled, rulingKey } = module.exports;
    const key = rulingKey('the-ruling-workspace', 'd-gone-1');

    renderRulings([suggestedRow()]);
    toggleRulingSelection(key, true);

    await bulkAgreeSelected();

    assert.equal(rulingsSelected.has(key), false);
    assert.ok(rulingsSettled.has(key), 'a succeeded key must be marked settled');
  });

  test('a mid-batch failure leaves later rows still processed, and the failed row stays selected', async () => {
    const calls = [];
    const { module } = makeBulkSandbox({
      api: async (url, opts) => {
        const { decisionId } = JSON.parse(opts.body);
        calls.push(decisionId);
        if (decisionId === 'd-b') throw new Error('boom');
        return { success: true };
      }
    });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingsSelected, rulingKey } = module.exports;

    const rowA = suggestedRow({ decision: { decision_id: 'd-a' } });
    const rowB = suggestedRow({ decision: { decision_id: 'd-b' } });
    const rowC = suggestedRow({ decision: { decision_id: 'd-c' } });
    renderRulings([rowA, rowB, rowC]);
    const keyA = rulingKey('the-ruling-workspace', 'd-a');
    const keyB = rulingKey('the-ruling-workspace', 'd-b');
    const keyC = rulingKey('the-ruling-workspace', 'd-c');
    [keyA, keyB, keyC].forEach((k) => toggleRulingSelection(k, true));

    await bulkAgreeSelected();

    assert.deepEqual(calls, ['d-a', 'd-b', 'd-c'], 'the loop must continue past a mid-batch failure');
    assert.equal(rulingsSelected.has(keyA), false, 'the succeeded row before the failure is deselected');
    assert.ok(rulingsSelected.has(keyB), 'the FAILED row must stay selected — recoverable, retryable');
    assert.equal(rulingsSelected.has(keyC), false, 'the succeeded row after the failure is deselected too — the loop did not stop');
  });

  test('a second bulk-agree inside the stale window does not re-POST a succeeded row (plan-review finding)', async () => {
    let apiCalls = 0;
    const { module } = makeBulkSandbox({ api: async () => { apiCalls++; return { success: true }; } });
    const { renderRulings, toggleRulingSelection, setAllRulingsSelected, bulkAgreeSelected, rulingsSelected, rulingKey } = module.exports;
    const key = rulingKey('the-ruling-workspace', 'd-gone-1');
    const row = suggestedRow();

    renderRulings([row]);
    toggleRulingSelection(key, true);
    await bulkAgreeSelected();
    assert.equal(apiCalls, 1);

    // The stale feed cache still serves the SAME row, suggestion intact, on
    // the next poll — exactly the loop-backed window this phase exists for.
    renderRulings([row]);

    // A direct re-select attempt must be refused outright.
    toggleRulingSelection(key, true);
    assert.equal(rulingsSelected.has(key), false, 'a settled key must refuse re-selection');

    // select-all-suggested must not sweep it back in either.
    setAllRulingsSelected(true);
    assert.equal(rulingsSelected.has(key), false);

    await bulkAgreeSelected();
    assert.equal(apiCalls, 1, 'a second bulk-agree must not re-POST an already-succeeded row');
  });

  test('a settled row is REUSED (not rebuilt) with its controls still disabled, until it finally leaves the payload', async () => {
    const { module, list } = makeBulkSandbox({ api: async () => ({ success: true }) });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;
    const key = rulingKey('the-ruling-workspace', 'd-gone-1');
    const row = suggestedRow();

    renderRulings([row]);
    toggleRulingSelection(key, true);
    await bulkAgreeSelected();
    const settledLi = list.children[0];
    const checkbox = settledLi.querySelector('.obs-ruling-select');
    assert.equal(checkbox.disabled, true, 'a settled row keeps its controls disabled after success');
    assert.equal(checkbox.checked, false, 'the checkbox itself is explicitly unchecked on success');

    // Stale cache still serves it — must be the SAME node, still disabled.
    renderRulings([row]);
    assert.equal(list.children[0], settledLi, 'a settled row must be REUSED, not rebuilt re-armed');
    assert.equal(list.children[0].querySelector('.obs-ruling-select').disabled, true);

    // The row finally leaves the payload for real.
    renderRulings([]);
    // A later re-suggestion (or the same one, re-raised) starts fully re-armed.
    renderRulings([row]);
    const rebuiltLi = list.children[0];
    assert.notEqual(rebuiltLi, settledLi, 'once truly absent, the settled mark releases and a later row is rebuilt fresh');
    assert.equal(rebuiltLi.querySelector('.obs-ruling-select').disabled, false);
  });

  test('exactly one pollRulings() and one badge refresh per batch, never one per row', async () => {
    const { sandbox, module } = makeBulkSandbox({ api: async () => ({ success: true }) });
    let pollCalls = 0;
    sandbox.pollRulings = () => { pollCalls++; };
    let badgeCalls = 0;
    sandbox.refreshRulingsBadge = () => { badgeCalls++; };

    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;
    const rowA = suggestedRow({ decision: { decision_id: 'd-a' } });
    const rowB = suggestedRow({ decision: { decision_id: 'd-b' } });
    const rowC = suggestedRow({ decision: { decision_id: 'd-c' } });
    renderRulings([rowA, rowB, rowC]);
    [
      rulingKey('the-ruling-workspace', 'd-a'),
      rulingKey('the-ruling-workspace', 'd-b'),
      rulingKey('the-ruling-workspace', 'd-c')
    ].forEach((k) => toggleRulingSelection(k, true));

    await bulkAgreeSelected();

    assert.equal(pollCalls, 1, 'exactly one pollRulings() for the whole batch');
    assert.equal(badgeCalls, 1, 'exactly one badge refresh for the whole batch');
  });

  test('the bulk bar\'s Agree-selected label and select-all tri-state track the selection', () => {
    const { module, agreeBtn, selectAll, bar } = makeBulkSandbox();
    const { renderRulings, toggleRulingSelection, rulingKey } = module.exports;

    const rowA = suggestedRow({ decision: { decision_id: 'd-a' } });
    const rowB = suggestedRow({ decision: { decision_id: 'd-b' } });
    renderRulings([rowA, rowB]);

    assert.equal(bar.hidden, false, 'the bar must show once a suggested row is on screen');
    assert.equal(agreeBtn.textContent, 'Agree selected (0)');
    assert.equal(agreeBtn.disabled, true);

    toggleRulingSelection(rulingKey('the-ruling-workspace', 'd-a'), true);
    assert.equal(agreeBtn.textContent, 'Agree selected (1)');
    assert.equal(agreeBtn.disabled, false);
    assert.equal(selectAll.indeterminate, true);

    toggleRulingSelection(rulingKey('the-ruling-workspace', 'd-b'), true);
    assert.equal(agreeBtn.textContent, 'Agree selected (2)');
    assert.equal(selectAll.checked, true);
    assert.equal(selectAll.indeterminate, false);
  });

  test('the bulk bar hides when no row on screen is suggested', () => {
    const { module, bar } = makeBulkSandbox();
    const { renderRulings } = module.exports;

    renderRulings([makeRow({ suggestedDismissal: null })]);
    assert.equal(bar.hidden, true);
  });

  // Review F1 — a WITHDRAWN suggestion (someone pressed Keep in another tab,
  // or the proposer withdrew it) must drop out of selection the moment a
  // poll repaints it as `suggestedDismissal: null`, not only once the key
  // later vanishes from the payload entirely (it never does — the ruling
  // stays unanswered). Checked directly against `renderRulings`, before
  // bulk-agree ever runs, so this pins the PRUNE itself rather than only its
  // downstream effect.
  test('renderRulings drops a selected key from rulingsSelected once its suggestion is withdrawn (review F1)', () => {
    const { module, bar, countEl, selectAll } = makeBulkSandbox();
    const { renderRulings, toggleRulingSelection, rulingsSelected, rulingKey } = module.exports;
    const key = rulingKey('the-ruling-workspace', 'd-w');

    renderRulings([suggestedRow({ decision: { decision_id: 'd-w' } })]);
    toggleRulingSelection(key, true);
    assert.ok(rulingsSelected.has(key));

    // Keep pressed elsewhere: next poll repaints the SAME still-unanswered
    // decision with suggestedDismissal gone null.
    renderRulings([makeRow({ suggestedDismissal: null, decision: { decision_id: 'd-w' } })]);

    assert.equal(rulingsSelected.has(key), false, 'a withdrawn row must be pruned from selection on this same repaint');
    assert.equal(countEl.textContent, '0 selected', 'the bulk bar count must not over-report a withdrawn row as still selected');
    assert.equal(bar.hidden, true, 'the bar must hide — nothing selectable remains');
    assert.equal(selectAll.indeterminate, false, 'select-all must not be left indeterminate once the only selection was pruned');
  });

  // Review F1, end to end — reproduces the reviewer's own DOM-probe scenario:
  // select a suggested row, the suggestion is withdrawn by a poll landing
  // before the batch runs, then "Agree selected" must not dismiss it.
  test('bulk-agree never dismisses a row whose suggestion was withdrawn before the batch ran (review F1)', async () => {
    const calls = [];
    const { module } = makeBulkSandbox({ api: async (url, opts) => { calls.push(JSON.parse(opts.body).decisionId); return { success: true }; } });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    const withdrawn = suggestedRow({ decision: { decision_id: 'd-w' } });
    const live = suggestedRow({ decision: { decision_id: 'd-live' } });
    renderRulings([withdrawn, live]);
    toggleRulingSelection(rulingKey('the-ruling-workspace', 'd-w'), true);
    toggleRulingSelection(rulingKey('the-ruling-workspace', 'd-live'), true);

    // Suggestion withdrawn elsewhere; the poll repaints before Agree-selected fires.
    renderRulings([makeRow({ suggestedDismissal: null, decision: { decision_id: 'd-w' } }), live]);

    await bulkAgreeSelected();

    assert.deepEqual(calls, ['d-live'], 'the withdrawn row must never be POSTed — only the still-live suggestion is agreed');
  });

  // Review F1's "belt and braces" half — `bulkAgreeRow` itself must re-check
  // `row.suggestedDismissal` at the moment it runs, because the row can
  // change BETWEEN confirm() and this key's own turn in the sequential
  // loop (the batch is awaited row by row, so a poll can land mid-batch).
  // This test defeats the `renderRulings` prune deliberately — it re-adds
  // the key to `rulingsSelected` after the withdrawing poll runs, so only
  // `bulkAgreeRow`'s own guard can still save it.
  test('bulkAgreeRow refuses a withdrawn row even if it is (re-)selected — the guard inside the loop, not just the prune (review F1)', async () => {
    const calls = [];
    const { module } = makeBulkSandbox({ api: async (url, opts) => { calls.push(JSON.parse(opts.body).decisionId); return { success: true }; } });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingsSelected, rulingKey } = module.exports;
    const key = rulingKey('the-ruling-workspace', 'd-w');

    renderRulings([suggestedRow({ decision: { decision_id: 'd-w' } })]);
    toggleRulingSelection(key, true);

    // Withdraw it (repaint prunes it), then force it back into the
    // selection Set directly — simulating the prune losing a race it
    // isn't actually exposed to, so only bulkAgreeRow's own re-check defends.
    renderRulings([makeRow({ suggestedDismissal: null, decision: { decision_id: 'd-w' } })]);
    rulingsSelected.add(key);

    await bulkAgreeSelected();

    assert.deepEqual(calls, [], 'bulkAgreeRow must independently refuse a row with no live suggestedDismissal');
  });
});
