/**
 * LIN-3442 — the runner starts each item's broker with a minimal environment.
 * It must carry NODE_EXTRA_CA_CERTS (a file path: the cloud proxy's CA) so the
 * broker's TLS to Harbour works, and still no secrets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { brokerEnv } from '../../lib/runner-kit/runner.mjs';

const RUNNER_ENV = {
  PATH: '/usr/bin', HOME: '/home/x', NODE_EXTRA_CA_CERTS: '/etc/proxy-ca.pem',
  HARBOUR_TOKEN: 'secret-token', ANTHROPIC_API_KEY: 'sk-secret'
};

test('brokerEnv passes PATH, HOME and NODE_EXTRA_CA_CERTS only', () => {
  assert.deepEqual(brokerEnv(RUNNER_ENV), { PATH: '/usr/bin', HOME: '/home/x', NODE_EXTRA_CA_CERTS: '/etc/proxy-ca.pem' });
});

test('brokerEnv omits NODE_EXTRA_CA_CERTS when the runner has none', () => {
  const { NODE_EXTRA_CA_CERTS, ...rest } = RUNNER_ENV;
  assert.ok(!('NODE_EXTRA_CA_CERTS' in brokerEnv(rest)));
});

test('a child spawned with brokerEnv sees NODE_EXTRA_CA_CERTS and no secrets', () => {
  const out = execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { env: { ...brokerEnv(RUNNER_ENV), PATH: process.env.PATH } });
  const seen = JSON.parse(out);
  assert.equal(seen.NODE_EXTRA_CA_CERTS, '/etc/proxy-ca.pem');
  assert.ok(!JSON.stringify(seen).includes('secret'));
});

test('startItemBroker spawns with brokerEnv()', () => {
  const src = readFileSync(new URL('../../lib/runner-kit/runner.mjs', import.meta.url), 'utf8');
  assert.match(src, /env: brokerEnv\(\)/);
});
