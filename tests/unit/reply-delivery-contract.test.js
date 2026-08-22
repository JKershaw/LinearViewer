/**
 * LIN-2200 — contract tests for `window.ReplyDelivery` (public/common.js).
 *
 * `public/session.js` had zero unit coverage before this extraction — the
 * durable-write-before-dispatch ordering, the retry-dispatch-only guard, and
 * the outgoing payload shape were verified exclusively through Playwright
 * (tests/e2e/session-page.spec.js). This file gives the extracted seam a unit
 * seam of its own: vm-sandboxes the REAL public/common.js with a stubbed
 * `fetch` and no DOM, following the in-tree precedent
 * tests/unit/brief-recap-ai-not-configured-contract.test.js:125-152. Each
 * test asserts a fact about the calls actually made (count, endpoint, body),
 * not an inference from final state — a test that only checks the end state
 * would still pass if, say, the comment were silently reposted alongside a
 * successful retry.
 *
 * Invariants protected (see the research/plan history on LIN-2200):
 *   I1  comment-first, dispatch-second — retry-safety is asymmetric (the
 *       comment is deduped server-side; a follow-up dispatch is not)
 *   I3  comment failure aborts dispatch entirely
 *   I4  retry re-fires dispatch ONLY, never the comment
 *   I6  payload minimalism — {prompt,followUpTo,target[,force]}, no issue
 *       fields, no attachProxy (a client-side regression here would keep
 *       every existing server-side/e2e test green — LIN-1292/LIN-1431 key
 *       server behaviour on this exact shape)
 *   I10 issueless runs degrade to dispatch-only, byte-for-byte
 *   I11 the internal {ok,status,data} fetch layer never rejects on a non-2xx
 *
 * Run with: node --test tests/unit/reply-delivery-contract.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_JS_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

/**
 * A fresh vm sandbox holding the real public/common.js, with `fetch` stubbed
 * to `fetchImpl` and every call recorded. `document` here is only the bare
 * stub common.js's own top-level auto-init needs to register its
 * DOMContentLoaded listener at load time (never fired in this harness) — it
 * is NOT exercised by window.ReplyDelivery itself. The Observation page loads
 * common.js without chat.js (lib/render-observation.js
 * `scripts: ['/common.js', '/observation.js']`), so the helper block under
 * test must never reach for `document.*`/`window.ChatUI` — asserted directly
 * below by inspecting the helper's own source slice, not by omitting document
 * from the sandbox (common.js wouldn't even load without it).
 */
function makeSandbox(fetchImpl) {
  const calls = [];
  const sandbox = {
    window: { location: { origin: 'http://test.local' } },
    document: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    console,
    fetch(url, opts) {
      calls.push({ url, opts });
      return fetchImpl(url, opts);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS_SRC, sandbox, { filename: 'common.js' });
  return { window: sandbox.window, calls };
}

function jsonResponse(ok, status, data) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(data) });
}

function trackedHandlers() {
  const fired = { onCommentFailed: [], onDispatchFailed: [], onPartialFailure: [], onDispatchOk: [] };
  return {
    fired,
    handlers: {
      onCommentFailed: (e) => fired.onCommentFailed.push(e),
      onDispatchFailed: (e) => fired.onDispatchFailed.push(e),
      onPartialFailure: (e, retry) => fired.onPartialFailure.push({ e, retry }),
      onDispatchOk: () => fired.onDispatchOk.push(true),
    },
  };
}

test('window.ReplyDelivery loads with the documented surface', () => {
  const { window } = makeSandbox(() => { throw new Error('fetch should not be called'); });
  assert.equal(typeof window.ReplyDelivery, 'object', 'window.ReplyDelivery is exported');
  assert.equal(typeof window.ReplyDelivery.deliverReply, 'function');
  assert.equal(typeof window.ReplyDelivery.postComment, 'function');
  assert.equal(typeof window.ReplyDelivery.errorFromResult, 'function');
  assert.equal(window.ReplyDelivery.postDispatch, undefined,
    'postDispatch stays private — reachable only via deliverReply/retryDispatch (I4\'s guard against a caller-side reimplementation)');
});

test('comment failure blocks dispatch entirely (I1/I3): dispatch endpoint never called, only onCommentFailed fires', async () => {
  const { window, calls } = makeSandbox((url) => {
    if (String(url).includes('/api/comments/')) return jsonResponse(false, 502, { error: 'comment down' });
    throw new Error('the dispatch endpoint must never be reached when the comment write fails');
  });
  const { fired, handlers } = trackedHandlers();

  await window.ReplyDelivery.deliverReply(
    { urlKey: 'w', issueId: 'i1', followUpTo: 'lp', target: 'cli' },
    'hello',
    handlers
  );

  assert.equal(calls.length, 1, 'exactly one fetch was made (the comment write)');
  assert.match(calls[0].url, /\/api\/comments\/i1$/);
  assert.equal(fired.onCommentFailed.length, 1);
  assert.equal(fired.onCommentFailed[0].message, 'comment down');
  assert.equal(fired.onDispatchOk.length, 0);
  assert.equal(fired.onPartialFailure.length, 0);
  assert.equal(fired.onDispatchFailed.length, 0);
});

