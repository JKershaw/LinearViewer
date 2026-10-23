/**
 * LIN-3795: Harbour tokens carry a recognisable prefix so a bare token is masked
 * on public /t/ pages, while share tokens, hashes and legacy bare ids are not.
 *
 * Run with: node --test tests/unit/harbour-token-format.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { HARBOUR_TOKEN_PREFIXES, mintHarbourToken } from '../../lib/harbour-token-format.js';
import { SECRET_RULES, findSecretMatches } from '../../lib/secret-scan.js';
import { maskSecretsInHtml as maskResult } from '../../lib/mask-secrets-in-html.js';
import { credentialInProseRefusal } from '../../lib/runner-kit/runner.mjs';
import { maskBootstrapTokens, redactSessionItem } from '../../lib/dispatch-session-redaction.js';

const RULE_ID = 'harbour-bootstrap-token';
const RULE = SECRET_RULES.find(r => r.id === RULE_ID);
const harbourHits = (text) => findSecretMatches(text).filter(m => m.ruleId === RULE_ID);
// Runtime-built legacy (unprefixed) token: no token-shaped literal in the repo.
const legacy = () => randomBytes(32).toString('base64url');
const share = legacy;
const maskSecretsInHtml = (html) => maskResult(html).html;

describe('mintHarbourToken', () => {
  for (const [kind, prefix] of Object.entries(HARBOUR_TOKEN_PREFIXES)) {
    test(`${kind}: ${prefix} + 43 base64url chars`, () => {
      assert.match(mintHarbourToken(kind), new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`));
    });
  }
  test('throws on an unknown kind', () => {
    assert.throws(() => mintHarbourToken('share'), /Unknown Harbour token kind/);
    assert.throws(() => mintHarbourToken('constructor'), /Unknown Harbour token kind/);
  });
});

describe('harbour-bootstrap-token rule vs the token module', () => {
  test('rule has exactly one capture group', () => {
    assert.equal(new RegExp(RULE.regex.source + '|').exec('').length - 1, 1);
  });
  test('every prefix in the module is matched bare by the rule (the rule cannot import the module)', () => {
    for (const kind of Object.keys(HARBOUR_TOKEN_PREFIXES)) {
      const t = mintHarbourToken(kind);
      assert.equal(harbourHits(`pasted: ${t} end`).length, 1, kind);
    }
  });
});

describe('masking', () => {
  test('(a) minted tokens are masked bare, in Bearer and in exchange JSON', () => {
    for (const kind of Object.keys(HARBOUR_TOKEN_PREFIXES)) {
      const t = mintHarbourToken(kind);
      for (const text of [`here it is ${t}`, `Authorization: Bearer ${t}`, `{ "token": "${t}", "scope": "x" }`]) {
        assert.equal(harbourHits(text).length, 1, text);
        const out = maskSecretsInHtml(`<p>${text}</p>`);
        assert.ok(!out.includes(t), `${kind} leaked in: ${text}`);
        assert.ok(!out.includes(t.slice(-4)), `${kind} tail leaked in: ${text}`);
      }
    }
  });

  test('(b) share token in data-state-url, bare 43-char id and sha256 hex are not masked', () => {
    const s = share();
    const hex = createHash('sha256').update('x').digest('hex');
    const html = `<div data-state-url="/t/${s}/state"></div><p>${legacy()} ${hex}</p>`;
    // Asserts this rule's id, not byte-equality: random tokens can hit an unrelated rule
    // (openai-api-key, ~2.5e-6 per token), which must not turn this witness red.
    assert.ok(!maskResult(html).hits.includes(RULE_ID));
  });

  test("(b') a 43-char share token constructed to start hb?_ is not masked", () => {
    for (const p of ['hbd_', 'hbp_', 'hbf_', 'HBP_']) {
      const s = p + randomBytes(32).toString('base64url').slice(0, 43 - p.length);
      assert.equal(s.length, 43);
      assert.equal(harbourHits(s).length, 0, s);
      const html = `<div data-state-url="/t/${s}/state"></div>`;
      assert.ok(!maskResult(html).hits.includes(RULE_ID), p);
    }
  });

  test('(c) maskBootstrapTokens leaves no tail of a prefixed token', () => {
    const t = mintHarbourToken('proxy');
    const out = maskBootstrapTokens(`curl -H "Authorization: Bearer ${t}" x`);
    assert.ok(!out.includes(t.slice(-4)) && !out.includes('hbp_'), out);
    const item = redactSessionItem({ prompt: `Bearer ${t}`, dispatchedBy: 'a' }, 'b');
    assert.ok(!item.prompt.includes(t.slice(-4)), item.prompt);
  });

  test('(d) legacy tokens: masked in Bearer, exchange JSON and assignment; bare stays unmasked', () => {
    const t = legacy();
    for (const text of [`Bearer ${t}`, `{ "token": "${t}" }`, `working_token = "${t}"`]) {
      assert.equal(harbourHits(text).length, 1, text);
      assert.ok(!maskBootstrapTokens(text).includes(t.slice(-4)), text);
    }
    assert.equal(harbourHits(`bare ${t} here`).length, 0, 'documented residual: legacy bare is context-only');
  });

  test("(d') longer values after Bearer / proxy_token still mask their first 43 chars as before", () => {
    const long = randomBytes(64).toString('base64url').slice(0, 64);
    for (const text of [`Bearer ${long}`, `proxy_token = "${long}"`]) {
      assert.ok(maskBootstrapTokens(text).includes('[REDACTED-BOOTSTRAP-TOKEN]'), text);
      assert.ok(!maskBootstrapTokens(text).includes(long.slice(0, 43)), text);
    }
  });

  test('(g) a glued prefix is not masked bare', () => {
    assert.equal(harbourHits(`x${mintHarbourToken('proxy')}`).length, 0);
  });
});

describe('(e) runner credential-in-prose guard (standalone regex pinned to the real mint)', () => {
  const prose = (t) => ({ prompt: `curl -X POST -H "Authorization: Bearer ${t}" http://h/api/proxy/token` });
  test('refuses prose carrying a prefixed bootstrap and a legacy one', () => {
    assert.equal(credentialInProseRefusal(prose(mintHarbourToken('proxy'))), true);
    assert.equal(credentialInProseRefusal(prose(legacy())), true);
  });
  test('takes prose with no credential', () => {
    assert.equal(credentialInProseRefusal({ prompt: 'do the thing' }), false);
  });
});
