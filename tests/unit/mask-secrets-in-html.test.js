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
import { renderTaskDocs } from '../../lib/render-task-page.js';

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
  // LIN-3780
  'resend-api-key': F.resendApiKey,
  'atlassian-api-token': F.atlassianApiToken,
  'atlassian-oauth-secret': F.atlassianOauthSecret,
  'mongodb-uri-credentials': F.mongodbUri,
  'github-client-secret': F.githubClientSecret,
  'linear-client-secret': F.linearClientSecret,
  'github-refresh-token': F.githubRefreshToken,
  'private-key-block-truncated': F.truncatedPrivateKey,
  'env-style-secret': F.envStyleSecret,
};

describe('LIN-3780 Railway-incident secret types on public pages', () => {
  const extra = {
    'resend bare': F.resendBareKey,
    'encrypted PEM': F.encryptedPrivateKey,
    'truncated PEM': F.truncatedPrivateKey,
  };
  for (const [name, text] of [...Object.entries(BY_RULE).slice(-9), ...Object.entries(extra)]) {
    test(`${name}: masked in <p>, <pre> and an attribute`, () => {
      for (const html of [`<p>${escapeHtml(text)}</p>`, `<pre>${escapeHtml(text)}</pre>`, `<a title="${escapeHtml(text)}">x</a>`]) {
        const r = maskSecretsInHtml(html);
        assert.ok(r.html.includes(MASK), html);
        assert.ok(r.hits.length > 0, html);
        assert.equal(findSecretMatches(r.html.replace(/<[^>]+>/g, '')).length, 0, html);
      }
    });
  }
  test('a Mongo URI is masked without a Bearer context', () => {
    assert.ok(maskSecretsInHtml(`<p>${escapeHtml(F.mongodbUri)}</p>`).html.includes(MASK));
  });
});

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

describe('LIN-3796 PEM split across <br>-separated text', () => {
  const lines = F.privateKey.split('\n');
  const leaks = (html) => findSecretMatches(html.replace(/<[^>]+>/g, '\n')).length;

  for (const br of ['<br>', '<br/>', '<br />', '<BR>', '<br class="x">']) {
    test(`served ${br} between PEM lines is masked, tags kept`, () => {
      const html = `<p>${lines.join(br)}</p>`;
      const r = maskSecretsInHtml(html);
      assert.ok(r.hits.includes('private-key-block'));
      assert.equal(leaks(r.html), 0);
      assert.ok(!r.html.includes('MIIEow'));
      assert.equal(r.html.split(br).length, html.split(br).length);
    });
  }

  test('markdown-source <br> (escaped to &lt;br&gt;) is masked', () => {
    const html = `<p>${escapeHtml(lines.join('<br>'))}</p><pre>${escapeHtml(lines.join('<br />'))}</pre>`;
    const r = maskSecretsInHtml(html);
    assert.ok(r.hits.includes('private-key-block'));
    assert.ok(!r.html.includes('MIIEow'));
  });

  test('other markup between lines still keeps segments separate', () => {
    const html = `<p>${lines.join('<b>x</b>')}</p>`;
    assert.equal(maskSecretsInHtml(html).html, html);
  });

  test('clean <br> pages are byte-identical', () => {
    const html = '<p>hello world, line one<br>second line of prose<br />third &lt;br&gt; line</p>';
    assert.equal(maskSecretsInHtml(html).html, html);
  });

  test('idempotent', () => {
    const once = maskSecretsInHtml(`<p>${lines.join('<br>')}</p>`).html;
    assert.equal(maskSecretsInHtml(once).html, once);
  });

  test('hostile inputs stay fast: truncated PEM and many <br>s', () => {
    for (const html of [
      `<p>-----BEGIN RSA PRIVATE KEY-----${'<br>QUJDREVGRw=='.repeat(20000)}</p>`,
      `<p>${'<br>'.repeat(100000)}</p>`,
      `<p>${escapeHtml('-----BEGIN RSA PRIVATE KEY-----' + '<br>AAAA'.repeat(20000))}</p>`,
    ]) {
      const t = Date.now();
      maskSecretsInHtml(html);
      assert.ok(Date.now() - t < 2000, `took ${Date.now() - t}ms`);
    }
  });
});

