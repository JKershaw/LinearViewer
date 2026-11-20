/**
 * One issue access and one issue read per dispatch (LIN-4361).
 *
 * `createDispatchItem` takes one `issueAccess` resolver (`() => { provider, token } | null`).
 * The factory resolves it once (the task seat, LIN-4501, and the child-ticket retry use it) and
 * reads the row's issue (`fields.issueIdentifier`) at most once, for the file-pointer pilot's plan read:
 *   - a counting provider WITH `issueDescription` is read exactly once, for the row's
 *     identifier, and the plan paths still reach the prompt;
 *   - LIN-4502: no dispatch writes the description back. The first-dispatch seal is retired, so a
 *     description with no plan is read and left exactly as filed;
 *   - a provider that declares `testTransport` (a plain, fixed property declared on the
 *     provider class) has no access to the hermetic `test-token` under
 *     NODE_ENV=test: Linear with `test-token` makes no transport call at all, with or
 *     without an installed transport (the e2e transport answers that token with a 401),
 *     and still enqueues; a real token on the same provider does reach the transport; a
 *     provider that does not declare it still takes `test-token` as a working credential;
 *   - a trashed issue's plan still reaches the prompt.
 *
 * Everything runs on a real DispatchQueueStore over mock collections, so the pilot's eligible
 * count is the store's own.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { FILE_POINTER_MARKER } from '../../lib/file-pointer.js';
import { setLinearFetchImpl, getLinearFetchImpl } from '../../lib/linear-fetch.js';
import { linearProvider } from '../../lib/providers/linear/index.js';
import { LocalProvider } from '../../lib/providers/local/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { guardSockets } from '../fixtures/network-guard.js';

const URL_KEY = 'acme';
const PLAN = '## Implementation Plan\nlib/plan.js\nroutes/plan-route.js';
const WORDS = 'Please make the export button work.\nKeep **both** formats.';

let queue;
let store;

beforeEach(() => {
  queue = createMockCollection();
  store = new DispatchQueueStore({ collection: queue, historyCollection: createMockCollection() });
});

const queuedRows = async () => queue.find({}).toArray();

/** A first implementation dispatch with the pilot on, landing on the pointer arm (empty queue: ordinal 0). */
function dispatch({ issueIdentifier, issueAccess, ...rest }) {
  return createDispatchItem({
    store,
    urlKey: URL_KEY,
    kind: 'implementation',
    prompt: 'do the work',
    fields: { promptName: 'Implementation', issueIdentifier, target: 'cli' },
    filePointerEnabled: true,
    fetchPilotPrFiles: async () => [],
    issueAccess,
    ...rest,
  });
}

/**
 * A provider that answers one issue by `issueDescription` (the dispatch's raw read) and counts
 * every issue read, through either method, and every write, so a test can show none is made.
 */
function countingProvider({ identifier, id, description, trashed = false, testTransport }) {
  const reads = [];
  const writes = [];
  const issue = () => ({ id, identifier, description, trashed });
  return {
    reads,
    writes,
    provider: {
      name: 'counting',
      // The declared property is a plain property, present only when asked for.
      ...(testTransport ? { testTransport: true } : {}),
      async issueDescription(token, key) {
        reads.push(['issueDescription', key]);
        return key === identifier ? issue() : null;
      },
      async fetchIssueContext(token, key) {
        reads.push(['fetchIssueContext', key]);
        return key === identifier ? { issue: issue(), project: null } : null;
      },
      async updateIssue(token, key, input) {
        writes.push([key, input.description]);
        if (key !== id) return { success: false, issue: null };
        return { success: true, issue: { id, description: input.description } };
      },
    },
  };
}

describe('one read per dispatch, for the plan read, and no write back', () => {
  test('a provider with issueDescription is read once, for the row\'s identifier, and the plan paths reach the prompt', async () => {
    const fake = countingProvider({ identifier: 'FAKE-7', id: 'uuid-7', description: PLAN });
    await dispatch({ issueIdentifier: 'FAKE-7', issueAccess: () => ({ provider: fake.provider, token: 't' }) });
    assert.deepEqual(fake.reads, [['issueDescription', 'FAKE-7']], 'exactly one issue read, through issueDescription');
    const [row] = await queuedRows();
    assert.ok(row, 'the dispatch enqueued');
    assert.ok(row.prompt.startsWith(FILE_POINTER_MARKER), row.prompt);
    assert.match(row.prompt, /- lib\/plan\.js/);
    assert.deepEqual(fake.writes, [], 'the description is never written back');
  });

  test('LIN-4502: a first dispatch on a description with no plan reads it once and writes nothing back (no seal)', async () => {
    const fake = countingProvider({ identifier: 'FAKE-8', id: 'uuid-8', description: WORDS });
    await dispatch({ issueIdentifier: 'FAKE-8', issueAccess: () => ({ provider: fake.provider, token: 't' }) });
    assert.deepEqual(fake.reads, [['issueDescription', 'FAKE-8']], 'one read');
    assert.deepEqual(fake.writes, [], 'no block is sealed onto the description');
    assert.equal((await queuedRows()).length, 1);
  });
});

