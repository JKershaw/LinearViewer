/**
 * LIN-4560 (LIN-4508 piece E): the one transcript look. lib/transcript.js draws a run's transcript wherever it appears
 * (the run page, public/session.js, and Dispatch history, public/dispatch.js) from the server's transcript entries
 * (lib/dispatch-transcript.js). This suite holds:
 *   - the server's entries: masked at render time (a row stored before intake masking), `blocked`, `waiting` and `quiet`;
 *   - the leaf's look: order, the quiet lines left out, waiting read as waiting, a thread per child agent, the in-progress
 *     pill only on a live run's newest own bubble, http(s)-only links, times in words;
 *   - the same fixture drawn through the run page and through Dispatch history: identical items.
 *
 * The leaf is pure, so it is drawn here with the server's own pill and surface (lib/components; common.js's are their
 * replicas, pinned by tests/unit/segment-bar-pill-parity.test.js). The pages are imported over the fake DOM
 * (tests/unit/helpers/import-world.js) with the same host stubbed as the window.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4560-transcript.test.js
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderTranscript, transcriptParts, transcriptTime } from '../../lib/transcript.js';
import { historyTranscriptFeedback, transcriptEntries, transcriptEntry } from '../../lib/dispatch-transcript.js';
import { formatFeedbackEntries } from '../../lib/dispatch-feedback-format.js';
import { renderStatusPill } from '../../lib/components/status-pill.js';
import { renderSurface } from '../../lib/components/surface.js';
import { relativeAgo } from '../../lib/time-words.js';
import { MASK } from '../../lib/mask-secrets.js';
import { FIXTURE_SECRETS } from '../fixtures/secret-scan-fixtures.js';
import { importWorld } from './helpers/import-world.js';
import { createFakeDom } from './helpers/fake-dom.js';
import { pageHtml, loopWith } from '../fixtures/lin-4559-run-page.js';

const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const say = (message, min, kind = 'assistant-text', extra = {}) => ({ message, url: null, urlLabel: null, timestamp: ago(min), kind, ...extra });
const kid = (agent, message, min) => ({ message, url: null, urlLabel: null, timestamp: ago(min), kind: 'agent-text', agent });

const HOST = { renderStatusPill, renderSurface, formatLocalTime: () => '10:49 PM GMT' };
const draw = (feedback, opts = {}) => renderTranscript(transcriptEntries(feedback), { host: HOST, relative: relativeAgo, ...opts });

/** The drawn items as elements of a fake document's list. */
function items(html) {
  const { document } = createFakeDom();
  const ul = document.createElement('ul');
  ul.innerHTML = html;
  return ul;
}
const testIds = (ul) => ul.children.map((li) => li.getAttribute('data-testid'));
const inProgress = (ul) => ul.querySelectorAll('.status-pill--in-progress');

