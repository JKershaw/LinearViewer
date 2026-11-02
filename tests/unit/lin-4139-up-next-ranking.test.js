/**
 * LIN-4139 (S3e): Home's Up next shows what is actually next, not the swipe deck's order.
 *
 * Witnesses for the ranking in `upNextOf` (beat 1: written before the implementation, run against the unchanged code).
 * The rule under test: candidates still come from `orderedCards`, but only their membership is used. A card qualifies when
 * it is unstarted, not a seed, not already on Home (drawn or folded), not waiting on an open ruling, and ready (no open
 * card in the set blocks it). Qualifiers are ranked by priority (No priority last), then due date (earliest first, none
 * last), then createdAt (newest first), then position in the project trees. One card per top-level epic, cap UP_NEXT_LIMIT,
 * never padded. Each row carries a `why` string built from absolute dates, never from the clock.
 *
 * Witness status (see the PR for the captured output): tests named "[witness]" fail on the unchanged code; tests named
 * "[guard]" already pass and pin behaviour the change must keep.
 *
 * The `why` format is the spec written here: `<priority name> · due <date>` when a due date exists, else
 * `<priority name> · added <date>`, then ` · unblocks N` when the card's downstreamUnblocks is at least 1. Dates are UTC,
 * `D Mon YYYY`. Priority names follow Linear: 0 No priority, 1 Urgent, 2 High, 3 Medium, 4 Low.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeView, UP_NEXT_LIMIT } from '../../lib/home-view.js';
import { orderIssuesForSwipe } from '../../lib/task-board-view.js';
import { homeRowsFor } from '../../lib/home-rows.js';
import { renderHomeRowsHtml, homeRowsContext } from '../../lib/render.js';

// ---- fixtures ----------------------------------------------------------------------------------------------------

const node = (identifier, type, children = [], over = {}) => ({
  issue: { id: identifier, identifier, title: identifier, state: { type }, ...over },
  children,
  depth: 0,
});
const ids = nodes => nodes.map(n => n.issue.identifier);
const states = entries => new Map(Object.entries(entries));
const project = (id, name, incomplete, completed = []) => ({
  project: { id, name, collapsed: false },
  incomplete,
  completed,
  completedCount: completed.length,
});
const inProgress = (projectId, roots) => [{ projectId, projectName: projectId, roots }];
/** An ordered card as `orderIssuesForSwipe` makes one; `extra` carries the graph features the deck stamps on it. */
const card = (identifier, extra = {}) => ({ id: `id-${identifier}`, identifier, isSeed: false, ...extra });
const cardsIn = order => order.map(c => (typeof c === 'string' ? card(c) : c));
/** Home with no Running view and no rulings unless the test gives them. */
const up = (trees, order, extra = {}) => buildHomeView({
  inProgressTrees: [],
  trees,
  states: states({}),
  orderedCards: cardsIn(order),
  ...extra,
});

// ---- ranking: priority, due date, newest, tree position ----------------------------------------------------------

