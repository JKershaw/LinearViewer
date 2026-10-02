// Unit tests for the extracted PR-state reader and the fail-open wrapper
// (LIN-3247).
//
// Run with: node --test tests/unit/github-pr-status.test.js
//
// `lib/github-pr-status.js` is a verbatim extraction of the `get_pr_status`
// reader that lived in `lib/chat-tools.js` (LIN-2624). The chat tool's own
// behaviour is pinned by tests/unit/chat-tools.test.js, which stays untouched;
// this file covers the fail-open wrapper the run-evidence route calls: a throw
// (403 rate limit, timeout) or a `readable:false` read yields `state:'unknown'`
// ("not checked"), and a readable result passes through unchanged.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readPrStatusFailOpen } from '../../lib/github-pr-status.js';

const REPO = 'JKershaw/LinearViewer';
const SHA = 'abc1234abc1234abc1234abc1234abc1234abcd';

// A provider whose fetchProjects reports one project bound to `repo` via the
// `repo=` convention (lib/workspace-repos.js) — the same allowlist source the
// chat tool uses.
function makeProvider({ repo = REPO } = {}) {
  return {
    async fetchProjects() {
      return { projects: [{ id: 'p1', name: 'P', content: `repo=${repo}` }], issues: [] };
    },
  };
}

// A fetch fake that records every call and answers a fixed script of GitHub
// REST responses keyed by path. Unset paths 404.
function makeFakeFetch(responses = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const path = url.replace('https://api.github.com', '');
    const entry = responses[path];
    if (!entry) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    return { ok: entry.status >= 200 && entry.status < 300, status: entry.status, json: async () => entry.body };
  };
  impl.calls = calls;
  return impl;
}

const SUCCESS_RESPONSES = {
  [`/repos/${REPO}`]: { status: 200, body: { private: false } },
  [`/repos/${REPO}/pulls/42`]: {
    status: 200,
    body: {
      state: 'open', merged: false, mergeable: true,
      head: { ref: 'feature-x', sha: SHA }, base: { ref: 'main' },
    },
  },
  [`/repos/${REPO}/commits/${SHA}/check-runs`]: {
    status: 200, body: { check_runs: [{ name: 'unit', conclusion: 'success' }] },
  },
  [`/repos/${REPO}/commits/${SHA}/status`]: {
    status: 200, body: { statuses: [{ context: 'ci-success', state: 'success' }] },
  },
};

describe('readPrStatusFailOpen', () => {
  test('a readable result passes through unchanged — the PR state field still means open/merged/closed', async () => {
    const result = await readPrStatusFailOpen({
      provider: makeProvider(), scope: 'tok', repo: REPO, number: 42, sha: SHA,
      doFetch: makeFakeFetch(SUCCESS_RESPONSES), cache: new Map(),
    });
    assert.deepStrictEqual(result, {
      repo: REPO,
      readable: true,
      number: 42,
      state: 'open',
      merged: false,
      head: { ref: 'feature-x', sha: SHA },
      base: { ref: 'main' },
      mergeable: true,
      ref: SHA,
      checks: [
        { name: 'unit', conclusion: 'success' },
        { name: 'ci-success', conclusion: 'success' },
      ],
    });
  });

  test('a thrown read (403 rate limit) yields state unknown instead of throwing', async () => {
    const doFetch = makeFakeFetch({
      [`/repos/${REPO}`]: { status: 403, body: { message: 'API rate limit exceeded' } },
    });
    const result = await readPrStatusFailOpen({
      provider: makeProvider(), scope: 'tok', repo: REPO, number: 42, doFetch, cache: new Map(),
    });
    assert.strictEqual(result.readable, false);
    assert.strictEqual(result.state, 'unknown');
    assert.match(result.reason, /HTTP 403/);
  });

  test('a readable:false read (private repo probe 404s) yields state unknown', async () => {
    const doFetch = makeFakeFetch({});
    const result = await readPrStatusFailOpen({
      provider: makeProvider(), scope: 'tok', repo: REPO, number: 42, doFetch, cache: new Map(),
    });
    assert.deepStrictEqual(result, {
      repo: REPO,
      readable: false,
      state: 'unknown',
      reason: 'not readable: private repository',
    });
  });

  test('a repo outside the workspace allowlist is never fetched and reads unknown', async () => {
    const doFetch = makeFakeFetch(SUCCESS_RESPONSES);
    const result = await readPrStatusFailOpen({
      provider: makeProvider(), scope: 'tok', repo: 'someone-else/not-named', number: 42, doFetch, cache: new Map(),
    });
    assert.strictEqual(result.readable, false);
    assert.strictEqual(result.state, 'unknown');
    assert.strictEqual(doFetch.calls.length, 0, 'an unlisted repo must never reach a GitHub fetch');
  });

  test('its own 60-second cache answers a repeated read without another fetch', async () => {
    const doFetch = makeFakeFetch(SUCCESS_RESPONSES);
    const cache = new Map();
    const args = { provider: makeProvider(), scope: 'tok', repo: REPO, number: 42, sha: SHA, doFetch, cache };
    await readPrStatusFailOpen(args);
    const callsAfterFirst = doFetch.calls.length;
    assert.ok(callsAfterFirst > 0);
    await readPrStatusFailOpen(args);
    assert.strictEqual(doFetch.calls.length, callsAfterFirst, 'the second read must be served from the wrapper cache');
  });
});
