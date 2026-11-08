// LIN-998 / LIN-2944 P2: Brief and Recap never spend AI just because the
// section opens.
//
// The behavioral contract, driven against the REAL client `init()` in
// public/brief.js and public/recap.js:
//   - status=missing → render the manual ✦ generate placeholder, NO POST
//     (LIN-2944 P2: opening a section must not spend; only an explicit click does).
//   - status=fresh   → render the cache, NO POST (never clobber fresh).
//   - status=stale   → keep the manual ↻ refresh, NO POST (no reopen tax).
//   - manual ✦ generate click → POST; a coded 503 surfaces the error banner.
//
// public/{brief,recap}.js are browser scripts (plain globals, no ES module /
// build step), so we evaluate their source in a vm sandbox — as
// observation-card-order.test.js does — against a minimal fake DOM and a stub
// `window.api` that records every call. Only the DOM primitives the modules
// actually touch are modeled.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorld } from './helpers/client-world.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load a client section module (brief/recap) into a fresh sandbox with a
// scripted `window.api`. `responder(url, opts)` returns the JSON body for each
// call; `calls` records what was requested so tests can assert POST behavior.
function loadSection(file, globalName, responder) {
  const calls = [];
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    renderMarkdown: (s) => String(s == null ? '' : s),
    relativeTime: () => 'now',
    async api(url, opts) {
      const method = (opts && opts.method) || 'GET';
      calls.push({ url, method });
      return responder(url, method);
    },
  };
  // The section module runs in the shared client world (helpers/client-world.js): its real document and its vm sandbox.
  const world = loadWorld({ window, scripts: [file] });
  return { section: world.window[globalName], calls, makeContainer: world.makeContainer };
}

// A press on the drawn refresh button: the button's own click listeners run, as the browser runs them when it is clicked
// (the fake records them, and does not model bubbling). The button must be drawn, or the press fails.
async function pressDrawn(container, selector) {
  const btn = container.querySelector(selector);
  assert.ok(btn, `${selector} is drawn in the container`);
  for (const fn of btn.listenersOf('click')) await fn({ target: btn });
}

const OPTS = { urlKey: 'ws', identifier: 'LIN-998' };

const FRESH_BRIEF = { status: 'fresh', brief: '## Current\nA live spec.', generatedAt: '2026-07-04T00:00:00Z' };
const FRESH_RECAP = {
  status: 'fresh',
  recap: { done: [{ item: 'Did the thing', type: 'task' }], pending: [], deviations: [] },
  generatedAt: '2026-07-04T00:00:00Z',
};

// Per-section config so the two modules share one behavioral test body.
const SECTIONS = [
  { name: 'Brief', file: 'brief.js', global: 'BriefSection', fresh: FRESH_BRIEF, press: '[data-brief-refresh]' },
  { name: 'Recap', file: 'recap.js', global: 'RecapSection', fresh: FRESH_RECAP, press: '[data-recap-refresh]' },
];

