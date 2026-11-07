/**
 * One issue access and one issue read per dispatch (LIN-4361).
 *
 * `createDispatchItem` takes one `issueAccess` resolver (`() => { provider, token } | null`).
 * The factory reads the row's issue (`fields.issueIdentifier`) at most once, and that one
 * read serves both the first-dispatch seal and the file-pointer pilot's plan read:
 *   - a counting provider WITH `issueDescription` is read exactly once, for the row's
 *     identifier, and the plan paths still reach the prompt; the seal still writes by the
 *     id the read returned;
 *   - the Linear provider with the hermetic `test-token` under NODE_ENV=test makes no
 *     transport call at all (the e2e transport answers that token with a 401), still
 *     enqueues, and logs `seal skipped: no access`; a real token on the same provider
 *     does reach the transport, and LocalProvider with `test-token` still seals;
 *   - a trashed issue is not sealed (the seal's existing "found nothing" line) but its
 *     plan still reaches the prompt.
 *
 * Everything runs on a real DispatchQueueStore over mock collections, so the seal's
 * earlier-dispatch read and the pilot's eligible count are the store's own.
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
import { sealAsAsked } from '../../lib/as-asked.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const PLAN = '## Implementation Plan\nlib/plan.js\nroutes/plan-route.js';
const WORDS = 'Please make the export button work.\nKeep **both** formats.';

let queue;
let store;
let logs;
const saved = {};

beforeEach(() => {
  queue = createMockCollection();
  store = new DispatchQueueStore({ collection: queue, historyCollection: createMockCollection() });
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
 * A provider that answers one issue by `issueDescription` (the seal's read) and counts
 * every issue read, through either method. It takes a write ONLY by the id its read
 * returned, as Linear's uuid and GitHub's and Jira's own ids do.
 */
function countingProvider({ identifier, id, description, trashed = false }) {
  const reads = [];
  const writes = [];
  const issue = () => ({ id, identifier, description, trashed });
  return {
    reads,
    writes,
    provider: {
      name: 'counting',
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

describe('one read per dispatch, shared by the seal and the plan read', () => {
  test('a provider with issueDescription is read once, for the row\'s identifier, and the plan paths reach the prompt', async () => {
    const fake = countingProvider({ identifier: 'FAKE-7', id: 'uuid-7', description: PLAN });
    await dispatch({ issueIdentifier: 'FAKE-7', issueAccess: () => ({ provider: fake.provider, token: 't' }) });
    assert.deepEqual(fake.reads, [['issueDescription', 'FAKE-7']], 'exactly one issue read, through issueDescription');
    const [row] = await queuedRows();
    assert.ok(row, 'the dispatch enqueued');
    assert.ok(row.prompt.startsWith(FILE_POINTER_MARKER), row.prompt);
    assert.match(row.prompt, /- lib\/plan\.js/);
    assert.deepEqual(fake.writes, [], 'a description holding a plan heading is never sealed');
  });

  test('on an unsealed description the same one read is what the seal writes back, by the id it returned', async () => {
    const fake = countingProvider({ identifier: 'FAKE-8', id: 'uuid-8', description: WORDS });
    await dispatch({ issueIdentifier: 'FAKE-8', issueAccess: () => ({ provider: fake.provider, token: 't' }) });
    assert.deepEqual(fake.reads, [['issueDescription', 'FAKE-8']], 'the seal and the plan read share one read');
    assert.deepEqual(fake.writes, [['uuid-8', sealAsAsked(WORDS)]]);
    assert.ok(logs.some((l) => l.includes('[as-asked] sealed at first dispatch')), JSON.stringify(logs));
    assert.equal((await queuedRows()).length, 1);
  });
});

describe('the hermetic test token, on Linear only', () => {
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

  test('Linear with test-token makes no transport call, still enqueues, and logs `seal skipped: no access`', async () => {
    await dispatch({ issueIdentifier: 'LIN-9', issueAccess: () => ({ provider: linearProvider, token: 'test-token' }) });
    assert.deepEqual(calls, [], 'no Linear transport call');
    const [row] = await queuedRows();
    assert.ok(row, 'the dispatch enqueued');
    assert.ok(!row.prompt.startsWith(FILE_POINTER_MARKER), 'no plan paths without access');
    assert.ok(logs.some((l) => l.includes('[as-asked] seal skipped: no access')), JSON.stringify(logs));
    assert.ok(!logs.some((l) => l.includes('[as-asked] seal failed')), JSON.stringify(logs));
  });

  test('the control: Linear with any other token does reach the transport', async () => {
    await dispatch({ issueIdentifier: 'LIN-9', issueAccess: () => ({ provider: linearProvider, token: 'real-token' }) });
    assert.ok(calls.length >= 1, 'the issue read went to the Linear transport');
    assert.ok(calls.every((c) => c.authorization === 'real-token'), JSON.stringify(calls));
    assert.equal((await queuedRows()).length, 1);
  });

  test('the converse: LocalProvider with test-token still reads and seals through issueAccess', async () => {
    const { store: issues } = createLocalStore();
    await issues.seed('test-token', {
      projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
      issues: [{ id: 'i1', identifier: 'TEST-1', title: 'Task', description: WORDS, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } }],
    });
    const provider = new LocalProvider({ store: issues });
    await dispatch({ issueIdentifier: 'TEST-1', issueAccess: () => ({ provider, token: 'test-token' }) });
    assert.equal((await issues.getIssue('test-token', 'TEST-1')).description, sealAsAsked(WORDS));
    assert.deepEqual(calls, [], 'LocalProvider never touches the Linear transport');
  });
});

describe('a trashed issue', () => {
  test('is not sealed, but its plan still reaches the prompt', async () => {
    const fake = countingProvider({ identifier: 'FAKE-3', id: 'uuid-3', description: PLAN, trashed: true });
    await dispatch({ issueIdentifier: 'FAKE-3', issueAccess: () => ({ provider: fake.provider, token: 't' }) });
    assert.deepEqual(fake.writes, [], 'never sealed');
    assert.ok(logs.some((l) => l.includes('[as-asked] seal failed: issue read found nothing')), JSON.stringify(logs));
    assert.deepEqual(fake.reads, [['issueDescription', 'FAKE-3']], 'one read');
    const [row] = await queuedRows();
    assert.ok(row.prompt.startsWith(FILE_POINTER_MARKER), row.prompt);
    assert.match(row.prompt, /- lib\/plan\.js/);
  });

  test('without a plan it is still not sealed (today\'s line)', async () => {
    const fake = countingProvider({ identifier: 'FAKE-4', id: 'uuid-4', description: WORDS, trashed: true });
    await dispatch({ issueIdentifier: 'FAKE-4', issueAccess: () => ({ provider: fake.provider, token: 't' }) });
    assert.deepEqual(fake.writes, []);
    assert.ok(logs.some((l) => l.includes('[as-asked] seal failed: issue read found nothing')), JSON.stringify(logs));
    assert.equal((await queuedRows()).length, 1);
  });
});
