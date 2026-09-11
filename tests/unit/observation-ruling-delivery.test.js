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
    this.parentNode = null;
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
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  // LIN-2775 Area 5's flip control swaps its own <li> in place
  // (li.parentNode.replaceChild(fresh, li)) — the one production caller of
  // either method in this whole shim.
  replaceChild(newChild, oldChild) {
    const idx = this.children.indexOf(oldChild);
    if (idx !== -1) this.children[idx] = newChild;
    newChild.parentNode = this;
    oldChild.parentNode = null;
    return oldChild;
  }
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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');

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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-2');

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

// ─── Record delivery (LIN-2775 Area 6) ──────────────────────────────────────
//
// A `gone`-disposition row whose resolved `effect` is `record` (server-
// resolved, or an operator's own flip override — LIN-2775 Area 5) must
// comment-and-stamp only, never dispatch. This is a NEW sibling branch, not a
// reroute through the pre-existing `task-bound` branch (that branch's stamp
// payload — {taskDecisionId, taskDecisionIssueId} — has no meaning for a
// loop-backed row and would silently never mark the decision answered).
function neighborhoodOf({ parent = null, siblings = [], children = [], cousins = [] } = {}) {
  return { parent, siblings, children, cousins };
}
function hydrateOk(neighborhood, state = null) {
  return { hydrated: true, identifier: ANCHOR.issueIdentifier, state, neighborhood: neighborhoodOf(neighborhood) };
}
function neighbor(identifier, type = 'started') {
  return { id: `id-${identifier}`, identifier, title: identifier, state: { name: type, type } };
}

