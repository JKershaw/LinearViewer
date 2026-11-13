/**
 * LIN-4352, the proxy guard: no step can alter the words.
 *
 * Drives the REAL proxy write routes over a REAL seeded LocalStore (the
 * tests/unit/proxy-local-target.test.js seam), and the session lane's PATCH over
 * the same store, then reads the stored description straight from the store:
 *   - PATCH and a replace that change one character inside the `## As asked` block
 *     are refused 422 AS_ASKED_IMMUTABLE naming the line; the store is unchanged.
 *   - append, a replace below the block and description/below succeed, and the
 *     block's bytes are unchanged.
 *   - description/below on an unsealed ticket is refused 422 NO_AS_ASKED_BLOCK.
 *   - a PATCH that adds a block, and a proxy create carrying a marker line, are refused.
 *   - a session-lane PATCH that edits the block succeeds (a person's lane, unguarded by design).
 * Every case runs twice: on a plain body and on a Linear-style backslash-escaped
 * one (Linear stores `\#\# As asked`, `\*\*` …). The guard compares the two blocks
 * after normalizeEscaping, so a PATCH that writes the block back unescaped over an
 * escaped live block is NOT refused — that case is here too.
 *
 * The guard is also run against the Jira provider's fake. Jira holds the block through
 * the `harbour.asAsked` property (LIN-4450); see the Jira describe block at the end for
 * what that proves and what it does not.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { jiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';
import { adfToMarkdown, markdownToAdf } from '../../lib/providers/jira/adf.js';
import { AS_ASKED_PROPERTY, AS_ASKED_READ } from '../../lib/providers/jira/as-asked-region.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { sealAsAsked, splitAsAsked, AS_ASKED_HEADING, AS_ASKED_END } from '../../lib/as-asked.js';

// Must match TEST_LOCAL_URL_KEY in routes/proxy.js (and LOCAL_WORKSPACE_URL_KEY).
const LOCAL_URL_KEY = 'local-workspace';

const WORDS = 'Please write a full guide on how to properly configure it.\nCover **both** modes.';
const BELOW = '## Implementation Plan\n\n1. step one';

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

/** The session-auth lane over the same LocalStore (the Harbour task-edit page's PATCH). */
function sessionApp() {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: LOCAL_URL_KEY, provider: 'local', accessToken: LOCAL_URL_KEY };
      req.session = {};
      next();
    },
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
  describe(`the guard on LocalStore — ${variant.name}`, () => {
    const sealed = variant.store(`${sealAsAsked(WORDS)}\n\n${BELOW}`);
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
    /** The block's bytes exactly as stored: everything up to the end line. */
    const blockBytes = (description) => {
      const parts = splitAsAsked(description);
      assert.ok(parts, `expected a block in ${JSON.stringify(description)}`);
      return description.slice(0, parts.end);
    };
    const assertRefusedImmutable = (res, lineFragment) => {
      assert.equal(res.status, 422, JSON.stringify(res.body));
      assert.equal(res.body.code, 'AS_ASKED_IMMUTABLE', JSON.stringify(res.body));
      assert.match(res.body.error, /write around it: append, replace a span below the block, or use description\/below/i);
      if (lineFragment) assert.ok(res.body.error.includes(lineFragment), `the message names the line: ${res.body.error}`);
    };

    test('PATCH that changes one character inside the block → 422 AS_ASKED_IMMUTABLE naming the line; store unchanged', async () => {
      const edited = sealed.replace('full guide', 'fuller guide');
      assert.notEqual(edited, sealed);
      const res = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i1', { description: edited });
      assertRefusedImmutable(res, 'Please write a fuller guide');
      assert.equal(res.body.line?.number, 1);
      assert.equal(await storedDescription('i1'), sealed);
    });

    test('PATCH that drops the block (a close-out rewrite) → 422 AS_ASKED_IMMUTABLE; store unchanged', async () => {
      const res = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i1', { description: 'A tidy summary of what shipped.' });
      assertRefusedImmutable(res);
      assert.equal(await storedDescription('i1'), sealed);
    });

    test('replace that changes one character inside the block → 422 AS_ASKED_IMMUTABLE naming the line; store unchanged', async () => {
      const res = await call(proxyApp(), 'POST', '/api/proxy/issues/i1/description/replace', { oldString: 'full guide', newString: 'thin guide' });
      assertRefusedImmutable(res, 'Please write a thin guide');
      assert.equal(await storedDescription('i1'), sealed);
    });

    test('append succeeds and the block bytes are unchanged', async () => {
      const before = blockBytes(sealed);
      const res = await call(proxyApp(), 'POST', '/api/proxy/issues/i1/description/append', { block: '## Notes\n\nfound it' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const after = await storedDescription('i1');
      assert.equal(blockBytes(after), before);
      assert.ok(after.endsWith('## Notes\n\nfound it'));
    });

    test('replace below the block succeeds and the block bytes are unchanged', async () => {
      const before = blockBytes(sealed);
      const res = await call(proxyApp(), 'POST', '/api/proxy/issues/i1/description/replace', { oldString: 'step one', newString: 'step two' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const after = await storedDescription('i1');
      assert.equal(blockBytes(after), before);
      assert.ok(after.includes('step two'));
    });

    test('PATCH that keeps the block and rewrites below it succeeds (the block compares normalised)', async () => {
      // Written back UNESCAPED over a possibly escaped live block: the guard
      // compares both sides after normalizeEscaping, never against a stored copy.
      const res = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i1', { description: `${sealAsAsked(WORDS)}\n\nrewritten below` });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok((await storedDescription('i1')).endsWith('rewritten below'));
    });

    test('description/below replaces everything after the end line and keeps the block exactly as read', async () => {
      const before = blockBytes(sealed);
      const res = await call(proxyApp(), 'POST', '/api/proxy/issues/i1/description/below', { body: 'Shipped in #12.' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.success, true);
      const after = await storedDescription('i1');
      assert.equal(after, `${before}\n\nShipped in #12.`);
      assert.ok(!after.includes('step one'), 'the old text below is gone');
    });

    test('description/below on an unsealed ticket → 422 NO_AS_ASKED_BLOCK naming PATCH; store unchanged', async () => {
      const res = await call(proxyApp(), 'POST', '/api/proxy/issues/i2/description/below', { body: 'x' });
      assert.equal(res.status, 422, JSON.stringify(res.body));
      assert.equal(res.body.code, 'NO_AS_ASKED_BLOCK');
      assert.match(res.body.error, /PATCH/);
      assert.equal(await storedDescription('i2'), unsealed);
    });

    test('PATCH that adds a block to an unsealed ticket → 422 AS_ASKED_IMMUTABLE; store unchanged', async () => {
      const res = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i2', { description: variant.store(sealAsAsked('forged words')) });
      assertRefusedImmutable(res);
      assert.equal(await storedDescription('i2'), unsealed);
    });

    test('proxy create whose body carries a marker line → 422 AS_ASKED_IMMUTABLE, nothing created', async () => {
      const app = proxyApp();
      for (const marker of [AS_ASKED_HEADING, AS_ASKED_END]) {
        const res = await call(app, 'POST', '/api/proxy/issues', { title: 'Forged', description: `intro\n${variant.store(marker)}\nmore` });
        assert.equal(res.status, 422, JSON.stringify(res.body));
        assert.equal(res.body.code, 'AS_ASKED_IMMUTABLE');
      }
      const all = await call(app, 'GET', '/api/proxy/issues');
      assert.ok(!all.body.issues.some((i) => i.title === 'Forged'), 'no issue was created');
    });

    test('a session-lane PATCH that edits the block succeeds (people may edit their own words)', async () => {
      const edited = sealed.replace('full guide', 'short guide');
      const res = await call(sessionApp(), 'PATCH', `/workspace/${LOCAL_URL_KEY}/api/issues/i1`, { description: edited });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(await storedDescription('i1'), edited);
    });
  });
}

describe('the guard on LocalStore — the PATCH guard read', () => {
  let store;
  const savedRead = localProvider.issueDescription;
  beforeEach(async () => {
    ({ store } = createLocalStore());
    await store.seed(LOCAL_URL_KEY, {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
      issues: [{ id: 'i1', identifier: 'LOCAL-1', title: 'Sealed', description: sealAsAsked(WORDS), projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } }],
    });
    localProvider.configure({ store });
  });
  afterEach(() => { localProvider.issueDescription = savedRead; });

  test('a PATCH without description makes no issueDescription read; one with description makes exactly one', async () => {
    let reads = 0;
    localProvider.issueDescription = async function (...args) { reads += 1; return savedRead.apply(this, args); };
    const titleOnly = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i1', { title: 'Renamed' });
    assert.equal(titleOnly.status, 200, JSON.stringify(titleOnly.body));
    assert.equal(reads, 0, 'other PATCHes are unaffected');
    const withDescription = await call(proxyApp(), 'PATCH', '/api/proxy/issues/i1', { description: `${sealAsAsked(WORDS)}\n\nbelow` });
    assert.equal(withDescription.status, 200, JSON.stringify(withDescription.body));
    assert.equal(reads, 1, 'one dedicated issueDescription read');
  });
});

// ---------------------------------------------------------------------------
// The guard against the Jira provider's fake. Jira stores ADF, which renders the
// block's end line as `_…_`, so the exact words live in the harbour.asAsked property
// and the description shows the block formatted (LIN-4450). What the guard can do on
// Jira follows from that:
//   - A block written through the provider reads back as its exact words, and the
//     guard refuses a rewrite that would drop or change it.
//   - A block with no property (a ticket the region reader still recognises) reads
//     back as the block with its rendered words, and the guard holds it the same way.
//   - An ordinary ticket with no block takes ordinary writes, and forging a block on
//     one is refused.
// ---------------------------------------------------------------------------

describe('the guard against the Jira fake', () => {
  const SITE = 'https://acme.atlassian.net';
  const SCOPE = { email: 'ada@acme.com', apiToken: 'tok-123', site: SITE };
  const saved = { client: jiraProvider.client, clientFactory: jiraProvider.clientFactory, site: jiraProvider.site };
  let fake;

  const issue = (id, key, markdown) => ({
    id, key,
    fields: {
      summary: key, description: markdownToAdf(markdown),
      status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
      project: { id: '10001', key: 'ENG', name: 'Engineering' },
      created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
      labels: [], assignee: null, parent: null, _transitions: [],
    },
  });

  beforeEach(() => {
    fake = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      projectStatuses: { ENG: [{ id: '1', name: 'Task', subtask: false, statuses: [{ id: '11', name: 'To Do', statusCategory: { key: 'new' } }] }] },
      issues: [
        issue('30001', 'ENG-1', `${WORDS}\n\n${BELOW}`),
        issue('30002', 'ENG-2', `${sealAsAsked(WORDS)}\n\n${BELOW}`),
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

  test('PATCH that adds a block to a Jira ticket → 422 AS_ASKED_IMMUTABLE; ADF unchanged', async () => {
    const before = structuredClone((await fake.getIssue('ENG-1')).fields.description);
    const res = await call(jiraApp(), 'PATCH', '/api/proxy/issues/ENG-1', { description: sealAsAsked('forged') });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'AS_ASKED_IMMUTABLE');
    assert.deepEqual((await fake.getIssue('ENG-1')).fields.description, before);
  });

  test('append, replace and an ordinary PATCH on a Jira ticket are not refused by the guard', async () => {
    const app = jiraApp();
    assert.equal((await call(app, 'POST', '/api/proxy/issues/ENG-1/description/append', { block: 'a note' })).status, 200);
    assert.equal((await call(app, 'POST', '/api/proxy/issues/ENG-1/description/replace', { oldString: 'step one', newString: 'step two' })).status, 200);
    assert.equal((await call(app, 'PATCH', '/api/proxy/issues/ENG-1', { description: 'rewritten' })).status, 200);
  });

  test('description/below on a Jira ticket → 422 NO_AS_ASKED_BLOCK', async () => {
    const res = await call(jiraApp(), 'POST', '/api/proxy/issues/ENG-1/description/below', { body: 'x' });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'NO_AS_ASKED_BLOCK');
  });

  test('a block on Jira with no harbour.asAsked property reads back as the block, behind canonical markers, and the guard holds it', async () => {
    // ENG-2 is seeded with the block in its ADF and no property (a ticket the region
    // reader must still recognise). The end line comes back in the canonical form.
    const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-2');
    assert.ok(description.includes('## As asked'), 'the heading survives');
    assert.ok(description.includes('*End of what was asked.'), 'the end line is served in its canonical form');
    assert.equal(splitAsAsked(description)?.words, adfToMarkdown(markdownToAdf(WORDS)), 'the words are the rendering, the best a property-less block can give');
    // …so the guard refuses a rewrite that would drop the block.
    const rewrite = await call(jiraApp(), 'PATCH', '/api/proxy/issues/ENG-2', { description: 'rewritten' });
    assert.equal(rewrite.status, 422, JSON.stringify(rewrite.body));
    assert.equal(rewrite.body.code, 'AS_ASKED_IMMUTABLE');
  });

  test('a block written through the provider reads back as its exact words, the property holding them (LIN-4450)', async () => {
    // Markdown the codec does not give back: bullets, emphasis, trailing spaces.
    const LOSSY = '* a\n*em*  \n***x***';
    await jiraProvider.updateIssue(SCOPE, 'ENG-1', { description: sealAsAsked(LOSSY) });
    const { description } = await jiraProvider.issueDescription(SCOPE, 'ENG-1');
    assert.equal(splitAsAsked(description)?.words, LOSSY, 'byte for byte');
    const stored = await fake.getIssue('ENG-1', AS_ASKED_READ);
    assert.equal(stored.properties[AS_ASKED_PROPERTY].words, LOSSY);
    // The guard now protects the words: an ordinary rewrite of the block is refused.
    const rewrite = await call(jiraApp(), 'PATCH', '/api/proxy/issues/ENG-1', { description: 'rewritten' });
    assert.equal(rewrite.status, 422, JSON.stringify(rewrite.body));
  });
});