describe('LIN-4139: Up next ranks by priority, due date, newest, then tree position', () => {
  test('[witness] priority before age: a High task created in August is Up next before a Medium task created on 30 Oct, whatever the deck order', () => {
    const trees = [project('p', 'Alpha', [
      node('OLD-HIGH', 'unstarted', [], { priority: 2, createdAt: '2026-08-01T09:00:00.000Z', dueDate: null }),
      node('NEW-MED', 'unstarted', [], { priority: 3, createdAt: '2026-10-30T09:00:00.000Z', dueDate: null }),
    ])];
    const view = up(trees, ['NEW-MED', 'OLD-HIGH']);
    assert.deepEqual(ids(view.upNext), ['OLD-HIGH', 'NEW-MED']);
  });

  test('[witness] the Linear priority ladder: Urgent, High, Medium, Low, then No priority; the created dates are equal, so priority alone decides', () => {
    const same = { createdAt: '2026-10-20T09:00:00.000Z', dueDate: null };
    const trees = [project('p', 'Alpha', [
      node('NOP', 'unstarted', [], { priority: 0, ...same }),
      node('LOW', 'unstarted', [], { priority: 4, ...same }),
      node('MED', 'unstarted', [], { priority: 3, ...same }),
      node('HIGH', 'unstarted', [], { priority: 2, ...same }),
      node('URG', 'unstarted', [], { priority: 1, ...same }),
    ])];
    const view = up(trees, ['NOP', 'LOW', 'MED', 'HIGH', 'URG']);
    assert.deepEqual(ids(view.upNext), ['URG', 'HIGH', 'MED', 'LOW', 'NOP']);
  });

  test('[witness] within one priority, a due date comes first (earliest first), then the newest created, then the older ones', () => {
    const trees = [project('p', 'Alpha', [
      node('OLDER', 'unstarted', [], { priority: 2, createdAt: '2026-10-01T09:00:00.000Z', dueDate: null }),
      node('NEWEST', 'unstarted', [], { priority: 2, createdAt: '2026-10-31T09:00:00.000Z', dueDate: null }),
      node('LATER-DUE', 'unstarted', [], { priority: 2, createdAt: '2026-08-01T09:00:00.000Z', dueDate: '2026-11-20' }),
      node('DUE', 'unstarted', [], { priority: 2, createdAt: '2026-08-01T09:00:00.000Z', dueDate: '2026-11-05' }),
    ])];
    const view = up(trees, ['OLDER', 'LATER-DUE', 'NEWEST', 'DUE']);
    assert.deepEqual(ids(view.upNext), ['DUE', 'LATER-DUE', 'NEWEST', 'OLDER']);
  });

  test('[witness] within one priority and no due dates, the newest created comes first; the due date does not outrank a higher priority', () => {
    const trees = [project('p', 'Alpha', [
      node('HIGH-OLD-DUE', 'unstarted', [], { priority: 2, createdAt: '2026-08-01T09:00:00.000Z', dueDate: '2026-11-05' }),
      node('MED-NEW-DUE', 'unstarted', [], { priority: 3, createdAt: '2026-10-31T09:00:00.000Z', dueDate: '2026-11-03' }),
    ])];
    const view = up(trees, ['MED-NEW-DUE', 'HIGH-OLD-DUE']);
    assert.deepEqual(ids(view.upNext), ['HIGH-OLD-DUE', 'MED-NEW-DUE']);
  });

  test('[witness] equal priority, due date and created: the position in the project trees decides, then project order before sibling order', () => {
    const same = { priority: 2, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null };
    const trees = [
      project('a', 'Alpha', [node('ALPHA-1', 'unstarted', [], same), node('ALPHA-2', 'unstarted', [], same)]),
      project('b', 'Beta', [node('BETA-1', 'unstarted', [], same)]),
    ];
    const view = up(trees, ['BETA-1', 'ALPHA-2', 'ALPHA-1']);
    assert.deepEqual(ids(view.upNext), ['ALPHA-1', 'ALPHA-2', 'BETA-1']);
  });

  test('[witness] the result does not depend on the deck order: three shuffles of the same pool give one list', () => {
    const trees = [project('p', 'Alpha', [
      node('A', 'unstarted', [], { priority: 3, createdAt: '2026-10-02T09:00:00.000Z', dueDate: null }),
      node('B', 'unstarted', [], { priority: 2, createdAt: '2026-09-01T09:00:00.000Z', dueDate: '2026-11-12' }),
      node('C', 'unstarted', [], { priority: 2, createdAt: '2026-10-25T09:00:00.000Z', dueDate: null }),
      node('D', 'unstarted', [], { priority: 4, createdAt: '2026-10-29T09:00:00.000Z', dueDate: null }),
      node('E', 'unstarted', [], { priority: 0, createdAt: '2026-10-30T09:00:00.000Z', dueDate: null }),
      node('F', 'unstarted', [], { priority: 1, createdAt: '2026-07-01T09:00:00.000Z', dueDate: null }),
    ])];
    const forward = ids(up(trees, ['A', 'B', 'C', 'D', 'E', 'F']).upNext);
    const reversed = ids(up(trees, ['F', 'E', 'D', 'C', 'B', 'A']).upNext);
    const rotated = ids(up(trees, ['C', 'D', 'E', 'F', 'A', 'B']).upNext);
    assert.deepEqual(reversed, forward);
    assert.deepEqual(rotated, forward);
    assert.deepEqual(forward, ['F', 'B', 'C', 'A', 'D']);
  });

  test('[witness] No priority ranks after Low: a Low task outranks a No priority task even when the No priority task is newer', () => {
    const trees = [project('p', 'Alpha', [
      node('NOP-NEW', 'unstarted', [], { priority: 0, createdAt: '2026-10-31T09:00:00.000Z', dueDate: null }),
      node('LOW-OLD', 'unstarted', [], { priority: 4, createdAt: '2026-08-01T09:00:00.000Z', dueDate: null }),
    ])];
    const view = up(trees, ['NOP-NEW', 'LOW-OLD']);
    assert.deepEqual(ids(view.upNext), ['LOW-OLD', 'NOP-NEW']);
  });

  test('[witness] an all-No-priority pool still fills to the cap of five, newest first (fixtures with no priority keep their five)', () => {
    const list = Array.from({ length: 6 }, (_, i) => node(`N${i + 1}`, 'unstarted', [], {
      priority: 0,
      createdAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
      dueDate: null,
    }));
    const view = up([project('p', 'Alpha', list)], list.map(n => n.issue.identifier));
    assert.equal(view.upNext.length, UP_NEXT_LIMIT);
    assert.deepEqual(ids(view.upNext), ['N6', 'N5', 'N4', 'N3', 'N2']);
  });

  test('[guard] fewer qualifying tasks show fewer rows, never padded; none qualifying gives an empty list', () => {
    const three = [1, 2, 3].map(i => node(`T${i}`, 'unstarted', [], { priority: 2, createdAt: '2026-10-01T09:00:00.000Z', dueDate: null }));
    assert.equal(up([project('p', 'Alpha', three)], ['T1', 'T2', 'T3']).upNext.length, 3);
    assert.deepEqual(up([project('p', 'Alpha', [])], []).upNext, []);
  });

  test('[witness] capped at five: eight single-task epics give the five newest of the High tasks', () => {
    const list = Array.from({ length: 8 }, (_, i) => node(`C-${i + 1}`, 'unstarted', [], {
      priority: 2,
      createdAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
      dueDate: null,
    }));
    const view = up([project('p', 'Alpha', list)], list.map(n => n.issue.identifier));
    assert.deepEqual(ids(view.upNext), ['C-8', 'C-7', 'C-6', 'C-5', 'C-4']);
  });
});

