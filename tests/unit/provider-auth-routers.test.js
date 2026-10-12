/**
 * LIN-675: server.js (the composition root) owns provider → auth-router wiring.
 * `lib/` no longer imports `routes/`, so this helper is the one place that maps
 * a registered provider to its login-route factory.
 *
 * Run with: node --test tests/unit/provider-auth-routers.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createProviderAuthRouter } from '../../routes/provider-auth-routers.js';
import { getAllProviders, getProvider } from '../../lib/providers/index.js';

const deps = () => ({ userPreferencesStore: null });

describe('createProviderAuthRouter', () => {
  test('Linear resolves to an Express router', () => {
    const router = createProviderAuthRouter(getProvider('linear'), deps());
    assert.equal(typeof router, 'function');
    assert.equal(typeof router.get, 'function');
  });

  test('every registered provider with a login flow resolves to a router; local to null', () => {
    const names = getAllProviders().map((p) => p.name);
    assert.deepEqual([...names].sort(), ['github', 'github-projects', 'jira', 'linear', 'local']);
    for (const provider of getAllProviders()) {
      const router = createProviderAuthRouter(provider, deps());
      if (provider.name === 'local') assert.equal(router, null);
      else assert.equal(typeof router?.get, 'function', `${provider.name} must get a router`);
    }
  });

  test('a provider missing from the table throws at boot rather than shipping with no login', () => {
    assert.throws(() => createProviderAuthRouter({ name: 'fifth' }, deps()), /No auth-router wiring for provider "fifth"/);
  });

  test('inherited object keys are not treated as providers', () => {
    assert.throws(() => createProviderAuthRouter({ name: 'toString' }, deps()), /No auth-router wiring/);
  });
});
