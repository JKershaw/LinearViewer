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
  }
  get className() { return this._className; }
  set className(v) {
    this._className = v;
    this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = v; this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }
  click() { (this.listeners.click || []).forEach(fn => fn({ type: 'click' })); }
  _matches(el, selector) {
    return selector.startsWith('.') && el.classList.contains(selector.slice(1));
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

function makeSandbox({ postComment, dispatchPrompt, deliverReply }) {
  const sandbox = {
    module: { exports: {} },
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ReplyDelivery: {
        postComment,
        deliverReply,
        errorFromResult: (r) => new Error((r.data && r.data.error) || `HTTP ${r.status}`)
      },
      dispatchPrompt
    },
    document: {
      createElement: (tag) => new FakeElement(tag),
      addEventListener() {},
      getElementById: () => null
    },
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
