// Targeted edge tier + test-captured tier for routes/workspace-api.js.
// Edge cases start from a CLEAN world (owner session, production env with a
// paid key, full deps, healthy stores) and change one thing; each runs
// `reps` times with small seeded variations. Order is significant (dedupe
// pairs, cache state) and identical on both sides.
import { existsSync, readFileSync } from 'node:fs';
import { G, FIXED_NOW } from '../../../replay-kit/lib/router/common.mjs';
import { WORKSPACES, ISSUE_UUID, finalize, routeKeyFor, FORMS, generateScenario } from './gen.mjs';
export { routeKeyFor };

const UUID = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const STEP_MS = 90_000;
const ALL_WS = Object.keys(WORKSPACES);

function session(wsKey, o = {}) {
  return { workspaces: ALL_WS.map(k => JSON.parse(JSON.stringify(WORKSPACES[k]))), accountId: 'acct-owner', features: { proxy: true, dispatch: true, feedbackTriage: false, roadmap: true }, ...o, ...(o.features ? { features: { proxy: true, dispatch: true, roadmap: true, ...o.features } } : {}) };
}

let counter = 0;
function clean(wsKey = 'acme') {
  const index = counter++;
  return {
    id: `edge:${index}`, tier: 'edge', index, randomSeed: (index * 2654435761 + 99) >>> 0, clockBase: FIXED_NOW + 3e9 + index * STEP_MS,
    wsKey, urlKey: wsKey, env: { NODE_ENV: 'production', OPENROUTER_API_KEY: 'sk-paid-env' }, session: session(wsKey), variant: 'full',
    ownerCheck: { ret: { status: 'owner' } }, headers: { host: 'harbour.example' }, prov: {}, stores: {}, ai: {}, fetch: {}, body: { kind: 'none' },
  };
}
const P = (sc, rest) => `/workspace/${sc.urlKey}/api${rest}`;
const json = (value) => ({ kind: 'json', value });
const testEnv = (sc) => { sc.env = { NODE_ENV: 'test' }; return sc; };
const ctx = (id = ISSUE_UUID, extra = {}) => ({ issue: { id: /^[0-9a-f-]{36}$/i.test(id) ? id : ISSUE_UUID, identifier: 'LIN-7', title: 'Task', description: 'desc waiting on a decision', state: { name: 'In Progress', type: 'started' }, labels: ['bug'], url: 'https://linear.app/acme/issue/LIN-7', team: { id: 'team-1' } }, parent: null, siblings: [], project: { id: 'p', name: 'P' }, children: [], comments: [{ id: 'c1', body: 'should we decide?', createdAt: '2026-09-30T10:00:00.000Z', user: { name: 'A' } }], attachments: [], focusedChild: null, ...extra });
const ERR = {
  auth: { kind: 'gql', status: 401, message: 'Authentication required' },
  nf: { kind: 'plain', message: 'Issue not found: LIN-7' },
  boom: { kind: 'plain', message: 'kaboom' },
  or: { kind: 'plain', message: 'OpenRouter API error: 502' },
  str: { kind: 'string', value: 'raw string thrown' },
  hangup: { kind: 'plain', message: 'socket hang up' },
};

// Request shapes per route (method + path + body) on a clean scenario.
const R = {
  audit: (sc) => { sc.method = 'GET'; sc.path = P(sc, '/audit'); },
  prompt: (sc, id = ISSUE_UUID, label = 'implementation', qs = '') => { sc.method = 'GET'; sc.path = P(sc, `/prompt/${id}/${label}${qs}`); },
  apIssue: (sc, id = ISSUE_UUID, qs = '') => { sc.method = 'GET'; sc.path = P(sc, `/autopilot-prompt/${id}${qs}`); },
  apGeneral: (sc, qs = '') => { sc.method = 'GET'; sc.path = P(sc, `/autopilot-prompt${qs}`); },
  recStatus: (sc) => { sc.method = 'GET'; sc.path = P(sc, '/recommend/status'); },
  rec: (sc, id = ISSUE_UUID, qs = '') => { sc.method = 'GET'; sc.path = P(sc, `/recommend/${id}${qs}`); },
  stream: (sc, id = ISSUE_UUID, qs = '') => { sc.method = 'GET'; sc.path = P(sc, `/recommend/${id}/stream${qs}`); },
  commentsGet: (sc, id = ISSUE_UUID) => { sc.method = 'GET'; sc.path = P(sc, `/comments/${id}`); },
  comment: (sc, body = { body: 'Agree' }, id = ISSUE_UUID, qs = '') => { sc.method = 'POST'; sc.path = P(sc, `/comments/${id}${qs}`); sc.body = json(body); },
  detail: (sc, id = ISSUE_UUID, qs = '') => { sc.method = 'GET'; sc.path = P(sc, `/detail/${id}${qs}`); },
  sessions: (sc, ident = 'LIN-7') => { sc.method = 'GET'; sc.path = P(sc, `/sessions/${ident}`); },
  recapGet: (sc, id = ISSUE_UUID) => { sc.method = 'GET'; sc.path = P(sc, `/recap/${id}`); },
  recapPost: (sc, id = ISSUE_UUID) => { sc.method = 'POST'; sc.path = P(sc, `/recap/${id}`); },
  context: (sc, id = ISSUE_UUID) => { sc.method = 'GET'; sc.path = P(sc, `/context/${id}`); },
  briefGet: (sc, id = ISSUE_UUID) => { sc.method = 'GET'; sc.path = P(sc, `/brief/${id}`); },
  briefPost: (sc, id = ISSUE_UUID) => { sc.method = 'POST'; sc.path = P(sc, `/brief/${id}`); },
  scanGet: (sc, id = ISSUE_UUID) => { sc.method = 'GET'; sc.path = P(sc, `/scan/${id}`); },
  scanPost: (sc, id = ISSUE_UUID, qs = '') => { sc.method = 'POST'; sc.path = P(sc, `/scan/${id}${qs}`); },
  dismiss: (sc, id = ISSUE_UUID, body = { id: 'row-1' }) => { sc.method = 'POST'; sc.path = P(sc, `/scan/${id}/dismiss`); sc.body = json(body); },
  retire: (sc, id = ISSUE_UUID, body = { id: 'row-1' }) => { sc.method = 'POST'; sc.path = P(sc, `/scan/${id}/retire`); sc.body = json(body); },
  unretire: (sc, id = ISSUE_UUID, body = { id: 'row-1' }) => { sc.method = 'POST'; sc.path = P(sc, `/scan/${id}/unretire`); sc.body = json(body); },
  scanDue: (sc, qs = '') => { sc.method = 'GET'; sc.path = P(sc, `/scan-due${qs}`); },
  image: (sc, url = 'https://uploads.linear.app/a.png') => { sc.method = 'GET'; sc.path = P(sc, `/image?url=${encodeURIComponent(url)}`); },
  feedback: (sc, body = { message: 'It broke' }) => { sc.method = 'POST'; sc.path = P(sc, '/feedback'); sc.body = json(body); sc.prov.createIssue = { ret: { success: true, issue: { id: UUID(5000 + sc.index), identifier: `FB-${sc.index}`, title: 'T', url: `https://linear.app/acme/issue/FB-${sc.index}`, state: { type: 'unstarted' } } } }; },
  create: (sc, body = { title: 'New', teamId: 'team-1' }) => { sc.method = 'POST'; sc.path = P(sc, '/issues'); sc.body = json(body); },
  patch: (sc, body = { title: 'Renamed' }, id = ISSUE_UUID, qs = '') => { sc.method = 'PATCH'; sc.path = P(sc, `/issues/${id}${qs}`); sc.body = json(body); },
  models: (sc) => { sc.method = 'GET'; sc.path = P(sc, '/openrouter/models'); },
  runEv: (sc, ident = 'LIN-7') => { sc.method = 'GET'; sc.path = P(sc, `/run-evidence/${ident}`); },
  check: (sc, ident = 'LIN-7', body = {}) => { sc.method = 'POST'; sc.path = P(sc, `/run-evidence/${ident}/check`); sc.body = json(body); },
  promptTraces: (sc) => { sc.method = 'GET'; sc.path = P(sc, '/prompt-traces'); },
  customList: (sc) => { sc.method = 'GET'; sc.path = P(sc, '/prompts/custom'); },
  customCreate: (sc) => { sc.method = 'POST'; sc.path = P(sc, '/prompts/custom'); sc.body = json({ name: 'N', template: 'T' }); },
  customUpdate: (sc) => { sc.method = 'PUT'; sc.path = P(sc, '/prompts/custom/cp-1'); sc.body = json({ name: 'N2', template: 'T2' }); },
  customDelete: (sc) => { sc.method = 'DELETE'; sc.path = P(sc, '/prompts/custom/cp-1'); },
  northStarGet: (sc) => { sc.method = 'GET'; sc.path = P(sc, '/roadmap/north-star'); },
  northStarPut: (sc) => { sc.method = 'PUT'; sc.path = P(sc, '/roadmap/north-star'); sc.body = json({ text: 'Star' }); },
  reportsList: (sc) => { sc.method = 'GET'; sc.path = P(sc, '/roadmap/reports'); },
  reportsGet: (sc) => { sc.method = 'GET'; sc.path = P(sc, '/roadmap/reports/rep-1'); },
  reportsSave: (sc) => { sc.method = 'POST'; sc.path = P(sc, '/roadmap/reports'); sc.body = json({ kind: 'narrative', content: 'c' }); },
  roadmapChat: (sc) => { sc.method = 'POST'; sc.path = P(sc, '/roadmap/chat'); sc.body = json({ message: 'hi', history: [] }); },
  press: (sc, ident = 'LIN-7', body = { prUrl: 'https://github.com/org/repo/pull/12', headSha: 'abc', dispatchId: 'd-1' }) => { sc.method = 'POST'; sc.path = P(sc, `/run-evidence/${ident}/close-out-press`); sc.body = json(body); },
};

const PR = 'https://github.com/org/repo/pull/12';
const prComments = [{ id: 'c0', body: `Opened ${PR}`, createdAt: '2026-09-30T10:00:00.000Z', user: { name: 'Harbour' } }, { id: 'c1', body: '## Review\n\n**Verdict: Approve**\n\n### What CI Did Not Prove\n- **Inside** — flaky test not exercised\n- **Outside** — docs, discharged by PR #13\n- something else', createdAt: '2026-09-30T12:00:00.000Z', user: { name: 'Harbour' } }];
const ghMerged = { status: 200, json: { state: 'closed', merged: true, merged_at: '2026-09-30T00:00:00Z', head: { sha: 'abc123', ref: 'feat' }, number: 12 } };
const stopAtRows = { listItems: { ret: [{ _id: 'r1', issueIdentifier: 'LIN-7', stopAt: 'pr', dispatchedAt: { __date: '2026-09-30T00:00:00.000Z' } }] } };