// ---- one card per top-level epic --------------------------------------------------------------------------------

describe('LIN-4139: one card per top-level epic', () => {
  test('[witness] two children of one epic are one card: the epic\'s best child, and the other epic\'s card, not the epic and its children', () => {
    const trees = [project('p', 'Alpha', [
      node('EP', 'unstarted', [
        node('EP-a', 'unstarted', [], { priority: 2, createdAt: '2026-08-01T09:00:00.000Z', dueDate: null }),
        node('EP-b', 'unstarted', [], { priority: 2, createdAt: '2026-10-30T09:00:00.000Z', dueDate: null }),
      ], { priority: 4, createdAt: '2026-07-01T09:00:00.000Z', dueDate: null }),
      node('SOLO', 'unstarted', [], { priority: 3, createdAt: '2026-10-15T09:00:00.000Z', dueDate: null }),
    ])];
    const view = up(trees, ['EP', 'EP-a', 'EP-b', 'SOLO']);
    assert.deepEqual(ids(view.upNext), ['EP-b', 'SOLO']);
  });

  test('[witness] a grandchild counts toward its top-level epic: a deep task under the same epic is not a second card', () => {
    const trees = [project('p', 'Alpha', [
      node('TOP', 'unstarted', [
        node('MID', 'unstarted', [
          node('DEEP', 'unstarted', [], { priority: 2, createdAt: '2026-10-30T09:00:00.000Z', dueDate: null }),
        ], { priority: 3, createdAt: '2026-09-01T09:00:00.000Z', dueDate: null }),
        node('MID-2', 'unstarted', [], { priority: 2, createdAt: '2026-10-01T09:00:00.000Z', dueDate: null }),
      ], { priority: 4, createdAt: '2026-07-01T09:00:00.000Z', dueDate: null }),
      node('OTHER', 'unstarted', [], { priority: 3, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null }),
    ])];
    const view = up(trees, ['TOP', 'MID', 'DEEP', 'MID-2', 'OTHER']);
    assert.deepEqual(ids(view.upNext), ['DEEP', 'OTHER']);
  });
});

// ---- eligibility: on Home, waiting, seed, ready -----------------------------------------------------------------

