/**
 * Unit tests for lib/description-edit.js
 *
 * Run with: node --test tests/unit/description-edit.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  appendBlock,
  replace,
  normalizeEscaping,
  DescriptionEditError,
} from '../../lib/description-edit.js';

describe('appendBlock', () => {
  test('appends with a blank-line separator', () => {
    assert.strictEqual(appendBlock('First line.', 'Second.'), 'First line.\n\nSecond.');
  });

  test('preserves the existing body byte-for-byte (prefix identical)', () => {
    const existing = '## Plan\n\n- step one\n- step two\n\nNotes with `code` and \\*\\*escapes\\*\\*.';
    const result = appendBlock(existing, '## Findings\n\nAll good.');
    assert.ok(result.startsWith(existing), 'original is an exact prefix of the result');
    assert.strictEqual(result, `${existing}\n\n## Findings\n\nAll good.`);
  });

  test('empty existing body yields just the block', () => {
    assert.strictEqual(appendBlock('', 'Only content'), 'Only content');
    assert.strictEqual(appendBlock(null, 'Only content'), 'Only content');
    assert.strictEqual(appendBlock('   \n  ', 'Only content'), 'Only content');
  });
});

describe('normalizeEscaping', () => {
  test('drops backslashes before markdown punctuation', () => {
    assert.strictEqual(normalizeEscaping('\\#\\# Heading'), '## Heading');
    assert.strictEqual(normalizeEscaping('\\*\\*bold\\*\\*'), '**bold**');
  });

  test('leaves backslashes before non-escapable characters', () => {
    assert.strictEqual(normalizeEscaping('a\\nb'), 'a\\nb');
  });

  test('handles null/undefined', () => {
    assert.strictEqual(normalizeEscaping(null), '');
    assert.strictEqual(normalizeEscaping(undefined), '');
  });
});

describe('replace — happy path', () => {
  test('replaces a unique plain span', () => {
    assert.strictEqual(
      replace('status: todo\nowner: me', 'todo', 'done'),
      'status: done\nowner: me'
    );
  });

  test('matches the rendered form against an escaped body, consuming the backslash', () => {
    // Linear stores `\## Heading`; agent quotes the rendered `## Heading`.
    const doc = '\\## Heading\n\nbody text';
    const result = replace(doc, '## Heading', '## Summary');
    assert.strictEqual(result, '## Summary\n\nbody text');
    assert.ok(!result.includes('\\#'), 'no dangling escape backslash remains');
  });

  test('matches escaped bytes quoted verbatim from GET', () => {
    const doc = 'intro \\*\\*bold\\*\\* outro';
    const result = replace(doc, '\\*\\*bold\\*\\*', 'plain');
    assert.strictEqual(result, 'intro plain outro');
  });

  test('newString is inserted raw (not escaped)', () => {
    const doc = 'before MARK after';
    assert.strictEqual(replace(doc, 'MARK', '**bold**'), 'before **bold** after');
  });

  test('round-trip: read -> append -> replace -> original-derived content intact', () => {
    const original = '# Task\n\nDescription with \\_emphasis\\_ and a `snippet`.';
    const appended = appendBlock(original, '## Findings\n\nstatus: pending');
    assert.ok(appended.startsWith(original));
    const edited = replace(appended, 'status: pending', 'status: complete');
    assert.strictEqual(edited, `${original}\n\n## Findings\n\nstatus: complete`);
    assert.ok(edited.startsWith(original), 'original prefix still byte-identical');
  });
});

describe('replace — loud failures', () => {
  test('throws NOT_FOUND when the span is absent', () => {
    assert.throws(
      () => replace('hello world', 'absent', 'x'),
      (err) => {
        assert.ok(err instanceof DescriptionEditError);
        assert.strictEqual(err.code, 'NOT_FOUND');
        assert.strictEqual(err.matchCount, 0);
        return true;
      }
    );
  });

  test('throws NOT_UNIQUE with the candidate count', () => {
    assert.throws(
      () => replace('ab ab ab', 'ab', 'x'),
      (err) => {
        assert.ok(err instanceof DescriptionEditError);
        assert.strictEqual(err.code, 'NOT_UNIQUE');
        assert.strictEqual(err.matchCount, 3);
        return true;
      }
    );
  });

  test('throws EMPTY_OLD_STRING for an empty needle', () => {
    assert.throws(
      () => replace('content', '', 'x'),
      (err) => {
        assert.strictEqual(err.code, 'EMPTY_OLD_STRING');
        return true;
      }
    );
    assert.throws(() => replace('content', null, 'x'), /must not be empty/);
  });

  test('does not silently no-op', () => {
    // A near-miss must throw, never return the document unchanged.
    assert.throws(() => replace('the quick brown fox', 'quick  brown', 'x'));
  });
});
