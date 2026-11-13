/**
 * The bridge inventory (LIN-4471): the one place a module-to-global bridge is checked. A bridge is a name a module
 * writes to the global object (`window.X = …`, anywhere in the module, not only at its top level) so that classic page
 * scripts can read it. The inventory fails on growth (a new name), on a declared name no module writes, on a classic
 * reader the table does not register, on a registered consumer that no longer reads, and on a renderer that names a
 * consumer without the module shim. Pure: the caller passes the sources, so tests/unit/bridge-inventory.test.js can run
 * the same checks on synthetic inputs.
 *
 * The timing rule the registered consumers share (LIN-4446): a module runs after every classic script, so a classic
 * consumer may read the bridged name only from a handler or callback that runs after DOMContentLoaded, never during its
 * own execution. Each consumer's witness test loads the consumer first and calls `loadCostFormat` only after that, and
 * the inventory checks the order: the witness's first `loadCostFormat(` call must come after the point where it loads
 * the consumer, either a `loadWorld(` call whose `scripts` list names the consumer, or the first `world.run(` that
 * follows a `readFileSync` of the consumer (see `witnessProblem`).
 *
 * Scope: this helper checks the CostFormat bridge only. The witness check is written for `loadCostFormat`
 * (tests/fixtures/browser-cost-format.js), the one loader there is. A second bridged name would need its own witness
 * loader passed in with the consumer table, which is growth and so needs its own change.
 */
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);

/** The names a module writes to the global object: `window.X = …` at any depth. */
export function bridgeWrites(src, { sourceType = 'module' } = {}) {
  const names = new Set();
  walk.full(acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true }), (node) => {
    if (node.type !== 'AssignmentExpression' || node.operator !== '=') return;
    const left = node.left;
    if (left.type === 'MemberExpression' && !left.computed && left.object.type === 'Identifier'
      && GLOBAL_OBJECTS.has(left.object.name) && left.property.type === 'Identifier') {
      names.add(left.property.name);
    }
  });
  return names;
}

/**
 * The bridged names a classic or module source reads: `window.X` (or `globalThis.X`) as a member, or a bare `X` that is
 * not a property name. A property key (`obj.X`, `{ X: 1 }`) is not a read.
 */
export function bridgeReads(src, names, { sourceType = 'script' } = {}) {
  const wanted = new Set(names);
  const found = new Set();
  walk.fullAncestor(acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true }), (node, _state, ancestors) => {
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier' && wanted.has(node.property.name)
      && node.object.type === 'Identifier' && GLOBAL_OBJECTS.has(node.object.name)) {
      found.add(node.property.name);
      return;
    }
    if (node.type === 'Identifier' && wanted.has(node.name)) {
      const parent = ancestors[ancestors.length - 2];
      const isMemberProp = parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed;
      const isPropKey = parent && (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key === node && !parent.computed;
      if (!isMemberProp && !isPropKey) found.add(node.name);
    }
  });
  return found;
}

/**
 * The problem with a consumer's witness test text, or null. The witness must show the timing rule: the consumer is
 * loaded first and `loadCostFormat` is called only after. Read from the witness's AST (comments and imports are not
 * calls): the first `loadCostFormat(` call, against the point the consumer is loaded, which is the end of either a
 * `loadWorld({ scripts: [..'consumer.js'..] })` call, or the first `world.run(` call that follows a `readFileSync` whose
 * arguments name `consumer.js`. The earlier of the two points counts.
 */
