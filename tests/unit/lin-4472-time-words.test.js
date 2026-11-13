/**
 * LIN-4472: the duration and relative-time wording has one home, lib/time-words.js, served to the browser at
 * /lib/time-words.js and imported by the server and the task page alike. This suite pins the single home (every caller
 * holds the same function, not a copy), the values the wording takes, and the one edge the merge changed: a non-finite
 * span. The page's old clock printed `Infinityh` for +Infinity, and fmtDuration reads null there; no page path passes a
 * non-finite span (tickClocks skips an unparsed start, and Date.now() minus a parsed start is finite), so only the
 * shared function's own value changed, and this pins it.
 *
 * Run with: node --test tests/unit/lin-4472-time-words.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDuration, relativeAgo } from '../../lib/time-words.js';
import { fmtDuration as serverFmtDuration } from '../../lib/render-run-steps.js';
import { relativeAgo as loaderRelativeAgo } from '../../lib/task-page-loader.js';
import { shareTime } from '../../public/task-page.js';
import { createFakeDom } from './helpers/fake-dom.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');

describe('LIN-4472 — one home for the duration and relative-time words', () => {
  test('every caller holds the leaf\'s function, not a copy', () => {
    assert.equal(serverFmtDuration, fmtDuration, 'lib/render-run-steps.js re-exports the leaf');
    assert.equal(loaderRelativeAgo, relativeAgo, 'lib/task-page-loader.js re-exports the leaf');
  });

  test('fmtDuration: the words a span takes, and null when there is no span', () => {
    assert.equal(fmtDuration(0), '0s');
    assert.equal(fmtDuration(999), '1s');
    assert.equal(fmtDuration(59_000), '59s');
    assert.equal(fmtDuration(60_000), '1m');
    assert.equal(fmtDuration(125_000), '2m 5s');
    assert.equal(fmtDuration(3_600_000), '1h');
    assert.equal(fmtDuration(7_380_000), '2h 3m');
    assert.equal(fmtDuration(-1), null);
    assert.equal(fmtDuration(NaN), null);
    assert.equal(fmtDuration(undefined), null);
    assert.equal(fmtDuration(Infinity), null, 'a non-finite span has no words (the page\'s old clock printed "Infinityh")');
  });

  test('relativeAgo: the words a moment takes, and null when there is no moment', () => {
    assert.equal(relativeAgo('2026-10-26T11:59:30.000Z', NOW), 'just now');
    assert.equal(relativeAgo('2026-10-26T11:59:00.000Z', NOW), '1 minute ago');
    assert.equal(relativeAgo('2026-10-26T10:00:00.000Z', NOW), '2 hours ago');
    assert.equal(relativeAgo('2026-10-24T12:00:00.000Z', NOW), '2 days ago');
    assert.equal(relativeAgo(null, NOW), null);
    assert.equal(relativeAgo('not a date', NOW), null);
  });

  test('the share list\'s words are relativeAgo\'s, and a moment that does not parse reads as no words', () => {
    const { document } = createFakeDom();
    assert.equal(shareTime(document, '2026-10-26T10:00:00.000Z', NOW).textContent, '2 hours ago');
    assert.equal(shareTime(document, 'not a date', NOW).textContent, '');
  });
});
