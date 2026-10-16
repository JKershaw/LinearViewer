// Generator pieces shared by the three routers: auth, workspace access,
// provider errors, request-body encodings. A scenario is PURE DATA (JSON-able,
// `undefined` allowed) — the harness materializes it separately for each app.
import { FIXED_NOW } from './common.mjs';

export const ERR = (e) => ({ __err: e });
export const ok = (ret) => ({ ret });
export const fail = (e) => ({ throw: e });
export const sync = (b) => ({ ...b, sync: true });

export const TEXTS = ['Fix login bug', 'Ünïcødé ✓ 日本語 タイトル', 'emoji 🚀🔥', '<script>alert(1)</script>', 'tab\tnew\nline', '"quoted" \\ back', 'plain'];
export const CONTROL = 'bad\u0001char';

// Weighted so each RESULTING status class (graphqlErrorStatus: 401/503,
// 404, 429, 500, 504, 400, plus a thrown null -> TypeError -> error handler)
// is roughly equally likely.
export function genProviderError(g, extra = []) {
  return g.weighted([
    [{ kind: 'gql', status: 401, errors: [{ message: 'Authentication required', extensions: { statusCode: 401 } }] }, 0.8],
    [{ kind: 'gql', status: 403, errors: [{ message: 'Forbidden', extensions: {} }] }, 0.4],
    [{ kind: 'gql', status: 200, errors: [{ message: 'Unauthorized', extensions: { statusCode: 401 } }] }, 0.4],
    [{ kind: 'statusOnly', status: 401, message: 'jira 401' }, 0.3],
    [{ kind: 'gql', status: 404, errors: [{ message: 'Entity not found', extensions: { statusCode: 404 } }] }, 1.4],
    [{ kind: 'gql', status: 429, errors: [{ message: 'Rate limited', extensions: { statusCode: 429 } }] }, 1.4],
    [{ kind: 'gql', status: 500, errors: [{ message: 'Internal', extensions: {} }] }, 0.4],
    [{ kind: 'gql', status: 502, errors: [] }, 0.2],
    [{ kind: 'network', code: 'ECONNRESET' }, 0.3],
    [{ kind: 'notImpl', method: 'x' }, 0.2],
    [{ kind: 'plain', message: 'boom' }, 0.3],
    [{ kind: 'string', value: 'thrown string' }, 0.2],
    [{ kind: 'timeout' }, 1],
    [{ kind: 'abort' }, 0.4],
    [{ kind: 'gql', status: 200, errors: [{ message: 'Argument Validation Error', extensions: { code: 'INVALID_INPUT', userError: true, userPresentableMessage: 'title is too long.' } }] }, 1.3],
    [{ kind: 'gql', status: 200, errors: [{ message: 'Ünï error ✓', extensions: { userError: false } }] }, 0.1],
    [{ kind: 'null' }, 1],
    ...extra,
  ]);
}

/** Write-side extras: RefResolutionError and PartialWriteError shapes. */
export function writeErrorExtras(g) {
  return [
    [{ kind: 'refResolution', message: "Provider refused: description contains unrenderable content", status: g.pick([422, 409, 400]) }, 1.4],
    [{ kind: 'refResolution', message: 'ambiguous ref', status: 422, candidates: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }, 0.4],
    [{ kind: 'partialWrite', message: 'Fields saved but transition failed', applied: g.pick([['title'], ['title', 'description'], []]), failed: g.pick(['transition', 'confirm-read']), status: g.pick([502, 429, undefined, 0]), causeMessage: g.pick(['upstream 502', undefined]) }, 1],
  ];
}

