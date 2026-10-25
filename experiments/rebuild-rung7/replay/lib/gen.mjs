// Seeded scenario generator for routes/workspace-api.js. A scenario is pure
// data: one HTTP request plus the whole fake world it meets (session, env,
// clock, app variant, provider/store/seam/fetch behaviour, owner verdicts,
// client hang-ups). `generateScenario(seed, i, K, form)` is a pure function of
// its arguments: both sides and every re-run see byte-identical inputs.
import { G, FIXED_NOW } from '../../../replay-kit/lib/router/common.mjs';

const STEP_MS = 90_000;
const UUID = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
export const ISSUE_UUID = UUID(7);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
export const WORKSPACES = {
  acme: { id: 'ws-acme', urlKey: 'acme', name: 'Acme', provider: 'linear', accessToken: 'lin_tok_acme' },
  testws: { id: 'ws-test', urlKey: 'testws', name: 'Test', provider: 'linear', accessToken: 'test-token' },
  localws: { id: 'ws-local', urlKey: 'localws', name: 'Local', provider: 'local', accessToken: 'local-token' },
  jiraws: { id: 'ws-jira', urlKey: 'jiraws', name: 'Jira', provider: 'jira', accessToken: 'jt1', bindings: [{ provider: 'jira', scope: 'a.atlassian.net', credentials: { token: 'jt1', email: 'a@x.io' } }] },
  jiraamb: { id: 'ws-jamb', urlKey: 'jiraamb', name: 'JiraAmb', provider: 'jira', accessToken: 'jt0', bindings: [{ provider: 'jira', scope: 'a.atlassian.net', credentials: { token: 'jt1', email: 'a@x.io' } }, { provider: 'jira', scope: 'b.atlassian.net', credentials: { token: 'jt2', email: 'b@x.io' } }] },
  ghws: { id: 'ws-gh', urlKey: 'ghws', name: 'GH', provider: 'github', accessToken: 'gh_tok', bindings: [{ provider: 'github', scope: 'org/repo', credentials: { token: 'gh_tok' } }] },
  ghp: { id: 'ws-ghp', urlKey: 'ghp', name: 'GHP', provider: 'github-projects', accessToken: 'ghp_tok', bindings: [{ provider: 'github-projects', scope: 'org/1', credentials: { token: 'ghp_tok' } }] },
  mixed: { id: 'ws-mixed', urlKey: 'mixed', name: 'Mixed', provider: 'linear', accessToken: 'lin_tok_mixed', bindings: [{ provider: 'linear', scope: 'ws-mixed', credentials: { token: 'lin_tok_mixed' } }, { provider: 'github', scope: 'org/other', credentials: { token: 'gh_tok2' } }, { provider: 'jira', scope: 'm.atlassian.net', credentials: { token: 'jtm', email: 'm@x.io' } }] },
  conn: { id: 'ws-conn', urlKey: 'conn', name: 'Conn', provider: 'linear', activeBinding: { provider: 'linear', scope: 'ws-conn' }, bindings: [{ provider: 'linear', scope: 'ws-conn', connectionId: 'conn-1' }] },
  legacy: { id: 'ws-legacy', urlKey: 'legacy', name: 'Legacy', accessToken: 'lin_legacy' },
  notoken: { id: 'ws-nt', urlKey: 'notoken', name: 'NoTok', provider: 'linear' },
  // synthetic providers (fakes.mjs): capability-less / guard-less
  bare: { id: 'ws-bare', urlKey: 'bare', name: 'Bare', provider: 'stub-bare', accessToken: 'bare-tok' },
  noguard: { id: 'ws-ng', urlKey: 'noguard', name: 'NoGuard', provider: 'stub-noguard', accessToken: 'ng-tok' },
};
const WS_KEYS = Object.keys(WORKSPACES);
const ACCOUNTS = ['acct-owner', 'acct-member'];
export const GOOD_IDS = [ISSUE_UUID, 'LIN-7', 'lin-42', '#LIN-7', 'ENG-3', UUID(8)];
export const BAD_IDS = ['bad%20id', 'x'.repeat(101), 'a_b', '%E2%9C%93', 'LIN-7%2F1'];
const SOURCES = [undefined, undefined, undefined, 'linear', 'github', 'jira', 'local', 'nope', ''];

function iso(ms) { return new Date(ms).toISOString(); }
function q(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) s.append(k, v);
  const t = s.toString();
  return t ? `?${t}` : '';
}

// ---------------------------------------------------------------------------
// Common world
// ---------------------------------------------------------------------------
function env(g) {
  return {
    NODE_ENV: g.chance(0.7) ? 'test' : 'production',
    OPENROUTER_API_KEY: g.weighted([[undefined, 5], ['', 1], ['sk-paid-env', 3], ['  ', 1]]),
    OPENROUTER_FREE_TIER_KEY: g.weighted([[undefined, 5], ['sk-free', 3]]),
    FEEDBACK_TEAM_ID: g.weighted([[undefined, 8], ['team-env', 1]]),
    FEEDBACK_PROJECT_ID: g.weighted([[undefined, 8], ['proj-env', 1]]),
  };
}

function session(g, { wsKey }) {
  const shape = g.weighted([['normal', 92], ['noWorkspaces', 3], ['empty', 2], ['noAccount', 3]]);
  if (shape === 'empty') return {};
  const keys = g.chance(0.85) ? WS_KEYS.slice() : WS_KEYS.filter(() => g.chance(0.5));
  if (!keys.includes(wsKey)) keys.push(wsKey);
  const s = { workspaces: shape === 'noWorkspaces' ? [] : keys.map(k => JSON.parse(JSON.stringify(WORKSPACES[k]))) };
  if (shape !== 'noAccount') s.accountId = g.weighted([['acct-owner', 8], ['acct-member', 2]]);
  if (g.chance(0.25)) s.openRouterApiKey = 'sk-or-session';
  if (g.chance(0.25)) s.freeTierEnabled = true;
  if (g.chance(0.8)) s.features = { proxy: g.chance(0.85), dispatch: g.chance(0.6), feedbackTriage: g.chance(0.4), roadmap: g.chance(0.7), ...(g.chance(0.1) ? { bogusFlag: true } : {}) };
  return s;
}

function wsKeyFor(g, prefer = null) {
  return prefer && g.chance(0.6) ? g.pick(prefer) : g.weighted([['acme', 30], ['testws', 14], ['localws', 14], ['jiraws', 6], ['jiraamb', 3], ['ghws', 6], ['ghp', 4], ['mixed', 8], ['conn', 3], ['legacy', 5], ['notoken', 3], ['bare', 3], ['noguard', 3]]);
}

function urlKeyFor(g, wsKey) {
  return g.weighted([[wsKey, 92], ['ghost', 3], ['bad.key', 2], ['ACME', 1], ['a'.repeat(51), 1]]);
}

function ownerCheck(g) {
  return g.weighted([
    [{ ret: { status: 'owner' } }, 75], [{ ret: { status: 'not-owner' } }, 9], [{ ret: { status: 'no-owner' } }, 5],
    [{ ret: { status: 'weird' } }, 2], [{ ret: null }, 2], [{ throw: { kind: 'plain', message: 'owner seam down' } }, 4],
  ]);
}

function upstreamErr(g) {
  return g.weighted([
    [{ kind: 'gql', status: 401, message: 'Authentication required' }, 3],
    [{ kind: 'plain', message: 'Issue not found: LIN-7' }, 3],
    [{ kind: 'plain', message: 'Entity not found' }, 1],
    [{ kind: 'plain', message: 'socket hang up' }, 2],
    [{ kind: 'gql', status: 500, message: 'Internal' }, 1],
    [{ kind: 'statusOnly', status: 403, message: 'forbidden' }, 1],
    [{ kind: 'timeout' }, 1],
    [{ kind: 'string', value: 'raw string thrown' }, 1],
  ]);
}

function storeErr(g, msg = 'store down') {
  return g.weighted([[{ kind: 'plain', message: msg }, 4], [{ kind: 'string', value: 'raw thrown' }, 1]]);
}

