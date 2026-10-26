/**
 * LIN-3833 step 2: Home's In Progress rows say their state, and the section is ordered by it.
 *
 * Witnesses: the words a row says come from the task page's own model (`buildRowStates` over
 * `buildTaskPageModel`); a copy-first viewer (no sessions) gets the tracker words alone; the order is
 * needs you, ready for a next step, running, the rest, with project order breaking ties; the count
 * line; and the rendered row carries the words only where it has some, and only In Progress rows.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRowStates } from '../../lib/task-page-loader.js';
import { orderInProgress, buildInProgressCountLine, buildInProgressCountParts } from '../../lib/task-board-view.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { renderPage } from '../../lib/render.js';

const NOW = new Date('2026-10-25T10:06:00.000Z');

function loop(over = {}) {
  return {
    loopId: 'l1', lineageId: 'l1', issueIdentifier: 'LIN-50', kind: 'implementation', iteration: 1,
    source: 'history', historyStatus: 'taken', agentState: 'running',
    dispatchedAt: '2026-10-25T10:00:00.000Z', takenAt: '2026-10-25T10:01:00.000Z', resolvedAt: '2026-10-25T10:01:00.000Z',
    terminalStatus: null, terminalCompletedAt: null, wakeMarker: 'pending', waitingMessage: null,
    feedback: [], telemetry: { runtime: { ms: 1 }, metrics: [], producedArtifacts: [] }, followUpTo: null, bookkeeping: null,
    ...over
  };
}
const blocked = (over = {}) => loop({
  wakeMarker: 'blocked', waitingMessage: '[blocked] which way?',
  feedback: [{ message: '[blocked] which way?', timestamp: '2026-10-25T10:05:00.000Z' }], ...over
});

const node = (identifier, state = 'started', children = []) => ({
  issue: { id: `id-${identifier}`, identifier, title: identifier, state: { name: state, type: state } },
  children,
  depth: 0,
});

function states({ roots, loops = {}, sessionsVisible = true }) {
  return buildRowStates({
    roots,
    loopsByIdentifier: new Map(Object.entries(loops)),
    enrichLoop,
    deriveSessionWaiting,
    now: NOW,
    sessionsVisible,
  });
}

describe('LIN-3833 — the words a row says, from the task page\'s own model', () => {
  test('a running session says what runs and for how long', () => {
    const s = states({ roots: [node('LIN-50')], loops: { 'LIN-50': [loop()] } });
    assert.equal(s.get('LIN-50').words, 'Build running · 5m');
    assert.equal(s.get('LIN-50').running, true);
  });

  test('a session waiting on a person says needs you', () => {
    const s = states({ roots: [node('LIN-51')], loops: { 'LIN-51': [blocked({ issueIdentifier: 'LIN-51' })] } });
    assert.equal(s.get('LIN-51').words, 'needs you');
    assert.equal(s.get('LIN-51').needsYou, true);
  });

  test('a parent whose subtask needs you says so, and names the next step', () => {
    const child = node('LIN-53');
    const parent = node('LIN-52', 'started', [child]);
    const s = states({
      roots: [parent],
      loops: { 'LIN-53': [blocked({ issueIdentifier: 'LIN-53' })] },
    });
    assert.equal(s.get('LIN-53').words, 'needs you');
    assert.equal(s.get('LIN-52').words, 'subtask needs you · Research next');
    assert.equal(s.get('LIN-52').needsYou, true, 'the parent is ranked as needing you');
  });

  test('a backlog task says backlog, and a finished one says done', () => {
    const s = states({ roots: [node('LIN-54', 'backlog'), node('LIN-55', 'completed')] });
    assert.equal(s.get('LIN-54').words, 'backlog');
    assert.equal(s.get('LIN-55').words, 'done');
  });

  test('a started task with no session is ready for its next step', () => {
    const s = states({ roots: [node('LIN-56')] });
    assert.equal(s.get('LIN-56').words, 'Research next');
    assert.equal(s.get('LIN-56').next, 'Research');
    assert.equal(s.get('LIN-56').running, false);
  });

  test('a copy-first viewer (no sessions) gets the tracker words alone: never running, waiting or next', () => {
    const s = states({
      roots: [node('LIN-57'), node('LIN-58', 'backlog')],
      loops: { 'LIN-57': [loop({ issueIdentifier: 'LIN-57' })] },
      sessionsVisible: false,
    });
    assert.equal(s.get('LIN-57').words, null, 'a started task with a running session says nothing to a copy-first viewer');
    assert.equal(s.get('LIN-58').words, 'backlog');
  });
});

describe('LIN-4009 — each row state has its own tone', () => {
  const queuedLoop = loop({ agentState: 'queued', historyStatus: 'dispatched', takenAt: null, resolvedAt: null });
  const failedLoop = loop({
    agentState: 'failed', terminalStatus: 'failed', terminalCompletedAt: '2026-10-25T10:02:00.000Z',
    resolvedAt: '2026-10-25T10:02:00.000Z', historyStatus: 'resolved',
  });

  test('needs you, failed, running, queued, ready and quiet are six different tones', () => {
    const s = states({
      roots: [node('LIN-90'), node('LIN-91'), node('LIN-92'), node('LIN-93'), node('LIN-94'), node('LIN-95', 'backlog')],
      loops: {
        'LIN-90': [blocked({ issueIdentifier: 'LIN-90' })],
        'LIN-91': [failedLoop],
        'LIN-92': [loop({ issueIdentifier: 'LIN-92' })],
        'LIN-93': [queuedLoop],
      },
    });
    assert.equal(s.get('LIN-90').tone, 'needs-you');
    assert.equal(s.get('LIN-91').tone, 'failed', 'a failed stage is failed, not needs-you');
    assert.equal(s.get('LIN-92').tone, 'running');
    assert.equal(s.get('LIN-93').tone, 'queued', 'a queued session is not running');
    assert.equal(s.get('LIN-94').tone, 'ready');
    assert.equal(s.get('LIN-95').tone, 'quiet');
  });

  test('a queued session says queued, not running', () => {
    const s = states({ roots: [node('LIN-96')], loops: { 'LIN-96': [queuedLoop] } });
    assert.equal(s.get('LIN-96').words, 'Build queued');
    assert.equal(s.get('LIN-96').running, true, 'it still counts as in the running set');
  });

  test('the count line counts a queued session as queued, not as running (LIN-4009)', () => {
    const trees = [{ projectName: 'Alpha', roots: [node('LIN-101'), node('LIN-102')] }];
    const rowStates = states({
      roots: trees[0].roots,
      loops: { 'LIN-101': [loop({ issueIdentifier: 'LIN-101' })], 'LIN-102': [queuedLoop] },
    });
    assert.equal(buildInProgressCountLine(trees, rowStates), '2 in progress · 1 running · 1 queued');
    const parts = buildInProgressCountParts(trees, rowStates);
    assert.deepEqual(parts.map((p) => p.tone), ['quiet', 'running', 'queued']);
    const html = renderPage([], trees, [], 'Test', { urlKey: 'acme', workspace: { urlKey: 'acme', provider: 'linear' }, rowStates });
    assert.match(html, /<span class="in-progress-count__part" data-tone="queued">1 queued</);
    assert.doesNotMatch(html, />2 running</);
  });

  test('only queued sessions: the count line says queued and has no running part', () => {
    const trees = [{ projectName: 'Alpha', roots: [node('LIN-103')] }];
    const rowStates = states({ roots: trees[0].roots, loops: { 'LIN-103': [queuedLoop] } });
    assert.equal(buildInProgressCountLine(trees, rowStates), '1 in progress · 1 queued');
  });

  test('a parent whose subtask needs you is needs-you, the same tone as its own', () => {
    const parent = node('LIN-97', 'started', [node('LIN-98')]);
    const s = states({ roots: [parent], loops: { 'LIN-98': [blocked({ issueIdentifier: 'LIN-98' })] } });
    assert.equal(s.get('LIN-97').tone, 'needs-you');
  });

  test('the rendered row carries its tone, and the count line parts carry theirs', () => {
    const trees = [{ projectName: 'Alpha', roots: [node('LIN-99'), node('LIN-100')] }];
    const rowStates = states({ roots: trees[0].roots, loops: { 'LIN-99': [blocked({ issueIdentifier: 'LIN-99' })] } });
    const html = renderPage([], trees, [], 'Test', { urlKey: 'acme', workspace: { urlKey: 'acme', provider: 'linear' }, rowStates });
    assert.match(html, /<span class="row-state" data-tone="needs-you" data-testid="issue-row-state">needs you</);
    assert.match(html, /<span class="in-progress-count__part" data-tone="needs-you">1 needs you</);
    assert.match(html, /<span class="in-progress-count__part" data-tone="quiet">2 in progress</);
  });
});

describe('LIN-3833 — In Progress order and its count line', () => {
  const tree = (projectName, ...nodes) => ({ projectName, roots: nodes });

  test('needs you, then ready for a next step, then running, then the rest; project order breaks ties', () => {
    const trees = [
      tree('Alpha', node('A-running'), node('A-idle'), node('A-blocked')),
      tree('Beta', node('B-rest', 'backlog'), node('B-idle')),
    ];
    const rowStates = states({
      roots: trees.flatMap((t) => t.roots),
      loops: {
        'A-running': [loop({ issueIdentifier: 'A-running' })],
        'A-blocked': [blocked({ issueIdentifier: 'A-blocked' })],
      },
    });
    const order = orderInProgress(trees, rowStates).map(({ node: n }) => n.issue.identifier);
    assert.deepEqual(order, ['A-blocked', 'A-idle', 'B-idle', 'A-running', 'B-rest']);
  });

  test('without row states the order is the project order, unchanged', () => {
    const trees = [tree('Alpha', node('A1'), node('A2')), tree('Beta', node('B1'))];
    assert.deepEqual(orderInProgress(trees, null).map(({ node: n }) => n.issue.identifier), ['A1', 'A2', 'B1']);
  });

  test('the count line counts the top-level rows and leaves zero parts out', () => {
    const trees = [tree('Alpha', node('A-running'), node('A-blocked'), node('A-idle'))];
    const rowStates = states({
      roots: trees[0].roots,
      loops: {
        'A-running': [loop({ issueIdentifier: 'A-running' })],
        'A-blocked': [blocked({ issueIdentifier: 'A-blocked' })],
      },
    });
    assert.equal(buildInProgressCountLine(trees, rowStates), '3 in progress · 1 needs you · 1 running');
    assert.equal(buildInProgressCountLine([tree('Alpha', node('A-idle'))], states({ roots: [node('A-idle')] })), '1 in progress');
    assert.equal(buildInProgressCountLine([], new Map()), null, 'no tasks, no line');
  });
});

describe('LIN-3833 — the rendered Home In Progress section', () => {
  function homeWith(inProgressTrees, rowStates) {
    return renderPage([], inProgressTrees, [], 'Test', {
      urlKey: 'acme', workspace: { urlKey: 'acme', provider: 'linear' }, rowStates,
    });
  }

  test('a row with words renders them, and the section renders the count line', () => {
    const trees = [{ projectName: 'Alpha', roots: [node('LIN-70'), node('LIN-71')] }];
    const rowStates = states({
      roots: trees[0].roots,
      loops: { 'LIN-70': [loop({ issueIdentifier: 'LIN-70' })] },
    });
    const html = homeWith(trees, rowStates);
    // LIN-4009: the row's words carry their state tone, and the count line is the page header's summary (above
    // the In Progress section), its parts toned. Assert the text, not the markup around it.
    assert.match(html, /<span class="row-state" data-tone="running" data-testid="issue-row-state">Build running · 5m</);
    const countAt = html.indexOf('data-testid="in-progress-count"');
    assert.ok(countAt > 0 && countAt < html.indexOf('aria-label="In Progress Tasks"'), 'the count line sits in the page header');
    const countText = html.slice(html.indexOf('>', countAt) + 1).split('</header>')[0].replace(/<[^>]+>/g, '').trim();
    assert.equal(countText, '2 in progress · 1 running');
    assert.match(html, /class="in-progress-count__part" data-tone="running">1 running</);
  });

  test('a row with nothing to say renders no words span', () => {
    const trees = [{ projectName: 'Alpha', roots: [node('LIN-72', 'started')] }];
    const rowStates = new Map([['LIN-72', { words: null, rank: 3, needsYou: false, running: false, next: null }]]);
    const html = homeWith(trees, rowStates);
    assert.equal(/data-testid="issue-row-state"/.test(html), false);
  });

  test('without row states the page carries no words and no count line (other callers unchanged)', () => {
    const html = homeWith([{ projectName: 'Alpha', roots: [node('LIN-73')] }], null);
    assert.equal(/issue-row-state|in-progress-count/.test(html), false);
  });
});
