import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyPeriodicalTitle,
  buildPeriodicalGateMarker,
  extractPeriodicalGateId,
  hasReportEvidenceComment,
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

  test('refuses a marked issue moving to completed with no evidence comment', () => {
    const result = checkPeriodicalReportGate({
      description: gatedDescription,
      comments: [{ body: 'Report: docs/reviews/documentation-review-2026-08-23.md' }],
      targetStateType: 'completed'
    });
    assert.equal(result.applies, true);
    assert.equal(result.ok, false);
    assert.equal(result.periodicalGateId, 'documentation-review');
    assert.match(result.message, /cannot be marked done/i);
  });

  test('allows a marked issue moving to completed once a real evidence comment exists', () => {
    const result = checkPeriodicalReportGate({
      description: gatedDescription,
      comments: [{ body: 'Landed: https://github.com/JKershaw/LinearViewer/pull/1223' }],
      targetStateType: 'completed'
    });
    assert.equal(result.applies, true);
    assert.equal(result.ok, true);
  });

  test('tolerant of missing comments array on a marked+completing issue (refuses, does not throw)', () => {
    const result = checkPeriodicalReportGate({ description: gatedDescription, targetStateType: 'completed' });
    assert.equal(result.applies, true);
    assert.equal(result.ok, false);
  });
});
