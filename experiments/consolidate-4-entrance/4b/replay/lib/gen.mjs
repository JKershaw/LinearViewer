// Seeded scenario generator. A scenario is pure data: one HTTP request plus
// the whole fake world it meets (session, env, clock, every store answer,
// owner seam, provider/registry behaviour, recommendations, client hang-ups).
// `generate(seed, i, K)` is a pure function of its arguments, so both sides
// and every re-run see byte-identical inputs.
import { G, FIXED_NOW } from './common.mjs';

const STEP_MS = 90_000; // virtual time between requests (> the 60s task-done TTL, < the 5 min duplicate window)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
export const WORKSPACES = {
  acme: { id: 'ws-acme', urlKey: 'acme', name: 'Acme', provider: 'linear', accessToken: 'lin_tok_acme' },
  localws: { id: 'ws-local', urlKey: 'localws', name: 'Local', provider: 'local', accessToken: 'local-token' },
  ghws: { id: 'ws-gh', urlKey: 'ghws', name: 'GH', provider: 'github', accessToken: 'gh_tok', bindings: [{ provider: 'github', scope: 'org/repo', credentials: { token: 'gh_tok' } }] },
  jiraamb: { id: 'ws-jira', urlKey: 'jiraamb', name: 'Jira', provider: 'jira', accessToken: 'jt0', bindings: [{ provider: 'jira', scope: 'a.atlassian.net', credentials: { token: 'jt1', email: 'a@x.io' } }, { provider: 'jira', scope: 'b.atlassian.net', credentials: { token: 'jt2', email: 'b@x.io' } }] },
  mixed: { id: 'ws-mixed', urlKey: 'mixed', name: 'Mixed', provider: 'linear', accessToken: 'lin_tok_mixed', bindings: [{ provider: 'linear', scope: 'ws-mixed', credentials: { token: 'lin_tok_mixed' } }, { provider: 'github', scope: 'org/other', credentials: { token: 'gh_tok2' } }] },
  notoken: { id: 'ws-nt', urlKey: 'notoken', name: 'NoTok', provider: 'linear' },
  noid: { urlKey: 'noid', name: 'NoId', accessToken: 'tok-noid' },
};
const WS_KEYS = Object.keys(WORKSPACES);

const PROMPTS = ['Implement the widget', 'Line one\nLine two\n\n- bullet', 'Ünïcødé ✓ prompt — 日本語', "it's 'quoted' $HOME `x`", 'p'.repeat(300), 'tab\there\r\nCRLF'];
const BAD_PROMPTS = ['', '   ', 'bad\u0001char', 123, { a: 1 }, ['x'], null, true];
const IDS = ['LIN-1', 'LIN-42', 'ENG-7', 'HAR-3', 'LIN-1000'];
const BAD_IDS = ['BAD ID', 'X'.repeat(101), 'lin_1', '', 7, 'LIN-'];
const ACCOUNTS = ['acct-owner', 'acct-member'];

function uuidish(g) { return g.uuid(); }
function iso(ms) { return new Date(ms).toISOString(); }

// ---------------------------------------------------------------------------
// Common world
// ---------------------------------------------------------------------------
function env(g) {
  const e = {
    NODE_ENV: g.chance(0.9) ? 'test' : 'production',
    OPENROUTER_API_KEY: g.weighted([[undefined, 6], ['', 1], ['sk-paid-env', 2], ['  ', 1]]),
    OPENROUTER_FREE_TIER_KEY: g.weighted([[undefined, 5], ['sk-free', 4]]),
    DISPATCH_OWNERLESS_BROKER_COMPAT: g.weighted([[undefined, 5], ['off', 2], ['on', 1], ['FALSE', 1]]),
    HARBOUR_FILE_POINTER_PILOT: g.weighted([[undefined, 6], ['1', 3], ['on', 1]]),
  };
  return e;
}

function jsonBody(value) { return { kind: 'json', value }; }

/** Occasionally swap a JSON body for another encoding (parser edges). */
function encodeBody(g, value, p = 0.06) {
  if (!g.chance(p)) return jsonBody(value);
  return g.weighted([
    [{ kind: 'raw', text: '{"prompt": "unterminated', contentType: 'application/json' }, 3],
    [{ kind: 'raw', text: 'null', contentType: 'application/json' }, 1],
    [{ kind: 'raw', text: '[1,2]', contentType: 'application/json' }, 1],
    [{ kind: 'raw', text: 'prompt=hello', contentType: 'text/plain' }, 1],
    [{ kind: 'form', pairs: Object.entries(value || {}).filter(([, v]) => typeof v === 'string').slice(0, 6) }, 2],
    [{ kind: 'none' }, 1],
    [{ kind: 'pad', value, padBytes: 260_000, contentType: 'application/json' }, 1],
    [{ kind: 'json', value, contentType: 'application/json; charset=utf-8' }, 1],
  ]);
}

function host(g, localish = 0.1) {
  return g.chance(localish) ? g.pick(['localhost:3000', '127.0.0.1:8080', 'localhost']) : g.pick(['harbour.example', 'harbour.example:443', 'app.harbour.test']);
}

function tokenLists(g, now) {
  const at = () => g.weighted([[iso(now - 60_000), 3], [iso(now - 3 * 3600_000), 2], [null, 1], ['not-a-date', 1]]);
  return {
    dispatchTokens: g.chance(0.7) ? Array.from({ length: g.int(0, 2) }, () => ({ lastUsedAt: at() })) : [],
    proxyTokens: g.chance(0.5) ? Array.from({ length: g.int(0, 2) }, () => ({ lastUsedAt: at(), grants: g.pick([['take', 'dispatch'], ['dispatch'], [], undefined]) })) : [],
  };
}

function storeErr(g, msg = 'store down') {
  return g.weighted([[{ kind: 'plain', message: msg }, 4], [{ kind: 'string', value: 'raw string thrown' }, 1]]);
}

// ---------------------------------------------------------------------------
// Session lane helpers
// ---------------------------------------------------------------------------
function session(g) {
  const shape = g.weighted([['normal', 90], ['noWorkspaces', 3], ['empty', 2], ['noAccount', 5]]);
  if (shape === 'empty') return { session: {}, keys: [] };
  const keys = g.chance(0.8) ? WS_KEYS.slice() : WS_KEYS.filter(() => g.chance(0.5));
  if (!keys.includes('acme')) keys.push('acme');
  const s = { workspaces: shape === 'noWorkspaces' ? [] : keys.map(k => WORKSPACES[k]) };
  if (shape !== 'noAccount') s.accountId = g.weighted([['acct-owner', 8], ['acct-member', 2]]);
  if (g.chance(0.25)) s.openRouterApiKey = 'sk-or-session';
  return { session: s, keys };
}

function urlKeyFor(g, keys) {
  return g.weighted([
    [g.pick(keys.length ? keys : ['acme']), 90],
    ['ghost', 3], ['bad.key', 2], ['a'.repeat(51), 1], ['ACME', 2], ['%E2%9C%93', 1],
  ]);
}

function ownerCheck(g) {
  return g.weighted([
    [{ ret: { status: 'owner' } }, 78], [{ ret: { status: 'not-owner' } }, 7], [{ ret: { status: 'no-owner' } }, 4],
    [{ ret: { status: 'weird' } }, 2], [{ ret: null }, 2], [{ throw: { kind: 'plain', message: 'owner seam down' } }, 4], [{ hang: true, delayMs: 0, ret: { status: 'owner' } }, 0],
  ]);
}

function dispatchAuth(g, stores) {
  const header = g.weighted([['Bearer hbd_runner_tok', 86], [undefined, 4], ['Bearer ', 3], ['Basic abc', 3], ['bearer hbd_runner_tok', 2], ['Bearer  spaced', 2]]);
  const owner = g.weighted([['acct-owner', 6], [null, 3], [undefined, 1]]);
  stores.dispatchTokenStore = {
    ...(stores.dispatchTokenStore || {}),
    validateToken: g.weighted([
      [{ ret: { urlKey: g.pick(['acme', 'mixed', 'ghws']), label: g.pick(['runner-1', 'host', 'harbour']), ...(owner === undefined ? {} : { createdBy: owner }) } }, 88],
      [{ ret: null }, 6], [{ throw: storeErr(g, 'token store down') }, 4], [{ ret: { urlKey: 'acme' } }, 2],
    ]),
  };
  return header;
}

function presetSpec(g) {
  return g.weighted([
    [{ ret: { id: 'p1', name: 'Fast', config: { model: 'model-a', harness: 'claude-code', effort: 'high', byKind: { implementation: { model: 'model-b' } } } } }, 5],
    [{ ret: { id: 'p2', name: 'Codex', config: { harness: 'codex' } } }, 2],
    [{ ret: null }, 3], [{ throw: storeErr(g) }, 1],
  ]);
}

function prefsSpec(g) {
  return g.weighted([
    [{ ret: {} }, 5],
    [{ ret: { dispatchDefaults: { model: 'model-a-4', harness: g.pick(['claude-code', 'codex', '']), effort: g.pick(['high', undefined]) } } }, 3],
    [{ ret: { dispatchDefaults: { byKind: { implementation: { model: 'model-b', harness: 'claude-code' }, autopilot: { harness: 'claude-code' } } } } }, 2],
    [{ throw: storeErr(g, 'prefs down') }, 1],
  ]);
}

function runRow(g, now, o = {}) {
  return {
    id: o.id || uuidish(g), status: g.pick(['taken', 'queued', 'taken']), target: g.pick(['cli', 'web', 'dash', 'local', undefined]),
    maxTasks: g.pick([undefined, 1, 2, 5]), stopAt: g.pick([undefined, 'pr', null]), harness: g.pick([undefined, 'claude-code', 'codex']),
    presetConfig: g.chance(0.2) ? { harness: 'claude-code', model: 'model-a' } : undefined, presetName: 'Preset', issueIdentifier: g.pick([undefined, 'LIN-42']),
    issueId: g.pick([undefined, 'issue-uuid-1']), rootItemId: g.pick([undefined, uuidish(g)]), sessionGroupId: g.pick([undefined, 'grp-1']),
    issueSource: g.pick([undefined, 'linear', 'github']), dispatchedBy: g.pick(['acct-owner', 'acct-member', undefined]),
    takenByTokenLabel: g.pick(['runner-1', 'host', undefined]), feedback: g.chance(0.3) ? [{ message: '[done] shipped', timestamp: iso(now - 1000) }] : [],
    ...o,
  };
}

