/**
 * LIN-2944 P1 beat 2 — Home top-task parity + shared ordering helper.
 *
 * The Home first screen must mark the SAME task the Swipe deck shows first, and
 * both must come from ONE ordering pipeline so they cannot drift. This file
 * exercises the server-render seam directly (Home's `renderPage` vs Swipe's
 * `renderSwipePage`) over an identical, Linear-shaped tree set — the deck's
 * front card and Home's `data-top-task` row must agree, including the one-line
 * `why`. It also pins that the pipeline is pure (no provider call) and that the
 * page-level options are embedded as `__HOME_PROMPT_OPTS__`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderPage } from '../../lib/render.js';
import { renderSwipePage, orderIssuesForSwipe } from '../../lib/render-swipe.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { nodeKey } from '../../lib/tree.js';
// Side-effect import: the Linear provider self-registers so getProviderForWorkspace
// resolves for the workspace below (same idiom as tests/unit/render.test.js).
import '../../lib/providers/linear/index.js';

// ---------------------------------------------------------------------------
// Linear-shaped fixture. The front card must carry a non-empty `why` (a started
// Urgent bug) and the top issue has a child, so `clusterByParent` is exercised:
// the subtask is emitted before the parent and becomes the deck's first card.
// ---------------------------------------------------------------------------
function issue(over = {}) {
  return {
    id: 'i-x', identifier: 'LOC-X', title: 'Task', priority: 3, url: '',
    state: { type: 'started', name: 'In Progress' },
    labels: { nodes: [] }, relations: { nodes: [] }, project: { id: 'p1' },
    ...over
  };
}

function buildTrees() {
  const parent = issue({ id: 'i-parent', identifier: 'LOC-1', title: 'Fix the crash', priority: 1, labels: { nodes: [{ name: 'bug' }] } });
  const child = issue({ id: 'i-child', identifier: 'LOC-2', title: 'Write the failing test', priority: 1, labels: { nodes: [{ name: 'bug' }] }, parent: { id: 'i-parent' } });
  const other = issue({ id: 'i-other', identifier: 'LOC-3', title: 'Unrelated in-progress', priority: 3 });

  const childNode = { issue: child, children: [], depth: 1, isInProgress: true, projectName: 'Project' };
  const parentNode = { issue: parent, children: [childNode], depth: 0, isInProgress: true, projectName: 'Project' };
  const otherNode = { issue: other, children: [], depth: 0, isInProgress: true, projectName: 'Project' };

  const trees = [{
    project: { id: 'p1', name: 'Project' },
    incomplete: [parentNode, otherNode],
    completed: [],
    completedCount: 0
  }];
  return { projectTrees: trees, inProgressTrees: [{ projectName: 'Project', roots: [parentNode, otherNode] }], recentActivityTrees: [] };
}

const WORKSPACE = { urlKey: 'ws', name: 'WS', provider: 'linear' };

function embedded(html, globalVar) {
  const m = html.match(new RegExp(`window\\.${globalVar} = (.*?);</script>`, 's'));
  assert.ok(m, `${globalVar} embedded script present`);
  return JSON.parse(m[1]);
}

// Read Home's marked row: its id and decoded why array.
function markedTop(html) {
  const tags = html.match(/<div class="line[^"]*"[^>]*>/g) || [];
  const tag = tags.find(t => t.includes('data-top-task="1"'));
  if (!tag) return null;
  const id = (tag.match(/data-id="([^"]+)"/) || [])[1] || null;
  const section = (tag.match(/data-section="([^"]+)"/) || [])[1] || null;
  const raw = (tag.match(/data-why="([^"]*)"/) || [])[1];
  const why = raw === undefined ? [] : JSON.parse(raw.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'));
  return { id, section, why };
}

describe('Home/Swipe top-task parity (LIN-2944 P1 F3)', () => {
  test('the deck shows this fixture\'s subtask first (clusterByParent exercises the pipeline)', () => {
    const data = buildTrees();
    const swipeHtml = renderSwipePage(data, { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: {} });
    const swipe = embedded(swipeHtml, '__SWIPE_DATA__');
    assert.equal(swipe.issues[0].id, 'i-child', 'front card is the clustered subtask');
    assert.deepEqual(swipe.issues[0].why, ['bug'], 'front card advertises its ranking reason');
  });

  test("Home's marked top task equals Swipe's first card, ids and why (RED before F3)", () => {
    const data = buildTrees();
    const ordered = orderIssuesForSwipe(data);
    const swipeHtml = renderSwipePage(data, { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: {} });
    const swipeFirst = embedded(swipeHtml, '__SWIPE_DATA__').issues[0];

    const homeHtml = renderPage(data.projectTrees, data.inProgressTrees, data.recentActivityTrees, 'Org', {
      urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: {},
      topTaskId: nodeKey(ordered[0]), topTaskWhy: ordered[0].why
    });
    const marked = markedTop(homeHtml);

    assert.ok(marked, 'Home marks exactly one top-task row');
    assert.equal(marked.id, swipeFirst.id, 'Home top task id equals Swipe first card id');
    assert.deepEqual(marked.why, swipeFirst.why, 'Home why equals Swipe why');
  });

  test('exactly one row is marked, and it lives in the In Progress section', () => {
    const data = buildTrees();
    const ordered = orderIssuesForSwipe(data);
    const homeHtml = renderPage(data.projectTrees, data.inProgressTrees, data.recentActivityTrees, 'Org', {
      urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: {},
      topTaskId: nodeKey(ordered[0]), topTaskWhy: ordered[0].why
    });
    assert.equal((homeHtml.match(/data-top-task="1"/g) || []).length, 1, 'exactly one mark');
    assert.equal(markedTop(homeHtml).section, 'in-progress', 'the mark is on the In Progress occurrence');
  });

  test('an unstarted front card (the real local-seed shape) is marked on its project-tree row', () => {
    // The canonical local seed's front card is TEST-13: a boostable bug in the
    // Todo state, so buildInProgressForest never lists it. Home's backlog is the
    // project trees, so the mark must land there — otherwise the first screen
    // shows no top task at all.
    const bug = issue({ id: 'i-bug', identifier: 'LOC-9', title: 'Unstarted urgent bug', priority: 1, state: { type: 'unstarted', name: 'Todo' }, labels: { nodes: [{ name: 'bug' }] } });
    const started = issue({ id: 'i-started', identifier: 'LOC-8', title: 'In-progress task', priority: 3 });
    const startedNode = { issue: started, children: [], depth: 0, isInProgress: true, projectName: 'Project' };
    const bugNode = { issue: bug, children: [], depth: 0 };
    const data = {
      projectTrees: [{ project: { id: 'p1', name: 'Project' }, incomplete: [bugNode, startedNode], completed: [], completedCount: 0 }],
      inProgressTrees: [{ projectName: 'Project', roots: [startedNode] }],
      recentActivityTrees: []
    };
    const ordered = orderIssuesForSwipe(data);
    assert.equal(ordered[0].id, 'i-bug', 'the unstarted bug is the front card');

    const homeHtml = renderPage(data.projectTrees, data.inProgressTrees, data.recentActivityTrees, 'Org', {
      urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: {},
      topTaskId: nodeKey(ordered[0]), topTaskWhy: ordered[0].why
    });
    const marked = markedTop(homeHtml);
    assert.ok(marked, 'Home marks the top task');
    assert.equal(marked.id, 'i-bug');
    assert.equal(marked.section, 'project', 'the mark is on the project-tree row, not in-progress');

    const swipeFirst = embedded(
      renderSwipePage(data, { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: {} }),
      '__SWIPE_DATA__'
    ).issues[0];
    assert.equal(marked.id, swipeFirst.id, 'parity holds when the front card is unstarted');
    assert.deepEqual(marked.why, swipeFirst.why);
  });
});

describe('one shared ordering helper (LIN-2944 P1)', () => {
  test('orderIssuesForSwipe reproduces renderSwipePage\'s embedded order exactly', () => {
    const data = buildTrees();
    const helperOrder = orderIssuesForSwipe(data).map(i => i.id);
    const swipeHtml = renderSwipePage(data, { urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: {} });
    const swipeOrder = embedded(swipeHtml, '__SWIPE_DATA__').issues.map(i => i.id);
    assert.deepEqual(helperOrder, swipeOrder, 'helper order === deck order');
  });

  test('the helper is synchronous and pure — it issues no provider call', () => {
    const calls = { fetchProjects: 0, fetchIssues: 0, fetchIssueFields: 0 };
    registerProvider({
      name: 'counting-parity-provider',
      ui: {},
      supports: () => true,
      fetchProjects: async () => { calls.fetchProjects++; return { projects: [], issues: [] }; },
      fetchIssues: async () => { calls.fetchIssues++; return []; },
      fetchIssueFields: async () => { calls.fetchIssueFields++; return null; }
    });
    const data = buildTrees();
    const result = orderIssuesForSwipe(data);
    assert.ok(Array.isArray(result), 'returns an array synchronously (not a Promise)');
    assert.deepEqual(calls, { fetchProjects: 0, fetchIssues: 0, fetchIssueFields: 0 }, 'no provider method was called');
  });

  test('reorders blockers before the issues they block (the pipeline is live)', () => {
    // `blocker` blocks `blocked`; the blocker is lower priority but must still
    // come first after applyBlockingOrder. `blocksIds` is built from the blocking
    // issue's OWN relations, so the edge lives on the blocker only.
    const blocked = issue({ id: 'i-blocked', identifier: 'LOC-11', title: 'Blocked', priority: 1 });
    const blocker = issue({ id: 'i-blocker', identifier: 'LOC-10', title: 'Blocker', priority: 3, relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'i-blocked' } }] } });
    const n = (i) => ({ issue: i, children: [], depth: 0, isInProgress: true, projectName: 'P' });
    const data = { projectTrees: [], inProgressTrees: [{ projectName: 'P', roots: [n(blocked), n(blocker)] }], recentActivityTrees: [] };
    const order = orderIssuesForSwipe(data).map(i => i.id);
    assert.ok(order.indexOf('i-blocker') < order.indexOf('i-blocked'), 'blocker precedes blocked');
  });
});

describe('page-level options embedded for Home (LIN-2944 P1 addendum 9)', () => {
  test('emits __HOME_PROMPT_OPTS__ with the flags mirrored from Swipe', () => {
    const data = buildTrees();
    const html = renderPage(data.projectTrees, data.inProgressTrees, data.recentActivityTrees, 'Org', {
      urlKey: 'ws', workspaces: [WORKSPACE], openRouterSource: 'oauth',
      featureFlags: { dispatch: true, proxy: true }, customPrompts: [{ id: 'c1', name: 'Custom' }]
    });
    const opts = embedded(html, '__HOME_PROMPT_OPTS__');
    assert.equal(opts.hasAI, true);
    assert.equal(opts.aiState, 'ready');
    assert.equal(opts.hasAutopilot, true);
    assert.equal(opts.dispatchEnabled, true);
    assert.equal(opts.proxyEnabled, true);
    assert.equal(opts.promptButtons, true);
    assert.deepEqual(opts.customPrompts, [{ id: 'c1', name: 'Custom' }]);
    assert.ok(Array.isArray(opts.defaultPromptKeys) && opts.defaultPromptKeys.includes('implementation'));
    assert.ok(Array.isArray(opts.morePromptKeys) && opts.morePromptKeys.includes('retro'));
    assert.equal(opts.promptMeta.implementation, 'implement');
  });

  test('AI off by choice is reflected as aiState=off, hasAI=false (F9)', () => {
    const data = buildTrees();
    const html = renderPage(data.projectTrees, data.inProgressTrees, data.recentActivityTrees, 'Org', {
      urlKey: 'ws', workspaces: [WORKSPACE], openRouterSource: 'oauth',
      featureFlags: { aiRecommendations: false }
    });
    const opts = embedded(html, '__HOME_PROMPT_OPTS__');
    assert.equal(opts.hasAI, false);
    assert.equal(opts.aiState, 'off');
  });

  test('landing pages emit no Home prompt options (byte-identical, no prompt UI)', () => {
    const html = renderPage([], [], [], 'Org', { isLanding: true });
    assert.ok(!html.includes('__HOME_PROMPT_OPTS__'), 'no embedded options on landing');
  });
});

// =============================================================================
// LIN-2944 P1 N2 — the top-task match is binding-aware, not id-only.
// =============================================================================
describe('LIN-2944 P1 N2: the top-task match is binding-aware', () => {
  test("with repoA#1 and repoB#1 sharing an id, only the top card's binding row is marked", () => {
    const shared = {
      id: 'dupe-1', identifier: 'X-1', title: 'Shared', priority: 1,
      state: { type: 'started', name: 'In Progress' },
      labels: { nodes: [{ name: 'bug' }] }, relations: { nodes: [] }
    };
    const a = { ...shared, source: 'repoA' };
    const b = { ...shared, source: 'repoB' };
    const trees = [
      { project: { id: 'pa', name: 'Repo A' }, incomplete: [{ issue: a, children: [], depth: 0 }], completed: [], completedCount: 0 },
      { project: { id: 'pb', name: 'Repo B' }, incomplete: [{ issue: b, children: [], depth: 0 }], completed: [], completedCount: 0 }
    ];
    const ordered = orderIssuesForSwipe({ projectTrees: trees, inProgressTrees: [], recentActivityTrees: [] });
    const top = ordered.find(c => c.source === 'repoB');
    assert.ok(top, 'repoB card is present');

    const html = renderPage(trees, [], [], 'Org', {
      urlKey: 'ws', workspaces: [{ urlKey: 'ws', name: 'WS', provider: 'linear' }], featureFlags: {},
      topTaskId: nodeKey(top), topTaskWhy: top.why
    });

    assert.equal((html.match(/data-top-task="1"/g) || []).length, 1, 'exactly one row is marked');
    const idx = html.indexOf('data-top-task="1"');
    const before = html.slice(0, idx);
    assert.ok(before.lastIndexOf('Repo B') > before.lastIndexOf('Repo A'),
      "the mark is on repoB's row, not repoA's same-id row");
  });
});
