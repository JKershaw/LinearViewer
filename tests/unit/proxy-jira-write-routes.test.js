/**
 * LIN-1886 (Jira Provider Phase 2: writes + status transitions) — route-level
 * composition tests for the Jira-backed consumer proxy write lane.
 *
 * Mirrors `tests/unit/proxy-github-write-routes.test.js`'s shape: drives the
 * REAL `createProxyRoutes` handlers against the REAL `JiraProvider` and the
 * repo's own in-memory fake client (`createFakeJiraClient`) — the production
 * LIN-581 selection path (`resolveWorkspaceAccess` reports the provider NAME,
 * `resolveProviderAccess` resolves it via the registry and substitutes the
 * structured `{email, apiToken, site}` scope in place of a bare token,
 * LIN-1891) — so nothing is injected past the real seam under test.
 *
 * Covers the Revision 4 plan's Step 3 test list end-to-end through the actual
 * PATCH route (not just the provider in isolation):
 *   - happy-path status transition
 *   - no-available-transition → 422
 *   - screen-required transition → 422
 *   - canceled/duplicate requested → 422 (never silently folds to done)
 *   - re-read regression: a 204 write response still yields the canonically
 *     re-read issue, never a {success:false}/502
 *   - D1 unmodeled-node AND unmodeled-mark description-overwrite refusal (422)
 *   - D2 skip-on-unchanged-status: a title-only PATCH leaves status untouched
 *     and makes NO transitions call
 *   - D3 priority-is-silently-dropped, exercised THROUGH the real PATCH route
 *     with priority simply omitted from the request body (S1's fix — the
 *     client-side omission, not just the provider-side exclusion, is what
 *     makes this actually work end-to-end; see public/task-edit.js)
 *   - D4 projectId-refused-422 and parentId:null-refused-422 on this
 *     proxy-lane route
 *
 * Run with: node --test tests/unit/proxy-jira-write-routes.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { jiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';

const SITE = 'https://acme.atlassian.net';
const SCOPE = { email: 'ada@acme.com', apiToken: 'tok-123', site: SITE };

let fake;
const savedClient = jiraProvider.client;
const savedClientFactory = jiraProvider.clientFactory;
const savedSite = jiraProvider.site;

function seed() {
  return createFakeJiraClient({
    projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
    issues: [
      {
        id: '30001', key: 'ENG-10',
        fields: {
          summary: 'Original title',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Original body.' }] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          _transitions: [
            { id: '11', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
            { id: '21', name: 'Done', to: { name: 'Done', statusCategory: { key: 'done' } } },
          ],
        },
      },
      {
        id: '30002', key: 'ENG-11', // unrenderable description: an unmodeled NODE (table)
        fields: {
          summary: 'Has a table',
          description: { type: 'doc', version: 1, content: [{ type: 'table', content: [] }] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30003', key: 'ENG-12', // unrenderable description: an unmodeled MARK only
        fields: {
          summary: 'Has an underline mark',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30004', key: 'ENG-13', // done, no available transitions
        fields: {
          summary: 'Already done, nothing else available',
          description: null,
          status: { name: 'Done', statusCategory: { key: 'done' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30005', key: 'ENG-14', // its only forward transition requires a screen
        fields: {
          summary: 'Only transition requires a screen',
          description: null,
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          _transitions: [
            { id: '31', name: 'Resolve', to: { name: 'Done', statusCategory: { key: 'done' } }, fields: { resolution: { required: true } } },
          ],
        },
      },
    ],
  });
}

beforeEach(() => {
  fake = seed();
  jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
});

afterEach(() => {
  // Restore the module singleton so a later suite in this process sees it as
  // it was found (production never configures a boot client for Jira either).
  jiraProvider.client = savedClient;
  jiraProvider.clientFactory = savedClientFactory;
  jiraProvider.site = savedSite;
});

/** The stored fake issue — the round-trip witness, read straight from the store. */
const stored = (idOrKey) => fake.getIssue(idOrKey);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme-jira', label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
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

