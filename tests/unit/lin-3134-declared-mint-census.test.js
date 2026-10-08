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

// ── F3 — the declared-mint writer set ────────────────────────────────────────
// LIN-3136 (T3) adds the first production writers: exactly the M1 (kickoff),
// M2 (session dispatch, incl. M2b) and M4 (feedback autopilot) launch literals.
// The three proxy-dispatch launch arms stay undeclared (M3, deferred to
// LIN-3099). The mutations below check against this allowed set, so a planted
// writer cannot pass just because the set is no longer empty.

const F3_WRITERS = [
  { site: 'M1', file: 'routes/proxy-kickoff.js', text: "declaredGrants: ['dispatch']," },
  { site: 'M2', file: 'routes/dispatch.js', text: "declaredGrants: ['dispatch']," },
  { site: 'M4', file: 'routes/workspace-api.js', text: "declaredGrants: ['dispatch']," }
];

/** F3 against the allowed writer set: each listed writer exactly once, nothing unlisted. */
function checkF3(files, allowed = F3_WRITERS) {
  const v = [];
  const hits = scanF3(files);
  for (const w of allowed) {
    const found = hits.filter(h => h.file === w.file && h.text === w.text).length;
    if (found !== 1) v.push(`${w.site} (${w.file}): expected exactly one writer, found ${found}`);
  }
  for (const h of hits) {
    if (!allowed.some(w => w.file === h.file && w.text === h.text)) v.push(`unlisted writer: ${h.file}:${h.line} ${h.text}`);
  }
  return v;
}

