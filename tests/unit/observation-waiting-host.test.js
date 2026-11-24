/**
 * LIN-3983 PR 1: the ruling rows have two hosts — the Rulings tab and the
 * "waiting on you" block above the Observation feed — and one set of row
 * nodes. These tests pin the host seam: a row keeps its state when it moves
 * between hosts, and the block caps what it attaches. LIN-4541: a row is an open
 * question record (`kind: 'question'`); the old decision rows retired with the
 * ruling predicate, so a row of any other shape is not drawn.
 *
 * `public/observation.js` is a native ES module (LIN-4463 piece 4), loaded fresh per test through `importWorld`
 * (tests/unit/helpers/import-world.js) over the shared fake DOM (tests/unit/helpers/fake-dom.js). The Rulings tab and
 * the block's list are real elements in the world's document; the rows are built by the client. The page is not booted
 * here: the host seam reads no page data, and a tab switch's own read has no URL to read until the page has booted.
 * Run with: node --test tests/unit/observation-waiting-host.test.js
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';

// Every world a test makes is put back after the test, last made first.
const worlds = [];
afterEach(() => {
  while (worlds.length) worlds.pop().restore();
});

// The Rulings tab's list and empty state, and the waiting block's list, as the page draws them.
const RULINGS_MARKUP = `
  <ul id="obs-rulings"></ul>
  <p id="obs-rulings-empty"></p>
  <ul id="obs-waiting-rulings"></ul>`;

async function makeWorld({ api } = {}) {
  const world = importWorld({
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      api: api || (async () => { throw new Error('window.api not stubbed'); })
    },
    globals: {
      escapeHtml: (str) => (str === undefined || str === null ? '' : String(str)),
      relativeTime: (ts) => (ts ? `rel(${ts})` : ''),
      console: { warn() {}, error() {}, log() {} },
      fetch: async () => ({ ok: true, json: async () => ({}) })
    },
    timers: [],
  });
  worlds.push(world);
  world.document.body.innerHTML = RULINGS_MARKUP;
  world.page = await world.importPage('observation.js');
  return world;
}

const byId = (world, id) => world.document.getElementById(id);

function questionRow(n) {
  return {
    kind: 'question',
    questionId: `q-${n}`,
    asks: `Question ${n}?`,
    question: `Question ${n}?`,
    options: ['left', 'right'],
    state: 'resumable',
    interactive: true,
    anchor: { workspaceUrlKey: 'ws', taskId: `task-${n}`, runId: `run-${n}`, loopId: null, issueId: null, issueIdentifier: `LIN-${n}`, target: null }
  };
}

const flush = async (times = 8) => {
  for (let i = 0; i < times; i++) await new Promise(r => setImmediate(r));
};

describe('renderRulings host seam (LIN-3983)', () => {
  test('a row holding a typed answer, built in the waiting block, moves to the Rulings tab as the same node', async () => {
    // A row holding input is reused, not rebuilt, so moving it between hosts keeps the typed words: the tab must attach the
    // very node the block held.
    const world = await makeWorld();
    const tabList = byId(world, 'obs-rulings');
    const blockList = byId(world, 'obs-waiting-rulings');
    const { renderRulings, switchView } = world.page;
    const row = questionRow(1);
    renderRulings([row], { list: blockList, empty: null, limit: 3 });
    const built = blockList.children[0];
    assert.ok(built, 'the block attaches the row');
    built.querySelector('[data-testid="question-record-card-input"]').value = 'half typed';

    switchView('rulings');
    renderRulings([row]);
    await flush();

    assert.equal(tabList.children.length, 1, 'the row is attached to the Rulings tab');
    assert.equal(tabList.children[0], built, 'the same node, not a rebuilt one');
    assert.equal(blockList.children.length, 0, 'and detached from the block');
  });

  test('the block attaches at most `limit` rows; the Rulings tab still lists every row', async () => {
    const world = await makeWorld();
    const tabList = byId(world, 'obs-rulings');
    const tabEmpty = byId(world, 'obs-rulings-empty');
    const blockList = byId(world, 'obs-waiting-rulings');
    const { renderRulings, switchView } = world.page;
    const rows = [1, 2, 3].map(questionRow);
    renderRulings(rows, { list: blockList, empty: null, limit: 2 });
    assert.equal(blockList.children.length, 2, 'the block shows the first two rows only');

    switchView('rulings');
    renderRulings(rows);
    assert.equal(tabList.children.length, 3, 'the Rulings tab lists every row');
    assert.equal(blockList.children.length, 0, 'rows move out of the block when the tab paints');
    assert.equal(tabEmpty.hidden, true, 'the tab empty state hides while rows are listed');
  });

  test('the default host is the Rulings tab, so existing one-argument callers are unchanged', async () => {
    const world = await makeWorld();
    const tabList = byId(world, 'obs-rulings');
    const { renderRulings } = world.page;
    renderRulings([questionRow(1), questionRow(2)]);
    assert.equal(tabList.children.length, 2);
  });

  test('LIN-4541: a row draws its question\'s words, and a row that is not a question record is not drawn', async () => {
    const world = await makeWorld();
    const tabList = byId(world, 'obs-rulings');
    const tabEmpty = byId(world, 'obs-rulings-empty');
    const { renderRulings } = world.page;
    const oldDecisionRow = { decision: { decision_id: 'd-1', question: 'Old?' }, anchor: { loopId: 'L1', workspaceUrlKey: 'ws' }, disposition: 'resumable' };
    renderRulings([oldDecisionRow]);
    assert.equal(tabList.children.length, 0, 'an old decision row is not a row any more');
    assert.equal(tabEmpty.hidden, false, 'so the empty state shows');
    renderRulings([questionRow(7)]);
    assert.equal(tabList.children[0].querySelector('[data-testid="question-record-card-question"]').textContent, 'Question 7?');
  });
});
