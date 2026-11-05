/**
 * LIN-3983 PR 1: the ruling rows have two hosts — the Rulings tab and the
 * "waiting on you" block above the Observation feed — and one set of row
 * nodes. These tests pin the host seam: a row keeps its state when it moves
 * between hosts, the block caps what it attaches, and a row that lands on the
 * Rulings tab after being built elsewhere is basis-checked there.
 *
 * `public/observation.js` runs through `loadWorld` over the shared fake DOM
 * (tests/unit/helpers/fake-dom.js). The Rulings tab and the block's list are
 * real elements in the world's document; the rows are built by the client.
 * Run with: node --test tests/unit/observation-waiting-host.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';

// The Rulings tab's list and empty state, and the waiting block's list, as the page draws them.
const RULINGS_MARKUP = `
  <ul id="obs-rulings"></ul>
  <p id="obs-rulings-empty"></p>
  <ul id="obs-waiting-rulings"></ul>`;

function makeWorld({ api } = {}) {
  const world = loadWorld({
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendOptions() {}, resolveCaption: () => '' },
      sourceQuery: (source) => (source ? `?source=${encodeURIComponent(source)}` : ''),
      api: api || (async () => { throw new Error('window.api not stubbed'); })
    },
    scripts: ['observation.js'],
    globals: {
      module: { exports: {} },
      escapeHtml: (str) => (str === undefined || str === null ? '' : String(str)),
      relativeTime: (ts) => (ts ? `rel(${ts})` : ''),
      console: { warn() {}, error() {}, log() {} }
    }
  });
  world.document.body.innerHTML = RULINGS_MARKUP;
  return world;
}

const byId = (world, id) => world.document.getElementById(id);

function taskBoundRow(n) {
  return {
    decision: { decision_id: `d-${n}`, question: `Question ${n}?`, options: [] },
    decisionCase: [],
    anchor: {
      loopId: null,
      taskDecisionId: `td-${n}`,
      issueId: `issue-${n}`,
      issueIdentifier: `LIN-${n}`,
      workspaceUrlKey: 'ws',
      source: null
    },
    disposition: 'task-bound',
    canReply: false,
    alternate: null,
    suggestedDismissal: null
  };
}

const flush = async (times = 8) => {
  for (let i = 0; i < times; i++) await new Promise(r => setImmediate(r));
};

describe('renderRulings host seam (LIN-3983)', () => {
  test('a row reused from the waiting block re-arms its basis check on the Rulings tab', async () => {
    // A row built while the block is on screen is not checked (the check is
    // gated on the Rulings view at creation). If it is then reused on the tab
    // (here because a reply is pending), only the re-arm can check it.
    const calls = [];
    const world = makeWorld({
      api: async (url) => { calls.push(url); return { basisChanged: false }; }
    });
    const tabList = byId(world, 'obs-rulings');
    const blockList = byId(world, 'obs-waiting-rulings');
    const { renderRulings, rulingKey, rulingsPending } = world.sandbox.module.exports;
    const row = taskBoundRow(1);
    const key = rulingKey(row.anchor.workspaceUrlKey, row.anchor, row.decision.decision_id);

    world.run('currentView = "runs";');
    renderRulings([row], { list: blockList, empty: null, limit: 3, onTab: false });
    await flush();
    assert.equal(calls.length, 0, 'no basis check while the block is on screen');

    rulingsPending.add(key);
    world.run('currentView = "rulings";');
    renderRulings([row]);
    await flush();
    rulingsPending.delete(key);

    assert.equal(calls.length, 1, 'the reused row must be checked once it sits on the Rulings tab');
    assert.match(calls[0], /\/api\/scan\/issue-1/);
    assert.equal(tabList.children.length, 1, 'the row is attached to the Rulings tab');
    assert.equal(blockList.children.length, 0, 'and detached from the block');
  });

  test('the block attaches at most `limit` rows; the Rulings tab still lists every row', () => {
    const world = makeWorld();
    const tabList = byId(world, 'obs-rulings');
    const tabEmpty = byId(world, 'obs-rulings-empty');
    const blockList = byId(world, 'obs-waiting-rulings');
    const { renderRulings, renderedRulingRows } = world.sandbox.module.exports;
    const rows = [1, 2, 3].map(taskBoundRow);

    world.run('currentView = "runs";');
    renderRulings(rows, { list: blockList, empty: null, limit: 2, onTab: false });
    assert.equal(blockList.children.length, 2, 'the block shows the first two rows only');
    assert.equal(renderedRulingRows.size, 3, 'the rest stay tracked, so the tab reuses them');

    world.run('currentView = "rulings";');
    renderRulings(rows);
    assert.equal(tabList.children.length, 3, 'the Rulings tab lists every row');
    assert.equal(blockList.children.length, 0, 'rows move out of the block when the tab paints');
    assert.equal(tabEmpty.hidden, true, 'the tab empty state hides while rows are listed');
  });

  test('the default host is the Rulings tab, so existing one-argument callers are unchanged', () => {
    const world = makeWorld();
    const tabList = byId(world, 'obs-rulings');
    const { renderRulings } = world.sandbox.module.exports;
    renderRulings([taskBoundRow(1), taskBoundRow(2)]);
    assert.equal(tabList.children.length, 2);
  });
});
