/**
 * LIN-2205 (LIN-1728 F6 follow-up) — the Dispatch page's history list must not render a `decision-answer` stamp as a
 * bare `{"decision_id":...}` feedback line (nor, LIN-3037, a withdrawal's stamp or its raw reason).
 *
 * LIN-4560: the history row's transcript is drawn by the one transcript look (lib/transcript.js) from the server's
 * transcript entries (lib/dispatch-transcript.js), which the history read sends; the stamp is marked `quiet` there and the
 * look leaves it out. `renderFeedbackEntries` (this page's own tree of lines) is retired, so each test here runs a raw
 * feedback array through the history read's entries (`historyTranscriptFeedback`) and the page's `historyTranscriptHtml`, the path the page draws. The
 * characterization LIN-4560 wrote before the change (order, text, times, http(s)-only links) is kept on that path.
 *
 * public/dispatch.js is a native ES module (LIN-4560), so this suite imports it over the fake DOM
 * (tests/unit/helpers/import-world.js) and drives its exported test seams, with common.js's globals stubbed as the window
 * (the escape, and the transcript's host: the server's own pill and surface, whose replicas common.js carries).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HALT_MODES } from '../../lib/workspace-halt.js';
import { historyTranscriptFeedback } from '../../lib/dispatch-transcript.js';
import { renderStatusPill } from '../../lib/components/status-pill.js';
import { renderSurface } from '../../lib/components/surface.js';
import { importWorld } from './helpers/import-world.js';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let world = null;
afterEach(() => { if (world) world.restore(); world = null; });

/**
 * The page module, imported fresh over the fake DOM with common.js's globals stubbed. `formatLocalTime` is the exact
 * half of a transcript time, so a test that words times passes its own.
 */
async function loadPage({ formatLocalTime = () => '', escape = escapeHtml } = {}) {
  world = importWorld({ window: { escapeHtml: escape, relativeTime: () => 'just now', formatLocalTime, renderStatusPill, renderSurface, addEventListener() {} } });
  return world.importPage('dispatch.js');
}

/** A raw feedback array as the history row draws it: the history read's entries, then the page's transcript. */
const render = (page, feedback, live = false) => page.historyTranscriptHtml(historyTranscriptFeedback(feedback), live);

test('the history transcript excludes a decision-answer entry, keeping real feedback lines', async () => {
  const page = await loadPage();
  const html = render(page, [
    { message: 'a real feedback line', timestamp: '2026-08-01T00:00:00.000Z' },
    { kind: 'decision-answer', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:01:00.000Z' },
    { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' }
  ]);
  assert.ok(html.includes('a real feedback line'));
  assert.ok(html.includes('another real line'));
  assert.ok(!html.includes('decision_id'), 'the stamp never renders as a bare JSON line');
});

test('the history transcript returns empty string when only a decision-answer entry is present', async () => {
  const page = await loadPage();
  const html = render(page, [
    { kind: 'decision-answer', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:00:00.000Z' }
  ]);
  assert.equal(html, '');
});

test('the history transcript excludes a decision-withdrawn entry, keeping real feedback lines (LIN-3037)', async () => {
  const page = await loadPage();
  const html = render(page, [
    { message: 'a real feedback line', timestamp: '2026-08-01T00:00:00.000Z' },
    { kind: 'decision-withdrawn', message: '{"decision_id":"d-1","reason":"scheduled wakeup, re-raise later"}', timestamp: '2026-08-01T00:01:00.000Z' },
    { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' }
  ]);
  assert.ok(html.includes('a real feedback line'));
  assert.ok(html.includes('another real line'));
  assert.ok(!html.includes('decision_id'), 'the stamp never renders as a bare JSON line');
  assert.ok(!html.includes('scheduled wakeup'), 'the withdrawal reason never renders');
});

test('the history transcript excludes a decision-withdrawal-reversed entry, keeping real feedback lines (LIN-3037)', async () => {
  const page = await loadPage();
  const html = render(page, [
    { message: 'a real feedback line', timestamp: '2026-08-01T00:00:00.000Z' },
    { kind: 'decision-withdrawal-reversed', message: '{"decision_id":"d-1"}', timestamp: '2026-08-01T00:01:00.000Z' },
    { message: 'another real line', timestamp: '2026-08-01T00:02:00.000Z' }
  ]);
  assert.ok(html.includes('a real feedback line'));
  assert.ok(html.includes('another real line'));
  assert.ok(!html.includes('decision_id'), 'the stamp never renders as a bare JSON line');
});

test('the history transcript is unchanged for feedback with no decision-answer entries (regression pin)', async () => {
  const page = await loadPage();
  const html = render(page, [
    { message: 'pr opened', url: 'https://example.com/pr/1', urlLabel: 'PR #1', timestamp: '2026-08-01T00:00:00.000Z' }
  ]);
  assert.ok(html.includes('data-testid="history-transcript"'));
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
  const page = await loadPage({ formatLocalTime: (iso) => `t(${iso.slice(11, 16)})` });
  const html = render(page, [
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
  const html = render(page, [
    { message: 'labelled', url: 'https://example.com/pr/1?a=1&b="2"', urlLabel: 'PR <1>', timestamp: '2026-08-01T10:00:00.000Z' },
    { message: 'unlabelled', url: 'http://example.com/x', timestamp: '2026-08-01T10:01:00.000Z' },
    { message: 'scripted', url: 'javascript:alert(1)', urlLabel: 'click', timestamp: '2026-08-01T10:02:00.000Z' }
  ]);
  assert.ok(html.includes('href="https://example.com/pr/1?a=1&amp;b=&quot;2&quot;"'), html);
  assert.ok(html.includes('>PR &lt;1&gt;</a>'), html);
  assert.match(html, /href="http:\/\/example\.com\/x" target="_blank"[^>]*>link<\/a>/, html);
  assert.ok(!html.includes('javascript:'), 'a non-http URL is never a link');
  assert.ok(!html.includes('>click</a>'));
});
