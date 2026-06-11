/**
 * Unit tests for lib/periodicals.js (LIN-341 / LIN-344 / LIN-354 / LIN-369)
 *
 * Run with: node --test tests/unit/periodicals.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PERIODICALS, getPeriodicals, buildPeriodicalNodes } from '../../lib/periodicals.js';
import { PERIODICALS_PROJECT_ID } from '../../lib/tree.js';

describe('periodicals registry', () => {
  test('seeds the LIN-354 review set plus Drift & Coherence (6 templates)', () => {
    assert.strictEqual(PERIODICALS.length, 6);
    assert.strictEqual(getPeriodicals(), PERIODICALS);
  });

  test('contains Documentation, Test Coverage, Security, API Quality, Code Quality, and Drift & Coherence reviews', () => {
    // Assert by id/title/mode rather than position so the registry can grow.
    const byId = Object.fromEntries(PERIODICALS.map(t => [t.id, t]));

    const expected = {
      'documentation-review': 'Documentation Review',
      'test-coverage-gap': 'Test Coverage Gap Review',
      'security-review': 'Security Review',
      'api-quality': 'API Quality Review',
      'code-quality': 'Code Quality Review',
      'drift-coherence': 'Drift & Coherence Review'
    };

    for (const [id, title] of Object.entries(expected)) {
      const t = byId[id];
      assert.ok(t, `has ${id} entry`);
      assert.strictEqual(t.title, title);
      assert.strictEqual(t.mode, 'corrective');
      assert.strictEqual(typeof t.generatePrompt, 'function');
    }
  });

  test('consolidated the standalone secrets-scan and prompt-injection periodicals (LIN-354)', () => {
    // The broad Security Review absorbed both; they no longer exist as their
    // own registry entries.
    const ids = new Set(PERIODICALS.map(t => t.id));
    assert.ok(!ids.has('secrets-scan'), 'secrets-scan folded into security-review');
    assert.ok(!ids.has('prompt-injection-review'), 'prompt-injection-review folded into security-review');
  });

  test('every template carries the full shape, incl. mode/cadence/lastRunAt', () => {
    for (const t of PERIODICALS) {
      assert.ok(typeof t.id === 'string' && t.id.length > 0);
      assert.ok(typeof t.title === 'string' && t.title.length > 0);
      assert.ok(['corrective', 'advisory'].includes(t.mode));
      // Carried even though nothing consumes them yet.
      assert.ok('cadence' in t);
      assert.ok('lastRunAt' in t);
      assert.strictEqual(typeof t.generatePrompt, 'function');
    }
  });
});

// The shared two-stage "meta" contract (LIN-354, concluded under LIN-386):
// Stage 1 (the periodical prompt itself) is a *task-generation* step — research
// the repo and mint ONE project-specific review task, then stop. The minted
// task's description, which the prompt dictates, carries the Stage-2 review
// contract: read prior runs, produce an uncapped severity-ranked report, then
// SELF-CONCLUDE — mint a bounded set of high-severity follow-up tasks, summarise
// the report in a Linear comment, and close the task. Leaving the task In
// Progress (the original LIN-354 contract) made it loop on `review` forever
// (LIN-386), so the task now ends itself. Asserting this over the whole registry
// locks the contract for new periodicals too.
describe('shared two-stage contract (all periodicals)', () => {
  for (const template of PERIODICALS) {
    describe(template.title, () => {
      const prompt = template.generatePrompt();

      test('returns a non-trivial string naming the periodical', () => {
        assert.strictEqual(typeof prompt, 'string');
        assert.ok(prompt.length > 200);
        assert.ok(prompt.includes(template.title), 'names its own title');
      });

      test('Stage 1: mints one review task and stops (the task is the deliverable)', () => {
        assert.match(prompt, /Linear task/i);
        assert.match(prompt, /mint \*\*one\*\*|mint one/i);
        assert.match(prompt, /then stop/i);
        // The periodical does not do the review itself.
        assert.match(prompt, /deliverable is that task/i);
      });

      test('minted task contract: read prior runs, uncapped report', () => {
        assert.match(prompt, /\breport\b/i);
        assert.match(prompt, /previous run|prior run|earlier report/i);
        // No forced single finding / no make-work.
        assert.match(prompt, /nothing, one thing, or several|no fixed number/i);
        assert.match(prompt, /make-work/i);
      });

      test('minted task contract: bounded follow-up creation, self-conclude, review-only', () => {
        // The task creates a CAPPED set of follow-up tasks itself (LIN-386),
        // rather than the old propose-but-don't-create + leave-In-Progress
        // contract that looped on `review` forever.
        assert.match(prompt, /follow-up task/i);
        assert.match(prompt, /bounded|cap it|at most/i);
        // Every finding still lands in the report even if not promoted to a task.
        assert.match(prompt, /every finding|not promote|nothing is lost/i);
        // The task ends itself: Linear summary + close. It must NOT be left open.
        assert.match(prompt, /conclude this task|move the task to its done|done\/completed state/i);
        assert.match(prompt, /summary of the report/i);
        assert.match(prompt, /do not leave it open|left open/i);
        // Producing the report still changes no code.
        assert.match(prompt, /review-only/i);
      });

      test('stays general: no proxy mechanics, file literals, or baked-in report location', () => {
        // Proxy mechanics live in the appended +proxy guide, not the template.
        assert.doesNotMatch(prompt, /POST \/api\/proxy/);
        assert.doesNotMatch(prompt, /GET \/api\/proxy/);
        assert.doesNotMatch(prompt, /projectId/);
        // No concrete source-file surfaces leak in.
        assert.doesNotMatch(prompt, /\.js\b/);
        // The report location is discovered at run time, never hard-coded.
        assert.doesNotMatch(prompt, /save_comment|home issue/i);
      });
    });
  }
});

describe('Documentation Review specifics', () => {
  const prompt = PERIODICALS.find(t => t.id === 'documentation-review').generatePrompt();

  test('covers drift plus the broadened README / inline-comment / API-doc scope', () => {
    assert.match(prompt, /documentation/i);
    assert.match(prompt, /drift/i);
    assert.match(prompt, /README/);
    assert.match(prompt, /inline comment/i);
    // Subtractive-quality discipline against doc inflation.
    assert.match(prompt, /subtractive/i);
    assert.match(prompt, /inflation/i);
  });

  test('stays general: no doc-surface specifics baked in', () => {
    assert.doesNotMatch(prompt, /llms\.txt/);
    assert.doesNotMatch(prompt, /CLAUDE\.md/);
    assert.doesNotMatch(prompt, /formatStalenessCheck/);
  });
});

describe('Test Coverage Gap Review specifics', () => {
  const prompt = PERIODICALS.find(t => t.id === 'test-coverage-gap').generatePrompt();

  test('grounds in native coverage and carries the anti-theater bar', () => {
    assert.match(prompt, /coverage/i);
    assert.match(prompt, /--experimental-test-coverage/);
    assert.match(prompt, /behavioral/i);
    assert.match(prompt, /theater/i);
  });

  test('stays general: no specific module surfaces leak in', () => {
    assert.doesNotMatch(prompt, /proxy-tokens/);
    assert.doesNotMatch(prompt, /free-tier-store/);
    assert.doesNotMatch(prompt, /openrouter/i);
  });
});

describe('Security Review specifics', () => {
  const prompt = PERIODICALS.find(t => t.id === 'security-review').generatePrompt();

  test('absorbs the secrets scan: git tree + history, remove-and-rotate, no scanner dep', () => {
    assert.match(prompt, /credential/i);
    assert.match(prompt, /git grep/);
    assert.match(prompt, /git log -p/);
    assert.match(prompt, /history/i);
    assert.match(prompt, /rotat|revok/i);
  });

  test('absorbs the prompt-injection review: trust boundary, not a mere instruction', () => {
    assert.match(prompt, /injection/i);
    assert.match(prompt, /trust boundar/i);
    // The data/code boundary framing: input carried as data vs interpolated as code.
    assert.match(prompt, /as \*\*data\*\*/i);
    assert.match(prompt, /interpolates it as code/i);
    assert.match(prompt, /aspirational guard/i);
  });

  test('covers the broad OWASP-style classes', () => {
    assert.match(prompt, /access control/i);
    assert.match(prompt, /isolation/i);
    assert.match(prompt, /blast radius/i);
  });

  test('stays general: no scanner named, no leaked secret/symbol literals', () => {
    assert.doesNotMatch(prompt, /gitleaks|trufflehog/i);
    assert.doesNotMatch(prompt, /lin_api_|lin_oauth_/);
    assert.doesNotMatch(prompt, /AKIA/);
    assert.doesNotMatch(prompt, /formatIssueContext/);
  });
});

