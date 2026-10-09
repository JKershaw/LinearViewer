/**
 * LIN-3382 PR-A: the resolver, over fake stores with the REAL holder finder.
 * These are the plan's spike scenarios kept as permanent tests, plus the
 * round-3 findings (F1 Jira, F2 Linear) as the FC bound them.
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

const fresh = (world, { accountId = ALICE, slug = 'alice/foo', installationId = '100', workspaces = [], identity } = {}) =>
  world.resolve({
    arm: 'github-fresh', provider: 'github', scope: slug,
    ids: { repoName: slug.split('/').pop(), installationId },
    session: world.session(accountId, workspaces), identity
  });
const jira = (world, { accountId = ALICE, W = 'jira:ALICE-ATL', workspaces = [], tenant = 'acme' } = {}) =>
  world.resolve({
    arm: 'jira', provider: 'jira', scope: SITE, workspaceId: W,
    ids: { tenant, cloudId: CLOUD }, session: world.session(accountId, workspaces)
  });
const linear = (world, { accountId = ALICE, org = 'org-1', key = 'acme', workspaces = [] } = {}) =>
  world.resolve({
    arm: 'linear', provider: 'linear', scope: org, workspaceId: org,
    ids: { orgKey: key }, session: world.session(accountId, workspaces)
  });
const container = (world, { accountId = ALICE, userId = 77, login = 'alice', workspaces = [] } = {}) =>
  world.resolve({
    arm: 'github-container', provider: 'github', scope: 'alice/foo', workspaceId: `github:${userId}`,
    ids: { userId, login }, session: world.session(accountId, workspaces)
  });

describe('deriveUrlKey', () => {
  test('github-fresh is id-bearing and distinct per installation', () => {
    assert.equal(deriveUrlKey('github-fresh', { repoName: 'foo', installationId: '100', scope: 'alice/foo' }), 'gh-foo-100');
    assert.notEqual(
      deriveUrlKey('github-fresh', { repoName: 'foo', installationId: '100', scope: 'alice/foo' }),
      deriveUrlKey('github-fresh', { repoName: 'foo', installationId: '200', scope: 'alice-org/foo' })
    );
  });

  test('long names stay valid, at most 50 characters, and distinct', () => {
    const long = 'a'.repeat(60);
    const a = deriveUrlKey('github-fresh', { repoName: long, installationId: '1234567', scope: 'o1/' + long });
    const b = deriveUrlKey('github-fresh', { repoName: long, installationId: '1234567', scope: 'o2/' + long });
    for (const key of [a, b]) {
      assert.ok(key.length <= 50, key);
      assert.ok(validateWorkspaceUrlKey(key), key);
    }
    assert.notEqual(a, b, 'a 6-hex scope hash keeps overflowed keys distinct');
  });

  test('a symbol-only repo name falls back to "github"; other arms', () => {
    assert.equal(deriveUrlKey('github-fresh', { repoName: '___', installationId: '9', scope: 'o/___' }), 'gh-github-9');
    assert.equal(deriveUrlKey('github-container', { userId: 77 }), 'gh-77');
    assert.equal(deriveUrlKey('jira', { cloudId: CLOUD }), `jira-${CLOUD}`);
    assert.equal(deriveUrlKey('linear', { orgKey: 'Acme Org' }), 'Acme Org', 'Linear keeps org.urlKey || org.name untouched');
    assert.equal(deriveUrlKey('local', { name: 'My Space', randomHex: () => 'deadbeef' }), 'my-space-deadbeef');
    assert.equal(slugify('foo.js_bar'), 'foo-js-bar');
  });
});

describe('GitHub fresh (random id)', () => {
  test('a first-time bind gets the id-bearing key, never the bare slug', async () => {
    const world = createResolverWorld();
    const r = await fresh(world);
    assert.deepEqual(r, { urlKey: 'gh-foo-100', source: 'derived' });
  });

  test('two accounts, same slug, different installations -> different keys', async () => {
    const world = createResolverWorld();
    const a = await fresh(world, { accountId: ALICE, slug: 'alice/foo', installationId: '100' });
    world.recordBind({ accountId: ALICE, urlKey: a.urlKey, provider: 'github', scope: 'alice/foo' });
    const b = await fresh(world, { accountId: BOB, slug: 'bob/foo', installationId: '200' });
    assert.notEqual(a.urlKey, b.urlKey);
  });

  test('R1 (round 3): alice/foo bound as `foo`; a first-time bind of alice-org/foo does not get `foo` (live and expired)', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'c1', accountId: ALICE, referents: [{ urlKey: 'foo', provider: 'github', scope: 'alice/foo' }] }]
    });
    const expired = await fresh(world, { slug: 'alice-org/foo', installationId: '300' });
    assert.equal(expired.urlKey, 'gh-foo-300');
    const live = await fresh(world, {
      slug: 'alice-org/foo', installationId: '300',
      workspaces: [sessionWorkspace({ id: 'w1', urlKey: 'foo', bindings: [{ provider: 'github', scope: 'alice/foo' }] })]
    });
    assert.equal(live.urlKey, 'gh-foo-300');
  });

  test('review F1: foo.bar then foo-bar on one installation, expired session -> distinct keys', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'c1', accountId: ALICE, referents: [{ urlKey: 'gh-foo-bar-42', provider: 'github', scope: 'alice/foo.bar' }] }]
    });
    const r = await fresh(world, { slug: 'alice/foo-bar', installationId: '42' });
    assert.notEqual(r.urlKey, 'gh-foo-bar-42', 'a derived key tied to another scope is never reused');
    assert.match(r.urlKey, /^gh-foo-bar-42-[0-9a-f]{6}$/);
    assert.equal(r.source, 'derived');
  });

  test('the same repo re-added after the session expired keeps its own key (referent, same {provider, full scope})', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'c1', accountId: ALICE, referents: [{ urlKey: 'foo', provider: 'github', scope: 'alice/foo' }] }]
    });
    const r = await fresh(world);
    assert.deepEqual(r, { urlKey: 'foo', source: 'resource' });
  });

  test('a binder re-adding its own repo after the workspace was removed is not refused', async () => {
    const world = createResolverWorld({ dispatchTokens: [{ urlKey: 'gh-foo-100', createdBy: ALICE }] });
    const r = await fresh(world);
    assert.equal(r.urlKey, 'gh-foo-100');
    assert.equal(r.refused, undefined);
  });

  test('a different account binding the same resource is refused, with no key', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'c1', accountId: ALICE, referents: [{ urlKey: 'gh-foo-100', provider: 'github', scope: 'alice/foo' }] }]
    });
    const r = await fresh(world, { accountId: BOB, slug: 'alice/foo', installationId: '100' });
    assert.deepEqual(r, { refused: { reason: 'foreign-holder' }, source: 'refused' });
  });

  test('the same repo twice in one session lands on the existing workspace', async () => {
    const world = createResolverWorld();
    const r = await fresh(world, {
      workspaces: [sessionWorkspace({ id: 'w1', urlKey: 'gh-foo-100', bindings: [{ provider: 'github', scope: 'alice/foo' }] })]
    });
    assert.deepEqual(r, { urlKey: 'gh-foo-100', source: 'session', landOnWorkspaceId: 'w1' });
  });

  test('a derived key live under another workspace id (other scope) takes the scope-hashed variant', async () => {
    const world = createResolverWorld();
    const r = await fresh(world, {
      workspaces: [sessionWorkspace({ id: 'w9', urlKey: 'gh-foo-100', bindings: [{ provider: 'github', scope: 'other/foo' }] })]
    });
    assert.notEqual(r.urlKey, 'gh-foo-100');
    assert.ok(validateWorkspaceUrlKey(r.urlKey) && r.urlKey.length <= 50);
  });

  test('a merged account counts as the same binder', async () => {
    const world = createResolverWorld({
      mergedInto: { 'acct-alice-old': ALICE },
      referents: [{ _id: 'c1', accountId: 'acct-alice-old', referents: [{ urlKey: 'gh-foo-100', provider: 'github', scope: 'alice/foo' }] }]
    });
    assert.equal((await fresh(world)).urlKey, 'gh-foo-100');
  });

  test('the signing-in identity joins the binder set (an account that holds the key through its identity)', async () => {
    const world = createResolverWorld({
      identities: [{ provider: 'github', scope: '77', accountId: 'acct-id' }],
      dispatchTokens: [{ urlKey: 'gh-foo-100', createdBy: 'acct-id' }]
    });
    const r = await fresh(world, { accountId: undefined, identity: { provider: 'github', scope: '77' } });
    assert.equal(r.urlKey, 'gh-foo-100');
  });
});

describe('GitHub account container (stable id)', () => {
  test('review F2: a first-time bind gets gh-<userId>, never the bare login key', async () => {
    const world = createResolverWorld();
    assert.equal((await container(world)).urlKey, 'gh-77');
  });

  test('review F2/F3: a login key held only by ownerless tokens is not taken by a first-time container', async () => {
    const world = createResolverWorld({ dispatchTokens: [{ urlKey: 'alice', createdBy: null }] });
    assert.equal((await container(world)).urlKey, 'gh-77');
  });

  test('expired-session return keeps its key', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'c1', accountId: ALICE, referents: [{ urlKey: 'gh-77', provider: 'github', scope: 'alice/foo' }] }],
      edges: [{ accountId: ALICE, workspaceId: 'github:77' }]
    });
    assert.deepEqual(await container(world), { urlKey: 'gh-77', source: 'resource' });
    const world2 = createResolverWorld({
      referents: [{ _id: 'c1', accountId: ALICE, referents: [{ urlKey: 'alice', provider: 'github', scope: 'alice/old-repo' }] }],
      edges: [{ accountId: ALICE, workspaceId: 'github:77' }]
    });
    assert.equal((await container(world2)).urlKey, 'alice', 'a different repo picked on return does not re-key the container');
  });

  test('a login another account holds falls to gh-<userId>; the same account is not refused', async () => {
    const world = createResolverWorld({ dispatchTokens: [{ urlKey: 'alice', createdBy: BOB }] });
    assert.equal((await container(world)).urlKey, 'gh-77');
  });

  test('a login that is live under another workspace id falls to gh-<userId>', async () => {
    const world = createResolverWorld();
    const r = await container(world, { workspaces: [sessionWorkspace({ id: 'org-9', urlKey: 'alice' })] });
    assert.equal(r.urlKey, 'gh-77');
  });
});

describe('Jira (stable id, per Atlassian identity)', () => {
  test('a first-time bind gets jira-<cloudId>', async () => {
    const world = createResolverWorld();
    assert.deepEqual(await jira(world), { urlKey: `jira-${CLOUD}`, source: 'derived' });
  });

  test('expired return keeps acme-2 even when the account also holds Linear `acme`', async () => {
    const world = createResolverWorld({
      referents: [
        { _id: 'l', accountId: ALICE, referents: [{ urlKey: 'acme', provider: 'linear', scope: 'org-1' }] },
        { _id: 'j', accountId: ALICE, referents: [{ urlKey: 'acme-2', provider: 'jira', scope: SITE }] }
      ],
      edges: [{ accountId: ALICE, workspaceId: 'jira:ALICE-ATL' }]
    });
    assert.equal((await jira(world)).urlKey, 'acme-2');
  });

  test('expired return from legacy owner-credential rows (no scope) keeps its key', async () => {
    const world = createResolverWorld({
      ownerCredentials: [{ accountId: ALICE, urlKey: 'acme', provider: 'jira' }],
      edges: [{ accountId: ALICE, workspaceId: 'jira:ALICE-ATL' }]
    });
    assert.equal((await jira(world)).urlKey, 'acme');
  });

  test('teammate on the same site, different account, is refused when the first binder holds jira-<cloudId> (xi)', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'j', accountId: ALICE, referents: [{ urlKey: `jira-${CLOUD}`, provider: 'jira', scope: SITE }] }],
      edges: [{ accountId: ALICE, workspaceId: 'jira:ALICE-ATL' }]
    });
    const r = await jira(world, { accountId: BOB, W: 'jira:BOB-ATL' });
    assert.deepEqual(r.refused, { reason: 'foreign-holder' });
    assert.equal(r.urlKey, undefined, 'a refusal carries no key (and not the scoped variant)');
  });

  test('(i) removal then return: edge, no record, another account holds `acme` -> jira-<cloudId>, not refused, not acme', async () => {
    const world = createResolverWorld({
      dispatchTokens: [{ urlKey: 'acme', createdBy: BOB }],
      edges: [{ accountId: ALICE, workspaceId: 'jira:ALICE-ATL' }]
    });
    assert.equal((await jira(world)).urlKey, `jira-${CLOUD}`);
  });

  test('(ii) the same with the base key free returns the base key', async () => {
    const world = createResolverWorld({ edges: [{ accountId: ALICE, workspaceId: 'jira:ALICE-ATL' }] });
    assert.deepEqual(await jira(world), { urlKey: 'acme', source: 'legacy' });
  });

  test('(x) two identities of one account on one site: the second gets a distinct scoped key; both find their own on return', async () => {
    const world = createResolverWorld();
    const first = await jira(world, { W: 'jira:A1' });
    assert.equal(first.urlKey, `jira-${CLOUD}`);
    world.recordBind({ accountId: ALICE, urlKey: first.urlKey, provider: 'jira', scope: SITE, workspaceId: 'jira:A1' });
    const live = [sessionWorkspace({ id: 'jira:A1', urlKey: first.urlKey })];
    const second = await jira(world, { W: 'jira:A2', workspaces: live });
    assert.notEqual(second.urlKey, first.urlKey);
    assert.ok(validateWorkspaceUrlKey(second.urlKey) && second.urlKey.length <= 50);
    assert.match(second.urlKey, /^jira-.*-[0-9a-f]{6}$/);
    world.recordBind({ accountId: ALICE, urlKey: second.urlKey, provider: 'jira', scope: SITE, workspaceId: 'jira:A2' });

    // Session expired: each returns to its own key, in both orders.
    assert.equal((await jira(world, { W: 'jira:A2' })).urlKey, second.urlKey);
    assert.equal((await jira(world, { W: 'jira:A1' })).urlKey, first.urlKey);
  });

  test('(x) expired first bind of the second identity does not take the first identity\'s key', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'j', accountId: ALICE, referents: [{ urlKey: `jira-${CLOUD}`, provider: 'jira', scope: SITE }] }],
      edges: [{ accountId: ALICE, workspaceId: 'jira:A1' }]
    });
    const r = await jira(world, { W: 'jira:A2' });
    assert.notEqual(r.urlKey, `jira-${CLOUD}`);
    assert.match(r.urlKey, /^jira-.*-[0-9a-f]{6}$/);
  });

  describe('F1: the legacy same-site pair acme / acme-2, expired', () => {
    const pair = extra => createResolverWorld({
      referents: [
        { _id: 'j1', accountId: ALICE, referents: [{ urlKey: 'acme', provider: 'jira', scope: SITE }] },
        { _id: 'j2', accountId: ALICE, referents: [{ urlKey: 'acme-2', provider: 'jira', scope: SITE }] }
      ],
      edges: [{ accountId: ALICE, workspaceId: 'jira:A1' }, { accountId: ALICE, workspaceId: 'jira:A2' }],
      ...extra
    });

    test('no record names the workspace -> refused in both return orders; never a swap, never a shared key', async () => {
      const world = pair();
      for (const W of ['jira:A1', 'jira:A2']) {
        const r = await jira(world, { W });
        assert.equal(r.urlKey, undefined, W);
        assert.equal(r.refused.reason, 'ambiguous');
      }
    });

    test('a runner token naming the workspace settles it, in both orders', async () => {
      const world = pair({
        proxyTokens: [
          { urlKey: 'acme', createdBy: ALICE, workspaceId: 'jira:A1' },
          { urlKey: 'acme-2', createdBy: ALICE, workspaceId: 'jira:A2' }
        ]
      });
      assert.equal((await jira(world, { W: 'jira:A2' })).urlKey, 'acme-2');
      assert.equal((await jira(world, { W: 'jira:A1' })).urlKey, 'acme');
    });
  });
});

describe('Linear (stable id = org id, key stays org.urlKey || org.name)', () => {
  test('a first-time bind gets the org key', async () => {
    assert.deepEqual(await linear(createResolverWorld()), { urlKey: 'acme', source: 'derived' });
  });

  test('(viii) a second member of the same org (edge to org.id) shares the workspace; a returning binder is not refused', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'l', accountId: ALICE, referents: [{ urlKey: 'acme', provider: 'linear', scope: 'org-1' }] }],
      edges: [{ accountId: ALICE, workspaceId: 'org-1' }, { accountId: BOB, workspaceId: 'org-1' }]
    });
    assert.equal((await linear(world, { accountId: BOB })).urlKey, 'acme');
    assert.equal((await linear(world, { accountId: ALICE })).urlKey, 'acme');
  });

  test('(ix) a key another account holds, with no edge to the org -> foreign-holder', async () => {
    const world = createResolverWorld({ dispatchTokens: [{ urlKey: 'acme', createdBy: BOB }] });
    assert.deepEqual((await linear(world)).refused, { reason: 'foreign-holder' });
  });

  test('(vi) reverse order, live: legacy Jira `acme` open, then Linear org `acme` -> own-conflict, no key', async () => {
    const world = createResolverWorld();
    const r = await linear(world, { workspaces: [sessionWorkspace({ id: 'jira:A1', urlKey: 'acme' })] });
    assert.deepEqual(r, { refused: { reason: 'own-conflict' }, source: 'refused' });
  });

  test('(vii) reverse order, expired: the binder holds `acme` only through its Jira credential -> own-conflict', async () => {
    const world = createResolverWorld({ ownerCredentials: [{ accountId: ALICE, urlKey: 'acme', provider: 'jira' }] });
    assert.deepEqual((await linear(world)).refused, { reason: 'own-conflict' });
  });

  test('F2(a): the binder holds Linear `acme` AND Jira `acme`, session expired -> `acme` (own-scope hit wins)', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'l', accountId: ALICE, referents: [{ urlKey: 'acme', provider: 'linear', scope: 'org-1' }] }],
      ownerCredentials: [{ accountId: ALICE, urlKey: 'acme', provider: 'jira' }]
    });
    assert.deepEqual(await linear(world), { urlKey: 'acme', source: 'resource' });
  });

  test('a returning org is not refused even when a second account holds its key (AC)', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'l', accountId: ALICE, referents: [{ urlKey: 'acme', provider: 'linear', scope: 'org-1' }] }],
      dispatchTokens: [{ urlKey: 'acme', createdBy: BOB }]
    });
    assert.equal((await linear(world)).urlKey, 'acme');
  });

  test('the forward order (Linear `acme` first) still lets Jira get jira-<cloudId>', async () => {
    const world = createResolverWorld({
      referents: [{ _id: 'l', accountId: ALICE, referents: [{ urlKey: 'acme', provider: 'linear', scope: 'org-1' }] }]
    });
    const r = await jira(world, { workspaces: [sessionWorkspace({ id: 'org-1', urlKey: 'acme' })] });
    assert.notEqual(r.urlKey, 'acme', 'the live Linear `acme` is never taken');
    assert.equal(r.urlKey, `jira-${CLOUD}`);
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
  test('never returns a key that is live under another workspace id, on any arm or branch', async () => {
    const live = key => [sessionWorkspace({ id: 'other', urlKey: key })];
    const jiraPair = () => createResolverWorld({
      referents: [{ _id: 'j', accountId: ALICE, referents: [{ urlKey: 'acme', provider: 'jira', scope: SITE }] }],
      edges: [{ accountId: ALICE, workspaceId: 'jira:ALICE-ATL' }]
    });
    const linearHeld = () => createResolverWorld({
      referents: [{ _id: 'l', accountId: ALICE, referents: [{ urlKey: 'acme', provider: 'linear', scope: 'org-1' }] }]
    });
    // [liveKey, run]: the one key live under a DIFFERENT workspace id in that case.
    const cases = [
      ['gh-foo-100', () => fresh(createResolverWorld(), { workspaces: live('gh-foo-100') })],
      ['foo', () => fresh(createResolverWorld({ referents: [{ _id: 'c', accountId: ALICE, referents: [{ urlKey: 'foo', provider: 'github', scope: 'alice/foo' }] }] }), { workspaces: live('foo') })],
      ['alice', () => container(createResolverWorld(), { workspaces: live('alice') })],
      ['alice', () => container(createResolverWorld({ edges: [{ accountId: ALICE, workspaceId: 'github:77' }] }), { workspaces: live('alice') })],
      [`jira-${CLOUD}`, () => jira(createResolverWorld(), { workspaces: live(`jira-${CLOUD}`) })],
      ['acme', () => jira(createResolverWorld({ edges: [{ accountId: ALICE, workspaceId: 'jira:ALICE-ATL' }] }), { workspaces: live('acme') })],
      ['acme', () => jira(jiraPair(), { workspaces: live('acme') })],
      ['acme', () => linear(createResolverWorld(), { workspaces: live('acme') })],
      ['acme', () => linear(linearHeld(), { workspaces: live('acme') })]
    ];
    for (const [liveKey, run] of cases) {
      const r = await run();
      assert.notEqual(r.urlKey, liveKey, `returned a key live under another id: ${liveKey}`);
    }
  });

  test('one holder read per resolve, never one per candidate', async () => {
    const world = createResolverWorld();
    await jira(world);
    assert.equal(world.evidenceReads.length, 1);
    await fresh(world);
    assert.equal(world.evidenceReads.length, 2);
    assert.ok(world.evidenceReads[0].length >= 10, 'the candidate set rides one read');
  });

  test('(iv) a store that throws makes the resolver throw; the finder is strict', async () => {
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
      assert.ok(!/connection-store/.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${file} imports no connection store`);
      assert.ok(!/readConnection[A-Z]/.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${file} calls no readConnection*`);
      assert.ok(!/\.credentials\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${file} reads no .credentials`);
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
