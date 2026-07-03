/**
 * Unit tests for lib/periodicals.js (LIN-341 / LIN-344 / LIN-354 / LIN-369 / LIN-453 / LIN-371)
 *
 * Run with: node --test tests/unit/periodicals.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { PERIODICALS, getPeriodicals, buildPeriodicalNodes } from '../../lib/periodicals.js';
import { PERIODICALS_PROJECT_ID } from '../../lib/tree.js';

describe('periodicals registry', () => {
  test('seeds the LIN-354 review set plus Drift & Coherence, Comprehension-Debt, Stability, Dependency & Supply-Chain, Recent Headwinds, and Design & Interface (11 templates)', () => {
    assert.strictEqual(PERIODICALS.length, 11);
    assert.strictEqual(getPeriodicals(), PERIODICALS);
  });

  test('contains the nine corrective reviews plus the advisory Stability Review and Recent Headwinds report', () => {
    // Assert by id/title/mode rather than position so the registry can grow.
    const byId = Object.fromEntries(PERIODICALS.map(t => [t.id, t]));

    // id -> [title, mode]. The nine code-surface / supply-chain / interface
    // reviews are 'corrective' (they mint fix-tasks); the Stability Review
    // (LIN-453) and the Recent Headwinds report (LIN-542) are the two 'advisory'
    // entries — trajectory governors that report for a human to act on. The
    // Design & Interface Review (LIN-520) is corrective with an advisory tail:
    // it mints fix-tasks for objective breakage only.
    const expected = {
      'documentation-review': ['Documentation Review', 'corrective'],
      'test-coverage-gap': ['Test Coverage Gap Review', 'corrective'],
      'security-review': ['Security Review', 'corrective'],
      'api-quality': ['API Quality Review', 'corrective'],
      'code-quality': ['Code Quality Review', 'corrective'],
      'drift-coherence': ['Drift & Coherence Review', 'corrective'],
      'comprehension-debt': ['Comprehension-Debt Review', 'corrective'],
      'stability-review': ['Stability Review', 'advisory'],
      'dependency-supply-chain': ['Dependency & Supply-Chain Review', 'corrective'],
      'recent-headwinds': ['Recent Headwinds', 'advisory'],
      'design-review': ['Design & Interface Review', 'corrective']
    };

    for (const [id, [title, mode]] of Object.entries(expected)) {
      const t = byId[id];
      assert.ok(t, `has ${id} entry`);
      assert.strictEqual(t.title, title);
      assert.strictEqual(t.mode, mode);
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
// SELF-CONCLUDE — summarise the report in a Linear comment and close the task.
// Leaving the task In Progress (the original LIN-354 contract) made it loop on
// `review` forever (LIN-386), so the task now ends itself.
//
// One half of the Stage-2 contract — *minting a bounded set of follow-up tasks*
// — is shared only by the seven CORRECTIVE reviews, which turn findings into
// fix-work. The advisory Stability Review (LIN-453) deliberately mints NO
// follow-ups: it is a governor that hands its read to a human. So the
// follow-up-creation assertion is scoped to mode === 'corrective' below, while
// everything else (mint-one-task, read-prior-runs + uncapped report,
// self-conclude, review-only, stays-general) stays universal across the
// registry and locks the contract for new periodicals of either mode.
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

      test('minted task contract: self-conclude, review-only', () => {
        // The task ends itself: Linear summary + close. It must NOT be left open
        // (LIN-386 — leaving it In Progress looped on `review` forever).
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

// Bounded follow-up creation is a CORRECTIVE-mode concern only: those reviews
// turn findings into a capped set of fix-tasks itself (LIN-386), rather than the
// old propose-but-don't-create + leave-In-Progress contract that looped on
// `review` forever. The advisory Stability Review is excluded by mode (it mints
// no follow-ups — see its own specifics block).
describe('corrective reviews: bounded follow-up creation', () => {
  for (const template of PERIODICALS.filter(t => t.mode === 'corrective')) {
    test(`${template.title} mints a capped follow-up set, records every finding`, () => {
      const prompt = template.generatePrompt();
      assert.match(prompt, /follow-up task/i);
      assert.match(prompt, /bounded|cap it|at most/i);
      // Every finding still lands in the report even if not promoted to a task.
      assert.match(prompt, /every finding|not promote|nothing is lost/i);
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

  // LIN-701: the remit widened from coverage-only to coverage AND reliability,
  // with a capability-gated, discovery-style CI/CD instruction. These pins stop
  // it regressing to a coverage-percentage-only review.
  test('widens the remit to coverage AND reliability (not coverage alone)', () => {
    assert.match(prompt, /reliability/i);
    // The two dimensions are named together as the remit, not coverage solo.
    assert.match(prompt, /coverage AND reliability/i);
  });

  test('carries a capability-gated, discovery-style CI/CD reliability instruction', () => {
    // Reliability is discovered from CI/CD history/output when reachable...
    assert.match(prompt, /continuous-integration|CI\/CD/i);
    assert.match(prompt, /reachable/i);
    assert.match(prompt, /discover/i);
    // ...and its absence is an explicit, allowed outcome — fall back to coverage-only.
    assert.match(prompt, /not reachable/i);
    assert.match(prompt, /coverage-only/i);
  });

  test('frames reliability signal as discoverable examples, not an exhaustive/structured list', () => {
    assert.match(prompt, /flaky/i);
    assert.match(prompt, /re-run|retry/i);
    // Examples, explicitly not exhaustive, and not an overstated structured surface.
    assert.match(prompt, /not an exhaustive list/i);
    assert.match(prompt, /structured/i);
  });

  test('carves out sibling territory so CI signal is not double-attributed', () => {
    assert.match(prompt, /Stability Review/);
    assert.match(prompt, /Recent Headwinds/);
    assert.match(prompt, /Dependency & Supply-Chain Review/);
    assert.match(prompt, /double-flag|re-attribute|double-attribute/i);
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

describe('Comprehension-Debt Review specifics (LIN-370)', () => {
  const prompt = PERIODICALS.find(t => t.id === 'comprehension-debt').generatePrompt();

  test('covers the three risk signals: non-obvious why, offsite rationale, cold-modify', () => {
    assert.match(prompt, /comprehension debt/i);
    assert.match(prompt, /non-obvious/i);
    assert.match(prompt, /rationale/i);
    // The why-not-what constraint-comment framing.
    assert.match(prompt, /constraint-comment/i);
    assert.match(prompt, /restates \*\*what\*\*|restate \*\*what\*\*/i);
    // Explanation living offsite in closed tickets / PR bodies.
    assert.match(prompt, /closed ticket|merged PR|offsite/i);
    // The cold-hand-off standard: could a newcomer safely MODIFY the module.
    assert.match(prompt, /cold-hand-off/i);
    assert.match(prompt, /modify/i);
  });

  test('names the altitude difference from the Documentation Review (no double-flagging)', () => {
    assert.match(prompt, /module\/system altitude|module-altitude/i);
    assert.match(prompt, /Documentation Review/);
    assert.match(prompt, /do not re-flag/i);
  });

  test('carries the anti-inflation guard (minimal note, not net-new prose)', () => {
    assert.match(prompt, /inflation/i);
    assert.match(prompt, /minimal constraint-note/i);
    assert.match(prompt, /never net-new prose/i);
    // A legible module is a valid clean result.
    assert.match(prompt, /clean.*result|genuine result/i);
  });

  test('stays general: no specific module surfaces leak in', () => {
    assert.doesNotMatch(prompt, /swim-graph|swim-lanes|roadmap|ship-layout/i);
  });
});

