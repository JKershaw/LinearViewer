/**
 * LIN-4352 (LIN-4345 plan rev 2, step 6), witness 4 — the create part: code seals
 * the `## As asked` block where a ticket starts.
 *
 * Drives the three create lanes over a REAL seeded LocalStore and reads the stored
 * description back from the store:
 *   - proxy POST /api/proxy/issues
 *   - session POST /workspace/:urlKey/api/issues
 *   - feedback POST /workspace/:urlKey/api/feedback
 * Each stores the filed text verbatim inside the block (plain, and a Linear-style
 * backslash-escaped body). Feedback keeps the message, capture and screenshot
 * inside the block, and the reported-priority line and its triage marker after the
 * end line. A session or feedback body that already holds a marker line is filed
 * unsealed with exactly one log line (the proxy refuses it: beat 1). A provider
 * that cannot hold the block (Jira's ADF round trip) is filed unsealed with its own
 * log line, never reformatted.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { localProvider, LocalProvider } from '../../lib/providers/local/index.js';
import { jiraProvider } from '../../lib/providers/jira/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { sealAsAsked, splitAsAsked, AS_ASKED_HEADING } from '../../lib/as-asked.js';
import { providerHoldsAsAsked } from '../../lib/as-asked-seal.js';
import { FEEDBACK_AUTOPILOT_ORIGIN_NOTE } from '../../routes/workspace-api-feedback.js';

// Must match TEST_LOCAL_URL_KEY in routes/proxy.js (and LOCAL_WORKSPACE_URL_KEY).
const URL_KEY = 'local-workspace';
const TEXT = 'Please write a full guide on how to properly configure it.\nCover **both** modes, and the _edge_ cases.';
const linearEscape = (text) => text.replace(/([#*_[\]])/g, '\\$1');
const VARIANTS = [
  { name: 'plain body', text: TEXT },
  { name: 'Linear-style backslash-escaped body', text: linearEscape(TEXT) },
];
const SHOT = 'https://cdn.example/shot.png';
// Minimal valid PNG magic bytes (the feedback route sniffs them).
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64')}`;

let store;
let logs;
const saved = {};

beforeEach(() => {
  ({ store } = createLocalStore());
  localProvider.configure({ store });
  logs = [];
  for (const level of ['log', 'warn', 'error']) {
    saved[level] = console[level];
    console[level] = (...args) => {
      const line = args.map(String).join(' ');
      if (line.includes('[as-asked]')) logs.push(line);
      else saved[level](...args);
    };
  }
});

afterEach(() => {
  for (const level of ['log', 'warn', 'error']) console[level] = saved[level];
  for (const key of ['supports', 'uploadFile', 'apiWriteFields', 'descriptionRoundTrip']) delete localProvider[key];
});

function proxyApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
    getWorkspaceAccessToken: async () => null,
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

/** Session-auth app: the session create lane and the feedback lane, over the same LocalStore. */
function sessionApp() {
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  app.use(createWorkspaceApiRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { id: 'ws-local', urlKey: URL_KEY, provider: 'local', accessToken: URL_KEY };
      req.session = { accountId: 'acct-owner', features: {} };
      next();
    },
    dispatchQueueStore: { addItem: async () => ({}) },
    proxyTokenStore: {},
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    accountStore: null,
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {},
    agentStatusStore: {}, promptTraceStore: {},
  }));
  return app;
}