/** Factory-facing store knobs shared by every enqueue route. */
function factoryWorld(g, now, stores, { sessionId, followUpTo, issueIdentifier }) {
  const q = stores.dispatchQueueStore = stores.dispatchQueueStore || {};
  // duplicate guard: mostly the per-app memory (stateful), sometimes forced
  if (issueIdentifier && g.chance(0.12)) q.findRecentFreshDispatch = g.weighted([[{ ret: { id: 'dup-1', dispatchedAt: iso(now - 61_000) } }, 4], [{ ret: { id: 'dup-2', dispatchedAt: 'garbage' } }, 1], [{ throw: storeErr(g) }, 1], [{ ret: { id: 'dup-3', dispatchedAt: iso(now - 299_500) } }, 1]]);
  if (sessionId || g.chance(0.1)) {
    q.countDistinctTasksForSession = g.weighted([
      [{ ret: { count: 0, alreadyCounted: false, taskDispatches: 0 } }, 4], [{ ret: { count: 2, alreadyCounted: false, taskDispatches: 3 } }, 3],
      [{ ret: { count: 5, alreadyCounted: true, taskDispatches: 2 } }, 2], [{ ret: { count: 1, alreadyCounted: false, taskDispatches: 30 } }, 2],
      [{ throw: storeErr(g) }, 1], [{ ret: null }, 1],
    ]);
  }
  const rows = [];
  if (sessionId) rows.push(g.weighted([[{ ret: runRow(g, now, { id: sessionId }) }, 6], [{ ret: null }, 2], [{ throw: storeErr(g) }, 1]]));
  if (followUpTo) rows.push(g.weighted([[{ ret: runRow(g, now, { id: followUpTo }) }, 6], [{ ret: null }, 2], [{ throw: storeErr(g) }, 1]]));
  if (rows.length) q.getItemStatus = { seq: rows.concat(rows.slice(-1)) };
  if (followUpTo || g.chance(0.05)) {
    q.getGrantDeclaration = g.weighted([
      [{ ret: { state: 'none' } }, 5], [{ ret: { state: 'row-missing' } }, 1],
      [{ ret: { state: 'record', record: { grants: ['dispatch'], workspaceId: 'ws-acme', site: 'M2', ownerAccountId: 'acct-owner' } } }, 3],
      [{ ret: { state: 'record', record: { grants: [], workspaceId: 'ws-acme', site: 'M2', ownerAccountId: 'acct-owner' } } }, 1],
      [{ ret: { state: 'record', record: { grants: ['dispatch'], workspaceId: 'ws-acme', site: 'M2', ownerAccountId: '' } } }, 1],
      [{ throw: storeErr(g, 'decl read failed') }, 1],
    ]);
  }
  q.countPilotEligible = g.weighted([[{ ret: 0 }, 3], [{ ret: 1 }, 2], [{ seq: [{ ret: 2 }, { ret: 3 }] }, 1], [{ ret: null }, 1], [{ throw: storeErr(g) }, 1], [{ delayMs: 5000, ret: 0 }, 1]]);
  if (g.chance(0.08)) q.addItem = { throw: storeErr(g, 'insert failed') };
  stores.workspacePreferencesStore = { getWorkspacePreferences: prefsSpec(g) };
  const tl = tokenLists(g, now);
  stores.dispatchTokenStore = { ...(stores.dispatchTokenStore || {}), listTokens: g.chance(0.05) ? { throw: storeErr(g) } : { ret: tl.dispatchTokens } };
  const p = stores.proxyTokenStore = stores.proxyTokenStore || {};
  p.listTokens = { ret: tl.proxyTokens };
  p.createToken = g.weighted([[{ ret: { token: 'hb_boot_xyz', expiresAt: iso(now + 172_800_000) } }, 10], [{ ret: { token: null } }, 1], [{ throw: storeErr(g, 'mint failed') }, 1]]);
  p.mintGrantBootstrap = g.weighted([
    [{ ret: { token: 'hb_grant_xyz', workspaceId: 'ws-acme' } }, 10], [{ ret: {} }, 1],
    [{ throw: { kind: 'coded', code: 'GRANT_OWNER_ONLY', status: 403 } }, 1], [{ throw: { kind: 'coded', code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true } }, 1],
    [{ throw: { kind: 'coded', code: 'WORKSPACE_OWNER_UNSET', status: 409 } }, 1], [{ throw: { kind: 'coded', code: 'ODD_CODE', status: 418 } }, 1], [{ throw: storeErr(g) }, 1],
  ]);
  const ft = stores.freeTierStore = stores.freeTierStore || {};
  ft.checkRun = g.weighted([
    [{ ret: { allowed: true } }, 6], [{ ret: { allowed: false, reason: 'limit', limit: 10, runsUsed: 10, resetsAt: iso(now + 3_600_000) } }, 2],
    [{ ret: { allowed: false, reason: 'unverified', resetsAt: iso(now + 60_000), limit: 10 } }, 1], [{ ret: { allowed: false } }, 1], [{ throw: storeErr(g) }, 1],
  ]);
  if (g.chance(0.2)) stores.accountStore = { listMergedAccounts: g.weighted([[{ ret: [{ _id: 'acct-alt' }] }, 2], [{ throw: storeErr(g) }, 1]]) };
}

function sessionDispatchBody(g, now, mode, clean = false) {
  const b = {};
  // pv: a valid value, or (not clean) sometimes an invalid one
  const pv = (valid, invalid, pBad = 0.3) => (!clean && invalid.length && g.chance(pBad) ? g.pick(invalid) : g.pick(valid));
  const opt = (p) => g.chance(clean ? p * 0.8 : p);
  const prompt = () => pv(PROMPTS, BAD_PROMPTS, 0.06);
  const issue = () => pv(IDS, BAD_IDS, 0.07);
  switch (mode) {
    case 'fresh': b.prompt = prompt(); if (g.chance(0.5)) b.promptName = g.pick(['Implement', 'Plan', 'Custom thing', 'Review', 'Close out']); break;
    case 'issue': b.prompt = prompt(); b.issueIdentifier = issue(); b.issueId = pv(['issue-uuid-1', 'LIN-42', undefined], ['bad id'], 0.2); b.issueTitle = g.pick(['Title', undefined]); b.issueUrl = g.pick(['https://linear.app/x/issue/LIN-42', undefined]); b.kind = g.pick([undefined, 'implementation', 'implementation', 'review', 'close-out', 'plan']); break;
    case 'followUp': b.prompt = prompt(); b.followUpTo = pv([uuidish(g)], ['not-a-uuid'], 0.1); b.target = pv([undefined, 'cli', 'web'], ['dash'], 0.3); if (g.chance(0.3)) b.issueIdentifier = issue(); break;
    case 'abort': b.abort = true; b.abortTo = pv([uuidish(g)], [undefined, 'nope'], 0.15); b.target = pv([undefined, 'cli', 'web', 'dash'], ['local'], 0.2); if (!clean && g.chance(0.2)) b.prompt = prompt(); break;
    case 'cascade': b.abort = pv([true], [false, undefined], 0.15); b.abortTo = uuidish(g); b.cascade = pv([true], ['yes', false], 0.2); b.target = g.pick([undefined, 'cli', 'web']); break;
    case 'autopilot': b.prompt = prompt(); b.kind = 'autopilot'; b.issueIdentifier = g.chance(0.7) ? issue() : undefined; b.attachProxy = g.chance(0.6); break;
    case 'periodical': { b.kind = 'periodical'; b.periodicalId = pv(['documentation-review', 'security-review'], ['not-a-periodical'], 0.1); b.prompt = g.chance(0.6) ? 'Run the review\n\n__TAIL__' : prompt(); b.attachProxy = g.chance(0.8); break; }
    case 'local': b.prompt = prompt(); b.target = 'local'; b.repo = g.pick([undefined, 'https://github.com/org/repo', "evil'repo", 'org/repo']); break;
    default: break;
  }
  const fresh = !b.abort && !b.cascade && b.followUpTo == null;
  // optional modifiers
  if (opt(0.25)) b.target = b.target ?? pv(['cli', 'web', 'dash', 'cli'], ['local', 'bogus'], 0.3);
  if (opt(0.15)) b.attachProxy = b.attachProxy ?? pv([true, false], ['true'], 0.15);
  if (opt(0.12)) b.model = pv(['model-a', 'model-b-4'], ['x'.repeat(1001), 'bad\u0002', 5]);
  if (opt(0.12)) b.harness = pv(['claude-code', 'codex', ''], ['h'.repeat(1001)], 0.2);
  if (opt(0.08)) b.terminal = pv(['iterm'], ['bad\u0003']);
  if (opt(0.1)) b.effort = pv(['high', 'low', 'ultra'], [7, 'e'.repeat(1001)]);
  if (opt(0.12)) b.repo = b.repo ?? pv(['org/repo'], ['r'.repeat(1001), 'bad\u0004']);
  if (opt(0.1)) b.force = (clean && fresh && !b.issueIdentifier) ? undefined : pv([true, false], ['true'], 0.2);
  if (opt(0.12)) b.sessionId = pv([uuidish(g), 'ok-opaque-session'], ['__meta__', '', 's'.repeat(129)]);
  if (opt(0.08)) b.waitForFollowUps = pv([true, false], ['yes']);
  if (opt(0.08)) b.queueIfBusy = pv([true, false], [1]);
  if (opt(0.1)) b.subscription = pv(['everything', 'terminal-only'], ['all']);
  if (opt(0.08)) b.presetId = pv(['p1', 'p-missing', null], ['', '  ', 42]);
  if (opt(0.12)) b.maxTasks = pv([1, 3, null], [0, -1, 2.5, '3']);
  if (opt(0.1)) b.entryRung = (clean && !(fresh && b.issueIdentifier)) ? undefined : pv(['run-step', 'run-task', null], ['fly']);
  if (opt(0.08)) b.surface = pv(['swipe', 'home', null], ['nowhere']);
  if (opt(0.07)) b.stopAt = (clean && !(fresh && b.issueIdentifier && b.kind === 'autopilot')) ? undefined : pv(['pr', null], ['merge']);
  if (opt(0.07)) b.variant = (clean && !(fresh && b.kind === 'autopilot')) ? undefined : pv(['standard', 'stepper', null], ['turbo']);
  if (opt(0.06)) b.composedRunMarker = pv(['run:LIN-42:3'], ['bad\u0004marker', 99, 'm'.repeat(201)]);
  if (opt(0.05)) b.issueSource = pv(['linear', 'github', '  '], [7]);
  if (!clean && g.chance(0.04)) b.ifParked = g.pick([true, false]);
  if (opt(0.05)) b.periodicalId = b.periodicalId ?? pv(['security-review'], ['nope']);
  if (!clean && g.chance(0.04)) b.abortTo = b.abortTo ?? uuidish(g);
  if (!clean && g.chance(0.04)) b.followUpTo = b.followUpTo ?? uuidish(g);
  if (!clean && g.chance(0.03)) b.kind = g.pick(['nonsense-kind', 'wake', 'defer']);
  if (!clean && g.chance(0.04)) b.promptName = g.pick(['n'.repeat(1001), 'bad\u0005name']);
  if (!clean && g.chance(0.03)) b.issueTitle = g.pick(['t'.repeat(1001), 'bad\u0006']);
  if (!clean && g.chance(0.03)) b.issueUrl = 'u'.repeat(8001);
  if (clean && b.target === 'local' && mode !== 'local') b.target = 'cli';
  return b;
}

