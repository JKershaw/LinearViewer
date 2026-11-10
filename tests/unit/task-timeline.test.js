/**
 * LIN-4405 (part 2 of LIN-4395): the session timeline's pure model, its spend strip, its reader and its fragment cache.
 *
 * Witnesses:
 *  - the LIN-4393 fixture (real read, tests/fixtures/task-timeline/lin-4393.js): eight lanes; the autopilot held 63 min
 *    with five wake ticks and only its request spans as work; the implementation's two segments with its `leftover`
 *    resume; the two surveys side by side; one merge mark; no false break;
 *  - working times unknown, running (open end, from the page's open ids, not the row), missing end, a two-day gap folded
 *    into one labelled break with a held line crossing it, a foreign-founded lane clipped to this task's clock and kept
 *    out of the total, untimed merges, a truncated lineage reading "not complete", `custom` roles, a dispatch with no
 *    records (a tick, never a bar), late-posted records (split rule C), and a page loop with no cost lineage;
 *  - `withoutSpend` copies and never mutates the model it is given;
 *  - the reader hands the page's events in instead of reading them again; the fragment cache is single-flight, expires,
 *    never caches a failure and is cleared per key.
 *
 * Run with: node --test tests/unit/task-timeline.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  taskTimeline, withoutSpend, mergeMarksOf, createTaskTimelineReader, createTimelineFragmentReader, openItemIdsOf,
  gapWords, MIN_SEGMENT_PCT, TIMELINE_CACHE_MS,
} from '../../lib/task-timeline.js';
import { renderTaskTimeline } from '../../lib/render-task-timeline.js';
import { readCostOverRecords } from '../../lib/cost-read.js';
import { LIN_4393_SESSIONS, LIN_4393_PRICED_USD, LIN_4393_MERGE_EVENTS, LIN_4393_NOW } from '../fixtures/task-timeline/lin-4393.js';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 8, 12);
const iso = ms => new Date(ms).toISOString();
const atMin = m => iso(T0 + m * MIN);

/** A dispatch entry, as part 1's `dispatchesOf` returns it. */
const d = (itemId, kind, startMin, firstMin, lastMin, { followUpTo = null, costUsd = 0.1, model = 'claude-opus-5-5' } = {}) => ({
  itemId, kind, dispatchedAt: atMin(startMin), followUpTo,
  byModel: firstMin === null ? null : [{ model, requests: 3, costUsd }],
  requests: firstMin === null ? 0 : 3, costUsd: firstMin === null ? null : costUsd,
  firstRequestAt: firstMin === null ? null : atMin(firstMin), lastRequestAt: lastMin === null ? null : atMin(lastMin),
});
/** A `workerSessions` row. */
const s = (rootItemId, kind, startMin, durationMin, dispatches, extra = {}) => ({
  rootItemId, kind, dispatchedAt: atMin(startMin), harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high',
  costUsd: 1, durationMs: durationMin === null ? null : durationMin * MIN, dispatches, telemetry: true, incomplete: false, ...extra,
});
const lin4393 = (extra = {}) => taskTimeline({
  sessions: LIN_4393_SESSIONS, foundedElsewhere: [], merges: mergeMarksOf({ events: LIN_4393_MERGE_EVENTS }), openItemIds: [],
  now: LIN_4393_NOW, totalUsd: LIN_4393_PRICED_USD, pricedUsd: LIN_4393_PRICED_USD, ...extra,
});
const lane = (timeline, kind) => timeline.lanes.find(l => l.kind === kind);

