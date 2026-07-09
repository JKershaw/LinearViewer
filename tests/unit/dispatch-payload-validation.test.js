/**
 * Unit tests for validateDispatchPayload (LIN-1139).
 *
 * The two MAIN dispatch handlers — POST /workspace/:urlKey/api/dispatch and its
 * proxy twin POST /api/proxy/dispatch — hand-rolled the identical block of
 * length caps, opaque model/harness validation, dangerous-char rejection, and
 * issueId/followUpTo/force/sessionId format+combination rules. That block is now
 * extracted verbatim into validateDispatchPayload so the two caller-supplied
 * paths can't re-drift. These tests pin the extracted contract: the exact error
 * messages and the exact FIRST error for a multiply-invalid payload (the check
 * order is load-bearing — both routers relied on it).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateDispatchPayload } from '../../lib/dispatch-validation.js';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('validateDispatchPayload — valid payloads', () => {
  test('a minimal valid payload returns null', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'do the thing' }), null);
  });

  test('an empty body is valid (prompt-required lives in the caller, not here)', () => {
    assert.strictEqual(validateDispatchPayload({}), null);
    assert.strictEqual(validateDispatchPayload(), null);
  });

  test('a fully-populated valid payload returns null', () => {
    assert.strictEqual(validateDispatchPayload({
      prompt: 'x', promptName: 'Implementation', issueIdentifier: 'LIN-1',
      issueTitle: 'Title', issueUrl: 'https://example/1', repo: 'org/repo',
      model: 'anthropic/claude-opus-4.8', harness: 'claude-code',
      issueId: UUID, followUpTo: UUID, target: 'cli', force: true, sessionId: UUID,
    }), null);
  });
});

describe('validateDispatchPayload — length caps', () => {
  test('over-length prompt', () => {
    const r = validateDispatchPayload({ prompt: 'a'.repeat(10_000_001) });
    assert.deepEqual(r, { error: 'prompt exceeds maximum length of 10000000' });
  });
  test('over-length promptName', () => {
    assert.deepEqual(validateDispatchPayload({ promptName: 'a'.repeat(1001) }),
      { error: 'promptName exceeds maximum length of 1000' });
  });
  test('over-length issueIdentifier', () => {
    assert.deepEqual(validateDispatchPayload({ issueIdentifier: 'a'.repeat(101) }),
      { error: 'issueIdentifier exceeds maximum length of 100' });
  });
  test('over-length issueTitle', () => {
    assert.deepEqual(validateDispatchPayload({ issueTitle: 'a'.repeat(1001) }),
      { error: 'issueTitle exceeds maximum length of 1000' });
  });
  test('over-length issueUrl', () => {
    assert.deepEqual(validateDispatchPayload({ issueUrl: 'a'.repeat(8001) }),
      { error: 'issueUrl exceeds maximum length of 8000' });
  });
  test('over-length repo', () => {
    assert.deepEqual(validateDispatchPayload({ repo: 'a'.repeat(1001) }),
      { error: 'repo exceeds maximum length of 1000' });
  });
});

describe('validateDispatchPayload — model/harness (opaque)', () => {
  test('non-string model rejected (the LIN-1084 stricter form)', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', model: 0 }),
      { error: 'model must be a string' });
  });
  test('non-string harness rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', harness: 42 }),
      { error: 'harness must be a string' });
  });
  test('over-length harness rejected', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', harness: 'a'.repeat(1001) }),
      { error: 'harness exceeds maximum length of 1000' });
  });
});

describe('validateDispatchPayload — dangerous chars', () => {
  test('prompt with a null byte', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'bad\x00prompt' }),
      { error: 'prompt contains invalid characters' });
  });
  test('promptName with a control char', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', promptName: 'a\x07b' }),
      { error: 'promptName contains invalid characters' });
  });
  test('issueTitle with a control char', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', issueTitle: 'a\x1Fb' }),
      { error: 'issueTitle contains invalid characters' });
  });
  test('repo with a control char', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', repo: 'a\x00b' }),
      { error: 'repo contains invalid characters' });
  });
});

describe('validateDispatchPayload — id / combination rules', () => {
  test('malformed issueId', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', issueId: 'not-a-uuid' }),
      { error: 'Invalid issueId format' });
  });
  test('malformed followUpTo', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', followUpTo: 'nope' }),
      { error: 'Invalid followUpTo format' });
  });
  test('followUpTo on a non-cli/web target', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', followUpTo: UUID, target: 'dash' }),
      { error: 'followUpTo is only supported for cli/web targets' });
  });
  test('followUpTo defaults target to cli (valid)', () => {
    assert.strictEqual(validateDispatchPayload({ prompt: 'x', followUpTo: UUID }), null);
  });
  test('non-boolean force', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', force: 'yes' }),
      { error: 'force must be a boolean' });
  });
  test('force + cascade are mutually exclusive', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', force: true, cascade: true, abort: true, abortTo: UUID }),
      { error: 'force and cascade are mutually exclusive' });
  });
  test('force requires followUpTo or abort', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', force: true }),
      { error: 'force requires followUpTo or abort' });
  });
  test('force is valid alongside abort', () => {
    assert.strictEqual(validateDispatchPayload({ force: true, abort: true, abortTo: UUID }), null);
  });
  test('malformed sessionId', () => {
    assert.deepEqual(validateDispatchPayload({ prompt: 'x', sessionId: 'nope' }),
      { error: 'Invalid sessionId format' });
  });
});

describe('validateDispatchPayload — check ORDER (first error is load-bearing)', () => {
  test('a length violation is reported before a model violation', () => {
    // prompt length is checked before model, so a payload violating both surfaces
    // the prompt error first — matching the original interleaving in both handlers.
    const r = validateDispatchPayload({ prompt: 'a'.repeat(10_000_001), model: 0 });
    assert.deepEqual(r, { error: 'prompt exceeds maximum length of 10000000' });
  });
  test('a model violation is reported before a dangerous-char prompt violation', () => {
    const r = validateDispatchPayload({ prompt: 'bad\x00', model: 0 });
    assert.deepEqual(r, { error: 'model must be a string' });
  });
});
