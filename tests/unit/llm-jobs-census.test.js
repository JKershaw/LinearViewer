/**
 * LIN-3852: the census of LLM uses. Every use of a model in Harbour is a job in
 * lib/llm-jobs.js, and the build fails on one that is not.
 *
 * Static and AST-based (acorn) over lib/, routes/ and server.js. The checker is a
 * pure function over a `{ path: source }` map, so the failure witnesses below run
 * it over the real tree plus an in-memory fixture and watch it name the offender.
 *
 * What it pins, and what it does not:
 *  - the dispatch kinds and the registry's agent-session jobs are the same set;
 *  - every call into lib/openrouter.js's four functions (and the injected seams)
 *    is accounted for in CALL_PATHS, and its `callMeta` carries `urlKey`, because
 *    every reader of the call log filters by `urlKey` and a row without one is
 *    written and never listed;
 *  - every model call's `callMeta` names a job (`feature` or `opKind`), unless it is a
 *    passthrough wrapper, and a non-literal `callMeta` is excused only when its options
 *    come from a builder CALL_PATHS names (LIN-3870);
 *  - every `feature:` / `opKind:` string literal is a registered job id, and every
 *    Harbour-call job is used by at least one of them;
 *  - the wrappers that take their `callMeta` from the caller (brief, recap, scan,
 *    feedback title, run summary, session summary, run paragraph) are only ever
 *    called with a `callMeta` that carries `urlKey`.
 * It reads the LITERAL provenance. A caller can still override `feature` through the
 * `...(options.callMeta || {})` spread at run time (as brief, recap and scan always
 * could); a static test cannot see values, so a `urlKey` that is present in code but
 * falsy at run time (`urlKey || null` in the roadmap routes) is the residual.
 * Callees are matched by name, including a renamed import (`streamChat as sc2`, a wrapper
 * `as gb`) and a namespace member (`o.streamChat`, `o['streamChat']`). A call that
 * reaches one without a name in the file (a dynamic-import or namespace destructure, a
 * reassignment, a re-export under a new name, a string-literal specifier, a template-literal
 * key) is out of reach of a static name census, and none occur in the tree (LIN-3867).
 *
 * Run with: node --test tests/unit/llm-jobs-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { DISPATCH_KINDS } from '../../lib/prompt-templates.js';
import { AI_OPERATION_KINDS } from '../../lib/workspace-preferences.js';
import { JOBS, GROUPS, SURFACES } from '../../lib/llm-jobs.js';
import { isWorkspaceApiUnitFile } from './lib/workspace-api-unit.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The four lib/openrouter.js functions that make a model call.
const LLM_FNS = new Set(['getRecommendationStream', 'streamChat', 'streamChatWithTools', 'getRecommendation']);
// Injected seams that stand in for one of them (a bare identifier call).
const SEAMS = { 'lib/run-paragraph.js': new Set(['chat']) };
// LIN-3867: the module the LLM_FNS names come from. Its named imports may be renamed
// (`streamChat as sc2`) and its namespace import may be called by member (`o.streamChat`).
const OPENROUTER_MODULE = /(^|\/)openrouter\.js$/;

// Wrappers whose callMeta the CALLER supplies. A call to any of these must pass a
// `callMeta` object literal with `urlKey`; the wrapper adds the `feature`.
// `generate` is generateCachedDocument's injected brief/recap generator
// (routes/workspace-api.js); `generateSummary` / `generateParagraph` are the
// precompute seams (lib/session-materializer-precompute.js, lib/run-paragraph-hook.js).
const WRAPPERS = {
  generateBrief: 'brief', generateRecap: 'recap', generateScan: 'scan',
  generateFeedbackTitle: 'feedback-title',
  generateRunSummary: 'run-summary', generateSessionSummary: 'session-summary',
  generateRunParagraph: 'run-paragraph',
  generateSummary: 'session-summary', generateParagraph: 'run-paragraph',
  generate: null,
};

// The call paths, by file: how many call expressions it holds, and which functions
// build the `callMeta` for the ones that take their options from a builder. A site
// is 'inline' when its own `callMeta` literal carries urlKey, 'passthrough' (marked
// `passthrough: true`; the only files where a spread may stand in for urlKey) when it
// spreads the caller's callMeta over a feature default (covered by WRAPPERS), and
// 'builder' when the options come from a named function (checked by name).
const WORKSPACE_API_UNIT = 'workspace-API unit';
const CALL_PATHS = {
  'lib/agent-turn.js': { sites: 2 },
  'lib/brief.js': { sites: 1, passthrough: true },
  'lib/feedback-title.js': { sites: 1, passthrough: true },
  'lib/observer-pass.js': { sites: 1 },
  'lib/recap.js': { sites: 1, passthrough: true },
  'lib/run-paragraph.js': { sites: 1, passthrough: true },
  'lib/run-summary.js': { sites: 1, passthrough: true },
  'lib/scan.js': { sites: 1, passthrough: true },
  'lib/session-summary.js': { sites: 1, passthrough: true },
  'routes/proxy.js': { sites: 1 },
  'routes/ship-biscuit.js': { sites: 1 },
  // The workspace-API unit (LIN-3861) is judged as a whole: 4 sites in the
  // recommend/feedback groups plus the roadmap's 3, and the builder may live in any
  // unit file, so the route groups can move between them. Keyed by the unit, not a file.
  [WORKSPACE_API_UNIT]: { sites: 7, builders: ['recommendCallOptions'] },
};

const SCAN_DIRS = ['lib', 'routes'];
const SCAN_FILES = ['server.js'];
const NOT_CALL_SITES = new Set(['lib/openrouter.js']); // defines the functions

function readTree() {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) walk(rel);
      else if (name.endsWith('.js')) out[rel] = readFileSync(join(ROOT, rel), 'utf8');
    }
  };
  SCAN_DIRS.forEach(walk);
  for (const f of SCAN_FILES) out[f] = readFileSync(join(ROOT, f), 'utf8');
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

const propName = (p) => (p.key?.type === 'Identifier' ? p.key.name : p.key?.type === 'Literal' ? String(p.key.value) : null);
const lineOf = (src, node) => src.slice(0, node.start).split('\n').length;

/** What a `callMeta` object literal carries: its keys and whether it spreads. */
function describeObject(obj) {
  const keys = new Set();
  let spreads = false;
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') spreads = true;
    else { const n = propName(p); if (n) keys.add(n); }
  }
  return { keys, spreads };
}

