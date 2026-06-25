/**
 * Unit tests for lib/providers/local/index.js (LIN-356).
 *
 * Run with: node --test tests/unit/local-provider.test.js
 *
 * Covers:
 *   - the capability profile (method capabilities + the 5-flag ui surface);
 *   - module-load self-registration under 'local';
 *   - reads returning the canonical shape the dashboard/tree consume;
 *   - the A⇄D interaction (fetchTeams → [] rather than a throw);
 *   - the write path round-tripping through the store.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { LocalProvider, localProvider } from '../../lib/providers/local/index.js';
import { NotImplementedError } from '../../lib/providers/interface.js';
import { getProvider } from '../../lib/providers/registry.js';
import { createLocalProvider } from '../fixtures/local-harness.js';

const SCOPE = 'ws-1'; // token == store partition key for the local provider

function makeProvider() {
  return createLocalProvider(); // { provider, store, collection }
}

describe('LocalProvider capability profile (LIN-356 step D)', () => {
  const { provider } = makeProvider();

  test('ui surface has the declared profile', () => {
    assert.deepEqual(provider.ui, {
      write: true,        // getCreateTaskUrl overridden
      comments: true,     // fetchIssueComments implemented
      estimates: false,
      subtasks: true,
      displayName: 'Local',
    });
  });

  test('implements the required writes + reads', () => {
    for (const m of ['createIssue', 'updateIssue', 'createComment', 'createRelation',
      'addLabel', 'removeLabel', 'fetchIssueComments', 'fetchIssueFields', 'search', 'states', 'labels',
      'fetchProjects', 'fetchProjectsList', 'fetchTeams']) {
      assert.equal(provider.supports(m), true, `expected supports('${m}')`);
    }
  });

  // LIN-583: cycles()/cycleDetail() now return canonical-empty so the consumer
  // proxy's /cycles surface answers `{ cycles: [] }` for a local workspace
  // instead of a 500. The local harness still has no cycle CONCEPT — empty is the
  // honest answer (originally left as the base throw under LIN-356).
  test('models cycles/cycleDetail as canonical-empty (LIN-583)', async () => {
    assert.equal(provider.supports('cycles'), true);
    assert.equal(provider.supports('cycleDetail'), true);
    assert.deepEqual(await provider.cycles(SCOPE), []);
    assert.equal(await provider.cycleDetail(SCOPE, 'any'), null);
  });

  test('getCreateTaskUrl returns a local deep link', () => {
    assert.equal(provider.getCreateTaskUrl('my ws', 'p1'),
      '/workspace/my%20ws/new?project=p1');
  });
});

describe('LocalProvider registry', () => {
  test('self-registers under "local" on import', () => {
    assert.equal(getProvider('local'), localProvider);
    assert.equal(localProvider.name, 'local');
  });
});

describe('LocalProvider reads', () => {
  let provider, store;
  beforeEach(async () => {
    ({ provider, store } = makeProvider());
    await store.seed(SCOPE, {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
      issues: [
        { id: 'i1', identifier: 'LOCAL-1', title: 'Parent', projectId: 'p1', state: { name: 'In Progress', type: 'started' }, labels: ['bug'] },
        { id: 'i2', identifier: 'LOCAL-2', title: 'Child', projectId: 'p1', parentId: 'i1', state: { name: 'Todo', type: 'unstarted' } },
      ],
    });
  });

  test('fetchProjects returns canonical {organizationName, projects, issues}', async () => {
    const { organizationName, projects, issues } = await provider.fetchProjects(SCOPE);
    assert.equal(organizationName, 'Local');
    assert.equal(projects.length, 1);
    assert.deepEqual(projects[0], { id: 'p1', name: 'Alpha', content: 'a', url: null, sortOrder: 1 });
    assert.equal(issues.length, 2);
    const parent = issues.find(i => i.id === 'i1');
    assert.equal(parent.source, 'local');       // provenance stamp (LIN-561)
    assert.equal(parent.project.name, 'Alpha');
    assert.deepEqual(parent.labels, { nodes: [{ name: 'bug' }] });
    assert.equal(parent.parent, null);
    assert.deepEqual(issues.find(i => i.id === 'i2').parent, { id: 'i1' });
  });

  test('fetchTeams returns [] (projects-only — A⇄D interaction, not a throw)', async () => {
    assert.deepEqual(await provider.fetchTeams(SCOPE), []);
  });

  test('surfaces stored relations in canonical {nodes:[{type, relatedIssue}]} shape (LIN-378)', async () => {
    // The swim/ship dependency views derive blocksIds from
    // issue.relations.nodes — same shape the Linear provider's query returns.
    await store.clear(SCOPE);
    await store.seed(SCOPE, {
      projects: [{ id: 'p1', name: 'Alpha', sortOrder: 1 }],
      issues: [
        { id: 'i1', identifier: 'LOCAL-1', title: 'Blocker', projectId: 'p1', relations: [{ type: 'blocks', relatedIssueId: 'i2' }] },
        { id: 'i2', identifier: 'LOCAL-2', title: 'Blocked', projectId: 'p1' },
      ],
    });
    const { issues } = await provider.fetchProjects(SCOPE);
    assert.deepEqual(issues.find(i => i.id === 'i1').relations,
      { nodes: [{ type: 'blocks', relatedIssue: { id: 'i2' } }] });
    assert.deepEqual(issues.find(i => i.id === 'i2').relations, { nodes: [] });
  });

  test('fetchIssueContext returns issue + parent + children + project', async () => {
    const ctx = await provider.fetchIssueContext(SCOPE, 'LOCAL-1');
    assert.equal(ctx.issue.identifier, 'LOCAL-1');
    assert.equal(ctx.project.name, 'Alpha');
    assert.equal(ctx.children.length, 1);
    assert.equal(ctx.children[0].id, 'i2');
    assert.equal(ctx.parent, null);

    const childCtx = await provider.fetchIssueContext(SCOPE, 'i2');
    assert.equal(childCtx.parent.id, 'i1');
    assert.equal(childCtx.parentChildCount, 1);
  });

  test('fetchIssueContext throws for a missing issue', async () => {
    await assert.rejects(() => provider.fetchIssueContext(SCOPE, 'nope'), /Issue not found/);
  });

  // LIN-442: the lazy dashboard detail surface calls provider.fetchIssueFields
  // and feeds the result straight to renderDetailsContent, so it must return the
  // raw `{ nodes }`-labelled canonical issue (NOT fetchIssueContext's flat-array
  // curated shape).
  test('fetchIssueFields returns one canonical issue in render shape', async () => {
    const issue = await provider.fetchIssueFields(SCOPE, 'LOCAL-1');
    assert.equal(issue.id, 'i1');
    assert.equal(issue.identifier, 'LOCAL-1');
    assert.equal(issue.title, 'Parent');
    assert.deepEqual(issue.labels, { nodes: [{ name: 'bug' }] });
    assert.equal(issue.project.name, 'Alpha');
  });

  test('fetchIssueFields throws for a missing issue', async () => {
    await assert.rejects(() => provider.fetchIssueFields(SCOPE, 'nope'), /Issue not found/);
  });

  // LIN-388: the recap/brief/recommend/prompt surfaces call
  // provider.fetchRecommendationContext (not fetchIssueContext). The local
  // provider must implement it so a `provider: 'local'` session can drive them.
  test('fetchRecommendationContext attaches focusedChild for a parent', async () => {
    const ctx = await provider.fetchRecommendationContext(SCOPE, 'i1');
    assert.equal(ctx.issue.identifier, 'LOCAL-1');
    assert.equal(ctx.children.length, 1);
    // selectFocusSubtask picks the only non-terminal child (LOCAL-2, unstarted).
    assert.equal(ctx.focusedChild.issue.identifier, 'LOCAL-2');
  });

  test('fetchRecommendationContext returns a leaf task as-is (no focusedChild)', async () => {
    const ctx = await provider.fetchRecommendationContext(SCOPE, 'i2');
    assert.equal(ctx.issue.identifier, 'LOCAL-2');
    assert.equal(ctx.children.length, 0);
    assert.equal(ctx.focusedChild, undefined);
  });

  test('fetchRecommendationContext honors noDescend (frames parent as a leaf)', async () => {
    const ctx = await provider.fetchRecommendationContext(SCOPE, 'i1', { noDescend: true });
    assert.equal(ctx.issue.identifier, 'LOCAL-1');
    assert.equal(ctx.focusedChild, undefined);
  });

  test('fetchRecommendationContext throws for a missing issue', async () => {
    await assert.rejects(() => provider.fetchRecommendationContext(SCOPE, 'nope'), /Issue not found/);
  });

  test('search / states / labels', async () => {
    assert.equal((await provider.search(SCOPE, 'parent')).length, 1);
    const states = await provider.states(SCOPE);
    assert.deepEqual(states.map(s => s.type),
      ['backlog', 'unstarted', 'started', 'completed', 'canceled']);
    assert.deepEqual(await provider.labels(SCOPE), [{ id: 'bug', name: 'bug', color: null }]);
  });
});

// The consumer-proxy read + write-guard surface (LIN-583). These methods back
// the Linear API proxy's data path through the injectable provider, so they must
// emit the nested-canonical shape the shared proxy-wire flatten helpers expect.
describe('LocalProvider proxy surface (LIN-583)', () => {
  let provider, store;
  beforeEach(async () => {
    ({ provider, store } = makeProvider());
    await store.seed(SCOPE, {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1, url: '/x' }],
      issues: [
        { id: 'i1', identifier: 'LOCAL-1', title: 'Blocker', description: 'd1', projectId: 'p1', state: { name: 'In Progress', type: 'started' }, labels: ['bug'], relations: [{ id: 'rel-1', type: 'blocks', relatedIssueId: 'i2' }], comments: [{ id: 'c1', body: 'hi', createdAt: '2024-01-01T00:00:00Z', user: 'Alice' }] },
        { id: 'i2', identifier: 'LOCAL-2', title: 'Blocked', projectId: 'p1', parentId: 'i1', state: { name: 'Todo', type: 'unstarted' } },
      ],
    });
  });

  test('viewer returns a synthetic local user', async () => {
    assert.deepEqual(await provider.viewer(SCOPE), { id: 'local-user', name: 'Local User', email: 'local@localhost' });
  });

  test('projects returns the started-projects field shape (no sortOrder to leak)', async () => {
    const projects = await provider.projects(SCOPE);
    assert.deepEqual(projects, [{ id: 'p1', name: 'Alpha', content: 'a', url: '/x' }]);
  });

  test('issues returns { nodes, pageInfo } with offset pagination', async () => {
    const page1 = await provider.issues(SCOPE, { first: 1 });
    assert.equal(page1.nodes.length, 1);
    assert.equal(page1.pageInfo.hasNextPage, true);
    assert.equal(page1.pageInfo.endCursor, '1');
    const page2 = await provider.issues(SCOPE, { first: 1, after: page1.pageInfo.endCursor });
    assert.equal(page2.nodes.length, 1);
    assert.equal(page2.pageInfo.hasNextPage, false);
    // A team filter resolves to empty (local has no teams).
    assert.deepEqual((await provider.issues(SCOPE, { teamId: 't1' })).nodes, []);
  });

  test('issueDetail returns nested {nodes} children/comments/relations/inverseRelations', async () => {
    const issue = await provider.issueDetail(SCOPE, 'LOCAL-1');
    assert.equal(issue.identifier, 'LOCAL-1');
    assert.equal(issue.trashed, false);
    assert.deepEqual(issue.labels, { nodes: [{ name: 'bug' }] });
    assert.equal(issue.children.nodes.length, 1);
    assert.equal(issue.children.nodes[0].identifier, 'LOCAL-2');
    assert.equal(issue.comments.nodes[0].user.name, 'Alice');
    assert.deepEqual(issue.relations.nodes, [{ id: 'rel-1', type: 'blocks', relatedIssue: { id: 'i2', identifier: 'LOCAL-2', title: 'Blocked', state: { name: 'Todo', type: 'unstarted' } } }]);
    // i2 is the target of i1's blocks relation → it shows up as an inverse.
    const blocked = await provider.issueDetail(SCOPE, 'i2');
    assert.equal(blocked.inverseRelations.nodes.length, 1);
    assert.equal(blocked.inverseRelations.nodes[0].issue.id, 'i1');
  });

  test('issueDetail returns null for a missing issue', async () => {
    assert.equal(await provider.issueDetail(SCOPE, 'nope'), null);
  });

  test('relations returns { trashed, relations, inverseRelations } / null', async () => {
    const rel = await provider.relations(SCOPE, 'i1');
    assert.equal(rel.trashed, false);
    assert.deepEqual(rel.relations.nodes, [{ id: 'rel-1', type: 'blocks', relatedIssue: { id: 'i2', identifier: 'LOCAL-2', title: 'Blocked', state: { name: 'Todo', type: 'unstarted' } } }]);
    assert.deepEqual(rel.inverseRelations.nodes, []);
    assert.equal(await provider.relations(SCOPE, 'nope'), null);
  });

  test('cycles/cycleDetail are canonical-empty', async () => {
    assert.deepEqual(await provider.cycles(SCOPE), []);
    assert.equal(await provider.cycleDetail(SCOPE, 'any'), null);
  });

  test('write-guard reads (issueWriteGuard/issueDescription/issueLabels)', async () => {
    assert.deepEqual(await provider.issueWriteGuard(SCOPE, 'i1'), { id: 'i1', trashed: false });
    assert.equal(await provider.issueWriteGuard(SCOPE, 'nope'), null);
    assert.deepEqual(await provider.issueDescription(SCOPE, 'i1'), { id: 'i1', description: 'd1', trashed: false });
    assert.deepEqual(await provider.issueLabels(SCOPE, 'i1'), { id: 'i1', trashed: false, labels: { nodes: [{ id: 'bug', name: 'bug' }] } });
  });

  test('updateIssueLabels writes the full label set and echoes { success, issue }', async () => {
    const res = await provider.updateIssueLabels(SCOPE, 'i1', ['bug', 'urgent']);
    assert.equal(res.success, true);
    assert.deepEqual(res.issue.labels, { nodes: [{ name: 'bug' }, { name: 'urgent' }] });
    assert.deepEqual((await store.getIssue(SCOPE, 'i1')).labels, ['bug', 'urgent']);
  });

  test('deleteRelation removes by relation id and echoes { success }', async () => {
    assert.deepEqual(await provider.deleteRelation(SCOPE, 'rel-1'), { success: true });
    assert.deepEqual((await store.getIssue(SCOPE, 'i1')).relations, []);
    assert.deepEqual(await provider.deleteRelation(SCOPE, 'missing'), { success: false });
  });
});

describe('LocalProvider writes', () => {
  let provider, store;
  beforeEach(() => { ({ provider, store } = makeProvider()); });

  test('createIssue persists and returns canonical shape', async () => {
    const created = await provider.createIssue(SCOPE, { title: 'New', projectId: null });
    assert.equal(created.identifier, 'LOCAL-1');
    assert.equal(created.title, 'New');
    assert.deepEqual(created.labels, { nodes: [] });
    assert.equal((await store.listIssues(SCOPE)).length, 1);
  });

  test('canonical issue carries priorityLabel derived from priority (LIN-589)', async () => {
    // Default priority 0 → "No priority"; a set priority maps to Linear's label.
    const def = await provider.createIssue(SCOPE, { title: 'No prio' });
    assert.equal(def.priority, 0);
    assert.equal(def.priorityLabel, 'No priority');

    const high = await provider.createIssue(SCOPE, { title: 'High prio', priority: 2 });
    assert.equal(high.priority, 2);
    assert.equal(high.priorityLabel, 'High');

    // Write echoes use the same _toCanonicalIssue pass, so an update echo carries it too.
    const updated = await provider.updateIssue(SCOPE, high.id, { priority: 1 });
    assert.equal(updated.priorityLabel, 'Urgent');
  });

  test('updateIssue round-trips through fetchIssueContext', async () => {
    const created = await provider.createIssue(SCOPE, { title: 'Old' });
    const updated = await provider.updateIssue(SCOPE, created.id, {
      title: 'Renamed', state: { name: 'Done', type: 'completed' },
    });
    assert.equal(updated.title, 'Renamed');
    assert.equal(updated.state.type, 'completed');
    assert.equal((await provider.fetchIssueContext(SCOPE, created.id)).issue.title, 'Renamed');
    assert.equal(await provider.updateIssue(SCOPE, 'missing', { title: 'x' }), null);
  });

  test('createComment then fetchIssueComments', async () => {
    const created = await provider.createIssue(SCOPE, { title: 'C' });
    const comment = await provider.createComment(SCOPE, created.id, 'hello');
    assert.equal(comment.body, 'hello');
    const comments = await provider.fetchIssueComments(SCOPE, created.id);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].user, 'Local');
    await assert.rejects(() => provider.createComment(SCOPE, 'missing', 'x'), /Issue not found/);
  });

  test('addLabel / removeLabel', async () => {
    const created = await provider.createIssue(SCOPE, { title: 'L' });
    assert.equal(await provider.addLabel(SCOPE, created.id, 'bug'), true);
    let ctx = await provider.fetchIssueContext(SCOPE, created.id);
    // fetchIssueContext's curated issue exposes labels as a flat name array,
    // matching the Linear provider's contract (the prompt/AI consumers read it
    // as an array). The raw `{ nodes }` shape is only for the tree path. (LIN-406.)
    assert.deepEqual(ctx.issue.labels, ['bug']);
    await provider.removeLabel(SCOPE, created.id, 'bug');
    ctx = await provider.fetchIssueContext(SCOPE, created.id);
    assert.deepEqual(ctx.issue.labels, []);
  });

  test('createRelation persists', async () => {
    const a = await provider.createIssue(SCOPE, { title: 'A' });
    const b = await provider.createIssue(SCOPE, { title: 'B' });
    const rel = await provider.createRelation(SCOPE, a.id, { type: 'blocks', relatedIssueId: b.id });
    assert.equal(rel.type, 'blocks');
    assert.equal(rel.relatedIssueId, b.id);
  });

  test('unconfigured provider throws a clear error', async () => {
    const bare = new LocalProvider();
    await assert.rejects(() => bare.fetchProjects(SCOPE), /store not configured/);
  });
});

// ===========================================================================
// LIN-582 Phase A — comprehensive contract coverage against LocalProvider.
//
// Fills the read/write/edge-case gaps the earlier slices left open so the
// provider-contract suite exercises EVERY listed seam against a genuine store
// (no mock short-circuit). New ground here:
//   - fetchProjectsList (the issues-free read);
//   - fetchIssueComments as a direct read (sort order + user fallback);
//   - the no-soft-delete boundary ("trashed issue" — always trashed:false);
//   - capability declines (supports() === false → NotImplementedError, the
//     provider-level root the proxy maps to 422 CAPABILITY_NOT_SUPPORTED);
//   - scope/partition isolation across two store partitions.
// ===========================================================================

describe('LocalProvider fetchProjectsList (LIN-582)', () => {
  let provider, store;
  beforeEach(async () => {
    ({ provider, store } = makeProvider());
    await store.seed(SCOPE, {
      projects: [
        { id: 'p2', name: 'Beta', content: 'b', url: '/b', sortOrder: 2 },
        { id: 'p1', name: 'Alpha', content: 'a', url: '/a', sortOrder: 1 },
      ],
      issues: [{ id: 'i1', identifier: 'LOCAL-1', title: 'T', projectId: 'p1' }],
    });
  });

  test('returns canonical projects only (no issues), sorted by sortOrder', async () => {
    const projects = await provider.fetchProjectsList(SCOPE);
    // listProjects sorts by sortOrder, so Alpha (1) precedes Beta (2).
    assert.deepEqual(projects, [
      { id: 'p1', name: 'Alpha', content: 'a', url: '/a', sortOrder: 1 },
      { id: 'p2', name: 'Beta', content: 'b', url: '/b', sortOrder: 2 },
    ]);
  });

  test('returns [] for an empty partition', async () => {
    assert.deepEqual(await provider.fetchProjectsList('empty-scope'), []);
  });
});

describe('LocalProvider fetchIssueComments direct read (LIN-582)', () => {
  let provider, store;
  beforeEach(async () => {
    ({ provider, store } = makeProvider());
    await store.seed(SCOPE, {
      projects: [{ id: 'p1', name: 'Alpha', sortOrder: 1 }],
      issues: [
        { id: 'i1', identifier: 'LOCAL-1', title: 'Has comments', projectId: 'p1', comments: [
          // Seeded out of order + one with no `user` to prove the sort + fallback.
          { id: 'c2', body: 'second', createdAt: '2024-02-02T00:00:00Z', user: 'Bob' },
          { id: 'c1', body: 'first', createdAt: '2024-01-01T00:00:00Z' },
        ] },
        { id: 'i2', identifier: 'LOCAL-2', title: 'No comments', projectId: 'p1' },
      ],
    });
  });

  test('returns comments oldest-first with a user fallback of "Local"', async () => {
    const comments = await provider.fetchIssueComments(SCOPE, 'i1');
    assert.deepEqual(comments, [
      { id: 'c1', body: 'first', createdAt: '2024-01-01T00:00:00Z', user: 'Local' },
      { id: 'c2', body: 'second', createdAt: '2024-02-02T00:00:00Z', user: 'Bob' },
    ]);
  });

  test('returns [] for an issue with no comments', async () => {
    assert.deepEqual(await provider.fetchIssueComments(SCOPE, 'i2'), []);
  });

  test('throws for a missing issue', async () => {
    await assert.rejects(() => provider.fetchIssueComments(SCOPE, 'nope'), /Issue not found/);
  });
});

describe('LocalProvider search edge cases (LIN-582)', () => {
  let provider, store;
  beforeEach(async () => {
    ({ provider, store } = makeProvider());
    await store.seed(SCOPE, {
      projects: [{ id: 'p1', name: 'Alpha', sortOrder: 1 }],
      issues: [
        { id: 'i1', identifier: 'LOCAL-1', title: 'Authentication bug', description: 'login fails', projectId: 'p1' },
        { id: 'i2', identifier: 'LOCAL-2', title: 'Unrelated', description: 'something else', projectId: 'p1' },
      ],
    });
  });

  test('matches title OR description, case-insensitively', async () => {
    assert.deepEqual((await provider.search(SCOPE, 'AUTHENTICATION')).map(i => i.id), ['i1']);
    assert.deepEqual((await provider.search(SCOPE, 'LOGIN')).map(i => i.id), ['i1']);
  });

  test('empty query returns every issue; a no-match query returns []', async () => {
    assert.equal((await provider.search(SCOPE, '')).length, 2);
    assert.deepEqual(await provider.search(SCOPE, 'zzzznope'), []);
  });
});

// "Trashed issue" edge case: the local store models NO soft-delete (see
// local-store.js — deleteIssue hard-removes; there is no trashed flag). The
// honest contract is therefore that every proxy-surface read reports
// trashed:false, and a genuinely deleted issue simply vanishes (resolves to
// null), never returning as a stale "ghost" the way a Linear soft-delete can.
// Pinning this guards the boundary the provider header documents.
describe('LocalProvider no-soft-delete boundary (LIN-582)', () => {
  let provider, store;
  beforeEach(async () => {
    ({ provider, store } = makeProvider());
    await store.seed(SCOPE, {
      projects: [{ id: 'p1', name: 'Alpha', sortOrder: 1 }],
      issues: [{ id: 'i1', identifier: 'LOCAL-1', title: 'Live', description: 'd', projectId: 'p1', labels: ['bug'] }],
    });
  });

  test('proxy-surface reads always report trashed:false for a live issue', async () => {
    assert.equal((await provider.issueDetail(SCOPE, 'i1')).trashed, false);
    assert.deepEqual(await provider.issueWriteGuard(SCOPE, 'i1'), { id: 'i1', trashed: false });
    assert.equal((await provider.issueDescription(SCOPE, 'i1')).trashed, false);
    assert.equal((await provider.issueLabels(SCOPE, 'i1')).trashed, false);
    assert.equal((await provider.relations(SCOPE, 'i1')).trashed, false);
  });

  test('a deleted issue vanishes (null), never a stale trashed ghost', async () => {
    assert.equal(await store.deleteIssue(SCOPE, 'i1'), true);
    // No ghost: every resolve-by-id surface reports "gone", not a trashed record.
    assert.equal(await provider.issueDetail(SCOPE, 'i1'), null);
    assert.equal(await provider.issueWriteGuard(SCOPE, 'i1'), null);
    assert.equal(await provider.issueDescription(SCOPE, 'i1'), null);
    assert.equal(await provider.issueLabels(SCOPE, 'i1'), null);
    assert.equal(await provider.relations(SCOPE, 'i1'), null);
    await assert.rejects(() => provider.fetchIssueContext(SCOPE, 'i1'), /Issue not found/);
  });
});

// Capability declines — the provider-level root of the consumer proxy's 422
// CAPABILITY_NOT_SUPPORTED (routes/proxy.js denyIfUnsupported gates on exactly
// this supports() result before the write, so an unsupported op declines cleanly
// instead of bubbling NotImplementedError into a 500). LocalProvider deliberately
// leaves part of the declared surface unimplemented; this pins which.
describe('LocalProvider capability declines (LIN-582)', () => {
  const { provider } = makeProvider();

  // Surface methods LocalProvider does NOT override → inherit the base throw.
  const DECLINED = ['fetchOrganization', 'fetchViewer', 'fetchFocusedChild', 'updateComment', 'deleteComment'];

  test('supports() is false for the unimplemented surface methods', () => {
    for (const m of DECLINED) {
      assert.equal(provider.supports(m), false, `expected supports('${m}') === false`);
    }
  });

  test('calling a declined method throws NotImplementedError (code NOT_IMPLEMENTED, named provider)', () => {
    // The base stubs throw synchronously (not rejected promises), so assert.throws.
    for (const m of DECLINED) {
      assert.throws(() => provider[m]('scope'), (err) => {
        assert.ok(err instanceof NotImplementedError, `${m} should throw NotImplementedError`);
        assert.equal(err.code, 'NOT_IMPLEMENTED');
        assert.equal(err.method, m);
        assert.equal(err.provider, 'local');
        return true;
      });
    }
  });

  test('getCapabilities() reports the declined methods under `declared`, not `implemented`', () => {
    const { implemented, declared } = provider.getCapabilities();
    for (const m of DECLINED) {
      assert.ok(declared.includes(m), `${m} should be declared-only`);
      assert.ok(!implemented.includes(m), `${m} should not be implemented`);
    }
    // Sanity floor: the writes the suite above exercises ARE implemented.
    for (const m of ['createIssue', 'updateIssue', 'createComment', 'createRelation', 'addLabel', 'removeLabel']) {
      assert.ok(implemented.includes(m), `${m} should be implemented`);
    }
  });
});

// Scope/partition isolation — `token` is the store partition key (the workspace
// urlKey). Two workspaces sharing one collection must not see each other's data
// across any read, search, label, or write surface.
describe('LocalProvider scope/partition isolation (LIN-582)', () => {
  let provider, store;
  const A = 'ws-a';
  const B = 'ws-b';
  beforeEach(async () => {
    ({ provider, store } = makeProvider()); // one store/collection, two scopes
    await store.seed(A, {
      projects: [{ id: 'pa', name: 'Alpha-A', sortOrder: 1 }],
      issues: [{ id: 'ia', identifier: 'A-1', title: 'A issue', description: 'shared-word', projectId: 'pa', labels: ['a-label'] }],
    });
    await store.seed(B, {
      projects: [{ id: 'pb', name: 'Beta-B', sortOrder: 1 }],
      issues: [{ id: 'ib', identifier: 'B-1', title: 'B issue', description: 'shared-word', projectId: 'pb', labels: ['b-label'] }],
    });
  });

  test('reads only return the queried partition', async () => {
    const a = await provider.fetchProjects(A);
    assert.deepEqual(a.projects.map(p => p.id), ['pa']);
    assert.deepEqual(a.issues.map(i => i.id), ['ia']);

    assert.deepEqual((await provider.fetchProjectsList(B)).map(p => p.id), ['pb']);
    assert.deepEqual(await provider.labels(A), [{ id: 'a-label', name: 'a-label', color: null }]);
    // Same search term lives in both partitions, yet each scope sees only its own.
    assert.deepEqual((await provider.search(A, 'shared-word')).map(i => i.id), ['ia']);
    assert.deepEqual((await provider.search(B, 'shared-word')).map(i => i.id), ['ib']);
  });

  test('an id from another partition does not resolve', async () => {
    assert.equal(await provider.issueDetail(A, 'ib'), null);
    await assert.rejects(() => provider.fetchIssueContext(A, 'ib'), /Issue not found/);
    assert.equal(await provider.issueWriteGuard(B, 'ia'), null);
  });

  test('writes land in the target partition only', async () => {
    const created = await provider.createIssue(A, { title: 'A-only' });
    // A grew; B is untouched.
    assert.equal((await store.listIssues(A)).length, 2);
    assert.equal((await store.listIssues(B)).length, 1);
    // The new issue is invisible from B.
    assert.equal(await provider.issueDetail(B, created.id), null);

    // A label written into A must not appear in B's distinct-label set.
    await provider.addLabel(A, 'ia', 'a-exclusive');
    assert.ok((await provider.labels(A)).some(l => l.name === 'a-exclusive'));
    assert.ok(!(await provider.labels(B)).some(l => l.name === 'a-exclusive'));
  });
});
