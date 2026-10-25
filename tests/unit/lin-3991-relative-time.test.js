/**
 * LIN-3991 item 4: every state sentence on Home reads in relative time, with the exact time beside it.
 *
 * Witnesses: `relativeAgo` names a moment in relative words; each rung of `deriveHeader` (done, running,
 * queued, failed, idle, ready, waiting) says no UTC stamp and never both "since" and "ago"; the moment a
 * sentence names is carried as `sentenceAt` (the latest attempt's start for a running stage, none for
 * queued, waiting or ready); the page renders that moment as a zoned local-time element outside the
 * sentence, with the UTC text only as the no-JS fallback.
 *
 * Run with: node --test tests/unit/lin-3991-relative-time.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveHeader, relativeAgo } from '../../lib/task-page-loader.js';
import { renderTaskStatus } from '../../lib/render-task-page.js';

const NOW = new Date('2026-10-25T14:00:00.000Z');
const noWait = { waiting: false, message: null };

const sess = (kind, state, over = {}) => ({
  loopId: `${kind}-${state}`, kind, label: kind, state, open: false,
  endedAt: '2026-10-25T13:30:00.000Z', message: null, links: [],
  loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' },
  ...over,
});

describe('LIN-3991 — relativeAgo names a moment in relative words', () => {
  test('boundaries: just now, minutes, hours, days', () => {
    assert.equal(relativeAgo(null, NOW), null);
    assert.equal(relativeAgo('not a date', NOW), null);
    assert.equal(relativeAgo('2026-10-25T14:00:00.000Z', NOW), 'just now');
    assert.equal(relativeAgo('2026-10-25T14:00:30.000Z', NOW), 'just now', 'a moment in the future reads as just now');
    assert.equal(relativeAgo('2026-10-25T13:59:00.000Z', NOW), '1 minute ago');
    assert.equal(relativeAgo('2026-10-25T13:35:00.000Z', NOW), '25 minutes ago');
    assert.equal(relativeAgo('2026-10-25T13:00:00.000Z', NOW), '1 hour ago');
    assert.equal(relativeAgo('2026-10-25T11:00:00.000Z', NOW), '3 hours ago');
    assert.equal(relativeAgo('2026-10-24T14:00:00.000Z', NOW), '1 day ago');
    assert.equal(relativeAgo('2026-10-23T14:00:00.000Z', NOW), '2 days ago');
  });
});

describe('LIN-3991 — every Home state sentence reads relative, with no UTC stamp and no "since … ago"', () => {
  const cases = [
    ['done (completed)', { sessions: [sess('review', 'done')], tracker: { state: { name: 'Done', type: 'completed' }, finishedAt: '2026-10-25T11:00:00.000Z' } }],
    ['running', { sessions: [sess('implementation', 'running', { loop: { takenAt: '2026-10-25T13:00:00.000Z', dispatchedAt: '2026-10-25T12:50:00.000Z' } })], tracker: null }],
    ['queued', { sessions: [sess('review', 'queued')], tracker: null }],
    ['failed', { sessions: [sess('review', 'failed', { message: 'tests red' })], tracker: null }],
    ['idle after a done stage', { sessions: [sess('plan', 'done')], tracker: null }],
    ['waiting', { sessions: [sess('review', 'waiting')], waiting: { waiting: true, message: '[blocked] Which API?' }, tracker: null }],
  ];
  for (const [name, input] of cases) {
    test(name, () => {
      const header = deriveHeader({ waiting: noWait, now: NOW, ...input });
      assert.doesNotMatch(header.sentence, /UTC/, header.sentence);
      assert.ok(!(/since/.test(header.sentence) && /ago/.test(header.sentence)), header.sentence);
    });
  }
});

describe('LIN-3991 — sentenceAt is the moment the sentence names', () => {
  test('a done task names its finish', () => {
    const header = deriveHeader({ sessions: [], tracker: { state: { name: 'Done', type: 'completed' }, finishedAt: '2026-10-25T11:00:00.000Z' }, waiting: noWait, now: NOW });
    assert.deepEqual(header, { status: 'done', sentence: 'Finished 3 hours ago.', sentenceAt: '2026-10-25T11:00:00.000Z' });
  });

  test('a running stage names the latest attempt\'s start, not the first dispatch (LIN-3498)', () => {
    const header = deriveHeader({ sessions: [sess('implementation', 'running', { loop: { takenAt: '2026-10-25T13:30:00.000Z', dispatchedAt: '2026-10-25T13:00:00.000Z' } })], tracker: null, waiting: noWait, now: NOW });
    assert.equal(header.sentence, 'Build running for 30 minutes.');
    assert.equal(header.sentenceAt, '2026-10-25T13:30:00.000Z');
  });

  test('a failed stage names when it ended', () => {
    const header = deriveHeader({ sessions: [sess('review', 'failed')], tracker: null, waiting: noWait, now: NOW });
    assert.equal(header.sentenceAt, '2026-10-25T13:30:00.000Z');
  });

  test('queued, waiting, ready and no-run headers name no moment', () => {
    assert.equal(deriveHeader({ sessions: [sess('review', 'queued')], tracker: null, waiting: noWait, now: NOW }).sentenceAt, null);
    assert.equal(deriveHeader({ sessions: [sess('review', 'waiting')], waiting: { waiting: true, message: 'Which API?' }, tracker: null, now: NOW }).sentenceAt, null);
    assert.equal(deriveHeader({ sessions: [sess('review', 'done')], tracker: null, waiting: noWait, closeOut: { status: 'ready', pr: { number: 41 } }, now: NOW }).sentenceAt, null);
    assert.equal(deriveHeader({ sessions: [], tracker: null, waiting: noWait, now: NOW }).sentenceAt, null);
  });
});

describe('LIN-3991 — the page renders the exact time beside the sentence, zoned, outside the sentence', () => {
  test('a sentence with a moment carries a zoned time element after it', () => {
    const html = renderTaskStatus({ status: 'failed', sentence: 'Review failed 30 minutes ago', sentenceAt: '2026-10-25T13:30:00.000Z' });
    assert.match(html, /<p class="task-sentence" data-testid="task-page-sentence">Review failed 30 minutes ago<\/p>\s*<time class="task-sentence-at" data-testid="task-page-sentence-at" datetime="2026-10-25T13:30:00\.000Z" data-local-time="zoned">25 Oct, 13:30 UTC<\/time>/);
  });

  test('a sentence with no moment renders no time element', () => {
    const html = renderTaskStatus({ status: 'waiting', sentence: 'Approved. PR #41 is ready to merge.', sentenceAt: null });
    assert.doesNotMatch(html, /task-sentence-at/);
  });
});