describe('F3 — the declared-mint writer set is exactly M1, M2 and M4', () => {
  test('the production writers are exactly the three declared launch literals', () => {
    assert.deepEqual(F3_WRITERS.map(w => w.site), ['M1', 'M2', 'M4']);
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

  test('mutation: a listed writer removed fails F3 (the set never shrinks silently)', () => {
    const mutated = PRODUCTION.map(f => (f.file === 'routes/proxy-kickoff.js'
      ? { ...f, src: f.src.replace("declaredGrants: ['dispatch'],", '') } : f));
    assert.ok(checkF3(mutated).some(m => m.startsWith('M1 (routes/proxy-kickoff.js): expected exactly one writer, found 0')));
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

  test('_formatItem / _formatHistoryItem bodies contain no spread, no grantRefusal, and exactly one declaredMint assignment', () => {
    const storeSrc = readFileSync(join(REPO, 'lib', 'dispatch-store.js'), 'utf8');
    for (const name of ['_formatItem', '_formatHistoryItem']) {
      const body = extractMethod(storeSrc, name);
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
    }
  });

  test('mutation: a second grantDeclaration use in a formatter body is caught', () => {
    const storeSrc = readFileSync(join(REPO, 'lib', 'dispatch-store.js'), 'utf8');
    const body = extractMethod(storeSrc, '_formatItem') + '\n    item.x = doc.grantDeclaration;';
    assert.notEqual((body.match(/grantDeclaration/g) || []).length, 1);
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

// The six follow-up-carrying calls (Class F, ten branches). `predicate` is the
// site's follow-up gate literal; null where the call is a follow-up by
// construction (no launch arm).
const FOLLOWUP_SITES = [
  { name: 'proxy-dispatch POST /dispatch', key: 'routes/proxy-dispatch.js | POST /api/proxy/dispatch | kind', predicate: 'isFollowUp', hasAttachArm: true },
  { name: 'override arm', key: 'routes/proxy-dispatch.js | POST /api/proxy/recommend-and-dispatch | kind', predicate: 'isFollowUp', hasAttachArm: true },
  { name: 'LLM arm', key: 'routes/proxy-dispatch.js | POST /api/proxy/recommend-and-dispatch | kind: effectiveKind', predicate: 'isFollowUp', hasAttachArm: true },
  { name: 'dispatch session', key: 'routes/dispatch.js | POST /workspace/:urlKey/api/dispatch | kind', predicate: 'followUpTo', hasAttachArm: true },
  { name: 'follow-up-dispatch dispatchSessionFollowUp', key: 'lib/follow-up-dispatch.js | function dispatchSessionFollowUp | (none)', predicate: null, hasAttachArm: false },
  { name: 'chat-tools send_follow_up', key: 'lib/chat-tools.js | tool send_follow_up | (none)', predicate: null, hasAttachArm: false }
];

// The four calls with no follow-up (launch or leaf only).
const NON_FOLLOWUP_CALLS = [
  "routes/collective.js | POST /workspace/:urlKey/collective/start | kind: 'custom'",
  "routes/proxy-kickoff.js | POST /api/proxy/autopilot/kickoff | kind: 'autopilot'",
  "routes/workspace-api.js | function enqueueFeedbackTriage | kind: 'triage'",
  "routes/workspace-api.js | function enqueueFeedbackAutopilot | kind: 'autopilot'"
];

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
  for (const call of calls) {
    const key = callKey(call);
    if (!call.fieldsInline) v.push(`(ii) ${key}: fields is not an inline object`);
    if (call.fieldsSpread) v.push(`(ii) ${key}: spread in fields`);
    if (!call.carriesFollowUpTo) {
      if (!NON_FOLLOWUP_CALLS.includes(key)) v.push(`(i) unlisted createDispatchItem call: ${key}`);
      continue;
    }
    const site = siteByKey.get(key);
    if (!site) { v.push(`(i) unlisted follow-up createDispatchItem call: ${key}`); continue; }
    seen.add(key);
    for (const msg of checkFollowUpCall(call, site)) v.push(`${site.name}: ${msg}`);
  }
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

const KICKOFF = 'routes/proxy-kickoff.js | POST /api/proxy/autopilot/kickoff';
const PD_DISPATCH = 'routes/proxy-dispatch.js | POST /api/proxy/dispatch [kind]';
const PD_OVERRIDE = 'routes/proxy-dispatch.js | POST /api/proxy/recommend-and-dispatch [kind]';
const PD_LLM = 'routes/proxy-dispatch.js | POST /api/proxy/recommend-and-dispatch [kind: effectiveKind]';
const SESSION = 'routes/dispatch.js | POST /workspace/:urlKey/api/dispatch [kind]';

// C2 (v): {file, construct [kind], arm, fn} -> class, with a reason. The four
// attach branches are classed under the follow-up class (`followup-helper`,
// modes attach+pbt), never as launch-M2/M3: a launch-M2/M3 entry is valid
// only after the gate, so one line cannot be both.
const MINT_SITE_TABLE = [
  { key: `${PD_DISPATCH} | follow-up | provisionResumeCredential`, count: 1, cls: 'followup-helper', modes: ['attach', 'pbt'], reason: 'POST /dispatch follow-up gate' },
  { key: `${PD_OVERRIDE} | follow-up | provisionResumeCredential`, count: 1, cls: 'followup-helper', modes: ['attach', 'pbt'], reason: 'override arm follow-up gate' },
  { key: `${PD_LLM} | follow-up | provisionResumeCredential`, count: 1, cls: 'followup-helper', modes: ['attach', 'pbt'], reason: 'LLM arm follow-up gate' },
  { key: `${SESSION} | follow-up | provisionResumeCredential`, count: 1, cls: 'followup-helper', modes: ['attach', 'pbt'], reason: 'session route follow-up arm of the arming ternary' },
  { key: 'lib/follow-up-dispatch.js | function dispatchSessionFollowUp [(none)] | follow-up | provisionResumeCredential', count: 1, cls: 'followup-helper', modes: ['pbt'], reason: 'dispatchSessionFollowUp: a follow-up by construction (approve-follow-up + Apply)' },
  { key: 'lib/chat-tools.js | tool send_follow_up [(none)] | follow-up | provisionResumeCredential', count: 1, cls: 'followup-helper', modes: ['pbt'], reason: 'send_follow_up: a follow-up by construction' },
  { key: 'lib/wake-credential.js | function buildWakeCredentialProvisioner | - | provisionResumeCredential', count: 1, cls: 'wake-helper', reason: 'the wake (Class F eleventh member)' },
  { key: 'routes/dispatch.js | POST /api/dispatch/broker-token | - | provisionResumeCredential', count: 1, cls: 'refire-helper', reason: 'declared refire re-mint, R2 (LIN-3135)' },
  { key: `${KICKOFF} [kind: 'autopilot'] | launch | attachProxyContext`, count: 1, cls: 'launch-M1', reason: 'kickoff launch: declared M1 (LIN-3136)' },
  { key: `${SESSION} | launch | attachProxyContext`, count: 1, cls: 'launch-M2', reason: 'session route launch attach, after the gate: declared M2/M2b (LIN-3136)' },
  { key: `${PD_DISPATCH} | launch | attachProxyContext`, count: 1, cls: 'launch-M3', reason: 'POST /dispatch launch attach, after the gate: undeclared, M3 deferred to LIN-3099' },
  { key: `${PD_OVERRIDE} | launch | attachProxyContext`, count: 1, cls: 'launch-M3', reason: 'override arm launch attach, after the gate: undeclared, M3 deferred to LIN-3099' },
  { key: `${PD_LLM} | launch | attachProxyContext`, count: 1, cls: 'launch-M3', reason: 'LLM arm launch attach, after the gate: undeclared, M3 deferred to LIN-3099' },
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
    else if (entry.count !== count) v.push(`count drift: ${key} expected x${entry.count}, found x${count}`);
  }
  for (const e of table) if (!found.has(e.key)) v.push(`stale table entry: ${e.key}`);
  return v;
}

/** C3: the class-set view of the (v) table (one implementation). */
function classSet(table = MINT_SITE_TABLE) {
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

const POST_DISPATCH_GATE = "          if (isFollowUp) {\n            return provisionResumeCredential({";

describe('C2 (i)/(ii) — createDispatchItem calls: follow-up set, inline fields, no spread', () => {
  test('10 calls; the 6 follow-up-carrying ones are exactly the Class F set; every fields is inline, spread-free', () => {
    const calls = scanDispatchCalls(PRODUCTION);
    assert.equal(calls.length, 10);
    assert.deepEqual(calls.filter(c => c.carriesFollowUpTo).map(callKey).sort(), FOLLOWUP_SITES.map(s => s.key).sort());
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
});

describe('C2 (iii) — branch-aware: helper under the gate, no direct mint on a follow-up arm', () => {
  test('every follow-up call is clean (a–e)', () => {
    const calls = scanDispatchCalls(PRODUCTION);
    for (const site of FOLLOWUP_SITES) {
      const call = calls.find(c => callKey(c) === site.key);
      assert.ok(call, `${site.name} found`);
      assert.deepEqual(checkFollowUpCall(call, site), [], site.name);
    }
  });

  test('mutation 1: the pre-change attach branch as finalizePrompt\'s first statement fails (iii c)', () => {
    const mutated = plant(PRODUCTION, 'routes/proxy-dispatch.js', replaceOnce(POST_DISPATCH_GATE,
      "          if (prompt && shouldAppendProxyContext) return attachProxyContext({ proxyTokenStore });\n" + POST_DISPATCH_GATE));
    assert.ok(censusC2(mutated).some(m => m.includes('(iii c) a direct attachProxyContext( before the end of the gated statement')));
  });

  test('mutation 1: the helper moved out from under the gate predicate fails (iii c)', () => {
    const mutated = plant(PRODUCTION, 'routes/proxy-dispatch.js', replaceOnce(POST_DISPATCH_GATE, POST_DISPATCH_GATE.replace('if (isFollowUp) {', 'if (prompt) {')));
    assert.ok(censusC2(mutated).some(m => m.includes('is not under the `isFollowUp` gate')));
  });

  test('mutation 2: a direct attachProxyContext( inside the gate arm fails (iii c)', () => {
    const mutated = plant(PRODUCTION, 'routes/proxy-dispatch.js', replaceOnce(POST_DISPATCH_GATE,
      "          if (isFollowUp) {\n            if (shouldAppendProxyContext) return attachProxyContext({ proxyTokenStore });\n            return provisionResumeCredential({"));
    assert.ok(censusC2(mutated).some(m => m.includes('(iii c) a direct attachProxyContext( before the end of the gated statement')));
  });

  test('mutation 3: attach: dropped from the helper call at a hasAttachArm site fails (iii e)', () => {
    const mutated = plant(PRODUCTION, 'routes/dispatch.js', replaceOnce('                  attach: wantProxyContext\n', '                  unusedAttach: wantProxyContext\n'));
    assert.ok(censusC2(mutated).some(m => m.includes('dispatch session: (iii e)')));
  });

  test('mutation 4 (iii d half): a declaredGrants literal before the gate fails (iii d)', () => {
    const mutated = plant(PRODUCTION, 'routes/proxy-dispatch.js', replaceOnce(POST_DISPATCH_GATE,
      "          const launchGrant = { declaredGrants: ['dispatch'] };\n" + POST_DISPATCH_GATE));
    assert.ok(censusC2(mutated).some(m => m.includes('(iii d) declaredGrants before the gate')));
  });

  test('mutation 5: a direct provisionBootstrapToken( in a follow-up call fails (iii a/b)', () => {
    const mutated = plant(PRODUCTION, 'lib/chat-tools.js', replaceOnce('finalizePrompt: (resolvedHarness) => provisionResumeCredential({', 'finalizePrompt: (resolvedHarness) => provisionBootstrapToken({'));
    const v = censusC2(mutated);
    assert.ok(v.some(m => m.includes('(iii b) a direct provisionBootstrapToken( call')));
    assert.ok(v.some(m => m.includes('(iii a) no provisionResumeCredential( call')));
  });
});

describe('C2 (iv) — the wake routes through the helper', () => {
  test('wake-credential calls the helper; addFeedback passes the record; both builders remain', () => {
    const src = (file) => PRODUCTION.find(f => f.file === file).src;
    assert.ok(maskSource(src('lib/wake-credential.js')).includes('provisionResumeCredential('), 'wake-credential mints through the helper');
    const store = maskSource(src('lib/dispatch-store.js'));
    const start = store.indexOf('async addFeedback(');
    const body = store.slice(start, matchClose(store, store.indexOf('{', store.indexOf(')', start))) + 1);
    assert.match(body, /provisionWakeCredential\([^)]*,\s*grantDeclaration\)/, 'addFeedback passes the record to the provider');
    for (const file of ['routes/dispatch.js', 'routes/proxy-runner.js']) {
      assert.ok(maskSource(src(file)).includes('buildWakeCredentialProvisioner('), `${file} still builds the wake provisioner`);
    }
  });
});

describe('C2 (v) / C3 — every credential mint call site is classified', () => {
  test('no unlisted, stale or drifted entry', () => {
    assert.deepEqual(censusClassification(PRODUCTION), []);
  });

  test('C3 class set: followup-helper 6 calls / 10 branches, wake 1, refire 1, M1 1, M2 1, M3 3, M4 1, leaf 3, internal 5', () => {
    assert.deepEqual(classSet(), {
      'followup-helper': { calls: 6, branches: 10 },
      'wake-helper': { calls: 1, branches: 1 },
      'refire-helper': { calls: 1, branches: 1 },
      'launch-M1': { calls: 1, branches: 1 },
      'launch-M2': { calls: 1, branches: 1 },
      'launch-M3': { calls: 3, branches: 3 },
      'launch-M4': { calls: 1, branches: 1 },
      leaf: { calls: 3, branches: 3 },
      internal: { calls: 5, branches: 5 }
    });
    // Modes agree with the helper calls themselves: attach mode iff attach:.
    const calls = scanDispatchCalls(PRODUCTION);
    for (const site of FOLLOWUP_SITES) {
      const row = MINT_SITE_TABLE.find(e => e.cls === 'followup-helper' && e.key.startsWith(site.key.replace(/ \| ([^|]+)$/, ' [$1]')));
      assert.ok(row, `${site.name} has a followup-helper row`);
      assert.deepEqual(row.modes, site.hasAttachArm ? ['attach', 'pbt'] : ['pbt'], site.name);
      assert.ok(calls.some(c => callKey(c) === site.key));
    }
  });

  test('mutation 1 (v): with the gate predicate gone, the helper becomes an unlisted launch-arm mint', () => {
    const mutated = plant(PRODUCTION, 'routes/proxy-dispatch.js', replaceOnce(POST_DISPATCH_GATE, POST_DISPATCH_GATE.replace('if (isFollowUp) {', 'if (prompt) {')));
    assert.ok(censusClassification(mutated).some(m => m.startsWith('unlisted mint site') && m.includes('| launch | provisionResumeCredential')));
  });

  test('mutation 5: a stale table entry fails', () => {
    const table = [...MINT_SITE_TABLE, { key: 'routes/gone.js | POST /api/gone [kind] | follow-up | provisionResumeCredential', count: 1, cls: 'followup-helper', modes: ['pbt'], reason: 'stale' }];
    assert.ok(censusClassification(PRODUCTION, table).some(m => m.startsWith('stale table entry')));
  });

  test('mutation 5: a new unlisted mint site fails', () => {
    const mutated = [...PRODUCTION, { file: 'routes/new-mint.js', src: "router.post('/api/new-mint', async () => { await provisionBootstrapToken({ proxyTokenStore }); });" }];
    assert.ok(censusClassification(mutated).some(m => m.startsWith('unlisted mint site: routes/new-mint.js')));
  });
});

// ── LIN-3135 (R2): the broker route's inline mint stays grant-less ───────────
// `MINT_FNS` sees the route's `provisionResumeCredential(` (the refire-helper
// row above) but not its inline `proxyTokenStore.createToken(` — today's
// grant-less mint for no itemId / none / row-missing. This witness pins that
// mint's shape, that the route never calls `mintGrantBootstrap(` directly, and
// that the helper call reads the record itself (ruling
// lin3135-f3c4-census-conflict = helper-lookup: no route holds the record).

const BROKER_ROUTE = "router.post('/api/dispatch/broker-token'";
const BROKER_CREATE_TOKEN_KEYS = ['kind', 'scope', 'label', 'ttl', 'createdBy'];

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

/** Violations of the broker-route mint shape in routes/dispatch.js; empty when clean. */
function brokerRouteWitness(files) {
  const v = [];
  const file = files.find(f => f.file === 'routes/dispatch.js');
  if (!file) return ['routes/dispatch.js not found'];
  const { src } = file;
  const masked = maskSource(src);
  if (masked.includes('mintGrantBootstrap(')) v.push('routes/dispatch.js calls mintGrantBootstrap( directly');
  const start = src.indexOf(BROKER_ROUTE);
  if (start < 0) return [...v, 'broker-token route not found'];
  const end = matchClose(masked, start + 'router.post'.length);

  const creates = indicesOf(masked, 'proxyTokenStore.createToken(', start, end);
  if (creates.length !== 1) v.push(`broker route: expected 1 inline createToken, found ${creates.length}`);
  for (const idx of creates) {
    const objOpen = masked.indexOf('{', idx);
    const keys = topLevelKeys(masked, objOpen, matchClose(masked, objOpen));
    if (JSON.stringify(keys) !== JSON.stringify(BROKER_CREATE_TOKEN_KEYS)) {
      v.push(`broker route: inline createToken keys ${JSON.stringify(keys)}, expected ${JSON.stringify(BROKER_CREATE_TOKEN_KEYS)}`);
    }
  }

  const helpers = indicesOf(masked, 'provisionResumeCredential(', start, end);
  if (helpers.length !== 1) v.push(`broker route: expected 1 provisionResumeCredential call, found ${helpers.length}`);
  for (const idx of helpers) {
    const objOpen = masked.indexOf('{', idx);
    const objClose = matchClose(masked, objOpen);
    const keys = topLevelKeys(masked, objOpen, objClose);
    for (const forbidden of ['grantDeclaration', 'declaredGrants', 'grantOwnerAccountId', 'attach']) {
      if (keys.includes(forbidden)) v.push(`broker route: helper call passes ${forbidden}`);
    }
    for (const [name, text] of [['dispatchStore', 'dispatchStore: dispatchQueueStore'], ['followUpTo', 'followUpTo: itemId'], ['urlKey', 'urlKey: req.dispatchUrlKey'], ['label', "label: 'refire-broker'"]]) {
      const prop = topLevelProp(masked, src, objOpen, objClose, name);
      if (!prop || prop.text !== text) v.push(`broker route: helper call ${name} is ${prop ? prop.text : 'absent'}, expected ${text}`);
    }
  }
  return v;
}

const BROKER_CREATED_BY = '        createdBy: req.dispatchTokenOwner\n      });';
const BROKER_HELPER_CALL = '          resumed = await provisionResumeCredential({';

describe('LIN-3135 (R2) — the broker route: helper re-mint listed, inline mint grant-less', () => {
  test('one grant-less inline createToken {kind, scope, label, ttl, createdBy}, one helper call reading the record itself, no direct mintGrantBootstrap', () => {
    assert.deepEqual(brokerRouteWitness(PRODUCTION), []);
  });

  test('mutation: grants planted on the inline createToken fails the witness', () => {
    const mutated = plant(PRODUCTION, 'routes/dispatch.js', replaceOnce(BROKER_CREATED_BY, "        createdBy: req.dispatchTokenOwner,\n        grants: ['dispatch']\n      });"));
    assert.ok(brokerRouteWitness(mutated).some(m => m.includes('inline createToken keys')));
  });

  test('mutation: the record passed into the helper (grantDeclaration) fails the witness', () => {
    const mutated = plant(PRODUCTION, 'routes/dispatch.js', replaceOnce(BROKER_HELPER_CALL, `${BROKER_HELPER_CALL}\n            grantDeclaration: lookup.record,`));
    assert.ok(brokerRouteWitness(mutated).includes('broker route: helper call passes grantDeclaration'));
  });

  test('mutation: a second helper call in the route fails the census (count drift) and the witness', () => {
    const mutated = plant(PRODUCTION, 'routes/dispatch.js', replaceOnce(BROKER_HELPER_CALL, `          await provisionResumeCredential({ proxyTokenStore, dispatchStore: dispatchQueueStore, urlKey: req.dispatchUrlKey, followUpTo: itemId });\n${BROKER_HELPER_CALL}`));
    assert.ok(censusClassification(mutated).includes('count drift: routes/dispatch.js | POST /api/dispatch/broker-token | - | provisionResumeCredential expected x1, found x2'));
    assert.ok(brokerRouteWitness(mutated).some(m => m.includes('expected 1 provisionResumeCredential call, found 2')));
  });

  test('mutation: the helper call removed fails the census (stale refire-helper row)', () => {
    const mutated = plant(PRODUCTION, 'routes/dispatch.js', replaceOnce(BROKER_HELPER_CALL, '          resumed = await Promise.resolve({'));
    assert.ok(censusClassification(mutated).includes('stale table entry: routes/dispatch.js | POST /api/dispatch/broker-token | - | provisionResumeCredential'));
  });

  test('mutation: a direct mintGrantBootstrap( in routes/dispatch.js fails the witness', () => {
    const mutated = plant(PRODUCTION, 'routes/dispatch.js', replaceOnce(BROKER_HELPER_CALL, `          await proxyTokenStore.mintGrantBootstrap({});\n${BROKER_HELPER_CALL}`));
    assert.ok(brokerRouteWitness(mutated).includes('routes/dispatch.js calls mintGrantBootstrap( directly'));
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
