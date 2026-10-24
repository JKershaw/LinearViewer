// Tests for the change-coupling tool (LIN-3860): inline git-log text for the core, one throwaway repo for the CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileGuide } from './code-shape-lib.mjs';
import { buildReport, parseChangeLog, summariseCochange } from './cochange-core.mjs';
import { makeRepo } from './test-helpers.mjs';

const sha = (n) => String(n).padStart(40, '0');
const guide = compileGuide({ areas: [
  { name: 'Alpha', match: ['^lib/a/', '^shared/'] },
  { name: 'Beta', match: ['^lib/b/', '^shared/'] },
  { name: 'Gamma', match: ['^routes/'] },
] });
const base = { guide, commit: sha(9), windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-03-01T00:00:00.000Z', days: 60, shallow: false };
const report = (changes, extra = {}) => buildReport({ ...base, changes, ...extra });

test('parseChangeLog: one change per @sha header, files beneath it, blank lines ignored', () => {
  const log = `@${sha(1)}\n\nlib/a/x.js\nlib/b/y.js\n@${sha(2)}\n@${sha(3)}\n\nroutes/r.js\n`;
  assert.deepEqual(parseChangeLog(log), [
    { sha: sha(1), files: ['lib/a/x.js', 'lib/b/y.js'] },
    { sha: sha(2), files: [] },
    { sha: sha(3), files: ['routes/r.js'] },
  ]);
});

test('parseChangeLog: a path starting with @ is a file, not a header', () => {
  assert.deepEqual(parseChangeLog(`@${sha(1)}\n@scope/x.js\n`), [{ sha: sha(1), files: ['@scope/x.js'] }]);
});

test('areas map by first match; an unclaimed file is ignored and counted, never bucketed', () => {
  const r = report([{ sha: sha(1), files: ['shared/s.js', 'docs/readme.md', 'lib/b/y.js'] }]);
  assert.equal(r.unmappedFiles, 1);
  // shared/ is claimed by Alpha first, so Beta only via lib/b/
  assert.deepEqual(r.pairs, [{ areas: ['Alpha', 'Beta'], changes: 1 }]);
});

test('unmappedFiles counts distinct paths across the window, not occurrences', () => {
  const r = report([
    { sha: sha(1), files: ['docs/a.md', 'tests/t.js'] },
    { sha: sha(2), files: ['docs/a.md'] },
  ]);
  assert.equal(r.unmappedFiles, 2);
  assert.deepEqual(r.pairs, []);
});

test('pairs are counted per change, ordered by count desc then area names', () => {
  const r = report([
    { sha: sha(1), files: ['lib/a/1.js', 'routes/1.js'] },
    { sha: sha(2), files: ['lib/a/2.js', 'routes/2.js'] },
    { sha: sha(3), files: ['lib/b/3.js', 'routes/3.js'] },
    { sha: sha(4), files: ['lib/a/4.js', 'lib/b/4.js'] },
    { sha: sha(5), files: ['lib/a/5.js', 'lib/b/5.js', 'routes/5.js'] },
  ]);
  assert.deepEqual(r.pairs, [
    { areas: ['Alpha', 'Gamma'], changes: 3 },
    { areas: ['Alpha', 'Beta'], changes: 2 },
    { areas: ['Beta', 'Gamma'], changes: 2 },
  ]);
  assert.equal(r.changes, 5);
  assert.equal(r.changesTouchingMultipleAreas, 5);
});

test('a one-area change, even with many files, gives no pair and is not multi-area', () => {
  const r = report([{ sha: sha(1), files: ['lib/a/1.js', 'lib/a/2.js', 'lib/a/3.js'] }, { sha: sha(2), files: [] }]);
  assert.deepEqual(r.pairs, []);
  assert.equal(r.changes, 2);
  assert.equal(r.changesTouchingMultipleAreas, 0);
});

test('report carries the facts and nothing scored', () => {
  const r = report([], { shallow: true });
  assert.deepEqual(r, { commit: sha(9), windowStart: base.windowStart, windowEnd: base.windowEnd, days: 60, changes: 0, shallow: true, changesTouchingMultipleAreas: 0, unmappedFiles: 0, pairs: [] });
});

test('summariseCochange is one line with the counts', () => {
  const line = summariseCochange(report([{ sha: sha(1), files: ['lib/a/1.js', 'routes/1.js', 'x/y'] }], { shallow: true }));
  assert.equal(line.includes('\n'), false);
  assert.match(line, /cochange 0000000: 1 changes in 60 days, 1 touch 2\+ areas, 1 pairs, 1 unmapped files, shallow clone/);
});

// ── CLI on a throwaway repo ──────────────────────────────────────────────────
const cli = (args) => spawnSync('node', [new URL('./cochange.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8' });

test('CLI: merge commit is one change with first-parent files; window edges and unmapped files', () => {
  const repo = makeRepo();
  try {
    const old = repo.commit({ 'lib/a/old.js': '1', 'routes/old.js': '1' }, '2026-01-01T00:00:00Z');
    repo.commit({ 'lib/a/one.js': '1' }, '2026-02-01T00:00:00Z');
    repo.commit({ 'lib/a/two.js': '1', 'lib/b/two.js': '1', 'docs/d.md': '1' }, '2026-02-10T00:00:00Z');
    repo.git('checkout', '-q', '-b', 'feat');
    repo.commit({ 'routes/f1.js': '1' }, '2026-02-15T00:00:00Z');
    repo.commit({ 'lib/b/f2.js': '1' }, '2026-02-16T00:00:00Z');
    repo.git('checkout', '-q', 'main');
    repo.commit({ 'lib/a/m.js': '1' }, '2026-02-17T00:00:00Z');
    execMerge(repo, '2026-03-02T00:00:00Z');
    const head = repo.git('rev-parse', 'HEAD').trim();
    const areas = join(repo.dir, 'areas.json');
    writeFileSync(areas, JSON.stringify({ areas: [
      { name: 'Alpha', match: ['^lib/a/'] }, { name: 'Beta', match: ['^lib/b/'] }, { name: 'Gamma', match: ['^routes/'] },
    ] }));
    // 60 days back from 2026-03-02 is 2026-01-01T00:00:00Z: the edge commit is inside (inclusive).
    const r = cli([repo.dir, 'HEAD', '--areas', areas]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.commit, head);
    assert.equal(out.days, 60);
    assert.equal(out.shallow, false);
    assert.equal(out.windowEnd, '2026-03-02T00:00:00.000Z');
    assert.equal(out.windowStart, '2026-01-01T00:00:00.000Z');
    // old, one, two, m, merge = 5 landed changes; the branch commits are not separate changes.
    assert.equal(out.changes, 5);
    assert.equal(out.unmappedFiles, 1);
    // merge's first-parent diff = routes/f1.js + lib/b/f2.js -> Beta+Gamma; old -> Alpha+Gamma; two -> Alpha+Beta
    assert.deepEqual(out.pairs, [
      { areas: ['Alpha', 'Beta'], changes: 1 },
      { areas: ['Alpha', 'Gamma'], changes: 1 },
      { areas: ['Beta', 'Gamma'], changes: 1 },
    ]);
    assert.equal(out.changesTouchingMultipleAreas, 3);
    assert.equal(r.stderr.trim().split('\n').length, 1);

    // One day shorter: the window start passes the edge commit, which drops out.
    const short = JSON.parse(cli([repo.dir, 'HEAD', '--areas', areas, '--days', '59']).stdout);
    assert.equal(short.changes, 4);
    // The same call at an earlier commit sees only history reachable from it.
    const early = JSON.parse(cli([repo.dir, old, '--areas', areas]).stdout);
    assert.equal(early.commit, old);
    assert.equal(early.changes, 1);
  } finally { repo.cleanup(); }
});

function execMerge(repo, date) {
  spawnSync('git', ['-C', repo.dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'merge', '--no-ff', '-q', '-m', 'merge feat', 'feat'],
    { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

test('CLI: usage errors exit 2, a result never sets the exit code', () => {
  assert.equal(cli([]).status, 2);
  assert.equal(cli(['.', 'HEAD', '--nope']).status, 2);
  assert.equal(cli(['.', 'HEAD', '--days', '0']).status, 2);
  assert.equal(cli(['.', 'HEAD', '--days', 'x']).status, 2);
  assert.equal(cli(['.', 'HEAD', '--areas', '/no/such/file.json']).status, 2);
  assert.equal(cli(['.', 'no-such-commit']).status, 2);
});
