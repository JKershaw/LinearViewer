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
import crypto from 'node:crypto';
import {
  GitHubProvider,
  githubProvider,
  githubStateToCanonical,
  githubStateIdToCanonicalType,
} from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';
import { createGitHubClient } from '../../lib/providers/github/client.js';
import { getProvider } from '../../lib/providers/registry.js';
import { NotImplementedError } from '../../lib/providers/interface.js';

const REPO = 'octocat/hello-world';

// One ephemeral RSA keypair so refreshCredential's App JWT can be signed offline
// (mirrors github-app-auth.test.js). Generated, never written to disk.
function cryptoGenerateRsa() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }) };
}

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
      inlineCreate: true, // supports('createIssue') (LIN-1552)
      inlineEdit: true,   // supports('updateIssue') (LIN-1552)
      estimates: false,   // no estimate field
      subtasks: false,    // no hierarchy
      attachments: true,  // issue/comment bodies carry user-content uploads (LIN-771)
      priority: true,     // abstract default, not overridden (LIN-1886)
      displayName: 'GitHub Issues', // relabeled from 'GitHub' (LIN-702)
      fixedStates: [      // LIN-2361: GITHUB_STATES, safe to surface synchronously (a fixed static array)
        { id: 'open', name: 'Open', type: 'unstarted', position: 0 },
        { id: 'closed', name: 'Closed', type: 'completed', position: 1 },
      ],
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
    // The repo binding itself is always emitted as a container (LIN-718),
    // sorted first (sortOrder 0), with milestones following.
    assert.equal(projects.length, 2);
    assert.deepEqual(projects[0], {
      id: REPO, name: REPO, content: null,
      url: `https://github.com/${REPO}`, sortOrder: 0,
    });
    assert.deepEqual(projects[1], {
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

  test('fetchProjects emits the repo container even for a zero-issue, zero-milestone repo (LIN-718)', async () => {
    const EMPTY = 'octocat/empty-repo';
    const emptyProvider = new GitHubProvider({ client: createFakeGitHubClient({ [EMPTY]: { milestones: [], issues: [], labels: [] } }) });
    const { projects, issues } = await emptyProvider.fetchProjects(EMPTY);
    assert.equal(issues.length, 0);
    // Exactly one container — the repo binding itself — so the tree renders an
    // empty GitHub Issues container instead of nothing at all.
    assert.equal(projects.length, 1);
    assert.deepEqual(projects[0], {
      id: EMPTY, name: EMPTY, content: null,
      url: `https://github.com/${EMPTY}`, sortOrder: 0,
    });
  });

  test('fetchProjects: milestone-less issues keep project:null (No-Project grouping unchanged by LIN-718)', async () => {
    const { issues } = await provider.fetchProjects(REPO);
    // The repo container is empty: no issue is re-parented onto it. Milestone-less
    // issues (#2, #3) still carry project:null, so they stay in the synthetic
    // 'No Project' group — the re-parenting decision is deferred (open question).
    assert.equal(issues.find(i => i.id === '2').project, null);
    assert.equal(issues.find(i => i.id === '3').project, null);
    assert.deepEqual(issues.find(i => i.id === '1').project, { id: '1', name: 'v1.0' });
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
// Per-request client from a binding credential (LIN-713)
// =============================================================================
//
// Production NEVER configures the boot `client` (server.js wires only the local
// provider). A GitHub App workspace authenticates per-request: the read/write
// seam passes a `{ repo, token }` binding credential, and the provider builds a
// request-time client from the installation token via `_clientForToken`
// (createGitHubClient) while keeping the repo slug as the per-call argument.
//
// `_clientForToken` would build the REAL HTTP client (network), so we override it
// to capture the token and return the in-memory fake keyed by repo — the same
// fake the boot-client tests use. This proves the credential path (a) needs no
// boot client, (b) authenticates with the credential's token, and (c) routes the
// repo from the credential, not from boot config.
describe('GitHubProvider per-request client from binding credential (LIN-713)', () => {
  // A provider with NO boot client; _clientForToken is stubbed to record the
  // token it was handed and hand back the seeded fake.
  function makeAppProvider() {
    const provider = new GitHubProvider(); // no boot client — like production
    const fake = seededClient();
    const tokensSeen = [];
    provider._clientForToken = (token) => {
      tokensSeen.push(token);
      return fake;
    };
    return { provider, tokensSeen };
  }

  test('fetchProjects works WITHOUT a boot client, building the client from the credential token', async () => {
    const { provider, tokensSeen } = makeAppProvider();
    const { organizationName, projects, issues } =
      await provider.fetchProjects({ repo: REPO, token: 'ghs_install_token' });
    assert.equal(organizationName, 'octocat');
    assert.equal(projects.length, 2); // repo container (LIN-718) + 1 milestone
    assert.equal(issues.length, 3);
    // Built the per-request client from the installation token (never the boot client).
    assert.deepEqual(tokensSeen, ['ghs_install_token']);
  });

  test('fetchIssueFields routes the repo from the credential, not boot config', async () => {
    const { provider, tokensSeen } = makeAppProvider();
    const issue = await provider.fetchIssueFields({ repo: REPO, token: 'tok' }, '1');
    assert.equal(issue.identifier, '#1');
    assert.equal(issue.title, 'Open bug');
    assert.deepEqual(tokensSeen, ['tok']);
  });

  test('fetchIssueContext nests fetchIssueComments through the SAME credential', async () => {
    const { provider, tokensSeen } = makeAppProvider();
    const ctx = await provider.fetchIssueContext({ repo: REPO, token: 'tok' }, '1');
    // Two comments returned oldest-first → proves the nested comments read also
    // authenticated through the credential (not a boot client).
    assert.equal(ctx.comments.length, 2);
    assert.deepEqual(ctx.comments.map(c => c.body), ['second', 'first']);
    // One token use per client build (context read + nested comments read).
    assert.deepEqual(tokensSeen, ['tok', 'tok']);
  });

  test('a write (createIssue) round-trips through the per-request client', async () => {
    const { provider, tokensSeen } = makeAppProvider();
    const created = await provider.createIssue({ repo: REPO, token: 'tok' }, { title: 'From App', description: 'body' });
    assert.equal(created.title, 'From App');
    // Read it back through the same credential path.
    const back = await provider.fetchIssueFields({ repo: REPO, token: 'tok' }, created.id);
    assert.equal(back.title, 'From App');
    assert.deepEqual(tokensSeen, ['tok', 'tok']);
  });

  test('search/labels also build from the credential token', async () => {
    const { provider, tokensSeen } = makeAppProvider();
    const labels = await provider.labels({ repo: REPO, token: 'tok' });
    assert.ok(labels.some(l => l.name === 'bug'));
    await provider.search({ repo: REPO, token: 'tok' }, 'bug');
    assert.deepEqual(tokensSeen, ['tok', 'tok']);
  });

  test('a credential missing its token is a hard error (no silent boot-client fallback)', async () => {
    const { provider } = makeAppProvider();
    await assert.rejects(
      () => provider.fetchProjects({ repo: REPO }),
      /missing an installation token/
    );
  });

  test('the bare-string (boot client) path is unchanged — still requires configure({ client })', async () => {
    const bare = new GitHubProvider();
    await assert.rejects(() => bare.fetchProjects(REPO), /client not configured/);
  });
});

// =============================================================================
// Write-path guard reads + the label RMW primitive (LIN-1559)
// =============================================================================
//
// The four route-internal reads the proxy/session-auth write routes call
// unconditionally. They are NOT capabilities (`supports()` stays false — the
// declaration question is LIN-1557's), so nothing else pins their existence:
// these tests are what keeps a GitHub-backed write route off the 500 it used to
// answer. Each is exercised through BOTH `_clientFor` scope shapes, because the
// shape production uses (a `{ repo, token }` binding credential) is not the one
// the rest of this file's boot-client tests use.

describe('GitHubProvider write-path guard reads (LIN-1559)', () => {
  let provider;
  beforeEach(() => { provider = makeProvider(); });

  // --- issueWriteGuard ------------------------------------------------------

  test('issueWriteGuard returns the trashed probe with a NON-NULL team.id', async () => {
    const guard = await provider.issueWriteGuard(REPO, '1');
    // team.id is load-bearing: the routes hand it to resolveStateInput, which
    // 422s "the issue's team could not be determined" on a null. GitHub's
    // states() ignores teamId, so the repo slug is a stable local placeholder.
    assert.deepEqual(guard, { id: '1', trashed: false, team: { id: REPO } });
    assert.notEqual(guard.team.id, null);
  });

  test('issueWriteGuard reports trashed:false — GitHub Issues has no soft-delete', async () => {
    // Constant by design (mirroring LocalProvider), so the routes' 409 branch is
    // dead-but-correct here rather than absent.
    for (const n of ['1', '2', '3']) {
      assert.equal((await provider.issueWriteGuard(REPO, n)).trashed, false);
    }
  });

  test('issueWriteGuard returns null for a missing issue (the routes 404 on it)', async () => {
    assert.equal(await provider.issueWriteGuard(REPO, '999'), null);
  });

  // --- issueDescription -----------------------------------------------------

  test('issueDescription returns { id, description, trashed }', async () => {
    assert.deepEqual(await provider.issueDescription(REPO, '1'),
      { id: '1', description: 'something broke', trashed: false });
  });

  test('issueDescription floors an absent body at the empty string, never null', async () => {
    // The routes do `merge(issue.description || '')`, but a null here would also
    // read as "no description" to any future caller — '' is the honest shape.
    const created = await provider.createIssue(REPO, { title: 'no body' });
    const read = await provider.issueDescription(REPO, created.id);
    assert.equal(read.description, '');
  });

  test('issueDescription returns null for a missing issue', async () => {
    assert.equal(await provider.issueDescription(REPO, '999'), null);
  });

  // --- issueLabels ----------------------------------------------------------

  test('issueLabels returns name-keyed { id, name } nodes matching labels()', async () => {
    // id === name is what makes the routes' `currentLabelIds.includes(resolved)`
    // comparison meaningful: resolveLabelInput resolves against labels(), which
    // also keys id by name.
    assert.deepEqual(await provider.issueLabels(REPO, '1'), {
      id: '1', trashed: false, labels: { nodes: [{ id: 'bug', name: 'bug' }] },
    });
    const fromLabels = await provider.labels(REPO);
    assert.ok(fromLabels.some(l => l.id === 'bug'), 'labels() must key id by name too');
  });

  test('issueLabels returns an empty node list for an unlabelled issue', async () => {
    const read = await provider.issueLabels(REPO, '2');
    assert.deepEqual(read.labels.nodes, []);
  });

  test('issueLabels returns null for a missing issue', async () => {
    assert.equal(await provider.issueLabels(REPO, '999'), null);
  });

  // --- updateIssueLabels (the diff) -----------------------------------------

  test('updateIssueLabels ADDS the labels missing from the current set', async () => {
    const result = await provider.updateIssueLabels(REPO, '1', ['bug', 'enhancement']);
    assert.equal(result.success, true);
    assert.deepEqual(result.issue.labels.nodes.map(l => l.name).sort(), ['bug', 'enhancement']);
    // Re-read proves it persisted, not just echoed.
    const back = await provider.issueLabels(REPO, '1');
    assert.deepEqual(back.labels.nodes.map(l => l.name).sort(), ['bug', 'enhancement']);
  });

  test('updateIssueLabels REMOVES labels absent from the requested set', async () => {
    const result = await provider.updateIssueLabels(REPO, '1', []);
    assert.equal(result.success, true);
    assert.deepEqual(result.issue.labels.nodes, []);
    assert.deepEqual((await provider.issueLabels(REPO, '1')).labels.nodes, []);
  });

  test('updateIssueLabels handles a mixed add+remove in one call', async () => {
    const result = await provider.updateIssueLabels(REPO, '1', ['enhancement']);
    assert.deepEqual(result.issue.labels.nodes.map(l => l.name), ['enhancement']);
  });

  test('updateIssueLabels is a genuine no-op for an unchanged set (zero write calls)', async () => {
    // The diff must cost nothing when nothing changed — one REST call per CHANGED
    // label is the whole point of the diff over a whole-set PATCH.
    const client = provider.client;
    let writes = 0;
    const count = (fn) => (...args) => { writes++; return fn(...args); };
    client.addLabel = count(client.addLabel);
    client.removeLabel = count(client.removeLabel);

    const result = await provider.updateIssueLabels(REPO, '1', ['bug']);
    assert.equal(result.success, true);
    assert.equal(writes, 0, 'an unchanged label set must issue no add/remove calls');
    assert.deepEqual(result.issue.labels.nodes.map(l => l.name), ['bug']);
  });

  test('updateIssueLabels returns the issueUpdate envelope shape the routes echo', async () => {
    // The routes call writeRejected (needs success === true) then
    // flattenIssue(issueUpdate.issue) — so `issue` must be a canonical issue.
    const result = await provider.updateIssueLabels(REPO, '2', ['bug']);
    assert.deepEqual(Object.keys(result).sort(), ['issue', 'success']);
    assert.equal(result.issue.identifier, '#2');
    assert.ok(result.issue.labels.nodes, 'issue must carry the nested labels shape');
  });

  test('updateIssueLabels on a missing issue → { success: false } (never a throw)', async () => {
    assert.deepEqual(await provider.updateIssueLabels(REPO, '999', ['bug']), { success: false, issue: null });
  });

  // --- both scope shapes ----------------------------------------------------

  test('all four reads work through a { repo, token } binding credential', async () => {
    // Production's shape (LIN-713): no boot client at all, the installation token
    // builds the request-time client. A read that only worked through the bare
    // slug would be dead in production.
    const app = new GitHubProvider();
    const fake = seededClient();
    const tokensSeen = [];
    app._clientForToken = (token) => { tokensSeen.push(token); return fake; };
    const cred = { repo: REPO, token: 'ghs_install_token' };

    const guard = await app.issueWriteGuard(cred, '1');
    assert.deepEqual(guard, { id: '1', trashed: false, team: { id: REPO } });
    assert.equal((await app.issueDescription(cred, '1')).description, 'something broke');
    assert.deepEqual((await app.issueLabels(cred, '1')).labels.nodes, [{ id: 'bug', name: 'bug' }]);
    const updated = await app.updateIssueLabels(cred, '1', ['enhancement']);
    assert.deepEqual(updated.issue.labels.nodes.map(l => l.name), ['enhancement']);

    // Every call authenticated with the credential's token, never a boot client.
    assert.ok(tokensSeen.length >= 4);
    assert.ok(tokensSeen.every(t => t === 'ghs_install_token'));
  });

  test('the reads stay OFF the declared capability surface (LIN-1557 owns that)', () => {
    // This ticket implements them; it does NOT declare them. Mirrors the Linear
    // pin in linear-provider-api.test.js and is why the route backstop keys on
    // method existence rather than supports().
    for (const m of ['issueWriteGuard', 'issueDescription', 'issueLabels', 'updateIssueLabels']) {
      assert.equal(provider.supports(m), false, `${m} must not be declared`);
      assert.equal(typeof provider[m], 'function', `${m} must be implemented`);
    }
  });
});

// =============================================================================
// stateId → canonical state.type (LIN-1559 / LIN-1569)
// =============================================================================
//
// Both PATCH routes resolve a symbolic state against states() and then pass the
// provider its OWN state id as `input.stateId`. updateIssue only ever read
// `patch.state.type`, so every stateId write was dropped — a 200 whose issue
// never moved. Once the guard reads landed, that turned the old loud 500 into a
// silent lie, which is why this ships in the same change.

describe('GitHubProvider stateId mapping (LIN-1559 / LIN-1569)', () => {
  let provider;
  beforeEach(() => { provider = makeProvider(); });

  test('githubStateIdToCanonicalType maps the ids states() emits', () => {
    assert.equal(githubStateIdToCanonicalType('open'), 'unstarted');
    assert.equal(githubStateIdToCanonicalType('closed'), 'completed');
  });

  test('githubStateIdToCanonicalType throws a 422-shaped error on an unknown id', () => {
    // 422, not a bare throw: a UUID reaches here only because the routes' UUID
    // fast-path skipped states(), so it is a CALLER error and must not become a
    // 500. RefResolutionError is what both route mappers already turn into 422.
    try {
      githubStateIdToCanonicalType('11111111-1111-1111-1111-111111111111');
      assert.fail('expected a throw');
    } catch (err) {
      assert.equal(err.name, 'RefResolutionError');
      assert.equal(err.status, 422);
      assert.match(err.message, /Cannot resolve state/);
      assert.deepEqual(err.candidates, ['open', 'closed']);
    }
  });

  test('updateIssue applies stateId:"closed" — the issue actually closes', async () => {
    const updated = await provider.updateIssue(REPO, '1', { stateId: 'closed' });
    assert.equal(updated.state.type, 'completed');
    assert.equal((await provider.fetchIssueFields(REPO, '1')).state.type, 'completed');
  });

  test('updateIssue applies stateId:"open" — reopens a closed issue', async () => {
    const updated = await provider.updateIssue(REPO, '2', { stateId: 'open' });
    assert.equal(updated.state.type, 'unstarted');
    assert.equal((await provider.fetchIssueFields(REPO, '2')).state.type, 'unstarted');
  });

  test('updateIssue applies stateId alongside other fields in one patch', async () => {
    const updated = await provider.updateIssue(REPO, '1', { title: 'Both', stateId: 'closed' });
    assert.equal(updated.title, 'Both');
    assert.equal(updated.state.type, 'completed');
  });

  test('updateIssue throws on an unknown stateId rather than dropping the patch', async () => {
    await assert.rejects(
      () => provider.updateIssue(REPO, '1', { stateId: 'in-progress' }),
      /Cannot resolve state/
    );
    // And nothing was written — no half-applied patch reported as a success.
    assert.equal((await provider.fetchIssueFields(REPO, '1')).state.type, 'unstarted');
  });

  test('an unknown stateId still throws when a valid canonical state is also present', async () => {
    // Fail loud on the part it cannot honour, rather than quietly honouring the
    // other half and reporting a full success.
    await assert.rejects(
      () => provider.updateIssue(REPO, '1', { state: { type: 'completed' }, stateId: 'nonsense' }),
      /Cannot resolve state/
    );
  });

  test('an explicit canonical state still wins over stateId (existing path unchanged)', async () => {
    const updated = await provider.updateIssue(REPO, '1', { state: { type: 'canceled' }, stateId: 'open' });
    assert.equal(updated.state.type, 'canceled');
  });

  test('a patch with no state at all touches neither state nor state_reason', async () => {
    const updated = await provider.updateIssue(REPO, '2', { title: 'Title only' });
    assert.equal(updated.title, 'Title only');
    assert.equal(updated.state.type, 'completed', 'the pre-existing closed state must survive');
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

// ---------------------------------------------------------------------------
// listRepos → installation repositories (LIN-710, GH App migration surface 4)
//
// listRepos must read the App installation's granted repos
// (GET /installation/repositories with the installation token), NOT the OAuth
// `/user/repos` listing, and unwrap GitHub's `{ total_count, repositories }`
// envelope back to a bare array so the provider mapping is unchanged.
// ---------------------------------------------------------------------------

describe('createGitHubClient listRepos → installation repositories (LIN-710)', () => {
  test('hits /installation/repositories with the installation token and unwraps the envelope', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, headers: opts?.headers || {} });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({
          total_count: 2,
          repositories: [
            { full_name: 'octocat/hello-world', private: false },
            { full_name: 'octocat/secret', private: true },
          ],
        }),
      };
    };
    const client = createGitHubClient({ token: 'ghs_install_token', baseUrl: 'https://api.github.com', fetchImpl });

    const repos = await client.listRepos();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/installation/repositories?per_page=100');
    assert.ok(!calls[0].url.includes('/user/repos'), 'must not use the legacy OAuth /user/repos endpoint');
    // The installation token the client was built with rides every request.
    assert.equal(calls[0].headers.Authorization, 'Bearer ghs_install_token');
    // Envelope is unwrapped to a bare array (same shape the provider/fake expect).
    assert.deepEqual(repos, [
      { full_name: 'octocat/hello-world', private: false },
      { full_name: 'octocat/secret', private: true },
    ]);
  });

  test('tolerates a missing repositories field (returns an empty array)', async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ total_count: 0 }),
    });
    const client = createGitHubClient({ token: 't', baseUrl: 'https://api.github.com', fetchImpl });
    assert.deepEqual(await client.listRepos(), []);
  });
});

