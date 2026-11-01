/**
 * LIN-4080 W7 — the `addItem` caller census.
 *
 * `addItem` is the one write path that puts a row into the dispatch queue. A
 * new caller can create work that reaches a stopped run without going through
 * the admission guard, the wake gate or the cleanup. So this census pins the
 * whole caller set (by file and enclosing function, from the AST, so a caller in
 * a comment or a string is not counted) and requires each caller to record its
 * position on stopped runs. A new writer therefore fails here until it takes a
 * position: add it to POSITIONS, and gate it if it can reach a run.
 *
 * Pattern: tests/unit/lin-3136-enqueue-census.test.js (the createDispatchItem
 * sinks); this census is the store-level twin.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import * as acorn from 'acorn';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every `addItem` caller, keyed `file::enclosingFunction`, with the stopped-run position it takes. */
const POSITIONS = {
  'lib/dispatch-store.js::expandCascadeAborts':
    'abort rows: exempt from admission (createDispatchItem); their [aborted] landing runs the queued-wake cleanup in addFeedback',
  'lib/dispatch-store.js::_mintWake':
    'wake rows: gated upstream in addFeedback (parent-stopped) before grant lookup, provisioning and the terminalWakeItems CAS',
  'lib/dispatch-store.js::addFeedback':
    'the unguarded [pending] wake row: gated upstream in addFeedback (parent-stopped), so it never reaches this write for a stopped parent',
  'lib/dispatch-factory.js::createDispatchItem':
    'fresh and follow-up dispatches: guardRunStopped refuses a sessionId or followUpTo naming a stopped run (RUN_STOPPED) before any mint'
};

/** Recursively collect the `.js` files of the scanned trees, relative to the repo. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) out.push(relative(REPO, full));
    }
  };
  walk(join(REPO, 'lib'));
  for (const name of readdirSync(join(REPO, 'routes'))) {
    if (name.endsWith('.js')) out.push(join('routes', name));
  }
  out.push('server.js');
  return out.sort();
}

/**
 * The enclosing function name of every `<expr>.addItem(...)` call in `source`,
 * one entry per call. Pure: the AST is the only input.
 *
 * @param {string} source
 * @returns {string[]} enclosing function name per call ('<module>' at top level)
 */
function addItemCallers(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const callers = [];
  (function visit(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    let next = scope;
    if (node.type === 'MethodDefinition' && node.key?.name) next = node.key.name;
    if (node.type === 'FunctionDeclaration' && node.id?.name) next = node.id.name;
    if (node.type === 'VariableDeclarator' && node.id?.name && node.init
      && /Function/.test(node.init.type)) next = node.id.name;
    if (node.type === 'CallExpression'
      && node.callee.type === 'MemberExpression'
      && !node.callee.computed
      && node.callee.property.name === 'addItem') {
      callers.push(scope);
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(child => visit(child, next));
      else if (value && typeof value.type === 'string') visit(value, next);
    }
  })(ast, '<module>');
  return callers;
}

/**
 * The census of a set of sources: `{ 'file::fn': count }`.
 *
 * @param {Record<string, string>} sources file -> source text
 * @returns {Record<string, number>}
 */
function censusOf(sources) {
  const counts = {};
  for (const [file, source] of Object.entries(sources)) {
    for (const fn of addItemCallers(source)) {
      const key = `${file}::${fn}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function liveSources() {
  return Object.fromEntries(sourceFiles().map(file => [file, readFileSync(join(REPO, file), 'utf8')]));
}

describe('LIN-4080 W7 — the addItem caller census', () => {
  test('the production caller set is exactly the pinned set (a new writer fails until it takes a position)', () => {
    const actual = censusOf(liveSources());
    const expected = Object.fromEntries(Object.keys(POSITIONS).map(key => [key, 1]));
    assert.deepEqual(
      actual,
      expected,
      'a new addItem caller must be added to POSITIONS in this census, with the stopped-run position it takes (and gated if it can reach a run)'
    );
  });

  test('every pinned caller records a non-empty stopped-run position, and no stale entry remains', () => {
    for (const [key, position] of Object.entries(POSITIONS)) {
      assert.ok(typeof position === 'string' && position.trim().length > 0, `${key} has no recorded position`);
    }
    const census = censusOf(liveSources());
    for (const key of Object.keys(census)) {
      assert.ok(key in POSITIONS, `${key} calls addItem but has no recorded position`);
    }
  });

  test('witness: the scanner sees a planted fifth caller in a new method, and the census would fail', () => {
    const source = readFileSync(join(REPO, 'lib/dispatch-store.js'), 'utf8');
    const planted = source.replace(
      'async removeItem(urlKey, itemId) {',
      'async _plantedWriter(urlKey) { return this.addItem(urlKey, { prompt: "planted" }); }\n\n  async removeItem(urlKey, itemId) {'
    );
    assert.notEqual(planted, source, 'the plant must have landed');
    const actual = censusOf({ ...liveSources(), 'lib/dispatch-store.js': planted });
    assert.equal(actual['lib/dispatch-store.js::_plantedWriter'], 1, 'the new caller is seen by enclosing function');
    assert.notDeepEqual(actual, censusOf(liveSources()), 'the census no longer equals the pinned set');
  });

  test('the scanner ignores a call that is only mentioned in a comment or a string', () => {
    const source = '// store.addItem(urlKey, {})\nconst s = "this.addItem(x)";\nfunction quiet() { return 1; }\n';
    assert.deepEqual(addItemCallers(source), []);
  });
});
