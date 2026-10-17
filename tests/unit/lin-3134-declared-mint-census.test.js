/**
 * LIN-3138 (LIN-3134 T2-i) — F3 inertness + C4 secrecy censuses.
 *
 * F3: outside the five mechanism modules, the only files that pass a
 *     non-empty `declaredGrants` (or set `grantDeclaration`) are the three
 *     declared launch literals LIN-3136 (T3) adds: M1, M2 and M4.
 * C4: `grantDeclaration` / `grantRefusal` appear only inside the five mechanism
 *     modules (plus lib/proxy-tokens.js for the private `grantRefusal` FUNCTION
 *     name); none in any route file or projection body; `_formatItem` /
 *     `_formatHistoryItem` bodies contain no spread and neither token.
 *
 * The scanners are pure functions over `{file, src}`, so the mutation witnesses
 * plant an omission in a synthetic source string and assert the scan fails.
 *
 * LIN-3601: the dispatch entrances (E: routes/dispatch.js, routes/proxy-dispatch.js,
 * routes/proxy-kickoff.js, lib/dispatch-entrance.js) are judged as ONE unit, so a
 * call may sit in any of the four and the three routes can share one authority:
 *   - F3: E holds exactly 2 `declaredGrants: ['dispatch'],` literals (M1 + M2);
 *   - C2 (i)-(iii): a createDispatchItem call in E that carries followUpTo takes its
 *     gate from the two known predicate forms (`isFollowUp`, the `followUpTo`
 *     ternary), and fails if it has none;
 *   - C2 (v)/C3: an E mint site is keyed `E | arm | helper`, at least one each of
 *     follow-up/provisionResumeCredential, -/provisionResumeCredential (the refire
 *     broker) and launch/attachProxyContext; any other arm|helper in E fails;
 *   - the location-free shape checks on every E call stay (see entranceShape).
 * Which route reaches which mint, from which origin and with which grants, is
 * carried by dispatch-entrance-mint-sweep.test.js, which spies the real token
 * store boundary while every origin is driven over HTTP. Rows outside E (the lib
 * follow-up sites, the wake, the M4 feedback lane, collective, the internals) are
 * exactly as they were.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { attachProxyContext } from '../../lib/proxy-preamble.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

const MECHANISM_MODULES = new Set([
  'proxy-preamble', 'dispatch-factory', 'dispatch-store', 'wake-credential', 'dispatch-wake'
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const rel = (abs) => abs.slice(REPO.length + 1);
const base = (file) => file.split('/').pop().replace(/\.js$/, '');

function loadProductionSources() {
  return [
    ...walk(join(REPO, 'routes')),
    ...walk(join(REPO, 'lib')),
    join(REPO, 'server.js')
  ].map((abs) => ({ file: rel(abs), src: readFileSync(abs, 'utf8') }));
}

/** Files/lines outside the allow-list whose source contains any of `tokens`. */
function scanTokens(files, tokens, extraAllow = new Set()) {
  const offenders = [];
  for (const { file, src } of files) {
    if (MECHANISM_MODULES.has(base(file)) || extraAllow.has(base(file))) continue;
    src.split('\n').forEach((line, i) => {
      for (const token of tokens) {
        if (line.includes(token)) offenders.push({ file, line: i + 1, token, text: line.trim() });
      }
    });
  }
  return offenders;
}

const scanF3 = (files) => scanTokens(files, ['declaredGrants', 'grantDeclaration']);
const scanC4 = (files) => scanTokens(files, ['grantDeclaration', 'grantRefusal'], new Set(['proxy-tokens']));

function extractMethod(src, name) {
  const start = src.indexOf(`${name}(doc) {`);
  assert.ok(start > -1, `${name} found`);
  const end = src.indexOf('\n  }\n', start);
  assert.ok(end > -1, `${name} body end found`);
  return src.slice(start, end);
}

const PRODUCTION = loadProductionSources();

// LIN-3601: the four dispatch-entrance files, judged as one unit.
const E_FILES = new Set(['routes/dispatch.js', 'routes/proxy-dispatch.js', 'routes/proxy-kickoff.js', 'lib/dispatch-entrance.js']);
const inE = (file) => E_FILES.has(file);

/**
 * Applies a replacement at `needle` in whichever entrance file holds it (the
 * witnesses must not care which of the four that is). Fails loudly if no entrance
 * file contains the anchor, so a witness can never pass by planting nothing.
 */
function plantInE(files, needle, replacement) {
  let planted = false;
  const out = files.map((f) => {
    if (planted || !inE(f.file)) return f;
    const i = f.src.indexOf(needle);
    if (i < 0) return f;
    planted = true;
    return { file: f.file, src: f.src.slice(0, i) + replacement + f.src.slice(i + needle.length) };
  });
  assert.ok(planted, `mutation anchor not found in the dispatch entrances: ${needle}`);
  return out;
}

/** Appends `text` to one entrance file's source. */
function appendToE(files, file, text) {
  assert.ok(inE(file), `${file} is not an entrance file`);
  return files.map((f) => (f.file === file ? { file, src: `${f.src}\n${text}\n` } : f));
}

// ── F3 — the declared-mint writer set ────────────────────────────────────────
// LIN-3136 (T3) adds the first production writers: exactly the M1 (kickoff),
// M2 (session dispatch, incl. M2b) and M4 (feedback autopilot) launch literals.
// The three proxy-dispatch launch arms stay undeclared (M3, deferred to
// LIN-3099). The mutations below check against this allowed set, so a planted
// writer cannot pass just because the set is no longer empty.

// LIN-3601: M1 (kickoff) and M2 (session dispatch) are the two writers in E. The
// declared-writer allow-list is the one place E is counted exactly: E holds 2,
// wherever they sit. M4 (feedback autopilot) is outside E and stays exact.
const F3_WRITERS = [
  { site: 'M1+M2', unit: 'E', count: 2, text: "declaredGrants: ['dispatch']," },
  { site: 'M4', file: 'routes/workspace-api.js', text: "declaredGrants: ['dispatch']," }
];

/** F3 against the allowed writer set: each listed writer exactly as often as listed, nothing unlisted. */
function checkF3(files, allowed = F3_WRITERS) {
  const v = [];
  const hits = scanF3(files);
  const belongs = (w, h) => h.text === w.text && (w.unit === 'E' ? inE(h.file) : w.file === h.file);
  for (const w of allowed) {
    const found = hits.filter(h => belongs(w, h)).length;
    const expected = w.count ?? 1;
    if (found !== expected) v.push(`${w.site} (${w.unit === 'E' ? 'the dispatch entrances' : w.file}): expected exactly ${expected === 1 ? 'one writer' : `${expected} writers`}, found ${found}`);
  }
  for (const h of hits) {
    if (!allowed.some(w => belongs(w, h))) v.push(`unlisted writer: ${h.file}:${h.line} ${h.text}`);
  }
  return v;
}

