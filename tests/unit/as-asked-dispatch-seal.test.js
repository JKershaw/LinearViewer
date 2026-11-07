/**
 * LIN-4352, the first-dispatch seal: a ticket filed outside Harbour is sealed at its TRUE first dispatch, by
 * `createDispatchItem` (lib/dispatch-factory.js), through the lane's own provider
 * access (`issueAccess`).
 *
 * Everything runs on a REAL LocalStore (the issues) and a REAL DispatchQueueStore
 * over mock collections (the queue and history), reading the stored description
 * back from the LocalStore:
 *   - a dispatch on a fresh issue seals it, on every lane that names one: session,
 *     proxy, the recommend override arm, the recommend descent arm (the row's
 *     TERMINAL issue is sealed, not the one the caller named) and kickoff;
 *   - a second dispatch does not seal again; a feedback dispatch leaves its
 *     already-sealed ticket's bytes unchanged;
 *   - none of these seal: an issue whose only earlier row is in history; one with an
 *     earlier row still queued; a description that already holds a plan heading,
 *     session-fit phrase or `plan-review due:` line; an empty description; an issue
 *     whose history read throws; a dispatch the duplicate guard refuses;
 *   - no issueAccess logs `seal skipped: no access` and still enqueues; a provider write
 *     that fails or hangs still enqueues and logs it; the Jira fake is skipped,
 *     unreformatted.
 * And the entrance census: every `createDispatchItem(` caller (and every
 * `enqueueRow(` lane, which forwards to it) passes `issueAccess` or is on the
 * never-first list with its reason.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { LocalProvider, localProvider } from '../../lib/providers/local/index.js';
import { jiraProvider } from '../../lib/providers/jira/index.js';
import { createFakeJiraClient } from '../../lib/providers/jira/fake-client.js';
import { markdownToAdf } from '../../lib/providers/jira/adf.js';
import { sealAsAsked, splitAsAsked } from '../../lib/as-asked.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// The recommend and kickoff arms answer from testMockData under this token (their test
// mode), so the LocalStore partition is keyed by it too: TEST-1 is a started container
// whose open child is TEST-2, so the descent lands on TEST-2.
const TOKEN = 'test-token';
const URL_KEY = 'acme';
const WORDS = 'Please write a full guide on how to properly configure it.\nCover **both** modes.';

let issues; // LocalStore
let provider; // LocalProvider over it
let queue;
let history;
let store; // DispatchQueueStore
let logs;
const saved = {};

async function seedIssues(descriptions = {}) {
  ({ store: issues } = createLocalStore());
  await issues.seed(TOKEN, {
    projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
    issues: [
      { id: 'i1', identifier: 'TEST-1', title: 'Container', description: descriptions['TEST-1'] ?? WORDS, projectId: 'p1', state: { name: 'In Progress', type: 'started' } },
      { id: 'i2', identifier: 'TEST-2', title: 'Child', parentId: 'i1', description: descriptions['TEST-2'] ?? `${WORDS} (child)`, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
    ],
  });
  provider = new LocalProvider({ store: issues });
}

beforeEach(async () => {
  await seedIssues();
  queue = createMockCollection();
  history = createMockCollection();
  store = new DispatchQueueStore({ collection: queue, historyCollection: history });
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
});

const described = async (identifier) => (await issues.getIssue(TOKEN, identifier)).description;
const localAccess = () => () => ({ provider, token: TOKEN });
/** The LocalProvider over the seeded issues, with its own `updateIssue` replaced. */
const withUpdateIssue = (updateIssue) => Object.create(provider, { updateIssue: { value: updateIssue } });
const queuedRows = async () => queue.find({}).toArray();

/** One fresh dispatch straight through the factory. */
function dispatch({ issueIdentifier = 'TEST-1', issueAccess = localAccess(), kind = 'research', onStore = store, ...rest } = {}) {
  return createDispatchItem({
    store: onStore,
    urlKey: URL_KEY,
    kind,
    prompt: 'do the work',
    fields: { promptName: 'Research', issueIdentifier, target: 'cli' },
    issueAccess,
    ...rest,
  });
}

// ---------------------------------------------------------------------------
// The factory decides
// ---------------------------------------------------------------------------

