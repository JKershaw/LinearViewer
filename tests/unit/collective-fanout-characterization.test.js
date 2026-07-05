/**
 * Fan-out equivalence anchor for POST /collective/start (LIN-1047, beat 3).
 *
 * Beat 3 re-expresses the /collective/start dispatch loop so it iterates over
 * CHARACTERS rather than raw workspaces, seeding one generic
 * DEFAULT_COLLECTIVE_CHARACTER per selected workspace with no roster. That is a
 * behaviour-preserving refactor: the dispatched set must be byte-for-byte what
 * HEAD produced. This test is the compatibility anchor — it drives the real
 * router with a spy dispatch store and asserts the dispatched payloads.
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
import {
  buildCollectiveParticipantPrompt,
  DEFAULT_COLLECTIVE_CHARACTER,
} from '../../lib/prompts/collective-participant.js';

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
      workspaceUrlKeys: ['alpha', 'bravo', 'charlie'],
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
      workspaceUrlKeys: ['alpha', 'bravo', 'charlie'],
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
      workspaceUrlKeys: ['alpha'],
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
      workspaceUrlKeys: ['alpha', 'bravo', 'charlie'],
    });
    const nicks = res.body.dispatched.map(d => d.nick);
    assert.equal(new Set(nicks).size, nicks.length, 'nicks must be distinct across the fan-out');
  });
});
