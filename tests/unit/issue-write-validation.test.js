// =============================================================================
// Shared issue-write validation seam — lib/issue-write-validation.js (LIN-1552)
// =============================================================================
//
// Proves the extracted validator + constants against the SPEC (not merely the
// current implementation): length caps, control-char guard, priority range, and
// a PARITY oracle that replicates the proxy route's ORIGINAL inline validation
// so the extraction is shown to preserve the accept/reject decisions + messages.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_COMMENT_LENGTH,
  DANGEROUS_CHARS_REGEX,
  MIN_PRIORITY,
  MAX_PRIORITY,
  isValidPriority,
  validateIssueWriteFields,
} from '../../lib/issue-write-validation.js';

describe('issue-write-validation: exported constants', () => {
  test('length caps match the documented values', () => {
    assert.strictEqual(MAX_NAME_LENGTH, 1000);
    assert.strictEqual(MAX_DESCRIPTION_LENGTH, 100000);
    assert.strictEqual(MAX_COMMENT_LENGTH, 50000);
  });

  test('priority range constants are 0..4', () => {
    assert.strictEqual(MIN_PRIORITY, 0);
    assert.strictEqual(MAX_PRIORITY, 4);
  });

  test('DANGEROUS_CHARS_REGEX flags null bytes / control chars but not normal text', () => {
    assert.strictEqual(DANGEROUS_CHARS_REGEX.test('hello world'), false);
    assert.strictEqual(DANGEROUS_CHARS_REGEX.test('multi\nline\ttext'), false); // \n \t are allowed
    assert.strictEqual(DANGEROUS_CHARS_REGEX.test('bad\x00null'), true);
    assert.strictEqual(DANGEROUS_CHARS_REGEX.test('bell\x07here'), true);
    assert.strictEqual(DANGEROUS_CHARS_REGEX.test('del\x7Fchar'), true);
  });
});

describe('isValidPriority (range primitive)', () => {
  test('accepts the 0 and 4 boundaries and interior values', () => {
    assert.strictEqual(isValidPriority(0), true);
    assert.strictEqual(isValidPriority(4), true);
    assert.strictEqual(isValidPriority(2), true);
  });

  test('rejects out-of-range, non-integer, and non-number priorities', () => {
    assert.strictEqual(isValidPriority(-1), false);
    assert.strictEqual(isValidPriority(5), false);
    assert.strictEqual(isValidPriority(2.5), false);
    assert.strictEqual(isValidPriority('3'), false);
    assert.strictEqual(isValidPriority(null), false);
    assert.strictEqual(isValidPriority(undefined), false);
  });
});

describe('validateIssueWriteFields — accept', () => {
  test('create: valid title + description + priority passes (null)', () => {
    assert.strictEqual(
      validateIssueWriteFields({ title: 'Fix the bug', description: 'a body', priority: 2 }, { mode: 'create', validatePriority: true }),
      null,
    );
  });

  test('update: any single valid field passes (null)', () => {
    assert.strictEqual(validateIssueWriteFields({ title: 'new title' }, { mode: 'update' }), null);
    assert.strictEqual(validateIssueWriteFields({ description: 'new body' }, { mode: 'update' }), null);
    assert.strictEqual(validateIssueWriteFields({ priority: 0 }, { mode: 'update', validatePriority: true }), null);
    assert.strictEqual(validateIssueWriteFields({}, { mode: 'update' }), null); // no fields → no field error
  });

  test('boundary lengths (exactly at the cap) are accepted', () => {
    assert.strictEqual(validateIssueWriteFields({ title: 'x'.repeat(MAX_NAME_LENGTH) }, { mode: 'update' }), null);
    assert.strictEqual(validateIssueWriteFields({ description: 'y'.repeat(MAX_DESCRIPTION_LENGTH) }, { mode: 'update' }), null);
  });
});

describe('validateIssueWriteFields — reject', () => {
  test('create: missing title', () => {
    assert.strictEqual(validateIssueWriteFields({}, { mode: 'create' }), 'title is required');
    assert.strictEqual(validateIssueWriteFields({ title: '' }, { mode: 'create' }), 'title is required');
    assert.strictEqual(validateIssueWriteFields({ title: 123 }, { mode: 'create' }), 'title is required');
  });

  test('title over MAX_NAME_LENGTH', () => {
    const longTitle = 'x'.repeat(MAX_NAME_LENGTH + 1);
    assert.strictEqual(
      validateIssueWriteFields({ title: longTitle }, { mode: 'create' }),
      `title exceeds maximum length of ${MAX_NAME_LENGTH}`,
    );
    assert.strictEqual(
      validateIssueWriteFields({ title: longTitle }, { mode: 'update' }),
      `title exceeds maximum length of ${MAX_NAME_LENGTH}`,
    );
  });

  test('description over MAX_DESCRIPTION_LENGTH', () => {
    const longDesc = 'y'.repeat(MAX_DESCRIPTION_LENGTH + 1);
    assert.strictEqual(
      validateIssueWriteFields({ title: 'ok', description: longDesc }, { mode: 'create' }),
      'description exceeds maximum length',
    );
    assert.strictEqual(
      validateIssueWriteFields({ description: longDesc }, { mode: 'update' }),
      'description exceeds maximum length',
    );
  });

  test('control characters in title', () => {
    assert.strictEqual(
      validateIssueWriteFields({ title: 'bad\x00title' }, { mode: 'create' }),
      'title contains invalid characters',
    );
    assert.strictEqual(
      validateIssueWriteFields({ title: 'bad\x00title' }, { mode: 'update' }),
      'title contains invalid characters',
    );
  });

  test('control characters in description', () => {
    assert.strictEqual(
      validateIssueWriteFields({ title: 'ok', description: 'bad\x1Fbody' }, { mode: 'create' }),
      'description contains invalid characters',
    );
    assert.strictEqual(
      validateIssueWriteFields({ description: 'bad\x1Fbody' }, { mode: 'update' }),
      'description contains invalid characters',
    );
  });

  test('priority out of range is rejected ONLY when validatePriority is on', () => {
    // opt-in rejection (session-auth workspace-API surface)
    assert.strictEqual(
      validateIssueWriteFields({ title: 'ok', priority: -1 }, { mode: 'create', validatePriority: true }),
      `priority must be an integer between ${MIN_PRIORITY} and ${MAX_PRIORITY}`,
    );
    assert.strictEqual(
      validateIssueWriteFields({ priority: 5 }, { mode: 'update', validatePriority: true }),
      `priority must be an integer between ${MIN_PRIORITY} and ${MAX_PRIORITY}`,
    );
    // boundaries still accepted with validatePriority on
    assert.strictEqual(validateIssueWriteFields({ title: 'ok', priority: 0 }, { mode: 'create', validatePriority: true }), null);
    assert.strictEqual(validateIssueWriteFields({ title: 'ok', priority: 4 }, { mode: 'create', validatePriority: true }), null);
    // OFF (proxy surface): a bad priority is NOT a field error (silent-drop upstream)
    assert.strictEqual(validateIssueWriteFields({ title: 'ok', priority: 5 }, { mode: 'create' }), null);
  });

  test('a string-field error outranks a priority error (order: strings first)', () => {
    assert.strictEqual(
      validateIssueWriteFields({ title: 'x'.repeat(MAX_NAME_LENGTH + 1), priority: 99 }, { mode: 'create', validatePriority: true }),
      `title exceeds maximum length of ${MAX_NAME_LENGTH}`,
    );
  });
});

