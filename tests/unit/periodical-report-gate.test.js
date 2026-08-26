import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyPeriodicalTitle,
  buildPeriodicalGateMarker,
  extractPeriodicalGateId,
  hasReportEvidenceComment,
  hasAdversarialReadEvidenceComment,
  checkPeriodicalReportGate
} from '../../lib/periodical-report-gate.js';

describe('slugifyPeriodicalTitle', () => {
  test('lowercases and hyphenates', () => {
    assert.equal(slugifyPeriodicalTitle('Documentation Review'), 'documentation-review');
  });

  test('strips non-alphanumerics, including ampersands', () => {
    assert.equal(slugifyPeriodicalTitle('Drift & Coherence Review'), 'drift-coherence-review');
  });

  test('handles slashes and trims leading/trailing hyphens', () => {
    assert.equal(slugifyPeriodicalTitle('Performance / Scale Review'), 'performance-scale-review');
  });

  test('tolerant of empty/absent input', () => {
    assert.equal(slugifyPeriodicalTitle(''), '');
    assert.equal(slugifyPeriodicalTitle(undefined), '');
  });
});

describe('buildPeriodicalGateMarker / extractPeriodicalGateId round-trip', () => {
  test('the built marker is extractable and carries the slugified id', () => {
    const marker = buildPeriodicalGateMarker('Documentation Review');
    assert.match(marker, /^<!--\s*harbour-periodical-gate\s+id="documentation-review"\s*-->$/);
    assert.equal(extractPeriodicalGateId(marker), 'documentation-review');
  });

  test('extracts from the marker embedded anywhere in a longer description', () => {
    const description = `${buildPeriodicalGateMarker('Code Quality Review')}\n\nSome task body here.`;
    assert.equal(extractPeriodicalGateId(description), 'code-quality-review');
  });

  test('returns null for an ordinary description with no marker', () => {
    assert.equal(extractPeriodicalGateId('Just an ordinary task description.'), null);
  });

  test('tolerant of non-string/absent input', () => {
    assert.equal(extractPeriodicalGateId(null), null);
    assert.equal(extractPeriodicalGateId(undefined), null);
    assert.equal(extractPeriodicalGateId(42), null);
  });
});

describe('hasReportEvidenceComment', () => {
  test('true when a comment cites a GitHub PR URL', () => {
    assert.equal(
      hasReportEvidenceComment([{ body: 'Report merged: https://github.com/JKershaw/LinearViewer/pull/1223' }]),
      true
    );
  });

  test('true for a commit or blob URL too', () => {
    assert.equal(hasReportEvidenceComment([{ body: 'See https://github.com/o/r/commit/abc123' }]), true);
    assert.equal(hasReportEvidenceComment([{ body: 'See https://github.com/o/r/blob/main/docs/reviews/x.md' }]), true);
  });

  test('false for a bare path claim with no URL — the exact shape of the lost reports', () => {
    assert.equal(
      hasReportEvidenceComment([{ body: 'Report: docs/reviews/documentation-review-2026-06-25.md' }]),
      false
    );
  });

  test('false for an unrelated URL (not github.com, or not pull/commit/blob)', () => {
    assert.equal(hasReportEvidenceComment([{ body: 'See https://example.com/pull/1' }]), false);
    assert.equal(hasReportEvidenceComment([{ body: 'See https://github.com/o/r/issues/1' }]), false);
  });

  test('false/tolerant for empty, missing, or malformed comments', () => {
    assert.equal(hasReportEvidenceComment([]), false);
    assert.equal(hasReportEvidenceComment(null), false);
    assert.equal(hasReportEvidenceComment(undefined), false);
    assert.equal(hasReportEvidenceComment([{}, { body: 42 }]), false);
  });
});

