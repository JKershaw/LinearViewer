/**
 * LIN-4455 (piece 5 of LIN-4447): the feedback kinds have one declaration with their roles.
 *
 * `lib/dispatch-feedback-kinds.js` holds one row per kind, each declaring every role. These
 * tests iterate the table, so a new kind must declare all of its roles, and they check that
 * every kind set is derived from it rather than written out again:
 *
 *   - each row has exactly `kind` plus the role columns, every role a boolean;
 *   - the leaf imports nothing (its importers sit in cycles with each other);
 *   - the derived lists and sets are the rows filtered by role, and `findWakeEvent` reads
 *     the `mayCarryWake` role;
 *   - a census over `lib/`, `routes/` and `server.js`: no array literal of two or more
 *     known kinds, and no `x === 'a' || x === 'b'` chain over them, outside the table.
 *     That is the shape every retired copy had (the runner allowlist, the parked-wait
 *     relays, and the four decision-stamp copies).
 *
 * What the derived sets must contain, and the order the runner prompt renders, is pinned
 * from outside in `lin-4455-kinds-and-constants-characterization.test.js`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import {
  FEEDBACK_KINDS, FEEDBACK_KIND_ROLES, FEEDBACK_ENTRY_KINDS, PARKED_WAIT_SKIPPED_KINDS,
  DECISION_LIFECYCLE_STAMP_KINDS, feedbackKindMayCarryWake
} from '../../lib/dispatch-feedback-kinds.js';
import * as dispatchStore from '../../lib/dispatch-store.js';
import { findWakeEvent } from '../../lib/dispatch-terminal.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LEAF = 'lib/dispatch-feedback-kinds.js';
const kindsWith = (role) => FEEDBACK_KINDS.filter((row) => row[role]).map((row) => row.kind);

describe('every row declares every role', () => {
  test('the role columns are the four the readers use', () => {
    assert.deepEqual([...FEEDBACK_KIND_ROLES], ['runnerPostable', 'relay', 'decisionStamp', 'mayCarryWake']);
  });

  for (const row of FEEDBACK_KINDS) {
    test(`${row.kind}: exactly kind plus each role, every role a boolean`, () => {
      assert.deepEqual(Object.keys(row).sort(), ['kind', ...FEEDBACK_KIND_ROLES].sort());
      for (const role of FEEDBACK_KIND_ROLES) {
        assert.equal(typeof row[role], 'boolean', `${row.kind} must declare ${role} as true or false`);
      }
    });
  }

  test('kinds are distinct, non-empty strings', () => {
    const kinds = FEEDBACK_KINDS.map((row) => row.kind);
    for (const kind of kinds) assert.ok(typeof kind === 'string' && kind.length > 0, String(kind));
    assert.equal(new Set(kinds).size, kinds.length, 'a kind has two rows');
  });

  test('the table, its rows and the allowlist are frozen', () => {
    assert.ok(Object.isFrozen(FEEDBACK_KINDS));
    for (const row of FEEDBACK_KINDS) assert.ok(Object.isFrozen(row), row.kind);
    assert.ok(Object.isFrozen(FEEDBACK_ENTRY_KINDS));
  });
});

describe('the leaf imports nothing', () => {
  test(`${LEAF} has no import, re-export-from, dynamic import or require`, () => {
    const ast = acorn.parse(readFileSync(join(REPO, LEAF), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    const found = [];
    walk.full(ast, (node) => {
      if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression') found.push(node.type);
      if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) found.push(`${node.type} from ${node.source.value}`);
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') found.push('require');
    });
    assert.deepEqual(found, []);
  });
});

describe('every kind set is the table filtered by a role', () => {
  test('FEEDBACK_ENTRY_KINDS is the runnerPostable rows in row order, with one home (the store no longer re-exports it)', () => {
    assert.deepEqual([...FEEDBACK_ENTRY_KINDS], kindsWith('runnerPostable'));
    // LIN-4465 leftovers: the runner prompt imports the leaf, so the store's shim had no importer left.
    assert.equal('FEEDBACK_ENTRY_KINDS' in dispatchStore, false);
  });

  test('PARKED_WAIT_SKIPPED_KINDS is the relay rows', () => {
    assert.deepEqual([...PARKED_WAIT_SKIPPED_KINDS].sort(), kindsWith('relay').sort());
  });

  test('DECISION_LIFECYCLE_STAMP_KINDS is the decisionStamp rows', () => {
    assert.deepEqual([...DECISION_LIFECYCLE_STAMP_KINDS].sort(), kindsWith('decisionStamp').sort());
  });

  test('the table has rows for kinds a runner may not post', () => {
    assert.ok(FEEDBACK_KINDS.some((row) => !row.runnerPostable), 'no store-only row');
  });

  test('feedbackKindMayCarryWake reads the mayCarryWake column; unknown and missing kinds pass', () => {
    for (const row of FEEDBACK_KINDS) assert.equal(feedbackKindMayCarryWake(row.kind), row.mayCarryWake, row.kind);
    assert.equal(feedbackKindMayCarryWake('some-future-kind'), true);
    assert.equal(feedbackKindMayCarryWake(undefined), true);
  });

  test('findWakeEvent finds a marker on an entry exactly when its kind may carry a wake', () => {
    for (const row of FEEDBACK_KINDS) {
      const entry = { kind: row.kind, message: '[done] finished' };
      assert.equal(findWakeEvent([entry])?.entry === entry, row.mayCarryWake, row.kind);
    }
  });
});

// ─── Census: no hand-written kind set outside the table ─────────────────────

/**
 * Array literals of two or more known kinds, and `===` or-chains over two or more, in
 * `file`. Every retired copy had one of these two shapes.
 *
 * @param {string} file - repo-relative, for the report
 * @param {string} source
 * @param {Set<string>} kinds
 * @returns {Array<string>}
 */
