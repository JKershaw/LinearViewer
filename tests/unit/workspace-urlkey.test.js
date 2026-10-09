/**
 * LIN-3382: the one-rule resolver, over fake stores with the REAL holder finder.
 * The key is a pure function of the provider's stable id; the resolver is
 * session -> derive -> live collision -> holder test, and refuses a taken key.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createResolverWorld, sessionWorkspace } from './lin-3382-resolver-harness.js';
import {
  deriveUrlKey, slugify, URLKEY_RETRY_TITLE, URLKEY_RETRY_MESSAGE, resolveKeyOrRespond
} from '../../lib/workspace-urlkey.js';
import { validateWorkspaceUrlKey } from '../../lib/workspace.js';
import { CONNECTION_RETRY_TITLE, CONNECTION_RETRY_MESSAGE } from '../../lib/connection-credential.js';

const ALICE = 'acct-alice';
const BOB = 'acct-bob';
const SITE = 'https://acme.atlassian.net';
const CLOUD = '11111111-2222-3333-4444-555555555555';
const JIRA_W = 'jira:ALICE-ATL';

const fresh = (world, { accountId = ALICE, slug = 'alice/foo', workspaces = [], identity } = {}) =>
  world.resolve({
    arm: 'github-fresh', provider: 'github', scope: slug,
    ids: { repoName: slug.split('/').pop() },
    session: world.session(accountId, workspaces), identity
  });
const jira = (world, { accountId = ALICE, W = JIRA_W, workspaces = [] } = {}) =>
  world.resolve({
    arm: 'jira', provider: 'jira', scope: SITE, workspaceId: W,
    ids: { cloudId: CLOUD }, session: world.session(accountId, workspaces)
  });
const linear = (world, { accountId = ALICE, org = 'org-1', key = 'acme', workspaces = [] } = {}) =>
  world.resolve({
    arm: 'linear', provider: 'linear', scope: org, workspaceId: org,
    ids: { orgKey: key }, session: world.session(accountId, workspaces)
  });
const container = (world, { accountId = ALICE, userId = 77, workspaces = [] } = {}) =>
  world.resolve({
    arm: 'github-container', provider: 'github', scope: 'alice/foo', workspaceId: `github:${userId}`,
    ids: { userId }, session: world.session(accountId, workspaces)
  });

const FOO = deriveUrlKey('github-fresh', { repoName: 'foo', provider: 'github', scope: 'alice/foo' });
const JIRA_KEY = deriveUrlKey('jira', { cloudId: CLOUD, workspaceId: JIRA_W });

describe('deriveUrlKey (the only naming rule)', () => {
  test('github-fresh is gh-<name>-<sha6(provider:scope)>: distinct per scope, valid, at most 50 characters', () => {
    assert.match(FOO, /^gh-foo-[0-9a-f]{6}$/);
    assert.notEqual(FOO, deriveUrlKey('github-fresh', { repoName: 'foo', provider: 'github', scope: 'alice-org/foo' }));
    // `foo.bar` and `foo-bar` slugify alike; the scope hash keeps them apart.
    assert.notEqual(
      deriveUrlKey('github-fresh', { repoName: 'foo.bar', provider: 'github', scope: 'a/foo.bar' }),
      deriveUrlKey('github-fresh', { repoName: 'foo-bar', provider: 'github', scope: 'a/foo-bar' })
    );
    const long = 'a'.repeat(60);
    const a = deriveUrlKey('github-fresh', { repoName: long, provider: 'github', scope: 'o1/' + long });
    const b = deriveUrlKey('github-fresh', { repoName: long, provider: 'github', scope: 'o2/' + long });
    for (const key of [a, b]) {
      assert.ok(key.length <= 50, key);
      assert.ok(validateWorkspaceUrlKey(key), key);
    }
    assert.notEqual(a, b);
  });

  test('it is deterministic: the same ids derive the same key every time', () => {
    const ids = { repoName: 'foo', provider: 'github', scope: 'alice/foo' };
    assert.equal(deriveUrlKey('github-fresh', ids), deriveUrlKey('github-fresh', { ...ids }));
    assert.equal(deriveUrlKey('jira', { cloudId: CLOUD, workspaceId: JIRA_W }), JIRA_KEY);
  });

  test('a symbol-only repo name falls back to "github"; the other arms', () => {
    assert.match(deriveUrlKey('github-fresh', { repoName: '___', provider: 'github', scope: 'o/___' }), /^gh-github-[0-9a-f]{6}$/);
    assert.equal(deriveUrlKey('github-container', { userId: 77 }), 'gh-77');
    assert.match(JIRA_KEY, new RegExp(`^jira-${CLOUD}-[0-9a-f]{6}$`));
    assert.ok(JIRA_KEY.length <= 50 && validateWorkspaceUrlKey(JIRA_KEY));
    assert.equal(deriveUrlKey('linear', { orgKey: 'Acme Org' }), 'Acme Org', 'Linear keeps org.urlKey || org.name untouched');
    assert.equal(deriveUrlKey('local', { name: 'My Space', randomHex: () => 'deadbeef' }), 'my-space-deadbeef');
    assert.equal(slugify('foo.js_bar'), 'foo-js-bar');
  });
});

describe('GitHub fresh (random id)', () => {
  test('a first-time bind gets the derived key', async () => {
    assert.deepEqual(await fresh(createResolverWorld()), { urlKey: FOO, source: 'derived' });
  });

  test('two accounts, same slug, different provider scopes -> different keys', async () => {
    const world = createResolverWorld();
    const a = await fresh(world, { accountId: ALICE, slug: 'alice/foo' });
    world.recordBind({ accountId: ALICE, urlKey: a.urlKey, provider: 'github', scope: 'alice/foo' });
    const b = await fresh(world, { accountId: BOB, slug: 'bob/foo' });
    assert.notEqual(a.urlKey, b.urlKey);
    assert.equal(b.refused, undefined);
  });

  test('a first-time bind of alice-org/foo never gets the bare `foo` another scope holds', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'c1', accountId: ALICE, referents: [{ urlKey: 'foo', provider: 'github', scope: 'alice/foo' }] }]
    });
    const r = await fresh(world, { slug: 'alice-org/foo' });
    assert.notEqual(r.urlKey, 'foo');
    assert.equal(r.urlKey, deriveUrlKey('github-fresh', { repoName: 'foo', provider: 'github', scope: 'alice-org/foo' }));
  });

  test('unbind, expire the session, rebind: the same key (and the binder is never refused its own key)', async () => {
    const world = createResolverWorld();
    const first = await fresh(world);
    world.recordBind({ accountId: ALICE, urlKey: first.urlKey, provider: 'github', scope: 'alice/foo' });
    const again = await fresh(world);
    assert.equal(again.urlKey, first.urlKey);
    assert.equal(again.refused, undefined);
  });

  test('a different account binding the same resource is refused, with no key and no fallback', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'c1', accountId: ALICE, referents: [{ urlKey: FOO, provider: 'github', scope: 'alice/foo' }] }]
    });
    const r = await fresh(world, { accountId: BOB, slug: 'alice/foo' });
    assert.deepEqual(r, { refused: { reason: 'foreign-holder' }, source: 'refused' });
  });

  test('the same repo twice in one session lands on the existing workspace', async () => {
    const r = await fresh(createResolverWorld(), {
      workspaces: [sessionWorkspace({ id: 'w1', urlKey: FOO, bindings: [{ provider: 'github', scope: 'alice/foo' }] })]
    });
    assert.deepEqual(r, { urlKey: FOO, source: 'session', landOnWorkspaceId: 'w1' });
  });

  test('a live workspace on the same repo under a legacy-shaped key is NOT landed on: the rule re-derives', async () => {
    const r = await fresh(createResolverWorld(), {
      workspaces: [sessionWorkspace({ id: 'w1', urlKey: 'tangle', bindings: [{ provider: 'github', scope: 'alice/foo' }] })]
    });
    assert.deepEqual(r, { urlKey: FOO, source: 'derived' });
  });

  test('a derived key live under another workspace id is refused own-conflict, with no hash fallback', async () => {
    const r = await fresh(createResolverWorld(), {
      workspaces: [sessionWorkspace({ id: 'w9', urlKey: FOO, bindings: [{ provider: 'github', scope: 'other/foo' }] })]
    });
    assert.deepEqual(r, { refused: { reason: 'own-conflict' }, source: 'refused' });
  });

  test('a merged account counts as the same binder', async () => {
    const world = createResolverWorld({
      mergedInto: { 'acct-alice-old': ALICE },
      referents: [{ _id: 'c1', accountId: 'acct-alice-old', referents: [{ urlKey: FOO, provider: 'github', scope: 'alice/foo' }] }]
    });
    assert.equal((await fresh(world)).urlKey, FOO);
  });

  test('the signing-in identity joins the binder set', async () => {
    const world = createResolverWorld({
      identities: [{ provider: 'github', scope: '77', accountId: 'acct-id' }],
      dispatchTokens: [{ urlKey: FOO, createdBy: 'acct-id' }]
    });
    const r = await fresh(world, { accountId: undefined, identity: { provider: 'github', scope: '77' } });
    assert.equal(r.urlKey, FOO);
  });
});

describe('GitHub account container (stable id)', () => {
  test('a first-time bind gets gh-<userId>', async () => {
    assert.deepEqual(await container(createResolverWorld()), { urlKey: 'gh-77', source: 'derived' });
  });

  test('unbind, expire the session, rebind: the same key', async () => {
    const world = createResolverWorld();
    const first = await container(world);
    world.recordBind({ accountId: ALICE, urlKey: first.urlKey, provider: 'github', scope: 'alice/foo', workspaceId: 'github:77' });
    assert.equal((await container(world)).urlKey, first.urlKey);
  });

  test('the container live under exactly the derived key is kept (source session)', async () => {
    const r = await container(createResolverWorld(), { workspaces: [sessionWorkspace({ id: 'github:77', urlKey: 'gh-77' })] });
    assert.deepEqual(r, { urlKey: 'gh-77', source: 'session' });
  });

  test('a container live under a legacy-shaped key is re-derived, not kept because it is "old"', async () => {
    const r = await container(createResolverWorld(), { workspaces: [sessionWorkspace({ id: 'github:77', urlKey: 'alice' })] });
    assert.deepEqual(r, { urlKey: 'gh-77', source: 'derived' });
  });

  test('another account holding gh-<userId> with no edge to the container is refused', async () => {
    const world = createResolverWorld({ dispatchTokens: [{ urlKey: 'gh-77', createdBy: BOB }] });
    assert.deepEqual((await container(world)).refused, { reason: 'foreign-holder' });
  });
});

describe('Jira (stable id, per Atlassian identity)', () => {
  test('a first-time bind gets jira-<cloudId>-<sha6(W)>', async () => {
    assert.deepEqual(await jira(createResolverWorld()), { urlKey: JIRA_KEY, source: 'derived' });
  });

  test('unbind, expire the session, rebind: the same key', async () => {
    const world = createResolverWorld();
    const first = await jira(world);
    world.recordBind({ accountId: ALICE, urlKey: first.urlKey, provider: 'jira', scope: SITE, workspaceId: JIRA_W });
    assert.equal((await jira(world)).urlKey, first.urlKey);
  });

  test('two identities on one site get distinct keys, and neither is refused', async () => {
    const world = createResolverWorld();
    const a = await jira(world);
    world.recordBind({ accountId: ALICE, urlKey: a.urlKey, provider: 'jira', scope: SITE, workspaceId: JIRA_W });
    const b = await jira(world, { accountId: BOB, W: 'jira:BOB-ATL' });
    assert.notEqual(a.urlKey, b.urlKey);
    assert.equal(b.refused, undefined);
  });

  test('a teammate (edge to W) is not refused; an account with no edge is', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'j', accountId: ALICE, referents: [{ urlKey: JIRA_KEY, provider: 'jira', scope: SITE }] }],
      edges: [{ accountId: ALICE, workspaceId: JIRA_W }, { accountId: BOB, workspaceId: JIRA_W }]
    });
    assert.equal((await jira(world, { accountId: BOB })).urlKey, JIRA_KEY);
    const stranger = createResolverWorld({ dispatchTokens: [{ urlKey: JIRA_KEY, createdBy: ALICE }] });
    assert.deepEqual((await jira(stranger, { accountId: BOB })).refused, { reason: 'foreign-holder' });
  });

  test('a container live under a legacy tenant key is re-derived', async () => {
    const r = await jira(createResolverWorld(), { workspaces: [sessionWorkspace({ id: JIRA_W, urlKey: 'immersify' })] });
    assert.deepEqual(r, { urlKey: JIRA_KEY, source: 'derived' });
  });

  test('the container live under exactly the derived key is kept', async () => {
    const r = await jira(createResolverWorld(), { workspaces: [sessionWorkspace({ id: JIRA_W, urlKey: JIRA_KEY })] });
    assert.deepEqual(r, { urlKey: JIRA_KEY, source: 'session' });
  });
});

describe('Linear (stable id = org id; the org keeps its own key)', () => {
  test('a first-time bind gets the org key', async () => {
    assert.deepEqual(await linear(createResolverWorld()), { urlKey: 'acme', source: 'derived' });
  });

  test('a second member of the same org (edge to org.id) shares the workspace; the first is not refused', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'l', accountId: ALICE, referents: [{ urlKey: 'acme', provider: 'linear', scope: 'org-1' }] }],
      edges: [{ accountId: ALICE, workspaceId: 'org-1' }, { accountId: BOB, workspaceId: 'org-1' }]
    });
    assert.equal((await linear(world, { accountId: BOB })).urlKey, 'acme');
    assert.equal((await linear(world, { accountId: ALICE })).urlKey, 'acme');
  });

  test('a key another account holds, with no edge to the org -> foreign-holder', async () => {
    const world = createResolverWorld({ dispatchTokens: [{ urlKey: 'acme', createdBy: BOB }] });
    assert.deepEqual((await linear(world)).refused, { reason: 'foreign-holder' });
  });

  test('the key live under another workspace id of the session -> own-conflict, no key', async () => {
    const r = await linear(createResolverWorld(), { workspaces: [sessionWorkspace({ id: 'jira:A1', urlKey: 'acme' })] });
    assert.deepEqual(r, { refused: { reason: 'own-conflict' }, source: 'refused' });
  });

  test('the org live under its own key is kept; under a stale key it takes the org key now', async () => {
    assert.equal((await linear(createResolverWorld(), { workspaces: [sessionWorkspace({ id: 'org-1', urlKey: 'acme' })] })).source, 'session');
    const renamed = await linear(createResolverWorld(), { key: 'acme-new', workspaces: [sessionWorkspace({ id: 'org-1', urlKey: 'acme' })] });
    assert.deepEqual(renamed, { urlKey: 'acme-new', source: 'derived' });
  });
});

describe('Local', () => {
  test('re-rolls on a live key or any holder', async () => {
    const world = createResolverWorld({ dispatchTokens: [{ urlKey: 'ws-00000001', createdBy: BOB }] });
    const hexes = ['00000001', '00000002', '00000003'];
    const r = await world.resolve({
      arm: 'local', provider: 'local',
      ids: { name: 'ws', randomHex: () => hexes.shift() },
      session: world.session(ALICE, [sessionWorkspace({ id: 'x', urlKey: 'ws-00000002' })])
    });
    assert.equal(r.urlKey, 'ws-00000003');
  });
});

describe('invariants', () => {
  test('never returns a key that is live under another workspace id, on any arm', async () => {
    const live = key => [sessionWorkspace({ id: 'other', urlKey: key })];
    const cases = [
      [FOO, () => fresh(createResolverWorld(), { workspaces: live(FOO) })],
      ['gh-77', () => container(createResolverWorld(), { workspaces: live('gh-77') })],
      [JIRA_KEY, () => jira(createResolverWorld(), { workspaces: live(JIRA_KEY) })],
      ['acme', () => linear(createResolverWorld(), { workspaces: live('acme') })]
    ];
    for (const [liveKey, run] of cases) {
      const r = await run();
      assert.notEqual(r.urlKey, liveKey, `returned a key live under another id: ${liveKey}`);
      assert.deepEqual(r.refused, { reason: 'own-conflict' });
    }
  });

  test('one holder read per resolve for one key', async () => {
    const world = createResolverWorld();
    await jira(world);
    assert.deepEqual(world.evidenceReads, [[JIRA_KEY]]);
    await fresh(world);
    assert.equal(world.evidenceReads.length, 2);
  });

  test('a store that throws makes the resolver throw; the finder is strict', async () => {
    const world = createResolverWorld();
    world.failStores = true;
    await assert.rejects(() => fresh(world), /store down/);
    await assert.rejects(() => jira(world), /store down/);
    await assert.rejects(() => linear(world), /store down/);
    assert.ok(world.strictFlags.every(Boolean), 'every holder read at bind time was strict');
  });

  test('(v) the retry copy equals CONNECTION_RETRY_*', () => {
    assert.equal(URLKEY_RETRY_TITLE, CONNECTION_RETRY_TITLE);
    assert.equal(URLKEY_RETRY_MESSAGE, CONNECTION_RETRY_MESSAGE);
  });

  test('source files obey D6/D15: no connection-store import, no readConnection*, no .credentials', () => {
    for (const file of ['lib/workspace-urlkey.js', 'lib/urlkey-holders.js']) {
      const text = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.ok(!/connection-store/.test(code), `${file} imports no connection store`);
      assert.ok(!/readConnection[A-Z]/.test(code), `${file} calls no readConnection*`);
      assert.ok(!/\.credentials\b/.test(code), `${file} reads no .credentials`);
    }
  });

  test('the resolver module does not regrow legacy-key recovery (the deletion class)', () => {
    const text = fs.readFileSync(new URL('../../lib/workspace-urlkey.js', import.meta.url), 'utf8');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['suffixed', 'findEvidence', 'listHolderRowsByWorkspaceId', 'ambiguous', 'PROVIDER_FAMILIES', 'LEGACY_SUFFIX_MAX']) {
      assert.ok(!code.includes(banned), `workspace-urlkey.js must not contain ${banned}`);
    }
  });
});

describe('resolveKeyOrRespond (the shared fail-closed / refusal seam)', () => {
  const fakeRes = () => {
    const res = { sent: null, status(code) { res.code = code; return res; }, send(body) { res.sent = body; return res; } };
    return res;
  };
  const renderPage = (title, message) => `${title}|${message}`;
  const base = { renderPage, arm: 'test', retry: { action: 'Try again', actionUrl: '/' } };

  test('a missing resolver answers 503 and returns null', async () => {
    const res = fakeRes();
    assert.equal(await resolveKeyOrRespond({ ...base, res, request: {} }), null);
    assert.equal(res.code, 503);
    assert.match(res.sent, /Connection Not Saved/);
  });

  test('a throwing resolver answers 503; beforeRespond runs first', async () => {
    const res = fakeRes();
    let ran = false;
    assert.equal(await resolveKeyOrRespond({ ...base, res, request: {}, resolve: async () => { throw new Error('x'); }, beforeRespond: () => { ran = true; } }), null);
    assert.equal(res.code, 503);
    assert.ok(ran);
  });

  test('a refusal answers 409 with the right copy and does not name the key', async () => {
    const foreign = fakeRes();
    await resolveKeyOrRespond({ ...base, res: foreign, request: {}, resolve: async () => ({ refused: { reason: 'foreign-holder' }, source: 'refused' }) });
    assert.equal(foreign.code, 409);
    assert.match(foreign.sent, /contact support/);
    const own = fakeRes();
    await resolveKeyOrRespond({ ...base, res: own, request: {}, resolve: async () => ({ refused: { reason: 'own-conflict' }, source: 'refused' }) });
    assert.match(own.sent, /Another connection on your account/);
    assert.notEqual(own.sent, foreign.sent);
  });

  test('a key passes through untouched', async () => {
    const res = fakeRes();
    const out = await resolveKeyOrRespond({ ...base, res, request: {}, resolve: async () => ({ urlKey: 'k', source: 'derived' }) });
    assert.deepEqual(out, { urlKey: 'k', source: 'derived' });
    assert.equal(res.sent, null);
  });
});
