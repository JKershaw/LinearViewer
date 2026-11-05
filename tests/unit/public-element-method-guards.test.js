/**
 * LIN-4304 (LIN-4292 tidy-after) — guard: one spelling for DOM element access in public/*.js.
 *
 * An element is trusted to have its methods, so `public/` calls `el.querySelector(…)` directly. The old
 * spelling tested the method first (`x.querySelector ? x.querySelector(…) : null`, `x.matches && …`,
 * `!x.closest` before a call, `typeof x.getAttribute === 'function'`). That test is a method-presence
 * guard. A node that may not be an Element keeps its guard, and the line is allow-listed below with the
 * reason it is needed.
 *
 * The scan is AST-based (acorn, as fake-dom-census.test.js does), not a regex. A guard is a member `R.m`
 * of the six methods below that is TESTED on receiver `R` and then CALLED as `R.m(…)` in the code the test
 * governs. The "then called" rule is what keeps `phone.matches ? …` (a MediaQueryList property) and
 * `window.matchMedia(…).matches` out: nothing calls `.matches` on them. Governed code is:
 *   - the right operand of `R.m && R.m(…)` / `!R.m || …`;
 *   - the consequent or alternate of `R.m ? R.m(…) : …`;
 *   - the body or else-branch of `if (R.m) …`;
 *   - every statement after an earlier `if (!R.m) return/throw/…;` in the same block.
 * The four spellings are the tests `R.m ?`, `R.m &&`, `!R.m` before a call, and
 * `typeof R.m === 'function'` / `!== 'function'`, which reads the member and is caught the same way.
 *
 * Allow-list. Each entry is keyed `file: <guard test, whitespace collapsed>` and holds one reason, in the
 * present tense and true of that line now (no-page-wide-label-listener.test.js's convention). A stale entry
 * fails, so the list shrinks as guards are removed. No inline marker: a second convention is not added.
 *
 * Scope: every non-vendored public/*.js. Sites outside public/ (inline scripts in lib/, server-rendered
 * HTML) are not scanned here.
 *
 * Run with: node --test tests/unit/public-element-method-guards.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const PUBLIC_JS = readdirSync(join(ROOT, 'public'))
  .filter((f) => f.endsWith('.js') && !f.endsWith('.min.js'))
  .sort();

const METHODS = new Set(['querySelector', 'querySelectorAll', 'matches', 'closest', 'getAttribute', 'contains']);

// ── The scan ────────────────────────────────────────────────────────────────

function parseSource(src) {
  const base = { ecmaVersion: 'latest', allowHashBang: true, locations: true, allowReturnOutsideFunction: true };
  try {
    return acorn.parse(src, { ...base, sourceType: 'module' });
  } catch {
    return acorn.parse(src, { ...base, sourceType: 'script' });
  }
}

// The method name when `node` is `<obj>.<one of METHODS>` (dotted or string-literal computed), else null.
function methodOf(node) {
  if (!node || node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return METHODS.has(node.property.name) ? node.property.name : null;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') {
    return METHODS.has(node.property.value) ? node.property.value : null;
  }
  return null;
}

function forEachChild(node, fn) {
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') fn(c);
    } else if (v && typeof v.type === 'string') {
      fn(v);
    }
  }
}

const exitsEarly = (s) => {
  if (!s) return false;
  if (['ReturnStatement', 'ThrowStatement', 'ContinueStatement', 'BreakStatement'].includes(s.type)) return true;
  if (s.type === 'BlockStatement' && s.body.length) return exitsEarly(s.body[s.body.length - 1]);
  return false;
};

/**
 * Every guard in one source file. Returns [{ file, guard, guardLine, call, line }] — `guard` is the tested
 * expression, whitespace collapsed (the allow-list key), `guardLine` where it starts, `call` the governed
 * call, `line` where that call starts.
 */
