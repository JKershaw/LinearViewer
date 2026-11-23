import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasReportEvidence,
  hasAdversarialReadEvidence,
  checkPeriodicalReportGate
} from '../../lib/periodical-report-gate.js';
import {
  slugifyPeriodicalTitle,
  buildPeriodicalGateMarker,
  extractPeriodicalGateId
} from '../../lib/periodicals.js';

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

// LIN-4533: the gate reads records. A run posts no comment: its report's change is its landing (the PR URLs of the
// task's change records), and its second read is a verdict record (judgement adversarial-read) on that change.
const PR = 'https://github.com/JKershaw/LinearViewer/pull/1223';

describe('hasReportEvidence', () => {
  test('a landing that names a GitHub pull, commit or blob URL is evidence', () => {
    assert.equal(hasReportEvidence([PR]), true);
    assert.equal(hasReportEvidence(['https://github.com/o/r/commit/abc123']), true);
    assert.equal(hasReportEvidence(['https://github.com/o/r/blob/main/docs/reviews/x.md']), true);
  });

  test('a file path, a non-GitHub URL, or an issue URL is not', () => {
    assert.equal(hasReportEvidence(['docs/reviews/documentation-review-2026-06-25.md']), false);
    assert.equal(hasReportEvidence(['https://example.com/pull/1']), false);
    assert.equal(hasReportEvidence(['https://github.com/o/r/issues/1']), false);
  });

  test('an empty, absent or unread landing is not evidence (never read as present)', () => {
    assert.equal(hasReportEvidence([]), false);
    assert.equal(hasReportEvidence(null), false);
    assert.equal(hasReportEvidence(undefined), false);
    assert.equal(hasReportEvidence([null, 42]), false);
  });
});

describe('hasAdversarialReadEvidence', () => {
  const COMPLETE = { outcome: 'agree', differed: 'no', disposition: 'no change', on: [PR] };

  test('a verdict on a landed PR with outcome, differed and disposition is complete, whichever way it agrees', () => {
    assert.equal(hasAdversarialReadEvidence(COMPLETE, [PR]), true);
    assert.equal(hasAdversarialReadEvidence({ ...COMPLETE, outcome: 'disagree', differed: 'yes', disposition: 'escalated' }, [PR]), true);
    assert.equal(hasAdversarialReadEvidence({ ...COMPLETE, disposition: 'fixed in place' }, [PR]), true);
  });

  test('a missing field, or one outside its words, is not complete', () => {
    for (const bad of [{ outcome: null }, { outcome: 'maybe' }, { differed: null }, { differed: 'sometimes' }, { disposition: null }, { disposition: 'rejected' }]) {
      assert.equal(hasAdversarialReadEvidence({ ...COMPLETE, ...bad }, [PR]), false, JSON.stringify(bad));
    }
  });

  test('a verdict that judges no PR of the landing does not count', () => {
    assert.equal(hasAdversarialReadEvidence({ ...COMPLETE, on: ['https://github.com/o/r/pull/9'] }, [PR]), false);
    assert.equal(hasAdversarialReadEvidence({ ...COMPLETE, on: [] }, [PR]), false);
  });

  test('no read, or no landing read, is not evidence', () => {
    assert.equal(hasAdversarialReadEvidence(null, [PR]), false);
    assert.equal(hasAdversarialReadEvidence(undefined, [PR]), false);
    assert.equal(hasAdversarialReadEvidence(COMPLETE, null), false);
  });
});

describe('checkPeriodicalReportGate', () => {
  const gatedDescription = buildPeriodicalGateMarker('Documentation Review');
  const COMPLETE = { outcome: 'agree', differed: 'no', disposition: 'no change', on: [PR] };

  test('does not apply to an ordinary (unmarked) issue', () => {
    const result = checkPeriodicalReportGate({ description: 'Ordinary task.', landing: [], targetStateType: 'completed' });
    assert.equal(result.applies, false);
    assert.equal(result.ok, true);
    assert.equal(result.periodicalGateId, null);
  });

  test('does not apply when the target state is not completed, even for a marked issue', () => {
    const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [], targetStateType: 'started' });
    assert.equal(result.applies, false);
    assert.equal(result.ok, true);
    assert.equal(result.periodicalGateId, 'documentation-review');
  });

  test('does not apply when there is no state change at all (targetStateType absent)', () => {
    const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [] });
    assert.equal(result.applies, false);
    assert.equal(result.ok, true);
  });

  test('refuses a marked issue moving to completed with no change record naming a PR', () => {
    const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [], targetStateType: 'completed' });
    assert.equal(result.applies, true);
    assert.equal(result.ok, false);
    assert.equal(result.periodicalGateId, 'documentation-review');
    assert.equal(result.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
    assert.match(result.message, /cannot be marked done/i);
    assert.match(result.message, /kind change/);
  });

  test('a standing that could not be read (landing null) refuses with the report-evidence code, and does not throw', () => {
    const result = checkPeriodicalReportGate({ description: gatedDescription, targetStateType: 'completed' });
    assert.equal(result.applies, true);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
    // finding-afaea57d: an outage is not a missing record, so it does not tell the caller to write a change record.
    assert.match(result.message, /could not be read/);
    assert.doesNotMatch(result.message, /kind change/);
  });

  test('a comment is not evidence: a PR in a comment does not stand in for the change record', () => {
    // The gate takes no comments at all (LIN-4533), so a PR URL written in a comment cannot satisfy it.
    const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [], adversarialRead: COMPLETE, targetStateType: 'completed', comments: [{ body: `Landed: ${PR}` }] });
    assert.equal(result.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
  });

  // LIN-2323 / LIN-4533 — the two checks run in order: report evidence first, then the adversarial read.
  describe('the two evidence checks, all four combinations', () => {
    test('report evidence absent, adversarial read absent → refuses with the report-evidence code (checked first)', () => {
      const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [], adversarialRead: null, targetStateType: 'completed' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
    });

    test('report evidence absent, adversarial read complete → still refuses with the report-evidence code', () => {
      const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [], adversarialRead: COMPLETE, targetStateType: 'completed' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
    });

    test('report evidence present, adversarial read absent → refuses with the adversarial-read code', () => {
      const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [PR], adversarialRead: null, targetStateType: 'completed' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED');
      assert.match(result.message, /adversarial-read/);
    });

    test('report evidence present, adversarial read incomplete (no differed) → refuses with the adversarial-read code', () => {
      const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [PR], adversarialRead: { ...COMPLETE, differed: null }, targetStateType: 'completed' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED');
    });

    test('report evidence present, adversarial read complete (agree) → allows, no code on the passing result', () => {
      const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [PR], adversarialRead: COMPLETE, targetStateType: 'completed' });
      assert.equal(result.applies, true);
      assert.equal(result.ok, true);
      assert.equal(result.code, undefined);
    });

    test('report evidence present, adversarial read complete (disagree) → allows too — the gate is symmetric on the verdict', () => {
      const result = checkPeriodicalReportGate({ description: gatedDescription, landing: [PR], adversarialRead: { ...COMPLETE, outcome: 'disagree', differed: 'yes', disposition: 'escalated' }, targetStateType: 'completed' });
      assert.equal(result.applies, true);
      assert.equal(result.ok, true);
    });
  });
});
