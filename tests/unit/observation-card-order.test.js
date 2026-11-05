// LIN-964: Session cards must NOT reorder when a card is expanded.
//
// The defect: the LIN-783 freeze guard skipped only the expanded card while
// re-appending every OTHER card each poll, which floated the expanded card to
// the top of its section on the first poll after expand ([A,B,C,D] + expand B
// → [B,A,C,D]). The fix freezes the whole list order while any card is open.
//
// public/observation.js is a browser script (not an ES module). It runs through
// `loadWorld` over the shared fake DOM (tests/unit/helpers/fake-dom.js), so the
// cards `diffSessionList` builds are real elements in the world's document, and
// order is read back the way a page shows it: the list's children, each card's
// `data-session` attribute (`dataset.session`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';
import { loadCommonWindow } from '../fixtures/client-common.js';
import { buildSessionPayload } from '../../routes/dashboard-feed.js';

const LIST_ID = 'obs-active';
const EMPTY_ID = 'obs-active-empty';

/**
 * observation.js loaded into a world, with the globals the page gets from common.js and the
 * window stubs the list reaches at load. Nothing here is a fake element: the list and the
 * empty state are real nodes in the world's document, added below.
 */
function loadObservation() {
  const world = loadWorld({
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendOptions() {} },
      sourceQuery: () => '',
      // The card head paints its status pill with common.js's helpers, which the page loads first.
      renderStatusPill: loadCommonWindow().renderStatusPill,
      renderSegmentBar: loadCommonWindow().renderSegmentBar,
      api: async () => { throw new Error('no api stub'); }
    },
    scripts: ['observation.js'],
    globals: {
      module: { exports: {} },
      escapeHtml: (s) => (s == null ? '' : String(s)),
      relativeTime: () => '',
      console: { warn() {}, error() {}, log() {} }
    }
  });
  const list = world.document.createElement('ul');
  list.id = LIST_ID;
  const empty = world.document.createElement('p');
  empty.id = EMPTY_ID;
  world.document.body.appendChild(list);
  world.document.body.appendChild(empty);
  return { world, list, empty };
}

const order = (list) => list.children.map((el) => el.dataset.session);
const WS = { urlKey: 'acme', name: 'Acme' };
const RECENT = new Date(Date.now() - 60 * 1000).toISOString();

// One running implementation loop, as the loop store holds it; the feed payload is built from it
// by the same builder the server uses, so the card reads the fields the page really gets.
function runningLoop(sessionId) {
  return {
    loopId: `${sessionId}-l`, lineageId: `${sessionId}-l`, kind: 'implementation', followUpTo: null, sessionId,
    issueIdentifier: `LIN-${sessionId}`, issueTitle: `Task ${sessionId}`, workspaceUrlKey: 'acme', dispatchedAt: RECENT,
    resolvedAt: null, decision: null, decisionCase: [], answeredDecisions: [], withdrawal: null, wakeMarker: null, waitingMessage: null
  };
}

// The feed payloads for these ids, in the order given.
const sessions = (...ids) => ids.map((id) => buildSessionPayload({ sessionId: id, loops: [runningLoop(id)] }, WS, false));

test.describe('diffSessionList — card-list ordering (LIN-964)', () => {
  test('order is preserved across polls when nothing is expanded (baseline)', () => {
    const { world, list } = loadObservation();
    const { diffSessionList } = world.sandbox.module.exports;
    const cardMap = new Map();

    // `renderFeeds` always feeds this seam sessions in `sessionIndex` INSERTION
    // order (a Map, iterated with no sort), so a persisting card keeps its slot
    // even when the server re-ranks it — the re-rank never changes this array's
    // order. With nothing expanded, re-appending in that same order is a no-op.
    diffSessionList(LIST_ID, EMPTY_ID, cardMap, sessions('A', 'B', 'C', 'D'));
    assert.deepEqual(order(list), ['A', 'B', 'C', 'D']);

    diffSessionList(LIST_ID, EMPTY_ID, cardMap, sessions('A', 'B', 'C', 'D'));
    assert.deepEqual(order(list), ['A', 'B', 'C', 'D']);
  });

  test('expanding a card does NOT reorder the list on the next poll', () => {
    const { world, list } = loadObservation();
    const { diffSessionList, expandedSessions } = world.sandbox.module.exports;
    const cardMap = new Map();

    diffSessionList(LIST_ID, EMPTY_ID, cardMap, sessions('A', 'B', 'C', 'D'));
    assert.deepEqual(order(list), ['A', 'B', 'C', 'D']);

    // User expands B (mid-list), then a poll lands within POLL_MS.
    expandedSessions.add('B');
    diffSessionList(LIST_ID, EMPTY_ID, cardMap, sessions('A', 'B', 'C', 'D'));

    // Pre-fix this returned [B,A,C,D] — B floated to the top. It must stay put.
    assert.deepEqual(order(list), ['A', 'B', 'C', 'D']);
  });

  test('a genuinely new session still appends at the end while a card is expanded', () => {
    const { world, list } = loadObservation();
    const { diffSessionList, expandedSessions } = world.sandbox.module.exports;
    const cardMap = new Map();

    diffSessionList(LIST_ID, EMPTY_ID, cardMap, sessions('A', 'B', 'C'));
    expandedSessions.add('B');
    diffSessionList(LIST_ID, EMPTY_ID, cardMap, sessions('A', 'B', 'C', 'E'));

    assert.deepEqual(order(list), ['A', 'B', 'C', 'E']);
  });

  test('a session that ends still leaves the list while a card is expanded', () => {
    const { world, list } = loadObservation();
    const { diffSessionList, expandedSessions } = world.sandbox.module.exports;
    const cardMap = new Map();

    diffSessionList(LIST_ID, EMPTY_ID, cardMap, sessions('A', 'B', 'C', 'D'));
    expandedSessions.add('B');
    // C drops out of the feed; remaining order is otherwise untouched.
    diffSessionList(LIST_ID, EMPTY_ID, cardMap, sessions('A', 'B', 'D'));

    assert.deepEqual(order(list), ['A', 'B', 'D']);
  });
});
