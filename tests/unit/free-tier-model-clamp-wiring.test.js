// LIN-513 regression guard. The clamp itself lives in resolveWorkspaceModel
// and resolveAiOperationModel (see workspace-model-clamp.test.js); this test
// pins the WIRING — that every billed LLM call site threads `forceDefault:
// isFreeTier`, so a free-tier request cannot select a non-default (expensive)
// model against the operator's shared free-tier key.
//
// LIN-3841: the file set is no longer a hand-kept list, and a call is no longer
// matched by its one line. Every .js under lib/ and routes/, plus server.js, is
// parsed with acorn and each call is judged from its whole argument object:
//  - a `resolveWorkspaceModel(...)` / `resolveAiOperationModel(...)` call must
//    pass `forceDefault: isFreeTier`, or its start line must be an allow-listed
//    site that bills no free-tier call (display/metadata, or the account's own key);
//  - a `runAgentTurn(...)` call must pass `isFreeTier`. The turn core clamps on
//    that parameter and defaults it to `false` (lib/agent-turn.js), so a caller
//    that omits it silently gets the non-clamped path.
// A multi-line call is judged like any other, so the old one-line rule's blind
// spot is gone, and a new caller file is scanned without anyone editing a list.
// A new billed caller without the flag, or an existing one that loses it, fails
// at the exact line. The LIN-3841 witness below drops each live clamp in memory,
// one at a time, and checks that the scan names that call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'acorn';
import { dashboardUnitFiles } from './lib/dashboard-unit.js';
import { workspaceApiUnitFiles } from './lib/workspace-api-unit.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Non-billing callers of resolveWorkspaceModel or resolveAiOperationModel:
// these resolve a model for DISPLAY or METADATA only and intentionally do NOT
// clamp (LIN-513 out-of-scope list). Matched by exact trimmed text of the call's
// start line, so the allowlist can't silently widen.
const DISPLAY_ONLY = new Set([
  // routes/workspace-api.js — footer model label (no LLM call)
  'const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: \'recommend\' })',
  // routes/workspace-api.js — reportHistoryStore.save metadata (no LLM call)
  // (LIN-3853: now resolved as the `roadmap` job; still no LLM call, so still unclamped)
  'const model = await resolveAiOperationModel({ urlKey: req.workspace.urlKey, workspacePreferencesStore, opKind: \'roadmap\' });',
]);

// Billed, but never against the shared free-tier key, so there is no `isFreeTier`
// to clamp and it is not display-only. Keyed by file, so the same call text in
// another file is not exempt (LIN-3841).
const OWN_KEY_UNATTENDED = new Map([
  ['lib/observer-pass.js', new Set([
    // The unattended pass resolves its key only from deps.getPaidEnvKey, which is
    // getUnattendedOpenRouterKey (server.js:915-935, lib/openrouter-key-resolver.js:74):
    // the account's own durable key with explicit unattended consent, never the free-tier key.
    "const model = await resolveAiOperationModel({ urlKey, workspacePreferencesStore, opKind: 'observer-pass' });"
  ])]
]);

const RESOLVER_FNS = new Set(['resolveWorkspaceModel', 'resolveAiOperationModel']);
const TURN_CORE_FN = 'runAgentTurn';
// The same parse options as tests/unit/llm-jobs-census.test.js, so the two censuses judge the same tree.
const PARSE_OPTIONS = { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true };

/** Every .js under lib/ and routes/, plus server.js, as `{ rel: src }`: the scanned set, read from the tree. */
function readTree() {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(root, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.js')) out[rel] = readFileSync(join(root, rel), 'utf8');
    }
  };
  ['lib', 'routes'].forEach(walk);
  out['server.js'] = readFileSync(join(root, 'server.js'), 'utf8');
  return out;
}

// ─── AST helpers ────────────────────────────────────────────────────────────

function visit(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => visit(c, fn));
    else if (v && typeof v.type === 'string') visit(v, fn);
  }
}

