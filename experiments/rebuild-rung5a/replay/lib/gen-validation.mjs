// Generated + targeted inputs for lib/dispatch-validation.js (and the factory's
// isFilePointerPilotEnabled). Payload specs only — decoded by world.mjs.
import { rngFor, U, big, fn, UUIDS, BAD_UUIDS, UNICODE, CONTROL } from './gen-common.mjs';

export const CAPS = {
  prompt: 10000000, promptName: 1000, issueIdentifier: 100, issueTitle: 1000, issueUrl: 8000, repo: 1000,
  model: 1000, harness: 1000, terminal: 1000, effort: 1000, sessionId: 128
};
const KINDS = ['blocked', 'bug', 'plan', 'look-into', 'triage', 'breakdown', 'research', 'scoping', 'design', 'spike', 'context', 'plan-review', 'implementation', 'review', 'close-out', 'retrospective-audit', 'retro', 'autopilot', 'defer', 'periodical', 'custom'];
const PERIODICALS = ['documentation-review', 'test-coverage-gap', 'security-review', 'api-quality', 'code-quality', 'drift-coherence', 'comprehension-debt', 'stability-review', 'dependency-supply-chain', 'recent-headwinds', 'design-review', 'performance-scale', 'data-fetch-architecture', 'integration-surface-maturity', 'onboarding-journey', 'seams-tangles'];
const TARGETS = ['cli', 'web', 'dash', 'local'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const NONSTRING = [0, 1, -1, { $nan: 1 }, true, false, [], ['a'], ['a', 'b'], { length: 5 }, { length: 2000000000 }, {}, { $big: '10' }];

/** A string for `field` of a given flavour, sized against its cap. */
function strFor(g, field, flavour) {
  const cap = CAPS[field] ?? 1000;
  const huge = cap >= 1000000;
  switch (flavour) {
    case 'atCap': return huge ? big(cap) : 'a'.repeat(cap);
    case 'overCap': return huge ? big(cap + 1) : 'b'.repeat(cap + 1);
    case 'underCap': return huge ? big(cap - 1, 'c') : 'c'.repeat(cap - 1);
    case 'atCapBad': return huge ? big(cap - 1, 'd', '', '\x00') : 'd'.repeat(cap - 1) + '\x01';
    case 'overCapBad': return huge ? big(cap, 'e', '\x00') : '\x00' + 'e'.repeat(cap);
    case 'control': return `ok ${g.pick(CONTROL)} tail`;
    case 'unicode': return g.pick(UNICODE);
    case 'empty': return '';
    case 'ws': return g.pick([' ', '\t', '\n', '\r\n', '  x  ']);
    case 'symbol': return { $sym: 'payload' };
    case 'nonstring': return g.pick(NONSTRING);
    default: return g.pick(['hello', 'Implement LIN-12', 'x', 'owner/repo', 'https://linear.app/acme/issue/LIN-1']);
  }
}

const FLAVOURS = [[30, 'ok'], [6, 'atCap'], [8, 'overCap'], [3, 'underCap'], [4, 'atCapBad'], [3, 'overCapBad'], [9, 'control'], [6, 'unicode'], [4, 'empty'], [3, 'ws'], [9, 'nonstring'], [0.4, 'symbol']];
const HUGE_FLAVOURS = FLAVOURS.map(([w, f]) => [['atCap', 'overCap', 'underCap', 'atCapBad', 'overCapBad'].includes(f) ? w / 12 : w, f]);

function fieldValue(g, field) {
  const nullish = g.weighted([[80, null], [10, 'null'], [10, 'undef']]);
  if (nullish === 'null') return null;
  if (nullish === 'undef') return U;
  switch (field) {
    case 'issueId': return g.pick(['abc-123', '#20', '20', UUIDS[0], 'a'.repeat(100), 'a'.repeat(101), 'bad id', 'LIN_1', '#', '##1', 'x/y', 5, true, '', '日本', '-']);
    case 'followUpTo': return g.weighted([[6, g.pick(UUIDS)], [4, g.pick(BAD_UUIDS)], [1, 7], [1, ['x']]]);
    case 'target': return g.pick([...TARGETS, 'CLI', '', 'desktop', 5, null]);
    case 'force': case 'cascade': case 'abort': return g.pick([true, false, true, 'true', 1, 0, null]);
    case 'ifParked': return g.weighted([[6, false], [2, true], [1, null], [1, 0], [1, 'false'], [1, '']]);
    case 'effort': return g.weighted([[6, g.pick(EFFORTS)], [2, 'turbo'], [1, 'MAX'], [1, '']]);
    case 'sessionId': return g.weighted([[5, 'LIN-1117-autopilot-standalone-2026-07-07'], [3, g.pick(UUIDS)], [2, '__meta__'], [2, ''], [2, 'a'.repeat(128)], [2, 'b'.repeat(129)], [2, 'has\ttab'], [2, 'nul\x00'], [1, 'line\nbreak'], [1, 'ws:a:b:c'], [2, g.pick(UNICODE)], [2, 5], [1, {}], [1, '\x7F']]);
    case 'abortTo': return g.weighted([[5, g.pick(UUIDS)], [3, g.pick(BAD_UUIDS)], [1, 3]]);
    case 'kind': return g.pick([...KINDS, 'Implementation', '', 5]);
    case 'periodicalId': return g.pick([...PERIODICALS, 'nope', '', 3]);
    default: {
      const huge = field === 'prompt';
      return strFor(g, field, g.weighted(huge ? HUGE_FLAVOURS : FLAVOURS));
    }
  }
}

const PAYLOAD_FIELDS = ['prompt', 'promptName', 'issueIdentifier', 'issueTitle', 'issueUrl', 'repo', 'model', 'harness', 'terminal', 'effort', 'issueId', 'followUpTo', 'target', 'force', 'cascade', 'abort', 'sessionId', 'ifParked'];
const EXTRA_FIELDS = ['abortTo', 'kind', 'periodicalId', 'waitForFollowUps', 'queueIfBusy', 'subscription', 'presetId', '__proto__x', 'unknownField', 'emoji🚀'];

function validPayload(g) {
  const p = {};
  if (g.chance(0.8)) p.prompt = g.pick(['Do the thing', 'multi\nline\tprompt', '日本語プロンプト', 'x']);
  if (g.chance(0.6)) p.promptName = g.pick(['implementation', 'Implement', 'review', 'Prompt', 'close out']);
  if (g.chance(0.6)) p.issueIdentifier = g.pick(['LIN-1', 'ACME-42', '#20', 'x'.repeat(100)]);
  if (g.chance(0.4)) p.issueTitle = g.pick(['A title', UNICODE[1]]);
  if (g.chance(0.4)) p.issueUrl = 'https://linear.app/acme/issue/LIN-1';
  if (g.chance(0.3)) p.repo = 'owner/repo';
  if (g.chance(0.3)) p.model = g.pick(['claude-opus', 'deepseek/deepseek-v4-pro']);
  if (g.chance(0.3)) p.harness = g.pick(['claude-code', 'opencode']);
  if (g.chance(0.2)) p.terminal = 'kitty';
  if (g.chance(0.3)) p.effort = g.pick(EFFORTS);
  if (g.chance(0.4)) p.issueId = g.pick(['abc-123', '20', UUIDS[0]]);
  if (g.chance(0.3)) { p.followUpTo = g.pick(UUIDS); if (g.chance(0.7)) p.target = g.pick(['cli', 'web']); }
  else if (g.chance(0.4)) p.target = g.pick(TARGETS);
  if (g.chance(0.2)) p.force = true;
  if (g.chance(0.2)) p.abort = g.pick([true, false]);
  if (g.chance(0.15)) p.cascade = g.pick([true, false]);
  if (g.chance(0.3)) p.sessionId = g.pick(['LIN-1117-autopilot', UUIDS[1]]);
  if (g.chance(0.1)) p.ifParked = false;
  return p;
}

/** One validateDispatchPayload input. */
export function genPayloadInput(seed, i) {
  const g = rngFor(seed, 'gen-v', i);
  const mode = g.weighted([[55, 'break'], [20, 'random'], [15, 'valid'], [5, 'shape'], [5, 'proxy']]);
  let body;
  const meta = { mode };
  if (mode === 'shape') {
    const s = g.pick(['absent', 'undef', 'null', 'string', 'number', 'array', 'nullProto', 'frozen']);
    meta.shape = s;
    const base = validPayload(g);
    body = { absent: '__absent__', undef: U, null: null, string: 'prompt text', number: 42, array: [base], nullProto: { $obj: { nullProto: true, props: base } }, frozen: { $frozen: base } }[s];
  } else {
    body = mode === 'random' ? {} : validPayload(g);
    const broken = mode === 'break' ? g.subset(PAYLOAD_FIELDS, 0.12) : mode === 'random' ? g.subset(PAYLOAD_FIELDS, 0.55) : [];
    if (mode === 'break' && broken.length === 0) broken.push(g.pick(PAYLOAD_FIELDS));
    for (const f of broken) body[f] = fieldValue(g, f);
    // Combination rules: force/cascade/abort/followUpTo/issueIdentifier interplay.
    if (g.chance(0.15)) { body.force = true; if (g.chance(0.5)) delete body.issueIdentifier; if (g.chance(0.4)) delete body.followUpTo; if (g.chance(0.3)) body.cascade = true; }
    if (g.chance(0.06)) for (const f of g.subset(EXTRA_FIELDS, 0.4)) body[f] = fieldValue(g, f);
    meta.broken = broken;
    if (mode === 'proxy') body = { $proxyReads: body };
  }
  return {
    calls: [{ mod: 'validation', fn: 'validateDispatchPayload', args: body === '__absent__' ? [] : [body] }],
    meta
  };
}

/** One call to a small validation export (or isFilePointerPilotEnabled / regex). */
export function genSmallInput(seed, i) {
  const g = rngFor(seed, 'gen-vx', i);
  const anyVal = () => g.weighted([[3, U], [3, null], [4, 'x'], [2, g.pick(UUIDS)], [2, g.pick(BAD_UUIDS)], [2, g.pick(UNICODE)], [2, g.pick(CONTROL)], [2, g.pick(NONSTRING)], [1, 'a'.repeat(g.pick([127, 128, 129, 200, 201, 999, 1000, 1001]))], [1, '__meta__'], [1, true], [1, false], [1, '']]);
  const which = g.pick(['opaque', 'opaque', 'opaque', 'session', 'session', 'abortFollowUp', 'abortTo', 'cascade', 'kind', 'periodical', 'variant', 'target', 'followUp', 'pilot', 'pilotEnv', 'regex']);
  const v = (fnName, args, env) => ({ calls: [{ mod: 'validation', fn: fnName, args }], env, meta: { which } });
  switch (which) {
    case 'opaque': {
      const opts = g.weighted([[3, '__absent__'], [2, U], [3, {}], [3, { maxLength: g.pick([0, 1, 5, 128, 200, 1000]) }], [2, { reportReceivedLength: true }], [2, { maxLength: g.pick([3, 10]), reportReceivedLength: g.pick([true, false, 1]) }], [1, null], [1, { maxLength: '5' }], [1, { maxLength: { $nan: 1 } }]]);
      const args = [anyVal(), g.pick(['model', 'harness', 'repo', 'composedRunMarker', '', U, 7])];
      if (opts !== '__absent__') args.push(opts);
      if (g.chance(0.05)) args.length = 1;
      return v('validateOpaqueDispatchField', args);
    }
    case 'session': return v('validateSessionId', g.chance(0.05) ? [] : [anyVal()]);
    case 'abortFollowUp': return v('abortFollowUpError', [g.chance(0.05) ? U : { isAbort: g.pick([true, false, 1, U]), followUpTo: anyVal() }]);
    case 'abortTo': return v('abortToError', [g.chance(0.05) ? U : { isAbort: g.pick([true, false, 1, 'yes', U]), abortTo: anyVal() }]);
    case 'cascade': return v('cascadeAbortError', [{ isAbort: g.pick([true, false, 1, U, null]), cascade: g.pick([true, false, 'true', 1, U, null]) }]);
    case 'kind': return v('dispatchKindError', g.chance(0.05) ? [] : [g.pick([...KINDS, 'Implementation', '', null, U, 5, 'custom ', ['custom']])]);
    case 'periodical': return v('periodicalIdError', [g.pick([...PERIODICALS, 'nope', '', null, U, 3, ['code-quality']])]);
    case 'variant': return v('isValidAutopilotVariant', [g.pick(['standard', 'stepper', 'Standard', '', null, U, 1])]);
    case 'target': {
      const allowed = g.weighted([[4, ['cli', 'web', 'dash', 'local']], [4, ['cli', 'web', 'dash']], [1, []], [1, ['x']], [1, U], [1, 'cli,web']]);
      const args = [g.pick([...TARGETS, 'CLI', '', null, U, 5, ['cli']])];
      if (allowed !== U || g.chance(0.5)) args.push(allowed);
      return v('targetError', args);
    }
    case 'followUp': return v('followUpToError', [g.chance(0.04) ? U : { followUpTo: anyVal(), target: g.pick([U, null, '', 'cli', 'web', 'dash', 'local', 'CLI', 0]) }]);
    case 'pilot': {
      const val = g.pick(['1', 'true', 'on', 'yes', 'TRUE', ' Yes ', '0', 'false', 'no', '', 'off', 'y', 1, true, null, U, '  on\n']);
      const env = g.weighted([[6, { HARBOUR_FILE_POINTER_PILOT: val }], [1, {}], [1, null], [1, U], [1, 'str']]);
      return { calls: [{ mod: 'factory', fn: 'isFilePointerPilotEnabled', args: [env] }], meta: { which } };
    }
    case 'pilotEnv': {
      const val = g.pick(['1', 'true', 'on', 'yes', 'TRUE', '0', 'no', '', ' yes ']);
      return { calls: [{ mod: 'factory', fn: 'isFilePointerPilotEnabled', args: [] }], env: g.chance(0.8) ? { HARBOUR_FILE_POINTER_PILOT: val } : {}, meta: { which } };
    }
    case 'regex': {
      const name = g.pick(['UUID_REGEX', 'DANGEROUS_CHARS_REGEX', 'STRICT_CONTROL_CHARS_REGEX']);
      // Three calls on the same regex object: a stateful (/g or /y) rebuild diverges.
      const calls = [0, 1, 2].map(() => ({ mod: 'validation', fn: name, method: 'test', args: [anyVal()] }));
      return { calls, meta: { which, name } };
    }
    default: throw new Error(which);
  }
}

/** Targeted validation edge cases (hand-written from reading the code). */
export function validationEdges() {
  const E = [];
  const P = (name, body, env) => E.push({ name, calls: [{ mod: 'validation', fn: 'validateDispatchPayload', args: body === '__absent__' ? [] : [body] }], env });
  P('no-arg', '__absent__');
  P('undefined-body', U);
  P('null-body', null);
  P('empty', {});
  for (const [f, cap] of Object.entries(CAPS)) {
    if (f === 'sessionId') continue;
    const mk = (n, ch = 'a') => (cap >= 1000000 ? big(n, ch) : ch.repeat(n));
    P(`${f}-at-cap`, { [f]: mk(cap) });
    P(`${f}-over-cap`, { [f]: mk(cap + 1) });
    P(`${f}-control`, { [f]: 'x\x00y' });
    P(`${f}-tab-newline`, { [f]: 'x\t\n\ry' });
    P(`${f}-number`, { [f]: 12345 });
    P(`${f}-array-over`, { [f]: Array.from({ length: Math.min(cap + 1, 1001) }, () => 'a') });
    P(`${f}-len-object`, { [f]: { length: cap + 1 } });
    P(`${f}-toString-control`, { [f]: ['a\x00'] });
  }
  P('symbol-prompt', { prompt: { $sym: 's' } });
  P('symbol-model', { model: { $sym: 's' } });
  P('bigint-repo', { repo: { $big: '99' } });
  P('effort-unknown-warns', { effort: 'turbo' });
  for (const e of ['low', 'medium', 'high', 'xhigh', 'max', 'MAX', '']) P(`effort-${e || 'empty'}`, { effort: e });
  P('model-zero', { model: 0 });
  P('model-false', { model: false });
  P('harness-empty', { harness: '' });
  P('terminal-bell', { terminal: '\x07bell' });
  P('issueId-number', { issueId: 20 });
  P('issueId-github', { issueId: '20' });
  P('issueId-101', { issueId: 'a'.repeat(101) });
  P('issueId-hash', { issueId: '#' });
  for (const t of [undefined, null, '', 'cli', 'web', 'dash', 'local']) P(`followUp-target-${t}`, { followUpTo: UUIDS[0], ...(t === undefined ? {} : { target: t }) });
  P('followUp-empty-string', { followUpTo: '' });
  P('followUp-upper', { followUpTo: UUIDS[1] });
  P('followUp-number', { followUpTo: 5 });
  P('force-null', { force: null });
  P('force-string', { force: 'true' });
  P('force-cascade', { force: true, cascade: true, issueIdentifier: 'LIN-1' });
  P('force-bare', { force: true });
  P('force-issue', { force: true, issueIdentifier: 'LIN-1' });
  P('force-abort', { force: true, abort: true });
  P('force-followup', { force: true, followUpTo: UUIDS[0] });
  P('force-followup-null', { force: true, followUpTo: null });
  P('force-abort-string', { force: true, abort: 'true' });
  P('force-false-cascade', { force: false, cascade: true });
  for (const v of [true, null, 0, '', 'false', false]) P(`ifParked-${String(v)}`, { ifParked: v });
  P('ifParked-and-session', { ifParked: true, sessionId: '' });
  for (const s of ['', '__meta__', 'a'.repeat(128), 'a'.repeat(129), 'x\ty', 'x\x00y', 'x\ny', 'ws:1:2', '__META__', 5]) P(`sessionId-${JSON.stringify(s).slice(0, 20)}`, { sessionId: s });
  P('order-prompt-before-model', { prompt: 'x\x00', model: 5 });
  P('order-length-before-chars', { prompt: 'x\x00', promptName: 'y'.repeat(1001) });
  P('order-model-before-prompt-chars', { prompt: 'a\x00', model: 'm\x00' });
  P('order-issueId-before-followUp', { issueId: 'bad id', followUpTo: 'bad' });
  P('order-followUp-before-force', { followUpTo: 'bad', force: 'x' });
  P('order-force-before-ifParked', { force: 1, ifParked: true });
  P('order-ifParked-before-session', { ifParked: true, sessionId: '__meta__' });
  P('order-effort-before-control', { effort: 5, prompt: '\x00' });
  P('order-harness-before-terminal', { harness: 1, terminal: 1 });
  P('proxy-reads', { $proxyReads: { prompt: 'p', model: 'm', unknown: 1 } });
  P('getter-throws', { $obj: { props: { prompt: 'p' } } });
  P('frozen-body', { $frozen: { prompt: 'x', effort: 'weird' } });
  P('array-body', ['prompt']);
  P('string-body', 'just a string');
  P('extra-fields', { prompt: 'x', unknownA: 1, __proto: 2, abortTo: 'nope', kind: 'zzz' });
  // Small exports.
  const C = (name, mod, fnName, args, env) => E.push({ name, calls: [{ mod, fn: fnName, args }], env });
  C('opaque-null-options', 'validation', 'validateOpaqueDispatchField', ['x', 'f', null]);
  C('opaque-report-len', 'validation', 'validateOpaqueDispatchField', ['abcdef', 'repo', { maxLength: 3, reportReceivedLength: true }]);
  C('opaque-report-len-truthy', 'validation', 'validateOpaqueDispatchField', ['abcdef', 'repo', { maxLength: 3, reportReceivedLength: 1 }]);
  C('opaque-maxlen-0-empty', 'validation', 'validateOpaqueDispatchField', ['', 'm', { maxLength: 0 }]);
  C('opaque-maxlen-string', 'validation', 'validateOpaqueDispatchField', ['abcdef', 'm', { maxLength: '3' }]);
  C('opaque-no-name', 'validation', 'validateOpaqueDispatchField', [5]);
  C('opaque-1000', 'validation', 'validateOpaqueDispatchField', ['a'.repeat(1000), 'model']);
  C('opaque-1001', 'validation', 'validateOpaqueDispatchField', ['a'.repeat(1001), 'model']);
  C('session-no-arg', 'validation', 'validateSessionId', []);
  C('abortTo-abort-valid', 'validation', 'abortToError', [{ isAbort: true, abortTo: UUIDS[0] }]);
  C('abortTo-abort-missing', 'validation', 'abortToError', [{ isAbort: true }]);
  C('abortTo-noabort-null', 'validation', 'abortToError', [{ isAbort: false, abortTo: null }]);
  C('abortTo-noabort-present', 'validation', 'abortToError', [{ isAbort: false, abortTo: '' }]);
  C('abortTo-undefined-arg', 'validation', 'abortToError', [U]);
  C('abortFollowUp-both', 'validation', 'abortFollowUpError', [{ isAbort: true, followUpTo: '' }]);
  C('abortFollowUp-null', 'validation', 'abortFollowUpError', [{ isAbort: true, followUpTo: null }]);
  C('cascade-noabort', 'validation', 'cascadeAbortError', [{ isAbort: false, cascade: true }]);
  C('cascade-truthy', 'validation', 'cascadeAbortError', [{ isAbort: 0, cascade: 'true' }]);
  C('kind-null', 'validation', 'dispatchKindError', [null]);
  C('kind-absent', 'validation', 'dispatchKindError', []);
  C('periodical-null', 'validation', 'periodicalIdError', [null]);
  C('target-null-polled', 'validation', 'targetError', [null, ['cli', 'web', 'dash']]);
  C('target-undefined-no-allowed', 'validation', 'targetError', [U]);
  C('target-local-no-allowed', 'validation', 'targetError', ['local']);
  C('followUp-dash', 'validation', 'followUpToError', [{ followUpTo: UUIDS[0], target: 'dash' }]);
  C('followUp-empty-target', 'validation', 'followUpToError', [{ followUpTo: UUIDS[0], target: '' }]);
  C('followUp-no-arg', 'validation', 'followUpToError', []);
  C('pilot-no-env-arg', 'factory', 'isFilePointerPilotEnabled', [], { HARBOUR_FILE_POINTER_PILOT: 'on' });
  C('pilot-null-env', 'factory', 'isFilePointerPilotEnabled', [null]);
  C('pilot-number', 'factory', 'isFilePointerPilotEnabled', [{ HARBOUR_FILE_POINTER_PILOT: 1 }]);
  C('pilot-padded', 'factory', 'isFilePointerPilotEnabled', [{ HARBOUR_FILE_POINTER_PILOT: '  YES  ' }]);
  C('pilot-fn-env', 'factory', 'isFilePointerPilotEnabled', [fn('env', { k: 'ret', v: 1 })]);
  return E;
}
