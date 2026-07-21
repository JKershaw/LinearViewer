/**
 * LIN-417 — structured error envelope for proxy workspace-resolution failures.
 *
 * Two layers are pinned here:
 *
 *  1. The pure reason→envelope mapping in lib/errors.js
 *     (`workspaceUnavailableEnvelope`): each `reason` produces a stable
 *     code/category/retryable, and `context` carries ONLY the public workspace
 *     slug — never tokens/secrets/content (the kpi-stats privacy discipline).
 *
 *  2. The reason threading in routes/proxy.js: the recovered `reason` must reach
 *     the envelope from every endpoint that resolves workspace access. Since
 *     LIN-308 (reads) and LIN-309 (writes + compute) re-pointed the whole
 *     surface onto the provider, all endpoints now share the single
 *     `resolveWorkspaceAccess` → `workspaceUnavailable` path; a write (POST
 *     /issues, Shape A) and a compute endpoint (/stack, Shape B) are exercised
 *     here as representatives. A forced-reason stub of `resolveWorkspaceAccess`
 *     drives each and the test asserts the 503 body is the structured envelope.
 *     The HTTP status stays 503 in every case; only the body gains structure.
 *
 * The e2e suite can't cover this: in test mode `resolveWorkspaceAccess`
 * short-circuits `test-workspace`→`test-token` (reason `ok`), so the null /
 * failure path never runs end-to-end.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { workspaceUnavailableEnvelope } from '../../lib/errors.js';

// ---------------------------------------------------------------------------
// 1. Pure envelope mapping (lib/errors.js)
// ---------------------------------------------------------------------------

test('workspaceUnavailableEnvelope: store_unreachable → upstream / retryable', () => {
  const env = workspaceUnavailableEnvelope('store_unreachable', 'acme');
  assert.equal(env.error, 'Workspace not available');
  assert.equal(env.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(env.category, 'upstream');
  assert.equal(env.retryable, true);
  assert.match(env.detail, /deploy|booting|unreachable/i);
  assert.deepEqual(env.context, { workspaceUrlKey: 'acme' });
});

test('workspaceUnavailableEnvelope: session_expired → auth / not retryable', () => {
  const env = workspaceUnavailableEnvelope('session_expired', 'acme');
  assert.equal(env.code, 'WORKSPACE_SESSION_EXPIRED');
  assert.equal(env.category, 'auth');
  assert.equal(env.retryable, false);
});

test('workspaceUnavailableEnvelope: not_connected → config / not retryable', () => {
  const env = workspaceUnavailableEnvelope('not_connected', 'acme');
  assert.equal(env.code, 'WORKSPACE_NOT_CONNECTED');
  assert.equal(env.category, 'config');
  assert.equal(env.retryable, false);
});

test('workspaceUnavailableEnvelope: owner_mismatch → config / not retryable (LIN-1413)', () => {
  const env = workspaceUnavailableEnvelope('owner_mismatch', 'acme');
  assert.equal(env.code, 'WORKSPACE_OWNER_MISMATCH');
  assert.equal(env.category, 'config');
  assert.equal(env.retryable, false);
  assert.deepEqual(env.context, { workspaceUrlKey: 'acme' });
});

test('workspaceUnavailableEnvelope: owner_signed_out → auth / not retryable, names the real remedy (LIN-1506)', () => {
  const env = workspaceUnavailableEnvelope('owner_signed_out', 'acme');
  assert.equal(env.code, 'WORKSPACE_OWNER_SIGNED_OUT');
  // Q2: category is 'auth' (not 'config', unlike owner_mismatch) — re-authenticating
  // is genuinely the fix when the owner is simply signed out.
  assert.equal(env.category, 'auth');
  assert.equal(env.retryable, false);
  // The honest remedy: sign in again, or issue a fresh token. Deliberately does NOT
  // avoid the word "token" — see the retargeted privacy regex below (Q4).
  assert.match(env.detail, /sign in|token/i);
  assert.deepEqual(env.context, { workspaceUrlKey: 'acme' });
});

// Review finding (LIN-1413): the detector this reason is built on cannot tell
// a genuine account fork apart from a legitimate colleague whose own session
// merely lapsed (see Block C7, linear-token-isolation.test.js). A confident
// "will not restore it" is provably false for that reachable second case, so
// the copy must stay hedged ("may not") rather than asserting certainty.
test('workspaceUnavailableEnvelope: owner_mismatch copy is hedged, not a false certainty (LIN-1413 review)', () => {
  const env = workspaceUnavailableEnvelope('owner_mismatch', 'acme');
  assert.match(env.detail, /may not/i);
  assert.ok(!/will not/i.test(env.detail), `detail overclaims certainty: ${env.detail}`);
});

// Retargeted per LIN-1506 (Q4). The OLD regex here (/token|secret|accessToken|
// apiKey|bearer/i) matched the bare English WORD "token" in prose, not just a
// leaked value — and owner_signed_out's honest remedy copy legitimately
// contains it ("issue a fresh token"). Rewording that copy to dodge the
// heuristic would degrade required copy to satisfy a test, which inverts this
// ticket's priorities. So this targets what the privacy boundary actually
// names (workspaceUnavailableEnvelope's doc comment above: "never accessToken /
// openRouterApiKey / proxy-token bytes / workspace content") — field NAMES and
// VALUE SHAPES, not vocabulary:
//   - sensitive field names, as serialized JSON keys (a real leak would put the
//     value under one of these keys, not loose in prose)
//   - opaque credential-shaped values: a contiguous 24+ char run of token/base64
//     alphabet that also contains a digit — the actual "bytes" the boundary
//     forbids, which no hand-written prose sentence produces. The digit
//     requirement is deliberate, not incidental: our OWN envelope `code`s are
//     24-27 char SCREAMING_SNAKE_CASE runs with no digit (WORKSPACE_OWNER_
//     MISMATCH is exactly 24 chars) and must never be flagged as a leak — see
//     the "clean envelope" sanity check below.
// Must strictly strengthen: the existing store_unreachable assertion stays.
const SENSITIVE_FIELD_NAME_LEAK = /"(accessToken|refreshToken|apiKey|openRouterApiKey|proxyToken|secret|clientSecret)"\s*:/i;
const OPAQUE_RUN = /\b[A-Za-z0-9_-]{24,}\b/g;

function opaqueCredentialShapedValues(blob) {
  return (blob.match(OPAQUE_RUN) || []).filter(run => /\d/.test(run));
}

function assertNoPrivacyLeak(env) {
  const blob = JSON.stringify(env);
  assert.ok(!SENSITIVE_FIELD_NAME_LEAK.test(blob), `leaked a sensitive field name: ${blob}`);
  const leaks = opaqueCredentialShapedValues(blob);
  assert.equal(leaks.length, 0, `leaked an opaque credential-shaped value: ${JSON.stringify(leaks)}`);
}

test('envelope context carries only the public workspace slug (privacy boundary)', () => {
  const env = workspaceUnavailableEnvelope('store_unreachable', 'acme');
  assert.deepEqual(Object.keys(env.context), ['workspaceUrlKey']);
  assertNoPrivacyLeak(env);
});

// The whole point of the Q4 retarget: owner_signed_out's honest copy contains
// the bare word "token" and must NOT be flagged as a leak by the tightened check.
test('envelope for owner_signed_out is not flagged despite containing the required word "token" in its remedy copy', () => {
  const env = workspaceUnavailableEnvelope('owner_signed_out', 'acme');
  assert.match(env.detail, /token/i, 'sanity: the required word is actually present');
  assertNoPrivacyLeak(env);
});

// Demonstration, not just assertion, that the retargeted regex still catches a
// genuine leak — constructed against fabricated envelopes shaped like real ones.
test('the retargeted privacy regex still catches a genuine leak (demonstration)', () => {
  const leakedByFieldName = {
    error: 'Workspace not available',
    code: 'WORKSPACE_UNAVAILABLE',
    category: 'internal',
    retryable: false,
    detail: 'ok',
    context: { workspaceUrlKey: 'acme', accessToken: 'whatever-the-value-is' }
  };
  assert.ok(
    SENSITIVE_FIELD_NAME_LEAK.test(JSON.stringify(leakedByFieldName)),
    'regex failed to catch a leaked accessToken field name'
  );

  const leakedByValueShape = {
    error: 'Workspace not available',
    code: 'WORKSPACE_OWNER_MISMATCH',
    category: 'config',
    retryable: false,
    // An opaque account-id-shaped value leaked into prose, no sensitive key name involved.
    detail: 'A different account (acct_9f8e7d6c5b4a3928374652819abc) is live for this workspace.',
    context: { workspaceUrlKey: 'acme' }
  };
  assert.ok(
    opaqueCredentialShapedValues(JSON.stringify(leakedByValueShape)).length > 0,
    'value-shape check failed to catch an opaque credential/account-id-shaped value leaked into detail prose'
  );

  // Sanity: an ordinary, non-leaking envelope must NOT trip either check —
  // otherwise the "still catches a leak" demonstration above would be vacuous.
  // This is also where the digit requirement earns its keep: owner_mismatch's
  // own `code` (WORKSPACE_OWNER_MISMATCH, 24 chars, no digit) would have
  // false-tripped a pure length-only check.
  for (const reason of ['store_unreachable', 'session_expired', 'not_connected', 'owner_mismatch', 'owner_signed_out']) {
    const clean = workspaceUnavailableEnvelope(reason, 'acme');
    const blob = JSON.stringify(clean);
    assert.ok(!SENSITIVE_FIELD_NAME_LEAK.test(blob), `false positive (field name) on ${reason}: ${blob}`);
    assert.deepEqual(opaqueCredentialShapedValues(blob), [], `false positive (value shape) on ${reason}: ${blob}`);
  }
});

test('unknown reason falls back to a safe, non-retryable internal envelope', () => {
  const env = workspaceUnavailableEnvelope('ok', 'acme');
  assert.equal(env.code, 'WORKSPACE_UNAVAILABLE');
  assert.equal(env.category, 'internal');
  assert.equal(env.retryable, false);
  assert.deepEqual(env.context, { workspaceUrlKey: 'acme' });
});

// ---------------------------------------------------------------------------
// 2. Dual-shape threading through the live proxy routes (forced reason)
// ---------------------------------------------------------------------------

function buildApp(reason) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    // Auth: any bearer token validates and pins urlKey 'acme'.
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    // The seam under test: force a chosen failure reason (null token).
    resolveWorkspaceAccess: async () => ({ token: null, reason }),
    getWorkspaceAccessToken: async () => null,
    // Unused on the failure path, but required by the factory signature.
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    // Free-tier metering: a no-op stub; the failure paths under test never charge.
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function requestJson(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer anything',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const getJson = (app, path) => requestJson(app, path);

test('Shape A (write endpoint POST /issues): 503 with structured envelope', async () => {
  // POST /issues resolves workspace access before any body validation, so the
  // forced null token short-circuits to the envelope (the readWrite stub
  // satisfies the write-scope guard, and Linear supports createIssue so the
  // capability gate is a pass). This is the write shape post-LIN-309.
  const { status, body } = await requestJson(buildApp('store_unreachable'), '/api/proxy/issues', {
    method: 'POST',
    body: { teamId: '00000000-0000-0000-0000-000000000000', title: 'x' }
  });
  assert.equal(status, 503);
  assert.equal(body.error, 'Workspace not available');
  assert.equal(body.code, 'WORKSPACE_STORE_UNAVAILABLE');
  assert.equal(body.category, 'upstream');
  assert.equal(body.retryable, true);
  assert.equal(body.context.workspaceUrlKey, 'acme');
});

test('Shape B (/stack, raw token): 503 with structured envelope', async () => {
  const { status, body } = await getJson(buildApp('session_expired'), '/api/proxy/stack');
  assert.equal(status, 503);
  assert.equal(body.error, 'Workspace not available');
  assert.equal(body.code, 'WORKSPACE_SESSION_EXPIRED');
  assert.equal(body.category, 'auth');
  assert.equal(body.retryable, false);
  assert.equal(body.context.workspaceUrlKey, 'acme');
});

test('Shape B (/stack) threads not_connected through to config envelope', async () => {
  const { status, body } = await getJson(buildApp('not_connected'), '/api/proxy/stack');
  assert.equal(status, 503);
  assert.equal(body.code, 'WORKSPACE_NOT_CONNECTED');
  assert.equal(body.category, 'config');
  assert.equal(body.retryable, false);
});

test('Shape B (/stack) threads owner_mismatch through to config envelope (LIN-1413)', async () => {
  const { status, body } = await getJson(buildApp('owner_mismatch'), '/api/proxy/stack');
  assert.equal(status, 503);
  assert.equal(body.code, 'WORKSPACE_OWNER_MISMATCH');
  assert.equal(body.category, 'config');
  assert.equal(body.retryable, false);
});

test('Shape B (/stack) threads owner_signed_out through to auth envelope (LIN-1506)', async () => {
  const { status, body } = await getJson(buildApp('owner_signed_out'), '/api/proxy/stack');
  assert.equal(status, 503);
  assert.equal(body.code, 'WORKSPACE_OWNER_SIGNED_OUT');
  assert.equal(body.category, 'auth');
  assert.equal(body.retryable, false);
  assert.equal(body.context.workspaceUrlKey, 'acme');
});
