/**
 * LIN-3601 — the exact key sets of the two proxy dispatch reads (a gap: both
 * were explicit allow-lists in routes/proxy-dispatch.js that no behaviour test
 * pinned key by key).
 *
 *   GET /api/proxy/dispatch        items re-projected through an allow-list (:1524)
 *   GET /api/proxy/dispatch/:id    formatDispatchWatch (:197), which SPREADS
 *                                  closedProjection(item.bookkeeping) (:243), so
 *                                  its key set depends on the row
 *
 * The fixture row carries every field that must NOT leave: `bootstrapToken`,
 * `prompt`, `grantDeclaration`, `grantRefusal` (LIN-3134 declaration records)
 * and an unknown key. The key sets are literals. INTENDED CONTRACT CHANGE: a
 * deliberate new field on either read is made by editing the literal below, in
 * the same PR as the route; an accidental one (a spread of the row) fails here.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyRoutes } from '../../routes/proxy.js';
import { BASE_DEPS } from './lib/proxy-fake-deps.js';
import { appAround, request, SAMPLE_UUID } from './lib/entrance-route-sweep.js';

const HEADERS = { Authorization: 'Bearer anything' };
const NEVER = ['bootstrapToken', 'prompt', 'grantDeclaration', 'grantRefusal', 'unknownKey'];

/** One fixed queued row, with every key that must not leave and one unknown key. */
const queuedRow = () => ({
  id: SAMPLE_UUID,
  status: 'queued',
  promptName: 'Prompt',
  kind: 'custom',
  issueIdentifier: 'LIN-1',
  issueUrl: 'https://example.test/LIN-1',
  target: 'cli',
  sessionId: 'sess-1',
  maxTasks: 3,
  dispatchedAt: '2026-10-17T00:00:00.000Z',
  dispatchedBy: 'acct-1',
  bootstrapToken: 'fixture-bootstrap-token',
  prompt: 'fixture prompt text',
  grantDeclaration: { grants: ['dispatch'] },
  grantRefusal: { code: 'GRANT_REFUSED' },
  unknownKey: 'fixture-unknown',
  feedback: []
});

function appFor(row) {
  const deps = BASE_DEPS();
  deps.dispatchQueueStore = {
    ...deps.dispatchQueueStore,
    listItems: async () => [{ ...row }],
    listHistory: async () => ({ items: [], total: 0 }),
    getItemStatus: async () => ({ ...row }),
    // LIN-3812: the watch reads the feedback shape, /prompt the prompt shape.
    getItemFeedback: async () => ({ ...row }),
    getItemPrompt: async () => ({ ...row })
  };
  return appAround(createProxyRoutes(deps));
}

const LIST_ITEM_KEYS = [
  'id', 'status', 'promptName', 'kind', 'issueIdentifier', 'issueUrl', 'target', 'sessionId', 'maxTasks',
  'dispatchedAt', 'resolvedAt', 'completedAt', 'closedAt', 'closedReason', 'feedbackCount',
  'consumerLastSeenAt', 'consumerPollWarning'
];
const WATCH_KEYS = [
  'id', 'status', 'promptName', 'kind', 'issueIdentifier', 'issueUrl', 'target', 'model', 'harness', 'terminal',
  'effort', 'presetName', 'followUpTo', 'force', 'abort', 'abortTo', 'cascade', 'sessionId', 'maxTasks', 'repo',
  'dispatchedAt', 'dispatchedBy', 'resolvedAt', 'completedAt', 'closedAt', 'closedReason', 'consumerLastSeenAt',
  'consumerPollWarning', 'feedback', 'wakeShadow'
];

describe('LIN-3601 GET /api/proxy/dispatch — the list item key set', () => {
  test('is exactly the allow-list, whatever else the stored row carries', async () => {
    const res = await request(appFor(queuedRow()), 'GET', '/api/proxy/dispatch', { headers: HEADERS });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.items.length, 1);
    assert.deepEqual(Object.keys(res.body.items[0]).sort(), [...LIST_ITEM_KEYS].sort());
    assert.deepEqual(Object.keys(res.body).sort(), ['items', 'total', 'truncated']);
    for (const key of NEVER) assert.ok(!(key in res.body.items[0]), `${key} must not leave on the list`);
    assert.ok(!res.text.includes('fixture-bootstrap-token') && !res.text.includes('fixture prompt text'));
  });
});

describe('LIN-3601 GET /api/proxy/dispatch/:id — the watch key set (formatDispatchWatch)', () => {
  test('a fixed queued row: the exact key set as a literal, sessionId present, none of the withheld fields', async () => {
    const res = await request(appFor(queuedRow()), 'GET', `/api/proxy/dispatch/${SAMPLE_UUID}`, { headers: HEADERS });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(Object.keys(res.body).sort(), [...WATCH_KEYS].sort());
    assert.equal(res.body.sessionId, 'sess-1', 'sessionId is present (LIN-2975)');
    for (const key of NEVER) assert.ok(!(key in res.body), `${key} must not leave on the watch`);
    assert.ok(!res.text.includes('fixture-bootstrap-token') && !res.text.includes('fixture prompt text'));
  });

  test('a row stamped closed (bookkeeping) keeps the same key set; only the closed values change', async () => {
    const row = { ...queuedRow(), bookkeeping: { at: '2026-10-17T01:00:00.000Z', reason: 'operator' } };
    const res = await request(appFor(row), 'GET', `/api/proxy/dispatch/${SAMPLE_UUID}`, { headers: HEADERS });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(Object.keys(res.body).sort(), [...WATCH_KEYS].sort());
    assert.equal(res.body.status, 'closed');
    assert.equal(res.body.closedAt, '2026-10-17T01:00:00.000Z');
    assert.equal(res.body.closedReason, 'operator');
  });

  test('the long-poll reply adds exactly reason and waitedMs, and only when ?wait is sent', async () => {
    const row = { ...queuedRow(), bookkeeping: { at: '2026-10-17T01:00:00.000Z', reason: 'operator' } };
    const res = await request(appFor(row), 'GET', `/api/proxy/dispatch/${SAMPLE_UUID}?wait=1`, { headers: HEADERS });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(Object.keys(res.body).sort(), [...WATCH_KEYS, 'reason', 'waitedMs'].sort());
    assert.equal(res.body.reason, 'terminal');
  });

  test('a feedback entry carries exactly message, url, urlLabel, timestamp (rootItemId and kind only when set)', async () => {
    const row = { ...queuedRow(), feedback: [{ message: 'm', url: null, timestamp: '2026-10-17T00:30:00.000Z', secret: 'withheld' }] };
    const res = await request(appFor(row), 'GET', `/api/proxy/dispatch/${SAMPLE_UUID}`, { headers: HEADERS });
    assert.deepEqual(Object.keys(res.body.feedback[0]).sort(), ['message', 'timestamp', 'url', 'urlLabel']);
    const withExtras = { ...queuedRow(), feedback: [{ message: 'm', rootItemId: 'r', kind: 'k' }] };
    const res2 = await request(appFor(withExtras), 'GET', `/api/proxy/dispatch/${SAMPLE_UUID}`, { headers: HEADERS });
    assert.deepEqual(Object.keys(res2.body.feedback[0]).sort(), ['kind', 'message', 'rootItemId', 'timestamp', 'url', 'urlLabel']);
  });
});
