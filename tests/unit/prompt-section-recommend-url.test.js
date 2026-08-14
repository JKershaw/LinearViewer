// LIN-2046: the recommend-stream fetch in public/prompt-section.js (`fetchPrompt`'s
// `__ai__` branch) now threads `source` so a merged multi-binding swipe row resolves
// recommend against its OWN binding rather than the active one.
//
// public/prompt-section.js is a plain browser script (assigns to `window`, not an ES
// module), so it is evaluated in a vm sandbox against a minimal fake DOM — the same
// house pattern tests/unit/brief-recap-autogenerate.test.js uses for public/brief.js
// and public/recap.js. The marker-slice technique from
// tests/unit/fetch-autopilot-kickoff-url.test.js does not transplant here: the fetch
// under test lives inside `fetchPrompt`, a nested `async function` closing over
// `init()`'s local state (issueId/opts/state/ac), and only `{ init, getCached }` is
// exported — there is no standalone `window.X = async function` to slice out.
//
// The `__ai__` branch is a deliberate raw-`fetch()` SSE carve-out (documented inline
// in the module), so `fetch` and `AbortController` are stubbed as TOP-LEVEL sandbox
// globals (bare identifiers in the source), not as `window.fetch` — mirroring how
// fetch-autopilot-kickoff-url.test.js supplies `URLSearchParams` at the top level for
// the same reason.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/prompt-section.js'), 'utf8');

// Minimal fake container: only what init()/applyState()/handleClick() touch on the
// idle → generating → error path this test drives (the __ai__ branch's fetch stub
// resolves `{ ok: false }`, short-circuiting before handleStreamingResponse's
// ReadableStream parsing, so no streaming body needs modelling).
function makeContainer() {
  return {
    innerHTML: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    contains() { return true; },
    _clickHandler: null,
    addEventListener(type, fn) { if (type === 'click') this._clickHandler = fn; },
    removeEventListener() {},
    // Drives the real delegated handleClick() with a synthetic event whose
    // target.closest(...) resolves to a button carrying data-prompt=<label>,
    // mirroring the real button markup renderPicker() emits.
    async clickPrompt(label) {
      const btn = { dataset: { prompt: label }, closest: () => btn };
      await this._clickHandler({ target: btn });
    },
  };
}

// Loads the real public/prompt-section.js into a fresh vm sandbox. `fetchImpl` is
// mutable per-test via the returned setter; `calls` records every fetch request URL.
function loadPromptSection() {
  const calls = [];
  let fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    stripCodeBlockWrapper: (s) => s,
    renderMarkdown: (s) => String(s == null ? '' : s),
  };
  const sandbox = {
    window,
    AbortController,
    URLSearchParams,
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      return fetchImpl(url, opts);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return {
    PromptSection: window.PromptSection,
    calls,
    setFetchImpl: (fn) => { fetchImpl = fn; },
  };
}

function baseOpts(issue) {
  return {
    urlKey: 'ws',
    issue,
    hasAI: true,
    hasAutopilot: false,
    dispatchEnabled: false,
    proxyEnabled: false,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: [],
    morePromptKeys: [],
    promptMeta: {},
  };
}

describe('recommend-stream URL construction (LIN-2046)', () => {
  test('opts.issue.source present -> URL carries ?source=<provider>', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const container = makeContainer();
    const issue = { id: 'issue-1', identifier: 'JIRA-1', source: 'jira' };

    PromptSection.init(container, baseOpts(issue));
    await container.clickPrompt('__ai__');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/ws/api/recommend/issue-1/stream?source=jira');
  });

  test('opts.issue.source absent -> URL unchanged, no query string', async () => {
    const { PromptSection, calls } = loadPromptSection();
    const container = makeContainer();
    const issue = { id: 'issue-2', identifier: 'LIN-2' };

    PromptSection.init(container, baseOpts(issue));
    await container.clickPrompt('__ai__');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/ws/api/recommend/issue-2/stream');
  });
});
