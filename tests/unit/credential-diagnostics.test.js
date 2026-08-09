import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  fingerprintCredential,
  describeCredentialShape,
  detectShapeMismatch,
  describeExpiry,
  describeCredentialResolution,
  SENTINEL_EXPIRY_FLOOR_MS,
  CREDENTIAL_SOURCES,
} from '../../lib/credential-diagnostics.js';

// The diagnostics that make a credential-rejection 401 readable. Written
// against the 2026-08-09 incident, where a sustained wall of Linear 401s could
// not be attributed to a credential because nothing in the logs identified one.
// Write-up: docs/incidents/2026-08-09-proxy-401-flood.md

describe('fingerprintCredential', () => {
  test('is stable and matches a truncated sha256 (correlatable across replicas)', () => {
    const expected = createHash('sha256').update('lin_oauth_abc').digest('hex').slice(0, 12);
    assert.equal(fingerprintCredential('lin_oauth_abc'), expected);
    assert.equal(fingerprintCredential('lin_oauth_abc'), fingerprintCredential('lin_oauth_abc'));
  });

  test('distinguishes two different credentials', () => {
    // The incident's core question: same workspace, same endpoint, one caller
    // 200s and another 401s. Only distinct fingerprints can answer it.
    assert.notEqual(fingerprintCredential('token-a'), fingerprintCredential('token-b'));
  });

  test('NEVER emits the secret itself', () => {
    const secret = 'lin_api_super_secret_value';
    const fp = fingerprintCredential(secret);
    assert.ok(!fp.includes(secret));
    assert.ok(!secret.includes(fp));
    assert.match(fp, /^[0-9a-f]{12}$/);
  });

  test('unwraps every structured call scope to the same identity as its bare token', () => {
    // getWorkspaceCallScope wraps the same secret differently per provider; the
    // fingerprint must not change just because the wrapper did.
    const bare = fingerprintCredential('tok');
    assert.equal(fingerprintCredential({ token: 'tok', repo: 'o/r' }), bare);
    assert.equal(fingerprintCredential({ token: 'tok', scope: 'board' }), bare);
    assert.equal(fingerprintCredential({ email: 'a@b.c', apiToken: 'tok', site: 's' }), bare);
    assert.equal(fingerprintCredential({ authType: 'oauth', accessToken: 'tok', cloudId: 'c' }), bare);
  });

  test('returns null rather than digesting a non-string (no collision to one digest)', () => {
    // Coercing would fingerprint every distinct object credential to the
    // identical '[object Object]' digest, silently defeating the module.
    assert.equal(fingerprintCredential(null), null);
    assert.equal(fingerprintCredential(undefined), null);
    assert.equal(fingerprintCredential(''), null);
    assert.equal(fingerprintCredential({}), null);
    assert.equal(fingerprintCredential({ token: 12345 }), null);
  });
});

describe('describeCredentialShape', () => {
  test('names each provider call scope', () => {
    assert.equal(describeCredentialShape('tok'), 'bare-token');
    assert.equal(describeCredentialShape({ token: 't', repo: 'o/r' }), 'github');
    assert.equal(describeCredentialShape({ token: 't', scope: 'b' }), 'github-projects');
    assert.equal(describeCredentialShape({ email: 'e', apiToken: 't', site: 's' }), 'jira-basic');
    assert.equal(describeCredentialShape({ authType: 'oauth', accessToken: 't', cloudId: 'c' }), 'jira-oauth');
  });

  test('names the ambiguous-binding refusal and absence distinctly', () => {
    assert.equal(describeCredentialShape({ ambiguousCallScope: true }), 'ambiguous');
    assert.equal(describeCredentialShape(null), 'absent');
    assert.equal(describeCredentialShape(undefined), 'absent');
  });
});

describe('detectShapeMismatch', () => {
  test('a Jira credential on a Linear call is flagged — the cross-provider leak', () => {
    // linkProvider mirrors a newly-linked provider's token onto the workspace
    // scalar whenever `workspace.provider` is unset (the legacy Linear state).
    // This is the boolean that names that on sight.
    assert.equal(detectShapeMismatch('linear', { email: 'e', apiToken: 't', site: 's' }), true);
    assert.equal(detectShapeMismatch('linear', { token: 't', repo: 'o/r' }), true);
  });

  test('matching shapes are not flagged', () => {
    assert.equal(detectShapeMismatch('linear', 'tok'), false);
    assert.equal(detectShapeMismatch('local', 'tok'), false);
    assert.equal(detectShapeMismatch('github', { token: 't', repo: 'o/r' }), false);
    assert.equal(detectShapeMismatch('github-projects', { token: 't', scope: 'b' }), false);
  });

  test('an absent provider defaults to linear, matching normalizeProviderName', () => {
    assert.equal(detectShapeMismatch(undefined, 'tok'), false);
    assert.equal(detectShapeMismatch(undefined, { email: 'e', apiToken: 't', site: 's' }), true);
  });

  test('Jira accepts EITHER of its two auth shapes', () => {
    assert.equal(detectShapeMismatch('jira', { email: 'e', apiToken: 't', site: 's' }), false);
    assert.equal(detectShapeMismatch('jira', { authType: 'oauth', accessToken: 't', cloudId: 'c' }), false);
    assert.equal(detectShapeMismatch('jira', 'bare'), true);
  });

  test('yields null rather than a false positive when there is nothing to compare', () => {
    assert.equal(detectShapeMismatch('some-future-provider', 'tok'), null);
    assert.equal(detectShapeMismatch('linear', null), null);
  });
});

