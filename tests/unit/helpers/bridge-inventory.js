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
 * own execution. Each consumer's witness test loads the consumer first and calls `loadCostFormat` only after that.
 */
import * as acorn from 'acorn';

const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);

function walk(node, visit, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent, key);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit, node, k));
    else if (v && typeof v.type === 'string') walk(v, visit, node, k);
  }
}

/** The names a module writes to the global object: `window.X = …` at any depth. */
export function bridgeWrites(src, { sourceType = 'module' } = {}) {
  const names = new Set();
  walk(acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true }), (node) => {
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
  walk(acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true }), (node, parent, key) => {
    if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier' && wanted.has(node.property.name)
      && node.object.type === 'Identifier' && GLOBAL_OBJECTS.has(node.object.name)) {
      found.add(node.property.name);
      return;
    }
    if (node.type === 'Identifier' && wanted.has(node.name)) {
      const isMemberProp = parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed;
      const isPropKey = parent && (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed;
      if (!isMemberProp && !isPropKey) found.add(node.name);
    }
  });
  return found;
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
    else if (!/loadCostFormat\s*\(/.test(readText(witness))) problems.push(`${file}: its witness ${witness} never calls loadCostFormat, so it does not show the global installed after the consumer loads.`);
  }

  for (const { rel, entries } of renderers) {
    const named = entries.filter((e) => consumers[e.src]);
    if (!named.length) continue;
    if (!entries.some((e) => e.module && e.src === shim)) problems.push(`${rel} lists a consumer (${named.map((e) => e.src).join(', ')}) without the module shim ${shim}.`);
  }
  return { problems, readers, written };
}
