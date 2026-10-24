/**
 * LIN-3812 (LIN-3810 H2 `dispatch-row-full-read-default`): the dispatch store's DEFAULT read is the
 * lean shape, and the prompt / raw feedback come only through named methods.
 *
 * Witnesses for the contract:
 *   - `getItemStatus` / `listHistory` / `listItems` return scalars + a fresh `feedbackDigest`,
 *     never `prompt` and never `feedback[]`;
 *   - a row whose digest is missing or stale is self-healed (re-read by `_id`, written back
 *     guarded on `feedbackVersion`), and a fresh digest costs zero re-reads;
 *   - `getItemPrompt`, `getItemFeedback`, `listItemsWithPrompt`, `listHistoryWithBodies`,
 *     `pollAvailable` are the only readers that carry the heavy fields;
 *   - `countItems` is a `countDocuments`, not a find + length;
 *   - the dispatch page's history route is bounded server-side (default 20, max 100).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const TOKEN = 'token-a';
const PROMPT = 'THE-PROMPT-BODY '.repeat(50);

function makeStore() {
  const queue = createMockCollection();
  const history = createMockCollection();
  const finds = [];
  const countCalls = [];
  const historySpy = {
    ...history,
    find(query, opts) { finds.push({ query, opts }); return history.find(query, opts); },
    async countDocuments(query) { countCalls.push(query); return history.countDocuments(query); }
  };
  const queueSpy = {
    ...queue,
    find(query, opts) { throw new Error(`countItems must not find(): ${JSON.stringify(query)} ${JSON.stringify(opts)}`); },
    async countDocuments(query) { countCalls.push(query); return queue.countDocuments(query); }
  };
  const store = new DispatchQueueStore({ collection: queue, historyCollection: historySpy });
  return { store, queue, history, finds, countCalls, queueSpy };
}

async function takenWithFeedback(store, issueIdentifier = 'LIN-1') {
  const item = await store.addItem(URL_KEY, { prompt: PROMPT, issueIdentifier });
  await store.takeItem(item._id, URL_KEY, TOKEN);
  await store.addFeedback(item._id, URL_KEY, { message: '[working] on it' }, TOKEN);
  await store.addFeedback(item._id, URL_KEY, { message: '[done] shipped' }, TOKEN);
  return item;
}

describe('the default reads are lean (LIN-3812)', () => {
  test('getItemStatus: a history row carries scalars and a fresh digest, no prompt, no feedback[]', async () => {
    const { store } = makeStore();
    const item = await takenWithFeedback(store);

    const row = await store.getItemStatus(URL_KEY, item._id);

    assert.equal(row.id, item._id);
    assert.equal(row.issueIdentifier, 'LIN-1');
    assert.equal(row.prompt, null, 'the prompt is projected out');
    assert.equal('feedback' in row, false, 'the raw feedback is projected out');
    assert.equal(row.feedbackVersion, 2);
    assert.equal(row.feedbackDigest.version, 2, 'the digest is current');
    assert.equal(row.feedbackDigest.terminal.status, 'done');
  });

  test('getItemStatus: a queued row carries no prompt', async () => {
    const { store } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: PROMPT, issueIdentifier: 'LIN-1' });
    const row = await store.getItemStatus(URL_KEY, item._id);
    assert.equal(row.status, 'queued');
    assert.equal(row.prompt, undefined);
    assert.equal('feedback' in row, false);
  });

  test('listHistory: lean rows, one scoped query that excludes prompt and feedback at the database', async () => {
    const { store, finds } = makeStore();
    await takenWithFeedback(store);
    finds.length = 0;

    const { items, total } = await store.listHistory(URL_KEY, { issueIdentifier: 'LIN-1' });

    assert.equal(total, 1);
    assert.equal(items[0].prompt, null);
    assert.equal('feedback' in items[0], false);
    assert.deepEqual(finds[0].opts, { projection: { prompt: 0, feedback: 0 } });
    assert.equal(finds.length, 1, 'a fresh digest needs no self-heal re-read');
  });

  test('listItems: queued rows drop the prompt; listItemsWithPrompt and pollAvailable keep it', async () => {
    const { store } = makeStore();
    await store.addItem(URL_KEY, { prompt: PROMPT, issueIdentifier: 'LIN-1' });

    assert.equal((await store.listItems(URL_KEY))[0].prompt, undefined);
    assert.equal((await store.listItemsWithPrompt(URL_KEY))[0].prompt, PROMPT);
    assert.equal((await store.pollAvailable(URL_KEY))[0].prompt, PROMPT, 'the runner must receive the prompt it has to run');
  });

  test('the named heavy readers carry exactly what they are named for', async () => {
    const { store } = makeStore();
    const item = await takenWithFeedback(store);

    const withPrompt = await store.getItemPrompt(URL_KEY, item._id);
    assert.equal(withPrompt.prompt, PROMPT);
    assert.equal('feedback' in withPrompt, false, 'the prompt read does not drag the feedback along');

    const withFeedback = await store.getItemFeedback(URL_KEY, item._id);
    assert.equal(withFeedback.feedback.length, 2);
    assert.equal(withFeedback.prompt, null, 'the feedback read does not drag the prompt along');

    const { items } = await store.listHistoryWithBodies(URL_KEY, { issueIdentifier: 'LIN-1' });
    assert.equal(items[0].prompt, PROMPT);
    assert.equal(items[0].feedback.length, 2);
  });

  test('getItemFeedback on an unknown id is null, on a queued row an empty feedback array', async () => {
    const { store } = makeStore();
    assert.equal(await store.getItemFeedback(URL_KEY, 'nope'), null);
    assert.equal(await store.getItemPrompt(URL_KEY, 'nope'), null);
    const item = await store.addItem(URL_KEY, { prompt: PROMPT });
    assert.deepEqual((await store.getItemFeedback(URL_KEY, item._id)).feedback, []);
  });
});

describe('the lean read self-heals a missing or stale digest (LIN-3011, now in the store)', () => {
  test('an archived-but-never-fed row (digest null) is re-read by _id, served healed, and written back', async () => {
    const { store, finds, history } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: PROMPT, issueIdentifier: 'LIN-2' });
    await store.removeItem(URL_KEY, item._id); // cancelled -> archived with feedbackDigest: null
    assert.equal(history._docs[0].feedbackDigest, null);
    finds.length = 0;

    const row = await store.getItemStatus(URL_KEY, item._id);

    assert.equal(row.feedbackDigest.version, 0, 'served with a fresh digest');
    assert.deepEqual(finds.map(f => f.query._id).filter(Boolean), [{ $in: [item._id] }].map(x => x), 'one re-read by _id');
    assert.equal(history._docs[0].feedbackDigest.version, 0, 'the healed digest was written back');

    finds.length = 0;
    await store.getItemStatus(URL_KEY, item._id);
    assert.equal(finds.filter(f => f.query._id && f.query._id.$in).length, 0, 'it converged: no second re-read');
  });
});

describe('countItems is a count, not a find + length (LIN-3812)', () => {
  test('uses countDocuments on the queue and never materialises a row', async () => {
    const { store, queue } = makeStore();
    await store.addItem(URL_KEY, { prompt: PROMPT });
    await store.addItem(URL_KEY, { prompt: PROMPT });
    const calls = [];
    const guarded = new DispatchQueueStore({
      collection: {
        ...queue,
        find() { throw new Error('countItems must not find()'); },
        async countDocuments(q) { calls.push(q); return queue.countDocuments(q); }
      },
      historyCollection: createMockCollection()
    });

    assert.equal(await guarded.countItems(URL_KEY), 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].urlKey, URL_KEY);
    assert.ok(calls[0].expiresAt.$gt instanceof Date, 'expired rows are still excluded');
  });
});

describe('GET /workspace/:urlKey/api/dispatch/history is bounded server-side (LIN-3812)', () => {
  async function getHistory(store, query = '') {
    const app = express();
    app.use((req, res, next) => { req.session = { accountId: 'acct-1' }; next(); });
    app.use(createDispatchRoutes({
      dispatchQueueStore: store,
      dispatchTokenStore: {},
      workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY }; next(); },
      userPreferencesStore: {},
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      proxyTokenStore: {}
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/${URL_KEY}/api/dispatch/history${query}`);
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  async function seedHistory(store, n) {
    for (let i = 0; i < n; i++) {
      const item = await store.addItem(URL_KEY, { prompt: `p${i}`, issueIdentifier: `LIN-${i}` });
      await store.removeItem(URL_KEY, item._id);
    }
  }

  test('no limit sent: the page is 20 rows, total is the full count, offset pages on', async () => {
    const { store } = makeStore();
    await seedHistory(store, 25);

    const first = await getHistory(store);
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 20);
    assert.equal(first.body.total, 25);

    const second = await getHistory(store, '?offset=20');
    assert.equal(second.body.items.length, 5);
  });

  test('a requested limit is honoured up to 100 and clamped beyond it', async () => {
    const { store } = makeStore();
    await seedHistory(store, 105);

    assert.equal((await getHistory(store, '?limit=7')).body.items.length, 7);
    assert.equal((await getHistory(store, '?limit=500')).body.items.length, 100);
    assert.equal((await getHistory(store, '?limit=abc')).body.items.length, 20, 'an unparseable limit falls back to the default');
  });

  test('the rows still carry the prompt the page renders', async () => {
    const { store } = makeStore();
    await seedHistory(store, 1);
    const { body } = await getHistory(store);
    assert.equal(body.items[0].prompt, 'p0');
  });
});
