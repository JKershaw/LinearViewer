/**
 * LIN-4555 (finding-70d94ce4): Flight Companion's people wiring, through the route.
 *
 * `list_pending_decisions` reads a question whose asker quoted `person:<id>` and gives the person's name, never the raw id and never
 * "someone" (lib/open-questions.js). The reader is tested on its own (lin-4555-readable-rows.test.js), and the tool with a
 * `listPeople` handed straight to the catalog. What no test covered is the hop between: routes/flight-companion.js hands `listPeople`
 * into the turn's deps on BOTH chat endpoints (/turn and /boot), and lib/agent-turn.js forwards it into the catalog. Deleting either
 * line would have read a quoted person as "someone" on Flight Companion with every suite green, and the raw-text scan cannot see it
 * ("someone" is not raw).
 *
 * Driven through a real Express app with the route's own seams: the real chat tool catalog is built from the options the turn core
 * gives it, and a fake chat client calls `list_pending_decisions` through the catalog's executeTool, as the model would.
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { createFlightCompanionRoutes } from '../../routes/flight-companion.js';
import { COMPANION_SEED_STATE } from '../../lib/flight-companion-gate.js';

const URL_KEY = 'acme';
const OWNER = 'acct-owner';
const NOW = new Date().toISOString();
const PEOPLE = [{ accountId: OWNER, name: 'John Kershaw' }];

const harness = createMangoTmpdir('lin-4555-fc-people-');
let records;
let dispatch;

before(() => harness.connect());
after(() => harness.close());

beforeEach(async () => {
  const db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  dispatch = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
  const task = await records.ensureTask(URL_KEY, { identifier: 'LIN-1', title: 'A task', closed: false }, { by: 'Harbour', at: NOW });
  await records.add(URL_KEY, {
    kind: 'question',
    state: 'open',
    fields: { asks: `Should this ship? person:${OWNER} asked for it.`, options: ['Ship it', 'Hold it'], recommended: 'Ship it' },
    links: {},
    in: task.id,
    to: `person:${OWNER}`,
  }, { by: 'review', at: NOW });
});

// The observer store: the census the turn gate reads and the companion's own record, enough for a turn to be spent.
function observerStateStore() {
  let doc = { rev: 1, state: COMPANION_SEED_STATE };
  const census = {
    rev: 5, stateHash: 'hash-abc', updatedAt: new Date(),
    state: { lanes: { working: 1, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 }, attention: [] },
  };
  return {
    async ensureSeeded(key) { return { _id: key, rev: doc.rev, state: doc.state }; },
    async readCurrent(key) { return key.startsWith('sweep:v1:') ? census : { _id: key, rev: doc.rev, state: doc.state, stateHash: 'h' }; },
    async advance(key, expectedRev, next) { if (expectedRev !== doc.rev) return false; doc = { rev: doc.rev + 1, state: next }; return true; },
  };
}

/**
 * A Flight Companion app whose only listPeople is the one handed to the route, and a model that calls list_pending_decisions once
 * and keeps what the tool said. `peopleDeps` is spread into the route, so a test can leave `listPeople` out.
 */
function buildApp(captured, peopleDeps) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { features: { flightCompanion: true }, workspaces: [{ urlKey: URL_KEY }], accountId: OWNER, openRouterApiKey: 'sk-test-paid-key' };
    next();
  });
  app.use(createFlightCompanionRoutes({
    workspaceFromUrl: (req, _res, next) => { req.workspace = { urlKey: URL_KEY }; next(); },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    getModelCatalog: async () => [],
    observerStateStore: observerStateStore(),
    freeTierStore: { async tryUse() { throw new Error('a paid key is present: the free tier is not consulted'); } },
    recordsStore: records,
    dispatchQueueStore: dispatch,
    agentStatusStore: {},
    // The real catalog over the options the turn core hands it (listPeople and dispatchedBy included), a stub provider.
    createToolCatalog: (opts) => createChatToolCatalog({ ...opts, provider: { fetchProjects: async () => ({ projects: [], issues: [] }) }, scope: { workspaceUrlKey: URL_KEY } }),
    chatClient: {
      async streamChat(_m, _o, onEvent) { onEvent('done', {}); },
      async streamChatWithTools(_m, opts, onEvent) {
        captured.out = await opts.executeTool({ name: 'list_pending_decisions', arguments: {} });
        onEvent('done', {});
      },
    },
    ...peopleDeps,
  }));
  return app;
}

async function post(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await res.text();
    return res.status;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const ENDPOINTS = [
  ['/turn', { message: 'what is waiting on me?' }],
  ['/boot', {}],
];

describe('LIN-4555 Flight Companion: a quoted person reads by name through the route (finding-70d94ce4)', () => {
  for (const [endpoint, body] of ENDPOINTS) {
    test(`${endpoint}: list_pending_decisions names the person the asker quoted, never "someone"`, async () => {
      const captured = {};
      const app = buildApp(captured, { listPeople: async () => PEOPLE });
      assert.equal(await post(app, `/workspace/${URL_KEY}/api/flight-companion${endpoint}`, body), 200);
      assert.ok(captured.out, 'the model\'s tool call ran');
      assert.equal(captured.out.count, 1);
      const [q] = captured.out.questions;
      assert.match(q.question, /John Kershaw asked for it/);
      assert.doesNotMatch(q.question, /someone|person:/);
    });

    test(`${endpoint}: with no listPeople handed to the route the person reads as "someone" (the witness that the test above can fail)`, async () => {
      const captured = {};
      const app = buildApp(captured, {});
      assert.equal(await post(app, `/workspace/${URL_KEY}/api/flight-companion${endpoint}`, body), 200);
      assert.match(captured.out.questions[0].question, /someone asked for it/);
    });
  }
});
