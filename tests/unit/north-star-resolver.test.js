/**
 * LIN-2254 — lib/north-star-resolver.js
 *
 * Run with: node --test tests/unit/north-star-resolver.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getWorkspaceNorthStar, getWorkspaceNorthStarDocVersion, getNorthStarDocVersion } from '../../lib/north-star-resolver.js';

const DOC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'north-star.md');

describe('getWorkspaceNorthStar', () => {
  test('resolves the creator-scoped, workspace-scoped stored value', async () => {
    const store = {
      getUserPreferences: async (id) =>
        id === 'creator-1' ? { northStarByWorkspace: { acme: 'Ship a self-serve onboarding flow by Q3.' } } : {}
    };
    const result = await getWorkspaceNorthStar(store, 'acme', 'creator-1');
    assert.equal(result, 'Ship a self-serve onboarding flow by Q3.');
  });

  test('is generic per-workspace, per-account free text — unrelated to docs/north-star.md', async () => {
    // Two different workspaces under the same creator can hold two
    // unrelated, independently hand-typed strings; neither has anything to
    // do with Harbour's own docs/north-star.md. LIN-2254's fix must not
    // collapse this multi-tenant behavior into always serving the doc.
    const store = {
      getUserPreferences: async () => ({
        northStarByWorkspace: { a: 'star one', b: 'star two' }
      })
    };
    assert.equal(await getWorkspaceNorthStar(store, 'a', 'c1'), 'star one');
    assert.equal(await getWorkspaceNorthStar(store, 'b', 'c1'), 'star two');
  });

  test('fails closed with no creatorId', async () => {
    const store = { getUserPreferences: async () => ({ northStarByWorkspace: { acme: 'x' } }) };
    assert.equal(await getWorkspaceNorthStar(store, 'acme', null), '');
  });

  test('fails closed with no urlKey', async () => {
    const store = { getUserPreferences: async () => ({ northStarByWorkspace: { acme: 'x' } }) };
    assert.equal(await getWorkspaceNorthStar(store, null, 'creator-1'), '');
  });

  test('returns "" when the creator has no stored preferences at all', async () => {
    const store = { getUserPreferences: async () => ({}) };
    assert.equal(await getWorkspaceNorthStar(store, 'acme', 'creator-1'), '');
  });

  test('returns "" and does not throw when the store rejects', async () => {
    const store = { getUserPreferences: async () => { throw new Error('store down'); } };
    assert.equal(await getWorkspaceNorthStar(store, 'acme', 'creator-1'), '');
  });
});

describe('getWorkspaceNorthStarDocVersion', () => {
  test('resolves the creator-scoped, workspace-scoped stored stamp', async () => {
    const stamp = { hash: 'abc123', title: 'North star — v2, the self-funding loop' };
    const store = {
      getUserPreferences: async (id) =>
        id === 'creator-1' ? { northStarDocVersionByWorkspace: { acme: stamp } } : {}
    };
    const result = await getWorkspaceNorthStarDocVersion(store, 'acme', 'creator-1');
    assert.deepEqual(result, stamp);
  });

  test('returns null when no stamp is stored for this workspace', async () => {
    const store = { getUserPreferences: async () => ({ northStarDocVersionByWorkspace: {} }) };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, 'acme', 'creator-1'), null);
  });

  test('returns null when the creator has no stored preferences at all', async () => {
    const store = { getUserPreferences: async () => ({}) };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, 'acme', 'creator-1'), null);
  });

  test('fails closed with no creatorId', async () => {
    const store = { getUserPreferences: async () => ({ northStarDocVersionByWorkspace: { acme: { hash: 'x', title: 'y' } } }) };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, 'acme', null), null);
  });

  test('fails closed with no urlKey', async () => {
    const store = { getUserPreferences: async () => ({ northStarDocVersionByWorkspace: { acme: { hash: 'x', title: 'y' } } }) };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, null, 'creator-1'), null);
  });

  test('returns null and does not throw when the store rejects', async () => {
    const store = { getUserPreferences: async () => { throw new Error('store down'); } };
    assert.equal(await getWorkspaceNorthStarDocVersion(store, 'acme', 'creator-1'), null);
  });

  test('two workspaces under the same creator hold independent stamps', async () => {
    const stampA = { hash: 'hash-a', title: 'title-a' };
    const stampB = { hash: 'hash-b', title: 'title-b' };
    const store = {
      getUserPreferences: async () => ({
        northStarDocVersionByWorkspace: { a: stampA, b: stampB }
      })
    };
    assert.deepEqual(await getWorkspaceNorthStarDocVersion(store, 'a', 'c1'), stampA);
    assert.deepEqual(await getWorkspaceNorthStarDocVersion(store, 'b', 'c1'), stampB);
  });
});

describe('getNorthStarDocVersion', () => {
  test('hashes the real docs/north-star.md content and reads its title', () => {
    const raw = readFileSync(DOC_PATH, 'utf-8');
    const expectedHash = createHash('sha256').update(raw).digest('hex');
    const { hash, title } = getNorthStarDocVersion();
    assert.equal(hash, expectedHash);
    assert.equal(title, 'North star — v2, the self-funding loop');
  });

  test('is stable across repeated calls (cached for the process)', () => {
    const first = getNorthStarDocVersion();
    const second = getNorthStarDocVersion();
    assert.equal(first.hash, second.hash);
    assert.equal(first.title, second.title);
  });

  test('returns { hash: null, title: null } without throwing when the doc cannot be read', () => {
    // Real production reads always hit the real, committed doc — this
    // exercises the fail-closed branch via the test-only docPath override,
    // since the default path always resolves at HEAD.
    const result = getNorthStarDocVersion('/nonexistent/does-not-exist-north-star.md');
    assert.deepEqual(result, { hash: null, title: null });
    // Must not have poisoned the default-path cache for subsequent callers.
    const real = getNorthStarDocVersion();
    assert.notEqual(real.hash, null);
  });

  test('pins the v2/v1 distinction: the hash does not match the superseded v1 payload', () => {
    // The old v1 six-clause payload — distinct from the v2 doc committed at
    // 619366bc. A resolver-side divergence check must be able to tell these
    // apart; this pins that the hash is content-derived, not a version label
    // a stale caller could still satisfy by accident.
    const staleV1Payload = [
      'Harbour exists to keep human intent in command of AI-accelerated execution.',
      'As agents make producing work cheap, the scarce act is no longer doing the work.',
      'Forward work builds or sharpens instruments that surface drift at every altitude.',
      'Necessary maintenance is work that keeps the workbench running.',
      'Drift is capability added without serving intent-legibility.',
      'This is a v1.'
    ].join('\n');
    const staleHash = createHash('sha256').update(staleV1Payload).digest('hex');
    const { hash } = getNorthStarDocVersion();
    assert.notEqual(hash, staleHash);
  });
});
