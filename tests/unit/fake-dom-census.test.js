/**
 * LIN-4265 (LIN-4255 piece 1) — the fake-DOM census.
 *
 * `tests/unit/helpers/fake-dom.js` is the one fake DOM for client tests (CLAUDE.md). This census finds every
 * hand-written one: an object pretending to be an element tree, found by its shape in the AST, not by its name, so a
 * `makeContainer` renamed `makeHost` (or moved into a closure) is still found, and a harmless `getElementById: () => null`
 * `document` shim is not.
 *
 * The definition. The unit is one shape, not the file: an object literal, a class, a constructor function's `this`, or
 * the object a run of assignments builds (`el.querySelector = …`, `Object.defineProperty(el, 'innerHTML', …)`,
 * `Object.assign(el, { … })`, merged with `el`'s own literal when it is declared as one). A member counts however it is
 * defined: a method, a property of any value (function-valued or not), a getter or setter, a class field, a
 * `this.x = …` in the shape's own methods, or an assignment. Reads and calls (`el.querySelector('p')`) never count. A
 * shape is a hand-written fake DOM when it has
 *   1. a QUERY_MEMBERS member and at least one TREE_MEMBERS member, or
 *   2. three or more TREE_MEMBERS members, or
 *   3. two or more TREE_MEMBERS members and it is what a `createElement` stub returns (an object literal, `new X`, a
 *      factory call, or a local the stub fills in and returns).
 * The fixtures below pin this definition. Change TREE_MEMBERS or a threshold only through them, never to bring the
 * count down (LIN-4255 review note 1a).
 *
 * Scope: every `.js`/`.mjs` under `tests/`, `scripts/eval` and `scripts/code-shape` (the `test:unit` globs' trees),
 * except the one fake and this file. Comments never reach the AST, so `stripComments` from
 * `test-server-listen-bind.test.js` is not used: importing it would re-run that file's tests here (review note 3).
 *
 * The ratchet. HAND_WRITTEN_FAKE_DOM_FILES is a sorted list of file names, not a count: a count passes when one copy is
 * deleted and another added. The scan must find exactly the listed files. A file it finds that is not listed fails,
 * with what to use instead. A listed file it no longer finds also fails, so a moved suite leaves the list in the same PR.
 *
 * Run with: node --test tests/unit/fake-dom-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import * as acorn from 'acorn';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const toRepoPath = (full) => relative(REPO, full).split(sep).join('/');
const SELF = toRepoPath(fileURLToPath(import.meta.url));

const SCAN_ROOTS = ['tests', 'scripts/eval', 'scripts/code-shape'];
const EXCLUDED = new Set(['tests/unit/helpers/fake-dom.js', SELF]);

/**
 * The files that still hand-write a fake DOM: the baseline the scan found when the census landed (LIN-4265, 56 files),
 * sorted. It only shrinks. A file moved onto `helpers/fake-dom.js` leaves this list in the same PR, and a new file is
 * never added to get past the census. A stopped file keeps its entry, and its line names the API that stopped it (LIN-4272
 * classification, beat 2); an entry with no comment is not yet classified as stopped.
 */
const HAND_WRITTEN_FAKE_DOM_FILES = [
  'tests/unit/close-out-client.test.js',
  'tests/unit/common-assignee-filter-nav.test.js', // stop: getBoundingClientRect in initNavBar, public/common.js:2907 (LIN-4271 stop rule)
  'tests/unit/common-team-filter-nav.test.js', // stop: getBoundingClientRect in initNavBar, public/common.js:2907 (LIN-4271 stop rule)
  'tests/unit/flight-companion-client.test.js', // stop: style write and layout read-back, public/flight-companion.js:653-665 (LIN-4271)
  'tests/unit/lin-2122-history-outcome-pill.test.js',
  'tests/unit/lin-2370-browser-copy-prompt-provider-identity.test.js',
  'tests/unit/lin-3975-proposal-refresh.test.js',
  'tests/unit/lin-4114-dismiss-order.test.js', // stop: real bubbling dispatchEvent, public/question-cards.js:239-241; the fake dispatchEvent is inert
  'tests/unit/lin-4114-inflight-lock.test.js', // stop: real bubbling dispatchEvent, public/question-cards.js:239-241; the fake dispatchEvent is inert
  'tests/unit/lin-4241-settled-ruling-client.test.js', // stop: real bubbling dispatchEvent, public/question-cards.js:239-241; the fake dispatchEvent is inert
  'tests/unit/lin-4242-waiting-live.test.js',
  'tests/unit/question-card-task-bound.test.js',
  'tests/unit/run-limit-gating.test.js',
  'tests/unit/runner-link-surfaces.test.js',
  'tests/unit/task-page-client.test.js',
  'tests/unit/task-page-link-client-surfaces.test.js',
  'tests/unit/task-page-question.test.js',
];

