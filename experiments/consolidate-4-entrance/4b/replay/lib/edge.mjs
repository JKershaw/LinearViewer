// Edge tier: targeted scenarios, each repeated `reps` times (the untouched
// parts of the world still vary by index), so every refusal / branch the
// random tier reaches only rarely is hit at least 5 times. Plus the
// test-captured tier (requests the existing unit tests send to these routers,
// recorded once into pinned/test-calls.json and replayed into a clean world).
import { readFileSync, existsSync } from 'node:fs';
import { generateScenario, FORMS, WORKSPACES, routeKeyFor } from './gen.mjs';
export { routeKeyFor };

const U1 = '11111111-1111-4111-a111-111111111111';
const U2 = '22222222-2222-4222-a222-222222222222';
const U3 = '33333333-3333-4333-a333-333333333333';
const SD = 'POST /workspace/:urlKey/api/dispatch';
const PD = 'POST /api/proxy/dispatch';
const RD = 'POST /api/proxy/recommend-and-dispatch';
const KO = 'POST /api/proxy/autopilot/kickoff';
const WATCH = 'GET /api/proxy/dispatch/:id';
const BROKER = 'POST /api/dispatch/broker-token';
const NOW = (sc) => sc.clockBase;
const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Clean bases
// ---------------------------------------------------------------------------
function cleanFactory(sc) {
  const q = (sc.stores.dispatchQueueStore ||= {});
  for (const k of ['addItem', 'countDistinctTasksForSession', 'getItemStatus', 'getGrantDeclaration', 'expandCascadeAborts', 'takeItem']) delete q[k];
  q.findRecentFreshDispatch = { ret: null };
  q.countPilotEligible = { ret: 1 };
  sc.stores.workspacePreferencesStore = { getWorkspacePreferences: { ret: {} } };
  sc.stores.freeTierStore = { checkRun: { ret: { allowed: true } }, tryUse: { ret: { allowed: true } } };
  const v = sc.stores.proxyTokenStore?.validateToken;
  const d = sc.stores.proxyTokenStore?.describeRejectionCause;
  sc.stores.proxyTokenStore = { createToken: { ret: { token: 'hb_boot_edge', expiresAt: iso(NOW(sc) + 172_800_000) } }, mintGrantBootstrap: { ret: { token: 'hb_grant_edge', workspaceId: 'ws-acme' } }, listTokens: { ret: [] } };
  if (v) sc.stores.proxyTokenStore.validateToken = v;
  if (d) sc.stores.proxyTokenStore.describeRejectionCause = d;
  const dv = sc.stores.dispatchTokenStore?.validateToken;
  sc.stores.dispatchTokenStore = { listTokens: { ret: [{ lastUsedAt: iso(NOW(sc) - 60_000) }] } };
  if (dv) sc.stores.dispatchTokenStore.validateToken = dv;
  delete sc.stores.accountStore;
  delete sc.addItemShape;
  sc.env = { NODE_ENV: 'test', OPENROUTER_API_KEY: undefined, OPENROUTER_FREE_TIER_KEY: undefined, DISPATCH_OWNERLESS_BROKER_COMPAT: undefined, HARBOUR_FILE_POINTER_PILOT: undefined };
}

function okSession(sc, sub = '') {
  sc.session = { workspaces: Object.values(WORKSPACES), accountId: 'acct-owner' };
  sc.variant = 'full';
  sc.ownerCheck = { ret: { status: 'owner' } };
  sc.path = `/workspace/acme/api/dispatch${sub}`;
  sc.headers = { host: 'harbour.example' };
  delete sc.limiter;
  delete sc.clientAbortAfterMs;
  cleanFactory(sc);
}

function okProxy(sc, { grants = ['dispatch'], scope = 'readWrite', createdBy = 'acct-owner', workspaceId = 'ws-acme' } = {}) {
  sc.headers = { host: 'harbour.example', authorization: 'Bearer hb_work_tok' };
  sc.stores.proxyTokenStore = { ...(sc.stores.proxyTokenStore || {}), validateToken: { ret: { tokenId: 'ptok-e', urlKey: 'acme', label: 'agent', scope, createdBy, grants, workspaceId } } };
  sc.access = { token: 'lin_tok', providerName: 'linear', credentialFingerprint: 'fp-e', expiresAt: NOW(sc) + 3_600_000, credentialSource: 'session' };
  sc.provider = { name: 'linear', unsupported: [], missing: [], methods: { issueWriteGuard: { ret: { id: 'i' } }, fetchIssueContext: { ret: { issue: { description: 'Plan: ship it' } } } } };
  sc.registry = {};
  sc.variant = 'full';
  sc.orKey = { ret: 'sk-or-creator' };
  delete sc.limiter;
  delete sc.clientAbortAfterMs;
  cleanFactory(sc);
}

function okDispatchToken(sc, { owner = 'acct-owner', label = 'runner-1' } = {}) {
  sc.headers = { host: 'harbour.example', authorization: 'Bearer hbd_runner_tok' };
  sc.stores = { dispatchTokenStore: { validateToken: { ret: { urlKey: 'acme', label, ...(owner === undefined ? {} : { createdBy: owner }) } } } };
  sc.env = { NODE_ENV: 'test' };
  sc.variant = 'full';
  sc.body = { kind: 'none' };
}

const J = (sc, value) => { sc.body = { kind: 'json', value }; };
const ctxOf = (K, o = {}) => ({ issue: { id: 'iss', identifier: 'LIN-42', title: 'T', description: o.description ?? 'desc', state: { name: 'Todo', type: 'unstarted' }, labels: [], url: 'u' }, parent: null, siblings: [], project: null, children: [], comments: [], attachments: [] });
const rec = (identifier, action, o = {}) => ({ ret: { identifier, reasoning: 'r', prompt: o.prompt ?? 'Generated body', truncated: false, recommendedAction: action, deferTo: o.deferTo ?? null, state: o.state ?? { type: 'unstarted' }, children: o.children, periodicalId: o.periodicalId ?? null } });

// ---------------------------------------------------------------------------
// Edge cases: [form, name, patch(sc, K, r)] (+ optional reps)
// ---------------------------------------------------------------------------
const E = [];
const add = (form, name, patch, reps = 6) => E.push({ form, name, patch, reps });

