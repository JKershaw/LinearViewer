/**
 * Unit tests for lib/secret-scan.js (LIN-2573).
 *
 * Verifies high-confidence secret detection rules, entropy calculation,
 * redaction, and fixture path allowlisting.
 *
 * Hermetic: zero live network.
 * Run with: node --test tests/unit/secret-scan.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  shannonEntropy,
  redactSecret,
  isAllowlistedFixturePath,
  scanText,
  findSecretMatches,
  scanFile,
  scanDirectory,
  SECRET_RULES,
  ALLOWLISTED_FIXTURE_PATHS
} from '../../lib/secret-scan.js';
import { FIXTURE_SECRETS } from '../fixtures/secret-scan-fixtures.js';

describe('shannonEntropy', () => {
  test('returns 0 for empty string or null', () => {
    assert.equal(shannonEntropy(''), 0);
    assert.equal(shannonEntropy(null), 0);
  });

  test('returns 0 for single repeated character', () => {
    assert.equal(shannonEntropy('A'.repeat(50)), 0);
  });

  test('returns low entropy for low-variety strings', () => {
    const low = shannonEntropy('AAAAABBBBB');
    assert.ok(low <= 1.0, `Expected low entropy <= 1.0, got ${low}`);
  });

  test('returns high entropy (> 3.5) for random base64url token', () => {
    const high = shannonEntropy(FIXTURE_SECRETS.bootstrapToken);
    assert.ok(high > 3.5, `Expected entropy > 3.5, got ${high}`);
  });
});

describe('redactSecret', () => {
  test('redacts secret keeping 4-char prefix and suffix', () => {
    const redacted = redactSecret(FIXTURE_SECRETS.githubPat);
    assert.equal(redacted, 'ghp_...[REDACTED]...0123');
  });

  test('handles short secrets safely', () => {
    assert.equal(redactSecret('short'), '***[REDACTED]***');
    assert.equal(redactSecret(null), '[REDACTED]');
  });
});

describe('isAllowlistedFixturePath', () => {
  test('returns true for documented fixture directories', () => {
    assert.equal(isAllowlistedFixturePath('tests/fixtures/sample.txt'), true);
    assert.equal(isAllowlistedFixturePath('/root/tests/fixtures/mock-data.js'), true);
    assert.equal(isAllowlistedFixturePath('scripts/eval/fixtures/LIN-177.json'), true);
    assert.equal(isAllowlistedFixturePath('scripts/eval/lin-263-spike3-out/fixtures/LIN-344.json'), true);
  });

  test('returns false for non-fixture paths', () => {
    assert.equal(isAllowlistedFixturePath('server.js'), false);
    assert.equal(isAllowlistedFixturePath('lib/secret-scan.js'), false);
    assert.equal(isAllowlistedFixturePath('routes/proxy.js'), false);
    assert.equal(isAllowlistedFixturePath('public/app.js'), false);
    assert.equal(isAllowlistedFixturePath('tests/unit/something.test.js'), false);
  });
});

describe('scanText secret detection rules', () => {
  test('detects AWS Access Key ID', () => {
    const text = `const key = "${FIXTURE_SECRETS.awsAccessKey}";`;
    const findings = scanText(text, { filePath: 'src/config.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'aws-access-key-id');
    assert.equal(findings[0].confidence, 'high');
  });

  test('detects AWS Secret Key assignment', () => {
    const text = `aws_secret_access_key = "${FIXTURE_SECRETS.awsSecretKey}"`;
    const findings = scanText(text, { filePath: 'src/config.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'aws-secret-access-key');
  });

  test('detects GitHub Personal Access Token (classic)', () => {
    const text = `const token = "${FIXTURE_SECRETS.githubPat}";`;
    const findings = scanText(text, { filePath: 'src/auth.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'github-pat');
  });

  test('detects GitHub Fine-Grained PAT', () => {
    const text = FIXTURE_SECRETS.githubFineGrainedPat;
    const findings = scanText(text, { filePath: 'src/auth.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'github-fine-grained-pat');
  });

  test('detects GitHub OAuth Token', () => {
    const text = `const oauth = "${FIXTURE_SECRETS.githubOauth}";`;
    const findings = scanText(text, { filePath: 'src/auth.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'github-oauth');
  });

  test('detects Linear API Key', () => {
    const text = `const key = "${FIXTURE_SECRETS.linearApiKey}";`;
    const findings = scanText(text, { filePath: 'src/linear.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'linear-api-key');
  });

  test('detects Linear OAuth Token', () => {
    const text = `const tok = "${FIXTURE_SECRETS.linearOauth}";`;
    const findings = scanText(text, { filePath: 'src/linear.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'linear-oauth');
  });

  test('detects OpenAI API Key', () => {
    const text = `const key = "${FIXTURE_SECRETS.openaiApiKey}";`;
    const findings = scanText(text, { filePath: 'src/ai.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'openai-api-key');
  });

  test('detects Anthropic API Key', () => {
    const text = `const key = "${FIXTURE_SECRETS.anthropicApiKey}";`;
    const findings = scanText(text, { filePath: 'src/ai.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'anthropic-api-key');
  });

  test('detects OpenRouter API Key', () => {
    const text = `const key = "${FIXTURE_SECRETS.openrouterApiKey}";`;
    const findings = scanText(text, { filePath: 'src/ai.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'openrouter-api-key');
  });

  test('detects Slack Token', () => {
    const text = `const token = "${FIXTURE_SECRETS.slackToken}";`;
    const findings = scanText(text, { filePath: 'src/slack.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'slack-token');
  });

  test('detects Stripe Secret Key', () => {
    const text = `const key = "${FIXTURE_SECRETS.stripeKey}";`;
    const findings = scanText(text, { filePath: 'src/billing.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'stripe-secret-key');
  });

  test('detects high-entropy Private Key block', () => {
    const text = FIXTURE_SECRETS.privateKey;
    const findings = scanText(text, { filePath: 'src/key.pem' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'private-key-block');
  });

  test('suppresses Private Key block with dummy repeated chars (e.g. AAAA)', () => {
    const text = `
-----BEGIN RSA PRIVATE KEY-----
AAAA
-----END RSA PRIVATE KEY-----
`;
    const findings = scanText(text, { filePath: 'tests/unit/auth.test.js' });
    assert.equal(findings.length, 0);
  });

  test('detects Harbour bootstrap token outside fixture paths', () => {
    const text = `curl -X POST -H "Authorization: Bearer ${FIXTURE_SECRETS.bootstrapToken}" https://harbour.cat/api/proxy/token`;
    const findings = scanText(text, { filePath: 'routes/proxy.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'harbour-bootstrap-token');
  });

  test('suppresses Harbour bootstrap token in fixture paths (LIN-2573 constraint)', () => {
    const text = `curl -X POST -H "Authorization: Bearer ${FIXTURE_SECRETS.bootstrapToken}" https://harbour.cat/api/proxy/token`;
    const findings = scanText(text, { filePath: 'tests/fixtures/collective-participant/with-token.txt' });
    assert.equal(findings.length, 0);
  });

  test('suppresses known dummy placeholders', () => {
    const text = `
SESSION_SECRET = "test-secret-for-ci";
const auth = "Bearer <token>";
const key = "your_token_here";
const dummy = "placeholder";
`;
    const findings = scanText(text, { filePath: 'server.js' });
    assert.equal(findings.length, 0);
  });

  test('tracks exact line and column numbers', () => {
    const text = `line 1\nline 2\nconst token = "${FIXTURE_SECRETS.githubPat}";`;
    const findings = scanText(text, { filePath: 'test.js' });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 3);
    assert.equal(findings[0].column, 16);
  });

  test('scanFile uses repo-relative path when options.filePath is provided (F3)', () => {
    const text = `const apiKey = "${FIXTURE_SECRETS.linearApiKey}";`;
    const tempFile = path.resolve('temp-planted-secret.js');
    fs.writeFileSync(tempFile, text);
    try {
      const findings = scanFile(tempFile, { filePath: 'lib/temp-planted-secret.js' });
      assert.equal(findings.length, 1);
      assert.equal(findings[0].filePath, 'lib/temp-planted-secret.js');
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});

describe('LIN-3780 Railway-incident secret types', () => {
  const F = FIXTURE_SECRETS;
  const positives = {
    'resend-api-key': F.resendApiKey,
    'atlassian-api-token': F.atlassianApiToken,
    'atlassian-oauth-secret': F.atlassianOauthSecret,
    'mongodb-uri-credentials': F.mongodbUri,
    'github-client-secret': F.githubClientSecret,
    'linear-client-secret': F.linearClientSecret,
    'github-refresh-token': F.githubRefreshToken,
    'private-key-block': F.encryptedPrivateKey,
    'private-key-block-truncated': F.truncatedPrivateKey,
    'env-style-secret': F.envStyleSecret,
  };
  for (const [id, text] of Object.entries(positives)) {
    test(`detects ${id}`, () => {
      const ids = findSecretMatches(text).map(m => m.ruleId);
      assert.ok(ids.includes(id), `${id} not in ${ids}`);
    });
  }
  test('bare resend form is detected', () => {
    assert.ok(findSecretMatches(F.resendBareKey).some(m => m.ruleId === 'resend-api-key'));
  });

  // LIN-3794: ATCTT3 access tokens share the ATATT3 body shape and are reported under the same rule id.
  test('ATCTT3 access token is detected as atlassian-api-token', () => {
    const hits = findSecretMatches(F.atlassianAccessToken).filter(m => m.ruleId === 'atlassian-api-token');
    assert.equal(hits.length, 1);
  });
  test('ATCTT3 below the length floor is not detected', () => {
    assert.deepEqual(findSecretMatches('ATCTT3' + 'xFfGN0aB3d'), []);
  });
  test('ATCTX3 (wrong prefix) is not detected', () => {
    assert.deepEqual(findSecretMatches(F.atlassianAccessToken.replace('ATCTT3', 'ATCTX3')), []);
  });

  const negatives = {
    'placeholder mongo password': 'mongodb://admin:password@localhost:27017/db',
    'shell-expanded mongo': 'mongodb://$MONGOUSER:$MONGOPASSWORD@host/db',
    'braced shell mongo': 'mongodb+srv://${U}:${P}@host/db',
    'AAAA pem': '-----BEGIN RSA PRIVATE KEY-----\n' + 'A'.repeat(200),
    'armor-only pem concat': "'-----BEGIN RSA PRIVATE KEY-----' + 'A'.repeat(1000)",
    'bare header': '-----BEGIN RSA PRIVATE KEY-----',
    // Without the `body === match` guard these headers (which pass the length check on their own) match.
    'bare encrypted header': '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    'bare openssh header': '-----BEGIN OPENSSH PRIVATE KEY-----',
    'bare pgp header': '-----BEGIN PGP PRIVATE KEY BLOCK-----',
    'JS token assignment': "FOO_TOKEN = 'abcdefghijklmnop1234567890XYZ'",
    'blank dotenv followed by key': 'LINEAR_CLIENT_SECRET=\nOTHER_API_KEY=\n',
    'identifier-like re_': 're_split_lines_helper_fn',
    'env ref': 'SERVICE_API_KEY=${SERVICE_API_KEY_VALUE_FROM_VAULT}',
  };
  for (const [name, text] of Object.entries(negatives)) {
    test(`does not flag: ${name}`, () => {
      assert.deepEqual(findSecretMatches(text).map(m => m.ruleId), []);
    });
  }

  test('long repeated BEGIN input completes quickly', () => {
    const big = '-----BEGIN RSA PRIVATE KEY-----\n'.repeat(6500);
    const t0 = Date.now();
    findSecretMatches(big);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
  });
  test('Proc-Type/DEK-Info lines then a non-base64 tail complete quickly (no ReDoS)', () => {
    const head = '-----BEGIN RSA PRIVATE KEY-----\n';
    const hostile = head + ('Proc-Type:' + 'A'.repeat(20) + '\n').repeat(8) + '!';
    const t0 = Date.now();
    findSecretMatches(hostile);
    assert.ok(Date.now() - t0 < 100, `took ${Date.now() - t0}ms`);
    const bigHostile = head + ('DEK-Info:' + 'A'.repeat(20) + '\n').repeat(400) + '\n!';
    const t1 = Date.now();
    findSecretMatches(bigHostile);
    assert.ok(Date.now() - t1 < 100, `took ${Date.now() - t1}ms`);
  });
  test('truncated encrypted PEM with Proc-Type/DEK-Info headers still matches', () => {
    const [header, ...rest] = F.truncatedPrivateKey.split('\n');
    const pem = header + '\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF\n\n' + rest.join('\n');
    assert.ok(findSecretMatches(pem).some(m => m.ruleId === 'private-key-block-truncated'));
  });
  test('mongo password that merely starts with a placeholder word is still masked', () => {
    for (const pw of ['adminZx9Qm4Tk7Wp2Rv8', 'testQk7Zp2Lw9Rv8Bn5']) {
      const uri = ['mongodb://', 'svc:', pw, '@host/db'].join('');
      assert.ok(findSecretMatches(uri).some(m => m.ruleId === 'mongodb-uri-credentials'), uri);
    }
  });
  test('long mongodb-like input completes quickly', () => {
    const big = 'mongodb://' + 'a:'.repeat(100000);
    const t0 = Date.now();
    findSecretMatches(big);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
  });
});

describe('scanDirectory against repository', () => {
  test('scans repository cleanly with 0 false positive findings', () => {
    const result = scanDirectory('.');
    assert.ok(result.scannedFiles > 1000, `Expected > 1000 files, got ${result.scannedFiles}`);
    assert.equal(result.findings.length, 0, `Expected 0 findings in repo, got: ${JSON.stringify(result.findings)}`);
    assert.equal(result.totalHits, 0);
  });
});

describe('LIN-3818 truncated PEM followed by trailing text', () => {
  const F = FIXTURE_SECRETS;
  const rule = SECRET_RULES.find(r => r.id === 'private-key-block-truncated');
  const keyLines = F.truncatedPrivateKey.split('\n');
  const KEY = keyLines.slice(4).join('\n'); // body lines only
  const HEAD = '-----BEGIN RSA PRIVATE KEY-----\n';
  const trunc = (text) => findSecretMatches(text).filter(m => m.ruleId === 'private-key-block-truncated');

  test('keeps exactly one capture group and the /g flag', () => {
    assert.equal(new RegExp(rule.regex.source + '|').exec('').length - 1, 1);
    assert.ok(rule.regex.global);
  });
  for (const [name, tail] of Object.entries({
    prose: '\nend of log.',
    'signature dash line': '\n-- sent from CI',
    'markup-ish': '\n<b>done</b>',
    path: '\n/var/log/app/run-proposals-store.json',
    'placeholder word': '\nthis is a placeholder example',
    'xxxxxx run': '\nxxxxxxxxxx',
  })) {
    test(`trailing text is not a leak: ${name}`, () => {
      const hits = trunc(HEAD + KEY + tail);
      assert.equal(hits.length, 1);
      assert.ok(hits[0].match.includes('QRSTUVWXYZ0123456789'));
    });
    test(`scanText reports it: ${name}`, () => {
      assert.ok(scanText(HEAD + KEY + tail).some(f => f.ruleId === 'private-key-block-truncated'));
    });
  }
  test('single-line key followed by trailing text', () => {
    assert.equal(trunc(HEAD + keyLines[4] + ' then some words').length, 1);
  });
  test('complete block is not also reported as truncated', () => {
    assert.equal(trunc(F.privateKey).length, 0);
    assert.equal(trunc(F.encryptedPrivateKey + '\nafter').length, 0);
  });
  test('code line / empty body / short body are not matched', () => {
    assert.equal(trunc(`'-----BEGIN RSA PRIVATE KEY-----' + 'A'.repeat(64)`).length, 0);
    assert.equal(trunc(HEAD + 'tail').length, 0);
    assert.equal(trunc(HEAD + 'AAAA\nthe end').length, 0);
  });
  test('end-of-input narrow wrap with no key-shaped first token behaves as before', () => {
    const narrow = HEAD + 'MIIEowIBAAKCAQEA0Y12\n3456abcdefghijklmnopqrst\nuvwxyzABCDEFGHIJKLMNOP';
    assert.equal(trunc(narrow).length, 1);
    // placeholder-shaped body at end of input is still suppressed (HEAD behaviour)
    assert.equal(trunc(HEAD + 'your token placeholder abcdefghijklmnopqrstuvwxyz0123').length, 0);
  });
  test('rule alone stays linear on hostile input', () => {
    const hostile = [
      '-----BEGIN RSA PRIVATE KEY-----' + 'Proc-Type:A\n'.repeat(8000),
      '-----BEGIN RSA PRIVATE KEY-----\n'.repeat(6500),
      ('-----BEGIN RSA PRIVATE KEY-----' + 'A'.repeat(9000) + '!').repeat(200),
      '-----BEGIN RSA PRIVATE KEY-----' + ('DEK-Info:' + 'A'.repeat(20) + '\n').repeat(8000) + '!',
    ];
    for (const h of hostile) {
      const t0 = Date.now();
      rule.regex.lastIndex = 0;
      while (rule.regex.exec(h) !== null) { /* drain */ }
      assert.ok(Date.now() - t0 < 1000, `rule took ${Date.now() - t0}ms`);
    }
  });
  test('all-rules catastrophic-regression guard', () => {
    const t0 = Date.now();
    findSecretMatches(('-----BEGIN RSA PRIVATE KEY-----' + 'Proc-Type:A\n'.repeat(50)).repeat(150));
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
  });

  // Review F1-F4 (LIN-3818).
  const BEGIN = '-----BEGIN RSA PRIVATE KEY-----';
  const PBEGIN = '-----BEGIN PRIVATE KEY-----';
  const SHA = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
  test('bare header followed by prose is not a key (F1)', () => {
    for (const text of [
      PBEGIN + ' header followed by the body lines and then the footer, always.',
      BEGIN + '\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF\nthe key is stored elsewhere, see the runbook.',
      BEGIN + ' this sentence is much longer than thirty-two characters of prose.',
      PBEGIN + ' see commit ' + SHA + ' for details of the change.',
    ]) {
      assert.deepEqual(findSecretMatches(text).filter(m => m.ruleId === 'private-key-block-truncated'), [], text);
    }
  });
  test('first-token residual: SHA-first and path-first bodies are hits, placeholder-first path is not', () => {
    assert.equal(trunc(PBEGIN + '\n' + SHA + ' is the first token').length, 1);
    assert.equal(trunc(PBEGIN + '\n/var/lib/somewhere/keys/deploy/rsa_id\nmore').length, 1);
    assert.equal(trunc(PBEGIN + '\n/var/lib/placeholder/keys/deploy/rsa\nmore').length, 0);
  });
  test('placeholder-shaped words after the first token never suppress the hit', () => {
    for (const word of ['placeholder', 'XXXXXXXX', 'yourkey', 'mykey', 'exampletoken', 'dummysecret']) {
      for (const tail of ['\n' + word, ' ' + word + ' tail', '\nsee /a/b/' + word + '/c/d/e/f/g/h/i/j/k/l/m', '\nlast line ' + word]) {
        assert.equal(trunc(HEAD + KEY + tail).length, 1, JSON.stringify(tail));
      }
    }
  });
  // PR3-B1: trailing text that itself forms a 32+ [A-Za-z0-9+/=] run containing a placeholder word must
  // not suppress the hit. Only the first key-shaped token of the body is the placeholder subject, so
  // these go red if the subject is widened back to every 32+ run of the body.
  test('trailing 32+ runs containing a placeholder word never suppress the hit (PR3-B1)', () => {
    for (const tail of [
      '\nloaded from /var/lib/placeholder/keys/deploy/rsa\n',
      '\ncopied to /srv/app/config/yourkey/production now',
      '\n/var/lib/placeholder/keys/deploy/rsa',
      '\nbacked up under /home/ops/mykey/archive/2026/october ok\n',
      '\nx+placeholder+yyyyyyyyyyyyyyyyyyyyyyyy=z',
      '\nbacked up under /home/ops/someother/archive/2026/october ok\n', // control: no placeholder word
    ]) {
      assert.equal(trunc(HEAD + KEY + tail).length, 1, JSON.stringify(tail));
      assert.ok(scanText(HEAD + KEY + tail).some(f => f.ruleId === 'private-key-block-truncated'), JSON.stringify(tail));
    }
  });
  test('wrapped keys: 32/64 columns masked with and without trailing text; narrow wraps keep base behaviour', () => {
    const wrap = (n) => 'A1b2C3d4'.repeat(40).match(new RegExp(`.{1,${n}}`, 'g')).join('\n');
    for (const n of [32, 64]) {
      for (const tail of ['', '\nend of log.', '\nplaceholder']) {
        assert.equal(trunc(HEAD + wrap(n) + tail).length, 1, `${n}${JSON.stringify(tail)}`);
      }
    }
    for (const n of [24, 31]) {
      assert.equal(trunc(HEAD + wrap(n)).length, 1);
      assert.equal(trunc(HEAD + wrap(n) + '\nend of log.').length, 0);
    }
  });
  test('truncated key followed by a non-private-key END line is still reported (F3)', () => {
    for (const tail of ['\n-----END CERTIFICATE-----', '\n-----END OF LOG-----']) {
      assert.equal(trunc(HEAD + KEY + tail).length, 1, tail);
    }
    assert.equal(trunc(HEAD + KEY + '\n-----END RSA PRIVATE KEY-----').length, 0);
    assert.equal(trunc(PBEGIN + '\n' + keyLines[4] + '\n-----END PRIVATE KEY-----').length, 0);
  });
  test('rule stays linear on the shapes that were quadratic at HEAD (F2)', () => {
    const hostile = [
      (BEGIN + 'Proc-Type:').repeat(8000) + '\n!',
      BEGIN + ('\nProc-Type:' + BEGIN).repeat(8000) + '\n-----END RSA PRIVATE KEY-----',
      (BEGIN + 'DEK-Info: AES-128-CBC,' + '0123456789ABCDEF'.repeat(4)).repeat(8000) + '\n!',
    ];
    rule.regex.lastIndex = 0;
    rule.regex.exec(BEGIN + 'A'.repeat(64)); // warm-up
    for (const h of hostile) {
      const t0 = Date.now();
      rule.regex.lastIndex = 0;
      while (rule.regex.exec(h) !== null) { /* drain */ }
      assert.ok(Date.now() - t0 < 100, `rule took ${Date.now() - t0}ms`);
    }
  });
});
