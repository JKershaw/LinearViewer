// Seeded scenario generator. A scenario is PURE DATA (JSON-able, except that
// `undefined` is allowed as a value) describing one request and the complete
// fake world it runs in. The harness materializes it separately for each app.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIXED_NOW = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01T12:00:00Z

class G {
  constructor(seed) { this.r = mulberry32(seed); }
  f() { return this.r(); }
  chance(p) { return this.r() < p; }
  int(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  weighted(pairs) {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let x = this.r() * total;
    for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  }
  hex(n) { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[this.int(0, 15)]; return s; }
  uuid() { return `${this.hex(8)}-${this.hex(4)}-4${this.hex(3)}-a${this.hex(3)}-${this.hex(12)}`; }
}

const ERR = (e) => ({ __err: e });

// ---------------------------------------------------------------------------
// Value pools
// ---------------------------------------------------------------------------
const TITLES = ['Fix login bug', 'Ünïcødé ✓ 日本語 タイトル', '', '<script>alert(1)</script>', 'emoji 🚀🔥', 'a'.repeat(300), 'tab\tnew\nline', '"quoted" \\ back'];
const STATE_TYPES = ['backlog', 'unstarted', 'started', 'completed', 'canceled', 'triage'];
const DATES = ['2026-01-02T03:04:05.000Z', '2025-12-31T23:59:59.999Z', 'not-a-date', '', null, undefined, '2026-01-02T03:04:05.000Z', 1700000000000];

function genDescription(g) {
  return g.weighted([
    [null, 2], [undefined, 1], ['Plain description', 2], ['', 1],
    ['See ![shot](https://uploads.linear.app/aa/bb/cc) and [log.txt](https://uploads.linear.app/dd/ee)', 2],
    ['![](https://user-images.githubusercontent.com/1/abc.png) ![x](<https://uploads.linear.app/x/y>)', 1],
    ['link [elsewhere](https://evil.example.com/a.png) and https://linear.app/team/issue/LIN-1', 1],
    ['ünï ✓ 日本語 **bold**', 1],
  ]);
}

function genComments(g) {
  const n = g.weighted([[0, 2], [1, 2], [3, 3], [8, 1]]);
  const nodes = [];
  for (let i = 0; i < n; i++) {
    nodes.push({
      id: g.uuid(),
      body: g.pick(['lgtm', '![img](https://uploads.linear.app/c/d)', '', 'ünï ✓', null, '[f.md](https://uploads.linear.app/q/r)']),
      createdAt: g.pick(DATES),
      user: g.chance(0.8) ? { id: g.uuid(), name: g.pick(['Ann', 'Bo', 'Ünï']) } : null,
    });
  }
  return g.weighted([[{ nodes }, 6], [nodes, 1], [null, 1], [{ nodes: [null, ...nodes] }, 0.3]]);
}

function genLabels(g) {
  const n = g.int(0, 4);
  const nodes = [];
  for (let i = 0; i < n; i++) nodes.push({ id: g.uuid(), name: g.pick(['bug', 'feature', 'ünï', '', 'p0']), color: '#ff0000' });
  return g.weighted([[{ nodes }, 6], [nodes.map(l => l.name), 1], [null, 1], [undefined, 1], [{ nodes: [null, { name: '' }, ...nodes] }, 0.5]]);
}

export function genIssue(g, depth = 0, opts = {}) {
  const issue = {
    id: g.uuid(),
    identifier: `${g.pick(['LIN', 'ENG', 'HAR'])}-${g.int(1, 9999)}`,
    title: g.pick(TITLES),
    description: genDescription(g),
    priority: g.pick([0, 1, 2, 3, 4, undefined, null, 7]),
    priorityLabel: g.pick(['Urgent', 'High', 'No priority', undefined]),
    state: g.weighted([[{ id: g.uuid(), name: 'In Progress', type: g.pick(STATE_TYPES) }, 8], [null, 1], [undefined, 1]]),
    team: g.weighted([[{ id: g.uuid(), name: 'Eng', key: 'ENG' }, 6], [{ id: null, name: 'x' }, 1], [null, 1], [undefined, 2]]),
    labels: genLabels(g),
    url: g.chance(0.7) ? 'https://linear.app/acme/issue/LIN-1/slug' : undefined,
    createdAt: g.pick(DATES),
    updatedAt: g.pick(DATES),
    archivedAt: g.chance(0.1) ? '2026-02-02T00:00:00.000Z' : null,
    assignee: g.chance(0.6) ? { id: g.uuid(), name: g.pick(['Ann', 'Ünï', '']) } : null,
  };
  if (g.chance(0.12)) issue.trashed = g.pick([true, false, 1, 'yes']);
  if (opts.detail) {
    issue.comments = genComments(g);
    if (g.chance(0.6)) {
      const nodes = [];
      const n = g.int(0, 3);
      for (let i = 0; i < n; i++) nodes.push({ id: g.uuid(), title: g.pick(['spec.pdf', 'Figma', 'ünï.png', null]), url: g.pick(['https://uploads.linear.app/a/b', 'https://www.figma.com/file/x', 'https://cdn.linear.app/z']), subtitle: 'x' });
      issue.attachments = g.weighted([[{ nodes }, 6], [nodes, 1], [null, 1]]);
    }
    if (g.chance(0.4)) issue.relations = { nodes: [{ id: g.uuid(), type: 'blocks', relatedIssue: { id: g.uuid(), identifier: 'LIN-2' } }] };
    if (g.chance(0.3)) issue.inverseRelations = { nodes: [] };
    if (g.chance(0.4)) issue.parent = g.chance(0.5) ? { id: g.uuid(), identifier: 'LIN-9', title: 'Parent' } : null;
  }
  if (depth < 2 && g.chance(depth === 0 ? 0.3 : 0.15)) {
    const kids = [];
    const n = g.int(0, 3);
    for (let i = 0; i < n; i++) kids.push(genIssue(g, depth + 1));
    issue.children = g.weighted([[{ nodes: kids }, 5], [kids, 1], [null, 1]]);
  }
  return issue;
}

function sizeN(g) {
  return g.weighted([[0, 2], [1, 2], [3, 4], [10, 1], [120, 0.25]]);
}

function genIssueList(g, opts = {}) {
  const n = sizeN(g);
  const out = [];
  for (let i = 0; i < n; i++) out.push(genIssue(g, 0, opts));
  if (n && g.chance(0.05)) out.splice(g.int(0, out.length), 0, null);
  return out;
}

function genTeams(g, withIds = []) {
  const n = g.weighted([[0, 2], [1, 2], [3, 4], [300, 0.2]]);
  const teams = withIds.map(id => ({ id, key: 'ENG', name: 'Engineering' }));
  for (let i = 0; i < n; i++) teams.push({ id: g.uuid(), key: g.pick(['ENG', 'OPS', 'ÜNÏ']), name: g.pick(['Eng', 'Ops', 'Ünï ✓']) });
  // shuffle deterministically
  for (let i = teams.length - 1; i > 0; i--) { const j = g.int(0, i); [teams[i], teams[j]] = [teams[j], teams[i]]; }
  if (g.chance(0.2)) return { __arrayWithProps: true, items: teams, props: { truncated: g.pick([true, false, 'yes', 0]) } };
  return teams;
}

// Provider errors of every shape the catch blocks distinguish.
function genProviderError(g, { teamId } = {}) {
  return g.weighted([
    [{ kind: 'gql', status: 401, errors: [{ message: 'Authentication required', extensions: { statusCode: 401 } }] }, 2],
    [{ kind: 'gql', status: 403, errors: [{ message: 'Forbidden', extensions: {} }] }, 1],
    [{ kind: 'gql', status: 200, errors: [{ message: 'Unauthorized', extensions: { statusCode: 401 } }] }, 1],
    [{ kind: 'gql', status: 404, errors: [{ message: 'Entity not found', extensions: { statusCode: 404 } }] }, 1.5],
    [{ kind: 'gql', status: 429, errors: [{ message: 'Rate limited', extensions: { statusCode: 429 } }] }, 1],
    [{ kind: 'gql', status: 500, errors: [{ message: 'Internal', extensions: {} }] }, 1],
    [{ kind: 'gql', status: 502, errors: [] }, 0.5],
    [{ kind: 'gql', status: 200, errors: [{ message: 'Argument Validation Error', extensions: { code: 'INVALID_INPUT', userError: true, userPresentableMessage: 'after is not a valid pagination cursor identifier.' } }] }, 1.5],
    [{ kind: 'gql', status: 200, errors: [{ message: 'Ünï error ✓', extensions: { userError: false } }] }, 0.5],
    [{ kind: 'statusOnly', status: 401, message: 'jira 401' }, 0.7],
    [{ kind: 'statusOnly', status: 503, message: 'jira down' }, 0.5],
    [{ kind: 'timeout' }, 1],
    [{ kind: 'abort' }, 0.5],
    [{ kind: 'network', code: 'ECONNRESET' }, 1],
    [{ kind: 'network', code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.linear.app' }, 0.4],
    [{ kind: 'notImpl', method: 'x' }, 0.6],
    [{ kind: 'team', teamId: teamId ?? 'nope', truncated: g.chance(0.5) }, 0.8],
    [{ kind: 'plain', message: 'boom' }, 1],
    [{ kind: 'string', value: 'thrown string' }, 0.3],
    [{ kind: 'null' }, 0.08],
  ]);
}

function ok(ret) { return { ret }; }
function fail(e) { return { throw: e }; }

function method(g, okValue, errRate = 0.12, errOpts) {
  return g.chance(errRate) ? fail(genProviderError(g, errOpts)) : ok(okValue);
}

// ---------------------------------------------------------------------------
// Request pieces
// ---------------------------------------------------------------------------
const enc = encodeURIComponent;

function qs(pairs) {
  if (!pairs.length) return '';
  return '?' + pairs.map(([k, v, raw]) => raw ? `${k}=${v}` : `${enc(k)}=${enc(v)}`).join('&');
}

function arrayParam(key, values) { return values.map(v => [key, v]); }

const ISSUE_IDS = (g) => g.weighted([
  [g.uuid(), 4], ['LIN-12', 3], ['lin-7', 1], ['%2355', 1], ['M5-100', 1], ['A'.repeat(100), 0.5], ['A'.repeat(101), 0.5],
  ['LIN-12.5', 0.7], ['bad%20id', 0.7], ['%E2%9C%93', 0.7], ['LIN_12', 0.5], ['-', 0.5], ['..', 0.3], ['%2E%2E', 0.3],
  ['LIN-12%2Fx', 0.4], ['%23', 0.4], ['%2523', 0.3], ['%27%3B%20DROP', 0.3], ['%E0%A4%A', 0.15], [g.uuid().toUpperCase(), 0.5], ['%00', 0.2],
]);

const CYCLE_IDS = (g) => g.weighted([
  [g.uuid(), 5], [g.uuid().toUpperCase(), 1], [g.uuid().replace(/-/g, ''), 1], ['cycle-1', 1], ['xyz', 1], ['LIN-12', 0.5], [g.uuid() + 'x', 0.5], ['%E2%9C%93', 0.3],
]);

const SOURCES = (g) => g.weighted([
  [null, 6], [['source', 'linear'], 1], [['source', 'jira'], 1], [['source', 'github'], 0.5], [['source', ''], 0.5], [['source', 'ünï'], 0.3], ['array', 0.4],
]);

function sourcePairs(g) {
  const s = SOURCES(g);
  if (s === null) return [];
  if (s === 'array') return arrayParam('source', ['linear', 'jira']);
  return [s];
}

function unknownPairs(g) {
  return g.chance(0.15) ? [g.pick([['foo', 'bar'], ['limit[]', '1'], ['__proto__', 'x'], ['teamid', 'lower'], ['q', 'ignored']])] : [];
}

const LIMITS = ['0', '1', '2', '50', '249', '250', '251', '1000', '-1', '-100', 'abc', '', '1.5', '7abc', ' 9', '1e2', '0x10', '9007199254740993'];
const WINDOWS = ['', 'abc', '0', '-1', '1', '60000', '900000', '86400000', '86400001', '1e5', '12abc', ' 42', '9007199254740993', '3.9'];

// Team id query param + matching fetchTeams world.
function teamWorld(g) {
  const choice = g.weighted([['absent', 4], ['match', 3], ['nomatch', 2], ['empty', 0.5], ['array', 0.4], ['object', 0.3], ['teamless', 1]]);
  const matchId = g.uuid();
  let pairs = [];
  let teams = genTeams(g, choice === 'match' ? [matchId] : []);
  if (choice === 'match') pairs = [['teamId', matchId]];
  if (choice === 'nomatch') pairs = [['teamId', g.pick([g.uuid(), 'ENG', 'ünï', 'x'.repeat(200)])]];
  if (choice === 'empty') pairs = [['teamId', '']];
  if (choice === 'array') pairs = arrayParam('teamId', [matchId, g.uuid()]);
  if (choice === 'object') pairs = [['teamId[a]', '1', true]];
  if (choice === 'teamless') { pairs = [['teamId', g.uuid()]]; teams = []; }
  return { pairs, teams };
}

function genAuth(g) {
  const mode = g.weighted([['ok', 90], ['missing', 2], ['badscheme', 1.5], ['lower', 0.5], ['empty', 1], ['rejected', 3], ['throws', 1]]);
  const result = {
    tokenId: g.pick(['tok_1', 'tok_2', g.uuid()]),
    urlKey: g.pick(['acme', 'har', 'ünï-ws', 'local-test']),
    label: g.pick(['ci', 'runner', null]),
    scope: g.pick(['read', 'readWrite']),
    createdBy: g.weighted([['acct_1', 6], [null, 1], ['acct_2', 1]]),
    grants: g.pick([[], ['take'], ['take', 'dispatch'], undefined]),
    workspaceId: g.pick(['ws-acme', null, undefined]),
    runner: g.chance(0.1),
  };
  let authorization = 'Bearer tok-abc';
  if (mode === 'missing') authorization = undefined;
  if (mode === 'badscheme') authorization = 'Basic dXNlcjpwYXNz';
  if (mode === 'lower') authorization = 'bearer tok-abc';
  if (mode === 'empty') authorization = 'Bearer ';
  const descriptor = mode === 'rejected' && g.chance(0.6)
    ? { state: g.pick(['expired', 'consumed', 'revoked']), expiresAt: FIXED_NOW - 1000, urlKey: 'acme' }
    : null;
  return { mode: ['missing', 'badscheme', 'lower', 'empty'].includes(mode) ? 'ok' : mode, headerMode: mode, authorization, result, descriptor };
}

function genAccess(g, providerName) {
  const kind = g.weighted([['ok', 80], ['noToken', 10], ['throws', 3], ['structured', 5], ['emptyToken', 1]]);
  const a = {
    token: 'ws-token-' + g.hex(6),
    scope: undefined,
    reason: 'ok',
    declared: g.weighted([[providerName, 8], [null, 2]]),
    credentialFingerprint: g.weighted([[g.hex(12), 7], [null, 2], [undefined, 1]]),
    expiresAt: g.weighted([[FIXED_NOW + 3600_000, 4], [FIXED_NOW - 1000, 3], [null, 2], [NaN, 0.5]]),
    credentialSource: g.pick(['cache', 'session-scan', 'connection', 'refresh-on-resolve', null]),
  };
  if (kind === 'noToken') { a.token = null; a.reason = g.pick(['store_unreachable', 'session_expired', 'not_connected', 'token_ownerless', 'owner_mismatch', 'owner_signed_out', 'weird_reason', undefined]); }
  if (kind === 'emptyToken') { a.token = ''; a.reason = 'not_connected'; }
  if (kind === 'structured') a.scope = g.pick([{ email: 'a@b.c', apiToken: 'jt', site: 'acme.atlassian.net' }, { token: 'gh', repo: 'o/r' }]);
  if (kind === 'throws') a.throw = genProviderError(g);
  return a;
}

function genProviderBase(g) {
  const name = g.weighted([['linear', 6], ['jira', 1], ['github', 1], ['local', 1], ['fake', 0.5]]);
  const ui = g.weighted([[{ displayName: name === 'linear' ? 'Linear' : name[0].toUpperCase() + name.slice(1), attachments: g.chance(0.5) }, 7], [null, 2], [{}, 1]]);
  return { name, ui, unsupported: [], methods: {} };
}

// ---------------------------------------------------------------------------
// Per-route generators: fill req path/query + provider methods + store/fetch.
// ---------------------------------------------------------------------------
const ROUTES = {
  me(g, s) {
    s.path = '/api/proxy/me' + qs(unknownPairs(g));
    s.provider.methods.viewer = method(g, g.weighted([[{ id: g.uuid(), name: g.pick(['Ann', 'Ünï ✓']), email: 'a@b.c', admin: g.chance(0.2) }, 8], [null, 1], [undefined, 0.5], [{ id: 'u', organization: { urlKey: 'acme', name: 'Acme' } }, 1]]));
    return 'viewer';
  },
  'credential-health'(g, s) {
    const pairs = [];
    const w = g.weighted([['absent', 3], ['one', 5], ['array', 0.5]]);
    if (w === 'one') pairs.push(['windowMs', g.pick(WINDOWS)]);
    if (w === 'array') pairs.push(...arrayParam('windowMs', ['1000', '2000']));
    s.path = '/api/proxy/credential-health' + qs([...pairs, ...unknownPairs(g)]);
    s.store.listSelfCredentialHealth = g.chance(0.12)
      ? { throw: { kind: 'plain', message: 'store down' } }
      : { ret: g.weighted([
        [{ occupancy: { verdict: 'ok', windowMs: 900000, buckets: 4, faultedBuckets: 0, occupancy: 1 }, workspaceAccess: { verdict: 'unknown', recentFailureReasons: {} } }, 5],
        [{ occupancy: { verdict: 'unknown' }, workspaceAccess: { verdict: 'dead', dominantReason: 'session_expired', recentFailureReasons: { session_expired: 3 } } }, 2],
        [{ occupancy: {}, workspaceAccess: {} }, 1],
        [{ occupancy: null, workspaceAccess: undefined }, 0.5],
        [{}, 0.5],
        [null, 0.2],
      ]) };
    return null;
  },
  'credential-trail'(g, s) {
    const pairs = [];
    if (g.chance(0.6)) pairs.push(['windowMs', g.pick(WINDOWS)]);
    if (g.chance(0.6)) pairs.push(['limit', g.pick(LIMITS)]);
    if (g.chance(0.05)) pairs.push(...arrayParam('limit', ['3', '4']));
    s.path = '/api/proxy/credential-trail' + qs([...pairs, ...unknownPairs(g)]);
    const items = [];
    const n = sizeN(g);
    for (let i = 0; i < n; i++) items.push({ at: FIXED_NOW - i * 1000, endpoint: '/api/proxy/issues/:id', method: 'GET', status: g.pick([200, 401, 503]), credentialSource: g.pick(['cache', 'connection', null]), credentialFingerprint: g.hex(12) });
    s.store.listSelfCredentialTrail = g.chance(0.12)
      ? { throw: { kind: g.pick(['plain', 'timeout']), message: 'trail down' } }
      : { ret: g.weighted([[{ windowMs: 900000, limit: 50, items }, 8], [{ items: [] }, 1], [null, 0.3], [[], 0.3]]) };
    return null;
  },
  teams(g, s) {
    s.path = '/api/proxy/teams' + qs(unknownPairs(g));
    s.provider.methods.fetchTeams = method(g, genTeams(g));
    if (g.chance(0.03)) s.provider.methods.fetchTeams = ok(null);
    return null; // /teams has no capability gate
  },
  projects(g, s) {
    s.path = '/api/proxy/projects' + qs(unknownPairs(g));
    const n = sizeN(g);
    const projects = [];
    for (let i = 0; i < n; i++) projects.push({ id: g.uuid(), name: g.pick(['Roadmap', 'Ünï ✓', '']), url: 'https://linear.app/acme/project/x', state: g.pick(['started', 'planned', null]), progress: g.pick([0, 0.5, 1, null]), lead: g.chance(0.5) ? { id: g.uuid(), name: 'L', url: 'https://x' } : null });
    if (n && g.chance(0.05)) projects.push(null, 'str', 7);
    s.provider.methods.projects = method(g, g.chance(0.03) ? null : projects);
    return 'projects';
  },
  issues(g, s) {
    const tw = teamWorld(g);
    const pairs = [...tw.pairs];
    if (g.chance(0.6)) pairs.push(['limit', g.pick(LIMITS)]);
    const cur = g.weighted([['none', 5], ['after', 2], ['cursor', 1.5], ['both', 0.7], ['emptyAfter', 0.5], ['arrayAfter', 0.3]]);
    if (cur === 'after') pairs.push(['after', g.pick(['YWJj', '120', 'ünï', 'x'.repeat(500)])]);
    if (cur === 'cursor') pairs.push(['cursor', g.pick(['Y3Vy', '0', '50'])]);
    if (cur === 'both') pairs.push(['after', 'A1'], ['cursor', 'C1']);
    if (cur === 'emptyAfter') pairs.push(['after', '']);
    if (cur === 'arrayAfter') pairs.push(...arrayParam('after', ['a', 'b']));
    if (g.chance(0.3)) { for (let i = pairs.length - 1; i > 0; i--) { const j = g.int(0, i); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; } }
    s.path = '/api/proxy/issues' + qs([...pairs, ...unknownPairs(g)]);
    s.provider.methods.fetchTeams = method(g, tw.teams, 0.06);
    const pageInfo = g.weighted([[{ hasNextPage: true, endCursor: 'Y3Vyc29y' }, 4], [{ hasNextPage: false, endCursor: null }, 4], [{}, 1], [{ hasNextPage: 'yes', endCursor: '' }, 0.5], [undefined, 0.2]]);
    const nodes = genIssueList(g);
    s.provider.methods.issues = method(g, g.chance(0.02) ? { nodes: null, pageInfo } : { nodes, pageInfo });
    return 'issues';
  },
  issue(g, s) {
    const id = ISSUE_IDS(g);
    s.path = `/api/proxy/issues/${id}` + qs([...sourcePairs(g), ...unknownPairs(g)]);
    const issue = genIssue(g, 0, { detail: true });
    s.provider.methods.issueDetail = method(g, g.weighted([[issue, 9], [null, 1], [undefined, 0.3]]));
    return 'issueDetail';
  },
  search(g, s) {
    const q = g.weighted([
      ['absent', 1], [['q', ''], 1], [['q', 'login bug'], 4], [['q', 'ünï ✓ 日本'], 1], [['q', 'x'.repeat(500)], 1], [['q', 'x'.repeat(501)], 1],
      ['array', 0.6], ['object', 0.3], [['q', '%'], 0.3], [['Q', 'upper'], 0.3],
    ]);
    let pairs = [];
    if (q === 'array') pairs = arrayParam('q', ['a', 'b']);
    else if (q === 'object') pairs = [['q[x]', 'y', true]];
    else if (q !== 'absent') pairs = [q];
    s.path = '/api/proxy/search' + qs([...pairs, ...unknownPairs(g)]);
    s.provider.methods.search = method(g, g.chance(0.03) ? null : genIssueList(g));
    return 'search';
  },
  states(g, s) {
    const teamId = g.weighted([[g.uuid(), 5], ['ENG', 2], ['%C3%BC', 1], ['%20', 0.5], ['x'.repeat(150), 0.5], ['%E0%A4%A', 0.1]]);
    s.path = `/api/proxy/states/${teamId}` + qs(unknownPairs(g));
    const n = sizeN(g);
    const states = [];
    for (let i = 0; i < n; i++) states.push({ id: g.uuid(), name: g.pick(['Todo', 'Done', 'Ünï']), type: g.pick(STATE_TYPES), position: g.pick([0, 1.5, -2, null]), color: '#fff' });
    s.provider.methods.states = method(g, states, 0.18, { teamId });
    return 'states';
  },
  labels(g, s) {
    const tw = teamWorld(g);
    s.path = '/api/proxy/labels' + qs([...tw.pairs, ...unknownPairs(g)]);
    s.provider.methods.fetchTeams = method(g, tw.teams, 0.06);
    const n = sizeN(g);
    const labels = [];
    for (let i = 0; i < n; i++) labels.push({ id: g.uuid(), name: g.pick(['bug', 'Ünï', '']), color: g.pick(['#f00', null]), parent: g.chance(0.2) ? { id: g.uuid(), name: 'grp' } : null });
    s.provider.methods.labels = method(g, labels);
    return 'labels';
  },
  cycles(g, s) {
    const tw = teamWorld(g);
    s.path = '/api/proxy/cycles' + qs([...tw.pairs, ...unknownPairs(g)]);
    s.provider.methods.fetchTeams = method(g, tw.teams, 0.06);
    const n = sizeN(g);
    const cycles = [];
    for (let i = 0; i < n; i++) cycles.push({ id: g.uuid(), number: i + 1, name: g.pick(['Cycle 1', null, 'Ünï']), startsAt: g.pick(DATES), endsAt: g.pick(DATES), progress: g.pick([0, 0.3, null]), url: g.chance(0.5) ? 'https://linear.app/c' : undefined });
    s.provider.methods.cycles = method(g, cycles);
    return 'cycles';
  },
  cycle(g, s) {
    const id = CYCLE_IDS(g);
    const alias = g.chance(0.35);
    s.path = `/api/proxy/${alias ? 'cycle' : 'cycles'}/${id}` + qs(unknownPairs(g));
    s.routeKey = alias ? '/api/proxy/cycle/:cycleId' : '/api/proxy/cycles/:cycleId';
    const cyc = { id: g.uuid(), number: g.int(1, 40), name: g.pick(['Cycle 7', null]), startsAt: g.pick(DATES), url: g.chance(0.6) ? 'https://linear.app/x' : undefined, issues: g.weighted([[{ nodes: genIssueList(g) }, 6], [genIssueList(g), 1], [null, 1], [undefined, 1]]) };
    s.provider.methods.cycleDetail = method(g, g.weighted([[cyc, 9], [null, 1.2], [undefined, 0.3]]));
    return 'cycleDetail';
  },
  relations(g, s) {
    const id = ISSUE_IDS(g);
    const alias = g.chance(0.4);
    s.path = (alias ? `/api/proxy/relations/${id}` : `/api/proxy/issues/${id}/relations`) + qs([...sourcePairs(g), ...unknownPairs(g)]);
    s.routeKey = alias ? '/api/proxy/relations/:issueId' : '/api/proxy/issues/:issueId/relations';
    const rel = () => ({ id: g.uuid(), type: g.pick(['blocks', 'related', 'duplicate']), relatedIssue: { id: g.uuid(), identifier: 'LIN-3', title: g.pick(TITLES), state: { type: 'started' } }, issue: { id: g.uuid() } });
    const mk = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(rel()); return a; };
    const r = {
      id: g.uuid(),
      trashed: g.weighted([[undefined, 6], [true, 2], [false, 1], [1, 0.3]]),
      relations: g.weighted([[{ nodes: mk(g.int(0, 4)) }, 6], [mk(2), 1], [null, 1], [undefined, 0.5]]),
      inverseRelations: g.weighted([[{ nodes: mk(g.int(0, 3)) }, 6], [null, 1], [undefined, 1]]),
    };
    s.provider.methods.relations = method(g, g.weighted([[r, 9], [null, 1], [{}, 0.3]]));
    return 'relations';
  },
  attachments(g, s) {
    const MD_URLS = [
      ['https://uploads.linear.app/aaa/bbb', 4], ['https://uploads.linear.app/aaa/bbb.png', 1], ['https://cdn.linear.app/x/y', 1], ['https://linear.app/x/y', 0.5],
      ['https://user-images.githubusercontent.com/1/abc.png', 2], ['https://private-user-images.githubusercontent.com/1/abc.png?jwt=x', 1],
      ['http://uploads.linear.app/aaa/bbb', 1], ['https://evil.example.com/a.png', 1], ['https://uploads.linear.app.evil.com/x', 0.5],
      ['https://[::1', 0.5], ['https://uploads.linear.app/a..b/c', 0.5], ['ftp://uploads.linear.app/x', 0.3], ['', 0.3], ['https://uploads.linear.app/', 0.4],
      ['https://uploads.linear.app/%2e%2e/x', 0.3], ['https://UPLOADS.linear.app/caps', 0.3],
    ];
    const NAMES = [[null, 4], ['notes.txt', 2], ['image.png', 1], ['diagram.svg', 0.7], ['evil.exe', 1], ['weird name (1).md', 1], ['ünï ✓.txt', 0.7], ['../../etc/passwd.txt', 0.5], ['A.TXT', 0.5], ['noext', 0.5], ['data.json', 0.7], ['', 0.3]];
    const kind = g.weighted([['md', 6], ['att', 4], ['garbage', 1]]);
    let handle;
    if (kind === 'md') {
      let url = g.weighted(MD_URLS);
      const name = g.weighted(NAMES);
      if (name !== null && url.startsWith('https://')) url += `#name=${encodeURIComponent(name)}`;
      handle = 'md:' + Buffer.from(url, 'utf8').toString('base64url');
      if (g.chance(0.05)) handle = 'md:' + g.pick(['!!!', '', '%%%', '====']);
    } else if (kind === 'att') {
      handle = 'att:' + g.weighted([[g.uuid(), 6], ['', 0.5], ['ünï', 0.3], ['a/b', 0.3]]);
      const att = { id: g.uuid(), url: g.weighted(MD_URLS), title: g.weighted(NAMES) };
      s.provider.methods.fetchAttachment = method(g, g.weighted([[att, 8], [null, 1.5], [{ title: 'no url' }, 0.3]]), 0.15);
    } else {
      handle = g.pick(['xyz', 'ATT:abc', 'md', 'att', 'data:text/plain,hi', '%E0%A4%A']);
    }
    const encoded = handle === '%E0%A4%A' ? handle : g.chance(0.9) ? encodeURIComponent(handle) : handle.replace(/[^A-Za-z0-9:_\-.~]/g, (c) => encodeURIComponent(c));
    s.path = `/api/proxy/attachments/${encoded}` + qs(unknownPairs(g));
    s.fetchViaGlobal = g.chance(0.2);
    const fk = g.weighted([['ok', 10], ['notOk', 2], ['throw', 1.5]]);
    if (fk === 'throw') {
      s.fetch = { throw: g.weighted([[{ kind: 'redirectCause' }, 1], [{ kind: 'redirectMsg' }, 1], [{ kind: 'network', code: 'ECONNRESET' }, 1], [{ kind: 'timeout' }, 0.5]]) };
    } else {
      s.fetch = {
        status: fk === 'ok' ? 200 : g.pick([404, 403, 500, 302, 410]),
        contentType: g.weighted([['image/png', 4], ['image/svg+xml', 1], ['application/octet-stream', 2], ['text/plain', 1], [null, 1], ['IMAGE/PNG', 0.3]]),
        contentLength: g.weighted([[null, 6], ['12', 2], [String(10 * 1024 * 1024 + 1), 1], ['abc', 0.5]]),
        big: g.chance(0.04),
        body: g.pick(['PNGDATA', 'hello ünï ✓', '<svg onload=alert(1)/>', '']),
      };
      // an oversized body whose upstream omits/understates content-length (post-read cap)
      if (s.fetch.big && g.chance(0.7)) s.fetch.contentLength = g.pick([null, '12']);
    }
    return 'fetchAttachment';
  },
  unmatched(g, s) {
    s.path = g.pick(['/api/proxy/issues/LIN-1/children', '/api/proxy/nope', '/api/proxy/attachments/', '/api/proxy/states/', '/api/proxy/cycles/a/b', '/api/proxy']);
    s.routeKey = '(unmatched)';
    return null;
  },
};

const ROUTE_KEYS = {
  me: '/api/proxy/me', 'credential-health': '/api/proxy/credential-health', 'credential-trail': '/api/proxy/credential-trail',
  teams: '/api/proxy/teams', projects: '/api/proxy/projects', issues: '/api/proxy/issues', issue: '/api/proxy/issues/:issueId',
  search: '/api/proxy/search', states: '/api/proxy/states/:teamId', labels: '/api/proxy/labels', cycles: '/api/proxy/cycles',
  attachments: '/api/proxy/attachments/:id',
};

const WEIGHTS = [
  ['me', 1], ['credential-health', 1], ['credential-trail', 1], ['teams', 1], ['projects', 1], ['issues', 2], ['issue', 2],
  ['search', 1.5], ['states', 1], ['labels', 1.2], ['cycles', 1.2], ['cycle', 1.5], ['relations', 1.5], ['attachments', 4], ['unmatched', 0.3],
];

/**
 * Generate request i of a run. Each request has its own PRNG stream derived
 * from (seed, i), so a request is reproducible on its own (--only i).
 */
export function generateScenario(seed, i) {
  const g = new G((seed * 1000003 + i * 7919 + 17) >>> 0);
  const route = g.weighted(WEIGHTS);
  const provider = genProviderBase(g);
  const s = {
    index: i,
    route,
    routeKey: ROUTE_KEYS[route],
    method: g.chance(0.02) ? 'HEAD' : 'GET',
    path: '',
    auth: genAuth(g),
    access: genAccess(g, provider.name),
    provider,
    registry: { suspect: g.chance(0.25), pastThreshold: g.chance(0.1), superseded: g.chance(0.1) },
    store: {},
    fetch: null,
    randomSeed: g.int(1, 2 ** 31 - 1),
  };
  const gated = ROUTES[route](g, s);
  if (g.chance(0.01)) s.store.recordEvent = { throw: { kind: 'plain', message: 'recordEvent rejected' } };
  // capability declines on the gated method, and an occasionally missing method
  if (gated && g.chance(0.08)) s.provider.unsupported.push(gated);
  if (g.chance(0.02)) s.provider.unsupported.push(g.pick(['viewer', 'issues', 'search', 'labels', 'fetchAttachment']));
  const methodNames = Object.keys(s.provider.methods);
  if (methodNames.length && g.chance(0.015)) delete s.provider.methods[g.pick(methodNames)];
  if (g.chance(0.006)) s.provider = g.pick([null, undefined]);
  // path-shape variants (router strictness / case sensitivity)
  if (route !== 'unmatched' && g.chance(0.03)) {
    const [p, q = ''] = s.path.split('?');
    s.path = (g.chance(0.5) ? p + '/' : p.replace('/api/proxy/', '/API/Proxy/')) + (q ? '?' + q : '');
  }
  return s;
}
