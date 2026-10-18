import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffCensus, groupKey } from './census-diff.mjs';

const group = (detector, decision, files = ['lib/a.js', 'lib/b.js']) => ({ detector, decision, files, fileCount: files.length });
const census = (commit, groups) => ({ commit, groups, totals: { groups: groups.length, sites: groups.length * 2 } });

test('groupKey ignores statement and copy counts and whitespace', () => {
  assert.equal(
    groupKey(group('clone', 'near-duplicate function alpha() (also: beta), ~10 statements, structurally identical')),
    groupKey(group('clone', 'near-duplicate function alpha() (also: beta), ~12 statements, structurally identical')),
  );
  assert.equal(groupKey(group('clone', 'tiny rule f, ~3 copies in 3 files')), groupKey(group('clone', 'tiny rule f, 4 copies in 4 files')));
  assert.notEqual(groupKey(group('clone', 'x')), groupKey(group('set', 'x')));
});

test('a changed count is not gone + born', () => {
  const a = census('a'.repeat(40), [group('clone', 'near-duplicate function f(), ~10 statements, structurally identical')]);
  const b = census('b'.repeat(40), [group('clone', 'near-duplicate function f(), ~11 statements, structurally identical')]);
  const d = diffCensus(a, b);
  assert.deepEqual([d.gone, d.born], [[], []]);
  assert.equal(d.from, 'aaaaaaaa');
  assert.equal(d.to, 'bbbbbbbb');
});

test('a vanished group is gone and an appeared group is born', () => {
  const a = census('a'.repeat(40), [group('const', 'named constant MAX=1'), group('set', "string set {'a', 'b'}")]);
  const b = census('b'.repeat(40), [group('set', "string set {'a', 'b'}"), group('record', 'record assembled from the same sources {x=ID.x}')]);
  const d = diffCensus(a, b);
  assert.deepEqual(d.gone, ['const 2f named constant MAX=1 | lib/a.js lib/b.js']);
  assert.deepEqual(d.born, ['record 2f record assembled from the same sources {x=ID.x} | lib/a.js lib/b.js']);
  assert.deepEqual(d.totals, { from: { groups: 2, sites: 4 }, to: { groups: 2, sites: 4 } });
});
