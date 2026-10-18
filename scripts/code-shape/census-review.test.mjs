// census-review.mjs against a temp git repo built here: two commits, fixed dates, no network (LIN-3629).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './test-helpers.mjs';

const SCRIPT = fileURLToPath(new URL('./census-review.mjs', import.meta.url));
const cli = (args) => {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
};

const clone = (name, arg) => `export function ${name}(${arg}, limit) {
  const out = [];
  let total = 0;
  for (const item of ${arg}) {
    if (item && item.ok && total < limit) { out.push(item.value * 2); total += item.value; }
  }
  if (total > limit) { out.push(total); }
  return { out, total };
}
`;
const STATES = "export const A = ['open', 'closed', 'done'];\n";

let repo, first, second, scratch, areas;
before(() => {
  repo = makeRepo();
  first = repo.commit({
    'lib/a.js': STATES,
    'routes/b.js': STATES,
    'lib/c.js': clone('alpha', 'items'),
    'routes/d.js': clone('beta', 'rows'),
    'lib/x.js': "export const A = ['p', 'q'];\n",
    'lib/y.js': "export const A = ['p', 'q'];\n",
  }, '2026-05-01T00:00:00Z');
  second = repo.commit({
    'routes/b.js': `${STATES}// 'open' is the state a ticket starts in\n`,
    'ui/e.js': STATES,
    'lib/x.js': null,
    'lib/y.js': null,
  }, '2026-06-01T00:00:00Z');
  scratch = mkdtempSync(join(tmpdir(), 'census-review-'));
  areas = join(scratch, 'areas.json');
  writeFileSync(areas, JSON.stringify({ areas: [{ name: 'Core', match: ['^lib/'] }, { name: 'Edge', match: ['^routes/'] }, { name: 'Ui', match: ['^ui/'] }] }));
});
after(() => { repo.cleanup(); rmSync(scratch, { recursive: true, force: true }); });

test('ranks by places x change, with both churn numbers: a counted -G number for a set, null for a clone', () => {
  const r = cli([repo.dir, second, first, '--areas', areas]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.commit, second);
  assert.equal(r.json.previousCommit, first);
  assert.equal(r.json.baseline, false);
  assert.equal(r.json.areaGuide, areas);
  assert.deepEqual(r.json.groups.map((g) => [g.rank, g.detector, g.score]), [[1, 'set', 6], [2, 'clone', 2]]);
  const [set, clonegroup] = r.json.groups;
  assert.deepEqual(set.ownChurn, { commits: 2, pattern: '[\'"`](closed|done|open)[\'"`]' });
  assert.equal(clonegroup.ownChurn, null, 'a clone has no literal to count, which is not zero');
  assert.deepEqual(set.sites, ['lib/a.js:1', 'routes/b.js:1', 'ui/e.js:1']);
});

test('statuses against the previous commit; a group that went is listed apart with its areas from the same guide', () => {
  const r = cli([repo.dir, second, first, '--areas', areas]);
  assert.deepEqual(r.json.groups.map((g) => g.status), ['grown', 'unchanged']);
  assert.deepEqual(r.json.gone.map((g) => [g.files, g.areas]), [[['lib/x.js', 'lib/y.js'], ['Core']]], 'the previous run used the same guide (Core, not lib)');
  assert.deepEqual(r.json.groups[0].areas, ['Core', 'Edge', 'Ui']);
});

test('the rule at the CLI: --top 1 rules on the first (and any 3-area group); the second is a table row', () => {
  const g = cli([repo.dir, second, first, '--areas', areas, '--top', '1']).json.groups;
  assert.deepEqual(g.map((x) => [x.mustRule, x.table]), [[true, false], [false, true]]);
  assert.ok('ownChurn' in g[1] && !('sites' in g[1]));
  const all = cli([repo.dir, second, first, '--areas', areas, '--top', '2']).json.groups;
  assert.deepEqual(all.map((x) => x.mustRule), [true, true]);
});

test('no previous commit is the baseline: statuses null, nothing gone; JSON on stdout, summary on stderr', () => {
  const r = cli([repo.dir, second, '--areas', areas]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.baseline, true);
  assert.equal(r.json.previousCommit, null);
  assert.deepEqual(r.json.groups.map((g) => g.status), [null, null]);
  assert.deepEqual(r.json.gone, []);
  assert.match(r.stderr, /^census review [0-9a-f]{8} \(baseline\): 2 groups, 2 to rule on, 0 tabled, 0 gone, 0 unranked\n$/);
});

test('reads the commit, not the working tree', () => {
  writeFileSync(join(repo.dir, 'lib/a.js'), 'export const gone = true;\n');
  try {
    assert.equal(cli([repo.dir, second, '--areas', areas]).json.groups[0].fileCount, 3);
  } finally { repo.git('checkout', '--', '.'); }
});

test('usage errors exit 2: bad --areas, bad --top, unknown flag, missing arguments, unknown commit', () => {
  const bad = join(scratch, 'bad.json');
  writeFileSync(bad, 'nope');
  for (const args of [[repo.dir, second, '--areas', bad], [repo.dir, second, '--areas', join(scratch, 'none.json')], [repo.dir, second, '--top', 'x'], [repo.dir, second, '--nope'], [repo.dir], [repo.dir, 'no-such-commit'], [repo.dir, second, 'no-such-commit']]) {
    assert.equal(cli(args).status, 2, args.join(' '));
  }
});