describe('deliverRulingReply — record delivery (LIN-2775 Area 6)', () => {
  test('a gone row with effect "record" and no declared record_on comments to the anchor and never dispatches', async () => {
    let commentCalls = 0;
    let capturedIssueId = null;
    let capturedExtra = null;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId, body, extra) => {
        commentCalls += 1; capturedIssueId = issueId; capturedExtra = extra;
        return { ok: true, status: 201, data: {} };
      },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      api: async () => { throw new Error('no record_on declared — the hydrate route must not be called'); }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeRow({ decision: { decision_id: 'd-record-1' }, effect: 'record', alternate: null }), 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(commentCalls, 1);
    assert.equal(capturedIssueId, ANCHOR.issueId, 'the fallback prefers the real issueId, mirroring the gone branch\'s own issueId || issueIdentifier convention');
    // The stamp-triggering pair — proof this went through the NEW record
    // branch, not the task-bound branch's {taskDecisionId, taskDecisionIssueId}.
    // Field-by-field, not deepEqual — capturedExtra crosses the vm sandbox
    // boundary, so it is structurally but not reference-equal to a same-realm
    // object literal (same convention as the task-bound test above).
    assert.equal(capturedExtra.decisionLoopId, ANCHOR.loopId);
    assert.equal(capturedExtra.decisionId, 'd-record-1');
    assert.equal(capturedExtra.taskDecisionId, undefined);
    assert.equal(capturedExtra.taskDecisionIssueId, undefined);
    assert.equal(dispatchCalls, 0, 'a record delivery must never dispatch');
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /recorded ✓/);
  });

  test('record_on misrouting: an UNKNOWN record_on (matches nothing in the neighbourhood) targets the anchor, and the note renders', async () => {
    let capturedIssueId = null;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId) => { capturedIssueId = issueId; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      api: async () => hydrateOk({ siblings: [neighbor('LIN-9001')] })
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(
      makeRow({ decision: { decision_id: 'd-record-2', on_answer: { effect: 'record', record_on: 'LIN-NOWHERE' } }, effect: 'record', alternate: null }),
      'Approve', li
    );
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(capturedIssueId, ANCHOR.issueId, 'the comment target must be the ANCHOR (issueId preferred), never the unresolved record_on value');
    assert.equal(dispatchCalls, 0);
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /outside the checked neighbourhood/, 'the note must render, and must not word this as "invalid"');
  });

  test('record_on misrouting: a TERMINAL in-neighbourhood record_on targets the anchor, and the note renders', async () => {
    let capturedIssueId = null;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId) => { capturedIssueId = issueId; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      // In the neighbourhood, but itself Done — must not receive the comment.
      api: async () => hydrateOk({ siblings: [neighbor('LIN-DONE', 'completed')] })
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(
      makeRow({ decision: { decision_id: 'd-record-3', on_answer: { effect: 'record', record_on: 'LIN-DONE' } }, effect: 'record', alternate: null }),
      'Approve', li
    );
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(capturedIssueId, ANCHOR.issueId, 'a terminal target — even one found in the neighbourhood — must not receive the comment');
    assert.equal(dispatchCalls, 0);
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /outside the checked neighbourhood/);
  });

  test('record_on misrouting: a CROSS-WORKSPACE record_on (absent from THIS workspace\'s neighbourhood) targets the anchor, and the note renders', async () => {
    // The hydrate call is always scoped to the ANCHOR's own workspace token
    // (targetUrlKey) — a record_on value that happens to name a real issue in
    // a DIFFERENT workspace can never appear in this neighbourhood at all, so
    // it is indistinguishable from "unknown" at this check, which is exactly
    // the safety property under test: this workspace's neighbourhood can
    // never accidentally validate an identifier that belongs to another one.
    let capturedIssueId = null;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId) => { capturedIssueId = issueId; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      api: async () => hydrateOk({ siblings: [neighbor('LIN-9001')] })
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(
      makeRow({ decision: { decision_id: 'd-record-4', on_answer: { effect: 'record', record_on: 'OTHER-WS-42' } }, effect: 'record', alternate: null }),
      'Approve', li
    );
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(capturedIssueId, ANCHOR.issueId, 'the fallback prefers the real issueId, mirroring the gone branch\'s own issueId || issueIdentifier convention');
    assert.equal(dispatchCalls, 0);
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /outside the checked neighbourhood/);
  });

  test('a valid, in-neighbourhood, non-terminal record_on targets ITS OWN identifier, not the anchor, and that identifier is shown', async () => {
    let capturedIssueId = null;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId) => { capturedIssueId = issueId; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      api: async () => hydrateOk({ children: [neighbor('LIN-CHILD-1')] })
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(
      makeRow({ decision: { decision_id: 'd-record-5', on_answer: { effect: 'record', record_on: 'LIN-CHILD-1' } }, effect: 'record', alternate: null }),
      'Approve', li
    );
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(capturedIssueId, 'id-LIN-CHILD-1', 'the comment must target the resolved record_on identifier, not the anchor');
    assert.equal(dispatchCalls, 0);
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /recorded ✓/);
    assert.match(feedback.textContent, /LIN-CHILD-1/, 'the resolved target identifier must actually render — it is the entire mitigation for the stated S15 residual');
    assert.doesNotMatch(feedback.textContent, /outside the checked neighbourhood/);
  });

  test('a record delivery stamps the decision answered (decisionLoopId/decisionId) and never calls startRun/dispatchPrompt', async () => {
    let capturedExtra = null;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId, body, extra) => { capturedExtra = extra; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      api: async () => hydrateOk({})
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(
      makeRow({ decision: { decision_id: 'd-record-6', on_answer: { effect: 'record' } }, effect: 'record', alternate: null }),
      'Approve', li
    );
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Exactly the pair stampDecisionAnswers (routes/workspace-api.js) keys on
    // — never the task-bound {taskDecisionId, taskDecisionIssueId} shape,
    // which would leave this decision permanently unanswered. Field-by-field,
    // not deepEqual — see the note on the sibling test above.
    assert.equal(capturedExtra.decisionLoopId, ANCHOR.loopId);
    assert.equal(capturedExtra.decisionId, 'd-record-6');
    assert.equal(capturedExtra.taskDecisionId, undefined);
    assert.equal(capturedExtra.taskDecisionIssueId, undefined);
    assert.equal(dispatchCalls, 0, 'startRun/dispatchPrompt must never be called on a record delivery');
  });

  test('an operator\'s flip override (LIN-2775 Area 5) to "record" is honoured — a row whose server-resolved effect is "dispatch" still records, not dispatches', async () => {
    let commentCalls = 0;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async () => { commentCalls += 1; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      api: async () => hydrateOk({})
    });
    const { deliverRulingReply, rulingEffectOverride, rulingKey } = module.exports;
    const li = makeLi();
    const row = makeRow({ decision: { decision_id: 'd-record-7' }, effect: 'dispatch', alternate: 'record' });
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-record-7');
    rulingEffectOverride.set(key, 'record');

    deliverRulingReply(row, 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(commentCalls, 1);
    assert.equal(dispatchCalls, 0, 'the operator\'s override must be honoured over the row\'s own server-resolved default effect');
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
    const key = rulingKey('the-ruling-workspace', TASK_BOUND_ANCHOR, 'd-task-1');

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
    const key = rulingKey('the-ruling-workspace', TASK_BOUND_ANCHOR, 'd-task-2');

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
    const key = rulingKey('the-ruling-workspace', TASK_BOUND_ANCHOR, 'd-task-3');

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
    const keyA = rulingKey('workspace-a', ANCHOR, 'shared-decision');
    const keyB = rulingKey('workspace-b', ANCHOR, 'shared-decision');

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
    const keyA = rulingKey('workspace-a', ANCHOR, 'shared-decision');
    const keyB = rulingKey('workspace-b', ANCHOR, 'shared-decision');

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
    const keyA = rulingKey('workspace-a', ANCHOR, 'shared-decision');
    const keyB = rulingKey('workspace-b', ANCHOR, 'shared-decision');

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

// LIN-2756 — the sibling of LIN-2293's fix above, one dimension over: THAT
// bug was two rows sharing a decision_id across two different WORKSPACES;
// THIS bug is two rows sharing a decision_id in the SAME workspace but two
// different LOOPS (an agent re-emitting the same `DECISION:` block from two
// separate loops within one session — the ticket's live repro: session
// `74869c9c`'s review loop `07509b1e` and close-out loop `0c912018` both
// emitted `lin2384-f6-gate`). Pre-fix, `rulingKey(urlKey, decisionId)` already
// kept different workspaces apart (LIN-2293), but carried no loop dimension
// at all, so two same-workspace loops collapsed onto ONE key exactly the way
// LIN-2293's bare `decision_id` key used to collapse workspaces. Fixed by
// widening `rulingKey` to `(urlKey, anchor, decisionId)`, folding in
// `anchor.loopId ?? anchor.taskDecisionId` (LIN-2756 Proposal).
describe('renderRulings — same-workspace, different-loop decision_id collision (LIN-2756)', () => {
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

  const REVIEW_LOOP = '07509b1e';
  const CLOSEOUT_LOOP = '0c912018';

  function loopRow(loopId) {
    return makeRow({ anchor: { loopId }, decision: { decision_id: 'lin2384-f6-gate' } });
  }

  test('two loops in one workspace sharing decision_id get independent <li> nodes (LIN-2756 Acceptance #1)', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings, renderedRulingRows } = module.exports;

    renderRulings([loopRow(REVIEW_LOOP), loopRow(CLOSEOUT_LOOP)]);

    // Both rows DO attach visually (renderRulings pushes a fresh <li> per
    // row regardless of key collision) — the bug is entirely in the
    // bookkeeping maps collapsing onto one shared key behind them, which is
    // exactly what the size/distinctness assertions below pin.
    assert.equal(list.children.length, 2, 'both loops’ rows must be attached');
    assert.notEqual(list.children[0], list.children[1], 'the two attached nodes must be distinct');
    assert.equal(renderedRulingRows.size, 2, 'each loop must keep its own renderedRulingRows entry, not collapse onto one shared (urlKey, decisionId) key — this is the ticket’s "kept only the last <li>" Finding');
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
    assert.equal(rulingsPending.has(rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1')), false);
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
    assert.equal(rulingsPending.has(rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1')), false, 'must not be stranded pending after a failure');
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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');

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

  // LIN-2756: widened from {decisionId} to {decisionId, decisionLoopId} —
  // Keep must address the SAME composite id a suggest() call would have
  // (lib/dismissal-suggestions-store.js's now-loop-aware `_id`), so it sends
  // the row's own anchor.loopId (or anchor.taskDecisionId for a task-bound
  // row), never a dismiss endpoint.
  test('Keep posts to the keep route with {decisionId, decisionLoopId}, never a dismiss endpoint', async () => {
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
    assert.deepEqual(JSON.parse(captured.opts.body), { decisionId: 'd-gone-1', decisionLoopId: 'loop-gone-1' });

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

  // ─── Second review (LIN-2444) — F6/F7: the F1 class was not isolated ──────
  //
  // F1 fixed bulkAgreeRow deleting its own key from rulingsSelected on
  // success. agreeRulingRow and keepRulingRow never did — so a row could
  // succeed via the single-click path and still be posted again from a
  // bulk-agree press in the SAME tab, before any poll ever landed. Both
  // tests below reproduce the reviewer's own PROBE-D/PROBE-E scenarios.

  // Review F6 — the bulk bar computes `total` from `rulingsSelectableKeys()`
  // (excludes settled) but `selectedCount` from `rulingsSelected.size`
  // (didn't). A settled-but-still-selected row desyncs the two: the count
  // over-reports, select-all renders checked, and "Agree selected" renders
  // enabled over a real selection of nothing.
  test('a successful single-click Agree clears the row from rulingsSelected, keeping the bulk bar honest (review F6)', async () => {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p'); empty.hidden = false;
    const bar = new FakeElement('div');
    const selectAll = new FakeElement('input');
    const countEl = new FakeElement('span');
    const agreeBtn = new FakeElement('button');
    const { module } = makeSandbox({
      api: async () => ({ success: true }),
      elements: {
        'obs-rulings': list, 'obs-rulings-empty': empty, 'obs-ruling-bulk-bar': bar,
        'obs-ruling-select-all': selectAll, 'obs-ruling-selected-count': countEl,
        'obs-ruling-agree-selected': agreeBtn
      }
    });
    const { renderRulings, agreeRulingRow, toggleRulingSelection, rulingsSelected, rulingKey } = module.exports;

    const rowA = makeRow({ suggestedDismissal: SUGGESTION });
    const rowB = makeRow({ decision: { decision_id: 'd-b' }, suggestedDismissal: SUGGESTION });
    renderRulings([rowA, rowB]);
    const keyA = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');
    toggleRulingSelection(keyA, true);
    const liA = list.children[0];

    await agreeRulingRow(rowA, liA);
    assert.equal(rulingsSelected.has(keyA), false, 'the succeeded row must be deselected at the moment of success, not on the next poll');

    // The stale loop-backed cache still serves the same suggested row A —
    // exactly the window PROBE-D exercised.
    renderRulings([rowA, rowB]);
    assert.equal(countEl.textContent, '0 selected', 'the bulk bar must not over-report a settled row as still selected');
    assert.equal(agreeBtn.textContent, 'Agree selected (0)');
    assert.equal(agreeBtn.disabled, true, '"Agree selected" must not render enabled over an empty real selection');
    assert.equal(selectAll.checked, false);
    assert.equal(selectAll.indeterminate, false);

    const checkbox = liA.querySelector('.obs-ruling-select');
    assert.equal(checkbox.checked, false, 'the checkbox itself is explicitly unchecked on success, matching bulkAgreeRow');
  });

  // Review F7 — Keep never cleared selection, so a same-tab bulk-agree press
  // (before the next poll lands) reads the still-cached pre-Keep row and
  // dismisses the very suggestion the operator just protected. This is F1's
  // exact harm, reached through the Keep door instead of Agree's.
  test('a same-tab bulk-agree press does not dismiss a ruling the operator just pressed Keep on (review F7)', async () => {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p'); empty.hidden = false;
    const posted = { keep: [], dismiss: [] };
    const api = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (url.includes('/keep')) { posted.keep.push(body.decisionId); return { success: true }; }
      posted.dismiss.push(body.decisionId);
      return { success: true };
    };
    const { module } = makeSandbox({ api, elements: { 'obs-rulings': list, 'obs-rulings-empty': empty } });
    const { renderRulings, keepRulingRow, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    const kept = makeRow({ suggestedDismissal: SUGGESTION });
    const other = makeRow({ decision: { decision_id: 'd-other' }, suggestedDismissal: SUGGESTION });
    renderRulings([kept, other]);
    const li = list.children[0];
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1'), true);
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-other'), true);

    keepRulingRow(kept, li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(posted.keep, ['d-gone-1']);

    // NO poll has landed yet — rulingsRowByKey still holds the pre-Keep row.
    await bulkAgreeSelected();

    assert.deepEqual(posted.dismiss, ['d-other'], 'the kept ruling must never be dismissed by a same-tab bulk press');
  });

  test('Keep\'s benign 404 (already withdrawn) also clears the row from rulingsSelected (review F7)', async () => {
    const { module } = makeSandbox({
      api: async () => { const err = new Error('No matching suggestion to keep'); err.status = 404; throw err; }
    });
    const { keepRulingRow, rulingsSelected, rulingKey } = module.exports;
    const li = makeLi();
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');
    rulingsSelected.add(key);

    keepRulingRow(makeRow({ suggestedDismissal: SUGGESTION }), li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(rulingsSelected.has(key), false, 'the benign already-withdrawn path must clear selection too, not just the happy path');
  });
});

// ─── Second review (LIN-2444) — third open instance: pre-existing Dismiss ──
//
// Dismiss predates the selection seam (#1432) entirely, so its own verb is
// out of scope — but the seam it now desyncs ships on this branch, making it
// reachable the same way F6/F7 are. Same one-line fix, same class.
describe('dismissRulingRow selection-clearing (LIN-2444 review — third open instance)', () => {
  const SUGGESTION = { reason: 'shipped', suggestedBy: 'lane-e', suggestedAt: '2026-09-05T00:00:00.000Z' };

  test('a successful Dismiss clears the row from rulingsSelected at the moment of success', async () => {
    const { module } = makeSandbox({ api: async () => ({ success: true }) });
    const { dismissRulingRow, rulingsSelected, rulingKey } = module.exports;
    const li = makeLi();
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');
    rulingsSelected.add(key);

    dismissRulingRow(makeRow({ suggestedDismissal: SUGGESTION }), li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(rulingsSelected.has(key), false, 'a dismissed row must not survive selection into the next bulk-agree batch');
  });

  test('a same-tab bulk-agree press after Dismiss does not re-act on the dismissed row', async () => {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p'); empty.hidden = false;
    const posted = [];
    const api = async (url, opts) => { posted.push(JSON.parse(opts.body).decisionId); return { success: true }; };
    const { module } = makeSandbox({ api, elements: { 'obs-rulings': list, 'obs-rulings-empty': empty } });
    const { renderRulings, dismissRulingRow, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    const dismissed = makeRow({ suggestedDismissal: SUGGESTION });
    const other = makeRow({ decision: { decision_id: 'd-other' }, suggestedDismissal: SUGGESTION });
    renderRulings([dismissed, other]);
    const li = list.children[0];
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1'), true);
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-other'), true);

    dismissRulingRow(dismissed, li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    posted.length = 0; // clear the dismiss call itself; only the bulk phase matters below

    await bulkAgreeSelected();

    assert.deepEqual(posted, ['d-other'], 'the already-dismissed row must not receive a second write from the bulk path');
  });
});

// ─── Third review (LIN-2444, `0708a260`) — F8: sixth open instance ────────
//
// shelveRulingRow belongs to the class by the same reasoning Dismiss did:
// shelving does not withdraw the suggestion (`suggestedDismissal` stays
// set), so `rulingsRowByKey` still holds the row as live and a same-tab
// bulk-agree can dismiss a ruling the operator just deferred with a
// re-surface timer (LIN-1727: no silent muting).
describe('shelveRulingRow selection-clearing (LIN-2444 review F8 — sixth open instance)', () => {
  const SUGGESTION = { reason: 'shipped', suggestedBy: 'lane-e', suggestedAt: '2026-09-05T00:00:00.000Z' };

  test('a successful Shelve clears the row from rulingsSelected at the moment of success', async () => {
    const { module } = makeSandbox({ api: async () => ({ success: true }) });
    const { shelveRulingRow, rulingsSelected, rulingKey } = module.exports;
    const li = makeLi();
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');
    rulingsSelected.add(key);

    shelveRulingRow(makeRow({ suggestedDismissal: SUGGESTION }), li, 'deferred pending upstream fix', 24 * 60 * 60 * 1000);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(rulingsSelected.has(key), false, 'a shelved row must not survive selection into the next bulk-agree batch');
  });

  test('a same-tab bulk-agree press after Shelve does not dismiss the shelved row', async () => {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p'); empty.hidden = false;
    const posted = { shelve: [], dismiss: [] };
    const api = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (url.includes('/shelve')) { posted.shelve.push(body.decisionId); return { success: true }; }
      posted.dismiss.push(body.decisionId);
      return { success: true };
    };
    const { module } = makeSandbox({ api, elements: { 'obs-rulings': list, 'obs-rulings-empty': empty } });
    const { renderRulings, shelveRulingRow, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    const shelved = makeRow({ suggestedDismissal: SUGGESTION });
    const other = makeRow({ decision: { decision_id: 'd-other' }, suggestedDismissal: SUGGESTION });
    renderRulings([shelved, other]);
    const li = list.children[0];
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1'), true);
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-other'), true);

    shelveRulingRow(shelved, li, 'deferred pending upstream fix', 24 * 60 * 60 * 1000);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(posted.shelve, ['d-gone-1']);

    // NO poll has landed yet — rulingsRowByKey still holds the pre-shelve row,
    // exactly the window the review's PROBE reproduced.
    await bulkAgreeSelected();

    assert.deepEqual(posted.dismiss, ['d-other'], 'the shelved ruling must never be dismissed by a same-tab bulk press');
  });

  // LIN-2756 close-out (review N1): the Keep sibling is pinned at :1017, the
  // shelve half was not — a mutation that dropped `decisionLoopId` from this
  // POST body survived the whole suite. The regression it hides is silent and
  // is this ticket's own bug class: a shelve that loses its loop segment
  // writes the legacy two-segment `_id`, which `shelfGate` then fans out
  // across every loop sharing that `decision_id`, so one loop's deferral
  // suppresses another loop's unshelved ruling with no error anywhere.
  test('Shelve posts to the shelve route with the row\'s own decisionLoopId (review N1)', async () => {
    let captured = null;
    const { module } = makeSandbox({
      api: async (url, opts) => { captured = { url, opts }; return { success: true }; }
    });
    const { shelveRulingRow } = module.exports;
    const li = makeLi();

    shelveRulingRow(makeRow({ suggestedDismissal: SUGGESTION }), li, 'deferred pending upstream fix', 24 * 60 * 60 * 1000);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(captured, 'expected window.api to be called');
    assert.equal(captured.url, '/workspace/the-ruling-workspace/api/dashboard/rulings/shelve');
    assert.equal(captured.opts.method, 'POST');
    assert.deepEqual(JSON.parse(captured.opts.body), {
      decisionId: 'd-gone-1',
      decisionLoopId: 'loop-gone-1',
      reason: 'deferred pending upstream fix',
      resurfaceInMs: 24 * 60 * 60 * 1000
    });
  });
});

// ─── Second review (LIN-2444) — fifth instance, found closing F6/F7 ────────
//
// appendSuggestionActions renders Agree/Keep on a suggested row REGARDLESS
// of canReply (LIN-2444 Phase 3's own comment), so a repliable row can also
// carry a live suggestion and be bulk-selected. Answering it via reply/free
// text/option press — deliverRulingReply — is just as terminal an action as
// Agree, but never cleared rulingsSelected either: the exact same class,
// found while closing the two named instances rather than invented as a
// sixth ticket.
describe('deliverRulingReply also clears bulk selection (LIN-2444 review — fifth instance found while closing F6/F7)', () => {
  const SUGGESTION = { reason: 'shipped', suggestedBy: 'lane-e', suggestedAt: '2026-09-05T00:00:00.000Z' };

  test('answering a selected, repliable-and-suggested row via reply clears it from rulingsSelected on full success', async () => {
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => ({ id: 'dispatched-1' })
    });
    const { deliverRulingReply, rulingsSelected, rulingKey } = module.exports;
    const li = makeLi();
    const row = makeRow({ suggestedDismissal: SUGGESTION });
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');
    rulingsSelected.add(key);

    deliverRulingReply(row, 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(rulingsSelected.has(key), false, 'a row answered via reply is just as terminally answered as Agree, and must clear selection the same way');
  });

  test('a partial-failure reply (comment recorded, dispatch failed to start) also clears selection — the answer is already durable', async () => {
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => { throw new Error('queue temporarily unavailable'); }
    });
    const { deliverRulingReply, rulingsSelected, rulingKey } = module.exports;
    const li = makeLi();
    const row = makeRow({ suggestedDismissal: SUGGESTION });
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');
    rulingsSelected.add(key);

    deliverRulingReply(row, 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(rulingsSelected.has(key), false, 'the comment already durably recorded the answer even though the run failed to start');
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
// Selection is a module Set keyed rulingKey(urlKey, anchor, decisionId) — never a
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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');

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

    assert.ok(rulingsSelected.has(rulingKey('the-ruling-workspace', ANCHOR, 'd-suggested')));
    assert.equal(rulingsSelected.has(rulingKey('the-ruling-workspace', ANCHOR, 'd-plain')), false, 'a row with no suggestion must never be selectable');
    assert.equal(rulingsSelected.size, 1);
  });

  // Review F5 — every key in this describe block up to this point is built
  // from the single workspace 'the-ruling-workspace'. The selection seam is
  // keyed by rulingKey(workspaceUrlKey, decisionId) (LIN-2293's composite
  // key), never a bare decision_id, so a decision_id COLLIDING across two
  // DIFFERENT workspaces must still select and bulk-agree independently —
  // the regression the plan named that neither prior implementation round
  // wrote. Mirrors the fixture shape of the existing LIN-2293 renderRulings
  // collision tests above, but drives the selection/bulk-agree seam those
  // tests don't touch.
  test('two rows sharing decision_id across DIFFERENT workspaces select and bulk-agree independently (review F5)', async () => {
    const calls = [];
    const { module } = makeBulkSandbox({
      api: async (url, opts) => { calls.push({ url, decisionId: JSON.parse(opts.body).decisionId }); return { success: true }; }
    });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingsSelected, rulingKey } = module.exports;

    const rowWsA = suggestedRow({ anchor: { workspaceUrlKey: 'workspace-a' }, decision: { decision_id: 'shared-decision' } });
    const rowWsB = suggestedRow({ anchor: { workspaceUrlKey: 'workspace-b' }, decision: { decision_id: 'shared-decision' } });
    renderRulings([rowWsA, rowWsB]);

    const keyA = rulingKey('workspace-a', ANCHOR, 'shared-decision');
    const keyB = rulingKey('workspace-b', ANCHOR, 'shared-decision');
    assert.notEqual(keyA, keyB, 'the composite key must distinguish the two workspaces even though decision_id collides');

    // Select ONLY workspace A's row.
    toggleRulingSelection(keyA, true);
    assert.ok(rulingsSelected.has(keyA));
    assert.equal(rulingsSelected.has(keyB), false, "selecting one workspace's row must never select the other's, despite the shared decision_id");

    await bulkAgreeSelected();

    assert.deepEqual(calls.map((c) => c.decisionId), ['shared-decision'], 'exactly one POST for the whole batch — workspace B was never selected');
    assert.ok(calls[0].url.includes('/workspace/workspace-a/'), `the POST must target workspace A, never B, got ${calls[0].url}`);
    assert.equal(rulingsSelected.has(keyA), false, "workspace A's row settles");
    assert.equal(rulingsSelected.has(keyB), false, "workspace B's row was never touched — never selected, never posted");
  });

  test('bulk-agree acts only on selected suggested rows — an unselected suggested row is left untouched', async () => {
    const calls = [];
    const { module } = makeBulkSandbox({ api: async (url, opts) => { calls.push(JSON.parse(opts.body).decisionId); return { success: true }; } });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    const rowA = suggestedRow({ decision: { decision_id: 'd-a' } });
    const rowB = suggestedRow({ decision: { decision_id: 'd-b' } });
    renderRulings([rowA, rowB]);
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-a'), true);

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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');

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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');

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
    const keyA = rulingKey('the-ruling-workspace', ANCHOR, 'd-a');
    const keyB = rulingKey('the-ruling-workspace', ANCHOR, 'd-b');
    const keyC = rulingKey('the-ruling-workspace', ANCHOR, 'd-c');
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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');
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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');
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
      rulingKey('the-ruling-workspace', ANCHOR, 'd-a'),
      rulingKey('the-ruling-workspace', ANCHOR, 'd-b'),
      rulingKey('the-ruling-workspace', ANCHOR, 'd-c')
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

    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-a'), true);
    assert.equal(agreeBtn.textContent, 'Agree selected (1)');
    assert.equal(agreeBtn.disabled, false);
    assert.equal(selectAll.indeterminate, true);

    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-b'), true);
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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-w');

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
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-w'), true);
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-live'), true);

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
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-w');

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

// LIN-2756 Acceptance #2/#3/#4 — same-workspace, different-loop decision_id
// collision, exercised through the bulk-selection and single-row-Agree
// seams. Mirrors the fixture shape of the renderRulings collision describe
// above (REVIEW_LOOP/CLOSEOUT_LOOP, 'lin2384-f6-gate'), but drives the
// selection-count/bulk-agree/single-agree seams that describe doesn't touch.
// Both loop rows carry a live suggestedDismissal so they are selectable —
// `issueDismissRequest` already threads `decisionLoopId: anchor.loopId` onto
// the wire (the dismiss stamp is already per-loop, per the ticket's
// Finding), so the mock API below can distinguish which loop's row actually
// got dismissed.
describe('bulk-agree / single-agree — same-workspace, different-loop decision_id collision (LIN-2756)', () => {
  function makeLoopCollisionSandbox({ api } = {}) {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p'); empty.hidden = false;
    const bar = new FakeElement('div');
    const selectAll = new FakeElement('input');
    const countEl = new FakeElement('span');
    const agreeBtn = new FakeElement('button');
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => ({ id: 'd' }),
      api,
      confirm: () => true,
      elements: {
        'obs-rulings': list, 'obs-rulings-empty': empty, 'obs-ruling-bulk-bar': bar,
        'obs-ruling-select-all': selectAll, 'obs-ruling-selected-count': countEl,
        'obs-ruling-agree-selected': agreeBtn
      }
    });
    return { module, list, bar, selectAll, countEl, agreeBtn };
  }

  const LOOP_SUGGESTION = { reason: 'shipped', suggestedBy: 'lane-e', suggestedAt: '2026-09-05T00:00:00.000Z' };
  const REVIEW_LOOP = '07509b1e';
  const CLOSEOUT_LOOP = '0c912018';

  function loopRow(loopId) {
    return makeRow({ anchor: { loopId }, decision: { decision_id: 'lin2384-f6-gate' }, suggestedDismissal: LOOP_SUGGESTION });
  }

  test('select-all counts BOTH loop rows, not one (LIN-2756 Acceptance #2)', () => {
    const { module } = makeLoopCollisionSandbox();
    const { renderRulings, setAllRulingsSelected, rulingsSelected } = module.exports;

    renderRulings([loopRow(REVIEW_LOOP), loopRow(CLOSEOUT_LOOP)]);
    setAllRulingsSelected(true);

    assert.equal(rulingsSelected.size, 2, 'select-all must count both loops’ rows — pre-fix they collapse onto one shared key, so only one gets selected');
  });

  test('bulk agree dismisses BOTH loop rows, not just the one left standing in the shared-key map (LIN-2756 Acceptance #3)', async () => {
    const calls = [];
    const api = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ decisionLoopId: body.decisionLoopId, decisionId: body.decisionId });
      return { success: true };
    };
    const { module } = makeLoopCollisionSandbox({ api });
    const { renderRulings, setAllRulingsSelected, bulkAgreeSelected } = module.exports;

    renderRulings([loopRow(REVIEW_LOOP), loopRow(CLOSEOUT_LOOP)]);
    setAllRulingsSelected(true);
    await bulkAgreeSelected();

    const loopIds = calls.map((c) => c.decisionLoopId).sort();
    assert.deepEqual(
      loopIds, [CLOSEOUT_LOOP, REVIEW_LOOP].sort(),
      'bulk agree must dismiss both loops’ decisions — pre-fix, rulingsSelected only ever held one shared key, so only one POST fired and the other loop’s ruling was left exactly as the ticket found it: still carrying the suggestion'
    );
  });

  test('agreeing one loop’s row must not silently block the other loop’s independent Agree (LIN-2756 Acceptance #4)', async () => {
    const calls = [];
    const api = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ decisionLoopId: body.decisionLoopId, decisionId: body.decisionId });
      return { success: true };
    };
    const { module, list } = makeLoopCollisionSandbox({ api });
    const { renderRulings, agreeRulingRow } = module.exports;

    const rowReview = loopRow(REVIEW_LOOP);
    const rowCloseout = loopRow(CLOSEOUT_LOOP);
    renderRulings([rowReview, rowCloseout]);
    const [liReview, liCloseout] = list.children;

    await agreeRulingRow(rowReview, liReview);
    assert.deepEqual(calls.map((c) => c.decisionLoopId), [REVIEW_LOOP], 'the review loop’s row must be agreed');

    // Pre-fix, agreeing the review loop adds the SHARED (urlKey, decisionId)
    // key to rulingsSettled — and agreeRulingRow's own guard
    // (`rulingsSettled.has(key)`) then silently no-ops the close-out loop's
    // press: no second API call, no error, no feedback. A suggestion/agree
    // on one loop's row must never suppress the other's — this is the
    // ticket's "a suggestion or shelve addresses one loop's row without
    // touching the other" acceptance limb.
    await agreeRulingRow(rowCloseout, liCloseout);
    assert.deepEqual(
      calls.map((c) => c.decisionLoopId).sort(),
      [CLOSEOUT_LOOP, REVIEW_LOOP].sort(),
      'the close-out loop’s row must be independently agreeable — it must not be silently swallowed by rulingsSettled just because it shares decision_id with the already-agreed review loop'
    );
  });
});

// ─── The selection-clearing INVARIANT, not just its six known instances ───
//
// Three review rounds each closed the *named* instances and a new one kept
// turning up (F1/F2 → F6/F7/Dismiss/deliverRulingReply → F8/shelve). Rather
// than trust the next reader to re-derive "every terminal rulings-row
// action" by eye again, this pins the REPRODUCIBLE QUERY that enumeration
// was built from (the LIN-1873 cited-sweep convention this repo already
// uses for a class check): every per-row write handler in this file marks
// itself in flight via the established `rulingsPending.add(key)` idiom
// before issuing its request — that is how the pending-guard/disable/
// restore dance every one of them needs is written, not a convention
// invented for this test. So a source-level query is a genuine population
// enumeration, not an approximation of one: for every TOP-LEVEL function in
// public/observation.js whose body contains `rulingsPending.add(key)`,
// its body must also contain `rulingsSelected.delete(key)` — the fix every
// prior instance got.
//
// This is deliberately NOT a `settleRulingSelection(key)` shared-funnel
// refactor. Six independently-reviewed, CI-green verbs (three review
// rounds deep, one review left per John's ceiling) would all need touching
// to route through a new helper — real risk to working code for a
// cosmetic win, exactly what the ticket's own instructions warn against
// this late. The cheaper thing that still genuinely holds: a future verb
// that follows the SAME idiom every current one does (guard-in-flight via
// `rulingsPending.add(key)`, disable controls, issue the request) trips
// this test the moment it's added, before it ever reaches review — because
// the query re-runs over the CURRENT source, not a hard-coded list of six
// names. The one gap this doesn't close: a new verb that skips the
// `rulingsPending.add(key)` idiom entirely bypasses the query — every
// verb on this surface uses it today (there is no other way instances get
// their controls disabled while in flight), so a verb author would have to
// deliberately diverge from the file's own established pattern to evade
// this, not merely omit one line.
describe('the rulings selection-clearing invariant (LIN-2444 review — closing the enumeration itself)', () => {
  test('every top-level function that guards itself via rulingsPending.add(key) also clears rulingsSelected.delete(key) on success', () => {
    const lines = OBSERVATION_JS_SRC.split('\n');
    const starts = [];
    const fnHeaderRe = /^(async )?function (\w+)\(/;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(fnHeaderRe);
      if (m) starts.push({ line: i, name: m[2] });
    }
    assert.ok(starts.length > 0, 'sanity: the source must contain top-level function declarations for this query to mean anything');

    const guardedWithoutClear = [];
    const guardedFns = [];
    for (let idx = 0; idx < starts.length; idx++) {
      const { line: start, name } = starts[idx];
      const end = idx + 1 < starts.length ? starts[idx + 1].line : lines.length;
      const body = lines.slice(start, end).join('\n');
      if (body.includes('rulingsPending.add(key)')) {
        guardedFns.push(name);
        if (!body.includes('rulingsSelected.delete(key)')) guardedWithoutClear.push(name);
      }
    }

    // The population itself, asserted so a change to the guard idiom (or a
    // rename) surfaces as a visible test-list change rather than the query
    // silently enumerating zero functions and the invariant vacuously
    // "passing".
    assert.deepEqual(
      guardedFns.sort(),
      ['agreeRulingRow', 'bulkAgreeRow', 'deliverRulingReply', 'dismissRulingRow', 'keepRulingRow', 'shelveRulingRow'].sort(),
      'the enumerated population of per-row rulings write handlers changed — update this list deliberately, or a new/renamed handler slipped past unexamined'
    );
    assert.deepEqual(guardedWithoutClear, [], `every rulingsPending.add(key)-guarded handler must also call rulingsSelected.delete(key) on success — missing in: ${guardedWithoutClear.join(', ')}`);
  });
});

// ─── rulingEffectOverride lifecycle (LIN-2775 Area 5) ───────────────────────
//
// The override Map is consulted from TWO different places in renderRulings'
// per-row loop depending on which branch a row takes: a fresh row goes
// through renderRulingRow, which restores it at creation time; a row held by
// `mustReuse` (pending/preserved/settled) skips renderRulingRow entirely and
// simply reuses whatever <li> is already attached. The staleness prune must
// therefore run in renderRulings itself, ahead of that branch, not only
// inside renderRulingRow — S12's mechanism correction, and the exact bug
// class `8feb02c7`/LIN-2262 already fixed once in the shelf-gate keying.
describe('rulingEffectOverride lifecycle (LIN-2775 Area 5)', () => {
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

  function flippableRow(overrides = {}) {
    return makeRow({
      decision: { decision_id: 'd-effect-1' },
      effect: 'dispatch',
      alternate: 'record',
      ...overrides
    });
  }

  test('pressing the flip control sets an override and swaps the row\'s caption/flip label in place', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings, rulingKey, rulingEffectOverride } = module.exports;

    renderRulings([flippableRow()]);
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-effect-1');
    assert.equal(rulingEffectOverride.has(key), false, 'no override before any press');

    const li = list.children[0];
    const flip = li.querySelectorAll('.obs-ruling-effect-flip')[0];
    assert.ok(flip, 'a row with a non-null alternate must render the flip control');
    assert.equal(flip.textContent, 'Use "record" instead');

    flip.click();

    assert.equal(rulingEffectOverride.get(key), 'record', 'flipping stores the row\'s own alternate as the override value');
    // The click swapped `li` for a freshly rendered node in the list.
    const flippedLi = list.children[0];
    assert.notEqual(flippedLi, li, 'the flip control re-renders its own row rather than mutating the old node');
    const flippedFlip = flippedLi.querySelectorAll('.obs-ruling-effect-flip')[0];
    assert.ok(flippedFlip.classList.contains('obs-ruling-effect-flip--active'));
    assert.equal(flippedFlip.textContent, 'Use "dispatch" instead', 'label now offers to flip back to the row\'s own default effect');

    flippedFlip.click();
    assert.equal(rulingEffectOverride.has(key), false, 'a second press clears the override entirely rather than storing the default back into the map');
  });

  test('an override survives a repaint with the SAME payload (row.alternate unchanged) — fresh-render path', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings, rulingKey, rulingEffectOverride } = module.exports;

    const row = flippableRow();
    renderRulings([row]);
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-effect-1');
    list.children[0].querySelectorAll('.obs-ruling-effect-flip')[0].click();
    assert.equal(rulingEffectOverride.get(key), 'record');

    // Next poll: a NEW row object, but the same alternate — this is what a
    // real repaint looks like (renderRulings is always handed a fresh
    // payload array). Nothing here marks the row as mustReuse, so this goes
    // through the fresh renderRulingRow path, which must restore the
    // override at creation time.
    const repaintedRow = flippableRow();
    renderRulings([repaintedRow]);

    assert.equal(rulingEffectOverride.get(key), 'record', 'the override must still be present after a same-payload repaint');
    const repaintedLi = list.children[0];
    const repaintedFlip = repaintedLi.querySelectorAll('.obs-ruling-effect-flip')[0];
    assert.ok(repaintedFlip.classList.contains('obs-ruling-effect-flip--active'), 'the restored row must render the flip control already in its overridden state');
  });

  test('a stale override (payload\'s alternate changed) is pruned — fresh-render path, row.effect wins', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings, rulingKey, rulingEffectOverride } = module.exports;

    renderRulings([flippableRow()]);
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-effect-1');
    list.children[0].querySelectorAll('.obs-ruling-effect-flip')[0].click();
    assert.equal(rulingEffectOverride.get(key), 'record');

    // A later evidence swing: the SAME row now resolves a different
    // alternate (e.g. a live dispatch appeared on the anchor between polls).
    // The stored override ('record') no longer equals the new alternate
    // ('resume'), so it must be pruned outright, not merely ignored.
    const swungRow = flippableRow({ effect: 'dispatch', alternate: 'resume' });
    renderRulings([swungRow]);

    assert.equal(rulingEffectOverride.has(key), false, 'a stale override must be pruned, not just ignored');
    const freshLi = list.children[0];
    const freshFlip = freshLi.querySelectorAll('.obs-ruling-effect-flip')[0];
    assert.ok(!freshFlip.classList.contains('obs-ruling-effect-flip--active'), 'row.effect must win — the row renders un-overridden');
    assert.equal(freshFlip.textContent, 'Use "resume" instead', 'the flip control now offers the NEW alternate, not the stale one');
  });

  test('an override survives a repaint on the mustReuse (pending) reuse path — the same <li> is kept as-is', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings, rulingKey, rulingEffectOverride, rulingsPending } = module.exports;

    const row = flippableRow();
    renderRulings([row]);
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-effect-1');
    const flippedLi = (() => {
      list.children[0].querySelectorAll('.obs-ruling-effect-flip')[0].click();
      return list.children[0];
    })();
    assert.equal(rulingEffectOverride.get(key), 'record');

    // Mark the row mid-flight (mustReuse), matching a poll landing between a
    // press and its network round trip completing — renderRulings must NOT
    // rebuild the row (renderRulingRow is never called on this path), it
    // must reuse the exact same <li> the operator is looking at.
    rulingsPending.add(key);
    renderRulings([flippableRow()]);

    assert.equal(rulingEffectOverride.get(key), 'record', 'the override must still be present after a mustReuse repaint');
    assert.equal(list.children[0], flippedLi, 'the mustReuse path must reuse the exact already-flipped <li>, never rebuild it');

    rulingsPending.delete(key);
  });

  test('a stale override is pruned on the mustReuse (pending) reuse path too — the staleness check does not live only inside renderRulingRow', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings, rulingKey, rulingEffectOverride, rulingsPending } = module.exports;

    renderRulings([flippableRow()]);
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-effect-1');
    list.children[0].querySelectorAll('.obs-ruling-effect-flip')[0].click();
    assert.equal(rulingEffectOverride.get(key), 'record');

    // mustReuse this time (unlike the fresh-render staleness test above) —
    // renderRulingRow is never invoked on this branch, so if the prune were
    // written only inside it (the S12 trap this ticket calls out by name),
    // this assertion is exactly what would catch it: the map would still
    // hold the stale 'record' value here.
    rulingsPending.add(key);
    const swungRow = flippableRow({ effect: 'dispatch', alternate: 'resume' });
    renderRulings([swungRow]);

    assert.equal(rulingEffectOverride.has(key), false, 'the staleness prune must run on the mustReuse path too, not only inside renderRulingRow');

    rulingsPending.delete(key);
  });

  test('a row with row.alternate === null never renders the flip control (a hard override can never surface here)', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings } = module.exports;

    renderRulings([makeRow({ decision: { decision_id: 'd-hard-1' }, effect: 'resume', alternate: null })]);

    const li = list.children[0];
    assert.equal(li.querySelectorAll('.obs-ruling-effect-flip').length, 0);
  });

  test('a vanished row\'s override is pruned in the seen sweep, so a later reused key never inherits a stale flip', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings, rulingKey, rulingEffectOverride } = module.exports;

    renderRulings([flippableRow()]);
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-effect-1');
    list.children[0].querySelectorAll('.obs-ruling-effect-flip')[0].click();
    assert.equal(rulingEffectOverride.get(key), 'record');

    // The ruling leaves the feed entirely (answered, or otherwise gone) —
    // not mustReuse, not present in the new payload at all.
    renderRulings([]);

    assert.equal(rulingEffectOverride.has(key), false, 'the override must not survive its row leaving the feed');
  });
});

