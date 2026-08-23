/**
 * LIN-2010 Phase 2 — additive `ProviderInterface` declarations
 * (`connectionUnit` / `listScopes` / `scopeType`), groundwork for LIN-2149's
 * Account -> Connection -> Workspace picker.
 *
 * Scope, deliberately narrow: these are declarations plus thin per-provider
 * delegations to the EXISTING bespoke enumerators (github.listReboundableRepos,
 * github-projects.listReboundableBoards, jira's fetchJiraAccessibleResources).
 * No call-site changes; no consumer yet. These tests prove:
 *   1. the base class default (null labels, NotImplementedError, capability-gated)
 *   2. each provider's labels
 *   3. each provider's listScopes(credential) is byte-identical to calling its
 *      delegated-to function directly with the same fixture (proves "thin",
 *      not that the three shapes agree with each other — they don't, by design).
 *
 * Run with: node --test tests/unit/lin-2010-phase2-scope-declarations.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';

import { ProviderInterface, NotImplementedError } from '../../lib/providers/interface.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';
import { GitHubProjectsProvider } from '../../lib/providers/github-projects/index.js';
import { createFakeGitHubProjectsClient } from '../../lib/providers/github-projects/fake-client.js';
import { JiraProvider } from '../../lib/providers/jira/index.js';
import { fetchJiraAccessibleResources } from '../../lib/providers/jira/oauth.js';

describe('LIN-2010 Phase 2 — ProviderInterface base defaults', () => {
  test('connectionUnit/scopeType default null; listScopes throws NotImplementedError; capability-gated', () => {
    const base = new ProviderInterface();
    assert.equal(base.connectionUnit, null);
    assert.equal(base.scopeType, null);
    assert.equal(base.supports('listScopes'), false);
    assert.throws(() => base.listScopes('token'), NotImplementedError);
  });
});

describe('LIN-2010 Phase 2 — GitHub', () => {
  test('declares installation/repository labels', () => {
    const provider = new GitHubProvider();
    assert.equal(provider.connectionUnit, 'installation');
    assert.equal(provider.scopeType, 'repository');
    assert.equal(provider.supports('listScopes'), true);
  });

  test('listScopes(userToken) is byte-identical to listReboundableRepos(userToken) for the same fixture', async () => {
    const provider = new GitHubProvider();
    const fake = createFakeGitHubClient({
      _installations: [
        { id: 77, account: { login: 'octocat' }, repositories: [
          { full_name: 'octocat/hello-world', private: false },
        ] },
      ],
    });
    provider._clientForToken = () => fake;

    const direct = await provider.listReboundableRepos('gho_user');
    const viaListScopes = await provider.listScopes('gho_user');
    assert.deepEqual(viaListScopes, direct);
    assert.deepEqual(viaListScopes, [
      { slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false, installationId: '77' },
    ]);
  });
});

describe('LIN-2010 Phase 2 — GitHub Projects', () => {
  test('declares installation/board labels', () => {
    const provider = new GitHubProjectsProvider();
    assert.equal(provider.connectionUnit, 'installation');
    assert.equal(provider.scopeType, 'board');
    assert.equal(provider.supports('listScopes'), true);
  });

  test('listScopes(userToken) is byte-identical to listReboundableBoards(userToken) for the same fixture', async () => {
    const provider = new GitHubProjectsProvider();
    provider._listUserInstallations = async () => ([
      { id: 77, account: { login: 'octocat' } },
    ]);
    const fake = createFakeGitHubProjectsClient({
      'octocat/5': { project: { number: 5, title: 'Roadmap', url: 'u5', shortDescription: 'd5' } },
    });
    provider._clientForToken = () => fake;

    const direct = await provider.listReboundableBoards('gho_user');
    const viaListScopes = await provider.listScopes('gho_user');
    assert.deepEqual(viaListScopes, direct);
    assert.deepEqual(viaListScopes, [
      { login: 'octocat', number: 5, title: 'Roadmap', url: 'u5', shortDescription: 'd5', closed: false, installationId: '77' },
    ]);
  });
});

describe('LIN-2010 Phase 2 — Jira', () => {
  test('declares site/site labels (no installation layer — connection === scope granularity)', () => {
    const provider = new JiraProvider();
    assert.equal(provider.connectionUnit, 'site');
    assert.equal(provider.scopeType, 'site');
    assert.equal(provider.supports('listScopes'), true);
  });

  test('listScopes(accessToken) is byte-identical to fetchJiraAccessibleResources(accessToken) for the same fixture', async () => {
    const provider = new JiraProvider();
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ([
        { id: 'cid-1', url: 'https://a.atlassian.net', name: 'A' },
        { id: 'cid-2', url: 'https://b.atlassian.net' },
      ]),
    });

    const direct = await fetchJiraAccessibleResources('at-1', { fetchImpl });
    // listScopes calls the real module-level fetch; swap it for the duration of the call.
    const realFetch = global.fetch;
    global.fetch = fetchImpl;
    let viaListScopes;
    try {
      viaListScopes = await provider.listScopes('at-1');
    } finally {
      global.fetch = realFetch;
    }
    assert.deepEqual(viaListScopes, direct);
    assert.deepEqual(viaListScopes, [
      { cloudId: 'cid-1', url: 'https://a.atlassian.net', name: 'A' },
      { cloudId: 'cid-2', url: 'https://b.atlassian.net', name: 'https://b.atlassian.net' },
    ]);
  });
});
