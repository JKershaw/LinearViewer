/**
 * LIN-4049 (LIN-4040 S1): one subtree index for the fetched set.
 *
 * `buildSubtreeIndex` builds a `{issue, children}` node per issue from the fetched set's parent links, with roots for
 * the issues whose parent is outside the set. Every surface that states a task's state reads this one tree, so a
 * parent's row cannot see a different subtree from the one the page reads.
 *
 * Witnesses: deep descendants reach every level; a parent outside the set makes its child a root; children are in the
 * natural identifier order `parentNextOf` uses; an invalid identifier is dropped and its children become roots; every
 * valid issue of the set appears exactly once; parent links are source-qualified, so a colliding raw id in another
 * source never attaches a child to the wrong parent (LIN-544).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubtreeIndex } from '../../lib/subtree-index.js';
import { createHomeRowStates } from '../../lib/home-row-states.js';

// A fetched issue. `parentId` is the parent's raw id (the tracker's parent link); `source` qualifies the id (LIN-544).
const issue = (identifier, { id = `id-${identifier}`, parentId = null, source = undefined, type = 'unstarted' } = {}) => ({
  id, identifier, title: identifier, state: { name: type, type },
  ...(parentId ? { parent: { id: parentId, identifier: null } } : {}),
  ...(source ? { source } : {}),
});

// Walk the index, returning every identifier it reaches, depth-first.
const reached = (roots) => {
  const out = [];
  const walk = (node) => {
    out.push(node.issue.identifier);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
};

const find = (roots, identifier) => {
  const walk = (node) => (node.issue.identifier === identifier ? node : node.children.map(walk).find(Boolean) || null);
  return roots.map(walk).find(Boolean) || null;
};

describe('LIN-4049 — the index reaches every descendant, at any depth', () => {
  test('a four-level chain is nested all the way down, with each level\'s children on its own node', () => {
    const issues = [
      issue('LIN-1'),
      issue('LIN-2', { parentId: 'id-LIN-1' }),
      issue('LIN-3', { parentId: 'id-LIN-2' }),
      issue('LIN-4', { parentId: 'id-LIN-3' }),
    ];
    const roots = buildSubtreeIndex(issues);
    assert.deepEqual(roots.map(r => r.issue.identifier), ['LIN-1']);
    assert.deepEqual(find(roots, 'LIN-1').children.map(c => c.issue.identifier), ['LIN-2']);
    assert.deepEqual(find(roots, 'LIN-2').children.map(c => c.issue.identifier), ['LIN-3']);
    assert.deepEqual(find(roots, 'LIN-3').children.map(c => c.issue.identifier), ['LIN-4']);
    assert.deepEqual(find(roots, 'LIN-4').children, []);
  });

  test('a started grandchild is reached even though no intermediate node is started', () => {
    const issues = [
      issue('LIN-10', { type: 'backlog' }),
      issue('LIN-11', { parentId: 'id-LIN-10', type: 'unstarted' }),
      issue('LIN-12', { parentId: 'id-LIN-11', type: 'started' }),
    ];
    const roots = buildSubtreeIndex(issues);
    assert.ok(find(roots, 'LIN-12'), 'the grandchild is in the subtree of its root');
    assert.equal(find(roots, 'LIN-12').issue.state.type, 'started');
  });
});

describe('LIN-4049 — a parent outside the fetched set makes its child a root', () => {
  test('a child whose parent is not in the set is a root of its own subtree', () => {
    const issues = [
      issue('LIN-20', { parentId: 'id-LIN-99' }),
      issue('LIN-21', { parentId: 'id-LIN-20' }),
    ];
    const roots = buildSubtreeIndex(issues);
    assert.deepEqual(roots.map(r => r.issue.identifier), ['LIN-20']);
    assert.deepEqual(find(roots, 'LIN-20').children.map(c => c.issue.identifier), ['LIN-21']);
  });

  test('an issue with no parent link is a root', () => {
    const roots = buildSubtreeIndex([issue('LIN-30'), issue('LIN-31')]);
    assert.deepEqual(roots.map(r => r.issue.identifier), ['LIN-30', 'LIN-31']);
  });
});

describe('LIN-4049 — children are in the natural identifier order parentNextOf uses', () => {
  test('numeric identifier order, not fetch order or state order', () => {
    const issues = [
      issue('LIN-1'),
      issue('LIN-10', { parentId: 'id-LIN-1', type: 'started' }),
      issue('LIN-9', { parentId: 'id-LIN-1', type: 'unstarted' }),
      issue('LIN-2', { parentId: 'id-LIN-1', type: 'backlog' }),
    ];
    const roots = buildSubtreeIndex(issues);
    assert.deepEqual(find(roots, 'LIN-1').children.map(c => c.issue.identifier), ['LIN-2', 'LIN-9', 'LIN-10']);
  });

  test('the order holds at every level, not only under the root', () => {
    const issues = [
      issue('LIN-1'),
      issue('LIN-5', { parentId: 'id-LIN-1' }),
      issue('LIN-7', { parentId: 'id-LIN-5' }),
      issue('LIN-6', { parentId: 'id-LIN-5' }),
    ];
    const roots = buildSubtreeIndex(issues);
    assert.deepEqual(find(roots, 'LIN-5').children.map(c => c.issue.identifier), ['LIN-6', 'LIN-7']);
  });
});

describe('LIN-4049 — identifiers are validated with isValidIssueId', () => {
  test('an issue with an invalid identifier is dropped, and its valid child becomes a root', () => {
    const issues = [
      issue('not an id!', { id: 'bad-1' }),
      issue('LIN-40', { parentId: 'bad-1' }),
    ];
    const roots = buildSubtreeIndex(issues);
    assert.deepEqual(reached(roots), ['LIN-40']);
    assert.deepEqual(roots.map(r => r.issue.identifier), ['LIN-40']);
  });

  test('a missing identifier is dropped rather than indexed under undefined', () => {
    const roots = buildSubtreeIndex([{ id: 'x', state: { type: 'started' } }, issue('LIN-41')]);
    assert.deepEqual(reached(roots), ['LIN-41']);
  });
});

describe('LIN-4049 — the index covers every valid issue of the fetched set exactly once', () => {
  test('a mixed set reaches each valid issue once and nothing else', () => {
    const issues = [
      issue('LIN-50'),
      issue('LIN-51', { parentId: 'id-LIN-50' }),
      issue('LIN-52', { parentId: 'id-LIN-51' }),
      issue('LIN-53', { parentId: 'id-LIN-50' }),
      issue('LIN-54', { parentId: 'id-GONE' }),
      issue('LIN-55'),
    ];
    const roots = buildSubtreeIndex(issues);
    const got = reached(roots).sort();
    assert.deepEqual(got, issues.map(i => i.identifier).sort());
  });

  test('an empty fetched set indexes to no roots', () => {
    assert.deepEqual(buildSubtreeIndex([]), []);
  });
});

describe('LIN-4049 — parent links are source-qualified (LIN-544)', () => {
  test('a child attaches to the parent of its own source when another source uses the same raw id', () => {
    const issues = [
      issue('LIN-60', { id: '42', source: 'linear' }),
      issue('GH-42', { id: '42', source: 'github' }),
      issue('GH-43', { id: '43', parentId: '42', source: 'github' }),
    ];
    const roots = buildSubtreeIndex(issues);
    const gh42 = find(roots, 'GH-42');
    assert.ok(gh42, 'the github parent is a root');
    assert.deepEqual(gh42.children.map(c => c.issue.identifier), ['GH-43']);
    assert.deepEqual(find(roots, 'LIN-60').children, []);
  });
});

describe('LIN-4049 — Home\'s row states are read from the index', () => {
  test('a parent whose child is in the index but in no forest is a container, with a state, from the index alone', async () => {
    const parent = issue('LIN-70', { type: 'started' });
    const child = issue('LIN-71', { parentId: 'id-LIN-70', type: 'unstarted' });
    const homeRowStates = createHomeRowStates({
      getLoopsForWorkspace: async () => [], dispatchStore: null, agentStatusStore: null, taskDecisionsStore: null,
      shelvedRulingsStore: null, enrichLoop: (loop) => loop, deriveSessionWaiting: () => ({ waiting: false, message: null }),
      now: () => new Date('2026-10-30T20:00:00Z'), onError: (message) => assert.fail(message),
    });
    const result = await homeRowStates({
      urlKey: 'ws', subtrees: buildSubtreeIndex([parent, child]), inProgressTrees: [], recentActivityTrees: [], projectTrees: [], runControls: false,
    });
    assert.equal(result.states.get('LIN-70').container, true);
    assert.ok(result.states.has('LIN-71'), 'the child has its own state');
  });
});
