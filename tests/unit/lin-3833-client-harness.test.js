/**
 * LIN-3833 step 1, the client half: the opened task's exec control no longer pre-selects
 * claude-code (`harnessDefault: ''`), an untouched harness sends no key, and `dispatchPrompt`
 * forwards the chosen `effort`. Drives the REAL public/common.js in a vm sandbox, as
 * dispatch-surface-forward.test.js does.
 *
 * Red before the change: `effort` was not forwarded, and the disclosure always pre-selected
 * claude-code, so the `harnessDefault: ''` witness failed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ISSUE = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', identifier: 'LIN-42' };

function loadCommon() {
  const calls = { api: [] };
  const sandbox = {
    window: {
      location: { origin: 'http://test.local', pathname: '/' },
      ProxyToggle: { shouldAppend: () => false },
    },
    document: { addEventListener() {}, querySelector: () => null },
    localStorage: { getItem: () => null, setItem() {} },
    console,
    fetch() { throw new Error('fetch should not be called'); },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(__dirname, '../../public/common.js'), 'utf8'), sandbox, { filename: 'common.js' });
  sandbox.window.api = async (url, opts) => { calls.api.push({ url, opts }); return { ok: true }; };
  return { win: sandbox.window, calls };
}

describe('LIN-3833 — dispatchPrompt forwards effort and sends no untouched harness', () => {
  test('a chosen effort is sent in the body', async () => {
    const { win, calls } = loadCommon();
    await win.dispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE, effort: 'high' });
    assert.equal(JSON.parse(calls.api[0].opts.body).effort, 'high');
  });

  test('an omitted effort sends no effort key (the resolution applies)', async () => {
    const { win, calls } = loadCommon();
    await win.dispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE });
    assert.equal('effort' in JSON.parse(calls.api[0].opts.body), false);
  });

  test('an untouched control (harness null) sends no harness key', async () => {
    const { win, calls } = loadCommon();
    await win.dispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE, harness: null, surface: 'home' });
    const body = JSON.parse(calls.api[0].opts.body);
    assert.equal('harness' in body, false);
    assert.equal(body.surface, 'home');
  });
});

describe('LIN-3833 — the opened task\'s exec control pre-selects nothing', () => {
  test('harnessDefault "" renders no selected harness, so an untouched control reads back null', () => {
    const { win } = loadCommon();
    const html = win.renderDispatchDisclosure({ idPrefix: 'home-1', harnessDefault: '' });
    assert.equal(/<option value="claude-code" selected>/.test(html), false, 'claude-code is not pre-selected');
    assert.equal(/<option value="opencode" selected>/.test(html), false, 'opencode is not pre-selected');
    assert.match(html, /<option value="">&mdash;<\/option>/, 'the blank option is first, so it is what an untouched select holds');
  });

  test('no harnessDefault keeps today\'s pre-selection (byte-identical for the other callers)', () => {
    const { win } = loadCommon();
    const html = win.renderDispatchDisclosure({ idPrefix: 'tree-1' });
    assert.match(html, /<option value="claude-code" selected>/, 'the app.js tree-row caller still pre-selects claude-code');
  });
});