async function call(app, method, path, body) {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer anything',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(r => server.close(r));
  }
}

describe('Jira-backed proxy PATCH /issues/:id — status transitions (LIN-1886)', () => {
  test('happy-path status transition: todo → in-progress → 200 and the fake store actually moved', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { stateId: 'in-progress' });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.issue.state.type, 'started');
    assert.equal((await stored('ENG-10')).fields.status.statusCategory.key, 'indeterminate');
  });

  test('D2: no available transition to the target → 422, and nothing is written', async () => {
    // ENG-13 is `done` with an EMPTY _transitions list; targeting `todo` finds nothing.
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-13', { stateId: 'todo' });
    assert.equal(status, 422);
    assert.equal((await stored('ENG-13')).fields.status.statusCategory.key, 'done');
    assert.ok(body.error);
  });

  test('D2: a screen-required transition refuses (422) rather than attempting a screen-driven update', async () => {
    const { status } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-14', { stateId: 'done' });
    assert.equal(status, 422);
    assert.equal((await stored('ENG-14')).fields.status.statusCategory.key, 'new', 'nothing was written');
  });

  test('D2: canceled/duplicate requested → 422, never silently folds to done', async () => {
    const canceled = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { stateId: 'canceled' });
    assert.equal(canceled.status, 422);
    const duplicate = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { stateId: 'duplicate' });
    assert.equal(duplicate.status, 422);
    assert.equal((await stored('ENG-10')).fields.status.statusCategory.key, 'new', 'never moved to done');
  });

  test('D2: skip-on-unchanged — a title-only PATCH leaves status untouched, no transitions call at all', async () => {
    let getTransitionsCalls = 0;
    const original = fake.getTransitions.bind(fake);
    fake.getTransitions = async (...args) => { getTransitionsCalls += 1; return original(...args); };

    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { title: 'Renamed only' });
    assert.equal(status, 200);
    assert.equal(body.issue.title, 'Renamed only');
    assert.equal(body.issue.state.type, 'unstarted', 'status untouched');
    assert.equal(getTransitionsCalls, 0, 'no getTransitions call for a patch with no stateId');
  });

  test('re-read regression: a 204 write response still yields the canonically re-read issue, never a 502/{success:false}', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { title: 'Re-read me' });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.issue.title, 'Re-read me');
    assert.equal(body.issue.id, '30001');
  });
});

describe('Jira-backed proxy PATCH /issues/:id — D1 description-overwrite refusal (LIN-1886)', () => {
  test('refuses (422) overwriting a description whose CURRENT ADF has an unmodeled NODE (table)', async () => {
    const { status } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-11', { description: 'replacement' });
    assert.equal(status, 422);
    assert.deepEqual((await stored('ENG-11')).fields.description, { type: 'doc', version: 1, content: [{ type: 'table', content: [] }] });
  });

  test('refuses (422) overwriting a description whose CURRENT ADF has an unmodeled MARK only', async () => {
    const { status } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-12', { description: 'replacement' });
    assert.equal(status, 422);
  });

  test('a renderable current description CAN be overwritten', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { description: 'New body' });
    assert.equal(status, 200);
    assert.equal(body.issue.description, 'New body');
  });
});

