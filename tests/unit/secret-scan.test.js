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
import {
  shannonEntropy,
  redactSecret,
  isAllowlistedFixturePath,
  scanText,
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
});

describe('scanDirectory against repository', () => {
  test('scans repository cleanly with 0 false positive findings', () => {
    const result = scanDirectory('.');
    assert.ok(result.scannedFiles > 1000, `Expected > 1000 files, got ${result.scannedFiles}`);
    assert.equal(result.findings.length, 0, `Expected 0 findings in repo, got: ${JSON.stringify(result.findings)}`);
    assert.equal(result.totalHits, 0);
  });
});
