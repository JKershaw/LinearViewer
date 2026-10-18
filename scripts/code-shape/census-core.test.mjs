// Census core on inline fixtures (LIN-3628), plus a parity check against the original script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runCensus, serialiseCensus, T } from './census-core.mjs';
import { makeRepo } from './test-helpers.mjs';

const run = (files, extra = {}) => runCensus({ files, commit: 'c'.repeat(40), commitDate: '2026-01-01T00:00:00Z', churnDays: 90, ...extra });
const detectors = (r) => r.groups.map((g) => g.detector).sort();

const fn = (name, arg = 'items') => `export function ${name}(${arg}, limit) {
  const out = [];
  let total = 0;
  for (const item of ${arg}) {
    if (item && item.ok && total < limit) { out.push(item.value * 2); total += item.value; }
  }
  if (total > limit) { out.push(total); }
  return { out, total };
}
`;

// Exactly `n` statements (4 consts or fewer, then a return) with enough syntax nodes to pass cloneMinNodes.
const sized = (name, n) => `export function ${name}(a, b) {
${[
  '  const x = a.items.map((i) => i.value * b.factor + a.offset);',
  '  const y = x.filter((v) => v > b.min && v < b.max || v === a.special);',
  '  const z = y.reduce((s, v) => s + v * a.weight - b.bias, a.start);',
  '  const w = { x, y, z, total: z / (y.length || 1), label: a.label + b.label };',
].slice(0, n - 1).join('\n')}
  return a.label + b.label + x.length + y.length + z + (w ? 1 : 0);
}
`;

test('clone: structurally identical functions in two files form a group, whatever they are called', () => {
  const r = run({ 'lib/a.js': fn('alpha', 'items'), 'routes/b.js': fn('beta', 'rows') });
  assert.deepEqual(detectors(r), ['clone']);
  assert.deepEqual(r.groups[0].files, ['lib/a.js', 'routes/b.js']);
  assert.deepEqual(r.groups[0].areas, ['lib', 'routes']);
});

test('clone threshold edge: five statements is a clone, four is not', () => {
  assert.equal(T.cloneMinStatements, 5);
  assert.deepEqual(detectors(run({ 'lib/a.js': sized('a', 5), 'lib/b.js': sized('b', 5) })), ['clone']);
  assert.deepEqual(detectors(run({ 'lib/a.js': sized('a', 4), 'lib/b.js': sized('b', 4) })), []);
});

test('set + discrim: a status list in one file and a switch over the same statuses in another are one decision', () => {
  const r = run({
    'lib/a.js': "export const A = ['open', 'closed', 'done', 'blocked'];\n",
    'routes/b.js': "export function g(x) { switch (x.status) { case 'open': return 1; case 'closed': return 2; case 'done': return 3; case 'blocked': return 4; default: return 0; } }\n",
  });
  assert.deepEqual(detectors(r), ['set+discrim']);
  assert.match(r.groups[0].decision, /'blocked', 'closed', 'done', 'open'/);
});

test('record: object literals built from the same sources in two files', () => {
  const rec = (extra) => `export const mk = (s) => ({ id: s.id, name: s.name, state: s.state, owner: s.owner, ${extra}: s.x });\n`;
  const r = run({ 'lib/a.js': rec('a1'), 'lib/b.js': rec('a1') });
  assert.deepEqual(detectors(r), ['record']);
});

test('const: the same named constant with the same value in two files', () => {
  const r = run({ 'lib/a.js': 'export const MAX_ITEMS_PER_PAGE = 250;\n', 'lib/b.js': 'const MAX_ITEMS_PER_PAGE = 250;\n' });
  assert.deepEqual(detectors(r), ['const']);
});

test('contract: a heading one file writes and another parses', () => {
  const r = run({
    'lib/a.js': 'export const h = (n) => `## Open Questions\\n${n}`;\n',
    'lib/b.js': "export const p = (t) => t.split('## Open Questions')[1];\n",
  });
  assert.deepEqual(detectors(r), ['contract']);
  assert.match(r.groups[0].decision, /open questions/);
});

test('a decision in one file only is not a group', () => {
  assert.deepEqual(detectors(run({ 'lib/a.js': fn('alpha') })), []);
});

test('an area map assigns areas; a file no area claims falls back to its top-level directory', () => {
  const areaMap = { areas: [{ name: 'Core', match: ['^lib/'] }] };
  const r = run({ 'lib/a.js': fn('alpha'), 'routes/b.js': fn('beta') }, { areaMap });
  assert.deepEqual(r.groups[0].areas, ['Core', 'routes']);
});

test('churn counts distinct commits per group over its files', () => {
  const fileCommits = new Map([['lib/a.js', new Set(['x', 'y'])], ['routes/b.js', new Set(['y', 'z'])]]);
  const g = run({ 'lib/a.js': fn('alpha'), 'routes/b.js': fn('beta') }, { fileCommits }).groups[0];
  assert.equal(g.churn, 3);
  assert.equal(g.score, 6);
});

test('--redact replaces matching text in every output string', () => {
  const r = run({ 'lib/a.js': 'export const MODE = "secret-mode";\n', 'lib/b.js': 'const MODE = "secret-mode";\n' });
  assert.match(serialiseCensus(r), /secret-mode/);
  const redacted = serialiseCensus(r, 'SECRET-mode');
  assert.doesNotMatch(redacted, /secret-mode/);
  assert.match(redacted, /<redacted>/);
});