describe('first-dispatch seal — the factory seals a fresh issue once, and only then', () => {
  test('a first dispatch on a fresh issue seals its description verbatim, then enqueues', async () => {
    await dispatch();
    assert.equal(await described('TEST-1'), sealAsAsked(WORDS));
    assert.equal((await queuedRows()).length, 1);
    assert.ok(logs.some((l) => l.includes('[as-asked] sealed at first dispatch')), JSON.stringify(logs));
  });

  test('a Linear-style backslash-escaped description is sealed verbatim', async () => {
    const escaped = WORDS.replace(/([#*_[\]])/g, '\\$1');
    await seedIssues({ 'TEST-1': escaped });
    await dispatch();
    assert.equal(await described('TEST-1'), sealAsAsked(escaped));
    assert.equal(splitAsAsked(await described('TEST-1')).words, escaped);
  });

  test('a second dispatch does not seal again (the bytes stay as the first seal left them)', async () => {
    await dispatch();
    const once = await described('TEST-1');
    await dispatch({ kind: 'plan' });
    assert.equal(await described('TEST-1'), once);
    assert.equal(logs.filter((l) => l.includes('sealed at first dispatch')).length, 1);
  });

  test('no seal when the only earlier row is in history (taken, then archived)', async () => {
    await history.insertOne({ _id: 'old', urlKey: URL_KEY, issueIdentifier: 'TEST-1', dispatchedAt: new Date('2026-01-01') });
    await dispatch();
    assert.equal(await described('TEST-1'), WORDS);
    assert.equal((await queuedRows()).length, 1, 'still enqueued');
  });

  test('no seal when an earlier row is still queued', async () => {
    await queue.insertOne({ _id: 'waiting', urlKey: URL_KEY, issueIdentifier: 'TEST-1', kind: 'triage', prompt: 'p', dispatchedAt: new Date('2026-01-01') });
    await dispatch();
    assert.equal(await described('TEST-1'), WORDS);
  });

  for (const [what, text] of [
    ['an `## Implementation Plan` heading', `${WORDS}\n\n## Implementation Plan\n\n1. step`],
    ['a session-fit phrase', `${WORDS}\n\nSession fit: fits one session`],
    ['a `plan-review due:` line', `${WORDS}\n\nplan-review due: no`],
  ]) {
    test(`no seal when a row-less description already holds ${what}`, async () => {
      await seedIssues({ 'TEST-1': text });
      await dispatch();
      assert.equal(await described('TEST-1'), text);
    });
  }

  test('no seal on an empty description', async () => {
    await seedIssues({ 'TEST-1': '' });
    await dispatch();
    assert.equal(await described('TEST-1'), '');
    assert.equal((await queuedRows()).length, 1);
  });

  test('no seal when the history read throws (fails closed), and it is logged', async () => {
    history.findOne = async () => { throw new Error('history down'); };
    await dispatch();
    assert.equal(await described('TEST-1'), WORDS);
    assert.equal((await queuedRows()).length, 1, 'still enqueued');
    assert.ok(logs.some((l) => l.includes('[as-asked] seal failed: could not read earlier dispatches')), JSON.stringify(logs));
  });

  test('no seal on a dispatch the duplicate guard refuses', async () => {
    // A recent identical fresh dispatch, as the guard sees it; the earlier-row read is
    // left saying "none" so only the guard's refusal can be what stops the seal.
    const guarded = Object.create(store);
    guarded.findRecentFreshDispatch = async () => ({ id: 'recent', dispatchedAt: new Date() });
    guarded.hasDispatchForIssue = async () => false;
    await assert.rejects(dispatch({ onStore: guarded }), (err) => err.duplicateDispatch != null);
    assert.equal(await described('TEST-1'), WORDS);
    assert.equal((await queuedRows()).length, 0);
  });

  test('a follow-up row never seals and logs nothing', async () => {
    await createDispatchItem({ store, urlKey: URL_KEY, prompt: 'next', fields: { followUpTo: 'parent-1', issueIdentifier: 'TEST-1', target: 'cli' } });
    assert.equal(await described('TEST-1'), WORDS);
    assert.deepEqual(logs, []);
  });
});

describe('first-dispatch seal — no access, failed and hung writes still enqueue', () => {
  test('no issueAccess: logs `seal skipped: no access`, enqueues, leaves the ticket alone', async () => {
    await dispatch({ issueAccess: null });
    assert.equal(await described('TEST-1'), WORDS);
    assert.equal((await queuedRows()).length, 1);
    assert.ok(logs.some((l) => l.includes('[as-asked] seal skipped: no access')), JSON.stringify(logs));
  });

  test('a lane resolver with no token: also `seal skipped: no access`', async () => {
    await dispatch({ issueAccess: () => ({ provider, token: null }) });
    assert.equal(await described('TEST-1'), WORDS);
    assert.ok(logs.some((l) => l.includes('[as-asked] seal skipped: no access')), JSON.stringify(logs));
  });

  test('a write that throws: enqueues and logs `seal failed`', async () => {
    const failing = withUpdateIssue(async () => { throw new Error('provider refused'); });
    await dispatch({ issueAccess: () => ({ provider: failing, token: TOKEN }) });
    assert.equal((await queuedRows()).length, 1);
    assert.ok(logs.some((l) => l.includes('[as-asked] seal failed: write failed (provider refused)')), JSON.stringify(logs));
  });

  test('a write the provider does not accept: enqueues and logs `seal failed`', async () => {
    const refusing = withUpdateIssue(async () => ({ success: false, issue: null }));
    await dispatch({ issueAccess: () => ({ provider: refusing, token: TOKEN }) });
    assert.equal((await queuedRows()).length, 1);
    assert.ok(logs.some((l) => l.includes('[as-asked] seal failed: write was not accepted')), JSON.stringify(logs));
  });

  test('a write that hangs past the cap: enqueues and logs "seal timed out (write may still land)"', async () => {
    const hanging = withUpdateIssue(() => new Promise(() => {}));
    const started = Date.now();
    await dispatch({ issueAccess: () => ({ provider: hanging, token: TOKEN }), sealTimeoutMs: 50 });
    assert.ok(Date.now() - started < 2000, 'bounded by the cap');
    assert.equal((await queuedRows()).length, 1);
    assert.ok(logs.some((l) => l.includes('[as-asked] seal timed out (write may still land)')), JSON.stringify(logs));
  });

  test('the write is keyed by the id the read returned, and both get the row\'s identifier', async () => {
    // Recorded at the provider: the key each read asked for, and for each write the
    // issue its id lands on (looked up in the store) beside the id itself.
    const seen = [];
    const recording = Object.create(provider, {
      issueDescription: { value: async (token, key) => { seen.push(['read', key]); return provider.issueDescription(token, key); } },
      updateIssue: { value: async (token, id, patch) => { seen.push(['write', (await issues.getIssue(TOKEN, id))?.identifier, id]); return provider.updateIssue(token, id, patch); } },
    });
    await dispatch({ issueIdentifier: 'TEST-2', issueAccess: () => ({ provider: recording, token: TOKEN }) });
    assert.deepEqual(seen, [['read', 'TEST-2'], ['write', 'TEST-2', 'i2']]);
    assert.equal(await described('TEST-2'), sealAsAsked(`${WORDS} (child)`));
  });

  // The write must use the id the read returned, checked through a provider that is strict
  // about it: LocalStore
  // accepts either key, so the test above cannot tell `id` from `issueIdentifier`.
  // This provider takes its write ONLY by the id its read returned (as Linear's
  // uuid, GitHub's and Jira's own ids do).
  test('the seal writes by the id issueDescription returned, not the identifier', async () => {
    const written = [];
    const fake = {
      name: 'fake',
      async issueDescription(token, identifier) {
        return identifier === 'TEST-9' ? { id: 'uuid-9', description: 'words' } : null;
      },
      async updateIssue(token, id, input) {
        if (id !== 'uuid-9') return { success: false, issue: null };
        written.push(input.description);
        return { success: true, issue: { id, description: input.description } };
      },
    };
    await dispatch({ issueIdentifier: 'TEST-9', issueAccess: () => ({ provider: fake, token: 't' }) });
    assert.ok(logs.some((l) => l.includes('[as-asked] sealed at first dispatch')), JSON.stringify(logs));
    assert.deepEqual(written, [sealAsAsked('words')]);
    assert.equal((await queuedRows()).length, 1);
  });
});

describe('first-dispatch seal — the Jira fake', () => {
  const SCOPE = { email: 'ada@acme.com', apiToken: 'tok', site: 'https://acme.atlassian.net' };
  const kept = { client: jiraProvider.client, clientFactory: jiraProvider.clientFactory, site: jiraProvider.site };
  afterEach(() => Object.assign(jiraProvider, kept));

  test('a first dispatch on a Jira ticket is skipped with its own log line; the ADF is untouched', async () => {
    const fake = createFakeJiraClient({
      projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
      issues: [{
        id: '30001', key: 'ENG-1',
        fields: {
          summary: 'Jira ticket', description: markdownToAdf(WORDS),
          status: { id: '11', name: 'To Do', statusCategory: { key: 'new' } },
          project: { id: '10001', key: 'ENG', name: 'Engineering' },
          created: '2026-01-01T00:00:00.000Z', duedate: null, resolutiondate: null,
          labels: [], assignee: null, parent: null, _transitions: [],
        },
      }],
    });
    jiraProvider.configure({ client: fake, clientFactory: () => fake, site: SCOPE.site });
    const before = structuredClone((await fake.getIssue('ENG-1')).fields.description);
    await dispatch({ issueIdentifier: 'ENG-1', issueAccess: () => ({ provider: jiraProvider, token: SCOPE }) });
    assert.deepEqual((await fake.getIssue('ENG-1')).fields.description, before, 'never reformatted');
    assert.equal((await queuedRows()).length, 1);
    assert.ok(logs.some((l) => l.includes('[as-asked] seal skipped: provider jira cannot hold the block')), JSON.stringify(logs));
  });
});

// ---------------------------------------------------------------------------
// Every lane that names an issue seals it
// ---------------------------------------------------------------------------

async function call(app, method, path, body, headers = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method, headers: { Authorization: 'Bearer anything', ...headers } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function proxyApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    provider,
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({ grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: TOKEN, reason: 'ok', provider: 'local', source: 'session-scan', expiresAt: Date.now() + 3600_000 }),
    getWorkspaceAccessToken: async () => TOKEN,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: store,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

function sessionApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { accountId: 'acct-1' }; next(); });
  app.use(createDispatchRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    provider,
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, _res, next) => { req.workspace = { urlKey: req.params.urlKey, id: 'ws-1', accessToken: TOKEN }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    dispatchPresetsStore: {},
    proxyTokenStore: {},
  }));
  return app;
}

