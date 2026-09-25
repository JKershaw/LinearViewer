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
 * `FEEDBACK_ENTRY_KINDS` (lib/dispatch-store.js:101 —
 * `['status','recap','heartbeat','evidence','assistant-text','tool','usage',
 * 'resources','refusal','decision']`), which deliberately excludes
 * `decision-answer` (see lib/dispatch-store.js:95, lib/observer-efficacy-
 * signal.js:125) and does not (yet) include the two withdrawal kinds either
 * — an out-of-whitelist `kind` is silently dropped, not stored. The existing
 * e2e test instead uses the durable comment route's `markDecisionAnswered`
 * write path (`POST /workspace/:urlKey/api/comments/LIN-1728`), which is
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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
