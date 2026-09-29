/**
 * LIN-1892 §G1 — the login-CSRF defence on `POST /auth/email/confirm`, and
 * the send-nonce hardening on `POST /auth/email/send`.
 *
 * Runs REAL express-session with the SAME options object server.js uses
 * (`createSessionOptions`, lib/session-options.js — verdict 0def5b66 S2-2),
 * over the loopback harness tests/fixtures/email-auth-harness.js. The loopback
 * shape follows tests/unit/lin-1890-jira-entry-layer.test.js (127.0.0.1,
 * LIN-2023); that file injects a fake `req.session`, whereas the defence here
 * rests on real cookie behaviour: no cookie → an empty session with no
 * confirm nonce, and `saveUninitialized:false` → no Set-Cookie on a refusal.
 *
 * Every adversarial case checks the three things a refusal must guarantee:
 * 403, the token NOT consumed and nothing written, and the same token still
 * confirming afterwards from the legitimate browser.
 *
 * Run with: node --test tests/unit/email-auth-csrf.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEmailAuthHarness, tokenFromOutbox, hiddenField, sha256 } from '../fixtures/email-auth-harness.js';
import { EMAIL_NONCE_MAX_AGE_MS } from '../../lib/email-auth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CROSS_SITE = { 'Sec-Fetch-Site': 'cross-site' };

describe('email confirm login-CSRF defence (G1)', () => {
  let harness;
  const nonceClock = { ms: Date.now() };
  let counter = 0;

  before(async () => {
    harness = await startEmailAuthHarness({ nonceClock });
  });
  after(async () => { await harness?.close(); });

  // A fresh address and link per case; the requesting browser is the victim's
  // own legitimate browser.
  async function freshLink() {
    const email = `user${counter++}@x.io`;
    const legit = harness.browser();
    await legit.requestLink(email);
    return { email, legit, t: tokenFromOutbox(harness.transport, email) };
  }

  async function assertNothingHappened(t, email) {
    const link = await harness.db.collection('email-magic-links').findOne({ _id: sha256(t) });
    assert.strictEqual(link.consumedAt, null, 'the token was not consumed');
    assert.strictEqual(await harness.stores.accountStore.findAccountByIdentity('email', email), null, 'no account holds the address');
    assert.strictEqual(await harness.db.collection('account-workspaces').countDocuments({}), 0, 'no edge');
  }

  async function assertLegitStillWorks(legit, t, email) {
    const { nonce } = await legit.openConfirm(t);
    const res = await legit.confirm(t, nonce);
    assert.strictEqual(res.status, 302, 'the legitimate browser can still confirm the same token');
    assert.strictEqual(res.location, '/account');
    const account = await harness.stores.accountStore.findAccountByIdentity('email', email);
    assert.ok(account, 'signed in as the address');
    assert.strictEqual((await legit.session()).accountId, account._id);
  }

  test('no cookie (a cross-site POST carries none under sameSite=lax): 403, no Set-Cookie, nothing consumed', async () => {
    const { email, legit, t } = await freshLink();
    const attacker = harness.browser();
    const res = await attacker.confirm(t, 'N'.repeat(43), { headers: {} });
    assert.strictEqual(res.status, 403);
    assert.match(res.text, /data-testid="email-confirm-refused"/);
    assert.deepStrictEqual(res.setCookie, [], 'a refused, cookieless POST saves no session and sets no cookie');
    await assertNothingHappened(t, email);
    await assertLegitStillWorks(legit, t, email);
  });

  test('a cookie but no nonce: 403, nothing consumed', async () => {
    const { email, legit, t } = await freshLink();
    await legit.openConfirm(t);
    const res = await legit.confirm(t, undefined);
    assert.strictEqual(res.status, 403);
    await assertNothingHappened(t, email);
    await assertLegitStillWorks(legit, t, email);
  });

  test('a cookie and the wrong nonce: 403, nothing consumed', async () => {
    const { email, legit, t } = await freshLink();
    await legit.openConfirm(t);
    const res = await legit.confirm(t, 'N'.repeat(43));
    assert.strictEqual(res.status, 403);
    await assertNothingHappened(t, email);
    await assertLegitStillWorks(legit, t, email);
  });

  test('a nonce minted for a different token: 403, neither token consumed', async () => {
    const first = await freshLink();
    const second = await freshLink();
    const { nonce: nonceForFirst } = await second.legit.openConfirm(first.t);
    const res = await second.legit.confirm(second.t, nonceForFirst);
    assert.strictEqual(res.status, 403);
    await assertNothingHappened(second.t, second.email);
    await assertNothingHappened(first.t, first.email);
    await assertLegitStillWorks(second.legit, second.t, second.email);
  });

  test('a valid cookie and nonce, but Sec-Fetch-Site: cross-site: 403, nothing consumed', async () => {
    const { email, legit, t } = await freshLink();
    const { nonce } = await legit.openConfirm(t);
    const res = await legit.confirm(t, nonce, { headers: CROSS_SITE });
    assert.strictEqual(res.status, 403);
    await assertNothingHappened(t, email);
    await assertLegitStillWorks(legit, t, email);
  });

  test('Sec-Fetch-Site: same-site (a sibling subdomain) is refused too', async () => {
    const { email, legit, t } = await freshLink();
    const { nonce } = await legit.openConfirm(t);
    const res = await legit.confirm(t, nonce, { headers: { 'Sec-Fetch-Site': 'same-site' } });
    assert.strictEqual(res.status, 403);
    await assertNothingHappened(t, email);
  });

  test('a nonce older than 15 minutes: 403, nothing consumed', async () => {
    const { email, legit, t } = await freshLink();
    const { nonce } = await legit.openConfirm(t);
    nonceClock.ms += EMAIL_NONCE_MAX_AGE_MS + 1;
    try {
      const res = await legit.confirm(t, nonce);
      assert.strictEqual(res.status, 403);
      await assertNothingHappened(t, email);
    } finally {
      nonceClock.ms -= EMAIL_NONCE_MAX_AGE_MS + 1;
    }
    await assertLegitStillWorks(legit, t, email);
  });

  test('the refusal page links back to the non-consuming GET confirm URL', async () => {
    const { t } = await freshLink();
    const res = await harness.browser().confirm(t, 'N'.repeat(43), { headers: {} });
    assert.match(res.text, new RegExp(`href="/auth/email/confirm\\?t=${t}"`));
  });

  test('nonce replay: a second POST with the same nonce is refused', async () => {
    const { legit, t } = await freshLink();
    const { nonce } = await legit.openConfirm(t);
    assert.strictEqual((await legit.confirm(t, nonce)).status, 302);
    const replay = await legit.confirm(t, nonce);
    assert.strictEqual(replay.status, 403);
  });

  test('a failed attempt spends the nonce: the right nonce after a wrong one is refused', async () => {
    const { email, legit, t } = await freshLink();
    const { nonce } = await legit.openConfirm(t);
    assert.strictEqual((await legit.confirm(t, 'N'.repeat(43))).status, 403);
    assert.strictEqual((await legit.confirm(t, nonce)).status, 403);
    await assertNothingHappened(t, email);
    await assertLegitStillWorks(legit, t, email);
  });

  test('step-4 end to end: after a refused forged POST, the victim\'s Linear sign-in lands on the victim\'s own account', async () => {
    // The attacker owns an email account A.
    const attacker = harness.browser();
    await attacker.requestLink('attacker@evil.test');
    const t0 = tokenFromOutbox(harness.transport, 'attacker@evil.test');
    const { nonce: n0 } = await attacker.openConfirm(t0);
    assert.strictEqual((await attacker.confirm(t0, n0)).status, 302);
    const attackerAccountId = (await attacker.session()).accountId;
    // ...and requests a fresh sign-in link for the same address.
    const fresh = harness.browser();
    await fresh.requestLink('attacker@evil.test');
    const t = tokenFromOutbox(harness.transport, 'attacker@evil.test');

    // A cross-site auto-submitted form in the victim's (signed-out) browser.
    const victim = harness.browser();
    const forged = await victim.confirm(t, 'N'.repeat(43), { headers: CROSS_SITE });
    assert.strictEqual(forged.status, 403);
    assert.strictEqual((await victim.session()).accountId, undefined, 'the victim is not signed in as the attacker');

    // The victim then connects Linear.
    await victim.post('/__test/sign-in', { provider: 'linear', scope: 'victim-viewer', workspaceId: 'ws-victim' });
    const victimSession = await victim.session();
    const victimAccount = await harness.stores.accountStore.findAccountByIdentity('linear', 'victim-viewer');
    assert.strictEqual(victimSession.accountId, victimAccount._id);
    assert.notStrictEqual(victimAccount._id, attackerAccountId);

    const attackerAccount = await harness.stores.accountStore.getAccount(attackerAccountId);
    assert.deepStrictEqual(attackerAccount.identities, [{ provider: 'email', scope: 'attacker@evil.test', credentials: {} }]);
    assert.deepStrictEqual(await harness.stores.accountWorkspaceStore.listWorkspacesForAccount(attackerAccountId), [], 'no edge on the attacker\'s account');
    assert.strictEqual((await harness.db.collection('email-magic-links').findOne({ _id: sha256(t) })).consumedAt, null);
  });

  test('cross-browser: requested in A, confirmed in a fresh B — B is signed in and was told so; the same-browser page has no notice', async () => {
    const email = `cross${counter++}@x.io`;
    const laptop = harness.browser();
    await laptop.requestLink(email);
    const t = tokenFromOutbox(harness.transport, email);

    const phone = harness.browser();
    const { res: phonePage, nonce } = await phone.openConfirm(t);
    assert.match(phonePage.text, /data-testid="email-confirm-other-device"/);
    const res = await phone.confirm(t, nonce);
    assert.strictEqual(res.status, 302);
    assert.ok((await phone.session()).accountId, 'the phone is signed in');
    assert.strictEqual((await laptop.session()).accountId, undefined, 'the laptop stays signed out');

    const sameEmail = `same${counter++}@x.io`;
    const same = harness.browser();
    await same.requestLink(sameEmail);
    const { res: samePage } = await same.openConfirm(tokenFromOutbox(harness.transport, sameEmail));
    assert.match(samePage.text, /data-testid="email-confirm-form"/);
    assert.doesNotMatch(samePage.text, /email-confirm-other-device/);
  });

  test('headers: the GET confirm page cannot be framed, cached, or leak its URL', async () => {
    const { legit, t } = await freshLink();
    const { res } = await legit.openConfirm(t);
    assert.strictEqual(res.headers['content-security-policy'], "frame-ancestors 'none'");
    assert.strictEqual(res.headers['x-frame-options'], 'DENY');
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
  });

  test('the confirm button submits once (double-click guard)', async () => {
    const { legit, t } = await freshLink();
    const { res } = await legit.openConfirm(t);
    assert.match(res.text, /data-testid="email-confirm-form"[^>]*onsubmit="[^"]*b\.disabled=true/);
  });
});

describe('send nonce (hardening)', () => {
  let harness;
  before(async () => { harness = await startEmailAuthHarness(); });
  after(async () => { await harness?.close(); });

  async function linkCount() {
    return harness.db.collection('email-magic-links').countDocuments({});
  }

  test('no cookie: 403, no token issued, no Set-Cookie', async () => {
    const res = await harness.browser().post('/auth/email/send', { email: 'v@x.io', nonce: 'N'.repeat(43) }, { headers: CROSS_SITE });
    assert.strictEqual(res.status, 403);
    assert.match(res.text, /data-testid="email-send-refused"/);
    assert.deepStrictEqual(res.setCookie, []);
    assert.strictEqual(await linkCount(), 0);
    assert.strictEqual(harness.transport.outbox.length, 0);
  });

  test('a cookie but no nonce, or the wrong one: 403, no token issued, no Set-Cookie', async () => {
    const browser = harness.browser();
    await browser.openForm();
    for (const nonce of [undefined, 'N'.repeat(43)]) {
      const form = { email: 'v@x.io' };
      if (nonce) form.nonce = nonce;
      const res = await browser.post('/auth/email/send', form);
      assert.strictEqual(res.status, 403);
      assert.deepStrictEqual(res.setCookie, [], 'the refused request leaves the session untouched');
    }
    assert.strictEqual(await linkCount(), 0);
  });

  test('the form\'s own nonce sends', async () => {
    const browser = harness.browser();
    const { res: form, nonce } = await browser.openForm();
    assert.strictEqual(form.status, 200);
    assert.ok(nonce);
    assert.strictEqual(hiddenField(form.text, 'nonce'), nonce);
    const res = await browser.post('/auth/email/send', { email: 'ok@x.io', nonce });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await linkCount(), 1);
  });
});

describe('session options are server.js\'s own (S2-2)', () => {
  test('server.js builds its session middleware from createSessionOptions, with no inline copy', () => {
    const source = readFileSync(join(ROOT, 'server.js'), 'utf8');
    assert.match(source, /app\.use\(session\(createSessionOptions\(\{ store: sessionStore, secret: process\.env\.SESSION_SECRET \}\)\)\)/);
    assert.doesNotMatch(source, /saveUninitialized/, 'no second, inline options literal');
    const harnessSource = readFileSync(join(ROOT, 'tests/fixtures/email-auth-harness.js'), 'utf8');
    assert.match(harnessSource, /session\(createSessionOptions\(/);
  });
});