const LANES = [
  ['session', () => call(sessionApp(), 'POST', `/workspace/${URL_KEY}/api/dispatch`, { prompt: 'real work', issueIdentifier: 'TEST-1', appendProxyContext: false }), 'TEST-1'],
  ['proxy', () => call(proxyApp(), 'POST', '/api/proxy/dispatch', { prompt: 'real work', issueIdentifier: 'TEST-1', appendProxyContext: false }), 'TEST-1'],
  ['recommend override', () => call(proxyApp(), 'POST', '/api/proxy/recommend-and-dispatch', { issueIdentifier: 'TEST-1', kind: 'research', appendProxyContext: false }), 'TEST-1'],
  ['recommend descent', () => call(proxyApp(), 'POST', '/api/proxy/recommend-and-dispatch', { issueIdentifier: 'TEST-1', appendProxyContext: false }), 'TEST-2'],
  ['kickoff', () => call(proxyApp(), 'POST', '/api/proxy/autopilot/kickoff', { issueIdentifier: 'TEST-1', goal: 'walk it', appendProxyContext: false }), 'TEST-1'],
];

describe('first-dispatch seal — every lane that names an issue seals it, through its own access', () => {
  for (const [lane, run, sealed] of LANES) {
    test(`${lane}: a first dispatch seals ${sealed}`, async () => {
      const before = { 'TEST-1': await described('TEST-1'), 'TEST-2': await described('TEST-2') };
      const res = await run();
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const [row] = await queuedRows();
      assert.equal(row?.issueIdentifier, sealed, 'the row names the issue the seal must land on');
      assert.equal(await described(sealed), sealAsAsked(before[sealed]), `${lane} sealed ${sealed}: ${JSON.stringify(logs)}`);
      const other = sealed === 'TEST-1' ? 'TEST-2' : 'TEST-1';
      assert.equal(await described(other), before[other], `${lane} must not seal ${other}`);
      assert.ok(!logs.some((l) => l.includes('no access')), `the lane passes its access: ${JSON.stringify(logs)}`);
    });
  }
});

