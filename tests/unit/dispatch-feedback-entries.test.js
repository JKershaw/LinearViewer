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
import { HALT_MODES } from '../../lib/workspace-halt.js';

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

test('renderFeedbackEntries excludes a decision-withdrawn entry, keeping real feedback lines (LIN-3037)', () => {
  const sandbox = makeSandbox();
  const html = sandbox.renderFeedbackEntries([
    { message: 'a real feedback line', timestamp: '2026-08-01T00:00:00.000Z' },
    { kind: 'decision-withdrawn', message: '{"decision_id":"d-1","reason":"scheduled wakeup, re-raise later"}', timestamp: '2026-08-01T00:01:00.000Z' },
    { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' }
  ]);
  assert.ok(html.includes('a real feedback line'));
  assert.ok(html.includes('another real line'));
  assert.ok(!html.includes('decision_id'), 'the stamp never renders as a bare JSON line');
  assert.ok(!html.includes('scheduled wakeup'), 'the withdrawal reason never renders');
});

test('renderFeedbackEntries excludes a decision-withdrawal-reversed entry, keeping real feedback lines (LIN-3037)', () => {
  const sandbox = makeSandbox();
  const html = sandbox.renderFeedbackEntries([
    { message: 'a real feedback line', timestamp: '2026-08-01T00:00:00.000Z' },
    { kind: 'decision-withdrawal-reversed', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:01:00.000Z' },
    { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' }
  ]);
  assert.ok(html.includes('a real feedback line'));
  assert.ok(html.includes('another real line'));
  assert.ok(!html.includes('decision_id'), 'the stamp never renders as a bare JSON line');
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

// LIN-3687 (carries LIN-3684): every HALT_MODES value needs a label, and an
// unknown mode must not be silently labelled "Pause".
test('HALT_MODE_LABELS in public/dispatch.js has an entry for every HALT_MODES value', () => {
  const start = DISPATCH_JS_SRC.indexOf('const HALT_MODE_LABELS');
  assert.notEqual(start, -1, 'HALT_MODE_LABELS found in public/dispatch.js');
  const slice = DISPATCH_JS_SRC.slice(start, DISPATCH_JS_SRC.indexOf('}', start) + 1);
  const sandbox = {};
  vm.createContext(sandbox);
  const labels = vm.runInContext(`${slice}; HALT_MODE_LABELS`, sandbox);
  for (const mode of HALT_MODES) {
    assert.equal(typeof labels[mode], 'string', `label for halt mode "${mode}"`);
  }
});

test('LIN-3687: formatHaltStatusHtml labels an unknown mode with its capitalised raw mode, never "Pause"', () => {
  const labelsStart = DISPATCH_JS_SRC.indexOf('const HALT_MODE_LABELS');
  const fnStart = DISPATCH_JS_SRC.indexOf('function formatHaltStatusHtml');
  assert.notEqual(fnStart, -1, 'formatHaltStatusHtml found in public/dispatch.js');
  const labelsSlice = DISPATCH_JS_SRC.slice(labelsStart, DISPATCH_JS_SRC.indexOf('}', labelsStart) + 1);
  const fnSlice = DISPATCH_JS_SRC.slice(fnStart, DISPATCH_JS_SRC.indexOf('\n}\n', fnStart) + 3);
  const sandbox = { escapeHtml: (s) => String(s) };
  vm.createContext(sandbox);
  const format = vm.runInContext(`${labelsSlice}\n${fnSlice}\nformatHaltStatusHtml`, sandbox);
  const html = format({ mode: 'drain', setAt: 0 });
  assert.ok(html.startsWith('Drain requested'), html);
  assert.ok(!html.includes('Pause'), html);
  assert.ok(format({ mode: 'pause', setAt: 0 }).startsWith('Pause requested'));
  assert.ok(format({ mode: 'stop', setAt: 0 }).startsWith('Stop requested'));
});

// LIN-3687: an unknown mode now reaches innerHTML through `verb`, so it must be
// escaped. The test above stubs escapeHtml as identity and cannot see this.
test('LIN-3687: formatHaltStatusHtml escapes the unknown-mode verb', () => {
  const labelsStart = DISPATCH_JS_SRC.indexOf('const HALT_MODE_LABELS');
  const fnStart = DISPATCH_JS_SRC.indexOf('function formatHaltStatusHtml');
  const labelsSlice = DISPATCH_JS_SRC.slice(labelsStart, DISPATCH_JS_SRC.indexOf('}', labelsStart) + 1);
  const fnSlice = DISPATCH_JS_SRC.slice(fnStart, DISPATCH_JS_SRC.indexOf('\n}\n', fnStart) + 3);
  const sandbox = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  };
  vm.createContext(sandbox);
  const format = vm.runInContext(`${labelsSlice}\n${fnSlice}\nformatHaltStatusHtml`, sandbox);
  const html = format({ mode: '<b>x', setAt: 0 });
  assert.ok(!html.includes('<b>'), html);
  assert.ok(html.includes('&lt;b&gt;x'), html);
});
