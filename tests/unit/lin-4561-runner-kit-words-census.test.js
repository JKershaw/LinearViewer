/**
 * LIN-4561 census: the runner kit posts a run's words only through its keyed sender.
 *
 * The twin of Simple Dispatcher's test/lin-4557-assistant-text-owner-census.test.js, which holds that every
 * `assistant-text` post a Simple Dispatcher run makes goes through its one owner (assistant-text-outbox.js).
 * The kit is self-contained (its own repository's code is not shared with Simple Dispatcher's), so it has its own
 * sender (lib/runner-kit/runner.mjs: planWords / relayWords, the body built by `wordsBody`), and this census holds
 * the same rule over the kit: a post of the kind made any other way would be unkeyed, outside the lock and out of
 * order with the sender's, which is the second sender LIN-4557 removed.
 *
 * The rule, over the kit's code with comments stripped:
 *  1. the kind's literal appears once, as `export const WORDS_KIND = 'assistant-text'` in runner.mjs, and nowhere
 *     else in the kit (broker.mjs included) except the `(assistant-text i/n)` chunk head Harbour masks across;
 *  2. WORDS_KIND is read only inside `wordsBody` (the one body that carries the kind) and `isWordsKind` (the
 *     `feedback` command's refusal);
 *  3. `wordsBody` is called once, as the sender's `send` for a queued word.
 * The `feedback` command's refusal of the kind is witnessed in tests/unit/lin-4561-runner-kit-words.test.js.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4561-runner-kit-words-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KIT = path.join(ROOT, 'lib', 'runner-kit');
const RUNNER = 'runner.mjs';

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const KIND_DECL = /export const WORDS_KIND = (['"`])assistant-text\1;/;
const CHUNK_HEAD = /\(assistant-text \$\{/;

/** The body of `function <name>(…) { … }` in `src`, by brace matching from its first `{`; null when absent. */
function functionBody(src, name) {
  const at = src.search(new RegExp(`function ${name}\\s*\\(`));
  if (at === -1) return null;
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

/** Every rule broken in the kit's `files` ({ name: source }), as messages; [] when the kit keeps them all. */
export function censusProblems(files) {
  const problems = [];
  const runner = stripComments(files[RUNNER] || '');
  if (!KIND_DECL.test(runner)) problems.push(`${RUNNER}: WORDS_KIND is not declared as the kind's one literal`);
  for (const [name, raw] of Object.entries(files)) {
    const lines = stripComments(raw).split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('assistant-text')) return;
      if (name === RUNNER && (KIND_DECL.test(line) || CHUNK_HEAD.test(line))) return;
      problems.push(`${name}:${i + 1}: names the kind outside WORDS_KIND: ${line.trim()}`);
    });
  }
  const allowed = ['wordsBody', 'isWordsKind'].map((n) => functionBody(runner, n) || '');
  let rest = runner.replace(KIND_DECL, '');
  for (const body of allowed) if (body) rest = rest.replace(body, '');
  if (/\bWORDS_KIND\b/.test(rest)) problems.push(`${RUNNER}: WORDS_KIND is read outside wordsBody and isWordsKind`);
  if (!/kind:\s*WORDS_KIND/.test(allowed[0])) problems.push(`${RUNNER}: wordsBody does not put WORDS_KIND on the body`);
  const calls = runner.match(/\bwordsBody\(/g) || [];
  // One declaration and one call: the sender's `send`.
  if (calls.length !== 2) problems.push(`${RUNNER}: wordsBody is called ${calls.length - 1} times; it is the sender's one body`);
  if (!/send:\s*\(entry\)\s*=>\s*api\(\)\.feedback\(entry\.itemId,\s*wordsBody\(entry\)\)/.test(runner)) {
    problems.push(`${RUNNER}: wordsBody is not the sender's send for a queued word`);
  }
  return problems;
}

const kitFiles = () => Object.fromEntries(fs.readdirSync(KIT).filter((f) => f.endsWith('.mjs')).map((f) => [f, fs.readFileSync(path.join(KIT, f), 'utf8')]));

describe('LIN-4561 census: the kit posts assistant-text only through its keyed sender', () => {
  test('the kit keeps the rule', () => {
    assert.deepEqual(censusProblems(kitFiles()), []);
  });

  // The census is checked against plantings of what it guards against, so it fails on them, not only passes today.
  const planted = (fn) => { const files = kitFiles(); files[RUNNER] = fn(files[RUNNER]); return censusProblems(files); };

  test('it fails on a direct post of the kind (a second, unkeyed sender)', () => {
    const problems = planted((src) => src.replace('case \'feedback\': {', 'case \'feedback\': {\n      await post(args[0], { message: \'x\', kind: \'assistant-text\' });'));
    assert.ok(problems.some((p) => /names the kind outside WORDS_KIND/.test(p)), problems.join('\n'));
  });

  test('it fails on a post that reads WORDS_KIND outside the sender\'s body', () => {
    const problems = planted((src) => src.replace('case \'feedback\': {', 'case \'feedback\': {\n      await post(args[0], { message: \'x\', kind: WORDS_KIND });'));
    assert.ok(problems.some((p) => /read outside wordsBody/.test(p)), problems.join('\n'));
  });

  test('it fails on a second caller of wordsBody', () => {
    const problems = planted((src) => src.replace('case \'feedback\': {', 'case \'feedback\': {\n      await post(args[0], wordsBody({ message: \'x\' }));'));
    assert.ok(problems.some((p) => /wordsBody is called 2 times/.test(p)), problems.join('\n'));
  });

  test('it fails on the kind named in the broker', () => {
    const files = kitFiles();
    files['broker.mjs'] += '\nexport const SNEAK = { kind: "assistant-text" };\n';
    assert.ok(censusProblems(files).some((p) => /^broker\.mjs:/.test(p)));
  });

  test('a comment naming the kind is not a post', () => {
    const problems = planted((src) => `${src}\n// kind: 'assistant-text' is only ever posted by wordsBody\n`);
    assert.deepEqual(problems, []);
  });
});