const calleeName = (call) => {
  const c = call.callee;
  if (c.type === 'Identifier') return c.name;
  return c.type === 'MemberExpression' && !c.computed ? c.property.name : null;
};
const propName = (p) => (p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null);
const isIdent = (node, name) => node?.type === 'Identifier' && node.name === name;

/** The `key: value` property of a call's first argument, when that argument is an object literal; else null. */
function optionProperty(call, key) {
  const obj = call.arguments[0];
  if (obj?.type !== 'ObjectExpression') return null;
  return obj.properties.find((p) => p.type === 'Property' && !p.computed && propName(p) === key) ?? null;
}

/**
 * One file's wiring. `problems` names each resolver call that is neither clamped nor
 * allow-listed, and each runAgentTurn call without isFreeTier. `billed` counts clamped
 * resolver calls and `turnCalls` the runAgentTurn calls. `matched` is the allow-list
 * entries this file used. `clamps` locates each live clamp, for the planted-offender witness.
 */
function scanFile(rel, src) {
  const out = { problems: [], billed: 0, turnCalls: 0, matched: new Set(), clamps: [] };
  let ast;
  try {
    ast = parse(src, PARSE_OPTIONS);
  } catch (err) {
    out.problems.push(`${rel}: does not parse, so its calls cannot be judged: ${err.message}`);
    return out;
  }
  const lines = src.split('\n');
  visit(ast, (node) => {
    // The census judges calls by name, so a judged function imported under another
    // local name would escape it. Report the import rather than chase the alias.
    if (node.type === 'ImportSpecifier' && (RESOLVER_FNS.has(node.imported.name) || node.imported.name === TURN_CORE_FN) && node.local.name !== node.imported.name) {
      const line = src.slice(0, node.start).split('\n').length;
      out.problems.push(`${rel}:${line} imports ${node.imported.name} as ${node.local.name}: the census judges calls by name`);
      return;
    }
    if (node.type !== 'CallExpression') return;
    const name = calleeName(node);
    if (name !== TURN_CORE_FN && !RESOLVER_FNS.has(name)) return;
    // The call's start line: for a multi-line call, the line the callee is on.
    const line = src.slice(0, node.start).split('\n').length;
    const text = lines[line - 1].trim();
    if (name === TURN_CORE_FN) {
      out.turnCalls++;
      if (!isIdent(optionProperty(node, 'isFreeTier')?.value, 'isFreeTier')) {
        out.problems.push(`${rel}:${line} calls ${name} without isFreeTier: ${text}`);
      }
      return;
    }
    const prop = optionProperty(node, 'forceDefault');
    if (isIdent(prop?.value, 'isFreeTier')) {
      out.billed++;
      out.clamps.push({ line, prop });
      return;
    }
    if (DISPLAY_ONLY.has(text)) out.matched.add(text);
    else if (OWN_KEY_UNATTENDED.get(rel)?.has(text)) out.matched.add(`${rel}: ${text}`);
    else out.problems.push(`${rel}:${line} calls ${name} without the free-tier clamp and is not an allow-listed display/metadata site: ${text}`);
  });
  return out;
}

/** The scan over `{ rel: src }`: every problem, and the totals the non-vacuity guards read. */
function scan(sources) {
  const result = { problems: [], billed: 0, turnCalls: 0, matched: new Set() };
  for (const [rel, src] of Object.entries(sources)) {
    const f = scanFile(rel, src);
    result.problems.push(...f.problems);
    result.billed += f.billed;
    result.turnCalls += f.turnCalls;
    f.matched.forEach((k) => result.matched.add(k));
  }
  return result;
}

const allowEntries = () => [
  ...DISPLAY_ONLY,
  ...[...OWN_KEY_UNATTENDED].flatMap(([rel, lines]) => [...lines].map((l) => `${rel}: ${l}`)),
];
/** Allow-list entries that no call in `sources` matched. A renamed or deleted site leaves one behind. */
const staleEntries = (sources) => {
  const { matched } = scan(sources);
  return allowEntries().filter((e) => !matched.has(e));
};

