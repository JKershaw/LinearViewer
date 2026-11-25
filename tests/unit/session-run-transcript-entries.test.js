/**
 * LIN-1728 Phase 2 (Revision 3, F6) / LIN-3037 — the run page's transcript must not render a decision-lifecycle stamp
 * (`decision-answer`, `decision-withdrawn`, `decision-withdrawal-reversed`) as a bare `{"decision_id":...}` (or, for a
 * withdrawal, its raw free-text `reason`) agent chat bubble.
 *
 * `decision-answer` is also covered end to end by tests/e2e/session-page.spec.js ("a decision-answer stamp in a run's
 * transcript never renders as a chat bubble"), seeded through the history seam (POST /test/seed-history-feedback,
 * LIN-4541: no route writes the stamp kinds now). The two withdrawal kinds have no write path at all, so this unit
 * harness is where they are driven.
 *
 * LIN-4560: the page is a native ES module that draws each run's transcript through the one transcript look
 * (lib/transcript.js) from the server's transcript entries (lib/dispatch-transcript.js, which marks a stamp `quiet`).
 * So this suite draws the page as the server renders it (renderSessionPage), with the real common.js run first in the
 * same realm (tests/unit/helpers/import-world.js) and session.js imported over it: the shipped server half, leaf and page
 * together, never a source slice. Until LIN-4560 it ran slices of the classic script in a vm.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/session-run-transcript-entries.test.js
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clickOn } from './helpers/client-world.js';
import { importWorld } from './helpers/import-world.js';
import { harnessModelsBlock } from '../../lib/model-routing-harnesses.js';
import { __internal as pipelineInternal } from '../../lib/pipeline-loops.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { FIXTURE_SECRETS } from '../fixtures/secret-scan-fixtures.js';
import { MASK } from '../../lib/mask-secrets.js';
import { T0, at, own, child, loopWith, pageHtml } from '../fixtures/lin-4559-run-page.js';

let world = null;
afterEach(() => { if (world) world.restore(); world = null; });

/**
 * The run page drawn: the server's page for `loop`, the real common.js (the transcript's host: renderMarkdown,
 * renderStatusPill, renderSurface, formatLocalTime), then session.js imported, its transcripts drawn and its run toggles
 * bound. `globals` are installed before common.js runs (marked, DOMPurify); `after` runs once common.js has, as a later
 * page script would override it.
 */
async function drawn(loop, { globals = {}, after = null } = {}) {
  world = importWorld({
    window: { __HARNESS_MODELS__: harnessModelsBlock(), isPinnedToBottom: () => false, QuestionCards: {}, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} },
    globals: { localStorage: { getItem: () => null, setItem() {} }, setInterval: () => 0, clearInterval() {}, ...globals },
  });
  world.runClassic('common.js');
  if (after) after(world.window);
  world.document.body.innerHTML = pageHtml(loop).match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  const page = await world.importPage('session.js');
  page.renderRunTranscripts();
  page.initRunToggles();
  const run = world.document.querySelector('[data-testid="session-run"]');
  const tx = world.document.querySelector('[data-testid="session-run-transcript"]');
  return { world, run, tx };
}

const ownBubbles = (tx) => tx.children.filter((li) => li.getAttribute('data-testid') === 'transcript-entry');
const threads = (tx) => tx.children.filter((li) => li.getAttribute('data-testid') === 'transcript-agent-thread');
const threadEntries = (thread) => thread.querySelectorAll('[data-testid="transcript-agent-entry"]');
const textOf = (li) => li.querySelector('.sess-tx-msg').textContent;
const stamp = (kind, message, sec) => ({ message, url: null, urlLabel: null, timestamp: at(sec), kind });

test('the run page leaves out a decision-answer entry, keeping real chat entries', async () => {
  const { tx } = await drawn(loopWith([own('a real chat line', 1), stamp('decision-answer', '{"decision_id":"d-1"}', 2), own('another real line', 3)]));
  assert.deepEqual(ownBubbles(tx).map(textOf), ['a real chat line', 'another real line']);
  assert.ok(!tx.innerHTML.includes('decision_id'), 'the stamp never renders as a bare JSON bubble');
});

test('the run page leaves out a decision-withdrawn entry, keeping real chat entries (LIN-3037)', async () => {
  const { tx } = await drawn(loopWith([own('a real chat line', 1), stamp('decision-withdrawn', '{"decision_id":"d-1","reason":"scheduled wakeup, re-raise later"}', 2), own('another real line', 3)]));
  assert.deepEqual(ownBubbles(tx).map(textOf), ['a real chat line', 'another real line']);
  assert.ok(!tx.innerHTML.includes('decision_id'), 'the stamp never renders as a bare JSON bubble');
  assert.ok(!tx.innerHTML.includes('scheduled wakeup'), "the withdrawal's reason never renders, as a bubble or as a waiting note");
});