describe('LIN-4393: one real task, session by session', () => {
  test('eight lanes, ordered by start, every one a known-times ended lane', () => {
    const tl = lin4393();
    assert.deepEqual(tl.lanes.map(l => l.kind), ['survey-task', 'survey-place', 'autopilot', 'scoping', 'plan', 'implementation', 'review', 'close-out']);
    for (const l of tl.lanes) {
      assert.equal(l.state, 'ended', l.kind);
      assert.equal(l.times, 'known', l.kind);
    }
  });

  test('the autopilot is held for 63 min with five wake ticks, and only its request spans are work', () => {
    const autopilot = lane(lin4393(), 'autopilot');
    assert.equal(autopilot.role, 'held');
    assert.equal(autopilot.model, 'claude-sonnet-5-5');
    assert.equal(Math.round(autopilot.elapsedMs / MIN), 63);
    // Measured from the real request records: 2 min 22 s of work (six spans), not the elapsed hour.
    assert.equal(Math.round(autopilot.workedMs / 1000), 142);
    assert.ok(autopilot.workedMs < autopilot.elapsedMs / 20, 'held time is never read as work');
    assert.equal(autopilot.ticks.filter(t => t.role === 'wake').length, 5);
    assert.equal(autopilot.segments.length, 6, 'the base and each wake have their own working span');
    // The held line runs the whole hour; the bars are thin slivers on it.
    assert.ok(autopilot.span.widthPct > 90);
    const drawnWork = autopilot.segments.reduce((sum, seg) => sum + seg.widthPct, 0);
    assert.ok(drawnWork < 10, `the drawn bars cover ${drawnWork}% of the track`);
  });

  test('a 15-second wake is still drawn, at the minimum visible width', () => {
    const autopilot = lane(lin4393(), 'autopilot');
    for (const seg of autopilot.segments) assert.ok(seg.widthPct >= MIN_SEGMENT_PCT, `${seg.itemId} ${seg.widthPct}`);
  });

  test('the implementation has two working segments and a resume tick on its leftover', () => {
    const impl = lane(lin4393(), 'implementation');
    assert.equal(impl.role, 'fresh');
    assert.equal(impl.segments.length, 2);
    assert.deepEqual(impl.ticks.map(t => [t.kind, t.role]), [['leftover', 'resumed']]);
    assert.deepEqual(impl.dispatches.map(row => row.kind), ['implementation', 'leftover']);
    assert.ok(impl.segments[1].leftPct > impl.segments[0].leftPct);
  });

  test('the two surveys run side by side', () => {
    const tl = lin4393();
    const task = lane(tl, 'survey-task');
    const place = lane(tl, 'survey-place');
    assert.ok(place.span.leftPct < task.span.leftPct + task.span.widthPct, 'survey-place starts while survey-task runs');
  });

  test('one merge mark at the PR merge time, no false break, and the total is the read\'s figure', () => {
    const tl = lin4393();
    assert.deepEqual(tl.marks.merges.map(m => m.at), ['2026-11-08T15:34:51.000Z']);
    assert.equal(tl.marks.untimedMerge, false);
    assert.deepEqual(tl.scale.breaks, [], 'the task worked without a long pause: nothing folds');
    assert.equal(tl.totals.complete, true);
    assert.equal(tl.totals.totalUsd, LIN_4393_PRICED_USD);
    assert.equal(tl.scale.startAt, LIN_4393_SESSIONS.find(x => x.kind === 'survey-task').dispatchedAt);
  });

  test('rendered: names, elapsed versus worked, cost through formatUsd, the merge time, and no "took"', () => {
    const html = renderTaskTimeline(lin4393());
    assert.match(html, /Kick-off · held/, 'the app\'s own stage word (stageLabel), as Stages says it');
    assert.match(html, /elapsed 1h 3m · worked 2m 22s · \$0\.84/);
    assert.match(html, /8 sessions · total \$14\.75 · merged <time/);
    assert.doesNotMatch(html, /\btook\b/, 'a lane never reuses Stages\' word');
    assert.equal((html.match(/data-testid="task-timeline-lane"/g) || []).length, 8);
    assert.equal((html.match(/data-testid="task-timeline-tick" data-role="wake"/g) || []).length, 5);
  });
});

