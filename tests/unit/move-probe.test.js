/**
 * LIN-3861: the move probe's layout builder (tests/probes/move-probe.mjs buildLayout) on
 * synthetic files. The probe itself is not a test and never runs in CI; this checks the
 * pure parts: the body is byte-identical, the flat stub re-exports the same names (imported
 * for real from a temp dir), the nested wrapper holds the inner routes one level down, and a
 * file with an `export default` is refused. Plus the child environment and the trace reader.
 *
 * Run: node --test tests/unit/move-probe.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLayout, childEnv, readersByUnitFile, tapStatuses, diffStatuses } from '../probes/move-probe.mjs';
import { findRouteLayer } from './lib/route-layer.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

const MAIN = `import { Router } from 'express';
export const marker = 'main';
export function helper() { return 42; }
export function createWorkspaceApiRoutes(deps) {
  const router = Router();
  router.get('/ping', (req, res) => res.end(deps.tag));
  return router;
}
`;
const SIBLING = `export function createPromptsRoutes() { return 'prompts'; }\n`;

// A scratch dir with the synthetic layout written into it, and the repo's express resolvable from it.
async function withLayout(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'move-probe-test-'));
  try {
    mkdirSync(join(dir, 'routes'), { recursive: true });
    mkdirSync(join(dir, 'node_modules'));
    symlinkSync(join(root, 'node_modules', 'express'), join(dir, 'node_modules', 'express'), 'dir');
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    for (const [rel, src] of Object.entries(files)) writeFileSync(join(dir, rel), src);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('flat: the body is the original byte for byte, and the stub is a star re-export', () => {
  const out = buildLayout({ 'routes/workspace-api.js': MAIN }, { variant: 'flat' });
  assert.deepEqual(Object.keys(out).sort(), ['routes/workspace-api-body.js', 'routes/workspace-api.js']);
  assert.equal(out['routes/workspace-api-body.js'], MAIN);
  assert.equal(out['routes/workspace-api.js'], "export * from './workspace-api-body.js';\n");
});

test('flat: the stub exports the same names as the original, loaded for real from a two-file module', async () => {
  const out = buildLayout({ 'routes/workspace-api.js': MAIN }, { variant: 'flat' });
  const original = await withLayout({ 'routes/workspace-api.js': MAIN }, (dir) => import(`${pathToFileURL(join(dir, 'routes/workspace-api.js')).href}?orig`));
  const moved = await withLayout(out, (dir) => import(`${pathToFileURL(join(dir, 'routes/workspace-api.js')).href}?moved`));
  assert.deepEqual(Object.keys(moved).sort(), Object.keys(original).sort());
  assert.equal(moved.marker, 'main');
  assert.equal(moved.helper(), 42);
  assert.equal(typeof moved.createWorkspaceApiRoutes, 'function');
});

test('nested: the wrapper router holds the inner routes one level down', async () => {
  const out = buildLayout({ 'routes/workspace-api.js': MAIN }, { variant: 'nested' });
  assert.equal(out['routes/workspace-api-body.js'], MAIN);
  const moved = await withLayout(out, (dir) => import(`${pathToFileURL(join(dir, 'routes/workspace-api.js')).href}?nested`));
  assert.equal(moved.marker, 'main', 'the star export still carries the other names');
  const router = moved.createWorkspaceApiRoutes({ tag: 't' });
  assert.equal(router.stack.find(l => l.route?.path === '/ping'), undefined, 'no route at the top level of the wrapper');
  assert.equal(router.stack.length, 1, 'one mounted router');
  assert.ok(Array.isArray(router.stack[0].handle.stack), 'the mounted layer is a router');
  assert.equal(findRouteLayer(router, 'get', '/ping').route.path, '/ping', 'the shared finder descends to it');
});

test('nested: --factory names the exported factory, and a missing factory is refused', () => {
  const src = MAIN.replace('createWorkspaceApiRoutes', 'makeRoutes');
  const out = buildLayout({ 'routes/workspace-api.js': src }, { variant: 'nested', factory: 'makeRoutes' });
  assert.match(out['routes/workspace-api.js'], /export function makeRoutes\(deps\)/);
  assert.throws(() => buildLayout({ 'routes/workspace-api.js': src }, { variant: 'nested' }), /does not export createWorkspaceApiRoutes/);
});

test('all-unit: every unit file gets a -body file and a stub; other files are left alone', () => {
  const files = { 'routes/workspace-api.js': MAIN, 'routes/workspace-api-prompts.js': SIBLING, 'routes/proxy.js': 'export const x = 1;\n' };
  const out = buildLayout(files, { variant: 'all-unit' });
  assert.deepEqual(Object.keys(out).sort(), [
    'routes/workspace-api-body.js', 'routes/workspace-api-prompts-body.js', 'routes/workspace-api-prompts.js', 'routes/workspace-api.js'
  ]);
  assert.equal(out['routes/workspace-api-prompts-body.js'], SIBLING);
  assert.equal(out['routes/workspace-api-prompts.js'], "export * from './workspace-api-prompts-body.js';\n");
});

test('an export default is refused (export * would drop it), in either spelling', () => {
  for (const src of [`${MAIN}export default createWorkspaceApiRoutes;\n`, `${MAIN}export { helper as default };\n`]) {
    for (const variant of ['flat', 'nested', 'all-unit']) {
      assert.throws(() => buildLayout({ 'routes/workspace-api.js': src }, { variant }), /export default/, variant);
    }
  }
  assert.throws(() => buildLayout({ 'routes/workspace-api.js': MAIN, 'routes/workspace-api-x.js': 'export default 1;\n' }, { variant: 'all-unit' }), /workspace-api-x\.js has an export default/);
});

test('bad input is refused: unknown variant, no main file, no unit files', () => {
  assert.throws(() => buildLayout({ 'routes/workspace-api.js': MAIN }, { variant: 'sideways' }), /--variant/);
  assert.throws(() => buildLayout({ 'routes/other.js': 'x' }, { variant: 'flat' }), /not in the input files/);
  assert.throws(() => buildLayout({ 'routes/other.js': 'x' }, { variant: 'all-unit' }), /no workspace-API unit files/);
});

test('the child environment strips NODE_TEST_CONTEXT (or the inner node --test prints no TAP) and only adds the hook when tracing', () => {
  const env = { PATH: '/bin', NODE_TEST_CONTEXT: 'child-v8', NODE_OPTIONS: '--no-warnings' };
  const plain = childEnv(env);
  assert.equal('NODE_TEST_CONTEXT' in plain, false);
  assert.equal(plain.NODE_OPTIONS, '--no-warnings');
  assert.equal(plain.MOVE_PROBE_TRACE_OUT, undefined);
  const traced = childEnv(env, { traceOut: '/tmp/x.trace' });
  assert.equal('NODE_TEST_CONTEXT' in traced, false);
  assert.match(traced.NODE_OPTIONS, /^--no-warnings --import=file:\/\/.*read-trace-hook\.mjs$/);
  assert.equal(traced.MOVE_PROBE_TRACE_OUT, '/tmp/x.trace');
  assert.ok(new RegExp(traced.MOVE_PROBE_TRACE_PATTERN).test('/x/routes/workspace-api-roadmap.js'));
  assert.ok(!new RegExp(traced.MOVE_PROBE_TRACE_PATTERN).test('/x/routes/workspace-kpis.js'));
  assert.equal(env.NODE_TEST_CONTEXT, 'child-v8', 'the caller env is not mutated');
});

test('trace lines group by unit file, sorted and unique; TAP statuses diff to vanished, appeared and changed', () => {
  assert.deepEqual(readersByUnitFile('tests/unit/b.test.js\troutes/workspace-api.js\ntests/unit/a.test.js\troutes/workspace-api.js\ntests/unit/a.test.js\troutes/workspace-api.js\ntests/unit/a.test.js\tlib/workspace-api-mocks.js\n\n'), {
    'lib/workspace-api-mocks.js': ['tests/unit/a.test.js'],
    'routes/workspace-api.js': ['tests/unit/a.test.js', 'tests/unit/b.test.js']
  });
  const before = tapStatuses('ok 1 - one\nnot ok 2 - two\nok 3 - three # SKIP\n');
  const after = tapStatuses('ok 1 - one\nok 2 - two\nok 4 - four\n');
  assert.deepEqual(diffStatuses(before, after), { vanished: ['three'], appeared: ['four'], changed: [{ name: 'two', from: 'fail', to: 'pass' }] });
});
