/**
 * LIN-1892 S3 — link-mode provider→email join and F16.
 *
 * Link mode is the ONLY email path that attaches an email identity to a
 * live account (plan §"Link mode, defined by N2"). A token is minted only by
 * a signed-in session (`GET /auth/email/register` → `POST /auth/email/send`
 * with `mode=link`), bound to that session's canonical account, and its
 * confirm runs only in a session whose canonical account is the bound one.
 *
 * Drives the real routes over the loopback harness (real express-session,
 * real MangoDB stores, capture transport). `globalThis.fetch` is stubbed to
 * throw, as in W1.
 *
 * F16 (carried): the N2 canonicalisation helper's resolver-failure path is
 * unpinned — mutant D1 (degrade to `null` instead of the raw id) would make a
 * throwing resolver fail OPEN (both sides resolve to `null`, compare equal).
 * This file pins "resolver throws → the link is refused at GET and POST".
 *
 * Run with: node --test tests/unit/email-link-mode.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { startEmailAuthHarness, tokenFromOutbox, hiddenField, sha256 } from '../fixtures/email-auth-harness.js';

describe('S3 link mode: a signed-in provider user attaches an email identity', () => {
  let harness;
  let originalFetch;
  let fetchCalls = 0;
  let counter = 0;

  before(async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error('fetch is not allowed'); };
    harness = await startEmailAuthHarness();
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await harness?.close();
  });

  const identities = async accountId => (await harness.stores.accountStore.getAccount(accountId)).identities.map(i => `${i.provider}:${i.scope}`);

  async function signInAsLinear(browser, { workspaceId = true } = {}) {
    const n = counter++;
    const res = await browser.post('/__test/sign-in', {
      provider: 'linear',
      scope: `user-${n}`,
      ...(workspaceId ? { workspaceId: `ws-link-${n}`, urlKey: `ws-link-${n}` } : {}),
    });
    return JSON.parse(res.text).accountId;
  }

  /** Mint a link-mode token for the browser's own live account. Returns { t, nonce }. */
  async function requestLinkMode(browser, email, { next } = {}) {
    const reg = await browser.get(`/auth/email/register${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    assert.strictEqual(reg.status, 200, 'the register page renders for a signed-in session');
    const nonce = hiddenField(reg.text, 'nonce');
    assert.ok(nonce, 'the register page mints a send nonce');
    const submittedNext = hiddenField(reg.text, 'next');
    const sent = await browser.post('/auth/email/send', {
      email,
      nonce,
      mode: 'link',
      ...(submittedNext ? { next: submittedNext } : {}),
    }, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.strictEqual(sent.status, 200, 'the send page renders');
    return { t: tokenFromOutbox(harness.transport, email.trim().toLowerCase()), nonce };
  }

  test('same session: confirm attaches the email, no new account, and no regenerate', async () => {
    const accounts = harness.db.collection('accounts');
    const links = harness.db.collection('email-magic-links');
    const browser = harness.browser();
    const P = await signInAsLinear(browser);
    const accountsBefore = await accounts.countDocuments({});

    const { t } = await requestLinkMode(browser, 'add@x.io');
    assert.ok(t, 'a link-mode token was captured');

    const sidBefore = browser.sid;
    const { res: page, nonce } = await browser.openConfirm(t);
    assert.strictEqual(page.status, 200);
    assert.match(page.text, /data-testid="email-link-confirm-page"/);
    assert.match(page.text, /add@x\.io/);
    assert.strictEqual((await links.findOne({ _id: sha256(t) })).consumedAt, null, 'GET never consumes');

    const confirmed = await browser.confirm(t, nonce);
    assert.strictEqual(confirmed.status, 302);
    assert.strictEqual(confirmed.location, `/workspace/ws-link-${counter - 1}/`);

    assert.strictEqual(browser.sid, sidBefore, 'link mode skips regenerate (not a new sign-in)');
    assert.deepStrictEqual((await identities(P)).sort(), [`email:add@x.io`, `linear:user-${counter - 1}`].sort());
    assert.strictEqual(await accounts.countDocuments({}), accountsBefore, 'no new account');
    assert.strictEqual((await browser.session()).accountId, P);
    assert.ok((await links.findOne({ _id: sha256(t) })).consumedAt instanceof Date, 'the link is spent');
    assert.strictEqual(fetchCalls, 0);
  });

  test('a different session (signed out) cannot confirm; nothing written, token not consumed, then P can', async () => {
    const links = harness.db.collection('email-magic-links');
    const owner = harness.browser();
    const P = await signInAsLinear(owner);
    const { t } = await requestLinkMode(owner, 'private@x.io');

    const stranger = harness.browser();
    const { res: getPage, nonce: strangerNonce } = await stranger.openConfirm(t);
    assert.strictEqual(getPage.status, 409, 'a link-mode token in another browser is refused');
    assert.match(getPage.text, /data-testid="email-link-wrong-browser"/);
    assert.doesNotMatch(getPage.text, /data-testid="email-link-confirm-form"/);
    assert.strictEqual((await links.findOne({ _id: sha256(t) })).consumedAt, null, 'GET refusal consumes nothing');

    // The nonce is minted before the refusal, so the POST-side guard runs on
    // its own and refuses too (rather than bouncing off the CSRF nonce check).
    const post = await stranger.confirm(t, strangerNonce);
    assert.strictEqual(post.status, 409);
    assert.strictEqual(await harness.stores.accountStore.findAccountByIdentity('email', 'private@x.io'), null);
    assert.strictEqual((await links.findOne({ _id: sha256(t) })).consumedAt, null, 'POST refusal consumes nothing');

    // The refusal did not burn the token: P's own browser still works.
    const { nonce } = await owner.openConfirm(t);
    assert.strictEqual((await owner.confirm(t, nonce)).status, 302);
    assert.ok((await identities(P)).includes('email:private@x.io'));
  });

  test('a session signed in as a different account is refused; token not consumed', async () => {
    const links = harness.db.collection('email-magic-links');
    const owner = harness.browser();
    await signInAsLinear(owner);
    const { t } = await requestLinkMode(owner, 'owned@x.io');

    const other = harness.browser();
    const Q = await signInAsLinear(other);
    const { res: page, nonce } = await other.openConfirm(t);
    assert.strictEqual(page.status, 409);
    assert.match(page.text, /data-testid="email-link-wrong-browser"/);
    const post = await other.confirm(t, nonce);
    assert.strictEqual(post.status, 409);
    assert.deepStrictEqual((await identities(Q)).filter(s => s.startsWith('email:')), []);
    assert.strictEqual((await links.findOne({ _id: sha256(t) })).consumedAt, null, 'nothing consumed');
  });

  test('link mode honors a safe next, and ignores an off-site one', async () => {
    const browser = harness.browser();
    await signInAsLinear(browser);
    const target = `/workspace/ws-link-${counter - 1}/settings`;
    const { t } = await requestLinkMode(browser, 'next@x.io', { next: target });
    const { nonce } = await browser.openConfirm(t);
    const confirmed = await browser.confirm(t, nonce);
    assert.strictEqual(confirmed.status, 302);
    assert.strictEqual(confirmed.location, target);

    // An off-site `next` is dropped: land on the first workspace instead.
    const evil = harness.browser();
    await signInAsLinear(evil);
    const { t: t2 } = await requestLinkMode(evil, 'next2@x.io', { next: 'https://evil.test/steal' });
    const { nonce: n2 } = await evil.openConfirm(t2);
    const c2 = await evil.confirm(t2, n2);
    assert.strictEqual(c2.status, 302);
    assert.doesNotMatch(c2.location, /evil\.test/);
    assert.strictEqual(c2.location, `/workspace/ws-link-${counter - 1}/`);
  });

  test('link-mode send without a live account is refused and issues no token', async () => {
    const links = harness.db.collection('email-magic-links');
    const before = await links.countDocuments({});
    const anon = harness.browser();
    const { nonce } = await anon.openForm();
    const res = await anon.post('/auth/email/send', { email: 'nobody@x.io', nonce, mode: 'link' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(await links.countDocuments({}), before, 'no token issued');
  });

  test('register pre-fills the email from the account\'s Jira identity credentials.email', async () => {
    const browser = harness.browser();
    const P = await signInAsLinear(browser);
    const linked = await harness.stores.accountStore.linkIdentity(P, 'jira', `jira-${counter++}`, { email: 'Jira.Person@x.io' });
    assert.ok(linked.ok);

    const reg = await browser.get('/auth/email/register');
    assert.strictEqual(reg.status, 200);
    assert.match(reg.text, /value="jira\.person@x\.io"/, 'the stored Jira email is offered, normalised for the field');

    // No Jira email stored → no pre-fill value.
    const other = harness.browser();
    await signInAsLinear(other);
    const blank = await other.get('/auth/email/register');
    assert.doesNotMatch(blank.text, /name="email"[^>]*value="[^"]+"/);
  });

  test('register requires a signed-in session', async () => {
    const anon = harness.browser();
    const res = await anon.get('/auth/email/register');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.location, '/');
  });

  test('F16: a throwing canonical resolver refuses the link at GET and POST rather than failing open', async () => {
    const links = harness.db.collection('email-magic-links');

    // Attacker owns account A and mints a link-mode token bound to A.
    const attacker = harness.browser();
    const A = await signInAsLinear(attacker);
    const email = `f16-${counter++}@evil.test`;
    const { t } = await requestLinkMode(attacker, email);

    // Victim is signed in as P in another browser.
    const victim = harness.browser();
    const P = await signInAsLinear(victim);
    assert.notStrictEqual(A, P);

    const store = harness.stores.accountStore;
    const real = store.resolveCanonicalAccountId;
    store.resolveCanonicalAccountId = async () => { throw new Error('resolver down (F16)'); };
    try {
      // GET: the same-account check must run with the resolver down and refuse.
      const { res: page, nonce } = await victim.openConfirm(t);
      assert.strictEqual(page.status, 409, 'GET refuses when canonicalisation throws');
      assert.match(page.text, /data-testid="email-link-wrong-browser"/);
      assert.doesNotMatch(page.text, /data-testid="email-link-confirm-form"/);
      assert.strictEqual((await links.findOne({ _id: sha256(t) })).consumedAt, null, 'GET consumed nothing');

      // POST: the nonce was minted before the refusal, so the POST-side guard
      // is exercised on its own. It must also refuse, not attach.
      const post = await victim.confirm(t, nonce);
      assert.strictEqual(post.status, 409, 'POST refuses when canonicalisation throws');
      assert.deepStrictEqual((await identities(P)).filter(s => s.startsWith('email:')), [], 'no email attached to P');
      assert.strictEqual(await store.findAccountByIdentity('email', email), null, 'no account holds the address');
      assert.strictEqual((await links.findOne({ _id: sha256(t) })).consumedAt, null, 'POST consumed nothing');
    } finally {
      store.resolveCanonicalAccountId = real;
    }
  });
});