/** A recommendation context, canonical or not, optionally with children/focusedChild. */
function recCtx(g, id, { children = null, canonical = true, comments = null } = {}) {
  const ident = /^[A-Za-z]+-\d+$/.test(String(id).replace(/^#/, '')) ? String(id).replace(/^#/, '').toUpperCase() : 'LIN-7';
  const issue = {
    id: canonical ? (/^[0-9a-f-]{36}$/i.test(id) ? id : ISSUE_UUID) : g.pick([undefined, 'not-a-uuid']),
    identifier: ident, title: g.pick(['Fix login', 'Ship the parser', 'Research caching']),
    description: g.pick(['', 'Plain description', 'We are waiting on a decision about the API', 'blocked by infra\nsecond line']),
    state: g.pick([{ name: 'In Progress', type: 'started' }, { name: 'Todo', type: 'unstarted' }, { name: 'Backlog', type: 'backlog' }, { name: 'Done', type: 'completed' }]),
    labels: g.pick([[], ['bug'], ['feature', 'ready']]), url: `https://linear.app/acme/issue/${ident}`, team: { id: 'team-1' },
  };
  const kids = children ?? (g.chance(0.25) ? Array.from({ length: g.int(1, 3) }, (_, k) => ({ id: UUID(20 + k), identifier: `LIN-${20 + k}`, title: `Child ${k}`, state: g.pick([{ type: 'started', name: 'In Progress' }, { type: 'completed', name: 'Done' }, { type: 'unstarted', name: 'Todo' }]) })) : []);
  const focus = kids.find(k => k.state.type !== 'completed');
  return {
    issue, parent: g.chance(0.3) ? { id: UUID(3), identifier: 'LIN-3', title: 'Parent', state: { type: 'started' } } : null,
    siblings: [], project: { id: 'proj-1', name: 'Project' }, children: kids,
    comments: comments ?? (g.chance(0.6) ? [{ id: 'c1', body: g.pick(['Looks fine', 'should we decide on X?']), createdAt: '2026-09-30T10:00:00.000Z', user: { name: 'Ann' } }] : []),
    attachments: g.chance(0.2) ? [{ id: 'a1', title: 'shot.png', url: 'https://uploads.linear.app/x.png' }] : [],
    focusedChild: focus && g.chance(0.7) ? { issue: { ...focus, url: `https://linear.app/acme/issue/${focus.identifier}` } } : null,
  };
}

function aiChat(g, feature, opts = {}) {
  const texts = {
    recap: [JSON.stringify({ done: [{ item: 'Did X', evidence: 'pr' }], pending: [], deviations: [{ item: 'skipped', type: 'scope', evidence: 'c' }] }), 'not json at all', '```json\n{"done":[]}\n```'],
    brief: ['## Current\nBrief body', '', '```markdown\n## Current\nx\n```'],
    scan: [JSON.stringify({ has_decision: false }), JSON.stringify({ has_decision: true, question: 'Which DB?', options: [{ id: 'pg', label: 'Postgres' }, { id: 'my', label: 'MySQL' }], recommended: 'pg', free_text: false }), JSON.stringify({ has_decision: true, question: '' }), 'garbage', JSON.stringify({ has_decision: true, question: 'Free?', free_text: true })],
    'scan-retire': [JSON.stringify({ has_decision: false }), JSON.stringify({ has_decision: true, question: 'Q', options: [{ id: 'a', label: 'A' }] }), 'garbage', JSON.stringify({ nothing: 1 })],
    'feedback-title': ['A crisp title', '', '"Quoted title"', 'x'.repeat(200)],
  }[feature] || ['ok'];
  return g.weighted([
    [{ text: g.pick(texts) }, 80],
    [{ throw: { kind: 'plain', message: 'OpenRouter API error: 502 Bad Gateway' } }, 6],
    [{ throw: { kind: 'plain', message: 'OpenRouter API key is not configured.' } }, 3],
    [{ throw: { kind: 'plain', message: 'model exploded' } }, 3],
    [{ text: g.pick(texts), delayMs: 30_000 }, opts.slow ?? 3],
  ]);
}

function baseScenario(seed, tier, index, form) {
  return { id: `${tier}:${index}`, tier, index, form, seed, randomSeed: (seed * 7919 + index * 104729 + (tier === 'edge' ? 17 : tier === 'test' ? 31 : 0)) >>> 0, clockBase: FIXED_NOW + index * STEP_MS + (tier === 'edge' ? 3e9 : tier === 'test' ? 6e9 : 0) };
}

function commonWorld(g, sc, { prefer = null, forceKey = null } = {}) {
  const wsKey = forceKey || wsKeyFor(g, prefer);
  sc.wsKey = wsKey;
  sc.env = env(g);
  sc.session = session(g, { wsKey });
  sc.urlKey = urlKeyFor(g, wsKey);
  sc.variant = g.weighted([['full', 75], ['sparse', 15], ['seams', 10]]);
  sc.ownerCheck = ownerCheck(g);
  sc.headers = { host: g.weighted([['harbour.example', 8], ['localhost:3000', 1], ['127.0.0.1:8080', 1]]), ...(g.chance(0.1) ? { 'x-request-start': String(sc.clockBase - g.int(0, 30_000)) } : {}) };
  sc.prov = {};
  sc.stores = {};
  sc.ai = {};
  sc.fetch = {};
  if (g.chance(0.04)) sc.clientAbortAfterMs = g.pick([1, 26_000]);
}

function idFor(g, K, sc = null) {
  if (sc?.wsKey === 'testws' && g.chance(0.75)) return g.pick(K.mockIds);
  return g.weighted([[g.pick(GOOD_IDS), 70], [g.pick(K.mockIds), 18], [g.pick(BAD_IDS), 12]]);
}

function provFail(g, sc, method, p = 0.15) {
  if (g.chance(p)) sc.prov[method] = { throw: upstreamErr(g) };
}

// ---------------------------------------------------------------------------
// Forms (route × shape). Each sets method/path/body and its world.
// ---------------------------------------------------------------------------
const P = (sc, rest) => `/workspace/${sc.urlKey}/api${rest}`;

export const FORMS = {
  audit: { w: 3, make(g, sc) {
    commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws', 'jiraws', 'legacy'] });
    sc.method = 'GET'; sc.path = P(sc, '/audit');
    sc.ai.runAudit = g.weighted([[{ ret: { summary: { teams: 2 }, findings: ['f1'] } }, 6], [{ throw: { kind: 'gql', status: 401 } }, 2], [{ throw: { kind: 'plain', message: 'GraphQL boom' } }, 2]]);
  } },
  prompt: { w: 6, make(g, sc, K) {
    commonWorld(g, sc);
    const label = g.weighted([[g.pick(K.TEMPLATE_KEYS), 70], ['custom:cp-1', 10], ['custom:missing', 5], ['nolabel', 8], ['Bug', 3], ['custom:', 2]]);
    const id = idFor(g, K, sc);
    sc.method = 'GET'; sc.path = P(sc, `/prompt/${id}/${encodeURIComponent(label)}${q({ source: g.pick(SOURCES), format: g.weighted([[undefined, 7], ['md', 3], ['json', 1]]) })}`);
    sc.prov.fetchIssueContext = { ret: recCtx(g, id) };
    provFail(g, sc, 'fetchIssueContext');
    if (g.chance(0.08)) sc.stores.customPromptsStore = { get: { throw: storeErr(g) } };
  } },
  autopilotIssue: { w: 5, make(g, sc, K) {
    commonWorld(g, sc);
    const id = idFor(g, K, sc);
    sc.method = 'GET';
    sc.path = P(sc, `/autopilot-prompt/${id}${q({ mode: g.pick([undefined, 'readonly', 'write', 'bogus']), variant: g.pick([undefined, 'stepper', 'standard', 'x']), stopAt: g.pick([undefined, undefined, 'pr', ' pr ', '', '  ', 'merge']), source: g.pick(SOURCES), format: g.pick([undefined, undefined, 'md']) })}`);
    sc.prov.fetchIssueContext = { ret: recCtx(g, id) };
    provFail(g, sc, 'fetchIssueContext');
  } },
  autopilotGeneral: { w: 4, make(g, sc) {
    commonWorld(g, sc);
    sc.method = 'GET';
    sc.path = P(sc, `/autopilot-prompt${q({ goal: g.pick([undefined, '', 'Ship the release', '   ', 'g'.repeat(1100), 'focus — ünïcode ✓']), mode: g.pick([undefined, 'readonly', 'nope']), variant: g.pick([undefined, 'stepper']), maxTasks: g.pick([undefined, undefined, '3', ' 5 ', '0', '-1', '2.5', 'abc', '', '  ']), format: g.pick([undefined, 'md']) })}`);
  } },
  recommendStatus: { w: 3, make(g, sc) {
    commonWorld(g, sc);
    sc.method = 'GET'; sc.path = P(sc, '/recommend/status');
    if (g.chance(0.4)) sc.stores.workspacePreferencesStore = { getWorkspacePreferences: g.weighted([[{ ret: { model: 'anthropic/claude-x' } }, 3], [{ ret: { aiModelOverrides: { byKind: { recommend: { model: 'openai/gpt-5.4' } } } } }, 2], [{ throw: storeErr(g) }, 1]]) };
  } },
  recommend: { w: 7, make(g, sc, K) {
    commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws', 'ghp', 'mixed'] });
    const id = idFor(g, K, sc);
    sc.method = 'GET'; sc.path = P(sc, `/recommend/${id}${q({ source: g.pick(SOURCES) })}`);
    recommendWorld(g, sc, id);
  } },
  recommendStream: { w: 7, make(g, sc, K) {
    commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws', 'ghp', 'mixed'] });
    const id = idFor(g, K, sc);
    sc.method = 'GET'; sc.path = P(sc, `/recommend/${id}/stream${q({ source: g.pick(SOURCES) })}`);
    recommendWorld(g, sc, id);
  } },
  commentsGet: { w: 3, make(g, sc, K) {
    commonWorld(g, sc);
    const id = idFor(g, K, sc);
    sc.method = 'GET'; sc.path = P(sc, `/comments/${id}${q({ source: g.pick(SOURCES) })}`);
    provFail(g, sc, 'fetchIssueComments', 0.25);
  } },
  commentsPost: { w: 9, make(g, sc, K) {
    commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws', 'conn', 'mixed', 'ghp', 'jiraws'] });
    const id = idFor(g, K, sc);
    sc.method = 'POST'; sc.path = P(sc, `/comments/${id}${q({ source: g.pick([undefined, undefined, undefined, 'linear', 'github']) })}`);
    const text = g.weighted([[g.pick(['Agree', 'Ruling: go with option A', 'Line1\nLine2', 'dup text']), 70], ['', 4], ['   ', 3], [7, 3], [null, 2], ['bad\u0001char', 3], ['c'.repeat(50_001), 2]]);
    const body = { body: text };
    if (g.chance(0.45)) { body.decisionLoopId = g.weighted([['loop-1', 7], ['', 1], [5, 1]]); body.decisionId = g.weighted([['dec-1', 8], [undefined, 2]]); body.optionId = g.pick([undefined, 'opt-a']); }
    if (g.chance(0.35)) { body.taskDecisionId = g.weighted([['td-1', 8], ['', 1]]); body.taskDecisionIssueId = g.weighted([[ISSUE_UUID, 8], [undefined, 2]]); }
    sc.body = g.chance(0.05) ? { kind: 'raw', text: '{"body": "x', contentType: 'application/json' } : g.chance(0.03) ? { kind: 'none' } : { kind: 'json', value: body };
    sc.prov.issueWriteGuard = g.weighted([[{ ret: { id: ISSUE_UUID, team: { id: 'team-1' }, trashed: false } }, 8], [{ ret: { id: ISSUE_UUID, trashed: true } }, 1], [{ ret: { id: ISSUE_UUID, archivedAt: '2026-01-01T00:00:00Z', trashed: true } }, 1], [{ throw: upstreamErr(g) }, 1]]);
    sc.prov.createComment = g.weighted([
      [{ ret: { success: true, comment: { id: `cm-${g.int(1, 3)}`, body: 'x', createdAt: '2026-10-01T12:00:00.000Z' } } }, 10],
      [{ ret: { id: 'cm-bare', body: 'x' } }, 2], [{ ret: { success: false } }, 1], [{ ret: null }, 1],
      [{ throw: { kind: 'gql', status: 401, message: 'Authentication required', errors: [{ extensions: { code: 'AUTHENTICATION_ERROR' } }] } }, 3],
      [{ seq: [{ throw: { kind: 'gql', status: 401, message: 'Authentication required' } }, { ret: { success: true, comment: { id: 'cm-retry', body: 'x' } } }] }, 3],
      [{ throw: upstreamErr(g) }, 2],
    ]);
    sc.stores.ownerCredentialStore = { get: g.weighted([[{ ret: null }, 2], [{ ret: { token: 'lin_durable_new', tokenExpiresAt: 1_900_000_000_000, provider: 'linear' } }, 3], [{ ret: { token: 'lin_tok_acme' } }, 1], [{ throw: storeErr(g) }, 1]]) };
    sc.adoptConnection = g.pick(['none', 'adopt', 'adopt', 'throw']);
    sc.sessionSave = g.chance(0.15) ? 'fail' : 'ok';
    if (g.chance(0.2)) sc.stores.dispatchQueueStore = { markDecisionAnswered: g.weighted([[{ ret: null }, 1], [{ throw: storeErr(g) }, 1]]) };
    if (g.chance(0.2)) sc.stores.taskDecisionsStore = { answer: g.weighted([[{ ret: { record: null, firstStampWins: false } }, 1], [{ ret: { record: { outcome: 'pending' }, firstStampWins: false } }, 1], [{ throw: storeErr(g) }, 1]]) };
    if (g.chance(0.15)) sc.stores.harbourCommentsStore = { record: { throw: storeErr(g) } };
  } },
  detail: { w: 4, make(g, sc, K) {
    commonWorld(g, sc);
    const id = idFor(g, K, sc);
    sc.method = 'GET'; sc.path = P(sc, `/detail/${id}${q({ source: g.pick(SOURCES), section: g.pick([undefined, 'project', 'in-progress', 'recent-activity', 'bogus']) })}`);
    provFail(g, sc, 'fetchIssueFields', 0.2);
    if (g.chance(0.15)) sc.stores.customPromptsStore = { list: { throw: storeErr(g) } };
  } },
  sessions: { w: 3, make(g, sc) {
    commonWorld(g, sc);
    sc.method = 'GET'; sc.path = P(sc, `/sessions/${g.weighted([['LIN-7', 6], ['x'.repeat(101), 1], ['%20', 1]])}`);
    if (g.chance(0.5)) sc.stores.dispatchQueueStore = { listItems: g.weighted([[{ ret: [{ _id: 'd1', id: 'd1', issueIdentifier: 'LIN-7', kind: 'implementation', status: 'taken', dispatchedAt: { __date: '2026-09-30T10:00:00.000Z' }, sessionId: 's1', target: 'cli' }] }, 3], [{ throw: storeErr(g) }, 1]]) };
  } },
  recapGet: { w: 3, make(g, sc, K) { cacheGet(g, sc, K, 'recap'); } },
  recapPost: { w: 5, make(g, sc, K) { cachePost(g, sc, K, 'recap'); } },
  context: { w: 3, make(g, sc, K) {
    commonWorld(g, sc);
    const id = g.weighted([[ISSUE_UUID, 3], ['lin-7', 2], ['LIN-404', 1], [g.pick(K.mockIds), 2], [g.pick(BAD_IDS), 1]]);
    sc.method = 'GET'; sc.path = P(sc, `/context/${id}${q({ source: g.pick(SOURCES) })}`);
    sc.prov.fetchProjects = g.weighted([[{ ret: { projects: [], issues: [{ id: ISSUE_UUID, identifier: 'LIN-7', title: 'A', state: { type: 'started' }, parent: null, children: [], relations: [] }, { id: UUID(8), identifier: 'LIN-8', title: 'B', state: { type: 'unstarted' }, blockedBy: [{ id: ISSUE_UUID }] }] } }, 6], [{ ret: { issues: null } }, 1], [{ throw: upstreamErr(g) }, 2]]);
  } },
  briefGet: { w: 3, make(g, sc, K) { cacheGet(g, sc, K, 'brief'); } },
  briefPost: { w: 5, make(g, sc, K) { cachePost(g, sc, K, 'brief'); } },
  scanGet: { w: 4, make(g, sc, K) {
    commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws', 'ghp'] });
    const id = idFor(g, K, sc);
    sc.method = 'GET'; sc.path = P(sc, `/scan/${id}${q({ source: g.pick(SOURCES) })}`);
    sc.prov.fetchRecommendationContext = g.chance(0.85) ? { ret: recCtx(g, id, { canonical: g.chance(0.85) }) } : { throw: upstreamErr(g) };
    sc.stores.taskDecisionsStore = { getStatus: g.weighted([[{ ret: null }, 3], [{ ret: { id: 'row-1', issueId: ISSUE_UUID, inputHash: 'stale', decision: { q: 1 }, scannedAt: '2026-09-29T00:00:00.000Z', outcome: null, outcomeAt: null, basisHash: 'b', basisVersion: 1 } }, 3], [{ ret: { id: 'row-2', issueId: ISSUE_UUID, inputHash: { __fromState: 'ctxHash' }, decision: null, scannedAt: '2026-09-29T00:00:00.000Z', outcome: 'dismissed', outcomeAt: '2026-09-30T00:00:00.000Z', outcomeReason: 'r' } }, 2], [{ throw: storeErr(g) }, 1]]) };
  } },
  scanPost: { w: 7, make(g, sc, K) {
    commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws', 'ghp'] });
    const id = idFor(g, K, sc);
    sc.method = 'POST'; sc.path = P(sc, `/scan/${id}${q({ source: g.pick([undefined, undefined, 'linear', ' github ', '  ']) })}`);
    sc.prov.fetchRecommendationContext = g.chance(0.85) ? { ret: recCtx(g, id, { canonical: g.chance(0.85) }) } : { throw: upstreamErr(g) };
    sc.ai.chat = { scan: aiChat(g, 'scan') };
    if (g.chance(0.15)) sc.ai.principleZero = null;
    opModelOverrides(g, sc);
    freeTier(g, sc);
    if (g.chance(0.1)) sc.stores.taskDecisionsStore = { recordScan: g.weighted([[{ ret: null }, 1], [{ throw: storeErr(g) }, 1]]) };
    if (g.chance(0.15)) sc.stores.harbourCommentsStore = { wereRecordedByHarbour: g.weighted([[{ ret: { __setOf: ['c1'] } }, 1], [{ throw: storeErr(g) }, 1]]) };
  } },
  scanDismiss: { w: 4, make(g, sc, K) { scanOutcome(g, sc, K, 'dismiss'); } },
  scanRetire: { w: 6, make(g, sc, K) { scanOutcome(g, sc, K, 'retire'); } },
  scanUnretire: { w: 4, make(g, sc, K) { scanOutcome(g, sc, K, 'unretire'); } },
  scanDue: { w: 5, make(g, sc) {
    commonWorld(g, sc, { prefer: ['acme', 'localws', 'ghp', 'mixed'] });
    const good = Buffer.from(JSON.stringify({ scannedAt: '2026-09-01T00:00:00.000Z', issueId: ISSUE_UUID })).toString('base64url');
    const cursor = g.weighted([[undefined, 5], [good, 3], ['%%%', 1], [Buffer.from('null').toString('base64url'), 1], [Buffer.from(JSON.stringify({ scannedAt: 5 })).toString('base64url'), 1], ['bm90IGpzb24', 1]]);
    sc.method = 'GET';
    sc.path = P(sc, `/scan-due${cursor === undefined ? '' : g.chance(0.05) ? `?cursor=${cursor}&cursor=${cursor}` : `?cursor=${cursor}`}`);
    const n = g.int(0, 4);
    const items = Array.from({ length: n }, (_, k) => ({ issueId: UUID(30 + k), issueIdentifier: `LIN-${30 + k}`, dueBasisHash: g.pick(['h1', null, 'h2']), dueBasisVersion: g.pick([1, 2, undefined]), ...(g.chance(0.3) ? { issueSource: g.pick(['linear', 'github']) } : {}) }));
    sc.stores.taskDecisionsStore = { listCandidatesForWorkspace: g.weighted([[{ ret: { items, nextCursor: g.chance(0.4) ? { scannedAt: '2026-09-02T00:00:00.000Z', issueId: UUID(33) } : null, totalCandidateCount: n + g.int(0, 3) } }, 8], [{ throw: storeErr(g) }, 1]]) };
    const byArg = {};
    for (const it of items) byArg[it.issueId] = g.chance(0.8) ? { ret: recCtx(g, it.issueIdentifier) } : { throw: upstreamErr(g) };
    sc.prov.fetchRecommendationContext = { retByArg: byArg };
    if (g.chance(0.2)) sc.stores.harbourCommentsStore = { wereRecordedByHarbour: { ret: { __setOf: ['c1'] } } };
  } },
  image: { w: 6, make(g, sc) {
    commonWorld(g, sc, { prefer: ['acme', 'jiraws', 'localws', 'legacy', 'ghws'] });
    const url = g.weighted([
      ['https://uploads.linear.app/abc/shot.png', 30], ['https://cdn.linear.app/x.jpg', 6], ['https://linear.app/a.gif', 4],
      ['http://uploads.linear.app/a.png', 3], ['https://evillinear.app/a.png', 3], ['https://uploads.linear.app.evil.com/a.png', 2],
      ['https://uploads.linear.app/../../etc/passwd', 2], ['https://uploads.linear.app/a/%2e%2e/b', 2], ['https://[bad', 2], [undefined, 3], ['', 1],
      ['https://uploads.linear.app/a.png?x=..', 1],
    ]);
    sc.method = 'GET';
    sc.path = P(sc, `/image${url === undefined ? '' : g.chance(0.03) ? `?url=${encodeURIComponent(url)}&url=x` : `?url=${encodeURIComponent(url)}`}`);
    sc.fetch.image = g.weighted([
      [{ status: 200, bytes: 'png', headers: { 'content-type': 'image/png' } }, 12], [{ status: 200, bytes: 'jpg' }, 3], [{ status: 200, bytes: 'gif' }, 2], [{ status: 200, bytes: 'webp' }, 2],
      [{ status: 200, bytes: 'svg', headers: { 'content-type': 'image/svg+xml' } }, 3], [{ status: 200, bytes: 'html', headers: { 'content-type': 'image/png' } }, 2],
      [{ status: 404, bytes: 'empty' }, 2], [{ status: 401, bytes: 'empty' }, 1], [{ status: 200, bytes: 'png', headers: { 'content-length': String(11 * 1024 * 1024) } }, 1],
      [{ status: 200, bigBytes: 10 * 1024 * 1024 + 10 }, 1],
      [{ throw: { kind: 'cause', message: 'fetch failed', code: 'ERR_FR_TOO_MANY_REDIRECTS' } }, 1], [{ throw: { kind: 'plain', message: 'unexpected redirect' } }, 1], [{ throw: { kind: 'plain', message: 'ECONNRESET' } }, 2],
    ]);
  } },
  feedback: { w: 12, make(g, sc) {
    commonWorld(g, sc, { prefer: ['acme', 'localws', 'ghws', 'jiraws', 'ghp', 'testws'] });
    sc.method = 'POST'; sc.path = P(sc, '/feedback');
    const message = g.weighted([[g.pick(['The button is broken', 'Line one\nLine two', 'Crash on save — ✓', '  padded  ']), 80], ['', 4], ['   ', 2], [5, 2], [undefined, 3], ['m'.repeat(10_001), 2]]);
    const body = { message };
    if (g.chance(0.3)) body.title = g.pick(['Explicit title', '   ', 't'.repeat(300), 4]);
    if (g.chance(0.3)) body.teamId = g.pick(['team-body', '  ', '', 9]);
    if (g.chance(0.2)) body.projectId = g.pick(['proj-body', ' ', 3]);
    if (g.chance(0.6)) body.priority = g.pick([0, 1, 2, 3, 4, 5, -1, '2', 'x', 2.5, null]);
    if (g.chance(0.4)) body.action = g.pick(['save', 'triage', 'autopilot', 'bogus', 7]);
    if (g.chance(0.3)) body.url = g.pick(['https://harbour.example/workspace/acme', '  ', 'u'.repeat(2100)]);
    if (g.chance(0.3)) body.userAgent = g.pick(['Mozilla/5.0', '']);
    if (g.chance(0.15)) body.model = g.pick(['anthropic/claude-x', '', 'bad\u0001model', 'm'.repeat(1001), 5]);
    if (g.chance(0.15)) body.harness = g.pick(['claude-code', 'opencode', '', 9]);
    if (g.chance(0.12)) body.image = g.pick([`data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000', 'hex').toString('base64')}`, 'not-a-data-url', 'data:text/plain;base64,aGVsbG8=', `data:image/png;base64,${'A'.repeat(64)}`]);
    sc.body = g.weighted([
      [{ kind: 'json', value: body }, 88], [{ kind: 'raw', text: JSON.stringify(body), contentType: 'text/plain' }, 4],
      [{ kind: 'raw', text: '{"message": ', contentType: 'text/plain' }, 2], [{ kind: 'pad', value: body, padBytes: 300_000, contentType: 'application/json' }, 1],
      [{ kind: 'pad', value: body, padBytes: 300_000, contentType: 'text/plain' }, 1], [{ kind: 'raw', text: 'null', contentType: 'application/json' }, 1], [{ kind: 'none' }, 1],
    ]);
    sc.prov.fetchTeams = g.weighted([[{ ret: [{ id: 'team-1', name: 'T' }] }, 7], [{ ret: [] }, 1], [{ throw: upstreamErr(g) }, 1]]);
    const fbId = g.pick(['LIN-99', `LIN-${200 + sc.index}`, `LIN-${200 + sc.index}`]);
    sc.prov.createIssue = g.weighted([[{ ret: { success: true, issue: { id: UUID(99), identifier: fbId, title: 'T', url: `https://linear.app/acme/issue/${fbId}`, state: { type: 'unstarted' } } } }, 10], [{ ret: { success: true, issue: { id: UUID(98), title: 'no ident' } } }, 1], [{ ret: { success: false } }, 1], [{ throw: upstreamErr(g) }, 1]]);
    sc.prov.uploadFile = g.weighted([[{ ret: 'https://uploads.linear.app/u.png' }, 5], [{ throw: upstreamErr(g) }, 1]]);
    sc.ai.chat = { 'feedback-title': aiChat(g, 'feedback-title', { slow: 1 }) };
    factoryWorld(g, sc);
  } },
  issuesCreate: { w: 7, make(g, sc) {
    commonWorld(g, sc, { prefer: ['acme', 'localws', 'ghws', 'jiraws', 'ghp'] });
    sc.method = 'POST'; sc.path = P(sc, '/issues');
    const body = {};
    if (g.chance(0.95)) body.title = g.weighted([['New issue', 8], ['', 1], ['t'.repeat(300), 1], ['bad\u0001', 1], [5, 1], ['  spaced  ', 2]]);
    if (g.chance(0.5)) body.description = g.weighted([['desc', 6], ['', 2], ['d'.repeat(100_001), 1], [3, 1]]);
    if (g.chance(0.75)) body.teamId = g.weighted([['team-1', 3], [UUID(600), 3], ['LIN', 2], ['Linear Team', 1], ['', 1], [7, 1], ['nosuch', 1]]);
    if (g.chance(0.3)) body.projectId = g.pick([UUID(500), 'Project', 'nosuch', '']);
    if (g.chance(0.3)) body.stateId = g.pick(['st-todo', UUID(700), 'Done', 'In Progress', 'nosuch', '']);
    if (g.chance(0.4)) body.priority = g.weighted([[0, 2], [1, 2], [4, 2], [5, 1], [-1, 1], ['2', 1], [null, 1], [2.5, 1]]);
    sc.body = g.chance(0.04) ? { kind: 'raw', text: '{', contentType: 'application/json' } : { kind: 'json', value: body };
    sc.prov.fetchTeams = g.weighted([[{ ret: [{ id: 'team-1', key: 'LIN', name: 'Linear Team' }, { id: 'team-2', key: 'LIN2', name: 'Linear Team' }] }, 6], [{ ret: [{ id: 'team-1', key: 'LIN', name: 'Linear Team' }] }, 4], [{ throw: upstreamErr(g) }, 1]]);
    sc.prov.createIssue = g.weighted([[{ ret: { success: true, issue: { id: UUID(99), identifier: 'LIN-99' } } }, 8], [{ ret: { id: UUID(97), identifier: 'L-97' } }, 2], [{ ret: null }, 1], [{ ret: { success: false } }, 1], [{ throw: upstreamErr(g) }, 1], [{ throw: { kind: 'refResolution', message: 'ambiguous', status: 422, candidates: ['a', 'b'] } }, 1]]);
  } },
  issuesPatch: { w: 7, make(g, sc, K) {
    commonWorld(g, sc, { prefer: ['acme', 'localws', 'ghws', 'jiraws', 'ghp', 'mixed'] });
    const id = idFor(g, K, sc);
    sc.method = 'PATCH'; sc.path = P(sc, `/issues/${id}${q({ source: g.pick(SOURCES) })}`);
    const body = {};
    if (g.chance(0.4)) body.title = g.pick(['Renamed', '', 't'.repeat(300), 5]);
    if (g.chance(0.4)) body.description = g.pick(['new body', '', null, 5]);
    const sk = g.pick(['stateId', 'state', 'status']);
    if (g.chance(0.5)) body[sk] = g.pick(['st-done', UUID(701), 'Done', 'in progress', 'nosuch', '', 0]);
    if (g.chance(0.3)) body.priority = g.pick([0, 3, 9, '1', null]);
    sc.body = g.chance(0.04) ? { kind: 'raw', text: '[1]', contentType: 'application/json' } : { kind: 'json', value: body };
    sc.prov.issueWriteGuard = g.weighted([[{ ret: { id: ISSUE_UUID, team: { id: 'team-1' } } }, 7], [{ ret: { id: ISSUE_UUID, team: null } }, 1], [{ ret: { trashed: true } }, 1], [{ throw: upstreamErr(g) }, 1]]);
    sc.prov.updateIssue = g.weighted([[{ ret: { success: true, issue: { id: ISSUE_UUID, identifier: 'LIN-7', state: { type: 'completed' } } } }, 8], [{ ret: { id: ISSUE_UUID } }, 1], [{ ret: { success: false } }, 1], [{ throw: { kind: 'partialWrite', message: 'partial', applied: ['title'], failed: 'state', status: 502, causeMessage: 'jira 500' } }, 1], [{ throw: upstreamErr(g) }, 1]]);
    sc.onTicketWrite = g.pick(['ok', 'ok', 'readBack', 'throw']);
  } },
  models: { w: 3, make(g, sc) {
    commonWorld(g, sc);
    sc.method = 'GET'; sc.path = P(sc, '/openrouter/models');
    sc.fetch.catalog = g.weighted([[{ status: 200, json: { data: [{ id: 'a/free', name: 'Free', pricing: { prompt: '0', completion: '0' } }, { id: 'b/paid', name: 'Paid', pricing: { prompt: '0.001', completion: '0.002' } }] } }, 5], [{ status: 500, json: {} }, 1], [{ throw: { kind: 'plain', message: 'ECONNRESET' } }, 1]]);
  } },
  runEvidence: { w: 5, make(g, sc) {
    commonWorld(g, sc, { prefer: ['acme', 'ghws', 'mixed', 'localws'] });
    sc.method = 'GET'; sc.path = P(sc, `/run-evidence/${g.weighted([['LIN-7', 8], ['x'.repeat(101), 1]])}${q({ source: g.pick(SOURCES) })}`);
    prWorld(g, sc);
  } },
  closeOutCheck: { w: 8, make(g, sc) {
    commonWorld(g, sc, { prefer: ['acme', 'ghws', 'mixed', 'localws'] });
    sc.method = 'POST'; sc.path = P(sc, `/run-evidence/${g.weighted([['LIN-7', 8], ['x'.repeat(101), 1]])}/check${q({ source: g.pick([undefined, 'github', 'linear']) })}`);
    sc.body = { kind: 'json', value: g.chance(0.3) ? { source: g.pick(['github', 'linear', 5]) } : {} };
    prWorld(g, sc);
    sc.reqFlags = g.chance(0.05) ? g.pick([{ proxyTokenId: 'pt-1' }, { proxyUrlKey: 'acme' }]) : null;
    const stop = g.weighted([[{ ret: { stopAt: 'pr' } }, 1], [{ ret: { stopAt: null } }, 1]]);
    sc.stores.dispatchQueueStore = { listItems: g.weighted([[{ ret: [{ _id: 'r1', issueIdentifier: 'LIN-7', stopAt: 'pr', dispatchedAt: { __date: '2026-09-30T00:00:00.000Z' } }] }, 6], [{ ret: [] }, 3]]), ...(stop ? {} : {}) };
    sc.stores.closeOutEventsStore = {
      findMergedByPr: g.weighted([[{ ret: null }, 6], [{ ret: { _id: 'ev-m', by: 'person', prUrl: 'https://github.com/org/repo/pull/12', headSha: 'abc', doneAt: g.pick([null, '2026-09-30T00:00:00.000Z']) } }, 3]]),
      findAnyByPr: g.weighted([[{ ret: null }, 3], [{ ret: { _id: 'ev-p', by: 'press' } }, 1]]),
      ...(g.chance(0.1) ? { record: { ret: null } } : {}),
      ...(g.chance(0.1) ? { stampDone: { throw: storeErr(g) } } : {}),
    };
    sc.prov.states = g.weighted([[{ ret: [{ id: 'st-done', name: 'Done', type: 'completed' }] }, 5], [{ ret: [{ id: 'st-x', name: 'Done', type: 'started' }] }, 1], [{ ret: [] }, 1]]);
    sc.prov.updateIssue = g.weighted([[{ ret: { success: true, issue: { id: ISSUE_UUID, state: { type: 'completed' } } } }, 6], [{ throw: upstreamErr(g) }, 1]]);
    sc.seamStopAt = g.weighted([[{ ret: 'pr' }, 3], [{ ret: null }, 1]]);
    sc.seamMarkDone = g.weighted([[{ ret: { success: true, issue: { id: 'i-1' } } }, 4], [{ throw: { kind: 'plain', message: 'cannot set done' } }, 1]]);
    sc.seamRunnerReady = g.chance(0.8);
    sc.onTicketWrite = g.pick(['ok', 'readBack', 'throw']);
  } },
  closeOutPress: { w: 5, make(g, sc) {
    commonWorld(g, sc, { prefer: ['acme', 'ghws'] });
    sc.method = 'POST'; sc.path = P(sc, `/run-evidence/${g.weighted([['LIN-7', 8], ['x'.repeat(101), 1]])}/close-out-press`);
    sc.body = g.chance(0.05) ? { kind: 'raw', text: '{', contentType: 'application/json' } : { kind: 'json', value: { prUrl: g.pick(['https://github.com/org/repo/pull/12', undefined, 7]), headSha: g.pick(['abc', undefined, null]), dispatchId: g.pick(['d-1', undefined]) } };
    sc.reqFlags = g.chance(0.05) ? { proxyTokenId: 'pt-1' } : null;
    sc.stores.closeOutEventsStore = { hasMergedEvent: g.weighted([[{ ret: false }, 6], [{ ret: true }, 2], [{ throw: storeErr(g) }, 1]]), record: g.weighted([[{ ret: { _id: 'ev-1', by: 'press', dispatchId: 'd-1', prUrl: 'https://github.com/org/repo/pull/12', headSha: 'abc' } }, 6], [{ ret: null }, 1], [{ throw: storeErr(g) }, 1]]) };
  } },
  // --- sub-routers (shared code; witnesses the mount and the deps passed) ---
  promptTraces: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'GET'; sc.path = P(sc, `/prompt-traces${q({ issueId: g.pick([undefined, 'LIN-7']), limit: g.pick([undefined, '5', 'x']) })}`); if (g.chance(0.2)) sc.stores.promptTraceStore = { listTraces: { throw: storeErr(g) } }; } },
  customList: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'GET'; sc.path = P(sc, '/prompts/custom'); if (g.chance(0.2)) sc.stores.customPromptsStore = { list: { throw: storeErr(g) } }; } },
  customCreate: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'POST'; sc.path = P(sc, '/prompts/custom'); sc.body = { kind: 'json', value: g.pick([{ name: 'N', template: 'T {{title}}' }, { name: '' }, {}, { name: 'N', template: 5 }]) }; } },
  customUpdate: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'PUT'; sc.path = P(sc, `/prompts/custom/${g.pick(['cp-1', 'nosuch'])}`); sc.body = { kind: 'json', value: g.pick([{ name: 'N2', template: 'T' }, {}]) }; if (g.chance(0.3)) sc.stores.customPromptsStore = { update: { ret: null } }; } },
  customDelete: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'DELETE'; sc.path = P(sc, `/prompts/custom/${g.pick(['cp-1', 'nosuch'])}`); if (g.chance(0.3)) sc.stores.customPromptsStore = { delete: { ret: false } }; } },
  northStarGet: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'GET'; sc.path = P(sc, '/roadmap/north-star'); } },
  northStarPut: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'PUT'; sc.path = P(sc, '/roadmap/north-star'); sc.body = { kind: 'json', value: g.pick([{ text: 'Our star' }, { text: '' }, { text: 5 }, {}]) }; } },
  reportsList: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'GET'; sc.path = P(sc, '/roadmap/reports'); } },
  reportsGet: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'GET'; sc.path = P(sc, `/roadmap/reports/${g.pick(['rep-1', 'nosuch'])}`); if (g.chance(0.5)) sc.stores.reportHistoryStore = { get: { ret: { id: 'rep-1', kind: 'narrative', content: 'x', urlKey: sc.urlKey } } }; } },
  reportsSave: { w: 1.5, make(g, sc) { commonWorld(g, sc); sc.method = 'POST'; sc.path = P(sc, '/roadmap/reports'); sc.body = { kind: 'json', value: g.pick([{ kind: 'narrative', content: 'c' }, {}, { kind: 'bogus' }]) }; } },
  roadmapChat: { w: 1.5, make(g, sc) { commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws'] }); sc.method = 'POST'; sc.path = P(sc, '/roadmap/chat'); sc.body = { kind: 'json', value: g.pick([{ message: 'hi', history: [] }, {}, { message: 'm'.repeat(3000) }]) }; sc.ai.chat = { '*': aiChat(g, 'chat') }; } },
  unmatched: { w: 1.2, make(g, sc) {
    commonWorld(g, sc);
    const v = g.pick([['GET', '/scan/LIN-7/dismiss'], ['DELETE', '/comments/LIN-7'], ['GET', '/issues'], ['PUT', '/issues/LIN-7'], ['GET', '/recommend'], ['GET', '/run-evidence/LIN-7/check'], ['POST', '/audit'], ['GET', '/scan-due/x'], ['GET', '/AUDIT'], ['GET', '/audit/'], ['GET', '/recommend/status/'], ['GET', '/Recommend/LIN-7']]);
    sc.method = v[0]; sc.path = P(sc, v[1]);
  } },
  mockExport: { w: 1.5, make(g, sc, K) {
    // direct calls of the exported pure helpers (generateMockRecommendation / buildMockRecommendationHop)
    sc.kind = 'call'; sc.wsKey = null; sc.env = { NODE_ENV: 'test' };
    if (g.chance(0.5)) {
      sc.export = 'generateMockRecommendation';
      sc.args = [g.pick([
        { identifier: 'LIN-1', labels: ['bug'], state: { name: 'Todo', type: 'unstarted' } },
        { url: 'https://linear.app/x/issue/TEST-9', labels: { nodes: [{ name: 'bug' }] } },
        { identifier: 'LIN-2', labels: [], state: { type: 'backlog' }, relations: { nodes: [{ type: 'blocks', relatedIssue: { state: { type: 'started' } } }] }, inverseRelations: { nodes: [{ type: 'blocks', issue: { state: { type: 'started' } } }] } },
        { labels: [], blockedBy: [{ state: { type: 'started' } }] }, { labels: null },
        K.mockIssue,
      ])];
    } else {
      sc.export = 'buildMockRecommendationHop';
      sc.args = [recCtx(g, g.pick(['LIN-5', ISSUE_UUID]))];
    }
    sc.method = 'CALL'; sc.path = sc.export;
  } },
};

// Per-operation model overrides (LIN-3853 aiModelOverrides.byKind), with a distinct model per
// operation so a route that resolves another operation's key changes the model it calls (LIN-3880).
function opModelOverrides(g, sc, p = 0.5) {
  if (!g.chance(p)) return;
  const model = (m) => ({ model: m });
  sc.stores.workspacePreferencesStore = { getWorkspacePreferences: { ret: { aiModelOverrides: { byKind: { scan: model('m-scan'), recap: model('m-recap'), brief: model('m-brief'), recommend: model('m-recommend') } } } } };
}

function freeTier(g, sc) {
  if (g.chance(0.3)) sc.stores.freeTierStore = { tryUse: g.weighted([[{ ret: { allowed: true, remaining: 3, limit: 10, resetsAt: '2026-10-02T00:00:00.000Z' } }, 2], [{ ret: { allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 10, resetsAt: '2026-10-02T00:00:00.000Z' } }, 2], [{ throw: storeErr(g) }, 1]]) };
}

function recommendWorld(g, sc, id) {
  opModelOverrides(g, sc);
  freeTier(g, sc);
  const descent = g.weighted([['leaf', 6], ['parent', 3], ['cycle', 1], ['stuck', 1]]);
  if (descent === 'leaf') {
    sc.prov.fetchRecommendationContext = g.chance(0.88) ? { ret: recCtx(g, id, { children: [] }) } : { throw: upstreamErr(g) };
  } else {
    const kid = { id: UUID(21), identifier: 'LIN-21', title: 'Child', state: { type: 'started', name: 'In Progress' } };
    const root = recCtx(g, id, { children: [kid] });
    root.focusedChild = { issue: { ...kid, url: 'https://linear.app/acme/issue/LIN-21' } };
    const child = recCtx(g, 'LIN-21', { children: descent === 'cycle' ? [{ id: ISSUE_UUID, identifier: 'LIN-7', state: { type: 'started' } }] : [] });
    if (descent === 'cycle') child.focusedChild = { issue: { id: ISSUE_UUID, identifier: 'LIN-7', state: { type: 'started' }, url: 'u' } };
    sc.prov.fetchRecommendationContext = { retByArg: { 'LIN-21': { ret: child }, '*': { ret: root } } };
    sc.ai.rec = {
      [root.issue.identifier]: { ret: { reasoning: 'container', prompt: null, truncated: false, completionTokens: 3, recommendedAction: 'defer', deferTo: 'LIN-21' } },
      'LIN-21': descent === 'stuck' ? { ret: { reasoning: 'still container', prompt: null, recommendedAction: 'defer', deferTo: 'LIN-99' } } : descent === 'cycle' ? { ret: { reasoning: 'back up', prompt: null, recommendedAction: 'defer', deferTo: root.issue.identifier } } : { ret: { reasoning: 'do it', prompt: 'Implement LIN-21', truncated: false, completionTokens: 9, recommendedAction: 'implement', deferTo: null } },
    };
  }
  if (g.chance(0.18)) {
    sc.ai.rec = { ...(sc.ai.rec || {}), '*': g.weighted([[{ throw: { kind: 'plain', message: 'OpenRouter API error: 429' } }, 3], [{ throw: { kind: 'plain', message: 'Issue not found' } }, 1], [{ throw: { kind: 'gql', status: 401 } }, 1], [{ throw: { kind: 'plain', message: 'kaboom' } }, 2], [{ hang: true }, 1], [{ ret: { reasoning: 'r', prompt: 'p', truncated: true, completionTokens: 8000, recommendedAction: 'implement', deferTo: null }, delayMs: 26_000 }, 2]]) };
    if (sc.ai.rec['*'].hang) sc.clientAbortAfterMs = 200_000;
    if (sc.ai.rec['*'].throw || sc.ai.rec['*'].hang) for (const k of Object.keys(sc.ai.rec)) if (k !== '*') delete sc.ai.rec[k];
  }
  if (g.chance(0.15)) sc.stores.dispatchQueueStore = { listItems: { throw: storeErr(g) } };
}

function cacheGet(g, sc, K, kind) {
  commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws', 'ghp'] });
  const id = idFor(g, K, sc);
  sc.method = 'GET'; sc.path = P(sc, `/${kind}/${id}${q({ source: g.pick(SOURCES) })}`);
  sc.prov.fetchRecommendationContext = g.chance(0.85) ? { ret: recCtx(g, id) } : { throw: upstreamErr(g) };
  const store = kind === 'recap' ? 'recapCacheStore' : 'briefCacheStore';
  sc.stores[store] = { get: g.weighted([[{ ret: null }, 3], [{ ret: { inputHash: 'old', [kind]: kind === 'recap' ? { done: [] } : 'B', generatedAt: '2026-09-30T00:00:00.000Z', model: 'm' } }, 3], [{ ret: { inputHash: { __fromState: 'ctxHash' }, [kind]: kind === 'recap' ? { done: [{ item: 'x' }] } : 'Brief', generatedAt: '2026-09-30T00:00:00.000Z', model: 'm' } }, 3], [{ throw: storeErr(g) }, 1]]) };
}

function cachePost(g, sc, K, kind) {
  commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws', 'ghp'] });
  const id = idFor(g, K, sc);
  sc.method = 'POST'; sc.path = P(sc, `/${kind}/${id}${q({ source: g.pick(SOURCES) })}`);
  sc.prov.fetchRecommendationContext = g.chance(0.85) ? { ret: recCtx(g, id) } : { throw: upstreamErr(g) };
  sc.ai.chat = { [kind]: aiChat(g, kind) };
  freeTier(g, sc);
  const store = kind === 'recap' ? 'recapCacheStore' : 'briefCacheStore';
  sc.stores[store] = { get: g.weighted([[{ ret: null }, 2], [{ ret: { [kind]: 'stored', generatedAt: '2026-10-01T12:00:00.000Z' } }, 3], [{ throw: storeErr(g) }, 1]]), ...(g.chance(0.1) ? { put: { throw: storeErr(g) } } : {}) };
  opModelOverrides(g, sc, 0.3);
}

function scanOutcome(g, sc, K, op) {
  commonWorld(g, sc, { prefer: ['acme', 'testws', 'localws', 'ghp'] });
  const id = g.weighted([[ISSUE_UUID, 4], ['LIN-7', 4], [g.pick(K.mockIds), 2], [g.pick(BAD_IDS), 1]]);
  sc.method = 'POST'; sc.path = P(sc, `/scan/${id}/${op}${q({ source: g.pick(SOURCES) })}`);
  sc.body = g.weighted([[{ kind: 'json', value: { id: g.weighted([['row-1', 8], ['', 1], [5, 1]]) } }, 9], [{ kind: 'json', value: {} }, 1], [{ kind: 'raw', text: '{', contentType: 'application/json' }, 0.5], [{ kind: 'none' }, 0.5]]);
  sc.prov.fetchRecommendationContext = g.chance(0.85) ? { ret: recCtx(g, id, { canonical: g.chance(0.85) }) } : { throw: upstreamErr(g) };
  if (op === 'dismiss') sc.stores.taskDecisionsStore = { markOutcome: g.weighted([[{ ret: null }, 2], [{ throw: storeErr(g) }, 1], [{ throw: { kind: 'plain', message: 'row not found' } }, 1]]) };
  if (op === 'retire') {
    sc.ai.chat = { 'scan-retire': aiChat(g, 'scan-retire') };
    if (g.chance(0.15)) sc.ai.principleZero = null;
    opModelOverrides(g, sc);
    freeTier(g, sc);
    sc.stores.taskDecisionsStore = { markOutcome: g.weighted([[{ __default: true }, 5], [{ ret: null }, 1], [{ ret: { id: 'row-1', outcome: 'dismissed' } }, 1], [{ throw: storeErr(g) }, 1]]) };
    if (sc.stores.taskDecisionsStore.markOutcome.__default) delete sc.stores.taskDecisionsStore;
  }
  if (op === 'unretire') sc.stores.taskDecisionsStore = { reverseOutcome: g.weighted([[{ __default: true }, 4], [{ throw: { kind: 'plain', message: 'reverseOutcome: row not found (pruned or replaced)' } }, 2], [{ throw: { kind: 'plain', message: 'reverseOutcome: row is not self-resolved' } }, 2], [{ throw: { kind: 'gql', status: 401 } }, 1], [{ throw: storeErr(g) }, 1]]) };
  if (sc.stores.taskDecisionsStore?.reverseOutcome?.__default) delete sc.stores.taskDecisionsStore;
  if (op === 'dismiss' && g.chance(0.5)) delete sc.stores.taskDecisionsStore;
}

function prWorld(g, sc) {
  const prs = g.weighted([[['https://github.com/org/repo/pull/12'], 5], [['https://github.com/org/repo/pull/12', 'https://github.com/org/other/pull/3'], 2], [[], 2]]);
  const comments = prs.map((u, k) => ({ id: `c${k}`, body: g.pick([`Opened ${u}`, `PR: ${u}\n\nReview: approved`, `## Review ledger\n- [ ] inside: fix tests\n${u}`]), createdAt: `2026-09-30T1${k}:00:00.000Z`, user: { name: 'Harbour' } }));
  if (g.chance(0.5)) comments.push({ id: 'rv', body: g.pick(['## Review\n\n**Verdict: Approve**\n\n### What CI Did Not Prove\n- **Inside** — flaky\n- **Outside** — docs, discharged by PR #13', '## Review\n\nVerdict: Request changes', '## Code review\n\nApproved.\n\n### What CI Did Not Prove\n_None._']), createdAt: '2026-09-30T13:00:00.000Z', user: { name: 'Harbour' } });
  sc.prov.fetchIssueComments = g.weighted([[{ ret: comments }, 8], [{ throw: upstreamErr(g) }, 1]]);
  sc.fetch.github = g.weighted([
    [{ status: 200, json: { state: 'closed', merged: true, merged_at: '2026-09-30T00:00:00Z', head: { sha: 'abc123', ref: 'feat' }, base: { ref: 'main' }, html_url: 'https://github.com/org/repo/pull/12', mergeable_state: 'clean', number: 12, title: 'PR' } }, 4],
    [{ status: 200, json: { state: 'open', merged: false, head: { sha: 'abc123' }, number: 12 } }, 3],
    [{ status: 404, json: { message: 'Not Found' } }, 1], [{ status: 403, json: { message: 'rate limited' } }, 1], [{ throw: { kind: 'plain', message: 'ECONNRESET' } }, 1],
  ]);
  sc.seamPrStatus = g.weighted([[{ ret: { readable: true, state: 'merged', merged: true, head: { sha: 'abc123' } } }, 3], [{ ret: { readable: true, state: 'open', merged: false } }, 2], [{ throw: { kind: 'plain', message: 'seam boom' } }, 1]]);
  sc.viewerIsOwner = g.chance(0.8);
}

function factoryWorld(g, sc) {
  if (g.chance(0.15)) sc.stores.freeTierStore = { checkRun: g.weighted([[{ ret: { allowed: false, code: 'RUN_LIMIT_REACHED', reason: 'limit' } }, 1], [{ throw: storeErr(g) }, 1]]) };
  if (g.chance(0.1)) sc.stores.proxyTokenStore = { mintGrantBootstrap: g.weighted([[{ throw: { kind: 'coded', code: 'GRANT_OWNER_MISMATCH', message: 'owner mismatch', status: 403, retryable: false } }, 2], [{ throw: { kind: 'coded', code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true } }, 1], [{ throw: storeErr(g) }, 1]]), createToken: g.weighted([[{ ret: { token: 'hb_boot_x', expiresAt: '2026-10-03T00:00:00.000Z' } }, 2], [{ throw: storeErr(g) }, 1]]) };
  if (g.chance(0.08)) sc.stores.dispatchQueueStore = { addItem: { throw: storeErr(g) } };
  if (g.chance(0.2)) sc.stores.workspacePreferencesStore = { getWorkspacePreferences: { ret: { dispatchDefaults: { harness: g.pick(['opencode', 'claude-code', '']), model: g.pick(['m1', '']) } } } };
}

// ---------------------------------------------------------------------------
// Schedule + scenario assembly
// ---------------------------------------------------------------------------
export const FORM_NAMES = Object.keys(FORMS);
export const MIN_PER_FORM = 55;

/** Stratified schedule: every form ≥ MIN_PER_FORM, the rest by weight, interleaved deterministically. */
export function schedule(seed, n) {
  const g = new G((seed * 2654435761) >>> 0);
  const list = [];
  for (const f of FORM_NAMES) for (let k = 0; k < MIN_PER_FORM; k++) list.push(f);
  const total = FORM_NAMES.reduce((s, f) => s + FORMS[f].w, 0);
  while (list.length < n) {
    let x = g.f() * total;
    for (const f of FORM_NAMES) { if ((x -= FORMS[f].w) < 0) { list.push(f); break; } }
  }
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(g.f() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}

export function generateScenario(seed, i, K, form, { tier = 'gen' } = {}) {
  const sc = baseScenario(seed, tier, i, form);
  const g = new G(sc.randomSeed ^ 0x5bd1e995);
  FORMS[form].make(g, sc, K);
  finalize(sc);
  return sc;
}

/** Fill derived fields: session spec, routeKey. */
export function finalize(sc) {
  if (sc.kind === 'call') { sc.routeKey = `CALL ${sc.export}`; return sc; }
  if (!sc.body) sc.body = { kind: 'none' };
  sc.routeKey = routeKeyFor(sc.method, sc.path.split('?')[0]) || 'UNMATCHED';
  return sc;
}

// Route table in registration order (prompts sub-router first, roadmap last).
const ROUTES = [
  ['GET', '/workspace/:urlKey/api/prompt-traces'],
  ['GET', '/workspace/:urlKey/api/prompts/custom'],
  ['POST', '/workspace/:urlKey/api/prompts/custom'],
  ['PUT', '/workspace/:urlKey/api/prompts/custom/:id'],
  ['DELETE', '/workspace/:urlKey/api/prompts/custom/:id'],
  ['GET', '/workspace/:urlKey/api/audit'],
  ['GET', '/workspace/:urlKey/api/prompt/:issueId/:labelName'],
  ['GET', '/workspace/:urlKey/api/autopilot-prompt/:issueId'],
  ['GET', '/workspace/:urlKey/api/autopilot-prompt'],
  ['GET', '/workspace/:urlKey/api/recommend/status'],
  ['GET', '/workspace/:urlKey/api/recommend/:issueId'],
  ['GET', '/workspace/:urlKey/api/recommend/:issueId/stream'],
  ['GET', '/workspace/:urlKey/api/comments/:issueId'],
  ['POST', '/workspace/:urlKey/api/comments/:issueId'],
  ['GET', '/workspace/:urlKey/api/detail/:issueId'],
  ['GET', '/workspace/:urlKey/api/sessions/:identifier'],
  ['GET', '/workspace/:urlKey/api/recap/:issueId'],
  ['POST', '/workspace/:urlKey/api/recap/:issueId'],
  ['GET', '/workspace/:urlKey/api/context/:issueId'],
  ['GET', '/workspace/:urlKey/api/brief/:issueId'],
  ['POST', '/workspace/:urlKey/api/brief/:issueId'],
  ['GET', '/workspace/:urlKey/api/scan/:issueId'],
  ['POST', '/workspace/:urlKey/api/scan/:issueId'],
  ['POST', '/workspace/:urlKey/api/scan/:issueId/dismiss'],
  ['POST', '/workspace/:urlKey/api/scan/:issueId/retire'],
  ['POST', '/workspace/:urlKey/api/scan/:issueId/unretire'],
  ['GET', '/workspace/:urlKey/api/scan-due'],
  ['GET', '/workspace/:urlKey/api/image'],
  ['POST', '/workspace/:urlKey/api/feedback'],
  ['POST', '/workspace/:urlKey/api/issues'],
  ['PATCH', '/workspace/:urlKey/api/issues/:issueId'],
  ['GET', '/workspace/:urlKey/api/openrouter/models'],
  ['GET', '/workspace/:urlKey/api/run-evidence/:issueIdentifier'],
  ['POST', '/workspace/:urlKey/api/run-evidence/:issueIdentifier/check'],
  ['POST', '/workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press'],
  ['GET', '/workspace/:urlKey/api/roadmap/north-star'],
  ['PUT', '/workspace/:urlKey/api/roadmap/north-star'],
  ['POST', '/workspace/:urlKey/api/roadmap/reports'],
  ['GET', '/workspace/:urlKey/api/roadmap/reports'],
  ['GET', '/workspace/:urlKey/api/roadmap/reports/:id'],
  ['POST', '/workspace/:urlKey/api/roadmap/generate'],
  ['POST', '/workspace/:urlKey/api/roadmap/chat'],
];
export const ROUTE_KEYS = ROUTES.map(([m, p]) => `${m} ${p}`);
const ROUTE_RE = ROUTES.map(([m, p]) => [m, p, new RegExp('^' + p.replace(/:[A-Za-z]+/g, '[^/]+') + '/?$', 'i')]);
export function routeKeyFor(method, pathname) {
  let p = pathname;
  try { p = decodeURI(pathname); } catch { /* keep raw */ }
  for (const [m, pat, re] of ROUTE_RE) if (m === method && (re.test(pathname) || re.test(p))) return `${m} ${pat}`;
  return null;
}
