/**
 * LIN-3340 — public/close-out.js, the task page's merge client.
 *
 * The witness for the 8 Oct failure: a press works with NO session reply box in
 * the DOM, reading the task's tracker UUID and provider kind off the close-out
 * box. Also pins the `source` threading (H1/G1): the prompt GET and the check
 * POST carry `?source=`/`{source}` when the box has one, and nothing when it
 * doesn't.
 *
 * A plain browser script, so the real shipped source runs in a vm sandbox.
 *
 * Run with: node --test tests/unit/close-out-client.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/close-out.js'), 'utf8');

function load({ window = {}, document } = {}) {
  const module = { exports: {} };
  const doc = document || {
    createElement() { return { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, textContent: '' }; },
    addEventListener() {},
  };
  vm.runInNewContext(SRC, {
    module, window, document: doc, URLSearchParams, console, setTimeout, clearTimeout, Promise,
    Array, String, encodeURIComponent,
  });
  return module.exports;
}

/** A box that reports the given attributes. */
function box(attrs) {
  return {
    firstChild: null,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute() {},
    appendChild() {},
    removeChild() {},
  };
}

const UUID = '11111111-2222-3333-4444-555555555555';

describe('close-out.js: URLs and bodies thread source', () => {
  const { promptUrl, checkUrl, checkBody } = load();

  test('promptUrl carries ?source when present, bare otherwise', () => {
    assert.equal(promptUrl('acme', UUID, 'linear'), `/workspace/acme/api/prompt/${UUID}/close-out?source=linear`);
    assert.equal(promptUrl('acme', UUID), `/workspace/acme/api/prompt/${UUID}/close-out`);
    assert.equal(promptUrl('acme', UUID, ''), `/workspace/acme/api/prompt/${UUID}/close-out`);
  });

  test('checkUrl is keyed by the task identifier', () => {
    assert.equal(checkUrl('acme', 'LIN-50'), '/workspace/acme/api/run-evidence/LIN-50/check');
  });

  test('checkBody carries source only when present', () => {
    assert.equal(JSON.stringify(checkBody('linear')), JSON.stringify({ source: 'linear' }));
    assert.equal(JSON.stringify(checkBody('')), '{}');
    assert.equal(JSON.stringify(checkBody(undefined)), '{}');
  });
});

describe('close-out.js: boxContext reads only the box', () => {
  const { boxContext } = load();
  test('reads identity and state off the attributes', () => {
    const ctx = boxContext(box({
      'data-url-key': 'acme',
      'data-issue-id': UUID,
      'data-issue-identifier': 'LIN-50',
      'data-source': 'linear',
      'data-stop-at': 'pr',
      'data-state': 'ready',
    }));
    assert.deepEqual(JSON.parse(JSON.stringify(ctx)), { urlKey: 'acme', issueId: UUID, issueIdentifier: 'LIN-50', source: 'linear', stopAt: 'pr', state: 'ready' });
  });
});

describe('close-out.js: the press (the 8 Oct witness)', () => {
  test('presses from the box with no reply box in the DOM', async () => {
    const calls = [];
    const window = {
      api(url, opts) {
        calls.push({ url, opts });
        if (url.includes('/api/prompt/')) return Promise.resolve({ prompt: 'P', promptName: 'close-out', issueTitle: 'T' });
        if (url.includes('/close-out-press')) return Promise.resolve({ success: true });
        return Promise.resolve({});
      },
      dispatchPrompt(arg) { calls.push({ dispatch: arg }); return Promise.resolve({ id: 'd1' }); },
    };
    const { pressCloseOut } = load({ window });
    const btn = { textContent: '[ close out & merge ]', disabled: false };
    await pressCloseOut(box({
      'data-url-key': 'acme',
      'data-issue-id': UUID,
      'data-issue-identifier': 'LIN-50',
      'data-source': 'linear',
      'data-pr-url': 'https://github.com/acme/app/pull/41',
      'data-head-sha': 'abc1234',
    }), btn);

    assert.equal(calls[0].url, `/workspace/acme/api/prompt/${UUID}/close-out?source=linear`, 'the prompt GET carries source');
    assert.equal(calls[1].dispatch.kind, 'close-out');
    assert.equal(calls[1].dispatch.issue.id, UUID, 'the issue UUID came from the box');
    assert.equal(calls[1].dispatch.issue.source, 'linear');
    const press = calls.find(c => c.url && c.url.includes('/close-out-press'));
    assert.ok(press, 'the press is recorded');
    assert.deepEqual(JSON.parse(press.opts.body), { prUrl: 'https://github.com/acme/app/pull/41', headSha: 'abc1234', dispatchId: 'd1' });
    assert.equal(btn.textContent, 'close-out sent ✓');
  });

  test('a source-less box sends no source (unchanged behaviour)', async () => {
    const calls = [];
    const window = {
      api(url, opts) { calls.push({ url, opts }); return Promise.resolve(url.includes('/api/prompt/') ? { prompt: 'P' } : {}); },
      dispatchPrompt() { return Promise.resolve({}); },
    };
    const { pressCloseOut } = load({ window });
    await pressCloseOut(box({ 'data-url-key': 'acme', 'data-issue-id': UUID, 'data-issue-identifier': 'LIN-50' }), { textContent: 'x', disabled: false });
    assert.equal(calls[0].url, `/workspace/acme/api/prompt/${UUID}/close-out`);
  });
});

