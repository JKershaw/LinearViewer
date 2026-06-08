/**
 * Unit tests for lib/periodicals.js (LIN-341)
 *
 * Run with: node --test tests/unit/periodicals.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PERIODICALS, getPeriodicals, buildPeriodicalNodes } from '../../lib/periodicals.js';
import { PERIODICALS_PROJECT_ID } from '../../lib/tree.js';

describe('periodicals registry', () => {
  test('seeds the corrective templates broken out under LIN-344', () => {
    assert.strictEqual(PERIODICALS.length, 4);
    assert.strictEqual(getPeriodicals(), PERIODICALS);
  });

  test('contains Documentation Review, Test Coverage Gap, Secrets & Credential Scan, and Prompt-Injection Surface Review (all corrective)', () => {
    // Assert by id/title/mode rather than position so the registry can grow.
    const byId = Object.fromEntries(PERIODICALS.map(t => [t.id, t]));

    const doc = byId['documentation-review'];
    assert.ok(doc, 'has Documentation Review entry');
    assert.strictEqual(doc.title, 'Documentation Review');
    assert.strictEqual(doc.mode, 'corrective');
    assert.strictEqual(typeof doc.generatePrompt, 'function');

    const cov = byId['test-coverage-gap'];
    assert.ok(cov, 'has Test Coverage Gap Review entry');
    assert.strictEqual(cov.title, 'Test Coverage Gap Review');
    assert.strictEqual(cov.mode, 'corrective');
    assert.strictEqual(typeof cov.generatePrompt, 'function');

    const sec = byId['secrets-scan'];
    assert.ok(sec, 'has Secrets & Credential Scan entry');
    assert.strictEqual(sec.title, 'Secrets & Credential Scan');
    assert.strictEqual(sec.mode, 'corrective');
    assert.strictEqual(typeof sec.generatePrompt, 'function');

    const inj = byId['prompt-injection-review'];
    assert.ok(inj, 'has Prompt-Injection Surface Review entry');
    assert.strictEqual(inj.title, 'Prompt-Injection Surface Review');
    assert.strictEqual(inj.mode, 'corrective');
    assert.strictEqual(typeof inj.generatePrompt, 'function');
  });

  test('every template carries the full shape, incl. mode/cadence/lastRunAt', () => {
    for (const t of PERIODICALS) {
      assert.ok(typeof t.id === 'string' && t.id.length > 0);
      assert.ok(typeof t.title === 'string' && t.title.length > 0);
      assert.ok(['corrective', 'advisory'].includes(t.mode));
      // Carried even though nothing consumes them yet (v1).
      assert.ok('cadence' in t);
      assert.ok('lastRunAt' in t);
      assert.strictEqual(typeof t.generatePrompt, 'function');
    }
  });
});

describe('Documentation Review generatePrompt()', () => {
  const prompt = PERIODICALS[0].generatePrompt();

  test('returns a non-trivial string', () => {
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 200);
  });

  test('is a task-generation prompt: create a task, then stop (does not do the review)', () => {
    // Names the periodical and its domain.
    assert.match(prompt, /Documentation Review/);
    assert.match(prompt, /documentation/i);
    // Instructs to create a Linear task and hand off rather than do the work here.
    assert.match(prompt, /Linear task/i);
    assert.match(prompt, /then stop|do not do the review/i);
  });

  test('stays general: no hard-coded proxy mechanics or doc-surface specifics', () => {
    // Proxy mechanics live in the appended +proxy guide, not the template.
    assert.doesNotMatch(prompt, /POST \/api\/proxy/);
    assert.doesNotMatch(prompt, /projectId/);
    assert.doesNotMatch(prompt, /GET \/api\/proxy/);
    // Doc surfaces are discovered by grounding at run time, not baked in here.
    assert.doesNotMatch(prompt, /formatStalenessCheck/);
    assert.doesNotMatch(prompt, /llms\.txt/);
    assert.doesNotMatch(prompt, /CLAUDE\.md/);
  });
});

describe('Test Coverage Gap Review generatePrompt()', () => {
  const prompt = PERIODICALS.find(t => t.id === 'test-coverage-gap').generatePrompt();

  test('returns a non-trivial string', () => {
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 200);
  });

  test('is a task-generation prompt: create a task, then stop (does not write the tests)', () => {
    // Names the periodical and its domain.
    assert.match(prompt, /Test Coverage Gap Review/);
    assert.match(prompt, /coverage/i);
    // Grounds against the objective native coverage source (no new dependency).
    assert.match(prompt, /--experimental-test-coverage/);
    // Instructs to mint one Linear task and hand off rather than do the work here.
    assert.match(prompt, /Linear task/i);
    assert.match(prompt, /then stop|do not write the tests/i);
    // Carries the anti-coverage-theater quality bar (behavioral over structural).
    assert.match(prompt, /behavioral/i);
    assert.match(prompt, /theater/i);
  });

  test('stays general: no hard-coded proxy mechanics or specific module surfaces', () => {
    // Proxy mechanics live in the appended +proxy guide, not the template.
    assert.doesNotMatch(prompt, /POST \/api\/proxy/);
    assert.doesNotMatch(prompt, /GET \/api\/proxy/);
    assert.doesNotMatch(prompt, /projectId/);
    // The gap is discovered from the live coverage report, not baked in here:
    // no concrete module/file surfaces leak into the template.
    assert.doesNotMatch(prompt, /proxy-tokens/);
    assert.doesNotMatch(prompt, /token-refresh/);
    assert.doesNotMatch(prompt, /free-tier-store/);
    assert.doesNotMatch(prompt, /openrouter/);
    assert.doesNotMatch(prompt, /\.js\b/);
  });
});

describe('Secrets & Credential Scan generatePrompt()', () => {
  const prompt = PERIODICALS.find(t => t.id === 'secrets-scan').generatePrompt();

  test('returns a non-trivial string', () => {
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 200);
  });

  test('is a task-generation prompt: mint one task, then stop (does not remediate)', () => {
    // Names the periodical and its domain.
    assert.match(prompt, /Secrets & Credential Scan/);
    assert.match(prompt, /credential/i);
    // Grounds against the objective, git-based reference over tree + history (no new dependency).
    assert.match(prompt, /git grep/);
    assert.match(prompt, /git log -p/);
    assert.match(prompt, /history/i);
    // Instructs to mint one Linear task and hand off rather than do the work here.
    assert.match(prompt, /Linear task/i);
    assert.match(prompt, /mint one/i);
    assert.match(prompt, /then stop/i);
  });

  test('carries the anti-report-cleaning-theater remediation bar (remove + rotate, not suppress)', () => {
    // Names the defeat-theater failure mode for this periodical.
    assert.match(prompt, /theater/i);
    // Forbids making the finding disappear instead of neutralising it.
    assert.match(prompt, /suppress|allowlist|ignore-list/i);
    // The only valid resolution is remove-from-tracked-content AND rotate/revoke at source.
    assert.match(prompt, /remove/i);
    assert.match(prompt, /rotate|revoke/i);
    // History-aware: flags history-rewrite / secret-purge as a human-decision item.
    assert.match(prompt, /human-decision|human decision/i);
  });

  test('stays general: no hard-coded scanner, pattern set, or leaked secret/file literals', () => {
    // Proxy mechanics live in the appended +proxy guide, not the template.
    assert.doesNotMatch(prompt, /POST \/api\/proxy/);
    assert.doesNotMatch(prompt, /GET \/api\/proxy/);
    assert.doesNotMatch(prompt, /projectId/);
    // No third-party scanner is named (would add a dependency).
    assert.doesNotMatch(prompt, /gitleaks|trufflehog/i);
    // The pattern set is derived at run time, not baked in: no repo-specific
    // provider prefixes or concrete cloud literals leak into the template.
    assert.doesNotMatch(prompt, /lin_api_|lin_oauth_/);
    assert.doesNotMatch(prompt, /AKIA/);
    // No concrete module/file surfaces leak in.
    assert.doesNotMatch(prompt, /\.js\b/);
  });
});

describe('Prompt-Injection Surface Review generatePrompt()', () => {
  const prompt = PERIODICALS.find(t => t.id === 'prompt-injection-review').generatePrompt();

  test('returns a non-trivial string', () => {
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 200);
  });

  test('is a task-generation prompt: mint one task, then stop (does not build the mitigation)', () => {
    // Names the periodical and its domain.
    assert.match(prompt, /Prompt-Injection Surface Review/);
    assert.match(prompt, /injection/i);
    // Instructs to mint one Linear task and hand off rather than do the work here.
    assert.match(prompt, /Linear task/i);
    assert.match(prompt, /mint one/i);
    assert.match(prompt, /then stop/i);
  });

  test('frames the gap as a data/code boundary and forbids a model-instruction-only fix', () => {
    // The threat: attacker-influenceable ticket content reaching worker prompts.
    assert.match(prompt, /attacker-influenceable/i);
    assert.match(prompt, /untrusted/i);
    // The mitigation bar: a real data/code boundary, not a stronger instruction.
    assert.match(prompt, /data\/code/i);
    assert.match(prompt, /data, not instructions/i);
    // A model instruction alone is explicitly not an acceptable resolution.
    assert.match(prompt, /not.*(acceptable|a guarantee|count as)|instruction alone/i);
    // Anchors against the shell boundary that already exists as the reference.
    assert.match(prompt, /shell/i);
  });

  test('stays general: no hard-coded proxy mechanics, file paths, or cited symbols', () => {
    // Proxy mechanics live in the appended +proxy guide, not the template.
    assert.doesNotMatch(prompt, /POST \/api\/proxy/);
    assert.doesNotMatch(prompt, /GET \/api\/proxy/);
    assert.doesNotMatch(prompt, /projectId/);
    // The seam is traced from the live code at dispatch time, not baked in here:
    // no concrete file/module surfaces or cited symbol names leak into the template.
    assert.doesNotMatch(prompt, /\.js\b/);
    assert.doesNotMatch(prompt, /formatIssueContext/);
    assert.doesNotMatch(prompt, /formatCommentsForPrompt/);
    assert.doesNotMatch(prompt, /meta-prompt-template/);
  });
});

describe('buildPeriodicalNodes()', () => {
  const nodes = buildPeriodicalNodes();

  test('produces one forest node per template', () => {
    assert.strictEqual(nodes.length, PERIODICALS.length);
  });

  test('each node is render-shaped (issue + children + depth + periodical)', () => {
    for (const node of nodes) {
      assert.ok(node.issue, 'has issue');
      assert.strictEqual(node.depth, 0);
      assert.deepStrictEqual(node.children, []);
      // Synthetic, app-only row: no Linear url/identifier.
      assert.strictEqual(node.issue.url, undefined);
      assert.strictEqual(node.issue.identifier, null);
      assert.ok(node.periodical, 'carries periodical metadata');
      assert.ok(node.periodical.prompt.length > 0, 'carries rendered prompt');
      assert.ok(['corrective', 'advisory'].includes(node.periodical.mode));
    }
  });

  test('node ids are not real-project shaped (stay under the synthetic group)', () => {
    // The group id itself is synthetic; node ids are template ids (no slashes/UUIDs).
    assert.strictEqual(PERIODICALS_PROJECT_ID, '__periodicals__');
    assert.strictEqual(nodes[0].issue.id, 'documentation-review');
  });
});
