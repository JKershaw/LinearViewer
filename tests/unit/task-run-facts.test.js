/**
 * LIN-3340 — `lib/task-run-facts.js`, the task-keyed `{ stopAt, variant }`
 * reader shared by the check route and the task-page loader.
 *
 * Pins: own rows (queue and history); the subtask `sessionId` hop to the parent
 * run row; the null case (a run row with no stopAt); a store without
 * `getItemStatus`; a store error; and the fail-closed variant rule.
 *
 * Run with: node --test tests/unit/task-run-facts.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readTaskRunFacts, RUN_FACT_DEFAULTS } from '../../lib/task-run-facts.js';

function store({ queue = [], history = [], hops = {}, throws = false } = {}) {
  return {
    async listItems() { if (throws) throw new Error('boom'); return queue; },
    async listHistory() { if (throws) throw new Error('boom'); return { items: history }; },
    async getItemStatus(_urlKey, sessionId) { return hops[sessionId] || null; },
  };
}

describe('readTaskRunFacts: own rows', () => {
  test('a queue row carries stopAt + variant', async () => {
    const s = store({ queue: [{ kind: 'autopilot', stopAt: 'pr', variant: 'standard' }] });
    assert.deepEqual(await readTaskRunFacts({ store: s, urlKey: 'ws', issueIdentifier: 'LIN-50' }), { stopAt: 'pr', variant: 'standard' });
  });

  test('a finished run lives in history only', async () => {
    const s = store({ history: [{ kind: 'autopilot', stopAt: 'pr', variant: 'stepper' }] });
    assert.deepEqual(await readTaskRunFacts({ store: s, urlKey: 'ws', issueIdentifier: 'LIN-50' }), { stopAt: 'pr', variant: 'stepper' });
  });

  test('no stop-at row is null; no autopilot row is an unknown variant', async () => {
    const s = store({ queue: [{ kind: 'implementation' }] });
    assert.deepEqual(await readTaskRunFacts({ store: s, urlKey: 'ws', issueIdentifier: 'LIN-50' }), { stopAt: null, variant: 'unknown' });
  });
});

describe('readTaskRunFacts: the subtask sessionId hop', () => {
  test('a worker row with no facts resolves the parent run row through sessionId', async () => {
    const s = store({
      queue: [{ kind: 'implementation', sessionId: 'run-1' }],
      hops: { 'run-1': { kind: 'autopilot', stopAt: 'pr', variant: 'standard' } },
    });
    assert.deepEqual(await readTaskRunFacts({ store: s, urlKey: 'ws', issueIdentifier: 'LIN-51' }), { stopAt: 'pr', variant: 'standard' });
  });

  test('a run row without stopAt leaves stopAt null (the null case)', async () => {
    const s = store({
      queue: [{ kind: 'implementation', sessionId: 'run-1' }],
      hops: { 'run-1': { kind: 'autopilot', variant: 'standard' } },
    });
    assert.deepEqual(await readTaskRunFacts({ store: s, urlKey: 'ws', issueIdentifier: 'LIN-51' }), { stopAt: null, variant: 'standard' });
  });

  test('no getItemStatus: the hop is skipped, defaults stand', async () => {
    const s = { async listItems() { return [{ kind: 'implementation', sessionId: 'run-1' }]; }, async listHistory() { return { items: [] }; } };
    assert.deepEqual(await readTaskRunFacts({ store: s, urlKey: 'ws', issueIdentifier: 'LIN-51' }), { stopAt: null, variant: 'unknown' });
  });
});

describe('readTaskRunFacts: fail closed', () => {
  test('a store error returns the defaults', async () => {
    const s = store({ throws: true });
    assert.deepEqual(await readTaskRunFacts({ store: s, urlKey: 'ws', issueIdentifier: 'LIN-50' }), { ...RUN_FACT_DEFAULTS });
  });

  test('missing args return the defaults', async () => {
    assert.deepEqual(await readTaskRunFacts({}), { ...RUN_FACT_DEFAULTS });
    assert.deepEqual(await readTaskRunFacts({ store: store(), urlKey: 'ws' }), { ...RUN_FACT_DEFAULTS });
  });
});
