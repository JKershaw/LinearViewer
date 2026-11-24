// LIN-2046: the recommend-stream fetch in public/prompt-section.js (`fetchPrompt`'s
// `__ai__` branch) now threads `source` so a merged multi-binding swipe row resolves
// recommend against its OWN binding rather than the active one.
//
// public/prompt-section.js is a native module (LIN-4463 piece 5), imported over the fake DOM. The `__ai__` press is
// `container.click`, which needs the ✦ next-step button to be drawn, as a browser needs it. The recommend-stream fetch
// is the network boundary, so it is recorded as a stub; `fetch` and `AbortController` are sandbox globals (bare
// identifiers in the source), not `window.fetch`, because the `__ai__` branch is a deliberate raw-`fetch()` SSE
// carve-out.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { promptSectionWorld } from './helpers/prompt-section-world.js';

// The `__ai__` fetch resolves `{ ok: false }`, which short-circuits before the stream body is read: no ReadableStream
// needs modelling. The timers run at once (the original harness's `setTimeout` was a no-op: nothing timed out).
async function loadPromptSection(t) {
  const calls = [];
  const world = await promptSectionWorld(t, {
    window: {
      escapeHtml: (s) => (s == null ? '' : String(s)),
      stripCodeBlockWrapper: (s) => s,
      renderMarkdown: (s) => String(s == null ? '' : s),
    },
    globals: {
      fetch: async (url, opts) => {
        calls.push({ url, opts });
        return { ok: false, json: async () => ({}) };
      },
      setTimeout: () => 1,
      clearTimeout: () => {},
    },
  });
  return { PromptSection: world.PromptSection, makeContainer: world.makeContainer, calls };
}

function baseOpts(issue) {
  // LIN-3849: `runSetup` (the owner's "set up ›" rung) defaults to the old not-dispatch-enabled state.
  const o = {
    urlKey: 'ws',
    issue,
    hasAI: true,
    dispatchEnabled: false,
    isLocalhost: false,
    customPrompts: [],
    defaultPromptKeys: [],
    morePromptKeys: [],
    promptMeta: {},
  };
  return { runSetup: !o.dispatchEnabled, ...o };
}

describe('recommend-stream URL construction (LIN-2046)', () => {
  test('opts.issue.source present -> URL carries ?source=<provider>', async (t) => {
    const { PromptSection, makeContainer, calls } = await loadPromptSection(t);
    const container = makeContainer();
    const issue = { id: 'issue-1', identifier: 'JIRA-1', source: 'jira' };

    PromptSection.init(container, baseOpts(issue));
    await container.click({ prompt: '__ai__' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/ws/api/recommend/issue-1/stream?source=jira');
  });

  test('opts.issue.source absent -> URL unchanged, no query string', async (t) => {
    const { PromptSection, makeContainer, calls } = await loadPromptSection(t);
    const container = makeContainer();
    const issue = { id: 'issue-2', identifier: 'LIN-2' };

    PromptSection.init(container, baseOpts(issue));
    await container.click({ prompt: '__ai__' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/ws/api/recommend/issue-2/stream');
  });
});
