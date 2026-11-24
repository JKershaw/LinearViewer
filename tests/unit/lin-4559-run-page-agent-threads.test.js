/**
 * LIN-4559 (LIN-4508 piece D), beat 3: on the run page, each child agent's words are their own collapsible thread under
 * the parent run, one click from it.
 *
 * The run page's transcript is drawn client-side (public/session.js `renderRunTranscripts`) from the `data-feedback`
 * JSON the server embeds (lib/render-session.js `renderTranscript`). These tests drive both halves as they run: the page
 * through `renderSessionPage` (the fixture that builds its run view), then the real `common.js` and `chat.js` in the
 * client world with `session.js`'s toggle-and-transcript slice over the drawn page.
 *
 * Witnessed:
 *   - the server carries each child entry's `agent` and never flags a child's `[blocked]` as the run's;
 *   - a parent with no child entries renders byte for byte as before (the embed and the drawn bubbles);
 *   - each child is one `<details>` thread, placed where its first entry falls in time, its entries in order, the
 *     summary naming the agent and counting its messages; two interleaved children make two threads;
 *   - collapsed by default (the choice: the run's own conversation stays the line a reader follows, and a child can
 *     talk at length; the summary says who and how much, one click opens it);
 *   - a child's text takes the same escaping path as the run's words, and masked text shows as stored;
 *   - a child bubble carries no in-progress pill (it never needs to settle), and a child's `[done]` is neither the
 *     run's status on the page nor a bubble in the run's own thread;
 *   - a click inside a child thread (its summary) does not collapse the run card.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorld, clickOn } from './helpers/client-world.js';
import { renderSessionPageOf } from '../fixtures/cost-read-cores.js';
import { harnessModelsBlock } from '../../lib/model-routing-harnesses.js';
import { __internal as pipelineInternal } from '../../lib/pipeline-loops.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { FIXTURE_SECRETS } from '../fixtures/secret-scan-fixtures.js';
import { MASK } from '../../lib/mask-secrets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_JS_SRC = readFileSync(join(__dirname, '../../public/session.js'), 'utf8');

/** `session.js` from the run toggles through the transcript drawing (the functions the page runs on load for both). */
function clientSlice() {
  const start = SESSION_JS_SRC.indexOf('function toggleRun(');
  const end = SESSION_JS_SRC.indexOf('function initInlineReplies()', start);
  assert.ok(start !== -1 && end !== -1, 'the toggle and transcript functions are found in public/session.js');
  return SESSION_JS_SRC.slice(start, end);
}

const T0 = Date.UTC(2026, 10, 24, 10, 0, 0);
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const own = (message, sec, kind = 'assistant-text') => ({ message, url: null, urlLabel: null, timestamp: at(sec), ...(kind ? { kind } : {}) });
const child = (agent, message, sec) => ({ message, url: null, urlLabel: null, timestamp: at(sec), kind: 'agent-text', agent });

function loopWith(feedback, extra = {}) {
  return {
    loopId: 'loop-1', issueIdentifier: 'TEST-1', issueId: 'uuid-1', issueTitle: 'Seed task', iteration: 1,
    kind: 'implementation', target: 'cli', dispatchedAt: at(0), terminalStatus: null, terminalCompletedAt: null,
    feedback, telemetry: null, ...extra
  };
}

function pageHtml(loop) {
  return renderSessionPageOf({
    session: {
      sessionId: 'run-1', seedIssue: 'TEST-1', tasksTouched: ['TEST-1'], dispatchedAt: at(0), completedAt: null,
      telemetry: { runtime: { ms: 60000 }, metrics: [], producedArtifacts: [] }, loops: [loop]
    },
    sessionId: 'run-1', urlKey: 'ws', issueContext: [], canReply: false
  }, { now: at(600) });
}

/** The embedded `data-feedback` of the run's transcript, as the client reads it. */
function embedded(html) {
  const m = html.match(/data-testid="session-run-transcript" data-feedback="([^"]*)"/);
  assert.ok(m, 'the run has a transcript');
  const unescaped = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(unescaped);
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

// ── The server's embed ─────────────────────────────────────────────────────

describe('LIN-4559 run page: the server embed', () => {
  test('a child entry carries its agent; the run\'s own entries carry none', () => {
    const entries = embedded(pageHtml(loopWith([own('Handed the search to an agent.', 1), child('a1b2c3', 'Searching lib/.', 2)])));
    assert.equal(entries[0].agent, undefined);
    assert.equal(entries[1].agent, 'a1b2c3');
    assert.equal(entries[1].kind, 'agent-text');
  });

  test('a child\'s [blocked] is not flagged as the run\'s block; the run\'s own still is', () => {
    const entries = embedded(pageHtml(loopWith([own('[blocked] which branch?', 1, 'status'), child('a1b2c3', '[blocked] which file?', 2)])));
    assert.equal(entries[0].blocked, true);
    assert.equal(entries[1].blocked, false);
  });

  test('characterization: a parent with no child entries embeds exactly what it did (key set and values)', () => {
    const feedback = [own('Looked at it.', 1), own('[blocked] which branch?', 2, 'status'), own('[done] Task completed', 3, null)];
    const entries = embedded(pageHtml(loopWith(feedback)));
    assert.deepEqual(entries, feedback.map((e) => ({
      message: e.message, url: null, urlLabel: null, timestamp: e.timestamp, blocked: /^\s*\[(blocked|pending)\]/i.test(e.message), kind: e.kind || null
    })));
    for (const e of entries) assert.deepEqual(Object.keys(e), ['message', 'url', 'urlLabel', 'timestamp', 'blocked', 'kind']);
  });
});

// ── The drawn page ─────────────────────────────────────────────────────────

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

// ── Phone width and the theme ──────────────────────────────────────────────

describe('LIN-4559 run page: the thread at 390px and in dark mode (stylesheet)', () => {
  const css = readFileSync(join(__dirname, '../../public/session.css'), 'utf8');
  const rule = (selector) => {
    const m = css.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    return m ? m[2] : null;
  };

  test('the inner thread does not scroll on its own: it outranks the shared .chat-thread (chat.css loads after this sheet)', () => {
    const body = rule('.sess-agent-thread__tx.chat-thread');
    assert.ok(body, 'the inner thread\'s rule carries both classes, so it beats `.chat-thread` whatever the load order');
    assert.match(body, /--chat-thread-max-height:\s*none/);
    assert.match(body, /overflow-y:\s*visible/);
  });

  test('the thread and its summary wrap long unbroken text and never widen the page', () => {
    for (const sel of ['.sess-agent-thread', '.sess-agent-thread__summary']) {
      const body = rule(sel);
      assert.ok(body, `${sel} has a rule in public/session.css`);
      assert.match(body, /overflow-wrap:\s*anywhere/, `${sel} wraps long unbroken text`);
      assert.match(body, /min-width:\s*0/, `${sel} may shrink below its content`);
    }
  });

  test('colours come from the theme tokens, never a literal colour (dark mode is a token override)', () => {
    const bodies = ['.sess-agent-thread', '.sess-agent-thread__summary', '.sess-agent-thread__tx.chat-thread'].map(rule).join('\n');
    assert.match(bodies, /var\(--/);
    assert.doesNotMatch(bodies, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