describe('Stability Review specifics (LIN-453)', () => {
  const template = PERIODICALS.find(t => t.id === 'stability-review');
  const prompt = template.generatePrompt();

  test('is the advisory governor (mode + brake framing)', () => {
    assert.strictEqual(template.mode, 'advisory');
    assert.match(prompt, /advisory/i);
    assert.match(prompt, /governor|brake/i);
    // The 0→1 → cadence → settled-state trajectory framing from the ticket.
    assert.match(prompt, /trajectory/i);
    assert.match(prompt, /settled state/i);
    assert.match(prompt, /spiralling|spiral/i);
  });

  test('measures the relative rate of change over time (churn, trend, convergence)', () => {
    assert.match(prompt, /churn/i);
    // Relative, not absolute — the Nagappan-Ball lesson.
    assert.match(prompt, /relative/i);
    assert.match(prompt, /absolute/i);
    assert.match(prompt, /converg/i);
    assert.match(prompt, /rate of change/i);
    // Discriminates healthy stabilisation from stagnation / runaway.
    assert.match(prompt, /stagnation/i);
  });

  test('trend-aware: delta framing, first-run baseline, trend ledger', () => {
    assert.match(prompt, /trend-aware/i);
    assert.match(prompt, /new, unchanged, improved, worsened, or resolved/i);
    assert.match(prompt, /point-in-time snapshot/i);
    assert.match(prompt, /baseline/i);
    assert.match(prompt, /trend ledger/i);
  });

  test('governor divergence: reports for a human decision, mints NO follow-up tasks', () => {
    assert.match(prompt, /human decision|leave the decision|a human/i);
    assert.match(prompt, /no follow-up|not create follow-up/i);
    // Still self-concludes (the universal contract) — covered in the shared loop.
  });

  test('names the altitude difference from Code Quality and Drift & Coherence', () => {
    assert.match(prompt, /Code Quality Review/);
    assert.match(prompt, /Drift & Coherence Review/);
    assert.match(prompt, /do not (re-flag|double-flag)/i);
  });

  test('carries the human-vs-agent caveat: fold in the shape, not the thresholds', () => {
    assert.match(prompt, /human-team/i);
    assert.match(prompt, /threshold/i);
    assert.match(prompt, /shape/i);
  });
});

