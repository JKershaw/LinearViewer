/**
 * LIN-4201 scope item 3: one token-field list and one lane set for a usage reading and a request record.
 * The runner kit ships as a standalone copy (lib/runner-kit/runner.mjs), so its list is pinned equal here instead
 * of imported.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { USAGE_TOKEN_FIELDS, USAGE_LANES } from '../../lib/request-usage-vocabulary.js';
import { TRANSCRIPT_TOKEN_FIELDS } from '../../lib/runner-kit/runner.mjs';

const read = (rel) => readFile(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('the shared usage vocabulary (LIN-4201 scope item 3)', () => {
  test('the five token counters, in the order the snapshot and the record both carry them', () => {
    assert.deepEqual([...USAGE_TOKEN_FIELDS], [
      'inputTokens', 'outputTokens', 'cacheCreationInputTokens', 'cacheCreation1hInputTokens', 'cacheReadInputTokens',
    ]);
  });

  test('the runner kit\'s copy equals the shared list', () => {
    assert.deepEqual([...TRANSCRIPT_TOKEN_FIELDS], [...USAGE_TOKEN_FIELDS]);
  });

  test('the lane set is the closed snapshot set: subscription, api, openrouter', () => {
    assert.deepEqual([...USAGE_LANES], ['subscription', 'api', 'openrouter']);
  });

  test('the readers name the shared constants instead of restating the lists', async () => {
    const rowUsage = await read('lib/row-usage.js');
    const telemetry = await read('lib/session-telemetry.js');
    assert.match(rowUsage, /from '\.\/request-usage-vocabulary\.js'/);
    assert.match(telemetry, /from '\.\/request-usage-vocabulary\.js'/);
    assert.doesNotMatch(rowUsage, /'cacheCreation1hInputTokens'/, 'row-usage restates no field list');
    assert.doesNotMatch(telemetry, /'cacheCreation1hInputTokens'/, 'session-telemetry restates no field list');
    assert.doesNotMatch(telemetry, /const USAGE_LANES = \[/, 'session-telemetry restates no lane set');
  });
});
