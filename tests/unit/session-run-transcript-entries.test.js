/**
 * LIN-1728 Phase 2 (Revision 3, F6) / LIN-3037 — `public/session.js`'s
 * `renderRunTranscripts` must not render a decision-lifecycle stamp
 * (`decision-answer`, `decision-withdrawn`, `decision-withdrawal-reversed`)
 * as a bare `{"decision_id":...}` (or, for a withdrawal, its raw free-text
 * `reason`) agent chat bubble.
 *
 * `decision-answer` was previously covered ONLY by
 * tests/e2e/session-page.spec.js:704 ("a decision-answer stamp in a run's
 * transcript never renders as a chat bubble"). LIN-3037 beat 2 extended the
 * same inline kind check to decision-withdrawn/decision-withdrawal-reversed,
 * but no test exercised it (the e2e spec was not touched, and no unit test
 * existed for this file at all).
 *
 * A genuine e2e twin for the two new kinds was NOT added: seeding a REAL
 * decision-withdrawn/decision-withdrawal-reversed feedback entry needs a
 * write path this branch does not have yet. `POST /api/dispatch/feedback/:id`
 * (the only runner-facing feedback-write route) validates `kind` against
 * `FEEDBACK_ENTRY_KINDS` (lib/dispatch-feedback-kinds.js; at the time —
 * `['status','recap','heartbeat','evidence','assistant-text','tool','usage',
 * 'resources','refusal','decision']`), which deliberately excludes
 * `decision-answer` (see lib/dispatch-feedback-kinds.js, lib/observer-efficacy-
 * signal.js:125) and does not (yet) include the two withdrawal kinds either
 * — an out-of-whitelist `kind` is silently dropped, not stored. The existing
 * e2e test seeds that stamp through the history seam (POST
 * /test/seed-history-feedback, LIN-4541: no route writes it now), which is
 * `decision-answer`-specific; the withdrawal write path is LIN-3035/LIN-3036,
 * not yet landed on this branch (LIN-3037's research comment `494e713b`
 * confirms `origin/lin-2891-linearviewer` is LIN-3034 only at this beat).
 * There is no test-only feedback-injection route either. So a real
 * withdrawal stamp cannot be seeded end-to-end today, on this branch, by any
 * route — a Playwright twin of the existing decision-answer e2e test would
 * have nothing legitimate to write.
 *
 * This file is the unit harness instead (same technique as
 * tests/unit/dispatch-feedback-entries.test.js's `renderFeedbackEntries`
 * extraction, LIN-2205, for public/dispatch.js's sibling site): it
 * vm-sandboxes `renderRunTranscripts`'s own source slice from
 * public/session.js with minimal `document`/`window` stubs, and drives it
 * with hand-built feedback entries — bypassing the write path entirely,
 * since the function only ever reads `entry.kind`/`entry.message` off
 * already-encoded JSON (`lib/render-session.js`'s `encodeFeedbackJSON`), not
 * off dispatch storage. This exercises the REAL client-side exclusion logic,
 * not a reimplementation of it.
 *
 * Run with: node --test tests/unit/session-run-transcript-entries.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorld, clickOn } from './helpers/client-world.js';
import { harnessModelsBlock } from '../../lib/model-routing-harnesses.js';
import { __internal as pipelineInternal } from '../../lib/pipeline-loops.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { FIXTURE_SECRETS } from '../fixtures/secret-scan-fixtures.js';
import { MASK } from '../../lib/mask-secrets.js';
import { T0, at, own, child, loopWith, pageHtml } from '../fixtures/lin-4559-run-page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_JS_SRC = readFileSync(join(__dirname, '../../public/session.js'), 'utf8');

function extractRenderRunTranscriptsSrc() {
  const start = SESSION_JS_SRC.indexOf('function renderRunTranscripts() {');
  assert.notEqual(start, -1, 'renderRunTranscripts found in public/session.js');
  const end = SESSION_JS_SRC.indexOf('function initInlineReplies()', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return SESSION_JS_SRC.slice(start, end);
}

function makeSandbox(threads) {
  const appended = [];
  const sandbox = {
    document: { querySelectorAll: () => threads },
    window: {
      ChatUI: { appendMessage: (thread, msg) => appended.push(msg) },
      escapeHtml: (s) => String(s),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractRenderRunTranscriptsSrc(), sandbox, { filename: 'session.js-renderRunTranscripts-slice' });
  sandbox.__appended = appended;
  return sandbox;
}

function thread(entries) {
  return { dataset: { feedback: JSON.stringify(entries) } };
}

test('renderRunTranscripts excludes a decision-answer entry, keeping real chat entries', () => {
  const sandbox = makeSandbox([
    thread([
      { message: 'a real chat line', timestamp: '2026-08-01T00:00:00.000Z' },
      { kind: 'decision-answer', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:01:00.000Z' },
      { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' },
    ]),
  ]);
  sandbox.renderRunTranscripts();
  assert.equal(sandbox.__appended.length, 2);
  assert.ok(!sandbox.__appended.some((m) => m.html.includes('decision_id')), 'the stamp never renders as a bare JSON bubble');
});

test('renderRunTranscripts excludes a decision-withdrawn entry, keeping real chat entries (LIN-3037)', () => {
  const sandbox = makeSandbox([
    thread([
      { message: 'a real chat line', timestamp: '2026-08-01T00:00:00.000Z' },
      { kind: 'decision-withdrawn', message: '{"decision_id":"d-1","reason":"scheduled wakeup, re-raise later"}', timestamp: '2026-08-01T00:01:00.000Z' },
      { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' },
    ]),
  ]);
  sandbox.renderRunTranscripts();
  assert.equal(sandbox.__appended.length, 2);
  assert.ok(!sandbox.__appended.some((m) => m.html.includes('decision_id')), 'the stamp never renders as a bare JSON bubble');
  assert.ok(!sandbox.__appended.some((m) => m.html.includes('scheduled wakeup')), "the withdrawal's reason never renders as a bubble");
});

test('renderRunTranscripts excludes a decision-withdrawal-reversed entry, keeping real chat entries (LIN-3037)', () => {
  const sandbox = makeSandbox([
    thread([
      { message: 'a real chat line', timestamp: '2026-08-01T00:00:00.000Z' },
      { kind: 'decision-withdrawal-reversed', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:01:00.000Z' },
      { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' },
    ]),
  ]);
  sandbox.renderRunTranscripts();
  assert.equal(sandbox.__appended.length, 2);
  assert.ok(!sandbox.__appended.some((m) => m.html.includes('decision_id')), 'the stamp never renders as a bare JSON bubble');
});

test('renderRunTranscripts renders nothing when only a decision-withdrawn entry is present', () => {
  const sandbox = makeSandbox([
    thread([
      { kind: 'decision-withdrawn', message: '{"decision_id":"d-1","reason":"unrelated"}', timestamp: '2026-08-01T00:00:00.000Z' },
    ]),
  ]);
  sandbox.renderRunTranscripts();
  assert.equal(sandbox.__appended.length, 0);
});

test('renderRunTranscripts is unchanged for feedback with no decision-lifecycle stamps (regression pin)', () => {
  const sandbox = makeSandbox([
    thread([
      { message: 'opened the pull request', url: 'https://example.com/pr/1', urlLabel: 'PR #1', timestamp: '2026-08-01T00:00:00.000Z' },
    ]),
  ]);
  sandbox.renderRunTranscripts();
  assert.equal(sandbox.__appended.length, 1);
  assert.match(sandbox.__appended[0].html, /opened the pull request/);
  assert.match(sandbox.__appended[0].html, /PR #1/);
});

// ── LIN-4559: each child agent is its own collapsible thread under the run (the drawn page) ──────────────────────
// The server half and the stylesheet are in tests/unit/lin-4559-run-page-agent-threads.test.js. Here the page as the
// server renders it is drawn in the client world: the real common.js and chat.js, then session.js's toggle and
// transcript slice. Collapsed by default: the run's own conversation stays the line a reader follows; the summary
// says who and how much, one click opens it.

/** `session.js` from the run toggles through the transcript drawing (the functions the page runs on load for both). */
function clientSlice() {
  const start = SESSION_JS_SRC.indexOf('function toggleRun(');
  const end = SESSION_JS_SRC.indexOf('function initInlineReplies()', start);
  assert.ok(start !== -1 && end !== -1, 'the toggle and transcript functions are found in public/session.js');
  return SESSION_JS_SRC.slice(start, end);
}

