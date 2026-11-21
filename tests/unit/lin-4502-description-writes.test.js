/**
 * LIN-4502 (P2): the proxy's description writes after the As-asked guard and seal are retired. (This file was the
 * guard's own test, tests/unit/as-asked-guard.test.js, LIN-4352; its refusals are what P2 removes.)
 *
 * Drives the REAL proxy write routes over a REAL seeded LocalStore, and over the Jira provider's fake, then reads
 * the stored description straight from the store:
 *   - a PATCH or a replace that changes words inside a legacy `## As asked` block, a PATCH that drops the block,
 *     and a PATCH that adds one, are written as sent (no retired immutable guard): the person's words live on the task's
 *     `asked`, which no description write reaches (tests/unit/lin-4502-witness.test.js pins that side);
 *   - a create whose body holds the heading or end line is filed as written, with no block sealed around it;
 *   - append and replace still splice;
 *   - the write-below route the close-out prune used is gone (LIN-4502 retired the prune): it answers 404;
 *   - a PATCH with a description still makes exactly one issueDescription read (the size record guard's);
 *   - Jira: descriptions are read with the one adfToMarkdown reader and written with markdownToAdf. A block in the
 *     ADF reads back as its rendering, and an orphaned `harbour.asAsked` property is never read and never removed.
 * Every LocalStore case runs on a plain body and on a Linear-style backslash-escaped one.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { jiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';
import { adfToMarkdown, markdownToAdf } from '../../lib/providers/jira/adf.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { quoteAsked, ASKED_HEADING, ASKED_END } from '../../lib/brief-quote.js';

// Must match TEST_LOCAL_URL_KEY in routes/proxy.js (and LOCAL_WORKSPACE_URL_KEY).
const LOCAL_URL_KEY = 'local-workspace';

const WORDS = 'Please write a full guide on how to properly configure it.\nCover **both** modes.';
const BELOW = '## Notes\n\n1. step one';

/** Linear-style storage: markdown punctuation backslash-escaped. */
const linearEscape = (text) => text.replace(/([#*_[\]])/g, '\\$1');

const VARIANTS = [
  { name: 'plain body', store: (t) => t },
  { name: 'Linear-style backslash-escaped body', store: linearEscape },
];

function proxyApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: LOCAL_URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
    getWorkspaceAccessToken: async () => null,
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
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
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
    await new Promise((r) => server.close(r));
  }
}

for (const variant of VARIANTS) {
  describe(`description writes on LocalStore — ${variant.name}`, () => {
    const sealed = variant.store(`${quoteAsked(WORDS)}\n\n${BELOW}`);
    const unsealed = variant.store(`${WORDS}\n\n${BELOW}`);
    let store;

    beforeEach(async () => {
      ({ store } = createLocalStore());
      await store.seed(LOCAL_URL_KEY, {
        projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
        issues: [
          { id: 'i1', identifier: 'LOCAL-1', title: 'Sealed', description: sealed, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
          { id: 'i2', identifier: 'LOCAL-2', title: 'Unsealed', description: unsealed, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
        ],
      });
      localProvider.configure({ store });
    });

    const storedDescription = async (id) => (await store.getIssue(LOCAL_URL_KEY, id)).description;

    test('a PATCH that changes one character inside a legacy block is written as sent', async () => {
      const edited = sealed.replace('full guide', 'fuller guide');
      assert.notEqual(edited, sealed);
      const res = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i1', { description: edited });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(await storedDescription('i1'), edited);
    });

    test('a PATCH that drops the block (a close-out rewrite) is written as sent', async () => {
      const res = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i1', { description: 'A tidy summary of what shipped.' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(await storedDescription('i1'), 'A tidy summary of what shipped.');
    });

    test('a replace inside the block is written', async () => {
      const res = await call(proxyApp(), 'POST', '/api/proxy/issues/i1/description/replace', { oldString: 'full guide', newString: 'thin guide' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok((await storedDescription('i1')).includes('thin guide'));
    });

    test('a PATCH that adds a block to a ticket with none is written as sent', async () => {
      const added = variant.store(quoteAsked('new words'));
      const res = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i2', { description: added });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(await storedDescription('i2'), added);
    });

    test('append succeeds and leaves what was there byte for byte', async () => {
      const res = await call(proxyApp(), 'POST', '/api/proxy/issues/i1/description/append', { block: '## Notes\n\nfound it' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const after = await storedDescription('i1');
      assert.equal(after, `${sealed}\n\n## Notes\n\nfound it`);
    });

    // LIN-4524 (beat 4): restored. The census word 'the write-below route' covers the literal path in source; this pins
    // what a request does: the retired route is not registered, and the stored description is untouched.
    test('the retired write-below route is not registered: 404, store unchanged', async () => {
      const res = await call(proxyApp(), 'POST', '/api/proxy/issues/i1/description/below', { body: 'Shipped in #12.' });
      assert.equal(res.status, 404, JSON.stringify(res.body));
      assert.equal(await storedDescription('i1'), sealed);
    });

    test('a create whose body holds the heading or the end line is filed as written, with no block sealed around it', async () => {
      const app = proxyApp();
      for (const marker of [ASKED_HEADING, ASKED_END]) {
        const description = `intro\n${variant.store(marker)}\nmore`;
        const res = await call(app, 'POST', '/api/proxy/issues', { title: `Filed ${marker.slice(0, 5)}`, description });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.issue.description, description);
      }
      const plain = await call(app, 'POST', '/api/proxy/issues', { title: 'Plain', description: WORDS });
      assert.equal(plain.status, 201, JSON.stringify(plain.body));
      assert.equal(plain.body.issue.description, WORDS, 'no block is sealed around an ordinary body');
    });
  });
}

describe('description writes on LocalStore — the one description read', () => {
  let store;
  const savedRead = localProvider.issueDescription;
  beforeEach(async () => {
    ({ store } = createLocalStore());
    await store.seed(LOCAL_URL_KEY, {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
      issues: [{ id: 'i1', identifier: 'LOCAL-1', title: 'Sealed', description: quoteAsked(WORDS), projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } }],
    });
    localProvider.configure({ store });
  });
  afterEach(() => { localProvider.issueDescription = savedRead; });

  test('a PATCH without description makes no issueDescription read; one with description makes exactly one (the size record guard\'s)', async () => {
    let reads = 0;
    localProvider.issueDescription = async function (...args) { reads += 1; return savedRead.apply(this, args); };
    const titleOnly = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i1', { title: 'Renamed' });
    assert.equal(titleOnly.status, 200, JSON.stringify(titleOnly.body));
    assert.equal(reads, 0, 'other PATCHes are unaffected');
    const withDescription = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i1', { description: 'rewritten' });
    assert.equal(withDescription.status, 200, JSON.stringify(withDescription.body));
    assert.equal(reads, 1, 'one dedicated issueDescription read');
  });
});

// ---------------------------------------------------------------------------
// Jira: one codec each way. The As-asked region (an ADF block plus the harbour.asAsked
// entity property, LIN-4450) is retired: a description reads as adfToMarkdown of its
// ADF and writes as markdownToAdf, and a property the region left on an issue is never
// read and never removed.
// ---------------------------------------------------------------------------

describe('description writes against the Jira fake', () => {
  const SITE = 'https://acme.atlassian.net';
  const SCOPE = { email: 'ada@acme.com', apiToken: 'tok-123', site: SITE };
  const saved = { client: jiraProvider.client, clientFactory: jiraProvider.clientFactory, site: jiraProvider.site };
  const ORPHAN = { v: 1, words: 'words the retired region held', rendered: 'abc123' };
  let fake;

  const issue = (id, key, markdown, extra = {}) => ({
    id, key,
    fields: {
      summary: key, description: markdownToAdf(markdown),
      status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
      project: { id: '10001', key: 'ENG', name: 'Engineering' },
      created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
      labels: [], assignee: null, parent: null, _transitions: [],
    },
    ...extra,
  });

  beforeEach(() => {
    fake = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      projectStatuses: { ENG: [{ id: '1', name: 'Task', subtask: false, statuses: [{ id: '11', name: 'To Do', statusCategory: { key: 'new' } }] }] },
      issues: [
        issue('30001', 'ENG-1', `${WORDS}\n\n${BELOW}`),
        // A ticket the retired region wrote: the block in its ADF, and the property beside it.
        issue('30002', 'ENG-2', `${quoteAsked(WORDS)}\n\n${BELOW}`, { _properties: { 'harbour.asAsked': ORPHAN } }),
      ],
    });
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SITE });
  });
  afterEach(() => Object.assign(jiraProvider, saved));

  function jiraApp() {
    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: 'acme-jira', label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
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

  test('a PATCH that adds a block to a Jira ticket is written as markdownToAdf of what was sent', async () => {
    const res = await call(jiraApp(), 'PATCH', '/api/proxy/issues/ENG-1', { description: quoteAsked('new words') });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual((await fake.getIssue('ENG-1')).fields.description, markdownToAdf(quoteAsked('new words')));
  });

  test('append, replace and an ordinary PATCH on a Jira ticket are written', async () => {
    const app = jiraApp();
    assert.equal((await call(app, 'POST', '/api/proxy/issues/ENG-1/description/append', { block: 'a note' })).status, 200);
    assert.equal((await call(app, 'POST', '/api/proxy/issues/ENG-1/description/replace', { oldString: 'step one', newString: 'step two' })).status, 200);
    assert.equal((await call(app, 'PATCH', '/api/proxy/issues/ENG-1', { description: 'rewritten' })).status, 200);
    assert.equal((await jiraProvider.issueDescription(SCOPE, 'ENG-1')).description, 'rewritten');
  });

  test('a block the region wrote reads back as the plain rendering of its ADF; the orphaned property is never read', async () => {
    const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-2');
    assert.equal(description, adfToMarkdown(markdownToAdf(`${quoteAsked(WORDS)}\n\n${BELOW}`)), 'the one adfToMarkdown reader');
    assert.ok(!description.includes(ORPHAN.words), 'the property\'s words are not served');
    const context = await jiraProvider.fetchIssueContext(SCOPE, 'ENG-2');
    assert.equal(context.issue.description, description, 'the context read agrees');
  });

  test('a write to such a ticket leaves the orphaned harbour.asAsked property alone', async () => {
    const res = await call(jiraApp(), 'PATCH', '/api/proxy/issues/ENG-2', { description: 'rewritten' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const stored = await fake.getIssue('ENG-2', { properties: ['harbour.asAsked'] });
    assert.deepEqual(stored.properties['harbour.asAsked'], ORPHAN, 'neither removed nor rewritten');
    assert.deepEqual(stored.fields.description, markdownToAdf('rewritten'));
  });
});