/** Defining one of these is what makes a shape answer selector queries. */
const QUERY_MEMBERS = new Set(['querySelector', 'querySelectorAll']);

/** The members that make a shape a node in a tree (LIN-4255's list, plus `replaceChildren`/`replaceWith` from review note 2). */
const TREE_MEMBERS = new Set([
  'innerHTML', 'outerHTML', 'children', 'childNodes', 'classList', 'appendChild', 'insertBefore', 'removeChild',
  'insertAdjacentHTML', 'parentNode', 'firstChild', 'replaceChildren', 'replaceWith',
]);

/** The shape a stub of this name returns is checked for signal 3. */
const CREATE_ELEMENT = 'createElement';

const TREE_THRESHOLD = 3;
const CREATED_TREE_THRESHOLD = 2;

// ── Parsing ─────────────────────────────────────────────────────────────────

/** Parse as a module first, then as a classic script (a vm-run fixture can be one). Throws the module error if both fail. */
function parse(source) {
  const base = { ecmaVersion: 'latest', allowHashBang: true, locations: true };
  try {
    return acorn.parse(source, { ...base, sourceType: 'module' });
  } catch (moduleError) {
    try {
      return acorn.parse(source, { ...base, sourceType: 'script', allowReturnOutsideFunction: true });
    } catch {
      throw moduleError;
    }
  }
}

const isFunction = (node) => /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node?.type || '');
const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range']);
const childrenOf = (node) => {
  const out = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === 'string') out.push(child); }
    else if (value && typeof value.type === 'string') out.push(value);
  }
  return out;
};

/** The names a pattern binds. */
function patternNames(pattern, out = new Set()) {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.add(pattern.name);
  else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) patternNames(p.type === 'RestElement' ? p.argument : p.value, out);
  else if (pattern.type === 'ArrayPattern') for (const p of pattern.elements) patternNames(p, out);
  else if (pattern.type === 'AssignmentPattern') patternNames(pattern.left, out);
  else if (pattern.type === 'RestElement') patternNames(pattern.argument, out);
  return out;
}

/** The names a function (or the program) declares, at function granularity: blocks are not scopes here. */
function declaredNames(owner) {
  const names = new Set();
  if (isFunction(owner)) for (const p of owner.params) patternNames(p, names);
  const walk = (node) => {
    if (node.type === 'VariableDeclarator') patternNames(node.id, names);
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) names.add(node.id.name);
    if (node.type === 'CatchClause' && node.param) patternNames(node.param, names);
    for (const child of childrenOf(node)) if (!isFunction(child)) walk(child);
  };
  walk(isFunction(owner) ? owner.body : owner);
  return names;
}

class Scope {
  constructor(node, parent) {
    this.parent = parent;
    this.names = declaredNames(node);
    this.keyed = new Map();
  }
  /** The scope that declares `name`, or the program's when nothing does (a global). */
  owner(name) {
    let s = this;
    for (; s.parent; s = s.parent) if (s.names.has(name)) return s;
    return s;
  }
  root() {
    let s = this;
    while (s.parent) s = s.parent;
    return s;
  }
}

// ── The analysis ────────────────────────────────────────────────────────────

/**
 * Every shape in `source` that the definition calls a hand-written fake DOM.
 * @param {string} source
 * @returns {{line: number, kind: string, name: string|null, signals: string[], members: string[]}[]}
 */
