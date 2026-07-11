/**
 * Unit tests for swipe view sorting and blocking order.
 *
 * Run with: node --test tests/unit/swipe-sort.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { sortIssuesForSwipe, applyBlockingOrder, clusterByParent, buildFilterGroups, flattenTrees, computeGraphFeatures, computeOffPageBlockers, buildWhy, isBoostableBug } from '../../lib/render-swipe.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createCard(overrides = {}) {
  return {
    id: 'card-' + Math.random().toString(36).substr(2, 9),
    identifier: '',
    title: 'Test Card',
    description: '',
    priority: 2,
    url: '',
    stateType: 'unstarted',
    stateName: 'Todo',
    labels: [],
    projectName: 'Test Project',
    completedAt: null,
    dueDate: null,
    section: 'project',
    blocksIds: [],
    ...overrides
  };
}

// =============================================================================
// sortIssuesForSwipe
// =============================================================================

describe('sortIssuesForSwipe', () => {
  test('puts terminal-state issues (completed/canceled/duplicate) last', () => {
    const cards = [
      createCard({ id: 'done', stateType: 'completed' }),
      createCard({ id: 'todo', stateType: 'unstarted' }),
      createCard({ id: 'canceled', stateType: 'canceled' }),
      createCard({ id: 'dup', stateType: 'duplicate' }),
    ];
    sortIssuesForSwipe(cards);
    assert.strictEqual(cards[0].id, 'todo');
    // The other three are all terminal and may appear in any order among themselves.
    const tail = new Set(cards.slice(1).map(c => c.id));
    assert.deepStrictEqual(tail, new Set(['done', 'canceled', 'dup']));
  });

  test('puts bugs before non-bugs within same state group', () => {
    const cards = [
      createCard({ id: 'feature', stateType: 'started', labels: ['feature'], priority: 1 }),
      createCard({ id: 'bug', stateType: 'started', labels: ['bug'], priority: 1 }),
    ];
    sortIssuesForSwipe(cards);
    assert.strictEqual(cards[0].id, 'bug');
    assert.strictEqual(cards[1].id, 'feature');
  });

  // LIN-1253: the bug boost is gated on isBoostableBug — backlog-state and
  // low/no-priority bugs no longer jump the queue; normal bugs still do.
  test('does NOT boost a backlog-state bug above a started higher-priority non-bug', () => {
    const cards = [
      createCard({ id: 'backlogBug', stateType: 'backlog', labels: ['bug'], priority: 1 }),
      createCard({ id: 'startedFeature', stateType: 'started', labels: ['feature'], priority: 3 }),
    ];
    sortIssuesForSwipe(cards);
    // started work outranks a backlog bug — the label no longer overrides state
    assert.deepStrictEqual(cards.map(c => c.id), ['startedFeature', 'backlogBug']);
  });

  test('does NOT boost a Low(4) or None(0) priority bug above a same-state non-bug', () => {
    const cards = [
      createCard({ id: 'lowBug', stateType: 'unstarted', labels: ['bug'], priority: 4 }),
      createCard({ id: 'noneBug', stateType: 'unstarted', labels: ['bug'], priority: 0 }),
      createCard({ id: 'medFeature', stateType: 'unstarted', labels: ['feature'], priority: 3 }),
    ];
    sortIssuesForSwipe(cards);
    // the higher-priority non-bug leads; the low/none bugs fall through to
    // normal priority order (not boosted, but also not demoted below priority)
    assert.deepStrictEqual(cards.map(c => c.id), ['medFeature', 'lowBug', 'noneBug']);
  });

  test('STILL boosts a normal Urgent/High/Medium non-backlog bug (no over-correction)', () => {
    for (const priority of [1, 2, 3]) {
      const cards = [
        createCard({ id: 'feature', stateType: 'started', labels: ['feature'], priority: 1 }),
        createCard({ id: 'bug', stateType: 'started', labels: ['bug'], priority }),
      ];
      sortIssuesForSwipe(cards);
      assert.strictEqual(cards[0].id, 'bug', `priority ${priority} bug should still be boosted`);
    }
  });

  test('sorts by state order: started > unstarted > backlog', () => {
    const cards = [
      createCard({ id: 'backlog', stateType: 'backlog', priority: 1 }),
      createCard({ id: 'started', stateType: 'started', priority: 1 }),
      createCard({ id: 'unstarted', stateType: 'unstarted', priority: 1 }),
    ];
    sortIssuesForSwipe(cards);
    assert.deepStrictEqual(cards.map(c => c.id), ['started', 'unstarted', 'backlog']);
  });

  test('sorts by priority within same state', () => {
    const cards = [
      createCard({ id: 'low', stateType: 'unstarted', priority: 4 }),
      createCard({ id: 'urgent', stateType: 'unstarted', priority: 1 }),
      createCard({ id: 'medium', stateType: 'unstarted', priority: 3 }),
    ];
    sortIssuesForSwipe(cards);
    assert.deepStrictEqual(cards.map(c => c.id), ['urgent', 'medium', 'low']);
  });

  test('treats priority 0 (none) as lowest', () => {
    const cards = [
      createCard({ id: 'none', stateType: 'unstarted', priority: 0 }),
      createCard({ id: 'low', stateType: 'unstarted', priority: 4 }),
    ];
    sortIssuesForSwipe(cards);
    assert.deepStrictEqual(cards.map(c => c.id), ['low', 'none']);
  });

  // LIN-391: downstreamUnblocks then criticalPathLen are tiebreakers sitting
  // BELOW state and ABOVE priority.
  test('breaks ties by downstreamUnblocks (desc) below state, above priority', () => {
    const cards = [
      createCard({ id: 'lowunblock', stateType: 'unstarted', priority: 1, downstreamUnblocks: 1 }),
      createCard({ id: 'highunblock', stateType: 'unstarted', priority: 4, downstreamUnblocks: 6 }),
    ];
    sortIssuesForSwipe(cards);
    // higher downstreamUnblocks wins despite worse priority
    assert.deepStrictEqual(cards.map(c => c.id), ['highunblock', 'lowunblock']);
  });

  test('breaks downstreamUnblocks ties by criticalPathLen (desc)', () => {
    const cards = [
      createCard({ id: 'shortpath', stateType: 'unstarted', priority: 1, downstreamUnblocks: 3, criticalPathLen: 2 }),
      createCard({ id: 'longpath', stateType: 'unstarted', priority: 4, downstreamUnblocks: 3, criticalPathLen: 5 }),
    ];
    sortIssuesForSwipe(cards);
    assert.deepStrictEqual(cards.map(c => c.id), ['longpath', 'shortpath']);
  });

  test('state still dominates the new feature tiebreakers', () => {
    const cards = [
      createCard({ id: 'backlogHighUnblock', stateType: 'backlog', priority: 1, downstreamUnblocks: 9, criticalPathLen: 9 }),
      createCard({ id: 'startedNoUnblock', stateType: 'started', priority: 4, downstreamUnblocks: 0, criticalPathLen: 1 }),
    ];
    sortIssuesForSwipe(cards);
    // in-progress work is never displaced by a high-unblock backlog item
    assert.deepStrictEqual(cards.map(c => c.id), ['startedNoUnblock', 'backlogHighUnblock']);
  });

  test('falls back to priority when features are absent/equal', () => {
    const cards = [
      createCard({ id: 'low', stateType: 'unstarted', priority: 4 }),
      createCard({ id: 'urgent', stateType: 'unstarted', priority: 1 }),
    ];
    sortIssuesForSwipe(cards);
    assert.deepStrictEqual(cards.map(c => c.id), ['urgent', 'low']);
  });
});

// =============================================================================
// applyBlockingOrder
// =============================================================================

describe('applyBlockingOrder', () => {
  test('moves blocker before blocked issue', () => {
    const blocker = createCard({ id: 'blocker', stateType: 'unstarted', priority: 4, blocksIds: ['blocked'] });
    const blocked = createCard({ id: 'blocked', stateType: 'unstarted', priority: 1 });
    // blocked has higher priority so sorts first normally
    const sorted = [blocked, blocker];
    const result = applyBlockingOrder(sorted);
    assert.strictEqual(result[0].id, 'blocker');
    assert.strictEqual(result[1].id, 'blocked');
  });

  test('preserves order when no blocking relationships', () => {
    const a = createCard({ id: 'a', stateType: 'started' });
    const b = createCard({ id: 'b', stateType: 'unstarted' });
    const c = createCard({ id: 'c', stateType: 'backlog' });
    const result = applyBlockingOrder([a, b, c]);
    assert.deepStrictEqual(result.map(i => i.id), ['a', 'b', 'c']);
  });

  test('handles chain: A blocks B blocks C', () => {
    const a = createCard({ id: 'a', stateType: 'backlog', priority: 4, blocksIds: ['b'] });
    const b = createCard({ id: 'b', stateType: 'backlog', priority: 3, blocksIds: ['c'] });
    const c = createCard({ id: 'c', stateType: 'backlog', priority: 1 });
    // Original order by priority: c, b, a
    const result = applyBlockingOrder([c, b, a]);
    assert.deepStrictEqual(result.map(i => i.id), ['a', 'b', 'c']);
  });

  test('ignores blocking edges from completed issues', () => {
    const blocker = createCard({ id: 'blocker', stateType: 'completed', blocksIds: ['blocked'] });
    const blocked = createCard({ id: 'blocked', stateType: 'unstarted' });
    // blocker is completed so its edge is ignored — original order preserved
    const result = applyBlockingOrder([blocked, blocker]);
    assert.deepStrictEqual(result.map(i => i.id), ['blocked', 'blocker']);
  });

  test('ignores blocking edges from duplicate issues (LIN-276)', () => {
    const blocker = createCard({ id: 'blocker', stateType: 'duplicate', blocksIds: ['blocked'] });
    const blocked = createCard({ id: 'blocked', stateType: 'unstarted' });
    const result = applyBlockingOrder([blocked, blocker]);
    assert.deepStrictEqual(result.map(i => i.id), ['blocked', 'blocker']);
  });

  test('handles cycles gracefully', () => {
    const a = createCard({ id: 'a', stateType: 'unstarted', blocksIds: ['b'] });
    const b = createCard({ id: 'b', stateType: 'unstarted', blocksIds: ['a'] });
    const result = applyBlockingOrder([a, b]);
    // Both should appear (cycle doesn't cause loss)
    assert.strictEqual(result.length, 2);
    const ids = new Set(result.map(i => i.id));
    assert.ok(ids.has('a'));
    assert.ok(ids.has('b'));
  });

  test('blocking edges to issues outside the set are ignored', () => {
    const a = createCard({ id: 'a', stateType: 'unstarted', blocksIds: ['not-in-set'] });
    const b = createCard({ id: 'b', stateType: 'unstarted' });
    const result = applyBlockingOrder([a, b]);
    assert.deepStrictEqual(result.map(i => i.id), ['a', 'b']);
  });

  test('stable ordering among unrelated issues', () => {
    const blocker = createCard({ id: 'blocker', stateType: 'unstarted', priority: 4, blocksIds: ['blocked'] });
    const unrelated1 = createCard({ id: 'u1', stateType: 'unstarted', priority: 2 });
    const unrelated2 = createCard({ id: 'u2', stateType: 'unstarted', priority: 3 });
    const blocked = createCard({ id: 'blocked', stateType: 'unstarted', priority: 1 });
    // Pre-sorted order: blocked (p1), u1 (p2), u2 (p3), blocker (p4)
    const result = applyBlockingOrder([blocked, unrelated1, unrelated2, blocker]);
    // blocker must come before blocked, unrelated issues keep their relative positions
    const blockerIdx = result.findIndex(i => i.id === 'blocker');
    const blockedIdx = result.findIndex(i => i.id === 'blocked');
    assert.ok(blockerIdx < blockedIdx, 'blocker should appear before blocked');
    // Unrelated issues should maintain their relative order
    const u1Idx = result.findIndex(i => i.id === 'u1');
    const u2Idx = result.findIndex(i => i.id === 'u2');
    assert.ok(u1Idx < u2Idx, 'unrelated issues should keep relative order');
  });

  test('handles empty array', () => {
    const result = applyBlockingOrder([]);
    assert.deepStrictEqual(result, []);
  });

  test('handles single issue', () => {
    const a = createCard({ id: 'a' });
    const result = applyBlockingOrder([a]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'a');
  });

  test('handles issues with missing blocksIds', () => {
    const a = createCard({ id: 'a' });
    delete a.blocksIds;
    const b = createCard({ id: 'b' });
    const result = applyBlockingOrder([a, b]);
    assert.strictEqual(result.length, 2);
  });
});

// =============================================================================
// clusterByParent
// =============================================================================

describe('clusterByParent', () => {
  test('clusters subtasks before their parent', () => {
    const parent = createCard({ id: 'parent', priority: 1 });
    const child1 = createCard({ id: 'child1', parentId: 'parent', priority: 3 });
    const child2 = createCard({ id: 'child2', parentId: 'parent', priority: 4 });
    const unrelated = createCard({ id: 'unrelated', priority: 2 });
    // Input order: parent, unrelated, child1, child2
    const result = clusterByParent([parent, unrelated, child1, child2]);
    // Parent cluster should appear at parent's position (first), subtasks before parent
    assert.strictEqual(result[0].id, 'child1');
    assert.strictEqual(result[1].id, 'child2');
    assert.strictEqual(result[2].id, 'parent');
    assert.strictEqual(result[3].id, 'unrelated');
  });

  test('clusters at position of earliest family member', () => {
    const parent = createCard({ id: 'parent', priority: 4 });
    const child = createCard({ id: 'child', parentId: 'parent', priority: 1 });
    const unrelated = createCard({ id: 'unrelated', priority: 2 });
    // child sorts first by priority, so cluster anchors there
    const result = clusterByParent([child, unrelated, parent]);
    assert.strictEqual(result[0].id, 'child');
    assert.strictEqual(result[1].id, 'parent');
    assert.strictEqual(result[2].id, 'unrelated');
  });

  test('returns unchanged array when no parent-child relationships', () => {
    const a = createCard({ id: 'a' });
    const b = createCard({ id: 'b' });
    const result = clusterByParent([a, b]);
    assert.deepStrictEqual(result.map(i => i.id), ['a', 'b']);
  });

  test('handles nested subtasks (grandchildren)', () => {
    const grandparent = createCard({ id: 'gp', priority: 1 });
    const parent = createCard({ id: 'p', parentId: 'gp', priority: 2 });
    const child = createCard({ id: 'c', parentId: 'p', priority: 3 });
    const result = clusterByParent([grandparent, parent, child]);
    // Deepest first: child, then parent, then grandparent
    assert.deepStrictEqual(result.map(i => i.id), ['c', 'p', 'gp']);
  });

  test('handles parent not in the set (subtask only)', () => {
    const child = createCard({ id: 'child', parentId: 'missing-parent', priority: 1 });
    const other = createCard({ id: 'other', priority: 2 });
    const result = clusterByParent([child, other]);
    // parentId references missing issue — child treated as standalone
    assert.deepStrictEqual(result.map(i => i.id), ['child', 'other']);
  });

  test('handles empty array', () => {
    assert.deepStrictEqual(clusterByParent([]), []);
  });

  test('handles circular parent references without infinite loop', () => {
    const a = createCard({ id: 'a', parentId: 'b', priority: 1 });
    const b = createCard({ id: 'b', parentId: 'a', priority: 2 });
    const result = clusterByParent([a, b]);
    assert.strictEqual(result.length, 2);
    const ids = new Set(result.map(i => i.id));
    assert.ok(ids.has('a'));
    assert.ok(ids.has('b'));
  });

  test('handles multiple independent families', () => {
    const parentA = createCard({ id: 'pA', priority: 1 });
    const childA = createCard({ id: 'cA', parentId: 'pA', priority: 3 });
    const parentB = createCard({ id: 'pB', priority: 2 });
    const childB = createCard({ id: 'cB', parentId: 'pB', priority: 4 });
    const result = clusterByParent([parentA, parentB, childA, childB]);
    // Family A clusters at position 0 (parentA), Family B at position 1 (parentB)
    assert.deepStrictEqual(result.map(i => i.id), ['cA', 'pA', 'cB', 'pB']);
  });
});

// =============================================================================
// buildFilterGroups
// =============================================================================

describe('buildFilterGroups', () => {
  test('project count includes in-progress issues for that project', () => {
    const cards = [
      createCard({ id: 'ip1', stateType: 'started', projectName: 'Alpha', section: 'in-progress' }),
      createCard({ id: 'ip2', stateType: 'started', projectName: 'Alpha', section: 'in-progress' }),
      createCard({ id: 'p1', stateType: 'unstarted', projectName: 'Alpha', section: 'project' }),
      createCard({ id: 'p2', stateType: 'unstarted', projectName: 'Alpha', section: 'project' }),
    ];
    const groups = buildFilterGroups(cards);
    const alphaGroup = groups.find(g => g.key === 'project:Alpha');
    assert.ok(alphaGroup, 'project filter should appear');
    assert.strictEqual(alphaGroup.count, 4);
  });

  test('project filter appears when all project issues are in-progress', () => {
    const cards = [
      createCard({ id: 'ip1', stateType: 'started', projectName: 'Solo', section: 'in-progress' }),
    ];
    const groups = buildFilterGroups(cards);
    const soloGroup = groups.find(g => g.key === 'project:Solo');
    assert.ok(soloGroup, 'project filter should appear');
    assert.strictEqual(soloGroup.count, 1);
  });

  test('includes a label filter for every label in use', () => {
    const cards = [
      createCard({ id: 'a', labels: ['bug'] }),
      createCard({ id: 'b', labels: ['feature'] }),
      createCard({ id: 'c', labels: ['bug', 'urgent'] }),
    ];
    const groups = buildFilterGroups(cards);
    assert.ok(groups.find(g => g.key === 'label:bug'));
    assert.ok(groups.find(g => g.key === 'label:feature'));
    assert.ok(groups.find(g => g.key === 'label:urgent'));
  });

  test('label count equals number of issues carrying that label', () => {
    const cards = [
      createCard({ id: 'a', labels: ['bug'] }),
      createCard({ id: 'b', labels: ['bug'] }),
      createCard({ id: 'c', labels: ['feature'] }),
    ];
    const groups = buildFilterGroups(cards);
    assert.strictEqual(groups.find(g => g.key === 'label:bug').count, 2);
    assert.strictEqual(groups.find(g => g.key === 'label:feature').count, 1);
  });

  test('issue with multiple labels contributes to each group', () => {
    const cards = [
      createCard({ id: 'a', labels: ['bug', 'urgent'] }),
    ];
    const groups = buildFilterGroups(cards);
    assert.strictEqual(groups.find(g => g.key === 'label:bug').count, 1);
    assert.strictEqual(groups.find(g => g.key === 'label:urgent').count, 1);
  });

  test('does not include label entries when no issues carry labels', () => {
    const cards = [
      createCard({ id: 'a', labels: [] }),
      createCard({ id: 'b', labels: [] }),
    ];
    const groups = buildFilterGroups(cards);
    assert.ok(!groups.some(g => g.key.startsWith('label:')));
  });

  test('skips empty-string label names', () => {
    const cards = [
      createCard({ id: 'a', labels: ['', 'bug'] }),
    ];
    const groups = buildFilterGroups(cards);
    assert.ok(!groups.some(g => g.key === 'label:'));
    assert.ok(groups.find(g => g.key === 'label:bug'));
  });

  test('deduplicates a label that appears twice on the same issue', () => {
    const cards = [
      createCard({ id: 'a', labels: ['bug', 'bug'] }),
      createCard({ id: 'b', labels: ['bug'] }),
    ];
    const groups = buildFilterGroups(cards);
    assert.strictEqual(groups.find(g => g.key === 'label:bug').count, 2);
  });

  test('label entries appear after project entries, sorted by count desc then name asc', () => {
    const cards = [
      createCard({ id: 'a', projectName: 'Alpha', labels: ['feature'] }),
      createCard({ id: 'b', projectName: 'Alpha', labels: ['bug'] }),
      createCard({ id: 'c', projectName: 'Alpha', labels: ['bug'] }),
      createCard({ id: 'd', projectName: 'Alpha', labels: ['atlas'] }),
    ];
    const groups = buildFilterGroups(cards);
    const projectIdx = groups.findIndex(g => g.key.startsWith('project:'));
    const firstLabelIdx = groups.findIndex(g => g.key.startsWith('label:'));
    assert.ok(firstLabelIdx > projectIdx, 'label filters appear after project filters');

    const labelKeys = groups.filter(g => g.key.startsWith('label:')).map(g => g.key);
    // bug (2) first; then atlas, feature alphabetically (both 1)
    assert.deepStrictEqual(labelKeys, ['label:bug', 'label:atlas', 'label:feature']);
  });
});

// =============================================================================
// Project filter starting index
// =============================================================================

describe('project filter starting index', () => {
  test('skips in-progress issues at the front', () => {
    const cards = [
      createCard({ id: 'ip1', stateType: 'started', projectName: 'Alpha' }),
      createCard({ id: 'ip2', stateType: 'started', projectName: 'Alpha' }),
      createCard({ id: 'p1', stateType: 'unstarted', projectName: 'Alpha' }),
      createCard({ id: 'p2', stateType: 'backlog', projectName: 'Alpha' }),
    ];
    const firstNonStarted = cards.findIndex(i => i.stateType !== 'started');
    assert.strictEqual(firstNonStarted, 2);
  });

  test('falls back to 0 when all issues are in-progress', () => {
    const cards = [
      createCard({ id: 'ip1', stateType: 'started', projectName: 'Alpha' }),
      createCard({ id: 'ip2', stateType: 'started', projectName: 'Alpha' }),
    ];
    const firstNonStarted = cards.findIndex(i => i.stateType !== 'started');
    const startIndex = firstNonStarted !== -1 ? firstNonStarted : 0;
    assert.strictEqual(startIndex, 0);
  });

  test('starts at 0 when no in-progress issues', () => {
    const cards = [
      createCard({ id: 'p1', stateType: 'unstarted', projectName: 'Alpha' }),
      createCard({ id: 'p2', stateType: 'backlog', projectName: 'Alpha' }),
    ];
    const firstNonStarted = cards.findIndex(i => i.stateType !== 'started');
    assert.strictEqual(firstNonStarted, 0);
  });

  test('partitioning puts started before bugs for correct skip', () => {
    // The global sort puts bugs before started, but the project filter
    // partitions started to the front so the user can swipe back to them
    const sorted = [
      createCard({ id: 'bug', stateType: 'unstarted', labels: ['bug'] }),
      createCard({ id: 'ip1', stateType: 'started' }),
      createCard({ id: 'ip2', stateType: 'started' }),
      createCard({ id: 'todo', stateType: 'unstarted' }),
    ];
    const started = sorted.filter(i => i.stateType === 'started');
    const rest = sorted.filter(i => i.stateType !== 'started');
    const partitioned = [...started, ...rest];
    assert.deepStrictEqual(partitioned.map(i => i.id), ['ip1', 'ip2', 'bug', 'todo']);
    const firstNonStarted = partitioned.findIndex(i => i.stateType !== 'started');
    assert.strictEqual(firstNonStarted, 2);
  });
});

// =============================================================================
// blocksIds extraction (issueToCard via flattenTrees)
// =============================================================================

describe('blocksIds extraction', () => {
  // Build a single-project tree shaped like buildForest output, so flattenTrees
  // runs the real issueToCard mapping on the supplied raw issue.
  function treeFor(issue) {
    return [{ project: { name: 'P' }, incomplete: [{ issue, children: [] }] }];
  }

  test('collects relatedIssue ids from blocks relations', () => {
    const issue = {
      id: 'a',
      state: { type: 'unstarted', name: 'Todo' },
      relations: { nodes: [
        { type: 'blocks', relatedIssue: { id: 'b' } },
        { type: 'related', relatedIssue: { id: 'c' } },
        { type: 'blocks', relatedIssue: { id: 'd' } },
      ] },
    };
    const [card] = flattenTrees(treeFor(issue), 'project');
    assert.deepStrictEqual(card.blocksIds, ['b', 'd']);
  });

  test('drops blocks relations with a null relatedIssue (dangling/deleted)', () => {
    // A blocks relation pointing at a deleted or inaccessible issue arrives
    // with relatedIssue === null. This must not throw, and the dangling edge
    // must be filtered out.
    const issue = {
      id: 'a',
      state: { type: 'unstarted', name: 'Todo' },
      relations: { nodes: [
        { type: 'blocks', relatedIssue: null },
        { type: 'blocks', relatedIssue: { id: 'b' } },
      ] },
    };
    let card;
    assert.doesNotThrow(() => { [card] = flattenTrees(treeFor(issue), 'project'); });
    assert.deepStrictEqual(card.blocksIds, ['b']);
  });

  test('blocksIds is empty when there are no relations', () => {
    const issue = { id: 'a', state: { type: 'unstarted', name: 'Todo' } };
    const [card] = flattenTrees(treeFor(issue), 'project');
    assert.deepStrictEqual(card.blocksIds, []);
  });
});

// =============================================================================
// computeGraphFeatures (LIN-391)
// =============================================================================

describe('computeGraphFeatures', () => {
  test('chain A→B→C: downstreamUnblocks and criticalPathLen', () => {
    const a = createCard({ id: 'a', stateType: 'backlog', blocksIds: ['b'] });
    const b = createCard({ id: 'b', stateType: 'backlog', blocksIds: ['c'] });
    const c = createCard({ id: 'c', stateType: 'backlog' });
    computeGraphFeatures([a, b, c]);
    assert.deepStrictEqual(
      { a: a.downstreamUnblocks, b: b.downstreamUnblocks, c: c.downstreamUnblocks },
      { a: 2, b: 1, c: 0 }
    );
    assert.deepStrictEqual(
      { a: a.criticalPathLen, b: b.criticalPathLen, c: c.criticalPathLen },
      { a: 3, b: 2, c: 1 }
    );
  });

  test('diamond counts distinct successors, not path multiplicity', () => {
    // A blocks B and C; B and C both block D.
    const a = createCard({ id: 'a', stateType: 'backlog', blocksIds: ['b', 'c'] });
    const b = createCard({ id: 'b', stateType: 'backlog', blocksIds: ['d'] });
    const c = createCard({ id: 'c', stateType: 'backlog', blocksIds: ['d'] });
    const d = createCard({ id: 'd', stateType: 'backlog' });
    computeGraphFeatures([a, b, c, d]);
    // distinct successors of A = {b, c, d} = 3 (NOT 4 — d reached via two paths)
    assert.strictEqual(a.downstreamUnblocks, 3);
    assert.strictEqual(a.criticalPathLen, 3); // a→b→d (or a→c→d)
    assert.strictEqual(d.downstreamUnblocks, 0);
    assert.strictEqual(d.criticalPathLen, 1);
  });

  test('ignores edges from terminal-state blockers', () => {
    const done = createCard({ id: 'done', stateType: 'completed', blocksIds: ['x'] });
    const x = createCard({ id: 'x', stateType: 'unstarted' });
    computeGraphFeatures([done, x]);
    assert.strictEqual(done.downstreamUnblocks, 0);
    assert.strictEqual(done.criticalPathLen, 1);
  });

  test('ignores out-of-set edges', () => {
    const a = createCard({ id: 'a', stateType: 'backlog', blocksIds: ['not-in-set'] });
    const b = createCard({ id: 'b', stateType: 'backlog' });
    computeGraphFeatures([a, b]);
    assert.strictEqual(a.downstreamUnblocks, 0);
    assert.strictEqual(a.criticalPathLen, 1);
  });

  test('is cycle-safe (no throw, finite values)', () => {
    const a = createCard({ id: 'a', stateType: 'unstarted', blocksIds: ['b'] });
    const b = createCard({ id: 'b', stateType: 'unstarted', blocksIds: ['a'] });
    assert.doesNotThrow(() => computeGraphFeatures([a, b]));
    assert.ok(Number.isFinite(a.criticalPathLen));
    assert.ok(Number.isFinite(b.criticalPathLen));
    assert.ok(Number.isFinite(a.downstreamUnblocks));
  });
});

// =============================================================================
// Full pipeline invariants with features (LIN-391)
// =============================================================================

describe('pipeline invariants hold after computeGraphFeatures', () => {
  test('terminal last, bugs first, blockers before blocked, subtasks before parent', () => {
    const cards = [
      createCard({ id: 'done', stateType: 'completed' }),
      createCard({ id: 'bug', stateType: 'unstarted', labels: ['bug'] }),
      createCard({ id: 'parent', stateType: 'unstarted' }),
      createCard({ id: 'child', stateType: 'unstarted', parentId: 'parent' }),
      createCard({ id: 'blocker', stateType: 'unstarted', priority: 4, blocksIds: ['blocked'] }),
      createCard({ id: 'blocked', stateType: 'unstarted', priority: 1 }),
    ];
    computeGraphFeatures(cards);
    sortIssuesForSwipe(cards);
    const result = clusterByParent(applyBlockingOrder(cards));
    const ids = result.map(i => i.id);
    const pos = id => ids.indexOf(id);

    // terminal last
    assert.strictEqual(ids[ids.length - 1], 'done');
    // blocker before blocked
    assert.ok(pos('blocker') < pos('blocked'), 'blocker before blocked');
    // subtask before parent
    assert.ok(pos('child') < pos('parent'), 'subtask before parent');
    // bug ahead of plain non-bug peers (parent/blocked which aren't bugs)
    assert.ok(pos('bug') < pos('parent'), 'bug ahead of non-bug');
  });
});

// =============================================================================
// computeOffPageBlockers (LIN-391)
// =============================================================================

describe('computeOffPageBlockers', () => {
  test('flags a visible line held by a blocker pushed off-page by clustering', () => {
    // child is blocked by an off-page blocker, but clusters up with its parent
    // to the front. With limit=2, the blocker lands beyond the slice.
    const child = createCard({ id: 'child', identifier: 'LIN-child', parentId: 'parent', stateType: 'unstarted', priority: 1 });
    const parent = createCard({ id: 'parent', identifier: 'LIN-parent', stateType: 'unstarted', priority: 1 });
    const blocker = createCard({ id: 'blocker', identifier: 'LIN-blocker', stateType: 'unstarted', priority: 4, blocksIds: ['child'] });
    // Final order: clusterByParent pulls [child, parent] to the front; blocker trails.
    const sorted = clusterByParent([child, parent, blocker]);
    assert.deepStrictEqual(sorted.map(i => i.id), ['child', 'parent', 'blocker']);

    const heldBy = computeOffPageBlockers(sorted, 2); // blocker at index 2 is off-page
    assert.deepStrictEqual(heldBy.get('child'), ['LIN-blocker']);
  });

  test('empty when all blockers are on-page', () => {
    const blocker = createCard({ id: 'blocker', identifier: 'LIN-1', stateType: 'unstarted', blocksIds: ['blocked'] });
    const blocked = createCard({ id: 'blocked', identifier: 'LIN-2', stateType: 'unstarted' });
    const sorted = [blocker, blocked];
    const heldBy = computeOffPageBlockers(sorted, 5);
    assert.strictEqual(heldBy.size, 0);
  });
});

// =============================================================================
// buildWhy (LIN-391)
// =============================================================================

describe('buildWhy', () => {
  test('composes reasons in stable order', () => {
    const issue = createCard({ labels: ['bug'], downstreamUnblocks: 6, criticalPathLen: 4 });
    assert.deepStrictEqual(buildWhy(issue, ['LIN-412']), ['bug', 'unblocks 6', 'critical path 4', 'held by LIN-412']);
  });

  test('omits zero/absent features', () => {
    const issue = createCard({ labels: ['feature'], downstreamUnblocks: 0, criticalPathLen: 1 });
    assert.deepStrictEqual(buildWhy(issue), []);
  });

  test('collapses multiple held-by blockers with a +N suffix', () => {
    const issue = createCard({ labels: [], downstreamUnblocks: 2, criticalPathLen: 1 });
    assert.deepStrictEqual(buildWhy(issue, ['LIN-1', 'LIN-2', 'LIN-3']), ['unblocks 2', 'held by LIN-1 +2']);
  });

  // LIN-1253: the "bug" reason is gated on the same boostable predicate as the
  // sort, so the digest never claims a boost the bug did not actually earn.
  test('omits "bug" for a backlog bug that no longer earns the boost', () => {
    const issue = createCard({ labels: ['bug'], stateType: 'backlog', priority: 1 });
    assert.deepStrictEqual(buildWhy(issue), []);
  });

  test('omits "bug" for a low/none-priority bug that no longer earns the boost', () => {
    const low = createCard({ labels: ['bug'], stateType: 'unstarted', priority: 4 });
    const none = createCard({ labels: ['bug'], stateType: 'unstarted', priority: 0 });
    assert.deepStrictEqual(buildWhy(low), []);
    assert.deepStrictEqual(buildWhy(none), []);
  });

  test('keeps "bug" for a normal non-backlog bug', () => {
    const issue = createCard({ labels: ['bug'], stateType: 'started', priority: 2 });
    assert.deepStrictEqual(buildWhy(issue), ['bug']);
  });
});

// =============================================================================
// isBoostableBug (LIN-1253)
// =============================================================================

describe('isBoostableBug', () => {
  test('true for a non-backlog Urgent/High/Medium bug', () => {
    for (const priority of [1, 2, 3]) {
      assert.strictEqual(isBoostableBug(createCard({ labels: ['bug'], stateType: 'started', priority })), true);
    }
  });

  test('false when the bug is in the backlog state (even at Urgent priority)', () => {
    assert.strictEqual(isBoostableBug(createCard({ labels: ['bug'], stateType: 'backlog', priority: 1 })), false);
  });

  test('false for Low(4) or None(0) priority bugs', () => {
    assert.strictEqual(isBoostableBug(createCard({ labels: ['bug'], stateType: 'unstarted', priority: 4 })), false);
    assert.strictEqual(isBoostableBug(createCard({ labels: ['bug'], stateType: 'unstarted', priority: 0 })), false);
  });

  test('false when there is no bug label', () => {
    assert.strictEqual(isBoostableBug(createCard({ labels: ['feature'], stateType: 'started', priority: 1 })), false);
  });

  test('is case-insensitive on the bug label and tolerates missing labels', () => {
    assert.strictEqual(isBoostableBug(createCard({ labels: ['Bug'], stateType: 'started', priority: 2 })), true);
    assert.strictEqual(isBoostableBug({ stateType: 'started', priority: 2 }), false);
  });
});
