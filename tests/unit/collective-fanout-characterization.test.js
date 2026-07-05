/**
 * Fan-out equivalence anchor for POST /collective/start (LIN-1047 beat 3;
 * request shape migrated to `characters` in LIN-1048).
 *
 * The /collective/start dispatch loop iterates over CHARACTERS rather than raw
 * workspaces. LIN-1048 migrates the wire contract from `workspaceUrlKeys` to a
 * `characters` list — but a character carrying NO persona fields still collapses
 * (via the route's pickCharacterFields → the builder's merge over
 * DEFAULT_COLLECTIVE_CHARACTER) to the generic Implementer, so the dispatched set
 * stays byte-for-byte what HEAD produced. This test is the compatibility anchor —
 * it drives the real router with a spy dispatch store, posts the new `characters`
 * shape with empty personas, and asserts the dispatched payloads are unchanged.
 *
 * The proof that the default character is a true no-op: each captured prompt
 * equals buildCollectiveParticipantPrompt(...) called for the same participant
 * BOTH with the default character AND without any character at all — the two are
 * asserted equal, so the seam cannot have moved the default output.
 *
 * Run with: node --test tests/unit/collective-fanout-characterization.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCollectiveRoutes } from '../../routes/collective.js';
import { CollectiveCharactersStore } from '../../lib/collective-characters-store.js';
import {
  buildCollectiveParticipantPrompt,
  DEFAULT_COLLECTIVE_CHARACTER,
} from '../../lib/prompts/collective-participant.js';

// Minimal in-memory mock of the collection surface CollectiveCharactersStore
// uses (matches on _id / urlKey equality). Lets a regression test drive the REAL
// store through the route and read it back via store.list(), proving a saved
// character actually persists (not just that createCustom was invoked).
function createMockCollection() {
  const docs = [];
  const matches = (doc, q) =>
    (q._id === undefined || doc._id === q._id) &&
    (q.urlKey === undefined || doc.urlKey === q.urlKey);
  return {
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(q) { return docs.find(d => matches(d, q)) || null; },
    find(q = {}) {
      const results = docs.filter(d => matches(d, q));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(q, update) {
      const doc = docs.find(d => matches(d, q));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(q) {
      const idx = docs.findIndex(d => matches(d, q));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(q) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], q)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    },
  };
}

const YAP_BASE_URL = 'https://yap.test';

const WORKSPACES = [
  { urlKey: 'alpha', name: 'Alpha Project' },
  { urlKey: 'bravo', name: 'Bravo Project' },
  { urlKey: 'charlie', name: 'Charlie Project' },
];

function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createCollectiveRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.push({ urlKey, item });
        return { _id: `disp-${captured.length}`, ...item };
      },
    },
    // No proxy-token store: the participant dispatches without a Linear token
    // (a valid path in the handler), so the prompt is the pure default body with
    // no appended Linear-access block — keeps the equivalence assertion focused
    // on the character seam.
    proxyTokenStore: null,
    yapClient: { baseUrl: YAP_BASE_URL },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = {
        linearUserId: 'u1',
        features: { collective: true },
        workspaces: WORKSPACES,
      };
      next();
    },
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const START_PATH = '/workspace/alpha/collective/start';

describe('POST /collective/start — character fan-out equivalence (LIN-1047)', () => {
  test('fans out exactly one dispatch per selected workspace (cardinality unchanged)', async () => {
    const captured = [];
    const app = buildApp(captured);
    const res = await call(app, 'post', START_PATH, {
      channel: '#test-room',
      characters: [
        { workspaceUrlKey: 'alpha' },
        { workspaceUrlKey: 'bravo' },
        { workspaceUrlKey: 'charlie' },
      ],
      target: 'web',
      topic: 'test topic',
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.length, 3, 'one dispatch per selected workspace');
    assert.equal(res.body.dispatched.length, 3);
    // Dispatched in the selected order, to the right workspaces.
    assert.deepEqual(captured.map(c => c.urlKey), ['alpha', 'bravo', 'charlie']);
    // Response echoes the normalized channel/topic/target.
    assert.equal(res.body.topic, 'test topic');
    assert.equal(res.body.target, 'web');
  });

  test('each dispatched prompt is byte-identical to the default-character build (the no-op proof)', async () => {
    const captured = [];
    const app = buildApp(captured);
    const res = await call(app, 'post', START_PATH, {
      channel: '#test-room',
      characters: [
        { workspaceUrlKey: 'alpha' },
        { workspaceUrlKey: 'bravo' },
        { workspaceUrlKey: 'charlie' },
      ],
      target: 'web',
      topic: 'test topic',
    });

    assert.equal(res.status, 201);
    const yapPassword = process.env.YAP_PASSWORD || null;

    captured.forEach(({ item }, i) => {
      // Nick the route assigned to this participant (from the response, so we
      // never re-implement the dedupe logic).
      const nick = res.body.dispatched[i].nick;
      const args = {
        channel: res.body.channel,
        nick,
        yapBaseUrl: YAP_BASE_URL,
        yapPassword,
        topic: res.body.topic,
        proxyBaseUrl: null,
        proxyToken: null,
      };
      const withDefaultCharacter = buildCollectiveParticipantPrompt({
        ...args,
        character: DEFAULT_COLLECTIVE_CHARACTER,
      });
      const withoutCharacter = buildCollectiveParticipantPrompt(args);

      // The seam's default must equal the pre-refactor (no-character) build...
      assert.equal(withDefaultCharacter, withoutCharacter, `participant ${i}: default character is not a no-op`);
      // ...and the actual dispatched prompt must equal it byte-for-byte.
      assert.equal(item.prompt, withoutCharacter, `participant ${i}: dispatched prompt drifted from HEAD`);
      // No persona block leaks into the default fan-out.
      assert.ok(!item.prompt.includes('## Your character'), `participant ${i}: unexpected persona block`);
    });
  });

  test('the dispatched item shape (promptName / kind / target / dispatchedBy) is unchanged', async () => {
    const captured = [];
    const app = buildApp(captured);
    await call(app, 'post', START_PATH, {
      channel: '#test-room',
      characters: [{ workspaceUrlKey: 'alpha' }],
      target: 'cli',
    });

    assert.equal(captured.length, 1);
    const { item } = captured[0];
    assert.equal(item.promptName, 'collective-participant');
    assert.equal(item.kind, 'custom');
    assert.equal(item.target, 'cli');
    assert.equal(item.dispatchedBy, 'u1');
  });

  test('distinct nicks are still assigned per workspace (transcript legibility preserved)', async () => {
    const captured = [];
    const app = buildApp(captured);
    const res = await call(app, 'post', START_PATH, {
      channel: '#test-room',
      characters: [
        { workspaceUrlKey: 'alpha' },
        { workspaceUrlKey: 'bravo' },
        { workspaceUrlKey: 'charlie' },
      ],
    });
    const nicks = res.body.dispatched.map(d => d.nick);
    assert.equal(new Set(nicks).size, nicks.length, 'nicks must be distinct across the fan-out');
  });
});

describe('POST /collective/start — persona threading + recent recording (LIN-1048)', () => {
  function buildAppWithStore(captured, recorded) {
    const app = express();
    app.use(express.json());
    app.use(createCollectiveRoutes({
      dispatchQueueStore: {
        addItem: async (urlKey, item) => {
          captured.push({ urlKey, item });
          return { _id: `disp-${captured.length}`, ...item };
        },
      },
      proxyTokenStore: null,
      collectiveCharactersStore: {
        list: async () => [],
        createCustom: async (urlKey, data) => { recorded.push({ kind: 'custom', urlKey, data }); return { id: 'c1', ...data }; },
        recordRecent: async (urlKey, data) => { recorded.push({ kind: 'recent', urlKey, data }); return { id: 'r1', ...data }; },
      },
      yapClient: { baseUrl: YAP_BASE_URL },
      getOpenRouterSource: () => null,
      getDeployInfo: () => ({}),
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: req.params.urlKey };
        req.session = { linearUserId: 'u1', features: { collective: true }, workspaces: WORKSPACES };
        next();
      },
    }));
    return app;
  }

  test('a filled-in character prepends its persona block (and threads value)', async () => {
    const captured = [];
    const app = buildAppWithStore(captured, []);
    const res = await call(app, 'post', START_PATH, {
      channel: '#test-room',
      characters: [{
        workspaceUrlKey: 'alpha',
        role: 'Skeptic',
        lens: 'what could go wrong',
        objective: 'find the flaw',
        value: 'healthy doubt',        // the fifth field must survive the roster
        disposition: 'probing',
      }],
    });
    assert.equal(res.status, 201);
    assert.equal(captured.length, 1);
    const prompt = captured[0].item.prompt;
    assert.ok(prompt.includes('## Your character: Skeptic'), 'persona block present');
    assert.ok(prompt.includes('healthy doubt'), 'value field is threaded into the persona block');
  });

  test('records a recent per dispatched character (the load-bearing write path)', async () => {
    const captured = [];
    const recorded = [];
    const app = buildAppWithStore(captured, recorded);
    await call(app, 'post', START_PATH, {
      channel: '#test-room',
      characters: [{ workspaceUrlKey: 'alpha', role: 'Skeptic' }, { workspaceUrlKey: 'bravo', role: 'Builder' }],
    });
    const recents = recorded.filter(r => r.kind === 'recent');
    assert.equal(recents.length, 2, 'one recordRecent per dispatched character');
    // Partitioned under the ANCHOR workspace, carrying the bound repo key.
    assert.equal(recents[0].urlKey, 'alpha'); // anchor = route :urlKey
    assert.equal(recents[0].data.workspaceUrlKey, 'alpha');
    assert.equal(recents[1].data.workspaceUrlKey, 'bravo');
  });

  // REGRESSION (LIN-1048): the client (public/collective.js addDefinedCharacter)
  // stamps every define-new row with a local `pending-N` id and POSTs the whole
  // object. The route must persist a `save:true` character as custom EVEN WHEN it
  // carries such an id — the old `if (raw.save && !raw.id)` guard made customs
  // unreachable from the real UI. The prior version of this test omitted the id,
  // which is why it stayed green while the UI was broken; it now posts the real
  // client shape (pending- id present).
  test('save:true on a new character (real client pending- id) persists it as custom before recording recent', async () => {
    const captured = [];
    const recorded = [];
    const app = buildAppWithStore(captured, recorded);
    await call(app, 'post', START_PATH, {
      channel: '#test-room',
      characters: [{ id: 'pending-0', workspaceUrlKey: 'alpha', role: 'Skeptic', name: 'My Skeptic', save: true }],
    });
    assert.ok(recorded.some(r => r.kind === 'custom' && r.data.name === 'My Skeptic'), 'saved as custom despite pending- id');
    assert.ok(recorded.some(r => r.kind === 'recent'), 'still recorded as recent');
  });

  // End-to-end persistence proof against the REAL store: the real client payload
  // must leave a `custom` record visible via store.list() (i.e. it survives a
  // reload of the picker), not just a transient recent. This is the reviewer's
  // f694190e repro turned into an assertion.
  test('real client payload persists a custom visible via store.list (reviewer repro)', async () => {
    const collection = createMockCollection();
    const store = new CollectiveCharactersStore({ collection });
    const captured = [];
    const app = express();
    app.use(express.json());
    app.use(createCollectiveRoutes({
      dispatchQueueStore: {
        addItem: async (urlKey, item) => { captured.push({ urlKey, item }); return { _id: `disp-${captured.length}`, ...item }; },
      },
      proxyTokenStore: null,
      collectiveCharactersStore: store,
      yapClient: { baseUrl: YAP_BASE_URL },
      getOpenRouterSource: () => null,
      getDeployInfo: () => ({}),
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: req.params.urlKey };
        req.session = { linearUserId: 'u1', features: { collective: true }, workspaces: WORKSPACES };
        next();
      },
    }));

    const res = await call(app, 'post', START_PATH, {
      channel: '#test-room',
      characters: [{ id: 'pending-0', workspaceUrlKey: 'alpha', role: 'Skeptic', name: 'My Skeptic', save: true }],
    });
    assert.equal(res.status, 201);

    // Anchor = route :urlKey ('alpha'). On reload the picker reads store.list(anchor).
    const saved = await store.list('alpha');
    const customs = saved.filter(c => c.kind === 'custom');
    assert.equal(customs.length, 1, 'exactly one custom persisted from the real client payload');
    assert.equal(customs[0].name, 'My Skeptic');
    assert.equal(customs[0].workspaceUrlKey, 'alpha');
    assert.equal(customs[0].role, 'Skeptic');
  });

  test('a character bound to an unconnected workspace is dropped; all-stale → 400', async () => {
    const captured = [];
    const app = buildAppWithStore(captured, []);
    const res = await call(app, 'post', START_PATH, {
      channel: '#test-room',
      characters: [{ workspaceUrlKey: 'ghost', role: 'Nobody' }],
    });
    assert.equal(res.status, 400);
    assert.equal(captured.length, 0);
  });
});
