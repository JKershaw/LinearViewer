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