function kindSetsIn(file, source, kinds) {
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch {
    return []; // not an ES module acorn can read (none today); nothing to census
  }
  const lit = (node) => (node && node.type === 'Literal' && typeof node.value === 'string' ? node.value : null);
  const hits = [];
  walk.full(ast, (node) => {
    if (node.type === 'ArrayExpression' && node.elements.length >= 2) {
      const values = node.elements.map(lit);
      if (values.every((v) => v && kinds.has(v))) hits.push(`${file}:${node.loc.start.line} [${values.join(', ')}]`);
    }
    if (node.type === 'LogicalExpression' && node.operator === '||') {
      const values = [];
      const collect = (e) => {
        if (e.type === 'LogicalExpression' && e.operator === '||') { collect(e.left); collect(e.right); }
        else if (e.type === 'BinaryExpression' && e.operator === '===') values.push(lit(e.right) ?? lit(e.left));
        else values.push(null);
      };
      collect(node);
      if (values.length >= 2 && values.every((v) => v && kinds.has(v))) hits.push(`${file}:${node.loc.start.line} ${values.join(' || ')}`);
    }
  });
  return hits;
}

describe('no hand-written feedback-kind set outside the table', () => {
  const kinds = new Set(FEEDBACK_KINDS.map((row) => row.kind));

  test('the census sees both shapes, and only all-kind ones (self-check)', () => {
    const src = [
      "const a = new Set(['decision-answer', 'decision-withdrawn']);",
      "const b = (e) => e.kind === 'tool' || e.kind === 'usage';",
      "const c = ['status', 'error'];",
      "const d = (e) => e.kind === 'tool' || e.ok;"
    ].join('\n');
    assert.deepEqual(kindSetsIn('sample.js', src, kinds), [
      'sample.js:1 [decision-answer, decision-withdrawn]',
      'sample.js:2 tool || usage'
    ]);
  });

  test(`lib/, routes/ and server.js hold none (the table in ${LEAF} is the one declaration)`, () => {
    const files = execFileSync('git', ['ls-files', 'lib', 'routes', 'server.js'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.m?js$/.test(f) && f !== LEAF);
    assert.ok(files.length > 100, `the census reads the tree (${files.length} files)`);
    const hits = files.flatMap((f) => kindSetsIn(f, readFileSync(join(REPO, f), 'utf8'), kinds));
    assert.deepEqual(hits, [], `hand-written feedback-kind set(s); derive from ${LEAF} instead:\n${hits.join('\n')}`);
  });
});
