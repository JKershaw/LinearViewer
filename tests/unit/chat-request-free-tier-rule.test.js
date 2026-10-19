// LIN-3658: lib/chat-request.js is the one home for "who is on the free tier"
// (resolveOpenRouterSource, isFlagFreeTier) and for the prompt refusal's
// `freeTier` block (freeTierRefusalBlock). Expectations derived from the
// pre-LIN-3658 copies (server.js getOpenRouterSource, routes/workspace-api.js
// sessionIsFreeTier / freeTierBody), with the class (d) answers pinned by
// explicit rows: kept today, byte for byte, even where they look wrong. The
// proxy's error, reason, freeTier key order is witnessed over HTTP in
// proxy-openrouter-fallback-note.test.js, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as home from '../../lib/chat-request.js';

const { resolveOpenRouterSource, isFlagFreeTier, freeTierRefusalBlock, resolveChatCredential } = home;

function withEnv({ envKey, freeKey }, fn) {
  const prevEnv = process.env.OPENROUTER_API_KEY;
  const prevFree = process.env.OPENROUTER_FREE_TIER_KEY;
  if (envKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = envKey;
  if (freeKey === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY;
  else process.env.OPENROUTER_FREE_TIER_KEY = freeKey;
  try {
    return fn();
  } finally {
    if (prevEnv === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevEnv;
    if (prevFree === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY;
    else process.env.OPENROUTER_FREE_TIER_KEY = prevFree;
  }
}

// env paid key states: unset / blank / whitespace (not paid, LIN-961) / real
const PAID = [undefined, '', '   ', 'env_paid'];
const isPaid = (v) => v === 'env_paid';
// free-tier key states: unset / blank / whitespace (not set, trimmed like the paid key: LIN-3664) / real
const FREE = [undefined, '', '  ', 'free_k'];
const freeSet = (v) => v !== undefined && v.trim() !== '';

test('resolveOpenRouterSource: full truth table (session key × paid env × free env × flag)', () => {
  let rows = 0;
  for (const sessionApiKey of [undefined, '', 'sess_k']) {
    for (const envKey of PAID) {
      for (const freeKey of FREE) {
        for (const sessionFreeTierFlag of [undefined, false, true]) {
          let expected;
          if (sessionApiKey) expected = 'oauth';
          else if (isPaid(envKey)) expected = 'env';
          else if (freeSet(freeKey) || sessionFreeTierFlag) expected = 'free';
          else expected = null;
          const got = withEnv({ envKey, freeKey }, () => resolveOpenRouterSource({ sessionApiKey, sessionFreeTierFlag }));
          assert.equal(got, expected, JSON.stringify({ sessionApiKey, envKey, freeKey, sessionFreeTierFlag }));
          rows++;
        }
      }
    }
  }
  assert.equal(rows, 3 * 4 * 4 * 3);
});

test('isFlagFreeTier: flag set, no session key, no paid env key — the free env key is ignored (LIN-405)', () => {
  for (const sessionApiKey of [undefined, '', 'sess_k']) {
    for (const envKey of PAID) {
      for (const freeKey of FREE) {
        for (const sessionFreeTierFlag of [undefined, false, true]) {
          const expected = !!sessionFreeTierFlag && !sessionApiKey && !isPaid(envKey);
          const got = withEnv({ envKey, freeKey }, () => isFlagFreeTier({ sessionApiKey, sessionFreeTierFlag }));
          assert.equal(got, expected, JSON.stringify({ sessionApiKey, envKey, freeKey, sessionFreeTierFlag }));
        }
      }
    }
  }
});

test('class (d) kept: flag with no key says "free" for the source but resolveChatCredential does not count it', () => {
  withEnv({ envKey: undefined, freeKey: undefined }, () => {
    assert.equal(resolveOpenRouterSource({ sessionApiKey: undefined, sessionFreeTierFlag: true }), 'free');
    assert.deepEqual(resolveChatCredential({ sessionApiKey: undefined }), { apiKey: null, isFreeTier: false, available: false });
  });
});

test('LIN-3664: a whitespace free-tier key is not set (source, credential and getFreeTierKey agree)', () => {
  for (const freeKey of ['  ', '\t\n', '']) {
    withEnv({ envKey: undefined, freeKey }, () => {
      assert.equal(resolveOpenRouterSource({ sessionApiKey: undefined, sessionFreeTierFlag: false }), null);
      assert.deepEqual(resolveChatCredential({ sessionApiKey: undefined }), { apiKey: null, isFreeTier: false, available: false });
      assert.equal(home.getFreeTierKey(), null);
    });
  }
});

test('LIN-3664: a padded free-tier key is trimmed and still counts as free', () => {
  withEnv({ envKey: undefined, freeKey: '  free_k \n' }, () => {
    assert.equal(resolveOpenRouterSource({ sessionApiKey: undefined, sessionFreeTierFlag: false }), 'free');
    assert.deepEqual(resolveChatCredential({ sessionApiKey: undefined }), { apiKey: 'free_k', isFreeTier: true, available: true });
  });
});

test('resolveOpenRouterSource reads only its two named inputs — consent fields never matter (LIN-2412)', () => {
  const base = { sessionApiKey: undefined, sessionFreeTierFlag: false };
  for (const [envKey, freeKey] of [[undefined, undefined], ['env_paid', undefined], [undefined, 'free_k']]) {
    const plain = withEnv({ envKey, freeKey }, () => resolveOpenRouterSource(base));
    const withConsent = withEnv({ envKey, freeKey }, () => resolveOpenRouterSource({ ...base, openRouterDurableConsentAt: '2026-01-01', getOpenRouterConsent: () => true }));
    assert.equal(withConsent, plain);
  }
  const src = readFileSync(new URL('../../lib/chat-request.js', import.meta.url), 'utf8');
  const start = src.indexOf('export function resolveOpenRouterSource');
  assert.ok(start >= 0, 'resolveOpenRouterSource must exist in the home');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.doesNotMatch(body, /openRouterDurableConsentAt|getOpenRouterConsent/, 'the home source predicate must never read the unattended-use consent field');
});

test('freeTierRefusalBlock: exact bytes, key order, only the four denial fields', () => {
  const denial = { allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 50, resetsAt: '2026-10-18T22:00:00.000Z', extra: 'x' };
  const block = freeTierRefusalBlock(denial);
  assert.equal(JSON.stringify(block), '{"freeTier":{"used":true,"remaining":0,"limit":50,"resetsAt":"2026-10-18T22:00:00.000Z"}}');
  assert.equal(JSON.stringify(freeTierRefusalBlock({ remaining: undefined, limit: 3, resetsAt: 'r' })), '{"freeTier":{"used":true,"limit":3,"resetsAt":"r"}}');
});