function fakeDomShapes(source) {
  const ast = parse(source);
  const units = [];
  const unitOfNode = new Map();
  const classes = new Map();
  const functions = new Map();
  const scopeOfFunction = new Map();
  const createElementStubs = [];

  const newUnit = (kind, node, name) => {
    const unit = { kind, name: name || null, line: node.loc.start.line, members: new Set(), created: false, mergedInto: null };
    units.push(unit);
    return unit;
  };
  const keyedUnit = (scope, key, node, name) => {
    let unit = scope.keyed.get(key);
    if (!unit) { unit = newUnit('assigned', node, name); scope.keyed.set(key, unit); }
    return unit;
  };
  const keyName = (key, computed) => {
    if (key.type === 'Identifier' && !computed) return key.name;
    if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
    return null;
  };
  const define = (unit, name, value) => {
    if (!name) return;
    unit.members.add(name);
    if (name === CREATE_ELEMENT && value) createElementStubs.push(value);
  };

  /** The shape a member assignment writes into: `this`, a binding, `X.prototype`, or any other target by its text. */
  const targetOf = (expr, ctx) => {
    if (expr.type === 'ThisExpression') return ctx.thisUnit || keyedUnit(ctx.scope.root(), 'this', expr, 'this');
    if (expr.type === 'Identifier') return keyedUnit(ctx.scope.owner(expr.name), `id:${expr.name}`, expr, expr.name);
    if (expr.type === 'MemberExpression' && !expr.computed && expr.property.name === 'prototype' && expr.object.type === 'Identifier') {
      const known = classes.get(expr.object.name) || functions.get(expr.object.name)?.thisUnit;
      if (known) return known;
    }
    const text = source.slice(expr.start, expr.end);
    return keyedUnit(ctx.scope, `expr:${text}`, expr, text);
  };

  const descriptorValue = (descriptor) => {
    if (descriptor?.type !== 'ObjectExpression') return null;
    const p = descriptor.properties.find((q) => q.type === 'Property' && ['value', 'get'].includes(keyName(q.key, q.computed)));
    return p ? p.value : null;
  };

  const visitChildren = (node, ctx) => {
    const base = { ...ctx, methodOf: null, declName: null };
    for (const child of childrenOf(node)) visit(child, base);
  };

  const visitFunction = (node, ctx) => {
    const scope = new Scope(node, ctx.scope);
    scopeOfFunction.set(node, scope);
    const name = node.id?.name || ctx.declName;
    const thisUnit = node.type === 'ArrowFunctionExpression' ? ctx.thisUnit : (ctx.methodOf || newUnit('function', node, name));
    if (name) functions.set(name, { node, thisUnit });
    const inner = { scope, thisUnit, methodOf: null, declName: null };
    for (const p of node.params) visit(p, inner);
    visit(node.body, inner);
    return null;
  };

  const visitClass = (node, ctx) => {
    const name = node.id?.name || ctx.declName;
    const unit = newUnit('class', node, name);
    unitOfNode.set(node, unit);
    if (name) classes.set(name, unit);
    const base = { ...ctx, methodOf: null, declName: null };
    visit(node.superClass, base);
    for (const m of node.body.body) {
      if (m.type === 'MethodDefinition' || m.type === 'PropertyDefinition') {
        define(unit, keyName(m.key, m.computed), m.value);
        if (m.computed) visit(m.key, base);
        visit(m.value, m.type === 'MethodDefinition' ? { ...base, methodOf: unit } : { ...base, thisUnit: unit });
      } else {
        visit(m, { ...base, thisUnit: unit });
      }
    }
    return unit;
  };

  const visitObject = (node, ctx) => {
    const unit = newUnit('object', node, ctx.declName);
    unitOfNode.set(node, unit);
    const base = { ...ctx, methodOf: null, declName: null };
    for (const p of node.properties) {
      if (p.type !== 'Property') { visit(p, base); continue; }
      define(unit, keyName(p.key, p.computed), p.value);
      if (p.computed) visit(p.key, base);
      visit(p.value, { ...base, methodOf: unit });
    }
    return unit;
  };

  const visitObjectStatic = (node, ctx) => {
    const [targetArg, second, third] = node.arguments;
    if (!targetArg || targetArg.type === 'SpreadElement') return;
    const method = node.callee.property.name;
    if (method === 'defineProperty' && second?.type === 'Literal' && typeof second.value === 'string') {
      define(targetOf(targetArg, ctx), second.value, descriptorValue(third));
    } else if (method === 'defineProperties' && second?.type === 'ObjectExpression') {
      const unit = targetOf(targetArg, ctx);
      for (const p of second.properties) if (p.type === 'Property') define(unit, keyName(p.key, p.computed), descriptorValue(p.value));
    } else if (method === 'assign') {
      const unit = targetOf(targetArg, ctx);
      for (const source of node.arguments.slice(1)) {
        if (source.type !== 'ObjectExpression') continue;
        for (const p of source.properties) if (p.type === 'Property') define(unit, keyName(p.key, p.computed), p.value);
      }
    }
  };

  function visit(node, ctx) {
    if (!node || typeof node.type !== 'string') return null;
    if (isFunction(node)) return visitFunction(node, ctx);
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return visitClass(node, ctx);
    if (node.type === 'ObjectExpression') return visitObject(node, ctx);
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') {
      const left = node.left;
      const unit = targetOf(left.object, ctx);
      define(unit, keyName(left.property, left.computed), node.right);
      const base = { ...ctx, methodOf: null, declName: null };
      visit(left.object, base);
      if (left.computed) visit(left.property, base);
      visit(node.right, { ...base, methodOf: unit });
      return null;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed
      && node.callee.object.type === 'Identifier' && node.callee.object.name === 'Object') {
      visitObjectStatic(node, ctx);
    }
    if (node.type === 'VariableDeclarator') {
      const base = { ...ctx, methodOf: null, declName: null };
      visit(node.id, base);
      const name = node.id.type === 'Identifier' ? node.id.name : null;
      const initUnit = visit(node.init, { ...base, declName: name });
      if (name && node.init?.type === 'ObjectExpression' && initUnit) {
        const owner = ctx.scope.owner(name);
        const earlier = owner.keyed.get(`id:${name}`);
        if (earlier && earlier !== initUnit) {
          for (const m of earlier.members) initUnit.members.add(m);
          earlier.mergedInto = initUnit;
        }
        owner.keyed.set(`id:${name}`, initUnit);
      }
      return null;
    }
    visitChildren(node, ctx);
    return null;
  }

  const programScope = new Scope(ast, null);
  visit(ast, { scope: programScope, thisUnit: null, methodOf: null, declName: null });

  // Signal 3: the shapes `createElement` stubs return.
  const live = (unit) => { let u = unit; while (u?.mergedInto) u = u.mergedInto; return u; };
  const shapesOf = (expr, scope, depth) => {
    if (!expr || depth > 4) return [];
    switch (expr.type) {
      case 'ObjectExpression': return [unitOfNode.get(expr)];
      case 'ClassExpression': return [];
      case 'NewExpression':
        if (expr.callee.type === 'Identifier') {
          const known = classes.get(expr.callee.name) || functions.get(expr.callee.name)?.thisUnit;
          return known ? [known] : [];
        }
        return [];
      case 'CallExpression':
        if (expr.callee.type === 'Identifier' && functions.has(expr.callee.name)) return returnsOf(functions.get(expr.callee.name).node, depth + 1);
        return [];
      case 'Identifier': {
        if (functions.has(expr.name) && !scope.owner(expr.name).keyed.has(`id:${expr.name}`)) return returnsOf(functions.get(expr.name).node, depth + 1);
        const unit = scope.owner(expr.name).keyed.get(`id:${expr.name}`);
        return unit ? [unit] : [];
      }
      case 'ConditionalExpression': return [...shapesOf(expr.consequent, scope, depth), ...shapesOf(expr.alternate, scope, depth)];
      case 'LogicalExpression': return [...shapesOf(expr.left, scope, depth), ...shapesOf(expr.right, scope, depth)];
      case 'SequenceExpression': return shapesOf(expr.expressions.at(-1), scope, depth);
      default: return isFunction(expr) ? returnsOf(expr, depth + 1) : [];
    }
  };
  function returnsOf(fn, depth) {
    const scope = scopeOfFunction.get(fn);
    if (!scope) return [];
    if (fn.body.type !== 'BlockStatement') return shapesOf(fn.body, scope, depth);
    const out = [];
    const walk = (node) => {
      if (node.type === 'ReturnStatement') out.push(...shapesOf(node.argument, scope, depth));
      for (const child of childrenOf(node)) if (!isFunction(child) && child.type !== 'ClassExpression' && child.type !== 'ClassDeclaration') walk(child);
    };
    walk(fn.body);
    return out;
  }
  for (const stub of createElementStubs) {
    const stubShapes = isFunction(stub) ? returnsOf(stub, 0) : shapesOf(stub, programScope, 0);
    for (const unit of stubShapes) if (unit) live(unit).created = true;
  }

  const found = [];
  for (const unit of units) {
    if (unit.mergedInto) continue;
    const members = [...unit.members];
    const query = members.filter((m) => QUERY_MEMBERS.has(m));
    const tree = members.filter((m) => TREE_MEMBERS.has(m));
    const signals = [];
    if (query.length > 0 && tree.length > 0) signals.push('query+tree');
    if (tree.length >= TREE_THRESHOLD) signals.push('tree');
    if (unit.created && tree.length >= CREATED_TREE_THRESHOLD) signals.push('createElement');
    if (signals.length) found.push({ line: unit.line, kind: unit.kind, name: unit.name, signals, members: [...query, ...tree].sort() });
  }
  return found.sort((a, b) => a.line - b.line);
}