describe('LIN-4139: eligibility', () => {
  test('[guard] a task already on Home is not Up next: an unstarted child folded under a started parent in Running', () => {
    const kid = node('KID-1', 'unstarted', [], { priority: 2, createdAt: '2026-10-31T09:00:00.000Z', dueDate: null });
    const runRoot = node('RUN-1', 'started', [kid], { priority: 2, createdAt: '2026-06-01T09:00:00.000Z', dueDate: null });
    const free = node('FREE-1', 'unstarted', [], { priority: 3, createdAt: '2026-10-01T09:00:00.000Z', dueDate: null });
    const view = buildHomeView({
      inProgressTrees: inProgress('p', [runRoot]),
      trees: [project('p', 'Alpha', [runRoot, free])],
      states: states({}),
      orderedCards: cardsIn(['KID-1', 'FREE-1']),
    });
    assert.deepEqual(ids(view.upNext), ['FREE-1']);
  });

  test('[guard] a cross-project child of a task in Running is not Up next (it is folded under its parent, LIN-4145)', () => {
    const parent = node('PAR-1', 'started', [], { priority: 2, createdAt: '2026-06-01T09:00:00.000Z', dueDate: null });
    const child = node('XCHILD', 'unstarted', [], {
      priority: 1,
      createdAt: '2026-10-31T09:00:00.000Z',
      dueDate: null,
      parent: { id: 'PAR-1' },
    });
    const view = buildHomeView({
      inProgressTrees: inProgress('alpha', [parent]),
      trees: [project('alpha', 'Alpha', [parent]), project('beta', 'Beta', [child])],
      states: states({}),
      orderedCards: cardsIn(['XCHILD']),
    });
    assert.deepEqual(ids(view.upNext), []);
  });

  test('[guard] a task waiting on an open ruling is not Up next (LIN-4114 skip, kept when this ranking rebases)', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'Alpha', [
        node('WAIT-1', 'unstarted', [], { priority: 1, createdAt: '2026-10-31T09:00:00.000Z', dueDate: null }),
        node('FREE-2', 'unstarted', [], { priority: 4, createdAt: '2026-08-01T09:00:00.000Z', dueDate: null }),
      ])],
      states: states({}),
      orderedCards: cardsIn(['WAIT-1', 'FREE-2']),
      rulingRows: [{ anchor: { issueIdentifier: 'WAIT-1' } }],
    });
    assert.deepEqual(ids(view.upNext), ['FREE-2']);
  });

  test('[guard] a seed is never Up next, however high its priority or how new it is', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'Alpha', [
        node('SEED-1', 'unstarted', [], { priority: 1, createdAt: '2026-10-31T09:00:00.000Z', dueDate: null }),
        node('REAL-1', 'unstarted', [], { priority: 4, createdAt: '2026-08-01T09:00:00.000Z', dueDate: null }),
      ])],
      states: states({}),
      orderedCards: [card('SEED-1', { isSeed: true }), card('REAL-1')],
    });
    assert.deepEqual(ids(view.upNext), ['REAL-1']);
  });

  test('[witness] a task blocked by an open task is not ready, so it is not Up next; its open blocker is (orderIssuesForSwipe cards)', () => {
    // A blocks B, and A is open. B is not ready, so the ranking must leave it out even though it is High and newer.
    const a = { id: 'id-A', identifier: 'A', title: 'A', state: { type: 'unstarted' }, priority: 4, createdAt: '2026-08-01T09:00:00.000Z', dueDate: null, relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'id-B' } }] } };
    const b = { id: 'id-B', identifier: 'B', title: 'B', state: { type: 'unstarted' }, priority: 2, createdAt: '2026-10-31T09:00:00.000Z', dueDate: null, relations: { nodes: [] } };
    const projectTrees = [project('p', 'Alpha', [{ issue: a, children: [], depth: 0 }, { issue: b, children: [], depth: 0 }])];
    const cards = orderIssuesForSwipe({ projectTrees, inProgressTrees: [], recentActivityTrees: [], urlKey: null });
    const view = buildHomeView({ inProgressTrees: [], trees: projectTrees, states: states({}), orderedCards: cards });
    assert.deepEqual(ids(view.upNext), ['A']);
  });

  test('[guard] a task blocked only by a done task is ready, so it is Up next (the resolved block is not a blocker)', () => {
    const done = { id: 'id-D', identifier: 'D', title: 'D', state: { type: 'completed' }, priority: 2, createdAt: '2026-08-01T09:00:00.000Z', dueDate: null, completedAt: '2026-10-28T09:00:00.000Z', relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'id-B' } }] } };
    const b = { id: 'id-B', identifier: 'B', title: 'B', state: { type: 'unstarted' }, priority: 2, createdAt: '2026-10-31T09:00:00.000Z', dueDate: null, relations: { nodes: [] } };
    const projectTrees = [project('p', 'Alpha', [{ issue: b, children: [], depth: 0 }], [{ issue: done, children: [], depth: 0 }])];
    const cards = orderIssuesForSwipe({ projectTrees, inProgressTrees: [], recentActivityTrees: [], urlKey: null });
    const view = buildHomeView({ inProgressTrees: [], trees: projectTrees, states: states({}), orderedCards: cards });
    assert.deepEqual(ids(view.upNext), ['B']);
  });
});

