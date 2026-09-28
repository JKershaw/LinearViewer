/**
 * LIN-1892 N2 (revised contract): a sign-in-mode email confirm NEVER attaches
 * an email to an already signed-in account.
 *
 * The attack: following a link proves you hold the link, not that you control
 * the inbox. A victim signed in as P who opens an attacker-requested sign-in
 * link and confirms it must not end up with the attacker's address on P —
 * the attacker could then sign in as P by email. The guard runs before
 * consume (b′) and again after it (c′).
 *
 * Real express-session with server.js's own options (S2-2), over the loopback
 * harness (see tests/unit/email-auth-csrf.test.js for the precedent note).
 * To exercise the POST-side guard without the UI (the refusal page has no
 * button), the victim's browser opens the confirm page while signed out, then
 * signs in as P through the harness's `/__test/sign-in` (the real
 * `establishAccount`, without a regenerate), then POSTs the minted nonce.
 *
 * Run with: node --test tests/unit/email-auth-n2.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { startEmailAuthHarness, tokenFromOutbox, sha256 } from '../fixtures/email-auth-harness.js';

describe('N2: a sign-in link never attaches an email to a live account', () => {
  let harness;
  let counter = 0;

  before(async () => { harness = await startEmailAuthHarness(); });
  after(async () => { await harness?.close(); });

  const identities = async accountId => (await harness.stores.accountStore.getAccount(accountId)).identities.map(i => `${i.provider}:${i.scope}`);

  // The attacker requests a sign-in link for their own address, in their own browser.
  async function attackerLink(email) {
    const attacker = harness.browser();
    await attacker.requestLink(email);
    return tokenFromOutbox(harness.transport, email);
  }

  // The attacker already owns an email account A for `email`.
  async function attackerAccount(email) {
    const t = await attackerLink(email);
    const browser = harness.browser();
    const { nonce } = await browser.openConfirm(t);
    assert.strictEqual((await browser.confirm(t, nonce)).status, 302);
    return (await browser.session()).accountId;
  }

  async function signInAsLinear(browser, { staleAuth = false } = {}) {
    const n = counter++;
    const res = await browser.post('/__test/sign-in', { provider: 'linear', scope: `victim-${n}`, workspaceId: `ws-victim-${n}`, ...(staleAuth ? { staleAuth: '1' } : {}) });
    return JSON.parse(res.text).accountId;
  }

  async function assertRefusedCleanly({ victim, P, t, email, A = null }) {
    assert.deepStrictEqual((await identities(P)).filter(s => s.startsWith('email:')), [], 'no email on P');
    const owner = await harness.stores.accountStore.findAccountByIdentity('email', email);
    assert.strictEqual(owner?._id ?? null, A, A ? 'the address is still only on A' : 'no account holds the address');
    const session = await victim.session();
    assert.strictEqual(session.accountId, P, 'the victim is still P');
    assert.strictEqual(session.pendingMerge, undefined, 'no merge offered');
    if (t) assert.strictEqual((await harness.db.collection('email-magic-links').findOne({ _id: sha256(t) })).consumedAt, null, 'nothing consumed');
  }

  test('the signed-in victim\'s GET shows the refusal, with no confirm form', async () => {
    const email = `attacker${counter++}@evil.test`;
    const t = await attackerLink(email);
    const victim = harness.browser();
    const P = await signInAsLinear(victim);

    const { res } = await victim.openConfirm(t);
    assert.strictEqual(res.status, 409);
    assert.match(res.text, /data-testid="email-confirm-signed-in-refused"/);
    assert.doesNotMatch(res.text, /data-testid="email-confirm-form"/);
    assert.doesNotMatch(res.text, /action="\/auth\/email\/confirm"/);
    await assertRefusedCleanly({ victim, P, t, email });
  });

  test('POST (bypassing the UI, valid cookie + minted nonce) → 409; nothing attached, consumed, or offered; the token still works signed out', async () => {
    const email = `attacker${counter++}@evil.test`;
    const t = await attackerLink(email);
    const victim = harness.browser();
    const { nonce } = await victim.openConfirm(t); // opened while signed out
    const P = await signInAsLinear(victim);

    const res = await victim.confirm(t, nonce);
    assert.strictEqual(res.status, 409);
    assert.match(res.text, /data-testid="email-confirm-signed-in-refused"/);
    assert.deepStrictEqual(await identities(P), [`linear:victim-${counter - 1}`], 'P\'s identities are exactly [linear]');
    await assertRefusedCleanly({ victim, P, t, email });

    // The refusal consumed nothing: the same token signs in a signed-out browser.
    const other = harness.browser();
    const { nonce: n2 } = await other.openConfirm(t);
    assert.strictEqual((await other.confirm(t, n2)).status, 302);
    const owner = await harness.stores.accountStore.findAccountByIdentity('email', email);
    assert.ok(owner && owner._id !== P, 'signed in as the address\'s own (new) account, not P');
    assert.strictEqual((await other.session()).accountId, owner._id);
  });

  test('the address already on the attacker\'s account A → 409, no merge offer, P and A unchanged', async () => {
    const email = `attacker${counter++}@evil.test`;
    const A = await attackerAccount(email);
    const t = await attackerLink(email);
    const victim = harness.browser();
    const { nonce } = await victim.openConfirm(t);
    const P = await signInAsLinear(victim);
    const pBefore = await identities(P);

    const res = await victim.confirm(t, nonce);
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(await identities(P), pBefore);
    assert.deepStrictEqual(await identities(A), [`email:${email}`]);
    await assertRefusedCleanly({ victim, P, t, email, A });
  });

  test('race closure (c′): the owner is P before consume and A after → refused, P unchanged', async () => {
    const email = `attacker${counter++}@evil.test`;
    const A = await attackerAccount(email);
    const t = await attackerLink(email);
    const victim = harness.browser();
    const { nonce } = await victim.openConfirm(t);
    const P = await signInAsLinear(victim);
    const pBefore = await identities(P);

    const store = harness.stores.accountStore;
    const real = store.findAccountByIdentity;
    let emailLookups = 0;
    store.findAccountByIdentity = async function (provider, scope) {
      if (provider === 'email' && scope === email && emailLookups++ === 0) {
        return { _id: P }; // (b′) sees P as the owner…
      }
      return real.call(this, provider, scope); // …(c′) sees the real owner, A.
    };
    try {
      const res = await victim.confirm(t, nonce);
      assert.strictEqual(res.status, 409);
      assert.match(res.text, /data-testid="email-confirm-signed-in-refused"/);
    } finally {
      store.findAccountByIdentity = real;
    }
    assert.strictEqual(emailLookups, 2, 'the owner was checked before and after consume');
    assert.deepStrictEqual(await identities(P), pBefore);
    assert.deepStrictEqual(await identities(A), [`email:${email}`]);
    const session = await victim.session();
    assert.strictEqual(session.accountId, P);
    assert.strictEqual(session.pendingMerge, undefined);
    assert.ok((await harness.db.collection('email-magic-links').findOne({ _id: sha256(t) })).consumedAt, 'the token is spent (harmless: nothing attached)');
  });

  test('race closure (c′), unowned after consume: refused, nothing attached', async () => {
    const email = `attacker${counter++}@evil.test`;
    const t = await attackerLink(email); // no attacker account: the address is unowned
    const victim = harness.browser();
    const { nonce } = await victim.openConfirm(t);
    const P = await signInAsLinear(victim);
    const pBefore = await identities(P);

    const store = harness.stores.accountStore;
    const real = store.findAccountByIdentity;
    let emailLookups = 0;
    store.findAccountByIdentity = async function (provider, scope) {
      if (provider === 'email' && scope === email && emailLookups++ === 0) {
        return { _id: P }; // (b′) sees P as the owner…
      }
      return real.call(this, provider, scope); // …(c′) sees nobody: the address stayed unowned.
    };
    try {
      const res = await victim.confirm(t, nonce);
      assert.strictEqual(res.status, 409);
      assert.match(res.text, /data-testid="email-confirm-signed-in-refused"/);
    } finally {
      store.findAccountByIdentity = real;
    }
    assert.strictEqual(emailLookups, 2, 'the owner was checked before and after consume');
    assert.deepStrictEqual(await identities(P), pBefore);
    assert.deepStrictEqual((await identities(P)).filter(s => s.startsWith('email:')), [], 'no email on P');
    assert.strictEqual(await store.findAccountByIdentity('email', email), null, 'no account holds the address');
    const session = await victim.session();
    assert.strictEqual(session.accountId, P);
    assert.strictEqual(session.pendingMerge, undefined);
    assert.ok((await harness.db.collection('email-magic-links').findOne({ _id: sha256(t) })).consumedAt, 'the token is spent (harmless: nothing attached)');
  });

  test('positive control: P already holds p@x.io — confirming its sign-in link re-stamps freshness and links nothing new', async () => {
    const email = `p${counter++}@x.io`;
    const victim = harness.browser();
    const P = await signInAsLinear(victim);
    await victim.post('/__test/sign-in', { provider: 'email', scope: email, staleAuth: '1' });
    const pBefore = await identities(P);
    assert.strictEqual((await victim.session()).identityAuthenticatedAt, 0);

    const t = await attackerLink(email); // requested from a signed-out browser
    const { res: page, nonce } = await victim.openConfirm(t);
    assert.strictEqual(page.status, 200);
    assert.match(page.text, /data-testid="email-confirm-already-signed-in"/);
    const res = await victim.confirm(t, nonce);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.location, `/workspace/ws-victim-${counter - 1}/`, 'back to P\'s first workspace');

    assert.deepStrictEqual(await identities(P), pBefore, 'identities unchanged');
    const session = await victim.session();
    assert.strictEqual(session.accountId, P);
    assert.ok(session.identityAuthenticatedAt > 0, 'freshness re-stamped');
    assert.strictEqual(session.workspaces.length, 1, 'carried workspaces survive the regenerate');
  });

  test('positive control (canonical): an address on an account merged into P counts as P\'s — GET shows the confirm, POST signs in as P, nothing new linked', async () => {
    const email = `merged${counter++}@x.io`;
    // E is a separate, email-only account created through the real door.
    const E = await attackerAccount(email);
    const victim = harness.browser();
    const P = await signInAsLinear(victim);
    const pBefore = await identities(P);

    // Fold E into P. `mergeAccounts` moves only `mergedInto`; E keeps the
    // email identity, so a raw comparison would see the address as foreign.
    const merged = await harness.stores.accountStore.mergeAccounts(P, E, {
      accountWorkspaceStore: harness.stores.accountWorkspaceStore,
    });
    assert.ok(merged.ok, 'E merged into P');

    const t = await attackerLink(email); // requested from a signed-out browser
    const { res: page, nonce } = await victim.openConfirm(t);
    assert.strictEqual(page.status, 200, 'P\'s own (merged) address gets the confirm page');
    assert.doesNotMatch(page.text, /data-testid="email-confirm-signed-in-refused"/);
    assert.match(page.text, /data-testid="email-confirm-already-signed-in"/);

    const post = await victim.confirm(t, nonce);
    assert.strictEqual(post.status, 302, 'the confirm signs in as P, not refused');
    assert.strictEqual((await victim.session()).accountId, P, 'still P');
    assert.deepStrictEqual(await identities(P), pBefore, 'P gained no duplicate email identity');
    assert.deepStrictEqual(await identities(E), [`email:${email}`], 'E keeps the address (canonicalised, not re-linked)');
  });

  test('signed-in send: POST /auth/email/send from P\'s session shows "You\'re signed in" and issues no token', async () => {
    const victim = harness.browser();
    const { nonce } = await victim.openForm(); // form opened while signed out
    await signInAsLinear(victim);
    const before = await harness.db.collection('email-magic-links').countDocuments({});

    const res = await victim.post('/auth/email/send', { email: `new${counter++}@x.io`, nonce });

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /data-testid="email-signed-in"/);
    assert.strictEqual(await harness.db.collection('email-magic-links').countDocuments({}), before, 'no token issued');
  });

  test('signed-in GET /auth/email shows "You\'re signed in" with no form', async () => {
    const victim = harness.browser();
    await signInAsLinear(victim);
    const { res, nonce } = await victim.openForm();
    assert.match(res.text, /data-testid="email-signed-in"/);
    assert.strictEqual(nonce, null);
    assert.doesNotMatch(res.text, /email-signin-form/);
  });
});
