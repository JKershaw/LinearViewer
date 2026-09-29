/**
 * LIN-1892 S3-4 / D3 (S3 review `94ee8f93`): the end-to-end witness the review's
 * S3-4 test clause demands — a stale, email-only account P is driven through a
 * REAL arm callback (Linear), offered the working email re-proof on the re-auth
 * page, re-proves itself in the SAME browser, and only then reaches the merge
 * offer on a retry of the same callback.
 *
 * One harness over the real express-session + MangoDB stores, with the REAL
 * email router AND the REAL `routes/auth.js` Linear OAuth callback mounted side
 * by side (a fake Linear provider stands in for the network, as
 * tests/unit/auth-route.test.js does). This is the whole S3-4 path in one test:
 * callback → re-auth page → reproof send → reproof confirm (the N2 positive
 * control) → callback retry → pendingMerge.
 *
 * Run with: node --test tests/unit/email-reproof-merge-witness.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { startEmailAuthHarness, tokenFromOutbox, hiddenField } from '../fixtures/email-auth-harness.js';
import { createAuthRoutes } from '../../routes/auth.js';

function fakeProvider() {
  return {
    name: 'linear',
    beginAuth: ({ state }) => `https://linear.app/oauth/authorize?state=${state}`,
    completeAuth: async () => ({ access_token: 'lin_tok', refresh_token: 'lin_refresh', expires_in: 86400 }),
    fetchOrganization: async () => ({ id: 'org-1', name: 'Acme', urlKey: 'acme' }),
    fetchViewer: async () => ({ id: 'viewer-1' }),
  };
}

const OAUTH_ENV = ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'];

describe('S3-4 end-to-end witness (D3): stale email-only P re-proofs, then the Linear retry reaches the merge offer', () => {
  let harness;
  let savedEnv;

  before(async () => {
    savedEnv = Object.fromEntries(OAUTH_ENV.map(k => [k, process.env[k]]));
    for (const k of OAUTH_ENV) process.env[k] = 'set';
    harness = await startEmailAuthHarness({
      mount: (app, stores) => app.use(createAuthRoutes({
        provider: fakeProvider(),
        sessionStore: { cleanup: async () => {} },
        accountStore: stores.accountStore,
        accountWorkspaceStore: stores.accountWorkspaceStore,
        ownerCredentialStore: stores.ownerCredentialStore,
        userPreferencesStore: stores.userPreferencesStore,
        connectionStore: stores.connectionStore,
      })),
    });
  });

  after(async () => {
    await harness?.close();
    for (const k of OAUTH_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  /** GET /auth/linear and return the opaque state it stored, read off the redirect. */
  async function oauthState(browser) {
    const begin = await browser.get('/auth/linear');
    assert.strictEqual(begin.status, 302, 'the Linear begin redirects to the authorize URL');
    const match = /[?&]state=([^&]+)/.exec(begin.location);
    assert.ok(match, 'beginAuth carries the CSRF state');
    return decodeURIComponent(match[1]);
  }

  test('stale email-only P → Linear conflict offers the re-proof → re-proof restamps → retry offers the merge', async () => {
    const browser = harness.browser();
    const email = `witness-${Date.now()}@x.io`;

    // P is email-only.
    await browser.requestLink(email);
    const firstToken = tokenFromOutbox(harness.transport, email);
    const { nonce: firstNonce } = await browser.openConfirm(firstToken);
    assert.strictEqual((await browser.confirm(firstToken, firstNonce)).status, 302);
    const P = (await browser.session()).accountId;
    assert.ok(P, 'P is established');

    // P goes stale (the merge-proof window lapsed).
    await browser.post('/__test/sign-in', { provider: 'email', scope: email, staleAuth: '1' });
    assert.strictEqual((await browser.session()).identityAuthenticatedAt, 0);

    // The arriving Linear identity is owned by a DIFFERENT account E.
    const E = await harness.stores.accountStore.createAccount();
    await harness.stores.accountStore.linkIdentity(E._id, 'linear', 'viewer-1');

    // First real callback: a conflict, and stale P means the re-auth page — not a merge offer.
    const state1 = await oauthState(browser);
    const first = await browser.get(`/auth/callback?code=code-1&state=${encodeURIComponent(state1)}`);
    assert.strictEqual(first.status, 409);
    assert.match(first.text, /data-testid="merge-reauth-required-page"/);
    assert.match(first.text, /href="\/auth\/email\/reproof"/, 'the email-only re-proof, not the arriving Linear URL');
    assert.strictEqual((await browser.session()).pendingMerge, undefined, 'no offer while P is stale');

    // Re-proof IN THE SAME BROWSER: send and confirm a sign-in link to P's own address.
    const page = await browser.get('/auth/email/reproof');
    assert.strictEqual(page.status, 200);
    assert.match(page.text, /data-testid="email-reproof-page"/);
    const sendNonce = hiddenField(page.text, 'nonce');
    const sent = await browser.post('/auth/email/send', { email, nonce: sendNonce, mode: 'reproof' }, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.strictEqual(sent.status, 200);
    const reproofToken = tokenFromOutbox(harness.transport, email);
    assert.ok(reproofToken, 'the re-proof link was sent');
    const { nonce: confirmNonce } = await browser.openConfirm(reproofToken);
    const confirmed = await browser.confirm(reproofToken, confirmNonce);
    assert.strictEqual(confirmed.status, 302);
    assert.ok((await browser.session()).identityAuthenticatedAt > 0, 'the re-proof re-stamped P through the N2 positive control');

    // Retry the SAME callback: now P is fresh, so the shared responder offers the merge.
    const state2 = await oauthState(browser);
    const second = await browser.get(`/auth/callback?code=code-2&state=${encodeURIComponent(state2)}`);
    assert.strictEqual(second.status, 409);
    assert.match(second.text, /data-testid="merge-confirm-page"/, 'the retry reaches the merge offer');
    const session = await browser.session();
    assert.ok(session.pendingMerge, 'a merge is pending');
    assert.strictEqual(session.pendingMerge.canonicalAccountId, P, 'canonical side is P');
    assert.strictEqual(session.pendingMerge.mergedAccountId, E._id, 'merged side is the arriving account');
    assert.strictEqual(session.accountId, P);
  });
});
