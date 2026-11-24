/**
 * LIN-4542 (LIN-4529 P8, plan D7, §7 "Loosened guards"): the size record guard is gone, so a `## Size of the move`
 * section in a description is no longer special. Nothing refuses it and nothing reads it.
 *
 * The guard stood for "the size says what and why, never how" and "a policy never decides a cut". Both now live in the
 * scoping prompt and in records (lib/prompt-template-defs.js scoping; tests/unit/lin-4542-scoping-size-decision.test.js), and
 * the size is a decision record read by the selector and look-first (tests/unit/lin-4370-look-first-route.test.js). This
 * file tries each loosened guard on the REAL proxy write routes over a REAL seeded LocalStore (the
 * tests/unit/lin-4502-description-writes.test.js seam) and reads the stored description back: each write that the guard
 * refused 422 (SIZE_RECORD_HOW, SIZE_RECORD_POLICY_CUT, SIZE_RECORD_SHAPE, SIZE_RECORD_DROPPED) now lands, 200, as written.
 * The plan-heading guard that shares the description read still refuses (LIN-4504), so the read is not dead.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';

// Must match TEST_LOCAL_URL_KEY in routes/proxy.js (and LOCAL_WORKSPACE_URL_KEY).
const LOCAL_URL_KEY = 'local-workspace';
const HEADING = '## Size of the move';
// The section in the shape the guard demanded, then the lines each refusal named.
const SECTION = `${HEADING}\n\n**Size:** just the task\n**Why:** nothing near it binds on this change.\n**Cuts:** none\n**Decided by:** the standing policy`;
const HOW = `${HEADING}\n\n**Size:** just the task\n**Why:** start in \`lib/export.js\` and call exportCsv() first.\n**Cuts:** none\n**Decided by:** the standing policy`;
const POLICY_CUT = `${HEADING}\n\n**Size:** wrong work\n**Why:** the ask is aimed at a symptom.\n**Cuts:** none\n**Decided by:** the standing policy`;
const FIFTH_LINE = `${SECTION}\nNotes weighed: the prompts area's lessons.`;

function proxyApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: LOCAL_URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
    getWorkspaceAccessToken: async () => null,
    agentStatusStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function call(method, path, body) {
  const server = proxyApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/issues/${path}`, {
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

describe('a size section in a description is ordinary text on the proxy lane (LIN-4542)', () => {
  let store;
  beforeEach(async () => {
    ({ store } = createLocalStore());
    await store.seed(LOCAL_URL_KEY, {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
      issues: [
        { id: 'i1', identifier: 'LOCAL-1', title: 'No section', description: 'Make the export button download a CSV.', projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
        { id: 'i2', identifier: 'LOCAL-2', title: 'A section', description: `Make the export button download a CSV.\n\n${SECTION}`, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
      ],
    });
    localProvider.configure({ store });
  });
  const stored = async (id) => (await store.getIssue(LOCAL_URL_KEY, id)).description;

  test('how in the section (a path, a code span, call syntax) lands on PATCH, append and replace (was SIZE_RECORD_HOW)', async () => {
    const patched = await call('PATCH', 'LOCAL-1', { description: `Make the export button download a CSV.\n\n${HOW}` });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.ok((await stored('i1')).includes('`lib/export.js`'));
    const appended = await call('POST', 'LOCAL-2/description/append', { block: '1. first step\n2. second step' });
    assert.equal(appended.status, 200, JSON.stringify(appended.body));
    assert.ok((await stored('i2')).endsWith('1. first step\n2. second step'), 'a numbered step after the section lands too');
    const replaced = await call('POST', 'LOCAL-2/description/replace', { oldString: '**Why:** nothing near it binds on this change.', newString: '**Why:** call exportCsv() in `lib/export.js`.' });
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    assert.ok((await stored('i2')).includes('call exportCsv() in `lib/export.js`.'));
  });

  test('the standing policy deciding wrong work lands (was SIZE_RECORD_POLICY_CUT): a cut is a question now, not a line', async () => {
    const res = await call('PATCH', 'LOCAL-1', { description: `Make the export button download a CSV.\n\n${POLICY_CUT}` });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok((await stored('i1')).includes('**Size:** wrong work'));
  });

  test('a fifth line lands (was SIZE_RECORD_SHAPE)', async () => {
    const res = await call('PATCH', 'LOCAL-1', { description: `Make the export button download a CSV.\n\n${FIFTH_LINE}` });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok((await stored('i1')).endsWith("Notes weighed: the prompts area's lessons."));
  });

  test('dropping a section lands (was SIZE_RECORD_DROPPED)', async () => {
    const res = await call('PATCH', 'LOCAL-2', { description: 'Make the export button download a CSV.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await stored('i2'), 'Make the export button download a CSV.');
  });

  test('the plan-heading guard on the same description read still refuses (LIN-4504): the read is not dead', async () => {
    const res = await call('PATCH', 'LOCAL-1', { description: 'Make the export button download a CSV.\n\n## Implementation Plan\n\nThe plan.' });
    assert.equal(res.status, 422);
    assert.equal(res.body.code, 'PLAN_IN_DESCRIPTION');
    assert.equal(await stored('i1'), 'Make the export button download a CSV.');
  });

  test('the instructions catalogue no longer documents the section or its refusals', () => {
    const text = buildInstructions({ baseUrl: 'https://harbour.example', scope: 'readWrite', grants: ['dispatch'] });
    assert.ok(text.includes('PATCH https://harbour.example/api/proxy/issues/{issueId}'), 'the PATCH entry the size text sat under is rendered');
    assert.ok(!text.includes(HEADING));
    assert.doesNotMatch(text, /SIZE_RECORD_/);
  });
});
