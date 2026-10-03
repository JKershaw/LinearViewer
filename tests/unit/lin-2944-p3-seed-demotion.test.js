/**
 * LIN-2944 P3 — R2-5 top-task seed demotion, red-first witnesses.
 *
 * Addendum 18 (verdict `15237eb1`), corrected semantics:
 *   * `orderIssuesForSwipe` REORDERS seed-origin cards to the END — they are NOT
 *     deleted and stay reachable.
 *   * A card reports whether it is seed-origin (`isSeed`), so the front card can
 *     tell "no real card remains" without a second pick.
 *   * Home's seed rows stay in the list and are never marked as the top task.
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

/** The seed's two issues, shape-mirroring `starterSeed`. */
function seedIssues() {
  return {
    parent: issue({ id: `${URL_KEY}-issue-1`, identifier: 'LOCAL-1', title: 'Welcome to your local workspace', priority: 1, labels: { nodes: [{ name: 'bug' }] } }),
    child: issue({ id: `${URL_KEY}-issue-2`, identifier: 'LOCAL-2', title: 'Add your own tasks', state: { type: 'unstarted', name: 'Todo' } }),
  };
}

describe('LIN-2944 P3 — starterSeedIssueIds', () => {
  test('covers BOTH seed issues, derived from starterSeed (not a second list)', () => {
    const ids = starterSeedIssueIds(URL_KEY);
    assert.ok(ids.has(`${URL_KEY}-issue-1`), 'LOCAL-1 is a seed id');
    assert.ok(ids.has(`${URL_KEY}-issue-2`), 'LOCAL-2 is a seed id');
    assert.equal(ids.size, 2, 'exactly the two starter issues');
  });
});

describe('LIN-2944 P3 — orderIssuesForSwipe reorders seeds to the end (retained)', () => {
  test('a real task outranks a boosted seed; the seed moves after it and is NOT deleted', () => {
    const { parent: seed, child: seedChild } = seedIssues();
    const real = issue({ id: 'real-1', identifier: 'REAL-1', title: 'Real task', priority: 4 });

    const data = {
      projectTrees: [{ project: { id: 'p1', name: 'Project' }, incomplete: [node(real), node(seed), node(seedChild)], completed: [], completedCount: 0 }],
      inProgressTrees: [{ projectName: 'Project', roots: [node(seed), node(real)] }],
      recentActivityTrees: []
    };

    const ordered = orderIssuesForSwipe({ ...data, urlKey: URL_KEY });
    assert.equal(ordered[0].id, 'real-1', 'the real task is the front card');
    assert.equal(ordered[0].isSeed, false, 'the front card reports it is not a seed');

    const seedIds = ordered.filter(c => c.isSeed).map(c => c.id);
    assert.deepEqual(
      seedIds.sort(),
      [`${URL_KEY}-issue-1`, `${URL_KEY}-issue-2`].sort(),
      'both seed cards are present (reachable), just demoted'
    );
    // Every seed sits after every real card.
    const firstSeedIdx = ordered.findIndex(c => c.isSeed);
    const lastRealIdx = ordered.map(c => c.isSeed).lastIndexOf(false);
    assert.ok(firstSeedIdx > lastRealIdx, 'seeds come after all real cards');
  });

  test('with only seed content the cards are RETAINED but report no real card', () => {
    const { parent: seed, child: seedChild } = seedIssues();
    const data = {
      projectTrees: [{ project: { id: 'p1', name: 'Project' }, incomplete: [node(seed)], completed: [], completedCount: 0 }],
      inProgressTrees: [{ projectName: 'Project', roots: [node(seed), node(seedChild)] }],
      recentActivityTrees: []
    };
    const ordered = orderIssuesForSwipe({ ...data, urlKey: URL_KEY });
    assert.equal(ordered.length, 2, 'seed cards are not deleted');
    assert.ok(ordered.every(c => c.isSeed === true), 'every card reports seed-origin');
    assert.ok(!ordered.some(c => c.isSeed === false), 'the front can tell no real card remains');
  });

  test('Home marks the real top task, never a seed (parity with the deck)', async () => {
    const { renderPage } = await import('../../lib/render.js');
    const { parent: seed } = seedIssues();
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

    // Seed-only: Home marks nothing (the onboarding hint is the renderer's job).
    const seedOnly = {
      projectTrees: [{ project: { id: 'p1', name: 'Project' }, incomplete: [node(seed)], completed: [], completedCount: 0 }],
      inProgressTrees: [{ projectName: 'Project', roots: [node(seed)] }],
      recentActivityTrees: []
    };
    const seedOrdered = orderIssuesForSwipe({ ...seedOnly, urlKey: URL_KEY });
    assert.ok(seedOrdered.every(c => c.isSeed));
    const seedHtml = renderPage(seedOnly.projectTrees, seedOnly.inProgressTrees, seedOnly.recentActivityTrees, 'Org', {
      urlKey: URL_KEY, workspaces: [{ urlKey: URL_KEY, name: 'WS', provider: 'linear' }], featureFlags: {},
      topTaskId: null, topTaskWhy: []
    });
    assert.equal((seedHtml.match(/data-top-task="1"/g) || []).length, 0, 'no seed row is marked');
  });
});