// ---------------------------------------------------------------------------
// refreshCredential — provider-aware re-mint seam (LIN-712, surface 6)
// ---------------------------------------------------------------------------
// GitHub App installation tokens carry NO refresh_token; they are RE-MINTED from
// the App JWT + installationId. These pin the credentials PATCH shape the refresh
// middleware folds back through linkProvider. Env is set so mintAppJwt can sign;
// the network is stubbed via the injected fetchImpl (no fake-client change).
describe('GitHubProvider refreshCredential re-mint (LIN-712)', () => {
  const APP_ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
  const { privateKey } = cryptoGenerateRsa();
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(APP_ENV.map(k => [k, process.env[k]]));
    process.env.GITHUB_APP_ID = '123456';
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
    process.env.GITHUB_APP_SLUG = 'my-app';
  });

  const restore = () => {
    for (const k of APP_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };

  test('re-mints from installationId and returns a {token, ms-expiry, installationId} patch', async () => {
    try {
      const calls = [];
      const fetchImpl = async (url, opts) => {
        calls.push({ url, headers: opts?.headers || {}, method: opts?.method });
        return {
          ok: true, status: 201, statusText: 'Created',
          text: async () => JSON.stringify({ token: 'ghs_fresh_token', expires_at: '2026-06-25T13:00:00Z' }),
        };
      };

      const patch = await githubProvider.refreshCredential(
        { provider: 'github', scope: 'octocat/hello-world', credentials: { installationId: '987', token: 'ghs_old', tokenExpiresAt: 1 } },
        { fetchImpl }
      );

      // The mint hits the installation access-tokens endpoint with the App JWT.
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.github.com/app/installations/987/access_tokens');
      assert.equal(calls[0].method, 'POST');
      assert.match(calls[0].headers.Authorization, /^Bearer /);

      // Patch shape: rotated token, REAL ms-epoch expiry (not the raw ISO string,
      // not MAX), installationId preserved as the re-mint key. No refreshToken —
      // emitting one would route the binding back through the Linear refresh path.
      assert.equal(patch.token, 'ghs_fresh_token');
      assert.equal(patch.tokenExpiresAt, Date.parse('2026-06-25T13:00:00Z'));
      assert.equal(typeof patch.tokenExpiresAt, 'number');
      assert.equal(patch.installationId, '987');
      assert.ok(!('refreshToken' in patch), 'GitHub re-mint must not emit a refreshToken');
    } finally {
      restore();
    }
  });

  test('throws when the binding is missing installationId (cannot re-mint)', async () => {
    try {
      await assert.rejects(
        () => githubProvider.refreshCredential({ provider: 'github', scope: 'octocat/x', credentials: { token: 'ghs_old' } }),
        /installationId/
      );
    } finally {
      restore();
    }
  });

  test('throws on an unparseable installation-token expiry (no silent never-expires)', async () => {
    try {
      const fetchImpl = async () => ({
        ok: true, status: 201, statusText: 'Created',
        text: async () => JSON.stringify({ token: 'ghs_fresh', expires_at: 'not-a-date' }),
      });
      await assert.rejects(
        () => githubProvider.refreshCredential({ credentials: { installationId: '987' } }, { fetchImpl }),
        /invalid installation token expiry/
      );
    } finally {
      restore();
    }
  });
});