// While the original script exists, the wrapped core must give its JSON on the same repo (the `repo` field aside).
const ORIGINAL = fileURLToPath(new URL('../../experiments/consolidate-1-census/census.mjs', import.meta.url));
test('parity: runCensus equals the original script on a fixture repo', { skip: !existsSync(ORIGINAL) }, async () => {
  const repo = makeRepo();
  try {
    repo.commit({ 'lib/a.js': fn('alpha'), 'routes/b.js': fn('beta', 'rows'), 'lib/c.js': 'export const MAX_ITEMS_PER_PAGE = 250;\n', 'public/d.js': 'const MAX_ITEMS_PER_PAGE = 250;\n' }, '2026-01-01T00:00:00Z');
    const sha2 = repo.commit({ 'lib/a.js': fn('alpha', 'rows') }, '2026-01-02T00:00:00Z');
    // The original resolves acorn from the repo it reads.
    symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(repo.dir, 'node_modules'), 'dir');
    const original = JSON.parse(execFileSync('node', [ORIGINAL, repo.dir, sha2], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const { readCommit, churnByFile, compileScope } = await import('./code-shape-lib.mjs');
    const { sha: full, commitDate, files } = readCommit(repo.dir, sha2, compileScope({ include: '^(server\\.js$|(lib|routes|public)/.*\\.[cm]?js$)' }));
    const mine = JSON.parse(serialiseCensus(run(files, { commit: full, commitDate, repo: original.repo, fileCommits: churnByFile(repo.dir, full, commitDate, 90, Object.keys(files)) })));
    assert.ok(original.groups.length >= 2 && original.groups.some((g) => g.churn > 0));
    assert.deepEqual(mine, original);
  } finally { repo.cleanup(); }
});

// ── cmp: repeated single comparisons (LIN-3629) ─────────────────────────────
const cmpGroups = (r) => r.groups.filter((g) => g.detector === 'cmp');

test('cmp: one subject compared with the same literal in two files is a group keyed by last name + literal', () => {
  const r = run({
    'lib/a.js': "export const f = (x) => x.status === 'blocked';\n",
    'routes/b.js': "export const g = (job) => 'blocked' != job.state.status && job.id;\n",
    'lib/c.js': "export const h = (x) => x.status === 'open';\n",
  });
  assert.deepEqual(cmpGroups(r).map((g) => [g.decision, g.files]), [["repeated comparison status == 'blocked'", ['lib/a.js', 'routes/b.js']]]);
  assert.equal(r.totals.byDetector.cmp.groups, 1);
});

test('cmp: typeof checks are dropped, on either side', () => {
  const r = run({
    'lib/a.js': "export const f = (x) => typeof x === 'string' && 'string' === typeof x;\n",
    'lib/b.js': "export const g = (x) => typeof x === 'string';\n",
  });
  assert.deepEqual(cmpGroups(r), []);
});

test('cmp: a switch case counts, and a call subject is keyed as name()', () => {
  const r = run({
    'lib/a.js': "export function f(x) { switch (x.kind) { case 'ping': return 1; default: return 0; } }\n",
    'lib/b.js': "export const g = (y) => y.kind === 'ping';\n",
    'lib/c.js': "export const h = (y) => getMode(y) === 'fast';\n",
    'lib/d.js': "export const i = (z) => getMode(z) == 'fast';\n",
  });
  assert.deepEqual(cmpGroups(r).map((g) => g.decision).sort(), ["repeated comparison getMode() == 'fast'", "repeated comparison kind == 'ping'"]);
});

test('cmp: a comparison inside a grouped chain is not counted again; a chain that formed no group hides nothing', () => {
  const chain = "export const f = (x) => x.status === 'open' || x.status === 'closed';\n";
  // The chain is in two files, so the set/discrim group owns both comparisons.
  const grouped = run({ 'lib/a.js': chain, 'lib/b.js': chain });
  assert.deepEqual(detectors(grouped), ['discrim']);
  // The same chain in ONE file forms no group, so its comparisons are free to repeat elsewhere.
  const alone = run({ 'lib/a.js': chain, 'lib/b.js': "export const g = (x) => x.status === 'open';\n" });
  assert.deepEqual(cmpGroups(alone).map((g) => g.decision), ["repeated comparison status == 'open'"]);
});

test('cmp: a repeat inside one file is not a group; a constant resolves to its literal', () => {
  assert.deepEqual(cmpGroups(run({ 'lib/a.js': "export const f = (x, y) => x.status === 'blocked' || y.status === 'blocked';\n" })), []);
  const r = run({
    'lib/a.js': "const BLOCKED = 'blocked';\nexport const f = (x) => x.status === BLOCKED;\n",
    'lib/b.js': "export const g = (x) => x.status === 'blocked';\n",
  });
  assert.deepEqual(cmpGroups(r).map((g) => g.siteCount), [2]);
});

test('cmp is the one addition to the parity fixture: it holds no repeated comparison, so parity is still meaningful', () => {
  assert.deepEqual(cmpGroups(run({ 'lib/a.js': fn('alpha'), 'routes/b.js': fn('beta') })), []);
});
