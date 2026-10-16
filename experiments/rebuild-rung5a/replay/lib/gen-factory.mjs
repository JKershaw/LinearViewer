// Generated + targeted inputs for createDispatchItem. Each input is a pure-data
// spec: the params object (with recording fakes for every store/closure, see
// world.mjs) plus env. Profiles stratify the stream so every guard and every
// resolution tier is hit many times; noise is layered on top.
import { rngFor, U, res, ret, rej, thr, hang, seq, fn, obj, date, big, UUIDS, UNICODE, CONTROL } from './gen-common.mjs';
import { DEFAULT_NOW } from './hermetic.mjs';

export const NOW_MS = Date.parse(DEFAULT_NOW);
const iso = (ms) => new Date(ms).toISOString();
const WINDOW = 5 * 60 * 1000;

const KINDS = ['blocked', 'bug', 'plan', 'look-into', 'triage', 'breakdown', 'research', 'scoping', 'design', 'spike', 'context', 'plan-review', 'implementation', 'review', 'close-out', 'retrospective-audit', 'retro', 'autopilot', 'defer', 'periodical', 'custom', 'wake'];
const PROMPT_NAMES = ['implementation', 'Implement', 'implement', ' Implementation ', 'review', 'close out', 'Close-Out', 'close_out', 'look into', 'autopilot', 'retro', 'Prompt', 'custom', 'defer', 'periodical', 'plan review', 'plan-review', 'something else', ''];
const HARNESSES = ['claude-code', 'opencode', 'codex', '   ', '', 'Claude-Code'];
const MODELS = ['claude-opus-4', 'deepseek/deepseek-v4-pro', 'gpt-x', ''];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'weird', ''];
const TERMINAL_STATES = ['completed', 'canceled', 'duplicate'];
const OPEN_STATES = ['started', 'unstarted', 'backlog', 'triage', 'Completed'];

// ── value pools ───────────────────────────────────────────────────────────────
function routingConfig(g, { allowGarbage = true } = {}) {
  if (allowGarbage && g.chance(0.06)) return g.pick([null, U, 'str', 5, [], { byKind: 'x' }, { byKind: { implementation: null } }]);
  const row = () => {
    const r = {};
    if (g.chance(0.55)) r.model = g.pick([...MODELS, null]);
    if (g.chance(0.55)) r.harness = g.pick([...HARNESSES, null]);
    if (g.chance(0.45)) r.effort = g.pick([...EFFORTS, null]);
    return r;
  };
  const cfg = row();
  if (g.chance(0.6)) {
    cfg.byKind = {};
    for (const k of g.subset(['implementation', 'review', 'close-out', 'autopilot', 'plan', 'custom', 'periodical', 'wake'], 0.35)) cfg.byKind[k] = row();
  }
  if (g.chance(0.04)) cfg.extra = fn('cfg.fn', ret(1)); // a function in a config: structuredClone throws
  if (g.chance(0.05)) cfg.when = date(iso(NOW_MS - 1000));
  return cfg;
}

function fieldsSpec(g, { issue = g.chance(0.7), followUp = g.chance(0.25), session = g.chance(0.3) } = {}) {
  const f = {};
  if (g.chance(0.85)) f.promptName = g.pick(g.chance(0.95) ? PROMPT_NAMES : [5, null, ['implementation']]);
  if (issue) f.issueIdentifier = g.pick(['LIN-1', 'LIN-2', 'ACME-42', '#20', '日本-1', 'x'.repeat(100)]);
  if (g.chance(0.4)) f.issueId = g.pick(['abc-123', '20', UUIDS[0], null]);
  if (g.chance(0.3)) f.issueTitle = g.pick(['Title', null, UNICODE[0]]);
  if (g.chance(0.3)) f.issueUrl = g.pick(['https://linear.app/acme/issue/LIN-1', null]);
  if (g.chance(0.4)) f.dispatchedBy = g.pick(['acct-1', null]);
  if (g.chance(0.6)) f.target = g.pick(['cli', 'web', 'dash', 'local']);
  if (g.chance(0.3)) f.repo = g.pick(['owner/repo', null]);
  f.followUpTo = followUp ? g.pick(UUIDS) : g.pick([null, null, U, '__absent__']);
  if (f.followUpTo === '__absent__') delete f.followUpTo;
  if (g.chance(0.5)) f.force = g.weighted([[6, false], [3, true], [1, 'true']]);
  if (g.chance(0.5)) f.abort = g.weighted([[7, false], [2, true], [1, 1]]);
  if (f.abort === true && g.chance(0.7)) f.abortTo = UUIDS[2];
  if (g.chance(0.4)) f.cascade = g.weighted([[6, false], [2, true], [1, 'yes']]);
  f.sessionId = session ? g.pick(['run-1', 'LIN-1117-autopilot-standalone', UUIDS[3]]) : g.pick([null, U, '__absent__', '']);
  if (f.sessionId === '__absent__') delete f.sessionId;
  if (g.chance(0.2)) f.periodicalId = g.pick(['code-quality', null]);
  if (g.chance(0.3)) f.waitForFollowUps = g.pick([true, false]);
  if (g.chance(0.3)) f.queueIfBusy = g.pick([true, false]);
  if (g.chance(0.3)) f.subscription = g.pick(['terminal-only', 'everything']);
  if (g.chance(0.3)) f.maxTasks = g.pick([null, 1, 3]);
  if (g.chance(0.3)) f.stopAt = g.pick([null, 'pr']);
  if (g.chance(0.2)) f.variant = g.pick([null, 'standard', 'stepper']);
  if (g.chance(0.3)) f.issueSource = g.pick([null, 'github', 'linear', { kind: 'jira' }]);
  if (g.chance(0.06)) f.grantDeclaration = { declaredGrants: ['dispatch'], site: 'injected' };
  if (g.chance(0.06)) f.grantRefusal = { code: 'injected' };
  if (g.chance(0.05)) f.sessionGroupId = 'caller-group';
  if (g.chance(0.05)) f.rootItemId = 'caller-root';
  if (g.chance(0.04)) f.prompt = 'fields.prompt overridden?';
  if (g.chance(0.04)) f.kind = 'fields-kind';
  if (g.chance(0.04)) f.model = 'fields-model';
  if (g.chance(0.04)) f.bootstrapToken = 'caller-token';
  if (g.chance(0.04)) f.presetConfig = { model: 'caller-preset' };
  if (g.chance(0.03)) f.stopAt = 'later';
  if (g.chance(0.03)) f['unknown🚀'] = g.pick(CONTROL);
  if (g.chance(0.02)) f.big = big(5000);
  return f;
}

