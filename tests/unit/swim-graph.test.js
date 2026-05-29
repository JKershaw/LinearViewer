/**
 * Unit tests for the swim flow graph model.
 *
 * Run with: node --test tests/unit/swim-graph.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildGraph, pathCover } from '../../lib/swim-graph.js';

let counter = 0;
function card(overrides = {}) {
  counter++;
  return {
    id: overrides.id || `id-${counter}`,
    identifier: overrides.identifier || `T-${counter}`,
    title: overrides.title || `Card ${counter}`,
    stateType: 'unstarted',
    blocksIds: [],
    parentId: null,
    ...overrides
  };
}

describe('buildGraph', () => {
  test('filters terminal-state issues unless showCompleted', () => {
    const issues = [card({ id: 'a' }), card({ id: 'b', stateType: 'completed' })];
    assert.equal(buildGraph(issues).nodes.length, 1);
    assert.equal(buildGraph(issues, { showCompleted: true }).nodes.length, 2);
  });

  test('builds childrenOf, depth and roots from parentId', () => {
    const issues = [
      card({ id: 'p' }),
      card({ id: 'c1', parentId: 'p' }),
      card({ id: 'c2', parentId: 'p' }),
      card({ id: 'g', parentId: 'c1' })
    ];
    const g = buildGraph(issues);
    assert.deepEqual(g.childrenOf.get('p').sort(), ['c1', 'c2']);
    assert.deepEqual(g.childrenOf.get('c1'), ['g']);
    assert.equal(g.depth.get('p'), 0);
    assert.equal(g.depth.get('c1'), 1);
    assert.equal(g.depth.get('g'), 2);
    assert.deepEqual(g.roots.map(r => r.id), ['p']);
  });

  test('builds blocks edges and reverse blockedBy', () => {
    const issues = [
      card({ id: 'a', blocksIds: ['b'] }),
      card({ id: 'b', blocksIds: ['c'] }),
      card({ id: 'c' })
    ];
    const g = buildGraph(issues);
    assert.equal(g.blocks.length, 2);
    assert.deepEqual(g.blockedBy.get('b'), ['a']);
    assert.deepEqual(g.blockedBy.get('c'), ['b']);
  });

  test('drops edges pointing to filtered-out nodes', () => {
    const issues = [
      card({ id: 'a', blocksIds: ['done'] }),
      card({ id: 'done', stateType: 'completed' })
    ];
    const g = buildGraph(issues);
    assert.equal(g.blocks.length, 0);
  });

  test('longest-path rank: blockers rank before blocked', () => {
    const issues = [
      card({ id: 'a', blocksIds: ['b'] }),
      card({ id: 'b', blocksIds: ['c'] }),
      card({ id: 'c' })
    ];
    const g = buildGraph(issues);
    assert.equal(g.rank.get('a'), 0);
    assert.equal(g.rank.get('b'), 1);
    assert.equal(g.rank.get('c'), 2);
  });

  test('fan-in takes the longest path (rank = max predecessor + 1)', () => {
    // a→c, and a→b→c : c should be rank 2, not 1
    const issues = [
      card({ id: 'a', blocksIds: ['b', 'c'] }),
      card({ id: 'b', blocksIds: ['c'] }),
      card({ id: 'c' })
    ];
    const g = buildGraph(issues);
    assert.equal(g.rank.get('c'), 2);
  });

  test('separates connected components', () => {
    const issues = [
      card({ id: 'a', blocksIds: ['b'] }), card({ id: 'b' }),
      card({ id: 'x', blocksIds: ['y'] }), card({ id: 'y' }),
      card({ id: 'solo' })
    ];
    const g = buildGraph(issues);
    assert.equal(g.components.length, 3);
  });

  test('does not throw on a blocking cycle', () => {
    const issues = [
      card({ id: 'a', blocksIds: ['b'] }),
      card({ id: 'b', blocksIds: ['a'] })
    ];
    const g = buildGraph(issues);
    assert.ok(g.rank.has('a') && g.rank.has('b'));
  });
});

describe('pathCover', () => {
  test('merges a linear chain into one spine', () => {
    const issues = [
      card({ id: 'a', blocksIds: ['b'] }),
      card({ id: 'b', blocksIds: ['c'] }),
      card({ id: 'c' })
    ];
    const { spines, branches } = pathCover(buildGraph(issues));
    assert.equal(spines.length, 1);
    assert.deepEqual(spines[0], ['a', 'b', 'c']);
    assert.equal(branches.length, 0);
  });

  test('fan-out keeps one edge on the spine, the rest become branches', () => {
    const issues = [
      card({ id: 'a', blocksIds: ['b', 'c'] }),
      card({ id: 'b' }), card({ id: 'c' })
    ];
    const { spines, branches } = pathCover(buildGraph(issues));
    // one of a→b / a→c continues the spine; the other is a branch
    assert.equal(spines.length, 1);
    assert.equal(spines[0].length, 2);
    assert.equal(branches.length, 1);
  });

  test('fan-in: second incoming edge becomes a branch', () => {
    const issues = [
      card({ id: 'a', blocksIds: ['c'] }),
      card({ id: 'b', blocksIds: ['c'] }),
      card({ id: 'c' })
    ];
    const { spines, branches } = pathCover(buildGraph(issues));
    // c can only continue one of a / b; the other edge branches in
    assert.equal(branches.length, 1);
  });

  test('no blocking edges → no spines', () => {
    const { spines, branches } = pathCover(buildGraph([card({ id: 'a' }), card({ id: 'b' })]));
    assert.equal(spines.length, 0);
    assert.equal(branches.length, 0);
  });
});
