/**
 * The bridge inventory (LIN-4471; at zero since LIN-4463 piece 5). A bridge is a name a module writes to the global object
 * (`window.X = …`, anywhere in the module) so that classic page scripts can read it. The last one, the CostFormat shim
 * (public/cost-format-global.js), was deleted when its last classic reader became a module, so the inventory now holds
 * the count at zero: a module that writes a global fails, unless the name is a declared e2e hook.
 *
 * An e2e hook is a name a module writes only so a browser spec can call it (`window.refreshWaitingOnYou`, app.js). It is
 * not a bridge, so no classic script may read it, a module must still write it, and the spec named for it must call it.
 * A hook that gains a classic reader has become a bridge, and fails here.
 *
 * Pure: the caller passes the sources, so tests/unit/bridge-inventory.test.js runs the same checks on synthetic inputs.
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
 * The given names a source reads: `window.X` (or `globalThis.X`) as a member, or a bare `X` that is not a property name.
 * A property key (`obj.X`, `{ X: 1 }`) is not a read.
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
 * The problems with the inventory. `emitted`: `{ file: src }` for every file a renderer emits as a module. `pages`:
 * `{ file: src }` for every public script, module or classic. `hooks`: `{ name: 'tests/e2e/…spec.js' }`, the e2e hooks a
 * module may write. `fileExists(path)` and `readText(path)` read the spec files.
 */
export function bridgeProblems({ emitted, pages, hooks = {}, fileExists, readText }) {
  const problems = [];
  const hooksWritten = new Set();
  for (const [file, src] of Object.entries(emitted)) {
    for (const name of bridgeWrites(src)) {
      if (hooks[name]) { hooksWritten.add(name); continue; }
      problems.push(`${file} writes window.${name}: a bridge from a module to classic scripts. The last bridge was deleted (LIN-4463); a classic reader converts to a module and imports instead.`);
    }
  }
  for (const [name, spec] of Object.entries(hooks)) {
    if (!hooksWritten.has(name)) problems.push(`window.${name} is a declared e2e hook but no emitted module writes it: delete it from the hook list.`);
    if (!fileExists(spec)) problems.push(`window.${name}: its e2e spec ${spec} does not exist.`);
    else if (!readText(spec).includes(`window.${name}`)) problems.push(`window.${name}: its e2e spec ${spec} never calls it, so the hook has no user: delete it.`);
    for (const [file, src] of Object.entries(pages)) {
      if (emitted[file]) continue;
      if (bridgeReads(src, [name], { sourceType: 'module' }).size) problems.push(`${file} reads window.${name}, an e2e hook a module writes. A classic reader turns the hook into a bridge: read it from a module by import instead.`);
    }
  }
  return { problems, hooksWritten };
}