describe('F3 — the declared-mint writer set is exactly M1+M2 (in E) and M4', () => {
  test('the production writers are exactly the declared launch literals (E holds exactly 2, whichever file)', () => {
    assert.deepEqual(F3_WRITERS.map(w => w.site), ['M1+M2', 'M4']);
    assert.deepEqual(checkF3(PRODUCTION), []);
  });

  test('mutation 4 (F3 half): a planted declaredGrants literal in a route fails F3', () => {
    const mutated = [...PRODUCTION, { file: 'routes/proxy-dispatch.js', src: "const x = { declaredGrants: ['dispatch'] };" }];
    assert.ok(checkF3(mutated).some(m => m.startsWith('unlisted writer: routes/proxy-dispatch.js')));
  });

  test('mutation 4 (F3 half): a planted grantDeclaration writer in a route fails F3', () => {
    const mutated = [...PRODUCTION, { file: 'routes/dispatch.js', src: 'item.grantDeclaration = record;' }];
    assert.ok(checkF3(mutated).some(m => m.startsWith('unlisted writer: routes/dispatch.js')));
  });

  test('mutation: a fourth declaring site (a leaf lane) fails F3', () => {
    const mutated = [...PRODUCTION, { file: 'routes/collective.js', src: "          declaredGrants: ['dispatch'],\n" }];
    assert.ok(checkF3(mutated).some(m => m.startsWith('unlisted writer: routes/collective.js')));
  });

  test('mutation: a second literal at a listed site fails F3', () => {
    const mutated = PRODUCTION.map(f => (f.file === 'routes/workspace-api.js'
      ? { ...f, src: `${f.src}\n          declaredGrants: ['dispatch'],\n` } : f));
    assert.ok(checkF3(mutated).some(m => m.startsWith('M4 (routes/workspace-api.js): expected exactly one writer, found 2')));
  });

  test('mutation: a listed writer removed from E fails F3 (the set never shrinks silently)', () => {
    const one = plantInE(PRODUCTION, "declaredGrants: ['dispatch'],", '');
    assert.ok(checkF3(one).some(m => m.startsWith('M1+M2 (the dispatch entrances): expected exactly 2 writers, found 1')), checkF3(one).join('\n'));
    const none = plantInE(one, "declaredGrants: ['dispatch'],", '');
    assert.ok(checkF3(none).some(m => m.startsWith('M1+M2 (the dispatch entrances): expected exactly 2 writers, found 0')), checkF3(none).join('\n'));
  });

  test('mutation (re-targeted, LIN-3601): a third literal anywhere in E fails F3, including in lib/dispatch-entrance.js', () => {
    for (const file of E_FILES) {
      const mutated = appendToE(PRODUCTION, file, "          declaredGrants: ['dispatch'],");
      assert.ok(checkF3(mutated).some(m => m.startsWith('M1+M2 (the dispatch entrances): expected exactly 2 writers, found 3')), file);
    }
  });

  test('moving a writer literal between the entrance files keeps F3 clean (E is one unit)', () => {
    const removed = plantInE(PRODUCTION, "declaredGrants: ['dispatch'],", '');
    const moved = appendToE(removed, 'lib/dispatch-entrance.js', "export const m = {\ndeclaredGrants: ['dispatch'],\n};");
    // the hit's text is the trimmed line, which must equal the listed literal exactly
    assert.deepEqual(checkF3(moved).filter(m => m.startsWith('M1+M2')), []);
  });
});

// ── C4 secrecy token census ──────────────────────────────────────────────────

describe('C4 — declared-mint tokens are confined to the mechanism modules', () => {
  test('grantDeclaration / grantRefusal appear only in the five modules (+ proxy-tokens fn)', () => {
    assert.deepEqual(scanC4(PRODUCTION), []);
  });

  test('mutation 6 (C4 half): a planted grantDeclaration in a 201 body fails C4', () => {
    const mutated = [...PRODUCTION, { file: 'routes/proxy-dispatch.js', src: 'res.status(201).json({ grantDeclaration: item.grantDeclaration });' }];
    assert.notDeepEqual(scanC4(mutated), []);
  });

  test('mutation 6 (C4 half): a planted grantRefusal in a route fails C4', () => {
    const mutated = [...PRODUCTION, { file: 'routes/dispatch.js', src: "jsonError(res, 400, 'x', { grantRefusal: 'Y' });" }];
    assert.notDeepEqual(scanC4(mutated), []);
  });

  // Throws on the first violated invariant; the real test and its mutation witness
  // both go through it, so deleting an assertion here turns the witness red.
  const checkFormatterBody = (name, body) => {
    assert.ok(!/\.\.\./.test(body), `${name} must contain no spread`);
    assert.ok(!body.includes('grantRefusal'), `${name} must not mention grantRefusal`);
    // LIN-3384: the one permitted mention of grantDeclaration is the sparse
    // boolean marker — the record itself never rides a projection.
    const code = body.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.equal((code.match(/grantDeclaration/g) || []).length, 1, `${name}: exactly one grantDeclaration mention`);
    assert.equal(
      (code.match(/if \(doc\.grantDeclaration != null\) item\.declaredMint = true;/g) || []).length, 1,
      `${name}: the one mention is the declaredMint marker assignment`
    );
    assert.equal((code.match(/declaredMint/g) || []).length, 1, `${name}: exactly one declaredMint assignment`);
  };

  test('_formatItem / _formatHistoryItem bodies contain no spread, no grantRefusal, and exactly one declaredMint assignment', () => {
    const storeSrc = readFileSync(join(REPO, 'lib', 'dispatch-store.js'), 'utf8');
    for (const name of ['_formatItem', '_formatHistoryItem']) {
      checkFormatterBody(name, extractMethod(storeSrc, name));
    }
  });

  test('mutation: a second grantDeclaration use in a formatter body is caught', () => {
    const storeSrc = readFileSync(join(REPO, 'lib', 'dispatch-store.js'), 'utf8');
    for (const name of ['_formatItem', '_formatHistoryItem']) {
      const mutated = extractMethod(storeSrc, name) + '\n    item.x = doc.grantDeclaration;';
      assert.throws(() => checkFormatterBody(name, mutated), /exactly one grantDeclaration mention/);
    }
  });
});

// ── Inertness: stock attach has no grantDeclaration key ──────────────────────

