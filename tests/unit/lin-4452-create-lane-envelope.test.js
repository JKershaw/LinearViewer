/**
 * LIN-4452 review finding 1: a create that lands but whose seal the site drops (or whose
 * confirmation re-read fails) must reach the caller through the PartialWriteError envelope
 * on every create lane: `code: PARTIAL_WRITE`, `context.failed`, and `retryable: false`, so
 * a caller does not file a duplicate. Before the fix each lane answered a bare 500
 * "Failed to create issue" (proxy, session) or "Failed to submit feedback" (feedback),
 * and the PartialWriteError never reached the caller.
 *
 * The provider-level guard is pinned in lin-4452-jira-property-guard.test.js. These tests
 * pin the route boundary, against the in-memory Jira fake and a stub feedback provider.
 *
 * Also pinned: an edit that the site drops is still retryable (both Jira edits are
 * idempotent), so only a create that landed is marked non-retryable. The retry rule lives
 * in one builder, partialWriteEnvelope, which every create lane's catch calls.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4452-create-lane-envelope.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { jiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';
import { PartialWriteError, partialWriteEnvelope } from '../../lib/partial-write-error.js';
import { registerProvider, getProvider } from '../../lib/providers/registry.js';

const SITE = 'https://acme.atlassian.net';
const SCOPE = { email: 'ada@acme.com', apiToken: 'tok-123', site: SITE };
const TASK = { id: '10100', name: 'Task', subtask: false, hierarchyLevel: 0 };
const SCREEN = [
  { fieldId: 'summary', name: 'Summary', required: true, hasDefaultValue: false },
  { fieldId: 'project', name: 'Project', required: true, hasDefaultValue: false },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, hasDefaultValue: false },
  { fieldId: 'description', name: 'Description', required: false, hasDefaultValue: false },
];
const WORDS = 'Keep *this* exactly, with _marks_ and a - bullet.';
const EXISTING = {
  id: '30001', key: 'ENG-1',
  fields: {
    summary: 'Existing', description: null,
    status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
    project: { id: '10001', key: 'ENG', name: 'Engineering' },
    issuetype: { id: TASK.id, name: 'Task', subtask: false },
    created: '2026-01-01T00:00:00.000Z', labels: [], parent: null, _transitions: [],
  },
};

function seed({ dropProperties = false } = {}) {
  return createFakeJiraClient({
    projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
    projectStatuses: {},
    createMeta: { ENG: { issueTypes: [TASK], fields: { [TASK.id]: SCREEN } } },
    issues: [structuredClone(EXISTING)],
    dropProperties,
  });
}

// Makes the confirmation re-read after a create fail, the create itself having landed.
function failRereadAfterCreate(client) {
  const original = client.createIssue;
  client.createIssue = async (body) => {
    const result = await original(body);
    client.getIssue = async () => { throw Object.assign(new Error('upstream down'), { status: 503 }); };
    return result;
  };
}

function buildProxyApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme-jira', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: SCOPE, reason: 'ok', provider: 'jira' }),
    getWorkspaceAccessToken: async () => SCOPE,
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

const JIRA_WORKSPACE = {
  urlKey: 'acme-jira',
  provider: 'jira',
  accessToken: SCOPE.apiToken,
  bindings: [{ provider: 'jira', scope: SITE, credentials: { email: SCOPE.email, token: SCOPE.apiToken } }],
};

function buildSessionApp() {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => { req.workspace = JIRA_WORKSPACE; next(); },
    freeTierStore: {},
    getOpenRouterSource: () => null,
    userPreferencesStore: {},
    workspacePreferencesStore: {},
    customPromptsStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    reportHistoryStore: {},
    dispatchQueueStore: {},
    agentStatusStore: {},
    promptTraceStore: {},
    proxyTokenStore: {},
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(r => server.close(r));
  }
}

const savedJira = { client: jiraProvider.client, clientFactory: jiraProvider.clientFactory, site: jiraProvider.site };
after(() => { jiraProvider.configure(savedJira); });

// The envelope a created-but-unconfirmed issue must answer with on every create lane.
function assertCreatedEnvelope(body, failed) {
  assert.equal(body.code, 'PARTIAL_WRITE', JSON.stringify(body));
  assert.equal(body.category, 'upstream');
  assert.equal(body.retryable, false, 'the issue exists: a retry would file a duplicate');
  assert.deepEqual(body.context.applied, ['created']);
  assert.equal(body.context.failed, failed);
  assert.match(body.error, /do not retry/);
}

describe('proxy create lane: a landed create reports PARTIAL_WRITE (POST /api/proxy/issues)', () => {
  let fake;
  beforeEach(() => {
    fake = seed({ dropProperties: true });
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
  });
  afterEach(() => { jiraProvider.configure(savedJira); });

  test('a site that drops the seal: 500 PARTIAL_WRITE, failed:"property", retryable:false, and the create ran once', async () => {
    let creates = 0;
    const original = fake.createIssue;
    fake.createIssue = async (body) => { creates += 1; return original(body); };
    const { status, body } = await call(buildProxyApp(), 'POST', '/api/proxy/issues', { teamId: 'ENG', title: 'Dropped', description: WORDS });
    assert.equal(status, 500, JSON.stringify(body));
    assertCreatedEnvelope(body, 'property');
    assert.equal(creates, 1, 'the issue exists once; the failure is reported, not repeated');
  });

  test('a confirmation re-read that fails: 500 (not the re-read 503), PARTIAL_WRITE, failed:"re-read", retryable:false', async () => {
    fake = seed();
    failRereadAfterCreate(fake);
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
    const { status, body } = await call(buildProxyApp(), 'POST', '/api/proxy/issues', { teamId: 'ENG', title: 'Lost confirmation' });
    assert.equal(status, 500, JSON.stringify(body));
    assertCreatedEnvelope(body, 're-read');
  });
});

describe('session create lane: a landed create reports PARTIAL_WRITE (POST /workspace/:urlKey/api/issues)', () => {
  let fake;
  afterEach(() => { jiraProvider.configure(savedJira); });

  test('a site that drops the seal: 500 PARTIAL_WRITE, failed:"property", retryable:false', async () => {
    fake = seed({ dropProperties: true });
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
    const { status, body } = await call(buildSessionApp(), 'POST', '/workspace/acme-jira/api/issues', { teamId: 'ENG', title: 'Dropped', description: WORDS });
    assert.equal(status, 500, JSON.stringify(body));
    assertCreatedEnvelope(body, 'property');
  });

  test('a confirmation re-read that fails: 500 PARTIAL_WRITE, failed:"re-read", retryable:false', async () => {
    fake = seed();
    failRereadAfterCreate(fake);
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
    const { status, body } = await call(buildSessionApp(), 'POST', '/workspace/acme-jira/api/issues', { teamId: 'ENG', title: 'Lost confirmation' });
    assert.equal(status, 500, JSON.stringify(body));
    assertCreatedEnvelope(body, 're-read');
  });
});

describe('feedback lane: a landed ticket reports PARTIAL_WRITE (POST /workspace/:urlKey/api/feedback)', () => {
  // The stub takes the 'jira' name in the global registry; put the real provider back after each test.
  let realJira;
  beforeEach(() => { realJira = getProvider('jira'); });
  afterEach(() => { registerProvider(realJira); });

  // A stand-in provider whose create lands and then fails the seal, as the Jira provider does.
  function stubProvider(error) {
    registerProvider({
      name: 'jira',
      supports: (cap) => ['createIssue', 'fetchTeams'].includes(cap),
      apiWriteFields: () => ['title', 'description', 'teamId', 'projectId'],
      async fetchTeams() { return [{ id: 'ENG', name: 'Engineering' }]; },
      async createIssue() { throw error; },
    });
  }

  function feedbackApp() {
    const app = express();
    app.use(express.json({ limit: '250kb' }));
    app.use(createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: req.params.urlKey, provider: 'jira', accessToken: 'ws-token' };
        req.session = { linearUserId: 'user-1' };
        next();
      },
      dispatchQueueStore: { addItem: async () => ({ _id: 'd1' }) },
      freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
      workspacePreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {},
      briefCacheStore: {}, reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {},
    }));
    return app;
  }

  test('a create that landed but lost its seal: 500 PARTIAL_WRITE, failed:"property", retryable:false', async () => {
    stubProvider(new PartialWriteError(
      'Jira created ENG-9 but did not keep its harbour.asAsked property, so the words are not held on Jira — do not retry the create, read the issue instead',
      { applied: ['created'], failed: 'property' },
    ));
    const { status, body } = await call(feedbackApp(), 'POST', '/workspace/acme/api/feedback', { message: 'the form is slow', title: 'Slow form' });
    assert.equal(status, 500, JSON.stringify(body));
    assertCreatedEnvelope(body, 'property');
  });
});

describe('the one envelope builder decides retry (partialWriteEnvelope)', () => {
  test('a create that landed is retryable:false, and answers 500 whatever status its re-read failed with', () => {
    const env = partialWriteEnvelope(new PartialWriteError('x', { applied: ['created'], failed: 're-read', status: 503 }));
    assert.equal(env.status, 500);
    assert.equal(env.extra.code, 'PARTIAL_WRITE');
    assert.equal(env.extra.retryable, false);
  });

  test('an edit that landed only in part stays retryable:true, and keeps the upstream status (a retry is safe)', () => {
    const env = partialWriteEnvelope(new PartialWriteError('x', { applied: ['description'], failed: 'property', status: 429 }));
    assert.equal(env.status, 429);
    assert.equal(env.extra.retryable, true);
    assert.deepEqual(env.extra.context, { applied: ['description'], failed: 'property' });
  });
});
