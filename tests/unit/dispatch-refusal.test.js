/**
 * LIN-3470 — `mapDispatchRefusal`, the one mapping from a tagged factory
 * refusal to its HTTP reply (status, message, body, `Retry-After`, log note).
 * Both entrances (routes/proxy.js, routes/dispatch.js) relay through it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mapDispatchRefusal } from '../../lib/dispatch-refusal.js';

function tagged(tag, refusal, message = 'refused') {
  const err = new Error(message);
  err[tag] = refusal;
  return err;
}

describe('mapDispatchRefusal', () => {
  test('duplicate: 409, body is the refusal, Retry-After owed, note carries the colliding id', () => {
    const refusal = { code: 'DUPLICATE_DISPATCH', id: 'd-1', retryAfter: 120 };
    assert.deepEqual(mapDispatchRefusal(tagged('duplicateDispatch', refusal, 'dup')), {
      status: 409, message: 'dup', body: refusal, retryAfter: 120, note: 'DUPLICATE_DISPATCH d-1'
    });
  });

  test('run limit reached: 429 with Retry-After; body is only code/freeTier/retryAfter; message is refusal.error', () => {
    const refusal = { error: 'Daily limit', code: 'RUN_LIMIT_REACHED', freeTier: { used: true }, retryAfter: 3600, extra: 'dropped' };
    assert.deepEqual(mapDispatchRefusal(tagged('runLimit', refusal)), {
      status: 429,
      message: 'Daily limit',
      body: { code: 'RUN_LIMIT_REACHED', freeTier: { used: true }, retryAfter: 3600 },
      retryAfter: 3600,
      note: 'RUN_LIMIT_REACHED'
    });
  });

  test('run limit unverified: 503 with NO Retry-After header', () => {
    const refusal = { error: 'Cannot verify', code: 'RUN_LIMIT_UNVERIFIED', freeTier: {}, retryAfter: 30 };
    const reply = mapDispatchRefusal(tagged('runLimit', refusal));
    assert.equal(reply.status, 503);
    assert.equal(reply.retryAfter, null);
    assert.equal(reply.body.retryAfter, 30, 'the body copy stays');
    assert.equal(reply.note, 'RUN_LIMIT_UNVERIFIED');
  });

  test('budget: 409, no Retry-After, note carries bound and session', () => {
    const refusal = { code: 'BUDGET_EXHAUSTED', count: 5, maxTasks: 5, bound: 'tasks', sessionId: 's-1' };
    assert.deepEqual(mapDispatchRefusal(tagged('budgetExhausted', refusal, 'budget')), {
      status: 409, message: 'budget', body: refusal, retryAfter: null, note: 'BUDGET_EXHAUSTED tasks s-1'
    });
  });

  test('close-out: 409, no Retry-After, note carries session', () => {
    const refusal = { code: 'CLOSE_OUT_IS_THE_PERSONS', sessionId: 's-2' };
    assert.deepEqual(mapDispatchRefusal(tagged('closeOutRefusal', refusal, 'closeout')), {
      status: 409, message: 'closeout', body: refusal, retryAfter: null, note: 'CLOSE_OUT_IS_THE_PERSONS s-2'
    });
  });

  test('TASK_SESSION_RUNAWAY: 409 under its own code, never BUDGET_EXHAUSTED', () => {
    const refusal = { code: 'TASK_SESSION_RUNAWAY', sessionId: 's-3' };
    assert.deepEqual(mapDispatchRefusal(tagged('taskSessionRunaway', refusal, 'runaway')), {
      status: 409, message: 'runaway', body: refusal, retryAfter: null, note: 'TASK_SESSION_RUNAWAY s-3'
    });
  });

  test('untagged, grant-refusal and nullish errors yield null (pass through to the caller)', () => {
    assert.equal(mapDispatchRefusal(null), null);
    assert.equal(mapDispatchRefusal(undefined), null);
    assert.equal(mapDispatchRefusal(new Error('boom')), null);
    assert.equal(mapDispatchRefusal(tagged('launchRefusal', { code: 'GRANT_OWNER_ONLY' })), null);
    assert.equal(mapDispatchRefusal(tagged('proxyAttachFailed', true)), null);
  });
});
