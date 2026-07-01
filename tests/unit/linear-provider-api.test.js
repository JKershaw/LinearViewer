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
  fetchProjects,
  fetchIssueFields,
  issues,
  issueDetail,
  search,
  states,
  labels,
  cycles,
  cycleDetail,
  fetchAttachment,
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
  issueWriteGuard,
  issueDescription,
  issueLabels,
  updateIssueLabels,
  uploadFile,
  linearProvider,
} from '../../lib/providers/linear/index.js';
import { flattenIssue } from '../../lib/proxy-wire.js';

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

// Shapes a thrown error the way graphql-request's real ClientError does for
// Linear's non-nullable by-id lookups (`cycle(id)`, `attachment(id)`): a
// top-level GraphQL error rather than `data: { X: null }` (LIN-890
// close-out — discovered against live Linear, not reproducible from a
// schema-null stub).
function notFoundError(entity) {
  const err = new Error(`Entity not found: ${entity}`);
  err.response = { errors: [{ message: `Entity not found: ${entity}` }] };
  return err;
}

// =============================================================================
// Source provenance stamping (LIN-561)
// =============================================================================
//
// The dashboard canonical-issue reads stamp `source: 'linear'`, so the internal
// model records provenance. The route-internal API-surface reads (issues /
// issueDetail / search) that feed the source-neutral proxy wire are deliberately
// left UN-stamped, keeping that contract byte-identical.

