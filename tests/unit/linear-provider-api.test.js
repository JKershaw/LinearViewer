/**
 * Unit tests for the Linear provider's API-surface methods (LIN-307).
 *
 * LIN-176 declared `search`/`states`/`labels`/`cycles`/`cycleDetail`/`relations`
 * and the write methods on the interface; LIN-307 wires them on the Linear
 * provider (moving the GraphQL that routes/proxy.js ran inline behind the
 * provider layer) and adds relation-delete + comment edit/delete.
 *
 * These tests stub `GraphQLClient.prototype.request` so they exercise query
 * selection, variable shaping, and response unwrapping with no network. They
 * cover BOTH the module-level functions and the class delegation, plus the
 * capability descriptor.
 *
 * Run with: node --test tests/unit/linear-provider-api.test.js
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { GraphQLClient } from 'graphql-request';

import {
  search,
  states,
  labels,
  cycles,
  cycleDetail,
  relations,
  createIssue,
  updateIssue,
  createComment,
  updateComment,
  deleteComment,
  createRelation,
  deleteRelation,
  addLabel,
  removeLabel,
  linearProvider,
} from '../../lib/providers/linear/index.js';

const API_KEY = 'lin_api_test';

// Each test installs a request stub via `stub(impl)`; impl receives
// (query, variables) and returns the canned GraphQL `data`. The query is a
// string (graphql-request's gql is a passthrough tag), so impls branch on
// substrings to distinguish operations within a single function call.
let restore;
function stub(impl) {
  const m = mock.method(GraphQLClient.prototype, 'request', impl);
  restore = () => m.mock.restore();
  return m;
}

afterEach(() => {
  if (restore) restore();
  restore = undefined;
  mock.reset();
});

// =============================================================================
// Reads
// =============================================================================

describe('Linear provider API reads (LIN-307)', () => {
  test('search: passes term + default first=50, unwraps searchIssues.nodes', async () => {
    const nodes = [{ id: '1', identifier: 'LIN-1' }];
    const m = stub(async () => ({ searchIssues: { nodes } }));
    const result = await search(API_KEY, 'login bug');
    assert.deepStrictEqual(result, nodes);
    const [query, variables] = m.mock.calls[0].arguments;
    assert.match(query, /searchIssues/);
    assert.deepStrictEqual(variables, { query: 'login bug', first: 50 });
  });

  test('search: honours an explicit first and returns [] when nodes missing', async () => {
    const m = stub(async () => ({}));
    const result = await search(API_KEY, 'x', { first: 10 });
    assert.deepStrictEqual(result, []);
    assert.strictEqual(m.mock.calls[0].arguments[1].first, 10);
  });

  test('states: filters by teamId and sorts by board position', async () => {
    const m = stub(async () => ({
      workflowStates: {
        nodes: [
          { id: 'c', name: 'Done', type: 'completed', position: 3 },
          { id: 'a', name: 'Todo', type: 'unstarted', position: 1 },
          { id: 'b', name: 'In Progress', type: 'started', position: 2 },
        ],
      },
    }));
    const result = await states(API_KEY, 'team-123');
    assert.deepStrictEqual(result.map(s => s.position), [1, 2, 3]);
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], { teamId: 'team-123' });
  });

  test('labels: no teamId uses the org-wide query with empty variables', async () => {
    const m = stub(async () => ({ issueLabels: { nodes: [{ id: 'l1', name: 'bug' }] } }));
    const result = await labels(API_KEY);
    assert.deepStrictEqual(result, [{ id: 'l1', name: 'bug' }]);
    const [query, variables] = m.mock.calls[0].arguments;
    assert.match(query, /issueLabels/);
    assert.doesNotMatch(query, /\$teamId/);
    assert.deepStrictEqual(variables, {});
  });

  test('labels: teamId selects the team-filtered query and passes the id', async () => {
    const m = stub(async () => ({ issueLabels: { nodes: [] } }));
    await labels(API_KEY, 'team-9');
    const [query, variables] = m.mock.calls[0].arguments;
    assert.match(query, /\$teamId/);
    assert.deepStrictEqual(variables, { teamId: 'team-9' });
  });

  test('cycles: no teamId uses the unfiltered query; teamId filters', async () => {
    const m1 = stub(async () => ({ cycles: { nodes: [{ id: 'c1', number: 1 }] } }));
    const all = await cycles(API_KEY);
    assert.deepStrictEqual(all, [{ id: 'c1', number: 1 }]);
    assert.deepStrictEqual(m1.mock.calls[0].arguments[1], {});
    restore(); restore = undefined;

    const m2 = stub(async () => ({ cycles: { nodes: [] } }));
    await cycles(API_KEY, 'team-2');
    assert.deepStrictEqual(m2.mock.calls[0].arguments[1], { teamId: 'team-2' });
  });

  test('cycleDetail: returns the cycle by id, or null when absent', async () => {
    const m = stub(async () => ({ cycle: { id: 'cyc-1', number: 7, progress: 0.5 } }));
    const found = await cycleDetail(API_KEY, 'cyc-1');
    assert.deepStrictEqual(found, { id: 'cyc-1', number: 7, progress: 0.5 });
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], { id: 'cyc-1' });
    restore(); restore = undefined;

    stub(async () => ({ cycle: null }));
    assert.strictEqual(await cycleDetail(API_KEY, 'missing'), null);
  });

  test('relations: wraps both directions in {nodes}, flags trashed', async () => {
    stub(async () => ({
      issue: {
        trashed: true,
        relations: { nodes: [{ id: 'r1', type: 'blocks' }] },
        inverseRelations: { nodes: [{ id: 'r2', type: 'blocks' }] },
      },
    }));
    const result = await relations(API_KEY, 'LIN-5');
    assert.deepStrictEqual(result, {
      trashed: true,
      relations: { nodes: [{ id: 'r1', type: 'blocks' }] },
      inverseRelations: { nodes: [{ id: 'r2', type: 'blocks' }] },
    });
  });

  test('relations: returns null when the issue does not resolve', async () => {
    stub(async () => ({ issue: null }));
    assert.strictEqual(await relations(API_KEY, 'nope'), null);
  });

  test('relations: defaults trashed to false and tolerates missing node arrays', async () => {
    stub(async () => ({ issue: {} }));
    const result = await relations(API_KEY, 'LIN-1');
    assert.deepStrictEqual(result, {
      trashed: false,
      relations: { nodes: [] },
      inverseRelations: { nodes: [] },
    });
  });
});

// =============================================================================
// Writes
// =============================================================================

describe('Linear provider API writes (LIN-307)', () => {
  test('createIssue: forwards input, returns the issueCreate payload', async () => {
    const payload = { success: true, issue: { id: 'i1', identifier: 'LIN-2' } };
    const m = stub(async () => ({ issueCreate: payload }));
    const input = { teamId: 't1', title: 'New' };
    const result = await createIssue(API_KEY, input);
    assert.deepStrictEqual(result, payload);
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], { input });
  });

  test('updateIssue: keys on id and forwards input', async () => {
    const payload = { success: true, issue: { id: 'i1' } };
    const m = stub(async () => ({ issueUpdate: payload }));
    const result = await updateIssue(API_KEY, 'LIN-2', { stateId: 's1' });
    assert.deepStrictEqual(result, payload);
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], { id: 'LIN-2', input: { stateId: 's1' } });
  });

  test('createComment: wraps {issueId, body} in input, returns commentCreate', async () => {
    const payload = { success: true, comment: { id: 'c1', body: 'hi' } };
    const m = stub(async () => ({ commentCreate: payload }));
    const result = await createComment(API_KEY, 'LIN-2', 'hi');
    assert.deepStrictEqual(result, payload);
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], { input: { issueId: 'LIN-2', body: 'hi' } });
  });

  test('updateComment: keys on comment id, wraps body in input', async () => {
    const payload = { success: true, comment: { id: 'c1', body: 'edited' } };
    const m = stub(async () => ({ commentUpdate: payload }));
    const result = await updateComment(API_KEY, 'c1', 'edited');
    assert.deepStrictEqual(result, payload);
    const [query, variables] = m.mock.calls[0].arguments;
    assert.match(query, /commentUpdate/);
    assert.deepStrictEqual(variables, { id: 'c1', input: { body: 'edited' } });
  });

  test('deleteComment: keys on comment id, returns commentDelete', async () => {
    const m = stub(async () => ({ commentDelete: { success: true } }));
    const result = await deleteComment(API_KEY, 'c1');
    assert.deepStrictEqual(result, { success: true });
    const [query, variables] = m.mock.calls[0].arguments;
    assert.match(query, /commentDelete/);
    assert.deepStrictEqual(variables, { id: 'c1' });
  });

  test('createRelation: passes the pair through for non-inverse types', async () => {
    const payload = { success: true, issueRelation: { type: 'blocks' } };
    const m = stub(async () => ({ issueRelationCreate: payload }));
    const result = await createRelation(API_KEY, 'LIN-1', { type: 'blocks', relatedIssueId: 'LIN-2' });
    assert.deepStrictEqual(result, payload);
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], {
      input: { issueId: 'LIN-1', relatedIssueId: 'LIN-2', type: 'blocks' },
    });
  });

  test('createRelation: blocked-by becomes an inverse blocks (ids swapped)', async () => {
    const m = stub(async () => ({ issueRelationCreate: { success: true } }));
    await createRelation(API_KEY, 'LIN-1', { type: 'blocked-by', relatedIssueId: 'LIN-2' });
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], {
      input: { issueId: 'LIN-2', relatedIssueId: 'LIN-1', type: 'blocks' },
    });
  });

  test('deleteRelation: keys on the relation id', async () => {
    const m = stub(async () => ({ issueRelationDelete: { success: true } }));
    const result = await deleteRelation(API_KEY, 'rel-1');
    assert.deepStrictEqual(result, { success: true });
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], { id: 'rel-1' });
  });
});

// =============================================================================
// Label read-modify-write (idempotent no-ops, error on missing issue)
// =============================================================================

describe('Linear provider label RMW (LIN-307)', () => {
  // Branch the stub: the labels read selects ISSUE_LABELS_QUERY (has
  // `labels { nodes`), the write selects UPDATE_ISSUE_LABELS_MUTATION
  // (an issueUpdate mutation).
  function rmwStub(currentLabelIds, onWrite) {
    return stub(async (query, variables) => {
      if (/mutation/.test(query)) {
        if (onWrite) onWrite(variables);
        return { issueUpdate: { success: true, issue: { id: variables.id, labels: { nodes: [] } } } };
      }
      return { issue: { id: variables.issueId, labels: { nodes: currentLabelIds.map(id => ({ id })) } } };
    });
  }

  test('addLabel: appends to the existing set and mutates', async () => {
    let written;
    const m = rmwStub(['a'], v => { written = v; });
    const result = await addLabel(API_KEY, 'LIN-1', 'b');
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(written.input.labelIds, ['a', 'b']);
    assert.strictEqual(m.mock.calls.length, 2); // read + write
  });

  test('addLabel: already-present is an idempotent no-op (no mutation)', async () => {
    const m = rmwStub(['a', 'b']);
    const result = await addLabel(API_KEY, 'LIN-1', 'b');
    assert.deepStrictEqual(result, { success: true, alreadyPresent: true });
    assert.strictEqual(m.mock.calls.length, 1); // read only
  });

  test('removeLabel: filters the id out and mutates', async () => {
    let written;
    const m = rmwStub(['a', 'b'], v => { written = v; });
    const result = await removeLabel(API_KEY, 'LIN-1', 'a');
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(written.input.labelIds, ['b']);
    assert.strictEqual(m.mock.calls.length, 2);
  });

  test('removeLabel: absent label is an idempotent no-op (no mutation)', async () => {
    const m = rmwStub(['a']);
    const result = await removeLabel(API_KEY, 'LIN-1', 'zzz');
    assert.deepStrictEqual(result, { success: true, notPresent: true });
    assert.strictEqual(m.mock.calls.length, 1);
  });

  test('addLabel / removeLabel: throw when the issue does not resolve', async () => {
    stub(async () => ({ issue: null }));
    await assert.rejects(() => addLabel(API_KEY, 'nope', 'x'), /Issue not found/);
    restore(); restore = undefined;
    stub(async () => ({ issue: null }));
    await assert.rejects(() => removeLabel(API_KEY, 'nope', 'x'), /Issue not found/);
  });
});

// =============================================================================
// Class delegation + capability gating
// =============================================================================

describe('LinearProvider class delegates the API surface (LIN-307)', () => {
  test('class methods reach the same GraphQL boundary as the functions', async () => {
    const m = stub(async () => ({ searchIssues: { nodes: [{ id: '1' }] } }));
    const result = await linearProvider.search(API_KEY, 'q');
    assert.deepStrictEqual(result, [{ id: '1' }]);
    assert.strictEqual(m.mock.calls.length, 1);
  });

  test('class write delegates too (createComment → commentCreate)', async () => {
    const m = stub(async () => ({ commentCreate: { success: true, comment: { id: 'c1' } } }));
    const result = await linearProvider.createComment(API_KEY, 'LIN-1', 'body');
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], { input: { issueId: 'LIN-1', body: 'body' } });
  });

  test('every API-surface method is now a supported capability', () => {
    const surface = [
      'search', 'states', 'labels', 'cycles', 'cycleDetail', 'relations',
      'createIssue', 'updateIssue', 'createComment', 'updateComment', 'deleteComment',
      'createRelation', 'deleteRelation', 'addLabel', 'removeLabel',
    ];
    for (const m of surface) {
      assert.strictEqual(linearProvider.supports(m), true, `${m} must be supported`);
    }
  });
});