/** Proxy bearer auth (authenticateProxyToken model). */
export function genAuth(g) {
  const mode = g.weighted([['ok', 93], ['missing', 1.2], ['badscheme', 0.8], ['lower', 0.4], ['empty', 0.6], ['rejected', 2], ['throws', 0.6]]);
  const runner = g.chance(0.12);
  const result = {
    tokenId: g.pick(['tok_1', 'tok_2', 'b1f0c2d4-0000-4000-a000-000000000001']),
    urlKey: g.weighted([['acme', 6], ['har', 2], ['ünï-ws', 0.5], ['local-test', 0.5]]),
    label: runner ? null : g.pick(['ci', 'prompt-proxy', 'agent-prompt', null]),
    // read vs readWrite tokens (plus junk scopes)
    scope: g.weighted([['readWrite', 88], ['read', 9], ['admin', 1], [undefined, 1], ['READWRITE', 1]]),
    createdBy: g.weighted([['acct_1', 7], [null, 1], ['acct_2', 1]]),
    // runner copies carry server-resolved take+dispatch grants
    grants: runner ? ['take', 'dispatch'] : g.pick([[], ['dispatch'], undefined]),
    workspaceId: g.pick(['ws-acme', null, undefined]),
  };
  let authorization = 'Bearer tok-abc';
  if (mode === 'missing') authorization = undefined;
  if (mode === 'badscheme') authorization = 'Basic dXNlcjpwYXNz';
  if (mode === 'lower') authorization = 'bearer tok-abc';
  if (mode === 'empty') authorization = 'Bearer ';
  const descriptor = mode === 'rejected' && g.chance(0.6)
    ? { state: g.pick(['expired', 'consumed', 'revoked']), expiresAt: FIXED_NOW - 1000, urlKey: 'acme' }
    : null;
  return { mode: ['missing', 'badscheme', 'lower', 'empty'].includes(mode) ? 'ok' : mode, headerMode: mode, authorization, result, descriptor, runner };
}

/** resolveProviderAccess model input. */
export function genAccess(g, providerName) {
  const kind = g.weighted([['ok', 84], ['noToken', 8], ['throws', 2.5], ['structured', 4], ['emptyToken', 1]]);
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

export function genProviderBase(g) {
  const name = g.weighted([['linear', 6], ['jira', 1], ['github', 1], ['local', 1], ['fake', 0.5]]);
  const ui = g.weighted([[{ displayName: name === 'linear' ? 'Linear' : name[0].toUpperCase() + name.slice(1) }, 7], [null, 2], [{}, 1]]);
  return { name, ui, unsupported: [], methods: {} };
}

export function genRegistry(g) {
  return { suspect: g.chance(0.25), pastThreshold: g.chance(0.1), superseded: g.chance(0.1) };
}

/**
 * Wrap a request-body object in one of the encodings a real client can send.
 * Most requests are JSON; the rest exercise the global parsers
 * (express.urlencoded + express.json({limit:'250kb'}), server.js:975-976).
 */
export function encodeBody(g, value, { allowForm = true, rates = {} } = {}) {
  const r = {
    json: 84, charset: 2, form: allowForm ? 3 : 0, textJson: 2, malformed: 2.2, none: 1.5,
    oversized: 2.2, nullJson: 0.8, arrayJson: 0.6, ...rates,
  };
  const kind = g.weighted(Object.entries(r));
  switch (kind) {
    case 'json': return { kind: 'json', value };
    case 'charset': return { kind: 'json', value, contentType: 'application/json; charset=utf-8' };
    case 'form': {
      const pairs = [];
      for (const [k, v] of Object.entries(value || {})) {
        if (v === undefined) continue;
        pairs.push([k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)]);
      }
      return { kind: 'form', pairs };
    }
    case 'textJson': return { kind: 'text', text: JSON.stringify(value ?? {}), contentType: 'text/plain' };
    case 'malformed': return { kind: 'raw', text: g.pick(['{"title": ', '{bad json}', '{"a":1,}', 'ÿþ']), contentType: 'application/json' };
    case 'none': return { kind: 'none' };
    case 'oversized': return { kind: 'pad', value, padBytes: g.pick([260 * 1024, 400 * 1024]), contentType: 'application/json' };
    case 'nullJson': return { kind: 'raw', text: g.pick(['null', '"str"', '42']), contentType: 'application/json' };
    case 'arrayJson': return { kind: 'json', value: [value] };
    default: return { kind: 'json', value };
  }
}

export const enc = encodeURIComponent;

export function qs(pairs) {
  if (!pairs.length) return '';
  return '?' + pairs.map(([k, v, raw]) => raw ? `${k}=${v}` : `${enc(k)}=${enc(v)}`).join('&');
}

export function unknownPairs(g) {
  return g.chance(0.1) ? [g.pick([['foo', 'bar'], ['__proto__', 'x'], ['source', 'linear'], ['source', 'jira'], ['source', '']])] : [];
}

/** Optional path-shape variants: trailing slash, upper-case prefix. */
export function pathVariant(g, p) {
  if (!g.chance(0.02)) return p;
  const [a, q = ''] = p.split('?');
  return (g.chance(0.5) ? a + '/' : a.replace('/api/proxy/', '/API/Proxy/')) + (q ? '?' + q : '');
}
