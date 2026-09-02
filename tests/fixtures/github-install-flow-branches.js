/**
 * LIN-2397 stage A — the branch matrix + driver for the byte-parity golden
 * harness over the two GitHub App install-flow routers
 * (routes/github-auth.js, routes/github-projects-auth.js).
 *
 * Shared by:
 *   - a one-off (uncommitted) generator that captures
 *     tests/fixtures/github-install-flow-golden.json on `main`
 *   - tests/unit/github-install-flow-golden.test.js, which re-runs the SAME
 *     branches against the SAME real routers and asserts byte-for-byte
 *     equality against that fixture.
 *
 * Each branch is `{ key, method, path, build() -> { req, session } }`. `build`
 * returns a fresh request/session pair (never shared/mutated across branches).
 * `descriptor` carries the ~13 mechanical substitutions between the two
 * routers (§1c of the LIN-2397 research comment) so one branch list drives
 * both surfaces.
 */
import assert from 'node:assert';

export function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

export function makeRes() {
  return {
    statusCode: 200,
    body: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    send(html) { this.body = html; return this; },
    redirect(url) { this.redirectedTo = url; return this; },
  };
}

export function makeSession(initial = {}) {
  const session = {
    ...initial,
    save(cb) { if (cb) cb(); },
    regenerate(cb) {
      for (const k of Object.keys(this)) {
        if (typeof this[k] !== 'function') delete this[k];
      }
      cb();
    },
  };
  return session;
}