// ---------------------------------------------------------------------------
// Proxy lane helpers
// ---------------------------------------------------------------------------
function proxyAuth(g, stores, { needWrite = false, clean = false } = {}) {
  const header = clean ? 'Bearer hb_work_tok' : g.weighted([['Bearer hb_work_tok', 90], [undefined, 3], ['Bearer ', 2], ['Token x', 2], ['Bearer x y', 1]]);
  const scope = needWrite ? (clean ? 'readWrite' : g.weighted([['readWrite', 85], ['read', 15]])) : g.weighted([['read', 5], ['readWrite', 5]]);
  const grants = needWrite ? (clean ? g.pick([['dispatch'], ['take', 'dispatch']]) : g.weighted([[['dispatch'], 60], [['take', 'dispatch'], 10], [[], 10], [undefined, 8], [['take'], 7], ['dispatch', 5]])) : g.pick([[], ['dispatch'], undefined]);
  stores.proxyTokenStore = {
    ...(stores.proxyTokenStore || {}),
    validateToken: g.weighted([
      [{ ret: { tokenId: 'ptok-1', urlKey: g.weighted([['acme', 8], ['mixed', 1], ['ghws', 1]]), label: g.pick(['agent', 'runner-copy', 'kickoff-bootstrap']), scope, createdBy: g.weighted([['acct-owner', 8], [null, 1], ['acct-member', 1]]), grants, workspaceId: g.weighted([['ws-acme', 8], [undefined, 2]]) } }, 92],
      [{ ret: null }, clean ? 0 : 5], [{ throw: storeErr(g, 'token store down') }, clean ? 0 : 3],
    ]),
    describeRejectionCause: g.weighted([[{ ret: null }, 2], [{ ret: { state: 'expired', urlKey: 'acme', expiresAt: '2026-09-01T00:00:00.000Z' } }, 1], [{ ret: { state: 'consumed', urlKey: 'acme' } }, 1]]),
  };
  return header;
}

function accessSpec(g, now, clean = false) {
  if (clean && g.chance(0.9)) return { token: g.pick(['lin_tok', 'lin_tok', 'test-token']), providerName: 'linear', credentialFingerprint: g.pick(['fp-1', null]), expiresAt: g.pick([now + 3_600_000, now - 1000]), credentialSource: 'session' };
  return g.weighted([
    [{ token: g.pick(['lin_tok', 'test-token']), providerName: g.pick(['linear', 'linear', undefined]), credentialFingerprint: g.pick(['fp-1', null]), expiresAt: g.pick([now + 3_600_000, now - 1000, undefined]), credentialSource: g.pick(['session', 'connection']) }, 88],
    [{ token: null, reason: g.pick(['no-token', 'token-expired', 'no-workspace']) }, 7],
    [{ throw: { kind: 'plain', message: 'access resolution failed' } }, 3],
    [{ token: 'lin_tok', scope: { token: 'lin_tok', repo: 'org/repo' }, providerName: 'github', credentialFingerprint: 'fp-2', expiresAt: now + 60_000 }, 2],
  ]);
}

function providerSpec(g, clean = false) {
  const name = g.weighted([['linear', 75], ['local', 8], ['github', 9], ['jira', 5], ['mystery', 3]]);
  const unsupported = !clean && g.chance(0.06) ? [g.pick(['fetchIssueContext', 'fetchRecommendationContext'])] : [];
  return {
    name, unsupported, ui: g.chance(0.05) ? 'none' : undefined,
    missing: g.chance(0.05) ? [g.pick(['fetchIssueContext', 'issueWriteGuard'])] : [],
    methods: {
      issueWriteGuard: g.weighted([[{ ret: { id: 'issue-1' } }, 85], [{ ret: null }, 8], [{ throw: { kind: 'gql', status: 401 } }, 4], [{ throw: { kind: 'plain', message: 'boom' } }, 3]]),
      fetchIssueContext: g.weighted([[{ ret: { issue: { description: 'Plan: do X' } } }, 6], [{ ret: { description: 'flat ctx' } }, 1], [{ ret: null }, 1], [{ throw: { kind: 'plain', message: 'ctx failed' } }, 1], [{ delayMs: 9000, ret: {} }, 1]]),
    },
  };
}

function registryState(g) {
  return g.weighted([[{}, 8], [{ suspect: true }, 1], [{ pastThreshold: true }, 1], [{ superseded: true }, 1]]);
}

function issueCtx(g, K, identifier) {
  const desc = g.weighted([['Do the thing.', 6], [`Gate\n${K.gateMarker}`, 2], ['', 1], [undefined, 1]]);
  return {
    issue: { id: 'issue-uuid-1', identifier: identifier || 'LIN-42', title: g.pick(['Fix the bug', 'Ünïcødé title']), description: desc, state: { name: 'Todo', type: g.pick(['unstarted', 'started', 'completed']) }, labels: g.pick([[], ['bug']]), url: 'https://linear.app/x/issue/LIN-42' },
    parent: null, siblings: [], project: g.chance(0.5) ? { name: 'Proj', description: 'p' } : null, children: [], comments: [], attachments: [],
  };
}

function promptCtxSpec(g, K, identifier) {
  return g.weighted([
    [{ ret: issueCtx(g, K, identifier) }, 84], [{ ret: null }, 5], [{ throw: { kind: 'plain', message: 'Issue not found' } }, 4],
    [{ throw: { kind: 'gql', status: g.pick([401, 403, 429, 404, 500]) } }, 4], [{ throw: { kind: 'timeout' } }, 1],
    [{ hangUp: true, ret: issueCtx(g, K, identifier) }, 2],
  ]);
}

function recFor(g, identifier, { action, deferTo, children, periodicalId, prompt = 'Generated prompt body', state } = {}) {
  return { ret: { identifier, reasoning: 'because', prompt, truncated: false, recommendedAction: action, deferTo: deferTo ?? null, state: state ?? { type: 'unstarted' }, children: children ?? undefined, periodicalId: periodicalId ?? null } };
}

