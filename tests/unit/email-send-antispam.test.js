/**
 * LIN-3771: the send door against a form-spam bot. Honeypot, minimum
 * GET-to-POST time, a rolling global hourly ceiling and a 24h per-address cap,
 * all answering with the same check-inbox page a real send gets; the per-IP
 * limiter stays a 429. Refusals log a reason and never an address.
 *
 * Run with: node --test tests/unit/email-send-antispam.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { startEmailAuthHarness } from '../fixtures/email-auth-harness.js';
import { createEmailSendLimiter } from '../../routes/email-auth.js';
import { renderEmailSignInPage, renderEmailRegisterPage, renderEmailReproofPage, renderEmailLinkConfirmPage, renderEmailConfirmPage } from '../../lib/render-email-auth.js';
import { EMAIL_SEND_DAILY_MAX, EMAIL_SEND_GLOBAL_MAX, EMAIL_SEND_MIN_FORM_MS } from '../../lib/email-auth.js';

const SAME_ORIGIN = { headers: { 'Sec-Fetch-Site': 'same-origin' } };

function captureWarnings() {
  const lines = [];
  const orig = console.warn;
  console.warn = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.warn = orig; } };
}

const linkCount = harness => harness.db.collection('email-magic-links').countDocuments({});

describe('honeypot', () => {
  let harness, warn;
  before(async () => { harness = await startEmailAuthHarness(); });
  after(async () => { await harness?.close(); });
  beforeEach(() => { warn = captureWarnings(); });
  afterEach(() => warn.restore());

  test('a filled honeypot gets the normal check-inbox page, sends nothing, stores nothing, logs only the reason', async () => {
    const real = await harness.browser().requestLink('real@x.io');
    const before = await linkCount(harness);
    const sent = harness.transport.outbox.length;

    const bot = harness.browser();
    const { nonce } = await bot.openForm();
    const res = await bot.post('/auth/email/send', { email: 'bot-victim@x.io', nonce, website: 'http://spam.example' }, SAME_ORIGIN);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.text, real.text, 'byte-identical to an accepted send');
    assert.strictEqual(await linkCount(harness), before);
    assert.strictEqual(harness.transport.outbox.length, sent);
    assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: honeypot']);
    assert.ok(!warn.lines.join('\n').includes('bot-victim'), 'the address is never logged');
  });

  test('an empty honeypot field (what a browser submits) is a normal send', async () => {
    const b = harness.browser();
    const { nonce } = await b.openForm();
    await b.post('/auth/email/send', { email: 'human@x.io', nonce, website: '' }, SAME_ORIGIN);
    assert.ok(harness.transport.lastMessageTo('human@x.io'));
  });

  test('the honeypot is on all three send forms and on no confirm form', () => {
    const field = /name="website"/;
    const n = 'N'.repeat(43);
    assert.match(renderEmailSignInPage({ nonce: n }), field);
    assert.match(renderEmailRegisterPage({ nonce: n }), field);
    assert.match(renderEmailReproofPage({ email: 'a@x.io', nonce: n }), field);
    assert.doesNotMatch(renderEmailLinkConfirmPage({ email: 'a@x.io', token: 'T'.repeat(43), nonce: n }), field);
    assert.doesNotMatch(renderEmailConfirmPage({ email: 'a@x.io', token: 'T'.repeat(43), nonce: n }), field);
  });
});

describe('minimum time between the form and the send', () => {
  let harness, clock, warn;
  before(async () => {
    clock = { ms: 1_000_000 };
    harness = await startEmailAuthHarness({ minFormMs: EMAIL_SEND_MIN_FORM_MS, nonceClock: clock });
  });
  after(async () => { await harness?.close(); });
  beforeEach(() => { warn = captureWarnings(); });
  afterEach(() => warn.restore());

  test('a POST inside the minimum is a silent refusal that does not consume the nonce; the same nonce works after the wait', async () => {
    const b = harness.browser();
    const { nonce } = await b.openForm();
    clock.ms += EMAIL_SEND_MIN_FORM_MS - 1;
    const early = await b.post('/auth/email/send', { email: 'fast@x.io', nonce }, SAME_ORIGIN);
    assert.strictEqual(early.status, 200);
    assert.match(early.text, /data-testid="email-check-inbox"/);
    assert.strictEqual(await linkCount(harness), 0);
    assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: too-fast']);

    clock.ms += 1;
    const late = await b.post('/auth/email/send', { email: 'fast@x.io', nonce }, SAME_ORIGIN);
    assert.strictEqual(late.text, early.text);
    assert.ok(harness.transport.lastMessageTo('fast@x.io'), 'the same nonce still sends once the minimum has passed');
  });
});

describe('global hourly ceiling', () => {
  let harness, warn;
  before(async () => {
    harness = await startEmailAuthHarness({ globalSendMax: EMAIL_SEND_GLOBAL_MAX });
  });
  after(async () => { await harness?.close(); });
  beforeEach(() => { warn = captureWarnings(); });
  afterEach(() => warn.restore());

  test(`the ${EMAIL_SEND_GLOBAL_MAX + 1}th send in an hour, from any address, is silently refused with the same page`, async () => {
    let first;
    for (let i = 0; i < EMAIL_SEND_GLOBAL_MAX; i++) {
      const res = await harness.browser().requestLink(`g${i}@x.io`);
      first ??= res;
    }
    assert.strictEqual(await linkCount(harness), EMAIL_SEND_GLOBAL_MAX);
    const over = await harness.browser().requestLink('over@x.io');
    assert.strictEqual(over.status, 200);
    assert.strictEqual(over.text, first.text);
    assert.strictEqual(await linkCount(harness), EMAIL_SEND_GLOBAL_MAX);
    assert.strictEqual(harness.transport.lastMessageTo('over@x.io'), null);
    assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: global-ceiling']);
  });
});

describe('global ceiling window', () => {
  test('links older than an hour do not count', async () => {
    const storeClock = { ms: Date.now() };
    const harness = await startEmailAuthHarness({ globalSendMax: 2, storeClock });
    try {
      await harness.browser().requestLink('a@x.io');
      await harness.browser().requestLink('b@x.io');
      storeClock.ms += 60 * 60 * 1000 + 1000;
      await harness.browser().requestLink('c@x.io');
      assert.ok(harness.transport.lastMessageTo('c@x.io'));
    } finally { await harness.close(); }
  });
});

describe('24h per-address cap', () => {
  test(`coexists with the 15 minute cap: spaced sends stop after ${EMAIL_SEND_DAILY_MAX} in a day`, async () => {
    const storeClock = { ms: Date.now() };
    const warn = captureWarnings();
    const harness = await startEmailAuthHarness({ storeClock });
    try {
      // Spaced 20 minutes apart, so the 3-per-15-minutes cap never trips.
      for (let i = 0; i < EMAIL_SEND_DAILY_MAX; i++) {
        await harness.browser().requestLink('daily@x.io');
        storeClock.ms += 20 * 60 * 1000;
      }
      const links = harness.db.collection('email-magic-links');
      assert.strictEqual(await links.countDocuments({ emailNorm: 'daily@x.io' }), EMAIL_SEND_DAILY_MAX);
      const res = await harness.browser().requestLink('daily@x.io');
      assert.strictEqual(res.status, 200);
      assert.match(res.text, /data-testid="email-check-inbox"/);
      assert.strictEqual(await links.countDocuments({ emailNorm: 'daily@x.io' }), EMAIL_SEND_DAILY_MAX);
      assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: recipient-daily-cap']);

      storeClock.ms += 24 * 60 * 60 * 1000;
      await harness.browser().requestLink('daily@x.io');
      assert.strictEqual(await links.countDocuments({ emailNorm: 'daily@x.io' }), EMAIL_SEND_DAILY_MAX + 1);
    } finally { warn.restore(); await harness.close(); }
  });
});

describe('per-IP limiter', () => {
  test('stays a 429 on refusal and logs the reason without any address', async () => {
    const warn = captureWarnings();
    const harness = await startEmailAuthHarness({ sendLimiter: createEmailSendLimiter({ skip: () => false }) });
    try {
      for (let i = 0; i < 10; i++) await harness.browser().requestLink(`ip${i}@x.io`);
      const res = await harness.browser().requestLink('ip-over@x.io');
      assert.strictEqual(res.status, 429);
      assert.match(res.text, /Too many sign-in emails requested/);
      assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: per-ip-limit']);
    } finally { warn.restore(); await harness.close(); }
  });
});
