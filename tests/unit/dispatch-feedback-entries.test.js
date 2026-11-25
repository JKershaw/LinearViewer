/**
 * LIN-2205 (LIN-1728 F6 follow-up) — `public/dispatch.js`'s
 * `renderFeedbackEntries` must not render a `decision-answer` stamp as a
 * bare `{"decision_id":...}` feedback line on the Dispatch page's history
 * list. `_formatFeedbackEntries` (lib/dispatch-store.js) carries `kind`
 * through additively, so the fix is a client-side filter here.
 *
 * public/dispatch.js is a native ES module (LIN-4560), so this suite imports it over the fake DOM
 * (tests/unit/helpers/import-world.js) and drives its exported test seams. Its free globals are common.js's, stubbed as
 * the window: `escapeHtml`, and `relativeTime` (which the page's `formatDispatchTime` reads). It was a vm over a source
 * slice of the classic script until then.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HALT_MODES } from '../../lib/workspace-halt.js';
import { importWorld } from './helpers/import-world.js';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let world = null;
afterEach(() => { if (world) world.restore(); world = null; });

/**
 * The page module, imported fresh over the fake DOM with common.js's globals stubbed. `relativeTime` is what the page's
 * `formatDispatchTime` reads, so a test that words times passes its own.
 */
async function loadPage({ relativeTime = () => 'just now', escape = escapeHtml } = {}) {
  world = importWorld({ window: { escapeHtml: escape, relativeTime, addEventListener() {} } });
  return world.importPage('dispatch.js');
}