// ---- the "why" line ---------------------------------------------------------------------------------------------

describe('LIN-4139: each Up next row says why it is there, in absolute dates', () => {
  test('[witness] a High task with no due date says its priority and when it was added', () => {
    const trees = [project('p', 'Alpha', [
      node('W-1', 'unstarted', [], { priority: 2, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null }),
    ])];
    const view = up(trees, ['W-1']);
    assert.equal(view.upNext[0].why, 'High · added 20 Oct 2026');
  });

  test('[witness] No priority is named as such', () => {
    const trees = [project('p', 'Alpha', [
      node('W-2', 'unstarted', [], { priority: 0, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null }),
    ])];
    assert.equal(up(trees, ['W-2']).upNext[0].why, 'No priority · added 20 Oct 2026');
  });

  test('[witness] a due date replaces "added", and "unblocks N" appears only when the card unblocks one or more', () => {
    const trees = [project('p', 'Alpha', [
      node('W-3', 'unstarted', [], { priority: 2, createdAt: '2026-10-20T09:00:00.000Z', dueDate: '2026-11-04' }),
      node('W-4', 'unstarted', [], { priority: 3, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null }),
    ])];
    const view = up(trees, [card('W-3', { downstreamUnblocks: 2 }), card('W-4', { downstreamUnblocks: 1 })]);
    assert.deepEqual(view.upNext.map(row => row.why), [
      'High · due 4 Nov 2026 · unblocks 2',
      'Medium · added 20 Oct 2026 · unblocks 1',
    ]);
  });

  test('[witness] no unblocks suffix at zero', () => {
    const trees = [project('p', 'Alpha', [
      node('W-5', 'unstarted', [], { priority: 2, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null }),
    ])];
    assert.equal(up(trees, [card('W-5', { downstreamUnblocks: 0 })]).upNext[0].why, 'High · added 20 Oct 2026');
  });

  test('[witness] the label does not depend on the clock: moving Date.now does not change the ranking or the text', (t) => {
    const trees = [project('p', 'Alpha', [
      node('CLK-1', 'unstarted', [], { priority: 2, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null }),
      node('CLK-2', 'unstarted', [], { priority: 3, createdAt: '2026-10-31T09:00:00.000Z', dueDate: null }),
    ])];
    const snapshot = () => up(trees, ['CLK-2', 'CLK-1']).upNext.map(row => [row.issue.identifier, row.why]);
    t.mock.method(Date, 'now', () => Date.parse('2026-11-02T09:00:00.000Z'));
    const nearNow = snapshot();
    Date.now.mock.restore();
    t.mock.method(Date, 'now', () => Date.parse('2031-03-14T23:59:59.000Z'));
    const farFuture = snapshot();
    assert.deepEqual(farFuture, nearNow);
    assert.deepEqual(nearNow, [['CLK-1', 'High · added 20 Oct 2026'], ['CLK-2', 'Medium · added 31 Oct 2026']]);
  });
});

// ---- close-out additions (review ledger items 2, 3, 5) -----------------------------------------------------------