function anchorRow(g, { issue = g.chance(0.7) } = {}) {
  const a = { id: UUIDS[0] };
  if (issue) { a.issueIdentifier = g.pick(['LIN-1', 'LIN-9']); if (g.chance(0.7)) a.issueId = g.pick(['abc-123', 'anchor-id']); if (g.chance(0.6)) a.issueTitle = 'Anchor title'; if (g.chance(0.6)) a.issueUrl = 'https://linear.app/a/LIN-9'; }
  if (g.chance(0.5)) a.issueSource = g.pick(['github', 'linear', '', { kind: 'k' }]);
  if (g.chance(0.45)) a.presetConfig = routingConfig(g, { allowGarbage: false });
  if (g.chance(0.4)) a.presetName = g.pick(['Anchor preset', '', null]);
  if (g.chance(0.5)) a.harness = g.pick([...HARNESSES, null]);
  if (g.chance(0.5)) a.sessionGroupId = g.pick(['grp-1', '', null]);
  if (g.chance(0.4)) a.sessionId = g.pick(['anchor-session', null]);
  if (g.chance(0.5)) a.rootItemId = g.pick(['root-1', '', null]);
  if (g.chance(0.1)) a.grantDeclaration = { declaredGrants: ['dispatch'], site: 'anchor' };
  if (g.chance(0.2)) { a.maxTasks = g.pick([1, 2, 0, '3']); }
  if (g.chance(0.2)) a.stopAt = g.pick(['pr', null, 'other']);
  return a;
}

function runRow(g) {
  if (g.chance(0.1)) return g.pick([null, U, 'str']);
  const r = { id: 'run-row' };
  if (g.chance(0.7)) r.maxTasks = g.weighted([[5, g.int(1, 4)], [1, 0], [1, -1], [1, '2'], [1, 1.5], [1, null]]);
  if (g.chance(0.5)) r.stopAt = g.pick(['pr', 'pr', null, 'merge']);
  return r;
}

function scriptPick(g, options) { return g.weighted(options); }

// ── store builder ─────────────────────────────────────────────────────────────
function storeSpec(g, want) {
  const props = {};
  props.addItem = fn('store.addItem', g.weighted([[90, { k: 'echo' }], [3, { k: 'echoFrozen' }], [2, { k: 'echoNull' }], [2, { k: 'echoSame' }], [2, rej('insert failed')], [1, thr('addItem sync throw')]]));
  if (want.find) props.findRecentFreshDispatch = fn('store.findRecentFreshDispatch', want.find);
  if (want.count) props.countDistinctTasksForSession = fn('store.countDistinctTasksForSession', want.count);
  if (want.status) props.getItemStatus = fn('store.getItemStatus', want.status);
  if (want.pilot) props.countPilotEligible = fn('store.countPilotEligible', want.pilot);
  if (want.history) props.listHistory = fn('store.listHistory', want.history);
  if (want.items) props.listItems = fn('store.listItems', want.items);
  for (const k of want.nonFn || []) props[k] = 'not-a-function';
  return obj('store', props);
}

function priorDispatch(g) {
  const at = g.weighted([
    [5, date(iso(NOW_MS - g.int(1, WINDOW - 1)))],
    [2, date(iso(NOW_MS - WINDOW))],
    [2, date(iso(NOW_MS + g.int(1, 3600000)))],
    [2, iso(NOW_MS - 61000)],
    [1, NOW_MS - 1000],
    [2, date('invalid')],
    [1, 'garbage'],
    [1, null],
    [1, U]
  ]);
  const p = { id: g.pick(['prior-1', UUIDS[1], U]), dispatchedAt: at };
  if (g.chance(0.2)) p.kind = 'implementation';
  return p;
}

function findScript(g) {
  return g.weighted([[4, res(null)], [8, res(priorDispatch(g))], [1, rej('lookup failed')], [1, thr('sync lookup throw')], [1, ret(priorDispatch(g))], [1, res(U)], [0.5, res(false)]]);
}

function countScript(g) {
  const r = () => ({ count: g.int(0, 5), alreadyCounted: g.pick([true, false, U]), taskDispatches: g.weighted([[6, g.int(0, 5)], [2, 29], [2, 30], [1, 31], [1, U]]) });
  return g.weighted([[10, res(r())], [2, rej('count failed')], [1, res(null)], [1, res(U)], [1, ret(r())], [0.5, thr('sync count')]]);
}

function statusScript(g, { anchorId, sessionId }) {
  const map = {};
  if (anchorId) map[anchorId] = g.weighted([[8, res(anchorRow(g))], [1, res(null)], [1, rej('anchor read failed')], [0.5, ret(anchorRow(g))], [0.3, thr('anchor sync')]]);
  if (sessionId) map[sessionId] = g.weighted([[8, res(runRow(g))], [1, res(null)], [1, rej('run read failed')], [0.5, ret(runRow(g))], [0.3, thr('run sync')]]);
  return { k: 'byArg', index: 1, map, default: res(null) };
}

function runGateScript(g) {
  const resetsAt = g.weighted([[6, iso(NOW_MS + g.int(1, 43200) * 1000)], [1, iso(NOW_MS - 5000)], [1, 'not a date'], [1, null], [1, U]]);
  return g.weighted([
    [4, res({ allowed: true })],
    [4, res({ allowed: false, reason: 'limit', runsUsed: g.int(0, 12), limit: g.pick([10, 3, U]), remaining: 0, resetsAt })],
    [2, res({ allowed: false, reason: 'unverified', resetsAt, limit: g.pick([10, U, null]) })],
    [1, res({ allowed: false, reason: 'other' })],
    [1, res({ allowed: 'true' })],
    [1, res(null)],
    [1, rej('gate failed')],
    [1, thr('gate sync throw')],
    [1, ret({ allowed: true })],
    [0.5, ret({ allowed: false, reason: 'limit', runsUsed: 1, limit: 1, resetsAt })]
  ]);
}

function finalizeSpec(g) {
  return g.weighted([
    [5, fn('finalizePrompt', res({ prompt: 'FINAL PROMPT', bootstrapToken: g.pick(['tok-1', null, U]) }))],
    [2, fn('finalizePrompt', res({ prompt: 'FINAL', grantDeclaration: g.pick([{ declaredGrants: ['dispatch'], site: 'M2' }, null, U, false, 0]) }))],
    [1, fn('finalizePrompt', res(null))],
    [1, fn('finalizePrompt', res(U))],
    [1, fn('finalizePrompt', res('a bare string'))],
    [1, fn('finalizePrompt', ret({ prompt: 'SYNC FINAL', bootstrapToken: 'sync-tok' }))],
    [1, fn('finalizePrompt', rej('mint failed', 'Error', { proxyAttachFailed: true }))],
    [0.5, fn('finalizePrompt', thr('finalize sync throw'))],
    [0.5, 'not a function'],
    [0.5, null]
  ]);
}

function tokenStore(g, name, { grants }) {
  const tok = () => ({ lastUsedAt: g.weighted([[4, date(iso(NOW_MS - g.int(1, 3600000)))], [2, iso(NOW_MS - g.int(1, 99999999))], [1, NOW_MS - 5], [1, null], [1, 'bad'], [1, date('invalid')]]), ...(grants ? { grants: g.pick([['take'], ['read'], ['take', 'dispatch'], 'take', U]) } : {}) });
  const tokens = Array.from({ length: g.int(0, 3) }, tok);
  return obj(name, { listTokens: fn(`${name}.listTokens`, g.weighted([[8, res(tokens)], [1, rej('list failed')], [1, res(null)], [0.5, ret(tokens)]])) });
}