async function call(app, method, path, body, { contentType = 'application/json' } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', ...(body ? { 'Content-Type': contentType } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const storedDescription = async (id) => (await store.getIssue(URL_KEY, id)).description;
const createProxy = (description) => call(proxyApp(), 'POST', '/api/proxy/issues', { title: 'Filed', description });
const createSession = (description) => call(sessionApp(), 'POST', `/workspace/${URL_KEY}/api/issues`, { title: 'Filed', description });
const submitFeedback = (payload) => call(sessionApp(), 'POST', `/workspace/${URL_KEY}/api/feedback`, { title: 'Feedback', teamId: 'team-1', ...payload }, { contentType: 'text/plain' });

/** Give the local provider a screenshot upload and a write contract without priority, so feedback files both. */
function feedbackCapableLocal() {
  const base = LocalProvider.prototype;
  localProvider.supports = (cap) => cap === 'uploadFile' || base.supports.call(localProvider, cap);
  localProvider.uploadFile = async () => SHOT;
  localProvider.apiWriteFields = () => base.apiWriteFields.call(localProvider).filter((f) => f !== 'priority');
}

for (const { name, text } of VARIANTS) {
  describe(`witness 4 (create) on LocalStore — ${name}`, () => {
    test('proxy POST /issues stores the text verbatim inside the block', async () => {
      const res = await createProxy(text);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const stored = await storedDescription(res.body.issue.id);
      assert.equal(stored, sealAsAsked(text));
      assert.equal(splitAsAsked(stored).words, text, 'the block holds the filed bytes');
      assert.deepEqual(logs, []);
    });

    test('session POST /api/issues stores the text verbatim inside the block', async () => {
      const res = await createSession(text);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const stored = await storedDescription(res.body.issue.id);
      assert.equal(stored, sealAsAsked(text));
      assert.equal(splitAsAsked(stored).words, text);
      assert.deepEqual(logs, []);
    });

    test('feedback: message, capture and screenshot inside the block; reported priority and triage marker after the end line', async () => {
      feedbackCapableLocal();
      const res = await submitFeedback({ message: `  ${text}  `, url: 'https://harbour.test/workspace/acme/swipe', userAgent: 'iPhone Safari', image: PNG, priority: 1 });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const stored = await storedDescription(res.body.issue.id);
      const parts = splitAsAsked(stored);
      assert.ok(parts, `expected a block in ${JSON.stringify(stored)}`);
      assert.equal(parts.before, '', 'the block opens the description');
      assert.equal(parts.words,
        `${text}\n\n---\n- **Page:** \`https://harbour.test/workspace/acme/swipe\`\n- **Browser:** \`iPhone Safari\`\n\n![](${SHOT})`,
        'the (trimmed) message, the capture and the screenshot, verbatim inside the block');
      assert.match(parts.below, /\*\*Reported priority:\*\* Urgent/);
      assert.match(parts.below, /Origin — raw feedback \(triage first\)/);
      assert.ok(parts.below.indexOf('Reported priority') < parts.below.indexOf('Origin — raw feedback'), 'the triage marker stays last');
      assert.doesNotMatch(parts.words, /Reported priority|Origin — raw feedback/);
      assert.deepEqual(logs, []);
    });
  });
}

describe('witness 4 (create) on LocalStore — bodies that already hold a marker line are filed unsealed', () => {
  test('session create: filed as written, with exactly one log line', async () => {
    const body = `My notes\n${linearEscape(AS_ASKED_HEADING)}\nmore`;
    const res = await createSession(body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(await storedDescription(res.body.issue.id), body, 'filed unsealed, byte for byte');
    assert.equal(logs.length, 1, JSON.stringify(logs));
    assert.match(logs[0], /\[as-asked\] filed unsealed: .*marker line/);
  });

  test('feedback: filed in today\'s layout (no block), with exactly one log line', async () => {
    const res = await submitFeedback({ message: `It broke\n${AS_ASKED_HEADING}\nhere` });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const stored = await storedDescription(res.body.issue.id);
    assert.equal(splitAsAsked(stored), null);
    assert.ok(stored.startsWith(`It broke\n${AS_ASKED_HEADING}\nhere`), 'the message is filed as written');
    assert.match(stored, /Origin — raw feedback \(triage first\)/, 'the triage marker is still filed');
    assert.equal(logs.length, 1, JSON.stringify(logs));
    assert.match(logs[0], /\[as-asked\] filed unsealed: .*marker line/);
  });

  test('an empty description is not sealed (nothing was asked in words) and logs nothing', async () => {
    const res = await createSession(undefined);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(!(await storedDescription(res.body.issue.id)), 'no description, no block');
    assert.deepEqual(logs, []);
  });
});

describe('witness 4 (create) — a provider that cannot hold the block is skipped, with its own log line', () => {
  test('the Jira provider cannot hold the block (its ADF round trip turns the end line into _…_); Local and GitHub-style verbatim stores can', () => {
    assert.equal(typeof jiraProvider.descriptionRoundTrip, 'function', 'Jira declares its markdown round trip');
    assert.equal(providerHoldsAsAsked(jiraProvider, sealAsAsked(TEXT)), false);
    assert.equal(providerHoldsAsAsked(localProvider, sealAsAsked(TEXT)), true);
  });

  for (const [lane, create] of [['proxy', createProxy], ['session', createSession]]) {
    test(`${lane} create on a provider with Jira's round trip: filed unsealed and verbatim, one "seal skipped" log line`, async () => {
      // Jira has no createIssue today, so no create lane reaches it. The seam is
      // driven here with Jira's own round trip on the LocalStore provider.
      localProvider.descriptionRoundTrip = (md) => jiraProvider.descriptionRoundTrip(md);
      const res = await create(TEXT);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(await storedDescription(res.body.issue.id), TEXT, 'the text is filed as written, never reformatted');
      assert.equal(logs.length, 1, JSON.stringify(logs));
      assert.match(logs[0], /\[as-asked\] seal skipped: provider local cannot hold the block/);
    });
  }

  test('feedback on such a provider: today\'s layout, one "seal skipped" log line', async () => {
    localProvider.descriptionRoundTrip = (md) => jiraProvider.descriptionRoundTrip(md);
    const res = await submitFeedback({ message: 'It broke' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const stored = await storedDescription(res.body.issue.id);
    assert.equal(splitAsAsked(stored), null);
    assert.ok(stored.startsWith('It broke'));
    assert.equal(logs.length, 1, JSON.stringify(logs));
    assert.match(logs[0], /\[as-asked\] seal skipped: provider local cannot hold the block/);
  });
});

// LIN-4353 (LIN-4345 plan step 9): the feedback → autopilot note no longer calls the
// report "a starting hypothesis, not a specification". The report is sealed in the
// block above, as the person's own words: the run works out what they need from it,
// and says so when a fix they suggest looks wrong instead of quietly narrowing it.
test('the feedback → autopilot note reads the sealed block as the person\'s own report', () => {
  assert.match(FEEDBACK_AUTOPILOT_ORIGIN_NOTE, /`## As asked` block is the person's own report/);
  assert.match(FEEDBACK_AUTOPILOT_ORIGIN_NOTE, /where a fix they suggest looks wrong, say so rather than quietly narrowing the report/);
  assert.doesNotMatch(FEEDBACK_AUTOPILOT_ORIGIN_NOTE, /starting hypothesis|not a specification/);
  assert.ok(FEEDBACK_AUTOPILOT_ORIGIN_NOTE.includes(AS_ASKED_HEADING), 'the note names the marker the seal writes');
});
