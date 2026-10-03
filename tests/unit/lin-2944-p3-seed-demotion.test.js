/**
 * LIN-2944 P3 — R2-5 top-task seed demotion, red-first witnesses.
 *
 * The starter seed creates TWO issues (`${urlKey}-issue-1` LOCAL-1 and
 * `${urlKey}-issue-2` LOCAL-2). They are onboarding scaffolding, not real work, so
 * neither may surface as the deck's front card or Home's marked top task. The
 * demotion lives in the ONE shared ordering helper (`orderIssuesForSwipe`) so
 * Swipe's front card and Home's mark cannot drift; when only seed content
 * remains the deck orders empty.
 *
 * `starterSeedIssueIds(urlKey)` (exported next to `starterSeed`) is the single
 * source of truth for the seed ids, so a future third seed issue is covered
 * automatically.
 *
 * Authored against the pre-P3 code: the helper has no `urlKey` option, the seed
 * ids are not exported, and a seed card wins the deck today.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { orderIssuesForSwipe } from '../../lib/render-swipe.js';
import { starterSeedIssueIds } from '../../routes/workspace.js';
import { nodeKey } from '../../lib/tree.js';
import '../../lib/providers/linear/index.js';

const URL_KEY = 'ws';

function issue(over = {}) {
  return {
    id: 'i-x', identifier: 'LOC-X', title: 'Task', priority: 3, url: '',
    state: { type: 'started', name: 'In Progress' },
    labels: { nodes: [] }, relations: { nodes: [] }, project: { id: 'p1' },
    ...over
  };
}

function node(issueDoc) {
  return { issue: issueDoc, children: [], depth: 0, isInProgress: true, projectName: 'Project' };
}

describe('LIN-2944 P3 — starterSeedIssueIds', () => {
  test('covers BOTH seed issues, derived from starterSeed (not a second list)', () => {
    const ids = starterSeedIssueIds(URL_KEY);
    assert.ok(ids.has(`${URL_KEY}-issue-1`), 'LOCAL-1 is a seed id');
    assert.ok(ids.has(`${URL_KEY}-issue-2`), 'LOCAL-2 is a seed id');
    assert.equal(ids.size, 2, 'exactly the two starter issues');
  });
});

describe('LIN-2944 P3 — orderIssuesForSwipe demotes seed-origin tasks', () => {
  test('a real task outranks a boosted seed task — the seed is not the front card', () => {
    const seed = issue({ id: `${URL_KEY}-issue-1`, identifier: 'LOCAL-1', title: 'Welcome to your local workspace', priority: 1, labels: { nodes: [{ name: 'bug' }] } });
    const seedChild = issue({ id: `${URL_KEY}-issue-2`, identifier: 'LOCAL-2', title: 'Add your own tasks', state: { type: 'unstarted', name: 'Todo' } });
    const real = issue({ id: 'real-1', identifier: 'REAL-1', title: 'Real task', priority: 4 });

    const data = {
      projectTrees: [{ project: { id: 'p1', name: 'Project' }, incomplete: [node(real), node(seed)], completed: [], completedCount: 0 }],
      inProgressTrees: [{ projectName: 'Project', roots: [node(seed), node(real)] }],
      recentActivityTrees: []
    };

    const ordered = orderIssuesForSwipe({ ...data, urlKey: URL_KEY });
    assert.equal(ordered[0].id, 'real-1', 'the real task is the front card, never the seed');
    assert.ok(!ordered.some(i => i.id === `${URL_KEY}-issue-1`), 'LOCAL-1 is not in the deck');
    assert.ok(!ordered.some(i => i.id === `${URL_KEY}-issue-2`), 'LOCAL-2 is not in the deck');
    assert.ok(seedChild, 'fixture guard');
  });

  test('with only seed content the deck is EMPTY (onboarding, not a fake top task)', () => {
    const seed = issue({ id: `${URL_KEY}-issue-1`, identifier: 'LOCAL-1', priority: 1 });
    const seedChild = issue({ id: `${URL_KEY}-issue-2`, identifier: 'LOCAL-2', state: { type: 'unstarted', name: 'Todo' }, parentId: `${URL_KEY}-issue-1`, parent: { id: `${URL_KEY}-issue-1` } });
    const data = {
      projectTrees: [{ project: { id: 'p1', name: 'Project' }, incomplete: [node(seed)], completed: [], completedCount: 0 }],
      inProgressTrees: [{ projectName: 'Project', roots: [node(seed), node(seedChild)] }],
      recentActivityTrees: []
    };
    assert.deepEqual(orderIssuesForSwipe({ ...data, urlKey: URL_KEY }), [], 'no real work → empty deck');
  });

  test('Home and Swipe still agree on the top task after demotion', async () => {
    const { renderPage } = await import('../../lib/render.js');
    const seed = issue({ id: `${URL_KEY}-issue-1`, identifier: 'LOCAL-1', priority: 1 });
    const real = issue({ id: 'real-1', identifier: 'REAL-1', title: 'Real task', priority: 4 });
    const data = {
      projectTrees: [{ project: { id: 'p1', name: 'Project' }, incomplete: [node(real), node(seed)], completed: [], completedCount: 0 }],
      inProgressTrees: [{ projectName: 'Project', roots: [node(seed), node(real)] }],
      recentActivityTrees: []
    };
    const ordered = orderIssuesForSwipe({ ...data, urlKey: URL_KEY });
    assert.equal(ordered[0].id, 'real-1');

    const html = renderPage(data.projectTrees, data.inProgressTrees, data.recentActivityTrees, 'Org', {
      urlKey: URL_KEY, workspaces: [{ urlKey: URL_KEY, name: 'WS', provider: 'linear' }], featureFlags: {},
      topTaskId: nodeKey(ordered[0]), topTaskWhy: ordered[0].why
    });
    const tags = html.match(/<div class="line[^"]*"[^>]*>/g) || [];
    const tag = tags.find(t => t.includes('data-top-task="1"'));
    assert.ok(tag, 'Home marks the real top task');
    assert.match(tag, /data-id="real-1"/, 'Home marks the real task, not the seed');
  });
});
