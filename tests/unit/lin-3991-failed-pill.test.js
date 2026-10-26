/**
 * LIN-3991 item 2: a task whose latest stage failed shows a pill that says so, in the error colour.
 *
 * Witnesses: the header status reads `failed` (not `idle`) when the newest stage failed, through the
 * same predicate the row and the count read; a merge-ready task still reads ready over a failed stage
 * (ready wins on the first poll, LIN-3448); a task with no runs stays `idle` (LIN-3975's, untouched);
 * the rendered pill carries the error colour and the word "failed" on the task page.
 *
 * Run with: node --test tests/unit/lin-3991-failed-pill.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveHeader } from '../../lib/task-page-loader.js';
import { renderTaskStatus } from '../../lib/render-task-page.js';

const NOW = new Date('2026-10-25T14:00:00.000Z');
const noWait = { waiting: false, message: null };

const sess = (kind, state, over = {}) => ({
  loopId: `${kind}-${state}`, kind, label: kind, state, open: false,
  endedAt: '2026-10-25T13:30:00.000Z', message: null, links: [],
  loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' },
  ...over,
});

describe('LIN-3991 — the header status reads failed after a failed stage', () => {
  test('a failed first and only stage reads failed', () => {
    const header = deriveHeader({ sessions: [sess('review', 'failed', { message: 'tests red' })], waiting: noWait, tracker: null, now: NOW });
    assert.equal(header.status, 'failed');
    assert.equal(header.sentence, 'Review failed 30 minutes ago: tests red');
  });

  test('a cancelled stage (an Undo) is not a failure and does not read failed', () => {
    const header = deriveHeader({ sessions: [sess('review', 'cancelled')], waiting: noWait, tracker: null, now: NOW });
    assert.notEqual(header.status, 'failed');
  });

  test('a merge-ready task still reads ready over a failed stage, so the first poll agrees with the load', () => {
    const closeOut = { status: 'ready', pr: { number: 41 } };
    const header = deriveHeader({ sessions: [sess('review', 'failed')], waiting: noWait, tracker: null, closeOut, now: NOW });
    assert.deepEqual(header, { status: 'waiting', sentence: 'Approved. PR #41 is ready to merge.', sentenceAt: null });
  });

  test('a task with no runs stays idle beside "No sessions yet."', () => {
    assert.deepEqual(deriveHeader({ sessions: [], waiting: noWait, tracker: null, now: NOW }), { status: 'idle', sentence: 'No sessions yet.', sentenceAt: null });
  });
});

describe('LIN-3991 — the rendered pill says failed, in the error colour', () => {
  test('the task page pill reads failed with the error colour, on the failed status', () => {
    const html = renderTaskStatus({ status: 'failed', sentence: 'Review failed 25 Oct: tests red' });
    assert.match(html, /data-status="failed"/);
    assert.match(html, /status-pill status-pill--error task-status-pill" data-testid="task-page-status-pill"><span class="status-pill__dot" aria-hidden="true"><\/span>failed</);
  });

  test('the idle pill is unchanged for a task with no runs', () => {
    const html = renderTaskStatus({ status: 'idle', sentence: 'No sessions yet.' });
    assert.match(html, /status-pill--queued task-status-pill[^>]*>(<span[^>]*><\/span>)idle</);
  });
});