describe('Linear source provenance (LIN-561)', () => {
  test('fetchProjects stamps source: linear on every issue', async () => {
    stub(async (query) => {
      if (/projects\(/.test(query)) {
        return { organization: { name: 'Acme' }, projects: { nodes: [{ id: 'p1', name: 'P' }] } };
      }
      return {
        issues: {
          nodes: [{ id: 'i1', identifier: 'LIN-1' }, { id: 'i2', identifier: 'LIN-2' }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    });
    const { issues: result } = await fetchProjects(API_KEY);
    assert.deepStrictEqual(result.map(i => i.source), ['linear', 'linear']);
  });

  test('fetchIssueFields stamps source: linear on the single issue', async () => {
    stub(async () => ({ issue: { id: 'i1', identifier: 'LIN-1', title: 'T' } }));
    const issue = await fetchIssueFields(API_KEY, 'LIN-1');
    assert.strictEqual(issue.source, 'linear');
  });

  test('API-surface reads stay un-stamped (source-neutral wire byte-identical)', async () => {
    stub(async () => ({
      issues: { nodes: [{ id: 'i1', identifier: 'LIN-1' }], pageInfo: {} },
      issue: { id: 'i1', identifier: 'LIN-1' },
      searchIssues: { nodes: [{ id: 'i1', identifier: 'LIN-1' }] },
    }));
    const list = await issues(API_KEY, {});
    const detail = await issueDetail(API_KEY, 'LIN-1');
    const found = await search(API_KEY, 'x');
    assert.ok(!('source' in list.nodes[0]), 'list read must not carry source');
    assert.ok(!('source' in detail), 'detail read must not carry source');
    assert.ok(!('source' in found[0]), 'search read must not carry source');
  });
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

  test('issueDetail: the query selects issue-level attachments (LIN-649)', async () => {
    const m = stub(async () => ({ issue: { id: 'i1', identifier: 'LIN-1' } }));
    await issueDetail(API_KEY, 'LIN-1');
    const [query] = m.mock.calls[0].arguments;
    assert.match(query, /attachments\(first: 50\) \{ nodes \{ id title url \} \}/);
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

  test('cycleDetail: normalizes a thrown "Entity not found" GraphQL error to null (LIN-890 close-out)', async () => {
    stub(async () => { throw notFoundError('Cycle'); });
    assert.strictEqual(await cycleDetail(API_KEY, 'bogus'), null);
  });

  test('cycleDetail: rethrows a non-not-found error unchanged', async () => {
    const authError = new Error('unauthorized');
    authError.response = { status: 401, errors: [{ message: 'Authentication required' }] };
    stub(async () => { throw authError; });
    await assert.rejects(() => cycleDetail(API_KEY, 'cyc-1'), authError);
  });

  test('fetchAttachment: returns the attachment by id, or null when the query resolves it schema-null', async () => {
    const m = stub(async () => ({ attachment: { id: 'att-1', url: 'https://uploads.linear.app/x', title: 'x.png' } }));
    const found = await fetchAttachment(API_KEY, 'att-1');
    assert.deepStrictEqual(found, { id: 'att-1', url: 'https://uploads.linear.app/x', title: 'x.png' });
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], { id: 'att-1' });
    restore(); restore = undefined;

    stub(async () => ({ attachment: null }));
    assert.strictEqual(await fetchAttachment(API_KEY, 'missing'), null);
  });

  test('fetchAttachment: normalizes a thrown "Entity not found" GraphQL error to null (live Linear throws for a missing/deleted attachment, LIN-890 close-out)', async () => {
    stub(async () => { throw notFoundError('Attachment'); });
    assert.strictEqual(await fetchAttachment(API_KEY, 'bogus'), null);
  });

  test('fetchAttachment: rethrows a non-not-found error unchanged, so the route catch (not this null path) handles it', async () => {
    const rateLimitError = new Error('rate limited');
    rateLimitError.response = { status: 429, errors: [{ message: 'Too many requests' }] };
    stub(async () => { throw rateLimitError; });
    await assert.rejects(() => fetchAttachment(API_KEY, 'att-1'), rateLimitError);
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
// Write-path guard reads + label-write primitive (LIN-309)
// =============================================================================

describe('Linear provider write-guard reads (LIN-309)', () => {
  test('issueWriteGuard returns the trashed probe, or null when unresolved', async () => {
    stub(async (q, v) => ({ issue: { id: v.id, trashed: true } }));
    assert.deepStrictEqual(await issueWriteGuard(API_KEY, 'LIN-1'), { id: 'LIN-1', trashed: true });
    restore(); restore = undefined;
    stub(async () => ({ issue: null }));
    assert.strictEqual(await issueWriteGuard(API_KEY, 'nope'), null);
  });

  test('issueDescription returns { description, trashed }, or null when unresolved', async () => {
    stub(async (q, v) => ({ issue: { id: v.id, description: 'body', trashed: false } }));
    assert.deepStrictEqual(await issueDescription(API_KEY, 'LIN-1'), { id: 'LIN-1', description: 'body', trashed: false });
    restore(); restore = undefined;
    stub(async () => ({ issue: null }));
    assert.strictEqual(await issueDescription(API_KEY, 'nope'), null);
  });

  test('issueLabels returns the current label set, or null when unresolved', async () => {
    stub(async (q, v) => ({ issue: { id: v.issueId, trashed: false, labels: { nodes: [{ id: 'a', name: 'bug' }] } } }));
    const issue = await issueLabels(API_KEY, 'LIN-1');
    assert.deepStrictEqual(issue.labels.nodes, [{ id: 'a', name: 'bug' }]);
    restore(); restore = undefined;
    stub(async () => ({ issue: null }));
    assert.strictEqual(await issueLabels(API_KEY, 'nope'), null);
  });

  test('updateIssueLabels writes the full label-id set and returns issueUpdate', async () => {
    let written;
    const m = stub(async (q, v) => { written = v; return { issueUpdate: { success: true, issue: { id: v.id } } }; });
    const result = await updateIssueLabels(API_KEY, 'LIN-1', ['a', 'b']);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(written, { id: 'LIN-1', input: { labelIds: ['a', 'b'] } });
    assert.strictEqual(m.mock.calls.length, 1);
  });

  test('the class delegates the guard reads + label write to the same boundary', async () => {
    stub(async (q, v) => ({ issue: { id: v.id, trashed: false } }));
    assert.deepStrictEqual(await linearProvider.issueWriteGuard(API_KEY, 'LIN-1'), { id: 'LIN-1', trashed: false });
  });

  test('the guard reads stay OFF the declared capability surface', () => {
    // Like the LIN-308 api reads, these are route-internal data-fetch, not
    // first-class capabilities — so they must not appear as supported writes.
    for (const m of ['issueWriteGuard', 'issueDescription', 'issueLabels', 'updateIssueLabels']) {
      assert.strictEqual(linearProvider.supports(m), false, `${m} must not be a declared capability`);
    }
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

// =============================================================================
// Wire-completeness: team / teamId / priorityLabel + self-verifying write echoes
// (LIN-589)
// =============================================================================
//
// The local e2e harness (proxy-local.spec.js) is teamless and proxy.spec.js is
// mock-mode, so neither can prove team/teamId end-to-end. These tests pin the two
// halves the e2e suite structurally cannot: (1) the Linear queries/mutations
// SELECT the fields, and (2) flattenIssue derives the flat teamId scalar from the
// selected team object — the same post-fetch pass the route runs.

describe('Linear API wire-completeness (LIN-589)', () => {
  test('issue reads select team + priorityLabel (detail, list, search)', async () => {
    const m = stub(async () => ({
      issue: { id: 'i1' }, issues: { nodes: [], pageInfo: {} }, searchIssues: { nodes: [] },
    }));
    await issueDetail(API_KEY, 'LIN-1');
    await issues(API_KEY, {});
    await search(API_KEY, 'q');
    const queries = m.mock.calls.map(c => c.arguments[0]);
    for (const q of queries) {
      assert.match(q, /team\s*{\s*id\s+name\s*}/, 'every issue read must select team { id name }');
      assert.match(q, /priorityLabel/, 'every issue read must select priorityLabel');
    }
  });

  test('write mutations echo the same field set as the detail read (shared fragment, no drift)', async () => {
    // The create echo, update echo, and detail read all compose the ONE shared
    // ApiIssueFields fragment — so a write is self-verifying and can never drift
    // from what a read returns (the exact gap LIN-589 closes).
    const cm = stub(async () => ({ issueCreate: { success: true, issue: { id: 'i1' } } }));
    await createIssue(API_KEY, { teamId: 't1', title: 'New' });
    const createQuery = cm.mock.calls[0].arguments[0];
    restore(); restore = undefined;

    const um = stub(async () => ({ issueUpdate: { success: true, issue: { id: 'i1' } } }));
    await updateIssue(API_KEY, 'LIN-1', { priority: 2 });
    const updateQuery = um.mock.calls[0].arguments[0];
    restore(); restore = undefined;

    const dm = stub(async () => ({ issue: { id: 'i1' } }));
    await issueDetail(API_KEY, 'LIN-1');
    const detailQuery = dm.mock.calls[0].arguments[0];

    for (const [name, q] of [['create', createQuery], ['update', updateQuery], ['detail', detailQuery]]) {
      assert.match(q, /\.\.\.ApiIssueFields/, `${name} must spread the shared ApiIssueFields fragment`);
      assert.match(q, /fragment ApiIssueFields on Issue/, `${name} must embed the fragment definition`);
    }
    // And the mutable fields the ticket calls out are all in that one fragment.
    for (const field of ['priority', 'priorityLabel', 'team', 'project', 'parent', 'labels', 'assignee', 'state', 'cycle', 'estimate']) {
      assert.match(createQuery, new RegExp(field), `write echo must carry ${field}`);
    }
  });

  test('flattenIssue derives a flat teamId from the selected team object', async () => {
    // What a Linear node looks like once the (now team-selecting) query returns,
    // before the route's shared flatten pass.
    const node = { id: 'i1', identifier: 'LIN-1', team: { id: 'team-uuid', name: 'Engineering' }, priority: 2, priorityLabel: 'High' };
    flattenIssue(node);
    assert.strictEqual(node.teamId, 'team-uuid', 'flat teamId lifted from team.id');
    assert.deepStrictEqual(node.team, { id: 'team-uuid', name: 'Engineering' }, 'nested team preserved');
    assert.strictEqual(node.priorityLabel, 'High', 'priorityLabel passes through untouched');
  });

  test('flattenIssue yields a null teamId when the team came back null (teamless / unset)', async () => {
    const node = { id: 'i1', team: null };
    flattenIssue(node);
    assert.strictEqual(node.teamId, null);
  });

  test('flattenIssue adds no teamId when team was never selected (other read paths byte-identical)', async () => {
    const node = { id: 'i1', identifier: 'LIN-1' };
    flattenIssue(node);
    assert.strictEqual('teamId' in node, false);
  });
});

// =============================================================================
// File upload seam (LIN-636)
// =============================================================================

describe('Linear provider uploadFile (LIN-636)', () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('two-step handshake: fileUpload mutation → PUT bytes → returns assetUrl', async () => {
    const m = stub(async () => ({
      fileUpload: {
        success: true,
        uploadFile: {
          uploadUrl: 'https://upload.example/signed',
          assetUrl: 'https://uploads.linear.app/abc/screenshot.png',
          headers: [{ key: 'x-goog-meta', value: 'v' }],
        },
      },
    }));
    let putArgs;
    globalThis.fetch = async (url, opts) => { putArgs = { url, opts }; return { ok: true, status: 200 }; };

    const bytes = Buffer.from('PNGDATA');
    const assetUrl = await uploadFile(API_KEY, bytes, { contentType: 'image/png', filename: 'screenshot.png' });

    assert.strictEqual(assetUrl, 'https://uploads.linear.app/abc/screenshot.png');
    // Mutation variables carry the declared size/contentType/filename.
    assert.deepStrictEqual(m.mock.calls[0].arguments[1], {
      contentType: 'image/png', filename: 'screenshot.png', size: bytes.length,
    });
    // Bytes are PUT to the signed URL with Content-Type + the returned headers.
    assert.strictEqual(putArgs.url, 'https://upload.example/signed');
    assert.strictEqual(putArgs.opts.method, 'PUT');
    assert.strictEqual(putArgs.opts.headers['Content-Type'], 'image/png');
    assert.strictEqual(putArgs.opts.headers['x-goog-meta'], 'v');
    assert.strictEqual(putArgs.opts.body, bytes);
  });

  test('throws when the mutation returns no signed URL', async () => {
    stub(async () => ({ fileUpload: { success: false, uploadFile: null } }));
    globalThis.fetch = async () => ({ ok: true });
    await assert.rejects(() => uploadFile(API_KEY, Buffer.from('x'), {}), /did not return a signed upload URL/);
  });

  test('throws when the binary PUT fails', async () => {
    stub(async () => ({
      fileUpload: { success: true, uploadFile: { uploadUrl: 'https://u', assetUrl: 'https://a', headers: [] } },
    }));
    globalThis.fetch = async () => ({ ok: false, status: 403 });
    await assert.rejects(() => uploadFile(API_KEY, Buffer.from('x'), {}), /status 403/);
  });

  test('class delegates uploadFile and it is a declared capability', async () => {
    stub(async () => ({
      fileUpload: { success: true, uploadFile: { uploadUrl: 'https://u', assetUrl: 'https://a', headers: [] } },
    }));
    globalThis.fetch = async () => ({ ok: true });
    assert.strictEqual(linearProvider.supports('uploadFile'), true);
    assert.strictEqual(await linearProvider.uploadFile(API_KEY, Buffer.from('x'), {}), 'https://a');
  });
});
