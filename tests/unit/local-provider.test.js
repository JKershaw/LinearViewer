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