// LIN-2323: requires all three fields (verdict, differed-from-top-finding,
// disposition) in the SAME comment body — a partial record (e.g. the verdict
// alone) must not satisfy it, since that is exactly the gap a plan-review pass
// flagged in an earlier draft that only gate-checked the verdict.
describe('hasAdversarialReadEvidenceComment', () => {
  const VERDICT = 'Adversarial second-read verdict: AGREE';
  const DIFFERED = 'Differed from top finding: NO';
  const DISPOSITION = 'Disposition: no change';

  test('true when all three fields appear together in one comment body', () => {
    assert.equal(
      hasAdversarialReadEvidenceComment([{ body: `${VERDICT}. ${DIFFERED}. ${DISPOSITION}.` }]),
      true
    );
  });

  test('true for the DISAGREE verdict too — the predicate is symmetric', () => {
    assert.equal(
      hasAdversarialReadEvidenceComment([
        { body: 'Adversarial second-read verdict: DISAGREE. Differed from top finding: YES. Disposition: escalated.' }
      ]),
      true
    );
  });

  test('every proper subset of the three fields (0, 1, or 2 present) is false — no partial record satisfies it', () => {
    const fields = { verdict: VERDICT, differed: DIFFERED, disposition: DISPOSITION };
    const keys = Object.keys(fields);
    const subsets = [];
    for (let mask = 0; mask < 0b111; mask++) {
      subsets.push(keys.filter((_, i) => mask & (1 << i)));
    }
    assert.equal(subsets.length, 7, 'exercises all seven proper subsets of the three fields');
    for (const subset of subsets) {
      const body = subset.map(k => fields[k]).join('. ');
      assert.equal(
        hasAdversarialReadEvidenceComment([{ body }]),
        false,
        `subset [${subset.join(',')}] must not satisfy the predicate`
      );
    }
    // The exact gap a prior draft's verdict-only check would have missed.
    assert.equal(hasAdversarialReadEvidenceComment([{ body: VERDICT }]), false);
  });

  test('does not credit three separate comments toward one complete record', () => {
    assert.equal(
      hasAdversarialReadEvidenceComment([{ body: VERDICT }, { body: DIFFERED }, { body: DISPOSITION }]),
      false
    );
  });

  test('case-insensitive on all three tokens and their values', () => {
    assert.equal(
      hasAdversarialReadEvidenceComment([
        { body: 'adversarial second-read verdict: agree. differed from top finding: no. disposition: no change.' }
      ]),
      true
    );
  });

  test('false/tolerant for malformed, non-string, empty, or missing comments', () => {
    assert.equal(hasAdversarialReadEvidenceComment([]), false);
    assert.equal(hasAdversarialReadEvidenceComment(null), false);
    assert.equal(hasAdversarialReadEvidenceComment(undefined), false);
    assert.equal(hasAdversarialReadEvidenceComment([{}, { body: 42 }]), false);
    assert.equal(
      hasAdversarialReadEvidenceComment([{ body: 'Disposition: rejected. Adversarial second-read verdict: MAYBE.' }]),
      false
    );
  });
});

