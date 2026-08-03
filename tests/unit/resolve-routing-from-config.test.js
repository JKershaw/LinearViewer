/**
 * Unit tests for `resolveRoutingFromConfig` (LIN-1390 S2) — the pure routing
 * resolver extracted from `resolveDispatchDefaults`. Network-free: exercises
 * the precedence logic directly against plain config objects, independent of
 * any store.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoutingFromConfig } from '../../lib/workspace-preferences.js';

describe('resolveRoutingFromConfig', () => {
  test('empty/absent config resolves both fields to null', () => {
    assert.deepEqual(resolveRoutingFromConfig(null, 'implementation'), { model: null, harness: null });
    assert.deepEqual(resolveRoutingFromConfig(undefined, 'implementation'), { model: null, harness: null });
    assert.deepEqual(resolveRoutingFromConfig({}, 'implementation'), { model: null, harness: null });
  });

  test('top-level default is used when no byKind override exists', () => {
    const resolved = resolveRoutingFromConfig({ model: 'anthropic/claude-opus-4.8', harness: 'opencode' }, 'implementation');
    assert.deepEqual(resolved, { model: 'anthropic/claude-opus-4.8', harness: 'opencode' });
  });

  test('byKind override beats the top-level default for a DISPATCH_DEFAULT_KINDS kind', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      harness: 'opencode',
      byKind: { implementation: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation'), { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' });
  });

  test('byKind is honored for autopilot (a DISPATCH_DEFAULT_KINDS member)', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      harness: 'opencode',
      byKind: { autopilot: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'autopilot'), { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' });
  });

  test('byKind is ignored for a kind NOT in DISPATCH_DEFAULT_KINDS (e.g. custom)', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      harness: 'opencode',
      byKind: { custom: { model: 'should-never-be-read', harness: 'should-never-be-read' } }
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'custom'), { model: 'anthropic/claude-opus-4.8', harness: 'opencode' });
  });

  test('byKind is ignored when kind is omitted, falling through to the top-level default', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      harness: 'opencode',
      byKind: { implementation: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
    };
    assert.deepEqual(resolveRoutingFromConfig(config), { model: 'anthropic/claude-opus-4.8', harness: 'opencode' });
  });

  // Re-titled (LIN-1694, non-blocking per plan-review): this specific case — a
  // per-kind harness override with no per-kind model — has no cross-row
  // conflict (the top-level model row carries no harness of its own to
  // disagree with), so its resolved values are unaffected by the row-atomic
  // guard below. It is no longer asserting unconditional field independence.
  test('a per-kind harness override with no per-kind model still falls through to the top-level model (no cross-row conflict)', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      // no top-level harness
      byKind: { implementation: { harness: 'claude-code' } } // no per-kind model
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation'), { model: 'anthropic/claude-opus-4.8', harness: 'claude-code' });
  });
});

// LIN-1694: the row-atomic model-eligibility guard. `harnessInForce` (optional
// 3rd arg) is the harness that will ACTUALLY run this dispatch, resolved by the
// CALLER (dispatch-factory.js's harness-first two-pass resolution) — never
// re-derived here. Each of `byKind[kind]` and the top-level `cfg` is its own
// ROW; a row's `model` is eligible only if that row's own `harness` is blank or
// equal to `harnessInForce`.
describe('resolveRoutingFromConfig — row-atomic harnessInForce guard (LIN-1694)', () => {
  test('omitted harnessInForce is byte-identical to the 2-arg behaviour — every row eligible', () => {
    const config = { byKind: { implementation: { model: 'opus', harness: 'opencode' } } };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation'), { model: 'opus', harness: 'opencode' });
  });

  test('null harnessInForce (e.g. an all-blank-harness workspace) also means every row eligible', () => {
    const config = { byKind: { implementation: { model: 'opus', harness: 'opencode' } } };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation', null), { model: 'opus', harness: 'opencode' });
  });

  // The exact reproduction of the ticket's reported live incident: the
  // `implementation` byKind row is scoped to opencode/deepseek, but an
  // explicit incoming `harness: 'claude-code'` (settled by dispatch-factory.js
  // BEFORE this call) is the harness actually in force — the row's model must
  // fall through, not cross onto claude-code.
  test('a byKind row scoped to a DIFFERENT harness than harnessInForce falls through — the model must NOT cross', () => {
    const config = {
      harness: 'claude-code',
      byKind: { implementation: { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' } }
    };
    const resolved = resolveRoutingFromConfig(config, 'implementation', 'claude-code');
    assert.equal(resolved.model, null, 'the opencode-scoped model must not pair with claude-code');
    assert.equal(resolved.harness, 'opencode', 'harness resolution itself is untouched by this guard');
  });

  test('a byKind row IS eligible when its own harness matches harnessInForce', () => {
    const config = { byKind: { implementation: { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' } } };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation', 'opencode'), { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' });
  });

  test('a byKind row with a BLANK harness stays eligible regardless of harnessInForce (blank = inherit)', () => {
    const config = { byKind: { implementation: { model: 'opus' } } };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation', 'opencode'), { model: 'opus', harness: null });
  });

  test('an ineligible byKind.model falls through to an eligible top-level cfg.model, not straight to null', () => {
    const config = {
      model: 'opus',
      harness: 'claude-code',
      byKind: { implementation: { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' } }
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation', 'claude-code'), { model: 'opus', harness: 'opencode' });
  });

  test('the top-level row is subject to the SAME guard as byKind — an explicit-harness-in-force workspace default scoped elsewhere does not cross', () => {
    const config = { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation', 'claude-code'), { model: null, harness: 'opencode' });
  });
});