// The ONE non-deterministic byte in these responses: githubErrorDiagnostic's
// `time` field defaults to `new Date().toISOString()`, captured live at call
// time (lib/errors.js). Normalize it to a fixed placeholder so the golden
// comparison is still byte-for-byte on everything else. This is the single
// documented exception to "byte-for-byte" in this harness.
export function normalizeBody(body) {
  if (typeof body !== 'string') return body;
  return body.replace(
    /<span class="error-detail-value">\d{4}-\d{2}-\d{2}T[0-9:.]+Z<\/span>/g,
    '<span class="error-detail-value">[TIME]</span>'
  );
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// `begin`'s authorize-URL redirect carries the freshly minted CSRF nonce
// (`crypto.randomUUID()`), the harness's second and only other
// non-deterministic byte. Normalized the same way as the diagnostic `time`.
export function normalizeRedirect(url) {
  if (typeof url !== 'string') return url;
  return url.replace(UUID_RE, '[STATE]');
}

export async function runBranch(router, branch) {
  const handler = getHandler(router, branch.method, branch.path);
  const res = makeRes();
  const { req, session } = branch.build();
  await handler({ ...req, session }, res);
  return {
    statusCode: res.statusCode,
    body: normalizeBody(res.body),
    redirectedTo: normalizeRedirect(res.redirectedTo),
  };
}

/**
 * @param {Object} d - descriptor for one router surface.
 * @param {Function} d.freshAccountStores - () => { accountStore, accountWorkspaceStore }
 * @param {Function} d.baseFakeProvider - () => fake provider object (the two
 *   test files' existing `fakeProvider()`)
 */
export function buildBranches(d) {
  const P = () => d.baseFakeProvider();
  const begin = d.basePath;
  const callback = `${d.basePath}/callback`;
  const link = `${d.basePath}/link`;

  return [
    // --- begin ---------------------------------------------------------
    {
      key: 'begin:not-configured',
      method: 'get', path: begin,
      build: () => ({ req: { query: {} }, session: makeSession() }),
      provider: P, notConfigured: true,
    },
    {
      key: 'begin:mode-absent-defaults-new',
      method: 'get', path: begin,
      build: () => ({ req: { query: {} }, session: makeSession() }),
      provider: P,
    },
    {
      key: 'begin:mode-add-source-with-workspace',
      method: 'get', path: begin,
      build: () => ({ req: { query: { mode: 'add-source', workspace: 'acme' } }, session: makeSession() }),
      provider: P,
    },
    {
      key: 'begin:mode-add-source-malformed-workspace-ignored',
      method: 'get', path: begin,
      build: () => ({ req: { query: { mode: 'add-source', workspace: 'not a valid key!' } }, session: makeSession() }),
      provider: P,
    },
    {
      key: 'begin:beginAuth-throws',
      method: 'get', path: begin,
      build: () => ({ req: { query: {} }, session: makeSession() }),
      provider: () => ({ ...P(), beginAuth: () => { throw new Error('boom from beginAuth'); } }),
    },

    // --- callback: config gate + error/CSRF -----------------------------
    {
      key: 'callback:not-configured',
      method: 'get', path: callback,
      build: () => ({ req: { query: {} }, session: makeSession() }),
      provider: P, notConfigured: true,
    },
    {
      key: 'callback:error-access-denied',
      method: 'get', path: callback,
      build: () => ({ req: { query: { error: 'access_denied' } }, session: makeSession() }),
      provider: P,
    },
    {
      key: 'callback:error-other',
      method: 'get', path: callback,
      build: () => ({ req: { query: { error: 'server_error' } }, session: makeSession() }),
      provider: P,
    },
    {
      key: 'callback:missing-state',
      method: 'get', path: callback,
      build: () => ({ req: { query: { installation_id: '42' } }, session: makeSession({ oauthState: 'real' }) }),
      provider: P,
    },
    {
      key: 'callback:mismatched-state-install-path',
      method: 'get', path: callback,
      build: () => ({ req: { query: { installation_id: '42', state: 'attacker' } }, session: makeSession({ oauthState: 'real' }) }),
      provider: P,
    },
    {
      key: 'callback:mismatched-state-code-path',
      method: 'get', path: callback,
      build: () => ({ req: { query: { code: 'oauth-code', state: 'attacker' } }, session: makeSession({ oauthState: 'real' }) }),
      provider: P,
    },

    // --- callback: OAuth-code (re-bind) branch --------------------------
    {
      key: 'callback:code-completeAuth-fails',
      method: 'get', path: callback,
      build: () => ({ req: { query: { code: 'bad', state: 'real' } }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } }) }),
      provider: P,
    },
    {
      key: 'callback:code-fetchViewer-fails',
      method: 'get', path: callback,
      build: () => ({ req: { query: { code: 'oauth-code', state: 'real' } }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } }) }),
      provider: () => ({ ...P(), fetchViewer: async () => { throw new Error('viewer lookup failed'); } }),
    },
    {
      key: 'callback:code-listReboundable-fails',
      method: 'get', path: callback,
      build: () => ({ req: { query: { code: 'oauth-code', state: 'real' } }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } }) }),
      provider: () => ({ ...P(), [d.listReboundableMethod]: async () => { throw new Error('boom'); } }),
    },
    {
      key: 'callback:code-no-reboundable-redirects-to-install',
      method: 'get', path: callback,
      build: () => ({ req: { query: { code: 'oauth-code', state: 'real' } }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } }) }),
      provider: () => ({ ...P(), [d.listReboundableMethod]: async () => [] }),
    },
    {
      key: 'callback:code-beginInstall-throws',
      method: 'get', path: callback,
      build: () => ({ req: { query: { code: 'oauth-code', state: 'real' } }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } }) }),
      provider: () => ({ ...P(), [d.listReboundableMethod]: async () => [], beginInstall: () => { throw new Error("shape-invalid key"); } }),
    },
    {
      key: 'callback:code-reboundable-found-renders-picker',
      method: 'get', path: callback,
      build: () => ({ req: { query: { code: 'oauth-code', state: 'real' } }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'add-source', provider: d.providerName, workspaceUrlKey: 'acme' } }) }),
      provider: P,
    },

    // --- callback: installation_id present/absent -----------------------
    {
      key: 'callback:installationId-missing-setup-request',
      method: 'get', path: callback,
      build: () => ({ req: { query: { setup_action: 'request', state: 'real' } }, session: makeSession({ oauthState: 'real' }) }),
      provider: P,
    },
    {
      key: 'callback:installationId-missing-other',
      method: 'get', path: callback,
      build: () => ({ req: { query: { state: 'real' } }, session: makeSession({ oauthState: 'real' }) }),
      provider: P,
    },
    {
      key: 'callback:install-completeInstallation-fails',
      method: 'get', path: callback,
      build: () => ({ req: { query: { installation_id: 'bad', state: 'real' } }, session: makeSession({ oauthState: 'real' }) }),
      provider: P,
    },
    {
      key: 'callback:install-listChoices-fails',
      method: 'get', path: callback,
      build: () => ({ req: { query: { installation_id: '99', state: 'real' } }, session: makeSession({ oauthState: 'real' }) }),
      provider: () => ({ ...P(), [d.listChoicesMethod]: async () => { throw new Error('boom'); } }),
    },
    {
      key: 'callback:install-success-renders-picker',
      method: 'get', path: callback,
      build: () => ({ req: { query: { installation_id: '99', setup_action: 'install', state: 'real' } }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: d.providerName } }) }),
      provider: P,
    },
    {
      key: 'callback:install-outer-catch',
      method: 'get', path: callback,
      build: () => {
        const session = makeSession({ oauthState: 'real' });
        session.save = () => { throw new Error('session store unavailable'); };
        return { req: { query: { installation_id: '99', state: 'real' } }, session };
      },
      provider: P,
    },

    // --- link ------------------------------------------------------------
    {
      key: 'link:no-pending',
      method: 'post', path: link,
      build: () => ({ req: { body: { [d.bodyField]: d.goodSlug } }, session: makeSession() }),
      provider: P,
    },
    {
      key: 'link:invalid-slug',
      method: 'post', path: link,
      build: () => ({ req: { body: { [d.bodyField]: 'not-a-valid-slug' } }, session: makeSession({ githubHumanId: 'human-42', [d.pendingKey]: { token: 'tok', mode: 'new', login: 'octocat', userId: '42' }, workspaces: [] }) }),
      provider: P,
    },
    {
      key: 'link:rebind-slug-not-in-map',
      method: 'post', path: link,
      build: () => ({
        req: { body: { [d.bodyField]: d.notEnumeratedSlug } },
        session: makeSession({ githubHumanId: 'human-42', [d.pendingKey]: { rebind: true, mode: 'new', [d.rebindMapKey]: { [d.goodSlug]: '77' } }, workspaces: [] }),
      }),
      provider: P,
    },
    {
      key: 'link:add-source-no-workspace',
      method: 'post', path: link,
      build: () => ({
        req: { body: { [d.bodyField]: d.goodSlug } },
        session: makeSession({ githubHumanId: 'human-42', [d.pendingKey]: { token: 'tok', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' }, workspaces: [] }),
      }),
      provider: P,
    },
    {
      key: 'link:add-source-success',
      method: 'post', path: link,
      build: () => ({
        req: { body: { [d.bodyField]: d.goodSlug } },
        session: makeSession({
          githubHumanId: 'human-42',
          [d.pendingKey]: { token: 'tok', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
          workspaces: [{ id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' }],
          activeWorkspaceId: 'org-1',
        }),
      }),
      provider: P,
    },
    {
      key: 'link:new-existing-success',
      method: 'post', path: link,
      build: () => ({
        req: { body: { [d.bodyField]: d.goodSlug } },
        session: makeSession({
          githubHumanId: 'human-42',
          [d.pendingKey]: { token: 'tok', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
          workspaces: [{ id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: d.providerName, bindings: [] }],
        }),
      }),
      provider: P,
    },
    {
      key: 'link:new-fresh-workspace-limit',
      method: 'post', path: link,
      build: () => ({
        req: { body: { [d.bodyField]: d.goodSlug } },
        session: makeSession({
          githubHumanId: 'human-42',
          [d.pendingKey]: { token: 'tok', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
          workspaces: Array.from({ length: 10 }, (_, i) => ({ id: `ws-${i}`, name: `Workspace ${i}`, urlKey: `ws-${i}` })),
        }),
      }),
      provider: P,
    },
    {
      key: 'link:new-fresh-regenerate-error',
      method: 'post', path: link,
      build: () => {
        const session = makeSession({
          githubHumanId: 'human-42',
          [d.pendingKey]: { token: 'tok', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
          workspaces: [],
        });
        session.regenerate = (cb) => cb(new Error('regenerate boom'));
        return { req: { body: { [d.bodyField]: d.goodSlug } }, session };
      },
      provider: P,
    },
    {
      key: 'link:new-fresh-success',
      method: 'post', path: link,
      build: () => ({
        req: { body: { [d.bodyField]: d.goodSlug } },
        session: makeSession({
          githubHumanId: 'human-42',
          [d.pendingKey]: { token: 'tok', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
          workspaces: [],
        }),
      }),
      provider: P,
    },
    {
      key: 'link:new-fresh-outer-catch-post-regenerate',
      method: 'post', path: link,
      build: () => ({
        req: { body: { [d.bodyField]: d.goodSlug } },
        session: makeSession({
          githubHumanId: 'human-42',
          [d.pendingKey]: { token: 'tok', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
          workspaces: [],
        }),
      }),
      provider: P,
      userPreferencesStore: { getUserPreferences: async () => { throw new Error('prefs store down'); } },
    },
    {
      key: 'link:pre-regenerate-outer-catch-missing-expiry',
      method: 'post', path: link,
      build: () => ({
        req: { body: { [d.bodyField]: d.goodSlug } },
        session: makeSession({
          githubHumanId: 'human-42',
          [d.pendingKey]: { token: 'tok', mode: 'new', login: 'octocat', userId: '42', installationId: '99' },
          workspaces: [],
        }),
      }),
      provider: P,
    },
  ];
}
