/**
 * LIN-3240 (LIN-3126 slice 1) test harness — a two-repo, connection-backed
 * GitHub workspace plus a recording fake GitHub provider, mounted on the real
 * session-auth workspace-api and task-create routers.
 *
 * The resolver under test (`lib/workspace.js`) is STORE-FREE: a connection-backed
 * binding's credential is read from the per-request side-table
 * (`lib/connection-binding.js`), which hydration writes. This harness hydrates
 * each binding directly via `setBindingCredential` (the D6/PR3 unit-suite
 * pattern) rather than standing up a MangoClient connection store — the store is
 * not on this path. Everything else is real: the routes, the resolver, the
 * render path, and the provider call scopes.
 */
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { createTaskCreateRoutes } from '../../routes/task-create.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setBindingCredential } from '../../lib/connection-binding.js';

export const REPO_A = 'octo/repoA';
export const REPO_B = 'octo/repoB';

/** Register a `github`-shaped fake that records every call's `{repo}` scope. */
export function installGitHubProvider({ repoIssues = {}, supportsRecommendation = true, createFields = [] } = {}) {
  const calls = [];
  const record = (method, scope) => {
    calls.push({ method, scope });
    return scope;
  };
  const provider = registerProvider({
    name: 'github',
    ui: { inlineCreate: true, inlineEdit: true },
    supports: (cap) => (cap === 'fetchRecommendationContext' ? supportsRecommendation : true),
    createFields: () => createFields,
    apiWriteFields: () => [],
    fetchIssueFields: async (scope, issueId) => {
      record('fetchIssueFields', scope);
      const issue = repoIssues[scope.repo];
      if (!issue || String(issue.id) !== String(issueId)) throw new Error(`Issue not found: ${issueId}`);
      return issue;
    },
    fetchIssueContext: async (scope, issueId) => {
      record('fetchIssueContext', scope);
      const issue = repoIssues[scope.repo];
      if (!issue || String(issue.id) !== String(issueId)) throw new Error(`Issue not found: ${issueId}`);
      return { issue, project: null };
    },
    fetchProjects: async (scope) => {
      record('fetchProjects', scope);
      return { projects: [], issues: Object.values(repoIssues) };
    },
    fetchTeams: async (scope) => { record('fetchTeams', scope); return []; },
    fetchProjectsList: async (scope) => { record('fetchProjectsList', scope); return []; },
    fetchRecommendationContext: async (scope, issueId) => {
      record('fetchRecommendationContext', scope);
      return { issue: { id: issueId }, comments: [] };
    },
    createIssue: async (scope, input) => {
      record('createIssue', scope);
      return { success: true, issue: { id: 'new-1', identifier: 'NEW-1', title: input.title } };
    },
    fetchIssueComments: async () => [],
  });
  return { provider, calls };
}

/**
 * A connection-backed workspace bound to REPO_A + REPO_B on one Connection,
 * `repoA` marked active, each binding hydrated with its own token.
 */
export function makeTwoRepoWorkspace({ activeRepo = REPO_A } = {}) {
  const bindings = [
    { provider: 'github', scope: REPO_A, connectionId: 'conn-1' },
    { provider: 'github', scope: REPO_B, connectionId: 'conn-1' },
  ];
  setBindingCredential(bindings[0], { installationId: '99', token: 'tok-a' });
  setBindingCredential(bindings[1], { installationId: '99', token: 'tok-b' });
  return {
    urlKey: 'acme',
    provider: 'github',
    bindings,
    activeBinding: { provider: 'github', scope: activeRepo },
  };
}

function sessionFor(workspace, features) {
  return { features, accountId: 'acct-1', workspaces: [workspace] };
}

export function buildWorkspaceApiApp({ workspace, features = {}, taskDecisionsStore = null }) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => { req.workspace = workspace; req.session = sessionFor(workspace, features); next(); },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {}, workspacePreferencesStore: {},
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {},
    dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {}, proxyTokenStore: {},
    taskDecisionsStore,
  }));
  return app;
}

export function buildTaskCreateApp({ workspace, features = {} }) {
  const app = express();
  app.use(createTaskCreateRoutes({
    workspaceFromUrl: (req, _res, next) => { req.workspace = workspace; req.session = sessionFor(workspace, features); next(); },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
  }));
  return app;
}

/** Run `fn(request)` against a loopback-bound server, then close it. */
export async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const req = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  };
  try {
    return await fn({
      get: (p) => req('GET', p),
      post: (p, b) => req('POST', p, b),
      patch: (p, b) => req('PATCH', p, b),
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