test('the run page leaves out a decision-withdrawal-reversed entry, keeping real chat entries (LIN-3037)', async () => {
  const { tx } = await drawn(loopWith([own('a real chat line', 1), stamp('decision-withdrawal-reversed', '{"decision_id":"d-1"}', 2), own('another real line', 3)]));
  assert.deepEqual(ownBubbles(tx).map(textOf), ['a real chat line', 'another real line']);
  assert.ok(!tx.innerHTML.includes('decision_id'), 'the stamp never renders as a bare JSON bubble');
});

test('the run page draws nothing when only a decision-withdrawn entry is present', async () => {
  const { tx } = await drawn(loopWith([stamp('decision-withdrawn', '{"decision_id":"d-1","reason":"unrelated"}', 1)]));
  assert.equal(tx.children.length, 0);
});

test('the run page is unchanged for feedback with no decision-lifecycle stamps (regression pin)', async () => {
  const { tx } = await drawn(loopWith([{ ...own('opened the pull request', 1), url: 'https://example.com/pr/1', urlLabel: 'PR #1' }]));
  assert.equal(ownBubbles(tx).length, 1);
  assert.match(ownBubbles(tx)[0].innerHTML, /opened the pull request/);
  assert.match(ownBubbles(tx)[0].innerHTML, /PR #1/);
});

// LIN-4555 (the walk): a transcript bubble printed its entry's raw ISO stamp (`2026-11-24T22:55:27.978Z`) beside the message once a
// step was opened on the run page, one of the six surfaces where nothing a person reads is an ISO time. It reads as the rest of the
// product's times do: relative words, then the exact local time (the Runs card's "updated just now · 10:49 PM GMT"). LIN-4560: the
// relative words are lib/time-words.js `relativeAgo` (the server's own words, which the page imports), the exact time common.js's.
test('a bubble\'s time reads in words, never as the raw ISO stamp (LIN-4555, LIN-4560)', async () => {
  const fiveAgo = new Date(Date.now() - 5 * 60000).toISOString();
  const { tx } = await drawn(loopWith([{ ...own('opened the pull request', 1), timestamp: fiveAgo }]), {
    after: (w) => { w.formatLocalTime = (iso, opts) => (iso === fiveAgo && opts?.zone ? '10:49 PM GMT' : null); },
  });
  assert.equal(ownBubbles(tx)[0].querySelector('.chat-msg__time').textContent, '5 minutes ago · 10:49 PM GMT');
  assert.doesNotMatch(tx.innerHTML, /\d{4}-\d{2}-\d{2}T\d{2}:/);
});

// ── LIN-4559: each child agent is its own collapsible thread under the run (the drawn page) ──────────────────────
// The server half and the stylesheet are in tests/unit/lin-4559-run-page-agent-threads.test.js. Here the page as the
// server renders it is drawn (`drawn`, above). Collapsed by default: the run's own conversation stays the line a reader
// follows; the summary says who and how much, one click opens it. LIN-4560: the thread is the one transcript look's
// (lib/transcript.js), which Dispatch history draws too.

describe('LIN-4559 run page: each child agent is its own collapsible thread under the run', () => {
  test('a child\'s entries are one thread, placed where its first entry falls, summary naming the agent and its count', async () => {
    const { tx } = await drawn(loopWith([
      own('Handed the search to an agent.', 1),
      child('a1b2c3', 'Searching lib/.', 2),
      own('Waiting on the agent.', 3),
      child('a1b2c3', '[done] found 3 call sites', 4)
    ]));
    const kids = tx.children.map((li) => li.getAttribute('data-testid'));
    assert.deepEqual(kids, ['transcript-entry', 'transcript-agent-thread', 'transcript-entry'], 'own, thread (at its first entry), own');
    const [thread] = threads(tx);
    assert.equal(thread.getAttribute('data-agent'), 'a1b2c3');
    assert.ok(thread.querySelector('details'), 'the thread is a <details>');
    const summary = thread.querySelector('summary');
    assert.match(summary.textContent, /a1b2c3/);
    assert.match(summary.textContent, /2 messages/);
    assert.deepEqual(threadEntries(thread).map(textOf), ['Searching lib/.', '[done] found 3 call sites']);
    assert.deepEqual(ownBubbles(tx).map(textOf), ['Handed the search to an agent.', 'Waiting on the agent.']);
  });

  test('two interleaved agents make two threads, each in its own order, each at its first entry', async () => {
    const { tx } = await drawn(loopWith([
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

  test('a thread is collapsed by default (no `open`), and its summary is the one click that opens it', async () => {
    const { tx } = await drawn(loopWith([own('Handed off.', 1), child('a1b2c3', 'Searching.', 2)]));
    const details = threads(tx)[0].querySelector('details');
    assert.equal(details.hasAttribute('open'), false);
    assert.equal(details.children[0].tagName.toLowerCase(), 'summary');
  });

  // The page's markdown path is marked + DOMPurify (sanitized HTML), with an escaped-text fallback when DOMPurify is
  // absent (public/common.js `renderMarkdown`). A child's words must take exactly the run's path, whichever applies.
  const HOSTILE = '<img src=x onerror="alert(1)"> and <b>bold</b>';
  const bodyOf = (li) => li.querySelector('.chat-msg__body').innerHTML;

  test('a child\'s text takes the run\'s escaping path: on the fallback, HTML in it is text, as in the run\'s own bubble', async () => {
    const { tx } = await drawn(loopWith([own(HOSTILE, 1), child('a1b2c3', HOSTILE, 2)]));
    const entry = threadEntries(threads(tx)[0])[0];
    assert.equal(entry.querySelector('img'), null);
    assert.equal(entry.querySelector('b'), null);
    assert.match(textOf(entry), /<img src=x onerror="alert\(1\)"> and <b>bold<\/b>/);
    assert.equal(bodyOf(entry), bodyOf(ownBubbles(tx)[0]), 'the child bubble\'s body is byte for byte the run\'s for the same words');
  });

  test('with the sanitizer present, a child\'s text goes through the same marked + DOMPurify call as the run\'s', async () => {
    const calls = [];
    const globals = {
      marked: { parse: (text) => `<p>${text}</p>` },
      DOMPurify: { sanitize: (html, opts) => { calls.push({ html, opts }); return html.replace(/ onerror="[^"]*"/g, ''); } }
    };
    const { tx } = await drawn(loopWith([own(HOSTILE, 1), child('a1b2c3', HOSTILE, 2)]), { globals });
    assert.equal(calls.length, 2, 'both bubbles were sanitized');
    assert.deepEqual(calls[1], calls[0], 'the child\'s words met the identical sanitize call');
    const entry = threadEntries(threads(tx)[0])[0];
    assert.equal(bodyOf(entry), bodyOf(ownBubbles(tx)[0]));
    assert.equal(bodyOf(entry).includes('onerror'), false);
  });

  test('an agent name is escaped in the summary and the attribute', async () => {
    const { tx } = await drawn(loopWith([child('a"><b>x</b>', 'hi', 1)]));
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
    const { tx } = await drawn(loopWith(stored));
    const text = textOf(threadEntries(threads(tx)[0])[0]);
    assert.ok(!text.includes(FIXTURE_SECRETS.githubPat));
    assert.ok(text.includes(MASK));
  });

  // LIN-4555 (the walk): the child bubble is built by the same appendMessage call shape as the run's own, and must read its
  // time as the product does (relative words, then the exact local time), never the raw ISO stamp the entry carries.
  test('a child bubble\'s time reads in words, never as the raw ISO stamp (LIN-4555)', async () => {
    const { tx } = await drawn(loopWith([own('Handed off.', 1), child('a1b2c3', 'Searching.', 2)]));
    const entry = threadEntries(threads(tx)[0])[0];
    const time = entry.querySelector('.chat-msg__time');
    assert.ok(time, 'the child bubble shows a time');
    assert.ok(time.textContent.length > 0);
    assert.doesNotMatch(time.textContent, /\d{4}-\d{2}-\d{2}T/);
    assert.doesNotMatch(entry.innerHTML, /\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  test('a child bubble has no in-progress pill (nothing to settle); the run\'s own keep theirs as before', async () => {
    const { tx } = await drawn(loopWith([own('Working.', 1), child('a1b2c3', '[done] found it', 2)]));
    const childEntry = threadEntries(threads(tx)[0])[0];
    assert.equal(childEntry.innerHTML.includes('in-progress'), false, childEntry.innerHTML);
    assert.equal(ownBubbles(tx)[0].innerHTML.includes('in-progress'), true, 'the live run\'s newest own bubble is in progress (LIN-2546, LIN-4560)');
  });

  test('a child\'s [done] is not the run\'s status on the page, nor a bubble in the run\'s own thread', async () => {
    const [loop] = pipelineInternal._buildLoops({
      liveItems: [], agentStatusEntries: [], lean: false, now: new Date(T0 + 600000),
      historyItems: [{
        id: 'loop-1', issueIdentifier: 'TEST-1', dispatchedAt: at(0), resolvedAt: at(1), status: 'taken', kind: 'implementation',
        feedback: [own('Handed off.', 1), child('a1b2c3', '[done] found 3 call sites', 2)], sessionId: null, sessionGroupId: null,
        followUpTo: null, promptName: 'implementation', prompt: 'p', issueId: 'uuid-1', issueTitle: 'Seed task', issueUrl: null,
        dispatchedBy: 'tester', target: 'cli', repo: 'LinearViewer', bookkeeping: null, rootItemId: 'loop-1', abort: false, abortTo: null
      }]
    });
    const { run, tx } = await drawn({ ...loop, telemetry: null });
    assert.notEqual(run.getAttribute('data-status'), 'done');
    assert.equal(ownBubbles(tx).some((li) => /found 3 call sites/.test(textOf(li))), false);
  });

  test('characterization: a parent with no child entries draws exactly the bubbles it did', async () => {
    const { tx } = await drawn(loopWith([own('Looked at it.', 1), own('[blocked] which branch?', 2, 'status')]));
    assert.equal(threads(tx).length, 0);
    const bubbles = ownBubbles(tx);
    assert.deepEqual(bubbles.map(textOf), ['Looked at it.', '[blocked] which branch?']);
    assert.deepEqual(bubbles.map((li) => li.className), ['chat-msg sess-run-tx-entry', 'chat-msg sess-run-tx-entry chat-msg--blocked']);
    // LIN-2546 (LIN-4560): the run is live, so its newest own bubble alone is in progress; the earlier one has settled.
    // Until LIN-4560 every bubble carried the pill.
    assert.deepEqual(bubbles.map((li) => li.innerHTML.includes('in-progress')), [false, true]);
  });

  test('a click on a thread\'s summary does not collapse the run card', async () => {
    const { run, tx } = await drawn(loopWith([own('Handed off.', 1), child('a1b2c3', 'Searching.', 2)]));
    const before = run.classList.contains('sess-run--expanded');
    await clickOn(run, threads(tx)[0].querySelector('summary'));
    assert.equal(run.classList.contains('sess-run--expanded'), before);
  });
});

// ── LIN-4560: characterization of the run page's transcript, before the shared transcript module replaces it ──────────
// What the shared module must keep from this renderer (beat 1 of LIN-4560, written against the classic script before the
// page became a module): the run's own entries in stored order, the evidence link escaped with its label, and a run with
// no feedback drawing no transcript at all. The label fallback moved to Dispatch's "link" in the one look (beat 2).
describe('LIN-4560 characterization: the run page transcript as the classic renderer drew it', () => {
  test('the run\'s own entries keep their stored order', async () => {
    const { tx } = await drawn(loopWith([own('one', 1), own('two', 2), own('three', 3, 'status'), own('four', 4)]));
    assert.deepEqual(ownBubbles(tx).map(textOf), ['one', 'two', 'three', 'four']);
  });

  // LIN-4560: a link with no label reads "link", Dispatch history's word, in the one look (the run page showed the URL).
  test('an evidence link is escaped and carries its label, or "link" when it has none', async () => {
    const { tx } = await drawn(loopWith([
      { ...own('opened the PR', 1), url: 'https://example.com/pr/1?a=1&b="2"', urlLabel: 'PR <1>' },
      { ...own('pushed', 2), url: 'https://example.com/commit/abc' }
    ]));
    const [labelled, bare] = ownBubbles(tx).map((li) => li.querySelector('[data-testid="transcript-link"]'));
    assert.equal(labelled.getAttribute('href'), 'https://example.com/pr/1?a=1&b="2"');
    assert.equal(labelled.textContent, 'PR <1>');
    assert.equal(labelled.getAttribute('target'), '_blank');
    assert.equal(labelled.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(bare.textContent, 'link');
    assert.equal(bare.getAttribute('href'), 'https://example.com/commit/abc');
  });

  test('a run with no feedback draws no transcript', async () => {
    const html = pageHtml(loopWith([]));
    assert.equal(html.includes('data-testid="session-run-transcript"'), false);
  });
});
