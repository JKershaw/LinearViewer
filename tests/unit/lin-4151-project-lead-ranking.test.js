/**
 * LIN-4151: a project's lead list on `/workspace/:urlKey/backlog` is ranked, not in project tree order.
 *
 * The page's three shown roots (`buildHomeView`'s `trees`) and the `up-next` fold (`homeRowsFor`) must read one ranked
 * sequence: ready roots before blocked ones, then priority, due date, newest created, then tree position (`compareRank`).
 * Readiness is a sort key, never a filter, so a blocked root stays reachable. Wrote before the change: W1 to W5 fail on the
 * unchanged code, W6 pins the all-keys-tie order that must survive.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeView } from '../../lib/home-view.js';
import { homeRowsFor } from '../../lib/home-rows.js';

// ---- fixtures ----------------------------------------------------------------------------------------------------

const node = (identifier, type, children = [], over = {}) => ({
  issue: { id: identifier, identifier, title: identifier, state: { type }, ...over },
  children,
  depth: 0,
});
const ids = nodes => nodes.map(n => n.issue.identifier);
const project = (id, name, incomplete, completed = []) => ({
  project: { id, name, collapsed: false },
  incomplete,
  completed,
  completedCount: completed.length,
});
/** An ordered card as `orderIssuesForSwipe` makes one. `extra` carries `key` and `blocksIds` for the readiness graph. */
const card = (identifier, extra = {}) => ({ id: `id-${identifier}`, identifier, isSeed: false, ...extra });
const cardsOf = list => list.map(c => (typeof c === 'string' ? card(c) : c));

/**
 * What the `/backlog` page shows for one project (the view's three roots), and every row its `up-next` fold pages, read
 * the way the page and the fold read them: one view, then the fold's own request, page by page.
 */
function leadListOf(trees, projectId, orderedCards) {
  const view = buildHomeView({ inProgressTrees: [], trees, states: new Map(), orderedCards });
  const shown = view.trees.find(tree => tree.project.id === projectId).incomplete;
  const folded = [];
  let offset = 0;
  do {
    const page = homeRowsFor({ kind: 'up-next', projectId, offset, trees, inProgressTrees: [], orderedCards, states: new Map() });
    folded.push(...page.nodes);
    offset = page.nextOffset;
  } while (offset !== null);
  return { shown, folded, view };
}

const T = {
  '2026-06-01': '2026-06-01T09:00:00.000Z',
  '2026-08-01': '2026-08-01T09:00:00.000Z',
  '2026-09-01': '2026-09-01T09:00:00.000Z',
  '2026-09-15': '2026-09-15T09:00:00.000Z',
  '2026-10-01': '2026-10-01T09:00:00.000Z',
  '2026-10-20': '2026-10-20T09:00:00.000Z',
  '2026-10-25': '2026-10-25T09:00:00.000Z',
  '2026-10-30': '2026-10-30T09:00:00.000Z',
  '2026-10-31': '2026-10-31T09:00:00.000Z',
};

// ---- the page's three and the fold come from one ranking ---------------------------------------------------------