function recsSpec(g, start) {
  const shape = g.weighted([['leaf', 50], ['descend', 15], ['defer-stuck', 5], ['noprompt', 4], ['nonchild', 3], ['cycle', 3], ['terminal-target', 3], ['throw', 8], ['slow', 2], ['hangUp', 3], ['unresolved', 2], ['terminal-leaf', 2]]);
  const action = g.pick(['implement', 'plan', 'bug', 'review', 'close out', 'research', '???']);
  const t = {};
  switch (shape) {
    case 'leaf': t[start] = recFor(g, start, { action, periodicalId: g.pick([null, 'security-review']) }); break;
    case 'descend': t[start] = recFor(g, start, { action: 'defer', deferTo: 'LIN-77', prompt: null, children: [{ identifier: 'LIN-77', state: { type: 'started' } }] }); t['LIN-77'] = recFor(g, 'LIN-77', { action }); break;
    case 'defer-stuck': t[start] = recFor(g, start, { action: 'defer', deferTo: null, prompt: null }); break;
    case 'noprompt': t[start] = recFor(g, start, { action, prompt: '' }); break;
    case 'nonchild': t[start] = recFor(g, start, { action: 'defer', deferTo: 'LIN-99', prompt: null, children: [{ identifier: 'LIN-77', state: { type: 'started' } }] }); break;
    case 'cycle': t[start] = recFor(g, start, { action: 'defer', deferTo: 'LIN-77', prompt: null }); t['LIN-77'] = recFor(g, 'LIN-77', { action: 'defer', deferTo: start, prompt: null }); break;
    case 'terminal-target': t[start] = recFor(g, start, { action: 'defer', deferTo: 'LIN-77', prompt: null, children: [{ identifier: 'LIN-77', state: { type: 'completed' } }, { identifier: 'LIN-78', state: { type: 'started' } }] }); t['LIN-78'] = recFor(g, 'LIN-78', { action }); break;
    case 'throw': t[start] = { throw: g.pick([{ kind: 'plain', message: 'Issue not found' }, { kind: 'plain', message: 'OpenRouter 502' }, { kind: 'gql', status: 401 }, { kind: 'gql', status: 429 }, { kind: 'timeout' }, { kind: 'plain', message: 'weird' }]) }; break;
    case 'slow': t[start] = { delayMs: 200_000, ...recFor(g, start, { action: 'defer', deferTo: 'LIN-77', prompt: null }) }; t['LIN-77'] = recFor(g, 'LIN-77', { action }); break;
    case 'hangUp': t[start] = g.chance(0.7) ? { hangUp: true } : { hangUpThenReturn: true, ...recFor(g, start, { action }) }; break;
    case 'unresolved': t[start] = recFor(g, start, { action: 'defer', deferTo: 'LIN-77', prompt: null }); t['LIN-77'] = { throw: { kind: 'plain', message: 'Issue not found' } }; break;
    case 'terminal-leaf': t[start] = recFor(g, start, { action: 'defer', deferTo: 'LIN-77', prompt: null }); t['LIN-77'] = recFor(g, 'LIN-77', { action, state: { type: 'completed' } }); break;
    default: break;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
const W = (k) => `/workspace/${k}/api/dispatch`;

export const FORMS = {
  // ---------------- session lane: dispatch.js ----------------
  'POST /workspace/:urlKey/api/dispatch': {
    lane: 'session', weight: 22,
    gen(g, sc, K) {
      const clean = g.chance(0.6);
      const { session: s, keys } = clean ? { session: { workspaces: WS_KEYS.map(k => WORKSPACES[k]), accountId: 'acct-owner', ...(g.chance(0.25) ? { openRouterApiKey: 'sk-or-session' } : {}) }, keys: WS_KEYS } : session(g);
      sc.session = s;
      const now = sc.clockBase;
      const mode = g.weighted([['fresh', 20], ['issue', 26], ['followUp', 12], ['abort', 8], ['cascade', 6], ['autopilot', 12], ['periodical', 6], ['local', 6], ['free', 4]]);
      sc.intent = `${mode}${clean ? ':clean' : ''}`;
      const body = sessionDispatchBody(g, now, mode, clean);
      if (typeof body.prompt === 'string' && body.prompt.includes('__TAIL__')) body.prompt = body.prompt.replace('__TAIL__', K.PERIODICAL_AUTOPILOT_TAIL);
      sc.method = 'POST'; sc.path = W(clean ? g.pick(['acme', 'acme', 'mixed', 'ghws', 'localws', 'jiraamb', 'notoken', 'noid']) : urlKeyFor(g, keys));
      sc.headers.host = host(g, body.target === 'local' ? (clean ? 0.95 : 0.75) : 0.05);
      sc.body = clean ? jsonBody(body) : encodeBody(g, body, 0.06);
      sc.ownerCheck = clean ? (g.chance(0.92) ? { ret: { status: 'owner' } } : ownerCheck(g)) : ownerCheck(g);
      factoryWorld(g, now, sc.stores, { sessionId: body.sessionId, followUpTo: body.followUpTo, issueIdentifier: body.issueIdentifier });
      sc.stores.dispatchPresetsStore = { get: presetSpec(g) };
      sc.regProvider = {
        issueWriteGuard: g.weighted([[{ ret: { id: 'issue-1' } }, 80], [{ ret: null }, 10], [{ throw: { kind: 'gql', status: 401 } }, 5], [{ throw: { kind: 'plain', message: 'net' } }, 5]]),
        fetchIssueContext: { ret: { issue: { description: 'p' } } },
      };
      sc.wsToken = g.weighted([[{ ret: 'ws-access-token' }, 7], [{ ret: null }, 2], [{ throw: { kind: 'plain', message: 'token refresh failed' } }, 1]]);
      sc.issueCtx = g.weighted([[{ ret: { issue: { description: 'plan body', state: { type: 'started' } } } }, 5], [{ ret: { issue: { state: { type: 'completed' } } } }, 2], [{ ret: { description: 'flat' } }, 1], [{ throw: { kind: 'plain', message: 'ctx down' } }, 1]]);
      sc.stores.taskModeStore = { record: g.weighted([[{ ret: { ok: true } }, 6], [{ throw: storeErr(g) }, 1], [{ syncThrow: { kind: 'plain', message: 'sync record boom' } }, 1]]) };
      sc.stores.harbourFeedbackTokenStore = { mintToken: g.weighted([[{ ret: { token: 'hft_1' } }, 6], [{ throw: storeErr(g) }, 1]]) };
      sc.stores.dispatchQueueStore.takeItem = g.weighted([[{ ret: { id: 'x' } }, 5], [{ throw: storeErr(g) }, 1]]);
      sc.tty = g.weighted([['ok', 6], ['fail', 3]]);
      sc.staging = g.weighted([[{}, 10], [{ writeThrow: true }, 1], [{ mkdirThrow: true }, 1]]);
      if (g.chance(0.05)) sc.addItemShape = g.pick(['stringDate', 'noDate']);
      if (g.chance(0.06)) sc.stores.dispatchQueueStore.addItem = { ret: { _id: sc.ids.item, prompt: 'p', promptName: 'P', kind: 'custom', target: 'local', repo: g.pick(['org/repo', undefined]), dispatchedAt: iso(now), consumerLastSeenAt: null, budgetPosition: { tasks: { count: 1, maxTasks: 2 } } } };
      if (mode === 'cascade') sc.stores.dispatchQueueStore.expandCascadeAborts = g.weighted([[{ ret: { aborted: 3, ids: ['a', 'b', 'c'] } }, 4], [{ ret: {} }, 1], [{ throw: storeErr(g) }, 1]]);
    },
  },
  'GET /workspace/:urlKey/api/dispatch': {
    lane: 'session', weight: 2,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'GET'; sc.path = W(urlKeyFor(g, keys));
      const now = sc.clockBase;
      sc.stores.dispatchQueueStore = { listItems: g.weighted([[{ ret: [] }, 2], [{ ret: [{ id: 'i1', prompt: 'exchange: curl -X POST -H "Authorization: Bearer hb_abcdefabcdefabcdefabcdefabcdefab" x', dispatchedBy: g.pick(['acct-owner', 'acct-member']), bootstrapToken: 'hb_secret', declaredMint: g.pick([true, undefined]) }, { id: 'i2', prompt: 'plain', dispatchedBy: 'acct-owner' }] }, 5], [{ throw: storeErr(g) }, 1]]) };
      const tl = tokenLists(g, now);
      sc.stores.dispatchTokenStore = { listTokens: { ret: tl.dispatchTokens } };
      sc.stores.proxyTokenStore = { listTokens: { ret: tl.proxyTokens } };
    },
  },
  'GET /workspace/:urlKey/api/dispatch/count': {
    lane: 'session', weight: 1,
    gen(g, sc) { const { session: s, keys } = session(g); sc.session = s; sc.method = 'GET'; sc.path = `${W(urlKeyFor(g, keys))}/count`; sc.stores.dispatchQueueStore = { countItems: g.weighted([[{ ret: g.int(0, 9) }, 6], [{ throw: storeErr(g) }, 1]]) }; },
  },
  'GET /workspace/:urlKey/api/dispatch/quota': {
    lane: 'session', weight: 1,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'GET'; sc.path = `${W(urlKeyFor(g, keys))}/quota`;
      sc.env.OPENROUTER_FREE_TIER_KEY = g.chance(0.7) ? 'sk-free' : undefined;
      sc.stores.freeTierStore = { getRunUsage: g.weighted([[{ ret: { runsUsed: 3, limit: 10, remaining: 7, resetsAt: '2026-10-02T00:00:00.000Z' } }, 6], [{ throw: storeErr(g) }, 1]]) };
      sc.stores.accountStore = { resolveCanonicalAccountId: g.weighted([[{ ret: 'acct-canon' }, 4], [{ throw: storeErr(g) }, 1]]), listMergedAccounts: { ret: [{ _id: 'acct-b' }] } };
    },
  },
  'GET /workspace/:urlKey/api/dispatch/history': {
    lane: 'session', weight: 1.5,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'GET';
      const q = [];
      if (g.chance(0.6)) q.push(`limit=${g.pick(['5', '0', '500', 'abc', '-3', '100', ''])}`);
      if (g.chance(0.5)) q.push(`offset=${g.pick(['10', '-1', 'x', '0'])}`);
      sc.path = `${W(urlKeyFor(g, keys))}/history${q.length ? `?${q.join('&')}` : ''}`;
      sc.stores.dispatchQueueStore = { listHistory: g.weighted([[{ ret: { items: [{ id: 'h1', prompt: 'Bearer hb_abcdefabcdefabcdefabcdefabcdefab', dispatchedBy: 'acct-member' }], total: 1 } }, 5], [{ ret: { items: [], total: 0, extra: 'kept' } }, 1], [{ throw: storeErr(g) }, 1]]) };
    },
  },
  'GET /workspace/:urlKey/api/dispatch/recent-prompts': {
    lane: 'session', weight: 1,
    gen(g, sc) { const { session: s, keys } = session(g); sc.session = s; sc.method = 'GET'; sc.path = `${W(urlKeyFor(g, keys))}/recent-prompts`; sc.stores.userPreferencesStore = { getUserPreferences: g.weighted([[{ ret: { recentCustomPrompts: { acme: ['a', 'b'] } } }, 4], [{ ret: {} }, 2], [{ throw: storeErr(g) }, 1]]) }; },
  },
  'POST /workspace/:urlKey/api/dispatch/recent-prompts': {
    lane: 'session', weight: 1.2,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'POST'; sc.path = `${W(urlKeyFor(g, keys))}/recent-prompts`;
      sc.body = encodeBody(g, { prompt: g.weighted([['a', 3], ['  padded  ', 2], ['b', 2], ['x'.repeat(10001), 1], ['bad\u0001', 1], ['', 1], [5, 1], [undefined, 1]]) });
      sc.stores.userPreferencesStore = { getUserPreferences: g.weighted([[{ ret: { theme: 'dark', recentCustomPrompts: { acme: ['a', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'], other: ['z'] } } }, 4], [{ ret: {} }, 2], [{ throw: storeErr(g) }, 1]]), saveUserPreferences: g.weighted([[{ ret: undefined }, 5], [{ throw: storeErr(g) }, 1]]) };
    },
  },
  'GET /workspace/:urlKey/api/dispatch/favorite-prompts': {
    lane: 'session', weight: 1,
    gen(g, sc) { const { session: s, keys } = session(g); sc.session = s; sc.method = 'GET'; sc.path = `${W(urlKeyFor(g, keys))}/favorite-prompts`; sc.stores.userPreferencesStore = { getFavoritePrompts: g.weighted([[{ ret: ['fav'] }, 4], [{ throw: storeErr(g) }, 1]]) }; },
  },
  'POST /workspace/:urlKey/api/dispatch/favorite-prompts': {
    lane: 'session', weight: 1.2,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'POST'; sc.path = `${W(urlKeyFor(g, keys))}/favorite-prompts`;
      sc.body = encodeBody(g, { prompt: g.weighted([['fav', 4], [' sp ', 1], ['x'.repeat(10001), 1], ['bad\u0001', 1], ['', 1], [null, 1]]) });
      sc.stores.userPreferencesStore = { addFavoritePrompt: g.weighted([[{ ret: ['fav'] }, 4], [{ throw: { kind: 'plain', message: 'maximum of 50 favourites' } }, 1]]) };
    },
  },
  'DELETE /workspace/:urlKey/api/dispatch/favorite-prompts': {
    lane: 'session', weight: 1.2,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'DELETE';
      const viaQuery = g.chance(0.35);
      sc.path = `${W(urlKeyFor(g, keys))}/favorite-prompts${viaQuery ? `?prompt=${g.pick(['fav', '%20sp%20', ''])}` : ''}`;
      if (!viaQuery || g.chance(0.3)) sc.body = encodeBody(g, { prompt: g.weighted([['fav', 4], [' sp ', 1], ['', 1], [7, 1], [undefined, 1]]) });
      sc.stores.userPreferencesStore = { removeFavoritePrompt: g.weighted([[{ ret: [] }, 4], [{ throw: storeErr(g) }, 1]]) };
    },
  },
  'GET /workspace/:urlKey/api/dispatch/halt': {
    lane: 'session', weight: 1,
    gen(g, sc) { const { session: s, keys } = session(g); sc.session = s; sc.method = 'GET'; sc.path = `${W(urlKeyFor(g, keys))}/halt`; sc.stores.workspaceHaltStore = { getWorkspaceHalt: g.weighted([[{ ret: null }, 3], [{ ret: { mode: 'pause', setAt: '2026-10-01T00:00:00.000Z', setBy: 'acct-owner', urlKey: 'acme', _id: 'h' } }, 3], [{ throw: storeErr(g) }, 1]]) }; },
  },
  'POST /workspace/:urlKey/api/dispatch/halt': {
    lane: 'session', weight: 1.2,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'POST'; sc.path = `${W(urlKeyFor(g, keys))}/halt`;
      sc.body = encodeBody(g, { mode: g.weighted([['pause', 4], ['stop', 3], ['resume', 1], [undefined, 1], [1, 1]]) });
      sc.ownerCheck = ownerCheck(g);
      sc.stores.workspaceHaltStore = { setWorkspaceHalt: g.weighted([[{ ret: undefined }, 5], [{ throw: storeErr(g) }, 1]]) };
    },
  },
  'DELETE /workspace/:urlKey/api/dispatch/halt': {
    lane: 'session', weight: 1,
    gen(g, sc) { const { session: s, keys } = session(g); sc.session = s; sc.method = 'DELETE'; sc.path = `${W(urlKeyFor(g, keys))}/halt`; sc.ownerCheck = ownerCheck(g); sc.stores.workspaceHaltStore = { clearWorkspaceHalt: g.weighted([[{ ret: undefined }, 5], [{ throw: storeErr(g) }, 1]]) }; },
  },
  'DELETE /workspace/:urlKey/api/dispatch/:itemId': {
    lane: 'session', weight: 1.3,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'DELETE';
      sc.path = `${W(urlKeyFor(g, keys))}/${g.weighted([[uuidish(g), 9], ['not-a-uuid', 1]])}`;
      sc.ownerCheck = ownerCheck(g);
      sc.stores.dispatchQueueStore = {
        getItemStatus: g.weighted([[{ ret: { target: g.pick(['cli', 'web', 'dash', 'local', undefined]), bootstrapToken: 'hb_secret' } }, 6], [{ ret: null }, 2], [{ throw: storeErr(g) }, 1]]),
        removeItem: g.weighted([[{ ret: true }, 5], [{ ret: false }, 2], [{ throw: storeErr(g) }, 1]]),
      };
    },
  },
  'PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim': {
    lane: 'session', weight: 1.4,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'PATCH';
      sc.path = `${W(urlKeyFor(g, keys))}/${g.weighted([[uuidish(g), 9], ['nope', 1]])}/trim`;
      sc.body = encodeBody(g, g.chance(0.9) ? { maxTasks: g.weighted([[2, 5], [1, 2], [0, 1], [2.5, 1], ['3', 1], [undefined, 1]]) } : {});
      sc.ownerCheck = ownerCheck(g);
      sc.stores.dispatchQueueStore = {
        getItemStatus: g.weighted([[{ ret: { target: g.pick(['cli', 'dash', undefined]) } }, 6], [{ ret: null }, 2], [{ throw: storeErr(g) }, 1]]),
        trimSessionBudget: g.weighted([[{ ret: { ok: true, item: { id: 's', maxTasks: 2, prompt: 'Bearer hb_abcdefabcdefabcdefabcdefabcdefab', dispatchedBy: g.pick(['acct-owner', 'acct-member']), bootstrapToken: 'hb_secret' } } }, 5], [{ ret: { ok: false, reason: 'not-found' } }, 2], [{ ret: { ok: false, reason: 'not-downward' } }, 2], [{ throw: storeErr(g) }, 1]]),
      };
    },
  },
  'POST /workspace/:urlKey/api/dispatch/tokens': {
    lane: 'session', weight: 1.3,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'POST'; sc.path = `${W(urlKeyFor(g, keys))}/tokens`;
      sc.body = encodeBody(g, g.chance(0.8) ? { label: g.weighted([['my runner', 5], ['l'.repeat(1001), 1], ['', 1], [undefined, 1], [['arr'], 1]]) } : {});
      sc.ownerCheck = ownerCheck(g);
      sc.stores.dispatchTokenStore = { createToken: g.weighted([[{ ret: { tokenId: 't1', token: 'hbd_plain', label: 'my runner' } }, 5], [{ throw: storeErr(g) }, 1]]) };
    },
  },
  'GET /workspace/:urlKey/api/dispatch/tokens': {
    lane: 'session', weight: 1,
    gen(g, sc) { const { session: s, keys } = session(g); sc.session = s; sc.method = 'GET'; sc.path = `${W(urlKeyFor(g, keys))}/tokens`; sc.stores.dispatchTokenStore = { listTokens: g.weighted([[{ ret: [{ tokenId: 't1', label: 'l', hasOwner: true }] }, 5], [{ throw: storeErr(g) }, 1]]) }; },
  },
  'DELETE /workspace/:urlKey/api/dispatch/tokens/:tokenId': {
    lane: 'session', weight: 1.2,
    gen(g, sc) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'DELETE';
      sc.path = `${W(urlKeyFor(g, keys))}/tokens/${g.weighted([[uuidish(g), 9], ['bad', 1]])}`;
      sc.ownerCheck = ownerCheck(g);
      sc.stores.dispatchTokenStore = { revokeToken: g.weighted([[{ ret: true }, 5], [{ ret: false }, 2], [{ throw: storeErr(g) }, 1]]) };
    },
  },
  'GET /workspace/:urlKey/api/dispatch/presets': {
    lane: 'session', weight: 1,
    gen(g, sc) { const { session: s, keys } = session(g); sc.session = s; sc.method = 'GET'; sc.path = `${W(urlKeyFor(g, keys))}/presets`; sc.stores.dispatchPresetsStore = { list: g.weighted([[{ ret: [{ id: 'p1', name: 'Fast' }] }, 5], [{ throw: storeErr(g) }, 1]]) }; },
  },
  'POST /workspace/:urlKey/api/dispatch/presets': {
    lane: 'session', weight: 1.6,
    gen(g, sc, K) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'POST'; sc.path = `${W(urlKeyFor(g, keys))}/presets`;
      sc.body = encodeBody(g, presetBody(g, K));
      sc.stores.dispatchPresetsStore = { createCustom: g.weighted([[{ ret: { id: 'pn', name: 'N' } }, 5], [{ throw: { kind: 'plain', message: g.pick(['name is required', 'name must be 50 characters or less', 'maximum of 20 presets', 'db exploded', '']) } }, 2]]) };
    },
  },
  'PATCH /workspace/:urlKey/api/dispatch/presets/:presetId': {
    lane: 'session', weight: 1.6,
    gen(g, sc, K) {
      const { session: s, keys } = session(g); sc.session = s; sc.method = 'PATCH'; sc.path = `${W(urlKeyFor(g, keys))}/presets/${g.pick(['p1', 'p2', 'missing'])}`;
      sc.body = encodeBody(g, presetBody(g, K));
      sc.stores.dispatchPresetsStore = {
        get: g.weighted([[{ ret: { id: 'p1', name: 'Old', config: { model: 'm', byKind: { plan: { model: 'pm' } } } } }, 5], [{ ret: { id: 'p1', name: 'Old' } }, 1], [{ ret: null }, 2], [{ throw: storeErr(g) }, 1]]),
        update: g.weighted([[{ ret: { id: 'p1', name: 'New' } }, 5], [{ ret: null }, 1], [{ throw: { kind: 'plain', message: g.pick(['config must be an object', 'boom']) } }, 1]]),
      };
    },
  },
  'DELETE /workspace/:urlKey/api/dispatch/presets/:presetId': {
    lane: 'session', weight: 1,
    gen(g, sc) { const { session: s, keys } = session(g); sc.session = s; sc.method = 'DELETE'; sc.path = `${W(urlKeyFor(g, keys))}/presets/${g.pick(['p1', 'gone'])}`; sc.stores.dispatchPresetsStore = { delete: g.weighted([[{ ret: true }, 4], [{ ret: false }, 2], [{ throw: storeErr(g) }, 1]]) }; },
  },
  'GET /api/dispatch/poll': {
    lane: 'session', weight: 1.5,
    gen(g, sc) {
      sc.method = 'GET'; sc.path = '/api/dispatch/poll'; sc.session = {};
      sc.headers.authorization = dispatchAuth(g, sc.stores);
      sc.stores.dispatchQueueStore = { pollAvailable: g.weighted([[{ ret: [{ id: 'q1', prompt: 'p', bootstrapToken: 'hb_live' }] }, 5], [{ ret: [] }, 2], [{ throw: storeErr(g) }, 1], [{ delayMs: 3000, ret: [] }, 1]]) };
      sc.stores.workspaceHaltStore = {
        getWorkspaceHalt: g.weighted([[{ ret: null }, 4], [{ ret: { mode: 'stop', setAt: 'x', setBy: 'a', extra: 1 } }, 3], [{ throw: storeErr(g) }, 1], [{ hang: true }, 1], [{ delayMs: 1600, ret: { mode: 'pause' } }, 1], [{ delayMs: 1400, ret: { mode: 'pause' } }, 1]]),
        getLastKnownHalt: g.weighted([[{ ret: null }, 2], [{ ret: { mode: 'pause', setAt: 'cached', setBy: 'b' } }, 2]]),
      };
    },
  },
  'POST /api/dispatch/broker-token': {
    lane: 'session', weight: 4,
    gen(g, sc) {
      sc.method = 'POST'; sc.path = '/api/dispatch/broker-token'; sc.session = {};
      sc.headers.authorization = dispatchAuth(g, sc.stores);
      sc.env.DISPATCH_OWNERLESS_BROKER_COMPAT = g.weighted([[undefined, 3], ['off', 2], ['no', 1]]);
      const now = sc.clockBase;
      const itemId = g.weighted([[undefined, 4], [uuidish(g), 8], ['not-a-uuid', 1], [42, 1]]);
      if (itemId !== undefined || g.chance(0.3)) sc.body = encodeBody(g, itemId === undefined ? {} : { itemId });
      const q = sc.stores.dispatchQueueStore = {};
      q.getGrantDeclaration = g.weighted([
        [{ ret: { state: 'none' } }, 2], [{ ret: { state: 'row-missing' } }, 1], [{ throw: storeErr(g) }, 1],
        [{ ret: { state: 'record', record: { grants: ['dispatch'], workspaceId: 'ws-acme', site: 'M1', ownerAccountId: g.weighted([['acct-owner', 6], ['acct-other', 2], ['', 1], [undefined, 1]]) } } }, 7],
      ]);
      const label = sc.stores.dispatchTokenStore.validateToken?.ret?.label;
      const rowSpec = g.weighted([
        [{ ret: { status: 'taken', takenByTokenLabel: g.weighted([[label, 8], ['someone-else', 2]]), feedback: g.weighted([[[], 6], [[{ message: '[done] x', timestamp: iso(now - 100) }], 2]]) } }, 10],
        [{ ret: { status: g.pick(['expired', 'cancelled', 'queued']) } }, 2], [{ ret: null }, 1], [{ throw: storeErr(g) }, 1],
      ]);
      // getItemStatus: B2 read, then (inside provisionResumeCredential) nothing — the helper re-reads the declaration
      q.getItemStatus = rowSpec;
      sc.stores.proxyTokenStore = {
        createToken: g.weighted([[{ ret: { token: 'hb_refire', expiresAt: iso(now + 172_800_000) } }, 6], [{ ret: {} }, 1], [{ throw: storeErr(g) }, 1]]),
        mintGrantBootstrap: g.weighted([[{ ret: { token: 'hb_grant', workspaceId: 'ws-acme' } }, 6], [{ ret: {} }, 1], [{ throw: { kind: 'coded', code: 'GRANT_OWNER_ONLY', status: 403 } }, 1], [{ throw: { kind: 'coded', code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true } }, 1], [{ throw: storeErr(g) }, 1]]),
      };
      if (g.chance(0.2)) q.getGrantDeclaration = { seq: [q.getGrantDeclaration, g.pick([{ ret: { state: 'none' } }, { throw: storeErr(g) }])] };
    },
  },
  'POST /api/dispatch/take/:itemId': {
    lane: 'session', weight: 1.2,
    gen(g, sc) {
      sc.method = 'POST'; sc.path = `/api/dispatch/take/${g.weighted([[uuidish(g), 9], ['zzz', 1]])}`; sc.session = {};
      sc.headers.authorization = dispatchAuth(g, sc.stores);
      sc.stores.dispatchQueueStore = { takeItem: g.weighted([[{ ret: { id: 'take-1', prompt: 'p', bootstrapToken: 'hb_live' } }, 6], [{ ret: null }, 2], [{ throw: storeErr(g) }, 1]]) };
    },
  },
  'POST /api/dispatch/feedback/:itemId': {
    lane: 'session', weight: 3,
    gen(g, sc, K) {
      sc.method = 'POST'; sc.path = `/api/dispatch/feedback/${g.weighted([[uuidish(g), 9], ['bad', 1]])}`; sc.session = {};
      sc.headers.authorization = dispatchAuth(g, sc.stores);
      sc.stores.harbourFeedbackTokenStore = { validateAndConsume: g.weighted([[{ ret: null }, 6], [{ ret: { urlKey: 'acme' } }, 2], [{ throw: storeErr(g) }, 1]]) };
      const kind = g.weighted([[undefined, 4], [g.pick(K.FEEDBACK_ENTRY_KINDS), 3], ['decision-withdrawn', 2], ['made-up', 1]]);
      let message = g.weighted([['[done] shipped PR', 6], ['m'.repeat(2001), 1], ['bad\u0001', 1], ['', 1], [5, 1]]);
      if (kind === 'decision-withdrawn') message = g.weighted([[JSON.stringify({ decision_id: 'd1', reason: 'superseded' }), 4], ['not json', 1], [JSON.stringify({ decision_id: ' ', reason: 'r' }), 1]]);
      const body = { message, kind };
      if (g.chance(0.3)) body.url = g.weighted([['https://github.com/o/r/pull/1', 4], ['ftp://x', 1], ['not a url', 1], ['u'.repeat(8001), 1]]);
      if (g.chance(0.2)) body.urlLabel = g.weighted([['PR', 4], ['l'.repeat(1001), 1], ['bad\u0002', 1]]);
      if (g.chance(0.2)) body.rootItemId = g.pick([uuidish(g), 'not-uuid']);
      sc.body = encodeBody(g, body);
      sc.stores.dispatchQueueStore = {
        addFeedback: g.weighted([[{ ret: { success: true, wake: { queued: g.chance(0.5) } } }, 6], [{ ret: null }, 2], [{ throw: storeErr(g) }, 1], [{ callProvisioner: [g.pick(['claude-code', 'codex', null]), g.pick([null, { grants: ['dispatch'], workspaceId: 'ws-acme', site: 'M1', ownerAccountId: 'acct-owner' }])], ret: { success: true, provisioned: true } }, 3]]),
      };
      sc.stores.proxyTokenStore = { createToken: g.weighted([[{ ret: { token: 'hb_wake' } }, 4], [{ ret: {} }, 1], [{ throw: storeErr(g) }, 1]]), mintGrantBootstrap: g.weighted([[{ ret: { token: 'hb_wg', workspaceId: 'ws-acme' } }, 3], [{ throw: { kind: 'coded', code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true } }, 1], [{ throw: { kind: 'coded', code: 'GRANT_OWNER_ONLY', status: 403 } }, 1]]) };
    },
  },
  // ---------------- proxy lane: proxy-kickoff.js ----------------
  'GET /api/proxy/autopilot/kickoff': {
    lane: 'proxy', weight: 1.2,
    gen(g, sc) {
      sc.method = 'GET'; sc.headers.authorization = proxyAuth(g, sc.stores);
      const q = [];
      if (g.chance(0.5)) q.push(`mode=${g.pick(['write', 'readonly', 'bogus'])}`);
      if (g.chance(0.5)) q.push(`variant=${g.pick(['standard', 'stepper', 'x'])}`);
      if (g.chance(0.5)) q.push(`goal=${encodeURIComponent(g.pick(['ship it', 'g'.repeat(1500), 'Ünï ✓']))}`);
      if (g.chance(0.1)) q.push('goal=a&goal=b');
      sc.path = `/api/proxy/autopilot/kickoff${q.length ? `?${q.join('&')}` : ''}`;
    },
  },
  'POST /api/proxy/autopilot/kickoff': {
    lane: 'proxy', weight: 8,
    gen(g, sc, K) {
      sc.method = 'POST'; sc.path = '/api/proxy/autopilot/kickoff';
      const clean = g.chance(0.6);
      const pv = (valid, invalid, pBad = 0.3) => (!clean && g.chance(pBad) ? g.pick(invalid) : g.pick(valid));
      sc.headers.authorization = proxyAuth(g, sc.stores, { needWrite: true, clean });
      const now = sc.clockBase;
      const b = {};
      const scoped = g.chance(0.55);
      sc.intent = `${scoped ? 'scoped' : 'general'}${clean ? ':clean' : ''}`;
      if (scoped) b.issueIdentifier = pv(IDS, BAD_IDS, 0.07);
      if (g.chance(0.6)) b.goal = pv(['Walk the stack', 'Ünï ✓ goal'], ['g'.repeat(100_001), 'bad\u0001', 5]);
      if (g.chance(0.3)) b.mode = pv(['write', 'readonly'], ['nope']);
      if (g.chance(0.3)) b.variant = pv(['standard', 'stepper'], ['nope']);
      if (g.chance(0.2)) b.target = pv(['cli', 'web', 'dash'], ['local']);
      if (g.chance(0.15)) b.repo = pv(['org/repo'], ['r'.repeat(1001)]);
      if (g.chance(0.25)) b.sessionId = pv([uuidish(g)], ['__meta__', '']);
      if (g.chance(0.2)) b.subscription = pv(['everything', 'terminal-only'], ['nah']);
      if (g.chance(0.12)) b.model = pv(['model-a'], ['x'.repeat(1001)]);
      if (g.chance(0.12)) b.harness = pv(['claude-code', 'codex'], ['bad\u0002']);
      if (g.chance(0.12)) b.effort = pv(['high', 'ultra'], [9]);
      if (g.chance(0.15)) b.presetId = pv(['p1', null], ['', 3]);
      if (g.chance(0.2)) b.maxTasks = pv([1, 4, null], [0, '2']);
      if (g.chance(0.15)) b.appendProxyContext = g.pick([false, true, 'no']);
      if (g.chance(0.1)) b.issueSource = g.pick(['linear', 'github', ' ']);
      sc.body = clean ? jsonBody(b) : encodeBody(g, b, 0.06);
      sc.access = accessSpec(g, now, clean); sc.provider = providerSpec(g, clean); sc.registry = registryState(g);
      sc.promptCtx = promptCtxSpec(g, K, b.issueIdentifier);
      sc.orKey = g.weighted([[{ ret: 'sk-or-creator' }, 5], [{ ret: null }, 4], [{ throw: { kind: 'plain', message: 'key lookup failed' } }, 1]]);
      sc.stores.dispatchPresetsStore = { get: presetSpec(g) };
      factoryWorld(g, now, sc.stores, { sessionId: b.sessionId, issueIdentifier: b.issueIdentifier });
      // parent-run read (kickoff's own) precedes the factory's run read
      if (b.sessionId) sc.stores.dispatchQueueStore.getItemStatus = g.weighted([[{ ret: { stopAt: 'pr', maxTasks: 3, id: b.sessionId } }, 4], [{ ret: { maxTasks: 1 } }, 2], [{ ret: null }, 1], [{ throw: storeErr(g) }, 1]]);
      if (g.chance(0.04)) sc.storeMissingOps = { dispatchQueueStore: ['getItemStatus'] };
      if (g.chance(0.04)) sc.limiter = 'block';
    },
  },
  'GET /api/proxy/autopilot/manual': {
    lane: 'proxy', weight: 1,
    gen(g, sc) { sc.method = 'GET'; sc.path = '/api/proxy/autopilot/manual'; sc.headers.authorization = proxyAuth(g, sc.stores); if (g.chance(0.04)) sc.limiter = 'block'; },
  },
  'GET /api/proxy/passage-runner/prompt': {
    lane: 'proxy', weight: 1,
    gen(g, sc) { sc.method = 'GET'; sc.path = '/api/proxy/passage-runner/prompt'; sc.headers.authorization = proxyAuth(g, sc.stores); if (g.chance(0.04)) sc.limiter = 'block'; },
  },
  // ---------------- proxy lane: proxy-dispatch.js ----------------
  'POST /api/proxy/dispatch': {
    lane: 'proxy', weight: 12,
    gen(g, sc, K) {
      sc.method = 'POST'; sc.path = '/api/proxy/dispatch';
      const clean = g.chance(0.6);
      sc.headers.authorization = proxyAuth(g, sc.stores, { needWrite: true, clean });
      const now = sc.clockBase;
      const mode = g.weighted([['fresh', 25], ['issue', 30], ['followUp', 15], ['abort', 10], ['cascade', 7], ['repo', 8], ['free', 5]]);
      sc.intent = `${mode}${clean ? ':clean' : ''}`;
      const b = sessionDispatchBody(g, now, mode === 'repo' ? 'fresh' : mode === 'free' ? 'free' : mode, clean);
      if (clean && b.target === 'local') b.target = 'cli';
      if (mode === 'repo') b.repo = g.pick(['org/repo', 'https://github.com/org/repo']);
      delete b.attachProxy; delete b.entryRung; delete b.surface; delete b.stopAt; delete b.variant;
      if (g.chance(0.3)) b.appendProxyContext = g.pick([false, true, 'yes']);
      sc.body = clean ? jsonBody(b) : encodeBody(g, b, 0.06);
      sc.access = accessSpec(g, now, clean); sc.provider = providerSpec(g, clean); sc.registry = registryState(g);
      sc.orKey = g.weighted([[{ ret: 'sk-or-creator' }, 5], [{ ret: null }, 4], [{ throw: { kind: 'plain', message: 'key lookup failed' } }, 1]]);
      factoryWorld(g, now, sc.stores, { sessionId: b.sessionId, followUpTo: b.followUpTo, issueIdentifier: b.issueIdentifier });
      if (mode === 'cascade') sc.stores.dispatchQueueStore.expandCascadeAborts = g.weighted([[{ ret: { aborted: 1, ids: ['c'] } }, 4], [{ throw: storeErr(g) }, 1]]);
      if (g.chance(0.04)) sc.limiter = 'block';
    },
  },
  'POST /api/proxy/recommend-and-dispatch': {
    lane: 'proxy', weight: 12,
    gen(g, sc, K) {
      sc.method = 'POST'; sc.path = '/api/proxy/recommend-and-dispatch';
      const clean = g.chance(0.6);
      const pv = (valid, invalid, pBad = 0.3) => (!clean && g.chance(pBad) ? g.pick(invalid) : g.pick(valid));
      sc.headers.authorization = proxyAuth(g, sc.stores, { needWrite: true, clean });
      const now = sc.clockBase;
      const b = { issueIdentifier: pv(IDS, BAD_IDS.concat([undefined]), 0.06) };
      const override = g.chance(0.45);
      sc.intent = `${override ? 'override' : 'llm'}${clean ? ':clean' : ''}`;
      if (override) b.kind = pv(K.TEMPLATE_KEYS, ['autopilot', 'custom', 'nope', 5], 0.08);
      if (g.chance(0.15)) b.target = pv(['cli', 'web', 'dash'], ['local']);
      if (g.chance(0.1)) b.noDescend = pv([true, false], ['yes']);
      if (g.chance(0.08)) b.waitForFollowUps = pv([true, false], ['no']);
      if (g.chance(0.08)) b.queueIfBusy = pv([true], [0]);
      if (g.chance(0.1)) b.subscription = pv(['everything', 'terminal-only'], ['nah']);
      if (g.chance(0.12)) b.repo = pv(['org/repo'], ['r'.repeat(1001), 'bad\u0003']);
      if (g.chance(0.1)) b.model = pv(['model-a'], ['m'.repeat(1001)]);
      if (g.chance(0.1)) b.harness = pv(['claude-code', 'codex'], [7]);
      if (g.chance(0.1)) b.effort = pv(['low', 'mega'], ['bad\u0004']);
      if (g.chance(0.12)) b.periodicalId = pv(['security-review'], ['nope']);
      if (g.chance(0.15)) b.sessionId = pv([uuidish(g)], ['__meta__', 's'.repeat(129)]);
      if (g.chance(0.18)) b.followUpTo = pv([uuidish(g)], ['bad']);
      if (b.followUpTo && clean && b.target === 'dash') b.target = 'web';
      if (g.chance(0.12)) b.force = pv([true, false], ['true']);
      if (g.chance(0.25)) b.appendProxyContext = g.pick([false, true]);
      if (g.chance(0.08)) b.issueSource = g.pick(['github', 'linear']);
      sc.body = clean ? jsonBody(b) : encodeBody(g, b, 0.06);
      sc.access = accessSpec(g, now, clean); sc.provider = providerSpec(g, clean); sc.registry = registryState(g);
      sc.promptCtx = promptCtxSpec(g, K, b.issueIdentifier);
      sc.recs = recsSpec(g, typeof b.issueIdentifier === 'string' ? b.issueIdentifier : 'LIN-42');
      sc.orKey = g.weighted([[{ ret: 'sk-or-creator' }, 6], [{ ret: null }, 4], [{ throw: { kind: 'plain', message: 'key lookup failed' } }, 1]]);
      sc.stores.freeTierStore = { tryUse: g.weighted([[{ ret: { allowed: true } }, 3], [{ ret: { allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 10, resetsAt: iso(now + 3_600_000) } }, 1]]) };
      factoryWorld(g, now, sc.stores, { sessionId: b.sessionId, followUpTo: b.followUpTo, issueIdentifier: b.issueIdentifier });
      if (g.chance(0.04)) sc.limiter = 'block';
      if (g.chance(0.15)) sc.headers['x-request-start'] = String(g.pick([now - 5000, (now - 18_000) * 1000, Math.floor((now - 2000) / 1000), now + 1000, 'garbage']));
    },
  },
  'GET /api/proxy/dispatch': {
    lane: 'proxy', weight: 5,
    gen(g, sc) {
      sc.method = 'GET'; sc.headers.authorization = proxyAuth(g, sc.stores);
      const now = sc.clockBase;
      const q = [];
      if (g.chance(0.4)) q.push(`limit=${g.pick(['5', '0', '1000', 'x', '2'])}`);
      if (g.chance(0.3)) q.push(`issueIdentifier=${encodeURIComponent(g.pick(['LIN-42', 'X'.repeat(101), 'bad\u0001']))}`);
      if (g.chance(0.35)) q.push(`status=${encodeURIComponent(g.pick(['queued', 'taken', 'done', 'failed', 'blocked', 'aborted', 'closed', 'cancelled', 's'.repeat(1001), 'bad\u0002']))}`);
      sc.path = `/api/proxy/dispatch${q.length ? `?${q.join('&')}` : ''}`;
      const root = uuidish(g);
      const mk = (o) => ({ id: uuidish(g), promptName: 'P', kind: g.pick(['implementation', undefined, 'wake']), issueIdentifier: 'LIN-42', issueUrl: 'u', target: 'cli', dispatchedAt: iso(now - g.int(1, 9) * 60_000), consumerLastSeenAt: g.pick([null, iso(now - 100)]), sessionId: g.pick([null, 's1']), maxTasks: g.pick([null, 3]), ...o });
      const abortRowTarget = uuidish(g);
      const history = [
        mk({ status: 'taken', rootItemId: root, feedback: [{ message: '[done] ok', timestamp: iso(now - 30_000) }], resolvedAt: iso(now - 40_000) }),
        mk({ id: abortRowTarget, status: 'taken', feedback: [{ message: 'working', timestamp: iso(now - 50_000), rootItemId: root }] }),
        mk({ status: 'taken', abort: true, abortTo: abortRowTarget, issueIdentifier: null, feedback: [{ message: '[aborted] stop', timestamp: iso(now - 20_000) }] }),
        mk({ status: 'cancelled', feedback: [] }), mk({ status: 'expired' }),
        mk({ status: 'taken', bookkeeping: g.pick([{ closed: true, closedAt: iso(now - 1000), reason: 'source' }, undefined]), feedback: [{ message: '[PENDING] need a human', timestamp: iso(now - 10_000) }] }),
      ].filter(() => g.chance(0.8));
      sc.stores.dispatchQueueStore = {
        listItems: g.weighted([[{ ret: [mk({}), mk({})] }, 4], [{ ret: [] }, 2], [{ throw: storeErr(g) }, 1]]),
        listHistory: { seq: [g.weighted([[{ ret: { items: history, total: g.pick([history.length, history.length + 300, undefined]) } }, 6], [{ throw: storeErr(g) }, 1]]), g.weighted([[{ ret: { items: [mk({ status: 'taken', rootItemId: root, feedback: [{ message: '[failed] x', timestamp: iso(now - 5000) }] })], total: g.pick([1, 2500]) } }, 5], [{ throw: storeErr(g) }, 1]])] },
      };
      const tl = tokenLists(g, now);
      sc.stores.dispatchTokenStore = { listTokens: { ret: tl.dispatchTokens } };
      sc.stores.proxyTokenStore.listTokens = { ret: tl.proxyTokens };
      if (g.chance(0.04)) sc.limiter = 'block';
    },
  },
  'GET /api/proxy/dispatch/:id': {
    lane: 'proxy', weight: 5,
    gen(g, sc) {
      sc.method = 'GET'; sc.headers.authorization = proxyAuth(g, sc.stores);
      const now = sc.clockBase;
      const id = g.weighted([[uuidish(g), 8], ['short-id', 1], ['x'.repeat(101), 1], ['bad%01id', 1]]);
      const wait = g.weighted([[null, 5], ['3', 2], ['50', 1], ['999', 1], ['abc', 1], ['-4', 1], ['2.7', 1]]);
      sc.path = `/api/proxy/dispatch/${id}${wait !== null ? `?wait=${wait}` : ''}`;
      const row = (o = {}) => ({ id, status: g.pick(['queued', 'taken']), promptName: 'P', kind: g.pick(['implementation', 'wake', undefined]), issueIdentifier: 'LIN-1', issueUrl: 'u', target: 'cli', dispatchedAt: iso(now - 60_000), dispatchedBy: g.pick(['acct-owner', null]), model: g.pick([null, 'model-a']), maxTasks: g.pick([null, 2]), consumerLastSeenAt: g.pick([null, iso(now - 30 * 60_000)]), feedback: g.pick([[], [{ message: 'working', url: 'https://x', urlLabel: 'L', timestamp: iso(now - 1000), rootItemId: 'r', kind: 'evidence' }]]), bookkeeping: g.pick([undefined, { closed: true }]), ...o });
      const first = g.weighted([[{ ret: row() }, 7], [{ ret: row({ feedback: [{ message: '[done] x', timestamp: iso(now - 500) }] }) }, 2], [{ ret: null }, 1], [{ throw: storeErr(g) }, 1]]);
      const later = g.weighted([[{ ret: row({ feedback: [] }) }, 3], [{ ret: row({ status: 'taken', feedback: [{ message: '[failed] y', timestamp: iso(now) }] }) }, 2], [{ ret: null }, 1], [{ throw: storeErr(g) }, 1]]);
      const repeats = g.int(0, 30);
      sc.stores.dispatchQueueStore = {
        getItemStatus: { seq: [first, ...Array.from({ length: repeats }, () => ({ ret: first.ret ? { ...first.ret } : null })), later] },
        getWakeShadow: g.weighted([[{ ret: null }, 3], [{ ret: { wouldSkip: true, reason: 'repeat-same-target' } }, 3]]),
      };
      const tl = tokenLists(g, now);
      sc.stores.dispatchTokenStore = { listTokens: { ret: tl.dispatchTokens } };
      sc.stores.proxyTokenStore.listTokens = { ret: tl.proxyTokens };
      if (g.chance(0.1)) sc.clientAbortAfterMs = g.pick([4000, 30_000]);
      if (g.chance(0.04)) sc.limiter = 'block';
    },
  },
  'GET /api/proxy/dispatch/:id/prompt': {
    lane: 'proxy', weight: 1.5,
    gen(g, sc) {
      sc.method = 'GET'; sc.headers.authorization = proxyAuth(g, sc.stores);
      sc.path = `/api/proxy/dispatch/${g.weighted([[uuidish(g), 8], ['y'.repeat(101), 1], ['bad%7Fid', 1]])}/prompt`;
      sc.stores.dispatchQueueStore = { getItemStatus: g.weighted([[{ ret: { id: 'pid', promptName: 'P', kind: g.pick(['review', undefined]), prompt: g.pick(['plain', 'curl -H "Authorization: Bearer hb_abcdefabcdefabcdefabcdefabcdefab"', '', undefined]), dispatchedBy: g.pick(['acct-owner', 'acct-member', undefined]), issueIdentifier: g.pick(['LIN-1', undefined]), target: 'cli', followUpTo: g.pick([null, 'f']), sessionId: g.pick([undefined, 's']), dispatchedAt: '2026-10-01T00:00:00.000Z' } }, 6], [{ ret: null }, 2], [{ throw: storeErr(g) }, 1]]) };
      if (g.chance(0.04)) sc.limiter = 'block';
    },
  },
  'GET /api/proxy/wake-shadow': {
    lane: 'proxy', weight: 1,
    gen(g, sc) {
      sc.method = 'GET'; sc.headers.authorization = proxyAuth(g, sc.stores);
      sc.path = `/api/proxy/wake-shadow${g.chance(0.6) ? `?days=${g.pick(['3', '0', '99', 'x', '7.9', '-2', 'Infinity'])}` : ''}`;
      sc.stores.dispatchQueueStore = { getWakeShadowTally: g.weighted([[{ ret: { days: [{ day: '2026-10-01', minted: 2, wouldSkip: 1, byReason: { 'repeat-same-target': 1 } }], totals: { minted: 2, wouldSkip: 1, share: 0.5, byReason: {} } } }, 5], [{ throw: storeErr(g) }, 1]]) };
      if (g.chance(0.04)) sc.limiter = 'block';
    },
  },
  // ---------------- unmatched (both lanes) ----------------
  'UNMATCHED': {
    lane: 'either', weight: 1,
    gen(g, sc) {
      const { session: s } = session(g); sc.session = s;
      sc.lane = g.pick(['session', 'proxy']);
      if (sc.lane === 'proxy') sc.headers.authorization = proxyAuth(g, sc.stores, { needWrite: true });
      else sc.headers.authorization = dispatchAuth(g, sc.stores);
      [sc.method, sc.path] = g.pick([
        ['PUT', '/workspace/acme/api/dispatch'], ['GET', '/api/dispatch/take/abc'], ['GET', '/api/proxy/autopilot/kickoff/extra'],
        ['DELETE', '/api/proxy/dispatch/abc'], ['POST', '/api/proxy/dispatch/abc/prompt'], ['GET', '/workspace/acme/api/dispatch/tokens/x/y'],
        ['GET', '/API/PROXY/DISPATCH'], ['GET', '/api/proxy/dispatch/'], ['PATCH', '/workspace/acme/api/dispatch/halt'], ['GET', '/workspace/acme/api/dispatch/'],
        ['POST', '/api/proxy/Dispatch'], ['GET', '/api/proxy/wake-shadow/x'],
      ]);
      sc.stores.dispatchQueueStore = { getItemStatus: { ret: null } };
    },
  },
};

