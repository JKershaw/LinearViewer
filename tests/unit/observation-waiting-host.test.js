/**
 * LIN-3983 PR 1: the ruling rows have two hosts — the Rulings tab and the
 * "waiting on you" block above the Observation feed — and one set of row
 * nodes. These tests pin the host seam: a row keeps its state when it moves
 * between hosts, the block caps what it attaches, and a row that lands on the
 * Rulings tab after being built elsewhere is basis-checked there.
 *
 * `public/observation.js` is vm-sandboxed as in observation-basis-check.test.js.
 * Run with: node --test tests/unit/observation-waiting-host.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FakeElement } from '../fixtures/observation-dom-shim.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBSERVATION_JS_SRC = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');

function makeSandbox({ elements = {}, api } = {}) {
  const sandbox = {
    module: { exports: {} },
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendOptions() {}, resolveCaption: () => '' },
      sourceQuery: (source) => (source ? `?source=${encodeURIComponent(source)}` : ''),
      api: api || (async () => { throw new Error('window.api not stubbed'); })
    },
    document: {
      createElement: (tag) => new FakeElement(tag),
      addEventListener() {},
      getElementById: (id) => elements[id] || null
    },
    escapeHtml: (str) => (str === undefined || str === null ? '' : String(str)),
    relativeTime: (ts) => (ts ? `rel(${ts})` : ''),
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(OBSERVATION_JS_SRC, sandbox, { filename: 'observation.js' });
  return sandbox;
}

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
    const tabList = new FakeElement('ul');
    const tabEmpty = new FakeElement('p');
    const blockList = new FakeElement('ul');
    const sandbox = makeSandbox({
      elements: { 'obs-rulings': tabList, 'obs-rulings-empty': tabEmpty },
      api: async (url) => { calls.push(url); return { basisChanged: false }; }
    });
    const { renderRulings, rulingKey, rulingsPending } = sandbox.module.exports;
    const row = taskBoundRow(1);
    const key = rulingKey(row.anchor.workspaceUrlKey, row.anchor, row.decision.decision_id);

    vm.runInContext('currentView = "runs";', sandbox);
    renderRulings([row], { list: blockList, empty: null, limit: 3, onTab: false });
    await flush();
    assert.equal(calls.length, 0, 'no basis check while the block is on screen');

    rulingsPending.add(key);
    vm.runInContext('currentView = "rulings";', sandbox);
    renderRulings([row]);
    await flush();
    rulingsPending.delete(key);

    assert.equal(calls.length, 1, 'the reused row must be checked once it sits on the Rulings tab');
    assert.match(calls[0], /\/api\/scan\/issue-1/);
    assert.equal(tabList.children.length, 1, 'the row is attached to the Rulings tab');
    assert.equal(blockList.children.length, 0, 'and detached from the block');
  });

  test('the block attaches at most `limit` rows; the Rulings tab still lists every row', () => {
    const tabList = new FakeElement('ul');
    const tabEmpty = new FakeElement('p');
    const blockList = new FakeElement('ul');
    const sandbox = makeSandbox({
      elements: { 'obs-rulings': tabList, 'obs-rulings-empty': tabEmpty }
    });
    const { renderRulings, renderedRulingRows } = sandbox.module.exports;
    const rows = [1, 2, 3].map(taskBoundRow);

    vm.runInContext('currentView = "runs";', sandbox);
    renderRulings(rows, { list: blockList, empty: null, limit: 2, onTab: false });
    assert.equal(blockList.children.length, 2, 'the block shows the first two rows only');
    assert.equal(renderedRulingRows.size, 3, 'the rest stay tracked, so the tab reuses them');

    vm.runInContext('currentView = "rulings";', sandbox);
    renderRulings(rows);
    assert.equal(tabList.children.length, 3, 'the Rulings tab lists every row');
    assert.equal(blockList.children.length, 0, 'rows move out of the block when the tab paints');
    assert.equal(tabEmpty.hidden, true, 'the tab empty state hides while rows are listed');
  });

  test('the default host is the Rulings tab, so existing one-argument callers are unchanged', () => {
    const tabList = new FakeElement('ul');
    const tabEmpty = new FakeElement('p');
    const sandbox = makeSandbox({
      elements: { 'obs-rulings': tabList, 'obs-rulings-empty': tabEmpty }
    });
    const { renderRulings } = sandbox.module.exports;
    renderRulings([taskBoundRow(1), taskBoundRow(2)]);
    assert.equal(tabList.children.length, 2);
  });
});