for (const S of SECTIONS) {
  test(`${S.name}: status=missing renders the manual placeholder, NO POST (no spend on open)`, async () => {
    const responder = (url, method) => (method === 'POST' ? S.fresh : { status: 'missing' });
    const { section, calls, makeContainer } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, OPTS);

    assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'no POST on open — opening a section must not spend');
    assert.equal(calls.filter(c => c.method === 'GET').length, 1, 'one status GET');
    assert.equal(container.getAttribute('data-state'), 'missing', 'lands on the manual placeholder');
    assert.match(container.innerHTML, /generate/, 'placeholder carries the ✦ generate button');
  });

  test(`${S.name}: status=fresh renders cache, NO POST (never clobber fresh)`, async () => {
    const responder = () => S.fresh;
    const { section, calls, makeContainer } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, OPTS);

    assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'no POST when already fresh');
    assert.equal(container.getAttribute('data-state'), 'fresh');
  });

  test(`${S.name}: status=stale keeps manual refresh, NO POST (no reopen tax)`, async () => {
    const responder = (url, method) =>
      (method === 'POST' ? S.fresh : { status: 'stale', generatedAt: '2026-07-01T00:00:00Z' });
    const { section, calls, makeContainer } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, OPTS);

    assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'no auto-POST on stale');
    assert.equal(container.getAttribute('data-state'), 'stale');
  });

  // LIN-1016 review ledger item 1 / LIN-2944 P2: an explicit ✦ generate click is
  // the only thing that spends, so a coded 503 it provokes must surface the
  // error banner rather than silently re-render the placeholder. This drives the
  // REAL wired click handler (init lands on the placeholder without a POST).
  test(`${S.name}: manual ✦ generate click on a coded 503 shows the error banner (no silent placeholder)`, async () => {
    const responder = (url, method) => {
      if (method === 'POST') {
        const err = new Error('AI is not configured');
        err.status = 503;
        err.body = { code: 'AI_NOT_CONFIGURED', error: 'AI is not configured' };
        throw err;
      }
      return { status: 'missing' };
    };
    const { section, calls, makeContainer } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    // Open the section; its terminal state is the placeholder either way. P2's
    // "open spends nothing" truth is witnessed by the missing-state test above,
    // so this test isolates the explicit click and stays green pre/post-P2.
    await section.init(container, OPTS);
    const beforeClick = calls.filter(c => c.method === 'POST').length;

    // Now the user clicks it — an explicit action, same coded 503.
    await pressDrawn(container, S.press);

    assert.equal(calls.filter(c => c.method === 'POST').length, beforeClick + 1, 'the click issued its own POST');
    assert.equal(container.getAttribute('data-state'), 'error', 'a manual click surfaces the reason, never the silent placeholder');
  });

  // A manual ✦ generate click must forward the row's `source` to the POST, or
  // per-row provider resolution silently breaks. No earlier case passed `source`,
  // so the vm context never needed URLSearchParams (added in loadSection above).
  test(`${S.name}: manual ✦ generate forwards source on the POST (LIN-1910)`, async () => {
    const responder = (url, method) => (method === 'POST' ? S.fresh : { status: 'missing' });
    const { section, calls, makeContainer } = loadSection(S.file, S.global, responder);

    const container = makeContainer();
    await section.init(container, {
      urlKey: 'ws',
      identifier: 'LIN-998',
      source: 'github',
    });
    assert.equal(container.getAttribute('data-state'), 'missing', 'opens on the manual placeholder');

    await pressDrawn(container, S.press);

    const posts = calls.filter(c => c.method === 'POST');
    assert.equal(posts.length, 1, 'exactly one POST from the click');
    assert.match(posts[0].url, /[?&]source=github(&|$)/, 'manual POST forwards source');
  });
}

// LIN-4358 review ledger 6: a cut-off answer must read as one in the panel. The route
// answers 502 OUTPUT_TRUNCATED, but a generation that ran past the keepalive's first
// byte (20s) has already sent HTTP 200, so the same failure arrives as a resolved body
// with `statusCode` — which drew an empty "fresh" panel ("Nothing to brief yet.").
const CUT_MESSAGE = 'OpenRouter output cut off: anthropic/claude-haiku-5.5 stopped with finish_reason \'length\' (6000 of 6000 output tokens, 5800 of them hidden reasoning), after one retry with a larger budget. The partial result was not kept.';
const TRUNCATED_BODY = {
  error: 'The model\'s output was cut off, so nothing was kept',
  code: 'OUTPUT_TRUNCATED', message: CUT_MESSAGE, model: 'anthropic/claude-haiku-5.5', finishReason: 'length',
};

for (const S of SECTIONS) {
  const cases = [
    ['after the keepalive flushed (200 with statusCode)', () => ({ ...TRUNCATED_BODY, statusCode: 502 })],
    ['as a plain 502', () => { const err = new Error(TRUNCATED_BODY.error); err.status = 502; err.body = TRUNCATED_BODY; throw err; }],
  ];
  for (const [how, post] of cases) {
    test(`${S.name}: a cut-off answer ${how} shows the model's cut-off message, never a fresh panel`, async () => {
      const responder = (url, method) => (method === 'POST' ? post() : { status: 'missing' });
      const { section, makeContainer } = loadSection(S.file, S.global, responder);
      const container = makeContainer();
      await section.init(container, OPTS);
      await pressDrawn(container, S.press);
      assert.equal(container.getAttribute('data-state'), 'error');
      assert.ok(container.innerHTML.includes(CUT_MESSAGE), 'the panel names the model and where its tokens went');
    });
  }

  test(`${S.name}: any other late failure (200 with statusCode) is an error too, with its own words`, async () => {
    const responder = (url, method) => (method === 'POST' ? { error: 'AI service temporarily unavailable', statusCode: 503 } : { status: 'missing' });
    const { section, makeContainer } = loadSection(S.file, S.global, responder);
    const container = makeContainer();
    await section.init(container, OPTS);
    await pressDrawn(container, S.press);
    assert.equal(container.getAttribute('data-state'), 'error');
    assert.ok(container.innerHTML.includes('AI service temporarily unavailable'));
  });
}
