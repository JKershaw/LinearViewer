/**
 * LIN-2354 — `GET /api/proxy/instructions` (the agent's primary reference
 * document, and what every dispatched worker is pointed at) asserted "this
 * workspace is currently backed by Linear" unconditionally, and two nearby
 * notes (the priority native-scale mapping, the markdown backslash-escaping
 * quirk) were Linear-specific facts served verbatim to every provider. This
 * route previously did zero IO; resolving provider identity is its first, so
 * these also cover the reliability requirement: a resolution failure must
 * degrade to the neutral wording, never a 5xx.
 *
 * Reuses the documented LIN-581 `injectedProvider` seam and the
 * buildApp/call harness from tests/unit/lin-2353-proxy-provider-ui-threading.test.js.
 *
 * The residual-`\bLinear\b` count is an insufficient acceptance signal here
 * (a blanket rename would zero it out while asserting "GitHub's NATIVE
 * scale" — false, since GitHub refuses `priority` outright). These assert
 * three properties instead: (1) discrimination — the resolved provider is
 * named, and the Linear-only claims are ABSENT, not renamed; (2) Linear
 * byte-parity with a non-vacuity guard; (3) an unresolved provider renders
 * the neutral form, never guessing Linear.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import '../../lib/providers/github/index.js'; // side effect: self-registers 'github'
import '../../lib/providers/local/index.js'; // side effect: self-registers 'local'

function buildApp({ providerName, resolveWorkspaceAccessImpl, injectProvider = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: resolveWorkspaceAccessImpl
      || (async () => ({ token: 'test-token', reason: 'ok', provider: providerName })),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { addItem: async () => ({}) },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: injectProvider
  }));
  return app;
}

async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer anything' }
    });
    const text = await res.text();
    // Normalize the ephemeral test-server port out of every embedded baseUrl —
    // each `listen(0, ...)` call gets a different port, which would otherwise
    // make two responses "differ" for a reason having nothing to do with
    // provider identity (a false non-vacuity signal).
    return { status: res.status, text: text.replaceAll(`127.0.0.1:${port}`, '127.0.0.1:PORT') };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('GET /api/proxy/instructions — provider identity (LIN-2354)', () => {
  describe('discrimination — positive: names the resolved provider; negative: Linear-only claims absent, not renamed', () => {
    // Note: a "no residual Linear anywhere" blanket check is deliberately NOT
    // asserted here — one attributed mention survives by design, the
    // "(Linear: 4 = Urgent)" worked example inside the provider-neutral
    // `priorityLevel` canonical-scale sentence (kept for every provider, not
    // conditioned — see the source comment at routes/proxy.js). It never
    // claims the CURRENT workspace is Linear-backed, so it is not the defect
    // this ticket fixes; the targeted assertions below are the real gate.
    test('a github-backed workspace', async () => {
      const app = buildApp({ providerName: 'github' });
      const { status, text } = await call(app, '/api/proxy/instructions');

      assert.equal(status, 200);
      assert.ok(text.includes('this workspace is currently backed by GitHub Issues.'),
        'positively names the resolved provider');
      assert.ok(!text.includes('Linear\'s NATIVE scale'),
        'the Linear-only priority-scale claim is ABSENT, not renamed to "GitHub Issues\'s NATIVE scale"');
      assert.ok(!/GitHub(?: Issues)? stores markdown/.test(text),
        'the Linear-only markdown-escaping claim is not renamed onto GitHub either');
      assert.ok(!text.includes('GitHub stores markdown'), 'markdown-escaping claim not renamed');
      assert.ok(!text.includes('backed by Linear'), 'the identity clause never names Linear for a GitHub workspace');
    });

    test('a local-backed workspace', async () => {
      const app = buildApp({ providerName: 'local' });
      const { status, text } = await call(app, '/api/proxy/instructions');

      assert.equal(status, 200);
      assert.ok(text.includes('this workspace is currently backed by Local.'));
      assert.ok(!text.includes('backed by Linear'), 'the identity clause never names Linear for a Local workspace');
      assert.ok(!text.includes('Linear\'s NATIVE scale'), 'the priority-scale claim is absent for Local too');
    });

    test('the field-support tables (create-refuses / patch-drops) are untouched by the conditioning', async () => {
      const { text } = await call(buildApp({ providerName: 'github' }), '/api/proxy/instructions');
      assert.ok(text.includes('GitHub-backed: no teamId/stateId/assigneeId/priority/priorityLevel/cycleId/parentId'),
        'the create-refuses enumeration for GitHub stays intact (LIN-2352 adds teamId to it)');
      assert.ok(text.includes('GitHub-backed: priority/priorityLevel/assigneeId/parentId/cycleId are dropped'),
        'the patch-drops enumeration for GitHub stays intact');
    });
  });

  // LIN-2352 plan-review Finding 1 (BLOCKER): the POST /api/proxy/issues
  // symbolic-refs sentence conditioned teamId/stateId/projectId as one
  // group on `requiresTeam`. That is correct for teamId (a teamless
  // provider 400s on any explicit value) but false for stateId/projectId:
  // this PR's own e2e coverage proves symbolic stateId resolves on a
  // teamless (Local-backed) create, just without team-scoping. Neither
  // branch of `teamRequirementNote` (nor the split it renders) was
  // asserted anywhere before this — the coverage hole the review named.
  describe('POST /api/proxy/issues symbolic-refs split (LIN-2352 review Finding 1)', () => {
    test('a teamless (GitHub-backed) workspace keeps the teamless teamId policy but still documents symbolic stateId/projectId', async () => {
      const { text } = await call(buildApp({ providerName: 'github' }), '/api/proxy/instructions');

      assert.ok(
        text.includes('teamId is required only when your workspace\'s provider declares team support; an explicit value on a provider that doesn\'t is refused with 400.'),
        'teamless branch keeps stating the conditional-refusal teamId policy'
      );
      assert.ok(
        !text.includes('teamId accepts a team key'),
        'a teamless provider never claims teamId accepts a symbolic ref — it refuses any explicit teamId with 400'
      );
      assert.ok(
        text.includes('stateId/projectId accept symbolic refs, not just UUIDs'),
        'symbolic stateId/projectId support is documented unconditionally, not gated on team support'
      );
      assert.ok(
        !/stateId as a keyword \([^)]*\) or state name, scoped to the team you pass/.test(text),
        'a teamless provider must not claim team-scoped state resolution'
      );
      assert.ok(
        !text.includes('On a provider that requires it'),
        'the teamless branch never qualifies symbolic stateId/projectId support on team support'
      );
      assert.ok(
        !text.includes('teamId/stateId/projectId accept symbolic refs'),
        'teamId is split OUT of the symbolic-refs group — an unanchored includes() cannot see this'
      );
    });

    test('a teamless (Local-backed) workspace keeps the teamless teamId policy but still documents symbolic stateId/projectId', async () => {
      const { text } = await call(buildApp({ providerName: 'local' }), '/api/proxy/instructions');

      assert.ok(
        text.includes('teamId is required only when your workspace\'s provider declares team support; an explicit value on a provider that doesn\'t is refused with 400.')
      );
      assert.ok(!text.includes('teamId accepts a team key'));
      assert.ok(text.includes('stateId/projectId accept symbolic refs, not just UUIDs'));
      assert.ok(!/stateId as a keyword \([^)]*\) or state name, scoped to the team you pass/.test(text));
      assert.ok(
        !text.includes('On a provider that requires it'),
        'the teamless branch never qualifies symbolic stateId/projectId support on team support'
      );
      assert.ok(
        !text.includes('teamId/stateId/projectId accept symbolic refs'),
        'teamId is split OUT of the symbolic-refs group — an unanchored includes() cannot see this'
      );
    });

    test('a team-requiring (Linear-backed) workspace documents symbolic teamId support and team-scoped state resolution', async () => {
      const { text } = await call(buildApp({ providerName: 'linear' }), '/api/proxy/instructions');

      assert.ok(
        text.includes('teamId is required for this workspace.'),
        'team-requiring branch states teamId is required'
      );
      assert.ok(
        text.includes('teamId accepts a team key (e.g. LIN) or name as well as a UUID.'),
        'team-requiring branch documents symbolic teamId support'
      );
      assert.ok(
        /stateId as a keyword \([^)]*\) or state name, scoped to the team you pass/.test(text),
        'team-requiring branch documents state resolution as scoped to the team you pass'
      );
    });
  });

  describe('Linear byte-parity — non-vacuity guard', () => {
    test('a linear-backed workspace still names Linear and keeps the priority-scale/markdown notes', async () => {
      const app = buildApp({ providerName: 'linear' });
      const { status, text } = await call(app, '/api/proxy/instructions');

      assert.equal(status, 200);
      assert.ok(text.includes('this workspace is currently backed by Linear.'));
      assert.ok(text.includes('"priority" is Linear\'s NATIVE scale'));
      assert.ok(text.includes('Linear stores markdown punctuation backslash-escaped'));
    });

    test('the probe is not vacuous: a github-backed workspace genuinely differs', async () => {
      const linear = await call(buildApp({ providerName: 'linear' }), '/api/proxy/instructions');
      const github = await call(buildApp({ providerName: 'github' }), '/api/proxy/instructions');
      assert.notEqual(linear.text, github.text, 'if these matched, the parity assertion would prove nothing');
    });
  });

  describe('unresolved provider — T1: never guess Linear, and the route must not become fragile', () => {
    test('resolveWorkspaceAccess returning provider: null renders the neutral form', async () => {
      const app = buildApp({ resolveWorkspaceAccessImpl: async () => ({ token: 'test-token', reason: 'ok', provider: null }) });
      const { status, text } = await call(app, '/api/proxy/instructions');

      assert.equal(status, 200);
      assert.ok(text.includes('one contract across providers.'), 'the clause is dropped entirely (period right after "providers")');
      assert.ok(!text.includes('currently backed by'), 'no backing-provider claim at all when unresolved');
      assert.ok(!text.includes('backed by Linear'), 'never guesses Linear for an unresolved identity — the exact defect this fixes');
      assert.ok(!text.includes('Linear\'s NATIVE scale'), 'the Linear-only priority-scale claim is absent when unresolved too');
    });

    test('a resolveWorkspaceAccess/resolveProviderAccess failure degrades to the neutral form, never a 5xx', async () => {
      const app = buildApp({ resolveWorkspaceAccessImpl: async () => { throw new Error('store unreachable'); } });
      const { status, text } = await call(app, '/api/proxy/instructions');

      assert.equal(status, 200, 'this route must stay the one an agent can always fetch');
      assert.ok(text.includes('one contract across providers.'));
      assert.ok(!text.includes('currently backed by'));
      assert.ok(!text.includes('backed by Linear'));
    });

    test('a no-token resolution (workspace credential unresolved) also stays neutral, not a 5xx', async () => {
      const app = buildApp({ resolveWorkspaceAccessImpl: async () => ({ token: null, reason: 'not_connected', provider: null }) });
      const { status, text } = await call(app, '/api/proxy/instructions');

      assert.equal(status, 200);
      assert.ok(!text.includes('currently backed by'));
      assert.ok(!text.includes('backed by Linear'));
    });
  });
});
