// The CLIs against a temp git repo built here: fixed dates, no network, nothing about this repo's numbers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './test-helpers.mjs';

const KIT = fileURLToPath(new URL('./', import.meta.url));
const cli = (script, args, { cwd, env, kit = KIT } = {}) => {
  const r = spawnSync('node', [join(kit, script), ...args], { encoding: 'utf8', cwd, env: { ...process.env, ...env } });
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

let repo, first, second, third;
before(() => {
  repo = makeRepo();
  first = repo.commit({
    'lib/a.js': clone('alpha', 'items'),
    'routes/b.js': clone('beta', 'rows'),
    'lib/stable.js': 'export const stable = 1;\n',
    'lib/broken.js': 'export function (\n',
    'lib/a.test.js': 'export const t = 1;\n',
    'README.md': 'one\n',
  }, '2025-01-01T00:00:00Z');
  second = repo.commit({ 'lib/a.js': `${clone('alpha', 'items')}// touched\n`, 'lib/a.test.js': 'export const t = 2;\n', 'README.md': 'two\n' }, '2026-06-01T00:00:00Z');
  third = repo.commit({ 'routes/b.js': clone('beta', 'cells') }, '2026-06-02T00:00:00Z');
});
after(() => repo.cleanup());

test('census reads the commit, not the working tree', () => {
  writeFileSync(join(repo.dir, 'lib/a.js'), 'export const gone = true;\n'); // uncommitted edit
  rmSync(join(repo.dir, 'routes/b.js'));
  try {
    const r = cli('census.mjs', [repo.dir, third]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.commit, third);
    assert.deepEqual(r.json.groups.map((g) => g.detector), ['clone']);
    assert.deepEqual(r.json.groups[0].files, ['lib/a.js', 'routes/b.js']);
    assert.match(r.stderr, /^census [0-9a-f]{8}: /);
  } finally { repo.git('checkout', '--', '.'); }
});

test('census: a file that does not parse is listed, not fatal; test files are out of scope by default', () => {
  const r = cli('census.mjs', [repo.dir, third]);
  assert.equal(r.status, 0);
  assert.deepEqual(r.json.scope.parseErrors.map((e) => e.file), ['lib/broken.js']);
  assert.ok(!JSON.stringify(r.json).includes('a.test.js'));
});

test('census: --include / --exclude narrow the scope', () => {
  assert.equal(cli('census.mjs', [repo.dir, third, '--include', '^lib/']).json.groups.length, 0);
  assert.equal(cli('census.mjs', [repo.dir, third, '--exclude', '^routes/']).json.groups.length, 0);
  assert.equal(cli('census.mjs', [repo.dir, third, '--exclude', '^$']).json.scope.files, 5, 'a replaced exclude brings the test file back');
});

test('census: the churn window counts commits that touch the group files by date', () => {
  const churn = (days) => cli('census.mjs', [repo.dir, third, '--churn-days', String(days)]).json.groups[0].churn;
  assert.equal(churn(7), 2, 'the two June commits');
  assert.equal(churn(700), 3, 'the 2025 commit as well');
});

test('census: --out writes the file and leaves stdout empty; --redact applies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-shape-out-'));
  try {
    const out = join(dir, 'c.json');
    const r = cli('census.mjs', [repo.dir, third, '--out', out, '--redact', 'alpha']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    const text = readFileSync(out, 'utf8');
    assert.doesNotMatch(text, /alpha/);
    assert.match(text, /<redacted>/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('usage errors exit 2: missing or malformed --areas, unknown flag, missing arguments, unknown commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-shape-areas-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'nope');
    for (const script of ['census.mjs', 'shape.mjs']) {
      assert.equal(cli(script, [repo.dir, third, '--areas', join(dir, 'missing.json')]).status, 2, script);
      assert.equal(cli(script, [repo.dir, third, '--areas', join(dir, 'bad.json')]).status, 2, script);
      assert.equal(cli(script, [repo.dir, third, '--nope']).status, 2, script);
      assert.equal(cli(script, [repo.dir]).status, 2, script);
      assert.equal(cli(script, [repo.dir, 'no-such-commit']).status, 2, script);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('shape: per-file facts, totals and the area rollup from --areas; parse failures listed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-shape-areas-'));
  try {
    writeFileSync(join(dir, 'areas.json'), JSON.stringify({ areas: [{ name: 'Core', match: ['^lib/'] }] }));
    const r = cli('shape.mjs', [repo.dir, second, '--areas', join(dir, 'areas.json')]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.json.files.map((f) => f.path), ['lib/a.js', 'lib/stable.js', 'routes/b.js']);
    assert.deepEqual(r.json.scope.parseFailures.map((f) => f.file), ['lib/broken.js']);
    assert.deepEqual(r.json.areas.map((a) => [a.area, a.files]), [['Core', 2], ['routes', 1]]);
    assert.equal(r.json.totals.files, 3);
    assert.ok(r.json.definitions.cyclomatic);
    assert.ok(!('perFunction' in r.json.files[0]));
    assert.ok('perFunction' in cli('shape.mjs', [repo.dir, second, '--functions']).json.files[0]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verbatim: the default file set is the in-scope files changed between the commits', () => {
  const areas = join(mkdtempSync(join(tmpdir(), 'code-shape-areas-')), 'areas.json');
  writeFileSync(areas, JSON.stringify({ areas: [{ name: 'Core', match: ['^lib/'] }] }));
  const r = cli('verbatim.mjs', [repo.dir, first, second, '--areas', areas]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.json.regions.map((x) => x.region), ['Core']);
  assert.deepEqual(r.json.oldFiles, ['lib/a.js']);
  assert.deepEqual(r.json.newFiles, ['lib/a.js']);
  assert.equal(r.json.raw.newLines, r.json.raw.matched, 'a comment-only change leaves every line verbatim');
  assert.equal(r.json.raw.newVerbatimPct, 100);
  const explicit = cli('verbatim.mjs', [repo.dir, first, third, '--old', 'routes/b.js', '--new', 'routes/b.js', '--areas', areas]);
  rmSync(join(areas, '..'), { recursive: true, force: true });
  assert.ok(explicit.json.raw.newVerbatimPct < 100, 'a renamed parameter changes lines');
  assert.deepEqual(explicit.json.regions.map((x) => x.region), ['routes']);
});

// A tiny test that reads the target as text: it fails only when the comment is gone.
const PROBE_FILES = {
  'lib/target.js': '// marker: keep me\nexport const value = 1;\n',
  'tests/t.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('target keeps its marker', () => { assert.match(readFileSync('lib/target.js', 'utf8'), /marker/); });
test('target exports the value', async () => { assert.equal((await import('../lib/target.js')).value, 1); });
test('known failure', () => { assert.fail('always'); });
`,
  'package.json': '{"type":"module"}\n',
};

test('probe: reports the failure a rewrite adds; baseline failures are data; the temp tree is removed', () => {
  const probeRepo = makeRepo();
  const scratch = mkdtempSync(join(tmpdir(), 'code-shape-scratch-'));
  try {
    const sha = probeRepo.commit(PROBE_FILES, '2026-01-01T00:00:00Z');
    writeFileSync(join(probeRepo.dir, 'lib/target.js'), '// working tree edit\n'); // must not be what the probe sees
    const r = cli('probe.mjs', [probeRepo.dir, sha, '--target', 'lib/target.js', '--test-cmd', 'node --test --test-reporter=tap tests/t.test.js'], { env: { TMPDIR: scratch } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.json.baseline.failures.map((f) => f.name), ['known failure']);
    assert.equal(r.json.baseline.tapSeen, true);
    const byName = Object.fromEntries(r.json.rewrites.map((x) => [x.rewrite, x]));
    assert.deepEqual(byName.nocomment.addedFailures.map((f) => f.name), ['target keeps its marker']);
    assert.equal(byName.nocomment.astEqual, true);
    assert.deepEqual(byName.indent.addedFailures, []);
    assert.deepEqual(r.json.skipped, [{ rewrite: 'rename', reason: 'no --rename-map' }]);
    assert.deepEqual(readdirSync(scratch), [], 'the extracted tree is gone');
    const kept = cli('probe.mjs', [probeRepo.dir, sha, '--target', 'lib/target.js', '--test-cmd', 'true', '--keep'], { env: { TMPDIR: scratch } });
    assert.equal(readFileSync(join(kept.json.tree, 'lib/target.js'), 'utf8'), PROBE_FILES['lib/target.js'], '--keep leaves the tree with the target restored');
    rmSync(kept.json.tree, { recursive: true, force: true });
    assert.equal(readFileSync(join(probeRepo.dir, 'lib/target.js'), 'utf8'), '// working tree edit\n', 'the working tree is untouched');
  } finally { probeRepo.cleanup(); rmSync(scratch, { recursive: true, force: true }); }
});

test('probe: a rewrite that throws is reported as an error entry and the other rewrites still run', () => {
  const probeRepo = makeRepo();
  const scratch = mkdtempSync(join(tmpdir(), 'code-shape-scratch-'));
  try {
    const sha = probeRepo.commit(PROBE_FILES, '2026-01-01T00:00:00Z');
    writeFileSync(join(scratch, 'boom.mjs'), "export default { boom: () => { throw new Error('cannot rewrite'); } };\n");
    const r = cli('probe.mjs', [probeRepo.dir, sha, '--target', 'lib/target.js', '--test-cmd', 'node --test --test-reporter=tap tests/t.test.js', '--perturb-module', join(scratch, 'boom.mjs')]);
    assert.equal(r.status, 0, r.stderr);
    const byName = Object.fromEntries(r.json.rewrites.map((x) => [x.rewrite, x]));
    assert.deepEqual(Object.keys(byName), ['indent', 'nocomment', 'boom']);
    assert.deepEqual(byName.boom, { rewrite: 'boom', error: 'cannot rewrite' });
    assert.deepEqual(byName.nocomment.addedFailures.map((f) => f.name), ['target keeps its marker']);
    assert.deepEqual(byName.indent.addedFailures, []);
  } finally { probeRepo.cleanup(); rmSync(scratch, { recursive: true, force: true }); }
});

test('probe: --rename-map and --perturb-module add rewrites; a bad --target or --perturb-module exits 2', () => {
  const probeRepo = makeRepo();
  const scratch = mkdtempSync(join(tmpdir(), 'code-shape-scratch-'));
  try {
    const sha = probeRepo.commit(PROBE_FILES, '2026-01-01T00:00:00Z');
    writeFileSync(join(scratch, 'map.json'), '{"value":"amount"}');
    writeFileSync(join(scratch, 'custom.mjs'), "export default { shout: (t) => t.replace('keep me', 'KEEP ME') };\n");
    const base = [probeRepo.dir, sha, '--target', 'lib/target.js', '--test-cmd', 'node --test --test-reporter=tap tests/t.test.js'];
    const r = cli('probe.mjs', [...base, '--rename-map', join(scratch, 'map.json'), '--perturb-module', join(scratch, 'custom.mjs')]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.json.rewrites.map((x) => x.rewrite), ['indent', 'nocomment', 'rename', 'shout']);
    assert.deepEqual(r.json.rewrites.find((x) => x.rewrite === 'rename').addedFailures.map((f) => f.name), ['target exports the value']);
    assert.deepEqual(r.json.skipped, []);
    assert.equal(cli('probe.mjs', [probeRepo.dir, sha, '--target', 'lib/none.js', '--test-cmd', 'true']).status, 2);
    assert.equal(cli('probe.mjs', [probeRepo.dir, sha, '--target', '../x.js', '--test-cmd', 'true']).status, 2);
    assert.equal(cli('probe.mjs', [...base, '--perturb-module', join(scratch, 'missing.mjs')]).status, 2);
    assert.deepEqual(readdirSync(scratch).sort(), ['custom.mjs', 'map.json']);
  } finally { probeRepo.cleanup(); rmSync(scratch, { recursive: true, force: true }); }
});

test('without acorn each CLI that parses code prints "run npm install" and exits 2', () => {
  // A copy of the kit in a directory with no node_modules above it. (verbatim.mjs parses nothing, so its core never needs acorn.)
  const dir = mkdtempSync(join(tmpdir(), 'code-shape-noacorn-'));
  try {
    cpSync(KIT, dir, { recursive: true, filter: (p) => !p.endsWith('.test.mjs') });
    for (const [script, args] of [['census.mjs', [repo.dir, third]], ['shape.mjs', [repo.dir, third]], ['probe.mjs', [repo.dir, third, '--target', 'lib/a.js', '--test-cmd', 'true']]]) {
      const r = cli(script, args, { kit: dir });
      assert.equal(r.status, 2, `${script}: ${r.stderr}`);
      assert.match(r.stderr, /run npm install/, script);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the copy used above really has no acorn on its path', () => {
  assert.ok(!existsSync(join(tmpdir(), 'node_modules', 'acorn')));
});