// ─── LIN-513 / LIN-3841: the whole tree ─────────────────────────────────────

test('every billed resolveWorkspaceModel / resolveAiOperationModel call threads forceDefault: isFreeTier', () => {
  const sources = readTree();
  assert.ok(Object.keys(sources).length > 0, 'the tree is scanned');
  const { problems, billed } = scan(sources);
  assert.deepEqual(problems, []);
  assert.deepEqual(staleEntries(sources), [], 'allow-list entries that match no call');
  // LIN-3218 (LIN-3201 A1): the numeric total ("17 billed sites") is gone. The
  // boundary rule IS the assertion: every resolver call in the tree is either
  // clamped (`forceDefault: isFreeTier`) or exactly one allow-list entry above.
  // A new billed caller — or a lost clamp on an existing one — fails at the
  // exact line, with no total to bump. Non-vacuity is proven by the planted-offender
  // witness below, not a pinned count.
  assert.ok(billed > 0, 'expected at least one clamped billed site — a zero scan would be vacuous');
});

test('LIN-3841: every runAgentTurn call (the turn core) passes isFreeTier', () => {
  const { problems, turnCalls } = scan(readTree());
  assert.deepEqual(problems.filter((p) => p.includes(` calls ${TURN_CORE_FN} `)), []);
  assert.ok(turnCalls > 0, 'expected the turn-core callers — a zero scan would be vacuous');
});

// Built from the live tree, one clamp at a time: that call's `forceDefault: isFreeTier`
// property is removed in memory (never on disk), and the scan must name exactly that
// call's start line. Covers flight-companion, ship-biscuit, agent-turn, workspace-preferences
// and every other clamped site, with no file name hard-coded, so it survives moves.
test('LIN-3841 witness: dropping forceDefault: isFreeTier from ANY live billed site fails at that call', () => {
  let planted = 0;
  for (const [rel, src] of Object.entries(readTree())) {
    for (const { line, prop } of scanFile(rel, src).clamps) {
      planted++;
      const hit = scanFile(rel, withoutProperty(src, prop)).problems;
      assert.equal(hit.length, 1, `${rel}:${line}: ${hit.join('\n')}`);
      assert.ok(hit[0].startsWith(`${rel}:${line} calls `), hit[0]);
    }
  }
  assert.ok(planted > 0, 'a zero scan is vacuous');
});

/** `src` with one property removed, and a comma that would otherwise dangle, so the call still parses. */
function withoutProperty(src, prop) {
  const before = src.slice(0, prop.start);
  const after = src.slice(prop.end);
  return /^\s*,/.test(after) ? before + after.replace(/^\s*,/, '') : before.replace(/,\s*$/, '') + after;
}

// ─── LIN-3840: the dashboard routes as one unit ──────────────────────────────
// The same rule over the whole dashboard unit (routes/dashboard.js and
// routes/dashboard-*.js; tests/unit/lib/dashboard-unit.js), so the
// createDashboardRoutes rebuild (LIN-3742) can place its two summary routes in any
// unit file and a file that holds a billed call is still scanned.
//
// LIN-3841: the file set for the whole tree is now derived from the tree (see above);
// the unit helpers still anchor the LIN-3840 and LIN-3861 unit tests.

/** Unclamped, non-allow-listed wiring problems in `{ rel: src }`; [] means clean. */
function clampProblems(sources) {
  const { problems, billed } = scan(sources);
  if (billed === 0) problems.push('no clamped billed site found: a zero scan is vacuous');
  return problems;
}

test('LIN-3840: every billed call in the dashboard unit threads forceDefault: isFreeTier', () => {
  const sources = Object.fromEntries(dashboardUnitFiles(root).map(rel => [rel, readFileSync(join(root, rel), 'utf8')]));
  assert.deepEqual(clampProblems(sources), []);
  // Both summary routes are billed sites in the unit.
  const clamped = Object.values(sources).join('\n').split('\n').filter(l => l.includes('resolveAiOperationModel({') && l.includes('forceDefault: isFreeTier'));
  assert.equal(clamped.length, 2);
});