test('renderFeedbackEntries excludes a decision-answer entry, keeping real feedback lines', async () => {
  const page = await loadPage();
  const html = page.renderFeedbackEntries([
    { message: 'a real feedback line', timestamp: '2026-08-01T00:00:00.000Z' },
    { kind: 'decision-answer', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:01:00.000Z' },
    { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' }
  ]);
  assert.ok(html.includes('a real feedback line'));
  assert.ok(html.includes('another real line'));
  assert.ok(!html.includes('decision_id'), 'the stamp never renders as a bare JSON line');
});

test('renderFeedbackEntries returns empty string when only a decision-answer entry is present', async () => {
  const page = await loadPage();
  const html = page.renderFeedbackEntries([
    { kind: 'decision-answer', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:00:00.000Z' }
  ]);
  assert.equal(html, '');
});

test('renderFeedbackEntries excludes a decision-withdrawn entry, keeping real feedback lines (LIN-3037)', async () => {
  const page = await loadPage();
  const html = page.renderFeedbackEntries([
    { message: 'a real feedback line', timestamp: '2026-08-01T00:00:00.000Z' },
    { kind: 'decision-withdrawn', message: '{"decision_id":"d-1","reason":"scheduled wakeup, re-raise later"}', timestamp: '2026-08-01T00:01:00.000Z' },
    { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' }
  ]);
  assert.ok(html.includes('a real feedback line'));
  assert.ok(html.includes('another real line'));
  assert.ok(!html.includes('decision_id'), 'the stamp never renders as a bare JSON line');
  assert.ok(!html.includes('scheduled wakeup'), 'the withdrawal reason never renders');
});

test('renderFeedbackEntries excludes a decision-withdrawal-reversed entry, keeping real feedback lines (LIN-3037)', async () => {
  const page = await loadPage();
  const html = page.renderFeedbackEntries([
    { message: 'a real feedback line', timestamp: '2026-08-01T00:00:00.000Z' },
    { kind: 'decision-withdrawal-reversed', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:01:00.000Z' },
    { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' }
  ]);
  assert.ok(html.includes('a real feedback line'));
  assert.ok(html.includes('another real line'));
  assert.ok(!html.includes('decision_id'), 'the stamp never renders as a bare JSON line');
});

test('renderFeedbackEntries is unchanged for feedback with no decision-answer entries (regression pin)', async () => {
  const page = await loadPage();
  const html = page.renderFeedbackEntries([
    { message: 'pr opened', url: 'https://example.com/pr/1', urlLabel: 'PR #1', timestamp: '2026-08-01T00:00:00.000Z' }
  ]);
  assert.ok(html.includes('feedback-list'));
  assert.ok(html.includes('pr opened'));
  assert.ok(html.includes('PR #1'));
});

// LIN-3687 (carries LIN-3684): every HALT_MODES value needs a label, and an
// unknown mode must not be silently labelled "Pause".
test('HALT_MODE_LABELS in public/dispatch.js has an entry for every HALT_MODES value', async () => {
  const { HALT_MODE_LABELS } = await loadPage();
  for (const mode of HALT_MODES) {
    assert.equal(typeof HALT_MODE_LABELS[mode], 'string', `label for halt mode "${mode}"`);
  }
});

test('LIN-3687: formatHaltStatusHtml labels an unknown mode with its capitalised raw mode, never "Pause"', async () => {
  const { formatHaltStatusHtml: format } = await loadPage({ escape: (s) => String(s) });
  const html = format({ mode: 'drain', setAt: 0 });
  assert.ok(html.startsWith('Drain requested'), html);
  assert.ok(!html.includes('Pause'), html);
  assert.ok(format({ mode: 'pause', setAt: 0 }).startsWith('Pause requested'));
  assert.ok(format({ mode: 'stop', setAt: 0 }).startsWith('Stop requested'));
});

// LIN-3687: an unknown mode now reaches innerHTML through `verb`, so it must be
// escaped. The test above stubs escapeHtml as identity and cannot see this.
test('LIN-3687: formatHaltStatusHtml escapes the unknown-mode verb', async () => {
  const { formatHaltStatusHtml: format } = await loadPage({ escape: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') });
  const html = format({ mode: '<b>x', setAt: 0 });
  assert.ok(!html.includes('<b>'), html);
  assert.ok(html.includes('&lt;b&gt;x'), html);
});

// ── LIN-4560: characterization of Dispatch history's transcript, before the shared transcript module replaces it ──────
// What the shared module must keep from this renderer (beat 1 of LIN-4560, written against the classic script before the
// page became a module): every entry in stored order, the message as text (HTML in it never becomes markup), a link only
// for an http(s) URL with its label (or "link"), and each entry's time from the page's relative-time words.
test('LIN-4560 characterization: entries in stored order, the message as text, and each entry\'s time', async () => {
  const page = await loadPage({ relativeTime: (iso) => `t(${iso.slice(11, 16)})` });
  const html = page.renderFeedbackEntries([
    { message: 'first <img src=x onerror="alert(1)">', timestamp: '2026-08-01T10:00:00.000Z' },
    { message: 'second', timestamp: '2026-08-01T10:01:00.000Z' },
    { message: 'third', timestamp: '2026-08-01T10:02:00.000Z' }
  ]);
  assert.ok(!html.includes('<img'), 'HTML in a message is text, never markup');
  assert.ok(html.includes('first &lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  const order = ['first', 'second', 'third'].map((w) => html.indexOf(w));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'entries keep their stored order');
  assert.ok(html.includes('t(10:00)') && html.includes('t(10:01)') && html.includes('t(10:02)'), 'each entry carries its own time');
});

test('LIN-4560 characterization: a link is drawn only for an http(s) URL, escaped, with its label or "link"', async () => {
  const page = await loadPage();
  const html = page.renderFeedbackEntries([
    { message: 'labelled', url: 'https://example.com/pr/1?a=1&b="2"', urlLabel: 'PR <1>', timestamp: '2026-08-01T10:00:00.000Z' },
    { message: 'unlabelled', url: 'http://example.com/x', timestamp: '2026-08-01T10:01:00.000Z' },
    { message: 'scripted', url: 'javascript:alert(1)', urlLabel: 'click', timestamp: '2026-08-01T10:02:00.000Z' }
  ]);
  assert.ok(html.includes('href="https://example.com/pr/1?a=1&amp;b=&quot;2&quot;"'), html);
  assert.ok(html.includes('>PR &lt;1&gt;</a>'), html);
  assert.ok(html.includes('href="http://example.com/x" target="_blank">link</a>'), html);
  assert.ok(!html.includes('javascript:'), 'a non-http URL is never a link');
  assert.ok(!html.includes('>click</a>'));
});
