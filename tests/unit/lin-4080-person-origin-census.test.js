/**
 * LIN-4080 (ruling human-force-only) — who may mark a follow-up as a person's.
 *
 * `personOriginated` lets a forced follow-up enter a stopped run. Only the
 * session-authenticated entrance may set it, and only from its own lane, never
 * from a request body. This census proves the wiring from the AST, not from the
 * text, so a comment or string cannot satisfy it:
 *  - the identifier `personOriginated` appears only in the factory, the store,
 *    the entrance, and the two pre-existing LIN-3257 wake-shadow modules (their
 *    `personOriginated` is a different, shadow-only classification, dispatch-wake
 *    classifyWake and wake-shadow recordWakeShadow; it never sets the stamp), and
 *    in no route file (a route can never name the flag, so it cannot set it);
 *  - inside lib/dispatch-entrance.js it appears in exactly one enclosing function,
 *    enqueueRow, and nowhere else;
 *  - the session lane is opened only by enterSessionDispatch, and that entrance is
 *    called only by routes/dispatch.js (the signed-in reply box).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import * as acorn from 'acorn';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FLAG = 'personOriginated';

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
  for (const name of readdirSync(join(REPO, 'routes'))) if (name.endsWith('.js')) out.push(join('routes', name));
  out.push('server.js');
  return out.sort();
}

function parse(source) {
  return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
}

/** Enclosing function name for every occurrence of the flag (identifier or string). */
function flagSites(source) {
  const sites = [];
  (function visit(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    let next = scope;
    if (node.type === 'MethodDefinition' && node.key?.name) next = node.key.name;
    if (node.type === 'FunctionDeclaration' && node.id?.name) next = node.id.name;
    if (node.type === 'VariableDeclarator' && node.id?.name && node.init && /Function/.test(node.init.type)) next = node.id.name;
    if ((node.type === 'Identifier' && node.name === FLAG) || (node.type === 'Literal' && node.value === FLAG)) {
      sites.push(scope);
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(child => visit(child, next));
      else if (value && typeof value.type === 'string') visit(value, next);
    }
  })(parse(source), '<module>');
  return sites;
}

/** Enclosing function names of every call `name(...)` in source (Identifier callee). */
function callSitesOf(source, name, { withSessionLane = false } = {}) {
  const calls = [];
  (function visit(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    let next = scope;
    if (node.type === 'FunctionDeclaration' && node.id?.name) next = node.id.name;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === name) {
      if (!withSessionLane || node.arguments[1]?.value === 'session') calls.push(scope);
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(child => visit(child, next));
      else if (value && typeof value.type === 'string') visit(value, next);
    }
  })(parse(source), '<module>');
  return calls;
}

function liveSources() {
  return Object.fromEntries(sourceFiles().map(file => [file, readFileSync(join(REPO, file), 'utf8')]));
}

describe('LIN-4080 ruling — the person flag has exactly one set of writers', () => {
  test('the flag appears only in the factory, the store, the entrance and the pre-existing wake-shadow modules; no route names it', () => {
    const files = Object.entries(liveSources())
      .filter(([, source]) => flagSites(source).length > 0)
      .map(([file]) => file)
      .sort();
    assert.deepEqual(files, [
      'lib/chat-tools.js',      // LIN-4080 Task Chat: forwards the route's indication into createDispatchItem (census below)
      'lib/dispatch-entrance.js',
      'lib/dispatch-factory.js',
      'lib/dispatch-store.js',
      'lib/dispatch-wake.js',   // pre-existing LIN-3257 shadow classifier (classifyWake)
      'lib/wake-shadow.js'      // pre-existing LIN-3257 shadow recorder (recordWakeShadow)
    ]);
    assert.equal(files.filter(f => f.startsWith('routes/')).length, 0, 'no route can name the flag');
  });

  test('inside the entrance the flag sits in enqueueRow only (the lane decides it)', () => {
    const sites = flagSites(liveSources()['lib/dispatch-entrance.js']);
    assert.ok(sites.length > 0);
    assert.deepEqual([...new Set(sites)], ['enqueueRow']);
  });

  test('the entrance sets the flag to exactly `laneName === \'session\'`, so every proxy-token lane passes false', () => {
    const ast = parse(liveSources()['lib/dispatch-entrance.js']);
    const values = [];
    (function visit(node) {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'Property' && node.key?.type === 'Identifier' && node.key.name === FLAG) values.push(node.value);
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value.type === 'string') visit(value);
      }
    })(ast);
    assert.equal(values.length, 1, 'one assignment of the flag in the entrance');
    const [value] = values;
    assert.equal(value.type, 'BinaryExpression');
    assert.equal(value.operator, '===');
    assert.equal(value.left.name, 'laneName');
    assert.equal(value.right.value, 'session');
  });

  test('the Task Chat indication is the literal true in routes/task-chat.js, and reaches the factory only as `personTurn === true`', () => {
    const sources = liveSources();
    // The indication is a constant set by the Task Chat turn, in one route file only.
    const routeNames = Object.entries(sources)
      .filter(([file, source]) => file.startsWith('routes/') && /\bpersonTurn\b/.test(source))
      .map(([file]) => file);
    assert.deepEqual(routeNames, ['routes/task-chat.js']);
    const routeValues = [];
    (function visit(node) {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'Property' && node.key?.type === 'Identifier' && node.key.name === 'personTurn') routeValues.push(node.value);
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value.type === 'string') visit(value);
      }
    })(parse(sources['routes/task-chat.js']));
    assert.equal(routeValues.length, 1, 'one assignment of the indication in the Task Chat turn');
    assert.equal(routeValues[0].type, 'Literal');
    assert.equal(routeValues[0].value, true);

    // The factory call in chat-tools takes the flag from the closure value only.
    const toolsAst = parse(sources['lib/chat-tools.js']);
    const personOriginatedValues = [];
    (function visit(node) {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'Property' && node.key?.type === 'Identifier' && node.key.name === FLAG) personOriginatedValues.push(node.value);
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value.type === 'string') visit(value);
      }
    })(toolsAst);
    assert.equal(personOriginatedValues.length, 1, 'one assignment of the flag in the Task Chat executor');
    const [value] = personOriginatedValues;
    assert.equal(value.type, 'BinaryExpression');
    assert.equal(value.operator, '===');
    assert.equal(value.left.name, 'personTurn');
    assert.equal(value.right.value, true);
  });

  test('the session lane is opened only by enterSessionDispatch, and that is called only by the signed-in route', () => {
    const sources = liveSources();
    const sessionOpens = Object.entries(sources).flatMap(([file, source]) =>
      callSitesOf(source, 'openRun', { withSessionLane: true }).map(fn => `${file}::${fn}`));
    assert.deepEqual(sessionOpens, ['lib/dispatch-entrance.js::enterSessionDispatch']);

    const sessionEntrances = Object.entries(sources).flatMap(([file, source]) =>
      callSitesOf(source, 'enterSessionDispatch').map(fn => `${file}::${fn}`));
    assert.equal(sessionEntrances.length, 1, 'one call site');
    assert.ok(sessionEntrances[0].startsWith('routes/dispatch.js::'), 'the only caller is the signed-in dispatch route');
  });
});
