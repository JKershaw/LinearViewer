/**
 * Unit tests for lib/context-graph.js — the relationship-neighborhood builder
 * behind the Context section (LIN-572).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildContextGraph } from '../../lib/context-graph.js';

/** Build a canonical issue in the shape fetchProjects emits. */
function issue(id, opts = {}) {
  return {
    id,
    identifier: opts.identifier || id.toUpperCase(),
    title: opts.title ?? `Title ${id}`,
    url: opts.url ?? `https://linear.app/x/issue/${id}`,
    state: opts.state || { name: 'Todo', type: 'unstarted' },
    parent: opts.parentId ? { id: opts.parentId } : null,
    relations: { nodes: opts.relations || [] },
    inverseRelations: { nodes: opts.inverseRelations || [] },
  };
}

const blocks = (relatedId) => ({ type: 'blocks', relatedIssue: { id: relatedId } });
const related = (relatedId) => ({ type: 'related', relatedIssue: { id: relatedId } });
const duplicate = (relatedId) => ({ type: 'duplicate', relatedIssue: { id: relatedId } });

describe('buildContextGraph', () => {
  test('returns null when the root is absent from the set', () => {
    assert.strictEqual(buildContextGraph([issue('a')], 'missing'), null);
  });

  test('forward blocks edges become the root\'s blocked-by chain (reversed)', () => {
    // a blocks b, b blocks c. Root c is blocked by b (depth 1) and a (depth 2).
    const issues = [
      issue('a', { relations: [blocks('b')] }),
      issue('b', { relations: [blocks('c')] }),
      issue('c'),
    ];
    const g = buildContextGraph(issues, 'c');
    assert.strictEqual(g.root.identifier, 'C');
    assert.deepStrictEqual(g.blockers.map(n => n.id), ['b', 'a']);
    assert.strictEqual(g.blockers.find(n => n.id === 'b').depth, 1);
    assert.strictEqual(g.blockers.find(n => n.id === 'a').depth, 2);
    assert.strictEqual(g.blocked.length, 0);
  });

  test('downstream blocked chain is transitive', () => {
    // a blocks b, b blocks c. Root a blocks b (1) and c (2).
    const issues = [
      issue('a', { relations: [blocks('b')] }),
      issue('b', { relations: [blocks('c')] }),
      issue('c'),
    ];
    const g = buildContextGraph(issues, 'a');
    assert.deepStrictEqual(g.blocked.map(n => n.id).sort(), ['b', 'c']);
    assert.strictEqual(g.blockers.length, 0);
    assert.strictEqual(g.root.isBlocked, false);
  });

  test('inverseRelations are honored equivalently to forward relations', () => {
    // Edge stored on the blocked side: b records "a blocks me".
    const issues = [
      issue('a'),
      issue('b', { inverseRelations: [{ type: 'blocks', issue: { id: 'a' } }] }),
    ];
    const g = buildContextGraph(issues, 'b');
    assert.deepStrictEqual(g.blockers.map(n => n.id), ['a']);
  });

  test('marks the actionable root-cause blocker as "start here"', () => {
    // a (todo) blocks b (todo) blocks c. a has no open blocker → start here.
    const issues = [
      issue('a', { relations: [blocks('b')] }),
      issue('b', { relations: [blocks('c')] }),
      issue('c'),
    ];
    const g = buildContextGraph(issues, 'c');
    assert.strictEqual(g.blockers.find(n => n.id === 'a').isStart, true);
    assert.strictEqual(g.blockers.find(n => n.id === 'b').isStart, false);
    assert.strictEqual(g.root.isBlocked, true);
  });

  test('a resolved (terminal) blocker does not keep the root blocked', () => {
    const issues = [
      issue('a', { state: { name: 'Done', type: 'completed' }, relations: [blocks('c')] }),
      issue('c'),
    ];
    const g = buildContextGraph(issues, 'c');
    // The done blocker is still shown (full picture)…
    assert.deepStrictEqual(g.blockers.map(n => n.id), ['a']);
    // …but it is terminal, so the root counts as unblocked / ready.
    assert.strictEqual(g.root.isBlocked, false);
    assert.strictEqual(g.blockers[0].isStart, false);
  });

  test('parent chain (nearest-first) and children are resolved', () => {
    const issues = [
      issue('gp'),
      issue('p', { parentId: 'gp' }),
      issue('root', { parentId: 'p' }),
      issue('c1', { parentId: 'root' }),
      issue('c2', { parentId: 'root' }),
    ];
    const g = buildContextGraph(issues, 'root');
    assert.deepStrictEqual(g.parentChain.map(n => n.id), ['p', 'gp']);
    assert.strictEqual(g.parent.id, 'p');
    assert.deepStrictEqual(g.children.map(n => n.id).sort(), ['c1', 'c2']);
  });

  test('related and duplicate links are surfaced one hop, both directions', () => {
    const issues = [
      issue('root', { relations: [related('r1'), duplicate('d1')] }),
      issue('r1'),
      issue('d1'),
      // Edge stored on the other side still attaches to root.
      issue('r2', { relations: [related('root')] }),
    ];
    const g = buildContextGraph(issues, 'root');
    const byId = Object.fromEntries(g.related.map(n => [n.id, n.relType]));
    assert.strictEqual(byId.r1, 'related');
    assert.strictEqual(byId.r2, 'related');
    assert.strictEqual(byId.d1, 'duplicate');
  });

  test('is cycle-safe (a blocks b, b blocks a)', () => {
    const issues = [
      issue('a', { relations: [blocks('b')] }),
      issue('b', { relations: [blocks('a')] }),
    ];
    const g = buildContextGraph(issues, 'a');
    // Both directions reach b exactly once; no infinite loop.
    assert.deepStrictEqual(g.blocked.map(n => n.id), ['b']);
    assert.deepStrictEqual(g.blockers.map(n => n.id), ['b']);
  });

  test('caps each direction and reports truncation', () => {
    const issues = [issue('root')];
    for (let i = 0; i < 30; i++) {
      issues.push(issue(`b${i}`, { relations: [blocks('root')] }));
    }
    const g = buildContextGraph(issues, 'root', { maxPerDirection: 5 });
    assert.strictEqual(g.blockers.length, 5);
    assert.strictEqual(g.blockersTruncated, 25);
  });

  test('ignores edges pointing outside the loaded set', () => {
    const issues = [issue('root', { relations: [blocks('ghost')] })];
    const g = buildContextGraph(issues, 'root');
    assert.strictEqual(g.blocked.length, 0);
  });

  test('empty neighborhood yields empty arrays, not errors', () => {
    const g = buildContextGraph([issue('lonely')], 'lonely');
    assert.deepStrictEqual(g.blockers, []);
    assert.deepStrictEqual(g.blocked, []);
    assert.deepStrictEqual(g.children, []);
    assert.deepStrictEqual(g.related, []);
    assert.deepStrictEqual(g.parentChain, []);
  });
});
