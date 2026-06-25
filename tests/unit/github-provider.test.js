/**
 * Unit tests for lib/providers/github/index.js (LIN-178).
 *
 * GitHub Issues is the abstraction's first FOREIGN backend — a hostile schema
 * (no subtasks, no estimates, repos not teams, binary open/closed state). These
 * tests pin:
 *   - the pure open/closed → canonical state mapping;
 *   - the capability profile (method capabilities + the 5-flag ui surface);
 *   - module-load self-registration under 'github';
 *   - reads returning the canonical shape the dashboard/tree consume, driven
 *     through the in-memory fake client (no network, no auth);
 *   - the A⇄D interaction (fetchTeams → [] rather than a throw);
 *   - the write path round-tripping through the fake backend.
 *
 * Run with: node --test tests/unit/github-provider.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  GitHubProvider,
  githubProvider,
  githubStateToCanonical,
} from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';
import { createGitHubClient } from '../../lib/providers/github/client.js';
import { getProvider } from '../../lib/providers/registry.js';
import { NotImplementedError } from '../../lib/providers/interface.js';

const REPO = 'octocat/hello-world';

function seededClient() {
  return createFakeGitHubClient({
    [REPO]: {
      milestones: [
        { number: 1, title: 'v1.0', description: 'first release', html_url: `https://github.com/${REPO}/milestone/1` },
      ],
      labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'enhancement', color: 'a2eeef' }],
      issues: [
        {
          number: 1, title: 'Open bug', body: 'something broke', state: 'open',
          html_url: `https://github.com/${REPO}/issues/1`, created_at: '2026-01-01T00:00:00Z',
          user: { login: 'alice' }, assignee: { login: 'bob' },
          labels: [{ name: 'bug' }], milestone: { number: 1, title: 'v1.0' },
          comments: [
            { id: 10, body: 'first', created_at: '2026-01-03T00:00:00Z', user: { login: 'alice' } },
            { id: 11, body: 'second', created_at: '2026-01-02T00:00:00Z', user: { login: 'carol' } },
          ],
        },
        {
          number: 2, title: 'Done item', body: 'shipped', state: 'closed', state_reason: 'completed',
          html_url: `https://github.com/${REPO}/issues/2`, created_at: '2026-01-01T00:00:00Z',
          closed_at: '2026-01-05T00:00:00Z', labels: [], milestone: null,
        },
        {
          number: 3, title: 'Wont do', body: '', state: 'closed', state_reason: 'not_planned',
          html_url: `https://github.com/${REPO}/issues/3`, created_at: '2026-01-01T00:00:00Z',
          closed_at: '2026-01-06T00:00:00Z', labels: [], milestone: null,
        },
      ],
    },
  });
}

function makeProvider() {
  return new GitHubProvider({ client: seededClient(), repo: REPO });
}

// =============================================================================
// Pure state mapping
// =============================================================================

describe('githubStateToCanonical (open/closed → canonical)', () => {
  test('open → unstarted (not started — GitHub has no in-progress signal)', () => {
    assert.deepEqual(githubStateToCanonical({ state: 'open' }), { name: 'Open', type: 'unstarted' });
  });
  test('closed (completed/default) → completed', () => {
    assert.deepEqual(githubStateToCanonical({ state: 'closed', state_reason: 'completed' }), { name: 'Closed', type: 'completed' });
    assert.deepEqual(githubStateToCanonical({ state: 'closed' }).type, 'completed');
  });
  test('closed not_planned → canceled', () => {
    assert.deepEqual(githubStateToCanonical({ state: 'closed', state_reason: 'not_planned' }),
      { name: 'Closed (not planned)', type: 'canceled' });
  });
});

// =============================================================================
// Capability profile
// =============================================================================

describe('GitHubProvider capability profile (LIN-178)', () => {
  const provider = makeProvider();

  test('ui surface has the declared profile', () => {
    assert.deepEqual(provider.ui, {
      write: true,        // getCreateTaskUrl overridden
      comments: true,     // fetchIssueComments implemented
      estimates: false,   // no estimate field
      subtasks: false,    // no hierarchy
      attachments: false, // inherits the base decline — no override (LIN-649)
      displayName: 'GitHub Issues', // relabeled from 'GitHub' (LIN-702)
    });
  });

  test('implements the required reads + writes', () => {
    for (const m of ['createIssue', 'updateIssue', 'createComment', 'addLabel', 'removeLabel',
      'fetchIssueComments', 'fetchIssueFields', 'search', 'states', 'labels',
      'fetchProjects', 'fetchProjectsList', 'fetchTeams', 'fetchIssueContext', 'fetchRecommendationContext']) {
      assert.equal(provider.supports(m), true, `expected supports('${m}')`);
    }
  });

  test('leaves createRelation declined (GitHub has no native typed relations)', () => {
    assert.equal(provider.supports('createRelation'), false);
    assert.throws(() => provider.createRelation(), NotImplementedError);
  });

  test('getCreateTaskUrl returns the repo new-issue URL', () => {
    assert.equal(provider.getCreateTaskUrl('any', 'any'), 'https://github.com/octocat/hello-world/issues/new');
  });
});

describe('GitHubProvider registry', () => {
  test('self-registers under "github" on import', () => {
    assert.equal(getProvider('github'), githubProvider);
    assert.equal(githubProvider.name, 'github');
  });

  test('unconfigured provider throws a clear error', async () => {
    const bare = new GitHubProvider();
    await assert.rejects(() => bare.fetchProjects(REPO), /client not configured/);
  });
});

// =============================================================================
// Reads
// =============================================================================

describe('GitHubProvider reads', () => {
  let provider;
  beforeEach(() => { provider = makeProvider(); });

  test('fetchProjects returns canonical {organizationName, projects, issues}', async () => {
    const { organizationName, projects, issues } = await provider.fetchProjects(REPO);
    assert.equal(organizationName, 'octocat'); // owner is the org analog
    assert.equal(projects.length, 1);
    assert.deepEqual(projects[0], {
      id: '1', name: 'v1.0', content: 'first release',
      url: `https://github.com/${REPO}/milestone/1`, sortOrder: 1,
    });
    assert.equal(issues.length, 3);

    const open = issues.find(i => i.id === '1');
    assert.equal(open.identifier, '#1');
    assert.equal(open.source, 'github');        // provenance stamp (LIN-561)
    assert.deepEqual(open.state, { name: 'Open', type: 'unstarted' });
    assert.deepEqual(open.labels, { nodes: [{ name: 'bug' }] });
    assert.deepEqual(open.project, { id: '1', name: 'v1.0' });
    assert.deepEqual(open.assignee, { name: 'bob' });
    assert.equal(open.parent, null);            // no hierarchy
    assert.deepEqual(open.relations, { nodes: [] }); // no native relations

    assert.equal(issues.find(i => i.id === '2').state.type, 'completed');
    assert.equal(issues.find(i => i.id === '3').state.type, 'canceled');
  });

  test('fetchTeams returns [] (repos are the team analog — A⇄D interaction, not a throw)', async () => {
    assert.deepEqual(await provider.fetchTeams(REPO), []);
  });

  test('fetchIssueFields returns one canonical issue in render shape', async () => {
    const issue = await provider.fetchIssueFields(REPO, '1');
    assert.equal(issue.id, '1');
    assert.equal(issue.title, 'Open bug');
    assert.deepEqual(issue.labels, { nodes: [{ name: 'bug' }] });
    await assert.rejects(() => provider.fetchIssueFields(REPO, '999'), /Issue not found/);
  });

  test('fetchIssueContext returns a flat issue (no parent/children) + comments oldest-first', async () => {
    const ctx = await provider.fetchIssueContext(REPO, '1');
    assert.equal(ctx.issue.identifier, '#1');
    assert.deepEqual(ctx.issue.labels, ['bug']); // flat array contract (LIN-406)
    assert.equal(ctx.parent, null);
    assert.deepEqual(ctx.children, []);
    assert.equal(ctx.project.name, 'v1.0');
    assert.equal(ctx.comments.length, 2);
    assert.deepEqual(ctx.comments.map(c => c.body), ['second', 'first']); // sorted by createdAt
    assert.equal(ctx.comments[0].user, 'carol');
  });

  test('fetchRecommendationContext frames a GitHub issue as a leaf (never a focusedChild)', async () => {
    const ctx = await provider.fetchRecommendationContext(REPO, '1');
    assert.equal(ctx.issue.identifier, '#1');
    assert.equal(ctx.focusedChild, undefined);
  });

  test('search / states / labels', async () => {
    assert.equal((await provider.search(REPO, 'broke')).length, 1);
    assert.deepEqual((await provider.states(REPO)).map(s => s.type), ['unstarted', 'completed']);
    assert.deepEqual(await provider.labels(REPO),
      [{ id: 'bug', name: 'bug', color: 'd73a4a' }, { id: 'enhancement', name: 'enhancement', color: 'a2eeef' }]);
  });
});

// =============================================================================
// Writes
// =============================================================================

describe('GitHubProvider writes', () => {
  let provider;
  beforeEach(() => { provider = makeProvider(); });

  test('createIssue persists and returns canonical shape', async () => {
    const created = await provider.createIssue(REPO, { title: 'New issue', description: 'details', labels: ['bug'] });
    assert.equal(created.title, 'New issue');
    assert.equal(created.state.type, 'unstarted');
    assert.deepEqual(created.labels, { nodes: [{ name: 'bug' }] });
    // Round-trips through a read.
    const back = await provider.fetchIssueFields(REPO, created.id);
    assert.equal(back.title, 'New issue');
  });

  test('updateIssue maps a canonical completed state → closed/completed', async () => {
    const updated = await provider.updateIssue(REPO, '1', { state: { type: 'completed' } });
    assert.equal(updated.state.type, 'completed');
    assert.equal((await provider.fetchIssueFields(REPO, '1')).state.type, 'completed');
    assert.equal(await provider.updateIssue(REPO, '999', { title: 'x' }), null);
  });

  test('updateIssue maps a canonical canceled state → closed/not_planned', async () => {
    const updated = await provider.updateIssue(REPO, '1', { state: { type: 'canceled' } });
    assert.equal(updated.state.type, 'canceled');
  });

  test('updateIssue reopens a closed issue when set to a non-terminal state', async () => {
    const updated = await provider.updateIssue(REPO, '2', { state: { type: 'unstarted' } });
    assert.equal(updated.state.type, 'unstarted');
  });

  test('createComment then fetchIssueComments', async () => {
    const comment = await provider.createComment(REPO, '2', 'hello');
    assert.equal(comment.body, 'hello');
    const comments = await provider.fetchIssueComments(REPO, '2');
    assert.equal(comments.length, 1);
    assert.equal(comments[0].body, 'hello');
    await assert.rejects(() => provider.createComment(REPO, '999', 'x'), /Issue not found/);
  });

  test('addLabel / removeLabel round-trip', async () => {
    assert.equal(await provider.addLabel(REPO, '2', 'enhancement'), true);
    let issue = await provider.fetchIssueFields(REPO, '2');
    assert.deepEqual(issue.labels.nodes, [{ name: 'enhancement' }]);
    await provider.removeLabel(REPO, '2', 'enhancement');
    issue = await provider.fetchIssueFields(REPO, '2');
    assert.deepEqual(issue.labels.nodes, []);
  });
});

// =============================================================================
// Client URL construction — repo-slug encoding (security review M4, LIN-702)
// =============================================================================
//
// The fake client never builds URLs, so these tests drive the REAL
// createGitHubClient with an injected fetch that captures the request URL, to
// pin that `owner/name` is encoded per-segment (the `/` separator survives,
// URL-significant characters in each segment do not break out of the path).

describe('createGitHubClient repo-slug encoding (LIN-702 S3)', () => {
  function captureClient() {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, statusText: 'OK', text: async () => '[]' };
    };
    const client = createGitHubClient({ token: 't', baseUrl: 'https://api.github.com', fetchImpl });
    return { client, calls };
  }

  test('encodes owner and name segments separately, keeping the "/" separator', async () => {
    const { client, calls } = captureClient();
    await client.listIssues('weird owner/repo#name');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0],
      'https://api.github.com/repos/weird%20owner/repo%23name/issues?state=all&per_page=100'
    );
    // The separator is a literal slash, never %2F (which would 404).
    assert.ok(!calls[0].includes('%2F'));
  });

  test('a normal slug is unchanged (no double-encoding of safe characters)', async () => {
    const { client, calls } = captureClient();
    await client.getIssue('octocat/hello-world', 7);
    assert.equal(calls[0], 'https://api.github.com/repos/octocat/hello-world/issues/7');
  });

  test('encoding covers every repo-scoped path (create/update/comment/labels)', async () => {
    const { client, calls } = captureClient();
    const slug = 'a b/c d';
    await client.createIssue(slug, { title: 'x' });
    await client.updateIssue(slug, 3, { state: 'closed' });
    await client.createComment(slug, 3, 'hi');
    await client.addLabel(slug, 3, 'bug');
    await client.removeLabel(slug, 3, 'bug');
    for (const url of calls) {
      assert.ok(url.includes('/repos/a%20b/c%20d/'), `expected encoded slug in ${url}`);
      assert.ok(!url.includes('/repos/a b/'), `raw slug leaked into ${url}`);
    }
  });
});
