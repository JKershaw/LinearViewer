/**
 * LIN-3604 — the session owner gate fails closed in the authority.
 *
 * The session route always passes `ctx.ownerGate` (routes/dispatch.js), so no HTTP request can
 * reach an `enterSessionDispatch` call without it, and the route sweeps
 * (dispatch-entrance-session-owner-sweep) cannot cover this property: that the authority never
 * runs the session lane with the gate missing, and never runs it ahead of the gate's position.
 * This calls the authority directly, with recording dependencies.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { enterSessionDispatch } from '../../lib/dispatch-entrance.js';
import { makeSpy } from './lib/entrance-route-sweep.js';

function makeCall(overrides = {}) {
  const spy = makeSpy();
  const responses = [];
  const res = {
    status(code) { responses.push({ status: code }); return this; },
    json(body) { responses.at(-1).body = body; return this; },
    set() { return this; }
  };
  const ctx = {
    req: {
      body: { prompt: 'p', target: 'cli', presetId: 'preset-1', cascade: undefined },
      session: { accountId: 'acct-member' },
      protocol: 'http',
      get: () => 'localhost:3000'
    },
    res,
    workspace: { urlKey: 'alpha', id: 'ws-alpha' },
    dispatchQueueStore: {
      addItem: spy.wrap('addItem', async (_k, fields) => ({ _id: 'item-1', ...fields })),
      expandCascadeAborts: spy.wrap('expandCascadeAborts', async () => ({})),
      getItemStatus: spy.wrap('getItemStatus', async () => null)
    },
    dispatchTokenStore: { listTokens: spy.wrap('listTokens', async () => []) },
    dispatchPresetsStore: { get: spy.wrap('presets.get', async () => ({ id: 'preset-1' })) },
    afterEnqueue: spy.wrap('afterEnqueue', async () => undefined),
    ...overrides
  };
  return { ctx, spy, responses };
}

describe('LIN-3604 enterSessionDispatch — the owner gate is required and runs at its one position', () => {
  test('a call without ctx.ownerGate throws before any dependency is read or written', async () => {
    const { ctx, spy, responses } = makeCall();
    await assert.rejects(() => enterSessionDispatch(ctx), /ownerGate/);
    assert.deepEqual(spy.names(), [], 'nothing was read or written');
    assert.deepEqual(responses, [], 'nothing was answered');
  });

  test('a non-function ownerGate is the same as none', async () => {
    for (const ownerGate of [null, undefined, true, 'gate', {}]) {
      const { ctx, spy } = makeCall({ ownerGate });
      await assert.rejects(() => enterSessionDispatch(ctx), /ownerGate/);
      assert.deepEqual(spy.names(), []);
    }
  });

  test('a refusing gate stops the lane before the preset lookup, the cascade expansion and every write', async () => {
    const { ctx, spy } = makeCall();
    ctx.req.body = { prompt: 'p', target: 'web', presetId: 'preset-1' };
    const targets = [];
    ctx.ownerGate = async (target) => { targets.push(target); return true; };
    await enterSessionDispatch(ctx);
    assert.deepEqual(targets, ['web'], 'the gate is asked about the target, once');
    assert.deepEqual(spy.names(), [], 'a refusal spends nothing: no preset lookup, no write');
  });

  test('the gate is asked about "cli" when the body names no target', async () => {
    const { ctx } = makeCall();
    ctx.req.body = { prompt: 'p' };
    const targets = [];
    ctx.ownerGate = async (target) => { targets.push(target); return true; };
    await enterSessionDispatch(ctx);
    assert.deepEqual(targets, ['cli']);
  });

  test('the shape checks run ahead of the gate, and every other check behind it', async () => {
    const calls = [];
    // A body that fails a shape check never reaches the gate (the route's order since LIN-3383) ...
    const shape = makeCall();
    shape.ctx.req.body = { target: 'cli' };
    shape.ctx.ownerGate = async () => { calls.push('gate'); return true; };
    await enterSessionDispatch(shape.ctx);
    assert.deepEqual(calls, [], 'prompt-required is a shape check: answered before the gate');
    assert.equal(shape.responses[0].status, 400);

    // ... and a body that fails a LATER check is answered only once the gate has let it through.
    const later = makeCall();
    later.ctx.req.body = { prompt: 'p', maxTasks: 0 };
    later.ctx.ownerGate = async () => { calls.push('gate'); return true; };
    await enterSessionDispatch(later.ctx);
    assert.deepEqual(calls, ['gate'], 'a refused caller learns nothing about the later checks');
    assert.deepEqual(later.responses, [], 'the gate answered (here: the fake gate answers nothing), the lane said nothing more');
  });

  test('an allowing gate lets the lane enqueue', async () => {
    const { ctx, spy, responses } = makeCall();
    ctx.ownerGate = async () => false;
    await enterSessionDispatch(ctx);
    assert.equal(spy.count('addItem'), 1);
    assert.equal(responses.at(-1).status, 201);
  });
});
