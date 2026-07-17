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