describe('LIN-4405 cases', () => {
  test('working times unknown: a snapshot lineage is an outline over its known span, never a bar', () => {
    const tl = taskTimeline({ sessions: [s('old', 'implementation', 0, 40, null)], now: atMin(60 * 24 * 40) });
    const [only] = tl.lanes;
    assert.equal(only.times, 'unknown');
    assert.equal(only.workedMs, null);
    assert.deepEqual(only.segments, []);
    assert.deepEqual(only.ticks, []);
    assert.equal(only.state, 'ended');
    assert.deepEqual(only.span, { leftPct: 0, widthPct: 100 });
    const html = renderTaskTimeline(tl);
    assert.match(html, /data-times="unknown"/);
    assert.match(html, /working times unknown/);
    assert.match(html, /tl-line--unknown/);
  });

  test('running: an open session (the page model\'s id) extends its lane to now, even with an end on the row', () => {
    const sessions = [s('b', 'implementation', 0, 10, [d('b', 'implementation', 0, 1, 9), d('f', 'leftover', 20, 21, 25, { followUpTo: 'b' })])];
    const tl = taskTimeline({ sessions, openItemIds: ['f'], now: atMin(30) });
    const [only] = tl.lanes;
    assert.equal(only.state, 'running');
    assert.equal(only.endAt, atMin(30));
    assert.equal(only.elapsedMs, 30 * MIN);
    assert.equal(tl.scale.nowPct, 100);
    assert.match(renderTaskTimeline(tl), /data-state="running"[\s\S]*elapsed 30m so far/);
    // The same lineage, not open in the page model: the row's end stands.
    assert.equal(taskTimeline({ sessions, openItemIds: [], now: atMin(30) }).lanes[0].state, 'ended');
  });

  test('missing end: not running and no duration stops at its last request and says so', () => {
    const tl = taskTimeline({ sessions: [s('b', 'plan', 0, null, [d('b', 'plan', 0, 2, 7)])], now: atMin(600) });
    const [only] = tl.lanes;
    assert.equal(only.state, 'end-not-recorded');
    assert.equal(only.endAt, atMin(7));
    assert.match(renderTaskTimeline(tl), /end not recorded/);
  });

  test('a two-day gap folds into one labelled break, and the held line still crosses it', () => {
    const TWO_DAYS = 2 * 24 * 60;
    const sessions = [
      s('a', 'autopilot', 0, TWO_DAYS + 30, [d('a', 'autopilot', 0, 1, 3), d('w1', 'wake', TWO_DAYS + 1, TWO_DAYS + 2, TWO_DAYS + 4, { followUpTo: 'a' })]),
      s('p', 'plan', 2, 10, [d('p', 'plan', 2, 3, 11)]),
      s('i', 'implementation', TWO_DAYS, 25, [d('i', 'implementation', TWO_DAYS, TWO_DAYS + 1, TWO_DAYS + 24)]),
    ];
    const tl = taskTimeline({ sessions, now: atMin(TWO_DAYS + 100) });
    assert.equal(tl.scale.breaks.length, 1);
    const [gap] = tl.scale.breaks;
    assert.equal(gap.words, '1d 23h');
    assert.equal(gap.fromAt, atMin(12));
    assert.equal(gap.toAt, atMin(TWO_DAYS));
    const held = lane(tl, 'autopilot');
    assert.equal(held.role, 'held');
    assert.ok(held.span.leftPct < gap.leftPct && held.span.leftPct + held.span.widthPct > gap.leftPct + gap.widthPct, 'the held line crosses the break');
    // The worked bars keep a readable share of the track: the two days take only the break's width.
    const impl = lane(tl, 'implementation');
    assert.ok(impl.segments[0].widthPct > 20, `implementation drawn ${impl.segments[0].widthPct}%`);
    assert.match(renderTaskTimeline(tl), /⋯ 1d 23h ⋯/);
  });

  test('a short pause stays drawn: no gap under ten minutes folds', () => {
    const sessions = [s('a', 'plan', 0, 5, [d('a', 'plan', 0, 1, 5)]), s('b', 'implementation', 14, 5, [d('b', 'implementation', 14, 15, 19)])];
    assert.deepEqual(taskTimeline({ sessions, now: atMin(30) }).scale.breaks, []);
    assert.equal(gapWords(2 * 60 * MIN + 5 * MIN), '2h 5m');
  });

  test('a foreign-founded lane draws only this task\'s tagged dispatches, clipped to this task\'s clock, out of the total', () => {
    const own = s('own', 'implementation', 0, 30, [d('own', 'implementation', 0, 1, 29)], { costUsd: 2 });
    const foreign = {
      ...s('P', 'autopilot', -5 * 24 * 60, 6 * 24 * 60, [
        d('P', 'autopilot', -5 * 24 * 60, -5 * 24 * 60 + 1, -5 * 24 * 60 + 3),
        d('W1', 'wake', 31, 31.2, 32, { followUpTo: 'P' }),
        d('W3', 'wake', 600, 601, 602, { followUpTo: 'P' }),
      ], { costUsd: 9 }),
      countedUnder: 'LIN-9', taggedItemIds: ['W1'],
    };
    const tl = taskTimeline({ sessions: [own], foundedElsewhere: [foreign], now: atMin(24 * 60), totalUsd: 2, pricedUsd: 2 });
    assert.equal(tl.scale.startAt, atMin(0), 'the founder\'s days-old start does not stretch the clock');
    assert.equal(tl.scale.endAt, atMin(32), 'nor does an untagged wake hours later');
    const parent = tl.lanes.find(l => l.countedUnder === 'LIN-9');
    assert.deepEqual(parent.dispatches.map(row => row.itemId), ['W1']);
    assert.deepEqual(parent.clipped, { start: true, end: true });
    assert.deepEqual(parent.span, { leftPct: 0, widthPct: 100 });
    assert.equal(tl.totals.totalUsd, 2);
    assert.equal(tl.totals.foreignLanes, 1);
    const html = renderTaskTimeline(tl);
    assert.match(html, /lineage cost \$9\.00, counted under LIN-9/);
    assert.match(html, /data-counted-under="LIN-9"/);
    assert.match(html, /continues outside this task/);
    assert.match(html, /1 session · 1 counted under another task · total \$2\.00/);
  });

  test('merges: de-duplicated by prUrl; an untimed merge falls back to the PR\'s time, else is said in words', () => {
    const url = 'https://github.com/o/r/pull/1';
    assert.deepEqual(mergeMarksOf({ events: [
      { merged: true, prUrl: url, prMergedAt: null },
      { merged: true, prUrl: url, prMergedAt: '2026-11-08T13:00:00.000Z' },
      { merged: false, prUrl: 'https://github.com/o/r/pull/2', prMergedAt: '2026-11-08T14:00:00.000Z' },
    ] }), { marks: [{ prUrl: url, at: '2026-11-08T13:00:00.000Z' }], untimed: false });
    const untimed = [{ merged: true, prUrl: url, prMergedAt: null }];
    assert.deepEqual(mergeMarksOf({ events: untimed }), { marks: [], untimed: true });
    assert.deepEqual(mergeMarksOf({ events: untimed, pr: { merged: true, mergedAt: '2026-11-08T12:30:00Z', url } }), { marks: [{ prUrl: url, at: '2026-11-08T12:30:00.000Z' }], untimed: false });
    assert.deepEqual(mergeMarksOf({ events: [], pr: { merged: true, mergedAt: null, url } }), { marks: [], untimed: true });
    assert.deepEqual(mergeMarksOf({ events: [] }), { marks: [], untimed: false });
    const tl = taskTimeline({ sessions: [s('a', 'plan', 0, 5, [d('a', 'plan', 0, 1, 4)])], merges: mergeMarksOf({ events: untimed }), now: atMin(10) });
    assert.match(renderTaskTimeline(tl), /merged, time not recorded/);
    assert.doesNotMatch(renderTaskTimeline(tl), /task-timeline-merge"/);
  });

  test('a truncated, incomplete lineage reads "not complete", naming the priced part as priced', () => {
    const sessions = [
      s('a', 'plan', 0, 5, [d('a', 'plan', 0, 1, 4)], { costUsd: 2 }),
      s('b', 'implementation', 6, 5, [d('b', 'implementation', 6, 7, 10)], { costUsd: null, incomplete: true }),
    ];
    const tl = taskTimeline({ sessions, now: atMin(20), totalUsd: null, pricedUsd: 2, lineagesTruncated: true });
    assert.equal(tl.totals.complete, false);
    const html = renderTaskTimeline(tl);
    assert.match(html, /total not complete \(\$2\.00 priced\)/);
    assert.match(html, /cost not complete/);
    assert.match(html, /data-testid="task-timeline-truncated"/);
  });

  test('custom roles: a plain custom base is labelled by its kind, never held', () => {
    const tl = taskTimeline({ sessions: [s('c', 'custom', 0, 5, [d('c', 'custom', 0, 1, 4), d('ci', 'custom', 8, 9, 10, { followUpTo: 'c' })])], now: atMin(20) });
    const [only] = tl.lanes;
    assert.equal(only.role, null);
    assert.deepEqual(only.ticks.map(t => t.role), ['resumed'], 'the ci-wake resume is a resume tick');
    const html = renderTaskTimeline(tl);
    assert.match(html, /data-role="kind" data-kind="custom"/);
    assert.doesNotMatch(html, /· held/);
  });

  test('a dispatch with no records gets a tick and no bar', () => {
    const tl = taskTimeline({ sessions: [s('a', 'autopilot', 0, 30, [d('a', 'autopilot', 0, 1, 2), d('w', 'wake', 10, null, null, { followUpTo: 'a' })])], now: atMin(40) });
    const [only] = tl.lanes;
    assert.equal(only.segments.length, 1);
    assert.deepEqual(only.ticks.map(t => [t.itemId, t.noRecords]), [['w', true]]);
    assert.match(renderTaskTimeline(tl), /no requests recorded/);
  });

  test('late-posted records: a record made before its posting row existed counts toward the earlier dispatch', () => {
    // Split rule C (part 1): every record is posted under f1; the two made before f1 was dispatched move back to b1.
    const row = (id, minute, extra = {}) => ({ _id: id, id, rootItemId: 'b1', issueIdentifier: 'LIN-1', kind: 'implementation', status: 'taken', dispatchedAt: atMin(minute), feedback: [], ...extra });
    const rec = (requestId, minute) => ({ rootItemId: 'b1', itemId: 'f1', requestId, at: atMin(minute), updatedAt: atMin(100), harness: 'claude-code', model: 'claude-haiku-5-5', effort: 'high', inputTokens: 10, outputTokens: 1, cacheCreationInputTokens: 0, cacheCreation1hInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0.1 });
    const read = readCostOverRecords({ fetchedRows: [row('b1', 0), row('f1', 40, { followUpTo: 'b1', kind: 'leftover' })], perDispatch: true }, [rec('q1', 5), rec('q2', 30), rec('o1', 50)]);
    const tl = taskTimeline({ sessions: read.workerSessions, now: atMin(60) });
    const [only] = tl.lanes;
    assert.deepEqual(only.segments.map(seg => [seg.itemId, seg.fromAt, seg.toAt]), [['b1', atMin(5), atMin(30)], ['f1', atMin(50), atMin(50)]]);
  });

  test('a page loop with no cost lineage (a queued item, or a member the read dropped) changes nothing', () => {
    const sessions = [s('a', 'plan', 0, 5, [d('a', 'plan', 0, 1, 4)])];
    const tl = taskTimeline({ sessions, openItemIds: ['queued-only'], now: atMin(10) });
    assert.equal(tl.lanes.length, 1);
    assert.equal(tl.lanes[0].state, 'ended');
    assert.equal(tl.scale.nowPct, null);
  });

  test('no lineage at all reads as no sessions, never a $0 total', () => {
    const tl = taskTimeline({ sessions: [], now: atMin(0), totalUsd: null, pricedUsd: 0 });
    assert.deepEqual(tl.lanes, []);
    assert.match(renderTaskTimeline(tl), /no sessions recorded/);
    assert.doesNotMatch(renderTaskTimeline(tl), /\$/);
    assert.match(renderTaskTimeline({ error: true }), /sessions could not be read/);
  });
});

describe('withoutSpend', () => {
  test('a copy with no dollar field, and the model it was given is untouched', () => {
    const tl = lin4393();
    const before = structuredClone(tl);
    const stripped = withoutSpend(tl);
    assert.deepEqual(tl, before, 'the input (a cached model) is never mutated');
    assert.notEqual(stripped, tl);
    assert.equal(stripped.spend, false);
    assert.doesNotMatch(JSON.stringify(stripped), /costUsd|totalUsd|pricedUsd/);
    const html = renderTaskTimeline(stripped);
    assert.doesNotMatch(html, /\$/);
    assert.match(html, /elapsed 1h 3m · worked 2m 22s/, 'the picture is the same, without dollars');
    assert.equal(withoutSpend(null), null);
    assert.deepEqual(withoutSpend({ error: true }), { error: true, spend: false });
  });

  test('no cost in any attribute, even for an owner', () => {
    const html = renderTaskTimeline(lin4393());
    const attrs = [...html.matchAll(/\s([a-z-]+)="([^"]*)"/g)];
    assert.ok(attrs.length > 50);
    for (const [, name, value] of attrs) {
      assert.doesNotMatch(name, /cost|usd|spend/i, name);
      assert.doesNotMatch(value, /\$/, `${name}="${value}"`);
    }
  });
});

describe('createTaskTimelineReader', () => {
  const read = { workerSessions: [s('a', 'plan', 0, 5, [d('a', 'plan', 0, 1, 4)])], foundedElsewhere: [], totalUsd: 1, pricedUsd: 1, lineagesTruncated: false };

  test('asks readTaskCost for the founded-elsewhere opt-in and no app calls, and uses the events it is handed', async () => {
    const calls = [];
    const store = { listForIssue: async () => { throw new Error('must not be read'); } };
    const readTaskTimeline = createTaskTimelineReader({
      dispatchQueueStore: {}, requestUsageLoader: {}, closeOutEventsStore: store,
      readTaskCost: async (deps, params) => { calls.push(params); return read; },
      now: () => new Date(atMin(10)),
    });
    const events = [{ merged: true, prUrl: 'u', prMergedAt: atMin(6) }];
    const tl = await readTaskTimeline({ urlKey: 'acme', identifier: 'LIN-1', openItemIds: [], closeOutEvents: events });
    assert.deepEqual(calls, [{ urlKey: 'acme', identifier: 'LIN-1', foundedElsewhere: true, caller: 'readTaskTimeline' }]);
    assert.equal(tl.marks.merges.length, 1);
  });

  test('reads the close-out events itself when none are handed in, and a failed read is no merge', async () => {
    const asked = [];
    const readTaskTimeline = createTaskTimelineReader({
      dispatchQueueStore: {}, requestUsageLoader: {},
      closeOutEventsStore: { listForIssue: async (args) => { asked.push(args); throw new Error('down'); } },
      readTaskCost: async () => read,
      now: () => new Date(atMin(10)),
    });
    const tl = await readTaskTimeline({ urlKey: 'acme', identifier: 'LIN-1' });
    assert.deepEqual(asked, [{ urlKey: 'acme', issueIdentifier: 'LIN-1' }]);
    assert.deepEqual(tl.marks, { merges: [], untimedMerge: false });
  });
});

describe('createTimelineFragmentReader', () => {
  function harness() {
    let clock = T0;
    const calls = { state: 0, timeline: 0 };
    let fail = false;
    let release = null;
    const reader = createTimelineFragmentReader({
      loadTaskState: async () => { calls.state += 1; return { model: { sessions: [{ loopId: 'x', open: true }, { loopId: 'y', open: false }] } }; },
      readTaskTimeline: async ({ openItemIds }) => {
        calls.timeline += 1;
        if (release) await release;
        if (fail) throw new Error('down');
        return { openItemIds, n: calls.timeline };
      },
      now: () => new Date(clock),
    });
    return { reader, calls, tick: (ms) => { clock += ms; }, setFail: (v) => { fail = v; }, hold: (p) => { release = p; } };
  }

  test('open ids come from the stored-facts state read; concurrent reads share one; a hit inside the window is cached', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.reader.read({ urlKey: 'k', identifier: 'LIN-1' }), h.reader.read({ urlKey: 'k', identifier: 'LIN-1' })]);
    assert.equal(a, b);
    assert.deepEqual(a.openItemIds, ['x']);
    assert.deepEqual(h.calls, { state: 1, timeline: 1 });
    h.tick(TIMELINE_CACHE_MS - 1);
    await h.reader.read({ urlKey: 'k', identifier: 'LIN-1' });
    assert.equal(h.calls.timeline, 1);
    h.tick(1);
    assert.equal((await h.reader.read({ urlKey: 'k', identifier: 'LIN-1' })).n, 2, 'expired: read again');
  });

  test('a failure is never cached; clear forgets one key and leaves another', async () => {
    const h = harness();
    h.setFail(true);
    await assert.rejects(h.reader.read({ urlKey: 'k', identifier: 'LIN-1' }));
    h.setFail(false);
    await h.reader.read({ urlKey: 'k', identifier: 'LIN-1' });
    await h.reader.read({ urlKey: 'other', identifier: 'LIN-1' });
    assert.equal(h.reader.countFor({ urlKey: 'k' }), 1);
    h.reader.clear({ urlKey: 'k' });
    assert.equal(h.reader.countFor({ urlKey: 'k' }), 0);
    assert.equal(h.reader.countFor({ urlKey: 'other' }), 1);
  });

  test('a read in flight when its key is cleared does not refill the cache', async () => {
    const h = harness();
    let open;
    h.hold(new Promise((resolve) => { open = resolve; }));
    const pending = h.reader.read({ urlKey: 'k', identifier: 'LIN-1' });
    await new Promise(setImmediate);
    h.reader.clear({ urlKey: 'k' });
    open();
    await pending;
    assert.equal(h.reader.countFor({ urlKey: 'k' }), 0);
  });

  test('openItemIdsOf reads the open sessions of a page model', () => {
    assert.deepEqual(openItemIdsOf({ sessions: [{ loopId: 'a', open: true }, { loopId: 'b', open: false }, { open: true }] }), ['a']);
    assert.deepEqual(openItemIdsOf(null), []);
  });
});
