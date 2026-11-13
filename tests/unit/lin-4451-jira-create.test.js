/**
 * LIN-4451 (piece 2 of LIN-4445): Jira createIssue, and the three filing lanes that open
 * on it: the proxy create (POST /api/proxy/issues, which the Periodical mint also uses),
 * the session create (POST /workspace/:urlKey/api/issues) and the feedback intake.
 *
 * The provider tests run against the repo's own in-memory Jira fake, so they prove the
 * provider's own logic (issue type, create-screen fields, epic, required-field refusal,
 * the sealed block, the re-read). They do NOT prove that live Jira accepts a create with
 * `properties` or a `parent`; that is LIN-4452's live check.
 *
 * Also pinned here: the Periodical gate reads its evidence from a Jira guard only when the
 * marker is present (review note 4), and a parentId / assigneeId / cycleId that is not a
 * UUID is refused 400 rather than dropped (review note 5, disposition (b)).
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4451-jira-create.test.js
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { jiraProvider, JiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';
import { AS_ASKED_PROPERTY, AS_ASKED_READ } from '../../lib/providers/jira/as-asked-region.js';
import { RefResolutionError } from '../../lib/proxy-ref-resolver.js';
import { PartialWriteError } from '../../lib/partial-write-error.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { sealAsAsked } from '../../lib/as-asked.js';
import { buildPeriodicalGateMarker, extractPeriodicalGateId } from '../../lib/periodicals.js';
import { flattenIssue } from '../../lib/proxy-wire.js';

process.env.NODE_ENV = 'test';

const SITE = 'https://acme.atlassian.net';
const SCOPE = { email: 'ada@acme.com', apiToken: 'tok-123', site: SITE };
const TASK = { id: '10100', name: 'Task', subtask: false, hierarchyLevel: 0 };
const BUG = { id: '10101', name: 'Bug', subtask: false, hierarchyLevel: 0 };
const SUBTASK = { id: '10102', name: 'Sub-task', subtask: true, hierarchyLevel: -1 };
const EPIC_TYPE = { id: '10200', name: 'Epic', subtask: false, hierarchyLevel: 1 };

// The create screen of a team-managed project: summary, project, issue type, description
// and a `parent` (the epic) are all offered; nothing else is required.
const SCREEN_TEAM_MANAGED = [
  { fieldId: 'summary', name: 'Summary', required: true, hasDefaultValue: false },
  { fieldId: 'project', name: 'Project', required: true, hasDefaultValue: false },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, hasDefaultValue: false },
  { fieldId: 'description', name: 'Description', required: false, hasDefaultValue: false },
  { fieldId: 'parent', name: 'Parent', required: false, hasDefaultValue: false },
];

// A company-managed create screen: no `parent`, the legacy Epic Link custom field instead.
const SCREEN_COMPANY_MANAGED = [
  { fieldId: 'summary', name: 'Summary', required: true, hasDefaultValue: false },
  { fieldId: 'project', name: 'Project', required: true, hasDefaultValue: false },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, hasDefaultValue: false },
  { fieldId: 'description', name: 'Description', required: false, hasDefaultValue: false },
  { fieldId: 'customfield_10014', name: 'Epic Link', required: false, hasDefaultValue: false },
];

const EPIC_ISSUE = {
  id: '30100',
  key: 'ENG-1',
  fields: {
    summary: 'Launch',
    description: null,
    status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
    project: { id: '10001', key: 'ENG', name: 'Engineering' },
    issuetype: EPIC_TYPE,
    created: '2026-01-01T00:00:00.000Z',
    labels: [],
    parent: null,
    _transitions: [],
  },
};

function seed({ types = [TASK, BUG, SUBTASK], fields = { [TASK.id]: SCREEN_TEAM_MANAGED }, extraProjects = [] } = {}) {
  return createFakeJiraClient({
    projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }, ...extraProjects],
    projectStatuses: {},
    createMeta: { ENG: { issueTypes: types, fields } },
    issues: [EPIC_ISSUE],
  });
}

// Counts every create the provider makes, so a refusal can be shown to have created nothing.
function countCreates(client) {
  const counter = { count: 0 };
  const original = client.createIssue;
  client.createIssue = async (body) => { counter.count += 1; return original(body); };
  return counter;
}

const WORDS = 'Keep *this* exactly, with _marks_ and a - bullet.';

let fake;
let provider;
const savedJira = { client: jiraProvider.client, clientFactory: jiraProvider.clientFactory, site: jiraProvider.site };
after(() => { jiraProvider.configure(savedJira); });

beforeEach(() => {
  fake = seed();
  provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
});

describe('Jira create contract (LIN-4451)', () => {
  test('the in-app form and the lanes declare the create fields the provider implements', () => {
    assert.equal(provider.supports('createIssue'), true);
    assert.deepEqual(provider.createFields(), ['title', 'description', 'teamId']);
    // stateId is not declared (a transition after create is a second, non-atomic write), and
    // parentId is not declared (review note 5, disposition (b): a Jira parent is refused).
    assert.deepEqual(provider.apiWriteFields(), ['title', 'description', 'teamId', 'projectId']);
    assert.equal(provider.ui.inlineCreate, true);
    assert.equal(provider.ui.write, true, 'the create-URL gate stays');
  });

  test('creates a Task with its block sealed: the property holds the exact words and the re-read serves them', async () => {
    const created = await provider.createIssue(SCOPE, {
      teamId: 'ENG', title: 'Ship it', description: sealAsAsked(WORDS),
    });
    assert.equal(created.identifier.startsWith('ENG-'), true);
    assert.equal(created.title, 'Ship it');
    assert.match(created.description, /Keep \*this\* exactly, with _marks_ and a - bullet\./);

    const stored = await fake.getIssue(created.identifier, AS_ASKED_READ);
    assert.equal(stored.fields.issuetype.id, TASK.id, 'Task is preferred');
    assert.equal(stored.properties[AS_ASKED_PROPERTY].words, WORDS, 'the exact words sit in the property');
  });

  test('Task is preferred over an earlier standard type: Bug listed first, Task still chosen (not standard[0])', async () => {
    fake = seed({
      types: [BUG, TASK, SUBTASK],
      fields: { [BUG.id]: SCREEN_TEAM_MANAGED, [TASK.id]: SCREEN_TEAM_MANAGED },
    });
    provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    const created = await provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Which type', description: 'Words.' });
    const stored = await fake.getIssue(created.identifier);
    assert.equal(stored.fields.issuetype.id, TASK.id, 'Task, not the first standard type (Bug)');
  });

  test('a plain description (no block) creates with no property', async () => {
    const created = await provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Plain', description: 'Just words.' });
    const stored = await fake.getIssue(created.identifier, AS_ASKED_READ);
    assert.equal(stored.properties?.[AS_ASKED_PROPERTY], undefined);
  });

  test('with no Task, the first standard non-subtask type at hierarchy level 0 is chosen', async () => {
    fake = seed({ types: [BUG, SUBTASK], fields: { [BUG.id]: SCREEN_TEAM_MANAGED } });
    provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    const created = await provider.createIssue(SCOPE, { teamId: 'ENG', title: 'A bug' });
    const stored = await fake.getIssue(created.identifier);
    assert.equal(stored.fields.issuetype.id, BUG.id);
  });

  test('a project offering only subtask types is refused 422 and nothing is created', async () => {
    fake = seed({ types: [SUBTASK], fields: {} });
    provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    const creates = countCreates(fake);
    await assert.rejects(
      () => provider.createIssue(SCOPE, { teamId: 'ENG', title: 'No standard type' }),
      (err) => err instanceof RefResolutionError && err.status === 422 && /no standard issue type/.test(err.message),
    );
    assert.equal(creates.count, 0);
  });

  test('a project Jira does not know is refused 422, not a 500', async () => {
    await assert.rejects(
      () => provider.createIssue(SCOPE, { teamId: 'NOPE', title: 'x' }),
      (err) => err instanceof RefResolutionError && err.status === 422,
    );
  });

  test('a required custom field with no default is refused by name, and nothing is created', async () => {
    const screen = [
      ...SCREEN_TEAM_MANAGED,
      { fieldId: 'customfield_10050', name: 'Story Points', required: true, hasDefaultValue: false },
    ];
    fake = seed({ fields: { [TASK.id]: screen } });
    provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    const creates = countCreates(fake);
    await assert.rejects(
      () => provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Needs points' }),
      (err) => err instanceof RefResolutionError && err.status === 422 && /Story Points/.test(err.message),
    );
    assert.equal(creates.count, 0);
  });

  test('a required field that carries a default is not refused', async () => {
    const screen = [
      ...SCREEN_TEAM_MANAGED,
      { fieldId: 'customfield_10050', name: 'Story Points', required: true, hasDefaultValue: true },
    ];
    fake = seed({ fields: { [TASK.id]: screen } });
    provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    const created = await provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Defaulted' });
    assert.ok(created.identifier);
  });

  test('a team-managed epic is set as `parent`, and reads back as the canonical project', async () => {
    const created = await provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Under the epic', projectId: EPIC_ISSUE.id });
    const stored = await fake.getIssue(created.identifier);
    assert.deepEqual(stored.fields.parent.id, EPIC_ISSUE.id);
    assert.equal(created.project?.id, EPIC_ISSUE.id, 'an epic parent is the canonical project, not a subtask parent');
    assert.equal(created.parent, null);
  });

  test('a company-managed epic is set as Epic Link (the epic key) when the create screen offers it', async () => {
    fake = seed({ fields: { [TASK.id]: SCREEN_COMPANY_MANAGED } });
    provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    const created = await provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Legacy epic', projectId: EPIC_ISSUE.id });
    const stored = await fake.getIssue(created.identifier);
    assert.equal(stored.fields.customfield_10014, 'ENG-1', 'Epic Link takes the epic key');
    assert.equal(stored.fields.parent, undefined);
  });

  test('an epic on a create screen that offers neither parent nor Epic Link is refused 422, nothing created', async () => {
    fake = seed({ fields: { [TASK.id]: [SCREEN_TEAM_MANAGED[0], SCREEN_TEAM_MANAGED[1], SCREEN_TEAM_MANAGED[2]] } });
    provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    const creates = countCreates(fake);
    await assert.rejects(
      () => provider.createIssue(SCOPE, { teamId: 'ENG', title: 'x', projectId: EPIC_ISSUE.id }),
      (err) => err instanceof RefResolutionError && err.status === 422 && /no epic field/.test(err.message),
    );
    assert.equal(creates.count, 0);
  });

  test('a block too large to hold is refused 422 before the create, nothing created', async () => {
    const creates = countCreates(fake);
    const huge = 'x'.repeat(40000);
    await assert.rejects(
      () => provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Too big', description: sealAsAsked(huge) }),
      (err) => err instanceof RefResolutionError && err.status === 422 && /too large/.test(err.message),
    );
    assert.equal(creates.count, 0);
  });

  test('a re-read that fails after the create is a PartialWriteError, so the caller does not retry the create', async () => {
    const creates = countCreates(fake);
    const original = fake.createIssue;
    fake.createIssue = async (body) => {
      const result = await original(body);
      fake.getIssue = async () => { throw Object.assign(new Error('upstream down'), { status: 503 }); };
      return result;
    };
    await assert.rejects(
      () => provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Lost confirmation' }),
      (err) => err instanceof PartialWriteError && err.applied.includes('created') && /do not retry/.test(err.message),
    );
    assert.equal(creates.count, 1, 'the issue exists; the failure is reported, not repeated');
  });
});

describe('Periodical gate on Jira (LIN-4451, review note 4)', () => {
  test('the guard carries the description, and the last 20 comments only when the gate marker is present', async () => {
    const marker = buildPeriodicalGateMarker('Security review');
    const comments = Array.from({ length: 25 }, (_, i) => ({
      id: String(9000 + i),
      body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `comment ${i}` }] }] },
      created: '2026-01-01T00:00:00.000Z',
    }));
    fake = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      issues: [{
        id: '30200',
        key: 'ENG-20',
        fields: {
          summary: 'Periodical',
          description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: marker }] }] },
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          labels: [], parent: null, _transitions: [], _comments: comments,
        },
      }],
    });
    provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });

    const guard = await provider.issueWriteGuard(SCOPE, '30200');
    assert.equal(guard.team.id, 'ENG');
    assert.ok(extractPeriodicalGateId(guard.description), 'the description is read with its gate marker');
    assert.equal(guard.comments.nodes.length, 20, 'the tail of the comments, not the oldest page');
    assert.equal(guard.comments.nodes[19].body, 'comment 24', 'the most recent comment is the last');
    assert.equal(guard.comments.nodes[0].body, 'comment 5');

    // An ordinary issue: no comment walk at all.
    const plain = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      issues: [{ id: '30201', key: 'ENG-21', fields: { summary: 'Ordinary', description: null, project: { id: '10001', key: 'ENG' }, status: { name: 'To Do', statusCategory: { key: 'new' } }, labels: [], parent: null, _comments: comments } }],
    });
    let walked = false;
    const original = plain.listAllComments;
    plain.listAllComments = async (id) => { walked = true; return original(id); };
    const plainProvider = new JiraProvider({ client: plain, clientFactory: () => plain, site: SITE });
    const ordinary = await plainProvider.issueWriteGuard(SCOPE, '30201');
    assert.deepEqual(ordinary.comments.nodes, []);
    assert.equal(walked, false, 'an ordinary write makes no comment read');
  });
});

// -----------------------------------------------------------------------------
// The lanes, through the real routes
// -----------------------------------------------------------------------------

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

describe('Periodical gate on Jira, end to end (PATCH /api/proxy/issues/:id)', () => {
  const DONE = { id: '11', name: 'Done', statusCategory: { key: 'done' } };
  const TODO = { id: '10', name: 'To Do', statusCategory: { key: 'new' } };

  beforeEach(() => {
    const marker = buildPeriodicalGateMarker('Security review');
    fake = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      projectStatuses: { ENG: [{ id: '10100', name: 'Task', subtask: false, statuses: [TODO, DONE] }] },
      issues: [{
        id: '30200',
        key: 'ENG-20',
        fields: {
          summary: 'Periodical',
          description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: marker }] }] },
          status: TODO,
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          issuetype: TASK,
          labels: [], parent: null,
          _transitions: [{ id: '31', name: 'Done', to: DONE }],
          _comments: [],
        },
      }],
    });
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
  });
  afterEach(() => {
    jiraProvider.configure(savedJira);
  });

  test('moving a gate-marked task to Done with no report comment is refused 409 PERIODICAL_REPORT_NOT_PERSISTED', async () => {
    const { status, body } = await call(buildProxyApp(), 'PATCH', '/api/proxy/issues/ENG-20', { stateId: 'done' });
    assert.equal(status, 409, JSON.stringify(body));
    assert.equal(body.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
    const stored = await fake.getIssue('ENG-20');
    assert.equal(stored.fields.status.id, TODO.id, 'the refusal moved nothing');
  });
});

describe('proxy create lane on Jira (POST /api/proxy/issues)', () => {
  beforeEach(() => {
    fake = seed();
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
  });
  afterEach(() => {
    jiraProvider.configure(savedJira);
  });

  test('a Periodical-mint shape (a project key as the team) files a sealed Task', async () => {
    const description = WORDS;
    const { status, body } = await call(buildProxyApp(), 'POST', '/api/proxy/issues', { teamId: 'ENG', title: 'Mint', description });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.success, true);
    const stored = await fake.getIssue(body.issue.identifier, AS_ASKED_READ);
    assert.equal(stored.fields.issuetype.id, TASK.id);
    assert.equal(stored.properties[AS_ASKED_PROPERTY].words, WORDS, 'the lane seals the words; the property holds them exactly');
  });

  test('projectId files the issue under the epic (parent on a team-managed screen)', async () => {
    const { status, body } = await call(buildProxyApp(), 'POST', '/api/proxy/issues', { teamId: 'ENG', title: 'Epic child', projectId: EPIC_ISSUE.id });
    assert.equal(status, 201, JSON.stringify(body));
    const stored = await fake.getIssue(body.issue.identifier);
    assert.equal(stored.fields.parent.id, EPIC_ISSUE.id);
  });

  test('parentId is refused 400 on Jira (a Jira parent is an issue key), and nothing is created', async () => {
    const creates = countCreates(fake);
    const { status, body } = await call(buildProxyApp(), 'POST', '/api/proxy/issues', { teamId: 'ENG', title: 'Sub', parentId: 'ENG-1' });
    assert.equal(status, 400);
    assert.match(body.error, /parentId is not supported by this provider/);
    assert.equal(creates.count, 0);
  });

  test('stateId is refused 400 on Jira, and nothing is created', async () => {
    const creates = countCreates(fake);
    const { status, body } = await call(buildProxyApp(), 'POST', '/api/proxy/issues', { teamId: 'ENG', title: 'x', stateId: 'done' });
    assert.equal(status, 400);
    assert.match(body.error, /stateId is not supported/);
    assert.equal(creates.count, 0);
  });
});

describe('session create lane on Jira (POST /workspace/:urlKey/api/issues)', () => {
  beforeEach(() => {
    fake = seed();
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
  });
  afterEach(() => {
    jiraProvider.configure(savedJira);
  });

  test('the in-app form path files a sealed Task', async () => {
    const { status, body } = await call(buildSessionApp(), 'POST', '/workspace/acme-jira/api/issues', { teamId: 'ENG', title: 'From the form', description: WORDS });
    assert.equal(status, 201, JSON.stringify(body));
    const stored = await fake.getIssue(body.issue.identifier, AS_ASKED_READ);
    assert.equal(stored.properties[AS_ASKED_PROPERTY].words, WORDS);
  });

  test('projectId is refused 400, not dropped: the in-app form does not offer an epic on Jira', async () => {
    const creates = countCreates(fake);
    const { status, body } = await call(buildSessionApp(), 'POST', '/workspace/acme-jira/api/issues', { teamId: 'ENG', title: 'x', projectId: EPIC_ISSUE.id });
    assert.equal(status, 400);
    assert.match(body.error, /projectId is not supported by this provider/);
    assert.equal(creates.count, 0);
  });
});

describe('feedback intake lane: deployment defaults and Jira (POST /workspace/:urlKey/api/feedback)', () => {
  const saved = {};
  const KEYS = ['FEEDBACK_TEAM_ID', 'FEEDBACK_PROJECT_ID'];
  beforeEach(() => {
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  // A stand-in provider with a chosen name, so the route's provider-name rules are what is
  // exercised. Its team list is the Jira project keys; the route only needs these members.
  function stubProvider(name) {
    const calls = { createIssue: [] };
    const stub = {
      name,
      supports: (cap) => ['createIssue', 'fetchTeams'].includes(cap),
      apiWriteFields: () => ['title', 'description', 'teamId', 'projectId'],
      async fetchTeams() { return [{ id: 'ENG', name: 'Engineering' }, { id: 'OPS', name: 'Operations' }]; },
      async createIssue(token, input) {
        calls.createIssue.push(input);
        return { success: true, issue: { id: 'iss-1', identifier: 'ENG-9', title: input.title, state: { name: 'To Do', type: 'unstarted' } } };
      },
    };
    registerProvider(stub);
    return { calls };
  }

  function feedbackApp(name) {
    const app = express();
    app.use(express.json({ limit: '250kb' }));
    app.use(createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: req.params.urlKey, provider: name, accessToken: 'ws-token' };
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

  test('on Jira, a Linear UUID in FEEDBACK_TEAM_ID is not sent as the project key: the first Jira project is used', async () => {
    const { calls } = stubProvider('jira');
    process.env.FEEDBACK_TEAM_ID = '7e6de730-3028-4ebc-af8a-a4de237a686d';
    process.env.FEEDBACK_PROJECT_ID = '1f320540-72c1-4576-852c-bcb5c4ffef51';
    const res = await call(feedbackApp('jira'), 'POST', '/workspace/acme/api/feedback', { message: 'the form is slow', title: 'Slow form' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.createIssue[0].teamId, 'ENG', 'the first Jira project, not the Linear UUID');
    assert.equal(calls.createIssue[0].projectId, undefined, 'the Linear project UUID is not sent as an epic');
  });

  test('on Jira, an explicit body teamId (a project key) still wins', async () => {
    const { calls } = stubProvider('jira');
    process.env.FEEDBACK_TEAM_ID = '7e6de730-3028-4ebc-af8a-a4de237a686d';
    const res = await call(feedbackApp('jira'), 'POST', '/workspace/acme/api/feedback', { message: 'ops note', title: 'Ops', teamId: 'OPS' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.createIssue[0].teamId, 'OPS');
  });

  test('on a non-Jira provider the deployment default is still used, as before', async () => {
    const { calls } = stubProvider('linear');
    process.env.FEEDBACK_TEAM_ID = '7e6de730-3028-4ebc-af8a-a4de237a686d';
    const res = await call(feedbackApp('linear'), 'POST', '/workspace/acme/api/feedback', { message: 'hello', title: 'Hello' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(calls.createIssue[0].teamId, '7e6de730-3028-4ebc-af8a-a4de237a686d');
  });
});

describe('flattened proxy read of a Jira-created issue', () => {
  test('the created issue reads back through flattenIssue with its team as the project key', async () => {
    fake = seed();
    provider = new JiraProvider({ client: fake, clientFactory: () => fake, site: SITE });
    const created = await provider.createIssue(SCOPE, { teamId: 'ENG', title: 'Round trip', description: sealAsAsked(WORDS) });
    const flat = flattenIssue({ ...created });
    assert.equal(flat.title, 'Round trip');
    assert.equal(flat.teamId, 'ENG');
  });
});