// ─── resolveRecordTarget (LIN-2775 Area 6) — pure, no DOM/network ──────────
describe('resolveRecordTarget (LIN-2775 Area 6)', () => {
  function sandboxExports() {
    return makeSandbox({ postComment: async () => ({ ok: true, status: 201, data: {} }) }).module.exports;
  }

  test('no record_on declared → the anchor, no note', () => {
    const { resolveRecordTarget } = sandboxExports();
    const result = resolveRecordTarget(ANCHOR, null, { hydrated: true, neighborhood: { parent: null, siblings: [], children: [], cousins: [] } });
    assert.equal(result.issueId, ANCHOR.issueId);
    assert.equal(result.issueIdentifier, ANCHOR.issueIdentifier);
    assert.equal(result.note, null);
  });

  test('record_on matches nothing in the neighbourhood → the anchor, the outside-neighbourhood note', () => {
    const { resolveRecordTarget, RECORD_TARGET_OUTSIDE_NOTE } = sandboxExports();
    const result = resolveRecordTarget(ANCHOR, 'LIN-NOWHERE', {
      hydrated: true,
      neighborhood: { parent: null, siblings: [{ id: 'id-1', identifier: 'LIN-1', state: { type: 'started' } }], children: [], cousins: [] }
    });
    assert.equal(result.issueId, ANCHOR.issueId);
    assert.equal(result.note, RECORD_TARGET_OUTSIDE_NOTE);
  });

  test('record_on matches a neighbour whose own state is terminal → the anchor, the note', () => {
    const { resolveRecordTarget, RECORD_TARGET_OUTSIDE_NOTE } = sandboxExports();
    for (const type of ['completed', 'canceled', 'duplicate']) {
      const result = resolveRecordTarget(ANCHOR, 'LIN-T', {
        hydrated: true,
        neighborhood: { parent: null, siblings: [], children: [{ id: 'id-t', identifier: 'LIN-T', state: { type } }], cousins: [] }
      });
      assert.equal(result.issueId, ANCHOR.issueId, `terminal type ${type} must fall back to the anchor`);
      assert.equal(result.note, RECORD_TARGET_OUTSIDE_NOTE);
    }
  });

  test('record_on matches a non-terminal neighbour → that neighbour, no note', () => {
    const { resolveRecordTarget } = sandboxExports();
    const result = resolveRecordTarget(ANCHOR, 'LIN-COUSIN', {
      hydrated: true,
      neighborhood: { parent: null, siblings: [], children: [], cousins: [{ id: 'id-cousin', identifier: 'LIN-COUSIN', state: { type: 'started' } }] }
    });
    assert.equal(result.issueId, 'id-cousin');
    assert.equal(result.issueIdentifier, 'LIN-COUSIN');
    assert.equal(result.note, null);
  });

  test('record_on matches the parent specifically (not only siblings/children/cousins)', () => {
    const { resolveRecordTarget } = sandboxExports();
    const result = resolveRecordTarget(ANCHOR, 'LIN-PARENT', {
      hydrated: true,
      neighborhood: { parent: { id: 'id-parent', identifier: 'LIN-PARENT', state: { type: 'unstarted' } }, siblings: [], children: [], cousins: [] }
    });
    assert.equal(result.issueId, 'id-parent');
    assert.equal(result.note, null);
  });

  test('a failed/unavailable hydrate result (hydrated: false) → the anchor, the note — fails safe, never throws', () => {
    const { resolveRecordTarget, RECORD_TARGET_OUTSIDE_NOTE } = sandboxExports();
    const result = resolveRecordTarget(ANCHOR, 'LIN-SOMETHING', { hydrated: false, reason: 'unavailable' });
    assert.equal(result.issueId, ANCHOR.issueId);
    assert.equal(result.note, RECORD_TARGET_OUTSIDE_NOTE);
  });
});
