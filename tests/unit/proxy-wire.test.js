/**
 * Unit tests for the proxy wire-contract neutralization (LIN-310).
 *
 * These pin the source-neutral wire shape: nested collections flatten to plain
 * arrays, labels become plain name strings, and backend deep-link URLs are
 * dropped — while opaque ids/identifiers are preserved untouched.
 *
 * Run with: node --test tests/unit/proxy-wire.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { flattenIssue, neutralizeProject, flattenCycle, flattenRelations } from '../../lib/proxy-wire.js';

describe('flattenIssue', () => {
  test('flattens labels {nodes} to a plain array of names', () => {
    const issue = { id: 'i1', labels: { nodes: [{ id: 'l1', name: 'bug', color: '#f00' }, { id: 'l2', name: 'urgent' }] } };
    flattenIssue(issue);
    assert.deepStrictEqual(issue.labels, ['bug', 'urgent']);
  });

  test('flattens children {nodes} to a plain array and neutralizes each child', () => {
    const issue = {
      id: 'i1',
      children: { nodes: [{ id: 'c1', identifier: 'LIN-2', title: 'sub', url: 'https://linear.app/x', labels: { nodes: [{ name: 'bug' }] } }] }
    };
    flattenIssue(issue);
    assert.ok(Array.isArray(issue.children));
    assert.strictEqual(issue.children[0].identifier, 'LIN-2');
    assert.strictEqual('url' in issue.children[0], false, 'child url dropped');
    assert.deepStrictEqual(issue.children[0].labels, ['bug'], 'child labels flattened');
  });

  test('flattens comments / relations / inverseRelations {nodes} to plain arrays', () => {
    const issue = {
      id: 'i1',
      comments: { nodes: [{ id: 'm1', body: 'hi' }] },
      relations: { nodes: [{ id: 'r1', type: 'blocks', relatedIssue: { identifier: 'LIN-9' } }] },
      inverseRelations: { nodes: [{ id: 'r2', type: 'blocks', issue: { identifier: 'LIN-7' } }] }
    };
    flattenIssue(issue);
    assert.deepStrictEqual(issue.comments, [{ id: 'm1', body: 'hi' }]);
    assert.strictEqual(issue.relations[0].relatedIssue.identifier, 'LIN-9');
    assert.strictEqual(issue.inverseRelations[0].issue.identifier, 'LIN-7');
  });

  test('drops the backend url but preserves opaque id and identifier', () => {
    const issue = { id: 'uuid-1', identifier: 'LIN-123', url: 'https://linear.app/org/issue/LIN-123' };
    flattenIssue(issue);
    assert.strictEqual('url' in issue, false);
    assert.strictEqual(issue.id, 'uuid-1');
    assert.strictEqual(issue.identifier, 'LIN-123');
  });

  test('is defensive: leaves absent collections absent, tolerates already-flat input', () => {
    const issue = { id: 'i1', labels: ['bug'], state: { name: 'Todo', type: 'unstarted' } };
    flattenIssue(issue);
    assert.deepStrictEqual(issue.labels, ['bug']);
    assert.strictEqual('children' in issue, false);
    assert.deepStrictEqual(issue.state, { name: 'Todo', type: 'unstarted' });
  });

  test('is idempotent', () => {
    const issue = { id: 'i1', labels: { nodes: [{ name: 'bug' }] }, comments: { nodes: [{ id: 'm1' }] } };
    flattenIssue(issue);
    const once = JSON.parse(JSON.stringify(issue));
    flattenIssue(issue);
    assert.deepStrictEqual(issue, once);
  });

  test('returns non-objects unchanged', () => {
    assert.strictEqual(flattenIssue(null), null);
    assert.strictEqual(flattenIssue(undefined), undefined);
  });
});

describe('neutralizeProject', () => {
  test('strips url, keeps the rest', () => {
    const p = { id: 'p1', name: 'Alpha', content: 'desc', url: 'https://linear.app/x' };
    neutralizeProject(p);
    assert.deepStrictEqual(p, { id: 'p1', name: 'Alpha', content: 'desc' });
  });
});

describe('flattenCycle', () => {
  test('flattens nested issues {nodes} and neutralizes each', () => {
    const cycle = {
      id: 'cy1', name: 'Cycle 12', number: 12,
      issues: { nodes: [{ id: 'i1', identifier: 'LIN-1', url: 'https://linear.app/x', labels: { nodes: [{ name: 'bug' }] } }] }
    };
    flattenCycle(cycle);
    assert.ok(Array.isArray(cycle.issues));
    assert.strictEqual(cycle.issues[0].identifier, 'LIN-1');
    assert.strictEqual('url' in cycle.issues[0], false);
    assert.deepStrictEqual(cycle.issues[0].labels, ['bug']);
  });
});

describe('flattenRelations', () => {
  test('returns both directions as plain arrays', () => {
    const issue = {
      relations: { nodes: [{ id: 'r1', type: 'blocks' }] },
      inverseRelations: { nodes: [{ id: 'r2', type: 'blocks' }] }
    };
    const out = flattenRelations(issue);
    assert.deepStrictEqual(out, {
      relations: [{ id: 'r1', type: 'blocks' }],
      inverseRelations: [{ id: 'r2', type: 'blocks' }]
    });
  });

  test('tolerates a missing issue / missing connections', () => {
    assert.deepStrictEqual(flattenRelations(null), { relations: [], inverseRelations: [] });
    assert.deepStrictEqual(flattenRelations({}), { relations: [], inverseRelations: [] });
  });
});
