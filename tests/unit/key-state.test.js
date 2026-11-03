/**
 * LIN-4168: the per-key reset registry (lib/key-state.js). Its own rules, independent of the holders it is given.
 *
 * Run with: node --test tests/unit/key-state.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyState } from '../../lib/key-state.js';

const probeZero = () => 0;

describe('registration', () => {
  test('a holder needs a name, a clear and a probe', () => {
    const ks = createKeyState();
    assert.throws(() => ks.holder({ name: '', clear() {}, probe: probeZero }), /needs a name/);
    assert.throws(() => ks.holder({ name: 'x', probe: probeZero }), /needs a clear/);
    assert.throws(() => ks.holder({ name: 'x', clear() {} }), /needs a probe/);
  });

  test('a duplicate name throws, whether it is a holder or an exception', () => {
    const ks = createKeyState();
    ks.holder({ name: 'memo', clear() {}, probe: probeZero });
    assert.throws(() => ks.holder({ name: 'memo', clear() {}, probe: probeZero }), /already registered/);
    ks.globalOnly({ name: 'kpi', why: 'instance-wide', clearedBy: 'reset' });
    assert.throws(() => ks.holder({ name: 'kpi', clear() {}, probe: probeZero }), /already registered/);
    assert.throws(() => ks.globalOnly({ name: 'memo', why: 'x', clearedBy: 'y' }), /already registered/);
  });

  test('an exception needs a reason and what clears it', () => {
    const ks = createKeyState();
    assert.throws(() => ks.globalOnly({ name: 'a', why: '', clearedBy: 'x' }), /needs a why/);
    assert.throws(() => ks.globalOnly({ name: 'b', why: 'x' }), /needs a why/);
    ks.globalOnly({ name: 'c', why: 'keyed by repo', clearedBy: 'restart' });
    assert.deepEqual(ks.exceptionFor('c'), { name: 'c', why: 'keyed by repo', clearedBy: 'restart' });
    assert.equal(ks.exceptionFor('missing'), null);
  });

  test('resetKey needs a urlKey', async () => {
    const ks = createKeyState();
    await assert.rejects(() => ks.resetKey({}), /needs a urlKey/);
    await assert.rejects(() => ks.resetKey(null), /needs a urlKey/);
  });
});

describe('resetKey', () => {
  test('runs every clear before any refill, so a refill reads a fully cleared key', async () => {
    const ks = createKeyState();
    const order = [];
    ks.holder({ name: 'a', clear: () => order.push('clear:a'), refill: () => order.push('refill:a'), probe: probeZero });
    ks.holder({ name: 'b', clear: () => order.push('clear:b'), probe: probeZero });
    ks.holder({ name: 'c', clear: async () => { order.push('clear:c'); }, refill: async () => { order.push('refill:c'); }, probe: probeZero });
    await ks.resetKey({ urlKey: 'k' });
    assert.deepEqual(order, ['clear:a', 'clear:b', 'clear:c', 'refill:a', 'refill:c']);
  });

  test('passes the same context to every clear and refill', async () => {
    const ks = createKeyState();
    const seen = [];
    ks.holder({ name: 'a', clear: (ctx) => seen.push(['clear', ctx]), refill: (ctx) => seen.push(['refill', ctx]), probe: probeZero });
    const ctx = { urlKey: 'k', workspace: { id: 'w' }, accountId: 'acct' };
    await ks.resetKey(ctx);
    assert.deepEqual(seen, [['clear', ctx], ['refill', ctx]]);
  });

  test('a clear that throws fails the reset (loud), and no refill runs after it', async () => {
    const ks = createKeyState();
    let refilled = false;
    ks.holder({ name: 'bad', clear: () => { throw new Error('store down'); }, probe: probeZero });
    ks.holder({ name: 'after', clear() {}, refill: () => { refilled = true; }, probe: probeZero });
    await assert.rejects(() => ks.resetKey({ urlKey: 'k' }), /store down/);
    assert.equal(refilled, false);
  });

  test('a refill that throws is reported and does not fail the reset', async () => {
    const reported = [];
    const ks = createKeyState({ onRefillError: (name, err) => reported.push([name, err.message]) });
    let laterRefilled = false;
    ks.holder({ name: 'flaky', clear() {}, refill: () => { throw new Error('fetch failed'); }, probe: probeZero });
    ks.holder({ name: 'later', clear() {}, refill: () => { laterRefilled = true; }, probe: probeZero });
    await ks.resetKey({ urlKey: 'k' });
    assert.deepEqual(reported, [['flaky', 'fetch failed']]);
    assert.equal(laterRefilled, true, 'a failed refill does not stop the others');
  });

  test('probeAll reports what each holder keeps under the key, by name', () => {
    const ks = createKeyState();
    ks.holder({ name: 'x', clear() {}, probe: ({ urlKey }) => (urlKey === 'k' ? 2 : 0) });
    ks.holder({ name: 'y', clear() {}, probe: () => 5 });
    assert.deepEqual(ks.probeAll({ urlKey: 'k' }), { x: 2, y: 5 });
    assert.deepEqual(ks.holderNames(), ['x', 'y']);
  });
});