describe('Inertness — a stock attachProxyContext call carries no declared record', () => {
  test('empty declaredGrants -> no grantDeclaration key', async () => {
    const result = await attachProxyContext({
      proxyTokenStore: { createToken: async () => ({ token: 'plain' }) },
      urlKey: 'acme', baseUrl: 'https://h', prompt: 'do', harness: 'opencode', createdBy: 'u1'
    });
    assert.equal('grantDeclaration' in result, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LIN-3139 (T2-ii) — C2 (i)–(v) and C3: the follow-up call-site census.
//
// A balanced-brace scan over production sources. Comments and string/template
// text are masked to spaces first (offsets kept), so a mention in prose never
// counts. Sites are keyed by {file, enclosing construct, kind, arm, fn} —
// never a line number.
// ═════════════════════════════════════════════════════════════════════════════

function maskSource(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const stack = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (stack.at(-1) === 'tpl') {
      if (c === '\\') { blank(i, i + 2); i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && d === '{') { stack.push('expr'); i += 2; continue; }
      blank(i, i + 1); i++; continue;
    }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      blank(i + 1, j); i = j + 1; continue;
    }
    if (c === '`') { stack.push('tpl'); i++; continue; }
    if (stack.length && c === '{') { stack.push('brace'); i++; continue; }
    if (stack.length && c === '}') { stack.pop(); i++; continue; }
    i++;
  }
  return out.join('');
}

/** Index of the bracket closing the one at `open` in masked source, or -1. */
function matchClose(masked, open) {
  const o = masked[open];
  const close = { '(': ')', '{': '}', '[': ']' }[o];
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    if (masked[k] === o) depth++;
    else if (masked[k] === close && --depth === 0) return k;
  }
  return -1;
}

const isDefinition = (masked, idx) => /function\s+$/.test(masked.slice(Math.max(0, idx - 30), idx));

/** The nearest enclosing route registration, named function or chat tool. */
function enclosingConstruct(src, idx) {
  const pre = src.slice(0, idx);
  let best = null;
  const consider = (i, name) => { if (!best || i > best.i) best = { i, name }; };
  for (const m of pre.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g)) consider(m.index, `${m[1].toUpperCase()} ${m[3]}`);
  for (const m of pre.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)) consider(m.index, `function ${m[1]}`);
  for (const m of pre.matchAll(/\n {4}([a-z_]+): async \(/g)) consider(m.index, `tool ${m[1]}`);
  return best ? best.name : '(top level)';
}

/** A depth-1 property of the object literal spanning [objOpen, objClose]. */
function topLevelProp(masked, src, objOpen, objClose, name) {
  let depth = 0;
  for (let k = objOpen; k <= objClose; k++) {
    const c = masked[k];
    if ('({['.includes(c)) { depth++; continue; }
    if (')}]'.includes(c)) { depth--; continue; }
    if (depth !== 1 || !masked.startsWith(name, k)) continue;
    if (/[\w$.]/.test(masked[k - 1]) || /[\w$]/.test(masked[k + name.length] || '')) continue;
    let j = k + name.length;
    while (/\s/.test(masked[j])) j++;
    if (masked[j] === ',' || masked[j] === '}') return { start: k, valueStart: -1, text: name };
    if (masked[j] !== ':') continue;
    let v = j + 1;
    while (/\s/.test(masked[v])) v++;
    let e = v;
    let d = 0;
    for (; e <= objClose; e++) {
      const c2 = masked[e];
      if ('({['.includes(c2)) d++;
      else if (')}]'.includes(c2)) { if (d === 0) break; d--; } else if (c2 === ',' && d === 0) break;
    }
    return { start: k, valueStart: v, valueEnd: e, text: src.slice(k, e).replace(/\s+/g, ' ').trim() };
  }
  return null;
}

/** C2 (i)/(ii): every `createDispatchItem({` call (the definition excluded). */
function scanDispatchCalls(files) {
  const calls = [];
  for (const { file, src } of files) {
    const masked = maskSource(src);
    const re = /\bcreateDispatchItem\(\{/g;
    let m;
    while ((m = re.exec(masked))) {
      if (isDefinition(masked, m.index)) continue;
      const open = m.index + 'createDispatchItem'.length;
      const close = matchClose(masked, open);
      const objClose = matchClose(masked, open + 1);
      const kind = topLevelProp(masked, src, open + 1, objClose, 'kind');
      const fields = topLevelProp(masked, src, open + 1, objClose, 'fields');
      let fieldsInline = false;
      let fieldsSpread = false;
      if (fields && fields.valueStart > -1 && masked[fields.valueStart] === '{') {
        fieldsInline = true;
        const body = masked.slice(fields.valueStart, matchClose(masked, fields.valueStart) + 1);
        fieldsSpread = body.includes('...');
      }
      calls.push({
        file, src, masked, start: open, end: close,
        construct: enclosingConstruct(src, m.index),
        kind: kind ? kind.text : '(none)',
        carriesFollowUpTo: /\bfollowUpTo\b/.test(masked.slice(open, close)),
        fieldsInline, fieldsSpread
      });
    }
  }
  return calls;
}

const callKey = (c) => `${c.file} | ${c.construct} | ${c.kind}`;

// The follow-up-carrying calls (Class F) OUTSIDE E. `predicate` is null where the
// call is a follow-up by construction (no launch arm). LIN-3601: the four
// follow-up-carrying calls in E (3 x routes/proxy-dispatch.js, 1 x routes/dispatch.js)
// are no longer rows: an E call that carries followUpTo is recognised by that fact
// and takes its gate from E_GATE_PREDICATES, wherever the call sits.
const FOLLOWUP_SITES = [
  { name: 'follow-up-dispatch dispatchSessionFollowUp', key: 'lib/follow-up-dispatch.js | function dispatchSessionFollowUp | (none)', predicate: null, hasAttachArm: false },
  { name: 'chat-tools send_follow_up', key: 'lib/chat-tools.js | tool send_follow_up | (none)', predicate: null, hasAttachArm: false }
];

// The calls outside E with no follow-up (launch or leaf only).
const NON_FOLLOWUP_CALLS = [
  "routes/collective.js | POST /workspace/:urlKey/collective/start | kind: 'custom'",
  "routes/workspace-api.js | function enqueueFeedbackTriage | kind: 'triage'",
  "routes/workspace-api.js | function enqueueFeedbackAutopilot | kind: 'autopilot'"
];

// The two follow-up gate forms an E call may use: `if (isFollowUp) {` (the proxy
// routes) and the `...(followUpTo ? {` ternary (the session route).
const E_GATE_PREDICATES = ['isFollowUp', 'followUpTo'];

function indicesOf(masked, token, from, to) {
  const out = [];
  let i = masked.indexOf(token, from);
  while (i > -1 && i < to) { out.push(i); i = masked.indexOf(token, i + 1); }
  return out;
}

/** The follow-up gate block {open, close} in a call, containing the first helper call. */
function findGate(call, predicate, helperIdx) {
  const text = call.masked.slice(call.start, call.end);
  const re = new RegExp(`if\\s*\\(\\s*${predicate}\\s*\\)\\s*\\{|\\(\\s*${predicate}\\s*\\?\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(text))) {
    const open = call.start + m.index + m[0].length - 1;
    const close = matchClose(call.masked, open);
    if (helperIdx > open && helperIdx < close) return { open, close };
  }
  return null;
}

/** The follow-up gate of an E call under either known predicate form, or null. */
function findEntranceGate(call) {
  const helper = indicesOf(call.masked, 'provisionResumeCredential(', call.start, call.end)[0] ?? -1;
  if (helper < 0) return null;
  for (const predicate of E_GATE_PREDICATES) {
    const gate = findGate(call, predicate, helper);
    if (gate) return { predicate, gate };
  }
  return null;
}

/** C2 (iii) a–e for one follow-up call; returns the violations. */
function checkFollowUpCall(call, site) {
  const v = [];
  const { masked, start, end } = call;
  const helpers = indicesOf(masked, 'provisionResumeCredential(', start, end);
  const attaches = indicesOf(masked, 'attachProxyContext(', start, end);
  if (helpers.length === 0) v.push('(iii a) no provisionResumeCredential( call');
  if (indicesOf(masked, 'provisionBootstrapToken(', start, end).length > 0) v.push('(iii b) a direct provisionBootstrapToken( call');
  let gateEnd = start;
  if (site.predicate) {
    const gate = helpers.length ? findGate(call, site.predicate, helpers[0]) : null;
    if (!gate) v.push(`(iii c) the first provisionResumeCredential( is not under the \`${site.predicate}\` gate`);
    else gateEnd = gate.close;
    for (const a of attaches) if (!gate || a < gateEnd) v.push('(iii c) a direct attachProxyContext( before the end of the gated statement');
  } else if (attaches.length > 0) {
    v.push('(iii c) a direct attachProxyContext( in a call with no launch arm');
  }
  for (const token of ['declaredGrants', 'grantOwnerAccountId']) {
    for (const i of indicesOf(masked, token, start, end)) if (!site.predicate || i < gateEnd) v.push(`(iii d) ${token} before the gate`);
  }
  if (site.hasAttachArm && helpers.length) {
    const open = helpers[0] + 'provisionResumeCredential'.length;
    const args = masked.slice(open, matchClose(masked, open) + 1);
    if (!/\battach\s*:/.test(args)) v.push('(iii e) the helper call passes no attach:');
  }
  return v;
}

/** C2 (i)–(iii) over a file set: the violations, empty when clean. */
function censusC2(files) {
  const v = [];
  const calls = scanDispatchCalls(files);
  const siteByKey = new Map(FOLLOWUP_SITES.map(s => [s.key, s]));
  const seen = new Set();
  let entranceCalls = 0;
  let entranceFollowUps = 0;
  for (const call of calls) {
    const key = callKey(call);
    // The location-free shape checks, on every call (E or not).
    if (!call.fieldsInline) v.push(`(ii) ${key}: fields is not an inline object`);
    if (call.fieldsSpread) v.push(`(ii) ${key}: spread in fields`);
    if (inE(call.file)) {
      entranceCalls++;
      if (!call.carriesFollowUpTo) continue;
      entranceFollowUps++;
      const found = findEntranceGate(call);
      if (!found) {
        v.push(`(iii c) ${call.file}: a createDispatchItem call carries followUpTo but its first provisionResumeCredential( is under no follow-up gate (neither the \`isFollowUp\` nor the \`followUpTo ?\` form)`);
        continue;
      }
      for (const msg of checkFollowUpCall(call, { predicate: found.predicate, hasAttachArm: true })) v.push(`dispatch entrance: ${msg}`);
      continue;
    }
    if (!call.carriesFollowUpTo) {
      if (!NON_FOLLOWUP_CALLS.includes(key)) v.push(`(i) unlisted createDispatchItem call: ${key}`);
      continue;
    }
    const site = siteByKey.get(key);
    if (!site) { v.push(`(i) unlisted follow-up createDispatchItem call: ${key}`); continue; }
    seen.add(key);
    for (const msg of checkFollowUpCall(call, site)) v.push(`${site.name}: ${msg}`);
  }
  if (entranceCalls < 1) v.push('(i) no createDispatchItem call left in the dispatch entrances');
  if (entranceFollowUps < 1) v.push('(i) no follow-up-carrying createDispatchItem call left in the dispatch entrances');
  for (const s of FOLLOWUP_SITES) if (!seen.has(s.key)) v.push(`(i) stale follow-up site (not found): ${s.key}`);
  for (const k of NON_FOLLOWUP_CALLS) if (!calls.some(c => callKey(c) === k && !c.carriesFollowUpTo)) v.push(`(i) stale non-follow-up call (not found): ${k}`);
  return v;
}

// ── C2 (v) / C3: every credential mint call site, classified ─────────────────

const MINT_FNS = ['attachProxyContext', 'provisionBootstrapToken', 'provisionResumeCredential'];

function scanMintSites(files) {
  const calls = scanDispatchCalls(files);
  const siteByKey = new Map(FOLLOWUP_SITES.map(s => [s.key, s]));
  const counts = new Map();
  for (const { file, src } of files) {
    const masked = maskSource(src);
    for (const fn of MINT_FNS) {
      for (const idx of indicesOf(masked, `${fn}(`, 0, masked.length)) {
        if (/[\w$.]/.test(masked[idx - 1]) || isDefinition(masked, idx)) continue;
        const call = calls.find(c => c.file === file && idx > c.start && idx < c.end);
        let construct;
        let arm;
        if (inE(file)) {
          // LIN-3601: an E site is keyed `E | arm | helper`, never by file, construct
          // or kind. A call that carries followUpTo is a follow-up arm only INSIDE its
          // gate (either known predicate form); a helper in no createDispatchItem
          // call is `-` (the refire broker); everything else is a launch arm.
          if (!call) arm = '-';
          else if (!call.carriesFollowUpTo) arm = 'launch';
          else {
            const found = findEntranceGate(call);
            arm = found && idx > found.gate.open && idx < found.gate.close ? 'follow-up' : 'launch';
          }
          const entranceKey = `E | ${arm} | ${fn}`;
          counts.set(entranceKey, (counts.get(entranceKey) || 0) + 1);
          continue;
        }
        if (!call) {
          construct = enclosingConstruct(src, idx);
          arm = '-';
        } else {
          construct = `${call.construct} [${call.kind}]`;
          const site = siteByKey.get(callKey(call));
          if (!call.carriesFollowUpTo || !site) arm = 'launch';
          else if (!site.predicate) arm = 'follow-up';
          else {
            const firstHelper = indicesOf(call.masked, 'provisionResumeCredential(', call.start, call.end)[0] ?? -1;
            const gate = findGate(call, site.predicate, firstHelper);
            arm = gate && idx > gate.open && idx < gate.close ? 'follow-up' : 'launch';
          }
        }
        const key = `${file} | ${construct} | ${arm} | ${fn}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return counts;
}

// C2 (v): {file, construct [kind], arm, fn} -> class, with a reason.
//
// LIN-3601: the dispatch entrances are keyed `E | arm | helper` and counted as "at
// least one": file, construct and kind are dropped, so the follow-up gate, the three
// launch arms and the broker may sit in any of the four entrance files. The
// M1/M2/M3 split inside `launch` is not a source distinction any more; it is the
// per-origin table in dispatch-entrance-mint-sweep.test.js (World N: kickoff and
// session-autopilot declare, the proxy-dispatch arms mint grant-less; World R:
// follow-ups and the broker echo the record). Any other arm | helper in E (for
// example `launch | provisionResumeCredential`, `launch | provisionBootstrapToken`
// or `follow-up | attachProxyContext`) is an unlisted mint site and fails.
const E_MINT_ROWS = [
  { key: 'E | follow-up | provisionResumeCredential', min: 1, cls: 'followup-helper', modes: ['attach', 'pbt'], reason: 'the follow-up gate of POST /dispatch, the override arm, the LLM arm and the session route' },
  { key: 'E | - | provisionResumeCredential', min: 1, cls: 'refire-helper', reason: 'declared refire re-mint, R2 (LIN-3135)' },
  { key: 'E | launch | attachProxyContext', min: 1, cls: 'launch', reason: 'the launch attach, after the gate: declared M1 (kickoff) and M2/M2b (session), undeclared M3 (the three proxy-dispatch arms, deferred to LIN-3099)' }
];

// The four attach branches are classed under the follow-up class (`followup-helper`,
// modes attach+pbt), never as launch-M2/M3: a launch entry is valid only after the
// gate, so one line cannot be both.
const MINT_SITE_TABLE = [
  ...E_MINT_ROWS,
  { key: 'lib/follow-up-dispatch.js | function dispatchSessionFollowUp [(none)] | follow-up | provisionResumeCredential', count: 1, cls: 'followup-helper', modes: ['pbt'], reason: 'dispatchSessionFollowUp: a follow-up by construction (approve-follow-up + Apply)' },
  { key: 'lib/chat-tools.js | tool send_follow_up [(none)] | follow-up | provisionResumeCredential', count: 1, cls: 'followup-helper', modes: ['pbt'], reason: 'send_follow_up: a follow-up by construction' },
  { key: 'lib/wake-credential.js | function buildWakeCredentialProvisioner | - | provisionResumeCredential', count: 1, cls: 'wake-helper', reason: 'the wake (Class F eleventh member)' },
  { key: "routes/workspace-api.js | function enqueueFeedbackAutopilot [kind: 'autopilot'] | launch | attachProxyContext", count: 1, cls: 'launch-M4', reason: 'feedback autopilot launch: declared M4 (LIN-3136)' },
  { key: "routes/collective.js | POST /workspace/:urlKey/collective/start [kind: 'custom'] | launch | attachProxyContext", count: 1, cls: 'leaf', reason: 'collective participant: never holds dispatch' },
  { key: "routes/collective.js | POST /workspace/:urlKey/collective/start [kind: 'custom'] | launch | provisionBootstrapToken", count: 1, cls: 'leaf', reason: 'collective participant prose branch' },
  { key: "routes/workspace-api.js | function enqueueFeedbackTriage [kind: 'triage'] | launch | attachProxyContext", count: 1, cls: 'leaf', reason: 'feedback triage worker: never holds dispatch' },
  { key: 'lib/proxy-preamble.js | function attachProxyContext | - | provisionBootstrapToken', count: 1, cls: 'internal', reason: 'attach delegates its mint' },
  { key: 'lib/proxy-preamble.js | function provisionResumeCredential | - | attachProxyContext', count: 2, cls: 'internal', reason: 'the helper\'s attach mode (no record / record)' },
  { key: 'lib/proxy-preamble.js | function provisionResumeCredential | - | provisionBootstrapToken', count: 2, cls: 'internal', reason: 'the helper\'s pbt mode (no record / record)' }
];

/** C2 (v): unlisted and stale entries against the table; empty when clean. */
function censusClassification(files, table = MINT_SITE_TABLE) {
  const v = [];
  const found = scanMintSites(files);
  const byKey = new Map(table.map(e => [e.key, e]));
  for (const [key, count] of found) {
    const entry = byKey.get(key);
    if (!entry) v.push(`unlisted mint site: ${key} (x${count})`);
    // LIN-3601: an E row is "at least min", not an exact count.
    else if (entry.min !== undefined) { if (count < entry.min) v.push(`count drift: ${key} expected at least x${entry.min}, found x${count}`); }
    else if (entry.count !== count) v.push(`count drift: ${key} expected x${entry.count}, found x${count}`);
  }
  for (const e of table) if (!found.has(e.key)) v.push(`stale table entry: ${e.key}`);
  return v;
}

/** C3: the class-set view of the (v) table (one implementation). */
function classSet(table = MINT_SITE_TABLE.filter(e => e.min === undefined)) {
  const out = {};
  for (const e of table) {
    out[e.cls] = out[e.cls] || { calls: 0, branches: 0 };
    out[e.cls].calls += e.count;
    out[e.cls].branches += e.modes ? e.modes.length : e.count;
  }
  return out;
}

/** Applies `(src) => src'` to one production file; fails loudly if it no-ops. */
function plant(files, file, transform) {
  return files.map((f) => {
    if (f.file !== file) return f;
    const src = transform(f.src);
    assert.notEqual(src, f.src, `mutation must change ${file}`);
    return { file, src };
  });
}
const replaceOnce = (needle, replacement) => (src) => {
  const i = src.indexOf(needle);
  assert.ok(i > -1, `mutation anchor not found: ${needle}`);
  return src.slice(0, i) + replacement + src.slice(i + needle.length);
};

/**
 * LIN-3611 (A1): plant by POSITION, not by text. The follow-up gate of the first
 * entrance call that carries followUpTo is found with the file's own scanner
 * (scanDispatchCalls + findEntranceGate), so a witness survives any re-nesting or
 * re-spelling of the entrance code. `transform(src, header)` gets the file's source and the
 * span of the gate header (`if (<predicate>) {`, up to and including its brace) and
 * returns the mutated source. Fails loudly if no gated entrance call exists.
 */
function plantAtEntranceGate(files, transform) {
  for (const call of scanDispatchCalls(files)) {
    if (!inE(call.file) || !call.carriesFollowUpTo) continue;
    const found = findEntranceGate(call);
    if (!found) continue;
    const braceAt = found.gate.open;
    const head = call.masked.slice(call.start, braceAt + 1);
    const m = new RegExp(`if\\s*\\(\\s*${found.predicate}\\s*\\)\\s*\\{$`).exec(head);
    assert.ok(m, `${call.file}: the gate is an if (${found.predicate}) { block`);
    const header = { start: call.start + m.index, end: braceAt + 1 };
    return files.map((f) => (f.file === call.file ? { file: f.file, src: transform(f.src, header) } : f));
  }
  assert.fail('no gated follow-up createDispatchItem call in the dispatch entrances to plant at');
}

/** The gate header replaced by `if (prompt) {`: the helper is then under a non-follow-up predicate. */
const gateReplaced = (files) => plantAtEntranceGate(files, (src, h) => src.slice(0, h.start) + 'if (prompt) {' + src.slice(h.end));
/** A declaredGrants literal planted on the line before the gate. */
const literalBeforeGate = (files) => plantAtEntranceGate(files, (src, h) => src.slice(0, h.start) + "const launchGrant = { declaredGrants: ['dispatch'] };\n" + src.slice(h.start));
/** The same sources, every line of the entrance authority shifted one level deeper. */
const reindented = (files) => files.map((f) => (f.file === 'lib/dispatch-entrance.js' ? { file: f.file, src: f.src.replace(/\n(?=.)/g, '\n  ') } : f));

describe('C2 (i)/(ii) — createDispatchItem calls: follow-up set, inline fields, no spread', () => {
  test('10 calls: 5 outside E exactly (4 listed non-follow-up/follow-up rows), at least 1 in E; the follow-up-carrying ones are the 2 lib sites plus at least 1 in E; every fields is inline, spread-free', () => {
    const calls = scanDispatchCalls(PRODUCTION);
    const outside = calls.filter(c => !inE(c.file));
    assert.equal(outside.length, 5);
    assert.ok(calls.length - outside.length >= 1, 'at least one createDispatchItem call in the dispatch entrances');
    assert.deepEqual(outside.filter(c => c.carriesFollowUpTo).map(callKey).sort(), FOLLOWUP_SITES.map(s => s.key).sort());
    assert.ok(calls.some(c => inE(c.file) && c.carriesFollowUpTo), 'at least one follow-up-carrying call in the dispatch entrances');
    assert.ok(calls.every(c => c.fieldsInline && !c.fieldsSpread), 'every call, in E or not: fields is an inline, spread-free object');
    assert.deepEqual(censusC2(PRODUCTION), []);
  });

  test('mutation 5: a new unlisted follow-up createDispatchItem fails (i)', () => {
    const mutated = [...PRODUCTION, { file: 'routes/new-resume.js', src: "router.post('/api/new-resume', async (req, res) => {\n  await createDispatchItem({ store, finalizePrompt: async () => ({ prompt }), fields: { followUpTo: req.body.followUpTo } });\n});" }];
    assert.ok(censusC2(mutated).some(m => m.startsWith('(i) unlisted follow-up createDispatchItem call')));
  });

  test('mutation 6 (ii half): a spread planted in fields fails (ii)', () => {
    const mutated = plant(PRODUCTION, 'lib/chat-tools.js', replaceOnce('          fields: {\n            followUpTo,', '          fields: {\n            ...extraFields,\n            followUpTo,'));
    assert.ok(censusC2(mutated).some(m => m.includes('spread in fields')));
  });

  // LIN-3601: the same two shape checks on a call in the entrances, wherever it sits.
  test('mutation 6 (ii half, re-targeted): a spread or non-inline fields planted in a createDispatchItem call in ANY entrance file fails (ii)', () => {
    for (const file of E_FILES) {
      const spread = appendToE(PRODUCTION, file, "export const planted = (store) => createDispatchItem({ store, fields: { ...rest, followUpTo: null } });");
      assert.ok(censusC2(spread).some(m => m.includes('spread in fields')), file);
      const notInline = appendToE(PRODUCTION, file, 'export const planted2 = (store, fields) => createDispatchItem({ store, fields });');
      assert.ok(censusC2(notInline).some(m => m.includes('fields is not an inline object')), file);
    }
  });
});

describe('C2 (iii) — branch-aware: helper under the gate, no direct mint on a follow-up arm', () => {
  test('every follow-up call is clean (a–e): the 2 lib sites by key, every entrance call by its own gate', () => {
    const calls = scanDispatchCalls(PRODUCTION);
    for (const site of FOLLOWUP_SITES) {
      const call = calls.find(c => callKey(c) === site.key);
      assert.ok(call, `${site.name} found`);
      assert.deepEqual(checkFollowUpCall(call, site), [], site.name);
    }
    // The entrance calls that carry followUpTo (3 x routes/proxy-dispatch.js and 1 x
    // routes/dispatch.js today): each takes its gate from the two known predicate
    // forms, wherever it sits, and is clean under (a)-(e).
    const entrance = calls.filter(c => inE(c.file) && c.carriesFollowUpTo);
    assert.ok(entrance.length >= 1);
    for (const call of entrance) {
      const found = findEntranceGate(call);
      assert.ok(found, `${call.file}: a follow-up-carrying call has a gate`);
      assert.deepEqual(checkFollowUpCall(call, { predicate: found.predicate, hasAttachArm: true }), [], `${call.file} ${found.predicate}`);
    }
  });

  // LIN-3601, re-pointed: `mutation 1: the helper moved out from under the gate
  // predicate`. A launch with `followUpTo: null` now reaches the helper, which then
  // finds no record and makes the same call a plain launch makes, so no behaviour row
  // of the mint sweep can see this mutation (shown green there, PR evidence). Its
  // catch is this scanner: an entrance call that carries followUpTo and whose first
  // helper is under neither gate form fails, here and in the C2 (v) classification
  // below (the helper becomes `E | launch | provisionResumeCredential`).
  test('mutation 1 (position-planted, LIN-3611 A1): the gate rewritten to `if (prompt) {` fails (iii c), also after the authority is re-indented', () => {
    for (const files of [PRODUCTION, reindented(PRODUCTION)]) {
      const mutated = gateReplaced(files);
      assert.ok(censusC2(mutated).some(m => m.includes('under no follow-up gate')), censusC2(mutated).join('\n'));
    }
  });

  // LIN-3601: four mutation tests formerly here planted into routes/proxy-dispatch.js,
  // routes/dispatch.js text and asserted the positional scan failed. Their properties
  // are carried by behaviour: dispatch-entrance-mint-sweep.test.js (World R, one test
  // per follow-up arm in attach and pbt mode: a declaration record must be echoed by a
  // mintGrantBootstrap and never by a plain createToken) and, as the plan names,
  // lin-3134-followup-sites.test.js (the ten-branch matrix). Each mutation was shown
  // failing both in a scratch copy first (PR evidence); none of the four can survive a
  // move of the entrance code, because each anchors on its text.
  //   mutation 1 (first form): the pre-change attach branch as finalizePrompt's first statement
  //   mutation 2: a direct attachProxyContext( inside the gate arm
  //   mutation 3: attach: dropped from the helper call at an attach-arm site
  //   mutation 4 (iii d half): a declaredGrants literal before the gate
  //     (behaviour-inert: an unused binding. Its catch is the F3 census over E above,
  //     which reports it as an `unlisted writer` — the F3 test with the planted literal.)
  // mutation 5 below (a direct provisionBootstrapToken( in lib/chat-tools.js) plants
  // outside E and stays exactly as it was.

  test('mutation 4 (position-planted, LIN-3611 A1): a declaredGrants literal before the gate is caught by F3 as an unlisted writer, also after re-indenting', () => {
    for (const files of [PRODUCTION, reindented(PRODUCTION)]) {
      const mutated = literalBeforeGate(files);
      assert.ok(checkF3(mutated).some(m => m.startsWith('unlisted writer:')), checkF3(mutated).join('\n'));
    }
  });

  test('mutation 5: a direct provisionBootstrapToken( in a follow-up call fails (iii a/b)', () => {
    const mutated = plant(PRODUCTION, 'lib/chat-tools.js', replaceOnce('finalizePrompt: (resolvedHarness) => provisionResumeCredential({', 'finalizePrompt: (resolvedHarness) => provisionBootstrapToken({'));
    const v = censusC2(mutated);
    assert.ok(v.some(m => m.includes('(iii b) a direct provisionBootstrapToken( call')));
    assert.ok(v.some(m => m.includes('(iii a) no provisionResumeCredential( call')));
  });
});

describe('C2 (iv) — the wake routes through the helper', () => {
  // LIN-3601: this test also asserted that routes/dispatch.js still builds the wake
  // provisioner. That is the dispatch entrance's; the property (a declared wake mints
  // through the helper, from the recorded authority) is carried by
  // lin-3134-wake-declared.test.js, which drives createDispatchRoutes' feedback route
  // and fails when the provisioner argument is removed from addFeedback's call (shown
  // in a scratch copy, PR evidence). routes/proxy-runner.js (not E) is still checked.
  test('wake-credential calls the helper; addFeedback passes the record; both builders remain', () => {
    const src = (file) => PRODUCTION.find(f => f.file === file).src;
    assert.ok(maskSource(src('lib/wake-credential.js')).includes('provisionResumeCredential('), 'wake-credential mints through the helper');
    const store = maskSource(src('lib/dispatch-store.js'));
    const start = store.indexOf('async addFeedback(');
    const body = store.slice(start, matchClose(store, store.indexOf('{', store.indexOf(')', start))) + 1);
    assert.match(body, /provisionWakeCredential\([^)]*,\s*grantDeclaration\)/, 'addFeedback passes the record to the provider');
    for (const file of ['routes/proxy-runner.js']) {
      assert.ok(maskSource(src(file)).includes('buildWakeCredentialProvisioner('), `${file} still builds the wake provisioner`);
    }
  });
});

describe('C2 (v) / C3 — every credential mint call site is classified', () => {
  test('no unlisted, stale or drifted entry', () => {
    assert.deepEqual(censusClassification(PRODUCTION), []);
  });

  test('C3 class set: outside E followup-helper 2 calls / 2 branches, wake 1, M4 1, leaf 3, internal 5; inside E exactly the classes followup-helper, refire-helper and launch', () => {
    assert.deepEqual(classSet(), {
      'followup-helper': { calls: 2, branches: 2 },
      'wake-helper': { calls: 1, branches: 1 },
      'launch-M4': { calls: 1, branches: 1 },
      leaf: { calls: 3, branches: 3 },
      internal: { calls: 5, branches: 5 }
    });
    assert.deepEqual(E_MINT_ROWS.map(e => e.cls).sort(), ['followup-helper', 'launch', 'refire-helper']);
    assert.ok(E_MINT_ROWS.every(e => e.min === 1), 'each E class is "at least one"');
    // Modes agree with the helper calls themselves: attach mode iff attach:.
    const calls = scanDispatchCalls(PRODUCTION);
    for (const site of FOLLOWUP_SITES) {
      const row = MINT_SITE_TABLE.find(e => e.cls === 'followup-helper' && e.key.startsWith(site.key.replace(/ \| ([^|]+)$/, ' [$1]')));
      assert.ok(row, `${site.name} has a followup-helper row`);
      assert.deepEqual(row.modes, site.hasAttachArm ? ['attach', 'pbt'] : ['pbt'], site.name);
      assert.ok(calls.some(c => callKey(c) === site.key));
    }
    // ...and every entrance follow-up call passes attach:, so its row carries both modes.
    assert.deepEqual(E_MINT_ROWS.find(e => e.cls === 'followup-helper').modes, ['attach', 'pbt']);
  });

  test('mutation 1 (v, position-planted, LIN-3611 A1): with the gate predicate gone the helper is an unlisted launch-arm mint, also after re-indenting', () => {
    for (const files of [PRODUCTION, reindented(PRODUCTION)]) {
      const mutated = gateReplaced(files);
      assert.ok(censusClassification(mutated).some(m => m.startsWith('unlisted mint site') && m.includes('E | launch | provisionResumeCredential')), censusClassification(mutated).join('\n'));
    }
  });

  // Re-targeted count-drift witness (LIN-3601, formerly `mutation: a second helper
  // call in the route fails the census (count drift)`): a new arm | helper KIND in E
  // fails this census, in any of the four entrance files; a new mint ROUTE in E fails
  // dispatch-entrance-mint-sweep.test.js (its table and its route count).
  for (const file of E_FILES) {
    test(`a new arm | helper kind planted in ${file} fails the classification (unlisted mint site)`, () => {
      for (const [src, expected] of [
        ['export const planted = async (proxyTokenStore) => provisionBootstrapToken({ proxyTokenStore });', 'E | - | provisionBootstrapToken'],
        ['export const planted = async (proxyTokenStore) => attachProxyContext({ proxyTokenStore });', 'E | - | attachProxyContext']
      ]) {
        const v = censusClassification(appendToE(PRODUCTION, file, src));
        assert.ok(v.some(m => m.startsWith('unlisted mint site') && m.includes(expected)), `${file}: ${v.join('\n')}`);
      }
    });
  }

  test('moving the launch attach or the follow-up helper between the entrance files keeps the classification clean (E is one unit)', () => {
    const moved = appendToE(PRODUCTION, 'lib/dispatch-entrance.js', 'export const m = (proxyTokenStore) => attachProxyContext({ proxyTokenStore });');
    // a second launch | attachProxyContext in E is still "at least one"
    assert.deepEqual(censusClassification(moved).filter(m => m.includes('E | launch')), []);
  });

  test('mutation 5: a stale table entry fails', () => {
    const table = [...MINT_SITE_TABLE, { key: 'routes/gone.js | POST /api/gone [kind] | follow-up | provisionResumeCredential', count: 1, cls: 'followup-helper', modes: ['pbt'], reason: 'stale' }];
    assert.ok(censusClassification(PRODUCTION, table).some(m => m.startsWith('stale table entry')));
  });

  test('mutation 5: an E row whose site is gone fails (no refire helper left)', () => {
    const mutated = plantInE(PRODUCTION, BROKER_HELPER_CALL, ' resumed = await Promise.resolve({');
    assert.ok(censusClassification(mutated).includes('stale table entry: E | - | provisionResumeCredential'));
  });

  test('mutation 5: a new unlisted mint site fails', () => {
    const mutated = [...PRODUCTION, { file: 'routes/new-mint.js', src: "router.post('/api/new-mint', async () => { await provisionBootstrapToken({ proxyTokenStore }); });" }];
    assert.ok(censusClassification(mutated).some(m => m.startsWith('unlisted mint site: routes/new-mint.js')));
  });
});

// ── LIN-3135 (R2) + LIN-3601: the location-free shape checks on every E call ──
// `MINT_FNS` sees the broker route's `provisionResumeCredential(` (the `E | - |
// provisionResumeCredential` row above) but not its inline `proxyTokenStore.createToken(`
// — today's grant-less mint for no itemId / none / row-missing. `brokerRouteWitness`
// sliced routes/dispatch.js from the broker's registration and counted that route's
// calls, so it could not survive the broker moving. It is retired as a file-and-route-
// keyed function. What it guarded is carried by:
//   - behaviour: dispatch-entrance-mint-sweep.test.js, World N (the broker mints once,
//     grant-less, with exactly {kind, scope, label, ttl, createdBy}) and World R (it
//     echoes the record, only for the recorded owner who took the live row), plus
//     lin-3135-broker-refire-declared.test.js, whose "2b" test is the covering test for
//     "the route never passes the record into the helper" (shown failing under that
//     mutation, PR evidence);
//   - the scans below, over the four entrance files as one unit, wherever a call sits.

const BROKER_HELPER_CALL = '          resumed = await provisionResumeCredential({';

/** Depth-1 property names of the object literal spanning [objOpen, objClose]. */
function topLevelKeys(masked, objOpen, objClose) {
  const keys = [];
  let depth = 0;
  let expectKey = false;
  for (let k = objOpen; k <= objClose; k++) {
    const c = masked[k];
    if ('({['.includes(c)) { depth++; if (depth === 1) expectKey = true; continue; }
    if (')}]'.includes(c)) { depth--; continue; }
    if (depth !== 1) continue;
    if (c === ',') { expectKey = true; continue; }
    if (expectKey && /[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(masked.slice(k));
      keys.push(m[0]);
      k += m[0].length - 1;
      expectKey = false;
    }
  }
  return keys;
}

/**
 * Violations of the shape checks every entrance call must satisfy, wherever it sits
 * (the four E files as one unit). Empty when clean:
 *   - no direct `mintGrantBootstrap(` call (every mint goes through the helpers);
 *   - no `provisionResumeCredential(` call passes `grantDeclaration`, `declaredGrants`
 *     or `grantOwnerAccountId` (the helper reads the persisted record itself);
 *   - no inline `proxyTokenStore.createToken(` call carries a `grants` key (the broker's
 *     inline mint is grant-less);
 *   - no `.addItem(` call (every enqueue goes through createDispatchItem).
 * (`proxyTokenStore` as a direct key of each createDispatchItem call, and inline
 * spread-free `fields`, are lin-3130's and C2 (ii) above.)
 */
function entranceShape(files) {
  const v = [];
  for (const { file, src } of files) {
    if (!inE(file)) continue;
    const masked = maskSource(src);
    for (const idx of indicesOf(masked, 'mintGrantBootstrap(', 0, masked.length)) {
      if (!isDefinition(masked, idx)) v.push(`${file}: calls mintGrantBootstrap( directly`);
    }
    for (const idx of indicesOf(masked, 'provisionResumeCredential(', 0, masked.length)) {
      if (/[\w$.]/.test(masked[idx - 1]) || isDefinition(masked, idx)) continue;
      const objOpen = masked.indexOf('{', idx);
      if (objOpen < 0 || objOpen > idx + 40) continue;
      const keys = topLevelKeys(masked, objOpen, matchClose(masked, objOpen));
      for (const forbidden of ['grantDeclaration', 'declaredGrants', 'grantOwnerAccountId']) {
        if (keys.includes(forbidden)) v.push(`${file}: a provisionResumeCredential( call passes ${forbidden}`);
      }
    }
    for (const idx of indicesOf(masked, 'proxyTokenStore.createToken(', 0, masked.length)) {
      const objOpen = masked.indexOf('{', idx);
      if (objOpen < 0) continue;
      if (topLevelKeys(masked, objOpen, matchClose(masked, objOpen)).includes('grants')) v.push(`${file}: an inline proxyTokenStore.createToken( call carries grants`);
    }
    for (const idx of indicesOf(masked, '.addItem(', 0, masked.length)) v.push(`${file}: calls .addItem( directly (offset ${idx})`);
  }
  return v;
}

describe('LIN-3135 (R2) + LIN-3601 — the entrances: no direct grant mint, the record never passed into the helper, the inline mint grant-less', () => {
  test('the live entrances are clean', () => {
    assert.deepEqual(entranceShape(PRODUCTION), []);
  });

  // (formerly :751) A direct mintGrantBootstrap( in routes/dispatch.js. Widened from one
  // file to all of E: a direct grant mint in ANY entrance file fails.
  test('mutation: a direct mintGrantBootstrap( in any entrance file fails', () => {
    for (const file of E_FILES) {
      const v = entranceShape(appendToE(PRODUCTION, file, 'export const planted = (proxyTokenStore) => proxyTokenStore.mintGrantBootstrap({});'));
      assert.ok(v.includes(`${file}: calls mintGrantBootstrap( directly`), `${file}: ${v.join('\n')}`);
    }
  });

  // (formerly :735, kept as added tightening; the covering test is lin-3135 2b.) The
  // helper re-reads the record itself; no route holds it.
  test('mutation: the record passed into the broker\'s helper call (grantDeclaration) fails', () => {
    const mutated = plantInE(PRODUCTION, BROKER_HELPER_CALL, `${BROKER_HELPER_CALL}\n            grantDeclaration: lookup.record,`);
    assert.ok(entranceShape(mutated).some(m => m.endsWith('a provisionResumeCredential( call passes grantDeclaration')), entranceShape(mutated).join('\n'));
    for (const key of ['declaredGrants', 'grantOwnerAccountId']) {
      const planted = plantInE(PRODUCTION, BROKER_HELPER_CALL, `${BROKER_HELPER_CALL}\n            ${key}: 1,`);
      assert.ok(entranceShape(planted).some(m => m.endsWith(`passes ${key}`)), key);
    }
  });

  // (formerly :730) grants planted on the broker's inline createToken. Behaviour: the
  // mint sweep's World N broker row. Shape (added, location-free): no inline
  // createToken in E carries a grants key.
  test('mutation: grants planted on an inline proxyTokenStore.createToken( fails', () => {
    const mutated = plantInE(PRODUCTION, '        createdBy: req.dispatchTokenOwner\n      });\n    } catch (err) {\n      console.error(\'Broker-token mint failed:\'', "        createdBy: req.dispatchTokenOwner,\n        grants: ['dispatch']\n      });\n    } catch (err) {\n      console.error('Broker-token mint failed:'");
    assert.ok(entranceShape(mutated).some(m => m.endsWith('an inline proxyTokenStore.createToken( call carries grants')), entranceShape(mutated).join('\n'));
  });

  test('mutation: a direct .addItem( planted in any entrance file fails', () => {
    for (const file of E_FILES) {
      assert.ok(entranceShape(appendToE(PRODUCTION, file, 'export const planted = (store) => store.addItem(1, {});')).some(m => m.startsWith(`${file}: calls .addItem(`)), file);
    }
  });
});

// ── C2 (i) completeness: the queue's writer set (Class F: "the queue has no
// other follow-up writer"). C2 (i) enumerates createDispatchItem calls and
// C2 (v) the three mint helpers; a direct `.addItem(` writer outside the
// factory would bypass both. Keyed by {file, enclosing function/method}.
const ADD_ITEM_WRITERS = {
  'lib/dispatch-factory.js | createDispatchItem': 1,   // the factory chokepoint (LIN-1139)
  'lib/dispatch-store.js | expandCascadeAborts': 1,    // abort items: no followUpTo, no credential
  'lib/dispatch-store.js | _mintWake': 1,              // the wake (Class F eleventh member)
  'lib/dispatch-store.js | addFeedback': 1             // a [pending] wake's direct enqueue (no witness CAS)
};

function scanAddItemWriters(files) {
  const counts = {};
  for (const { file, src } of files) {
    const masked = maskSource(src);
    for (const idx of indicesOf(masked, '.addItem(', 0, masked.length)) {
      const pre = masked.slice(0, idx);
      // Nearest enclosing function declaration or class method (masked text,
      // so prose and strings never match).
      let best = null;
      const consider = (i, name) => { if (!best || i > best.i) best = { i, name }; };
      for (const m of pre.matchAll(/(?:^|\n)[ \t]*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)) consider(m.index, m[1]);
      for (const m of pre.matchAll(/\n[ \t]+(?:async\s+)?(\w+)\s*\([^)\n]*\)\s*\{/g)) {
        if (!['if', 'for', 'while', 'switch', 'catch'].includes(m[1])) consider(m.index, m[1]);
      }
      const key = `${file} | ${best ? best.name : '(top level)'}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

describe('C2 (i) — the queue writer set is closed', () => {
  test('exactly the four known .addItem( writers', () => {
    assert.deepEqual(scanAddItemWriters(PRODUCTION), ADD_ITEM_WRITERS);
  });
  test('mutation: a fifth, direct .addItem( follow-up writer fails', () => {
    const mutated = [...PRODUCTION, { file: 'routes/new-resume.js', src: "export function mount(router) {\n  router.post('/api/new-resume', async (req, res) => {\n    const t = await proxyTokenStore.createToken(urlKey, {});\n    await dispatchQueueStore.addItem(urlKey, { prompt, followUpTo: req.body.followUpTo, bootstrapToken: t.token });\n  });\n}" }];
    assert.notDeepEqual(scanAddItemWriters(mutated), ADD_ITEM_WRITERS);
    // …and the existing C2 (i) and (v) do NOT see it (the gap this closes):
    assert.deepEqual(censusC2(mutated), []);
    assert.deepEqual(censusClassification(mutated), []);
  });
});

// C2 (i) closure (LIN-3134 parent review): `.addItem(` is the ONLY way
// production reaches the queue writer. Any other code-position `addItem`
// reference (an alias, `.bind`/`.call`, a destructure, a computed
// `['addItem']` access) would be a writer the scan above cannot key.
const ADD_ITEM_NON_CALL_REFS = {
  'lib/dispatch-factory.js': 1,   // the `typeof store.addItem !== 'function'` guard
  'lib/dispatch-store.js': 1      // the method definition
};

function scanAddItemNonCallRefs(files) {
  const out = {};
  for (const { file, src } of files) {
    const masked = maskSource(src);
    let n = 0;
    for (const m of masked.matchAll(/\baddItem\b/g)) if (!masked.startsWith('.addItem(', m.index - 1)) n++;
    // Computed access: strings are masked, so read the RAW text of `[ '…' ]`.
    for (const m of masked.matchAll(/\[\s*(['"`])/g)) {
      const q = m.index + m[0].length - 1;
      const close = masked.indexOf(m[1], q + 1);
      if (close > q && src.slice(q + 1, close) === 'addItem') n++;
    }
    if (n) out[file] = n;
  }
  return out;
}

describe('C2 (i) closure — no aliased or computed addItem reference', () => {
  test('the only non-call addItem references are the guard and the definition', () => {
    assert.deepEqual(scanAddItemNonCallRefs(PRODUCTION), ADD_ITEM_NON_CALL_REFS);
  });
  test('mutation: an aliased writer (addItem.bind) fails', () => {
    const mutated = [...PRODUCTION, { file: 'lib/new-alias.js', src: 'export function w(s, u, p) {\n  const enqueue = s.addItem.bind(s);\n  return enqueue(u, { prompt: p });\n}' }];
    assert.notDeepEqual(scanAddItemNonCallRefs(mutated), ADD_ITEM_NON_CALL_REFS);
  });
  test('mutation: a computed-access writer (store[\'addItem\']) fails', () => {
    const mutated = [...PRODUCTION, { file: 'routes/new-bracket.js', src: "export function w(s, u, p) {\n  return s['addItem'](u, { prompt: p });\n}" }];
    assert.notDeepEqual(scanAddItemNonCallRefs(mutated), ADD_ITEM_NON_CALL_REFS);
  });
});
