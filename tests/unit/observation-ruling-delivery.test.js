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
import { DISPATCH_KINDS } from '../../lib/prompt-templates.js';

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

// LIN-2775 Area 8: the press-time check's `window.api` hydrate mock, for
// tests exercising the ORDINARY `gone`+dispatch path — a non-terminal
// anchor state, so the check confirms and lets the dispatch proceed
// unchanged. Tests exercising the downgrade itself stub their own `api`.
function nonTerminalHydrateApi() {
  return async () => ({ hydrated: true, identifier: ANCHOR.issueIdentifier, state: { name: 'In Progress', type: 'started' } });
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
      // LIN-2758: recorded (not just a no-op) so a test can retrieve and
      // directly invoke the ONE real registration observation.js makes at
      // top-level script execution (`window.addEventListener('beforeunload',
      // ...)`, :4242) — the beforeunload-guard-armed-only-while-running
      // acceptance point has no other seam reachable from this DOM-free
      // harness (there's no real `window` to dispatch an actual unload
      // event against).
      _listeners: {},
      addEventListener(type, handler) {
        (this._listeners[type] = this._listeners[type] || []).push(handler);
      },
      matchMedia: () => ({ matches: false }),
      // LIN-2792: `resolveCaption` mirrors public/chat.js's own read-only
      // DISPOSITION_CAPTIONS wording closely enough for tests that assert
      // the refusal text NAMES the reason (mid-turn vs indeterminate) rather
      // than asserting an exact string this file doesn't own.
      ChatUI: {
        appendOptions() {},
        resolveCaption(disposition) {
          if (disposition === 'mid-turn') return 'still running — reply disabled';
          if (disposition === 'indeterminate') return 'no action available yet';
          return 'no action available yet';
        }
      },
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
    // LIN-2775 Area 7: a `gone` row's resolveEffect default IS 'dispatch'
    // (ON_ANSWER_EFFECT_DEFAULTS.gone, lib/unanswered-decisions.js) — every
    // caller below that doesn't override `effect`/`alternate` via `rest` is
    // now explicitly re-anchored on the row shape the real feed actually
    // sends for an ordinary gone ruling, rather than relying on `effect`
    // being silently `undefined` (which happened to take the same branch,
    // by accident of `!== 'record'`, not by declared intent).
    effect: 'dispatch',
    alternate: null,
    ...rest
  };
}

describe('deliverRulingReply — gone disposition (LIN-1728 review F1/F2)', () => {
  test('F1: the comment write targets anchor.workspaceUrlKey, never a page urlKey', async () => {
    let capturedUrlKey = null;
    const { module } = makeSandbox({
      postComment: async (urlKey) => { capturedUrlKey = urlKey; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => ({ id: 'dispatched-1' }),
      api: nonTerminalHydrateApi()
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
      dispatchPrompt: async (opts) => { capturedOpts = opts; return { id: 'dispatched-1' }; },
      api: nonTerminalHydrateApi()
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeRow(), 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(capturedOpts, 'expected dispatchPrompt to be called');
    assert.equal(capturedOpts.urlKey, 'the-ruling-workspace');
    assert.equal(capturedOpts.issue.id, 'issue-1');
    assert.equal(capturedOpts.issue.identifier, 'LIN-1728-G');
  });

  // ── LIN-2775 Area 7 — THE HEADLINE WITNESS ──────────────────────────────
  //
  // This is the ticket's own reason to exist: tapping "preserve" on a
  // ruling today launches an agent whose ENTIRE brief is the word
  // "preserve" — `dispatchPrompt` receives the raw pressed-option text (or
  // free text) as `prompt`, verbatim, and nothing else. No test anywhere in
  // this suite previously asserted on `.prompt` — every existing
  // dispatchPrompt-opts assertion above (F1, G1 below) checks only
  // urlKey/issue.id/issue.identifier — which is exactly why this defect
  // shipped and stayed unnoticed. This test MUST fail against that
  // raw-reply-text behaviour; confirmed red-first (see beat 3's own report).
  test('HEADLINE: the composed dispatch prompt carries the question, the chosen answer, and the decisionCase recap — never just the raw pressed text', async () => {
    let capturedOpts = null;
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async (opts) => { capturedOpts = opts; return { id: 'dispatched-1' }; },
      api: nonTerminalHydrateApi()
    });
    const { deliverRulingReply, RULING_COMPOSED_RUN_MARKER } = module.exports;
    const li = makeLi();

    const row = makeRow({
      decision: { decision_id: 'd-headline-1', question: 'Preserve the legacy adapter, or retire it?' },
      decisionCase: ['The adapter has zero callers in prod.', 'Staging still references it via a feature flag.']
    });

    deliverRulingReply(row, 'Preserve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.ok(capturedOpts, 'expected dispatchPrompt to be called');
    // The regression this witness exists to catch: pre-fix, capturedOpts.prompt
    // was LITERALLY just 'Preserve' — the pressed option's bare label, nothing
    // else. Asserting `.prompt === 'Preserve'` would PASS against that bug, so
    // this checks for the presence of everything the bug's prompt lacked.
    assert.notEqual(capturedOpts.prompt, 'Preserve', 'the raw pressed text alone is exactly the pre-fix regression this witness exists to catch');
    assert.match(capturedOpts.prompt, /Preserve the legacy adapter, or retire it\?/, 'must carry the decision\'s own question');
    assert.match(capturedOpts.prompt, /Preserve/, 'must carry the chosen option\'s label (or free text)');
    assert.match(capturedOpts.prompt, /The adapter has zero callers in prod\./, 'must carry the decisionCase recap');
    assert.match(capturedOpts.prompt, /Staging still references it via a feature flag\./);
    assert.equal(capturedOpts.promptName, 'Ruling reply');
    assert.ok(DISPATCH_KINDS.includes(capturedOpts.kind), `capturedOpts.kind ("${capturedOpts.kind}") must be a member of DISPATCH_KINDS`);
    assert.equal(capturedOpts.kind, 'custom', 'nothing more specific than the neutral default is derivable from a ruling row today');
    // LIN-2775 Area 8: the composed-run marker must ride along on every
    // ordinary composed dispatch, activating the server-side terminal-anchor
    // guard for this call specifically.
    assert.equal(capturedOpts.composedRunMarker, RULING_COMPOSED_RUN_MARKER);
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
      },
      api: nonTerminalHydrateApi()
    });
    const { deliverRulingReply, rulingsPending, preservedRulingRows, rulingKey } = module.exports;
    const li = makeLi();
    const row = makeRow();
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');

    deliverRulingReply(row, 'Approve', li);
    assert.ok(rulingsPending.has(key), 'expected the decision to be marked pending immediately');

    // Flush the press-time hydrate check -> postComment -> dispatchPrompt
    // (rejects) -> onPartialFailure.
    await new Promise((r) => setImmediate(r));
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
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      api: nonTerminalHydrateApi()
    });
    const { deliverRulingReply, rulingsPending, preservedRulingRows, rulingKey } = module.exports;
    const li = makeLi();
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-2');

    deliverRulingReply(makeRow({ decision: { decision_id: 'd-gone-2' } }), 'Approve', li);
    await new Promise((r) => setImmediate(r));
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
      dispatchPrompt: async (opts) => { capturedDispatchOpts = opts; return { id: 'dispatched-1' }; },
      api: nonTerminalHydrateApi()
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeRow({ anchor: { issueId: null, issueIdentifier: 'LIN-1728-G' }, decision: { decision_id: 'd-gone-4' } }), 'Approve', li);
    await new Promise((r) => setImmediate(r));
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
    // Beat 3 correction: this case is NOT "outside the checked neighbourhood"
    // — LIN-DONE WAS found there. Reusing that note here would itself be a
    // false claim, so the terminal case gets its own honest wording.
    assert.match(feedback.textContent, /already closed/);
    assert.doesNotMatch(feedback.textContent, /outside the checked neighbourhood/, 'the terminal case must not borrow the not-found note — the target WAS in the checked neighbourhood');
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