describe('close-out.js: the check', () => {
  test('only a stop-at-PR run at ready/merged/partial checks, and the body carries source', async () => {
    const calls = [];
    const window = {
      api(url, opts) { calls.push({ url, opts }); return Promise.resolve({ state: { status: 'ready' }, done: false }); },
      location: { reload() {} },
    };
    const { runCheck } = load({ window });
    const ready = box({ 'data-url-key': 'acme', 'data-issue-identifier': 'LIN-50', 'data-source': 'linear', 'data-stop-at': 'pr', 'data-state': 'ready' });
    await runCheck(ready);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/acme/api/run-evidence/LIN-50/check');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { source: 'linear' });

    // An ordinary run (no stop-at) never checks.
    const ordinary = box({ 'data-url-key': 'acme', 'data-issue-identifier': 'LIN-50', 'data-state': 'ready' });
    await runCheck(ordinary);
    assert.equal(calls.length, 1, 'no check for a non-stop-at run');
  });

  test('a done result reloads so the tracker Finished header shows', async () => {
    let reloads = 0;
    const window = {
      api() { return Promise.resolve({ state: { status: 'merged', mergedByYou: true }, done: true }); },
      location: { reload() { reloads++; } },
    };
    const { runCheck } = load({ window });
    await runCheck(box({ 'data-url-key': 'acme', 'data-issue-identifier': 'LIN-50', 'data-stop-at': 'pr', 'data-state': 'ready' }));
    assert.equal(reloads, 1);
  });

  /**
   * B1 (review `388f4246`): after the first Done write, `/check` returns
   * `done: true` on every later call, so a page that already shows the tracker
   * as Done would reload forever. A `done` result must NOT reload then.
   */
  test('a done result on a page already showing done makes 0 reloads', async () => {
    let reloads = 0;
    const window = {
      api() { return Promise.resolve({ state: { status: 'merged', mergedByYou: true }, done: true }); },
      location: { reload() { reloads++; } },
    };
    const { runCheck, pageAlreadyDone } = load({ window });
    const main = { getAttribute: (k) => (k === 'data-status' ? 'done' : null) };
    const doc = { querySelector: (sel) => (sel === '[data-testid="task-page"]' ? main : null) };
    assert.equal(pageAlreadyDone(doc), true);
    await runCheck(box({ 'data-url-key': 'acme', 'data-issue-identifier': 'LIN-50', 'data-stop-at': 'pr', 'data-state': 'merged' }), doc);
    assert.equal(reloads, 0, 'no reload loop on the end state the feature exists for');
  });

  test('pageAlreadyDone is false without a main / status / document', () => {
    const { pageAlreadyDone } = load();
    assert.equal(pageAlreadyDone(), false);
    assert.equal(pageAlreadyDone({ querySelector: () => null }), false);
    assert.equal(pageAlreadyDone({ querySelector: () => ({ getAttribute: () => 'idle' }) }), false);
    assert.equal(pageAlreadyDone({ querySelector: () => ({ getAttribute: () => 'done' }) }), true);
  });

  test('a done result reloads once on a page not yet done (In Progress → Done)', async () => {
    let reloads = 0;
    const window = {
      api() { return Promise.resolve({ state: { status: 'merged', mergedByYou: true }, done: true }); },
      location: { reload() { reloads++; } },
    };
    const { runCheck } = load({ window });
    const doc = { querySelector: () => ({ getAttribute: () => 'running' }) };
    await runCheck(box({ 'data-url-key': 'acme', 'data-issue-identifier': 'LIN-50', 'data-stop-at': 'pr', 'data-state': 'merged' }), doc);
    assert.equal(reloads, 1);
  });
});