const PLAN = [
  '## Implementation Plan\n- lib/dispatch-factory.js\n- `routes/dispatch.js:120`\n- tests/unit/x.test.js,\n## Next\n- not/this.js',
  'Intro\n## Implementation Plan (rev 2)\nTouch lib/a.js and lib/b.mjs. Also https://x.y/z.js\n',
  'no plan heading here lib/a.js',
  '## Implementation Plan\n' + Array.from({ length: 40 }, (_, i) => `- lib/very/long/path/number-${i}/file-${i}.js`).join('\n'),
  '## Implementation Plan\n'
];

function pilotSpec(g, a, want, env) {
  const small = g.weighted([[6, { count: 5, plan: 5, step: 60 }], [2, { count: 5, plan: 40, step: 5 }], [2, null], [1, { count: -1, plan: 'x', step: { $nan: 1 } }]]);
  const hangsOk = small && small.count === 5;
  if (small !== null) a.filePointerTimeouts = small;
  a.filePointerEnabled = g.weighted([[6, true], [2, U], [1, false], [1, 'true'], [0.5, 1]]);
  if (a.filePointerEnabled === U) { delete a.filePointerEnabled; env.HARBOUR_FILE_POINTER_PILOT = g.pick(['1', 'true', 'on', 'yes', 'no', '']); }
  const countR = () => g.weighted([[6, res(g.int(0, 5))], [1, res(null)], [1, res('2')], [1, res(2.5)], [1, rej('count failed')], [0.5, thr('count sync')], ...(hangsOk ? [[1, hang()]] : [])]);
  want.pilot = g.chance(0.95) ? seq([countR(), countR()], countR()) : undefined;
  if (g.chance(0.7)) a.readPlanBlock = fn('readPlanBlock', g.weighted([[6, res(g.pick(PLAN))], [1, res(null)], [1, rej('plan read failed')], [0.5, thr('plan sync')], ...(hangsOk ? [[1, hang()]] : [])]));
  else if (g.chance(0.3)) a.readPlanBlock = g.pick([null, 'nope']);
  const owners = g.weighted([[4, { $set: ['acme'] }], [1, { $set: [] }], [1, ['acme']], [3, '__absent__']]);
  if (owners !== '__absent__') a.filePointerOwners = owners;
  if (g.chance(0.6)) env.HARBOUR_FILE_POINTER_GITHUB_OWNERS = g.pick(['acme', 'acme, other', '', 'bad owner!,acme']);
  if (g.chance(0.45)) {
    a.fetchPilotPrFiles = fn('fetchPilotPrFiles', g.weighted([[5, res([{ repo: 'repo', path: 'src/x.js' }, { repo: 'repo', path: 'src/x.js' }, { repo: 'bad repo!', path: 'a.js' }, { repo: 'r2', path: '/abs/no.js' }])], [1, res([])], [1, res(null)], [1, rej('pr read failed')], ...(hangsOk ? [[1, hang()]] : [])]));
  } else {
    // Default PR reader: store.listHistory / listItems feedback → [evidence] PR URLs → doFetch.
    const fb = () => ({
      feedback: g.chance(0.8) ? [
        { message: `[evidence] PR · https://github.com/${g.pick(['acme', 'other', 'acme'])}/repo/pull/${g.int(1, 40)}`, timestamp: iso(NOW_MS - g.int(1, 9e6)) },
        { message: '[evidence] https://github.com/acme/repo/pull/7 · 3 mentions', url: 'https://github.com/acme/repo/pull/7' },
        { message: 'not evidence https://github.com/acme/repo/pull/8' }
      ] : 'not-an-array'
    });
    if (g.chance(0.85)) want.history = g.weighted([[6, res({ items: [fb(), fb()] })], [1, res(null)], [1, rej('history failed')], [0.5, res({ items: 'x' })]]);
    if (g.chance(0.85)) want.items = g.weighted([[6, res([fb()])], [1, res(null)], [1, rej('items failed')]]);
    const resp = (body, ok = true, status = 200) => obj('fetchResponse', { ok, status, json: fn('fetchResponse.json', res(body)) });
    if (g.chance(0.8)) {
      a.filePointerDoFetch = fn('filePointerDoFetch', g.weighted([
        [6, seq([res(resp({ state: g.pick(['open', 'closed']), merged_at: g.pick([null, iso(NOW_MS - 1)]) })), res(resp([{ filename: 'lib/changed.js' }, { filename: '' }, { filename: 'src/other.ts' }]))], res(resp([{ filename: 'lib/z.js' }])))],
        [1, res(resp(null, false, 404))],
        [1, rej('network down')],
        [1, res(null)]
      ]));
    } else if (g.chance(0.5)) a.filePointerDoFetch = 'not-a-function'; // falls back to the guarded globalThis.fetch
  }
}

const PROFILES = [[10, 'dup'], [8, 'runGate'], [10, 'budget'], [5, 'closeOut'], [9, 'marker'], [10, 'anchor'], [12, 'routing'], [6, 'finalize'], [4, 'consumer'], [10, 'pilot'], [8, 'free'], [3, 'args'], [5, 'seq']];

