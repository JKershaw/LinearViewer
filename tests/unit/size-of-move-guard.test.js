/**
 * LIN-4368, the size record guard on the proxy's description writes.
 *
 * Drives the REAL proxy write routes over a REAL seeded LocalStore (the
 * tests/unit/as-asked-guard.test.js seam) and reads the stored description back from
 * the store, so a refusal is shown to leave the ticket unchanged:
 *   - PATCH, append, replace and description/below that add or change a
 *     `## Size of the move` section carrying how are refused 422 SIZE_RECORD_HOW naming the line;
 *   - the standing policy deciding "wrong work" is refused 422 SIZE_RECORD_POLICY_CUT;
 *   - (LIN-4369 arm 3) a record that is not its four lines is refused 422 SIZE_RECORD_SHAPE;
 *   - a close-out prune (description/below) whose body drops the section is refused
 *     422 SIZE_RECORD_DROPPED, and a prune that keeps it verbatim succeeds;
 *   - a plain record is accepted, and an unrelated write beside an old section that
 *     breaks the rules is accepted (an unchanged section never blocks);
 *   - the session lane's PATCH is a person's lane and is not guarded.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { sealAsAsked } from '../../lib/as-asked.js';
import { SIZE_OF_MOVE_HEADING, SIZE_RECORD_CODES, DECIDED_BY, WRONG_WORK, recordShape } from '../../lib/size-of-move.js';

// Must match TEST_LOCAL_URL_KEY in routes/proxy.js (and LOCAL_WORKSPACE_URL_KEY).
const LOCAL_URL_KEY = 'local-workspace';

const SEALED = sealAsAsked('Keep it advice (on main: `docs/plans/survey.md`). Write a full guide.');
const RECORD = [
  SIZE_OF_MOVE_HEADING,
  '',
  '**Size:** just the task',
  '**Why:** We do the task as asked, because nothing near it binds on this change.',
  '**Cuts:** none',
  `**Decided by:** ${DECIDED_BY.policy} (err larger)`
].join('\n');
const PLAN = '## Implementation Plan\n\n1. a plan step, outside the record';

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

function sessionApp() {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: LOCAL_URL_KEY, provider: 'local', accessToken: LOCAL_URL_KEY };
      req.session = {};
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {}, workspacePreferencesStore: {},
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {}, dispatchQueueStore: {},
    agentStatusStore: {}, promptTraceStore: {}, proxyTokenStore: {},
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

describe('the size record guard on the proxy lane', () => {
  let store;
  beforeEach(async () => {
    ({ store } = createLocalStore());
    await store.seed(LOCAL_URL_KEY, {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
      issues: [
        // i1: sealed, no record yet. i2: sealed, with a plain record and a plan.
        // i3: an old record that carries a path (written before the guard, or by a person).
        { id: 'i1', identifier: 'LOCAL-1', title: 'No record', description: `${SEALED}\n\n${PLAN}`, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
        { id: 'i2', identifier: 'LOCAL-2', title: 'Record', description: `${SEALED}\n\n${RECORD}\n\n${PLAN}`, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
        { id: 'i3', identifier: 'LOCAL-3', title: 'Old record', description: `${SEALED}\n\n${RECORD}\nStart in lib/size-of-move.js.\n\n${PLAN}`, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
      ],
    });
    localProvider.configure({ store });
  });
  const stored = async (id) => (await store.getIssue(LOCAL_URL_KEY, id)).description;
  const proxy = (method, path, body) => call(proxyApp(), method, `/api/proxy/issues/${path}`, body);

  test('a plain record written below the block is accepted', async () => {
    const res = await proxy('POST', 'LOCAL-1/description/below', { body: `${RECORD}\n\n${PLAN}` });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok((await stored('i1')).includes(RECORD));
  });

  test('append, PATCH, replace and below that add how are refused 422 SIZE_RECORD_HOW naming the line; the store is unchanged', async () => {
    const before = await stored('i1');
    const how = `${RECORD}\nReuse \`outsideAsAsked\` here.`;
    const attempts = [
      proxy('POST', 'LOCAL-1/description/append', { block: how }),
      proxy('PATCH', 'LOCAL-1', { description: `${before}\n\n${how}` }),
      proxy('POST', 'LOCAL-1/description/replace', { oldString: PLAN, newString: `${how}\n\n${PLAN}` }),
      proxy('POST', 'LOCAL-1/description/below', { body: how }),
    ];
    for (const res of await Promise.all(attempts)) {
      assert.equal(res.status, 422, JSON.stringify(res.body));
      assert.equal(res.body.code, SIZE_RECORD_CODES.how);
      assert.equal(res.body.kind, 'code-span');
      assert.deepEqual(res.body.line, { number: 7, text: 'Reuse `outsideAsAsked` here.' });
      assert.match(res.body.error, /what is being done and why, never how: its line 7 carries a code span/);
    }
    assert.equal(await stored('i1'), before);
  });

  test('changing a record to carry numbered steps is refused', async () => {
    const res = await proxy('POST', 'LOCAL-2/description/replace', { oldString: '**Cuts:** none', newString: '**Cuts:** none\n1. add the module\n2. wire the guard' });
    assert.equal(res.status, 422);
    assert.equal(res.body.code, SIZE_RECORD_CODES.how);
    assert.equal(res.body.kind, 'numbered-steps');
  });

  // LIN-4369 arm 3: the record is four lines and nothing else, held here rather than by the prompt alone.
  test('a line beyond the record\'s four is refused 422 SIZE_RECORD_SHAPE naming the line and the four lines; the store is unchanged', async () => {
    const before = await stored('i2');
    const res = await proxy('POST', 'LOCAL-2/description/replace', { oldString: '**Cuts:** none', newString: '**Cuts:** none\nThe trait means what the preamble gates today.' });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, SIZE_RECORD_CODES.shape);
    assert.equal(res.body.kind, 'extra-line');
    assert.deepEqual(res.body.line, { number: 6, text: 'The trait means what the preamble gates today.' });
    assert.ok(res.body.error.includes(`holds four lines and nothing else: its line 6 is not one of the record's lines. The lines: ${recordShape().join(' | ')}.`), res.body.error);
    assert.equal(await stored('i2'), before);
  });

  test('a why of two sentences, and a record missing its cuts line, are refused SIZE_RECORD_SHAPE', async () => {
    const two = await proxy('POST', 'LOCAL-2/description/replace', { oldString: 'binds on this change.', newString: 'binds on this change. The builder defines the trait.' });
    assert.deepEqual([two.status, two.body.code, two.body.kind], [422, SIZE_RECORD_CODES.shape, 'why-sentences']);
    const missing = await proxy('POST', 'LOCAL-2/description/replace', { oldString: '**Cuts:** none\n', newString: '' });
    assert.deepEqual([missing.status, missing.body.code, missing.body.kind], [422, SIZE_RECORD_CODES.shape, 'missing-line']);
    assert.match(missing.body.error, /comes before a line the record is missing \(Cuts\)/);
  });

  test('the standing policy deciding "wrong work" is refused 422 SIZE_RECORD_POLICY_CUT', async () => {
    const res = await proxy('POST', 'LOCAL-2/description/replace', { oldString: '**Size:** just the task', newString: `**Size:** ${WRONG_WORK}` });
    assert.equal(res.status, 422);
    assert.equal(res.body.code, SIZE_RECORD_CODES.policyCut);
    assert.match(res.body.error, /a cut needs a person's ruling/);
  });

  test('a close-out prune that drops the section is refused 422 SIZE_RECORD_DROPPED; one that keeps it verbatim succeeds', async () => {
    const stub = 'Implemented in PR #1 as approved; the full history is in the task snapshots and the comment trail.';
    const dropped = await proxy('POST', 'LOCAL-2/description/below', { body: stub });
    assert.equal(dropped.status, 422);
    assert.equal(dropped.body.code, SIZE_RECORD_CODES.dropped);
    assert.ok((await stored('i2')).includes(PLAN), 'nothing was pruned');

    // LIN-4369 arm 3: text below the record with no heading of its own is inside the section, so the
    // shape check refuses it; close-out's prune line says to put its stub under a heading of its own.
    const glued = await proxy('POST', 'LOCAL-2/description/below', { body: `${RECORD}\n\n${stub}` });
    assert.deepEqual([glued.status, glued.body.code, glued.body.kind], [422, SIZE_RECORD_CODES.shape, 'extra-line']);

    const kept = await proxy('POST', 'LOCAL-2/description/below', { body: `${RECORD}\n\n## Implemented\n\n${stub}` });
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    assert.equal(await stored('i2'), `${SEALED}\n\n${RECORD}\n\n## Implemented\n\n${stub}`);
  });

  test('an unrelated write beside an old section that breaks the rules is accepted', async () => {
    const res = await proxy('POST', 'LOCAL-3/description/append', { block: '## Notes\n\nA note for the next step.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const patch = await proxy('PATCH', 'LOCAL-3', { title: 'Renamed' });
    assert.equal(patch.status, 200);
  });

  test('the session lane is a person\'s lane: its PATCH that drops the section is not guarded', async () => {
    const res = await call(sessionApp(), 'PATCH', `/workspace/${LOCAL_URL_KEY}/api/issues/LOCAL-2`, { description: `${SEALED}\n\nA person rewrote this.` });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await stored('i2'), `${SEALED}\n\nA person rewrote this.`);
  });
});
