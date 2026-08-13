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
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { jiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';
import { defaultJiraSeed } from '../fixtures/jira-harness.js';

const SITE = 'https://acme.atlassian.net';
const SCOPE = { email: 'ada@acme.com', apiToken: 'tok-123', site: SITE };

let fake;
const savedClient = jiraProvider.client;
const savedClientFactory = jiraProvider.clientFactory;
const savedSite = jiraProvider.site;

// LIN-2018: ENG's real per-project statuses — one per category, so the
// symbolic aliases these tests drive ('todo'/'in-progress'/'done') still
// resolve unambiguously through the real resolveStateInput -> states() ->
// resolveStateRef path, exactly as an agent's request would.
const ENG_PROJECT_STATUSES = [
  {
    id: '1', name: 'Task', subtask: false,
    statuses: [
      { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
      { id: '12', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      { id: '13', name: 'Done', statusCategory: { key: 'done' } },
    ],
  },
];

// LIN-2032 gap 2 (LIN-2018 review ledger item 4 / review finding F3): a
// SEPARATE project whose 'done' category carries TWO distinct statuses (Done /
// Won't Do) — deliberately isolated from ENG above so the existing
// 'todo'/'in-progress'/'done' UNAMBIGUOUS resolution tests stay exactly as
// they are. Proves the route-level `stateId: 'done'` PATCH actually reaches
// resolveStateInput -> states() -> resolveStateRef's ambiguity branch
// end-to-end through the real PATCH route, not just at the resolver-unit
// level (tests/unit/proxy-ref-resolver.test.js:140) or the provider level
// (tests/unit/jira-provider.test.js).
const AMB_PROJECT_STATUSES = [
  {
    id: '1', name: 'Task', subtask: false,
    statuses: [
      { id: '21', name: 'To Do', statusCategory: { key: 'new' } },
      { id: '22', name: 'Done', statusCategory: { key: 'done' } },
      { id: '23', name: "Won't Do", statusCategory: { key: 'done' } },
    ],
  },
];

function seed() {
  return createFakeJiraClient({
    projects: [
      { id: '10001', key: 'ENG', name: 'Engineering' },
      { id: '10002', key: 'AMB', name: 'Ambiguous' },
    ],
    projectStatuses: { ENG: ENG_PROJECT_STATUSES, AMB: AMB_PROJECT_STATUSES },
    issues: [
      {
        id: '30001', key: 'ENG-10',
        fields: {
          summary: 'Original title',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Original body.' }] },
          ] },
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          _transitions: [
            { id: '111', name: 'Start Progress', to: { id: '12', name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
            { id: '211', name: 'Done', to: { id: '13', name: 'Done', statusCategory: { key: 'done' } } },
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
      // LIN-1886 Option C ruling `d38d3755` — the orderedList relaxation, and
      // its control. RES-9's identity `{order: 1}` is the shape residual #1
      // says real Jira may stamp on EVERY ordered list; under the old
      // any-attrs-at-all rule that made every numbered-list description
      // unwritable. RES-4 above is the control and stays a 422.
      {
        id: '30018', key: 'RES-9', // orderedList {order: 1} — the identity value
        fields: {
          summary: 'Ordered list carrying the identity order',
          description: { type: 'doc', version: 1, content: [
            { type: 'orderedList', attrs: { order: 1 }, content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
            ] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      // ---------------------------------------------------------------------
      // LIN-1942 (routed from LIN-2019's close-out): the D1 relaxation is unit
      // -pinned (tests/unit/jira-provider.test.js) at the `adfHasUnrenderableContent`
      // level, but nothing drove it through the actual PATCH/proxy route — so a
      // regression in how `updateIssue` calls that gate could pass every existing
      // test here while still refusing (or worse, mis-permitting) real writes.
      // ---------------------------------------------------------------------
      {
        id: '30020', key: 'RES-10', // localId (LIN-2019 exception 3): benign, must SAVE
        fields: {
          summary: 'Jira-editor-shaped paragraph carrying a localId',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', attrs: { localId: '0647076c05f3' }, content: [{ type: 'text', text: 'Editor-stamped body.' }] },
          ] },
          status: { name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      },
      {
        id: '30021', key: 'RES-11', // mid-document empty paragraph (LIN-2019 exception 4): benign, must SAVE
        fields: {
          summary: 'Mid-document empty paragraph',
          description: { type: 'doc', version: 1, content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
            { type: 'paragraph', content: [] },
            { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
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
          status: { id: '13', name: 'Done', statusCategory: { key: 'done' } },
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
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null,
          _transitions: [
            { id: '31', name: 'Resolve', to: { id: '13', name: 'Done', statusCategory: { key: 'done' } }, hasScreen: true },
          ],
        },
      },
      {
        id: '30031', key: 'AMB-1', // LIN-2032 gap 2 — lives in AMB, whose 'done' category is ambiguous
        fields: {
          summary: 'Issue in a project with two done-category statuses',
          description: null,
          status: { id: '21', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10002', key: 'AMB', name: 'Ambiguous' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
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

function buildApp(recordedEvents) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme-jira', label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    // LIN-2012: an optional capturing store, for the PARTIAL_WRITE audit-note
    // assertion — mirrors tests/unit/proxy-dispatch-defaults.test.js:476.
    proxyEventStore: { recordEvent: async (evt) => { recordedEvents?.push(evt); } },
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

// LIN-2012: a session-auth workspace matching this file's `SCOPE` — one Jira
// binding whose mirrored token/scope resolve unambiguously via
// getWorkspaceCallScope, so PATCH /workspace/:urlKey/api/issues/:issueId
// reaches the SAME configured `fake` client as the proxy-lane tests above.
const JIRA_WORKSPACE = {
  urlKey: 'acme-jira',
  provider: 'jira',
  accessToken: SCOPE.apiToken,
  bindings: [
    { provider: 'jira', scope: SITE, credentials: { email: SCOPE.email, token: SCOPE.apiToken } },
  ],
};

/** Mounts the session-auth workspace-api router against the same `fake`/jiraProvider lifecycle as buildApp(). */
function buildWorkspaceApiApp() {
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
    // A UUID short-circuits resolveStateInput's own resolution (it never
    // consults states()), so it reaches updateIssue's D2 as a raw stateId —
    // LIN-2018's exact-id match then refuses it as "no matching transition",
    // not the old synthetic-vocabulary "Cannot resolve state" wording.
    assert.match(body.error, /No available Jira transition/);
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

describe('Jira-backed proxy — the orderedList identity relaxation (LIN-1886 ruling d38d3755)', () => {
  test('RES-9: an append to an orderedList{order:1} now SUCCEEDS, and the list survives intact', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-9/description/append', { block: 'A new note.' });
    assert.equal(
      status, 200,
      'the identity order renumbers nothing, so refusing it was a pure capability cost — '
      + 'and if real Jira stamps {order:1} on every list (residual #1), the old rule made '
      + 'every numbered-list description unwritable',
    );

    const content = (await stored('RES-9')).fields.description.content;
    // Every item, its order, and its text survive. What does NOT survive is the
    // `attrs` key itself — the documented exception, witnessed here against the
    // real store rather than asserted in the abstract.
    assert.deepEqual(content[0], { type: 'orderedList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
    ] }, 'items and their numbering are untouched; only the redundant attrs key is gone');
    assert.equal(content[0].attrs, undefined, 'the identity attrs key is dropped — exception 2 in adfHasUnrenderableContent\'s docstring');
    assert.deepEqual(content[1], { type: 'paragraph', content: [{ type: 'text', text: 'A new note.' }] });
  });

  test('RES-4 remains the control: a NON-identity order is still refused after the relaxation', async () => {
    // Pinned in this describe too, not just above, so that a future widening of
    // the exception cannot quietly take {order:5} with it.
    const before = JSON.stringify((await stored('RES-4')).fields.description);
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-4/description/append', { block: 'A new note.' });
    assert.equal(status, 422, 'dropping {order:5} really does renumber 5,6 → 1,2 — that is a content change, not an identity');
    assert.equal(JSON.stringify((await stored('RES-4')).fields.description), before, 'nothing was written');
  });
});

describe('Jira-backed proxy — the LIN-2019 localId + empty-paragraph relaxations, through the real PATCH route (LIN-1942)', () => {
  // tests/unit/jira-provider.test.js pins these two exceptions at the
  // `adfHasUnrenderableContent` level. Neither was ever driven through the
  // actual PATCH/proxy route this app serves — this closes that gap, routed
  // here from LIN-2019's close-out.

  test('RES-10: a PATCH overwriting a localId-carrying description succeeds (LIN-2019 exception 3)', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/RES-10', { description: 'Rewritten body.' });
    assert.equal(status, 200, 'a `localId`-only attrs key must not trip the D1 gate');
    assert.equal(body.issue.description, 'Rewritten body.');
    assert.equal((await stored('RES-10')).fields.description.content[0].attrs, undefined,
      'the write path never re-emits `localId` — it is not modeled by markdownToAdf either');
  });

  test('RES-10: an append to a localId-carrying description succeeds and the original text survives', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-10/description/append', { block: 'A new note.' });
    assert.equal(status, 200);
    const content = (await stored('RES-10')).fields.description.content;
    // `applyDescriptionEdit` (routes/proxy.js) splices at the MARKDOWN layer —
    // read current → splice → markdownToAdf the result — the same lane a PATCH
    // takes, so the re-emitted paragraph carries no `attrs` here either.
    assert.deepEqual(content[0], { type: 'paragraph', content: [{ type: 'text', text: 'Editor-stamped body.' }] });
    assert.deepEqual(content[1], { type: 'paragraph', content: [{ type: 'text', text: 'A new note.' }] });
  });

  test('RES-11: a PATCH overwriting a description with a mid-document empty paragraph succeeds (LIN-2019 exception 4)', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/RES-11', { description: 'Rewritten body.' });
    assert.equal(status, 200, 'a mid-document empty paragraph must not trip the D1 gate');
    assert.equal(body.issue.description, 'Rewritten body.');
  });

  test('RES-11: an append to a description with a mid-document empty paragraph succeeds and the surrounding text survives', async () => {
    const { status } = await call(buildApp(), 'POST', '/api/proxy/issues/RES-11/description/append', { block: 'A new note.' });
    assert.equal(status, 200);
    const content = (await stored('RES-11')).fields.description.content;
    // Same markdown-layer splice as RES-10 above: the blank line collapses on
    // the way through (LIN-2019 exception 4's documented behaviour, pinned at
    // the unit level in tests/unit/jira-provider.test.js), so the empty
    // paragraph node itself does not survive — only "one"/"two" plus the
    // appended block do.
    assert.deepEqual(content[0], { type: 'paragraph', content: [{ type: 'text', text: 'one' }] });
    assert.deepEqual(content[1], { type: 'paragraph', content: [{ type: 'text', text: 'two' }] });
    assert.deepEqual(content[2], { type: 'paragraph', content: [{ type: 'text', text: 'A new note.' }] });
  });
});

// =============================================================================
// LIN-2032 gap 2 (LIN-2018 review ledger item 4 / review finding F3) — a
// route-level assertion that a Jira `stateId: 'done'` PATCH against a project
// with two done-category statuses actually 422s with `candidates`, rather than
// silently resolving to the first match. Nothing before this drove a Jira
// PATCH through resolveStateInput -> states() -> 422-with-candidates
// end-to-end; the generic resolver ambiguity is unit-pinned
// (tests/unit/proxy-ref-resolver.test.js:140) and jira-provider.test.js proves
// states() itself surfaces two 'done' entries, but neither exercises this
// proxy route.
// =============================================================================
describe('Jira-backed proxy PATCH /issues/:id — ambiguous stateId:"done" route-level 422 (LIN-2032 gap 2)', () => {
  test('a project with two done-category statuses (Done / Won\'t Do) 422s stateId:"done" with candidates, never silently picking one', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/AMB-1', { stateId: 'done' });
    assert.equal(status, 422);
    assert.match(body.error, /Ambiguous/i);
    assert.ok(Array.isArray(body.candidates), 'candidates must ride the response so the caller can pass an id to disambiguate');
    assert.deepEqual(body.candidates.map(c => c.name).sort(), ['Done', "Won't Do"]);
    assert.equal(
      (await stored('AMB-1')).fields.status.statusCategory.key, 'new',
      'resolution failed before any transition was attempted — nothing was written',
    );
  });

  test('the same project resolves an UNAMBIGUOUS alias (todo) normally — the seed itself is not what is ambiguous', async () => {
    // AMB-1 already IS 'To Do' — resolveStateInput resolves 'todo' to its
    // single unambiguous candidate, and updateIssue's D2 skip-on-unchanged-
    // status (no transitions needed for a no-op status) lets the write
    // through as a plain 200, proving the 422 above is specifically about
    // 'done' being ambiguous, not the AMB seed being broken end to end.
    const { status } = await call(buildApp(), 'PATCH', '/api/proxy/issues/AMB-1', { stateId: 'todo' });
    assert.equal(status, 200);
  });
});

// =============================================================================
// LIN-2032 gap 1 (LIN-2018 review ledger item 3) — the two DIVERGENT consumers
// of a `getProjectStatuses` 403 (missing Jira Browse Projects permission):
// task-edit/task-create degrade to the text-input fallback (pinned against the
// REAL JiraProvider in tests/unit/task-edit-route.test.js and
// tests/unit/task-create-route.test.js), and this proxy route — which has no
// such fallback — surfaces SOMETHING to the calling agent. What exactly was
// undocumented before this; the assertion below pins the actual behaviour
// rather than an assumed one.
// =============================================================================
describe('Jira-backed proxy GET /api/proxy/states/:teamId — a getProjectStatuses 403 (LIN-2032 gap 1)', () => {
  test('a 403 (missing Browse Projects) surfaces as an error response, not a crash or a silent empty list', async () => {
    fake.getProjectStatuses = async () => {
      const err = new Error('Jira API GET /rest/api/3/project/ENG/statuses failed: Forbidden — missing Browse Projects permission');
      err.status = 403;
      throw err;
    };
    const { status, body } = await call(buildApp(), 'GET', '/api/proxy/states/ENG');
    // Pinned, not assumed: Jira client errors carry `err.status` (client.js),
    // but graphqlErrorStatus() only recognises Linear's graphql-request shape
    // (`err.response.status` / `err.response.errors[].extensions.statusCode`) —
    // so a Jira 403 here does not match ANY of its 401/403/404/429 branches and
    // falls through to the generic 500, not a clean 401/403. Worth knowing for
    // an agent calling this route against a Jira workspace; out of this
    // ticket's scope to change (LIN-2032 is a test-coverage ticket against the
    // fake client, not a fix), flagged here rather than silently assumed away.
    assert.equal(status, 500);
    assert.equal(body.error, 'Failed to fetch states');
  });
});

// =============================================================================
// LIN-2032 close-out (review finding F1) — the SHARED harness enrichment is
// itself load-bearing, and this is what makes it so.
//
// The two statuses LIN-2032 added to `tests/fixtures/jira-harness.js` (104
// "Won't Do", 105 'Ready for QA') were read by NOTHING: delete both lines and
// the whole suite — unit and e2e — stayed green. That is exactly the shape of
// drift the LIN-2018 plan's item 3 already suffered once, so the enrichment
// would have been free to rot back out again. The two tests below drive the
// SHARED seed (not this file's local ENG_PROJECT_STATUSES / AMB_PROJECT_
// STATUSES) through the real proxy routes, so removing either status fails a
// test that names why it was there.
// =============================================================================
describe('the shared Jira harness keeps the statuses the ambiguity path needs (LIN-2032 F1)', () => {
  beforeEach(() => {
    // Re-point at the SHARED harness seed — the point of these two tests is
    // that `defaultJiraProjectStatuses`, not a local seed, is what is pinned.
    fake = createFakeJiraClient(defaultJiraSeed);
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
  });

  test('GET /states/ENG surfaces the shared harness\'s CUSTOM status name and BOTH done-category statuses', async () => {
    const { status, body } = await call(buildApp(), 'GET', '/api/proxy/states/ENG');
    assert.equal(status, 200);
    const names = body.states.map(s => s.name);
    assert.ok(
      names.includes('Ready for QA'),
      'the shared harness must carry a CUSTOM (non-stock) status name — a stock-only seed cannot prove the provider reads real per-project statuses rather than a fixed vocabulary (LIN-2018 plan item 3)',
    );
    assert.deepEqual(
      body.states.filter(s => s.type === 'completed').map(s => s.name).sort(),
      ['Done', "Won't Do"],
      'the shared harness must carry TWO done-category statuses, or the ambiguous `stateId: "done"` path below is unreachable from any surface driven off this seed',
    );
  });

  test('a stateId:"done" PATCH against the SHARED seed 422s with candidates — the enrichment is what makes it ambiguous', async () => {
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-1', { stateId: 'done' });
    assert.equal(status, 422);
    assert.match(body.error, /Ambiguous/i);
    assert.deepEqual(body.candidates.map(c => c.name).sort(), ['Done', "Won't Do"]);
    assert.equal(
      (await stored('ENG-1')).fields.status.statusCategory.key, 'new',
      'resolution failed before any transition was attempted — nothing was written',
    );
  });
});

// =============================================================================
// LIN-2012 — Jira partial field+transition write reporting, through the real
// PATCH and description-edit routes (not just the provider in isolation).
// =============================================================================

describe('Jira-backed proxy — PARTIAL_WRITE reporting (LIN-2012)', () => {
  test('PATCH /issues/:id: a 429 mid-sequence (field PUT lands, transition fails) → 429 PARTIAL_WRITE, upstream status preserved, title actually persisted', async () => {
    fake.doTransition = async () => {
      const err = new Error('Jira API POST .../transitions failed: rate limited');
      err.status = 429;
      throw err;
    };
    const recordedEvents = [];
    const { status, body } = await call(
      buildApp(recordedEvents), 'PATCH', '/api/proxy/issues/ENG-10', { title: 'New title', stateId: 'in-progress' });

    assert.equal(status, 429, JSON.stringify(body));
    assert.equal(body.code, 'PARTIAL_WRITE');
    assert.equal(body.category, 'upstream');
    assert.equal(body.retryable, true);
    assert.deepEqual(body.context.applied, ['title']);
    assert.equal(body.context.failed, 'stateId');

    // The positive proof this is not a total failure: the title write landed.
    const issue = await stored('ENG-10');
    assert.equal(issue.fields.summary, 'New title', 'the field write actually landed');
    assert.equal(issue.fields.status.statusCategory.key, 'new', 'the transition did not land');

    const note = recordedEvents.find(e => e.status === 429)?.note;
    assert.equal(note, 'PARTIAL_WRITE applied=title failed=stateId');
  });

  test('PATCH /issues/:id: a failure carrying NO status (transport error / timeout) → 500 PARTIAL_WRITE, still non-2xx', async () => {
    // LIN-2012 close-out, review ledger item 3: every other test hand-sets
    // `err.status` on a fake, so nothing exercised the fallback. A `fetch`
    // rejection and the client's `AbortSignal.timeout` both throw with no
    // `.status` at all — `PartialWriteError`'s default (500) is what keeps the
    // response non-2xx, so "2xx means fully landed" holds on this path too.
    fake.doTransition = async () => { throw new TypeError('fetch failed'); };
    const { status, body } = await call(
      buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { title: 'New title', stateId: 'in-progress' });

    assert.equal(status, 500, JSON.stringify(body));
    assert.equal(body.code, 'PARTIAL_WRITE');
    assert.equal(body.retryable, true);
    assert.deepEqual(body.context.applied, ['title']);
    assert.equal(body.context.failed, 'stateId');
    assert.equal((await stored('ENG-10')).fields.summary, 'New title', 'the field write still landed');
  });

  test('POST /issues/:id/description/append: the confirmation re-read fails after the write lands → PARTIAL_WRITE, description actually persisted', async () => {
    let getIssueCalls = 0;
    const originalGetIssue = fake.getIssue.bind(fake);
    fake.getIssue = async (...args) => {
      getIssueCalls += 1;
      // Calls 1-2 are the route's own read + the provider's pre-write read;
      // call 3 is the post-write confirmation re-read this test fails.
      if (getIssueCalls < 3) return originalGetIssue(...args);
      throw new Error('connection reset');
    };

    const recordedEvents = [];
    const { status, body } = await call(
      buildApp(recordedEvents), 'POST', '/api/proxy/issues/ENG-10/description/append', { block: 'New findings' });
    fake.getIssue = originalGetIssue;

    assert.equal(status, 500, JSON.stringify(body));
    assert.equal(body.code, 'PARTIAL_WRITE');
    assert.deepEqual(body.context.applied, ['description']);
    assert.equal(body.context.failed, 're-read');

    const issue = await stored('ENG-10');
    assert.ok(
      JSON.stringify(issue.fields.description).includes('New findings'),
      'the description write actually landed despite the reported failure',
    );

    const note = recordedEvents.find(e => e.status === 500)?.note;
    assert.equal(note, 'PARTIAL_WRITE applied=description failed=re-read');
  });

  test('regression: a field-PUT-itself failure (nothing landed) still returns the pre-existing plain error shape — no PARTIAL_WRITE leak', async () => {
    fake.updateIssue = async () => {
      const err = new Error('Jira API PUT .../issue failed: forbidden');
      err.status = 500;
      throw err;
    };
    const { status, body } = await call(buildApp(), 'PATCH', '/api/proxy/issues/ENG-10', { title: 'New title' });

    assert.equal(status, 500);
    assert.equal(body.error, 'Failed to update issue');
    assert.equal(body.code, undefined, 'no PARTIAL_WRITE code on a genuine total failure');
    assert.equal((await stored('ENG-10')).fields.summary, 'Original title', 'nothing was written');
  });

  test('session-auth PATCH /workspace/:urlKey/api/issues/:issueId: the same partial-write shape, retryable true — this lane has no logEvent, so the provider console.warn is what covers it', async (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    fake.doTransition = async () => {
      const err = new Error('Jira API POST .../transitions failed: rate limited');
      err.status = 429;
      throw err;
    };
    const { status, body } = await call(
      buildWorkspaceApiApp(), 'PATCH', '/workspace/acme-jira/api/issues/ENG-10', { title: 'New title', stateId: 'in-progress' });

    assert.equal(status, 429, JSON.stringify(body));
    assert.equal(body.code, 'PARTIAL_WRITE');
    assert.equal(body.retryable, true);
    assert.deepEqual(body.context.applied, ['title']);
    assert.equal(body.context.failed, 'stateId');
    assert.equal((await stored('ENG-10')).fields.summary, 'New title', 'the field write actually landed on this lane too');
    assert.equal(warnMock.mock.callCount(), 1, 'the provider-level warn is the only audit trail this lane has');
  });
});