/** [intent, reps, build(sc, k)] — build returns the scenario (or an array: a sequence). */
function cases(K) {
  const mock = K.mockIds;
  const T = [];
  const add = (intent, reps, build, ws) => T.push({ intent, reps, build, ws });

  // --- workspaceFromUrl on every route --------------------------------------------
  for (const [name, fn] of Object.entries(R)) {
    add(`auth:${name}:badKey`, 5, (sc) => { sc.urlKey = 'bad.key'; fn(sc); });
    add(`auth:${name}:noWorkspaces`, 5, (sc) => { sc.session = { workspaces: [] }; fn(sc); });
    add(`auth:${name}:ghost`, 5, (sc) => { sc.urlKey = 'ghost'; fn(sc); });
    add(`auth:${name}:emptySession`, 5, (sc) => { sc.session = {}; fn(sc); });
    add(`auth:${name}:noAccount`, 5, (sc) => { delete sc.session.accountId; fn(sc); });
  }

  // --- audit -----------------------------------------------------------------------
  add('audit:testMock', 5, (sc) => { testEnv(sc); R.audit(sc); }, 'testws');
  add('audit:localMockInTest', 5, (sc) => { testEnv(sc); R.audit(sc); }, 'localws');
  add('audit:localRefusedInProd', 5, (sc) => R.audit(sc), 'localws');
  add('audit:jira422', 5, (sc) => R.audit(sc), 'jiraws');
  add('audit:linearOk', 5, (sc) => R.audit(sc));
  add('audit:legacyOk', 5, (sc) => R.audit(sc), 'legacy');
  add('audit:conn', 5, (sc) => R.audit(sc), 'conn');
  add('audit:401', 5, (sc) => { R.audit(sc); sc.ai.runAudit = { throw: ERR.auth }; });
  add('audit:500', 5, (sc) => { R.audit(sc); sc.ai.runAudit = { throw: ERR.boom }; });

  // --- prompt ----------------------------------------------------------------------
  add('prompt:testMock', 6, (sc, k) => { testEnv(sc); R.prompt(sc, mock[k % mock.length], ['implementation', 'triage', 'bug', 'review', 'close-out', 'plan'][k], k % 2 ? '?format=md' : ''); }, 'testws');
  add('prompt:testMockMissing', 5, (sc) => { testEnv(sc); R.prompt(sc, 'NOPE-1'); }, 'testws');
  add('prompt:testCustom', 5, (sc, k) => { testEnv(sc); R.prompt(sc, mock[k], 'custom:cp-1'); }, 'testws');
  add('prompt:testCustomMissing', 5, (sc, k) => { testEnv(sc); R.prompt(sc, mock[k], 'custom:zz'); }, 'testws');
  add('prompt:testCustomNoTemplate', 5, (sc, k) => { testEnv(sc); R.prompt(sc, mock[k], 'custom:cp-1'); sc.stores.customPromptsStore = { get: { ret: { id: 'cp-1', name: 'n' } } }; }, 'testws');
  add('prompt:ok', 6, (sc, k) => { R.prompt(sc, ISSUE_UUID, K.TEMPLATE_KEYS[k * 3 % K.TEMPLATE_KEYS.length], k % 2 ? '?format=md' : ''); sc.prov.fetchIssueContext = { ret: ctx() }; });
  add('prompt:sources', 5, (sc, k) => { R.prompt(sc, ISSUE_UUID, 'triage', `?source=${['github', 'jira', 'linear', 'nope', 'local'][k]}`); }, 'mixed');
  add('prompt:providers', 6, (sc) => R.prompt(sc), null);
  add('prompt:custom', 5, (sc) => R.prompt(sc, ISSUE_UUID, 'custom:cp-1'));
  add('prompt:customMissing', 5, (sc) => R.prompt(sc, ISSUE_UUID, 'custom:nope'));
  add('prompt:noTemplate', 5, (sc) => R.prompt(sc, ISSUE_UUID, 'nolabel'));
  add('prompt:badId', 5, (sc) => R.prompt(sc, 'bad%20id'));
  add('prompt:401', 5, (sc) => { R.prompt(sc); sc.prov.fetchIssueContext = { throw: ERR.auth }; });
  add('prompt:404', 5, (sc) => { R.prompt(sc); sc.prov.fetchIssueContext = { throw: ERR.nf }; });
  add('prompt:500', 5, (sc) => { R.prompt(sc); sc.prov.fetchIssueContext = { throw: ERR.boom }; });

  // --- autopilot prompts -----------------------------------------------------------
  add('ap:proxyOff', 5, (sc) => { sc.session.features.proxy = false; R.apIssue(sc); });
  add('ap:badId', 5, (sc) => R.apIssue(sc, 'bad%20id'));
  add('ap:stopAtBad', 5, (sc, k) => R.apIssue(sc, ISSUE_UUID, `?stopAt=${encodeURIComponent(['merge', 'PR', 'x', '1', 'prr'][k])}`));
  add('ap:stopAtPr', 5, (sc, k) => R.apIssue(sc, ISSUE_UUID, `?stopAt=${encodeURIComponent([' pr', 'pr', 'pr ', '  ', ''][k])}&variant=${k % 2 ? 'stepper' : 'standard'}&mode=${k % 3 ? 'readonly' : 'write'}${k > 2 ? '&format=md' : ''}`));
  add('ap:testMock', 5, (sc, k) => { testEnv(sc); R.apIssue(sc, mock[k], k % 2 ? '?variant=stepper&format=md' : ''); }, 'testws');
  add('ap:testMockMissing', 5, (sc) => { testEnv(sc); R.apIssue(sc, 'NOPE-2'); }, 'testws');
  add('ap:providers', 6, (sc) => R.apIssue(sc), null);
  add('ap:401', 5, (sc) => { R.apIssue(sc); sc.prov.fetchIssueContext = { throw: ERR.auth }; });
  add('ap:404', 5, (sc) => { R.apIssue(sc); sc.prov.fetchIssueContext = { throw: ERR.nf }; });
  add('ap:500', 5, (sc) => { R.apIssue(sc); sc.prov.fetchIssueContext = { throw: ERR.str }; });
  add('apg:proxyOff', 5, (sc) => { sc.session.features.proxy = false; R.apGeneral(sc); });
  add('apg:maxTasks', 8, (sc, k) => R.apGeneral(sc, `?maxTasks=${encodeURIComponent(['3', ' 7 ', '0', '-2', '1.5', 'abc', '', '  '][k])}`));
  add('apg:goal', 6, (sc, k) => R.apGeneral(sc, `?goal=${encodeURIComponent(['Ship it', '', '   ', 'g'.repeat(1200), 'x'.repeat(70), 'ü✓'][k])}&variant=${k % 2 ? 'stepper' : ''}${k > 3 ? '&format=md' : ''}`));
  add('apg:providers', 6, (sc) => R.apGeneral(sc), null);

  // --- recommend status ------------------------------------------------------------
  add('recStatus:sources', 6, (sc, k) => { R.recStatus(sc); if (k === 0) sc.session.openRouterApiKey = 'sk-s'; if (k === 1) sc.env = { NODE_ENV: 'production' }; if (k === 2) sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'f' }; if (k === 3) { sc.env = { NODE_ENV: 'production', OPENROUTER_API_KEY: '  ' }; sc.session.freeTierEnabled = true; } if (k === 4) testEnv(sc); if (k === 5) sc.stores.workspacePreferencesStore = { getWorkspacePreferences: { ret: { aiModels: { recommend: 'anthropic/claude-sonnet-4' } } } }; }, null);
  add('recStatus:testws', 5, (sc) => { testEnv(sc); R.recStatus(sc); }, 'testws');

  // --- recommend (JSON) and stream ---------------------------------------------------
  for (const [nm, fn] of [['rec', R.rec], ['stream', R.stream]]) {
    add(`${nm}:badId`, 5, (sc) => fn(sc, 'bad%20id'));
    add(`${nm}:cap422`, 5, (sc) => fn(sc), 'bare');
    add(`${nm}:noKey503`, 5, (sc) => { sc.env = { NODE_ENV: 'production' }; fn(sc); });
    add(`${nm}:freeTierBlocked`, 5, (sc) => { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'sk-free' }; fn(sc); sc.stores.freeTierStore = { tryUse: { ret: { allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 10, resetsAt: '2026-10-02T00:00:00.000Z' } } }; });
    add(`${nm}:freeTierOk`, 5, (sc) => { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'sk-free' }; fn(sc); sc.prov.fetchRecommendationContext = { ret: ctx() }; });
    add(`${nm}:leaf`, 5, (sc, k) => { fn(sc, [ISSUE_UUID, 'LIN-7', '#LIN-7', 'lin-7', UUID(8)][k]); sc.prov.fetchRecommendationContext = { ret: ctx() }; if (k === 3) sc.session.openRouterApiKey = 'sk-sess'; });
    add(`${nm}:descent`, 5, (sc, k) => {
      fn(sc);
      const kid = { id: UUID(21), identifier: 'LIN-21', title: 'Child', state: { type: 'started', name: 'In Progress' } };
      sc.prov.fetchRecommendationContext = { retByArg: { 'LIN-21': { ret: ctx(UUID(21), { issue: { id: UUID(21), identifier: 'LIN-21', title: 'Child', state: { type: 'started' }, url: 'u21' } }) }, '*': { ret: ctx(ISSUE_UUID, { children: [kid], focusedChild: { issue: { ...kid, url: 'u21' } } }) } } };
      sc.ai.rec = { 'LIN-7': { ret: { reasoning: 'container', prompt: null, recommendedAction: 'defer', deferTo: 'LIN-21' } }, 'LIN-21': k % 2 ? { ret: { reasoning: 'r', prompt: null, recommendedAction: 'defer', deferTo: 'LIN-7' } } : { ret: { reasoning: 'do', prompt: 'Implement LIN-21', truncated: k === 2, completionTokens: 7, recommendedAction: 'implement', deferTo: null } } };
    });
    add(`${nm}:mockLocalLeaf`, 5, (sc, k) => { testEnv(sc); fn(sc, ['LIN-7', ISSUE_UUID, 'LIN-8', 'LIN-9', 'LIN-10'][k]); sc.prov.fetchRecommendationContext = { ret: ctx() }; if (k > 2) sc.session.freeTierEnabled = true; }, 'localws');
    add(`${nm}:mockLocalDescent`, 5, (sc) => { testEnv(sc); fn(sc); const kid = { id: UUID(21), identifier: 'LIN-21', title: 'C', state: { type: 'started' } }; sc.prov.fetchRecommendationContext = { retByArg: { 'LIN-21': { ret: ctx(UUID(21), { issue: { id: UUID(21), identifier: 'LIN-21', title: 'C', state: { type: 'started' }, labels: [], url: 'u' } }) }, '*': { ret: ctx(ISSUE_UUID, { children: [kid], focusedChild: { issue: { ...kid, url: 'u' } } }) } } }; }, 'localws');
    add(`${nm}:mockLocalNotFound`, 5, (sc) => { testEnv(sc); fn(sc); sc.prov.fetchRecommendationContext = { throw: ERR.nf }; }, 'localws');
    add(`${nm}:mockLocalOtherErr`, 5, (sc) => { testEnv(sc); fn(sc); sc.prov.fetchRecommendationContext = { throw: ERR.boom }; }, 'localws');
    add(`${nm}:mockLocalFreeTierBlocked`, 5, (sc) => { testEnv(sc); sc.session.freeTierEnabled = true; fn(sc); sc.stores.freeTierStore = { tryUse: { ret: { allowed: false, reason: 'limit', remaining: 0, limit: 3, resetsAt: 'x' } } }; }, 'localws');
    add(`${nm}:testMock`, 10, (sc, k) => { testEnv(sc); fn(sc, mock[k % mock.length]); if (k >= 7) sc.session.freeTierEnabled = true; }, 'testws');
    add(`${nm}:testMockMissing`, 5, (sc) => { testEnv(sc); fn(sc, 'NOPE-3'); }, 'testws');
    add(`${nm}:testFreeTierBlocked`, 5, (sc, k) => { testEnv(sc); sc.session.freeTierEnabled = true; fn(sc, mock[k]); sc.stores.freeTierStore = { tryUse: { ret: { allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 10, resetsAt: 'r' } } }; }, 'testws');
    add(`${nm}:ctx401`, 5, (sc) => { fn(sc); sc.prov.fetchRecommendationContext = { throw: ERR.auth }; });
    add(`${nm}:ctx404`, 5, (sc) => { fn(sc); sc.prov.fetchRecommendationContext = { throw: ERR.nf }; });
    add(`${nm}:aiOpenRouter`, 5, (sc) => { fn(sc); sc.ai.rec = { '*': { throw: ERR.or } }; });
    add(`${nm}:aiBoom`, 5, (sc) => { fn(sc); sc.ai.rec = { '*': { throw: ERR.boom } }; });
    add(`${nm}:aiStr`, 5, (sc) => { fn(sc); sc.ai.rec = { '*': { throw: ERR.str } }; });
    add(`${nm}:slowKeepalive`, 5, (sc, k) => { fn(sc); sc.ai.rec = { '*': { ret: { reasoning: 'r', prompt: 'p', recommendedAction: 'implement', deferTo: null }, delayMs: [21_000, 26_000, 41_000, 70_000, 5_000][k] } }; if (k === 1) sc.headers['x-request-start'] = String(sc.clockBase - 10_000); });
    add(`${nm}:slowError`, 5, (sc, k) => { fn(sc); sc.ai.rec = { '*': { throw: [ERR.or, ERR.nf, ERR.auth, ERR.boom, ERR.or][k], delayMs: 30_000 } }; });
    add(`${nm}:clientGone`, 5, (sc, k) => { fn(sc); sc.ai.rec = { '*': { hang: true } }; sc.clientAbortAfterMs = [1000, 5000, 26_000, 40_000, 100][k]; });
    add(`${nm}:ctxHang`, 3, (sc) => { fn(sc); sc.prov.fetchRecommendationContext = { hang: true }; sc.clientAbortAfterMs = 50_000; });
    add(`${nm}:budget`, 3, (sc) => { fn(sc); sc.ai.rec = { '*': { hang: true } }; sc.clientAbortAfterMs = 200_000; });
  }
  add('stream:storeErr', 5, (sc) => { R.stream(sc); sc.stores.dispatchQueueStore = { listItems: { throw: { kind: 'plain', message: 'db' } } }; });
  add('stream:closedAfterGate', 5, (sc) => { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'sk-free' }; R.stream(sc); sc.stores.freeTierStore = { tryUse: { ret: { allowed: true, remaining: 1, limit: 10 }, delayMs: 2000 } }; sc.clientAbortAfterMs = 1000; });

  // --- comments --------------------------------------------------------------------
  add('commentsGet:ok', 5, (sc, k) => { R.commentsGet(sc, [ISSUE_UUID, 'LIN-7', '#LIN-7', UUID(8), 'ENG-1'][k]); }, null);
  add('commentsGet:badId', 5, (sc) => R.commentsGet(sc, 'a_b'));
  add('commentsGet:401', 5, (sc) => { R.commentsGet(sc); sc.prov.fetchIssueComments = { throw: ERR.auth }; });
  add('commentsGet:404', 5, (sc) => { R.commentsGet(sc); sc.prov.fetchIssueComments = { throw: ERR.nf }; });
  add('commentsGet:500', 5, (sc) => { R.commentsGet(sc); sc.prov.fetchIssueComments = { throw: ERR.boom }; });
  add('comment:cap422', 5, (sc) => R.comment(sc), 'ghp');
  add('comment:capBare', 5, (sc) => R.comment(sc), 'bare');
  add('comment:noGuard422', 5, (sc) => R.comment(sc), 'noguard');
  add('comment:badId', 5, (sc) => R.comment(sc, { body: 'x' }, 'a_b'));
  add('comment:bodyInvalid', 7, (sc, k) => R.comment(sc, { body: ['', '  ', 5, null, undefined, 'bad\u0001x', ['a']][k] }));
  add('comment:tooLong', 5, (sc) => R.comment(sc, { body: 'c'.repeat(50_001) }));
  add('comment:noBody', 5, (sc, k) => { R.comment(sc); sc.body = [{ kind: 'none' }, { kind: 'raw', text: 'null', contentType: 'application/json' }, { kind: 'raw', text: 'body=x', contentType: 'application/x-www-form-urlencoded' }, { kind: 'raw', text: '{"body":', contentType: 'application/json' }, { kind: 'raw', text: '"str"', contentType: 'application/json' }][k]; });
  add('comment:trashed', 5, (sc) => { R.comment(sc); sc.prov.issueWriteGuard = { ret: { trashed: true } }; });
  add('comment:guardThrows', 5, (sc, k) => { R.comment(sc); sc.prov.issueWriteGuard = { throw: [ERR.auth, ERR.boom, ERR.hangup, ERR.nf, ERR.str][k] }; });
  add('comment:okEnvelope', 5, (sc, k) => { R.comment(sc, { body: `Fresh ruling ${k}` }); });
  add('comment:okBare', 5, (sc, k) => { R.comment(sc, { body: `Bare ${k}` }); sc.prov.createComment = { ret: { id: `cm-b${k}`, body: 'x' } }; }, 'localws');
  add('comment:notCreated', 5, (sc, k) => { R.comment(sc, { body: `nc ${k}` }); sc.prov.createComment = { ret: [{ success: false }, null, { success: true }, { success: true, comment: null }, false][k] }; });
  add('comment:testMode', 5, (sc, k) => { testEnv(sc); R.comment(sc, { body: `tm ${k}`, decisionLoopId: 'loop-1', decisionId: 'd' }, mock[k]); }, 'testws');
  add('comment:stamps', 8, (sc, k) => {
    R.comment(sc, { body: `stamp ${k}`, decisionLoopId: 'loop-1', decisionId: 'dec-1', optionId: k % 2 ? 'opt' : undefined, taskDecisionId: 'td-1', taskDecisionIssueId: ISSUE_UUID });
    if (k === 1) sc.stores.dispatchQueueStore = { markDecisionAnswered: { ret: null } };
    if (k === 2) sc.stores.dispatchQueueStore = { markDecisionAnswered: { throw: ERR.boom } };
    if (k === 3) sc.stores.taskDecisionsStore = { answer: { ret: { record: null } } };
    if (k === 4) sc.stores.taskDecisionsStore = { answer: { ret: { record: { outcome: 'dismissed' }, firstStampWins: false } } };
    if (k === 5) sc.stores.taskDecisionsStore = { answer: { throw: ERR.boom } };
    if (k === 6) sc.variant = 'sparse';
    if (k === 7) sc.stores.taskDecisionsStore = { answer: { ret: { record: { outcome: 'pending' }, firstStampWins: false } } };
  });
  add('comment:ledgerFail', 5, (sc, k) => { R.comment(sc, { body: `ledger ${k}` }); sc.stores.harbourCommentsStore = { record: { throw: ERR.boom } }; if (k === 3) sc.prov.createComment = { ret: { success: true, comment: { body: 'no id' } } }; });
  // dedupe pairs: the second identical submission (≤5 min later) hits commentDedupe
  for (let k = 0; k < 6; k++) {
    const body = { body: `Dedupe me ${k}`, ...(k % 2 ? { decisionLoopId: 'loop-1', decisionId: 'dec-1' } : {}), ...(k === 4 ? { taskDecisionId: 'td-1', taskDecisionIssueId: ISSUE_UUID } : {}) };
    add(`comment:dedupe${k}:first`, 1, (sc) => { R.comment(sc, body); if (k === 3) sc.stores.dispatchQueueStore = { markDecisionAnswered: { ret: null } }; if (k === 5) sc.stores.harbourCommentsStore = { record: { throw: ERR.boom } }; });
    add(`comment:dedupe${k}:second`, 1, (sc) => { R.comment(sc, body); if (k === 5) sc.stores.harbourCommentsStore = { record: { throw: ERR.boom } }; });
    add(`comment:dedupe${k}:third`, 1, (sc) => { R.comment(sc, body); if (k === 2) sc.prov.issueWriteGuard = { ret: { trashed: true } }; });
  }
  // LIN-2933 recovery
  const auth401 = { throw: { kind: 'gql', status: 401, message: 'Authentication required' } };
  const okC = { ret: { success: true, comment: { id: 'cm-rec', body: 'x' } } };
  add('comment:recoverDurable', 5, (sc, k) => { R.comment(sc, { body: `rec ${k}` }); sc.prov.createComment = { seq: [auth401, okC] }; sc.stores.ownerCredentialStore = { get: { ret: { token: 'lin_durable_new', tokenExpiresAt: 1_900_000_000_000, provider: 'linear' } } }; if (k === 1) sc.sessionSave = 'fail'; if (k === 2) sc.prov.issueWriteGuard = { seq: [{ ret: { id: ISSUE_UUID } }, { ret: { trashed: true } }] }; if (k === 3) sc.prov.createComment = { seq: [auth401, { ret: { success: false } }] }; if (k === 4) sc.prov.createComment = { seq: [auth401, auth401] }; });
  add('comment:recoverSameToken', 5, (sc, k) => { R.comment(sc, { body: `same ${k}` }); sc.prov.createComment = auth401; sc.stores.ownerCredentialStore = { get: [{ ret: { token: 'lin_tok_acme' } }, { ret: null }, { throw: ERR.boom }, { ret: {} }, { ret: { token: 'lin_tok_acme', provider: 'linear' } }][k] }; });
  add('comment:recoverIneligible', 6, (sc, k) => { R.comment(sc, { body: `inel ${k}` }, ISSUE_UUID, k === 0 ? '?source=linear' : ''); sc.prov.createComment = auth401; sc.stores.ownerCredentialStore = { get: { ret: { token: 'lin_new' } } }; if (k === 1) sc.variant = 'sparse'; if (k === 2) { sc.prov.createComment = { throw: ERR.hangup }; } if (k === 3) { testEnv(sc); } if (k === 4) sc.prov.createComment = { throw: ERR.boom }; }, null);
  add('comment:recoverIneligibleProvider', 5, (sc, k) => { R.comment(sc, { body: `prov ${k}` }); sc.prov.createComment = auth401; sc.stores.ownerCredentialStore = { get: { ret: { token: 'new' } } }; }, 'localws');
  add('comment:recoverConnection', 6, (sc, k) => { R.comment(sc, { body: `conn ${k}` }); sc.prov.createComment = { seq: [auth401, okC] }; sc.adoptConnection = ['adopt', 'none', 'throw', 'adopt', 'adopt', 'adopt'][k]; if (k === 3) sc.variant = 'seams'; if (k === 4) sc.prov.createComment = { seq: [auth401, auth401] }; if (k === 5) sc.sessionSave = 'fail'; }, 'conn');
  add('comment:recoverConnectionNoSeam', 5, (sc) => { R.comment(sc, { body: 'conn-noseam' }); sc.variant = 'sparse'; sc.prov.createComment = auth401; }, 'conn');

  // --- detail ----------------------------------------------------------------------
  add('detail:ok', 6, (sc, k) => { R.detail(sc, ISSUE_UUID, `?section=${['project', 'in-progress', 'recent-activity', 'bogus', '', 'project'][k]}${k === 5 ? '&source=github' : ''}`); if (k === 1) sc.headers.host = 'localhost:3000'; if (k === 2) sc.headers.host = '127.0.0.1'; }, null);
  add('detail:testMock', 5, (sc, k) => { testEnv(sc); R.detail(sc, mock[k]); }, 'testws');
  add('detail:testMockMissing', 5, (sc) => { testEnv(sc); R.detail(sc, 'NOPE-1'); }, 'testws');
  add('detail:customFail', 5, (sc) => { R.detail(sc); sc.stores.customPromptsStore = { list: { throw: ERR.boom } }; });
  add('detail:badId', 5, (sc) => R.detail(sc, 'a_b'));
  add('detail:401', 5, (sc) => { R.detail(sc); sc.prov.fetchIssueFields = { throw: ERR.auth }; });
  add('detail:404', 5, (sc) => { R.detail(sc); sc.prov.fetchIssueFields = { throw: ERR.nf }; });
  add('detail:500', 5, (sc) => { R.detail(sc); sc.prov.fetchIssueFields = { throw: ERR.boom }; });

  // --- sessions --------------------------------------------------------------------
  add('sessions:ok', 5, (sc, k) => { R.sessions(sc, ['LIN-7', 'x', 'LIN-7%20a', 'ü', 'LIN-8'][k]); sc.stores.dispatchQueueStore = { listItems: { ret: [{ _id: `d${k}`, id: `d${k}`, issueIdentifier: 'LIN-7', kind: 'implementation', status: 'taken', dispatchedAt: { __date: new Date(sc.clockBase - 7_200_000).toISOString() }, sessionId: 's1', target: 'cli', promptName: 'Impl' }, { _id: `e${k}`, id: `e${k}`, issueIdentifier: 'LIN-7', kind: 'review', status: 'queued', dispatchedAt: { __date: new Date(sc.clockBase - 3_600_000).toISOString() }, target: 'web', promptName: 'Review' }] }, listHistory: { ret: { items: [{ _id: `h${k}`, id: `h${k}`, issueIdentifier: 'LIN-7', kind: 'plan', status: 'done', dispatchedAt: { __date: new Date(sc.clockBase - 86_400_000).toISOString() }, promptName: 'Plan' }], total: 1 } } }; sc.stores.agentStatusStore = { listStatus: { ret: [{ sessionId: 's1', status: 'working', updatedAt: { __date: new Date(sc.clockBase - 7_000_000).toISOString() } }] } }; });
  add('sessions:tooLong', 5, (sc) => R.sessions(sc, 'x'.repeat(101)));
  add('sessions:noStores', 5, (sc) => { sc.variant = 'sparse'; R.sessions(sc); });
  add('sessions:500', 5, (sc) => { R.sessions(sc); sc.stores.agentStatusStore = { listStatus: { throw: ERR.boom } }; });

  // --- recap / brief -------------------------------------------------------------------
  for (const kind of ['recap', 'brief']) {
    const G_ = kind === 'recap' ? R.recapGet : R.briefGet;
    const P_ = kind === 'recap' ? R.recapPost : R.briefPost;
    const store = `${kind}CacheStore`;
    add(`${kind}Get:badId`, 5, (sc) => G_(sc, 'a_b'));
    add(`${kind}Get:noStore`, 5, (sc) => { sc.variant = 'sparse'; G_(sc); });
    add(`${kind}Get:cap422`, 5, (sc) => G_(sc), 'bare');
    add(`${kind}Get:missing`, 5, (sc) => G_(sc));
    add(`${kind}Get:stale`, 5, (sc) => { G_(sc); sc.stores[store] = { get: { ret: { inputHash: 'x', generatedAt: '2026-09-30T00:00:00.000Z', model: 'm' } } }; });
    add(`${kind}Get:fresh`, 5, (sc) => { G_(sc); sc.prov.fetchRecommendationContext = { ret: ctx() }; sc.stores[store] = { get: { ret: { inputHash: { __fromState: 'ctxHash' }, [kind]: kind === 'recap' ? { done: [{ item: 'a' }] } : 'B', generatedAt: '2026-09-30T00:00:00.000Z', model: 'm' } } }; });
    add(`${kind}Get:testMock`, 5, (sc, k) => { testEnv(sc); G_(sc, ['TEST-1', mock[k], 'issue-2', mock[6], 'TEST-11'][k]); }, 'testws');
    add(`${kind}Get:testMockMissing`, 5, (sc) => { testEnv(sc); G_(sc, 'NOPE-1'); }, 'testws');
    add(`${kind}Get:noCanonical`, 5, (sc) => { G_(sc, 'LIN-7'); sc.prov.fetchRecommendationContext = { ret: { issue: { identifier: 'LIN-7' } } }; });
    add(`${kind}Get:401`, 5, (sc) => { G_(sc); sc.prov.fetchRecommendationContext = { throw: ERR.auth }; });
    add(`${kind}Get:404`, 5, (sc) => { G_(sc); sc.prov.fetchRecommendationContext = { throw: ERR.nf }; });
    add(`${kind}Get:500`, 5, (sc) => { G_(sc); sc.stores[store] = { get: { throw: ERR.boom } }; });
    add(`${kind}Post:badId`, 5, (sc) => P_(sc, 'a_b'));
    add(`${kind}Post:noStore`, 5, (sc) => { sc.variant = 'sparse'; P_(sc); });
    add(`${kind}Post:cap422`, 5, (sc) => P_(sc), 'bare');
    add(`${kind}Post:noAi503`, 5, (sc) => { sc.env = { NODE_ENV: 'production' }; P_(sc); });
    add(`${kind}Post:freeTierBlocked`, 5, (sc) => { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'k' }; P_(sc); sc.stores.freeTierStore = { tryUse: { ret: { allowed: false, reason: 'limit', remaining: 0, limit: 1, resetsAt: 'r' } } }; });
    add(`${kind}Post:freeTierOk`, 5, (sc) => { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'k' }; P_(sc); });
    add(`${kind}Post:ok`, 5, (sc, k) => { P_(sc); sc.ai.chat = { [kind]: { text: kind === 'recap' ? ['{"done":[{"item":"x","evidence":"y"}],"pending":[],"deviations":[]}', 'garbage', '', '```json\n{"pending":[{"item":"p"}]}\n```', '{"done":"x"}'][k] : ['## Current\nB', '', '```\n## Current\n```', 'plain', '## C'][k] } }; if (k === 1) sc.stores[store] = { get: { ret: null } }; if (k === 2) sc.stores[store] = { get: { ret: { [kind]: 'stored', generatedAt: '2026-10-01T12:00:00.000Z' } } }; });
    add(`${kind}Post:mockLocal`, 5, (sc, k) => { testEnv(sc); P_(sc); sc.prov.fetchRecommendationContext = { ret: ctx(ISSUE_UUID, { children: k % 2 ? [{ id: 'k1', identifier: 'LIN-31', title: 'K', state: { type: 'started' } }, { id: 'k2', identifier: 'LIN-32', state: { type: 'completed' } }] : [], comments: k > 2 ? [] : undefined }) }; }, 'localws');
    add(`${kind}Post:testMock`, 5, (sc, k) => { testEnv(sc); P_(sc, ['TEST-1', 'issue-2', mock[6], 'TEST-11', mock[3]][k]); }, 'testws');
    add(`${kind}Post:testMockMissing`, 5, (sc) => { testEnv(sc); P_(sc, 'NOPE-1'); }, 'testws');
    add(`${kind}Post:401`, 5, (sc) => { P_(sc); sc.prov.fetchRecommendationContext = { throw: ERR.auth }; });
    add(`${kind}Post:404`, 5, (sc) => { P_(sc); sc.prov.fetchRecommendationContext = { throw: ERR.nf }; });
    add(`${kind}Post:openrouter503`, 5, (sc) => { P_(sc); sc.ai.chat = { [kind]: { throw: ERR.or } }; });
    add(`${kind}Post:500`, 5, (sc, k) => { P_(sc); if (k < 3) sc.ai.chat = { [kind]: { throw: [ERR.boom, ERR.str, ERR.hangup][k] } }; else sc.stores[store] = { put: { throw: ERR.boom } }; });
    add(`${kind}Post:slow`, 5, (sc, k) => { P_(sc); sc.ai.chat = { [kind]: k < 3 ? { text: 'x', delayMs: [26_000, 45_000, 90_000][k] } : { throw: ERR.or, delayMs: 30_000 } }; });
  }

  // --- context -----------------------------------------------------------------------
  const ctxIssues = [{ id: ISSUE_UUID, identifier: 'LIN-7', title: 'A', state: { type: 'started' } }, { id: UUID(8), identifier: 'LIN-8', title: 'B', state: { type: 'unstarted' }, parent: { id: ISSUE_UUID } }];
  add('context:ok', 5, (sc, k) => { R.context(sc, [ISSUE_UUID, 'lin-7', 'LIN-8', UUID(8), 'LIN-7'][k]); sc.prov.fetchProjects = { ret: { projects: [], issues: ctxIssues } }; });
  add('context:notInSet', 5, (sc, k) => { R.context(sc, ['LIN-99', UUID(99), 'x', 'LIN-1', 'abc'][k]); sc.prov.fetchProjects = { ret: { issues: ctxIssues } }; });
  add('context:nullIssues', 5, (sc) => { R.context(sc); sc.prov.fetchProjects = { ret: {} }; });
  add('context:testMock', 5, (sc, k) => { testEnv(sc); R.context(sc, ['TEST-1', 'issue-2', 'test-30', mock[7], 'TEST-31'][k]); }, 'testws');
  add('context:badId', 5, (sc) => R.context(sc, 'a_b'));
  add('context:401', 5, (sc) => { R.context(sc); sc.prov.fetchProjects = { throw: ERR.auth }; });
  add('context:404', 5, (sc) => { R.context(sc); sc.prov.fetchProjects = { throw: ERR.nf }; });
  add('context:500', 5, (sc) => { R.context(sc); sc.prov.fetchProjects = { throw: ERR.boom }; });
  add('context:providers', 6, (sc) => R.context(sc), null);

  // --- scan GET / POST ----------------------------------------------------------------
  add('scanGet:badId', 5, (sc) => R.scanGet(sc, 'a_b'));
  add('scanGet:noStore', 5, (sc) => { sc.variant = 'sparse'; R.scanGet(sc); });
  add('scanGet:cap422', 5, (sc) => R.scanGet(sc), 'bare');
  add('scanGet:noCanonical', 5, (sc) => { R.scanGet(sc, 'LIN-7'); sc.prov.fetchRecommendationContext = { ret: ctx('x', { issue: { identifier: 'LIN-7', id: 'not-uuid' } }) }; });
  add('scanGet:missing', 5, (sc) => R.scanGet(sc));
  add('scanGet:stale', 5, (sc, k) => { R.scanGet(sc); sc.stores.taskDecisionsStore = { getStatus: { ret: { id: 'row', issueId: ISSUE_UUID, inputHash: 'old', decision: { question: 'q' }, scannedAt: 's', outcome: k % 2 ? 'answered' : null, outcomeAt: null, basisHash: k > 2 ? 'b' : undefined, basisVersion: [1, 2, undefined, 1, 99][k], ...(k === 4 ? { outcomeReason: 'r', outcomeBasisHash: 'h' } : {}) } } }; });
  add('scanGet:fresh', 5, (sc, k) => { R.scanGet(sc); sc.prov.fetchRecommendationContext = { ret: ctx() }; sc.stores.taskDecisionsStore = { getStatus: { ret: { id: 'row', issueId: ISSUE_UUID, inputHash: { __fromState: 'ctxHash' }, decision: null, scannedAt: 's', outcome: 'dismissed', outcomeAt: 'a', basisVersion: k, basisHash: 'h' } } }; });
  add('scanGet:testMock', 5, (sc, k) => { testEnv(sc); R.scanGet(sc, ['TEST-6', mock[5], mock[6], 'TEST-1', 'TEST-15'][k]); }, 'testws');
  add('scanGet:testMockMissing', 5, (sc) => { testEnv(sc); R.scanGet(sc, 'NOPE-1'); }, 'testws');
  add('scanGet:401', 5, (sc) => { R.scanGet(sc); sc.prov.fetchRecommendationContext = { throw: ERR.auth }; });
  add('scanGet:404', 5, (sc) => { R.scanGet(sc); sc.prov.fetchRecommendationContext = { throw: ERR.nf }; });
  add('scanGet:500', 5, (sc) => { R.scanGet(sc); sc.stores.taskDecisionsStore = { getStatus: { throw: ERR.boom } }; });
  add('scanPost:badId', 5, (sc) => R.scanPost(sc, 'a_b'));
  add('scanPost:noStore', 5, (sc) => { sc.variant = 'sparse'; R.scanPost(sc); });
  add('scanPost:cap422', 5, (sc) => R.scanPost(sc), 'bare');
  add('scanPost:noAi', 5, (sc) => { sc.env = { NODE_ENV: 'production' }; R.scanPost(sc); });
  add('scanPost:freeTier', 5, (sc, k) => { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'k' }; R.scanPost(sc); if (k < 3) sc.stores.freeTierStore = { tryUse: { ret: { allowed: false, reason: 'limit', remaining: 0, limit: 2, resetsAt: 'r' } } }; });
  add('scanPost:outcomes', 8, (sc, k) => { R.scanPost(sc, ISSUE_UUID, ['', '?source=linear', '?source=%20github%20', '?source=', '', '', '', ''][k]); sc.ai.chat = { scan: { text: [JSON.stringify({ has_decision: false }), JSON.stringify({ has_decision: true, question: 'Which?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'a', free_text: false }), JSON.stringify({ has_decision: true, question: 'Free?', free_text: true }), 'garbage', JSON.stringify({ has_decision: true, question: '' }), JSON.stringify({ has_decision: true, question: 'Q', options: [{ id: 1 }] }), '', JSON.stringify([1])][k] } }; });
  add('scanPost:ledger', 5, (sc, k) => { R.scanPost(sc); sc.stores.harbourCommentsStore = { wereRecordedByHarbour: [{ ret: { __setOf: ['c1'] } }, { ret: { __setOf: [] } }, { throw: ERR.boom }, { ret: { __setOf: ['zz'] } }, { ret: { __setOf: ['c1'] } }][k] }; if (k === 4) sc.variant = 'seams'; });
  add('scanPost:recordNull', 5, (sc, k) => { R.scanPost(sc); sc.stores.taskDecisionsStore = { recordScan: k < 3 ? { ret: null } : { throw: ERR.boom } }; });
  add('scanPost:noCanonical', 5, (sc) => { R.scanPost(sc, 'LIN-7'); sc.prov.fetchRecommendationContext = { ret: ctx('x', { issue: { identifier: 'LIN-7' } }) }; });
  add('scanPost:mockLocal', 5, (sc, k) => { testEnv(sc); R.scanPost(sc); sc.prov.fetchRecommendationContext = { ret: ctx(ISSUE_UUID, { issue: { id: ISSUE_UUID, identifier: 'LIN-7', description: ['plain', 'we are waiting', 'Decision needed', '', 'blocked'][k], state: { type: 'started' } }, comments: k === 3 ? [{ id: 'c', body: 'research this' }] : [] }) }; }, 'localws');
  add('scanPost:testMock', 5, (sc, k) => { testEnv(sc); R.scanPost(sc, [mock[5], mock[6], 'TEST-1', mock[8], 'NOPE-9'][k]); }, 'testws');
  add('scanPost:errors', 6, (sc, k) => { R.scanPost(sc); if (k < 3) sc.prov.fetchRecommendationContext = { throw: [ERR.auth, ERR.nf, ERR.boom][k] }; else sc.ai.chat = { scan: { throw: [ERR.or, ERR.boom, ERR.str][k - 3] } }; });
  add('scanPost:slow', 3, (sc) => { R.scanPost(sc); sc.ai.chat = { scan: { text: '{"has_decision":false}', delayMs: 40_000 } }; });

  // --- dismiss / retire / unretire ------------------------------------------------------
  for (const [op, fn] of [['dismiss', R.dismiss], ['retire', R.retire], ['unretire', R.unretire]]) {
    add(`${op}:badId`, 5, (sc) => fn(sc, 'a_b'));
    add(`${op}:noRecordId`, 6, (sc, k) => { fn(sc, ISSUE_UUID, [{}, { id: '' }, { id: 5 }, { id: null }, { id: ['r'] }, {}][k]); if (k === 5) sc.body = { kind: 'none' }; });
    add(`${op}:noStore`, 5, (sc) => { sc.variant = 'sparse'; fn(sc); });
    add(`${op}:capViaIdentifier`, 5, (sc) => fn(sc, 'LIN-7'), 'bare');
    add(`${op}:uuidCap`, 5, (sc) => fn(sc), 'bare');
    add(`${op}:identifier`, 5, (sc, k) => { fn(sc, ['LIN-7', 'lin-7', '#LIN-7', 'ENG-1', 'LIN-8'][k]); sc.prov.fetchRecommendationContext = { ret: ctx() }; });
    add(`${op}:identifierNoCanonical`, 5, (sc) => { fn(sc, 'LIN-7'); sc.prov.fetchRecommendationContext = { ret: ctx('x', { issue: { identifier: 'LIN-7' } }) }; });
    add(`${op}:testMock`, 5, (sc, k) => { testEnv(sc); fn(sc, [mock[5], 'TEST-1', 'issue-2', mock[6], 'TEST-15'][k]); }, 'testws');
    add(`${op}:testMockMissing`, 5, (sc) => { testEnv(sc); fn(sc, 'NOPE-1'); }, 'testws');
    add(`${op}:ctx401`, 5, (sc) => { fn(sc, 'LIN-7'); sc.prov.fetchRecommendationContext = { throw: ERR.auth }; });
    add(`${op}:ctx404`, 5, (sc) => { fn(sc, 'LIN-7'); sc.prov.fetchRecommendationContext = { throw: ERR.nf }; });
    add(`${op}:ctx500`, 5, (sc) => { fn(sc, 'LIN-7'); sc.prov.fetchRecommendationContext = { throw: ERR.boom }; });
  }
  add('dismiss:ok', 5, (sc, k) => { R.dismiss(sc); if (k === 1) sc.variant = 'sparse'; if (k === 2) sc.stores.taskDecisionsStore = { markOutcome: { ret: { id: 'row-1', issueId: ISSUE_UUID, outcome: 'answered', decision: { q: 1 }, outcomeReason: 'x', outcomeBasisHash: 'h' } } }; });
  add('dismiss:notFound', 5, (sc) => { R.dismiss(sc); sc.stores.taskDecisionsStore = { markOutcome: { ret: null } }; });
  add('dismiss:storeErr', 5, (sc, k) => { R.dismiss(sc); sc.stores.taskDecisionsStore = { markOutcome: { throw: [ERR.boom, ERR.nf, ERR.auth, ERR.str, ERR.boom][k] } }; });
  add('retire:noAi', 5, (sc) => { sc.env = { NODE_ENV: 'production' }; R.retire(sc); });
  add('retire:freeTier', 5, (sc, k) => { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'k' }; R.retire(sc); if (k < 3) sc.stores.freeTierStore = { tryUse: { ret: { allowed: false, reason: 'limit', remaining: 0, limit: 2, resetsAt: 'r' } } }; });
  add('retire:noCanonical', 5, (sc) => { R.retire(sc); sc.prov.fetchRecommendationContext = { ret: ctx('x', { issue: { identifier: 'LIN-7', id: 'zz' } }) }; });
  add('retire:texts', 6, (sc, k) => { R.retire(sc); sc.ai.chat = { 'scan-retire': { text: [JSON.stringify({ has_decision: false }), JSON.stringify({ has_decision: true, question: 'q', options: [{ id: 'a', label: 'A' }] }), 'garbage', '', JSON.stringify({ x: 1 }), '```json\n{"has_decision": false}\n```'][k] } }; });
  add('retire:markOutcomes', 6, (sc, k) => { R.retire(sc); sc.stores.taskDecisionsStore = { markOutcome: [{ ret: null }, { ret: { id: 'row-1', outcome: 'dismissed' } }, { throw: ERR.boom }, { ret: { id: 'row-1', issueId: ISSUE_UUID, outcome: 'self-resolved', outcomeAt: 'a', outcomeReason: 'r', outcomeBasisHash: 'h', scannedAt: 's' } }, { throw: ERR.str }, { ret: { outcome: 'self-resolved' } }][k] }; if (k === 3) sc.variant = 'seams'; });
  add('retire:mockLocal', 5, (sc, k) => { testEnv(sc); R.retire(sc); sc.prov.fetchRecommendationContext = { ret: ctx(ISSUE_UUID, { issue: { id: ISSUE_UUID, identifier: 'LIN-7', description: ['plain', 'waiting on X', '', 'decide', 'none'][k], state: { type: 'started' } }, comments: [] }) }; }, 'localws');
  add('retire:aiErr', 5, (sc, k) => { R.retire(sc); sc.ai.chat = { 'scan-retire': { throw: [ERR.or, ERR.boom, ERR.nf, ERR.auth, ERR.str][k] } }; });
  add('retire:slow', 3, (sc, k) => { R.retire(sc); sc.ai.chat = { 'scan-retire': { text: k ? 'garbage' : '{"has_decision":false}', delayMs: 30_000 } }; if (k === 2) sc.stores.taskDecisionsStore = { markOutcome: { ret: null } }; });
  add('unretire:ok', 5, (sc, k) => { R.unretire(sc, k % 2 ? 'LIN-7' : ISSUE_UUID); if (k === 2) sc.variant = 'sparse'; });
  add('unretire:storeErrors', 6, (sc, k) => { R.unretire(sc); sc.stores.taskDecisionsStore = { reverseOutcome: { throw: [{ kind: 'plain', message: 'reverseOutcome: row not found (pruned or replaced)' }, { kind: 'plain', message: 'reverseOutcome: row is not self-resolved' }, ERR.auth, ERR.boom, ERR.str, ERR.nf][k] } }; });

  // --- scan-due --------------------------------------------------------------------------
  const goodCursor = Buffer.from(JSON.stringify({ scannedAt: '2026-09-01T00:00:00.000Z', issueId: ISSUE_UUID })).toString('base64url');
  add('scanDue:noStore', 5, (sc) => { sc.variant = 'sparse'; R.scanDue(sc); });
  add('scanDue:cap422', 5, (sc) => R.scanDue(sc), 'bare');
  add('scanDue:badCursor', 7, (sc, k) => R.scanDue(sc, `?cursor=${['%25%25', Buffer.from('null').toString('base64url'), Buffer.from('{"scannedAt":1,"issueId":"x"}').toString('base64url'), Buffer.from('[]').toString('base64url'), 'bm90IGpzb24', `${goodCursor}&cursor=${goodCursor}`, Buffer.from('"str"').toString('base64url')][k]}`));
  add('scanDue:ok', 6, (sc, k) => {
    R.scanDue(sc, k % 2 ? `?cursor=${goodCursor}` : (k === 4 ? '?cursor=' : ''));
    const items = [{ issueId: UUID(30), issueIdentifier: 'LIN-30', dueBasisHash: 'h', dueBasisVersion: 1 }, { issueId: UUID(31), issueIdentifier: 'LIN-31', dueBasisHash: null, issueSource: 'github' }, { issueId: UUID(32), issueIdentifier: 'LIN-32', dueBasisHash: 'h', dueBasisVersion: 2, issueSource: 'linear' }].slice(0, k + 1);
    sc.stores.taskDecisionsStore = { listCandidatesForWorkspace: { ret: { items, nextCursor: k > 2 ? { scannedAt: '2026-09-02T00:00:00.000Z', issueId: UUID(33) } : null, totalCandidateCount: 7 } } };
    sc.prov.fetchRecommendationContext = { retByArg: { [UUID(31)]: { throw: ERR.boom }, '*': { ret: ctx() } } };
    if (k === 5) sc.variant = 'seams';
    if (k === 3) sc.stores.harbourCommentsStore = { wereRecordedByHarbour: { ret: { __setOf: ['c1'] } } };
  });
  add('scanDue:sparseLedger', 5, (sc) => { sc.variant = 'full'; R.scanDue(sc); sc.stores.taskDecisionsStore = { listCandidatesForWorkspace: { ret: { items: [{ issueId: UUID(30), issueIdentifier: 'LIN-30' }], nextCursor: null, totalCandidateCount: 1 } } }; sc.stores.harbourCommentsStore = { wereRecordedByHarbour: { throw: ERR.boom } }; });
  add('scanDue:storeErr', 5, (sc, k) => { R.scanDue(sc); sc.stores.taskDecisionsStore = { listCandidatesForWorkspace: { throw: k % 2 ? ERR.str : ERR.boom } }; });
  add('scanDue:slow', 3, (sc) => { R.scanDue(sc); sc.stores.taskDecisionsStore = { listCandidatesForWorkspace: { ret: { items: [], nextCursor: null, totalCandidateCount: 0 }, delayMs: 30_000 } }; });
  add('scanDue:providers', 6, (sc) => R.scanDue(sc), null);

  // --- image -----------------------------------------------------------------------------
  add('image:missingUrl', 5, (sc, k) => { R.image(sc); sc.path = P(sc, ['/image', '/image?url=', '/image?x=1', '/image?url', '/image?'][k]); });
  add('image:notHttps', 5, (sc, k) => R.image(sc, ['http://uploads.linear.app/a.png', 'ftp://x', 'HTTPS://uploads.linear.app/a.png', 'javascript:alert(1)', '//uploads.linear.app/a'][k]));
  add('image:hostDenied', 6, (sc, k) => R.image(sc, ['https://evillinear.app/a.png', 'https://uploads.linear.app.evil.com/a', 'https://localhost/a', 'https://169.254.169.254/latest', 'https://user@evil.com/uploads.linear.app', 'https://UPLOADS.LINEAR.APP/a.png'][k]));
  add('image:traversal', 5, (sc, k) => R.image(sc, ['https://uploads.linear.app/../x', 'https://uploads.linear.app/a/..%2f..', 'https://uploads.linear.app/a/%2e%2e/b', 'https://linear.app/a/../../b', 'https://cdn.linear.app/..'][k]));
  add('image:badFormat', 5, (sc, k) => R.image(sc, ['https://[::1', 'https://', 'https://a b', 'https://%zz', 'https://:80'][k]));
  add('image:arrayUrl', 5, (sc) => { sc.method = 'GET'; sc.path = P(sc, '/image?url=https%3A%2F%2Fuploads.linear.app%2Fa.png&url=x'); });
  add('image:ok', 8, (sc, k) => { R.image(sc, ['https://uploads.linear.app/a.png', 'https://cdn.linear.app/b.jpg', 'https://linear.app/c.gif', 'https://uploads.linear.app/d.webp', 'https://uploads.linear.app/e?sig=1', 'https://uploads.linear.app/f', 'https://uploads.linear.app/g', 'https://uploads.linear.app/h'][k]); sc.fetch.image = { status: 200, bytes: ['png', 'jpg', 'gif', 'webp', 'png', 'png', 'jpg', 'png'][k], headers: { 'content-type': 'image/png' } }; }, null);
  add('image:credentialEgress', 11, (sc) => { R.image(sc); sc.fetch.image = { status: 200, bytes: 'png' }; }, null);
  add('image:nonRaster', 5, (sc, k) => { R.image(sc); sc.fetch.image = { status: 200, bytes: ['svg', 'html', 'empty', 'garbage text', 'svg'][k], headers: { 'content-type': k === 4 ? 'image/png' : 'image/svg+xml' } }; });
  add('image:upstreamStatus', 6, (sc, k) => { R.image(sc); sc.fetch.image = { status: [404, 401, 403, 500, 502, 418][k], bytes: 'empty' }; });
  add('image:tooLarge', 5, (sc, k) => { R.image(sc); sc.fetch.image = k < 3 ? { status: 200, bytes: 'png', headers: { 'content-length': String([10 * 1024 * 1024 + 1, 50 * 1024 * 1024, 999_999_999][k]) } } : { status: 200, bigBytes: 10 * 1024 * 1024 + k }; });
  add('image:fetchThrows', 6, (sc, k) => { R.image(sc); sc.fetch.image = { throw: [{ kind: 'cause', message: 'fetch failed', code: 'ERR_FR_TOO_MANY_REDIRECTS' }, { kind: 'plain', message: 'redirect mode is set to error' }, { kind: 'plain', message: 'ECONNRESET' }, { kind: 'network', message: 'fetch failed', code: 'ENOTFOUND' }, { kind: 'timeout' }, { kind: 'cause', message: 'x', code: 'OTHER' }][k] }; });

  // --- feedback --------------------------------------------------------------------------
  const okIssue = { ret: { success: true, issue: { id: UUID(99), identifier: 'LIN-99', title: 'T', url: 'https://linear.app/acme/issue/LIN-99', state: { type: 'unstarted' } } } };
  add('feedback:validation', 10, (sc, k) => R.feedback(sc, [{ message: '' }, { message: '   ' }, { message: 5 }, {}, { message: 'm'.repeat(10_001) }, { message: 'ok', model: 'bad\u0001' }, { message: 'ok', harness: 5 }, { message: 'ok', model: 'm'.repeat(1001) }, { message: 'ok', harness: 'h\u0007' }, { message: ['a'] }][k]));
  add('feedback:cap', 6, (sc, k) => { R.feedback(sc, k % 2 ? { message: 'img', image: 'data:image/png;base64,iVBORw0KGgo=' } : { message: 'x' }); }, null);
  add('feedback:capBare', 5, (sc) => R.feedback(sc), 'bare');
  add('feedback:team', 6, (sc, k) => { R.feedback(sc, { message: 'team', ...(k === 0 ? { teamId: ' team-b ' } : {}), ...(k === 1 ? { teamId: '   ' } : {}) }); if (k === 2) sc.env.FEEDBACK_TEAM_ID = 'team-env'; if (k === 3) sc.prov.fetchTeams = { ret: [] }; if (k === 4) sc.prov.fetchTeams = { throw: ERR.boom }; if (k === 5) sc.prov.fetchTeams = { ret: [{ name: 'no id' }] }; });
  add('feedback:teamGithub', 5, (sc) => R.feedback(sc), 'ghws');
  add('feedback:teamless', 5, (sc) => R.feedback(sc), 'localws');
  add('feedback:project', 5, (sc, k) => { R.feedback(sc, { message: 'p', ...(k < 2 ? { projectId: [' proj-1 ', ' '][k] } : {}) }); if (k > 1) sc.env.FEEDBACK_PROJECT_ID = 'proj-env'; });
  add('feedback:capture', 5, (sc, k) => R.feedback(sc, { message: 'Line1\nLine2', url: ['https://h/x', '  ', 'u'.repeat(2500), undefined, 'https://h/`code`'][k], userAgent: ['UA', '', undefined, 'U'.repeat(2100), 'Mozilla'][k] }));
  add('feedback:priority', 8, (sc, k) => { R.feedback(sc, { message: 'prio', priority: [0, 1, 2, 4, 5, '3', 'x', -1][k] }); }, null);
  add('feedback:image', 6, (sc, k) => { R.feedback(sc, { message: 'img', image: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', 'not-a-data-url', 'data:text/plain;base64,aGk=', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', 'data:image/png;base64,' + 'A'.repeat(14_200_000), 'data:image/png;base64,iVBORw0KGgo='][k] }); if (k === 4) sc.body = { kind: 'raw', text: JSON.stringify({ message: 'img', image: 'data:image/png;base64,' + 'A'.repeat(14_200_000) }), contentType: 'text/plain' }; if (k === 5) sc.prov.uploadFile = { throw: ERR.boom }; });
  add('feedback:title', 8, (sc, k) => {
    R.feedback(sc, { message: 'Title source\nmore', ...(k === 0 ? { title: ' Explicit ' } : {}), ...(k === 1 ? { title: 't'.repeat(300) } : {}), ...(k === 2 ? { title: '  ' } : {}) });
    if (k === 3) sc.env = { NODE_ENV: 'production' };
    if (k === 4) sc.ai.chat = { 'feedback-title': { throw: ERR.boom } };
    if (k === 5) sc.ai.chat = { 'feedback-title': { text: '' } };
    if (k === 6) { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'k' }; }
    if (k === 7) sc.session.openRouterApiKey = 'sk-s';
  });
  add('feedback:mockTitle', 5, (sc, k) => { testEnv(sc); R.feedback(sc, { message: ['  First line\nsecond', 'x'.repeat(200), 'one'][k % 3] }); }, 'localws');
  add('feedback:createFail', 6, (sc, k) => { R.feedback(sc); sc.prov.createIssue = [{ ret: { success: false } }, { ret: null }, { ret: { success: true } }, { throw: ERR.boom }, { throw: ERR.auth }, { ret: { success: true, issue: null } }][k]; });
  add('feedback:actions', 8, (sc, k) => { R.feedback(sc, { message: 'act', action: ['save', 'triage', 'autopilot', 'bogus', 7, undefined, 'triage', 'autopilot'][k] }); if (k >= 5) sc.session.features.feedbackTriage = true; if (k === 7) { sc.session.features.feedbackTriage = false; } });
  add('feedback:legacyTriageFlag', 5, (sc, k) => { R.feedback(sc, { message: 'legacy' }); sc.session.features.feedbackTriage = k !== 4; if (k === 1) sc.variant = 'sparse'; if (k === 2) sc.prov.createIssue = { ret: { success: true, issue: { id: 'x', title: 'no identifier' } } }; });
  add('feedback:ownerRefusal', 8, (sc, k) => { R.feedback(sc, { message: 'own', action: k % 2 ? 'autopilot' : 'triage' }); sc.ownerCheck = [{ ret: { status: 'not-owner' } }, { ret: { status: 'no-owner' } }, { throw: ERR.boom }, { ret: null }, { ret: { status: 'weird' } }, { ret: { status: 'not-owner' } }, { ret: { status: 'owner' } }, { ret: { status: 'no-owner' } }][k]; if (k === 6) delete sc.session.accountId; if (k === 5) sc.session.accountId = 'acct-member'; });
  add('feedback:noOwnerSeam', 5, (sc, k) => { sc.variant = 'sparse'; R.feedback(sc, { message: 'seam', action: k % 2 ? 'autopilot' : 'triage' }); });
  add('feedback:triageOverrides', 6, (sc, k) => { R.feedback(sc, { message: 'ov', action: k % 2 ? 'autopilot' : 'triage', model: ['m-x', '', undefined, 'anthropic/claude', 'm', 'z'][k], harness: ['opencode', 'claude-code', '', undefined, 'codex', 'opencode'][k] }); if (k > 3) sc.stores.workspacePreferencesStore = { getWorkspacePreferences: { ret: { dispatchDefaults: { harness: 'opencode', model: 'wsm' } } } }; });
  add('feedback:runLimit', 6, (sc, k) => { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'k' }; R.feedback(sc, { message: 'rl', action: k % 2 ? 'autopilot' : 'triage' }); sc.stores.freeTierStore = { checkRun: [{ ret: { allowed: false, code: 'RUN_LIMIT_REACHED', reason: 'limit', runsUsed: 10, limit: 10 } }, { ret: { allowed: false, code: 'RUN_LIMIT_REACHED', reason: 'limit' } }, { throw: ERR.boom }, { throw: ERR.boom }, { ret: { allowed: true } }, { ret: { allowed: true } }][k], getRunUsage: k > 3 ? { ret: { runsUsed: 10, limit: 10, remaining: 0 } } : undefined }; });
  add('feedback:grantRefusal', 6, (sc, k) => { R.feedback(sc, { message: 'gr', action: 'autopilot' }); sc.stores.proxyTokenStore = { mintGrantBootstrap: { throw: [{ kind: 'coded', code: 'GRANT_OWNER_MISMATCH', message: 'owner mismatch', status: 403, retryable: false }, { kind: 'coded', code: 'OWNER_CHECK_UNAVAILABLE', message: 'x', status: 503, retryable: true }, { kind: 'coded', code: 'GRANT_OWNERLESS', status: 503 }, ERR.boom, { kind: 'coded', code: 'WEIRD_CODE', status: 400 }, { kind: 'coded', code: 'GRANT_OWNER_MISMATCH', status: 403 }][k] } }; if (k === 5) sc.stores.workspacePreferencesStore = { getWorkspacePreferences: { ret: { dispatchDefaults: { harness: 'opencode' } } } }; });
  add('feedback:enqueueFail', 6, (sc, k) => { R.feedback(sc, { message: 'eq', action: k % 2 ? 'autopilot' : 'triage' }); if (k < 2) sc.stores.dispatchQueueStore = { addItem: { throw: ERR.boom } }; else if (k < 4) sc.stores.proxyTokenStore = { createToken: { throw: ERR.boom }, mintGrantBootstrap: { throw: ERR.boom } }; else sc.stores.workspacePreferencesStore = { getWorkspacePreferences: { throw: ERR.boom } }; });
  add('feedback:providersActions', 8, (sc, k) => { R.feedback(sc, { message: 'pa', action: k % 2 ? 'autopilot' : 'triage', priority: 2 }); }, null);
  add('feedback:noHost', 3, (sc) => { R.feedback(sc, { message: 'nh', action: 'autopilot' }); sc.headers = {}; });
  add('feedback:bodies', 6, (sc, k) => { R.feedback(sc); sc.body = [{ kind: 'raw', text: JSON.stringify({ message: 'plain text type' }), contentType: 'text/plain' }, { kind: 'raw', text: '{"message": ', contentType: 'text/plain' }, { kind: 'pad', value: { message: 'big json' }, padBytes: 300_000, contentType: 'application/json' }, { kind: 'pad', value: { message: 'big text' }, padBytes: 300_000, contentType: 'text/plain' }, { kind: 'raw', text: 'null', contentType: 'application/json' }, { kind: 'none' }][k]; });

  // --- issues create / patch -----------------------------------------------------------------
  add('create:cap', 6, (sc) => R.create(sc), null);
  add('create:validation', 10, (sc, k) => R.create(sc, [{ teamId: 'team-1' }, { title: '', teamId: 'team-1' }, { title: 5, teamId: 'team-1' }, { title: 'x' }, { title: 'x', teamId: 7 }, { title: 'bad\u0001', teamId: 'team-1' }, { title: 't'.repeat(300), teamId: 'team-1' }, { title: 'x', teamId: 'team-1', priority: 9 }, { title: 'x', teamId: 'team-1', description: 5 }, { title: 'x', teamId: 'team-1', priority: '2' }][k]));
  add('create:undeclared', 6, (sc, k) => R.create(sc, [{ title: 'x', stateId: 's' }, { title: 'x', priority: 1 }, { title: 'x', stateId: '' }, { title: 'x', priority: null }, { title: 'x', projectId: 'p' }, { title: 'x', description: 'd', teamId: 'ignored' }][k]), 'ghws');
  add('create:jiraUndeclared', 5, (sc, k) => R.create(sc, [{ title: 'x', stateId: 's' }, { title: 'x', priority: 1 }, { title: 'x' }, { title: 'x', description: 'd' }, { title: 'x', projectId: 'p' }][k]), 'jiraws');
  add('create:linearRefs', 8, (sc, k) => { R.create(sc, [{ title: 'a', teamId: UUID(600) }, { title: 'b', teamId: 'LIN' }, { title: 'c', teamId: 'Linear Team' }, { title: 'd', teamId: 'nosuch' }, { title: 'e', teamId: 'team-1', projectId: 'Project', stateId: 'Done', priority: 3, description: 'D' }, { title: 'f', teamId: 'team-1', projectId: 'nosuch' }, { title: 'g', teamId: 'team-1', stateId: 'nosuch' }, { title: 'h', teamId: 'linear:LIN', projectId: UUID(500), stateId: UUID(700), priority: 0 }][k]); if (k === 2) sc.prov.fetchTeams = { ret: [{ id: 'team-1', key: 'LIN', name: 'Linear Team' }, { id: 'team-2', key: 'LIN2', name: 'Linear Team' }] }; });
  add('create:local', 6, (sc, k) => { R.create(sc, [{ title: 'L' }, { title: 'L', stateId: 'Done' }, { title: 'L', projectId: 'Project', priority: 2 }, { title: 'L', stateId: 'nosuch' }, { title: 'L', teamId: 'ignored' }, { title: 'L', description: '' }][k]); if (k === 0) sc.prov.createIssue = { ret: { id: UUID(97), identifier: 'L-1' } }; if (k === 5) sc.prov.createIssue = { ret: null }; }, 'localws');
  add('create:writeFail', 6, (sc, k) => { R.create(sc); sc.prov.createIssue = [{ ret: { success: false } }, { ret: null }, { throw: ERR.boom }, { throw: { kind: 'refResolution', message: 'ambiguous team', status: 422, candidates: ['a', 'b'] } }, { throw: { kind: 'refResolution', message: 'no such', status: 404 } }, { ret: { success: true, issue: null } }][k]; });
  add('create:teamFetchFail', 5, (sc) => { R.create(sc, { title: 'x', teamId: 'LIN' }); sc.prov.fetchTeams = { throw: ERR.boom }; });
  add('create:body', 5, (sc, k) => { R.create(sc); sc.body = [{ kind: 'none' }, { kind: 'raw', text: '{', contentType: 'application/json' }, { kind: 'raw', text: '[]', contentType: 'application/json' }, { kind: 'form', pairs: [['title', 'f'], ['teamId', 'team-1']] }, { kind: 'raw', text: 'title=x', contentType: 'text/plain' }][k]; });
  add('patch:cap', 6, (sc) => R.patch(sc), null);
  add('patch:badId', 5, (sc) => R.patch(sc, { title: 'x' }, 'a_b'));
  add('patch:validation', 6, (sc, k) => R.patch(sc, [{ title: 5 }, { title: 't'.repeat(300) }, { priority: 9 }, { description: 7 }, { title: 'bad\u0001' }, { priority: '1' }][k]));
  add('patch:empty', 5, (sc, k) => R.patch(sc, [{}, { foo: 1 }, { title: '' }, { title: '', stateId: '' }, { priority: null }][k]));
  add('patch:noGuard', 5, (sc) => R.patch(sc), 'noguard');
  add('patch:trashed', 5, (sc) => { R.patch(sc); sc.prov.issueWriteGuard = { ret: { trashed: true } }; });
  add('patch:ok', 8, (sc, k) => { R.patch(sc, [{ title: 'T' }, { description: '' }, { stateId: 'Done' }, { state: 'In Progress' }, { status: 'st-done' }, { priority: 0 }, { stateId: UUID(701), title: 'x', description: 'd', priority: 4 }, { stateId: 'jira:Done' }][k]); if (k === 6) sc.variant = 'sparse'; sc.onTicketWrite = ['ok', 'ok', 'readBack', 'throw', 'ok', 'ok', 'ok', 'readBack'][k]; });
  add('patch:stateNoTeam', 5, (sc, k) => { R.patch(sc, { stateId: ['Done', UUID(1), 'Todo', 'x', 'Done'][k] }); sc.prov.issueWriteGuard = { ret: k === 4 ? null : { id: ISSUE_UUID } }; });
  add('patch:stateUnresolved', 5, (sc, k) => { R.patch(sc, { stateId: ['nosuch', 'Done', 'Do', 'done', 'IN PROGRESS'][k] }); if (k === 1) sc.prov.states = { ret: [{ id: 'a', name: 'Done', type: 'completed' }, { id: 'b', name: 'Done', type: 'completed' }] }; });
  add('patch:writeFail', 6, (sc, k) => { R.patch(sc); sc.prov.updateIssue = [{ ret: { success: false } }, { ret: null }, { throw: ERR.boom }, { throw: { kind: 'partialWrite', message: 'partial', applied: ['title'], failed: 'state', status: 502, causeMessage: 'jira 500' } }, { throw: { kind: 'partialWrite', message: 'p2', applied: [], failed: 'x' } }, { throw: { kind: 'refResolution', message: 'r', candidates: ['a'] } }][k]; });
  add('patch:guardFail', 5, (sc, k) => { R.patch(sc); sc.prov.issueWriteGuard = { throw: [ERR.boom, ERR.auth, ERR.nf, ERR.str, ERR.hangup][k] }; });
  add('patch:sources', 5, (sc, k) => { R.patch(sc, { stateId: 'Done' }, ISSUE_UUID, `?source=${['github', 'jira', 'linear', 'nope', ''][k]}`); }, 'mixed');
  add('patch:noCloser', 5, (sc) => { sc.variant = 'sparse'; R.patch(sc, { stateId: 'Done' }); });

  // --- models --------------------------------------------------------------------------------
  add('models:ok', 6, (sc, k) => { R.models(sc); sc.fetch.catalog = [{ status: 200, json: { data: [{ id: 'a/free', name: 'A', pricing: { prompt: '0', completion: '0' } }, { id: 'b', name: 'B', pricing: { prompt: '1', completion: '2' } }] } }, { status: 500, json: {} }, { throw: ERR.boom }, { status: 200, json: { data: [] } }, { status: 200, json: { nope: 1 } }, { status: 200, json: { data: [{ id: 'c:free' }] } }][k]; });
  add('models:mock', 5, (sc) => { testEnv(sc); R.models(sc); }, 'localws');

  // --- run evidence + close-out ------------------------------------------------------------------
  add('runEv:tooLong', 5, (sc) => R.runEv(sc, 'x'.repeat(101)));
  add('runEv:ok', 8, (sc, k) => { R.runEv(sc, ['LIN-7', 'LIN-8', 'x', 'LIN-7', 'LIN-7', 'LIN-7', 'LIN-7', 'LIN-7'][k]); sc.prov.fetchIssueComments = { ret: k < 4 ? prComments : [] }; sc.fetch.github = [ghMerged, { status: 200, json: { state: 'open', merged: false, head: { sha: 'h' } } }, { status: 404, json: {} }, { throw: ERR.boom }, ghMerged, ghMerged, ghMerged, ghMerged][k]; if (k >= 5) sc.variant = 'seams'; if (k === 6) sc.viewerIsOwner = false; if (k === 7) sc.seamPrStatus = { throw: ERR.boom }; }, null);
  add('runEv:sources', 5, (sc, k) => { R.runEv(sc); sc.path += `?source=${['github', 'linear', 'jira', 'nope', ''][k]}`; sc.prov.fetchIssueComments = { ret: prComments }; sc.fetch.github = ghMerged; }, 'mixed');
  add('runEv:500', 5, (sc, k) => { R.runEv(sc); sc.prov.fetchIssueComments = { throw: [ERR.boom, ERR.auth, ERR.nf, ERR.str, ERR.hangup][k] }; });
  add('check:tooLong', 5, (sc) => R.check(sc, 'x'.repeat(101)));
  add('check:noAccount', 5, (sc) => { delete sc.session.accountId; R.check(sc); });
  add('check:notPerson', 5, (sc, k) => { R.check(sc); sc.reqFlags = k % 2 ? { proxyTokenId: 'pt' } : { proxyUrlKey: 'acme' }; });
  add('check:normalRun', 5, (sc, k) => { R.check(sc); sc.prov.fetchIssueComments = { ret: prComments }; sc.fetch.github = ghMerged; sc.stores.dispatchQueueStore = { listItems: { ret: [] } }; if (k === 1) sc.session.features.dispatch = false; if (k === 2) sc.body = json({ source: 'github' }); if (k === 3) sc.path += '?source=github'; });
  add('check:mergedDone', 8, (sc, k) => {
    R.check(sc); sc.prov.fetchIssueComments = { ret: prComments }; sc.fetch.github = ghMerged; sc.stores.dispatchQueueStore = stopAtRows;
    if (k === 1) sc.stores.closeOutEventsStore = { findMergedByPr: { ret: { _id: 'ev-m', by: 'person', prUrl: PR, headSha: 'abc123', doneAt: '2026-09-30T00:00:00.000Z' } } };
    if (k === 2) sc.stores.closeOutEventsStore = { findAnyByPr: { ret: { _id: 'ev-p', by: 'press' } } };
    if (k === 3) sc.prov.updateIssue = { throw: ERR.boom };
    if (k === 4) sc.prov.states = { ret: [{ id: 'x', name: 'Done', type: 'started' }] };
    if (k === 5) sc.prov.fetchIssueContext = { ret: { issue: { id: ISSUE_UUID } } };
    if (k === 6) { sc.prov.fetchIssueContext = { ret: { issue: { id: ISSUE_UUID } } }; sc.prov.issueWriteGuard = { ret: { id: ISSUE_UUID } }; }
    if (k === 7) { sc.variant = 'sparse'; }
    sc.onTicketWrite = ['ok', 'ok', 'readBack', 'ok', 'throw', 'ok', 'ok', 'ok'][k];
  });
  add('check:mergedStore', 6, (sc, k) => { R.check(sc); sc.prov.fetchIssueComments = { ret: prComments }; sc.fetch.github = ghMerged; sc.stores.dispatchQueueStore = stopAtRows; sc.stores.closeOutEventsStore = [{ record: { ret: null } }, { stampDone: { ret: null } }, { stampDone: { throw: ERR.boom } }, { findMergedByPr: { throw: ERR.boom } }, { record: { ret: { _id: 'e', by: 'close-out', prUrl: PR, headSha: 'abc123' } } }, { findMergedByPr: { ret: { _id: 'ev-c', by: 'close-out', prUrl: PR, headSha: 'abc123', doneAt: null } } }][k]; });
  add('check:ledgerOpen', 5, (sc, k) => { R.check(sc); sc.prov.fetchIssueComments = { ret: [...prComments, { id: 'c9', body: ['## Review ledger\n- [ ] inside: fix tests\n- [x] outside: docs', 'Review: request changes', '## Review ledger\n- [ ] unknown thing', 'Verdict: approved', '## Review ledger\n- [x] inside: done'][k], createdAt: '2026-09-30T12:00:00.000Z', user: { name: 'H' } }] }; sc.fetch.github = ghMerged; sc.stores.dispatchQueueStore = stopAtRows; });
  add('check:twoPrs', 5, (sc, k) => { R.check(sc); sc.prov.fetchIssueComments = { ret: [...prComments, { id: 'c2', body: 'Also https://github.com/org/other/pull/3', createdAt: '2026-09-30T11:00:00.000Z' }] }; sc.fetch.github = [ghMerged, { status: 200, json: { state: 'open', merged: false, head: { sha: 'z' } } }, { status: 404, json: {} }, ghMerged, ghMerged][k]; sc.stores.dispatchQueueStore = stopAtRows; });
  add('check:seams', 8, (sc, k) => { sc.variant = 'seams'; R.check(sc); sc.prov.fetchIssueComments = { ret: prComments }; sc.seamStopAt = [{ ret: 'pr' }, { ret: null }, { ret: 'pr' }, { ret: 'pr' }, { ret: 'pr' }, { throw: ERR.boom }, { ret: 'pr' }, { ret: 'pr' }][k]; sc.seamPrStatus = [{ ret: { readable: true, state: 'merged', merged: true, head: { sha: 'abc' } } }, { ret: { readable: true, merged: true } }, { throw: ERR.boom }, { ret: { readable: true, state: 'merged', merged: true, ref: 'r' } }, { ret: { readable: false } }, { ret: { readable: true, merged: true } }, { ret: { readable: true, state: 'merged', merged: true, head: { sha: 'abc' } } }, { ret: { readable: true, state: 'merged', merged: true } }][k]; sc.seamMarkDone = k === 6 ? { throw: { kind: 'plain', message: 'no done' } } : k === 7 ? { throw: ERR.str } : undefined; sc.seamRunnerReady = k !== 4; });
  add('check:errors', 5, (sc, k) => { R.check(sc); sc.prov.fetchIssueComments = { throw: [ERR.boom, ERR.auth, ERR.nf, ERR.str, ERR.hangup][k] }; });
  add('check:prReadThrows', 5, (sc, k) => { R.check(sc); sc.prov.fetchIssueComments = { ret: prComments }; sc.fetch.github = [{ throw: ERR.boom }, { status: 403, json: { message: 'rate' } }, { status: 500, json: {} }, { status: 200, json: 'not an object' }, { status: 200, json: { merged: 'yes' } }][k]; sc.stores.dispatchQueueStore = stopAtRows; }, 'ghws');
  add('press:tooLong', 5, (sc) => R.press(sc, 'x'.repeat(101)));
  add('press:noAccount', 5, (sc) => { delete sc.session.accountId; R.press(sc); });
  add('press:notPerson', 5, (sc, k) => { R.press(sc); sc.reqFlags = k % 2 ? { proxyTokenId: 'pt' } : { proxyUrlKey: 'acme' }; });
  add('press:ok', 6, (sc, k) => { R.press(sc, 'LIN-7', [{ prUrl: PR, headSha: 'abc', dispatchId: 'd' }, { prUrl: PR }, { prUrl: PR, headSha: null }, {}, { prUrl: 7, headSha: 3, dispatchId: { a: 1 } }, { prUrl: PR, dispatchId: 'd2' }][k]); });
  add('press:alreadyMerged', 5, (sc) => { R.press(sc); sc.stores.closeOutEventsStore = { hasMergedEvent: { ret: true } }; });
  add('press:noStore', 5, (sc) => { sc.variant = 'sparse'; R.press(sc); });
  add('press:recordNull', 5, (sc) => { R.press(sc); sc.stores.closeOutEventsStore = { record: { ret: null } }; });
  add('press:storeErr', 5, (sc, k) => { R.press(sc); sc.stores.closeOutEventsStore = k % 2 ? { hasMergedEvent: { throw: ERR.boom } } : { record: { throw: ERR.str } }; });
  add('press:body', 5, (sc, k) => { R.press(sc); sc.body = [{ kind: 'none' }, { kind: 'raw', text: '{', contentType: 'application/json' }, { kind: 'raw', text: '[1]', contentType: 'application/json' }, { kind: 'raw', text: 'x', contentType: 'text/plain' }, { kind: 'raw', text: 'null', contentType: 'application/json' }][k]; });

  // --- extra reps so every observed (status, code, flushed) outcome is hit ≥5 times ---
  for (const [nm, fn] of [['recap', R.recapPost], ['brief', R.briefPost], ['scan', R.scanPost]]) {
    const feature = nm;
    add(`${nm}Post:flushed`, 30, (sc, k) => { fn(sc); const e = [ERR.or, ERR.boom, ERR.nf, ERR.auth, ERR.str][k % 5]; sc.ai.chat = { [feature]: k < 25 ? { throw: e, delayMs: 30_000 } : { text: nm === 'scan' ? 'garbage' : 'x', delayMs: 30_000 } }; });
    add(`${nm}Post:freeTier429`, 5, (sc) => { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'k' }; fn(sc); sc.stores.freeTierStore = { tryUse: { ret: { allowed: false, reason: 'limit', remaining: 0, limit: 2, resetsAt: 'r' } } }; });
  }
  add('rec:flushed', 20, (sc, k) => { R.rec(sc); sc.ai.rec = { '*': { throw: [ERR.or, ERR.nf, ERR.auth, ERR.boom][k % 4], delayMs: 30_000 } }; });
  add('rec:gone499', 5, (sc, k) => { R.rec(sc); sc.ai.rec = { '*': { hang: true } }; sc.clientAbortAfterMs = [1000, 3000, 9000, 15000, 19000][k]; });
  add('comment:500s', 10, (sc, k) => { R.comment(sc, { body: `e500 ${k}` }); sc.prov.createComment = { throw: k < 5 ? ERR.hangup : ERR.boom }; });
  add('create:502', 5, (sc, k) => { R.create(sc, { title: 'x', teamId: UUID(600) }); sc.prov.createIssue = { ret: k % 2 ? { success: false } : null }; });
  add('image:upstreamStatus5', 30, (sc, k) => { R.image(sc); sc.fetch.image = { status: [404, 401, 403, 500, 502, 418][k % 6], bytes: 'empty' }; });
  add('recStatus:prefsThrow', 5, (sc) => { R.recStatus(sc); sc.stores.workspacePreferencesStore = { getWorkspacePreferences: { throw: ERR.boom } }; });
  add('retire:extra', 25, (sc, k) => {
    const v = Math.floor(k / 5);
    R.retire(sc);
    if (v === 0) { sc.env = { NODE_ENV: 'production', OPENROUTER_FREE_TIER_KEY: 'k' }; sc.stores.freeTierStore = { tryUse: { ret: { allowed: false, reason: 'limit', remaining: 0, limit: 2, resetsAt: 'r' } } }; }
    if (v === 1) sc.ai.chat = { 'scan-retire': { text: 'garbage' } };
    if (v === 2) { sc.ai.chat = { 'scan-retire': { text: '{"has_decision":false}', delayMs: 30_000 } }; sc.stores.taskDecisionsStore = { markOutcome: { ret: null } }; }
    if (v === 3) sc.stores.taskDecisionsStore = { markOutcome: { ret: [null, { id: 'r', outcome: 'answered' }][k % 2] } };
    if (v === 4) sc.ai.chat = { 'scan-retire': { text: 'garbage', delayMs: 30_000 } };
  });
  add('retire:rowGone', 5, (sc) => { R.retire(sc); sc.stores.taskDecisionsStore = { markOutcome: { ret: null } }; });
  add('comment:adoptThrows', 5, (sc, k) => { R.comment(sc, { body: `adopt-throw ${k}` }); sc.prov.createComment = auth401; sc.adoptConnection = 'throw'; }, 'conn');
  add('patch:goneThen404', 5, (sc) => { R.patch(sc); sc.prov.issueWriteGuard = { throw: ERR.nf, delayMs: 10 }; sc.clientAbortAfterMs = 1; });
  add('retire:terminal', 5, (sc) => { R.retire(sc); sc.stores.taskDecisionsStore = { markOutcome: { ret: { id: 'r', outcome: 'answered' } } }; });
  add('patch:extra', 15, (sc, k) => { R.patch(sc); sc.prov.updateIssue = [{ ret: { success: false } }, { throw: { kind: 'partialWrite', message: 'partial', applied: ['title'], failed: 'state', status: 502, causeMessage: 'c' } }, { throw: { kind: 'partialWrite', message: 'p2', applied: [], failed: 'x' } }][Math.floor(k / 5)]; });
  add('feedback:413', 5, (sc, k) => { R.feedback(sc); sc.body = k < 3 ? { kind: 'raw', text: JSON.stringify({ message: 'big', image: 'data:image/png;base64,' + 'A'.repeat(13_000_000 + k) }), contentType: 'text/plain' } : { kind: 'pad', value: { message: 'big' }, padBytes: 13_000_000, contentType: 'text/plain' }; });
  for (const exp of ['generateMockRecommendation', 'buildMockRecommendationHop']) {
    add(`call:${exp}`, 30, (sc, k) => {
      sc.kind = 'call'; sc.export = exp; sc.method = 'CALL'; sc.path = exp; sc.env = { NODE_ENV: 'test' };
      const issues = [{ identifier: 'LIN-1', labels: ['bug'], state: { name: 'Todo', type: 'unstarted' } }, { url: 'https://linear.app/x/issue/TEST-9', labels: { nodes: [{ name: 'bug' }] } }, { labels: [], blockedBy: [{ state: { type: 'started' } }] }, { identifier: 'X', labels: ['x'], state: { type: 'backlog', name: 'Backlog' } }, { labels: { nodes: [] } }, K.mockIssue];
      sc.args = exp === 'generateMockRecommendation' ? [issues[k % issues.length]] : [ctx(k % 2 ? ISSUE_UUID : UUID(9), k % 3 ? { focusedChild: { issue: { identifier: 'LIN-21', state: { type: 'started' } } }, children: [{ identifier: 'LIN-21' }] } : {})];
    });
  }
  return T;
}

const PROVIDER_WS = ['acme', 'localws', 'jiraws', 'jiraamb', 'ghws', 'ghp', 'mixed', 'conn', 'legacy', 'notoken', 'bare', 'noguard'];

export function edgeScenarios(seed, K) {
  counter = 0;
  const out = [];
  for (const c of cases(K)) {
    for (let k = 0; k < c.reps; k++) {
      // `ws: null` cycles the workspace over every provider shape
      const ws = c.ws === null ? PROVIDER_WS[(k + c.intent.length) % PROVIDER_WS.length] : (c.ws || 'acme');
      const sc = clean(ws);
      sc.intent = c.intent;
      sc.form = 'edge';
      c.build(sc, k);
      // seeded variation that never changes the intent: request-start stamp and account shape
      const g = new G((seed * 131 + sc.index) >>> 0);
      if (g.chance(0.15) && !sc.headers['x-request-start']) sc.headers['x-request-start'] = String(sc.clockBase - g.int(0, 20_000));
      out.push(finalize(sc));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test tier: every request the unit tests send to this router (captured by
// capture-tests.mjs into pinned/test-calls.json), replayed into a clean world.
// ---------------------------------------------------------------------------
export function testScenarios(seed, K, file) {
  if (!existsSync(file)) return [];
  const { calls } = JSON.parse(readFileSync(file, 'utf8'));
  const out = [];
  let i = 0;
  for (const c of calls) {
    const u = new URL(c.url, 'http://x');
    const m = /^\/workspace\/([^/]+)\//.exec(u.pathname);
    const testKey = m ? m[1] : 'acme';
    // map the test's workspace onto a fixture of the same provider kind
    const ws = c.provider === 'local' ? 'localws' : c.testToken ? 'testws' : c.provider === 'jira' ? 'jiraws' : c.provider === 'github' ? 'ghws' : 'acme';
    const sc = clean(ws);
    sc.id = `test:${i}`; sc.tier = 'test'; sc.index = i; sc.clockBase = FIXED_NOW + 6e9 + i * STEP_MS; sc.randomSeed = (seed * 7 + i * 7919) >>> 0;
    i++;
    sc.intent = c.file.replace(/^tests\/unit\//, '');
    sc.method = c.method;
    sc.path = `/workspace/${ws}/${u.pathname.split('/').slice(3).join('/')}${u.search}`.replace(`/workspace/${ws}/api/`, `/workspace/${ws}/api/`);
    if (!m) sc.path = c.url;
    sc.env = { NODE_ENV: 'test', OPENROUTER_API_KEY: 'sk-paid-env' };
    if (c.body !== undefined) sc.body = { kind: 'json', value: c.body };
    sc.testKey = testKey;
    out.push(finalize(sc));
  }
  return out;
}
