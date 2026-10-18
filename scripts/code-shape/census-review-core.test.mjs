// The pure rules of the census review (LIN-3629) on synthetic reports, at their edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byRank, ereEscape, ownChurnPattern, reviewCensus } from './census-review-core.mjs';

let n = 0;
const group = (over = {}) => {
  n++;
  const files = over.files ?? [`lib/f${n}a.js`, `lib/f${n}b.js`];
  const areas = over.areas ?? ['lib'];
  return {
    id: `G${n}`, detector: 'set', decision: `string set {'a${n}', 'b${n}'} as array`, members: [`a${n}`, `b${n}`], rankable: true,
    files, fileCount: files.length, areas, areaCount: areas.length, churn: 1, score: files.length, sites: files.map((f, i) => ({ file: f, line: i + 1 })), siteCount: files.length,
    ...over,
  };
};
const report = (groups) => ({ commit: 'c'.repeat(40), groups });
const review = (groups, opts = {}) => reviewCensus({ head: report(groups), ownChurn: () => 7, ...opts });
const byId = (r) => Object.fromEntries(r.groups.map((g) => [g.id, g]));

test('rank: score desc, then more files, then decision text; input order does not matter', () => {
  const a = group({ id: 'a', score: 10, fileCount: 2, decision: 'b' });
  const b = group({ id: 'b', score: 10, fileCount: 3, decision: 'z' });
  const c = group({ id: 'c', score: 10, fileCount: 2, decision: 'a' });
  const d = group({ id: 'd', score: 11, fileCount: 2, decision: 'z' });
  assert.deepEqual(review([a, b, c, d]).groups.map((g) => g.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(review([d, c, b, a]).groups.map((g) => [g.id, g.rank]), [['d', 1], ['b', 2], ['c', 3], ['a', 4]]);
  assert.ok(byRank({ score: 1, fileCount: 1, decision: 'B' }, { score: 1, fileCount: 1, decision: 'a' }) < 0, 'plain < ordering, not localeCompare');
});

test('the rule: --top 2 puts the third group in table, not mustRule', () => {
  const r = review([group({ id: 'g1', score: 9, files: ['lib/a.js', 'lib/b.js', 'lib/c.js'] }), group({ id: 'g2', score: 8, files: ['lib/a.js', 'lib/b.js', 'lib/c.js'] }), group({ id: 'g3', score: 7, files: ['lib/a.js', 'lib/b.js', 'lib/c.js'] })], { top: 2 });
  const g = byId(r);
  assert.deepEqual([g.g1.mustRule, g.g2.mustRule, g.g3.mustRule], [true, true, false]);
  assert.deepEqual([g.g1.table, g.g2.table, g.g3.table], [false, false, true]);
});

test('the rule: 3 areas outside the top is mustRule; 2 areas is table; 2 files in one area is neither', () => {
  const three = group({ id: 'three', score: 1, areas: ['a', 'b', 'c'], files: ['a/1.js', 'b/1.js', 'c/1.js'] });
  const two = group({ id: 'two', score: 2, areas: ['a', 'b'], files: ['a/1.js', 'b/1.js'] });
  const one = group({ id: 'one', score: 3, files: ['lib/x.js', 'lib/y.js'] });
  const wide = group({ id: 'wide', score: 4, areas: ['a'], files: ['lib/1.js', 'lib/2.js', 'lib/3.js'] });
  const top = group({ id: 'top', score: 99 });
  const g = byId(review([three, two, one, wide, top], { top: 1 }));
  assert.deepEqual([g.top.mustRule, g.top.table], [true, false]);
  assert.deepEqual([g.three.mustRule, g.three.table], [true, false]);
  assert.deepEqual([g.two.mustRule, g.two.table], [false, true]);
  assert.deepEqual([g.wide.mustRule, g.wide.table], [false, true], '3 files in one area is a table row');
  assert.deepEqual([g.one.mustRule, g.one.table], [false, false]);
  assert.ok(!('ownChurn' in g.one) && !('sites' in g.one), 'a group that is neither carries no own churn and no sites');
});

test('own churn is read only for flagged groups; clone and record groups report null, not 0; sites only on mustRule', () => {
  const seen = [];
  const r = review([
    group({ id: 'clone', detector: 'clone', decision: 'near-duplicate function f()', score: 5 }),
    group({ id: 'rec', detector: 'record', decision: 'record', score: 4 }),
    group({ id: 'set', score: 3, files: ['lib/a.js', 'lib/b.js', 'lib/c.js'] }),
  ], { top: 2, ownChurn: (g, spec) => { seen.push(g.id); return 4; } });
  const g = byId(r);
  assert.equal(g.clone.ownChurn, null);
  assert.equal(g.rec.ownChurn, null);
  assert.equal(g.set.ownChurn.commits, 4);
  assert.deepEqual(seen, ['set'], 'no git read for groups that have no pattern');
  assert.match(g.clone.sites[0], /^lib\/f\d+a\.js:1$/, 'mustRule groups list their sites as file:line');
  assert.ok(!('sites' in g.set));
});

test('unranked structure-only clones are counted, not ranked', () => {
  const r = review([group({ id: 'ok' }), group({ id: 'weak', detector: 'clone', rankable: false, score: 1000 })]);
  assert.deepEqual(r.groups.map((g) => g.id), ['ok']);
  assert.equal(r.counts.unranked, 1);
});

test('statuses: new, grown, shrunk, unchanged; gone listed apart; null with no previous commit', () => {
  const mk = (id, decision, sites) => group({ id, decision, files: sites, siteCount: sites.length, sites: sites.map((f) => ({ file: f, line: 1 })) });
  const f = (k) => Array.from({ length: k }, (_, i) => `lib/${i}.js`);
  const head = [mk('n', 'new one', f(2)), mk('g', 'grown one', f(4)), mk('s', 'shrunk one', f(2)), mk('u', 'same one', f(3))];
  const previous = report([mk('g0', 'grown one', f(2)), mk('s0', 'shrunk one', f(5)), mk('u0', 'same one', f(3)), mk('x0', 'vanished', f(2))]);
  const r = reviewCensus({ head: report(head), previous, ownChurn: () => 0 });
  const g = byId(r);
  assert.deepEqual([g.n.status, g.g.status, g.s.status, g.u.status], ['new', 'grown', 'shrunk', 'unchanged']);
  assert.deepEqual(r.gone.map((x) => x.decision), ['vanished']);
  const base = reviewCensus({ head: report(head), ownChurn: () => 0 });
  assert.deepEqual(base.groups.map((x) => x.status), [null, null, null, null]);
  assert.deepEqual(base.gone, []);
});

test('status key ignores statement and copy counts (groupKey), so a moved count is not gone + new', () => {
  const a = group({ id: 'a', detector: 'clone', decision: 'near-duplicate function f(), ~8 statements, fuzzy' });
  const b = group({ id: 'b', detector: 'clone', decision: 'near-duplicate function f(), ~9 statements, fuzzy' });
  const r = reviewCensus({ head: report([b]), previous: report([a]), ownChurn: () => 0 });
  assert.equal(r.groups[0].status, 'unchanged');
  assert.deepEqual(r.gone, []);
});

test('duplicate keys pair off in rank order; the leftover is new or gone', () => {
  const dup = (id, score) => group({ id, decision: 'same decision', score });
  const two = reviewCensus({ head: report([dup('h1', 5), dup('h2', 4)]), previous: report([dup('p1', 9)]), ownChurn: () => 0 });
  assert.deepEqual(two.groups.map((g) => [g.id, g.status]), [['h1', 'unchanged'], ['h2', 'new']]);
  const one = reviewCensus({ head: report([dup('h1', 5)]), previous: report([dup('p1', 9), dup('p2', 3)]), ownChurn: () => 0 });
  assert.deepEqual(one.groups.map((g) => g.status), ['unchanged']);
  assert.deepEqual(one.gone.map((g) => g.id), ['p2']);
});

test('own-churn patterns per detector, ERE-escaped', () => {
  assert.deepEqual(ownChurnPattern({ detector: 'set', members: ['a.b', 'c|d'] }), { pattern: '[\'"`](a\\.b|c\\|d)[\'"`]', ignoreCase: false });
  assert.equal(ownChurnPattern({ detector: 'set+discrim', members: ['x'] }).pattern, '[\'"`](x)[\'"`]');
  assert.deepEqual(ownChurnPattern({ detector: 'const', sites: [{ label: 'MAX_MS' }] }), { pattern: 'MAX_MS', ignoreCase: false });
  assert.deepEqual(ownChurnPattern({ detector: 'contract', decision: 'text contract heading: next steps' }), { pattern: 'next[[:space:]]+steps', ignoreCase: true });
  assert.deepEqual(ownChurnPattern({ detector: 'contract', decision: 'text contract marker: [blocked]' }), { pattern: '\\[blocked\\]', ignoreCase: false });
  assert.equal(ownChurnPattern({ detector: 'cmp', value: 'blocked' }).pattern, '[\'"`](blocked)[\'"`]');
  assert.equal(ownChurnPattern({ detector: 'clone', sites: [] }), null);
  assert.equal(ownChurnPattern({ detector: 'record', sites: [] }), null);
  assert.equal(ereEscape('a+b(c)[d]{e}^$\\'), 'a\\+b\\(c\\)\\[d\\]\\{e\\}\\^\\$\\\\');
});