describe('Dependency & Supply-Chain Review specifics (LIN-371)', () => {
  const prompt = PERIODICALS.find(t => t.id === 'dependency-supply-chain').generatePrompt();

  test('covers the four checks: CVEs, lockfile integrity, new-package provenance, tree growth', () => {
    assert.match(prompt, /supply-chain/i);
    // CVEs via the cheap built-in audit, no new scanner dependency.
    assert.match(prompt, /CVE/);
    assert.match(prompt, /npm audit/);
    assert.match(prompt, /no new scanner dependency/i);
    // Lockfile integrity and unexpected diffs.
    assert.match(prompt, /lockfile integrity/i);
    // New-package provenance signals: registry age, download volume, name-proximity.
    assert.match(prompt, /registry creation date|registry age/i);
    assert.match(prompt, /download volume/i);
    assert.match(prompt, /slopsquatting/i);
    // Dependency-tree growth rate.
    assert.match(prompt, /tree growth|tree-growth/i);
  });

  test('defends the minimal-runtime posture: a new runtime dep is a finding to justify', () => {
    assert.match(prompt, /minimal-runtime/i);
    assert.match(prompt, /vendored/i);
    // New runtime dependency must be a finding requiring justification, not silent.
    assert.match(prompt, /runtime dependency as a finding that must be justified/i);
    assert.match(prompt, /silent/i);
  });

  test('names the altitude difference from the Security Review (no double-flagging CVEs)', () => {
    assert.match(prompt, /provenance/i);
    assert.match(prompt, /Security Review/);
    assert.match(prompt, /do not (re-list|re-flag|double-flag)/i);
  });

  test('trend contract: delta framing, first-run baseline, trend ledger', () => {
    assert.match(prompt, /trend-aware/i);
    assert.match(prompt, /new, unchanged, improved, worsened, or resolved/i);
    assert.match(prompt, /point-in-time snapshot/i);
    assert.match(prompt, /baseline/i);
    assert.match(prompt, /trend ledger/i);
  });

  test('stays general: anchors the ecosystem instrument but leaks no source surfaces', () => {
    // package.json / package-lock.json do not trip the shared .js guard (no word
    // boundary in ".json"), but prefer ecosystem-agnostic manifest/lockfile phrasing.
    assert.match(prompt, /manifest/i);
    assert.match(prompt, /lockfile/i);
    assert.doesNotMatch(prompt, /gitleaks|trufflehog|snyk|dependabot|renovate/i);
  });
});

