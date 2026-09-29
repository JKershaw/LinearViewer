/**
 * LIN-1892 S3-4 — the working re-proof for an email-only live account.
 *
 * A stale email-only P cannot re-prove itself by visiting `/auth/email` (a
 * signed-in session only sees "You're signed in" there). The working re-proof
 * is `GET /auth/email/reproof` → a SIGN-IN-mode magic link to an address
 * already on P, whose consume re-stamps P's freshness through the existing N2
 * positive control. This is the target every stale provider conflict offers an
 * email-only P (S3-1 for link mode, S3-4 for the Linear/GitHub/Jira arms).
 *
 * Run with: node --test tests/unit/email-reproof.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { startEmailAuthHarness, tokenFromOutbox, hiddenField, sha256 } from '../fixtures/email-auth-harness.js';
import { reproofUrlForAccount, EMAIL_REPROOF_URL } from '../../lib/account-conflict.js';
import { AccountStore } from '../../lib/account-store.js';

describe('reproofUrlForAccount (S3-4)', () => {
  const store = {
    getAccount: async (id) => {
      if (id === 'email-only') return { _id: id, identities: [{ provider: 'email', scope: 'p@x.io', credentials: {} }] };
      if (id === 'provider') return { _id: id, identities: [{ provider: 'linear', scope: 'v', credentials: {} }] };
      if (id === 'local-only') return { _id: id, identities: [{ provider: 'local', scope: 'w', credentials: {} }] };
      return null;
    },
    listEmailIdentities: async (id) => {
      const account = await store.getAccount(id);
      return (account?.identities || []).filter(i => i.provider === 'email').map(i => i.scope);
    },
  };

  test('an email-only account gets the email re-proof route', async () => {
    assert.strictEqual(await reproofUrlForAccount(store, 'email-only', '/auth/linear'), EMAIL_REPROOF_URL);
  });

  test('a provider account keeps the arm\'s existing re-auth URL', async () => {
    assert.strictEqual(await reproofUrlForAccount(store, 'provider', '/auth/linear'), '/auth/linear');
  });

  test('a local-only account and a missing/unknown account keep the default', async () => {
    assert.strictEqual(await reproofUrlForAccount(store, 'local-only', '/auth/jira/oauth?mode=new'), '/auth/jira/oauth?mode=new');
    assert.strictEqual(await reproofUrlForAccount(store, null, '/auth/github'), '/auth/github');
    assert.strictEqual(await reproofUrlForAccount(store, 'nope', '/auth/github'), '/auth/github');
  });

  test('a store that throws degrades to the default (fails closed to the arm URL)', async () => {
    const throwing = {
      getAccount: async () => { throw new Error('store down'); },
      listEmailIdentities: async () => { throw new Error('store down'); },
    };
    assert.strictEqual(await reproofUrlForAccount(throwing, 'email-only', '/auth/linear'), '/auth/linear');
  });
});

describe('reproofUrlForAccount uses the chain-aware email read (D2)', () => {
  let dbDir;
  let client;
  let s;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'email-reproof-d2-'));
    client = new MangoClient(dbDir);
    await client.connect();
    s = new AccountStore({ collection: client.db('d2').collection('accounts') });
  });
  after(async () => { if (client?.close) await client.close(); if (dbDir) rmSync(dbDir, { recursive: true, force: true }); });

  test('an address that lives only on a merged-away account still selects the email re-proof route', async () => {
    const P = await s.createAccount();
    await s.linkIdentity(P._id, 'local', 'p-local');
    const E = await s.createAccount();
    await s.linkIdentity(E._id, 'email', 'y@x.io');
    await s.mergeAccounts(P._id, E._id, {});

    assert.strictEqual(await reproofUrlForAccount(s, P._id, '/auth/linear'), EMAIL_REPROOF_URL);
  });
});

describe('GET /auth/email/reproof (S3-4)', () => {
  let harness;
  before(async () => { harness = await startEmailAuthHarness(); });
  after(async () => { await harness?.close(); });

  async function signInByEmail(browser, email) {
    await browser.requestLink(email);
    const t = tokenFromOutbox(harness.transport, email);
    const { nonce } = await browser.openConfirm(t);
    const res = await browser.confirm(t, nonce);
    assert.strictEqual(res.status, 302);
    return (await browser.session()).accountId;
  }

  test('signed out → redirect to /', async () => {
    const res = await harness.browser().get('/auth/email/reproof');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.location, '/');
  });

  test('an address not on P cannot be re-proof-sent: 403 and no token issued', async () => {
    const browser = harness.browser();
    await signInByEmail(browser, `reproof-denied-${Date.now()}@x.io`);
    const page = await browser.get('/auth/email/reproof');
    const nonce = hiddenField(page.text, 'nonce');
    const before = await harness.db.collection('email-magic-links').countDocuments({});
    const res = await browser.post('/auth/email/send', { email: 'someone-else@y.io', nonce, mode: 'reproof' }, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(await harness.db.collection('email-magic-links').countDocuments({}), before, 'no token issued');
  });

  test('the full re-proof: email-only P → link to P\'s own address → confirm re-stamps freshness, no identity change', async () => {
    const browser = harness.browser();
    const email = `reproof-${Date.now()}@x.io`;
    const P = await signInByEmail(browser, email);

    // P goes stale (its freshness window has lapsed).
    await browser.post('/__test/sign-in', { provider: 'email', scope: email, staleAuth: '1' });
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0);

    // The re-proof page offers a sign-in link to P's own address.
    const page = await browser.get('/auth/email/reproof');
    assert.strictEqual(page.status, 200);
    assert.match(page.text, /data-testid="email-reproof-page"/);
    assert.match(page.text, new RegExp(`value="${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    const nonce = hiddenField(page.text, 'nonce');
    assert.strictEqual(hiddenField(page.text, 'mode'), 'reproof');

    const sent = await browser.post('/auth/email/send', { email, nonce, mode: 'reproof' }, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.strictEqual(sent.status, 200);
    assert.match(sent.text, /data-testid="email-check-inbox"/);
    const t = tokenFromOutbox(harness.transport, email);
    assert.ok(t, 'a sign-in link was captured');

    // Opening + confirming it in the SAME live session is the N2 positive
    // control: it re-stamps P and links nothing new.
    const { res: confirmPage, nonce: cnonce } = await browser.openConfirm(t);
    assert.strictEqual(confirmPage.status, 200);
    assert.match(confirmPage.text, /data-testid="email-confirm-already-signed-in"/);
    const confirmed = await browser.confirm(t, cnonce);
    assert.strictEqual(confirmed.status, 302);

    const session = await browser.session();
    assert.strictEqual(session.accountId, P, 'still the same account');
    assert.ok(session.identityAuthenticatedAt > 0, 'freshness was re-stamped by the re-proof');
    const identities = (await harness.stores.accountStore.getAccount(P)).identities.map(i => `${i.provider}:${i.scope}`);
    assert.deepStrictEqual(identities, [`email:${email}`], 'no new identity');
    assert.ok((await harness.db.collection('email-magic-links').findOne({ _id: sha256(t) })).consumedAt, 'the re-proof link was consumed');
  });
});
