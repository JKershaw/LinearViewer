/**
 * LIN-1892 S2 security properties of the email door (plan S2 Tests,
 * `email-auth-security.test.js`): no enumeration, the per-email throttle, the
 * per-IP rate limit, expiry, hash-only storage, the 503 when email is off,
 * and links built on the configured origin rather than a forgeable Host.
 *
 * The transport-level pins (console refused under production, the Resend
 * body/headers) are in tests/unit/email-transport.test.js; the env matrix is
 * in tests/unit/email-availability.test.js.
 *
 * Run with: node --test tests/unit/email-auth-security.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { startEmailAuthHarness, tokenFromOutbox, sha256 } from '../fixtures/email-auth-harness.js';
import { createCaptureTransport, createEmailTransport } from '../../lib/email-transport.js';
import { EMAIL_SEND_THROTTLE_MAX, MAGIC_LINK_TTL_MS } from '../../lib/email-auth.js';
import { createEmailSendLimiter } from '../../routes/email-auth.js';

// A capture transport that can be switched to fail, as Resend would on a 5xx.
function switchableTransport() {
  const capture = createCaptureTransport();
  return {
    kind: 'capture',
    outbox: capture.outbox,
    lastMessageTo: to => capture.lastMessageTo(to),
    failing: false,
    async send(message) {
      if (this.failing) return { ok: false, status: 503 };
      return capture.send(message);
    },
  };
}

describe('send: one response for every address (no enumeration)', () => {
  let harness;
  before(async () => { harness = await startEmailAuthHarness({ transport: switchableTransport() }); });
  after(async () => { await harness?.close(); });

  test('byte-identical for a known address, an unknown address, a throttled address and a failing transport', async () => {
    // Known: an account already holds known@x.io.
    const setup = harness.browser();
    await setup.post('/__test/sign-in', { provider: 'email', scope: 'known@x.io' });
    // Throttled: throttled@x.io has already had its quota.
    for (let i = 0; i < EMAIL_SEND_THROTTLE_MAX; i++) await harness.browser().requestLink('throttled@x.io');

    const known = await harness.browser().requestLink('known@x.io');
    const unknown = await harness.browser().requestLink('unknown@x.io');
    const throttled = await harness.browser().requestLink('throttled@x.io');
    harness.transport.failing = true;
    const failing = await harness.browser().requestLink('failing@x.io');
    harness.transport.failing = false;

    for (const res of [known, unknown, throttled, failing]) {
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.text, known.text, 'the body is byte-identical');
    }
    assert.match(known.text, /data-testid="email-check-inbox"/);
    assert.doesNotMatch(known.text, /known@x\.io/, 'the page does not echo the address');
  });
});

describe('throttle, expiry, storage', () => {
  let harness;
  const storeClock = { ms: Date.now() };
  before(async () => { harness = await startEmailAuthHarness({ storeClock }); });
  after(async () => { await harness?.close(); });

  test('the per-email throttle trips at N+1: no token issued, no email sent', async () => {
    for (let i = 0; i < EMAIL_SEND_THROTTLE_MAX; i++) await harness.browser().requestLink('busy@x.io');
    const links = harness.db.collection('email-magic-links');
    assert.strictEqual(await links.countDocuments({ emailNorm: 'busy@x.io' }), EMAIL_SEND_THROTTLE_MAX);
    const sentBefore = harness.transport.outbox.length;

    const res = await harness.browser().requestLink('BUSY@x.io');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(await links.countDocuments({ emailNorm: 'busy@x.io' }), EMAIL_SEND_THROTTLE_MAX, 'no fourth token');
    assert.strictEqual(harness.transport.outbox.length, sentBefore, 'no fourth email');
  });

  test('an expired link is refused on GET and on POST, and is not consumed', async () => {
    const browser = harness.browser();
    await browser.requestLink('late@x.io');
    const t = tokenFromOutbox(harness.transport, 'late@x.io');
    const { nonce } = await browser.openConfirm(t);

    storeClock.ms += MAGIC_LINK_TTL_MS + 1;
    try {
      const page = await browser.openConfirm(t);
      assert.strictEqual(page.res.status, 410);
      assert.match(page.res.text, /data-testid="email-link-expired"/);
      const post = await browser.confirm(t, nonce);
      assert.strictEqual(post.status, 410);
      assert.strictEqual((await harness.db.collection('email-magic-links').findOne({ _id: sha256(t) })).consumedAt, null);
      assert.strictEqual(await harness.stores.accountStore.findAccountByIdentity('email', 'late@x.io'), null);
    } finally {
      storeClock.ms -= MAGIC_LINK_TTL_MS + 1;
    }
  });

  test('the token is stored only as its hash: the _id is not the token, and the token is nowhere in the DB', async () => {
    await harness.browser().requestLink('stored@x.io');
    const t = tokenFromOutbox(harness.transport, 'stored@x.io');
    const docs = await harness.db.collection('email-magic-links').find({}).toArray();
    assert.ok(docs.some(d => d._id === sha256(t)));
    assert.ok(docs.every(d => d._id !== t));
    assert.ok(!JSON.stringify(docs).includes(t));
    const sessions = await harness.db.collection('sessions').find({}).toArray();
    assert.ok(!JSON.stringify(sessions).includes(t), 'nor in any session');
  });

  test('an invalid address re-renders the form (a message about the typed text only), issuing nothing', async () => {
    const browser = harness.browser();
    const { nonce } = await browser.openForm();
    const before = await harness.db.collection('email-magic-links').countDocuments({});
    const res = await browser.post('/auth/email/send', { email: 'not-an-address', nonce });
    assert.strictEqual(res.status, 400);
    assert.match(res.text, /data-testid="email-signin-error"/);
    assert.match(res.text, /data-testid="email-signin-form"/);
    assert.strictEqual(await harness.db.collection('email-magic-links').countDocuments({}), before);
  });
});

describe('per-IP rate limit on send', () => {
  let harness;
  before(async () => {
    harness = await startEmailAuthHarness({ sendLimiter: createEmailSendLimiter({ skip: () => false }) });
  });
  after(async () => { await harness?.close(); });

  test('the 11th send from one IP inside 15 minutes is refused 429, and issues nothing', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await harness.browser().requestLink(`ip${i}@x.io`);
      assert.strictEqual(res.status, 200, `send ${i + 1}`);
    }
    const before = await harness.db.collection('email-magic-links').countDocuments({});
    const res = await harness.browser().requestLink('ip10@x.io');
    assert.strictEqual(res.status, 429);
    assert.strictEqual(await harness.db.collection('email-magic-links').countDocuments({}), before);
  });

  test('the default limiter is skipped under NODE_ENV=test (the routes/proxy.js shape), so e2e sends are not capped', async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const skipped = await startEmailAuthHarness({ sendLimiter: createEmailSendLimiter() });
    try {
      for (let i = 0; i < 11; i++) {
        assert.strictEqual((await skipped.browser().requestLink(`skip${i}@x.io`)).status, 200, `send ${i + 1}`);
      }
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
      await skipped.close();
    }
  });
});

describe('email off → every /auth/email route answers 503', () => {
  for (const [label, env] of [
    ['NODE_ENV=production with no key', { NODE_ENV: 'production' }],
    ['the self-hosted default: no NODE_ENV and no email variables', {}],
  ]) {
    test(label, async () => {
      const transport = createEmailTransport({ env });
      assert.strictEqual(transport, null);
      const harness = await startEmailAuthHarness({ transport });
      try {
        const browser = harness.browser();
        const T = 'A'.repeat(43);
        for (const res of [
          await browser.get('/auth/email'),
          await browser.post('/auth/email/send', { email: 'a@x.io', nonce: 'N'.repeat(43) }),
          await browser.get(`/auth/email/confirm?t=${T}`),
          await browser.post('/auth/email/confirm', { t: T, nonce: 'N'.repeat(43) }),
        ]) {
          assert.strictEqual(res.status, 503);
          assert.match(res.text, /data-testid="email-unavailable"/);
        }
        assert.strictEqual(await harness.db.collection('email-magic-links').countDocuments({}), 0);
      } finally {
        await harness.close();
      }
    });
  }
});

describe('link origin', () => {
  test('with a configured origin, a forged Host header cannot redirect the emailed link', async () => {
    const harness = await startEmailAuthHarness({ linkOrigin: 'https://harbour.example' });
    try {
      const browser = harness.browser();
      const { nonce } = await browser.openForm();
      await browser.post('/auth/email/send', { email: 'host@x.io', nonce }, { headers: { Host: 'evil.test' } });
      const message = harness.transport.lastMessageTo('host@x.io');
      assert.ok(message.text.includes('https://harbour.example/auth/email/confirm?t='));
      assert.ok(!message.text.includes('evil.test'));
      assert.ok(!message.html.includes('evil.test'));
    } finally {
      await harness.close();
    }
  });

  test('with no configured origin, the link uses the request\'s own origin (dev/test)', async () => {
    const harness = await startEmailAuthHarness();
    try {
      await harness.browser().requestLink('local@x.io');
      assert.ok(harness.transport.lastMessageTo('local@x.io').text.includes(`${harness.baseUrl}/auth/email/confirm?t=`));
    } finally {
      await harness.close();
    }
  });
});

describe('logs never carry the token or the address', () => {
  test('a failing transport and a full sign-in log nothing secret', async () => {
    const transport = switchableTransport();
    const harness = await startEmailAuthHarness({ transport });
    const lines = [];
    const originals = { log: console.log, error: console.error, warn: console.warn };
    for (const level of Object.keys(originals)) console[level] = (...args) => lines.push(args.map(String).join(' '));
    try {
      const browser = harness.browser();
      await browser.requestLink('quiet@x.io');
      const t = tokenFromOutbox(transport, 'quiet@x.io');
      const { nonce } = await browser.openConfirm(t);
      await browser.confirm(t, nonce);
      transport.failing = true;
      await harness.browser().requestLink('quiet2@x.io');
    } finally {
      Object.assign(console, originals);
      await harness.close();
    }
    const joined = lines.join('\n');
    assert.ok(!joined.includes('quiet@x.io') && !joined.includes('quiet2@x.io'), 'no address in the logs');
    assert.doesNotMatch(joined, /auth\/email\/confirm\?t=/, 'no link in the logs');
  });
});