// ── The scan ────────────────────────────────────────────────────────────────

function scannedFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(name)) out.push(toRepoPath(full));
    }
  };
  for (const root of SCAN_ROOTS) walk(join(REPO, root));
  return out.filter((file) => !EXCLUDED.has(file)).sort();
}

let scanResult = null;
function scan() {
  if (scanResult) return scanResult;
  const files = scannedFiles();
  const found = new Map();
  const parseErrors = [];
  for (const file of files) {
    let shapes;
    try {
      shapes = fakeDomShapes(readFileSync(join(REPO, file), 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      parseErrors.push(`${file}: ${error.message}`);
      continue;
    }
    if (shapes.length) found.set(file, shapes);
  }
  scanResult = { files, found, parseErrors };
  return scanResult;
}

// ── The definition, pinned ──────────────────────────────────────────────────

/** Each source must yield a shape with `signal`. */
const POSITIVE = [
  {
    name: 'a makeContainer literal',
    signal: 'query+tree',
    source: `function makeContainer() {
      return { innerHTML: '', classList: { add() {} }, querySelector(sel) { return this.innerHTML.includes(sel) ? {} : null; } };
    }`,
  },
  {
    name: 'the same literal under the name makeHost',
    signal: 'query+tree',
    source: `const makeHost = () => ({ innerHTML: '', classList: { add() {} }, querySelector: () => null });`,
  },
  {
    name: 'a class FakeElement with classList and children (constructor fields) and appendChild',
    signal: 'tree',
    source: `class FakeElement {
      constructor(tag) { this.tag = tag; this.classList = new Set(); this.children = []; }
      appendChild(child) { this.children.push(child); return child; }
    }`,
  },
  {
    name: 'a post-hoc el.querySelector = … plus an innerHTML getter/setter on the same el',
    signal: 'query+tree',
    source: `function host() {
      const el = { dataset: {} };
      let html = '';
      Object.defineProperty(el, 'innerHTML', { get() { return html; }, set(v) { html = v; } });
      el.querySelector = (sel) => (html.includes(sel) ? {} : null);
      return el;
    }`,
  },
  {
    name: 'the chart-helpers shape: children, appendChild, replaceChildren, replaceWith',
    signal: 'tree',
    source: `class FakeElement {
      constructor(tag) { this.tag = tag; this.children = []; this.className = ''; }
      setAttribute(name, value) { this.attrs[name] = value; }
      appendChild(child) { this.children.push(child); return child; }
      replaceChildren(...kids) { this.children = kids; }
      replaceWith(other) { this.replacedBy = other; }
    }`,
  },
  {
    name: 'the createElement-returned shape: classList and an innerHTML getter/setter, returned by new FakeElement',
    signal: 'createElement',
    source: `class FakeElement {
      constructor(tagName) { this.tagName = tagName; this.classList = new FakeClassList(this); this._innerHTML = null; }
      get innerHTML() { return this._innerHTML; }
      set innerHTML(v) { this._innerHTML = v; }
    }
    const sandbox = { document: { createElement: (tag) => new FakeElement(tag) } };`,
  },
  {
    name: 'a createElement assigned on document, returning a factory call',
    signal: 'createElement',
    source: `function makeEl() { return { children: [], appendChild(c) { this.children.push(c); } }; }
    document.createElement = (tag) => makeEl(tag);`,
  },
  {
    name: 'member form: methods',
    signal: 'query+tree',
    source: `const fake = { querySelectorAll() { return []; }, appendChild(c) { return c; } };`,
  },
  {
    name: 'member form: function-valued properties',
    signal: 'query+tree',
    source: `const fake = { querySelector: () => null, removeChild: function (c) { return c; } };`,
  },
  {
    name: 'member form: a getter/setter',
    signal: 'query+tree',
    source: `const fake = { querySelector: () => null, get outerHTML() { return '<div></div>'; }, set outerHTML(v) {} };`,
  },
  {
    name: 'member form: assignments',
    signal: 'query+tree',
    source: `const el = {}; el.querySelector = () => null; el.firstChild = null;`,
  },
  {
    name: 'member form: this-assignments in a constructor function',
    signal: 'query+tree',
    source: `function FakeNode() { this.childNodes = []; this.querySelectorAll = () => []; }`,
  },
  {
    name: 'member form: class fields',
    signal: 'query+tree',
    source: `class Fake { children = []; querySelector() { return null; } }`,
  },
  {
    name: 'member form: Object.assign onto a binding',
    signal: 'query+tree',
    source: `const el = document.body; Object.assign(el, { querySelector: () => null, parentNode: null });`,
  },
  {
    name: 'members split between a literal and later assignments on its binding',
    signal: 'query+tree',
    source: `function make() { const el = { innerHTML: '' }; el.querySelector = () => null; return el; }`,
  },
];

/**
 * Every tree member, written out here and not read from TREE_MEMBERS, so dropping one from the list turns its pin red.
 * Each pin is a shape with querySelector and that one member, so only that member can make it a fake.
 */
const PINNED_TREE_MEMBERS = [
  'innerHTML', 'outerHTML', 'children', 'childNodes', 'classList', 'appendChild', 'insertBefore', 'removeChild',
  'insertAdjacentHTML', 'parentNode', 'firstChild', 'replaceChildren', 'replaceWith',
];

/** Each source must yield no shape. */
const NEGATIVE = [
  { name: 'a getElementById-only document shim', source: `const document = { getElementById: () => null };` },
  { name: 'a lone querySelector', source: `const document = { querySelector: () => null };` },
  {
    name: 'the vm-suite document shim',
    source: `const document = {
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
      body: { classList: { add() {}, remove() {} } },
    };`,
  },
  { name: 'a single tree member', source: `const node = { children: [] };` },
  { name: 'two tree members, not created by a createElement stub', source: `const node = { children: [], parentNode: null };` },
  {
    name: 'a createElement stub returning one tree member',
    source: `const document = { createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {} }) };`,
  },
  {
    name: 'real-DOM use that only calls and reads the members',
    source: `const el = document.createElement('div');
    el.innerHTML = '<p class="a">x</p>';
    el.querySelector('p').classList.add('b');
    el.appendChild(document.createElement('span'));
    el.insertBefore(el.firstChild, el.lastChild);
    assert.equal(el.children.length, 2);
    assert.ok(el.querySelectorAll('span').length);`,
  },
  {
    name: 'query and tree members on two different objects in one file',
    source: `const a = { querySelector: () => null }; const b = { innerHTML: '' }; const c = { appendChild() {} };`,
  },
  {
    name: 'the members only in comments and strings',
    source: `// { querySelector() {}, innerHTML: '', children: [] }
    const text = "{ querySelector() {}, innerHTML: '', appendChild() {} }";`,
  },
];

describe('LIN-4265 — the fake-DOM census: the definition, pinned by fixtures', () => {
  for (const { name, signal, source } of POSITIVE) {
    test(`caught: ${name}`, () => {
      const shapes = fakeDomShapes(source);
      assert.ok(shapes.some((s) => s.signals.includes(signal)),
        `expected a shape with signal ${signal}; found ${JSON.stringify(shapes)}`);
    });
  }

  for (const member of PINNED_TREE_MEMBERS) {
    test(`caught: querySelector plus ${member} alone`, () => {
      const shapes = fakeDomShapes(`const fake = { querySelector() { return null; }, ${member}: null };`);
      assert.deepEqual(shapes.map((s) => s.signals), [['query+tree']],
        `${member} must count as a tree member; found ${JSON.stringify(shapes)}`);
    });
  }

  for (const { name, source } of NEGATIVE) {
    test(`not caught: ${name}`, () => {
      assert.deepEqual(fakeDomShapes(source), []);
    });
  }
});

describe('LIN-4265 — the fake-DOM census: the scan', () => {
  test('scans tests/, scripts/eval and scripts/code-shape, .js and .mjs, without the one fake and this file', () => {
    const { files } = scan();
    for (const root of SCAN_ROOTS) assert.ok(files.some((f) => f.startsWith(`${root}/`)), `nothing scanned under ${root}/`);
    assert.ok(files.some((f) => f.endsWith('.mjs')), 'no .mjs file scanned');
    assert.ok(files.includes('tests/unit/helpers/client-world.js'), 'the helpers directory is scanned');
    for (const excluded of EXCLUDED) assert.ok(!files.includes(excluded), `${excluded} must not be scanned`);
  });

  test('every scanned file parses with acorn', () => {
    const { parseErrors } = scan();
    assert.deepEqual(parseErrors, [], 'a file acorn cannot parse is a file the census cannot see');
  });
});

// ── The ratchet ─────────────────────────────────────────────────────────────

const describeShapes = (shapes) => shapes
  .map((s) => `${s.kind}${s.name ? ` ${s.name}` : ''} at line ${s.line} (${s.members.join(', ')})`)
  .join('; ');

/** What a file the scan finds, and the list does not name, is told to do instead. */
function unknownFileMessage(unknown) {
  return [
    `${unknown.length} file(s) hand-write a fake DOM that HAND_WRITTEN_FAKE_DOM_FILES does not list:`,
    ...unknown.map(({ file, shapes }) => `  ${file}: ${describeShapes(shapes)}`),
    'Do not hand-write one, and do not add the file to the list: use tests/unit/helpers/fake-dom.js, the one fake DOM.',
    '- To run a public/ script with its container, use loadWorld from tests/unit/helpers/client-world.js:',
    "    const world = loadWorld({ window: { api }, scripts: ['prompt-section.js'] }); const container = world.makeContainer();",
    "  (as tests/unit/lin-4010-home-opened-task.test.js does); world.document is the fake's document.",
    "- To vm-run a slice of a script against createFakeDom()'s document:",
    "    const { document, parse } = createFakeDom(); parse(html, document.body);",
    "    const sandbox = { document, window: { document }, console }; vm.createContext(sandbox);",
    "    vm.runInContext(readFileSync(join(REPO, 'public/question-cards.js'), 'utf8'), sandbox, { filename: 'question-cards.js' });",
    '  (as tests/unit/lin-4242-waiting-merge.test.js does).',
    'If the fake lacks something the client needs, grow fake-dom.js with its own test in fake-dom.test.js.',
  ].join('\n');
}

/** What a listed file the scan no longer finds is told to do. */
function staleFileMessage(stale) {
  return [
    `${stale.length} file(s) in HAND_WRITTEN_FAKE_DOM_FILES no longer hand-write a fake DOM (moved, deleted or renamed):`,
    ...stale.map((file) => `  ${file}`),
    'Remove them from HAND_WRITTEN_FAKE_DOM_FILES in this PR. The consumers are computed from imports, so nothing else needs editing.',
  ].join('\n');
}

// ── The consumers (LIN-4306) ────────────────────────────────────────────────

const FAKE_HEADER = 'tests/unit/helpers/fake-dom.js';

/** The modules whose importers are the fake's consumers: the fake itself, and the vm loader over it. */
const CONSUMED_MODULES = new Set([FAKE_HEADER, 'tests/unit/helpers/client-world.js']);

/**
 * The names the header's consumer paragraph may keep: the census (it imports nothing), and the two helpers the paragraph
 * describes as real importers. Any other consumer name in that paragraph is a hand-kept list again.
 */
const HEADER_NAMES_ALLOWED = new Set(['fake-dom-census.test.js', 'client-world.js', 'live-console-world.js']);

const IMPORT_LIKE = /^(ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration)$/;

/**
 * The files whose static imports or re-exports reach a consumed module, directly or through a helper under
 * `tests/unit/helpers/` that does, from the same scope as the scan. A suite that imports only `live-console-world.js`
 * (which imports `client-world.js`) is a consumer. The scan runs to a fixpoint: each pass adds the helpers found, and
 * stops when none is new. An AST walk, not a text grep, so a comment or string that names the module does not make a
 * consumer. Dynamic `import()` is not counted: no suite uses it to reach the fake, and the scan would miss it.
 */
function computedConsumers() {
  const imports = new Map();
  for (const file of scannedFiles()) {
    let ast;
    try {
      ast = parse(readFileSync(join(REPO, file), 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) continue; // the parse test reports it
      throw error;
    }
    const targets = [];
    for (const node of ast.body) {
      if (!IMPORT_LIKE.test(node.type) || typeof node.source?.value !== 'string') continue;
      if (!node.source.value.startsWith('.')) continue;
      targets.push(toRepoPath(join(dirname(join(REPO, file)), node.source.value)));
    }
    imports.set(file, targets);
  }
  const reaching = new Set(CONSUMED_MODULES);
  const out = new Set();
  for (let added = true; added;) {
    added = false;
    for (const [file, targets] of imports) {
      if (out.has(file) || !targets.some((target) => reaching.has(target))) continue;
      out.add(file);
      added = true;
      if (file.startsWith('tests/unit/helpers/')) reaching.add(file);
    }
  }
  return [...out].sort();
}

/** The header's "Guard and consumers" paragraph: from its lead to the next blank comment line. Null when absent. */
function consumerParagraph(source) {
  const start = source.indexOf('Guard and consumers (LIN-4265');
  if (start < 0) return null;
  const end = source.indexOf('\n *\n', start);
  return source.slice(start, end < 0 ? source.length : end);
}

/** The consumer file names a paragraph hand-lists that the census computes, other than the allowed helper names. */
function handListedConsumers(paragraph, consumers) {
  const byBase = new Set(consumers.map((file) => file.split('/').pop()));
  const named = new Set(paragraph.match(/[\w-]+\.(?:test\.)?m?js/g) || []);
  return [...named].filter((name) => byBase.has(name) && !HEADER_NAMES_ALLOWED.has(name)).sort();
}

function consumerListMessage(listed, consumers) {
  return [
    `${FAKE_HEADER} names consumer file(s) that the census computes: ${listed.join(', ')}`,
    'The header says the consumers are the importers the census computes, so remove those names. The computed set is:',
    ...consumers.map((file) => `  ${file}`),
  ].join('\n');
}

describe('LIN-4306 — the fake-DOM consumer list is computed from imports, not hand-kept', () => {
  test('the scan finds the real importers, including lin-4293-tidy-after-repaint.test.js, and not the census', () => {
    const consumers = computedConsumers();
    assert.ok(consumers.includes('tests/unit/lin-4293-tidy-after-repaint.test.js'), 'lin-4293 imports client-world.js and must be counted');
    assert.ok(consumers.includes('tests/unit/fake-dom.test.js'), 'the fake\'s own suite imports the fake');
    assert.ok(consumers.includes('tests/unit/helpers/live-console-world.js'), 'the live-console loader imports client-world.js');
    assert.ok(consumers.includes('tests/unit/live-console-client-facts.test.js'), 'reaches client-world.js through live-console-world.js');
    assert.ok(!consumers.includes('tests/unit/fake-dom-census.test.js'), 'the census imports nothing, so it is not a consumer');
  });

  test('the header\'s consumer paragraph names no consumer the census computes, beyond the allowed helpers', () => {
    const paragraph = consumerParagraph(readFileSync(join(REPO, FAKE_HEADER), 'utf8'));
    assert.ok(paragraph, 'the header has its Guard and consumers paragraph');
    const consumers = computedConsumers();
    const listed = handListedConsumers(paragraph, consumers);
    assert.deepEqual(listed, [], consumerListMessage(listed, consumers));
  });

  test('the header no longer tells a mover to join the consumer list', () => {
    const paragraph = consumerParagraph(readFileSync(join(REPO, FAKE_HEADER), 'utf8'));
    assert.doesNotMatch(paragraph, /joins/, 'the paragraph must not ask a mover to edit the consumer list');
  });

  test('the stale-file message no longer tells a mover to edit the header', () => {
    const message = staleFileMessage(['tests/unit/example.test.js']);
    assert.doesNotMatch(message, /joins|consumer list|header/);
  });

  test('fixture: a paragraph that hand-lists a consumer file goes red, naming that file', () => {
    const consumers = ['tests/unit/lin-4242-waiting-merge.test.js', 'tests/unit/helpers/client-world.js'];
    const paragraph = 'Guard and consumers (LIN-4265). The files that use this fake today: `lin-4242-waiting-merge.test.js` and `client-world.js`.';
    assert.deepEqual(handListedConsumers(paragraph, consumers), ['lin-4242-waiting-merge.test.js']);
    assert.match(consumerListMessage(['lin-4242-waiting-merge.test.js'], consumers), /lin-4242-waiting-merge\.test\.js[\s\S]*tests\/unit\/lin-4242-waiting-merge\.test\.js/, 'the message prints the computed set');
  });

  test('fixture: the pointer sentence goes green', () => {
    const consumers = ['tests/unit/lin-4242-waiting-merge.test.js', 'tests/unit/helpers/client-world.js', 'tests/unit/helpers/live-console-world.js'];
    const paragraph = 'Guard and consumers (LIN-4265, LIN-4306). `fake-dom-census.test.js` is the guard. `client-world.js` and `live-console-world.js` are the real importers; the consumers are the importers the census computes.';
    assert.deepEqual(handListedConsumers(paragraph, consumers), []);
  });
});

describe('LIN-4265 — the fake-DOM census: the ratchet', () => {
  test('HAND_WRITTEN_FAKE_DOM_FILES is sorted, with no duplicates', () => {
    const duplicates = HAND_WRITTEN_FAKE_DOM_FILES.filter((f, i) => HAND_WRITTEN_FAKE_DOM_FILES.indexOf(f) !== i);
    assert.deepEqual(duplicates, [], `listed more than once: ${duplicates.join(', ')}`);
    const outOfOrder = HAND_WRITTEN_FAKE_DOM_FILES.filter((f, i) => i > 0 && HAND_WRITTEN_FAKE_DOM_FILES[i - 1] > f);
    assert.deepEqual(outOfOrder, [], `out of sorted order: ${outOfOrder.join(', ')}`);
  });

  test('no file hand-writes a fake DOM unless it is listed', () => {
    const { found } = scan();
    const listed = new Set(HAND_WRITTEN_FAKE_DOM_FILES);
    const unknown = [...found].filter(([file]) => !listed.has(file)).map(([file, shapes]) => ({ file, shapes }));
    assert.ok(unknown.length === 0, unknownFileMessage(unknown));
  });

  test('every listed file still hand-writes a fake DOM', () => {
    const { found } = scan();
    const stale = HAND_WRITTEN_FAKE_DOM_FILES.filter((file) => !found.has(file));
    assert.ok(stale.length === 0, staleFileMessage(stale));
  });

  test('the unknown-file message names the shared fake, loadWorld, and how to vm-run a slice on its document', () => {
    const message = unknownFileMessage([{ file: 'tests/unit/example.test.js', shapes: fakeDomShapes(POSITIVE[1].source) }]);
    assert.match(message, /tests\/unit\/example\.test\.js: object at line 1 \(classList, innerHTML, querySelector\)/);
    assert.match(message, /helpers\/fake-dom\.js/);
    assert.match(message, /loadWorld/);
    assert.match(message, /createFakeDom\(\)'s document/);
    assert.match(message, /const \{ document, parse \} = createFakeDom\(\);/);
    assert.match(message, /vm\.runInContext\(/);
  });
});
