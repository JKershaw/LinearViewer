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
 *
 * LIN-4455: the word count alone let the store pick leftover wording through a call
 * (`releaseHeldWake` prepended `formatHeldWakeNote({status})`) without spelling the word.
 * So this file also counts the dependency: the store neither imports nor names
 * `formatHeldWakeNote`. The release wording is late-bound (`setHeldWakeReleaseNote`) or
 * comes from `wakeHook.releaseNote`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

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

/**
 * The store's references to the held-wake wording helper: import specifiers (named,
 * default or namespace members) and identifiers anywhere in its code.
 *
 * @param {string} source
 * @returns {Array<string>}
 */
function wordingReferences(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const hits = [];
  walk.full(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) {
        const imported = spec.imported?.name ?? spec.local.name;
        if (imported === 'formatHeldWakeNote') hits.push(`${STORE}:${node.loc.start.line}: imports formatHeldWakeNote from ${node.source.value}`);
      }
    }
    if ((node.type === 'Identifier' || node.type === 'PrivateIdentifier') && node.name === 'formatHeldWakeNote') {
      hits.push(`${STORE}:${node.loc.start.line}: names formatHeldWakeNote`);
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property?.name === 'formatHeldWakeNote') {
      hits.push(`${STORE}:${node.loc.start.line}: reads .formatHeldWakeNote`);
    }
  });
  return [...new Set(hits)];
}

test('the reference finder sees an import, a call and a member read (self-check)', () => {
  const src = [
    "import { formatHeldWakeNote, other } from './dispatch-wake.js';",
    "import * as wake from './dispatch-wake.js';",
    'const a = formatHeldWakeNote({ status: 1 });',
    'const b = wake.formatHeldWakeNote;',
    "const c = 'formatHeldWakeNote in a string is not a reference';"
  ].join('\n');
  assert.deepEqual(wordingReferences(src).map((l) => l.replace(`${STORE}:`, '')), [
    '1: imports formatHeldWakeNote from ./dispatch-wake.js',
    '3: names formatHeldWakeNote',
    '4: reads .formatHeldWakeNote'
  ]);
});

test('lib/dispatch-store.js neither imports nor names formatHeldWakeNote (LIN-4455)', () => {
  const refs = wordingReferences(readFileSync(join(REPO, STORE), 'utf8'));
  assert.deepEqual(
    refs,
    [],
    `${STORE} reaches the held-wake wording helper. The release wording is bound late ` +
      `(setHeldWakeReleaseNote) or comes from wakeHook.releaseNote; the store does not own it.\n${refs.join('\n')}`
  );
});