describe('Recent Headwinds specifics (LIN-542)', () => {
  const template = PERIODICALS.find(t => t.id === 'recent-headwinds');
  const prompt = template.generatePrompt();

  test('is the advisory headwinds report (mode + deliverable framing)', () => {
    assert.strictEqual(template.mode, 'advisory');
    assert.match(prompt, /advisory/i);
    assert.match(prompt, /headwind/i);
    // The deliverable is the ranked remediable list + remediation options.
    assert.match(prompt, /ranked list of remediable headwinds/i);
    assert.match(prompt, /remediation option/i);
    // Oriented to the project's stated direction.
    assert.match(prompt, /north star/i);
  });

  test('covers the full headwind taxonomy (subsumes LIN-374 / LIN-291)', () => {
    assert.match(prompt, /velocity/i);
    assert.match(prompt, /throughput/i);
    assert.match(prompt, /rework/i);
    assert.match(prompt, /defect-escape/i);
    assert.match(prompt, /distraction/i);
    assert.match(prompt, /timeliness/i);
    assert.match(prompt, /direction drift/i);
  });

  test('reports each headwind across nested, relative windows', () => {
    assert.match(prompt, /nested/i);
    assert.match(prompt, /immediate/i);
    assert.match(prompt, /baseline/i);
    // Windows are relative to now, never hard-coded dates.
    assert.match(prompt, /relative to now/i);
    assert.match(prompt, /never hard-coded dates/i);
    // Each headwind carries a per-window trajectory.
    assert.match(prompt, /worsening, steady, or easing/i);
  });

  test('runtime-discovers a velocity/roadmap instrument, named conceptually only', () => {
    // The deterministic trajectory layer is described conceptually, never by symbol.
    assert.match(prompt, /deterministic velocity\/roadmap layer/i);
    assert.match(prompt, /run time/i);
    assert.match(prompt, /fall back/i);
    // The overfitting tripwire: no roadmap internals leak in.
    assert.doesNotMatch(prompt, /buildRoadmapModel|analyzeRoadmap|assessRisks|calculateVelocity/);
  });

  test('trend-aware: delta framing, first-run baseline, trend ledger', () => {
    assert.match(prompt, /trend-aware/i);
    assert.match(prompt, /new, unchanged, improved, worsened, or resolved/i);
    assert.match(prompt, /point-in-time snapshot/i);
    assert.match(prompt, /baseline/i);
    assert.match(prompt, /trend ledger/i);
  });

  test('advisory divergence: reports for a human decision, mints NO follow-up tasks', () => {
    assert.match(prompt, /human decision|leave the decision|a human/i);
    assert.match(prompt, /no follow-up|not create follow-up/i);
    // Still self-concludes (the universal contract) — covered in the shared loop.
  });

  test('names the altitude difference from the Stability Review (no double-flagging churn)', () => {
    assert.match(prompt, /Stability Review/);
    assert.match(prompt, /do not double-flag|do not re-flag/i);
    assert.match(prompt, /churn/i);
  });

  // LIN-899: hardening after the 07-01 run (LIN-896) missed the autopilot
  // session-liveness defect cluster. These pin the gaps that made the miss easy
  // so a future edit can't silently drop them.
  test('defect-escape means cluster-by-subsystem + fix-forward re-filing, not a raw count', () => {
    assert.match(prompt, /cluster the defects by subsystem/i);
    // Reopen isn't the escape signal in a fix-forward repo — adjacent re-filing is.
    assert.match(prompt, /fix-forward/i);
    assert.match(prompt, /adjacent/i);
    // The cluster scan is codebase-wide, not anchored to last run's location.
    assert.match(prompt, /generalise the cluster scan|generalize the cluster scan/i);
  });

  test('names the fix-induced-adjacent-bug (whack-a-mole) cross-class pattern', () => {
    assert.match(prompt, /whack-a-mole/i);
    assert.match(prompt, /induces the .*next.* bug|fix that induces/i);
    // Ranked as one headwind by the pattern, not N healthy fast fixes.
    assert.match(prompt, /one.*headwind|not N healthy fast fixes/i);
  });

  test('separates north-star alignment from forward delivery (reliability fix = rework)', () => {
    assert.match(prompt, /alignment is not the same as forward progress/i);
    assert.match(prompt, /rework, not forward/i);
  });

  test('has an unproven/watch trajectory + aggregate-before-rank + scan-for-new-headwind guards', () => {
    // A closed-but-just-shipped mechanism must not default to "eased".
    assert.match(prompt, /unproven \/ watch|unproven\/watch/i);
    assert.match(prompt, /too fresh/i);
    // Aggregate small/closed/concentrated items before ranking.
    assert.match(prompt, /aggregate before you rank/i);
    // Trend-diff must not bury a genuinely new headwind with no prior row.
    assert.match(prompt, /scan explicitly for headwinds that did not exist last run/i);
  });
});

