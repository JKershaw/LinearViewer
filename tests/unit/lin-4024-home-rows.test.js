/**
 * LIN-4024 step 2 (volume, part b): the folds Home opens, and the page that holds them.
 *
 * Witnesses: the rows a fold opens (`homeRowsFor`) are the open rows the page leaves out and never a done task;
 * a backlog or up-next fold pages in HOME_ROWS_PAGE roots; a started parent's "N more" counts only its open
 * folded children; search finds a folded task and shows it under its ancestors; the Home page sends no
 * `--depth` style, no "show N completed" toggle and no done task, and carries the folds the rows open from.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeView } from '../../lib/home-view.js';
import { homeRowsFor, HOME_ROWS_PAGE } from '../../lib/home-rows.js';
import { renderPage, renderHomeRowsHtml, homeRowsContext } from '../../lib/render.js';
import { partitionCompleted } from '../../lib/tree.js';

const WORKSPACE = { urlKey: 'ws', name: 'WS', provider: 'linear' };
const node = (identifier, type, children = [], title = identifier) => ({
  issue: { id: `id-${identifier}`, identifier, title, state: { type }, labels: { nodes: [] } },
  children,
  depth: 0,
});
const ids = nodes => nodes.map(n => n.issue.identifier);
const states = entries => new Map(Object.entries(entries));
const project = (id, incomplete) => ({ project: { id, name: id, collapsed: false }, incomplete, completed: [], completedCount: 0 });
const inProgress = roots => [{ projectId: 'p', projectName: 'p', roots }];

describe('the view: a started parent\'s "N more" counts open children only', () => {
  test('a done child is not in "more", so the count matches the rows a fold would open', () => {
    const parent = node('LIN-1', 'started', [
      node('LIN-2', 'started'),
      node('LIN-3', 'unstarted'),
      node('LIN-4', 'completed'),
    ]);
    const view = buildHomeView({ inProgressTrees: inProgress([parent]), trees: [], states: states({}) });
    const [root] = view.inProgressTrees[0].roots;
    assert.deepEqual(root.children.map(c => c.issue.identifier), ['LIN-2']);
    assert.equal(root.more, 1, 'only LIN-3 is open and folded; the done LIN-4 is not counted');
  });
});

describe('homeRowsFor: the rows a fold opens', () => {
  test('backlog: the project\'s open Backlog roots that In Progress does not show, never done', () => {
    const tree = project('p1', [
      node('LIN-10', 'backlog'),
      node('LIN-11', 'completed'),
      node('LIN-12', 'backlog', [node('LIN-13', 'completed')]),
    ]);
    const rows = homeRowsFor({ kind: 'backlog', projectId: 'p1', trees: [tree], inProgressTrees: [], states: states({}) });
    assert.deepEqual(ids(rows.nodes), ['LIN-10', 'LIN-12']);
    assert.deepEqual(rows.nodes[1].children, [], 'a done child of a Backlog task is not sent');
    assert.equal(rows.section, 'project');
    assert.equal(rows.parentId, 'p1');
    assert.equal(rows.nextOffset, null);
  });

  test('backlog pages: HOME_ROWS_PAGE roots a page, with the next offset and what is left behind', () => {
    const many = Array.from({ length: HOME_ROWS_PAGE + 10 }, (_, i) => node(`LIN-${100 + i}`, 'backlog'));
    const trees = [project('p1', many)];
    const first = homeRowsFor({ kind: 'backlog', projectId: 'p1', trees, inProgressTrees: [], states: states({}) });
    assert.equal(first.nodes.length, HOME_ROWS_PAGE);
    assert.equal(first.nextOffset, HOME_ROWS_PAGE);
    assert.equal(first.remaining, 10);
    const second = homeRowsFor({ kind: 'backlog', projectId: 'p1', offset: first.nextOffset, trees, inProgressTrees: [], states: states({}) });
    assert.equal(second.nodes.length, 10);
    assert.equal(second.nextOffset, null, 'the last page has no next offset');
    assert.equal(second.remaining, 0);
  });

  test('backlog leaves out a Backlog task that In Progress already shows (a ruling on it)', () => {
    const tree = project('p1', [node('LIN-20', 'backlog'), node('LIN-21', 'backlog')]);
    const rows = homeRowsFor({
      kind: 'backlog', projectId: 'p1', trees: [tree],
      inProgressTrees: inProgress([node('LIN-20', 'backlog')]),
      states: states({ 'LIN-20': { state: 'needs-you', needsYou: true } }),
    });
    assert.deepEqual(ids(rows.nodes), ['LIN-21'], 'LIN-20 is already on the page, so it is not repeated in the fold');
  });

  test('up next: the unstarted tasks behind the first three, never Backlog or done', () => {
    const tree = project('p1', [
      node('LIN-30', 'unstarted'), node('LIN-31', 'unstarted'), node('LIN-32', 'unstarted'),
      node('LIN-33', 'unstarted'), node('LIN-34', 'backlog'), node('LIN-35', 'unstarted'), node('LIN-36', 'completed'),
    ]);
    const rows = homeRowsFor({ kind: 'up-next', projectId: 'p1', trees: [tree], inProgressTrees: [], states: states({}) });
    assert.deepEqual(ids(rows.nodes), ['LIN-33', 'LIN-35']);
  });

  test('more-of-parent: a started parent\'s open children the In Progress view folded, never the ones it shows', () => {
    const parent = node('LIN-40', 'started', [
      node('LIN-41', 'started'),
      node('LIN-42', 'unstarted'),
      node('LIN-43', 'completed'),
      node('LIN-44', 'backlog'),
    ]);
    const rows = homeRowsFor({
      kind: 'more-of-parent', parentId: 'id-LIN-40', trees: [], inProgressTrees: inProgress([parent]), states: states({}),
    });
    assert.deepEqual(ids(rows.nodes), ['LIN-42', 'LIN-44'], 'the done LIN-43 is not sent; LIN-41 is shown already');
    assert.equal(rows.section, 'in-progress', 'folded children render under the In Progress section, like their parent');
    assert.equal(rows.parentId, 'id-LIN-40');
  });

  test('search: finds a folded Backlog task by its title, under its ancestors, and never a done task', () => {
    const tree = project('p1', [
      node('LIN-50', 'backlog', [
        node('LIN-51', 'backlog', [], 'Quarterly invoice export'),
        node('LIN-52', 'completed', [], 'Quarterly invoice archive'),
      ]),
      node('LIN-53', 'backlog', [], 'Unrelated'),
    ]);
    const rows = homeRowsFor({ kind: 'search', q: 'invoice', trees: [tree], inProgressTrees: [], states: states({}) });
    assert.equal(rows.section, 'search');
    assert.equal(rows.nodes.length, 1, 'one root: the ancestor that holds the match');
    const [ancestor] = rows.nodes;
    assert.equal(ancestor.issue.identifier, 'LIN-50');
    assert.equal(ancestor.context, true, 'the ancestor is context, not a match');
    assert.deepEqual(ids(ancestor.children), ['LIN-51'], 'the done match LIN-52 is not sent');
    assert.equal(ancestor.children[0].context, false);
  });

  test('search: a task that In Progress and a project both hold is shown once, under In Progress', () => {
    const shared = node('LIN-60', 'started', [], 'Shared invoice task');
    const rows = homeRowsFor({
      kind: 'search', q: 'invoice',
      trees: [project('p1', [shared])],
      inProgressTrees: inProgress([shared]),
      states: states({}),
    });
    assert.deepEqual(ids(rows.nodes), ['LIN-60']);
  });

  test('search: an empty term finds nothing; the result is capped and reports what is left', () => {
    assert.deepEqual(homeRowsFor({ kind: 'search', q: '   ', trees: [], inProgressTrees: [], states: states({}) }).nodes, []);
    const many = Array.from({ length: 105 }, (_, i) => node(`LIN-${300 + i}`, 'backlog', [], `match ${i}`));
    const rows = homeRowsFor({ kind: 'search', q: 'match', trees: [project('p1', many)], inProgressTrees: [], states: states({}) });
    assert.equal(rows.nodes.length, 100);
    assert.equal(rows.remaining, 5);
  });

  test('a project the workspace does not hold yields no rows, not an error', () => {
    const rows = homeRowsFor({ kind: 'backlog', projectId: 'missing', trees: [project('p1', [node('LIN-70', 'backlog')])], inProgressTrees: [], states: states({}) });
    assert.deepEqual(rows.nodes, []);
    assert.equal(rows.nextOffset, null);
  });
});

describe('the Home page: the folds, and no done task', () => {
  const trees = () => {
    const done = node('LIN-80', 'completed', [], 'Finished work');
    const { incomplete, completed, completedCount } = partitionCompleted([node('LIN-81', 'backlog'), done]);
    return [
      { project: { id: 'p1', name: 'Proj', collapsed: false }, incomplete, completed, completedCount },
    ];
  };

  test('the page holds the Backlog fold with its URL key, the done count, and no completed toggle or --depth style', () => {
    const projectTrees = trees();
    const view = buildHomeView({ inProgressTrees: [], trees: projectTrees, states: states({}) });
    const html = renderPage(view.trees, view.inProgressTrees, [], 'Org', { urlKey: 'ws', workspace: WORKSPACE, workspaces: [WORKSPACE], featureFlags: {} });

    assert.match(html, /data-home-fetch="backlog"[^>]*data-url-key="ws"/, 'the Backlog fold opens its rows from this workspace');
    assert.match(html, /data-testid="home-fold-backlog"/);
    assert.match(html, /show 1 in Backlog/);
    assert.match(html, /data-testid="home-done-count"[^>]*>1 done</, 'done is a count');
    assert.doesNotMatch(html, /Finished work/, 'a done task is not on the page');
    assert.doesNotMatch(html, /data-completed-for/);
    assert.doesNotMatch(html, /completed-toggle/, 'Home has no "show N completed" toggle');
    assert.doesNotMatch(html, /--depth/, 'no row carries an inline --depth style');
    assert.match(html, /data-lazy-results[^>]*data-url-key="ws"/, 'search rows have a container that knows the URL key');
  });

  test('a folded child of a started parent renders its fold hidden until the parent opens', () => {
    const parent = node('LIN-90', 'started', [node('LIN-91', 'started'), node('LIN-92', 'unstarted')]);
    const view = buildHomeView({ inProgressTrees: inProgress([parent]), trees: [], states: states({}) });
    const html = renderPage([], view.inProgressTrees, [], 'Org', { urlKey: 'ws', workspace: WORKSPACE, workspaces: [WORKSPACE], featureFlags: {} });
    assert.match(html, /<div class="home-fold hidden" data-home-fetch="more-of-parent"[^>]*data-parent-id="id-LIN-90"[^>]*>show 1 more/);
  });

  test('renderHomeRowsHtml renders fetched rows as the page does, with no done row and no --depth', () => {
    const rows = homeRowsFor({ kind: 'backlog', projectId: 'p1', trees: trees(), inProgressTrees: [], states: states({}) });
    const ctx = homeRowsContext({ workspace: WORKSPACE, urlKey: 'ws', featureFlags: {}, rowStates: null });
    const html = renderHomeRowsHtml(rows.nodes, { section: rows.section, parentId: rows.parentId, ctx });
    assert.match(html, /data-identifier="LIN-81"/);
    assert.doesNotMatch(html, /LIN-80/, 'the done task is never a fetched row');
    assert.doesNotMatch(html, /--depth/);
    assert.match(html, /data-section="project"/);
  });
});

describe('a task that needs you is openable even with no details', () => {
  // A bare Todo row (no description, assignee, labels or children) waiting on a ruling. Its opened task is where the
  // ruling is answered, so it must be a button that lazy-loads its detail, as a row with details does.
  const bare = (identifier) => ({ issue: { id: `id-${identifier}`, identifier, title: identifier, state: { type: 'unstarted' }, labels: { nodes: [] } }, children: [], depth: 0 });
  const ctxFor = (rowStates) => homeRowsContext({ workspace: WORKSPACE, urlKey: 'ws', featureFlags: {}, rowStates });

  test('a needs-you row with no details is expandable and lazy-loads its opened task', () => {
    const html = renderHomeRowsHtml([bare('LIN-90')], { section: 'in-progress', parentId: 'p1', ctx: ctxFor(states({ 'LIN-90': { state: 'needs-you', tone: 'needs-you', words: 'needs you' } })) });
    assert.match(html, /data-identifier="LIN-90"[^>]*/);
    assert.match(html, /class="line expandable" role="button"[^>]*data-identifier="LIN-90"/);
    assert.match(html, /data-details-for="id-LIN-90"[^>]*data-lazy="1"/, 'the detail wrapper is there for the opened task to load into');
  });

  test('a row with no details and no ruling stays a plain line, as before', () => {
    const html = renderHomeRowsHtml([bare('LIN-91')], { section: 'in-progress', parentId: 'p1', ctx: ctxFor(states({})) });
    assert.doesNotMatch(html, /role="button"/);
    assert.doesNotMatch(html, /data-details-for/);
  });
});