describe('the hermetic test token: a declared testTransport is skipped, an undeclared provider is not', () => {
  let calls;
  let kept;
  beforeEach(() => {
    calls = [];
    kept = getLinearFetchImpl();
    setLinearFetchImpl(async (url, options = {}) => {
      calls.push({ url: String(url), authorization: new Headers(options.headers).get('authorization') });
      return new Response(JSON.stringify({ data: null, errors: [{ message: 'refused by the counting transport' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
  });
  afterEach(() => setLinearFetchImpl(kept));

  test('Linear with test-token makes no transport call and still enqueues', async () => {
    await dispatch({ issueIdentifier: 'LIN-9', issueAccess: () => ({ provider: linearProvider, token: 'test-token' }) });
    assert.deepEqual(calls, [], 'no Linear transport call');
    const [row] = await queuedRows();
    assert.ok(row, 'the dispatch enqueued');
    assert.ok(!row.prompt.startsWith(FILE_POINTER_MARKER), 'no plan paths without access');
  });

  test('the control: Linear with any other token does reach the transport', async () => {
    await dispatch({ issueIdentifier: 'LIN-9', issueAccess: () => ({ provider: linearProvider, token: 'real-token' }) });
    assert.ok(calls.length >= 1, 'the issue read went to the Linear transport');
    assert.ok(calls.every((c) => c.authorization === 'real-token'), JSON.stringify(calls));
    assert.equal((await queuedRows()).length, 1);
  });

  test('the converse: LocalProvider with test-token still reads through issueAccess, and leaves the description as filed', async () => {
    const { store: issues } = createLocalStore();
    await issues.seed('test-token', {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
      issues: [{ id: 'i1', identifier: 'TEST-1', title: 'Task', description: WORDS, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } }],
    });
    const provider = new LocalProvider({ store: issues });
    await dispatch({ issueIdentifier: 'TEST-1', issueAccess: () => ({ provider, token: 'test-token' }) });
    assert.equal((await issues.getIssue('test-token', 'TEST-1')).description, WORDS);
    assert.deepEqual(calls, [], 'LocalProvider never touches the Linear transport');
  });
});

describe('the declared testTransport property, not the provider name', () => {
  test('a stand-in that declares testTransport has no access under the hermetic test token: no read, no plan', async () => {
    const fake = countingProvider({ identifier: 'FAKE-10', id: 'uuid-10', description: PLAN, testTransport: true });
    await dispatch({ issueIdentifier: 'FAKE-10', issueAccess: () => ({ provider: fake.provider, token: 'test-token' }) });
    assert.deepEqual(fake.reads, [], 'no issue read through the declared provider');
    assert.deepEqual(fake.writes, [], 'nothing written');
    const [row] = await queuedRows();
    assert.ok(row, 'the dispatch enqueued');
    assert.ok(!row.prompt.startsWith(FILE_POINTER_MARKER), 'no plan paths without access');
  });

  test('a stand-in that does not declare it still takes test-token as a working credential: one read, plan reaches the prompt', async () => {
    const fake = countingProvider({ identifier: 'FAKE-11', id: 'uuid-11', description: PLAN });
    await dispatch({ issueIdentifier: 'FAKE-11', issueAccess: () => ({ provider: fake.provider, token: 'test-token' }) });
    assert.deepEqual(fake.reads, [['issueDescription', 'FAKE-11']], 'access kept: exactly one issue read');
    const [row] = await queuedRows();
    assert.ok(row.prompt.startsWith(FILE_POINTER_MARKER), row.prompt);
    assert.match(row.prompt, /- lib\/plan\.js/);
  });

  test('Linear with test-token and NO installed transport is skipped, and no socket leaves the process', async () => {
    assert.equal(getLinearFetchImpl(), null, 'no transport installed for this test');
    const sockets = guardSockets();
    try {
      await dispatch({ issueIdentifier: 'LIN-10', issueAccess: () => ({ provider: linearProvider, token: 'test-token' }) });
    } finally {
      sockets.restore();
    }
    assert.deepEqual(sockets.connections, [], 'no non-loopback socket opened');
    assert.equal((await queuedRows()).length, 1);
  });
});

describe('a trashed issue', () => {
  test('its plan still reaches the prompt, and nothing is written', async () => {
    const fake = countingProvider({ identifier: 'FAKE-3', id: 'uuid-3', description: PLAN, trashed: true });
    await dispatch({ issueIdentifier: 'FAKE-3', issueAccess: () => ({ provider: fake.provider, token: 't' }) });
    assert.deepEqual(fake.writes, [], 'nothing written');
    assert.deepEqual(fake.reads, [['issueDescription', 'FAKE-3']], 'one read');
    const [row] = await queuedRows();
    assert.ok(row.prompt.startsWith(FILE_POINTER_MARKER), row.prompt);
    assert.match(row.prompt, /- lib\/plan\.js/);
  });

  test('without a plan it is enqueued and nothing is written', async () => {
    const fake = countingProvider({ identifier: 'FAKE-4', id: 'uuid-4', description: WORDS, trashed: true });
    await dispatch({ issueIdentifier: 'FAKE-4', issueAccess: () => ({ provider: fake.provider, token: 't' }) });
    assert.deepEqual(fake.writes, []);
    assert.equal((await queuedRows()).length, 1);
  });
});
