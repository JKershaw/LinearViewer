/**
 * LIN-4036 — every registered provider whose `issueWriteGuard` exists returns the issue's `title`.
 *
 * The dispatch entrance names a title-less Jira/GitHub row from the guard's answer, and Linear's and
 * local's guards carry the same key (LIN-4034). A provider added later with a guard that drops `title`
 * would pass every lane test (those use fake providers), so this walks the REAL registry and drives
 * each real guard through its own fake client. A guard with no fixture here, and not listed as an
 * exception, fails the walk: the author must add a fixture (and a `title`) or name the exception.
 *
 * Run with: node --test tests/unit/lin-4036-provider-guard-title.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLClient } from 'graphql-request';
import '../../lib/providers/index.js'; // registers linear, github, github-projects, jira, local
import { getAllProviders } from '../../lib/providers/registry.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';
import { JiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';
import { createLocalProvider } from '../fixtures/local-harness.js';

// Providers with no `issueWriteGuard` on purpose. Giving one a guard also switches on the write
// routes' guard (routes/proxy-writes.js guardTarget) for that provider, so it is its own change.
const KNOWN_NO_GUARD = new Set(['github-projects']);

const TITLE = 'The issue title';
const REPO = 'octocat/hello-world';
const SITE = 'https://acme.atlassian.net';

// name -> async () => the real provider's guard answer for an existing issue.
const FIXTURES = {
  linear: async (provider) => {
    // The Linear guard is one GraphQL query; its answer is whatever the query selects, so the
    // stubbed answer echoes only the fields the query text asks for.
    const seen = [];
    const m = mock.method(GraphQLClient.prototype, 'request', async (query) => {
      seen.push(String(query));
      const wants = (f) => new RegExp(`\\b${f}\\b`).test(String(query));
      return { issue: { id: 'LIN-1', ...(wants('title') ? { title: TITLE } : {}) } };
    });
    try { return await provider.issueWriteGuard('api-key', 'LIN-1'); } finally { m.mock.restore(); }
  },
  local: async () => {
    const { provider, store } = createLocalProvider();
    await store.seed('ws-1', {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1, url: '/x' }],
      issues: [{ id: 'i1', identifier: 'LOCAL-1', title: TITLE, description: 'd', projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } }],
    });
    return provider.issueWriteGuard('ws-1', 'i1');
  },
  github: async () => {
    const client = createFakeGitHubClient({
      [REPO]: { milestones: [], labels: [], issues: [{ number: 1, title: TITLE, body: '', state: 'open', labels: [], milestone: null }] },
    });
    return new GitHubProvider({ client, repo: REPO }).issueWriteGuard(REPO, '1');
  },
  jira: async () => {
    const client = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      projectStatuses: {},
      issues: [{
        id: '20001', key: 'ENG-1',
        fields: {
          summary: TITLE, description: null,
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', labels: [],
        },
      }],
    });
    const provider = new JiraProvider({ clientFactory: () => client, site: SITE });
    return provider.issueWriteGuard({ email: 'a@b.com', apiToken: 't', site: SITE }, 'ENG-1');
  },
};

afterEach(() => mock.reset());

describe('LIN-4036 — provider-walk: every issueWriteGuard returns the issue title', () => {
  test('the registry holds the providers this walk knows about', () => {
    const names = getAllProviders().map((p) => p.name).sort();
    for (const n of [...Object.keys(FIXTURES), ...KNOWN_NO_GUARD]) {
      assert.ok(names.includes(n), `${n} is expected in the registry (got ${names.join(', ')})`);
    }
  });

  test('each provider with an issueWriteGuard has a fixture and answers with the title', async () => {
    const guarded = getAllProviders().filter((p) => typeof p.issueWriteGuard === 'function');
    assert.ok(guarded.length >= 4, 'linear, local, github and jira all implement the guard');
    for (const provider of guarded) {
      const fixture = FIXTURES[provider.name];
      assert.ok(fixture, `${provider.name} implements issueWriteGuard but has no fixture in this walk: add one that returns the issue's title (LIN-4036 reads it for the dispatch row), or it will leave title-less rows unnamed`);
      const answer = await fixture(provider);
      assert.ok(answer && typeof answer === 'object', `${provider.name}: the guard answered ${JSON.stringify(answer)} for an existing issue`);
      assert.equal(answer.title, TITLE, `${provider.name}: issueWriteGuard must return the issue's title`);
    }
  });

  test('a provider without a guard is a named exception, not a silent gap', () => {
    for (const provider of getAllProviders()) {
      if (typeof provider.issueWriteGuard === 'function') continue;
      assert.ok(KNOWN_NO_GUARD.has(provider.name), `${provider.name} has no issueWriteGuard and is not listed in KNOWN_NO_GUARD`);
    }
  });
});
