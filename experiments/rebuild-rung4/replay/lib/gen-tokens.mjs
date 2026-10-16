// Scenario generator for routes/proxy-tokens-admin.js (createTokensAdminRoutes).
// Session-cookie surface: the session (express-session's req.session) is
// scenario data; workspaceFromUrl is the server.js transcription in fakes.mjs.
import { G, FIXED_NOW } from './common.mjs';
import { ok, fail, encodeBody, qs } from './gen-common.mjs';

export const ROUTE_KEYS = {
  create: 'POST /workspace/:urlKey/api/proxy/tokens',
  list: 'GET /workspace/:urlKey/api/proxy/tokens',
  revoke: 'DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId',
  events: 'GET /workspace/:urlKey/api/proxy/events',
  health: 'GET /workspace/:urlKey/api/proxy/credential-health',
  unmatched: '(unmatched)',
};

const TOKEN_UUID = '00000000-0000-4000-a000-000000000901';
const iso = (ms) => new Date(FIXED_NOW + ms).toISOString();

function genSession(g) {
  const kind = g.weighted([['ok', 20], ['noWorkspaces', 0.8], ['emptyWorkspaces', 0.4], ['throwing', 0.15]]);
  const ws = [{ urlKey: 'acme', id: 'ws-acme', name: 'Acme', provider: g.weighted([['linear', 5], ['jira', 1], ['github', 1], ['local', 0.6], [undefined, 1], ['nonexistent', 0.4]]) }];
  if (g.chance(0.4)) ws.push({ urlKey: 'har', id: 'ws-har', name: 'Har', provider: 'linear' });
  const session = {};
  if (kind === 'ok') session.workspaces = ws;
  if (kind === 'emptyWorkspaces') session.workspaces = [];
  if (kind === 'throwing') session.__throwingWorkspaces = true;
  const acct = g.weighted([['acct_1', 8], [undefined, 2], ['', 0.3]]);
  if (acct !== undefined) session.accountId = acct;
  const f = g.weighted([['none', 8], ['proxyOff', 1], ['proxyOn', 1], ['proxyStr', 0.4], ['junk', 0.3]]);
  if (f === 'proxyOff') session.features = { proxy: false };
  if (f === 'proxyOn') session.features = { proxy: true, roadmap: true };
  if (f === 'proxyStr') session.features = { proxy: 'true' };
  if (f === 'junk') session.features = { notAFeature: true };
  return session;
}

function urlKey(g) {
  return g.weighted([['acme', 10], ['har', 1.5], ['other', 1], ['bad_key!', 0.5], ['ACME', 0.4], ['a'.repeat(51), 0.3], ['%C3%BC', 0.2]]);
}

function minted(g, label, grants, profile) {
  return {
    tokenId: TOKEN_UUID, token: 'hb_' + g.hex(16), label, scope: 'readWrite', kind: 'bootstrap', singleUse: true,
    grants, expiresAt: iso(g.pick([3600_000, 48 * 3600_000])), lifetimeProfile: profile,
  };
}

