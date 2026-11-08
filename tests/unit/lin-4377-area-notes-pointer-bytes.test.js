/**
 * LIN-4377 / LIN-4383 (witness A7): the area notes pointer renders the same bytes when
 * the registry path stops being a literal in `formatAreaNotesPointer` and is read from
 * the product's own constant instead.
 *
 * A characterization pin, captured from the pointer before the change. It stays green
 * through the change; an interpolation slip (a dropped backtick, another spelling of the
 * path) turns it red. A deliberate change to the pointer's wording updates this string in
 * the same change, with its reason in `scripts/prompt-template-change-log.md`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatAreaNotesPointer } from '../../lib/prompt-formatters.js';

const POINTER = '\n\n## Area Notes\n\nRead `docs/areas/README.md` and the notes for each area this work touches ' +
  '(`docs/areas/areas.json` maps a path to its area, first match wins; no notes file means nothing known yet). ' +
  'Lessons bind how you work. Waiting entries are context, not scope, unless the size of the move takes them on.';

test('formatAreaNotesPointer() renders byte-identical output', () => {
  assert.strictEqual(formatAreaNotesPointer(), POINTER);
  assert.strictEqual(Buffer.byteLength(formatAreaNotesPointer()), 308);
});