function scanSource(src, file = 'fixture.js') {
  const ast = parseSource(src);
  const compact = (n) => src.slice(n.start, n.end).replace(/\s+/g, '');
  const text = (n) => src.slice(n.start, n.end).replace(/\s+/g, ' ').trim();
  const keyOf = (member) => `${compact(member.object)}.${methodOf(member)}`;

  const parents = new Map();
  (function link(n) {
    forEachChild(n, (c) => {
      parents.set(c, n);
      link(c);
    });
  })(ast);

  // Does `node` read (not call) the member `key`? A call's callee is skipped; its object and arguments are not.
  function readsMember(node, key) {
    let found = false;
    (function visit(n) {
      if (found || !n || typeof n.type !== 'string') return;
      if (n.type === 'CallExpression' && methodOf(n.callee) && keyOf(n.callee) === key) {
        visit(n.callee.object);
        n.arguments.forEach(visit);
        return;
      }
      if (n.type === 'MemberExpression' && methodOf(n) && keyOf(n) === key) {
        found = true;
        return;
      }
      forEachChild(n, visit);
    })(node);
    return found;
  }

  function guardFor(call, key) {
    let child = call;
    let parent = parents.get(child);
    while (parent) {
      if (parent.type === 'LogicalExpression' && child === parent.right && readsMember(parent.left, key)) return parent.left;
      if (parent.type === 'ConditionalExpression' && child !== parent.test && readsMember(parent.test, key)) return parent.test;
      if (parent.type === 'IfStatement' && child !== parent.test && readsMember(parent.test, key)) return parent.test;
      if ((parent.type === 'BlockStatement' || parent.type === 'Program') && Array.isArray(parent.body)) {
        const idx = parent.body.indexOf(child);
        for (let i = 0; i < idx; i++) {
          const s = parent.body[i];
          if (s.type === 'IfStatement' && readsMember(s.test, key) && exitsEarly(s.consequent)) return s.test;
        }
      }
      child = parent;
      parent = parents.get(child);
    }
    return null;
  }

  const hits = [];
  (function visitCalls(n) {
    if (n.type === 'CallExpression' && methodOf(n.callee)) {
      const key = keyOf(n.callee);
      const guard = guardFor(n, key);
      if (guard) {
        hits.push({
          file,
          guard: text(guard),
          guardLine: guard.loc.start.line,
          call: text(n.callee),
          line: n.loc.start.line,
        });
      }
    }
    forEachChild(n, visitCalls);
  })(ast);
  return hits;
}

// Hits in `src` whose key is not in `allow`.
function unlisted(hits, allow) {
  return hits
    .filter((h) => !(`${h.file}: ${h.guard}` in allow))
    .map((h) => `${h.file}:${h.guardLine} guard [${h.guard}] -> ${h.call} @${h.line}`);
}

// Allow-list entries no hit uses.
function staleEntries(hits, allow) {
  const live = new Set(hits.map((h) => `${h.file}: ${h.guard}`));
  return Object.keys(allow).filter((k) => !live.has(k));
}

// ── The allow-list ──────────────────────────────────────────────────────────
// `file: guard test` -> reason. Each guard here is one that must stay: its node may not be an Element.
const PRESENCE_ALLOW = {
  // Unit seams: close-out-client.test.js:150 loads this module with a document that has no querySelector or querySelectorAll.
  // Kept until that suite moves to the shared fake (LIN-4254); the check still sees each line.
  'close-out.js: !d || typeof d.querySelector !== \'function\'': 'close-out-client.test.js:150 loads the module with a document that has no querySelector (LIN-4254 moves that suite)',
  'close-out.js: main && typeof main.getAttribute === \'function\'': 'the close-out seam kept with the other close-out.js typeof checks: pageAlreadyDone reads a document that close-out-client.test.js hand-builds (LIN-4254 moves that suite)',
  'close-out.js: !d || typeof d.querySelectorAll !== \'function\'': 'close-out-client.test.js:150 loads the module with a document that has no querySelectorAll (LIN-4254 moves that suite)',
};

// ── Fixtures ────────────────────────────────────────────────────────────────