/** Whether a callMeta's keys name a job: a `feature` or an `opKind` (LIN-3870). */
const namesJob = (keys) => keys.has('feature') || keys.has('opKind');

/** What a named builder's callMeta must carry, as problems (empty = clean). */
function builderProblems(path, name, meta) {
  if (!meta || !meta.keys.has('urlKey')) return [`${path}: builder ${name}() does not put urlKey in its callMeta`];
  if (!namesJob(meta.keys)) return [`${path}: builder ${name}() does not put feature or opKind in its callMeta`];
  return [];
}

function analyse(path, src) {
  const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const consts = new Map(); // name -> ObjectExpression, for `const callMeta = {...}`
  const functions = new Map(); // name -> FunctionDeclaration
  const labels = [];
  const sites = [];
  const wrapperCalls = [];
  const cachedDocCalls = [];
  const aliases = new Map(); // local name -> LLM_FNS name, for `import { streamChat as sc2 }`
  const namespaces = new Set(); // local name, for `import * as o`
  const wrapperAliases = new Map(); // local name -> WRAPPERS name, for `import { generateBrief as gb }` (any source)
  const builderBindings = new Map(); // local name -> callee, for `const opts = recommendCallOptions(...)` (LIN-3870)

  visit(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'ObjectExpression') consts.set(n.id.name, n.init);
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'CallExpression' && n.init.callee.type === 'Identifier') builderBindings.set(n.id.name, n.init.callee.name);
    if (n.type === 'FunctionDeclaration' && n.id) functions.set(n.id.name, n);
    if (n.type === 'ImportDeclaration') {
      for (const s of n.specifiers) {
        if (s.type === 'ImportSpecifier' && Object.hasOwn(WRAPPERS, s.imported.name) && WRAPPERS[s.imported.name]) wrapperAliases.set(s.local.name, s.imported.name);
      }
    }
    if (n.type === 'ImportDeclaration' && OPENROUTER_MODULE.test(n.source.value)) {
      for (const s of n.specifiers) {
        if (s.type === 'ImportNamespaceSpecifier') namespaces.add(s.local.name);
        else if (s.type === 'ImportSpecifier' && LLM_FNS.has(s.imported.name)) aliases.set(s.local.name, s.imported.name);
      }
    }
    if (n.type === 'Property' && (propName(n) === 'feature' || propName(n) === 'opKind') && n.value.type === 'Literal' && typeof n.value.value === 'string') {
      labels.push({ file: path, line: lineOf(src, n), key: propName(n), value: n.value.value });
    }
    // `opKind = 'flight-companion'` as a parameter default (lib/agent-turn.js)
    if (n.type === 'AssignmentPattern' && n.left.type === 'Identifier' && n.left.name === 'opKind' && n.right.type === 'Literal') {
      labels.push({ file: path, line: lineOf(src, n), key: 'opKind', value: n.right.value });
    }
  });

  // The functions an argument's options may come from: the callee of a call expression
  // (`recommendCallOptions(...)`), the builder an identifier is bound to, or, for a spread of
  // a same-file function (`...await modelCallArgs(...)`), that function plus the calls in the
  // argument list it returns. Empty for anything else (LIN-3870).
  const optionBuilders = (arg) => {
    let node = arg.type === 'SpreadElement' ? arg.argument : arg;
    if (node.type === 'AwaitExpression') node = node.argument;
    if (node.type === 'Identifier') return builderBindings.has(node.name) ? [builderBindings.get(node.name)] : [];
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return [];
    const names = [node.callee.name];
    const fn = functions.get(node.callee.name);
    if (fn) {
      visit(fn, (n) => {
        if (n.type !== 'ReturnStatement' || n.argument?.type !== 'ArrayExpression') return;
        for (const el of n.argument.elements) if (el?.type === 'CallExpression' && el.callee.type === 'Identifier') names.push(el.callee.name);
      });
    }
    return names;
  };

  // The callMeta a call passes: the first `callMeta` property in its arguments.
  const callMetaOf = (call) => {
    // 'unresolved' carries the functions the options may come from (`builders`), which
    // checkCensus matches against the entry's named builders (LIN-3870).
    const unresolved = () => ({ state: 'unresolved', builders: call.arguments.flatMap(optionBuilders) });
    let found = null;
    for (const arg of call.arguments) {
      visit(arg, (n) => {
        if (found || n.type !== 'Property' || propName(n) !== 'callMeta') return;
        if (n.value.type === 'ObjectExpression') found = { state: 'literal', ...describeObject(n.value) };
        else if (n.value.type === 'Identifier' && consts.has(n.value.name)) found = { state: 'literal', ...describeObject(consts.get(n.value.name)) };
        else found = unresolved();
      });
    }
    if (found) return found;
    // No callMeta anywhere: 'none' when the options are an object literal here, else unresolved.
    if (call.arguments.some((a) => a.type === 'ObjectExpression')) return { state: 'none' };
    return unresolved();
  };

  visit(ast, (n) => {
    if (n.type !== 'CallExpression') return;
    const c = n.callee;
    // A computed member counts only on a namespace import with a string key (`o['streamChat']`).
    const name = c.type === 'Identifier' ? c.name
      : c.type !== 'MemberExpression' ? null
        : !c.computed ? c.property.name
          : namespaces.has(c.object.name) && c.property.type === 'Literal' ? c.property.value : null;
    if (!name) return;
    const isSeam = c.type === 'Identifier' && SEAMS[path]?.has(name);
    const isAlias = c.type === 'Identifier' && aliases.has(name);
    if (!NOT_CALL_SITES.has(path) && (LLM_FNS.has(name) || isSeam || isAlias)) {
      sites.push({ file: path, line: lineOf(src, n), name, meta: callMetaOf(n) });
    }
    if (c.type === 'Identifier' && (Object.hasOwn(WRAPPERS, name) || wrapperAliases.has(name)) && !functions.has(name)) {
      wrapperCalls.push({ file: path, line: lineOf(src, n), name, meta: callMetaOf(n) });
    }
    if (c.type === 'Identifier' && name === 'generateCachedDocument' && n.arguments[0]?.type === 'Literal') {
      cachedDocCalls.push({ file: path, line: lineOf(src, n), kind: n.arguments[0].value });
    }
  });

  return { path, functions, labels, sites, wrapperCalls, cachedDocCalls, consts };
}