const ROUTES = {
  create(g, s) {
    s.method = 'POST';
    const b = {};
    const shape = g.weighted([['default', 5], ['promptProxy', 3], ['bootstrap', 2], ['runner', 2], ['purpose', 3], ['grants', 0.6], ['junk', 0.8]]);
    if (shape === 'default') {
      if (g.chance(0.7)) b.label = g.weighted([['ci', 4], ['', 0.5], ['l'.repeat(1001), 0.4], ['Ünï ✓', 0.5], [7, 0.2]]);
      if (g.chance(0.6)) b.scope = g.weighted([['read', 3], ['readWrite', 3], ['admin', 0.6], ['', 0.3]]);
      if (g.chance(0.3)) b.singleUse = g.pick([true, 'true', false, 'yes']);
    }
    if (shape === 'promptProxy') { b.label = 'prompt-proxy'; b.scope = 'readWrite'; b.bootstrap = g.pick([true, 'true', true, false, 'yes']); }
    if (shape === 'bootstrap') { b.bootstrap = g.pick([true, 'true']); if (g.chance(0.5)) b.label = 'handoff'; if (g.chance(0.4)) b.scope = 'readWrite'; }
    if (shape === 'runner') { b.runner = g.pick([true, 'true', 'TRUE', false]); if (g.chance(0.3)) b.purpose = g.pick(['runner', 'driver', 'agent']); if (g.chance(0.3)) b.scope = 'read'; }
    if (shape === 'purpose') { b.purpose = g.weighted([['driver', 3], ['agent', 2], ['runner', 2], ['nope', 0.6], [5, 0.3], ['toString', 0.3], ['__proto__', 0.2]]); if (g.chance(0.3)) b.label = 'client-label'; }
    if (shape === 'grants') { b.grants = g.pick([['take'], [], 'dispatch', null]); b.label = 'x'; }
    if (shape === 'junk') { b.foo = 'bar'; }
    s.body = encodeBody(g, b);
    s.path = `/workspace/${urlKey(g)}/api/proxy/tokens` + qs(g.chance(0.05) ? [['purpose', 'runner']] : []);
    const purposeRow = b.purpose === 'driver' ? ['prompt-driver', ['dispatch'], 'worker'] : b.purpose === 'agent' ? ['agent-prompt-dispatch', ['dispatch'], 'worker'] : [null, ['take', 'dispatch'], 'runner'];
    s.stores.proxyTokenStore = {
      mintGrantBootstrap: g.weighted([
        [ok(minted(g, ...purposeRow)), 7],
        [fail({ kind: 'coded', code: g.pick(['WORKSPACE_OWNER_UNSET', 'GRANT_OWNER_ONLY', 'OWNER_CHECK_UNAVAILABLE', 'GRANT_OWNERLESS', 'RUNNER_OWNER_ONLY']) }), 2],
        [fail({ kind: 'coded', code: 'SOMETHING_ELSE' }), 0.5],
        [fail({ kind: 'plain', message: 'mongo down' }), 0.4],
      ]),
      createToken: g.weighted([
        [ok({ tokenId: TOKEN_UUID, token: 'hp_' + g.hex(16), label: b.label || 'default', scope: b.scope || 'read', kind: b.bootstrap ? 'bootstrap' : 'working', singleUse: !!b.singleUse }), 8],
        [fail({ kind: 'plain', message: 'ownerless bootstrap refused' }), 0.6],
        [ok({}), 0.3],
      ]),
    };
  },
  list(g, s) {
    s.method = g.chance(0.03) ? 'HEAD' : 'GET';
    s.path = `/workspace/${urlKey(g)}/api/proxy/tokens`;
    s.body = { kind: 'none' };
    s.stores.proxyTokenStore = {
      listTokens: g.weighted([[ok([{ tokenId: TOKEN_UUID, label: 'ci', scope: 'read', createdAt: iso(-1000), grants: [] }, { tokenId: 't2', label: 'Ünï ✓', scope: 'readWrite', grants: ['take', 'dispatch'], runner: true }]), 5], [ok([]), 2], [ok(null), 0.4], [fail({ kind: 'plain', message: 'list failed' }), 0.8]]),
    };
  },
  revoke(g, s) {
    s.method = 'DELETE';
    const id = g.weighted([[TOKEN_UUID, 6], [TOKEN_UUID.toUpperCase(), 0.5], ['not-a-uuid', 1], ['%E2%9C%93', 0.2]]);
    s.path = `/workspace/${urlKey(g)}/api/proxy/tokens/${id}`;
    s.body = { kind: 'none' };
    s.stores.proxyTokenStore = {
      revokeToken: g.weighted([
        [ok(true), 5], [ok(false), 1.5], [ok({ revoked: 1 }), 0.3],
        [fail({ kind: 'runnerRefusal', code: g.pick(['RUNNER_OWNER_ONLY', 'OWNER_CHECK_UNAVAILABLE']), status: g.pick([403, 503]), retryable: g.chance(0.3) }), 1.2],
        [fail({ kind: 'plain', message: 'revoke failed' }), 0.7],
      ]),
    };
  },
  events(g, s) {
    s.method = 'GET';
    const pairs = [];
    if (g.chance(0.6)) pairs.push(['limit', g.pick(['0', '1', '5', '100', '101', '-3', 'abc', '', '1e2', '50'])]);
    if (g.chance(0.5)) pairs.push(['offset', g.pick(['0', '10', '-5', 'abc', '', '2.7'])]);
    if (g.chance(0.04)) pairs.push(['limit', '7'], ['limit', '8']);
    s.path = `/workspace/${urlKey(g)}/api/proxy/events` + qs(pairs);
    s.body = { kind: 'none' };
    s.stores.proxyEventStore = { listEvents: g.weighted([[ok({ events: [{ endpoint: '/api/proxy/me', status: 200 }], total: 1 }), 5], [ok({ events: [], total: 0 }), 1], [ok(undefined), 0.3], [fail({ kind: 'plain', message: 'events down' }), 0.8]]) };
  },
  health(g, s) {
    s.method = 'GET';
    s.path = `/workspace/${urlKey(g)}/api/proxy/credential-health` + qs(g.chance(0.1) ? [['windowMs', '1000']] : []);
    s.body = { kind: 'none' };
    s.stores.proxyEventStore = { listCredentialHealth: g.weighted([[ok({ tokens: [{ tokenId: 't1', verdict: 'ok' }] }), 5], [ok({ tokens: [] }), 1], [ok(null), 0.3], [fail({ kind: 'plain', message: 'health down' }), 0.8]]) };
  },
  unmatched(g, s) {
    const [m, p] = g.pick([
      ['PUT', '/workspace/acme/api/proxy/tokens'], ['GET', `/workspace/acme/api/proxy/tokens/${TOKEN_UUID}`], ['PATCH', `/workspace/acme/api/proxy/tokens/${TOKEN_UUID}`],
      ['POST', '/workspace/acme/api/proxy/events'], ['DELETE', '/workspace/acme/api/proxy/tokens'], ['GET', '/workspace/acme/api/proxy/token'],
    ]);
    s.method = m;
    s.path = p;
    s.body = encodeBody(g, { label: 'prompt-proxy', bootstrap: true });
  },
};

const WEIGHTS = [['create', 2.2], ['list', 1], ['revoke', 1], ['events', 1], ['health', 1], ['unmatched', 0.15]];

export function generateScenario(seed, i) {
  const g = new G((seed * 1000003 + i * 7919 + 303) >>> 0);
  const route = g.weighted(WEIGHTS);
  const s = {
    index: i, slot: 'tokens-admin', route, routeKey: ROUTE_KEYS[route], variant: 'full',
    method: 'GET', path: '', body: { kind: 'none' },
    auth: { authorization: g.chance(0.1) ? 'Bearer tok-abc' : undefined }, // ignored by this surface
    access: { token: null }, provider: null,
    session: genSession(g),
    env: { DISPATCH_OWNERLESS_BROKER_COMPAT: g.weighted([[undefined, 3], ['off', 2], ['false', 1], ['on', 1], [' OFF ', 0.3]]) },
    stores: {},
    limiter: g.chance(0.03) ? { [g.pick(['proxyTokenCreationLimiter', 'defaultCopyTokenCreationLimiter'])]: 'block' } : {},
    randomSeed: g.int(1, 2 ** 31 - 1),
  };
  ROUTES[route](g, s);
  return s;
}
