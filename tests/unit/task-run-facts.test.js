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
import { readTaskRunFacts, stopAtFromRows, RUN_FACT_DEFAULTS } from '../../lib/task-run-facts.js';

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

// LIN-3722: the one aggregation shared with the run page (routes/dashboard.js).
describe('stopAtFromRows', () => {
  const PR = { stopAt: 'pr' };
  const table = [
    ['a pr row', [PR], 'pr'],
    ['merge', [{ stopAt: 'merge' }], null],
    ['null', [{ stopAt: null }], null],
    ['undefined', [{}], null],
    ['no rows', [], null],
    ['truthy non-pr values', [{ stopAt: true }, { stopAt: 'PR' }, { stopAt: 1 }], null],
    ['falsy entries among a pr row', [null, undefined, false, 0, PR], 'pr'],
    ['falsy entries only', [null, undefined, false, 0], null],
    ['pr first', [PR, { stopAt: 'merge' }], 'pr'],
    ['pr last', [{ stopAt: 'merge' }, PR], 'pr'],
  ];
  for (const [name, rows, expected] of table) {
    test(`${name} -> ${expected}`, () => assert.equal(stopAtFromRows(rows), expected));
  }
});

describe('readTaskRunFacts: stopAt over the same row table as the run page', () => {
  const PR = { stopAt: 'pr' };
  const ask = s => readTaskRunFacts({ store: s, urlKey: 'ws', issueIdentifier: 'LIN-50' });
  const rowCases = [
    ['pr in queue only', { queue: [PR] }, 'pr'],
    ['pr in history only', { history: [PR] }, 'pr'],
    ['merge', { queue: [{ stopAt: 'merge' }] }, null],
    ['null and undefined', { queue: [{ stopAt: null }, {}] }, null],
    ['falsy entries among a pr row', { queue: [null, undefined, false, 0, PR] }, 'pr'],
    ['no rows', {}, null],
  ];
  for (const [name, input, expected] of rowCases) {
    test(`${name} -> ${expected}`, async () => assert.equal((await ask(store(input))).stopAt, expected));
  }

  test('history as a bare array, as { items } and as null', async () => {
    const base = store({ queue: [PR] });
    assert.equal((await ask({ ...base, listHistory: async () => [PR] })).stopAt, 'pr');
    assert.equal((await ask({ ...base, listHistory: async () => ({ items: [PR] }) })).stopAt, 'pr');
    assert.equal((await ask({ ...base, listHistory: async () => null })).stopAt, 'pr');
  });

  test('a rejecting listItems still reads history', async () => {
    const s = { ...store({ history: [PR] }), listItems: async () => { throw new Error('boom'); } };
    assert.equal((await ask(s)).stopAt, 'pr');
  });

  test('a store without listItems is skipped, not fatal (differs from the run page)', async () => {
    const s = store({ history: [PR] });
    delete s.listItems;
    assert.equal((await ask(s)).stopAt, 'pr');
  });

  // The hop: the task page lifts stopAt from the parent run row, the run page does not.
  const hopCases = [
    ['parent pr', { stopAt: 'pr' }, 'pr'],
    ['parent null', { stopAt: null }, null],
    ['parent merge', { stopAt: 'merge' }, null],
    ['no parent row', undefined, null],
  ];
  for (const [name, parent, expected] of hopCases) {
    test(`hop: ${name} -> ${expected}`, async () => {
      const s = store({ queue: [{ kind: 'implementation', sessionId: 'sess-1' }], hops: parent ? { 'sess-1': parent } : {} });
      assert.equal((await ask(s)).stopAt, expected);
    });
  }
});

// LIN-3725: the run page calls with `hopVariant: false`: the hop lifts stopAt only.
describe('readTaskRunFacts: hopVariant false (the run page)', () => {
  const hops = { 'run-1': { kind: 'autopilot', stopAt: 'pr', variant: 'standard' } };
  const queue = [{ kind: 'implementation', sessionId: 'run-1' }];
  test('stopAt hops, variant stays unknown', async () => {
    assert.deepEqual(
      await readTaskRunFacts({ store: store({ queue, hops }), urlKey: 'ws', issueIdentifier: 'LIN-50', hopVariant: false }),
      { stopAt: 'pr', variant: 'unknown' });
  });
  test('default still hops the variant too', async () => {
    assert.deepEqual(
      await readTaskRunFacts({ store: store({ queue, hops }), urlKey: 'ws', issueIdentifier: 'LIN-50' }),
      { stopAt: 'pr', variant: 'standard' });
  });
  test('no hop read when own rows already carry stopAt', async () => {
    const s = store({ queue: [{ kind: 'autopilot', stopAt: 'pr', variant: 'standard', sessionId: 'run-1' }] });
    s.getItemStatus = async () => { throw new Error('should not hop'); };
    assert.equal((await readTaskRunFacts({ store: s, urlKey: 'ws', issueIdentifier: 'LIN-50', hopVariant: false })).stopAt, 'pr');
  });
});
