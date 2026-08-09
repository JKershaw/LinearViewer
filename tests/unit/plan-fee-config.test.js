import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPlanFeeConfig } from '../../lib/plan-fee-config.js';

const ENV_KEY = 'PLAN_FEE_MONTHLY_USD';

describe('getPlanFeeConfig', () => {
  let saved;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = saved;
  });

  test('unset env: monthlyUsd is null (never invented)', () => {
    assert.deepEqual(getPlanFeeConfig(), { monthlyUsd: null });
  });

  test('empty-string env: treated the same as unset', () => {
    process.env[ENV_KEY] = '';
    assert.deepEqual(getPlanFeeConfig(), { monthlyUsd: null });
  });

  test('valid numeric env: parsed to a number', () => {
    process.env[ENV_KEY] = '1500';
    assert.deepEqual(getPlanFeeConfig(), { monthlyUsd: 1500 });
  });

  test('valid decimal env: parsed to a number', () => {
    process.env[ENV_KEY] = '199.99';
    assert.deepEqual(getPlanFeeConfig(), { monthlyUsd: 199.99 });
  });

  test('non-numeric env: fails closed to null rather than NaN', () => {
    process.env[ENV_KEY] = 'not-a-number';
    assert.deepEqual(getPlanFeeConfig(), { monthlyUsd: null });
  });

  test('read fresh per call: a later env change is observed without re-import', () => {
    assert.deepEqual(getPlanFeeConfig(), { monthlyUsd: null });
    process.env[ENV_KEY] = '42';
    assert.deepEqual(getPlanFeeConfig(), { monthlyUsd: 42 });
  });
});
