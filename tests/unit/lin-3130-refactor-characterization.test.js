/**
 * LIN-3130 S2a — characterization for the refactor-only extraction commit.
 *
 * The first S2a commit moves three behaviours out of `routes/dispatch.js`
 * without changing them. These tests pin the extracted modules DIRECTLY so a
 * future edit to the shared helper is caught here, not only through the HTTP
 * route tests that already exercise the moved code:
 *
 *   - lib/dispatch-feedback-validation.js  (validation order + error contracts)
 *   - lib/poll-halt.js                     (bounded read + projection/fallback)
 *   - lib/wake-credential.js               (harness gate + structural degrades)
 *
 * Additive only: no existing test is modified by this file.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedbackBody } from '../../lib/dispatch-feedback-validation.js';
import { readHaltForPoll, projectHaltForPoll, POLL_HALT_READ_TIMEOUT_MS } from '../../lib/poll-halt.js';
import { buildWakeCredentialProvisioner } from '../../lib/wake-credential.js';

// ── lib/dispatch-feedback-validation.js ─────────────────────────────────────

describe('LIN-3130 — validateFeedbackBody: required field + error strings', () => {
  test('missing message -> exact error string', () => {
    assert.deepEqual(validateFeedbackBody({}), { error: 'message is required and must be a string' });
  });

  test('non-string message -> exact error string', () => {
    assert.deepEqual(validateFeedbackBody({ message: 42 }), { error: 'message is required and must be a string' });
  });

  test('message over the cap -> exact error string', () => {
    const { error } = validateFeedbackBody({ message: 'x'.repeat(2001) });
    assert.equal(error, 'message exceeds maximum length of 2000');
  });

  test('url over the cap -> exact error string', () => {
    const { error } = validateFeedbackBody({ message: 'ok', url: 'https://e.test/' + 'a'.repeat(8000) });
    assert.equal(error, 'url exceeds maximum length of 8000');
  });

  test('urlLabel over the cap -> exact error string', () => {
    const { error } = validateFeedbackBody({ message: 'ok', urlLabel: 'l'.repeat(1001) });
    assert.equal(error, 'urlLabel exceeds maximum length of 1000');
  });

  test('dangerous char in message -> rejected', () => {
    assert.deepEqual(validateFeedbackBody({ message: 'a\u0000b' }), { error: 'message contains invalid characters' });
  });

  test('dangerous char in urlLabel -> rejected', () => {
    assert.deepEqual(validateFeedbackBody({ message: 'ok', urlLabel: 'a\u0007b' }), { error: 'urlLabel contains invalid characters' });
  });

  test('non-http(s) url -> rejected', () => {
    assert.deepEqual(validateFeedbackBody({ message: 'ok', url: 'javascript:alert(1)' }), { error: 'url must use http or https protocol' });
  });

  test('unparseable url -> rejected', () => {
    assert.deepEqual(validateFeedbackBody({ message: 'ok', url: 'not a url' }), { error: 'url must be a valid URL' });
  });
});

describe('LIN-3130 — validateFeedbackBody: validation order', () => {
  test('message validity is checked before url length', () => {
    const { error } = validateFeedbackBody({ message: '', url: 'https://e.test/' + 'a'.repeat(8000) });
    assert.equal(error, 'message is required and must be a string');
  });

  test('message length is checked before the dangerous-char scan', () => {
    const { error } = validateFeedbackBody({ message: 'x'.repeat(2001) + '\u0000' });
    assert.equal(error, 'message exceeds maximum length of 2000');
  });

  test('url length is checked before the dangerous-char scan of message', () => {
    // A dangerous message char must NOT win if an earlier length check fails.
    const { error } = validateFeedbackBody({ message: 'ok\u0000', url: 'https://e.test/' + 'a'.repeat(8000) });
    assert.equal(error, 'url exceeds maximum length of 8000');
  });
});

describe('LIN-3130 — validateFeedbackBody: sanitized payload', () => {
  test('a valid body normalizes absent url/urlLabel to null and keeps a known kind', () => {
    const { value } = validateFeedbackBody({ message: 'done', kind: 'heartbeat' });
    assert.deepEqual(value, { message: 'done', url: null, urlLabel: null, kind: 'heartbeat', rootItemId: undefined });
  });

  test('an unrecognized kind is silently dropped, never rejected', () => {
    const { value } = validateFeedbackBody({ message: 'done', kind: 'not-a-real-kind' });
    assert.equal(value.kind, undefined);
  });

  test('a valid rootItemId is kept; an invalid one is dropped', () => {
    const kept = validateFeedbackBody({ message: 'done', rootItemId: '00000000-0000-4000-8000-000000000000' }).value;
    assert.equal(kept.rootItemId, '00000000-0000-4000-8000-000000000000');
    const dropped = validateFeedbackBody({ message: 'done', rootItemId: 'not-a-uuid' }).value;
    assert.equal(dropped.rootItemId, undefined);
  });
});

describe('LIN-3130 — validateFeedbackBody: decision-withdrawn shape', () => {
  test('well-formed JSON with non-empty decision_id + reason passes', () => {
    const message = JSON.stringify({ decision_id: 'd-1', reason: 'superseded' });
    const { value } = validateFeedbackBody({ message, kind: 'decision-withdrawn' });
    assert.equal(value.kind, 'decision-withdrawn');
    assert.equal(value.message, message);
  });

  test('malformed JSON -> exact error string', () => {
    assert.deepEqual(
      validateFeedbackBody({ message: 'not json', kind: 'decision-withdrawn' }),
      { error: 'message must be valid JSON for kind:"decision-withdrawn"' }
    );
  });

  test('missing/empty decision_id or reason -> exact error string', () => {
    const expected = { error: 'kind:"decision-withdrawn" requires a non-empty decision_id and reason' };
    assert.deepEqual(validateFeedbackBody({ message: JSON.stringify({ decision_id: 'd-1' }), kind: 'decision-withdrawn' }), expected);
    assert.deepEqual(validateFeedbackBody({ message: JSON.stringify({ decision_id: '', reason: 'r' }), kind: 'decision-withdrawn' }), expected);
    assert.deepEqual(validateFeedbackBody({ message: JSON.stringify({ decision_id: 'd-1', reason: '   ' }), kind: 'decision-withdrawn' }), expected);
  });
});

// ── lib/poll-halt.js ────────────────────────────────────────────────────────

describe('LIN-3130 — projectHaltForPoll', () => {
  test('null doc -> null', () => {
    assert.equal(projectHaltForPoll(null), null);
  });

  test('projects exactly {mode,setAt,setBy} and drops _id', () => {
    assert.deepEqual(
      projectHaltForPoll({ _id: 'acme', mode: 'pause', setAt: '2026-01-01T00:00:00.000Z', setBy: 'alice', extra: 'x' }),
      { mode: 'pause', setAt: '2026-01-01T00:00:00.000Z', setBy: 'alice' }
    );
  });
});

describe('LIN-3130 — readHaltForPoll', () => {
  test('missing store -> null (never throws)', async () => {
    assert.equal(await readHaltForPoll(null, 'acme', 50), null);
  });

  test('store doc -> projected halt', async () => {
    const store = {
      getWorkspaceHalt: async () => ({ _id: 'acme', mode: 'stop', setAt: 't', setBy: 'bob' }),
      getLastKnownHalt: () => { throw new Error('must not be consulted'); }
    };
    assert.deepEqual(await readHaltForPoll(store, 'acme', 50), { mode: 'stop', setAt: 't', setBy: 'bob' });
  });

  test('store read failure degrades to the last-known cache', async () => {
    const cached = { mode: 'pause', setAt: 't', setBy: 'alice' };
    const store = {
      getWorkspaceHalt: async () => { throw new Error('boom'); },
      getLastKnownHalt: () => cached
    };
    assert.deepEqual(await readHaltForPoll(store, 'acme', 50), cached);
  });

  test('a read slower than the bound degrades to the last-known cache within the bound', async () => {
    const cached = { mode: 'pause', setAt: 't', setBy: 'alice' };
    const store = {
      getWorkspaceHalt: () => new Promise(() => {}),
      getLastKnownHalt: () => cached
    };
    const started = Date.now();
    const result = await readHaltForPoll(store, 'acme', 30);
    assert.deepEqual(result, cached);
    assert.ok(Date.now() - started < 1000, 'the bound must win promptly');
  });

  test('the default bound is the exported POLL_HALT_READ_TIMEOUT_MS', () => {
    assert.equal(POLL_HALT_READ_TIMEOUT_MS, 1500);
  });
});

// ── lib/wake-credential.js ──────────────────────────────────────────────────

describe('LIN-3130 — buildWakeCredentialProvisioner: harness gate + structural degrades', () => {
  test('a prose harness (opencode) needs no token, no mint attempted', async () => {
    const provision = buildWakeCredentialProvisioner({ proxyTokenStore: { minted: false }, urlKey: 'acme', baseUrl: 'http://x', createdBy: 'acct' });
    assert.deepEqual(await provision('opencode'), { token: null, reason: null, degraded: null });
  });

  test('null harness resolves toward claude-code; with no proxy store -> no-proxy-token-store', async () => {
    const provision = buildWakeCredentialProvisioner({ proxyTokenStore: null, urlKey: 'acme', baseUrl: 'http://x', createdBy: 'acct' });
    assert.deepEqual(await provision(null), { token: null, reason: null, degraded: 'no-proxy-token-store' });
  });

  test('ownerless caller -> no-token-owner (never mints an ownerless bootstrap)', async () => {
    const provision = buildWakeCredentialProvisioner({ proxyTokenStore: {}, urlKey: 'acme', baseUrl: 'http://x', createdBy: null });
    assert.deepEqual(await provision('claude-code'), { token: null, reason: null, degraded: 'no-token-owner' });
  });
});
