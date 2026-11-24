/**
 * LIN-3983 PR 1 gave the question rows two hosts, the Rulings tab and the waiting block above the Observation feed.
 * LIN-4553 made the Questions tab the one host: the waiting line above the runs only counts the questions
 * (tests/unit/observation-waiting-block.test.js), so a card is drawn in one place. These tests pin that: a row keeps
 * the person's typed answer across the poll's repaint, and the line never holds a card. LIN-4541: a row is an open
 * question record (`kind: 'question'`); the old decision rows retired with the ruling predicate, so a row of any
 * other shape is not drawn.
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

// The Questions tab's list and empty state, and the waiting line, as the page draws them.
const RULINGS_MARKUP = `
  <ul id="obs-rulings"></ul>
  <p id="obs-rulings-empty"></p>
  <p id="obs-waiting" hidden><a id="obs-waiting-questions" hidden></a></p>`;

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

describe('the Questions tab is the one host (LIN-3983, LIN-4553)', () => {
  test('a row holding a typed answer is kept across the repaint, as the same node', async () => {
    const world = await makeWorld();
    const tabList = byId(world, 'obs-rulings');
    const { renderRulings } = world.page;
    const row = questionRow(1);
    renderRulings([row]);
    const built = tabList.children[0];
    assert.ok(built, 'the tab attaches the row');
    built.querySelector('[data-testid="question-record-card-input"]').value = 'half typed';

    renderRulings([row, questionRow(2)]);
    await flush();

    assert.equal(tabList.children.length, 2);
    assert.equal(tabList.children[0], built, 'the same node, not a rebuilt one');
  });

  test('the tab lists every row, and the waiting line holds no card', async () => {
    const world = await makeWorld();
    const tabList = byId(world, 'obs-rulings');
    const tabEmpty = byId(world, 'obs-rulings-empty');
    const { renderRulings, renderWaitingBlock } = world.page;
    const rows = [1, 2, 3, 4, 5].map(questionRow);
    renderRulings(rows);
    renderWaitingBlock();
    assert.equal(tabList.children.length, 5, 'the Questions tab lists every row');
    assert.equal(tabEmpty.hidden, true, 'the tab empty state hides while rows are listed');
    assert.equal(byId(world, 'obs-waiting').querySelectorAll('[data-testid="question-record-card"]').length, 0);
  });

  test('renderRulings paints the Questions tab', async () => {
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
