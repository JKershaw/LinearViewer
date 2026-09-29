/**
 * LIN-3124 PR3 — T17: the `scope ?? token` invariant over every arm output and
 * at all 6 substitution/fingerprint sites, plus routes/proxy.js.
 *
 * The arm never returns a `scope` that could leak `connectionId` or a non-token
 * value into the credential substitution; the 6 sites and routes/proxy.js are
 * unchanged. Dark: arm outputs come from the pure builder.
 *
 * Run: node --test tests/unit/lin-3124-pr3-t17.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { connectionResolveResult } from '../../lib/connection-access.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, '../..', rel), 'utf8');
const SERVER = read('server.js');
const PROXY = read('routes/proxy.js');
const SUSPECT = read('lib/suspect-credential-refresh.js');

const FUTURE = Date.now() + 3_600_000;
const conn = (provider, unitId, credentials) => ({ _id: `acct::${provider}::${unitId}`, accountId: 'acct', provider, unitId, credentials, referents: [] });

function assertScopeInvariant(result, connectionId) {
  const { token, scope } = result;
  assert.ok(
    scope === undefined
      || (typeof scope === 'string' && scope === token)
      || (scope && typeof scope === 'object'),
    'scope must be undefined, a string equal to token, or an object'
  );
  assert.ok(!JSON.stringify(result).includes(connectionId), 'arm output must not carry the connectionId');
  if (scope && typeof scope === 'object') {
    assert.ok(!('connectionId' in scope), 'scope object must not carry connectionId');
    assert.ok(!Object.values(scope).includes(connectionId), 'scope values must not be the connectionId');
  }
  // The substitution itself: `scope ?? token` must yield a credential-shaped value.
  const substituted = scope ?? token;
  assert.ok(typeof substituted === 'string' || (substituted && typeof substituted === 'object'));
}

describe('LIN-3124 PR3 T17 — arm-output scope invariant', () => {
  for (const c of [
    conn('linear', 'org-1', { token: 'tok-l', tokenExpiresAt: FUTURE }),
    conn('github', 'o/r', { token: 'tok-g', installationId: '4242', tokenExpiresAt: FUTURE }),
    conn('github-projects', 'board', { token: 'tok-gp', installationId: '4243', tokenExpiresAt: FUTURE }),
    conn('jira', 'https://s', { token: 'tok-j', authType: 'oauth', cloudId: 'c1', tokenExpiresAt: FUTURE }),
  ]) {
    test(`${c.provider} arm output satisfies the invariant`, () => {
      assertScopeInvariant(connectionResolveResult(c, { source: 'connection', fingerprintCredential }), c._id);
    });
  }
});

describe('LIN-3124 PR3 T17 — the 6 sites + routes/proxy.js unchanged', () => {
  test('routes/proxy.js keeps `scope ?? token` at both substitution sites', () => {
    assert.match(PROXY, /token \? \(scope \?\? token\) : null/);
    assert.match(PROXY, /token \? \(scope \?\? token\) : token/);
    assert.doesNotMatch(PROXY, /connectionId/);
  });

  test('server.js fingerprints via `scope ?? token` at all three sites', () => {
    const matches = SERVER.match(/fingerprintCredential\([a-zA-Z]+\.scope \?\? [a-zA-Z]+\.token\)/g) || [];
    assert.equal(matches.length, 3, `expected 3 scope ?? token fingerprint sites, found ${matches.length}`);
    assert.doesNotMatch(SERVER.slice(SERVER.indexOf('async function resolveWorkspaceAccess'), SERVER.indexOf('\n}\n', SERVER.indexOf('async function resolveWorkspaceAccess'))), /connectionId \?\?/);
  });

  test('suspect-credential-refresh fingerprints via `refreshed.scope ?? refreshed.token`', () => {
    assert.match(SUSPECT, /fingerprintCredential\(refreshed\.scope \?\? refreshed\.token\)/);
  });

  test('no substitution site reads a `connectionId` as a credential', () => {
    for (const [name, src] of [['server.js', SERVER], ['routes/proxy.js', PROXY], ['suspect', SUSPECT]]) {
      assert.doesNotMatch(src, /scope \?\? [a-zA-Z]+\.connectionId/, `${name} must not substitute connectionId`);
    }
  });
});