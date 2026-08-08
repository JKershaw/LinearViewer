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

  test('fields resolve independently across byKind and top-level levels', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      // no top-level harness
      byKind: { implementation: { harness: 'claude-code' } } // no per-kind model
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation'), { model: 'anthropic/claude-opus-4.8', harness: 'claude-code' });
  });
});

// LIN-1694 — row-atomic model eligibility. The bug: `model` and `harness` resolved as two fully
// independent chains, so an explicit `harness` could pair with a `model` configured on a row scoped
// to a DIFFERENT harness. `harnessInForce` is how the caller (dispatch-factory) tells this resolver
// which engine actually won, so a row scoped elsewhere is skipped instead of donating its model.
describe('resolveRoutingFromConfig — row-atomic model eligibility (LIN-1694)', () => {
  const workspaceConfig = {
    byKind: { implementation: { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' } }
  };

  test('omitting harnessInForce keeps the pre-LIN-1694 behavior exactly', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation'),
      { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' }
    );
  });

  test('THE BUG: an opencode-scoped row does not donate its model when claude-code is in force', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation', { harnessInForce: 'claude-code' }),
      { model: null, harness: 'opencode' },
      'the row still reports its own harness; it just may not lend its model to another engine'
    );
  });

  test('a row scoped to the harness in force donates normally', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation', { harnessInForce: 'opencode' }),
      { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' }
    );
  });

  test('a blank-harness row is unscoped and donates to any harness (blank = inherit)', () => {
    const config = { byKind: { implementation: { model: 'anthropic/claude-sonnet-5' } } };
    assert.equal(resolveRoutingFromConfig(config, 'implementation', { harnessInForce: 'claude-code' }).model, 'anthropic/claude-sonnet-5');
    assert.equal(resolveRoutingFromConfig(config, 'implementation', { harnessInForce: 'opencode' }).model, 'anthropic/claude-sonnet-5');
  });

  test('an ineligible per-kind row is SKIPPED — the workspace-wide row still answers', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8', // unscoped workspace-wide row
      byKind: { implementation: { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' } }
    };
    assert.deepEqual(
      resolveRoutingFromConfig(config, 'implementation', { harnessInForce: 'claude-code' }),
      { model: 'anthropic/claude-opus-4.8', harness: 'opencode' }
    );
  });

  test('the reverse cross is blocked too — a claude-code row does not donate to opencode', () => {
    const config = { byKind: { implementation: { model: 'opus', harness: 'claude-code' } } };
    assert.equal(resolveRoutingFromConfig(config, 'implementation', { harnessInForce: 'opencode' }).model, null);
  });

  test('a null harnessInForce disables the check — the row is then the harness source itself', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation', { harnessInForce: null }),
      { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' }
    );
  });
});