describe('LIN-4151: a project lead list is ranked, and the page and the fold share that order', () => {
  test('[witness] a High ready root fourth in tree order is among the three shown, and the fold does not return it', () => {
    const trees = [project('p', 'Alpha', [
      node('LOW-OLD', 'unstarted', [], { priority: 4, createdAt: T['2026-08-01'], dueDate: null }),
      node('MED-A', 'unstarted', [], { priority: 3, createdAt: T['2026-09-01'], dueDate: null }),
      node('MED-B', 'unstarted', [], { priority: 3, createdAt: T['2026-09-15'], dueDate: null }),
      node('HIGH-LATE', 'unstarted', [], { priority: 2, createdAt: T['2026-10-20'], dueDate: null }),
    ])];
    const { shown, folded } = leadListOf(trees, 'p', cardsOf(['LOW-OLD', 'MED-A', 'MED-B', 'HIGH-LATE']));
    assert.deepEqual(ids(shown), ['HIGH-LATE', 'MED-B', 'MED-A']);
    assert.deepEqual(ids(folded), ['LOW-OLD']);
  });

  test('[witness] a root blocked by an open card ranks behind a ready Low root, and is still shown (readiness sorts, it does not filter)', () => {
    const trees = [project('p', 'Alpha', [
      node('HIGH-BLOCKED', 'unstarted', [], { priority: 2, createdAt: T['2026-08-01'], dueDate: null }),
      node('LOW-READY', 'unstarted', [], { priority: 4, createdAt: T['2026-08-01'], dueDate: null }),
    ])];
    // The blocker is open and in the deck; the blocked root is keyed `key-HIGH`, so the lookup must use the key, not the id.
    const orderedCards = cardsOf([
      card('HIGH-BLOCKED', { key: 'key-HIGH' }),
      card('LOW-READY'),
      card('WALL', { blocksIds: ['key-HIGH'] }),
    ]);
    const { shown, folded } = leadListOf(trees, 'p', orderedCards);
    assert.deepEqual(ids(shown), ['LOW-READY', 'HIGH-BLOCKED']);
    assert.deepEqual(ids(folded), []);
  });

  test('[witness] the whole project: the page and the fold give one ranked sequence, each root once, for any deck order', () => {
    // Tree order: a done parent whose open child is lifted into the project's roots, then the ready roots, then one blocked.
    const trees = [project('p', 'Alpha', [
      node('DONE-PARENT', 'completed', [
        node('LIFTED', 'unstarted', [], { priority: 1, createdAt: T['2026-06-01'], dueDate: null }),
      ]),
      node('A1', 'unstarted', [], { priority: 3, createdAt: T['2026-10-01'], dueDate: null }),
      node('A2', 'unstarted', [], { priority: 3, createdAt: T['2026-10-20'], dueDate: null }),
      node('A3', 'unstarted', [], { priority: 2, createdAt: T['2026-08-01'], dueDate: '2026-11-20' }),
      node('A4', 'unstarted', [], { priority: 2, createdAt: T['2026-08-01'], dueDate: '2026-11-10' }),
      node('B1', 'unstarted', [], { priority: 2, createdAt: T['2026-10-30'], dueDate: null }),
      node('LOW', 'unstarted', [], { priority: 4, createdAt: T['2026-10-25'], dueDate: null }),
      node('NOP', 'unstarted', [], { priority: 0, createdAt: T['2026-10-31'], dueDate: null }),
      node('BLK', 'unstarted', [], { priority: 1, createdAt: T['2026-06-01'], dueDate: null }),
    ])];
    const expected = ['LIFTED', 'A4', 'A3', 'B1', 'A2', 'A1', 'LOW', 'NOP', 'BLK'];
    const cards = ['A1', 'A2', 'A3', 'A4', 'B1', 'LOW', 'NOP', 'LIFTED', 'DONE-PARENT'];
    const blockedCards = [...cardsOf(cards), card('BLK', { key: 'key-BLK' }), card('WALL', { blocksIds: ['key-BLK'] })];
    const forward = leadListOf(trees, 'p', blockedCards);
    const reversed = leadListOf(trees, 'p', [...blockedCards].reverse());
    for (const lead of [forward, reversed]) {
      assert.deepEqual([...ids(lead.shown), ...ids(lead.folded)], expected);
      assert.equal(new Set([...ids(lead.shown), ...ids(lead.folded)]).size, expected.length, 'each root once');
    }
    assert.ok(!ids(forward.shown).includes('DONE-PARENT'), 'a done root is never shown');
  });

  test('[witness] Home\'s Up next and the project lead list rank the same roots the same way', () => {
    const trees = [project('p', 'Alpha', [
      node('P1', 'unstarted', [], { priority: 4, createdAt: T['2026-08-01'], dueDate: null }),
      node('P2', 'unstarted', [], { priority: 3, createdAt: T['2026-09-01'], dueDate: null }),
      node('P3', 'unstarted', [], { priority: 1, createdAt: T['2026-10-01'], dueDate: null }),
      node('P4', 'unstarted', [], { priority: 3, createdAt: T['2026-10-20'], dueDate: null }),
      node('P5', 'unstarted', [], { priority: 2, createdAt: T['2026-10-30'], dueDate: null }),
    ])];
    const { shown, folded, view } = leadListOf(trees, 'p', cardsOf(['P1', 'P2', 'P3', 'P4', 'P5']));
    assert.equal(folded.length + shown.length, 5);
    assert.deepEqual(ids(view.upNext), [...ids(shown), ...ids(folded)]);
  });

  test('[witness] a custom-state root is always shown and counts toward the three, at its ranked place', () => {
    // CUSTOM is Urgent, so it ranks first and takes one of the three; the Low unstarted root falls to the fold.
    const first = [project('p', 'Alpha', [
      node('U1', 'unstarted', [], { priority: 3, createdAt: T['2026-09-01'], dueDate: null }),
      node('U2', 'unstarted', [], { priority: 3, createdAt: T['2026-09-15'], dueDate: null }),
      node('U3', 'unstarted', [], { priority: 4, createdAt: T['2026-08-01'], dueDate: null }),
      node('CUSTOM', 'in-review', [], { priority: 1, createdAt: T['2026-08-01'], dueDate: null }),
    ])];
    const ranked = leadListOf(first, 'p', cardsOf(['U1', 'U2', 'U3', 'CUSTOM']));
    assert.deepEqual(ids(ranked.shown), ['CUSTOM', 'U2', 'U1']);
    assert.deepEqual(ids(ranked.folded), ['U3']);

    // CUSTOM is Low, so it ranks last behind three unstarted roots; it is still shown, so the page draws four rows.
    const last = [project('p', 'Alpha', [
      node('CUSTOM', 'in-review', [], { priority: 4, createdAt: T['2026-06-01'], dueDate: null }),
      node('U1', 'unstarted', [], { priority: 2, createdAt: T['2026-09-01'], dueDate: null }),
      node('U2', 'unstarted', [], { priority: 2, createdAt: T['2026-09-15'], dueDate: null }),
      node('U3', 'unstarted', [], { priority: 2, createdAt: T['2026-10-01'], dueDate: null }),
    ])];
    const behind = leadListOf(last, 'p', cardsOf(['CUSTOM', 'U1', 'U2', 'U3']));
    assert.deepEqual(ids(behind.shown), ['U3', 'U2', 'U1', 'CUSTOM']);
    assert.deepEqual(ids(behind.folded), []);
  });

  test('[guard] when every ranking key ties, the lead list keeps tree order (the pinned fixtures\' shape)', () => {
    const trees = [project('p', 'Alpha', [
      node('T1', 'unstarted', [], { priority: 0, createdAt: null, dueDate: null }),
      node('T2', 'unstarted', [], { priority: 0, createdAt: null, dueDate: null }),
      node('T3', 'unstarted', [], { priority: 0, createdAt: null, dueDate: null }),
      node('T4', 'unstarted', [], { priority: 0, createdAt: null, dueDate: null }),
    ])];
    const { shown, folded } = leadListOf(trees, 'p', cardsOf(['T4', 'T2', 'T3', 'T1']));
    assert.deepEqual(ids(shown), ['T1', 'T2', 'T3']);
    assert.deepEqual(ids(folded), ['T4']);
  });
});
