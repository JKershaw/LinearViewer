/**
 * Unit tests for the session context graph (LIN-593) — the multi-root
 * composition over lib/context-graph.js's single-root primitive, plus the
 * provenance tagging (seed / descended / spun-off) and the deriveIssueGraph
 * helper that repairs session inference.
 *
 * Run with: node --test tests/unit/session-context-graph.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildSessionContextGraph, buildContextGraph } from '../../lib/context-graph.js';
import { deriveIssueGraph } from '../../lib/pipeline-loops.js';

const WINDOW_START = '2026-06-01T00:00:00.000Z';
const WINDOW_END = '2026-06-01T06:00:00.000Z';
const BEFORE = '2026-05-01T00:00:00.000Z'; // pre-existing (before the run)
const DURING = '2026-06-01T03:00:00.000Z'; // created mid-run
const AFTER = '2026-07-01T00:00:00.000Z';  // created after the run

/** Canonical issue in the shape fetchProjects emits. */
function issue(id, opts = {}) {
  return {
    id,
    identifier: opts.identifier || id.toUpperCase(),
    title: opts.title ?? `Title ${id}`,
    url: opts.url ?? `https://linear.app/x/issue/${id}`,
    state: opts.state || { name: 'Todo', type: 'unstarted' },
    parent: opts.parentId ? { id: opts.parentId } : null,
    createdAt: opts.createdAt ?? BEFORE,
    relations: { nodes: opts.relations || [] },
    inverseRelations: { nodes: opts.inverseRelations || [] },
  };
}
const blocks = (relatedId) => ({ type: 'blocks', relatedIssue: { id: relatedId } });
const related = (relatedId) => ({ type: 'related', relatedIssue: { id: relatedId } });

function tag(graph, id) {
  return graph.tasks.find(t => t.root.id === id)?.provenance;
}

describe('buildSessionContextGraph — provenance', () => {
  // The headline case from the ticket: an epic-seeded run that BOTH descends into
  // a pre-existing child AND spins off a new child via breakdown mid-run.
  test('tags seed / descended / spun-off for the breakdown spin-off case', () => {
    const issues = [
      issue('epic', { createdAt: BEFORE }),                                   // ancestor of seed
      issue('seed', { parentId: 'epic', createdAt: BEFORE }),                 // the seed
      issue('child-old', { parentId: 'seed', createdAt: BEFORE }),            // pre-existing descendant
      issue('child-new', { parentId: 'seed', createdAt: DURING }),           // breakdown spawn (in window)
    ];
    const graph = buildSessionContextGraph(
      issues,
      ['SEED', 'CHILD-OLD', 'CHILD-NEW', 'EPIC'],
      { seedIssue: 'SEED', window: { start: WINDOW_START, end: WINDOW_END } }
    );

    assert.equal(tag(graph, 'seed'), 'seed');
    assert.equal(tag(graph, 'child-old'), 'descended', 'pre-existing in-subtree child is descended');
    assert.equal(tag(graph, 'child-new'), 'spun-off', 'in-window child (breakdown spawn) is spun-off');
    assert.equal(tag(graph, 'epic'), 'descended', 'a touched ancestor (epic) is in-hierarchy → descended');
  });

  test('in-window creation wins over hierarchy (a breakdown child is spun-off, not descended)', () => {
    // child-new is BOTH a seed child (hierarchy) and created in-window. createdAt
    // is the disambiguator — it must read spun-off.
    const issues = [
      issue('seed', { createdAt: BEFORE }),
      issue('child-new', { parentId: 'seed', createdAt: DURING }),
    ];
    const graph = buildSessionContextGraph(issues, ['SEED', 'CHILD-NEW'],
      { seedIssue: 'SEED', window: { start: WINDOW_START, end: WINDOW_END } });
    assert.equal(tag(graph, 'child-new'), 'spun-off');
  });

  test('a non-hierarchical, pre-existing touch falls back to spun-off', () => {
    // related-only sibling, created before the window, not in the seed subtree.
    const issues = [
      issue('seed', { createdAt: BEFORE, relations: [related('sibling')] }),
      issue('sibling', { createdAt: BEFORE }),
    ];
    const graph = buildSessionContextGraph(issues, ['SEED', 'SIBLING'],
      { seedIssue: 'SEED', window: { start: WINDOW_START, end: WINDOW_END } });
    assert.equal(tag(graph, 'sibling'), 'spun-off');
  });

  test('an open window (null end, still in flight) treats anything after start as spun-off', () => {
    const issues = [
      issue('seed', { createdAt: BEFORE }),
      issue('mid', { parentId: 'seed', createdAt: DURING }),
      issue('post', { parentId: 'seed', createdAt: AFTER }),
    ];
    const graph = buildSessionContextGraph(issues, ['SEED', 'MID', 'POST'],
      { seedIssue: 'SEED', window: { start: WINDOW_START, end: null } });
    assert.equal(tag(graph, 'mid'), 'spun-off');
    assert.equal(tag(graph, 'post'), 'spun-off', 'open window has no upper bound');
  });
});