/** One createDispatchItem input. */
export function genFactoryInput(seed, i) {
  const g = rngFor(seed, 'gen-f', i);
  const profile = g.weighted(PROFILES);
  const env = {};
  const shared = {};
  const meta = { profile };
  const want = {};
  const P = profile;
  const a = {};

  // Base: urlKey, kind, prompt, fields.
  a.urlKey = g.weighted([[30, 'acme'], [3, `ws-${i}`], [1, 'ünï-ws'], [0.5, '']]);
  const followUp = P === 'anchor' ? g.chance(0.9) : P === 'dup' || P === 'budget' || P === 'runGate' ? g.chance(0.12) : g.chance(0.2);
  const session = P === 'budget' || P === 'closeOut' ? g.chance(0.92) : P === 'runGate' ? g.chance(0.25) : g.chance(0.3);
  const issue = P === 'dup' || P === 'budget' || P === 'marker' || P === 'pilot' ? g.chance(0.93) : P === 'anchor' ? g.chance(0.4) : g.chance(0.7);
  const fields = fieldsSpec(g, { issue, followUp, session });
  if (P === 'dup' || P === 'pilot') { if (g.chance(0.8)) fields.abort = false; if (g.chance(0.7)) fields.force = g.chance(0.15); }
  if (P === 'budget' && g.chance(0.85)) fields.abort = false;
  if (P === 'runGate' && g.chance(0.7)) { fields.abort = false; fields.cascade = false; if (g.chance(0.7)) delete fields.sessionId; }

  if (P === 'closeOut') a.kind = g.weighted([[7, 'close-out'], [1, U], [1, 'review']]);
  else if (P === 'pilot') a.kind = g.weighted([[8, 'implementation'], [1, U], [1, 'review']]);
  else if (P === 'runGate') a.kind = g.weighted([[3, U], [1, 'wake'], [2, 'implementation']]);
  else if (P === 'anchor' || P === 'routing') a.kind = g.weighted([[3, U], [2, 'autopilot'], [2, g.pick(KINDS)]]);
  else a.kind = g.weighted([[6, U], [4, g.pick(KINDS)], [0.3, ''], [0.2, 5]]);
  if (a.kind === U) delete a.kind;
  if (P === 'closeOut' && a.kind === undefined) fields.promptName = 'close out';
  if (P === 'pilot' && a.kind === undefined) fields.promptName = 'Implement';

  if (g.chance(0.6)) a.prompt = g.weighted([[8, 'BODY'], [1, ''], [1, 5], [0.5, big(20000)], [0.5, g.pick(UNICODE)]]);
  if (g.chance(0.4)) a.model = g.pick([...MODELS, null, 5]);
  if (g.chance(0.4)) a.harness = g.pick([...HARNESSES, null, 7]);
  if (g.chance(0.3)) a.effort = g.pick([...EFFORTS, null]);
  if (g.chance(0.25)) a.terminal = g.pick(['kitty', '', null, 0, 'wezterm']);
  if (g.chance(0.4)) a.applyDefaultHarness = g.weighted([[5, false], [3, true], [1, 0], [1, 'no']]);
  if (g.chance(0.35) || P === 'finalize') { const f = finalizeSpec(g); if (f !== null || g.chance(0.5)) a.finalizePrompt = f; }
  if (g.chance(0.3)) a.now = g.weighted([[4, NOW_MS + g.int(-600000, 600000)], [2, date(iso(NOW_MS + g.int(-1000, 1000)))], [2, fn('now', ret(NOW_MS - g.int(0, 400000)))], [1, iso(NOW_MS)], [1, { $nan: 1 }], [1, 'garbage'], [0.5, null]]);

  // Guards / reads per profile (+ low-probability noise from every other profile).
  const noise = (p) => g.chance(p);
  if (P === 'dup' || noise(0.15)) want.find = findScript(g);
  if (P === 'runGate' || noise(0.12)) a.runGate = fn('runGate', runGateScript(g));
  if (P === 'budget' || noise(0.15)) want.count = countScript(g);
  if (P === 'budget' || P === 'closeOut' || P === 'anchor' || noise(0.25) || (fields.sessionId && g.chance(0.5))) {
    want.status = statusScript(g, { anchorId: fields.followUpTo || null, sessionId: fields.sessionId || null });
    if (P === 'closeOut' && fields.sessionId && g.chance(0.8)) want.status.map[fields.sessionId] = res({ id: 'run', stopAt: g.weighted([[6, 'pr'], [1, null], [1, 'other']]), ...(g.chance(0.3) ? { maxTasks: 3 } : {}) });
  }
  if (P === 'marker' || noise(0.06)) {
    a.composedRunMarker = g.weighted([[10, 'Real agent brief'], [1, null], [1, ''], [1, 'x'.repeat(200)], [1, 'y'.repeat(201)], [1, 'nul\x00'], [1, 'tab\tok'], [1, 5], [0.5, {}], [0.5, g.pick(UNICODE)], [0.5, U]]);
    if (a.composedRunMarker === U) delete a.composedRunMarker;
    if (g.chance(0.85)) a.getWorkspaceAccessToken = fn('getWorkspaceAccessToken', g.weighted([[7, res('tok')], [1, res(null)], [1, res('')], [1, rej('token failed')], [0.5, thr('token sync')]]));
    if (g.chance(0.85)) a.fetchIssueContext = fn('fetchIssueContext', g.weighted([
      [4, res({ issue: { state: { type: g.pick(TERMINAL_STATES) } } })],
      [4, res({ issue: { state: { type: g.pick(OPEN_STATES) } } })],
      [1, res({ state: { type: 'completed' } })],
      [1, res({ issue: {} })], [1, res(null)], [1, rej('provider error')], [0.5, res({ issue: { state: 'completed' } })]
    ]));
    const cache = g.weighted([[3, '__absent__'], [3, { $realCache: { name: 'guardTaskDoneCache' } }], [2, obj('guardTaskDoneCache', { get: fn('guardTaskDoneCache.get', { k: 'callProducer', bool: g.chance(0.5) }) })], [1, obj('guardTaskDoneCache', { get: fn('guardTaskDoneCache.get', g.pick([res(true), res(false), res(1), rej('cache failed')])) })]]);
    if (cache !== '__absent__') a.guardTaskDoneCache = cache;
    else if (typeof a.urlKey === 'string' && a.urlKey) a.urlKey = `${a.urlKey}-u${i}`; // singleton cache: keep inputs independent
  }
  if (P === 'routing' || P === 'anchor' || noise(0.25)) {
    if (g.chance(0.6)) a.workspacePreferencesStore = obj('workspacePreferencesStore', { getWorkspacePreferences: fn('workspacePreferencesStore.getWorkspacePreferences', g.weighted([[8, res({ dispatchDefaults: routingConfig(g) })], [1, res({})], [0.5, res(null)], [0.5, rej('prefs failed')]])) });
    if (g.chance(0.45)) {
      a.dispatchPresetsStore = obj('dispatchPresetsStore', { get: fn('dispatchPresetsStore.get', g.weighted([[7, res({ id: 'p1', name: g.pick(['Fast', '', U]), config: routingConfig(g) })], [1, res(null)], [1, rej('preset failed')], [0.5, ret({ config: {} })]])) });
      a.presetId = g.pick(['p1', 'p1', '', null, U]);
      if (a.presetId === U) delete a.presetId;
    } else if (g.chance(0.1)) a.presetId = 'p1';
  }
  if (P === 'consumer' || noise(0.3)) {
    if (g.chance(0.7)) a.dispatchTokenStore = tokenStore(g, 'dispatchTokenStore', { grants: false });
    if (g.chance(0.6)) a.proxyTokenStore = tokenStore(g, 'proxyTokenStore', { grants: true });
  }
  if (P === 'pilot' || noise(0.05)) pilotSpec(g, a, want, env);
  if (noise(0.04)) want.nonFn = g.subset(['findRecentFreshDispatch', 'countDistinctTasksForSession', 'getItemStatus', 'countPilotEligible'], 0.5);
  if (noise(0.03)) a.unknownParam = 'ignored?';

  a.store = storeSpec(g, want);
  a.fields = fields;
  if (g.chance(0.03)) delete a.fields;

  let calls = [{ mod: 'factory', fn: 'createDispatchItem', args: [a] }];

  if (P === 'args') {
    const variant = g.pick(['none', 'undef', 'null', 'empty', 'noStore', 'storeNoAdd', 'addNotFn', 'urlKeyEmpty', 'urlKeyNull', 'urlKeyZero', 'fieldsNull', 'fieldsString', 'fieldsArray', 'fieldsNullKind', 'storeNull']);
    meta.variant = variant;
    const b = a;
    switch (variant) {
      case 'none': calls = [{ mod: 'factory', fn: 'createDispatchItem', args: [] }]; break;
      case 'undef': calls[0].args = [U]; break;
      case 'null': calls[0].args = [null]; break;
      case 'empty': calls[0].args = [{}]; break;
      case 'noStore': delete b.store; break;
      case 'storeNull': b.store = null; break;
      case 'storeNoAdd': b.store = obj('store', { getItemStatus: fn('store.getItemStatus', res(null)) }); break;
      case 'addNotFn': b.store = obj('store', { addItem: 'nope' }); break;
      case 'urlKeyEmpty': b.urlKey = ''; break;
      case 'urlKeyNull': b.urlKey = null; break;
      case 'urlKeyZero': b.urlKey = 0; break;
      case 'fieldsNull': b.fields = null; break;
      case 'fieldsString': b.fields = 'abc'; break;
      case 'fieldsArray': b.fields = ['x', 'y']; break;
      case 'fieldsNullKind': b.fields = null; b.kind = 'implementation'; break;
    }
  }

  if (P === 'seq') {
    // Two or three calls sharing one store / cache / gate: the scripted
    // responses advance across calls, and the (singleton or injected) task-done
    // cache is hit on the second call.
    const n = g.int(2, 3);
    meta.calls = n;
    const issueId = `SEQ-${i}`;
    shared.store = storeSpec(g, { ...want, find: g.chance(0.4) ? seq([res(null), res(priorDispatch(g))], res(null)) : undefined });
    const cacheChoice = g.pick(['singleton', 'real', 'singleton']);
    if (cacheChoice === 'real') shared.cache = { $realCache: { name: 'guardTaskDoneCache' } };
    shared.token = fn('getWorkspaceAccessToken', seq([res('tok'), res(null)], res('tok')));
    shared.ctx = fn('fetchIssueContext', seq([res({ issue: { state: { type: g.pick([...TERMINAL_STATES, 'started']) } } }), rej('second read')], res({ issue: { state: { type: 'started' } } })));
    calls = [];
    for (let c = 0; c < n; c++) {
      const args = {
        store: { $ref: 'store' },
        urlKey: `seq-ws-${i}`,
        kind: g.pick(['implementation', U, 'review']),
        prompt: `call ${c}`,
        composedRunMarker: g.chance(0.85) ? 'brief' : U,
        getWorkspaceAccessToken: { $ref: 'token' },
        fetchIssueContext: { $ref: 'ctx' },
        fields: { promptName: 'implementation', issueIdentifier: g.chance(0.85) ? issueId : `${issueId}-${c}`, abort: false }
      };
      if (shared.cache) args.guardTaskDoneCache = { $ref: 'cache' };
      if (args.kind === U) delete args.kind;
      calls.push({ mod: 'factory', fn: 'createDispatchItem', args: [args] });
    }
  }

  return { calls, env, shared, meta };
}