// ---------------------------------------------------------------------------
// PARITY: the extracted validator must produce the SAME accept/reject decision
// (and message) as the proxy route's ORIGINAL inline validation. The oracle
// below is a verbatim transcription of what routes/proxy.js's create + update
// handlers did before LIN-1552 extracted the seam (string checks only — priority
// was a silent-drop there, so validatePriority stays OFF for parity).
// ---------------------------------------------------------------------------

// Original proxy CREATE inline order (title required check happens in the route
// before these, so it is included here to mirror the full decision):
function proxyCreateOracle(title, description) {
  if (!title || typeof title !== 'string') return 'title is required';
  if (title.length > MAX_NAME_LENGTH) return `title exceeds maximum length of ${MAX_NAME_LENGTH}`;
  if (description && description.length > MAX_DESCRIPTION_LENGTH) return 'description exceeds maximum length';
  if (DANGEROUS_CHARS_REGEX.test(title)) return 'title contains invalid characters';
  if (description && DANGEROUS_CHARS_REGEX.test(description)) return 'description contains invalid characters';
  return null;
}

// Original proxy UPDATE inline order (every field optional):
function proxyUpdateOracle(title, description) {
  if (title && title.length > MAX_NAME_LENGTH) return `title exceeds maximum length of ${MAX_NAME_LENGTH}`;
  if (title && DANGEROUS_CHARS_REGEX.test(title)) return 'title contains invalid characters';
  if (description && description.length > MAX_DESCRIPTION_LENGTH) return 'description exceeds maximum length';
  if (description && DANGEROUS_CHARS_REGEX.test(description)) return 'description contains invalid characters';
  return null;
}

describe('validateIssueWriteFields — parity with proxy original inline behavior', () => {
  const cap = MAX_NAME_LENGTH;
  const dcap = MAX_DESCRIPTION_LENGTH;
  const cases = [
    { title: 'normal', description: 'body' },
    { title: '', description: '' },
    { title: undefined, description: 'body' },
    { title: 123, description: 'body' },
    { title: 'x'.repeat(cap), description: undefined },
    { title: 'x'.repeat(cap + 1), description: undefined },
    { title: 'ok', description: 'y'.repeat(dcap) },
    { title: 'ok', description: 'y'.repeat(dcap + 1) },
    { title: 'bad\x00', description: undefined },
    { title: 'ok', description: 'bad\x1F' },
    // multi-violation cases (prove the per-mode ORDER matches, not just the set):
    { title: 'x'.repeat(cap + 1), description: 'y'.repeat(dcap + 1) },
    { title: 'bad\x00', description: 'bad\x1F' },
    { title: 'x'.repeat(cap + 1), description: 'bad\x1F' },
    { title: 'bad\x00', description: 'y'.repeat(dcap + 1) },
  ];

  test('create-mode decisions equal the proxy create oracle for every case', () => {
    for (const { title, description } of cases) {
      assert.strictEqual(
        validateIssueWriteFields({ title, description }, { mode: 'create' }),
        proxyCreateOracle(title, description),
        `create parity mismatch for ${JSON.stringify({ title: String(title).slice(0, 12), description: String(description).slice(0, 12) })}`,
      );
    }
  });

  test('update-mode decisions equal the proxy update oracle for every case', () => {
    for (const { title, description } of cases) {
      assert.strictEqual(
        validateIssueWriteFields({ title, description }, { mode: 'update' }),
        proxyUpdateOracle(title, description),
        `update parity mismatch for ${JSON.stringify({ title: String(title).slice(0, 12), description: String(description).slice(0, 12) })}`,
      );
    }
  });

  test('priority silent-drop parity: proxy surface (validatePriority off) never rejects a priority', () => {
    for (const p of [-1, 0, 4, 5, 2.5, 'x', null]) {
      assert.strictEqual(validateIssueWriteFields({ title: 'ok', priority: p }, { mode: 'create' }), null);
    }
  });
});
