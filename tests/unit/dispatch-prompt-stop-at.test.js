// LIN-3246 / LIN-2949 P1b: `window.dispatchPrompt` (public/common.js) gains a
// `stopAt` option beside `entryRung` and forwards it into the dispatch body,
// where the P1a route validates it (only 'pr', only on a fresh autopilot
// dispatch). Every other launcher passes nothing and stays byte-identical.
//
// public/common.js is a plain browser script (assigns to `window`) and is not
// import-safe as a whole — same house pattern as
// fetch-autopilot-kickoff-url.test.js: slice the real function source by pinned
// markers and run it in a vm context with `window.api` stubbed to capture the
// body it would POST.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');
const START_MARKER = 'window.dispatchPrompt = async function dispatchPrompt(opts = {}) {';

function sliceDispatchPromptSource() {
  const startIdx = SRC.indexOf(START_MARKER);
  assert.ok(startIdx !== -1, 'dispatchPrompt marker not found in public/common.js — has it moved/been renamed?');
  const endMarker = '\n};';
  const endIdx = SRC.indexOf(endMarker, startIdx);
  assert.ok(endIdx !== -1, 'closing `};` for dispatchPrompt not found');
  return SRC.slice(startIdx, endIdx + endMarker.length);
}

async function callDispatchPrompt(opts) {
  const calls = [];
  const context = { encodeURIComponent, JSON, calls };
  context.window = context; // `window.foo = ...` inside the source sets context.foo directly
  context.window.ProxyToggle = { shouldAppend: () => false };
  context.window.api = async (url, fetchOpts) => {
    calls.push({ url, fetchOpts, body: JSON.parse(fetchOpts.body) });
    return { item: { id: 'disp-1' } };
  };
  vm.createContext(context);
  vm.runInContext(sliceDispatchPromptSource(), context);
  await context.window.dispatchPrompt(opts);
  assert.equal(calls.length, 1);
  return calls[0].body;
}

const ISSUE = { id: 'uuid-42', identifier: 'LIN-42' };

describe('dispatchPrompt — stopAt body field (LIN-3246)', () => {
  test("stopAt:'pr' is forwarded in the dispatch body", async () => {
    const body = await callDispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE, kind: 'autopilot', stopAt: 'pr' });
    assert.equal(body.stopAt, 'pr');
  });

  test('omitted/blank stopAt sends no stopAt field (every other launcher unchanged)', async () => {
    for (const stopAt of [undefined, null, '']) {
      const body = await callDispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE, kind: 'autopilot', stopAt });
      assert.ok(!('stopAt' in body), `stopAt: ${JSON.stringify(stopAt)} must not add the field`);
    }
  });

  test('a run-step dispatch carries entryRung but no stopAt', async () => {
    const body = await callDispatchPrompt({ urlKey: 'ws', prompt: 'p', issue: ISSUE, entryRung: 'run-step' });
    assert.equal(body.entryRung, 'run-step');
    assert.ok(!('stopAt' in body));
  });
});
