/**
 * LIN-1892 S3 — merge paths: S3-1 (stale link-mode conflict re-proof),
 * S3-2 (null-workspace merge confirm skips every workspace-keyed write,
 * including the LIN-3127 Connection dual-write), and the within-window
 * null-workspace merge offer end to end through `/auth/merge/confirm`.
 *
 * Also characterizes the EXISTING workspace-bearing `/auth/merge/confirm`
 * path first, so the provider merge flows keep their behaviour exactly.
 *
 * Real routes over the loopback harness (real express-session, real MangoDB
 * stores incl. owner-credentials + connections). `fetch` is stubbed to throw.
 *
 * Run with: node --test tests/unit/email-link-mode-merge.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { startEmailAuthHarness, tokenFromOutbox, hiddenField, sha256 } from '../fixtures/email-auth-harness.js';

describe('S3 merge paths (S3-1 stale re-proof, S3-2 null-workspace merge)', () => {
  let harness;
  let originalFetch;
  let counter = 0;

  before(async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('fetch is not allowed'); };
    harness = await startEmailAuthHarness();
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await harness?.close();
  });

  const identities = async accountId => (await harness.stores.accountStore.getAccount(accountId)).identities.map(i => `${i.provider}:${i.scope}`);

  async function signIn(browser, { provider = 'linear', scope, workspaceId, urlKey, staleAuth = false, noAuthStamp = false } = {}) {
    const n = counter++;
    const res = await browser.post('/__test/sign-in', {
      provider,
      scope: scope || `p-${n}`,
      ...(workspaceId ? { workspaceId, urlKey: urlKey || workspaceId } : {}),
      ...(staleAuth ? { staleAuth: '1' } : {}),
      ...(noAuthStamp ? { noAuthStamp: '1' } : {}),
    });
    return JSON.parse(res.text).accountId;
  }

  async function accountOwningEmail(email) {
    const account = await harness.stores.accountStore.createAccount();
    await harness.stores.accountStore.linkIdentity(account._id, 'email', email);
    return account._id;
  }

  /** Mint a link-mode token for this browser's own live account. */
  async function requestLinkMode(browser, email) {
    const reg = await browser.get('/auth/email/register');
    const nonce = hiddenField(reg.text, 'nonce');
    await browser.post('/auth/email/send', { email, nonce, mode: 'link' }, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    return tokenFromOutbox(harness.transport, email);
  }

  // ---------------------------------------------------------------------------
  // Characterization FIRST: the workspace-bearing path is unchanged by S3-2.
  // ---------------------------------------------------------------------------
  test('characterization: a workspace-bearing merge still writes the session workspace, edge, Connection and owner credential', async () => {
    const browser = harness.browser();
    const P = await signIn(browser, { scope: `char-p-${counter++}`, workspaceId: 'ws-home-char', urlKey: 'ws-home-char' });
    const E = await accountOwningEmail(`char-${counter}@x.io`);
    const workspace = {
      id: 'ws-new-char',
      urlKey: 'ws-new-char',
      provider: 'linear',
      bindings: [{ provider: 'linear', scope: 'org-char', credentials: { token: 'tok-char' } }],
    };
    await browser.post('/__test/pending-merge', {
      canonicalAccountId: P,
      mergedAccountId: E,
      workspace: JSON.stringify(workspace),
      provider: 'linear',
      refreshToken: 'rt-char',
    });

    const res = await browser.post('/auth/merge/confirm', {});
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.location, '/workspace/ws-new-char/');

    const session = await browser.session();
    assert.ok(session.workspaces.some(w => w.id === 'ws-new-char'), 'the arriving workspace was upserted into the session');
    assert.strictEqual(session.activeWorkspaceId, 'ws-new-char', 'activeWorkspaceId was set to the arriving workspace');
    assert.strictEqual(session.pendingMerge, undefined);
    assert.strictEqual(await harness.db.collection('account-workspaces').countDocuments({ accountId: P, workspaceId: 'ws-new-char' }), 1, 'the edge was bound');
    assert.strictEqual(await harness.db.collection('connections').countDocuments({ _id: `${P}::linear::org-char` }), 1, 'the Connection dual-write happened');
    assert.ok(await harness.stores.ownerCredentialStore.get(P, 'ws-new-char', 'linear'), 'the owner credential was persisted');
    assert.strictEqual((await harness.stores.accountStore.getAccount(E)).mergedInto, P, 'the merge happened');
  });

  // ---------------------------------------------------------------------------
  // S3-2: null-workspace merge confirm
  // ---------------------------------------------------------------------------
  test('S3-2: a null-workspace merge confirm skips every workspace-keyed write, including the Connection dual-write', async () => {
    const browser = harness.browser();
    const P = await signIn(browser, { scope: `null-p-${counter++}`, workspaceId: 'ws-home-null', urlKey: 'ws-home-null' });
    const E = await accountOwningEmail(`null-${counter}@x.io`);
    const edgesBefore = await harness.db.collection('account-workspaces').countDocuments({});
    const connectionsBefore = await harness.db.collection('connections').countDocuments({});
    const ownerCredentialsBefore = await harness.db.collection('owner-credentials').countDocuments({});

    await browser.post('/__test/pending-merge', {
      canonicalAccountId: P,
      mergedAccountId: E,
      workspace: null,
      provider: 'email',
    });

    const res = await browser.post('/auth/merge/confirm', {});
    assert.strictEqual(res.status, 302, 'no upsertWorkspace(null) crash');
    assert.strictEqual(res.location, '/workspace/ws-home-null/', 'redirect to the first existing workspace');

    const session = await browser.session();
    assert.strictEqual(session.pendingMerge, undefined);
    assert.strictEqual(session.accountId, P);
    assert.strictEqual(session.activeWorkspaceId, undefined, 'activeWorkspaceId was NOT written');
    assert.strictEqual(session.workspaces.length, 1, 'the session workspaces were untouched');
    assert.strictEqual(await harness.db.collection('account-workspaces').countDocuments({}), edgesBefore, 'no edge written');
    assert.strictEqual(await harness.db.collection('connections').countDocuments({}), connectionsBefore, 'no Connection record written');
    assert.strictEqual(await harness.db.collection('owner-credentials').countDocuments({}), ownerCredentialsBefore, 'no owner credential written');
    assert.strictEqual((await harness.stores.accountStore.getAccount(E)).mergedInto, P, 'the merge itself still happened');
  });

  test('S3-2: a null-workspace merge with no workspace and no session workspace lands on /account', async () => {
    const browser = harness.browser();
    const P = await signIn(browser, { scope: `null-account-${counter++}`, workspaceId: null });
    const E = await accountOwningEmail(`null-account-${counter}@x.io`);
    const connectionsBefore = await harness.db.collection('connections').countDocuments({});
    await browser.post('/__test/pending-merge', { canonicalAccountId: P, mergedAccountId: E, workspace: null, provider: 'email' });

    const res = await browser.post('/auth/merge/confirm', {});
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.location, '/account');
    assert.strictEqual(await harness.db.collection('connections').countDocuments({}), connectionsBefore, 'no Connection written');
    assert.strictEqual((await harness.stores.accountStore.getAccount(E)).mergedInto, P);
  });

  // ---------------------------------------------------------------------------
  // S3-1: stale link-mode conflict → re-prove P, never /auth/email
  // ---------------------------------------------------------------------------
  test('S3-1: a stale link-mode conflict sends the user to re-prove P via its provider sign-in, not /auth/email', async () => {
    const browser = harness.browser();
    const email = `stale-${counter++}@x.io`;
    const P = await signIn(browser, { scope: `stale-p-${counter}`, workspaceId: 'ws-stale', urlKey: 'ws-stale' });
    const E = await accountOwningEmail(email);
    const t = await requestLinkMode(browser, email);
    const { nonce } = await browser.openConfirm(t);

    // P is no longer freshly authenticated (the offer/proof window has lapsed).
    await browser.post('/__test/sign-in', { provider: 'linear', scope: `stale-p-${counter}`, workspaceId: 'ws-stale', urlKey: 'ws-stale', staleAuth: '1' });
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0);

    const res = await browser.confirm(t, nonce);
    assert.strictEqual(res.status, 409);
    assert.match(res.text, /data-testid="merge-reauth-required-page"/);
    assert.match(res.text, /href="\/auth\/linear"/, 'the re-proof target is P\'s provider sign-in');
    assert.doesNotMatch(res.text, /href="\/auth\/email"/, 'never /auth/email');
    assert.match(res.text, /request a new link/i, 'it says the consumed link must be requested again');

    const session = await browser.session();
    assert.strictEqual(session.pendingMerge, undefined, 'no merge offered on a stale proof');
    assert.strictEqual(session.accountId, P);
    assert.deepStrictEqual((await identities(P)).filter(s => s.startsWith('email:')), [], 'P gained no email identity');
    assert.deepStrictEqual(await identities(E), [`email:${email}`], 'E is unchanged');
    assert.ok((await harness.db.collection('email-magic-links').findOne({ _id: sha256(t) })).consumedAt, 'the old link was consumed');
  });

  test('S3-1/S3-4: an email-only P is offered the working email re-proof (still not /auth/email)', async () => {
    const browser = harness.browser();
    const ownEmail = `emailonly-${counter++}@x.io`;
    // P is an email-only account holding one address.
    const P = await signIn(browser, { provider: 'email', scope: ownEmail, workspaceId: null, staleAuth: true });
    const arrivingEmail = `arriving-${counter}@x.io`;
    const E = await accountOwningEmail(arrivingEmail);
    const t = await requestLinkMode(browser, arrivingEmail);
    const { nonce } = await browser.openConfirm(t);

    const res = await browser.confirm(t, nonce);
    assert.strictEqual(res.status, 409);
    assert.match(res.text, /data-testid="merge-reauth-required-page"/);
    assert.match(res.text, /href="\/auth\/email\/reproof"/, 'email-only P is offered the working re-proof route');
    assert.doesNotMatch(res.text, /href="\/auth\/email"/);
    const session = await browser.session();
    assert.strictEqual(session.pendingMerge, undefined);
    assert.strictEqual(session.accountId, P);
    assert.deepStrictEqual(await identities(E), [`email:${arrivingEmail}`]);
  });

  // ---------------------------------------------------------------------------
  // G1 (S3 round-3): the re-proof selection is chain-aware for providers and
  // must not offer a dead-end email re-proof to a truly local-only P.
  // ---------------------------------------------------------------------------
  test('G1(b): a stale local P with a provider identity on merged E re-proves via that provider (chain-aware), no merge', async () => {
    const browser = harness.browser();
    const scope = `g1b-p-${counter++}`;
    const P = await signIn(browser, { provider: 'local', scope, workspaceId: 'ws-g1b', urlKey: 'ws-g1b' });
    // E holds the Linear identity; it is merged INTO P. `mergeAccounts` never
    // moves identities[], so a canonical-only provider read cannot see it.
    const E = await harness.stores.accountStore.createAccount();
    await harness.stores.accountStore.linkIdentity(E._id, 'linear', `g1b-viewer-${counter}`, {});
    assert.strictEqual((await harness.stores.accountStore.mergeAccounts(P, E._id, {})).ok, true);
    // A stale P takes the re-auth arm, not the merge offer.
    await browser.post('/__test/sign-in', { provider: 'local', scope, workspaceId: 'ws-g1b', urlKey: 'ws-g1b', staleAuth: '1' });
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0);

    const y = `g1b-owned-${counter}@x.io`;
    const F = await accountOwningEmail(y);
    const t = await requestLinkMode(browser, y);
    const { nonce } = await browser.openConfirm(t);
    const res = await browser.confirm(t, nonce);

    assert.strictEqual(res.status, 409);
    assert.match(res.text, /data-testid="merge-reauth-required-page"/);
    assert.match(res.text, /href="\/auth\/linear"/, 'the provider identity on merged E is found and offered');
    assert.doesNotMatch(res.text, /href="\/auth\/email\/reproof"/, 'not a dead-end email re-proof');
    const session = await browser.session();
    assert.strictEqual(session.pendingMerge, undefined, 'no merge offered while P is stale');
    assert.strictEqual(session.accountId, P);
    assert.strictEqual((await harness.stores.accountStore.getAccount(F)).mergedInto, undefined, 'F untouched');
  });

  test('G1(a): a pure local-only stale P gets honest no-re-proof guidance, never a dead-end email re-proof link', async () => {
    const browser = harness.browser();
    const scope = `g1a-p-${counter++}`;
    const P = await signIn(browser, { provider: 'local', scope, workspaceId: 'ws-g1a', urlKey: 'ws-g1a' });
    await browser.post('/__test/sign-in', { provider: 'local', scope, workspaceId: 'ws-g1a', urlKey: 'ws-g1a', staleAuth: '1' });
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0);

    const y = `g1a-owned-${counter}@x.io`;
    const F = await accountOwningEmail(y);
    const t = await requestLinkMode(browser, y);
    const { nonce } = await browser.openConfirm(t);
    const res = await browser.confirm(t, nonce);

    assert.strictEqual(res.status, 409);
    assert.match(res.text, /data-testid="merge-reauth-required-page"/);
    assert.doesNotMatch(res.text, /href="\/auth\/email\/reproof"/, 'no dead-end re-proof link');
    assert.doesNotMatch(res.text, /href="\/auth\/email"/, 'never /auth/email');
    assert.match(res.text, /can't be re-proved here/i, 'honest guidance is rendered');
    const session = await browser.session();
    assert.strictEqual(session.pendingMerge, undefined, 'no merge offered');
    assert.strictEqual(session.accountId, P);
    assert.strictEqual((await harness.stores.accountStore.getAccount(F)).mergedInto, undefined, 'F untouched');
  });

  test('H1: a stale local P whose only email lives on merged E is offered the working email re-proof (chain-aware has-email)', async () => {
    const browser = harness.browser();
    const scope = `h1-p-${counter++}`;
    const P = await signIn(browser, { provider: 'local', scope, workspaceId: 'ws-h1', urlKey: 'ws-h1' });
    // E holds P's only email; it is merged INTO P. `mergeAccounts` never moves
    // identities[], so a canonical-only has-email read cannot see it.
    const e = `h1-e-${counter}@x.io`;
    const E = await accountOwningEmail(e);
    assert.strictEqual((await harness.stores.accountStore.mergeAccounts(P, E, {})).ok, true);
    await browser.post('/__test/sign-in', { provider: 'local', scope, workspaceId: 'ws-h1', urlKey: 'ws-h1', staleAuth: '1' });
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0);

    const y = `h1-owned-${counter}@x.io`;
    const F = await accountOwningEmail(y);
    const t = await requestLinkMode(browser, y);
    const { nonce } = await browser.openConfirm(t);
    const res = await browser.confirm(t, nonce);

    assert.strictEqual(res.status, 409);
    assert.match(res.text, /data-testid="merge-reauth-required-page"/);
    assert.match(res.text, /href="\/auth\/email\/reproof"/, 'the address on merged E makes the email re-proof a working offer');
    assert.doesNotMatch(res.text, /can't be re-proved here/i, 'not the local-only no-re-proof copy');
    const session = await browser.session();
    assert.strictEqual(session.pendingMerge, undefined, 'no merge offered while P is stale');
    assert.strictEqual((await harness.stores.accountStore.getAccount(F)).mergedInto, undefined, 'F untouched');
  });

  // ---------------------------------------------------------------------------
  // within-window: fresh conflict offers the null-workspace merge, end to end
  // ---------------------------------------------------------------------------
  test('within-window: a fresh link-mode conflict offers the null-workspace merge, and confirm completes it with no workspace writes', async () => {
    const browser = harness.browser();
    const email = `fresh-${counter++}@x.io`;
    const P = await signIn(browser, { scope: `fresh-p-${counter}`, workspaceId: 'ws-fresh', urlKey: 'ws-fresh' });
    const E = await accountOwningEmail(email);
    const t = await requestLinkMode(browser, email);
    const { nonce } = await browser.openConfirm(t);

    const offered = await browser.confirm(t, nonce);
    assert.strictEqual(offered.status, 409);
    assert.match(offered.text, /data-testid="merge-confirm-page"/);
    assert.match(offered.text, /data-testid="merge-confirm-submit"/);

    let session = await browser.session();
    assert.ok(session.pendingMerge, 'a merge is pending');
    assert.strictEqual(session.pendingMerge.workspace, null, 'null-workspace offer');
    assert.strictEqual(session.pendingMerge.canonicalAccountId, P);
    assert.strictEqual(session.pendingMerge.mergedAccountId, E);
    assert.strictEqual(session.pendingMerge.mode, 'new');

    const edgesBefore = await harness.db.collection('account-workspaces').countDocuments({});
    const connectionsBefore = await harness.db.collection('connections').countDocuments({});
    const ownerCredentialsBefore = await harness.db.collection('owner-credentials').countDocuments({});
    const confirmed = await browser.post('/auth/merge/confirm', {});
    assert.strictEqual(confirmed.status, 302);
    assert.strictEqual(confirmed.location, '/workspace/ws-fresh/');

    session = await browser.session();
    assert.strictEqual(session.pendingMerge, undefined);
    assert.strictEqual(session.accountId, P);
    assert.strictEqual(session.activeWorkspaceId, undefined);
    assert.strictEqual((await harness.stores.accountStore.getAccount(E)).mergedInto, P, 'E merged into P');
    assert.strictEqual(await harness.db.collection('account-workspaces').countDocuments({}), edgesBefore, 'no edge written');
    assert.strictEqual(await harness.db.collection('connections').countDocuments({}), connectionsBefore, 'no Connection written');
    assert.strictEqual(await harness.db.collection('owner-credentials').countDocuments({}), ownerCredentialsBefore, 'no owner credential');
    assert.deepStrictEqual(await identities(E), [`email:${email}`], 'the email stays recorded on the merged account (identity is not moved)');
  });

  // ---------------------------------------------------------------------------
  // D1: link mode must NOT refresh P's freshness (LIN-2233 A1 stays intact).
  // ---------------------------------------------------------------------------
  test('D1: a stale P link-confirms a new X, X is attached and P stays stale', async () => {
    const browser = harness.browser();
    const X = `d1-new-${counter++}@x.io`;
    const scope = `d1-stale-p-${counter}`;
    const P = await signIn(browser, { scope, workspaceId: 'ws-d1', urlKey: 'ws-d1' });
    // P is stale: the merge-proof window has lapsed.
    await browser.post('/__test/sign-in', { provider: 'linear', scope, workspaceId: 'ws-d1', urlKey: 'ws-d1', staleAuth: '1' });
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0);

    const t = await requestLinkMode(browser, X);
    const { nonce } = await browser.openConfirm(t);
    const res = await browser.confirm(t, nonce);

    assert.strictEqual(res.status, 302, 'the new address links onto the live account');
    assert.deepStrictEqual((await identities(P)).filter(s => s.startsWith('email:')), [`email:${X}`], 'X is attached to P');
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0, 'link mode did not refresh P freshness');
  });

  test('D1: after a stale P link-confirms X, linking Y owned by E still forces re-proof (no merge, E untouched)', async () => {
    const browser = harness.browser();
    const X = `d1-second-${counter++}@x.io`;
    const Y = `d1-owned-${counter++}@x.io`;
    const scope = `d1-second-p-${counter}`;
    const P = await signIn(browser, { scope, workspaceId: 'ws-d1b', urlKey: 'ws-d1b' });
    await browser.post('/__test/sign-in', { provider: 'linear', scope, workspaceId: 'ws-d1b', urlKey: 'ws-d1b', staleAuth: '1' });
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0);

    // Link-confirm a brand-new address: this must not make P fresh.
    const tx = await requestLinkMode(browser, X);
    const { nonce: nx } = await browser.openConfirm(tx);
    assert.strictEqual((await browser.confirm(tx, nx)).status, 302);
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0, 'X did not re-stamp P');

    // E owns Y; P is still stale, so the conflict must re-prove P, never merge.
    const E = await accountOwningEmail(Y);
    const ty = await requestLinkMode(browser, Y);
    const { nonce: ny } = await browser.openConfirm(ty);
    const res = await browser.confirm(ty, ny);

    assert.strictEqual(res.status, 409);
    assert.match(res.text, /data-testid="merge-reauth-required-page"/);
    assert.doesNotMatch(res.text, /data-testid="merge-confirm-page"/);
    const session = await browser.session();
    assert.strictEqual(session.pendingMerge, undefined, 'no merge offered to a stale P');
    assert.strictEqual(session.accountId, P);
    assert.strictEqual((await harness.stores.accountStore.getAccount(E)).mergedInto, undefined, 'E was not merged into P');
    assert.deepStrictEqual(await identities(E), [`email:${Y}`], 'E keeps its own email identity');
  });

  test('D1: a fresh P\'s existing stamp is preserved exactly, not refreshed, by link mode', async () => {
    const browser = harness.browser();
    const X = `d1-fresh-${counter++}@x.io`;
    const scope = `d1-fresh-p-${counter}`;
    const P = await signIn(browser, { scope, workspaceId: 'ws-d1c', urlKey: 'ws-d1c' });
    const before = (await browser.session()).identityAuthenticatedAt;
    assert.ok(before > 0, 'P is freshly authenticated');

    const t = await requestLinkMode(browser, X);
    const { nonce } = await browser.openConfirm(t);
    assert.strictEqual((await browser.confirm(t, nonce)).status, 302);

    assert.strictEqual((await browser.session()).identityAuthenticatedAt, before, 'the prior fresh stamp survived the link unchanged');
    assert.deepStrictEqual((await identities(P)).filter(s => s.startsWith('email:')), [`email:${X}`]);
  });

  // ---------------------------------------------------------------------------
  // G4 (S3 round-3): D1's stamp-absent branch — a session with no
  // identityAuthenticatedAt must still have none after a link-mode confirm.
  // ---------------------------------------------------------------------------
  test('G4: link mode leaves an ABSENT freshness stamp absent (D1b mutant must fail this)', async () => {
    const browser = harness.browser();
    const X = `g4-new-${counter++}@x.io`;
    const scope = `g4-p-${counter}`;
    const P = await signIn(browser, { provider: 'linear', scope, workspaceId: 'ws-g4', urlKey: 'ws-g4', noAuthStamp: true });
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, undefined, 'P started with no stamp');

    const t = await requestLinkMode(browser, X);
    const { nonce } = await browser.openConfirm(t);
    const res = await browser.confirm(t, nonce);

    assert.strictEqual(res.status, 302, 'the new address links onto the live account');
    assert.deepStrictEqual((await identities(P)).filter(s => s.startsWith('email:')), [`email:${X}`], 'X is attached to P');
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, undefined, 'link mode did not create a stamp');
  });

  // ---------------------------------------------------------------------------
  // N1: the post-consume link-mode account check is pinned (M5d).
  // ---------------------------------------------------------------------------
  test('N1: a link-mode token whose linkToAccountId changes between peek and consume is refused after consume', async () => {
    const browser = harness.browser();
    const email = `n1-${counter++}@x.io`;
    const P = await signIn(browser, { scope: `n1-p-${counter}`, workspaceId: 'ws-n1', urlKey: 'ws-n1' });
    const t = await requestLinkMode(browser, email);
    const { nonce } = await browser.openConfirm(t);

    // The peek (pre-consume check) sees the real owner and passes; the consume
    // then hands back the same record bound to a different account, exactly the
    // gap the post-consume re-check closes.
    const store = harness.stores.magicLinkStore;
    const originalConsume = store.consume.bind(store);
    store.consume = async token => {
      const record = await originalConsume(token);
      return record ? { ...record, linkToAccountId: 'a-different-account' } : record;
    };
    let res;
    try {
      res = await browser.confirm(t, nonce);
    } finally {
      store.consume = originalConsume;
    }

    assert.strictEqual(res.status, 409, 'refused rather than attaching to P');
    assert.match(res.text, /data-testid="email-link-wrong-browser"/);
    assert.deepStrictEqual((await identities(P)).filter(s => s.startsWith('email:')), [], 'no email identity was attached');
  });
});
