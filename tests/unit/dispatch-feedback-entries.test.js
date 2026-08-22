/**
 * LIN-2205 (LIN-1728 F6 follow-up) — `public/dispatch.js`'s
 * `renderFeedbackEntries` must not render a `decision-answer` stamp as a
 * bare `{"decision_id":...}` feedback line on the Dispatch page's history
 * list. `_formatFeedbackEntries` (lib/dispatch-store.js) carries `kind`
 * through additively, so the fix is a client-side filter here.
 *
 * `renderFeedbackEntries` is a bare top-level function in public/dispatch.js
 * (not exported), so this vm-sandboxes just that function's own source slice
 * with minimal stubs for its two free-variable dependencies
 * (`escapeHtml`/`formatDispatchTime`, both provided by common.js/dispatch.js
 * itself at runtime) — same targeted-extraction technique the DOM-free check
 * in tests/unit/reply-delivery-contract.test.js uses to isolate one region of
 * a larger client file, but here loaded to actually run, not just to scan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISPATCH_JS_SRC = readFileSync(join(__dirname, '../../public/dispatch.js'), 'utf8');

function extractRenderFeedbackEntriesSrc() {
  const start = DISPATCH_JS_SRC.indexOf('function renderFeedbackEntries');
  assert.notEqual(start, -1, 'renderFeedbackEntries found in public/dispatch.js');
  const end = DISPATCH_JS_SRC.indexOf('\nfunction renderDispatchHistoryList', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return DISPATCH_JS_SRC.slice(start, end);
}

function makeSandbox() {
  const sandbox = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    formatDispatchTime: () => 'just now',
  };
  vm.createContext(sandbox);
  vm.runInContext(extractRenderFeedbackEntriesSrc(), sandbox, { filename: 'dispatch.js-renderFeedbackEntries-slice' });
  return sandbox;
}

test('renderFeedbackEntries excludes a decision-answer entry, keeping real feedback lines', () => {
  const sandbox = makeSandbox();
  const html = sandbox.renderFeedbackEntries([
    { message: 'a real feedback line', timestamp: '2026-08-01T00:00:00.000Z' },
    { kind: 'decision-answer', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:01:00.000Z' },
    { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' }
  ]);
  assert.ok(html.includes('a real feedback line'));
  assert.ok(html.includes('another real line'));
  assert.ok(!html.includes('decision_id'), 'the stamp never renders as a bare JSON line');
});

test('renderFeedbackEntries returns empty string when only a decision-answer entry is present', () => {
  const sandbox = makeSandbox();
  const html = sandbox.renderFeedbackEntries([
    { kind: 'decision-answer', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:00:00.000Z' }
  ]);
  assert.equal(html, '');
});

test('renderFeedbackEntries is unchanged for feedback with no decision-answer entries (regression pin)', () => {
  const sandbox = makeSandbox();
  const html = sandbox.renderFeedbackEntries([
    { message: 'pr opened', url: 'https://example.com/pr/1', urlLabel: 'PR #1', timestamp: '2026-08-01T00:00:00.000Z' }
  ]);
  assert.ok(html.includes('feedback-list'));
  assert.ok(html.includes('pr opened'));
  assert.ok(html.includes('PR #1'));
});
