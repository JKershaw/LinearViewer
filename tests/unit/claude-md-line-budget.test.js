/**
 * Line/byte budget guard for CLAUDE.md (LIN-2896).
 *
 * CLAUDE.md was shrunk from 623 lines / 153,845 bytes to a conventions
 * pointer, with the detail it used to carry moved verbatim into 8 docs under
 * docs/architecture/ (see CLAUDE.md's own "Where the detail lives" section).
 * Nothing enforced the old file's size, so it grew unchecked for a long time
 * before this ticket; this guard exists so the same growth can't happen
 * silently again. Bytes are the binding constraint (a line can be arbitrarily
 * long), but the line cap is checked too since in practice it is what fills
 * up first — see docs/papers/harbour/efficiency-levers.md:37, which measured
 * that every session reading CLAUDE.md carries its full byte cost through
 * the whole leg's context window, and LIN-2887, the parent ticket this size
 * discipline serves.
 *
 * Run with: node --test tests/unit/claude-md-line-budget.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The ceiling itself (LIN-2896). CLAUDE.md is a conventions pointer, not a
// reference manual — anything that would push it past this cap belongs in a
// doc under docs/architecture/ instead, cited from CLAUDE.md's "Where the
// detail lives" section. Raising these numbers is not the fix for a file that
// has grown past them; moving the content that grew it is.
export const CLAUDE_MD_MAX_LINES = 110;
export const CLAUDE_MD_MAX_BYTES = 12000;

const claudeMdPath = fileURLToPath(new URL('../../CLAUDE.md', import.meta.url));
const claudeMdRaw = readFileSync(claudeMdPath);
const claudeMdText = claudeMdRaw.toString('utf8');
// Count newlines directly (not split('\n').length, which over-counts by one
// on a file with a trailing newline) so this matches `wc -l`.
const lineCount = (claudeMdText.match(/\n/g) || []).length;
const byteCount = claudeMdRaw.length;

describe('CLAUDE.md stays within its line/byte budget (LIN-2896)', () => {
  test('line count does not exceed the cap', () => {
    assert.ok(lineCount <= CLAUDE_MD_MAX_LINES,
      `CLAUDE.md is ${lineCount} lines, ${lineCount - CLAUDE_MD_MAX_LINES} over the ${CLAUDE_MD_MAX_LINES}-line cap. ` +
      `Move whatever pushed it over into a doc under docs/architecture/ (add or extend one, then point to it from ` +
      `CLAUDE.md's "Where the detail lives" section) — CLAUDE.md itself keeps only Commands, Code Style, Design ` +
      `Principles, the E2E/Unit Testing Pattern, Linear API, Key Behaviors, AI Agent Support, Where the detail ` +
      `lives, and Invariants. Raising this number is not the fix. See LIN-2887 and ` +
      `docs/papers/harbour/efficiency-levers.md:37 for why the cap exists.`);
  });

  test('byte count does not exceed the cap (bytes are binding)', () => {
    assert.ok(byteCount <= CLAUDE_MD_MAX_BYTES,
      `CLAUDE.md is ${byteCount} bytes, ${byteCount - CLAUDE_MD_MAX_BYTES} over the ${CLAUDE_MD_MAX_BYTES}-byte cap. ` +
      `Move whatever pushed it over into a doc under docs/architecture/ (add or extend one, then point to it from ` +
      `CLAUDE.md's "Where the detail lives" section) — CLAUDE.md itself keeps only Commands, Code Style, Design ` +
      `Principles, the E2E/Unit Testing Pattern, Linear API, Key Behaviors, AI Agent Support, Where the detail ` +
      `lives, and Invariants. Raising this number is not the fix. See LIN-2887 and ` +
      `docs/papers/harbour/efficiency-levers.md:37 for why the cap exists.`);
  });
});
