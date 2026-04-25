/**
 * Unit tests for swipe view sorting and blocking order.
 *
 * Run with: node --test tests/unit/swipe-sort.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { sortIssuesForSwipe, applyBlockingOrder, clusterByParent, buildFilterGroups } from '../../lib/render-swipe.js';

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
  test('puts completed/canceled issues last', () => {
    const cards = [
      createCard({ id: 'done', stateType: 'completed' }),
      createCard({ id: 'todo', stateType: 'unstarted' }),
      createCard({ id: 'canceled', stateType: 'canceled' }),
    ];
    sortIssuesForSwipe(cards);
    assert.strictEqual(cards[0].id, 'todo');
    assert.ok(['done', 'canceled'].includes(cards[1].id));
    assert.ok(['done', 'canceled'].includes(cards[2].id));
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
