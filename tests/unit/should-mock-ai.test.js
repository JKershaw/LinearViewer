import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { shouldMockAi } from '../../lib/should-mock-ai.js';

const ORIGINAL_ENV = process.env.NODE_ENV;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV;
});

describe('shouldMockAi', () => {
  test('true under NODE_ENV=test for the test-token workspace', () => {
    process.env.NODE_ENV = 'test';
    assert.strictEqual(shouldMockAi({ accessToken: 'test-token' }), true);
  });

  test('true under NODE_ENV=test for a local-provider workspace', () => {
    process.env.NODE_ENV = 'test';
    assert.strictEqual(shouldMockAi({ provider: 'local', accessToken: 'ws-token' }), true);
  });

  test('false under NODE_ENV=test for any other workspace (unconfigured sessions must still 503)', () => {
    process.env.NODE_ENV = 'test';
    assert.strictEqual(shouldMockAi({ accessToken: 'ws-token', provider: 'linear' }), false);
    assert.strictEqual(shouldMockAi({ urlKey: 'acme' }), false);
  });

  test('false for a missing workspace', () => {
    process.env.NODE_ENV = 'test';
    assert.strictEqual(shouldMockAi(undefined), false);
    assert.strictEqual(shouldMockAi(null), false);
  });

  test('false outside NODE_ENV=test, even for test-token / local workspaces', () => {
    process.env.NODE_ENV = 'production';
    assert.strictEqual(shouldMockAi({ accessToken: 'test-token' }), false);
    assert.strictEqual(shouldMockAi({ provider: 'local' }), false);
    delete process.env.NODE_ENV;
    assert.strictEqual(shouldMockAi({ provider: 'local' }), false);
  });
});