describe('the server\'s transcript entries (lib/dispatch-transcript.js)', () => {
  test('a secret in a row stored before intake masking is masked at render time, in the message, URL and label', () => {
    const [entry] = transcriptEntries([{ message: `token ${FIXTURE_SECRETS.githubPat} here`, url: `https://example.com/?t=${FIXTURE_SECRETS.githubPat}`, urlLabel: FIXTURE_SECRETS.githubPat, timestamp: ago(1) }]);
    for (const field of ['message', 'url', 'urlLabel']) {
      assert.ok(!entry[field].includes(FIXTURE_SECRETS.githubPat), field);
      assert.ok(entry[field].includes(MASK), field);
    }
  });

  test('a run\'s ordinary entry keeps the embed\'s key set; agent, waiting and quiet are sparse', () => {
    assert.deepEqual(Object.keys(transcriptEntry(say('Looked at it.', 1))), ['message', 'url', 'urlLabel', 'timestamp', 'blocked', 'kind']);
    assert.equal(transcriptEntry({ message: 'x', timestamp: new Date(NOW) }).timestamp, new Date(NOW).toISOString(), 'a stored Date reads as its ISO string');
  });

  test('a wait line of the run\'s own reads as waiting, naming what it waits on (the one wait reader, LIN-4558)', () => {
    const named = transcriptEntry(say('[waiting] waiting on the review agent · 4m · next heartbeat in ≤5m', 1, 'heartbeat'));
    assert.deepEqual(named.waiting, { what: 'the review agent' });
    assert.equal(named.quiet, undefined, 'a waiting heartbeat is drawn, as waiting');
    assert.deepEqual(transcriptEntry(say('[pending] need your answer', 1, 'status')).waiting, { what: null });
    assert.equal(transcriptEntry(kid('a1', '[pending] waiting on lib/', 1)).waiting, undefined, 'a child\'s words are never the run\'s wait');
  });

  test('relays, stamps, [ticket] markers and heartbeats that are not waits are quiet; the run\'s words are not', () => {
    const quiet = [
      say('{"inputTokens":3}', 1, 'usage'), say('rss 200MB', 1, 'resources'), say('Bash: ls', 1, 'tool'),
      say('{"decision_id":"d-1"}', 1, 'decision-answer'), say('[usage] {"costUsd":5}', 1, null),
      say('[ticket] LIN-901 Done — landed', 1, null), say('[working · implementing] 12 tools in 3m', 1, 'heartbeat'),
      say('[working] 4 tools in 2m · Bash×4', 1, null),
    ];
    for (const f of quiet) assert.equal(transcriptEntry(f).quiet, true, f.message);
    // A stamp is quiet whatever its text says: a withdrawal's reason naming a "scheduled wakeup" is no wait line.
    const stamp = transcriptEntry(say('{"decision_id":"d-1","reason":"scheduled wakeup, re-raise later"}', 1, 'decision-withdrawn'));
    assert.equal(stamp.quiet, true);
    assert.equal(stamp.waiting, undefined);
    for (const f of [say('Opened the PR.', 1), say('[done] landed', 1, 'status'), say('an untagged line', 1, null), kid('a1', 'Searching.', 1)]) {
      assert.equal(transcriptEntry(f).quiet, undefined, f.message);
    }
  });

  test('the history read\'s shape is additive: the formatter\'s keys kept (no kind: null), fields masked, facts sparse', () => {
    const formatted = formatFeedbackEntries([
      { message: 'untagged', timestamp: new Date(NOW), rootItemId: 'root-1' },
      { message: `token ${FIXTURE_SECRETS.githubPat}`, timestamp: new Date(NOW), kind: 'assistant-text' },
      { message: '[blocked] which branch?', timestamp: new Date(NOW), kind: 'status' },
      { message: '{"inputTokens":3}', timestamp: new Date(NOW), kind: 'usage' },
      { message: '[pending] need your answer', timestamp: new Date(NOW), kind: 'status' },
    ]);
    const [plain, secret, blocked, usage, pending] = historyTranscriptFeedback(formatted);
    assert.deepEqual(plain, formatted[0], 'a clean untagged entry is the formatter\'s entry, unchanged');
    assert.equal('kind' in plain, false);
    assert.ok(secret.message.includes(MASK) && !secret.message.includes(FIXTURE_SECRETS.githubPat));
    assert.deepEqual(Object.keys(secret), Object.keys(formatted[1]));
    assert.equal(blocked.blocked, true);
    assert.equal(usage.quiet, true);
    assert.deepEqual(pending.waiting, { what: null });
  });

  test('blocked: the run\'s own [blocked], never a child\'s', () => {
    assert.equal(transcriptEntry(say('[blocked] which branch?', 1, 'status')).blocked, true);
    assert.equal(transcriptEntry(kid('a1', '[blocked] which file?', 1)).blocked, false);
  });
});