describe('LIN-3796 review follow-ups', () => {
  const leaks = (html) => findSecretMatches(html.replace(/<[^>]+>/g, '\n')).length;
  const brCount = (h) => h.split('<br>').length;
  const PEMS = {
    'full PEM': F.privateKey,
    'encrypted PEM': F.encryptedPrivateKey,
    'truncated PEM': F.truncatedPrivateKey,
  };
  const body = (text) => text.split('\n');

  // Known limit, same as base: a <br>-SPLIT truncated PEM followed by more text is not a
  // truncated PEM to the end-of-input-anchored rule, and per-line segments hold no PEM.
  test('truncated PEM followed by <br>text stays masked (per-segment scan kept)', () => {
    const t = F.truncatedPrivateKey;
    for (const html of [
      `<pre>${escapeHtml(t)}<br>end of log.</pre>`,
      `<p>${escapeHtml(t)}<br>-- sent from CI</p>`,
      `<p>${escapeHtml(t)}<br>end of log.</p><p>${body(t).join('<br>')}</p>`,
      `<p>${escapeHtml(body(t).join('<br>'))}</p>`,
    ]) {
      const r = maskSecretsInHtml(html);
      assert.ok(r.hits.includes('private-key-block-truncated'), html.slice(0, 80));
      assert.ok(!r.html.includes('MIIEow'));
      assert.equal(maskSecretsInHtml(r.html).html, r.html);
      assert.equal(brCount(maskSecretsInHtml(r.html).html), brCount(r.html));
    }
  });

  for (const [name, pem] of Object.entries(PEMS)) {
    test(`${name}: element, literal and mixed <br> are masked; tags survive a second pass`, () => {
      const ls = body(pem);
      const mixed = ls.map((l, i) => (i % 2 ? escapeHtml(l) : l)).join('<br>');
      for (const html of [
        `<p>${ls.join('<br>')}</p>`,
        `<p>${escapeHtml(ls.join('<br>'))}</p>`,
        `<p>${ls.map(escapeHtml).join('<br>')}</p>`,
        `<p>${mixed}</p>`,
      ]) {
        const r = maskSecretsInHtml(html);
        assert.ok(r.hits.length > 0);
        assert.ok(!r.html.includes('MIIEow'));
        assert.equal(leaks(r.html), 0);
        assert.equal(brCount(r.html), brCount(html));
        const again = maskSecretsInHtml(r.html);
        assert.equal(again.html, r.html);
        assert.equal(brCount(again.html), brCount(r.html));
      }
    });
  }

  test('real /t/ shape: markdown description with literal <br> via renderTaskDocs', () => {
    for (const pem of Object.values(PEMS)) {
      const html = renderTaskDocs({ description: pem.split('\n').join('<br>'), comments: [{ author: 'a', body: pem.split('\n').join('<br />') }] });
      assert.ok(html.includes('&lt;br&gt;'));
      const r = maskSecretsInHtml(html);
      assert.ok(r.hits.length > 0);
      assert.ok(!r.html.includes('MIIEow'));
    }
  });

  test('doctype, processing instruction and comment between lines break the run', () => {
    const ls = body(F.privateKey);
    for (const sep of ['<!doctype html>', '<?x?>', '<!-- c -->', '<b>x</b>']) {
      const html = `<p>${ls.join(sep)}</p>`;
      assert.equal(maskSecretsInHtml(html).html, html, sep);
    }
  });

  test('hostile inputs under the 1000 ms bound', () => {
    const cases = [
      `<p>${'-----BEGIN RSA PRIVATE KEY-----<br>'.repeat(6500)}</p>`,
      `<p>${escapeHtml('-----BEGIN RSA PRIVATE KEY-----<br>'.repeat(6500))}</p>`,
      `<p>-----BEGIN RSA PRIVATE KEY-----<br>Proc-Type: 4,ENCRYPTED<br>DEK-Info: ${'A,'.repeat(5000)}<br></p>`,
      `<p>${'A<br>'.repeat(100000)}</p>`,
    ];
    for (const html of cases) {
      maskSecretsInHtml(html); // warm
      const t = process.hrtime.bigint();
      maskSecretsInHtml(html);
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      assert.ok(ms < 1000, `took ${ms}ms`);
    }
  });
});