// ─── Press-time check (LIN-2775 Area 8) ─────────────────────────────────────
//
// Before a `dispatch`-effect row actually composes and sends anything, the
// anchor's OWN current `state.type` is read via the widened hydrate route.
// Two outcomes, both specified: disagreement (the anchor is now terminal)
// downgrades to record IN PLACE; a hydration failure — every failure mode
// swallowed identically — fails CLOSED to record too. Never a silent
// dispatch, never a silent no-op: both routes through the SAME record
// delivery, so the row always ends up commented, stamped, and cleared.
describe('deliverRulingReply — press-time check (LIN-2775 Area 8)', () => {
  for (const terminalType of ['completed', 'canceled', 'duplicate']) {
    test(`disagreement: an anchor now ${terminalType} downgrades to record, dispatchPrompt is never called, and the note renders`, async () => {
      let commentCalls = 0;
      let dispatchCalls = 0;
      const { module } = makeSandbox({
        postComment: async () => { commentCalls += 1; return { ok: true, status: 201, data: {} }; },
        dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
        api: async () => hydrateOk({}, { name: 'Terminal', type: terminalType })
      });
      const { deliverRulingReply } = module.exports;
      const li = makeLi();

      deliverRulingReply(makeRow({ decision: { decision_id: `d-presstime-${terminalType}` } }), 'Approve', li);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      assert.equal(commentCalls, 1, 'the row must still be delivered — commented and stamped — never silently dropped');
      assert.equal(dispatchCalls, 0, `a ${terminalType} anchor must never be dispatched to`);
      const feedback = li.querySelector('.obs-ruling-feedback');
      assert.match(feedback.textContent, /recorded ✓/);
      assert.match(feedback.textContent, /now closed/, 'the note must say why — a downgrade, not an unexplained record');
    });
  }

  for (const reason of ['no_token', 'not_found', 'unavailable']) {
    test(`hydration failure (${reason}): fails CLOSED to record, dispatchPrompt is never called, and the note renders`, async () => {
      let commentCalls = 0;
      let dispatchCalls = 0;
      const { module } = makeSandbox({
        postComment: async () => { commentCalls += 1; return { ok: true, status: 201, data: {} }; },
        dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
        api: async () => ({ hydrated: false, reason })
      });
      const { deliverRulingReply } = module.exports;
      const li = makeLi();

      deliverRulingReply(makeRow({ decision: { decision_id: `d-presstime-fail-${reason}` } }), 'Approve', li);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      assert.equal(commentCalls, 1, `a ${reason} hydration failure must still deliver — never a silent no-op`);
      assert.equal(dispatchCalls, 0, `a ${reason} hydration failure must fail CLOSED, never dispatch unverified`);
      const feedback = li.querySelector('.obs-ruling-feedback');
      assert.match(feedback.textContent, /recorded ✓/);
      assert.match(feedback.textContent, /could not confirm/, 'the note must say why — swallowed identically regardless of the specific reason');
    });
  }

  test('a network-level rejection from the hydrate call itself (not a well-formed {hydrated:false}) also fails CLOSED to record', async () => {
    let commentCalls = 0;
    let dispatchCalls = 0;
    const { module } = makeSandbox({
      postComment: async () => { commentCalls += 1; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'dispatched-1' }; },
      api: async () => { throw new Error('network unreachable'); }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeRow({ decision: { decision_id: 'd-presstime-throw' } }), 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(commentCalls, 1);
    assert.equal(dispatchCalls, 0);
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /recorded ✓/);
    assert.match(feedback.textContent, /could not confirm/);
  });

  test('a non-terminal anchor confirmed at press time proceeds to the ordinary dispatch path, composedRunMarker included', async () => {
    let commentCalls = 0;
    let capturedOpts = null;
    const { module } = makeSandbox({
      postComment: async () => { commentCalls += 1; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async (opts) => { capturedOpts = opts; return { id: 'dispatched-1' }; },
      api: async () => hydrateOk({}, { name: 'In Progress', type: 'started' })
    });
    const { deliverRulingReply, RULING_COMPOSED_RUN_MARKER } = module.exports;
    const li = makeLi();

    deliverRulingReply(makeRow({ decision: { decision_id: 'd-presstime-ok' } }), 'Approve', li);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(commentCalls, 1);
    assert.ok(capturedOpts, 'a confirmed non-terminal anchor must still dispatch');
    assert.equal(capturedOpts.composedRunMarker, RULING_COMPOSED_RUN_MARKER);
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /recorded ✓/);
    assert.doesNotMatch(feedback.textContent, /now closed|could not confirm/, 'a confirmed non-terminal anchor must not carry a downgrade note');
  });

  test('a row with no linked issue at all is refused before ever reaching the press-time hydrate call', async () => {
    let apiCalls = 0;
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => ({ id: 'dispatched-1' }),
      api: async () => { apiCalls += 1; return hydrateOk({}, { type: 'started' }); }
    });
    const { deliverRulingReply } = module.exports;
    const li = makeLi();

    deliverRulingReply(
      makeRow({ anchor: { ...ANCHOR, issueId: null, issueIdentifier: null }, decision: { decision_id: 'd-presstime-noissue' } }),
      'Approve', li
    );
    await new Promise((r) => setImmediate(r));

    assert.equal(apiCalls, 0, 'nothing to hydrate — the refusal must precede the press-time call entirely');
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
      },
      api: nonTerminalHydrateApi()
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

  test('a successful Agree writes "dismissed as proposed" feedback and clears its pending state (no dangling pending state)', async () => {
    const { module } = makeSandbox({ api: async () => ({ success: true }) });
    const { agreeRulingRow, rulingsPending, rulingKey } = module.exports;
    const li = makeLi();
    const row = makeRow();

    await agreeRulingRow(row, li);

    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.equal(feedback.textContent, 'dismissed as proposed');
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
    assert.match(feedback.textContent, /dismiss failed/);
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

  // LIN-2797 — the review-F2 repaint test above covers the row STAYING in
  // the payload (the pre-LIN-2755 stale-cache case: the same suggested row
  // keeps being served). This covers the OTHER case LIN-2755 made routine:
  // the row disappearing from the very next payload because the cache now
  // invalidates immediately. Before this fix, a settled key was released the
  // INSTANT it went missing (no re-injection), so the very next repaint
  // dropped the row's `<li>` from `nodes` entirely with no chance for a
  // late-arriving `agreeRulingRow`/`bulkAgreeRow` success handler to ever
  // find it again — a real risk once "missing" can happen on poll #1 instead
  // of only after the old 5s TTL. The fix: a settled row survives its FIRST
  // missing poll (same `<li>`, not rebuilt) and is released only on a SECOND
  // consecutive missing poll.
  test('a settled row survives one missing poll unrebuilt, then releases on the next (LIN-2797)', async () => {
    const { module, list } = (() => {
      const l = new FakeElement('ul');
      const e = new FakeElement('p'); e.hidden = false;
      const { module: m } = makeSandbox({
        api: async () => ({ success: true }),
        elements: { 'obs-rulings': l, 'obs-rulings-empty': e }
      });
      return { module: m, list: l };
    })();
    const { renderRulings, agreeRulingRow, rulingsSettled, rulingsSettledGhosted, rulingKey } = module.exports;
    const row = makeRow();
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');

    renderRulings([row]);
    const li = list.children[0];
    await agreeRulingRow(row, li);
    assert.ok(rulingsSettled.has(key), 'sanity: Agree marked the key settled');

    // Poll #1 after discharge: the row is ALREADY gone from the payload
    // (the fixed, fast-invalidating cache) — the row must still be there,
    // as the SAME node, not rebuilt fresh and textless.
    renderRulings([]);
    assert.equal(list.children.length, 1, 'the settled row must survive its first missing poll');
    assert.equal(list.children[0], li, 'it must be the SAME <li> agreeRulingRow already wrote feedback text onto, not a rebuilt one');
    assert.equal(li.querySelector('.obs-ruling-feedback').textContent, 'dismissed as proposed', 'the feedback text must still be visible on the surviving node');
    assert.ok(rulingsSettledGhosted.has(key), 'the ghost flag records that this key has now been shown once while missing');

    // Poll #2, still missing: NOW it releases for real.
    renderRulings([]);
    assert.equal(list.children.length, 0, 'a row missing for a SECOND consecutive poll must finally be released');
    assert.equal(rulingsSettled.has(key), false, 'released — a later re-suggestion on this key starts fully re-armed');
    assert.equal(rulingsSettledGhosted.has(key), false, 'the ghost flag is cleared alongside release, not leaked');
  });

  // The reappearance side of the same fix: if the row comes BACK before the
  // second miss (the stale cache still serving it once), the ghost flag must
  // reset rather than carrying a stale "already shown once" count into a
  // LATER, unrelated disappearance.
  test('a settled row that reappears before release resets the ghost flag (LIN-2797)', async () => {
    const { module, list } = (() => {
      const l = new FakeElement('ul');
      const e = new FakeElement('p'); e.hidden = false;
      const { module: m } = makeSandbox({
        api: async () => ({ success: true }),
        elements: { 'obs-rulings': l, 'obs-rulings-empty': e }
      });
      return { module: m, list: l };
    })();
    const { renderRulings, agreeRulingRow, rulingsSettled, rulingsSettledGhosted, rulingKey } = module.exports;
    const row = makeRow();
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');

    renderRulings([row]);
    const li = list.children[0];
    await agreeRulingRow(row, li);

    renderRulings([]); // miss #1 — ghosted
    assert.ok(rulingsSettledGhosted.has(key));

    renderRulings([row]); // reappears — the stale cache still serves it once
    assert.equal(rulingsSettledGhosted.has(key), false, 'reappearing clears the ghost flag');
    assert.ok(rulingsSettled.has(key), 'still settled — not released just because it reappeared');

    renderRulings([]); // a FRESH miss must get its own full one-more-look, not an immediate release
    assert.equal(list.children.length, 1, 'a fresh disappearance after a reappearance must survive one more poll, not release immediately');
    assert.ok(rulingsSettled.has(key));
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
    assert.equal(agreeBtn.textContent, 'Apply 0 as proposed');
    assert.equal(agreeBtn.disabled, true, '"Apply … as proposed" must not render enabled over an empty real selection');
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
    assert.match(confirmCalls[0], /1 selected proposal/);
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

    // LIN-2797: the row going missing for exactly ONE poll is not yet proof
    // it is really gone (see rulingsSettledGhosted's own declaration) — it
    // must still survive, as the SAME node, one more pass.
    renderRulings([]);
    assert.equal(list.children.length, 1, 'a settled row survives its first missing poll');
    assert.equal(list.children[0], settledLi, 'still the SAME node on that first missing poll, not rebuilt');

    // Only a SECOND consecutive missing poll is the row finally leaving the
    // payload for real.
    renderRulings([]);
    assert.equal(list.children.length, 0, 'released after a second consecutive missing poll');
    // A later re-suggestion (or the same one, re-raised) starts fully re-armed.
    renderRulings([row]);
    const rebuiltLi = list.children[0];
    assert.notEqual(rebuiltLi, settledLi, 'once truly absent for two consecutive polls, the settled mark releases and a later row is rebuilt fresh');
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
    assert.equal(agreeBtn.textContent, 'Apply 0 as proposed');
    assert.equal(agreeBtn.disabled, true);

    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-a'), true);
    assert.equal(agreeBtn.textContent, 'Apply 1 as proposed');
    assert.equal(agreeBtn.disabled, false);
    assert.equal(selectAll.indeterminate, true);

    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-b'), true);
    assert.equal(agreeBtn.textContent, 'Apply 2 as proposed');
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

// ─── Bulk-agree progress / Stop / completion summary (LIN-2758) ────────────
//
// Written red-first, beat 1 of a stepped implementation run: none of this
// mechanism existed yet at HEAD 82e8b36b — `rulingsBulkRunning`,
// `rulingsBulkStopRequested`, `updateRulingsBulkProgress`,
// `renderRulingsBulkSummary`, the `#obs-ruling-bulk-progress` node, and the
// `#obs-ruling-bulk-stop` button were all beat 2's own additions. Every test
// below was confirmed failing against that HEAD before beat 2 implemented
// the mechanism these pin. `#obs-ruling-bulk-progress`/`#obs-ruling-bulk-stop`
// are provided here as FakeElement stubs (this harness never reads real
// markup) mirroring the sibling `<p>`/`<button>` lib/render-observation.js
// now renders.
describe('bulk-agree progress / Stop / completion summary (LIN-2758, red-first)', () => {
  function makeProgressSandbox({ api, confirm } = {}) {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p'); empty.hidden = false;
    const bar = new FakeElement('div');
    const selectAll = new FakeElement('input');
    const countEl = new FakeElement('span');
    const agreeBtn = new FakeElement('button');
    const progressEl = new FakeElement('p');
    const stopBtn = new FakeElement('button');
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
        'obs-ruling-agree-selected': agreeBtn,
        'obs-ruling-bulk-progress': progressEl,
        'obs-ruling-bulk-stop': stopBtn
      }
    });
    // initControls() is only ever called from init(), which this harness
    // never invokes (see the file-header note on public/observation.js's own
    // two addEventListener calls) — calling it standalone here is safe,
    // since every binding inside is `if (el) ...`-guarded against elements
    // this fixture doesn't provide, and it is what wires the Stop button's
    // real click listener so a test can press Stop exactly the way an
    // operator would, rather than reaching into module internals that don't
    // exist yet.
    sandbox.initControls();
    return { sandbox, module: sandbox.module, list, bar, selectAll, countEl, agreeBtn, progressEl, stopBtn };
  }

  const SUGGESTION = { reason: 'shipped', suggestedBy: 'lane-e', suggestedAt: '2026-09-05T00:00:00.000Z' };
  function suggestedRow(overrides = {}) {
    return makeRow({ suggestedDismissal: SUGGESTION, ...overrides });
  }

  test('progress text updates per row, literally 1-based: "Applying 1 of N…" through "Applying N of N…"', async () => {
    const seenAtCallTime = [];
    const { module, progressEl } = makeProgressSandbox({
      api: async () => { seenAtCallTime.push(progressEl.textContent); return { success: true }; }
    });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    const rows = ['d-p1', 'd-p2', 'd-p3'].map((id) => suggestedRow({ decision: { decision_id: id } }));
    renderRulings(rows);
    rows.forEach((r) => toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, r.decision.decision_id), true));

    await bulkAgreeSelected();

    assert.deepEqual(
      seenAtCallTime,
      ['Applying 1 of 3…', 'Applying 2 of 3…', 'Applying 3 of 3…'],
      'the progress node must read the 1-based count BEFORE each row is attempted — the first read "Applying 1 of 3…", the last "Applying 3 of 3…" (an off-by-one would fail this immediately, not just "look wrong")'
    );
  });

  test('Stop halts the loop before the next row — every unattempted row is still in rulingsSelected, and the summary reads the stopped-early shape', async () => {
    const calls = [];
    const { module, stopBtn, progressEl } = makeProgressSandbox({
      api: async (url, opts) => {
        calls.push(JSON.parse(opts.body).decisionId);
        // Press Stop from INSIDE the first row's own settle: a row already
        // in flight is never aborted (no AbortController) — the flag is
        // only checked at the TOP of the next iteration, so Stop must land
        // after row 1 resolves but before row 2 is attempted.
        if (calls.length === 1) stopBtn.click();
        return { success: true };
      }
    });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingsSelected, rulingKey } = module.exports;

    const rows = ['d-s1', 'd-s2', 'd-s3'].map((id) => suggestedRow({ decision: { decision_id: id } }));
    renderRulings(rows);
    const keys = rows.map((r) => rulingKey('the-ruling-workspace', ANCHOR, r.decision.decision_id));
    keys.forEach((k) => toggleRulingSelection(k, true));

    await bulkAgreeSelected();

    assert.deepEqual(calls, ['d-s1'], 'only the row already underway when Stop was pressed may run — Stop must not let a second row start');
    assert.equal(rulingsSelected.has(keys[0]), false, 'the row that completed before Stop was pressed settles normally');
    assert.ok(rulingsSelected.has(keys[1]), 'every row Stop pre-empted must remain selected, not silently dropped');
    assert.ok(rulingsSelected.has(keys[2]), 'every row Stop pre-empted must remain selected, not silently dropped');
    assert.equal(
      progressEl.textContent,
      'Stopped after 1 of 3 — 2 remain selected.',
      'the stopped-early summary must use the last row actually reached (1), never the total (3)'
    );
  });

  test('select-all and the bulk apply button are disabled for the duration of the run and re-enabled once it ends', async () => {
    let rejectFirst;
    const { module, selectAll, agreeBtn } = makeProgressSandbox({
      // The row FAILS (stays selected) so the assertions below isolate the
      // run-state portion of agreeBtn's disabled expression — a row that
      // SUCCEEDS empties the selection, which would re-disable the button
      // for the unrelated, pre-existing "nothing selected" reason instead
      // and make this test pass for the wrong one.
      api: async () => new Promise((_resolve, reject) => { rejectFirst = reject; })
    });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingsSelected, rulingKey } = module.exports;
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1');

    renderRulings([suggestedRow()]);
    toggleRulingSelection(key, true);
    assert.equal(selectAll.disabled, false, 'before the confirmed press, nothing is running yet');
    assert.equal(agreeBtn.disabled, false);

    const runPromise = bulkAgreeSelected();
    await new Promise((r) => setImmediate(r));
    assert.equal(selectAll.disabled, true, 'select-all must be disabled while the batch is running');
    assert.equal(agreeBtn.disabled, true, 'the apply button must be disabled while the batch is running');

    rejectFirst(new Error('network blip'));
    await runPromise;

    assert.ok(rulingsSelected.has(key), 'sanity: the failed row must still be selected after the batch');
    assert.equal(selectAll.disabled, false, 'select-all must be re-enabled once the batch ends');
    assert.equal(agreeBtn.disabled, false, 'the apply button must be re-enabled once the batch ends');
  });

  test('completion summary: all rows applied', async () => {
    const { module, progressEl } = makeProgressSandbox({ api: async () => ({ success: true }) });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    const rows = ['d-ok1', 'd-ok2'].map((id) => suggestedRow({ decision: { decision_id: id } }));
    renderRulings(rows);
    rows.forEach((r) => toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, r.decision.decision_id), true));

    await bulkAgreeSelected();

    assert.equal(progressEl.textContent, '2 applied.');
  });

  // Review finding A (PR #1453, commit 91286e16): the all-succeeded branch
  // printed `${total} applied.` — total, not ok — and two paths advanced the
  // counter without ever producing a bucket, so a batch of 2 where only 1 was
  // genuinely applied printed "2 applied." on the wrong-output tree. Both
  // tests below pin `ok` against `total` directly, reproducing the review's
  // own throwaway-probe finding before the fix, and must go red on that tree.
  test('completion summary: a selected row that vanished before its turn tallies as skipped, not counted toward applied (review finding A)', async () => {
    const { module, progressEl } = makeProgressSandbox({ api: async () => ({ success: true }) });
    const {
      renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey,
      rulingsRowByKey, renderedRulingRows
    } = module.exports;

    const rows = ['d-ok1', 'd-vanish'].map((id) => suggestedRow({ decision: { decision_id: id } }));
    renderRulings(rows);
    const keys = rows.map((r) => rulingKey('the-ruling-workspace', ANCHOR, r.decision.decision_id));
    keys.forEach((k) => toggleRulingSelection(k, true));

    // The 5s poll deletes a vanished row's entries mid-batch while `keys` is
    // bulkAgreeSelected's own press-time snapshot — the key stays selected,
    // but nothing is left to act on for it.
    rulingsRowByKey.delete(keys[1]);
    renderedRulingRows.delete(keys[1]);

    await bulkAgreeSelected();

    assert.equal(
      progressEl.textContent,
      '1 applied · 1 skipped · 0 failed (still selected).',
      'only the row that actually ran may count toward "applied" — the wrong-output tree prints "2 applied." (total, not ok) here'
    );
  });

  test('completion summary: a row that fails bulkAgreeRow\'s own top guard (already pending) tallies as skipped, not applied (review finding A)', async () => {
    const { module, progressEl } = makeProgressSandbox({ api: async () => ({ success: true }) });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey, rulingsPending } = module.exports;

    const rows = ['d-ok2', 'd-pending'].map((id) => suggestedRow({ decision: { decision_id: id } }));
    renderRulings(rows);
    const keys = rows.map((r) => rulingKey('the-ruling-workspace', ANCHOR, r.decision.decision_id));
    keys.forEach((k) => toggleRulingSelection(k, true));

    // A human presses single-row Keep/Agree on the second row in another
    // tab, already mid-flight when this batch reaches its turn — that drops
    // row.suggestedDismissal or, as simulated here directly, leaves the key
    // in rulingsPending — either way bulkAgreeRow's own top guard returns
    // early, resolving `undefined` on the wrong-output tree instead of a
    // real bucket.
    rulingsPending.add(keys[1]);

    await bulkAgreeSelected();

    assert.equal(
      progressEl.textContent,
      '1 applied · 1 skipped · 0 failed (still selected).',
      'bulkAgreeRow\'s top guard must resolve a real bucket ("skipped"), not undefined — the wrong-output tree prints "2 applied." for this exact 2-row batch where only 1 was genuinely applied'
    );
  });

  test('completion summary: a mixed batch names applied · skipped · failed (still selected), each tallied by its own bulkAgreeRow outcome', async () => {
    const { module, progressEl } = makeProgressSandbox({
      api: async (url, opts) => {
        const { decisionId } = JSON.parse(opts.body);
        if (decisionId === 'd-fail') throw new Error('boom');
        return { success: true };
      }
    });
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    const applied = suggestedRow({ decision: { decision_id: 'd-ok' } });
    const failed = suggestedRow({ decision: { decision_id: 'd-fail' } });
    // 'answered' + canReply:false takes bulkAgreeRow's existing bulk-only
    // skip branch (:2832-2839-ish, "cannot answer") — pre-existing logic,
    // never counted before this ticket.
    const skipped = suggestedRow({
      decision: { decision_id: 'd-skip' },
      suggestedDismissal: { ...SUGGESTION, proposedOutcome: 'answered', optionId: 'a' },
      canReply: false
    });
    renderRulings([applied, failed, skipped]);
    [applied, failed, skipped].forEach((r) => toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, r.decision.decision_id), true));

    await bulkAgreeSelected();

    assert.equal(progressEl.textContent, '1 applied · 1 skipped · 1 failed (still selected).');
  });

  // Mutation check (the plan's own instruction): this is the ONE test in
  // this block a correct `finally` block is actually load-bearing for —
  // every other test here would still pass with no `finally` at all, since
  // nothing else here throws. Once beat 2 lands, comment out the `finally`
  // wrapper and confirm THIS test alone goes red before trusting it.
  test('a thrown row still tears down: the run flag resets, controls re-enable, a summary renders, and the error propagates (not swallowed)', async () => {
    const { sandbox, module, selectAll, agreeBtn, progressEl } = makeProgressSandbox({ api: async () => ({ success: true }) });
    // A test-only stub of a function bulkAgreeSelected's loop calls directly
    // — mirrors the existing `sandbox.pollRulings = () => {...}` /
    // `sandbox.refreshRulingsBadge = () => {...}` override idiom already
    // used above in this same file — simulating a genuine, unanticipated
    // regression inside the per-row core, which the plan's own Cleanup
    // section names as exactly the scenario a `finally` must survive.
    sandbox.bulkAgreeRow = () => { throw new Error('unexpected row failure'); };
    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;

    renderRulings([suggestedRow()]);
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1'), true);

    await assert.rejects(
      () => bulkAgreeSelected(),
      /unexpected row failure/,
      'the finally block must not swallow the error — it must still propagate after teardown runs'
    );

    assert.equal(selectAll.disabled, false, 'teardown must re-enable select-all even on a thrown row');
    assert.equal(agreeBtn.disabled, false, 'teardown must re-enable the apply button even on a thrown row');
    assert.notEqual(progressEl.textContent, '', 'a thrown row must not leave the progress node frozen mid-batch — the finally block must still repaint a terminal summary');
    // The plan states a throw renders the SAME "stopped early" shape a Stop
    // press does (its "Mixed outcomes" section) — asserted here as a SHAPE
    // match only. The plan does not fully pin what row-count a throw
    // in-flight (as opposed to Stop, checked only between completed rows)
    // should report; see this beat's report for that discrepancy.
    assert.match(
      progressEl.textContent,
      /^Stopped after \d+ of 1 — \d+ remain selected\.$/,
      'an unexpected throw must render the same stopped-early shape a Stop press does'
    );
  });

  test('the beforeunload guard is armed only while a batch is actually running', async () => {
    let resolveFirst;
    const { sandbox, module } = makeProgressSandbox({
      api: async () => new Promise((resolve) => { resolveFirst = resolve; })
    });
    const beforeunloadHandlers = sandbox.window._listeners.beforeunload || [];
    assert.ok(beforeunloadHandlers.length >= 1, 'observation.js must register its beforeunload listener at load time, as it already does today');
    const handler = beforeunloadHandlers[beforeunloadHandlers.length - 1];
    const makeEvent = () => {
      const event = { returnValue: undefined, prevented: false };
      event.preventDefault = () => { event.prevented = true; };
      return event;
    };

    const idleEvent = makeEvent();
    handler(idleEvent);
    assert.equal(idleEvent.prevented, false, 'idle (no batch running) must not arm the guard');

    const { renderRulings, toggleRulingSelection, bulkAgreeSelected, rulingKey } = module.exports;
    renderRulings([suggestedRow()]);
    toggleRulingSelection(rulingKey('the-ruling-workspace', ANCHOR, 'd-gone-1'), true);
    const runPromise = bulkAgreeSelected();
    await new Promise((r) => setImmediate(r));

    const runningEvent = makeEvent();
    handler(runningEvent);
    assert.equal(runningEvent.prevented, true, 'a batch in flight must arm the guard (preventDefault)');
    assert.equal(runningEvent.returnValue, '', 'a batch in flight must set event.returnValue for the legacy unload-confirmation path');

    resolveFirst({ success: true });
    await runPromise;

    const doneEvent = makeEvent();
    handler(doneEvent);
    assert.equal(doneEvent.prevented, false, 'the guard must disarm once the batch ends — teardown is what makes this free (same flag)');
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
      // LIN-2792 Step 7 adds `deliverRulingStampOnly` — the task-bound
      // Agree-as-answer wrapper — to this population, deliberately: it
      // follows the same guard-in-flight idiom every other verb here does,
      // and clears `rulingsSelected.delete(key)` on success exactly like
      // its siblings.
      ['agreeRulingRow', 'bulkAgreeRow', 'deliverRulingReply', 'deliverRulingStampOnly', 'dismissRulingRow', 'keepRulingRow', 'shelveRulingRow'].sort(),
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

  test('record_on matches a neighbour whose own state is terminal → the anchor, its OWN honest note (beat 3 correction)', () => {
    // NOT the not-found note — LIN-T WAS found in the neighbourhood, so
    // claiming "outside the checked neighbourhood" here would itself be a
    // false claim, which is exactly what this ticket exists to eliminate.
    const { resolveRecordTarget, RECORD_TARGET_OUTSIDE_NOTE, RECORD_TARGET_TERMINAL_NOTE } = sandboxExports();
    for (const type of ['completed', 'canceled', 'duplicate']) {
      const result = resolveRecordTarget(ANCHOR, 'LIN-T', {
        hydrated: true,
        neighborhood: { parent: null, siblings: [], children: [{ id: 'id-t', identifier: 'LIN-T', state: { type } }], cousins: [] }
      });
      assert.equal(result.issueId, ANCHOR.issueId, `terminal type ${type} must fall back to the anchor`);
      assert.equal(result.note, RECORD_TARGET_TERMINAL_NOTE, `terminal type ${type} must carry its own note, not the not-found one`);
      assert.notEqual(result.note, RECORD_TARGET_OUTSIDE_NOTE);
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

// ─── composeDispatchPrompt (LIN-2775 Area 7) — pure, no DOM/network ────────
describe('composeDispatchPrompt (LIN-2775 Area 7)', () => {
  function sandboxExports() {
    return makeSandbox({ postComment: async () => ({ ok: true, status: 201, data: {} }) }).module.exports;
  }

  test('carries the question, the chosen answer, and the full decisionCase recap', () => {
    const { composeDispatchPrompt } = sandboxExports();
    const row = { decision: { question: 'Ship or hold?' }, decisionCase: ['Tests are green.', 'The release window closes Friday.'] };
    const prompt = composeDispatchPrompt(row, 'Ship');
    assert.match(prompt, /Ship or hold\?/);
    assert.match(prompt, /Ship/);
    assert.match(prompt, /Tests are green\./);
    assert.match(prompt, /The release window closes Friday\./);
  });

  test('the FULL decisionCase is used, never the UI\'s DECISION_EXCERPT_CHARS-truncated preview', () => {
    const { composeDispatchPrompt, DECISION_EXCERPT_CHARS } = sandboxExports();
    const longChunk = 'x'.repeat(DECISION_EXCERPT_CHARS + 50);
    const row = { decision: { question: 'Q' }, decisionCase: [longChunk] };
    const prompt = composeDispatchPrompt(row, 'A');
    assert.match(prompt, new RegExp(longChunk), 'a real agent brief must not be truncated to the UI\'s screen-space budget');
  });

  test('no question and no decisionCase → still carries the chosen answer, never throws', () => {
    const { composeDispatchPrompt } = sandboxExports();
    const prompt = composeDispatchPrompt({}, 'Approve');
    assert.match(prompt, /Approve/);
  });

  test('free text (not a declared option label) is carried exactly as pressed', () => {
    const { composeDispatchPrompt } = sandboxExports();
    const row = { decision: { question: 'Why was I asked this?' }, decisionCase: [] };
    const prompt = composeDispatchPrompt(row, 'Because the migration touches this table too.');
    assert.match(prompt, /Because the migration touches this table too\./);
  });
});

// ─── LIN-2792 (LIN-2754 Track C) — UI convergence: the four-way Agree ──────
// branch, the optionId thread, and the banner/bulk-confirm wording. Every
// test below is a genuine witness against the pre-fix code, which had NO
// branch on `suggestedDismissal.proposedOutcome` at all — `agreeRulingRow`/
// `bulkAgreeRow` called `issueDismissRequest` (a DISMISS) unconditionally,
// so an Agree on a proposed ANSWER would have silently dismissed it instead.

const ANSWER_OPTIONS = [
  { id: 'opt-yes', label: 'Yes, proceed with the migration' },
  { id: 'opt-no', label: 'No, hold off' }
];

function answerSuggestion(overrides = {}) {
  return {
    proposedOutcome: 'answered',
    optionId: 'opt-yes',
    reason: 'John ruled yes in the relay',
    suggestedBy: 'runner-relay',
    suggestedAt: '2026-09-05T00:00:00.000Z',
    ...overrides
  };
}

function answeredRow(overrides = {}) {
  return makeRow({
    decision: { decision_id: 'd-answered-1', options: ANSWER_OPTIONS },
    suggestedDismissal: answerSuggestion(),
    canReply: true,
    ...overrides
  });
}

describe('resolveRulingOptionLabel / the answered-proposal banner (LIN-2792 Step 8)', () => {
  test('resolveRulingOptionLabel finds the matching option label', () => {
    const { resolveRulingOptionLabel } = makeSandbox().module.exports;
    const label = resolveRulingOptionLabel({ options: ANSWER_OPTIONS }, 'opt-no');
    assert.equal(label, 'No, hold off');
  });

  test('resolveRulingOptionLabel falls back to the bare id when no option matches', () => {
    const { resolveRulingOptionLabel } = makeSandbox().module.exports;
    assert.equal(resolveRulingOptionLabel({ options: ANSWER_OPTIONS }, 'opt-stale'), 'opt-stale');
    assert.equal(resolveRulingOptionLabel({}, 'opt-stale'), 'opt-stale');
  });

  test('the banner reads "proposed answer: <label>" for an answered proposal, never "proposed dismissal"', () => {
    const { module } = makeSandbox();
    const { renderRulingRow } = module.exports;
    const li = renderRulingRow(answeredRow());
    const label = li.querySelector('.obs-ruling-suggestion-label');
    assert.ok(label, 'expected a suggestion banner');
    assert.equal(label.textContent, 'proposed answer: Yes, proceed with the migration');
  });

  test('the banner still reads "proposed dismissal" for a dismissal proposal (unchanged)', () => {
    const { module } = makeSandbox();
    const { renderRulingRow } = module.exports;
    const li = renderRulingRow(makeRow({ suggestedDismissal: { reason: 'stale', suggestedBy: 'x', suggestedAt: '2026-09-05T00:00:00.000Z' } }));
    const label = li.querySelector('.obs-ruling-suggestion-label');
    assert.equal(label.textContent, 'proposed dismissal');
  });

  test('a legacy suggestion with no proposedOutcome at all still reads "proposed dismissal"', () => {
    const { module } = makeSandbox();
    const { renderRulingRow } = module.exports;
    // No `proposedOutcome` key — exactly a pre-LIN-2790 stored row.
    const li = renderRulingRow(makeRow({ suggestedDismissal: { reason: 'legacy', suggestedBy: 'x', suggestedAt: '2026-09-05T00:00:00.000Z' } }));
    assert.equal(li.querySelector('.obs-ruling-suggestion-label').textContent, 'proposed dismissal');
  });
});

// ─── Row control labels — positive pins (LIN-2757 review F1/F1b) ────────────
//
// The review found these three headline labels unwitnessed at every layer:
// inverting the row button's kind branch, or reverting "keep open" to "keep",
// both pass the full 10,720-test unit suite and every e2e assertion, because
// every existing test selects `.obs-ruling-agree`/`.obs-ruling-keep` by class
// and never reads their text. These assertions pin the actual rendered copy.
describe('row control labels are pinned by text, not just by class (LIN-2757 review F1/F1b)', () => {
  test('a dismissal-kind row renders "dismiss as proposed"', () => {
    const { module } = makeSandbox();
    const { renderRulingRow } = module.exports;
    const li = renderRulingRow(makeRow({ suggestedDismissal: { reason: 'x', suggestedBy: 'y', suggestedAt: '2026-09-05T00:00:00.000Z' } }));
    assert.equal(li.querySelector('.obs-ruling-agree').textContent, 'dismiss as proposed');
  });

  test('an answer-kind row renders "answer as proposed"', () => {
    const { module } = makeSandbox();
    const { renderRulingRow } = module.exports;
    const li = renderRulingRow(answeredRow());
    assert.equal(li.querySelector('.obs-ruling-agree').textContent, 'answer as proposed');
  });

  test('the keep control renders "keep open"', () => {
    const { module } = makeSandbox();
    const { renderRulingRow } = module.exports;
    const li = renderRulingRow(makeRow({ suggestedDismissal: { reason: 'x', suggestedBy: 'y', suggestedAt: '2026-09-05T00:00:00.000Z' } }));
    assert.equal(li.querySelector('.obs-ruling-keep').textContent, 'keep open');
  });
});

describe('agreeRulingRow — proposed answer, the four-way branch (LIN-2792 Step 7)', () => {
  test('BRANCH 1 — canReply: false refuses visibly, no write call reached, regardless of what effect reads', async () => {
    let apiCalls = 0;
    const { module } = makeSandbox({
      api: async () => { apiCalls += 1; return { success: true }; },
      postComment: async () => { apiCalls += 1; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async () => { apiCalls += 1; return { id: 'x' }; }
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    // Built exactly like tests/unit/dashboard-routes.test.js's own mid-turn
    // self-match fixture: disposition mid-turn, canReply false, but effect
    // STILL reads 'record' (branch 3's self-match) — proving the refusal
    // fires on canReply, never on effect.
    const row = answeredRow({ disposition: 'mid-turn', canReply: false, effect: 'record' });

    await agreeRulingRow(row, li);

    assert.equal(apiCalls, 0, 'no write of any kind may be attempted for a canReply:false row');
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /cannot answer/);
    assert.equal(feedback.classList.contains('obs-ruling-feedback--error'), true);
  });

  test('BRANCH 1 — the same refusal fires for indeterminate, both effect sub-cases (self-matching record, and null)', async () => {
    const { module } = makeSandbox({ api: async () => ({ success: true }) });
    const { agreeRulingRow } = module.exports;

    for (const effect of ['record', null]) {
      const li = makeLi();
      await agreeRulingRow(answeredRow({ disposition: 'indeterminate', canReply: false, effect }), li);
      const feedback = li.querySelector('.obs-ruling-feedback');
      assert.match(feedback.textContent, /cannot answer/, `effect=${effect}`);
    }
  });

  test('BRANCH 2 — task-bound stamps via the answered-without-comment route, with optionId, no comment posted', async () => {
    let captured = null;
    let commentCalls = 0;
    const { module } = makeSandbox({
      api: async (url, opts) => { captured = { url, opts }; return { success: true }; },
      postComment: async () => { commentCalls += 1; return { ok: true, status: 201, data: {} }; }
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    const row = answeredRow({
      disposition: 'task-bound',
      anchor: { loopId: null, taskDecisionId: 'td-answer-1' },
      effect: 'record'
    });

    await agreeRulingRow(row, li);

    assert.ok(captured, 'expected the stamp-only route to be called');
    assert.equal(captured.url, '/workspace/the-ruling-workspace/api/dashboard/rulings/answer');
    assert.deepEqual(JSON.parse(captured.opts.body), { taskDecisionId: 'td-answer-1', taskDecisionIssueId: 'issue-1', optionId: 'opt-yes' });
    assert.equal(commentCalls, 0, 'the ruling already lives on the ticket — Agree-as-answer posts no comment');
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.equal(feedback.textContent, 'answered as proposed');
  });

  test('BRANCH 3/4 — resumable Agree resumes the session and threads optionId onto the comment payload', async () => {
    let capturedOpts = null;
    let capturedPrompt = null;
    const { module } = makeSandbox({
      deliverReply: async (opts, prompt, handlers) => { capturedOpts = opts; capturedPrompt = prompt; handlers.onDispatchOk(); }
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    const row = answeredRow({ disposition: 'resumable', effect: 'resume' });

    await agreeRulingRow(row, li);

    assert.ok(capturedOpts, 'expected window.ReplyDelivery.deliverReply to be called');
    assert.equal(capturedOpts.optionId, 'opt-yes', 'optionId must reach the opts literal deliverReply forwards to postComment');
    assert.equal(capturedOpts.decisionLoopId, 'loop-gone-1');
    assert.equal(capturedPrompt, 'Yes, proceed with the migration', 'the proposed option\'s own label is the "pressed" text');
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.equal(feedback.textContent, 'recorded ✓');
  });

  test('BRANCH 3/4 — gone+record Agree delivers via deliverAsRecord and threads optionId onto the postComment call', async () => {
    let capturedDecision = null;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId, prompt, decision) => { capturedDecision = decision; return { ok: true, status: 201, data: {} }; }
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    const row = answeredRow({ disposition: 'gone', effect: 'record' });

    await agreeRulingRow(row, li);

    assert.ok(capturedDecision, 'expected postComment to be called');
    assert.equal(capturedDecision.optionId, 'opt-yes');
    assert.equal(capturedDecision.decisionLoopId, 'loop-gone-1');
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /recorded ✓/);
  });

  test('BRANCH 3/4 — gone+dispatch (default) Agree posts a comment carrying optionId, then dispatches a composed run', async () => {
    let capturedDecision = null;
    let capturedDispatch = null;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId, prompt, decision) => { capturedDecision = decision; return { ok: true, status: 201, data: {} }; },
      dispatchPrompt: async (opts) => { capturedDispatch = opts; return { id: 'dispatched-answer-1' }; },
      api: nonTerminalHydrateApi()
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    const row = answeredRow({ disposition: 'gone', effect: 'dispatch' });

    await agreeRulingRow(row, li);

    assert.ok(capturedDecision, 'expected the comment to be posted');
    assert.equal(capturedDecision.optionId, 'opt-yes');
    assert.ok(capturedDispatch, 'expected a fresh run to be dispatched');
    assert.match(capturedDispatch.prompt, /Yes, proceed with the migration/, 'the composed brief carries the chosen option\'s label');
  });

  test('deliverRulingReply never rejects: a hard failure still resolves the promise agreeRulingRow returns', async () => {
    const { module } = makeSandbox({
      postComment: async () => { throw new Error('network down'); }
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    const row = answeredRow({ disposition: 'gone', effect: 'record' });

    await assert.doesNotReject(agreeRulingRow(row, li));
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /reply failed/);
  });
});

describe('bulkAgreeRow / bulkAgreeSelected — mixed dismiss/answer batch (LIN-2792 Step 7)', () => {
  function makeAnswerBulkSandbox({ api, postComment, dispatchPrompt, deliverReply, confirm } = {}) {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p'); empty.hidden = false;
    const bar = new FakeElement('div');
    const selectAll = new FakeElement('input');
    const countEl = new FakeElement('span');
    const agreeBtn = new FakeElement('button');
    const sandbox = makeSandbox({
      api, postComment, dispatchPrompt, deliverReply, confirm,
      elements: {
        'obs-rulings': list, 'obs-rulings-empty': empty, 'obs-ruling-bulk-bar': bar,
        'obs-ruling-select-all': selectAll, 'obs-ruling-selected-count': countEl,
        'obs-ruling-agree-selected': agreeBtn
      }
    });
    return { module: sandbox.module, list, bar, selectAll, countEl, agreeBtn };
  }

  test('a mixed selection (one dismissal, one answer) discharges each row per its own proposal, sequentially', async () => {
    const dismissCalls = [];
    const stampCalls = [];
    const { module, list } = makeAnswerBulkSandbox({
      api: async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (url.includes('/rulings/dismiss')) dismissCalls.push(body);
        if (url.includes('/rulings/answer')) stampCalls.push(body);
        return { success: true };
      }
    });
    const { renderRulings, setAllRulingsSelected, bulkAgreeSelected } = module.exports;

    const dismissRow = makeRow({
      decision: { decision_id: 'd-mix-dismiss' },
      anchor: { loopId: 'loop-mix-dismiss' },
      suggestedDismissal: { reason: 'stale', suggestedBy: 'x', suggestedAt: '2026-09-05T00:00:00.000Z' }
    });
    const answerRow = answeredRow({
      decision: { decision_id: 'd-mix-answer', options: ANSWER_OPTIONS },
      disposition: 'task-bound',
      anchor: { loopId: null, taskDecisionId: 'td-mix-answer' },
      effect: 'record'
    });

    renderRulings([dismissRow, answerRow]);
    setAllRulingsSelected(true);
    await bulkAgreeSelected();

    assert.equal(dismissCalls.length, 1, 'the dismissal row must be dismissed');
    assert.deepEqual(dismissCalls[0], { decisionLoopId: 'loop-mix-dismiss', decisionId: 'd-mix-dismiss' });
    assert.equal(stampCalls.length, 1, 'the answer row must be stamped answered, never dismissed');
    assert.deepEqual(stampCalls[0], { taskDecisionId: 'td-mix-answer', taskDecisionIssueId: 'issue-1', optionId: 'opt-yes' });

    // Both rows must end up settled (controls disabled, still reused) —
    // the bulk batch's own single poll/badge-refresh discipline, unchanged.
    const [liDismiss, liAnswer] = list.children;
    assert.equal(liDismiss.querySelector('.obs-ruling-agree')?.disabled, true);
    assert.equal(liAnswer.querySelector('.obs-ruling-agree')?.disabled, true);
  });

  test('a canReply:false row in the selection is skipped with a visible, named reason, and the batch completes', async () => {
    const stampCalls = [];
    const { module } = makeAnswerBulkSandbox({
      api: async (url, opts) => { stampCalls.push(JSON.parse(opts.body)); return { success: true }; }
    });
    const { renderRulings, setAllRulingsSelected, bulkAgreeSelected } = module.exports;

    const refusedRow = answeredRow({
      decision: { decision_id: 'd-refused', options: ANSWER_OPTIONS },
      disposition: 'mid-turn', canReply: false, effect: 'record'
    });
    const okRow = answeredRow({
      decision: { decision_id: 'd-ok', options: ANSWER_OPTIONS },
      disposition: 'task-bound',
      anchor: { loopId: null, taskDecisionId: 'td-ok' },
      effect: 'record'
    });

    renderRulings([refusedRow, okRow]);
    setAllRulingsSelected(true);
    await bulkAgreeSelected();

    assert.equal(stampCalls.length, 1, 'only the answerable row is actually stamped');
    assert.deepEqual(stampCalls[0], { taskDecisionId: 'td-ok', taskDecisionIssueId: 'issue-1', optionId: 'opt-yes' });

    const refusedLi = module.exports.renderedRulingRows.get(
      module.exports.rulingKey('the-ruling-workspace', ANCHOR, 'd-refused')
    );
    assert.match(refusedLi.querySelector('.obs-ruling-feedback').textContent, /skipped — cannot answer/);
  });

  test('a dispatch-effect answer row is skipped in bulk (never fired blind), but Agree alone (single-row) still allows it', async () => {
    let dispatchCalls = 0;
    const { module: bulkModule } = makeAnswerBulkSandbox({
      api: async () => ({ success: true }),
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'x' }; }
    });
    const { renderRulings, setAllRulingsSelected, bulkAgreeSelected } = bulkModule.exports;

    const dispatchRow = answeredRow({ disposition: 'gone', effect: 'dispatch' });
    renderRulings([dispatchRow]);
    setAllRulingsSelected(true);
    await bulkAgreeSelected();

    assert.equal(dispatchCalls, 0, 'bulk must never fire a fresh dispatch blind across N rows');
    const li = bulkModule.exports.renderedRulingRows.get(bulkModule.exports.rulingKey('the-ruling-workspace', ANCHOR, 'd-answered-1'));
    assert.match(li.querySelector('.obs-ruling-feedback').textContent, /skipped — starting a fresh run/);

    // Single-row Agree on the SAME kind of row is unrestricted (branch 4).
    const { module: singleModule } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'x' }; },
      api: nonTerminalHydrateApi()
    });
    const { agreeRulingRow } = singleModule.exports;
    await agreeRulingRow(answeredRow({ disposition: 'gone', effect: 'dispatch' }), makeLi());
    assert.equal(dispatchCalls, 1, 'single-row Agree must still allow a dispatch-effect answer');
  });
});

describe('computeBulkAgreeBreakdown / bulkAgreeConfirmText (LIN-2792 Step 7)', () => {
  test('breakdown counts dismiss/answer/refused/dispatchSkipped independently', () => {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p'); empty.hidden = false;
    const { module } = makeSandbox({ elements: { 'obs-rulings': list, 'obs-rulings-empty': empty } });
    const { renderRulings, setAllRulingsSelected, computeBulkAgreeBreakdown } = module.exports;

    const dismissRow = makeRow({
      decision: { decision_id: 'd-breakdown-dismiss' },
      suggestedDismissal: { reason: 'x', suggestedBy: 'y', suggestedAt: '2026-09-05T00:00:00.000Z' }
    });
    const answerRow = answeredRow({ decision: { decision_id: 'd-breakdown-answer', options: ANSWER_OPTIONS }, disposition: 'task-bound', anchor: { loopId: null, taskDecisionId: 'td-b' }, effect: 'record' });
    const refusedRow = answeredRow({ decision: { decision_id: 'd-breakdown-refused', options: ANSWER_OPTIONS }, disposition: 'mid-turn', canReply: false, effect: 'record' });
    const dispatchRow = answeredRow({ decision: { decision_id: 'd-breakdown-dispatch', options: ANSWER_OPTIONS }, disposition: 'gone', effect: 'dispatch' });

    renderRulings([dismissRow, answerRow, refusedRow, dispatchRow]);
    setAllRulingsSelected(true);

    // Compared field-by-field, not via a whole-object deepEqual: the
    // breakdown object is constructed inside the vm sandbox, a different
    // realm than this literal, so a cross-realm deepStrictEqual would fail
    // on prototype identity alone despite matching structurally.
    const breakdown = computeBulkAgreeBreakdown();
    assert.equal(breakdown.dismiss, 1);
    assert.equal(breakdown.answer, 1);
    assert.equal(breakdown.refused, 1);
    assert.equal(breakdown.dispatchSkipped, 1);
  });

  test('bulkAgreeConfirmText names both dismiss and answer counts, and both skip categories, when present', () => {
    const { bulkAgreeConfirmText } = makeSandbox().module.exports;
    const text = bulkAgreeConfirmText({ dismiss: 2, answer: 1, refused: 1, dispatchSkipped: 1 });
    assert.match(text, /Apply 5 selected proposals/);
    assert.match(text, /2 dismissals/);
    assert.match(text, /1 answer\b/);
    assert.match(text, /1 cannot be answered yet and will be skipped/);
    assert.match(text, /1 would start a fresh run and will be skipped in bulk/);
  });

  test('bulkAgreeConfirmText with only dismissals reads singular/plural correctly and carries no skip parenthetical', () => {
    const { bulkAgreeConfirmText } = makeSandbox().module.exports;
    const text = bulkAgreeConfirmText({ dismiss: 1, answer: 0, refused: 0, dispatchSkipped: 0 });
    assert.match(text, /Apply 1 selected proposal \(1 dismissal\)/);
    assert.doesNotMatch(text, /skipped/);
  });
});

// ─── LIN-2754 close-out, ledger L1 (review finding F1) ────────────────────
// Plan Step 11 witness 4, delivered as specified this time. The witness that
// shipped with LIN-2792 used a TASK-BOUND answer row, which routes through
// `deliverRulingStampOnly` — so no test anywhere drove `deliverRulingReply`
// with `{bulkAgree: true}`, leaving both of its bulk arms unexercised:
//
//   * `onDelivered`'s bulk arm — settle WITHOUT `restore()` (controls stay
//     disabled), no per-row `pollRulings()`/badge refresh, and
//   * `makePartialFailureHandler`'s bulk arm — the one that prevents a
//     DOUBLE-POST: a bulk partial failure must settle and offer a scoped
//     retry, never fall back to bulk's ordinary "restore and stay selected"
//     discipline, which would re-post the already-succeeded comment on the
//     next Agree press.
//
// Both rows below are answer proposals on dispositions that actually reach
// `deliverRulingReply` in bulk (`gone`+`record` and `resumable`); a
// `gone`+`dispatch` row is skipped by bulk by design, so it cannot serve.
describe('bulkAgreeSelected — answer rows through deliverRulingReply (LIN-2754 L1 / review F1)', () => {
  function makeBulkReplySandbox({ api, postComment, dispatchPrompt, deliverReply, confirm } = {}) {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p'); empty.hidden = false;
    const progressEl = new FakeElement('p');
    const sandbox = makeSandbox({
      api, postComment, dispatchPrompt, deliverReply, confirm,
      elements: {
        'obs-rulings': list, 'obs-rulings-empty': empty,
        'obs-ruling-bulk-bar': new FakeElement('div'),
        'obs-ruling-select-all': new FakeElement('input'),
        'obs-ruling-selected-count': new FakeElement('span'),
        'obs-ruling-agree-selected': new FakeElement('button'),
        'obs-ruling-bulk-progress': progressEl
      }
    });
    return { module: sandbox.module, list, progressEl };
  }

  // A `gone` row at `effect: 'record'` — branch 3/4's record delivery, which
  // posts a comment and stops (no dispatch), so the whole batch is
  // observable through `postComment` alone.
  function goneRecordAnswerRow(decisionId, loopId) {
    return answeredRow({
      decision: { decision_id: decisionId, options: ANSWER_OPTIONS },
      anchor: { loopId },
      disposition: 'gone',
      effect: 'record'
    });
  }

  test('two gone+record answer rows settle SEQUENTIALLY — row 2 never starts before row 1 has finished', async () => {
    const events = [];
    const { module } = makeBulkReplySandbox({
      postComment: async (urlKey, targetId, prompt, opts) => {
        events.push(`start:${opts.decisionId}`);
        // Yield several times so an interleaved second row would have every
        // opportunity to start before this one resolves — the assertion
        // below is a genuine witness against a concurrent (Promise.all)
        // implementation, not an artefact of a single microtask hop.
        for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
        events.push(`end:${opts.decisionId}`);
        return { ok: true, status: 201, data: {} };
      }
    });
    const { renderRulings, setAllRulingsSelected, bulkAgreeSelected, rulingKey, rulingsSelected, rulingsSettled } = module.exports;

    const rowA = goneRecordAnswerRow('d-seq-a', 'loop-seq-a');
    const rowB = goneRecordAnswerRow('d-seq-b', 'loop-seq-b');
    renderRulings([rowA, rowB]);
    setAllRulingsSelected(true);

    await bulkAgreeSelected();

    assert.deepEqual(
      events,
      ['start:d-seq-a', 'end:d-seq-a', 'start:d-seq-b', 'end:d-seq-b'],
      'each answer row must run and settle before the next one starts — interleaved starts mean the batch went concurrent'
    );

    // `onDelivered`'s BULK arm, the half no prior test reached: settled, not
    // restored. Controls stay disabled, the checkbox is cleared, the key
    // leaves the selection and enters rulingsSettled.
    for (const [decisionId, loopId] of [['d-seq-a', 'loop-seq-a'], ['d-seq-b', 'loop-seq-b']]) {
      const key = rulingKey('the-ruling-workspace', { ...ANCHOR, loopId }, decisionId);
      const li = module.exports.renderedRulingRows.get(key);
      assert.ok(li, `expected a rendered row for ${decisionId}`);
      assert.equal(li.querySelector('.obs-ruling-feedback').textContent, 'recorded ✓', `${decisionId} must read as delivered`);
      assert.equal(li.querySelector('.obs-ruling-agree')?.disabled, true, `${decisionId}'s controls must NOT be re-enabled by the bulk arm (no restore())`);
      assert.equal(li.querySelector('.obs-ruling-select')?.checked, false, `${decisionId}'s checkbox must be cleared`);
      assert.equal(rulingsSelected.has(key), false, `${decisionId} must leave the selection at the moment of success`);
      assert.ok(rulingsSettled.has(key), `${decisionId} must be marked settled so the stale-cache repaint reuses this exact <li>`);
    }
  });

  test('a bulk partial failure SETTLES the row and offers a scoped retry — the comment is never re-posted, by retry or by a second batch', async () => {
    let commentCalls = 0;
    let runCalls = 0;
    let failRun = true;
    const { module } = makeBulkReplySandbox({
      // The `resumable` branch delegates to window.ReplyDelivery.deliverReply,
      // whose real contract is: post the comment, then start the run, and on
      // a comment-succeeded/run-failed split call onPartialFailure(err,
      // retryRun) with a retry that re-fires ONLY the run. Modelled here
      // exactly, so the bulk arm under test sees the real handler shape.
      deliverReply: async (opts, prompt, handlers) => {
        commentCalls += 1;
        runCalls += 1;
        if (failRun) {
          handlers.onPartialFailure(new Error('session gone'), async () => {
            runCalls += 1;
            if (failRun) throw new Error('still gone');
          });
        } else {
          handlers.onDispatchOk();
        }
      }
    });
    const {
      renderRulings, setAllRulingsSelected, bulkAgreeSelected,
      rulingKey, rulingsSelected, rulingsSettled, rulingsPending, preservedRulingRows
    } = module.exports;

    const row = answeredRow({
      decision: { decision_id: 'd-partial', options: ANSWER_OPTIONS },
      disposition: 'resumable'
    });
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-partial');

    renderRulings([row]);
    setAllRulingsSelected(true);
    await bulkAgreeSelected();

    assert.equal(commentCalls, 1, 'the comment (the durable half) is posted exactly once');

    // The double-post guard: the durable half already succeeded, so the row
    // is DONE from the batch's point of view — settled, deselected, pending
    // released, controls NOT re-enabled. Bulk's ordinary failure discipline
    // (restore + stay selected) would leave this row eligible for a second
    // Agree press and re-post the comment.
    assert.ok(rulingsSettled.has(key), 'a bulk partial failure must mark the row settled — its answer is already durable');
    assert.equal(rulingsSelected.has(key), false, 'the row must leave the selection');
    assert.equal(rulingsPending.has(key), false, 'the pending guard must be released');
    assert.ok(preservedRulingRows.has(key), 'the row must be preserved across the next poll(s) while the retry is outstanding');

    const li = module.exports.renderedRulingRows.get(key);
    assert.equal(li.querySelector('.obs-ruling-agree')?.disabled, true, 'controls must stay disabled — the bulk arm never calls restore()');
    const feedback = li.querySelector('.obs-ruling-feedback');
    assert.match(feedback.textContent, /Recorded\. Could not resume the session/, 'must say the answer was RECORDED — only the run failed');

    const retryBtn = feedback.children.find((c) => c.classList.contains('obs-ruling-retry-delivery'));
    assert.ok(retryBtn, 'expected a scoped Retry delivery affordance');

    // A second Agree press over the same (now empty) selection must not
    // touch this row at all — and even if it were still selected,
    // bulkAgreeRow's own rulingsSettled guard refuses it.
    setAllRulingsSelected(true);
    await bulkAgreeSelected();
    assert.equal(commentCalls, 1, 'a second batch must NEVER re-post the already-succeeded comment');

    // The retry re-fires only the run, never the comment.
    failRun = false;
    const runsBeforeRetry = runCalls;
    retryBtn.click();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(commentCalls, 1, 'the retry must re-fire the run only — never the comment');
    assert.equal(runCalls, runsBeforeRetry + 1, 'the retry must re-fire the run exactly once');
    assert.equal(preservedRulingRows.has(key), false, 'a succeeded retry releases the preserved row');
    assert.match(feedback.textContent, /recorded ✓/);
  });

  // LIN-2758 beat 2's own documented deviation, pinned (beat 3): the plan's
  // Mixed-outcomes section names exactly three buckets — applied / skipped /
  // failed (still selected) — and says a 'failed' row stays selected. This
  // bulk-mode partial failure does NOT stay selected: makePartialFailureHandler
  // (above) deletes it from rulingsSelected unconditionally and, in bulk
  // mode, also marks it rulingsSettled — the SAME end state a success
  // leaves, with its own independent "Retry delivery" affordance for the
  // un-started run, never a further bulk press. beat 2 tallied this
  // sub-case as 'applied' (off the same rulingsSettled membership check
  // every other branch uses) rather than 'failed', since 'still selected'
  // would be a false claim about this row. Nothing before this test
  // asserted on the SUMMARY text for this exact scenario — the sibling test
  // above only checks the row's own state, not the batch-level tally — so a
  // future change could flip this silently. Both halves in one place:
  test('a bulk-mode partial failure (comment/answer durably recorded, fresh run failed to start) tallies as APPLIED, never "still selected" (LIN-2758 beat 2 deviation, pinned)', async () => {
    const { module, progressEl } = makeBulkReplySandbox({
      deliverReply: async (opts, prompt, handlers) => {
        handlers.onPartialFailure(new Error('session gone'), async () => {});
      }
    });
    const { renderRulings, setAllRulingsSelected, bulkAgreeSelected, rulingsSelected, rulingsSettled, rulingKey } = module.exports;

    const row = answeredRow({
      decision: { decision_id: 'd-partial-tally', options: ANSWER_OPTIONS },
      disposition: 'resumable'
    });
    const key = rulingKey('the-ruling-workspace', ANCHOR, 'd-partial-tally');

    renderRulings([row]);
    setAllRulingsSelected(true);
    await bulkAgreeSelected();

    // Half 1 — the premise: settled and deselected, not "still selected".
    assert.ok(rulingsSettled.has(key), 'a durably-recorded partial failure must settle the row');
    assert.equal(rulingsSelected.has(key), false, 'a durably-recorded partial failure must deselect the row — the plan\'s "still selected" claim does not hold here');

    // Half 2 — the deviation itself: the completion summary must count this
    // row as applied, not failed, matching its real settled+deselected
    // state. A regression here would render '0 applied · 0 skipped · 1
    // failed (still selected).' instead — a doubly false claim, since the
    // row is neither still selected nor unrecorded.
    assert.equal(progressEl.textContent, '1 applied.', 'a bulk partial failure must tally as applied, matching beat 2\'s documented call');
  });
});

// ─── LIN-2754 close-out, ledger L7 — witness 13's second half ─────────────
// The `gone`+`record` Agree witness LIN-2792 landed covers the RESOLVABLE
// happy path only (no `record_on` declared → the anchor). The `record_on`
// FALLBACK paths — an unresolvable target, and an in-neighbourhood but
// TERMINAL one — were covered only by inheritance from the pre-existing
// `resolveRecordTarget` tests, which predate `optionId` and never observe
// it. `deliverAsRecord`'s `postComment` literal is one of the four call
// sites that silently dropped `optionId` before this ticket, so "the
// fallback branch also carries the chosen option" is exactly the kind of
// claim that must be asserted rather than inherited.
describe('Agree-as-answer on a gone+record row — optionId survives the record_on FALLBACK too (LIN-2754 L7)', () => {
  const fallbackCases = [
    {
      name: 'an UNRESOLVABLE record_on (matches nothing in the neighbourhood)',
      recordOn: 'LIN-NOWHERE',
      hydrate: async () => hydrateOk(neighborhoodOf({ siblings: [neighbor('LIN-9001')] })),
      notePattern: /outside the checked neighbourhood/
    },
    {
      name: 'a TERMINAL in-neighbourhood record_on',
      recordOn: 'LIN-DONE',
      hydrate: async () => hydrateOk(neighborhoodOf({ siblings: [neighbor('LIN-DONE', 'completed')] })),
      notePattern: /closed|completed|terminal/i
    },
    {
      name: 'a FAILED hydrate (the route is unavailable)',
      recordOn: 'LIN-ELSEWHERE',
      hydrate: async () => { throw new Error('hydrate unavailable'); },
      notePattern: /outside the checked neighbourhood/
    }
  ];

  for (const { name, recordOn, hydrate, notePattern } of fallbackCases) {
    test(`${name} still records to the anchor WITH the chosen optionId, and says why`, async () => {
      let captured = null;
      let dispatchCalls = 0;
      const { module } = makeSandbox({
        postComment: async (urlKey, issueId, prompt, decision) => { captured = { urlKey, issueId, prompt, decision }; return { ok: true, status: 201, data: {} }; },
        dispatchPrompt: async () => { dispatchCalls += 1; return { id: 'x' }; },
        api: hydrate
      });
      const { agreeRulingRow } = module.exports;
      const li = makeLi();
      const row = answeredRow({
        decision: { decision_id: 'd-l7', options: ANSWER_OPTIONS, on_answer: { effect: 'record', record_on: recordOn } },
        disposition: 'gone',
        effect: 'record'
      });

      await agreeRulingRow(row, li);

      assert.ok(captured, 'expected the record comment to be posted');
      assert.equal(captured.decision.optionId, 'opt-yes', 'the chosen option must ride the fallback postComment too — this literal is one of the four that dropped it before LIN-2792');
      assert.equal(captured.decision.decisionId, 'd-l7');
      assert.equal(captured.issueId, ANCHOR.issueId, 'an unresolved record_on falls back to the ANCHOR, never the named target');
      assert.equal(captured.prompt, 'Yes, proceed with the migration', 'the comment body is the option LABEL, not the raw id');
      assert.equal(dispatchCalls, 0, 'a record-effect answer never starts a run');

      const feedback = li.querySelector('.obs-ruling-feedback');
      assert.match(feedback.textContent, /recorded ✓/);
      assert.match(feedback.textContent, notePattern, 'the fallback must say why it did not use the declared record_on');
    });
  }

  test('a RESOLVABLE record_on records to the resolved neighbour, also carrying the optionId', async () => {
    let captured = null;
    const { module } = makeSandbox({
      postComment: async (urlKey, issueId, prompt, decision) => { captured = { issueId, decision }; return { ok: true, status: 201, data: {} }; },
      api: async () => hydrateOk(neighborhoodOf({ children: [neighbor('LIN-CHILD-7')] }))
    });
    const { agreeRulingRow } = module.exports;
    const li = makeLi();
    const row = answeredRow({
      decision: { decision_id: 'd-l7-ok', options: ANSWER_OPTIONS, on_answer: { effect: 'record', record_on: 'LIN-CHILD-7' } },
      disposition: 'gone',
      effect: 'record'
    });

    await agreeRulingRow(row, li);

    assert.equal(captured.issueId, 'id-LIN-CHILD-7', 'the resolved neighbour is the write target');
    assert.equal(captured.decision.optionId, 'opt-yes');
  });
});

// LIN-2757 — the absence witness for acceptance criterion 1 ("no control on
// the Rulings tab uses 'agree' without naming the outcome it agrees to").
// Every other test in this file (and in render-observation.test.js) only
// pins what a specific string SHOULD say; nothing before this asserted the
// ABSENCE of a bare "agree" across a rendered row's own controls. CSS/JS
// class names (e.g. `.obs-ruling-agree`) are wire/structural, not display
// text — deliberately excluded, only textContent and aria-label are checked.
describe('no rendered .obs-ruling-* control reads a bare "agree" (LIN-2757 acceptance criterion 1)', () => {
  function makeRenderSandbox() {
    const list = new FakeElement('ul');
    const empty = new FakeElement('p');
    empty.hidden = false;
    const { module } = makeSandbox({
      postComment: async () => ({ ok: true, status: 201, data: {} }),
      dispatchPrompt: async () => ({ id: 'd' }),
      api: async () => ({ success: true }),
      elements: { 'obs-rulings': list, 'obs-rulings-empty': empty }
    });
    return { module, list, empty };
  }

  function collectRulingControls(li) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        const classes = String(child.className || '').split(/\s+/);
        if (classes.some((c) => c.startsWith('obs-ruling-'))) {
          found.push({
            className: child.className,
            text: child.textContent,
            ariaLabel: typeof child.getAttribute === 'function' ? child.getAttribute('aria-label') : null
          });
        }
        walk(child);
      }
    };
    walk(li);
    return found;
  }

  function assertNoBareAgree(controls) {
    assert.ok(controls.length > 0, 'expected at least one .obs-ruling-* control to check');
    for (const { className, text, ariaLabel } of controls) {
      assert.doesNotMatch(text || '', /\bagree\b/i, `${className}'s textContent ("${text}") must not read a bare "agree"`);
      if (ariaLabel) {
        assert.doesNotMatch(ariaLabel, /\bagree\b/i, `${className}'s aria-label ("${ariaLabel}") must not read a bare "agree"`);
      }
    }
  }

  test('a proposed-DISMISSAL row: no control text or aria-label reads a bare "agree"', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings } = module.exports;
    renderRulings([makeRow({ suggestedDismissal: { reason: 'x', suggestedBy: 'y', suggestedAt: '2026-09-05T00:00:00.000Z' } })]);
    assertNoBareAgree(collectRulingControls(list.children[0]));
  });

  test('a proposed-ANSWER (task-bound) row: no control text or aria-label reads a bare "agree"', () => {
    const { module, list } = makeRenderSandbox();
    const { renderRulings } = module.exports;
    renderRulings([answeredRow({
      disposition: 'task-bound',
      anchor: { loopId: null, taskDecisionId: 'td-invariant' },
      effect: 'record'
    })]);
    assertNoBareAgree(collectRulingControls(list.children[0]));
  });
});