function presetBody(g, K) {
  const b = {};
  if (g.chance(0.8)) b.name = g.pick(['Fast', '', 'n'.repeat(60), 7]);
  if (g.chance(0.5)) b.model = g.pick(['model-a', '  model-b  ', '', 'm'.repeat(1001), 'bad\u0001', 3]);
  if (g.chance(0.4)) b.harness = g.pick(['claude-code', ' codex ', '', 9]);
  if (g.chance(0.3)) b.effort = g.pick(['high', '  ', 'x\u0002']);
  if (g.chance(0.5)) {
    b.byKind = g.weighted([
      [{ implementation: { model: ' model-a ', harness: 'claude-code', effort: 'max' }, plan: { model: '' }, bogus: { model: 'x' } }, 4],
      [{}, 2], [null, 1], [['arr'], 1], ['str', 1], [{ review: 'notobj' }, 1], [{ review: { model: 'm'.repeat(1001) } }, 1],
      [{ review: { harness: 5 } }, 1], [{ [g.pick(K.DDK)]: { effort: 'bad\u0003' } }, 1], [{ plan: null }, 1], [{ plan: ['a'] }, 1],
    ]);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Schedule + scenario
// ---------------------------------------------------------------------------
export const FORM_NAMES = Object.keys(FORMS);

/** Deterministic interleaved schedule: each form gets min(100, n/forms) slots, the rest by weight. */
export function schedule(seed, n, floors = {}) {
  const names = FORM_NAMES;
  const floor = Math.min(100, Math.floor(n / names.length));
  const counts = Object.fromEntries(names.map(k => [k, floor]));
  const rest = n - floor * names.length;
  const W = names.reduce((s, k) => s + FORMS[k].weight, 0);
  let given = 0;
  for (const k of names) { const c = Math.floor((rest * FORMS[k].weight) / W); counts[k] += c; given += c; }
  for (let i = 0; given < rest; i++, given++) counts[names[i % names.length]]++;
  // #4b: per-form floors (each dispatch entrance gets at least `floors[k]` generated requests)
  for (const [k, f] of Object.entries(floors)) if (k in counts && counts[k] < f) counts[k] = f;
  const list = names.flatMap(k => Array(counts[k]).fill(k));
  const g = new G(seed * 7919 + 13);
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(g.f() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}

export function baseScenario(tier, index, seed, form) {
  const g = new G(((seed * 1_000_003) ^ (index * 2_654_435_761) ^ (tier.length * 97)) >>> 0);
  const clockBase = FIXED_NOW + (tier === 'gen' ? 0 : tier === 'edge' ? 400_000_000 : 800_000_000) + index * STEP_MS;
  const sc = {
    tier, index, id: `${tier}:${index}`, routeKey: form, lane: FORMS[form]?.lane, variant: 'full',
    method: 'GET', path: '/', headers: { host: 'harbour.example' }, body: { kind: 'none' },
    clockBase, randomSeed: g.int(1, 2 ** 31 - 2), env: env(g), stores: {}, ids: { item: g.uuid() },
  };
  return { g, sc };
}

let ROUTE_MATCHERS = null;
const matchers = () => (ROUTE_MATCHERS ||= Object.keys(FORMS).filter(k => k !== 'UNMATCHED').map(k => {
  const [method, p] = k.split(' ');
  const re = new RegExp(`^${p.replace(/:[A-Za-z]+/g, '[^/]+')}/?$`);
  return { key: k, method, re };
}));
export function routeKeyFor(method, pathname) {
  // literal routes win over :param ones (registration order in the routers)
  const hits = matchers().filter(m => m.method === method && m.re.test(pathname));
  hits.sort((a, b) => (a.key.match(/:/g) || []).length - (b.key.match(/:/g) || []).length);
  return hits[0]?.key ?? null;
}


export function generateScenario(seed, i, K, form, { tier = 'gen', force = null } = {}) {
  const { g, sc } = baseScenario(tier, i, seed, form);
  if (force) sc.force = force;
  FORMS[form].gen(g, sc, K);
  if (sc.lane === 'session') sc.variant = g.weighted([['full', 82], ['sparse', 8], ['noStores', 10]]);
  else sc.variant = g.weighted([['full', 86], ['sparse', 9], ['noQueue', 5]]);
  if (force) applyForce(sc, force);
  if (form === 'UNMATCHED') {
    // Express matches case-insensitively and ignores a trailing slash: label by the route actually reached
    const p = new URL(sc.path, 'http://x').pathname.toLowerCase().replace(/\/$/, '');
    const hit = routeKeyFor(sc.method, p);
    if (hit && FORMS[hit].lane === sc.lane) sc.routeKey = hit;
  }
  return sc;
}

/** Edge-tier overrides: force one knob after normal generation. */
function applyForce(sc, force) {
  const set = (obj, keyPath, v) => { const ks = keyPath.split('.'); let o = obj; for (const k of ks.slice(0, -1)) o = (o[k] ||= {}); o[ks[ks.length - 1]] = v; };
  for (const [k, v] of Object.entries(force)) set(sc, k, v);
}