describe('Design & Interface Review specifics (LIN-520)', () => {
  const template = PERIODICALS.find(t => t.id === 'design-review');
  const prompt = template.generatePrompt();

  test('renders the product rather than reading source, never trusting stale baselines', () => {
    // The first periodical whose evidence is the rendered product.
    assert.match(prompt, /rendered product/i);
    assert.match(prompt, /render, don't read|Render, don't read/i);
    // Fresh desktop + mobile renders, regenerated at run time.
    assert.match(prompt, /desktop and mobile/i);
    assert.match(prompt, /never trust any committed reference renders/i);
    // Capability expressed conceptually, not by artifact/route/tool name.
    assert.match(prompt, /visual-capture mechanism/i);
    // Measured against the shipped design system (named conceptually, not by route).
    assert.match(prompt, /design system the app itself ships/i);
    // Accessibility / performance pass.
    assert.match(prompt, /accessibility and performance pass|accessibility\/performance pass/i);
  });

  test('carries a required first-experience section (John\'s explicit ask)', () => {
    assert.match(prompt, /required first-experience section/i);
    assert.match(prompt, /onboarding/i);
    assert.match(prompt, /empty states/i);
    assert.match(prompt, /primary call-to-action/i);
  });

  test('covers the interface finding classes', () => {
    assert.match(prompt, /visual consistency/i);
    assert.match(prompt, /accessibility/i);
    assert.match(prompt, /responsive and mobile|responsive\/mobile/i);
    assert.match(prompt, /affordance and discoverability|affordance\/discoverability/i);
    assert.match(prompt, /information hierarchy/i);
    assert.match(prompt, /copy and labeling|copy\/labeling/i);
  });

  test('owns the rendered product and defers to the sibling reviews (no double-flag)', () => {
    assert.match(prompt, /Code Quality Review/);
    assert.match(prompt, /API Quality Review/);
    assert.match(prompt, /Documentation Review/);
    assert.match(prompt, /do not double-flag|do not re-flag/i);
  });

  test('corrective with an advisory tail: fix-tasks for objective breakage, subjective stays advisory', () => {
    assert.strictEqual(template.mode, 'corrective');
    // Fix-tasks only for objective breakage.
    assert.match(prompt, /objective breakage/i);
    assert.match(prompt, /contrast failure/i);
    assert.match(prompt, /mobile overflow/i);
    // Subjective design direction is recorded as an advisory tail, not minted.
    assert.match(prompt, /subjective design/i);
    assert.match(prompt, /advisory tail/i);
  });

  test('assesses how the UI looks across the six design-quality finding classes (LIN-567)', () => {
    // Beyond breakage: visual craft is a first-class review dimension, framed
    // within the minimal CLI/terminal aesthetic, never toward generic chrome.
    assert.match(prompt, /visual hierarchy and emphasis/i);
    assert.match(prompt, /layout, spacing and alignment rhythm/i);
    assert.match(prompt, /typography/i);
    assert.match(prompt, /colour and palette as design/i);
    assert.match(prompt, /visual polish and craft details/i);
    assert.match(prompt, /aesthetic coherence and first-impression/i);
    // Judged within the deliberate minimal aesthetic, not against it.
    assert.match(prompt, /minimal CLI\/terminal aesthetic|monospace/i);
    assert.doesNotMatch(prompt, /generic chrome.{0,40}target/i);
  });

  test('advisory tail is a ranked before→after shortlist, with "looks good as-is" valid (LIN-567)', () => {
    // Upgraded from loose taste notes to an actionable, ordered proposal.
    assert.match(prompt, /ranked shortlist of the highest-impact visual improvements/i);
    assert.match(prompt, /before\s*→\s*after/i);
    // Grounded against the shipped design-system baseline, conceptually.
    assert.match(prompt, /design-system reference page the app ships/i);
    // Minimalism-is-working stays a valid explicit verdict.
    assert.match(prompt, /looks good as-is|minimalism is working/i);
    // The design-quality dimensions never mint fix-tasks — advisory only, cap unchanged.
    assert.match(prompt, /advisory half hands these judgement calls to a maintainer and mints nothing/i);
    assert.match(prompt, /objective breakage only|objective breakage/i);
    assert.match(prompt, /top ~3 by severity/i);
  });

  test('stays general: no file literals, route names, or tool names leak in', () => {
    // The shared .js guard already runs; reinforce that no rendering artifact /
    // route / tool name leaks (capabilities are named conceptually).
    assert.doesNotMatch(prompt, /playwright|lighthouse|styleguide\b/i);
    assert.doesNotMatch(prompt, /\/styleguide|set-session|screenshots/i);
  });
});