/** Everything the census asserts, as a list of problems (empty = clean). */
export function checkCensus({ sources, dispatchKinds, aiOperationKinds, jobs }) {
  const problems = [];
  const ids = new Set(jobs.map((j) => j.id));

  // 1. The registry's shape.
  const seen = new Set();
  for (const j of jobs) {
    if (seen.has(j.id)) problems.push(`job id "${j.id}" is registered twice`);
    seen.add(j.id);
    if (!Object.hasOwn(GROUPS, j.group)) problems.push(`job "${j.id}" has no valid group (got ${JSON.stringify(j.group)})`);
    if (!Object.values(SURFACES).includes(j.surface)) problems.push(`job "${j.id}" has no valid surface (got ${JSON.stringify(j.surface)})`);
    if (typeof j.description !== 'string' || !j.description.trim() || /\n/.test(j.description)) problems.push(`job "${j.id}" needs a non-empty one-line description`);
  }

  // 2. Dispatch kinds are the agent-session jobs (`defer` never reaches the queue).
  const agentIds = new Set(jobs.filter((j) => j.surface === SURFACES.AGENT_SESSION).map((j) => j.id));
  const kinds = new Set(dispatchKinds.filter((k) => k !== 'defer'));
  for (const k of kinds) if (!agentIds.has(k)) problems.push(`dispatch kind "${k}" is not an agent-session job`);
  for (const id of agentIds) if (!kinds.has(id)) problems.push(`agent-session job "${id}" is not a dispatch kind`);
  for (const k of ['defer', 'wake']) if (ids.has(k)) problems.push(`"${k}" must not be a job`);
  const harbourIds = new Set(jobs.filter((j) => j.surface === SURFACES.HARBOUR_CALL).map((j) => j.id));
  for (const k of aiOperationKinds) if (!harbourIds.has(k)) problems.push(`AI operation kind "${k}" is not a harbour-call job`);

  // 3. Parse the tree.
  const files = [];
  for (const [path, src] of Object.entries(sources)) {
    try { files.push(analyse(path, src)); } catch (e) { problems.push(`${path}: cannot parse (${e.message})`); }
  }
  const byPath = new Map(files.map((f) => [f.path, f]));

  // 4. Call-path inventory, and urlKey provenance at each site.
  const unitFiles = files.filter((f) => isWorkspaceApiUnitFile(f.path));
  const unitSites = unitFiles.reduce((n, f) => n + f.sites.length, 0);
  if (unitSites !== CALL_PATHS[WORKSPACE_API_UNIT].sites) {
    problems.push(`${WORKSPACE_API_UNIT} has ${unitSites} model call(s), CALL_PATHS says ${CALL_PATHS[WORKSPACE_API_UNIT].sites}`);
  }
  for (const f of files) {
    const entry = isWorkspaceApiUnitFile(f.path) ? CALL_PATHS[WORKSPACE_API_UNIT] : CALL_PATHS[f.path];
    if (f.sites.length && !entry) {
      for (const s of f.sites) problems.push(`${s.file}:${s.line} ${s.name}() is a model call with no CALL_PATHS entry`);
      continue;
    }
    if (entry && !isWorkspaceApiUnitFile(f.path) && f.sites.length !== entry.sites) {
      problems.push(`${f.path} has ${f.sites.length} model call(s), CALL_PATHS says ${entry.sites}${f.sites.length ? ` (at ${f.sites.map((s) => s.line).join(', ')})` : ''}`);
    }
    for (const s of f.sites) {
      const m = s.meta;
      if (m.state === 'none') problems.push(`${s.file}:${s.line} ${s.name}() passes no callMeta, so its row has no urlKey and no log reader returns it`);
      else if (m.state === 'literal' && !m.keys.has('urlKey') && !(m.spreads && entry?.passthrough)) problems.push(`${s.file}:${s.line} ${s.name}() callMeta has no urlKey, so its row is never listed`);
      else if (m.state === 'literal' && !namesJob(m.keys) && !(m.spreads && entry?.passthrough)) problems.push(`${s.file}:${s.line} ${s.name}() callMeta names no feature or opKind, so its row has no job`);
      // LIN-3870: a non-literal callMeta is excused only when the options come from a named builder.
      else if (m.state === 'unresolved' && !m.builders.some((b) => entry?.builders?.includes(b))) problems.push(`${s.file}:${s.line} ${s.name}() takes its options from something other than a CALL_PATHS builder`);
    }
    for (const b of isWorkspaceApiUnitFile(f.path) ? [] : entry?.builders || []) {
      const fn = f.functions.get(b);
      let meta = null;
      if (fn) visit(fn, (n) => { if (!meta && n.type === 'Property' && propName(n) === 'callMeta' && n.value.type === 'ObjectExpression') meta = describeObject(n.value); });
      if (!fn) problems.push(`${f.path}: builder ${b}() named in CALL_PATHS does not exist`);
      else problems.push(...builderProblems(f.path, b, meta));
    }
  }
  for (const b of CALL_PATHS[WORKSPACE_API_UNIT].builders) {
    const holders = unitFiles.filter((f) => f.functions.has(b));
    if (holders.length !== 1) { problems.push(`${WORKSPACE_API_UNIT}: builder ${b}() is defined in ${holders.length} unit files, expected 1`); continue; }
    let meta = null;
    visit(holders[0].functions.get(b), (n) => { if (!meta && n.type === 'Property' && propName(n) === 'callMeta' && n.value.type === 'ObjectExpression') meta = describeObject(n.value); });
    problems.push(...builderProblems(holders[0].path, b, meta));
  }
  if (!unitFiles.length) problems.push(`CALL_PATHS names the ${WORKSPACE_API_UNIT}, which has no file in the scanned tree`);
  for (const path of Object.keys(CALL_PATHS)) if (path !== WORKSPACE_API_UNIT && !byPath.has(path)) problems.push(`CALL_PATHS names ${path}, which is not in the scanned tree`);

  // 5. Wrappers that take callMeta from the caller.
  for (const f of files) {
    for (const w of f.wrapperCalls) {
      const m = w.meta;
      if (m.state !== 'literal' || !m.keys.has('urlKey')) {
        problems.push(`${w.file}:${w.line} ${w.name}() is called without callMeta.urlKey, so its row is never listed`);
      }
    }
    for (const c of f.cachedDocCalls) if (!ids.has(c.kind)) problems.push(`${c.file}:${c.line} generateCachedDocument('${c.kind}') names no registered job`);
  }

  // 6. Labels.
  const used = new Set();
  for (const f of files) {
    for (const l of f.labels) {
      used.add(l.value);
      if (!ids.has(l.value)) problems.push(`${l.file}:${l.line} ${l.key}: '${l.value}' is not a registered job`);
    }
  }
  for (const j of jobs) {
    if (j.surface === SURFACES.HARBOUR_CALL && !used.has(j.id)) problems.push(`harbour-call job "${j.id}" is used by no feature/opKind label`);
  }
  for (const w of Object.values(WRAPPERS)) if (w && !ids.has(w)) problems.push(`wrapper feature "${w}" is not a registered job`);

  return problems;
}