describe('buildSessionContextGraph — structure & determinism', () => {
  test('reuses buildContextGraph per task: neighborhood matches the single-root output', () => {
    const issues = [
      issue('a', { relations: [blocks('seed')] }),
      issue('seed', { parentId: 'epic' }),
      issue('epic'),
      issue('down', { parentId: 'seed' }),
    ];
    const graph = buildSessionContextGraph(issues, ['SEED'], { seedIssue: 'SEED', window: {} });
    const task = graph.tasks[0];
    const single = buildContextGraph(issues, 'seed');
    // Same neighborhood, plus a provenance tag — single-root path is untouched.
    assert.deepStrictEqual(task.blockers.map(n => n.id), single.blockers.map(n => n.id));
    assert.deepStrictEqual(task.children.map(n => n.id), single.children.map(n => n.id));
    assert.deepStrictEqual(task.parentChain.map(n => n.id), single.parentChain.map(n => n.id));
    assert.equal(task.provenance, 'seed');
  });

  test('preserves touched order (seed-first), de-dupes, and reports missing ids', () => {
    const issues = [issue('seed'), issue('b')];
    const graph = buildSessionContextGraph(issues, ['SEED', 'B', 'SEED', 'GHOST'],
      { seedIssue: 'SEED', window: {} });
    assert.deepStrictEqual(graph.tasks.map(t => t.root.identifier), ['SEED', 'B']);
    assert.deepStrictEqual(graph.touchedIdentifiers, ['SEED', 'B']);
    assert.deepStrictEqual(graph.missing, ['GHOST']);
  });

  test('accepts both UUID-style ids and human identifiers for seed/touched', () => {
    const issues = [issue('uuid-seed', { identifier: 'LIN-1' }), issue('uuid-b', { identifier: 'LIN-2' })];
    const byId = buildSessionContextGraph(issues, ['uuid-seed', 'uuid-b'], { seedIssue: 'uuid-seed', window: {} });
    const byIdent = buildSessionContextGraph(issues, ['LIN-1', 'lin-2'], { seedIssue: 'LIN-1', window: {} });
    assert.deepStrictEqual(byId.tasks.map(t => t.provenance), byIdent.tasks.map(t => t.provenance));
    assert.equal(byIdent.tasks[0].provenance, 'seed');
    assert.equal(byIdent.seedIssue, 'LIN-1');
  });

  test('is deterministic: identical inputs produce a deep-equal graph', () => {
    const issues = [
      issue('seed', { createdAt: BEFORE }),
      issue('c1', { parentId: 'seed', createdAt: DURING }),
      issue('c2', { parentId: 'seed', createdAt: BEFORE }),
    ];
    const args = [issues, ['SEED', 'C1', 'C2'], { seedIssue: 'SEED', window: { start: WINDOW_START, end: WINDOW_END } }];
    assert.deepStrictEqual(buildSessionContextGraph(...args), buildSessionContextGraph(...args));
  });

  test('empty / no-seed inputs degrade gracefully', () => {
    assert.deepStrictEqual(buildSessionContextGraph([], [], {}).tasks, []);
    const g = buildSessionContextGraph([issue('x')], ['X'], { window: {} });
    assert.equal(g.tasks[0].provenance, 'spun-off', 'no seed, pre-existing, no window → fallback');
    assert.equal(g.seedIssue, null);
  });

  test('normalizes the window to ISO and echoes touched identifiers', () => {
    const issues = [issue('seed')];
    const g = buildSessionContextGraph(issues, ['SEED'],
      { seedIssue: 'SEED', window: { start: new Date(WINDOW_START), end: new Date(WINDOW_END) } });
    assert.equal(g.window.start, WINDOW_START);
    assert.equal(g.window.end, WINDOW_END);
  });
});

describe('buildSessionContextGraph — no side effects on the single-root path', () => {
  test('calling the session builder does not change buildContextGraph output', () => {
    const issues = [
      issue('a', { relations: [blocks('b')] }),
      issue('b', { parentId: 'a' }),
    ];
    const before = JSON.stringify(buildContextGraph(issues, 'b'));
    buildSessionContextGraph(issues, ['A', 'B'], { seedIssue: 'A', window: {} });
    const after = JSON.stringify(buildContextGraph(issues, 'b'));
    assert.equal(before, after, 'single-root output is byte-identical before/after');
  });
});

describe('deriveIssueGraph', () => {
  test('maps identifier → parentIdentifier, null for in-set roots', () => {
    const issues = [
      issue('epic', { identifier: 'LIN-1' }),
      issue('seed', { identifier: 'LIN-2', parentId: 'epic' }),
      issue('child', { identifier: 'LIN-3', parentId: 'seed' }),
    ];
    const { parentOf } = deriveIssueGraph(issues);
    assert.equal(parentOf['LIN-1'], null, 'epic has no parent in the set');
    assert.equal(parentOf['LIN-2'], 'LIN-1');
    assert.equal(parentOf['LIN-3'], 'LIN-2');
  });

  test('a parent outside the set maps to null (treated as a root within the set)', () => {
    const issues = [issue('seed', { identifier: 'LIN-2', parentId: 'missing-uuid' })];
    assert.equal(deriveIssueGraph(issues).parentOf['LIN-2'], null);
  });

  test('handles an empty / nullish set', () => {
    assert.deepStrictEqual(deriveIssueGraph([]).parentOf, {});
    assert.deepStrictEqual(deriveIssueGraph(undefined).parentOf, {});
  });
});
