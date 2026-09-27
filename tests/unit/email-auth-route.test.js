/**
 * W1 — the runtime witness for LIN-1892's leg criterion "A new person can
 * sign in by email" (plan S2 Tests, W1).
 *
 * Drives the real `createEmailAuthRoutes` over real MangoDB stores, real
 * express-session and the capture transport (tests/fixtures/email-auth-harness.js),
 * with `globalThis.fetch` stubbed to throw: the capture transport must deliver
 * the link without any network call, and network-guard.js can't see `fetch`.
 *
 * Failed before routes/email-auth.js existed (ERR_MODULE_NOT_FOUND); see the
 * LIN-1892 S2 notes for the before/after runs.
 *
 * Run with: node --test tests/unit/email-auth-route.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { startEmailAuthHarness, tokenFromOutbox, sha256 } from '../fixtures/email-auth-harness.js';

describe('W1: a new person can sign in by email', () => {
  let harness;
  let originalFetch;
  let fetchCalls = 0;

  before(async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('fetch is not allowed in W1');
    };
    harness = await startEmailAuthHarness();
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await harness?.close();
  });

  test('send → GET confirm (no consume) → POST confirm → a fresh email-only account, signed in, at /account', async () => {
    const accounts = harness.db.collection('accounts');
    const links = harness.db.collection('email-magic-links');
    const sessions = harness.db.collection('sessions');
    const browser = harness.browser();

    // 1. Send: the link is captured.
    const sent = await browser.requestLink('a@x.io');
    assert.strictEqual(sent.status, 200);
    assert.match(sent.text, /data-testid="email-check-inbox"/);
    const t = tokenFromOutbox(harness.transport, 'a@x.io');
    assert.ok(t, 'a sign-in link was captured for a@x.io');

    // 2. GET confirm: shows the address and a POST button, does NOT consume,
    //    and mints the confirm nonce into this browser's session.
    const { res: page, nonce } = await browser.openConfirm(t);
    assert.strictEqual(page.status, 200);
    assert.match(page.text, /data-testid="email-confirm-form"/);
    assert.match(page.text, /a@x\.io/);
    assert.ok(nonce, 'the confirm page carries a nonce');
    assert.strictEqual((await links.findOne({ _id: sha256(t) })).consumedAt, null, 'GET never consumes');
    const minted = await sessions.findOne({ 'session.emailConfirm.tokenHash': sha256(t) });
    assert.ok(minted, 'session.emailConfirm is minted, bound to this token');
    const sidBefore = browser.sid;

    // 3. POST confirm: a new account whose identities are exactly [email].
    const confirmed = await browser.confirm(t, nonce);
    assert.strictEqual(confirmed.status, 302);
    assert.strictEqual(confirmed.location, '/account');
    assert.notStrictEqual(browser.sid, sidBefore, 'the session was regenerated (new session id)');

    const signedIn = await browser.session();
    assert.ok(signedIn.accountId, 'session.accountId is set');
    assert.ok(Number.isFinite(signedIn.identityAuthenticatedAt), 'identityAuthenticatedAt is stamped');
    assert.strictEqual(signedIn.emailConfirm, undefined, 'the confirm nonce did not survive');
    const all = await accounts.find({}).toArray();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0]._id, signedIn.accountId);
    assert.deepStrictEqual(all[0].identities, [{ provider: 'email', scope: 'a@x.io', credentials: {} }]);
    assert.strictEqual(await harness.db.collection('account-workspaces').countDocuments({}), 0, 'no workspace edge');
    assert.ok((await links.findOne({ _id: sha256(t) })).consumedAt instanceof Date, 'the link is spent');

    // 4. Replay: the spent link is refused, nothing new is created.
    const replayPage = await browser.openConfirm(t);
    assert.strictEqual(replayPage.res.status, 410);
    assert.match(replayPage.res.text, /data-testid="email-link-expired"/);
    assert.strictEqual(replayPage.nonce, null, 'an expired link mints no nonce');
    const replayPost = await browser.confirm(t, nonce);
    assert.strictEqual(replayPost.status, 403);
    assert.strictEqual(await accounts.countDocuments({}), 1);

    // 5. A new, empty browser with the same address in mixed case and padding
    //    reaches the SAME account; the account count is unchanged.
    const second = harness.browser();
    await second.requestLink(' A@X.io ');
    const t2 = tokenFromOutbox(harness.transport, 'a@x.io');
    assert.ok(t2 && t2 !== t, 'a second, distinct link');
    const { nonce: nonce2 } = await second.openConfirm(t2);
    const confirmed2 = await second.confirm(t2, nonce2);
    assert.strictEqual(confirmed2.status, 302);
    assert.strictEqual(confirmed2.location, '/account');
    assert.strictEqual((await second.session()).accountId, signedIn.accountId, 'same account');
    assert.strictEqual(await accounts.countDocuments({}), 1, 'no second account');

    // 6. No network: the capture transport never touched fetch.
    assert.strictEqual(fetchCalls, 0);
  });
});
