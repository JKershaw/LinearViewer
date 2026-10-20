/**
 * LIN-3579 — pins for the behaviour fixes the renderer-cluster rebuild made
 * (class (a) in the PR's replay table). Everything else the rebuild changed
 * is pinned by the existing suites; these are the only intended differences.
 *
 * 1. Periodicals rows leaked into Home's ordering (`orderIssuesForSwipe`). They
 *    are unstarted with no priority, so one could become the top task — but
 *    `renderPeriodicalNode` never marks a row, so Home showed no top-task mark,
 *    and a seed-only workspace with Periodicals lost its onboarding hint. The
 *    Swipe deck never sees them (its route builds trees without a urlKey), and
 *    the ordering's own docblock says the two surfaces cannot drift.
 * 2. The details meta line interpolated the provider's identifier, assignee
 *    name and estimate unescaped. Each item is now escaped on its own; the
 *    labels item is already HTML (`renderDisplayLabels`) and is not re-escaped.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../../lib/providers/index.js';
import { renderPage, renderDetailsContent } from '../../lib/render.js';
import { orderIssuesForSwipe } from '../../lib/render-swipe.js';
import { buildForest, partitionCompleted, buildInProgressForest, buildRecentActivityForest, nodeKey, PERIODICALS_PROJECT_ID } from '../../lib/tree.js';
import { starterSeed } from '../../lib/starter-seed.js';
import { testMockPeriodicalsTree } from '../fixtures/periodicals-tree.js';

const URL_KEY = 'ws';

/** Home's trees as server.js's fetchAndPrepareProjects builds them. */
function homeTrees(issues, projects, { periodicals }) {
  const forest = buildForest(issues);
  const trees = projects.map((project) => {
    const { roots } = forest.get(project.id) || { roots: [] };
    const { incomplete, completed, completedCount } = partitionCompleted(roots);
    return { project: { ...project, collapsed: incomplete.length === 0 && completedCount === 0 }, incomplete, completed, completedCount };
  });
  if (periodicals) trees.push(testMockPeriodicalsTree);
  return {
    trees,
    inProgressTrees: buildInProgressForest(issues, projects),
    recentActivityTrees: buildRecentActivityForest(issues, projects, 1)
  };
}

/** server.js's Home route: the ordering, its two derivations (1757-1759), and the projection into renderPage (1777-1779). */
function renderHome({ trees, inProgressTrees, recentActivityTrees }) {
  const orderedHome = orderIssuesForSwipe({ projectTrees: trees, inProgressTrees, recentActivityTrees, urlKey: URL_KEY });
  const homeTopTask = orderedHome.find((issue) => !issue.isSeed) || null;
  const seedOnlyHome = orderedHome.length > 0 && orderedHome.every((issue) => issue.isSeed);
  const html = renderPage(trees, inProgressTrees, recentActivityTrees, 'Org', {
    urlKey: URL_KEY,
    topTaskId: homeTopTask ? nodeKey(homeTopTask) : null,
    topTaskWhy: homeTopTask ? homeTopTask.why : [],
    topTaskOnboarding: seedOnlyHome
  });
  return { orderedHome, seedOnlyHome, html };
}

const periodicalIds = new Set(testMockPeriodicalsTree.incomplete.map((node) => node.issue.id));

describe('LIN-3579 (a): Periodicals rows stay out of Home\'s ordering', () => {
  test('a backlog task with the Periodicals group is still marked as the top task, once', () => {
    const backlog = {
      id: 'i1', identifier: 'LIN-1', title: 'Real backlog task', description: 'x', priority: 0,
      url: 'https://linear.app/i1', parent: null, project: { id: 'p1', name: 'P' },
      state: { name: 'Backlog', type: 'backlog' }, assignee: null, labels: { nodes: [] }
    };
    const world = homeTrees([backlog], [{ id: 'p1', name: 'P', content: null, url: null, sortOrder: 1 }], { periodicals: true });
    const treesBefore = world.trees.length;

    const { orderedHome, html } = renderHome(world);

    assert.deepEqual(orderedHome.filter((card) => periodicalIds.has(card.id)), [], 'no Periodicals row is ranked');
    assert.deepEqual(orderedHome.map((card) => card.id), ['i1']);
    const marks = html.match(/<div class="[^"]*"[^>]*data-top-task="1"[^>]*>/g) || [];
    assert.equal(marks.length, 1, 'exactly one row carries the top-task mark');
    assert.match(marks[0], /data-id="i1"/, 'the mark is on the real task');
    // The filter works on a copy: the caller's trees still render the Periodicals group.
    assert.equal(world.trees.length, treesBefore);
    assert.ok(world.trees.some((tree) => tree.project.id === PERIODICALS_PROJECT_ID));
    assert.match(html, /data-project-type="periodicals"/);
  });

  test('a seed-only workspace with the Periodicals group still shows the onboarding hint', () => {
    const seed = starterSeed(URL_KEY);
    const world = homeTrees(structuredClone(seed.issues), seed.projects.map((p) => ({ url: null, ...p })), { periodicals: true });

    const { orderedHome, seedOnlyHome, html } = renderHome(world);

    assert.ok(orderedHome.length > 0 && orderedHome.every((card) => card.isSeed), 'only seed cards are ranked');
    assert.equal(seedOnlyHome, true);
    assert.match(html, /data-testid="home-top-task-onboarding"/);
    assert.doesNotMatch(html, /data-top-task="1"/, 'a seed is never marked as the top task');
  });
});

describe('LIN-3579 (a): the details meta line escapes each provider-supplied item', () => {
  const metaOf = (html) => /<span class="detail-meta">(.*?)<\/span><\/div>/.exec(html)?.[1];

  test('identifier, assignee and estimate are escaped; the labels item is not escaped twice', () => {
    const html = renderDetailsContent({
      id: 'i1', identifier: 'A<1>&', title: 'T', url: '',
      assignee: { name: 'O\'Brien & <x>' }, estimate: '3<b>',
      labels: { nodes: [{ name: '<b>x</b>' }] }
    }, { urlKey: URL_KEY });
    assert.equal(metaOf(html), 'A&lt;1&gt;&amp; · O&#039;Brien &amp; &lt;x&gt; · 3&lt;b&gt; pts · &lt;b&gt;x&lt;/b&gt;');
  });

  test('real identifiers, names and estimates render byte-identically', () => {
    const html = renderDetailsContent({
      id: 'i1', identifier: 'LIN-12', title: 'T', url: '',
      assignee: { name: 'Ada Lovelace' }, estimate: 3, labels: { nodes: [] }
    }, { urlKey: URL_KEY });
    assert.equal(metaOf(html), 'LIN-12 · Ada Lovelace · 3 pts');
  });
});
