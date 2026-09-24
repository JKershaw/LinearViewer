/**
 * scripts/lin3014/lib/guard.mjs (LIN-3014)
 *
 * The safety rail every LIN-3014 script runs through: never authenticate as
 * root against production (ruling `16c2be3e`: "All measurement and
 * equivalence reads run under that user, never root"), never log the
 * credential, and only accept exactly `read@linear-viewer` — or a local
 * loopback replay target, which isn't production at all.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { assertSafeConnection, isLoopbackHost, loadCredential } from '../../scripts/lin3014/lib/guard.mjs';

test('LIN-3014 guard: assertSafeConnection accepts exactly read@linear-viewer', () => {
  const status = { authInfo: { authenticatedUserRoles: [{ role: 'read', db: 'linear-viewer' }] } };
  assert.doesNotThrow(() => assertSafeConnection(status));
});

test('LIN-3014 guard: assertSafeConnection REFUSES root, even root@admin', () => {
  const status = { authInfo: { authenticatedUserRoles: [{ role: 'root', db: 'admin' }] } };
  assert.throws(() => assertSafeConnection(status), /root/i);
});

test('LIN-3014 guard: assertSafeConnection refuses read on the WRONG db', () => {
  const status = { authInfo: { authenticatedUserRoles: [{ role: 'read', db: 'admin' }] } };
  assert.throws(() => assertSafeConnection(status), /read@linear-viewer/);
});

test('LIN-3014 guard: assertSafeConnection refuses EXTRA roles beyond read@linear-viewer', () => {
  const status = { authInfo: { authenticatedUserRoles: [{ role: 'read', db: 'linear-viewer' }, { role: 'readWrite', db: 'linear-viewer' }] } };
  assert.throws(() => assertSafeConnection(status), /expected exactly read@linear-viewer/);
});

test('LIN-3014 guard: assertSafeConnection refuses no roles at all', () => {
  const status = { authInfo: { authenticatedUserRoles: [] } };
  assert.throws(() => assertSafeConnection(status));
});

test('LIN-3014 guard: assertSafeConnection allows ANY roles when isLocalReplayTarget is true', () => {
  const status = { authInfo: { authenticatedUserRoles: [{ role: 'root', db: 'admin' }] } };
  assert.doesNotThrow(() => assertSafeConnection(status, { isLocalReplayTarget: true }));
});

test('LIN-3014 guard: isLoopbackHost recognizes localhost/127.0.0.1/::1, rejects a real host', () => {
  assert.strictEqual(isLoopbackHost('127.0.0.1'), true);
  assert.strictEqual(isLoopbackHost('localhost'), true);
  assert.strictEqual(isLoopbackHost('::1'), true);
  assert.strictEqual(isLoopbackHost('monorail.proxy.rlwy.net'), false);
  assert.strictEqual(isLoopbackHost(''), false);
  assert.strictEqual(isLoopbackHost(undefined), false);
});

test('LIN-3014 guard: loadCredential reads straight from the value env var when set', () => {
  const password = loadCredential({ env: { LIN3014_MONGO_PASSWORD: '  secret-value  ' } });
  assert.strictEqual(password, 'secret-value');
});

test('LIN-3014 guard: loadCredential reads a chmod-600 file when no value env var is set', () => {
  const password = loadCredential({
    env: {},
    exists: () => true,
    stat: () => ({ mode: 0o100600 }),
    readFile: () => 'from-file-secret\n'
  });
  assert.strictEqual(password, 'from-file-secret');
});

test('LIN-3014 guard: loadCredential REFUSES a password file with group/other permission bits set', () => {
  assert.throws(
    () => loadCredential({ env: {}, exists: () => true, stat: () => ({ mode: 0o100644 }), readFile: () => 'x' }),
    /mode 644/
  );
});

test('LIN-3014 guard: loadCredential throws a clear error when nothing is configured', () => {
  assert.throws(
    () => loadCredential({ env: {}, exists: () => false }),
    /no LIN-3014 Mongo credential found/
  );
});
