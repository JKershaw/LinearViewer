/**
 * LIN-4377 / LIN-4383 (witness A1): the run store knows no leftovers.
 *
 * `lib/dispatch-store.js` owns generic held-wake primitives keyed on `heldWakeFor`
 * (hold, claim, release, the stopped-run cleanup). What a leftover is, and what its wake
 * says, live in the injected hook (`lib/dispatch-leftover-hook.js`). This census counts
 * the store's CODE lines that say "leftover", in any case: identifiers, imports and log
 * strings all count; comments do not (a few comments point to the hook). It must be 0.
 *
 * Comments are found by acorn's `onComment`, not a regex, so a `//` inside a string or
 * a URL is never read as one. A new held-wake feature brings a hook, not store branches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const STORE = 'lib/dispatch-store.js';

/**
 * `source` with every comment blanked to spaces, newlines kept, so line numbers hold.
 *
 * @param {string} source
 * @returns {string}
 */
function withoutComments(source) {
  const spans = [];
  acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    onComment: (_block, _text, start, end) => spans.push([start, end])
  });
  let out = '';
  let at = 0;
  for (const [start, end] of spans) {
    out += source.slice(at, start) + source.slice(start, end).replace(/[^\n]/g, ' ');
    at = end;
  }
  return out + source.slice(at);
}

/**
 * The 1-based line numbers and text of the code lines matching /leftover/i.
 *
 * @param {string} source
 * @returns {Array<string>}
 */
function leftoverCodeLines(source) {
  return withoutComments(source)
    .split('\n')
    .map((line, i) => ({ n: i + 1, line }))
    .filter(({ line }) => /leftover/i.test(line))
    .map(({ n, line }) => `${STORE}:${n}: ${line.trim()}`);
}

test('the comment stripper keeps strings and drops comments', () => {
  const src = [
    "const a = '// leftover in a string';",
    '// leftover in a line comment',
    '/* leftover in a',
    '   block comment */ const b = 1;',
    'const c = `leftover ${a}`; // trailing leftover'
  ].join('\n');
  assert.deepEqual(
    leftoverCodeLines(src).map(l => l.replace(`${STORE}:`, '')),
    ["1: const a = '// leftover in a string';", '5: const c = `leftover ${a}`;']
  );
});

test('lib/dispatch-store.js has zero code lines that say "leftover"', () => {
  const lines = leftoverCodeLines(readFileSync(join(REPO, STORE), 'utf8'));
  assert.deepEqual(
    lines,
    [],
    `${lines.length} code line(s) in ${STORE} say "leftover". Leftover policy belongs in ` +
      `lib/dispatch-leftover-hook.js; the store keeps held-wake primitives keyed on heldWakeFor.\n${lines.join('\n')}`
  );
});
