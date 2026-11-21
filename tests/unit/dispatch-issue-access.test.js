/**
 * One issue access per dispatch, and no issue read (LIN-4361; LIN-4504).
 *
 * `createDispatchItem` takes one `issueAccess` resolver (`() => { provider, token } | null`).
 * The factory resolves it once, for the dispatch seat: the ticket's task (LIN-4501) and the child-ticket retry
 * (LIN-4503). LIN-4504 retired the pointer pilot, whose plan read was the one place the factory read the row's
 * issue, so a dispatch now reads no issue text at all:
 *   - a counting provider with `issueDescription` is never read, the seat gets the resolved access, the prompt is the
 *     prompt as finalized, and nothing is written back;
 *   - a provider that declares `testTransport` (a plain, fixed property declared on the provider class) has no access
 *     under the hermetic `test-token` under NODE_ENV=test: Linear with `test-token` makes no transport call at all, with
 *     or without an installed transport, and still enqueues; a real token on the same provider keeps its access; a
 *     provider that does not declare it still takes `test-token` as a working credential.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { setLinearFetchImpl, getLinearFetchImpl } from '../../lib/linear-fetch.js';
import { linearProvider } from '../../lib/providers/linear/index.js';
import { LocalProvider } from '../../lib/providers/local/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { guardSockets } from '../fixtures/network-guard.js';

const URL_KEY = 'acme';
const PLAN = 'Goal.\n\n## Notes\nlib/plan.js\nroutes/plan-route.js';
const WORDS = 'Please make the export button work.\nKeep **both** formats.';

let queue;
let store;
let seat;

beforeEach(() => {
  queue = createMockCollection();
  store = new DispatchQueueStore({ collection: queue, historyCollection: createMockCollection() });
  // The seat (server.js injects the real one): records the access each dispatch resolved for it.
  seat = [];
  store.taskOnDispatch = async (urlKey, ticket, access) => { seat.push({ ticket, access: await access() }); return null; };
});

const queuedRows = async () => queue.find({}).toArray();

/** A first implementation dispatch. */
function dispatch({ issueIdentifier, issueAccess, ...rest }) {
  return createDispatchItem({
    store,
    urlKey: URL_KEY,
    kind: 'implementation',
    prompt: 'do the work',
    fields: { promptName: 'Implementation', issueIdentifier, target: 'cli' },
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

describe('one access per dispatch, for the seat, and no issue read (LIN-4504)', () => {
  test('a provider with issueDescription is never read; the seat gets the access; the prompt is as finalized', async () => {
    const fake = countingProvider({ identifier: 'FAKE-7', id: 'uuid-7', description: PLAN });
    await dispatch({ issueIdentifier: 'FAKE-7', issueAccess: () => ({ provider: fake.provider, token: 't' }) });
    assert.deepEqual(fake.reads, [], 'no issue read: nothing reads a plan from the description');
    assert.deepEqual(seat.map((x) => [x.ticket, x.access?.token]), [['FAKE-7', 't']], 'the seat got the one resolved access');
    const [row] = await queuedRows();
    assert.ok(row, 'the dispatch enqueued');
    assert.ok(row.prompt.startsWith('do the work'), 'nothing is prepended to the prompt');
    assert.doesNotMatch(row.prompt, /lib\/plan\.js/, 'no plan path reaches the prompt');
    assert.deepEqual(fake.writes, [], 'the description is never written');
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

  test('Linear with test-token has no access, makes no transport call and still enqueues', async () => {
    await dispatch({ issueIdentifier: 'LIN-9', issueAccess: () => ({ provider: linearProvider, token: 'test-token' }) });
    assert.deepEqual(calls, [], 'no Linear transport call');
    assert.deepEqual(seat.map((x) => x.access), [null], 'no access for the seat');
    assert.equal((await queuedRows()).length, 1, 'the dispatch enqueued');
  });

  test('the control: Linear with any other token keeps its access (and still reads nothing)', async () => {
    await dispatch({ issueIdentifier: 'LIN-9', issueAccess: () => ({ provider: linearProvider, token: 'real-token' }) });
    assert.equal(seat[0].access?.token, 'real-token');
    assert.deepEqual(calls, [], 'the dispatch itself makes no issue read');
    assert.equal((await queuedRows()).length, 1);
  });

  test('the converse: LocalProvider with test-token keeps its access, and leaves the description as filed', async () => {
    const { store: issues } = createLocalStore();
    await issues.seed('test-token', {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
      issues: [{ id: 'i1', identifier: 'TEST-1', title: 'Task', description: WORDS, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } }],
    });
    const provider = new LocalProvider({ store: issues });
    await dispatch({ issueIdentifier: 'TEST-1', issueAccess: () => ({ provider, token: 'test-token' }) });
    assert.equal(seat[0].access?.provider, provider);
    assert.equal((await issues.getIssue('test-token', 'TEST-1')).description, WORDS);
    assert.deepEqual(calls, [], 'LocalProvider never touches the Linear transport');
  });
});

describe('the declared testTransport property, not the provider name', () => {
  test('a stand-in that declares testTransport has no access under the hermetic test token', async () => {
    const fake = countingProvider({ identifier: 'FAKE-10', id: 'uuid-10', description: PLAN, testTransport: true });
    await dispatch({ issueIdentifier: 'FAKE-10', issueAccess: () => ({ provider: fake.provider, token: 'test-token' }) });
    assert.deepEqual(seat.map((x) => x.access), [null]);
    assert.deepEqual(fake.reads, []);
    assert.deepEqual(fake.writes, [], 'nothing written');
    assert.equal((await queuedRows()).length, 1, 'the dispatch enqueued');
  });

  test('a stand-in that does not declare it still takes test-token as a working credential', async () => {
    const fake = countingProvider({ identifier: 'FAKE-11', id: 'uuid-11', description: PLAN });
    await dispatch({ issueIdentifier: 'FAKE-11', issueAccess: () => ({ provider: fake.provider, token: 'test-token' }) });
    assert.equal(seat[0].access?.token, 'test-token', 'access kept');
    assert.deepEqual(fake.reads, []);
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
