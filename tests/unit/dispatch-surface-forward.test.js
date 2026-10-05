/**
 * LIN-2944 P1 — the dispatch `surface` handover (LIN-2944 comment d610edd0).
 *
 * `public/common.js` `dispatchPrompt` must forward an optional `surface` in the
 * POST /api/dispatch body, so the session dispatch route can record which
 * opened-task surface (Home vs Swipe) a run was pressed from. Absent for every
 * other caller (periodical / Setup Prompt / dispatch page / autopilot kickoff),
 * which keep the route's optional behaviour.
 *
 * Drives the REAL common.js in a vm sandbox (the LIN-2370 harness pattern).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCommon() {
  const calls = { api: [] };
  const sandbox = {
    window: {
      location: { origin: 'http://test.local' },
      api: async (url, opts) => { calls.api.push({ url, opts }); return { ok: true }; },
      // dispatchPrompt consults the toggle to decide attachProxy; off here so the
      // body stays minimal and focused on the surface field.
    },
    document: { addEventListener() {}, querySelector: () => null },
    localStorage: { getItem: () => null, setItem() {} },
    console,
    fetch() { throw new Error('fetch should not be called'); },
    setTimeout,
    clearTimeout,
  };
  sandbox.window.ProxyToggle = { shouldAppend: () => false };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(__dirname, '../../public/common.js'), 'utf8'), sandbox, { filename: 'common.js' });
  // common.js defines its own window.api (the shared fetch wrapper); override it
  // AFTER load so the harness captures the POST the shipped dispatchPrompt makes.
  sandbox.window.api = async (url, opts) => { calls.api.push({ url, opts }); return { ok: true }; };
  return { dispatchPrompt: sandbox.window.dispatchPrompt, calls };
}

const ISSUE = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', identifier: 'LIN-42' };

describe('LIN-2944 P1 — dispatchPrompt forwards surface', () => {
  test('a home dispatch sends surface:"home" in the request body', async () => {
    const { dispatchPrompt, calls } = loadCommon();
    await dispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE, surface: 'home' });
    assert.equal(calls.api.length, 1);
    const body = JSON.parse(calls.api[0].opts.body);
    assert.equal(body.surface, 'home');
  });

  test('a swipe dispatch sends surface:"swipe" in the request body', async () => {
    const { dispatchPrompt, calls } = loadCommon();
    await dispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE, surface: 'swipe' });
    const body = JSON.parse(calls.api[0].opts.body);
    assert.equal(body.surface, 'swipe');
  });

  test('other callers that omit surface send no surface field (route stays optional)', async () => {
    const { dispatchPrompt, calls } = loadCommon();
    await dispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE });
    const body = JSON.parse(calls.api[0].opts.body);
    assert.equal('surface' in body, false);
  });
});

// LIN-3242 (LIN-3126 §4): the dispatch UI forwards the issue row's binding
// selector stamps (`data-source` / `data-binding-scope`, threaded onto the issue
// object as `source` / `bindingScope`) as `issueSource` / `issueBindingScope`.
// Both are SPARSE: an unstamped row sends neither key.
describe('LIN-3242 — dispatchPrompt forwards the issue row binding selector', () => {
  const STAMPED = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', identifier: 'GB-1', source: 'github', bindingScope: 'octo/repoB' };

  test('a stamped issue row sends issueSource + issueBindingScope in the request body', async () => {
    const { dispatchPrompt, calls } = loadCommon();
    await dispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: STAMPED });
    const body = JSON.parse(calls.api[0].opts.body);
    assert.equal(body.issueSource, 'github');
    assert.equal(body.issueBindingScope, 'octo/repoB');
  });

  test('an unstamped issue row sends neither key (byte-identical body)', async () => {
    const { dispatchPrompt, calls } = loadCommon();
    await dispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE });
    const body = JSON.parse(calls.api[0].opts.body);
    assert.equal('issueSource' in body, false);
    assert.equal('issueBindingScope' in body, false);
  });
});