// ===== session POST /dispatch =====
const sd = (name, body, extra = () => {}, reps) => add(SD, name, (sc, K, r) => { okSession(sc); J(sc, typeof body === 'function' ? body(K, r) : body); extra(sc, K, r); }, reps);
sd('abort+followUpTo', { abort: true, abortTo: U1, followUpTo: U2 });
sd('prompt-missing', { promptName: 'x' });
sd('target-bad', { prompt: 'p', target: 'mars' });
for (const st of ['not-owner', 'no-owner', 'weird']) sd(`owner:${st}`, { prompt: 'p' }, (sc) => { sc.ownerCheck = { ret: { status: st } }; });
sd('owner:throws', { prompt: 'p' }, (sc) => { sc.ownerCheck = { throw: { kind: 'plain', message: 'seam down' } }; });
sd('owner:no-account', { prompt: 'p' }, (sc) => { delete sc.session.accountId; });
sd('owner:unwired', { prompt: 'p', target: 'web' }, (sc) => { sc.variant = 'sparse'; });
sd('owner:dash-ungated', { prompt: 'p', target: 'dash' }, (sc) => { sc.ownerCheck = { ret: { status: 'not-owner' } }; });
sd('abortTo-missing', { abort: true });
sd('abortTo-without-abort', { prompt: 'p', abortTo: U1 });
sd('abort-local-target', { abort: true, abortTo: U1, target: 'local' });
sd('abort-ok', { abort: true, abortTo: U1, target: 'dash' });
sd('cascade-nonbool', { abort: true, abortTo: U1, cascade: 'yes' });
sd('cascade-without-abort', { prompt: 'p', cascade: true });
sd('cascade-ok', { abort: true, abortTo: U1, cascade: true });
sd('cascade-store-throws', { abort: true, abortTo: U1, cascade: true }, (sc) => { sc.stores.dispatchQueueStore.expandCascadeAborts = { throw: { kind: 'plain', message: 'walk failed' } }; });
sd('kind-bad', { prompt: 'p', kind: 'zzz' });
sd('periodical-bad', { prompt: 'p', periodicalId: 'zzz' });
sd('wait-bad', { prompt: 'p', waitForFollowUps: 'y' });
sd('queueIfBusy-bad', { prompt: 'p', queueIfBusy: 1 });
sd('subscription-bad', { prompt: 'p', subscription: 'all' });
sd('queueIfBusy+subscription-ok', { prompt: 'p', queueIfBusy: true, subscription: 'everything', waitForFollowUps: true });
sd('presetId-empty', { prompt: 'p', presetId: '  ' });
sd('presetId-miss', { prompt: 'p', presetId: 'nope' }, (sc) => { sc.stores.dispatchPresetsStore = { get: { ret: null } }; });
sd('presetId-hit', { prompt: 'p', presetId: 'p1' }, (sc) => { sc.stores.dispatchPresetsStore = { get: { ret: { id: 'p1', name: 'Fast', config: { model: 'model-a', harness: 'codex' } } } }; });
sd('presetId-no-store', { prompt: 'p', presetId: 'p1' }, (sc) => { sc.variant = 'noStores'; });
sd('maxTasks-bad', { prompt: 'p', maxTasks: 0 });
sd('attachProxy-nonbool', { prompt: 'p', attachProxy: 'yes' });
sd('entryRung-bad', { prompt: 'p', issueIdentifier: 'LIN-42', entryRung: 'fly' });
sd('entryRung-abort', { abort: true, abortTo: U1, entryRung: 'run-step' });
sd('entryRung-no-issue', { prompt: 'p', entryRung: 'run-task' });
sd('entryRung-ok', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${300 + r}`, entryRung: r % 2 ? 'run-task' : 'run-step', surface: r % 3 ? 'swipe' : undefined }));
sd('entryRung-record-rejects', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${310 + r}`, entryRung: 'run-step' }), (sc) => { sc.stores.taskModeStore = { record: { throw: { kind: 'plain', message: 'record failed' } } }; });
sd('entryRung-record-sync-throw', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${320 + r}`, entryRung: 'run-step' }), (sc) => { sc.stores.taskModeStore = { record: { syncThrow: { kind: 'plain', message: 'sync boom' } } }; });
sd('entryRung-no-account', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${330 + r}`, entryRung: 'run-step', target: 'dash' }), (sc) => { delete sc.session.accountId; });
sd('stopAt-bad', { prompt: 'p', kind: 'autopilot', issueIdentifier: 'LIN-1', stopAt: 'merge' });
sd('stopAt-followUp', { prompt: 'p', followUpTo: U2, stopAt: 'pr' });
sd('stopAt-not-autopilot', { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-1', stopAt: 'pr' });
sd('stopAt-no-issue', { prompt: 'p', kind: 'autopilot', stopAt: 'pr' });
sd('stopAt-ok', (K, r) => ({ prompt: 'p', kind: 'autopilot', issueIdentifier: `LIN-${340 + r}`, stopAt: 'pr', variant: 'stepper' }));
sd('variant-bad', { prompt: 'p', kind: 'autopilot', variant: 'turbo' });
sd('variant-cascade', { abort: true, abortTo: U1, cascade: true, variant: 'standard' });
sd('variant-not-autopilot', { prompt: 'p', kind: 'plan', variant: 'standard' });
sd('surface-bad', { prompt: 'p', surface: 'moon' });
sd('local-remote-host', { prompt: 'p', target: 'local' });
sd('payload-model-long', { prompt: 'p', model: 'm'.repeat(1001) });
sd('payload-ifParked', { prompt: 'p', ifParked: true });
sd('payload-force-alone', { prompt: 'p', force: true });
sd('dangling', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${350 + r}` }), (sc) => { sc.regProvider = { issueWriteGuard: { ret: null } }; });
sd('dangling-binding-source', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${360 + r}`, issueSource: 'github' }), (sc) => { sc.path = '/workspace/mixed/api/dispatch'; sc.regProvider = { issueWriteGuard: { ret: null } }; });
sd('dangling-ambiguous-skip', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${370 + r}` }), (sc) => { sc.path = '/workspace/jiraamb/api/dispatch'; sc.regProvider = { issueWriteGuard: { ret: null } }; });
sd('referent-auth-swallowed', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${380 + r}` }), (sc) => { sc.regProvider = { issueWriteGuard: { throw: { kind: 'gql', status: 401 } } }; });
// file-pointer pilot → readPlanBlock (session closure)
const pilot = (name, ws, extra) => sd(`pilot:${name}`, (K, r) => ({ prompt: 'Implement it', kind: 'implementation', issueIdentifier: `LIN-${400 + r}` }), (sc, K, r) => {
  sc.env.HARBOUR_FILE_POINTER_PILOT = '1'; sc.stores.dispatchQueueStore.countPilotEligible = { ret: 0 }; sc.path = `/workspace/${ws}/api/dispatch`;
  sc.regProvider = { issueWriteGuard: { ret: { id: 'i' } } };
  sc.stores.dispatchQueueStore.listHistory = { ret: { items: [{ feedback: [{ message: 'PR https://github.com/org/repo/pull/7' }] }] } };
  extra?.(sc, K, r);
});
pilot('token', 'acme', (sc) => { sc.wsToken = { ret: 'ws-access-token' }; sc.issueCtx = { ret: { issue: { description: '## Plan\n- step' } } }; });
pilot('fallback-scope', 'acme', (sc) => { sc.wsToken = { ret: null }; sc.issueCtx = { ret: { description: 'flat' } }; });
pilot('token-throws', 'acme', (sc) => { sc.wsToken = { throw: { kind: 'plain', message: 'refresh failed' } }; });
pilot('ambiguous', 'jiraamb', (sc) => { sc.wsToken = { ret: null }; });
pilot('ctx-throws', 'acme', (sc) => { sc.issueCtx = { throw: { kind: 'plain', message: 'ctx down' } }; });
pilot('ctx-slow', 'acme', (sc) => { sc.issueCtx = { delayMs: 9000, ret: { issue: { description: 'late' } } }; });
pilot('control-arm', 'acme', (sc) => { sc.stores.dispatchQueueStore.countPilotEligible = { ret: 1 }; });
// follow-ups
sd('followUp-pbt-mint', (K, r) => ({ prompt: 'continue', followUpTo: U2, harness: 'claude-code' }), (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { id: U2, harness: 'claude-code', issueIdentifier: 'LIN-5', rootItemId: U3 } }; sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'none' } }; });
sd('followUp-declared', { prompt: 'continue', followUpTo: U2, harness: 'claude-code' }, (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'record', record: { grants: ['dispatch'], workspaceId: 'ws-acme', site: 'M2', ownerAccountId: 'acct-owner' } } }; });
sd('followUp-declared-invalid', { prompt: 'continue', followUpTo: U2, harness: 'claude-code' }, (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'record', record: { grants: [], workspaceId: 'ws-acme', site: 'M2', ownerAccountId: 'acct-owner' } } }; });
sd('followUp-decl-lookup-throws', { prompt: 'continue', followUpTo: U2, harness: 'claude-code' }, (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { throw: { kind: 'plain', message: 'db' } }; });
sd('followUp-attach-ok', { prompt: 'continue', followUpTo: U2, attachProxy: true, harness: 'codex' });
sd('followUp-attach-unchanged', { prompt: 'continue', followUpTo: U2, attachProxy: true, harness: 'codex' }, (sc) => { sc.stores.proxyTokenStore.createToken = { ret: { token: null } }; });
// fresh attach (LIN-1162)
sd('attach-prose', (K, r) => ({ prompt: 'p', attachProxy: true, harness: 'codex', issueIdentifier: `LIN-${420 + r}` }));
sd('attach-mcp', (K, r) => ({ prompt: 'p', attachProxy: true, harness: 'claude-code' }));
sd('attach-unchanged', { prompt: 'p', attachProxy: true, harness: 'codex' }, (sc) => { sc.stores.proxyTokenStore.createToken = { throw: { kind: 'plain', message: 'rate limited' } }; });
sd('attach-mcp-mint-fails', { prompt: 'p', attachProxy: true, harness: 'claude-code' }, (sc) => { sc.stores.proxyTokenStore.createToken = { ret: {} }; });
sd('attach-no-store', { prompt: 'p', attachProxy: true }, (sc) => { sc.variant = 'noStores'; });
// M2 declared launch
const m2 = (name, extra, body = (K, r) => ({ prompt: 'Run autopilot', kind: 'autopilot', attachProxy: true })) => sd(`M2:${name}`, body, extra);
m2('ok', () => {});
m2('owner-only', (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'GRANT_OWNER_ONLY', status: 403 } }; });
m2('owner-unavailable', (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true } }; });
m2('odd-code', (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'ODD_CODE', status: 418 } }; });
m2('no-workspace-id', (sc) => { sc.path = '/workspace/noid/api/dispatch'; });
m2('no-token', (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { ret: {} }; });
m2('periodical-tail', () => {}, (K) => ({ prompt: `Review\n\n${K.PERIODICAL_AUTOPILOT_TAIL}`, kind: 'periodical', periodicalId: 'documentation-review', attachProxy: true }));
m2('periodical-no-tail', () => {}, () => ({ prompt: 'Review only', kind: 'periodical', periodicalId: 'documentation-review', attachProxy: true }));
// factory refusals
sd('dup', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${440 + r}`, kind: 'implementation' }), (sc) => { sc.stores.dispatchQueueStore.findRecentFreshDispatch = { ret: { id: 'dup-x', dispatchedAt: iso(NOW(sc) - 30_000) } }; });
sd('dup-force-bypass', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${450 + r}`, force: true }), (sc) => { sc.stores.dispatchQueueStore.findRecentFreshDispatch = { ret: { id: 'dup-x', dispatchedAt: iso(NOW(sc) - 30_000) } }; });
sd('budget-exhausted', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${460 + r}`, sessionId: U3 }), (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { maxTasks: 2 } }; sc.stores.dispatchQueueStore.countDistinctTasksForSession = { ret: { count: 2, alreadyCounted: false, taskDispatches: 1 } }; });
sd('budget-position', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${470 + r}`, sessionId: U3 }), (sc, K, r) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { maxTasks: 4 } }; sc.stores.dispatchQueueStore.countDistinctTasksForSession = { ret: { count: 1, alreadyCounted: r % 2 === 0, taskDispatches: 1 } }; });
sd('budget-unverified', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${480 + r}`, sessionId: U3 }), (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { maxTasks: 2 } }; sc.stores.dispatchQueueStore.countDistinctTasksForSession = { throw: { kind: 'plain', message: 'count failed' } }; });
sd('runaway', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${490 + r}`, sessionId: U3 }), (sc) => { sc.stores.dispatchQueueStore.countDistinctTasksForSession = { ret: { count: 1, alreadyCounted: true, taskDispatches: 30 } }; });
sd('close-out-refused', (K, r) => ({ prompt: 'p', kind: 'close-out', sessionId: U3 }), (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { stopAt: 'pr' } }; });
sd('run-limit', { prompt: 'p' }, (sc) => { sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.stores.freeTierStore.checkRun = { ret: { allowed: false, reason: 'limit', limit: 10, runsUsed: 10, resetsAt: iso(NOW(sc) + 7_200_000) } }; });
sd('run-limit-unverified', { prompt: 'p' }, (sc) => { sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.stores.freeTierStore.checkRun = { throw: { kind: 'plain', message: 'quota db' } }; });
sd('run-gate-no-account', { prompt: 'p', target: 'dash' }, (sc) => { sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; delete sc.session.accountId; });
sd('marker-invalid', { prompt: 'p', composedRunMarker: 'bad\u0001' });
sd('marker-anchor-terminal', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${500 + r}`, composedRunMarker: 'run:1' }), (sc) => { sc.issueCtx = { ret: { issue: { state: { type: 'completed' } } } }; });
sd('marker-anchor-unverified', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${510 + r}`, composedRunMarker: 'run:1' }), (sc) => { sc.wsToken = { ret: null }; });
sd('marker-anchor-live', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${520 + r}`, composedRunMarker: 'run:1' }), (sc) => { sc.issueCtx = { ret: { issue: { state: { type: 'started' } } } }; });
sd('addItem-throws', { prompt: 'p' }, (sc) => { sc.stores.dispatchQueueStore.addItem = { throw: { kind: 'plain', message: 'insert failed' } }; });
sd('warning-never', { prompt: 'p' }, (sc) => { sc.stores.dispatchTokenStore.listTokens = { ret: [] }; });
sd('warning-stale', { prompt: 'p' }, (sc) => { sc.stores.dispatchTokenStore.listTokens = { ret: [{ lastUsedAt: iso(NOW(sc) - 3_600_000) }] }; });
sd('prefs-defaults', { prompt: 'p', kind: 'implementation' }, (sc) => { sc.stores.workspacePreferencesStore.getWorkspacePreferences = { ret: { dispatchDefaults: { model: 'model-a', harness: 'claude-code', effort: 'high' } } }; });
// Harbour OS local spawn
const local = (name, extra, body = { prompt: 'Line 1\nLine 2', target: 'local' }) => sd(`local:${name}`, body, (sc, K, r) => { sc.headers.host = r % 2 ? 'localhost:3000' : '127.0.0.1'; sc.tty = 'ok'; sc.staging = {}; extra(sc, K, r); });
local('ok', () => {});
local('ok-repo', () => {}, { prompt: 'p', target: 'local', repo: 'https://github.com/org/repo' });
local('unsafe-repo', () => {}, { prompt: 'p', target: 'local', repo: "it's" });
local('take-throws', (sc) => { sc.stores.dispatchQueueStore.takeItem = { throw: { kind: 'plain', message: 'gone' } }; });
local('tty-fails', (sc) => { sc.tty = 'fail'; });
local('write-fails', (sc) => { sc.staging = { writeThrow: true }; });
local('mint-fails', (sc) => { sc.stores.harbourFeedbackTokenStore = { mintToken: { throw: { kind: 'plain', message: 'mint' } } }; });
local('no-feedback-store', (sc) => { sc.variant = 'noStores'; });
local('amended-item', (sc) => { sc.stores.dispatchQueueStore.addItem = { ret: { _id: U1, prompt: 'amended prompt', promptName: 'P', kind: 'custom', target: 'local', repo: 'org/repo', dispatchedAt: iso(NOW(sc)), consumerLastSeenAt: null } }; });
// rate-limit burst (NODE_ENV=production, one virtual minute)
add(SD, 'limiter-burst', (sc, K, r) => { okSession(sc); J(sc, { prompt: 'p', target: 'dash' }); sc.env.NODE_ENV = 'production'; sc.clockBase = 2_000_000_000_000 + r; }, 33);

// ===== other session routes =====
add('POST /workspace/:urlKey/api/dispatch/halt', 'halt-no-store', (sc) => { okSession(sc, '/halt'); sc.variant = 'noStores'; J(sc, { mode: 'stop' }); });
add('DELETE /workspace/:urlKey/api/dispatch/halt', 'halt-clear-no-store', (sc) => { okSession(sc, '/halt'); sc.variant = 'noStores'; });
add('POST /workspace/:urlKey/api/dispatch/halt', 'halt-ok', (sc, K, r) => { okSession(sc, '/halt'); J(sc, { mode: r % 2 ? 'pause' : 'stop' }); });
add('GET /workspace/:urlKey/api/dispatch/halt', 'halt-read-no-store', (sc) => { okSession(sc, '/halt'); sc.variant = 'noStores'; });
add('POST /workspace/:urlKey/api/dispatch/recent-prompts', 'recent-no-store', (sc) => { okSession(sc, '/recent-prompts'); sc.variant = 'noStores'; J(sc, { prompt: 'x' }); });
add('GET /workspace/:urlKey/api/dispatch/recent-prompts', 'recent-get-no-account', (sc) => { okSession(sc, '/recent-prompts'); delete sc.session.accountId; });
add('DELETE /workspace/:urlKey/api/dispatch/favorite-prompts', 'fav-delete-no-store', (sc) => { okSession(sc, '/favorite-prompts'); sc.variant = 'noStores'; J(sc, { prompt: 'x' }); });
add('GET /workspace/:urlKey/api/dispatch/favorite-prompts', 'fav-get-no-store', (sc) => { okSession(sc, '/favorite-prompts'); sc.variant = 'noStores'; });
add('POST /workspace/:urlKey/api/dispatch/tokens', 'token-mint-owner', (sc) => { okSession(sc, '/tokens'); J(sc, { label: 'runner' }); });
add('POST /workspace/:urlKey/api/dispatch/tokens', 'token-mint-not-owner', (sc) => { okSession(sc, '/tokens'); sc.ownerCheck = { ret: { status: 'not-owner' } }; J(sc, {}); });
add('POST /workspace/:urlKey/api/dispatch/tokens', 'token-limiter-burst', (sc, K, r) => { okSession(sc, '/tokens'); J(sc, { label: `l${r}` }); sc.env.NODE_ENV = 'production'; sc.clockBase = 2_100_000_000_000 + r; }, 10);
add('GET /workspace/:urlKey/api/dispatch/quota', 'quota-usage-throws', (sc) => { okSession(sc, '/quota'); sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.stores.freeTierStore.getRunUsage = { throw: { kind: 'plain', message: 'x' } }; });
add('GET /workspace/:urlKey/api/dispatch/quota', 'quota-free-tier', (sc) => { okSession(sc, '/quota'); sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; });
add('GET /workspace/:urlKey/api/dispatch/quota', 'quota-free-no-account-store', (sc) => { okSession(sc, '/quota'); sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.variant = 'noStores'; });
add('PATCH /workspace/:urlKey/api/dispatch/presets/:presetId', 'preset-patch-keep-byKind', (sc) => { okSession(sc, '/presets/p1'); J(sc, { model: 'model-a' }); sc.stores.dispatchPresetsStore = { get: { ret: { id: 'p1', name: 'Old', config: { byKind: { plan: { model: 'pm' } } } } }, update: { ret: { id: 'p1' } } }; });
add('PATCH /workspace/:urlKey/api/dispatch/presets/:presetId', 'preset-patch-no-store', (sc) => { okSession(sc, '/presets/p1'); sc.variant = 'noStores'; J(sc, {}); });
add('POST /workspace/:urlKey/api/dispatch/presets', 'preset-create-no-store', (sc) => { okSession(sc, '/presets'); sc.variant = 'noStores'; J(sc, { name: 'x' }); });
add('DELETE /workspace/:urlKey/api/dispatch/presets/:presetId', 'preset-delete-no-store', (sc) => { okSession(sc, '/presets/p1'); sc.variant = 'noStores'; });
add('GET /workspace/:urlKey/api/dispatch/presets', 'preset-list-no-store', (sc) => { okSession(sc, '/presets'); sc.variant = 'noStores'; });
add('DELETE /workspace/:urlKey/api/dispatch/:itemId', 'delete-local-row-member', (sc) => { okSession(sc, `/${U1}`); sc.ownerCheck = { ret: { status: 'not-owner' } }; sc.stores.dispatchQueueStore.getItemStatus = { ret: { target: 'local' } }; sc.stores.dispatchQueueStore.removeItem = { ret: true }; });
add('PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim', 'trim-ok', (sc) => { okSession(sc, `/${U1}/trim`); J(sc, { maxTasks: 2 }); sc.stores.dispatchQueueStore.getItemStatus = { ret: { target: 'cli' } }; sc.stores.dispatchQueueStore.trimSessionBudget = { ret: { ok: true, item: { id: U1, maxTasks: 2, prompt: 'Bearer hb_abcdefabcdefabcdefabcdefabcdefab', dispatchedBy: 'acct-member', bootstrapToken: 'x' } } }; });

// ===== consumer routes =====
add(BROKER, 'ownerless-strict', (sc) => { okDispatchToken(sc, { owner: null }); sc.env.DISPATCH_OWNERLESS_BROKER_COMPAT = 'off'; });
add(BROKER, 'ownerless-compat', (sc) => { okDispatchToken(sc, { owner: null }); sc.stores.proxyTokenStore = { createToken: { ret: { token: 'hb_r', expiresAt: 'x' } } }; });
add(BROKER, 'no-proxy-store', (sc) => { okDispatchToken(sc); sc.variant = 'noStores'; });
add(BROKER, 'plain-ok', (sc) => { okDispatchToken(sc); sc.stores.proxyTokenStore = { createToken: { ret: { token: 'hb_r', expiresAt: '2026-10-03T00:00:00.000Z' } } }; });
add(BROKER, 'plain-null', (sc) => { okDispatchToken(sc); sc.stores.proxyTokenStore = { createToken: { ret: null } }; });
const declared = { state: 'record', record: { grants: ['dispatch'], workspaceId: 'ws-acme', site: 'M1', ownerAccountId: 'acct-owner' } };
const takenRow = { status: 'taken', takenByTokenLabel: 'runner-1', feedback: [] };
const broker = (name, extra) => add(BROKER, `declared:${name}`, (sc, K, r) => { okDispatchToken(sc); J(sc, { itemId: U1 }); sc.stores.dispatchQueueStore = { getGrantDeclaration: { ret: declared }, getItemStatus: { ret: takenRow } }; sc.stores.proxyTokenStore = { mintGrantBootstrap: { ret: { token: 'hb_grant', workspaceId: 'ws-acme' } }, createToken: { ret: { token: 'hb_plain' } } }; extra(sc, K, r); });
broker('ok', () => {});
broker('owner-mismatch', (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'record', record: { ...declared.record, ownerAccountId: 'acct-other' } } }; });
broker('ownerless-record', (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'record', record: { ...declared.record, ownerAccountId: '' } } }; });
broker('row-unreadable', (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { throw: { kind: 'plain', message: 'x' } }; });
broker('row-terminal', (sc, K, r) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { ...takenRow, status: r % 2 ? 'expired' : 'cancelled' } }; });
broker('not-taker', (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { ...takenRow, takenByTokenLabel: 'other' } }; });
broker('done-feedback', (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { ...takenRow, feedback: [{ message: '[done] ok', timestamp: 'x' }] } }; });
broker('mint-unavailable', (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true } }; });
broker('mint-structural', (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'GRANT_OWNER_ONLY', status: 403 } }; });
broker('mint-odd-code', (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'ODD_CODE', status: 418 } }; });
broker('mint-plain-error', (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'plain', message: 'db' } }; });
broker('reread-throws', (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { seq: [{ ret: declared }, { throw: { kind: 'plain', message: 'x' } }] }; });
broker('reread-vanished', (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { seq: [{ ret: declared }, { ret: { state: 'row-missing' } }] }; });
add(BROKER, 'itemId-none-state', (sc) => { okDispatchToken(sc); J(sc, { itemId: U1 }); sc.stores.dispatchQueueStore = { getGrantDeclaration: { ret: { state: 'none' } } }; sc.stores.proxyTokenStore = { createToken: { ret: { token: 'hb_p', expiresAt: 'e' } } }; });
add('POST /api/dispatch/feedback/:itemId', 'harbour-token', (sc) => { okDispatchToken(sc); sc.path = `/api/dispatch/feedback/${U1}`; J(sc, { message: '[done] ok' }); sc.stores.harbourFeedbackTokenStore = { validateAndConsume: { ret: { urlKey: 'acme' } } }; sc.stores.dispatchQueueStore = { addFeedback: { ret: { ok: 1 } } }; });
add('POST /api/dispatch/feedback/:itemId', 'withdrawn-clears-cache', (sc, K, r) => { okDispatchToken(sc); sc.path = `/api/dispatch/feedback/${U1}`; sc.variant = r % 2 ? 'noStores' : 'full'; J(sc, { message: JSON.stringify({ decision_id: 'd', reason: 'r' }), kind: 'decision-withdrawn' }); sc.stores.dispatchQueueStore = { addFeedback: { ret: { ok: 1 } } }; });
add('POST /api/dispatch/feedback/:itemId', 'wake-provisioner', (sc, K, r) => { okDispatchToken(sc, { owner: r % 3 === 0 ? null : 'acct-owner' }); sc.path = `/api/dispatch/feedback/${U1}`; sc.variant = r === 5 ? 'noStores' : 'full'; J(sc, { message: '[done]' }); sc.stores.dispatchQueueStore = { addFeedback: { callProvisioner: [r % 2 ? 'claude-code' : null, r % 4 === 1 ? declared.record : null], ret: { ok: 1 } } }; sc.stores.proxyTokenStore = { createToken: r === 4 ? { throw: { kind: 'plain', message: 'mint' } } : { ret: { token: 'hb_w' } }, mintGrantBootstrap: r === 1 ? { throw: { kind: 'coded', code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true } } : { ret: { token: 'hb_wg', workspaceId: 'ws-acme' } } }; });
add('GET /api/dispatch/poll', 'halt-timeout-cached', (sc, K, r) => { okDispatchToken(sc); sc.stores.dispatchQueueStore = { pollAvailable: { ret: [] } }; sc.stores.workspaceHaltStore = { getWorkspaceHalt: r % 2 ? { hang: true } : { delayMs: 2000, ret: { mode: 'stop' } }, getLastKnownHalt: { ret: r % 3 ? { mode: 'pause', setAt: 's', setBy: 'b' } : null } }; });
add('GET /api/dispatch/poll', 'poll-no-halt-store', (sc) => { okDispatchToken(sc); sc.variant = 'noStores'; sc.stores.dispatchQueueStore = { pollAvailable: { ret: [{ id: 'q' }] } }; });
add('GET /api/dispatch/poll', 'poll-items-reject-during-halt', (sc) => { okDispatchToken(sc); sc.stores.dispatchQueueStore = { pollAvailable: { throw: { kind: 'plain', message: 'poll failed' } } }; sc.stores.workspaceHaltStore = { getWorkspaceHalt: { delayMs: 1000, ret: null } }; });

// ===== proxy POST /dispatch =====
const pd = (name, body, extra = () => {}, reps) => add(PD, name, (sc, K, r) => { okProxy(sc); J(sc, typeof body === 'function' ? body(K, r) : body); extra(sc, K, r); }, reps);
pd('no-queue', { prompt: 'p' }, (sc) => { sc.variant = 'noQueue'; });
pd('grant-absent', { prompt: 'p' }, (sc) => { okProxy(sc, { grants: [] }); J(sc, { prompt: 'p' }); });
pd('grant-take-only', { prompt: 'p' }, (sc) => { okProxy(sc, { grants: ['take'] }); J(sc, { prompt: 'p' }); });
pd('read-scope', { prompt: 'p' }, (sc) => { okProxy(sc, { scope: 'read' }); J(sc, { prompt: 'p' }); });
pd('limiter', { prompt: 'p' }, (sc) => { sc.limiter = 'block'; });
pd('auth-missing', { prompt: 'p' }, (sc) => { delete sc.headers.authorization; });
pd('auth-rejected-descriptor', { prompt: 'p' }, (sc) => { sc.stores.proxyTokenStore.validateToken = { ret: null }; sc.stores.proxyTokenStore.describeRejectionCause = { ret: { state: 'expired', urlKey: 'acme', expiresAt: 'x' } }; });
pd('auth-throws', { prompt: 'p' }, (sc) => { sc.stores.proxyTokenStore.validateToken = { throw: { kind: 'plain', message: 'down' } }; });
pd('abort+followUp', { abort: true, abortTo: U1, followUpTo: U2 });
pd('prompt-missing', {});
pd('target-local', { prompt: 'p', target: 'local' });
pd('abortTo-missing', { abort: true });
pd('cascade-nonbool', { abort: true, abortTo: U1, cascade: 1 });
pd('cascade-without-abort', { prompt: 'p', cascade: true });
pd('kind-bad', { prompt: 'p', kind: 'zzz' });
pd('periodical-bad', { prompt: 'p', periodicalId: 'zzz' });
pd('wait-bad', { prompt: 'p', waitForFollowUps: 0 });
pd('queueIfBusy-bad', { prompt: 'p', queueIfBusy: 'y' });
pd('subscription-bad', { prompt: 'p', subscription: 'x' });
pd('maxTasks-bad', { prompt: 'p', maxTasks: 1.5 });
pd('payload-bad', { prompt: 'p', sessionId: '__meta__' });
pd('cascade-ok', { abort: true, abortTo: U1, cascade: true, target: 'web' });
pd('cascade-throws', { abort: true, abortTo: U1, cascade: true }, (sc) => { sc.stores.dispatchQueueStore.expandCascadeAborts = { throw: { kind: 'plain', message: 'x' } }; });
pd('abort-ok', { abort: true, abortTo: U1 });
pd('repo-only', { prompt: 'p', repo: 'org/repo' });
pd('dangling', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${600 + r}` }), (sc) => { sc.provider.methods.issueWriteGuard = { ret: null }; });
pd('access-null', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${610 + r}` }), (sc) => { sc.access = { token: null, reason: 'no-token' }; });
pd('access-throws', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${620 + r}` }), (sc) => { sc.access = { throw: { kind: 'plain', message: 'boom' } }; });
pd('append-default-prose', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${630 + r}`, harness: 'codex' }));
pd('append-default-mcp', (K, r) => ({ prompt: 'p', harness: 'claude-code' }));
pd('append-optout', { prompt: 'p', appendProxyContext: false });
pd('followUp-default', { prompt: 'p', followUpTo: U2, harness: 'claude-code' });
pd('followUp-optout', { prompt: 'p', followUpTo: U2, appendProxyContext: false, harness: 'claude-code' });
pd('followUp-attach', { prompt: 'p', followUpTo: U2, appendProxyContext: true, harness: 'codex' });
pd('followUp-declared', { prompt: 'p', followUpTo: U2, harness: 'claude-code' }, (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'record', record: { grants: ['dispatch'], workspaceId: 'ws-acme', site: 'M2', ownerAccountId: 'acct-owner' } } }; });
pd('followUp-structural', { prompt: 'p', followUpTo: U2, harness: 'claude-code' }, (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'record', record: { grants: [], workspaceId: 'w', site: 's', ownerAccountId: 'o' } } }; });
pd('followUp-declared-owner-only', { prompt: 'p', followUpTo: U2, harness: 'claude-code' }, (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'record', record: { grants: ['dispatch'], workspaceId: 'ws-acme', site: 'M2', ownerAccountId: 'acct-owner' } } }; sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'GRANT_OWNER_ONLY', status: 403 } }; });
pd('attach-failed', { prompt: 'p', harness: 'claude-code' }, (sc) => { sc.stores.proxyTokenStore.createToken = { throw: { kind: 'plain', message: 'rate' } }; });
pd('dup', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${640 + r}` }), (sc) => { sc.stores.dispatchQueueStore.findRecentFreshDispatch = { ret: { id: 'd', dispatchedAt: iso(NOW(sc) - 1000) } }; });
pd('budget', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${650 + r}`, sessionId: U3 }), (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { maxTasks: 1 } }; sc.stores.dispatchQueueStore.countDistinctTasksForSession = { ret: { count: 1, alreadyCounted: false, taskDispatches: 0 } }; });
pd('budget-position', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${660 + r}`, sessionId: U3, maxTasks: 3 }), (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { maxTasks: 3 } }; });
pd('runaway', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${670 + r}`, sessionId: U3 }), (sc) => { sc.stores.dispatchQueueStore.countDistinctTasksForSession = { ret: { count: 1, alreadyCounted: true, taskDispatches: 31 } }; });
pd('close-out', { prompt: 'p', kind: 'close-out', sessionId: U3 }, (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { stopAt: 'pr' } }; });
pd('run-limit', { prompt: 'p' }, (sc) => { sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.orKey = { ret: null }; sc.stores.freeTierStore.checkRun = { ret: { allowed: false, reason: 'limit', limit: 3, runsUsed: 3, resetsAt: iso(NOW(sc) + 100_000) } }; });
pd('run-limit-unverified', { prompt: 'p' }, (sc) => { sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.orKey = { ret: null }; sc.stores.freeTierStore.checkRun = { ret: { allowed: false } }; });
pd('addItem-throws', { prompt: 'p' }, (sc) => { sc.stores.dispatchQueueStore.addItem = { throw: { kind: 'plain', message: 'x' } }; });
pd('orKey-throws', { prompt: 'p' }, (sc) => { sc.orKey = { throw: { kind: 'plain', message: 'k' } }; });
pd('force-queue-wait', (K, r) => ({ prompt: 'p', issueIdentifier: `LIN-${680 + r}`, force: true, queueIfBusy: true, waitForFollowUps: true, subscription: 'everything', sessionId: 'opaque-s' }));
pd('pilot', (K, r) => ({ prompt: 'Implement', kind: 'implementation', issueIdentifier: `LIN-${690 + r}` }), (sc, K, r) => { sc.env.HARBOUR_FILE_POINTER_PILOT = '1'; sc.stores.dispatchQueueStore.countPilotEligible = { ret: 0 }; if (r % 3 === 1) sc.provider.methods.fetchIssueContext = { ret: { description: 'flat' } }; if (r % 3 === 2) sc.provider.missing = ['fetchIssueContext']; });

// ===== proxy POST /recommend-and-dispatch =====
const rd = (name, body, extra = () => {}, reps) => add(RD, name, (sc, K, r) => { okProxy(sc); J(sc, typeof body === 'function' ? body(K, r) : body); sc.promptCtx = { ret: ctxOf(K) }; sc.recs = { '*': rec('LIN-42', 'implement') }; extra(sc, K, r); }, reps);
rd('no-queue', { issueIdentifier: 'LIN-42' }, (sc) => { sc.variant = 'noQueue'; });
rd('grant-absent', { issueIdentifier: 'LIN-42' }, (sc) => { sc.stores.proxyTokenStore.validateToken.ret.grants = undefined; });
rd('id-missing', {});
rd('id-bad', { issueIdentifier: 'not an id' });
rd('target-local', { issueIdentifier: 'LIN-42', target: 'local' });
rd('noDescend-bad', { issueIdentifier: 'LIN-42', noDescend: 'y' });
rd('wait-bad', { issueIdentifier: 'LIN-42', waitForFollowUps: 1 });
rd('queue-bad', { issueIdentifier: 'LIN-42', queueIfBusy: 1 });
rd('sub-bad', { issueIdentifier: 'LIN-42', subscription: 1 });
rd('repo-bad', { issueIdentifier: 'LIN-42', repo: 'r'.repeat(1001) });
rd('model-bad', { issueIdentifier: 'LIN-42', model: 1 });
rd('harness-bad', { issueIdentifier: 'LIN-42', harness: 'bad\u0001' });
rd('effort-bad', { issueIdentifier: 'LIN-42', effort: 2 });
rd('effort-unknown-warn', (K, r) => ({ issueIdentifier: `LIN-${700 + r}`, effort: 'mega' }));
rd('kind-bad', { issueIdentifier: 'LIN-42', kind: 'autopilot' });
rd('periodical-bad', { issueIdentifier: 'LIN-42', periodicalId: 'x' });
rd('session-bad', { issueIdentifier: 'LIN-42', sessionId: '' });
rd('followUp-bad', { issueIdentifier: 'LIN-42', followUpTo: 'x' });
rd('followUp-dash', { issueIdentifier: 'LIN-42', followUpTo: U2, target: 'dash' });
rd('force-bad', { issueIdentifier: 'LIN-42', force: 'yes' });
rd('access-null', { issueIdentifier: 'LIN-42' }, (sc) => { sc.access = { token: null, reason: 'token-expired' }; });
rd('access-throws', { issueIdentifier: 'LIN-42' }, (sc) => { sc.access = { throw: { kind: 'gql', status: 401 } }; });
rd('unsupported-ctx', { issueIdentifier: 'LIN-42' }, (sc) => { sc.provider.unsupported = ['fetchIssueContext']; });
rd('unsupported-rec', { issueIdentifier: 'LIN-42' }, (sc) => { sc.provider.unsupported = ['fetchRecommendationContext']; });
// override arm
const ov = (name, extra, body = (K, r) => ({ issueIdentifier: `LIN-${720 + r}`, kind: K.TEMPLATE_KEYS[r % K.TEMPLATE_KEYS.length] })) => rd(`override:${name}`, body, extra);
ov('ok', () => {});
ov('ok-periodical-marker', (sc, K) => { sc.promptCtx = { ret: ctxOf(K, { description: `x\n${K.gateMarker}` }) }; });
ov('ok-periodical-caller', () => {}, (K, r) => ({ issueIdentifier: `LIN-${730 + r}`, kind: 'review', periodicalId: 'security-review' }));
ov('ctx-not-found', (sc) => { sc.promptCtx = { throw: { kind: 'plain', message: 'Issue not found' } }; });
ov('ctx-null', (sc) => { sc.promptCtx = { ret: null }; });
ov('ctx-gql-401', (sc) => { sc.promptCtx = { throw: { kind: 'gql', status: 401 } }; });
ov('ctx-gql-401-transient', (sc) => { sc.promptCtx = { throw: { kind: 'gql', status: 403 } }; });
ov('ctx-timeout', (sc) => { sc.promptCtx = { throw: { kind: 'timeout' } }; });
ov('hang-up', (sc, K) => { sc.promptCtx = { hangUp: true, ret: ctxOf(K) }; });
ov('slow-keepalive', (sc, K) => { sc.promptCtx = { delayMs: 26_000, ret: ctxOf(K) }; });
ov('slow-keepalive-refusal', (sc, K) => { sc.promptCtx = { delayMs: 26_000, ret: ctxOf(K) }; sc.stores.dispatchQueueStore.findRecentFreshDispatch = { ret: { id: 'd', dispatchedAt: iso(NOW(sc) + 25_000) } }; });
ov('followUp-attach', (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'none' } }; }, (K, r) => ({ issueIdentifier: 'LIN-42', kind: 'review', followUpTo: U2, appendProxyContext: true, harness: 'codex' }));
ov('followUp-pbt', () => {}, (K) => ({ issueIdentifier: 'LIN-42', kind: 'review', followUpTo: U2, harness: 'claude-code' }));
ov('optout', () => {}, (K, r) => ({ issueIdentifier: `LIN-${740 + r}`, kind: 'plan', appendProxyContext: false }));
ov('dup', (sc) => { sc.stores.dispatchQueueStore.findRecentFreshDispatch = { ret: { id: 'd', dispatchedAt: iso(NOW(sc) - 2000) } }; });
ov('attach-failed', (sc) => { sc.stores.proxyTokenStore.createToken = { throw: { kind: 'plain', message: 'x' } }; }, (K, r) => ({ issueIdentifier: `LIN-${750 + r}`, kind: 'plan', harness: 'claude-code' }));
ov('structural', (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'record', record: { grants: [], workspaceId: 'w', site: 's', ownerAccountId: 'o' } } }; }, () => ({ issueIdentifier: 'LIN-42', kind: 'review', followUpTo: U2, harness: 'claude-code' }));
ov('addItem-gql', (sc) => { sc.stores.dispatchQueueStore.addItem = { throw: { kind: 'gql', status: 429 } }; });
ov('test-mode', (sc) => { sc.access.token = 'test-token'; });
ov('orKey-free', (sc) => { sc.orKey = { ret: null }; sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.stores.freeTierStore.checkRun = { ret: { allowed: false, reason: 'limit', limit: 1, runsUsed: 1, resetsAt: iso(NOW(sc) + 5000) } }; });
// LLM arm
const llm = (name, extra, body = (K, r) => ({ issueIdentifier: `LIN-${800 + r}` })) => rd(`llm:${name}`, body, extra);
llm('ok', (sc, K, r) => { sc.recs = { '*': rec(`LIN-${800 + r}`, 'implement') }; });
llm('ai-unavailable', (sc) => { sc.orKey = { ret: null }; });
llm('ai-unavailable-test-mode', (sc) => { sc.orKey = { ret: null }; sc.access.token = 'test-token'; });
llm('paid-env-witness', (sc) => { sc.orKey = { ret: null }; sc.env.OPENROUTER_API_KEY = 'sk-paid'; });
llm('free-charge-ok', (sc) => { sc.orKey = { ret: null }; sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; });
llm('free-charge-429', (sc) => { sc.orKey = { ret: null }; sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.stores.freeTierStore.tryUse = { ret: { allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 5, resetsAt: 'r' } }; });
llm('rec-not-found', (sc) => { sc.recs = { '*': { throw: { kind: 'plain', message: 'Issue not found' } } }; });
llm('rec-openrouter', (sc) => { sc.recs = { '*': { throw: { kind: 'plain', message: 'OpenRouter 502' } } }; });
llm('rec-gql', (sc, K, r) => { sc.recs = { '*': { throw: { kind: 'gql', status: [401, 404, 429, 500, 403, 401][r] } } }; });
llm('rec-timeout', (sc) => { sc.recs = { '*': { throw: { kind: 'timeout' } } }; });
llm('hang-up', (sc) => { sc.recs = { '*': { hangUp: true } }; });
llm('hang-up-then-return', (sc, K, r) => { sc.recs = { '*': { hangUpThenReturn: true, ...rec(`LIN-${800 + r}`, 'implement') } }; });
llm('slow-flush', (sc, K, r) => { sc.recs = { '*': { delayMs: 30_000, ...rec(`LIN-${800 + r}`, 'plan') } }; });
llm('slow-flush-error', (sc) => { sc.recs = { '*': { delayMs: 40_000, throw: { kind: 'plain', message: 'OpenRouter down' } } }; });
llm('defer-stuck', (sc, K, r) => { sc.recs = { '*': rec(`LIN-${800 + r}`, 'defer', { prompt: null }) }; });
llm('no-prompt', (sc, K, r) => { sc.recs = { '*': rec(`LIN-${800 + r}`, 'implement', { prompt: '' }) }; });
llm('descend', (sc, K, r) => { const id = `LIN-${800 + r}`; sc.recs = { [id]: rec(id, 'defer', { deferTo: 'LIN-77', prompt: null, children: [{ identifier: 'LIN-77', state: { type: 'started' } }] }), 'LIN-77': rec('LIN-77', 'bug', { periodicalId: 'security-review' }) }; });
llm('descend-timeout', (sc, K, r) => { const id = `LIN-${800 + r}`; sc.recs = { [id]: { delayMs: 181_000, ...rec(id, 'defer', { deferTo: 'LIN-77', prompt: null }) } }; });
llm('cycle', (sc, K, r) => { const id = `LIN-${800 + r}`; sc.recs = { [id]: rec(id, 'defer', { deferTo: 'LIN-77', prompt: null }), 'LIN-77': rec('LIN-77', 'defer', { deferTo: id, prompt: null }) }; });
llm('noDescend', (sc, K, r) => { const id = `LIN-${800 + r}`; sc.recs = { [id]: rec(id, 'defer', { deferTo: 'LIN-77', prompt: 'own work' }) }; }, (K, r) => ({ issueIdentifier: `LIN-${800 + r}`, noDescend: true }));
llm('followUp-attach', () => {}, () => ({ issueIdentifier: 'LIN-42', followUpTo: U2, appendProxyContext: true, harness: 'codex' }));
llm('followUp-pbt', () => {}, () => ({ issueIdentifier: 'LIN-42', followUpTo: U2, harness: 'claude-code' }));
llm('structural', (sc) => { sc.stores.dispatchQueueStore.getGrantDeclaration = { ret: { state: 'record', record: { grants: [], workspaceId: 'w', site: 's', ownerAccountId: 'o' } } }; }, () => ({ issueIdentifier: 'LIN-42', followUpTo: U2, harness: 'claude-code' }));
llm('attach-failed', (sc) => { sc.stores.proxyTokenStore.createToken = { ret: {} }; }, (K, r) => ({ issueIdentifier: `LIN-${820 + r}`, harness: 'claude-code' }));
llm('dup', (sc, K, r) => { sc.recs = { '*': rec(`LIN-${830 + r}`, 'implement') }; sc.stores.dispatchQueueStore.findRecentFreshDispatch = { ret: { id: 'd', dispatchedAt: iso(NOW(sc) - 2000) } }; }, (K, r) => ({ issueIdentifier: `LIN-${830 + r}` }));
llm('addItem-gql', (sc) => { sc.stores.dispatchQueueStore.addItem = { throw: { kind: 'gql', status: 401 } }; });
llm('orKey-throws-outer', (sc) => { sc.orKey = { throw: { kind: 'plain', message: 'key db' } }; });
llm('pilot', (sc, K, r) => { sc.env.HARBOUR_FILE_POINTER_PILOT = '1'; sc.stores.dispatchQueueStore.countPilotEligible = { ret: 0 }; sc.recs = { '*': rec(`LIN-${840 + r}`, 'implement') }; if (r % 2) sc.provider.methods.fetchIssueContext = { ret: { description: 'flat' } }; }, (K, r) => ({ issueIdentifier: `LIN-${840 + r}` }));
llm('x-request-start', (sc, K, r) => { sc.recs = { '*': { delayMs: 22_000, ...rec(`LIN-${800 + r}`, 'plan') } }; sc.headers['x-request-start'] = String(r % 2 ? NOW(sc) - 15_000 : (NOW(sc) - 3000) * 1000); });

// ===== proxy kickoff =====
const ko = (name, body, extra = () => {}, reps) => add(KO, name, (sc, K, r) => { okProxy(sc); J(sc, typeof body === 'function' ? body(K, r) : body); sc.promptCtx = { ret: ctxOf(K) }; extra(sc, K, r); }, reps);
ko('no-queue', {}, (sc) => { sc.variant = 'noQueue'; });
ko('grant-absent', {}, (sc) => { sc.stores.proxyTokenStore.validateToken.ret.grants = []; });
ko('mode-bad', { mode: 'x' });
ko('variant-bad', { variant: 'x' });
ko('goal-bad', { goal: 'g'.repeat(100_001) });
ko('target-bad', { target: 'local' });
ko('repo-bad', { repo: 7 });
ko('issue-bad', { issueIdentifier: 'bad id' });
ko('session-bad', { sessionId: '__meta__' });
ko('sub-bad', { subscription: 'x' });
ko('model-bad', { model: 'm'.repeat(1001) });
ko('harness-bad', { harness: 3 });
ko('effort-bad', { effort: 'bad\u0002' });
ko('effort-unknown', { effort: 'ultra' });
ko('preset-empty', { presetId: '' });
ko('preset-miss', { presetId: 'p9' }, (sc) => { sc.stores.dispatchPresetsStore = { get: { ret: null } }; });
ko('preset-hit', { presetId: 'p1' }, (sc) => { sc.stores.dispatchPresetsStore = { get: { ret: { id: 'p1', name: 'Fast', config: { harness: 'codex', model: 'model-a' } } } }; });
ko('preset-no-store', { presetId: 'p1' }, (sc) => { sc.variant = 'sparse'; });
ko('maxTasks-bad', { maxTasks: '2' });
ko('general-ok', (K, r) => ({ goal: 'walk', mode: r % 2 ? 'readonly' : 'write', variant: r % 3 ? 'standard' : 'stepper', maxTasks: r % 2 ? 3 : undefined }));
ko('general-optout', { appendProxyContext: false });
ko('scoped-ok', (K, r) => ({ issueIdentifier: `LIN-${900 + r}`, goal: 'extra context', repo: 'org/repo', issueSource: r % 2 ? 'linear' : undefined }));
ko('scoped-access-null', { issueIdentifier: 'LIN-42' }, (sc) => { sc.access = { token: null, reason: 'no-token' }; });
ko('scoped-unsupported', { issueIdentifier: 'LIN-42' }, (sc) => { sc.provider.unsupported = ['fetchIssueContext']; });
ko('scoped-not-found', { issueIdentifier: 'LIN-42' }, (sc) => { sc.promptCtx = { throw: { kind: 'plain', message: 'Issue not found' } }; });
ko('scoped-null', { issueIdentifier: 'LIN-42' }, (sc) => { sc.promptCtx = { ret: null }; });
ko('scoped-gql-401', { issueIdentifier: 'LIN-42' }, (sc, K, r) => { sc.promptCtx = { throw: { kind: 'gql', status: 401 } }; if (r % 2) sc.access.expiresAt = NOW(sc) - 1; }, 10);
ko('scoped-gql-other', { issueIdentifier: 'LIN-42' }, (sc) => { sc.promptCtx = { throw: { kind: 'gql', status: 404 } }; });
ko('scoped-hang-up', (K, r) => ({ issueIdentifier: `LIN-${930 + r}` }), (sc, K) => { sc.promptCtx = { hangUp: true, ret: ctxOf(K) }; });
ko('scoped-hang-up-dup', (K, r) => ({ issueIdentifier: `LIN-${940 + r}` }), (sc, K) => { sc.promptCtx = { hangUp: true, ret: ctxOf(K) }; sc.stores.dispatchQueueStore.findRecentFreshDispatch = { ret: { id: 'd', dispatchedAt: iso(NOW(sc) - 1) } }; });
ko('child-inherits-stopAt', (K, r) => ({ sessionId: U3, subscription: 'everything' }), (sc, K, r) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { stopAt: r % 2 ? 'pr' : null, maxTasks: 2 } }; });
ko('child-parent-throws', { sessionId: U3 }, (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { throw: { kind: 'plain', message: 'x' } }; });
ko('child-no-getItemStatus', { sessionId: U3 }, (sc) => { sc.storeMissingOps = { dispatchQueueStore: ['getItemStatus'] }; });
ko('declared-owner-only', {}, (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'GRANT_OWNER_ONLY', status: 403 } }; });
ko('declared-unavailable', {}, (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true } }; });
ko('declared-no-workspace', {}, (sc) => { okProxy(sc, { workspaceId: undefined }); J(sc, {}); });
ko('declared-ownerless', {}, (sc) => { okProxy(sc, { createdBy: null }); J(sc, {}); });
ko('declared-odd', {}, (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { throw: { kind: 'coded', code: 'ODD', status: 418 } }; });
ko('dup', (K, r) => ({ issueIdentifier: `LIN-${910 + r}` }), (sc) => { sc.stores.dispatchQueueStore.findRecentFreshDispatch = { ret: { id: 'd', dispatchedAt: iso(NOW(sc) - 1) } }; });
ko('budget-child', (K, r) => ({ issueIdentifier: `LIN-${920 + r}`, sessionId: U3 }), (sc) => { sc.stores.dispatchQueueStore.getItemStatus = { ret: { maxTasks: 1 } }; sc.stores.dispatchQueueStore.countDistinctTasksForSession = { ret: { count: 1, alreadyCounted: false, taskDispatches: 0 } }; });
ko('run-limit', {}, (sc) => { sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.orKey = { ret: null }; sc.stores.freeTierStore.checkRun = { ret: { allowed: false, reason: 'limit', limit: 2, runsUsed: 2, resetsAt: iso(NOW(sc) + 60_000) } }; });
ko('run-limit-no-key-fn', {}, (sc) => { sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; sc.variant = 'sparse'; });
ko('addItem-throws', {}, (sc) => { sc.stores.dispatchQueueStore.addItem = { throw: { kind: 'plain', message: 'x' } }; });
ko('attach-failed-mcp', {}, (sc) => { sc.stores.proxyTokenStore.mintGrantBootstrap = { ret: {} }; });

// ===== watch long-poll =====
const watch = (name, wait, seq, extra = () => {}) => add(WATCH, name, (sc, K, r) => {
  okProxy(sc, { grants: [] });
  sc.path = `/api/proxy/dispatch/${U1}${wait == null ? '' : `?wait=${wait}`}`;
  const base = { id: U1, status: 'queued', promptName: 'P', kind: r % 2 ? 'wake' : 'implementation', issueIdentifier: 'LIN-1', target: 'cli', dispatchedAt: iso(NOW(sc) - 1000), feedback: [] };
  sc.stores.dispatchQueueStore = { getItemStatus: { seq: seq(base, NOW(sc)) }, getWakeShadow: { ret: { wouldSkip: false, reason: 'first-pause' } } };
  extra(sc, K, r);
});
watch('wait-change', 5, (b) => [{ ret: b }, { ret: b }, { ret: { ...b, status: 'taken' } }]);
watch('wait-feedback', 5, (b, now) => [{ ret: b }, { ret: { ...b, feedback: [{ message: 'hi', timestamp: iso(now) }] } }]);
watch('wait-timeout', 3, (b) => [{ ret: b }]);
watch('wait-vanish', 10, (b) => [{ ret: b }, { ret: b }, { ret: null }]);
watch('wait-terminal-first', 10, (b, now) => [{ ret: { ...b, status: 'taken', feedback: [{ message: '[done] x', timestamp: iso(now) }] } }]);
watch('wait-closed-first', 10, (b) => [{ ret: { ...b, status: 'taken', bookkeeping: { closed: true } } }]);
watch('wait-full-keepalive', 50, (b) => [{ ret: b }]);
watch('wait-client-abort', 50, (b) => [{ ret: b }], (sc) => { sc.clientAbortAfterMs = 4000; });
watch('wait-client-abort-after-flush', 50, (b) => [{ ret: b }], (sc) => { sc.clientAbortAfterMs = 31_000; });
watch('wait-reread-throws', 5, (b) => [{ ret: b }, { throw: { kind: 'plain', message: 'x' } }]);
watch('wait-abort-then-throw', 5, (b) => [{ ret: b }, { delayMs: 3000, throw: { kind: 'plain', message: 'x' } }], (sc) => { sc.clientAbortAfterMs = 2000; });
watch('no-wait-queued-warning', null, (b) => [{ ret: { ...b, consumerLastSeenAt: null } }]);
add('GET /api/proxy/dispatch', 'lineage-over-cap', (sc, K, r) => {
  okProxy(sc, { grants: [] });
  sc.path = `/api/proxy/dispatch${r % 2 ? '?status=done' : ''}`;
  const now = NOW(sc);
  const row = (o) => ({ id: o.id, promptName: 'P', issueIdentifier: 'LIN-1', target: 'cli', dispatchedAt: iso(now - 60_000), ...o });
  sc.stores.dispatchQueueStore = {
    listItems: { ret: [row({ id: 'q1' })] },
    listHistory: { seq: [{ ret: { items: [row({ id: 't1', status: 'taken', rootItemId: 'R', feedback: [] }), row({ id: 't2', status: 'taken', feedback: [] })], total: 2 } }, { ret: { items: [row({ id: 's1', status: 'taken', rootItemId: 'R', dispatchedAt: iso(now - 30_000), feedback: [{ message: '[done] y', timestamp: iso(now - 10_000) }] })], total: 2001 } }] },
  };
});


// ===== generic gates on every form (auth / session / parser / limiter / owner) =====
const OWNER_GATED = new Set(['POST /workspace/:urlKey/api/dispatch/halt', 'DELETE /workspace/:urlKey/api/dispatch/halt', 'DELETE /workspace/:urlKey/api/dispatch/:itemId', 'PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim', 'DELETE /workspace/:urlKey/api/dispatch/tokens/:tokenId', 'POST /workspace/:urlKey/api/dispatch/tokens', SD]);
const WRITE_PROXY = new Set([PD, RD, KO]);
const HAS_BODY = (form) => /^(POST|PATCH|DELETE) /.test(form);
function sessionPathFor(form) {
  return form.split(' ')[1].replace(':urlKey', 'acme').replace(':itemId', U1).replace(':sessionId', U1).replace(':tokenId', U1).replace(':presetId', 'p1');
}
for (const form of Object.keys(FORMS)) {
  if (form === 'UNMATCHED') continue;
  const lane = FORMS[form].lane;
  const method = form.split(' ')[0];
  const base = (sc) => { sc.method = method; sc.path = sessionPathFor(form); if (form === SD) J(sc, { prompt: 'p' }); };
  if (lane === 'session' && form.includes(':urlKey')) {
    add(form, 'gate:bad-urlKey', (sc) => { okSession(sc); base(sc); sc.path = sc.path.replace('/acme/', '/bad.key/'); }, 5);
    add(form, 'gate:no-workspaces', (sc) => { okSession(sc); base(sc); sc.session = { workspaces: [], accountId: 'acct-owner' }; }, 5);
    add(form, 'gate:unknown-workspace', (sc) => { okSession(sc); base(sc); sc.path = sc.path.replace('/acme/', '/ghost/'); }, 5);
  } else if (lane === 'session') {
    add(form, 'gate:no-auth', (sc) => { okDispatchToken(sc); base(sc); delete sc.headers.authorization; }, 5);
    add(form, 'gate:invalid-token', (sc) => { okDispatchToken(sc); base(sc); sc.stores.dispatchTokenStore.validateToken = { ret: null }; }, 5);
    add(form, 'gate:token-store-throws', (sc) => { okDispatchToken(sc); base(sc); sc.stores.dispatchTokenStore.validateToken = { throw: { kind: 'plain', message: 'down' } }; }, 5);
  } else {
    add(form, 'gate:limiter', (sc) => { okProxy(sc); base(sc); sc.limiter = 'block'; }, 5);
    add(form, 'gate:no-auth', (sc) => { okProxy(sc); base(sc); delete sc.headers.authorization; }, 5);
    add(form, 'gate:rejected', (sc, K, r) => { okProxy(sc); base(sc); sc.stores.proxyTokenStore.validateToken = { ret: null }; sc.stores.proxyTokenStore.describeRejectionCause = { ret: r % 2 ? null : { state: 'consumed', urlKey: 'acme' } }; }, 5);
    add(form, 'gate:auth-throws', (sc) => { okProxy(sc); base(sc); sc.stores.proxyTokenStore.validateToken = { throw: { kind: 'plain', message: 'down' } }; }, 5);
    if (WRITE_PROXY.has(form)) {
      add(form, 'gate:read-scope', (sc) => { okProxy(sc, { scope: 'read' }); base(sc); }, 5);
      add(form, 'gate:no-grant', (sc, K, r) => { okProxy(sc, { grants: [[], undefined, ['take'], 'dispatch', null][r] }); base(sc); }, 5);
    }
    if (!WRITE_PROXY.has(form) && form !== 'GET /api/proxy/autopilot/kickoff' && !form.includes('manual') && !form.includes('passage')) add(form, 'gate:no-queue', (sc) => { okProxy(sc); base(sc); sc.variant = 'noQueue'; }, 5);
  }
  if (HAS_BODY(form)) {
    const prep = (sc) => { if (lane === 'proxy') okProxy(sc); else if (form.includes(':urlKey')) okSession(sc); else okDispatchToken(sc); base(sc); };
    add(form, 'gate:body-too-large', (sc) => { prep(sc); sc.body = { kind: 'pad', value: { prompt: 'p' }, padBytes: 260_000, contentType: 'application/json' }; }, 5);
    add(form, 'gate:malformed-json', (sc) => { prep(sc); sc.body = { kind: 'raw', text: '{"a":', contentType: 'application/json' }; }, 5);
  }
  if (OWNER_GATED.has(form)) {
    const prep = (sc) => { okSession(sc); base(sc); if (form.includes('/halt')) J(sc, { mode: 'stop' }); if (form.includes('/trim')) J(sc, { maxTasks: 1 }); if (form.includes(':itemId') || form.includes('/trim')) sc.stores.dispatchQueueStore.getItemStatus = { ret: { target: 'cli' } }; };
    add(form, 'owner:not-owner', (sc) => { prep(sc); sc.ownerCheck = { ret: { status: 'not-owner' } }; }, 5);
    add(form, 'owner:no-owner', (sc) => { prep(sc); sc.ownerCheck = { ret: { status: 'no-owner' } }; }, 5);
    add(form, 'owner:no-account', (sc) => { prep(sc); delete sc.session.accountId; }, 5);
    add(form, 'owner:seam-throws', (sc) => { prep(sc); sc.ownerCheck = { throw: { kind: 'plain', message: 'x' } }; }, 5);
    add(form, 'owner:unwired', (sc) => { prep(sc); sc.variant = 'sparse'; }, 5);
  }
}
// free-tier LLM arm (logOpenRouterCredentialSource + charge) crossed with each outcome
const FREE = (sc) => { sc.orKey = { ret: null }; sc.env.OPENROUTER_FREE_TIER_KEY = 'sk-free'; };
for (const [name, recs, extra] of [
  ['ok', (id) => ({ '*': rec(id, 'implement') })],
  ['not-found', () => ({ '*': { throw: { kind: 'plain', message: 'Issue not found' } } })],
  ['openrouter', () => ({ '*': { throw: { kind: 'plain', message: 'OpenRouter 500' } } })],
  ['gql-401', () => ({ '*': { throw: { kind: 'gql', status: 401 } } })],
  ['gql-403-transient', () => ({ '*': { throw: { kind: 'gql', status: 403 } } })],
  ['timeout', () => ({ '*': { throw: { kind: 'timeout' } } })],
  ['weird', () => ({ '*': { throw: { kind: 'plain', message: 'weird' } } })],
  ['defer', (id) => ({ '*': rec(id, 'defer', { prompt: null }) })],
  ['hang-up', () => ({ '*': { hangUp: true } })],
  ['dup', (id) => ({ '*': rec(id, 'implement') }), (sc) => { sc.stores.dispatchQueueStore.findRecentFreshDispatch = { ret: { id: 'd', dispatchedAt: iso(NOW(sc) - 1) } }; }],
  ['addItem-500', (id) => ({ '*': rec(id, 'implement') }), (sc) => { sc.stores.dispatchQueueStore.addItem = { throw: { kind: 'plain', message: 'x' } }; }],
  ['attach-503', (id) => ({ '*': rec(id, 'implement') }), (sc) => { sc.stores.proxyTokenStore.createToken = { ret: {} }; }],
]) {
  rd(`llm-free:${name}`, (K, r) => ({ issueIdentifier: `LIN-${950 + r}`, harness: 'claude-code' }), (sc, K, r) => { FREE(sc); sc.recs = recs(`LIN-${950 + r}`); extra?.(sc); }, 5);
  rd(`llm-paid-env:${name}`, (K, r) => ({ issueIdentifier: `LIN-${960 + r}`, harness: 'claude-code' }), (sc, K, r) => { sc.orKey = { ret: null }; sc.env.OPENROUTER_API_KEY = 'sk-paid'; sc.recs = recs(`LIN-${960 + r}`); extra?.(sc); }, 5);
}

// ---------------------------------------------------------------------------
export function edgeScenarios(seed, K) {
  const out = [];
  let idx = 0;
  for (const e of E) {
    if (!FORMS[e.form]) throw new Error(`edge: unknown form ${e.form}`);
    for (let r = 0; r < e.reps; r++) {
      const sc = generateScenario(seed, idx++, K, e.form, { tier: 'edge' });
      sc.intent = `edge:${e.name}`;
      e.patch(sc, K, r);
      out.push(sc);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test-captured tier: HTTP requests the existing unit tests send to these
// routers (method, path, auth/host presence, JSON body), replayed into a clean
// world (owner session / readWrite+dispatch token, healthy stores).
// ---------------------------------------------------------------------------
export function testScenarios(seed, K, file) {
  if (!existsSync(file)) return [];
  const calls = JSON.parse(readFileSync(file, 'utf8')).calls || [];
  const out = [];
  calls.forEach((c, i) => {
    const url = new URL(c.url, 'http://x');
    let pathname = url.pathname;
    const m = /^\/workspace\/([^/]+)(\/.*)$/.exec(pathname);
    if (m) pathname = `/workspace/acme${m[2]}`;
    const key = routeKeyFor(c.method, pathname);
    if (!key) return;
    const sc = generateScenario(seed, i, K, key, { tier: 'test' });
    sc.intent = `test:${c.file}`;
    if (FORMS[key].lane === 'session') {
      if (pathname.startsWith('/workspace/')) okSession(sc, pathname.slice('/workspace/acme/api/dispatch'.length));
      else okDispatchToken(sc);
    } else okProxy(sc);
    sc.method = c.method;
    sc.path = pathname + url.search;
    if (!c.hasAuth) delete sc.headers.authorization;
    if (c.host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(c.host)) sc.headers.host = 'localhost:3000';
    sc.body = c.body === undefined ? { kind: 'none' } : { kind: 'json', value: c.body };
    sc.testFile = c.file;
    out.push(sc);
  });
  return out;
}