describe('describeExpiry', () => {
  const now = Date.UTC(2026, 7, 9, 9, 26, 0);

  test('reports a finite expiry with remaining time', () => {
    const result = describeExpiry(now + 3600_000, now);
    assert.equal(result.expiryKind, 'finite');
    assert.equal(result.msUntilExpiry, 3600_000);
    assert.equal(result.expiresAt, new Date(now + 3600_000).toISOString());
  });

  test('a negative remaining time is reported, not hidden', () => {
    // "The server was serving an already-expired credential" must stay visible.
    assert.equal(describeExpiry(now - 5000, now).msUntilExpiry, -5000);
  });

  test('MAX_SAFE_INTEGER is classified as the never-expires sentinel', () => {
    // Load-bearing: selection is by MAXIMUM tokenExpiresAt, so a sentinel wins
    // selection permanently and is never eligible for refresh-on-resolve.
    const result = describeExpiry(Number.MAX_SAFE_INTEGER, now);
    assert.equal(result.expiryKind, 'sentinel');
    assert.equal(result.msUntilExpiry, null);
    assert.ok(Number.MAX_SAFE_INTEGER > SENTINEL_EXPIRY_FLOOR_MS);
  });

  test('a real OAuth expiry is never mistaken for the sentinel', () => {
    // A 24h Linear token and a 1h Jira token must both read `finite`.
    assert.equal(describeExpiry(now + 24 * 3600_000, now).expiryKind, 'finite');
    assert.equal(describeExpiry(now + 3600_000, now).expiryKind, 'finite');
  });

  test('absent/unusable expiries are classified rather than crashing', () => {
    assert.equal(describeExpiry(undefined, now).expiryKind, 'absent');
    assert.equal(describeExpiry(null, now).expiryKind, 'absent');
    assert.equal(describeExpiry(NaN, now).expiryKind, 'absent');
    assert.equal(describeExpiry(Infinity, now).expiryKind, 'absent');
  });
});

describe('describeCredentialResolution', () => {
  const now = Date.UTC(2026, 7, 9, 9, 26, 0);

  test('describes a healthy Linear resolution', () => {
    const d = describeCredentialResolution({
      urlKey: 'acme',
      ownerAccountId: 'acct-1',
      provider: 'linear',
      credential: 'lin_tok',
      source: CREDENTIAL_SOURCES.SESSION_SCAN,
      expiresAt: now + 3600_000,
    }, now);

    assert.equal(d.urlKey, 'acme');
    assert.equal(d.ownerAccountId, 'acct-1');
    assert.equal(d.provider, 'linear');
    assert.equal(d.credentialSource, 'session-scan');
    assert.equal(d.credentialShape, 'bare-token');
    assert.equal(d.shapeMismatch, false);
    assert.equal(d.expiryKind, 'finite');
    assert.equal(d.credentialFingerprint, fingerprintCredential('lin_tok'));
  });

  test('carries NO token bytes anywhere in the serialized output', () => {
    // The privacy contract, asserted over the whole payload rather than field
    // by field, so a field added later cannot quietly leak.
    const secret = 'lin_api_do_not_log_me';
    const serialized = JSON.stringify(describeCredentialResolution({
      urlKey: 'acme',
      ownerAccountId: 'acct-1',
      provider: 'jira',
      credential: { email: 'a@b.c', apiToken: secret, site: 'https://x.atlassian.net' },
      source: CREDENTIAL_SOURCES.CACHE,
      expiresAt: Number.MAX_SAFE_INTEGER,
    }, now));

    assert.ok(!serialized.includes(secret));
    assert.ok(!serialized.includes('do_not_log_me'));
  });

  test('renders a null owner explicitly — an ownerless token is its own diagnosis', () => {
    const d = describeCredentialResolution({ urlKey: 'acme', ownerAccountId: null, provider: 'linear', credential: 'tok' }, now);
    assert.equal(d.ownerAccountId, '<null>');
  });

  test('distinguishes an UNSET provider from an explicitly-linear one', () => {
    // Only the unset (legacy) case is exposed to linkProvider's scalar-mirror
    // clobber, so the two must not render identically.
    const unset = describeCredentialResolution({ urlKey: 'acme', provider: undefined, credential: 'tok' }, now);
    const explicit = describeCredentialResolution({ urlKey: 'acme', provider: 'linear', credential: 'tok' }, now);
    assert.equal(unset.provider, '<unset:defaults-to-linear>');
    assert.equal(explicit.provider, 'linear');
    assert.notEqual(unset.provider, explicit.provider);
  });

  test('an unknown source is reported honestly rather than guessed', () => {
    const d = describeCredentialResolution({ urlKey: 'acme', provider: 'linear', credential: 'tok' }, now);
    assert.equal(d.credentialSource, 'unknown');
  });

  test('surfaces the exact signature the incident could not see', () => {
    // A sentinel-expiry, cross-provider credential served from cache on a
    // workspace whose provider is unset: permanently wins selection, never
    // refreshes, and authenticates a Linear call with a Jira secret.
    const d = describeCredentialResolution({
      urlKey: 'acme',
      ownerAccountId: 'acct-1',
      provider: undefined,
      credential: { email: 'a@b.c', apiToken: 'jira_tok', site: 'https://x.atlassian.net' },
      source: CREDENTIAL_SOURCES.CACHE,
      expiresAt: Number.MAX_SAFE_INTEGER,
    }, now);

    assert.equal(d.shapeMismatch, true);
    assert.equal(d.expiryKind, 'sentinel');
    assert.equal(d.credentialShape, 'jira-basic');
    assert.equal(d.provider, '<unset:defaults-to-linear>');
  });

  test('tolerates being called with nothing', () => {
    const d = describeCredentialResolution();
    assert.equal(d.urlKey, null);
    assert.equal(d.credentialFingerprint, null);
    assert.equal(d.credentialShape, 'absent');
    assert.equal(d.expiryKind, 'absent');
  });
});
