// title-parser.test.mjs — LIN-4333. The strict blind-pass title parser in code-blind.mjs.
//
// Run by hand only:  node --test docs/papers/harbour/cleaner-than-it-started-scripts/title-parser.test.mjs
// Not wired into CI: the unit runner takes only the globs in package.json (tests/unit/*.test.js,
// scripts/eval/eval-dense.test.mjs, scripts/code-shape/*.test.mjs), and this folder is none of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTitle } from './code-blind.mjs';

const BATCHES = ['A', 'B', 'C', 'D'];
const parse = (title) => parseTitle(title, BATCHES);
const here = path.dirname(fileURLToPath(import.meta.url));

// The pre-change rule (what code-blind did before LIN-4333), kept only as an oracle: on the real v1
// titles the new parser must produce the same ticket set and pass id that this rule produced.
function oldRule(title) {
  const single = title.match(/^(.*?) pass ([A-Z]{1,2})$/);
  return { id: single[2], subject_tickets: [...new Set(single[1].match(/\d+/g).map((n) => `LIN-${n}`))] };
}

// The 42 blind-pass titles of the frozen v1 LIN-4150 comments, copied from
// cleaner-than-it-started-evidence/2026-11-06/comments/LIN-4150.json (the test checks the copy below).
const V1_TITLES = [
  'batch B', 'batch A', 'batch C', 'batch D',
  'LIN-4248 pass E', 'LIN-4248 pass F', 'LIN-4253 pass G', 'LIN-4253 pass H',
  'LIN-4252 pass I', 'LIN-4252 pass J', 'LIN-4247 pass K', 'LIN-4247 pass L',
  'LIN-4251 pass M', 'LIN-4251 pass N', 'LIN-4246 pass O', 'LIN-4246 pass P',
  'LIN-4263 pass Q', 'LIN-4263 pass R', 'LIN-4276 pass S', 'LIN-4276 pass T',
  'LIN-4263+4276 pass V', 'LIN-4263+4276 pass U', 'LIN-4277 pass W', 'LIN-4277 pass X',
  'LIN-4251+4277 pass Y', 'LIN-4251+4277 pass Z', 'LIN-4255 pass AB', 'LIN-4255 pass AA',
  'LIN-4252+4255 pass AC', 'LIN-4252+4255 pass AD', 'LIN-4293 pass AF', 'LIN-4293 pass AE',
  'LIN-4247+4246+4293 pass AG', 'LIN-4247+4246+4293 pass AH', 'LIN-4292 pass AI', 'LIN-4292 pass AJ',
  'LIN-4296 pass AK', 'LIN-4296 pass AL', 'LIN-4304 pass AM', 'LIN-4304 pass AN',
  'LIN-4292+4304 pass AP', 'LIN-4292+4304 pass AO',
];

// Throws, and the message names the title (quoted), so the failure says which title it was.
function assertThrowsNaming(title) {
  assert.throws(() => parse(title), (e) => e instanceof Error && e.message.includes(`"${title}"`), `expected a throw naming ${JSON.stringify(title)}`);
}

test('shape 1: batch <X>', () => {
  assert.deepEqual(parse('batch B'), { kind: 'batch', batch: 'B', id: 'batch B', subject_tickets: null });
  assert.deepEqual(parse('batch D').id, 'batch D');
});

test('shape 2: <tickets> pass <ID>, LIN- on the first token only', () => {
  assert.deepEqual(parse('LIN-4248 pass E'), { kind: 'single-or-area', id: 'E', subject_tickets: ['LIN-4248'] });
  assert.deepEqual(parse('LIN-4263+4276 pass V'), { kind: 'single-or-area', id: 'V', subject_tickets: ['LIN-4263', 'LIN-4276'] });
  assert.deepEqual(parse('4263+4276 pass V'), { kind: 'single-or-area', id: 'V', subject_tickets: ['LIN-4263', 'LIN-4276'] });
  assert.deepEqual(parse('LIN-4247+4246+4293 pass AG').subject_tickets, ['LIN-4247', 'LIN-4246', 'LIN-4293']);
});

test('shape 3: baseline pair N pass <ID> is kind pair-baseline with no ticket', () => {
  const p = parse('baseline pair 1 pass AW');
  assert.deepEqual(p, { kind: 'pair-baseline', subject: 'baseline pair 1', id: 'AW', subject_tickets: null });
  assert.equal(p.subject_tickets, null, 'the 1 in "pair 1" is not a ticket');
});

test('unknown shape throws, naming the title', () => {
  for (const t of ['LIN-4248 pass E (rerun)', 'batch E', 'batch A pass B', 'something else entirely', 'baseline pair pass AW', 'baseline pair 1 pass AW extra']) {
    assertThrowsNaming(t);
  }
  assert.throws(() => parse('   '), /not one of the three known shapes/);
});

test('ambiguous titles throw, naming the title', () => {
  assertThrowsNaming('LIN-4248 pass E pass F');          // two "pass" separators
  assertThrowsNaming('LIN-4263+LIN-4276 pass V');         // LIN- on a second token
  assertThrowsNaming('LIN-4263+4263 pass V');             // the same ticket listed twice
});

test('stray numbers throw, naming the title (no number is read as a ticket on its own)', () => {
  assertThrowsNaming('LIN-4248 pass E 2');
  assertThrowsNaming('LIN-4248 round 2 pass E');
  assertThrowsNaming('LIN-4248 pass E (2)');
  assertThrowsNaming('LIN-4248 pass E, round 3');
  assertThrowsNaming('baseline pair 1 pass AW 2');
});

test('the title that used to become LIN-1 now has no ticket', () => {
  assert.equal(parse('baseline pair 1 pass AW').subject_tickets, null);
});

test('the copied v1 title list matches the frozen v1 file, when the file is present', (t) => {
  const file = path.join(here, '..', 'cleaner-than-it-started-evidence', '2026-11-06', 'comments', 'LIN-4150.json');
  if (!existsSync(file)) return t.skip('frozen v1 file not present in this checkout');
  const { comments } = JSON.parse(readFileSync(file, 'utf8'));
  const titles = comments
    .filter((c) => /^## Blind place scoring, /.test(c.body || ''))
    .map((c) => c.body.split('\n')[0].replace(/^## Blind place scoring, /, '').trim());
  assert.deepEqual(titles, V1_TITLES);
});

test('every real v1 title parses, and to the same tickets and id as the old rule', () => {
  assert.equal(V1_TITLES.length, 42);
  for (const title of V1_TITLES) {
    const p = parse(title);
    if (title.startsWith('batch ')) {
      assert.equal(p.kind, 'batch', title);
      assert.equal(p.id, title, title);
    } else {
      const old = oldRule(title);
      assert.equal(p.kind, 'single-or-area', title);
      assert.deepEqual(p.subject_tickets, old.subject_tickets, title);
      assert.equal(p.id, old.id, title);
    }
  }
});
