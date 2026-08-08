/**
 * Unit tests for lib/providers/github-projects/index.js (LIN-560).
 *
 * GitHub Projects v2 is a SIBLING to the GitHub Issues provider — a board-shaped
 * GraphQL backend with user-defined Status columns. These tests pin:
 *   - the pure Status-name → canonical state heuristic (+ unstarted fallback);
 *   - the V1 read-only capability profile (method capabilities + ui surface);
 *   - module-load self-registration under 'github-projects';
 *   - reads returning the canonical shape the dashboard/tree consume, driven
 *     through the in-memory fake GraphQL client (no network, no auth);
 *   - the A⇄D interaction (fetchTeams → [] rather than a throw);
 *   - the per-request client built from a { token, scope } binding credential;
 *   - the real client's GraphQL wire (captured-fetch: query, union unwrap, owner
 *     fallback) — the part the fake never exercises.
 *
 * Run with: node --test tests/unit/github-projects-provider.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  GitHubProjectsProvider,
  githubProjectsProvider,
  githubProjectStatusToCanonical,
} from '../../lib/providers/github-projects/index.js';
import { createFakeGitHubProjectsClient } from '../../lib/providers/github-projects/fake-client.js';
import { createGitHubProjectsClient } from '../../lib/providers/github-projects/client.js';
import { getProvider } from '../../lib/providers/registry.js';
import { NotImplementedError } from '../../lib/providers/interface.js';

const BOARD = 'octocat/5';

function seededClient() {
  return createFakeGitHubProjectsClient({
    [BOARD]: {
      project: { id: 'PVT_1', number: 5, title: 'Roadmap', url: 'https://github.com/orgs/octocat/projects/5', shortDescription: 'the board' },
      items: [
        {
          id: 'PVTI_1', type: 'ISSUE', status: 'In Progress',
          content: {
            number: 1, title: 'Doing this', body: 'in flight', url: 'https://github.com/octocat/hello-world/issues/1',
            createdAt: '2026-01-01T00:00:00Z', closedAt: null, author: 'alice', assignees: ['bob'], labels: ['bug'],
          },
        },
        {
          id: 'PVTI_2', type: 'ISSUE', status: 'Done',
          content: {
            number: 2, title: 'Shipped', body: 'done', url: 'https://github.com/octocat/hello-world/issues/2',
            createdAt: '2026-01-01T00:00:00Z', closedAt: '2026-01-05T00:00:00Z', author: 'alice', assignees: [], labels: [],
          },
        },
        {
          id: 'PVTI_3', type: 'DRAFT_ISSUE', status: null,
          content: {
            number: null, title: 'Just an idea', body: '', url: null,
            createdAt: '2026-01-02T00:00:00Z', closedAt: null, author: null, assignees: [], labels: [],
          },
        },
      ],
    },
  });
}

function makeProvider() {
  return new GitHubProjectsProvider({ client: seededClient() });
}

// =============================================================================
// Pure status heuristic
// =============================================================================

describe('githubProjectStatusToCanonical (Status column → canonical)', () => {
  test('recognized column names map to canonical types, keeping the label', () => {
    assert.deepEqual(githubProjectStatusToCanonical('Backlog'), { name: 'Backlog', type: 'backlog' });
    assert.deepEqual(githubProjectStatusToCanonical('Todo'), { name: 'Todo', type: 'unstarted' });
    assert.deepEqual(githubProjectStatusToCanonical('In Progress'), { name: 'In Progress', type: 'started' });
    assert.deepEqual(githubProjectStatusToCanonical('In Review'), { name: 'In Review', type: 'started' });
    assert.deepEqual(githubProjectStatusToCanonical('Done'), { name: 'Done', type: 'completed' });
    assert.deepEqual(githubProjectStatusToCanonical("Won't Do"), { name: "Won't Do", type: 'canceled' });
  });

  test('matching is case/whitespace-insensitive', () => {
    assert.equal(githubProjectStatusToCanonical('  in progress  ').type, 'started');
    assert.equal(githubProjectStatusToCanonical('DONE').type, 'completed');
  });

  test('an unrecognized column keeps its label but defaults the type to unstarted', () => {
    assert.deepEqual(githubProjectStatusToCanonical('Needs Design'), { name: 'Needs Design', type: 'unstarted' });
  });

  test('a null/empty Status (no column) falls back to unstarted', () => {
    assert.deepEqual(githubProjectStatusToCanonical(null), { name: 'No status', type: 'unstarted' });
    assert.deepEqual(githubProjectStatusToCanonical(''), { name: 'No status', type: 'unstarted' });
    assert.deepEqual(githubProjectStatusToCanonical(undefined), { name: 'No status', type: 'unstarted' });
  });
});

// =============================================================================
// Capability profile (V1 = read-only)
// =============================================================================

describe('GitHubProjectsProvider capability profile (LIN-560)', () => {
  const provider = makeProvider();

  test('ui surface declares an honest read-only profile', () => {
    assert.deepEqual(provider.ui, {
      write: false,       // getCreateTaskUrl NOT overridden
      comments: false,    // fetchIssueComments NOT implemented
      inlineCreate: false, // supports('createIssue') false — read-only V1 (LIN-1552)
      inlineEdit: false,   // supports('updateIssue') false — read-only V1 (LIN-1552)
      estimates: false,   // no estimate mapping in V1
      subtasks: false,    // no item hierarchy
      attachments: true,  // item body (issue/PR) carries user-content uploads (LIN-771)
      priority: true,     // abstract default, not overridden (LIN-1886)
      displayName: 'GitHub Projects',
    });
  });

  test('implements the V1 read surface', () => {
    for (const m of ['fetchProjects', 'fetchProjectsList', 'fetchTeams',
      'fetchIssueFields', 'fetchIssueContext', 'fetchRecommendationContext']) {
      assert.equal(provider.supports(m), true, `expected supports('${m}')`);
    }
  });

  test('declines write + comment + relation methods (V1 read-only)', () => {
    for (const m of ['createIssue', 'updateIssue', 'createComment', 'addLabel',
      'removeLabel', 'fetchIssueComments', 'createRelation']) {
      assert.equal(provider.supports(m), false, `expected NOT supports('${m}')`);
    }
    assert.throws(() => provider.createIssue(), NotImplementedError);
    assert.throws(() => provider.createComment(), NotImplementedError);
  });
});

describe('GitHubProjectsProvider registry', () => {
  test('self-registers under "github-projects" on import', () => {
    assert.equal(getProvider('github-projects'), githubProjectsProvider);
    assert.equal(githubProjectsProvider.name, 'github-projects');
  });

  test('is distinct from the GitHub Issues provider (additive sibling)', () => {
    assert.notEqual(getProvider('github-projects'), getProvider('github'));
  });

  test('unconfigured provider throws a clear error', async () => {
    const bare = new GitHubProjectsProvider();
    await assert.rejects(() => bare.fetchProjects(BOARD), /client not configured/);
  });
});

// =============================================================================
// Reads
// =============================================================================

describe('GitHubProjectsProvider reads', () => {
  let provider;
  beforeEach(() => { provider = makeProvider(); });

  test('fetchProjects returns canonical {organizationName, projects, issues}', async () => {
    const { organizationName, projects, issues } = await provider.fetchProjects(BOARD);
    assert.equal(organizationName, 'octocat'); // board owner login

    // Exactly ONE container — the board itself — named by the board title.
    assert.equal(projects.length, 1);
    assert.deepEqual(projects[0], {
      id: BOARD, name: 'Roadmap', content: 'the board',
      url: 'https://github.com/orgs/octocat/projects/5', sortOrder: 0,
    });

    assert.equal(issues.length, 3);
    const doing = issues.find(i => i.id === 'PVTI_1');
    assert.equal(doing.identifier, '#1');
    assert.equal(doing.source, 'github-projects'); // provenance stamp (LIN-561)
    assert.deepEqual(doing.state, { name: 'In Progress', type: 'started' });
    assert.deepEqual(doing.labels, { nodes: [{ name: 'bug' }] });
    assert.deepEqual(doing.assignee, { name: 'bob' });
    assert.equal(doing.parent, null);            // no hierarchy
    assert.deepEqual(doing.relations, { nodes: [] }); // no native relations
    // Every item parents to the single board container.
    assert.deepEqual(doing.project, { id: BOARD, name: 'Roadmap' });

    assert.equal(issues.find(i => i.id === 'PVTI_2').state.type, 'completed');
  });

  test('a draft item maps to a canonical issue (node id, draft identifier, no url)', async () => {
    const { issues } = await provider.fetchProjects(BOARD);
    const draft = issues.find(i => i.id === 'PVTI_3');
    assert.equal(draft.identifier, 'draft'); // drafts have no number
    assert.equal(draft.url, null);
    assert.equal(draft.title, 'Just an idea');
    assert.equal(draft.state.type, 'unstarted'); // null Status → fallback
  });

  test('fetchProjectsList returns just the board container', async () => {
    const list = await provider.fetchProjectsList(BOARD);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, BOARD);
    assert.equal(list[0].name, 'Roadmap');
  });

  test('fetchTeams returns [] (a board is not team-partitioned — A⇄D, not a throw)', async () => {
    assert.deepEqual(await provider.fetchTeams(BOARD), []);
  });

  test('fetchIssueFields looks an item up by its node id', async () => {
    const issue = await provider.fetchIssueFields(BOARD, 'PVTI_1');
    assert.equal(issue.id, 'PVTI_1');
    assert.equal(issue.title, 'Doing this');
    assert.deepEqual(issue.labels, { nodes: [{ name: 'bug' }] });
    await assert.rejects(() => provider.fetchIssueFields(BOARD, 'PVTI_nope'), /Issue not found/);
  });

  test('fetchIssueContext returns a flat issue (no parent/children, no comments)', async () => {
    const ctx = await provider.fetchIssueContext(BOARD, 'PVTI_1');
    assert.equal(ctx.issue.identifier, '#1');
    assert.deepEqual(ctx.issue.labels, ['bug']); // flat array contract (LIN-406)
    assert.equal(ctx.parent, null);
    assert.deepEqual(ctx.children, []);
    assert.equal(ctx.project.name, 'Roadmap');
    assert.deepEqual(ctx.comments, []); // V1 read-only: comments not surfaced
  });

  test('fetchRecommendationContext frames a board item as a leaf (never a focusedChild)', async () => {
    const ctx = await provider.fetchRecommendationContext(BOARD, 'PVTI_1');
    assert.equal(ctx.issue.identifier, '#1');
    assert.equal(ctx.focusedChild, undefined);
  });

  test('an empty / missing board still emits its container (no items)', async () => {
    const emptyProvider = new GitHubProjectsProvider({
      client: createFakeGitHubProjectsClient({ 'octocat/9': { project: { id: 'PVT_9', number: 9, title: 'Empty' }, items: [] } }),
    });
    const { projects, issues } = await emptyProvider.fetchProjects('octocat/9');
    assert.equal(issues.length, 0);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].id, 'octocat/9');
  });
});

// =============================================================================
// Per-request client from a binding credential
// =============================================================================
//
// Production NEVER configures the boot `client`. A GitHub App workspace
// authenticates per-request: the read seam passes a `{ token, scope }` binding
// credential and the provider builds a request-time client from the installation
// token via `_clientForToken`. We stub that to capture the token and return the
// seeded fake — proving the credential path (a) needs no boot client, (b)
// authenticates with the credential's token, and (c) routes the board from the
// credential, not boot config.
describe('GitHubProjectsProvider per-request client from binding credential', () => {
  function makeAppProvider() {
    const provider = new GitHubProjectsProvider(); // no boot client — like production
    const fake = seededClient();
    const tokensSeen = [];
    provider._clientForToken = (token) => {
      tokensSeen.push(token);
      return fake;
    };
    return { provider, tokensSeen };
  }

  test('fetchProjects works WITHOUT a boot client, building from the credential token', async () => {
    const { provider, tokensSeen } = makeAppProvider();
    const { organizationName, projects, issues } =
      await provider.fetchProjects({ scope: BOARD, token: 'ghs_install_token' });
    assert.equal(organizationName, 'octocat');
    assert.equal(projects.length, 1);
    assert.equal(issues.length, 3);
    assert.deepEqual(tokensSeen, ['ghs_install_token']);
  });

  test('fetchIssueFields routes the board from the credential, not boot config', async () => {
    const { provider, tokensSeen } = makeAppProvider();
    const issue = await provider.fetchIssueFields({ scope: BOARD, token: 'tok' }, 'PVTI_1');
    assert.equal(issue.identifier, '#1');
    assert.deepEqual(tokensSeen, ['tok']);
  });

  test('a credential missing its token is a hard error (no silent boot-client fallback)', async () => {
    const { provider } = makeAppProvider();
    await assert.rejects(
      () => provider.fetchProjects({ scope: BOARD }),
      /missing an installation token/
    );
  });
});

// =============================================================================
// Real GraphQL client wire — captured fetch (the fake never builds queries)
// =============================================================================

describe('createGitHubProjectsClient GraphQL wire (LIN-560)', () => {
  function captureClient(responder) {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts, body: JSON.parse(opts.body) });
      const payload = responder(calls.length);
      return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(payload) };
    };
    const client = createGitHubProjectsClient({ token: 'ghs_tok', fetchImpl });
    return { client, calls };
  }

  test('POSTs a GraphQL query with {login, number} and the bearer token; unwraps the org board', async () => {
    const { client, calls } = captureClient(() => ({
      data: {
        organization: {
          projectV2: {
            id: 'PVT_1', number: 5, title: 'Roadmap', url: 'u', shortDescription: 'd',
            items: { nodes: [
              {
                id: 'PVTI_1', type: 'ISSUE', fieldValueByName: { name: 'In Progress' },
                content: {
                  number: 7, title: 'wired', body: 'b', url: 'iu', createdAt: 'c', closedAt: null,
                  author: { login: 'alice' }, assignees: { nodes: [{ login: 'bob' }] }, labels: { nodes: [{ name: 'bug' }] },
                },
              },
            ] },
          },
        },
        user: null,
      },
    }));

    const { project, items } = await client.fetchBoard('octocat/5');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/graphql');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer ghs_tok');
    assert.deepEqual(calls[0].body.variables, { login: 'octocat', number: 5 });
    assert.match(calls[0].body.query, /projectV2\(number: \$number\)/);

    // Clean shape: union content flattened, Status resolved, edges unwrapped.
    assert.deepEqual(project, { id: 'PVT_1', number: 5, title: 'Roadmap', url: 'u', shortDescription: 'd' });
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      id: 'PVTI_1', type: 'ISSUE', status: 'In Progress',
      content: {
        number: 7, title: 'wired', body: 'b', url: 'iu', createdAt: 'c', closedAt: null,
        author: 'alice', assignees: ['bob'], labels: ['bug'],
      },
    });
  });

  test('falls back to the user-owned board when the organization alias is null', async () => {
    const { client } = captureClient(() => ({
      // The wrong-owner alias returns null with a per-field NOT_FOUND error; the
      // other alias is populated, so the read still succeeds.
      data: {
        organization: null,
        user: { projectV2: { id: 'PVT_U', number: 3, title: 'Mine', url: 'u', shortDescription: null, items: { nodes: [] } } },
      },
      errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to an Organization' }],
    }));
    const { project, items } = await client.fetchBoard('someuser/3');
    assert.equal(project.id, 'PVT_U');
    assert.equal(project.title, 'Mine');
    assert.deepEqual(items, []);
  });

  test('a board that resolves on neither alias returns {project:null, items:[]}', async () => {
    const { client } = captureClient(() => ({ data: { organization: null, user: null } }));
    assert.deepEqual(await client.fetchBoard('nobody/1'), { project: null, items: [] });
  });

  test('throws when GraphQL returns no data at all', async () => {
    const { client } = captureClient(() => ({ errors: [{ message: 'Bad credentials' }] }));
    await assert.rejects(() => client.fetchBoard('octocat/5'), /Bad credentials/);
  });
});