// ─── The census ─────────────────────────────────────────────────────────────

describe('LIN-3852: every LLM use is a registered job', () => {
  const sources = readTree();
  const inputs = { sources, dispatchKinds: DISPATCH_KINDS, aiOperationKinds: AI_OPERATION_KINDS, jobs: JOBS };

  test('the real tree is clean', () => {
    assert.deepEqual(checkCensus(inputs), []);
  });

  test('the registry has the 20 agent-session and 16 Harbour-call jobs of the design note', () => {
    assert.equal(JOBS.filter((j) => j.surface === SURFACES.AGENT_SESSION).length, 20);
    assert.equal(JOBS.filter((j) => j.surface === SURFACES.HARBOUR_CALL).length, 16);
  });

  // ─── Failure witnesses: the checker names what it finds ───────────────────

  test('a call labelled with an unregistered job fails, naming the label and file', () => {
    const fixture = "import { streamChat } from './openrouter.js';\nexport const f = () => streamChat([], { callMeta: { urlKey: 'u', feature: 'made-up-job' } }, () => {});\n";
    const problems = checkCensus({ ...inputs, sources: { ...sources, 'lib/fixture-made-up.js': fixture } });
    assert.ok(problems.some((p) => p.includes('made-up-job') && p.includes('lib/fixture-made-up.js')), problems.join('\n'));
    assert.ok(problems.some((p) => p.includes('lib/fixture-made-up.js') && p.includes('no CALL_PATHS entry')), problems.join('\n'));
  });

  test('a dispatch kind with no job fails, naming the kind', () => {
    const problems = checkCensus({ ...inputs, dispatchKinds: [...DISPATCH_KINDS, 'fixture-kind'] });
    assert.deepEqual(problems, ['dispatch kind "fixture-kind" is not an agent-session job']);
  });

  test('an agent job that is no dispatch kind fails, naming the job', () => {
    const problems = checkCensus({ ...inputs, dispatchKinds: DISPATCH_KINDS.filter((k) => k !== 'triage') });
    assert.deepEqual(problems, ['agent-session job "triage" is not a dispatch kind']);
  });

  // The witnesses swap a registered call site's text for a synthetic one (the next-run
  // site they used to edit is retired). observer-pass is a one-site streamChat unit.
  const OBSERVER_SITE = "import { streamChat } from './openrouter.js';\n";

  test('a call whose callMeta has a feature but no urlKey fails, naming the site', () => {
    const edited = OBSERVER_SITE + "export const f = (options) => streamChat([], { callMeta: { feature: 'observer-pass' } }, () => {});\n";
    const problems = checkCensus({ ...inputs, sources: { ...sources, 'lib/observer-pass.js': edited } });
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /^lib\/observer-pass\.js:\d+ streamChat\(\) callMeta has no urlKey/);
  });

  test('a spread in callMeta does not excuse a missing urlKey outside a marked passthrough wrapper', () => {
    const edited = OBSERVER_SITE + "export const f = (options) => streamChat([], { callMeta: { feature: 'observer-pass', ...(options.extraMeta || {}) } }, () => {});\n";
    const problems = checkCensus({ ...inputs, sources: { ...sources, 'lib/observer-pass.js': edited } });
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /^lib\/observer-pass\.js:\d+ streamChat\(\) callMeta has no urlKey/);
  });

  // LIN-3867: a model call reached through an import alias or a namespace import is a
  // call site like any other. Witnesses are synthetic maps, not text pins.
  test('a call through a named import alias is a site, and its callMeta is checked (LIN-3867)', () => {
    const edited = "import { streamChat as sc2 } from './openrouter.js';\nexport const f = (options) => sc2([], { callMeta: { feature: 'observer-pass' } }, () => {});\n";
    const problems = checkCensus({ ...inputs, sources: { ...sources, 'lib/observer-pass.js': edited } });
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /^lib\/observer-pass\.js:\d+ sc2\(\) callMeta has no urlKey/);
  });

  test('an aliased model call in a file with no CALL_PATHS entry fails, naming the alias (LIN-3867)', () => {
    const fixture = "import { streamChat as sc2 } from './openrouter.js';\nexport const f = () => sc2([], { callMeta: { urlKey: 'u', feature: 'observer-pass' } }, () => {});\n";
    const problems = checkCensus({ ...inputs, sources: { ...sources, 'lib/fixture-alias.js': fixture } });
    assert.ok(problems.some((p) => /^lib\/fixture-alias\.js:\d+ sc2\(\) is a model call with no CALL_PATHS entry/.test(p)), problems.join('\n'));
  });

  test('a namespace-import member call in a file with no CALL_PATHS entry fails (LIN-3867)', () => {
    const fixture = "import * as o from './openrouter.js';\nexport const f = () => o.streamChat([], { callMeta: { urlKey: 'u', feature: 'observer-pass' } }, () => {});\n";
    const problems = checkCensus({ ...inputs, sources: { ...sources, 'lib/fixture-ns.js': fixture } });
    assert.ok(problems.some((p) => /^lib\/fixture-ns\.js:\d+ streamChat\(\) is a model call with no CALL_PATHS entry/.test(p)), problems.join('\n'));
  });

  test('a computed string-key namespace member call in a file with no CALL_PATHS entry fails (LIN-3867)', () => {
    const fixture = "import * as o from './openrouter.js';\nexport const f = () => o['streamChat']([], { callMeta: { urlKey: 'u', feature: 'observer-pass' } }, () => {});\n";
    const problems = checkCensus({ ...inputs, sources: { ...sources, 'lib/fixture-ns-computed.js': fixture } });
    assert.ok(problems.some((p) => /^lib\/fixture-ns-computed\.js:\d+ streamChat\(\) is a model call with no CALL_PATHS entry/.test(p)), problems.join('\n'));
  });

  test('an aliased import of a wrapper called without its urlKey fails, naming the alias (LIN-3867)', () => {
    const fixture = "import { generateBrief as gb } from './brief.js';\nexport const f = () => gb({}, { callMeta: { feature: 'brief' } });\n";
    const problems = checkCensus({ ...inputs, sources: { ...sources, 'lib/fixture-wrapper-alias.js': fixture } });
    assert.ok(problems.some((p) => /^lib\/fixture-wrapper-alias\.js:\d+ gb\(\) is called without callMeta\.urlKey/.test(p)), problems.join('\n'));
  });

  // Built from a synthetic unit file, not the live text of a file that is free to move.
  const unitFixture = (callMeta) => `import { generateFeedbackTitle } from '../lib/feedback-title.js';\nexport const f = (w) => generateFeedbackTitle({ title: 't' }, { callMeta: ${callMeta} });\n`;
  const withoutUnit = Object.fromEntries(Object.entries(sources).filter(([p]) => !isWorkspaceApiUnitFile(p)));

  test('a feedback-title call in a unit file without its urlKey fails (the fifth invisible call)', () => {
    const problems = checkCensus({ ...inputs, sources: { ...withoutUnit, 'routes/workspace-api-x.js': unitFixture('{}') } });
    assert.ok(problems.some((p) => /^routes\/workspace-api-x\.js:\d+ generateFeedbackTitle\(\) is called without callMeta\.urlKey/.test(p)), problems.join('\n'));
  });

  test('the same call with its urlKey, in any unit file, raises no site problem (positive control)', () => {
    const problems = checkCensus({ ...inputs, sources: { ...withoutUnit, 'routes/workspace-api-x.js': unitFixture('{ urlKey: w.urlKey }') } });
    assert.ok(!problems.some((p) => p.includes('workspace-api-x.js')), problems.join('\n'));
  });

  test('the unit is counted as a whole: moving its files to other unit names stays clean, an extra model call fails', () => {
    const moved = { ...withoutUnit };
    for (const [p, src] of Object.entries(sources)) if (isWorkspaceApiUnitFile(p)) moved[p.replace(/\.js$/, '-moved.js')] = src;
    assert.deepEqual(checkCensus({ ...inputs, sources: moved }), []);
    const extra = { ...moved, 'routes/workspace-api-extra.js': "import { streamChat } from '../lib/openrouter.js';\nexport const g = () => streamChat([], { callMeta: { urlKey: 'u' } }, () => {});\n" };
    const problems = checkCensus({ ...inputs, sources: extra });
    assert.ok(problems.some((p) => p.includes(`${WORKSPACE_API_UNIT} has 8 model call(s)`)), problems.join('\n'));
  });

  test('a job with no group or an empty description fails', () => {
    const jobs = JOBS.map((j) => (j.id === 'plan' ? { ...j, group: 'nope' } : j.id === 'recap' ? { ...j, description: ' ' } : j));
    const problems = checkCensus({ ...inputs, jobs });
    assert.ok(problems.some((p) => p.includes('"plan"') && p.includes('group')), problems.join('\n'));
    assert.ok(problems.some((p) => p.includes('"recap"') && p.includes('description')), problems.join('\n'));
  });

  test('a registered Harbour-call job that nothing uses fails', () => {
    const problems = checkCensus({ ...inputs, jobs: [...JOBS, { id: 'fixture-unused', surface: SURFACES.HARBOUR_CALL, group: 'tell', description: 'Unused.' }] });
    assert.deepEqual(problems, ['harbour-call job "fixture-unused" is used by no feature/opKind label']);
  });

  // LIN-3870 hole 1: a literal callMeta must name a job (feature or opKind), not just a urlKey.
  test('a call whose callMeta has a urlKey but no feature or opKind fails, naming the site (LIN-3870)', () => {
    const edited = OBSERVER_SITE + "export const f = (o) => streamChat([], { callMeta: { urlKey: o.urlKey } }, () => {});\n";
    const problems = checkCensus({ ...inputs, sources: { ...sources, 'lib/observer-pass.js': edited } });
    const sites = problems.filter((p) => p.startsWith('lib/observer-pass.js:'));
    assert.equal(sites.length, 1, problems.join('\n'));
    assert.match(sites[0], /^lib\/observer-pass\.js:\d+ streamChat\(\) callMeta names no feature or opKind/);
  });

  // LIN-3870 hole 2: an unresolved callMeta in the workspace-API unit is excused only when its
  // options come from the named builder. The unit is rebuilt as one synthetic file of seven sites
  // and one builder, so the count stays at the real tree's 7 and only the site under test changes.
  // The three shapes the unit uses to reach the builder are the direct call, a bound identifier,
  // and a spread of a same-file function that returns the builder's call in its argument list.
  const UNIT_FIXTURE = 'routes/workspace-api-fixture.js';
  const unitSiteFixture = ({ fourth = "{ callMeta: { urlKey: w.urlKey, feature: 'roadmap-chat' } }", builderCallMeta = "urlKey: w.urlKey, feature: 'recommend'" } = {}) => [
    "import { streamChat, getRecommendation } from '../lib/openrouter.js';",
    `function recommendCallOptions(w) { return { apiKey: w.apiKey, callMeta: { ${builderCallMeta} } }; }`,
    "function modelCallArgs(w) { return [w.issue, 'input', recommendCallOptions(w)]; }",
    'export async function sites(w) {',
    '  await streamChat([], recommendCallOptions(w), () => {});',
    '  const bound = recommendCallOptions(w);',
    '  await streamChat([], bound, () => {});',
    '  await getRecommendation(...await modelCallArgs(w));',
    `  await streamChat([], ${fourth}, () => {});`,
    "  await streamChat([], { callMeta: { urlKey: w.urlKey, feature: 'roadmap-chat' } }, () => {});",
    "  await streamChat([], { callMeta: { urlKey: w.urlKey, feature: 'roadmap-chat' } }, () => {});",
    '}',
    '',
  ].join('\n');
  const unitProblems = (fixture) => checkCensus({ ...inputs, sources: { ...withoutUnit, [UNIT_FIXTURE]: fixture } })
    .filter((p) => p.startsWith(`${UNIT_FIXTURE}:`));

  test('the unit fixture with every site legitimately resolved raises no site problem (positive control)', () => {
    assert.deepEqual(unitProblems(unitSiteFixture()), []);
  });

  test('a unit call whose options are a non-literal expression no named builder produces fails, naming file:line (LIN-3870)', () => {
    const problems = unitProblems(unitSiteFixture({ fourth: "Object.assign({}, { urlKey: w.urlKey, feature: 'roadmap-chat' })" }));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /^routes\/workspace-api-fixture\.js:\d+ streamChat\(\) takes its options from/);
  });

  test('a builder whose callMeta names no feature or opKind fails, naming the builder (LIN-3870)', () => {
    const problems = unitProblems(unitSiteFixture({ builderCallMeta: 'urlKey: w.urlKey' }));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /^routes\/workspace-api-fixture\.js: builder recommendCallOptions\(\) does not put feature or opKind in its callMeta/);
  });
});