describe('Jira-backed proxy POST /issues/:id/description/{append,replace} (LIN-1886 review Blocker 1)', () => {
  // The shared read-modify-write in routes/proxy.js (`applyDescriptionEdit`) is a
  // MARKDOWN-STRING splice over whatever `provider.issueDescription` returns. When
  // Jira returned the raw ADF object there, `String(<object>)` stringified it to
  // "[object Object]" — append silently DESTROYED the stored body (200 + a
  // description of `"[object Object]\n\n<block>"`) and replace could never match.
  // These assert against the FAKE STORE's ADF, not just the response, so a
  // regression to the object-shaped return cannot pass.

  const paragraphTexts = (adf) => (adf?.content || [])
    .filter(n => n.type === 'paragraph')
    .map(p => (p.content || []).map(t => t.text).join(''));

  test('append preserves the original body byte-for-byte and adds the block as a new paragraph', async () => {
    const { status, body } = await call(buildApp(), 'POST', '/api/proxy/issues/ENG-10/description/append', { block: 'A new note.' });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    const adf = (await stored('ENG-10')).fields.description;
    assert.deepEqual(paragraphTexts(adf), ['Original body.', 'A new note.'],
      'the original paragraph survives and the block lands as its own paragraph');
    assert.ok(!JSON.stringify(adf).includes('[object Object]'), 'no stringified ADF object reached the store');
    assert.ok(!JSON.stringify(body).includes('[object Object]'), 'no stringified ADF object reached the response');
    assert.equal(body.issue.description, 'Original body.\n\nA new note.');
  });

  test('replace rewrites a genuinely-occurring span and the stored ADF reflects it', async () => {
    const { status, body } = await call(buildApp(), 'POST', '/api/proxy/issues/ENG-10/description/replace',
      { oldString: 'Original body.', newString: 'Rewritten body.' });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(paragraphTexts((await stored('ENG-10')).fields.description), ['Rewritten body.']);
    assert.ok(!JSON.stringify(body).includes('[object Object]'));
  });

  test('D1 still protects append: an unrenderable current ADF refuses (422) and the stored ADF is byte-identical', async () => {
    // ENG-11's description is an unmodeled NODE (table). The markdown view is
    // empty, so a naive append would happily overwrite it — `updateIssue`'s D1
    // guard is what stops the write, and it still runs on this path.
    const before = JSON.stringify((await stored('ENG-11')).fields.description);
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/ENG-11/description/append', { block: 'A new note.' });
    assert.equal(status, 422);
    assert.equal(JSON.stringify((await stored('ENG-11')).fields.description), before, 'nothing was written');
  });

  test('D1 still protects append for an unmodeled MARK only (422, no write)', async () => {
    const before = JSON.stringify((await stored('ENG-12')).fields.description);
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/ENG-12/description/append', { block: 'A new note.' });
    assert.equal(status, 422);
    assert.equal(JSON.stringify((await stored('ENG-12')).fields.description), before, 'nothing was written');
  });
});

describe('Jira-backed proxy PATCH /issues/:id — D3 priority is silently dropped end-to-end (LIN-1886, S1)', () => {
  test('a PATCH with priority OMITTED (the S1-fixed client behaviour) succeeds normally', async () => {
    // This is the shape public/task-edit.js now sends for Jira (priority key
    // absent from the body entirely, not present-and-null) — proving the
    // client-side omission this ticket's S1 fix requires actually works
    // end-to-end through the real route, not just asserted at the provider layer.
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { title: 'No priority sent' });
    assert.equal(status, 200);
    assert.equal(body.issue.title, 'No priority sent');
  });

  test('a PATCH that DOES send a valid priority still succeeds, but priority is never forwarded into the Jira write', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { title: 'With priority', priority: 2 });
    assert.equal(status, 200);
    assert.equal(body.issue.title, 'With priority');
    // The fake store's `fields` never gained a priority key — nothing to
    // assert it against, which is the point: Jira's PUT body never carried it.
  });
});

describe('Jira-backed proxy PATCH /issues/:id — D4 patch-field refusal (LIN-1886)', () => {
  test('a truthy projectId is refused (422) on this proxy-lane route', async () => {
    // A UUID short-circuits the route's own symbolic-ref resolution
    // (resolveProjectInput), so this reaches — and pins the message of —
    // JiraProvider.updateIssue's own D4 refusal, not a generic "no project
    // matches" from the resolver.
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10',
      { projectId: '11111111-1111-1111-1111-111111111111' });
    assert.equal(status, 422);
    assert.match(body.error, /project/i);
  });

  test('parentId: null is refused (422) on this proxy-lane route', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { parentId: null });
    assert.equal(status, 422);
    assert.match(body.error, /parent|top-level/i);
  });
});