// ── targeted edge cases ───────────────────────────────────────────────────────
export function factoryEdges() {
  const E = [];
  const echo = () => obj('store', { addItem: fn('store.addItem', { k: 'echo' }) });
  const S = (props) => obj('store', { addItem: fn('store.addItem', { k: 'echo' }), ...Object.fromEntries(Object.entries(props).map(([k, v]) => [k, typeof v === 'string' ? v : fn(`store.${k}`, v)])) });
  const F = (name, params, env) => E.push({ name, calls: [{ mod: 'factory', fn: 'createDispatchItem', args: params === '__none__' ? [] : [params] }], env });
  const base = (extra = {}) => ({ store: echo(), urlKey: 'acme', prompt: 'BODY', fields: { promptName: 'implementation', issueIdentifier: 'LIN-1' }, ...extra });

  F('no-args', '__none__');
  F('null-args', null);
  F('empty', {});
  F('store-without-addItem', { store: {}, urlKey: 'acme' });
  F('urlKey-missing', { store: echo() });
  F('fields-null-kind-given', { store: echo(), urlKey: 'acme', kind: 'review', fields: null });
  F('fields-null-no-kind', { store: echo(), urlKey: 'acme', fields: null });
  F('fields-absent', { store: echo(), urlKey: 'acme' });
  F('minimal', base());
  F('applyDefaultHarness-false', base({ applyDefaultHarness: false }));
  F('harness-whitespace', base({ harness: '   ' }));
  F('harness-number', base({ harness: 5 }));
  F('harness-number-no-default', base({ harness: 5, applyDefaultHarness: false }));
  F('model-number', base({ model: 0 }));
  F('kind-wins-over-promptName', base({ kind: 'review' }));
  for (const pn of ['implement', 'Close Out', 'look_into', 'unknown', 5]) F(`derive-${pn}`, { store: echo(), urlKey: 'acme', fields: { promptName: pn } });
  // Duplicate guard.
  const prior = (at) => res({ id: 'prior-1', dispatchedAt: at });
  F('dup-hit', base({ store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS - 60000))) }) }));
  F('dup-hit-string-date', base({ store: S({ findRecentFreshDispatch: prior(iso(NOW_MS - 1000)) }) }));
  F('dup-hit-future-clamped', base({ store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS + 3600000))) }) }));
  F('dup-hit-exact-edge', base({ store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS - WINDOW))) }) }));
  F('dup-hit-1ms-left', base({ store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS - WINDOW + 1))) }) }));
  F('dup-invalid-date-admits', base({ store: S({ findRecentFreshDispatch: prior(date('invalid')) }) }));
  F('dup-null-date-epoch', base({ store: S({ findRecentFreshDispatch: prior(null) }) }));
  F('dup-sync-throw-fails-open', base({ store: S({ findRecentFreshDispatch: thr('sync') }) }));
  F('dup-reject-fails-open', base({ store: S({ findRecentFreshDispatch: rej('async') }) }));
  F('dup-force-bypass', base({ store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS))) }), fields: { promptName: 'implementation', issueIdentifier: 'LIN-1', force: true } }));
  F('dup-followup-skips', base({ store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS))) }), fields: { issueIdentifier: 'LIN-1', followUpTo: UUIDS[0] } }));
  F('dup-abort-skips', base({ store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS))) }), fields: { issueIdentifier: 'LIN-1', abort: true } }));
  F('dup-now-number', base({ now: NOW_MS + 120000, store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS))) }) }));
  F('dup-now-date', base({ now: date(iso(NOW_MS + 1500)), store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS))) }) }));
  F('dup-now-nan', base({ now: { $nan: 1 }, store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS))) }) }));
  F('dup-now-fn', base({ now: fn('now', ret(NOW_MS + 299999)), store: S({ findRecentFreshDispatch: prior(date(iso(NOW_MS))) }) }));
  F('dup-not-function', base({ store: S({ findRecentFreshDispatch: 'yes' }) }));
  // Run gate.
  const RESETS = iso(NOW_MS + 12 * 3600 * 1000);
  F('gate-allowed', base({ runGate: fn('runGate', res({ allowed: true })) }));
  F('gate-limit', base({ runGate: fn('runGate', res({ allowed: false, reason: 'limit', runsUsed: 10, limit: 10, remaining: 0, resetsAt: RESETS })) }));
  F('gate-limit-past-reset', base({ runGate: fn('runGate', res({ allowed: false, reason: 'limit', runsUsed: 10, limit: 10, resetsAt: iso(NOW_MS - 1) })) }));
  F('gate-limit-bad-reset', base({ runGate: fn('runGate', res({ allowed: false, reason: 'limit', runsUsed: 1, limit: 1, resetsAt: 'nope' })) }));
  F('gate-unverified-with-reset', base({ runGate: fn('runGate', res({ allowed: false, reason: 'unverified', resetsAt: RESETS, limit: 10 })) }));
  F('gate-null', base({ runGate: fn('runGate', res(null)) }));
  F('gate-throw', base({ runGate: fn('runGate', thr('x')) }));
  F('gate-allowed-truthy-not-true', base({ runGate: fn('runGate', res({ allowed: 1 })) }));
  F('gate-skips-sessionId', base({ runGate: fn('runGate', res(null)), fields: { issueIdentifier: 'LIN-1', sessionId: 's' } }));
  F('gate-skips-wake', base({ kind: 'wake', runGate: fn('runGate', res(null)) }));
  F('gate-skips-cascade', base({ runGate: fn('runGate', res(null)), fields: { cascade: true } }));
  F('gate-not-function', base({ runGate: 'x' }));
  F('gate-before-budget', base({ runGate: fn('runGate', res(null)), store: S({ countDistinctTasksForSession: res({ count: 9, alreadyCounted: false, taskDispatches: 0 }), getItemStatus: res({ maxTasks: 1 }) }) }));
  // Budget + runaway.
  const B = (count, run, extra = {}) => base({ store: S({ countDistinctTasksForSession: count, getItemStatus: run }), fields: { promptName: 'implementation', issueIdentifier: 'LIN-1', sessionId: 'run-1', ...extra } });
  F('budget-exhausted', B(res({ count: 3, alreadyCounted: false, taskDispatches: 0 }), res({ maxTasks: 3 })));
  F('budget-already-counted', B(res({ count: 3, alreadyCounted: true, taskDispatches: 2 }), res({ maxTasks: 3 })));
  F('budget-position-new', B(res({ count: 1, alreadyCounted: false, taskDispatches: 0 }), res({ maxTasks: 3 })));
  F('budget-count-null-closed', B(res(null), res({ maxTasks: 2 })));
  F('budget-count-reject-closed', B(rej('db'), res({ maxTasks: 2 })));
  F('budget-count-reject-open', B(rej('db'), res({ id: 'run' })));
  F('budget-count-sync-value-typeerror', B(ret({ count: 0, taskDispatches: 0 }), res({ maxTasks: 2 })));
  F('budget-count-undefined', B(res(U), res({ maxTasks: 2 })));
  F('budget-maxTasks-zero', B(res({ count: 5, alreadyCounted: false, taskDispatches: 0 }), res({ maxTasks: 0 })));
  F('budget-maxTasks-string', B(res({ count: 5, alreadyCounted: false, taskDispatches: 0 }), res({ maxTasks: '1' })));
  F('budget-force-not-bypass', B(res({ count: 3, alreadyCounted: false, taskDispatches: 0 }), res({ maxTasks: 3 }), { force: true }));
  F('runaway-30', B(res({ count: 1, alreadyCounted: true, taskDispatches: 30 }), res({ id: 'run' })));
  F('runaway-29', B(res({ count: 1, alreadyCounted: true, taskDispatches: 29 }), res(null)));
  F('runaway-no-sessionId', base({ store: S({ countDistinctTasksForSession: res({ count: 1, taskDispatches: 99 }) }) }));
  F('run-read-sync-throw-propagates', B(res({ count: 0, taskDispatches: 0 }), thr('status sync')));
  F('run-read-reject', B(res({ count: 0, taskDispatches: 0 }), rej('status')));
  // Close-out seam.
  const CO = (stopAt, extra = {}) => ({ store: S({ getItemStatus: res({ stopAt }) }), urlKey: 'acme', kind: 'close-out', fields: { sessionId: 'run-1', ...extra } });
  F('closeout-refused', CO('pr'));
  F('closeout-null-stopAt', CO(null));
  F('closeout-followup-admitted', CO('pr', { followUpTo: UUIDS[0] }));
  F('closeout-derived-kind', { store: S({ getItemStatus: res({ stopAt: 'pr' }) }), urlKey: 'acme', fields: { promptName: 'close out', sessionId: 'run-1' } });
  F('closeout-budget-precedence', { store: S({ getItemStatus: res({ stopAt: 'pr', maxTasks: 1 }), countDistinctTasksForSession: res({ count: 1, alreadyCounted: false, taskDispatches: 0 }) }), urlKey: 'acme', kind: 'close-out', fields: { sessionId: 'run-1', issueIdentifier: 'LIN-1' } });
  F('autopilot-inherits-stopAt', { store: S({ getItemStatus: res({ stopAt: 'pr' }) }), urlKey: 'acme', kind: 'autopilot', fields: { sessionId: 'run-1' } });
  F('autopilot-own-stopAt', { store: S({ getItemStatus: res({ stopAt: 'pr' }) }), urlKey: 'acme', kind: 'autopilot', fields: { sessionId: 'run-1', stopAt: 'merge' } });
  // Composed-run marker.
  const M = (extra) => base({ composedRunMarker: 'brief', getWorkspaceAccessToken: fn('getWorkspaceAccessToken', res('tok')), fetchIssueContext: fn('fetchIssueContext', res({ issue: { state: { type: 'completed' } } })), guardTaskDoneCache: { $realCache: { name: 'guardTaskDoneCache' } }, ...extra });
  F('marker-terminal', M());
  F('marker-open', M({ fetchIssueContext: fn('fetchIssueContext', res({ issue: { state: { type: 'started' } } })) }));
  F('marker-no-token', M({ getWorkspaceAccessToken: fn('getWorkspaceAccessToken', res(null)) }));
  F('marker-provider-error', M({ fetchIssueContext: fn('fetchIssueContext', rej('boom')) }));
  F('marker-context-no-issue', M({ fetchIssueContext: fn('fetchIssueContext', res({ state: { type: 'duplicate' } })) }));
  F('marker-invalid-type', base({ composedRunMarker: 5 }));
  F('marker-too-long', base({ composedRunMarker: 'z'.repeat(201) }));
  F('marker-200', M({ composedRunMarker: 'z'.repeat(200) }));
  F('marker-control', base({ composedRunMarker: 'a\x00' }));
  F('marker-empty-string-validated', M({ composedRunMarker: '' }));
  F('marker-null-skips', base({ composedRunMarker: null, getWorkspaceAccessToken: fn('getWorkspaceAccessToken', res('tok')) }));
  F('marker-no-capability', base({ composedRunMarker: 'brief' }));
  F('marker-no-issue', M({ fields: { promptName: 'implementation' } }));
  F('marker-cache-truthy-not-true', M({ guardTaskDoneCache: obj('guardTaskDoneCache', { get: fn('guardTaskDoneCache.get', res(1)) }) }));
  F('marker-cache-raw-producer', M({ guardTaskDoneCache: obj('guardTaskDoneCache', { get: fn('guardTaskDoneCache.get', { k: 'callProducer' }) }) }));
  F('marker-singleton', M({ guardTaskDoneCache: U, urlKey: 'edge-singleton-1' }));
  // Anchor inheritance.
  const A = (anchor, fields = {}, extra = {}) => ({ store: S({ getItemStatus: { k: 'byArg', index: 1, map: { [UUIDS[0]]: res(anchor) }, default: res(null) } }), urlKey: 'acme', prompt: 'reply', fields: { followUpTo: UUIDS[0], ...fields }, ...extra });
  const fullAnchor = { id: UUIDS[0], issueIdentifier: 'LIN-9', issueId: 'anchor-id', issueTitle: 'T', issueUrl: 'U', issueSource: 'github', harness: 'opencode', sessionGroupId: 'grp', sessionId: 'sess', rootItemId: 'root', presetConfig: { model: 'pm', harness: 'opencode', byKind: { autopilot: { model: 'ap-model' } } }, presetName: 'AP', grantDeclaration: { site: 'anchor' } };
  F('anchor-full', A(fullAnchor));
  F('anchor-full-autopilot', A(fullAnchor, {}, { kind: 'autopilot' }));
  F('anchor-own-issue-same', A(fullAnchor, { issueIdentifier: 'LIN-9' }));
  F('anchor-own-issue-different', A(fullAnchor, { issueIdentifier: 'LIN-1' }));
  F('anchor-issueId-different', A(fullAnchor, { issueId: 'other' }));
  F('anchor-own-issueSource', A(fullAnchor, { issueSource: 'linear' }));
  F('anchor-group-fallbacks', A({ id: 'x', sessionId: 'sess-only' }));
  F('anchor-bare', A({ id: 'x' }));
  F('anchor-missing', A(null));
  F('anchor-read-sync-throw', { store: S({ getItemStatus: thr('sync') }), urlKey: 'acme', fields: { followUpTo: UUIDS[0] } });
  F('anchor-read-reject', { store: S({ getItemStatus: rej('async') }), urlKey: 'acme', fields: { followUpTo: UUIDS[0] } });
  F('anchor-explicit-harness-wins', A(fullAnchor, {}, { harness: 'claude-code' }));
  F('anchor-function-in-presetConfig', A({ ...fullAnchor, presetConfig: { model: 'x', f: fn('cfgfn', ret(1)) } }, {}, { kind: 'autopilot' }));
  // Routing.
  const prefs = (cfg) => obj('workspacePreferencesStore', { getWorkspacePreferences: fn('workspacePreferencesStore.getWorkspacePreferences', res({ dispatchDefaults: cfg })) });
  const presets = (p) => obj('dispatchPresetsStore', { get: fn('dispatchPresetsStore.get', p) });
  F('ws-defaults-crossed-pair', base({ harness: 'claude-code', workspacePreferencesStore: prefs({ model: 'deepseek', harness: 'opencode', effort: 'high' }) }));
  F('ws-defaults-byKind', base({ kind: 'review', workspacePreferencesStore: prefs({ model: 'top', byKind: { review: { model: 'rev', harness: 'opencode', effort: 'low' } } }) }));
  F('ws-defaults-null-prefs', base({ workspacePreferencesStore: obj('workspacePreferencesStore', { getWorkspacePreferences: fn('workspacePreferencesStore.getWorkspacePreferences', res(null)) }) }));
  F('ws-defaults-reject', base({ workspacePreferencesStore: obj('workspacePreferencesStore', { getWorkspacePreferences: fn('workspacePreferencesStore.getWorkspacePreferences', rej('prefs down')) }) }));
  F('ws-defaults-skipped-all-explicit', base({ model: 'm', harness: 'h', effort: 'e', workspacePreferencesStore: prefs({ model: 'x' }) }));
  F('preset-wins', base({ presetId: 'p1', dispatchPresetsStore: presets(res({ name: 'P', config: { model: 'pm', harness: 'opencode', effort: 'max' } })), workspacePreferencesStore: prefs({ model: 'ws' }) }));
  F('preset-autopilot-stamp', base({ kind: 'autopilot', presetId: 'p1', dispatchPresetsStore: presets(res({ name: '', config: { model: 'pm', nested: { deep: [1, 2] } } })) }));
  F('preset-reject', base({ presetId: 'p1', dispatchPresetsStore: presets(rej('gone')) }));
  F('preset-sync-value-typeerror', base({ presetId: 'p1', dispatchPresetsStore: presets(ret({ config: {} })) }));
  F('preset-no-id', base({ presetId: '', dispatchPresetsStore: presets(res({ config: { model: 'x' } })) }));
  // Finalize / grant declaration.
  F('finalize-grant', base({ finalizePrompt: fn('finalizePrompt', res({ prompt: 'F', bootstrapToken: 't', grantDeclaration: { site: 'M2' } })), fields: { issueIdentifier: 'LIN-1', grantDeclaration: { site: 'caller' }, grantRefusal: { x: 1 } } }));
  F('finalize-grant-false', base({ finalizePrompt: fn('finalizePrompt', res({ prompt: 'F', grantDeclaration: false })) }));
  F('finalize-undefined', base({ finalizePrompt: fn('finalizePrompt', res(U)) }));
  F('finalize-reject', base({ finalizePrompt: fn('finalizePrompt', rej('mint', 'Error', { proxyAttachFailed: true })) }));
  F('finalize-not-fn-uses-prompt', base({ finalizePrompt: 'x' }));
  F('finalize-gets-resolved-harness-null', base({ applyDefaultHarness: false, finalizePrompt: fn('finalizePrompt', res({ prompt: 'F' })) }));
  // Consumer stamp.
  const toks = (name, list, grants) => obj(name, { listTokens: fn(`${name}.listTokens`, list) });
  F('consumer-max', base({ dispatchTokenStore: toks('dispatchTokenStore', res([{ lastUsedAt: date(iso(NOW_MS - 1000)) }, { lastUsedAt: iso(NOW_MS - 10) }])), proxyTokenStore: toks('proxyTokenStore', res([{ lastUsedAt: NOW_MS - 1, grants: ['take'] }, { lastUsedAt: NOW_MS, grants: ['read'] }])) }));
  F('consumer-sync-array-typeerror', base({ dispatchTokenStore: toks('dispatchTokenStore', ret([])) }));
  F('consumer-reject', base({ dispatchTokenStore: toks('dispatchTokenStore', rej('x')) }));
  // addItem result handling.
  const budgetStore = (add) => obj('store', { addItem: fn('store.addItem', add), countDistinctTasksForSession: fn('store.countDistinctTasksForSession', res({ count: 0, alreadyCounted: false, taskDispatches: 0 })), getItemStatus: fn('store.getItemStatus', res({ maxTasks: 2 })) });
  F('addItem-frozen-with-budget', base({ store: budgetStore({ k: 'echoFrozen' }), fields: { issueIdentifier: 'LIN-1', sessionId: 'r' } }));
  F('addItem-null-with-budget', base({ store: budgetStore({ k: 'echoNull' }), fields: { issueIdentifier: 'LIN-1', sessionId: 'r' } }));
  F('addItem-null', base({ store: obj('store', { addItem: fn('store.addItem', { k: 'echoNull' }) }) }));
  F('addItem-reject', base({ store: obj('store', { addItem: fn('store.addItem', rej('dup key', 'Error', { code: 11000 })) }) }));
  F('addItem-same-object', base({ store: budgetStore({ k: 'echoSame' }), fields: { issueIdentifier: 'LIN-1', sessionId: 'r' } }));
  // Pilot.
  const PL = (extra, storeProps = {}) => ({ store: S({ countPilotEligible: seq([res(0), res(0)]), ...storeProps }), urlKey: 'acme', kind: 'implementation', prompt: 'BODY', filePointerEnabled: true, filePointerTimeouts: { count: 5, plan: 5, step: 60 }, readPlanBlock: fn('readPlanBlock', res(PLAN[0])), fetchPilotPrFiles: fn('fetchPilotPrFiles', res([{ repo: 'r', path: 'src/x.js' }])), fields: { promptName: 'implementation', issueIdentifier: 'LIN-1' }, ...extra });
  F('pilot-pointer-delivered', PL({}));
  F('pilot-control-odd', PL({}, { countPilotEligible: res(1) }));
  F('pilot-flip-on-recount', PL({}, { countPilotEligible: seq([res(0), res(1)]) }));
  F('pilot-c0-null', PL({}, { countPilotEligible: res(null) }));
  F('pilot-c1-null', PL({}, { countPilotEligible: seq([res(2), res(null)]) }));
  F('pilot-c0-hang', PL({}, { countPilotEligible: hang() }));
  F('pilot-plan-hang', PL({ readPlanBlock: fn('readPlanBlock', hang()) }));
  F('pilot-step-cap', PL({ filePointerTimeouts: { count: 5, plan: 40, step: 5 }, readPlanBlock: fn('readPlanBlock', hang()) }));
  F('pilot-empty-pointer', PL({ readPlanBlock: fn('readPlanBlock', res('nothing')), fetchPilotPrFiles: fn('fetchPilotPrFiles', res([])) }));
  F('pilot-marker-already', PL({ prompt: '[file-pointer v1] already here' }));
  F('pilot-env-on', PL({ filePointerEnabled: U }), { HARBOUR_FILE_POINTER_PILOT: 'yes' });
  F('pilot-env-off', PL({ filePointerEnabled: U }), { HARBOUR_FILE_POINTER_PILOT: 'nah' });
  F('pilot-flag-truthy-not-true', PL({ filePointerEnabled: 'true' }));
  F('pilot-followup-ineligible', PL({ fields: { promptName: 'implementation', issueIdentifier: 'LIN-1', followUpTo: UUIDS[0] } }));
  F('pilot-empty-prompt', PL({ prompt: '' }));
  F('pilot-review-kind', PL({ kind: 'review' }));
  F('pilot-default-pr-reader', PL({ fetchPilotPrFiles: U, filePointerOwners: { $set: ['acme'] }, filePointerDoFetch: fn('filePointerDoFetch', seq([res(obj('r', { ok: true, status: 200, json: fn('r.json', res({ state: 'closed' })) })), res(obj('r', { ok: true, status: 200, json: fn('r.json', res([{ filename: 'lib/pr-file.js' }])) }))])) }, {
    listHistory: res({ items: [{ feedback: [{ message: '[evidence] PR https://github.com/acme/repo/pull/12', timestamp: iso(NOW_MS - 5) }] }] }),
    listItems: res([{ feedback: [{ message: '[evidence] https://github.com/acme/repo/pull/3' }] }])
  }));
  F('pilot-default-global-fetch-blocked', PL({ fetchPilotPrFiles: U, filePointerOwners: { $set: ['acme'] } }, { listHistory: res({ items: [{ feedback: [{ message: '[evidence] https://github.com/acme/repo/pull/12' }] }] }) }));
  F('pilot-owners-from-env', PL({ fetchPilotPrFiles: U, filePointerDoFetch: fn('filePointerDoFetch', res(null)) }, { listItems: res([{ feedback: [{ message: '[evidence] https://github.com/acme/repo/pull/1' }] }]) }), { HARBOUR_FILE_POINTER_GITHUB_OWNERS: 'acme' });
  F('pilot-step-throws', PL({ fetchPilotPrFiles: fn('fetchPilotPrFiles', res([obj('prFile', { repo: { $throwGetter: 'repo getter boom' }, path: 'a.js' })])) }));
  E.push({ name: 'pilot-plan-late-reject', waitMs: 40, calls: [{ mod: 'factory', fn: 'createDispatchItem', args: [PL({ readPlanBlock: fn('readPlanBlock', { k: 'late', ms: 20, then: rej('late plan failure') }) })] }] });
  E.push({ name: 'pilot-count-late-resolve', waitMs: 40, calls: [{ mod: 'factory', fn: 'createDispatchItem', args: [PL({}, { countPilotEligible: { k: 'late', ms: 20, then: res(0) } })] }] });
  F('pilot-default-reader-items-null', PL({ fetchPilotPrFiles: U, filePointerOwners: { $set: ['acme'] }, filePointerDoFetch: fn('filePointerDoFetch', res(null)) }, { listHistory: res(null), listItems: res(null) }));
  F('pilot-timeouts-invalid-defaults', PL({ filePointerTimeouts: { count: 0, plan: -5, step: 'x' } }));
  // Sequences against the module singleton cache (hit on the second call).
  const seqM = (name, cacheArg) => {
    const shared = { store: obj('store', { addItem: fn('store.addItem', { k: 'echo' }) }), tok: fn('getWorkspaceAccessToken', res('tok')), ctx: fn('fetchIssueContext', seq([res({ issue: { state: { type: 'started' } } }), res({ issue: { state: { type: 'completed' } } })])) };
    if (cacheArg) shared.cache = cacheArg;
    const one = (c) => ({ mod: 'factory', fn: 'createDispatchItem', args: [{ store: { $ref: 'store' }, urlKey: `edge-${name}`, prompt: `p${c}`, composedRunMarker: 'brief', getWorkspaceAccessToken: { $ref: 'tok' }, fetchIssueContext: { $ref: 'ctx' }, ...(cacheArg ? { guardTaskDoneCache: { $ref: 'cache' } } : {}), fields: { issueIdentifier: 'LIN-77' } }] });
    E.push({ name, shared, calls: [one(0), one(1), one(2)] });
  };
  seqM('seq-singleton-cache', null);
  seqM('seq-real-cache', { $realCache: { name: 'guardTaskDoneCache' } });
  return E;
}