test('partial failure (I1/I4): onPartialFailure(err, retryDispatch) fires exactly once, and retryDispatch() issues exactly one more fetch to the dispatch endpoint only — the comment is never resent', async () => {
  let dispatchCallCount = 0;
  const { window, calls } = makeSandbox((url) => {
    if (String(url).includes('/api/comments/')) return jsonResponse(true, 201, { success: true });
    dispatchCallCount++;
    if (dispatchCallCount === 1) return jsonResponse(false, 503, { error: 'busy' });
    return jsonResponse(true, 200, { success: true });
  });
  const { fired, handlers } = trackedHandlers();

  await window.ReplyDelivery.deliverReply(
    { urlKey: 'w', issueId: 'i1', followUpTo: 'lp', target: 'cli' },
    'hello',
    handlers
  );

  assert.equal(fired.onPartialFailure.length, 1, 'onPartialFailure fires exactly once');
  assert.equal(fired.onPartialFailure[0].e.message, 'busy');
  assert.equal(typeof fired.onPartialFailure[0].retry, 'function', 'a retryDispatch handle was handed back');
  assert.equal(fired.onCommentFailed.length, 0);
  assert.equal(fired.onDispatchOk.length, 0);
  assert.equal(calls.length, 2, 'comment write + first dispatch attempt only, so far');

  await fired.onPartialFailure[0].retry();

  assert.equal(calls.length, 3, 'retryDispatch() issued exactly ONE more fetch');
  assert.match(calls[2].url, /\/api\/dispatch$/, 'the retry hit the dispatch endpoint');
  assert.equal(
    calls.filter(c => String(c.url).includes('/api/comments/')).length, 1,
    'the comment endpoint was called exactly once across the whole flow — retry never reposts it (I4)'
  );
});

test('retryDispatch() resolves on a successful retry and rejects with an Error on a repeated failure', async () => {
  const { window: winOk } = makeSandbox((url) => {
    if (String(url).includes('/api/comments/')) return jsonResponse(true, 201, {});
    return jsonResponse(true, 200, {});
  });
  const okHandlers = trackedHandlers();
  await winOk.ReplyDelivery.deliverReply({ urlKey: 'w', issueId: 'i1', target: 'cli' }, 'hi', okHandlers.handlers);
  assert.equal(okHandlers.fired.onDispatchOk.length, 1, 'sanity: this fixture reaches onDispatchOk, not onPartialFailure');

  const { window: winFail } = makeSandbox((url) => {
    if (String(url).includes('/api/comments/')) return jsonResponse(true, 201, {});
    return jsonResponse(false, 500, { error: 'still down' });
  });
  const failHandlers = trackedHandlers();
  await winFail.ReplyDelivery.deliverReply({ urlKey: 'w', issueId: 'i1', target: 'cli' }, 'hi', failHandlers.handlers);
  assert.equal(failHandlers.fired.onPartialFailure.length, 1);

  let rejected = null;
  try {
    await failHandlers.fired.onPartialFailure[0].retry();
    assert.fail('retryDispatch() should have rejected on a repeated failure');
  } catch (e) {
    rejected = e;
  }
  // The sandbox has its own Error realm, so `instanceof Error` is unreliable
  // cross-realm — assert on shape (message) rather than prototype identity.
  assert.equal(typeof rejected.message, 'string');
  assert.equal(rejected.message, 'still down');
});

test('issueless path (I10): the comment endpoint is never called; dispatch is called once; a failure fires onDispatchFailed, not onCommentFailed/onPartialFailure', async () => {
  const { window, calls } = makeSandbox((url) => {
    if (String(url).includes('/api/comments/')) throw new Error('an issueless run must never write a comment');
    return jsonResponse(false, 503, { error: 'nope' });
  });
  const { fired, handlers } = trackedHandlers();

  await window.ReplyDelivery.deliverReply(
    { urlKey: 'w', issueless: true, followUpTo: 'lp', target: 'cli' },
    'hello',
    handlers
  );

  assert.equal(calls.length, 1, 'exactly one fetch — the dispatch call');
  assert.match(calls[0].url, /\/api\/dispatch$/);
  assert.equal(fired.onDispatchFailed.length, 1);
  assert.equal(fired.onDispatchFailed[0].message, 'nope');
  assert.equal(fired.onCommentFailed.length, 0);
  assert.equal(fired.onPartialFailure.length, 0);
  assert.equal(fired.onDispatchOk.length, 0);
});

test('issueless path (I10): success reaches onDispatchOk with no comment attempt', async () => {
  const { window, calls } = makeSandbox((url) => {
    if (String(url).includes('/api/comments/')) throw new Error('an issueless run must never write a comment');
    return jsonResponse(true, 200, { success: true });
  });
  const { fired, handlers } = trackedHandlers();

  await window.ReplyDelivery.deliverReply(
    { urlKey: 'w', issueless: true, target: 'web' },
    'hello',
    handlers
  );

  assert.equal(calls.length, 1);
  assert.equal(fired.onDispatchOk.length, 1);
  assert.equal(fired.onDispatchFailed.length, 0);
});

