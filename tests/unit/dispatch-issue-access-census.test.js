/**
 * The entrance census for the dispatch seat's issue access (moved from the first-dispatch seal's tests when LIN-4502
 * retired the seal). Every caller of `createDispatchItem` in lib/ and routes/, and every `enqueueRow` lane in
 * lib/dispatch-entrance.js, passes its own `issueAccess`, or is on NEVER_FIRST with the reason it names no ticket or
 * only ever continues one. The factory resolves that access once for the task seat (lib/dispatch-factory.js
 * taskOnDispatch, LIN-4501), the file-pointer plan read and the child-ticket retry (LIN-4503), so a lane that
 * dropped it would make those run without the dispatch's own credential.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/dispatch-issue-access-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Callers that never start a ticket, so they pass no issueAccess. Each reason says why
// that caller can never make a ticket's first dispatch; a caller that stops matching its
// reason belongs off this list.
const NEVER_FIRST = {
  'lib/follow-up-dispatch.js': 'always carries followUpTo: a follow-up beat, never a first row',
  'lib/chat-tools.js': 'always carries followUpTo: a Task Chat follow-up, never a first row',
  'routes/collective.js': 'names no issue (a collective fan-out)',
  'lib/dispatch-entrance.js#periodical-mint': 'names no issue (attachIssue: null; a periodical mint)',
};

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(ROOT, dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(join(dir, name)));
    else if (name.endsWith('.js')) out.push(join(dir, name));
  }
  return out;
}

/** The text of each call's argument object, brace-matched from `<name>({` / `<name>(run, {`. */
function callArguments(src, name) {
  const calls = [];
  const re = new RegExp(`\\b${name}\\((?:run, )?\\{`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, m.index))) continue; // a comment, not a call
    if (/function\s+$|async\s+function\s+$/.test(src.slice(lineStart, m.index))) continue; // the declaration
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    calls.push({ at: src.slice(0, m.index).split('\n').length, text: src.slice(m.index, i + 1) });
  }
  return calls;
}

describe('the dispatch seat\'s issue access — the entrance census', () => {
  test('every createDispatchItem( caller in lib/routes passes issueAccess or is never-first with a reason', () => {
    const found = [];
    for (const file of [...sourceFiles('lib'), ...sourceFiles('routes')]) {
      if (file === join('lib', 'dispatch-factory.js')) continue;
      const src = readFileSync(join(ROOT, file), 'utf8');
      for (const c of callArguments(src, 'createDispatchItem')) found.push({ file: relative('.', file), ...c });
    }
    assert.ok(found.length >= 6, `the census must find the callers, found ${found.length}`);
    const missing = found.filter((c) => !/\bissueAccess\b/.test(c.text) && !NEVER_FIRST[c.file]);
    assert.deepEqual(missing.map((c) => `${c.file}:${c.at}`), [],
      'each of these must pass issueAccess, or be added to NEVER_FIRST with the reason it can never make a first row');
  });

  test('every enqueueRow( lane passes issueAccess, except the periodical mint (no issue)', () => {
    const src = readFileSync(join(ROOT, 'lib/dispatch-entrance.js'), 'utf8');
    const lanes = callArguments(src, 'enqueueRow');
    assert.ok(lanes.length >= 6, `the census must find the lanes, found ${lanes.length}`);
    const missing = lanes.filter((c) => !/\bissueAccess\b/.test(c.text));
    assert.equal(missing.length, 1, `only the periodical mint may pass no access: ${missing.map((c) => `:${c.at}`)}`);
    assert.match(missing[0].text, /attachIssue: null/, NEVER_FIRST['lib/dispatch-entrance.js#periodical-mint']);
    assert.match(src, /issueAccess: spec\.issueAccess/, 'enqueueRow forwards the lane\'s access to the factory');
  });

  test('the never-first callers still match their reasons', () => {
    const followUps = ['lib/follow-up-dispatch.js', 'lib/chat-tools.js'];
    for (const file of followUps) {
      const [call] = callArguments(readFileSync(join(ROOT, file), 'utf8'), 'createDispatchItem');
      assert.match(call.text, /followUpTo/, `${file}: ${NEVER_FIRST[file]}`);
    }
    const [collective] = callArguments(readFileSync(join(ROOT, 'routes/collective.js'), 'utf8'), 'createDispatchItem');
    const rowFields = collective.text.match(/\n\s*fields: \{[^}]*\}/);
    assert.ok(rowFields, 'the collective call passes a fields literal');
    assert.doesNotMatch(rowFields[0], /issueIdentifier/, NEVER_FIRST['routes/collective.js']);
  });
});
