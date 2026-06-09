/**
 * Unit tests for the prompt download filename helpers (LIN-316).
 *
 * Run with: node --test tests/unit/prompt-filename.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { slugifyForFilename, buildPromptFilename } from '../../lib/prompt-formatters.js';

describe('slugifyForFilename', () => {
  test('lower-cases and dash-separates', () => {
    assert.strictEqual(slugifyForFilename('Foreman Run'), 'foreman-run');
  });

  test('collapses runs of non-word chars into a single dash', () => {
    assert.strictEqual(slugifyForFilename('Autopilot — LIN-42'), 'autopilot-lin-42');
  });

  test('trims leading/trailing dashes and dots', () => {
    assert.strictEqual(slugifyForFilename('  --hello.--  '), 'hello');
  });

  test('keeps hyphens and dots inside identifiers', () => {
    assert.strictEqual(slugifyForFilename('LIN-316'), 'lin-316');
  });

  test('returns empty string for nullish/empty input', () => {
    assert.strictEqual(slugifyForFilename(''), '');
    assert.strictEqual(slugifyForFilename(null), '');
    assert.strictEqual(slugifyForFilename(undefined), '');
  });
});

describe('buildPromptFilename', () => {
  test('combines identifier and prompt name', () => {
    assert.strictEqual(buildPromptFilename('LIN-316', 'Retro'), 'lin-316-retro.md');
  });

  test('drops the identifier when absent', () => {
    assert.strictEqual(buildPromptFilename('', 'Autopilot (stack walk)'), 'autopilot-stack-walk.md');
  });

  test('falls back to "prompt" when the name slugs to nothing', () => {
    assert.strictEqual(buildPromptFilename('LIN-9', '—'), 'lin-9-prompt.md');
    assert.strictEqual(buildPromptFilename('', ''), 'prompt.md');
  });

  test('always ends in .md', () => {
    assert.ok(buildPromptFilename('LIN-1', 'plan').endsWith('.md'));
  });
});