test('outgoing dispatch payload (I6) is exactly {prompt,followUpTo,target} — no force key when falsy, no issue fields, no attachProxy', async () => {
  let dispatchBody = null;
  const { window } = makeSandbox((url, opts) => {
    if (String(url).includes('/api/comments/')) return jsonResponse(true, 201, {});
    dispatchBody = JSON.parse(opts.body);
    return jsonResponse(true, 200, {});
  });
  const { handlers } = trackedHandlers();

  await window.ReplyDelivery.deliverReply(
    { urlKey: 'w', issueId: 'i1', followUpTo: 'lp9', target: 'web' },
    'the reply text',
    handlers
  );

  assert.deepEqual(
    Object.keys(dispatchBody).sort(),
    ['followUpTo', 'prompt', 'target'],
    'force is absent entirely when falsy — not sent as force:false'
  );
  assert.deepEqual(dispatchBody, { prompt: 'the reply text', followUpTo: 'lp9', target: 'web' });
  for (const forbidden of ['issueId', 'issueIdentifier', 'issueTitle', 'issueUrl', 'attachProxy']) {
    assert.equal(dispatchBody[forbidden], undefined, `${forbidden} must never be present — the dispatch factory/bootstrap-provisioning contracts key on its absence`);
  }
});

test('outgoing dispatch payload (I6): force:true is forwarded only when opts.force is truthy', async () => {
  let dispatchBody = null;
  const { window } = makeSandbox((url, opts) => {
    if (String(url).includes('/api/comments/')) return jsonResponse(true, 201, {});
    dispatchBody = JSON.parse(opts.body);
    return jsonResponse(true, 200, {});
  });
  const { handlers } = trackedHandlers();

  await window.ReplyDelivery.deliverReply(
    { urlKey: 'w', issueId: 'i1', followUpTo: 'lp9', target: 'cli', force: true },
    'x',
    handlers
  );

  assert.equal(dispatchBody.force, true);
  assert.deepEqual(Object.keys(dispatchBody).sort(), ['followUpTo', 'force', 'prompt', 'target']);
});

test('the {ok,status,data} internal fetch contract (I11) never throws/rejects at the outer deliverReply promise on a non-2xx response', async () => {
  const { window } = makeSandbox(() => jsonResponse(false, 404, { error: 'not found' }));
  const { handlers } = trackedHandlers();

  // Would throw/reject the test itself if deliverReply's outer promise rejected.
  await window.ReplyDelivery.deliverReply({ urlKey: 'w', issueId: 'i1', target: 'cli' }, 'x', handlers);
});

test('deliverReply\'s outer promise never rejects across the success path either', async () => {
  const { window } = makeSandbox(() => jsonResponse(true, 200, {}));
  const { handlers } = trackedHandlers();
  await window.ReplyDelivery.deliverReply({ urlKey: 'w', issueId: 'i1', target: 'cli' }, 'x', handlers);
});

test('postComment is exported standalone with its settled positional signature (urlKey, issueId, prompt) — sendSave\'s only remaining call shape', async () => {
  let seenUrl = null;
  let seenBody = null;
  const { window } = makeSandbox((url, opts) => {
    seenUrl = url;
    seenBody = JSON.parse(opts.body);
    return jsonResponse(true, 201, { success: true });
  });

  const result = await window.ReplyDelivery.postComment('wkey', 'iss1', 'a comment body');

  assert.match(seenUrl, /\/workspace\/wkey\/api\/comments\/iss1$/);
  assert.deepEqual(seenBody, { body: 'a comment body' });
  // Objects built inside the vm sandbox carry a different-realm prototype, so
  // compare structurally (spread into this realm) rather than deepEqual the
  // sandboxed object directly.
  assert.deepEqual({ ...result, data: { ...result.data } }, { ok: true, status: 201, data: { success: true } });
});

test('errorFromResult is exported standalone and matches the server error message, falling back to HTTP <status>', () => {
  const { window } = makeSandbox(() => { throw new Error('no fetch expected'); });

  const withMessage = window.ReplyDelivery.errorFromResult({ status: 502, data: { error: 'upstream down' } });
  assert.equal(withMessage.message, 'upstream down');

  const withoutMessage = window.ReplyDelivery.errorFromResult({ status: 500, data: {} });
  assert.equal(withoutMessage.message, 'HTTP 500');
});

test('the helper block is DOM-free — no document.* or window.ChatUI reference, since the Observation page loads common.js without chat.js', () => {
  const start = COMMON_JS_SRC.indexOf('window.ReplyDelivery = (function');
  assert.notEqual(start, -1, 'window.ReplyDelivery banner section found in common.js');
  const end = COMMON_JS_SRC.indexOf('\n})();\n', start);
  assert.notEqual(end, -1);
  const block = COMMON_JS_SRC.slice(start, end);
  assert.doesNotMatch(block, /document\./, 'no DOM access inside the helper');
  assert.doesNotMatch(block, /ChatUI/, 'no window.ChatUI reference inside the helper');
});
