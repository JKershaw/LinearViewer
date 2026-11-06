/**
 * LIN-4322: the `truncated` flag reaches the wire through the two issue-read
 * routes, and the detail route still sorts comments oldest first when a provider
 * hands them back out of order. A flag the route drops is a silent cut again.
 *
 * Fake provider only; no live hosts.
 */
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, call, makeFakeProvider } from './lib/proxy-fake-deps.js';

const c = (id, createdAt) => ({ id, body: id, createdAt, user: { name: 'Fake' } });

test('GET /issues/:id carries a top-level truncated flag and sorts comments oldest first', async () => {
  const app = buildApp({
    provider: {
      ...makeFakeProvider(),
      issueDetail: async () => ({
        id: 'i1',
        identifier: 'LIN-1',
        title: 't',
        state: { name: 'Todo', type: 'unstarted' },
        comments: { nodes: [c('late', '2026-11-03T00:00:00Z'), c('early', '2026-11-01T00:00:00Z'), c('mid', '2026-11-02T00:00:00Z')] },
        truncated: { comments: true },
      }),
    },
  });
  const res = await call(app, 'GET', '/api/proxy/issues/LIN-1');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.truncated, { comments: true });
  assert.deepEqual(res.body.comments.map((x) => x.id), ['early', 'mid', 'late']);
});

test('GET /issues/:id has no truncated key when the provider cut nothing', async () => {
  const res = await call(buildApp({ provider: makeFakeProvider() }), 'GET', '/api/proxy/issues/LIN-1');
  assert.equal(res.status, 200);
  assert.equal('truncated' in res.body, false);
});

test('GET /issues/:id/relations carries a top-level truncated flag beside trashed', async () => {
  const app = buildApp({
    provider: {
      ...makeFakeProvider(),
      relations: async () => ({ trashed: false, relations: { nodes: [] }, inverseRelations: { nodes: [] }, truncated: { inverseRelations: true } }),
    },
  });
  const res = await call(app, 'GET', '/api/proxy/issues/LIN-1/relations');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.truncated, { inverseRelations: true });
  assert.equal(res.body.trashed, false);
});

test('GET /issues/:id/relations has no truncated key when nothing was cut', async () => {
  const res = await call(buildApp({ provider: makeFakeProvider() }), 'GET', '/api/proxy/issues/LIN-1/relations');
  assert.equal(res.status, 200);
  assert.equal('truncated' in res.body, false);
});