describe('first-dispatch seal — feedback\'s dispatch on its already-sealed ticket', () => {
  const kept = {};
  beforeEach(() => {
    localProvider.configure({ store: issues });
    kept.store = issues;
  });

  test('a feedback triage dispatch leaves the sealed ticket\'s bytes unchanged and passes its access', async () => {
    const app = express();
    app.use(express.json({ limit: '250kb' }));
    app.use(createWorkspaceApiRoutes({
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      workspaceFromUrl: (req, _res, next) => {
        req.workspace = { id: 'ws-local', urlKey: URL_KEY, provider: 'local', accessToken: TOKEN };
        req.session = { accountId: 'acct-owner', features: {} };
        next();
      },
      dispatchQueueStore: store,
      proxyTokenStore: {
        createToken: async () => ({ token: 'rw', scope: 'readWrite' }),
        mintGrantBootstrap: async (args) => ({ token: 'rw', scope: 'readWrite', grants: args.grants }),
      },
      freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
      accountStore: null,
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {},
      agentStatusStore: {}, promptTraceStore: {},
    }));
    const res = await call(app, 'POST', `/workspace/${URL_KEY}/api/feedback`,
      { title: 'Feedback', teamId: 'team-1', message: 'It broke', action: 'triage' }, { 'Content-Type': 'text/plain' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const filed = await issues.getIssue(TOKEN, res.body.issue.id);
    assert.ok(splitAsAsked(filed.description), 'sealed at create');
    const rows = await queuedRows();
    assert.equal(rows.length, 1, 'the triage row was enqueued');
    assert.equal(rows[0].issueIdentifier, filed.identifier);
    assert.equal((await issues.getIssue(TOKEN, res.body.issue.id)).description, filed.description, 'bytes unchanged');
    assert.ok(!logs.some((l) => l.includes('no access') || l.includes('sealed at first dispatch')), JSON.stringify(logs));
  });
});

// ---------------------------------------------------------------------------
// The entrance census
// ---------------------------------------------------------------------------

// Callers that never start a ticket, so they pass no issueAccess. Each reason says why
// that caller can never make a ticket's first dispatch; a caller that stops matching its
// reason belongs off this list.
const NEVER_FIRST = {
  'lib/follow-up-dispatch.js': 'always carries followUpTo: a follow-up beat, never a first row',
  'lib/chat-tools.js': 'always carries followUpTo: a Task Chat follow-up, never a first row',
  'routes/collective.js': 'names no issue (a collective fan-out)',
  'lib/dispatch-entrance.js#periodical-mint': 'names no issue (attachIssue: null; a periodical mint)',
};

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(ROOT, dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(join(dir, name)));
    else if (name.endsWith('.js')) out.push(join(dir, name));
  }
  return out;
}

