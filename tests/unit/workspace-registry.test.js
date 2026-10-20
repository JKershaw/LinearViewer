/**
 * Unit tests for lib/workspace-registry.js (LIN-3700): `recordWorkspace` is a
 * best-effort, write-only hand-off of `{id, urlKey, provider}` to the store.
 *
 * Run with: node --test tests/unit/workspace-registry.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recordWorkspace } from '../../lib/workspace-registry.js';

const deepFreeze = (o) => {
  Object.values(o).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
};
const loggerSpy = () => { const lines = []; return { lines, log: (l) => lines.push(l) }; };
const spyStore = (result = { ok: true, created: true, idChanged: false }) => {
  const calls = [];
  return { calls, registerWorkspace: async (entry) => { calls.push(entry); return result; } };
};

describe('recordWorkspace', () => {
  test('a full workspace reaches the store as exactly {id, urlKey, provider}', async () => {
    const canary = `CANARY-${randomUUID()}`; // built at run time, as the redaction canary sweep does
    const workspace = {
      id: 'w-1', urlKey: 'acme', name: 'Acme', provider: 'jira', accessToken: canary, refreshToken: canary,
      bindings: [{ provider: 'jira', scope: 'site', credentials: { token: canary } }]
    };
    const store = spyStore();
    await recordWorkspace(store, workspace, { logger: loggerSpy() });
    assert.deepEqual(store.calls, [{ id: 'w-1', urlKey: 'acme', provider: 'jira' }]);
    assert.ok(!JSON.stringify(store.calls).includes(canary));
  });

  test('a deep-frozen workspace is untouched and does not throw', async () => {
    const workspace = deepFreeze({ id: 'w-1', urlKey: 'acme', provider: 'github', bindings: [{ provider: 'github', scope: 'o/r', credentials: { token: 't' } }] });
    const before = JSON.stringify(workspace);
    await recordWorkspace(spyStore(), workspace, { logger: loggerSpy() });
    assert.equal(JSON.stringify(workspace), before);
  });

  test('a providerless legacy workspace records as linear (normalizeProvider)', async () => {
    const store = spyStore();
    await recordWorkspace(store, { id: 'w-1', urlKey: 'legacy' }, { logger: loggerSpy() });
    assert.equal(store.calls[0].provider, 'linear');
  });

  test('a missing store logs the one fixed skip line and does not throw', async () => {
    const logger = loggerSpy();
    await recordWorkspace(undefined, { id: 'w-1', urlKey: 'acme' }, { logger });
    assert.deepEqual(logger.lines, ['[workspace-registry] skipped: no-store']);
  });

  test('an invalid input logs the store\'s reason as the skip line', async () => {
    const logger = loggerSpy();
    await recordWorkspace(spyStore({ ok: false, reason: 'invalid-urlkey' }), { id: 'w-1', urlKey: 'Bad Key' }, { logger });
    assert.deepEqual(logger.lines, ['[workspace-registry] skipped: invalid-urlkey']);
  });

  test('a null workspace is a skip, not a throw', async () => {
    const logger = loggerSpy();
    await recordWorkspace(spyStore({ ok: false, reason: 'invalid-id' }), null, { logger });
    assert.equal(logger.lines.length, 1);
  });

  test('an async store error is swallowed and only its class is logged, never its message', async () => {
    const logger = loggerSpy();
    class MongoNetworkError extends Error {}
    const store = { registerWorkspace: async () => { throw new MongoNetworkError('connect mongodb://user:hunter2@host'); } };
    await recordWorkspace(store, { id: 'w-1', urlKey: 'acme', provider: 'linear' }, { logger });
    assert.deepEqual(logger.lines, ['[workspace-registry] store error: MongoNetworkError']);
    assert.ok(!logger.lines.join('').includes('hunter2'));
  });

  test('a synchronous throw from the store is swallowed too', async () => {
    const logger = loggerSpy();
    const store = { registerWorkspace: () => { throw new TypeError('sync'); } };
    await recordWorkspace(store, { id: 'w-1', urlKey: 'acme', provider: 'linear' }, { logger });
    assert.deepEqual(logger.lines, ['[workspace-registry] store error: TypeError']);
  });

  test('a throwing logger cannot make it throw', async () => {
    const logger = { log: () => { throw new Error('logger down'); } };
    await recordWorkspace(undefined, { id: 'w-1', urlKey: 'acme' }, { logger });
  });
});