/** The page drawn in the client world: real common.js and chat.js, then the session.js slice over the server's page. */
function drawn(loop) {
  const world = loadWorld({ window: { __HARNESS_MODELS__: harnessModelsBlock(), isPinnedToBottom: () => false }, scripts: ['common.js', 'chat.js'] });
  world.document.body.innerHTML = pageHtml(loop).match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  world.run(clientSlice());
  world.run('renderRunTranscripts(); initRunToggles();');
  const run = world.document.querySelector('[data-testid="session-run"]');
  const tx = world.document.querySelector('[data-testid="session-run-transcript"]');
  return { world, run, tx };
}

const ownBubbles = (tx) => tx.children.filter((li) => li.getAttribute('data-testid') === 'session-transcript-entry');
const threads = (tx) => tx.children.filter((li) => li.getAttribute('data-testid') === 'session-agent-thread');
const threadEntries = (thread) => thread.querySelectorAll('[data-testid="session-agent-transcript-entry"]');
const textOf = (li) => li.querySelector('.sess-tx-msg').textContent;


describe('LIN-4559 run page: each child agent is its own collapsible thread under the run', () => {
  test('a child\'s entries are one thread, placed where its first entry falls, summary naming the agent and its count', () => {
    const { tx } = drawn(loopWith([
      own('Handed the search to an agent.', 1),
      child('a1b2c3', 'Searching lib/.', 2),
      own('Waiting on the agent.', 3),
      child('a1b2c3', '[done] found 3 call sites', 4)
    ]));
    const kids = tx.children.map((li) => li.getAttribute('data-testid'));
    assert.deepEqual(kids, ['session-transcript-entry', 'session-agent-thread', 'session-transcript-entry'], 'own, thread (at its first entry), own');
    const [thread] = threads(tx);
    assert.equal(thread.getAttribute('data-agent'), 'a1b2c3');
    assert.ok(thread.querySelector('details'), 'the thread is a <details>');
    const summary = thread.querySelector('summary');
    assert.match(summary.textContent, /a1b2c3/);
    assert.match(summary.textContent, /2 messages/);
    assert.deepEqual(threadEntries(thread).map(textOf), ['Searching lib/.', '[done] found 3 call sites']);
    assert.deepEqual(ownBubbles(tx).map(textOf), ['Handed the search to an agent.', 'Waiting on the agent.']);
  });

  test('two interleaved agents make two threads, each in its own order, each at its first entry', () => {
    const { tx } = drawn(loopWith([
      child('agent-one', 'one: first', 1),
      child('agent-two', 'two: first', 2),
      own('Both agents are working.', 3),
      child('agent-one', 'one: second', 4),
      child('agent-two', 'two: second', 5),
      child('agent-one', 'one: third', 6)
    ]));
    assert.deepEqual(tx.children.map((li) => li.getAttribute('data-agent') || 'own'), ['agent-one', 'agent-two', 'own']);
    const [one, two] = threads(tx);
    assert.deepEqual(threadEntries(one).map(textOf), ['one: first', 'one: second', 'one: third']);
    assert.deepEqual(threadEntries(two).map(textOf), ['two: first', 'two: second']);
    assert.match(one.querySelector('summary').textContent, /3 messages/);
    assert.match(two.querySelector('summary').textContent, /2 messages/);
  });

  test('a thread is collapsed by default (no `open`), and its summary is the one click that opens it', () => {
    const { tx } = drawn(loopWith([own('Handed off.', 1), child('a1b2c3', 'Searching.', 2)]));
    const details = threads(tx)[0].querySelector('details');
    assert.equal(details.hasAttribute('open'), false);
    assert.equal(details.children[0].tagName.toLowerCase(), 'summary');
  });

  // The page's markdown path is marked + DOMPurify (sanitized HTML), with an escaped-text fallback when DOMPurify is
  // absent (public/common.js `renderMarkdown`). A child's words must take exactly the run's path, whichever applies.
  const HOSTILE = '<img src=x onerror="alert(1)"> and <b>bold</b>';
  const bodyOf = (li) => li.querySelector('.chat-msg__body').innerHTML;

  test('a child\'s text takes the run\'s escaping path: on the fallback, HTML in it is text, as in the run\'s own bubble', () => {
    const { tx } = drawn(loopWith([own(HOSTILE, 1), child('a1b2c3', HOSTILE, 2)]));
    const entry = threadEntries(threads(tx)[0])[0];
    assert.equal(entry.querySelector('img'), null);
    assert.equal(entry.querySelector('b'), null);
    assert.match(textOf(entry), /<img src=x onerror="alert\(1\)"> and <b>bold<\/b>/);
    assert.equal(bodyOf(entry), bodyOf(ownBubbles(tx)[0]), 'the child bubble\'s body is byte for byte the run\'s for the same words');
  });

  test('with the sanitizer present, a child\'s text goes through the same marked + DOMPurify call as the run\'s', () => {
    const calls = [];
    const globals = {
      marked: { parse: (text) => `<p>${text}</p>` },
      DOMPurify: { sanitize: (html, opts) => { calls.push({ html, opts }); return html.replace(/ onerror="[^"]*"/g, ''); } }
    };
    const world = loadWorld({ window: { __HARNESS_MODELS__: harnessModelsBlock(), isPinnedToBottom: () => false }, scripts: ['common.js', 'chat.js'], globals });
    world.document.body.innerHTML = pageHtml(loopWith([own(HOSTILE, 1), child('a1b2c3', HOSTILE, 2)])).match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    world.run(clientSlice());
    world.run('renderRunTranscripts();');
    const tx = world.document.querySelector('[data-testid="session-run-transcript"]');
    assert.equal(calls.length, 2, 'both bubbles were sanitized');
    assert.deepEqual(calls[1], calls[0], 'the child\'s words met the identical sanitize call');
    const entry = threadEntries(threads(tx)[0])[0];
    assert.equal(bodyOf(entry), bodyOf(ownBubbles(tx)[0]));
    assert.equal(bodyOf(entry).includes('onerror'), false);
  });

  test('an agent name is escaped in the summary and the attribute', () => {
    const { tx } = drawn(loopWith([child('a"><b>x</b>', 'hi', 1)]));
    const thread = threads(tx)[0];
    assert.equal(thread.querySelector('summary b'), null);
    assert.equal(thread.getAttribute('data-agent'), 'a"><b>x</b>');
  });

  test('a secret in a child\'s words is masked on arrival, and the page shows it masked', async () => {
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
    const item = await store.addItem('ws', { prompt: 'p', kind: 'implementation', issueIdentifier: 'TEST-1' });
    await store.takeItem(item._id, 'ws', 'tok');
    await store.addFeedback(item._id, 'ws', { message: `found ${FIXTURE_SECRETS.githubPat} in .env`, kind: 'agent-text', agent: 'a1b2c3' }, 'tok');
    const stored = store.historyCollection._docs.find((d) => d._id === item._id).feedback.map((f) => ({ ...f, timestamp: f.timestamp.toISOString() }));
    const { tx } = drawn(loopWith(stored));
    const text = textOf(threadEntries(threads(tx)[0])[0]);
    assert.ok(!text.includes(FIXTURE_SECRETS.githubPat));
    assert.ok(text.includes(MASK));
  });

  test('a child bubble has no in-progress pill (nothing to settle); the run\'s own keep theirs as before', () => {
    const { tx } = drawn(loopWith([own('Working.', 1), child('a1b2c3', '[done] found it', 2)]));
    const childEntry = threadEntries(threads(tx)[0])[0];
    assert.equal(childEntry.innerHTML.includes('in-progress'), false, childEntry.innerHTML);
    assert.equal(ownBubbles(tx)[0].innerHTML.includes('in-progress'), true, 'the run\'s own bubble is unchanged (LIN-2546 is LIN-4560\'s)');
  });

  test('a child\'s [done] is not the run\'s status on the page, nor a bubble in the run\'s own thread', () => {
    const [loop] = pipelineInternal._buildLoops({
      liveItems: [], agentStatusEntries: [], lean: false, now: new Date(T0 + 600000),
      historyItems: [{
        id: 'loop-1', issueIdentifier: 'TEST-1', dispatchedAt: at(0), resolvedAt: at(1), status: 'taken', kind: 'implementation',
        feedback: [own('Handed off.', 1), child('a1b2c3', '[done] found 3 call sites', 2)], sessionId: null, sessionGroupId: null,
        followUpTo: null, promptName: 'implementation', prompt: 'p', issueId: 'uuid-1', issueTitle: 'Seed task', issueUrl: null,
        dispatchedBy: 'tester', target: 'cli', repo: 'LinearViewer', bookkeeping: null, rootItemId: 'loop-1', abort: false, abortTo: null
      }]
    });
    const { run, tx } = drawn({ ...loop, telemetry: null });
    assert.notEqual(run.getAttribute('data-status'), 'done');
    assert.equal(ownBubbles(tx).some((li) => /found 3 call sites/.test(textOf(li))), false);
  });

  test('characterization: a parent with no child entries draws exactly the bubbles it did', () => {
    const { tx } = drawn(loopWith([own('Looked at it.', 1), own('[blocked] which branch?', 2, 'status')]));
    assert.equal(threads(tx).length, 0);
    const bubbles = ownBubbles(tx);
    assert.deepEqual(bubbles.map(textOf), ['Looked at it.', '[blocked] which branch?']);
    assert.deepEqual(bubbles.map((li) => li.className), ['chat-msg sess-run-tx-entry', 'chat-msg sess-run-tx-entry chat-msg--blocked']);
    for (const li of bubbles) assert.equal(li.innerHTML.includes('in-progress'), true);
  });

  test('a click on a thread\'s summary does not collapse the run card', async () => {
    const { run, tx } = drawn(loopWith([own('Handed off.', 1), child('a1b2c3', 'Searching.', 2)]));
    const before = run.classList.contains('sess-run--expanded');
    await clickOn(run, threads(tx)[0].querySelector('summary'));
    assert.equal(run.classList.contains('sess-run--expanded'), before);
  });
});