describe('API Quality Review specifics', () => {
  const prompt = PERIODICALS.find(t => t.id === 'api-quality').generatePrompt();

  test('covers design consistency, validation, and error handling', () => {
    assert.match(prompt, /API/);
    assert.match(prompt, /consisten/i);
    assert.match(prompt, /validat/i);
    assert.match(prompt, /error handling/i);
    assert.match(prompt, /status code/i);
  });

  test("uses the repo's own convention as the reference, not an imported ideal", () => {
    assert.match(prompt, /own dominant convention|established pattern/i);
  });
});

describe('Code Quality Review specifics', () => {
  const prompt = PERIODICALS.find(t => t.id === 'code-quality').generatePrompt();

  test('covers complexity, duplication, and maintainability with no new tooling', () => {
    assert.match(prompt, /complexity/i);
    assert.match(prompt, /duplicat/i);
    assert.match(prompt, /maintainab/i);
    assert.match(prompt, /no new tooling|introduce no new/i);
    assert.match(prompt, /risk . churn|risk × churn|critical path/i);
  });

  test('guards against cosmetic-churn theater', () => {
    assert.match(prompt, /theater/i);
    assert.match(prompt, /cosmetic/i);
  });
});

describe('Drift & Coherence Review specifics (LIN-369)', () => {
  const prompt = PERIODICALS.find(t => t.id === 'drift-coherence').generatePrompt();

  test('covers duplication, convention fragmentation, and dependency direction', () => {
    assert.match(prompt, /duplicat/i);
    assert.match(prompt, /convention fragmentation/i);
    assert.match(prompt, /dependency direction/i);
    assert.match(prompt, /layer/i);
    assert.match(prompt, /introducing no new tooling|no new tooling/i);
  });

  test('trend contract: delta framing, first-run baseline, trend ledger', () => {
    assert.match(prompt, /trend-aware/i);
    // Findings are deltas vs the prior run, never a snapshot.
    assert.match(prompt, /new, unchanged, improved, worsened, or resolved/i);
    assert.match(prompt, /point-in-time snapshot/i);
    // First run states it is the baseline.
    assert.match(prompt, /baseline/i);
    // Report-format anchor for the next run's comparison.
    assert.match(prompt, /trend ledger/i);
  });

  test('names the altitude difference from the Code Quality Review (no double-flagging)', () => {
    assert.match(prompt, /cross-cutting/i);
    assert.match(prompt, /Code Quality Review/);
    assert.match(prompt, /do not re-flag/i);
  });

  test('severity bar is a concrete cost, with the anti-churn guard', () => {
    assert.match(prompt, /concrete cost/i);
    assert.match(prompt, /not a style preference/i);
    assert.match(prompt, /cosmetic churn/i);
  });

  test('stays implementation-agnostic: no prescribed location for prior reports', () => {
    // Prior runs are discovered, not looked up at a hard-coded place.
    assert.match(prompt, /discover where they are recorded/i);
    assert.doesNotMatch(prompt, /search Linear by|comments on the minted task/i);
    // No repo-specific symbols leak in.
    assert.doesNotMatch(prompt, /escapeHtml|workspace-api|jsonError/);
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
