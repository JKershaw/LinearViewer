/**
 * LIN-3389 — lib/mask-secrets-in-html.js and findSecretMatches.
 *
 * Run with: node --test tests/unit/mask-secrets-in-html.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecretsInHtml, MASK } from '../../lib/mask-secrets-in-html.js';
import { SECRET_RULES, scanText, findSecretMatches } from '../../lib/secret-scan.js';
import { FIXTURE_SECRETS as F } from '../fixtures/secret-scan-fixtures.js';
import { escapeHtml } from '../../lib/utils/html.js';

// One fixture text per rule id. Every rule must appear here (guard below).
const BY_RULE = {
  'aws-access-key-id': F.awsAccessKey,
  'aws-secret-access-key': `aws_secret_access_key = "${F.awsSecretKey}"`,
  'github-pat': F.githubPat,
  'github-fine-grained-pat': F.githubFineGrainedPat,
  'github-oauth': F.githubOauth,
  'github-app-token': F.githubAppToken,
  'linear-api-key': F.linearApiKey,
  'linear-oauth': F.linearOauth,
  'openai-api-key': F.openaiApiKey,
  'anthropic-api-key': F.anthropicApiKey,
  'openrouter-api-key': F.openrouterApiKey,
  'slack-token': F.slackToken,
  'stripe-secret-key': F.stripeKey,
  'private-key-block': F.privateKey,
  'bearer-auth-token': `Authorization: Bearer ${F.bearerToken.slice(0, 33)}`,
  'harbour-bootstrap-token': `bootstrap_token = "${F.bootstrapToken}"`,
  'generic-secret-assignment': `api_key = "${F.genericSecretValue}"`,
};

describe('maskSecretsInHtml', () => {
  test('every SECRET_RULES id has a fixture, and each is masked (enumeration guard)', () => {
    for (const rule of SECRET_RULES) {
      const text = BY_RULE[rule.id];
      assert.ok(text, `add a fixture for new rule ${rule.id}`);
      const { html, hits } = maskSecretsInHtml(`<p>${escapeHtml(text)}</p>`);
      assert.ok(hits.includes(rule.id), `${rule.id} not reported (hits=${hits})`);
      assert.ok(html.includes(MASK), rule.id);
      assert.equal(findSecretMatches(html.replace(/<[^>]+>/g, '')).length, 0, rule.id);
    }
  });

  test('clean input returns the identical string', () => {
    const html = '<!doctype html><p class="a">Hello &amp; welcome, api_key = &quot;short&quot;</p>';
    const r = maskSecretsInHtml(html);
    assert.equal(r.html, html);
    assert.deepEqual(r.hits, []);
  });

  test('entity-encoded quotes around an assignment are masked (raw scan misses it)', () => {
    const raw = `api_key = "${F.genericSecretValue}"`;
    const html = `<div>note: ${escapeHtml(raw)} end</div>`;
    assert.equal(scanText(html).length, 0, 'premise: raw HTML scan misses it');
    assert.equal(maskSecretsInHtml(html).html, `<div>note: ${MASK} end</div>`);
  });

  test('numeric and hex entities inside and at the edges of a secret', () => {
    const k = F.awsAccessKey;
    const hexFirst = `&#x${k.charCodeAt(0).toString(16)};${k.slice(1)}`;
    const decFirst = `&#${k.charCodeAt(0)};${k.slice(1)}`;
    const inside = `${k.slice(0, 6)}&#${k.charCodeAt(6)};${k.slice(7)}`;
    for (const enc of [hexFirst, decFirst, inside]) {
      assert.equal(maskSecretsInHtml(`<p>${enc}</p>`).html, `<p>${MASK}</p>`, enc);
    }
  });

  test('a secret in a quoted attribute value is masked, tag structure intact', () => {
    const html = `<a href="/x" title="${F.githubPat}" data-k='v'>t</a>`;
    const r = maskSecretsInHtml(html);
    assert.equal(r.html, `<a href="/x" title="${MASK}" data-k='v'>t</a>`);
  });

  test('two adjacent secrets are both masked', () => {
    const apart = maskSecretsInHtml(`<p>${F.awsAccessKey} ${F.secondAwsAccessKey}</p>`);
    assert.equal(apart.html, `<p>${MASK} ${MASK}</p>`);
  });

  test('overlapping rules on the same text become one span', () => {
    const t = `Authorization: Bearer ${F.bearerToken}`;
    const r = maskSecretsInHtml(`<p>${t}</p>`);
    assert.equal(r.html, `<p>${MASK}</p>`);
  });

  test('placeholders and low-entropy values are untouched', () => {
    const html = '<p>api_key = &quot;your_api_key_goes_here_please_ok&quot;</p>';
    assert.equal(maskSecretsInHtml(html).html, html);
  });

  test('masking is idempotent and leaves the tag count unchanged', () => {
    const html = `<ul><li>${F.slackToken}</li><li title="${F.stripeKey}">x</li></ul>`;
    const once = maskSecretsInHtml(html);
    assert.equal(maskSecretsInHtml(once.html).html, once.html);
    assert.equal((once.html.match(/</g) || []).length, (html.match(/</g) || []).length);
  });

  test('script and style bodies are not scanned; markup after them still is', () => {
    const html = `<style>.a{content:"${F.awsAccessKey}"}</style><script>var k="${F.awsAccessKey}"</script><p>${F.awsAccessKey}</p>`;
    const r = maskSecretsInHtml(html);
    assert.equal(r.html, `<style>.a{content:"${F.awsAccessKey}"}</style><script>var k="${F.awsAccessKey}"</script><p>${MASK}</p>`);
  });

  test('a comment body is scanned', () => {
    assert.equal(maskSecretsInHtml(`<!-- ${F.githubPat} --><p>x</p>`).html, `<!-- ${MASK} --><p>x</p>`);
  });

  test('hits carry rule ids only, never matched text', () => {
    const { hits } = maskSecretsInHtml(`<p>${F.githubPat}</p>`);
    assert.deepEqual(hits, ['github-pat']);
  });
});

describe('findSecretMatches vs scanText', () => {
  test('scanText keeps its same-line dedupe; findSecretMatches does not', () => {
    const t = `${F.awsAccessKey} ${F.secondAwsAccessKey}`;
    assert.equal(scanText(t).length, 1);
    assert.equal(findSecretMatches(t).length, 2);
  });
});