/** The text of each call's argument object, brace-matched from `<name>({` / `<name>(run, {`. */
function callArguments(src, name) {
  const calls = [];
  const re = new RegExp(`\\b${name}\\((?:run, )?\\{`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, m.index))) continue; // a comment, not a call
    if (/function\s+$|async\s+function\s+$/.test(src.slice(lineStart, m.index))) continue; // the declaration
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    calls.push({ at: src.slice(0, m.index).split('\n').length, text: src.slice(m.index, i + 1) });
  }
  return calls;
}

describe('first-dispatch seal — the entrance census', () => {
  test('every createDispatchItem( caller in lib/routes passes issueAccess or is never-first with a reason', () => {
    const found = [];
    for (const file of [...sourceFiles('lib'), ...sourceFiles('routes')]) {
      if (file === join('lib', 'dispatch-factory.js')) continue;
      const src = readFileSync(join(ROOT, file), 'utf8');
      for (const c of callArguments(src, 'createDispatchItem')) found.push({ file: relative('.', file), ...c });
    }
    assert.ok(found.length >= 6, `the census must find the callers, found ${found.length}`);
    const missing = found.filter((c) => !/\bissueAccess\b/.test(c.text) && !NEVER_FIRST[c.file]);
    assert.deepEqual(missing.map((c) => `${c.file}:${c.at}`), [],
      'each of these must pass issueAccess, or be added to NEVER_FIRST with the reason it can never make a first row');
  });

  test('every enqueueRow( lane passes issueAccess, except the periodical mint (no issue)', () => {
    const src = readFileSync(join(ROOT, 'lib/dispatch-entrance.js'), 'utf8');
    const lanes = callArguments(src, 'enqueueRow');
    assert.ok(lanes.length >= 6, `the census must find the lanes, found ${lanes.length}`);
    const missing = lanes.filter((c) => !/\bissueAccess\b/.test(c.text));
    assert.equal(missing.length, 1, `only the periodical mint may pass no access: ${missing.map((c) => `:${c.at}`)}`);
    assert.match(missing[0].text, /attachIssue: null/, NEVER_FIRST['lib/dispatch-entrance.js#periodical-mint']);
    assert.match(src, /issueAccess: spec\.issueAccess/, 'enqueueRow forwards the lane\'s access to the factory');
  });

  test('the never-first callers still match their reasons', () => {
    const followUps = ['lib/follow-up-dispatch.js', 'lib/chat-tools.js'];
    for (const file of followUps) {
      const [call] = callArguments(readFileSync(join(ROOT, file), 'utf8'), 'createDispatchItem');
      assert.match(call.text, /followUpTo/, `${file}: ${NEVER_FIRST[file]}`);
    }
    const [collective] = callArguments(readFileSync(join(ROOT, 'routes/collective.js'), 'utf8'), 'createDispatchItem');
    const rowFields = collective.text.match(/\n\s*fields: \{[^}]*\}/);
    assert.ok(rowFields, 'the collective call passes a fields literal');
    assert.doesNotMatch(rowFields[0], /issueIdentifier/, NEVER_FIRST['routes/collective.js']);
  });
});