// Built from synthetic unit files, never from the live text of routes/dashboard.js.
test('LIN-3840 witness: dropping forceDefault: isFreeTier from the run-summary site of any unit file fails', () => {
  const clamped = "const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'run-summary', forceDefault: isFreeTier });";
  const dropped = clamped.replace(', forceDefault: isFreeTier', '');
  assert.notEqual(dropped, clamped);
  assert.deepEqual(clampProblems({ 'routes/dashboard.js': clamped }), []);
  assert.deepEqual(clampProblems({ 'routes/dashboard.js': '', 'routes/dashboard-body.js': clamped }), []);
  const hit = clampProblems({ 'routes/dashboard.js': clamped, 'routes/dashboard-body.js': `\n${dropped}` });
  assert.equal(hit.length, 1, hit.join('\n'));
  assert.match(hit[0], /^routes\/dashboard-body\.js:2 /);
});

// ─── LIN-3861: the workspace-API routes as one unit ──────────────────────────
// The same rule over the whole workspace-API unit (routes/workspace-api.js and
// routes/workspace-api-*.js; tests/unit/lib/workspace-api-unit.js). A billed call
// anywhere in the unit is scanned.
//
// Reported, not fixed here: the DISPLAY_ONLY comment above says the metadata line
// (`reportHistoryStore.save` metadata) is in routes/workspace-api.js, but that line lives in
// routes/workspace-api-roadmap.js. Both display-only lines are matched by their exact content, not
// their location, so the allow-list is unaffected. No ticket identified.
const readUnit = () => Object.fromEntries(workspaceApiUnitFiles(root).map(rel => [rel, readFileSync(join(root, rel), 'utf8')]));