export function witnessProblem(consumer, witness, text) {
  const file = consumer.replace(/^\//, '');
  const calls = [];
  try {
    walk.full(acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }), (node) => {
      if (node.type === 'CallExpression') calls.push(node);
    });
  } catch (err) {
    return `${consumer}: its witness ${witness} does not parse (${err.message}), so the load order cannot be checked.`;
  }
  const calleeName = (c) => (c.callee.type === 'Identifier' ? c.callee.name : c.callee.type === 'MemberExpression' && !c.callee.computed ? c.callee.property.name : null);
  const named = (c) => text.slice(c.start, c.end).includes(file);
  const loaderStarts = calls.filter((c) => c.callee.type === 'Identifier' && c.callee.name === 'loadCostFormat').map((c) => c.start);
  if (!loaderStarts.length) return `${consumer}: its witness ${witness} never calls loadCostFormat, so it does not show the global installed after the consumer loads.`;
  const loadedAt = [];
  for (const c of calls.filter((x) => calleeName(x) === 'loadWorld')) {
    const scripts = c.arguments[0] && c.arguments[0].type === 'ObjectExpression'
      ? c.arguments[0].properties.find((p) => p.key && (p.key.name === 'scripts' || p.key.value === 'scripts')) : null;
    const names = scripts && scripts.value.type === 'ArrayExpression' ? scripts.value.elements.filter((e) => e && e.type === 'Literal').map((e) => String(e.value).replace(/^\//, '')) : [];
    if (names.includes(file)) loadedAt.push(c.end);
  }
  for (const read of calls.filter((x) => calleeName(x) === 'readFileSync' && named(x))) {
    const run = calls.filter((x) => calleeName(x) === 'run' && x.start > read.start).sort((a, b) => a.start - b.start)[0];
    if (run) loadedAt.push(run.end);
  }
  if (!loadedAt.length) return `${consumer}: its witness ${witness} never loads the consumer (a loadWorld call with ${file} in its scripts, or a readFileSync of it followed by world.run), so the load order cannot be checked.`;
  if (Math.min(...loaderStarts) < Math.min(...loadedAt)) return `${consumer}: its witness ${witness} calls loadCostFormat before it loads the consumer. The timing rule (LIN-4446) is the reverse: the consumer loads first and the global is installed after, as the module shim does in a browser, so a read during the consumer's own execution fails here.`;
  return null;
}

/**
 * The problems with the inventory. `emitted`: `{ file: src }` for every file a renderer emits as a module. `pages`:
 * `{ file: src }` for every other public script (classic or module) that may read a bridged name. `renderers`: the
 * script lists, `[{ rel, entries: [{ src, module }] }]`. `consumers`: `{ '/file.js': 'tests/…/witness.test.js' }`, the
 * registered readers and their witnesses. `fileExists(path)` and `readText(path)` read the witness files.
 */
export function bridgeProblems({ bridged, shim, emitted, pages, renderers, consumers, fileExists, readText }) {
  const problems = [];
  const written = new Set();
  for (const [file, src] of Object.entries(emitted)) {
    for (const name of bridgeWrites(src)) {
      written.add(name);
      if (!bridged.includes(name)) problems.push(`${file} writes window.${name}: a new bridge name. The bridge is one shim with a declared name list; a new name is growth, so it needs its own change and a shrink plan, not a second shim.`);
    }
  }
  for (const name of bridged) {
    if (!written.has(name)) problems.push(`window.${name} is declared but no emitted module writes it: delete it from the declared list.`);
  }

  const readers = new Map();
  for (const [file, src] of Object.entries(pages)) {
    if (file === shim.slice(1)) continue;
    const reads = bridgeReads(src, bridged, { sourceType: 'module' });
    if (reads.size) readers.set(`/${file}`, [...reads].sort());
  }
  for (const [file, names] of readers) {
    if (!consumers[file]) {
      problems.push(`${file} reads window.${names.join(', window.')} but is not a registered consumer. Register it in the consumer table with its witness test, and read the global only from a handler or callback that runs after DOMContentLoaded (the timing rule, docs/areas/front-end-browser.md).`);
    }
  }
  for (const file of Object.keys(consumers)) {
    if (!readers.has(file)) problems.push(`${file} is a registered consumer but no longer reads a bridged name: remove it from the consumer table.`);
    const witness = consumers[file];
    if (!fileExists(witness)) problems.push(`${file}: its witness ${witness} does not exist.`);
    else {
      const problem = witnessProblem(file, witness, readText(witness));
      if (problem) problems.push(problem);
    }
  }

  for (const { rel, entries } of renderers) {
    const named = entries.filter((e) => consumers[e.src]);
    if (!named.length) continue;
    if (!entries.some((e) => e.module && e.src === shim)) problems.push(`${rel} lists a consumer (${named.map((e) => e.src).join(', ')}) without the module shim ${shim}.`);
  }
  return { problems, readers, written };
}