// TRANSIENT golden-master parity net (LIN-700, beat 1 — REMOVE BEFORE THE PR).
// Captures today's exact `generatePrompt()` output for all 11 builders in a
// frozen fixture and asserts each still matches byte-for-byte. It exists only to
// de-risk the shared-scaffold refactor: it stays GREEN through the pure
// extraction (beat 2, proving the 10-of-11 unrelated text is byte-preserved —
// the gap the token pins cannot see), then reveals exactly the four intended
// wording diffs in beat 3, after which it is retired (a committed full-prompt
// snapshot of 11 frequently-tuned strings would break on every future edit, so
// it is NOT a permanent test — the LIN-700 token pins in the shared loop are).
describe('LIN-700 golden-master (transient — byte-parity net for the refactor)', () => {
  const baseline = JSON.parse(
    readFileSync(new URL('../fixtures/periodicals-golden-master.json', import.meta.url))
  );

  test('the fixture covers every registered periodical', () => {
    assert.strictEqual(Object.keys(baseline).length, PERIODICALS.length);
    for (const t of PERIODICALS) {
      assert.ok(t.id in baseline, `baseline has ${t.id}`);
    }
  });

  for (const template of PERIODICALS) {
    test(`${template.title} output is byte-identical to its captured baseline`, () => {
      assert.deepStrictEqual(template.generatePrompt(), baseline[template.id]);
    });
  }
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
