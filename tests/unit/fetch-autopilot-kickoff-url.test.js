// LIN-1904 close-out ledger row 3: `fetchAutopilotKickoff` (public/common.js)
// switched its issue-scoped URL from string concatenation to `URLSearchParams`
// so a `source` param could join a `variant` param correctly, but shipped with
// no assertion on the resulting URL shapes anywhere in the suite — equivalence
// to the old concatenation was established by code reading only.
//
// public/common.js is a plain browser script (assigns to `window`, not an ES
// module) and is not import-safe as a whole — same documented constraint as
// server.js (see lin-1503-github-family-401-remint-behaviour.test.js). This
// follows that file's house pattern: slice the real function source by pinned
// markers and execute it in a vm context with `window.api` stubbed, so the
// URL-building logic under test is the actual shipped source, not a
// hand-copied re-implementation of it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

const START_MARKER = 'window.fetchAutopilotKickoff = async function fetchAutopilotKickoff(';

function sliceFetchAutopilotKickoffSource() {
  const startIdx = COMMON_SRC.indexOf(START_MARKER);
  assert.ok(startIdx !== -1, 'fetchAutopilotKickoff marker not found in public/common.js — has it moved/been renamed?');
  const endMarker = '\n};';
  const endIdx = COMMON_SRC.indexOf(endMarker, startIdx);
  assert.ok(endIdx !== -1, 'closing `};` for fetchAutopilotKickoff not found');
  return COMMON_SRC.slice(startIdx, endIdx + endMarker.length);
}

/**
 * Loads the real `fetchAutopilotKickoff` source into a fresh vm context,
 * with `window.api` stubbed to capture the URL it was called with instead of
 * performing a real fetch. Returns the captured URL.
 */
async function callFetchAutopilotKickoff(opts) {
  const calls = [];
  const context = { URLSearchParams, calls };
  context.window = context; // `window.foo = ...` inside the source sets context.foo directly
  context.window.api = async (url, fetchOpts) => {
    calls.push({ url, fetchOpts });
    return { prompt: 'stub', promptName: 'stub', kind: 'autopilot' };
  };
  vm.createContext(context);
  vm.runInContext(sliceFetchAutopilotKickoffSource(), context);
  await context.window.fetchAutopilotKickoff(opts);
  assert.equal(calls.length, 1);
  return calls[0].url;
}

describe('fetchAutopilotKickoff — issue-scoped URL construction (LIN-1904)', () => {
  test('no variant, no source → bare issue URL, no query string', async () => {
    const url = await callFetchAutopilotKickoff({ urlKey: 'ws', issueId: 'issue-1' });
    assert.equal(url, '/workspace/ws/api/autopilot-prompt/issue-1');
  });

  test('variant only → `?variant=<v>`, byte-identical to the pre-LIN-1904 concatenation', async () => {
    const url = await callFetchAutopilotKickoff({ urlKey: 'ws', issueId: 'issue-1', variant: 'stepper' });
    assert.equal(url, '/workspace/ws/api/autopilot-prompt/issue-1?variant=stepper');
  });

  test('source only → `?source=<s>`', async () => {
    const url = await callFetchAutopilotKickoff({ urlKey: 'ws', issueId: 'issue-1', source: 'github' });
    assert.equal(url, '/workspace/ws/api/autopilot-prompt/issue-1?source=github');
  });

  test('variant and source together → both joined with `&`, in that order', async () => {
    const url = await callFetchAutopilotKickoff({ urlKey: 'ws', issueId: 'issue-1', variant: 'stepper', source: 'github' });
    assert.equal(url, '/workspace/ws/api/autopilot-prompt/issue-1?variant=stepper&source=github');
  });

  test('urlKey and issueId are URL-encoded', async () => {
    const url = await callFetchAutopilotKickoff({ urlKey: 'my ws', issueId: 'a/b' });
    assert.equal(url, '/workspace/my%20ws/api/autopilot-prompt/a%2Fb');
  });

  test('the goal-scoped (no issueId) branch is unaffected: `source` is a no-op there', async () => {
    const url = await callFetchAutopilotKickoff({ urlKey: 'ws', goal: 'ship it', variant: 'stepper', source: 'github', maxTasks: 5 });
    assert.equal(url, '/workspace/ws/api/autopilot-prompt?goal=ship+it&variant=stepper&maxTasks=5');
  });
});