describe('LIN-4139 close-out: the rendered why line (ledger 2)', () => {
  const WORKSPACE = { urlKey: 'ws', name: 'WS', provider: 'linear' };
  const ctx = homeRowsContext({ workspace: WORKSPACE, urlKey: 'ws', featureFlags: {}, rowStates: null });
  const WHY_RE = /^(Urgent|High|Medium|Low|No priority) · (added|due) \d{1,2} [A-Z][a-z]{2} \d{4}( · unblocks \d+)?$/;
  const whyTexts = html => [...html.matchAll(/<span class="up-next-why" data-testid="up-next-why">([^<]*)<\/span>/g)].map(m => m[1]);

  test('[witness] each Up next row renders exactly one up-next-why span carrying the exact text', () => {
    const trees = [project('p', 'Alpha', [
      node('R-1', 'unstarted', [], { priority: 2, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null }),
      node('R-2', 'unstarted', [], { priority: 3, createdAt: '2026-10-21T09:00:00.000Z', dueDate: '2026-11-04' }),
    ])];
    const view = up(trees, [card('R-1', { downstreamUnblocks: 2 }), card('R-2')]);
    const html = renderHomeRowsHtml(view.upNext, { section: 'home-up-next', parentId: 'home-up-next-root', ctx });
    assert.equal((html.match(/data-testid="up-next-why"/g) || []).length, view.upNext.length, 'one why span per row');
    assert.deepEqual(whyTexts(html), ['High · added 20 Oct 2026 · unblocks 2', 'Medium · due 4 Nov 2026']);
    for (const text of whyTexts(html)) assert.match(text, WHY_RE);
  });

  test('[witness] the why text is HTML-escaped', () => {
    const trees = [project('p', 'Alpha', [node('R-3', 'unstarted', [], { priority: 2, createdAt: '2026-10-20T09:00:00.000Z' })])];
    const view = up(trees, ['R-3']);
    view.upNext[0].why = '<img src=x onerror=alert(1)> & co';
    const html = renderHomeRowsHtml(view.upNext, { section: 'home-up-next', parentId: 'home-up-next-root', ctx });
    assert.ok(!html.includes('<img src=x'), 'the raw tag is not in the output');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; co'));
  });

  test('[guard] no up-next-why on Running or recent rows, even when a row carries a why', () => {
    const trees = [project('p', 'Alpha', [node('R-4', 'started', [], { priority: 2 })])];
    const view = up(trees, []);
    const running = view.inProgressTrees.flatMap(t => t.roots).concat(trees[0].incomplete);
    running.forEach(n => { n.why = 'High · added 20 Oct 2026'; });
    for (const section of ['in-progress', 'recent-activity']) {
      const html = renderHomeRowsHtml(running, { section, parentId: 'x', ctx });
      assert.ok(!html.includes('up-next-why'), `${section} rows carry no why line`);
    }
  });
});

describe('LIN-4139 close-out: a Waiting task\'s children are exempt from the one-per-epic cap (ledger 3)', () => {
  test('[witness] two same-priority children of a Waiting epic are both Up next, beside another epic\'s card', () => {
    const same = { priority: 2, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null };
    const trees = [project('p', 'Alpha', [
      node('W-EPIC', 'started', [
        node('W-KID-1', 'unstarted', [], same),
        node('W-KID-2', 'unstarted', [], same),
      ], { priority: 2 }),
      node('OTHER', 'unstarted', [], { priority: 3, createdAt: '2026-10-25T09:00:00.000Z', dueDate: null }),
    ])];
    const view = buildHomeView({
      inProgressTrees: [],
      trees,
      states: states({}),
      orderedCards: cardsIn(['W-KID-1', 'W-KID-2', 'OTHER']),
      rulingRows: [{ anchor: { issueIdentifier: 'W-EPIC' } }],
    });
    assert.deepEqual(ids(view.upNext).sort(), ['OTHER', 'W-KID-1', 'W-KID-2']);
  });
});

describe('LIN-4139 close-out: the page and /api/home-rows agree (ledger 5)', () => {
  test('[witness] the recent fold pages exactly view.recent.rest, and a card the ranking moves to Up next is in neither', () => {
    const recentIds = Array.from({ length: 70 }, (_, i) => `RC-${i + 1}`);
    const recentForest = [{
      projectId: null,
      projectName: null,
      roots: recentIds.map(identifier => ({
        issue: { id: identifier, identifier, title: identifier, state: { type: 'unstarted' } },
        children: [],
        depth: 0,
        projectName: 'p',
        activityKind: 'created',
      })),
    }];
    const trees = [project('p', 'Alpha', [
      node('RC-15', 'unstarted', [], { priority: 2, createdAt: '2026-10-20T09:00:00.000Z', dueDate: null }),
    ])];
    const input = { inProgressTrees: [], trees, recentActivityTrees: recentForest, states: states({}), orderedCards: cardsIn(['RC-15']) };
    const view = buildHomeView(input);
    assert.deepEqual(ids(view.upNext), ['RC-15'], 'the ranking puts RC-15 in Up next');
    const paged = [];
    let offset = 0;
    for (;;) {
      const page = homeRowsFor({ ...input, kind: 'recent', offset });
      paged.push(...ids(page.nodes));
      if (page.nextOffset == null) break;
      offset = page.nextOffset;
    }
    assert.deepEqual(paged, ids(view.recent.rest), 'the fold pages exactly the page view\'s rest');
    assert.ok(!paged.includes('RC-15') && !ids(view.recent.nodes).includes('RC-15'), 'RC-15 is drawn once, in Up next');
    assert.equal(ids(view.recent.nodes).length + paged.length, 69);
  });
});