describe('the one transcript look (lib/transcript.js)', () => {
  test('entries keep their stored order, quiet lines are left out, a wait line is a waiting note, never a bubble', () => {
    const ul = items(draw([
      say('one', 5), say('{"inputTokens":3}', 5, 'usage'), say('two', 4),
      say('[waiting] waiting on the review agent · 4m · next heartbeat in ≤5m', 3, 'heartbeat'),
      say('[working · implementing] 12 tools in 3m', 2, 'heartbeat'), say('three', 1),
    ]));
    assert.deepEqual(testIds(ul), ['transcript-entry', 'transcript-entry', 'transcript-waiting', 'transcript-entry']);
    assert.deepEqual(ul.querySelectorAll('.sess-tx-msg').map((el) => el.textContent), ['one', 'two', 'three']);
    const note = ul.querySelector('[data-testid="transcript-waiting"]');
    assert.match(note.textContent, /^waiting on the review agent · 3 minutes ago · 10:49 PM GMT$/);
    assert.equal(note.querySelector('.chat-msg__who'), null, 'a waiting note has no speaker pill');
  });

  test('a finished run draws no in-progress marker at all; a live run only on its newest own bubble', () => {
    const feedback = [say('one', 3), say('two', 2), kid('a1', 'Searching.', 1)];
    assert.equal(inProgress(items(draw(feedback, { live: false }))).length, 0);
    assert.equal(draw(feedback, { live: false }).includes('in-progress'), false);
    const live = items(draw(feedback, { live: true }));
    const bubbles = live.children.filter((li) => li.getAttribute('data-testid') === 'transcript-entry');
    assert.equal(inProgress(live).length, 1, 'one marker, and never on a child bubble');
    assert.ok(bubbles[1].querySelector('.status-pill--in-progress'), 'on the newest own bubble');
    assert.equal(bubbles[0].querySelector('.status-pill--in-progress'), null);
  });

  test('a live run whose newest own entry is a wait line has no in-progress bubble', () => {
    const ul = items(draw([say('one', 2), say('[pending] need your answer', 1, 'status')], { live: true }));
    assert.equal(inProgress(ul).length, 0);
  });

  test('a child agent\'s words are one collapsed thread at its first entry, its summary naming the child and its count', () => {
    const ul = items(draw([say('Handed off.', 6), kid('one', 'one: first', 5), kid('two', 'two: first', 4), say('Both working.', 3), kid('one', 'one: second', 2)]));
    assert.deepEqual(ul.children.map((li) => li.getAttribute('data-agent') || li.getAttribute('data-testid')), ['transcript-entry', 'one', 'two', 'transcript-entry']);
    const [one, two] = ul.querySelectorAll('[data-testid="transcript-agent-thread"]');
    assert.equal(one.querySelector('details').hasAttribute('open'), false);
    assert.match(one.querySelector('summary').textContent, /child agent one · 2 messages/);
    assert.match(two.querySelector('summary').textContent, /· 1 message$/);
    assert.deepEqual(one.querySelectorAll('[data-testid="transcript-agent-entry"]').map((li) => li.querySelector('.sess-tx-msg').textContent), ['one: first', 'one: second']);
  });

  test('an agent name is escaped in the summary and the attribute', () => {
    const ul = items(draw([kid('a"><b>x</b>', 'hi', 1)]));
    const thread = ul.querySelector('[data-testid="transcript-agent-thread"]');
    assert.equal(thread.querySelector('summary b'), null);
    assert.equal(thread.getAttribute('data-agent'), 'a"><b>x</b>');
  });

  test('a link only for an http(s) URL, escaped, with its label or "link"', () => {
    const ul = items(draw([
      say('labelled', 3, 'evidence', { url: 'https://example.com/pr/1?a=1&b="2"', urlLabel: 'PR <1>' }),
      say('bare', 2, 'evidence', { url: 'http://example.com/x' }),
      say('scripted', 1, 'evidence', { url: 'javascript:alert(1)', urlLabel: 'click' }),
    ]));
    const links = ul.querySelectorAll('[data-testid="transcript-link"]');
    assert.equal(links.length, 2);
    assert.equal(links[0].getAttribute('href'), 'https://example.com/pr/1?a=1&b="2"');
    assert.equal(links[0].textContent, 'PR <1>');
    assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer');
    assert.equal(links[1].textContent, 'link');
    assert.ok(!draw([say('scripted', 1, 'evidence', { url: 'javascript:alert(1)' })]).includes('javascript:'));
  });

  test('without renderMarkdown the message is escaped text; with it, the body is the host\'s render', () => {
    const plain = items(draw([say('<img src=x onerror="alert(1)"> **b**', 1)]));
    assert.equal(plain.querySelector('img'), null);
    assert.equal(plain.querySelector('.sess-tx-msg').textContent, '<img src=x onerror="alert(1)"> **b**');
    const calls = [];
    const rendered = renderTranscript(transcriptEntries([say('**b**', 1)]), { host: { ...HOST, renderMarkdown: (t, o) => { calls.push([t, o]); return '<strong>b</strong>'; } } });
    assert.deepEqual(calls, [['**b**', { breaks: true }]]);
    assert.ok(rendered.includes('<span class="sess-tx-msg markdown-content chat-md"><strong>b</strong></span>'));
  });

  test('a time reads in words, the relative words then the exact local time, never the raw ISO stamp', () => {
    assert.equal(transcriptTime(ago(5), { host: HOST, relative: relativeAgo }), '5 minutes ago · 10:49 PM GMT');
    assert.equal(transcriptTime(ago(5), {}), '', 'neither helper: no time, never the stamp');
    assert.doesNotMatch(draw([say('x', 5)]), /\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  test('nothing drawn when nothing is said: no feedback, or only quiet lines', () => {
    assert.equal(draw([]), '');
    assert.equal(draw([say('{"decision_id":"d-1"}', 1, 'decision-answer')]), '');
    assert.deepEqual(transcriptParts(null), []);
  });
});

// ── The same fixture on both pages ────────────────────────────────────────────────────────────────────────────────────

let world = null;
afterEach(() => { if (world) world.restore(); world = null; });

describe('the same fixture renders identically on the run page and in Dispatch history', () => {
  const FEEDBACK = [
    say('Looked at the module pages.', 9),
    say('{"inputTokens":3}', 9, 'usage'),
    kid('a1b2c3', 'Searching lib/.', 8),
    say(`Found ${FIXTURE_SECRETS.githubPat} in .env`, 7, 'assistant-text'),
    say('[waiting] waiting on the review agent · 4m · next heartbeat in ≤5m', 6, 'heartbeat'),
    kid('a1b2c3', '[done] found 3 call sites', 5),
    say('opened the PR', 4, 'evidence', { url: 'https://example.com/pr/1', urlLabel: 'PR #1' }),
    say('{"decision_id":"d-1"}', 3, 'decision-answer'),
    say('[done] landed', 2, 'status'),
  ];

  async function bothPages(live) {
    world = importWorld({ window: { ...HOST, QuestionCards: {}, addEventListener() {}, escapeHtml: (s) => String(s), relativeTime: () => '', taskPageHref: () => null } });
    // The run page: the server's page for one run, drawn by session.js.
    const loop = loopWith(FEEDBACK, live ? {} : { terminalStatus: 'done', terminalCompletedAt: ago(1) });
    world.document.body.innerHTML = pageHtml(loop).match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    const session = await world.importPage('session.js');
    session.renderRunTranscripts();
    const runItems = world.document.querySelector('[data-testid="session-run-transcript"]').innerHTML;
    // Dispatch history: the history read's row (its feedback as the server's entries), drawn by dispatch.js.
    const dispatch = await world.importPage('dispatch.js');
    const container = world.document.createElement('div');
    world.document.body.appendChild(container);
    const item = { id: 'loop-1', status: 'taken', outcome: live ? 'taken' : 'done', promptName: 'implementation', dispatchedAt: ago(10), resolvedAt: ago(1), feedback: historyTranscriptFeedback(formatFeedbackEntries(FEEDBACK)) };
    dispatch.renderDispatchHistoryList(container, [item], 1, 0, 'ws');
    const historyItems = container.querySelector('[data-testid="history-transcript"]').innerHTML;
    return { runItems, historyItems };
  }

  test('a finished run: the same items on both pages, with no in-progress marker, the secret masked, the child threaded', async () => {
    const { runItems, historyItems } = await bothPages(false);
    assert.equal(historyItems, runItems);
    assert.equal(runItems.includes('in-progress'), false);
    assert.ok(!runItems.includes(FIXTURE_SECRETS.githubPat) && runItems.includes(MASK));
    assert.equal((runItems.match(/data-testid="transcript-agent-thread"/g) || []).length, 1);
    assert.equal(runItems.includes('decision_id') || runItems.includes('inputTokens'), false);
  });

  test('a live run: the same items on both pages, one in-progress marker', async () => {
    const { runItems, historyItems } = await bothPages(true);
    assert.equal(historyItems, runItems);
    assert.equal((runItems.match(/status-pill--in-progress/g) || []).length, 1);
  });
});