describe('the scan flags every spelling of a method-presence guard', () => {
  test('ternary: `x.m ? x.m(…) : …`', () => {
    const hits = scanSource("const r = x.querySelector ? x.querySelector('a') : null;");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].guard, 'x.querySelector');
  });

  test('logical: `x.m && x.m(…)`', () => {
    const hits = scanSource("const r = x.matches && x.matches('.a');");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].guard, 'x.matches');
  });

  test('early return: `if (!x.m) return; … x.m(…)`', () => {
    const hits = scanSource("function f(x) {\n  if (!x.closest) return null;\n  return x.closest('p');\n}");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].guard, '!x.closest');
  });

  test('`typeof x.m === \'function\'`, and its `!==` form before a call', () => {
    const hits = scanSource(
      "function a(x) { return typeof x.getAttribute === 'function' ? x.getAttribute('a') : null; }\n" +
      "function b(x) { if (typeof x.contains !== 'function') return false; return x.contains(y); }",
    );
    assert.deepEqual(hits.map((h) => h.guard), ["typeof x.getAttribute === 'function'", "typeof x.contains !== 'function'"]);
  });

  test('a multi-line guard is read whole, and its call is still governed', () => {
    const hits = scanSource("const v = el.closest\n  ? el.closest('li')\n  : null;");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].guardLine, 1);
    assert.equal(hits[0].line, 2);
  });

  test('`contains` (a Node method) is a guard too', () => {
    const hits = scanSource('const inside = slot.contains && slot.contains(active);');
    assert.equal(hits.length, 1);
  });

  test('a guard on a different receiver than the call is not the same guard', () => {
    assert.deepEqual(scanSource("const v = a.closest ? b.closest('x') : null;"), []);
  });
});

describe('the scan passes what is not a method-presence guard', () => {
  test('a MediaQueryList `.matches` property is never called, so it is not a guard', () => {
    assert.deepEqual(scanSource("const f = window.matchMedia('(max-width: 600px)').matches ? form.querySelector('x') : null;"), []);
    assert.deepEqual(scanSource("const f = phone.matches ? form.querySelector('x') : null;"), []);
  });

  test('a method-presence test with no governed call is not a guard', () => {
    assert.deepEqual(scanSource("if (el.matches) { track(); }"), []);
  });

  test('a call in the test of the same expression is not governed by it', () => {
    assert.deepEqual(scanSource("if (el.closest('a')) { el.closest('b'); }"), []);
  });
});

describe('the allow-list is checked: an unlisted guard fails, a listed one passes, a stale one fails', () => {
  const seeded = scanSource("function f(x) { return x.querySelector ? x.querySelector('a') : null; }", 'seed.js');

  test('an unlisted seeded guard is reported', () => {
    assert.deepEqual(unlisted(seeded, {}), [
      'seed.js:1 guard [x.querySelector] -> x.querySelector @1',
    ]);
  });

  test('a listed seeded guard passes', () => {
    assert.deepEqual(unlisted(seeded, { 'seed.js: x.querySelector': 'fixture: the receiver is a stub without querySelector' }), []);
  });

  test('a listed key that no hit uses is stale', () => {
    assert.deepEqual(staleEntries(seeded, { 'seed.js: y.closest': 'fixture' }), ['seed.js: y.closest']);
  });

  test('every allow-list reason is a non-empty statement', () => {
    for (const [key, reason] of Object.entries(PRESENCE_ALLOW)) {
      assert.ok(typeof reason === 'string' && reason.trim().length > 20, `${key} needs a reason`);
    }
  });
});

// ── The real tree ───────────────────────────────────────────────────────────

describe('public/*.js has no unlisted method-presence guard', () => {
  const hits = PUBLIC_JS.flatMap((file) => scanSource(read(`public/${file}`), file));

  test('the sweep covers every non-vendored public/*.js and every file parses', () => {
    assert.ok(PUBLIC_JS.length >= 30, 'found ' + PUBLIC_JS.length);
    assert.ok(PUBLIC_JS.includes('common.js') && PUBLIC_JS.includes('close-out.js'));
  });

  test('every guard is allow-listed with a reason (wire the element by construction, or keep the check and say why)', () => {
    assert.deepEqual(unlisted(hits, PRESENCE_ALLOW), []);
  });

  test('the allow-list has no stale entries', () => {
    assert.deepEqual(staleEntries(hits, PRESENCE_ALLOW), []);
  });
});
