/**
 * Unit tests for the shared opaque-dispatch-field validator (LIN-1084).
 *
 * `routes/proxy.js` and `routes/dispatch.js` each hand-rolled the same
 * type/length/dangerous-chars checks for `model` and drifted: the proxy path
 * rejected a falsy non-string (`model: 0`) while the dispatch path silently
 * treated it as absent. `validateOpaqueDispatchField` is the single helper
 * both routers now share for both `model` and `harness`, matching the
 * STRICTER (proxy) form — these tests pin that behavior, including the
 * specific `0` case that used to diverge.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOpaqueDispatchField } from '../../lib/dispatch-validation.js';

test('accepts a valid opaque string', () => {
  const result = validateOpaqueDispatchField('anthropic/claude-opus-4.8', 'model');
  assert.strictEqual(result, null);
});

test('treats undefined as absent (valid)', () => {
  const result = validateOpaqueDispatchField(undefined, 'model');
  assert.strictEqual(result, null);
});

test('treats null as absent (valid)', () => {
  const result = validateOpaqueDispatchField(null, 'harness');
  assert.strictEqual(result, null);
});

test('rejects a value over maxLength', () => {
  const long = 'a'.repeat(1001);
  const result = validateOpaqueDispatchField(long, 'model');
  assert.deepEqual(result, { error: 'model exceeds maximum length of 1000' });
});

test('accepts a value at exactly maxLength', () => {
  const exact = 'a'.repeat(1000);
  const result = validateOpaqueDispatchField(exact, 'model');
  assert.strictEqual(result, null);
});

test('honors a custom maxLength option', () => {
  const result = validateOpaqueDispatchField('a'.repeat(11), 'harness', { maxLength: 10 });
  assert.deepEqual(result, { error: 'harness exceeds maximum length of 10' });
});

test('rejects a value containing dangerous control characters', () => {
  const result = validateOpaqueDispatchField('opencode\x00', 'harness');
  assert.deepEqual(result, { error: 'harness contains invalid characters' });
});

test('rejects a falsy non-string value, e.g. model: 0 (the fixed drift)', () => {
  // Previously: routes/proxy.js rejected this, routes/dispatch.js silently
  // accepted it as absent. The shared validator now matches the stricter form
  // for both fields.
  const result = validateOpaqueDispatchField(0, 'model');
  assert.deepEqual(result, { error: 'model must be a string' });
});

test('rejects a non-string, non-falsy value', () => {
  const result = validateOpaqueDispatchField({ not: 'a string' }, 'harness');
  assert.deepEqual(result, { error: 'harness must be a string' });
});

test('accepts an empty string (callers coerce it to null downstream)', () => {
  // Empty string is typeof 'string' and length 0 <= maxLength — valid at this
  // layer. Callers (the routers/store) already coerce '' to null downstream
  // via `value || null`, matching existing model/harness store behavior.
  const result = validateOpaqueDispatchField('', 'model');
  assert.strictEqual(result, null);
});

// reportReceivedLength (LIN-2075): opt-in suffix on the length-cause message,
// used by goal/repo call sites; default-off keeps the 16 existing call sites'
// messages byte-identical.

test('reportReceivedLength defaults off: length message is byte-identical to today', () => {
  const long = 'a'.repeat(1001);
  const result = validateOpaqueDispatchField(long, 'model');
  assert.deepEqual(result, { error: 'model exceeds maximum length of 1000' });
});

test('reportReceivedLength: true appends the received length on the length cause', () => {
  const long = 'a'.repeat(1247);
  const result = validateOpaqueDispatchField(long, 'goal', {
    maxLength: 1000,
    reportReceivedLength: true,
  });
  assert.deepEqual(result, { error: 'goal exceeds maximum length of 1000 (got 1247)' });
});

test('reportReceivedLength: M counts UTF-16 code units, not visible characters', () => {
  // 501 emoji is 1002 UTF-16 code units (each is a surrogate pair) — rejected
  // at 501 visible characters, and the reported M must say 1002, not 501, or
  // the number contradicts what a caller can count.
  const emojiGoal = '\u{1F680}'.repeat(501);
  assert.strictEqual(emojiGoal.length, 1002);
  const result = validateOpaqueDispatchField(emojiGoal, 'goal', {
    maxLength: 1000,
    reportReceivedLength: true,
  });
  assert.deepEqual(result, { error: 'goal exceeds maximum length of 1000 (got 1002)' });
});

test('reportReceivedLength: true does not affect the type-cause message', () => {
  const result = validateOpaqueDispatchField(0, 'goal', { reportReceivedLength: true });
  assert.deepEqual(result, { error: 'goal must be a string' });
});

test('reportReceivedLength: true does not affect the dangerous-chars message', () => {
  const result = validateOpaqueDispatchField('walk\x00the stack', 'goal', {
    reportReceivedLength: true,
  });
  assert.deepEqual(result, { error: 'goal contains invalid characters' });
});

test('reportReceivedLength: true still treats undefined/null as absent (valid)', () => {
  assert.strictEqual(
    validateOpaqueDispatchField(undefined, 'goal', { reportReceivedLength: true }),
    null
  );
  assert.strictEqual(
    validateOpaqueDispatchField(null, 'goal', { reportReceivedLength: true }),
    null
  );
});