test('LIN-3861: every billed call in the workspace-API unit threads forceDefault: isFreeTier', () => {
  const sources = readUnit();
  assert.ok(Object.keys(sources).length >= 4, 'the unit is listed');
  assert.deepEqual(clampProblems(sources), []);
  // Billed sites exist in the unit (a zero scan would be vacuous; clampProblems also fails it).
  const clamped = Object.values(sources).join('\n').split('\n').filter(l => /resolve(?:AiOperation|Workspace)Model\(\{/.test(l) && l.includes('forceDefault: isFreeTier'));
  assert.ok(clamped.length > 0);
});

// Built from synthetic unit files, never from the live text of routes/workspace-api.js (which is free to move).
test('LIN-3861 witness: dropping forceDefault: isFreeTier from a billed site in ANY unit file fails', () => {
  const clamped = "const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recap', forceDefault: isFreeTier });";
  const dropped = clamped.replace(', forceDefault: isFreeTier', '');
  assert.notEqual(dropped, clamped);
  assert.deepEqual(clampProblems({ 'routes/workspace-api.js': clamped }), []);
  assert.deepEqual(clampProblems({ 'routes/workspace-api.js': '', 'routes/workspace-api-x.js': clamped }), []);
  for (const rel of ['routes/workspace-api.js', 'routes/workspace-api-prompts.js', 'routes/workspace-api-steps.js', 'routes/workspace-api-x.js']) {
    const hit = clampProblems({ 'routes/workspace-api-roadmap.js': clamped, [rel]: `\n${dropped}` });
    assert.equal(hit.length, 1, `${rel}: ${hit.join('\n')}`);
    assert.match(hit[0], new RegExp(`^${rel.replace(/\./g, '\\.')}:2 `));
  }
});

test('LIN-3861 witness: a zero scan of the unit is vacuous and fails', () => {
  assert.deepEqual(clampProblems({ 'routes/workspace-api.js': 'export {};\n' }), ['no clamped billed site found: a zero scan is vacuous']);
});

// ─── LIN-3841: the rule itself, on synthetic files ──────────────────────────

test('LIN-3841 witness: a multi-line unclamped call in a new lib file fails at its start line; clamped on its own line it passes', () => {
  const src = [
    'export async function run(deps) {',
    '  const model = await resolveAiOperationModel({',
    '    urlKey: deps.urlKey,',
    '    workspacePreferencesStore: deps.store,',
    "    opKind: 'x',",
    '  });',
    '  return model;',
    '}',
  ].join('\n');
  const problems = scan({ 'lib/x.js': src }).problems;
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.ok(problems[0].startsWith('lib/x.js:2 calls resolveAiOperationModel '), problems[0]);
  const clamped = src.replace("    opKind: 'x',", "    opKind: 'x',\n    forceDefault: isFreeTier,");
  const ok = scan({ 'lib/x.js': clamped });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.billed, 1);
});

test('LIN-3841 witness: a clamp that is false, negated, spread away, or missing fails', () => {
  for (const call of [
    "const m = await resolveAiOperationModel({ urlKey, workspacePreferencesStore, forceDefault: false, opKind: 'x' });",
    "const m = await resolveAiOperationModel({ urlKey, workspacePreferencesStore, forceDefault: !isFreeTier, opKind: 'x' });",
    'const m = await resolveAiOperationModel({ ...opts });',
    'const m = await resolveAiOperationModel(opts);',
    "const m = await deps.resolveAiOperationModel({ urlKey, opKind: 'x' });",
  ]) {
    assert.equal(scan({ 'lib/x.js': call }).problems.length, 1, call);
  }
});

test('LIN-3841 witness: an own-key allow-list line is exempt only in its own file', () => {
  const own = "const model = await resolveAiOperationModel({ urlKey, workspacePreferencesStore, opKind: 'observer-pass' });";
  assert.deepEqual(scan({ 'lib/observer-pass.js': own }).problems, []);
  assert.equal(scan({ 'lib/other.js': own }).problems.length, 1);
});

test('LIN-3841 witness: a runAgentTurn call without isFreeTier fails; shorthand and explicit pass', () => {
  const turn = (opt) => `const outcome = await runAgentTurn({\n  workspace,\n  ${opt}\n});`;
  assert.deepEqual(scan({ 'routes/x.js': turn('isFreeTier,') }).problems, []);
  assert.deepEqual(scan({ 'routes/x.js': turn('isFreeTier: isFreeTier,') }).problems, []);
  for (const opt of ['isFreeTier: false,', 'turnKind,']) {
    const problems = scan({ 'routes/x.js': turn(opt) }).problems;
    assert.equal(problems.length, 1, opt);
    assert.ok(problems[0].startsWith('routes/x.js:1 calls runAgentTurn without isFreeTier'), problems[0]);
  }
});

test('LIN-3841 witness: importing a judged function under another name fails, naming the alias', () => {
  const resolver = "import { resolveAiOperationModel as pick } from './m.js';\nconst m = await pick({ urlKey, opKind: 'x' });";
  const turn = "import { runAgentTurn as turn } from './t.js';\nawait turn({});";
  const p1 = scan({ 'lib/x.js': resolver }).problems;
  assert.ok(p1.some((p) => p.startsWith('lib/x.js:1 imports resolveAiOperationModel as pick:')), p1.join('\n'));
  const p2 = scan({ 'lib/y.js': turn }).problems;
  assert.ok(p2.some((p) => p.startsWith('lib/y.js:1 imports runAgentTurn as turn:')), p2.join('\n'));
  // A plain named import is not an alias.
  assert.deepEqual(scan({ 'lib/z.js': "import { runAgentTurn } from './t.js';\nawait runAgentTurn({ isFreeTier });" }).problems, []);
});

test('LIN-3841 witness: an allow-list entry that matches no call is reported as stale', () => {
  // Nothing in this file matches any entry, so every entry is reported.
  assert.equal(staleEntries({ 'lib/x.js': 'export {};\n' }).length, allowEntries().length);
});
