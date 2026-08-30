/**
 * LIN-2254 — PUT /workspace/:urlKey/api/roadmap/north-star doc-version stamping.
 *
 * No test previously constructed createRoadmapRoutes at all (zero hits for
 * `createRoadmapRoutes` across tests/), so this is new route-level coverage,
 * not an extension. Harness modeled on tests/unit/proxy-north-star-route.js's
 * real-app + listening-server + fetch pattern, with the session faked as a
 * mutable object closed over ACROSS requests (so a PUT-then-GET round trip is
 * possible within one test) — the tests/unit/workspace-api-autopilot-max-tasks
 * `req.session = {...}` convention, but held outside the middleware.
 *
 * No doc-content mocking: every match/drift assertion reads the real,
 * current docs/north-star.md hash via getNorthStarDocVersion() at test time,
 * so these stay valid across any future doc edit.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRoadmapRoutes } from '../../routes/workspace-api-roadmap.js';
import { getNorthStarDocVersion } from '../../lib/north-star-resolver.js';

const URL_KEY = 'acme';
const DOC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'north-star.md');
const DOC_TEXT = readFileSync(DOC_PATH, 'utf-8');

function buildApp({ userPreferencesStore, accountId = 'creator-1' } = {}) {
  const session = { features: { roadmap: true }, accountId };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session;
    req.workspace = { urlKey: URL_KEY };
    next();
  });
  app.use(createRoadmapRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: {},
    userPreferencesStore,
    workspacePreferencesStore: {},
    reportHistoryStore: {}
  }));
  return { app, session };
}

async function request(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const put = (app, northStar) => request(app, 'PUT', `/workspace/${URL_KEY}/api/roadmap/north-star`, { northStar });

function fakeStore() {
  const byAccount = new Map();
  return {
    saved: byAccount,
    getUserPreferences: async (accountId) => byAccount.get(accountId) || {},
    saveUserPreferences: async (accountId, prefs) => { byAccount.set(accountId, prefs); }
  };
}

describe('PUT /workspace/:urlKey/api/roadmap/north-star — docVersion stamping (LIN-2254)', () => {
  test('pasting text identical to the live doc stamps the real hash/title in both session and store', async () => {
    const real = getNorthStarDocVersion();
    const userPreferencesStore = fakeStore();
    const { app, session } = buildApp({ userPreferencesStore });

    const { status, body } = await put(app, DOC_TEXT);
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });

    assert.deepEqual(session.northStarDocVersionByWorkspace[URL_KEY], { hash: real.hash, title: real.title });
    const stored = userPreferencesStore.saved.get('creator-1');
    assert.deepEqual(stored.northStarDocVersionByWorkspace[URL_KEY], { hash: real.hash, title: real.title });
    // The pre-existing preference is untouched in shape.
    assert.equal(stored.northStarByWorkspace[URL_KEY], DOC_TEXT);
  });

  test('pasting arbitrary unrelated text stores null for the stamp (the multi-tenant case)', async () => {
    const userPreferencesStore = fakeStore();
    const { app, session } = buildApp({ userPreferencesStore });

    const { status, body } = await put(app, 'Be the simplest way to ship.');
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });

    assert.equal(session.northStarDocVersionByWorkspace[URL_KEY], null);
    const stored = userPreferencesStore.saved.get('creator-1');
    assert.equal(stored.northStarDocVersionByWorkspace[URL_KEY], null);
    assert.equal(stored.northStarByWorkspace[URL_KEY], 'Be the simplest way to ship.');
  });

  test('overwriting a previously-matching value with a non-matching one clears the stale stamp to null', async () => {
    const userPreferencesStore = fakeStore();
    const { app, session } = buildApp({ userPreferencesStore });

    const first = await put(app, DOC_TEXT);
    assert.equal(first.status, 200);
    assert.notEqual(session.northStarDocVersionByWorkspace[URL_KEY], null);

    const second = await put(app, 'star two, unrelated');
    assert.equal(second.status, 200);
    assert.equal(session.northStarDocVersionByWorkspace[URL_KEY], null);
    const stored = userPreferencesStore.saved.get('creator-1');
    assert.equal(stored.northStarDocVersionByWorkspace[URL_KEY], null);
  });

  test('userPreferencesStore write-through failure is non-fatal — PUT still 200s and the session stamp still lands', async () => {
    const real = getNorthStarDocVersion();
    const userPreferencesStore = {
      getUserPreferences: async () => { throw new Error('store down'); },
      saveUserPreferences: async () => { throw new Error('store down'); }
    };
    const { app, session } = buildApp({ userPreferencesStore });

    const { status, body } = await put(app, DOC_TEXT);
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.deepEqual(session.northStarDocVersionByWorkspace[URL_KEY], { hash: real.hash, title: real.title });
  });
});
