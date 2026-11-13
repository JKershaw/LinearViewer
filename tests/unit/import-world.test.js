/**
 * LIN-4471: the native-import world (tests/unit/helpers/import-world.js) is the seam converted page modules are tested
 * through, so its two promises are witnessed here: a fresh import shares no module state, and every global a world
 * replaces is put back, including when the test throws before it restores.
 *
 * Run with: node --test tests/unit/import-world.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';

const COUNTER = new URL('../fixtures/import-world/counter.js', import.meta.url).pathname;

test('two fresh imports of one module share no state', async (t) => {
  const world = importWorld();
  t.after(() => world.restore());
  const first = await world.importPage(COUNTER);
  const second = await world.importPage(COUNTER);
  assert.equal(first.bump(), 1);
  assert.equal(first.bump(), 2);
  assert.equal(second.current(), 0, 'the second instance starts at its own zero');
  assert.equal(second.bump(), 1);
  assert.equal(first.current(), 2, 'and the first instance is unchanged by the second');
});

test('the fake DOM, window stubs and a collecting setTimeout are installed, then restored by descriptor', async () => {
  const before = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    setTimeout: Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'),
    widget: Object.getOwnPropertyDescriptor(globalThis, 'widgetStub'),
  };
  const timers = [];
  const world = importWorld({ window: { widgetStub: 'stub' }, timers });
  try {
    assert.equal(globalThis.window, globalThis, 'window is the global');
    assert.ok(globalThis.document && globalThis.document === world.document, 'document is the fake');
    assert.equal(globalThis.widgetStub, 'stub');
    globalThis.setTimeout(() => {}, 5);
    assert.equal(timers.length, 1, 'setTimeout collects');
  } finally {
    world.restore();
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'document'), before.document);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'window'), before.window);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'), before.setTimeout);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'widgetStub'), before.widget);
});

test('a global a classic script adds is removed on restore, even when the test throws before restoring', () => {
  const world = importWorld({ globals: { getComputedStyle: () => ({ getPropertyValue: () => '' }) } });
  assert.throws(() => {
    try {
      world.runClassic('chart-helpers.js');
      assert.ok(globalThis.HarbourCharts, 'the classic script defined its global');
      throw new Error('the test fails part way');
    } finally {
      world.restore();
    }
  }, /part way/);
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis, 'HarbourCharts'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis, 'document'), false);
});

test('a getter-only global is never assigned, so a stub of its name is defined, not set', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const world = importWorld({ globals: { navigator: { clipboard: { writeText: async () => {} } } } });
  try {
    assert.equal(globalThis.navigator.clipboard !== undefined, true);
  } finally {
    world.restore();
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'navigator'), before);
});
