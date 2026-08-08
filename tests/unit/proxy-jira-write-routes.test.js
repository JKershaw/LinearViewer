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
        // LIN-1886 review Blocker 3: ORDINARY Jira prose — a mention, a smart
        // link and an emoji. Every one of these renders to markdown fine, so
        // the old reader-derived gate PERMITTED the write and a 200-OK append
        // flattened the whole body into one anonymous text run.
        id: '30006', key: 'ENG-15',
        fields: {
          summary: 'Ordinary Jira prose the reader can render but the writer cannot rebuild',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [
              { type: 'text', text: 'hi ' },
              { type: 'mention', attrs: { id: 'acc-1', text: '@ada' } },
              { type: 'text', text: ' see ' },
              { type: 'inlineCard', attrs: { url: 'https://example.com/doc' } },
              { type: 'text', text: ' ' },
              { type: 'emoji', attrs: { shortName: ':smile:', text: '🙂' } },
            ] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        // Same blocker, structural half: nesting the writer cannot rebuild at
        // any depth (it would re-emit the child as a flat sibling list).
        id: '30007', key: 'ENG-16',
        fields: {
          summary: 'Nested bullet list',
          description: { type: 'doc', version: 1, content: [
            { type: 'bulletList', content: [
              { type: 'listItem', content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'parent' }] },
                { type: 'bulletList', content: [
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'child' }] }] },
                ] },
              ] },
            ] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      // ---------------------------------------------------------------------
      // LIN-1886 review F1: the five counterexamples the REVIEWER reproduced
      // end-to-end through these same routes, each returning 200 `success:true`
      // with the stored ADF silently rewritten. They are seeded here under the
      // reviewer's own RES-n numbering so the re-review can find them, and
      // asserted below at their post-Option-A dispositions.
      // ---------------------------------------------------------------------
      {
        id: '30010', key: 'RES-1', // "run foo_bar_baz" gained an em mark
        fields: {
          summary: 'Inline underscore run',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'run foo_bar_baz' }] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30011', key: 'RES-2', // the "```js" paragraph vanished entirely
        fields: {
          summary: 'Fence-looking paragraph',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: '```js' }] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30012', key: 'RES-3', // href truncated at the "("
        fields: {
          summary: 'Link with a paren in the href',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [
              { type: 'text', text: 'Foo', marks: [{ type: 'link', attrs: { href: 'https://e.com/wiki/Foo_(bar)' } }] },
            ] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30013', key: 'RES-4', // orderedList order:5 dropped, renumbered 1,2
        fields: {
          summary: 'Ordered list starting at 5',
          description: { type: 'doc', version: 1, content: [
            { type: 'orderedList', attrs: { order: 5 }, content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'fifth' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sixth' }] }] },
            ] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30014', key: 'RES-5', // paragraph promoted to a heading
        fields: {
          summary: 'Heading-looking paragraph',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: '# not a heading' }] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      // ---------------------------------------------------------------------
      // LIN-1886 re-review `5ae61f22`: the two counterexamples found at head
      // `36a53a80`, after the five above were already fixed. Same numbering
      // convention, continued. RES-6 is the one that mattered most — the gate
      // PERMITTED it and the `#` line was silently deleted on a 200 OK.
      // ---------------------------------------------------------------------
      {
        id: '30015', key: 'RES-6', // bare "#" line promoted the paragraph to a heading
        fields: {
          summary: 'Paragraph whose first line is a bare hash',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [
              { type: 'text', text: '#' },
              { type: 'hardBreak' },
              { type: 'text', text: '1  Scope of works' },
            ] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30016', key: 'RES-7', // whitespace-only separator line 422'd although it round-trips
        fields: {
          summary: 'Code block with a stray space on its blank line',
          description: { type: 'doc', version: 1, content: [
            { type: 'codeBlock', attrs: { language: 'python' },
              content: [{ type: 'text', text: 'def a():\n    pass\n \ndef b():\n    pass' }] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30017', key: 'RES-8', // the control: a GENUINELY blank line, still refused
        fields: {
          summary: 'Code block with a truly blank line',
          description: { type: 'doc', version: 1, content: [
            { type: 'codeBlock', attrs: { language: 'python' },
              content: [{ type: 'text', text: 'def a():\n    pass\n\ndef b():\n    pass' }] },
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

describe('Jira-backed proxy writes — the gate is derived from the WRITER (LIN-1886 review Blocker 3)', () => {
  // The exact regression: ordinary Jira content the READER renders happily but
  // the WRITER has no inverse for. Before this fix, every case below returned
  // 200 and destroyed the stored body. Asserted against the FAKE STORE so a
  // regression cannot pass on the response shape alone.

  test('append to a mention/inlineCard/emoji description refuses (422) and the stored ADF is byte-identical', async () => {
    const before = JSON.stringify((await stored('ENG-15')).fields.description);
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/ENG-15/description/append', { block: 'A new note.' });
    assert.equal(status, 422);
    assert.equal(JSON.stringify((await stored('ENG-15')).fields.description), before, 'nothing was written');
  });

  test('a title-only PATCH that resends the description (the public/task-edit.js session-lane shape) refuses rather than flattening it', async () => {
    // public/task-edit.js always resends the full description, so a title-only
    // edit went through the description branch and destroyed the body too.
    const before = JSON.stringify((await stored('ENG-15')).fields.description);
    const { status } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-15',
      { title: 'Renamed', description: 'hi @ada see https://example.com/doc 🙂' });
    assert.equal(status, 422);
    const issue = await stored('ENG-15');
    assert.equal(JSON.stringify(issue.fields.description), before, 'the description was not flattened');
    assert.equal(issue.fields.summary, 'Ordinary Jira prose the reader can render but the writer cannot rebuild',
      'and the title write never happened either (N1 ordering holds)');
  });

  test('a nested bulletList description refuses (422) rather than being rewritten as two flat sibling lists', async () => {
    const before = JSON.stringify((await stored('ENG-16')).fields.description);
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/ENG-16/description/append', { block: 'A new note.' });
    assert.equal(status, 422);
    assert.equal(JSON.stringify((await stored('ENG-16')).fields.description), before, 'the nesting survives');
  });

  test('the READ path is untouched — the same refused issue still renders its mention/card/emoji for display', async () => {
    // `issueDescription` is the route-internal read the write lane itself calls
    // before splicing. Only the WRITE gate tightened; this must be unchanged.
    const read = await jiraProvider.issueDescription(SCOPE, 'ENG-15');
    assert.equal(read.description, 'hi @ada see https://example.com/doc 🙂');
  });
});

describe('Jira-backed proxy PATCH /issues/:id — refusals precede every write (LIN-1886 review N1)', () => {
  test('title + an unresolvable stateId → 422 and the summary is NOT written', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10',
      { title: 'CHANGED', stateId: '11111111-1111-1111-1111-111111111111' });
    assert.equal(status, 422);
    assert.match(body.error, /Cannot resolve state/);
    assert.equal((await stored('ENG-10')).fields.summary, 'Original title', 'the title write never happened');
  });

  test('title + a target with no available transition → 422 and the summary is NOT written', async () => {
    const { status } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-13', { title: 'CHANGED', stateId: 'todo' });
    assert.equal(status, 422);
    const issue = await stored('ENG-13');
    assert.equal(issue.fields.summary, 'Already done, nothing else available', 'the title write never happened');
    assert.equal(issue.fields.status.statusCategory.key, 'done');
  });

  test('title + a screen-required transition → 422 and the summary is NOT written', async () => {
    const { status } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-14', { title: 'CHANGED', stateId: 'done' });
    assert.equal(status, 422);
    assert.equal((await stored('ENG-14')).fields.summary, 'Only transition requires a screen', 'the title write never happened');
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

describe('Jira-backed proxy — the reviewer\'s five end-to-end reproductions (LIN-1886 review F1)', () => {
  // Every one of these returned 200 `success:true` at head `5f3a2855` with the
  // stored ADF silently rewritten. Option A routes four of them to a FAITHFUL
  // round trip (escape / fix the codec) and one to a LOUD 422 (refuse what
  // remains unrebuildable). Each assertion reads the fake store directly, so it
  // witnesses what was actually persisted rather than what the response claimed.

  test('RES-1: an append to "run foo_bar_baz" preserves it byte-for-byte (no invented em mark)', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-1/description/append', { block: 'A new note.' });
    assert.equal(status, 200);
    const content = (await stored('RES-1')).fields.description.content;
    assert.deepEqual(content[0], { type: 'paragraph', content: [{ type: 'text', text: 'run foo_bar_baz' }] },
      'the original paragraph survived unchanged — no em mark invented from the identifier');
    assert.deepEqual(content[1], { type: 'paragraph', content: [{ type: 'text', text: 'A new note.' }] });
  });

  test('RES-2: an append to a "```js" paragraph does not delete its text', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-2/description/append', { block: 'A new note.' });
    assert.equal(status, 200);
    const content = (await stored('RES-2')).fields.description.content;
    assert.deepEqual(content[0], { type: 'paragraph', content: [{ type: 'text', text: '```js' }] },
      'the worst case in the review\'s set: the text used to be DELETED, not merely reinterpreted');
  });

  test('RES-3: an append to a paren-bearing href leaves the link intact', async () => {
    // The reviewer drove this through PATCH, but the destruction happens in the
    // read-modify-write's READ half — which `description/append` exercises with
    // the stored body actually re-written, making the store a true witness.
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-3/description/append', { block: 'A new note.' });
    assert.equal(status, 200);
    const content = (await stored('RES-3')).fields.description.content;
    assert.deepEqual(content[0], { type: 'paragraph', content: [
      { type: 'text', text: 'Foo', marks: [{ type: 'link', attrs: { href: 'https://e.com/wiki/Foo_(bar)' } }] },
    ] }, 'the href no longer truncates at the "(" — it used to persist as ".../Foo_(bar"');
  });

  test('RES-4: an append to an orderedList{order:5} is REFUSED (422) rather than renumbered', async () => {
    const before = JSON.stringify((await stored('RES-4')).fields.description);
    const { status, body } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-4/description/append', { block: 'A new note.' });
    assert.equal(status, 422, 'the writer does not model `order`, so this is a loud refusal, not a lossy 200');
    assert.match(body.error, /numbered list/i, 'the D1 message names this cause (review F3)');
    assert.equal(JSON.stringify((await stored('RES-4')).fields.description), before, 'nothing was written');
  });

  test('RES-5: an append to a "# not a heading" paragraph does not promote it to a heading', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-5/description/append', { block: 'A new note.' });
    assert.equal(status, 200);
    const content = (await stored('RES-5')).fields.description.content;
    assert.deepEqual(content[0], { type: 'paragraph', content: [{ type: 'text', text: '# not a heading' }] },
      'still a paragraph, still carrying its literal "# "');
  });
});

describe('Jira-backed proxy — the re-review\'s two end-to-end reproductions (LIN-1886 re-review 5ae61f22)', () => {
  // Found at head `36a53a80`, i.e. AFTER the five above were fixed, and missed
  // by both the 17-case battery and the generated sweep. Same discipline: the
  // assertion reads the fake store, so it witnesses what was persisted rather
  // than what the 200 claimed.

  test('RES-6: an append to a paragraph whose first line is a bare "#" does not delete that line', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-6/description/append', { block: 'A new note.' });
    assert.equal(status, 200);
    const content = (await stored('RES-6')).fields.description.content;
    assert.deepEqual(content[0], { type: 'paragraph', content: [
      { type: 'text', text: '#' },
      { type: 'hardBreak' },
      { type: 'text', text: '1  Scope of works' },
    ] }, 'the gate permitted this, so the round trip must be FAITHFUL — it used to persist as {heading, level:1} with the "#" line gone');
    assert.deepEqual(content[1], { type: 'paragraph', content: [{ type: 'text', text: 'A new note.' }] });
  });

  test('RES-7: an append to a codeBlock whose blank line carries a stray space succeeds rather than 422ing', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-7/description/append', { block: 'A new note.' });
    assert.equal(status, 200, 'this round-trips perfectly — refusing it was a capability cost with no safety behind it');
    const content = (await stored('RES-7')).fields.description.content;
    assert.deepEqual(content[0], { type: 'codeBlock', attrs: { language: 'python' },
      content: [{ type: 'text', text: 'def a():\n    pass\n \ndef b():\n    pass' }] },
    'the body survived byte-for-byte, stray space included');
    assert.deepEqual(content[1], { type: 'paragraph', content: [{ type: 'text', text: 'A new note.' }] });
  });

  test('RES-8: a TRULY blank separator line is still refused — the fix narrowed the rule, it did not remove it', async () => {
    // The control for RES-7, and the reason this pair is worth seeding rather
    // than deriving: `"\n\n"` really does split the block, so it stays lossy
    // and must stay a loud 422. Note it cannot be built through the markdown
    // lane at all — a PATCH of a fenced body containing a blank line splits
    // into two blocks on the way in, which is precisely the loss being refused.
    const before = JSON.stringify((await stored('RES-8')).fields.description);
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-8/description/append', { block: 'A new note.' });
    assert.equal(status, 422, 'two literal newlines DO split a block, so this remains unrebuildable');
    assert.equal(JSON.stringify((await stored('RES-8')).fields.description), before, 'nothing was written');
  });
});