describe('checkPeriodicalReportGate', () => {
  const gatedDescription = buildPeriodicalGateMarker('Documentation Review');

  test('does not apply to an ordinary (unmarked) issue', () => {
    const result = checkPeriodicalReportGate({
      description: 'Ordinary task.',
      comments: [],
      targetStateType: 'completed'
    });
    assert.equal(result.applies, false);
    assert.equal(result.ok, true);
    assert.equal(result.periodicalGateId, null);
  });

  test('does not apply when the target state is not completed, even for a marked issue', () => {
    const result = checkPeriodicalReportGate({
      description: gatedDescription,
      comments: [],
      targetStateType: 'started'
    });
    assert.equal(result.applies, false);
    assert.equal(result.ok, true);
    assert.equal(result.periodicalGateId, 'documentation-review');
  });

  test('does not apply when there is no state change at all (targetStateType absent)', () => {
    const result = checkPeriodicalReportGate({ description: gatedDescription, comments: [] });
    assert.equal(result.applies, false);
    assert.equal(result.ok, true);
  });

  test('refuses a marked issue moving to completed with no evidence comment at all', () => {
    const result = checkPeriodicalReportGate({
      description: gatedDescription,
      comments: [{ body: 'Report: docs/reviews/documentation-review-2026-08-23.md' }],
      targetStateType: 'completed'
    });
    assert.equal(result.applies, true);
    assert.equal(result.ok, false);
    assert.equal(result.periodicalGateId, 'documentation-review');
    assert.equal(result.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
    assert.match(result.message, /cannot be marked done/i);
  });

  test('tolerant of missing comments array on a marked+completing issue (refuses with the report-evidence code, does not throw)', () => {
    const result = checkPeriodicalReportGate({ description: gatedDescription, targetStateType: 'completed' });
    assert.equal(result.applies, true);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
  });

  // LIN-2323 — all four combinations of {report evidence present/absent} ×
  // {adversarial evidence complete/incomplete-or-absent}, for a marked issue
  // transitioning to a completed state. The two checks are sequential and
  // independent: report evidence is checked first (unchanged behavior), and
  // only once it passes does the adversarial-read check apply — so a refusal
  // always names the correct one of the two distinct codes.
  describe('the two evidence predicates, all four combinations', () => {
    const REPORT_URL = 'Landed: https://github.com/JKershaw/LinearViewer/pull/1223';
    const ADVERSARIAL_COMPLETE_BODY =
      'Adversarial second-read verdict: AGREE. Differed from top finding: NO. Disposition: no change.';
    const ADVERSARIAL_VERDICT_ONLY_BODY = 'Adversarial second-read verdict: AGREE';

    test('report evidence absent, adversarial evidence absent → refuses with the report-evidence code (checked first)', () => {
      const result = checkPeriodicalReportGate({
        description: gatedDescription,
        comments: [],
        targetStateType: 'completed'
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
    });

    test('report evidence absent, adversarial evidence complete → still refuses with the report-evidence code', () => {
      const result = checkPeriodicalReportGate({
        description: gatedDescription,
        comments: [{ body: ADVERSARIAL_COMPLETE_BODY }],
        targetStateType: 'completed'
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
    });

    test('report evidence present, adversarial evidence absent → refuses with the adversarial-read code', () => {
      const result = checkPeriodicalReportGate({
        description: gatedDescription,
        comments: [{ body: REPORT_URL }],
        targetStateType: 'completed'
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED');
      assert.match(result.message, /adversarial second-read/i);
    });

    test('report evidence present, adversarial evidence incomplete (verdict only) → refuses with the adversarial-read code, not silently accepted', () => {
      const result = checkPeriodicalReportGate({
        description: gatedDescription,
        comments: [{ body: REPORT_URL }, { body: ADVERSARIAL_VERDICT_ONLY_BODY }],
        targetStateType: 'completed'
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED');
    });

    test('report evidence present, adversarial evidence complete (AGREE) → allows, no code on the passing result', () => {
      const result = checkPeriodicalReportGate({
        description: gatedDescription,
        comments: [{ body: REPORT_URL }, { body: ADVERSARIAL_COMPLETE_BODY }],
        targetStateType: 'completed'
      });
      assert.equal(result.applies, true);
      assert.equal(result.ok, true);
      assert.equal(result.code, undefined);
    });

    test('report evidence present, adversarial evidence complete (DISAGREE) → allows too — the gate is symmetric on the verdict', () => {
      const result = checkPeriodicalReportGate({
        description: gatedDescription,
        comments: [
          { body: REPORT_URL },
          { body: 'Adversarial second-read verdict: DISAGREE. Differed from top finding: YES. Disposition: escalated.' }
        ],
        targetStateType: 'completed'
      });
      assert.equal(result.applies, true);
      assert.equal(result.ok, true);
    });

    test('both fields in one single comment also satisfies both predicates', () => {
      const result = checkPeriodicalReportGate({
        description: gatedDescription,
        comments: [{ body: `${REPORT_URL}\n\n${ADVERSARIAL_COMPLETE_BODY}` }],
        targetStateType: 'completed'
      });
      assert.equal(result.ok, true);
    });
  });
});
