/**
 * Unit tests for lib/dispatch-repo-guard.js (LIN-2886).
 *
 * Pins: URL/owner-name -> basename extraction, resolveKnownRepo's exact-match
 * and normalized-match cases (and its refusal when neither matches), and
 * validateDispatchRepo's fail-open behavior when the capability isn't there
 * to check with (no provider, unsupported, or a throwing fetch) versus its
 * refusal when the provider COULD answer and said "unknown".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractRepoBasename, resolveKnownRepo, validateDispatchRepo } from '../../lib/dispatch-repo-guard.js';

describe('extractRepoBasename (LIN-2886)', () => {
  test('a bare basename passes through unchanged', () => {
    assert.equal(extractRepoBasename('LinearViewer'), 'LinearViewer');
  });

  test('an https URL extracts the basename, stripping .git', () => {
    assert.equal(extractRepoBasename('https://github.com/JKershaw/LinearViewer.git'), 'LinearViewer');
    assert.equal(extractRepoBasename('https://github.com/JKershaw/LinearViewer'), 'LinearViewer');
  });

  test('an https URL with trailing slash / query / hash is stripped first', () => {
    assert.equal(extractRepoBasename('https://github.com/JKershaw/LinearViewer/'), 'LinearViewer');
    assert.equal(extractRepoBasename('https://github.com/JKershaw/LinearViewer?tab=readme'), 'LinearViewer');
    assert.equal(extractRepoBasename('https://github.com/JKershaw/LinearViewer#readme'), 'LinearViewer');
  });

  test('an SCP-like git remote extracts the basename', () => {
    assert.equal(extractRepoBasename('git@github.com:JKershaw/LinearViewer.git'), 'LinearViewer');
  });

  test('a bare owner/name form extracts the name segment', () => {
    assert.equal(extractRepoBasename('JKershaw/LinearViewer'), 'LinearViewer');
  });

  test('empty/whitespace-only/non-string input returns null', () => {
    assert.equal(extractRepoBasename(''), null);
    assert.equal(extractRepoBasename('   '), null);
    assert.equal(extractRepoBasename(null), null);
    assert.equal(extractRepoBasename(undefined), null);
    assert.equal(extractRepoBasename(42), null);
  });
});

describe('resolveKnownRepo (LIN-2886)', () => {
  const known = ['LinearViewer', 'simple-dispatcher'];

  test('an exact basename match is accepted verbatim', () => {
    assert.deepEqual(resolveKnownRepo('LinearViewer', known), { ok: true, repo: 'LinearViewer' });
  });

  test('a URL form of a known repo normalizes to the basename', () => {
    assert.deepEqual(
      resolveKnownRepo('https://github.com/JKershaw/LinearViewer.git', known),
      { ok: true, repo: 'LinearViewer' }
    );
  });

  test('an owner/name form of a known repo normalizes to the basename', () => {
    assert.deepEqual(resolveKnownRepo('JKershaw/simple-dispatcher', known), { ok: true, repo: 'simple-dispatcher' });
  });

  test('an unknown repo (in any form) is refused', () => {
    assert.deepEqual(resolveKnownRepo('some-other-repo', known), { ok: false });
    assert.deepEqual(resolveKnownRepo('https://github.com/someone/some-other-repo', known), { ok: false });
  });

  test('case-sensitive: a differently-cased basename is refused (matches simple-dispatcher\'s own case-sensitive folder match)', () => {
    assert.deepEqual(resolveKnownRepo('linearviewer', known), { ok: false });
  });
});

describe('validateDispatchRepo (LIN-2886)', () => {
  const projectsWithRepos = [{ name: 'A', content: 'repo=LinearViewer' }];

  test('no repo supplied: passes through as absent, unvalidated', async () => {
    const result = await validateDispatchRepo({ repo: null, provider: null, scope: null });
    assert.deepEqual(result, { ok: true, repo: null, validated: false });
  });

  test('fails OPEN when there is no provider at all', async () => {
    const result = await validateDispatchRepo({ repo: 'anything', provider: null, scope: null });
    assert.deepEqual(result, { ok: true, repo: 'anything', validated: false });
  });

  test('fails OPEN when the provider does not support fetchProjects', async () => {
    const provider = { supports: () => false };
    const result = await validateDispatchRepo({ repo: 'anything', provider, scope: null });
    assert.deepEqual(result, { ok: true, repo: 'anything', validated: false });
  });

  test('fails OPEN when fetchProjects throws', async () => {
    const provider = { supports: () => true, fetchProjects: async () => { throw new Error('upstream down'); } };
    const result = await validateDispatchRepo({ repo: 'anything', provider, scope: null });
    assert.deepEqual(result, { ok: true, repo: 'anything', validated: false });
  });

  test('fails OPEN when fetchProjects never settles, bounded by timeoutMs (test-injected, no dangling timer)', async () => {
    const provider = { supports: () => true, fetchProjects: () => new Promise(() => {}) };
    const start = Date.now();
    const result = await validateDispatchRepo({ repo: 'anything', provider, scope: null, timeoutMs: 20 });
    assert.deepEqual(result, { ok: true, repo: 'anything', validated: false });
    assert.ok(Date.now() - start < 1000, 'must resolve promptly once the injected short timeout fires');
  });

  test('accepts and normalizes a URL form of a known repo, marking it validated', async () => {
    const provider = { supports: () => true, fetchProjects: async () => ({ projects: projectsWithRepos }) };
    const result = await validateDispatchRepo({
      repo: 'https://github.com/JKershaw/LinearViewer.git',
      provider,
      scope: 'tok'
    });
    assert.deepEqual(result, { ok: true, repo: 'LinearViewer', validated: true });
  });

  test('refuses an unknown repo with the known-repos list, when the provider COULD answer', async () => {
    const provider = { supports: () => true, fetchProjects: async () => ({ projects: projectsWithRepos }) };
    const result = await validateDispatchRepo({ repo: 'totally-unknown', provider, scope: 'tok' });
    assert.equal(result.ok, false);
    assert.deepEqual(result.knownRepos, ['LinearViewer']);
  });

  test('passes the resolved scope/token through to fetchProjects', async () => {
    let receivedScope;
    const provider = {
      supports: () => true,
      fetchProjects: async (scope) => { receivedScope = scope; return { projects: projectsWithRepos }; }
    };
    await validateDispatchRepo({ repo: 'LinearViewer', provider, scope: 'the-scope-token' });
    assert.equal(receivedScope, 'the-scope-token');
  });
});
